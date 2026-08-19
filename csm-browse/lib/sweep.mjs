import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  stopDaemon, killInstance, killGate,
  removeContainerSession, removeHostSession
} from './cleanup.mjs';
import { execLayer } from './docker.mjs';
import { SESSIONS_ROOT, PORT_POOL_START, PORT_POOL_END, CDP_RETRY_TIMEOUT_MS } from './constants.mjs';
import { sessionDir, containerSessionDir, validateSid, revokeToken } from './session.mjs';
import { prepareRuntimeRoot, secureWrite, validateState } from './security.mjs';

// Session-creation marker protocol (F-010): createSession writes
// `creating.marker` into the session dir inside the port lock, before
// launching chromium, and removes it once state.json is saved. Both the
// host-dir pass and the container-chromium/gate passes treat a fresh marker
// as do-not-touch, so a concurrent sweep cannot kill a session mid-creation.
const CREATING_MARKER = 'creating.marker';
// Creation window (CDP_RETRY_TIMEOUT_MS) plus a grace period: a marker-only
// dir younger than this is NOT stale, even with no state.json and no daemon.
const CREATING_MARKER_MAX_MS = CDP_RETRY_TIMEOUT_MS + 60000;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function hasFreshCreatingMarker(sDir) {
  try {
    const st = await stat(join(sDir, CREATING_MARKER));
    return Date.now() - st.mtimeMs <= CREATING_MARKER_MAX_MS;
  } catch {
    return false;
  }
}

async function killHostFfmpeg(sDir) {
  try { await execLayer.execFile('pkill', ['-f', `ffmpeg.*${escapeRegExp(sDir)}`]); } catch {}
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
  await prepareRuntimeRoot(SESSIONS_ROOT);
  const swept = [];
  const ageMs = ageMinutes * 60 * 1000;

  let hostDirs = [];
  try {
    hostDirs = (await readdir(SESSIONS_ROOT)).filter(d => {
      if (d.startsWith('.')) return false;
      try { validateSid(d); return true; } catch { return false; }
    });
  } catch {}

  // Host-session pass: a live daemon or a fresh creating.marker protects the
  // session REGARDLESS of dir age; only when the daemon is dead/absent (and
  // no fresh marker) does age make the dir stale.
  for (const sid of hostDirs) {
    if (skipSid && sid === skipSid) continue;
    const sDir = sessionDir(sid);

    // Marker do-not-touch: session is being created right now.
    if (await hasFreshCreatingMarker(sDir)) continue;

    const age = await dirAgeMs(sDir);
    if (age === null) continue;

    // Liveness check first, regardless of dir age: a healthy-but-idle session
    // (live daemon) must never be reaped.
    let daemonLive = false;
    const pidFile = join(sDir, 'daemon.pid');
    if (existsSync(pidFile)) {
      try {
        const raw = await readFile(pidFile, 'utf-8');
        const pid = parseInt(raw.trim(), 10);
        if (!isNaN(pid) && (await daemonAlive(pid))) daemonLive = true;
      } catch {}
    }
    if (daemonLive) continue;

    // Age only decides when the daemon is dead or absent.
    if (age <= ageMs) continue;

    let publicPort = null;
    let state = null;
    try {
      state = validateState(JSON.parse(await readFile(join(sDir, 'state.json'), 'utf-8')), sid);
      publicPort = state.publicPort || null;
    } catch { continue; }

    const label = `sid=${sid} age=${Math.round(age / 60000)}m${publicPort ? ` port=${publicPort}` : ''}`;
    if (dryRun) { swept.push(`[dry] ${label}`); continue; }

    await stopDaemon(sDir);
    await killHostFfmpeg(sDir);
    try { await cleanArtifactTemps(sDir); } catch {}
    try { await killInstance(containerName, containerSessionDir(sid)); } catch {}
    if (publicPort) { try { await killGate(publicPort); } catch {} }
    // Fail-closed revocation BEFORE the dir is removed: if removeHostSession
    // fails, the persisted state must not retain a usable credential.
    try {
      revokeToken(state);
      await secureWrite(join(sDir, 'state.json'), JSON.stringify(state, null, 2), { encoding: 'utf-8' });
    } catch {}
    try { await removeContainerSession(containerName, containerSessionDir(sid)); } catch {}
    try { await removeHostSession(sDir); } catch {}
    swept.push(label);
  }

  // Orphaned-daemon pass: running host daemon whose session dir is gone
  try {
    const { stdout } = await execLayer.execFile('pgrep', ['-af', 'session-daemon.mjs --session ']);
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
    const { stdout } = await execLayer.execFile('pgrep', ['-af', 'ffmpeg']);
    for (const line of stdout.split('\n').filter(Boolean)) {
      const m = line.match(sessRe);
      if (!m) continue;
      const sid = m[1];
      if (skipSid && sid === skipSid) continue;
      const sDir = sessionDir(sid);
      let orphaned = !existsSync(sDir);
      if (!orphaned) {
        if (await hasFreshCreatingMarker(sDir)) continue;
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
    const chromiumProcs = await execLayer.pgrepMatch(containerName, '--user-data-dir=/config/csm-browse/sessions/');
    for (const proc of chromiumProcs) {
      const m = proc.cmd.match(/--user-data-dir=\/config\/csm-browse\/sessions\/([^/]+)/);
      if (!m) continue;
      const psid = m[1];
      try { validateSid(psid); } catch { continue; }
      if (skipSid && psid === skipSid) continue;
      // Marker do-not-touch: chromium for a session still being created.
      if (await hasFreshCreatingMarker(join(SESSIONS_ROOT, psid))) continue;
      const hostStateExists = existsSync(join(SESSIONS_ROOT, psid, 'state.json'));
      let containerDirExists = false;
      try {
        await execLayer.execInContainer(containerName, ['test', '-d', `/config/csm-browse/sessions/${psid}`], {}, { timeout: 15000 });
        containerDirExists = true;
      } catch {}
      if (hostStateExists && containerDirExists) continue;
      if (dryRun) { swept.push(`[dry] orphan container chromium sid=${psid}`); continue; }
      try { await execLayer.pkillMatch(containerName, `--user-data-dir=/config/csm-browse/sessions/${psid}/`); } catch {}
      try { await execLayer.pkillMatch(containerName, `--database=/config/csm-browse/sessions/${psid}/crash`); } catch {}
      const portMatch = proc.cmd.match(/--remote-debugging-port=(\d+)/);
      if (portMatch) {
        try { await killGate(parseInt(portMatch[1], 10) + 1); } catch {}
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
       await secureWrite(recPath, JSON.stringify(rec, null, 2), { encoding: 'utf-8' });
      swept.push(`stale recorder lock sid=${sid}`);
    } catch {}
  }

  // Orphan-gate + legacy-socat pass: host-side CDP gates on pool ports with
  // no related chromium, and pre-T001 container-side TCP-LISTEN socats on
  // pool ports. A stale socat forwards its pub port to the OLD session's
  // internal port, which a NEW session may now own — so it would relay to the
  // new chromium with no token. No current session runs container socats (the
  // host gate is the only listener), so ANY pool-port TCP-LISTEN socat is
  // stale and safe to reap. Both sub-passes are skipped entirely while any
  // session creation is in flight (marker do-not-touch): a creating session's
  // chromium may not yet be visible to pgrep, so its gate/socat cannot be
  // safely distinguished from an orphan.
  let anyCreating = false;
  try {
    // Re-scan the root rather than reusing the sweep-start snapshot: a session
    // dir created after that readdir must still protect its in-flight gate.
    const liveDirs = await readdir(SESSIONS_ROOT, { withFileTypes: true });
    for (const ent of liveDirs) {
      if (!ent.isDirectory()) continue;
      const sid = ent.name;
      if (skipSid && sid === skipSid) continue;
      if (await hasFreshCreatingMarker(sessionDir(sid))) { anyCreating = true; break; }
    }
  } catch {}

  if (!anyCreating) {
    try {
      const allGates = await execLayer.hostPgrep('cdp-gate.mjs');
      for (const gate of allGates) {
        const portMatch = gate.cmd.match(/--port\s+(\d+)/);
        if (!portMatch) continue;
        const pubPort = parseInt(portMatch[1], 10);
        if (pubPort < PORT_POOL_START + 1 || pubPort > PORT_POOL_END + 1) continue;
        const relatedChrome = await execLayer.pgrepMatch(containerName, `--remote-debugging-port=${pubPort - 1}`);
        if (relatedChrome.length === 0) {
          if (dryRun) { swept.push(`[dry] orphan gate port=${pubPort}`); continue; }
          try { execLayer.killPid(gate.pid, 'SIGTERM'); } catch {}
          swept.push(`orphan gate port=${pubPort}`);
        }
      }
    } catch {}

    try {
      const socats = await execLayer.pgrepMatch(containerName, 'TCP-LISTEN:92');
      for (const socat of socats) {
        const portMatch = socat.cmd.match(/TCP-LISTEN:(\d+)/);
        if (!portMatch) continue;
        const pubPort = parseInt(portMatch[1], 10);
        if (pubPort < PORT_POOL_START + 1 || pubPort > PORT_POOL_END + 1) continue;
        if (dryRun) { swept.push(`[dry] orphan container socat port=${pubPort}`); continue; }
        try { await execLayer.pkillMatch(containerName, `TCP-LISTEN:${pubPort},`); } catch {}
        swept.push(`orphan container socat port=${pubPort}`);
      }
    } catch {}
  }

  return { swept, skipped: hostDirs.length };
}
