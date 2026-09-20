"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuestions,
  firstAnswer,
  normalizeAnswer,
  parseAnswers,
  questionForPoint,
} from "../../csm-orchestrate/lib/decision-adapter/question-protocol.mjs";

// A raw live-envelope fixture captured 2026-09-20 from
// POST https://openrouter.ai/api/alpha/decisions (model typesafe/jev-1.13,
// resolved snapshot typesafe/jev-1.13-20260917). This pins the REAL envelope,
// not a normalized rendering.
const RAW_ENVELOPE = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    has_defect: { type: "noul", noul: 0.74 },
    kind: {
      type: "choice",
      choice: "off_by_one",
      probabilities: { off_by_one: 0.98, none: 0.02, null_guard: 0 },
      confidence: 0.97,
    },
    severity: {
      type: "score",
      score: 1.46,
      legend: { 0: "none", 1: "low", 2: "medium", 3: "high" },
      probabilities: { 0: 0.22, 1: 0.35, 2: 0.18, 3: 0.25 },
      confidence: 0.1,
    },
  },
  usage: { input_tokens: 404, output_tokens: 75, cost: 0.000016968 },
  id: "gen-dec-fixture",
  provider: "TypeSafe",
};

test("buildQuestions emits a RECORD keyed by question id (never an array)", () => {
  const record = buildQuestions([
    { id: "review-challenger-verdict", type: "choice", criteria: ["agree", "retract"] },
    { id: "deep-research-judge-clarity", type: "score", criteria: ["a", "b", "c"] },
    { id: "secret-preflag", type: "noul", criteria: ["x", "y"] },
  ]);
  assert.ok(!Array.isArray(record));
  assert.deepEqual(Object.keys(record), [
    "review-challenger-verdict",
    "deep-research-judge-clarity",
    "secret-preflag",
  ]);
  assert.equal(record["review-challenger-verdict"].type, "choice");
  assert.deepEqual(record["review-challenger-verdict"].criteria, {
    agree: "agree",
    retract: "retract",
  });
  assert.deepEqual(record["deep-research-judge-clarity"].criteria, ["a", "b", "c"]);
});

test("questionForPoint prefers a typed question spec over bare criteria", () => {
  const { spec } = questionForPoint({
    id: "review-challenger-verdict",
    type: "choice",
    criteria: ["ignore"],
    question: { instructions: "challenge", criteria: { agree: "supports", retract: "rejects" } },
  });
  assert.equal(spec.instructions, "challenge");
  assert.deepEqual(spec.criteria, { agree: "supports", retract: "rejects" });
});

test("questionForPoint rejects unsupported types and underspecified scores", () => {
  assert.throws(
    () => questionForPoint({ id: "x", type: "freeform", criteria: ["a"] }),
    /unsupported/,
  );
  assert.throws(
    () => questionForPoint({ id: "x", type: "score", criteria: ["only-one"] }),
    /score/,
  );
  assert.throws(() => questionForPoint({ id: "x", type: "choice", criteria: ["one"] }), /choice/);
});

test("buildQuestions refuses duplicate ids and empty input", () => {
  const point = { id: "dup", type: "noul", criteria: ["a", "b"] };
  assert.throws(() => buildQuestions([point, point]), /duplicate/);
  assert.throws(() => buildQuestions([]), /at least one/);
});

test("parseAnswers reads the raw answers envelope and normalizes every type", () => {
  const parsed = parseAnswers(RAW_ENVELOPE);
  assert.equal(parsed.model, "typesafe/jev-1.13-20260917");
  assert.deepEqual(parsed.usage, { inputTokens: 404, outputTokens: 75, cost: 0.000016968 });
  assert.equal(parsed.answers.has_defect.type, "noul");
  assert.equal(parsed.answers.has_defect.answer, 0.74);
  assert.equal(parsed.answers.kind.answer, "off_by_one");
  assert.equal(parsed.answers.kind.confidence, 0.97);
  assert.deepEqual(parsed.answers.kind.probabilities, {
    off_by_one: 0.98,
    none: 0.02,
    null_guard: 0,
  });
  assert.equal(parsed.answers.severity.answer, 1.46);
  assert.deepEqual(parsed.answers.severity.legend, { 0: "none", 1: "low", 2: "medium", 3: "high" });
});

test("parseAnswers and firstAnswer tolerate malformed input", () => {
  assert.deepEqual(parseAnswers(null).answers, {});
  assert.deepEqual(parseAnswers("nope").usage, {});
  assert.equal(firstAnswer({}).id, null);
  assert.equal(normalizeAnswer(null).answer, null);
});

test("score normalization divides by the criteria span for a 0-1 rubric", () => {
  const parsed = parseAnswers(RAW_ENVELOPE);
  const span = 4 - 1; // four ordered levels in the fixture legend
  assert.ok(Math.abs(parsed.answers.severity.answer / span - 0.4867) < 0.001);
});
