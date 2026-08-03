import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withFixture } from './harness.mjs';
import { scan, analyzeGraphFacts } from '../lib/scan/deep/architecture.mjs';
import {
  computeBounds,
  computeEdgeKindCounts,
  computeFanInOut,
  computeSelfLoops,
  GRAPH_FACTS_LIMITS,
  tarjanStronglyConnectedComponents,
} from '../lib/scan/deep/architecture/graph-facts.mjs';
import { detectDynamicIndicators, INDICATOR_KINDS } from '../lib/scan/deep/architecture/indicators.mjs';
import { createArchitectureExtensionRenderer, DEFAULT_ARCHITECTURE_EXTENSION_RENDERER } from '../lib/scan/render/architecture-extension.mjs';
import { assertPrivacySafe } from '../lib/scan/shared/privacy.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';

function overviewFor(ecosystems, files) {
  return { ecosystems: { primary: ecosystems[0], all: ecosystems }, files };
}

async function scanFixture(name, files, overview) {
  return withFixture(name, files, async (dir) => {
    const [scanResult, facts] = await Promise.all([
      scan(dir, overview),
      analyzeGraphFacts(dir, overview),
    ]);
    return { scan: scanResult, facts };
  });
}

// ---------------------------------------------------------------------------
// Graph-facts algorithms (hand-authored graphs, exact results)
// ---------------------------------------------------------------------------

test('T217 fan-in/fan-out counts are exact and include zero-degree files', () => {
  const graph = {
    a: ['b', 'd'],
    b: ['c'],
    c: ['a', 'f'],
    d: ['e'],
    e: ['d'],
    f: ['g'],
    g: [],
  };
  const { fanIn, fanOut } = computeFanInOut(graph);
  assert.deepEqual(fanIn, {
    a: 1, b: 1, c: 1, d: 2, e: 1, f: 1, g: 1,
  });
  assert.deepEqual(fanOut, {
    a: 2, b: 1, c: 2, d: 1, e: 1, f: 1, g: 0,
  });
  assert.equal(Object.keys(fanIn).sort().join(','), 'a,b,c,d,e,f,g');
});

test('T217 self-loops are detected and sorted deterministically', () => {
  const graph = {
    x: ['x', 'y'],
    y: [],
    z: ['x'],
    w: ['w', 'w'],
  };
  assert.deepEqual(computeSelfLoops(graph), ['w', 'x']);
  assert.deepEqual(computeSelfLoops({ p: ['q'], q: [] }), []);
});

test('T217 edge-kind counts aggregate deterministically', () => {
  const edgeKinds = {
    a: { b: 'import', d: 'require' },
    b: { c: 'import' },
    c: { a: 'dynamic-import' },
  };
  assert.deepEqual(computeEdgeKindCounts(edgeKinds), {
    'dynamic-import': 1,
    import: 2,
    require: 1,
  });
  assert.deepEqual(computeEdgeKindCounts({}), {});
});

test('T217 Tarjan SCCs return exact cyclic, singleton, and total counts', () => {
  const graph = {
    a: ['b', 'd'],
    b: ['c'],
    c: ['a', 'f'],
    d: ['e'],
    e: ['d'],
    f: ['g'],
    g: [],
    h: ['h'],
  };
  const scc = tarjanStronglyConnectedComponents(graph);
  assert.equal(scc.totalComponents, 5);
  assert.equal(scc.singletonComponents, 3);
  assert.deepEqual(scc.cyclicComponents, [
    { size: 3, members: ['a', 'b', 'c'] },
    { size: 2, members: ['d', 'e'] },
  ]);
});

test('T217 SCC order is deterministic regardless of insertion order', () => {
  const left = {
    a: ['b'], b: ['c'], c: ['a'],
    d: ['e'], e: ['d'],
    x: ['y'], y: [],
  };
  const right = {
    x: ['y'], y: [],
    d: ['e'], e: ['d'],
    a: ['b'], b: ['c'], c: ['a'],
  };
  assert.deepEqual(tarjanStronglyConnectedComponents(left), tarjanStronglyConnectedComponents(right));
});

test('T217 bounds disclose inspected, limit, omitted, and capped state', () => {
  assert.deepEqual(computeBounds({
    filesInspected: 3, fileLimit: 5, filesOmitted: 2,
    edgesInspected: 4, edgeLimit: 5, edgesOmitted: 1,
  }), {
    filesInspected: 3, fileLimit: 5, filesOmitted: 2,
    edgesInspected: 4, edgeLimit: 5, edgesOmitted: 1, capped: true,
  });
  assert.equal(computeBounds({
    filesInspected: 5, fileLimit: 5, filesOmitted: 0,
    edgesInspected: 5, edgeLimit: 5, edgesOmitted: 0,
  }).capped, false);
  assert.equal(Object.isFrozen(GRAPH_FACTS_LIMITS), true);
});

// ---------------------------------------------------------------------------
// Dynamic indicators (literal constructs only; never speculative edges)
// ---------------------------------------------------------------------------

test('T217 JS dynamic constructs produce indicators; literals are recorded, non-literals are not', () => {
  const content = [
    `import { a } from './a';`,
    `const d = import('./dyn');`,
    `const r = require('./req');`,
    `const v = import(someVar);`,
    `const t = import(\`template\`);`,
    `eval('code');`,
    `new Function('return 1');`,
    `import.meta.url;`,
    `createRequire(import.meta.url);`,
    `Reflect.apply(fn, null, []);`,
    `require.resolve('./resolved');`,
    `// import('./commented');`,
    `/* require('./block') */`,
    `const s = "import('./string')";`,
    `const u = 'require("./also-string")';`,
  ].join('\n');
  const indicators = detectDynamicIndicators(content, 'javascript');
  const summary = indicators.map(({ kind, line, specifier }) => ({ kind, line, specifier }));
  assert.deepEqual(summary, [
    { kind: 'dynamic-import', line: 2, specifier: './dyn' },
    { kind: 'dynamic-import', line: 3, specifier: './req' },
    { kind: 'dynamic-import', line: 4, specifier: null },
    { kind: 'dynamic-import', line: 5, specifier: null },
    { kind: 'codegen', line: 6, specifier: null },
    { kind: 'codegen', line: 7, specifier: null },
    { kind: 'reflection', line: 8, specifier: null },
    { kind: 'plugin-loading', line: 9, specifier: null },
    { kind: 'reflection', line: 9, specifier: null },
    { kind: 'reflection', line: 10, specifier: null },
    { kind: 'reflection', line: 11, specifier: './resolved' },
  ]);
  assert.ok(!indicators.some(({ line }) => line >= 12), 'comments and strings must not produce indicators');
  for (const kind of indicators.map(({ kind }) => kind)) {
    assert.ok(INDICATOR_KINDS.includes(kind), `unexpected indicator kind ${kind}`);
  }
});

test('T217 Python dynamic constructs produce indicators only', () => {
  const content = [
    `import importlib`,
    `importlib.import_module('pkg')`,
    `__import__('other')`,
    `import_module(moduleName)`,
    `eval(source)`,
    `exec(compiled)`,
    `compile(text, 'f', 'exec')`,
    `getattr(mod, 'attr')`,
    `importlib.util.find_spec('pkg')`,
    `importlib.machinery.SourceFileLoader`,
    `spec_from_file_location('name', 'path')`,
    `pkg_resources.iter_entry_points('group')`,
    `importlib.metadata.entry_points()`,
    `# exec(fake)`,
    `""" exec(docstring) """`,
  ].join('\n');
  const indicators = detectDynamicIndicators(content, 'python');
  const summary = indicators.map(({ kind, line, specifier }) => ({ kind, line, specifier }));
  assert.deepEqual(summary, [
    { kind: 'dynamic-import', line: 2, specifier: 'pkg' },
    { kind: 'dynamic-import', line: 3, specifier: 'other' },
    { kind: 'dynamic-import', line: 4, specifier: null },
    { kind: 'codegen', line: 5, specifier: null },
    { kind: 'codegen', line: 6, specifier: null },
    { kind: 'codegen', line: 7, specifier: null },
    { kind: 'reflection', line: 8, specifier: null },
    { kind: 'plugin-loading', line: 9, specifier: 'pkg' },
    { kind: 'plugin-loading', line: 10, specifier: null },
    { kind: 'plugin-loading', line: 11, specifier: 'name' },
    { kind: 'plugin-loading', line: 12, specifier: null },
    { kind: 'plugin-loading', line: 13, specifier: null },
  ]);
  assert.ok(!indicators.some(({ line }) => line >= 14), 'comments and docstrings must not produce indicators');
});

test('T217 Rust macro and codegen indicators are literal and bounded', () => {
  const content = [
    `include!("lib.rs");`,
    `include_str!("asset.txt");`,
    `include_bytes!("bytes.bin");`,
    `macro_rules! m { () => {} }`,
    `#[cfg(target_os = "linux")]`,
    `mod inner;`,
    `#[proc_macro_derive(Thing)]`,
    `#[proc_macro]`,
    `// include!("fake.rs");`,
  ].join('\n');
  const indicators = detectDynamicIndicators(content, 'rust');
  assert.deepEqual(indicators, [
    { kind: 'macro', specifier: 'lib.rs', line: 1 },
    { kind: 'macro', specifier: 'asset.txt', line: 2 },
    { kind: 'macro', specifier: 'bytes.bin', line: 3 },
    { kind: 'macro', specifier: null, line: 4 },
    { kind: 'macro', specifier: null, line: 5 },
    { kind: 'codegen', specifier: null, line: 7 },
    { kind: 'codegen', specifier: null, line: 8 },
  ]);
});

test('T217 shell eval and non-literal source produce indicators; literal source does not', () => {
  const content = [
    `eval "ls"`,
    `source "$DIR/lib.sh"`,
    `source ./lib.sh`,
    `. "$HOME/x.sh"`,
    `# eval fake`,
  ].join('\n');
  const indicators = detectDynamicIndicators(content, 'shell');
  assert.deepEqual(indicators, [
    { kind: 'codegen', specifier: null, line: 1 },
    { kind: 'dynamic-import', specifier: null, line: 2 },
    { kind: 'dynamic-import', specifier: null, line: 4 },
  ]);
});

test('T217 unknown ecosystems and unsafe specifiers are handled defensively', () => {
  assert.deepEqual(detectDynamicIndicators('whatever', 'unknown-language'), []);
  assert.deepEqual(detectDynamicIndicators('', 'javascript'), []);
  const unsafe = detectDynamicIndicators("import('/etc/passwd');\nimport('a b');\nimport('ok');", 'javascript');
  assert.deepEqual(unsafe.map(({ specifier }) => specifier), [null, null, 'ok']);
  assert.ok(Object.isFrozen(unsafe));
});

// ---------------------------------------------------------------------------
// analyzeGraphFacts integration: bounds, universe, kinds, fan, SCCs, indicators
// ---------------------------------------------------------------------------

test('T217 analyzeGraphFacts reports exact facts for a TS dynamic fixture and matches the scan graph', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'dyn-facts', type: 'module' }),
    'src/index.ts': [
      `import { a } from './a';`,
      `const d = import('./dyn');`,
      `const r = require('./req');`,
      `const v = import(someVar);`,
      `eval('code');`,
      `import.meta.url;`,
      `export const x = a + d;`,
    ].join('\n'),
    'src/a.ts': `export const a = 1;\n`,
    'src/dyn.ts': `export const dyn = 2;\n`,
    'src/req.ts': `export const req = 3;\n`,
  };
  const overview = overviewFor(['typescript'], Object.keys(files));
  const { scan: scanResult, facts } = await scanFixture('archfacts-ts-dynamic', files, overview);

  assert.deepEqual(facts.bounds, {
    filesInspected: 4, fileLimit: GRAPH_FACTS_LIMITS.files, filesOmitted: 0,
    edgesInspected: 3, edgeLimit: GRAPH_FACTS_LIMITS.edges, edgesOmitted: 0, capped: false,
  });
  assert.deepEqual(facts.universe, {
    ecosystems: ['typescript'], moduleFiles: 4, sourceFiles: 4,
    testFilesExcluded: 0, declarationFilesExcluded: 0,
    indicatorsDetected: 5, indicatorsOmitted: 0,
  });
  assert.deepEqual(facts.edgeKindCounts, {
    'dynamic-import': 1, import: 1, require: 1,
  });
  assert.deepEqual(facts.fanIn, { 'src/a.ts': 1, 'src/dyn.ts': 1, 'src/req.ts': 1, 'src/index.ts': 0 });
  assert.deepEqual(facts.fanOut, { 'src/a.ts': 0, 'src/dyn.ts': 0, 'src/index.ts': 3, 'src/req.ts': 0 });
  assert.deepEqual(facts.selfLoops, []);
  assert.deepEqual(facts.stronglyConnectedComponents, {
    totalComponents: 4, singletonComponents: 4, cyclicComponents: [],
  });
  assert.deepEqual(facts.dynamicIndicators, [
    { file: 'src/index.ts', kind: 'dynamic-import', specifier: './dyn', line: 2 },
    { file: 'src/index.ts', kind: 'dynamic-import', specifier: './req', line: 3 },
    { file: 'src/index.ts', kind: 'dynamic-import', specifier: null, line: 4 },
    { file: 'src/index.ts', kind: 'codegen', specifier: null, line: 5 },
    { file: 'src/index.ts', kind: 'reflection', specifier: null, line: 6 },
  ]);

  const kindTotal = Object.values(facts.edgeKindCounts).reduce((a, b) => a + b, 0);
  assert.equal(kindTotal, scanResult.findings.layers.totalEdges);
  assert.equal(kindTotal, scanResult.findings.importGraph.graph['src/index.ts'].length);
  for (const [file, targets] of Object.entries(scanResult.findings.importGraph.graph)) {
    assert.equal(facts.fanOut[file], targets.length, `${file} fan-out must match the preserved graph`);
  }
  assert.equal('graphFacts' in scanResult.findings, false, 'scan() must keep its original findings shape');
  assert.deepEqual(Object.keys(scanResult.findings).sort(),
    ['asciiGraph', 'c4Code', 'c4Component', 'c4Container', 'c4Context', 'importGraph', 'layers', 'modules']);
});

test('T217 cycles produce Tarjan SCC facts and self-loops are listed', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'cycles', type: 'module' }),
    'src/cyc-a.ts': `import { b } from './cyc-b';\nexport const a = b;\n`,
    'src/cyc-b.ts': `import { a } from './cyc-a';\nexport const b = a;\n`,
    'src/self.ts': `import { self } from './self';\nexport const self = 1;\n`,
    'src/leaf.ts': `export const leaf = 2;\n`,
  };
  const overview = overviewFor(['typescript'], Object.keys(files));
  const { facts } = await scanFixture('archfacts-cycles', files, overview);
  assert.deepEqual(facts.selfLoops, ['src/self.ts']);
  assert.deepEqual(facts.stronglyConnectedComponents, {
    totalComponents: 3, singletonComponents: 2,
    cyclicComponents: [{ size: 2, members: ['src/cyc-a.ts', 'src/cyc-b.ts'] }],
  });
  assert.equal(Object.values(facts.edgeKindCounts).reduce((a, b) => a + b, 0), 3);
});

test('T217 non-literal dynamic constructs produce indicators and never speculative edges', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'non-literal', type: 'module' }),
    'src/loader.ts': [
      `import { run } from './run';`,
      `export async function load(name: string) {`,
      `  const mod = await import(name);`,
      `  return mod;`,
      `}`,
      `export const x = run;`,
    ].join('\n'),
    'src/run.ts': `export const run = 1;\n`,
  };
  const overview = overviewFor(['typescript'], Object.keys(files));
  const { scan: scanResult, facts } = await scanFixture('archfacts-nonliteral', files, overview);
  assert.deepEqual(scanResult.findings.importGraph.graph['src/loader.ts'], ['src/run.ts']);
  assert.deepEqual(
    facts.dynamicIndicators.filter(({ kind }) => kind === 'dynamic-import'),
    [{ file: 'src/loader.ts', kind: 'dynamic-import', specifier: null, line: 3 }],
  );
  assert.equal(facts.bounds.edgesInspected, 1);
});

test('T217 graph bounds cap files and edges and disclose omission', async () => {
  const files = {};
  for (let i = 0; i < 6; i++) {
    files[`src/m${i}.ts`] = i < 5 ? `import { v } from './m${i + 1}';\n` : '';
  }
  files['package.json'] = JSON.stringify({ name: 'caps' });
  const overview = overviewFor(['typescript'], Object.keys(files));
  await withFixture('archfacts-caps', files, async (dir) => {
    const facts = await analyzeGraphFacts(dir, overview, { limits: { files: 3, edges: 2 } });
    assert.equal(facts.bounds.filesInspected, 3);
    assert.equal(facts.bounds.filesOmitted, 3);
    assert.equal(facts.bounds.edgesInspected, 2);
    assert.equal(facts.bounds.edgesOmitted, 0);
    assert.equal(facts.bounds.capped, true);
    assert.equal(facts.universe.sourceFiles, 6, 'universe still reports the full source universe');
  });
});

test('T217 indicator caps disclose omission without losing earlier indicators', async () => {
  const files = {};
  for (let i = 0; i < 3; i++) {
    files[`src/m${i}.ts`] = 'import("x");\nimport("y");\nimport("z");\n';
  }
  files['package.json'] = JSON.stringify({ name: 'ind-caps' });
  const overview = overviewFor(['typescript'], Object.keys(files));
  await withFixture('archfacts-ind-caps', files, async (dir) => {
    const facts = await analyzeGraphFacts(dir, overview, { limits: { indicators: 2 } });
    assert.equal(facts.dynamicIndicators.length, 2);
    assert.equal(facts.universe.indicatorsDetected, 9);
    assert.equal(facts.universe.indicatorsOmitted, 7);
  });
});

test('T217 graph facts are deterministic, deep-frozen, and privacy-safe', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'det', type: 'module' }),
    'src/app.ts': `import { v } from './v';\nconst d = import('./d');\n`,
    'src/v.ts': `export const v = 1;\n`,
    'src/d.ts': `export const d = 2;\n`,
  };
  const overview = overviewFor(['typescript'], Object.keys(files));
  await withFixture('archfacts-det', files, async (dir) => {
    const first = await analyzeGraphFacts(dir, overview);
    const second = await analyzeGraphFacts(dir, overview);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assertPrivacySafe(first);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.bounds), true);
    assert.equal(Object.isFrozen(first.fanIn), true);
    assert.equal(Object.isFrozen(first.dynamicIndicators), true);
    assert.throws(() => first.bounds.filesInspected = 99, TypeError);
    assert.throws(() => first.dynamicIndicators.push({}), TypeError);
  });
});

test('T217 the five built-in fixtures keep their preserved import graph and agree with graph facts', async () => {
  const fixtures = [
    ['python', pythonFiles, ['python']],
    ['javascript', javascriptFiles, ['javascript']],
    ['typescript', typescriptFiles, ['typescript']],
    ['shell', shellFiles, ['shell']],
    ['rust', rustFiles, ['rust']],
  ];
  for (const [name, files, ecosystems] of fixtures) {
    const overview = overviewFor(ecosystems, Object.keys(files));
    const { scan: scanResult, facts } = await scanFixture(`archfacts-parity-${name}`, files, overview);
    const graph = scanResult.findings.importGraph.graph;
    assert.ok(Object.keys(graph).length > 0, `${name} fixture must build a graph`);
    const kindTotal = Object.values(facts.edgeKindCounts).reduce((a, b) => a + b, 0);
    assert.equal(kindTotal, scanResult.findings.layers.totalEdges, `${name} edge-kind total must match the preserved graph`);
    for (const [file, targets] of Object.entries(graph)) {
      assert.equal(facts.fanOut[file], targets.length, `${name} fan-out must match the preserved graph`);
    }
    assert.deepEqual(facts.universe.ecosystems, ecosystems);
    assert.equal(facts.bounds.capped, false);
  }
});

// ---------------------------------------------------------------------------
// Renderer extension (inert factory)
// ---------------------------------------------------------------------------

const SAMPLE_FACTS = {
  bounds: {
    filesInspected: 4, fileLimit: 50_000, filesOmitted: 0,
    edgesInspected: 3, edgeLimit: 500_000, edgesOmitted: 0, capped: false,
  },
  universe: {
    ecosystems: ['typescript'], moduleFiles: 4, sourceFiles: 4,
    testFilesExcluded: 0, declarationFilesExcluded: 0,
    indicatorsDetected: 2, indicatorsOmitted: 0,
  },
  edgeKindCounts: { 'dynamic-import': 1, import: 1, require: 1 },
  selfLoops: [],
  stronglyConnectedComponents: { totalComponents: 4, singletonComponents: 4, cyclicComponents: [] },
  dynamicIndicators: [
    { file: 'src/index.ts', kind: 'dynamic-import', specifier: './dyn', line: 2 },
    { file: 'src/index.ts', kind: 'codegen', specifier: null, line: 5 },
  ],
  fanIn: { 'src/a.ts': 1, 'src/index.ts': 0 },
  fanOut: { 'src/a.ts': 0, 'src/index.ts': 3 },
};

const BANNED_VOICE = /\b(?:should|must|poor|good|bad|weak|strong|better|worse|recommended|concern|problem|inconsistent|conflict)\b/i;

test('T217 renderer extension is an inert factory that renders neutral raw facts', () => {
  const renderer = createArchitectureExtensionRenderer();
  assert.equal(typeof renderer.render, 'function');
  assert.equal(Object.isFrozen(renderer), true);
  assert.equal(renderer.render('repo', { layers: {} }), '', 'no graph facts renders nothing');
  assert.equal(renderer.render('repo', null), '');

  const out = renderer.render('repo', { graphFacts: SAMPLE_FACTS });
  assert.ok(out.startsWith('### Architecture — Graph Facts'));
  assert.match(out, /\| Files inspected \| 4 \|/);
  assert.match(out, /\| Edges inspected \| 3 \|/);
  assert.match(out, /\| Ecosystems \| typescript \|/);
  assert.match(out, /\| import \| 1 \|/);
  assert.match(out, /src\/index\.ts:2 dynamic-import `\.\/dyn`/);
  assert.ok(!/\b(?:high coupling|hub|criticality|dead code)\b/i.test(out), 'no quality verdict');
  assert.doesNotMatch(out, BANNED_VOICE, 'renderer must keep neutral factual voice');
  assert.doesNotMatch(out, /(?:^|[\s"'=(])\/(?!\/)[A-Za-z0-9._~-]+/, 'no absolute paths in rendered output');
  assert.doesNotMatch(out, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'no emails in rendered output');
  assertPrivacySafe(SAMPLE_FACTS);
});

test('T217 renderer extension renders self-loops and cyclic SCC rows when present', () => {
  const renderer = createArchitectureExtensionRenderer();
  const facts = {
    ...SAMPLE_FACTS,
    selfLoops: ['src/self.ts'],
    stronglyConnectedComponents: {
      totalComponents: 2, singletonComponents: 1,
      cyclicComponents: [{ size: 2, members: ['src/a.ts', 'src/b.ts'] }],
    },
  };
  const out = renderer.render('repo', { graphFacts: facts });
  assert.match(out, /\*\*Self-loops\*\*: 1 file\(s\)/);
  assert.match(out, /src\/self\.ts/);
  assert.match(out, /2 member\(s\): src\/a\.ts, src\/b\.ts/);
  assert.match(out, /\*\*Strongly-connected components\*\*: 2 total \(1 singleton; 1 cyclic\)/);
});

test('T217 renderer extension rejects an invalid context and exposes a default factory', () => {
  assert.throws(() => createArchitectureExtensionRenderer({ context: null }), TypeError);
  assert.equal(typeof DEFAULT_ARCHITECTURE_EXTENSION_RENDERER.render, 'function');
});
