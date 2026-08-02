import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function safeExec(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

function safeLines(cmd, cwd) {
  const out = safeExec(cmd, cwd, '');
  return out ? out.split('\n').filter(Boolean) : [];
}

function analyzeCommitStyle(logLines) {
  if (logLines.length === 0) return 'unknown';
  const categories = { conventional: 0, emoji: 0, semantic: 0, plain: 0 };
  const conventionalRe = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?:/;
  const emojiRe = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;
  const semanticLabels = { feat: true, fix: true, chore: true, docs: true, refactor: true, perf: true, test: true, build: true, ci: true, revert: true, style: true };

  for (const line of logLines) {
    const msg = line.replace(/^[a-f0-9]+\s/, '').trim();
    if (!msg) continue;
    if (conventionalRe.test(msg)) {
      categories.conventional++;
      continue;
    }
    if (emojiRe.test(msg)) {
      categories.emoji++;
      continue;
    }
    const colonIdx = msg.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const prefix = msg.slice(0, colonIdx).toLowerCase();
      if (semanticLabels[prefix]) {
        categories.semantic++;
        continue;
      }
    }
    categories.plain++;
  }

  const total = logLines.length;
  const pct = (n) => ((n / total) * 100).toFixed(0);
  if (categories.conventional / total > 0.6) return 'Conventional Commits';
  if (categories.emoji / total > 0.6) return 'Emoji-prefixed';
  if (categories.semantic / total > 0.5) return 'Semantic-like prefixes';
  if (categories.plain / total > 0.5) return 'Unstructured / free-form';

  const maxCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  if (maxCat[1] === 0) return 'unknown';
  return `Mixed — ${pct(maxCat[1])}% ${maxCat[0]}`;
}

function analyzeBranchPatterns(branches) {
  if (branches.length === 0) return 'unknown';
  const patterns = {};
  const mainNames = new Set(['main', 'master', 'trunk', 'develop', 'development']);
  const other = [];

  for (const raw of branches) {
    const cleaned = raw.replace(/^\*\s*/, '').trim();
    const branch = cleaned.replace(/^remotes\/[^/]+\//, '');
    if (!branch || mainNames.has(branch)) continue;
    const slashIdx = branch.indexOf('/');
    if (slashIdx > 0) {
      const prefix = branch.slice(0, slashIdx);
      patterns[prefix] = (patterns[prefix] || 0) + 1;
    } else {
      other.push(branch);
    }
  }

  const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    if (other.length > 0) return `Flat (${other.slice(0, 3).join(', ')})`;
    return 'unknown';
  }
  return sorted.map(([k, v]) => `${k}/*`).join(', ');
}

function detectDefaultBranch(repoPath) {
  const remote = safeExec('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null', repoPath, '');
  if (remote) {
    const name = remote.split('/').pop();
    if (name) return name;
  }
  const branch = safeExec('git rev-parse --abbrev-ref HEAD 2>/dev/null', repoPath, '');
  return branch || 'unknown';
}

export async function scanGit(repoPath) {
  const isGit = existsSync(join(repoPath, '.git'));
  if (!isGit) {
    return {
      isGit: false,
      branchPattern: 'N/A',
      overview: 'No git repository detected',
      commitStyle: 'N/A',
      branchStyle: 'N/A',
      defaultBranch: 'N/A',
      prTemplate: false,
      hasIssueTemplates: false,
      remote: 'N/A',
      contributorCount: 0,
      topContributors: [],
    };
  }

  const logLines = safeLines('git log --oneline -50 2>/dev/null', repoPath);
  const branchLines = safeLines('git branch -a 2>/dev/null', repoPath);
  const defaultBranch = detectDefaultBranch(repoPath);

  const prTemplate =
    existsSync(join(repoPath, '.github/PULL_REQUEST_TEMPLATE.md')) ||
    existsSync(join(repoPath, '.github/pull_request_template.md')) ||
    existsSync(join(repoPath, 'docs/PULL_REQUEST_TEMPLATE.md'));

  const issueTemplateDir = join(repoPath, '.github/ISSUE_TEMPLATE');
  const hasIssueTemplates =
    existsSync(issueTemplateDir) ||
    existsSync(join(repoPath, '.github/ISSUE_TEMPLATE.md'));

  const remote = safeExec('git config --get remote.origin.url 2>/dev/null', repoPath, '');
  const displayRemote = remote ? remote.replace(/https?:\/\//, '').replace(/\.git$/, '').replace(/^git@/, '').replace(/:/g, '/') : 'N/A';

  const authorLines = safeLines("git log --format='%an' 2>/dev/null | sort | uniq -c | sort -rn 2>/dev/null || true", repoPath);
  let contributorCount = 0;
  const contributorMap = {};
  for (const line of authorLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const count = parseInt(parts[0], 10);
      const name = parts.slice(1).join(' ');
      if (!isNaN(count) && name) {
        contributorMap[name] = (contributorMap[name] || 0) + count;
      }
    }
  }

  const isGitRepo = logLines.length > 0 || branchLines.length > 0;
  const topContributors = Object.entries(contributorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, commits: count }));
  const totalContributors = Object.keys(contributorMap).length;

  return {
    isGit: isGitRepo,
    branchPattern: analyzeBranchPatterns(branchLines),
    overview: generateOverview({
      branchPattern: analyzeBranchPatterns(branchLines),
      commitStyle: analyzeCommitStyle(logLines),
      defaultBranch,
      prTemplate,
      hasIssueTemplates,
      remote: displayRemote,
      contributorCount: totalContributors,
    }),
    commitStyle: analyzeCommitStyle(logLines),
    branchStyle: analyzeBranchPatterns(branchLines),
    defaultBranch,
    prTemplate,
    hasIssueTemplates,
    remote: displayRemote,
    contributorCount: totalContributors,
    topContributors,
    logCount: logLines.length,
  };
}

function generateOverview(g) {
  const parts = [];
  if (g.branchPattern && g.branchPattern !== 'unknown') {
    parts.push(`Branch naming: ${g.branchPattern}`);
  }
  parts.push(`Commit style: ${g.commitStyle}`);
  parts.push(`Default branch: ${g.defaultBranch}`);
  if (g.prTemplate) parts.push('PR template');
  if (g.hasIssueTemplates) parts.push('Issue templates');
  if (g.remote && g.remote !== 'N/A') parts.push(`Remote: ${g.remote}`);
  parts.push(`${g.contributorCount} contributor${g.contributorCount !== 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' | ') : 'No git history found';
}
