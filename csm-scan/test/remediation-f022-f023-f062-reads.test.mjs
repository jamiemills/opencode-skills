// F-022 / F-023 / F-062 — bounded reads and symlink containment.
//
// Before this fix, several deep scanners called `readFileSync` and only
// discarded content ABOVE a bound after the whole file was allocated (F-022),
// and well-known-file reads followed symlinks out of the repository (F-023).
// The shared helper `shared/reads.mjs` (readBoundedFile) now statSync-gates
// before reading and enforces realpath containment.
//
// Seeded fixtures only (no host state). Uses `node:test` and the shared harness.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { readBoundedFile } from '../lib/scan/shared/reads.mjs';

const LIB_SCAN = fileURLToPath(new URL('../lib/scan', import.meta.url));

function fixtureDir(name) {
  const dir = mkdtempSync(join(tmpdir(), `reads-${name}-`));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('F-022/F-062: a file above the byte bound is never read (null), a small file reads', () => {
  const { dir, cleanup } = fixtureDir('bound');
  try {
    const small = join(dir, 'small.txt');
    writeFileSync(small, 'hello world');
    assert.equal(readBoundedFile(small), 'hello world');
    assert.equal(readBoundedFile(small, { byteLimit: 5 }), null, 'oversize must read null');

    const big = join(dir, 'big.txt');
    writeFileSync(big, 'x'.repeat(1024 * 1024 + 8));
    assert.equal(readBoundedFile(big), null, 'a multi-MB file must never be allocated');
    assert.equal(readBoundedFile(join(dir, 'missing.txt')), null, 'missing file reads null');
  } finally {
    cleanup();
  }
});

test('F-023: a symlinked well-known name resolving OUTSIDE the repo is never read', () => {
  const { dir, cleanup } = fixtureDir('containment');
  try {
    // The target lives OUTSIDE the repo root (a sibling temp dir).
    const outsideDir = mkdtempSync(join(tmpdir(), 'reads-outside-'));
    const outside = join(outsideDir, 'outside.txt');
    writeFileSync(outside, 'host-secret');
    const link = join(dir, '.env');
    symlinkSync(outside, link);
    assert.equal(
      readBoundedFile(link, { containmentRoot: dir }),
      null,
      'a symlink to a file outside the repo root must read null',
    );
    rmSync(outsideDir, { recursive: true, force: true });
    const inside = join(dir, 'real.txt');
    writeFileSync(inside, 'repo-content');
    assert.equal(readBoundedFile(inside, { containmentRoot: dir }), 'repo-content');
  } finally {
    cleanup();
  }
});

test('F-023: a symlink resolving INSIDE the repo is read normally', () => {
  const { dir, cleanup } = fixtureDir('inside-link');
  try {
    writeFileSync(join(dir, 'target.txt'), 'inside-content');
    symlinkSync('target.txt', join(dir, 'link.txt'));
    assert.equal(
      readBoundedFile(join(dir, 'link.txt'), { containmentRoot: dir }),
      'inside-content',
    );
  } finally {
    cleanup();
  }
});

test('F-062: the deep scanners route their whole-file reads through the shared helper', () => {
  // The legacy scanners that previously allocated unbounded files must use the
  // shared bounded reader and no longer perform their own `readFileSync`
  // whole-file reads. (Source-level guard for the shared-helper migration.)
  const modules = [
    'deep/security.mjs',
    'deep/config.mjs',
    'deep/conventions.mjs',
    'deep/testing.mjs',
    'deep/documentation.mjs',
    'deep/operations.mjs',
  ];
  for (const rel of modules) {
    const source = readFileSync(join(LIB_SCAN, rel), 'utf8');
    assert.ok(source.includes('readBoundedFile'), `${rel} must use the shared bounded reader`);
    assert.ok(!source.includes('readFileSync'), `${rel} must not perform raw whole-file reads`);
  }
});
