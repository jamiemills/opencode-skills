#!/usr/bin/env node
"use strict";

// Single entrypoint for regenerating the repo's generated mirrors in
// dependency order and proving they are fresh. `make regen` / `make precommit`
// call this; the Makefile is owned elsewhere, so the ordered plan below is the
// source of truth.
//
// Order matters: `csm-orchestrate/capabilities.json` digests are recomputed
// first because the bootstrap payload embeds that file, so the payload must be
// repacked afterwards. The trailing freshness gate is the payload + capability
// subset of `scripts/check-suite.mjs` run in-process (the shipped gate has no
// `--quiet` flag), so drift fails this command loudly with a non-zero exit.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildCapabilities } from "./gen-capabilities.mjs";
import { verifyPayloadParity } from "./pack-bootstrap.mjs";
import { checkCommittedPayloadIndex } from "./check-suite.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CAPABILITIES_REL = join("csm-orchestrate", "capabilities.json");
const BOOTSTRAP_DIR = "bootstrap";

// Prefer the repo-local oxfmt binary (works without git, so the idempotence
// test can run against a git-less temp copy); fall back to `pnpm exec oxfmt`
// when node_modules is absent.
export function resolveFmtStep(rootDir = root) {
  const config = `--config=${join(rootDir, ".oxfmtrc.json")}`;
  const bin = join(rootDir, "node_modules", ".bin", "oxfmt");
  if (existsSync(bin)) {
    return { command: bin, args: [config, "--ignore-path=.oxfmtignore", "."] };
  }
  return { command: "pnpm", args: ["exec", "oxfmt", config, "--ignore-path=.oxfmtignore", "."] };
}

// The ordered regen plan. Each step is `{ id, label, command, args }`; callers
// may pin an explicit plan into `runRegen` to dry-run or to exercise a subset.
export function regenPlan(rootDir = root) {
  return [
    { id: "fmt", label: "format repo (oxfmt)", ...resolveFmtStep(rootDir) },
    {
      id: "gen-capabilities",
      label: "regenerate capability digests",
      command: process.execPath,
      args: [join(rootDir, "scripts", "gen-capabilities.mjs")],
    },
    {
      id: "pack-bootstrap",
      label: "regenerate bootstrap payload + index",
      command: process.execPath,
      args: [join(rootDir, "scripts", "pack-bootstrap.mjs")],
    },
  ];
}

// Runs the plan in order, failing on the first non-zero step. Returns the ids
// of the steps that completed.
export function runRegen({
  root: rootDir = root,
  steps = regenPlan(rootDir),
  stdio = "inherit",
} = {}) {
  const completed = [];
  for (const step of steps) {
    const result = spawnSync(step.command, step.args, { cwd: rootDir, stdio, encoding: "utf8" });
    if (result.error) {
      throw new Error(`regen step "${step.id}" failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      throw new Error(
        `regen step "${step.id}" failed with exit code ${result.status}${detail ? `\n${detail}` : ""}`,
      );
    }
    completed.push(step.id);
  }
  return completed;
}

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

// `gen-capabilities.mjs` cannot derive hand-maintained entrypoint digests; the
// live check-suite gate verifies them, so this gate mirrors that check.
function capabilityIssues(rootDir, manifest) {
  const issues = [];
  for (const capability of manifest.skills ?? []) {
    const entrypoint = capability.source?.entrypoint;
    if (entrypoint && capability.source?.libraryDigest) {
      try {
        const actual = sha256(readFileSync(join(rootDir, entrypoint)));
        if (actual !== capability.source.libraryDigest) {
          issues.push(
            `${capability.skill}: entrypoint libraryDigest stale — regenerate ${CAPABILITIES_REL}`,
          );
        }
      } catch {
        issues.push(`${capability.skill}: entrypoint file missing (${entrypoint})`);
      }
    }
  }
  return issues;
}

// Verifies the committed generated mirrors are byte-fresh. Returns
// `{ ok, issues }`; it never writes and never spawns, so it is safe against a
// read-only tree and inside unit tests. `root` must be the canonical checkout:
// capabilities/index checks honor an override, but `verifyPayloadParity`
// resolves payload sources from pack-bootstrap's own module root.
export async function verifyFresh({ root: rootDir = root } = {}) {
  const issues = [];

  let manifest = null;
  try {
    const { text } = await buildCapabilities({ rootOverride: rootDir });
    manifest = JSON.parse(text);
    const committed = await readFile(join(rootDir, CAPABILITIES_REL), "utf8");
    if (text !== committed) {
      issues.push(`${CAPABILITIES_REL} is stale — regenerate it`);
    }
  } catch (err) {
    issues.push(`capabilities freshness check failed: ${err.message}`);
  }
  if (manifest) issues.push(...capabilityIssues(rootDir, manifest));

  try {
    await verifyPayloadParity({ outputRoot: join(rootDir, BOOTSTRAP_DIR) });
  } catch (err) {
    issues.push(`bootstrap payload parity: ${err.message}`);
  }

  try {
    for (const issue of checkCommittedPayloadIndex(rootDir)) {
      issues.push(`bootstrap payload index: ${issue}`);
    }
  } catch (err) {
    issues.push(`bootstrap payload index check failed: ${err.message}`);
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const completed = runRegen();
  const { ok, issues } = await verifyFresh();
  if (!ok) {
    console.error("regen: FAIL — generated artifacts are still stale after regeneration:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(`regen: OK — ${completed.join(" -> ")}; payload + capabilities fresh`);
}

let isMain = false;
if (process.argv[1]) {
  try {
    const self = resolve(fileURLToPath(import.meta.url));
    const invoked = resolve(process.argv[1]);
    isMain = self === invoked;
  } catch {
    isMain = false;
  }
}
if (isMain) await main();

export { CAPABILITIES_REL, BOOTSTRAP_DIR, root };
