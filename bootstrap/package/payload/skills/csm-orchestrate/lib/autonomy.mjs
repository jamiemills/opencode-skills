"use strict";

const readOnly = (effects) => (effects ?? []).every((effect) => effect === "read-only");

export function createAutonomyPolicy(
  capabilities,
  { now = () => new Date(), ttlMs = 3_600_000 } = {},
) {
  const manifest = Array.isArray(capabilities) ? capabilities : (capabilities?.skills ?? []);
  const capabilityBySkill = new Map(manifest.map((capability) => [capability.skill, capability]));
  return async function autonomyApprovals({ phase, node, childRunId } = {}) {
    if (!phase || !node || !childRunId) return undefined;
    if (!readOnly(node.sideEffects)) return undefined;
    const capability = capabilityBySkill.get(node.skill);
    if (!capability || !readOnly(capability.effects)) return undefined;
    if (
      !capability.digest ||
      !Array.isArray(capability.permissions) ||
      !capability.permissions.length
    )
      return undefined;
    const approvedAt = new Date(now());
    const expiresAt = new Date(approvedAt.getTime() + ttlMs);
    return Object.freeze({
      schema: "csm-orchestrate-approval/2",
      approvalId: `approval-auto-${childRunId}`,
      binding: {
        parentRunId: phase.runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: [...capability.permissions],
      approvedDigest: capability.digest,
      approvedAt: approvedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "approved",
    });
  };
}
