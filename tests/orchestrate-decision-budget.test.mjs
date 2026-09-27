import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_COVERAGE_PROFILES,
  createBudgetGuard,
  decisionTelemetry,
  resolveCoverageProfile,
} from "../csm-orchestrate/lib/decision-adapter/budget.mjs";

test("coverage profiles: off disables; wide/excessive enable prefetch", () => {
  assert.deepEqual(resolveCoverageProfile("off").enabled, false);
  assert.equal(resolveCoverageProfile("weird").id, "off");
  assert.equal(resolveCoverageProfile("wide").prefetch, true);
  assert.equal(resolveCoverageProfile("excessive").window, true);
  assert.deepEqual(DECISION_COVERAGE_PROFILES, ["off", "shadow", "wide", "excessive"]);
});

test("budget guard enforces per-point caps and degrades tiers, never pauses", () => {
  const guard = createBudgetGuard({
    maxPointCalls: 2,
    maxCalls: 4,
    throttleAt: 0.5,
    shadowAt: 0.9,
  });
  assert.equal(guard.tier(), "NORMAL");
  assert.equal(guard.allowCall("p"), true);
  guard.noteCall("p");
  guard.noteCall("p");
  assert.equal(guard.allowCall("p"), false, "per-point cap reached");
  guard.noteCall("q");
  assert.equal(guard.tier(), "THROTTLED", "50% of maxCalls");
  guard.noteCall("q");
  assert.equal(guard.tier(), "OFF", "100% of maxCalls");
  assert.equal(guard.allowCall("r"), false);
});

test("budget guard tracks cost and never returns a paused state", () => {
  const guard = createBudgetGuard({ maxCost: 1 });
  guard.noteCost(0.5);
  assert.equal(guard.tier(), "NORMAL");
  guard.noteCost(0.5);
  assert.equal(guard.tier(), "OFF");
  assert.ok(!["PAUSED", "BLOCKED"].includes(guard.tier()));
});

test("telemetry records cost, latency, and applied/advisory", () => {
  const record = decisionTelemetry({
    pointId: "p1",
    latencyMs: 120,
    usage: { inputTokens: 10, cost: 0.00001 },
    applied: false,
    baselineAgreement: true,
  });
  assert.equal(record.pointId, "p1");
  assert.equal(record.latencyMs, 120);
  assert.equal(record.cost, 0.00001);
  assert.equal(record.applied, false);
  assert.equal(record.baselineAgreement, true);
});
