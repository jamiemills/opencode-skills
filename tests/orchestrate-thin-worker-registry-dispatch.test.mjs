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
  resolveThinWorkerAdapter,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createAllBuildHandoffs } from "../csm-orchestrate/lib/csm-build-handoff.mjs";
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

// T001: the shipped opt-in path. resolveThinWorkerAdapter is the single
// construction condition for the thin child-side worker seam: CSM_AGENT_SESSION_EXEC=1
// plus an operator-supplied handler module. Gate-off (or no handler) returns
// null so the caller keeps its default blocked handoffs.
test("T001: resolveThinWorkerAdapter is env-gated and yields an authority-free adapter", async () => {
  const { dir, path } = await handlerFile("export async function execute() { return {}; }\n");
  try {
    assert.equal(resolveThinWorkerAdapter({ handlerPath: path, workerScript, env: {} }), null);
    assert.equal(
      resolveThinWorkerAdapter({
        handlerPath: path,
        workerScript,
        env: { CSM_AGENT_SESSION_EXEC: "0" },
      }),
      null,
    );
    assert.equal(
      resolveThinWorkerAdapter({ workerScript, env: { CSM_AGENT_SESSION_EXEC: "1" } }),
      null,
      "no handler module means no thin worker adapter",
    );
    const resolved = resolveThinWorkerAdapter({
      handlerPath: path,
      workerScript,
      env: { CSM_AGENT_SESSION_EXEC: "1" },
      skills: ["csm-build"],
    });
    assert.ok(resolved, "gate on + handler must construct the thin worker adapter");
    assert.deepEqual([...resolved.thinWorkerSkills], ["csm-build"]);
    assert.deepEqual(Object.keys(resolved.thinWorkerAdapter).toSorted(), ["execute", "invoke"]);
    for (const authority of ["cursorStore", "receipt", "gate", "acceptResult", "dispatchIntent"])
      assert.equal(
        resolved.thinWorkerAdapter[authority],
        undefined,
        `resolved thin adapter must not own ${authority}`,
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// T001: driver-equivalent wiring. The driver filters the thin worker skills out
// of the default blocked handoffs, passes the resolved adapter through
// createExecutorHandlers/createExecutorDescriptors, and dispatches through the
// registry. This proves the shipped opt-in path runs exactly one real child
// invocation (run-worker.mjs -> handler.mjs) end to end.
test("T001: the gate-on resolver dispatches end-to-end through the registry", async () => {
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
    const resolved = resolveThinWorkerAdapter({
      handlerPath: path,
      workerScript,
      env: { CSM_AGENT_SESSION_EXEC: "1" },
      skills: ["csm-build"],
    });
    const buildHandoffs = createAllBuildHandoffs().filter(
      (handoff) => !resolved.thinWorkerSkills.includes(handoff.skill),
    );
    const handlers = createExecutorHandlers({
      csmBuildHandoffs: buildHandoffs,
      thinWorkerAdapter: resolved.thinWorkerAdapter,
      thinWorkerSkills: resolved.thinWorkerSkills,
    });
    const descriptors = createExecutorDescriptors({
      handlers,
      csmBuildHandoffs: buildHandoffs,
      thinWorkerAdapter: resolved.thinWorkerAdapter,
      thinWorkerSkills: resolved.thinWorkerSkills,
    });
    const descriptor = descriptors.find((item) => item.skill === "csm-build");
    assert.ok(descriptor, "csm-build must have a thin worker descriptor");
    assert.equal(handlers.get("csm-build").thinWorkerAdapter, true);

    const registry = await createSkillExecutorRegistry({ descriptors });
    assert.equal(registry.resolveExact(descriptor).handler, handlers.get("csm-build"));

    const result = await executeSkill(
      "csm-build",
      { input: { task: "thin-driver" }, context },
      { handlers, descriptor },
    );
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.receipt.receiptId, "receipt-thin-registry-1");
    assert.equal(result.receipt.owner, "csm-build");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// T001: gate-off is fail-closed. With no resolved adapter the default
// agent-session-required handoff is unchanged, so the csm-build route stays
// blocked rather than silently falling through to a different authority.
test("T001: with the gate off the default csm-build handoff stays blocked", async () => {
  const fullContext = {
    invocationId: "invocation-thin-registry-1",
    parentRunId: "run-thin-registry-parent",
    runId: "run-thin-registry-1",
    phaseId: "phase-thin-registry",
    edgeId: "edge-thin-registry",
    owner: "csm-build",
    attempt: 1,
  };
  const handlers = createExecutorHandlers({ csmBuildHandoffs: createAllBuildHandoffs() });
  const descriptor = createExecutorDescriptors({
    handlers,
    csmBuildHandoffs: createAllBuildHandoffs(),
  }).find((item) => item.skill === "csm-build");
  const result = await executeSkill(
    "csm-build",
    { input: {}, context: fullContext },
    { handlers, descriptor },
  );
  assert.equal(result.status, "blocked", JSON.stringify(result));
  assert.equal(result.failure.code, "agent-session-required");
});
