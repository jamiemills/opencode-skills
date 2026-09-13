import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// T001 parity baseline: the repo gates that must stay green before and after
// every config-adapter migration. Each target runs as a real subprocess from
// the repository root, exactly as CI invokes it.
//
// NODE_TEST_CONTEXT must be stripped: the outer `node --test` runner exports
// it, the inner `node --test` spawned by `make test-orchestrate` inherits it,
// and node:test then prints "skipping running files" while still exiting 0 —
// a silent false green. The orchestrate assertion below additionally demands
// a real TAP pass summary so this failure class can never read as parity.

const REPO = path.resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 128 * 1024 * 1024;

// Each parity run owns a fresh temp root so the nested suites' scratch state
// (mkdtemp under TMPDIR/`/tmp` prefixes) and lock files can never collide with
// a concurrently running suite. The nested make also runs with a scrubbed MAKE*
// environment so it cannot inherit a parent jobserver/parallel flags and
// interleave unpredictably under load.
const ISOLATED_TMP = mkdtempSync(path.join(os.tmpdir(), "csm-parity-"));
after(() => rmSync(ISOLATED_TMP, { recursive: true, force: true }));

function runMake(target) {
  const targetTmp = path.join(ISOLATED_TMP, target.replace(/[^a-z0-9-]/gi, "-"));
  mkdirSync(targetTmp, { recursive: true });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.MAKEFLAGS;
  delete env.MFLAGS;
  delete env.MAKELEVEL;
  env.TMPDIR = targetTmp;
  env.TMP = targetTmp;
  env.TEMP = targetTmp;
  return spawnSync("make", [target], {
    cwd: REPO,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env,
  });
}

function tail(text, chars = 4000) {
  if (!text) return "";
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}

function assertGateOk(target, result) {
  assert.equal(
    result.status,
    0,
    `make ${target} failed (status ${result.status})\nstdout tail:\n${tail(result.stdout)}\nstderr tail:\n${tail(result.stderr)}`,
  );
  assert.ok(
    !`${result.stdout}\n${result.stderr}`.includes("skipping running files"),
    `make ${target} suppressed a nested test run (node:test recursion guard)`,
  );
}

test("make test-orchestrate passes (orchestration parity)", () => {
  const result = runMake("test-orchestrate");
  assertGateOk("test-orchestrate", result);
  assert.match(result.stdout, /# pass \d+\n/, "expected a TAP pass summary from the nested suite");
  assert.match(result.stdout, /# fail 0\n/, "nested orchestrate suite reported failures");
});

test("make check passes (repo conformance gate parity)", () => {
  assertGateOk("check", runMake("check"));
});

test("make fmt-check passes (formatting parity, no writes)", () => {
  const result = runMake("fmt-check");
  assertGateOk("fmt-check", result);
  assert.ok(
    result.stdout.includes("All matched files use the correct format."),
    `fmt-check completed without its success line\nstdout tail:\n${tail(result.stdout)}`,
  );
});
