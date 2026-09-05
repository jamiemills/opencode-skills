"use strict";

// Durable parent-cursor persistence for the orchestration run loop.
// Extracted from index.mjs (quality-delivery item 4).
import { createParentCursor, persistCursor } from "./recovery.mjs";
import { slug } from "./run-helpers.mjs";

async function saveCursor({
  runId,
  phase,
  node,
  childRunId,
  attempt,
  state,
  store,
  now,
  approval,
  idempotencyKey,
  terminalIntent,
  fencingToken,
}) {
  if (!store) return;
  await persistCursor(
    createParentCursor({
      cursorId: `cursor-${slug(runId)}-${slug(phase.phaseId)}-${slug(node?.nodeId ?? "phase")}`,
      runId,
      phaseId: phase.phaseId,
      edgeId: node ? `edge-${slug(node.nodeId)}` : null,
      routeNodeId: node?.nodeId ?? null,
      childRunId,
      routeState:
        state === "dispatching" ? "selected" : state === "validated" ? "collecting" : state,
      checkpointState: state === "validated" ? "validated" : "saved",
      attempt,
      idempotencyKey: idempotencyKey ?? phase.idempotency.key,
      ...(approval
        ? {
            approvalBinding: {
              approvalId: approval.approvalId,
              parentRunId: runId,
              childRunId,
              phaseId: phase.phaseId,
              edgeId: `edge-${slug(node?.nodeId ?? "phase")}`,
            },
          }
        : {}),
      ...(terminalIntent ? { terminalIntent } : {}),
      updatedAt: new Date(now()).toISOString(),
    }),
    store,
    fencingToken === undefined ? {} : { fencingToken },
  );
}

export { saveCursor };
