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
  extractQualityGate,
} from '../lib/scan/deep/practices/model.mjs';
import { PRACTICE_TOOLS } from '../lib/scan/shared/detection.mjs';
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

test('T005 quality gate: only allowlisted threshold keys are retained, never values', () => {
  const records = extractQualityGate({
    path: 'quality/gates.conf',
    text: [
      'MIN_COVERAGE=85',
      'MAX_COMPLEXITY=10',
      'token=sk-supersecret123',
      'some_unknown_thing=1',
      'MAX_LINES = 500',
    ].join('\n'),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'gate-thresholds');
  assert.deepEqual(records[0].kinds, ['maxcomplexity', 'maxlines', 'mincoverage']);
  assert.equal(records[0].count, 3);
  assert.equal(JSON.stringify(records).includes('85'), false, 'raw values never survive');
  assert.equal(JSON.stringify(records).includes('500'), false);
  assert.equal(JSON.stringify(records).includes('sk-supersecret123'), false);
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
  const categories = [...new Set(results[0].observations.map(({ category }) => category))].sort();
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

    const gates = findings.entries.find((item) => item.matchedKey === 'quality_gate:gate-thresholds:quality/gates.conf');
    assert.ok(gates, 'quality gates.conf thresholds entry present');
    assert.ok(gates.kinds.includes('mincoverage'), 'MIN_COVERAGE retained as an allowlisted kind');
    assert.equal(JSON.stringify(findings).includes('85'), false, 'gate value never retained');

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
