import { readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CMD_POLL_INTERVAL_MS } from './constants.mjs';
import { dismissCookies } from './cookies.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

  try { await rm(cmdDir, { recursive: true, force: true }); } catch {}

  await mkdir(cmdDir, { recursive: true });
  await mkdir(runningDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
}

export async function startQueueLoop(client, sessionId, sessionDir) {
  const cmdDir = join(sessionDir, 'cmd');
  const runningDir = join(sessionDir, 'cmd', 'running');
  const outDir = join(sessionDir, 'cmd', 'out');

  await prepareQueueDirs(sessionDir);

  while (true) {
    try {
      const entries = await readdir(cmdDir);
      const jsonFiles = entries.filter(e => e.endsWith('.json'));
      const candidates = jsonFiles
        .filter(e => UUID_RE.test(e.slice(0, -5)))
        .sort();

      for (const entry of candidates) {
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
          continue;
        }

        let result = { ok: false, error: 'unknown verb', ts: new Date().toISOString() };

        if (cmd.verb === 'goto') {
          try {
            await client.send('Page.navigate', { url: cmd.params.url }, sessionId);
            result = { ok: true, result: { url: cmd.params.url }, ts: new Date().toISOString() };
          } catch (err) {
            result = { ok: false, error: err.message, ts: new Date().toISOString() };
          }
        } else if (cmd.verb === 'screencast-start' || cmd.verb === 'screencast-stop') {
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
        await writeFile(tmpOutPath, JSON.stringify(result), 'utf-8');
        await rename(tmpOutPath, outPath);
      }
    } catch {
      // readdir can fail if cmd/ doesn't exist yet, continue polling
    }

    await setTimeout(CMD_POLL_INTERVAL_MS);
  }
}
