import assert from "node:assert/strict";
import test from "node:test";
import { retryDecision } from "../csm-orchestrate/lib/recovery.mjs";
import { createHostInvocationAdapter } from "../csm-orchestrate/lib/invocation.mjs";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const request = (input = "same") => ({
  schema: "csm-orchestrate-invocation/2",
  invocationId: "invocation-idempotency-child",
  parentRunId: "run-idempotency-parent",
  childRunId: "run-idempotency-child",
  phaseId: "phase-idempotency",
  edgeId: "edge-idempotency",
  skill: "csm-scan",
  skillDigest: digest("a"),
  inputArtifactRefs: [],
  upstreamArtifactRefs: [],
  acceptanceSignalIds: ["sig-idempotency"],
  outputArtifactRefs: [],
  permissions: ["read"],
  approval: {
    schema: "csm-orchestrate-approval/2",
    approvalId: "approval-idempotency",
    binding: {
      parentRunId: "run-idempotency-parent",
      childRunId: "run-idempotency-child",
      phaseId: "phase-idempotency",
      edgeId: "edge-idempotency",
    },
    scope: ["read"],
    approvedDigest: digest("a"),
    approvedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-27T00:00:00.000Z",
    status: "approved",
  },
  timeoutMs: 30,
  cancellation: { requested: false },
  retry: { attempt: 1, idempotencyKey: "logical-idempotency-key" },
  status: "ready",
  input,
});

test("reconciliation-required failures cannot trigger automatic retry", () => {
  assert.deepEqual(
    retryDecision({
      failure: { class: "timeout", code: "reconciliation-required" },
      attempt: 1,
      maxAttempts: 4,
      retryability: "bounded",
      idempotencyMode: "required",
      sideEffects: ["publication"],
    }),
    { action: "stop", reason: "reconciliation-required", nextAttempt: 1 },
  );
});

test("changed request material under one logical key is rejected", async () => {
  const records = new Map();
  const durable = {
    async loadChildAttemptByKey(key) {
      return records.get(key) ?? null;
    },
    async beginChildAttempt(record) {
      const prior = records.get(record.logicalKey);
      if (prior) {
        if (prior.requestDigest !== record.requestDigest)
          throw Object.assign(new Error("request digest changed"), { info: { conflict: true } });
        return prior;
      }
      const saved = { ...record, state: "terminal", response: { status: "completed" } };
      records.set(record.logicalKey, saved);
      return saved;
    },
  };
  const adapter = createHostInvocationAdapter({
    capabilities: [{ skill: "csm-scan", digest: digest("a") }],
    cursorStore: durable,
    host: { invokeSiblingSkill: async () => ({ status: "completed" }) },
  });
  const base = request();
  const changed = request("changed");
  const first = await adapter.invoke(base);
  assert.equal(first.status, "completed");
  const second = await adapter.invoke(changed);
  assert.equal(second.failure.code, "idempotency-conflict");
});
