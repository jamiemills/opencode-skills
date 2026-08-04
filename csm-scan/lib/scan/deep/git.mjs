import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';

const CONVENTIONAL_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?:/;
const EMOJI_RE = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;
const SEMANTIC_LABELS = Object.freeze({
  feat: true, fix: true, chore: true, docs: true, refactor: true, perf: true,
  test: true, build: true, ci: true, revert: true, style: true,
});
const TASK_RE = /^(?:T\d{3}(?:-[a-z][a-z0-9-]*)?|P\d+C?|CSM(?: plan)?|REPAIR|plan|csm-scan|csm-browse):/i;
const TASK_BUCKETS = Object.freeze([
  { re: /^t\d{3}/, label: 'T###' },
  { re: /^p\d/, label: 'P#' },
  { re: /^csm-scan/, label: 'csm-scan' },
  { re: /^csm-browse/, label: 'csm-browse' },
  { re: /^csm(?: plan)?/, label: 'CSM' },
  { re: /^repair/, label: 'REPAIR' },
  { re: /^plan/, label: 'plan' },
]);
const MAIN_BRANCH_NAMES = new Set(['main', 'master', 'trunk', 'develop', 'development']);
const REMEDIATION_STRUCTURE = 'remediation/<date>/<id>/attempt-N';

function countMapToSortedList(counts) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .map(([label, count]) => `${label} ${count}`);
}

function taskBucket(message) {
  const prefix = message.slice(0, message.indexOf(':')).toLowerCase();
  const match = TASK_BUCKETS.find(({ re }) => re.test(prefix));
  return match ? match.label : 'task';
}

/**
 * Classify commit messages into a conventional-style vs task-identified split.
 *
 * The decision is evidence-gated: whichever side has more commits over the
 * fixed log window dominates. Counts are aggregated per prefix (no subjects or
 * identities are surfaced), and the ordering of the report is deterministic.
 *
 * @param {string[]} logLines - `git log --oneline` lines (hash + subject).
 * @returns {string} a counts-based split fact describing the commit style.
 */
export function analyzeCommitStyle(logLines) {
  const conventionalCounts = {};
  const taskCounts = {};
  let emoji = 0;
  let semantic = 0;
  let plain = 0;
  let total = 0;

  for (const line of logLines) {
    const msg = line.replace(/^[a-f0-9]+\s/, '').trim();
    if (!msg) continue;
    total++;
    const conventionalMatch = CONVENTIONAL_RE.exec(msg);
    if (conventionalMatch) {
      const prefix = conventionalMatch[1];
      conventionalCounts[prefix] = (conventionalCounts[prefix] || 0) + 1;
      continue;
    }
    if (EMOJI_RE.test(msg)) {
      emoji++;
      continue;
    }
    if (TASK_RE.test(msg)) {
      const bucket = taskBucket(msg);
      taskCounts[bucket] = (taskCounts[bucket] || 0) + 1;
      continue;
    }
    const colonIdx = msg.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const prefix = msg.slice(0, colonIdx).toLowerCase();
      if (SEMANTIC_LABELS[prefix]) {
        semantic++;
        continue;
      }
    }
    plain++;
  }

  if (total === 0) return 'unknown';

  const conventionalTotal = Object.values(conventionalCounts).reduce((sum, n) => sum + n, 0);
  const taskTotal = Object.values(taskCounts).reduce((sum, n) => sum + n, 0);

  if (conventionalTotal === 0 && taskTotal === 0) {
    const otherEntries = [];
    if (plain > 0) otherEntries.push(`plain ${plain}`);
    if (emoji > 0) otherEntries.push(`emoji ${emoji}`);
    if (semantic > 0) otherEntries.push(`semantic ${semantic}`);
    return `No conventional-style or task-identified prefixes: ${total} commits (${otherEntries.join(', ')})`;
  }

  const conventionalList = countMapToSortedList(conventionalCounts).join(', ');
  const taskList = countMapToSortedList(taskCounts).join(', ');
  const conventionalClause = conventionalTotal > 0 ? ` (${conventionalList})` : '';
  const taskClause = taskTotal > 0 ? ` (${taskList})` : '';

  if (conventionalTotal > taskTotal) {
    return `Conventional-style prefixes dominate: ${conventionalTotal} of ${total} commits${conventionalClause}; task-identified prefixes ${taskTotal}${taskClause}`;
  }
  if (taskTotal > conventionalTotal) {
    return `Task-identified prefixes dominate: ${taskTotal} of ${total} commits${taskClause}; conventional-style prefixes ${conventionalTotal}${conventionalClause}`;
  }
  return `Conventional-style and task-identified prefixes balanced: ${conventionalTotal} of ${total} commits${conventionalClause}; task-identified prefixes ${taskTotal}${taskClause}`;
}

/**
 * Summarise branch naming structure from `git branch -a` output.
 *
 * Worktree markers (`+`) and remote prefixes are stripped before the first
 * path segment is tallied. When a `remediation` prefix is present, the fact
 * reports the `remediation/<date>/<id>/attempt-N` structure (depth + generic
 * tokens) instead of `remediation/*`; real dates, ids, or identities are never
 * surfaced.
 *
 * @param {string[]} branches - raw `git branch -a` lines.
 * @returns {string} an aggregated branch-naming fact.
 */
function analyzeBranchPatterns(branches) {
  if (branches.length === 0) return 'unknown';
  const patterns = {};
  const other = [];

  for (const raw of branches) {
    const cleaned = raw.replace(/^[*+]\s*/, '').trim();
    const branch = cleaned.replace(/^remotes\/[^/]+\//, '');
    if (!branch || MAIN_BRANCH_NAMES.has(branch)) continue;
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
  return sorted
    .map(([prefix]) => (prefix === 'remediation' ? REMEDIATION_STRUCTURE : `${prefix}/*`))
    .join(', ');
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

  const logLines = (await safeGit('git:log-oneline-200')).split('\n').filter(Boolean);
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
