import assert from "node:assert/strict";
import test from "node:test";
import { createHostInvocationAdapter } from "../csm-orchestrate/lib/invocation.mjs";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const request = (overrides = {}) => ({
  schema: "csm-orchestrate-invocation/2",
  invocationId: "invocation-recovery-child",
  parentRunId: "run-recovery-parent",
  childRunId: "run-recovery-child",
  phaseId: "phase-recovery",
  edgeId: "edge-recovery",
  skill: "csm-scan",
  skillDigest: digest("a"),
  inputArtifactRefs: [],
  upstreamArtifactRefs: [],
  acceptanceSignalIds: ["sig-recovery"],
  outputArtifactRefs: [],
  permissions: ["read"],
  approval: {
    schema: "csm-orchestrate-approval/2",
    approvalId: "approval-recovery",
    binding: {
      parentRunId: "run-recovery-parent",
      childRunId: "run-recovery-child",
      phaseId: "phase-recovery",
      edgeId: "edge-recovery",
    },
    scope: ["read"],
    approvedDigest: digest("a"),
    approvedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-27T00:00:00.000Z",
    status: "approved",
  },
  timeoutMs: 10,
  cancellation: { requested: false },
  retry: { attempt: 1, idempotencyKey: "recovery-key" },
  status: "ready",
  ...overrides,
});

function store() {
  const attempts = new Map();
  return {
    attempts,
    async recordIdempotency() {},
    async consumeApproval() {},
    async loadChildAttemptByKey(key) {
      return [...attempts.values()].find((item) => item.logicalKey === key) ?? null;
    },
    async beginChildAttempt(record) {
      const existing = await this.loadChildAttemptByKey(record.logicalKey);
      if (existing) {
        if (existing.requestDigest !== record.requestDigest)
          throw Object.assign(new Error("request digest changed"), { info: { conflict: true } });
        return existing;
      }
      const saved = { ...record, state: "dispatched", response: null };
      attempts.set(record.attemptId, saved);
      return saved;
    },
    async saveChildAttemptResult(attemptId, response, state = "terminal") {
      const item = attempts.get(attemptId);
      item.response = structuredClone(response);
      item.state = state;
      return item;
    },
    async recordReconciliation(childRunId, outcome, details) {
      this.reconciliation = { childRunId, outcome, details };
      return this.reconciliation;
    },
  };
}

const capabilities = [{ skill: "csm-scan", digest: digest("a") }];
const completed = () => ({
  status: "completed",
  technical: [{ id: "technical", status: "pass" }],
  functional: [{ id: "functional", status: "pass" }],
  childReceipt: {
    receiptId: "receipt-recovery-child",
    schema: "csm-fixture-receipt/1",
    runId: "run-recovery-child",
    digest: digest("b"),
    owner: "csm-scan",
    status: "completed",
  },
  evidence: [],
  outputArtifactRefs: [],
});

test("timeout after dispatch is durable UNKNOWN and not an ordinary retry", async () => {
  const durable = store();
  const adapter = createHostInvocationAdapter({
    capabilities,
    cursorStore: durable,
    host: { invokeSiblingSkill: async () => new Promise(() => {}) },
  });
  const result = await adapter.invoke(request(), {
    cursorId: "cursor-recovery",
    dispatchIntentId: "intent-recovery",
  });
  assert.equal(result.failure.code, "reconciliation-required");
  assert.equal(durable.attempts.values().next().value.state, "UNKNOWN");
  assert.equal(durable.reconciliation.outcome, "UNKNOWN");
});

test("a fresh adapter replays the complete saved child response", async () => {
  const durable = store();
  let calls = 0;
  const host = { invokeSiblingSkill: async () => (++calls, completed()) };
  const first = createHostInvocationAdapter({ capabilities, cursorStore: durable, host });
  const expected = await first.invoke(request(), { cursorId: "cursor-recovery" });
  const second = createHostInvocationAdapter({ capabilities, cursorStore: durable, host });
  const replay = await second.invoke(request(), { cursorId: "cursor-recovery" });
  assert.deepEqual(replay, expected);
  assert.deepEqual(replay.technical, expected.technical);
  assert.deepEqual(replay.functional, expected.functional);
  assert.equal(calls, 1);
});
