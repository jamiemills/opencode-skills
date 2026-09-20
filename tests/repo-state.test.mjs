"use strict";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { repoCommonDir, repoLogPath, repoStateDir } from "../scripts/lib/repo-state.mjs";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "repo-state-test",
  GIT_AUTHOR_EMAIL: "repo-state-test@example.invalid",
  GIT_COMMITTER_NAME: "repo-state-test",
  GIT_COMMITTER_EMAIL: "repo-state-test@example.invalid",
};

function git(args, cwd) {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

function makeRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "csm-repo-state-")));
  git(["init", "--quiet"], dir);
  writeFileSync(join(dir, "README.md"), "repo-state test\n", "utf8");
  git(["add", "."], dir);
  git(["commit", "--quiet", "-m", "initial"], dir);
  return dir;
}

function cleanup(...dirs) {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

test("repoCommonDir is absolute and under the repo's .git", () => {
  const root = makeRepo();
  try {
    const common = repoCommonDir(root);
    assert.ok(isAbsolute(common), `expected absolute path, got ${common}`);
    assert.equal(common, join(root, ".git"));
    assert.ok(repoLogPath(root).startsWith(join(common, "csm")));
    assert.ok(repoStateDir(root).startsWith(join(common, "csm")));
    assert.equal(repoLogPath(root), join(common, "csm", "logs", "trace.jsonl"));
    assert.equal(repoStateDir(root), join(common, "csm", "state"));
  } finally {
    cleanup(root);
  }
});

test("linked worktrees share one common dir and log path", () => {
  const root = makeRepo();
  const wt = `${root}-wt`;
  try {
    git(["worktree", "add", "--quiet", "-b", "test-wt", wt, "HEAD"], root);
    assert.equal(repoCommonDir(wt), repoCommonDir(root));
    assert.equal(repoLogPath(wt), repoLogPath(root));
    assert.equal(repoStateDir(wt), repoStateDir(root));
  } finally {
    cleanup(wt, root);
  }
});

test("result is identical regardless of process.cwd()", () => {
  const root = makeRepo();
  const elsewhere = makeRepo();
  const originalCwd = process.cwd();
  try {
    const fromInside = repoCommonDir(root);
    process.chdir(elsewhere);
    assert.notEqual(process.cwd(), root);
    const withExplicitRoot = repoCommonDir(root);
    assert.equal(withExplicitRoot, fromInside);
    assert.equal(repoLogPath(root), join(fromInside, "csm", "logs", "trace.jsonl"));
  } finally {
    process.chdir(originalCwd);
    cleanup(elsewhere, root);
  }
});

test("falls back to XDG_STATE_HOME for a non-git root and is stable", () => {
  const nonGit = realpathSync(mkdtempSync(join(tmpdir(), "csm-non-git-")));
  const xdg = realpathSync(mkdtempSync(join(tmpdir(), "csm-xdg-")));
  const originalXdg = process.env.XDG_STATE_HOME;
  try {
    process.env.XDG_STATE_HOME = xdg;
    const first = repoCommonDir(nonGit);
    const second = repoCommonDir(nonGit);
    assert.ok(first.startsWith(xdg), `expected ${first} under ${xdg}`);
    assert.equal(first, second);
    assert.ok(repoLogPath(nonGit).startsWith(first));
  } finally {
    if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdg;
    cleanup(nonGit, xdg);
  }
});
