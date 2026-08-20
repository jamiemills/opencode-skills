import { readFile, rm } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pkillMatch, execInContainer, hostPgrep, killPid } from './docker.mjs';
import { validateContainerSessionDir, validateState } from './security.mjs';
import { SESSIONS_ROOT } from './constants.mjs';
import { assertContained, assertRuntimeRoot } from './security.mjs';

// F-021: process-identity verification. A bare `process.kill(pid, 0)` probe
// proves only that SOME process occupies the pid — a recycled pid could be an
// unrelated process. Refuse to signal any pid that does not provably carry
// `session-daemon.mjs --session <sid>` in its argv (read from /proc/<pid>/
// cmdline, the same argv evidence sweep's pgrep passes rely on). Returns
// false when the process is gone or unverifiable (non-Linux /proc, EACCES),
// so a caller never signals a pid it cannot identify.
export async function isSessionDaemon(pid, sid) {
  if (!Number.isInteger(pid) || typeof sid !== 'string' || !sid) return false;
  let argv;
  try {
    const buf = await readFile(`/proc/${pid}/cmdline`, 'utf-8');
    argv = buf.split('\0').filter(Boolean);
  } catch {
    return false;
  }
  const sIdx = argv.indexOf('--session');
  return sIdx !== -1
    && argv[sIdx + 1] === sid
    && argv.some((a) => a.includes('session-daemon.mjs'));
}

export async function stopDaemon(sessionDir, sid = null) {
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

  // F-021: verify process identity BEFORE signaling. When the session id is
  // known, the pid must provably belong to THIS session's daemon; otherwise
  // refuse to act — a recycled pid must never be SIGTERM'd/SIGKILL'd.
  if (sid !== null && !(await isSessionDaemon(pid, sid))) return false;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (sid !== null) {
      if (!(await isSessionDaemon(pid, sid))) return true;
      await setTimeout(200);
    } else {
      try {
        process.kill(pid, 0);
        await setTimeout(200);
      } catch {
        return true;
      }
    }
  }

  if (sid === null || (await isSessionDaemon(pid, sid))) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch { }
  }

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
  await execInContainer(containerName, ['rm', '-rf', containerSessDir], {}, { timeout: 120000 });
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

  // F-067-13b: the redundant double killGate is removed. The gate for the
  // session's public port is torn down by the caller (close verb / sweep)
  // BEFORE the session dir is removed; re-killing the same public port here
  // risks SIGTERM'ing a fast concurrent creator's brand-new gate. Only the
  // chromium instance is released here.
  if (state.profileDir) {
    await killInstance(containerName, state.profileDir);
  }
}

export async function truncateLogs(sessionDir, containerName, containerSessDir) {
  try {
    await execInContainer(containerName, ['rm', '-f', `${containerSessDir}/chromium.log`], {}, { timeout: 30000 });
  } catch { }
  try {
    await rm(join(sessionDir, 'daemon.log'), { force: true });
  } catch { }
}
