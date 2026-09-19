import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";
import { startFakeCdp } from "./helpers/fake-cdp-server.mjs";
import { killAndReap, waitExit, waitForReady } from "./helpers/proc.mjs";
import { generateToken, withToken } from "../../lib/session.mjs";

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // csm-browse/
const root = await freshSessionsRoot("csm-browse-daemon-");

after(async () => {
  await removeRoot(root);
});

function spawnDaemon(sid) {
  return spawn(process.execPath, ["scripts/session-daemon.mjs", "--session", sid], {
    cwd: SKILL_DIR,
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function spawnSlowDaemon() {
  return spawn(process.execPath, [join(SKILL_DIR, "tests", "unit", "helpers", "slow-daemon.mjs")], {
    cwd: SKILL_DIR,
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function collectStderr(child) {
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d;
  });
  return () => stderr;
}

function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

// Single teardown point for every test body: stop the fake CDP server (if any)
// and SIGKILL+reap the child (if any). Runs on success and failure alike so no
// test can leak a server handle or a live daemon.
async function cleanup({ child = null, server = null } = {}) {
  if (server) {
    try {
      await server.stop();
    } catch {}
  }
  if (child) {
    try {
      await killAndReap(child);
    } catch {}
  }
}

test(
  "daemon writes pid+ready markers, then removes them on CDP disconnect",
  { timeout: 30000 },
  async () => {
    const sid = "dm-a";
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
      const stderr = collectStderr(child);

      await waitForReady(join(sDir, "daemon.ready"), child, { timeoutMs: 15000, stderr });
      assert.equal(
        (await readFile(join(sDir, "daemon.pid"), "utf-8")).trim(),
        String(child.pid),
        "wx pid claim wrong",
      );
      assert.ok(existsSync(join(sDir, "daemon.log")), "daemon.log missing");

      server.closeAll(); // chromium "gone": CDP connection lost
      const code = await waitExit(child, 15000);
      assert.equal(code, 0, `daemon exit code ${code} (${stderr()})`);
      assert.ok(!existsSync(join(sDir, "daemon.pid")), "daemon.pid not removed on disconnect");
      assert.ok(!existsSync(join(sDir, "daemon.ready")), "daemon.ready not removed on disconnect");
      assert.ok(
        existsSync(join(sDir, "cmd")) && existsSync(join(sDir, "cmd", "out")),
        "queue dirs must survive",
      );
    } finally {
      await cleanup({ child, server });
    }
  },
);

test("daemon.log never contains the wsUrl token", { timeout: 30000 }, async () => {
  const sid = "dm-tok";
  const token = generateToken();
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });

  let server = null;
  let child = null;
  try {
    server = await startFakeCdp({
      token,
      responses: {
        "Target.getTargets": () => ({
          targetInfos: [{ type: "page", targetId: "t1", url: "about:blank" }],
        }),
        "Target.attachToTarget": () => ({ sessionId: "TAB1" }),
      },
    });
    const wsUrl = withToken(server.url, token);
    await writeFile(
      join(sDir, "state.json"),
      JSON.stringify({ wsUrl, internalPort: 9224, publicPort: 9225 }),
    );

    child = spawnDaemon(sid);
    const stderr = collectStderr(child);

    await waitForReady(join(sDir, "daemon.ready"), child, { timeoutMs: 15000, stderr });

    const log = await readFile(join(sDir, "daemon.log"), "utf-8");
    assert.ok(
      !log.includes(token),
      `daemon.log leaked the token: ${log.split("\n").slice(0, 2).join(" | ")}`,
    );
    assert.match(
      log,
      /Connecting to ws:\/\/127\.0\.0\.1:\d+\/devtools\/page\/fake-target-1\?token=\[REDACTED\]/,
      `token must be redacted before interpolation: ${log.split("\n").slice(0, 2).join(" | ")}`,
    );
    for (const line of log.split("\n")) {
      if (line.trim()) {
        assert.match(
          line,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /,
          `every daemon.log line must carry its own ISO timestamp (per-line, not per-write): ${line}`,
        );
      }
    }

    server.closeAll();
    const code = await waitExit(child, 15000);
    assert.equal(code, 0, `daemon exit code ${code} (${stderr()})`);
  } finally {
    await cleanup({ child, server });
    await rm(sDir, { recursive: true, force: true });
  }
});

test(
  "a second daemon refuses to start while the pid-file holder is alive",
  { timeout: 20000 },
  async () => {
    const sid = "dm-b";
    const sDir = join(root, sid);
    await mkdir(sDir, { recursive: true });
    await writeFile(join(sDir, "daemon.pid"), String(process.pid)); // alive: this test process

    let child = null;
    try {
      child = spawnDaemon(sid);
      const stderr = collectStderr(child);
      const code = await waitExit(child, 15000);
      assert.equal(code, 2, `expected refusal exit 2, got ${code} (${stderr()})`);
      assert.ok(!existsSync(join(sDir, "daemon.ready")), "ready marker must not exist");
      assert.equal(
        (await readFile(join(sDir, "daemon.pid"), "utf-8")).trim(),
        String(process.pid),
        "foreign pid claim must be untouched",
      );
    } finally {
      await cleanup({ child });
    }
  },
);

test(
  "queue: ts-ordered claims, malformed cmd -> error out-file, stale running/ unblocked",
  { timeout: 30000 },
  async () => {
    const sid = "dm-q";
    const sDir = join(root, sid);
    await mkdir(sDir, { recursive: true });
    const resultFile = join(sDir, "queue-result.json");

    let child = null;
    try {
      child = spawn(
        process.execPath,
        [join(SKILL_DIR, "tests", "unit", "helpers", "queue-runner.mjs"), sDir, resultFile],
        {
          env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      const stderr = collectStderr(child);

      const code = await waitExit(child, 25000);
      assert.equal(code, 0, `queue-runner failed: ${code} (${stderr()})`);
      const r = JSON.parse(await readFile(resultFile, "utf-8"));

      // filename order is SECOND,FIRST; ts order must win (observed via the
      // out-file rename order recorded by the queue-runner's fs.watch)
      assert.deepEqual(r.processedOrder, [r.first, r.second]);
      assert.equal(r.firstOut.ok, false);
      assert.equal(r.firstOut.error, "not recording");
      assert.equal(r.secondOut.ok, false);
      assert.equal(r.secondOut.error, "not recording");
      assert.equal(r.brokenOut.ok, false);
      assert.equal(r.brokenOut.error, "malformed command file");
      assert.equal(r.staleOut.ok, false);
      assert.equal(r.staleOut.error, "daemon restarted while command was running");
      assert.equal(r.cmdJsonLeft, 0, "unconsumed cmd .json files must not remain");
      assert.equal(r.runningLeft, 0, "running/ claims must be drained");
      assert.ok(r.dirsSurvive, "cmd/running + cmd/out must never be wiped");
    } finally {
      await cleanup({ child });
    }
  },
);

// Harness self-test: a daemon that never becomes ready must make the bounded
// readiness wait fail fast, with the child SIGKILLed and reaped by the harness
// itself. If this regressed, the leaked stub (which ignores SIGTERM) would keep
// the runner's event loop alive and the whole suite would hang.
test(
  "slow daemon stub: bounded readiness wait fails fast and reaps the child",
  { timeout: 10000 },
  async () => {
    const sDir = join(root, "dm-slow");
    const readyPath = join(sDir, "daemon.ready");

    let child = null;
    try {
      child = spawnSlowDaemon();
      const stderr = collectStderr(child);

      const start = Date.now();
      let error = null;
      try {
        await waitForReady(readyPath, child, { timeoutMs: 750, intervalMs: 25, stderr });
      } catch (e) {
        error = e;
      }
      const elapsed = Date.now() - start;

      assert.ok(error, "readiness wait must fail on a non-exiting daemon");
      assert.match(error.message, /daemon\.ready never appeared/);
      assert.ok(elapsed < 5000, `harness must fail fast (took ${elapsed}ms)`);
      assert.ok(
        child.signalCode === "SIGKILL" || child.exitCode !== null,
        "readiness bound must kill and reap the daemon",
      );
      assert.equal(isAlive(child), false, "no live child may survive the readiness bound");
    } finally {
      await cleanup({ child });
    }
  },
);
