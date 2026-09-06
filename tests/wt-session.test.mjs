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

test("createWorktree allows a slug that only shares a path prefix", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-base-"));
  try {
    createWorktree(root, "goal", base);
    const { dir, branch } = createWorktree(root, "goal-extra", base);
    assert.equal(branch, "wt/goal-extra");
    assert.ok(fs.existsSync(dir), "prefix-colliding worktree was created");
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

// --- S6 merge guard + check-only post-merge verification -------------------
// The guard and the post-merge verification fire on SYNTHETIC guard paths
// (csm-a/SKILL.md, bootstrap/payload-index.json) exactly as on real skill
// sources — no bootstrap/package pack structure is needed for the guard, and
// the hermetic structure gate keeps temp-repo tests from ever running
// pack-bootstrap/check-suite (which live only in the real checkout).

function commitFile(root, rel, content, message) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  git(root, ["add", rel]);
  git(root, ["commit", "-m", message]);
}

// Intercept console.log/console.error so tests can assert on the S6 messages
// mergeWorktree prints for post-merge verification skips/results.
function capture(fn) {
  const lines = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const value = fn();
    return { value, lines };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

function assertNoPackWrites(root) {
  assert.equal(
    git(root, ["status", "--porcelain"]),
    "",
    "merge left no untracked/modified debris (no repair writes)",
  );
  assert.ok(
    !fs.existsSync(path.join(root, ".pack-lock")),
    "no .pack-lock created in the main checkout",
  );
  assert.ok(
    !fs.existsSync(path.join(root, "bootstrap", "package")),
    "no bootstrap/package payload mirror created",
  );
}

test("mergeWorktree guard aborts when both main and wt touch synthetic guard paths; no tree mutation", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-base-"));
  try {
    const { dir } = createWorktree(root, "both-sides", base);
    // main advances past the fork point touching a guard path...
    commitFile(root, "csm-a/SKILL.md", "main-side\n", "main touches csm-a/SKILL.md");
    // ...and the wt branch independently touches the same guard path from the
    // common base (seed.txt commit). merge-base(main, wt/both-sides) predates
    // both, so BOTH sides are non-clean on the guard path set.
    commitFile(dir, "csm-a/SKILL.md", "wt-side\n", "wt touches csm-a/SKILL.md");
    assert.notEqual(
      git(root, ["rev-parse", "refs/heads/main"]),
      git(root, ["rev-parse", "refs/heads/wt/both-sides"]),
      "main and wt diverged on the guard path",
    );
    // Record the pre-call tips: the abort must leave BOTH untouched.
    const mainBefore = git(root, ["rev-parse", "refs/heads/main"]);
    const wtBefore = git(root, ["rev-parse", `refs/heads/wt/both-sides`]);

    let err = null;
    try {
      mergeWorktree(root, "both-sides");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "guard must abort the both-sides-touched merge");
    assert.match(err.message, /merge guard \(S6\)/);
    assert.match(err.message, /refusing to merge \(serialize-by-abort\)/);
    assert.match(err.message, /regenerate pack \+ capabilities \+ README matrix/);
    assert.match(err.message, /git rebase main/);
    // Zero mutation: no rebase (wt tip unchanged) and no merge (main unchanged).
    assert.equal(git(root, ["rev-parse", "refs/heads/main"]), mainBefore, "main HEAD unchanged");
    assert.equal(
      git(root, ["rev-parse", `refs/heads/wt/both-sides`]),
      wtBefore,
      "wt branch not rebased by the aborted merge",
    );
    assert.ok(fs.existsSync(path.join(dir, "csm-a", "SKILL.md")), "wt working tree intact");
    assertNoPackWrites(root);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeWorktree lets one-side-touched guard paths merge (wt-only and main-only)", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-base-"));
  try {
    // wt-only touches a guard path -> passes, and the file lands in main.
    const a = createWorktree(root, "wt-guard", base);
    commitFile(a.dir, "csm-a/SKILL.md", "wt-only\n", "wt touches csm-a");
    const { branch: brA } = mergeWorktree(root, "wt-guard");
    assert.equal(brA, "wt/wt-guard");
    assert.ok(fs.existsSync(path.join(root, "csm-a", "SKILL.md")), "merged into main");

    // main-only touches a guard path; wt touches only a non-guard path ->
    // wt side is clean on the guard set, so no guard fire and the merge
    // rebases wt onto the advanced main and fast-forwards.
    const b = createWorktree(root, "main-guard", base);
    commitFile(root, "csm-b/SKILL.md", "main-side\n", "main touches csm-b");
    commitFile(b.dir, "feature.txt", "wt feature\n", "wt touches only feature.txt");
    const { branch: brB } = mergeWorktree(root, "main-guard");
    assert.equal(brB, "wt/main-guard");
    assert.ok(fs.existsSync(path.join(root, "csm-b", "SKILL.md")), "main edit present");
    assert.ok(fs.existsSync(path.join(root, "feature.txt")), "wt feature merged");
    assertNoPackWrites(root);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-merge verification is gated on skill-source merges and never writes in a synthetic repo", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-base-"));
  try {
    // Non-skill-source merge: no verification attempt at all.
    const plain = createWorktree(root, "plain", base);
    commitFile(plain.dir, "docs/notes.md", "docs only\n", "docs-only change");
    const plainOut = capture(() => mergeWorktree(root, "plain"));
    assert.equal(plainOut.value.branch, "wt/plain");
    assert.ok(
      !plainOut.lines.some((l) => l.includes("post-merge verification")),
      "no verification step for a non-skill-source merge",
    );
    assertNoPackWrites(root);

    // Skill-source merge (wt-only touches csm-a/SKILL.md) in a repo WITHOUT the
    // real bootstrap/package structure: the check-only step is reached (guard
    // path changed) but skipped on the hermetic structure gate — no pack runs.
    const skill = createWorktree(root, "skill", base);
    commitFile(skill.dir, "csm-a/SKILL.md", "wt skill\n", "wt touches csm-a");
    const skillOut = capture(() => mergeWorktree(root, "skill"));
    assert.equal(skillOut.value.branch, "wt/skill");
    assert.ok(
      skillOut.lines.some((l) => l.includes("post-merge verification skipped")),
      "verification step ran and reported its skip",
    );
    assert.ok(
      skillOut.lines.some((l) => l.includes("not a skills checkout")),
      "skip reason is the missing real structure",
    );
    assert.ok(
      !skillOut.lines.some((l) => l.includes("payload parity OK") || l.includes("check-suite OK")),
      "no actual pack/check-suite run against synthetic fixtures",
    );
    assertNoPackWrites(root);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-merge verification skips loudly on a dirty main checkout and leaves it untouched", () => {
  const root = makeRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-base-"));
  try {
    const { dir } = createWorktree(root, "dirty-main", base);
    commitFile(dir, "csm-a/SKILL.md", "wt skill\n", "wt touches csm-a");
    // Untracked work in the main checkout (R7): the ff-only merge still
    // succeeds, but the post-merge verification must refuse to run on a dirty
    // tree and must not touch it.
    fs.writeFileSync(path.join(root, "in-progress.txt"), "uncommitted\n");

    const out = capture(() => mergeWorktree(root, "dirty-main"));
    assert.equal(out.value.branch, "wt/dirty-main");
    assert.ok(fs.existsSync(path.join(root, "csm-a", "SKILL.md")), "merge completed");
    assert.ok(
      out.lines.some((l) => l.includes("post-merge verification skipped") && l.includes("dirty")),
      "dirty-tree skip message printed",
    );
    assert.ok(
      !out.lines.some((l) => l.includes("payload parity OK") || l.includes("check-suite OK")),
      "no verification ran on the dirty tree",
    );
    assert.equal(git(root, ["status", "--porcelain"]), "?? in-progress.txt");
    assert.ok(fs.existsSync(path.join(root, "in-progress.txt")), "dirty file untouched");
    assert.ok(
      !fs.existsSync(path.join(root, ".pack-lock")),
      "no .pack-lock created in the main checkout",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
