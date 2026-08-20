#!/usr/bin/env node
import { validateSid, sessionDir, containerSessionDir, loadState, saveState, generateToken, rotateToken, cdpEndpoint } from '../lib/session.mjs';
import { sweep } from '../lib/sweep.mjs';
import { stopDaemon, killGate } from '../lib/cleanup.mjs';
import {
  isContainerRunning, containerExists, containerIP, execDetached,
  pgrepMatch, pkillMatch, pullImage, spawnGate, dockerCli, hostPgrep
} from '../lib/docker.mjs';
import { allocate, acquirePortLock, releasePortLock } from '../lib/ports.mjs';
import {
  CONTAINER_NAME, IMAGE, DOCKER_RUN_CMD, CHROMIUM_FLAGS, CHROMIUM_BIN,
  SKILL_DIR, DAEMON_READY_TIMEOUT_MS, VNC_PASS_PATH,
  CONTAINER_NETWORK, CONTAINER_CONFIG_HOST_DIR, CONTAINER_ENV_FILE,
  CONTAINER_TOKEN_PATH, CONTAINER_GATE_LOG, CONTAINER_GATE_SID,
  CONTAINER_CAP_DROP, CONTAINER_MEMORY, CONTAINER_CPUS, CONTAINER_PIDS_LIMIT,
  CONTAINER_SHM_SIZE, CHROMIUM_CUSTOM_ARGS, SHARED_CDP_PORT, imageStaleMs
} from '../lib/constants.mjs';
import { readFile, rm, open, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { ensurePrivateDir, secureWrite, redactTelemetry, redactUrl } from '../lib/security.mjs';
import { cdpFetchJson, cdpProbe } from '../lib/fetch.mjs';

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

let sid = null;
let dryRun = false;
let cleanupStale = false;
let ageMinutes = 10;

if (isCli) {
  const args = process.argv.slice(2);
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
}

// CDP discovery goes through cdpFetchJson/cdpProbe (lib/fetch.mjs), which use
// Node's fetch: the tokenized URL never appears in a curl argv that other
// local users could read from /proc.

// CDP URLs point at the HOST-side token gate (127.0.0.1:<publicPort>) — the
// container-side socat bridge is gone. Both URLs carry ?token= so the funnel
// is the single place that knows about auth and every consumer keeps using
// the stored URLs unchanged.
function gateCdpUrl(publicPort, token) {
  const url = new URL(`http://127.0.0.1:${publicPort}`);
  url.searchParams.set('token', token);
  return url.toString();
}

function gateWsUrl(versionJson, publicPort, token) {
  const url = new URL(versionJson.webSocketDebuggerUrl);
  url.hostname = '127.0.0.1';
  url.port = String(publicPort);
  url.searchParams.set('token', token);
  return url.toString();
}

// Token hygiene: state carries the raw token in .token and inside wsUrl/
// cdpUrl; the transcript only ever sees redacted copies.
function logState(state) {
  console.log(JSON.stringify(redactTelemetry(state)));
}

async function ensureVncPassword() {
  await ensurePrivateDir(dirname(VNC_PASS_PATH));
  try {
    const fh = await open(VNC_PASS_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await fh.stat();
      if (!info.isFile() || info.uid !== process.getuid()) throw new Error(`Unsafe VNC password file: ${VNC_PASS_PATH}`);
      await fh.chmod(0o600);
      const existing = (await fh.readFile('utf-8')).trim();
      if (existing) return existing;
    } finally { await fh.close(); }
  } catch (err) {
    if (!['ENOENT', 'ELOOP'].includes(err.code)) throw err;
    if (err.code === 'ELOOP') throw new Error(`Refusing symlink VNC password file: ${VNC_PASS_PATH}`, { cause: err });
  }
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const password = Array.from(randomBytes(8), b => chars[b % chars.length]).join('');
  // First-writer-wins: concurrent creators race to create the file with 'wx';
  // the loser re-reads and uses the winner's password so both derive the
  // same VNC_PASSWORD for the shared container.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(VNC_PASS_PATH, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      try { await fh.chmod(0o600); await fh.writeFile(password); } finally { await fh.close(); }
      return password;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const fh = await open(VNC_PASS_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        const info = await fh.stat();
        if (!info.isFile() || info.uid !== process.getuid()) throw new Error(`Unsafe VNC password file: ${VNC_PASS_PATH}`, { cause: err });
        await fh.chmod(0o600);
        const existing = (await fh.readFile('utf-8')).trim();
        if (existing) return existing;
      } finally { await fh.close(); }
      // F-010: the file exists but is EMPTY (crash between the O_EXCL open
      // and write, or external creation). Without this, every subsequent run
      // throws EEXIST forever and the container can never be created. Remove
      // it and retry the O_EXCL create once.
      if (attempt === 0) {
        try { await rm(VNC_PASS_PATH, { force: true }); } catch {}
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not obtain a non-empty VNC password at ${VNC_PASS_PATH}`);
}

// Shared container credential: a token file (0600, first-writer-wins) that
// gates host access to the shared browser's CDP funnel on 127.0.0.1:9222.
async function ensureSharedToken() {
  await ensurePrivateDir(dirname(CONTAINER_TOKEN_PATH));
  try {
    const fh = await open(CONTAINER_TOKEN_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await fh.stat();
      if (!info.isFile() || info.uid !== process.getuid()) throw new Error(`Unsafe container token file: ${CONTAINER_TOKEN_PATH}`);
      await fh.chmod(0o600);
      const existing = (await fh.readFile('utf-8')).trim();
      if (existing) return existing;
    } finally { await fh.close(); }
  } catch (err) {
    if (!['ENOENT', 'ELOOP'].includes(err.code)) throw err;
    if (err.code === 'ELOOP') throw new Error(`Refusing symlink container token file: ${CONTAINER_TOKEN_PATH}`, { cause: err });
  }
  const token = generateToken();
  try {
    const fh = await open(CONTAINER_TOKEN_PATH, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await fh.chmod(0o600); await fh.writeFile(token); } finally { await fh.close(); }
    return token;
  } catch (err) {
    if (err.code === 'EEXIST') {
      const fh = await open(CONTAINER_TOKEN_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try { return (await fh.readFile('utf-8')).trim(); } finally { await fh.close(); }
    }
    throw err;
  }
}

// F-067-9: the VNC password travels via --env-file, never in the docker run
// argv (ps-visible to other local users). The env file is 0600 in the same
// private dir as the password itself.
async function ensureVncEnvFile() {
  await ensurePrivateDir(dirname(CONTAINER_ENV_FILE));
  const password = await ensureVncPassword();
  const content = `VNC_PASSWORD=${password}\n`;
  try {
    const fh = await open(CONTAINER_ENV_FILE, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await fh.chmod(0o600); await fh.writeFile(content); } finally { await fh.close(); }
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const fh = await open(CONTAINER_ENV_FILE, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const existing = await fh.readFile('utf-8');
      if (/^VNC_PASSWORD=.+\n?$/.test(existing)) return;
      await fh.close();
      try { await rm(CONTAINER_ENV_FILE, { force: true }); } catch {}
      return ensureVncEnvFile();
    } finally { await fh.close(); }
  }
}

// The container runs on a dedicated bridge so sibling default-bridge
// containers cannot reach its CDP relay (F-001), with capability/cgroup
// hardening (F-016/F-067-10).
async function ensureNetwork() {
  try {
    await dockerCli(['network', 'inspect', CONTAINER_NETWORK], { timeout: 10000 });
  } catch {
    console.log(`Creating docker network ${CONTAINER_NETWORK}...`);
    await dockerCli(['network', 'create', CONTAINER_NETWORK], { timeout: 10000 });
  }
}

export function buildRunArgs() {
  const capDrops = CONTAINER_CAP_DROP.map((c) => ['--cap-drop', c]).flat();
  return [
    'run', '-d', '--name', CONTAINER_NAME,
    '--restart', 'unless-stopped',
    '--network', CONTAINER_NETWORK,
    ...capDrops,
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp',
    '--tmpfs', '/run',
    '--tmpfs', '/dev/shm',
    '--memory', CONTAINER_MEMORY, '--memory-swap', CONTAINER_MEMORY,
    '--cpus', CONTAINER_CPUS,
    '--pids-limit', String(CONTAINER_PIDS_LIMIT),
    '--shm-size', CONTAINER_SHM_SIZE,
    '-e', 'CHROMIUM_REMOTE_DEBUGGING=1',
    '-e', 'KEEP_APP_RUNNING=1',
    '--env-file', CONTAINER_ENV_FILE,
    '-e', `CHROMIUM_CUSTOM_ARGS=${CHROMIUM_CUSTOM_ARGS}`,
    '-v', `${CONTAINER_CONFIG_HOST_DIR}:/config`,
    '-p', '127.0.0.1:5900:5900',
    IMAGE
  ];
}

// A hardened container does not publish 9222, sits on the dedicated network,
// and mounts a read-only rootfs. Anything else is migrated (one-time) so the
// unauthenticated shared-CDP exposure cannot silently persist.
async function containerIsHardened(name) {
  try {
    const { stdout } = await dockerCli([
      'inspect', name, '--format',
      '{{.HostConfig.PortBindings}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}'
    ], { timeout: 10000 });
    const [ports, network, ro] = stdout.trim().split('|');
    const publishes9222 = /9222\//.test(ports || '');
    return !publishes9222 && (network || '').includes(CONTAINER_NETWORK) && ro === 'true';
  } catch {
    return false;
  }
}

// Resolve when the given port accepts TCP connections on the host loopback
// (the gate's bind is confirmed) or the deadline passes.
function waitForPortBind(port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const probe = () => {
      if (Date.now() - start >= timeoutMs) return resolve(false);
      const sock = createConnection({ port, host: '127.0.0.1' });
      const done = (ok) => { sock.destroy(); if (ok) resolve(true); else globalThis.setTimeout(probe, 200); };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    };
    probe();
  });
}

function waitForPortFree(port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const probe = () => {
      if (Date.now() - start >= timeoutMs) return resolve(false);
      const sock = createConnection({ port, host: '127.0.0.1' });
      const done = (busy) => { sock.destroy(); if (!busy) resolve(true); else globalThis.setTimeout(probe, 200); };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    };
    probe();
  });
}

// F-001: the shared 9222 port is no longer published. Host access goes only
// through a token-gated funnel: a host-side cdp-gate on 127.0.0.1:9222 whose
// tunnel reaches the container's relay via docker exec. Idempotent: reuses an
// existing gate on 9222 and returns the shared token.
export async function ensureSharedGate(dryRunMode = false) {
  const token = await ensureSharedToken();
  const gates = await hostPgrep('cdp-gate.mjs');
  const already = gates.some((g) => {
    const m = g.cmd.match(/cdp-gate\.mjs\s+(?:--sid\s+\S+\s+)?--port\s+(\d+)/);
    return m && parseInt(m[1], 10) === SHARED_CDP_PORT;
  });
  if (already) return token;
  if (dryRunMode) {
    console.log('# Shared CDP gate absent. Would run:');
    console.log(`#   cdp-gate.mjs --sid ${CONTAINER_GATE_SID} --port ${SHARED_CDP_PORT} --internal ${SHARED_CDP_PORT} --container ${CONTAINER_NAME} --log ${CONTAINER_GATE_LOG} (token via env)`);
    return token;
  }
  console.log(`Launching shared CDP gate on 127.0.0.1:${SHARED_CDP_PORT} (token-gated)`);
  await spawnGate({
    sid: CONTAINER_GATE_SID,
    publicPort: SHARED_CDP_PORT,
    internalPort: SHARED_CDP_PORT,
    containerName: CONTAINER_NAME,
    token,
    log: CONTAINER_GATE_LOG
  });
  const bound = await waitForPortBind(SHARED_CDP_PORT, 10000);
  if (!bound) throw new Error(`Shared CDP gate did not bind 127.0.0.1:${SHARED_CDP_PORT}`);
  return token;
}

// F-021: PID liveness is not identity. Before signaling a pid we believe is
// the session daemon, verify its argv actually names session-daemon.mjs for
// this session — a recycled pid must never be SIGTERM'd/SIGKILL'd (or treated
// as the live daemon).
export function pidMatchesDaemon(pid, targetSid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
    return cmd.includes('session-daemon.mjs') && cmd.includes('--session') && cmd.includes(targetSid);
  } catch {
    return false;
  }
}

async function ensureContainer(dryRunMode) {
  // F-059: surface a stale image pin loudly (warn, non-fatal) instead of
  // letting browser CVEs age silently behind the digest.
  const staleMs = imageStaleMs();
  if (staleMs > 0) {
    console.warn(`WARNING: pinned browser image is ${Math.round(staleMs / 86400000)} days stale — refresh the digest per the IMAGE comment cadence`);
  }

  const running = await isContainerRunning(CONTAINER_NAME);
  const exists = running || await containerExists(CONTAINER_NAME);
  const hardened = exists ? await containerIsHardened(CONTAINER_NAME) : false;

  if (exists && !hardened) {
    if (dryRunMode) {
      console.log(`# Container ${CONTAINER_NAME} is not hardened (published 9222 / off the dedicated network / no read-only rootfs). Would migrate:`);
      console.log(`#   docker cp ${CONTAINER_NAME}:/config/. ${CONTAINER_CONFIG_HOST_DIR}/`);
      console.log(`#   docker rm -f ${CONTAINER_NAME}`);
      console.log(`#   ${DOCKER_RUN_CMD}`);
      return;
    }
    console.log(`Container ${CONTAINER_NAME} is not hardened — migrating to the gated/hardened config (profile preserved via ${CONTAINER_CONFIG_HOST_DIR})...`);
    await ensurePrivateDir(CONTAINER_CONFIG_HOST_DIR);
    try {
      await dockerCli(['cp', `${CONTAINER_NAME}:/config/.`, CONTAINER_CONFIG_HOST_DIR], { timeout: 120000 });
    } catch (e) {
      console.warn(`Could not copy /config out of ${CONTAINER_NAME}: ${e.message}`);
    }
    await dockerCli(['rm', '-f', CONTAINER_NAME], { timeout: 30000 });
  }

  if (running && hardened) {
    console.log(`Container ${CONTAINER_NAME} already running (reusing) — probing shared CDP via the token gate...`);
    const token = await ensureSharedGate(dryRunMode);
    const sharedUrl = gateCdpUrl(SHARED_CDP_PORT, token);
    let ready = await cdpProbe(cdpEndpoint(sharedUrl, '/json/version'), { timeoutMs: 5000 });
    if (!ready) {
      console.log('CDP not ready on reused container — restarting container...');
      await dockerCli(['restart', CONTAINER_NAME], { timeout: 60000 });
      const token2 = await ensureSharedGate(false);
      ready = await cdpProbe(cdpEndpoint(gateCdpUrl(SHARED_CDP_PORT, token2), '/json/version'));
      if (!ready) {
        console.error('Shared browser CDP did not become ready after container restart');
        process.exit(1);
      }
    }
    return;
  }

  if (exists && !running) {
    if (dryRunMode) {
      console.log(`# Container exists but stopped. Would run:`);
      console.log(`docker start ${CONTAINER_NAME}`);
      return;
    }
    console.log(`Container ${CONTAINER_NAME} exists but stopped. Starting...`);
    await dockerCli(['start', CONTAINER_NAME], { timeout: 60000 });
  } else if (!exists) {
    if (dryRunMode) {
      console.log(`# Container absent. Would run:`);
      console.log(`#   docker pull ${IMAGE}  (if image missing)`);
      console.log(`#   ${DOCKER_RUN_CMD}`);
      return;
    }
    console.log(`Container ${CONTAINER_NAME} absent. Creating...`);
    try {
      await dockerCli(['inspect', '--type=image', IMAGE], { timeout: 10000 });
    } catch {
      console.log(`Pulling image ${IMAGE}...`);
      await pullImage(IMAGE);
    }
    await ensureNetwork();
    await ensurePrivateDir(CONTAINER_CONFIG_HOST_DIR);
    await ensureVncEnvFile();
    console.log(`Running: ${DOCKER_RUN_CMD}`);
    await dockerCli(buildRunArgs(), { timeout: 60000 });
  }

  const token = await ensureSharedGate(dryRunMode);
  console.log(`Waiting for shared browser CDP via the 127.0.0.1:${SHARED_CDP_PORT} token gate...`);
  const ready = await cdpProbe(cdpEndpoint(gateCdpUrl(SHARED_CDP_PORT, token), '/json/version'));
  if (!ready) {
    console.error('Shared browser CDP did not become ready within timeout');
    process.exit(1);
  }
  console.log('Shared browser CDP ready');
}

async function adoptSession(targetSid, containerSessDir) {
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

  // F-020: mark the session as do-not-touch BEFORE the gate is torn down and
  // respawned — a concurrent sweep would otherwise see no host state and kill
  // the chromium/gate mid-adoption. The marker is removed once state.json
  // lands (main removes it after saveState).
  const hostSessDir = sessionDir(targetSid);
  const markerPath = join(hostSessDir, 'creating.marker');
  await ensurePrivateDir(hostSessDir);
  await secureWrite(markerPath, JSON.stringify({
    pid: process.pid, internal: internalPort, public: publicPort, ts: new Date().toISOString(), adopt: true
  }), { encoding: 'utf-8' });

  // Always respawn the gate with a fresh token: an old gate (if any) holds an
  // unknown token we cannot recover, and adoption must never inherit a stale
  // credential.
  const token = generateToken();
  try {
    await killGate(publicPort);
    await spawnGate({
      sid: targetSid, publicPort, internalPort, containerName: CONTAINER_NAME, token
    });
    console.log(`CDP gate up on 127.0.0.1:${publicPort} -> ${internalPort}`);

    const cdpUrl = gateCdpUrl(publicPort, token);
    console.log(`Waiting for CDP after adopt at ${redactUrl(cdpUrl)}...`);
    const ready = await cdpProbe(cdpEndpoint(cdpUrl, '/json/version'));
    if (!ready) {
      console.error('CDP did not become ready after adopt — killing stale instance');
      await pkillMatch(CONTAINER_NAME, `--user-data-dir=${containerSessDir}/`);
      await killGate(publicPort);
      try { await rm(markerPath, { force: true }); } catch {}
      return null;
    }
    console.log('CDP ready after adopt');

    const versionJson = await cdpFetchJson(cdpEndpoint(cdpUrl, '/json/version'));
    const wsUrl = gateWsUrl(versionJson, publicPort, token);

    return {
      cdpUrl, wsUrl, token, internalPort, publicPort, adopted: true
    };
  } catch (err) {
    try { await rm(markerPath, { force: true }); } catch {}
    throw err;
  }
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

async function createSession(targetSid, containerSessDir) {
  console.log('No existing session found — CREATING new instance...');

  const hostSessDir = sessionDir(targetSid);
  const markerPath = join(hostSessDir, 'creating.marker');
  let internal;
  let pub;
  let token;

  const cleanupLaunch = async () => {
    if (pub) { try { await killGate(pub); } catch {} }
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
    await ensurePrivateDir(hostSessDir);
    await secureWrite(markerPath, JSON.stringify({
      pid: process.pid, internal, public: pub, ts: new Date().toISOString()
    }), { encoding: 'utf-8' });

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
      },
      timeout: 60000
    });
    console.log('Chromium launched');

    // Host-side token gate replaces the container socat bridge. The gate
    // spawns a `docker exec -i ... socat -` tunnel per authenticated
    // connection, so chromium binds only its internal port.
    token = generateToken();
    console.log(`Launching CDP gate on 127.0.0.1:${pub} -> ${internal}...`);
    await spawnGate({
      sid: targetSid, publicPort: pub, internalPort: internal,
      containerName: CONTAINER_NAME, token
    });
    // F-067-8: the lock stays held until the gate has CONFIRMED its bind —
    // spawnGate only returns the child pid; without this, a slow gate start
    // would let a concurrent creator allocate the same pair while this gate
    // has not yet bound (EADDRINUSE double-allocation).
    const bound = await waitForPortBind(pub, 10000);
    if (!bound) throw new Error(`CDP gate did not bind 127.0.0.1:${pub} within 10s`);
    console.log('CDP gate launched');
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

  const cdpUrl = gateCdpUrl(pub, token);
  try {
    console.log(`Waiting for CDP at ${redactUrl(cdpUrl)}...`);
    const ready = await cdpProbe(cdpEndpoint(cdpUrl, '/json/version'));
    if (!ready) throw new Error('CDP did not become ready within timeout');
    console.log('CDP ready');

    const versionJson = await cdpFetchJson(cdpEndpoint(cdpUrl, '/json/version'));
    const wsUrl = gateWsUrl(versionJson, pub, token);

    return {
      cdpUrl, wsUrl, token, internalPort: internal, publicPort: pub, adopted: false
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

async function daemonCdpAlive(targetSid) {
  try {
    const state = await loadState(targetSid);
    if (state && state.cdpUrl) {
      return await cdpProbe(cdpEndpoint(state.cdpUrl, '/json/version'), { timeoutMs: 3000 });
    }
  } catch {}
  return false;
}

async function launchDaemon(targetSid) {
  const sDir = sessionDir(targetSid);
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
        // F-021: liveness is not identity. A recycled pid that is NOT our
        // session-daemon must never be SIGTERM'd (or treated as the live
        // daemon); verify the argv before signaling.
        let alive = pidMatchesDaemon(pid, targetSid);
        try { if (alive) process.kill(pid, 0); } catch { alive = false; }
        if (alive) {
          let staleMarker = false;
          try {
            const st = await stat(readyMarker);
            if (Date.now() - st.mtimeMs > DAEMON_READY_TIMEOUT_MS) staleMarker = true;
          } catch {}
          if (staleMarker || !(await daemonCdpAlive(targetSid))) {
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
      '--session', targetSid
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

// Rotate the session token and bring the gate up on the new credential.
// Used whenever the daemon reconnects to CDP on an existing session: the old
// token is invalidated, the old gate is torn down, and the new gate validates
// only the fresh token.
async function respawnSession(targetSid, state) {
  if (!state.publicPort || !state.internalPort) {
    throw new Error(`Session ${targetSid} missing ports for gate respawn`);
  }
  // F-067-12: kill-before-persist. Killing the old gate FIRST means the
  // pre-rotation token is dead the moment rotation begins; persisting first
  // would leave a live gate serving the old token if killGate failed (not
  // fail-closed). The state is written after the kill so a reconnecting
  // daemon reads the new token.
  await killGate(state.publicPort);
  rotateToken(state);
  await saveState(targetSid, state);
  await waitForPortFree(state.publicPort, 5000);
  await spawnGate({
    sid: targetSid,
    publicPort: state.publicPort,
    internalPort: state.internalPort,
    containerName: CONTAINER_NAME,
    token: state.token
  });
}

// F-011: launchDaemon returning null must never be recorded as a success.
// Every call site funnels through here so a failed daemon launch surfaces as
// a typed error (nonzero exit) instead of a session that looks provisioned.
async function ensureDaemon(targetSid, state) {
  const daemonPid = await launchDaemon(targetSid);
  if (!daemonPid) {
    throw new Error(`Session ${targetSid} daemon failed to launch after retries`);
  }
  state.daemonPid = daemonPid;
  await saveState(targetSid, state);
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
    const cdpReachable = await cdpProbe(cdpEndpoint(existingState.cdpUrl, '/json/version'), { timeoutMs: 5000 });

    if (cdpReachable) {
      if (existingState.daemonPid) {
        try {
          // F-021: liveness is not identity. A recycled pid is not this
          // session's daemon and must never be SIGTERM'd — stopDaemon waits
          // on the pid, so require the argv match before trusting it.
          if (!pidMatchesDaemon(existingState.daemonPid, sid)) {
            throw new Error('daemon pid does not match this session (recycled?)');
          }
          try { process.kill(existingState.daemonPid, 0); } catch {
            throw new Error('daemon pid dead');
          }
          // Stale-but-alive zombie: pid responds but the ready marker's
          // mtime is old (a live daemon touches it every 2s) — stop and
          // relaunch instead of wiring the session to a dead queue loop.
          let zombie = false;
          try {
            const st = await stat(join(hostSessDir, 'daemon.ready'));
            if (Date.now() - st.mtimeMs > DAEMON_READY_TIMEOUT_MS) zombie = true;
          } catch {}
          if (!zombie) {
            if (!existingState.token) {
              // Pre-auth session state (upgrade): never reuse a session
              // without a token — rotate to mint one, bring the gate up, and
              // reconnect the daemon through it (fail closed).
              console.log('Existing session has no auth token — rotating...');
              await stopDaemon(hostSessDir);
              await respawnSession(sid, existingState);
              await ensureDaemon(sid, existingState);
              logState(existingState);
              return;
            }
            console.log('CDP reachable, daemon alive — reusing existing session');
            logState(existingState);
            return;
          }
          console.log('CDP reachable but daemon is a stale zombie — restarting daemon...');
          await stopDaemon(hostSessDir);
          await respawnSession(sid, existingState);
          await ensureDaemon(sid, existingState);
          logState(existingState);
          return;
        } catch {
          console.log('CDP reachable but daemon dead — restarting daemon...');
          await respawnSession(sid, existingState);
          await ensureDaemon(sid, existingState);
          logState(existingState);
          return;
        }
      } else {
        console.log('CDP reachable but no daemon on record — launching daemon...');
        await respawnSession(sid, existingState);
        await ensureDaemon(sid, existingState);
        logState(existingState);
        return;
      }
    } else {
      console.log('CDP unreachable, recreating session...');
    }
  }

  const adopted = await adoptSession(sid, containerSessDir);
  if (adopted) {
    const state = {
      sid,
      cdpUrl: adopted.cdpUrl,
      wsUrl: adopted.wsUrl,
      token: adopted.token,
      tokenGeneration: 1,
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
    // F-020: the adoption marker retires now that the session is durable.
    try { await rm(join(hostSessDir, 'creating.marker'), { force: true }); } catch {}
    await ensureDaemon(sid, state);
    logState(state);
    return;
  }

  const created = await createSession(sid, containerSessDir);
  const state = {
    sid,
    cdpUrl: created.cdpUrl,
    wsUrl: created.wsUrl,
    token: created.token,
    tokenGeneration: 1,
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
  await ensureDaemon(sid, state);
  logState(state);
}

if (isCli) {
  main().catch(err => {
    // F-065-d: report the redacted stack WITH its cause so a failure is
    // diagnosable without leaking tokenized URLs from state.
    const cause = err && err.cause
      ? `\ncause: ${redactTelemetry(err.cause && err.cause.stack ? err.cause.stack : (err.cause && err.cause.message))}`
      : '';
    console.error(redactTelemetry(err && err.stack ? err.stack : err.message) + cause);
    process.exit(1);
  });
}
