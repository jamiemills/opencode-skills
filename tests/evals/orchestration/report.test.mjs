"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_FORMAT, createEvaluationHarness } from "../../../lib/evals/orchestration/index.mjs";

const harness = createEvaluationHarness({
  clock: () => 42,
  now: "2026-08-28T00:00:00.000Z",
});

function scenario(index, overrides = {}) {
  return {
    scenarioId: `eval-report-${String(index).padStart(3, "0")}`,
    name: `report scenario ${index}`,
    category: "correctness",
    riskClass: "low",
    expected: { outcome: "VERIFIED" },
    setup: { approachPhases: 1, hostBehavior: "cooperative" },
    ...overrides,
  };
}

async function results(count) {
  const runs = [];
  for (let index = 1; index <= count; index += 1)
    runs.push(await harness.runScenario(scenario(index)));
  return runs;
}

test("report: shape, category aggregation, provisional SLIs, and clean safety gates", async () => {
  const runResults = await results(4);
  const report = harness.generateReport(runResults, {
    corpus: [
      {
        split: "development",
        corpusId: "eval-report-fixture",
        scenarioCount: 4,
        corpusDigest: "sha256:" + "a".repeat(64),
      },
    ],
    adjudication: { observedAgreement: 1, cohensKappa: null, degeneratePairs: 1 },
  });
  assert.equal(report.format, REPORT_FORMAT);
  assert.equal(report.overall, "PASSED");
  assert.equal(report.thresholdsProvisional, true);
  assert.equal(report.totals.scenarios, 4);
  assert.equal(report.totals.matched, 4);
  assert.equal(report.totals.unmatched, 0);
  assert.deepEqual(report.totals.byCategory.correctness, { total: 4, matched: 4 });
  assert.equal(report.totals.byOutcome.VERIFIED, 4);
  assert.equal(report.totals.byOutcome.BLOCKED, 0);
  for (const id of [
    "availability",
    "correctness",
    "falseVerified",
    "falseRejection",
    "duplicateEffects",
    "recoveryRate",
    "configResolutionTime",
  ]) {
    const sli = report.slis[id];
    assert.ok(sli, `report must include the ${id} SLI`);
    assert.equal(sli.provisional, true);
    assert.ok(Array.isArray(sli.exclusions) && sli.exclusions.length > 0);
    if (sli.value !== null) {
      assert.ok(sli.ci95.low <= sli.ci95.high);
      assert.ok(sli.ci95.low <= sli.value && sli.value <= sli.ci95.high);
      assert.match(sli.definitionDigest, /^sha256:[a-f0-9]{64}$/);
    }
  }
  assert.equal(report.slis.correctness.status, "MET");
  assert.equal(report.slis.recoveryRate.status, "INSUFFICIENT_DATA");
  assert.equal(report.slis.falseVerified.status, "HELD");
  assert.deepEqual(
    report.safetyGates.map((gate) => gate.id),
    ["false-verified-zero", "duplicate-effects-zero"],
  );
  assert.ok(report.safetyGates.every((gate) => gate.violated === false));
  assert.equal(report.corpusProvenance.length, 1);
  assert.equal(report.adjudication.observedAgreement, 1);
  assert.ok(report.limitations.length >= 3);
  assert.equal(report.generatedAt, "2026-08-28T00:00:00.000Z");
});

test("report: unmatched runs surface in totals without failing safety gates", async () => {
  const good = await harness.runScenario(scenario(1));
  const rejected = await harness.runScenario(
    scenario(2, {
      category: "recovery",
      riskClass: "high",
      expected: { outcome: "VERIFIED" },
      setup: { approachPhases: 1, hostBehavior: "uncooperative" },
    }),
  );
  assert.equal(rejected.matched, false);
  assert.equal(rejected.falseRejection, true);
  const report = harness.generateReport([good, rejected]);
  assert.equal(report.overall, "PASSED");
  assert.equal(report.totals.unmatched, 1);
  assert.equal(report.totals.falseRejection, 1);
  assert.equal(report.slis.falseRejection.numerator, 1);
  assert.equal(report.slis.falseRejection.status, "UNMET");
});

test("report: malformed result inputs fail closed", async () => {
  const good = await harness.runScenario(scenario(1));
  assert.throws(
    () => harness.generateReport([{ scenarioId: "x", outcome: "NOPE", matched: true }]),
    TypeError,
  );
  assert.throws(
    () => harness.generateReport([{ scenarioId: "x", outcome: "VERIFIED" }]),
    TypeError,
  );
  assert.throws(() => harness.generateReport("nope"), TypeError);
  assert.throws(() => harness.generateReport([{ ...good, category: "not-a-category" }]), TypeError);
});
