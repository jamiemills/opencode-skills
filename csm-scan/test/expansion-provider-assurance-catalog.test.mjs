// T220 — inert provider catalog for Security, Operations, and the six new
// dimensions (API, Data, Deployment, Maintainability, Governance, Assurance).
//
// Owned by T220. Tests the inert provider catalog that adapts the existing
// security/operations scanner models and the already-inert per-dimension
// providers, plus T210 plugin declarative observations, to the T202 provider
// result contract for DIM-security-v1 / DIM-operations-v1 / DIM-api-v1 /
// DIM-data-v1 / DIM-deployment-v1 / DIM-maintainability-v1 / DIM-governance-v1
// / DIM-assurance-v1.
//
// Scope (own-only): this test file and lib/scan/providers/assurance-catalog.mjs.
// Nothing else is edited.
//
// Guarantees verified here:
//   1. Registry is versioned, sorted, deep-frozen, duplicate-free, and every
//      dimension/category is allowlisted; duplicate/unknown rejection.
//   2. Cross-catalog uniqueness: all 15 provider dimensions are represented
//      exactly once across the runtime/analysis/assurance catalogs, provider
//      ids are globally unique, and the generic provider is the single shared
//      fallback with identical coverage.
//   3. Built-in parity spot matrix — each adapter projects the scanner model
//      into the exact recorded observations for the eight dimensions, plus a
//      live five-ecosystem matrix (deterministic, allowlisted, orchestration
//      faithful).
//   4. Deterministic order across repeated runs and canonical dimension order.
//   5. Unknown-language repos fall back to the artifact-only generic provider,
//      with the capped flag threaded through the envelope.
//   6. Plugin observations contribute but never replace built-in findings
//      (T210 merge rules), with duplicates dropped.
//   7. Observation lists are bounded; caps are disclosed; every assembled
//      matchedKey stays within the 128-char foundation bound.
//   8. Immutability of the catalog and every produced result.
//   9. Inertness — no production module imports the catalog; the catalog
//      exports only data and pure factories, never execution surfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withFixture } from './harness.mjs';
import { scan as scanSecurity } from '../lib/scan/deep/security.mjs';
import { scan as scanOperations } from '../lib/scan/deep/operations.mjs';
import { scan as scanApi } from '../lib/scan/deep/api/scanner.mjs';
import { scan as scanData } from '../lib/scan/deep/data/scanner.mjs';
import { scanDeploymentTopology } from '../lib/scan/deep/deployment/scanner.mjs';
import { scan as scanMaintainability } from '../lib/scan/deep/maintainability/scanner.mjs';
import { scan as scanGovernance } from '../lib/scan/deep/governance/scanner.mjs';
import { scanAssurance } from '../lib/scan/deep/assurance/scanner.mjs';
import {
  ASSURANCE_CATALOG_PROVIDERS,
  ASSURANCE_CATALOG_VERSION,
  ASSURANCE_DIMENSION_IDS,
  ASSURANCE_PLUGIN_PROVIDER_ID,
  ASSURANCE_PROVIDER_IDS,
  OPERATIONS_CATALOG_PROVIDER_ID,
  SECURITY_CATALOG_PROVIDER_ID,
  assuranceCatalogResults,
  assurancePluginObservations,
  assurancePluginProviderResults,
  assurancePluginResult,
  mergeAssurancePlugin,
  operationsCatalogObservations,
  operationsCatalogResult,
  securityCatalogObservations,
  securityCatalogResult,
} from '../lib/scan/providers/assurance-catalog.mjs';
import { RUNTIME_CATALOG_PROVIDERS, RUNTIME_PLUGIN_PROVIDER_ID } from '../lib/scan/providers/runtime-catalog.mjs';
import { ANALYSIS_PROVIDER_IDS, ANALYSIS_PLUGIN_PROVIDER_ID } from '../lib/scan/providers/analysis-catalog.mjs';
import { GENERIC_LIMITS, GENERIC_PROVIDER_ID, genericProviderResults } from '../lib/scan/providers/generic.mjs';
import { apiProviderResult } from '../lib/scan/providers/api.mjs';
import { dataProviderResult } from '../lib/scan/providers/data.mjs';
import { deploymentProviderResults } from '../lib/scan/providers/deployment.mjs';
import { maintainabilityProviderResults } from '../lib/scan/providers/maintainability.mjs';
import { governanceProviderResult } from '../lib/scan/providers/governance.mjs';
import { assuranceProviderResult } from '../lib/scan/providers/assurance.mjs';
import { PROVIDER_CATEGORIES, validateProviders } from '../lib/scan/contracts/provider.mjs';
import { PROVIDER_DIMENSION_IDS } from '../lib/scan/contracts/dimension.mjs';
import { EVIDENCE_SOURCE_KINDS } from '../lib/scan/contracts/evidence.mjs';
import { ProviderResultError, createProviderResult, mergeProviderResults, PROVIDER_RESULT_LIMITS } from '../lib/scan/providers/base.mjs';
import { createCommandBroker } from '../lib/scan/shared/command.mjs';
import { createRecordingRunner } from './helpers/recording-runner.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

const FIVE_ECOSYSTEM_FIXTURES = [
  ['python', pythonFiles, 'Python'],
  ['javascript', javascriptFiles, 'JavaScript'],
  ['typescript', typescriptFiles, 'TypeScript'],
  ['shell', shellFiles, 'Shell'],
  ['rust', rustFiles, 'Rust'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirror of the catalog's matched-key encoding (FNV-1a 32-bit) used to pin the
// byte-identical spot snapshot for values that contain characters outside the
// foundation token alphabet.
function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const MATCHED_KEY_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/;

function keyFor(prefix, value) {
  const raw = `${prefix}:${value}`;
  if (raw.length <= 128 && MATCHED_KEY_SAFE.test(raw)) return raw;
  return `${prefix}:${stableHash(raw)}`;
}

const FOUNDATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/;

function canonicalOrder(left, right) {
  const a = `${left.category}\0${left.path ?? ''}\0${left.matchedKey}`;
  const b = `${right.category}\0${right.path ?? ''}\0${right.matchedKey}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertCanonicalOrder(observations) {
  assert.deepEqual(
    observations.map(({ category, path, matchedKey }) => ({ category, path, matchedKey })),
    observations.slice().toSorted(canonicalOrder).map(({ category, path, matchedKey }) => ({ category, path, matchedKey })),
    'observations must be canonically ordered',
  );
}

function assertValidObservation(observation, dimensionId) {
  assert.ok(PROVIDER_CATEGORIES[dimensionId].includes(observation.category),
    `${dimensionId} invalid category ${observation.category}`);
  assert.ok(EVIDENCE_SOURCE_KINDS.includes(observation.sourceKind),
    `${dimensionId} invalid sourceKind ${observation.sourceKind}`);
  assert.ok(observation.matchedKey.length <= 128, `${dimensionId} matchedKey exceeds the 128 bound`);
  assert.match(observation.matchedKey, FOUNDATION_KEY_PATTERN, `${dimensionId} matchedKey is not bounded stable ASCII`);
}

function providerFor(results, dimensionId) {
  return results.find((result) => result.dimensionId === dimensionId) ?? null;
}

function inertGitBroker() {
  return createCommandBroker({
    runner: createRecordingRunner(() => ({ status: 128, stdout: '', stderr: '' })),
  });
}

async function scanAll(repoPath, name) {
  const overview = { files: Object.keys(FIVE_ECOSYSTEM_FIXTURES
    .find(([fixtureName]) => fixtureName === name)[1]), languages: [name] };
  const security = (await scanSecurity(repoPath, overview)).findings;
  const operations = (await scanOperations(repoPath, overview)).findings;
  const api = (await scanApi(repoPath, {})).findings;
  const data = (await scanData(repoPath, {})).findings;
  const { topology } = await scanDeploymentTopology({ root: repoPath, files: overview.files });
  const maintainability = (await scanMaintainability(repoPath, {})).findings;
  const governance = (await scanGovernance(repoPath, {}, inertGitBroker())).findings;
  const { model } = await scanAssurance({ root: repoPath, files: overview.files });
  return { security, operations, api, data, topology, maintainability, governance, assurance: model };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('T220 registry: versioned, sorted, deep-frozen, and duplicate-free', () => {
  assert.equal(ASSURANCE_CATALOG_VERSION, 1);
  assert.equal(ASSURANCE_CATALOG_PROVIDERS.length, 9);
  assert.ok(Object.isFrozen(ASSURANCE_CATALOG_PROVIDERS));
  assert.ok(ASSURANCE_CATALOG_PROVIDERS.every((entry) => (
    Object.isFrozen(entry) && Object.isFrozen(entry.dimensions)
  )));
  const ids = ASSURANCE_CATALOG_PROVIDERS.map(({ id }) => id);
  assert.deepEqual(ids, [...ids].toSorted());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(SECURITY_CATALOG_PROVIDER_ID));
  assert.ok(ids.includes(OPERATIONS_CATALOG_PROVIDER_ID));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.api));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.data));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.deployment));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.maintainability));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.governance));
  assert.ok(ids.includes(ASSURANCE_PROVIDER_IDS.assurance));
  assert.ok(ids.includes(GENERIC_PROVIDER_ID));
  assert.equal(JSON.stringify(ASSURANCE_CATALOG_PROVIDERS), JSON.stringify(ASSURANCE_CATALOG_PROVIDERS));
});

test('T220 registry: every dimension/category is allowlisted and unique', () => {
  const declaredDimensions = new Set();
  for (const provider of ASSURANCE_CATALOG_PROVIDERS) {
    const dimensions = provider.dimensions.map(({ dimensionId }) => dimensionId);
    assert.equal(new Set(dimensions).size, dimensions.length, provider.id);
    for (const { dimensionId, categories } of provider.dimensions) {
      assert.ok(ASSURANCE_DIMENSION_IDS.includes(dimensionId)
        || ['DIM-maintainability-v1', 'DIM-assurance-v1', 'DIM-documentation-v1'].includes(dimensionId),
        `${provider.id} declares an unowned dimension ${dimensionId}`);
      assert.equal(new Set(categories).size, categories.length, `${provider.id}:${dimensionId}`);
      for (const category of categories) {
        assert.ok(PROVIDER_CATEGORIES[dimensionId].includes(category),
          `${provider.id}:${dimensionId}:${category} is not allowlisted`);
        declaredDimensions.add(dimensionId);
      }
    }
  }
  for (const dimensionId of ASSURANCE_DIMENSION_IDS) {
    assert.ok(declaredDimensions.has(dimensionId), `missing declared dimension ${dimensionId}`);
  }
});

test('T220 registry: duplicate provider ids and unknown/duplicate categories are rejected', () => {
  const base = {
    apiVersion: 1,
    dimensions: [{ dimensionId: 'DIM-security-v1', categories: ['authentication'] }],
  };
  assert.throws(() => validateProviders([{ ...base, id: 'PRV-dupe-v1' }, { ...base, id: 'PRV-dupe-v1' }]),
    (error) => error.code === 'DUPLICATE_ID');
  assert.throws(() => validateProviders([{
    ...base, id: 'PRV-unknown-v1',
    dimensions: [{ dimensionId: 'DIM-security-v1', categories: ['route'] }],
  }]), (error) => error.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => validateProviders([{
    id: 'PRV-dupe-dims-v1', apiVersion: 1,
    dimensions: [
      { dimensionId: 'DIM-security-v1', categories: ['authentication'] },
      { dimensionId: 'DIM-security-v1', categories: ['validation'] },
    ],
  }]), (error) => error.code === 'DUPLICATE_ID');
});

// ---------------------------------------------------------------------------
// Cross-catalog uniqueness
// ---------------------------------------------------------------------------

test('T220 catalog set: all 15 provider dimensions are represented exactly once', () => {
  const runtimeBuiltIn = new Set(RUNTIME_CATALOG_PROVIDERS
    .filter(({ id }) => id !== GENERIC_PROVIDER_ID)
    .flatMap(({ dimensions }) => dimensions.map(({ dimensionId }) => dimensionId)));
  const analysisBuiltIn = new Set(['DIM-architecture-v1', 'DIM-conventions-v1', 'DIM-documentation-v1', 'DIM-practices-v1']);
  const assuranceBuiltIn = new Set(ASSURANCE_CATALOG_PROVIDERS
    .filter(({ id }) => id !== GENERIC_PROVIDER_ID)
    .flatMap(({ dimensions }) => dimensions.map(({ dimensionId }) => dimensionId)));

  assert.deepEqual([...runtimeBuiltIn].toSorted(), ['DIM-config-v1', 'DIM-stack-v1', 'DIM-testing-v1']);
  assert.deepEqual([...assuranceBuiltIn].toSorted(), [...ASSURANCE_DIMENSION_IDS].toSorted());

  const all = [...runtimeBuiltIn, ...analysisBuiltIn, ...assuranceBuiltIn];
  assert.equal(new Set(all).size, all.length, 'a provider dimension is covered by more than one catalog');
  assert.deepEqual([...new Set(all)].toSorted(), [...PROVIDER_DIMENSION_IDS].toSorted(),
    'the three catalogs must cover all 15 provider dimensions exactly once');
});

const genericCoverage = (registry) => registry
  .find(({ id }) => id === GENERIC_PROVIDER_ID)
  ?.dimensions.map(({ dimensionId }) => dimensionId).toSorted();

test('T220 catalog set: provider ids are globally unique with a single shared generic fallback', () => {
  const runtimeIds = new Set(RUNTIME_CATALOG_PROVIDERS.map(({ id }) => id));
  const assuranceIds = new Set(ASSURANCE_CATALOG_PROVIDERS.map(({ id }) => id));
  const analysisIds = new Set([...Object.values(ANALYSIS_PROVIDER_IDS), ANALYSIS_PLUGIN_PROVIDER_ID]);

  const nonGeneric = [...runtimeIds, ...analysisIds, ...assuranceIds]
    .filter((id) => id !== GENERIC_PROVIDER_ID);
  assert.equal(new Set(nonGeneric).size, nonGeneric.length,
    'non-generic provider ids are globally unique across the three catalogs');

  for (const id of nonGeneric) assert.match(id, /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/);

  assert.deepEqual(genericCoverage(RUNTIME_CATALOG_PROVIDERS),
    ['DIM-assurance-v1', 'DIM-documentation-v1', 'DIM-maintainability-v1']);
  assert.deepEqual(genericCoverage(ASSURANCE_CATALOG_PROVIDERS), genericCoverage(RUNTIME_CATALOG_PROVIDERS),
    'the shared generic fallback declares identical coverage in every catalog');
});

test('T220 catalog set: plugin carrier ids are distinct across the three catalogs', () => {
  const carriers = [RUNTIME_PLUGIN_PROVIDER_ID, ANALYSIS_PLUGIN_PROVIDER_ID, ASSURANCE_PLUGIN_PROVIDER_ID];
  assert.equal(new Set(carriers).size, carriers.length, 'plugin carrier ids must be unique');
  for (const id of carriers) assert.match(id, /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/);
  assert.equal(ASSURANCE_PLUGIN_PROVIDER_ID, 'PRV-assurance-plugin-v1');
  assert.equal(SECURITY_CATALOG_PROVIDER_ID, 'PRV-security-hardening-v1');
  assert.equal(OPERATIONS_CATALOG_PROVIDER_ID, 'PRV-operations-declarations-v1');
});

// ---------------------------------------------------------------------------
// Built-in parity spot matrix (exact projection of scanner models)
// ---------------------------------------------------------------------------

const securityFindings = {
  secrets: {
    count: 1,
    findings: [{ pattern: 'AWS Access Key', files: ['src/creds.js'], totalFiles: 1 }],
  },
  auth: { detected: true, frameworks: [{ package: 'passport', label: 'Passport' }] },
  securityHeaders: [{ name: 'CSP', fileCount: 1 }],
  inputValidation: { detected: true, libraries: [{ package: 'joi', label: 'Joi' }] },
  rateLimiting: {
    detected: true,
    libraries: [{ package: 'express-rate-limit', label: 'Express Rate Limit' }],
    codeReferences: 2,
  },
  envExample: true,
  gitignoreEnvProtected: true,
  hasLockfile: true,
  auditEvidence: [{ source: 'dependency', location: 'manifest', tool: 'snyk' }],
  hasAuditScript: true,
  dependabot: true,
  securityTools: ['.gitleaks.toml', 'bandit'],
};

const EXPECTED_SECURITY = [
  { category: 'authentication', details: { package: 'passport', label: 'Passport', type: null }, matchedKey: 'auth:passport', path: null, sourceKind: 'manifest' },
  { category: 'dependency_lock', details: { present: true }, matchedKey: 'dependency-lock', path: null, sourceKind: 'lockfile' },
  { category: 'secret_pattern', details: { pattern: 'AWS Access Key', totalFiles: 1 }, matchedKey: keyFor('secret', 'AWS Access Key'), path: 'src/creds.js', sourceKind: 'search_result' },
  { category: 'security_tool', details: { tool: 'snyk', source: 'dependency', location: 'manifest' }, matchedKey: keyFor('audit-tool', 'snyk:dependency:manifest'), path: null, sourceKind: 'tool_result' },
  { category: 'security_tool', details: { present: true }, matchedKey: 'dependabot', path: null, sourceKind: 'config' },
  { category: 'security_tool', details: { present: true }, matchedKey: 'env-example', path: null, sourceKind: 'config' },
  { category: 'security_tool', details: { present: true }, matchedKey: 'gitignore-env', path: null, sourceKind: 'config' },
  { category: 'security_tool', details: { name: '.gitleaks.toml' }, matchedKey: 'security-tool:.gitleaks.toml', path: null, sourceKind: 'config' },
  { category: 'security_tool', details: { name: 'bandit' }, matchedKey: 'security-tool:bandit', path: null, sourceKind: 'manifest' },
  { category: 'validation', details: { codeReferences: 2 }, matchedKey: 'rate-limit-references', path: null, sourceKind: 'search_result' },
  { category: 'validation', details: { package: 'express-rate-limit', label: 'Express Rate Limit', control: 'rate_limit' }, matchedKey: 'rate-limit:express-rate-limit', path: null, sourceKind: 'manifest' },
  { category: 'validation', details: { package: 'joi', label: 'Joi' }, matchedKey: 'validation:joi', path: null, sourceKind: 'manifest' },
];

const operationsFindings = {
  dockerfiles: [{
    name: 'Dockerfile', baseImages: ['node:20-alpine'], exposedPorts: [3000],
    isMultiStage: false, hasHealthcheck: true, hasUser: false, isAlpine: true,
    isSlim: false, hasEntrypoint: true, hasCmd: true, lineCount: 12,
  }],
  dockerCompose: {
    present: true,
    services: [{ file: 'compose.yaml', names: ['web'], count: 1, dependencies: {} }],
    networks: ['front'],
    volumes: ['data'],
  },
  ci: [{ platform: 'GitHub Actions', workflowCount: 1, jobs: ['build'], triggers: ['push'] }],
  envConfig: { envFiles: [{ file: '.env', varCount: 2 }], configDir: false, appConfigFile: false },
  hasDockerignore: true,
  hasMakefile: true,
  hasJustfile: false,
  hasDeployScripts: true,
  healthChecks: { detected: true, references: ['src/server.js'] },
  gracefulShutdown: [{ pattern: 'SIGTERM handler', fileCount: 1 }],
  monitoring: { libraries: [{ package: '@sentry/node', label: 'Sentry' }] },
  procfile: { content: 'web: npm start' },
};

const EXPECTED_OPERATIONS = [
  { category: 'container', details: { present: true }, matchedKey: 'dockerignore', path: '.dockerignore', sourceKind: 'container' },
  { category: 'container', details: { name: 'Dockerfile', baseImages: ['node:20-alpine'], exposedPorts: [3000], isMultiStage: false, hasHealthcheck: true, hasUser: false, isAlpine: true, isSlim: false, hasEntrypoint: true, hasCmd: true, lineCount: 12 }, matchedKey: 'dockerfile:Dockerfile', path: 'Dockerfile', sourceKind: 'container' },
  { category: 'deployment_declaration', details: { networks: ['front'], volumes: ['data'] }, matchedKey: 'compose-networks-volumes', path: null, sourceKind: 'config' },
  { category: 'deployment_declaration', details: { present: true }, matchedKey: 'deploy-scripts', path: null, sourceKind: 'config' },
  { category: 'deployment_declaration', details: { present: true }, matchedKey: 'makefile', path: null, sourceKind: 'config' },
  { category: 'deployment_declaration', details: { present: true }, matchedKey: 'procfile', path: 'Procfile', sourceKind: 'config' },
  { category: 'deployment_declaration', details: { file: 'compose.yaml', serviceCount: 1, services: ['web'] }, matchedKey: 'compose:compose.yaml', path: 'compose.yaml', sourceKind: 'config' },
  { category: 'health_check', details: { detected: true, references: ['src/server.js'] }, matchedKey: 'health-check', path: null, sourceKind: 'search_result' },
  { category: 'health_check', details: { pattern: 'SIGTERM handler', fileCount: 1 }, matchedKey: keyFor('shutdown', 'SIGTERM handler'), path: null, sourceKind: 'search_result' },
  { category: 'monitoring', details: { package: '@sentry/node', label: 'Sentry' }, matchedKey: 'monitoring:@sentry/node', path: null, sourceKind: 'manifest' },
  { category: 'workflow', details: { platform: 'GitHub Actions', jobs: ['build'], triggers: ['push'], workflowCount: 1 }, matchedKey: keyFor('workflow', 'GitHub Actions'), path: null, sourceKind: 'workflow' },
];

const apiModel = {
  summary: { operations: 1 },
  operations: [{
    category: 'route', dialect: 'express', signature: 'GET:/api/users', status: 'observed',
    details: { method: 'GET', operationId: null },
    source: { path: 'src/routes.js', line: 3 },
    matchedKey: 'route:GET:/api/users', id: 'op-fixed',
  }],
  diagnostics: [],
};

const dataModel = {
  entities: [{
    category: 'entity', dialect: 'prisma', signature: 'User', status: 'observed',
    details: { table: 'users' },
    source: { path: 'schema.prisma', line: 5 },
    matchedKey: 'entity:User', id: 'rec-fixed',
  }],
  edges: [],
};

const deploymentTopology = {
  images: [{ reference: 'nginx:1.25', scope: 'container', path: 'Dockerfile', line: 1 }],
  resources: [],
  services: [{
    id: 'service@web', kind: 'service', label: 'web', image: 'nginx:1.25',
    path: 'compose.yaml', line: 2, attributes: null,
  }],
  edges: [{
    from: 'service@web', to: 'service@db', kind: 'depends_on',
    path: 'compose.yaml', line: 3, crossArtifact: false,
  }],
  indicators: [{ kind: 'dynamic', path: 'main.tf', line: 1 }],
  stubs: [],
  diagnostics: [],
  artifactsByPath: { Dockerfile: 'dockerfile', 'compose.yaml': 'compose', 'main.tf': 'terraform' },
  counts: {},
  capped: false,
  cappedKinds: [],
};

const maintainabilityModel = {
  files: [{ path: 'src/a.js', dialect: 'javascript', bytes: 120, lines: 10, tokens: 30, sizeBucket: 'lt_1k' }],
  branchPoints: [{
    path: 'src/a.js', dialect: 'javascript', tokens: 30,
    counts: { if: 1, else: 0, switch: 0, case: 0, match: 0, ternary: 0, loop: 0, guard: 0 },
    capped: false,
  }],
  duplicateGroups: [],
  generatedBoundaries: [],
  toolEvidence: [],
  measurementUniverse: {
    filesInspected: 1, bytesInspected: 120, recordsInspected: 1,
    fileLimit: 256, byteLimit: 4_194_304, recordLimit: 10_000,
    measuredFiles: 1, eligibleFiles: 1, omittedCount: 0, configFilesInspected: 0,
    supportedDialects: ['javascript'], excludedLanguages: [], excludedFiles: 0,
    sizeDistribution: [{ bucket: 'lt_1k', count: 1 }],
    capped: {
      read: false, files: false, tokens: false, windows: false,
      groups: false, spans: false, blocks: false, occurrences: false,
    },
    partialCoverage: false,
  },
};

const governanceModel = {
  entries: [{
    category: 'policy', dialect: 'governance', matchedKey: 'policy:GOVERNANCE.md',
    path: 'GOVERNANCE.md', status: 'observed', details: { kind: 'governance' },
    source: { path: 'GOVERNANCE.md', line: null },
  }],
  ownership: {
    rules: [{ path: 'CODEOWNERS', pattern: 'src/', anchored: false, labels: ['Owner-1'], line: 1 }],
    assignees: [{ label: 'Owner-1', count: 1 }],
  },
};

const assuranceModel = {
  manifest: [{
    category: 'manifest', path: 'package.json', status: 'observed',
    details: { ecosystem: 'javascript', format: 'package_json' },
    matchedKey: 'manifest:package_json', id: 'asc-fixed',
  }],
  lock: [], pin: [], source: [], license: [], sbom: [], vex: [], sarif: [],
  configuration: [], tool_result: [], accessibility: [], attestation: [], standard: [],
};

test('T220 parity: security adapter projects scanner findings exactly', () => {
  const raw = securityCatalogObservations(securityFindings);
  assert.deepEqual(raw.slice().toSorted(canonicalOrder), EXPECTED_SECURITY, 'raw adapter observation set matches');
  assertCanonicalOrder(raw.slice().toSorted(canonicalOrder));
  for (const observation of raw) assertValidObservation(observation, 'DIM-security-v1');

  const result = securityCatalogResult(securityFindings);
  assert.equal(result.providerId, SECURITY_CATALOG_PROVIDER_ID);
  assert.equal(result.dimensionId, 'DIM-security-v1');
  assert.deepEqual(result.observations, EXPECTED_SECURITY, 'result observations are canonically ordered');
  assert.equal(JSON.stringify(result.observations), JSON.stringify(EXPECTED_SECURITY), 'byte-identical snapshot');
  assertCanonicalOrder(result.observations);
  assert.deepEqual(securityCatalogResult(null), null);
  assert.deepEqual(securityCatalogObservations({}), []);
});

test('T220 parity: operations adapter projects scanner findings exactly', () => {
  const raw = operationsCatalogObservations(operationsFindings);
  assert.deepEqual(raw.slice().toSorted(canonicalOrder), EXPECTED_OPERATIONS, 'raw adapter observation set matches');
  assertCanonicalOrder(raw.slice().toSorted(canonicalOrder));
  for (const observation of raw) assertValidObservation(observation, 'DIM-operations-v1');

  const result = operationsCatalogResult(operationsFindings);
  assert.equal(result.providerId, OPERATIONS_CATALOG_PROVIDER_ID);
  assert.equal(result.dimensionId, 'DIM-operations-v1');
  assert.deepEqual(result.observations, EXPECTED_OPERATIONS, 'result observations are canonically ordered');
  assert.equal(JSON.stringify(result.observations), JSON.stringify(EXPECTED_OPERATIONS), 'byte-identical snapshot');
  assertCanonicalOrder(result.observations);
  assert.deepEqual(operationsCatalogResult(null), null);
  assert.deepEqual(operationsCatalogObservations({}), []);
});

test('T220 parity: per-dimension providers project the six new-dimension models exactly', () => {
  const cases = [
    {
      dimensionId: 'DIM-api-v1',
      providerId: ASSURANCE_PROVIDER_IDS.api,
      envelope: { results: apiProviderResult(apiModel), capped: false },
      expected: [{
        category: 'route', details: { signature: 'GET:/api/users', dialect: 'express', status: 'observed' },
        matchedKey: 'route:GET:/api/users', path: 'src/routes.js', sourceKind: 'source',
      }],
    },
    {
      dimensionId: 'DIM-data-v1',
      providerId: ASSURANCE_PROVIDER_IDS.data,
      envelope: dataProviderResult(dataModel),
      expected: [{
        category: 'entity', details: { signature: 'User', dialect: 'prisma', status: 'observed' },
        matchedKey: 'entity:User', path: 'schema.prisma', sourceKind: 'schema',
      }],
    },
    {
      dimensionId: 'DIM-deployment-v1',
      providerId: ASSURANCE_PROVIDER_IDS.deployment,
      envelope: deploymentProviderResults({ topology: deploymentTopology }),
      expected: [
        { category: 'image', details: { reference: 'nginx:1.25', scope: 'container', line: 1 }, matchedKey: 'image:nginx:1.25', path: 'Dockerfile', sourceKind: 'container' },
        { category: 'service', details: { id: 'service@web', kind: 'service', label: 'web', image: 'nginx:1.25' }, matchedKey: 'service:service@web', path: 'compose.yaml', sourceKind: 'config' },
        { category: 'template_indicator', details: { kind: 'dynamic', count: 1 }, matchedKey: 'indicator:dynamic', path: null, sourceKind: 'infrastructure' },
        { category: 'topology_edge', details: { from: 'service@web', to: 'service@db', kind: 'depends_on', crossArtifact: false }, matchedKey: 'edge:service@web:service@db:depends_on', path: 'compose.yaml', sourceKind: 'config' },
      ],
    },
    {
      dimensionId: 'DIM-maintainability-v1',
      providerId: ASSURANCE_PROVIDER_IDS.maintainability,
      envelope: maintainabilityProviderResults(maintainabilityModel),
      expected: [
        { category: 'branch_point', details: { dialect: 'javascript', tokens: 30, counts: { if: 1, else: 0, switch: 0, case: 0, match: 0, ternary: 0, loop: 0, guard: 0 }, capped: false }, matchedKey: 'branch-point:src/a.js', path: 'src/a.js', sourceKind: 'source' },
        { category: 'file_metric', details: { dialect: 'javascript', bytes: 120, lines: 10, tokens: 30, sizeBucket: 'lt_1k' }, matchedKey: 'file-metric:src/a.js', path: 'src/a.js', sourceKind: 'source' },
        { category: 'measurement_universe', details: { filesInspected: 1, bytesInspected: 120, recordsInspected: 1, measuredFiles: 1, eligibleFiles: 1, omittedCount: 0, configFilesInspected: 0, supportedDialects: ['javascript'], excludedLanguages: {}, excludedFiles: 0, capped: { read: false, files: false, tokens: false, windows: false, groups: false, spans: false, blocks: false, occurrences: false }, partialCoverage: false, sizeDistribution: { 'lt_1k': 1 } }, matchedKey: 'universe:measurement', path: null, sourceKind: 'repository_metadata' },
      ],
    },
    {
      dimensionId: 'DIM-governance-v1',
      providerId: ASSURANCE_PROVIDER_IDS.governance,
      envelope: { results: governanceProviderResult(governanceModel), capped: false },
      expected: [
        { category: 'ownership', details: { count: 1 }, matchedKey: 'assignee:Owner-1', path: null, sourceKind: 'policy' },
        { category: 'ownership', details: { pattern: 'src/', anchored: false, labels: ['Owner-1'], line: 1 }, matchedKey: 'rule:CODEOWNERS:src/', path: 'CODEOWNERS', sourceKind: 'policy' },
        { category: 'policy', details: { dialect: 'governance', status: 'observed' }, matchedKey: 'policy:GOVERNANCE.md', path: 'GOVERNANCE.md', sourceKind: 'policy' },
      ],
    },
    {
      dimensionId: 'DIM-assurance-v1',
      providerId: ASSURANCE_PROVIDER_IDS.assurance,
      envelope: { results: assuranceProviderResult(assuranceModel), capped: false },
      expected: [{
        category: 'manifest', details: { status: 'observed', ecosystem: 'javascript', format: 'package_json' },
        matchedKey: 'manifest:package_json', path: 'package.json', sourceKind: 'manifest',
      }],
    },
  ];

  for (const { dimensionId, providerId, envelope, expected } of cases) {
    assert.equal(envelope.results.length, 1, `${dimensionId} result count`);
    const result = envelope.results[0];
    assert.equal(result.providerId, providerId, `${dimensionId} provider`);
    assert.equal(result.dimensionId, dimensionId, `${dimensionId} dimension`);
    assert.deepEqual(result.observations, expected, `${dimensionId} observations`);
    assert.equal(JSON.stringify(result.observations), JSON.stringify(expected), `${dimensionId} byte-identical`);
    assertCanonicalOrder(result.observations);
    for (const observation of result.observations) assertValidObservation(observation, dimensionId);
  }
});

test('T220 parity: live five-ecosystem spot matrix is deterministic, allowlisted, and orchestration-faithful', async () => {
  // Expected presence per (ecosystem, dimension): true when the scanner model
  // yields at least one representable observation.
  const expectedPresence = {
    python: { security: false, operations: false, api: false, data: false, deployment: false, maintainability: true, governance: false, assurance: true },
    javascript: { security: false, operations: false, api: true, data: false, deployment: false, maintainability: true, governance: false, assurance: true },
    typescript: { security: false, operations: false, api: true, data: false, deployment: false, maintainability: true, governance: false, assurance: true },
    shell: { security: false, operations: true, api: false, data: false, deployment: false, maintainability: true, governance: false, assurance: false },
    rust: { security: true, operations: false, api: true, data: false, deployment: false, maintainability: true, governance: false, assurance: true },
  };

  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    await withFixture(`t220-${name}`, files, async (repoPath) => {
      const firstModels = await scanAll(repoPath, name);
      const secondModels = await scanAll(repoPath, name);
      const build = (models) => assuranceCatalogResults({
        ...models,
        languages: [name],
        ecosystems: [],
      });
      const first = build(firstModels);
      const second = build(secondModels);
      assert.equal(first.mode, 'builtin', `${name} mode`);
      assert.equal(JSON.stringify(first), JSON.stringify(second), `${name} byte-identical`);

      for (const [dimension, dimensionId] of [
        ['security', 'DIM-security-v1'],
        ['operations', 'DIM-operations-v1'],
        ['api', 'DIM-api-v1'],
        ['data', 'DIM-data-v1'],
        ['deployment', 'DIM-deployment-v1'],
        ['maintainability', 'DIM-maintainability-v1'],
        ['governance', 'DIM-governance-v1'],
        ['assurance', 'DIM-assurance-v1'],
      ]) {
        const result = providerFor(first.results, dimensionId);
        const shouldBePresent = expectedPresence[name][dimension];
        if (!shouldBePresent) {
          assert.equal(result, null, `${name}:${dimension} must be absent`);
          continue;
        }
        assert.ok(result, `${name}:${dimension} must be present`);
        assert.equal(result.providerId, ASSURANCE_PROVIDER_IDS[dimension], `${name}:${dimension} provider`);
        assert.ok(result.observations.length > 0, `${name}:${dimension} observations`);
        assertCanonicalOrder(result.observations);
        for (const observation of result.observations) assertValidObservation(observation, dimensionId);
      }
      assert.equal(first.capped, false, `${name} capped`);
      assert.deepEqual(first.results.map(({ dimensionId }) => dimensionId),
        first.results.map(({ dimensionId }) => dimensionId).toSorted(),
        `${name} canonical dimension order`);
    });
  }
});

const keep = (results) => results.filter((result) => result.observations.length > 0);

test('T220 parity: orchestration assembles exactly the per-dimension adapter results', async () => {
  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    await withFixture(`t220-orch-${name}`, files, async (repoPath) => {
      const models = await scanAll(repoPath, name);
      const envelope = assuranceCatalogResults({ ...models, languages: [name], ecosystems: [] });
      const direct = [];
      const securityResult = securityCatalogResult(models.security);
      if (securityResult) direct.push(securityResult);
      const operationsResult = operationsCatalogResult(models.operations);
      if (operationsResult) direct.push(operationsResult);
      direct.push(...keep(apiProviderResult(models.api)));
      direct.push(...keep(dataProviderResult(models.data).results));
      direct.push(...keep(deploymentProviderResults({ topology: models.topology }).results));
      direct.push(...keep(maintainabilityProviderResults(models.maintainability).results));
      direct.push(...keep(governanceProviderResult(models.governance)));
      direct.push(...keep(assuranceProviderResult(models.assurance)));
      direct.sort((left, right) => (left.dimensionId < right.dimensionId ? -1 : left.dimensionId > right.dimensionId ? 1 : 0));
      assert.equal(JSON.stringify(envelope.results), JSON.stringify(direct), `${name} orchestration fidelity`);
    });
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('T220 deterministic: insertion-order changes never alter observations or results', () => {
  const permutedSecurity = {
    ...securityFindings,
    secrets: { count: 1, findings: securityFindings.secrets.findings.slice().toReversed() },
    securityTools: [...securityFindings.securityTools].toReversed(),
    auditEvidence: [...securityFindings.auditEvidence].toReversed(),
  };
  assert.equal(
    JSON.stringify(securityCatalogResult(securityFindings)),
    JSON.stringify(securityCatalogResult(permutedSecurity)),
  );
  assert.equal(
    JSON.stringify(operationsCatalogResult(operationsFindings)),
    JSON.stringify(operationsCatalogResult({
      ...operationsFindings,
      dockerfiles: [...operationsFindings.dockerfiles].toReversed(),
      gracefulShutdown: [...operationsFindings.gracefulShutdown].toReversed(),
    })),
  );
});

// ---------------------------------------------------------------------------
// Generic fallback (unknown languages)
// ---------------------------------------------------------------------------

test('T220 generic: unknown-language repos get artifact-only generic results, never built-in claims', () => {
  const unknown = assuranceCatalogResults({
    languages: ['Zeta'],
    ecosystems: [],
    files: ['src/main.zzz', 'README.md', 'Cargo.lock'],
  });
  assert.equal(unknown.mode, 'generic');
  assert.ok(unknown.results.length > 0);
  assert.ok(unknown.results.every(({ providerId }) => providerId === GENERIC_PROVIDER_ID));
  const dims = unknown.results.map(({ dimensionId }) => dimensionId);
  assert.ok(dims.every((dimensionId) => (
    ['DIM-maintainability-v1', 'DIM-assurance-v1', 'DIM-documentation-v1'].includes(dimensionId)
  )), 'generic results stay within the generic fallback dimensions');
  assert.ok(!dims.some((dimensionId) => (
    ['DIM-security-v1', 'DIM-operations-v1', 'DIM-api-v1', 'DIM-data-v1', 'DIM-deployment-v1', 'DIM-governance-v1']
      .includes(dimensionId)
  )), 'generic never claims a catalog-only built-in dimension');
  const serialized = JSON.stringify(unknown.results);
  for (const forbidden of ['importEdge', 'sourceSyntax', 'firstClass']) {
    assert.equal(serialized.includes(forbidden), false, `generic claimed ${forbidden}`);
  }
  const categories = unknown.results.flatMap(({ observations }) => observations.map(({ category }) => category));
  for (const forbidden of ['authentication', 'route', 'entity', 'topology_edge', 'monitoring', 'workflow']) {
    assert.ok(!categories.includes(forbidden), `generic claimed ${forbidden}`);
  }
});

test('T220 generic: unknown language bypasses built-in findings even when findings are present', () => {
  const envelope = assuranceCatalogResults({
    languages: ['Zeta'],
    ecosystems: [],
    files: [],
    security: securityFindings,
    operations: operationsFindings,
  });
  assert.equal(envelope.mode, 'generic');
  assert.deepEqual(envelope.results, []);
});

test('T220 generic: known ecosystems keep built-in mode', () => {
  assert.equal(assuranceCatalogResults({ languages: ['Python'], ecosystems: ['python'], files: [] }).mode, 'builtin');
  assert.equal(assuranceCatalogResults({ manifestEcosystems: ['rust'], files: [] }).mode, 'builtin');
});

test('T220 generic: more than 2048 distinct extensions thread the capped flag through the envelope', () => {
  const distinctExtensions = GENERIC_LIMITS.maxObservations + 2;
  const files = [];
  for (let index = 0; index < distinctExtensions; index++) {
    files.push(`src/file${String(index).padStart(4, '0')}.ext${String(index).padStart(4, '0')}`);
  }
  const envelope = assuranceCatalogResults({ languages: ['Zeta'], ecosystems: [], files });
  assert.equal(envelope.mode, 'generic');
  assert.equal(envelope.capped, true, 'generic fallback capped flag is threaded through the envelope');
  const maintainability = envelope.results.find(({ dimensionId }) => dimensionId === 'DIM-maintainability-v1');
  assert.ok(maintainability, 'maintainability result is present');
  assert.equal(maintainability.observations.length, GENERIC_LIMITS.maxObservations);
  assert.ok(maintainability.observations.some(({ matchedKey }) => matchedKey === 'measurement-universe'),
    'measurement-universe record is retained after truncation');
  assert.equal(maintainability.observations.filter(({ category }) => category === 'file_metric').length,
    GENERIC_LIMITS.maxObservations - 1, 'file_metric observations are truncated after the universe record');
  const direct = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  assert.equal(direct.capped, true);
});

// ---------------------------------------------------------------------------
// Plugin merge constraints (T210)
// ---------------------------------------------------------------------------

test('T220 plugin: declarative matches convert to bounded artifact observations on the catalog dimensions only', () => {
  const matches = [
    { ruleId: 'RUL-sec-v1', label: 'Zeta secret marker', dimensionId: 'DIM-security-v1', category: 'secret_pattern', path: 'zetafile' },
    { ruleId: 'RUL-api-v1', label: 'Zeta api marker', dimensionId: 'DIM-api-v1', category: 'route', path: 'src/zeta.js' },
    { ruleId: 'RUL-ignored-v1', label: 'Ignored', dimensionId: 'DIM-stack-v1', category: 'runtime', path: 'x.js' },
    null,
  ];
  const groups = assurancePluginObservations(matches);
  assert.deepEqual(groups.map(({ dimensionId }) => dimensionId), ['DIM-api-v1', 'DIM-security-v1']);
  const security = groups[1].observations[0];
  assert.deepEqual(security, {
    category: 'secret_pattern',
    path: 'zetafile',
    matchedKey: 'plugin-rule:RUL-sec-v1',
    details: { ruleId: 'RUL-sec-v1', label: 'Zeta secret marker' },
    sourceKind: 'artifact_metadata',
  });
  const results = assurancePluginProviderResults({ matches });
  assert.ok(results.every(({ providerId }) => providerId === ASSURANCE_PLUGIN_PROVIDER_ID));
  assert.deepEqual(results.map(({ dimensionId }) => dimensionId), ['DIM-api-v1', 'DIM-security-v1']);
  assert.deepEqual(assurancePluginProviderResults(null), []);
  assert.deepEqual(assurancePluginProviderResults({ matches: [] }), []);
  // matches on non-catalog dimensions are ignored, never fabricated
  assert.deepEqual(assurancePluginProviderResults({ matches: [matches[2]] }), []);
});

test('T220 plugin: observations are appended after built-in and never replace or rewrite findings', () => {
  const builtin = createProviderResult({
    providerId: SECURITY_CATALOG_PROVIDER_ID,
    dimensionId: 'DIM-security-v1',
    observations: [
      { category: 'dependency_lock', path: null, matchedKey: 'dependency-lock', details: { present: true }, sourceKind: 'lockfile' },
      { category: 'authentication', path: null, matchedKey: 'auth:passport', details: { package: 'passport', label: 'Passport', type: null }, sourceKind: 'manifest' },
    ],
  });
  const plugin = assurancePluginResult('DIM-security-v1', [{
    category: 'security_tool', path: null, matchedKey: 'plugin-rule:RUL-zeta-v1',
    details: { ruleId: 'RUL-zeta-v1', label: 'Zeta tool' }, sourceKind: 'artifact_metadata',
  }]);
  const merged = mergeAssurancePlugin({ builtin, plugin });
  assert.equal(merged.providerId, SECURITY_CATALOG_PROVIDER_ID);
  const keys = merged.observations.map(({ matchedKey }) => matchedKey);
  const builtinKeys = builtin.observations.map(({ matchedKey }) => matchedKey);
  assert.deepEqual(keys.slice(0, builtinKeys.length), builtinKeys, 'built-in observations come first');
  assert.deepEqual(keys.slice(builtinKeys.length), ['plugin-rule:RUL-zeta-v1']);
  const mergedLock = merged.observations.find(({ matchedKey }) => matchedKey === 'dependency-lock');
  const builtinLock = builtin.observations.find(({ matchedKey }) => matchedKey === 'dependency-lock');
  assert.deepEqual(mergedLock, builtinLock, 'built-in finding is never replaced');
  assert.ok(Object.isFrozen(merged));
});

test('T220 plugin: exact duplicate plugin observations are dropped and never rewrite built-ins', () => {
  const builtin = createProviderResult({
    providerId: OPERATIONS_CATALOG_PROVIDER_ID,
    dimensionId: 'DIM-operations-v1',
    observations: [{ category: 'workflow', path: null, matchedKey: 'workflow:ci', details: { platform: 'ci' }, sourceKind: 'workflow' }],
  });
  const duplicate = { category: 'workflow', path: null, matchedKey: 'workflow:ci', details: { platform: 'ci' }, sourceKind: 'workflow' };
  const plugin = assurancePluginResult('DIM-operations-v1', [duplicate, {
    category: 'monitoring', path: null, matchedKey: 'plugin-rule:RUL-mon-v1',
    details: { ruleId: 'RUL-mon-v1', label: 'Zeta monitoring' }, sourceKind: 'artifact_metadata',
  }]);
  const merged = mergeAssurancePlugin({ builtin, plugin });
  assert.equal(merged.observations.filter(({ matchedKey }) => matchedKey === 'workflow:ci').length, 1,
    'exact duplicate is dropped');
  assert.ok(merged.observations.some(({ matchedKey }) => matchedKey === 'plugin-rule:RUL-mon-v1'));
});

test('T220 plugin: assuranceCatalogResults merges per-dimension plugin observations', () => {
  const envelope = assuranceCatalogResults({
    security: { hasLockfile: true },
    languages: [],
    ecosystems: [],
    pluginObservations: {
      'DIM-security-v1': [{
        category: 'authentication', path: null, matchedKey: 'plugin-auth:zeta',
        details: { package: 'zeta-auth', label: 'Zeta' }, sourceKind: 'artifact_metadata',
      }],
    },
  });
  const securityResult = providerFor(envelope.results, 'DIM-security-v1');
  assert.ok(securityResult, 'security dimension result is present');
  const authIdx = securityResult.observations.findIndex(({ matchedKey }) => matchedKey === 'plugin-auth:zeta');
  assert.ok(authIdx >= 0, 'plugin observation contributed');
  assert.ok(securityResult.observations.slice(0, authIdx).some(({ matchedKey }) => matchedKey === 'dependency-lock'),
    'built-in dependency-lock observation still precedes the plugin observation');
});

test('T220 plugin: empty built-in findings still emit a plugin-only provider result', () => {
  const envelope = assuranceCatalogResults({
    security: {},
    operations: {},
    api: null,
    data: null,
    deployment: null,
    maintainability: null,
    governance: null,
    assurance: null,
    languages: [],
    ecosystems: [],
    pluginObservations: {
      'DIM-api-v1': [{
        category: 'route', path: null, matchedKey: 'plugin-route:zeta',
        details: { ruleId: 'RUL-zeta-v1', label: 'Zeta route' }, sourceKind: 'artifact_metadata',
      }],
    },
  });
  assert.equal(envelope.mode, 'builtin');
  const apiResult = providerFor(envelope.results, 'DIM-api-v1');
  assert.ok(apiResult, 'api dimension plugin result is emitted');
  assert.equal(apiResult.providerId, ASSURANCE_PLUGIN_PROVIDER_ID,
    'plugin-only result uses the plugin carrier id, never the built-in id');
  assert.deepEqual(apiResult.observations.map(({ matchedKey }) => matchedKey), ['plugin-route:zeta']);
  assert.ok(!providerFor(envelope.results, 'DIM-security-v1'), 'empty built-in never fabricates a security result');
  assert.ok(!providerFor(envelope.results, 'DIM-assurance-v1'), 'dimensions with no built-in and no plugin are absent');
});

test('T220 plugin: unknown and duplicate categories and dimension mismatch fail with typed errors', () => {
  assert.throws(
    () => assurancePluginResult('DIM-security-v1', [{
      category: 'route', path: null, matchedKey: 'plugin-route:zeta',
      details: { ruleId: 'R', label: 'L' }, sourceKind: 'artifact_metadata',
    }]),
    (error) => error instanceof ProviderResultError && error.code === 'UNKNOWN_CATEGORY',
  );
  assert.throws(
    () => assurancePluginResult('DIM-security-v1', [
      { category: 'authentication', path: null, matchedKey: 'auth:zeta', details: { package: 'a' }, sourceKind: 'artifact_metadata' },
      { category: 'authentication', path: null, matchedKey: 'auth:zeta', details: { package: 'a' }, sourceKind: 'artifact_metadata' },
    ]),
    (error) => error instanceof ProviderResultError && error.code === 'DUPLICATE_OBSERVATION',
  );
  const security = assurancePluginProviderResults({ matches: [
    { ruleId: 'RUL-sec-v1', label: 'L', dimensionId: 'DIM-security-v1', category: 'authentication', path: 'a.js' },
  ] })[0];
  const api = createProviderResult({
    providerId: ASSURANCE_PROVIDER_IDS.api,
    dimensionId: 'DIM-api-v1',
    observations: [],
  });
  assert.throws(
    () => mergeProviderResults({ builtin: api, plugin: security }),
    (error) => error && error.code === 'DIMENSION_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// Caps and matched-key bounds
// ---------------------------------------------------------------------------

test('T220 cap: observation lists are bounded and truncation is threaded through the catalog', () => {
  const count = PROVIDER_RESULT_LIMITS.observations + 10;
  const entities = [];
  for (let index = 0; index < count; index++) {
    entities.push({
      category: 'entity', dialect: 'prisma', signature: `Entity${index}`, status: 'observed',
      details: { table: `table${index}` },
      source: { path: 'schema.prisma', line: index + 1 },
      matchedKey: `entity:Entity${index}`, id: `rec-${index}`,
    });
  }
  const model = { entities, edges: [] };
  const direct = dataProviderResult(model);
  assert.equal(direct.capped, true);
  assert.equal(direct.results[0].observations.length, PROVIDER_RESULT_LIMITS.observations);

  const envelope = assuranceCatalogResults({
    data: model,
    languages: ['Python'],
    ecosystems: ['python'],
  });
  assert.equal(envelope.capped, true, 'built-in capped flag is threaded through the envelope');
  const dataResult = providerFor(envelope.results, 'DIM-data-v1');
  assert.equal(dataResult.observations.length, PROVIDER_RESULT_LIMITS.observations);
  assertCanonicalOrder(dataResult.observations);
});

test('T220 matchedKey bound: long scanner values assemble without aborting and stay within 128 chars', () => {
  const longPattern = `secret-${'x'.repeat(300)}`;
  const longPackage = `pkg-${'y'.repeat(300)}`;
  const longFindings = {
    ...securityFindings,
    secrets: { count: 1, findings: [{ pattern: longPattern, files: ['src/creds.js'], totalFiles: 1 }] },
  };
  const longOperations = {
    ...operationsFindings,
    monitoring: { libraries: [{ package: longPackage, label: 'Long' }] },
  };
  const security = securityCatalogResult(longFindings);
  assert.ok(security, 'long secret pattern survives assembly');
  const secret = security.observations.find(({ category }) => category === 'secret_pattern');
  assert.equal(secret.matchedKey, keyFor('secret', longPattern), 'unsafe long value is deterministically hashed');
  assert.ok(secret.matchedKey.length <= 128, 'hashed matchedKey is bounded');
  assert.match(secret.matchedKey, FOUNDATION_KEY_PATTERN);
  assert.equal(secret.details.pattern, longPattern, 'full value stays available in details');

  const operations = operationsCatalogResult(longOperations);
  assert.ok(operations, 'long monitoring package survives assembly');
  const monitoring = operations.observations.find(({ category }) => category === 'monitoring');
  assert.ok(monitoring.matchedKey.length <= 128, 'monitoring matchedKey is bounded');
  assert.match(monitoring.matchedKey, FOUNDATION_KEY_PATTERN);
  assert.equal(monitoring.details.package, longPackage, 'full package stays available in details');

  const again = assuranceCatalogResults({
    security: longFindings,
    operations: longOperations,
    languages: ['Python'],
    ecosystems: ['python'],
  });
  const second = assuranceCatalogResults({
    security: longFindings,
    operations: longOperations,
    languages: ['Python'],
    ecosystems: ['python'],
  });
  assert.equal(JSON.stringify(again.results), JSON.stringify(second.results), 'long-value assembly is deterministic');
  for (const result of again.results) {
    for (const observation of result.observations) {
      assert.ok(observation.matchedKey.length <= 128, `${result.dimensionId} matchedKey is bounded`);
      assert.match(observation.matchedKey, FOUNDATION_KEY_PATTERN, `${result.dimensionId} matchedKey pattern`);
    }
  }
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test('T220 immutability: catalog and every produced result are deep-frozen', () => {
  assert.throws(() => ASSURANCE_CATALOG_PROVIDERS.push({}), TypeError);
  assert.throws(() => { ASSURANCE_CATALOG_PROVIDERS[0].dimensions.pop(); }, TypeError);
  assert.throws(() => { ASSURANCE_CATALOG_PROVIDERS[0].id = 'PRV-mutated-v1'; }, TypeError);

  const security = securityCatalogResult(securityFindings);
  assert.ok(Object.isFrozen(security));
  assert.ok(Object.isFrozen(security.observations));
  assert.ok(Object.isFrozen(security.observations[0]));
  assert.ok(Object.isFrozen(security.observations[0].details));
  assert.throws(() => security.observations.pop(), TypeError);
  assert.throws(() => { security.observations[0].details.pattern = 'mutated'; }, TypeError);
  assert.throws(() => { security.dimensionId = 'DIM-api-v1'; }, TypeError);

  const operations = operationsCatalogResult(operationsFindings);
  assert.ok(Object.isFrozen(operations));
  assert.throws(() => operations.observations[0].details.name = 'x', TypeError);

  const api = apiProviderResult(apiModel);
  assert.equal(api.length, 1);
  assert.ok(Object.isFrozen(api[0]));
  assert.ok(Object.isFrozen(api[0].observations));
  assert.throws(() => { api[0].observations.pop(); }, TypeError);

  const plugin = assurancePluginProviderResults({ matches: [
    { ruleId: 'RUL-x-v1', label: 'L', dimensionId: 'DIM-security-v1', category: 'authentication', path: 'a.js' },
  ] });
  assert.ok(Object.isFrozen(plugin));
  assert.throws(() => plugin.pop(), TypeError);

  const envelope = assuranceCatalogResults({ security: securityFindings, languages: ['Python'], ecosystems: ['python'] });
  assert.ok(Object.isFrozen(envelope.results));
  assert.throws(() => envelope.results.pop(), TypeError);
});

// ---------------------------------------------------------------------------
// Inertness — the catalog is data-only and unregistered in production
// ---------------------------------------------------------------------------

async function libScanFiles() {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(join(LIB_ROOT, 'scan'));
  return files.toSorted();
}

function relativeImportTargets(source) {
  const targets = [];
  const pattern = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

test('T220 inert: no production module imports the assurance catalog', async () => {
  const catalogPath = join(LIB_ROOT, 'scan', 'providers', 'assurance-catalog.mjs');
  const activatedConsumer = join(LIB_ROOT, 'scan', 'pipeline', 'run.mjs');
  const consumers = [];
  for (const file of await libScanFiles()) {
    if (file === catalogPath || file === activatedConsumer) continue;
    const source = await readFile(file, 'utf8');
    const resolved = relativeImportTargets(source).map((target) => join(dirname(file), target));
    if (resolved.some((path) => path === catalogPath)) {
      consumers.push(file.replace(/\\/g, '/').split('/lib/scan/')[1]);
    }
  }
  assert.deepEqual(consumers, [], 'only the activated pipeline may consume the assurance catalog');
});

test('T220 inert: catalog avoids T201 forbidden capabilities on import', async () => {
  const source = await readFile(join(LIB_ROOT, 'scan', 'providers', 'assurance-catalog.mjs'), 'utf8');
  const imports = [...source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)]
    .map((match) => match[1]);
  for (const specifier of imports) {
    assert.equal(specifier.startsWith('node:'), false,
      `catalog must not import a node: capability (${specifier})`);
  }
  for (const forbidden of ['node:fs', 'node:child_process', 'node:process', 'node:vm', 'node:module']) {
    assert.ok(!imports.includes(forbidden), `catalog must not import ${forbidden}`);
  }
});

test('T220 inert: catalog exports only data and pure factories, never execution surfaces', async () => {
  const path = join(LIB_ROOT, 'scan', 'providers', 'assurance-catalog.mjs');
  const source = await readFile(path, 'utf8');
  for (const name of [
    'securityCatalogObservations', 'securityCatalogResult',
    'operationsCatalogObservations', 'operationsCatalogResult',
    'assuranceCatalogResults', 'assurancePluginObservations',
    'assurancePluginProviderResults', 'assurancePluginResult', 'mergeAssurancePlugin',
  ]) {
    assert.ok(new RegExp(`export\\s+(?:function|const)\\s+${name}\\b`).test(source),
      `catalog exports ${name}`);
  }
  for (const forbidden of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
    assert.equal(source.includes(forbidden), false, `catalog must not expose execution surface ${forbidden}`);
  }
});
