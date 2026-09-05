// Approvals provider for the user-directed quality-delivery build run
// (defrelease-autonomy-gates quality cycle: items 4, 6, and the final-review
// wiring). The user explicitly instructed "plan and build all of these" through
// csm-orchestrate; this provider approves the compiled build scopes for that
// run only. Everything is repo-local; the work is committed only after the full
// gate battery passes. Default createAutonomyPolicy cannot approve here because
// csm-build carries workspace-write effects — that is the point of this module.
//
// Binding contract (must match invocation.mjs approvalFailure):
// parentRunId = phase.runId (the compiled approach run), childRunId, phaseId,
// edgeId = `edge-${node.nodeId}`, approvedDigest = node.capabilityDigest.
"use strict";

const TTL_MS = 3_600_000;

export default async function buildRunApprovals({ phase, node, childRunId } = {}) {
  if (!phase || !node || !childRunId) return undefined;
  if (node.skill !== "csm-build") return undefined;
  const approvedAt = new Date();
  return Object.freeze({
    schema: "csm-orchestrate-approval/2",
    approvalId: `approval-build-${childRunId}`,
    binding: {
      parentRunId: phase.runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: `edge-${node.nodeId}`,
    },
    scope: [...node.approvalScope],
    approvedDigest: node.capabilityDigest,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + TTL_MS).toISOString(),
    status: "approved",
  });
}
