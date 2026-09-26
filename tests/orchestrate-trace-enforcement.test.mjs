"use strict";

// T005: fault-injection for the trace-emission gate. It exercises the gate
// integration (verifyTraces + policy + evaluateTraceGate) with an isolated temp
// log and the verifier CLI end-to-end via a subprocess. It never touches the
// repo's real shared log.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { enforceTraceGate } from "../scripts/run-orchestrator.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "csm-trace-enforce-"));
  return { dir, file: join(dir, "trace.jsonl") };
}

const withEnv = async (env, body) => {
  const previous = process.env.CSM_TRACE_ENFORCE;
  if (env === undefined) delete process.env.CSM_TRACE_ENFORCE;
  else process.env.CSM_TRACE_ENFORCE = env;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.CSM_TRACE_ENFORCE;
    else process.env.CSM_TRACE_ENFORCE = previous;
  }
};

test("required policy fails a run that produced no trace", async () => {
  const { dir, file } = fixture();
  try {
    await withEnv("required", async () => {
      const gate = await enforceTraceGate({ traceFile: file, runId: "run-x", scheduled: 0 });
      assert.equal(gate.ok, false);
      assert.equal(gate.reason, "no-trace-for-run");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the failure audit is written but does not satisfy the invariant (no self-healing)", async () => {
  const { dir, file } = fixture();
  try {
    await withEnv("required", async () => {
      await enforceTraceGate({ traceFile: file, runId: "run-x", scheduled: 0 });
      const second = await enforceTraceGate({ traceFile: file, runId: "run-x", scheduled: 0 });
      assert.equal(second.ok, false, "a second run still fails");
      assert.ok(existsSync(file), "the audit was written");
      assert.match(readFileSync(file, "utf8"), /trace-verification-failed/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("required policy passes once a real trace exists", async () => {
  const { dir, file } = fixture();
  try {
    writeFileSync(
      file,
      `${JSON.stringify({ runId: "run-x", actor: "csm-orchestrate", action: "task-complete", target: "t", justification: "j", outcome: "ok", ts: "2026-09-26T00:00:00.000Z", kind: "action" })}\n`,
    );
    await withEnv("required", async () => {
      const gate = await enforceTraceGate({ traceFile: file, runId: "run-x", scheduled: 1 });
      assert.equal(gate.ok, true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with Jev active the policy is strict even when the run scheduled nothing", async () => {
  const { dir, file } = fixture();
  try {
    await withEnv("auto", async () => {
      const gate = await enforceTraceGate({
        traceFile: file,
        runId: "run-x",
        scheduled: 0,
        jevActive: true,
      });
      assert.equal(gate.ok, false);
      assert.equal(gate.reason, "no-trace-for-run");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auto policy passes a run that scheduled nothing", async () => {
  const { dir, file } = fixture();
  try {
    await withEnv("auto", async () => {
      const gate = await enforceTraceGate({ traceFile: file, runId: "run-x", scheduled: 0 });
      assert.equal(gate.ok, true);
      assert.equal(gate.enforce, false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("E2E (subprocess): a broken trace path fails closed under required", () => {
  const { dir } = fixture();
  try {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "regular file\n");
    const badPath = join(blocker, "trace.jsonl"); // parent is a file -> mkdir fails
    const script = join(dir, "run-gate.mjs");
    const driverUrl = pathToFileURL(join(ROOT, "scripts", "run-orchestrator.mjs")).href;
    writeFileSync(
      script,
      [
        `import { enforceTraceGate } from ${JSON.stringify(driverUrl)};`,
        `const gate = await enforceTraceGate({ traceFile: ${JSON.stringify(badPath)}, runId: "run-e2e", scheduled: 1 });`,
        "process.stdout.write(JSON.stringify(gate));",
        "process.exit(gate.ok ? 0 : 1);",
        "",
      ].join("\n"),
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, CSM_TRACE_ENFORCE: "required", CSM_TRACE_LOG: badPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /no-trace-for-run|log-absent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the verifier CLI exits 2 when the run is untraced and 0 when traced", () => {
  const { dir, file } = fixture();
  try {
    const missing = spawnSync(
      process.execPath,
      ["scripts/verify-traces.mjs", "--run-id", "run-x", "--file", file],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(missing.status, 2, missing.stdout + missing.stderr);
    writeFileSync(
      file,
      `${JSON.stringify({ runId: "run-x", actor: "a", action: "b", target: "t", justification: "j", outcome: "o", ts: "2026-09-26T00:00:00.000Z", kind: "action" })}\n`,
    );
    const present = spawnSync(
      process.execPath,
      ["scripts/verify-traces.mjs", "--run-id", "run-x", "--file", file],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(present.status, 0, present.stdout + present.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
