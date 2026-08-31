import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import {
  createCsmBuildHandoff,
  createCsmBuildHandoffAdapter,
} from "../csm-orchestrate/lib/csm-build-handoff.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const identity = {
  invocationId: "invocation-build-handoff",
  parentRunId: "run-build-parent",
  childRunId: "run-build-child",
  phaseId: "phase-build",
  edgeId: "edge-build",
  skill: "csm-plan",
};

const receipt = (attempt = 1) => {
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: `receipt-build-${attempt}`,
    runId: identity.childRunId,
    owner: identity.skill,
    attempt,
    status: "completed",
  };
  return { ...body, digest: digest(body) };
};

function handoff(execute) {
  return createCsmBuildHandoff({ skill: identity.skill, execute });
}

function request(overrides = {}) {
  const { descriptor, ...fields } = overrides;
  return {
    schema: "csm-orchestrate-invocation/2",
    ...identity,
    skillDigest: digest("capability"),
    input: { title: "typed plan" },
    inputArtifactRefs: [],
    upstreamArtifactRefs: [],
    acceptanceSignalIds: ["sig-build"],
    outputArtifactRefs: [],
    permissions: ["read", "write"],
    approval: {
      schema: "csm-orchestrate-approval/2",
      approvalId: "approval-build",
      binding: {
        parentRunId: identity.parentRunId,
        childRunId: identity.childRunId,
        phaseId: identity.phaseId,
        edgeId: identity.edgeId,
      },
      scope: ["read", "write"],
      approvedDigest: digest("capability"),
      approvedAt: "2026-08-30T00:00:00Z",
      expiresAt: "2099-08-30T00:00:00Z",
      status: "approved",
    },
    timeoutMs: 100,
    cancellation: { requested: false },
    retry: { attempt: 1, idempotencyKey: "build-handoff-key" },
    status: "ready",
    ...(descriptor
      ? Object.fromEntries(
          [
            "contractDigest",
            "handlerDigest",
            "receiptSchemaDigest",
            "evidenceSchemaDigest",
            "effectiveConfigDigest",
          ].map((key) => [key, descriptor[key]]),
        )
      : {}),
    ...fields,
  };
}

test("executes instruction-led work in the current context and returns typed results", async () => {
  let received;
  const build = handoff(async (input) => {
    received = input;
    return {
      schema: "csm-build-output/1",
      skill: identity.skill,
      attempt: 1,
      requestIdentity: { ...input.requestIdentity },
      inputSchemaDigest: input.inputSchemaDigest,
      outputSchemaDigest: input.outputSchemaDigest,
      output: { plan: true },
      outputDigest: digest({ plan: true }),
      receipt: receipt(),
      effects: ["workspace-write"],
      artifacts: [],
      evidence: [],
      status: "completed",
    };
  });
  const result = await build.execute({ ...request(), retry: { attempt: 1 } });
  assert.equal(result.status, "completed");
  assert.equal(received.requestIdentity.digest, digest(identity));
  assert.equal(received.input.title, "typed plan");
});

test("rejects missing, malformed, self, changed identity, and changed output digests", async () => {
  assert.throws(
    () => createCsmBuildHandoff({ skill: "csm-orchestrate", execute: async () => ({}) }),
    /csm-build-owned/,
  );
  const build = handoff(async (input) => ({
    schema: "csm-build-output/1",
    skill: identity.skill,
    attempt: 1,
    requestIdentity: { ...input.requestIdentity, childRunId: "run-other" },
    inputSchemaDigest: input.inputSchemaDigest,
    outputSchemaDigest: input.outputSchemaDigest,
    output: {},
    receipt: receipt(),
    effects: ["workspace-write"],
    artifacts: [],
    evidence: [],
    status: "completed",
  }));
  await assert.rejects(build.execute({ ...request(), retry: { attempt: 1 } }), /identity mismatch/);
  await assert.rejects(
    build.execute({ ...request(), retry: { attempt: 1 }, invocationId: undefined }),
    /identity mismatch/,
  );
  const malformed = handoff(async (input) => ({
    schema: "wrong",
    skill: identity.skill,
    attempt: 1,
    requestIdentity: input.requestIdentity,
  }));
  await assert.rejects(
    malformed.execute({ ...request(), retry: { attempt: 1 } }),
    /identity mismatch/,
  );
  const changed = handoff(async (input) => ({
    schema: "csm-build-output/1",
    skill: identity.skill,
    attempt: 1,
    requestIdentity: input.requestIdentity,
    inputSchemaDigest: input.inputSchemaDigest,
    outputSchemaDigest: input.outputSchemaDigest,
    output: {},
    outputDigest: digest("changed"),
    receipt: receipt(),
    effects: ["workspace-write"],
    artifacts: [],
    evidence: [],
    status: "completed",
  }));
  await assert.rejects(
    changed.execute({ ...request(), retry: { attempt: 1 } }),
    /output digest mismatch/,
  );
});

test("only supplied csm-build handoffs generate owned descriptors and browse/autoresearch stay blocked", async () => {
  const absent = createExecutorDescriptors();
  assert.equal(
    absent.some(({ skill }) => skill === "csm-plan"),
    false,
  );
  const build = handoff(async (input) => ({
    schema: "csm-build-output/1",
    skill: identity.skill,
    attempt: 1,
    requestIdentity: input.requestIdentity,
    inputSchemaDigest: input.inputSchemaDigest,
    outputSchemaDigest: input.outputSchemaDigest,
    output: {},
    receipt: receipt(),
    effects: ["workspace-write"],
    artifacts: [],
    evidence: [],
    status: "completed",
  }));
  const handlers = createExecutorHandlers({ csmBuildHandoff: build });
  const descriptors = createExecutorDescriptors({ handlers, csmBuildHandoff: build });
  assert.equal(
    descriptors.some(({ skill }) => skill === "csm-plan"),
    true,
  );
  assert.equal((await handlers.get("csm-browse")({})).status, "blocked");
  assert.equal((await handlers.get("csm-autoresearch")({})).status, "blocked");
});

test("cancellation and durable replay pass through the existing invocation adapter", async () => {
  const build = createCsmBuildHandoffAdapter({
    skill: identity.skill,
    execute: async (input) => ({
      schema: "csm-build-output/1",
      skill: identity.skill,
      attempt: input.attempt,
      requestIdentity: input.requestIdentity,
      inputSchemaDigest: input.inputSchemaDigest,
      outputSchemaDigest: input.outputSchemaDigest,
      output: {},
      receipt: receipt(input.attempt),
      effects: ["workspace-write"],
      artifacts: [],
      evidence: [],
      status: "completed",
    }),
  });
  const handlers = createExecutorHandlers({ csmBuildHandoff: build });
  const descriptors = createExecutorDescriptors({ handlers, csmBuildHandoff: build });
  const registry = await createSkillExecutorRegistry({
    descriptors: [descriptors.find(({ skill }) => skill === identity.skill)],
  });
  const attempts = new Map();
  const store = {
    async recordIdempotency() {},
    async consumeApproval() {},
    async loadChildAttemptByKey(key) {
      return [...attempts.values()].find((item) => item.logicalKey === key) ?? null;
    },
    async beginChildAttempt(record) {
      const saved = { ...record, state: "dispatched", response: null };
      attempts.set(record.attemptId, saved);
      return saved;
    },
    async saveChildAttemptResult(id, response, state = "terminal") {
      const item = attempts.get(id);
      item.response = structuredClone(response);
      item.state = state;
      return item;
    },
  };
  const adapter = createInProcessExecutorAdapter({
    registry,
    bindings: { [identity.skill]: descriptors.find(({ skill }) => skill === identity.skill) },
    capabilities: [{ skill: identity.skill, digest: digest("capability") }],
    cursorStore: store,
  });
  const first = await adapter.invoke(
    request({ descriptor: descriptors.find(({ skill }) => skill === identity.skill) }),
  );
  const replay = await createInProcessExecutorAdapter({
    registry,
    bindings: { [identity.skill]: descriptors.find(({ skill }) => skill === identity.skill) },
    capabilities: [{ skill: identity.skill, digest: digest("capability") }],
    cursorStore: store,
  }).invoke(request({ descriptor: descriptors.find(({ skill }) => skill === identity.skill) }));
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.deepEqual(replay, first);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await adapter.invoke(
        request({
          descriptor: descriptors.find(({ skill }) => skill === identity.skill),
          approval: { ...request().approval, approvalId: "approval-cancel" },
          cancellation: { requested: true },
          retry: { attempt: 2, idempotencyKey: "cancel-key" },
        }),
        { signal: controller.signal },
      )
    ).failure.code,
    "cancelled",
  );
});

test("the handoff and executor adapter contain no forbidden runtime references", async () => {
  for (const path of [
    "../csm-orchestrate/lib/csm-build-handoff.mjs",
    "../csm-orchestrate/lib/skill-executor-adapter.mjs",
    "../csm-orchestrate/lib/skill-executor-handlers.mjs",
  ])
    assert.doesNotMatch(await readFile(new URL(path, import.meta.url), "utf8"), /opencode/i);
});
