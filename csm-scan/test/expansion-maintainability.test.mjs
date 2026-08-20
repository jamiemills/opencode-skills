// T214 Maintainability dimension — focused test suite.
//
// Covers the lexical tokenizer, exact 50-token duplicate detection, the
// deterministic privacy-safe model, the generated/vendor boundary and
// declared-tool detectors, the T210-compatible provider, the inert renderer,
// and the end-to-end scanner. Includes hand-calculated branch metrics, exact
// duplicate spans, generated/vendor exclusions, caps, partial-coverage
// wording, privacy canaries, and neutral-voice checks.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { PROVIDER_CATEGORIES } from '../lib/scan/contracts/provider.mjs';
import { EVIDENCE_SOURCE_KINDS } from '../lib/scan/contracts/evidence.mjs';
import {
  BRANCH_CATEGORIES,
  DIALECTS,
  DIALECT_EXTENSIONS,
  DIALECT_BRANCH_KEYWORDS,
  DIALECT_BOOLEAN_OPERATORS,
  MAX_TOKENS_PER_FILE,
  countBranchPoints,
  countFunctionComplexity,
  detectFunctionScopes,
  dialectForPath,
  tokenize,
} from '../lib/scan/deep/maintainability/tokenizer.mjs';
import { DUPLICATE_WINDOW, findDuplicateGroups } from '../lib/scan/deep/maintainability/duplicates.mjs';
import {
  DEAD_CODE_KINDS,
  MAINTAINABILITY_DIMENSION_ID,
  MAINTAINABILITY_LIMITS,
  NO_EXTENSION_LABEL,
  OTHER_EXTENSION_LABEL,
  MaintainabilityModelError,
  SIZE_BUCKETS,
  buildMaintainabilityModel,
  complexityDistribution,
  detectDeadCodeConfigSignals,
  detectDeadCodeSourceSignals,
  detectGeneratedBoundary,
  detectToolEvidence,
  isValidExcludedExtension,
  sizeBucketFor,
} from '../lib/scan/deep/maintainability/model.mjs';
import { scan } from '../lib/scan/deep/maintainability/scanner.mjs';
import {
  MAINTAINABILITY_PROVIDER_ID,
  maintainabilityObservations,
  maintainabilityProviderResults,
} from '../lib/scan/providers/maintainability.mjs';
import {
  createMaintainabilityRenderer,
  renderMaintainability,
} from '../lib/scan/render/maintainability.mjs';
import { createRenderContext } from '../lib/scan/render/base.mjs';
import { EXISTING_TEN_RENDERER_MAP } from '../lib/scan/render/existing-ten.mjs';
import { withFixture } from './harness.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

const SEARCH_OK = Object.freeze({
  supported: true,
  readable: true,
  complete: true,
  capped: false,
  error: false,
  malformed: false,
  ambiguous: false,
  filesInspected: 2,
  fileLimit: 256,
  bytesInspected: 120,
  byteLimit: MAINTAINABILITY_LIMITS.maxBytes,
  recordsInspected: 2,
  recordLimit: MAINTAINABILITY_LIMITS.maxRecords,
  omittedCount: 0,
});

const ZERO_COUNTS = Object.fromEntries(BRANCH_CATEGORIES.map((category) => [category, 0]));

const BANNED_VOICE = Object.freeze([
  'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'recommendation', 'ideally',
  'unfortunately', 'concern', 'concerning', 'problem', 'anti-pattern', 'smell',
  'suboptimal', 'inadequate', 'insufficient', 'contradiction', 'inconsistent',
  'inconsistency', 'conflict', 'lacking',
]);

function findVoiceHits(markdown) {
  const pattern = new RegExp(`\\b(?:${BANNED_VOICE.join('|')})\\b`, 'gi');
  const prose = markdown.replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
  return [...prose.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

function tokenStream(count, lineStart = 1, prefix = 'v') {
  return Array.from({ length: count }, (_, index) => ({
    value: `${prefix}${index}`,
    line: lineStart + index,
  }));
}

function sampleFiles() {
  return [{
    path: 'src/a.js',
    dialect: 'javascript',
    bytes: 120,
    lines: 10,
    tokens: 55,
    sizeBucket: 'lt_1k',
  }];
}

function sampleBranchPoints() {
  return [{
    path: 'src/a.js',
    dialect: 'javascript',
    tokens: 55,
    counts: { if: 3, else: 1, switch: 0, case: 0, match: 0, ternary: 1, loop: 2, guard: 0 },
    capped: false,
  }];
}

function modelInput(overrides = {}) {
  return {
    files: sampleFiles(),
    branchPoints: sampleBranchPoints(),
    duplicateGroups: [],
    duplicateCaps: {},
    generatedBoundaries: [],
    toolEvidence: [],
    measurement: {
      filesInspected: 2,
      bytesInspected: 120,
      recordsInspected: 2,
      eligibleFiles: 1,
      measuredFiles: 1,
      omittedCount: 0,
      excludedLanguages: [],
      configFilesInspected: 0,
    },
    sizeDistribution: [{ bucket: 'lt_1k', count: 1 }],
    diagnostics: [],
    searchSpace: SEARCH_OK,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tokenizer.mjs — branch counts (hand-calculated)
// ---------------------------------------------------------------------------

test('T214 tokenizer: constants are exact and frozen', () => {
  assert.deepEqual(DIALECTS, ['python', 'javascript', 'typescript', 'rust', 'shell']);
  assert.deepEqual(BRANCH_CATEGORIES, ['if', 'else', 'switch', 'case', 'match', 'ternary', 'loop', 'guard']);
  assert.deepEqual(DIALECT_EXTENSIONS.python, ['.py', '.pyi']);
  assert.deepEqual(DIALECT_EXTENSIONS.shell, ['.sh', '.bash', '.zsh']);
  assert.equal(Object.isFrozen(DIALECT_BRANCH_KEYWORDS), true);
  assert.equal(Object.isFrozen(DIALECT_EXTENSIONS), true);
  assert.equal(Object.isFrozen(MAINTAINABILITY_LIMITS), true);
  assert.equal(MAINTAINABILITY_DIMENSION_ID, 'DIM-maintainability-v1');
  for (const dialect of DIALECTS) {
    for (const [category, words] of Object.entries(DIALECT_BRANCH_KEYWORDS[dialect])) {
      assert.ok(BRANCH_CATEGORIES.includes(category), category);
      assert.ok(Array.isArray(words), `${dialect} ${category}`);
    }
  }
});

test('T214 tokenizer: hand-calculated branch counts per dialect', () => {
  const cases = [
    ['javascript', 'if (a) { b(); } else { c(); }', { if: 1, else: 1 }],
    ['javascript', 'const x = a ? b : c;', { ternary: 1 }],
    ['python', 'if x:\n    y()\nelif z:\n    w()\nelse:\n    q()\nfor i in range(3):\n    pass', { if: 1, else: 2, loop: 1 }],
    ['rust', 'fn f(x: Option<i32>) -> i32 { match x { Some(v) if v > 0 => v, None => 0, } }', { if: 1, match: 1 }],
    ['shell', '#!/bin/bash\nif [ -f x ]; then\n  echo hi\nelif [ -d y ]; then\n  echo yo\nelse\n  echo no\nfi', { if: 1, else: 2 }],
  ];
  for (const [dialect, source, expected] of cases) {
    const { tokens } = tokenize(source, dialect);
    const counts = countBranchPoints(tokens, dialect);
    const expectedFull = { ...ZERO_COUNTS, ...expected };
    assert.deepEqual(counts, expectedFull, `${dialect}: ${source}`);
  }
});

test('T214 tokenizer: ternary excludes optional chaining and nullish coalescing', () => {
  const { tokens } = tokenize('const x = a ? b : c; a?.b ?? c; a ? d : e;', 'javascript');
  const counts = countBranchPoints(tokens, 'javascript');
  assert.equal(counts.ternary, 2, 'only standalone ? tokens count');
  assert.ok(tokens.some(({ value }) => value === '?.'));
  assert.ok(tokens.some(({ value }) => value === '??'));
});

test('T214 tokenizer: comments and string literals are excluded from token counts', () => {
  const python = tokenize('# if this is a comment\ns = "if else"\nx = 1\n', 'python');
  assert.deepEqual(countBranchPoints(python.tokens, 'python'), ZERO_COUNTS);
  const js = tokenize('const s = "if else switch"; /* if */ if (x) {}', 'javascript');
  assert.equal(countBranchPoints(js.tokens, 'javascript').if, 1);
  const rust = tokenize('// if\n/* else\nmatch */\nlet s = "if";', 'rust');
  assert.deepEqual(countBranchPoints(rust.tokens, 'rust'), ZERO_COUNTS);
});

test('T214 tokenizer: rust char literals become STR while lifetimes stay punctuation', () => {
  const chars = tokenize("let c = 'x'; let nl = '\\n';", 'rust');
  assert.ok(chars.tokens.some(({ value }) => value === 'STR'));
  const lifetime = tokenize("fn f<'a>(x: &'a str) -> &'a str { x }", 'rust');
  assert.ok(lifetime.tokens.some(({ value }) => value === "'"));
  assert.deepEqual(countBranchPoints(lifetime.tokens, 'rust'), ZERO_COUNTS);
});

test('T214 tokenizer: shell heredocs, parameter expansions, and $( ) are handled', () => {
  const heredoc = tokenize('cat <<EOF\nif fake\nelse fake\nEOF\necho done', 'shell');
  assert.deepEqual(countBranchPoints(heredoc.tokens, 'shell'), ZERO_COUNTS);
  assert.ok(heredoc.tokens.some(({ value }) => value === 'echo'));
  const expansion = tokenize('echo ${x#if} $name ${y:-a}', 'shell');
  assert.equal(expansion.tokens.filter(({ value }) => value === 'STR').length, 2);
  const sub = tokenize('echo $(if x; then y; fi)', 'shell');
  assert.equal(countBranchPoints(sub.tokens, 'shell').if, 1, 'command substitution content is counted');
});

test('T214 tokenizer: js regex literals are skipped so branch keywords inside them do not count', () => {
  const { tokens } = tokenize('const re = /if else switch/g; const x = 1;', 'javascript');
  assert.equal(countBranchPoints(tokens, 'javascript').if, 0, 'regex contents are not tokens');
  assert.equal(tokens.filter(({ value }) => value === 'if').length, 0);
  const division = tokenize('const y = a / b / c;', 'javascript');
  assert.ok(division.tokens.filter(({ value }) => value === '/').length >= 2, 'division is not a regex');
});

test('T214 tokenizer: emission is bounded by MAX_TOKENS_PER_FILE with truncated flag', () => {
  const { tokens, truncated } = tokenize('x '.repeat(MAX_TOKENS_PER_FILE + 100), 'javascript');
  assert.equal(truncated, true);
  assert.equal(tokens.length, MAX_TOKENS_PER_FILE);
  const small = tokenize('if (x) {}', 'javascript');
  assert.equal(small.truncated, false);
});

test('T214 tokenizer: dialectForPath maps the five built-in extensions only', () => {
  assert.equal(dialectForPath('src/app.js'), 'javascript');
  assert.equal(dialectForPath('a.tsx'), 'typescript');
  assert.equal(dialectForPath('mod.rs'), 'rust');
  assert.equal(dialectForPath('app.pyi'), 'python');
  assert.equal(dialectForPath('run.sh'), 'shell');
  assert.equal(dialectForPath('Dockerfile'), null);
  assert.equal(dialectForPath('README.md'), null);
  assert.equal(dialectForPath('main.go'), null);
});

test('T214 tokenizer: per-function cyclomatic complexity is scoped per dialect', () => {
  const cases = [
    ['python',
      'def outer(x):\n    if x > 0:\n        return x * 2\n    return x\n\n\ndef inner(y):\n    for i in range(y):\n        if i % 2 == 0 and y > 10:\n            print(i)\n    return y\n',
      [['outer', 1, 4, 1], ['inner', 7, 11, 3]]],
    ['javascript',
      'function greet(name) {\n  if (name && name.length > 0) {\n    return "hi";\n  }\n  return "hi";\n}\nconst compute = (a, b) => {\n  if (a) { return a; }\n  if (b) { return b || 0; }\n  return 0;\n};\n',
      [['greet', 1, 6, 2], ['anonymous', 7, 11, 3]]],
    ['typescript',
      'export function area(s: Shape): number {\n  if (s === null || s === undefined) {\n    return 0;\n  }\n  return s.area();\n}\nconst lambda = (x: number): number => {\n  if (x > 0) { return x; }\n  return -x;\n};\n',
      [['area', 1, 6, 2], ['anonymous', 7, 10, 1]]],
    ['rust',
      'fn main() {\n    let values = vec![1, 2, 3];\n    for value in values {\n        if value > 1 && value < 3 {\n            println!("{}", value);\n        }\n    }\n}\n\nfn classify(x: i32) -> &\'static str {\n    match x {\n        0 => "zero",\n        _ => "other",\n    }\n}\n',
      [['main', 1, 8, 3], ['classify', 10, 15, 1]]],
    ['shell',
      'greet() {\n  if [ -n "$1" ]; then\n    echo "hi"\n  else\n    echo "hi"\n  fi\n}\n\nfunction top() {\n  case "$1" in\n    start) echo start ;;\n    *) echo other ;;\n  esac\n}\n',
      [['greet', 1, 7, 2], ['top', 9, 14, 1]]],
  ];
  for (const [dialect, source, expected] of cases) {
    const { tokens } = tokenize(source, dialect);
    const { functions } = countFunctionComplexity(source, dialect, tokens);
    assert.deepEqual(
      functions.map(({ functionName, startLine, endLine, complexity }) =>
        [functionName, startLine, endLine, complexity]),
      expected,
      `${dialect}: ${source}`,
    );
  }
});

test('T214 tokenizer: per-function scoping has no brace/indent false positives', () => {
  // Object literals, control blocks, regex/string braces, and class bodies
  // never open a function scope; nested functions are assigned to the deepest
  // scope only.
  const jsSource = 'const config = { if: "x", a: { b: 1 } };\n'
    + 'function f(x) {\n'
    + '  if (x) {\n'
    + '    return { ok: true };\n'
    + '  }\n'
    + '  for (const k of [1, 2]) {\n'
    + '    if (k) { continue; }\n'
    + '  }\n'
    + '  return /if else { }/g.test(x);\n'
    + '}\n';
  const jsTokens = tokenize(jsSource, 'javascript').tokens;
  assert.deepEqual(countFunctionComplexity(jsSource, 'javascript', jsTokens).functions,
    [{ functionName: 'f', startLine: 2, endLine: 10, complexity: 3 }],
    'regex/object-literal braces never count');

  // Nested functions: inner `if` belongs to the inner function only.
  const nested = 'function outer(a) {\n'
    + '  if (a) {\n'
    + '    function inner(b) {\n'
    + '      if (b) { return 1; }\n'
    + '      return 0;\n'
    + '    }\n'
    + '    return inner(a);\n'
    + '  }\n'
    + '  return 0;\n'
    + '}\n';
  const nestedTokens = tokenize(nested, 'javascript').tokens;
  assert.deepEqual(countFunctionComplexity(nested, 'javascript', nestedTokens).functions,
    [
      { functionName: 'outer', startLine: 1, endLine: 10, complexity: 1 },
      { functionName: 'inner', startLine: 3, endLine: 6, complexity: 1 },
    ],
    'the inner if counts only in inner');

  // TSX containers never create scopes and inline arrows are scoped.
  const tsx = 'export const List = ({ items }: { items: string[] }) => {\n'
    + '  if (items.length === 0) {\n'
    + '    return <p>empty</p>;\n'
    + '  }\n'
    + '  return <ul>{items.map((item) => (item.length > 3 ? "long" : "short"))}</ul>;\n'
    + '};\n';
  const tsxTokens = tokenize(tsx, 'typescript').tokens;
  assert.deepEqual(countFunctionComplexity(tsx, 'typescript', tsxTokens).functions,
    [
      { functionName: 'anonymous', startLine: 1, endLine: 6, complexity: 1 },
      { functionName: 'anonymous', startLine: 5, endLine: 5, complexity: 1 },
    ],
    'List if plus the inline map arrow ternary');

  // Shell brace groups and expansions never open a function scope.
  const shellSource = '{\n  if [ -f /tmp/x ]; then\n    echo hi\n  fi\n}\n\necho "$((1 + 2)) ${VAR:-x}"\n';
  const shellTokens = tokenize(shellSource, 'shell').tokens;
  assert.deepEqual(countFunctionComplexity(shellSource, 'shell', shellTokens).functions, [],
    'a brace group is not a function');

  // Semicolon-less arrows never leak a false scope into a later statement.
  const asi = 'const f = () => 42\nif (x) {\n  y();\n}\nconst g = () => { if (z) { return 1; } return 0; }\n';
  const asiTokens = tokenize(asi, 'javascript').tokens;
  assert.deepEqual(countFunctionComplexity(asi, 'javascript', asiTokens).functions,
    [{ functionName: 'anonymous', startLine: 5, endLine: 5, complexity: 1 }],
    'only the g arrow block is scoped');

  // Python class bodies are not functions; methods are.
  const pySource = 'class Example:\n'
    + '    field = {"key": "if else"}\n'
    + '    def calculate(self, x):\n'
    + '        if self.field and x:\n'
    + '            return 1\n'
    + '        return 0\n';
  const pyTokens = tokenize(pySource, 'python').tokens;
  assert.deepEqual(countFunctionComplexity(pySource, 'python', pyTokens).functions,
    [{ functionName: 'calculate', startLine: 3, endLine: 6, complexity: 2 }],
    'dict literals and docstring braces never count');
});

test('T214 tokenizer: boolean operators count toward per-function complexity', () => {
  const cases = [
    ['python', 'def f(x, y):\n    if x and y or not x:\n        return 1\n    return 0\n', 3],
    ['javascript', 'function f(x, y) {\n  if (x && y) {\n    return 1;\n  }\n  if (x || y) { return 2; }\n  return 0;\n}\n', 4],
    ['typescript', 'function f(x: boolean, y: boolean): number {\n  if (x && y) { return 1; }\n  if (x || y) { return 2; }\n  return 0;\n}\n', 4],
    ['rust', 'fn f(x: bool, y: bool) -> u8 {\n    if x && y { return 1; }\n    if x || y { return 2; }\n    0\n}\n', 4],
    ['shell', 'f() {\n  if [ -n "$1" ] && [ -n "$2" ]; then\n    echo hi\n  fi\n}\n', 2],
  ];
  for (const [dialect, source, expected] of cases) {
    const { tokens } = tokenize(source, dialect);
    const { functions } = countFunctionComplexity(source, dialect, tokens);
    assert.equal(functions[0].complexity, expected, `${dialect}: ${source}`);
  }
});

test('T214 tokenizer: countFunctionComplexity tokenizes internally and discloses stable names', () => {
  const source = 'function greet() { return 1; }\n';
  const direct = countFunctionComplexity(source, 'javascript', tokenize(source, 'javascript').tokens);
  const internal = countFunctionComplexity(source, 'javascript');
  assert.deepEqual(direct, internal, 'an omitted token stream produces the same result');
  const nonAscii = 'def f\u30c0():\n    return 1\n';
  const result = countFunctionComplexity(nonAscii, 'python');
  assert.equal(result.functions[0].functionName, 'anonymous', 'non-ASCII names are disclosed as anonymous');
  assert.equal(Object.isFrozen(DIALECT_BOOLEAN_OPERATORS), true);
  assert.deepEqual(Object.keys(detectFunctionScopes([], '', 'python')), [], 'empty input yields no scopes');
});

// ---------------------------------------------------------------------------
// duplicates.mjs — exact 50-token spans
// ---------------------------------------------------------------------------

test('T214 duplicates: exact 50+ token block across two files forms one group', () => {
  const groups = findDuplicateGroups([
    { path: 'a.js', tokens: tokenStream(60) },
    { path: 'b.js', tokens: tokenStream(60) },
  ]);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].tokenCount, 60);
  assert.deepEqual(groups.groups[0].spans.map(({ path }) => path), ['a.js', 'b.js']);
  for (const span of groups.groups[0].spans) {
    assert.equal(span.startLine, 1);
    assert.equal(span.endLine, 60);
    assert.equal(span.tokenCount, 60);
  }
  assert.deepEqual(groups.capped, { windows: false, groups: false, spans: false, blocks: false, occurrences: false });
  assert.equal(Object.isFrozen(groups), true);
});

test('T214 duplicates: near-identical content with one differing token yields no group', () => {
  const near = tokenStream(60);
  near[25] = { value: 'changed', line: 26 };
  const groups = findDuplicateGroups([
    { path: 'a.js', tokens: tokenStream(60) },
    { path: 'b.js', tokens: near },
  ]);
  assert.deepEqual(groups.groups, []);
});

test('T214 duplicates: a block shorter than the window yields no group', () => {
  const groups = findDuplicateGroups([
    { path: 'a.js', tokens: tokenStream(DUPLICATE_WINDOW - 1) },
    { path: 'b.js', tokens: tokenStream(DUPLICATE_WINDOW - 1) },
  ]);
  assert.deepEqual(groups.groups, []);
});

test('T214 duplicates: within-file duplicates are detected and merged', () => {
  const first = tokenStream(60, 1);
  const second = tokenStream(60, 61);
  const groups = findDuplicateGroups([{ path: 'd.js', tokens: [...first, ...second] }]);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].spans.length, 2);
  assert.deepEqual(groups.groups[0].spans.map(({ startLine, endLine }) => [startLine, endLine]),
    [[1, 60], [61, 120]]);
  assert.equal(groups.groups[0].tokenCount, 60);
});

test('T214 duplicates: maximal blocks merge instead of fragmenting', () => {
  const groups = findDuplicateGroups([
    { path: 'a.js', tokens: tokenStream(120) },
    { path: 'b.js', tokens: tokenStream(120) },
  ]);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].spans.length, 2);
  assert.equal(groups.groups[0].spans[0].tokenCount, 120);
  assert.equal(groups.groups[0].tokenCount, 120);
});

test('T214 duplicates: caps truncate deterministically and are disclosed', () => {
  const limited = findDuplicateGroups(
    [
      { path: 'a.js', tokens: tokenStream(200) },
      { path: 'b.js', tokens: tokenStream(200) },
    ],
    { maxWindows: 10 },
  );
  assert.equal(limited.capped.windows, true);
  const noGroups = findDuplicateGroups(
    [
      { path: 'a.js', tokens: tokenStream(60) },
      { path: 'b.js', tokens: tokenStream(60) },
    ],
    { maxGroups: 0 },
  );
  assert.equal(noGroups.capped.groups, true);
  assert.deepEqual(noGroups.groups, []);
});

test('T214 duplicates: invalid inputs fail with typed errors', () => {
  assert.throws(() => findDuplicateGroups('nope'), /Duplicate detection failed/);
  assert.throws(() => findDuplicateGroups([{ path: 'a.js', tokens: [{ value: 'x' }] }]), /Duplicate detection failed/);
});

test('T214 duplicates: a 40-file identical block discloses the occurrence cap', () => {
  const files = [];
  for (let index = 0; index < 40; index++) {
    files.push({ path: `f${String(index).padStart(2, '0')}.js`, tokens: tokenStream(60) });
  }
  const groups = findDuplicateGroups(files);
  assert.equal(groups.capped.occurrences, true, 'bucket truncation is disclosed');
  assert.equal(groups.groups.length, 1);
  assert.ok(groups.groups[0].spans.length <= 32, 'spans are bounded by maxOccurrencesPerGroup');
  assert.deepEqual(Object.keys(groups.capped).toSorted(),
    ['blocks', 'groups', 'occurrences', 'spans', 'windows']);
});

// ---------------------------------------------------------------------------
// model.mjs — schema, determinism, immutability, privacy, partial coverage
// ---------------------------------------------------------------------------

test('T214 model: deterministic deep-frozen model with exact summary math', () => {
  const first = buildMaintainabilityModel(modelInput());
  const second = buildMaintainabilityModel(modelInput({
    measurement: { ...modelInput().measurement, filesInspected: 9 },
  }));
  assert.notEqual(first, second);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(buildMaintainabilityModel(modelInput())),
  );
  assert.equal(
    JSON.stringify(buildMaintainabilityModel(modelInput())),
    JSON.stringify(buildMaintainabilityModel(modelInput({
      files: [...sampleFiles()].toReversed(),
      branchPoints: [...sampleBranchPoints()].toReversed(),
    }))),
    'reversed insertion order produces identical output',
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.files), true);
  assert.equal(Object.isFrozen(first.files[0]), true);
  assert.equal(Object.isFrozen(first.branchPoints[0].counts), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.files.push({}), TypeError);
  assert.throws(() => first.summary.tokens = 0, TypeError);

  assert.equal(first.summary.filesMeasured, 1);
  assert.equal(first.summary.eligibleFiles, 1);
  assert.equal(first.summary.tokens, 55);
  assert.equal(first.summary.branchPoints, 7, '3 if + 1 else + 1 ternary + 2 loop');
  assert.equal(first.summary.duplicateGroups, 0);
  assert.equal(first.summary.diagnostics, 0);
  assert.equal(first.summary.filesInspected, 2);
  assert.equal(first.summary.bytesInspected, 120);
  assert.equal(first.summary.recordsInspected, 2);
  assert.equal(first.summary.partialCoverage, false);
  assert.deepEqual(first.measurementUniverse.excludedLanguages, []);
  assert.deepEqual(first.sizeDistribution, [{ bucket: 'lt_1k', count: 1 }]);
  assert.deepEqual(first.measurementUniverse.sizeDistribution, [{ bucket: 'lt_1k', count: 1 }]);
});

test('T214 model: invalid records fail with typed errors', () => {
  const badBranch = modelInput({
    branchPoints: [{ ...sampleBranchPoints()[0], path: 'src/other.js' }],
  });
  assert.throws(() => buildMaintainabilityModel(badBranch), (e) => e instanceof MaintainabilityModelError && e.code === 'ORPHAN_RECORD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    branchPoints: [{ ...sampleBranchPoints()[0], counts: { ...ZERO_COUNTS, extra: 1 } }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'UNKNOWN_FIELD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    searchSpace: { ...SEARCH_OK, missing: true },
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'UNKNOWN_FIELD');
  assert.throws(() => buildMaintainabilityModel(modelInput({ searchSpace: null })), MaintainabilityModelError);
});

test('T214 model: no-extension marker is accepted and disclosed in the excluded-language table', () => {
  assert.equal(NO_EXTENSION_LABEL, 'no-extension');
  const model = buildMaintainabilityModel(modelInput({
    measurement: {
      ...modelInput().measurement,
      excludedLanguages: [{ extension: NO_EXTENSION_LABEL, count: 3 }, { extension: '.md', count: 1 }],
    },
  }));
  assert.deepEqual(model.measurementUniverse.excludedLanguages, [
    { extension: '.md', count: 1 },
    { extension: 'no-extension', count: 3 },
  ]);
  assert.equal(model.summary.excludedFiles, 4);
  assert.throws(() => buildMaintainabilityModel(modelInput({
    measurement: { ...modelInput().measurement, excludedLanguages: [{ extension: '', count: 1 }] },
  })), MaintainabilityModelError, 'empty extensions stay invalid outside the scanner');
});

test('T214 model: sanitized other sentinel is accepted; raw unsafe extensions stay invalid', () => {
  assert.equal(OTHER_EXTENSION_LABEL, 'other');
  const model = buildMaintainabilityModel(modelInput({
    measurement: {
      ...modelInput().measurement,
      excludedLanguages: [{ extension: OTHER_EXTENSION_LABEL, count: 3 }],
    },
  }));
  assert.deepEqual(model.measurementUniverse.excludedLanguages, [
    { extension: 'other', count: 3 },
  ]);
  assert.equal(model.summary.excludedFiles, 3);
  for (const raw of ['.js~', '.日本語', `.${'a'.repeat(32)}`]) {
    assert.throws(() => buildMaintainabilityModel(modelInput({
      measurement: {
        ...modelInput().measurement,
        excludedLanguages: [{ extension: raw, count: 1 }],
      },
    })), MaintainabilityModelError, `raw extension ${raw} stays invalid outside the scanner`);
  }
});

test('T214 model: isValidExcludedExtension admits only the bounded disclosed charset', () => {
  assert.equal(isValidExcludedExtension('.js'), true);
  assert.equal(isValidExcludedExtension('.mjs'), true);
  assert.equal(isValidExcludedExtension('.tsx'), true);
  assert.equal(isValidExcludedExtension('.' + 'a'.repeat(31)), true, '32-char extension fits the bound');
  assert.equal(isValidExcludedExtension('.' + 'a'.repeat(32)), false, '33-char extension exceeds the bound');
  assert.equal(isValidExcludedExtension('.js~'), false, 'vim backup suffix is outside the charset');
  assert.equal(isValidExcludedExtension('.日本語'), false, 'non-ASCII extension is outside the charset');
  assert.equal(isValidExcludedExtension('.bak~'), false);
  assert.equal(isValidExcludedExtension(''), false);
  assert.equal(isValidExcludedExtension('.json '), false);
  assert.equal(isValidExcludedExtension('no-extension'), false, 'sentinels are not verbatim extensions');
  assert.equal(isValidExcludedExtension(42), false);
});

test('T214 model: duplicate occurrence cap threads into the summary', () => {
  const capped = buildMaintainabilityModel(modelInput({
    duplicateCaps: { windows: false, groups: false, spans: false, blocks: false, occurrences: true },
  }));
  assert.equal(capped.summary.capped.occurrences, true);
  assert.equal(capped.summary.partialCoverage, true);
  const clear = buildMaintainabilityModel(modelInput());
  assert.equal(clear.summary.capped.occurrences, false);
});

test('T214 model: privacy violations are downgraded to PRIVACY diagnostics and never leak', () => {
  const model = buildMaintainabilityModel(modelInput({
    toolEvidence: [{
      tool: 'eslint', kind: 'config', file: '.eslintrc.json', line: 1, source: 'alice@example.test',
    }],
  }));
  assert.deepEqual(model.toolEvidence, []);
  assert.deepEqual(model.diagnostics, [{
    path: '.eslintrc.json', status: 'unverified', reason: 'PRIVACY', line: 1,
  }]);
  assert.equal(JSON.stringify(model).includes('alice@example.test'), false);
});

test('T214 model: partial coverage is flagged when caps or omissions occur', () => {
  const partial = buildMaintainabilityModel(modelInput({
    duplicateCaps: { windows: true, groups: false, spans: false, blocks: false },
  }));
  assert.equal(partial.summary.partialCoverage, true);
  assert.equal(partial.summary.capped.windows, true);

  const cappedFiles = buildMaintainabilityModel(modelInput({
    measurement: { ...modelInput().measurement, eligibleFiles: 10, measuredFiles: 1 },
  }));
  assert.equal(cappedFiles.summary.capped.files, true);
  assert.equal(cappedFiles.summary.partialCoverage, true);
});

test('T214 model: generated and tool records are bounded and deterministic', () => {
  const model = buildMaintainabilityModel(modelInput({
    generatedBoundaries: [
      { path: 'vendor/x.js', reason: 'dir_marker', marker: 'vendor', source: 'vendor', line: 1 },
    ],
    toolEvidence: [
      { tool: 'eslint', kind: 'config', file: '.eslintrc.json', line: 1, source: '.eslintrc.json' },
    ],
  }));
  assert.equal(model.summary.generatedFiles, 1);
  assert.equal(model.summary.toolEvidence, 1);
  assert.equal(model.generatedBoundaries[0].path, 'vendor/x.js');
  assert.equal(model.toolEvidence[0].tool, 'eslint');
});

test('T214 model: sizeBucketFor uses the fixed bounded buckets', () => {
  assert.equal(sizeBucketFor(10), 'lt_1k');
  assert.equal(sizeBucketFor(1023), 'lt_1k');
  assert.equal(sizeBucketFor(1024), 'k1_10k');
  assert.equal(sizeBucketFor(10_239), 'k1_10k');
  assert.equal(sizeBucketFor(10_240), 'k10_100k');
  assert.equal(sizeBucketFor(1_048_576), 'gt_1m');
  assert.deepEqual(SIZE_BUCKETS.map(({ label }) => label),
    ['lt_1k', 'k1_10k', 'k10_100k', 'k100_1m', 'gt_1m']);
});

test('T214 model: complexityDistribution computes deterministic nearest-rank percentiles', () => {
  assert.deepEqual(complexityDistribution([1, 3, 2]), { min: 1, median: 2, p95: 3, max: 3 });
  assert.deepEqual(complexityDistribution([2, 2, 2]), { min: 2, median: 2, p95: 2, max: 2 });
  assert.deepEqual(complexityDistribution([0, 1, 2, 3]), { min: 0, median: 1, p95: 3, max: 3 });
  assert.deepEqual(complexityDistribution([3]), { min: 3, median: 3, p95: 3, max: 3 });
  assert.deepEqual(complexityDistribution([]), null, 'no functions yields a null distribution');
  assert.deepEqual(complexityDistribution('nope'), null);
  assert.deepEqual(complexityDistribution([-1, 2]), { min: 2, median: 2, p95: 2, max: 2 },
    'invalid values are filtered before the distribution is computed');
});

test('T214 model: complexity records are normalized, frozen, and orphan-checked', () => {
  const record = {
    path: 'src/a.js',
    dialect: 'javascript',
    functions: [{ functionName: 'greet', startLine: 1, endLine: 6, complexity: 2 }],
    distribution: { min: 2, median: 2, p95: 2, max: 2 },
    functionsCapped: false,
  };
  const model = buildMaintainabilityModel(modelInput({ complexityRecords: [record] }));
  assert.deepEqual(model.complexityRecords, [record]);
  assert.equal(Object.isFrozen(model.complexityRecords[0]), true);
  assert.equal(Object.isFrozen(model.complexityRecords[0].functions[0]), true);

  const emptyFunctions = buildMaintainabilityModel(modelInput({
    complexityRecords: [{
      ...record, functions: [], distribution: null,
    }],
  }));
  assert.equal(emptyFunctions.complexityRecords[0].distribution, null);

  assert.throws(() => buildMaintainabilityModel(modelInput({
    complexityRecords: [{ ...record, path: 'src/other.js' }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'ORPHAN_RECORD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    complexityRecords: [{ ...record, distribution: { min: 1, median: 0, p95: 1, max: 1 } }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'INVALID_RECORD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    complexityRecords: [{ ...record, extra: true }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'UNKNOWN_FIELD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    complexityRecords: [{ ...record, functions: [{ ...record.functions[0], endLine: 0 }] }],
  })), MaintainabilityModelError, 'non-positive lines stay invalid');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    complexityRecords: [record, { ...record, functions: [] }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'BOUND_EXCEEDED',
  'duplicate complexity records for one file are rejected');
});

test('T214 model: dead-code entries are normalized, frozen, and kind-allowlisted', () => {
  assert.deepEqual(DEAD_CODE_KINDS, [
    'allow_dead_code', 'no_unused_locals', 'no_unused_vars',
    'unused_import', 'vulture_config', 'vulture_whitelist',
  ]);
  const model = buildMaintainabilityModel(modelInput({
    deadCode: [
      { kind: 'vulture_config', path: 'vulture.toml', count: 1 },
      { kind: 'unused_import', path: 'src/a.js', count: 2 },
    ],
  }));
  assert.deepEqual(model.deadCode, [
    { kind: 'unused_import', path: 'src/a.js', count: 2 },
    { kind: 'vulture_config', path: 'vulture.toml', count: 1 },
  ]);
  assert.equal(Object.isFrozen(model.deadCode[0]), true);
  assert.throws(() => buildMaintainabilityModel(modelInput({
    deadCode: [{ kind: 'unknown_kind', path: 'x', count: 1 }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'INVALID_RECORD');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    deadCode: [{ kind: 'unused_import', path: 'x', count: 0 }],
  })), MaintainabilityModelError, 'zero counts stay invalid outside the scanner');
  assert.throws(() => buildMaintainabilityModel(modelInput({
    deadCode: [{ kind: 'unused_import', path: 'x', count: 1, extra: 1 }],
  })), (e) => e instanceof MaintainabilityModelError && e.code === 'UNKNOWN_FIELD');
  const many = Array.from({ length: MAINTAINABILITY_LIMITS.deadCodeEntries + 1 }, (_, index) => ({
    kind: 'unused_import', path: `f${String(index).padStart(4, '0')}.py`, count: 1,
  }));
  assert.throws(() => buildMaintainabilityModel(modelInput({ deadCode: many })),
    (e) => e instanceof MaintainabilityModelError && e.code === 'BOUND_EXCEEDED',
    'dead-code entries beyond the declared cap are rejected');
});

test('T214 model: privacy-violating craft records are downgraded to PRIVACY diagnostics', () => {
  const model = buildMaintainabilityModel(modelInput({
    deadCode: [{ kind: 'unused_import', path: 'alice@example.test', count: 1 }],
  }));
  assert.deepEqual(model.deadCode, []);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'PRIVACY'));
  assert.equal(JSON.stringify(model).includes('alice@example.test'), false);
});

// ---------------------------------------------------------------------------
// generated/vendor boundaries — exact evidence only
// ---------------------------------------------------------------------------

test('T214 generated boundaries: directory markers, filename markers, header comments', () => {
  assert.deepEqual(detectGeneratedBoundary('vendor/lib/util.js', ''), {
    path: 'vendor/lib/util.js', reason: 'dir_marker', marker: 'vendor', source: 'vendor', line: 1,
  });
  assert.deepEqual(detectGeneratedBoundary('src/third_party/x.ts', '').reason, 'dir_marker');
  assert.deepEqual(detectGeneratedBoundary('static/app.min.js', '').marker, 'minified-source');
  assert.deepEqual(detectGeneratedBoundary('api/user.pb.ts', '').marker, 'protobuf-js');
  assert.deepEqual(detectGeneratedBoundary('api/user_pb2.py', '').marker, 'protobuf-python');
  assert.deepEqual(detectGeneratedBoundary('api/user_pb2_grpc.py', '').marker, 'protobuf-python');
  const header = detectGeneratedBoundary('gen.go', '// Code generated by protoc-gen-go. DO NOT EDIT.\nvar a = 1;\n');
  assert.deepEqual(header, {
    path: 'gen.go', reason: 'header_comment', marker: 'code-generated',
    source: 'Code generated by protoc-gen-go. DO NOT EDIT', line: 1,
  });
  const auto = detectGeneratedBoundary('x.js', '/* AUTO-GENERATED */\n');
  assert.equal(auto.reason, 'header_comment');
  assert.equal(auto.marker, 'auto-generated');
  assert.equal(detectGeneratedBoundary('src/handwritten.js', '// hand written\nvar a = 1;\n'), null);
  assert.equal(detectGeneratedBoundary('src/normal.py', 'x = 1\n'), null);
  assert.equal(detectGeneratedBoundary('README.md', 'docs\n'), null);
});

test('T214 generated boundaries: header markers are checked in the first lines only', () => {
  const late = detectGeneratedBoundary('x.js', 'var a = 1;\n'.repeat(10) + '// @generated\n');
  assert.equal(late, null, 'markers beyond the header window are ignored');
});

test('T214 generated boundaries: non-ASCII header text is disclosed as the fixed ASCII marker', () => {
  const boundary = detectGeneratedBoundary('gen.js', '// Code generated by ツールX. DO NOT EDIT.\nvar a = 1;\n');
  assert.deepEqual(boundary, {
    path: 'gen.js', reason: 'header_comment', marker: 'code-generated',
    source: 'code-generated', line: 1,
  });
  assert.equal(JSON.stringify(boundary).includes('ツールX'), false, 'raw non-ASCII header text is never disclosed');
  assert.equal(detectGeneratedBoundary('src/ツール.min.js', '').source, 'minified-source',
    'non-ASCII matched filenames fall back to the fixed ASCII marker');
  const model = buildMaintainabilityModel(modelInput({
    generatedBoundaries: [boundary],
  }));
  assert.deepEqual(model.generatedBoundaries, [boundary], 'the boundary passes the model gate');
});

// ---------------------------------------------------------------------------
// tool evidence — declarations only
// ---------------------------------------------------------------------------

test('T214 tool evidence: config-file presence, manifest sections, and dependencies', () => {
  const config = detectToolEvidence({ path: '.eslintrc.json', format: 'text', value: '{}', text: '{}' });
  assert.deepEqual(config, [{
    tool: 'eslint', kind: 'config', file: '.eslintrc.json', line: 1, source: '.eslintrc.json',
  }]);
  const pkg = detectToolEvidence({
    path: 'package.json',
    format: 'json',
    value: { eslintConfig: {}, devDependencies: { eslint: '9', prettier: '3' } },
    text: '',
  });
  const pkgTools = pkg.map(({ tool, kind, source }) => [tool, kind, source]);
  assert.ok(pkgTools.some((entry) => entry[0] === 'eslint' && entry[1] === 'manifest' && entry[2] === 'eslintConfig'));
  assert.ok(pkgTools.some((entry) => entry[0] === 'eslint' && entry[1] === 'dependency'));
  assert.ok(pkgTools.some((entry) => entry[0] === 'prettier' && entry[1] === 'dependency'));
  const py = detectToolEvidence({ path: 'pyproject.toml', format: 'text', value: '[tool.ruff]\n[tool.black]\n', text: '[tool.ruff]\n[tool.black]\n' });
  assert.deepEqual(py.map(({ tool, kind }) => [tool, kind]), [['black', 'manifest'], ['ruff', 'manifest']]);
  assert.equal(py[0].line, 2, 'section line numbers are reported');
  const cargo = detectToolEvidence({ path: 'Cargo.toml', format: 'text', value: '[lints]\nclippy = { level = "warn" }\n', text: '[lints]\nclippy = { level = "warn" }\n' });
  assert.deepEqual(cargo.map(({ tool }) => tool), ['clippy']);
  assert.equal(cargo[0].line, 1);
  const rustfmt = detectToolEvidence({ path: 'rustfmt.toml', format: 'text', value: 'max_width = 100\n', text: 'max_width = 100\n' });
  assert.deepEqual(rustfmt.map(({ tool }) => tool), ['rustfmt']);
  assert.deepEqual(detectToolEvidence({ path: 'README.md', format: 'text', value: 'docs', text: 'docs' }), []);
});

// ---------------------------------------------------------------------------
// dead-code signals — declarations and lexical markers, counts only
// ---------------------------------------------------------------------------

test('T214 dead-code source signals: per-dialect markers are counted without content', () => {
  const rust = detectDeadCodeSourceSignals({
    path: 'src/lib.rs', dialect: 'rust',
    text: '#![allow(dead_code)]\n#[allow(dead_code, unused_variables)]\npub fn f() {}\n',
  });
  assert.deepEqual(rust, [{ kind: 'allow_dead_code', path: 'src/lib.rs', count: 2 }]);
  const rustImports = detectDeadCodeSourceSignals({
    path: 'src/lib.rs', dialect: 'rust',
    text: 'use std::io;\n#![allow(unused_imports)]\n',
  });
  assert.deepEqual(rustImports, [{ kind: 'unused_import', path: 'src/lib.rs', count: 1 }]);
  const python = detectDeadCodeSourceSignals({
    path: 'app.py', dialect: 'python',
    text: 'import os  # noqa: F401\nfrom x import y  # noqa\nimport sys\n',
  });
  assert.deepEqual(python, [{ kind: 'unused_import', path: 'app.py', count: 2 }]);
  const js = detectDeadCodeSourceSignals({
    path: 'src/a.js', dialect: 'javascript',
    text: '// eslint-disable-next-line no-unused-vars\nimport x from "./x";\n// eslint-disable-line @typescript-eslint/no-unused-vars\nimport y from "./y";\n',
  });
  assert.deepEqual(js, [{ kind: 'unused_import', path: 'src/a.js', count: 2 }]);
  assert.deepEqual(
    detectDeadCodeSourceSignals({ path: 'run.sh', dialect: 'shell', text: 'if true; then echo hi; fi\n' }),
    [],
    'shell has no unused-import construct and so no marker',
  );
  assert.deepEqual(
    detectDeadCodeSourceSignals({ path: 'app.py', dialect: 'python', text: 'x = 1\n' }),
    [],
    'no marker means no entry',
  );
});

test('T214 dead-code config signals: declarations are counted once', () => {
  const vulture = detectDeadCodeConfigSignals({ path: 'pyproject.toml', format: 'text', text: '[tool.vulture]\nmin-confidence = 90\n' });
  assert.deepEqual(vulture, [{ kind: 'vulture_config', path: 'pyproject.toml', count: 1 }]);
  assert.deepEqual(detectDeadCodeConfigSignals({ path: 'pyproject.toml', format: 'text', text: '[tool.ruff]\n' }), []);
  const toml = detectDeadCodeConfigSignals({ path: 'vulture.toml', format: 'text', text: 'min-confidence = 90\n' });
  assert.deepEqual(toml, [{ kind: 'vulture_config', path: 'vulture.toml', count: 1 }]);
  const whitelist = detectDeadCodeConfigSignals({ path: '.vulture_whitelist.py', format: 'text', text: '# whitelist\nfoo\n' });
  assert.deepEqual(whitelist, [{ kind: 'vulture_whitelist', path: '.vulture_whitelist.py', count: 1 }]);
  const ts = detectDeadCodeConfigSignals({ path: 'tsconfig.json', format: 'json', value: { compilerOptions: { noUnusedLocals: true } }, text: '' });
  assert.deepEqual(ts, [{ kind: 'no_unused_locals', path: 'tsconfig.json', count: 1 }]);
  assert.deepEqual(
    detectDeadCodeConfigSignals({ path: 'jsconfig.json', format: 'json', value: { compilerOptions: { noUnusedLocals: false } }, text: '' }),
    [],
    'a false flag is not a declaration',
  );
  const eslint = detectDeadCodeConfigSignals({ path: '.eslintrc.json', format: 'text', value: '{}', text: '{"rules": {"no-unused-vars": "error"}}' });
  assert.deepEqual(eslint, [{ kind: 'no_unused_vars', path: '.eslintrc.json', count: 1 }]);
  const eslintTs = detectDeadCodeConfigSignals({ path: 'eslint.config.js', format: 'text', value: '{}', text: 'export default [{ rules: { "@typescript-eslint/no-unused-vars": "warn" } }];' });
  assert.deepEqual(eslintTs, [{ kind: 'no_unused_vars', path: 'eslint.config.js', count: 1 }]);
  assert.deepEqual(detectDeadCodeConfigSignals({ path: 'README.md', format: 'text', text: 'docs\nno-unused-vars in prose\n' }), [],
    'non-eslint config files never declare the rule');
});

// ---------------------------------------------------------------------------
// providers/maintainability.mjs — T210 base
// ---------------------------------------------------------------------------

test('T214 provider: emits only DIM-maintainability categories via the foundation', async () => {
  const files = {
    'src/a.js': 'if (x) { y(); }\nfor (let i = 0; i < 3; i++) { z(i); }\n',
    'src/b.py': 'def f():\n    match x:\n        case 1:\n            return 1\n',
  };
  await withFixture('maint-prov', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const first = maintainabilityProviderResults(findings);
    const second = maintainabilityProviderResults(findings);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.results.length, 1);
    assert.equal(first.capped, false);
    const result = first.results[0];
    assert.equal(result.providerId, MAINTAINABILITY_PROVIDER_ID);
    assert.equal(result.dimensionId, 'DIM-maintainability-v1');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.observations), true);
    const allowed = PROVIDER_CATEGORIES['DIM-maintainability-v1'];
    const seen = new Set();
    for (const observation of result.observations) {
      assert.ok(allowed.includes(observation.category), `category ${observation.category} is allowlisted`);
      assert.ok(EVIDENCE_SOURCE_KINDS.includes(observation.sourceKind), observation.sourceKind);
      seen.add(observation.category);
    }
    assert.deepEqual([...seen].toSorted(), [
      'branch_point', 'file_metric', 'measurement_universe',
    ]);
    const universe = result.observations.find(({ category }) => category === 'measurement_universe');
    assert.equal(universe.details.partialCoverage, false);
    assert.equal(typeof universe.details.sizeDistribution, 'object');
    assert.deepEqual(maintainabilityProviderResults(null), { results: [], capped: false });
    assert.deepEqual(maintainabilityProviderResults({}).results, []);
    assert.deepEqual(maintainabilityObservations({}), [{ dimensionId: 'DIM-maintainability-v1', observations: [] }]);
  });
});

test('T214 provider: deterministic, immutable, and empty for foreign input', () => {
  const observations = maintainabilityObservations({ files: [], branchPoints: [], duplicateGroups: [] });
  assert.deepEqual(observations[0].observations.filter(({ category }) => category !== 'measurement_universe'), []);
});

// ---------------------------------------------------------------------------
// render/maintainability.mjs — inert renderer
// ---------------------------------------------------------------------------

test('T214 renderer: neutral markdown with disclosed universe and exact evidence', async () => {
  const files = {
    'src/a.js': 'const GREETING = "hello";\nfunction greet(name) {\n  if (name) {\n    return GREETING;\n  }\n  return GREETING;\n}\n',
    'vendor/dep.js': '// Code generated by x. DO NOT EDIT.\nvar lib = { q: 1 };\n',
    'package.json': JSON.stringify({ devDependencies: { eslint: '9' } }),
    'README.md': 'docs',
  };
  await withFixture('maint-render', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const markdown = createMaintainabilityRenderer().render(findings);
    assert.match(markdown, /^## Maintainability/);
    assert.match(markdown, /## Measurement universe/);
    assert.match(markdown, /## Generated and vendored boundaries/);
    assert.match(markdown, /## Branch-point approximation/);
    assert.match(markdown, /vendor\/dep\.js/);
    assert.match(markdown, /eslint/);
    assert.match(markdown, /lexical approximation/);
    assert.equal(markdown.includes('\r'), false);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 renderer: partial coverage wording and caps are disclosed without repo-wide conclusions', async () => {
  const files = {};
  for (let index = 0; index < 300; index++) {
    files[`src/f${String(index).padStart(3, '0')}.js`] = 'if (x) { y(); }\n';
  }
  await withFixture('maint-partial', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /Coverage is partial: 256 of 300 eligible source file/);
    assert.match(markdown, /no repository-wide conclusion is drawn/);
    assert.match(markdown, /Caps applied/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 renderer: empty model renders a factual no-measurement line', () => {
  const empty = buildMaintainabilityModel({
    ...modelInput({ files: [], branchPoints: [], sizeDistribution: [] }),
    measurement: {
      filesInspected: 0, bytesInspected: 0, recordsInspected: 0,
      eligibleFiles: 0, measuredFiles: 0, omittedCount: 0,
      excludedLanguages: [{ extension: '.md', count: 2 }],
      configFilesInspected: 0,
    },
  });
  const markdown = createMaintainabilityRenderer().render(empty);
  assert.match(markdown, /No supported source files were measured/);
  assert.match(markdown, /Unsupported-language files were excluded/);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T214 renderer: deterministic output, privacy hook, and inert factory', () => {
  const model = buildMaintainabilityModel(modelInput());
  assert.equal(renderMaintainability('x', model), renderMaintainability('x', model));
  assert.equal(renderMaintainability('x', null), '');
  assert.throws(() => createMaintainabilityRenderer({ context: {} }), /escapeField/);
  assert.equal(Object.isFrozen(createMaintainabilityRenderer()), true);
  const context = createRenderContext({ privacyHook: () => '[safe]' });
  const output = renderMaintainability('x', model, context);
  assert.equal(output.includes('src/a.js'), false, 'paths pass through the privacy hook');
  assert.ok(output.includes('[safe]'));
});

test('T214 renderer: complexity distribution and unused-code markers render neutrally', async () => {
  const files = {
    'src/a.js': 'function one(x) {\n  if (x) { return x; }\n  return 0;\n}\n',
    'src/lib.rs': '#[allow(dead_code)]\nfn value() -> u8 { 1 }\n',
    'app.py': 'import os  # noqa: F401\n',
    'README.md': 'docs',
  };
  await withFixture('maint-render-craft', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /### Complexity distribution \(per function, lexical\)/);
    assert.match(markdown, /\| src\/a\.js \| javascript \| 1 \| 1 \| 1 \| 1 \| 1 \|/);
    assert.match(markdown, /### Unused-code markers/);
    assert.match(markdown, /unused-code allowance attribute/);
    assert.match(markdown, /unused-import marker/);
    assert.equal(markdown.includes('dead code'), false, 'the phrase "dead code" must never appear in prose');
    assert.equal(markdown.includes('dead_code'), false, 'the attribute token is disclosed via its label only');
    assert.deepEqual(findVoiceHits(markdown), []);
    assert.equal(markdown.includes('\r'), false);
  });
});

test('T214 renderer: repo-wide aggregate complexity line uses nearest-rank stats across files', () => {
  const values = Array.from({ length: 21 }, (_, index) => index + 1);
  const fileFor = (path, startIndex, count) => {
    const slice = values.slice(startIndex, startIndex + count);
    return {
      path,
      dialect: 'javascript',
      functions: slice.map((value, index) => ({
        functionName: `fn${String(startIndex + index + 1).padStart(2, '0')}`,
        startLine: 1 + index,
        endLine: 1 + index,
        complexity: value,
      })),
      distribution: complexityDistribution(slice),
      functionsCapped: false,
    };
  };
  const model = buildMaintainabilityModel(modelInput({
    measurement: { ...modelInput().measurement, eligibleFiles: 2, measuredFiles: 2 },
    files: [
      { path: 'src/a.js', dialect: 'javascript', bytes: 100, lines: 30, tokens: 50, sizeBucket: 'lt_1k' },
      { path: 'src/b.js', dialect: 'javascript', bytes: 100, lines: 30, tokens: 50, sizeBucket: 'lt_1k' },
    ],
    complexityRecords: [
      fileFor('src/a.js', 0, 11),
      fileFor('src/b.js', 11, 10),
    ],
  }));
  const markdown = renderMaintainability('repo', model);
  assert.match(markdown, /Aggregate per-function complexity across the measured files: 21 function\(s\), median 11, p95 20, max 21\./);
  assert.match(markdown, /\| src\/a\.js \| javascript \| 11 \| 1 \| 6 \| 11 \| 11 \|/);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T214 renderer: craft sections are absent for models without craft data', () => {
  const empty = buildMaintainabilityModel(modelInput());
  const markdown = renderMaintainability('repo', empty);
  assert.equal(markdown.includes('Complexity distribution'), false);
  assert.equal(markdown.includes('Unused-code markers'), false);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T214 inertness: renderer is never registered in write or existing-ten renderers', async () => {
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP).toSorted(), [
    'architecture', 'config', 'conventions', 'documentation', 'git',
    'operations', 'security', 'stack', 'structure', 'testing',
  ]);
  assert.equal(EXISTING_TEN_RENDERER_MAP.maintainability, undefined);
  const writeSource = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  assert.equal(writeSource.includes('maintainability.mjs'), false);
  assert.equal(existingTen.includes('maintainability.mjs'), false);
});

// ---------------------------------------------------------------------------
// scanner.mjs — end-to-end fixtures
// ---------------------------------------------------------------------------

test('T214 scanner: five-ecosystem fixture with hand-calculated metrics', async () => {
  const block = 'if (a) { b(); } else { c(); }\n';
  const files = {
    'src/a.js': 'const GREETING = "hello";\nfunction greet(name) {\n  if (name) {\n    return GREETING + name;\n  }\n  return GREETING;\n}\nfor (let i = 0; i < 3; i++) {\n  console.log(i);\n}\n',
    'src/b.js': `function one() {\n${block.repeat(3)}}\n`,
    'src/c.js': `function two() {\n${block.repeat(3)}}\n`,
    'app.py': 'def run(items):\n    if not items:\n        return []\n    for item in items:\n        match item:\n            case 1:\n                print("one")\n            case _:\n                print("other")\n    return items\n',
    'run.sh': '#!/bin/bash\nif [ -f config ]; then\n  echo loaded\nelse\n  echo missing\nfi\ncase "$1" in\n  start) echo start ;;\n  stop) echo stop ;;\nesac\n',
    'README.md': 'docs only',
  };
  await withFixture('maint-eco', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'maintainability');
    assert.equal(signal, 'high');
    assert.equal(findings.searchSpace.complete, true);
    const branchByPath = Object.fromEntries(
      findings.branchPoints.map((record) => [record.path, record.counts]),
    );
    assert.deepEqual(branchByPath['src/a.js'], { ...ZERO_COUNTS, if: 1, loop: 1 });
    assert.deepEqual(branchByPath['src/b.js'], { ...ZERO_COUNTS, if: 3, else: 3 });
    assert.deepEqual(branchByPath['src/c.js'], { ...ZERO_COUNTS, if: 3, else: 3 });
    assert.deepEqual(branchByPath['app.py'], { ...ZERO_COUNTS, if: 1, loop: 1, match: 1, case: 2 });
    assert.deepEqual(branchByPath['run.sh'], { ...ZERO_COUNTS, if: 1, else: 1, case: 1 });
    assert.equal(findings.summary.branchPoints, 22, '2+6+6+5+3');
    assert.equal(findings.duplicateGroups.length, 1);
    assert.equal(findings.duplicateGroups[0].tokenCount, 55);
    assert.deepEqual(findings.duplicateGroups[0].spans.map(({ path }) => path), ['src/b.js', 'src/c.js']);
    assert.equal(findings.measurementUniverse.measuredFiles, 5);
    assert.equal(findings.measurementUniverse.eligibleFiles, 5);
    assert.deepEqual(findings.measurementUniverse.excludedLanguages, [{ extension: '.md', count: 1 }]);
    assert.equal(findings.summary.partialCoverage, false);
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes(dir), false, 'absolute paths never appear');
  });
});

test('T214 scanner: generated boundaries, declared tools, and measurement universe', async () => {
  const files = {
    'src/a.js': 'if (x) { y(); }\n',
    'vendor/dep.js': '// Code generated by x. DO NOT EDIT.\nvar lib = { q: 1 };\n',
    'min/app.min.js': 'var a=1;var b=2;',
    'app.py': '# code generated by protoc. do not edit\nx = 1\n',
    '.eslintrc.json': '{ "rules": {} }',
    'package.json': JSON.stringify({ eslintConfig: {}, devDependencies: { eslint: '9' } }),
    'README.md': 'docs only',
  };
  await withFixture('maint-bound', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const boundaries = findings.generatedBoundaries.map(({ path, reason, marker }) => [path, reason, marker]);
    assert.deepEqual(boundaries, [
      ['app.py', 'header_comment', 'code-generated'],
      ['min/app.min.js', 'filename_marker', 'minified-source'],
      ['vendor/dep.js', 'dir_marker', 'vendor'],
    ]);
    const tools = findings.toolEvidence.map(({ tool, kind, file }) => [tool, kind, file]);
    assert.ok(tools.some((entry) => entry[0] === 'eslint' && entry[1] === 'config' && entry[2] === '.eslintrc.json'));
    assert.ok(tools.some((entry) => entry[0] === 'eslint' && entry[1] === 'manifest' && entry[2] === 'package.json'));
    assert.equal(findings.measurementUniverse.configFilesInspected, 2);
    assert.equal(findings.measurementUniverse.filesInspected, 4);
    assert.deepEqual(findings.measurementUniverse.excludedLanguages,
      [{ extension: '.json', count: 1 }, { extension: '.md', count: 1 }]);
  });
});

test('T214 scanner: source-file caps produce partial coverage without dropping diagnostics', async () => {
  const files = {};
  for (let index = 0; index < 300; index++) {
    files[`src/f${String(index).padStart(3, '0')}.js`] = 'if (x) { y(); }\n';
  }
  await withFixture('maint-cap', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.summary.filesMeasured, 256);
    assert.equal(findings.summary.eligibleFiles, 300);
    assert.equal(findings.summary.capped.files, true);
    assert.equal(findings.summary.partialCoverage, true);
  });
});

test('T214 scanner: token cap inside one file is disclosed as a TOKEN_LIMIT diagnostic', async () => {
  const files = { 'src/big.js': 'x '.repeat(MAX_TOKENS_PER_FILE + 100) };
  await withFixture('maint-tokens', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.summary.filesMeasured, 1);
    assert.equal(findings.summary.capped.tokens, true);
    assert.equal(findings.summary.partialCoverage, true);
    assert.ok(findings.diagnostics.some(({ reason }) => reason === 'TOKEN_LIMIT'));
  });
});

test('T214 scanner: extensionless files are excluded with a disclosed no-extension marker', async () => {
  const files = {
    'Makefile': 'all:\n\t@echo hi\n',
    'LICENSE': 'MIT License\n',
    'CHANGELOG': '## v1\n',
    'src/a.js': 'if (x) { y(); }\n',
    'README.md': 'docs only',
  };
  await withFixture('maint-noext', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.summary.filesMeasured, 1);
    assert.equal(findings.summary.eligibleFiles, 1);
    assert.equal(findings.summary.partialCoverage, false);
    assert.deepEqual(findings.measurementUniverse.excludedLanguages, [
      { extension: '.md', count: 1 },
      { extension: 'no-extension', count: 3 },
    ]);
    assert.equal(findings.measurementUniverse.excludedFiles, 4);
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /no-extension/);
    assert.match(markdown, /\| no-extension \| 3 \|/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: editor-backup and non-ASCII extensions survive and disclose under the other sentinel', async () => {
  const files = {
    'src/a.js': 'if (x) { y(); }\n',
    'src/a.js~': 'vim swap backup\n',
    'src/b.bak~': 'emacs backup\n',
    'src/doc.日本語': 'non-ascii notes\n',
    'README.md': 'docs only',
  };
  await withFixture('maint-unsafe-ext', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'maintainability');
    assert.equal(signal, 'high');
    assert.equal(findings.summary.filesMeasured, 1);
    assert.equal(findings.summary.eligibleFiles, 1);
    assert.equal(findings.summary.partialCoverage, false);
    assert.deepEqual(findings.measurementUniverse.excludedLanguages, [
      { extension: '.md', count: 1 },
      { extension: 'other', count: 3 },
    ]);
    assert.equal(findings.measurementUniverse.excludedFiles, 4);
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('.js~'), false, 'raw unsafe extensions are never disclosed');
    assert.equal(serialized.includes('日本語'), false, 'non-ASCII extensions are never disclosed');
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /Unsupported languages excluded from measurement/);
    assert.match(markdown, /\| other \| 3 \|/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: malformed UTF-8 eligible file is disclosed without a false file-cap note', async () => {
  const files = {
    'src/good.js': 'if (x) { y(); }\n',
    'src/broken.js': Buffer.from([0xff, 0xfe, 0xfd]),
  };
  await withFixture('maint-badutf', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.summary.filesMeasured, 1);
    assert.equal(findings.summary.eligibleFiles, 2);
    assert.equal(findings.searchSpace.capped, false);
    assert.equal(findings.searchSpace.malformed, true);
    assert.equal(findings.summary.capped.files, true, 'an eligible file was not measured');
    assert.ok(findings.diagnostics.some(({ reason, status }) => reason === 'MALFORMED' && status === 'unverified'));
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /some eligible source files were not measured/);
    assert.equal(markdown.includes('source file cap reached'), false);
    assert.match(markdown, /no repository-wide conclusion is drawn/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: a 40-file identical block discloses the occurrence cap end to end', async () => {
  const body = 'function alpha(x) {\n  if (x) { return x * 2; }\n  return x + 1;\n}\nfunction beta(y) {\n  for (let i = 0; i < y; i++) { sum += i; }\n  return sum;\n}\nfunction gamma(z) {\n  while (z) { z--; }\n  return z;\n}\n';
  const files = {};
  for (let index = 0; index < 40; index++) {
    files[`src/dup${String(index).padStart(2, '0')}.js`] = body;
  }
  await withFixture('maint-occ', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.summary.duplicateGroups, 1);
    assert.equal(findings.duplicateGroups[0].spans.length, 32);
    assert.equal(findings.summary.capped.occurrences, true);
    assert.equal(findings.summary.partialCoverage, true);
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /duplicate occurrence cap reached/);
    assert.match(markdown, /no repository-wide conclusion is drawn/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: non-ASCII generated header survives and discloses without leaking raw text', async () => {
  const files = {
    'gen.js': '// Code generated by ツールX. DO NOT EDIT.\nvar a = 1;\n',
    'ok.js': 'if (x) { y(); }\n',
  };
  await withFixture('maint-nonascii-header', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'maintainability');
    assert.equal(signal, 'high');
    assert.equal(findings.summary.filesMeasured, 2);
    const boundary = findings.generatedBoundaries.find(({ path }) => path === 'gen.js');
    assert.deepEqual(boundary, {
      path: 'gen.js', reason: 'header_comment', marker: 'code-generated',
      source: 'code-generated', line: 1,
    }, 'the boundary is disclosed without the raw non-ASCII header');
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('ツールX'), false, 'non-ASCII header text must never leak');
    assert.equal(serialized.includes(dir), false);
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /gen\.js/);
    assert.match(markdown, /code-generated/);
    assert.equal(markdown.includes('ツールX'), false, 'markdown never leaks the raw header text');
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: privacy canaries never reach the model', async () => {
  const files = {
    'gen.js': '// Code generated by alice@example.test. DO NOT EDIT.\nvar a = 1;\n',
    'ok.js': 'if (x) { y(); }\n',
  };
  await withFixture('maint-privacy', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('alice@example.test'), false, 'email must never leak');
    assert.equal(serialized.includes(dir), false);
    assert.deepEqual(findings.generatedBoundaries, [], 'unsafe boundary is not persisted');
    assert.ok(findings.diagnostics.some(({ reason }) => reason === 'PRIVACY'));
  });
});

test('T214 scanner: empty repository yields zero measured files and no conclusions', async () => {
  const files = { 'README.md': 'docs only' };
  await withFixture('maint-empty', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'maintainability');
    assert.equal(signal, 'low');
    assert.equal(findings.summary.filesMeasured, 0);
    assert.equal(findings.summary.eligibleFiles, 0);
    assert.equal(findings.measurementUniverse.excludedFiles, 1);
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /No supported source files were measured/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: deterministic repeated runs are byte-identical and T202-compatible', async () => {
  const files = {
    'src/a.js': 'if (a) { b(); }\nconst x = q ? r : s;\n',
    'src/b.py': 'for i in range(3):\n    print(i)\n',
  };
  await withFixture('maint-determinism', files, async (dir) => {
    const first = await scan(dir, {});
    const second = await scan(dir, {});
    assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
    assert.equal(Object.isFrozen(first.findings), true);
    assert.deepEqual(Object.keys(first.findings.searchSpace).toSorted(), [
      'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
      'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
      'recordLimit', 'recordsInspected', 'supported',
    ]);
  });
});

test('T214 scanner: rust and shell dialects contribute measurements without extrapolation', async () => {
  const files = {
    'src/main.rs': 'fn f(x: Option<i32>) -> i32 { match x { Some(v) if v > 0 => v, None => 0, } }\n',
    'run.sh': 'cat <<EOF\nif fake\nEOF\necho done\n',
    'unknown.go': 'package main\nfunc main() {}\n',
  };
  await withFixture('maint-rs', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const rs = findings.branchPoints.find(({ path }) => path === 'src/main.rs');
    assert.deepEqual(rs.counts, { ...ZERO_COUNTS, if: 1, match: 1 });
    const sh = findings.branchPoints.find(({ path }) => path === 'run.sh');
    assert.deepEqual(sh.counts, ZERO_COUNTS, 'heredoc body is not counted');
    assert.deepEqual(findings.measurementUniverse.excludedLanguages,
      [{ extension: '.go', count: 1 }], 'unsupported language is excluded with disclosure');
  });
});

test('T214 scanner: complexity distributions and unused-code markers end to end', async () => {
  const files = {
    'src/a.js': 'function one(x) {\n  if (x) { return x; }\n  if (x > 1) { return x - 1; }\n  return 0;\n}\nfunction two(y) {\n  return y ? 1 : 0;\n}\n',
    'src/lib.rs': '#![allow(dead_code)]\nfn value() -> u8 { 1 }\n',
    'app.py': 'import os  # noqa: F401\ndef run(items):\n    if not items:\n        return []\n    return items\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { noUnusedLocals: true } }),
    'README.md': 'docs',
  };
  await withFixture('maint-craft', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const byPath = Object.fromEntries(findings.complexityRecords.map((record) => [record.path, record]));
    assert.deepEqual(byPath['src/a.js'].functions.map(({ functionName, complexity }) => [functionName, complexity]),
      [['one', 2], ['two', 1]]);
    assert.deepEqual(byPath['src/a.js'].distribution, { min: 1, median: 1, p95: 2, max: 2 });
    assert.deepEqual(byPath['app.py'].functions.map(({ functionName, complexity }) => [functionName, complexity]),
      [['run', 1]]);
    assert.deepEqual(byPath['src/lib.rs'].functions.map(({ functionName, complexity }) => [functionName, complexity]),
      [['value', 0]]);
    assert.deepEqual(byPath['src/lib.rs'].distribution, { min: 0, median: 0, p95: 0, max: 0 });
    assert.deepEqual(findings.deadCode, [
      { kind: 'allow_dead_code', path: 'src/lib.rs', count: 1 },
      { kind: 'no_unused_locals', path: 'tsconfig.json', count: 1 },
      { kind: 'unused_import', path: 'app.py', count: 1 },
    ]);
    assert.equal(findings.summary.filesMeasured, 3);
    assert.equal(findings.summary.partialCoverage, false);
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes(dir), false);
  });
});

test('T214 scanner: a token=... line in a dead-code artifact is never retained', async () => {
  const files = {
    'src/lib.rs': '#[allow(dead_code)]\nconst SECRET_TOKEN = "ghp_\x73uperSecretValue";\n',
    'app.py': 'import os  # noqa: F401\ntoken=super-secret-value\n',
    'README.md': 'docs',
  };
  await withFixture('maint-craft-privacy', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('super-secret-value'), false, 'the token= value must never be retained');
    assert.equal(serialized.includes('ghp_\x73uperSecretValue'), false, 'the secret literal must never be retained');
    assert.equal(serialized.includes(dir), false);
    assert.ok(findings.deadCode.some(({ kind }) => kind === 'allow_dead_code'), 'allow attributes are still counted');
    assert.ok(findings.deadCode.some(({ kind }) => kind === 'unused_import'), 'noqa markers are still counted');
    assert.ok(findings.complexityRecords.length >= 1, 'complexity records survive privacy filtering');
    assert.equal(findings.summary.partialCoverage, false);
  });
});

test('T214 scanner: per-file function caps are disclosed as COMPLEXITY_CAP', async () => {
  let body = '';
  for (let index = 0; index < MAINTAINABILITY_LIMITS.complexityFunctions + 5; index++) {
    body += `function fn${String(index).padStart(3, '0')}() { return ${index}; }\n`;
  }
  const files = { 'src/many.js': body };
  await withFixture('maint-fncap', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const record = findings.complexityRecords.find(({ path }) => path === 'src/many.js');
    assert.equal(record.functionsCapped, true);
    assert.equal(record.functions.length, MAINTAINABILITY_LIMITS.complexityFunctions);
    assert.ok(findings.diagnostics.some(({ path, reason }) =>
      path === 'src/many.js' && reason === 'COMPLEXITY_CAP'));
    const markdown = renderMaintainability('repo', findings);
    assert.match(markdown, /Function records were capped/);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

test('T214 scanner: empty repo keeps complete search space and empty craft streams', async () => {
  const files = { 'README.md': 'docs' };
  await withFixture('maint-empty-craft', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.searchSpace.complete, true);
    assert.deepEqual(findings.complexityRecords, []);
    assert.deepEqual(findings.deadCode, []);
    const markdown = renderMaintainability('repo', findings);
    assert.equal(markdown.includes('Complexity distribution'), false);
    assert.equal(markdown.includes('Unused-code markers'), false);
    assert.deepEqual(findVoiceHits(markdown), []);
  });
});

// ---------------------------------------------------------------------------
// Inertness and source policy
// ---------------------------------------------------------------------------

test('T214 inertness: maintainability modules never touch execution surfaces', async () => {
  const owned = [
    'lib/scan/deep/maintainability/tokenizer.mjs',
    'lib/scan/deep/maintainability/duplicates.mjs',
    'lib/scan/deep/maintainability/model.mjs',
    'lib/scan/deep/maintainability/scanner.mjs',
    'lib/scan/providers/maintainability.mjs',
    'lib/scan/render/maintainability.mjs',
  ];
  for (const relative of owned) {
    const source = await readFile(join(LIB_ROOT, '..', relative), 'utf8');
    for (const forbidden of [
      "from 'node:fs", "from 'node:child_process", "from 'node:process", "from 'node:vm",
      "from 'node:module", 'require(', 'execFile(', 'execSync(', 'spawn(', 'writeFile(',
    ]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not contain ${forbidden}`);
    }
  }
  const providerSource = await readFile(join(LIB_ROOT, 'scan', 'providers', 'maintainability.mjs'), 'utf8');
  const rendererSource = await readFile(join(LIB_ROOT, 'scan', 'render', 'maintainability.mjs'), 'utf8');
  for (const source of [providerSource, rendererSource]) {
    for (const surface of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
      assert.equal(source.includes(surface), false, 'inert modules expose no execution surfaces');
    }
  }
});
