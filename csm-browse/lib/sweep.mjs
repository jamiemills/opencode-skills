import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import {
  stopDaemon, killInstance, killSocat,
  removeContainerSession, removeHostSession
} from './cleanup.mjs';
import { pgrepMatch, pkillMatch, execInContainer } from './docker.mjs';
import { SESSIONS_ROOT, PORT_POOL_START, PORT_POOL_END } from './constants.mjs';
import { sessionDir, containerSessionDir } from './session.mjs';

const execFileAsync = promisify(execFile);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function killHostFfmpeg(sDir) {
  try { await execFileAsync('pkill', ['-f', `ffmpeg.*${escapeRegExp(sDir)}`]); } catch {}
}

async function cleanArtifactTemps(sDir) {
  const artifacts = join(sDir, 'artifacts');
  let names;
  try { names = await readdir(artifacts); } catch { return; }
  for (const n of names) {
    if (n.startsWith('.stitch-') || n.endsWith('.webm')) {
      try { await unlink(join(artifacts, n)); } catch {}
    }
  }
}

async function dirAgeMs(sDir) {
  let max = 0;
  const targets = [sDir, join(sDir, 'state.json'), join(sDir, 'events.jsonl'), join(sDir, 'cmd')];
  for (const p of targets) {
    try {
      const st = await stat(p);
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch {}
  }
  return max ? Date.now() - max : null;
}

async function daemonAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function killPidGracefully(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try { process.kill(pid, 0); await setTimeout(200); } catch { return; }
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

export async function sweep({ containerName, ip, ageMinutes = 10, dryRun = false, skipSid = null }) {
  const swept = [];
  const ageMs = ageMinutes * 60 * 1000;

  let hostDirs = [];
  try { hostDirs = (await readdir(SESSIONS_ROOT)).filter(d => !d.startsWith('.')); } catch {}

  // Host-session pass: stale dirs (age or dead daemon) — kill daemon, container procs, remove dirs
  for (const sid of hostDirs) {
    if (skipSid && sid === skipSid) continue;
    const sDir = sessionDir(sid);
    const age = await dirAgeMs(sDir);
    if (age === null) continue;

    let stale = age > ageMs;
    if (!stale) {
      const pidFile = join(sDir, 'daemon.pid');
      if (existsSync(pidFile)) {
        try {
          const raw = await readFile(pidFile, 'utf-8');
          const pid = parseInt(raw.trim(), 10);
          if (!isNaN(pid) && !(await daemonAlive(pid))) stale = true;
        } catch {}
      }
    }
    if (!stale) continue;

    let publicPort = null;
    try {
      const state = JSON.parse(await readFile(join(sDir, 'state.json'), 'utf-8'));
      publicPort = state.publicPort || null;
    } catch {}

    const label = `sid=${sid} age=${Math.round(age / 60000)}m${publicPort ? ` port=${publicPort}` : ''}`;
    if (dryRun) { swept.push(`[dry] ${label}`); continue; }

    await stopDaemon(sDir);
    await killHostFfmpeg(sDir);
    try { await cleanArtifactTemps(sDir); } catch {}
    try { await killInstance(containerName, containerSessionDir(sid)); } catch {}
    if (publicPort) { try { await killSocat(containerName, publicPort); } catch {} }
    try { await removeContainerSession(containerName, containerSessionDir(sid)); } catch {}
    try { await removeHostSession(sDir); } catch {}
    swept.push(label);
  }

  // Orphaned-daemon pass: running host daemon whose session dir is gone
  try {
    const { stdout } = await execFileAsync('pgrep', ['-af', 'session-daemon.mjs --session ']);
    for (const line of stdout.split('\n').filter(Boolean)) {
      const m = line.match(/session-daemon\.mjs --session (\S+)/);
      if (!m) continue;
      const sid = m[1];
      if (skipSid && sid === skipSid) continue;
      if (existsSync(sessionDir(sid))) continue;
      const pid = parseInt(line, 10);
      if (isNaN(pid)) continue;
      if (dryRun) { swept.push(`[dry] orphan daemon sid=${sid} pid=${pid}`); continue; }
      await killPidGracefully(pid);
      swept.push(`orphan daemon sid=${sid} pid=${pid}`);
    }
  } catch {}

  // Orphaned host ffmpeg: recorder process whose session dir is gone or daemon dead
  try {
    const sessRe = new RegExp(`${escapeRegExp(SESSIONS_ROOT)}/([^/\\s]+)`);
    const { stdout } = await execFileAsync('pgrep', ['-af', 'ffmpeg']);
    for (const line of stdout.split('\n').filter(Boolean)) {
      const m = line.match(sessRe);
      if (!m) continue;
      const sid = m[1];
      if (skipSid && sid === skipSid) continue;
      const sDir = sessionDir(sid);
      let orphaned = !existsSync(sDir);
      if (!orphaned) {
        const pidFile = join(sDir, 'daemon.pid');
        let alive = false;
        if (existsSync(pidFile)) {
          try {
            const raw = await readFile(pidFile, 'utf-8');
            const pid = parseInt(raw.trim(), 10);
            alive = !isNaN(pid) && await daemonAlive(pid);
          } catch {}
        }
        if (alive) continue;
        const age = await dirAgeMs(sDir);
        orphaned = age === null || age > ageMs;
      }
      if (!orphaned) continue;
      if (dryRun) { swept.push(`[dry] orphan ffmpeg sid=${sid}`); continue; }
      await killHostFfmpeg(sDir);
      swept.push(`orphan ffmpeg sid=${sid}`);
    }
  } catch {}

  // Container-side orphan chromium: session profile without matching host state
  try {
    const chromiumProcs = await pgrepMatch(containerName, '--user-data-dir=/config/csm-browse/sessions/');
    for (const proc of chromiumProcs) {
      const m = proc.cmd.match(/--user-data-dir=\/config\/csm-browse\/sessions\/([^/]+)/);
      if (!m) continue;
      const psid = m[1];
      if (skipSid && psid === skipSid) continue;
      const hostStateExists = existsSync(join(SESSIONS_ROOT, psid, 'state.json'));
      let containerDirExists = false;
      try {
        await execInContainer(containerName, ['test', '-d', `/config/csm-browse/sessions/${psid}`]);
        containerDirExists = true;
      } catch {}
      if (hostStateExists && containerDirExists) continue;
      if (dryRun) { swept.push(`[dry] orphan container chromium sid=${psid}`); continue; }
      try { await pkillMatch(containerName, `--user-data-dir=/config/csm-browse/sessions/${psid}/`); } catch {}
      try { await pkillMatch(containerName, `--database=/config/csm-browse/sessions/${psid}/crash`); } catch {}
      const portMatch = proc.cmd.match(/--remote-debugging-port=(\d+)/);
      if (portMatch) {
        try { await pkillMatch(containerName, `TCP-LISTEN:${parseInt(portMatch[1], 10) + 1}`); } catch {}
      }
      try { await removeContainerSession(containerName, `/config/csm-browse/sessions/${psid}`); } catch {}
      swept.push(`orphan container chromium sid=${psid}`);
    }
  } catch {}

  // Stale recorder lock: running:true with no live daemon
  for (const sid of hostDirs) {
    if (skipSid && sid === skipSid) continue;
    const recPath = join(sessionDir(sid), 'recorder.json');
    if (!existsSync(recPath)) continue;
    try {
      const rec = JSON.parse(await readFile(recPath, 'utf-8'));
      if (rec.running !== true) continue;
      let alive = false;
      const pidFile = join(sessionDir(sid), 'daemon.pid');
      if (existsSync(pidFile)) {
        try {
          const raw = await readFile(pidFile, 'utf-8');
          const pid = parseInt(raw.trim(), 10);
          alive = !isNaN(pid) && await daemonAlive(pid);
        } catch {}
      }
      if (alive) continue;
      if (dryRun) { swept.push(`[dry] stale recorder lock sid=${sid}`); continue; }
      rec.running = false;
      await writeFile(recPath, JSON.stringify(rec, null, 2), 'utf-8');
      swept.push(`stale recorder lock sid=${sid}`);
    } catch {}
  }

  // Orphan socat pass: pool ports with no related chromium
  try {
    const allSocats = await pgrepMatch(containerName, 'TCP-LISTEN:92');
    for (const socat of allSocats) {
      const portMatch = socat.cmd.match(/TCP-LISTEN:(\d+)/);
      if (!portMatch) continue;
      const pubPort = parseInt(portMatch[1], 10);
      if (pubPort < PORT_POOL_START + 1 || pubPort > PORT_POOL_END + 1) continue;
      const relatedChrome = await pgrepMatch(containerName, `--remote-debugging-port=${pubPort - 1}`);
      if (relatedChrome.length === 0) {
        if (dryRun) { swept.push(`[dry] orphan socat port=${pubPort}`); continue; }
        try { await pkillMatch(containerName, `TCP-LISTEN:${pubPort}`); } catch {}
        swept.push(`orphan socat port=${pubPort}`);
      }
    }
  } catch {}

  return { swept, skipped: hostDirs.length };
}
