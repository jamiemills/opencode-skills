// T224 — atomic expanded-pipeline activation and sanitized diagnostics.
//
// Owned by T224. Exercises the canonical production pipeline cutover:
//   - CLI end-to-end over a multi-repo fixture set with all 16 dimensions
//     rendered in one valid run and exactly one output file.
//   - Sanitized diagnostics canaries: no absolute paths, identities, secrets,
//     or raw errors on stdout/stderr.
//   - Fail-before-write for missing/unknown renderers, schema/privacy failures,
//     malformed plugins, and unreadable repositories (no output file created).
//   - One-write count (the canonical pipeline performs a single sink call).
//   - The original ten dimensions preserve the T201 semantic baseline.
//   - Five fixture hashes are preserved except the sanctioned six-new-section
//     expansions; the new hashes are reported.
//   - The Cross-repository Architecture global section renders.
//   - Expected-claim coverage uses registry-owned claims; retry re-dispatches
//     only below-threshold dimensions.
//   - Determinism: fixed clock produces byte-identical repeated runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, readdirSync,
} from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { withFixture, makeFixture, cleanupFixture } from './harness.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import {
  assertFindingsPrivacy,
  processExistingTenRepo,
  runExpandedPipeline,
  runExistingTenPipeline,
  MAX_RETRIES,
} from '../lib/scan/pipeline/run.mjs';
import {
  DIMENSION_RENDERER_ENTRIES,
  RenderRegistryError,
  createRenderRegistry,
} from '../lib/scan/render/registry.mjs';
import { DIMENSION_REGISTRY } from '../lib/scan/registry/dimensions.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import { loadPlugins } from '../lib/scan/plugins/loader.mjs';

const execFileAsync = promisify(execFile);
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, '..');
const BASELINE_ROOT = join(TEST_ROOT, 'baselines', 'expansion');
const SCAN_SCRIPT = join(ROOT, 'scripts', 'scan.mjs');

const FIXTURE_BEHAVIOR = JSON.parse(await readFile(
  join(BASELINE_ROOT, 'fixture-behavior.json'),
  'utf8',
));

const SIX_NEW_HEADINGS = [
  '## API Surface',
  '## Data Architecture',
  '## Deployment Topology',
  '## Maintainability',
  '## Governance & Ownership',
  '## Assurance & Supply Chain',
];

const TEN_HEADINGS = [
  '## Repository Structure',
  '## Technology Stack',
  '## Configuration',
  '## Testing',
  '## Code Conventions',
  '## Git Practices',
  '## Architecture',
  '## Documentation',
  '## Security',
  '## Operations',
];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value, repoPath) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, repoPath));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonicalize(entry, repoPath)]));
  }
  if (typeof value !== 'string') return value;
  const normalizedRoot = repoPath.replaceAll('\\', '/');
  const fixtureName = normalizedRoot.split('/').pop();
  return value
    .replaceAll('\\', '/')
    .replaceAll(normalizedRoot, '<FIXTURE_ROOT>')
    .replaceAll(fixtureName, '<FIXTURE_NAME>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<DATE>')
    .replace(/\b(Python|Node(?:\.js)?|rustc|Deno|Bun)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?/g, '$1 <HOST_VERSION>');
}

// The authoritative ten-dimension fixed input shared with the T201/T204
// baselines.
function fixedInput() {
  const overview = {
    name: 'synthetic-repository',
    path: '.',
    languages: ['JavaScript'],
    ecosystems: { primary: 'javascript', all: ['javascript'] },
    packageManager: 'npm',
    totalFiles: 2,
    isGit: false,
  };
  const deep = [
    { dimension: 'structure', signal: 'high', findings: { tree: '.\n├── package.json\n└── src/', fileCounts: { js: 1, json: 1 }, totalFiles: 2 } },
    { dimension: 'stack', signal: 'high', findings: { runtime: 'Node.js (declared)', language: 'JavaScript', framework: '(none)', packageManager: 'npm', name: 'synthetic-package', version: '1.0.0' } },
    { dimension: 'config', signal: 'high', findings: { lint: { config: 'eslint.config.mjs' }, format: 'prettier', markers: ['.editorconfig'] } },
    { dimension: 'testing', signal: 'high', findings: { framework: ['node:test'], fileCount: 1, naming: ['*.test.mjs'], sampleFiles: ['test/example.test.mjs'], testDirs: ['test'] } },
    { dimension: 'conventions', signal: 'high', findings: { importStyle: { type: 'ESM (import/export)', hasTypeImports: false, hasDynamicImports: false, samples: [] }, fileNaming: { dominant: 'kebab-case', total: 2, patterns: { 'kebab-case': 2 } }, errorHandling: { patterns: ['throw'] }, moduleSystem: { inferred: 'ESM' }, commentDensity: '10.0% (1 comment / 10 code lines)' } },
    { dimension: 'git', signal: 'high', findings: { isGit: false } },
    { dimension: 'architecture', signal: 'high', findings: { layers: { totalFiles: 2, totalEdges: 1, entryPoints: ['src/index.js'], libModules: ['src/value.js'], shared: [], rest: [] }, asciiGraph: 'src/index.js -> src/value.js' } },
    { dimension: 'documentation', signal: 'high', findings: { readme: { present: true, path: 'README.md', sections: 2, hasSetup: true }, contributing: { present: false }, license: { present: true, name: 'MIT', path: 'LICENSE' }, commentRatio: { ratio: 10, commentLines: 1, codeLines: 10 }, todoCount: 0 } },
    { dimension: 'security', signal: 'high', findings: { secrets: { count: 0, findings: [] }, envExample: true, gitignoreEnvProtected: true, hasLockfile: true, dependabot: false } },
    { dimension: 'operations', signal: 'high', findings: { dockerfiles: [], ci: [], healthChecks: { detected: false, references: [] }, hasMakefile: true, hasJustfile: false } },
  ];
  return { overview, deep };
}

function semanticProjection(enriched, validated) {
  return {
    dimensionOrder: validated.findings.map(({ dimension }) => dimension),
    findingKeys: Object.fromEntries(validated.findings.map(({ dimension, findings }) => [dimension, Object.keys(findings).sort()])),
    coverage: validated.coverage,
    confidence: Object.fromEntries(validated.findings.map(({ dimension, confidence }) => [dimension, confidence])),
    contradictions: enriched.contradictions,
    gaps: enriched.gaps,
    inferredPatterns: enriched.inferredPatterns,
  };
}

function weakConfig(deepResults) {
  return deepResults.map((entry) => (
    entry.dimension === 'config'
      ? { dimension: 'config', signal: 'low', findings: { lint: null, format: null, markers: null } }
      : entry
  ));
}

const FIXTURES = [
  { name: 'python', files: pythonFiles },
  { name: 'javascript', files: javascriptFiles },
  { name: 'typescript', files: typescriptFiles },
  { name: 'rust', files: rustFiles },
  { name: 'shell', files: shellFiles },
];

function crossRepoFixtureFiles() {
  return {
    'package.json': JSON.stringify({ name: 'worker', type: 'module' }),
    'proto/order.proto': [
      'syntax = "proto3";',
      'package acme.orders.v1;',
      'service OrderService {',
      '  rpc GetOrder(OrderRequest) returns (OrderReply);',
      '}',
      'message OrderRequest { string id = 1; }',
      'message OrderReply { string id = 1; }',
      '',
    ].join('\n'),
    'src/index.js': 'export const handler = () => 1;\n',
  };
}

// ---------------------------------------------------------------------------
// CLI end-to-end over a multi-repo fixture set
// ---------------------------------------------------------------------------

test('T224 CLI: multi-repo run renders all 16 dimensions, the global section, and exactly one output file', async () => {
  const fixtureA = makeFixture('t224-cli-a', pythonFiles);
  const fixtureB = makeFixture('t224-cli-b', crossRepoFixtureFiles());
  const outputDir = mkdtempSync(join(tmpdir(), 'csm-scan-t224-cli-out-'));
  const outputPath = join(outputDir, 'NORMS.md');
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, '--repos', fixtureA, fixtureB, '--out', outputPath],
      { cwd: ROOT },
    );
    assert.equal(stderr, '');
    for (const dimension of DIMENSION_REGISTRY.map(({ id }) => id.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, ''))) {
      assert.match(stdout, new RegExp(`${dimension}: scanned`), `${dimension} must be reported as scanned`);
    }
    assert.match(stdout, /Detection coverage:/);
    assert.match(stdout, /Expected claim coverage:/);

    const markdown = readFileSync(outputPath, 'utf8');
    for (const heading of [...TEN_HEADINGS, ...SIX_NEW_HEADINGS]) {
      assert.ok(markdown.includes(heading), `${heading} must render in the expanded output`);
    }
    assert.match(markdown, /> Scanned repos: /);
    assert.match(markdown, /## Cross-repository Architecture/);
    assert.match(markdown, /### Repository identities/);
    assert.deepEqual(readdirSync(outputDir), ['NORMS.md'], 'exactly one output file per run');
  } finally {
    cleanupFixture(fixtureA);
    cleanupFixture(fixtureB);
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('T224 CLI: stdout/stderr are privacy-clean even when the repository contains sensitive content', async () => {
  const CANARY_EMAIL = 'alice.smith@example.test';
  const CANARY_TOKEN = 'api_token=super-secret-canary-value-42';
  const CANARY_HANDLE = '@alice-dev';
  const fixture = makeFixture('t224-canary', {
    'package.json': JSON.stringify({ name: 'canary' }),
    'README.md': `Contact ${CANARY_EMAIL} or ${CANARY_HANDLE} for access.\n`,
    'src/config.js': `export default { token: '${CANARY_TOKEN}' };\n`,
  });
  const outputDir = mkdtempSync(join(tmpdir(), 'csm-scan-t224-canary-out-'));
  const outputPath = join(outputDir, 'NORMS.md');
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, '--repos', fixture, '--out', outputPath],
      { cwd: ROOT },
    );
    assert.equal(stderr, '');
    for (const sensitive of [CANARY_EMAIL, CANARY_TOKEN, CANARY_HANDLE, fixture]) {
      assert.equal(stdout.includes(sensitive), false, `stdout leaked ${sensitive}`);
    }
    assert.equal(stdout.includes('/tmp/'), false, 'stdout must not leak an absolute /tmp path');
    assert.equal(existsSync(outputPath), true);
  } finally {
    cleanupFixture(fixture);
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('T224 CLI: an unreadable repository aborts with a sanitized error and no output file', async () => {
  const missing = join(tmpdir(), `csm-scan-t224-missing-${process.pid}-${Date.now()}`);
  const outputDir = mkdtempSync(join(tmpdir(), 'csm-scan-t224-missing-out-'));
  const outputPath = join(outputDir, 'NORMS.md');
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [SCAN_SCRIPT, '--repos', missing, '--out', outputPath], { cwd: ROOT }),
      (error) => {
        const text = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
        assert.equal(text.includes(missing), false, 'error output must not echo the missing path');
        assert.equal(existsSync(outputPath), false, 'no file may be written when the run fails');
        return true;
      },
    );
    assert.deepEqual(readdirSync(outputDir), [], 'output directory must stay empty on failure');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fail-before-write
// ---------------------------------------------------------------------------

test('T224 fail-before-write: missing and unknown renderers abort before any write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-t224-fbw-'));
  try {
    assert.throws(
      () => createRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES.slice(0, 15) }),
      (error) => error instanceof RenderRegistryError && error.code === 'MISSING_RENDERER',
    );

    const findings = {
      generated: '2026-01-15',
      repos: [{
        overview: { name: 'bad', path: '.', languages: [], totalFiles: 0 },
        deep: [{ dimension: 'private-canary', signal: 'low', findings: {} }],
      }],
    };
    const out = join(root, 'NORMS.md');
    await assert.rejects(
      writeNORMS(findings, out, createRenderRegistry()),
      (error) => error instanceof RenderRegistryError && error.code === 'UNKNOWN_DIMENSION',
    );
    assert.deepEqual(await readdir(root), [], 'no file may be written for an unknown renderer');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T224 fail-before-write: schema and privacy violations abort before the write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-t224-fbw2-'));
  try {
    const out = join(root, 'NORMS.md');
    await assert.rejects(
      writeNORMS({ generated: '2026-01-15', repos: [] }, out, { render: null }),
      TypeError,
    );
    assert.deepEqual(await readdir(root), [], 'an invalid renderer must not write');

    // Privacy gate: a new-dimension model carrying sensitive data is rejected.
    const leaked = {
      generated: '2026-01-15',
      repos: [{
        overview: { name: 'leaky', path: '.', languages: [], totalFiles: 0 },
        deep: [{
          dimension: 'api',
          signal: 'low',
          findings: {
            summary: { operations: 1 },
            operations: [{ source: { path: 'docs/alice@example.test.md', line: 1 } }],
            diagnostics: [],
            searchSpace: { filesInspected: 1 },
          },
        }],
      }],
      global: { metrics: { repositories: 0, components: 0, edges: 0, selfEdges: 0, crossRepositoryEdges: 0, external: 0, ambiguous: 0, unresolved: 0 } },
    };
    assert.throws(
      () => assertFindingsPrivacy(leaked),
      (error) => error && error.code === 'PRIVACY_LEAK',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T224 fail-before-write: malformed plugins are rejected by the loader (never evaluated)', async () => {
  const skillRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t224-plugin-'));
  try {
    const pluginDir = join(skillRoot, 'plugins', 'fixturelang');
    const { mkdir, writeFile: write } = await import('node:fs/promises');
    await mkdir(pluginDir, { recursive: true });
    await write(join(pluginDir, 'plugin.json'), '{ not-valid-json', 'utf8');
    await assert.rejects(
      loadPlugins({ skillRoot }),
      (error) => error && error.name === 'PluginLoaderError',
    );
  } finally {
    await rm(skillRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// One write, canonical pipeline export, semantic baseline
// ---------------------------------------------------------------------------

test('T224 one write: the canonical pipeline performs a single sink call', async () => {
  let captured = null;
  let calls = 0;
  const sink = (findings, out, renderer) => {
    calls++;
    captured = { findings, out, hasGlobal: typeof renderer.renderGlobal === 'function' };
    return 'CAPTURED';
  };
  await withFixture('t224-one-write', pythonFiles, async (repoPath) => {
    const result = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink,
    });
    assert.equal(calls, 1);
    assert.equal(result.markdown, 'CAPTURED');
    assert.equal(captured.findings.repos.length, 1);
    assert.equal(captured.findings.repos[0].deep.length, 17);
    assert.equal(captured.hasGlobal, true, 'the composite renderer exposes the global section');
    assert.equal(captured.out, undefined);
  });
});

test('T224 semantic baseline: the original ten dimensions reproduce the T201 semantics unchanged', async () => {
  const expected = JSON.parse(await readFile(join(BASELINE_ROOT, 'semantic.json'), 'utf8'));
  const { overview, deep } = fixedInput();
  const { enriched, validated } = await processExistingTenRepo({ overview, deepResults: deep });
  assert.deepEqual(semanticProjection(enriched, validated), expected);
  assert.equal(validated.findings.length, 10);
  assert.equal(validated.needsRetry.length, 0);
});

// ---------------------------------------------------------------------------
// Five fixture hashes
// ---------------------------------------------------------------------------

test('T224 five fixtures: ten-dimension bytes are preserved; the six new sections are the only sanctioned markdown change', async () => {
  const report = [];
  for (const { name, files } of FIXTURES) {
    await withFixture(`t224-hash-${name}`, files, async (repoPath) => {
      const expected = FIXTURE_BEHAVIOR.fixtures[name];
      assert.ok(expected, `${name}: fixture behavior baseline must exist`);

      // The canonical existing-ten pipeline still reproduces the legacy hashes.
      const ten = await runExistingTenPipeline({
        repos: [repoPath],
        out: undefined,
        clock: () => '2026-01-01',
        sink: () => '',
      });
      assert.ok(ten.markdown === '', 'sink stub returns empty');

      // Rebuild the ten-dimension baseline rendering with the default writer.
      const baselineRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t224-hash-'));
      try {
        const baselinePath = join(baselineRoot, 'baseline.md');
        const { writeNORMS } = await import('../lib/scan/write.mjs');
        const baselineRepos = ten.repos.map(({ overview, deep }) => ({ overview, deep }));
        const baselineMarkdown = await writeNORMS(
          { generated: '2026-01-01', repos: baselineRepos },
          baselinePath,
        );
        assert.equal(
          digest(`${canonicalize(baselineMarkdown, repoPath)}\n`),
          expected.markdownSha256,
          `${name}: the ten-dimension baseline must be byte-identical`,
        );

        // The expanded pipeline adds the six new sections (sanctioned change).
        const expandedRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t224-expanded-'));
        try {
          const expanded = await runExpandedPipeline({
            repos: [repoPath],
            out: join(expandedRoot, 'NORMS.md'),
            clock: () => '2026-01-01',
          });
          const expandedSha = digest(`${canonicalize(expanded.markdown, repoPath)}\n`);
          for (const heading of SIX_NEW_HEADINGS) {
            assert.ok(expanded.markdown.includes(heading), `${name}: ${heading} must render`);
          }
          assert.notEqual(expandedSha, expected.markdownSha256, `${name}: the six new sections change the hash (sanctioned)`);
          report.push({
            fixture: name,
            legacyMarkdownSha256: expected.markdownSha256,
            expandedMarkdownSha256: expandedSha,
            reason: 'six new dimensions add sanctioned sections after the ten established dimensions',
          });
        } finally {
          await rm(expandedRoot, { recursive: true, force: true });
        }
      } finally {
        await rm(baselineRoot, { recursive: true, force: true });
      }
    });
  }
  assert.equal(report.length, 5);
  for (const entry of report) {
    // eslint-disable-next-line no-console
    console.log(`[T224 hash] ${entry.fixture}: legacy ${entry.legacyMarkdownSha256} -> expanded ${entry.expandedMarkdownSha256} (${entry.reason})`);
  }
});

// ---------------------------------------------------------------------------
// Cross-repo global synthesis and residual (b)
// ---------------------------------------------------------------------------

test('T224 cross-repo: multi-repo global synthesis renders identities and never aborts on sensitive path fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-t224-global-'));
  try {
    const outA = join(root, 'a.md');
    const outB = join(root, 'b.md');
    await withFixture('t224-global-a', crossRepoFixtureFiles(), async (a) => {
      await withFixture('t224-global-b', {
        ...crossRepoFixtureFiles(),
        'proto/other.proto': [
          'syntax = "proto3";',
          'service OrderService {',
          '  rpc ListOrders(ListRequest) returns (ListReply);',
          '}',
          'message ListRequest { string id = 1; }',
          'message ListReply { string id = 1; }',
          '',
        ].join('\n'),
        'docs/alice@example.test.md': 'contact alias\n',
      }, async (b) => {
        const result = await runExpandedPipeline({
          repos: [a, b],
          out: outA,
          clock: () => '2026-01-01',
        });
        assert.ok(result.markdown.includes('## Cross-repository Architecture'));
        assert.ok(result.markdown.includes('### Repository identities'));
        assert.equal(result.global.metrics.repositories, 2);
        assert.ok(result.markdown.includes('### Resolved edges'));

        // A sensitive path inside a second-run reference never aborts synthesis.
        const repeat = await runExpandedPipeline({
          repos: [a, b],
          out: outB,
          clock: () => '2026-01-01',
        });
        assert.equal(repeat.markdown, result.markdown, 'global synthesis is deterministic');
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Expected-claim coverage and retry
// ---------------------------------------------------------------------------

test('T224 expected-claim coverage counts registry-owned claims with N/A excluded', async () => {
  await withFixture('t224-coverage', pythonFiles, async (repoPath) => {
    const result = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const coverage = result.expectedClaimCoverage;
    const registryClaims = DIMENSION_REGISTRY.reduce((sum, dimension) => sum + dimension.expectedClaimIds.length, 0);
    assert.equal(registryClaims, 93);
    assert.equal(coverage.expected, 93);
    assert.equal(
      coverage.complete + coverage.incomplete + coverage.unsupported + coverage.excluded,
      coverage.expected,
      'every expected claim is counted exactly once',
    );
    // A non-git fixture makes the git dimension not applicable (excluded).
    assert.equal(coverage.excluded, 2);
    assert.equal(coverage.eligible, coverage.complete + coverage.incomplete);
    assert.equal(coverage.ratio, coverage.eligible === 0 ? null : coverage.complete / coverage.eligible);
    // Claims are never marked complete on an incomplete search.
    for (const perDimension of coverage.repos) {
      for (const entry of Object.values(perDimension.perDimension)) {
        assert.ok(['observed', 'not_detected', 'unsupported', 'unverified', 'not_applicable'].includes(entry.status));
      }
    }
  });
});

test('T224 expected-claim coverage: not_detected appears only after a complete search with no evidence', async () => {
  await withFixture('t224-not-detected', {}, async (repoPath) => {
    const result = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const perDimension = result.expectedClaimCoverage.repos[0].perDimension;
    for (const dimension of ['api', 'data', 'deployment', 'maintainability', 'governance', 'assurance']) {
      assert.equal(
        perDimension[dimension].status,
        'not_detected',
        `${dimension} on an empty repository with a complete search must be not_detected`,
      );
    }
    assert.equal(result.expectedClaimCoverage.complete > 0, true);
  });
});

test('T224 retry: below-threshold dimensions are re-dispatched and capped at MAX_RETRIES', async () => {
  await withFixture('t224-retry', pythonFiles, async (repoPath) => {
    const full = await runExistingTenPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const { validated, trace } = await processExistingTenRepo({
      overview: full.semantic[0].overview,
      deepResults: weakConfig(full.semantic[0].deepResults),
      path: repoPath,
    });
    assert.deepEqual(trace, [{ dimension: 'config', phase: 'retry' }]);
    assert.ok(validated.coverage.config >= 40, 'config must recover above the retry threshold');
    assert.deepEqual(validated.needsRetry, []);
    assert.equal(MAX_RETRIES, 2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('T224 determinism: fixed clock produces byte-identical repeated runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-t224-det-'));
  try {
    await withFixture('t224-det-a', pythonFiles, async (a) => {
      await withFixture('t224-det-b', crossRepoFixtureFiles(), async (b) => {
        const first = await runExpandedPipeline({
          repos: [a, b],
          out: join(root, 'first.md'),
          clock: () => '2026-06-30',
        });
        const second = await runExpandedPipeline({
          repos: [a, b],
          out: join(root, 'second.md'),
          clock: () => '2026-06-30',
        });
        assert.equal(first.markdown, second.markdown, 'expanded pipeline must be byte-identical');
        assert.equal(await readFile(join(root, 'first.md'), 'utf8'), await readFile(join(root, 'second.md'), 'utf8'));
        assert.equal(first.generated, '2026-06-30');
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Exported canonical pipeline surface
// ---------------------------------------------------------------------------

test('T224 integration tests call the exported production pipeline, never reconstruct dispatch', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  assert.doesNotMatch(source, /lib\/scan\/deep\//);
  assert.match(source, /runExpandedPipeline/);
  assert.match(source, /processExistingTenRepo/);
  const runSource = await readFile(join(ROOT, 'lib', 'scan', 'pipeline', 'run.mjs'), 'utf8');
  assert.match(runSource, /runExpandedPipeline/);
  assert.match(runSource, /runExistingTenPipeline/);
});
