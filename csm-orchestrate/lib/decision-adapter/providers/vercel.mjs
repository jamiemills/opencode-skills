"use strict";

// T024/T003: the Vercel AI Gateway decision provider descriptor. Like
// openrouter.mjs it is descriptor-only and owns no transport: the transport
// calls buildRequest once, then parseResponse or classifyError. The API key is
// read exclusively from the injected env (provider.apiKeyEnv) and is never
// logged or embedded in a failure. Every classified failure is fail-open -- the
// caller reverts to the deterministic harness.
//
// T003: Vercel consumes the same typed `questions` RECORD and `answers`
// envelope protocol as OpenRouter (supported, not live-verified for now);
// adding or changing a supplier stays a descriptor-only change.

import { firstAnswer, parseAnswers } from "../question-protocol.mjs";
//
// Differences from the OpenRouter descriptor:
//   * The model id differs: this provider uses `typesafe-ai/jev`, whereas the
//     OpenRouter route uses `typesafe/jev-1.13`.
//   * The endpoint is the Vercel AI Gateway *evaluation* modality
//     (`/v1/evaluate`), not the OpenAI-compatible chat endpoints.
//   * Vercel reports token usage but no cost, so `usage.cost` is deliberately
//     omitted from the normalized response (there is no cost to report).
//
// The error envelope is `{ error: { message, type, param, code } }`, but the
// HTTP status is authoritative for classification.

export const VERCEL_ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";
export const VERCEL_API_KEY_ENV = "AI_GATEWAY_API_KEY";
export const VERCEL_DEFAULT_MODEL = "typesafe-ai/jev";

const STATUS_CLASS = Object.freeze({
  400: "invalid_request",
  401: "authentication",
  403: "permission_denied",
  404: "not_found",
  413: "payload_too_large",
  429: "rate_limit_exceeded",
  500: "server",
  502: "provider_unavailable",
  503: "provider_overloaded",
});

const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

function missingApiKeyError(envName) {
  const error = new Error(`missing or empty ${envName}`);
  error.code = "missing-api-key";
  error.failure = Object.freeze({ class: "authentication", retryable: false });
  return error;
}

function buildRequest(input = {}) {
  const env = input.env ?? {};
  const key = env[VERCEL_API_KEY_ENV];
  if (typeof key !== "string" || key.trim().length === 0)
    throw missingApiKeyError(VERCEL_API_KEY_ENV);
  const model =
    typeof input.model === "string" && input.model.length > 0 ? input.model : VERCEL_DEFAULT_MODEL;
  return {
    url: VERCEL_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: {
      model,
      state: input.state ?? null,
      questions:
        input.questions !== null &&
        typeof input.questions === "object" &&
        !Array.isArray(input.questions)
          ? input.questions
          : {},
    },
  };
}

// Vercel reports token counts but not cost; the shared protocol normalizer drops
// a missing cost rather than inventing one.
function parseResponse(json) {
  const source = json !== null && typeof json === "object" ? json : {};
  const parsed = parseAnswers(source);
  const first = firstAnswer(parsed.answers);
  const answer =
    first.answer ?? source.answer ?? source.choice ?? source.score ?? source.noul ?? null;
  const confidence =
    first.confidence ?? (Number.isFinite(source.confidence) ? source.confidence : null);
  return { answer, confidence, answers: parsed.answers, usage: parsed.usage, model: parsed.model };
}

function classifyError(status, body) {
  const mapped = STATUS_CLASS[status];
  if (mapped === undefined) {
    // The status is authoritative; any unmapped status fail-opens as
    // "unmapped". The body (`{ error: { message, type, param, code } }`) is
    // accepted for symmetry with the port but is not needed to map the typed
    // statuses.
    void body;
    return { class: "unmapped", retryable: false };
  }
  return { class: mapped, retryable: RETRYABLE_STATUS.has(status) };
}

export default {
  id: "vercel",
  endpoint: VERCEL_ENDPOINT,
  apiKeyEnv: VERCEL_API_KEY_ENV,
  defaultModel: VERCEL_DEFAULT_MODEL,
  buildRequest,
  parseResponse,
  classifyError,
};
