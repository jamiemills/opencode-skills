// Test helper: create real throwaway Git repositories for governance tests.
//
// T215 owns this module. It provisions a temporary directory, initializes a
// Git repository, writes fixture files, records commits (optionally with
// distinct authors so commit-derived identities can be verified as absent),
// and optionally adds a remote so end-to-end scanner tests exercise the T208
// broker against real Git without touching any scanned repository.
//
// Test-only: node:child_process and node:fs usage here is outside the
// production capability gate (which audits `lib/` and `scripts/` only).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export function runGit(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * Create a temporary Git repository.
 *
 * `files` are written before the first commit. `commits` is an array of either
 * commit messages (strings) or `{ message, files, user, email }` records; each
 * entry stages any added files, switches the author when provided, and commits.
 * A commit with no pending changes is skipped.
 *
 * @param {object} options - `{ files, commits, remote, defaultBranch, user,
 *   email }`.
 * @returns {string} the temporary repository root.
 */
export function makeGitRepo({
  files = {},
  commits = [],
  remote = null,
  defaultBranch = 'main',
  user = 'Gov Fixture',
  email = 'gov-fixture@example.test',
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'csm-scan-gov-'));
  runGit(dir, ['init', '-q', '-b', defaultBranch]);
  runGit(dir, ['config', 'user.name', user]);
  runGit(dir, ['config', 'user.email', email]);
  runGit(dir, ['config', 'commit.gpgsign', 'false']);
  const writeAll = (records) => {
    for (const [rel, content] of Object.entries(records)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  };
  writeAll(files);
  for (const entry of commits) {
    const commit = typeof entry === 'string' ? { message: entry } : entry;
    if (commit.files !== undefined) writeAll(commit.files);
    runGit(dir, ['add', '-A']);
    if (commit.user !== undefined) runGit(dir, ['config', 'user.name', commit.user]);
    if (commit.email !== undefined) runGit(dir, ['config', 'user.email', commit.email]);
    try {
      runGit(dir, ['commit', '-q', '-m', commit.message]);
    } catch {
      // no pending changes for this commit; skip
    }
  }
  if (remote !== null) runGit(dir, ['remote', 'add', 'origin', remote]);
  return dir;
}

export function cleanupGitRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export async function withGitRepo(files, commits, fn) {
  const dir = makeGitRepo({ files, commits });
  try {
    return await fn(dir);
  } finally {
    cleanupGitRepo(dir);
  }
}
