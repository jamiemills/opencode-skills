"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createShadowRunner } from "../../lib/rollout/shadow.mjs";
import { fixedNow, sequenceClock } from "./helpers.mjs";

test("shadow: effects are recorded, never applied, and the run verifies side-effect free", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const scenario = {
    scenarioId: "shadow-publish-compare",
    input: { target: "demo-site", pages: ["/a", "/b"] },
    async execute(config, input, toolkit) {
      await toolkit.effects.record("publish", { target: input.target, theme: config.theme });
      return { published: input.pages.length, theme: config.theme };
    },
  };
  const runResult = await shadow.run({ theme: "candidate" }, { theme: "control" }, scenario);
  assert.equal(runResult.mode, "shadow");
  assert.equal(runResult.scenarioId, "shadow-publish-compare");
  assert.equal(runResult.appliedEffects.length, 0);
  assert.equal(runResult.candidate.effects.length, 1);
  assert.equal(runResult.control.effects.length, 1);
  assert.equal(runResult.candidate.effects[0].applied, false);
  assert.equal(runResult.candidate.effects[0].side, "candidate");
  assert.equal(runResult.candidate.effects[0].payload.theme, "candidate");
  const verification = shadow.assertZeroSideEffects(runResult);
  assert.equal(verification.verified, true);
  assert.equal(verification.recordedEffectCount, 2);
  assert.equal(verification.appliedEffectCount, 0);
});

test("shadow: candidate input mutation alone is detected and fails the zero-side-effect assertion", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const scenario = {
    input: { items: [1, 2] },
    async execute(config, input) {
      if (config.mutate) input.items.push(3);
      return { count: input.items.length };
    },
  };
  const runResult = await shadow.run({ mutate: true }, { mutate: false }, scenario);
  assert.equal(runResult.control.inputMutated, false);
  assert.equal(runResult.candidate.inputMutated, true);
  assert.throws(
    () => shadow.assertZeroSideEffects(runResult),
    (error) => {
      assert.equal(error.code, "shadow-side-effect");
      assert.ok(
        error.info.violations.some((violation) => violation.rule === "candidate-input-mutated"),
      );
      return true;
    },
  );
});

test("shadow: identical outcomes match and differing outcomes are reported as a mismatch", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const matching = await shadow.run(
    { factor: 2 },
    { factor: 2 },
    {
      input: { value: 21 },
      async execute(config, input) {
        return { answer: input.value * config.factor };
      },
    },
  );
  assert.equal(matching.comparison.outcomeMatch, true);
  const divergent = await shadow.run(
    { factor: 3 },
    { factor: 2 },
    {
      input: { value: 21 },
      async execute(config, input) {
        return { answer: input.value * config.factor };
      },
    },
  );
  assert.equal(divergent.comparison.outcomeMatch, false);
  assert.deepEqual(divergent.candidate.outcome, { answer: 63 });
  assert.deepEqual(divergent.control.outcome, { answer: 42 });
});

test("shadow: latency delta is measured with the default monotonic clock", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const runResult = await shadow.run(
    { slow: true },
    { slow: false },
    {
      input: {},
      async execute(config) {
        if (config.slow) await new Promise((resolve) => setTimeout(resolve, 25));
        return { ok: true };
      },
    },
  );
  assert.equal(runResult.comparison.outcomeMatch, true);
  assert.ok(
    runResult.candidate.latencyMs >= 20,
    `candidate latency ${runResult.candidate.latencyMs}`,
  );
  assert.ok(runResult.comparison.latencyDeltaMs > 0);
  assert.ok(runResult.comparison.latencyRatio > 1);
});

test("shadow: latency uses the injectable clock for deterministic measurement", async () => {
  const shadow = createShadowRunner({ now: fixedNow, clock: sequenceClock([10, 15, 40, 44]) });
  const runResult = await shadow.run({}, {}, { input: {}, async execute() {} });
  assert.equal(runResult.control.latencyMs, 5);
  assert.equal(runResult.candidate.latencyMs, 4);
  assert.equal(runResult.comparison.latencyDeltaMs, -1);
  assert.equal(runResult.comparison.latencyRatio, 0.8);
});

test("shadow: resource usage deltas are compared per key", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const runResult = await shadow.run(
    { load: 18 },
    { load: 10 },
    {
      input: {},
      async execute(config) {
        return { outcome: { ok: true }, resources: { cpuMs: config.load, calls: 2 } };
      },
    },
  );
  assert.deepEqual(runResult.comparison.resourceDelta, { cpuMs: 8, calls: 0 });
  assert.deepEqual(runResult.candidate.resources, { cpuMs: 18, calls: 2 });
});

test("shadow: a throwing candidate is captured as an error and reported as an outcome mismatch", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  const runResult = await shadow.run(
    { crash: true },
    { crash: false },
    {
      input: {},
      async execute(config) {
        if (config.crash) {
          const failure = new Error("candidate exploded");
          failure.code = "candidate-boom";
          throw failure;
        }
        return { ok: true };
      },
    },
  );
  assert.equal(runResult.control.error, null);
  assert.equal(runResult.candidate.error.code, "candidate-boom");
  assert.equal(runResult.candidate.error.message, "candidate exploded");
  assert.equal(runResult.comparison.outcomeMatch, false);
});

test("shadow: invalid scenarios and invalid run results fail closed", async () => {
  const shadow = createShadowRunner({ now: fixedNow });
  await assert.rejects(
    () => shadow.run({}, {}, { input: {} }),
    (error) => error.code === "invalid-scenario",
  );
  await assert.rejects(
    () => shadow.run({}, {}, { input: {}, execute() {}, sneaky: true }),
    (error) => error.code === "invalid-scenario",
  );
  await assert.rejects(
    () => shadow.run({}, {}, { execute() {} }),
    (error) => error.code === "invalid-scenario",
  );
  assert.throws(
    () => shadow.assertZeroSideEffects({ mode: "live", appliedEffects: [] }),
    (error) => error.code === "invalid-run-result",
  );
});
