import assert from "node:assert/strict";
import test from "node:test";
import {
  autonomyGate,
  classifyConcurrency,
  classifyResume,
  createParentCursor,
  createTraceEvent,
  detectDuplicate,
  persistCursor,
  persistTerminalReceipt,
  reconcileSideEffects,
  replayRoute,
  retryDecision,
} from "../csm-orchestrate/lib/recovery.mjs";
import { validateDurableTerminalRecords } from "../csm-orchestrate/lib/invocation.mjs";

const ids = {
  runId: "run-parent-20260827",
  phaseId: "phase-build-20260827",
  edgeId: "edge-build",
};

const cursor = (overrides = {}) =>
  createParentCursor({
    cursorId: "cursor-build-20260827",
    ...ids,
    idempotencyKey: "phase-build-key",
    updatedAt: "2026-08-27T12:00:00Z",
    ...overrides,
  });

test("interruption resumes from the last validated edge without claiming durable memory", async () => {
  const saved = [];
  const checkpoint = cursor({ checkpointState: "validated", routeState: "collecting" });
  await persistCursor(checkpoint, { saveCursor: async (value) => saved.push(value) });
  assert.equal(saved[0].edgeId, ids.edgeId);
  assert.deepEqual(classifyResume({ cursor: checkpoint }), {
    action: "resume",
    reason: "validated-checkpoint",
  });
  await assert.rejects(() => persistCursor(checkpoint), /durable cursor store is required/);
});

test("cursor lookup rejects a record bound to another route", async () => {
  const { loadCursor } = await import("../csm-orchestrate/lib/recovery.mjs");
  await assert.rejects(
    loadCursor(
      "cursor-build-20260827",
      {
        loadCursor: async () => cursor({ routeNodeId: "node-other" }),
      },
      { ...ids, routeNodeId: "node-build" },
    ),
    /does not match requested lookup/,
  );
});

test("durable cursor and terminal receipt records must pass runtime schemas", async () => {
  await assert.rejects(
    persistCursor({ ...cursor(), unexpected: true }, { saveCursor: async () => {} }),
    /invalid csm-orchestrate-cursor\/1/,
  );
  await assert.rejects(
    persistTerminalReceipt(
      { schema: "csm-orchestrate-receipt/1" },
      { saveTerminalReceipt: async () => {} },
    ),
    /invalid csm-orchestrate-receipt\/1/,
  );
});

test("stale evidence is replayed, while a duplicate side effect is blocked", () => {
  assert.deepEqual(classifyResume({ cursor: cursor(), artifacts: [{ status: "stale" }] }), {
    action: "replay",
    reason: "stale-or-lost-evidence",
  });
  assert.deepEqual(
    detectDuplicate({
      idempotencyKey: "publish-key",
      records: [{ idempotencyKey: "publish-key" }],
    }),
    {
      duplicate: true,
      conflict: undefined,
      existing: { idempotencyKey: "publish-key" },
      reason: "duplicate-result",
    },
  );
  assert.equal(
    retryDecision({
      failure: { class: "transport" },
      retryability: "bounded",
      idempotencyMode: "forbidden",
      sideEffects: ["publication"],
    }).reason,
    "non-idempotent-side-effect",
  );
});

test("terminal child blockers and expired approvals never become retries", () => {
  assert.deepEqual(
    classifyResume({
      cursor: cursor(),
      child: { status: "blocked", failure: { class: "evaluator" } },
    }),
    { action: "blocked", reason: "terminal-child-blocker" },
  );
  assert.deepEqual(
    classifyResume({
      cursor: cursor(),
      approval: { expiresAt: "2026-08-27T11:59:59Z" },
      now: "2026-08-27T12:00:00Z",
    }),
    { action: "blocked", reason: "approval-expired" },
  );
  assert.equal(
    retryDecision({ failure: { class: "evaluator" }, retryability: "bounded", maxAttempts: 4 })
      .action,
    "stop",
  );
});

test("validated side-effecting cursor blocks restart without a durable terminal record", () => {
  assert.deepEqual(
    classifyResume({
      cursor: cursor({ checkpointState: "validated" }),
      child: { sideEffects: ["workspace-write"] },
    }),
    { action: "blocked", reason: "ambiguous-side-effecting-checkpoint" },
  );
  assert.deepEqual(
    classifyResume({
      cursor: cursor({ checkpointState: "validated" }),
      child: { sideEffects: ["workspace-write"] },
      terminalRecords: [
        {
          childRunId: cursor().childRunId,
          status: "completed",
          result: { status: "completed" },
        },
      ],
    }),
    { action: "reconcile", reason: "durable-terminal-child" },
  );
});

test("forged durable terminal records fail closed", async () => {
  const request = {
    parentRunId: ids.runId,
    childRunId: "run-child-20260827",
    phaseId: ids.phaseId,
    skill: "csm-build",
    approval: {
      approvalId: "approval-test",
      scope: ["read"],
      approvedDigest: `sha256:${"a".repeat(64)}`,
      approvedAt: "2026-08-27T00:00:00Z",
      expiresAt: "2099-08-27T00:00:00Z",
      status: "approved",
    },
    retry: { idempotencyKey: "test" },
  };
  assert.equal(
    await validateDurableTerminalRecords(
      [{ childRunId: "run-foreign-child", status: "completed", result: { status: "completed" } }],
      request,
    ),
    "durable terminal record identity mismatch",
  );
  assert.equal(
    await validateDurableTerminalRecords(
      [{ childRunId: request.childRunId, status: "completed" }],
      request,
    ),
    "malformed durable terminal record",
  );
});

test("durable child receipt status must match the child result", async () => {
  const request = {
    parentRunId: ids.runId,
    childRunId: "run-child-20260827",
    phaseId: ids.phaseId,
    skill: "csm-build",
    approval: {
      approvalId: "approval-test",
      scope: ["read"],
      approvedDigest: `sha256:${"a".repeat(64)}`,
      approvedAt: "2026-08-27T00:00:00Z",
      expiresAt: "2099-08-27T00:00:00Z",
      status: "approved",
    },
    retry: { idempotencyKey: "test" },
  };
  assert.equal(
    await validateDurableTerminalRecords(
      [
        {
          childRunId: request.childRunId,
          status: "completed",
          result: {
            status: "completed",
            childReceipt: {
              receiptId: "receipt-child-test",
              schema: "csm-build-receipt/1",
              runId: request.childRunId,
              digest: `sha256:${"b".repeat(64)}`,
              owner: request.skill,
              status: "failed",
            },
          },
        },
      ],
      request,
    ),
    "child receipt status mismatch",
  );
});

test("only dependency-free read-only nodes are classified for concurrency", () => {
  assert.equal(
    classifyConcurrency([
      { nodeId: "a", parallelism: "independent-read-only", sideEffects: [], dependencies: [] },
      {
        nodeId: "b",
        parallelism: "independent-read-only",
        sideEffects: ["read-only"],
        dependencies: [],
      },
    ]).mode,
    "parallel-independent-read-only",
  );
  assert.equal(
    classifyConcurrency([
      {
        nodeId: "a",
        parallelism: "independent-read-only",
        sideEffects: ["read-only"],
        dependencies: [],
      },
      {
        nodeId: "b",
        parallelism: "independent-read-only",
        sideEffects: ["workspace-write"],
        dependencies: [],
      },
    ]).mode,
    "serial",
  );
});

test("route replay rejects cycles and reports lost evidence", () => {
  assert.deepEqual(
    replayRoute([
      { nodeId: "a", dependencies: ["b"] },
      { nodeId: "b", dependencies: ["a"] },
    ]),
    { status: "blocked", reason: "route-cycle" },
  );
  assert.deepEqual(
    replayRoute([{ nodeId: "a", dependencies: [], evidence: [{ kind: "receipt" }] }]),
    { status: "incomplete", reason: "lost-evidence", nodeId: "a" },
  );
});

test("side effects reconcile by identity and traces redact sensitive values", () => {
  assert.equal(
    reconcileSideEffects({ expected: ["publication"], observed: [{ effect: "publication" }] })
      .status,
    "reconciled",
  );
  assert.equal(
    reconcileSideEffects({
      expected: ["publication"],
      observed: [{ effect: "publication" }, { effect: "publication" }],
    }).status,
    "blocked",
  );
  const trace = createTraceEvent({
    ...ids,
    event: "checkpoint",
    data: { token: "do-not-store", nested: { password: "also-secret" }, count: 1 },
    at: "2026-08-27T12:00:00.000Z",
  });
  assert.equal(trace.data.token, "[REDACTED]");
  assert.equal(trace.data.nested.password, "[REDACTED]");
  assert.equal(trace.data.count, 1);
});

test("autonomy remains disabled until every prerequisite is present", () => {
  assert.deepEqual(autonomyGate({}), {
    enabled: false,
    missing: ["host", "permissions", "approvals", "idempotency", "route", "evaluation"],
  });
  assert.equal(
    autonomyGate({
      host: { invokeSiblingSkill: true },
      permissions: { enforced: true },
      approvals: { enforced: true },
      idempotency: { enforced: true },
      route: { validated: true },
      evaluation: { baseline: true },
    }).enabled,
    true,
  );
});
