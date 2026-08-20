// Inert registration data — the ordered 17-dimension registry snapshot and the
// Cross-repo global stage descriptor.
//
// T222 owns this module. It defines the canonical 17-dimension registry
// snapshot that T224 will inject into the pipeline: exact canonical dimension
// order, globally unique expected claim IDs (stable `CLM-<dimension>-<topic>-v1`
// identifiers covering each dimension's factual topics), retryability flags,
// provider-capability flags, and renderer IDs. It also defines the Cross-repo
// global stage descriptor as inert injectable data.
//
// Guarantees:
//   - DIMENSION_REGISTRY is validated through the T202 `validateDimensions`
//     contract: exactly 17 entries, canonical order, boolean flags, allowlisted
//     applicability, and globally unique expected claim IDs and renderer IDs.
//   - Every expected claim ID is stable and globally unique, covering the
//     factual topics of its owning dimension; the flat EXPECTED_CLAIM_IDS list
//     is deterministically sorted.
//   - Retryability is uniform (true) for all 17 dimensions, preserving the
//     existing generic retry semantics (validate.mjs re-scans any dimension
//     whose detection is incomplete); providerCapability mirrors the T202
//     canonical mapping (all dimensions except DIM-structure-v1 and
//     DIM-git-v1).
//   - The Cross-repo global stage descriptor is data-only: it describes the
//     T221 global synthesis stage by reference (module path, export name,
//     renderer factory/export name) without importing the cross-repo modules,
//     which the T221 inertness contract requires.
//   - All exports are deep-frozen and deterministic; repeated evaluation
//     produces byte-identical snapshots.
//   - UNREGISTERED: nothing in production imports this module; activation is
//     exclusively the T224 cutover.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the T202 dimension and
// evidence contracts and never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import {
  compareAscii,
  deepFreeze,
} from '../contracts/evidence.mjs';
import {
  PROVIDER_DIMENSION_IDS,
  TOTAL_DIMENSION_COUNT,
  validateDimensions,
} from '../contracts/dimension.mjs';

export const DIMENSION_REGISTRY_VERSION = 1;
export const CROSS_REPO_SCHEMA_VERSION = 1;

const DEFAULT_APPLICABILITY = Object.freeze({
  mode: 'all',
  rules: Object.freeze([Object.freeze({
    field: 'repository_kind',
    operator: 'equals',
    value: 'source',
  })]),
});

const GIT_APPLICABILITY = Object.freeze({
  mode: 'all',
  rules: Object.freeze([Object.freeze({
    field: 'is_git',
    operator: 'equals',
    value: true,
  })]),
});

// Canonical dimension sources in exact T202 order. `short` is the stable
// dimension token used by the expected-claim prefix and the renderer ID; the
// `claims` list covers the dimension's factual topics (mapped from its
// DIMENSION_EVIDENCE_CATEGORIES allowlist).
const DIMENSION_SOURCES = Object.freeze([
  {
    short: 'structure',
    id: 'DIM-structure-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-structure-directory-tree-v1',
      'CLM-structure-file-inventory-v1',
      'CLM-structure-artifacts-v1',
    ]),
  },
  {
    short: 'stack',
    id: 'DIM-stack-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-stack-language-v1',
      'CLM-stack-runtime-v1',
      'CLM-stack-frameworks-v1',
      'CLM-stack-package-manager-v1',
    ]),
  },
  {
    short: 'config',
    id: 'DIM-config-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-config-lint-format-v1',
      'CLM-config-environment-v1',
      'CLM-config-configuration-v1',
      'CLM-config-editor-v1',
    ]),
  },
  {
    short: 'testing',
    id: 'DIM-testing-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-testing-framework-v1',
      'CLM-testing-layout-v1',
      'CLM-testing-coverage-v1',
      'CLM-testing-configuration-v1',
      'CLM-testing-fixture-v1',
      'CLM-testing-test-file-v1',
    ]),
  },
  {
    short: 'conventions',
    id: 'DIM-conventions-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-conventions-import-style-v1',
      'CLM-conventions-naming-v1',
      'CLM-conventions-error-handling-v1',
      'CLM-conventions-module-system-v1',
      'CLM-conventions-comments-v1',
    ]),
  },
  {
    short: 'git',
    id: 'DIM-git-v1',
    applicability: GIT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-git-repository-metadata-v1',
      'CLM-git-history-v1',
    ]),
  },
  {
    short: 'architecture',
    id: 'DIM-architecture-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-architecture-import-graph-v1',
      'CLM-architecture-entry-points-v1',
      'CLM-architecture-dynamic-indicators-v1',
      'CLM-architecture-module-v1',
      'CLM-architecture-coupling-v1',
      'CLM-architecture-solid-indicators-v1',
      'CLM-architecture-layer-model-v1',
    ]),
  },
  {
    short: 'documentation',
    id: 'DIM-documentation-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-documentation-readme-v1',
      'CLM-documentation-license-v1',
      'CLM-documentation-contributing-v1',
      'CLM-documentation-reference-artifacts-v1',
    ]),
  },
  {
    short: 'security',
    id: 'DIM-security-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-security-secret-patterns-v1',
      'CLM-security-authentication-v1',
      'CLM-security-authorization-v1',
      'CLM-security-validation-v1',
      'CLM-security-dependency-lock-v1',
      'CLM-security-tooling-v1',
    ]),
  },
  {
    short: 'operations',
    id: 'DIM-operations-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-operations-containers-v1',
      'CLM-operations-workflows-v1',
      'CLM-operations-health-monitoring-v1',
      'CLM-operations-deployment-declarations-v1',
    ]),
  },
  {
    short: 'api',
    id: 'DIM-api-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-api-routes-v1',
      'CLM-api-contracts-v1',
      'CLM-api-events-v1',
      'CLM-api-public-exports-v1',
      'CLM-api-cli-commands-v1',
      'CLM-api-rpc-v1',
    ]),
  },
  {
    short: 'data',
    id: 'DIM-data-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-data-stores-schemas-v1',
      'CLM-data-entities-fields-v1',
      'CLM-data-migrations-v1',
      'CLM-data-cache-queue-relations-v1',
      'CLM-data-key-v1',
    ]),
  },
  {
    short: 'deployment',
    id: 'DIM-deployment-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-deployment-images-services-v1',
      'CLM-deployment-resources-v1',
      'CLM-deployment-topology-v1',
      'CLM-deployment-template-indicator-v1',
    ]),
  },
  {
    short: 'maintainability',
    id: 'DIM-maintainability-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-maintainability-file-metrics-v1',
      'CLM-maintainability-duplicate-spans-v1',
      'CLM-maintainability-branch-complexity-v1',
      'CLM-maintainability-universe-v1',
      'CLM-maintainability-generated-boundary-v1',
      'CLM-maintainability-tool-result-v1',
      'CLM-maintainability-dead-code-v1',
    ]),
  },
  {
    short: 'governance',
    id: 'DIM-governance-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-governance-ownership-v1',
      'CLM-governance-policies-v1',
      'CLM-governance-contribution-v1',
      'CLM-governance-releases-reviews-v1',
      'CLM-governance-decision-v1',
      'CLM-governance-funding-v1',
      'CLM-governance-reference-v1',
      'CLM-governance-runbook-v1',
      'CLM-governance-support-v1',
    ]),
  },
  {
    short: 'assurance',
    id: 'DIM-assurance-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-assurance-lockfiles-v1',
      'CLM-assurance-sbom-sarif-v1',
      'CLM-assurance-standards-v1',
      'CLM-assurance-license-accessibility-v1',
      'CLM-assurance-attestation-v1',
      'CLM-assurance-configuration-v1',
      'CLM-assurance-manifest-v1',
      'CLM-assurance-pin-v1',
      'CLM-assurance-source-v1',
      'CLM-assurance-tool-result-v1',
      'CLM-assurance-vex-v1',
    ]),
  },
  {
    short: 'practices',
    id: 'DIM-practices-v1',
    applicability: DEFAULT_APPLICABILITY,
    claims: Object.freeze([
      'CLM-practices-methodology-v1',
      'CLM-practices-enforcement-v1',
      'CLM-practices-automation-v1',
      'CLM-practices-rituals-v1',
      'CLM-practices-quality-gates-v1',
      'CLM-practices-agent-workflow-v1',
      'CLM-practices-style-guide-v1',
    ]),
  },
]);

// Raw, deep-frozen, pre-validation definitions. `order` is the canonical
// index, so the snapshot can never drift from the T202 dimension order.
export const DIMENSION_DEFINITIONS = deepFreeze(
  DIMENSION_SOURCES.map((source, index) => ({
    id: source.id,
    order: index,
    expectedClaimIds: source.claims,
    applicability: source.applicability,
    retryable: true,
    providerCapability: PROVIDER_DIMENSION_IDS.includes(source.id),
    rendererId: `RND-${source.short}-v1`,
  })),
);

/**
 * The validated, deep-frozen 17-dimension registry snapshot. Produced by the
 * T202 `validateDimensions` contract: canonical order, unique expected claim
 * IDs and renderer IDs, boolean flags, and allowlisted applicability.
 * Deterministic and immutable.
 */
export const DIMENSION_REGISTRY = validateDimensions(DIMENSION_DEFINITIONS);

// Deterministically sorted flat list of every expected claim ID (globally
// unique by construction of the registry validation).
export const EXPECTED_CLAIM_IDS = deepFreeze(
  DIMENSION_REGISTRY.flatMap(({ expectedClaimIds }) => expectedClaimIds)
    .toSorted(compareAscii),
);

// Deterministically sorted list of the 17 dimension renderer IDs.
export const DIMENSION_RENDERER_IDS = deepFreeze(
  DIMENSION_REGISTRY.map(({ rendererId }) => rendererId).toSorted(compareAscii),
);

// Stable map from dimension id to its renderer ID.
export const DIMENSION_RENDERER_MAP = deepFreeze(Object.fromEntries(
  DIMENSION_REGISTRY.map(({ id, rendererId }) => [id, rendererId]),
));

/**
 * Inert descriptor for the Cross-repo global stage. Data-only: it references
 * the T221 global synthesis stage and its inert renderer by module path and
 * export name so that activation (T224) can wire them, without importing the
 * cross-repo modules here (which the T221 inertness contract forbids). The
 * stage follows the 17 per-repo dimensions (order === TOTAL_DIMENSION_COUNT),
 * is never retried, and is not a provider-capability dimension.
 */
export const CROSS_REPO_GLOBAL_STAGE = deepFreeze({
  stageId: 'STG-cross-repo-global-v1',
  schemaVersion: CROSS_REPO_SCHEMA_VERSION,
  name: 'cross-repo-global',
  kind: 'global',
  order: TOTAL_DIMENSION_COUNT,
  retryable: false,
  providerCapability: false,
  rendererId: 'RND-cross-repo-global-v1',
  synthesis: deepFreeze({
    module: 'lib/scan/cross-repo/edges.mjs',
    exportName: 'synthesizeCrossRepository',
  }),
  renderer: deepFreeze({
    module: 'lib/scan/cross-repo/render.mjs',
    factory: 'createCrossRepositoryRenderer',
    exportName: 'renderCrossRepositoryGlobal',
  }),
  inputs: deepFreeze(['repositories', 'references']),
});
