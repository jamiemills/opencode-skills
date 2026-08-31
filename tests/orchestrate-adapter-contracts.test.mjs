import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkillExecutorRegistry,
  skillExecutorContractDigest,
} from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import { createHostInvocationAdapter } from "../csm-orchestrate/lib/invocation.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const d = (letter) => `sha256:${letter.repeat(64)}`;
const descriptor = (overrides = {}) => {
  const value = {
    schema: "csm-orchestrate-skill-executor/1",
    version: 1,
    skill: "csm-scan",
    handlerDigest: d("b"),
    inputSchemaDigest: d("c"),
    outputSchemaDigest: d("d"),
    receiptSchemaDigest: d("e"),
    evidenceSchemaDigest: d("f"),
    effectiveConfigDigest: d("0"),
    permissions: ["read"],
    effects: ["read-only"],
    cancellation: "cooperative",
    idempotency: "natural",
    handler: async () => ({}),
    ...overrides,
  };
  return { ...value, contractDigest: skillExecutorContractDigest(value) };
};

test("registry treats input and output schemas as executable identity", async () => {
  const entry = descriptor();
  const registry = await createSkillExecutorRegistry({ descriptors: [entry] });
  assert.throws(
    () => registry.resolveExact({ ...entry, inputSchemaDigest: d("a") }),
    /exact skill executor is not registered/,
  );
  assert.throws(
    () => registry.resolveExact({ ...entry, outputSchemaDigest: d("a") }),
    /exact skill executor is not registered/,
  );
});

test("strict invocation binds every executable digest and preserves complete response", async () => {
  const entry = descriptor();
  const request = {
    schema: "csm-orchestrate-invocation/2",
    invocationId: "invocation-contract-test",
    parentRunId: "run-contract-parent",
    childRunId: "run-contract-child",
    phaseId: "phase-contract",
    edgeId: "edge-contract",
    skill: "csm-scan",
    skillDigest: d("a"),
    contractDigest: entry.contractDigest,
    handlerDigest: entry.handlerDigest,
    inputSchemaDigest: entry.inputSchemaDigest,
    outputSchemaDigest: entry.outputSchemaDigest,
    receiptSchemaDigest: entry.receiptSchemaDigest,
    evidenceSchemaDigest: entry.evidenceSchemaDigest,
    effectiveConfigDigest: entry.effectiveConfigDigest,
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    permissions: ["read"],
    approval: {
      schema: "csm-orchestrate-approval/2",
      approvalId: "approval-contract",
      binding: {
        parentRunId: "run-contract-parent",
        childRunId: "run-contract-child",
        phaseId: "phase-contract",
        edgeId: "edge-contract",
      },
      scope: ["read"],
      approvedDigest: d("a"),
      approvedAt: "2026-08-31T00:00:00Z",
      expiresAt: "2099-08-31T00:00:00Z",
      status: "approved",
    },
    timeoutMs: 100,
    cancellation: { requested: false },
    retry: { attempt: 1, idempotencyKey: "contract-key" },
    status: "ready",
  };
  const adapter = createHostInvocationAdapter({
    capabilities: [{ skill: "csm-scan", digest: d("a") }],
    requireExecutableIdentity: true,
    host: {
      invokeSiblingSkill: async () => ({
        status: "completed",
        childReceipt: null,
        evidence: [],
        outputArtifactRefs: [],
        completeChildPayload: { preserved: true },
      }),
    },
  });
  request.requestDigest = digest(
    Object.fromEntries(Object.entries(request).filter(([key]) => key !== "status")),
  );
  const result = await adapter.invoke(request);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.completeChildPayload, { preserved: true });
});
