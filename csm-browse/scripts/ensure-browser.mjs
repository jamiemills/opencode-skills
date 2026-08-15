#!/usr/bin/env node
import { validateSid, sessionDir, containerSessionDir, loadState, saveState } from '../lib/session.mjs';
import { sweep } from '../lib/sweep.mjs';
import {
  isContainerRunning, containerExists, containerIP, execDetached,
  pgrepMatch, pkillMatch, pullImage
} from '../lib/docker.mjs';
import { allocate, acquirePortLock, releasePortLock } from '../lib/ports.mjs';
import {
  CONTAINER_NAME, IMAGE, DOCKER_RUN_CMD, CHROMIUM_FLAGS, CHROMIUM_BIN,
  CDP_RETRY_TIMEOUT_MS, SKILL_DIR, DAEMON_READY_TIMEOUT_MS
} from '../lib/constants.mjs';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  const { stdout } = await execFileAsync('curl', ['-s', url]);
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

async function ensureContainer(dryRun) {
  const running = await isContainerRunning(CONTAINER_NAME);
  const exists = running || await containerExists(CONTAINER_NAME);

  if (running) {
    console.log(`Container ${CONTAINER_NAME} already running (reusing)`);
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
      '-p', '5900:5900', '-p', '9222:9222', IMAGE];
    await execFileAsync('docker', runArgs);
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
      `TCP-LISTEN:${publicPort},fork,reuseaddr,bind=0.0.0.0`,
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

async function createSession(ip, containerSessDir) {
  console.log('No existing session found — CREATING new instance...');

  await acquirePortLock();
  try {
    const { internal, public: pub } = await allocate(CONTAINER_NAME);
    console.log(`Allocated ports: internal=${internal}, public=${pub}`);

    try {
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
        `TCP-LISTEN:${pub},fork,reuseaddr,bind=0.0.0.0`,
        `TCP:127.0.0.1:${internal}`
      ]);
      console.log('Socat launched');

      const cdpUrl = `http://${ip}:${pub}`;
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
      await pkillMatch(CONTAINER_NAME, `TCP-LISTEN:${pub}`);
      await pkillMatch(CONTAINER_NAME, `--user-data-dir=${containerSessDir}/`);
      throw err;
    }
  } finally {
    await releasePortLock();
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

async function launchDaemon(sid) {
  const sDir = sessionDir(sid);
  const readyMarker = join(sDir, 'daemon.ready');
  const pidFilePath = join(sDir, 'daemon.pid');

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

    let daemonPid = null;
    const start = Date.now();

    while (Date.now() - start < DAEMON_READY_TIMEOUT_MS) {
      if (!daemonPid && existsSync(pidFilePath)) {
        try {
          const raw = await readFile(pidFilePath, 'utf-8');
          daemonPid = parseInt(raw.trim(), 10);
        } catch {}
      }

      if (daemonPid && existsSync(readyMarker)) {
        console.log(`Daemon ready (pid ${daemonPid})`);
        return daemonPid;
      }

      await setTimeout(500);
    }

    let died = false;
    if (daemonPid) {
      try { process.kill(daemonPid, 0); } catch { died = true; }
    }
    const mem = await memAvailableMb();
    if (died) {
      console.error(`Daemon (pid ${daemonPid}) died before becoming ready — possible OOM. Host available memory: ${mem} MB`);
      try { await rm(pidFilePath, { force: true }); } catch {}
      try { await rm(readyMarker, { force: true }); } catch {}
      return null;
    }
    if (attempt < 2) {
      console.error('Daemon did not become ready within timeout — retrying once...');
      if (daemonPid) {
        try { process.kill(daemonPid, 'SIGTERM'); } catch {}
        for (let i = 0; i < 20; i++) {
          try { process.kill(daemonPid, 0); } catch { break; }
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
          console.log('CDP reachable, daemon alive — reusing existing session');
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
        console.log('CDP reachable — reusing existing session');
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

  const created = await createSession(ip, containerSessDir);
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
  const daemonPid2 = await launchDaemon(sid);
  state.daemonPid = daemonPid2;
  if (daemonPid2) await saveState(sid, state);
  console.log(JSON.stringify(state));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
