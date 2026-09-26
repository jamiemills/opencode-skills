"use strict";

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runVerifyTracesCli, verifyTraces } from "../scripts/verify-traces.mjs";

function fixture(lines = []) {
  const dir = mkdtempSync(join(tmpdir(), "csm-verify-traces-"));
  const file = join(dir, "trace.jsonl");
  if (lines.length) writeFileSync(file, `${lines.join("\n")}\n`);
  return { dir, file };
}

const record = (over = {}) =>
  JSON.stringify({
    runId: "run-a",
    actor: "csm-orchestrate",
    action: "checkpoint",
    target: "t",
    justification: "j",
    outcome: "ok",
    ts: "2026-09-26T00:00:00.000Z",
    kind: "action",
    ...over,
  });

test("a matching runId is ok", () => {
  const { dir, file } = fixture([record(), record({ runId: "run-b" })]);
  try {
    const result = verifyTraces({ file, runId: "run-a" });
    assert.equal(result.ok, true);
    assert.equal(result.matched, 1);
    assert.equal(result.firstTs, "2026-09-26T00:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an absent log is not-ok and the verifier does not create it", () => {
  const { dir, file } = fixture();
  try {
    const result = verifyTraces({ file, runId: "run-a" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "log-absent");
    assert.equal(existsSync(file), false, "verifier never creates the log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a foreign runId is not-ok", () => {
  const { dir, file } = fixture([record({ runId: "run-b" })]);
  try {
    assert.equal(verifyTraces({ file, runId: "run-a" }).reason, "no-trace-for-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed line is a hard not-ok, never silently skipped", () => {
  const { dir, file } = fixture([record(), "{ not json"]);
  try {
    assert.equal(verifyTraces({ file, runId: "run-a" }).reason, "malformed-record");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the gate's own failure audit cannot satisfy the invariant", () => {
  const { dir, file } = fixture([record({ action: "trace-verification-failed" })]);
  try {
    const result = verifyTraces({ file, runId: "run-a" });
    assert.equal(result.ok, false);
    assert.equal(result.matched, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI honors --file and reports exit-mapped ok", async () => {
  const { dir, file } = fixture([record()]);
  try {
    const lines = [];
    const result = await runVerifyTracesCli({
      argv: ["--run-id", "run-a", "--file", file],
      write: (line) => lines.push(line),
    });
    assert.equal(result.ok, true);
    assert.match(lines[0], /ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--expect-at-least 2 fails with one matching record", () => {
  const { dir, file } = fixture([record()]);
  try {
    assert.equal(verifyTraces({ file, runId: "run-a", expectAtLeast: 2 }).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
