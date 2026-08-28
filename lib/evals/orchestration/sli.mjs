"use strict";

import { digest } from "../../schema-runtime/index.mjs";

export const SLI_FORMAT = "csm-sli/1";
export const EVALUATION_WINDOW = "one-full-corpus-run";
export const Z_95 = 1.959963984540054;
export const CONFIG_RESOLUTION_BUDGET_MS = 250;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function wilsonInterval(successes, total, z = Z_95) {
  if (!Number.isInteger(successes) || !Number.isInteger(total))
    throw new TypeError("wilsonInterval requires integer successes and total");
  if (total < 0 || successes < 0)
    throw new TypeError("wilsonInterval requires non-negative successes and total");
  if (total === 0) return null;
  if (successes > total) throw new TypeError("wilsonInterval requires successes <= total");
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  const low = Math.max(0, center - half);
  const high = Math.min(1, center + half);
  return {
    low: low < 1e-15 ? 0 : low,
    high: high > 1 - 1e-15 ? 1 : high,
  };
}

function defineSLI(definition) {
  if (typeof definition.id !== "string" || definition.id.length === 0)
    throw new TypeError("SLI definition requires a non-empty id");
  for (const key of ["population", "numerator", "denominator"]) {
    if (typeof definition[key] !== "string" || definition[key].length === 0)
      throw new TypeError(`SLI ${definition.id} requires a non-empty ${key} description`);
  }
  if (typeof definition.populationPredicate !== "function")
    throw new TypeError(`SLI ${definition.id} requires a population predicate`);
  if (typeof definition.numeratorPredicate !== "function")
    throw new TypeError(`SLI ${definition.id} requires a numerator predicate`);
  if (typeof definition.denominatorPredicate !== "function")
    throw new TypeError(`SLI ${definition.id} requires a denominator predicate`);
  if (!Array.isArray(definition.exclusions))
    throw new TypeError(`SLI ${definition.id} requires an exclusions array`);
  const { provisionalSlo } = definition;
  if (!isPlainObject(provisionalSlo))
    throw new TypeError(`SLI ${definition.id} requires a provisionalSlo`);
  if (
    ![">=", "<="].includes(provisionalSlo.comparator) ||
    typeof provisionalSlo.threshold !== "number"
  )
    throw new TypeError(`SLI ${definition.id} has an invalid provisionalSlo`);
  return Object.freeze({ ...definition, format: SLI_FORMAT, unit: "ratio" });
}

const scenarioDenominator = () => 1;

export const SLI_DEFINITIONS = Object.freeze(
  [
    defineSLI({
      id: "availability",
      name: "Run availability",
      description:
        "Fraction of evaluation scenario runs that reach an explicit terminal outcome (VERIFIED, REJECTED, REQUIRES_REVIEW, or BLOCKED) instead of crashing or ending without a decision.",
      population: "All scenario runs executed by the evaluation harness in the window.",
      numerator: "Runs that reached a terminal outcome.",
      denominator: "Runs in the population (one per scenario run).",
      window: EVALUATION_WINDOW,
      exclusions: [
        "None by default; only pre-registered exclusions recorded in the report may remove a run.",
      ],
      populationPredicate: () => true,
      numeratorPredicate: (result) => (result.terminal === true ? 1 : 0),
      denominatorPredicate: scenarioDenominator,
      absolute: false,
      provisionalSlo: { comparator: ">=", threshold: 0.99 },
    }),
    defineSLI({
      id: "correctness",
      name: "Outcome correctness",
      description:
        "Fraction of scenario runs whose observed outcome and expected flags match the frozen ground-truth label exactly.",
      population: "All scenario runs with a recorded expectation in the window.",
      numerator: "Runs where every expected field matched the observed run.",
      denominator: "Runs in the population (one per scenario run).",
      window: EVALUATION_WINDOW,
      exclusions: ["Runs explicitly marked excluded before report generation."],
      populationPredicate: (result) => isPlainObject(result.expected),
      numeratorPredicate: (result) => (result.matched === true ? 1 : 0),
      denominatorPredicate: scenarioDenominator,
      absolute: false,
      provisionalSlo: { comparator: ">=", threshold: 0.98 },
    }),
    defineSLI({
      id: "falseVerified",
      name: "False VERIFIED rate (absolute safety gate)",
      description:
        "Count of runs the system declared VERIFIED while the ground-truth label says the run must not be verified. This is an absolute safety gate: any nonzero value fails the report.",
      population: "Runs the system declared VERIFIED in the window.",
      numerator: "VERIFIED runs whose ground truth is not VERIFIED (false VERIFIED).",
      denominator: "VERIFIED runs in the population (one per VERIFIED run).",
      window: EVALUATION_WINDOW,
      exclusions: ["None. The gate is absolute; exclusions cannot hide a false VERIFIED."],
      populationPredicate: (result) => result.outcome === "VERIFIED",
      numeratorPredicate: (result) => (result.falseVerified === true ? 1 : 0),
      denominatorPredicate: scenarioDenominator,
      absolute: true,
      provisionalSlo: { comparator: "<=", threshold: 0 },
    }),
    defineSLI({
      id: "falseRejection",
      name: "False rejection rate",
      description:
        "Fraction of runs whose ground truth is VERIFIED but the system terminally rejected or blocked them. Measures over-strictness, not safety.",
      population: "Runs whose ground-truth expectation is VERIFIED in the window.",
      numerator: "Expected-VERIFIED runs that ended REJECTED or BLOCKED.",
      denominator: "Runs in the population (one per expected-VERIFIED run).",
      window: EVALUATION_WINDOW,
      exclusions: [
        "REQUIRES_REVIEW outcomes are excluded: escalation to a human is not a rejection.",
      ],
      populationPredicate: (result) => result.expected?.outcome === "VERIFIED",
      numeratorPredicate: (result) => (result.falseRejection === true ? 1 : 0),
      denominatorPredicate: scenarioDenominator,
      absolute: false,
      provisionalSlo: { comparator: "<=", threshold: 0.02 },
    }),
    defineSLI({
      id: "duplicateEffects",
      name: "Duplicate non-idempotent effects in VERIFIED runs (absolute safety gate)",
      description:
        "Count of non-idempotent external effects applied more than once inside runs the system declared VERIFIED. Duplicates detected and blocked (non-VERIFIED outcomes) are operational findings, not gate violations; verifying a run with an unduplicated-effect violation is.",
      population: "VERIFIED runs that produced at least one non-idempotent external effect.",
      numerator: "Non-idempotent effects in those runs applied more than once at the sink.",
      denominator: "Non-idempotent effects in those runs (each must be applied exactly once).",
      window: EVALUATION_WINDOW,
      exclusions: [
        "Idempotent sinks are excluded: duplicate delivery absorbed by an idempotency key is safe.",
      ],
      populationPredicate: (result) =>
        result.outcome === "VERIFIED" &&
        Array.isArray(result.effects) &&
        result.effects.some((effect) => effect && effect.idempotent === false),
      numeratorPredicate: (result) =>
        (result.effects ?? []).filter(
          (effect) => effect && effect.idempotent === false && (effect.applications ?? 0) > 1,
        ).length,
      denominatorPredicate: (result) =>
        (result.effects ?? []).filter((effect) => effect && effect.idempotent === false).length,
      absolute: true,
      provisionalSlo: { comparator: "<=", threshold: 0 },
    }),
    defineSLI({
      id: "recoveryRate",
      name: "Recovery success rate",
      description:
        "Fraction of runs that required a recovery action (retry after failure, UNKNOWN reconciliation, crash resume) and recovered to their ground-truth-consistent outcome.",
      population: "Runs flagged recoveryAttempted in the window.",
      numerator: "Recovery-attempted runs with recovered === true.",
      denominator: "Runs in the population (one per recovery-attempted run).",
      window: EVALUATION_WINDOW,
      exclusions: [
        "Runs blocked by an exhausted remediation budget are review escalations, not recovery attempts.",
      ],
      populationPredicate: (result) => result.recoveryAttempted === true,
      numeratorPredicate: (result) => (result.recovered === true ? 1 : 0),
      denominatorPredicate: scenarioDenominator,
      absolute: false,
      provisionalSlo: { comparator: ">=", threshold: 0.9 },
    }),
    defineSLI({
      id: "configResolutionTime",
      name: "Config resolution timeliness",
      description: `Fraction of configuration resolutions that completed within the ${CONFIG_RESOLUTION_BUDGET_MS} ms provisional budget, measured on the resolver + adapter path.`,
      population: "Runs that attempted layered configuration resolution in the window.",
      numerator:
        "Config resolutions completing within the budget (including fail-closed rejections).",
      denominator: "Config resolution attempts in the population (one per attempt).",
      window: EVALUATION_WINDOW,
      exclusions: [
        "Runs that never attempted layered configuration resolution (default config path).",
      ],
      populationPredicate: (result) => result.configResolution?.attempted === true,
      numeratorPredicate: (result) =>
        (result.configResolution?.ms ?? Number.POSITIVE_INFINITY) <= CONFIG_RESOLUTION_BUDGET_MS
          ? 1
          : 0,
      denominatorPredicate: scenarioDenominator,
      absolute: false,
      provisionalSlo: { comparator: ">=", threshold: 0.99 },
    }),
  ].map((definition) => Object.freeze(definition)),
);

export const SLI_BY_ID = Object.freeze(
  new Map(SLI_DEFINITIONS.map((definition) => [definition.id, definition])),
);

function evaluateSlo(comparator, threshold, value) {
  if (value === null || Number.isNaN(value)) return null;
  return comparator === ">=" ? value >= threshold : value <= threshold;
}

export function computeSLI(results, definition) {
  if (!Array.isArray(results)) throw new TypeError("computeSLI results must be an array");
  const resolved =
    typeof definition === "string"
      ? SLI_BY_ID.get(definition)
      : isPlainObject(definition)
        ? definition
        : null;
  if (resolved === null)
    throw new TypeError("computeSLI requires an SLI definition object or a registered SLI id");
  if (typeof resolved.populationPredicate !== "function")
    throw new TypeError("SLI definition is not executable (missing predicates)");
  const population = results.filter((result) => {
    if (!isPlainObject(result))
      throw new TypeError("computeSLI results must all be plain result objects");
    return resolved.populationPredicate(result);
  });
  const numerator = population.reduce(
    (sum, result) => sum + resolved.numeratorPredicate(result),
    0,
  );
  const denominator = population.reduce(
    (sum, result) => sum + resolved.denominatorPredicate(result),
    0,
  );
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator < 0 ||
    denominator < 0
  )
    throw new TypeError(`SLI ${resolved.id} predicates must return non-negative integers`);
  const value = denominator > 0 ? numerator / denominator : null;
  const ci95 = wilsonInterval(numerator, denominator);
  const met = evaluateSlo(
    resolved.provisionalSlo.comparator,
    resolved.provisionalSlo.threshold,
    value,
  );
  const status = resolved.absolute
    ? numerator > 0
      ? "VIOLATED"
      : denominator > 0
        ? "HELD"
        : "NOT_EXERCISED"
    : met === null
      ? "INSUFFICIENT_DATA"
      : met
        ? "MET"
        : "UNMET";
  return Object.freeze({
    format: SLI_FORMAT,
    id: resolved.id,
    name: resolved.name,
    description: resolved.description,
    value,
    numerator,
    denominator,
    unit: resolved.unit,
    window: resolved.window,
    exclusions: resolved.exclusions,
    ci95,
    absolute: resolved.absolute,
    provisionalSlo: resolved.provisionalSlo,
    provisional: true,
    met,
    status,
    definitionDigest: digest({
      id: resolved.id,
      population: resolved.population,
      numerator: resolved.numerator,
      denominator: resolved.denominator,
      window: resolved.window,
      exclusions: resolved.exclusions,
      provisionalSlo: resolved.provisionalSlo,
    }),
  });
}

export function computeAllSLIs(results) {
  return Object.freeze(
    Object.fromEntries(
      SLI_DEFINITIONS.map((definition) => [definition.id, computeSLI(results, definition)]),
    ),
  );
}

export default {
  SLI_FORMAT,
  EVALUATION_WINDOW,
  Z_95,
  CONFIG_RESOLUTION_BUDGET_MS,
  SLI_DEFINITIONS,
  SLI_BY_ID,
  wilsonInterval,
  computeSLI,
  computeAllSLIs,
};
