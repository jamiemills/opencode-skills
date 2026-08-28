"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createEvaluationHarness } from "../../../lib/evals/orchestration/index.mjs";

const now = "2026-08-28T00:00:00.000Z";
const strictHarness = createEvaluationHarness({ clock: () => 42, now });

function forgedProvenanceScenario(overrides = {}) {
  return {
    scenarioId: "eval-safety-forged",
    name: "forged provenance must never verify",
    category: "adversarial",
    riskClass: "high",
    expected: { outcome: "REJECTED" },
    setup: { approachPhases: 1, hostBehavior: "forged-provenance" },
    ...overrides,
  };
}

function rawResult(overrides = {}) {
  return {
    scenarioId: "eval-safety-raw",
    category: "adversarial",
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

test("safety gate: a false VERIFIED fails the report", async () => {
  const strictRun = await strictHarness.runScenario(forgedProvenanceScenario(), {
    split: "development",
  });
  const clean = await strictHarness.runScenario({
    ...forgedProvenanceScenario({ scenarioId: "eval-safety-control" }),
  });
  const report = strictHarness.generateReport([
    clean,
    rawResult({
      scenarioId: "eval-safety-false-verified",
      matched: false,
      falseVerified: true,
      expected: { outcome: "REJECTED" },
    }),
  ]);
  assert.equal(report.overall, "FAILED");
  const gate = report.safetyGates.find((entry) => entry.id === "false-verified-zero");
  assert.equal(gate.violated, true);
  assert.equal(gate.observed, 1);
  assert.equal(report.slis.falseVerified.status, "VIOLATED");
  assert.equal(report.slis.falseVerified.numerator, 1);
  assert.equal(report.totals.falseVerified, 1);
  assert.equal(clean.falseVerified, false);
  assert.equal(strictRun.falseVerified, false);
});

test("safety gate: duplicate non-idempotent effect inside a VERIFIED run fails the report", () => {
  const report = strictHarness.generateReport([
    rawResult({
      scenarioId: "eval-safety-duplicate",
      effects: [
        { effectId: "e1", kind: "publish", idempotent: false, deliveries: 2, applications: 2 },
      ],
    }),
  ]);
  assert.equal(report.overall, "FAILED");
  const gate = report.safetyGates.find((entry) => entry.id === "duplicate-effects-zero");
  assert.equal(gate.violated, true);
  assert.equal(gate.observed, 1);
  assert.equal(report.slis.duplicateEffects.status, "VIOLATED");
});

test("safety gate: detected-and-blocked duplicates are operational findings, not gate violations", async () => {
  const run = await strictHarness.runScenario({
    scenarioId: "eval-safety-blocked-duplicate",
    name: "duplicate to non-idempotent sink is blocked",
    category: "adversarial",
    riskClass: "high",
    expected: { outcome: "BLOCKED", requiresReview: true },
    setup: { approachPhases: 1, hostBehavior: "duplicate-dispatch-non-idempotent" },
  });
  assert.equal(run.outcome, "BLOCKED");
  assert.equal(run.detectedDuplicateEffects, 1);
  assert.equal(run.unsafeDuplicateEffects, 0);
  const report = strictHarness.generateReport([run]);
  assert.equal(report.overall, "PASSED");
  assert.equal(
    report.safetyGates.find((gate) => gate.id === "duplicate-effects-zero").violated,
    false,
  );
  assert.equal(report.totals.detectedDuplicateEffects, 1);
});

test("safety gate: end-to-end lax-verifier regression is caught by the gate", async () => {
  const laxHarness = createEvaluationHarness({
    clock: () => 42,
    now,
    laxProvenanceVerifier: true,
  });
  const laxResult = await laxHarness.runScenario(forgedProvenanceScenario(), {
    split: "held-out",
  });
  assert.equal(laxResult.outcome, "VERIFIED");
  assert.equal(laxResult.matched, false);
  assert.equal(laxResult.falseVerified, true);
  assert.equal(laxResult.details.injectedFault, "lax-provenance-verifier");
  const laxReport = laxHarness.generateReport([laxResult]);
  assert.equal(laxReport.overall, "FAILED");
  assert.equal(
    laxReport.safetyGates.find((gate) => gate.id === "false-verified-zero").violated,
    true,
  );
  const strictResult = await strictHarness.runScenario(forgedProvenanceScenario());
  assert.equal(strictResult.outcome, "REJECTED");
  assert.equal(strictResult.matched, true);
  assert.equal(strictHarness.generateReport([strictResult]).overall, "PASSED");
});
