import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export async function isContainerRunning(name) {
  try {
    const { stdout } = await execFile('docker', [
      'ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

export async function containerExists(name) {
  try {
    const { stdout } = await execFile('docker', [
      'ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

export async function containerIP(name) {
  const { stdout } = await execFile('docker', [
    'inspect', '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    name
  ]);
  return stdout.trim();
}

export function execDetached(container, args, opts = {}) {
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

export async function isPortFree(container, port) {
  try {
    const stdout = await execInContainer(container, ['netstat', '-tln']);
    return !stdout.includes(`:${port}`);
  } catch {
    try {
      const stdout = await execInContainer(container, ['ss', '-tln']);
      return !stdout.includes(`:${port}`);
    } catch {
      throw new Error(`Cannot determine if port ${port} is free in container ${container}`);
    }
  }
}

export async function pgrepMatch(container, pattern) {
  try {
    const stdout = await execInContainer(container, ['pgrep', '-af', '--', pattern]);
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

export async function pkillMatch(container, pattern) {
  try {
    await execInContainer(container, ['pkill', '-f', '--', pattern]);
  } catch (err) {
    if (err.code === 1) return;  // pkill exit 1 = no process matched
    throw err;                    // docker failure, exit 2 (syntax), exit 3 (fatal)
  }
}

export async function execInContainer(container, args, env = {}) {
  const execArgs = ['exec'];
  for (const [k, v] of Object.entries(env)) {
    execArgs.push('-e', `${k}=${v}`);
  }
  execArgs.push(container, ...args);

  const { stdout } = await execFile('docker', execArgs, {
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}

export async function pullImage(image) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await execFile('docker', ['pull', image], {
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
