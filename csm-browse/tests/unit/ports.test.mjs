import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { freshSessionsRoot, removeRoot, backage, patchKill } from './helpers/env.mjs';

const root = await freshSessionsRoot('csm-browse-ports-');
const ports = await import('../../lib/ports.mjs');
const { acquirePortLock, releasePortLock, allocate, breakStaleLock } = ports;
const { SESSIONS_ROOT } = await import('../../lib/constants.mjs');
const { setExecLayerForTests } = await import('../../lib/docker.mjs');

after(async () => { await removeRoot(root); });

const LOCK = join(root, '.ports.lock');

async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((res) => child.on('exit', res));
  return child.pid;
}

test('SESSIONS_ROOT honors CSM_BROWSE_SESSIONS_ROOT set before import', () => {
  assert.equal(SESSIONS_ROOT, root);
});

test('acquirePortLock writes our pid and releasePortLock removes the lock', async () => {
  await acquirePortLock();
  assert.ok(existsSync(LOCK));
  assert.equal(await readFile(LOCK, 'utf-8'), String(process.pid));
  await releasePortLock();
  assert.ok(!existsSync(LOCK));
});

test('acquirePortLock breaks a stale lock held by a dead pid', async () => {
  const pid = await deadPid();
  await writeFile(LOCK, String(pid), 'utf-8');
  await backage(LOCK, 6000); // past LOCK_STALE_MS
  await acquirePortLock(); // must not throw nor wait for LOCK_WAIT_MS
  assert.ok(existsSync(LOCK));
  await releasePortLock();
});

test('breakStaleLock removes a stale lock with a dead holder', async () => {
  const restore = patchKill(); // every pid is dead
  try {
    await writeFile(LOCK, '424242', 'utf-8');
    await backage(LOCK, 6000);
    await breakStaleLock();
    assert.ok(!existsSync(LOCK), 'stale lock should have been removed');
  } finally {
    restore();
  }
});

test('breakStaleLock keeps the lock while the holder is alive', async () => {
  await writeFile(LOCK, String(process.pid), 'utf-8');
  await backage(LOCK, 60000); // age must not matter for a live holder
  await breakStaleLock();
  assert.ok(existsSync(LOCK), 'live holder lock must not be broken');
  await rm(LOCK, { force: true });
});

test('breakStaleLock keeps a young lock even with a dead holder', async () => {
  const restore = patchKill();
  try {
    await writeFile(LOCK, '424242', 'utf-8'); // fresh mtime < LOCK_STALE_MS
    await breakStaleLock();
    assert.ok(existsSync(LOCK), 'young lock must not be broken');
  } finally {
    restore();
  }
  await rm(LOCK, { force: true });
});

test('breakStaleLock is content-matched: an interleaved rewrite is never unlinked', async () => {
  const orig = process.kill.bind(process);
  // pid 424242 is dead; the kill() probe simulates a fresh holder rewriting
  // the lock file between breakStaleLock's first read and its unlink.
  process.kill = (pid, sig) => {
    if (pid === 424242) {
      writeFileSync(LOCK, '777777');
      const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e;
    }
    return orig(pid, sig);
  };
  try {
    await writeFile(LOCK, '424242', 'utf-8');
    await backage(LOCK, 6000);
    await breakStaleLock();
    assert.ok(existsSync(LOCK), 'lock replaced by a fresh holder must survive');
    assert.equal(await readFile(LOCK, 'utf-8'), '777777');
  } finally {
    process.kill = orig;
  }
  await rm(LOCK, { force: true });
});

function stubLayer({ isPortFree, pgrep } = {}) {
  const calls = { isPortFree: [], pgrep: [] };
  setExecLayerForTests({
    isPortFree: async (c, p) => { calls.isPortFree.push(p); return isPortFree ? isPortFree(p) : true; },
    pgrepMatch: async (c, pattern) => { calls.pgrep.push(pattern); return pgrep ? pgrep(pattern) : []; },
  });
  return calls;
}

afterEach(async () => {
  setExecLayerForTests();
  const entries = await readdir(root).catch(() => []);
  for (const e of entries) {
    if (e.startsWith('alloc-')) await rm(join(root, e), { recursive: true, force: true });
  }
});

test('allocate returns a distinct in-range port pair per claim', async () => {
  stubLayer();
  const first = await allocate('chromium-vnc');
  assert.equal(first.internal, 9224);
  assert.equal(first.public, 9225);

  // Claim the first pair via state.json, then via creating.marker.
  await mkdir(join(root, 'alloc-a'), { recursive: true });
  await writeFile(join(root, 'alloc-a', 'state.json'), JSON.stringify({ internalPort: 9224, publicPort: 9225 }));
  const second = await allocate('chromium-vnc');
  assert.equal(second.internal, 9226);
  assert.equal(second.public, 9227);

  await mkdir(join(root, 'alloc-b'), { recursive: true });
  await writeFile(join(root, 'alloc-b', 'creating.marker'), JSON.stringify({ internal: 9226, public: 9227 }));
  const third = await allocate('chromium-vnc');
  assert.equal(third.internal, 9228);
  assert.equal(third.public, 9229);
  for (const pair of [first, second, third]) {
    assert.ok(pair.internal >= 9224 && pair.internal <= 9234, `internal out of range: ${pair.internal}`);
    assert.equal(pair.public, pair.internal + 1);
  }
});

test('allocate skips pairs whose internal port is busy in the container', async () => {
  stubLayer({ isPortFree: (p) => p !== 9224 && p !== 9225 });
  const pair = await allocate('chromium-vnc');
  assert.equal(pair.internal, 9226);
  assert.equal(pair.public, 9227);
});

test('allocate skips pairs whose public port is busy on the host', async () => {
  // The CDP gate binds 127.0.0.1:<public> on the HOST, so a live listener
  // there (a real bind — no Docker) must be skipped. Busying 9225 skips the
  // (9224, 9225) pair; the next free pair is (9225, 9226).
  stubLayer();
  const busy = netServer();
  await new Promise((res) => busy.listen(9225, '127.0.0.1', res));
  try {
    const pair = await allocate('chromium-vnc');
    assert.equal(pair.internal, 9225);
    assert.equal(pair.public, 9226);
  } finally {
    await new Promise((res) => busy.close(res));
  }
});

test('allocate skips pairs whose public port is held by a stale container TCP-LISTEN socat', async () => {
  const calls = { isPortFree: [], pgrep: [] };
  setExecLayerForTests({
    isPortFree: async (c, p) => { calls.isPortFree.push(p); return true; },
    pgrepMatch: async (c, pattern) => {
      calls.pgrep.push(pattern);
      if (pattern === 'TCP-LISTEN:9225,') return [{ pid: 1, cmd: `socat ${pattern}fork,reuseaddr TCP:127.0.0.1:9224` }];
      return [];
    },
  });
  const pair = await allocate('chromium-vnc');
  assert.ok(calls.pgrep.includes('TCP-LISTEN:9225,'), 'allocate must probe the container for stale socats');
  assert.equal(pair.internal, 9225, 'pair with a stale socat on its public port must be skipped');
  assert.equal(pair.public, 9226);
});

test('allocate throws when the whole pool is claimed', async () => {
  stubLayer();
  for (let i = 0; i <= 10; i++) {
    const sid = `alloc-full-${i}`;
    await mkdir(join(root, sid), { recursive: true });
    await writeFile(join(root, sid, 'creating.marker'), JSON.stringify({ internal: 9224 + i }));
  }
  await assert.rejects(allocate('chromium-vnc'), /No free port pair available in range 9224-9234/);
});
