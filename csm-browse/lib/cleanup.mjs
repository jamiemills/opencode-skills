import { readFile, rm } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pkillMatch, execInContainer, hostPgrep, killPid } from './docker.mjs';
import { validateContainerSessionDir, validateState } from './security.mjs';
import { SESSIONS_ROOT } from './constants.mjs';
import { assertContained, assertRuntimeRoot } from './security.mjs';

export async function stopDaemon(sessionDir) {
  const pidFile = join(sessionDir, 'daemon.pid');
  if (!existsSync(pidFile)) return false;

  let pid;
  try {
    const raw = await readFile(pidFile, 'utf-8');
    pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) return false;
  } catch {
    return false;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      process.kill(pid, 0);
      await setTimeout(200);
    } catch {
      return true;
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch { }

  return true;
}

export async function killInstance(containerName, containerSessDir) {
  validateContainerSessionDir(containerSessDir);
  await pkillMatch(containerName, `--user-data-dir=${containerSessDir}/`);
  await pkillMatch(containerName, `--database=${containerSessDir}/crash`);
}

// Terminate the host-side CDP gate for a public port. The gate is a host
// process (127.0.0.1:<publicPort>), matched by its exact --port argument —
// never by a regex that could straddle another port.
export async function killGate(publicPort) {
  if (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535) throw new Error(`Unsafe public port: ${publicPort}`);
  try {
    const gates = await hostPgrep('cdp-gate.mjs');
    for (const gate of gates) {
      const m = gate.cmd.match(/cdp-gate\.mjs\s+--sid\s+\S+\s+--port\s+(\d+)/);
      if (m && parseInt(m[1], 10) === publicPort) {
        try { killPid(gate.pid, 'SIGTERM'); } catch {}
      }
    }
  } catch {}
}

export async function removeContainerSession(containerName, containerSessDir) {
  validateContainerSessionDir(containerSessDir);
  await execInContainer(containerName, ['rm', '-rf', containerSessDir]);
}

export async function removeHostSession(sessionDir) {
  assertRuntimeRoot(SESSIONS_ROOT);
  assertContained(sessionDir, SESSIONS_ROOT);
  rmSync(sessionDir, { recursive: true, force: true });
}

export async function releasePorts(state) {
  if (!state) return;
  validateState(state);
  const containerName = state.container && state.container.name;
  if (!containerName) return;

  if (state.publicPort) {
    await killGate(state.publicPort);
  }
  if (state.profileDir) {
    await killInstance(containerName, state.profileDir);
  }
}

export async function truncateLogs(sessionDir, containerName, containerSessDir) {
  try {
    await execInContainer(containerName, ['rm', '-f', `${containerSessDir}/chromium.log`]);
  } catch { }
  try {
    await rm(join(sessionDir, 'daemon.log'), { force: true });
  } catch { }
}
