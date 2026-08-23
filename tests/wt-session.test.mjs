// Hermetic tests for the worktree-session helper (scripts/wt-session.mjs).
// Each test builds a throwaway git repo under os.tmpdir() and exercises the
// exported functions against it via --root-style direct calls; nothing in the
// real repository is touched. Git subprocesses only; no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  createWorktree,
  pruneWorktrees,
  listWorktrees,
  mergeWorktree,
  removeWorktree,
} from "../scripts/wt-session.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "t@test"]);
  git(root, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return root;
}

test("createWorktree adds a worktree on wt/<slug> and listWorktrees shows it", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-base-"));
  try {
    const { dir, branch } = createWorktree(root, "goal-one", base);
    assert.equal(branch, "wt/goal-one");
    assert.ok(fs.existsSync(path.join(dir, "seed.txt")), "worktree has the repo content");
    const listing = listWorktrees(root);
    assert.ok(listing.includes(dir), "listing contains the new worktree");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createWorktree refuses a duplicate slug", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-base-"));
  try {
    createWorktree(root, "dup", base);
    assert.throws(() => createWorktree(root, "dup", base), /already exists/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeWorktree rebases and fast-forwards main; refuses non-main checkout", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-base-"));
  try {
    const { dir } = createWorktree(root, "goal-two", base);
    fs.writeFileSync(path.join(dir, "feature.txt"), "work");
    git(dir, ["add", "feature.txt"]);
    git(dir, ["commit", "-m", "feature"]);
    const { branch } = mergeWorktree(root, "goal-two");
    assert.equal(branch, "wt/goal-two");
    assert.ok(fs.existsSync(path.join(root, "feature.txt")), "main has the merged file");
    assert.throws(() => mergeWorktree(root, "missing"), /does not exist/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeWorktree refuses dirty and committed-unmerged, then removes cleanly after merge; an empty branch nukes safely", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-base-"));
  try {
    const { dir } = createWorktree(root, "goal-three", base);
    fs.writeFileSync(path.join(dir, "feature.txt"), "work");
    git(dir, ["add", "feature.txt"]);
    git(dir, ["commit", "-m", "feature"]);
    fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
    assert.throws(() => removeWorktree(root, "goal-three"), /uncommitted changes/);
    fs.unlinkSync(path.join(dir, "dirty.txt"));
    assert.throws(() => removeWorktree(root, "goal-three"), /not merged/);
    const { branch } = mergeWorktree(root, "goal-three");
    const { dir: removed } = removeWorktree(root, "goal-three");
    assert.equal(removed, dir);
    assert.equal(branch, "wt/goal-three");
    assert.ok(!fs.existsSync(dir), "worktree directory removed");
    const listing = listWorktrees(root);
    assert.ok(!listing.includes(dir), "listing no longer contains the removed worktree");
    const empty = createWorktree(root, "goal-empty", base);
    const { dir: emptyRemoved } = removeWorktree(root, "goal-empty");
    assert.equal(
      emptyRemoved,
      empty.dir,
      "an unadvanced branch has nothing to lose and nukes safely",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeWorktree refuses to remove the main checkout", () => {
  const root = makeRepo();
  try {
    assert.throws(() => removeWorktree(root, "main"), /main checkout/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeWorktree fails closed when the branch exists but no worktree has it", () => {
  const root = makeRepo();
  const base = path.join(root, ".base");
  try {
    createWorktree(root, "orphan", base);
    // Simulate a manual `git worktree remove` (or an interrupted nuke):
    // the branch survives, the worktree registration goes away.
    execFileSync("git", ["-C", root, "worktree", "remove", "--force", path.join(base, "orphan")]);
    const mainBefore = git(root, ["rev-parse", "refs/heads/main"]);
    assert.throws(() => mergeWorktree(root, "orphan"), /no worktree has wt\/orphan/);
    // Main's SHA must be untouched — the old fallback rebased inside the
    // live checkout before failing.
    assert.equal(git(root, ["rev-parse", "refs/heads/main"]), mainBefore);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeWorktree deletes the branch and tolerates a branch without worktree", () => {
  const root = makeRepo();
  const base = path.join(root, ".base");
  try {
    const { dir } = createWorktree(root, "gone", base);
    removeWorktree(root, "gone", { force: true });
    assert.ok(!fs.existsSync(dir), "worktree dir removed");
    // The branch must actually be gone — the old flow only asserted the dir.
    let exists = true;
    try {
      git(root, ["rev-parse", "--verify", "--quiet", "refs/heads/wt/gone"]);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "branch deleted by nuke");

    // A leftover branch with no worktree is cleaned up by nuke instead of
    // erroring with 'no worktree found'.
    fs.writeFileSync(path.join(root, "x.txt"), "x");
    git(root, ["add", "x.txt"]);
    git(root, ["commit", "-m", "x"]);
    git(root, ["branch", "wt/leftover"]);
    const result = removeWorktree(root, "leftover");
    assert.equal(result.branch, "wt/leftover");
    let stillThere = true;
    try {
      git(root, ["rev-parse", "--verify", "--quiet", "refs/heads/wt/leftover"]);
    } catch {
      stillThere = false;
    }
    assert.equal(stillThere, false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pruneWorktrees reaps detached and foreign registrations, spares managed ones", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-prune-base-"));
  try {
    // Managed wt/<slug> worktree: must survive.
    const managed = createWorktree(root, "keeper", base);

    // Foreign branch worktree: pruned.
    const foreignDir = path.join(base, "foreign");
    git(root, ["branch", "side-branch"]);
    git(root, ["worktree", "add", foreignDir, "side-branch"]);

    // Detached HEAD safety holder (the flagged Aug-20 pattern): pruned.
    const detachedDir = path.join(base, "head-check");
    git(root, ["worktree", "add", "--detach", detachedDir, "HEAD"]);

    // Dirty foreign worktree is skipped without --force.
    fs.writeFileSync(path.join(foreignDir, "dirty.txt"), "x");

    let result = pruneWorktrees(root);
    assert.ok(
      result.skipped.some((sk) => sk.dir === foreignDir && /dirty/.test(sk.reason)),
      "dirty foreign worktree skipped without --force",
    );
    assert.ok(
      result.removed.some((r) => r.dir === detachedDir && r.kind === "detached"),
      "detached holder removed",
    );
    assert.ok(fs.existsSync(managed.dir), "managed worktree untouched");
    assert.ok(fs.existsSync(foreignDir), "dirty foreign dir still present pre-force");

    result = pruneWorktrees(root, { force: true });
    assert.ok(
      result.removed.some((r) => r.dir === foreignDir),
      "dirty foreign removed with force",
    );
    assert.ok(!fs.existsSync(detachedDir), "detached dir gone");
    assert.ok(!fs.existsSync(foreignDir), "foreign dir gone");

    // Main checkout and managed registration never touched.
    const listing = listWorktrees(root);
    assert.ok(listing.includes(root), "main checkout intact");
    assert.ok(listing.includes(managed.dir), "managed wt/ worktree survives prune");

    // A registration whose directory vanished is pruned too.
    const orphaned = createWorktree(root, "ghost", base);
    fs.rmSync(orphaned.dir, { recursive: true, force: true });
    result = pruneWorktrees(root);
    assert.ok(
      result.removed.some((r) => r.dir === orphaned.dir && r.kind === "missing"),
      "missing-dir registration pruned",
    );
    assert.ok(!listWorktrees(root).includes(orphaned.dir), "orphaned entry gone from listing");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
