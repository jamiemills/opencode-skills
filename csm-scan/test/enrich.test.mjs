import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrich } from '../lib/scan/enrich.mjs';

const BANNED_VOICE = [
  'should', 'must', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'however',
  'but', 'contradiction', 'conflict', 'inconsistent',
];

function assertContradictionsNeutral(result) {
  for (const c of result.contradictions) {
    assert.equal('severity' in c, false, `contradiction must not carry severity: ${JSON.stringify(c)}`);
    const desc = String(c.description).toLowerCase();
    for (const term of BANNED_VOICE) {
      assert.ok(
        !desc.includes(term),
        `contradiction description contains banned term "${term}": ${c.description}`,
      );
    }
  }
}

test('low scanner signal does not reduce factual coverage', async () => {
  const overview = { languages: [], ecosystems: {}, totalFiles: 0 };
  const deep = [
    {
      dimension: 'security',
      signal: 'low',
      findings: {
        enabled: false,
        count: 0,
        matches: [],
        metadata: {},
        scannerResult: 'scan completed',
        secondaryResult: 'scan completed',
      },
    },
  ];

  const result = await enrich(deep, overview);

  assert.equal(result.coverage.security, 100);
  assert.equal(result.cohesiveness.security, 100, 'compatibility alias copies coverage');
  assert.equal(result.gaps.some((note) => /signal/i.test(note.reason)), false);
});

test('unreported and factual absence sentinels lower coverage arithmetically', async () => {
  const overview = { languages: [], ecosystems: {}, totalFiles: 0 };
  const deep = [
    {
      dimension: 'security',
      signal: 'high',
      findings: {
        missing: null,
        unknown: 'unknown',
        unavailable: 'unverified',
        skipped: 'not scanned',
        blank: '',
        absent: false,
        zero: 0,
        emptyList: [],
        emptyObject: {},
        none: 'none detected',
        notApplicable: 'not applicable',
        abbreviated: 'N/A',
      },
    },
  ];

  const result = await enrich(deep, overview);

  assert.equal(result.coverage.security, 42, '5 reported keys / 12 total keys rounds to 42%');
});

test('Git inference requires a substantive commit style', async () => {
  const overview = { languages: [], ecosystems: {}, totalFiles: 0 };

  for (const commitStyle of ['N/A', 'n/a', 'not applicable', 'unknown']) {
    const result = await enrich([
      { dimension: 'git', signal: 'low', findings: { commitStyle, logCount: 0 } },
    ], overview);

    assert.equal(
      result.inferredPatterns.some((pattern) => pattern.dimension === 'git'),
      false,
      `factual absence must not produce Git inference: ${commitStyle}`,
    );
  }

  const result = await enrich([
    { dimension: 'git', signal: 'high', findings: { commitStyle: 'Conventional Commits', logCount: 30 } },
  ], overview);
  assert.ok(result.inferredPatterns.some(
    (pattern) => pattern.dimension === 'git' && pattern.pattern === 'Commit convention: Conventional Commits',
  ));
});

test('empty and missing findings have zero coverage', async () => {
  const result = await enrich(
    [{ dimension: 'security', signal: 'low', findings: {} }],
    { languages: [], ecosystems: {}, totalFiles: 0 },
  );

  assert.equal(result.coverage.security, 0);
  assert.equal(result.coverage.operations, 0);
});

test('cross-observations do not change dimension coverage', async () => {
  const overview = { languages: ['TypeScript'], ecosystems: { primary: 'typescript' }, totalFiles: 2 };
  const deep = [
    { dimension: 'config', signal: 'low', findings: { typescript: { strict: true } } },
    { dimension: 'conventions', signal: 'low', findings: { importStyle: { type: 'CJS (require/module.exports)' } } },
  ];

  const result = await enrich(deep, overview);

  assert.equal(result.coverage.config, 100);
  assert.equal(result.coverage.conventions, 100);
  assert.ok(result.contradictions.length > 0);
});

test('semantic contradiction: Node runtime vs non-JS primary language', async () => {
  const overview = {
    languages: ['Python'],
    ecosystems: { primary: 'python' },
    manifest: { dependencies: {} },
    totalFiles: 10,
  };
  const deep = [
    {
      dimension: 'stack',
      signal: 'medium',
      findings: { runtime: 'Node 18', language: 'Python', packageManager: 'pip', type: 'module', keyDeps: ['x'] },
    },
  ];

  const result = await enrich(deep, overview);
  assert.ok(
    result.contradictions.some((c) => /Node/.test(c.description) && c.dimensions.includes('stack')),
  );
  assertContradictionsNeutral(result);
});

test('ecosystem-aware inferred pattern is added when ecosystem is known', async () => {
  const overview = { languages: ['Python'], ecosystems: { primary: 'python' }, totalFiles: 5 };
  const deep = [{ dimension: 'stack', signal: 'high', findings: { runtime: 'Python', language: 'Python', packageManager: 'uv', type: 'module', keyDeps: ['x'] } }];

  const result = await enrich(deep, overview);
  assert.ok(
    result.inferredPatterns.some((p) => p.dimension === 'stack' && /Primary ecosystem: python/.test(p.pattern)),
  );
});

test('cross-observation describes co-existing facts neutrally (tsconfig strict + CJS)', async () => {
  const overview = { languages: ['TypeScript'], ecosystems: { primary: 'typescript' }, manifest: { dependencies: {} }, totalFiles: 30 };
  const deep = [
    { dimension: 'config', signal: 'high', findings: { typescript: { strict: true }, linters: ['eslint'] } },
    { dimension: 'conventions', signal: 'high', findings: { importStyle: { type: 'CJS (require/module.exports)' } } },
    { dimension: 'stack', signal: 'high', findings: { runtime: 'Node.js', language: 'TypeScript', packageManager: 'npm', type: 'commonjs', keyDeps: ['x'] } },
  ];

  const result = await enrich(deep, overview);
  const cx = result.contradictions.find((c) => c.dimensions.includes('config') && c.dimensions.includes('conventions'));
  assert.ok(cx, 'expected a config/conventions cross-observation');
  assert.ok(/strict:true/.test(cx.description));
  assert.ok(/CJS/.test(cx.description));
  assertContradictionsNeutral(result);
});

test('contradictions never carry a severity field across mixed scenarios', async () => {
  const overview = {
    languages: ['Go'],
    ecosystems: { primary: 'go' },
    manifest: { dependencies: { foo: '1.0.0', bar: '2.0.0' } },
    totalFiles: 100,
  };
  const deep = [
    { dimension: 'stack', signal: 'medium', findings: { runtime: 'Node 18', language: 'Go', packageManager: 'unknown', type: 'module', keyDeps: ['foo'] } },
    { dimension: 'testing', signal: 'medium', findings: { framework: ['unknown'], fileCount: 4 } },
    { dimension: 'architecture', signal: 'medium', findings: { importGraph: { graph: {} }, layers: { totalFiles: 5, totalEdges: 0 } } },
    { dimension: 'git', signal: 'high', findings: { commitStyle: 'Conventional Commits', logCount: 30 } },
    { dimension: 'documentation', signal: 'high', findings: { changelog: { present: true, format: 'plain markdown' } } },
  ];

  const result = await enrich(deep, overview);
  assert.ok(result.contradictions.length >= 3, `expected several cross-observations, got ${result.contradictions.length}`);
  assertContradictionsNeutral(result);
});
