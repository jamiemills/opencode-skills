import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withFixture, surveyOverview } from './harness.mjs';
import { scan } from '../lib/scan/deep/documentation.mjs';
import { renderDocumentation } from '../lib/scan/render/documentation.mjs';
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

  // T012 fields: reference artifacts, SECURITY.md, doc toolchain, all present.
  assert.ok(f.referenceDocs && typeof f.referenceDocs.present === 'boolean');
  assert.ok(f.security && typeof f.security.present === 'boolean');
  assert.ok(f.docToolchain && typeof f.docToolchain.present === 'boolean');

  console.log('perplexity-cli badgeTypes:', JSON.stringify(f.readme.badgeTypes));
  console.log('perplexity-cli commentRatio:', JSON.stringify(f.commentRatio));
  console.log('perplexity-cli docstringDialect:', JSON.stringify(f.docstringDialect));
  console.log('perplexity-cli docStyle:', JSON.stringify(f.docStyle));
  console.log('perplexity-cli referenceDocs:', JSON.stringify(f.referenceDocs));
  console.log('perplexity-cli security:', JSON.stringify(f.security));
  console.log('perplexity-cli docToolchain:', JSON.stringify(f.docToolchain));
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

// ---------------------------------------------------------------------------
// T012 — reference artifacts, SECURITY.md, doc toolchain, comment-ratio anchor
// ---------------------------------------------------------------------------

function largeReferenceDoc() {
  const card = [
    '# Quality Gates',
    '',
    'This guide uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) in normative statements.',
    '',
    '## Agent Replication Cards',
    '',
    'Every active gate has a card with a stable ID: `make.check`, `hook.pre-commit.lint`, `ci.ci.pytest`.',
    '',
  ].join('\n');
  return Array.from({ length: 20 }, () => card).join('\n\n');
}

test('T012 reference artifact: a large QUALITY_GATES.md is reported with its markers', async () => {
  await withFixture('doc-ref-gates', {
    'QUALITY_GATES.md': largeReferenceDoc(),
    'README.md': '# repo\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['QUALITY_GATES.md', 'README.md'] });
    const rd = res.findings.referenceDocs;

    assert.ok(rd && rd.present, 'referenceDocs.present must be true');
    assert.equal(rd.docs.length, 1, `expected 1 reference doc, got ${JSON.stringify(rd.docs)}`);
    assert.equal(rd.docs[0].path, 'QUALITY_GATES.md');
    assert.ok(rd.docs[0].lines >= 100, `reference doc must be large, got ${rd.docs[0].lines} lines`);
    assert.ok(rd.docs[0].markers.includes('RFC 2119 vocabulary'), JSON.stringify(rd.docs[0].markers));
    assert.ok(rd.docs[0].markers.includes('stable gate IDs'), JSON.stringify(rd.docs[0].markers));
    assert.ok(rd.docs[0].markers.includes('agent replication cards'), JSON.stringify(rd.docs[0].markers));
  });
});

test('T012 reference artifact: a small non-marker doc is not a reference artifact', async () => {
  await withFixture('doc-ref-small', {
    'REFERENCE.md': '# Small reference\n\nSome notes.\n',
    'README.md': '# repo\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['REFERENCE.md', 'README.md'] });
    const rd = res.findings.referenceDocs;
    assert.ok(rd && !rd.present, 'small doc without markers must not be flagged');
    assert.deepEqual(rd.docs, []);
  });
});

test('T012 SECURITY.md presence and purpose token', async () => {
  const security = [
    '# Security Policy',
    '',
    '## Reporting Vulnerabilities',
    '',
    'Please report security issues privately to the maintainer.',
    '',
    '## Token and Cookie Handling',
    '',
    'Authentication tokens are stored in local encrypted files.',
    '',
  ].join('\n');

  await withFixture('doc-security', {
    'SECURITY.md': security,
    'README.md': '# repo\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['SECURITY.md', 'README.md'] });
    const s = res.findings.security;

    assert.ok(s && s.present, 'SECURITY.md must be present');
    assert.ok(s.path.endsWith('SECURITY.md'), `expected a SECURITY.md path, got ${s.path}`);
    assert.equal(s.purpose, 'vulnerability reporting', `purpose token mismatch: ${JSON.stringify(s)}`);
  });
});

test('T012 doc toolchain scripts referenced in Makefile and opencode config', async () => {
  const makefile = [
    'configure-opencode:',
    '\t@ok=true; \\',
    '\tfor f in pre-push-docs-check.ts; do \\',
    '\t\tif [ ! -f .opencode/plugins/$$f ]; then echo "MISSING: $$f"; ok=false; fi; \\',
    '\tdone',
    '',
  ].join('\n');
  const opencode = { plugin: ['.opencode/plugins/pre-push-docs-check.ts', '.opencode/scripts/check-config.ts'] };

  await withFixture('doc-toolchain', {
    'Makefile': makefile,
    'opencode.json': `${JSON.stringify(opencode, null, 2)}\n`,
    'README.md': '# repo\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['Makefile', 'opencode.json', 'README.md'] });
    const dt = res.findings.docToolchain;

    assert.ok(dt && dt.present, 'doc toolchain must be present');
    assert.ok(dt.scripts.includes('pre-push-docs-check'), JSON.stringify(dt.scripts));
    assert.ok(dt.scripts.includes('check-config'), JSON.stringify(dt.scripts));
    assert.ok(dt.sources.includes('Makefile'), JSON.stringify(dt.sources));
    assert.ok(dt.sources.includes('opencode.json'), JSON.stringify(dt.sources));
  });
});

test('T012 comment-ratio denominator renders as total lines (single anchor)', () => {
  const findings = {
    readme: { present: false },
    contributing: { present: false },
    license: { present: false },
    changelog: { present: false, format: 'none' },
    adrs: [],
    commentRatio: { ratio: 18.6, commentLines: 1359, codeLines: 5941 },
    todoCount: 0,
  };

  const output = renderDocumentation('repo', findings);
  assert.match(
    output,
    /- \*\*Comment ratio\*\*: 18\.6% \(1359 comment \/ 7300 total lines\)/,
    `expected the total-lines denominator: ${output}`,
  );
  assert.ok(!output.includes('code lines'), 'label must not print code lines');
});
