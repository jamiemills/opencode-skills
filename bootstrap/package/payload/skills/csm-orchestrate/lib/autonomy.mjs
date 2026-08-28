"use strict";

const isAutoApprovable = (capability, skillName) => {
  if (!capability) return false;
  if (skillName === "csm-review") return false; // R0 posture includes network calls
  if (skillName === "csm-deep-research") return false; // has network+browser permissions
  const effects = capability.effects ?? [];
  if (effects.length !== 1 || effects[0] !== "read-only") return false;
  const perms = (capability.permissions ?? []).join(",");
  if (perms !== "read" && perms !== "read,execute") return false;
  return true;
};

export function createAutonomyPolicy(
  capabilities,
  { now = () => new Date(), ttlMs = 3_600_000 } = {},
) {
  const manifest = Array.isArray(capabilities) ? capabilities : (capabilities?.skills ?? []);
  const capabilityBySkill = new Map(manifest.map((capability) => [capability.skill, capability]));
  return async function autonomyApprovals({ phase, node, childRunId } = {}) {
    if (!phase || !node || !childRunId) return undefined;
    const nodeEffects = node.sideEffects ?? [];
    if (nodeEffects.length !== 1 || nodeEffects[0] !== "read-only") return undefined;
    const capability = capabilityBySkill.get(node.skill);
    if (!isAutoApprovable(capability, node.skill)) return undefined;
    if (!capability.digest) return undefined;
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
