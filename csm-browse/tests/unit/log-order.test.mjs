import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

// F-004 / F-005 regression gate, exercised through the real CLI (browse.mjs
// log console) so the ordering and exit-2 contract are pinned end-to-end.
//
// F-004: collectEvents rotates the live events.jsonl to events-<ts>.jsonl, so
// rotated files are OLDER than the main file. readEvents must return them in
// chronological order (rotated ascending, main last) — otherwise --tail
// returns the OLDEST events once any rotation has happened.
//
// F-005: hasAnyEventsFile is async; callers must await it or the Promise is
// always truthy and the exit-2 diagnostic ("no events file") is dead code.

const root = await freshSessionsRoot('csm-browse-log-order-');
const SKILL_DIR = fileURLToPath(new URL('../..', import.meta.url));
const BROWSE = join(SKILL_DIR, 'scripts', 'browse.mjs');

after(async () => { await removeRoot(root); });

async function makeSession(sid, files) {
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, 'state.json'), JSON.stringify({
    sid,
    sessionDir: dir
  }), { encoding: 'utf-8' });
  for (const [name, lines] of Object.entries(files)) {
    await writeFile(join(dir, name), lines.map(l => JSON.stringify(l)).join('\n') + '\n', { encoding: 'utf-8' });
  }
  return dir;
}

function runLogConsole(sid, extraArgs = []) {
  const res = spawnSync(process.execPath, [
    BROWSE, 'log', 'console', ...extraArgs, '--session', sid
  ], {
    encoding: 'utf-8',
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root }
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('F-004: a rotated + main events pair is returned in chronological order (rotated first, main last)', async () => {
  const sid = 'rotatedpair';
  await makeSession(sid, {
    'events-000001.jsonl': [
      { type: 'console', ts: '2026-08-20T00:00:00.000Z', payload: { text: 'oldest-rotated' } },
      { type: 'console', ts: '2026-08-20T00:00:01.000Z', payload: { text: 'second-rotated' } }
    ],
    'events-000002.jsonl': [
      { type: 'console', ts: '2026-08-20T00:00:02.000Z', payload: { text: 'third-rotated' } }
    ],
    'events.jsonl': [
      { type: 'console', ts: '2026-08-20T00:00:03.000Z', payload: { text: 'newest-main' } }
    ]
  });

  const { status, stdout, stderr } = runLogConsole(sid);
  assert.equal(status, 0, `expected exit 0, got ${status}; stderr: ${stderr}`);
  const events = JSON.parse(stdout);
  assert.deepEqual(
    events.map(e => e.payload.text),
    ['oldest-rotated', 'second-rotated', 'third-rotated', 'newest-main'],
    'rotated (older) files must precede the live main file'
  );
});

test('F-004: --tail on a rotated pair returns the NEWEST events, not the oldest', async () => {
  const sid = 'rotatedtail';
  await makeSession(sid, {
    'events-000001.jsonl': [
      { type: 'console', ts: '2026-08-20T00:00:00.000Z', payload: { text: 'oldest-rotated' } },
      { type: 'console', ts: '2026-08-20T00:00:01.000Z', payload: { text: 'mid-rotated' } }
    ],
    'events.jsonl': [
      { type: 'console', ts: '2026-08-20T00:00:02.000Z', payload: { text: 'newest-main' } }
    ]
  });

  const { status, stdout, stderr } = runLogConsole(sid, ['--tail', '2']);
  assert.equal(status, 0, `expected exit 0, got ${status}; stderr: ${stderr}`);
  const events = JSON.parse(stdout);
  assert.deepEqual(
    events.map(e => e.payload.text),
    ['mid-rotated', 'newest-main'],
    '--tail must return the newest events once a rotation has happened'
  );
});

test('F-005: a session dir with no events files exits 2 with the diagnostic (not a silent [])', async () => {
  const sid = 'noevents';
  await makeSession(sid, {});

  const { status, stdout, stderr } = runLogConsole(sid);
  assert.equal(status, 2, `expected exit 2, got ${status}`);
  assert.match(stderr, /no events file/);
  assert.equal(stdout.trim(), '', 'no silent [] on stdout for a never-started capture');
});
