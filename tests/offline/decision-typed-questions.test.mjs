"use strict";

// T006: the adapter's batched typed-question path. One transport call carries a
// `questions` record for several advisory points; each returned answer maps back
// to its point. The path is advisory-only (never applies), fail-open, and
// honours per-point call caps.

import assert from "node:assert/strict";
import test from "node:test";

import { createDecisionAdapter } from "../../csm-orchestrate/lib/decision-adapter/index.mjs";

const POINTS = ["review-challenger-verdict", "deep-research-challenger-verdict"];

function answerTransport(decisions) {
  const calls = [];
  return {
    providerId: "fake",
    providerModel: "type/jev-test",
    calls,
    send: async (input) => {
      calls.push(input);
      return { ok: true, decision: { answers: decisions, usage: { inputTokens: 7 } } };
    },
  };
}

test("decideBatch sends one record for N points and maps each answer back", async () => {
  const transport = answerTransport({
    "review-challenger-verdict": { type: "choice", answer: "downgrade", confidence: 0.4 },
    "deep-research-challenger-verdict": { type: "choice", answer: "uphold", confidence: 0.8 },
  });
  const adapter = createDecisionAdapter({ mode: "live", transport, env: {}, runId: "run-1" });
  const result = await adapter.decideBatch(POINTS, { claim: "x" });

  assert.equal(transport.calls.length, 1, "one batched request serves all points");
  const sent = transport.calls[0];
  assert.ok(!Array.isArray(sent.questions));
  assert.deepEqual(Object.keys(sent.questions).toSorted(), [...POINTS].toSorted());
  assert.equal(result["review-challenger-verdict"].answer, "downgrade");
  assert.equal(result["deep-research-challenger-verdict"].answer, "uphold");
  assert.equal(result["review-challenger-verdict"].applied, undefined, "advisory never applies");
  assert.equal(adapter.stats().applied, 0);
});

test("decideBatch is fail-open: a transport failure yields all-null advice", async () => {
  let calls = 0;
  const transport = {
    providerId: "fake",
    send: async () => {
      calls += 1;
      return { ok: false, failure: { class: "timeout", retryable: true } };
    },
  };
  const adapter = createDecisionAdapter({ mode: "live", transport, env: {}, runId: "run-2" });
  const result = await adapter.decideBatch(POINTS, {});
  assert.equal(calls, 1);
  assert.equal(result["review-challenger-verdict"], null);
  assert.equal(result["deep-research-challenger-verdict"], null);
  assert.equal(adapter.stats().failures.length, POINTS.length);
});

test("decideBatch honours the per-point call cap", async () => {
  const transport = answerTransport({
    "review-challenger-verdict": { type: "choice", answer: "agree", confidence: 0.9 },
  });
  const adapter = createDecisionAdapter({
    mode: "live",
    transport,
    env: {},
    runId: "run-3",
    maxCallsPerPoint: 1,
  });
  await adapter.decideBatch(["review-challenger-verdict"], {});
  const second = await adapter.decideBatch(["review-challenger-verdict"], {});
  assert.equal(transport.calls.length, 1, "the second batch issues no new call");
  assert.equal(second["review-challenger-verdict"], null);
});

test("decideBatch returns null for an unknown point and makes no call for it", async () => {
  const transport = answerTransport({});
  const adapter = createDecisionAdapter({ mode: "live", transport, env: {}, runId: "run-4" });
  const result = await adapter.decideBatch(["not-a-real-point"], {});
  assert.equal(result["not-a-real-point"], null);
  assert.equal(transport.calls.length, 0);
});

test("decideBatch with an off adapter makes no call", async () => {
  const transport = answerTransport({});
  const adapter = createDecisionAdapter({ mode: "off", transport, env: {} });
  const result = await adapter.decideBatch(POINTS, {});
  assert.equal(transport.calls.length, 0);
  assert.equal(result["review-challenger-verdict"], null);
});
