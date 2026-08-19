import { existsSync } from 'node:fs';
import { sessionDir, revokeToken, saveState } from '../session.mjs';
import {
  stopDaemon, killInstance, killGate,
  removeContainerSession, removeHostSession,
  releasePorts, truncateLogs
} from '../cleanup.mjs';
import { CONTAINER_NAME } from '../constants.mjs';

export async function run({ args, state, verb, sid }) {
  const hostSessionDir = sessionDir(sid);

  if (!state) {
    if (!existsSync(hostSessionDir)) {
      console.log(JSON.stringify({
        message: 'nothing to do',
        removed: [],
        warnings: [],
        container: { name: CONTAINER_NAME, state: 'running' }
      }));
      process.exit(0);
    }
    console.error('no session found');
    process.exit(1);
  }

  const warnings = [];
  const removed = [];

  const publicPort = state.publicPort;
  const containerSessDir = state.profileDir;

  try {
    const stopped = await stopDaemon(hostSessionDir);
    if (stopped) removed.push('daemon');
  } catch (e) {
    warnings.push(`stopDaemon: ${e.message}`);
  }

  try {
    if (publicPort) {
      await killGate(publicPort);
      removed.push('gate');
    }
  } catch (e) {
    warnings.push(`killGate: ${e.message}`);
  }

  try {
    if (containerSessDir) {
      await killInstance(CONTAINER_NAME, containerSessDir);
      removed.push('chromium');
    }
  } catch (e) {
    warnings.push(`killInstance: ${e.message}`);
  }

  try {
    if (containerSessDir) {
      await removeContainerSession(CONTAINER_NAME, containerSessDir);
      removed.push('container-dir');
    }
  } catch (e) {
    warnings.push(`removeContainerSession: ${e.message}`);
  }

  try {
    // Fail-closed revocation before the dir is removed: if removeHostSession
    // fails, the persisted state must not retain a usable credential (the
    // gate's env token dies with killGate above; this strips the on-disk one).
    revokeToken(state);
    await saveState(sid, state);
  } catch (e) {
    warnings.push(`revokeToken: ${e.message}`);
  }

  try {
    await removeHostSession(hostSessionDir);
    removed.push('host-dir');
  } catch (e) {
    warnings.push(`removeHostSession: ${e.message}`);
  }

  try {
    await releasePorts(state);
  } catch (e) {
    warnings.push(`releasePorts: ${e.message}`);
  }

  try {
    await truncateLogs(hostSessionDir, CONTAINER_NAME, containerSessDir);
  } catch (e) {
    warnings.push(`truncateLogs: ${e.message}`);
  }

  if (removed.length === 0) {
    console.log(JSON.stringify({
      message: 'nothing to do',
      removed: [],
      warnings,
      container: { name: CONTAINER_NAME, state: 'running' }
    }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    removed,
    warnings,
    container: { name: CONTAINER_NAME, state: 'running' }
  }));
}
