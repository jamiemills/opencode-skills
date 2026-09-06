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
//       Use --no-setup for a Git-only worktree.
//   node scripts/wt-session.mjs list [--root <repo>]
//   node scripts/wt-session.mjs merge <goal-slug> [--push] [--root <repo>]
//   node scripts/wt-session.mjs nuke <goal-slug> [--force] [--root <repo>]
//   node scripts/wt-session.mjs prune [--force] [--root <repo>]
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
    push: false,
    force: false,
    setup: true,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") args.dir = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--push") args.push = true;
    else if (a === "--force") args.force = true;
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

export function worktreeBase(root, dirArg) {
  if (dirArg) return path.resolve(dirArg);
  return path.join(os.homedir(), "csm-wt");
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

export function mergeWorktree(root, slug, { push = false } = {}) {
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
  if (push) {
    if (!hasRemote) throw new Error("no origin remote — cannot push");
    git(root, ["push", "origin", "main"]);
  }
  return { branch, pushed: push && hasRemote };
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
      const tip = git(root, ["rev-parse", `refs/heads/${branch}`]);
      const merged = tip === git(root, ["rev-parse", "refs/heads/main"]);
      if (!merged && !force)
        throw new Error(
          `branch ${branch} is not merged into main — merge it first or pass --force`,
        );
      git(root, ["branch", "-D", branch]);
      return { dir: null, branch };
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
    // clean up the stale registration so `worktree remove` can proceed.
    git(root, ["worktree", "prune"]);
    return { dir: entry.dir, branch, pruned: true };
  }
  if (status !== "" && !force)
    throw new Error(`worktree ${entry.dir} has uncommitted changes — commit/stash or pass --force`);
  // Merged means tip-equal to main: the helper always merges ff-only, so after
  // a merge the branch tip IS main's tip. A branch created from main with no
  // new commits is also tip-equal — trivially merged, nothing to lose — so the
  // guard only protects branches that actually contain commits not in main
  // (--merged alone would wrongly consider ancestors merged, so compare tips).
  const branchTip = gitOk(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
    ? git(root, ["rev-parse", `refs/heads/${branch}`])
    : null;
  const merged = branchTip !== null && branchTip === git(root, ["rev-parse", "refs/heads/main"]);
  if (!merged && !force)
    throw new Error(`branch ${branch} is not merged into main — merge it first or pass --force`);
  git(root, ["worktree", "remove", ...(force ? ["--force"] : []), entry.dir]);
  // Branch second (git refuses to delete a checked-out branch). If this step
  // fails, the state is recoverable: rerunning nuke takes the branch-only
  // cleanup path above instead of dying on 'no worktree found'.
  if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    try {
      git(root, ["branch", "-D", branch]);
    } catch (err) {
      console.error(`warning: branch ${branch} kept (${err.message.split("\n")[0]}) — rerun nuke`);
    }
  }
  return { dir: entry.dir, branch };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolveRoot(args.root);
  try {
    if (args.action === "create") {
      if (!args.slug || !SLUG_RE.test(args.slug))
        throw new Error("usage: wt-session create <goal-slug> (lowercase, hyphens)");
      const { dir, branch } = createWorktree(root, args.slug, worktreeBase(root, args.dir));
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
      if (!args.slug) throw new Error("usage: wt-session merge <goal-slug> [--push]");
      const { branch, pushed } = mergeWorktree(root, args.slug, { push: args.push });
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
      const { dir, branch, pruned } = removeWorktree(root, args.slug, { force: args.force });
      console.log(pruned ? `pruned stale worktree registration ${dir}` : `removed worktree ${dir}`);
      console.log(`deleted branch ${branch}`);
    } else {
      throw new Error(
        `usage: wt-session <create|list|merge|nuke|prune> [args] (see header for details)`,
      );
    }
  } catch (err) {
    process.stderr.write(`wt-session: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
