import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './harness.mjs';
import { files as binariesOnlyFiles } from './fixtures/binaries.mjs';
import { scan } from '../lib/scan/deep/structure.mjs';
import { renderStructure } from '../lib/scan/render/structure.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';

function buildHexFiles(count, dir) {
  const obj = {};
  for (let i = 0; i < count; i++) {
    obj[`${dir}/${i.toString(16).padStart(8, '0')}`] = 'x';
  }
  return obj;
}

test('structure scan excludes cache dirs and bounds the tree', async () => {
  const files = {
    ...buildHexFiles(50, '.hypothesis/constants'),
    'src/pkg/mod.py': 'import mod\n',
    'src/pkg/main.py': "from . import mod\n",
    'README.md': '# demo\n',
  };

  await withFixture('struct', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;

    assert.equal(res.dimension, 'structure');
    assert.ok(!f.tree.includes('.hypothesis'), `tree must not include .hypothesis:\n${f.tree}`);
    assert.ok(
      f.tree.split('\n').length < 30,
      `tree too tall (${f.tree.split('\n').length} lines):\n${f.tree}`,
    );
    assert.equal(f.fileCounts['.py'], 2);
    assert.equal(f.totalFiles, 3);
    assert.equal(typeof f.depth, 'number');
    assert.ok(f.depth >= 2, `depth should be >= 2, got ${f.depth}`);
  });
});

test('structure scan caps wide directories with ellipsis collapse', async () => {
  const files = {
    ...buildHexFiles(30, 'pkg'),
    'README.md': '# demo\n',
  };

  await withFixture('structcap', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;

    assert.ok(f.tree.includes('… +'), `tree should contain ellipsis collapse:\n${f.tree}`);
    assert.ok(
      f.tree.split('\n').length < 40,
      `tree too tall (${f.tree.split('\n').length} lines):\n${f.tree}`,
    );
    assert.equal(f.totalFiles, 31);
  });
});

test('structure renderer falls back to single-scope when git data is absent', () => {
  const out = renderStructure('demo', {
    tree: '.\n└── mod.py',
    fileCounts: { py: 1, md: 1 },
    totalFiles: 2,
  });

  const expected = [
    '## Repository Structure — `demo`',
    '',
    'Directory tree (max depth 4):',
    '',
    '```',
    '.\n└── mod.py',
    '```',
    '',
    '| Extension | Files |',
    '|-----------|------:|',
    '| .py | 1 |',
    '| .md | 1 |',
    '| **Total** | **2** |',
    '',
  ].join('\n');
  assert.equal(out, expected, 'single-scope fallback must be byte-identical');
  assert.ok(!out.includes('git-tracked'), 'no git caveat may appear without git data');
});

test('structure renderer reports dual-scope totals with a scope caveat', () => {
  const out = renderStructure('demo', {
    tree: '.\n└── mod.py',
    fileCounts: { py: 2, md: 1 },
    totalFiles: 3,
    gitTrackedFileCounts: { py: 3, toml: 1, md: 1 },
    gitTrackedTotalFiles: 5,
  });

  assert.match(
    out,
    /> Total Files: 5 git-tracked \(3 in rg-scoped enumeration, excluding hidden\/gitignored paths\)\./,
    'scope caveat must disclose both totals and the rg-scoped exclusion rule',
  );
  assert.match(out, /\| Extension \| Files \(rg-scoped\) \| Files \(git-tracked\) \|/);
  assert.match(out, /\| \*\*Total\*\* \| \*\*3\*\* \| \*\*5\*\* \|/);
  assert.match(out, /\| \.toml \| 0 \| 1 \|/, 'extensions only in the git scope must render with a zero rg count');
  assert.match(out, /\| \.py \| 2 \| 3 \|/);
});

test('structure renderer falls back to single-scope when only rg data exists in a git repo', () => {
  const out = renderStructure('demo', {
    tree: '.\n└── mod.py',
    fileCounts: { py: 1 },
    totalFiles: 1,
    gitTrackedFileCounts: null,
    gitTrackedTotalFiles: null,
  });
  assert.match(out, /\| Extension \| Files \|/);
  assert.match(out, /\| \*\*Total\*\* \| \*\*1\*\* \|/);
  assert.ok(!out.includes('git-tracked'));
});

test('structure scan omits gitTracked keys when git scope is unavailable (coverage stays 100%)', async () => {
  const files = {
    'src/pkg/mod.py': 'import mod\n',
    'README.md': '# demo\n',
  };

  await withFixture('structnogit', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;

    assert.equal(f.totalFiles, 2);
    assert.ok(!('gitTrackedTotalFiles' in f), 'gitTracked keys must be omitted when git scope is absent');
    assert.ok(!('gitTrackedFileCounts' in f), 'gitTracked keys must be omitted when git scope is absent');
    assert.equal(Object.keys(f).length, 5, 'structure findings must keep the original five keys');
  });
});

// Adversarial fixture (T010 gap FIX 2): a binaries-only repository must not
// crash the scanner or the full pipeline, and the structure facts stay honest.
test('structure scan is graceful and honest on a binaries-only repository', async () => {
  await withFixture('struct-binaries', binariesOnlyFiles, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;

    assert.equal(f.totalFiles, 2, 'both binary artifacts are enumerated');
    assert.equal(f.fileCounts['.png'], 1);
    assert.equal(f.fileCounts['.woff'], 1);
    assert.ok(f.tree.includes('logo.png'), `tree must list the png artifact:\n${f.tree}`);
    assert.ok(f.tree.includes('font.woff'), `tree must list the woff artifact:\n${f.tree}`);

    const result = await runExpandedPipeline({ repos: [dir], sink: () => '' });
    assert.deepEqual(result.repos[0].overview.languages, [],
      'a binaries-only repo detects no languages — none are fabricated');
    assert.equal(result.repos[0].overview.totalFiles, 2);
    assert.equal(result.expectedClaimCoverage.repos[0].perDimension.structure.status, 'observed',
      'structure reports its facts honestly instead of failing');
  });
});
