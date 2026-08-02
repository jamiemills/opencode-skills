import { readFile, rm } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pkillMatch, execInContainer } from './docker.mjs';

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
  await pkillMatch(containerName, `--user-data-dir=${containerSessDir}/`);
  await pkillMatch(containerName, `--database=${containerSessDir}/crash`);
}

export async function killSocat(containerName, publicPort) {
  await pkillMatch(containerName, `TCP-LISTEN:${publicPort}`);
}

export async function removeContainerSession(containerName, containerSessDir) {
  await execInContainer(containerName, ['rm', '-rf', containerSessDir]);
}

export async function removeHostSession(sessionDir) {
  rmSync(sessionDir, { recursive: true, force: true });
}

export async function releasePorts(state) {
  // ports are freed by killing processes; no-op for now
}

export async function truncateLogs(sessionDir, containerName, containerSessDir) {
  try {
    await execInContainer(containerName, ['rm', '-f', `${containerSessDir}/chromium.log`]);
  } catch { }
  try {
    await rm(join(sessionDir, 'daemon.log'), { force: true });
  } catch { }
}
