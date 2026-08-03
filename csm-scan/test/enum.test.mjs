import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { enumerate, byExtension, sumSizes } from '../lib/scan/shared/enum.mjs';

function writeRel(root, rel, content) {
  const full = join(root, ...rel.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

test('enumerate filters caches/dist, keeps lockfile, sums real bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csm-scan-enum-'));

  const contents = {
    'pkg/mod.py': 'import mod\n',
    'pkg/main.py': "from . import mod\nprint('hi')\n",
    '.hypothesis/constants/deadbeef': 'cache-bytes\n',
    'dist/out.js': "console.log('build')\n",
    'pkg/uv.lock': '[[lock]]\n',
  };

  for (const [rel, content] of Object.entries(contents)) {
    writeRel(root, rel, content);
  }

  try {
    const result = await enumerate(root);

    assert.ok(result.files.includes('pkg/mod.py'), 'pkg/mod.py should be present');
    assert.ok(result.files.includes('pkg/main.py'), 'pkg/main.py should be present');
    assert.ok(result.files.includes('pkg/uv.lock'), 'pkg/uv.lock should be present');
    assert.ok(
      !result.files.some((f) => f.startsWith('.hypothesis/')),
      '.hypothesis cache should be excluded',
    );
    assert.ok(
      !result.files.some((f) => f.startsWith('dist/')),
      'dist build output should be excluded',
    );

    assert.equal(result.extCounts['.py'], 2, '.py count should be 2');

    const expectedBytes = ['pkg/mod.py', 'pkg/main.py', 'pkg/uv.lock']
      .map((rel) => Buffer.byteLength(contents[rel]))
      .reduce((a, b) => a + b, 0);
    assert.equal(
      result.totalBytes,
      expectedBytes,
      'totalBytes must equal real byte sum of included files',
    );

    assert.equal(byExtension(result.files)['.py'], 2);
    assert.equal(
      sumSizes(root, result.files),
      expectedBytes,
      'sumSizes must match expected real byte total',
    );

    assert.equal(result.totalFiles, result.files.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enumerate throws on non-1 rg failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csm-scan-enum-'));
  try {
    await assert.rejects(
      enumerate('/proc/1/nonexistent-scan-dir-xyz'),
      Error,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
