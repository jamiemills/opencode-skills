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
import {
  computeCouplingAggregates,
  computeSolidIndicators,
  CRAFT_LIMITS,
} from '../lib/scan/deep/architecture/craft.mjs';
import {
  architectureObservations,
  architectureProviderResults,
} from '../lib/scan/providers/analysis-catalog.mjs';
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

// ---------------------------------------------------------------------------
// T017 architecture craft — coupling aggregates and SOLID/pattern indicators
// ---------------------------------------------------------------------------

function syntheticCraftFindings(overrides = {}) {
  return {
    modules: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
    layers: {
      entryPoints: ['src/a.ts'],
      coreModules: ['src/b.ts', 'src/c.ts'],
      libModules: ['src/b.ts'],
      shared: ['src/d.ts'],
      rest: ['src/e.ts'],
    },
    importGraph: {
      graph: {
        'src/a.ts': ['src/b.ts', 'src/d.ts'],
        'src/b.ts': ['src/c.ts'],
        'src/c.ts': ['src/a.ts', 'src/d.ts'],
        'src/d.ts': [],
        'src/e.ts': [],
      },
    },
    ...overrides,
  };
}

function solidCraftFindings() {
  return {
    modules: [
      'src/main.ts',
      'src/services/UserService.ts',
      'src/contracts/UserContract.ts',
      'src/interfaces/user-interface.ts',
      'src/adapters/StripeAdapter.ts',
      'src/ports/repository.ts',
    ],
    layers: {
      entryPoints: ['src/main.ts'],
      coreModules: [
        'src/services/UserService.ts',
        'src/contracts/UserContract.ts',
        'src/interfaces/user-interface.ts',
        'src/adapters/StripeAdapter.ts',
      ],
      shared: ['src/ports/repository.ts'],
      rest: [],
    },
    importGraph: {
      graph: {
        'src/main.ts': ['src/services/UserService.ts', 'src/contracts/UserContract.ts', 'src/ports/repository.ts'],
        'src/services/UserService.ts': ['src/contracts/UserContract.ts'],
        'src/adapters/StripeAdapter.ts': ['src/contracts/UserContract.ts', 'src/interfaces/user-interface.ts'],
        'src/contracts/UserContract.ts': [],
        'src/interfaces/user-interface.ts': [],
        'src/ports/repository.ts': ['src/contracts/UserContract.ts'],
      },
    },
  };
}

test('T017 craft: coupling aggregates are exact for a synthetic graph', () => {
  const findings = syntheticCraftFindings();
  const facts = { edgeKindCounts: { 'dynamic-import': 1, import: 4 } };
  const coupling = computeCouplingAggregates({ findings, facts });
  assert.deepEqual(coupling.fanIn.max, { count: 2, files: ['src/d.ts'], truncated: false });
  assert.deepEqual(coupling.fanOut.max, { count: 2, files: ['src/a.ts', 'src/c.ts'], truncated: false });
  assert.deepEqual(coupling.fanIn.top, [
    { path: 'src/d.ts', count: 2 },
    { path: 'src/a.ts', count: 1 },
    { path: 'src/b.ts', count: 1 },
    { path: 'src/c.ts', count: 1 },
    { path: 'src/e.ts', count: 0 },
  ]);
  assert.deepEqual(coupling.fanOut.top.slice(0, 2), [
    { path: 'src/a.ts', count: 2 },
    { path: 'src/c.ts', count: 2 },
  ]);
  assert.equal(coupling.fanInThreshold.threshold, CRAFT_LIMITS.fanInThreshold);
  assert.equal(coupling.fanInThreshold.count, 0);
  assert.deepEqual(coupling.fanInThreshold.files, []);
  assert.deepEqual(coupling.cyclicGroups, { count: 1, sizes: [3], largest: 3, truncated: false });
  assert.equal(coupling.layerBoundaries.totalEdges, 5);
  assert.equal(coupling.layerBoundaries.crossingCount, 4);
  assert.deepEqual(coupling.layerBoundaries.pairs, [
    { sourceLayer: 'core', targetLayer: 'core', count: 1 },
    { sourceLayer: 'core', targetLayer: 'entry', count: 1 },
    { sourceLayer: 'core', targetLayer: 'shared', count: 1 },
    { sourceLayer: 'entry', targetLayer: 'core', count: 1 },
    { sourceLayer: 'entry', targetLayer: 'shared', count: 1 },
  ]);
  assert.deepEqual(coupling.edgeKinds, { 'dynamic-import': 1, import: 4 });
});

test('T017 craft: files above the fan-in threshold are listed with the disclosed threshold', () => {
  const graph = { 'src/shared.ts': [] };
  for (let index = 0; index < 11; index++) {
    graph[`src/mod-${index}.ts`] = ['src/shared.ts'];
  }
  const coupling = computeCouplingAggregates({
    findings: { modules: [], layers: {}, importGraph: { graph } },
  });
  assert.equal(coupling.fanInThreshold.threshold, CRAFT_LIMITS.fanInThreshold);
  assert.equal(coupling.fanInThreshold.count, 1);
  assert.deepEqual(coupling.fanInThreshold.files, ['src/shared.ts']);
  assert.equal(coupling.fanInThreshold.truncated, false);
});

test('T017 craft: SOLID/pattern indicators are exact for a synthetic model', () => {
  const findings = solidCraftFindings();
  const indicators = computeSolidIndicators({ findings });
  assert.deepEqual(indicators.interfaceReferences, {
    count: 5,
    usageCount: 2,
    paths: ['src/contracts/UserContract.ts', 'src/interfaces/user-interface.ts'],
    truncated: false,
  });
  assert.deepEqual(indicators.dependencyDirection, {
    totalEdges: 7,
    downward: 3,
    upward: 1,
    same: 3,
    unknown: 0,
    pairs: [
      { sourceLayer: 'core', targetLayer: 'core', direction: 'same', count: 3 },
      { sourceLayer: 'entry', targetLayer: 'core', direction: 'downward', count: 2 },
      { sourceLayer: 'entry', targetLayer: 'shared', direction: 'downward', count: 1 },
      { sourceLayer: 'shared', targetLayer: 'core', direction: 'upward', count: 1 },
    ],
  });
  assert.deepEqual(indicators.portAdapterDirs, {
    paths: ['src/adapters', 'src/contracts', 'src/ports'],
    truncated: false,
  });
  assert.deepEqual(indicators.patternSuffixes.counts, {
    Adapter: 1, Factory: 0, Repository: 1, Service: 1,
  });
  assert.deepEqual(indicators.patternSuffixes.files, [
    'src/adapters/StripeAdapter.ts',
    'src/ports/repository.ts',
    'src/services/UserService.ts',
  ]);
});

test('T017 craft: path samples are bounded and truncation is disclosed', () => {
  const graph = {};
  for (let index = 0; index < CRAFT_LIMITS.pathSamples + 5; index++) {
    const contract = `src/contracts/contract-${String(index).padStart(3, '0')}.ts`;
    graph[contract] = [];
    for (let j = 0; j < 12; j++) {
      graph[`src/mod-${index}-${j}.ts`] = [contract];
    }
  }
  const findings = { modules: [], layers: {}, importGraph: { graph } };
  const coupling = computeCouplingAggregates({ findings });
  assert.equal(coupling.fanInThreshold.truncated, true);
  assert.equal(coupling.fanInThreshold.files.length, CRAFT_LIMITS.pathSamples);
  assert.equal(coupling.fanInThreshold.count, CRAFT_LIMITS.pathSamples + 5);
  const solid = computeSolidIndicators({ findings });
  assert.equal(solid.interfaceReferences.usageCount, CRAFT_LIMITS.pathSamples + 5);
  assert.equal(solid.interfaceReferences.truncated, true);
  assert.equal(solid.interfaceReferences.paths.length, CRAFT_LIMITS.pathSamples);
});

test('T017 craft: results are deterministic, deep-frozen, and privacy-safe', () => {
  const findings = syntheticCraftFindings();
  const facts = { edgeKindCounts: { import: 5 } };
  const first = computeCouplingAggregates({ findings, facts });
  const second = computeCouplingAggregates({ findings, facts });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.fanIn.top), true);
  assert.throws(() => first.fanInThreshold.files.push('x'), TypeError);
  assertPrivacySafe(first);
  const solid = computeSolidIndicators({ findings });
  assert.equal(Object.isFrozen(solid), true);
  assert.throws(() => { solid.patternSuffixes.counts.Service = 9; }, TypeError);
  assertPrivacySafe(solid);
});

test('T017 craft: insertion-order changes never alter the aggregate output', () => {
  const left = {
    layers: { entryPoints: ['m.js'], coreModules: ['a.js'] },
    importGraph: {
      graph: { 'z.js': ['a.js'], 'a.js': [], 'm.js': ['z.js', 'a.js'] },
    },
  };
  const right = {
    layers: { coreModules: ['a.js'], entryPoints: ['m.js'] },
    importGraph: {
      graph: { 'm.js': ['a.js', 'z.js'], 'a.js': [], 'z.js': ['a.js'] },
    },
  };
  assert.deepEqual(
    computeCouplingAggregates({ findings: left }),
    computeCouplingAggregates({ findings: right }),
  );
  assert.deepEqual(
    computeSolidIndicators({ findings: left }),
    computeSolidIndicators({ findings: right }),
  );
});

test('T017 craft: foreign and empty models produce empty aggregates without throwing', () => {
  const emptyCoupling = computeCouplingAggregates(null);
  assert.deepEqual(emptyCoupling.fanIn.max, { count: null, files: [], truncated: false });
  assert.deepEqual(emptyCoupling.fanIn.top, []);
  assert.equal(emptyCoupling.cyclicGroups.count, 0);
  assert.equal(emptyCoupling.layerBoundaries.totalEdges, 0);
  assert.deepEqual(computeCouplingAggregates({}), computeCouplingAggregates(null));
  const emptySolid = computeSolidIndicators(null);
  assert.equal(emptySolid.interfaceReferences.count, 0);
  assert.equal(emptySolid.interfaceReferences.usageCount, 0);
  assert.deepEqual(emptySolid.patternSuffixes.counts, {
    Adapter: 0, Factory: 0, Repository: 0, Service: 0,
  });
  assert.deepEqual(emptySolid.portAdapterDirs, { paths: [], truncated: false });
  assert.equal(Object.isFrozen(emptyCoupling), true);
  assert.equal(Object.isFrozen(emptySolid), true);
});

test('T017 catalog: architecture observations carry coupling and design_pattern facts', () => {
  const findings = solidCraftFindings();
  const facts = { edgeKindCounts: { import: 7 } };
  const [{ dimensionId, observations }] = architectureObservations({ findings, facts });
  assert.equal(dimensionId, 'DIM-architecture-v1');
  const coupling = observations.filter(({ category }) => category === 'coupling');
  const solid = observations.filter(({ category }) => category === 'design_pattern');
  assert.ok(coupling.length >= 7, 'coupling observations present');
  assert.ok(solid.length >= 4, 'design_pattern observations present');
  const byKey = new Map(observations.map((entry) => [entry.matchedKey, entry]));
  assert.equal(byKey.get('coupling:fan-in-threshold').details.threshold, CRAFT_LIMITS.fanInThreshold);
  assert.deepEqual(byKey.get('coupling:fan-in-max').details, {
    count: 4, files: ['src/contracts/UserContract.ts'], truncated: false,
  });
  assert.deepEqual(byKey.get('coupling:fan-in-top').details, {
    limit: CRAFT_LIMITS.topN,
    top: {
      'src/contracts/UserContract.ts': 4,
      'src/interfaces/user-interface.ts': 1,
      'src/ports/repository.ts': 1,
      'src/services/UserService.ts': 1,
      'src/adapters/StripeAdapter.ts': 0,
    },
  });
  assert.deepEqual(byKey.get('coupling:edge-kinds').details, { kinds: { import: 7 } });
  assert.deepEqual(byKey.get('design:dependency-direction').details, {
    totalEdges: 7,
    downward: 3,
    upward: 1,
    same: 3,
    unknown: 0,
    pairs: {
      'core:core:same': 3,
      'entry:core:downward': 2,
      'entry:shared:downward': 1,
      'shared:core:upward': 1,
    },
  });
  assert.equal(byKey.get('design:interface-references').details.count, 5);
  assert.equal(byKey.get('design:port-adapter-dirs').details.paths.length, 3);
  for (const entry of [...coupling, ...solid]) {
    assert.equal(entry.path, null, 'craft observations are aggregate records');
    assert.equal(entry.sourceKind, 'repository_metadata', entry.matchedKey);
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.details), true);
  }
  const { results, capped } = architectureProviderResults({ findings, facts });
  assert.equal(capped, false);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, 'PRV-analysis-architecture-v1');
});

test('T017 catalog: observations avoid banned words and degrade gracefully', () => {
  const banned = /\b(?:high coupling|hub|criticality|dead code)\b/i;
  const findings = solidCraftFindings();
  const [{ observations }] = architectureObservations({ findings, facts: {} });
  assert.ok(!banned.test(JSON.stringify(observations)), 'no banned words in observation data');
  assert.ok(!observations.some(({ matchedKey }) => matchedKey === 'coupling:edge-kinds'),
    'edge-kind observation is omitted when facts carry none');
  assert.deepEqual(architectureObservations(null), []);
  assert.deepEqual(architectureObservations({ findings: null }), []);
  assert.deepEqual(architectureProviderResults(null), { results: [], capped: false });
  const snapshot = JSON.stringify(findings);
  architectureObservations({ findings, facts: {} });
  assert.equal(JSON.stringify(findings), snapshot, 'scan() findings are never mutated by the derivation');
});

test('T017 integration: real scan findings feed craft aggregates and keep their exact keys', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'craft-ts', type: 'module' }),
    'src/main.ts': `import { run } from './core/service';\n`,
    'src/core/service.ts': `import { contract } from './contracts/contract';\nexport const run = contract;\n`,
    'src/core/contracts/contract.ts': `export interface Contract { id: number; }\n`,
  };
  const overview = overviewFor(['typescript'], Object.keys(files));
  const { scan: scanResult, facts } = await scanFixture('archcraft-integration', files, overview);
  assert.deepEqual(Object.keys(scanResult.findings).sort(),
    ['asciiGraph', 'c4Code', 'c4Component', 'c4Container', 'c4Context', 'importGraph', 'layers', 'modules']);
  const [{ observations }] = architectureObservations({ findings: scanResult.findings, facts });
  const coupling = observations.filter(({ category }) => category === 'coupling');
  assert.ok(coupling.some(({ matchedKey }) => matchedKey === 'coupling:fan-in-max'));
  const solid = observations.filter(({ category }) => category === 'design_pattern');
  const interfaces = solid.find(({ matchedKey }) => matchedKey === 'design:interface-references');
  assert.ok(interfaces.details.usageCount >= 1, 'interface-marked file is found by name');
  assert.equal(interfaces.details.count, 1, 'main.ts and service.ts edges target the contract');
});

test('T017 repair: expanded architecture renderer appends a neutral craft assessment', () => {
  const { renderArchitectureExpanded, renderArchitectureCraft } = awaitImportRenderers();
  const findings = {
    importGraph: {
      graph: { 'src/a.py': ['src/b.py'], 'src/b.py': [] },
      reverseGraph: { 'src/a.py': [], 'src/b.py': ['src/a.py'] },
    },
    layers: { entryPoints: ['src/a.py'], libModules: ['src/b.py'], shared: [], rest: [], totalFiles: 2 },
    modules: [],
  };
  const section = renderArchitectureExpanded('repo', findings);
  assert.ok(section.includes('### Craft Assessment'), 'craft section appended');
  assert.ok(section.includes('Maximum fan-in | 1'), 'fan-in aggregate rendered');
  assert.ok(section.includes('Maximum fan-out | 1'), 'fan-out aggregate rendered');
  const craft = renderArchitectureCraft(findings);
  assert.ok(!/(high coupling|hub|criticality|dead code)/i.test(craft), 'banned words absent');
  assert.ok(!/violation/i.test(craft), 'no verdict phrasing');
  assert.equal(renderArchitectureCraft(null), '');
});

import { renderArchitectureCraft, renderArchitectureExpanded } from '../lib/scan/render/architecture-craft.mjs';

function awaitImportRenderers() {
  return { renderArchitectureCraft, renderArchitectureExpanded };
}
