// Hermetic tests for the registry-driven cleanup command
// (scripts/wt-session.mjs `cleanup` + scripts/lib/temp-registry.mjs).
// Every fixture is a throwaway git repo / temp dir under os.tmpdir(); nothing
// in the real repository (or the real ~/csm-wt root) is ever touched. Git
// subprocesses only; no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  cleanup,
  createWorktree,
  flushTraces,
  isAllowlistedTempDir,
  isDirUnder,
  mergeWorktree,
} from "../scripts/wt-session.mjs";
import {
  list as listRegistry,
  register,
  registryPath,
  unregister,
} from "../scripts/lib/temp-registry.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-repo-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "t@test"]);
  git(root, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return root;
}

function makeManagedRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-managed-"));
}

// A clean managed worktree whose wt/<slug> branch has been ff-merged into main.
function makeMergedWorktree(root, managedRoot, slug) {
  const { dir, branch } = createWorktree(root, slug, managedRoot);
  fs.writeFileSync(path.join(dir, `${slug}.txt`), "work");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", slug]);
  mergeWorktree(root, slug);
  return { dir, branch };
}

function makeAllowlistedTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "csm-cleanup-"));
}

test("registry register/unregister/list deduplicate by absolute path and are idempotent", () => {
  const root = makeRepo();
  try {
    register({ kind: "tempdir", path: "/tmp/csm-a" }, root);
    register({ kind: "tempdir", path: "/tmp/csm-a", runId: "r2" }, root);
    const entries = listRegistry(root);
    assert.equal(entries.length, 1, "re-registering a path updates in place");
    assert.equal(entries[0].runId, "r2");
    assert.ok(entries[0].ts.endsWith("Z"), "ts is UTC");
    assert.equal(unregister("/tmp/csm-a", root), true);
    assert.equal(unregister("/tmp/csm-a", root), false, "unregister is idempotent");
    assert.deepEqual(listRegistry(root), []);
    assert.ok(fs.existsSync(registryPath(root)), "state file written atomically");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup dry-run removes nothing but reports eligible targets", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const tempDir = makeAllowlistedTempDir();
  try {
    const { dir, branch } = makeMergedWorktree(root, managedRoot, "drygo");
    register({ kind: "worktree", path: dir, branch }, root);
    register({ kind: "tempdir", path: tempDir }, root);

    const result = cleanup(root, { apply: false, managedRoot });
    assert.equal(result.removed.length, 2, "both targets reported eligible");
    assert.ok(
      result.removed.every((r) => r.planned === true),
      "dry-run marks planned",
    );
    assert.ok(fs.existsSync(dir), "dry-run left the worktree");
    assert.ok(fs.existsSync(tempDir), "dry-run left the temp dir");
    assert.equal(listRegistry(root).length, 2, "dry-run leaves the registry intact");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup --apply removes an eligible managed worktree and an allowlisted temp dir", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const tempDir = makeAllowlistedTempDir();
  try {
    const { dir, branch } = makeMergedWorktree(root, managedRoot, "applygo");
    register({ kind: "worktree", path: dir, branch }, root);
    register({ kind: "tempdir", path: tempDir }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 2);
    assert.equal(result.refused.length, 0);
    assert.ok(!fs.existsSync(dir), "managed worktree removed");
    assert.ok(!fs.existsSync(tempDir), "allowlisted temp dir removed");
    assert.deepEqual(listRegistry(root), [], "registry entries cleared after removal");
    assert.ok(git(root, ["worktree", "list"]).includes(root), "main checkout intact after cleanup");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup refuses foreign, non-allowlisted, and non-wt targets and leaves them in place", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-outside-"));
  const notAllowed = fs.mkdtempSync(path.join(os.tmpdir(), "not-allowlisted-"));
  try {
    // Worktree registered outside the managed root -> refused before any git work.
    register({ kind: "worktree", path: outsideDir, branch: "wt/foreign" }, root);

    // Non-allowlisted temp dir -> refused.
    register({ kind: "tempdir", path: notAllowed }, root);

    // Real worktree under the managed root but on a non-wt branch -> refused.
    const sideDir = path.join(managedRoot, "side");
    git(root, ["branch", "side-branch"]);
    git(root, ["worktree", "add", sideDir, "side-branch"]);
    register({ kind: "worktree", path: sideDir, branch: "side-branch" }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 0, "nothing eligible to remove");
    assert.equal(result.refused.length, 3, "all three targets refused");
    assert.ok(fs.existsSync(outsideDir), "foreign worktree path untouched");
    assert.ok(fs.existsSync(notAllowed), "non-allowlisted temp dir untouched");
    assert.ok(fs.existsSync(sideDir), "non-wt worktree untouched");
    assert.equal(listRegistry(root).length, 3, "refused entries stay registered");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(notAllowed, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup tolerates a registry path that no longer exists and clears its entry", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const ghostWorktree = path.join(managedRoot, "ghost");
    const ghostTemp = path.join(os.tmpdir(), `csm-ghost-${process.pid}-${Date.now()}`);
    register({ kind: "worktree", path: ghostWorktree, branch: "wt/ghost" }, root);
    register({ kind: "tempdir", path: ghostTemp }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.refused.length, 0, "missing paths are tolerated, not refused");
    assert.equal(result.tolerated.length, 2, "both missing entries tolerated");
    assert.deepEqual(listRegistry(root), [], "stale registry entries cleared");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup refuses an unmerged managed worktree and leaves it in place", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const { dir, branch } = createWorktree(root, "unmerged", managedRoot);
    fs.writeFileSync(path.join(dir, "feature.txt"), "work");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "unmerged"]);
    register({ kind: "worktree", path: dir, branch }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 0, "unmerged worktree not removed");
    assert.equal(result.refused.length, 1, "unmerged worktree refused");
    assert.match(result.refused[0].reason, /not merged into main/);
    assert.ok(fs.existsSync(dir), "unmerged worktree left in place");
    assert.equal(listRegistry(root).length, 1, "refused entry stays registered");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup refuses a dirty managed worktree and leaves it in place", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const { dir, branch } = makeMergedWorktree(root, managedRoot, "dirtygo");
    fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
    register({ kind: "worktree", path: dir, branch }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 0, "dirty worktree not removed");
    assert.equal(result.refused.length, 1, "dirty worktree refused");
    assert.match(result.refused[0].reason, /dirty/);
    assert.ok(fs.existsSync(dir), "dirty worktree left in place");
    assert.equal(listRegistry(root).length, 1, "refused entry stays registered");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup refuses a detached-HEAD registration and leaves it in place", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const detachedDir = path.join(managedRoot, "head-check");
    git(root, ["worktree", "add", "--detach", detachedDir, "HEAD"]);
    register({ kind: "worktree", path: detachedDir, branch: "wt/head-check" }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 0, "detached registration not removed");
    assert.equal(result.refused.length, 1, "detached registration refused");
    assert.match(result.refused[0].reason, /detached or foreign/);
    assert.ok(fs.existsSync(detachedDir), "detached worktree left in place");
    assert.equal(listRegistry(root).length, 1, "refused entry stays registered");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a cleanup refusal writes a trace entry", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-outside-"));
  try {
    register({ kind: "worktree", path: outsideDir, branch: "wt/foreign" }, root);
    cleanup(root, { apply: true, managedRoot });
    await flushTraces();

    const logsDir = path.join(root, ".agents", "logs");
    const files = fs.existsSync(logsDir)
      ? fs.readdirSync(logsDir).filter((f) => f.endsWith("trace.jsonl"))
      : [];
    assert.ok(files.length >= 1, "a refusal trace file was written");
    const text = files.map((f) => fs.readFileSync(path.join(logsDir, f), "utf8")).join("");
    assert.match(text, /"action":"cleanup-refuse"/, "refusal trace line present");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup dry-run leaves a missing-path registry entry intact", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const ghostWorktree = path.join(managedRoot, "ghost");
    const ghostTemp = path.join(os.tmpdir(), `csm-ghost-${process.pid}-${Date.now()}`);
    register({ kind: "worktree", path: ghostWorktree, branch: "wt/ghost" }, root);
    register({ kind: "tempdir", path: ghostTemp }, root);

    const before = listRegistry(root);
    const result = cleanup(root, { apply: false, managedRoot });
    assert.equal(result.tolerated.length, 2, "missing paths reported in dry-run");
    assert.ok(
      result.tolerated.every((r) => r.planned === true),
      "dry-run marks missing entries planned",
    );
    assert.deepEqual(listRegistry(root), before, "dry-run changed nothing on disk");
    assert.equal(before.length, 2, "both stale entries still registered");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("path/allowlist helpers are segment-safe", () => {
  assert.equal(isDirUnder("/root/a/b", "/root/a"), true);
  assert.equal(isDirUnder("/root/ab", "/root/a"), false, "prefix collision is not containment");
  assert.equal(isDirUnder("/root/a", "/root/a"), false, "equal paths are not under");
  assert.equal(isAllowlistedTempDir("/tmp/csm-x"), true);
  assert.equal(isAllowlistedTempDir("/tmp/opencode/csm-y"), true);
  assert.equal(isAllowlistedTempDir("/tmp/not-allowed"), false);
  assert.equal(isAllowlistedTempDir("/tmp/csm-"), false, "bare allowlist prefix is not a dir");
});
