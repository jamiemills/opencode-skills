import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withFixture, surveyOverview } from './harness.mjs';
import { scan as scanArchitecture, analyzeGraphFacts } from '../lib/scan/deep/architecture.mjs';
import { scan as scanConventions } from '../lib/scan/deep/conventions.mjs';
import { scan as scanDocumentation } from '../lib/scan/deep/documentation.mjs';
import {
  analysisProviderResults,
  analysisPluginObservations,
  analysisPluginProviderResults,
  architectureObservations,
  architectureProviderResults,
  conventionsObservations,
  conventionsProviderResults,
  documentationObservations,
  documentationProviderResults,
  mergeAnalysisResults,
  ANALYSIS_CATALOG_VERSION,
  ANALYSIS_DIMENSION_IDS,
  ANALYSIS_PLUGIN_PROVIDER_ID,
  ANALYSIS_PROVIDER_IDS,
} from '../lib/scan/providers/analysis-catalog.mjs';
import { createProviderResult, mergeProviderResults, PROVIDER_RESULT_LIMITS } from '../lib/scan/providers/base.mjs';
import { genericProviderResults, GENERIC_PROVIDER_ID } from '../lib/scan/providers/generic.mjs';
import {
  PRACTICES_DIMENSION_ID,
  PRACTICES_PROVIDER_ID,
  practicesObservations,
  practicesProviderResult,
} from '../lib/scan/providers/practices.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';

const LIB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIVE_ECOSYSTEM_FIXTURES = [
  ['python', pythonFiles],
  ['javascript', javascriptFiles],
  ['typescript', typescriptFiles],
  ['shell', shellFiles],
  ['rust', rustFiles],
];

function providerFor(results, dimensionId) {
  return results.find((result) => result.dimensionId === dimensionId);
}

function keyed(observations) {
  return new Map(observations.map((entry) => [entry.matchedKey, entry]));
}

function assertCanonicalOrder(observations) {
  const sorted = observations.slice().toSorted((left, right) => {
    const a = `${left.category}\0${left.path ?? ''}\0${left.matchedKey}`;
    const b = `${right.category}\0${right.path ?? ''}\0${right.matchedKey}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  assert.deepEqual(observations.map(({ category, path, matchedKey }) => ({ category, path, matchedKey })),
    sorted.map(({ category, path, matchedKey }) => ({ category, path, matchedKey })),
    'observations are canonically ordered');
}

const edgeCompare = (left, right) => {
  const a = `${left[0]}\0${left[1]}`;
  const b = `${right[0]}\0${right[1]}`;
  return a < b ? -1 : a > b ? 1 : 0;
};

function assertArchitectureParity(architecture, findings, facts) {
  const byKey = keyed(architecture.observations);

  const modules = architecture.observations.filter(({ category }) => category === 'module');
  assert.deepEqual(modules.map(({ path }) => path), findings.modules.slice().toSorted(), 'module paths');
  for (const entry of modules) {
    assert.equal(entry.details.fanIn, facts.fanIn[entry.path] ?? 0, `fanIn ${entry.path}`);
    assert.equal(entry.details.fanOut, facts.fanOut[entry.path] ?? 0, `fanOut ${entry.path}`);
    assert.equal(entry.details.selfLoop, facts.selfLoops.includes(entry.path), `selfLoop ${entry.path}`);
    assert.equal(entry.sourceKind, 'source');
  }

  const entryPoints = architecture.observations.filter(({ category }) => category === 'entry_point');
  assert.deepEqual(entryPoints.map(({ path }) => path),
    (findings.layers.entryPoints || []).slice().toSorted(), 'entry-point paths');

  const edges = architecture.observations.filter(({ category }) => category === 'import_edge');
  const expectedEdges = [];
  for (const [source, targets] of Object.entries(findings.importGraph.graph)) {
    for (const target of targets || []) expectedEdges.push([source, target]);
  }
  assert.deepEqual(
    edges.map(({ path, details }) => [path, details.target]).toSorted(edgeCompare),
    expectedEdges.toSorted(edgeCompare),
    'import-edge pairs',
  );
  assert.ok(edges.every(({ sourceKind }) => sourceKind === 'source'), 'import-edge source kind');

  const indicators = architecture.observations.filter(({ category }) => category === 'dynamic_indicator');
  assert.deepEqual(
    indicators.map(({ path, details }) => ({ file: path, kind: details.kind, specifier: details.specifier, line: details.line })),
    facts.dynamicIndicators,
    'dynamic indicators',
  );

  assert.deepEqual(byKey.get('graph:bounds').details, facts.bounds, 'graph bounds');
  assert.deepEqual(byKey.get('graph:universe').details, facts.universe, 'graph universe');
  assert.deepEqual(byKey.get('graph:edge-kinds').details.kinds, facts.edgeKindCounts, 'graph edge kinds');
  const scc = byKey.get('graph:scc');
  assert.equal(scc.details.totalComponents, facts.stronglyConnectedComponents.totalComponents);
  assert.equal(scc.details.singletonComponents, facts.stronglyConnectedComponents.singletonComponents);
  assert.equal(scc.details.cyclicCount, facts.stronglyConnectedComponents.cyclicComponents.length);
  assert.deepEqual(scc.details.cyclicSizes,
    facts.stronglyConnectedComponents.cyclicComponents.map(({ size }) => size));
  assert.equal(scc.details.cyclicSizesTruncated, false);
  const fan = byKey.get('graph:fan');
  const fanInValues = Object.values(facts.fanIn);
  const fanOutValues = Object.values(facts.fanOut);
  assert.equal(fan.details.totalEdges, facts.bounds.edgesInspected + facts.bounds.edgesOmitted);
  assert.equal(fan.details.maxFanIn, fanInValues.length ? Math.max(...fanInValues) : null);
  assert.equal(fan.details.maxFanOut, fanOutValues.length ? Math.max(...fanOutValues) : null);
  assert.equal(fan.details.filesWithInboundEdges, fanInValues.filter((value) => value > 0).length);
  assert.equal(fan.details.filesWithOutboundEdges, fanOutValues.filter((value) => value > 0).length);
  assert.equal(fan.details.selfLoopCount, facts.selfLoops.length);
}

function assertConventionsParity(conventions, findings) {
  const byKey = keyed(conventions.observations);

  const style = byKey.get('import-style');
  assert.deepEqual(style.details, {
    type: findings.importStyle.type,
    esmCount: findings.importStyle.esmCount,
    cjsCount: findings.importStyle.cjsCount,
    hasTypeImports: findings.importStyle.hasTypeImports,
    hasDynamicImports: findings.importStyle.hasDynamicImports,
  });

  const ecoObservations = new Map(
    conventions.observations
      .filter(({ matchedKey }) => matchedKey.startsWith('import-style:'))
      .map(({ matchedKey, details }) => [matchedKey.slice('import-style:'.length), details]),
  );
  for (const [ecosystem, entry] of Object.entries(findings.importStyle.byEcosystem || {})) {
    const details = ecoObservations.get(ecosystem);
    assert.ok(details, `import-style:${ecosystem}`);
    const counts = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key !== 'type' && Number.isSafeInteger(value)) counts[key] = value;
    }
    assert.deepEqual(details, { ecosystem, type: entry.type, counts });
  }

  const naming = byKey.get('file-naming');
  assert.deepEqual(naming.details, {
    dominant: findings.fileNaming.dominant,
    patterns: findings.fileNaming.patterns,
    total: findings.fileNaming.total,
  });

  const errors = byKey.get('error-handling');
  assert.deepEqual(errors.details, {
    patterns: findings.errorHandling.patterns,
    counts: findings.errorHandling.counts,
  });

  const moduleSystem = byKey.get('module-system');
  assert.deepEqual(moduleSystem.details, {
    packageJsonType: findings.moduleSystem.packageJsonType,
    inferred: findings.moduleSystem.inferred,
  });

  const density = byKey.get('comment-density');
  assert.deepEqual(density.details, { density: findings.commentDensity });

  const docstrings = byKey.get('docstrings');
  assert.deepEqual(docstrings.details, {
    patterns: findings.docstrings.patterns,
    coverage: findings.docstrings.coverage,
  });

  const categories = new Set(conventions.observations.map(({ category }) => category));
  assert.deepEqual([...categories].toSorted(), ['comment', 'error_handling', 'file_naming', 'import_style', 'module_system']);
}

function relativeTo(repoPath, value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const repo = String(repoPath).replace(/\/+$/, '');
  return value.startsWith(`${repo}/`) ? value.slice(repo.length + 1) : value;
}

function assertDocumentationParity(documentation, findings, repoPath) {
  const byKey = keyed(documentation.observations);

  const readme = byKey.get('readme');
  const { path: readmePath, ...readmeDetails } = findings.readme;
  assert.equal(readme.path, relativeTo(repoPath, readmePath));
  assert.deepEqual(readme.details, readmeDetails);

  const license = byKey.get('license');
  assert.equal(license.path, relativeTo(repoPath, findings.license.path));
  assert.deepEqual(license.details, { present: findings.license.present, name: findings.license.name });

  const contributing = byKey.get('contributing');
  assert.equal(contributing.path, relativeTo(repoPath, findings.contributing.path));
  assert.deepEqual(contributing.details, { present: findings.contributing.present });

  const changelog = byKey.get('reference:changelog');
  assert.equal(changelog.path, relativeTo(repoPath, findings.changelog.path));
  assert.deepEqual(changelog.details, { present: findings.changelog.present, format: findings.changelog.format });

  const coc = byKey.get('reference:code-of-conduct');
  assert.deepEqual(coc.details, { present: findings.codeOfConduct });

  const adrs = byKey.get('reference:adrs');
  assert.deepEqual(adrs.details.paths, findings.adrs.map(({ path }) => path));
  assert.equal(adrs.details.count, findings.adrs.reduce((sum, { count }) => sum + count, 0));

  const ratio = byKey.get('reference:comment-ratio');
  assert.deepEqual(ratio.details, {
    ratio: findings.commentRatio.ratio,
    commentLines: findings.commentRatio.commentLines,
    codeLines: findings.commentRatio.codeLines,
  });

  const dialect = byKey.get('reference:docstring-dialect');
  assert.deepEqual(dialect.details, {
    dominant: findings.docstringDialect.dominant,
    counts: findings.docstringDialect.counts,
    filesAnalyzed: findings.docstringDialect.filesAnalyzed,
  });

  const docStyle = byKey.get('reference:doc-style');
  assert.deepEqual(docStyle.details, {
    jsdocBlocks: findings.docStyle.jsdocBlocks,
    tsdocBlocks: findings.docStyle.tsdocBlocks,
    dominant: findings.docStyle.dominant,
    filesAnalyzed: findings.docStyle.filesAnalyzed,
  });

  const todo = byKey.get('reference:todo-count');
  assert.deepEqual(todo.details, { count: findings.todoCount });

  const categories = new Set(documentation.observations.map(({ category }) => category));
  assert.deepEqual([...categories].toSorted(), ['contributing', 'license', 'readme', 'reference']);
}

async function scanAnalysisFixture(name, files) {
  return withFixture(name, files, async (repoPath) => {
    const overview = await surveyOverview(repoPath);
    const [architecture, facts, conventions, documentation] = await Promise.all([
      scanArchitecture(repoPath, overview),
      analyzeGraphFacts(repoPath, overview),
      scanConventions(repoPath, overview),
      scanDocumentation(repoPath, overview),
    ]);
    const { results, capped } = analysisProviderResults({
      architecture: { findings: architecture.findings, facts },
      conventions: conventions.findings,
      documentation: { repoPath, findings: documentation.findings },
    });
    return { repoPath, results, capped, architecture, facts, conventions, documentation };
  });
}

// ---------------------------------------------------------------------------
// Parity — built-in scanner findings vs provider catalog observations
// ---------------------------------------------------------------------------

test('T219 parity: five-ecosystem snapshot mirrors built-in architecture findings', async () => {
  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    const { results, capped, architecture, facts } = await scanAnalysisFixture(name, files);
    assert.equal(capped, false, `${name} capped`);
    assert.equal(results.length, 3, `${name} result count`);
    assert.ok(providerFor(results, 'DIM-architecture-v1'), `${name} architecture`);
    assert.ok(providerFor(results, 'DIM-conventions-v1'), `${name} conventions`);
    assert.ok(providerFor(results, 'DIM-documentation-v1'), `${name} documentation`);
    assertArchitectureParity(providerFor(results, 'DIM-architecture-v1'), architecture.findings, facts);
  }
});

test('T219 parity: five-ecosystem snapshot mirrors built-in conventions findings', async () => {
  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    const { results, conventions } = await scanAnalysisFixture(name, files);
    assertConventionsParity(providerFor(results, 'DIM-conventions-v1'), conventions.findings);
  }
});

test('T219 parity: five-ecosystem snapshot mirrors built-in documentation findings', async () => {
  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    const { repoPath, results, documentation } = await scanAnalysisFixture(name, files);
    assertDocumentationParity(providerFor(results, 'DIM-documentation-v1'), documentation.findings, repoPath);
  }
});

test('T219 parity: documentation adapter normalizes absolute paths and captures rich artifacts', async () => {
  const files = {
    'README.md': '# Demo\n\n## Setup\nInstall me.\n\n![npm](https://img.shields.io/npm/v/x)\n',
    'LICENSE': 'MIT License\nPermission is granted\n',
    'CONTRIBUTING.md': 'Contributions welcome.\n',
    'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\nAdded\n',
    'docs/adr/001.md': '# ADR 001\n',
    'CODE_OF_CONDUCT.md': 'Be kind.\n',
    'src/app.py': 'def value():\n    return 1\n',
  };
  const { repoPath, results, documentation } = await scanAnalysisFixture('t219-doc-rich', files);
  assertDocumentationParity(providerFor(results, 'DIM-documentation-v1'), documentation.findings, repoPath);
  const doc = providerFor(results, 'DIM-documentation-v1');
  const readme = doc.observations.find(({ matchedKey }) => matchedKey === 'readme');
  assert.equal(readme.path, 'README.md');
  assert.equal(readme.details.present, true);
  assert.equal(readme.details.badges, 1);
  const license = doc.observations.find(({ matchedKey }) => matchedKey === 'license');
  assert.equal(license.path, 'LICENSE');
  assert.equal(license.details.name, 'MIT');
  const contributing = doc.observations.find(({ matchedKey }) => matchedKey === 'contributing');
  assert.equal(contributing.path, 'CONTRIBUTING.md');
});

// ---------------------------------------------------------------------------
// Practices — development practices across the seven claim categories
// ---------------------------------------------------------------------------

function syntheticPracticesModel(overrides = {}) {
  return {
    entries: [
      {
        category: 'methodology',
        path: 'pyproject.toml',
        matchedKey: 'methodology:property-based',
        status: 'observed',
        count: 3,
        kinds: ['hypothesis', 'mutmut'],
      },
      {
        category: 'enforcement',
        path: '.github/workflows/ci.yml',
        matchedKey: 'enforcement:ci-gate',
        status: 'observed',
        count: 2,
        kinds: ['coverage', 'lint'],
      },
      {
        category: 'quality_gate',
        path: 'quality/gates.conf',
        matchedKey: 'quality-gate:thresholds',
        status: 'observed',
        count: 4,
        kinds: ['coverage', 'complexity'],
        paths: ['test/baselines/coverage.json'],
      },
    ],
    ...overrides,
  };
}

function assertPracticesParity(practices) {
  assert.equal(practices.providerId, ANALYSIS_PROVIDER_IDS.practices);
  assert.equal(practices.dimensionId, 'DIM-practices-v1');
  const byKey = keyed(practices.observations);
  const methodology = byKey.get('methodology:property-based');
  assert.equal(methodology.category, 'methodology');
  assert.equal(methodology.path, 'pyproject.toml');
  assert.equal(methodology.sourceKind, 'source');
  assert.deepEqual(methodology.details, {
    status: 'observed',
    count: 3,
    kinds: ['hypothesis', 'mutmut'],
  });
  const enforcement = byKey.get('enforcement:ci-gate');
  assert.equal(enforcement.sourceKind, 'workflow');
  assert.deepEqual(enforcement.details, {
    status: 'observed',
    count: 2,
    kinds: ['coverage', 'lint'],
  });
  const gate = byKey.get('quality-gate:thresholds');
  assert.equal(gate.sourceKind, 'config');
  assert.deepEqual(gate.details, {
    status: 'observed',
    count: 4,
    kinds: ['complexity', 'coverage'],
    paths: ['test/baselines/coverage.json'],
  });
}

test('T219 parity: practices adapter preserves the inferred status in observation details', () => {
  const [{ observations }] = practicesObservations(syntheticPracticesModel({
    entries: [{
      category: 'automation',
      path: 'renovate.json',
      matchedKey: 'automation:dependency-updates',
      status: 'inferred',
    }],
  }));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].details.status, 'inferred');
});

test('T219 parity: practices adapter maps synthetic model entries to category-safe observations', () => {
  const [{ dimensionId, observations }] = practicesObservations(syntheticPracticesModel());
  assert.equal(dimensionId, 'DIM-practices-v1');
  assert.deepEqual(
    observations.map(({ category }) => category).toSorted(),
    ['enforcement', 'methodology', 'quality_gate'],
  );
  assertPracticesParity({ providerId: PRACTICES_PROVIDER_ID, dimensionId, observations });
});

test('T219 parity: practices model flows through the combined catalog with a stable provider id', () => {
  const { results, capped } = analysisProviderResults({
    practices: syntheticPracticesModel(),
  });
  assert.equal(capped, false);
  assert.equal(results.length, 1);
  assertPracticesParity(providerFor(results, 'DIM-practices-v1'));
  assert.equal(results[0].providerId, PRACTICES_PROVIDER_ID);
});

test('T219 practices: source kinds fit each of the seven categories', () => {
  const cases = [
    ['methodology', 'source'],
    ['enforcement', 'workflow'],
    ['automation', 'config'],
    ['ritual', 'documentation'],
    ['quality_gate', 'config'],
    ['agent_workflow', 'documentation'],
    ['style_guide', 'config'],
  ];
  for (const [category, sourceKind] of cases) {
    const [{ observations }] = practicesObservations({
      entries: [{
        category,
        path: null,
        matchedKey: `probe:${category}`,
        status: 'observed',
        count: 1,
        kinds: [],
      }],
    });
    assert.equal(observations[0].sourceKind, sourceKind, category);
    assert.equal(observations[0].category, category, category);
  }
});

test('T219 practices: bounded matched keys stay within the foundation bound', () => {
  const longKey = `quality-gate:${'t'.repeat(200)}`;
  const [{ observations }] = practicesObservations({
    entries: [{
      category: 'quality_gate',
      path: 'quality/gates.conf',
      matchedKey: longKey,
      status: 'observed',
      count: 1,
      kinds: [],
    }],
  });
  assert.ok(observations[0].matchedKey.length <= 128, 'matched key is bounded');
  assert.match(observations[0].matchedKey, /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/, 'matched key token pattern');
});

// ---------------------------------------------------------------------------
// Determinism and unique IDs
// ---------------------------------------------------------------------------

test('T219 deterministic: repeated catalog results are byte-identical and canonically ordered', async () => {
  for (const [name, files] of FIVE_ECOSYSTEM_FIXTURES) {
    const first = await scanAnalysisFixture(name, files);
    const second = await scanAnalysisFixture(name, files);
    assert.equal(JSON.stringify(first.results), JSON.stringify(second.results), `${name} byte-identical`);
    for (const result of first.results) assertCanonicalOrder(result.observations);
  }
});

test('T219 deterministic: insertion-order changes never alter observations or results', () => {
  const modules = ['z.js', 'a.js', 'm.js'];
  const graph = { 'z.js': ['a.js'], 'a.js': [], 'm.js': ['z.js', 'a.js'] };
  const facts = {
    bounds: { filesInspected: 3, fileLimit: 5, filesOmitted: 0, edgesInspected: 3, edgeLimit: 5, edgesOmitted: 0, capped: false },
    universe: { ecosystems: ['javascript'], moduleFiles: 3, sourceFiles: 3, testFilesExcluded: 0, declarationFilesExcluded: 0, indicatorsDetected: 0, indicatorsOmitted: 0 },
    edgeKindCounts: { import: 3 },
    fanIn: { 'z.js': 1, 'a.js': 2, 'm.js': 0 },
    fanOut: { 'z.js': 1, 'a.js': 0, 'm.js': 2 },
    selfLoops: [],
    stronglyConnectedComponents: { totalComponents: 3, singletonComponents: 3, cyclicComponents: [] },
    dynamicIndicators: [],
  };
  const reversed = {
    modules: [...modules].toReversed(),
    layers: { entryPoints: ['m.js'] },
    importGraph: { graph: { 'm.js': ['a.js', 'z.js'], 'a.js': [], 'z.js': ['a.js'] } },
  };
  const left = architectureObservations({ findings: { modules, layers: { entryPoints: ['m.js'] }, importGraph: { graph } }, facts });
  const right = architectureObservations({ findings: reversed, facts });
  assert.equal(JSON.stringify(left), JSON.stringify(right));
});

test('T219 unique IDs: provider identifiers and catalog version are stable and distinct', () => {
  assert.equal(ANALYSIS_CATALOG_VERSION, 1);
  const ids = Object.values(ANALYSIS_PROVIDER_IDS);
  assert.equal(new Set(ids).size, ids.length, 'provider ids are unique');
  for (const id of ids) assert.match(id, /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/);
  assert.match(ANALYSIS_PLUGIN_PROVIDER_ID, /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/);
  assert.equal(new Set([...ids, ANALYSIS_PLUGIN_PROVIDER_ID]).size, ids.length + 1);
  assert.equal(ANALYSIS_DIMENSION_IDS.length, 4);
  assert.deepEqual(ANALYSIS_DIMENSION_IDS, [
    'DIM-architecture-v1', 'DIM-conventions-v1', 'DIM-documentation-v1', 'DIM-practices-v1',
  ]);
  assert.equal(ANALYSIS_PROVIDER_IDS.practices, PRACTICES_PROVIDER_ID);
  assert.equal(ANALYSIS_DIMENSION_IDS[3], PRACTICES_DIMENSION_ID);
});

test('T219 unique IDs: repeated catalog results carry unique, stable provider/dimension pairs', async () => {
  const { results } = await scanAnalysisFixture('python', pythonFiles);
  const identities = results.map(({ providerId, dimensionId }) => `${providerId}\0${dimensionId}`);
  assert.equal(new Set(identities).size, identities.length, 'result identities are unique');
  const { results: again } = await scanAnalysisFixture('python', pythonFiles);
  assert.deepEqual(results.map(({ providerId, dimensionId }) => providerId + dimensionId),
    again.map(({ providerId, dimensionId }) => providerId + dimensionId));
});

// ---------------------------------------------------------------------------
// Plugin observations and merge constraints
// ---------------------------------------------------------------------------

function builtinResult(providerId, dimensionId, observations) {
  return createProviderResult({ providerId, dimensionId, observations });
}

function pluginMatch(overrides) {
  return {
    ruleId: 'RUL-test-v1',
    label: 'Test analysis rule',
    dimensionId: 'DIM-architecture-v1',
    category: 'import_edge',
    path: 'src/plugin.js',
    ...overrides,
  };
}

test('T219 plugin: matches convert to bounded artifact observations on the analysis dimensions only', () => {
  const matches = [
    pluginMatch({ ruleId: 'RUL-arch-v1', path: 'src/a.js' }),
    pluginMatch({ ruleId: 'RUL-doc-v1', dimensionId: 'DIM-documentation-v1', category: 'reference', path: 'docs/guide.md' }),
    pluginMatch({ ruleId: 'RUL-ignored-v1', dimensionId: 'DIM-stack-v1', category: 'runtime', path: 'x.js' }),
    { ruleId: 'RUL-bad-v1', label: 'Broken', dimensionId: 'DIM-architecture-v1', category: 'graph', path: 'y.js' },
    null,
  ];
  const groups = analysisPluginObservations(matches);
  assert.deepEqual(groups.map(({ dimensionId }) => dimensionId), ['DIM-architecture-v1', 'DIM-documentation-v1']);
  const architecture = groups[0].observations[0];
  assert.deepEqual(architecture, {
    category: 'import_edge',
    path: 'src/a.js',
    matchedKey: 'plugin:RUL-arch-v1',
    details: { ruleId: 'RUL-arch-v1', label: 'Test analysis rule' },
    sourceKind: 'artifact_metadata',
  });
  const results = analysisPluginProviderResults({ matches });
  assert.ok(results.every(({ providerId }) => providerId === ANALYSIS_PLUGIN_PROVIDER_ID));
  assert.deepEqual(results.map(({ dimensionId }) => dimensionId), ['DIM-architecture-v1', 'DIM-documentation-v1']);
  assert.deepEqual(analysisPluginProviderResults(null), []);
  assert.deepEqual(analysisPluginProviderResults({ matches: [] }), []);
});

test('T219 plugin: observations are appended after built-in and never replace or rewrite findings', () => {
  const builtin = builtinResult(ANALYSIS_PROVIDER_IDS.architecture, 'DIM-architecture-v1', [
    { category: 'module', path: 'src/a.js', matchedKey: 'module:src/a.js', details: { fanIn: 1, fanOut: 0, selfLoop: false }, sourceKind: 'source' },
    { category: 'import_edge', path: 'src/a.js', matchedKey: 'import-edge:src/a.js:src/b.js', details: { target: 'src/b.js' }, sourceKind: 'source' },
  ]);
  const plugin = analysisPluginProviderResults({ matches: [
    pluginMatch({ category: 'dynamic_indicator', path: 'src/a.js' }),
  ] })[0];
  // a plugin observation that is an exact duplicate of the built-in edge -> dropped
  const pluginDup = builtinResult(ANALYSIS_PLUGIN_PROVIDER_ID, 'DIM-architecture-v1', [
    { category: 'import_edge', path: 'src/a.js', matchedKey: 'import-edge:src/a.js:src/b.js', details: { target: 'src/b.js' }, sourceKind: 'source' },
  ]);
  const merged = mergeAnalysisResults({ builtin: [builtin], plugin: [plugin, pluginDup] });
  assert.equal(merged.length, 1);
  const result = merged[0];
  assert.equal(result.providerId, ANALYSIS_PROVIDER_IDS.architecture, 'provider identity is the built-in');
  assert.equal(result.observations.length, 3, 'built-in module + built-in edge + plugin dynamic indicator');
  assert.deepEqual(result.observations.slice(0, 2).map(({ category }) => category), ['import_edge', 'module']);
  assert.equal(result.observations[2].category, 'dynamic_indicator');
  assert.deepEqual(result.observations[0].details, { target: 'src/b.js' }, 'built-in edge is untouched');
  assert.equal(result.observations[0].sourceKind, 'source');
});

test('T219 plugin: same-key different-detail plugin observations append and never rewrite', () => {
  const builtin = builtinResult(ANALYSIS_PROVIDER_IDS.documentation, 'DIM-documentation-v1', [
    { category: 'readme', path: null, matchedKey: 'readme', details: { present: true }, sourceKind: 'documentation' },
  ]);
  const plugin = builtinResult(ANALYSIS_PLUGIN_PROVIDER_ID, 'DIM-documentation-v1', [
    { category: 'readme', path: null, matchedKey: 'readme', details: { present: true, plugin: true }, sourceKind: 'artifact_metadata' },
  ]);
  const merged = mergeAnalysisResults({ builtin: [builtin], plugin: [plugin] });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].observations.length, 2);
  assert.deepEqual(merged[0].observations[0].details, { present: true });
  assert.deepEqual(merged[0].observations[1].details, { present: true, plugin: true });
});

test('T219 plugin: standalone plugin results appear when a dimension has no built-in result', () => {
  const plugin = analysisPluginProviderResults({
    matches: [pluginMatch({ ruleId: 'RUL-arch-v1', dimensionId: 'DIM-architecture-v1', category: 'graph', path: 'src/a.js' })],
  });
  const merged = mergeAnalysisResults({ builtin: [], plugin });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].providerId, ANALYSIS_PLUGIN_PROVIDER_ID);
  assert.equal(merged[0].dimensionId, 'DIM-architecture-v1');
});

test('T219 plugin: dimension mismatch and duplicate/unknown categories fail with typed errors', () => {
  const architecture = analysisPluginProviderResults({ matches: [pluginMatch()] })[0];
  const conventions = builtinResult(ANALYSIS_PROVIDER_IDS.conventions, 'DIM-conventions-v1', []);
  assert.throws(
    () => mergeProviderResults({ builtin: conventions, plugin: architecture }),
    (error) => error && error.code === 'DIMENSION_MISMATCH',
  );

  const duplicates = [
    { category: 'module', path: 'src/a.js', matchedKey: 'module:src/a.js', details: {}, sourceKind: 'source' },
    { category: 'module', path: 'src/a.js', matchedKey: 'module:src/a.js', details: {}, sourceKind: 'source' },
  ];
  assert.throws(
    () => builtinResult(ANALYSIS_PROVIDER_IDS.architecture, 'DIM-architecture-v1', duplicates),
    (error) => error && error.code === 'DUPLICATE_OBSERVATION',
  );

  assert.throws(
    () => analysisPluginProviderResults({ matches: [pluginMatch({ category: 'route' })] }),
    (error) => error && error.code === 'UNKNOWN_CATEGORY',
  );
  // matches on non-analysis dimensions are ignored, never fabricated into a result
  assert.deepEqual(
    analysisPluginProviderResults({ matches: [pluginMatch({ dimensionId: 'DIM-api-v1', category: 'route' })] }),
    [],
  );
  assert.deepEqual(
    analysisPluginProviderResults({ matches: [{ ruleId: 'RUL-x-v1', label: 'X', dimensionId: 'DIM-architecture-v1', category: 'graph', path: '' }] }),
    [],
  );
});

// ---------------------------------------------------------------------------
// Generic fallback and caps
// ---------------------------------------------------------------------------

test('T219 generic: unknown-language repositories receive documentation artifacts only', () => {
  const generic = genericProviderResults({
    languages: ['Zeta'],
    ecosystems: [],
    files: ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'src/main.zzz'],
  });
  const { results, capped } = analysisProviderResults({ generic });
  assert.equal(capped, false);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, GENERIC_PROVIDER_ID);
  assert.equal(results[0].dimensionId, 'DIM-documentation-v1');
  const categories = results[0].observations.map((entry) => entry.category);
  assert.deepEqual(categories.toSorted(), ['contributing', 'license', 'readme']);
  const serialized = JSON.stringify(results);
  for (const forbidden of ['module', 'import_edge', 'entry_point', 'dynamic_indicator', 'graph', 'import-style']) {
    assert.equal(serialized.includes(`"category":"${forbidden}"`), false, `generic claimed ${forbidden}`);
  }
  assert.ok(!providerFor(results, 'DIM-architecture-v1'));
  assert.ok(!providerFor(results, 'DIM-conventions-v1'));
});

test('T219 generic: does not fire for the five built-in ecosystems and empty envelopes', () => {
  const { results } = analysisProviderResults({
    generic: genericProviderResults({ languages: ['Python'], ecosystems: [], files: ['src/a.py'] }),
  });
  assert.deepEqual(results, []);
  assert.deepEqual(analysisProviderResults({ generic: { results: [], capped: false } }),
    { results: [], capped: false });
  assert.deepEqual(analysisProviderResults({}), { results: [], capped: false });
  assert.deepEqual(analysisProviderResults(null), { results: [], capped: false });
});

test('T219 cap: observation lists are bounded and truncation is disclosed', () => {
  const count = PROVIDER_RESULT_LIMITS.observations + 300;
  const modules = [];
  const graph = {};
  const fanIn = {};
  const fanOut = {};
  for (let index = 0; index < count; index++) {
    const file = `src/file-${String(index).padStart(5, '0')}.js`;
    modules.push(file);
    graph[file] = [];
    fanIn[file] = 0;
    fanOut[file] = 0;
    if (index > 0) {
      graph[`src/file-${String(index - 1).padStart(5, '0')}.js`].push(file);
      fanIn[file] = 1;
      fanOut[`src/file-${String(index - 1).padStart(5, '0')}.js`] = 1;
    }
  }
  const facts = {
    bounds: { filesInspected: count, fileLimit: 50_000, filesOmitted: 0, edgesInspected: count - 1, edgeLimit: 500_000, edgesOmitted: 0, capped: false },
    universe: { ecosystems: ['javascript'], moduleFiles: count, sourceFiles: count, testFilesExcluded: 0, declarationFilesExcluded: 0, indicatorsDetected: 0, indicatorsOmitted: 0 },
    edgeKindCounts: { import: count - 1 },
    fanIn,
    fanOut,
    selfLoops: [],
    stronglyConnectedComponents: { totalComponents: count, singletonComponents: count, cyclicComponents: [] },
    dynamicIndicators: [],
  };
  const { results, capped } = analysisProviderResults({
    architecture: { findings: { modules, layers: { entryPoints: [] }, importGraph: { graph } }, facts },
  });
  assert.equal(capped, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].observations.length, PROVIDER_RESULT_LIMITS.observations);
  for (const matchedKey of ['graph:bounds', 'graph:universe', 'graph:edge-kinds', 'graph:scc', 'graph:fan']) {
    assert.ok(results[0].observations.some(({ matchedKey: key }) => key === matchedKey), `${matchedKey} survives`);
  }
  assertCanonicalOrder(results[0].observations);
});

test('T219 matchedKey bound: long-path import edges and dynamic indicators assemble without aborting', () => {
  const longA = `src/${'a'.repeat(120)}.js`;
  const longB = `src/${'b'.repeat(120)}.js`;
  const kind = `fetch-${'k'.repeat(150)}`;
  const findings = {
    modules: [longA, longB],
    layers: { entryPoints: [] },
    importGraph: { graph: { [longA]: [longB] } },
  };
  const facts = {
    bounds: { filesInspected: 2, fileLimit: 5, filesOmitted: 0, edgesInspected: 1, edgeLimit: 5, edgesOmitted: 0, capped: false },
    universe: { ecosystems: ['javascript'], moduleFiles: 2, sourceFiles: 2, testFilesExcluded: 0, declarationFilesExcluded: 0, indicatorsDetected: 0, indicatorsOmitted: 0 },
    edgeKindCounts: { import: 1 },
    fanIn: { [longA]: 0, [longB]: 1 },
    fanOut: { [longA]: 1, [longB]: 0 },
    selfLoops: [],
    stronglyConnectedComponents: { totalComponents: 2, singletonComponents: 2, cyclicComponents: [] },
    dynamicIndicators: [{ kind, file: longA, line: 12345 }],
  };
  const { results } = analysisProviderResults({ architecture: { findings, facts } });
  assert.equal(results.length, 1);
  const architecture = results[0];
  assert.equal(architecture.providerId, ANALYSIS_PROVIDER_IDS.architecture);

  const edge = architecture.observations.find(({ category }) => category === 'import_edge');
  assert.ok(edge, 'long import edge survives assembly');
  const edgeRaw = `import-edge:${longA.slice(0, 96)}:${longB.slice(0, 96)}`;
  assert.equal(edge.matchedKey, edgeRaw.slice(0, 128), 'import-edge matchedKey is final-truncated at the 128 bound');
  assert.ok(edge.matchedKey.length <= 128, 'import-edge matchedKey is bounded');
  assert.match(edge.matchedKey, /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/, 'import-edge matchedKey stays within the foundation pattern');
  assert.equal(edge.path, longA, 'import-edge path keeps the full source');
  assert.equal(edge.details.target, longB, 'import-edge details keep the full target (truncation disclosure)');

  const indicator = architecture.observations.find(({ category }) => category === 'dynamic_indicator');
  assert.ok(indicator, 'long dynamic indicator survives assembly');
  const indicatorRaw = `dynamic-indicator:${kind}:${longA.slice(0, 96)}:12345`;
  assert.equal(indicator.matchedKey, indicatorRaw.slice(0, 128), 'dynamic-indicator matchedKey is final-truncated at the 128 bound');
  assert.ok(indicator.matchedKey.length <= 128, 'dynamic-indicator matchedKey is bounded');
  assert.match(indicator.matchedKey, /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/, 'dynamic-indicator matchedKey stays within the foundation pattern');
  assert.equal(indicator.path, longA, 'dynamic-indicator path keeps the full file');
  assert.equal(indicator.details.kind, kind, 'dynamic-indicator details keep the full kind (truncation disclosure)');
  assert.equal(indicator.details.line, 12345, 'dynamic-indicator details keep the line (truncation disclosure)');

  const again = analysisProviderResults({ architecture: { findings, facts } });
  assert.equal(JSON.stringify(results), JSON.stringify(again.results), 'long-path assembly is deterministic');
  assertCanonicalOrder(architecture.observations);
});

// ---------------------------------------------------------------------------
// Immutability and empty input
// ---------------------------------------------------------------------------

test('T219 immutability: catalog results, observations, and details are deep-frozen', async () => {
  const { results } = await scanAnalysisFixture('rust', rustFiles);
  for (const result of results) {
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.observations), true);
    for (const entry of result.observations) {
      assert.equal(Object.isFrozen(entry), true);
      assert.equal(Object.isFrozen(entry.details), true);
    }
    assert.throws(() => { result.observations.pop(); }, TypeError);
    assert.throws(() => { result.observations[0].matchedKey = 'x'; }, TypeError);
    assert.throws(() => { result.observations[0].details.fanIn = 99; }, TypeError);
  }
  const plugin = analysisPluginProviderResults({ matches: [pluginMatch()] });
  assert.equal(Object.isFrozen(plugin), true);
  assert.throws(() => plugin.pop(), TypeError);
  const merged = mergeAnalysisResults({ builtin: [builtinResult(ANALYSIS_PROVIDER_IDS.architecture, 'DIM-architecture-v1', [])], plugin });
  assert.equal(Object.isFrozen(merged), true);
});

test('T219 empty input: foreign and null models produce empty results without throwing', () => {
  assert.deepEqual(architectureProviderResults(null), { results: [], capped: false });
  assert.deepEqual(architectureProviderResults({}), { results: [], capped: false });
  assert.deepEqual(architectureProviderResults({ findings: null, facts: null }), { results: [], capped: false });
  assert.deepEqual(conventionsProviderResults(null), { results: [], capped: false });
  assert.deepEqual(conventionsProviderResults({}), { results: [], capped: false });
  assert.deepEqual(documentationProviderResults(null), { results: [], capped: false });
  assert.deepEqual(documentationProviderResults({}), { results: [], capped: false });
  assert.deepEqual(practicesProviderResult(null), []);
  assert.deepEqual(practicesProviderResult({}), []);
  assert.deepEqual(architectureObservations(null), []);
  assert.deepEqual(conventionsObservations(null), []);
  assert.deepEqual(documentationObservations({ repoPath: null, findings: null }), []);
  assert.deepEqual(practicesObservations(null), []);
  assert.deepEqual(mergeAnalysisResults(null), []);
  assert.deepEqual(mergeAnalysisResults({}), []);
});

// ---------------------------------------------------------------------------
// Inertness
// ---------------------------------------------------------------------------

async function libScanFiles() {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(join(LIB_ROOT, 'lib'));
  await visit(join(LIB_ROOT, 'scripts'));
  return files.toSorted();
}

test('T219 inert: the catalog is unregistered and unimported outside the provider directory', async () => {
  const files = await libScanFiles();
  const activatedConsumer = join(LIB_ROOT, 'lib', 'scan', 'pipeline', 'run.mjs');
  const consumers = [];
  for (const file of files) {
    if (file.includes(`${sep}providers${sep}`)) continue;
    if (file === activatedConsumer) continue;
    const source = await readFile(file, 'utf8');
    if (source.includes('analysis-catalog')) {
      consumers.push(file.replace(/\\/g, '/').split('/csm-scan/')[1]);
    }
  }
  assert.deepEqual(consumers, [], 'only the activated pipeline may import the catalog');
});

test('T219 inert: the catalog module is a pure data adapter with no execution surface', async () => {
  const source = await readFile(join(LIB_ROOT, 'lib', 'scan', 'providers', 'analysis-catalog.mjs'), 'utf8');
  for (const forbidden of ['node:fs', 'node:child_process', 'node:process', 'node:vm', 'node:module']) {
    assert.equal(
      new RegExp(`import\\s+.*['"]${forbidden}['"]`).test(source),
      false,
      `catalog must not import ${forbidden}`,
    );
  }
  for (const token of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
    assert.equal(source.includes(token), false, `catalog must not expose ${token}`);
  }
  for (const name of [
    'architectureObservations', 'architectureProviderResults',
    'conventionsObservations', 'conventionsProviderResults',
    'documentationObservations', 'documentationProviderResults',
    'practicesProviderResults',
    'analysisProviderResults', 'analysisPluginObservations',
    'analysisPluginProviderResults', 'mergeAnalysisResults',
  ]) {
    assert.ok(new RegExp(`export\\s+(?:function|const)\\s+${name}\\b`).test(source), `catalog exports ${name}`);
  }
  assert.equal((source.match(/export\s+async\s+function/g) || []).length, 0, 'catalog exports no async functions');
});
