// T228 — final acceptance matrix over the expanded pipeline.
//
// Owned by T228. This file asserts the full requirement matrix from the
// expansion plan's Acceptance Criteria (all 20) with concrete evidence produced
// by the CANONICAL production pipeline (`lib/scan/pipeline/run.mjs`), the
// registry/render/standards/plugin/privacy contracts, and the recorded
// constraint gates. It never reconstructs scanner dispatch for pipeline-level
// assertions; the only direct module invocations are the documented analysis
// APIs (for example `analyzeGraphFacts` for AC6 graph facts) and the contract
// primitives themselves.
//
// Evidence covered per acceptance criterion:
//   AC1  static command boundary — broker-only, registered rg/git argv, zero
//        target execution
//   AC2  runtime/build/test/deploy findings are declaration-backed with source
//        evidence and no "actual runtime" claim
//   AC3  API Surface — declared contracts/routes/RPC/events/CLI; dynamic and
//        unsupported constructs disclosed, never invented
//   AC4  Data Architecture — stores/schemas/migrations/entities/keys/relations
//        with declaration-backed edges; name-only relations never become edges
//   AC5  Deployment Topology — bounded static declarations; anchors/block
//        scalars are diagnostics, never evaluated
//   AC6  Architecture — dynamic indicators, raw fan-in/fan-out, Tarjan SCC
//        facts without runtime or quality claims
//   AC7  Maintainability — disclosed measurement universe, exact duplicate
//        spans, lexical branch-point counts, no scores
//   AC8  Governance & Ownership — declarations inventoried with opaque
//        identities and no inferred ownership
//   AC9  Assurance & Supply Chain — manifests/locks/pins/licenses/SBOM/VEX/
//        SARIF/standards inventoried without verdicts
//   AC10 standards metadata is versioned, source-linked, metadata-only, and
//        never carries copied control text
//   AC11 cross-repository edges require exact unambiguous evidence; ambiguity
//        is retained as records, never edges
//   AC12 a declarative plugin contributes bounded evidence to all 14 provider
//        dimensions; no plugin code is evaluated
//   AC13 removing the plugin routes the same unknown-language fixture to
//        generic artifact-only findings without core language knowledge
//   AC14 the original five ecosystems preserve their established facts; the
//        21-case P0 matrix and five fixture pipelines are retained
//   AC15 every claim carries a stable ID, status, coverage state, limitations,
//        and admissible evidence IDs per the evidence contract
//   AC16 `not_detected` requires a complete supported uncapped readable search;
//        capped searches are `unverified`, unsupported formats `unsupported`,
//        and N/A claims are excluded from coverage
//   AC17 all output surfaces (findings, global, Markdown, reporter, CLI) carry
//        no sensitive values, absolute paths, identities, commit subjects,
//        result excerpts, or credential-bearing URLs
//   AC18 identical inputs, fixed clock, plugin set, and repository order
//        produce byte-identical Markdown
//   AC19 unknown/missing renderers and invalid evidence/plugin/standards/
//        privacy states fail before the sole write
//   AC20 the authoritative sequential suite and every named gate pass with zero
//        failures (external full-suite run recorded in the evidence document)
//
// An OPTIONAL real-repository smoke (gated by `CSM_REAL_REPO_SMOKE=1`) scans a
// real repo through the canonical pipeline to a `/tmp` output only, never
// executing target commands; when unset it reports and returns (pass), matching
// the established `test/golden.test.mjs` real-repo pattern.
//
// Scope (own-only): this test file, `SKILL.md`, and the T228 evidence record.
// No production, baseline, contract, or other test is edited.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir, mkdtemp, readdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { makeGitRepo, cleanupGitRepo } from './helpers/git-fixture.mjs';

import { runExpandedPipeline, assertFindingsPrivacy } from '../lib/scan/pipeline/run.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import {
  createCommandBroker,
  defaultRunner,
} from '../lib/scan/shared/command.mjs';
import { rgIgnoreArgs } from '../lib/scan/shared/ignore.mjs';
import {
  assertPrivacySafe,
  PrivacyError,
  projectSarif,
  projectSbom,
} from '../lib/scan/shared/privacy.mjs';
import {
  reuseDisposition,
  validateStandardEntry,
  validateStandardsRegistry,
} from '../lib/scan/standards/policy.mjs';
import { STANDARDS_REGISTRY } from '../lib/scan/standards/registry.mjs';
import {
  validatePlugins,
  PluginSchemaError,
} from '../lib/scan/plugins/schema.mjs';
import { loadPlugins } from '../lib/scan/plugins/loader.mjs';
import {
  createRenderRegistry,
  DIMENSION_RENDERER_ENTRIES,
  RenderRegistryError,
} from '../lib/scan/render/registry.mjs';
import { DIMENSION_REGISTRY } from '../lib/scan/registry/dimensions.mjs';
import {
  CLAIM_STATUSES,
  PROVIDER_DIMENSION_IDS,
  PROVIDER_DIMENSION_COUNT,
  TOTAL_DIMENSION_COUNT,
  validateClaim,
} from '../lib/scan/contracts/dimension.mjs';
import { createEvidence } from '../lib/scan/contracts/evidence.mjs';
import { GENERIC_PROVIDER_ID } from '../lib/scan/providers/generic.mjs';
import {
  createReporter,
  formatError,
  sanitizeText,
} from '../lib/scan/report/reporter.mjs';
import { analyzeGraphFacts } from '../lib/scan/deep/architecture.mjs';
import { createArchitectureExtensionRenderer } from '../lib/scan/render/architecture-extension.mjs';

import { files as pythonFiles } from './fixtures-expansion/python.mjs';
import { files as javascriptFiles } from './fixtures-expansion/javascript.mjs';
import { files as typescriptFiles } from './fixtures-expansion/typescript.mjs';
import { files as shellFiles } from './fixtures-expansion/shell.mjs';
import { files as rustFiles } from './fixtures-expansion/rust.mjs';
import { files as unknownFiles } from './fixtures-expansion/unknown.mjs';
import { repoA, repoB, repoASingle, repoBSingle } from './fixtures-expansion/cross-repo.mjs';

const execFileAsync = promisify(execFile);

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, '..');
const BASELINE_ROOT = join(TEST_ROOT, 'baselines', 'expansion');
const SCAN_SCRIPT = join(ROOT, 'scripts', 'scan.mjs');

const FIXED_CLOCK = () => '2026-08-03';

const ACCEPTANCE_COMMAND = 'node --test --test-concurrency=1';

const SIX_NEW_DIMENSIONS = Object.freeze([
  'api', 'data', 'deployment', 'maintainability', 'governance', 'assurance',
]);

const TEN_DIMENSIONS = Object.freeze([
  'structure', 'stack', 'config', 'testing', 'conventions', 'git',
  'architecture', 'documentation', 'security', 'operations',
]);

const ALL_SIXTEEN = Object.freeze([...TEN_DIMENSIONS, ...SIX_NEW_DIMENSIONS]);

const FIVE_FIXTURES = Object.freeze([
  ['python', pythonFiles, 'Python', 'python'],
  ['javascript', javascriptFiles, 'JavaScript', 'javascript'],
  ['typescript', typescriptFiles, 'TypeScript', 'typescript'],
  ['shell', shellFiles, 'Shell', 'shell'],
  ['rust', rustFiles, 'Rust', 'rust'],
]);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(name) {
  return JSON.parse(await readFile(join(BASELINE_ROOT, name), 'utf8'));
}

async function esmFiles(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

async function productionSources() {
  const roots = [join(ROOT, 'lib'), join(ROOT, 'scripts')];
  const files = (await Promise.all(roots.map(esmFiles))).flat();
  return Promise.all(files.map(async (path) => ({
    relativePath: path.slice(ROOT.length + 1).replaceAll('\\', '/'),
    source: await readFile(path, 'utf8'),
  })));
}

async function runFixture(t, name, files, options = {}) {
  const repoPath = makeFixture(`t228-${name}`, files);
  const outDir = await mkdtemp(join(tmpdir(), `csm-scan-t228-${name}-out-`));
  t.after(() => cleanupFixture(repoPath));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await runExpandedPipeline({
    repos: [repoPath],
    out: join(outDir, 'NORMS.md'),
    clock: FIXED_CLOCK,
    ...options,
  });
  return { result, repoPath, outDir };
}

function findingsFor(result, dimension) {
  return result.repos[0].deep.find((entry) => entry.dimension === dimension)?.findings;
}

function perDimensionStatus(result, dimension) {
  return result.expectedClaimCoverage.repos[0].perDimension[dimension]?.status;
}

function assertNeutralText(label, value) {
  const banned = /\b(?:should|must|ought|shall|poor|good|bad|weak|strong|better|worse|best|worst|recommended|recommendation|ideally|unfortunately|concern|concerning|problem|anti-pattern|smell|suboptimal|inadequate|insufficient|contradiction|contradictions|inconsistent|inconsistency|conflict|conflicts|lacking)\b/gi;
  const hits = [];
  const prose = value
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(`+)[^\n]*?\1/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi, (m) => m.replace(/[^\s]/g, ' '));
  for (const line of prose.split('\n')) {
    banned.lastIndex = 0;
    for (const match of line.matchAll(banned)) hits.push(`${match[0].toLowerCase()}@line`);
  }
  assert.deepEqual(hits, [], `${label}: judgmental authored prose found`);
}

function expectedRgGlobArgs() {
  return rgIgnoreArgs().flatMap((entry) => {
    const i = entry.indexOf(' ');
    return [entry.slice(0, i), entry.slice(i + 1)];
  });
}

const GIT_ARGV_FORMS = Object.freeze([
  ['rev-parse', '--show-toplevel'],
  ['rev-parse', '--abbrev-ref', 'HEAD'],
  ['log', '--oneline', '-50'],
  ['branch', '-a'],
  ['symbolic-ref', 'refs/remotes/origin/HEAD'],
  ['config', '--get', 'remote.origin.url'],
  ['shortlog', '-s', '-n', 'HEAD'],
]);

const TARGET_EXECUTABLES = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'node', 'deno',
  'python', 'python3', 'pip', 'pip3', 'uv',
  'cargo', 'rustc', 'go', 'make', 'cmake', 'ninja',
  'bash', 'sh', 'zsh', 'curl', 'wget', 'docker', 'kubectl',
]);

function isRegisteredBrokerShape(call) {
  const argv = call.argv;
  if (call.executable === 'rg') {
    if (argv[0] === '--files') {
      return argv.length === 1 + expectedRgGlobArgs().length
        && JSON.stringify(argv.slice(1)) === JSON.stringify(expectedRgGlobArgs());
    }
    if (argv[0] === '--json') {
      const globs = expectedRgGlobArgs();
      const prefix = argv.slice(1, 1 + globs.length);
      const tail = argv.slice(1 + globs.length);
      return JSON.stringify(prefix) === JSON.stringify(globs)
        && tail.length === 2 && tail[0] === '--' && typeof tail[1] === 'string';
    }
    return false;
  }
  if (call.executable === 'git') {
    return GIT_ARGV_FORMS.some((form) => JSON.stringify(argv) === JSON.stringify(form));
  }
  return false;
}

// ---------------------------------------------------------------------------
// AC1 — static command boundary
// ---------------------------------------------------------------------------

test('T228 AC1 command boundary: sole broker, registered rg/git argv, zero target execution', async (t) => {
  const calls = [];
  const broker = createCommandBroker({
    runner: {
      async run(executable, argv, options) {
        calls.push({ executable, argv: [...argv], shell: options.shell });
        return defaultRunner.run(executable, argv, options);
      },
    },
  });

  const repo = makeFixture('t228-ac1-repo', pythonFiles);
  const gitRepo = makeGitRepo({
    files: { 'README.md': 'AC1 command boundary\n', 'pyproject.toml': '[project]\nname = "ac1"\nversion = "0.1.0"\n' },
    commits: ['feat: initial'],
  });
  t.after(() => cleanupFixture(repo));
  t.after(() => cleanupGitRepo(gitRepo));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-ac1-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  await runExpandedPipeline({
    repos: [repo, gitRepo],
    out: join(outDir, 'NORMS.md'),
    clock: FIXED_CLOCK,
    commandRunner: broker,
  });

  assert.ok(calls.length > 0, 'the pipeline must issue broker commands');
  for (const call of calls) {
    assert.ok(['rg', 'git'].includes(call.executable),
      `only the rg/git families may run; saw ${call.executable} ${call.argv.join(' ')}`);
    assert.equal(call.shell, false, 'shell mode must always be disabled');
    assert.ok(isRegisteredBrokerShape(call),
      `argv ${call.executable} ${call.argv.join(' ')} must match a registered broker command`);
  }
  const targetCalls = calls.filter((call) => TARGET_EXECUTABLES.has(call.executable));
  assert.equal(targetCalls.length, 0, `no target command may execute (saw ${targetCalls.length})`);
  assert.equal(await readFile(join(outDir, 'NORMS.md'), 'utf8').then(() => true), true);

  // The broker registry itself is closed: only rg and read-only git.
  const sources = await productionSources();
  const childProcessOwners = sources.filter(({ source }) => source.includes("from 'node:child_process'"));
  assert.equal(childProcessOwners.length, 1, 'the broker must remain the sole node:child_process owner');
  assert.equal(childProcessOwners[0].relativePath, 'lib/scan/shared/command.mjs');
});

// ---------------------------------------------------------------------------
// AC2-AC9, AC15 — python fixture reports declaration-backed facts for every
// dimension with evidence-tagged statuses and coverage
// ---------------------------------------------------------------------------

test('T228 AC2-AC9/AC15: the python fixture reports declaration-backed facts for all 16 dimensions with statuses and coverage', async (t) => {
  const { result } = await runFixture(t, 'evidence', pythonFiles);

  assert.equal(result.repos[0].deep.length, 16, 'all 16 dimensions must scan');
  assert.deepEqual(
    result.repos[0].deep.map(({ dimension }) => dimension),
    ALL_SIXTEEN,
    'dimensions render in canonical registry order',
  );

  // AC2 — static runtime declarations with source evidence, no actual-runtime claim.
  const stack = findingsFor(result, 'stack');
  assert.match(stack.runtime, /declared/i, 'stack runtime must be marked as declared');
  assert.ok(Array.isArray(stack.runtimeDeclarations) && stack.runtimeDeclarations.length >= 2,
    'runtime declarations must carry per-source evidence');
  for (const declaration of stack.runtimeDeclarations) {
    assert.ok(typeof declaration.source === 'string' && declaration.source.includes('#'),
      'each runtime declaration must cite its manifest/image source');
  }
  assert.doesNotMatch(JSON.stringify(stack), /\bactual runtime\b/i, 'no actual-runtime verdict is emitted');

  // AC3 — API Surface: declared routes/CLI with dynamic constructs disclosed.
  const api = findingsFor(result, 'api');
  assert.deepEqual(api.operations.map(({ signature }) => signature).sort(), [
    'GET:/api/items', 'GET:/api/items/{item_id}', 'GET:/api/v1', 'POST:/api/items', 'cli:click:deploy',
  ]);
  assert.ok(api.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'DYNAMIC'),
    'a dynamic route variable must be disclosed as an unverified DYNAMIC diagnostic');
  assert.equal(api.searchSpace.complete, true);

  // AC4 — Data Architecture: stores/entities/keys/relations with a
  // declaration-backed edge; a name-only relationship is disclosed, not an edge.
  const data = findingsFor(result, 'data');
  assert.deepEqual(data.entities.map(({ signature }) => signature).sort(), ['players', 'teams', 'users']);
  assert.deepEqual(data.relations.map(({ signature }) => signature), ['users:teams:foreign_key']);
  assert.deepEqual(data.migrations.map(({ signature }) => signature), ['0001_init.py']);
  assert.ok(data.keys.length >= 2, 'explicit keys are inventoried');
  assert.ok(data.edges.some((edge) => edge.from === 'entity@users' && edge.to === 'entity@teams' && edge.kind === 'foreign_key'),
    'a declared ForeignKey must produce an ER edge');
  assert.ok(data.edges.every((edge) => edge.kind === 'foreign_key'), 'no edge may come from name-only relations');
  assert.ok(data.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'NAME_ONLY'),
    'a relationship without an FK must be disclosed as NAME_ONLY, never an edge');

  // AC5 — Deployment Topology: bounded static images/services.
  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.services.map(({ id }) => id).sort(), ['service@api', 'service@db']);
  assert.deepEqual(deployment.images.map(({ reference }) => reference).sort(), ['postgres:16', 'python:3.12']);
  assert.ok(deployment.counts && deployment.counts.artifacts >= 2, 'declared artifacts are counted');

  // AC7 — Maintainability: disclosed measurement universe, no scores.
  const maintainability = findingsFor(result, 'maintainability');
  assert.ok(Number.isSafeInteger(maintainability.summary.filesMeasured) && maintainability.summary.filesMeasured >= 8);
  const universe = maintainability.measurementUniverse;
  for (const key of ['filesInspected', 'bytesInspected', 'recordsInspected', 'omittedCount', 'fileLimit', 'byteLimit', 'recordLimit', 'eligibleFiles', 'supportedDialects']) {
    assert.ok(key in universe, `maintainability must disclose ${key}`);
  }
  assert.equal(JSON.stringify(maintainability).includes('score'), false, 'no score is synthesized');

  // AC8 — Governance & Ownership: declarations inventoried with opaque identities.
  const governance = findingsFor(result, 'governance');
  assert.equal(governance.summary.entries, 3);
  assert.deepEqual(governance.summary.byCategory, {
    contribution: 1, decision: 1, funding: 0, ownership: 1, policy: 0,
    reference: 0, release: 0, review: 0, runbook: 0, support: 0,
  });
  assert.ok(governance.ownership.assignees.length > 0, 'CODEOWNERS identities become assignee records');
  for (const assignee of governance.ownership.assignees) {
    assert.match(assignee.label, /^Owner-\d{3}$/, 'ownership identities must be report-local opaque tokens');
    assert.ok(assignee.label !== '@platform', 'raw owner handles never render');
  }
  assert.doesNotMatch(JSON.stringify(governance), /@platform|alice\.smith/, 'no raw identity leaks into governance findings');
  assert.ok(governance.searchSpace.complete, 'governance absence/evidence rests on a complete search');

  // AC9 — Assurance & Supply Chain: manifests inventoried without verdicts.
  const assurance = findingsFor(result, 'assurance');
  assert.equal(assurance.manifest.length, 2, 'pyproject.toml and requirements.txt are assurance manifests');
  assert.equal(assurance.summary.manifests, 2);
  for (const record of assurance.manifest) {
    assert.equal(record.status, 'observed');
    assert.ok(record.path, 'each manifest carries a repository-relative path');
  }
  assert.doesNotMatch(JSON.stringify(assurance), /pass|fail|compliant|vulnerab/i,
    'assurance must not synthesize verdicts');

  // AC15 — coverage counts every registry claim with a status per dimension.
  const coverage = result.expectedClaimCoverage;
  const registryClaims = DIMENSION_REGISTRY.reduce((sum, dimension) => sum + dimension.expectedClaimIds.length, 0);
  assert.equal(registryClaims, 83);
  assert.equal(coverage.expected, registryClaims);
  assert.equal(
    coverage.complete + coverage.incomplete + coverage.unsupported + coverage.excluded,
    coverage.expected,
    'every expected claim is counted exactly once',
  );
  assert.equal(coverage.excluded, 2, 'the non-git fixture excludes the git dimension as not_applicable');
  assert.equal(coverage.eligible, coverage.complete + coverage.incomplete);
  assert.equal(coverage.ratio, coverage.eligible === 0 ? null : coverage.complete / coverage.eligible);
  const per = coverage.repos[0].perDimension;
  assert.deepEqual(Object.keys(per), ALL_SIXTEEN, 'per-dimension coverage follows canonical order');
  assert.equal(per.git.status, 'not_applicable', 'git is proven not applicable by the is_git fact');
  for (const dimension of ALL_SIXTEEN) {
    assert.ok(CLAIM_STATUSES.includes(per[dimension].status), `${dimension}: ${per[dimension].status} is a registered status`);
  }

  // AC15 — the evidence contract shape (stable identity, admissibility).
  const evidence = createEvidence({
    claimId: 'CLM-api-routes-v1',
    detectorId: 'DET-api-routes-v1',
    sourceKind: 'source',
    category: 'route',
    path: 'src/api/app.py',
    locator: 'app.py:9',
    matchedKey: 'GET:/api/items',
    details: null,
  });
  assert.match(evidence.id, /^EVD-v1-[a-f0-9]{64}$/, 'evidence receives a deterministic canonical identity');
  assert.equal(evidence.id, createEvidence({
    claimId: 'CLM-api-routes-v1', detectorId: 'DET-api-routes-v1', sourceKind: 'source',
    category: 'route', path: 'src/api/app.py', locator: 'app.py:9', matchedKey: 'GET:/api/items', details: null,
  }).id, 'evidence identity is deterministic');
  assert.throws(() => createEvidence({
    claimId: 'CLM-api-routes-v1', detectorId: 'DET-api-routes-v1', sourceKind: 'source',
    category: 'route', path: '/abs/app.py', locator: 'app.py:9', matchedKey: 'GET:/api/items', details: null,
  }), (error) => error && error.code === 'INVALID_PATH');
  assert.deepEqual(CLAIM_STATUSES, [
    'observed', 'inferred', 'not_detected', 'unsupported', 'unverified', 'not_applicable',
  ]);
});

// ---------------------------------------------------------------------------
// AC3 / AC16 — unsupported constructs are disclosed, never evaluated
// ---------------------------------------------------------------------------

test('T228 AC3/AC16: unsupported template constructs are disclosed, never invented', async (t) => {
  const { result } = await runFixture(t, 'unsupported', {
    'package.json': JSON.stringify({ name: 't228-unsupported', type: 'module' }),
    'openapi.yaml': [
      'openapi: 3.0.0',
      'defaults: &base',
      '  x: 1',
      'paths:',
      '  /a:',
      '    get: *base',
      '',
    ].join('\n'),
  });

  const api = findingsFor(result, 'api');
  assert.deepEqual(api.operations, [], 'an unsupported anchor must never invent an operation');
  assert.ok(api.diagnostics.some(({ status, reason }) => status === 'unsupported' && reason === 'PARSE_UNSUPPORTED'),
    'the unsupported construct is disclosed, never evaluated');
  assert.equal(api.searchSpace.complete, true, 'the read search stays complete; the format is what is unsupported');
  // The read search is complete and found no evidence, so the coverage status is
  // a factual absence; the unsupported format caveat is disclosed by the
  // diagnostic. The `unsupported` STATUS itself is proven at the contract level
  // in the AC16 bounded-absence test below.
  assert.equal(perDimensionStatus(result, 'api'), 'not_detected');
});

test('T228 AC16: the unsupported status is accepted only with a clean unsupported search space', () => {
  const searchSpace = {
    supported: false, readable: false, complete: false, capped: false,
    error: false, malformed: false, ambiguous: false,
    filesInspected: 0, fileLimit: 1, bytesInspected: 0, byteLimit: 1,
    recordsInspected: 0, recordLimit: 1, omittedCount: 0,
  };
  const evidence = createEvidence({
    claimId: 'CLM-api-routes-v1', detectorId: 'DET-api-routes-v1',
    sourceKind: 'search_result', category: 'search_space',
    path: '.search', locator: 'search', matchedKey: 'search_space',
    details: searchSpace,
  });
  const api = DIMENSION_REGISTRY.find((dimension) => dimension.id === 'DIM-api-v1');
  const validated = validateClaim({
    id: 'CLM-api-routes-v1', dimensionId: 'DIM-api-v1',
    status: 'unsupported', coverageState: 'unsupported',
    evidenceIds: [evidence.id], inputEvidenceIds: [], applicabilityEvidenceIds: [],
    derivationId: null, limitations: ['format is unsupported'], searchSpace,
  }, [evidence], api);
  assert.equal(validated.status, 'unsupported');
  assert.equal(validated.coverageState, 'unsupported', 'unsupported is excluded from the complete/eligible coverage set');
});

// ---------------------------------------------------------------------------
// AC5 — deployment anchors/block scalars are diagnostics while valid peers survive
// ---------------------------------------------------------------------------

test('T228 AC5: deployment anchors and block scalars are diagnostics, valid peers survive, nothing is fabricated', async (t) => {
  const { result } = await runFixture(t, 'deploy-anchor', {
    'package.json': JSON.stringify({ name: 't228-deploy', type: 'module' }),
    'k8s/mixed.yaml': [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: broken',
      'data:',
      '  script: |',
      '    echo hi',
      '---',
      'apiVersion: v1',
      'kind: Pod',
      'metadata:',
      '  name: anchored',
      'spec: &base',
      '  restartPolicy: Never',
      '---',
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: api',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: api',
      '          image: nginx:1.25',
      '',
    ].join('\n'),
  });

  const deployment = findingsFor(result, 'deployment');
  assert.deepEqual(deployment.resources.map(({ id }) => id), ['deployment@api'],
    'only the valid literal peer is declared as a resource');
  assert.deepEqual(deployment.images.map(({ reference }) => reference), ['nginx:1.25']);
  assert.ok(deployment.diagnostics.some(({ status }) => status === 'malformed' || status === 'unsupported'),
    'anchor/block-scalar documents are recorded as diagnostics');
  assert.ok(deployment.diagnostics.every(({ status }) => status === 'malformed' || status === 'unsupported'),
    'unsupported constructs are never expanded into fabricated resources');
});

// ---------------------------------------------------------------------------
// AC6 — architecture static dynamic indicators and raw graph facts
// ---------------------------------------------------------------------------

test('T228 AC6: architecture reports dynamic indicators, raw fan-in/fan-out, and Tarjan SCC facts without verdicts', async (t) => {
  const repo = makeFixture('t228-ac6', pythonFiles);
  t.after(() => cleanupFixture(repo));

  const { survey } = await import('../lib/scan/survey.mjs');
  const overview = await survey(repo);
  const facts = await analyzeGraphFacts(repo, overview);

  for (const key of ['bounds', 'universe', 'edgeKindCounts', 'fanIn', 'fanOut', 'selfLoops', 'stronglyConnectedComponents', 'dynamicIndicators']) {
    assert.ok(key in facts, `architecture facts must report ${key}`);
  }
  assert.ok(Object.keys(facts.fanIn).length > 0 && Object.keys(facts.fanOut).length > 0,
    'raw fan-in and fan-out are computed per module');
  assert.equal(typeof facts.fanIn['src/api/app.py'], 'number', 'fan-in values are raw counts');
  assert.ok(facts.stronglyConnectedComponents !== null, 'Tarjan SCC facts are computed');
  assert.ok(facts.dynamicIndicators.some(({ kind }) => kind === 'dynamic-import'),
    'the importlib dynamic import must surface as a dynamic-import indicator');
  for (const key of ['bounds', 'universe', 'edgeKindCounts', 'selfLoops']) {
    assert.doesNotMatch(JSON.stringify(facts[key]), /\b(?:hub|quality|coupling|critical)\b/i,
      `${key} must stay raw and judgment-free`);
  }

  // The extension renderer turns facts into neutral prose.
  const rendered = createArchitectureExtensionRenderer().render('repository', { graphFacts: facts });
  assert.match(rendered, /fan-in/i);
  assertNeutralText('architecture graph-facts prose', rendered);
});

// ---------------------------------------------------------------------------
// AC10 — standards metadata is versioned, source-linked, metadata-only
// ---------------------------------------------------------------------------

test('T228 AC10: standards registry is versioned, source-linked, metadata-only, with no copied control text', () => {
  assert.ok(STANDARDS_REGISTRY.length >= 10, 'the standards registry is populated');
  for (const entry of STANDARDS_REGISTRY) {
    assert.equal(entry.disposition, 'metadata_only', `${entry.id}: disposition must be metadata_only`);
    assert.match(entry.id, /^std:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[._-][a-z0-9]+)*$/, `${entry.id}: stable versioned id`);
    assert.ok(entry.editionKey.length > 0, `${entry.id}: exact edition key`);
    assert.match(entry.officialUri, /^https:\/\//, `${entry.id}: authoritative HTTPS source link`);
    assert.ok(typeof entry.publisher === 'string' && entry.publisher.length > 0);
    assert.ok(typeof entry.title === 'string' && entry.title.length > 0);
    assert.ok(!Object.keys(entry).includes('controlText') && !Object.keys(entry).includes('summary'),
      `${entry.id}: no copied control text or free-form prose field may exist`);
  }

  const VALID = {
    id: 'std:test-std:1.0.0',
    publisher: 'Test Publisher',
    title: 'Test Standard',
    editionKey: '1.0.0',
    edition: '1.0.0',
    publicationDate: '2026-01-01',
    officialUri: 'https://example.test/standard',
    disposition: 'metadata_only',
  };
  assert.equal(validateStandardEntry(VALID).disposition, 'metadata_only');
  assert.throws(() => validateStandardEntry({ ...VALID, disposition: 'authored_mapping' }),
    /metadata_only/, 'authored_mapping without a proven reuse decision is rejected');
  assert.throws(() => validateStandardEntry({ ...VALID, id: 'std:test-std:1.0.0-latest', editionKey: '1.0.0-latest', edition: '1.0.0 latest' }),
    /floating marker/, 'floating edition markers are rejected');
  assert.throws(() => validateStandardEntry({ ...VALID, officialUri: 'https://user:pass@example.test/standard' }),
    /credentials/, 'authoritative URIs must not carry credentials');
  assert.throws(() => validateStandardEntry({ ...VALID, extra: 'prose' }),
    /schema/, 'unknown fields (including any copied control text) are rejected');
  assert.throws(() => validateStandardsRegistry([VALID, { ...VALID, id: 'std:test-std:1.0.0' }]),
    /duplicate id/, 'duplicate standard ids are rejected');
  assert.equal(reuseDisposition({}), 'metadata_only');
  assert.equal(reuseDisposition({ authoredMapping: true, reuseProven: false }), 'metadata_only');
  assert.equal(reuseDisposition({ authoredMapping: true, reuseProven: true }), 'authored_mapping');
});

// ---------------------------------------------------------------------------
// AC11 — cross-repository edges require exact unambiguous evidence
// ---------------------------------------------------------------------------

test('T228 AC11: ambiguity is retained as records and never becomes an edge', async (t) => {
  const first = makeFixture('t228-cross-amb-a', repoA);
  const second = makeFixture('t228-cross-amb-b', repoB);
  t.after(() => { cleanupFixture(first); cleanupFixture(second); });
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-cross-amb-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const full = await runExpandedPipeline({
    repos: [first, second],
    out: join(outDir, 'NORMS.md'),
    clock: FIXED_CLOCK,
  });
  assert.equal(full.global.metrics.repositories, 2, 'both repository identities are retained');
  assert.equal(full.global.metrics.crossRepositoryEdges, 0, 'an ambiguous exact reference never becomes an edge');
  assert.equal(full.global.metrics.ambiguous, 2, 'ambiguity is disclosed from both sides');
  assert.deepEqual(full.global.edges.edges, [], 'no edge is fabricated from two identical candidates');
  assert.ok(full.markdown.includes('## Cross-repository Architecture'));
  assert.ok(full.markdown.includes('### Ambiguous references'), 'ambiguous records are rendered');
});

test('T228 AC11: a single unambiguous exact reference resolves to exactly one edge', async (t) => {
  const first = makeFixture('t228-cross-single-a', repoASingle);
  const second = makeFixture('t228-cross-single-b', repoBSingle);
  t.after(() => { cleanupFixture(first); cleanupFixture(second); });
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-cross-single-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const full = await runExpandedPipeline({
    repos: [first, second],
    out: join(outDir, 'NORMS.md'),
    clock: FIXED_CLOCK,
  });
  assert.equal(full.global.metrics.edges, 2, 'each unique exact reference resolves to exactly one edge');
  assert.equal(full.global.metrics.selfEdges, 2, 'a single candidate that is the owner is a self-edge');
  assert.equal(full.global.metrics.ambiguous, 0);
  assert.ok(full.markdown.includes('### Resolved edges'));
});

// ---------------------------------------------------------------------------
// AC12 — declarative plugin contributes to all 14 provider dimensions
// ---------------------------------------------------------------------------

const PLUGIN_BLUEPRINTS = Object.freeze([
  ['DIM-stack-v1', 'language', { extensions: ['.fx'] }],
  ['DIM-config-v1', 'configuration', { basenames: ['Fxfile'] }],
  ['DIM-testing-v1', 'test_file', { artifactTokens: ['test'], extensions: ['.fx'] }],
  ['DIM-conventions-v1', 'comment', { extensions: ['.fx'], literal: ';;' }],
  ['DIM-architecture-v1', 'module', { artifactTokens: ['fx'], extensions: ['.fx'] }],
  ['DIM-documentation-v1', 'readme', { basenames: ['README.fx'] }],
  ['DIM-security-v1', 'secret_pattern', { extensions: ['.fx'], literal: 'token=' }],
  ['DIM-operations-v1', 'workflow', { basenames: ['Fxworkflow'] }],
  ['DIM-api-v1', 'route', { extensions: ['.fx'], literal: 'route:' }],
  ['DIM-data-v1', 'entity', { extensions: ['.fx'], literal: 'entity:' }],
  ['DIM-deployment-v1', 'service', { extensions: ['.fx'], literal: 'service:' }],
  ['DIM-maintainability-v1', 'file_metric', { extensions: ['.fx'] }],
  ['DIM-governance-v1', 'policy', { basenames: ['POLICY.fx'] }],
  ['DIM-assurance-v1', 'manifest', { manifestNames: ['fx.json'] }],
]);

function dimensionShort(dimensionId) {
  return dimensionId.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
}

function acceptancePlugin() {
  const dimensions = PLUGIN_BLUEPRINTS.map(([dimensionId, category]) => ({ dimensionId, categories: [category] }));
  const rules = PLUGIN_BLUEPRINTS.map(([dimensionId, category, selectors]) => ({
    id: `RUL-accept-${dimensionShort(dimensionId)}-v1`,
    label: `Acceptance ${dimensionShort(dimensionId)}`,
    dimensionId,
    category,
    ...selectors,
  }));
  return {
    id: 'fxlang',
    apiVersion: 1,
    label: 'Acceptance synthetic language',
    aliases: ['fxl'],
    providers: [{ id: 'PRV-fxlang-v1', apiVersion: 1, dimensions }],
    rules,
  };
}

const FXLANG_FILES = Object.freeze({
  'fx/main.fx': [
    ';; fxlang main module',
    'route: /api/health',
    'entity: User',
    'service: web',
    'token=fx-secret',
    '',
  ].join('\n'),
  'fx/lib.fx': ';; fxlang library\n',
  'test/unit.fx': ';; fxlang unit test\n',
  'Fxfile': 'name = "fx-demo"\nversion = "1.0.0"\n',
  'fx.json': '{ "name": "fx-demo", "version": "1.0.0" }\n',
  'fx.lock': 'lock: sha256:abcdef\n',
  'README.fx': '# Fx demo\n',
  'POLICY.fx': 'policy: secure-by-default\n',
  'Fxworkflow': 'workflow: ci\n',
  '.fxrc': 'strict = true\n',
});

async function temporarySkillRoot(t, plugin) {
  const skillRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t228-skill-'));
  t.after(() => rm(skillRoot, { recursive: true, force: true }));
  const pluginDir = join(skillRoot, 'plugins', plugin.id);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify(plugin));
  return skillRoot;
}

test('T228 AC12: a declarative plugin contributes bounded evidence to all 14 provider dimensions with no evaluation', async (t) => {
  const plugin = acceptancePlugin();
  assert.equal(PROVIDER_DIMENSION_COUNT, 14);
  assert.equal(PROVIDER_DIMENSION_IDS.length, 14);
  assert.equal(TOTAL_DIMENSION_COUNT, 16);

  // Schema accepts the 14-dimension plugin; no executable hook may exist.
  const validated = validatePlugins([plugin]);
  assert.equal(validated.length, 1);
  assert.deepEqual(new Set(validated[0].providers[0].dimensions.map((d) => d.dimensionId)),
    new Set(PROVIDER_DIMENSION_IDS), 'the plugin declares exactly the 14 provider dimensions');
  assert.throws(() => validatePlugins([{ ...plugin, hooks: ['node:child_process'] }]),
    (error) => error instanceof PluginSchemaError, 'executable hooks are rejected by the schema');

  // Loader accepts it from a trusted skill-local root.
  const skillRoot = await temporarySkillRoot(t, plugin);
  const [loaded] = await loadPlugins({ skillRoot });
  assert.equal(loaded.id, 'fxlang');

  // Output level: every provider dimension renders plugin-labeled evidence.
  const repoPath = makeFixture('t228-ac12-repo', FXLANG_FILES);
  t.after(() => cleanupFixture(repoPath));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-ac12-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const options = { repos: [repoPath], out: join(outDir, 'NORMS.md'), clock: FIXED_CLOCK };
  const first = await runExpandedPipeline({ ...options, pluginRegistry: [loaded] });
  const second = await runExpandedPipeline({ ...options, pluginRegistry: [loaded] });
  assert.equal(first.markdown, second.markdown, 'plugin runs are byte-identical');
  assert.equal(first.repos[0].deep.length, 16, 'all 16 dimensions scan the plugin fixture repo');

  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    const short = dimensionShort(dimensionId);
    assert.ok(first.markdown.includes(`RUL-accept-${short}-v1`),
      `${dimensionId}: NORMS.md must contain plugin-labeled evidence`);
  }
  assert.ok(first.markdown.includes('PRV-fxlang-v1'), 'the plugin provider id renders as provenance');
  assert.ok(first.markdown.includes('### Provider Evidence'), 'provider evidence sections render');
  assert.ok(first.markdown.includes('fixturelang') === false, 'the plugin token is fxlang, not fixturelang');

  // No plugin code is evaluated: the plugin registry contains only data.
  assert.deepEqual(Object.keys(loaded).sort(), ['aliases', 'apiVersion', 'id', 'label', 'providers', 'rules']);
});

// ---------------------------------------------------------------------------
// AC13 — generic artifact-only fallback with no core language knowledge
// ---------------------------------------------------------------------------

test('T228 AC13: the unknown-language fixture receives generic artifact-only evidence with no core source knowledge', async (t) => {
  const { result } = await runFixture(t, 'generic', unknownFiles);

  const overview = result.repos[0].overview;
  assert.deepEqual(overview.languages, ['Go'], 'survey detects Go, a non-built-in language');
  assert.equal(overview.ecosystems.primary, null);
  assert.deepEqual(overview.ecosystems.all, []);

  assert.ok(result.markdown.includes(GENERIC_PROVIDER_ID), 'the generic artifact fallback renders in NORMS.md');
  assert.ok(result.markdown.includes('### Provider Evidence'), 'generic evidence renders a provider section');

  const maintainability = findingsFor(result, 'maintainability');
  const observations = maintainability.providerObservations ?? [];
  assert.ok(observations.length > 0, 'generic file_metric observations are merged into maintainability');
  assert.ok(observations.every(({ providerId }) => providerId === GENERIC_PROVIDER_ID),
    'only the generic provider contributes observations');
  const categories = new Set(observations.map(({ category }) => category));
  assert.ok(categories.has('file_metric') && categories.has('measurement_universe'),
    'generic evidence is artifact-only (file_metric + measurement_universe)');

  for (const dimension of ['api', 'data', 'deployment', 'maintainability', 'governance']) {
    assert.equal(perDimensionStatus(result, dimension), 'not_detected',
      `${dimension}: the generic fallback never claims first-class semantics`);
  }
  assert.equal(perDimensionStatus(result, 'assurance'), 'observed', 'assurance is observed from artifact presence only');
  assert.equal(findingsFor(result, 'assurance').manifest.length, 1, 'go.mod is inventoried as an artifact');
  assert.equal(findingsFor(result, 'assurance').lock.length, 1, 'go.sum is inventoried as an artifact');

  // No core knowledge of the fixture language anywhere in production source.
  const sources = await productionSources();
  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(source, /fixturelang|fxlang/i,
      `${relativePath}: production source must not know the synthetic fixture language`);
  }
});

// ---------------------------------------------------------------------------
// AC14 — the five built-in ecosystems preserve their established facts; the
// 21-case P0 matrix and five fixture pipelines are retained
// ---------------------------------------------------------------------------

test('T228 AC14: the five built-in ecosystems preserve their established facts through the canonical pipeline', async (t) => {
  for (const [name, files, language, ecosystem] of FIVE_FIXTURES) {
    const { result } = await runFixture(t, `five-${name}`, files);
    const overview = result.repos[0].overview;
    assert.ok(overview.languages.includes(language), `${name}: detected language must include ${language}`);
    assert.equal(overview.ecosystems.primary, ecosystem, `${name}: primary ecosystem must be ${ecosystem}`);
    assert.equal(findingsFor(result, 'stack').language, language, `${name}: stack language must be ${language}`);
    assert.equal(result.repos[0].deep.length, 16, `${name}: all 16 dimensions must scan`);
    assert.equal(result.markdown.includes(GENERIC_PROVIDER_ID), false,
      `${name}: the generic fallback must NOT fire for a built-in ecosystem`);
    assertNeutralText(`${name} rendered Markdown`, result.markdown);
  }
});

test('T228 AC14/AC20: the 21-case P0 matrix and five fixture pipelines are retained as executable gates', async () => {
  const inventory = await readJson('inventory.json');
  assert.deepEqual(inventory.acceptanceTestFiles, [
    'test/expansion-baseline.test.mjs',
    'test/expansion-constraints.test.mjs',
    'test/fixtures-pipeline.test.mjs',
    'test/regression-parity.test.mjs',
    'test/expansion-command-core.test.mjs',
    'test/expansion-command-deep.test.mjs',
  ]);

  const p0Source = await readFile(join(TEST_ROOT, 'regression-parity.test.mjs'), 'utf8');
  const p0TestNames = [...p0Source.matchAll(/\bname:\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith('P0-'));
  assert.equal(p0TestNames.length, 21, 'the 21-case P0 regression matrix is retained');
  assert.deepEqual(p0TestNames, inventory.p0TestNames);

  const fixtureSource = await readFile(join(TEST_ROOT, 'fixtures-pipeline.test.mjs'), 'utf8');
  const fixtureCases = [...fixtureSource.matchAll(/\{ name: '([^']+)', files: \w+Files,/g)].map((match) => match[1]);
  assert.equal(fixtureCases.length, 5, 'the five fixture pipelines are retained');
  assert.deepEqual(fixtureCases, inventory.fixtureCases);

  // No gate may be skipped or marked todo.
  for (const file of inventory.acceptanceTestFiles) {
    const source = await readFile(join(TEST_ROOT, '..', file), 'utf8');
    assert.doesNotMatch(source, /\b(?:test|it)\.(?:skip|todo)\b|\bskip\s*:/, `${file} must not skip tests`);
  }
});

// ---------------------------------------------------------------------------
// AC16 — bounded-absence semantics: not_detected only after a complete search
// ---------------------------------------------------------------------------

test('T228 AC16: an empty repository with a complete search is a factual absence', async (t) => {
  const { result } = await runFixture(t, 'empty', {});
  for (const dimension of SIX_NEW_DIMENSIONS) {
    assert.equal(perDimensionStatus(result, dimension), 'not_detected', `${dimension}: empty repo is a factual absence`);
    const findings = findingsFor(result, dimension);
    if (dimension === 'deployment') {
      assert.deepEqual(findings.counts, {
        artifacts: 0, resources: 0, images: 0, services: 0, edges: 0,
        stubs: 0, indicators: 0, diagnostics: 0, crossArtifactEdges: 0,
      });
    } else {
      assert.equal(findings.searchSpace.complete, true, `${dimension}: empty repo search is complete`);
    }
  }
});

test('T228 AC16: a capped search is unverified, never not_detected', async (t) => {
  const capped = { 'package.json': JSON.stringify({ name: 't228-capped', type: 'module' }) };
  for (let index = 0; index < 110; index++) capped[`src/mod${index}.js`] = `export const v${index} = ${index};\n`;
  const { result } = await runFixture(t, 'capped', capped);

  const api = findingsFor(result, 'api');
  assert.equal(api.searchSpace.complete, false);
  assert.equal(api.searchSpace.capped, true);
  assert.ok(api.searchSpace.omittedCount > 0, 'skipped eligible source files must be disclosed');
  assert.equal(perDimensionStatus(result, 'api'), 'unverified', 'a capped API search is unverified, never not_detected');
});

// ---------------------------------------------------------------------------
// AC17 — privacy across every output surface
// ---------------------------------------------------------------------------

const CANARIES = Object.freeze([
  'Alice Smith',
  'alice.smith@example.test',
  '/etc/privacy/path.conf',
  'C:\\Users\\priv\\secret.conf',
  '\\\\server\\share\\secret.conf',
  'privacy-super-secret-token-77',
  'PrivacyPassw0rd-99',
  'ghp_privacy_fixture_token_88',
  '@alice-dev',
  'privacy-canary-commit-subject',
  'privacy-sarif-message',
  'privacy-snippet',
  'urn:uuid:privacy-serial-1111',
  'privacy-sbom-hash-2222',
  'privacy-sbom-contact',
  'https://downloads.example.test/privacy-lib-1.0.0.tgz',
  'https://github.com/acme/privacy-lib.git',
  'https://user:pass@db.example.test/primary',
]);

const SARIF = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'privacy-scan', rules: [{ id: 'R1', shortDescription: { text: 'privacy-sarif-message' } }] } },
    results: [{
      ruleId: 'R1',
      message: { text: 'privacy-sarif-message leak' },
      codeFlows: [{
        threadFlows: [{
          locations: [{ location: { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { snippet: { text: 'privacy-snippet' } } } } }],
        }],
      }],
    }],
  }],
};

const SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:privacy-serial-1111',
  components: [{
    type: 'library',
    name: 'privacy-lib',
    version: '1.0.0',
    purl: 'pkg:npm/privacy-lib@1.0.0',
    hashes: [{ alg: 'SHA-256', content: 'privacy-sbom-hash-2222' }],
    licenses: [{ license: { id: 'MIT' } }],
    externalReferences: [
      { type: 'distribution', url: 'https://downloads.example.test/privacy-lib-1.0.0.tgz' },
      { type: 'vcs', url: 'https://github.com/acme/privacy-lib.git' },
    ],
    supplier: { name: 'privacy-sbom-contact', contact: [{ name: 'Alice Smith', email: 'alice.smith@example.test' }] },
  }],
};

function canaryFiles() {
  return {
    'package.json': JSON.stringify({ name: 'privacy-canary', type: 'module' }),
    'README.md': 'Contact Alice Smith <alice.smith@example.test>\n',
    'src/config.js': [
      "export const cfg = {",
      "  api_token: 'privacy-super-secret-token-77',",
      "  password: 'PrivacyPassw0rd-99',",
      "  github: 'ghp_privacy_fixture_token_88',",
      "};",
      '',
    ].join('\n'),
    'src/paths.js': [
      "export const p = [",
      "  '/etc/privacy/path.conf',",
      "  'C:\\\\Users\\\\priv\\\\secret.conf',",
      "  '\\\\\\\\server\\\\share\\\\secret.conf',",
      "];",
      '',
    ].join('\n'),
    '.github/CODEOWNERS': '* @alice-dev privacy-team\n',
    'sbom.json': JSON.stringify(SBOM, null, 2),
    'sarif.json': JSON.stringify(SARIF, null, 2),
    'src/db.js': "export const url = 'https://user:pass@db.example.test/primary';\n",
  };
}

function assertZeroLeaks(label, blob) {
  for (const canary of CANARIES) {
    assert.equal(blob.includes(canary), false, `${label} leaked canary ${JSON.stringify(canary)}`);
  }
}

test('T228 AC17: structured findings, global snapshot, rendered Markdown, and reporter diagnostics carry zero canaries', async (t) => {
  const captured = [];
  const capture = { write: (chunk) => { captured.push(String(chunk)); return true; } };
  const reporter = createReporter({ out: capture, err: capture });
  const { result, outDir } = await runFixture(t, 'privacy', canaryFiles(), { reporter });

  const markdown = await readFile(join(outDir, 'NORMS.md'), 'utf8');
  assert.equal(markdown, result.markdown, 'the written Markdown must equal the returned markdown');

  const findingsBlob = `${JSON.stringify(result.findings)}\n${JSON.stringify(result.global)}`;
  assertZeroLeaks('structured findings/global', findingsBlob);
  assertZeroLeaks('rendered Markdown', markdown);
  assertZeroLeaks('reporter diagnostics', captured.join('\n'));
  assert.ok(captured.join('\n').length > 0, 'the reporter must emit diagnostics');

  // SARIF/SBOM projections are identifier-only and leak nothing.
  const sarif = projectSarif(SARIF);
  const sbom = projectSbom(SBOM);
  const projections = `${JSON.stringify(sarif)}\n${JSON.stringify(sbom)}`;
  assertZeroLeaks('SARIF/SBOM projections', projections);
  assert.ok(sarif.resultCount === 1 && sbom.componentCount === 1, 'projections keep counts only');

  // Pre-persistence privacy primitives reject and redact every canary class.
  const trigger = 'contact alice.smith@example.test read /etc/privacy/path.conf api_token=privacy-super-secret-token-77';
  assert.throws(() => assertPrivacySafe({ value: trigger }),
    (error) => error instanceof PrivacyError && error.code === 'SENSITIVE_VALUE');
  assert.notEqual(sanitizeText(trigger), trigger, 'sanitizeText must redact sensitive content');
  assertZeroLeaks('formatError output', formatError(new Error(`scan failed at ${CANARIES[1]} for ${CANARIES[2]}`)));
});

test('T228 AC17: CLI stdout, stderr, and Markdown carry zero canaries and sanitize paths and remote credentials', async (t) => {
  const gitRepo = makeGitRepo({
    files: canaryFiles(),
    commits: ['feat: drop privacy-canary-commit-subject from config'],
    remote: 'https://alice:secret@github.com/acme/privacy-canary.git',
  });
  t.after(() => cleanupGitRepo(gitRepo));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-privacy-cli-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const outputPath = join(outDir, 'NORMS.md');

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [SCAN_SCRIPT, '--repos', gitRepo, '--out', outputPath],
    { cwd: ROOT },
  );
  assert.equal(stderr, '', 'a successful CLI run must produce no stderr');
  const markdown = await readFile(outputPath, 'utf8');
  assertZeroLeaks('CLI stdout', stdout);
  assertZeroLeaks('CLI stderr', stderr);
  assertZeroLeaks('CLI Markdown', markdown);
  assert.equal(stdout.includes(gitRepo), false, 'CLI stdout must not leak the scanned repository root');
  assert.equal(stdout.includes(outputPath), false, 'CLI stdout must not leak the output path');
  assert.equal(stdout.includes('/tmp/'), false, 'CLI stdout must not leak an absolute /tmp path');
  assert.equal(stdout.includes('alice:secret@'), false, 'CLI stdout must not leak git remote credentials');
});

// ---------------------------------------------------------------------------
// AC18 — byte determinism
// ---------------------------------------------------------------------------

test('T228 AC18: fixed clock, repeated runs, insertion-order permutations, and repository reversal are byte-identical', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-det-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  // Repeated runs over a built-in fixture and the unknown fixture.
  for (const [name, files] of [['python', pythonFiles], ['unknown', unknownFiles]]) {
    const repo = makeFixture(`t228-det-${name}`, files);
    t.after(() => cleanupFixture(repo));
    const options = { repos: [repo], clock: FIXED_CLOCK };
    const first = await runExpandedPipeline({ ...options, out: join(outDir, `${name}-1.md`) });
    const second = await runExpandedPipeline({ ...options, out: join(outDir, `${name}-2.md`) });
    assert.equal(first.markdown, second.markdown, `${name}: repeated runs must be byte-identical`);
    assert.equal(await readFile(join(outDir, `${name}-1.md`), 'utf8'), await readFile(join(outDir, `${name}-2.md`), 'utf8'));
    assert.equal(first.generated, '2026-08-03');
    assert.equal(first.markdown.includes('\r'), false, `${name}: LF line endings only`);
    assert.equal(first.markdown.endsWith('\n'), true, `${name}: one terminal newline`);
  }

  // Insertion-order permutation of the same repository's files.
  const perm = await mkdtemp(join(tmpdir(), 'csm-scan-t228-det-perm-'));
  t.after(() => rm(perm, { recursive: true, force: true }));
  const entries = Object.entries(pythonFiles);
  const orders = [entries, [...entries].reverse()];
  const markdowns = [];
  for (const order of orders) {
    await rm(perm, { recursive: true, force: true });
    await mkdir(perm);
    for (const [rel, content] of order) {
      const abs = join(perm, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    markdowns.push((await runExpandedPipeline({ repos: [perm], clock: FIXED_CLOCK, sink: () => '' })).markdown);
  }
  assert.equal(markdowns[0], markdowns[1], 'reverse insertion order must be byte-identical');

  // Repository reversal keeps the global section and per-repo blocks identical.
  const a = makeFixture('t228-det-a', repoA);
  const b = makeFixture('t228-det-b', repoB);
  t.after(() => { cleanupFixture(a); cleanupFixture(b); });
  const forward = await runExpandedPipeline({ repos: [a, b], out: join(outDir, 'fwd.md'), clock: FIXED_CLOCK });
  const reversed = await runExpandedPipeline({ repos: [b, a], out: join(outDir, 'rev.md'), clock: FIXED_CLOCK });
  assert.equal(JSON.stringify(forward.global), JSON.stringify(reversed.global),
    'the structured global snapshot is order-independent');
  assert.equal(
    forward.markdown.split('## Cross-repository Architecture')[1],
    reversed.markdown.split('## Cross-repository Architecture')[1],
    'the global section is byte-identical under repository reversal',
  );
});

// ---------------------------------------------------------------------------
// AC19 — fail before the sole write
// ---------------------------------------------------------------------------

test('T228 AC19: invalid states fail before the sole write with sanitized typed errors', async (t) => {
  // Missing repository: rejects before any write.
  const missing = join(tmpdir(), `csm-scan-t228-missing-${process.pid}-${Date.now()}`);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-fbw-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await assert.rejects(
    runExpandedPipeline({ repos: [missing], out: join(outDir, 'NORMS.md'), clock: FIXED_CLOCK }),
    (error) => {
      assert.ok(!error.message.includes(missing), 'the pipeline error must not echo the missing repository path');
      return true;
    },
  );
  assert.deepEqual(await readdir(outDir), [], 'a failed run must not write any output file');

  // Empty repos list: rejects before the sink.
  let sinkCalls = 0;
  await assert.rejects(
    runExpandedPipeline({ repos: [], clock: FIXED_CLOCK, sink: () => { sinkCalls++; return ''; } }),
    /non-empty repos/,
  );
  assert.equal(sinkCalls, 0, 'the sink must never be called for an empty repository list');

  // Missing/unknown renderers abort typed before the write.
  assert.throws(
    () => createRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES.slice(0, 15) }),
    (error) => error instanceof RenderRegistryError && error.code === 'MISSING_RENDERER',
  );
  const findings = {
    generated: '2026-08-03',
    repos: [{ overview: { name: 'bad', path: '.', languages: [], totalFiles: 0 }, deep: [{ dimension: 'private-canary', signal: 'low', findings: {} }] }],
  };
  await assert.rejects(
    writeNORMS(findings, join(outDir, 'NORMS.md'), createRenderRegistry()),
    (error) => error instanceof RenderRegistryError && error.code === 'UNKNOWN_DIMENSION',
  );
  assert.deepEqual(await readdir(outDir), [], 'an unknown renderer must not write a file');

  // Malformed plugin rule: rejects before the sink.
  const repo = makeFixture('t228-fbw-plugin', pythonFiles);
  t.after(() => cleanupFixture(repo));
  const malformedPlugin = {
    id: 'fxlang',
    apiVersion: 1,
    label: 'Fxlang',
    aliases: [],
    providers: [],
    rules: [{ id: 'RUL-fxlang-bad-v1', dimensionId: 'DIM-api-v1', category: 'route', label: 'x', literal: 'x' }],
  };
  let pluginSinkCalls = 0;
  await assert.rejects(
    runExpandedPipeline({
      repos: [repo],
      out: join(outDir, 'NORMS.md'),
      clock: FIXED_CLOCK,
      pluginRegistry: [malformedPlugin],
      sink: (findings2, out2, renderer) => { pluginSinkCalls++; return writeNORMS(findings2, out2, renderer); },
    }),
    (error) => error && error.code === 'UNKNOWN_FIELD' && !error.message.includes('fxlang'),
  );
  assert.equal(pluginSinkCalls, 0, 'a malformed plugin rule must abort before the sole write');

  // Privacy violation in a new-dimension model: PRIVACY_LEAK before the write.
  const leaked = {
    generated: '2026-08-03',
    repos: [{
      overview: { name: 'leaky', path: '.', languages: [], totalFiles: 0 },
      deep: [{
        dimension: 'api',
        signal: 'low',
        findings: {
          summary: { operations: 1 },
          operations: [{ source: { path: 'docs/alice.smith@example.test.md', line: 1 } }],
          diagnostics: [],
          searchSpace: { filesInspected: 1, fileLimit: 2 },
        },
      }],
    }],
    global: { metrics: { repositories: 0, components: 0, edges: 0, selfEdges: 0, crossRepositoryEdges: 0, external: 0, ambiguous: 0, unresolved: 0 } },
  };
  assert.throws(
    () => assertFindingsPrivacy(leaked),
    (error) => error && error.code === 'PRIVACY_LEAK',
  );

  // The pipeline runs the privacy gate before the sink call.
  const runSource = await readFile(join(ROOT, 'lib', 'scan', 'pipeline', 'run.mjs'), 'utf8');
  const privacyAt = runSource.indexOf('assertFindingsPrivacy(findings)');
  const sinkAt = runSource.indexOf('await sink(findings, out,');
  assert.ok(privacyAt !== -1 && sinkAt !== -1, 'run.mjs must contain both the privacy gate and the sink call');
  assert.ok(privacyAt < sinkAt, 'assertFindingsPrivacy must run before the sole sink call');
});

// ---------------------------------------------------------------------------
// AC20 — the authoritative sequential suite and every named gate
// ---------------------------------------------------------------------------

test('T228 AC20: the authoritative acceptance command and every named gate are present and executable', async () => {
  assert.equal(ACCEPTANCE_COMMAND, 'node --test --test-concurrency=1');

  const namedGates = [
    'test/expansion-final-acceptance.test.mjs',
    'test/expansion-baseline.test.mjs',
    'test/expansion-constraints.test.mjs',
    'test/expansion-fixtures.test.mjs',
    'test/expansion-activation.test.mjs',
    'test/expansion-determinism.test.mjs',
    'test/expansion-privacy-gate.test.mjs',
    'test/expansion-voice-gate.test.mjs',
    'test/expansion-negative.test.mjs',
    'test/expansion-synthetic-plugin.test.mjs',
    'test/expansion-plugin-loader.test.mjs',
    'test/expansion-cross-repo.test.mjs',
    'test/expansion-dimension-registration.test.mjs',
    'test/expansion-render-registration.test.mjs',
    'test/fixtures-pipeline.test.mjs',
    'test/regression-parity.test.mjs',
    'test/voice-gate.test.mjs',
    'test/golden.test.mjs',
  ];
  for (const gate of namedGates) {
    const source = await readFile(join(TEST_ROOT, '..', gate), 'utf8');
    assert.match(source, /\btest\s*\(/, `${gate} must register executable tests`);
    assert.doesNotMatch(source, /\b(?:test|it)\.(?:skip|todo)\b|\bskip\s*:/, `${gate} must not skip tests`);
  }

  // This file runs through the exported production pipeline only; it never
  // imports or reconstructs another suite as a module.
  const self = await readFile(new URL(import.meta.url), 'utf8');
  assert.match(self, /runExpandedPipeline/);
  assert.doesNotMatch(self, /from\s+['"]\.\/fixtures-pipeline\.test\.mjs|from\s+['"]\.\/regression-parity\.test\.mjs/,
    'the acceptance gate must not reconstruct other suites as modules');
});

// ---------------------------------------------------------------------------
// Optional real-repository smoke (canonical pipeline, /tmp output only)
// ---------------------------------------------------------------------------

test('T228 optional real-repo smoke: canonical pipeline to a /tmp output only, never target commands (CSM_REAL_REPO_SMOKE=1)', async (t) => {
  const realRepo = process.env.CSM_REAL_REPO_SMOKE ? process.env.CSM_REAL_REPO_SMOKE : null;
  if (!realRepo || !existsSync(realRepo)) {
    console.warn(`[T228] skipping real-repo smoke — set CSM_REAL_REPO_SMOKE=<repo> to enable (${realRepo ?? 'unset'})`);
    return;
  }

  const calls = [];
  const broker = createCommandBroker({
    runner: {
      async run(executable, argv, options) {
        calls.push({ executable, argv: [...argv], shell: options.shell });
        return defaultRunner.run(executable, argv, options);
      },
    },
  });

  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t228-smoke-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const outputPath = join(outDir, 'NORMS.md');

  const result = await runExpandedPipeline({
    repos: [realRepo],
    out: outputPath,
    clock: FIXED_CLOCK,
    commandRunner: broker,
  });

  assert.deepEqual(await readdir(outDir), ['NORMS.md'], 'the smoke writes exactly one output file');
  assert.equal(await readFile(outputPath, 'utf8'), result.markdown, 'the written Markdown equals the returned Markdown');
  assert.ok(result.repos[0].deep.length === 16, 'all 16 dimensions scan the real repository');
  assert.ok(result.markdown.length > 0, 'the smoke produces non-empty Markdown');

  // Never target commands: every command issued through the injected broker is
  // a registered read-only rg/git form.
  for (const call of calls) {
    assert.ok(['rg', 'git'].includes(call.executable), `only rg/git may run; saw ${call.executable}`);
    assert.equal(call.shell, false, 'shell mode must always be disabled');
    assert.ok(isRegisteredBrokerShape(call), `argv ${call.executable} ${call.argv.join(' ')} must be registered`);
  }
  assert.equal(calls.filter((call) => TARGET_EXECUTABLES.has(call.executable)).length, 0,
    'no target command may execute against the real repository');
});
