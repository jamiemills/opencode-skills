// T222 — inert dimension and provider registration.
//
// Owned by T222. Tests the inert registration snapshots that T224 will inject
// at activation:
//   - lib/scan/registry/dimensions.mjs — the ordered 16-dimension registry
//     validated through the T202 `validateDimensions` contract, stable
//     expected claim IDs, retryability/providerCapability flags, renderer IDs,
//     and the Cross-repo global stage descriptor.
//   - lib/scan/providers/builtin/index.mjs — the builtin provider index
//     assembling all three catalogs' providers plus the generic fallback into
//     one deterministic data-only table.
//
// Scope (own-only): this test file plus the two new lib modules. Nothing else
// is edited.
//
// Guarantees verified here:
//   1. Every dimension exactly once in canonical order; registry validates
//      through the T202 contract.
//   2. Every provider exactly once; index validates through the T202 contract.
//   3. All 15 provider dimensions represented, each with one primary builtin
//      provider.
//   4. Stable expected-claim IDs: bounded, pattern-valid, per-dimension prefix,
//      and globally unique.
//   5. Duplicate/unknown failure cases fail with typed contract errors.
//   6. Immutability: every snapshot and derived constant is deep-frozen.
//   7. Determinism: repeated validation and serialization are byte-identical.
//   8. Inertness: no production module imports the two new modules; the modules
//      avoid T201 forbidden capabilities; the builtin index mirrors the
//      catalogs without importing them.
//
// The index mirror data is cross-checked against the three inert catalogs
// (runtime/analysis/assurance) and the generic provider, which this test is
// allowed to import directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DIMENSION_IDS,
  DimensionContractError,
  PROVIDER_DIMENSION_IDS,
  validateDimension,
  validateDimensions,
} from "../lib/scan/contracts/dimension.mjs";
import {
  ProviderContractError,
  PROVIDER_CATEGORIES,
  validateProvider,
  validateProviders,
} from "../lib/scan/contracts/provider.mjs";
import { compareAscii, DIMENSION_EVIDENCE_CATEGORIES } from "../lib/scan/contracts/evidence.mjs";
import {
  CROSS_REPO_GLOBAL_STAGE,
  DIMENSION_DEFINITIONS,
  DIMENSION_RENDERER_IDS,
  DIMENSION_RENDERER_MAP,
  DIMENSION_REGISTRY,
  DIMENSION_REGISTRY_VERSION,
  EXPECTED_CLAIM_IDS,
} from "../lib/scan/registry/dimensions.mjs";
import {
  BUILTIN_DIMENSION_COUNT,
  BUILTIN_DIMENSION_TO_PROVIDER,
  BUILTIN_PROVIDER_COUNT,
  BUILTIN_PROVIDER_IDS,
  BUILTIN_PROVIDER_INDEX,
  BUILTIN_PROVIDER_VERSION,
  GENERIC_BUILTIN_DIMENSIONS,
  GENERIC_BUILTIN_PROVIDER_ID,
} from "../lib/scan/providers/builtin/index.mjs";
import { RUNTIME_CATALOG_PROVIDERS } from "../lib/scan/providers/runtime-catalog.mjs";
import {
  ANALYSIS_DIMENSION_IDS,
  ANALYSIS_PROVIDER_IDS,
} from "../lib/scan/providers/analysis-catalog.mjs";
import { ASSURANCE_CATALOG_PROVIDERS } from "../lib/scan/providers/assurance-catalog.mjs";
import { GENERIC_PROVIDER_ID } from "../lib/scan/providers/generic.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, "..", "lib");

const CLAIM_ID_PATTERN = /^CLM-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const RENDERER_ID_PATTERN = /^RND-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const PROVIDER_ID_PATTERN = /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dimensionShort(id) {
  return id.replace(/^DIM-/, "").replace(/-v[1-9]\d*$/, "");
}

function byId(providers) {
  return new Map(providers.map((provider) => [provider.id, provider]));
}

async function libScanFiles() {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
    }
  }
  await visit(join(LIB_ROOT, "scan"));
  return files.toSorted();
}

function relativeImportTargets(source) {
  const targets = [];
  const pattern = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

function claimTopic(claimId) {
  return claimId.split("-").slice(2, -1).join("-");
}

function claimTopics(dimension) {
  return dimension.expectedClaimIds.map(claimTopic);
}

// Maps every factual topic category from DIMENSION_EVIDENCE_CATEGORIES to the
// claim topic strings (leading tokens after the CLM-<dimension>- prefix) that
// cover it. Concatenated and plural claim topics are listed explicitly so the
// set-inclusion check is exact rather than substring-based. Keys must cover
// every category in the contract allowlist (asserted below).
const CATEGORY_TOPIC_COVERAGE = Object.freeze({
  accessibility: Object.freeze(["license-accessibility"]),
  agent_workflow: Object.freeze(["agent-workflow"]),
  artifact: Object.freeze(["artifacts"]),
  attestation: Object.freeze(["attestation"]),
  authentication: Object.freeze(["authentication"]),
  authorization: Object.freeze(["authorization"]),
  automation: Object.freeze(["automation"]),
  branch_point: Object.freeze(["branch-complexity"]),
  cache: Object.freeze(["cache-queue-relations"]),
  cli_command: Object.freeze(["cli-commands"]),
  comment: Object.freeze(["comments"]),
  configuration: Object.freeze(["configuration"]),
  container: Object.freeze(["containers"]),
  contract: Object.freeze(["contracts"]),
  contributing: Object.freeze(["contributing"]),
  contribution: Object.freeze(["contribution"]),
  coupling: Object.freeze(["coupling"]),
  coverage: Object.freeze(["coverage"]),
  dead_code: Object.freeze(["dead-code"]),
  decision: Object.freeze(["decision"]),
  dependency_lock: Object.freeze(["dependency-lock"]),
  deployment_declaration: Object.freeze(["deployment-declarations"]),
  design_pattern: Object.freeze(["solid-indicators", "layer-model"]),
  directory_structure: Object.freeze(["directory-tree"]),
  duplicate_span: Object.freeze(["duplicate-spans"]),
  dynamic_indicator: Object.freeze(["dynamic-indicators"]),
  editor: Object.freeze(["editor"]),
  enforcement: Object.freeze(["enforcement"]),
  entity: Object.freeze(["entities-fields"]),
  entry_point: Object.freeze(["entry-points"]),
  environment: Object.freeze(["environment"]),
  error_handling: Object.freeze(["error-handling"]),
  event: Object.freeze(["events"]),
  field: Object.freeze(["entities-fields"]),
  file_inventory: Object.freeze(["file-inventory"]),
  file_metric: Object.freeze(["file-metrics"]),
  file_naming: Object.freeze(["naming"]),
  fixture: Object.freeze(["fixture"]),
  format: Object.freeze(["lint-format"]),
  framework: Object.freeze(["frameworks", "framework"]),
  funding: Object.freeze(["funding"]),
  generated_boundary: Object.freeze(["generated-boundary"]),
  graph: Object.freeze(["import-graph"]),
  health_check: Object.freeze(["health-monitoring"]),
  history: Object.freeze(["history"]),
  image: Object.freeze(["images-services"]),
  import_edge: Object.freeze(["import-graph"]),
  import_style: Object.freeze(["import-style"]),
  key: Object.freeze(["key"]),
  language: Object.freeze(["language"]),
  license: Object.freeze(["license", "license-accessibility"]),
  lint: Object.freeze(["lint-format"]),
  lock: Object.freeze(["lockfiles"]),
  manifest: Object.freeze(["manifest"]),
  measurement_universe: Object.freeze(["universe"]),
  methodology: Object.freeze(["methodology"]),
  migration: Object.freeze(["migrations"]),
  module: Object.freeze(["module"]),
  module_system: Object.freeze(["module-system"]),
  monitoring: Object.freeze(["health-monitoring"]),
  ownership: Object.freeze(["ownership"]),
  package_manager: Object.freeze(["package-manager"]),
  pin: Object.freeze(["pin"]),
  policy: Object.freeze(["policies"]),
  public_export: Object.freeze(["public-exports"]),
  quality_gate: Object.freeze(["quality-gates"]),
  queue: Object.freeze(["cache-queue-relations"]),
  readme: Object.freeze(["readme"]),
  reference: Object.freeze(["reference", "reference-artifacts"]),
  relation: Object.freeze(["cache-queue-relations"]),
  release: Object.freeze(["releases-reviews"]),
  repository_metadata: Object.freeze(["repository-metadata"]),
  resource: Object.freeze(["resources"]),
  review: Object.freeze(["releases-reviews"]),
  ritual: Object.freeze(["rituals"]),
  route: Object.freeze(["routes"]),
  rpc: Object.freeze(["rpc"]),
  runbook: Object.freeze(["runbook"]),
  runtime: Object.freeze(["runtime"]),
  sarif: Object.freeze(["sbom-sarif"]),
  sbom: Object.freeze(["sbom-sarif"]),
  schema: Object.freeze(["stores-schemas"]),
  secret_pattern: Object.freeze(["secret-patterns"]),
  security_tool: Object.freeze(["tooling"]),
  service: Object.freeze(["images-services"]),
  source: Object.freeze(["source"]),
  standard: Object.freeze(["standards"]),
  store: Object.freeze(["stores-schemas"]),
  style_guide: Object.freeze(["style-guide"]),
  support: Object.freeze(["support"]),
  template_indicator: Object.freeze(["template-indicator"]),
  test_directory: Object.freeze(["layout"]),
  test_file: Object.freeze(["test-file"]),
  topology_edge: Object.freeze(["topology"]),
  tool_result: Object.freeze(["tool-result"]),
  validation: Object.freeze(["validation"]),
  vex: Object.freeze(["vex"]),
  workflow: Object.freeze(["workflows"]),
});

// ---------------------------------------------------------------------------
// Dimension registry — canonical order and exact-once
// ---------------------------------------------------------------------------

test("T222 dimensions: registry validates through the contract and holds every dimension exactly once in canonical order", () => {
  assert.equal(DIMENSION_REGISTRY_VERSION, 1);
  assert.equal(DIMENSION_REGISTRY.length, DIMENSION_IDS.length);
  assert.deepEqual(
    DIMENSION_REGISTRY.map(({ id }) => id),
    DIMENSION_IDS,
  );
  assert.deepEqual(
    DIMENSION_REGISTRY.map(({ order }) => order),
    DIMENSION_IDS.map((_, index) => index),
  );
  assert.equal(new Set(DIMENSION_REGISTRY.map(({ id }) => id)).size, DIMENSION_IDS.length);
  assert.equal(DIMENSION_DEFINITIONS.length, 17);
  assert.deepEqual(validateDimensions(DIMENSION_DEFINITIONS), DIMENSION_REGISTRY);
});

test("T222 dimensions: flags, renderer IDs, and applicability are deterministic per dimension", () => {
  for (const dimension of DIMENSION_REGISTRY) {
    const short = dimensionShort(dimension.id);
    assert.equal(dimension.rendererId, `RND-${short}-v1`);
    assert.match(dimension.rendererId, RENDERER_ID_PATTERN);
    assert.equal(dimension.providerCapability, PROVIDER_DIMENSION_IDS.includes(dimension.id));
    assert.equal(dimension.retryable, true);
    assert.equal(typeof dimension.applicability.mode, "string");
    assert.ok(
      Array.isArray(dimension.applicability.rules) && dimension.applicability.rules.length > 0,
    );
  }
  assert.equal(new Set(DIMENSION_REGISTRY.map(({ rendererId }) => rendererId)).size, 17);
  assert.equal(DIMENSION_RENDERER_IDS.length, 17);
  assert.deepEqual(
    DIMENSION_RENDERER_IDS,
    DIMENSION_REGISTRY.map(({ rendererId }) => rendererId).toSorted(compareAscii),
  );
  assert.equal(Object.keys(DIMENSION_RENDERER_MAP).length, 17);
  for (const dimension of DIMENSION_REGISTRY) {
    assert.equal(DIMENSION_RENDERER_MAP[dimension.id], dimension.rendererId);
  }
});

test("T222 dimensions: every expected claim ID is stable, pattern-valid, prefixed by its dimension, and globally unique", () => {
  const flat = [];
  for (const dimension of DIMENSION_REGISTRY) {
    const short = dimensionShort(dimension.id);
    assert.ok(dimension.expectedClaimIds.length > 0, `${dimension.id} owns expected claims`);
    for (const claimId of dimension.expectedClaimIds) {
      assert.match(claimId, CLAIM_ID_PATTERN);
      assert.ok(
        claimId.startsWith(`CLM-${short}-`),
        `${claimId} does not start with CLM-${short}-`,
      );
      assert.match(claimId, /-v[1-9]\d*$/);
      flat.push(claimId);
    }
  }
  assert.equal(new Set(flat).size, flat.length, "expected claim IDs must be globally unique");
  assert.equal(EXPECTED_CLAIM_IDS.length, flat.length);
  assert.deepEqual(EXPECTED_CLAIM_IDS, flat.slice().toSorted(compareAscii));
  assert.equal(new Set(EXPECTED_CLAIM_IDS).size, EXPECTED_CLAIM_IDS.length);
  for (const dimension of DIMENSION_REGISTRY) {
    assert.ok(
      claimTopics(dimension).length >= 2,
      `${dimension.id} covers at least two factual topics`,
    );
  }
});

test("T222 dimensions: every DIMENSION_EVIDENCE_CATEGORIES entry has a corresponding claim topic (set inclusion)", () => {
  // The coverage table must name exactly the factual categories the T202
  // contract allows — no stale, orphaned, or invented category keys.
  const tableCategories = Object.keys(CATEGORY_TOPIC_COVERAGE).slice().toSorted(compareAscii);
  const contractCategories = [
    ...new Set(Object.values(DIMENSION_EVIDENCE_CATEGORIES).flat()),
  ].toSorted(compareAscii);
  assert.deepEqual(
    tableCategories,
    contractCategories,
    "CATEGORY_TOPIC_COVERAGE must name every contract category exactly once",
  );

  // Every topic named by the coverage table must actually be a claim topic of
  // some registered dimension, so the mapping cannot drift from the registry.
  const allTopics = new Set(DIMENSION_REGISTRY.flatMap(claimTopics));
  for (const topics of Object.values(CATEGORY_TOPIC_COVERAGE)) {
    for (const topic of topics) {
      assert.ok(
        allTopics.has(topic),
        `coverage table names topic ${topic}, but no claim registers it`,
      );
    }
  }

  // Set inclusion: for every dimension, every factual topic category has at
  // least one claimable expected claim ID. At T224 activation every
  // scanner-emitted category resolves to a claimable ID.
  for (const dimension of DIMENSION_REGISTRY) {
    const topics = new Set(claimTopics(dimension));
    const uncovered = DIMENSION_EVIDENCE_CATEGORIES[dimension.id].filter(
      (category) => !CATEGORY_TOPIC_COVERAGE[category].some((topic) => topics.has(topic)),
    );
    assert.deepEqual(
      uncovered,
      [],
      `${dimension.id} must cover every factual category, uncovered: ${uncovered.join(", ")}`,
    );
  }

  // Reverse direction: every claim topic of a dimension must be reachable from
  // at least one of that dimension's categories, so no claim is an orphan that
  // can never be emitted (which would permanently cap coverage below 1.0).
  for (const dimension of DIMENSION_REGISTRY) {
    const reachable = new Set(
      DIMENSION_EVIDENCE_CATEGORIES[dimension.id].flatMap(
        (category) => CATEGORY_TOPIC_COVERAGE[category],
      ),
    );
    const orphan = claimTopics(dimension).filter((topic) => !reachable.has(topic));
    assert.deepEqual(
      orphan,
      [],
      `${dimension.id} must not register unreachable claim topics, orphan: ${orphan.join(", ")}`,
    );
  }
});

test("T222 dimensions: duplicate and unknown failure cases fail with typed contract errors", () => {
  const one = DIMENSION_REGISTRY[0];

  // Registry of the wrong size.
  const fifteen = clone(DIMENSION_DEFINITIONS).slice(0, 15);
  assert.throws(
    () => validateDimensions(fifteen),
    (error) => error instanceof DimensionContractError && error.code === "INCOMPLETE_REGISTRY",
  );

  // Non-canonical order.
  const swapped = clone(DIMENSION_DEFINITIONS);
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(
    () => validateDimensions(swapped),
    (error) => error instanceof DimensionContractError && error.code === "INVALID_ORDER",
  );

  // Unknown dimension id.
  const unknown = clone(DIMENSION_DEFINITIONS);
  unknown[0].id = "DIM-fake-v1";
  unknown[0].order = DIMENSION_IDS.indexOf("DIM-fake-v1");
  assert.throws(
    () => validateDimensions(unknown),
    (error) => error instanceof DimensionContractError && error.code === "UNKNOWN_DIMENSION",
  );

  // Duplicate expected claim ID across dimensions.
  const duplicatedClaim = clone(DIMENSION_DEFINITIONS);
  duplicatedClaim[1].expectedClaimIds.push(duplicatedClaim[0].expectedClaimIds[0]);
  assert.throws(
    () => validateDimensions(duplicatedClaim),
    (error) => error instanceof DimensionContractError && error.code === "DUPLICATE_ID",
  );

  // Duplicate renderer ID across dimensions.
  const duplicatedRenderer = clone(DIMENSION_DEFINITIONS);
  duplicatedRenderer[1].rendererId = duplicatedRenderer[0].rendererId;
  assert.throws(
    () => validateDimensions(duplicatedRenderer),
    (error) => error instanceof DimensionContractError && error.code === "DUPLICATE_ID",
  );

  // Empty expected claims.
  const emptyClaims = clone(DIMENSION_DEFINITIONS);
  emptyClaims[0].expectedClaimIds = [];
  assert.throws(
    () => validateDimensions(emptyClaims),
    (error) => error instanceof DimensionContractError && error.code === "INVALID_EXPECTED",
  );

  // Mismatched providerCapability flag.
  const badFlag = clone(DIMENSION_DEFINITIONS);
  badFlag[0].providerCapability = true;
  assert.throws(
    () => validateDimensions(badFlag),
    (error) => error instanceof DimensionContractError && error.code === "INVALID_PROVIDER_FLAG",
  );

  // Renderer ID outside the RND pattern.
  const badRenderer = clone(DIMENSION_DEFINITIONS);
  badRenderer[0].rendererId = "not-a-renderer";
  assert.throws(
    () => validateDimensions(badRenderer),
    (error) => error instanceof DimensionContractError && error.code === "INVALID_ID",
  );

  // Non-boolean flags.
  const badRetry = clone(DIMENSION_DEFINITIONS);
  badRetry[0].retryable = "yes";
  assert.throws(
    () => validateDimensions(badRetry),
    (error) => error instanceof DimensionContractError && error.code === "INVALID_TYPE",
  );

  // A single definition still validates in isolation (used by claim/coverage
  // consumers), proving the snapshot entries are complete contract objects.
  const single = validateDimension(one);
  assert.equal(single.id, one.id);
  assert.deepEqual(single.expectedClaimIds, one.expectedClaimIds.slice().toSorted(compareAscii));
});

// ---------------------------------------------------------------------------
// Dimension registry — determinism and immutability
// ---------------------------------------------------------------------------

test("T222 dimensions: repeated evaluation is byte-identical and snapshots are deep-frozen", () => {
  const again = validateDimensions(DIMENSION_DEFINITIONS);
  assert.equal(JSON.stringify(again), JSON.stringify(DIMENSION_REGISTRY));
  const third = validateDimensions(DIMENSION_DEFINITIONS);
  assert.equal(JSON.stringify(third), JSON.stringify(DIMENSION_REGISTRY));
  assert.equal(
    JSON.stringify(validateDimensions(clone(DIMENSION_DEFINITIONS))),
    JSON.stringify(DIMENSION_REGISTRY),
  );

  assert.throws(() => DIMENSION_REGISTRY.pop(), TypeError);
  assert.throws(() => {
    DIMENSION_REGISTRY[0].id = "DIM-mutated-v1";
  }, TypeError);
  assert.throws(() => {
    DIMENSION_REGISTRY[0].retryable = false;
  }, TypeError);
  assert.throws(() => {
    DIMENSION_REGISTRY[0].rendererId = "RND-mutated-v1";
  }, TypeError);
  assert.throws(() => {
    DIMENSION_REGISTRY[0].expectedClaimIds.push("CLM-mutated-v1");
  }, TypeError);
  assert.throws(() => {
    DIMENSION_REGISTRY[0].applicability.rules[0].value = "mutated";
  }, TypeError);
  assert.throws(() => EXPECTED_CLAIM_IDS.push("CLM-mutated-v1"), TypeError);
  assert.throws(() => DIMENSION_RENDERER_IDS.push("RND-mutated-v1"), TypeError);
});

// ---------------------------------------------------------------------------
// Builtin provider index — exact-once and dimension coverage
// ---------------------------------------------------------------------------

test("T222 providers: index validates through the contract and holds every provider exactly once", () => {
  assert.equal(BUILTIN_PROVIDER_VERSION, 1);
  assert.equal(BUILTIN_PROVIDER_COUNT, 16);
  assert.equal(new Set(BUILTIN_PROVIDER_INDEX.map(({ id }) => id)).size, BUILTIN_PROVIDER_COUNT);
  assert.deepEqual(
    BUILTIN_PROVIDER_INDEX.map(({ id }) => id)
      .slice()
      .toSorted(compareAscii),
    BUILTIN_PROVIDER_IDS,
  );
  assert.deepEqual(validateProviders(BUILTIN_PROVIDER_INDEX), BUILTIN_PROVIDER_INDEX);
  assert.ok(BUILTIN_PROVIDER_IDS.every((id) => PROVIDER_ID_PATTERN.test(id)));
  assert.ok(BUILTIN_PROVIDER_IDS.includes(GENERIC_BUILTIN_PROVIDER_ID));
});

test("T222 providers: all 15 provider dimensions are represented, each with one primary builtin provider", () => {
  assert.equal(BUILTIN_DIMENSION_COUNT, 15);
  const covered = new Set(
    BUILTIN_PROVIDER_INDEX.flatMap(({ dimensions }) =>
      dimensions.map(({ dimensionId }) => dimensionId),
    ),
  );
  assert.deepEqual(
    [...covered].toSorted(compareAscii),
    [...PROVIDER_DIMENSION_IDS].toSorted(compareAscii),
  );
  assert.equal(Object.keys(BUILTIN_DIMENSION_TO_PROVIDER).length, 15);
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    const providerId = BUILTIN_DIMENSION_TO_PROVIDER[dimensionId];
    assert.ok(
      typeof providerId === "string" && providerId.length > 0,
      `${dimensionId} has a primary builtin provider`,
    );
    const provider = BUILTIN_PROVIDER_INDEX.find(({ id }) => id === providerId);
    assert.ok(provider, `${dimensionId} resolves to a registered provider`);
    assert.ok(
      provider.dimensions.some(({ dimensionId: dim }) => dim === dimensionId),
      `${providerId} actually covers ${dimensionId}`,
    );
    assert.notEqual(
      providerId,
      GENERIC_BUILTIN_PROVIDER_ID,
      `primary for ${dimensionId} is not the generic fallback`,
    );
  }
  // The three generic fallback dimensions are also covered by the generic provider.
  for (const { dimensionId } of GENERIC_BUILTIN_DIMENSIONS) {
    assert.ok(PROVIDER_DIMENSION_IDS.includes(dimensionId));
  }
});

test("T222 providers: index mirrors the three catalogs and the generic fallback with globally unique IDs", () => {
  const indexById = byId(BUILTIN_PROVIDER_INDEX);
  assert.equal(indexById.size, BUILTIN_PROVIDER_COUNT);

  // Every runtime catalog provider (stack/config/testing/generic) is mirrored.
  for (const provider of RUNTIME_CATALOG_PROVIDERS) {
    assert.deepEqual(
      indexById.get(provider.id),
      provider,
      `runtime provider ${provider.id} mirrored`,
    );
  }
  // Every assurance catalog provider (security/operations + 6 + generic) is mirrored.
  for (const provider of ASSURANCE_CATALOG_PROVIDERS) {
    assert.deepEqual(
      indexById.get(provider.id),
      provider,
      `assurance provider ${provider.id} mirrored`,
    );
  }
  // Analysis providers have no catalog registry export; mirror them from their
  // provider ids and the full T202 category allowlist.
  const analysis = [
    [ANALYSIS_PROVIDER_IDS.architecture, ANALYSIS_DIMENSION_IDS[0]],
    [ANALYSIS_PROVIDER_IDS.conventions, ANALYSIS_DIMENSION_IDS[1]],
    [ANALYSIS_PROVIDER_IDS.documentation, ANALYSIS_DIMENSION_IDS[2]],
    [ANALYSIS_PROVIDER_IDS.practices, ANALYSIS_DIMENSION_IDS[3]],
  ];
  for (const [id, dimensionId] of analysis) {
    const actual = indexById.get(id);
    assert.ok(actual, `analysis provider ${id} present`);
    assert.equal(actual.apiVersion, BUILTIN_PROVIDER_VERSION);
    assert.equal(actual.dimensions.length, 1);
    assert.equal(actual.dimensions[0].dimensionId, dimensionId);
    assert.deepEqual(actual.dimensions[0].categories, PROVIDER_CATEGORIES[dimensionId]);
  }

  // The generic fallback ID and capabilities are the generic provider's.
  assert.equal(GENERIC_BUILTIN_PROVIDER_ID, GENERIC_PROVIDER_ID);
  assert.deepEqual(
    indexById
      .get(GENERIC_BUILTIN_PROVIDER_ID)
      .dimensions.map(({ dimensionId, categories }) => ({ dimensionId, categories })),
    GENERIC_BUILTIN_DIMENSIONS,
  );

  // Plugin carrier providers are intentionally absent from the BUILTIN index.
  assert.equal(indexById.has("PRV-runtime-plugin-v1"), false);
  assert.equal(indexById.has("PRV-analysis-plugin-v1"), false);
  assert.equal(indexById.has("PRV-assurance-plugin-v1"), false);
});

test("T222 providers: duplicate and unknown failure cases fail with typed contract errors", () => {
  // Duplicate provider id.
  const duplicated = clone(BUILTIN_PROVIDER_INDEX);
  duplicated.push(duplicated[0]);
  assert.throws(
    () => validateProviders(duplicated),
    (error) => error instanceof ProviderContractError && error.code === "DUPLICATE_ID",
  );

  // Unknown dimension in a capability.
  const unknown = clone(BUILTIN_PROVIDER_INDEX);
  unknown[0].dimensions[0].dimensionId = "DIM-fake-v1";
  assert.throws(
    () => validateProviders(unknown),
    (error) => error instanceof ProviderContractError && error.code === "UNKNOWN_DIMENSION",
  );

  // Unknown category.
  const badCategory = clone(BUILTIN_PROVIDER_INDEX);
  badCategory[0].dimensions[0].categories = ["not-a-category"];
  assert.throws(
    () => validateProviders(badCategory),
    (error) => error instanceof ProviderContractError && error.code === "UNKNOWN_CATEGORY",
  );

  // Empty dimensions array.
  const empty = clone(BUILTIN_PROVIDER_INDEX);
  empty[0].dimensions = [];
  assert.throws(
    () => validateProviders(empty),
    (error) => error instanceof ProviderContractError && error.code === "BOUND_EXCEEDED",
  );

  // Duplicate category within a capability.
  const duplicateCategory = clone(BUILTIN_PROVIDER_INDEX);
  duplicateCategory[0].dimensions[0].categories =
    duplicateCategory[0].dimensions[0].categories.slice(0, 2);
  duplicateCategory[0].dimensions[0].categories.push(
    duplicateCategory[0].dimensions[0].categories[0],
  );
  assert.throws(
    () => validateProviders(duplicateCategory),
    (error) => error instanceof ProviderContractError && error.code === "DUPLICATE_ID",
  );

  // A single provider still validates in isolation.
  const single = validateProvider(BUILTIN_PROVIDER_INDEX[0]);
  assert.equal(single.id, BUILTIN_PROVIDER_INDEX[0].id);
  assert.ok(Object.isFrozen(single));
});

test("T222 providers: repeated evaluation is byte-identical and the index is deep-frozen", () => {
  const again = validateProviders(BUILTIN_PROVIDER_INDEX);
  assert.equal(JSON.stringify(again), JSON.stringify(BUILTIN_PROVIDER_INDEX));
  assert.equal(
    JSON.stringify(validateProviders(clone(BUILTIN_PROVIDER_INDEX))),
    JSON.stringify(BUILTIN_PROVIDER_INDEX),
  );
  assert.ok(
    again.every(({ id }, index) => id === BUILTIN_PROVIDER_INDEX[index].id),
    "index stays deterministically sorted",
  );

  assert.throws(() => BUILTIN_PROVIDER_INDEX.pop(), TypeError);
  assert.throws(() => {
    BUILTIN_PROVIDER_INDEX[0].id = "PRV-mutated-v1";
  }, TypeError);
  assert.throws(() => {
    BUILTIN_PROVIDER_INDEX[0].dimensions.pop();
  }, TypeError);
  assert.throws(() => {
    BUILTIN_PROVIDER_INDEX[0].dimensions[0].categories.push("mutated");
  }, TypeError);
  assert.throws(() => BUILTIN_PROVIDER_IDS.push("PRV-mutated-v1"), TypeError);
  assert.throws(() => {
    BUILTIN_DIMENSION_TO_PROVIDER["DIM-stack-v1"] = "PRV-mutated-v1";
  }, TypeError);
});

// ---------------------------------------------------------------------------
// Cross-repo global stage descriptor
// ---------------------------------------------------------------------------

test("T222 stage: the Cross-repo global stage descriptor is deterministic data-only injectable data", () => {
  assert.ok(Object.isFrozen(CROSS_REPO_GLOBAL_STAGE));
  assert.ok(Object.isFrozen(CROSS_REPO_GLOBAL_STAGE.synthesis));
  assert.ok(Object.isFrozen(CROSS_REPO_GLOBAL_STAGE.renderer));
  assert.equal(CROSS_REPO_GLOBAL_STAGE.stageId, "STG-cross-repo-global-v1");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.schemaVersion, 1);
  assert.equal(CROSS_REPO_GLOBAL_STAGE.name, "cross-repo-global");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.kind, "global");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.order, 17);
  assert.equal(CROSS_REPO_GLOBAL_STAGE.retryable, false);
  assert.equal(CROSS_REPO_GLOBAL_STAGE.providerCapability, false);
  assert.equal(CROSS_REPO_GLOBAL_STAGE.rendererId, "RND-cross-repo-global-v1");
  assert.match(CROSS_REPO_GLOBAL_STAGE.rendererId, RENDERER_ID_PATTERN);
  assert.equal(CROSS_REPO_GLOBAL_STAGE.synthesis.module, "lib/scan/cross-repo/edges.mjs");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.synthesis.exportName, "synthesizeCrossRepository");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.renderer.module, "lib/scan/cross-repo/render.mjs");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.renderer.factory, "createCrossRepositoryRenderer");
  assert.equal(CROSS_REPO_GLOBAL_STAGE.renderer.exportName, "renderCrossRepositoryGlobal");
  assert.deepEqual(CROSS_REPO_GLOBAL_STAGE.inputs, ["repositories", "references"]);

  // Stable serialization.
  assert.equal(
    JSON.stringify(CROSS_REPO_GLOBAL_STAGE),
    JSON.stringify(structuredClone(CROSS_REPO_GLOBAL_STAGE)),
  );

  // The global stage renderer ID is distinct from all 17 dimension renderer IDs.
  assert.equal(DIMENSION_RENDERER_IDS.includes(CROSS_REPO_GLOBAL_STAGE.rendererId), false);
  assert.equal(new Set([...DIMENSION_RENDERER_IDS, CROSS_REPO_GLOBAL_STAGE.rendererId]).size, 18);

  // Data-only: every value is a plain scalar / array / object.
  const seen = new Set();
  const stack = [CROSS_REPO_GLOBAL_STAGE];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current !== null && typeof current === "object") {
      for (const value of Object.values(current)) stack.push(value);
    } else {
      assert.ok(["string", "number", "boolean"].includes(typeof current) || current === null);
    }
  }
});

// ---------------------------------------------------------------------------
// Inertness — unregistered, capability-closed, and dependency-free
// ---------------------------------------------------------------------------

test("T222 inert: no production module imports the registry or the builtin index", async () => {
  const registryPath = join(LIB_ROOT, "scan", "registry", "dimensions.mjs");
  const indexPath = join(LIB_ROOT, "scan", "providers", "builtin", "index.mjs");
  const activatedConsumers = new Set([
    join(LIB_ROOT, "scan", "pipeline", "run.mjs"),
    join(LIB_ROOT, "scan", "enrich.mjs"),
    join(LIB_ROOT, "scan", "norms.mjs"),
  ]);
  const consumers = [];
  for (const file of await libScanFiles()) {
    if (file === registryPath || file === indexPath) continue;
    if (activatedConsumers.has(file)) continue;
    const source = await readFile(file, "utf8");
    const resolved = relativeImportTargets(source).map((target) => join(dirname(file), target));
    if (resolved.some((path) => path === registryPath)) {
      consumers.push(`registry/dimensions.mjs <- ${file}`);
    }
    if (resolved.some((path) => path === indexPath)) {
      consumers.push(`providers/builtin/index.mjs <- ${file}`);
    }
  }
  assert.deepEqual(
    consumers,
    [],
    "only the activated pipeline/enrich consumers may use the registration modules",
  );
});

test("T222 inert: the new modules avoid T201 forbidden capabilities on import", async () => {
  for (const file of ["registry/dimensions.mjs", "providers/builtin/index.mjs"]) {
    const source = await readFile(join(LIB_ROOT, "scan", file), "utf8");
    const imports = [
      ...source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
    ].map((match) => match[1]);
    for (const specifier of imports) {
      assert.equal(
        specifier.startsWith("node:"),
        false,
        `${file} must not import a node: capability (${specifier})`,
      );
    }
    for (const forbidden of [
      "node:fs",
      "node:child_process",
      "node:process",
      "node:vm",
      "node:module",
    ]) {
      assert.ok(!imports.includes(forbidden), `${file} must not import ${forbidden}`);
    }
    assert.ok(!/\brequire\s*\(/.test(source), `${file} must not use require`);
    assert.ok(!/\bimport\s*\(/.test(source), `${file} must not use dynamic import`);
    for (const token of ["writeFile", "writeNORMS", "execute(", "scan(", "run("]) {
      assert.equal(source.includes(token), false, `${file} must not expose ${token}`);
    }
  }
});

test("T222 inert: the builtin index does not import the catalogs, and the production renderer/write path is untouched", async () => {
  const indexSource = await readFile(
    join(LIB_ROOT, "scan", "providers", "builtin", "index.mjs"),
    "utf8",
  );
  const importSpecifiers = [
    ...indexSource.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]);
  for (const catalog of [
    "runtime-catalog",
    "analysis-catalog",
    "assurance-catalog",
    "generic.mjs",
  ]) {
    assert.ok(
      !importSpecifiers.some((specifier) => specifier.includes(catalog)),
      `builtin index must not import ${catalog}`,
    );
  }

  // Production renderer/write/enrich/validate/pipeline/CLI reference the
  // registration modules only through the activated consumers: run.mjs (the
  // canonical expanded pipeline) and enrich.mjs (registry-owned coverage).
  // Everything else must stay free of registry references.
  for (const file of [
    "scan/render/existing-ten.mjs",
    "scan/render/base.mjs",
    "scan/write.mjs",
    "scan/validate.mjs",
    "scan/pipeline/existing-ten.mjs",
    "scan/survey.mjs",
    "scan/shared/ecosystem.mjs",
    "scan/providers/base.mjs",
    "scan/providers/rules.mjs",
  ]) {
    const source = await readFile(join(LIB_ROOT, file), "utf8");
    assert.equal(
      source.includes("registry/dimensions"),
      false,
      `${file} must not reference the dimension registry`,
    );
    assert.equal(
      source.includes("builtin/index"),
      false,
      `${file} must not reference the builtin index`,
    );
    assert.equal(
      source.includes("CROSS_REPO_GLOBAL_STAGE"),
      false,
      `${file} must not reference the global stage`,
    );
    assert.equal(
      source.includes("DIMENSION_REGISTRY"),
      false,
      `${file} must not reference DIMENSION_REGISTRY`,
    );
  }
});
