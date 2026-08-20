import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRecordingRunner } from './helpers/recording-runner.mjs';
import { withFixture } from './harness.mjs';
import { canonicalize, fixedInput, semanticProjection } from './helpers/expansion-shared.mjs';
// T010 (F-026) + T002: the legacy ten-dimension oracle (`runLegacyTenMirror`)
// pins the retired ten-dimension hashes; the expanded production pipeline
// projects them from `runExpandedPipeline`.
import { runLegacyTenMirror } from './helpers/legacy-pipeline-mirror.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { EXISTING_TEN_DIMENSIONS } from '../lib/scan/pipeline/existing-ten.mjs';
import { DIMENSION_REGISTRY } from '../lib/scan/registry/dimensions.mjs';
import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import {
  DEFAULT_CLOCK,
  DEFAULT_SINK,
  MAX_RETRIES,
  enrichValidateRetry,
  runExpandedPipeline,
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

const REGISTRY_SHORTS = DIMENSION_REGISTRY.map(({ id }) => id.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, ''));

test('T204 canonical semantic processing reproduces the T201 semantic baseline for the ten legacy dimensions', async () => {
  const expected = JSON.parse(await readFile(join(BASELINE_ROOT, 'semantic.json'), 'utf8'));
  const { overview, deep } = fixedInput();
  const enriched = await enrich(deep, overview);
  const validated = await validate(enriched);
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
    const enriched = await enrich(deep, overview);
    const validated = await validate(enriched);
    const markdown = await DEFAULT_SINK(
      { generated: '2026-01-15', repos: [{ overview, deep: validated.findings }] },
      out,
    );
    assert.equal(markdown, expected);
    assert.equal(markdown, await readFile(out, 'utf8'));
    assert.deepEqual(await readdir(root), ['NORMS.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const c of FIXTURES) {
  test(`T204 ${c.name} fixture: expanded pipeline projects the ten legacy dimensions onto the established baseline`, async () => {
    await withFixture(`t204-${c.name}`, c.files, async (repoPath) => {
      const expected = FIXTURE_BEHAVIOR.fixtures[c.name];
      assert.ok(expected, `${c.name}: fixture behavior baseline must exist`);

      // T010 parity oracle: the standalone legacy ten-dimension mirror still
      // reproduces the legacy hashes after the pipeline entry points retired.
      const old = await runLegacyTenMirror(repoPath);
      assert.equal(old.semanticSha256, expected.semanticSha256, `${c.name}: reused legacy mirror no longer matches the baseline`);
      assert.equal(old.markdownSha256, expected.markdownSha256, `${c.name}: reused legacy mirror no longer matches the baseline`);

      const root = await mkdtemp(join(tmpdir(), 'csm-scan-t204-parity-'));
      try {
        const result = await runExpandedPipeline({
          repos: [repoPath],
          out: join(root, 'NORMS.md'),
          clock: () => '2026-01-01',
        });

        // Expanded-pipeline projection: the ten legacy dimensions carried by
        // the expanded result still render the legacy baseline bytes.
        const legacyDeep = result.repos[0].deep.filter(
          ({ dimension }) => EXISTING_TEN_DIMENSIONS.includes(dimension),
        );
        const projected = await DEFAULT_SINK(
          { generated: '2026-01-01', repos: [{ overview: result.repos[0].overview, deep: legacyDeep }] },
          join(root, 'projected.md'),
        );
        assert.equal(projected, old.markdown, `${c.name}: expanded legacy projection must equal the legacy mirror`);
        assert.equal(
          digest(`${canonicalize(projected, repoPath)}\n`),
          expected.markdownSha256,
          `${c.name}: expanded legacy projection drifted from the established hash`,
        );

        const crossObs = result.repos[0].crossObservations ?? [];
        assert.deepEqual(crossObs, result.semantic[0].validated.contradictions, `${c.name}: cross-observations wiring mismatch`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}

test('T204 pipeline dispatches each registered dimension exactly once in canonical order without retry', async () => {
  await withFixture('t204-once', pythonFiles, async (repoPath) => {
    const result = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const initial = result.trace.filter((entry) => entry.phase === 'initial');
    assert.equal(initial.length, REGISTRY_SHORTS.length);
    assert.deepEqual(initial.map((entry) => entry.dimension), REGISTRY_SHORTS);
    const counts = new Map();
    for (const entry of initial) counts.set(entry.dimension, (counts.get(entry.dimension) || 0) + 1);
    for (const dimension of REGISTRY_SHORTS) {
      assert.equal(counts.get(dimension), 1, `${dimension} must be dispatched exactly once`);
    }
    assert.equal(result.trace.filter((entry) => entry.phase === 'retry').length, 0);
    assert.ok(initial.every((entry) => entry.runner === false));
    assert.ok(initial.every((entry) => entry.plugins === 0));
  });
});

test('T204 retry loop re-dispatches only the weak dimension and recovers it from a real re-scan', async () => {
  await withFixture('t204-retry', pythonFiles, async (repoPath) => {
    const full = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink: () => '',
    });
    const { validated, trace } = await enrichValidateRetry({
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
  const { validated, trace } = await enrichValidateRetry({
    overview,
    deepResults: weakConfig(deep),
    path: null,
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
    const result = await runExpandedPipeline({
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
  await withFixture('t204-sink', pythonFiles, async (repoPath) => {
    const result = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => '2026-01-01',
      sink,
    });
    assert.equal(result.markdown, 'CAPTURED');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].findings.generated, '2026-01-01');
    assert.equal(captured[0].findings.repos.length, 1);
    assert.equal(captured[0].findings.repos[0].deep.length, REGISTRY_SHORTS.length);
    assert.equal(captured[0].out, undefined);
  });
});

test('T204 injected command runner is threaded through dispatch and records only registered command IDs', async () => {
  const { calls, run } = createRecordingRunner([]);
  await withFixture('t204-runner', pythonFiles, async (repoPath) => {
    const options = { repos: [repoPath], clock: () => '2026-01-01', sink: () => '' };
    const noRunner = await runExpandedPipeline(options);
    const withRunner = await runExpandedPipeline({ ...options, commandRunner: run });
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
    const base = await runExpandedPipeline(options);
    const withPlugins = await runExpandedPipeline({ ...options, pluginRegistry: registry });
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
      const result = await runExpandedPipeline({ repos: [a, b], clock: () => '2026-01-01', sink });
      assert.equal(result.repos.length, 2);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].repos.length, 2);
      assert.equal(result.trace.filter((entry) => entry.repoIndex === 0 && entry.phase === 'initial').length, REGISTRY_SHORTS.length);
      assert.equal(result.trace.filter((entry) => entry.repoIndex === 1 && entry.phase === 'initial').length, REGISTRY_SHORTS.length);
      assert.equal(result.semantic.length, 2);
      const root = await mkdtemp(join(tmpdir(), 'csm-scan-t204-multi-'));
      try {
        // Project the ten legacy dimensions so the default writer (existing-ten
        // renderer) can render the multi-repo envelope deterministically.
        const legacyRepos = captured[0].repos.map(({ overview, deep }) => ({
          overview,
          deep: deep.filter(({ dimension }) => EXISTING_TEN_DIMENSIONS.includes(dimension)),
        }));
        const markdown = await DEFAULT_SINK(
          { generated: '2026-01-01', repos: legacyRepos },
          join(root, 'NORMS.md'),
        );
        assert.match(markdown, /> Scanned repos: /);
        for (const repo of legacyRepos) {
          assert.ok(markdown.includes(repo.overview.name), `${repo.overview.name} must be rendered`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
