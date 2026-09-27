"use strict";

// T003: coverage profiles, a run-level budget guard, and a telemetry record
// builder. All pure and fail-open: the guard only decides whether to CONSULT;
// it never pauses the run and never owns a gate. Coverage profiles map to a
// point set; only non-safety apply points may change behavior (enforced
// elsewhere), so a profile narrows coverage, never authority.

export const DECISION_COVERAGE_PROFILES = Object.freeze(["off", "shadow", "wide", "excessive"]);

export function resolveCoverageProfile(profile) {
  const id = DECISION_COVERAGE_PROFILES.includes(profile) ? profile : "off";
  return Object.freeze({
    id,
    enabled: id !== "off",
    prefetch: id === "wide" || id === "excessive",
    window: id === "excessive",
  });
}

export const DECISION_BUDGET_TIERS = Object.freeze(["NORMAL", "THROTTLED", "SHADOW_ONLY", "OFF"]);

export function createBudgetGuard({
  maxPointCalls = 32,
  maxCalls = null,
  maxCost = null,
  throttleAt = 0.7,
  shadowAt = 0.9,
} = {}) {
  const pointCap = Number.isInteger(maxPointCalls) && maxPointCalls > 0 ? maxPointCalls : 32;
  const callCap = Number.isFinite(maxCalls) && maxCalls > 0 ? maxCalls : null;
  const costCap = Number.isFinite(maxCost) && maxCost > 0 ? maxCost : null;

  let calls = 0;
  let cost = 0;
  const byPoint = new Map();

  const ratio = () => {
    const ratios = [];
    if (callCap !== null) ratios.push(calls / callCap);
    if (costCap !== null) ratios.push(cost / costCap);
    return ratios.length ? Math.max(...ratios) : 0;
  };

  function tier() {
    const value = ratio();
    if (value >= 1) return "OFF";
    if (value >= shadowAt) return "SHADOW_ONLY";
    if (value >= throttleAt) return "THROTTLED";
    return "NORMAL";
  }

  function allowCall(pointId) {
    if (tier() === "OFF") return false;
    return (byPoint.get(pointId) ?? 0) < pointCap;
  }

  function noteCall(pointId) {
    calls += 1;
    byPoint.set(pointId, (byPoint.get(pointId) ?? 0) + 1);
  }

  function noteCost(value) {
    if (Number.isFinite(value) && value >= 0) cost += value;
  }

  return Object.freeze({
    tier,
    allowCall,
    noteCall,
    noteCost,
    snapshot: () => Object.freeze({ calls, cost, tier: tier() }),
  });
}

export function decisionTelemetry({
  pointId,
  mode = "live",
  latencyMs = null,
  usage = null,
  applied = false,
  baselineAgreement = null,
  failure = null,
} = {}) {
  return Object.freeze({
    pointId,
    mode,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    tokens: usage?.inputTokens ?? null,
    cost: Number.isFinite(usage?.cost) ? usage.cost : null,
    applied: applied === true,
    baselineAgreement: baselineAgreement === null ? null : baselineAgreement === true,
    failure: failure ?? null,
  });
}
