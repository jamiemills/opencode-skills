import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFixture } from './harness.mjs';
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

// Runs the full csm-scan pipeline in-process against `repoPath`, mirroring the
// survey -> 10 deep scanners -> enrich -> validate -> writeNORMS sequence in
// scripts/scan.mjs (single-repo, no retry loop). Returns the markdown string
// written to a temp file under os.tmpdir().
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
    .replace(/\b(Python|Node(?:\.js)?|rustc|Deno|Bun)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?/g, '$1 <HOST_VERSION>');
}

export async function runPipeline(repoPath) {
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
    { generated: '2026-01-01', repos: [{ overview, deep: validated.findings }] },
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
export const CASES = [
  { name: 'python', files: pythonFiles, ecosystem: ['Python'], noise: ['.hypothesis'] },
  { name: 'javascript', files: javascriptFiles, ecosystem: [/JavaScript|TypeScript|Node/], noise: ['node_modules', 'dist'] },
  { name: 'typescript', files: typescriptFiles, ecosystem: [/JavaScript|TypeScript|Node/], noise: ['node_modules', 'dist'] },
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
        !markdown.includes(noise),
        `${c.name}: NORMS.md must not leak cache-dir noise "${noise}"`,
      );
    }

    const expected = BEHAVIOR_BASELINE.fixtures[c.name];
    assert.ok(expected, `${c.name}: fixture behavior baseline must exist`);
    assert.equal(result.semanticSha256, expected.semanticSha256, `${c.name}: ordered deep semantics changed`);
    assert.equal(result.markdownSha256, expected.markdownSha256, `${c.name}: canonical Markdown changed`);
  });
}
