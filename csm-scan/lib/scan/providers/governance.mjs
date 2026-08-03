// Governance & Ownership dimension — T210-compatible provider.
//
// T215 owns this module. It maps the governance model
// (`lib/scan/deep/governance/model.mjs`) into immutable provider results
// through the provider foundation (`lib/scan/providers/base.mjs`), using ONLY
// the DIM-governance category allowlist (contribution, decision, funding,
// ownership, policy, reference, release, review, runbook, support). It is
// inert: exported as factory functions for tests and future provider catalogs
// (T218-T220), never wired into the pipeline, CLI, enrich, validate, write, or
// renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative declaration file (or null for aggregate assignee records)
//     and `matchedKey` is a deterministic category-prefixed key with all
//     non-token characters percent-encoded. Keys stay within the T210
//     128-character foundation bound: an over-long link URL or CODEOWNERS
//     pattern is disambiguated by a stable short hash instead of invalidating
//     the whole provider result.
//   - Identities are already opaque report-local labels in the model; the
//     provider never emits a raw owner, email, or personal name.
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     duplicate and unknown categories are rejected by the foundation.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only the provider foundation,
// the contracts, and the governance model; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import { assertDataOnly, compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { createProviderResult } from './base.mjs';
import {
  encodeMatchedKey,
  GOVERNANCE_DIMENSION_ID,
} from '../deep/governance/model.mjs';

export const GOVERNANCE_PROVIDER_ID = 'PRV-governance-ownership-v1';

function sourceKindFor(category) {
  if (['funding'].includes(category)) return 'config';
  if (['decision', 'reference', 'release', 'runbook', 'support'].includes(category)) return 'documentation';
  return 'policy';
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

function entryObservation(entry) {
  return {
    category: entry.category,
    path: entry.path,
    matchedKey: boundedMatchedKey(entry.matchedKey, entry.category),
    details: {
      dialect: entry.dialect,
      status: entry.status,
    },
    sourceKind: sourceKindFor(entry.category),
  };
}

function ruleObservation(rule) {
  return {
    category: 'ownership',
    path: rule.path,
    matchedKey: boundedMatchedKey(`rule:${rule.path}:${rule.pattern}`, 'rule'),
    details: {
      pattern: rule.pattern,
      anchored: rule.anchored,
      labels: rule.labels,
      line: rule.line,
    },
    sourceKind: 'policy',
  };
}

function assigneeObservation(assignee) {
  return {
    category: 'ownership',
    path: null,
    matchedKey: boundedMatchedKey(`assignee:${assignee.label}`, 'assignee'),
    details: { count: assignee.count },
    sourceKind: 'policy',
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
 * Derive provider observations from a governance model. Pure and deterministic.
 * @param {object} model - the deep-frozen governance model from
 *   `buildGovernanceModel`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   empty or foreign input.
 */
export function governanceObservations(model) {
  if (model === null || typeof model !== 'object' || !Array.isArray(model.entries)) return [];
  validateModel(model);
  const observations = [];
  for (const entry of model.entries) observations.push(entryObservation(entry));
  for (const rule of model.ownership?.rules ?? []) observations.push(ruleObservation(rule));
  for (const assignee of model.ownership?.assignees ?? []) observations.push(assigneeObservation(assignee));

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
  return deepFreeze([{ dimensionId: GOVERNANCE_DIMENSION_ID, observations: unique }]);
}

/**
 * Build immutable provider results from a governance model. Inert.
 * @param {object} model - the deep-frozen governance model.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function governanceProviderResult(model) {
  return governanceObservations(model).map(({ dimensionId, observations }) => (
    createProviderResult({ providerId: GOVERNANCE_PROVIDER_ID, dimensionId, observations })
  ));
}
