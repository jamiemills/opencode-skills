"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createCanaryController } from "../../lib/rollout/canary.mjs";
import { createConfigVersionRegistry } from "../../lib/rollout/versions.mjs";
import {
  createRolloutStack,
  fixedNow,
  healthyMetrics,
  seedActiveGoodVersion,
  sequenceClock,
} from "./helpers.mjs";

test("canary: start pins a config version and digest in the registry", () => {
  const { versionRegistry, canary } = createRolloutStack();
  const status = canary.start({ mode: "candidate" });
  assert.equal(status.state, "running");
  assert.ok(status.canaryId.startsWith("canary-"));
  assert.equal(typeof status.configVersion, "string");
  const record = versionRegistry.get(status.configVersion);
  assert.equal(record.configDigest, status.configDigest);
  assert.equal(record.state, "registered");
  assert.equal(versionRegistry.historySize(), 1);
});

test("canary: explicit version pinning rejects a digest mismatch", () => {
  const { versionRegistry, canary } = createRolloutStack();
  const pinned = versionRegistry.register({ mode: "baseline" });
  assert.throws(
    () => canary.start({ mode: "candidate" }, { configVersion: pinned.versionId }),
    (error) => {
      assert.equal(error.code, "version-mismatch");
      assert.equal(error.info.observed, pinned.configDigest);
      assert.notEqual(error.info.expected, pinned.configDigest);
      return true;
    },
  );
  const status = canary.start({ mode: "baseline" }, { configVersion: pinned.versionId });
  assert.equal(status.configVersion, pinned.versionId);
  assert.equal(versionRegistry.historySize(), 1);
});

test("canary: only one isolated canary may run at a time", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "a" });
  assert.throws(
    () => canary.start({ mode: "b" }),
    (error) => error.code === "canary-active",
  );
});

test("canary: healthy metrics produce a healthy decision and accumulate samples", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  const first = canary.checkSLOs(healthyMetrics({ samples: 40 }));
  assert.equal(first.decision, "healthy");
  assert.deepEqual(first.violations, []);
  const second = canary.checkSLOs(healthyMetrics({ samples: 60 }));
  assert.equal(second.decision, "healthy");
  const status = canary.getStatus();
  assert.equal(status.samples, 100);
  assert.equal(status.evaluations.count, 2);
  assert.equal(status.evaluations.last.decision, "healthy");
});

test("canary: every absolute stop condition trips an immediate rollback decision", () => {
  const absoluteStops = [
    ["falseVerified", 1],
    ["unauthorizedEffects", 1],
    ["duplicateNonIdempotentEffects", 1],
    ["provenanceMismatches", 1],
    ["telemetryBlindSpots", 1],
  ];
  for (const [key, observed] of absoluteStops) {
    const { canary } = createRolloutStack();
    canary.start({ mode: "candidate" });
    const evaluation = canary.checkSLOs(healthyMetrics({ [key]: observed }));
    assert.equal(evaluation.decision, "rollback", `${key} must stop the canary`);
    const violation = evaluation.violations.find((entry) => entry.rule === key);
    assert.equal(violation.kind, "absolute");
    assert.equal(violation.observed, observed);
    assert.equal(violation.threshold, 0);
    assert.equal(canary.shouldRollback(), true);
    assert.equal(canary.shouldPromote(), false);
  }
});

test("canary: missing or non-finite measurements are telemetry blindness and stop the canary", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  const evaluation = canary.checkSLOs({ samples: 10 });
  assert.equal(evaluation.decision, "rollback");
  const violation = evaluation.violations.find((entry) => entry.rule === "telemetry-blindness");
  assert.equal(violation.kind, "absolute");
  assert.ok(violation.observed.includes("missing-or-non-finite"));

  const { canary: partialCanary } = createRolloutStack();
  partialCanary.start({ mode: "candidate" });
  const partial = partialCanary.checkSLOs(
    healthyMetrics({ canary: { p99LatencyMs: Number.NaN, errorRate: 0.01 } }),
  );
  assert.equal(partial.decision, "rollback");
  assert.ok(partial.violations.some((entry) => entry.rule === "telemetry-blindness"));
});

test("canary: p99 latency stops above 1.5x control and passes at exactly 1.5x", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  const atBoundary = canary.checkSLOs(
    healthyMetrics({ canary: { p99LatencyMs: 150, errorRate: 0.01 } }),
  );
  assert.equal(atBoundary.decision, "healthy");

  const { canary: slowerCanary } = createRolloutStack();
  slowerCanary.start({ mode: "candidate" });
  const evaluation = slowerCanary.checkSLOs(
    healthyMetrics({ canary: { p99LatencyMs: 151, errorRate: 0.01 } }),
  );
  assert.equal(evaluation.decision, "rollback");
  const violation = evaluation.violations.find((entry) => entry.rule === "p99-latency-ratio");
  assert.equal(violation.kind, "relative");
  assert.equal(violation.threshold, 1.5);
  assert.equal(violation.control, 100);
  assert.equal(violation.canary, 151);
});

test("canary: error rate stops above 2x control, passes at exactly 2x, and any error against a zero-control stops", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  const atBoundary = canary.checkSLOs(
    healthyMetrics({ canary: { p99LatencyMs: 100, errorRate: 0.02 } }),
  );
  assert.equal(atBoundary.decision, "healthy");

  const { canary: worseCanary } = createRolloutStack();
  worseCanary.start({ mode: "candidate" });
  const evaluation = worseCanary.checkSLOs(
    healthyMetrics({ canary: { p99LatencyMs: 100, errorRate: 0.03 } }),
  );
  assert.equal(evaluation.decision, "rollback");
  const violation = evaluation.violations.find((entry) => entry.rule === "error-rate-ratio");
  assert.equal(violation.kind, "relative");
  assert.equal(violation.threshold, 2);
  assert.equal(violation.control, 0.01);
  assert.equal(violation.canary, 0.03);

  const { canary: zeroControlCanary } = createRolloutStack();
  zeroControlCanary.start({ mode: "candidate" });
  const zeroControl = zeroControlCanary.checkSLOs(
    healthyMetrics({
      canary: { p99LatencyMs: 100, errorRate: 0.001 },
      control: { p99LatencyMs: 100, errorRate: 0 },
    }),
  );
  assert.equal(zeroControl.decision, "rollback");
  assert.ok(zeroControl.violations.some((entry) => entry.rule === "error-rate-ratio"));
});

test("canary: promotion requires evaluations, samples, duration, and zero violations", () => {
  const insufficientSamples = createCanaryController({
    now: fixedNow,
    stopRules: { minSamples: 10, minDurationMs: 0 },
  });
  insufficientSamples.start({ mode: "candidate" });
  assert.equal(insufficientSamples.shouldPromote(), false);
  insufficientSamples.checkSLOs(healthyMetrics({ samples: 5 }));
  assert.equal(insufficientSamples.shouldPromote(), false);
  insufficientSamples.checkSLOs(healthyMetrics({ samples: 5 }));
  assert.equal(insufficientSamples.shouldPromote(), true);
  assert.equal(insufficientSamples.shouldRollback(), false);

  const tooEarly = createCanaryController({
    now: fixedNow,
    clock: sequenceClock([0, 30000]),
    stopRules: { minSamples: 10, minDurationMs: 60000 },
  });
  tooEarly.start({ mode: "candidate" });
  tooEarly.checkSLOs(healthyMetrics({ samples: 50 }));
  assert.equal(tooEarly.shouldPromote(), false);
  assert.equal(tooEarly.getStatus().elapsedMs, 30000);

  const mature = createCanaryController({
    now: fixedNow,
    clock: sequenceClock([0, 60000]),
    stopRules: { minSamples: 10, minDurationMs: 60000 },
  });
  mature.start({ mode: "candidate" });
  mature.checkSLOs(healthyMetrics({ samples: 50 }));
  assert.equal(mature.getStatus().elapsedMs, 60000);
  assert.equal(mature.shouldPromote(), true);
});

test("canary: a stop decision is permanent and blocks later promotion", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  canary.checkSLOs(healthyMetrics({ falseVerified: 1 }));
  assert.equal(canary.shouldRollback(), true);
  canary.checkSLOs(healthyMetrics({ samples: 100 }));
  assert.equal(canary.getStatus().evaluations.last.decision, "healthy");
  assert.equal(canary.shouldRollback(), true);
  assert.equal(canary.shouldPromote(), false);
  assert.throws(
    () => canary.markPromoted(),
    (error) => {
      assert.equal(error.code, "canary-not-promotable");
      assert.ok(error.info.reasons.includes("violations-1"));
      return true;
    },
  );
});

test("canary: markPromoted records state and marks the version known-good in the registry", () => {
  const { versionRegistry, canary } = createRolloutStack();
  const good = seedActiveGoodVersion(versionRegistry);
  canary.start({ mode: "candidate" });
  canary.checkSLOs(healthyMetrics({ samples: 100 }));
  const status = canary.markPromoted();
  assert.equal(status.state, "promoted");
  const promotedRecord = versionRegistry.get(status.configVersion);
  assert.equal(promotedRecord.knownGood, true);
  assert.equal(promotedRecord.knownGoodEvidence.canaryId, status.canaryId);
  assert.equal(
    versionRegistry.getLastKnownGood({ excluding: good.versionId }).versionId,
    status.configVersion,
  );
  assert.equal(canary.shouldPromote(), false);
  assert.throws(
    () => canary.markPromoted(),
    (error) => {
      assert.equal(error.code, "canary-not-promotable");
      assert.ok(error.info.reasons.includes("state-promoted"));
      return true;
    },
  );
  const restarted = canary.start({ mode: "next" });
  assert.equal(restarted.state, "running");
  assert.notEqual(restarted.canaryId, status.canaryId);
});

test("canary: getStatus is frozen, carries stop rules, and reflects in-flight effects", () => {
  const { canary } = createRolloutStack();
  canary.start({ mode: "candidate" });
  canary.checkSLOs(
    healthyMetrics({
      inFlightEffects: [{ effectId: "eff-1", kind: "publish", idempotent: true }],
    }),
  );
  const status = canary.getStatus();
  assert.throws(() => {
    status.state = "hacked";
  }, TypeError);
  assert.throws(() => {
    status.stopRules.minSamples = 0;
  }, TypeError);
  assert.deepEqual(status.inFlightEffects, [
    { kind: "publish", idempotent: true, dispatchedAt: null, effectId: "eff-1" },
  ]);
  assert.equal(status.stopRules.relative.p99LatencyRatioMax, 1.5);
  assert.equal(status.stopRules.relative.errorRateRatioMax, 2);
});

test("canary: checkSLOs and start validate their inputs with typed errors", () => {
  const { canary } = createRolloutStack();
  assert.throws(
    () => canary.checkSLOs(healthyMetrics()),
    (error) => error.code === "canary-not-running",
  );
  const fresh = createRolloutStack().canary;
  assert.throws(
    () => fresh.start("not-an-object"),
    (error) => error.code === "invalid-config",
  );
  canary.start({ mode: "candidate" });
  assert.throws(
    () => canary.checkSLOs(null),
    (error) => error.code === "invalid-metrics",
  );
  assert.throws(
    () => createCanaryController({ stopRules: { minSamples: -1 } }),
    (error) => error.code === "invalid-stop-rules",
  );
  assert.throws(
    () => createCanaryController({ stopRules: { surprise: 1 } }),
    (error) => error.code === "invalid-stop-rules",
  );
});

test("canary: a canary without a registry runs unpinned with a null config version", () => {
  const canary = createCanaryController({
    now: fixedNow,
    stopRules: { minSamples: 1, minDurationMs: 0 },
  });
  const status = canary.start({ mode: "candidate" });
  assert.equal(status.configVersion, null);
  assert.equal(status.configDigest.length > "sha256:".length, true);
  canary.checkSLOs(healthyMetrics());
  assert.equal(canary.shouldPromote(), true);
});

test("canary: registry integration keeps the pinned config immutable", () => {
  const registry = createConfigVersionRegistry({ now: fixedNow });
  const canary = createCanaryController({ now: fixedNow, versionRegistry: registry });
  const config = { mode: "candidate", nested: { list: [1, 2] } };
  const status = canary.start(config);
  config.nested.list.push(3);
  config.mode = "mutated";
  const record = registry.get(status.configVersion);
  assert.deepEqual(record.config, { mode: "candidate", nested: { list: [1, 2] } });
  assert.equal(record.configDigest, status.configDigest);
});
