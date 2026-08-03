import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';

export function analyzeCommitStyle(logLines) {
  if (logLines.length === 0) return 'unknown';
  const categories = { conventional: 0, emoji: 0, semantic: 0, 'task-identified': 0, plain: 0 };
  const conventionalRe = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?:/;
  const emojiRe = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;
  const semanticLabels = { feat: true, fix: true, chore: true, docs: true, refactor: true, perf: true, test: true, build: true, ci: true, revert: true, style: true };
  const taskRe = /^(?:T\d{3}(?:-[a-z][a-z0-9-]*)?|P\d+C?|CSM(?: plan)?|REPAIR|plan|csm-scan|csm-browse):/i;

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
    if (taskRe.test(msg)) {
      categories['task-identified']++;
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
  if (categories['task-identified'] / total > 0.5) return 'Task-identified';
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

function sanitizeRemoteUrl(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';
  if (value.startsWith('/') || value.startsWith('\\') || value.startsWith('.')
      || value === '~' || value.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return '';
  }
  value = value.replace(/^(?:https?|ssh|git|git\+ssh|file):\/\//i, '');
  value = value.replace(/^git@/, '');
  if (value.includes('@')) value = value.slice(value.lastIndexOf('@') + 1);
  value = value.replace(/^([^/:]+):(\d+)\//, '$1/$2/');
  value = value.replace(/^([^/:]+):/, '$1/');
  value = value.replace(/\.git$/, '');
  value = value.replace(/\/+$/, '');
  if (!value || value.startsWith('/') || value.startsWith('\\') || value.startsWith('.')) return '';
  return value;
}

async function detectDefaultBranch(safeGit) {
  const remote = await safeGit('git:symbolic-ref-origin-head');
  if (remote) {
    const name = remote.split('/').pop();
    if (name) return name;
  }
  const branch = await safeGit('git:rev-parse-abbrev-head');
  return branch || 'unknown';
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const isGit = existsSync(join(repoPath, '.git'));
  if (!isGit) {
    return {
      dimension: 'git',
      signal: 'low',
      findings: {
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
      },
    };
  }

  const safeGit = async (id) => {
    try {
      const result = await broker.execute(id, { cwd: repoPath });
      return result.ok ? result.stdout.trim() : '';
    } catch {
      return '';
    }
  };

  const logLines = (await safeGit('git:log-oneline-50')).split('\n').filter(Boolean);
  const branchLines = (await safeGit('git:branch-list')).split('\n').filter(Boolean);
  const defaultBranch = await detectDefaultBranch(safeGit);

  const prTemplate =
    existsSync(join(repoPath, '.github/PULL_REQUEST_TEMPLATE.md')) ||
    existsSync(join(repoPath, '.github/pull_request_template.md')) ||
    existsSync(join(repoPath, 'docs/PULL_REQUEST_TEMPLATE.md'));

  const issueTemplateDir = join(repoPath, '.github/ISSUE_TEMPLATE');
  const hasIssueTemplates =
    existsSync(issueTemplateDir) ||
    existsSync(join(repoPath, '.github/ISSUE_TEMPLATE.md'));

  const remote = sanitizeRemoteUrl(await safeGit('git:config-remote-origin-url'));
  const displayRemote = remote || 'N/A';

  const summary = await safeGit('git:shortlog-summary');
  const contributorCount = summary ? summary.split('\n').filter(Boolean).length : 0;

  const isGitRepo = logLines.length > 0 || branchLines.length > 0;
  const signal = logLines.length > 0 ? 'high' : 'medium';
  const commitStyle = analyzeCommitStyle(logLines);
  const branchPattern = analyzeBranchPatterns(branchLines);

  return {
    dimension: 'git',
    signal,
    findings: {
      isGit: isGitRepo,
      branchPattern,
      overview: generateOverview({
        branchPattern,
        commitStyle,
        defaultBranch,
        prTemplate,
        hasIssueTemplates,
        remote: displayRemote,
        contributorCount,
      }),
      commitStyle,
      branchStyle: branchPattern,
      defaultBranch,
      prTemplate,
      hasIssueTemplates,
      remote: displayRemote,
      contributorCount,
      topContributors: [],
      logCount: logLines.length,
    },
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
