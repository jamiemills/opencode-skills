"use strict";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import {
  relativeLogPathStaysUnderRoot,
  repoCommonDir,
  repoLogPath,
  repoMainRoot,
  repoStateDir,
} from "../scripts/lib/repo-state.mjs";

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

test("default log lives at <mainRoot>/.agents/logs/trace.jsonl, not under .git", () => {
  const root = makeRepo();
  try {
    const common = repoCommonDir(root);
    assert.equal(repoMainRoot(root), root, "main root is the checkout itself");
    assert.equal(repoCommonDir(root), join(root, ".git"));
    assert.equal(
      repoStateDir(root),
      join(common, "csm", "state"),
      "registry stays under common dir",
    );

    const log = repoLogPath(root);
    assert.equal(log, join(root, ".agents", "logs", "trace.jsonl"));
    assert.ok(!log.startsWith(join(root, ".git")), "default log is not inside .git");
    assert.ok(!log.startsWith(join(common, "csm")), "default log is not the registry");
    assert.equal(repoLogPath(root), repoLogPath(root, {}), "no-config call equals empty options");
    assert.equal(repoLogPath(root), repoLogPath(root, { configured: undefined }));
  } finally {
    cleanup(root);
  }
});

test("linked worktrees resolve the same main root and log path", () => {
  const root = makeRepo();
  const wt = `${root}-wt`;
  try {
    git(["worktree", "add", "--quiet", "-b", "test-wt", wt, "HEAD"], root);
    assert.equal(repoMainRoot(wt), root, "main root is the checkout, not the worktree");
    assert.equal(repoMainRoot(wt), repoMainRoot(root));
    assert.equal(repoCommonDir(wt), repoCommonDir(root));
    assert.equal(repoLogPath(wt), repoLogPath(root));
    assert.equal(repoLogPath(wt), join(root, ".agents", "logs", "trace.jsonl"));
    assert.equal(repoStateDir(wt), repoStateDir(root));
  } finally {
    cleanup(wt, root);
  }
});

test("a submodule resolves to its working tree, never under .git/modules", () => {
  const parent = makeRepo();
  const source = realpathSync(mkdtempSync(join(tmpdir(), "csm-submodule-src-")));
  try {
    git(["init", "--quiet"], source);
    writeFileSync(join(source, "sub.txt"), "submodule\n", "utf8");
    git(["add", "."], source);
    git(["commit", "--quiet", "-m", "submodule source"], source);
    git(
      ["-c", "protocol.file.allow=always", "submodule", "add", "--quiet", source, "mods/sub"],
      parent,
    );
    git(["commit", "--quiet", "-m", "add submodule"], parent);

    const sub = join(parent, "mods", "sub");
    const common = repoCommonDir(sub);
    const mainRoot = repoMainRoot(sub);
    const log = repoLogPath(sub);

    assert.ok(
      common.includes(join(".git", "modules")),
      "precondition: the submodule gitdir lives under the superproject .git/modules",
    );
    assert.equal(mainRoot, sub, "main root is the submodule's working tree, not its gitdir");
    assert.ok(!mainRoot.includes(`${sep}.git${sep}`), "main root is not under a .git dir");
    assert.equal(log, join(sub, ".agents", "logs", "trace.jsonl"));
    assert.ok(log.endsWith(join(sub, ".agents", "logs", "trace.jsonl")));
    assert.ok(!log.includes(`${sep}.git${sep}`), "default log is never under a .git directory");
    assert.equal(repoMainRoot(sub), repoMainRoot(sub), "resolution is stable");
  } finally {
    cleanup(source, parent);
  }
});

test("an absolute configured path is honoured as-is", () => {
  const root = makeRepo();
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "csm-config-abs-")));
  try {
    const configured = join(elsewhere, "custom", "trace.jsonl");
    assert.equal(repoLogPath(root, { configured }), configured);
    // A relative-looking path in a different root is still absolute -> as-is.
    assert.equal(repoLogPath(root, { configured: elsewhere }), elsewhere);
  } finally {
    cleanup(elsewhere, root);
  }
});

test("a relative configured path resolves against the main root", () => {
  const root = makeRepo();
  const wt = `${root}-wt`;
  try {
    git(["worktree", "add", "--quiet", "-b", "test-wt", wt, "HEAD"], root);
    assert.equal(
      repoLogPath(root, { configured: join("custom", "trace.jsonl") }),
      join(root, "custom", "trace.jsonl"),
    );
    assert.equal(
      repoLogPath(wt, { configured: join("custom", "trace.jsonl") }),
      join(root, "custom", "trace.jsonl"),
      "relative config from a linked worktree resolves against the main root",
    );
  } finally {
    cleanup(wt, root);
  }
});

test("empty, missing, and non-string configured values fall back to the default", () => {
  const root = makeRepo();
  try {
    const expected = join(root, ".agents", "logs", "trace.jsonl");
    assert.equal(repoLogPath(root, { configured: "" }), expected, "empty string falls back");
    assert.equal(repoLogPath(root, { configured: undefined }), expected);
    assert.equal(repoLogPath(root, { configured: null }), expected);
    assert.equal(repoLogPath(root, { configured: 42 }), expected, "non-string falls back");
  } finally {
    cleanup(root);
  }
});

test("a configured path pointing at an existing directory is returned as-is", () => {
  const root = makeRepo();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "csm-config-dir-")));
  try {
    assert.equal(repoLogPath(root, { configured: dir }), dir, "no directory special-casing");
  } finally {
    cleanup(dir, root);
  }
});

test("a relative configured path that escapes the main root falls back to the in-repo default", () => {
  const root = makeRepo();
  try {
    const escape = join("..", "..", "..", "tmp", "evil", "trace.jsonl");
    const fallback = join(root, ".agents", "logs", "trace.jsonl");
    assert.equal(repoLogPath(root, { configured: escape }), fallback);
    assert.equal(relativeLogPathStaysUnderRoot(root, escape), false);
    assert.equal(
      repoLogPath(root, { configured: join("sub", "..", "trace.jsonl") }),
      join(root, "trace.jsonl"),
      "an internal .. that stays under the root is allowed",
    );
  } finally {
    cleanup(root);
  }
});

test("repoMainRoot returns the bare repo's own dir", () => {
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "csm-bare-")));
  try {
    git(["init", "--bare", "--quiet"], bare);
    assert.equal(repoMainRoot(bare), bare, "bare repo has no main worktree; use its dir");
    assert.equal(repoMainRoot(bare), repoCommonDir(bare));
    assert.equal(repoLogPath(bare), join(bare, ".agents", "logs", "trace.jsonl"));
  } finally {
    cleanup(bare);
  }
});

test("result is identical regardless of process.cwd()", () => {
  const root = makeRepo();
  const elsewhere = makeRepo();
  const originalCwd = process.cwd();
  try {
    const fromInside = repoMainRoot(root);
    process.chdir(elsewhere);
    assert.notEqual(process.cwd(), root);
    const withExplicitRoot = repoMainRoot(root);
    assert.equal(withExplicitRoot, fromInside);
    assert.equal(repoLogPath(root), join(fromInside, ".agents", "logs", "trace.jsonl"));
  } finally {
    process.chdir(originalCwd);
    cleanup(elsewhere, root);
  }
});

test("non-git roots get distinct per-repo fallback logs under the state home", () => {
  const nonGitA = realpathSync(mkdtempSync(join(tmpdir(), "csm-non-git-a-")));
  const nonGitB = realpathSync(mkdtempSync(join(tmpdir(), "csm-non-git-b-")));
  const xdg = realpathSync(mkdtempSync(join(tmpdir(), "csm-xdg-")));
  const originalXdg = process.env.XDG_STATE_HOME;
  try {
    process.env.XDG_STATE_HOME = xdg;
    const logA = repoLogPath(nonGitA);
    const logB = repoLogPath(nonGitB);
    assert.equal(repoMainRoot(nonGitA), repoCommonDir(nonGitA), "per-repo fallback common dir");
    assert.notEqual(logA, logB, "distinct non-git roots resolve distinct logs");
    assert.equal(logA, repoLogPath(nonGitA), "resolution is stable");
    assert.ok(logA.startsWith(xdg), "fallback stays under the state home");
    assert.ok(logA.endsWith(join(".agents", "logs", "trace.jsonl")));
    assert.ok(logA.startsWith(repoCommonDir(nonGitA)), "log lives under the per-repo dir");
  } finally {
    if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdg;
    cleanup(nonGitA, nonGitB, xdg);
  }
});
