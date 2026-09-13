"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createThinWorkerAdapter } from "../csm-orchestrate/lib/thin-worker-adapter.mjs";

const workerScript = fileURLToPath(new URL("../scripts/run-worker.mjs", import.meta.url));

async function handlerFile(source) {
  const dir = await mkdtemp(join(tmpdir(), "csm-thin-handler-"));
  const path = join(dir, "handler.mjs");
  await writeFile(path, source);
  return { dir, path };
}

test("T003: the thin worker adapter dispatches one invocation and returns a raw result", async () => {
  const { dir, path } = await handlerFile(
    'export async function execute(request) { return { status: "completed", skill: request.skill, receipt: { receiptId: "receipt-thin-1", schema: "csm-orchestrate-child-receipt/1", runId: request.childRunId, digest: `sha256:${"a".repeat(64)}`, owner: request.skill, status: "completed" }, artifacts: [] }; }\n',
  );
  try {
    const adapter = createThinWorkerAdapter({ workerScript, handlerPath: path });
    const result = await adapter.invoke({
      invocationId: "invocation-thin-1",
      childRunId: "run-thin-1",
      skill: "csm-scan",
      outputSchema: "csm-orchestrate-receipt/2",
      attempt: 1,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.childReceipt.owner, "csm-scan");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T003: the thin worker adapter maps a blocked handler result", async () => {
  const { dir, path } = await handlerFile(
    'export async function execute() { return { status: "blocked", failure: { class: "policy", code: "denied", message: "no" } }; }\n',
  );
  try {
    const adapter = createThinWorkerAdapter({ workerScript, handlerPath: path });
    const result = await adapter.invoke({ childRunId: "run-thin-2", skill: "csm-scan" });
    assert.equal(result.status, "blocked");
    assert.equal(result.failure.code, "denied");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T003: the thin worker adapter fails closed without a handler", async () => {
  const adapter = createThinWorkerAdapter({ workerScript });
  const result = await adapter.invoke({ childRunId: "run-thin-3", skill: "csm-scan" });
  assert.equal(result.status, "blocked");
  assert.equal(result.failure.code, "worker-handler-required");
});

test("T003: the thin worker adapter scrubs credential-shaped env before spawn", async () => {
  const { EventEmitter } = await import("node:events");
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "secret-value";
  let capturedEnv = null;
  try {
    const adapter = createThinWorkerAdapter({
      workerScript,
      spawnFn: (_file, _args, options) => {
        capturedEnv = options.env;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setTimeout(() => child.emit("close", 1), 0);
        return child;
      },
    });
    const result = await adapter.invoke({ childRunId: "run-thin-4", skill: "csm-scan" });
    assert.equal(result.status, "blocked");
    assert.equal(capturedEnv.CSM_AGENT_SESSION_EXEC, "1");
    assert.equal(capturedEnv.GITHUB_TOKEN, undefined);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});
