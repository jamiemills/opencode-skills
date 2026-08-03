import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countComments } from '../lib/scan/shared/comments.mjs';

test('python: counts hash comments and triple-quoted docstring blocks', () => {
  const py = [
    '"""Module docstring."""',
    '',
    'def add(a, b):',
    '    """Add two numbers."""',
    '    return a + b',
    '',
    '# a hash comment',
    'x = 1',
  ].join('\n');
  const r = countComments(py, 'python');
  // 2 docstring lines + 1 hash comment = 3 comment lines.
  assert.equal(r.commentLines, 3, JSON.stringify(r));
  // non-blank denominator = 6 (matches documentation.mjs behaviour).
  assert.equal(r.totalLines, 6, JSON.stringify(r));
  assert.equal(r.blankLines, 2, JSON.stringify(r));
});

test('python: multi-line triple-quoted block fully counted across lines', () => {
  const py = ['"""', 'Line one of docstring.', 'Line two of docstring.', '"""', 'x = 1'].join('\n');
  const r = countComments(py, 'python');
  assert.equal(r.commentLines, 4, JSON.stringify(r));
  assert.equal(r.totalLines, 5, JSON.stringify(r));
});

test('python: single-quoted triple docstrings counted too', () => {
  const py = ["'''single-quoted module doc.'''", 'x = 1'].join('\n');
  const r = countComments(py, 'python');
  assert.equal(r.commentLines, 1, JSON.stringify(r));
  assert.equal(r.totalLines, 2, JSON.stringify(r));
});

test('rust: counts //, ///, //! and /* */ (fixes P0-15 hash-only bug)', () => {
  const rs = [
    '//! module doc',
    '/// item doc',
    '// plain comment',
    '/* block',
    '   spanning two lines',
    ' */',
    'fn main() {',
    '    let _x = 1; // trailing line comment (not counted as a comment line)',
    '}',
  ].join('\n');
  const r = countComments(rs, 'rust');
  // Counted: //! (1), /// (2), // plain (3), /* block (4), spanning (5), */ (6).
  // The trailing-comment line `let _x = 1; // ...` is NOT counted (starts with code).
  assert.equal(r.commentLines, 6, JSON.stringify(r));
});

test('rust: nested block comments counted and balanced', () => {
  const rs = ['/* outer', '   /* inner */', '   still outer', ' */', 'fn x() {}'].join('\n');
  const r = countComments(rs, 'rust');
  assert.equal(r.commentLines, 4, JSON.stringify(r));
  assert.equal(r.totalLines, 5, JSON.stringify(r));
});

test('javascript: counts // line and /* */ block incl. JSDoc /**', () => {
  const js = [
    '/**',
    ' * JSDoc body line.',
    ' */',
    'export function f() {',
    '  // inner comment',
    '  return 1;',
    '}',
  ].join('\n');
  const r = countComments(js, 'javascript');
  // /** (1), * body (2), */ (3), // inner (4) = 4 comment lines.
  assert.equal(r.commentLines, 4, JSON.stringify(r));
});

test('typescript uses the same rules as javascript', () => {
  const ts = ['// a comment', 'export const x: number = 1;', '/* block */'].join('\n');
  const r = countComments(ts, 'typescript');
  assert.equal(r.commentLines, 2, JSON.stringify(r));
});

test('shell: counts only # comments', () => {
  const sh = ['#!/usr/bin/env bash', 'set -euo pipefail', '', '# real comment', 'echo hi'].join('\n');
  const r = countComments(sh, 'shell');
  assert.equal(r.commentLines, 2, JSON.stringify(r)); // shebang + # real comment
  assert.equal(r.totalLines, 4, JSON.stringify(r));
  assert.equal(r.blankLines, 1, JSON.stringify(r));
});

test('blank lines are excluded from totalLines for every ecosystem', () => {
  for (const eco of ['python', 'rust', 'javascript', 'typescript', 'shell']) {
    const marker = eco === 'python' || eco === 'shell' ? '#' : '//';
    const src = [`${marker} comment`, '', '', 'x = 1'].join('\n');
    const r = countComments(src, eco);
    assert.equal(r.totalLines, 2, `${eco}: ${JSON.stringify(r)}`);
    assert.equal(r.blankLines, 2, `${eco}: ${JSON.stringify(r)}`);
  }
});

test('unknown ecosystem returns zeros (never throws)', () => {
  const r = countComments('x = 1', 'ruby');
  assert.deepEqual(r, { commentLines: 0, totalLines: 0, blankLines: 0 });
  assert.doesNotThrow(() => countComments(null, 'python'));
});
