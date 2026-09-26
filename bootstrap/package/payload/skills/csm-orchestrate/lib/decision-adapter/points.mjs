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
  "csm-review-python",
  "csm-deep-research",
  "csm-autoresearch",
  "csm-bdd-tdd",
  "csm-orchestrate-review",
  "skill-selection",
]);

export const DECISION_TYPES = Object.freeze(["choice", "score", "noul"]);
export const SAFETY_CLASSES = Object.freeze(["non-safety", "safety", "authority"]);
export const APPLY_VS_ADVISORY = Object.freeze(["apply", "advisory"]);

// T005: the required fields stay frozen; `question` is an optional per-point
// typed-question spec (instructions, criteria, legend) consumed by
// question-protocol.mjs to build the live Jev request.
export const DECISION_POINT_REQUIRED_FIELDS = Object.freeze([
  "id",
  "seam",
  "type",
  "criteria",
  "fallback",
  "safetyClass",
  "applyVsAdvisory",
]);

export const DECISION_POINT_FIELDS = Object.freeze([...DECISION_POINT_REQUIRED_FIELDS, "question"]);

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateDecisionPoint(point) {
  if (!isPlainObject(point)) return { valid: false, errors: ["point must be an object"] };
  const errors = [];
  for (const field of DECISION_POINT_REQUIRED_FIELDS)
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
    // T005: the review/judge/adversarial-role advisory points. Every one is
    // safety/authority + advisory: Jev may pre-flag and prioritize, but the
    // role, the deterministic gates, and the closure/acceptance records stay
    // harness-owned. Each carries a typed `question` for the live API.
    {
      id: "review-challenger-verdict",
      seam: "csm-review",
      type: "choice",
      criteria: ["agree", "downgrade", "retract", "new_finding"],
      fallback: "deterministic-challenger-verdict",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "Act as an independent adversarial challenger. Assuming the finding is false until the quoted evidence proves it true, does the evidence support the finding and its proposed severity/confidence?",
        criteria: {
          agree: "Evidence fully supports the finding and its proposed severity/confidence",
          downgrade: "The finding is real but its severity or confidence is overstated",
          retract: "The evidence does not support the finding",
          new_finding: "The evidence reveals a different, additional real finding",
        },
      },
    },
    {
      id: "deep-research-challenger-verdict",
      seam: "csm-deep-research",
      type: "choice",
      criteria: ["uphold", "downgrade", "retract", "suggest_new_claim"],
      fallback: "deterministic-challenger-verdict",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "As an anti-anchored challenger, does the cited claim hold against the quoted evidence? Assume the claim is false until the evidence proves it true.",
        criteria: {
          uphold: "Evidence supports the claim as written",
          downgrade: "The claim overstates the evidence",
          retract: "The evidence does not support the claim",
          suggest_new_claim: "A missing claim should be added",
        },
      },
    },
    {
      id: "deep-research-judge-factual-accuracy",
      seam: "csm-deep-research",
      type: "score",
      criteria: [
        "unsupported",
        "mostly-unsupported",
        "mixed",
        "mostly-supported",
        "fully-supported",
      ],
      fallback: "no-advisory",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions: "Judge the factual accuracy of the draft against its cited references.",
        criteria: [
          "Unsupported/contradicted",
          "Mostly unsupported",
          "Mixed",
          "Mostly supported",
          "Fully supported",
        ],
      },
    },
    {
      id: "deep-research-judge-citation-accuracy",
      seam: "csm-deep-research",
      type: "score",
      criteria: ["wrong", "loose", "mixed", "mostly-correct", "supported"],
      fallback: "no-advisory",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions: "Does each citation actually support the claim it is attached to?",
        criteria: [
          "Wrong citations",
          "Loose mapping",
          "Mixed",
          "Mostly correct",
          "Every citation supports its claim",
        ],
      },
    },
    {
      id: "deep-research-judge-completeness",
      seam: "csm-deep-research",
      type: "score",
      criteria: ["mostly-missing", "several-missing", "mixed", "one-missing", "complete"],
      fallback: "no-advisory",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions: "Are all required sections present and non-empty?",
        criteria: [
          "Mostly missing",
          "Several missing",
          "Mixed",
          "One missing",
          "All present and substantive",
        ],
      },
    },
    {
      id: "deep-research-judge-clarity",
      seam: "csm-deep-research",
      type: "score",
      criteria: ["illegible", "hard-to-follow", "mixed", "mostly-clear", "clear"],
      fallback: "no-advisory",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions: "Is the finding legible to a reader without the research notes?",
        criteria: ["Illegible", "Hard to follow", "Mixed", "Mostly clear", "Fully clear"],
      },
    },
    {
      id: "python-review-judge-severity",
      seam: "csm-review-python",
      type: "choice",
      criteria: ["C", "R", "W", "E", "F", "Nit"],
      fallback: "deterministic-severity",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "For an idiomatic-Python review finding, choose the urgency band. C = convention, R = refactor, W = warning, E = error/probable bug, F = fatal, Nit = trivial.",
        criteria: {
          C: "Convention deviation with no runtime effect",
          R: "Refactor opportunity",
          W: "Warning; not a definite bug",
          E: "Error or probable bug",
          F: "Fatal defect or data-loss risk",
          Nit: "Trivial style nit",
        },
      },
    },
    {
      id: "python-review-dedup",
      seam: "csm-review-python",
      type: "score",
      criteria: ["distinct", "weak", "moderate", "strong", "duplicate"],
      fallback: "deterministic-dedup",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions: "How similar is this candidate finding to the other candidate?",
        criteria: [
          "Distinct",
          "Weakly related",
          "Moderately related",
          "Strongly related",
          "Duplicate",
        ],
      },
    },
    {
      id: "build-review-verdict",
      seam: "csm-build",
      type: "choice",
      criteria: ["pass", "needs_repair", "fail", "uncertain"],
      fallback: "deterministic-review-verdict",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "As an independent reviewer of this integrated change, does the evidence support passing this review track?",
        criteria: {
          pass: "No material issue in this track",
          needs_repair: "A bounded repair is required",
          fail: "The change does not satisfy this track",
          uncertain: "Evidence is insufficient to decide",
        },
      },
    },
    {
      id: "autoresearch-judge-ranking",
      seam: "csm-autoresearch",
      type: "score",
      criteria: ["worst", "poor", "average", "good", "best"],
      fallback: "deterministic-judge-ranking",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "Rank this blinded candidate against the others for the stated optimization target.",
        criteria: ["Worst", "Poor", "Average", "Good", "Best"],
      },
    },
    {
      id: "bdd-tdd-validation-verdict",
      seam: "csm-bdd-tdd",
      type: "choice",
      criteria: ["valid", "needs_repair", "invalid"],
      fallback: "deterministic-validation-verdict",
      safetyClass: "safety",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "Does this scenario fail for the right reason and go green only when the correct behavior is implemented?",
        criteria: {
          valid: "Fails for the right reason; strictness holds",
          needs_repair: "Bounded repair required",
          invalid: "Passes before implementation or fails for the wrong reason",
        },
      },
    },
    {
      id: "orchestrate-reviewer-finding",
      seam: "csm-orchestrate-review",
      type: "choice",
      criteria: ["uphold", "downgrade", "retract", "missing-evidence", "suggest-new-requirement"],
      fallback: "deterministic-reviewer-finding",
      safetyClass: "authority",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "As the independent final reviewer, classify this claim against the requirement, evidence, and artifact identity you were given. Advisory context only; the deterministic acceptance gate is not affected.",
        criteria: {
          uphold: "Requirement supported by evidence",
          downgrade: "Partially supported; scope is overstated",
          retract: "Not supported by the evidence",
          "missing-evidence": "No evidence supplied for a stated requirement",
          "suggest-new-requirement": "A missing requirement should be added",
        },
      },
    },
    {
      id: "trace-emission-verdict",
      seam: "csm-orchestrate-review",
      type: "noul",
      criteria: ["trace-present", "runid-match", "shipped-with-audit"],
      fallback: "deterministic-trace-verdict",
      safetyClass: "authority",
      applyVsAdvisory: "advisory",
      question: {
        instructions:
          "Given the run id and the trace-log verification summary (path and counts only), does the evidence indicate the run emitted its action traces? Advisory only; the deterministic verifier remains authoritative.",
        criteria: {
          true: "The evidence indicates the run's traces were emitted",
          false: "The evidence indicates the run's traces are missing",
        },
      },
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
