"use strict";

import { createHash } from "node:crypto";

// T011: hybrid dynamic scheduler. A model may propose a set of tasks/workers;
// this module validates the proposal against the declared capability policy and
// compiles the accepted set into canonical csm-orchestrate-phase/2 route nodes.
// Compiled nodes are the SAME shape the phase loop's executeNode consumes, so a
// proposal can never introduce a parallel dispatch path or a second authority.
// Dynamic mode is refused for the plan/execute-plan route (csm-build owns plan
// execution).

const PLAN_ROUTE_KINDS = new Set(["plan", "execute-plan", "csm-plan"]);
const READ_ONLY_EFFECTS = new Set(["read-only"]);
const SKILL_PATTERN = /^csm-[a-z0-9][a-z0-9-]{1,63}$/;
const PHASE_ID = /^phase-[a-z0-9][a-z0-9-]{1,127}$/;
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;

export class DynamicProposalError extends Error {
  constructor(code, message, info = {}) {
    super(message);
    this.name = "DynamicProposalError";
    this.code = code;
    Object.assign(this, info);
  }
}

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

function shortHash(...parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function assertDynamicModeAllowed({
  routeKind = "research",
  approved = false,
  capability = null,
} = {}) {
  const normalized = String(routeKind ?? "").toLowerCase();
  if (PLAN_ROUTE_KINDS.has(normalized))
    throw new DynamicProposalError(
      "dynamic-refused-plan-route",
      `dynamic mode is refused for the ${normalized} route: plan execution is owned by csm-build`,
    );
  if (approved !== true)
    throw new DynamicProposalError(
      "dynamic-approval-required",
      "dynamic mode requires an explicit approval grant",
    );
  if (capability && !capability.decomposition)
    throw new DynamicProposalError(
      "dynamic-policy-undeclared",
      `skill ${capability.skill ?? "unknown"} does not declare a decomposition policy`,
    );
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const dependency of byId.get(nodeId)?.dependencies ?? [])
      if (!visit(dependency)) return false;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  for (const node of nodes) if (!visit(node.nodeId)) return false;
  return true;
}

export function validateProposedSet(
  proposal,
  { capabilities, approved = false, routeKind = "research", maxAgents = 64 } = {},
) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal))
    throw new DynamicProposalError("dynamic-proposal-invalid", "proposal must be an object");
  if (!PHASE_ID.test(String(proposal.phaseId ?? "")))
    throw new DynamicProposalError(
      "dynamic-proposal-invalid",
      "proposal.phaseId must be canonical",
    );
  if (!Array.isArray(proposal.nodes) || proposal.nodes.length === 0)
    throw new DynamicProposalError("dynamic-proposal-invalid", "proposal.nodes must be non-empty");

  assertDynamicModeAllowed({ routeKind, approved });

  const capabilityBySkill = new Map(
    (capabilities?.skills ?? []).map((capability) => [capability.skill, capability]),
  );
  const perSkill = new Map();
  const nodeIds = new Set();
  const seenTasks = new Set();
  const compiled = [];

  proposal.nodes.forEach((node, index) => {
    const taskKey = node?.taskId ?? node?.nodeId ?? `t${index + 1}`;
    if (seenTasks.has(taskKey))
      throw new DynamicProposalError(
        "dynamic-duplicate-task",
        `duplicate proposed task id: ${String(taskKey)}`,
      );
    seenTasks.add(taskKey);
    const skill = node?.skill;
    if (typeof skill !== "string" || !SKILL_PATTERN.test(skill))
      throw new DynamicProposalError(
        "dynamic-unknown-skill",
        `unknown or invalid skill: ${String(skill)}`,
      );
    const capability = capabilityBySkill.get(skill);
    if (!capability)
      throw new DynamicProposalError(
        "dynamic-unknown-skill",
        `skill ${skill} is not in the capability manifest`,
      );
    if (skill === "csm-orchestrate")
      throw new DynamicProposalError(
        "dynamic-self-route-refused",
        "csm-orchestrate cannot be proposed as a worker",
      );
    if (!capability.decomposition)
      throw new DynamicProposalError(
        "dynamic-policy-undeclared",
        `skill ${skill} does not declare a decomposition policy`,
      );

    const effects =
      Array.isArray(node?.effects) && node.effects.length ? node.effects : ["read-only"];
    for (const effect of effects)
      if (!capability.effects.includes(effect))
        throw new DynamicProposalError(
          "dynamic-undeclared-effect",
          `skill ${skill} does not declare effect ${effect}`,
        );
    if (
      effects.some((effect) => !READ_ONLY_EFFECTS.has(effect)) &&
      capability.approvalClass === "none"
    )
      throw new DynamicProposalError(
        "dynamic-effect-requires-approval",
        `skill ${skill} proposes a side effect without an approval class`,
      );

    const bound = capability.bounds?.maxConcurrency;
    const used = (perSkill.get(skill) ?? 0) + 1;
    if (Number.isInteger(bound) && used > bound)
      throw new DynamicProposalError(
        "dynamic-per-skill-bound-exceeded",
        `skill ${skill} exceeds its declared maxConcurrency ${bound}`,
      );
    perSkill.set(skill, used);

    const nodeId = `edge-${slug(taskKey)}-${weakSuffix(taskKey, skill)}`;
    nodeIds.add(nodeId);
    compiled.push({ node, nodeId, skill, capability, effects, index, taskKey });
  });

  if (compiled.length > maxAgents)
    throw new DynamicProposalError(
      "dynamic-over-budget",
      `proposal exceeds maxAgents ${maxAgents} (received ${compiled.length})`,
    );

  const provisional = compiled.map((entry) => ({
    nodeId: entry.nodeId,
    dependencies: (entry.node.dependencies ?? []).map((taskId) => {
      const match = compiled.find((candidate) => candidate.taskKey === taskId);
      if (!match)
        throw new DynamicProposalError(
          "dynamic-unknown-dependency",
          `node ${entry.taskKey} depends on unknown task ${taskId}`,
        );
      return match.nodeId;
    }),
  }));
  if (!assertAcyclic(provisional))
    throw new DynamicProposalError(
      "dynamic-dependency-cycle",
      "proposed worker set contains a dependency cycle",
    );

  const requirementId = `req-${slug(proposal.phaseId).slice(0, 60)}`;
  const routeNodes = compiled.map((entry) => {
    const dep = provisional.find((candidate) => candidate.nodeId === entry.nodeId);
    const readOnly = entry.effects.every((effect) => READ_ONLY_EFFECTS.has(effect));
    return {
      nodeId: entry.nodeId,
      skill: entry.skill,
      capabilityDigest: entry.capability.digest,
      weight: 1,
      dependencies: dep.dependencies,
      ordering: entry.index,
      parallelGroup: readOnly ? "read-only" : null,
      requirementIds: [requirementId],
      acceptanceSignals: [`${entry.skill} ${entry.taskKey} acceptance`],
      acceptanceSignalIds: [`sig-${slug(entry.taskKey)}-${weakSuffix(entry.taskKey, entry.skill)}`],
      approvalScope: [...(entry.capability.permissions ?? [])],
      evidence: [],
      inputs: [],
      outputs: [],
      sideEffects: entry.effects,
      idempotency: {
        key: `${proposal.phaseId}:${entry.nodeId}`,
        mode: readOnly ? "read-only" : "required",
      },
    };
  });

  return { phaseId: proposal.phaseId, requirementId, routeNodes };
}

function weakSuffix(...parts) {
  return shortHash(...parts).slice(0, 8);
}

export function compileDynamicPhase(proposal, context = {}) {
  const { routeNodes, requirementId } = validateProposedSet(proposal, context);
  const header = `phase-${slug(proposal.phaseId).slice(0, 60)}-${shortHash(proposal.phaseId).slice(0, 8)}`;
  const phase = {
    schema: "csm-orchestrate-phase/2",
    phaseId: header,
    parentPhaseId: context.parentPhaseId ?? null,
    runId: context.runId,
    graphRevision: context.graphRevision ?? 1,
    insertion: { mode: "append", ordinal: context.ordinal ?? 0 },
    owner: "csm-orchestrate",
    route: "csm-orchestrate",
    routeNodes,
    requirementIds: [requirementId],
    acceptanceSignals: routeNodes.map((node) => `${node.skill} ${node.nodeId} acceptance`),
    acceptanceSignalIds: routeNodes.map((node) => `${node.acceptanceSignalIds[0]}`),
    approvalScope: [...new Set(routeNodes.flatMap((node) => node.approvalScope))],
    idempotency: { key: `phase:${header}`, mode: "required" },
    remediationBudget: 0,
    status: "planned",
    dependencies: [],
    handoffEdges: [],
  };
  if (!RUN_ID.test(String(phase.runId ?? "")))
    throw new DynamicProposalError(
      "dynamic-proposal-invalid",
      "compileDynamicPhase requires a canonical runId",
    );
  return phase;
}
