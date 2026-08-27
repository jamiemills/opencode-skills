"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";
import { assertSchema } from "./contracts.mjs";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const PHASE_ID = /^phase-[a-z0-9][a-z0-9-]{1,127}$/;
const EDGE_ID = /^edge-[a-z0-9][a-z0-9-]{1,127}$/;
const CURSOR_ID = /^cursor-[a-z0-9][a-z0-9-]{1,127}$/;
const READ_ONLY = new Set(["read-only"]);
const TERMINAL_CHILD_CLASSES = new Set(["child", "policy", "evaluator"]);
const RETRYABLE_FAILURES = new Set(["transport", "timeout", "incomplete"]);
const cursorWriteQueues = new WeakMap();

export function projectChildStatus(childReceipts = []) {
  if (!childReceipts.length) return "not-started";
  if (childReceipts.some((item) => item.status === "failed")) return "failed";
  if (childReceipts.some((item) => item.status === "blocked" || item.status === "incomplete"))
    return "blocked";
  if (childReceipts.some((item) => item.status === "running")) return "running";
  return "completed";
}

const fail = (message) => {
  throw new TypeError(`invalid recovery contract: ${message}`);
};

function assertIdentity(cursor) {
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) fail("cursor is required");
  for (const [name, value, pattern] of [
    ["cursorId", cursor.cursorId, CURSOR_ID],
    ["runId", cursor.runId, RUN_ID],
    ["phaseId", cursor.phaseId, PHASE_ID],
  ])
    if (!pattern.test(value ?? "")) fail(`${name} is not canonical`);
  if (cursor.edgeId !== undefined && !EDGE_ID.test(cursor.edgeId)) fail("edgeId is not canonical");
  if (cursor.childRunId !== undefined && !RUN_ID.test(cursor.childRunId))
    fail("childRunId is not canonical");
}

export function createParentCursor({
  cursorId,
  runId,
  phaseId,
  edgeId = null,
  routeNodeId = null,
  childRunId = null,
  routeState = "not-selected",
  checkpointState = "none",
  attempt = 0,
  idempotencyKey,
  childReceiptIds = [],
  sideEffects = [],
  materialFingerprint = null,
  terminalBlocker = null,
  approvalBinding = null,
  terminalIntent = null,
  updatedAt = new Date().toISOString(),
} = {}) {
  const cursor = {
    schema: "csm-orchestrate-cursor/2",
    cursorId,
    runId,
    phaseId,
    ...(edgeId ? { edgeId } : {}),
    ...(routeNodeId ? { routeNodeId } : {}),
    ...(childRunId ? { childRunId } : {}),
    routeState,
    checkpointState,
    attempt,
    idempotencyKey,
    childReceiptIds: [...new Set(childReceiptIds)],
    ...(sideEffects.length ? { sideEffects: [...new Set(sideEffects)] } : {}),
    ...(materialFingerprint ? { materialFingerprint } : {}),
    ...(terminalBlocker ? { terminalBlocker } : {}),
    ...(approvalBinding ? { approvalBinding } : {}),
    ...(terminalIntent ? { terminalIntent } : {}),
    updatedAt,
  };
  assertIdentity(cursor);
  if (!Number.isInteger(attempt) || attempt < 0) fail("attempt must be non-negative");
  if (!idempotencyKey) fail("idempotencyKey is required");
  return Object.freeze(cursor);
}

export async function persistCursor(cursor, store) {
  assertIdentity(cursor);
  await assertSchema(cursor.schema, cursor);
  if (!store || typeof store.saveCursor !== "function")
    throw new TypeError("durable cursor store is required; memory is not durable");
  const previous = cursorWriteQueues.get(store) ?? Promise.resolve();
  const write = previous.then(() => store.saveCursor(cursor));
  cursorWriteQueues.set(
    store,
    write.catch(() => {}),
  );
  const saved = await write;
  if (saved === false) throw new Error("durable cursor store rejected checkpoint");
  return cursor;
}

export async function loadCursor(cursorId, store, expected = {}) {
  if (!store || typeof store.loadCursor !== "function")
    throw new TypeError("durable cursor store is required; memory is not durable");
  const cursor = await store.loadCursor(cursorId);
  if (!cursor) return null;
  assertIdentity(cursor);
  await assertSchema(cursor.schema, cursor);
  if (
    cursor.cursorId !== cursorId ||
    (expected.runId && cursor.runId !== expected.runId) ||
    (expected.phaseId && cursor.phaseId !== expected.phaseId) ||
    (expected.routeNodeId && cursor.routeNodeId !== expected.routeNodeId) ||
    (expected.edgeId && cursor.edgeId !== expected.edgeId)
  )
    fail("loaded cursor does not match requested lookup");
  return cursor;
}

export async function persistTerminalReceipt(receipt, store) {
  if (!store || typeof store.saveTerminalReceipt !== "function")
    throw new TypeError("durable terminal receipt store is required");
  const durable = {
    schema: receipt.schema,
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    phaseId: receipt.phaseId,
    childReceipts: [...(receipt.childReceipts ?? [])],
    approval: receipt.approval,
    statuses: receipt.statuses,
    outcome: receipt.outcome,
    idempotencyKey: receipt.idempotencyKey,
    ...(receipt.extensions ? { extensions: receipt.extensions } : {}),
  };
  await assertSchema(
    durable.schema === "csm-orchestrate-receipt/1"
      ? "csm-orchestrate-receipt/1"
      : "csm-orchestrate-receipt/2",
    durable,
  );
  const saved = await store.saveTerminalReceipt(durable);
  if (saved === false) throw new Error("durable terminal receipt store rejected receipt");
  return receipt;
}

export async function loadTerminalReceipt(receiptId, store) {
  if (!store || typeof store.loadTerminalReceipt !== "function")
    throw new TypeError("durable terminal receipt store is required");
  const receipt = await store.loadTerminalReceipt(receiptId);
  if (!receipt) return null;
  await assertSchema(receipt.schema ?? "csm-orchestrate-receipt/1", receipt);
  if (receipt.receiptId !== receiptId)
    fail("loaded terminal receipt does not match requested lookup");
  return receipt;
}

export function classifyResume({
  cursor,
  phase,
  child,
  terminalRecords = [],
  artifacts = [],
  approval,
  now = new Date(),
} = {}) {
  assertIdentity(cursor);
  if (cursor.terminalBlocker) return { action: "blocked", reason: "terminal-child-blocker" };
  if (approval && new Date(approval.expiresAt).getTime() <= new Date(now).getTime())
    return { action: "blocked", reason: "approval-expired" };
  if (phase?.dependencies?.includes(cursor.phaseId))
    return { action: "blocked", reason: "route-cycle" };
  if (child?.status === "blocked" && TERMINAL_CHILD_CLASSES.has(child.failure?.class ?? "child"))
    return { action: "blocked", reason: "terminal-child-blocker" };
  const terminal = terminalRecords.filter(
    (record) => record?.childRunId === cursor.childRunId || record?.runId === cursor.childRunId,
  );
  if (terminal.length > 1) return { action: "blocked", reason: "ambiguous-terminal-child" };
  if (terminal[0]?.status === "completed")
    return { action: "reconcile", reason: "durable-terminal-child" };
  if (terminal[0] && ["failed", "blocked", "incomplete"].includes(terminal[0].status))
    return { action: "blocked", reason: "durable-terminal-child" };
  if (cursor.routeState === "complete")
    return { action: "blocked", reason: "completed-cursor-without-terminal-record" };
  if (
    ["validated", "saved"].includes(cursor.checkpointState) &&
    (cursor.sideEffects ?? child?.sideEffects ?? []).some((effect) => !READ_ONLY.has(effect)) &&
    terminal.length === 0
  )
    return { action: "blocked", reason: "ambiguous-side-effecting-checkpoint" };
  if (artifacts.some((artifact) => ["stale", "contradicted", "missing"].includes(artifact.status)))
    return { action: "replay", reason: "stale-or-lost-evidence" };
  if (child?.status === "completed") return { action: "reconcile", reason: "child-completed" };
  return {
    action:
      cursor.checkpointState === "validated" || cursor.checkpointState === "saved"
        ? "resume"
        : "restart",
    reason:
      cursor.checkpointState === "validated" || cursor.checkpointState === "saved"
        ? "validated-checkpoint"
        : "no-validated-checkpoint",
  };
}

export function retryDecision({
  failure,
  attempt = 0,
  maxAttempts = 2,
  retryability = "never",
  idempotencyMode = "forbidden",
  sideEffects = [],
} = {}) {
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 0
  )
    fail("retry bounds are invalid");
  if (attempt >= maxAttempts)
    return { action: "stop", reason: "retry-budget-exhausted", nextAttempt: attempt };
  if (!failure || !RETRYABLE_FAILURES.has(failure.class))
    return { action: "stop", reason: "non-retryable-failure", nextAttempt: attempt };
  if (retryability === "never")
    return { action: "stop", reason: "route-forbids-retry", nextAttempt: attempt };
  if (sideEffects.some((effect) => !READ_ONLY.has(effect)) && idempotencyMode === "forbidden")
    return { action: "stop", reason: "non-idempotent-side-effect", nextAttempt: attempt };
  if (
    sideEffects.some((effect) => !READ_ONLY.has(effect)) &&
    !["natural", "required"].includes(idempotencyMode)
  )
    return { action: "stop", reason: "missing-idempotency", nextAttempt: attempt };
  return { action: "retry", reason: "bounded-retry", nextAttempt: attempt + 1 };
}

export function detectDuplicate({
  idempotencyKey,
  records = [],
  artifactId,
  digest: expectedDigest,
} = {}) {
  const matches = records.filter(
    (record) =>
      (idempotencyKey && record.idempotencyKey === idempotencyKey) ||
      (artifactId && record.artifactId === artifactId),
  );
  if (matches.length === 0) return { duplicate: false };
  const conflict =
    expectedDigest && matches.some((record) => record.digest && record.digest !== expectedDigest);
  return {
    duplicate: true,
    conflict,
    existing: matches[0],
    reason: conflict ? "conflicting-result" : "duplicate-result",
  };
}

export function reconcileSideEffects({ expected = [], observed = [], idempotencyKey } = {}) {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed.map((effect) => effect.effect ?? effect));
  const missing = [...expectedSet].filter((effect) => !observedSet.has(effect));
  const duplicates = observed
    .map((effect) => effect.effect ?? effect)
    .filter((effect, index, list) => list.indexOf(effect) !== index);
  return {
    status: duplicates.length ? "blocked" : missing.length ? "incomplete" : "reconciled",
    idempotencyKey,
    missing: [...new Set(missing)],
    duplicates: [...new Set(duplicates)],
    observed: [...observedSet],
  };
}

export function classifyConcurrency(nodes = []) {
  if (!Array.isArray(nodes)) fail("route nodes are required");
  const independent =
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        (node.parallelism ??
          (node.parallelGroup === "read-only" ? "independent-read-only" : "serial")) ===
          "independent-read-only" &&
        (node.sideEffects ?? []).every((effect) => READ_ONLY.has(effect)) &&
        (node.dependencies ?? []).length === 0,
    );
  return {
    mode: independent ? "parallel-independent-read-only" : "serial",
    nodeIds: nodes.map((node) => node.nodeId),
  };
}

export function replayRoute(nodes = [], { evidence = new Set(), completed = new Set() } = {}) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return "route-cycle";
    if (visited.has(id)) return null;
    const node = byId.get(id);
    if (!node) return "lost-route-node";
    visiting.add(id);
    for (const dependency of node.dependencies ?? []) {
      const result = visit(dependency);
      if (result) return result;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const node of nodes) {
    const issue = visit(node.nodeId);
    if (issue) return { status: "blocked", reason: issue };
    if (
      completed.has(node.nodeId) &&
      (node.sideEffects ?? []).some((effect) => !READ_ONLY.has(effect))
    )
      return { status: "blocked", reason: "duplicate-side-effect", nodeId: node.nodeId };
    for (const required of node.evidence ?? [])
      if (!evidence.has(required.kind ?? required))
        return { status: "incomplete", reason: "lost-evidence", nodeId: node.nodeId };
  }
  return { status: "replayable", order: [...visited] };
}

export function autonomyGate({
  host,
  permissions,
  approvals,
  idempotency,
  route,
  evaluation,
} = {}) {
  const missing = [];
  for (const [name, value] of Object.entries({
    host,
    permissions,
    approvals,
    idempotency,
    route,
    evaluation,
  })) {
    if (!value || (typeof value === "object" && Object.keys(value).length === 0))
      missing.push(name);
  }
  return { enabled: missing.length === 0, missing };
}

export function redactTraceValue(value, key = "") {
  if (/token|secret|password|credential|authorization|api[-_]?key/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redactTraceValue(item, name)]),
    );
  return value;
}

export function createTraceEvent({
  runId,
  phaseId,
  edgeId,
  event,
  cursorId,
  data = {},
  at = new Date().toISOString(),
  eventId,
} = {}) {
  if (!RUN_ID.test(runId ?? "") || !PHASE_ID.test(phaseId ?? ""))
    fail("trace correlation IDs are required");
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("trace data must be an object");
  return Object.freeze({
    schema: "csm-orchestrate-trace/1",
    eventId:
      eventId ??
      `trace-${digest({
        runId,
        phaseId,
        ...(edgeId ? { edgeId } : {}),
        ...(cursorId ? { cursorId } : {}),
        event,
        data,
        at,
      }).slice(7, 39)}`,
    at,
    correlation: {
      runId,
      phaseId,
      ...(edgeId ? { edgeId } : {}),
      ...(cursorId ? { cursorId } : {}),
    },
    event,
    data: redactTraceValue(data),
  });
}
