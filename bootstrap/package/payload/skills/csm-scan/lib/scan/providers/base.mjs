// Provider foundation — immutable, deterministic provider results.
//
// T210 owns this module. It is the shared contract for every provider result
// produced by the five built-in descriptor adapters and (later) by plugin and
// generic providers. It is deliberately inert: nothing in the pipeline, CLI,
// enrich, validate, write, or renderer consumes provider results yet; loading
// happens only through exported factory functions used by tests and the
// future provider catalogs (T218-T220).
//
// Guarantees:
//   - Results are deep-frozen data-only records; mutation throws.
//   - Observation categories are validated against the canonical
//     PROVIDER_CATEGORIES / DIMENSION_EVIDENCE_CATEGORIES allowlists (T202).
//   - Duplicate and unknown categories are rejected with typed errors.
//   - Observations are sorted deterministically; identical inputs produce
//     byte-identical results regardless of insertion order.
//   - mergeProviderResults() is deterministic: built-in observations come
//     first, plugin observations are appended, exact duplicates are dropped,
//     and plugin observations never replace built-in findings.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only contracts and never
// touches node:fs / node:child_process / node:process / node:vm / node:module,
// so the recurring capability gate remains closed.

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  EVIDENCE_SOURCE_KINDS,
  normalizeEvidencePath,
} from '../contracts/evidence.mjs';
import { PROVIDER_DIMENSION_IDS } from '../contracts/dimension.mjs';
import { PROVIDER_CATEGORIES } from '../contracts/provider.mjs';

export const PROVIDER_RESULT_LIMITS = deepFreeze({
  detailsNodes: 1024,
  detailsString: 512,
  observations: 2048,
  providerId: 96,
  sourceKind: 32,
});

const OBSERVATION_KEYS = Object.freeze(['category', 'details', 'matchedKey', 'path', 'sourceKind']);
const RESULT_KEYS = Object.freeze(['dimensionId', 'observations', 'providerId']);
const MATCHED_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/;
const PROVIDER_ID_PATTERN = /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;

export class ProviderResultError extends TypeError {
  constructor(code, message) {
    super(`Invalid provider result: ${message}`);
    this.name = 'ProviderResultError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProviderResultError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function providerId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PROVIDER_RESULT_LIMITS.providerId
      || !PROVIDER_ID_PATTERN.test(value)) {
    fail('INVALID_PROVIDER_ID', 'provider id must be a stable versioned ASCII identifier');
  }
  return value;
}

function dimensionId(value) {
  if (typeof value !== 'string' || !PROVIDER_DIMENSION_IDS.includes(value)) {
    fail('UNKNOWN_DIMENSION', 'provider dimension is not allowlisted');
  }
  return value;
}

function matchedKey(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !MATCHED_KEY_PATTERN.test(value)) {
    fail('INVALID_MATCHED_KEY', 'observation matchedKey must be bounded stable ASCII');
  }
  return value;
}

function observationPath(value) {
  if (value === null) return null;
  try {
    return normalizeEvidencePath(value);
  } catch {
    fail('INVALID_PATH', 'observation path is not a normalized repository-relative POSIX path');
  }
}

function sourceKind(value) {
  if (typeof value !== 'string' || value.length > PROVIDER_RESULT_LIMITS.sourceKind
      || !EVIDENCE_SOURCE_KINDS.includes(value)) {
    fail('UNKNOWN_SOURCE_KIND', 'observation sourceKind is not allowlisted');
  }
  return value;
}

function observationDetails(value) {
  if (value === null) return null;
  try {
    assertDataOnly(value, ProviderResultError, {
      maxArray: PROVIDER_RESULT_LIMITS.observations,
      maxDepth: 8,
      maxNodes: PROVIDER_RESULT_LIMITS.detailsNodes,
      maxObjectKeys: 128,
      maxString: PROVIDER_RESULT_LIMITS.detailsString,
    });
  } catch (error) {
    if (error instanceof ProviderResultError) throw error;
    fail('INVALID_DETAILS', 'observation details must contain plain bounded data');
  }
  return value;
}

function normalizeObservation(observation, dimensionIdForResult) {
  if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) {
    fail('INVALID_TYPE', 'provider observation must be an object');
  }
  exactKeys(observation, OBSERVATION_KEYS, 'provider observation');
  const category = observation.category;
  if (typeof category !== 'string' || !PROVIDER_CATEGORIES[dimensionIdForResult]?.includes(category)) {
    fail('UNKNOWN_CATEGORY', 'provider observation category is not allowlisted for the dimension');
  }
  return {
    category,
    details: observationDetails(observation.details),
    matchedKey: matchedKey(observation.matchedKey),
    path: observationPath(observation.path),
    sourceKind: sourceKind(observation.sourceKind),
  };
}

function observationIdentity(observation) {
  return JSON.stringify({
    category: observation.category,
    path: observation.path ?? null,
    matchedKey: observation.matchedKey,
    sourceKind: observation.sourceKind,
    details: observation.details,
  });
}

function canonicalObservations(dimensionIdForResult, observations) {
  const seen = new Set();
  const result = observations.map((observation) => {
    const normalized = normalizeObservation(observation, dimensionIdForResult);
    const identity = observationIdentity(normalized);
    if (seen.has(identity)) fail('DUPLICATE_OBSERVATION', 'provider observations must be unique');
    seen.add(identity);
    return normalized;
  });
  result.sort((left, right) => compareAscii(
    `${left.category}\0${left.path ?? ''}\0${left.matchedKey}`,
    `${right.category}\0${right.path ?? ''}\0${right.matchedKey}`,
  ));
  return result;
}

function assertObservationsShape(value) {
  try {
    assertDataOnly(value, ProviderResultError, {
      maxArray: PROVIDER_RESULT_LIMITS.observations,
      maxDepth: 5,
      maxNodes: PROVIDER_RESULT_LIMITS.observations * 16,
      maxObjectKeys: 128,
      maxString: PROVIDER_RESULT_LIMITS.detailsString,
    });
  } catch (error) {
    if (error instanceof ProviderResultError) throw error;
    fail('INVALID_DATA', 'provider observations must contain plain bounded data');
  }
  if (!Array.isArray(value) || value.length > PROVIDER_RESULT_LIMITS.observations) {
    fail('BOUND_EXCEEDED', 'provider observations must be a bounded array');
  }
}

/**
 * Build an immutable provider result for one provider dimension.
 *
 * @param {object} input - `{ providerId, dimensionId, observations }`.
 * @returns {{ providerId: string, dimensionId: string, observations: object[] }}
 *   A deep-frozen result with deterministically sorted observations. Never throws
 *   a non-typed error; category, path, source kind, and duplicate violations are
 *   reported through `ProviderResultError`.
 */
export function createProviderResult({ providerId: id, dimensionId: dimension, observations: entries }) {
  const input = { providerId: id, dimensionId: dimension, observations: entries };
  try {
    assertDataOnly(input, ProviderResultError, {
      maxArray: PROVIDER_RESULT_LIMITS.observations,
      maxDepth: 5,
      maxNodes: PROVIDER_RESULT_LIMITS.observations * 16,
      maxObjectKeys: 128,
      maxString: PROVIDER_RESULT_LIMITS.detailsString,
    });
  } catch (error) {
    if (error instanceof ProviderResultError) throw error;
    fail('INVALID_DATA', 'provider result must contain plain bounded data');
  }
  const provider = providerId(id);
  const dimensionCanonical = dimensionId(dimension);
  assertObservationsShape(entries);
  const observations = canonicalObservations(dimensionCanonical, entries);
  return deepFreeze({
    providerId: provider,
    dimensionId: dimensionCanonical,
    observations,
  });
}

function asResult(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', `${label} provider result must be an object`);
  }
  exactKeys(value, RESULT_KEYS, label);
  const provider = providerId(value.providerId);
  const dimension = dimensionId(value.dimensionId);
  assertObservationsShape(value.observations);
  const observations = canonicalObservations(dimension, value.observations);
  return { providerId: provider, dimensionId: dimension, observations };
}

/**
 * Deterministic merge of a built-in provider result with appended plugin
 * observations for the same dimension.
 *
 * Rules (T210):
 *   - Built-in observations always come first, in canonical order.
 *   - Plugin observations are appended in canonical order.
 *   - Exact duplicate plugin observations are dropped; they never replace or
 *     rewrite a built-in finding.
 *   - The merged result remains immutable and category-validated.
 *
 * @param {object} input - `{ builtin, plugin }` provider results (same dimension).
 * @returns {object} A deep-frozen merged provider result.
 */
export function mergeProviderResults({ builtin, plugin }) {
  if (plugin === undefined || plugin === null) return builtin;
  const built = asResult(builtin, 'builtin');
  const plug = asResult(plugin, 'plugin');
  if (built.dimensionId !== plug.dimensionId) {
    fail('DIMENSION_MISMATCH', 'merged provider results must target the same dimension');
  }
  const builtinSet = new Set(built.observations.map(observationIdentity));
  const appended = plug.observations.filter((observation) => !builtinSet.has(observationIdentity(observation)));
  return deepFreeze({
    providerId: built.providerId,
    dimensionId: built.dimensionId,
    observations: [...built.observations, ...appended],
  });
}
