import test, { after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freshSessionsRoot, removeRoot, backage } from "./helpers/env.mjs";

// R2 F-009/15/18/21 + F-067-4/13b/14: sweep host-pass stale-state recovery
// (marker-only + corrupt-state reaping, port-pool leak), atomic port-lock
// capture (breakStaleLock/releasePortLock), process-identity-verified daemon
// signaling, per-line sid revalidation, the redundant releasePorts gate kill,
// and atomic recorder.json flips. No Docker required.

const root = await freshSessionsRoot("csm-browse-sweep-ports-");
const { sweep } = await import("../../lib/sweep.mjs");
const { releasePorts, stopDaemon } = await import("../../lib/cleanup.mjs");
const { releasePortLock, breakStaleLock, claimedPortSet } = await import("../../lib/ports.mjs");
const { setExecLayerForTests } = await import("./helpers/exec-layer.mjs");

const LOCK = join(root, ".ports.lock");
const SID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

after(async () => {
  setExecLayerForTests();
  await removeRoot(root);
});

// ---- shared exec-layer stubs (mutated per test; tests run sequentially) ----
const cfg = { pgrepHost: {} };

function installStubs() {
  cfg.pgrepHost = {};
  setExecLayerForTests({
    execFile: async (cmd, args) => {
      if (cmd === "pgrep") return { stdout: cfg.pgrepHost[args[1]] ?? "" };
      return { stdout: "" };
    },
    hostPgrep: async () => [],
    killPid: () => {},
    pgrepMatch: async () => [],
    pkillMatch: async () => {},
    execInContainer: async (container, args) => {
      if (args[0] === "test") throw new Error("exit 1");
      return "";
    },
  });
}

const sweepOpts = { containerName: "chromium-vnc", ip: "172.17.0.1", ageMinutes: 10 };

// ---- F-009 / F-015: marker-only + corrupt-state session reaping -----------

test("F-009/F-015 a marker-only dir with an aged marker is reaped despite a young dir", async () => {
  installStubs();
  const sid = "mark-aged";
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  const markerPath = join(dir, "creating.marker");
  await writeFile(markerPath, JSON.stringify({ internal: 9224, public: 9225 }));
  await backage(markerPath, 30 * 60 * 1000); // past CREATING_MARKER_MAX_MS; dir stays fresh
  const result = await sweep(sweepOpts);
  assert.ok(
    result.swept.some((e) => e.startsWith(`sid=${sid}`)),
    `marker-only dir not reaped: ${result.swept}`,
  );
  assert.ok(!existsSync(dir), "marker-only dir must be removed (marker freed)");
});

test("F-009/F-015 a fresh creating.marker still protects a marker-only dir", async () => {
  installStubs();
  const sid = "mark-fresh";
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "creating.marker"), JSON.stringify({ internal: 9224, public: 9225 }));
  const result = await sweep(sweepOpts);
  assert.ok(!result.swept.some((e) => e.includes(sid)), `fresh-marker dir swept: ${result.swept}`);
  assert.ok(existsSync(dir));
  await rm(dir, { recursive: true, force: true });
});

test("F-009 reaping a marker-only dir frees its claimed port pair", async () => {
  installStubs();
  const sid = "mark-pool";
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  const markerPath = join(dir, "creating.marker");
  await writeFile(markerPath, JSON.stringify({ internal: 9224, public: 9225 }));
  // The stale marker claims the pair from the pool before the reap.
  const claimedBefore = await claimedPortSet();
  assert.ok(
    claimedBefore.has(9224) && claimedBefore.has(9225),
    `pair must be claimed before reap: ${[...claimedBefore]}`,
  );
  await backage(markerPath, 30 * 60 * 1000);
  await sweep(sweepOpts);
  assert.ok(!existsSync(dir), "marker-only dir must be removed before the pool check");
  // Removing the dir removes the marker: claimedPortSet no longer reserves the
  // pair, so the pool can hand it out again (no host-port binds needed).
  const claimedAfter = await claimedPortSet();
  assert.ok(
    !claimedAfter.has(9224) && !claimedAfter.has(9225),
    `pair must be freed after reap: ${[...claimedAfter]}`,
  );
});

test("F-009 a corrupt (unparseable) state.json is swept by the age gate", async () => {
  installStubs();
  const sid = "corrupt";
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "state.json"), "{not json");
  await backage(dir, 30 * 60 * 1000);
  await backage(join(dir, "state.json"), 30 * 60 * 1000);
  const result = await sweep(sweepOpts);
  assert.ok(
    result.swept.some((e) => e.startsWith(`sid=${sid}`)),
    `corrupt-state dir not reaped: ${result.swept}`,
  );
  assert.ok(!existsSync(dir), "corrupt-state dir must be removed");
});

// ---- F-018 / F-067-15: atomic port-lock handling ---------------------------

test("F-018 breakStaleLock atomically removes a stale dead-holder lock", async () => {
  await writeFile(LOCK, "424242", "utf-8");
  await backage(LOCK, 6000);
  await breakStaleLock();
  assert.ok(!existsSync(LOCK), "stale lock should be removed");
});

test("F-018 breakStaleLock never touches a live holder lock", async () => {
  await writeFile(LOCK, String(process.pid), "utf-8");
  await backage(LOCK, 60000);
  await breakStaleLock();
  assert.ok(existsSync(LOCK), "live holder lock must survive");
  assert.equal(await readFile(LOCK, "utf-8"), String(process.pid));
  await rm(LOCK, { force: true });
});

test("F-018 breakStaleLock restores a lock a fresh holder slipped in (atomic capture)", async () => {
  const orig = process.kill.bind(process);
  // pid 424242 is dead; the kill() probe simulates a fresh holder rewriting
  // the lock between breakStaleLock's inspection and its capture.
  process.kill = (pid, sig) => {
    if (pid === 424242) {
      writeFileSync(LOCK, "777777");
      const e = new Error("ESRCH");
      e.code = "ESRCH";
      throw e;
    }
    return orig(pid, sig);
  };
  try {
    await writeFile(LOCK, "424242", "utf-8");
    await backage(LOCK, 6000);
    await breakStaleLock();
    assert.ok(existsSync(LOCK), "a lock replaced by a fresh holder must survive");
    assert.equal(await readFile(LOCK, "utf-8"), "777777");
  } finally {
    process.kill = orig;
  }
  await rm(LOCK, { force: true });
});

test("F-067-15 releasePortLock never unlinks a foreign lock", async () => {
  await writeFile(LOCK, "424242", "utf-8");
  await releasePortLock();
  assert.ok(existsSync(LOCK), "a lock we did not create must not be removed");
  assert.equal(await readFile(LOCK, "utf-8"), "424242");
  await rm(LOCK, { force: true });
});

test("F-067-15 releasePortLock removes our own lock", async () => {
  await writeFile(LOCK, String(process.pid), "utf-8");
  await releasePortLock();
  assert.ok(!existsSync(LOCK), "our own lock must be released");
});

// ---- F-021: process-identity-verified daemon signaling --------------------

function spawnDaemonish(sid) {
  const args = ["-e", "setInterval(() => {}, 1000);"];
  if (sid) args.push("session-daemon.mjs", "--session", sid);
  return spawn(process.execPath, args, { stdio: "ignore" });
}

async function waitForProc(child) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await readFile(`/proc/${child.pid}/cmdline`, "utf-8");
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`child ${child.pid} never gained a /proc entry`);
}

function childAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child, ms) {
  return new Promise((resolve) => {
    // A signal-killed child reports exitCode null with a signalCode — treat
    // either as exited (the 'exit' event may already have fired).
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    child.on("exit", () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

test("F-021 stopDaemon refuses to signal a pid that is not THIS session daemon", async () => {
  const child = spawnDaemonish(null); // plain node: argv has no session-daemon
  await waitForProc(child);
  const dir = join(root, "f21-foreign");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "daemon.pid"), `${child.pid}\n`, "utf-8");
  try {
    assert.equal(await stopDaemon(dir, "sess-other"), false, "a foreign pid must not be signaled");
    assert.ok(childAlive(child.pid), "the unrelated process must survive");
  } finally {
    child.kill("SIGKILL");
    await waitForExit(child, 3000);
    await rm(dir, { recursive: true, force: true });
  }
});

test("F-021 stopDaemon signals a pid whose argv is THIS session daemon", async () => {
  const sid = "f21-real";
  const child = spawnDaemonish(sid); // argv: ... session-daemon.mjs --session f21-real
  await waitForProc(child);
  const dir = join(root, "f21-real");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "daemon.pid"), `${child.pid}\n`, "utf-8");
  try {
    assert.equal(await stopDaemon(dir, sid), true, "matching daemon should be stopped");
    assert.ok(await waitForExit(child, 5000), "matching daemon must be terminated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F-021 sweep orphan-daemon pass kills only pids whose argv is the session daemon", async () => {
  installStubs();
  const matched = spawnDaemonish("orph-m");
  const foreign = spawnDaemonish(null);
  await waitForProc(matched);
  await waitForProc(foreign);
  cfg.pgrepHost["session-daemon.mjs --session "] = [
    `${matched.pid} /usr/bin/node session-daemon.mjs --session orph-m`,
    `${foreign.pid} /usr/bin/node session-daemon.mjs --session orph-f`,
  ].join("\n");
  try {
    const result = await sweep(sweepOpts);
    assert.ok(
      result.swept.includes(`orphan daemon sid=orph-m pid=${matched.pid}`),
      `matching orphan not recorded: ${result.swept}`,
    );
    assert.ok(await waitForExit(matched, 5000), "matching orphan daemon must be killed");
    assert.ok(childAlive(foreign.pid), "a foreign pid must never be signaled by sweep");
  } finally {
    foreign.kill("SIGKILL");
    await waitForExit(foreign, 3000);
  }
});

// ---- F-067-4: per-line sid revalidation ------------------------------------

test("F-067-4 one malformed pgrep line does not abort the orphan-daemon pass", async () => {
  installStubs();
  cfg.pgrepHost["session-daemon.mjs --session "] = [
    "90001 /usr/bin/node session-daemon.mjs --session ../bad",
    `90002 /usr/bin/node session-daemon.mjs --session orph-ok`,
  ].join("\n");
  assert.ok(!SID_RE.test("../bad")); // sanity: ../bad is not a valid sid shape
  const result = await sweep(sweepOpts);
  assert.ok(
    result.swept.includes("orphan daemon sid=orph-ok pid=90002"),
    `valid orphan lost after a malformed line: ${result.swept}`,
  );
});

// ---- F-067-13b: releasePorts no longer double-kills the gate ---------------

test("F-067-13b releasePorts does not re-kill the gate, still releases the instance", async () => {
  const calls = [];
  setExecLayerForTests({
    hostPgrep: async () => {
      calls.push(["hostPgrep"]);
      return [
        {
          pid: 111,
          cmd: "node /x/cdp-gate.mjs --sid s1 --port 9224 --internal 9223 --container chromium-vnc",
        },
      ];
    },
    killPid: (pid) => calls.push(["killPid", pid]),
    pkillMatch: async (c, p) => calls.push(["pkillMatch", c, p]),
  });
  try {
    await releasePorts({
      sid: "abc123",
      publicPort: 9224,
      profileDir: "/config/csm-browse/sessions/abc123",
      container: { name: "chromium-vnc" },
    });
    assert.ok(
      !calls.some((c) => c[0] === "killPid"),
      `gate must not be re-killed: ${JSON.stringify(calls)}`,
    );
    assert.ok(!calls.some((c) => c[0] === "hostPgrep"), "releasePorts must not scan for gates");
    assert.ok(
      calls.some((c) => c[0] === "pkillMatch"),
      `instance must still be released: ${JSON.stringify(calls)}`,
    );
  } finally {
    setExecLayerForTests();
  }
});

// ---- F-067-14: atomic recorder.json flip -----------------------------------

test("F-067-14 stale recorder lock flip is atomic (temp+rename, no residue)", async () => {
  installStubs();
  const sid = "rec-atomic";
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "recorder.json"), JSON.stringify({ running: true, name: "x.webm" }));
  const result = await sweep(sweepOpts);
  assert.ok(
    result.swept.includes("stale recorder lock sid=rec-atomic"),
    `not flipped: ${result.swept}`,
  );
  assert.ok(!existsSync(join(dir, "recorder.json.tmp")), "temp file must be cleaned up");
  const rec = JSON.parse(await readFile(join(dir, "recorder.json"), "utf-8"));
  assert.equal(rec.running, false);
});
