// Inert builtin provider index — one deterministic data-only table assembling
// every built-in provider from the three inert catalogs plus the generic
// artifact fallback.
//
// T222 owns this module. It aggregates the per-dimension built-in providers
// (runtime stack/config/testing, analysis architecture/conventions/
// documentation, assurance security/operations/api/data/deployment/
// maintainability/governance/assurance) plus the generic fallback into a
// single validated T202 provider registry with globally unique IDs and all 14
// provider dimensions represented.
//
// Guarantees:
//   - BUILTIN_PROVIDER_INDEX is validated through the T202 `validateProviders`
//     contract: deep-frozen, duplicate-free, and deterministically sorted by
//     provider id.
//   - Every one of the 14 provider dimensions is represented by exactly one
//     primary built-in provider (BUILTIN_DIMENSION_TO_PROVIDER); the generic
//     fallback covers its three dimensions (maintainability/assurance/
//     documentation) as artifact-only fallback.
//   - Provider IDs and category allowlists mirror the owning catalogs
//     byte-for-byte; the companion T222 test cross-checks this index against
//     the three catalogs. Plugin carrier providers (PRV-*-plugin-v1) are
//     intentionally excluded: this is the BUILTIN index.
//   - The index is deliberately UNREGISTERED and never imported by production;
//     activation is exclusively the T224 cutover.
//
// Note: this module intentionally does NOT import the inert catalogs. The
// T218/T220 inertness contracts assert that no module under lib/scan imports
// the runtime or assurance catalogs, so the index carries the same provider
// IDs and category allowlists as mirror data (verified against the catalogs by
// the T222 test).
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the T202 provider and
// evidence contracts and never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import {
  compareAscii,
  deepFreeze,
} from '../../contracts/evidence.mjs';
import {
  PROVIDER_CATEGORIES,
  validateProviders,
} from '../../contracts/provider.mjs';

export const BUILTIN_PROVIDER_VERSION = 1;

// Generic artifact fallback — mirrors `generic.mjs` GENERIC_PROVIDER_ID and
// its three artifact-only capabilities (maintainability/assurance/
// documentation). This raw definition is ordered for readability; the exported
// GENERIC_BUILTIN_DIMENSIONS is the validated, dimensionId-sorted form.
export const GENERIC_BUILTIN_PROVIDER_ID = 'PRV-generic-artifacts-v1';

const GENERIC_DIMENSIONS = Object.freeze([
  { dimensionId: 'DIM-maintainability-v1', categories: ['file_metric', 'measurement_universe'] },
  { dimensionId: 'DIM-assurance-v1', categories: ['lock', 'manifest'] },
  { dimensionId: 'DIM-documentation-v1', categories: ['contributing', 'license', 'readme'] },
]);

// Mirror provider definitions. IDs match the catalog constants exactly:
//   runtime-catalog.mjs   STACK/CONFIG/TESTING_CATALOG_PROVIDER_ID
//   analysis-catalog.mjs  ANALYSIS_PROVIDER_IDS.{architecture,conventions,documentation}
//   assurance-catalog.mjs SECURITY/OPERATIONS_CATALOG_PROVIDER_ID + per-dimension
//                         provider ids (api/data/deployment/maintainability/
//                         governance/assurance)
//   generic.mjs           GENERIC_PROVIDER_ID
// The 14 primary providers claim the full category allowlist of their
// dimension (PROVIDER_CATEGORIES), exactly as each catalog declares.
const BUILTIN_DEFINITIONS = Object.freeze([
  {
    id: 'PRV-runtime-stack-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-stack-v1', categories: PROVIDER_CATEGORIES['DIM-stack-v1'] }],
  },
  {
    id: 'PRV-runtime-config-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-config-v1', categories: PROVIDER_CATEGORIES['DIM-config-v1'] }],
  },
  {
    id: 'PRV-runtime-testing-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-testing-v1', categories: PROVIDER_CATEGORIES['DIM-testing-v1'] }],
  },
  {
    id: 'PRV-analysis-architecture-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-architecture-v1', categories: PROVIDER_CATEGORIES['DIM-architecture-v1'] }],
  },
  {
    id: 'PRV-analysis-conventions-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-conventions-v1', categories: PROVIDER_CATEGORIES['DIM-conventions-v1'] }],
  },
  {
    id: 'PRV-analysis-documentation-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-documentation-v1', categories: PROVIDER_CATEGORIES['DIM-documentation-v1'] }],
  },
  {
    id: 'PRV-security-hardening-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-security-v1', categories: PROVIDER_CATEGORIES['DIM-security-v1'] }],
  },
  {
    id: 'PRV-operations-declarations-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-operations-v1', categories: PROVIDER_CATEGORIES['DIM-operations-v1'] }],
  },
  {
    id: 'PRV-api-surface-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-api-v1', categories: PROVIDER_CATEGORIES['DIM-api-v1'] }],
  },
  {
    id: 'PRV-data-architecture-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-data-v1', categories: PROVIDER_CATEGORIES['DIM-data-v1'] }],
  },
  {
    id: 'PRV-deployment-topology-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-deployment-v1', categories: PROVIDER_CATEGORIES['DIM-deployment-v1'] }],
  },
  {
    id: 'PRV-maintainability-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-maintainability-v1', categories: PROVIDER_CATEGORIES['DIM-maintainability-v1'] }],
  },
  {
    id: 'PRV-governance-ownership-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-governance-v1', categories: PROVIDER_CATEGORIES['DIM-governance-v1'] }],
  },
  {
    id: 'PRV-assurance-supply-chain-v1',
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: [{ dimensionId: 'DIM-assurance-v1', categories: PROVIDER_CATEGORIES['DIM-assurance-v1'] }],
  },
  {
    id: GENERIC_BUILTIN_PROVIDER_ID,
    apiVersion: BUILTIN_PROVIDER_VERSION,
    dimensions: GENERIC_DIMENSIONS,
  },
]);

/**
 * Validated, deep-frozen, duplicate-free T202 provider registry for all
 * built-in providers plus the generic fallback. Sorted by provider id; every
 * dimension/category is allowlisted by the provider contract. Deterministic
 * and immutable.
 */
export const BUILTIN_PROVIDER_INDEX = validateProviders(BUILTIN_DEFINITIONS);

export const BUILTIN_PROVIDER_COUNT = BUILTIN_PROVIDER_INDEX.length;
export const BUILTIN_DIMENSION_COUNT = 14;

// The generic fallback's validated, dimensionId-sorted capabilities (mirrors
// the generic provider's artifact-only dimensions).
export const GENERIC_BUILTIN_DIMENSIONS = deepFreeze(
  BUILTIN_PROVIDER_INDEX.find(({ id }) => id === GENERIC_BUILTIN_PROVIDER_ID).dimensions,
);

// Deterministically sorted list of every built-in provider ID.
export const BUILTIN_PROVIDER_IDS = deepFreeze(
  BUILTIN_PROVIDER_INDEX.map(({ id }) => id).sort(compareAscii),
);

// Primary built-in provider per provider dimension: for each of the 14
// provider dimensions, the first (alphabetically) non-generic provider that
// claims it. The generic fallback is excluded so this map is the canonical
// dimension -> builtin provider table (one entry per provider dimension).
export const BUILTIN_DIMENSION_TO_PROVIDER = deepFreeze(Object.fromEntries(
  Object.keys(PROVIDER_CATEGORIES).map((dimensionId) => {
    const primary = BUILTIN_PROVIDER_INDEX
      .filter(({ id, dimensions }) => id !== GENERIC_BUILTIN_PROVIDER_ID
        && dimensions.some(({ dimensionId: dim }) => dim === dimensionId))
      .map(({ id }) => id)
      .sort(compareAscii)[0];
    return [dimensionId, primary];
  }),
));
