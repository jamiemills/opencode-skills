"use strict";

import { digest } from "../../schema-runtime/index.mjs";

export const ADJUDICATION_VERDICTS = Object.freeze([
  "correct",
  "incorrect-unsafe",
  "incorrect-too-strict",
  "indeterminate",
]);
export const RUBRIC_FORMAT = "csm-adjudication-rubric/1";
export const ADJUDICATION_SESSION_FORMAT = "csm-adjudication-session/1";

const CRITERION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function adjudicationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateVerdict(verdict) {
  if (!ADJUDICATION_VERDICTS.includes(verdict))
    throw adjudicationError(
      "invalid-verdict",
      `adjudication verdict must be one of ${ADJUDICATION_VERDICTS.join(", ")} (got ${JSON.stringify(verdict)})`,
    );
}

export function createAdjudicationRubric(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0)
    throw new TypeError("createAdjudicationRubric requires a non-empty criteria array");
  const seen = new Set();
  const frozenCriteria = criteria.map((criterion, index) => {
    if (!isPlainObject(criterion)) throw new TypeError(`criterion ${index} must be an object`);
    for (const key of Object.keys(criterion))
      if (!["criterionId", "description", "weight", "appliesTo"].includes(key))
        throw new TypeError(
          `criterion ${index} has unknown key '${key}' (allowed: criterionId, description, weight, appliesTo)`,
        );
    if (
      typeof criterion.criterionId !== "string" ||
      !CRITERION_ID_PATTERN.test(criterion.criterionId)
    )
      throw new TypeError(`criterion ${index} criterionId must match ${CRITERION_ID_PATTERN}`);
    if (seen.has(criterion.criterionId))
      throw new TypeError(`duplicate criterionId '${criterion.criterionId}'`);
    seen.add(criterion.criterionId);
    if (typeof criterion.description !== "string" || criterion.description.length === 0)
      throw new TypeError(`criterion ${criterion.criterionId} requires a non-empty description`);
    const weight = criterion.weight ?? 1;
    if (typeof weight !== "number" || weight <= 0)
      throw new TypeError(`criterion ${criterion.criterionId} weight must be a positive number`);
    const appliesTo = criterion.appliesTo ?? {};
    if (!isPlainObject(appliesTo))
      throw new TypeError(`criterion ${criterion.criterionId} appliesTo must be an object`);
    for (const key of Object.keys(appliesTo))
      if (!["riskClasses", "categories"].includes(key))
        throw new TypeError(
          `criterion ${criterion.criterionId} appliesTo has unknown key '${key}'`,
        );
    for (const key of ["riskClasses", "categories"]) {
      if (appliesTo[key] !== undefined && !Array.isArray(appliesTo[key]))
        throw new TypeError(`criterion ${criterion.criterionId} appliesTo.${key} must be an array`);
    }
    return Object.freeze({
      criterionId: criterion.criterionId,
      description: criterion.description,
      weight,
      appliesTo: Object.freeze({
        riskClasses: Object.freeze([...(appliesTo.riskClasses ?? [])]),
        categories: Object.freeze([...(appliesTo.categories ?? [])]),
      }),
    });
  });
  const rubric = {
    format: RUBRIC_FORMAT,
    criteria: Object.freeze(frozenCriteria),
  };
  return Object.freeze({ ...rubric, rubricDigest: digest(rubric) });
}

export function createAdjudicationSession(options = {}) {
  if (!isPlainObject(options))
    throw new TypeError("adjudication session options must be an object");
  const { rubric, scenarioIds, requiredAdjudicators = 2 } = options;
  if (
    !isPlainObject(rubric) ||
    rubric.format !== RUBRIC_FORMAT ||
    typeof rubric.rubricDigest !== "string"
  )
    throw new TypeError("adjudication session requires a rubric from createAdjudicationRubric");
  if (!Array.isArray(scenarioIds) || scenarioIds.length === 0)
    throw new TypeError("adjudication session requires a non-empty scenarioIds array");
  if (!Number.isInteger(requiredAdjudicators) || requiredAdjudicators < 2)
    throw new TypeError(
      "requiredAdjudicators must be an integer >= 2 (blinding requires at least two raters)",
    );
  const known = new Set();
  for (const id of scenarioIds) {
    if (typeof id !== "string" || id.length === 0)
      throw new TypeError("scenarioIds must be non-empty strings");
    if (known.has(id)) throw new TypeError(`duplicate scenarioId '${id}' in adjudication session`);
    known.add(id);
  }
  const now =
    typeof options.now === "function"
      ? options.now
      : options.now !== undefined
        ? () => options.now
        : () => new Date().toISOString();

  const records = new Map();

  function recordedCount(scenarioId) {
    return records.get(scenarioId)?.size ?? 0;
  }

  function recordAdjudication(scenarioId, adjudicatorId, verdict, rationale) {
    if (!known.has(scenarioId))
      throw adjudicationError(
        "unknown-scenario",
        `scenarioId '${scenarioId}' is not registered in this session`,
      );
    if (typeof adjudicatorId !== "string" || adjudicatorId.trim().length === 0)
      throw adjudicationError("invalid-adjudicator", "adjudicatorId must be a non-empty string");
    validateVerdict(verdict);
    if (typeof rationale !== "string" || rationale.trim().length === 0)
      throw adjudicationError(
        "invalid-rationale",
        "a written rationale is required for every adjudication",
      );
    let perScenario = records.get(scenarioId);
    if (perScenario === undefined) {
      perScenario = new Map();
      records.set(scenarioId, perScenario);
    }
    if (perScenario.has(adjudicatorId))
      throw adjudicationError(
        "already-recorded",
        `adjudicator '${adjudicatorId}' already recorded a verdict for '${scenarioId}'`,
      );
    perScenario.set(adjudicatorId, { verdict, rationale, recordedAt: now() });
    return {
      scenarioId,
      adjudicatorId,
      recorded: true,
      recordedAt: now(),
      blinding: "verdicts of other adjudicators remain hidden until the scenario is complete",
    };
  }

  function revealScenario(scenarioId) {
    if (!known.has(scenarioId))
      throw adjudicationError(
        "unknown-scenario",
        `scenarioId '${scenarioId}' is not registered in this session`,
      );
    if (recordedCount(scenarioId) < requiredAdjudicators)
      throw adjudicationError(
        "blinding-incomplete",
        `scenario '${scenarioId}' has ${recordedCount(scenarioId)}/${requiredAdjudicators} adjudications; verdicts stay blinded until all required adjudicators have recorded`,
      );
    const adjudications = [...records.get(scenarioId).entries()]
      .map(([adjudicatorId, record]) => ({
        adjudicatorId,
        verdict: record.verdict,
        rationale: record.rationale,
        recordedAt: record.recordedAt,
      }))
      .toSorted((a, b) =>
        a.recordedAt < b.recordedAt
          ? -1
          : a.recordedAt > b.recordedAt
            ? 1
            : a.adjudicatorId.localeCompare(b.adjudicatorId),
      );
    const verdicts = adjudications.map((entry) => entry.verdict);
    return Object.freeze({
      scenarioId,
      complete: true,
      adjudications: Object.freeze(adjudications),
      verdictsAgree: verdicts.every((verdict) => verdict === verdicts[0]),
    });
  }

  function revealAll() {
    const complete = [];
    const pending = [];
    for (const scenarioId of scenarioIds) {
      const count = recordedCount(scenarioId);
      if (count >= requiredAdjudicators) complete.push(revealScenario(scenarioId));
      else if (count > 0) pending.push({ scenarioId, recordedCount: count });
    }
    return Object.freeze({
      format: ADJUDICATION_SESSION_FORMAT,
      rubricDigest: rubric.rubricDigest,
      requiredAdjudicators,
      complete: Object.freeze(complete),
      pending: Object.freeze(pending),
    });
  }

  function getStatus() {
    return Object.freeze({
      format: ADJUDICATION_SESSION_FORMAT,
      rubricDigest: rubric.rubricDigest,
      requiredAdjudicators,
      scenarios: Object.freeze(
        scenarioIds.map((scenarioId) => ({
          scenarioId,
          recordedCount: recordedCount(scenarioId),
          complete: recordedCount(scenarioId) >= requiredAdjudicators,
        })),
      ),
      verdictsRevealed: 0,
    });
  }

  return Object.freeze({
    recordAdjudication,
    revealScenario,
    revealAll,
    getStatus,
  });
}

function pairKappa(firstRater, secondRater) {
  const items = firstRater.length;
  if (items === 0) return { kappa: null, po: null };
  const categories = [...new Set([...firstRater, ...secondRater])];
  let agreements = 0;
  for (let index = 0; index < items; index += 1)
    if (firstRater[index] === secondRater[index]) agreements += 1;
  const po = agreements / items;
  let pe = 0;
  for (const category of categories) {
    const firstMarginal = firstRater.filter((verdict) => verdict === category).length / items;
    const secondMarginal = secondRater.filter((verdict) => verdict === category).length / items;
    pe += firstMarginal * secondMarginal;
  }
  if (pe === 1) return { kappa: null, po };
  return { kappa: (po - pe) / (1 - pe), po };
}

export function computeInterRater(adjudicationSets) {
  if (!Array.isArray(adjudicationSets))
    throw new TypeError("computeInterRater requires an array of adjudication sets");
  for (const set of adjudicationSets) {
    if (
      !isPlainObject(set) ||
      typeof set.scenarioId !== "string" ||
      !Array.isArray(set.adjudications)
    )
      throw new TypeError("each adjudication set requires scenarioId and an adjudications array");
    for (const entry of set.adjudications) {
      if (!isPlainObject(entry) || typeof entry.adjudicatorId !== "string")
        throw new TypeError("each adjudication requires an adjudicatorId");
      validateVerdict(entry.verdict);
    }
  }
  const raters = new Map();
  for (const set of adjudicationSets) {
    for (const entry of set.adjudications) {
      if (!raters.has(entry.adjudicatorId)) raters.set(entry.adjudicatorId, new Map());
      raters.get(entry.adjudicatorId).set(set.scenarioId, entry.verdict);
    }
  }
  const raterIds = [...raters.keys()];
  let pairsEvaluated = 0;
  let pairsAgree = 0;
  let observedAgreementSum = 0;
  let degeneratePairs = 0;
  let kappaSum = 0;
  let kappaPairs = 0;
  const pairDetails = [];
  for (let i = 0; i < raterIds.length; i += 1) {
    for (let j = i + 1; j < raterIds.length; j += 1) {
      const first = raters.get(raterIds[i]);
      const second = raters.get(raterIds[j]);
      const shared = [...first.keys()].filter((scenarioId) => second.has(scenarioId));
      if (shared.length === 0) continue;
      const { kappa, po } = pairKappa(
        shared.map((scenarioId) => first.get(scenarioId)),
        shared.map((scenarioId) => second.get(scenarioId)),
      );
      pairsEvaluated += 1;
      if (po !== null) observedAgreementSum += po;
      if (po === 1) pairsAgree += 1;
      if (kappa === null) degeneratePairs += 1;
      else {
        kappaSum += kappa;
        kappaPairs += 1;
      }
      pairDetails.push({
        raters: [raterIds[i], raterIds[j]],
        items: shared.length,
        observedAgreement: po,
        cohensKappa: kappa,
      });
    }
  }
  return Object.freeze({
    raters: Object.freeze(raterIds),
    setsEvaluated: adjudicationSets.filter((set) => set.adjudications.length >= 2).length,
    pairsEvaluated,
    pairsAgree,
    observedAgreement: pairsEvaluated > 0 ? observedAgreementSum / pairsEvaluated : null,
    cohensKappa: kappaPairs > 0 ? kappaSum / kappaPairs : null,
    kappaInterpretation:
      "average pairwise Cohen's kappa; null when every pair is degenerate (identical marginal distributions)",
    degeneratePairs,
    pairs: Object.freeze(pairDetails),
  });
}

export default {
  ADJUDICATION_VERDICTS,
  RUBRIC_FORMAT,
  ADJUDICATION_SESSION_FORMAT,
  createAdjudicationRubric,
  createAdjudicationSession,
  computeInterRater,
};
