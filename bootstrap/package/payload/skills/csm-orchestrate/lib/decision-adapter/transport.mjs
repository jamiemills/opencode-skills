"use strict";

// T008: provider-agnostic decision transport. It composes a provider descriptor
// (buildRequest/parseResponse/classifyError) with one bounded request. The
// fail-open contract is absolute: `send` never throws on a provider, network,
// timeout, or malformed-response error -- it returns `{ ok:false, failure }` so
// the caller reverts to the deterministic harness. No key material is ever
// included in a failure.

export const DEFAULT_DECISION_TIMEOUT_MS = 10_000;
export const DEFAULT_DECISION_MAX_BODY_BYTES = 262_144;

function failure(className, retryable) {
  return Object.freeze({ ok: false, failure: Object.freeze({ class: className, retryable }) });
}

function declaredFailure(error) {
  const declared = error?.failure;
  if (declared !== null && typeof declared === "object" && typeof declared.class === "string")
    return { class: declared.class, retryable: Boolean(declared.retryable) };
  return null;
}

function validateRequest(request) {
  if (request === null || typeof request !== "object")
    throw new TypeError("buildRequest returned no request");
  if (typeof request.url !== "string" || request.url.length === 0)
    throw new TypeError("buildRequest returned no url");
}

async function readBody(response, maxBodyBytes) {
  try {
    if (typeof response?.text === "function") {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > maxBodyBytes) return { tooLarge: true };
      if (text.length === 0) return { json: null };
      try {
        return { json: JSON.parse(text) };
      } catch {
        return { json: null, malformed: true };
      }
    }
    if (typeof response?.json === "function") return { json: await response.json() };
    return { json: null };
  } catch {
    return { json: null, malformed: true };
  }
}

export function createDecisionTransport({
  provider = null,
  env = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
  maxBodyBytes = DEFAULT_DECISION_MAX_BODY_BYTES,
} = {}) {
  async function attempt(input) {
    let request;
    try {
      request = provider.buildRequest({ ...input, env });
      validateRequest(request);
    } catch (error) {
      const declared = declaredFailure(error);
      return declared === null
        ? failure("unmapped", true)
        : failure(declared.class, declared.retryable);
    }

    let serialized;
    try {
      serialized = JSON.stringify(request.body ?? null);
      if (serialized === undefined) throw new TypeError("request body is not serializable");
    } catch {
      return failure("serialization", false);
    }
    if (Buffer.byteLength(serialized, "utf8") > maxBodyBytes)
      return failure("payload_too_large", false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method ?? "POST",
        headers: request.headers,
        body: serialized,
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      return failure(timedOut ? "timeout" : "network", true);
    } finally {
      clearTimeout(timer);
    }

    const read = await readBody(response, maxBodyBytes);
    if (read.tooLarge) return failure("payload_too_large", false);

    if (!response?.ok) {
      let classified;
      try {
        classified = provider.classifyError(response?.status, read.json ?? null);
      } catch {
        return failure("unmapped", true);
      }
      const className = typeof classified?.class === "string" ? classified.class : "unmapped";
      return failure(className, Boolean(classified?.retryable));
    }

    if (read.malformed) return failure("unmapped", false);
    try {
      return Object.freeze({ ok: true, decision: provider.parseResponse(read.json ?? null) });
    } catch (error) {
      const declared = declaredFailure(error);
      return declared === null
        ? failure("unmapped", true)
        : failure(declared.class, declared.retryable);
    }
  }

  // The fail-open boundary: absolutely no provider/network error escapes `send`.
  async function send(input = {}) {
    if (provider === null || typeof provider.buildRequest !== "function")
      return failure("unresolved_provider", false);
    try {
      return await attempt(input);
    } catch {
      return failure("unmapped", true);
    }
  }

  return Object.freeze({
    providerId: provider?.id ?? null,
    // F1: surface the descriptor's real model so the live advice/artifact never
    // fabricates an "unspecified" model. Null when the descriptor declares none.
    providerModel:
      typeof provider?.defaultModel === "string" && provider.defaultModel.length > 0
        ? provider.defaultModel
        : null,
    timeoutMs,
    maxBodyBytes,
    send,
  });
}

export default { createDecisionTransport };
