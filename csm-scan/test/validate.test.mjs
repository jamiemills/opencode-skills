import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/scan/validate.mjs';
import { enrich } from '../lib/scan/enrich.mjs';

const BANNED_VOICE = [
  'should', 'must', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'however',
  'but', 'contradiction', 'conflict', 'inconsistent',
];

test('an entirely unreported dimension is unverified and queued for retry', async () => {
  const overview = { languages: [], ecosystems: {}, totalFiles: 0 };
  const deep = [
    {
      dimension: 'security',
      signal: 'high',
      findings: { first: 'unknown', second: null, third: 'not scanned' },
    },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);

  const security = result.findings.find((f) => f.dimension === 'security');
  assert.equal(security.confidence, 'unverified');
  assert.equal(security.coverage, 0);
  assert.ok(result.needsRetry.includes('security'));
});

test('low-signal reported absence and empty results have observed basis', async () => {
  const overview = { languages: [], ecosystems: {}, totalFiles: 0 };
  const deep = [
    {
      dimension: 'security',
      signal: 'low',
      findings: { found: false, count: 0, entries: [], details: {}, result: 'none detected' },
    },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);

  const security = result.findings.find((f) => f.dimension === 'security');
  assert.equal(security.confidence, 'observed');
  assert.equal(security.coverage, 100);
  assert.equal(security.quality, 100, 'quality compatibility key aliases coverage');
  assert.ok(!result.needsRetry.includes('security'));
});

test('per-field tags downgrade null-ish keys to unverified', async () => {
  const overview = { languages: ['Python'], ecosystems: { primary: 'python' }, manifest: { dependencies: {} }, totalFiles: 5 };
  const deep = [
    {
      dimension: 'stack',
      signal: 'high',
      findings: { runtime: 'Python 3.12', language: 'Python', packageManager: 'unknown', type: 'module', keyDeps: ['click'] },
    },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);
  const stack = result.findings.find((f) => f.dimension === 'stack');

  assert.equal(stack.tags.packageManager, 'unverified');
  assert.notEqual(stack.tags.runtime, 'unverified');
});

test('reported fields use inferred basis when the dimension has an inferred pattern', async () => {
  const overview = { languages: ['TypeScript'], ecosystems: { primary: 'typescript' }, totalFiles: 2 };
  const deep = [{ dimension: 'stack', signal: 'low', findings: { runtime: 'Node.js', count: 0 } }];

  const result = await validate(await enrich(deep, overview));
  const stack = result.findings.find((finding) => finding.dimension === 'stack');

  assert.equal(stack.coverage, 100);
  assert.equal(stack.confidence, 'inferred');
  assert.deepEqual(stack.tags, { runtime: 'inferred', count: 'inferred' });
});

test('validate result exposes a hand-verified coverage oracle per dimension', async () => {
  const overview = {
    languages: ['TypeScript'],
    ecosystems: { primary: 'typescript' },
    manifest: { dependencies: { react: '18.0.0' } },
    totalFiles: 120,
  };
  const deep = [
    {
      dimension: 'stack',
      signal: 'high',
      findings: { runtime: 'Node.js', language: 'TypeScript', packageManager: 'pnpm', type: 'module', keyDeps: ['react'] },
    },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);

  assert.equal(typeof result.coverage, 'object', 'validate result must have a coverage object');
  assert.ok(result.coverage !== null, 'coverage must not be null');
  assert.equal(typeof result.coverage.stack, 'number', 'stack coverage must be a number');
  // T010 (F-056): the SUT-to-SUT equality (coverage[key] === cohesiveness[key],
  // which aliases the same number) was dropped. The oracle is hand-computed:
  // all five reported stack keys (runtime, language, packageManager, type,
  // keyDeps) are recognized, so stack coverage is 100%.
  assert.equal(result.coverage.stack, 100, '5/5 reported stack keys are recognized → 100%');
});

test('unknown keys lower coverage by their top-level key fraction', async () => {
  const overview = {
    languages: ['Python'],
    ecosystems: { primary: 'python' },
    manifest: { dependencies: { x: '1.0.0', y: '2.0.0' } },
    totalFiles: 80,
  };
  const deep = [
    {
      dimension: 'stack',
      signal: 'high',
      findings: { runtime: 'unknown', language: 'Python', framework: null, packageManager: 'uv' },
    },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);

  assert.equal(result.coverage.stack, 50, '2 reported keys / 4 total keys = 50%');
  assert.ok(!result.needsRetry.includes('stack'));
});

test('validate result contradictions carry no severity and use neutral wording', async () => {
  const overview = {
    languages: ['Go'],
    ecosystems: { primary: 'go' },
    manifest: { dependencies: { foo: '1.0.0' } },
    totalFiles: 90,
  };
  const deep = [
    { dimension: 'stack', signal: 'medium', findings: { runtime: 'Node 18', language: 'Go', packageManager: 'unknown', type: 'module', keyDeps: ['foo'] } },
    { dimension: 'testing', signal: 'medium', findings: { framework: ['unknown'], fileCount: 3 } },
  ];

  const enriched = await enrich(deep, overview);
  const result = await validate(enriched);

  for (const c of result.contradictions) {
    assert.equal('severity' in c, false, `validate-passed contradiction must not carry severity: ${JSON.stringify(c)}`);
    const desc = String(c.description).toLowerCase();
    for (const term of BANNED_VOICE) {
      assert.ok(!desc.includes(term), `banned term "${term}" in: ${c.description}`);
    }
  }
});
