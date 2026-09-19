"use strict";

// T011: hermetic fail-open matrix for the provider-agnostic decision adapter.
// No network: every provider call is either a fake transport or the real
// transport with a fake fetch. The matrix asserts each failure class reverts to
// the deterministic baseline, the circuit breaker opens after its threshold,
// the kill switches force off, live never applies on failure, and no path ever
// sets PAUSED.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createDecisionAdapter,
  DECISION_ADAPTER_MODES,
  DECISION_FAILURE_CLASSES,
  DECISION_KILL_ENV,
  DECISION_MODE_ENV,
  DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  deterministicDecision,
  isDecisionFailureClass,
  noAdapterDecision,
} from "../../csm-orchestrate/lib/decision-adapter/index.mjs";
import { createDecisionTransport } from "../../csm-orchestrate/lib/decision-adapter/transport.mjs";
import openrouter from "../../csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs";

const POINT = "route-classification"; // non-safety, apply-eligible
const SAFETY_POINT = "critique-severity"; // safety, advisory-only
const STATE = { request: "route this", candidates: ["csm-scan", "csm-ddd"] };

const bytes = (value) => Buffer.from(JSON.stringify(value));
const baseline = (pointId, state = STATE) => deterministicDecision(pointId, state);

// A fake transport: records inputs and returns each queued result in order (or
// the last one forever). `providerId` is surfaced in advice only.
function fakeTransport(
  results = [{ ok: true, decision: { answer: "csm-scan", confidence: 0.5, usage: {} } }],
) {
  const calls = [];
  let index = 0;
  return {
    providerId: "fake",
    calls,
    send: async (input) => {
      calls.push(input);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result;
    },
  };
}

function failureTransport(className, retryable = false) {
  return fakeTransport([{ ok: false, failure: { class: className, retryable } }]);
}

function assertBaseline(result, pointId = POINT, state = STATE) {
  assert.deepEqual(bytes(result), bytes(baseline(pointId, state)));
  assert.equal(result.applied, false);
  assert.equal(result.answer, null);
  assert.equal(result.status, undefined);
  assert.ok(!JSON.stringify(result).includes("PAUSED"));
}

test("the adapter still accepts the original { mode } shape and refuses bad modes", () => {
  assert.deepEqual(DECISION_ADAPTER_MODES, ["off", "shadow", "live"]);
  assert.deepEqual(DECISION_FAILURE_CLASSES, [
    "authentication",
    "payment_required",
    "permission_denied",
    "not_found",
    "payload_too_large",
    "rate_limit_exceeded",
    "server",
    "provider_unavailable",
    "provider_overloaded",
    "timeout",
    "unmapped",
  ]);
  for (const className of DECISION_FAILURE_CLASSES)
    assert.equal(isDecisionFailureClass(className), true);
  assert.equal(isDecisionFailureClass("nope"), false);
  assert.throws(() => createDecisionAdapter({ mode: "apply" }), /unsupported decision mode/);
  assert.doesNotThrow(() => createDecisionAdapter({ mode: "live" }));
});

test("off ignores an injected transport and stays byte-identical to the baseline", async () => {
  const transport = fakeTransport();
  transport.send = async () => {
    throw new Error("off must never call the transport");
  };
  const adapter = createDecisionAdapter({ mode: "off", transport });
  assertBaseline(adapter.decide(POINT, STATE));
  assertBaseline(adapter.shadow(POINT, STATE));
  assert.deepEqual(bytes(adapter.decide(POINT, STATE)), bytes(noAdapterDecision(POINT, STATE)));
  assert.equal(transport.calls.length, 0);
  assert.equal(adapter.applying, false);
});

test("shadow calls the transport but applies nothing and records advice", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-scan", confidence: 0.75, usage: { inputTokens: 3 } } },
  ]);
  const adapter = createDecisionAdapter({ mode: "shadow", transport });
  assert.equal(adapter.applying, false);
  assert.equal(adapter.shadowing, true);

  const result = await adapter.decide(POINT, STATE);
  assert.equal(transport.calls.length, 1);
  assert.equal(result.consulted, true);
  assert.equal(result.applied, false);
  assert.equal(result.answer, null);
  assert.equal(result.advice.answer, "csm-scan");
  assert.equal(result.advice.confidence, 0.75);
  assert.equal(result.advice.providerId, "fake");
  assert.equal(result.failure, null);
  // Baseline fields are preserved.
  const base = baseline(POINT, STATE);
  for (const key of Object.keys(base)) assert.deepEqual(result[key], base[key]);
  assert.ok(!JSON.stringify(result).includes("PAUSED"));
});

test("shadow on the shadow() method also observes without applying", async () => {
  const transport = fakeTransport();
  const adapter = createDecisionAdapter({ mode: "shadow", transport });
  const result = await adapter.shadow(POINT, STATE);
  assert.equal(result.consulted, true);
  assert.equal(result.applied, false);
  assert.equal(result.advice.answer, "csm-scan");
});

test("live applies only for a reversible non-safety point", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "csm-scan", confidence: 0.9, usage: {} } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport });
  assert.equal(adapter.applying, true);

  const result = await adapter.decide(POINT, STATE);
  assert.equal(result.applied, true);
  assert.equal(result.answer, "csm-scan");
  assert.equal(result.routingBand, "apply");
  assert.equal(result.source, "decision-adapter");
  assert.equal(result.advice.answer, "csm-scan");
});

test("live never applies a safety or advisory point", async () => {
  const transport = fakeTransport([
    { ok: true, decision: { answer: "high", confidence: 0.9, usage: {} } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport });
  const result = await adapter.decide(SAFETY_POINT, STATE);
  assert.equal(result.consulted, true);
  assert.equal(result.applied, false);
  assert.equal(result.answer, null);
  assert.equal(result.advice.answer, "high");
  assertBaselineFields(result, SAFETY_POINT);
});

// Baseline fields (keys and values except the added advisory keys) are intact.
function assertBaselineFields(result, pointId) {
  const base = baseline(pointId, STATE);
  for (const key of Object.keys(base)) assert.deepEqual(result[key], base[key]);
}

test("every failure class reverts to the exact deterministic baseline", async () => {
  for (const className of DECISION_FAILURE_CLASSES) {
    const transport = failureTransport(className, true);
    const adapter = createDecisionAdapter({ mode: "live", transport, circuitThreshold: 100 });
    const result = await adapter.decide(POINT, STATE);
    assertBaseline(result);
    assert.equal(transport.calls.length, 1, `${className} should consult the transport once`);
    assert.equal(result.applied, false);
    assert.equal(result.answer, null);
    const log = adapter.stats().failures;
    assert.equal(log.length, 1, `${className} should be recorded`);
    assert.equal(log[0].class, className);
  }
});

test("a transport that throws still fails open without throwing", async () => {
  const transport = fakeTransport();
  transport.send = async () => {
    throw Object.assign(new Error("boom"), {
      failure: { class: "authentication", retryable: false },
    });
  };
  const adapter = createDecisionAdapter({ mode: "live", transport });
  const result = await adapter.decide(POINT, STATE);
  assertBaseline(result);
  assert.equal(adapter.stats().failures[0].class, "authentication");
});

test("shadow failure also reverts to the exact baseline", async () => {
  const transport = failureTransport("rate_limit_exceeded", true);
  const adapter = createDecisionAdapter({ mode: "shadow", transport });
  const result = await adapter.decide(POINT, STATE);
  assertBaseline(result);
  assert.equal(adapter.stats().failures[0].class, "rate_limit_exceeded");
});

test("the run-scoped circuit breaker opens after its threshold and stops calling out", async () => {
  const transport = failureTransport("server", true);
  const adapter = createDecisionAdapter({
    mode: "live",
    transport,
    circuitThreshold: DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  });
  const { threshold } = adapter.stats();
  assert.equal(threshold, DEFAULT_CIRCUIT_FAILURE_THRESHOLD);

  for (let i = 0; i < threshold; i += 1) assertBaseline(await adapter.decide(POINT, STATE));
  assert.equal(transport.calls.length, threshold);

  // Breaker is now open: further calls return the baseline and never go out.
  for (let i = 0; i < 3; i += 1) assertBaseline(await adapter.decide(POINT, STATE));
  assert.equal(transport.calls.length, threshold);
  const stats = adapter.stats();
  assert.equal(stats.circuitOpen, true);
  assert.equal(stats.consulted, threshold);
  assert.equal(stats.failures.length, threshold);
});

test("a success resets the breaker's consecutive-failure streak", async () => {
  const ok = { ok: true, decision: { answer: "csm-scan", confidence: 0.5, usage: {} } };
  const transport = fakeTransport([
    { ok: false, failure: { class: "server", retryable: true } },
    { ok: false, failure: { class: "server", retryable: true } },
    ok,
    { ok: false, failure: { class: "server", retryable: true } },
    { ok: false, failure: { class: "server", retryable: true } },
    { ok: false, failure: { class: "server", retryable: true } },
  ]);
  const adapter = createDecisionAdapter({ mode: "live", transport, circuitThreshold: 3 });

  for (let i = 0; i < 5; i += 1) await adapter.decide(POINT, STATE);
  assert.equal(adapter.stats().circuitOpen, false, "the success should have reset the streak");
  assert.equal(transport.calls.length, 5);

  await adapter.decide(POINT, STATE);
  assert.equal(adapter.stats().circuitOpen, true);
  assert.equal(transport.calls.length, 6);
});

test("an unresolved transport (null or send-less) fails open, never throws, never PAUSED", async () => {
  for (const transport of [null, undefined, {}, { send: "nope" }]) {
    const live = createDecisionAdapter({ mode: "live", transport });
    const shadow = createDecisionAdapter({ mode: "shadow", transport });
    assert.equal(live.transportResolved, false);
    assert.equal(live.applying, false);
    assertBaseline(live.decide(POINT, STATE));
    assertBaseline(shadow.decide(POINT, STATE));
    assertBaseline(await Promise.resolve(shadow.shadow(POINT, STATE)));
    assert.equal(live.stats().consulted, 0);
  }
});

test("the kill switch forces off/baseline regardless of mode", async () => {
  const transport = fakeTransport();

  const kill = createDecisionAdapter({
    mode: "live",
    transport,
    env: { [DECISION_KILL_ENV]: "1" },
  });
  assert.equal(kill.mode, "off");
  assert.equal(kill.applying, false);
  assert.equal(kill.stats().killSwitch, true);
  assertBaseline(kill.decide(POINT, STATE));
  assertBaseline(await Promise.resolve(kill.shadow(POINT, STATE)));
  assert.equal(transport.calls.length, 0);

  const envOff = createDecisionAdapter({
    mode: "live",
    transport,
    env: { [DECISION_MODE_ENV]: "off" },
  });
  assert.equal(envOff.mode, "off");
  assertBaseline(envOff.decide(POINT, STATE));
  assert.equal(transport.calls.length, 0);
});

test("the points allowlist bounds which points may be consulted", async () => {
  const transport = fakeTransport();
  const other = "ready-set-ordering";
  const adapter = createDecisionAdapter({ mode: "live", transport, points: [other] });

  assertBaseline(adapter.decide(POINT, STATE));
  assert.equal(transport.calls.length, 0);

  const allowed = await adapter.decide(other, STATE);
  assert.equal(transport.calls.length, 1);
  assert.equal(allowed.consulted, true);
  assert.equal(allowed.applied, true);
});

test("an unknown point id never consults the transport and stays byte-identical", async () => {
  const transport = fakeTransport();
  const adapter = createDecisionAdapter({ mode: "live", transport });
  const unknown = "no-such-decision-point";
  assertBaseline(adapter.decide(unknown, STATE), unknown);
  assertBaseline(await Promise.resolve(adapter.shadow(unknown, STATE)), unknown);
  assert.equal(transport.calls.length, 0);
});

// End-to-end taxonomy: the real transport + OpenRouter descriptor classify raw
// HTTP statuses, and the adapter reverts on every classified class. The fetch
// is fake, so the test stays hermetic.
test("the real provider classifyError output drives fail-open for every status", async () => {
  const cases = [
    [401, "authentication"],
    [402, "payment_required"],
    [403, "permission_denied"],
    [404, "not_found"],
    [413, "payload_too_large"],
    [429, "rate_limit_exceeded"],
    [500, "server"],
    [502, "provider_unavailable"],
    [503, "provider_overloaded"],
    [524, "timeout"],
    [599, "unmapped"],
  ];
  for (const [status, expected] of cases) {
    let calls = 0;
    const transport = createDecisionTransport({
      provider: openrouter,
      env: { OPENROUTER_ROUTER_KEY: "sk-test" },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status });
      },
    });
    const adapter = createDecisionAdapter({ mode: "live", transport, circuitThreshold: 100 });
    const result = await adapter.decide(POINT, STATE);
    assertBaseline(result);
    assert.equal(calls, 1, `status ${status} should make one request`);
    assert.equal(adapter.stats().failures[0].class, expected, `status ${status}`);
  }
});
