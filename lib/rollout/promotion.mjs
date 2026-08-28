"use strict";

import { RolloutError, deepFreeze, isPlainObject } from "./internal.mjs";

export const PROMOTION_REVIEW_FORMAT = "csm-promotion-review/1";
export const GATE_EVIDENCE_SOURCES = Object.freeze(["local", "deployment"]);

export const GATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "G0",
    name: "contract safety",
    evidenceSources: Object.freeze(["local", "deployment"]),
  }),
  Object.freeze({
    id: "G1",
    name: "config assurance",
    evidenceSources: Object.freeze(["local", "deployment"]),
  }),
  Object.freeze({
    id: "G2",
    name: "authorization",
    evidenceSources: Object.freeze(["local", "deployment"]),
  }),
  Object.freeze({
    id: "G3",
    name: "host execution assurance",
    evidenceSources: Object.freeze(["local", "deployment"]),
  }),
  Object.freeze({
    id: "G4",
    name: "durable execution",
    evidenceSources: Object.freeze(["local", "deployment"]),
  }),
  Object.freeze({
    id: "G5",
    name: "independent acceptance",
    evidenceSources: Object.freeze(["deployment"]),
  }),
  Object.freeze({
    id: "G6",
    name: "telemetry completeness",
    evidenceSources: Object.freeze(["deployment"]),
  }),
  Object.freeze({
    id: "G7",
    name: "held-out evaluation",
    evidenceSources: Object.freeze(["deployment"]),
  }),
  Object.freeze({
    id: "G8",
    name: "canary/rollback",
    evidenceSources: Object.freeze(["deployment"]),
  }),
]);

const GATE_IDS = new Set(GATE_DEFINITIONS.map((definition) => definition.id));

export class PromotionError extends RolloutError {}

function readContainer(evidence, key) {
  const container = evidence[key] ?? {};
  if (!isPlainObject(container))
    throw new PromotionError(
      "invalid-evidence",
      `promotion evidence '${key}' must be a plain object`,
    );
  for (const gateId of Object.keys(container))
    if (!GATE_IDS.has(gateId))
      throw new PromotionError("invalid-evidence", `unknown gate '${gateId}' in ${key} evidence`);
  return container;
}

function parseCounts(value, gateId, source) {
  const label = `gate ${gateId} (${source})`;
  if (!isPlainObject(value))
    throw new PromotionError("invalid-evidence", `${label} evidence must be a plain object`);
  const { passed, failed, details } = value;
  if (!Number.isInteger(passed) || passed < 0)
    throw new PromotionError(
      "invalid-evidence",
      `${label} evidence 'passed' must be a non-negative integer`,
    );
  if (!Number.isInteger(failed) || failed < 0)
    throw new PromotionError(
      "invalid-evidence",
      `${label} evidence 'failed' must be a non-negative integer`,
    );
  if (details !== undefined && typeof details !== "string")
    throw new PromotionError("invalid-evidence", `${label} evidence 'details' must be a string`);
  return { passed, failed, details: details ?? null };
}

export function checkPromotionGates(evidence) {
  if (!isPlainObject(evidence))
    throw new PromotionError("invalid-evidence", "promotion evidence must be a plain object");
  for (const key of Object.keys(evidence))
    if (!GATE_EVIDENCE_SOURCES.includes(key))
      throw new PromotionError(
        "invalid-evidence",
        `evidence key '${key}' is unknown (allowed: ${GATE_EVIDENCE_SOURCES.join(", ")})`,
      );
  const local = readContainer(evidence, "local");
  const deployment = readContainer(evidence, "deployment");
  const gates = GATE_DEFINITIONS.map((definition) => {
    const acceptsLocal = definition.evidenceSources.includes("local");
    const localValue = local[definition.id];
    const deploymentValue = deployment[definition.id];
    const ignoredLocalEvidence = !acceptsLocal && localValue !== undefined;
    let source = null;
    let value = null;
    if (deploymentValue !== undefined) {
      source = "deployment";
      value = deploymentValue;
    } else if (acceptsLocal && localValue !== undefined) {
      source = "local";
      value = localValue;
    }
    const gate = { id: definition.id, name: definition.name };
    if (ignoredLocalEvidence) gate.ignoredLocalEvidence = true;
    if (source === null) {
      gate.status = "blocked";
      gate.reason = acceptsLocal ? "no-evidence" : "deployment-evidence-required";
      gate.evidence = null;
      return gate;
    }
    const counts = parseCounts(value, definition.id, source);
    gate.evidence = {
      source,
      passed: counts.passed,
      failed: counts.failed,
      details: counts.details,
    };
    if (counts.failed > 0) gate.status = "fail";
    else if (counts.passed > 0) gate.status = "pass";
    else {
      gate.status = "blocked";
      gate.reason = "no-positive-evidence";
    }
    return gate;
  });
  return deepFreeze({
    format: PROMOTION_REVIEW_FORMAT,
    promotable: gates.every((gate) => gate.status === "pass"),
    gates,
  });
}
