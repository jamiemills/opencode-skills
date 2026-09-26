import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listDecisionPoints,
  validateDecisionPoint,
} from "../../csm-orchestrate/lib/decision-adapter/points.mjs";
import {
  buildQuestions,
  questionForPoint,
} from "../../csm-orchestrate/lib/decision-adapter/question-protocol.mjs";
import openrouter from "../../csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs";
import vercel from "../../csm-orchestrate/lib/decision-adapter/providers/vercel.mjs";

test("every shipped decision point validates and carries question instructions", () => {
  const points = listDecisionPoints();
  assert.ok(points.length > 0);
  for (const point of points) {
    const { valid, errors } = validateDecisionPoint(point);
    assert.equal(valid, true, `${point.id}: ${errors.join(", ")}`);
    assert.equal(
      typeof point.question?.instructions,
      "string",
      `${point.id} lacks question.instructions`,
    );
    assert.ok(point.question.instructions.trim().length > 0);
  }
});

test("questionForPoint rejects a point without instructions", () => {
  assert.throws(
    () => questionForPoint({ id: "no-instructions", type: "noul", criteria: ["yes", "no"] }),
    /instructions/,
  );
});

test("buildQuestions emits instructions for every shipped point", () => {
  const questions = buildQuestions(listDecisionPoints());
  for (const [id, spec] of Object.entries(questions)) {
    assert.equal(typeof spec.instructions, "string", `${id} lacks instructions`);
  }
});

const questions = { q1: { type: "noul", instructions: "Is this true?" } };

test("openrouter always sends a non-empty state and a questions record", () => {
  const withState = openrouter.buildRequest({
    env: { OPENROUTER_ROUTER_KEY: "k" },
    state: "ctx",
    questions,
  });
  assert.equal(withState.body.state, "ctx");
  assert.equal(Array.isArray(withState.body.questions), false);

  const nullState = openrouter.buildRequest({
    env: { OPENROUTER_ROUTER_KEY: "k" },
    state: null,
    questions,
  });
  assert.equal(typeof nullState.body.state, "string");
  assert.ok(nullState.body.state.length > 0, "a null state must be replaced, not sent");
});

test("vercel always sends a non-empty state", () => {
  const req = vercel.buildRequest({
    env: { AI_GATEWAY_API_KEY: "k" },
    state: null,
    questions,
  });
  assert.equal(typeof req.body.state, "string");
  assert.ok(req.body.state.length > 0);
});
