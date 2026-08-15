import { isPortFree, pgrepMatch } from './docker.mjs';
import { open, unlink, readFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { SESSIONS_ROOT } from './constants.mjs';

const PORT_POOL_START = 9224;
const PORT_POOL_END = 9234;

const LOCK_FILE = join(SESSIONS_ROOT, '.ports.lock');
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 10000;

async function breakStaleLock() {
  try {
    const st = await stat(LOCK_FILE);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return;
    let holderAlive = true;
    try {
      const raw = await readFile(LOCK_FILE, 'utf-8');
      const pid = parseInt(raw.trim(), 10);
      if (isNaN(pid)) holderAlive = false;
      else {
        try { process.kill(pid, 0); } catch { holderAlive = false; }
      }
    } catch { holderAlive = false; }
    if (!holderAlive) { try { await unlink(LOCK_FILE); } catch {} }
  } catch {}
}

async function acquirePortLock() {
  await mkdir(SESSIONS_ROOT, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      const fh = await open(LOCK_FILE, 'wx');
      try { await fh.writeFile(String(process.pid)); } finally { await fh.close(); }
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

async function releasePortLock() {
  try { await unlink(LOCK_FILE); } catch {}
}

export async function allocate(container) {
  await acquirePortLock();
  try {
    for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
      const internal = p;
      const pub = p + 1;

      const internalFree = await isPortFree(container, internal);
      if (!internalFree) continue;

      const publicFree = await isPortFree(container, pub);
      if (!publicFree) continue;

      const socatMatches = await pgrepMatch(container, `TCP-LISTEN:${pub}`);
      if (socatMatches.length > 0) continue;

      return { internal, public: pub };
    }

    throw new Error(
      `No free port pair available in range ${PORT_POOL_START}-${PORT_POOL_END}`
    );
  } finally {
    await releasePortLock();
  }
}

export async function release(state) {
  // T007 handles full cleanup — ports freed when session is destroyed
}
