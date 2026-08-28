"use strict";

import { performance } from "node:perf_hooks";
import { digest } from "../schema-runtime/index.mjs";
import { RolloutError, cloneData, deepFreeze, isFiniteNumber, isPlainObject } from "./internal.mjs";

export const CANARY_RECORD_FORMAT = "csm-canary-record/1";
export const CANARY_STATES = Object.freeze(["idle", "running", "promoted", "rolled-back"]);

export const ABSOLUTE_STOP_RULES = Object.freeze({
  falseVerifiedMax: 0,
  unauthorizedEffectsMax: 0,
  duplicateNonIdempotentEffectsMax: 0,
  provenanceMismatchesMax: 0,
  telemetryBlindSpotsMax: 0,
});
export const RELATIVE_STOP_RULES = Object.freeze({
  p99LatencyRatioMax: 1.5,
  errorRateRatioMax: 2,
});
export const DEFAULT_STOP_RULES = Object.freeze({
  absolute: ABSOLUTE_STOP_RULES,
  relative: RELATIVE_STOP_RULES,
  minSamples: 50,
  minDurationMs: 60000,
});

const STOP_RULE_KEYS = Object.freeze(["absolute", "relative", "minSamples", "minDurationMs"]);
const ABSOLUTE_RULES = Object.freeze([
  Object.freeze({ key: "falseVerified", max: "falseVerifiedMax" }),
  Object.freeze({ key: "unauthorizedEffects", max: "unauthorizedEffectsMax" }),
  Object.freeze({ key: "duplicateNonIdempotentEffects", max: "duplicateNonIdempotentEffectsMax" }),
  Object.freeze({ key: "provenanceMismatches", max: "provenanceMismatchesMax" }),
  Object.freeze({ key: "telemetryBlindSpots", max: "telemetryBlindSpotsMax" }),
]);

export class CanaryError extends RolloutError {}

function mergeStopRules(overrides = {}) {
  if (overrides === null || !isPlainObject(overrides))
    throw new CanaryError("invalid-stop-rules", "stopRules must be a plain object");
  for (const key of Object.keys(overrides))
    if (!STOP_RULE_KEYS.includes(key))
      throw new CanaryError(
        "invalid-stop-rules",
        `stopRules key '${key}' is unknown (allowed: ${STOP_RULE_KEYS.join(", ")})`,
      );
  for (const key of ["absolute", "relative"])
    if (overrides[key] !== undefined && !isPlainObject(overrides[key]))
      throw new CanaryError("invalid-stop-rules", `stopRules.${key} must be a plain object`);
  const absolute = { ...ABSOLUTE_STOP_RULES, ...overrides.absolute };
  const relative = { ...RELATIVE_STOP_RULES, ...overrides.relative };
  for (const key of Object.keys(absolute))
    if (!(key in ABSOLUTE_STOP_RULES))
      throw new CanaryError("invalid-stop-rules", `absolute stop rule '${key}' is unknown`);
  for (const key of Object.keys(relative))
    if (!(key in RELATIVE_STOP_RULES))
      throw new CanaryError("invalid-stop-rules", `relative stop rule '${key}' is unknown`);
  const merged = {
    absolute,
    relative,
    minSamples: overrides.minSamples ?? DEFAULT_STOP_RULES.minSamples,
    minDurationMs: overrides.minDurationMs ?? DEFAULT_STOP_RULES.minDurationMs,
  };
  for (const value of Object.values(merged.absolute))
    if (!Number.isInteger(value) || value < 0)
      throw new CanaryError(
        "invalid-stop-rules",
        "absolute stop-rule maxima must be non-negative integers",
      );
  for (const value of Object.values(merged.relative))
    if (!isFiniteNumber(value) || value <= 0)
      throw new CanaryError(
        "invalid-stop-rules",
        "relative stop-rule maxima must be positive finite numbers",
      );
  if (!Number.isInteger(merged.minSamples) || merged.minSamples < 0)
    throw new CanaryError("invalid-stop-rules", "minSamples must be a non-negative integer");
  if (!isFiniteNumber(merged.minDurationMs) || merged.minDurationMs < 0)
    throw new CanaryError(
      "invalid-stop-rules",
      "minDurationMs must be a non-negative finite number",
    );
  return deepFreeze(merged);
}

export function createCanaryController(options = {}) {
  if (options !== null && !isPlainObject(options))
    throw new CanaryError("invalid-options", "canary controller options must be a plain object");
  const now = options.now ?? (() => new Date().toISOString());
  const clock = options.clock ?? (() => performance.now());
  const versionRegistry = options.versionRegistry ?? null;
  if (versionRegistry !== null && !isPlainObject(versionRegistry))
    throw new CanaryError("invalid-options", "versionRegistry must be a registry object");
  const stopRules = mergeStopRules(options.stopRules ?? {});

  let canarySequence = 0;
  let current = null;
  const evaluations = [];
  const violations = [];
  const inFlightEffects = new Map();
  let totalSamples = 0;

  function elapsedMs() {
    return current === null ? null : clock() - current.startedClock;
  }

  function getStatus() {
    if (current === null)
      return deepFreeze({
        state: "idle",
        canaryId: null,
        configVersion: null,
        configDigest: null,
        startedAt: null,
        elapsedMs: null,
        samples: 0,
        evaluations: { count: 0, last: null },
        violations: [],
        inFlightEffects: [],
        stopRules,
        rolledBackAt: null,
        rollbackReason: null,
      });
    return deepFreeze(
      cloneData({
        state: current.state,
        canaryId: current.canaryId,
        configVersion: current.configVersion,
        configDigest: current.configDigest,
        startedAt: current.startedAt,
        elapsedMs: elapsedMs(),
        samples: totalSamples,
        evaluations: {
          count: evaluations.length,
          last: evaluations[evaluations.length - 1] ?? null,
        },
        violations: [...violations],
        inFlightEffects: [...inFlightEffects.values()],
        stopRules: current.stopRules,
        rolledBackAt: current.rolledBackAt,
        rollbackReason: current.rollbackReason,
      }),
    );
  }

  function start(config, meta = {}) {
    if (current !== null && current.state === "running")
      throw new CanaryError(
        "canary-active",
        `canary '${current.canaryId}' is still running; one isolated canary at a time`,
      );
    if (!isPlainObject(config))
      throw new CanaryError("invalid-config", "canary config must be a plain object");
    if (meta !== null && !isPlainObject(meta))
      throw new CanaryError("invalid-meta", "canary meta must be a plain object");
    const configDigest = digest(config);
    let configVersion = null;
    if (meta.configVersion !== undefined) {
      if (versionRegistry === null)
        throw new CanaryError(
          "version-mismatch",
          "pinning an explicit configVersion requires a version registry",
        );
      let record = null;
      try {
        record = versionRegistry.get(meta.configVersion);
      } catch {
        record = null;
      }
      if (record === null || record.configDigest !== configDigest)
        throw new CanaryError(
          "version-mismatch",
          `pinned config version '${String(meta.configVersion)}' does not match the provided config digest`,
          { expected: configDigest, observed: record?.configDigest ?? null },
        );
      configVersion = record.versionId;
    } else if (versionRegistry !== null) {
      configVersion = versionRegistry.register(config).versionId;
    }
    canarySequence += 1;
    evaluations.length = 0;
    violations.length = 0;
    inFlightEffects.clear();
    totalSamples = 0;
    current = {
      canaryId: `canary-${canarySequence}`,
      state: "running",
      configVersion,
      configDigest,
      config: deepFreeze(cloneData(config)),
      startedAt: now(),
      startedClock: clock(),
      stopRules,
      meta: deepFreeze(cloneData(meta ?? {})),
      rolledBackAt: null,
      rollbackReason: null,
    };
    return getStatus();
  }

  function recordInFlightEffects(metrics) {
    if (!Array.isArray(metrics.inFlightEffects)) return;
    for (const effect of metrics.inFlightEffects) {
      if (!isPlainObject(effect) || typeof effect.effectId !== "string") continue;
      if (inFlightEffects.has(effect.effectId)) continue;
      inFlightEffects.set(
        effect.effectId,
        deepFreeze(
          cloneData({ kind: "unknown", idempotent: false, dispatchedAt: null, ...effect }),
        ),
      );
    }
  }

  function checkSLOs(metrics) {
    if (current === null || (current.state !== "running" && current.state !== "promoted"))
      throw new CanaryError("canary-not-running", "checkSLOs requires a running canary");
    if (!isPlainObject(metrics))
      throw new CanaryError("invalid-metrics", "metrics must be a plain object");
    const rules = current.stopRules;
    const found = [];
    const blind = (detail) =>
      found.push({ kind: "absolute", rule: "telemetry-blindness", observed: detail, threshold: 0 });
    const sidesMeasurable =
      isPlainObject(metrics.canary) &&
      isPlainObject(metrics.control) &&
      isFiniteNumber(metrics.canary.p99LatencyMs) &&
      isFiniteNumber(metrics.canary.errorRate) &&
      isFiniteNumber(metrics.control.p99LatencyMs) &&
      isFiniteNumber(metrics.control.errorRate) &&
      isFiniteNumber(metrics.samples);
    if (!sidesMeasurable) blind("missing-or-non-finite-canary-control-measurements");
    for (const rule of ABSOLUTE_RULES) {
      const observed = metrics[rule.key];
      if (!isFiniteNumber(observed)) {
        blind(`${rule.key}-missing`);
        continue;
      }
      if (observed > rules.absolute[rule.max])
        found.push({
          kind: "absolute",
          rule: rule.key,
          observed,
          threshold: rules.absolute[rule.max],
        });
    }
    if (sidesMeasurable) {
      const { p99LatencyRatioMax, errorRateRatioMax } = rules.relative;
      if (
        metrics.control.p99LatencyMs > 0 &&
        metrics.canary.p99LatencyMs > metrics.control.p99LatencyMs * p99LatencyRatioMax
      )
        found.push({
          kind: "relative",
          rule: "p99-latency-ratio",
          observed: metrics.canary.p99LatencyMs / metrics.control.p99LatencyMs,
          threshold: p99LatencyRatioMax,
          control: metrics.control.p99LatencyMs,
          canary: metrics.canary.p99LatencyMs,
        });
      if (metrics.canary.errorRate > metrics.control.errorRate * errorRateRatioMax)
        found.push({
          kind: "relative",
          rule: "error-rate-ratio",
          observed:
            metrics.control.errorRate > 0
              ? metrics.canary.errorRate / metrics.control.errorRate
              : null,
          threshold: errorRateRatioMax,
          control: metrics.control.errorRate,
          canary: metrics.canary.errorRate,
        });
    }
    const decision = found.length > 0 ? "rollback" : "healthy";
    const evaluation = deepFreeze({
      evaluatedAt: now(),
      decision,
      violations: found,
      samples: isFiniteNumber(metrics.samples) ? metrics.samples : 0,
    });
    evaluations.push(evaluation);
    if (found.length > 0) violations.push(...found);
    if (isFiniteNumber(metrics.samples)) totalSamples += metrics.samples;
    recordInFlightEffects(metrics);
    return evaluation;
  }

  function promotionBlockers() {
    const reasons = [];
    if (current === null || current.state !== "running")
      reasons.push(`state-${current === null ? "idle" : current.state}`);
    if (evaluations.length === 0) reasons.push("no-slo-evaluation");
    else if (evaluations[evaluations.length - 1].decision !== "healthy")
      reasons.push("last-evaluation-unhealthy");
    if (violations.length > 0) reasons.push(`violations-${violations.length}`);
    if (totalSamples < stopRules.minSamples)
      reasons.push(`samples-${totalSamples}-lt-${stopRules.minSamples}`);
    if (current !== null && elapsedMs() < stopRules.minDurationMs)
      reasons.push(`elapsed-${elapsedMs()}-lt-${stopRules.minDurationMs}`);
    return reasons;
  }

  function shouldPromote() {
    return promotionBlockers().length === 0;
  }

  function shouldRollback() {
    if (current === null) return false;
    if (current.state === "rolled-back") return true;
    return violations.length > 0;
  }

  function markPromoted() {
    const reasons = promotionBlockers();
    if (reasons.length > 0)
      throw new CanaryError(
        "canary-not-promotable",
        "canary does not satisfy promotion preconditions",
        {
          reasons,
        },
      );
    current.state = "promoted";
    if (versionRegistry !== null && current.configVersion !== null)
      versionRegistry.markKnownGood(current.configVersion, {
        canaryId: current.canaryId,
        samples: totalSamples,
        evaluations: evaluations.length,
      });
    return getStatus();
  }

  function markRolledBack(reason) {
    if (current === null)
      throw new CanaryError("canary-not-running", "no canary exists on this controller");
    if (typeof reason !== "string" || reason.length === 0)
      throw new CanaryError("invalid-reason", "rollback reason must be a non-empty string");
    if (current.state === "rolled-back") return getStatus();
    current.state = "rolled-back";
    current.rolledBackAt = now();
    current.rollbackReason = reason;
    return getStatus();
  }

  return Object.freeze({
    start,
    checkSLOs,
    shouldPromote,
    shouldRollback,
    markPromoted,
    markRolledBack,
    getStatus,
  });
}
