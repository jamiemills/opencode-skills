import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFixture } from './harness.mjs';
import { runMirrorPipelineDetailed } from './helpers/pipeline-mirror.mjs';
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
