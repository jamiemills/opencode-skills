import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listDecisionPoints,
  serializeDecisionPoints,
  validateDecisionPoint,
} from "../csm-orchestrate/lib/decision-adapter/points.mjs";
import compiledPoints from "../csm-orchestrate/decision-points.json" with { type: "json" };

const REQUIRED_NEW = [
  "csm-deep-research-triage",
  "csm-review-scale",
  "plan-scale",
  "build-repair-classification",
  "build-integrate-choice",
  "plan-remediation-resolution",
  "deep-research-verify-claim",
  "python-review-bucket",
  "make-tests-triage",
  "make-tests-survivor-triage",
  "make-tests-surface-ranking",
  "grill-clarification-ranking",
];

test("every point validates and carries question.instructions", () => {
  for (const point of listDecisionPoints()) {
    const { valid, errors } = validateDecisionPoint(point);
    assert.equal(valid, true, `${point.id}: ${errors.join(", ")}`);
    assert.ok(point.question.instructions.trim().length > 0, `${point.id} instructions`);
  }
});

test("no safety/authority point may apply; only non-safety applies", () => {
  for (const point of listDecisionPoints()) {
    if (point.applyVsAdvisory === "apply")
      assert.equal(point.safetyClass, "non-safety", `${point.id} is safety+apply`);
  }
});

test("the expanded points are present", () => {
  const ids = new Set(listDecisionPoints().map((point) => point.id));
  for (const id of REQUIRED_NEW) assert.ok(ids.has(id), `missing point ${id}`);
});

test("points.mjs and decision-points.json are in lockstep including the question spec", () => {
  assert.deepEqual(compiledPoints, serializeDecisionPoints());
});
