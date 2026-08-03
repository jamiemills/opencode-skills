import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './harness.mjs';
import { scan } from '../lib/scan/deep/structure.mjs';

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
