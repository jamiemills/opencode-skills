"use strict";

import { createConfigVersionRegistry } from "../../lib/rollout/versions.mjs";
import { createCanaryController } from "../../lib/rollout/canary.mjs";
import { createRollbackController } from "../../lib/rollout/rollback.mjs";

export const FIXED_NOW = "2026-08-28T00:00:00.000Z";

export function fixedNow() {
  return FIXED_NOW;
}

export function sequenceClock(values) {
  const queue = [...values];
  const last = values[values.length - 1];
  return () => (queue.length > 1 ? queue.shift() : last);
}

export function healthyMetrics(overrides = {}) {
  return {
    samples: 100,
    canary: { p99LatencyMs: 100, errorRate: 0.01 },
    control: { p99LatencyMs: 100, errorRate: 0.01 },
    falseVerified: 0,
    unauthorizedEffects: 0,
    duplicateNonIdempotentEffects: 0,
    provenanceMismatches: 0,
    telemetryBlindSpots: 0,
    ...overrides,
  };
}

export function createRolloutStack(options = {}) {
  const now = options.now ?? fixedNow;
  const versionRegistry = createConfigVersionRegistry({ now });
  const canary = createCanaryController({
    now,
    clock: options.canaryClock,
    versionRegistry,
    stopRules: { minSamples: 10, minDurationMs: 0, ...options.stopRules },
  });
  const rollback = createRollbackController({
    canary,
    versionRegistry,
    now,
    clock: options.rollbackClock,
  });
  return { versionRegistry, canary, rollback };
}

export function seedActiveGoodVersion(versionRegistry, config = { mode: "baseline" }) {
  const record = versionRegistry.register(config, { seed: true });
  versionRegistry.activate(record.versionId);
  versionRegistry.markKnownGood(record.versionId, { seeded: true });
  return record;
}
