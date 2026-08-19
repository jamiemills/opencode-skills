// Assurance & Supply Chain dimension — T210-compatible provider.
//
// T216 owns this module. It maps the assurance model
// (`lib/scan/deep/assurance/model.mjs`) into immutable provider results
// through the provider foundation (`lib/scan/providers/base.mjs`), using ONLY
// the DIM-assurance-v1 category allowlist (accessibility, attestation,
// configuration, license, lock, manifest, pin, sarif, sbom, source, standard,
// tool_result, vex). It is inert: exported as factory functions for tests and
// future provider catalogs (T218-T220), never wired into the pipeline, CLI,
// enrich, validate, write, or renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative artifact file and `matchedKey` is the deterministic
//     category-prefixed canonical key.
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     duplicate and unknown categories are rejected by the foundation.
//   - `assuranceObservations`/`assuranceProviderResult` never throw for a valid
//     model and produce empty results for empty/foreign input.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the provider foundation,
// the contracts, and the assurance model; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module, so the recurring
// capability gate remains closed.

import { assertDataOnly, compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { createProviderResult } from './base.mjs';
import { ASSURANCE_DIMENSION_ID } from '../deep/assurance/model.mjs';

export const ASSURANCE_PROVIDER_ID = 'PRV-assurance-supply-chain-v1';

const SOURCE_KIND_BY_CATEGORY = Object.freeze({
  accessibility: 'documentation',
  attestation: 'artifact_metadata',
  configuration: 'config',
  license: 'manifest',
  lock: 'lockfile',
  manifest: 'manifest',
  pin: 'lockfile',
  sarif: 'tool_result',
  sbom: 'tool_result',
  source: 'config',
  standard: 'policy',
  tool_result: 'tool_result',
  vex: 'tool_result',
});

function sourceKindFor(record) {
  if (record.category === 'license' && record.details.declared === 'file') return 'documentation';
  if (record.category === 'pin' && record.details.scope === 'manifest') return 'manifest';
  return SOURCE_KIND_BY_CATEGORY[record.category] ?? 'artifact_metadata';
}

function flattenedDetails(record) {
  const details = { status: record.status };
  if (record.category === 'sbom') {
    const projection = record.details.projection ?? {};
    details.format = record.details.format;
    details.specVersion = record.details.specVersion;
    details.componentCount = projection.componentCount ?? 0;
    details.licenses = projection.licenses ?? [];
    details.packageCoordinates = projection.packageCoordinates ?? [];
    return details;
  }
  if (record.category === 'sarif') {
    const projection = record.details.projection ?? {};
    details.version = record.details.version;
    details.runCount = projection.runCount ?? 0;
    details.resultCount = projection.resultCount ?? 0;
    details.tools = projection.tools ?? [];
    details.rules = projection.rules ?? [];
    return details;
  }
  for (const [key, value] of Object.entries(record.details)) details[key] = value;
  return details;
}

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). Long manifest/pin identities can
// exceed the bound after category prefixing and identity encoding, so the full
// assembled key is deterministically final-truncated. Full values stay
// available in observation details, so truncation is disclosed without data
// loss and never aborts activation on realistic inputs.
function boundedAssembledKey(value) {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function observationFor(record) {
  return {
    category: record.category,
    path: record.path,
    matchedKey: boundedAssembledKey(record.matchedKey),
    details: flattenedDetails(record),
    sourceKind: sourceKindFor(record),
  };
}

function validateModel(model) {
  assertDataOnly(model, TypeError, {
    maxArray: 4096,
    maxDepth: 12,
    maxNodes: 16_384,
    maxObjectKeys: 256,
    maxString: 512,
  });
}

/**
 * Derive provider observations from an assurance model. Pure and deterministic.
 * @param {object} model - the deep-frozen assurance model from
 *   `buildAssuranceModel`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   empty or foreign input.
 */
export function assuranceObservations(model) {
  if (model === null || typeof model !== 'object'
      || !Array.isArray(model.manifest) && !Array.isArray(model.pin)) return [];
  validateModel(model);  const observations = [];
  for (const category of [
    'manifest', 'lock', 'pin', 'source', 'license', 'sbom', 'vex', 'sarif',
    'configuration', 'tool_result', 'accessibility', 'attestation', 'standard',
  ]) {
    for (const record of Array.isArray(model[category]) ? model[category] : []) {
      observations.push(observationFor(record));
    }
  }
  observations.sort((left, right) => compareAscii(left.category, right.category)
    || compareAscii(left.matchedKey, right.matchedKey)
    || compareAscii(left.path ?? '', right.path ?? ''));
  const unique = [];
  const seen = new Set();
  for (const observation of observations) {
    const key = JSON.stringify(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(observation);
  }
  return deepFreeze([{ dimensionId: ASSURANCE_DIMENSION_ID, observations: unique }]);
}

/**
 * Build immutable provider results from an assurance model. Inert.
 * @param {object} model - the deep-frozen assurance model.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function assuranceProviderResult(model) {
  return assuranceObservations(model).map(({ dimensionId, observations }) => (
    createProviderResult({ providerId: ASSURANCE_PROVIDER_ID, dimensionId, observations })
  ));
}
