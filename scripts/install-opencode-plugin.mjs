#!/usr/bin/env node
"use strict";

// T003 (PART B): idempotent installer for the opencode continuation plugin.
//
// It installs the FULL plugin dependency set -- the wrapper csm-continue.js and
// its relative import target csm-continue-core.mjs -- into a target plugin
// directory (default ~/.config/opencode/plugins). It never runs on import and
// never auto-installs: without --apply it is a read-only dry run. A second
// --apply is a byte-identical no-op (unchanged files are skipped, not rewritten).
// The result is a machine-readable JSON summary on stdout.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The dependency set: the wrapper and the module it imports relatively. Both
// must land together or the installed wrapper's relative import breaks.
export const PLUGIN_FILES = Object.freeze(["csm-continue.js", "csm-continue-core.mjs"]);
export const DEFAULT_TARGET = path.join(os.homedir(), ".config", "opencode", "plugins");
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE = path.join(HERE, "opencode-plugin");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function parseArgs(argv) {
  const opts = { mode: "dry-run", target: DEFAULT_TARGET, source: DEFAULT_SOURCE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") opts.target = argv[i + 1];
    else if (arg === "--source") opts.source = argv[i + 1];
    else if (arg === "--apply") opts.mode = "apply";
    else if (arg === "--dry-run") opts.mode = "dry-run";
  }
  return opts;
}

function publicFile(file) {
  const { content: _content, ...rest } = file;
  return rest;
}

// Read-only: compute, per file, whether the target is missing, different, or
// already byte-identical. Never touches the target directory.
export async function planInstall({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET } = {}) {
  const files = [];
  const missing = [];
  for (const name of PLUGIN_FILES) {
    const sourcePath = path.join(source, name);
    if (!existsSync(sourcePath)) {
      missing.push(name);
      continue;
    }
    const content = await readFile(sourcePath);
    const targetPath = path.join(target, name);
    const targetHash = existsSync(targetPath) ? sha256(await readFile(targetPath)) : null;
    const sourceHash = sha256(content);
    files.push({
      name,
      source: sourcePath,
      target: targetPath,
      sourceHash,
      targetHash,
      bytes: content.length,
      action: targetHash === sourceHash ? "unchanged" : "install",
      content,
    });
  }
  return { source, target, files, missing };
}

export async function applyInstall(plan) {
  await mkdir(plan.target, { recursive: true });
  const results = [];
  let installed = 0;
  let unchanged = 0;
  for (const file of plan.files) {
    if (file.action === "unchanged") {
      unchanged += 1;
      results.push({ name: file.name, action: "unchanged", hash: file.sourceHash });
      continue;
    }
    await writeFile(file.target, file.content);
    installed += 1;
    results.push({ name: file.name, action: "install", hash: file.sourceHash });
  }
  return { installed, unchanged, results };
}

export async function runInstallCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const plan = await planInstall(opts);
  const base = {
    ok: plan.missing.length === 0,
    dryRun: opts.mode !== "apply",
    source: plan.source,
    target: plan.target,
    files: plan.files.map(publicFile),
    missing: plan.missing,
  };
  if (plan.missing.length > 0) {
    process.stdout.write(`${JSON.stringify({ ...base, action: "missing-source" })}\n`);
    return 1;
  }
  if (opts.mode !== "apply") {
    const changed = plan.files.filter((file) => file.action === "install").length;
    process.stdout.write(
      `${JSON.stringify({
        ...base,
        action: changed > 0 ? "install" : "noop",
        installed: 0,
        unchanged: plan.files.length - changed,
        changed,
      })}\n`,
    );
    return 0;
  }
  const applied = await applyInstall(plan);
  process.stdout.write(
    `${JSON.stringify({
      ...base,
      dryRun: false,
      action: applied.installed > 0 ? "install" : "noop",
      installed: applied.installed,
      unchanged: applied.unchanged,
      changed: applied.installed,
      results: applied.results,
    })}\n`,
  );
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(await runInstallCli());
