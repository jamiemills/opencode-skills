"use strict";

// T001 (jev-review-judge-substitution): the provider-neutral typed-question
// protocol. The live Jev API (verified 2026-09-20 against
// https://openrouter.ai/api/alpha/decisions, model typesafe/jev-1.13) takes a
// `questions` RECORD keyed by question id and returns an `answers` RECORD keyed
// by the same ids. The prior array-shaped request was rejected with HTTP 400
// ("expected record, received array"), so the adapter and the provider
// descriptors build and parse through this module only.
//
// The module is descriptor-agnostic and dependency-free: it maps a decision
// point (type + criteria + optional `question` spec) to a Jev question, builds
// the batched record, and normalizes the returned answers, including the
// probability distribution, confidence, and score legend.

export const QUESTION_TYPES = Object.freeze(["choice", "score", "noul"]);
export const QUESTION_SPEC_SCHEMA = "csm-decision-question/1";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Map a point's `criteria`/`question` into the live API's per-question spec.
export function questionForPoint(point, { id = point?.id } = {}) {
  if (!isPlainObject(point)) throw new TypeError("decision point must be an object");
  const type = point.type;
  if (!QUESTION_TYPES.includes(type))
    throw new TypeError(`unsupported question type: ${String(type)}`);
  if (!nonEmptyString(id)) throw new TypeError("question id must be a non-empty string");
  const override = isPlainObject(point.question) ? point.question : {};
  const spec = { type };
  if (nonEmptyString(override.instructions)) spec.instructions = override.instructions;

  if (type === "choice") {
    const criteria = override.criteria ?? point.criteria;
    if (Array.isArray(criteria)) {
      if (criteria.length < 2) throw new TypeError("choice criteria needs at least 2 options");
      spec.criteria = Object.fromEntries(
        criteria.map((option) => [String(option), String(option)]),
      );
    } else if (isPlainObject(criteria)) {
      spec.criteria = Object.fromEntries(
        Object.entries(criteria).map(([option, description]) => [
          option,
          description === null ? null : String(description),
        ]),
      );
    } else {
      throw new TypeError("choice criteria must be an option map or an array of options");
    }
  } else if (type === "score") {
    const levels = override.criteria ?? point.criteria;
    if (!Array.isArray(levels) || levels.length < 2)
      throw new TypeError("score criteria must be an ordered array of at least 2 levels");
    spec.criteria = levels.map((level) => String(level));
    if (isPlainObject(override.legend)) spec.legend = { ...override.legend };
  } else {
    const criteria = override.criteria ?? point.criteria;
    if (isPlainObject(criteria)) spec.criteria = { ...criteria };
    else if (Array.isArray(criteria))
      spec.criteria = { true: String(criteria[0]), false: String(criteria[1]) };
  }
  return { id, spec };
}

// Build the live API's `questions` record for a set of decision points.
export function buildQuestions(points, { idOf = (point) => point.id } = {}) {
  if (!Array.isArray(points)) throw new TypeError("points must be an array");
  if (points.length === 0) throw new TypeError("at least one point is required");
  const record = {};
  for (const point of points) {
    const { id, spec } = questionForPoint(point, { id: idOf(point) });
    if (Object.hasOwn(record, id)) throw new TypeError(`duplicate question id: ${id}`);
    record[id] = spec;
  }
  return record;
}

export function normalizeUsage(usage) {
  const normalized = {};
  if (!isPlainObject(usage)) return normalized;
  const inputTokens = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens;
  const outputTokens = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens;
  const cost = usage.cost ?? usage.total_cost;
  if (Number.isFinite(inputTokens)) normalized.inputTokens = inputTokens;
  if (Number.isFinite(outputTokens)) normalized.outputTokens = outputTokens;
  if (Number.isFinite(cost)) normalized.cost = cost;
  return normalized;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

// Normalize one answer entry into the adapter's typed-answer shape.
export function normalizeAnswer(entry) {
  if (!isPlainObject(entry)) return { type: null, answer: null, confidence: null };
  const type = QUESTION_TYPES.includes(entry.type) ? entry.type : null;
  const normalized = {
    type,
    answer: null,
    confidence: finiteOrNull(entry.confidence),
  };
  if (isPlainObject(entry.probabilities)) normalized.probabilities = { ...entry.probabilities };
  if (type === "choice") normalized.answer = entry.choice ?? null;
  else if (type === "score") {
    normalized.answer = finiteOrNull(entry.score);
    if (isPlainObject(entry.legend)) normalized.legend = { ...entry.legend };
  } else if (type === "noul") normalized.answer = finiteOrNull(entry.noul);
  else if (entry.choice !== undefined) normalized.answer = entry.choice;
  else if (entry.score !== undefined) normalized.answer = finiteOrNull(entry.score);
  else if (entry.noul !== undefined) normalized.answer = finiteOrNull(entry.noul);
  return normalized;
}

// Parse the live `answers` envelope into a normalized map plus usage/model.
export function parseAnswers(envelope) {
  const source = isPlainObject(envelope) ? envelope : {};
  const raw = isPlainObject(source.answers) ? source.answers : {};
  const answers = {};
  for (const [id, entry] of Object.entries(raw)) answers[id] = normalizeAnswer(entry);
  return {
    answers,
    usage: normalizeUsage(source.usage),
    model: nonEmptyString(source.model) ? source.model : null,
  };
}

// The first (or only) normalized answer — the single-question compatibility
// projection the adapter's one-point path consumes.
export function firstAnswer(answers) {
  const ids = Object.keys(answers ?? {});
  return { id: ids[0] ?? null, ...(ids.length ? answers[ids[0]] : {}) };
}

export default {
  QUESTION_TYPES,
  QUESTION_SPEC_SCHEMA,
  questionForPoint,
  buildQuestions,
  normalizeUsage,
  normalizeAnswer,
  parseAnswers,
  firstAnswer,
};
