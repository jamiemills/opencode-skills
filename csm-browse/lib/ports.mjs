import { execLayer } from './docker.mjs';
import { open, unlink, readFile, stat, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createServer as netServer } from 'node:net';
import { SESSIONS_ROOT, PORT_POOL_START, PORT_POOL_END } from './constants.mjs';
import { prepareRuntimeRoot, validateState } from './security.mjs';

const LOCK_FILE = join(SESSIONS_ROOT, '.ports.lock');
const LOCK_STALE_MS = 5000;
// Must exceed the maximum time any creator holds the lock (allocation +
// chromium/gate launch). The 30s CDP readiness wait happens OUTSIDE the lock.
const LOCK_WAIT_MS = 35000;

export async function breakStaleLock() {
  try {
    const st = await stat(LOCK_FILE);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return;
    let raw;
    try {
      raw = await readFile(LOCK_FILE, 'utf-8');
    } catch {
      return;
    }
    const pid = parseInt(raw.trim(), 10);
    if (!isNaN(pid)) {
      try { process.kill(pid, 0); return; } catch {}  // holder alive — do not break
    }
    // Content-matched unlink: only remove the lock if it still holds the exact
    // contents we inspected, so a fresh holder that replaced a dead holder's
    // file between our read and the unlink is never destroyed.
    try {
      const current = await readFile(LOCK_FILE, 'utf-8');
      if (current === raw) await unlink(LOCK_FILE);
    } catch {}
  } catch {}
}

export async function acquirePortLock() {
  await prepareRuntimeRoot(SESSIONS_ROOT);
  const start = Date.now();
  for (;;) {
    try {
      const fh = await open(LOCK_FILE, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      try { await fh.chmod(0o600); await fh.writeFile(String(process.pid)); } finally { await fh.close(); }
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    await breakStaleLock();
    if (Date.now() - start > LOCK_WAIT_MS) {
      throw new Error(`Timed out acquiring port allocation lock at ${LOCK_FILE}`);
    }
    await setTimeout(100);
  }
}

export async function releasePortLock() {
  try { await unlink(LOCK_FILE); } catch {}
}

// Ports already claimed by other sessions, recorded on disk under the port
// lock: state.json for live sessions, creating.marker for in-flight creations.
// The lock serializes claim writes, so this scan closes the window where a
// second creator allocates the same pair after the first released the lock
// but before chromium actually binds its debug port.
async function claimedPortSet() {
  const claimed = new Set();
  let dirs;
  try { dirs = await readdir(SESSIONS_ROOT); } catch { return claimed; }
  for (const d of dirs) {
    if (d.startsWith('.')) continue;
    try {
      const state = JSON.parse(await readFile(join(SESSIONS_ROOT, d, 'state.json'), 'utf-8'));
       validateState(state);
       if (state && typeof state.internalPort === 'number') claimed.add(state.internalPort);
       if (state && typeof state.publicPort === 'number') claimed.add(state.publicPort);
    } catch {}
    try {
      const marker = JSON.parse(await readFile(join(SESSIONS_ROOT, d, 'creating.marker'), 'utf-8'));
      if (marker && typeof marker.internal === 'number') claimed.add(marker.internal);
      if (marker && typeof marker.public === 'number') claimed.add(marker.public);
    } catch {}
  }
  return claimed;
}

// Host-side liveness probe for a pool public port: the CDP gate listens on
// 127.0.0.1:<pub> on the HOST (container-side socat is gone), so availability
// is decided here, not inside the container.
function hostPortFree(port) {
  return new Promise((resolve) => {
    const srv = netServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

// Pre-T001 sessions left container-side TCP-LISTEN socats that forward their
// pub port to the OLD session's internal port. A NEW session can own that
// same internal port, so a stale socat would relay to the new chromium
// without a token. During the upgrade window, skip any pair whose pub port is
// still held by such a listener; sweep() reaps the stale socats.
async function containerHasStaleSocat(container, pub) {
  const matches = await execLayer.pgrepMatch(container, `TCP-LISTEN:${pub},`);
  return matches.length > 0;
}

export async function allocate(container) {
  const claimed = await claimedPortSet();

  for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
    const internal = p;
    const pub = p + 1;

    if (claimed.has(internal) || claimed.has(pub)) continue;

    const internalFree = await execLayer.isPortFree(container, internal);
    if (!internalFree) continue;

    const publicFree = await hostPortFree(pub);
    if (!publicFree) continue;

    if (await containerHasStaleSocat(container, pub)) continue;

    return { internal, public: pub };
  }

  throw new Error(
    `No free port pair available in range ${PORT_POOL_START}-${PORT_POOL_END}`
  );
}
