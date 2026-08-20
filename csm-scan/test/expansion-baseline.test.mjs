import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const BASELINE_ROOT = join(TEST_ROOT, 'baselines', 'expansion');

async function readJson(name) {
  return JSON.parse(await readFile(join(BASELINE_ROOT, name), 'utf8'));
}

function digest(source) {
  return createHash('sha256').update(source).digest('hex');
}

async function lockApplies(lock) {
  try {
    return digest(await readFile(join(TEST_ROOT, '..', lock.path))) === lock.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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
    findingKeys: Object.fromEntries(validated.findings.map(({ dimension, findings }) => [dimension, Object.keys(findings).toSorted()])),
    coverage: validated.coverage,
    confidence: Object.fromEntries(validated.findings.map(({ dimension, confidence }) => [dimension, confidence])),
    contradictions: enriched.contradictions,
    gaps: enriched.gaps,
    inferredPatterns: enriched.inferredPatterns,
  };
}

async function currentResult() {
  const { overview, deep } = fixedInput();
  const enriched = await enrich(deep, overview);
  return { overview, enriched, validated: await validate(enriched) };
}

test('T201 semantic baseline preserves the existing ten dimensions and result keys', async () => {
  const expected = await readJson('semantic.json');
  const { enriched, validated } = await currentResult();
  assert.deepEqual(semanticProjection(enriched, validated), expected);
  assert.equal(validated.findings.length, 10);
  assert.equal(validated.needsRetry.length, 0);
});

test('T201 fixed-input renderer output matches the deterministic Markdown baseline', async () => {
  const expected = await readFile(join(BASELINE_ROOT, 'renderer.md'), 'utf8');
  const { overview, validated } = await currentResult();
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-expansion-render-'));
  try {
    const content = await writeNORMS({ generated: '2026-01-15', repos: [{ overview, deep: validated.findings }] }, join(root, 'NORMS.md'));
    assert.equal(content, expected);
    assert.equal(content.includes(root), false);
    assert.match(content, /> Generated by csm-scan on 2026-01-15/);
    assert.match(content, /- \*\*Path\*\*: `\.`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T201 inventory binds the acceptance command to five fixture pipelines and all 21 P0 tests', async () => {
  const expected = await readJson('inventory.json');
  assert.deepEqual(expected.acceptanceTestFiles, [
    'test/expansion-baseline.test.mjs',
    'test/expansion-constraints.test.mjs',
    'test/fixtures-pipeline.test.mjs',
    'test/regression-parity.test.mjs',
    'test/expansion-command-core.test.mjs',
    'test/expansion-command-deep.test.mjs',
    'test/expansion-privacy-write.test.mjs',
  ]);
  assert.deepEqual(expected.recurringAcceptanceTestFiles, expected.acceptanceTestFiles);
  const fixtureUrl = new URL('./fixtures/', import.meta.url);
  const fixtureModules = (await readdir(join(TEST_ROOT, 'fixtures')))
    .filter((name) => name.endsWith('.mjs'))
    .toSorted();
  for (const moduleName of fixtureModules) {
    const module = await import(new URL(moduleName, fixtureUrl));
    assert.equal(typeof module.files, 'object', `${moduleName} must export files`);
  }
  assert.deepEqual([...fixtureModules].toSorted(), expected.fixtureModules);
  const fixtureSource = await readFile(join(TEST_ROOT, 'fixtures-pipeline.test.mjs'), 'utf8');
  const fixtureCases = [...fixtureSource.matchAll(/\{ name: '([^']+)', files: \w+Files,/g)].map((match) => match[1]);
  assert.deepEqual(fixtureCases, expected.fixtureCases);
  assert.equal(fixtureCases.length, 5);
  assert.match(fixtureSource, /for \(const c of CASES\) \{\s*test\(`/);
  assert.doesNotMatch(fixtureSource, /\b(?:test|it)\.(?:skip|todo)\b|\bskip\s*:/);

  const p0Source = await readFile(join(TEST_ROOT, 'regression-parity.test.mjs'), 'utf8');
  const p0TestNames = [...p0Source.matchAll(/\bname:\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith('P0-'));
  assert.deepEqual(p0TestNames, expected.p0TestNames);
  assert.equal(p0TestNames.length, 21);
  assert.match(p0Source, /for \(const \{ name, run \} of P0_CASES\) test\(name, run\);/);
  assert.doesNotMatch(p0Source, /\b(?:test|it)\.(?:skip|todo)\b|\bskip\s*:/);
});

test('T201 reviewed test and fixture inputs cannot be weakened without digest updates', async () => {
  const integrity = await readJson('test-integrity.json');
  assert.equal(integrity.version, 1);
  assert.deepEqual(Object.keys(integrity.files).toSorted(), [
    'test/expansion-command-deep.test.mjs',
    'test/fixtures-pipeline.test.mjs',
    'test/fixtures/javascript.mjs',
    'test/fixtures/python.mjs',
    'test/fixtures/rust.mjs',
    'test/fixtures/shell.mjs',
    'test/fixtures/typescript.mjs',
    'test/regression-parity.test.mjs',
  ]);
  for (const [path, sha256] of Object.entries(integrity.files)) {
    assert.equal(digest(await readFile(join(TEST_ROOT, '..', path))), sha256, `${path} integrity changed`);
  }
});

test('T201 supersession records are legacy locks or live recurring replacements', async () => {
  const baseline = await readJson('supersession.json');
  const inventory = await readJson('inventory.json');
  const expectedIds = [
    'host-runtime-probes',
    'personal-identity-output',
    'free-form-na',
    'coverage-status-representation',
    'deterministic-ordering-paths',
  ];
  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.entries.map(({ id }) => id), expectedIds);
  assert.match(baseline.policy, /legacy_locked/);
  assert.match(baseline.policy, /recurring acceptance inventory/);
  for (const entry of baseline.entries) {
    assert.ok(['legacy_locked', 'superseded'].includes(entry.state), `${entry.id} has an invalid state`);
    assert.match(entry.replacementTask, /^T\d+$/);
    assert.ok(entry.legacyLocks.length > 0, `${entry.id} must retain legacy evidence`);
    assert.ok(entry.legacyLocks.some(({ role }) => role === 'production'));
    assert.ok(entry.legacyLocks.some(({ role }) => role === 'test'));
    const lockResults = await Promise.all(entry.legacyLocks.map(lockApplies));
    if (entry.state === 'legacy_locked') {
      assert.equal(entry.replacement, null);
      assert.ok(lockResults.every(Boolean), `${entry.id} legacy locks changed before ${entry.replacementTask}`);
      continue;
    }
    assert.ok(lockResults.some((applies) => !applies), `${entry.id} cannot be superseded while every legacy lock applies`);
    assert.ok(inventory.recurringAcceptanceTestFiles.includes(entry.replacement.testFile));
    const replacementSource = await readFile(join(TEST_ROOT, '..', entry.replacement.testFile), 'utf8');
    assert.equal(digest(replacementSource), entry.replacement.testFileSha256);
    assert.ok(
      replacementSource.includes(`test('${entry.replacement.testName}'`) || replacementSource.includes(`test("${entry.replacement.testName}"`),
      `${entry.id} replacement test is not registered under its exact name`,
    );
  }
});
