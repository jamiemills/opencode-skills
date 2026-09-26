// Hermetic tests for the registry-driven cleanup command
// (scripts/wt-session.mjs `cleanup` + scripts/lib/temp-registry.mjs).
// Every fixture is a throwaway git repo / temp dir under os.tmpdir(); nothing
// in the real repository (or the real ~/csm-wt root) is ever touched. Git
// subprocesses only; no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  cleanup,
  createWorktree,
  detectLeftovers,
  flushTraces,
  formatLeftovers,
  isAllowlistedTempDir,
  isDirUnder,
  mergeWorktree,
  removeWorktree,
  sweepStaleResources,
} from "../scripts/wt-session.mjs";
import {
  list as listRegistry,
  register,
  registryDir,
  registryPath,
  unregister,
} from "../scripts/lib/temp-registry.mjs";
import { repoLogPath } from "../scripts/lib/repo-state.mjs";

const WT_SESSION = fileURLToPath(new URL("../scripts/wt-session.mjs", import.meta.url));
const CHECK_HYGIENE = fileURLToPath(
  new URL("../scripts/check-checkout-hygiene.mjs", import.meta.url),
);

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchExists(root, branch) {
  try {
    git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

// Read-only repo fingerprint used to prove a check/path mutated nothing.
function readRepoState(root) {
  return {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain"]),
    worktrees: git(root, ["worktree", "list", "--porcelain"]),
    refs: git(root, ["for-each-ref", "--format=%(refname)"]),
  };
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
    assert.ok(fs.existsSync(registryDir(root)), "per-entry registry directory written");
    assert.ok(!fs.existsSync(registryPath(root)), "legacy single-file registry is no longer used");
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
  // Isolate the config layers the trace writer resolves so the host's real
  // config can never redirect the refusal trace away from the default log.
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "wt-cleanup-config-"));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalHome = process.env.HOME;
  const originalOverride = process.env.CSM_TRACE_LOG;
  try {
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.HOME = configHome;
    delete process.env.CSM_TRACE_LOG;
    register({ kind: "worktree", path: outsideDir, branch: "wt/foreign" }, root);
    cleanup(root, { apply: true, managedRoot });
    await flushTraces();

    const logFile = repoLogPath(root);
    const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    assert.ok(text.length >= 1, "a refusal trace line was written to the shared log");
    assert.match(text, /"action":"cleanup-refuse"/, "refusal trace line present");
  } finally {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalOverride === undefined) delete process.env.CSM_TRACE_LOG;
    else process.env.CSM_TRACE_LOG = originalOverride;
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(configHome, { recursive: true, force: true });
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

// --- T008: create auto-sweep ------------------------------------------------

test("create auto-sweep removes eligible leftovers and preserves every refusal", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-sweep-outside-"));
  try {
    // Eligible: clean, merged managed worktree.
    const merged = makeMergedWorktree(root, managedRoot, "sweepok");
    register({ kind: "worktree", path: merged.dir, branch: merged.branch }, root);

    // Refused: unmerged managed worktree.
    const unmerged = createWorktree(root, "sweepunmerged", managedRoot);
    fs.writeFileSync(path.join(unmerged.dir, "u.txt"), "u");
    git(unmerged.dir, ["add", "."]);
    git(unmerged.dir, ["commit", "-m", "u"]);
    register({ kind: "worktree", path: unmerged.dir, branch: unmerged.branch }, root);

    // Refused: registry entry outside the managed root.
    register({ kind: "worktree", path: outsideDir, branch: "wt/outside" }, root);

    const result = await sweepStaleResources(root, { managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 1, "only the merged leftover is swept");
    assert.equal(result.removed[0].path, merged.dir);
    assert.ok(!fs.existsSync(merged.dir), "merged leftover swept");
    assert.ok(fs.existsSync(unmerged.dir), "unmerged worktree preserved");
    assert.ok(fs.existsSync(outsideDir), "outside-root path preserved");
    assert.ok(
      result.refused.some((r) => /not merged into main/.test(r.reason)),
      "unmerged worktree refused",
    );
    assert.ok(
      result.refused.some((r) => /outside managed worktree root/.test(r.reason)),
      "outside-root entry refused",
    );
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- T008: nuke branch reaping ---------------------------------------------

test("nuke deletes a fully merged branch and refuses an unmerged one", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const merged = makeMergedWorktree(root, managedRoot, "nukemerge");
    const result = removeWorktree(root, "nukemerge");
    assert.equal(result.branchDeleted, true, "merged branch deleted");
    assert.ok(!fs.existsSync(merged.dir), "merged worktree removed");
    assert.equal(branchExists(root, merged.branch), false, "merged branch ref gone");

    // Unmerged branch: refused, both worktree and branch survive.
    const unmerged = createWorktree(root, "nukeunmerged", managedRoot);
    fs.writeFileSync(path.join(unmerged.dir, "feature.txt"), "work");
    git(unmerged.dir, ["add", "."]);
    git(unmerged.dir, ["commit", "-m", "unmerged"]);
    assert.throws(() => removeWorktree(root, "nukeunmerged"), /not merged into main/);
    assert.ok(fs.existsSync(unmerged.dir), "unmerged worktree preserved");
    assert.equal(branchExists(root, unmerged.branch), true, "unmerged branch preserved");
    // The explicit --force path is unchanged and still reaps it.
    const forced = removeWorktree(root, "nukeunmerged", { force: true });
    assert.equal(forced.branchDeleted, true, "force path still deletes the branch");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- T008: read-only leftover check ----------------------------------------

test("leftover check is read-only and reports managed worktrees and merged branches", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const wt = makeMergedWorktree(root, managedRoot, "leftoverwt");
    // A fully merged branch with no worktree: a leftover worth reporting.
    git(root, ["branch", "wt/orphan-merged"]);
    // An unmerged branch must never be reported as a leftover.
    git(root, ["checkout", "-b", "wt/orphan-unmerged"]);
    fs.writeFileSync(path.join(root, "unmerged.txt"), "x");
    git(root, ["add", "unmerged.txt"]);
    git(root, ["commit", "-m", "unmerged orphan"]);
    git(root, ["checkout", "main"]);

    const before = readRepoState(root);
    const report = detectLeftovers(root, { managedRoot });
    assert.equal(report.worktrees.length, 1, "one managed worktree reported");
    assert.equal(report.worktrees[0].path, wt.dir);
    assert.equal(report.worktrees[0].branch, wt.branch);
    assert.deepEqual(
      report.branches.map((b) => b.branch),
      ["wt/orphan-merged"],
      "only the merged orphan branch is reported",
    );
    assert.deepEqual(readRepoState(root), before, "detectLeftovers mutated nothing");
    assert.ok(fs.existsSync(wt.dir), "worktree still present after detection");

    const beforeCli = readRepoState(root);
    const run = runNode(WT_SESSION, ["leftover", "--root", root, "--managed-root", managedRoot]);
    assert.equal(run.status, 0, "warn-only default exits 0");
    assert.match(run.stdout, /leftover worktree:/);
    assert.match(run.stdout, /leftover merged branch: wt\/orphan-merged/);
    assert.deepEqual(readRepoState(root), beforeCli, "leftover CLI mutated nothing");
    assert.ok(fs.existsSync(wt.dir), "CLI left the worktree in place");

    assert.ok(Array.isArray(formatLeftovers(report)), "formatLeftovers is a pure projection");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("leftover --strict exits non-zero only when leftovers remain", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    const clean = runNode(WT_SESSION, [
      "leftover",
      "--root",
      root,
      "--managed-root",
      managedRoot,
      "--strict",
    ]);
    assert.equal(clean.status, 0, "no leftovers: --strict exits 0");

    const wt = makeMergedWorktree(root, managedRoot, "strictleftover");
    const strict = runNode(WT_SESSION, [
      "leftover",
      "--root",
      root,
      "--managed-root",
      managedRoot,
      "--strict",
    ]);
    assert.notEqual(strict.status, 0, "--strict exits non-zero on a leftover");
    assert.ok(fs.existsSync(wt.dir), "strict run deleted nothing");

    const warn = runNode(WT_SESSION, ["leftover", "--root", root, "--managed-root", managedRoot]);
    assert.equal(warn.status, 0, "default run stays warn-only");
    assert.ok(fs.existsSync(wt.dir), "warn run deleted nothing");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("check-checkout-hygiene reports leftovers warn-only and --strict opts in", () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  try {
    makeMergedWorktree(root, managedRoot, "hygieneleftover");
    const warn = runNode(CHECK_HYGIENE, ["--root", root, "--managed-root", managedRoot]);
    assert.equal(warn.status, 0, "hygiene stays warn-only by default");
    assert.match(warn.stdout, /leftover check/);
    const strict = runNode(CHECK_HYGIENE, [
      "--root",
      root,
      "--managed-root",
      managedRoot,
      "--strict",
    ]);
    assert.notEqual(strict.status, 0, "--strict opts into a non-zero exit");
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- T008: guard regression -------------------------------------------------

test("regression guards still refuse main, dirty, unmerged, non-wt, and outside-root targets", async () => {
  const root = makeRepo();
  const managedRoot = makeManagedRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-outside-"));
  try {
    // Main checkout refusal.
    register({ kind: "worktree", path: root, branch: "wt/main" }, root);
    assert.throws(() => removeWorktree(root, "main"), /main checkout/);

    // Unmerged managed worktree.
    const unmerged = createWorktree(root, "guard-unmerged", managedRoot);
    fs.writeFileSync(path.join(unmerged.dir, "f.txt"), "f");
    git(unmerged.dir, ["add", "."]);
    git(unmerged.dir, ["commit", "-m", "f"]);
    register({ kind: "worktree", path: unmerged.dir, branch: unmerged.branch }, root);
    assert.throws(() => removeWorktree(root, "guard-unmerged"), /not merged into main/);

    // Dirty managed worktree.
    const dirty = makeMergedWorktree(root, managedRoot, "guard-dirty");
    fs.writeFileSync(path.join(dirty.dir, "dirty.txt"), "x");
    register({ kind: "worktree", path: dirty.dir, branch: dirty.branch }, root);
    assert.throws(() => removeWorktree(root, "guard-dirty"), /uncommitted changes/);

    // Non-wt branch under the managed root.
    const sideDir = path.join(managedRoot, "guard-side");
    git(root, ["branch", "guard-side-branch"]);
    git(root, ["worktree", "add", sideDir, "guard-side-branch"]);
    register({ kind: "worktree", path: sideDir, branch: "guard-side-branch" }, root);

    // Registry entry outside the managed root.
    register({ kind: "worktree", path: outsideDir, branch: "wt/outside" }, root);

    const result = cleanup(root, { apply: true, managedRoot });
    await flushTraces();
    assert.equal(result.removed.length, 0, "no guarded target removed");
    assert.ok(fs.existsSync(root), "main checkout intact");
    assert.ok(fs.existsSync(unmerged.dir), "unmerged preserved");
    assert.ok(fs.existsSync(dirty.dir), "dirty preserved");
    assert.ok(fs.existsSync(sideDir), "non-wt preserved");
    assert.ok(fs.existsSync(outsideDir), "outside-root preserved");
    const reasons = result.refused.map((r) => r.reason).join("\n");
    assert.match(reasons, /main checkout/);
    assert.match(reasons, /not merged into main/);
    assert.match(reasons, /dirty/);
    assert.match(reasons, /branch does not match \^wt\//);
    assert.match(reasons, /outside managed worktree root/);
  } finally {
    fs.rmSync(managedRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
