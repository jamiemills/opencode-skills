import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { waitForExitAndClearMarkers } = await import("../../scripts/ensure-browser.mjs");

function exited(child) {
  return new Promise((resolve) => child.on("exit", resolve));
}

// F5-02 race pin: the retry teardown must wait for the SIGTERM'd child's
// actual exit before touching the launch markers. The old fixed 20x100ms poll
// gave up at ~2s while the child's worst-case cleanup is ~8s, so a slow child
// had its daemon.pid/daemon.ready deleted from under it and attempt #2 spawned
// a transient second daemon. The fake child here exits at 2.3s — past the old
// bound, inside the new one — and records whether the markers were still
// present at the moment it exited.
test("retry teardown waits for a slow-exit child before deleting markers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-retry-slow-"));
  const pidFile = join(dir, "daemon.pid");
  const readyMarker = join(dir, "daemon.ready");
  const observed = join(dir, "observed");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on("SIGTERM", async () => {
        await new Promise((r) => setTimeout(r, 2300));
        const fs = require("node:fs");
        const present =
          fs.existsSync(${JSON.stringify(pidFile)}) && fs.existsSync(${JSON.stringify(readyMarker)});
        fs.writeFileSync(${JSON.stringify(observed)}, present ? "present" : "gone");
        process.exit(0);
      });
      setInterval(() => {}, 60000);`,
    ],
    { stdio: "ignore" },
  );
  const exitDone = exited(child);
  const childPid = child.pid;
  await writeFile(pidFile, String(childPid));
  await writeFile(readyMarker, "");
  // Let the child install its SIGTERM handler before signaling.
  await new Promise((r) => setTimeout(r, 200));

  const t0 = Date.now();
  process.kill(childPid, "SIGTERM");
  const cleared = await waitForExitAndClearMarkers(childPid, pidFile, readyMarker);
  const elapsed = Date.now() - t0;

  assert.equal(cleared, true, "markers should be cleared once the child owns them and exits");
  assert.ok(elapsed >= 2000, `must outlast the old 2s fixed poll (waited ${elapsed}ms)`);
  assert.equal(
    await readFile(observed, "utf-8"),
    "present",
    "markers must survive until the child actually exits",
  );
  await assert.rejects(readFile(pidFile));
  await assert.rejects(readFile(readyMarker));
  await exitDone;
  await rm(dir, { recursive: true, force: true });
});

// F5-02 ownership pin: if another writer replaced the pid file content after
// our child terminated, the markers belong to that foreign claim and must be
// left untouched — attempt #2's O_EXCL claim enforces single-instance.
test("retry teardown skips deletion when the pid file is owned by another writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-retry-foreign-"));
  const pidFile = join(dir, "daemon.pid");
  const readyMarker = join(dir, "daemon.ready");
  const child = spawn(process.execPath, ["-e", "process.exit(0);"], { stdio: "ignore" });
  const childPid = child.pid;
  await exited(child);
  const FOREIGN_PID = "424242";
  await writeFile(pidFile, FOREIGN_PID);
  await writeFile(readyMarker, "");

  const cleared = await waitForExitAndClearMarkers(childPid, pidFile, readyMarker, { pollMs: 10 });

  assert.equal(cleared, false, "foreign-owned markers must not be cleared");
  assert.equal((await readFile(pidFile, "utf-8")).trim(), FOREIGN_PID);
  await readFile(readyMarker, "utf-8");
  await rm(dir, { recursive: true, force: true });
});

// The wait is bounded: a child that never exits cannot hang the retry loop.
test("retry teardown stops waiting at the bound instead of hanging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-retry-bound-"));
  const pidFile = join(dir, "daemon.pid");
  const readyMarker = join(dir, "daemon.ready");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
    stdio: "ignore",
  });
  const exitDone = exited(child);
  const childPid = child.pid;
  await writeFile(pidFile, String(childPid));
  await writeFile(readyMarker, "");

  const t0 = Date.now();
  const cleared = await waitForExitAndClearMarkers(childPid, pidFile, readyMarker, {
    exitWaitMs: 300,
    pollMs: 50,
  });
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 3000, `bounded wait must return promptly (took ${elapsed}ms)`);
  // A live child still owns the claim at the bound. Do not delete markers
  // under it; the next attempt must not race a still-running daemon.
  assert.equal(cleared, false);
  await readFile(pidFile, "utf-8");
  await readFile(readyMarker, "utf-8");
  child.kill("SIGKILL");
  await exitDone;
  await rm(dir, { recursive: true, force: true });
});
