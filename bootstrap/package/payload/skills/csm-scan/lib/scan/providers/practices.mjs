// Development Practices dimension — T004 provider adapter.
//
// T004 owns this module. It maps the practices model
// (`lib/scan/deep/practices/model.mjs`) into immutable provider results
// through the provider foundation (`lib/scan/providers/base.mjs`), using only
// the DIM-practices-v1 category allowlist (methodology, enforcement,
// automation, ritual, quality_gate, agent_workflow, style_guide). It is
// inert: exported as factory functions for tests and the analysis provider
// catalog (T004), never wired into the pipeline, CLI, enrich, validate, write,
// or renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative declaration file (or null for aggregate records) and
//     `matchedKey` is a deterministic category-prefixed key with all
//     non-token characters percent-encoded. Keys stay within the T210
//     128-character foundation bound: an over-long link or tool label is
//     disambiguated by a stable short hash instead of invalidating the whole
//     provider result.
//   - Observation details carry only privacy-safe structured facts (counts,
//     types and repo-relative paths); raw KV values and source excerpts are
//     never copied into observations.
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     duplicate and unknown categories are rejected by the foundation.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only the provider foundation
// and the evidence contract; it never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import { assertDataOnly, compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { encodeMatchedKey } from '../deep/practices/model.mjs';
import { createProviderResult } from './base.mjs';

export const PRACTICES_PROVIDER_ID = 'PRV-analysis-practices-v1';

export const PRACTICES_DIMENSION_ID = 'DIM-practices-v1';

const PRACTICES_STATUSES = Object.freeze(['observed', 'inferred', 'unverified']);

function sourceKindFor(category) {
  if (category === 'methodology') return 'source';
  if (category === 'enforcement') return 'workflow';
  if (category === 'automation') return 'config';
  if (category === 'ritual') return 'documentation';
  if (category === 'quality_gate') return 'config';
  if (category === 'agent_workflow') return 'documentation';
  return 'config';
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundedMatchedKey(rawKey, prefix) {
  if (rawKey.length > 96) return encodeMatchedKey(`${prefix}:${stableHash(rawKey)}`);
  const encoded = encodeMatchedKey(rawKey);
  if (encoded.length <= 128) return encoded;
  return encodeMatchedKey(`${prefix}:${stableHash(rawKey)}`);
}

function stringList(value) {
  if (!Array.isArray(value)) return null;
  const kept = value.filter((item) => typeof item === 'string').toSorted(compareAscii);
  return kept.length > 0 ? kept : null;
}

function entryObservation(entry) {
  const details = {};
  if (PRACTICES_STATUSES.includes(entry.status)) details.status = entry.status;
  if (Number.isSafeInteger(entry.count)) details.count = entry.count;
  const kinds = stringList(entry.kinds);
  if (kinds !== null) details.kinds = kinds;
  const paths = stringList(entry.paths);
  if (paths !== null) details.paths = paths;
  return {
    category: entry.category,
    path: entry.path,
    matchedKey: boundedMatchedKey(entry.matchedKey, entry.category),
    details,
    sourceKind: sourceKindFor(entry.category),
  };
}

function validateModel(model) {
  assertDataOnly(model, TypeError, {
    maxArray: 4096,
    maxDepth: 12,
    maxNodes: 16_384,
    maxObjectKeys: 256,
    maxString: 2048,
  });
}

/**
 * Derive provider observations from a practices model. Pure and deterministic.
 * @param {object} model - the deep-frozen practices model from
 *   `buildPracticesModel`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   empty or foreign input.
 */
export function practicesObservations(model) {
  if (model === null || typeof model !== 'object' || !Array.isArray(model.entries)) return [];
  validateModel(model);
  const observations = [];
  for (const entry of model.entries) observations.push(entryObservation(entry));

  observations.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.path ?? '', right.path ?? ''));

  const unique = [];
  const seen = new Set();
  for (const observation of observations) {
    const key = JSON.stringify(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(observation);
  }
  return deepFreeze([{ dimensionId: PRACTICES_DIMENSION_ID, observations: unique }]);
}

/**
 * Build immutable provider results from a practices model. Inert.
 * @param {object} model - the deep-frozen practices model.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function practicesProviderResult(model) {
  return practicesObservations(model).map(({ dimensionId, observations }) => (
    createProviderResult({ providerId: PRACTICES_PROVIDER_ID, dimensionId, observations })
  ));
}
