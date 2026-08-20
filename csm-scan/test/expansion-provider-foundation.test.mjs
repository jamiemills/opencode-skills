import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  PROVIDER_DIMENSION_IDS,
} from '../lib/scan/contracts/dimension.mjs';
import {
  PROVIDER_CATEGORIES,
} from '../lib/scan/contracts/provider.mjs';
import {
  EVIDENCE_SOURCE_KINDS,
} from '../lib/scan/contracts/evidence.mjs';
import {
  PROVIDER_RESULT_LIMITS,
  ProviderResultError,
  createProviderResult,
  mergeProviderResults,
} from '../lib/scan/providers/base.mjs';
import {
  RULE_EVALUATION_LIMITS,
  RuleEvaluationError,
  evaluateRule,
  evaluateRules,
  validateArtifactMetadata,
  validateRuleForEvaluation,
} from '../lib/scan/providers/rules.mjs';
import {
  GENERIC_LIMITS,
  GENERIC_PROVIDER_ID,
  GenericProviderError,
  genericProviderResults,
  isUnknownLanguageEcosystem,
} from '../lib/scan/providers/generic.mjs';
import {
  DESCRIPTORS,
  descriptorObservations,
  descriptorProviderResults,
} from '../lib/scan/shared/ecosystem.mjs';
import {
  manifestObservations,
  manifestProviderResult,
} from '../lib/scan/shared/manifest.mjs';
import {
  DATABASE_INDICATORS,
  matchDep,
  detectionObservations,
  detectionProviderResult,
} from '../lib/scan/shared/detection.mjs';
import {
  countComments,
  commentObservations,
  commentProviderResult,
} from '../lib/scan/shared/comments.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

function observation(overrides) {
  return {
    category: 'language',
    path: null,
    matchedKey: 'language',
    details: { id: 'x', label: 'X' },
    sourceKind: 'repository_metadata',
    ...overrides,
  };
}

function resultFor(dimensionId, observations) {
  return createProviderResult({
    providerId: 'PRV-test-v1',
    dimensionId,
    observations,
  });
}

// ---------------------------------------------------------------------------
// base.mjs — schema snapshot, immutability, determinism
// ---------------------------------------------------------------------------

test('T210 base: PROVIDER_RESULT_LIMITS snapshot is exact and frozen', () => {
  assert.deepEqual(PROVIDER_RESULT_LIMITS, {
    detailsNodes: 1024,
    detailsString: 512,
    observations: 2048,
    providerId: 96,
    sourceKind: 32,
  });
  assert.equal(Object.isFrozen(PROVIDER_RESULT_LIMITS), true);
  assert.equal(Object.isFrozen(PROVIDER_CATEGORIES), true);
});

test('T210 base: provider results are deep-frozen and immutable', () => {
  const result = resultFor('DIM-stack-v1', [
    observation(),
    observation({ matchedKey: 'runtime', category: 'runtime', details: { name: 'Node.js' } }),
  ]);
  assert.deepEqual(Object.keys(result).toSorted(), ['dimensionId', 'observations', 'providerId']);
  assert.equal(result.providerId, 'PRV-test-v1');
  assert.equal(result.dimensionId, 'DIM-stack-v1');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.observations), true);
  assert.equal(Object.isFrozen(result.observations[0]), true);
  assert.equal(Object.isFrozen(result.observations[0].details), true);
  assert.throws(() => result.observations.push(observation()), TypeError);
  assert.throws(() => result.observations.pop(), TypeError);
  assert.throws(() => { result.observations[0].details.id = 'mutated'; }, TypeError);
  assert.throws(() => { result.dimensionId = 'DIM-api-v1'; }, TypeError);
});

test('T210 base: identical inputs are byte-identical regardless of insertion order', () => {
  const first = resultFor('DIM-stack-v1', [
    observation({ matchedKey: 'runtime:Bun', category: 'runtime', details: { name: 'Bun' } }),
    observation(),
  ]);
  const second = resultFor('DIM-stack-v1', [
    observation(),
    observation({ matchedKey: 'runtime:Bun', category: 'runtime', details: { name: 'Bun' } }),
  ]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.observations.map(({ matchedKey }) => matchedKey), ['language', 'runtime:Bun']);
});

test('T210 base: explicit per-dimension category constraints reject unknown and cross-dimension categories', () => {
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    const allowed = PROVIDER_CATEGORIES[dimensionId];
    assert.ok(allowed.length > 0, dimensionId);
    for (const category of allowed) {
      assert.doesNotThrow(() => resultFor(dimensionId, [observation({ category })]), `${dimensionId}:${category}`);
    }
  }
  assert.throws(() => resultFor('DIM-stack-v1', [observation({ category: 'route' })]),
    (error) => error instanceof ProviderResultError && error.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => resultFor('DIM-api-v1', [observation({ category: 'language' })]),
    (error) => error instanceof ProviderResultError && error.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => resultFor('DIM-stack-v1', [observation({ category: 'arbitrary' })]), ProviderResultError);
});

test('T210 base: duplicate observations and unknown/unsafe identities are rejected', () => {
  assert.throws(() => resultFor('DIM-stack-v1', [observation(), observation()]),
    (error) => error instanceof ProviderResultError && error.code === 'DUPLICATE_OBSERVATION');
  assert.throws(() => resultFor('DIM-stack-v1', [observation({ matchedKey: '../escape' })]), ProviderResultError);
  assert.throws(() => resultFor('DIM-stack-v1', [observation({ matchedKey: 'a b' })]), ProviderResultError);
  assert.throws(() => createProviderResult({ providerId: 'not-a-provider', dimensionId: 'DIM-stack-v1', observations: [] }),
    (error) => error instanceof ProviderResultError && error.code === 'INVALID_PROVIDER_ID');
  assert.throws(() => resultFor('DIM-structure-v1', []), ProviderResultError);
  assert.throws(() => resultFor('DIM-unknown-v1', []), ProviderResultError);
});

test('T210 base: paths are normalized repository-relative and source kinds are allowlisted', () => {
  for (const bad of ['/etc/passwd', 'C:/secret', '//server/share', '../secret', 'src/../x', 'src\\file']) {
    assert.throws(() => resultFor('DIM-stack-v1', [observation({ path: bad })]), ProviderResultError, bad);
  }
  assert.doesNotThrow(() => resultFor('DIM-stack-v1', [observation({ path: 'src/main.py' })]));
  assert.throws(() => resultFor('DIM-stack-v1', [observation({ sourceKind: 'not-a-kind' })]), ProviderResultError);
  for (const sourceKind of EVIDENCE_SOURCE_KINDS) {
    assert.doesNotThrow(() => resultFor('DIM-stack-v1', [observation({ sourceKind })]));
  }
});

test('T210 base: non-data details and unbounded inputs fail with typed safe errors', () => {
  for (const details of [{ run() {} }, /regex/u, new Map(), Promise.resolve()]) {
    assert.throws(() => resultFor('DIM-stack-v1', [observation({ details })]),
      (error) => error instanceof ProviderResultError && !error.message.includes('secret'));
  }
  const observations = Array.from({ length: PROVIDER_RESULT_LIMITS.observations + 1 }, (_, index) => (
    observation({ matchedKey: `key-${index}` })
  ));
  assert.throws(() => resultFor('DIM-stack-v1', observations),
    (error) => error instanceof ProviderResultError && error.code === 'ARRAY_LIMIT');
});

// ---------------------------------------------------------------------------
// base.mjs — deterministic merge rules
// ---------------------------------------------------------------------------

test('T210 base: merge places built-in first and appends plugin observations only', () => {
  const builtin = resultFor('DIM-stack-v1', [
    observation(),
    observation({ matchedKey: 'runtime:Node.js', category: 'runtime', details: { name: 'Node.js' } }),
  ]);
  const plugin = resultFor('DIM-stack-v1', [
    observation({ matchedKey: 'package-manager:pnpm', category: 'package_manager', details: { name: 'pnpm' } }),
  ]);
  const merged = mergeProviderResults({ builtin, plugin });
  assert.equal(merged.providerId, 'PRV-test-v1');
  assert.deepEqual(merged.observations.map(({ matchedKey }) => matchedKey), [
    'language', 'runtime:Node.js', 'package-manager:pnpm',
  ]);
  assert.equal(Object.isFrozen(merged), true);
  assert.throws(() => merged.observations.push(observation()), TypeError);
});

test('T210 base: exact duplicate plugin observations are dropped and never replace built-in findings', () => {
  const builtin = resultFor('DIM-stack-v1', [observation()]);
  const plugin = resultFor('DIM-stack-v1', [
    observation(),
    observation({ matchedKey: 'runtime:Deno', category: 'runtime', details: { name: 'Deno' } }),
  ]);
  const merged = mergeProviderResults({ builtin, plugin });
  assert.deepEqual(merged.observations.map(({ matchedKey }) => matchedKey), ['language', 'runtime:Deno']);
  assert.deepEqual(merged.observations[0].details, { id: 'x', label: 'X' });
});

test('T210 base: same-key different-detail plugin observations are appended after built-in (never replace)', () => {
  const builtin = resultFor('DIM-stack-v1', [observation({ details: { id: 'builtin' } })]);
  const plugin = resultFor('DIM-stack-v1', [observation({ details: { id: 'plugin' } })]);
  const merged = mergeProviderResults({ builtin, plugin });
  assert.equal(merged.observations.length, 2);
  assert.deepEqual(merged.observations[0].details, { id: 'builtin' });
  assert.deepEqual(merged.observations[1].details, { id: 'plugin' });
});

test('T210 base: merge rejects dimension mismatch and revalidates categories', () => {
  const builtin = resultFor('DIM-stack-v1', [observation()]);
  const other = resultFor('DIM-api-v1', [observation({ category: 'route' })]);
  assert.throws(() => mergeProviderResults({ builtin, plugin: other }),
    (error) => error instanceof ProviderResultError && error.code === 'DIMENSION_MISMATCH');
  const bareBuiltin = resultFor('DIM-stack-v1', [observation()]);
  assert.deepEqual(mergeProviderResults({ builtin: bareBuiltin }), bareBuiltin);
  assert.equal(mergeProviderResults({ builtin: bareBuiltin, plugin: null }), bareBuiltin);
});

// ---------------------------------------------------------------------------
// rules.mjs — pure declarative evaluation
// ---------------------------------------------------------------------------

function rule(overrides) {
  return {
    id: 'RUL-test-v1',
    label: 'Test artifact',
    dimensionId: 'DIM-api-v1',
    category: 'route',
    extensions: [],
    basenames: [],
    manifestNames: [],
    artifactTokens: [],
    literal: null,
    regexSource: null,
    ...overrides,
  };
}

test('T210 rules: limits snapshot is exact and frozen', () => {
  assert.deepEqual(RULE_EVALUATION_LIMITS, {
    contentBytes: 65_536,
    maxArtifacts: 4096,
    maxMatches: 2048,
    maxMatchesPerRule: 128,
    maxRules: 256,
    regexSource: 128,
    selectorEntries: 64,
  });
  assert.equal(Object.isFrozen(RULE_EVALUATION_LIMITS), true);
});

test('T210 rules: artifact metadata is normalized and bounded, with no path escape', () => {
  const artifact = validateArtifactMetadata({ path: 'config/zeta/main.zeta', size: 2048, content: 'route: /users' });
  assert.deepEqual(artifact, {
    path: 'config/zeta/main.zeta',
    size: 2048,
    content: 'route: /users',
    basename: 'main.zeta',
    directory: 'config/zeta',
    extension: '.zeta',
  });
  assert.equal(Object.isFrozen(artifact), true);
  for (const bad of ['/abs', '../x', 'a/../../b', 'C:/x', 'src\\x', 'a//b']) {
    assert.throws(() => validateArtifactMetadata({ path: bad, size: 0, content: '' }), RuleEvaluationError, bad);
  }
  assert.throws(() => validateArtifactMetadata({ path: 'x', size: -1, content: '' }), RuleEvaluationError);
  assert.throws(() => validateArtifactMetadata({ path: 'x', size: 1.5, content: '' }), RuleEvaluationError);
  const capped = validateArtifactMetadata({
    path: 'x.txt', size: 1, content: 'z'.repeat(RULE_EVALUATION_LIMITS.contentBytes + 10),
  });
  assert.equal(capped.content.length, RULE_EVALUATION_LIMITS.contentBytes);
});

test('T210 rules: every selector matches its artifact positively', () => {
  const artifact = { path: 'config/zeta/main.zeta', size: 10, content: 'runtime: 3.1 (zeta)\n' };
  assert.equal(evaluateRule(rule({ extensions: ['.ZETA'] }), artifact), true, 'extensions');
  assert.equal(evaluateRule(rule({ extensions: ['.zeta'] }), artifact), true, 'extensions lowercase');
  const named = { path: 'config/zeta/Zetafile', size: 10, content: 'runtime: 3.1 (zeta)\n' };
  assert.equal(evaluateRule(rule({ basenames: ['Zetafile'] }), named), true, 'basenames');
  assert.equal(evaluateRule(rule({ manifestNames: ['Zetafile'] }), named), true, 'manifestNames');
  assert.equal(evaluateRule(rule({ artifactTokens: ['config/zeta'] }), named), true, 'artifactTokens');
  assert.equal(evaluateRule(rule({ artifactTokens: ['config'] }), named), true, 'artifactTokens dir prefix');
  assert.equal(evaluateRule(rule({ literal: 'runtime: 3.1' }), named), true, 'literal');
  assert.equal(evaluateRule(rule({ regexSource: '^runtime:[ ]+[0-9.]+' }), named), true, 'regexSource');
});

test('T210 rules: negative cases do not match', () => {
  const artifact = { path: 'src/main.zeta', size: 10, content: 'ordinary text' };
  assert.equal(evaluateRule(rule({ extensions: ['.zeta'], basenames: ['Other'] }), artifact), true);
  assert.equal(evaluateRule(rule({ extensions: ['.zzz'] }), artifact), false);
  assert.equal(evaluateRule(rule({ basenames: ['main.py'] }), artifact), false);
  assert.equal(evaluateRule(rule({ extensions: ['.py'] }), artifact), false, 'no selector matches');
  assert.equal(evaluateRule(rule({ artifactTokens: ['src2'] }), artifact), false);
  assert.equal(evaluateRule(rule({ artifactTokens: ['srcother'] }), artifact), false, 'no loose prefix escape');
  assert.equal(evaluateRule(rule({ artifactTokens: ['src/main.zeta'] }), artifact), true);
  assert.equal(evaluateRule(rule({ literal: 'absent' }), artifact), false);
  assert.equal(evaluateRule(rule({ regexSource: '^[0-9]+$' }), artifact), false);
});

test('T210 rules: selectors are OR alternatives within one rule', () => {
  const artifact = { path: 'root/Zetafile', size: 4, content: '' };
  const multi = rule({
    extensions: ['.zeta'],
    basenames: ['Zetafile'],
    manifestNames: ['zeta.json'],
    artifactTokens: ['config/zeta'],
  });
  assert.equal(evaluateRule(multi, artifact), true);
  assert.equal(evaluateRule(rule({ extensions: ['.zeta'], basenames: ['Other'], literal: 'x' }), artifact), false);
});

test('T210 rules: artifact tokens match only at directory boundaries (no path escape)', () => {
  const artifact = { path: 'src/zed/main.zeta', size: 1, content: '' };
  assert.equal(evaluateRule(rule({ artifactTokens: ['src/zed'] }), artifact), true);
  assert.equal(evaluateRule(rule({ artifactTokens: ['src'] }), artifact), true);
  assert.equal(evaluateRule(rule({ artifactTokens: ['src/ze'] }), artifact), false);
  assert.equal(evaluateRule(rule({ artifactTokens: ['../src'] }), artifact), false);
});

test('T210 rules: malformed rules are rejected with typed errors and the fixed regex policy applies', () => {
  assert.throws(() => validateRuleForEvaluation(rule({ literal: 'a', regexSource: 'a' })),
    (error) => error instanceof RuleEvaluationError && error.code === 'INVALID_MATCH');
  assert.throws(() => validateRuleForEvaluation(rule({})), RuleEvaluationError);
  assert.throws(() => validateRuleForEvaluation({ id: 'x' }), RuleEvaluationError);
  assert.throws(() => validateRuleForEvaluation(rule({ unknown: true })), RuleEvaluationError);
  assert.throws(() => validateRuleForEvaluation(rule({ run: 'module.mjs' })), RuleEvaluationError);
  assert.throws(() => validateRuleForEvaluation(rule({ regexSource: '(a+)+b' })),
    (error) => error instanceof RuleEvaluationError && error.code === 'REGEX_COMPLEXITY');
  const safe = rule({ regexSource: '^route[ ]+[A-Za-z0-9._-]+$' });
  assert.equal(validateRuleForEvaluation(safe).regexSource, '^route[ ]+[A-Za-z0-9._-]+$');
});

test('T210 rules: unvalidated catastrophic regex sources fail at evaluation before compilation', () => {
  const artifact = { path: 'x.zeta', size: 5, content: 'aaaaab' };
  for (const source of ['(a+)+b', '(a*)*x', '(a|aa)+b', 'a*a*b']) {
    assert.throws(() => evaluateRule(rule({ regexSource: source }), artifact),
      (error) => error instanceof RuleEvaluationError && error.code === 'REGEX_COMPLEXITY', source);
    assert.throws(() => evaluateRules({ rules: [rule({ regexSource: source })], artifacts: [artifact] }),
      (error) => error instanceof RuleEvaluationError && error.code === 'REGEX_COMPLEXITY', source);
  }
  for (const source of ['a*b*c*', '^[A-Za-z0-9._-]+$']) {
    assert.equal(evaluateRule(rule({ regexSource: source }), artifact), true, source);
    const evaluated = evaluateRules({ rules: [rule({ regexSource: source })], artifacts: [artifact] });
    assert.equal(evaluated.matches.length, 1, source);
  }
});

test('T210 rules: evaluation is bounded and deterministic with typed caps', () => {
  const rules = [rule({ extensions: ['.x'] }), rule({ id: 'RUL-two-v1', extensions: ['.x'] })];
  const artifacts = Array.from({ length: 100 }, (_, index) => ({ path: `a/${index}.x`, size: 1, content: '' }));
  const first = evaluateRules({ rules, artifacts });
  const second = evaluateRules({ rules: [...rules].toReversed(), artifacts: [...artifacts].toReversed() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first.matches), true);
  assert.equal(first.capped, false);
  assert.equal(first.matches.length, 200);
  assert.deepEqual(first.matches[0], {
    ruleId: 'RUL-test-v1', label: 'Test artifact', dimensionId: 'DIM-api-v1',
    category: 'route', path: 'a/0.x',
  });

  const flood = [rule({ extensions: ['.x'] })];
  const floodArtifacts = Array.from({ length: 300 }, (_, index) => ({ path: `f/${index}.x`, size: 1, content: '' }));
  const capped = evaluateRules({ rules: flood, artifacts: floodArtifacts });
  assert.equal(capped.capped, true);
  assert.ok(capped.matches.length <= RULE_EVALUATION_LIMITS.maxMatchesPerRule);
  const empty = evaluateRules({ rules: flood, artifacts: [] });
  assert.equal(empty.matches.length, 0);
  assert.equal(empty.capped, false);
  const tooManyRules = Array.from({ length: RULE_EVALUATION_LIMITS.maxRules + 1 }, (_, index) => (
    rule({ id: `RUL-${index}-v1`, extensions: ['.x'] })
  ));
  assert.throws(() => evaluateRules({ rules: tooManyRules, artifacts: floodArtifacts }), RuleEvaluationError);
});

test('T210 rules: matches never include matched content (privacy)', () => {
  const secret = 'ghp_\x73ecret-token-abcdefghijklmnopqrstuvwxyz012345';
  const artifact = { path: 'cfg/secret.zeta', size: secret.length, content: `token=${secret}` };
  const matches = evaluateRules({ rules: [rule({ literal: secret })], artifacts: [artifact] });
  assert.equal(matches.matches.length, 1);
  assert.equal(matches.matches[0].path, 'cfg/secret.zeta');
  assert.equal(JSON.stringify(matches).includes(secret), false);
});

test('T210 rules: regexes compile only from fixed-u policy-validated sources at evaluate time', () => {
  const artifact = { path: 'x.zeta', size: 3, content: 'A1 B2' };
  assert.equal(evaluateRule(rule({ regexSource: '[A-Za-z]+[0-9]' }), artifact), true);
  assert.equal(evaluateRule(rule({ regexSource: '^[A-Za-z][0-9]$' }), { ...artifact, content: 'A1' }), true);
  assert.equal(evaluateRule(rule({ regexSource: '^[A-Za-z0-9._-]+$' }), { ...artifact, content: 'A1' }), true);
  assert.throws(() => evaluateRule(rule({ regexSource: '\\p{L}+\\d' }), artifact),
    (error) => error instanceof RuleEvaluationError && error.code === 'REGEX_COMPLEXITY');
});

// ---------------------------------------------------------------------------
// generic.mjs — artifact-only fallback
// ---------------------------------------------------------------------------

test('T210 generic: activation requires an unknown language and no known ecosystem', () => {
  assert.equal(isUnknownLanguageEcosystem({ languages: ['Zeta'], ecosystems: [] }), true);
  assert.equal(isUnknownLanguageEcosystem({ languages: ['Zeta'], ecosystems: ['rust'] }), false);
  assert.equal(isUnknownLanguageEcosystem({ languages: ['Zeta'], manifestEcosystems: ['python'] }), false);
  assert.equal(isUnknownLanguageEcosystem({ languages: ['JavaScript'] }), false);
  assert.equal(isUnknownLanguageEcosystem({ languages: ['Shell', 'Bash'] }), false);
  assert.equal(isUnknownLanguageEcosystem({ languages: [] }), false);
  assert.equal(isUnknownLanguageEcosystem({}), false);
});

test('T210 generic: unknown-language fixture gets only metadata/path observations', () => {
  const files = [
    { path: 'src/main.zzz', size: 1200 },
    { path: 'src/util.zzz', size: 400 },
    { path: 'README.md', size: 80 },
    { path: 'Cargo.lock', size: 300 },
    { path: 'zzz.config', size: 10 },
  ];
  const { results } = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  assert.ok(results.length > 0);
  assert.ok(results.every(({ providerId }) => providerId === GENERIC_PROVIDER_ID));
  const allowedCategories = new Set(['file_metric', 'measurement_universe', 'manifest', 'lock', 'readme', 'license', 'contributing']);
  for (const result of results) {
    for (const { category, details } of result.observations) {
      assert.ok(allowedCategories.has(category), `unexpected generic category ${category}`);
      assert.ok(Object.keys(details).every((key) => [
        'extension', 'count', 'bytes', 'filesInspected', 'bytesInspected', 'directoryCount', 'name',
      ].includes(key)), `unexpected generic detail field ${JSON.stringify(details)}`);
    }
  }
});

test('T210 generic: no import, runtime, source-syntax, or first-class-depth claims', () => {
  const files = ['src/main.zzz', 'README.md', 'Cargo.lock', 'package-lock.json'];
  const { results } = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  const serialized = JSON.stringify(results);
  for (const forbidden of [
    'import', 'importEdge', 'runtime', 'sourceSyntax', 'firstClass', 'moduleSystem',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `generic claimed forbidden ${forbidden}`);
  }
  const categories = results.flatMap(({ observations }) => observations.map(({ category }) => category));
  assert.ok(!categories.includes('language'));
  assert.ok(!categories.includes('runtime'));
  assert.ok(!categories.includes('framework'));
  assert.ok(!categories.includes('import_edge'));
  assert.ok(!categories.includes('module'));
});

test('T210 generic: metadata observations reflect path, extension, size, and directory', () => {
  const { results } = genericProviderResults({
    languages: ['Zeta'],
    ecosystems: [],
    files: [
      { path: 'src/a.zzz', size: 100 },
      { path: 'src/b.zzz', size: 300 },
      { path: 'docs/guide.md', size: 50 },
    ],
  });
  const maintainability = results.find(({ dimensionId }) => dimensionId === 'DIM-maintainability-v1');
  const metrics = maintainability.observations.filter(({ category }) => category === 'file_metric');
  assert.deepEqual(metrics, [
    {
      category: 'file_metric', path: null, matchedKey: 'file-metric:.md',
      details: { extension: '.md', count: 1, bytes: 50 }, sourceKind: 'file_metadata',
    },
    {
      category: 'file_metric', path: null, matchedKey: 'file-metric:.zzz',
      details: { extension: '.zzz', count: 2, bytes: 400 }, sourceKind: 'file_metadata',
    },
  ]);
  const universe = maintainability.observations.find(({ matchedKey }) => matchedKey === 'measurement-universe');
  assert.deepEqual(universe.details, { filesInspected: 3, bytesInspected: 450, directoryCount: 2 });
});

test('T210 generic: manifest, lockfile, and known doc artifact observations carry paths', () => {
  const { results } = genericProviderResults({
    languages: ['Zeta'],
    ecosystems: [],
    files: ['Cargo.lock', 'pyproject.toml', 'README.md', 'LICENSE', 'src/main.zzz'],
  });
  const assurance = results.find(({ dimensionId }) => dimensionId === 'DIM-assurance-v1');
  assert.ok(assurance);
  const manifests = assurance.observations.filter(({ category }) => category === 'manifest');
  const locks = assurance.observations.filter(({ category }) => category === 'lock');
  assert.deepEqual(manifests.map(({ path, details }) => [path, details.name]), [['pyproject.toml', 'pyproject.toml']]);
  assert.deepEqual(locks.map(({ path, details }) => [path, details.name]), [['Cargo.lock', 'Cargo.lock']]);
  const docs = results.find(({ dimensionId }) => dimensionId === 'DIM-documentation-v1');
  assert.deepEqual(docs.observations.map(({ category, path }) => [category, path]).toSorted(), [
    ['license', 'LICENSE'],
    ['readme', 'README.md'],
  ]);
});

test('T210 generic: does not fire for the five built-in ecosystems and empty input', () => {
  for (const languages of [['JavaScript'], ['Python', 'Rust'], ['Shell']]) {
    assert.deepEqual(genericProviderResults({ languages, ecosystems: [], files: ['src/a.js'] }),
      { results: [], capped: false });
  }
  assert.deepEqual(genericProviderResults({ languages: ['Zeta'], files: [] }), { results: [], capped: false });
  assert.deepEqual(genericProviderResults({}), { results: [], capped: false });
});

test('T210 generic: deterministic and immutable envelope results; typed input errors', () => {
  const files = ['src/main.zzz', 'README.md'];
  const first = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  const second = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files: [...files].toReversed() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.capped, false);
  assert.ok(first.results.every(({ observations }) => Object.isFrozen(observations)));
  assert.equal(Object.isFrozen(first), true);
  for (const bad of [['/etc/passwd'], ['../x'], ['a/../../b'], ['C:/x']]) {
    assert.throws(() => genericProviderResults({ languages: ['Zeta'], files: bad }),
      (error) => error instanceof GenericProviderError && error.code === 'INVALID_PATH');
  }
});

test('T210 generic: long-extension file_metric matchedKeys stay bounded with the full extension disclosed', () => {
  const extension = `.${'x'.repeat(200)}`;
  const files = [{ path: `src/main${extension}`, size: 7 }];
  const { results, capped } = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  assert.equal(capped, false);
  const maintainability = results.find(({ dimensionId }) => dimensionId === 'DIM-maintainability-v1');
  assert.ok(maintainability, 'maintainability result is present');
  const metric = maintainability.observations.find(({ category }) => category === 'file_metric');
  assert.ok(metric, 'long-extension file_metric survives assembly');
  assert.ok(metric.matchedKey.length <= GENERIC_LIMITS.matchedKey, 'file-metric matchedKey is bounded');
  assert.ok(metric.matchedKey.startsWith('file-metric:'), 'file-metric matchedKey keeps its prefix');
  assert.equal(
    metric.matchedKey,
    `file-metric:${extension}`.slice(0, GENERIC_LIMITS.matchedKey),
    'file-metric matchedKey embeds a deterministically truncated extension',
  );
  assert.equal(metric.details.extension, extension, 'full extension stays in details (truncation disclosure)');
  assert.equal(metric.details.count, 1);
  assert.equal(metric.details.bytes, 7);
  const second = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files: [...files].toReversed() });
  assert.equal(JSON.stringify({ results, capped }), JSON.stringify(second), 'long-extension assembly is deterministic');
});

test('T210 generic: caps file_metric observations at the declared bound with a disclosed flag', () => {
  const extensions = Array.from(
    { length: GENERIC_LIMITS.maxObservations + 1 },
    (_, index) => `ext${String(index).padStart(6, '0')}`,
  );
  const files = extensions.map((extension, index) => ({
    path: `src/file-${index}.${extension}`,
    size: index + 1,
  }));
  const { results, capped } = genericProviderResults({ languages: ['Zeta'], ecosystems: [], files });
  assert.equal(capped, true);
  const maintainability = results.find(({ dimensionId }) => dimensionId === 'DIM-maintainability-v1');
  assert.ok(maintainability, 'maintainability result is present');
  assert.equal(maintainability.observations.length, GENERIC_LIMITS.maxObservations);
  assert.ok(maintainability.observations.every(({ category }) => (
    category === 'file_metric' || category === 'measurement_universe'
  )));
  assert.deepEqual(
    maintainability.observations.map(({ matchedKey }) => matchedKey).slice(0, 2),
    ['file-metric:.ext000000', 'file-metric:.ext000001'],
  );
  assert.equal(
    maintainability.observations.some(({ matchedKey }) => matchedKey === 'measurement-universe'),
    true,
  );
  assert.equal(Object.isFrozen(results), true);
  const second = genericProviderResults({
    languages: ['Zeta'], ecosystems: [], files: [...files].toReversed(),
  });
  assert.equal(JSON.stringify({ results, capped }), JSON.stringify(second));
  assert.equal(second.capped, true);
});
// ---------------------------------------------------------------------------
// Built-in parity — ecosystem descriptor adapter
// ---------------------------------------------------------------------------

const ECOSYSTEM_IDS = Object.keys(DESCRIPTORS);

test('T210 parity: ecosystem adapter matches descriptor data for all five ecosystems', () => {
  for (const id of ECOSYSTEM_IDS) {
    const descriptor = DESCRIPTORS[id];
    const results = descriptorProviderResults(id);
    assert.ok(results.length > 0, `${id} provider results`);
    assert.ok(results.every(({ providerId }) => providerId === `PRV-${id}-builtin-v1`), id);
    const byDimension = new Map(results.map(({ dimensionId, observations }) => [dimensionId, observations]));

    const stack = byDimension.get('DIM-stack-v1');
    const language = stack.find(({ category }) => category === 'language');
    assert.deepEqual(language.details, { id: descriptor.id, label: descriptor.label }, `${id} language`);
    assert.deepEqual(
      stack.filter(({ category }) => category === 'runtime').map(({ details }) => details.name).toSorted(),
      descriptor.runtimes.map(({ name }) => name).toSorted(),
      `${id} runtimes`,
    );
    assert.deepEqual(
      stack.filter(({ category }) => category === 'package_manager').map(({ details }) => details.name).toSorted(),
      [...descriptor.packageManagers].toSorted(),
      `${id} packageManagers`,
    );

    const config = byDimension.get('DIM-config-v1') ?? [];
    assert.deepEqual(
      config.filter(({ category }) => category === 'lint').map(({ details }) => details.name).toSorted(),
      descriptor.linters.map(({ name }) => name).toSorted(),
      `${id} linters`,
    );
    assert.deepEqual(
      config.filter(({ category }) => category === 'format').map(({ details }) => details.name).toSorted(),
      descriptor.formatters.map(({ name }) => name).toSorted(),
      `${id} formatters`,
    );

    const testing = byDimension.get('DIM-testing-v1') ?? [];
    assert.deepEqual(
      testing.filter(({ category }) => category === 'framework').map(({ details }) => details.name).toSorted(),
      Object.values(descriptor.testFrameworks).toSorted(),
      `${id} testFrameworks`,
    );

    const assurance = byDimension.get('DIM-assurance-v1') ?? [];
    assert.deepEqual(
      assurance.filter(({ category }) => category === 'manifest').map(({ details }) => details.name).toSorted(),
      [...descriptor.manifests].toSorted(),
      `${id} manifests`,
    );
    assert.deepEqual(
      assurance.filter(({ category }) => category === 'lock').map(({ details }) => details.name).toSorted(),
      [...descriptor.lockfiles].toSorted(),
      `${id} lockfiles`,
    );
  }
});

test('T210 parity: ecosystem adapter is deterministic, immutable, and rejects unknown ids', () => {
  const first = descriptorProviderResults('python');
  const second = descriptorProviderResults('python');
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.every(({ observations }) => Object.isFrozen(observations)));
  assert.deepEqual(descriptorProviderResults('go'), []);
  assert.deepEqual(descriptorObservations('unknown'), []);
  assert.deepEqual(descriptorProviderResults(''), []);
});

// ---------------------------------------------------------------------------
// Built-in parity — manifest adapter
// ---------------------------------------------------------------------------

test('T210 parity: manifest adapter matches normalized manifest fields', () => {
  const python = manifestObservations({ ecosystems: ['python'], requiresPython: '>=3.12' });
  assert.deepEqual(python, [{
    dimensionId: 'DIM-stack-v1',
    observations: [
      {
        category: 'language', path: null, matchedKey: 'language:python',
        details: { name: 'python', label: 'Python' }, sourceKind: 'manifest',
      },
      {
        category: 'runtime', path: null, matchedKey: 'runtime:Python',
        details: { name: 'Python', declared: '>=3.12' }, sourceKind: 'manifest',
      },
    ],
  }]);

  const js = manifestObservations({ ecosystems: ['typescript'], nodeVersion: '>=18.0.0' });
  const jsRuntimes = js[0].observations.filter(({ category }) => category === 'runtime');
  assert.deepEqual(jsRuntimes, [{
    category: 'runtime', path: null, matchedKey: 'runtime:Node.js',
    details: { name: 'Node.js', declared: '>=18.0.0' }, sourceKind: 'manifest',
  }]);

  const rust = manifestObservations({ ecosystems: ['rust'], rustVersion: '1.75' });
  assert.deepEqual(rust[0].observations.filter(({ category }) => category === 'runtime')[0].details, {
    name: 'Rust', declared: '1.75',
  });

  assert.deepEqual(manifestObservations({}), []);
  assert.deepEqual(manifestObservations(null), []);
});

test('T210 parity: manifest adapter results are immutable and deterministic', () => {
  const manifest = { ecosystems: ['python', 'rust'], requiresPython: '>=3.12', rustVersion: '1.75' };
  const first = manifestProviderResult(manifest);
  const second = manifestProviderResult({ ...manifest });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.every(({ observations }) => Object.isFrozen(observations)));
  assert.deepEqual(first.map(({ providerId }) => providerId), ['PRV-manifest-v1']);
});

test('T210 parity: readManifest output is byte-identical to the shared reader contract', () => {
  const normalized = {
    ecosystems: ['typescript'],
    name: 'demo-pkg',
    version: '2.0.0',
    description: 'a TS demo',
    buildBackend: null,
    requiresPython: null,
    dependencies: { express: '^4.18.0' },
    devDependencies: { typescript: '^5.4.0', '@types/node': '^20.0.0' },
    optionalDeps: {},
    entrypoints: ['demo-pkg=dist/cli.js'],
    sourceLayout: null,
    main: null,
    module: null,
    exports: null,
    imports: null,
    engines: null,
    peerDependencies: {},
    workspaces: null,
    nodeVersion: null,
    buildDependencies: {},
    edition: null,
    rustVersion: null,
    features: {},
    lib: null,
    crateType: null,
    workspace: null,
  };
  const observations = manifestObservations(normalized);
  assert.deepEqual(
    observations[0].observations.map(({ matchedKey, details }) => [matchedKey, details]),
    [['language:typescript', { name: 'typescript', label: 'TypeScript' }]],
  );
});

// ---------------------------------------------------------------------------
// Built-in parity — detection adapter
// ---------------------------------------------------------------------------

test('T210 parity: detection adapter matches matchDep results for each supported category', () => {
  const deps = ['sqlx', 'tokio', 'argon2', 'tracing', 'cargo-audit'];
  const groups = detectionObservations({ ecosystem: 'rust', deps });
  const flat = groups.flatMap(({ observations }) => observations);
  const store = flat.find(({ category }) => category === 'store');
  assert.deepEqual(store.details, { name: 'sqlx', label: 'SQLx', type: 'Driver/ORM' });
  assert.equal(store.matchedKey, 'store:sqlx');
  const monitoring = flat.find(({ category }) => category === 'monitoring');
  assert.deepEqual(monitoring.details, { name: 'tracing', label: 'tracing', type: 'Logging/Tracing' });
  const authentication = flat.find(({ category }) => category === 'authentication');
  assert.deepEqual(authentication.details, { name: 'argon2', label: 'argon2', type: 'Hashing' });
  const securityTool = flat.find(({ category }) => category === 'security_tool');
  assert.deepEqual(securityTool.details, { name: 'cargo-audit', label: 'cargo-audit', type: 'Dependency audit' });

  const expected = matchDep(['sqlx'], DATABASE_INDICATORS.rust);
  assert.equal(store.details.name, expected[0].name);
  assert.equal(store.details.label, expected[0].label);
});

test('T210 parity: detection adapter emits only allowlisted provider categories', () => {
  const groups = detectionObservations({ ecosystem: 'javascript', deps: ['express-rate-limit', 'zod', 'winston', 'axios', 'prisma'] });
  const categories = groups.flatMap(({ observations }) => observations.map(({ category }) => category));
  assert.ok(!categories.includes('rate_limit'), 'rate-limit is not a provider category');
  assert.ok(!categories.includes('external_api'), 'external-api is not a provider category');
  assert.ok(categories.includes('validation'), 'zod -> validation');
  assert.ok(categories.includes('monitoring'), 'winston -> monitoring');
  assert.ok(categories.includes('store'), 'prisma -> store');
  assert.ok(!categories.includes('route'), 'axios is an HTTP client, not a route');
});

test('T210 parity: detection adapter is deterministic, immutable, and empty for unknown input', () => {
  const deps = ['sqlx', 'argon2'];
  const first = detectionObservations({ ecosystem: 'rust', deps });
  const second = detectionObservations({ ecosystem: 'rust', deps: [...deps].toReversed() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.every(({ observations }) => Object.isFrozen(observations)));
  assert.deepEqual(detectionObservations({ ecosystem: 'go', deps: ['sqlx'] }), []);
  assert.deepEqual(detectionObservations({ ecosystem: 'rust', deps: [] }), []);
  assert.deepEqual(detectionObservations({}), []);
  assert.deepEqual(detectionProviderResult({ ecosystem: 'go', deps: ['x'] }), []);
});

test('T210 parity: detection results reuse provider foundation immutably', () => {
  const results = detectionProviderResult({ ecosystem: 'rust', deps: ['sqlx'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, 'PRV-detection-rust-v1');
  assert.equal(Object.isFrozen(results[0]), true);
});

// ---------------------------------------------------------------------------
// Built-in parity — comments adapter
// ---------------------------------------------------------------------------

test('T210 parity: comment adapter matches countComments byte-for-byte for every ecosystem', () => {
  for (const ecosystem of ECOSYSTEM_IDS) {
    const marker = ecosystem === 'python' || ecosystem === 'shell' ? '#' : '//';
    const text = [`${marker} comment`, 'x = 1', '', 'y = 2'].join('\n');
    const counted = countComments(text, ecosystem);
    const [{ observations }] = commentObservations({ ecosystem, text });
    assert.equal(observations.length, 1);
    assert.equal(observations[0].category, 'comment');
    assert.deepEqual(observations[0].details, counted, ecosystem);
  }
});

test('T210 parity: comment adapter is deterministic, immutable, and path-aware', () => {
  const text = '// line\n/* block */\nx = 1';
  const first = commentProviderResult({ ecosystem: 'javascript', text, path: 'src/index.js' });
  const second = commentProviderResult({ ecosystem: 'javascript', text: '// line\n/* block */\nx = 1', path: 'src/index.js' });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first[0].providerId, 'PRV-comments-javascript-v1');
  assert.equal(first[0].dimensionId, 'DIM-conventions-v1');
  assert.equal(first[0].observations[0].matchedKey, 'comment:src/index.js');
  assert.equal(Object.isFrozen(first[0]), true);
  assert.throws(() => { first[0].observations[0].details.commentLines = 99; }, TypeError);
  const repoLevel = commentObservations({ ecosystem: 'shell', text: '# hi' });
  assert.equal(repoLevel[0].observations[0].matchedKey, 'comment:repository');
});

// ---------------------------------------------------------------------------
// Inertness — providers are unregistered and consumed only by the adapters
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
  await visit(join(LIB_ROOT, 'scan'));
  return files.toSorted();
}

function relativeImportTargets(source) {
  const targets = [];
  const pattern = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

test('T210 inert: only the four shared contribution points import provider modules in production', async () => {
  const providersRoot = join(LIB_ROOT, 'scan', 'providers');
  const consumers = [];
  for (const file of await libScanFiles()) {
    const source = await readFile(file, 'utf8');
    const resolved = relativeImportTargets(source).map((target) => join(dirname(file), target));
    if (resolved.some((path) => path === providersRoot || path.startsWith(`${providersRoot}${sep}`))) {
      consumers.push(file.replace(/\\/g, '/').split('/lib/scan/')[1]);
    }
  }
  const allowed = [
    'pipeline/run.mjs',
    'shared/comments.mjs',
    'shared/detection.mjs',
    'shared/ecosystem.mjs',
    'shared/manifest.mjs',
  ];
  for (const consumer of consumers) {
    const inProviders = consumer.startsWith('providers/');
    assert.ok(inProviders || allowed.includes(consumer),
      `unexpected provider consumer outside the adapters: ${consumer}`);
  }
  for (const adapter of allowed) {
    assert.ok(consumers.includes(adapter), `expected ${adapter} to expose a provider contribution point`);
  }
});

test('T210 inert: provider modules export only pure factories, never scan/run/execute entry points', async () => {
  for (const [path, names] of [
    ['providers/base.mjs', ['createProviderResult', 'mergeProviderResults']],
    ['providers/rules.mjs', ['validateArtifactMetadata', 'validateRuleForEvaluation', 'evaluateRule', 'evaluateRules']],
    ['providers/generic.mjs', ['genericProviderResults', 'isUnknownLanguageEcosystem']],
  ]) {
    const source = await readFile(join(LIB_ROOT, 'scan', path), 'utf8');
    for (const name of names) {
      assert.ok(new RegExp(`export\\s+(?:function|const)\\s+${name}\\b`).test(source), `${path} exports ${name}`);
    }
    for (const forbidden of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
      assert.equal(source.includes(forbidden), false, `${path} must not expose execution surfaces`);
    }
  }
});
