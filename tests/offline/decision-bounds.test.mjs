"use strict";

// T018: hermetic bounds for the provider-agnostic decision adapter. Every test
// injects a fake transport -- no network, no real provider, no clock dependence
// beyond a tiny injected adapter deadline. The matrix proves the per-point call
// cap, the (runId, pointId, digest(state)) in-run cache, single-flight, the
// adapter deadline (a transport that ignores AbortSignal cannot hang the run),
// cost/state-size fail-open, and deterministic-baseline agreement.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createDecisionAdapter,
  deterministicDecision,
} from "../../csm-orchestrate/lib/decision-adapter/index.mjs";

const POINT = "route-classification"; // non-safety, apply-eligible
const RUN_ID = "run-bounds-test";
const STATE = { request: "route this", candidates: ["csm-scan", "csm-ddd"] };

const bytes = (value) => Buffer.from(JSON.stringify(value));
const baseline = (pointId = POINT, state = STATE) => deterministicDecision(pointId, state);

const APPLY_OK = Object.freeze({
  ok: true,
  decision: { answer: "csm-scan", confidence: 0.9, usage: {} },
});

function assertBaseline(result, pointId = POINT, state = STATE) {
  assert.deepEqual(bytes(result), bytes(baseline(pointId, state)));
  assert.equal(result.applied, false);
  assert.equal(result.answer, null);
  assert.ok(!JSON.stringify(result).includes("PAUSED"));
}

// A recording fake transport: records every input at call time and resolves each
// scripted result in order (or the last one forever). `latencyMs` optionally
// delays resolution so concurrent callers overlap.
function fakeTransport(results = [APPLY_OK], { latencyMs = 0 } = {}) {
  const calls = [];
  let index = 0;
  return {
    providerId: "fake",
    calls,
    send: (input) => {
      calls.push(input);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (latencyMs > 0)
        return new Promise((resolve) => {
          setTimeout(() => resolve(result), latencyMs);
        });
      return Promise.resolve(result);
    },
  };
}

test("the per-point call cap bounds transport calls and then returns the baseline", async () => {
  const transport = fakeTransport();
  const adapter = createDecisionAdapter({
    mode: "live",
    transport,
    maxCallsPerPoint: 2,
  });

  // Distinct states avoid the cache so each eligible call is a real transport call.
  const first = await adapter.decide(POINT, { ...STATE, step: 1 });
  const second = await adapter.decide(POINT, { ...STATE, step: 2 });
  const third = await adapter.decide(POINT, { ...STATE, step: 3 });
  const fourth = await adapter.decide(POINT, { ...STATE, step: 4 });

  assert.equal(transport.calls.length, 2);
  assert.equal(first.applied, true);
  assert.equal(second.applied, true);
  assertBaseline(third, POINT, { ...STATE, step: 3 });
  assertBaseline(fourth, POINT, { ...STATE, step: 4 });
  assert.equal(adapter.stats().callsByPoint[POINT], 2);
  assert.equal(adapter.stats().consulted, 2);
});

test("the in-run cache prevents a second transport call for an identical key", async () => {
  const transport = fakeTransport();
  const adapter = createDecisionAdapter({ mode: "live", transport, runId: RUN_ID });

  const first = await adapter.decide(POINT, STATE);
  const second = await adapter.decide(POINT, STATE);

  assert.equal(transport.calls.length, 1, "an identical (runId, pointId, state) must be cached");
  assert.equal(first.applied, true);
  assert.equal(second.applied, true);
  assert.deepEqual(bytes(second), bytes(first));
  assert.equal(adapter.stats().cacheHits, 1);
  assert.equal(adapter.stats().consulted, 1);
});

test("the cache is keyed per point: a different point still consults", async () => {
  const transport = fakeTransport();
  const other = "ready-set-ordering";
  const adapter = createDecisionAdapter({ mode: "live", transport, runId: RUN_ID });

  await adapter.decide(POINT, STATE);
  await adapter.decide(other, STATE);

  assert.equal(transport.calls.length, 2);
  assert.equal(adapter.stats().cacheHits, 0);
});

test("two concurrent identical requests share exactly one transport call", async () => {
  const transport = fakeTransport([APPLY_OK], { latencyMs: 10 });
  const adapter = createDecisionAdapter({ mode: "live", transport, runId: RUN_ID });

  const [left, right] = await Promise.all([
    adapter.decide(POINT, STATE),
    adapter.decide(POINT, STATE),
  ]);

  assert.equal(transport.calls.length, 1, "single-flight must dedupe the in-flight call");
  assert.equal(left.applied, true);
  assert.equal(right.applied, true);
  assert.equal(adapter.stats().consulted, 1);
  assert.equal(adapter.stats().cacheHits, 1);
});

test("a non-cooperative transport still returns the baseline within the adapter deadline", async () => {
  let calls = 0;
  const transport = {
    providerId: "stuck",
    send: () => {
      calls += 1;
      return new Promise(() => {}); // never settles and ignores any abort signal
    },
  };
  const adapter = createDecisionAdapter({
    mode: "live",
    transport,
    deadlineMs: 20,
  });

  const startedAt = Date.now();
  const result = await adapter.decide(POINT, STATE);
  const elapsed = Date.now() - startedAt;

  assert.equal(calls, 1);
  assertBaseline(result);
  assert.ok(elapsed < 1000, `deadline should bound latency, observed ${elapsed}ms`);
  assert.equal(adapter.stats().failures[0].class, "timeout");
});

test("a cost breach fails open to the baseline", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-scan", confidence: 0.9, usage: { cost: 5 } } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport, maxCost: 1 });

  const result = await adapter.decide(POINT, STATE);

  assert.equal(transport.calls.length, 1);
  assertBaseline(result);
  assert.equal(adapter.stats().failures[0].class, "unmapped");
});

test("a result without usage.cost is not treated as a cost breach", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-scan", confidence: 0.9, usage: { inputTokens: 3 } } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport, maxCost: 1 });

  const result = await adapter.decide(POINT, STATE);
  assert.equal(result.applied, true);
  assert.equal(result.answer, "csm-scan");
});

test("a state-size breach fails open without calling the transport", async () => {
  const transport = fakeTransport();
  const adapter = createDecisionAdapter({ mode: "live", transport, maxStateBytes: 64 });
  const oversized = { request: "x".repeat(4096) };

  const result = await adapter.decide(POINT, oversized);

  assert.equal(transport.calls.length, 0);
  assertBaseline(result, POINT, oversized);
  assert.equal(adapter.stats().failures[0].class, "payload_too_large");
});

test("a Jev answer that disagrees with the deterministic baseline is discarded", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-ddd", confidence: 0.9, usage: {} } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport });
  const state = { ...STATE, baselineAnswer: "csm-scan" };

  const result = await adapter.decide(POINT, state);

  assert.equal(result.answer, null);
  assert.equal(result.applied, false);
  assert.equal(result.source, "deterministic-baseline");
  assert.equal(result.baselineAgreement, false);
  assert.equal(result.advice.answer, "csm-ddd");
});

test("a Jev answer that agrees with the deterministic baseline may apply", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-scan", confidence: 0.9, usage: {} } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport });
  const state = { ...STATE, baselineAnswer: "csm-scan" };

  const result = await adapter.decide(POINT, state);

  assert.equal(result.applied, true);
  assert.equal(result.answer, "csm-scan");
  assert.equal(result.baselineAgreement, true);
  assert.equal(result.source, "decision-adapter");
});
