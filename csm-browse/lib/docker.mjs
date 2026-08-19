import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const realExecFile = promisify(execFileCb);
const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const GATE_SCRIPT = join(SKILL_DIR, 'scripts', 'cdp-gate.mjs');

async function realIsContainerRunning(name) {
  try {
    const { stdout } = await realExecFile('docker', [
      'ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

async function realContainerExists(name) {
  try {
    const { stdout } = await realExecFile('docker', [
      'ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

async function realContainerIP(name) {
  const { stdout } = await realExecFile('docker', [
    'inspect', '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    name
  ]);
  return stdout.trim();
}

function realExecDetached(container, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const execArgs = ['exec', '-d'];
    if (opts.user) execArgs.push('-u', opts.user);
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        execArgs.push('-e', `${k}=${v}`);
      }
    }
    execArgs.push(container, ...args);

    const proc = spawn('docker', execArgs, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker exec -d failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function realExecInContainer(container, args, env = {}) {
  const execArgs = ['exec'];
  for (const [k, v] of Object.entries(env)) {
    execArgs.push('-e', `${k}=${v}`);
  }
  execArgs.push(container, ...args);

  const { stdout } = await realExecFile('docker', execArgs, {
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}

async function realIsPortFree(container, port) {
  try {
    const stdout = await realExecInContainer(container, ['netstat', '-tln']);
    return !stdout.includes(`:${port}`);
  } catch {
    try {
      const stdout = await realExecInContainer(container, ['ss', '-tln']);
      return !stdout.includes(`:${port}`);
    } catch {
      throw new Error(`Cannot determine if port ${port} is free in container ${container}`);
    }
  }
}

async function realPgrepMatch(container, pattern) {
  try {
    const stdout = await realExecInContainer(container, ['pgrep', '-af', '--', pattern]);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return { pid: parseInt(line, 10), cmd: '' };
      return {
        pid: parseInt(line.substring(0, spaceIdx), 10),
        cmd: line.substring(spaceIdx + 1)
      };
    });
  } catch (err) {
    if (err.code === 1) return [];  // pgrep exit 1 = no process matched
    throw err;                       // docker failure, permission error, etc.
  }
}

async function realPkillMatch(container, pattern) {
  try {
    await realExecInContainer(container, ['pkill', '-f', '--', pattern]);
  } catch (err) {
    if (err.code === 1) return;  // pkill exit 1 = no process matched
    throw err;                    // docker failure, exit 2 (syntax), exit 3 (fatal)
  }
}

async function realPullImage(image) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await realExecFile('docker', ['pull', image], {
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024
      });
      return;
    } catch (err) {
      lastErr = err;
      const reason = err.killed ? `timed out after 300s` : err.message;
      if (attempt < 2) {
        console.error(`docker pull failed (attempt 1 of 2: ${reason}) — retrying once...`);
      }
    }
  }
  const reason = lastErr && lastErr.killed ? 'timed out after 300s' : (lastErr && lastErr.message);
  throw new Error(`docker pull failed after 2 attempts: ${reason}`);
}

// Host-side CDP token gate (T001): spawn cdp-gate.mjs detached, bound to the
// host loopback public port, tunneling authenticated connections to the
// session's chromium via `docker exec -i ... socat - TCP:127.0.0.1:<internal>`.
// The token travels in the child's env, never in argv (argv is ps-visible).
function realSpawnGate({ sid, publicPort, internalPort, containerName, token }) {
  const proc = spawn(process.execPath, [
    GATE_SCRIPT,
    '--sid', String(sid),
    '--port', String(publicPort),
    '--internal', String(internalPort),
    '--container', String(containerName)
  ], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CSM_CDP_GATE_TOKEN: token }
  });
  proc.on('error', () => {});
  proc.unref();
  return proc.pid;
}

// One authenticated connection's byte tunnel: docker exec -i keeps stdin
// open (no -t), socat bridges the gate's stdio to chromium's CDP port inside
// the container. Returns the child so the gate can relay + tear it down.
function realSpawnExecTunnel(containerName, internalPort) {
  return spawn('docker', [
    'exec', '-i', String(containerName),
    'socat', '-', `TCP:127.0.0.1:${internalPort}`
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}

// Host-side process search (the gate lives on the host, not in the container).
async function realHostPgrep(pattern) {
  try {
    const { stdout } = await realExecFile('pgrep', ['-af', '--', pattern]);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return { pid: parseInt(line, 10), cmd: '' };
      return {
        pid: parseInt(line.substring(0, spaceIdx), 10),
        cmd: line.substring(spaceIdx + 1)
      };
    });
  } catch (err) {
    if (err.code === 1) return [];  // pgrep exit 1 = no process matched
    throw err;                       // real failure
  }
}

function realKillPid(pid, signal = 'SIGTERM') {
  process.kill(pid, signal);
}

// Injectable exec layer (DI seam): all exported helpers dispatch through this
// object, so tests can substitute any of them via setExecLayerForTests().
const realLayer = Object.freeze({
  execFile: realExecFile,
  isContainerRunning: realIsContainerRunning,
  containerExists: realContainerExists,
  containerIP: realContainerIP,
  execDetached: realExecDetached,
  isPortFree: realIsPortFree,
  pgrepMatch: realPgrepMatch,
  pkillMatch: realPkillMatch,
  execInContainer: realExecInContainer,
  pullImage: realPullImage,
  spawnGate: realSpawnGate,
  spawnExecTunnel: realSpawnExecTunnel,
  hostPgrep: realHostPgrep,
  killPid: realKillPid
});

export const execLayer = { ...realLayer };

export function setExecLayerForTests(layer) {
  Object.assign(execLayer, layer ?? realLayer);
}

export async function isContainerRunning(name) {
  return execLayer.isContainerRunning(name);
}

export async function containerExists(name) {
  return execLayer.containerExists(name);
}

export async function containerIP(name) {
  return execLayer.containerIP(name);
}

export function execDetached(container, args, opts) {
  return execLayer.execDetached(container, args, opts);
}

export async function isPortFree(container, port) {
  return execLayer.isPortFree(container, port);
}

export async function pgrepMatch(container, pattern) {
  return execLayer.pgrepMatch(container, pattern);
}

export async function pkillMatch(container, pattern) {
  return execLayer.pkillMatch(container, pattern);
}

export async function execInContainer(container, args, env) {
  return execLayer.execInContainer(container, args, env);
}

export async function pullImage(image) {
  return execLayer.pullImage(image);
}

export function spawnGate(opts) {
  return execLayer.spawnGate(opts);
}

export function spawnExecTunnel(containerName, internalPort) {
  return execLayer.spawnExecTunnel(containerName, internalPort);
}

export async function hostPgrep(pattern) {
  return execLayer.hostPgrep(pattern);
}

export function killPid(pid, signal) {
  return execLayer.killPid(pid, signal);
}
