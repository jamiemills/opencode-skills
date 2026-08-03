// T226 — five-ecosystem and generic expansion fixtures on the production
// pipeline.
//
// Owned by T226. Drives NEW topic-focused fixtures (test/fixtures-expansion/)
// and inline fixture maps exclusively through the EXPORTED production pipeline
// `runExpandedPipeline` — never a reconstructed dispatch. It proves:
//   - The five built-in ecosystems preserve their established facts (language,
//     ecosystem, stack, 16 dimensions, coverage) through the production
//     pipeline, and the generic fallback does NOT fire for them.
//   - The unknown-language fixture receives generic artifact-only evidence.
//   - Every applicable new dimension has positive AND negative cases.
//   - Statuses behave per the T202 contract (observed / not_detected /
//     unsupported / unverified / not_applicable with correct search-space
//     evidence).
//   - Privacy hazards (emails, tokens, absolute-path-bearing credentials, URL
//     credentials) are sanitized or downgraded and never reach findings or
//     NORMS.md.
//   - Dynamic constructs (dynamic imports, reflection, templates) surface as
//     disclosed unverified/unsupported diagnostics, never invented facts.
//   - Architecture facts (import edges) and cross-repository relationships
//     (exact references) behave per contract.
//   - Determinism: fixed clock produces byte-identical repeated runs.
//
// Scope (own-only): test/fixtures-expansion/*.mjs and this test file. No
// production, baseline, contract, or locked fixture is edited.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { synthesizeCrossRepository } from '../lib/scan/cross-repo/edges.mjs';
import { CLAIM_STATUSES } from '../lib/scan/contracts/dimension.mjs';
import { DIMENSION_REGISTRY } from '../lib/scan/registry/dimensions.mjs';

import { files as pythonFiles } from './fixtures-expansion/python.mjs';
import { files as javascriptFiles } from './fixtures-expansion/javascript.mjs';
import { files as typescriptFiles } from './fixtures-expansion/typescript.mjs';
import { files as shellFiles } from './fixtures-expansion/shell.mjs';
import { files as rustFiles } from './fixtures-expansion/rust.mjs';
import { files as unknownFiles } from './fixtures-expansion/unknown.mjs';
import { repoA, repoB, repoASingle, repoBSingle } from './fixtures-expansion/cross-repo.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, '..');

const SIX_NEW_DIMENSIONS = ['api', 'data', 'deployment', 'maintainability', 'governance', 'assurance'];

const SIX_NEW_HEADINGS = [
  '## API Surface',
  '## Data Architecture',
  '## Deployment Topology',
  '## Maintainability',
  '## Governance & Ownership',
  '## Assurance & Supply Chain',
];

const REGISTRY_CLAIMS = DIMENSION_REGISTRY.reduce((sum, dimension) => sum + dimension.expectedClaimIds.length, 0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFixture(name, files, options = {}) {
  const repoPath = makeFixture(name, files);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t226-out-'));
  const result = await runExpandedPipeline({
    repos: [repoPath],
    out: join(outDir, 'NORMS.md'),
    clock: () => '2026-08-03',
    ...options,
  });
  return { result, repoPath, outDir };
}

async function runRepos(name, repoFiles, options = {}) {
  const paths = repoFiles.map((files, index) => makeFixture(`${name}-${index}`, files));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t226-out-'));
  const result = await runExpandedPipeline({
    repos: paths,
    out: join(outDir, 'NORMS.md'),
    clock: () => '2026-08-03',
    ...options,
  });
  return { result, paths, outDir };
}

async function cleanupRun({ repoPath, paths = null, outDir }) {
  if (paths !== null) for (const p of paths) cleanupFixture(p);
  else if (repoPath) cleanupFixture(repoPath);
  await rm(outDir, { recursive: true, force: true });
}

function perDimension(result) {
  return result.expectedClaimCoverage.repos[0].perDimension;
}

function newDimensionStatus(result) {
  const per = perDimension(result);
  return Object.fromEntries(SIX_NEW_DIMENSIONS.map((dimension) => [dimension, per[dimension].status]));
}

function findingsFor(result, dimension) {
  return result.repos[0].deep.find((entry) => entry.dimension === dimension)?.findings;
}

function serializedDeep(result) {
  return JSON.stringify(result.repos[0].deep);
}

// ---------------------------------------------------------------------------
// Topic fixtures and the six new dimensions
// ---------------------------------------------------------------------------

const FIXTURES = Object.freeze([
  { name: 'python', files: pythonFiles },
  { name: 'javascript', files: javascriptFiles },
  { name: 'typescript', files: typescriptFiles },
  { name: 'shell', files: shellFiles },
  { name: 'rust', files: rustFiles },
  { name: 'unknown', files: unknownFiles },
]);

// Expected per-dimension coverage status per fixture (T202 contract mapping).
const EXPECTED_STATUS = Object.freeze({
  python: {
    api: 'observed', data: 'observed', deployment: 'observed',
    maintainability: 'observed', governance: 'observed', assurance: 'observed',
  },
  javascript: {
    api: 'observed', data: 'observed', deployment: 'observed',
    maintainability: 'observed', governance: 'not_detected', assurance: 'observed',
  },
  typescript: {
    api: 'observed', data: 'observed', deployment: 'observed',
    maintainability: 'observed', governance: 'not_detected', assurance: 'observed',
  },
  shell: {
    api: 'not_detected', data: 'not_detected', deployment: 'observed',
    maintainability: 'observed', governance: 'not_detected', assurance: 'not_detected',
  },
  rust: {
    api: 'observed', data: 'observed', deployment: 'observed',
    maintainability: 'observed', governance: 'observed', assurance: 'observed',
  },
  unknown: {
    api: 'not_detected', data: 'not_detected', deployment: 'not_detected',
    maintainability: 'not_detected', governance: 'not_detected', assurance: 'observed',
  },
});

test('T226 five built-ins preserve their established facts through the production pipeline', async (t) => {
  const expectations = Object.freeze({
    python: { language: 'Python', ecosystem: 'python', stackLanguage: 'Python' },
    javascript: { language: 'JavaScript', ecosystem: 'javascript', stackLanguage: 'JavaScript' },
    typescript: { language: 'TypeScript', ecosystem: 'typescript', stackLanguage: 'TypeScript' },
    rust: { language: 'Rust', ecosystem: 'rust', stackLanguage: 'Rust' },
    shell: { language: 'Shell', ecosystem: 'shell', stackLanguage: 'Shell' },
  });
  for (const { name, files } of FIXTURES.slice(0, 5)) {
    const run = await runFixture(`t226-facts-${name}`, files);
    t.after(() => cleanupRun(run));
    const expected = expectations[name];
    const overview = run.result.repos[0].overview;
    assert.ok(overview.languages.includes(expected.language), `${name}: detected language must include ${expected.language}`);
    assert.equal(overview.ecosystems.primary, expected.ecosystem, `${name}: primary ecosystem must be ${expected.ecosystem}`);
    const stack = findingsFor(run.result, 'stack');
    assert.equal(stack.language, expected.stackLanguage, `${name}: stack language must be ${expected.stackLanguage}`);
    assert.equal(run.result.repos[0].deep.length, 16, `${name}: all 16 dimensions must scan`);
    for (const heading of SIX_NEW_HEADINGS) {
      assert.ok(run.result.markdown.includes(heading), `${name}: ${heading} must render`);
    }
    assert.equal(run.result.expectedClaimCoverage.expected, REGISTRY_CLAIMS, `${name}: coverage accounts every registry claim`);
    assert.equal(run.result.markdown.includes('PRV-generic-artifacts-v1'), false,
      `${name}: the generic fallback must NOT fire for a built-in ecosystem`);
  }
});

test('T226 every applicable new dimension has positive and negative cases across the matrix', async (t) => {
  const observed = new Set();
  const notDetected = new Set();
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-matrix-${name}`, files);
    t.after(() => cleanupRun(run));
    const statuses = newDimensionStatus(run.result);
    assert.deepEqual(statuses, EXPECTED_STATUS[name], `${name}: per-dimension status matrix must match the contract`);
    for (const dimension of SIX_NEW_DIMENSIONS) {
      if (statuses[dimension] === 'observed') observed.add(dimension);
      if (statuses[dimension] === 'not_detected') notDetected.add(dimension);
    }
  }
  for (const dimension of SIX_NEW_DIMENSIONS) {
    assert.ok(observed.has(dimension), `${dimension}: must have a positive (observed) case`);
    assert.ok(notDetected.has(dimension), `${dimension}: must have a negative (not_detected) case`);
  }
});

test('T226 python fixture: API/data/deployment/governance/assurance facts, dynamic diagnostic, architecture edge', async (t) => {
  const run = await runFixture('t226-py', pythonFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, 'api');
  assert.deepEqual(api.operations.map(({ signature }) => signature).sort(), [
    'GET:/api/items', 'GET:/api/items/{item_id}', 'GET:/api/v1', 'POST:/api/items', 'cli:click:deploy',
  ]);
  assert.ok(api.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'DYNAMIC'),
    'dynamic route variable must be disclosed as an unverified DYNAMIC diagnostic');

  const data = findingsFor(result, 'data');
  assert.deepEqual(data.entities.map(({ signature }) => signature).sort(), ['players', 'teams', 'users']);
  assert.deepEqual(data.relations.map(({ signature }) => signature), ['users:teams:foreign_key']);
  assert.deepEqual(data.migrations.map(({ signature }) => signature), ['0001_init.py']);
  assert.ok(data.edges.some((edge) => edge.from === 'entity@users' && edge.to === 'entity@teams' && edge.kind === 'foreign_key'),
    'SQLAlchemy ForeignKey must produce a declaration-backed ER edge');
  assert.ok(data.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'NAME_ONLY'),
    'relationship without an FK must be disclosed as NAME_ONLY, never a fabricated edge');

  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.services.map(({ id }) => id).sort(), ['service@api', 'service@db']);
  assert.deepEqual(deployment.images.map(({ reference }) => reference).sort(), ['postgres:16', 'python:3.12']);

  const governance = findingsFor(result, 'governance');
  assert.equal(governance.summary.entries, 3);
  assert.equal(governance.summary.byCategory.ownership, 1, 'CODEOWNERS contributes ownership evidence');
  assert.equal(governance.summary.byCategory.decision, 1, 'ADR contributes a decision record');
  assert.equal(governance.summary.byCategory.contribution, 1, 'CONTRIBUTING contributes contribution evidence');

  const assurance = findingsFor(result, 'assurance');
  assert.equal(assurance.manifest.length, 2, 'pyproject.toml and requirements.txt are assurance manifests');

  const maintainability = findingsFor(result, 'maintainability');
  assert.ok(maintainability.summary.filesMeasured >= 8, 'python source files are measured');

  const architecture = findingsFor(result, 'architecture');
  assert.deepEqual(architecture.importGraph.graph['src/api/app.py'], ['src/models.py', 'src/cli.py'],
    'python absolute imports resolve to real internal edges');
});

test('T226 javascript fixture: route/event API, prisma ER edge, k8s deployment, dynamic import', async (t) => {
  const run = await runFixture('t226-js', javascriptFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, 'api');
  assert.ok(api.operations.some(({ signature }) => signature === 'GET:/api/users'));
  assert.ok(api.operations.some(({ signature }) => signature === 'POST:/api/users'));
  assert.ok(api.operations.some(({ signature }) => signature === 'event:emit:user.created'), 'emitter.emit must produce an event operation');
  assert.ok(api.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'DYNAMIC'));

  const data = findingsFor(result, 'data');
  assert.deepEqual(data.entities.map(({ signature }) => signature).sort(), ['Post', 'User']);
  assert.deepEqual(data.relations.map(({ signature }) => signature), ['Post:User:foreign_key']);
  assert.ok(data.edges.some((edge) => edge.from === 'entity@Post' && edge.to === 'entity@User'));

  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.resources.map(({ id }) => id), ['deployment@api']);
  assert.deepEqual(deployment.services.map(({ id }) => id), ['container@api:api']);

  const architecture = findingsFor(result, 'architecture');
  assert.deepEqual([...architecture.importGraph.graph['src/app.js']].sort(), ['src/dynamic.js', 'src/secret.js']);

  const assurance = findingsFor(result, 'assurance');
  assert.equal(assurance.manifest.length, 1);
  assert.equal(assurance.lock.length, 1);
});

test('T226 typescript fixture: NestJS route, reflection/dynamic constructs, prisma relation, terraform resources', async (t) => {
  const run = await runFixture('t226-ts', typescriptFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, 'api');
  assert.deepEqual(api.operations.map(({ signature }) => signature), ['GET:/api/health']);

  const data = findingsFor(result, 'data');
  assert.deepEqual(data.entities.map(({ signature }) => signature).sort(), ['Account', 'Owner']);
  assert.deepEqual(data.relations.map(({ signature }) => signature), ['Account:Owner:foreign_key']);

  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.resources.map(({ id }) => id).sort(), ['bucket@assets', 'database@primary']);

  const architecture = findingsFor(result, 'architecture');
  assert.deepEqual(architecture.importGraph.graph['src/app.controller.ts'], ['src/app.service.ts']);

  const maintainability = findingsFor(result, 'maintainability');
  assert.ok(maintainability.summary.filesMeasured >= 3);
});

test('T226 rust fixture: axum/clap/pub API, diesel schema + migration, docker image, ADR, architecture edge', async (t) => {
  const run = await runFixture('t226-rs', rustFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, 'api');
  assert.ok(api.operations.some(({ signature }) => signature === 'GET:/api/users'));
  assert.ok(api.operations.some(({ signature }) => signature === 'GET:/api/health'));
  assert.ok(api.operations.some(({ signature }) => signature === 'cli:clap:t226'));
  assert.ok(api.operations.some(({ signature }) => signature === 'cli:clap:subcommand:Build'));

  const data = findingsFor(result, 'data');
  assert.deepEqual(data.entities.map(({ signature }) => signature).sort(), ['teams', 'users']);
  assert.deepEqual(data.migrations.map(({ signature }) => signature), ['up.sql']);
  assert.ok(data.fields.length >= 4 && data.keys.length >= 2, 'diesel schema + SQL migration produce fields and keys');

  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.images.map(({ reference }) => reference), ['rust:1.75']);

  const governance = findingsFor(result, 'governance');
  assert.equal(governance.summary.byCategory.decision, 1);

  const architecture = findingsFor(result, 'architecture');
  assert.deepEqual(architecture.importGraph.graph['src/main.rs'], ['src/routes.rs']);
});

test('T226 shell fixture: built-in negative new dimensions with complete search, positive deployment/maintainability', async (t) => {
  const run = await runFixture('t226-sh', shellFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const overview = result.repos[0].overview;
  assert.ok(overview.languages.includes('Shell'), 'Shell must be detected as a built-in');
  assert.equal(overview.ecosystems.primary, 'shell');
  assert.equal(result.markdown.includes('PRV-generic-artifacts-v1'), false, 'a built-in shell fixture never uses the generic fallback');

  for (const dimension of ['api', 'data', 'governance', 'assurance']) {
    const findings = findingsFor(result, dimension);
    assert.equal(findings.searchSpace.complete, true, `${dimension}: complete search space is required for a factual absence`);
    assert.equal(newDimensionStatus(result)[dimension], 'not_detected', `${dimension}: no evidence after a complete search`);
  }
  assert.equal(newDimensionStatus(result).deployment, 'observed');
  assert.equal(newDimensionStatus(result).maintainability, 'observed');
  assert.deepEqual(findingsFor(result, 'deployment').resources.map(({ id }) => id), ['namespace@t226-sh']);
  assert.ok(findingsFor(result, 'maintainability').summary.filesMeasured >= 3);

  const architecture = findingsFor(result, 'architecture');
  assert.deepEqual(architecture.importGraph.graph['scripts/build.sh'], ['scripts/lib.sh']);
});

// ---------------------------------------------------------------------------
// Unknown-language fixture: generic artifact-only evidence
// ---------------------------------------------------------------------------

test('T226 unknown-language fixture: generic artifact-only evidence, no first-class claims', async (t) => {
  const run = await runFixture('t226-unknown', unknownFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const overview = result.repos[0].overview;
  assert.deepEqual(overview.languages, ['Go'], 'survey detects Go, a real non-built-in language');
  assert.equal(overview.ecosystems.primary, null);
  assert.deepEqual(overview.ecosystems.all, []);

  assert.ok(result.markdown.includes('PRV-generic-artifacts-v1'), 'the generic artifact fallback must render in NORMS.md');
  assert.ok(result.markdown.includes('### Provider Evidence'), 'generic evidence must render a provider section');

  const maintainability = findingsFor(result, 'maintainability');
  const observations = maintainability.providerObservations ?? [];
  assert.ok(observations.length > 0, 'generic file_metric observations must be merged into maintainability');
  assert.ok(observations.every(({ providerId }) => providerId === 'PRV-generic-artifacts-v1'),
    'only the generic provider contributes observations');
  const categories = new Set(observations.map(({ category }) => category));
  assert.ok(categories.has('file_metric') && categories.has('measurement_universe'),
    'generic evidence is artifact-only (file_metric + measurement_universe)');
  for (const observation of observations) {
    assert.deepEqual(Object.keys(observation).sort(), [
      'category', 'details', 'dimensionId', 'matchedKey', 'path', 'plugin', 'providerId', 'sourceKind',
    ], 'generic observations carry provider provenance only, never source claims');
  }

  const statuses = newDimensionStatus(result);
  for (const dimension of ['api', 'data', 'deployment', 'maintainability', 'governance']) {
    assert.equal(statuses[dimension], 'not_detected', `${dimension}: the generic fallback never claims first-class semantics`);
  }
  assert.equal(statuses.assurance, 'observed', 'assurance is observed from artifact presence only');

  const assurance = findingsFor(result, 'assurance');
  assert.equal(assurance.manifest.length, 1, 'go.mod is inventoried as an artifact');
  assert.equal(assurance.lock.length, 1, 'go.sum is inventoried as an artifact');
  assert.equal(assurance.license.length, 1, 'LICENSE is inventoried as an artifact');
});

// ---------------------------------------------------------------------------
// Statuses and coverage per the T202 contract
// ---------------------------------------------------------------------------

test('T226 statuses and coverage behave per contract for every fixture', async (t) => {
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-cov-${name}`, files);
    t.after(() => cleanupRun(run));
    const { result } = run;
    const coverage = result.expectedClaimCoverage;
    assert.equal(coverage.expected, REGISTRY_CLAIMS, `${name}: every registry claim is counted`);
    assert.equal(
      coverage.complete + coverage.incomplete + coverage.unsupported + coverage.excluded,
      coverage.expected,
      `${name}: every claim is counted exactly once`,
    );
    assert.equal(coverage.excluded, 2, `${name}: the non-git fixture excludes the git dimension as not_applicable`);
    assert.equal(coverage.eligible, coverage.complete + coverage.incomplete, `${name}: eligible counts only complete/incomplete`);
    assert.equal(coverage.ratio, coverage.eligible === 0 ? null : coverage.complete / coverage.eligible, `${name}: ratio is complete/eligible`);
    for (const entry of Object.values(coverage.repos[0].perDimension)) {
      assert.ok(CLAIM_STATUSES.includes(entry.status), `${name}: ${entry.status} is a registered status`);
      assert.notEqual(entry.status, 'inferred', `${name}: the pipeline never labels expected-claim coverage as inferred`);
    }
    const per = coverage.repos[0].perDimension;
    assert.equal(per.git.status, 'not_applicable', `${name}: git is proven not applicable by the is_git fact`);
  }
});

test('T226 not_detected requires a complete search; incomplete searches are unverified', async (t) => {
  const empty = await runFixture('t226-empty', {});
  t.after(() => cleanupRun(empty));
  for (const dimension of SIX_NEW_DIMENSIONS) {
    assert.equal(newDimensionStatus(empty.result)[dimension], 'not_detected', `${dimension}: empty repo is a factual absence`);
    const findings = findingsFor(empty.result, dimension);
    if (dimension === 'deployment') {
      // The deployment model carries counts instead of a search space; a
      // factual absence is proven by zero records on an unread empty repo.
      assert.deepEqual(findings.counts, {
        artifacts: 0, resources: 0, images: 0, services: 0, edges: 0,
        stubs: 0, indicators: 0, diagnostics: 0, crossArtifactEdges: 0,
      });
    } else {
      assert.equal(findings.searchSpace.complete, true, `${dimension}: empty repo search is complete`);
    }
  }

  // >512 source files trip the API sampling cap -> incomplete search -> unverified.
  const capped = { 'package.json': JSON.stringify({ name: 't226-capped', type: 'module' }) };
  for (let index = 0; index < 560; index++) capped[`src/mod${index}.js`] = `export const v${index} = ${index};\n`;
  const cappedRun = await runFixture('t226-capped', capped);
  t.after(() => cleanupRun(cappedRun));
  const api = findingsFor(cappedRun.result, 'api');
  assert.equal(api.searchSpace.complete, false);
  assert.equal(api.searchSpace.capped, true);
  assert.ok(api.searchSpace.omittedCount > 0, 'skipped eligible source files must be disclosed');
  assert.equal(newDimensionStatus(cappedRun.result).api, 'unverified', 'a capped API search is unverified, never not_detected');

  // A malformed/anchored OpenAPI contract yields an unsupported diagnostic
  // while the search itself stays complete and never invents operations.
  const unsupported = {
    'package.json': JSON.stringify({ name: 't226-unsupported', type: 'module' }),
    'openapi.yaml': [
      'openapi: 3.0.0',
      'defaults: &base',
      '  x: 1',
      'paths:',
      '  /a:',
      '    get: *base',
      '',
    ].join('\n'),
  };
  const unsupportedRun = await runFixture('t226-unsupported', unsupported);
  t.after(() => cleanupRun(unsupportedRun));
  const unsupportedApi = findingsFor(unsupportedRun.result, 'api');
  assert.deepEqual(unsupportedApi.operations, []);
  assert.ok(unsupportedApi.diagnostics.some(({ status, reason }) => status === 'unsupported' && reason === 'PARSE_UNSUPPORTED'),
    'unsupported template constructs are disclosed, never evaluated');
  assert.equal(unsupportedApi.searchSpace.complete, true, 'the read search stays complete; the format is what is unsupported');
});

// ---------------------------------------------------------------------------
// Privacy hazards
// ---------------------------------------------------------------------------

test('T226 privacy hazards are sanitized or downgraded across all fixtures', async (t) => {
  const canaries = [
    'alice.smith@example.test',
    't226-py-super-secret-token-value-42',
    'user:pass@db.example.test',
    'ghp_js_secret_fixture_token_99',
    'TSFixturePassw0rd',
    'rs-fixture-super-secret',
    'reviewer@example.test',
  ];
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-privacy-${name}`, files);
    t.after(() => cleanupRun(run));
    const blob = `${serializedDeep(run.result)}\n${run.result.markdown}`;
    for (const canary of canaries) {
      assert.equal(blob.includes(canary), false, `${name}: ${canary} must never reach findings or NORMS.md`);
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-repository relationships
// ---------------------------------------------------------------------------

test('T226 cross-repo: shared exact reference is retained as ambiguity, never a fabricated edge', async (t) => {
  const run = await runRepos('t226-cross-shared', [repoA, repoB]);
  t.after(() => cleanupRun(run));
  const { result } = run;
  assert.equal(result.global.metrics.repositories, 2, 'both repository identities are retained');
  assert.equal(result.global.metrics.crossRepositoryEdges, 0, 'an ambiguous exact reference never becomes an edge');
  assert.equal(result.global.metrics.ambiguous, 2, 'the shared exact reference is disclosed as ambiguous from both sides');
  assert.deepEqual(result.global.edges.edges, [], 'no edge is fabricated from two identical candidates');
  assert.ok(result.markdown.includes('## Cross-repository Architecture'));
});

test('T226 cross-repo: single-candidate exact references resolve to edges through the production pipeline', async (t) => {
  const run = await runRepos('t226-cross-single', [repoASingle, repoBSingle]);
  t.after(() => cleanupRun(run));
  const { result } = run;
  assert.equal(result.global.metrics.repositories, 2);
  assert.equal(result.global.metrics.edges, 2, 'each unique exact reference resolves to exactly one edge');
  assert.equal(result.global.metrics.selfEdges, 2, 'a single candidate that is the owner is a self-edge');
  assert.equal(result.global.metrics.crossRepositoryEdges, 0);
  assert.equal(result.global.metrics.ambiguous, 0);
});

test('T226 cross-repo: the production synthesis resolves an exact cross-repository reference into one edge', async () => {
  const snapshot = synthesizeCrossRepository({
    repositories: [
      {
        scanId: 'scan-aaaaaaaaaaaaaaaaaaaaaaaa',
        vcs: 'https://github.com/acme/consumer.git',
        contracts: ['ConsumerService'],
        events: [],
        componentRoots: [],
        manifests: [],
        workspaceNames: [],
        iac: [],
      },
      {
        scanId: 'scan-bbbbbbbbbbbbbbbbbbbbbbbbbb',
        vcs: 'https://github.com/acme/provider.git',
        contracts: ['OrderService'],
        events: [],
        componentRoots: [],
        manifests: [],
        workspaceNames: [],
        iac: [],
      },
    ],
    references: [
      {
        scanId: 'scan-aaaaaaaaaaaaaaaaaaaaaaaa',
        kind: 'contract',
        value: 'OrderService',
        path: 'proto/order.proto',
        sourceKind: 'contract',
      },
    ],
  });
  assert.equal(snapshot.metrics.repositories, 2);
  assert.equal(snapshot.metrics.edges, 1);
  assert.equal(snapshot.metrics.crossRepositoryEdges, 1, 'an exact unambiguous reference forms a cross-repository edge');
  assert.equal(snapshot.edges.edges[0].targetKind, 'repository');
  assert.equal(snapshot.edges.edges[0].self, false);
  assert.equal(snapshot.metrics.ambiguous, 0);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('T226 determinism: fixed clock produces byte-identical repeated runs', async (t) => {
  for (const { name, files } of FIXTURES) {
    const repoPath = makeFixture(`t226-det-${name}`, files);
    const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t226-det-out-'));
    t.after(() => cleanupFixture(repoPath));
    t.after(() => rm(outDir, { recursive: true, force: true }));
    const options = {
      repos: [repoPath],
      clock: () => '2026-08-03',
    };
    const first = await runExpandedPipeline({ ...options, out: join(outDir, 'first.md') });
    const second = await runExpandedPipeline({ ...options, out: join(outDir, 'second.md') });
    assert.equal(first.markdown, second.markdown, `${name}: repeated runs on the same fixture must be byte-identical`);
    assert.equal(first.generated, '2026-08-03');
    assert.equal(await readFile(join(outDir, 'first.md'), 'utf8'), await readFile(join(outDir, 'second.md'), 'utf8'));
  }
  const crossA = makeFixture('t226-det-cross-a', repoA);
  const crossB = makeFixture('t226-det-cross-b', repoB);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t226-det-cross-out-'));
  t.after(() => { cleanupFixture(crossA); cleanupFixture(crossB); });
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = { repos: [crossA, crossB], clock: () => '2026-08-03' };
  const first = await runExpandedPipeline({ ...options, out: join(outDir, 'first.md') });
  const second = await runExpandedPipeline({ ...options, out: join(outDir, 'second.md') });
  assert.equal(first.markdown, second.markdown, 'cross-repo: repeated runs on the same fixtures must be byte-identical');
});

// ---------------------------------------------------------------------------
// Integration contract: the exported production pipeline only
// ---------------------------------------------------------------------------

test('T226 fixtures run through the exported production pipeline, never a reconstructed dispatch', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  assert.doesNotMatch(source, /lib\/scan\/deep\//);
  assert.match(source, /runExpandedPipeline/);
  const runSource = await readFile(join(ROOT, 'lib', 'scan', 'pipeline', 'run.mjs'), 'utf8');
  assert.match(runSource, /export async function runExpandedPipeline/);
});
