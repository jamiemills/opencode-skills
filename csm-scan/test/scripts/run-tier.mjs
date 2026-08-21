#!/usr/bin/env node
// csm-scan tier runner (T003).
//
// Runs one of the S/M/L test tiers from the tier manifest in tiers.mjs:
//
//   node test/scripts/run-tier.mjs s      # S tier, default (parallel) concurrency
//   node test/scripts/run-tier.mjs m      # M tier, serial
//   node test/scripts/run-tier.mjs l      # L tier, serial
//   node test/scripts/run-tier.mjs all    # whole suite, serial (authoritative mode)
//
// S runs with Node's default parallel concurrency; M/L/all run serial with
// `--test-concurrency=1` because parallel mode can race filesystem-heavy
// fixture tests. `all` is exactly the authoritative command
// (`node --test --test-concurrency=1`) with no file list of its own.
//
// Every invocation first asserts that tiers.mjs holds a complete,
// non-overlapping partition of the current test/*.test.mjs file set. The
// manifest is deliberately frozen AFTER T002 (legacy-pipeline retirement);
// until then tiers.mjs is an explicit placeholder and this runner fails
// loudly instead of silently running nothing.
//
// Works from any cwd (paths resolve against this file's location). Node >= 22.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Same inert guard as coverage-gate.mjs: `node --test` discovery picks up
// every .mjs under test/ — including this script — and would execute it as a
// test file. In that context (NODE_TEST_CONTEXT set by the runner) the tier
// runner stays inert; it only runs when invoked directly.
if (process.env.NODE_TEST_CONTEXT !== undefined && process.env.NODE_TEST_CONTEXT !== "") {
  process.exit(0);
}

import { S, M, L } from "./tiers.mjs";

const SCAN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TIERS = { s: S, m: M, l: L };

function fail(message) {
  console.error(`run-tier: FAIL — ${message}`);
  console.error("run-tier: Nothing was executed.");
  process.exitCode = 1;
}

function usage() {
  console.error("Usage: node test/scripts/run-tier.mjs <s|m|l|all>");
  process.exitCode = 1;
}

function discoverTestFiles() {
  return readdirSync(join(SCAN_ROOT, "test"))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `test/${name}`)
    .toSorted();
}

// Assert tiers.mjs is a complete, non-overlapping partition of the current
// test file set. The placeholder (empty arrays) fails the non-empty check.
function assertManifestPartition() {
  const current = discoverTestFiles();
  const entries = [...S, ...M, ...L].toSorted();

  if (entries.length === 0) {
    fail(
      "tier manifest is not frozen yet — tiers.mjs placeholder is empty. " +
        "Freeze it from the POST-T002 test file set (Wave 3) before running tiers.",
    );
    return false;
  }

  const seen = new Map();
  let overlaps = false;
  for (const [tier, label] of [
    ["s", "S"],
    ["m", "M"],
    ["l", "L"],
  ]) {
    for (const entry of TIERS[tier]) {
      if (seen.has(entry)) {
        console.error(
          `run-tier: manifest overlap — ${entry} listed in ${seen.get(entry)} and ${label}`,
        );
        overlaps = true;
      }
      seen.set(entry, label);
    }
  }

  const unknown = entries.filter((entry) => !current.includes(entry));
  const missing = current.filter((entry) => !seen.has(entry));

  if (overlaps || unknown.length > 0 || missing.length > 0) {
    if (unknown.length > 0) {
      console.error(`run-tier: manifest references files that do not exist: ${unknown.join(", ")}`);
    }
    if (missing.length > 0) {
      console.error(`run-tier: manifest does not cover existing test files: ${missing.join(", ")}`);
    }
    fail(
      `tier manifest is not a complete non-overlapping partition ` +
        `(${current.length} current test files, ${seen.size} manifest entries).`,
    );
    return false;
  }

  return true;
}

const tier = process.argv[2];
if (tier === undefined || (tier !== "all" && !(tier in TIERS))) {
  usage();
} else if (assertManifestPartition()) {
  const serial = tier === "s" ? [] : ["--test-concurrency=1"];
  const files = tier === "all" ? [] : TIERS[tier].map((entry) => join(SCAN_ROOT, entry));
  const args = ["--test", ...serial, ...files];

  const child = spawn(process.execPath, args, { cwd: SCAN_ROOT, stdio: "inherit" });
  process.exitCode = await new Promise((resolveExit) => {
    child.on("error", (error) => {
      console.error(`run-tier: failed to start the suite: ${error.message}`);
      resolveExit(1);
    });
    child.on("close", resolveExit);
  });
}
