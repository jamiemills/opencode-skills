"use strict";

// T008: the OpenRouter decision provider descriptor. It is descriptor-only and
// owns no transport: the T008 transport calls buildRequest once, then
// parseResponse or classifyError. The API key is read exclusively from the
// injected env (provider.apiKeyEnv) and is never logged or embedded in a
// failure. Every classified failure is fail-open -- the caller reverts to the
// deterministic harness.

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_ROUTER_KEY";
export const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-1.13";

const STATUS_CLASS = Object.freeze({
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
});

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 524, 529]);

function missingApiKeyError(envName) {
  const error = new Error(`missing or empty ${envName}`);
  error.code = "missing-api-key";
  error.failure = Object.freeze({ class: "authentication", retryable: false });
  return error;
}

function buildRequest(input = {}) {
  const env = input.env ?? {};
  const key = env[OPENROUTER_API_KEY_ENV];
  if (typeof key !== "string" || key.trim().length === 0)
    throw missingApiKeyError(OPENROUTER_API_KEY_ENV);
  const model =
    typeof input.model === "string" && input.model.length > 0
      ? input.model
      : OPENROUTER_DEFAULT_MODEL;
  return {
    url: OPENROUTER_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: {
      model,
      state: input.state ?? null,
      questions: input.questions ?? [],
    },
  };
}

function normalizeUsage(usage) {
  const normalized = {};
  if (usage === null || typeof usage !== "object") return normalized;
  const inputTokens = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens;
  const outputTokens = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens;
  const cost = usage.cost ?? usage.total_cost;
  if (Number.isFinite(inputTokens)) normalized.inputTokens = inputTokens;
  if (Number.isFinite(outputTokens)) normalized.outputTokens = outputTokens;
  if (Number.isFinite(cost)) normalized.cost = cost;
  return normalized;
}

function parseResponse(json) {
  const source = json !== null && typeof json === "object" ? json : {};
  const answer = source.answer ?? source.choice ?? source.score ?? source.noul ?? null;
  const confidence = Number.isFinite(source.confidence) ? source.confidence : null;
  return { answer, confidence, usage: normalizeUsage(source.usage) };
}

function classifyError(status, body) {
  const mapped = STATUS_CLASS[status];
  if (mapped === undefined) {
    // The status is authoritative; any unmapped status fail-opens as
    // "unmapped". The body is accepted for symmetry with the port but is not
    // needed to map OpenRouter's typed statuses.
    void body;
    return { class: "unmapped", retryable: false };
  }
  return { class: mapped, retryable: RETRYABLE_STATUS.has(status) };
}

export default {
  id: "openrouter",
  endpoint: OPENROUTER_ENDPOINT,
  apiKeyEnv: OPENROUTER_API_KEY_ENV,
  defaultModel: OPENROUTER_DEFAULT_MODEL,
  buildRequest,
  parseResponse,
  classifyError,
};
