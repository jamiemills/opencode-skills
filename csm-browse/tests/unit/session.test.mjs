import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

const root = await freshSessionsRoot('csm-browse-session-');
const { validateSid, sessionDir, loadState, saveState, removeState } = await import('../../lib/session.mjs');

after(async () => { await removeRoot(root); });

test('SID regex accepts valid session ids', () => {
  for (const sid of ['a', 'abc', 'a1', 'session-x_y-2', 'z'.repeat(41), '0-start-digit', 'has--double_underscore']) {
    assert.doesNotThrow(() => validateSid(sid), `expected accept: ${sid}`);
  }
});

test('SID regex rejects invalid session ids', () => {
  const bad = ['', '-lead', '_lead', '.lead', 'Upper', 'a b', 'a.b', 'a:b', 'a/b', 'z'.repeat(42), null, undefined, 42, {}];
  for (const sid of bad) {
    assert.throws(() => validateSid(sid), `expected reject: ${String(sid)}`);
  }
});

test('sessionDir lives under the env-overridden root', () => {
  assert.equal(sessionDir('abc'), join(root, 'abc'));
});

test('saveState is atomic (tmp+rename) and round-trips via loadState', async () => {
  const state = { sid: 'rt-1', wsUrl: 'ws://127.0.0.1:1/x', internalPort: 9224, publicPort: 9225, nested: { a: [1, 2, 3] } };
  await saveState('rt-1', state);
  const dir = join(root, 'rt-1');
  assert.ok(existsSync(join(dir, 'state.json')), 'state.json missing');
  const entries = await readdir(dir);
  assert.ok(!entries.some((e) => e.includes('.tmp')), `leftover tmp file: ${entries}`);
  assert.deepEqual(await loadState('rt-1'), state);
});

test('loadState returns null when state.json is absent', async () => {
  assert.equal(await loadState('never-created'), null);
});

test('loadState rejects on malformed JSON', async () => {
  await mkdir(join(root, 'bad-1'), { recursive: true });
  await writeFile(join(root, 'bad-1', 'state.json'), '{not json', 'utf-8');
  await assert.rejects(loadState('bad-1'), SyntaxError);
});

test('removeState deletes the whole session dir', async () => {
  await saveState('rm-1', { a: 1 });
  await removeState('rm-1');
  assert.ok(!existsSync(join(root, 'rm-1')));
});
