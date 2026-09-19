"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import vercel, {
  VERCEL_API_KEY_ENV,
  VERCEL_DEFAULT_MODEL,
  VERCEL_ENDPOINT,
} from "../../csm-orchestrate/lib/decision-adapter/providers/vercel.mjs";
import {
  createProviderRegistry,
  PROVIDER_SELECTION_ENV,
} from "../../csm-orchestrate/lib/decision-adapter/providers/index.mjs";
import { createDecisionTransport } from "../../csm-orchestrate/lib/decision-adapter/transport.mjs";

const KEY = "gw-vercel-test-key";

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

test("buildRequest posts the Vercel AI Gateway evaluate endpoint with the env key and model", () => {
  const state = { request: "route this", candidates: ["csm-scan", "csm-ddd"] };
  const questions = ["q1", "q2"];
  const request = vercel.buildRequest({
    env: { [VERCEL_API_KEY_ENV]: KEY },
    state,
    questions,
  });

  assert.equal(request.url, VERCEL_ENDPOINT);
  assert.equal(request.url, "https://ai-gateway.vercel.sh/v1/evaluate");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(request.body, {
    model: VERCEL_DEFAULT_MODEL,
    state,
    questions,
  });
  assert.equal(request.body.model, "typesafe-ai/jev");
  assert.notEqual(vercel.defaultModel, "typesafe/jev-1.13");
});

test("buildRequest honours an explicit model override and defaults state/questions", () => {
  const request = vercel.buildRequest({
    env: { [VERCEL_API_KEY_ENV]: KEY },
    model: "typesafe-ai/jev-preview",
  });
  assert.equal(request.body.model, "typesafe-ai/jev-preview");
  assert.equal(request.body.state, null);
  assert.deepEqual(request.body.questions, []);
});

test("a missing key is a fail-open transport failure, never a throw", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: vercel,
    env: {},
    fetchImpl: recordingFetch(jsonResponse({}), calls),
  });
  const result = await transport.send({ state: {}, questions: [] });
  assert.equal(result.ok, false);
  assert.equal(result.failure.class, "authentication");
  assert.equal(result.failure.retryable, false);
  assert.equal(calls.length, 0, "no request is attempted without a key");
  assert.ok(!JSON.stringify(result).includes(VERCEL_API_KEY_ENV));
});

test("parseResponse normalizes an answer, confidence, and token usage without cost", () => {
  assert.deepEqual(
    vercel.parseResponse({
      choice: "csm-scan",
      confidence: 0.75,
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0.0002 },
    }),
    {
      answer: "csm-scan",
      confidence: 0.75,
      usage: { inputTokens: 12, outputTokens: 4 },
    },
  );
  assert.equal(
    Object.hasOwn(vercel.parseResponse({ usage: { input_tokens: 1 } }).usage, "cost"),
    false,
    "Vercel reports tokens but not cost; cost is omitted",
  );
});

test("parseResponse reads score and noul answers plus camelCase usage", () => {
  assert.deepEqual(vercel.parseResponse({ score: 0.42 }), {
    answer: 0.42,
    confidence: null,
    usage: {},
  });
  assert.deepEqual(
    vercel.parseResponse({ noul: true, usage: { inputTokens: 1, outputTokens: 2 } }),
    {
      answer: true,
      confidence: null,
      usage: { inputTokens: 1, outputTokens: 2 },
    },
  );
});

test("parseResponse tolerates missing and malformed envelopes", () => {
  const empty = { answer: null, confidence: null, usage: {} };
  assert.deepEqual(vercel.parseResponse(null), empty);
  assert.deepEqual(vercel.parseResponse(undefined), empty);
  assert.deepEqual(vercel.parseResponse("not json"), empty);
  assert.deepEqual(vercel.parseResponse({ confidence: "high", usage: { cost: "free" } }), empty);
});

test("classifyError maps every status in the fail-open taxonomy", () => {
  const expected = {
    400: "invalid_request",
    401: "authentication",
    403: "permission_denied",
    404: "not_found",
    413: "payload_too_large",
    429: "rate_limit_exceeded",
    500: "server",
    502: "provider_unavailable",
    503: "provider_overloaded",
  };
  for (const [status, className] of Object.entries(expected)) {
    assert.equal(vercel.classifyError(Number(status)).class, className, status);
  }
  assert.equal(vercel.classifyError(418).class, "unmapped");
  assert.equal(vercel.classifyError(408).class, "unmapped");
  assert.equal(vercel.classifyError(418).retryable, false);
  assert.equal(vercel.classifyError(429).retryable, true);
  assert.equal(vercel.classifyError(500).retryable, true);
  assert.equal(vercel.classifyError(400).retryable, false);
  assert.equal(vercel.classifyError(401).retryable, false);
});

test("classifyError accepts the typed error envelope without needing it", () => {
  const envelope = {
    error: { message: "bad input", type: "invalid_request", param: null, code: "bad" },
  };
  assert.deepEqual(vercel.classifyError(400, envelope), {
    class: "invalid_request",
    retryable: false,
  });
  assert.deepEqual(vercel.classifyError(503, envelope), {
    class: "provider_overloaded",
    retryable: true,
  });
});

test("transport sends one authenticated request and normalizes the response", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: vercel,
    env: { [VERCEL_API_KEY_ENV]: KEY },
    fetchImpl: recordingFetch(
      jsonResponse({ choice: "csm-ddd", confidence: 0.6, usage: { prompt_tokens: 5 } }),
      calls,
    ),
  });
  const result = await transport.send({ state: { a: 1 }, questions: ["q"] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.decision, {
    answer: "csm-ddd",
    confidence: 0.6,
    usage: { inputTokens: 5 },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, VERCEL_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body).questions, ["q"]);
});

test("transport fails open on a classified HTTP error", async () => {
  const calls = [];
  const transport = createDecisionTransport({
    provider: vercel,
    env: { [VERCEL_API_KEY_ENV]: KEY },
    fetchImpl: recordingFetch(
      jsonResponse(
        { error: { message: "slow down", type: "rate_limit", param: null, code: "429" } },
        429,
      ),
      calls,
    ),
  });
  const result = await transport.send({ state: {}, questions: [] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failure, { class: "rate_limit_exceeded", retryable: true });
});

test("CSM_DECISION_PROVIDER=vercel resolves this descriptor through the real registry", async () => {
  const registry = await createProviderRegistry({
    env: { [PROVIDER_SELECTION_ENV]: "vercel" },
  });

  assert.equal(registry.requestedId, "vercel");
  assert.equal(registry.unresolved, false);
  assert.ok(registry.ids().includes("vercel"));

  const descriptor = registry.resolve("vercel");
  assert.equal(descriptor.id, "vercel");
  assert.equal(descriptor.endpoint, VERCEL_ENDPOINT);
  assert.equal(descriptor.apiKeyEnv, "AI_GATEWAY_API_KEY");
  assert.equal(descriptor.defaultModel, "typesafe-ai/jev");

  const selection = registry.select();
  assert.equal(selection.unresolved, false);
  assert.equal(selection.id, "vercel");
  assert.equal(selection.descriptor, descriptor);
  assert.equal(selection.descriptor.buildRequest, vercel.buildRequest);
});
