// T005 Development Practices dimension — focused test suite.
//
// Covers the deterministic privacy-safe practices model (schema validation,
// determinism, deep-freeze), the pure path/content classifiers, the
// `PRACTICE_TOOLS` detection table, the T210 provider integration, and the
// end-to-end scanner against a positive fixture spanning all seven categories
// plus negative and privacy-canary cases. Hidden-directory artifacts (`.github`,
// `.agents`, `.opencode`, `.claude`, `.devcontainer`, `.quality-gates*`,
// root `AGENTS.md`/`CLAUDE.md`/`opencode.jsonc`) are probed explicitly because
// `rg` prunes dot entries.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scan } from '../lib/scan/deep/practices/scanner.mjs';
import {
  PRACTICES_CATEGORIES,
  PRACTICES_DIMENSION_ID,
  PRACTICES_HIDDEN_DIRS,
  PRACTICES_HIDDEN_FILES,
  PRACTICES_LIMITS,
  PRACTICES_STATUSES,
  PracticesModelError,
  buildPracticesModel,
  classifyPracticePath,
  encodeMatchedKey,
} from '../lib/scan/deep/practices/model.mjs';
import {
  extractDeclaredConventions,
  extractExceptionsHub,
  extractGateValues,
  extractLefthookStages,
  extractMakeTargets,
  extractOpencodeWorkflow,
  extractRuffRules,
  slugToken,
} from '../lib/scan/deep/practices/style.mjs';
import {
  aggregateMethodology,
  extractAnalyserContracts,
  extractFuzzReplay,
  extractMutationPolicy,
  extractPluginContent,
  extractPolicyValidators,
  extractRatchet,
  extractSuppressionBaseline,
  extractSuppressionPolicy,
} from '../lib/scan/deep/practices/content.mjs';
import { PRACTICE_TOOLS } from '../lib/scan/shared/detection.mjs';
import { renderPractices } from '../lib/scan/render/practices.mjs';
import {
  PRACTICES_PROVIDER_ID,
  practicesObservations,
  practicesProviderResult,
} from '../lib/scan/providers/practices.mjs';
import { createCommandBroker } from '../lib/scan/shared/command.mjs';
import { createRecordingRunner } from './helpers/recording-runner.mjs';
import { withFixture } from './harness.mjs';

const SEARCH_OK = Object.freeze({
  supported: true,
  readable: true,
  complete: true,
  capped: false,
  error: false,
  malformed: false,
  ambiguous: false,
  filesInspected: 3,
  fileLimit: 100,
  bytesInspected: 300,
  byteLimit: 10_000,
  recordsInspected: 5,
  recordLimit: 1_000,
  omittedCount: 0,
});

const PRACTICE_TOOL_KEYS = [
  'mutmut', 'hypothesis', 'atheris', 'diff-cover', 'import-linter', 'deptry',
  'vulture', 'actionlint', 'commitlint', 'gitlint', 'semantic-release',
  'release-please', 'renovate', 'sphinx', 'mkdocs', 'docusaurus',
  'pre-commit', 'lefthook', 'bandit', 'radon', 'eslint-config-airbnb',
  'black', 'prettier',
];

function inertGitBroker() {
  return createCommandBroker({
    runner: createRecordingRunner(() => ({ status: 128, stdout: '', stderr: '' })),
  });
}

function modelOf(entries, extra = {}) {
  return buildPracticesModel({ entries, searchSpace: SEARCH_OK, ...extra });
}

function entry(path, overrides = {}) {
  return {
    category: 'methodology',
    matchedKey: `methodology:probe:${path}`,
    path,
    status: 'observed',
    ...overrides,
  };
}

const POSITIVE_FILES = {
  // methodology
  'features/login.feature': 'Feature: Login\nScenario: a user can log in\n',
  'strategies.py': [
    'from hypothesis import given',
    '@given()',
    'def test_a_strategy():',
    '    return True',
  ].join('\n'),
  'fuzz_corpus/seed.txt': 'seed bytes\n',
  'pyproject.toml': [
    '[project.dependencies]',
    'hypothesis = ">=6.0"',
    'mutmut = ">=2.0"',
    '',
    '[tool.mutmut]',
    'paths = ["src"]',
    '',
    '[tool.ruff]',
    'line-length = 88',
    'quote-style = "double"',
    '',
    '[tool.black]',
    'line-length = 100',
  ].join('\n'),
  // enforcement
  'commitlint.config.js': 'module.exports = { extends: ["@commitlint/config-conventional"] };\n',
  '.gitlint': '[general]\nignore=title-trailing-punctuation\n',
  'lefthook.yml': [
    'pre-commit:',
    '  commands:',
    '    lint:',
    '      run: pnpm lint',
    '    format:',
    '      run: pnpm format',
  ].join('\n'),
  '.github/workflows/ci.yml': [
    'name: CI',
    'jobs:',
    '  lint:',
    '    steps:',
    '      - uses: wagoid/commitlint-github-action@v5',
    '  mutation:',
    '    steps:',
    '      - run: mutmut run',
    '  publish:',
    '    steps:',
    '      - run: npm publish',
  ].join('\n'),
  // automation
  '.github/release-drafter.yml': 'template: release-drafter.yml\n',
  'dependabot.yml': 'version: 2\nupdates: []\n',
  'renovate.json': '{"extends": ["config:base"]}\n',
  'mkdocs.yml': 'site_name: Demo\n',
  'docusaurus.config.js': 'module.exports = { title: "Demo" };\n',
  '.devcontainer/devcontainer.json': '{"image": "node:20"}\n',
  // ritual
  'CHANGELOG.md': '## [Unreleased]\n## [1.0.0] - 2024-01-15\n',
  '.github/PULL_REQUEST_TEMPLATE.md': '# PR\n## Summary\n## Checklist\n## Definition of Done\n',
  '.github/ISSUE_TEMPLATE/bug.md': '## Expected Behavior\n## Actual Behavior\n',
  // quality gate
  'quality/gates.conf': 'MIN_COVERAGE=85\nMAX_COMPLEXITY=10\nMAX_LINES=500\n',
  'test/baselines/coverage.json': '{"coverage": 85}\n',
  'ratchet.sh': '#!/bin/sh\nratchet check\n',
  // agent workflow
  'AGENTS.md': '# Agents\nCommands and conventions.\n',
  'CLAUDE.md': '# Claude\n',
  'opencode.jsonc': '{"model": "claude"}\n',
  '.opencode/config.json': '{"skills": []}\n',
  '.agents/plans/feature-csm.md': '# Plan\n## Control\n## Status\n',
  '.agents/docs/guide.md': '# Guide\n',
  'quality/remediation/notes.md': '# Remediation\n',
  // style guide
  'ruff.toml': 'line-length = 100\n',
  '.prettierrc': '{"printWidth": 100, "singleQuote": true}\n',
  'rustfmt.toml': 'max_width = 100\n',
  'docs/principles.md': '# Principles\n\nThe Zen of Python and PEP 20 guide us.\n',
  'package.json': '{"devDependencies": {"eslint-config-airbnb": "^19.0.0"}}\n',
  // filler
  'src/app.js': 'console.log("hi");\n',
};

// ---------------------------------------------------------------------------
// model.mjs — constants, schema, errors
// ---------------------------------------------------------------------------

test('T005 model: categories, statuses, and constants are exact and frozen', () => {
  assert.deepEqual(PRACTICES_CATEGORIES, [
    'methodology', 'enforcement', 'automation', 'ritual', 'quality_gate',
    'agent_workflow', 'style_guide',
  ]);
  assert.deepEqual(PRACTICES_STATUSES, ['observed', 'inferred', 'unverified']);
  assert.equal(PRACTICES_DIMENSION_ID, 'DIM-practices-v1');
  assert.equal(Object.isFrozen(PRACTICES_LIMITS), true);
  assert.equal(Object.isFrozen(PRACTICES_CATEGORIES), true);
  assert.ok(PRACTICES_HIDDEN_FILES.includes('AGENTS.md'));
  assert.ok(PRACTICES_HIDDEN_FILES.includes('CLAUDE.md'));
  assert.ok(PRACTICES_HIDDEN_FILES.includes('opencode.jsonc'));
  assert.ok(PRACTICES_HIDDEN_DIRS.includes('.github'));
  assert.ok(PRACTICES_HIDDEN_DIRS.includes('.agents'));
  assert.ok(PRACTICES_HIDDEN_DIRS.includes('.opencode'));
  assert.ok(PRACTICES_HIDDEN_DIRS.includes('.quality-gates') === false);
});

test('T005 model: invalid entries, statuses, categories, and paths throw typed errors', () => {
  assert.throws(() => modelOf([{ ...entry('a.md'), category: 'language' }]),
    (error) => error instanceof PracticesModelError && error.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => modelOf([{ ...entry('a.md'), status: 'observed-evil' }]),
    PracticesModelError);
  assert.throws(() => modelOf([{ ...entry('/etc/passwd') }]),
    PracticesModelError);
  assert.throws(() => modelOf([{ ...entry('../escape') }]),
    PracticesModelError);
  assert.throws(() => modelOf([{ ...entry('a.md'), matchedKey: 'bad key!' }]),
    PracticesModelError);
  assert.throws(() => modelOf([{ ...entry('a.md'), count: -1 }]),
    PracticesModelError);
  assert.throws(() => modelOf([{ ...entry('a.md'), kinds: ['ok', 3] }]),
    PracticesModelError);
  assert.throws(() => modelOf([entry('a.md')], { isGit: 'yes' }),
    PracticesModelError);
});

test('T005 model: deterministic deep-frozen output with exact summary', () => {
  const first = modelOf([
    entry('a.md', { count: 2, kinds: ['behave', 'hypothesis'] }),
    entry('b.feature'),
  ]);
  const second = modelOf([
    entry('b.feature'),
    entry('a.md', { count: 2, kinds: ['hypothesis', 'behave'] }),
  ]);
  assert.equal(JSON.stringify(first), JSON.stringify(second),
    'kinds are canonically sorted and entries are deduplicated deterministically');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.entries), true);
  assert.equal(Object.isFrozen(first.entries[0]), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.entries.push({}), TypeError);
  assert.equal(first.summary.entries, 2);
  assert.equal(first.summary.byCategory.methodology, 2);
  assert.equal(first.summary.byCategory.enforcement, 0);
  assert.deepEqual(first.entries.find((item) => item.path === 'a.md').kinds, ['behave', 'hypothesis']);
});

test('T005 model: privacy violations downgrade to unverified PRIVACY diagnostics', () => {
  const model = modelOf([
    entry('a.md'),
    { ...entry('b.md'), matchedKey: 'methodology:probe:b.md:token=sk-supersecret123' },
  ]);
  assert.deepEqual(model.entries.map((item) => item.path), ['a.md']);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'PRIVACY'));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes('sk-supersecret123'), false);
});

test('T005 model: caps truncate deterministically and are disclosed', () => {
  const flood = Array.from({ length: PRACTICES_LIMITS.maxEntries + 10 }, (_, index) => (
    entry(`p/${index}.md`)
  ));
  const model = modelOf(flood);
  assert.equal(model.summary.capped.entries, true);
  assert.equal(model.entries.length, PRACTICES_LIMITS.maxEntries);
});

test('T002 foundations: maxKinds accepts up to 256 deduplicated kind tokens', () => {
  assert.equal(PRACTICES_LIMITS.maxKinds, 256);
  const manyKinds = Array.from({ length: 256 }, (_, index) => `kind-${String(index).padStart(3, '0')}`);
  const model = modelOf([entry('a.md', { kinds: manyKinds })]);
  assert.equal(model.entries[0].kinds.length, 256);
  assert.throws(() => modelOf([entry('a.md', { kinds: [...manyKinds, 'overflow'] })]),
    (error) => error instanceof PracticesModelError && error.code === 'BOUND_EXCEEDED');
});

test('T005 model: encodeMatchedKey percent-encodes every non-token character', () => {
  assert.equal(encodeMatchedKey('methodology:property-based'), 'methodology:property-based');
  assert.equal(encodeMatchedKey('quality_gate:gate:quality/gates.conf'), 'quality_gate:gate:quality/gates.conf');
  assert.equal(encodeMatchedKey('enforcement:step:*.yml'), 'enforcement:step:%2A.yml');
  assert.equal(encodeMatchedKey('a b/c?'), 'a%20b/c%3F');
  assert.throws(() => encodeMatchedKey(''), PracticesModelError);
});

// ---------------------------------------------------------------------------
// model.mjs — path and content classification
// ---------------------------------------------------------------------------

test('T005 classify: static practice paths across all seven categories', () => {
  assert.deepEqual(classifyPracticePath('features/login.feature'), { category: 'methodology', kind: 'bdd-feature' });
  assert.deepEqual(classifyPracticePath('strategies.py'), { category: 'methodology', kind: 'hypothesis-strategies' });
  assert.deepEqual(classifyPracticePath('fuzz_corpus/seed.txt'), { category: 'methodology', kind: 'fuzz-corpus' });
  assert.deepEqual(classifyPracticePath('commitlint.config.js'), { category: 'enforcement', kind: 'commitlint' });
  assert.deepEqual(classifyPracticePath('.gitlint'), { category: 'enforcement', kind: 'gitlint' });
  assert.deepEqual(classifyPracticePath('.github/release-drafter.yml'), { category: 'automation', kind: 'release-drafter' });
  assert.deepEqual(classifyPracticePath('dependabot.yml'), { category: 'automation', kind: 'dependabot' });
  assert.deepEqual(classifyPracticePath('renovate.json'), { category: 'automation', kind: 'renovate' });
  assert.deepEqual(classifyPracticePath('mkdocs.yml'), { category: 'automation', kind: 'mkdocs' });
  assert.deepEqual(classifyPracticePath('.github/pull_request_template.md'), { category: 'ritual', kind: 'pr-template' });
  assert.deepEqual(classifyPracticePath('quality/gates.conf'), { category: 'quality_gate', kind: 'gates-conf' });
  assert.deepEqual(classifyPracticePath('test/baselines/coverage.json'), { category: 'quality_gate', kind: 'baseline' });
  assert.deepEqual(classifyPracticePath('AGENTS.md'), { category: 'agent_workflow', kind: 'agents' });
  assert.deepEqual(classifyPracticePath('.agents/plans/feature-csm.md'), { category: 'agent_workflow', kind: 'csm-plan' });
  assert.deepEqual(classifyPracticePath('ruff.toml'), { category: 'style_guide', kind: 'ruff' });
  assert.deepEqual(classifyPracticePath('.prettierrc'), { category: 'style_guide', kind: 'prettier' });
  assert.equal(classifyPracticePath('src/app.js'), null);
  assert.equal(classifyPracticePath('README.md'), null);
});

test('T002 foundations: static makefile and contributing paths classify with distinct kinds', () => {
  assert.deepEqual(classifyPracticePath('Makefile'), { category: 'automation', kind: 'makefile' });
  assert.deepEqual(classifyPracticePath('makefile'), { category: 'automation', kind: 'makefile' });
  assert.deepEqual(classifyPracticePath('GNUmakefile'), { category: 'automation', kind: 'makefile' });
  assert.deepEqual(classifyPracticePath('contributing.md'), { category: 'style_guide', kind: 'contributing' });
  assert.deepEqual(classifyPracticePath('CONTRIBUTING.md'), { category: 'style_guide', kind: 'contributing' });
  assert.deepEqual(classifyPracticePath('.github/contributing.md'), { category: 'style_guide', kind: 'contributing' });
  assert.equal(classifyPracticePath('src/contributing.md'), null);
});

test('T002 foundations: static and content kinds coexist on the same path without dedup loss', () => {
  const model = modelOf([
    {
      category: 'automation',
      matchedKey: 'automation:makefile:Makefile',
      path: 'Makefile',
      status: 'observed',
    },
    {
      category: 'automation',
      matchedKey: 'automation:make-targets:Makefile',
      path: 'Makefile',
      status: 'observed',
      count: 3,
      kinds: ['build', 'test'],
    },
  ]);
  assert.equal(model.entries.length, 2, 'static and content kinds must both survive first-wins dedup');
  assert.deepEqual(model.entries.map((item) => item.matchedKey).toSorted(),
    ['automation:make-targets:Makefile', 'automation:makefile:Makefile']);
  const content = model.entries.find((item) => item.matchedKey === 'automation:make-targets:Makefile');
  assert.deepEqual(content.kinds, ['build', 'test']);
});

test('T003 policy: gate values render as bounded per-key counts and slugs, token keys never survive', () => {
  const records = extractGateValues({
    path: 'quality/gates.conf',
    text: [
      'MIN_COVERAGE=85',
      'MAX_COMPLEXITY=10',
      'token=sk-supersecret123',
      'some_unknown_thing=1',
      'MAX_LINES = 500',
    ].join('\n'),
  });
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.kind).toSorted(),
    ['gate-value:maxcomplexity', 'gate-value:maxlines', 'gate-value:mincoverage']);
  const minCoverage = records.find((record) => record.kind === 'gate-value:mincoverage');
  assert.equal(minCoverage.count, 85, 'MIN_COVERAGE=85 renders as a bounded count');
  const maxLines = records.find((record) => record.kind === 'gate-value:maxlines');
  assert.equal(maxLines.count, 500);
  assert.equal(JSON.stringify(records).includes('sk-supersecret123'), false,
    'non-allowlisted token key still never survives');
  assert.equal(JSON.stringify(records).includes('token='), false, 'raw KEY=value strings never survive');
});

test('T003 policy: extended gate vocabulary renders count 85, slug B, and key-presence', () => {
  const records = extractGateValues({
    path: 'quality/gates.conf',
    text: [
      'MIN_COVERAGE=85',
      'MAX_FLAGGED=30',
      'DISTANCE_THRESHOLD=0.3',
      'FAIL_UNDER=85',
      'MIN_CONFIDENCE=80',
      'RADON_CC_GRADE=B',
      'RADON_MI_GRADE=B',
      'FILE_SIZE_CAP=1000',
      'SEMGREP_SEVERITY=--severity ERROR',
      'DIFF_COVERAGE_THRESHOLD=90',
      'token=sk-supersecret123',
    ].join('\n'),
  });
  const byKind = new Map(records.map((record) => [record.kind, record]));
  assert.equal(byKind.get('gate-value:mincoverage').count, 85);
  assert.deepEqual(byKind.get('gate-value:distancethreshold').kinds, ['0.3'],
    'floats render as slug kinds');
  assert.deepEqual(byKind.get('gate-value:radonccgrade').kinds, ['B'],
    'grades render as slug kinds');
  assert.deepEqual(byKind.get('gate-value:radonmigrade').kinds, ['B']);
  assert.equal(byKind.get('gate-value:filesizecap').count, 1000);
  assert.equal(byKind.get('gate-value:diffcoveragethreshold').count, 90);
  assert.deepEqual(byKind.get('gate-value:semgrepseverity').kinds, ['--severity%20ERROR'],
    'SEMGREP_SEVERITY carries its real value through the value channel');
  assert.equal(byKind.get('gate-value:semgrepseverity').count, undefined,
    'the value channel records kinds, never a count');
  assert.equal(JSON.stringify(records).includes('sk-supersecret123'), false,
    'non-allowlisted token key still never survives');
  assert.equal(JSON.stringify(records).includes('KEY='), false, 'raw KEY=value strings never survive');
});

test('T003 style: gate value extractor ignores non-gate files', () => {
  assert.deepEqual(extractGateValues({ path: 'setup.cfg', text: 'MIN_COVERAGE=85\n' }), []);
});

// ---------------------------------------------------------------------------
// detection.mjs — PRACTICE_TOOLS table
// ---------------------------------------------------------------------------

test('T005 detection: PRACTICE_TOOLS has every required tool with label and type', () => {
  for (const key of PRACTICE_TOOL_KEYS) {
    const value = PRACTICE_TOOLS[key];
    assert.ok(value !== undefined, `PRACTICE_TOOLS missing ${key}`);
    assert.ok(typeof value.label === 'string' && value.label.length > 0, key);
    assert.ok(typeof value.type === 'string', `${key} type`);
  }
  assert.equal(PRACTICE_TOOLS.commitlint.type, 'Commit lint');
  assert.equal(PRACTICE_TOOLS.hypothesis.type, 'Property-based testing');
  assert.equal(PRACTICE_TOOLS['eslint-config-airbnb'].type, 'Style guide');
});

// ---------------------------------------------------------------------------
// providers/practices.mjs — T210 integration
// ---------------------------------------------------------------------------

test('T005 provider: model entries flow through the practices adapter', () => {
  const model = modelOf([
    entry('pyproject.toml', { count: 3, kinds: ['hypothesis', 'mutmut'] }),
    {
      category: 'quality_gate',
      matchedKey: 'quality-gate:thresholds',
      path: 'quality/gates.conf',
      status: 'observed',
      count: 1,
      kinds: ['mincoverage'],
    },
  ]);
  const results = practicesProviderResult(model);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, PRACTICES_PROVIDER_ID);
  assert.equal(results[0].dimensionId, 'DIM-practices-v1');
  const categories = [...new Set(results[0].observations.map(({ category }) => category))].toSorted();
  assert.deepEqual(categories, ['methodology', 'quality_gate']);
  for (const observation of results[0].observations) {
    assert.ok(observation.matchedKey.length <= 128, observation.matchedKey);
    assert.ok(Object.isFrozen(observation));
  }
  assert.deepEqual(practicesObservations(null), []);
  assert.deepEqual(practicesProviderResult({}), []);
});

// ---------------------------------------------------------------------------
// scanner.mjs — positive fixture (all seven categories)
// ---------------------------------------------------------------------------

test('T005 scanner: positive fixture spans all seven categories', async () => {
  await withFixture('prac-positive', POSITIVE_FILES, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(dimension, 'practices');
    assert.equal(signal, 'high');
    assert.equal(findings.summary.isGit, false);
    assert.equal(findings.searchSpace.complete, true);
    assert.equal(findings.diagnostics.length, 0);
    for (const category of PRACTICES_CATEGORIES) {
      assert.ok(findings.summary.byCategory[category] > 0, `no entries for ${category}`);
    }
    const paths = findings.entries.map(({ path }) => path);
    assert.ok(paths.includes('.agents/plans/feature-csm.md'), 'hidden .agents/plans artifact probed');
    assert.ok(paths.includes('.devcontainer/devcontainer.json'), 'hidden .devcontainer artifact probed');
    assert.ok(paths.includes('.github/PULL_REQUEST_TEMPLATE.md'), 'hidden .github template probed');
    assert.ok(paths.includes('quality/gates.conf'));
    assert.ok(paths.includes('features/login.feature'));
    assert.ok(paths.includes('AGENTS.md'));
    assert.ok(paths.includes('opencode.jsonc'));

    const minCoverage = findings.entries.find((item) => item.matchedKey === 'quality_gate:gate-value:mincoverage:quality/gates.conf');
    assert.ok(minCoverage, 'quality gates.conf per-key entry present');
    assert.equal(minCoverage.count, 85, 'MIN_COVERAGE=85 renders as a bounded count');
    assert.equal(findings.entries.some((item) => item.matchedKey === 'quality_gate:gate-thresholds:quality/gates.conf'),
      false, 'the aggregated gate-thresholds entry is replaced by per-key entries');

    const mutmutConfig = findings.entries.find((item) => item.matchedKey === 'methodology:mutation-config:pyproject.toml');
    assert.ok(mutmutConfig, '[tool.mutmut] section detected');

    const deps = findings.entries.find((item) => item.matchedKey === 'methodology:test-deps:pyproject.toml');
    assert.ok(deps && deps.kinds.includes('hypothesis'), 'hypothesis dependency detected');

    const styles = findings.entries.find((item) => item.matchedKey === 'style_guide:style-values:pyproject.toml');
    assert.ok(styles && styles.kinds.includes('line-length'), 'ruff line-length value detected');

    const prettierValues = findings.entries.find((item) => item.matchedKey === 'style_guide:style-values:.prettierrc');
    assert.ok(prettierValues, 'prettier style values present');
    assert.ok(prettierValues.kinds.includes('print-width') && prettierValues.kinds.includes('single-quote'));

    assert.ok(findings.entries.some((item) => item.status === 'inferred'),
      'regex-derived signals are inferred');
    assert.ok(findings.entries.some((item) => item.matchedKey === 'ritual:release-notes:CHANGELOG.md'),
      'release-drafter + changelog coupling detected');
  });
});

test('T005 scanner: repeated runs are byte-identical and deep-frozen', async () => {
  await withFixture('prac-determinism', POSITIVE_FILES, async (dir) => {
    const broker = inertGitBroker();
    const first = await scan(dir, {}, broker);
    const second = await scan(dir, {}, broker);
    assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
    assert.equal(Object.isFrozen(first.findings), true);
    assert.equal(Object.isFrozen(first.findings.entries[0]), true);
  });
});

// ---------------------------------------------------------------------------
// scanner.mjs — negative cases and privacy
// ---------------------------------------------------------------------------

test('T005 scanner: empty repository yields not_detected after a complete search', async () => {
  const files = { 'src/app.js': 'console.log("x");\n' };
  await withFixture('prac-empty', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(dimension, 'practices');
    assert.equal(signal, 'low');
    assert.equal(findings.summary.entries, 0);
    assert.equal(findings.entries.length, 0);
    assert.equal(findings.searchSpace.complete, true);
    assert.equal(findings.searchSpace.supported, true);
    assert.equal(findings.searchSpace.readable, true);
    assert.deepEqual(findings.diagnostics, []);
    assert.deepEqual(findings.summary.byCategory, Object.fromEntries(PRACTICES_CATEGORIES.map((name) => [name, 0])));
  });
});

test('T005 scanner: token values never reach the model, provider, or outputs', async () => {
  const canary = 'sk-supersecret123';
  const files = {
    ...POSITIVE_FILES,
    '.prettierrc': `{"printWidth": 100, "singleQuote": true, "token": "${canary}"}\n`,
    'quality/gates.conf': `MIN_COVERAGE=85\napi_token=${canary}\n`,
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  lint:',
      '    env:',
      `      TOKEN: ${canary}`,
      '    steps:',
      '      - run: echo $TOKEN',
    ].join('\n'),
  };
  await withFixture('prac-privacy', files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(JSON.stringify(findings).includes(canary), false, 'model leaked the token');
    assert.equal(JSON.stringify(practicesProviderResult(findings)).includes(canary), false, 'provider leaked the token');
  });
});

test('T005 scanner: malformed artifacts degrade to unverified, never crash', async () => {
  const files = {
    'features/login.feature': 'Feature: Login\n',
    'quality/gates.conf': Buffer.from([0xff, 0xfe, 0x00]),
    'src/app.js': 'x',
  };
  await withFixture('prac-unreadable', files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(findings.diagnostics.some(({ reason }) => reason === 'MALFORMED'));
    assert.ok(findings.entries.some(({ path }) => path === 'features/login.feature'),
      'a valid peer artifact survives the malformed gate file');
  });
});

test('T003 negative: generated and vendored content under hidden dirs is never collected', async () => {
  const { withFixture: withFixtureIsolated } = await import('./harness.mjs');
  const { scan: scanIsolated } = await import('../lib/scan/deep/practices/scanner.mjs');
  await withFixtureIsolated('t003-generated-junk', {
    '.opencode/node_modules/pkg/index.js': 'x = 1\n',
    '.opencode/node_modules/pkg/package.json': '{"name":"pkg"}\n',
    '.opencode/coverage/index.html': '<html></html>\n',
    '.opencode/coverage/favicon.png': 'not-png',
    '.opencode/eslint.config.mjs': 'export default {};\n',
    'quality/gates.conf': 'MIN_COVERAGE=85\n',
  }, async (dir) => {
    const { findings } = await scanIsolated(dir);
    const paths = findings.entries.map((item) => item.path);
    assert.ok(!paths.some((path) => path.includes('node_modules')), 'node_modules content is never collected');
    assert.ok(!paths.some((path) => path.includes('/coverage/')), 'coverage artifacts are never collected');
    assert.ok(paths.includes('.opencode/eslint.config.mjs'), 'real agent configs are still collected');
    assert.ok(paths.some((path) => path === 'quality/gates.conf'), 'quality gate file still collected');
  });
});

// ---------------------------------------------------------------------------
// style.mjs — T003 style & convention extractors
// ---------------------------------------------------------------------------

const RUFF_PYPROJECT = [
  '[tool.ruff]',
  'target-version = "py312"',
  'line-length = 100',
  '',
  '[tool.ruff.lint]',
  'select = ["E", "W", "F", "S101", "UP035"]',
  'ignore = ["E501", "D105"]',
  '',
  '[tool.ruff.lint.pydocstyle]',
  'convention = "google"',
  '',
  '[tool.ruff.lint.per-file-ignores]',
  '"tests/**/*.py" = ["D", "S101"]',
].join('\n');

test('T003 style: ruff select and ignore codes emit as separate facts', () => {
  const records = extractRuffRules({ path: 'pyproject.toml', text: RUFF_PYPROJECT });
  const select = records.find((record) => record.kind === 'ruff-select');
  assert.equal(select.count, 5, 'live select codes');
  assert.ok(select.kinds.includes('E') && select.kinds.includes('S') && select.kinds.includes('UP'),
    'rule families are slug kinds');
  assert.ok(select.kinds.includes('S101') && select.kinds.includes('UP035'),
    'individual select codes are slug kinds');
  const ignored = records.find((record) => record.kind === 'ruff-ignore');
  assert.equal(ignored.count, 4, 'ignore + per-file-ignores codes stay separate');
  assert.ok(ignored.kinds.includes('E501') && ignored.kinds.includes('D105') && ignored.kinds.includes('D'),
    'ignored codes render as slug kinds');
  assert.equal(records.some((record) => record.kind === 'ruff-rules'), false,
    'select and ignore are never summed into an aggregated ruff-rules fact');
  const lineLength = records.find((record) => record.kind === 'line-length');
  assert.equal(lineLength.count, 100);
  const dialect = records.find((record) => record.kind === 'docstring-dialect');
  assert.deepEqual(dialect.kinds, ['google']);
});

test('T003 style: ruff extractor emits quote-style as a kind token', () => {
  const records = extractRuffRules({
    path: 'pyproject.toml',
    text: '[tool.ruff]\nquote-style = "single"\n',
  });
  const quote = records.find((record) => record.kind === 'quote-style');
  assert.deepEqual(quote.kinds, ['single']);
});

test('T003 style: ruff extractor handles dedicated ruff.toml root tables', () => {
  const records = extractRuffRules({ path: 'ruff.toml', text: 'line-length = 100\n' });
  const lineLength = records.find((record) => record.kind === 'line-length');
  assert.equal(lineLength.count, 100);
  assert.deepEqual(extractRuffRules({ path: 'pyproject.toml', text: '[tool.black]\nline-length = 100\n' }), [],
    'a pyproject without a [tool.ruff] table yields no ruff facts');
});

const MAKEFILE_FIXTURE = [
  'test:',
  '\tmake test',
  'lint: fmt',
  '\tmake lint',
  'define MESSAGE',
  'hello',
  'endef',
  'format: \\',
  '\tone',
  'not-a-target = value',
  'ci-lint:',
  '\tmake ci-lint',
].join('\n');

test('T003 style: Makefile targets extract with count and slug kinds', () => {
  const records = extractMakeTargets({ path: 'Makefile', text: MAKEFILE_FIXTURE });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'make-targets');
  assert.equal(records[0].count, 4);
  assert.deepEqual(records[0].kinds.toSorted(), ['ci-lint', 'format', 'lint', 'test']);
  assert.equal(extractMakeTargets({ path: 'src/Makefile', text: 'x:\n' }).length, 1,
    'the extractor is basename-gated; the scanner only reads root Makefiles as candidates');
});

const LEFTHOOK_REALISH = [
  'pre-commit:',
  '  piped: true',
  '  jobs:',
  '    - name: guard',
  '      run: |',
  '        git diff --quiet',
  '    - name: read-only',
  '      group:',
  '        parallel: true',
  '        jobs:',
  '          - name: lint',
  '            run: make lint',
  '          - name: format-check',
  '            run: make format-check',
  '    - name: autofix',
  '      group:',
  '        piped: true',
  '        jobs:',
  '          - name: ruff-fix',
  '            run: uv run ruff check --fix',
  '            stage_fixed: true',
  'pre-push:',
  '  jobs:',
  '    - name: coverage',
  '      run: make test-coverage',
].join('\n');

test('T003 style: lefthook stages and jobs extract as separate records with pipeline semantics', () => {
  const records = extractLefthookStages({ path: 'lefthook.yml', text: LEFTHOOK_REALISH });
  const stages = records.find((record) => record.kind === 'hook-stages');
  assert.equal(stages.count, 2, 'stage count is the number of declared hooks, never summed with jobs');
  assert.deepEqual(stages.kinds.toSorted(), ['pre-commit', 'pre-push']);
  const jobs = records.find((record) => record.kind === 'hook-jobs');
  assert.equal(jobs.count, 7, 'every - name: job across top level and nested groups');
  const preCommit = records.find((record) => record.kind === 'hook-stage:pre-commit');
  assert.equal(preCommit.count, 3, 'three top-level pre-commit stages');
  assert.ok(preCommit.kinds.includes('piped') && preCommit.kinds.includes('abort-on-failure'),
    'piped sequencing implies abort-on-failure');
  assert.ok(preCommit.kinds.includes('parallel'), 'parallel nested groups are disclosed');
  const prePush = records.find((record) => record.kind === 'hook-stage:pre-push');
  assert.equal(prePush.count, 1);
  assert.deepEqual(extractLefthookStages({ path: '.github/workflows/ci.yml', text: 'jobs:\n  lint: {}\n' }), []);
});

const OPENCODE_JSONC = [
  '{',
  '  // Edit permission rules',
  '  "permission": {',
  '    "edit": {',
  '      "*": "allow",',
  '      "**/quality/gates.conf": "deny",',
  '      "**/secrets/*.env": "deny"',
  '    }',
  '  },',
  '  "plugin": [',
  '    ".opencode/plugins/quality-gate.ts",',
  '    ".opencode/plugins/pxcli-quality.ts",',
  '  ],',
  '}',
].join('\n');

test('T003 style: opencode deny rules and plugin inventory extract as kinds', () => {
  const records = extractOpencodeWorkflow({ path: 'opencode.jsonc', text: OPENCODE_JSONC });
  const deny = records.find((record) => record.kind === 'deny-rules');
  assert.equal(deny.count, 2);
  assert.deepEqual(deny.kinds.toSorted(), ['**/quality/gates.conf', '**/secrets/*.env']);
  const plugins = records.find((record) => record.kind === 'opencode-plugins');
  assert.equal(plugins.count, 2);
  assert.ok(plugins.kinds.includes('.opencode/plugins/quality-gate.ts'));
  assert.ok(plugins.kinds.includes('.opencode/plugins/pxcli-quality.ts'));
  assert.deepEqual(extractOpencodeWorkflow({ path: 'opencode.jsonc', text: 'not json {' }), []);
  assert.deepEqual(extractOpencodeWorkflow({ path: 'src/opencode.jsonc', text: OPENCODE_JSONC }), []);
});

const CONTRIBUTING_MD = [
  '# Contributing',
  '',
  '## Development Setup',
  'clone the repo',
  '## Test Taxonomy',
  'run the suite',
  '## Python and Dependency Policy',
  'pin floors',
  '### Nested Section',
  'details',
].join('\n');

test('T003 style: convention headings become hyphenated slug kinds', () => {
  const records = extractDeclaredConventions({ path: 'CONTRIBUTING.md', text: CONTRIBUTING_MD });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'declared-conventions');
  assert.equal(records[0].count, 5);
  assert.deepEqual(records[0].kinds.toSorted(), [
    'contributing', 'development-setup', 'nested-section',
    'python-and-dependency-policy', 'test-taxonomy',
  ]);
  assert.deepEqual(extractDeclaredConventions({ path: 'README.md', text: CONTRIBUTING_MD }), []);
});

const EXIT_CODES_FIXTURE = [
  'SUCCESS = 0',
  'GENERAL_FAILURE = 1',
  '_PRIVATE = 9',
  '',
  'class ApiError(Exception):',
  '    pass',
  '',
  'class RateLimitError(ApiError):',
  '    pass',
].join('\n');

test('T003 style: exceptions hub reports role count and exit-code taxonomy pairs', () => {
  const records = extractExceptionsHub({ path: 'src/exit_codes.py', text: EXIT_CODES_FIXTURE });
  const hub = records.find((record) => record.kind === 'exceptions-hub');
  assert.equal(hub.count, 4, '2 exception classes + 2 bare constants');
  const constants = records.find((record) => record.kind === 'exit-code-constant');
  assert.deepEqual(constants.kinds.toSorted(), ['general-failure-1', 'success-0'],
    'ALL_CAPS = <int> assignments become tokenized name-value pairs');
  assert.equal(constants.count, 2, '_PRIVATE is not an ALL_CAPS exit-code pair');
  assert.equal(records.some((record) => record.kind === 'exit-code-exception'), false,
    'no exception table in this fixture');
  assert.deepEqual(extractExceptionsHub({ path: 'src/util.py', text: 'SUCCESS = 0\n' }), []);
});

test('T003 style: multi-word names become bounded slugs, never space tokens', () => {
  assert.equal(slugToken('adapter must not import non-allowed layers'),
    'adapter-must-not-import-non-allowed-layers');
  assert.equal(slugToken('CLI Failure Policy'), 'cli-failure-policy');
  assert.equal(slugToken('**/quality/gates.conf'), '**/quality/gates.conf');
  assert.equal(slugToken('0.3'), '0.3');
  assert.equal(slugToken('B'), 'B');
  assert.equal(slugToken(''), null);
  assert.equal(slugToken('--- ---'), null);
  assert.equal(slugToken('\u20ac'), null);
});

test('T003 style: style extractors feed the scanner without space-token throws', async () => {
  const files = {
    'CONTRIBUTING.md': '# Contributing\n## Code Quality\n',
    'Makefile': 'test:\n\tmake\nlint:\n\tmake lint\n',
    'src/exit_codes.py': 'SUCCESS = 0\nclass ApiError(Exception):\n    pass\n',
    'src/app.js': 'x = 1\n',
  };
  await withFixture('t003-style-signals', files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(findings.diagnostics.length, 0, 'no unverified/parse-failure diagnostics');
    const conventions = findings.entries.find((item) => (
      item.matchedKey === 'style_guide:declared-conventions:CONTRIBUTING.md'
    ));
    assert.ok(conventions, 'declared-conventions entry present');
    assert.deepEqual(conventions.kinds, ['code-quality', 'contributing']);
    const targets = findings.entries.find((item) => item.matchedKey === 'automation:make-targets:Makefile');
    assert.ok(targets, 'make-targets entry present alongside the static makefile kind');
    assert.equal(targets.count, 2);
    const hub = findings.entries.find((item) => item.matchedKey === 'style_guide:exceptions-hub:src/exit_codes.py');
    assert.ok(hub, 'exceptions-hub entry present');
    assert.equal(hub.count, 2);
  });
});

// ---------------------------------------------------------------------------
// T005 — style-engine depth: gates toggles, value fidelity, lefthook
// pipelines, make pseudo-targets, and the exit-code taxonomy.
// ---------------------------------------------------------------------------

test('T005 policy: CHECK_* toggles emit as quality_gate:check-toggle facts', () => {
  const records = extractGateValues({
    path: 'quality/gates.conf',
    text: [
      'CHECK_FORMAT = true',
      'CHECK_LINT = true',
      'CHECK_SEMGREP = false',
      'MIN_COVERAGE=85',
    ].join('\n'),
  });
  const format = records.find((record) => record.kind === 'check-toggle:check-format');
  assert.equal(format.count, 1, 'true toggles render as on');
  const semgrep = records.find((record) => record.kind === 'check-toggle:check-semgrep');
  assert.equal(semgrep.count, 0, 'false toggles render as off');
  assert.equal(records.some((record) => record.kind === 'check-toggle:check-lint'), true);
  assert.equal(records.some((record) => record.kind === 'check-toggle:min-coverage'), false,
    'non-toggle gate keys never become toggles');
});

test('T005 policy: semgrepseverity carries its real value through the value channel', () => {
  const records = extractGateValues({
    path: 'quality/gates.conf',
    text: 'SEMGREP_SEVERITY = --severity ERROR --severity WARNING\nMIN_COVERAGE=85\n',
  });
  const semgrep = records.find((record) => record.kind === 'gate-value:semgrepseverity');
  assert.deepEqual(semgrep.kinds, ['--severity%20ERROR%20--severity%20WARNING'],
    'the ordered string value survives as a single percent-encoded token');
  assert.equal(semgrep.count, undefined);
  assert.equal(JSON.stringify(records).includes('--severity ERROR'), false,
    'raw value strings with spaces never reach the record model');
});

test('T005 policy: gates.conf header semantics become tokenized policy kinds', () => {
  const records = extractGateValues({
    path: 'quality/gates.conf',
    text: [
      '# This file is DENIED to coding agents. Values set the floor.',
      '# To change as a human: remove the deny rule, edit, restore.',
      'MIN_COVERAGE=85',
    ].join('\n'),
  });
  const header = records.find((record) => record.kind === 'gates-header');
  assert.ok(header, 'header policy fact present');
  assert.ok(header.kinds.includes('denied-to-agents'), 'agent denial tokenized');
  assert.ok(header.kinds.includes('locked-floors'), 'locked floors tokenized');
  assert.ok(header.kinds.includes('deny-remove-restore'), 'remove/restore protocol tokenized');
  assert.equal(JSON.stringify(header).includes('coding agents'), false,
    'no verbatim prose survives the tokenization');
});

const LEFTHOOK_PIPED_FIXTURE = [
  '# Pre-commit: 5-stage pipeline (piped = sequential stages, abort on failure)',
  '#   Stage 1  Reject partial staging',
  '#   Stage 2  Read-only linters (parallel)',
  '#   Stage 3  Auto-fixers',
  '#   Stage 4  Re-run read-only linters',
  '#   Stage 5  Unit tests',
  'pre-commit:',
  '  piped: true',
  '  jobs:',
  '    - name: reject-partial-staging',
  '      run: git diff --quiet',
  '    - name: lint-and-validate',
  '      group:',
  '        parallel: true',
  '        jobs:',
  '          - name: ruff-check',
  '            run: make lint',
  '    - name: pytest-check',
  '      run: make test',
  '# Pre-push: staged sequence, gitleaks owns the stdin pipe',
  '#   Stage 1  gitleaks (stdin) + static checks',
  '#   Stage 2  pytest with coverage enforcement',
  '#   Stage 3  property tests + sonar reports',
  '#   Stage 4  mutation + safety + fuzz',
  'pre-push:',
  '  piped: true',
  '  jobs:',
  '    - name: gitleaks-detect',
  '      run: scripts/gitleaks_check.sh pre-push "{1}" "{2}"',
  '      use_stdin: true',
  '    - name: static-checks',
  '      group:',
  '        parallel: true',
  '        jobs:',
  '          - name: arch-check',
  '            run: make arch-check',
  '    - name: pytest-coverage',
  '      run: make test-coverage',
].join('\n');

test('T005 style: lefthook piped-stage facts report 5 pre-commit / 4 pre-push stages with stdin ownership', () => {
  const records = extractLefthookStages({ path: 'lefthook.yml', text: LEFTHOOK_PIPED_FIXTURE });
  const preCommit = records.find((record) => record.kind === 'hook-stage:pre-commit');
  assert.equal(preCommit.count, 5, 'the authored 5-stage pre-commit pipeline');
  assert.ok(preCommit.kinds.includes('piped') && preCommit.kinds.includes('abort-on-failure'),
    'pre-commit stages are piped with abort-on-failure');
  const prePush = records.find((record) => record.kind === 'hook-stage:pre-push');
  assert.equal(prePush.count, 4, 'the authored 4-stage pre-push pipeline');
  assert.ok(prePush.kinds.includes('stdin-owner:gitleaks-detect'),
    'gitleaks is reported as the sole stdin consumer');
  const jobs = records.find((record) => record.kind === 'hook-jobs');
  assert.equal(jobs.count, 8, 'stage count and job count are never summed');
});

test('T005 style: .PHONY pseudo-targets are excluded from the make-target count', () => {
  const records = extractMakeTargets({
    path: 'Makefile',
    text: [
      '.PHONY: build test lint',
      'build:',
      '\tmake',
      'lint:',
      '\tmake lint',
    ].join('\n'),
  });
  const targets = records.find((record) => record.kind === 'make-targets');
  assert.equal(targets.count, 2, '.PHONY is not a buildable target');
  assert.deepEqual(targets.kinds.toSorted(), ['.PHONY', 'build', 'lint'],
    'the discovered declaration stays in the kinds list');
});

test('T005 style: make check toggles and ci-quality membership emit as automation facts', () => {
  const records = extractMakeTargets({
    path: 'Makefile',
    text: [
      'ifeq ($(CHECK_FORMAT),true)',
      'CHECK_PREREQS += format-check',
      'endif',
      'ifeq ($(CHECK_LINT),true)',
      'CHECK_PREREQS += lint',
      'endif',
      'ci-quality: format-check lint semgrep ratchets deptry',
      'check: $(CHECK_PREREQS)',
    ].join('\n'),
  });
  const toggles = records.find((record) => record.kind === 'make-check-toggles');
  assert.equal(toggles.count, 2, 'CHECK_* toggles feed the check composition');
  assert.deepEqual(toggles.kinds.toSorted(), ['check-format', 'check-lint']);
  const membership = records.find((record) => record.kind === 'make-ci-quality');
  assert.deepEqual(membership.kinds.toSorted(), ['deptry', 'format-check', 'lint', 'ratchets', 'semgrep']);
  assert.equal(membership.count, 5);
});

const EXIT_CODES_TAXONOMY = [
  'SUCCESS = 0',
  'GENERAL_FAILURE = 1',
  'AUTH_REQUIRED = 4',
  'TRANSIENT = 6',
  'INTERRUPTED = 130',
  '_HTTP_STATUS_UNAUTHORISED: Final[int] = 401',
  '_HTTP_STATUS_FORBIDDEN: Final[int] = 403',
  '_HTTP_STATUS_TOO_MANY_REQUESTS: Final[int] = 429',
  '_HTTP_STATUS_SERVER_ERROR_THRESHOLD: Final[int] = 500',
  '',
  '_EXCEPTION_EXIT_CODE_TABLE: list[tuple[type, int]] = [',
  '    (ApiError, AUTH_REQUIRED),',
  '    (KeyboardInterrupt, INTERRUPTED),',
  ']',
  '',
  'def _exit_code_for_http_error(status):',
  '    if status in {_HTTP_STATUS_UNAUTHORISED, _HTTP_STATUS_FORBIDDEN}:',
  '        return AUTH_REQUIRED',
  '    if status == _HTTP_STATUS_TOO_MANY_REQUESTS or status >= _HTTP_STATUS_SERVER_ERROR_THRESHOLD:',
  '        return TRANSIENT',
  '    return GENERAL_FAILURE',
].join('\n');

test('T005 style: exit-code taxonomy emits constants, exception table and HTTP special-casing', () => {
  const records = extractExceptionsHub({ path: 'src/perplexity_cli/exit_codes.py', text: EXIT_CODES_TAXONOMY });
  const constants = records.find((record) => record.kind === 'exit-code-constant');
  assert.equal(constants.count, 5, 'ALL_CAPS = <int> assignments only');
  assert.ok(constants.kinds.includes('auth-required-4') && constants.kinds.includes('interrupted-130'));
  assert.ok(!constants.kinds.some((kind) => kind.includes('http')),
    'HTTP status constants are never reported as exit codes');
  const exceptions = records.find((record) => record.kind === 'exit-code-exception');
  assert.deepEqual(exceptions.kinds.toSorted(), ['apierror-4', 'keyboardinterrupt-130'],
    'exception-to-code rows resolve to tokenized pairs');
  const http = records.find((record) => record.kind === 'exit-code-http');
  assert.deepEqual(http.kinds.toSorted(), ['http-401-403-4', 'http-429-5xx-6'],
    'HTTP special-casing is disclosed as bounded kinds');
});

test('T005 render: style-guide block renders value fidelity, toggles, stages and exit-code pairs', () => {
  const entries = [
    { category: 'quality_gate', matchedKey: 'quality_gate:gate-value:semgrepseverity:quality/gates.conf', path: 'quality/gates.conf', status: 'observed', kinds: ['--severity%20ERROR%20--severity%20WARNING'] },
    { category: 'quality_gate', matchedKey: 'quality_gate:gate-value:mincoverage:quality/gates.conf', path: 'quality/gates.conf', status: 'observed', count: 85 },
    { category: 'quality_gate', matchedKey: 'quality_gate:check-toggle:check-format:quality/gates.conf', path: 'quality/gates.conf', status: 'observed', count: 1 },
    { category: 'quality_gate', matchedKey: 'quality_gate:check-toggle:check-semgrep:quality/gates.conf', path: 'quality/gates.conf', status: 'observed', count: 0 },
    { category: 'quality_gate', matchedKey: 'quality_gate:gates-header:quality/gates.conf', path: 'quality/gates.conf', status: 'observed', kinds: ['denied-to-agents', 'human-change'] },
    { category: 'enforcement', matchedKey: 'enforcement:hook-stages:lefthook.yml', path: 'lefthook.yml', status: 'observed', count: 2, kinds: ['pre-commit', 'pre-push'] },
    { category: 'enforcement', matchedKey: 'enforcement:hook-jobs:lefthook.yml', path: 'lefthook.yml', status: 'observed', count: 53 },
    { category: 'enforcement', matchedKey: 'enforcement:hook-stage:pre-commit:lefthook.yml', path: 'lefthook.yml', status: 'observed', count: 5, kinds: ['piped', 'abort-on-failure'] },
    { category: 'enforcement', matchedKey: 'enforcement:hook-stage:pre-push:lefthook.yml', path: 'lefthook.yml', status: 'observed', count: 4, kinds: ['piped', 'abort-on-failure', 'stdin-owner:gitleaks-detect'] },
    { category: 'style_guide', matchedKey: 'style_guide:exit-code-constant:src/exit_codes.py', path: 'src/exit_codes.py', status: 'observed', count: 9, kinds: ['success-0', 'interrupted-130'] },
  ];
  const model = modelOf(entries);
  const markdown = renderPractices('repository', model);
  assert.ok(markdown.includes('| semgrepseverity | `--severity ERROR --severity WARNING` |'),
    'semgrepseverity renders its real value verbatim in the gate table');
  assert.ok(markdown.includes('| check-format | on |') && markdown.includes('| check-semgrep | off |'),
    'check toggles render as on/off states');
  assert.ok(markdown.includes('pre-commit (5 stages: `abort-on-failure`, `piped`)'),
    'per-hook stage counts render with pipeline semantics');
  assert.ok(markdown.includes('pre-push (4 stages: `abort-on-failure`, `piped`, `stdin-owner:gitleaks-detect`)'),
    'gitleaks stdin ownership renders in the stage pipeline');
  assert.ok(markdown.includes('`denied-to-agents`, `human-change`'), 'gate policy kinds render');
  assert.ok(markdown.includes('9 codes: `interrupted-130`, `success-0`'), 'exit-code pairs render');
  assert.equal(markdown, renderPractices('repository', model), 'rendering stays deterministic');
});

// ---------------------------------------------------------------------------
// T006 — policy-content and agent-workflow extractors
// ---------------------------------------------------------------------------

const CONVENTIONS_PLUGIN_BLOCK = [
  'const CONVENTIONS_BLOCK = `## Python Coding Conventions (pxcli project)',
  '',
  '### Complexity & Structure',
  '1. Keep cyclomatic complexity <= 5 per function. Extract helper functions for complex logic.',
  '2. Maximum 4 parameters per function. For more, group into a `@dataclass(frozen=True, slots=True)`.',
  '3. Google-style docstrings for all public functions, classes, and modules.',
  '4. Type annotations on all function signatures (parameters and return types).',
  '5. Use `TYPE_CHECKING` + `from __future__ import annotations` for import-only types.',
  '',
  '### Logging & Output',
  '6. Use `%s`-style lazy formatting in logger calls — never f-strings.',
  '7. Use `logger`, not `print()`, for all non-CLI output.',
  '8. Never log tokens, cookies, or credentials.',
  '',
  '### Error Handling',
  '9. Never bare `except:` or `except Exception: pass` — always log something meaningful.',
  '10. Use `raise X from Y` in except blocks to preserve tracebacks.',
  '',
  '### Security',
  '11. Never use `eval()` or `exec()`.',
  '12. Never use `subprocess` with `shell=True`.',
  '13. Never hardcode passwords, secrets, or API keys in source code.',
  '14. Use `secrets` module for security-sensitive randomness, not `random`.',
  '',
  '### Style',
  '15. No single-letter variables except `e`, `f`, `i`, `j`, `k`, `v`, `x`, `y`, `n`.',
  '16. Never use `from x import *` (wildcard imports).',
  '17. Use `is None` / `is not None`, not `== None` / `!= None`.',
  '18. Delete commented-out code — git remembers.',
  '19. British English in comments and docstrings.',
  '',
  '### Dependencies',
  '20. When adding dependencies, pin minimum version floors (`>=`) to avoid known-vulnerable ranges.`;',
].join('\n');

const CONTENT_PLUGIN_FIXTURE = [
  CONVENTIONS_PLUGIN_BLOCK,
  'export async function checkRuff(filePath) { return []; }',
  'export async function checkRadon(filePath) { return []; }',
  'export async function checkBandit(filePath) { return []; }',
  'export async function checkTy(filePath) { return []; }',
  'export async function checkSafety(filePath) { return []; }',
  'export async function checkSemgrep(filePath) { return []; }',
  'export async function checkPyright(filePath) { return []; }',
].join('\n');

const CONTENT_QUALITY_GATE_FIXTURE = [
  'const BYPASS_PATTERNS = [',
  '  { re: /--exclude\\b/, label: "--exclude" },',
  '  { re: /--exclude-rule\\b/, label: "--exclude-rule" },',
  '  { re: /#\\s*nosec/i, label: "# nosec" },',
  '  { re: /#\\s*pragma:\\s*no\\s*cover/i, label: "# pragma: no cover" },',
  '  { re: /#\\s*type:\\s*ignore/i, label: "# type: ignore" },',
  '];',
  'const GATE_REFERENCES = [];',
  'function loweredSeverity(oldStr, newStr) { return null; }',
  'if (process.env.OPENCODE_DISABLE_QUALITY_GATE === "1") return;',
  '"tool.execute.before": async (input, output) => { throw new Error("blocked"); }',
].join('\n');

const CONTENT_PRE_PUSH_FIXTURE = [
  '// Intercepts git push commands. On the first recognised push attempt,',
  '// the plugin blocks execution and requests a documentation review.',
  'const GIT_PUSH_RE = /\\bgit\\s+push\\b/;',
].join('\n');

const CONTENT_FIXTURE_FILES = {
  // suppression policy (a2, a9, d3, d9 block-gate)
  'scripts/check_suppression_reasons.py': [
    '"""Suppression-reason enforcement gate.',
    'Blocks new inline suppressions (# noqa, # nosec) that lack owner: and',
    'reason: justification fields. Suppressions are extracted with Python\'s',
    'tokeniser. Existing un-annotated suppressions are grandfathered via a',
    'fingerprint baseline in file:line:type format.',
    'Exit codes: 0 = pass, 1 = unformatted suppression found, 2 = tool/config error.',
    '"""',
    'import re',
    '_OWNER_RE = re.compile(r"(?:^|[;\\s,])owner\\s*:\\s*\\S", re.IGNORECASE)',
    '_REASON_RE = re.compile(r"(?:^|[;\\s,])reason\\s*:\\s*\\S", re.IGNORECASE)',
  ].join('\n'),
  'scripts/check_suppressions.py': [
    '"""Suppression ratchet gate — identity-fingerprint edition.',
    'Each identity is a file:line:type[:detail] fingerprint.',
    'Blocks new, moved, or broadened suppressions.',
    'Exit codes: 0 = pass, 1 = regression, 2 = tool/configuration error.',
    '"""',
  ].join('\n'),
  'quality/baselines/suppressions.json': JSON.stringify({
    fingerprints: ['src/a.py:1:noqa', 'src/b.py:2:nosec'],
  }),
  // ratchet mechanics (a9, d3)
  'scripts/_ratchet.py': [
    'def diff_counts(current, baseline):',
    '    ...',
    'def diff_fingerprints(current, baseline):',
    '    ...',
    'add_update_flag(parser)',
    '# shrinking is always allowed and becomes the new baseline via --update-baseline',
  ].join('\n'),
  // mutation policy (a15)
  'scripts/mutation_policy.py': [
    'EXIT_CLEAN: int = 0',
    'EXIT_FINDINGS: int = 1',
    'EXIT_TOOL_ERROR: int = 2',
    'ACTIONABLE_CATEGORIES: frozenset[str] = frozenset({"survived", "timeout", "suspicious"})',
    '"""Exit codes: 0 clean, 1 findings, 2 tool-error."""',
  ].join('\n'),
  '.github/workflows/mutation-scheduled.yml': [
    'name: Scheduled Mutation Testing',
    "'on':",
    '  schedule:',
    "    - cron: '0 2 * * 0'",
    'jobs:',
    '  mutation:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Run full mutation testing with policy wrapper',
    '        run: make mutate-full-policy',
  ].join('\n'),
  // fuzz replay (a12)
  'tests/fuzz_corpus/README.md': [
    '# Fuzz seed corpus',
    '| File | Bytes | Purpose |',
    '| --- | ---: | --- |',
    '| `seed_01.bin` | 4 | Valid input |',
    '| `seed_02.bin` | 8 | Second input |',
    'Replay order is deterministic: lexicographic order of the .bin filenames.',
    'A seed that raises an unexpected exception fails the harness authoritatively.',
    'The harness reports in a machine-readable JSON state file.',
  ].join('\n'),
  'tests/test_fuzz.py': [
    '_FUZZ_ITERATIONS = 5_000',
    '@pytest.mark.fuzz',
    'class TestFuzzSSEParser:',
    '    def test_fuzz_decode_line(self):',
    '        _run_harness("sse_decode_line")',
    '@pytest.mark.fuzz',
    'class TestFuzzFormatting:',
    '    def test_fuzz_strip_citations(self):',
    '        _run_harness("strip_citations")',
    '"""fuzz lane is authoritative and must not silently skip"""',
  ].join('\n'),
  'pyproject.toml': [
    '[project.dependencies]',
    "atheris>=3.1.0; sys_platform == 'linux' and platform_machine == 'x86_64'",
  ].join('\n'),
  // Makefile (mutation scope, fuzz CI, policy validators, analyser contracts)
  'Makefile': [
    'mutate-diff:',
    '\tmake',
    'mutate-full-policy:',
    '\tmake',
    'ci-fuzz-status: test-fuzz',
    '\tmake',
    'actionlint:',
    '\t$(ACTIONLINT)',
    'make-policy:',
    '\tuv run python scripts/validate_make_policy.py',
    'workflow-policy:',
    '\tuv run python scripts/validate_workflow_policy.py --strict',
    'analyser-contract-validate:',
    '\tuv run python scripts/check_analyser_contracts.py --validate',
    'analyser-contract-tests: analyser-contract-validate',
    '\tmake',
  ].join('\n'),
  // policy validators (d7)
  'scripts/validate_make_policy.py': [
    '"""Make target ownership and dependency validator.',
    'Exit codes: 0 pass, 1 fail, 2 usage.',
    '"""',
  ].join('\n'),
  'scripts/validate_workflow_policy.py': [
    '"""YAML 1.2-aware semantic validator for GitHub Actions workflows.',
    'External action references are pinned to a full 40-character SHA.',
    'No workflow uses the dangerous pull_request_target trigger.',
    'Usage: validate_workflow_policy.py [--strict]',
    'Exit codes: 0 pass, 1 fail, 2 usage.',
    '"""',
  ].join('\n'),
  // analyser contracts (d8)
  'quality/analyser-contracts.toml': [
    '[schema]',
    'version = 1',
    '[[analysers]]',
    'id = "lint"',
    'status = "active"',
    '[analysers.states.clean]',
    'exit_min = 0',
    'exit_max = 0',
    '[[analysers]]',
    'id = "mutation"',
    'status = "pending"',
    '[analysers.states.clean]',
    'exit_min = 0',
    'exit_max = 0',
    '[analysers.states.regression]',
    'exit_min = 1',
    'exit_max = 1',
  ].join('\n'),
  'scripts/check_analyser_contracts.py': [
    '"""Validate and run analyser contracts.',
    'Usage: check_analyser_contracts.py --validate',
    '"""',
  ].join('\n'),
  // methodology (a3, a25)
  'tests/test_removed_plan_gate.py': [
    '"""Structural gate asserting deleted plan-gate mechanisms stay gone."""',
  ].join('\n'),
  '.agents/plans/feature-csm.md': '# Plan\n## Control\n## Status\n',
  // agent-workflow content (a1, a19, a20, c1, d2)
  '.opencode/plugins/pxcli-quality.ts': CONTENT_PLUGIN_FIXTURE,
  '.opencode/plugins/quality-gate.ts': CONTENT_QUALITY_GATE_FIXTURE,
  '.opencode/plugins/pre-push-docs-check.ts': CONTENT_PRE_PUSH_FIXTURE,
  '.opencode/package.json': JSON.stringify({
    scripts: {
      check: 'npm run lint && npm run test && npm run typecheck && npm run check:config && npm run test:coverage',
      'check:config': 'tsx scripts/check-config.ts',
    },
  }),
  '.opencode/vitest.config.ts': [
    'export default defineConfig({',
    '  test: {',
    '    coverage: {',
    '      provider: "v8",',
    '      thresholds: {',
    '        lines: 85,',
    '        statements: 85,',
    '        functions: 85,',
    '        branches: 85,',
    '        perFile: true,',
    '      },',
    '    },',
    '  },',
    '});',
  ].join('\n'),
};

function contentEntry(model, matchedKey) {
  return model.entries.find((item) => item.matchedKey === matchedKey);
}

test('T006 content: suppression-policy kinds emit from both gate scripts', () => {
  const reasons = extractSuppressionPolicy({
    path: 'scripts/check_suppression_reasons.py',
    text: CONTENT_FIXTURE_FILES['scripts/check_suppression_reasons.py'],
  });
  const policy = reasons.find((record) => record.kind === 'suppression-policy');
  assert.ok(policy, 'suppression-policy fact present');
  for (const kind of ['owner-required', 'reason-required', 'block-new-unannotated', 'tokeniser-scan', 'file-line-type']) {
    assert.ok(policy.kinds.includes(kind), `missing kind ${kind}`);
  }
  const exit = reasons.find((record) => record.kind === 'suppression-exit-code');
  assert.deepEqual(exit.kinds, ['fail-1', 'pass-0', 'tool-error-2']);

  const suppressions = extractSuppressionPolicy({
    path: 'scripts/check_suppressions.py',
    text: CONTENT_FIXTURE_FILES['scripts/check_suppressions.py'],
  });
  const suppPolicy = suppressions.find((record) => record.kind === 'suppression-policy');
  assert.ok(suppPolicy.kinds.includes('file-line-type-detail'), 'file:line:type[:detail] identity tokenized');
  assert.ok(suppPolicy.kinds.includes('block-new-moved-broadened'), 'block new/moved/broadened tokenized');
  assert.deepEqual(extractSuppressionPolicy({ path: 'src/app.py', text: 'x' }), []);
});

test('T006 content: suppression-baseline reports the grandfathered identity count', () => {
  const records = extractSuppressionBaseline({
    path: 'quality/baselines/suppressions.json',
    text: CONTENT_FIXTURE_FILES['quality/baselines/suppressions.json'],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'suppression-baseline');
  assert.equal(records[0].count, 2, 'two grandfathered identities counted');
  assert.deepEqual(extractSuppressionBaseline({ path: 'quality/baselines/other.json', text: '{}' }), []);
});

test('T006 content: ratchet engine emits fingerprint-diff and update-baseline kinds', () => {
  const records = extractRatchet({
    path: 'scripts/_ratchet.py',
    text: CONTENT_FIXTURE_FILES['scripts/_ratchet.py'],
  });
  assert.equal(records.length, 1);
  const engine = records[0];
  assert.equal(engine.kind, 'ratchet-engine');
  for (const kind of ['fingerprint-diff', 'counts-diff', 'shrink-allowed', 'update-baseline']) {
    assert.ok(engine.kinds.includes(kind), `missing ratchet kind ${kind}`);
  }
  assert.deepEqual(extractRatchet({ path: 'scripts/other.py', text: 'x' }), []);
});

test('T006 content: mutation exit codes, actionable categories, scope and schedule', () => {
  const policy = extractMutationPolicy({
    path: 'scripts/mutation_policy.py',
    text: CONTENT_FIXTURE_FILES['scripts/mutation_policy.py'],
  });
  const exit = policy.find((record) => record.kind === 'mutation-exit-code');
  assert.deepEqual(exit.kinds, ['clean-0', 'findings-1', 'tool-error-2'], '0/1/2 exit taxonomy tokenized');
  const actionable = policy.find((record) => record.kind === 'mutation-actionable');
  assert.deepEqual(actionable.kinds, ['survived', 'suspicious', 'timeout']);
  const waivers = policy.find((record) => record.kind === 'mutation-waivers');
  assert.deepEqual(waivers.kinds, ['unsupported'], 'waivers-unsupported inferred when no waiver mechanism');
  assert.equal(waivers.status, 'inferred');

  const schedule = extractMutationPolicy({
    path: '.github/workflows/mutation-scheduled.yml',
    text: CONTENT_FIXTURE_FILES['.github/workflows/mutation-scheduled.yml'],
  });
  assert.deepEqual(schedule.find((record) => record.kind === 'mutation-schedule').kinds,
    ['full-policy', 'weekly-sunday-0200-utc'], 'cron 0 2 * * 0 maps to weekly Sunday 02:00 UTC');

  const scope = extractMutationPolicy({
    path: 'Makefile',
    text: CONTENT_FIXTURE_FILES.Makefile,
  });
  assert.deepEqual(scope.find((record) => record.kind === 'mutation-scope').kinds, ['diff', 'full']);
});

test('T006 content: fuzz replay contract, decomposition, platform gate and blocking CI', () => {
  const replay = extractFuzzReplay({
    path: 'tests/fuzz_corpus/README.md',
    text: CONTENT_FIXTURE_FILES['tests/fuzz_corpus/README.md'],
  });
  assert.deepEqual(replay.find((record) => record.kind === 'fuzz-replay-contract').kinds,
    ['authoritative-failure', 'json-state-file', 'lexicographic-seed-order']);
  assert.equal(replay.find((record) => record.kind === 'fuzz-seeds').count, 2, 'seed rows counted from the inventory table');

  const decomposition = extractFuzzReplay({
    path: 'tests/test_fuzz.py',
    text: CONTENT_FIXTURE_FILES['tests/test_fuzz.py'],
  });
  const fuzz = decomposition.find((record) => record.kind === 'fuzz-decomposition');
  assert.equal(fuzz.count, 2, 'two fuzz-marked test methods');
  assert.deepEqual(fuzz.kinds, ['formatting', 'sse-parser'], 'class decomposition slugged');
  assert.equal(decomposition.find((record) => record.kind === 'fuzz-iterations').count, 5000,
    'underscore-separated iteration budget parsed');

  const platform = extractFuzzReplay({
    path: 'pyproject.toml',
    text: CONTENT_FIXTURE_FILES['pyproject.toml'],
  });
  assert.deepEqual(platform.find((record) => record.kind === 'fuzz-platform-gate').kinds,
    ['atheris', 'linux-x86-64'], 'atheris linux/x86_64 gating detected');

  const make = extractFuzzReplay({ path: 'Makefile', text: CONTENT_FIXTURE_FILES.Makefile });
  assert.deepEqual(make.find((record) => record.kind === 'fuzz-ci-blocking').kinds,
    ['blocking', 'ci-fuzz-status'], 'blocking fuzz CI detected from the ci-fuzz-status target');
});

test('T006 content: policy validators and analyser-contract registry', () => {
  const makePolicy = extractPolicyValidators({
    path: 'scripts/validate_make_policy.py',
    text: CONTENT_FIXTURE_FILES['scripts/validate_make_policy.py'],
  });
  const mp = makePolicy.find((record) => record.kind === 'policy-validator');
  assert.ok(mp.kinds.includes('make-policy') && mp.kinds.includes('target-ownership'));

  const workflow = extractPolicyValidators({
    path: 'scripts/validate_workflow_policy.py',
    text: CONTENT_FIXTURE_FILES['scripts/validate_workflow_policy.py'],
  });
  const wf = workflow.find((record) => record.kind === 'policy-validator');
  for (const kind of ['strict-mode', 'sha-pinning', 'pull-request-target-forbidden', 'yaml-1-2-semantic']) {
    assert.ok(wf.kinds.includes(kind), `missing policy-validator kind ${kind}`);
  }

  const make = extractPolicyValidators({ path: 'Makefile', text: CONTENT_FIXTURE_FILES.Makefile });
  const mf = make.find((record) => record.kind === 'policy-validator');
  for (const kind of ['actionlint', 'make-policy', 'workflow-policy-strict']) {
    assert.ok(mf.kinds.includes(kind), `missing Makefile-wired kind ${kind}`);
  }

  const registry = extractAnalyserContracts({
    path: 'quality/analyser-contracts.toml',
    text: CONTENT_FIXTURE_FILES['quality/analyser-contracts.toml'],
  });
  const reg = registry.find((record) => record.kind === 'analyser-contract-registry');
  assert.equal(reg.count, 2, 'two declared analysers');
  for (const kind of ['schema-v1', 'active', 'pending', 'clean-state', 'regression-state']) {
    assert.ok(reg.kinds.includes(kind), `missing analyser-registry kind ${kind}`);
  }

  const checker = extractAnalyserContracts({
    path: 'scripts/check_analyser_contracts.py',
    text: CONTENT_FIXTURE_FILES['scripts/check_analyser_contracts.py'],
  });
  assert.deepEqual(checker.find((record) => record.kind === 'analyser-contract-validate').kinds,
    ['validate-mode']);
});

test('T006 content: plugin behaviours and conventions block are tokenized', () => {
  const plugin = extractPluginContent({
    path: '.opencode/plugins/pxcli-quality.ts',
    text: CONTENT_PLUGIN_FIXTURE,
  });
  const block = plugin.find((record) => record.kind === 'conventions-block');
  assert.equal(block.count, 20, 'the 20-rule block is counted');
  for (const id of ['complexity-le-5', 'max-4-params', 'percent-s-lazy-logging', 'logger-not-print',
    'no-bare-except', 'raise-with-from', 'no-eval-exec', 'no-shell-true', 'no-hardcoded-secrets',
    'secrets-module', 'single-letter-var-allowlist', 'no-wildcard-import', 'is-none-not-eq-none',
    'no-commented-out-code', 'british-english', 'version-floors']) {
    assert.ok(block.kinds.includes(id), `missing rule id ${id}`);
  }
  assert.equal(JSON.stringify(block).includes('cyclomatic complexity <= 5'), false,
    'verbatim rule prose never survives (A008)');
  const tools = plugin.find((record) => record.kind === 'quality-check-tools');
  for (const tool of ['ruff', 'radon', 'bandit', 'ty']) {
    assert.ok(tools.kinds.includes(tool), `missing reactive tool ${tool}`);
  }

  const gate = extractPluginContent({
    path: '.opencode/plugins/quality-gate.ts',
    text: CONTENT_QUALITY_GATE_FIXTURE,
  });
  const blocking = gate.find((record) => record.kind === 'quality-gate-blocking');
  for (const kind of ['blocking', 'bypass-pattern', 'severity-lowering', 'gate-reference-removal', 'nosec']) {
    assert.ok(blocking.kinds.includes(kind), `missing quality-gate-blocking kind ${kind}`);
  }
  assert.deepEqual(gate.find((record) => record.kind === 'quality-gate-override').kinds,
    ['override-env:opencode-disable-quality-gate']);

  const prePush = extractPluginContent({
    path: '.opencode/plugins/pre-push-docs-check.ts',
    text: CONTENT_PRE_PUSH_FIXTURE,
  });
  assert.deepEqual(prePush.find((record) => record.kind === 'pre-push-docs-block').kinds,
    ['docs-review-reminder', 'first-push-block']);

  const npm = extractPluginContent({
    path: '.opencode/package.json',
    text: CONTENT_FIXTURE_FILES['.opencode/package.json'],
  });
  const check = npm.find((record) => record.kind === 'npm-check-script');
  for (const kind of ['lint', 'test', 'typecheck', 'check-config', 'test-coverage', 'config-validation']) {
    assert.ok(check.kinds.includes(kind), `missing npm check kind ${kind}`);
  }

  const vitest = extractPluginContent({
    path: '.opencode/vitest.config.ts',
    text: CONTENT_FIXTURE_FILES['.opencode/vitest.config.ts'],
  });
  const thresholds = vitest.find((record) => record.kind === 'coverage-thresholds');
  for (const kind of ['lines-85', 'statements-85', 'functions-85', 'branches-85', 'per-file']) {
    assert.ok(thresholds.kinds.includes(kind), `missing threshold kind ${kind}`);
  }
});

test('T006 content: methodology aggregator emits csm-planning, no-bdd and plan-gate-removed', () => {
  const records = aggregateMethodology([
    { category: 'agent_workflow', matchedKey: 'agent_workflow:csm-plan:.agents/plans/feature-csm.md', path: '.agents/plans/feature-csm.md' },
    { category: 'methodology', matchedKey: 'methodology:plan-gate-meta-test:tests/test_removed_plan_gate.py', path: 'tests/test_removed_plan_gate.py' },
  ]);
  const csm = records.find((record) => record.kind === 'csm-planning');
  assert.equal(csm.count, 1);
  assert.equal(csm.status, 'inferred');
  assert.ok(records.some((record) => record.kind === 'no-bdd'), 'zero .feature files in a CSM-planned repo yields no-bdd');
  assert.ok(records.some((record) => record.kind === 'plan-gate-removed'), 'meta-test presence certifies plan-gate removal');

  const noPlans = aggregateMethodology([
    { category: 'agent_workflow', matchedKey: 'agent_workflow:agents:AGENTS.md', path: 'AGENTS.md' },
  ]);
  assert.equal(noPlans.length, 0, 'no-bdd is only claimed for CSM-planned repositories');
});

test('T006 scanner: content fixture emits suppression, ratchet, mutation, methodology and plugin facts', async () => {
  await withFixture('t006-content', CONTENT_FIXTURE_FILES, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(findings.diagnostics.length, 0, 'no parse failures on the content fixture');

    const reasonsPolicy = contentEntry(findings, 'quality_gate:suppression-policy:scripts/check_suppression_reasons.py');
    assert.ok(reasonsPolicy, 'suppression-policy entry for the reasons gate');
    assert.ok(reasonsPolicy.kinds.includes('owner-required') && reasonsPolicy.kinds.includes('reason-required'));

    const suppressionsPolicy = contentEntry(findings, 'quality_gate:suppression-policy:scripts/check_suppressions.py');
    assert.ok(suppressionsPolicy.kinds.includes('file-line-type-detail'));

    const baseline = contentEntry(findings, 'quality_gate:suppression-baseline:quality/baselines/suppressions.json');
    assert.equal(baseline.count, 2);

    const ratchet = contentEntry(findings, 'quality_gate:ratchet-engine:scripts/_ratchet.py');
    assert.ok(ratchet.kinds.includes('fingerprint-diff') && ratchet.kinds.includes('update-baseline'));

    const mutationExit = contentEntry(findings, 'quality_gate:mutation-exit-code:scripts/mutation_policy.py');
    assert.deepEqual(mutationExit.kinds, ['clean-0', 'findings-1', 'tool-error-2']);

    const csmPlanning = contentEntry(findings, 'methodology:csm-planning:.agents/plans');
    assert.equal(csmPlanning.count, 1);
    const noBdd = contentEntry(findings, 'methodology:no-bdd:.agents/plans');
    assert.ok(noBdd, 'no-bdd aggregated');
    const planGate = contentEntry(findings, 'methodology:plan-gate-removed:tests/test_removed_plan_gate.py');
    assert.ok(planGate, 'plan-gate-removed aggregated');

    const conventionsBlock = contentEntry(findings, 'agent_workflow:conventions-block:.opencode/plugins/pxcli-quality.ts');
    assert.equal(conventionsBlock.count, 20);
    assert.ok(conventionsBlock.kinds.includes('british-english') && conventionsBlock.kinds.includes('version-floors'));

    const override = contentEntry(findings, 'agent_workflow:quality-gate-override:.opencode/plugins/quality-gate.ts');
    assert.deepEqual(override.kinds, ['override-env:opencode-disable-quality-gate']);

    const prePush = contentEntry(findings, 'agent_workflow:pre-push-docs-block:.opencode/plugins/pre-push-docs-check.ts');
    assert.ok(prePush.kinds.includes('first-push-block'));

    const schedule = contentEntry(findings, 'quality_gate:mutation-schedule:.github/workflows/mutation-scheduled.yml');
    assert.ok(schedule.kinds.includes('weekly-sunday-0200-utc'));
  });
});

test('T006 render: behaviour facts render inside their category groups', async () => {
  await withFixture('t006-render', CONTENT_FIXTURE_FILES, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    const markdown = renderPractices('repository', findings);
    assert.ok(markdown.includes('- **CSM planning**: `.agents/plans`: 1 plan'), 'methodology behaviour line');
    assert.ok(markdown.includes('- **BDD**: `.agents/plans`: `no-bdd`'), 'no-bdd behaviour line');
    assert.ok(markdown.includes('- **Suppression baseline**: `quality/baselines/suppressions.json`: 2 identities'),
      'suppression baseline renders with correct plural');
    assert.ok(markdown.includes('- **Mutation exit codes**: `scripts/mutation_policy.py`: `clean-0`, `findings-1`, `tool-error-2`'),
      'mutation exit codes render');
    assert.ok(markdown.includes('- **Enforced conventions block**: `.opencode/plugins/pxcli-quality.ts`: 20 rules:'),
      'enforced conventions block renders');
    assert.ok(markdown.includes('`british-english`') && markdown.includes('`version-floors`'),
      'tokenized rule facts render');
    assert.equal(markdown, renderPractices('repository', findings), 'behaviour rendering stays deterministic');
  });
});
