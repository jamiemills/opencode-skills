import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFixture } from './harness.mjs';
import { runMirrorPipelineDetailed, MIRROR_GENERATED_DATE } from './helpers/pipeline-mirror.mjs';
import { survey } from '../lib/scan/survey.mjs';
import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import * as structure from '../lib/scan/deep/structure.mjs';
import * as stack from '../lib/scan/deep/stack.mjs';
import * as config from '../lib/scan/deep/config.mjs';
import * as testing from '../lib/scan/deep/testing.mjs';
import * as conventions from '../lib/scan/deep/conventions.mjs';
import * as git from '../lib/scan/deep/git.mjs';
import * as architecture from '../lib/scan/deep/architecture.mjs';
import * as documentation from '../lib/scan/deep/documentation.mjs';
import * as security from '../lib/scan/deep/security.mjs';
import * as operations from '../lib/scan/deep/operations.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';

// T010 (F-026): `runPipeline` — the suite's own fixture cases — now drives the
// exported production pipeline (`runExpandedPipeline`) through the shared
// mirror helper. The legacy ten-dimension sequence below survives ONLY as
// `runLegacyTenMirror`, the parity oracle consumed by
// expansion-production-pipeline.test.mjs (T204) to prove
// `runExistingTenPipeline` byte-equality; it retires together with
// `runExistingTenPipeline` (F-055) and no longer claims to mirror scripts/scan.mjs.
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const BEHAVIOR_BASELINE = JSON.parse(await readFile(
  join(TEST_ROOT, 'baselines', 'expansion', 'fixture-behavior.json'),
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
    .replace(/\b(Python|Node(?:\.js)?|rustc|Deno|Bun)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?/g, '$1 <HOST_VERSION>')
    // The expanded pipeline's cross-repository identity table renders
    // scan:<scanId>, where scanId = sha256(repo path) (pipeline scanIdFor) —
    // a one-way derivation of the random fixture tmpdir, so it must be
    // normalized like the fixture root itself to keep the bytes portable.
    .replace(/\bscan-[0-9a-f]{24}\b/g, '<SCAN_ID>');
}

// The production pipeline, single repo, semantic payload exposed.
export async function runPipeline(repoPath) {
  const detailed = await runMirrorPipelineDetailed(repoPath);
  const semantic = canonicalize(detailed.semantic, repoPath);
  return {
    markdown: detailed.markdown,
    semantic,
    semanticSha256: digest(`${JSON.stringify(semantic)}\n`),
    markdownSha256: digest(`${canonicalize(detailed.markdown, repoPath)}\n`),
  };
}

// Legacy ten-dimension oracle (parity with runExistingTenPipeline only).
// Runs the retired survey -> 10 deep scanners -> enrich -> validate sequence
// in-process and hashes the same canonical shapes as the baseline file.
export async function runLegacyTenMirror(repoPath) {
  const overview = await survey(repoPath);

  const deepResults = (await Promise.all([
    structure.scan(repoPath, overview),
    stack.scan(repoPath, overview),
    config.scan(repoPath, overview),
    testing.scan(repoPath, overview),
    conventions.scan(repoPath, overview),
    git.scan(repoPath, overview),
    architecture.scan(repoPath, overview),
    documentation.scan(repoPath, overview),
    security.scan(repoPath, overview),
    operations.scan(repoPath, overview),
  ])).filter(Boolean);

  const enriched = await enrich(deepResults, overview);
  const validated = await validate(enriched);

  const out = join(
    tmpdir(),
    `norms-pipeline-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  const markdown = await writeNORMS(
    { generated: MIRROR_GENERATED_DATE, repos: [{ overview, deep: validated.findings }] },
    out,
  );
  const semantic = canonicalize({ overview, deepResults, enriched, validated }, repoPath);
  return {
    markdown,
    semantic,
    semanticSha256: digest(`${JSON.stringify(semantic)}\n`),
    markdownSha256: digest(`${canonicalize(markdown, repoPath)}\n`),
  };
}

function contains(markdown, needle) {
  return needle instanceof RegExp ? needle.test(markdown) : markdown.includes(needle);
}

// (name, fixtureFiles, ecosystemStrings, cacheNoise)
// Noise entries may be strings (substring) or RegExps. `dist` is pinned as a
// whole token because the expanded pipeline legitimately renders the words
// "distribution" and "distinct" (maintainability dimension); \bdist\b still
// fails on any leaked dist path segment (dist/..., ./dist, `dist`).
export const CASES = [
  { name: 'python', files: pythonFiles, ecosystem: ['Python'], noise: ['.hypothesis'] },
  { name: 'javascript', files: javascriptFiles, ecosystem: [/JavaScript|TypeScript|Node/], noise: ['node_modules', /\bdist\b/] },
  { name: 'typescript', files: typescriptFiles, ecosystem: [/JavaScript|TypeScript|Node/], noise: ['node_modules', /\bdist\b/] },
  { name: 'rust', files: rustFiles, ecosystem: ['Rust'], noise: ['target'] },
  { name: 'shell', files: shellFiles, ecosystem: ['Shell'], noise: ['.cache'] },
];

for (const c of CASES) {
  test(`T020 ${c.name} fixture: full pipeline runs clean, reflects ecosystem, excludes cache noise`, async () => {
    const result = await withFixture(`pipe-${c.name}`, c.files, runPipeline);
    const { markdown } = result;

    for (const needle of c.ecosystem) {
      assert.ok(
        contains(markdown, needle),
        `${c.name}: NORMS.md must mention ecosystem ${needle.toString()}`,
      );
    }

    for (const noise of c.noise) {
      assert.ok(
        !contains(markdown, noise),
        `${c.name}: NORMS.md must not leak cache-dir noise "${noise}"`,
      );
    }

    // T010 (F-026): the fixture cases pin the EXPANDED production pipeline
    // (runExpandedPipeline through the shared mirror); the legacy
    // ten-dimension hashes remain recorded for the T204 parity oracle.
    const expected = BEHAVIOR_BASELINE.fixtures[c.name];
    assert.ok(expected, `${c.name}: fixture behavior baseline must exist`);
    assert.equal(result.semanticSha256, expected.expandedSemanticSha256, `${c.name}: expanded pipeline semantics changed`);
    assert.equal(result.markdownSha256, expected.expandedMarkdownSha256, `${c.name}: expanded pipeline Markdown changed`);
  });
}
