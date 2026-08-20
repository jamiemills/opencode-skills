import { readFile, rename, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CMD_POLL_INTERVAL_MS, CMD_TIMEOUT_MS } from './constants.mjs';
import { dismissCookies } from './cookies.mjs';
import { ensurePrivateDir, secureWrite } from './security.mjs';

// Accepts both the ts-prefixed form (`<epoch-ms>-<uuid>.json`, written by the
// record verb) and the legacy bare-UUID form so commands enqueued before an
// upgrade are still claimed and processed.
const CMD_NAME_RE = /^(?:[0-9]{13}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// F-014: a hung CDP send or recorder call must not block the queue forever.
// Wrap every command execution so a timeout produces an error result that
// unblocks the waiting client instead of stalling all later commands.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.timedOut = true;
      globalThis.setTimeout(() => reject(err), ms);
    })
  ]);
}

// R1.7/F-014: a screencast-start that times out may have ALREADY spawned
// ffmpeg and set the recorder's activeRecording before hanging (e.g. on
// Page.startScreencast). Leaving that behind makes every later command see
// 'already recording' and orphans a running ffmpeg. Best-effort: stop the
// recorder / kill the spawned ffmpeg / reset activeRecording. Never throws.
async function abortRecording(client, sessionId, sessionDir) {
  try {
    const recorder = await import('../lib/recorder.mjs');
    if (recorder.abortRecorder) {
      await withTimeout(
        recorder.abortRecorder(client, sessionId, sessionDir),
        2000,
        'recorder abort'
      );
    }
  } catch {}
}

async function executeCommand(cmd, client, sessionId, sessionDir) {
  if (cmd.verb !== 'screencast-start' && cmd.verb !== 'screencast-stop') {
    return { ok: false, error: 'unknown verb', ts: new Date().toISOString() };
  }

  const recorder = await import('../lib/recorder.mjs');

  if (cmd.verb === 'screencast-start') {
    const recorderJsonPath = join(sessionDir, 'recorder.json');
    let recorderState = null;
    try {
      const raw = await readFile(recorderJsonPath, 'utf-8');
      recorderState = JSON.parse(raw);
    } catch {}

    if (recorderState && recorderState.running) {
      return { ok: false, error: 'already recording', ts: new Date().toISOString() };
    }

    await dismissCookies(client, sessionId);
    const name = cmd.params.name;
    const fps = cmd.params.fps || 15;
    const preset = cmd.params.preset || 'medium';
    const speed = cmd.params.speed || 'medium';
    await recorder.startRecorder(client, sessionId, sessionDir, name, fps, preset, speed);
    return { ok: true, result: { started: true }, ts: new Date().toISOString() };
  }

  const stats = await recorder.stopRecorder(client, sessionId, sessionDir);
  return { ok: true, result: stats, ts: new Date().toISOString() };
}

export async function connectDaemon(wsUrl) {
  const CRI = await import('chrome-remote-interface');
  return CRI.default({ target: wsUrl });
}

export async function ensureSingleTab(client) {
  const { targetInfos } = await client.send('Target.getTargets');
  const pages = targetInfos.filter(t => t.type === 'page');

  if (pages.length > 0) {
    const target = pages[0];
    const { sessionId } = await client.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    return sessionId;
  }

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  return sessionId;
}

export async function prepareQueueDirs(sessionDir) {
  const cmdDir = join(sessionDir, 'cmd');
  const runningDir = join(sessionDir, 'cmd', 'running');
  const outDir = join(sessionDir, 'cmd', 'out');

  // Claim-by-rename protocol: cmd/ and out/ are NEVER wiped — commands
  // enqueued while the daemon was down, and their unconsumed results, must
  // survive every restart.
  await ensurePrivateDir(cmdDir);
  await ensurePrivateDir(runningDir);
  await ensurePrivateDir(outDir);
}

// At startup, anything left in running/ was claimed by a daemon that died
// mid-execution. Entries older than CMD_TIMEOUT_MS get an error result so
// waiting clients unblock instead of timing out; the client has already
// given up on anything that old.
async function sweepStaleRunning(runningDir, outDir) {
  let entries;
  try { entries = await readdir(runningDir); } catch { return; }
  const cutoff = Date.now() - CMD_TIMEOUT_MS;
  for (const entry of entries) {
    const runningPath = join(runningDir, entry);
    const outPath = join(outDir, entry);
    try {
      const st = await stat(runningPath);
      if (st.mtimeMs >= cutoff) continue;
      const errResult = { ok: false, error: 'daemon restarted while command was running', ts: new Date().toISOString() };
      await secureWrite(outPath + '.tmp', JSON.stringify(errResult), { encoding: 'utf-8' });
      await rename(outPath + '.tmp', outPath);
      await unlink(runningPath);
    } catch {}
  }
}

export async function startQueueLoop(client, sessionId, sessionDir) {
  const cmdDir = join(sessionDir, 'cmd');
  const runningDir = join(sessionDir, 'cmd', 'running');
  const outDir = join(sessionDir, 'cmd', 'out');

  await prepareQueueDirs(sessionDir);
  await sweepStaleRunning(runningDir, outDir);

  while (true) {
    try {
      const entries = await readdir(cmdDir);
      const jsonFiles = entries.filter(e => e.endsWith('.json'));
      const candidates = jsonFiles.filter(e => CMD_NAME_RE.test(e.slice(0, -5)));

      // Order by the command's own `ts` (ISO timestamps sort
      // lexicographically) with the filename as tiebreaker, so commands
      // enqueued within one poll window execute in submission order rather
      // than random-UUID filename order.
      const stamped = [];
      for (const entry of candidates) {
        let ts = '';
        try {
          const cmd = JSON.parse(await readFile(join(cmdDir, entry), 'utf-8'));
          if (typeof cmd.ts === 'string') ts = cmd.ts;
        } catch {}
        stamped.push({ entry, ts });
      }
      stamped.sort((a, b) => {
        if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
        return a.entry < b.entry ? -1 : (a.entry > b.entry ? 1 : 0);
      });

      for (const { entry } of stamped) {
        const srcPath = join(cmdDir, entry);
        const runningPath = join(runningDir, entry);
        const outPath = join(outDir, entry);

        try {
          await rename(srcPath, runningPath);
        } catch {
          continue;
        }

        // F-006: drop commands the client already gave up on. A command that
        // sat unprocessed for longer than CMD_TIMEOUT_MS was never awaited
        // (the record verb polls at most CMD_TIMEOUT_MS), so the daemon must
        // not execute it late — write an error result and move on.
        try {
          const st = await stat(runningPath);
          if (Date.now() - st.mtimeMs > CMD_TIMEOUT_MS) {
            const stale = { ok: false, error: 'command dropped (client timed out before daemon picked it up)', ts: new Date().toISOString() };
            const staleTmp = outPath + '.tmp';
            try {
              await secureWrite(staleTmp, JSON.stringify(stale), { encoding: 'utf-8' });
              await rename(staleTmp, outPath);
            } catch {}
            try { await unlink(runningPath); } catch {}
            continue;
          }
        } catch {}

        let cmd;
        try {
          const raw = await readFile(runningPath, 'utf-8');
          cmd = JSON.parse(raw);
        } catch {
          const malformed = { ok: false, error: 'malformed command file', ts: new Date().toISOString() };
          try {
            const tmpOutPath = outPath + '.tmp';
            await secureWrite(tmpOutPath, JSON.stringify(malformed), { encoding: 'utf-8' });
            await rename(tmpOutPath, outPath);
          } catch {}
          try { await unlink(runningPath); } catch {}
          continue;
        }

        let result;
        try {
          // F-014: bound the whole command execution; a hung CDP send or
          // recorder call produces an error result instead of stalling the
          // queue for every subsequent command.
          result = await withTimeout(
            executeCommand(cmd, client, sessionId, sessionDir),
            CMD_TIMEOUT_MS,
            `command ${entry}`
          );
        } catch (err) {
          if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
            result = { ok: false, error: 'recorder unavailable', ts: new Date().toISOString() };
          } else if (err && err.timedOut) {
            result = { ok: false, error: 'command timed out', ts: new Date().toISOString() };
            // R1.7/F-014: the timed-out command may have started the recorder
            // before hanging — clean it up so the queue is not stuck on
            // 'already recording' with an orphaned ffmpeg.
            await abortRecording(client, sessionId, sessionDir);
          } else {
            result = { ok: false, error: err && err.message ? err.message : String(err), ts: new Date().toISOString() };
            await abortRecording(client, sessionId, sessionDir);
          }
        }

        const tmpOutPath = outPath + '.tmp';
        // F-008: the result write must not be able to strand the command in
        // running/. On failure, write an error result instead so the client
        // unblocks and the entry is never left claimed-but-silent.
        try {
          await secureWrite(tmpOutPath, JSON.stringify(result), { encoding: 'utf-8' });
          await rename(tmpOutPath, outPath);
        } catch (writeErr) {
          try {
            const errResult = {
              ok: false,
              error: `result write failed: ${writeErr && writeErr.message ? writeErr.message : writeErr}`,
              ts: new Date().toISOString()
            };
            await secureWrite(tmpOutPath, JSON.stringify(errResult), { encoding: 'utf-8' });
            await rename(tmpOutPath, outPath);
          } catch {}
        }
        try { await unlink(runningPath); } catch {}
      }
    } catch {
      // readdir can fail if cmd/ doesn't exist yet, continue polling
    }

    await setTimeout(CMD_POLL_INTERVAL_MS);
  }
}
