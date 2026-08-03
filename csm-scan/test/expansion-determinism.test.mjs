// T227 — determinism gates for the expanded production pipeline.
//
// Owned by T227. These gates prove the canonical `runExpandedPipeline`
// (driven through the exported production module, never a reconstructed
// dispatch) is byte-deterministic for identical immutable inputs:
//   - Fixed-clock repeated runs are byte-identical (same markdown bytes, LF
//     endings, exactly one terminal newline).
//   - Insertion-order permutations of the same repository's files produce
//     byte-identical output (rg enumeration and every scanner sort the
//     filesystem surface before emitting facts).
//   - Repository reversal ([A, B] vs [B, A]) leaves the cross-repository global
//     section and every per-repository block byte-identical; only the
//     top-level document order changes (the document structure legitimately
//     follows the input repository order).
//   - Dimension, claim, provider, evidence, and edge order are stable:
//     dimensions follow the T222 registry order, provider observations are
//     deterministically sorted, and serialized findings/global snapshots are
//     byte-identical across runs.
//
// Scope (own-only): this test file. No production, baseline, or other test is
// edited.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { compareAscii } from '../lib/scan/contracts/evidence.mjs';
import { DIMENSION_REGISTRY } from '../lib/scan/registry/dimensions.mjs';

import { files as pythonFiles } from './fixtures-expansion/python.mjs';
import { files as javascriptFiles } from './fixtures-expansion/javascript.mjs';
import { files as unknownFiles } from './fixtures-expansion/unknown.mjs';
import { repoA, repoB } from './fixtures-expansion/cross-repo.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));

const FIXED_CLOCK = () => '2026-08-03';

const SHORT_DIMENSIONS = DIMENSION_REGISTRY.map(({ id }) => (
  id.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '')
));

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function runToFile(repoPaths, out) {
  return runExpandedPipeline({
    repos: repoPaths,
    out,
    clock: FIXED_CLOCK,
  });
}

function repoBlocks(markdown) {
  const parts = markdown.split('## Repository Overview').slice(1).map((block) => (
    `## Repository Overview${block.split('## Cross-repository Architecture')[0]}`
  ));
  return parts.map((block) => block.replace(/\s+$/g, ''));
}

test('T227 determinism: fixed-clock repeated expanded-pipeline runs are byte-identical with LF endings and one terminal newline', async () => {
  for (const [name, files] of [['python', pythonFiles], ['javascript', javascriptFiles], ['unknown', unknownFiles]]) {
    const repo = makeFixture(`t227-repeated-${name}`, files);
    const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-repeated-'));
    try {
      const markdowns = [];
      for (const index of [1, 2, 3]) {
        const out = join(outDir, `run-${index}.md`);
        const result = await runToFile([repo], out);
        markdowns.push(result.markdown);
        assert.equal(result.generated, '2026-08-03', `${name}: fixed clock must be reported`);
        assert.equal(await readFile(out, 'utf8'), result.markdown, `${name}: the written file must equal the returned markdown`);
      }
      assert.equal(markdowns[0], markdowns[1], `${name}: second run must be byte-identical`);
      assert.equal(markdowns[1], markdowns[2], `${name}: third run must be byte-identical`);
      for (const markdown of markdowns) {
        assert.equal(markdown.includes('\r'), false, `${name}: markdown must use LF line endings only`);
        assert.equal(markdown.endsWith('\n'), true, `${name}: markdown must have a terminal newline`);
        assert.equal(markdown.endsWith('\n\n'), false, `${name}: markdown must have exactly one terminal newline`);
      }
    } finally {
      cleanupFixture(repo);
      await rm(outDir, { recursive: true, force: true });
    }
  }

  // Multi-repo repeated runs are byte-identical too.
  const repoA1 = makeFixture('t227-repeated-a', repoA);
  const repoB1 = makeFixture('t227-repeated-b', repoB);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-repeated-multi-'));
  try {
    const first = await runToFile([repoA1, repoB1], join(outDir, 'm1.md'));
    const second = await runToFile([repoA1, repoB1], join(outDir, 'm2.md'));
    assert.equal(first.markdown, second.markdown, 'multi-repo repeated runs must be byte-identical');
    assert.equal(first.global.metrics.repositories, 2);
  } finally {
    cleanupFixture(repoA1);
    cleanupFixture(repoB1);
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 determinism: insertion-order permutations of the same repository produce byte-identical output', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'csm-scan-t227-perm-'));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-perm-out-'));
  const entries = Object.entries(pythonFiles);
  const orders = [
    entries,
    [...entries].reverse(),
    entries.filter((_, index) => index % 2 === 0).concat(entries.filter((_, index) => index % 2 === 1)),
  ];
  try {
    const markdowns = [];
    for (const [index, order] of orders.entries()) {
      await rm(repo, { recursive: true, force: true });
      await mkdir(repo);
      for (const [rel, content] of order) {
        const abs = join(repo, rel);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
      }
      const result = await runToFile([repo], join(outDir, `perm-${index}.md`));
      markdowns.push(result.markdown);
    }
    assert.equal(markdowns[0], markdowns[1], 'reverse insertion order must be byte-identical');
    assert.equal(markdowns[0], markdowns[2], 'shuffled insertion order must be byte-identical');
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 determinism: repository reversal preserves per-repository and global content byte-identically', async () => {
  const repoPy = makeFixture('t227-rev-py', pythonFiles);
  const repoJs = makeFixture('t227-rev-js', javascriptFiles);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-rev-'));
  try {
    const forward = await runToFile([repoPy, repoJs], join(outDir, 'fwd.md'));
    const reversed = await runToFile([repoJs, repoPy], join(outDir, 'rev.md'));

    const forwardBlocks = repoBlocks(forward.markdown);
    const reversedBlocks = repoBlocks(reversed.markdown);
    assert.equal(forwardBlocks.length, 2, 'forward run must render two repository blocks');
    assert.equal(reversedBlocks.length, 2, 'reversed run must render two repository blocks');

    // The cross-repository global section is order-independent.
    const globalSection = (markdown) => markdown.split('## Cross-repository Architecture')[1];
    assert.equal(
      globalSection(forward.markdown),
      globalSection(reversed.markdown),
      'the global cross-repository section must be byte-identical under repository reversal',
    );
    assert.equal(
      JSON.stringify(forward.global),
      JSON.stringify(reversed.global),
      'the structured global snapshot must be byte-identical under repository reversal',
    );

    // Each per-repository block is byte-identical regardless of position.
    assert.deepEqual(
      [...forwardBlocks].sort(),
      [...reversedBlocks].sort(),
      'the per-repository block multiset must be byte-identical under repository reversal',
    );
    // Reversal flips only the top-level repository block order.
    assert.equal(reversedBlocks[0], forwardBlocks[1], 'the first block of the reversed run must equal the second block of the forward run');
    assert.equal(reversedBlocks[1], forwardBlocks[0], 'the second block of the reversed run must equal the first block of the forward run');
  } finally {
    cleanupFixture(repoPy);
    cleanupFixture(repoJs);
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 determinism: dimension, claim, provider, evidence, and edge order are stable across runs', async () => {
  const repo = makeFixture('t227-order', unknownFiles);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-order-'));
  try {
    const first = await runToFile([repo], join(outDir, 'o1.md'));
    const second = await runToFile([repo], join(outDir, 'o2.md'));

    // Dimension order follows the T222 registry order in the deep findings.
    const deepDimensions = first.repos[0].deep.map(({ dimension }) => dimension);
    assert.deepEqual(deepDimensions, SHORT_DIMENSIONS, 'the 16 dimensions must render in canonical registry order');

    // Claim coverage order matches the registry dimension order.
    const perDimension = first.expectedClaimCoverage.repos[0].perDimension;
    assert.deepEqual(
      Object.keys(perDimension),
      SHORT_DIMENSIONS,
      'per-dimension claim coverage must follow the canonical registry order',
    );

    // Evidence (the whole deep findings envelope) is byte-identical across runs.
    const serializeDeep = (result) => JSON.stringify(result.repos[0].deep);
    assert.equal(serializeDeep(first), serializeDeep(second), 'structured findings and evidence order must be byte-identical across runs');
    assert.equal(
      JSON.stringify(first.expectedClaimCoverage),
      JSON.stringify(second.expectedClaimCoverage),
      'expected-claim coverage must be byte-identical across runs',
    );

    // Provider observations are deterministically sorted (providerId, plugin,
    // category, matchedKey, path) and stable.
    const maintainability = first.repos[0].deep.find(({ dimension }) => dimension === 'maintainability');
    const observations = maintainability?.findings?.providerObservations ?? [];
    assert.ok(observations.length > 0, 'the unknown-language fixture must carry generic provider observations');
    const sorted = [...observations].sort((left, right) => compareAscii(
      `${left.providerId}\0${left.plugin ?? ''}\0${left.category}\0${left.matchedKey}\0${left.path ?? ''}`,
      `${right.providerId}\0${right.plugin ?? ''}\0${right.category}\0${right.matchedKey}\0${right.path ?? ''}`,
    ));
    assert.deepEqual(observations, sorted, 'provider observations must be deterministically sorted');
    assert.equal(
      JSON.stringify(maintainability.findings.providerObservations),
      JSON.stringify(second.repos[0].deep.find(({ dimension }) => dimension === 'maintainability').findings.providerObservations),
      'provider observation order must be byte-identical across runs',
    );

    // Edge order is deterministic in the global snapshot and the rendered section.
    const edgeKey = (edge) => `${edge.kind}\0${edge.sourceRepository}\0${edge.targetId}\0${edge.coordinate}`;
    const globalEdges = first.global.edges?.edges ?? [];
    const sortedEdges = [...globalEdges].sort((left, right) => compareAscii(edgeKey(left), edgeKey(right)));
    assert.deepEqual(globalEdges, sortedEdges, 'resolved cross-repository edges must be deterministically sorted');
    assert.equal(
      JSON.stringify(first.global),
      JSON.stringify(second.global),
      'the structured global snapshot must be byte-identical across runs',
    );

    // Markdown renders the dimension sections in canonical registry order.
    const markdown = first.markdown;
    const renderProseLabel = {
      structure: 'Repository Structure',
      stack: 'Technology Stack',
      config: 'Configuration',
      testing: 'Testing',
      conventions: 'Code Conventions',
      git: 'Git Practices',
      architecture: 'Architecture',
      documentation: 'Documentation',
      security: 'Security',
      operations: 'Operations',
      api: 'API Surface',
      data: 'Data Architecture',
      deployment: 'Deployment Topology',
      maintainability: 'Maintainability',
      governance: 'Governance & Ownership',
      assurance: 'Assurance & Supply Chain',
    };
    let cursor = 0;
    for (const dimension of SHORT_DIMENSIONS) {
      const heading = `## ${renderProseLabel[dimension]}`;
      const at = markdown.indexOf(heading);
      assert.ok(at !== -1, `${heading} must render`);
      assert.ok(at > cursor, `${heading} must appear after the previous dimension (canonical order)`);
      cursor = at;
    }
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});

// The plan's acceptance evidence records seeds and hashes. The digest helper
// above is used by the evidence record so seeds/hashes stay in one place.
export const DETERMINISM_EVIDENCE = Object.freeze({
  gate: 'T227',
  clock: '2026-08-03',
  fixtures: ['python', 'javascript', 'unknown', 'cross-repo'],
  digest: digest('T227-determinism-seed-2026-08-03'),
});
