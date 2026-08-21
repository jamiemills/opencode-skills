// API Surface dimension — T210-compatible provider.
//
// T211 owns this module. It maps the API model (`lib/scan/deep/api/model.mjs`)
// into immutable provider results through the provider foundation
// (`lib/scan/providers/base.mjs`), using ONLY the DIM-api-v1 category
// allowlist (cli_command, contract, event, public_export, route, rpc). It is
// inert: exported as factory functions for tests and future provider catalogs
// (T218-T220), never wired into the pipeline, CLI, enrich, validate, write, or
// renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative declaration file and `matchedKey` is the deterministic
//     category-prefixed canonical key (braces encoded for the provider token
//     pattern, e.g. `route:GET:/users/%7Bid%7D`).
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     duplicate and unknown categories are rejected by the foundation.
//   - Model validation bounds align with the model's legal caps and always
//     surface typed errors (`ApiProviderError`) rather than a bare TypeError;
//     models beyond the provider foundation's bounded-observation cap throw a
//     typed `ProviderResultError`. `apiObservations` never throws for a valid
//     model and both functions produce empty results for empty/foreign input.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the provider foundation,
// the contracts, and the API model; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module, so the recurring
// capability gate remains closed.

import { assertDataOnly, compareAscii, deepFreeze } from "../contracts/evidence.mjs";
import { createProviderResult } from "./base.mjs";
import { API_DIMENSION_ID, API_LIMITS, encodeMatchedKey } from "../deep/api/model.mjs";

export const API_PROVIDER_ID = "PRV-api-surface-v1";

export class ApiProviderError extends TypeError {
  constructor(code, message) {
    super(`Invalid API provider input: ${message}`);
    this.name = "ApiProviderError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApiProviderError(code, message);
}

// Bounds align with the model's legal caps (API_LIMITS.maxRecords operations,
// deep-frozen records), never with a smaller arbitrary cap that a valid model
// could legitimately exceed and that would surface as a bare TypeError.
const PROVIDER_DATA_LIMITS = Object.freeze({
  maxArray: API_LIMITS.maxRecords,
  maxDepth: 12,
  maxNodes: API_LIMITS.maxRecords * 24 + 4096,
  maxObjectKeys: 256,
  maxString: 512,
});

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). A long route/contract signature can
// exceed the bound after category prefixing and brace encoding, so the full
// assembled key is deterministically final-truncated. Full values stay
// available in observation details, so truncation is disclosed without data
// loss and never aborts activation on realistic inputs.
function boundedAssembledKey(value) {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function sourceKindFor(operation) {
  if (operation.category === "contract") return "contract";
  if (operation.category === "public_export" && operation.source.path === "package.json")
    return "manifest";
  if (operation.category === "public_export") return "source";
  return "source";
}

function observationFor(operation) {
  return {
    category: operation.category,
    path: operation.source.path,
    matchedKey: boundedAssembledKey(encodeMatchedKey(operation.matchedKey)),
    details: {
      signature: encodeMatchedKey(operation.signature),
      dialect: operation.dialect,
      status: operation.status,
    },
    sourceKind: sourceKindFor(operation),
  };
}

function validateModel(model) {
  try {
    assertDataOnly(model, ApiProviderError, PROVIDER_DATA_LIMITS);
  } catch (error) {
    if (error instanceof ApiProviderError) throw error;
    fail("INVALID_DATA", "API model must contain plain bounded data");
  }
}

/**
 * Derive provider observations from an API model. Pure and deterministic.
 * @param {object} model - the deep-frozen API model from `buildApiModel`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   empty or foreign input.
 */
export function apiObservations(model) {
  if (model === null || typeof model !== "object" || !Array.isArray(model.operations)) return [];
  validateModel(model);
  const observations = model.operations
    .map(observationFor)
    .toSorted(
      (left, right) =>
        compareAscii(left.matchedKey, right.matchedKey) ||
        compareAscii(left.path ?? "", right.path ?? ""),
    );
  const unique = [];
  const seen = new Set();
  for (const observation of observations) {
    const key = JSON.stringify(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(observation);
  }
  return deepFreeze([{ dimensionId: API_DIMENSION_ID, observations: unique }]);
}

/**
 * Build immutable provider results from an API model. Inert.
 * @param {object} model - the deep-frozen API model.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function apiProviderResult(model) {
  return apiObservations(model).map(({ dimensionId, observations }) =>
    createProviderResult({ providerId: API_PROVIDER_ID, dimensionId, observations }),
  );
}
