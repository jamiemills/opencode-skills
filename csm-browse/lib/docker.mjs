import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const realExecFile = promisify(execFileCb);

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
  pullImage: realPullImage
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
