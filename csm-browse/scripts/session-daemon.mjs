#!/usr/bin/env node
import { readFile, writeFile, rm, open, utimes } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { loadState, sessionDir } from '../lib/session.mjs';
import { connectDaemon, ensureSingleTab, startQueueLoop, prepareQueueDirs } from '../lib/daemon-core.mjs';

const args = process.argv.slice(2);
let sid = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session' && i + 1 < args.length) sid = args[++i];
}

if (!sid) {
  console.error('Usage: node scripts/session-daemon.mjs --session <sid>');
  process.exit(1);
}

const sDir = sessionDir(sid);

const pidFile = join(sDir, 'daemon.pid');
const readyMarker = join(sDir, 'daemon.ready');

// Atomic single-instance claim BEFORE connecting to CDP: open(pidFile, 'wx')
// closes the multi-second check-then-act window in which two spawns could
// both proceed. Stale locks (dead pid) are broken like the ports lock, with
// a content-matched unlink. The ready marker keeps its original position
// (written after CDP connect + queue dirs are ready).
async function claimPidFile() {
  for (;;) {
    try {
      const fh = await open(pidFile, 'wx');
      try { await fh.writeFile(String(process.pid)); } finally { await fh.close(); }
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let raw = null;
    try { raw = await readFile(pidFile, 'utf-8'); } catch {}
    if (raw !== null) {
      const existingPid = parseInt(raw.trim(), 10);
      let alive = false;
      if (!isNaN(existingPid)) {
        try { process.kill(existingPid, 0); alive = true; } catch {}
      }
      if (alive) {
        console.error(`Daemon already running (pid ${existingPid})`);
        process.exit(2);
      }
      // Dead holder: content-matched unlink so we never remove a fresh
      // holder's claim that replaced the file between read and unlink.
      try {
        const current = await readFile(pidFile, 'utf-8');
        if (current === raw) await rm(pidFile, { force: true });
      } catch {}
    }
    await setTimeout(100);
  }
}

await claimPidFile();
// We own the session now: drop any ready marker left by a previous daemon so
// launchDaemon's wait loop can only ever adopt a marker written by us.
try { await rm(readyMarker, { force: true }); } catch {}

const logPath = join(sDir, 'daemon.log');
const logStream = createWriteStream(logPath, { flags: 'w' });
process.stdout.write = logStream.write.bind(logStream);
process.stderr.write = logStream.write.bind(logStream);

const state = await loadState(sid);
if (!state || !state.wsUrl) {
  console.error('No session state found or wsUrl missing');
  process.exit(1);
}

console.log(`Connecting to ${state.wsUrl}...`);
let client;
let tabSessionId;

try {
  client = await connectDaemon(state.wsUrl);
  console.log('CDP connected');

  tabSessionId = await ensureSingleTab(client);
  console.log(`Tab attached, sessionId: ${tabSessionId}`);

  try {
    const collectors = await import('../lib/collectors.mjs');
    if (collectors.collectorsHook) {
      await collectors.collectorsHook(client, tabSessionId, sDir);
      console.log('Collectors enabled');
    }
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    console.log('Collectors not available');
  }

  await prepareQueueDirs(sDir);
  await writeFile(readyMarker, String(process.pid), 'utf-8');

  try {
    const recorder = await import('../lib/recorder.mjs');
    if (recorder.reconcileRecorder && await recorder.reconcileRecorder(sDir)) {
      console.log('Recorder state reconciled: stale running flag reset');
    }
  } catch {}

  console.log(`Daemon ready (pid ${process.pid})`);

  // Keep the ready marker's mtime fresh while this daemon's event loop is
  // alive, so launchDaemon can distinguish a live daemon from a stale-but-
  // alive zombie (whose loop has stopped touching the marker).
  const touchReady = globalThis.setInterval(() => {
    utimes(readyMarker, new Date(), new Date()).catch(() => {});
  }, 2000);
  if (touchReady.unref) touchReady.unref();

  let shuttingDown = false;

  const withTimeout = (promise, ms, label) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        globalThis.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);
  };

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    let forceExitTimer = globalThis.setTimeout(() => {
      console.error('Cleanup timed out, force exiting');
      try { process.exit(0); } catch {}
    }, 5000);
    if (forceExitTimer.unref) forceExitTimer.unref();

    try {
      const recorder = await import('../lib/recorder.mjs');
      if (recorder.stopRecorder) {
        console.log('Finalizing recorder...');
        await withTimeout(
          recorder.stopRecorder(client, tabSessionId, sDir),
          3000,
          'Recorder finalize'
        );
      }
    } catch (e) {
      if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(`Recorder finalize error: ${e.message}`);
    }

    if (client) {
      try {
        await withTimeout(client.close(), 2000, 'CDP close');
      } catch {}
    }

    try { await rm(pidFile); } catch {}
    try { await rm(readyMarker); } catch {}

    if (forceExitTimer) globalThis.clearTimeout(forceExitTimer);
    console.log('Daemon exiting');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // CDP disconnect/error = chromium is gone. Without this the daemon would
  // poll forever as a zombie, holding pid+ready markers and blocking every
  // relaunch. cleanup removes both markers so the next launchDaemon can
  // start a fresh daemon cleanly.
  client.on('disconnect', () => {
    console.log('CDP connection lost — shutting down');
    cleanup();
  });
  client.on('error', (err) => {
    console.error(`CDP client error: ${err && err.message ? err.message : err}`);
    cleanup();
  });

  await startQueueLoop(client, tabSessionId, sDir);
} catch (err) {
  console.error(`Daemon error: ${err.message}`);
  try { await rm(pidFile); } catch {}
  try { await rm(readyMarker); } catch {}
  if (client) {
    try { await client.close(); } catch {}
  }
  process.exit(1);
}
