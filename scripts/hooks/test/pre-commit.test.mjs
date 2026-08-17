import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../pre-commit', import.meta.url));

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function write(root, name, content) {
  fs.writeFileSync(path.join(root, name), content);
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-hook-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Hook Test');
  git(root, 'config', 'user.email', 'hook-test@example.invalid');
  write(root, 'tracked.txt', 'base\n');
  write(root, 'tracked.mjs', 'export const value = 1;\n');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  write(root, 'scripts/check-suite.mjs', "console.log('CHECK_SUITE');\n");
  write(root, 'scripts/sync-skill-boilerplate.mjs', "console.log('SYNC');\n");
  fs.mkdirSync(path.join(root, 'scripts/hooks'), { recursive: true });
  fs.copyFileSync(hook, path.join(root, 'scripts/hooks/pre-commit'));
  fs.chmodSync(path.join(root, 'scripts/hooks/pre-commit'), 0o755);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  git(root, 'config', 'core.hooksPath', 'scripts/hooks');
  return root;
}

function runHook(root, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/hooks/pre-commit'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function commit(root, message, ...args) {
  return spawnSync('git', ['commit', '-m', message, ...args], { cwd: root, encoding: 'utf8' });
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('clean, staged-only, staged deletion, and untracked files pass', () => {
  const root = setup();
  try {
    for (const [name, mutate] of [
      ['clean', () => {}],
      ['staged-only', () => { write(root, 'tracked.txt', 'staged\n'); git(root, 'add', 'tracked.txt'); }],
      ['staged-deletion', () => { fs.unlinkSync(path.join(root, 'tracked.txt')); git(root, 'add', '-u'); }],
      ['untracked', () => { write(root, 'untracked.txt', 'ignored by preflight\n'); }],
    ]) {
      const result = runHook(root);
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.match(result.stdout, /CHECK_SUITE/);
      assert.match(result.stdout, /SYNC/);
      if (name === 'staged-only') git(root, 'reset', '-q', '--hard', 'HEAD');
      if (name === 'staged-deletion') {
        git(root, 'reset', '-q', '--hard', 'HEAD');
        fs.rmSync(path.join(root, 'untracked.txt'), { force: true });
      }
    }
  } finally {
    cleanup(root);
  }
});

test('unstaged-only, mixed-file, and unstaged deletion fail before gates', () => {
  for (const [name, mutate] of [
    ['unstaged-only', (root) => write(root, 'tracked.txt', 'unstaged\n')],
    ['mixed-file', (root) => { write(root, 'tracked.txt', 'staged\n'); git(root, 'add', 'tracked.txt'); write(root, 'tracked.txt', 'unstaged\n'); }],
    ['unstaged-deletion', (root) => fs.unlinkSync(path.join(root, 'tracked.txt'))],
  ]) {
    const root = setup();
    try {
      mutate(root);
      const result = runHook(root);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /tracked working-tree changes must be staged/);
      assert.doesNotMatch(result.stdout, /CHECK_SUITE|SYNC/);
    } finally {
      cleanup(root);
    }
  }
});

test('git commit --no-verify bypasses the hook', () => {
  const root = setup();
  try {
    write(root, 'tracked.txt', 'staged but bypassed\n');
    git(root, 'add', 'tracked.txt');
    write(root, 'tracked.txt', 'unstaged but bypassed\n');
    const result = commit(root, 'bypass', '--no-verify');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /tracked working-tree changes must be staged|CHECK_SUITE|SYNC/);
  } finally {
    cleanup(root);
  }
});

test('clean staged commit invokes gates before staged syntax checks', () => {
  const root = setup();
  try {
    write(root, 'tracked.mjs', 'export const value = 2;\n');
    git(root, 'add', 'tracked.mjs');
    const result = commit(root, 'gated commit');
    assert.equal(result.status, 0, result.stderr);
    const output = `${result.stdout}${result.stderr}`;
    assert.ok(output.indexOf('CHECK_SUITE') < output.indexOf('SYNC'), output);
    assert.equal(git(root, 'status', '--short'), '');
  } finally {
    cleanup(root);
  }
});
