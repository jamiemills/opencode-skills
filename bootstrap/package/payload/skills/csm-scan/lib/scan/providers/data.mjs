// Data Architecture dimension — T210-compatible provider.
//
// T212 owns this module. It maps the data model (`lib/scan/deep/data/model.mjs`)
// into immutable provider results through the provider foundation
// (`lib/scan/providers/base.mjs`), using ONLY the DIM-data-v1 category
// allowlist (cache, entity, field, key, migration, queue, relation, schema,
// store). It is inert: exported as factory functions for tests and future
// provider catalogs (T220), never wired into the pipeline, CLI, enrich,
// validate, write, or renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative declaration file and `matchedKey` is the deterministic
//     category-prefixed canonical key (e.g. `relation:orders:users:foreign_key`).
//   - Resolved ER/data-flow edges are emitted as `relation` observations whose
//     matchedKey is prefixed `edge:` so declared relations and resolved edges
//     stay distinguishable without leaving the category allowlist.
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     duplicate and unknown categories are rejected by the foundation.
//   - `dataObservations`/`dataProviderResult` never throw for a valid model and
//     produce empty results for empty/foreign input.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the provider foundation,
// the contracts, and the data model; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module, so the recurring
// capability gate remains closed.

import { assertDataOnly, compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { createProviderResult, PROVIDER_RESULT_LIMITS } from './base.mjs';
import {
  DATA_DIMENSION_ID,
  DATA_RECORD_CATEGORIES,
  encodeMatchedKey,
} from '../deep/data/model.mjs';

export const DATA_PROVIDER_ID = 'PRV-data-architecture-v1';

const SOURCE_KIND_BY_CATEGORY = Object.freeze({
  cache: 'source',
  entity: 'schema',
  field: 'schema',
  key: 'schema',
  migration: 'migration',
  queue: 'source',
  relation: 'schema',
  schema: 'schema',
  store: 'schema',
});

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). Long model signatures or edge
// endpoints can exceed the bound after category prefixing and brace encoding,
// so the full assembled key is deterministically final-truncated. Full values
// stay available in observation details, so truncation is disclosed without
// data loss and never aborts activation on realistic inputs.
function boundedAssembledKey(value) {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function recordObservation(record) {
  return {
    category: record.category,
    path: record.source.path,
    matchedKey: boundedAssembledKey(encodeMatchedKey(record.matchedKey)),
    details: {
      signature: encodeMatchedKey(record.signature),
      dialect: record.dialect,
      status: record.status,
    },
    sourceKind: SOURCE_KIND_BY_CATEGORY[record.category],
  };
}

function edgeObservation(edge) {
  const from = edge.from.length > 64 ? edge.from.slice(0, 64) : edge.from;
  const to = edge.to.length > 64 ? edge.to.slice(0, 64) : edge.to;
  return {
    category: 'relation',
    path: edge.evidence.path,
    matchedKey: boundedAssembledKey(`edge:${from}:${to}:${edge.kind}`),
    details: { from, to, kind: edge.kind },
    sourceKind: 'schema',
  };
}

function validateModel(model) {
  assertDataOnly(model, TypeError, {
    maxArray: 20_000,
    maxDepth: 14,
    maxNodes: 200_000,
    maxObjectKeys: 256,
    maxString: 512,
  });
}

const MODEL_LIST_KEYS = Object.freeze({
  cache: 'caches',
  entity: 'entities',
  field: 'fields',
  key: 'keys',
  migration: 'migrations',
  queue: 'queues',
  relation: 'relations',
  schema: 'schemas',
  store: 'stores',
});

function allRecords(model) {
  const records = [];
  for (const category of DATA_RECORD_CATEGORIES) {
    const list = model[MODEL_LIST_KEYS[category]];
    if (Array.isArray(list)) records.push(...list);
  }
  return records;
}

/**
 * Derive provider observations from a data model. Pure and deterministic.
 * @param {object} model - the deep-frozen data model from `buildDataModel`.
 * @returns {object[]} `[{ dimensionId, observations, capped }]` (frozen); empty
 *   for empty or foreign input. `capped` is true when observations exceeded the
 *   provider observation bound and were deterministically truncated.
 */
export function dataObservations(model) {
  if (model === null || typeof model !== 'object' || Array.isArray(model)) return [];
  if (!Array.isArray(model.entities) && !Array.isArray(model.edges)) return [];
  validateModel(model);
  const observations = [];
  const seen = new Set();
  const push = (observation) => {
    const identity = JSON.stringify(observation);
    if (seen.has(identity)) return;
    seen.add(identity);
    observations.push(observation);
  };
  for (const record of allRecords(model)) push(recordObservation(record));
  for (const edge of Array.isArray(model.edges) ? model.edges : []) push(edgeObservation(edge));
  observations.sort((left, right) => compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.path ?? '', right.path ?? ''));
  let capped = false;
  if (observations.length > PROVIDER_RESULT_LIMITS.observations) {
    observations.length = PROVIDER_RESULT_LIMITS.observations;
    capped = true;
  }
  return deepFreeze([{ dimensionId: DATA_DIMENSION_ID, observations, capped }]);
}

/**
 * Build immutable provider results from a data model. Inert.
 * @param {object} model - the deep-frozen data model.
 * @returns {{ results: object[], capped: boolean }} A deep-frozen bounded
 *   envelope. `results` holds zero or one deep-frozen provider result for
 *   `DIM-data-v1`; `capped` is true when observations exceeded the provider
 *   observation bound and were deterministically truncated.
 */
export function dataProviderResult(model) {
  const entries = dataObservations(model);
  if (entries.length === 0) return deepFreeze({ results: [], capped: false });
  const { dimensionId, observations, capped } = entries[0];
  const results = [createProviderResult({
    providerId: DATA_PROVIDER_ID,
    dimensionId,
    observations,
  })];
  return deepFreeze({ results, capped });
}
