"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import openrouter, {
  OPENROUTER_API_KEY_ENV,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_ENDPOINT,
} from "../../csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs";
import { createDecisionTransport } from "../../csm-orchestrate/lib/decision-adapter/transport.mjs";
import { buildQuestions } from "../../csm-orchestrate/lib/decision-adapter/question-protocol.mjs";

const KEY = "sk-openrouter-test-key";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(responseOrError, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    if (responseOrError instanceof Error) throw responseOrError;
    return typeof responseOrError === "function" ? responseOrError() : responseOrError;
  };
}

const QUESTIONS = {
  q1: { type: "choice", instructions: "pick", criteria: { a: "A", b: "B" } },
  q2: { type: "noul", instructions: "yes or no", criteria: { true: "yes", false: "no" } },
};

test("buildRequest posts the endpoint with the env key, default model, and a questions RECORD", () => {
  const state = { request: "route this", candidates: ["csm-scan", "csm-ddd"] };
  const request = openrouter.buildRequest({
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    state,
    questions: QUESTIONS,
  });

  assert.equal(request.url, OPENROUTER_ENDPOINT);
  assert.equal(request.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(request.body, { model: OPENROUTER_DEFAULT_MODEL, state, questions: QUESTIONS });
  assert.equal(request.body.model, "typesafe/jev-1.13");
  assert.ok(!Array.isArray(request.body.questions), "live API requires a record, not an array");
});

test("buildRequest degrades an array-shaped questions value to an empty record", () => {
  const request = openrouter.buildRequest({
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    state: {},
    questions: ["q1"],
  });
  assert.deepEqual(request.body.questions, {});
});

test("buildQuestions produces the record shape openrouter forwards unchanged", () => {
  const questions = buildQuestions([
    { id: "review-challenger-verdict", type: "choice", criteria: ["agree", "retract"] },
  ]);
  const request = openrouter.buildRequest({
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    state: "claim text",
    questions,
  });
  assert.deepEqual(request.body.questions, questions);
});

test("buildRequest honours an explicit model override and defaults state/questions", () => {
  const request = openrouter.buildRequest({
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    model: "typesafe/jev-1.13-preview",
  });
  assert.equal(request.body.model, "typesafe/jev-1.13-preview");
  assert.equal(request.body.state, null);
  assert.deepEqual(request.body.questions, {});
});

test("a missing key is a fail-open transport failure, never a throw", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: openrouter,
    env: {},
    fetchImpl: recordingFetch(jsonResponse({}), calls),
  });
  const result = await transport.send({ state: {}, questions: {} });
  assert.equal(result.ok, false);
  assert.equal(result.failure.class, "authentication");
  assert.equal(result.failure.retryable, false);
  assert.equal(calls.length, 0, "no request is attempted without a key");
  assert.ok(!JSON.stringify(result).includes(OPENROUTER_API_KEY_ENV));
});

test("parseResponse reads the answers envelope into a typed choice answer", () => {
  const parsed = openrouter.parseResponse({
    model: "typesafe/jev-1.13-20260917",
    answers: {
      q: {
        type: "choice",
        choice: "csm-scan",
        probabilities: { "csm-scan": 0.75 },
        confidence: 0.75,
      },
    },
    usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.0002 },
  });
  assert.equal(parsed.answer, "csm-scan");
  assert.equal(parsed.confidence, 0.75);
  assert.equal(parsed.model, "typesafe/jev-1.13-20260917");
  assert.deepEqual(parsed.usage, { inputTokens: 12, outputTokens: 4, cost: 0.0002 });
  assert.equal(parsed.answers.q.answer, "csm-scan");
  assert.deepEqual(parsed.answers.q.probabilities, { "csm-scan": 0.75 });
});

test("parseResponse reads score and noul answers plus camelCase usage", () => {
  const score = openrouter.parseResponse({
    answers: { q: { type: "score", score: 0.42, legend: { 0: "low", 1: "high" } } },
  });
  assert.equal(score.answer, 0.42);
  assert.deepEqual(score.answers.q.legend, { 0: "low", 1: "high" });
  const noul = openrouter.parseResponse({
    answers: { q: { type: "noul", noul: 0.9 } },
    usage: { inputTokens: 1, outputTokens: 2 },
  });
  assert.equal(noul.answer, 0.9);
  assert.deepEqual(noul.usage, { inputTokens: 1, outputTokens: 2 });
});

test("parseResponse tolerates missing and malformed envelopes", () => {
  const empty = { answer: null, confidence: null, answers: {}, usage: {}, model: null };
  assert.deepEqual(openrouter.parseResponse(null), empty);
  assert.deepEqual(openrouter.parseResponse(undefined), empty);
  assert.deepEqual(openrouter.parseResponse("not json"), empty);
  assert.deepEqual(
    openrouter.parseResponse({ confidence: "high", usage: { cost: "free" } }),
    empty,
  );
});

test("classifyError maps every status in the fail-open taxonomy", () => {
  const expected = {
    401: "authentication",
    402: "payment_required",
    403: "permission_denied",
    404: "not_found",
    413: "payload_too_large",
    429: "rate_limit_exceeded",
    500: "server",
    502: "provider_unavailable",
    503: "provider_overloaded",
    524: "timeout",
    529: "overloaded",
  };
  for (const [status, className] of Object.entries(expected)) {
    assert.equal(openrouter.classifyError(Number(status)).class, className, status);
  }
  assert.equal(openrouter.classifyError(418).class, "unmapped");
  assert.equal(openrouter.classifyError(400).class, "unmapped");
  assert.equal(openrouter.classifyError(429).retryable, true);
  assert.equal(openrouter.classifyError(401).retryable, false);
});

test("transport sends one authenticated request with a record body and normalizes the response", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: openrouter,
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    fetchImpl: recordingFetch(
      jsonResponse({
        answers: { q: { type: "choice", choice: "csm-ddd", confidence: 0.6 } },
        usage: { prompt_tokens: 5 },
      }),
      calls,
    ),
  });
  const result = await transport.send({ state: { a: 1 }, questions: { q: QUESTIONS.q1 } });

  assert.equal(result.ok, true);
  assert.equal(result.decision.answer, "csm-ddd");
  assert.equal(result.decision.confidence, 0.6);
  assert.deepEqual(result.decision.usage, { inputTokens: 5 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body).questions, { q: QUESTIONS.q1 });
});

test("transport fails open on a classified HTTP error", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: openrouter,
    env: { [OPENROUTER_API_KEY_ENV]: KEY },
    fetchImpl: recordingFetch(jsonResponse({ error: "slow down" }, 429), calls),
  });
  const result = await transport.send({ state: {}, questions: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failure, { class: "rate_limit_exceeded", retryable: true });
});

test("transport fails open on network, timeout, and oversized bodies", async () => {
  const keyed = { [OPENROUTER_API_KEY_ENV]: KEY };
  const network = createDecisionTransport({
    provider: openrouter,
    env: keyed,
    fetchImpl: recordingFetch(new Error("ECONNREFUSED"), []),
  });
  assert.deepEqual((await network.send({})).failure, { class: "network", retryable: true });

  const timeout = createDecisionTransport({
    provider: openrouter,
    env: keyed,
    fetchImpl: async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });
  assert.deepEqual((await timeout.send({})).failure, { class: "timeout", retryable: true });

  const oversized = createDecisionTransport({
    provider: openrouter,
    env: keyed,
    maxBodyBytes: 8,
    fetchImpl: recordingFetch(jsonResponse({}), []),
  });
  assert.deepEqual((await oversized.send({ state: "far too large" })).failure, {
    class: "payload_too_large",
    retryable: false,
  });
});
