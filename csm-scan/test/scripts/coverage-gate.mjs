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
const SCAN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', '--experimental-test-coverage'],
  { cwd: SCAN_ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
);

const SUMMARY_PATTERN = /^#\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
let summary = null;
let pending = '';

child.stdout.on('data', (chunk) => {
  pending += chunk.toString('utf8');
  let newline;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    process.stdout.write(`${line}\n`);
    const match = line.match(SUMMARY_PATTERN);
    if (match !== null) {
      summary = {
        lines: Number(match[1]),
        branches: Number(match[2]),
        functions: Number(match[3]),
      };
    }
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
  console.error(
    `coverage-gate: line ${summary.lines}% (floor ${LINE_THRESHOLD}%) · branch ${summary.branches}% · funcs ${summary.functions}%`,
  );
  if (summary.lines < LINE_THRESHOLD) {
    console.error(`coverage-gate: FAIL — line coverage ${summary.lines}% is below the ${LINE_THRESHOLD}% floor`);
    process.exitCode = 1;
  } else {
    console.error('coverage-gate: PASS');
  }
}
