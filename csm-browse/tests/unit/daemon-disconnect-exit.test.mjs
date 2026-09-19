import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { startFakeCdp } from "./helpers/fake-cdp-server.mjs";

// Focused regression guard for T002: the daemon must exit 0 within a bounded
// time on CDP disconnect. The historical flake closed the fake CDP server in
// the window between the ready marker appearing and the daemon registering its
// 'disconnect' listener; CRI emits that event exactly once, so the daemon then
// polled a dead client forever (the runner saw code -1 / hung). This test
// closes the server as soon as the ready marker exists (2ms poll) and repeats,
// which deterministically hit the old race.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // csm-browse/
const root = await mkdtemp(join(tmpdir(), "csm-browse-daemon-exit-"));
process.env.CSM_BROWSE_SESSIONS_ROOT = root;

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const EXIT_BOUND_MS = 3000;
const CLOSE_WAIT_MS = 5000;

function spawnDaemon(sid) {
  return spawn(process.execPath, ["scripts/session-daemon.mjs", "--session", sid], {
    cwd: SKILL_DIR,
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

// Resolves the exit code, or -1 if the child did not exit inside `ms`. Never
// leaves a live child behind: callers reap in `finally`.
function waitExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), ms);
    if (timer.unref) timer.unref();
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function killAndReap(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await waitExit(child, 5000);
}

test(
  "daemon exits 0 within a bounded time when CDP disconnects right after ready",
  { timeout: 30000 },
  async () => {
    for (let i = 0; i < 4; i++) {
      const sid = `exit-${i}`;
      const sDir = join(root, sid);
      await mkdir(sDir, { recursive: true });

      let server = null;
      let child = null;
      try {
        server = await startFakeCdp({
          responses: {
            "Target.getTargets": () => ({
              targetInfos: [{ type: "page", targetId: "t1", url: "about:blank" }],
            }),
            "Target.attachToTarget": () => ({ sessionId: "TAB1" }),
          },
        });
        await writeFile(
          join(sDir, "state.json"),
          JSON.stringify({ wsUrl: server.url, internalPort: 9224, publicPort: 9225 }),
        );

        child = spawnDaemon(sid);
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr += d;
        });

        // Poll tightly so the close lands as close as possible to the ready
        // marker — the exact window the old code lost the disconnect event in.
        const deadline = Date.now() + 15000;
        while (!existsSync(join(sDir, "daemon.ready")) && Date.now() < deadline) {
          await sleep(2);
        }
        assert.ok(
          existsSync(join(sDir, "daemon.ready")),
          `daemon.ready never appeared (${stderr})`,
        );

        const closedAt = Date.now();
        server.closeAll();
        const code = await waitExit(child, CLOSE_WAIT_MS);
        const elapsed = Date.now() - closedAt;

        assert.equal(code, 0, `iteration ${i}: daemon exit code ${code} (${stderr})`);
        assert.ok(
          elapsed < EXIT_BOUND_MS,
          `iteration ${i}: daemon took ${elapsed}ms to exit (bound ${EXIT_BOUND_MS}ms)`,
        );
        assert.ok(!existsSync(join(sDir, "daemon.pid")), "daemon.pid not removed on disconnect");
        assert.ok(
          !existsSync(join(sDir, "daemon.ready")),
          "daemon.ready not removed on disconnect",
        );
      } finally {
        await killAndReap(child);
        if (server) {
          try {
            await server.stop();
          } catch {}
        }
      }
    }
  },
);
