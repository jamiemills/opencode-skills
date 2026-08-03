import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withFixture, surveyOverview } from './harness.mjs';
import { scan } from '../lib/scan/deep/documentation.mjs';
import { scan as scanConventions } from '../lib/scan/deep/conventions.mjs';

const PERPLEXITY_REPO = '/home/jamiemills/code/projects/perplexity-cli';

test('detectBadges classifies each badge by its URL, not whole-document prose', async () => {
  // Exactly ONE shields.io badge with a PyPI URL; the token "npm" appears only
  // in prose. The old whole-document includes('npm') would wrongly tag 'npm'.
  const readme = [
    '# pxcli',
    '',
    '[![PyPI](https://img.shields.io/pypi/v/pxcli)](https://pypi.org/project/pxcli/)',
    '',
    'Install via npm is not supported — this is a Python package published to PyPI.',
    '',
    '## Usage',
    '',
    'These docs are npm-free.',
  ].join('\n');

  await withFixture('badges', { 'README.md': readme }, async (dir) => {
    const res = await scan(dir, {});
    const r = res.findings.readme;

    assert.equal(res.dimension, 'documentation');
    assert.equal(r.badges, 1, `expected exactly 1 badge, got ${r.badges}`);
    assert.deepEqual(r.badgeTypes, ['pypi']);
    assert.ok(!r.badgeTypes.includes('npm'), `must not include npm: ${JSON.stringify(r.badgeTypes)}`);
  });
});

test('python triple-quoted docstring lines are counted as comment lines', async () => {
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

  await withFixture('pydoc', { 'mod.py': py, 'README.md': '# py\n' }, async (dir) => {
    const res = await scan(dir, { ecosystems: { primary: 'python' }, files: ['mod.py'] });
    const cr = res.findings.commentRatio;

    // Two docstring lines + one hash comment = 3 comment lines.
    // Without docstring counting this would be 1.
    assert.equal(cr.commentLines, 3, `expected 3 comment lines (2 docstring + 1 hash), got ${cr.commentLines}`);
    assert.equal(cr.codeLines, 3, `expected 3 code lines, got ${cr.codeLines}`);
    assert.equal(cr.ratio, 50);
  });
});

test('blank lines are excluded from the comment-ratio denominator', async () => {
  const js = [
    'const x = 1;',
    '',
    '// a comment',
    '',
    'const y = 2;',
  ].join('\n');

  await withFixture('blanks', { 'mod.js': js, 'README.md': '# js\n' }, async (dir) => {
    const res = await scan(dir, { ecosystems: { primary: 'javascript' }, files: ['mod.js'] });
    const cr = res.findings.commentRatio;

    // 3 non-blank lines (2 code + 1 comment). Blanks must NOT inflate the count.
    assert.equal(cr.codeLines, 2, `expected 2 code lines, got ${cr.codeLines}`);
    assert.equal(cr.commentLines, 1);
    // 1/3 = 33.3...
    assert.equal(cr.ratio, 33.3);
  });
});

test('real perplexity-cli: badgeTypes exclude npm and commentRatio is numeric', async () => {
  if (!existsSync(PERPLEXITY_REPO)) {
    console.log(`[skip] ${PERPLEXITY_REPO} not present`);
    return;
  }

  const overview = await surveyOverview(PERPLEXITY_REPO);
  const res = await scan(PERPLEXITY_REPO, overview);
  const f = res.findings;

  assert.equal(res.dimension, 'documentation');
  assert.ok(Array.isArray(f.readme.badgeTypes));

  // README has a single PyPI badge; 'npm' appears only in prose, so it must not
  // leak into badgeTypes unless an actual npm badge URL is present.
  assert.ok(
    !f.readme.badgeTypes.includes('npm'),
    `badgeTypes must not include npm: ${JSON.stringify(f.readme.badgeTypes)}`,
  );

  assert.equal(typeof f.commentRatio.ratio, 'number');
  assert.ok(Number.isFinite(f.commentRatio.ratio));
  assert.ok(f.commentRatio.commentLines >= 0);
  assert.ok(f.commentRatio.codeLines >= 0);

  // Richness fields (T111): Python docstring dialect + JSDoc/TSDoc style.
  assert.ok(f.docstringDialect && typeof f.docstringDialect === 'object');
  assert.ok(f.docstringDialect.counts, 'docstringDialect.counts present');
  assert.ok(f.docStyle && typeof f.docStyle === 'object');

  console.log('perplexity-cli badgeTypes:', JSON.stringify(f.readme.badgeTypes));
  console.log('perplexity-cli commentRatio:', JSON.stringify(f.commentRatio));
  console.log('perplexity-cli docstringDialect:', JSON.stringify(f.docstringDialect));
  console.log('perplexity-cli docStyle:', JSON.stringify(f.docStyle));
});

// ---------------------------------------------------------------------------
// T111 systemic fix: documentation.commentRatio must agree EXACTLY with
// conventions.commentDensity because both now delegate counting to the shared
// helper (shared/comments.mjs) and sample the same files per ecosystem.
// ---------------------------------------------------------------------------

test('T111 cross-scanner: documentation commentRatio === conventions commentDensity (Python + Rust)', async () => {
  const py = [
    '"""Module docstring."""',
    'def add(a, b):',
    '    """Add two numbers."""',
    '    return a + b',
    '# a hash comment',
  ].join('\n');
  const rs = [
    '//! crate-level docs',
    '/// item docs',
    'fn main() { let _x = 1; }',
  ].join('\n');

  const files = { 'src/app.py': py, 'src/main.rs': rs };
  const overview = {
    languages: ['Python', 'Rust'],
    ecosystems: { primary: 'python', all: ['python', 'rust'] },
    files: ['src/app.py', 'src/main.rs'],
  };

  await withFixture('doc-xscan', files, async (dir) => {
    const doc = await scan(dir, overview);
    const conv = await scanConventions(dir, overview);

    const cr = doc.findings.commentRatio;
    const cd = conv.findings.commentDensity;
    assert.ok(cd, 'conventions should report a commentDensity string');

    // conventions density format: "P% (C comment lines / T total lines sampled)"
    const m = cd.match(/^([\d.]+)% \((\d+) comment lines \/ (\d+) total/);
    assert.ok(m, `unexpected density format: ${cd}`);
    const expRatio = parseFloat(m[1]);
    const expComments = parseInt(m[2], 10);
    const expTotal = parseInt(m[3], 10);

    assert.equal(
      cr.commentLines,
      expComments,
      `commentLines disagree: documentation=${cr.commentLines} conventions=${expComments}`,
    );
    assert.equal(
      cr.commentLines + cr.codeLines,
      expTotal,
      `totals disagree: documentation=${cr.commentLines + cr.codeLines} conventions=${expTotal}`,
    );
    assert.equal(
      cr.ratio,
      expRatio,
      `ratio disagrees: documentation=${cr.ratio} conventions=${expRatio}`,
    );
  });
});

test('T111: Python docstring dialect is classified (Google-style fixture)', async () => {
  const py = [
    'def add(a, b):',
    '    """Add two numbers.',
    '',
    '    Args:',
    '        a: first number',
    '        b: second number',
    '',
    '    Returns:',
    '        the sum',
    '    """',
    '    return a + b',
  ].join('\n');

  await withFixture('doc-dialect', { 'src/app.py': py }, async (dir) => {
    const res = await scan(dir, { ecosystems: { primary: 'python' }, files: ['src/app.py'] });
    const d = res.findings.docstringDialect;

    assert.ok(d, 'docstringDialect richness field should be present');
    assert.ok(d.counts, 'counts map present');
    assert.equal(d.filesAnalyzed, 1, `expected 1 file analyzed, got ${d.filesAnalyzed}`);
    assert.ok(d.counts.google > 0, `google count should be > 0: ${JSON.stringify(d.counts)}`);
    assert.equal(d.dominant, 'google', `expected google dominant, got ${d.dominant} (${JSON.stringify(d.counts)})`);
  });
});
