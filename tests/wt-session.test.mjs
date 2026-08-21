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
