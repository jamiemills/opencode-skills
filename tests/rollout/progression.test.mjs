"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createShadowRunner } from "../../lib/rollout/shadow.mjs";
import { checkPromotionGates } from "../../lib/rollout/promotion.mjs";
import { createRolloutStack, fixedNow, healthyMetrics, seedActiveGoodVersion } from "./helpers.mjs";

test("progression: shadow parity, healthy canary, promotion, and passing gates", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const scenario = {
    scenarioId: "progression-parity",
    input: { request: "plan" },
    async execute(config, input, toolkit) {
      await toolkit.effects.record("render", { style: config.style });
      return { plan: `${input.request}-${config.style}` };
    },
  };
  const shadowRun = await shadow.run({ style: "next" }, { style: "next" }, scenario);
  assert.equal(shadow.assertZeroSideEffects(shadowRun).verified, true);
  assert.equal(shadowRun.comparison.outcomeMatch, true);

  const stack = createRolloutStack();
  const good = seedActiveGoodVersion(stack.versionRegistry, { style: "current" });
  const candidate = stack.versionRegistry.register({ style: "next" });
  stack.canary.start({ style: "next" }, { configVersion: candidate.versionId });
  stack.canary.checkSLOs(healthyMetrics({ samples: 250 }));
  assert.equal(stack.canary.shouldPromote(), true);
  const promoted = stack.canary.markPromoted();
  stack.versionRegistry.activate(promoted.configVersion);
  assert.equal(stack.versionRegistry.getActiveVersionId(), promoted.configVersion);

  const review = checkPromotionGates({
    local: {
      G0: { passed: 12, failed: 0 },
      G1: { passed: 38, failed: 0 },
      G2: { passed: 9, failed: 0 },
      G3: { passed: 6, failed: 0 },
      G4: { passed: 11, failed: 0 },
    },
    deployment: {
      G5: { passed: 3, failed: 0 },
      G6: { passed: 4, failed: 0 },
      G7: { passed: 2, failed: 0 },
      G8: { passed: 1, failed: 0, details: `canary ${promoted.canaryId} + exercised rollback` },
    },
  });
  assert.equal(review.promotable, true);
  assert.ok(review.gates.every((gate) => gate.status === "pass"));
  assert.notEqual(stack.versionRegistry.getActiveVersionId(), good.versionId);
});

test("progression: a diverging shadow and a stopped canary roll back and block promotion", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const shadowRun = await shadow.run(
    { style: "risky" },
    { style: "current" },
    {
      scenarioId: "progression-divergence",
      input: {},
      async execute(config) {
        return { value: config.style };
      },
    },
  );
  assert.equal(shadowRun.comparison.outcomeMatch, false);

  const stack = createRolloutStack();
  const good = seedActiveGoodVersion(stack.versionRegistry, { style: "current" });
  const candidate = stack.versionRegistry.register({ style: "risky" });
  stack.canary.start({ style: "risky" }, { configVersion: candidate.versionId });
  stack.canary.checkSLOs(healthyMetrics({ duplicateNonIdempotentEffects: 1 }));
  assert.equal(stack.canary.shouldRollback(), true);
  const rollbackRecord = stack.rollback.execute(
    stack.canary.getStatus().canaryId,
    "duplicate-non-idempotent",
  );
  assert.equal(rollbackRecord.dispatchBlocked, true);
  assert.equal(stack.rollback.verify(stack.canary.getStatus().canaryId).verified, true);
  assert.equal(stack.versionRegistry.getActiveVersionId(), good.versionId);

  const review = checkPromotionGates({
    local: {
      G0: { passed: 12, failed: 0 },
      G1: { passed: 38, failed: 0 },
      G2: { passed: 9, failed: 0 },
      G3: { passed: 6, failed: 0 },
      G4: { passed: 11, failed: 0 },
    },
    deployment: {
      G5: { passed: 3, failed: 0 },
      G6: { passed: 4, failed: 0 },
      G7: { passed: 2, failed: 0 },
      G8: { passed: 0, failed: 1, details: "canary stopped by absolute safety rule" },
    },
  });
  assert.equal(review.promotable, false);
  assert.equal(review.gates.find((gate) => gate.id === "G8").status, "fail");
});
