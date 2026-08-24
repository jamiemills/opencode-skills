#!/usr/bin/env node
"use strict";

// Zero-dependency gate-baseline recorder (plan T002/J2). Machines the journal
// rule "digests/numbers come from this artifact, never retyped":
//
//   node scripts/record-gate-baseline.mjs --record <gate> <pass-count> <wall-ms>
//       appends {gate, passCount, wallMs, nodeVersion, ts} to
//       .agents/docs/gate-baselines.json (creating dir/file when absent).
//
//   node scripts/record-gate-baseline.mjs --check <gate> <pass-count> <wall-ms>
//       compares pass-count against the LATEST record for that gate, exits
//       non-zero with a deviation message when it differs beyond an optional
//       --tolerance, and warns (never fails) when the baseline is older than
//       30 days.
//
//   node scripts/record-gate-baseline.mjs --check
//       standalone form: runs `node scripts/check-suite.mjs` itself, parses
//       the "N checks" count from its stdout, prints it, and compares against
//       the latest recorded check-suite baseline.
//
// First-baseline policy (journal-learnings A8): the first observed deviation
// is a warning; hard-failing starts once at least two historical records exist.
// The pre-commit hook runs check-suite directly, so this optional comparison
// command is not a second hidden execution of that expensive gate.
//
// The JSON is disposable: delete it and re-record with --record.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPT_DIR);
const BASELINE_FILE = path.join(ROOT, ".agents", "docs", "gate-baselines.json");
const CHECK_SUITE_SCRIPT = path.join(ROOT, "scripts", "check-suite.mjs");
const CHECK_SUITE_GATE = "check-suite";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COUNT_RE = /(\d+)\s+checks/;

function parseArgs(argv) {
  const parsed = { mode: null, tolerance: 0, help: false, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--record" || a === "--check") {
      parsed.mode = a.slice(2);
    } else if (a === "--tolerance") {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 0)
        throw new Error("--tolerance requires a non-negative integer");
      parsed.tolerance = n;
      i += 1;
    } else if (a === "-h" || a === "--help") {
      parsed.help = true;
    } else {
      parsed.positional.push(a);
    }
  }
  return parsed;
}

function loadRecords() {
  if (!fs.existsSync(BASELINE_FILE)) return [];
  let text;
  try {
    text = fs.readFileSync(BASELINE_FILE, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${BASELINE_FILE}: ${err.message}`, { cause: err });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`cannot parse ${BASELINE_FILE}: ${err.message}`, { cause: err });
  }
  if (!Array.isArray(data))
    throw new Error(`${BASELINE_FILE} must contain a JSON array of baseline records`);
  return data;
}

function saveRecords(records) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(records, null, 2)}\n`);
}

function warnStale(record) {
  const ageMs = Date.now() - Date.parse(record.ts);
  if (Number.isNaN(ageMs)) return;
  if (ageMs > MAX_AGE_MS) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    console.warn(
      `gate-baseline: WARNING gate=${record.gate} latest baseline is ${days} days old (>30) — deviation comparisons may be stale`,
    );
  }
}

function validateNumbers(passCount, wallMs) {
  if (!Number.isInteger(passCount) || passCount < 0)
    throw new Error(`pass-count must be a non-negative integer (got: ${passCount})`);
  if (!Number.isInteger(wallMs) || wallMs < 0)
    throw new Error(`wall-ms must be a non-negative integer (got: ${wallMs})`);
}

function doRecord(gate, passCount, wallMs) {
  validateNumbers(passCount, wallMs);
  const records = loadRecords();
  const record = {
    gate,
    passCount,
    wallMs,
    nodeVersion: process.version,
    ts: new Date().toISOString(),
  };
  records.push(record);
  saveRecords(records);
  console.log(
    `gate-baseline: recorded ${gate} passCount=${passCount} wallMs=${wallMs} node=${record.nodeVersion} ts=${record.ts}`,
  );
  return 0;
}

function doCheckExplicit(gate, passCount, wallMs, tolerance) {
  validateNumbers(passCount, wallMs);
  const records = loadRecords().filter((r) => r.gate === gate);
  const record = records.toSorted((a, b) => (a.ts < b.ts ? 1 : -1))[0] ?? null;
  if (record === null) {
    console.log(
      `gate-baseline: no prior baseline for gate=${gate} — nothing to compare (first baseline? use --record)`,
    );
    return 0;
  }
  warnStale(record);
  const delta = Math.abs(record.passCount - passCount);
  if (delta > tolerance) {
    if (records.length < 2) {
      console.warn(
        `gate-baseline: WARNING first deviation gate=${gate} recorded=${record.passCount} observed=${passCount} tolerance=${tolerance} — record another baseline before enforcing this comparison`,
      );
      return 0;
    }
    console.error(
      `gate-baseline: DEVIATION gate=${gate} recorded=${record.passCount} observed=${passCount} tolerance=${tolerance}`,
    );
    return 1;
  }
  console.log(
    `gate-baseline: OK gate=${gate} recorded=${record.passCount} observed=${passCount} (within tolerance ${tolerance})`,
  );
  return 0;
}

function runCheckSuite() {
  if (!fs.existsSync(CHECK_SUITE_SCRIPT)) {
    throw new Error(`cannot run check-suite: ${CHECK_SUITE_SCRIPT} missing`);
  }
  const result = spawnSync(process.execPath, ["scripts/check-suite.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const out = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    console.error(out);
    throw new Error(`check-suite failed with exit ${result.status} — baseline count not extracted`);
  }
  const match = out.match(COUNT_RE);
  if (match === null) {
    throw new Error(`could not parse the "N checks" count from check-suite stdout:\n${out}`);
  }
  return Number(match[1]);
}

function doCheckStandalone(tolerance) {
  const passCount = runCheckSuite();
  console.log(`gate-baseline: check-suite ran — parsed count ${passCount} checks`);
  return doCheckExplicit(CHECK_SUITE_GATE, passCount, 0, tolerance);
}

function usage() {
  console.log(
    "usage: node scripts/record-gate-baseline.mjs --record <gate> <pass-count> <wall-ms>",
  );
  console.log(
    "       node scripts/record-gate-baseline.mjs --check <gate> <pass-count> <wall-ms> [--tolerance N]",
  );
  console.log(
    "       node scripts/record-gate-baseline.mjs --check [--tolerance N]   (runs check-suite itself)",
  );
  console.log(
    "writes/reads .agents/docs/gate-baselines.json (JSON array of {gate, passCount, wallMs, nodeVersion, ts})",
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`gate-baseline: ${err.message}`);
    process.exit(2);
  }
  if (args.help) {
    usage();
    process.exit(0);
  }
  try {
    if (args.mode === "record") {
      if (args.positional.length !== 3)
        throw new Error("--record requires <gate> <pass-count> <wall-ms>");
      process.exit(
        doRecord(args.positional[0], Number(args.positional[1]), Number(args.positional[2])),
      );
    }
    if (args.mode === "check") {
      if (args.positional.length === 0) {
        process.exit(doCheckStandalone(args.tolerance));
      }
      if (args.positional.length === 3) {
        process.exit(
          doCheckExplicit(
            args.positional[0],
            Number(args.positional[1]),
            Number(args.positional[2]),
            args.tolerance,
          ),
        );
      }
      throw new Error(
        "--check requires either no positional args (standalone) or <gate> <pass-count> <wall-ms>",
      );
    }
    throw new Error("missing mode: use --record or --check");
  } catch (err) {
    console.error(`gate-baseline: ${err.message}`);
    process.exit(2);
  }
}

let isMain = false;
if (process.argv[1]) {
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const invoked = fs.realpathSync(path.resolve(process.argv[1]));
    isMain = self === invoked;
  } catch {
    isMain = false;
  }
}
if (isMain) main();
