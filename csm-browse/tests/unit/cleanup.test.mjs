import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot, patchKill } from './helpers/env.mjs';

// F-040: cleanup (stopDaemon / killInstance / killGate / removeContainerSession /
// removeHostSession / releasePorts / truncateLogs) with stubbed docker exec
// layer + patched process.kill. No Docker required.
const root = await freshSessionsRoot('csm-browse-cleanup-');
const { setExecLayerForTests } = await import('../../lib/docker.mjs');
const cleanup = await import('../../lib/cleanup.mjs');

after(async () => {
  setExecLayerForTests();
  await removeRoot(root);
});

// stopDaemon drives process.kill directly (not via the exec layer), so this
// custom patch kills the pid on the first SIGTERM — the clean-stop path.
function patchKillDieOnSigterm() {
  const orig = process.kill.bind(process);
  const signals = [];
  let dead = false;
  process.kill = (pid, sig) => {
    signals.push([pid, sig]);
    if (dead) {
      const e = new Error('ESRCH');
      e.code = 'ESRCH';
      throw e;
    }
    if (sig === 'SIGTERM') dead = true;
    return true;
  };
  return () => { process.kill = orig; return signals; };
}

test('stopDaemon: missing pid file -> false', async () => {
  const dir = join(root, 'sess-no-pid');
  await mkdir(dir, { recursive: true });
  assert.equal(await cleanup.stopDaemon(dir), false);
});

test('stopDaemon: dead pid -> false (SIGTERM throws ESRCH)', async () => {
  const dir = join(root, 'sess-dead');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'daemon.pid'), '99999\n', 'utf-8');
  const restore = patchKill(new Set());
  try {
    assert.equal(await cleanup.stopDaemon(dir), false);
  } finally {
    restore();
  }
});

test('stopDaemon: with a session id, an unverifiable pid is never signaled', async () => {
  const dir = join(root, 'sess-sid');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'daemon.pid'), '999999\n', 'utf-8');
  const restore = patchKillDieOnSigterm();
  try {
    // No process exists for pid 999999, so /proc/<pid>/cmdline is unreadable
    // and the F-021 identity check refuses to signal it.
    assert.equal(await cleanup.stopDaemon(dir, 'sess-sid'), false);
  } finally {
    const signals = restore();
    assert.deepEqual(signals, [], `no signal may be sent to an unverifiable pid, got ${JSON.stringify(signals)}`);
  }
});

test('stopDaemon: live pid -> SIGTERM then true, no SIGKILL', async () => {
  const dir = join(root, 'sess-live');
  await mkdir(dir, { recursive: true });
  const pid = 4242;
  await writeFile(join(dir, 'daemon.pid'), `${pid}\n`, 'utf-8');
  const restore = patchKillDieOnSigterm();
  try {
    assert.equal(await cleanup.stopDaemon(dir), true);
  } finally {
    const signals = restore();
    const sigterms = signals.filter(([p, s]) => p === pid && s === 'SIGTERM');
    const sigkills = signals.filter(([p, s]) => p === pid && s === 'SIGKILL');
    assert.equal(sigterms.length, 1, `expected one SIGTERM, got ${JSON.stringify(signals)}`);
    assert.equal(sigkills.length, 0, `no SIGKILL expected on clean stop, got ${JSON.stringify(signals)}`);
  }
});

test('killGate: kills only the gate owning the exact public port', async () => {
  const killed = [];
  setExecLayerForTests({
    hostPgrep: async () => [
      { pid: 111, cmd: 'node /x/cdp-gate.mjs --sid s1 --port 9224 --internal 9223 --container chromium-vnc' },
      { pid: 222, cmd: 'node /x/cdp-gate.mjs --sid s2 --port 9225 --internal 9224 --container chromium-vnc' },
    ],
    killPid: (pid) => killed.push(pid),
  });
  try {
    await cleanup.killGate(9224);
    assert.deepEqual(killed, [111]);
  } finally {
    setExecLayerForTests();
  }
});

test('killGate: unsafe public ports are rejected', async () => {
  await assert.rejects(() => cleanup.killGate(80), /Unsafe public port/);
  await assert.rejects(() => cleanup.killGate('9224'), /Unsafe public port/);
});

test('killInstance: pkills both profile patterns; unsafe path rejected', async () => {
  const calls = [];
  setExecLayerForTests({ pkillMatch: async (container, pattern) => calls.push([container, pattern]) });
  try {
    await cleanup.killInstance('chromium-vnc', '/config/csm-browse/sessions/abc123');
    assert.deepEqual(calls, [
      ['chromium-vnc', '--user-data-dir=/config/csm-browse/sessions/abc123/'],
      ['chromium-vnc', '--database=/config/csm-browse/sessions/abc123/crash'],
    ]);
  } finally {
    setExecLayerForTests();
  }
  await assert.rejects(() => cleanup.killInstance('chromium-vnc', '/etc/passwd'), /Unsafe container session path/);
});

test('removeContainerSession: execInContainer rm -rf of the validated dir', async () => {
  const calls = [];
  setExecLayerForTests({
    execInContainer: async (container, args) => calls.push({ container, args }),
  });
  try {
    await cleanup.removeContainerSession('chromium-vnc', '/config/csm-browse/sessions/abc123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].container, 'chromium-vnc');
    assert.deepEqual(calls[0].args, ['rm', '-rf', '/config/csm-browse/sessions/abc123']);
  } finally {
    setExecLayerForTests();
  }
});

test('removeHostSession: removes a session dir inside the root; rejects escapes', async () => {
  const dir = join(root, 'sess-host');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'state.json'), '{}', 'utf-8');
  await cleanup.removeHostSession(dir);
  await assert.rejects(() => stat(dir));
  await assert.rejects(() => cleanup.removeHostSession(join(root, '..', 'escape')), /Path escapes csm-browse root/);
});

test('releasePorts: releases the chromium instance; does not re-kill the gate (F-067-13b)', async () => {
  const calls = [];
  setExecLayerForTests({
    hostPgrep: async () => [{ pid: 111, cmd: 'node /x/cdp-gate.mjs --sid s1 --port 9224 --internal 9223 --container chromium-vnc' }],
    killPid: (pid) => calls.push(['killPid', pid]),
    pkillMatch: async (c, p) => calls.push(['pkillMatch', c, p]),
  });
  try {
    const state = {
      sid: 'abc123',
      publicPort: 9224,
      profileDir: '/config/csm-browse/sessions/abc123',
      container: { name: 'chromium-vnc' },
    };
    await cleanup.releasePorts(state);
    // F-067-13b: the session dir removal already freed the pair; re-killing
    // the same public port could SIGTERM a fast concurrent creator's gate.
    assert.equal(calls.some((c) => c[0] === 'killPid'), false, `no gate kill expected: ${JSON.stringify(calls)}`);
    assert.ok(calls.some((c) => c[0] === 'pkillMatch'), `pkillMatch missing: ${JSON.stringify(calls)}`);
  } finally {
    setExecLayerForTests();
  }

  await cleanup.releasePorts({ sid: 'abc123' });
});

test('truncateLogs: removes the container chromium.log and the host daemon.log', async () => {
  const calls = [];
  setExecLayerForTests({ execInContainer: async (c, args) => calls.push([c, args]) });
  const dir = join(root, 'sess-trunc');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'daemon.log'), 'x', 'utf-8');
  try {
    await cleanup.truncateLogs(dir, 'chromium-vnc', '/config/csm-browse/sessions/abc123');
    assert.deepEqual(calls, [['chromium-vnc', ['rm', '-f', '/config/csm-browse/sessions/abc123/chromium.log']]]);
    await assert.rejects(() => stat(join(dir, 'daemon.log')));
  } finally {
    setExecLayerForTests();
  }
});
