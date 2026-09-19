"use strict";

// T004: the per-point decision registry. Each point names the seam whose
// behavior it may influence, the answer type Jev returns, the criteria record
// keys, the deterministic fallback the harness keeps when Jev is absent, the
// safety class, and whether the point may apply (change behavior) or is
// advisory only. Only non-safety points may apply; every acceptance, security,
// and completion gate stays deterministic (see the never-Jev boundary).

export const DECISION_POINT_SCHEMA = "csm-orchestrate-decision-points/1";
export const DECISION_POINT_SCHEMA_REVISION = 1;

export const DECISION_SEAMS = Object.freeze([
  "request-router",
  "csm-build",
  "csm-plan",
  "csm-review",
  "skill-selection",
]);

export const DECISION_TYPES = Object.freeze(["choice", "score", "noul"]);
export const SAFETY_CLASSES = Object.freeze(["non-safety", "safety", "authority"]);
export const APPLY_VS_ADVISORY = Object.freeze(["apply", "advisory"]);

export const DECISION_POINT_FIELDS = Object.freeze([
  "id",
  "seam",
  "type",
  "criteria",
  "fallback",
  "safetyClass",
  "applyVsAdvisory",
]);

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateDecisionPoint(point) {
  if (!isPlainObject(point)) return { valid: false, errors: ["point must be an object"] };
  const errors = [];
  for (const field of DECISION_POINT_FIELDS)
    if (!Object.hasOwn(point, field)) errors.push(`missing ${field}`);
  for (const key of Object.keys(point))
    if (!DECISION_POINT_FIELDS.includes(key)) errors.push(`unknown field ${key}`);
  if (!ID_PATTERN.test(String(point.id ?? ""))) errors.push("id must match ^[a-z][a-z0-9-]{1,63}$");
  if (!DECISION_SEAMS.includes(point.seam))
    errors.push(`seam must be one of ${DECISION_SEAMS.join(", ")}`);
  if (!DECISION_TYPES.includes(point.type))
    errors.push(`type must be one of ${DECISION_TYPES.join(", ")}`);
  if (!Array.isArray(point.criteria) || point.criteria.length < 1) {
    errors.push("criteria must be a non-empty array");
  } else {
    if (!point.criteria.every((criterion) => typeof criterion === "string" && criterion.length > 0))
      errors.push("criteria entries must be non-empty strings");
    if (new Set(point.criteria).size !== point.criteria.length)
      errors.push("criteria must be unique");
  }
  if (typeof point.fallback !== "string" || point.fallback.length < 1)
    errors.push("fallback must be a non-empty string");
  if (!SAFETY_CLASSES.includes(point.safetyClass))
    errors.push(`safetyClass must be one of ${SAFETY_CLASSES.join(", ")}`);
  if (!APPLY_VS_ADVISORY.includes(point.applyVsAdvisory))
    errors.push(`applyVsAdvisory must be one of ${APPLY_VS_ADVISORY.join(", ")}`);
  if (point.applyVsAdvisory === "apply" && point.safetyClass !== "non-safety")
    errors.push("only non-safety points may apply");
  return { valid: errors.length === 0, errors };
}

function definePoint(definition) {
  const point = Object.freeze({
    ...definition,
    criteria: Object.freeze([...definition.criteria]),
  });
  const { valid, errors } = validateDecisionPoint(point);
  if (!valid)
    throw new TypeError(
      `invalid decision point ${definition.id ?? "<unknown>"}: ${errors.join("; ")}`,
    );
  return point;
}

export const decisionPoints = Object.freeze(
  [
    {
      id: "route-classification",
      seam: "request-router",
      type: "choice",
      criteria: ["route", "deterministic-match", "explicit-mode"],
      fallback: "deterministic-route",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "spike-candidacy",
      seam: "csm-build",
      type: "choice",
      criteria: ["spike-value", "risk", "reversibility"],
      fallback: "harness-spike-selection",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "ready-set-ordering",
      seam: "csm-build",
      type: "score",
      criteria: ["dependency-ready", "critical-path", "batch-width"],
      fallback: "deterministic-ready-set",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "deep-research-dispatch",
      seam: "csm-plan",
      type: "choice",
      criteria: ["evidence-gap", "external-need", "budget"],
      fallback: "deterministic-dispatch",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "review-assignment",
      seam: "csm-review",
      type: "choice",
      criteria: ["add-only", "coverage-gap", "reviewer-fit"],
      fallback: "deterministic-reviewer-set",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "secret-preflag",
      seam: "csm-review",
      type: "noul",
      criteria: ["secret-likelihood", "redaction", "false-positive-cost"],
      fallback: "no-preflag",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "conditional-skill-ranking",
      seam: "skill-selection",
      type: "score",
      criteria: ["repo-signal", "task-signal", "explicit-mode-exclusion"],
      fallback: "deterministic-skill-order",
      safetyClass: "non-safety",
      applyVsAdvisory: "apply",
    },
    {
      id: "critique-severity",
      seam: "csm-plan",
      type: "score",
      criteria: ["severity", "evidence-strength"],
      fallback: "deterministic-severity",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
    },
    {
      id: "task-risk",
      seam: "csm-plan",
      type: "score",
      criteria: ["risk", "blast-radius", "reversibility"],
      fallback: "deterministic-risk",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
    },
    {
      id: "evidence-class-bucketing",
      seam: "csm-review",
      type: "choice",
      criteria: ["evidence-class", "source-kind"],
      fallback: "deterministic-evidence-class",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
    },
    {
      id: "semantic-dedup",
      seam: "csm-review",
      type: "score",
      criteria: ["similarity", "finding-identity"],
      fallback: "deterministic-dedup",
      safetyClass: "non-safety",
      applyVsAdvisory: "advisory",
    },
    {
      id: "severity-bucketing",
      seam: "csm-review",
      type: "choice",
      criteria: ["severity", "finding-class"],
      fallback: "deterministic-severity-bucket",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
    },
  ].map(definePoint),
);

{
  const ids = new Set(decisionPoints.map((point) => point.id));
  if (ids.size !== decisionPoints.length) throw new TypeError("duplicate decision point id");
}

export function listDecisionPoints() {
  return decisionPoints;
}

export function getDecisionPoint(id) {
  const point = decisionPoints.find((candidate) => candidate.id === id);
  if (!point)
    throw Object.assign(new TypeError(`unknown decision point: ${String(id)}`), {
      code: "unknown-decision-point",
    });
  return point;
}

// The compiled registry form: JSON-serializable and byte-comparable against
// csm-orchestrate/decision-points.json (a test asserts they stay in lockstep).
export function serializeDecisionPoints() {
  return {
    schema: DECISION_POINT_SCHEMA,
    schemaRevision: DECISION_POINT_SCHEMA_REVISION,
    points: decisionPoints.map((point) => ({
      id: point.id,
      seam: point.seam,
      type: point.type,
      criteria: [...point.criteria],
      fallback: point.fallback,
      safetyClass: point.safetyClass,
      applyVsAdvisory: point.applyVsAdvisory,
    })),
  };
}

export default {
  DECISION_POINT_SCHEMA,
  DECISION_POINT_SCHEMA_REVISION,
  DECISION_SEAMS,
  DECISION_TYPES,
  SAFETY_CLASSES,
  APPLY_VS_ADVISORY,
  DECISION_POINT_FIELDS,
  decisionPoints,
  validateDecisionPoint,
  listDecisionPoints,
  getDecisionPoint,
  serializeDecisionPoints,
};
