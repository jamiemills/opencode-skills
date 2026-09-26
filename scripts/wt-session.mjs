#!/usr/bin/env node
"use strict";

// Worktree session helper (zero-dependency, git only). One goal per worktree:
// parallel csm-grill/plan/build/research sessions each get their own working
// tree, index, and branch so they cannot sweep, block, or red each other's
// commits or gates. The main checkout stays on `main` (it is the live skills
// dir); merge worktree branches serially and re-run the gate after merging.
//
// Usage:
//   node scripts/wt-session.mjs create <goal-slug> [--dir <base>] [--root <repo>]
//       Creates the worktree and installs locked root/skill tooling by default.
//       Use --no-setup for a Git-only worktree. Before creating, it auto-sweeps
//       stale managed resources with the same fail-closed policy as `cleanup`
//       (never --force; refusals are reported, never guessed).
//   node scripts/wt-session.mjs list [--root <repo>]
//   node scripts/wt-session.mjs merge <goal-slug> [--push] [--reconcile] [--root <repo>]
//       Merges only when the main checkout has no uncommitted changes to the
//       paths the ff-only merge would update (fail-closed by default). The
//       explicit --reconcile opt-in instead stashes tracked foreign edits to a
//       named stash, merges, and restores them after the check-only post-merge
//       verification; untracked collisions always refuse (never auto-stashed).
//   node scripts/wt-session.mjs nuke <goal-slug> [--force] [--root <repo>]
//   node scripts/wt-session.mjs prune [--force] [--root <repo>]
//   node scripts/wt-session.mjs cleanup [--apply] [--root <repo>]
//   node scripts/wt-session.mjs leftover [--strict] [--root <repo>]
//
// `leftover` is READ-ONLY: it REPORTS (never deletes) managed wt/<slug>
// worktrees still registered under the managed root and local wt/* branches
// that are fully merged into main and checked out nowhere. It is warn-only by
// default (exit 0); `--strict` is the sole opt-in that exits non-zero. The
// managed root can be overridden for tests with `--managed-root <dir>`.
//
// `cleanup` is registry-driven and DRY-RUN by default: with no `--apply` it
// deletes nothing and prints what it would remove. It removes only a registered
// managed worktree under the managed root (branch ^wt/, clean, merged into
// main) and a registered temp dir under /tmp/csm-* or /tmp/opencode/csm-*;
// everything else is refused and skipped. See scripts/lib/temp-registry.mjs.
//
// `prune` reaps worktree registrations the helper does not manage: detached
// HEAD checkouts (e.g. safety holders left by history rewrites), foreign
// branches, and registrations whose directory is already gone. Managed
// wt/<slug> worktrees and the main checkout are never touched.
//
// `--root` overrides the repo (default: the git top-level of the cwd), so
// tests can point the helper at a throwaway repository.

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  list as listRegistry,
  register as registerTemp,
  unregister as unregisterTemp,
} from "./lib/temp-registry.mjs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// Trace logging is best-effort and optional: scripts/lib/trace-log.mjs is owned
// by T001 and may be absent in an isolated worktree, so load it dynamically and
// never let tracing break a worktree/cleanup operation.
let appendTrace = null;
let repoLogPath = null;
try {
  ({ appendTrace } = await import("./lib/trace-log.mjs"));
  ({ repoLogPath } = await import("./lib/repo-state.mjs"));
} catch {
  appendTrace = null;
  repoLogPath = null;
}

// The configured trace-log override is ALSO best-effort: trace-config.mjs may
// be absent alongside the modules above. When present it resolves the same
// path the default writer uses, so every worktree appends to the configured or
// main-root default log.
let resolveTraceLogPath = null;
try {
  ({ resolveTraceLogPath } = await import("./lib/trace-config.mjs"));
} catch {
  resolveTraceLogPath = null;
}

// F1.2: the run id is recorded in the shared trace log, so a hostile or
// malformed CSM_RUN_ID must still be a safe value. Accept only a canonical id
// ([A-Za-z0-9._-]+, no ".."); otherwise fall back to a generated id.
function safeRunId(raw) {
  if (typeof raw === "string" && /^[A-Za-z0-9._-]+$/.test(raw) && !raw.includes("..")) return raw;
  return `run-${Date.now().toString(36)}-${process.pid.toString(36)}`;
}

const RUN_ID = safeRunId(process.env.CSM_RUN_ID || "wt-session");
const pendingTraces = new Set();

function appendSessionTrace(root, action, target, justification, outcome) {
  if (appendTrace === null) return null;
  let promise;
  try {
    const ts = new Date().toISOString();
    promise = (async () => {
      let configured = null;
      if (resolveTraceLogPath !== null) {
        try {
          configured = await resolveTraceLogPath({ root, env: process.env });
        } catch {
          configured = null;
        }
      }
      // appendTrace being non-null guarantees its paired repoLogPath import
      // succeeded (both load in the one try above), so the old per-run fallback
      // filename was unreachable dead code.
      const file = repoLogPath(root, { configured });
      return appendTrace(
        { ts, runId: RUN_ID, actor: "wt-session", action, target, justification, outcome },
        { file },
      );
    })();
  } catch {
    // tracing must never break worktree/cleanup operations
    return null;
  }
  const guarded = promise.catch(() => {});
  pendingTraces.add(guarded);
  guarded.finally(() => pendingTraces.delete(guarded));
  return guarded;
}

// Let fire-and-forget trace writes drain before the process exits so a trace
// is not lost (and its rejection is always handled).
export async function flushTraces() {
  await Promise.allSettled(pendingTraces);
}

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Untrimmed git output. `git status --porcelain` uses a fixed two-column XY
// code whose leading space is significant (" M" staged clean vs "M " staged),
// so trimming (as git() does) shifts every column and corrupts path parsing.
function gitRaw(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOk(repoRoot, args) {
  try {
    git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = {
    action: null,
    slug: null,
    dir: null,
    root: null,
    managedRoot: null,
    push: false,
    force: false,
    setup: true,
    apply: false,
    strict: false,
    reconcile: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") args.dir = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--managed-root") args.managedRoot = argv[++i];
    else if (a === "--push") args.push = true;
    else if (a === "--force") args.force = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--strict") args.strict = true;
    else if (a === "--reconcile") args.reconcile = true;
    else if (a === "--no-setup") args.setup = false;
    else rest.push(a);
  }
  args.action = rest[0] || null;
  args.slug = rest[1] || null;
  return args;
}

function resolveRoot(rootArg) {
  if (rootArg) return path.resolve(rootArg);
  return git(process.cwd(), ["rev-parse", "--show-toplevel"]);
}

// The managed worktree root: cleanup only ever considers worktree registry
// entries that resolve strictly under this directory. `--dir` overrides it when
// creating, but the default is the single constant cleanup trusts.
export const MANAGED_WORKTREE_ROOT = path.join(os.homedir(), "csm-wt");

export function worktreeBase(root, dirArg) {
  if (dirArg) return path.resolve(dirArg);
  return MANAGED_WORKTREE_ROOT;
}

export function createWorktree(root, slug, base) {
  const branch = `wt/${slug}`;
  if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    throw new Error(
      `branch ${branch} already exists — pick another goal slug or merge/nuke it first`,
    );
  }
  const dir = path.join(base, slug);
  if (
    gitOk(root, ["worktree", "list", "--porcelain"]) &&
    git(root, ["worktree", "list", "--porcelain"])
      .split("\n")
      .some((line) => line === `worktree ${dir}`)
  ) {
    throw new Error(`worktree ${dir} already exists`);
  }
  git(root, ["worktree", "add", dir, "-b", branch]);
  return { dir, branch };
}

function setupWorktree(dir) {
  const env = { ...process.env, CI: process.env.CI || "true" };
  const node22 = path.join(dir, "scripts", "with-node22.mjs");
  const run = (cwd, args) =>
    execFileSync(process.execPath, [node22, "--exec", "pnpm", ...args], {
      cwd,
      env,
      stdio: "inherit",
    });
  if (!fs.existsSync(path.join(dir, "package.json")))
    return { root: false, browse: false, hooks: false };
  run(dir, ["install", "--frozen-lockfile", "--ignore-scripts"]);
  const browse = fs.existsSync(path.join(dir, "csm-browse", "package.json"));
  if (browse)
    run(path.join(dir, "csm-browse"), ["install", "--frozen-lockfile", "--ignore-scripts"]);
  execFileSync(process.execPath, [node22, "--exec", "node", "scripts/install-hooks.mjs"], {
    cwd: dir,
    env,
    stdio: "inherit",
  });
  return { root: true, browse, hooks: true };
}

export function listWorktrees(root) {
  return git(root, ["worktree", "list"]);
}

// S6 merge-conflict guard (serialize-by-abort). A rebase + ff-only merge can
// silently produce a tree the gate can never bless when BOTH the local main
// branch and the wt/<slug> branch changed skill-source or regenerated payload
// paths since their merge-base: those trees are derived (bootstrap/package +
// payload-index.json mirror csm-* sources; csm-orchestrate/capabilities.json
// and the README matrix region are generated), so git-level auto-resolution
// would mix two parallel edits of the same generated content. Detect that up
// front — before any rebase mutation — and abort with a deterministic message.
const S6_GUARD_PATHS = ["csm-*", "bootstrap", "csm-orchestrate/capabilities.json", "README.md"];
const S6_GUARD_PATHS_HELP =
  "skill sources (csm-*/), the bootstrap payload mirror (bootstrap/ incl. payload-index.json), csm-orchestrate/capabilities.json, and the README matrix region";

function gitDiffDirty(root, a, b, paths) {
  try {
    git(root, ["diff", "--quiet", a, b, "--", ...paths]);
    return false;
  } catch (err) {
    // `git diff --quiet` exits 1 exactly when the trees differ on <paths>.
    if (err.status === 1) return true;
    throw err;
  }
}

// True when `root` is a real skills checkout (the bootstrap/package payload
// mirror, csm-*/SKILL.md sources, and scripts/check-suite.mjs are present).
// The S6 post-merge verification is gated on this so hermetic temp-repo tests
// never spawn pack-bootstrap/check-suite against synthetic fixtures.
function hasSkillSourceStructure(root) {
  if (!fs.existsSync(path.join(root, "bootstrap", "package"))) return false;
  if (!fs.existsSync(path.join(root, "scripts", "check-suite.mjs"))) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return false;
  }
  return entries.some(
    (name) => name.startsWith("csm-") && fs.existsSync(path.join(root, name, "SKILL.md")),
  );
}

// S6 post-merge verification in the main checkout — CHECK-ONLY (R7: never a
// repairing pack write, which would dirty the main tree mid-merge). Runs only
// after an ff-only merge changed skill-source/generated guard paths. Skipped
// loudly when the main tree is dirty (direct-on-main work must not verify a
// moving tree) or the root is not a real skills checkout; a failed check is
// reported loudly and leaves the tree untouched. Returns { verified } for
// observability/callers; skips report verified:false with a reason.
function verifyMergedMain(root) {
  const status = gitOk(root, ["status", "--porcelain"]) ? git(root, ["status", "--porcelain"]) : "";
  if (status !== "") {
    console.error(
      "post-merge verification skipped: main checkout is dirty (R7) — commit or stash before merging the next worktree; tree left untouched",
    );
    return { verified: false, reason: "dirty" };
  }
  if (!hasSkillSourceStructure(root)) {
    console.error(
      `post-merge verification skipped: ${root} is not a skills checkout (no bootstrap/package + csm-*/SKILL.md + scripts/check-suite.mjs); no pack/check-suite run`,
    );
    return { verified: false, reason: "no-structure" };
  }
  // verifyPayloadParity: read-only comparison of the committed bootstrap/
  // payload mirror against what the csm-* sources would generate. Imported
  // from the target root's own pack-bootstrap.mjs — its CLI main never runs.
  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { verifyPayloadParity } from "./scripts/pack-bootstrap.mjs";\nawait verifyPayloadParity();`,
      ],
      { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
    );
    console.log("post-merge verification: payload parity OK");
  } catch (err) {
    console.error(
      `post-merge verification FAILED (payload parity): ${String(err.message).split("\n")[0]} — check-only, no repair write performed`,
    );
    return { verified: false, reason: "parity" };
  }
  try {
    execFileSync(process.execPath, ["scripts/check-suite.mjs"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
    console.log("post-merge verification: check-suite OK");
  } catch (err) {
    console.error(
      `post-merge verification FAILED (check-suite): ${String(err.message).split("\n")[0]} — check-only, no repair write performed`,
    );
    return { verified: false, reason: "check-suite" };
  }
  return { verified: true };
}

// --- T010: clean-main merge precondition -----------------------------------
// The dirty-main / --no-verify failure mode: a worktree merge ran into a main
// checkout still holding another session's uncommitted edits, and the foreign
// changes rode into the merge/commit behind a `--no-verify` bypass. Before the
// ff-only merge we collect (1) the paths that merge would update in main and
// (2) every path dirty in the main working tree — tracked index+worktree AND
// untracked, so a new file the merge would overwrite is caught too. When the
// two sets intersect the DEFAULT is fail-closed refusal (commit/stash first);
// `--reconcile` is the explicit opt-in to the non-destructive stash pattern for
// tracked foreign edits only (untracked collisions always refuse). The S6 guard
// still runs before this, and the post-merge verification is unchanged.
function parsePorcelainPaths(porcelain, { onlyUntracked = false } = {}) {
  const paths = new Set();
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    const code = line.slice(0, 2);
    if (onlyUntracked !== (code === "??")) continue;
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow !== -1) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) {
      try {
        p = JSON.parse(p);
      } catch {
        p = p.slice(1, -1);
      }
    }
    paths.add(p);
  }
  return paths;
}

function mainUpdatePaths(root, branch) {
  return new Set(
    git(root, ["diff", "--name-only", "--no-renames", "main", branch])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

// Refuse, or (with `reconcile`) stash the tracked foreign edits, when the main
// checkout has uncommitted changes to paths the merge would update. Returns the
// named stash message when a reconcile stash was created, else null.
function guardDirtyMain(root, slug, branch, { reconcile = false } = {}) {
  const updatePaths = mainUpdatePaths(root, branch);
  if (updatePaths.size === 0) return null;
  const porcelain = gitRaw(root, ["status", "--porcelain"]);
  const trackedDirty = parsePorcelainPaths(porcelain);
  const untrackedDirty = parsePorcelainPaths(porcelain, { onlyUntracked: true });
  const conflicts = [...trackedDirty, ...untrackedDirty].filter((p) => updatePaths.has(p));
  if (conflicts.length === 0) return null;
  const untracked = conflicts.filter((p) => untrackedDirty.has(p));
  const trackedConflicts = conflicts.filter((p) => !untrackedDirty.has(p));
  if (!reconcile)
    throw new Error(
      `main checkout is dirty for paths this merge would update (${conflicts.join(", ")}) — ` +
        `commit or stash them, then retry; or re-run with --reconcile to stash tracked foreign edits to a named stash and restore them after the merge`,
    );
  if (untracked.length > 0)
    throw new Error(
      `--reconcile refusing: untracked path(s) in main would be overwritten (${untracked.join(", ")}) — move them aside first (untracked files are never auto-stashed)`,
    );
  const stashMsg = `wt-session reconcile ${slug} ${new Date().toISOString()}`;
  git(root, ["stash", "push", "-m", stashMsg, "--", ...trackedConflicts]);
  console.error(
    `reconcile: stashed foreign tracked edits to "${stashMsg}" (${trackedConflicts.join(", ")}); re-applied after the merge (a conflicting re-apply preserves the named stash)`,
  );
  return { stashMsg, paths: trackedConflicts };
}

// Best-effort, non-destructive restore of a reconcile stash after the merge.
// A clean pop drops the stash; a conflicting pop leaves the named stash intact
// (git keeps it) and we reset ONLY the conflicting paths back to the merged
// state so the tree is clean and the operator can `git stash pop` manually.
function restoreReconcileStash(root, reconcileStash) {
  if (!reconcileStash) return;
  try {
    git(root, ["stash", "pop"]);
    console.log(`reconcile: restored foreign edits from "${reconcileStash.stashMsg}"`);
  } catch {
    try {
      git(root, ["checkout", "-f", "HEAD", "--", ...reconcileStash.paths]);
    } catch {
      /* best effort — the named stash is preserved either way */
    }
    console.error(
      `reconcile: could not re-apply foreign edits from "${reconcileStash.stashMsg}" (conflict) — the named stash is preserved; resolve with: git stash pop`,
    );
  }
}

export function mergeWorktree(root, slug, { push = false, reconcile = false } = {}) {
  const branch = `wt/${slug}`;
  if (!gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    throw new Error(`branch ${branch} does not exist — nothing to merge`);
  }
  // Guard BEFORE any mutation: rebasing inside the main checkout would
  // rewrite the live tree's history when the worktree is missing.
  const cur = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (cur !== "main")
    throw new Error(`main checkout is on "${cur}" — switch it to main before merging`);
  const wt = git(root, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .find(
      (d) =>
        gitOk(root, ["-C", d, "rev-parse", "--abbrev-ref", "HEAD"]) &&
        git(root, ["-C", d, "rev-parse", "--abbrev-ref", "HEAD"]) === branch,
    );
  if (!wt)
    throw new Error(
      `no worktree has ${branch} checked out — recreate it (create ${slug}) or nuke the branch`,
    );
  const hasRemote = gitOk(root, ["remote", "get-url", "origin"]);
  if (hasRemote) {
    try {
      git(root, ["fetch", "origin"]);
    } catch (err) {
      console.error(`fetch origin failed (${err.message}) — continuing with local base`);
    }
  }
  const base = hasRemote ? "origin/main" : "main";
  // S6 guard — AFTER base resolution and BEFORE the rebase (which would mutate
  // the wt history): when both main and wt/<slug> changed skill-source or
  // generated paths since their merge-base, the rebase + ff-only merge would
  // fight over derived trees. Abort deterministically with zero mutation.
  // Using merge-base(base, branch) (the same base the rebase uses) prevents
  // mis-fires when local main is simply behind origin/main.
  const mb = git(root, ["merge-base", base, branch]);
  const mainTouchedGuard = gitDiffDirty(root, mb, "main", S6_GUARD_PATHS);
  const wtTouchedGuard = gitDiffDirty(root, mb, branch, S6_GUARD_PATHS);
  if (mainTouchedGuard && wtTouchedGuard)
    throw new Error(
      `merge guard (S6): both main and ${branch} changed ${S6_GUARD_PATHS_HELP} since ${mb} — refusing to merge (serialize-by-abort). Resolve in the worktree, then retry: git rebase ${base}, regenerate pack + capabilities + README matrix (node scripts/pack-bootstrap.mjs), commit`,
    );
  // T010 clean-main precondition — BEFORE the rebase (zero mutation on refusal):
  // refuse a merge whose updated paths collide with uncommitted main edits, or
  // stash those tracked edits behind the explicit --reconcile opt-in.
  let reconcileStash = guardDirtyMain(root, slug, branch, { reconcile });
  try {
    try {
      git(wt, ["rebase", base]);
    } catch (err) {
      try {
        git(wt, ["rebase", "--abort"]);
        console.error("rebase failed and was aborted — worktree restored to its pre-rebase state");
      } catch {
        console.error(
          "rebase failed; automatic abort failed — run: git -C <worktree> rebase --abort",
        );
      }
      throw err;
    }
    const preMergeMain = git(root, ["rev-parse", "refs/heads/main"]);
    git(root, ["merge", "--ff-only", branch]);
    const postMergeMain = git(root, ["rev-parse", "refs/heads/main"]);
    // S6 post-merge step: skill-source/generated merges get a CHECK-ONLY
    // verification in the main checkout (never a repairing pack write — R7).
    if (
      postMergeMain !== preMergeMain &&
      gitDiffDirty(root, preMergeMain, postMergeMain, S6_GUARD_PATHS)
    )
      verifyMergedMain(root);
  } catch (err) {
    // Never strand a reconcile stash on a failed rebase/merge: put the foreign
    // edits back before propagating the error.
    restoreReconcileStash(root, reconcileStash);
    reconcileStash = null;
    throw err;
  }
  // T010: restore any stashed foreign tracked edits AFTER the check-only
  // verification (so it still ran against a clean tree), never losing them.
  restoreReconcileStash(root, reconcileStash);
  if (push) {
    if (!hasRemote) throw new Error("no origin remote — cannot push");
    git(root, ["push", "origin", "main"]);
  }
  return { dir: wt, branch, pushed: push && hasRemote };
}

// --- T008: safe branch reaping ---------------------------------------------
// A branch is "fully merged" when every commit it points at is reachable from
// main (`git merge-base --is-ancestor`). This is stricter than `git branch
// --merged` (which wrongly treats any ancestor as merged) and is the exact
// safety property nuke needs before deleting the branch.
function isBranchMergedIntoMain(root, branch) {
  return gitOk(root, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, "main"]);
}

// True when any registered worktree currently has `branch` checked out. A nuke
// must never delete a branch that is live in another worktree.
function isBranchCheckedOut(root, branch) {
  const ref = `refs/heads/${branch}`;
  return worktreeRecords(root).some((r) => !r.detached && r.branch === ref);
}

// Delete a branch without ever forcing an unverified path: `git branch -d`
// (safe delete) unless the caller explicitly forced. Failures are reported and
// never fatal so a partial nuke stays recoverable (rerun nuke).
function deleteBranch(root, branch, { force = false } = {}) {
  try {
    git(root, ["branch", force ? "-D" : "-d", branch]);
    return true;
  } catch (err) {
    console.error(
      `warning: branch ${branch} kept (${String(err.message).split("\n")[0]}) — rerun nuke`,
    );
    return false;
  }
}

export function removeWorktree(root, slug, { force = false } = {}) {
  const branch = `wt/${slug}`;
  const lines = git(root, ["worktree", "list", "--porcelain"]).split("\n");
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("worktree ")) {
      entries.push({ dir: lines[i].slice("worktree ".length), branch: null });
    } else if (lines[i].startsWith("branch ")) {
      entries[entries.length - 1].branch = lines[i].slice("branch ".length);
    }
  }
  const entry = entries.find((e) => e.branch === `refs/heads/${branch}`);
  if (!entry) {
    if (slug === "main") throw new Error("refusing to remove the main checkout");
    // The branch may exist without a worktree (removed manually, or a nuke
    // interrupted between its two steps). Clean up the branch instead of
    // dying with a confusing 'no worktree found'.
    if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
      // Same unmerged-protection as the worktree path: a branch holding
      // commits absent from main must not die via the recovery path.
      if (!isBranchMergedIntoMain(root, branch) && !force)
        throw new Error(
          `branch ${branch} is not merged into main — merge it first or pass --force`,
        );
      if (isBranchCheckedOut(root, branch))
        throw new Error(`branch ${branch} is checked out in another worktree — refusing to delete`);
      const branchDeleted = deleteBranch(root, branch, { force });
      return { dir: null, branch, branchDeleted };
    }
    throw new Error(`no worktree for ${slug} found`);
  }
  if (path.resolve(entry.dir) === path.resolve(root))
    throw new Error("refusing to remove the main checkout");
  let status = "";
  if (gitOk(root, ["-C", entry.dir, "status", "--porcelain"])) {
    status = git(root, ["-C", entry.dir, "status", "--porcelain"]);
  } else {
    // Registration exists but the directory is gone (pruned manually):
    // clean up the stale registration so `worktree remove` can proceed, then
    // reap a merged, unchecked-out branch if one survives.
    git(root, ["worktree", "prune"]);
    let branchDeleted = false;
    if (
      isBranchMergedIntoMain(root, branch) &&
      !isBranchCheckedOut(root, branch) &&
      gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
    )
      branchDeleted = deleteBranch(root, branch, { force });
    return { dir: entry.dir, branch, pruned: true, branchDeleted };
  }
  if (status !== "" && !force)
    throw new Error(`worktree ${entry.dir} has uncommitted changes — commit/stash or pass --force`);
  // Fully merged (ancestor-of-main) guard. The helper always merges ff-only, so
  // a merged branch is an ancestor of main; a branch with commits main lacks is
  // refused unless --force.
  if (!isBranchMergedIntoMain(root, branch) && !force)
    throw new Error(`branch ${branch} is not merged into main — merge it first or pass --force`);
  git(root, ["worktree", "remove", ...(force ? ["--force"] : []), entry.dir]);
  // Branch second (git refuses to delete a checked-out branch). Never delete a
  // branch live in another worktree; if deletion fails the state is recoverable
  // (rerunning nuke takes the branch-only path above).
  let branchDeleted = false;
  if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    if (isBranchCheckedOut(root, branch)) {
      console.error(`warning: branch ${branch} is checked out in another worktree — kept`);
    } else {
      branchDeleted = deleteBranch(root, branch, { force });
    }
  }
  return { dir: entry.dir, branch, branchDeleted };
}

// F8-12: reap foreign/stale worktree registrations. The Aug-20 history purge
// left a detached-HEAD safety worktree (/tmp/head-check) registered forever:
// prune never fires while its directory exists, and nuke cannot match it
// (detached = no branch). Policy: main checkout and managed wt/<slug>
// worktrees are untouchable here; everything else is removed when clean,
// with --force for dirty ones, plus one `worktree prune` pass for
// registrations whose directory is already gone.
export function pruneWorktrees(root, { force = false } = {}) {
  const lines = git(root, ["worktree", "list", "--porcelain"]).split("\n");
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("worktree ")) {
      entries.push({ dir: lines[i].slice("worktree ".length), branch: null, detached: false });
    } else if (lines[i].startsWith("branch ")) {
      entries[entries.length - 1].branch = lines[i].slice("branch ".length);
    } else if (lines[i].startsWith("detached")) {
      entries[entries.length - 1].detached = true;
    }
  }
  const removed = [];
  const skipped = [];
  for (const entry of entries) {
    if (path.resolve(entry.dir) === path.resolve(root)) continue;
    let exists = true;
    try {
      fs.statSync(entry.dir);
    } catch {
      exists = false;
    }
    if (!exists) {
      // A registration whose directory is gone is stale no matter whose it
      // was — clear it (the branch, if any, survives for nuke-style cleanup).
      removed.push({ dir: entry.dir, branch: entry.branch, kind: "missing" });
      continue;
    }
    if (path.resolve(entry.dir) !== path.resolve(root)) {
      const managed =
        !entry.detached &&
        typeof entry.branch === "string" &&
        entry.branch.startsWith("refs/heads/wt/");
      if (managed) continue;
    }
    const status = gitOk(root, ["-C", entry.dir, "status", "--porcelain"])
      ? git(root, ["-C", entry.dir, "status", "--porcelain"])
      : "";
    if (status !== "" && !force) {
      skipped.push({ dir: entry.dir, branch: entry.branch, reason: "dirty — rerun with --force" });
      continue;
    }
    git(root, ["worktree", "remove", "--force", entry.dir]);
    removed.push({
      dir: entry.dir,
      branch: entry.branch,
      kind: entry.detached ? "detached" : "foreign",
    });
  }
  // One prune pass clears every registration whose directory is gone.
  git(root, ["worktree", "prune", "-v"]);
  return { removed, skipped };
}

// --- T004: safe, registry-driven cleanup -----------------------------------
// Cleanup is DRY-RUN by default and removes only two classes of resource:
//   1. a registry "worktree" entry whose absolute path resolves strictly under
//      MANAGED_WORKTREE_ROOT, whose branch matches ^wt/, that git still lists
//      as that exact non-detached worktree, that is clean, and whose branch is
//      an ancestor of main;
//   2. a registry "tempdir" entry whose path resolves under the allowlist
//      (/tmp/csm-… or /tmp/opencode/csm-…) and that is not the current process
//      directory (or an ancestor of it).
// Everything else is REFUSED, never guessed. Removal uses no --force, tolerates
// paths that already vanished, is idempotent, and traces each removal/refusal.

const TEMP_DIR_ALLOWLIST = ["/tmp/csm-", "/tmp/opencode/csm-"];

// Strict directory containment: equal paths and path-prefix collisions
// (/root/a vs /root/ab) are NOT "under".
export function isDirUnder(target, parent) {
  const t = path.resolve(target);
  const p = path.resolve(parent);
  return t !== p && t.startsWith(p + path.sep);
}

export function isAllowlistedTempDir(target) {
  const t = path.resolve(target);
  return TEMP_DIR_ALLOWLIST.some((prefix) => t.startsWith(prefix) && t.length > prefix.length);
}

function worktreeRecords(root) {
  const lines = git(root, ["worktree", "list", "--porcelain"]).split("\n");
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("worktree ")) {
      records.push({ dir: lines[i].slice("worktree ".length), branch: null, detached: false });
    } else if (lines[i].startsWith("branch ")) {
      records[records.length - 1].branch = lines[i].slice("branch ".length);
    } else if (lines[i].startsWith("detached")) {
      records[records.length - 1].detached = true;
    }
  }
  return records;
}

export function cleanup(root, { apply = false, managedRoot = MANAGED_WORKTREE_ROOT } = {}) {
  const mainRoot = path.resolve(root);
  const mRoot = path.resolve(managedRoot);
  const ownDir = process.cwd();
  const removed = [];
  const refused = [];
  const tolerated = [];

  const refuse = (entry, target, reason) => {
    refused.push({ kind: entry.kind, path: target, reason });
    appendSessionTrace(
      root,
      "cleanup-refuse",
      target,
      `${entry.kind} refused: ${reason}`,
      "refused",
    );
  };
  const clear = (entry, target, outcome) => {
    // F2.1: a dry-run must not mutate the registry or write a removal trace.
    // Report the stale/missing entry and change nothing on disk.
    if (apply) {
      unregisterTemp(target, root);
      appendSessionTrace(root, "cleanup-remove", target, `${entry.kind} already gone`, outcome);
    }
    tolerated.push({ kind: entry.kind, path: target, outcome, planned: !apply });
  };

  const entries = listRegistry(root);
  for (const entry of entries) {
    const target = path.resolve(entry.path);

    if (entry.kind === "worktree") {
      if (target === mainRoot) {
        refuse(entry, target, "main checkout");
        continue;
      }
      if (!isDirUnder(target, mRoot)) {
        refuse(entry, target, `outside managed worktree root ${mRoot}`);
        continue;
      }
      if (typeof entry.branch !== "string" || !entry.branch.startsWith("wt/")) {
        refuse(entry, target, "branch does not match ^wt/");
        continue;
      }
      if (!fs.existsSync(target)) {
        clear(entry, target, "already-missing");
        continue;
      }
      const record = worktreeRecords(root).find((r) => path.resolve(r.dir) === target);
      if (!record) {
        refuse(entry, target, "not a registered git worktree (foreign/detached)");
        continue;
      }
      if (record.detached || record.branch !== `refs/heads/${entry.branch}`) {
        refuse(entry, target, "git worktree branch is detached or foreign");
        continue;
      }
      if (!gitOk(root, ["-C", target, "status", "--porcelain"])) {
        refuse(entry, target, "worktree status unavailable");
        continue;
      }
      if (git(root, ["-C", target, "status", "--porcelain"]) !== "") {
        refuse(entry, target, "worktree is dirty");
        continue;
      }
      if (!gitOk(root, ["merge-base", "--is-ancestor", entry.branch, "main"])) {
        refuse(entry, target, `branch ${entry.branch} is not merged into main`);
        continue;
      }
      if (!apply) {
        removed.push({ kind: "worktree", path: target, branch: entry.branch, planned: true });
        continue;
      }
      try {
        git(root, ["worktree", "remove", target]);
      } catch (err) {
        refuse(entry, target, `git worktree remove failed: ${String(err.message).split("\n")[0]}`);
        continue;
      }
      unregisterTemp(target, root);
      removed.push({ kind: "worktree", path: target, branch: entry.branch });
      appendSessionTrace(
        root,
        "cleanup-remove",
        target,
        "clean, merged managed worktree",
        "removed",
      );
      continue;
    }

    // kind === "tempdir"
    if (!isAllowlistedTempDir(target)) {
      refuse(entry, target, "not under temp allowlist (/tmp/csm-* or /tmp/opencode/csm-*)");
      continue;
    }
    if (target === ownDir || isDirUnder(ownDir, target)) {
      refuse(entry, target, "current process directory");
      continue;
    }
    if (!fs.existsSync(target)) {
      clear(entry, target, "already-missing");
      continue;
    }
    if (!apply) {
      removed.push({ kind: "tempdir", path: target, planned: true });
      continue;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      refuse(entry, target, `fs.rm failed: ${String(err.message).split("\n")[0]}`);
      continue;
    }
    unregisterTemp(target, root);
    removed.push({ kind: "tempdir", path: target });
    appendSessionTrace(root, "cleanup-remove", target, "allowlisted temp dir", "removed");
  }

  return { apply, removed, refused, tolerated };
}

// T008: `create` auto-sweeps stale managed resources before allocating a new
// worktree. This is EXACTLY `cleanup --apply` (never --force): the same
// fail-closed policy, registry-driven, so every existing refusal is preserved.
export function sweepStaleResources(root, { managedRoot = MANAGED_WORKTREE_ROOT } = {}) {
  return cleanup(root, { apply: true, managedRoot });
}

// T008: READ-ONLY leftover check. Reports, and never deletes:
//   - managed wt/<slug> worktrees still registered strictly under managedRoot,
//     excluding the active session's own worktree (the one containing the cwd);
//   - local wt/* branches fully merged into main and checked out nowhere.
// It runs only git read commands and fs existence probes; the caller decides
// whether a non-empty report is fatal (warn-only by default).
export function detectLeftovers(root, { managedRoot = MANAGED_WORKTREE_ROOT } = {}) {
  const mRoot = path.resolve(managedRoot);
  const mainRoot = path.resolve(root);
  const cwd = path.resolve(process.cwd());
  const containsCwd = (dir) => {
    const resolved = path.resolve(dir);
    return cwd === resolved || cwd.startsWith(resolved + path.sep);
  };
  const worktrees = [];
  const checkedOut = new Set();
  for (const record of worktreeRecords(root)) {
    if (!record.detached && typeof record.branch === "string") {
      checkedOut.add(
        record.branch.startsWith("refs/heads/")
          ? record.branch.slice("refs/heads/".length)
          : record.branch,
      );
    }
    if (record.detached) continue;
    if (typeof record.branch !== "string" || !record.branch.startsWith("refs/heads/wt/")) continue;
    if (!isDirUnder(record.dir, mRoot)) continue;
    if (containsCwd(record.dir)) continue;
    worktrees.push({
      path: path.resolve(record.dir),
      branch: record.branch.slice("refs/heads/".length),
    });
  }
  const branches = [];
  let refs = [];
  try {
    refs = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/wt"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    refs = [];
  }
  for (const branch of refs) {
    if (checkedOut.has(branch)) continue;
    if (!isBranchMergedIntoMain(root, branch)) continue;
    branches.push({ branch, merged: true });
  }
  return { root: mainRoot, managedRoot: mRoot, worktrees, branches };
}

// Human-readable, read-only leftover report (never a mutation).
export function formatLeftovers(report) {
  const { worktrees = [], branches = [] } = report;
  if (worktrees.length === 0 && branches.length === 0)
    return ["leftover check: none (no managed worktrees or merged wt/ branches remain)"];
  const lines = [
    `WARN leftover check: ${worktrees.length} managed worktree(s) and ${branches.length} merged branch(es) remain`,
  ];
  for (const w of worktrees)
    lines.push(`  leftover worktree: ${w.path} (${w.branch}) (may be active)`);
  for (const b of branches) lines.push(`  leftover merged branch: ${b.branch}`);
  lines.push(
    "leftover check: read-only — nothing was deleted; reap with `wt-session nuke`/`cleanup --apply`",
  );
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    // F6.3: resolveRoot runs git, so it must sit inside the try/catch — a
    // non-git cwd must not produce an unhandled rejection and skip the flush.
    const root = resolveRoot(args.root);
    const managedRoot = args.managedRoot ? path.resolve(args.managedRoot) : MANAGED_WORKTREE_ROOT;
    if (args.action === "create") {
      if (!args.slug || !SLUG_RE.test(args.slug))
        throw new Error("usage: wt-session create <goal-slug> (lowercase, hyphens)");
      // Auto-sweep stale managed resources before allocating the new worktree.
      // Sweep failures are advisory: never block creating the goal worktree.
      try {
        const swept = sweepStaleResources(root, { managedRoot });
        for (const r of swept.removed) console.log(`swept stale ${r.kind} ${r.path}`);
        for (const r of swept.refused)
          console.log(`sweep skipped ${r.kind} ${r.path}: ${r.reason}`);
      } catch (err) {
        console.error(`warning: stale-resource sweep failed (${err.message}) — continuing`);
      }
      const { dir, branch } = createWorktree(root, args.slug, worktreeBase(root, args.dir));
      registerTemp({ kind: "worktree", path: dir, branch, runId: RUN_ID }, root);
      appendSessionTrace(
        root,
        "create-worktree",
        dir,
        `create worktree for ${args.slug}`,
        "created",
      );
      const setup = args.setup ? setupWorktree(dir) : { skipped: true };
      console.log(`created worktree: ${dir}`);
      console.log(`branch: ${branch}`);
      console.log(`setup: ${args.setup ? JSON.stringify(setup) : "skipped (--no-setup)"}`);
      console.log(`run the goal inside the worktree:`);
      console.log(`  cd ${dir}`);
      console.log(`  opencode run "<goal>"   # or csm-grill/csm-plan/csm-build there`);
      console.log(`when done: node scripts/wt-session.mjs merge ${args.slug} [--push]`);
    } else if (args.action === "list") {
      console.log(listWorktrees(root));
    } else if (args.action === "merge") {
      if (!args.slug) throw new Error("usage: wt-session merge <goal-slug> [--push] [--reconcile]");
      const { dir, branch, pushed } = mergeWorktree(root, args.slug, {
        push: args.push,
        reconcile: args.reconcile,
      });
      // F3.1: merging must NOT unregister the worktree — it still exists on
      // disk. Keeping the registry entry lets `cleanup` reap the merged-but-
      // present worktree and preserves interruption safety.
      appendSessionTrace(
        root,
        "merge-worktree",
        dir || branch,
        `merge ${branch} into main`,
        "merged",
      );
      console.log(`merged ${branch} into main (ff-only)`);
      if (pushed) console.log("pushed origin main");
      console.log(`cleanup: node scripts/wt-session.mjs nuke ${args.slug}`);
    } else if (args.action === "prune") {
      const result = pruneWorktrees(root, { force: args.force });
      for (const r of result.removed)
        console.log(
          r.kind === "missing"
            ? `pruned stale registration ${r.dir}`
            : `removed ${r.kind} worktree ${r.dir}`,
        );
      for (const sk of result.skipped) console.log(`skipped ${sk.dir}: ${sk.reason}`);
      if (result.removed.length === 0 && result.skipped.length === 0)
        console.log("nothing to prune");
    } else if (args.action === "nuke") {
      if (!args.slug) throw new Error("usage: wt-session nuke <goal-slug> [--force]");
      const { dir, branch, pruned, branchDeleted } = removeWorktree(root, args.slug, {
        force: args.force,
      });
      unregisterTemp(dir || path.join(worktreeBase(root, args.dir), args.slug), root);
      appendSessionTrace(
        root,
        "nuke-worktree",
        dir || path.join(worktreeBase(root, args.dir), args.slug),
        `nuke worktree ${branch}`,
        pruned ? "pruned" : "removed",
      );
      console.log(pruned ? `pruned stale worktree registration ${dir}` : `removed worktree ${dir}`);
      console.log(branchDeleted ? `deleted branch ${branch}` : `branch ${branch} kept`);
    } else if (args.action === "cleanup") {
      const result = cleanup(root, { apply: args.apply, managedRoot });
      for (const r of result.removed)
        console.log(`${args.apply ? "removed" : "would remove"} ${r.kind} ${r.path}`);
      for (const r of result.tolerated)
        console.log(
          `${args.apply ? "tolerated" : "would tolerate"} missing ${r.kind} ${r.path}` +
            (args.apply ? " (registry entry cleared)" : " (registry entry left intact)"),
        );
      for (const r of result.refused) console.log(`refused ${r.kind} ${r.path}: ${r.reason}`);
      if (
        result.removed.length === 0 &&
        result.refused.length === 0 &&
        result.tolerated.length === 0
      )
        console.log("nothing to clean");
      if (!args.apply && result.removed.length > 0)
        console.log("dry run: re-run with --apply to remove");
    } else if (args.action === "leftover") {
      const report = detectLeftovers(root, { managedRoot });
      for (const line of formatLeftovers(report)) console.log(line);
      if (args.strict && report.worktrees.length + report.branches.length > 0) process.exitCode = 1;
    } else {
      throw new Error(
        `usage: wt-session <create|list|merge|nuke|prune|cleanup|leftover> [args] (see header for details)`,
      );
    }
  } catch (err) {
    process.stderr.write(`wt-session: ${err.message}\n`);
    process.exitCode = 1;
  }
  await flushTraces();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  await main();
}
