#!/usr/bin/env node
"use strict";

// Non-destructive checkout-hygiene guard (worktree discipline).
//
// The shared main checkout is the live skills directory and can hold other
// sessions' uncommitted artifacts (plans, research, progress, scratch files).
// This guard only READS `git status`; it never stages, modifies, deletes,
// checks out, or stashes anything. The default invocation is warn-only and
// exits 0 even when uncommitted paths exist; `--strict` is the sole opt-in
// that exits non-zero.
//
// When it sees uncommitted paths in the shared main checkout it recommends
// the sanctioned remedy: foreign write work belongs in a dedicated
// `wt/<slug>` worktree (one goal per worktree), never swept into the shared
// checkout. See AGENTS.md -> Parallel sessions and docs/worktree-hygiene.md.
//
// Usage:
//   node scripts/check-checkout-hygiene.mjs [--root <repo>] [--strict] [--quiet]
//
// Exit: 0 by default (warn only); 1 only with --strict when at least one
//       uncommitted path is present; 2 on usage or git failure.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function gitText(rootDir, args) {
  const r = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function isLinkedWorktree(rootDir) {
  const gitDir = gitText(rootDir, ["rev-parse", "--absolute-git-dir"]);
  const commonDir = gitText(rootDir, ["rev-parse", "--git-common-dir"]);
  if (gitDir === null || commonDir === null) return false;
  return path.resolve(gitDir) !== path.resolve(rootDir, commonDir);
}

// Reads the checkout's uncommitted paths without touching them. Returns
// { available, reason, linkedWorktree, tracked, untracked }. `tracked` holds
// index/worktree changes to tracked files; `untracked` holds `??` paths.
export function detectCheckoutHygiene(rootDir) {
  const base = {
    available: false,
    reason: null,
    linkedWorktree: false,
    tracked: [],
    untracked: [],
  };
  if (!fs.existsSync(path.join(rootDir, ".git"))) {
    return { ...base, reason: "not a git checkout" };
  }
  const r = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { ...base, reason: (r.stderr || "git status failed").trim() || "git status failed" };
  }
  const tracked = [];
  const untracked = [];
  for (const line of r.stdout.split("\n")) {
    if (line.trim() === "") continue;
    const code = line.slice(0, 2);
    const rel = line.slice(3).trim();
    if (code === "??") untracked.push(rel);
    else tracked.push(rel);
  }
  return {
    available: true,
    reason: null,
    linkedWorktree: isLinkedWorktree(rootDir),
    tracked,
    untracked,
  };
}

export function formatCheckoutHygiene(rootDir, report) {
  if (!report.available) return [`checkout hygiene: skipped (${report.reason})`];
  const total = report.tracked.length + report.untracked.length;
  const kind = report.linkedWorktree ? "linked worktree" : "shared main checkout";
  if (total === 0) return [`checkout hygiene: clean (${kind})`];
  const scope = report.linkedWorktree
    ? "they belong to this wt/<slug> worktree's own goal"
    : "treat any path you did not create as foreign";
  const remedy = report.linkedWorktree
    ? "keep write work in this wt/<slug> worktree and stage only owned paths here"
    : "foreign uncommitted artifacts belong in a dedicated wt/<slug> worktree (AGENTS.md -> Parallel sessions)";
  const lines = [
    `WARN checkout hygiene: ${total} uncommitted path(s) in the ${kind} — ${scope}; do not stage, sweep, or delete paths you did not create (worktree discipline).`,
    `checkout hygiene: ${remedy}; see docs/worktree-hygiene.md.`,
  ];
  for (const rel of report.tracked) lines.push(`  tracked change: ${rel}`);
  for (const rel of report.untracked) lines.push(`  untracked: ${rel}`);
  lines.push(
    "checkout hygiene: warning only by default — nothing was modified; --strict makes this non-zero.",
  );
  return lines;
}

function parseArgs(argv) {
  const args = { root: process.cwd(), strict: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") args.root = path.resolve(argv[++i]);
    else if (a === "--strict") args.strict = true;
    else if (a === "--quiet") args.quiet = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = detectCheckoutHygiene(args.root);
  if (!args.quiet) for (const line of formatCheckoutHygiene(args.root, report)) console.log(line);
  if (args.strict && report.available && report.tracked.length + report.untracked.length > 0) {
    process.exit(1);
  }
}

let isMain = false;
if (process.argv[1]) {
  try {
    isMain =
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    isMain = false;
  }
}

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
