import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile, mkdir, chmod, readFile, stat, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

// F-040: recorder start/stop with a stubbed ffmpeg. The recorder spawns
// `ffmpeg` from PATH, so a tiny fake executable (writes a marker to its output
// path — the last argv — then drains stdin and exits 0) stands in for the real
// binary. No Docker, no ffmpeg on the host required.
const root = await freshSessionsRoot('csm-browse-recorder-');

const fakeBinDir = mkdtempSync(join(tmpdir(), 'csm-browse-fakebin-'));
const fakeFfmpeg = [
  '#!/usr/bin/env node',
  'const fs = require(\'node:fs\');',
  'const args = process.argv.slice(2);',
  'const out = args[args.length - 1];',
  'try { fs.writeFileSync(out, \'FAKE-FRAME-DATA\'); } catch {}',
  'process.stdin.resume();',
  'process.stdin.on(\'data\', () => {});',
  'process.stdin.on(\'end\', () => process.exit(0));',
  'setTimeout(() => process.exit(0), 10000).unref();',
  ''
].join('\n');
await writeFile(join(fakeBinDir, 'ffmpeg'), fakeFfmpeg, { encoding: 'utf-8' });
await chmod(join(fakeBinDir, 'ffmpeg'), 0o755);
process.env.PATH = `${fakeBinDir}${process.env.PATH ? ':' : ''}${process.env.PATH}`;

// recorder.mjs must load AFTER CSM_BROWSE_SESSIONS_ROOT is pinned (constants.mjs
// validates the runtime root at import).
const recorder = await import('../../lib/recorder.mjs');

after(async () => {
  await removeRoot(root);
  await rm(fakeBinDir, { recursive: true, force: true });
});

// Minimal CDP client: an EventEmitter recording every send; startScreencast /
// stopScreencast / frameAck all succeed. Frames are injected via emitFrame().
class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }
  async send(method, params, sessionId) {
    this.sent.push({ method, params, sessionId });
    return {};
  }
  emitFrame(params) {
    this.emit('Page.screencastFrame', params);
  }
}

const SESSION_ID = 'rec-test';
const sessionDir = join(root, SESSION_ID);
await mkdir(sessionDir, { recursive: true });

async function startAndStop(client, outName, frames = 0) {
  await recorder.startRecorder(client, SESSION_ID, sessionDir, outName, 15, 'medium', 'medium');
  for (let i = 0; i < frames; i++) {
    client.emitFrame({ data: Buffer.from(`frame-${i}`).toString('base64'), sessionId: 'x' });
  }
  if (frames > 0) await sleep(100);
  return recorder.stopRecorder(client, SESSION_ID, sessionDir);
}

test('startRecorder rejects invalid output names', async () => {
  const client = new FakeClient();
  await assert.rejects(() => recorder.startRecorder(client, SESSION_ID, sessionDir, 'bad/name.mov'), /Invalid recording name/);
  await assert.rejects(() => recorder.startRecorder(client, SESSION_ID, sessionDir, 'noext'), /Invalid recording name/);
});

test('startRecorder launches the stubbed ffmpeg and persists running state', async () => {
  const client = new FakeClient();
  try {
    const res = await recorder.startRecorder(client, SESSION_ID, sessionDir, 'test.webm', 15, 'medium', 'medium');
    assert.deepEqual(res, { isRecording: true });
    assert.ok(client.sent.some((s) => s.method === 'Page.startScreencast'), 'startScreencast must be sent');
    const state = JSON.parse(await readFile(join(sessionDir, 'recorder.json'), 'utf-8'));
    assert.equal(state.running, true);
    assert.equal(state.name, 'test.webm');
    assert.equal(state.outPath, join(sessionDir, 'artifacts', 'test.webm'));
    // The stub writes the output file at spawn; wait briefly, then confirm.
    for (let i = 0; i < 20; i++) {
      try { if ((await stat(join(sessionDir, 'artifacts', 'test.webm'))).size > 0) break; } catch {}
      await sleep(50);
    }
    assert.ok((await stat(join(sessionDir, 'artifacts', 'test.webm'))).size > 0, 'stub ffmpeg must write the output file');
  } finally {
    try { await recorder.stopRecorder(client, SESSION_ID, sessionDir); } catch {}
  }
});

test('startRecorder rejects a second concurrent recording', async () => {
  const client = new FakeClient();
  try {
    await recorder.startRecorder(client, SESSION_ID, sessionDir, 'one.webm', 15, 'medium', 'medium');
    await assert.rejects(
      () => recorder.startRecorder(client, SESSION_ID, sessionDir, 'two.webm', 15, 'medium', 'medium'),
      /already recording/
    );
  } finally {
    try { await recorder.stopRecorder(client, SESSION_ID, sessionDir); } catch {}
  }
});

test('stopRecorder drains frames, writes stats, and reaps the stub', async () => {
  const client = new FakeClient();
  const res = await startAndStop(client, 'rec.webm', 2);
  assert.ok(res.file.endsWith('rec.webm'), `file=${res.file}`);
  assert.equal(res.frames, 2);
  assert.equal(res.codec, 'libvpx-vp9');

  const stats = JSON.parse(await readFile(join(sessionDir, 'recorder.json'), 'utf-8'));
  assert.equal(stats.running, false);
  assert.equal(stats.frames, 2);
  assert.equal(stats.error, null);
  assert.equal(stats.file, join(sessionDir, 'artifacts', 'rec.webm'));

  // ffmpeg-stderr.log is removed after a clean stop.
  await assert.rejects(() => stat(join(sessionDir, 'ffmpeg-stderr.log')));
});

test('stopRecorder without an active recording throws', async () => {
  const client = new FakeClient();
  await assert.rejects(() => recorder.stopRecorder(client, SESSION_ID, sessionDir), /not recording/);
});
