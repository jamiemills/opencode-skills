import { existsSync } from "node:fs";
import { sessionDir, revokeToken, saveState } from "../session.mjs";
import {
  stopDaemon,
  killInstance,
  killGate,
  removeContainerSession,
  removeHostSession,
  truncateLogs,
} from "../cleanup.mjs";
import { CONTAINER_NAME } from "../constants.mjs";

export async function run({ args: _args, state, verb: _verb, sid }) {
  const hostSessionDir = sessionDir(sid);

  if (!state) {
    if (!existsSync(hostSessionDir)) {
      console.log(
        JSON.stringify({
          message: "nothing to do",
          removed: [],
          warnings: [],
          container: { name: CONTAINER_NAME, state: "running" },
        }),
      );
      process.exit(0);
    }
    console.error("no session found");
    process.exit(1);
  }

  // F-013: failures are tracked distinctly from warnings; any failed step
  // makes the verb exit non-zero so an incomplete teardown is never masked
  // by a success-shaped JSON + exit 0.
  const failures = [];
  const removed = [];

  const publicPort = state.publicPort;
  const containerSessDir = state.profileDir;

  try {
    // F-021/R1.3: pass the sid so stopDaemon verifies process identity (argv
    // match) before signaling — a recycled pid must never be SIGTERM'd.
    const stopped = await stopDaemon(hostSessionDir, sid);
    if (stopped) removed.push("daemon");
  } catch (e) {
    failures.push(`stopDaemon: ${e.message}`);
  }

  try {
    if (publicPort) {
      await killGate(publicPort);
      removed.push("gate");
    }
  } catch (e) {
    failures.push(`killGate: ${e.message}`);
  }

  try {
    if (containerSessDir) {
      await killInstance(CONTAINER_NAME, containerSessDir);
      removed.push("chromium");
    }
  } catch (e) {
    failures.push(`killInstance: ${e.message}`);
  }

  try {
    if (containerSessDir) {
      await removeContainerSession(CONTAINER_NAME, containerSessDir);
      removed.push("container-dir");
    }
  } catch (e) {
    failures.push(`removeContainerSession: ${e.message}`);
  }

  try {
    // Fail-closed revocation before the dir is removed: if removeHostSession
    // fails, the persisted state must not retain a usable credential (the
    // gate's env token dies with killGate above; this strips the on-disk one).
    revokeToken(state);
    await saveState(sid, state);
  } catch (e) {
    failures.push(`revokeToken: ${e.message}`);
  }

  try {
    await removeHostSession(hostSessionDir);
    removed.push("host-dir");
  } catch (e) {
    failures.push(`removeHostSession: ${e.message}`);
  }

  // F-067-13a: releasePorts is NOT called here. It would killGate the same
  // public port again after the session dir (which freed the pair) is gone —
  // a fast concurrent creator's brand-new gate could be SIGTERM'd. The gate
  // and chromium were already killed above; the pair is freed by the dir
  // removal, so the extra pass is pure hazard.

  try {
    await truncateLogs(hostSessionDir, CONTAINER_NAME, containerSessDir);
  } catch (e) {
    failures.push(`truncateLogs: ${e.message}`);
  }

  if (removed.length === 0) {
    console.log(
      JSON.stringify({
        message: "nothing to do",
        removed: [],
        warnings: [],
        failures,
        container: { name: CONTAINER_NAME, state: "running" },
      }),
    );
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log(
    JSON.stringify({
      removed,
      warnings: [],
      failures,
      container: { name: CONTAINER_NAME, state: "running" },
    }),
  );
  if (failures.length > 0) process.exit(1);
}
