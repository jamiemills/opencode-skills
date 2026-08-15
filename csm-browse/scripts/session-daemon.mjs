#!/usr/bin/env node
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { loadState, sessionDir } from '../lib/session.mjs';
import { connectDaemon, ensureSingleTab, startQueueLoop } from '../lib/daemon-core.mjs';

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

if (existsSync(pidFile)) {
  let stale = false;
  try {
    const raw = await readFile(pidFile, 'utf-8');
    const existingPid = parseInt(raw.trim(), 10);
    try {
      process.kill(existingPid, 0);
      console.error(`Daemon already running (pid ${existingPid})`);
      process.exit(2);
    } catch {
      stale = true;
    }
  } catch {
    stale = true;
  }
  if (stale) {
    try { await rm(pidFile); } catch {}
    try { await rm(readyMarker); } catch {}
  }
}

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

  await writeFile(pidFile, String(process.pid), 'utf-8');
  await writeFile(readyMarker, String(process.pid), 'utf-8');

  try {
    const recorder = await import('../lib/recorder.mjs');
    if (recorder.reconcileRecorder && await recorder.reconcileRecorder(sDir)) {
      console.log('Recorder state reconciled: stale running flag reset');
    }
  } catch {}

  console.log(`Daemon ready (pid ${process.pid})`);

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
          recorder.stopRecorder(client, tabSessionId),
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
