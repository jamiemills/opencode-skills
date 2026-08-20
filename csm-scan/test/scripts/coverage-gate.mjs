#!/usr/bin/env node
// csm-scan coverage gate (T010 / F-025).
//
// Runs the full suite under Node's built-in coverage instrumentation — no
// npm, no external tooling (csm-scan stays manifest-free per plan D6):
//
//   node --test --test-concurrency=1 --experimental-test-coverage
//
// then parses the machine coverage summary (`# all files | line % |
// branch % | funcs %`). The gate exits non-zero when:
//   1. the suite itself fails (any failing test, any runner error), or
//   2. no coverage summary is produced, or
//   3. total line coverage is below the 88% floor.
//
// Usage: node test/scripts/coverage-gate.mjs   (works from any cwd)
//
// NOT wired to CI — T013 (CI activation) is deferred by user decision; this
// is a local/manual gate. Always run it on Node >= 22: coverage mode is
// Node-version-coupled (plan U-4) and the frozen-env spawn fix (F-025,
// shared/command.mjs buildCommandEnv copy) is what makes the instrumented
// run green.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `node --test` discovers every .mjs under test/ — including this script —
// and executes it as a test file. In that context (NODE_TEST_CONTEXT set by
// the runner) the gate stays inert instead of spawning a nested suite; it
// only runs when invoked directly: `node test/scripts/coverage-gate.mjs`.
if (process.env.NODE_TEST_CONTEXT !== undefined && process.env.NODE_TEST_CONTEXT !== '') {
  process.exit(0);
}

const LINE_THRESHOLD = 88;
const BRANCH_THRESHOLD = 68;
const FUNCTION_THRESHOLD = 78;

// T010 (F-032) — per-module coverage manifest. These modules previously had no
// direct test import (canonical.mjs, jsonc.mjs, the whole render/git renderer,
// and the CLI-only verbose-trace reporter) and could regress while the
// aggregate 88% line floor stayed green. render/git.mjs and verbose-trace.mjs
// now have direct unit suites (test/render-git.test.mjs,
// test/verbose-trace.test.mjs); canonical.mjs and jsonc.mjs are gated at their
// established full-suite coverage. A module whose line coverage falls below
// its floor (or a module that is no longer exercised at all) fails the gate.
const MODULE_FLOORS = Object.freeze({
  'lib/scan/deep/architecture/canonical.mjs': { lines: 85, functions: 90 },
  'lib/scan/shared/jsonc.mjs': { lines: 80, functions: 90 },
  'lib/scan/render/git.mjs': { lines: 90, branches: 60, functions: 90 },
  'lib/scan/report/verbose-trace.mjs': { lines: 90, branches: 60, functions: 90 },
});

const SCAN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', '--experimental-test-coverage'],
  { cwd: SCAN_ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
);

const SUMMARY_PATTERN = /^#\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
const FILE_PATTERN = /^# (\s*)([^|]+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|/;
let summary = null;
let pending = '';
const fileCoverage = new Map();
const dirStack = [];

child.stdout.on('data', (chunk) => {
  pending += chunk.toString('utf8');
  let newline;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    process.stdout.write(`${line}\n`);
    const aggregate = line.match(SUMMARY_PATTERN);
    if (aggregate !== null) {
      summary = {
        lines: Number(aggregate[1]),
        branches: Number(aggregate[2]),
        functions: Number(aggregate[3]),
      };
      continue;
    }
    const file = line.match(FILE_PATTERN);
    if (file === null) continue;
    const depth = file[1].length;
    const name = file[2].trim();
    const linePct = file[3] === '' ? null : Number(file[3]);
    const branchPct = file[4] === '' ? null : Number(file[4]);
    const funcPct = file[5] === '' ? null : Number(file[5]);
    dirStack[depth] = name;
    dirStack.length = depth + 1;
    if (linePct === null) continue;
    fileCoverage.set(dirStack.slice(0, depth).concat(name).join('/'), {
      lines: linePct,
      branches: branchPct,
      functions: funcPct,
    });
  }
});

const exitCode = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error(`coverage-gate: failed to start the suite: ${error.message}`);
    resolve(1);
  });
  child.on('close', resolve);
});

if (pending.length > 0) process.stdout.write(`${pending}\n`);

if (exitCode !== 0) {
  console.error(`coverage-gate: FAIL — suite exited ${exitCode}`);
  process.exitCode = 1;
} else if (summary === null) {
  console.error('coverage-gate: FAIL — no "# all files" coverage summary found in the output');
  process.exitCode = 1;
} else {
  const failed = [];
  const moduleCheck = (path, coverage, metric, threshold, label) => {
    if (coverage === null) {
      failed.push(`- ${path}: ${label} coverage missing (need >= ${threshold}%)`);
      return;
    }
    if (coverage < threshold) {
      failed.push(`- ${path}: ${label} coverage ${coverage}% is below the ${threshold}% floor`);
    }
  };
  for (const [path, floors] of Object.entries(MODULE_FLOORS)) {
    const coverage = fileCoverage.get(path);
    if (coverage === undefined) {
      failed.push(`- ${path}: no coverage entry — module is no longer exercised by the suite`);
      continue;
    }
    moduleCheck(path, coverage.lines, floors.lines ?? 0, 'line');
    moduleCheck(path, coverage.branches, floors.branches ?? 0, 'branch');
    moduleCheck(path, coverage.functions, floors.functions ?? 0, 'function');
  }
  console.error(
    `coverage-gate: line ${summary.lines}% (floor ${LINE_THRESHOLD}%) · branch ${summary.branches}% (floor ${BRANCH_THRESHOLD}%) · funcs ${summary.functions}% (floor ${FUNCTION_THRESHOLD}%)`,
  );
  if (summary.lines < LINE_THRESHOLD) {
    failed.push(`- aggregate line coverage ${summary.lines}% is below the ${LINE_THRESHOLD}% floor`);
  }
  if (summary.branches < BRANCH_THRESHOLD) {
    failed.push(`- aggregate branch coverage ${summary.branches}% is below the ${BRANCH_THRESHOLD}% floor`);
  }
  if (summary.functions < FUNCTION_THRESHOLD) {
    failed.push(`- aggregate function coverage ${summary.functions}% is below the ${FUNCTION_THRESHOLD}% floor`);
  }
  if (failed.length > 0) {
    console.error('coverage-gate: FAIL — coverage floors not met:');
    for (const entry of failed) console.error(entry);
    process.exitCode = 1;
  } else {
    console.error('coverage-gate: PASS');
  }
}
