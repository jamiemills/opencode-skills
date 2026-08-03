import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRecordingRunner } from './helpers/recording-runner.mjs';
import { withFixture } from './harness.mjs';
import { runPipeline } from './fixtures-pipeline.test.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { EXISTING_TEN_DIMENSIONS } from '../lib/scan/pipeline/existing-ten.mjs';
import {
  DEFAULT_CLOCK,
  DEFAULT_SINK,
  MAX_RETRIES,
  processExistingTenRepo,
  runExistingTenPipeline,
} from '../lib/scan/pipeline/run.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const BASELINE_ROOT = join(TEST_ROOT, 'baselines', 'expansion');
const FIXTURE_BEHAVIOR = JSON.parse(await readFile(
  join(BASELINE_ROOT, 'fixture-behavior.json'),
  'utf8',
));

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
    { dimension: 'structure', signal: 'high', findings: { tree: '.\n\u251c\u2500\u2500 package.json\n\u2514\u2500\u2500 src/', fileCounts: { js: 1, json: 1 }, totalFiles: 2 } },
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

function crossObservationsSuffix(contradictions) {
  return '## Cross-observations\n\n' + contradictions.map((c) => `- ${c.description}`).join('\n') + '\n';
}

test('T204 canonical pipeline processing reproduces the T201 semantic baseline', async () => {
  const expected = JSON.parse(await readFile(join(BASELINE_ROOT, 'semantic.json'), 'utf8'));
  const { overview, deep } = fixedInput();
  const { enriched, validated } = await processExistingTenRepo({ overview, deepResults: deep });
  assert.deepEqual(semanticProjection(enriched, validated), expected);
  assert.equal(validated.findings.length, 10);
  assert.equal(validated.needsRetry.length, 0);
});

test('T204 default sink reproduces the T201 fixed-input renderer bytes with one write', async () => {
  const expected = await readFile(join(BASELINE_ROOT, 'renderer.md'), 'utf8');
  const { overview, deep } = fixedInput();
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-t204-render-'));
  try {
    const out = join(root, 'NORMS.md');
    const { markdown, findings } = await processExistingTenRepo({
      overview,
      deepResults: deep,
      generated: '2026-01-15',
      sink: DEFAULT_SINK,
      out,
    });
    assert.equal(markdown, expected);
    assert.equal(markdown, await readFile(out, 'utf8'));
    assert.deepEqual(await readdir(root), ['NORMS.md']);
    assert.equal(findings.generated, '2026-01-15');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const FIXTURES = [
  { name: 'python', files: pythonFiles },
  { name: 'javascript', files: javascriptFiles },
  { name: 'typescript', files: typescriptFiles },
  { name: 'rust', files: rustFiles },
  { name: 'shell', files: shellFiles },
];

for (const c of FIXTURES) {
  test(`T204 ${c.name} fixture: canonical pipeline matches the established baseline and the production cross-observations wiring`, async () => {
    await withFixture(`t204-${c.name}`, c.files, async (repoPath) => {
      const expected = FIXTURE_BEHAVIOR.fixtures[c.name];
      assert.ok(expected, `${c.name}: fixture behavior baseline must exist`);

      const old = await runPipeline(repoPath);
      assert.equal(old.semanticSha256, expected.semanticSha256, `${c.name}: reused runPipeline no longer matches the baseline`);
      assert.equal(old.markdownSha256, expected.markdownSha256, `${c.name}: reused runPipeline no longer matches the baseline`);

      const root = await mkdtemp(join(tmpdir(), 'csm-scan-t204-parity-'));
      try {
        const result = await runExistingTenPipeline({
          repos: [repoPath],
          out: join(root, 'NORMS.md'),
          clock: () => '2026-01-01',
        });

        const semantic = canonicalize(result.semantic[0], repoPath);
        assert.equal(digest(`${JSON.stringify(semantic)}\n`), expected.semanticSha256, `${c.name}: canonical pipeline semantic drifted`);

        const baselineRepos = result.repos.map(({ overview, deep }) => ({ overview, deep }));
        const baselineMarkdown = await DEFAULT_SINK(
          { generated: '2026-01-01', repos: baselineRepos },
          join(root, 'baseline.md'),
        );
        assert.equal(baselineMarkdown, old.markdown, `${c.name}: canonical pipeline baseline rendering must equal the reused runPipeline`);
        assert.equal(
          digest(`${canonicalize(baselineMarkdown, repoPath)}\n`),
          expected.markdownSha256,
          `${c.name}: canonical pipeline baseline markdown drifted from the established hash`,
        );

        const crossObs = result.repos[0].crossObservations ?? [];
        assert.deepEqual(crossObs, result.semantic[0].validated.contradictions, `${c.name}: cross-observations wiring mismatch`);
        if (crossObs.length > 0) {
          assert.equal(
            result.markdown,
            baselineMarkdown + '\n' + crossObservationsSuffix(crossObs),
            `${c.name}: canonical pipeline must add exactly the production cross-observations section`,
          );
        } else {
          assert.equal(result.markdown, baselineMarkdown, `${c.name}: canonical pipeline must not alter the baseline bytes without cross-observations`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}

test('T204 pipeline dispatches each existing-ten dimension exactly once in canonical order without retry', async () => {
  await withFixture('t204-once', pythonFiles, async (repoPath) => {
    const result = await runExistingTenPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const initial = result.trace.filter((entry) => entry.phase === 'initial');
    assert.equal(initial.length, 10);
    assert.deepEqual(initial.map((entry) => entry.dimension), EXISTING_TEN_DIMENSIONS);
    const counts = new Map();
    for (const entry of initial) counts.set(entry.dimension, (counts.get(entry.dimension) || 0) + 1);
    for (const dimension of EXISTING_TEN_DIMENSIONS) {
      assert.equal(counts.get(dimension), 1, `${dimension} must be dispatched exactly once`);
    }
    assert.equal(result.trace.filter((entry) => entry.phase === 'retry').length, 0);
    assert.ok(initial.every((entry) => entry.runner === false));
    assert.ok(initial.every((entry) => entry.plugins === 0));
  });
});

test('T204 retry loop re-dispatches only the weak dimension and recovers it from a real re-scan', async () => {
  await withFixture('t204-retry', pythonFiles, async (repoPath) => {
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
  });
});

test('T204 retry loop caps at two iterations when coverage cannot recover', async () => {
  const { overview, deep } = fixedInput();
  const { validated, trace } = await processExistingTenRepo({
    overview,
    deepResults: weakConfig(deep),
  });
  assert.equal(MAX_RETRIES, 2);
  assert.deepEqual(trace, [
    { dimension: 'config', phase: 'retry' },
    { dimension: 'config', phase: 'retry' },
  ]);
  assert.ok(validated.needsRetry.includes('config'), 'config must remain below the retry threshold');
});

test('T204 injected clock controls the generated date in the renderer input', async () => {
  let captured = null;
  const sink = (findings) => {
    captured = findings;
    return 'captured';
  };
  await withFixture('t204-clock', pythonFiles, async (repoPath) => {
    const result = await runExistingTenPipeline({
      repos: [repoPath],
      clock: () => '2026-04-02',
      sink,
    });
    assert.equal(result.generated, '2026-04-02');
    assert.equal(captured.generated, '2026-04-02');
    assert.equal(result.markdown, 'captured');
  });
  assert.match(DEFAULT_CLOCK(), /^\d{4}-\d{2}-\d{2}$/);
});

test('T204 injected sink captures the renderer input exactly once', async () => {
  const captured = [];
  const sink = (findings, out) => {
    captured.push({ findings, out });
    return 'CAPTURED';
  };
  const { overview, deep } = fixedInput();
  const { markdown, findings } = await processExistingTenRepo({
    overview,
    deepResults: deep,
    generated: '2026-01-01',
    sink,
  });
  assert.equal(markdown, 'CAPTURED');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].findings, findings);
  assert.equal(captured[0].findings.generated, '2026-01-01');
  assert.equal(captured[0].findings.repos.length, 1);
  assert.equal(captured[0].findings.repos[0].overview.name, 'synthetic-repository');
  assert.equal(captured[0].findings.repos[0].deep.length, 10);
  assert.equal(captured[0].out, undefined);
  assert.equal(typeof DEFAULT_SINK, 'function');
});

test('T204 injected command runner is threaded through dispatch and records only registered command IDs', async () => {
  const { calls, run } = createRecordingRunner([]);
  await withFixture('t204-runner', pythonFiles, async (repoPath) => {
    const options = { repos: [repoPath], clock: () => '2026-01-01', sink: () => '' };
    const noRunner = await runExistingTenPipeline(options);
    const withRunner = await runExistingTenPipeline({ ...options, commandRunner: run });
    assert.equal(noRunner.context.commandRunner, null);
    assert.equal(withRunner.context.commandRunner, run);
    assert.ok(noRunner.trace.every((entry) => entry.runner === false));
    assert.ok(withRunner.trace.every((entry) => entry.runner === true));
    assert.equal(withRunner.markdown, noRunner.markdown);
    assert.equal(withRunner.semantic[0].overview.path, noRunner.semantic[0].overview.path);
    assert.ok(calls.length > 0, 'the injected runner must observe survey/enumeration commands');
    for (const call of calls) {
      assert.ok(['rg', 'git'].includes(call.executable), `unexpected executable ${call.executable}`);
      assert.equal(call.shell, false);
    }
  });
});

test('T204 injected plugin registry is present in the context and inert', async () => {
  const registry = [{ id: 'fixturelang', apiVersion: 1 }];
  await withFixture('t204-plugins', pythonFiles, async (repoPath) => {
    const options = { repos: [repoPath], clock: () => '2026-01-01', sink: () => '' };
    const base = await runExistingTenPipeline(options);
    const withPlugins = await runExistingTenPipeline({ ...options, pluginRegistry: registry });
    assert.deepEqual(base.context.pluginRegistry, []);
    assert.equal(withPlugins.context.pluginRegistry, registry);
    assert.ok(base.trace.every((entry) => entry.plugins === 0));
    assert.ok(withPlugins.trace.every((entry) => entry.plugins === 1));
    assert.equal(withPlugins.markdown, base.markdown);
    assert.equal(withPlugins.semantic[0].overview.path, base.semantic[0].overview.path);
  });
});

test('T204 pipeline preserves single and multi-repo renderer semantics', async () => {
  const captured = [];
  await withFixture('t204-multi-a', pythonFiles, async (a) => {
    await withFixture('t204-multi-b', rustFiles, async (b) => {
      const sink = (findings) => {
        captured.push(findings);
        return '';
      };
      const result = await runExistingTenPipeline({ repos: [a, b], clock: () => '2026-01-01', sink });
      assert.equal(result.repos.length, 2);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].repos.length, 2);
      assert.equal(result.trace.filter((entry) => entry.repoIndex === 0 && entry.phase === 'initial').length, 10);
      assert.equal(result.trace.filter((entry) => entry.repoIndex === 1 && entry.phase === 'initial').length, 10);
      assert.equal(result.semantic.length, 2);
      const root = await mkdtemp(join(tmpdir(), 'csm-scan-t204-multi-'));
      try {
        const markdown = await DEFAULT_SINK(captured[0], join(root, 'NORMS.md'));
        assert.match(markdown, /> Scanned repos: /);
        for (const repo of captured[0].repos) {
          assert.ok(markdown.includes(repo.overview.name), `${repo.overview.name} must be rendered`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});

test('T204 pipeline tests never reconstruct scanner dispatch independently', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  assert.doesNotMatch(source, /lib\/scan\/deep\//);
  assert.doesNotMatch(source, /Promise\.all/);
  const runSource = await readFile(join(TEST_ROOT, '..', 'lib', 'scan', 'pipeline', 'run.mjs'), 'utf8');
  assert.match(runSource, /runExistingTenPipeline/);
  assert.match(runSource, /processExistingTenRepo/);
});
