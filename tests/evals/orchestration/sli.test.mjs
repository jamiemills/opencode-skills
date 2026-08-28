"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIG_RESOLUTION_BUDGET_MS,
  SLI_DEFINITIONS,
  Z_95,
  computeSLI,
  wilsonInterval,
} from "../../../lib/evals/orchestration/sli.mjs";

function result(overrides = {}) {
  return {
    scenarioId: "eval-unit-001",
    category: "correctness",
    outcome: "VERIFIED",
    matched: true,
    falseVerified: false,
    falseRejection: false,
    terminal: true,
    expected: { outcome: "VERIFIED" },
    recoveryAttempted: false,
    recovered: null,
    effects: [],
    detectedDuplicateEffects: 0,
    configResolution: { attempted: false, rejected: false, ms: null },
    ...overrides,
  };
}

test("sli: wilson interval has exact boundary forms and containment", () => {
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(wilsonInterval(5, 0), null);
  const z2 = Z_95 * Z_95;
  const none = wilsonInterval(0, 10);
  assert.equal(none.low, 0);
  assert.ok(Math.abs(none.high - z2 / (10 + z2)) < 1e-12);
  const all = wilsonInterval(10, 10);
  assert.equal(all.high, 1);
  assert.ok(Math.abs(all.low - 10 / (10 + z2)) < 1e-12);
  const mixed = wilsonInterval(8, 10);
  assert.ok(mixed.low <= 0.8 && 0.8 <= mixed.high);
  const wider = wilsonInterval(80, 100);
  assert.ok(mixed.high - mixed.low > wider.high - wider.low);
  assert.throws(() => wilsonInterval(11, 10), TypeError);
  assert.throws(() => wilsonInterval(-1, 10), TypeError);
  assert.throws(() => wilsonInterval(1.5, 10), TypeError);
});

test("sli: definitions are complete, closed, and serializable", () => {
  assert.deepEqual(
    SLI_DEFINITIONS.map((definition) => definition.id),
    [
      "availability",
      "correctness",
      "falseVerified",
      "falseRejection",
      "duplicateEffects",
      "recoveryRate",
      "configResolutionTime",
    ],
  );
  for (const definition of SLI_DEFINITIONS) {
    for (const key of [
      "id",
      "name",
      "description",
      "population",
      "numerator",
      "denominator",
      "window",
    ])
      assert.ok(
        typeof definition[key] === "string" && definition[key].length > 0,
        `${definition.id}.${key}`,
      );
    assert.ok(Array.isArray(definition.exclusions) && definition.exclusions.length > 0);
    assert.ok(["<=", ">="].includes(definition.provisionalSlo.comparator));
  }
  const absolute = SLI_DEFINITIONS.filter((definition) => definition.absolute).map((d) => d.id);
  assert.deepEqual(absolute, ["falseVerified", "duplicateEffects"]);
});

test("sli: computes correctness, falseVerified, and falseRejection on known inputs", () => {
  const results = [
    result(),
    result({ scenarioId: "eval-unit-002" }),
    result({ scenarioId: "eval-unit-003", outcome: "REJECTED", expected: { outcome: "REJECTED" } }),
    result({
      scenarioId: "eval-unit-004",
      outcome: "REJECTED",
      matched: false,
      falseRejection: true,
    }),
    result({
      scenarioId: "eval-unit-005",
      outcome: "VERIFIED",
      matched: false,
      falseVerified: true,
      expected: { outcome: "REJECTED" },
    }),
  ];
  const correctness = computeSLI(results, "correctness");
  assert.equal(correctness.numerator, 3);
  assert.equal(correctness.denominator, 5);
  assert.ok(Math.abs(correctness.value - 0.6) < 1e-12);
  assert.equal(correctness.status, "UNMET");
  assert.ok(correctness.ci95.low <= 0.6 && 0.6 <= correctness.ci95.high);
  const falseVerified = computeSLI(results, "falseVerified");
  assert.equal(falseVerified.numerator, 1);
  assert.equal(falseVerified.denominator, 3);
  assert.equal(falseVerified.status, "VIOLATED");
  assert.equal(falseVerified.absolute, true);
  const falseRejection = computeSLI(results, "falseRejection");
  assert.equal(falseRejection.numerator, 1);
  assert.equal(falseRejection.denominator, 3);
  const availability = computeSLI(results, "availability");
  assert.equal(availability.value, 1);
  assert.equal(availability.status, "MET");
});

test("sli: duplicate effects count only non-idempotent effects in verified runs", () => {
  const results = [
    result({
      scenarioId: "eval-unit-010",
      outcome: "VERIFIED",
      effects: [
        { effectId: "e1", kind: "publish", idempotent: false, deliveries: 1, applications: 1 },
        { effectId: "e2", kind: "publish", idempotent: false, deliveries: 2, applications: 2 },
      ],
    }),
    result({
      scenarioId: "eval-unit-011",
      outcome: "VERIFIED",
      effects: [
        { effectId: "e3", kind: "publish", idempotent: false, deliveries: 1, applications: 1 },
        { effectId: "e4", kind: "publish", idempotent: true, deliveries: 3, applications: 1 },
      ],
    }),
    result({
      scenarioId: "eval-unit-012",
      outcome: "BLOCKED",
      effects: [
        { effectId: "e5", kind: "publish", idempotent: false, deliveries: 2, applications: 2 },
      ],
    }),
  ];
  const duplicateEffects = computeSLI(results, "duplicateEffects");
  assert.equal(duplicateEffects.numerator, 1);
  assert.equal(duplicateEffects.denominator, 3);
  assert.equal(duplicateEffects.status, "VIOLATED");
});

test("sli: recovery rate and config resolution time on known inputs", () => {
  const results = [
    result({
      scenarioId: "eval-unit-020",
      recoveryAttempted: true,
      recovered: true,
      configResolution: { attempted: true, rejected: false, ms: 0 },
    }),
    result({
      scenarioId: "eval-unit-021",
      recoveryAttempted: true,
      recovered: false,
      configResolution: { attempted: true, rejected: true, ms: CONFIG_RESOLUTION_BUDGET_MS },
    }),
    result({
      scenarioId: "eval-unit-022",
      configResolution: { attempted: true, rejected: false, ms: CONFIG_RESOLUTION_BUDGET_MS + 1 },
    }),
  ];
  const recoveryRate = computeSLI(results, "recoveryRate");
  assert.equal(recoveryRate.numerator, 1);
  assert.equal(recoveryRate.denominator, 2);
  const configResolutionTime = computeSLI(results, "configResolutionTime");
  assert.equal(configResolutionTime.numerator, 2);
  assert.equal(configResolutionTime.denominator, 3);
  assert.ok(Math.abs(configResolutionTime.value - 2 / 3) < 1e-12);
});

test("sli: empty populations report insufficient data instead of zero", () => {
  const empty = computeSLI([], "correctness");
  assert.equal(empty.value, null);
  assert.equal(empty.ci95, null);
  assert.equal(empty.met, null);
  assert.equal(empty.status, "INSUFFICIENT_DATA");
  const noVerified = computeSLI([result({ outcome: "REJECTED" })], "falseVerified");
  assert.equal(noVerified.status, "NOT_EXERCISED");
  assert.throws(() => computeSLI("not-an-array", "correctness"), TypeError);
  assert.throws(() => computeSLI([], { id: "broken" }), TypeError);
  assert.throws(() => computeSLI([], "unknown-sli-id"), TypeError);
});
