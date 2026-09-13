"use strict";

// T003: the thin child-side worker entry (scripts/run-worker.mjs) is registered
// as an executor adapter through the same keyed/declared/validated contract as
// the in-process and browse adapters. This test dispatches one invocation
// through the registered adapter and proves the adapter owns no acceptance
// authority: it only runs one invocation, while the parent orchestrator
// normalizes the authoritative child result.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createThinWorkerAdapter } from "../csm-orchestrate/lib/thin-worker-adapter.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
  executeSkill,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const workerScript = fileURLToPath(new URL("../scripts/run-worker.mjs", import.meta.url));
const digestModule = pathToFileURL(
  fileURLToPath(new URL("../lib/schema-runtime/index.mjs", import.meta.url)),
).href;

const context = { runId: "run-thin-registry-1", owner: "csm-build", attempt: 1 };

async function handlerFile(source) {
  const dir = await mkdtemp(join(tmpdir(), "csm-thin-registry-"));
  const path = join(dir, "handler.mjs");
  await writeFile(path, source);
  return { dir, path };
}

function countingAdapter(adapter) {
  return {
    dispatches: 0,
    async execute(request) {
      this.dispatches += 1;
      return adapter.execute(request);
    },
  };
}

test("T003: an orchestrate dispatch resolves and runs one invocation through the registered thin worker adapter", async () => {
  const { dir, path } = await handlerFile(
    `import { digest } from ${JSON.stringify(digestModule)};
export async function execute(invocation) {
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: "receipt-thin-registry-1",
    runId: invocation.childRunId,
    owner: invocation.skill,
    attempt: invocation.attempt,
    status: "completed",
  };
  return {
    status: "completed",
    effects: [],
    artifacts: [],
    receipt: { ...body, digest: digest(body) },
    failure: null,
  };
}
`,
  );
  try {
    const thinWorker = createThinWorkerAdapter({ workerScript, handlerPath: path });
    const registered = countingAdapter(thinWorker);
    const skills = ["csm-build"];
    const handlers = createExecutorHandlers({
      thinWorkerAdapter: registered,
      thinWorkerSkills: skills,
    });
    const descriptors = createExecutorDescriptors({
      handlers,
      thinWorkerAdapter: registered,
      thinWorkerSkills: skills,
    });
    const descriptor = descriptors.find((item) => item.skill === "csm-build");
    assert.ok(descriptor, "the thin worker skill must have a registered descriptor");
    assert.equal(handlers.get("csm-build").thinWorkerAdapter, true);
    assert.equal(descriptor.handler, handlers.get("csm-build"));

    const registry = await createSkillExecutorRegistry({ descriptors });
    const entry = registry.resolveExact(descriptor);
    assert.equal(entry.handler, descriptor.handler);

    const result = await executeSkill(
      "csm-build",
      { input: { task: "thin-registry" }, context },
      { handlers, descriptor },
    );

    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.schema, "csm-orchestrate-child-result/1");
    assert.equal(result.context.runId, context.runId);
    assert.equal(result.receipt.owner, "csm-build");
    assert.equal(result.receipt.runId, context.runId);
    assert.equal(result.receipt.receiptId, "receipt-thin-registry-1");
    assert.equal(registered.dispatches, 1, "the invocation must dispatch exactly once");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T003: the registered thin worker adapter owns no cursor, receipt, gate, or acceptance authority", async () => {
  const { dir, path } = await handlerFile("export async function execute() { return {}; }\n");
  try {
    const adapter = createThinWorkerAdapter({ workerScript, handlerPath: path });
    assert.deepEqual(Object.keys(adapter).toSorted(), ["execute", "invoke"]);
    for (const authority of [
      "cursorStore",
      "saveCursor",
      "loadCursor",
      "receipt",
      "persistReceipt",
      "gate",
      "acceptResult",
      "dispatchIntent",
    ])
      assert.equal(adapter[authority], undefined, `thin adapter must not own ${authority}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
