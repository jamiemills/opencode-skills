#!/usr/bin/env node
import { validateSid, sessionDir, containerSessionDir, loadState, saveState } from '../lib/session.mjs';
import { sweep } from '../lib/sweep.mjs';
import { stopDaemon } from '../lib/cleanup.mjs';
import {
  isContainerRunning, containerExists, containerIP, execDetached,
  pgrepMatch, pkillMatch, pullImage
} from '../lib/docker.mjs';
import { allocate, acquirePortLock, releasePortLock } from '../lib/ports.mjs';
import {
  CONTAINER_NAME, IMAGE, DOCKER_RUN_CMD, CHROMIUM_FLAGS, CHROMIUM_BIN,
  CDP_RETRY_TIMEOUT_MS, SKILL_DIR, DAEMON_READY_TIMEOUT_MS, VNC_PASS_PATH
} from '../lib/constants.mjs';
import { readFile, rm, mkdir, writeFile, open, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
let sid = null;
let dryRun = false;
let cleanupStale = false;
let ageMinutes = 10;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session' && i + 1 < args.length) sid = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--cleanup-stale') cleanupStale = true;
  else if (args[i] === '--age' && i + 1 < args.length) ageMinutes = parseFloat(args[++i]) || 10;
}

if (!sid && !cleanupStale) {
  console.error('Usage: node scripts/ensure-browser.mjs --session <sid> [--dry-run] [--cleanup-stale] [--age MINS]');
  process.exit(1);
}

if (sid) {
  try {
    validateSid(sid);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

async function curlJson(url) {
  const { stdout } = await execFileAsync('curl', ['-s', '-m', '2', url]);
  return JSON.parse(stdout);
}

async function curlRetry(url, timeout = CDP_RETRY_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await curlJson(url);
      return true;
    } catch {
      await setTimeout(1000);
    }
  }
  return false;
}

async function ensureVncPassword() {
  try {
    const existing = (await readFile(VNC_PASS_PATH, 'utf-8')).trim();
    if (existing) return existing;
  } catch {}
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const password = Array.from(randomBytes(8), b => chars[b % chars.length]).join('');
  await mkdir(dirname(VNC_PASS_PATH), { recursive: true, mode: 0o700 });
  // First-writer-wins: concurrent creators race to create the file with 'wx';
  // the loser re-reads and uses the winner's password so both derive the
  // same VNC_PASSWORD for the shared container.
  try {
    const fh = await open(VNC_PASS_PATH, 'wx', 0o600);
    try { await fh.write(password); } finally { await fh.close(); }
    return password;
  } catch (err) {
    if (err.code === 'EEXIST') {
      const existing = (await readFile(VNC_PASS_PATH, 'utf-8')).trim();
      if (existing) return existing;
    }
    throw err;
  }
}

async function ensureContainer(dryRun) {
  const running = await isContainerRunning(CONTAINER_NAME);
  const exists = running || await containerExists(CONTAINER_NAME);

  if (running) {
    console.log(`Container ${CONTAINER_NAME} already running (reusing) — probing CDP readiness...`);
    let ready = await curlRetry('http://localhost:9222/json/version', 5000);
    if (!ready) {
      console.log('CDP not ready on reused container — restarting container...');
      await execFileAsync('docker', ['restart', CONTAINER_NAME], { timeout: 60000 });
      ready = await curlRetry('http://localhost:9222/json/version');
      if (!ready) {
        console.error('Shared browser CDP did not become ready after container restart');
        process.exit(1);
      }
    }
    return;
  }

  if (exists) {
    if (dryRun) {
      console.log(`# Container exists but stopped. Would run:`);
      console.log(`docker start ${CONTAINER_NAME}`);
      return;
    }
    console.log(`Container ${CONTAINER_NAME} exists but stopped. Starting...`);
    await execFileAsync('docker', ['start', CONTAINER_NAME]);
  } else {
    if (dryRun) {
      console.log(`# Container absent. Would run:`);
      console.log(`#   docker pull ${IMAGE}  (if image missing)`);
      console.log(`#   ${DOCKER_RUN_CMD}`);
      return;
    }
    console.log(`Container ${CONTAINER_NAME} absent. Creating...`);
    try {
      await execFileAsync('docker', ['inspect', '--type=image', IMAGE]);
    } catch {
      console.log(`Pulling image ${IMAGE}...`);
      await pullImage(IMAGE);
    }
    console.log(`Running: ${DOCKER_RUN_CMD}`);
    const runArgs = ['run', '-d', '--name', CONTAINER_NAME,
      '--restart', 'unless-stopped',
      '-e', 'CHROMIUM_REMOTE_DEBUGGING=1',
      '-e', 'KEEP_APP_RUNNING=1',
      '-e', `VNC_PASSWORD=${await ensureVncPassword()}`,
      '-p', '127.0.0.1:5900:5900', '-p', '127.0.0.1:9222:9222', IMAGE];
    await execFileAsync('docker', runArgs, { timeout: 60000 });
  }

  console.log('Waiting for shared browser CDP on localhost:9222...');
  const ready = await curlRetry('http://localhost:9222/json/version');
  if (!ready) {
    console.error('Shared browser CDP did not become ready within timeout');
    process.exit(1);
  }
  console.log('Shared browser CDP ready');
}

async function adoptSession(ip, containerSessDir) {
  const matches = await pgrepMatch(CONTAINER_NAME,
    `--user-data-dir=${containerSessDir}/`);
  if (matches.length === 0) return null;

  console.log(`Found existing chromium process with our profile (pid ${matches[0].pid}) — ADOPTING`);

  const portMatch = matches[0].cmd.match(/--remote-debugging-port=(\d+)/);
  if (!portMatch) {
    console.error('Could not parse --remote-debugging-port from existing chromium process');
    return null;
  }

  const internalPort = parseInt(portMatch[1], 10);
  const publicPort = internalPort + 1;

  const socatMatches = await pgrepMatch(CONTAINER_NAME, `TCP-LISTEN:${publicPort}`);
  if (socatMatches.length === 0) {
    console.log(`Respawning socat on port ${publicPort} -> ${internalPort}`);
    await execDetached(CONTAINER_NAME, [
      'socat',
      `TCP-LISTEN:${publicPort},fork,reuseaddr,bind=${ip}`,
      `TCP:127.0.0.1:${internalPort}`
    ]);
  } else {
    console.log(`Socat already running (pid ${socatMatches[0].pid})`);
  }

  const cdpUrl = `http://${ip}:${publicPort}`;
  console.log(`Waiting for CDP after adopt at ${cdpUrl}...`);
  const ready = await curlRetry(`${cdpUrl}/json/version`);
  if (!ready) {
    console.error('CDP did not become ready after adopt — killing stale instance');
    await pkillMatch(CONTAINER_NAME, `--user-data-dir=${containerSessDir}/`);
    await pkillMatch(CONTAINER_NAME, `TCP-LISTEN:${publicPort}`);
    return null;
  }
  console.log('CDP ready after adopt');

  const versionJson = await curlJson(`${cdpUrl}/json/version`);
  const wsUrl = versionJson.webSocketDebuggerUrl.replace('localhost', ip);

  return {
    cdpUrl, wsUrl, internalPort, publicPort, adopted: true
  };
}

function buildChromiumCmd(containerSessDir, internalPort) {
  const flagsStr = CHROMIUM_FLAGS.join(' ');
  return [
    'mkdir -p',
    '$SESS/profile',
    '$SESS/cache',
    '$SESS/crash',
    '$SESS/xdg/runtime',
    '&&',
    CHROMIUM_BIN,
    flagsStr,
    `--remote-debugging-port=${internalPort}`,
    '--user-data-dir=$SESS/profile',
    '--disk-cache-dir=$SESS/cache',
    '--crash-dumps-dir=$SESS/crash',
    '>$SESS/chromium.log',
    '2>&1',
    '&'
  ].join(' ');
}

async function createSession(sid, ip, containerSessDir) {
  console.log('No existing session found — CREATING new instance...');
  if (!ip) throw new Error('container IP unavailable');

  const hostSessDir = sessionDir(sid);
  const markerPath = join(hostSessDir, 'creating.marker');
  let internal;
  let pub;

  const cleanupLaunch = async () => {
    if (pub) { try { await pkillMatch(CONTAINER_NAME, `TCP-LISTEN:${pub}`); } catch {} }
    try { await pkillMatch(CONTAINER_NAME, `--user-data-dir=${containerSessDir}/`); } catch {}
    try { await rm(markerPath, { force: true }); } catch {}
  };

  await acquirePortLock();
  try {
    ({ internal, public: pub } = await allocate(CONTAINER_NAME));
    console.log(`Allocated ports: internal=${internal}, public=${pub}`);

    // creating.marker INSIDE the lock critical section, BEFORE launching
    // chromium: any concurrent sweep that runs while we hold/release the
    // lock must treat this session as do-not-touch until state.json lands.
    await mkdir(hostSessDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      pid: process.pid, internal, public: pub, ts: new Date().toISOString()
    }), 'utf-8');

    const chromiumCmd = buildChromiumCmd(containerSessDir, internal);

    console.log('Launching chromium...');
    await execDetached(CONTAINER_NAME, ['sh', '-c', chromiumCmd], {
      user: '1000',
      env: {
        DISPLAY: ':0',
        HOME: containerSessDir,
        XDG_CONFIG_HOME: `${containerSessDir}/xdg/config`,
        XDG_CACHE_HOME: `${containerSessDir}/xdg/cache`,
        XDG_DATA_HOME: `${containerSessDir}/xdg/data`,
        XDG_STATE_HOME: `${containerSessDir}/xdg/state`,
        XDG_RUNTIME_DIR: `${containerSessDir}/xdg/runtime`,
        SESS: containerSessDir
      }
    });
    console.log('Chromium launched');

    console.log(`Launching socat on ${pub} -> ${internal}...`);
    await execDetached(CONTAINER_NAME, [
      'socat',
      `TCP-LISTEN:${pub},fork,reuseaddr,bind=${ip}`,
      `TCP:127.0.0.1:${internal}`
    ]);
    console.log('Socat launched');
  } catch (err) {
    await releasePortLock();
    console.error(`Create failed: ${err.message} — cleaning up`);
    await cleanupLaunch();
    throw err;
  }

  // Bind complete — release the lock BEFORE the CDP readiness wait so the
  // hold covers only the allocation+bind critical section (LOCK_WAIT_MS in
  // ports.mjs is sized to this, not to the 30s readiness window).
  await releasePortLock();

  const cdpUrl = `http://${ip}:${pub}`;
  try {
    console.log(`Waiting for CDP at ${cdpUrl}...`);
    const ready = await curlRetry(`${cdpUrl}/json/version`);
    if (!ready) throw new Error('CDP did not become ready within timeout');
    console.log('CDP ready');

    const versionJson = await curlJson(`${cdpUrl}/json/version`);
    const wsUrl = versionJson.webSocketDebuggerUrl.replace('localhost', ip);

    return {
      cdpUrl, wsUrl, internalPort: internal, publicPort: pub, adopted: false
    };
  } catch (err) {
    console.error(`Create failed: ${err.message} — cleaning up`);
    await cleanupLaunch();
    throw err;
  }
}

async function memAvailableMb() {
  try {
    const { stdout } = await execFileAsync('free', ['-m']);
    const m = stdout.match(/^Mem:\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : -1;
  } catch {
    return -1;
  }
}

async function daemonCdpAlive(sid) {
  try {
    const state = await loadState(sid);
    if (state && state.cdpUrl) {
      return await curlRetry(`${state.cdpUrl}/json/version`, 3000);
    }
  } catch {}
  return false;
}

async function launchDaemon(sid) {
  const sDir = sessionDir(sid);
  const readyMarker = join(sDir, 'daemon.ready');
  const pidFilePath = join(sDir, 'daemon.pid');

  // Zombie pre-check: a stale-but-alive daemon from a previous session
  // generation holds pid+ready markers, makes our fresh spawn exit 2
  // (single-instance), and gets mis-adopted by the wait loop below. A daemon
  // is a zombie when its ready marker is stale (a live daemon touches it
  // every 2s) or its CDP endpoint is dead — stop it before relaunching.
  try {
    if (existsSync(pidFilePath)) {
      let pid = null;
      try { pid = parseInt((await readFile(pidFilePath, 'utf-8')).trim(), 10); } catch {}
      if (!isNaN(pid)) {
        let alive = true;
        try { process.kill(pid, 0); } catch { alive = false; }
        if (alive) {
          let staleMarker = false;
          try {
            const st = await stat(readyMarker);
            if (Date.now() - st.mtimeMs > DAEMON_READY_TIMEOUT_MS) staleMarker = true;
          } catch {}
          if (staleMarker || !(await daemonCdpAlive(sid))) {
            console.log(`Daemon pid ${pid} alive but stale (zombie) — stopping before relaunch`);
            await stopDaemon(sDir);
            try { await rm(pidFilePath, { force: true }); } catch {}
            try { await rm(readyMarker, { force: true }); } catch {}
          } else {
            console.log(`Healthy daemon already running (pid ${pid})`);
            return pid;
          }
        }
      }
    }
  } catch {}

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`Starting session daemon (attempt ${attempt})...`);

    const daemonProc = spawn('node', [
      join(SKILL_DIR, 'scripts', 'session-daemon.mjs'),
      '--session', sid
    ], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    daemonProc.unref();
    // Capture the exit code: 2 = single-instance refusal, meaning a healthy
    // winner daemon owns pidFile/readyMarker — those markers must survive.
    let childExitCode = null;
    daemonProc.on('exit', (code) => { childExitCode = code; });

    const childPid = daemonProc.pid;
    const start = Date.now();

    while (Date.now() - start < DAEMON_READY_TIMEOUT_MS) {
      let childAlive = true;
      if (childPid) {
        try { process.kill(childPid, 0); } catch { childAlive = false; }
      }
      if (!childAlive) break;

      // Accept only a ready marker written by OUR child since spawn: a
      // pre-existing marker (mtime older than this attempt) belongs to a
      // previous daemon and must never be adopted.
      if (existsSync(readyMarker)) {
        try {
          const st = await stat(readyMarker);
          if (st.mtimeMs >= start - 1000) {
            console.log(`Daemon ready (pid ${childPid})`);
            return childPid;
          }
        } catch {}
      }

      await setTimeout(500);
    }

    let died = false;
    if (childPid) {
      try { process.kill(childPid, 0); } catch { died = true; }
    }
    const mem = await memAvailableMb();
    if (died) {
      if (childExitCode === 2) {
        // Refused because another healthy daemon owns the claim: adopt it
        // instead of deleting the winner's markers and double-spawning.
        console.log('Daemon claim refused (already running) — adopting existing daemon');
        try {
          const pid = parseInt((await readFile(pidFilePath, 'utf-8')).trim(), 10);
          if (!isNaN(pid)) return pid;
        } catch {}
        return null;
      }
      console.error(`Daemon (pid ${childPid}) died before becoming ready — possible OOM. Host available memory: ${mem} MB`);
      try { await rm(pidFilePath, { force: true }); } catch {}
      try { await rm(readyMarker, { force: true }); } catch {}
      return null;
    }
    if (attempt < 2) {
      console.error('Daemon did not become ready within timeout — retrying once...');
      if (childPid) {
        try { process.kill(childPid, 'SIGTERM'); } catch {}
        for (let i = 0; i < 20; i++) {
          try { process.kill(childPid, 0); } catch { break; }
          await setTimeout(100);
        }
      }
      try { await rm(pidFilePath, { force: true }); } catch {}
      try { await rm(readyMarker, { force: true }); } catch {}
    }
  }

  console.error(`Daemon did not become ready after 2 attempts. Host available memory: ${await memAvailableMb()} MB`);
  return null;
}

async function main() {
  if (cleanupStale) {
    await ensureContainer(false);
    const ip = await containerIP(CONTAINER_NAME);
    console.log(`Container IP: ${ip}`);
    const res = await sweep({ containerName: CONTAINER_NAME, ip, ageMinutes, dryRun });
    console.log(JSON.stringify({ cleaned: res.swept.length, removed: res.swept }));
    return;
  }

  await ensureContainer(dryRun);
  if (dryRun) return;

  try {
    const ip = await containerIP(CONTAINER_NAME);
    const res = await sweep({ containerName: CONTAINER_NAME, ip, skipSid: sid, dryRun: false });
    if (res.swept.length > 0) console.log(`Sweep: ${res.swept.join(', ')}`);
  } catch (e) {
    console.error(`Sweep skipped: ${e.message}`);
  }

  const ip = await containerIP(CONTAINER_NAME);
  if (!ip) throw new Error('container IP unavailable');
  console.log(`Container IP: ${ip}`);

  const hostSessDir = sessionDir(sid);
  const containerSessDir = containerSessionDir(sid);
  const existingState = await loadState(sid);

  if (existingState) {
    console.log('Found existing state.json');
    const cdpReachable = await curlRetry(`${existingState.cdpUrl}/json/version`, 5000);

    if (cdpReachable) {
      if (existingState.daemonPid) {
        try {
          process.kill(existingState.daemonPid, 0);
          // Stale-but-alive zombie: pid responds but the ready marker's
          // mtime is old (a live daemon touches it every 2s) — stop and
          // relaunch instead of wiring the session to a dead queue loop.
          let zombie = false;
          try {
            const st = await stat(join(hostSessDir, 'daemon.ready'));
            if (Date.now() - st.mtimeMs > DAEMON_READY_TIMEOUT_MS) zombie = true;
          } catch {}
          if (!zombie) {
            console.log('CDP reachable, daemon alive — reusing existing session');
            console.log(JSON.stringify(existingState));
            return;
          }
          console.log('CDP reachable but daemon is a stale zombie — restarting daemon...');
          await stopDaemon(hostSessDir);
          const daemonPid = await launchDaemon(sid);
          existingState.daemonPid = daemonPid;
          if (daemonPid) await saveState(sid, existingState);
          console.log(JSON.stringify(existingState));
          return;
        } catch {
          console.log('CDP reachable but daemon dead — restarting daemon...');
          const daemonPid = await launchDaemon(sid);
          existingState.daemonPid = daemonPid;
          if (daemonPid) await saveState(sid, existingState);
          console.log(JSON.stringify(existingState));
          return;
        }
      } else {
        console.log('CDP reachable but no daemon on record — launching daemon...');
        const daemonPid = await launchDaemon(sid);
        existingState.daemonPid = daemonPid;
        if (daemonPid) await saveState(sid, existingState);
        console.log(JSON.stringify(existingState));
        return;
      }
    } else {
      console.log('CDP unreachable, recreating session...');
    }
  }

  const adopted = await adoptSession(ip, containerSessDir);
  if (adopted) {
    const state = {
      sid,
      cdpUrl: adopted.cdpUrl,
      wsUrl: adopted.wsUrl,
      internalPort: adopted.internalPort,
      publicPort: adopted.publicPort,
      sessionDir: hostSessDir,
      profileDir: containerSessDir,
      daemonPid: null,
      container: { name: CONTAINER_NAME, ip, state: 'running' },
      createdAt: new Date().toISOString(),
      adopted: true
    };
    await saveState(sid, state);
    const daemonPid = await launchDaemon(sid);
    state.daemonPid = daemonPid;
    if (daemonPid) await saveState(sid, state);
    console.log(JSON.stringify(state));
    return;
  }

  const created = await createSession(sid, ip, containerSessDir);
  const state = {
    sid,
    cdpUrl: created.cdpUrl,
    wsUrl: created.wsUrl,
    internalPort: created.internalPort,
    publicPort: created.publicPort,
    sessionDir: hostSessDir,
    profileDir: containerSessDir,
    daemonPid: null,
    container: { name: CONTAINER_NAME, ip, state: 'running' },
    createdAt: new Date().toISOString(),
    adopted: false
  };
  await saveState(sid, state);
  // Session is durable now — retire the creation marker so sweep's
  // do-not-touch window closes and normal liveness/aging applies.
  try { await rm(join(hostSessDir, 'creating.marker'), { force: true }); } catch {}
  const daemonPid2 = await launchDaemon(sid);
  state.daemonPid = daemonPid2;
  if (daemonPid2) await saveState(sid, state);
  console.log(JSON.stringify(state));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
