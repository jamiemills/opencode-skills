import { readFile, writeFile, rename, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CMD_POLL_INTERVAL_MS, CMD_TIMEOUT_MS } from './constants.mjs';
import { dismissCookies } from './cookies.mjs';
import { ensurePrivateDir, secureWrite } from './security.mjs';

// Accepts both the ts-prefixed form (`<epoch-ms>-<uuid>.json`, written by the
// record verb) and the legacy bare-UUID form so commands enqueued before an
// upgrade are still claimed and processed.
const CMD_NAME_RE = /^(?:[0-9]{13}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

        let result = { ok: false, error: 'unknown verb', ts: new Date().toISOString() };

        if (cmd.verb === 'screencast-start' || cmd.verb === 'screencast-stop') {
          try {
            const recorder = await import('../lib/recorder.mjs');

            if (cmd.verb === 'screencast-start') {
              const recorderJsonPath = join(sessionDir, 'recorder.json');
              let recorderState = null;
              try {
                const raw = await readFile(recorderJsonPath, 'utf-8');
                recorderState = JSON.parse(raw);
              } catch {}

              if (recorderState && recorderState.running) {
                result = { ok: false, error: 'already recording', ts: new Date().toISOString() };
              } else {
                await dismissCookies(client, sessionId);
                const name = cmd.params.name;
                const fps = cmd.params.fps || 15;
                const preset = cmd.params.preset || 'medium';
                const speed = cmd.params.speed || 'medium';
                await recorder.startRecorder(client, sessionId, sessionDir, name, fps, preset, speed);
                result = { ok: true, result: { started: true }, ts: new Date().toISOString() };
              }
            } else {
              const stats = await recorder.stopRecorder(client, sessionId, sessionDir);
              result = { ok: true, result: stats, ts: new Date().toISOString() };
            }
          } catch (err) {
            if (err.code === 'ERR_MODULE_NOT_FOUND') {
              result = { ok: false, error: 'recorder unavailable', ts: new Date().toISOString() };
            } else {
              result = { ok: false, error: err.message, ts: new Date().toISOString() };
            }
          }
        }

        const tmpOutPath = outPath + '.tmp';
        await secureWrite(tmpOutPath, JSON.stringify(result), { encoding: 'utf-8' });
        await rename(tmpOutPath, outPath);
        try { await unlink(runningPath); } catch {}
      }
    } catch {
      // readdir can fail if cmd/ doesn't exist yet, continue polling
    }

    await setTimeout(CMD_POLL_INTERVAL_MS);
  }
}
