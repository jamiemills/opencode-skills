#!/usr/bin/env node
import { readFile, rename, rm, open, utimes } from "node:fs/promises";
import { constants as fsConstants, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import {
  clearCreatorArtifact,
  holderIdentityMatches,
  writeCreatorArtifact,
} from "../lib/pid-identity.mjs";
import { setTimeout } from "node:timers/promises";
import { loadState, sessionDir } from "../lib/session.mjs";
import {
  connectDaemon,
  ensureSingleTab,
  startQueueLoop,
  prepareQueueDirs,
} from "../lib/daemon-core.mjs";
import { redactTelemetry, redactUrl, secureAppend, secureWrite } from "../lib/security.mjs";
import { createLineWriter } from "../lib/daemon-log.mjs";

const args = process.argv.slice(2);
let sid = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session" && i + 1 < args.length) sid = args[++i];
}

if (!sid) {
  console.error("Usage: node scripts/session-daemon.mjs --session <sid>");
  process.exit(1);
}

const sDir = sessionDir(sid);

const withTimeout = (promise, ms, label) => {
  let timer = null;
  const bound = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    // Never let a timeout bound itself keep the daemon alive: the daemon must
    // only stay alive while it is genuinely connected.
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, bound]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
};

const pidFile = join(sDir, "daemon.pid");
const readyMarker = join(sDir, "daemon.ready");

// F-065-c: claimPidFile must not retry forever under pathological FS state —
// after CLAIM_DEADLINE_MS the daemon gives up with a clear error.
const CLAIM_DEADLINE_MS = 10000;
// Inode of the pid file WE created (F-019): cleanup verifies ownership via
// this before removing the claim so a recycled/replaced file is never deleted.
let claimInode = null;

// Break a dead holder's claim atomically: rename the stale file aside, then
// inspect the renamed artifact. If the content no longer matches what we read,
// a fresh holder's claim was moved — restore it. This closes the read-then-
// unlink TOCTOU where two spawns both read a dead pid file and the second
// unlink destroys the first's fresh O_EXCL claim (F-019).
async function breakStaleClaim(raw) {
  const trash = pidFile + ".stale";
  try {
    await rename(pidFile, trash);
  } catch {
    return;
  }
  try {
    const now = await readFile(trash, "utf-8");
    if (now !== raw) {
      // Do not replace a claim that arrived after the stale file was moved.
      // Restore only when the pathname is still vacant.
      try {
        const replacement = await open(
          pidFile,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        );
        try {
          await replacement.writeFile(now);
        } finally {
          await replacement.close();
        }
        await rm(trash, { force: true });
      } catch {
        await rm(trash, { force: true });
      }
      return;
    }
    await rm(trash, { force: true });
  } catch {}
}

// Atomic single-instance claim BEFORE connecting to CDP: open(pidFile, 'wx')
// closes the multi-second check-then-act window in which two spawns could
// both proceed. Stale locks (dead pid) are broken atomically via
// breakStaleClaim. The ready marker keeps its original position (written
// after CDP connect + queue dirs are ready).
async function claimPidFile() {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > CLAIM_DEADLINE_MS) {
      console.error(`Could not claim daemon pid file within ${CLAIM_DEADLINE_MS}ms: ${pidFile}`);
      process.exit(1);
    }
    try {
      const fh = await open(
        pidFile,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        await fh.chmod(0o600);
        await fh.writeFile(String(process.pid));
        const info = await fh.stat();
        claimInode = info.ino;
      } finally {
        await fh.close();
      }
      try {
        await writeCreatorArtifact(pidFile);
      } catch {}
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    let raw = null;
    try {
      const fh = await open(pidFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        const info = await fh.stat();
        if (!info.isFile() || info.uid !== process.getuid())
          throw new Error(`Unsafe daemon pid file: ${pidFile}`);
        await fh.chmod(0o600);
        raw = await fh.readFile("utf-8");
      } finally {
        await fh.close();
      }
    } catch (err) {
      if (err.code === "ELOOP")
        throw new Error(`Refusing symlink daemon pid file: ${pidFile}`, { cause: err });
      if (err.code !== "ENOENT") throw err;
    }
    if (raw !== null) {
      const existingPid = parseInt(raw.trim(), 10);
      let alive = false;
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0);
          // F-012: a recycled PID must not block startup — verify the
          // holder's /proc starttime against the claim's creator sidecar.
          alive = await holderIdentityMatches(pidFile, existingPid);
        } catch {}
      }
      if (alive) {
        console.error(`Daemon already running (pid ${existingPid})`);
        process.exit(2);
      }
      await breakStaleClaim(raw);
    }
    await setTimeout(100);
  }
}

// True only while the pid file at the path is the exact inode this daemon
// created. Used before any `rm(pidFile)` so a claim replaced by another
// process is never deleted by us (F-019 ownership verification).
async function ownPidFile() {
  try {
    const fh = await open(pidFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await fh.stat();
      return info.ino === claimInode;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

async function removeOwnPidFile() {
  if (await ownPidFile()) {
    try {
      await rm(pidFile);
    } catch {}
    await clearCreatorArtifact(pidFile);
  }
}

await claimPidFile();
// We own the session now: drop any ready marker left by a previous daemon so
// launchDaemon's wait loop can only ever adopt a marker written by us.
try {
  await rm(readyMarker, { force: true });
} catch {}

const logPath = join(sDir, "daemon.log");
// F-074: append ('a') so a previous run's failure evidence survives restarts.
// Per-LINE ISO timestamps (not per write-call) so ordering across restarts is
// diagnosable and multi-line/split writes each get exactly one stamp. A line-
// buffered transform accumulates chunk bytes and stamps complete lines; the
// trailing partial line is flushed synchronously on process exit so no bytes
// are lost. Appends are serialized through a promise chain so stamped lines
// land in the log in the order they were written.
await secureAppend(logPath, "");
let appendQueue = Promise.resolve();
const lineWriter = createLineWriter({
  write: (line) => {
    appendQueue = appendQueue.then(() => secureAppend(logPath, line)).catch(() => {});
  },
  transform: (text) => `${new Date().toISOString()} ${redactTelemetry(text)}`,
});
const stampWrite = (chunk, encoding, cb) => {
  lineWriter.append(chunk);
  if (typeof encoding === "function") encoding();
  else if (typeof cb === "function") cb();
  return true;
};
process.stdout.write = stampWrite;
process.stderr.write = stampWrite;
// process.exit() bypasses the event loop, so an async secureAppend cannot
// flush a trailing partial line; write it synchronously (the file was already
// created + validated by secureAppend above).
process.on("exit", () => {
  const tail = lineWriter.flush();
  if (!tail) return;
  try {
    const fd = openSync(logPath, "a");
    try {
      writeSync(fd, tail);
    } finally {
      closeSync(fd);
    }
  } catch {}
});

const state = await loadState(sid);
if (!state || !state.wsUrl) {
  console.error("No session state found or wsUrl missing");
  process.exit(1);
}

// Redact BEFORE interpolation: redactTelemetry cannot parse a URL embedded in
// prose, so the wsUrl value itself must be scrubbed first.
console.log(`Connecting to ${redactUrl(state.wsUrl)}...`);
let client = null;
let tabSessionId;
let collectorsHandle = null;
let touchReady = null;
let shuttingDown = false;

// chrome-remote-interface exposes the underlying WebSocket as `_ws`; guard
// the private access so a future CRI shape that hides it simply disables the
// fallback (the primary 'disconnect' event still applies). WebSocket.CLOSED=3.
function cdpSocketClosed(c) {
  const ws = c && c["_ws"]; // eslint-disable-line no-underscore-dangle
  return !!ws && typeof ws.readyState === "number" && ws.readyState === 3;
}

// Idempotent, bounded shutdown. `reason` is logged so operators can tell a
// CDP disconnect from a signal from the liveness fallback. Once entered it
// owns the exit: the main flow's catch must not race it to exit(1).
const cleanup = async (reason) => {
  if (shuttingDown) return;
  shuttingDown = true;

  if (touchReady) globalThis.clearInterval(touchReady);

  // F-067-12: the force-exit timer is armed AFTER the recorder finalize, not
  // before — a timer started at cleanup entry could truncate an in-flight
  // finalize/result write mid-secureWrite. It is unref'd so it can never be
  // the handle that keeps the daemon alive; the explicit process.exit below
  // is what guarantees the bound.
  let forceExitTimer = null;

  try {
    const recorder = await import("../lib/recorder.mjs");
    if (recorder.stopRecorder) {
      console.log("Finalizing recorder...");
      await withTimeout(
        recorder.stopRecorder(client, tabSessionId, sDir),
        12000,
        "Recorder finalize",
      );
    }
  } catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND" && e.message !== "not recording") {
      console.error(`Recorder finalize error: ${e.message}`);
    }
  }

  // F-015: surface telemetry-write accounting before shutdown so a
  // "capture gap" diagnosis can distinguish a dead daemon from silent
  // write failures during the session.
  if (collectorsHandle?.stats) {
    const stats = collectorsHandle.stats();
    if (stats.droppedWrites > 0 || stats.droppedRotations > 0) {
      console.log(
        `Collectors dropped: writes=${stats.droppedWrites} rotations=${stats.droppedRotations}`,
      );
    }
  }

  if (client) {
    try {
      await withTimeout(client.close(), 2000, "CDP close");
    } catch {}
  }

  // Only the marker-removal steps remain (fast); a wedged rm must not hold
  // the pid+ready markers forever, so backstop them with a hard bound.
  forceExitTimer = globalThis.setTimeout(() => {
    console.error(`Cleanup timed out, force exiting (${reason})`);
    try {
      process.exit(0);
    } catch {}
  }, 3000);
  if (forceExitTimer.unref) forceExitTimer.unref();

  try {
    await removeOwnPidFile();
  } catch {}
  try {
    await rm(readyMarker);
  } catch {}

  if (forceExitTimer) globalThis.clearTimeout(forceExitTimer);
  console.log(`Daemon exiting: ${reason}`);
  process.exit(0);
};

const onSignal = (sig) => {
  console.log(`Received ${sig}`);
  cleanup(`signal ${sig}`);
};

try {
  client = await connectDaemon(state.wsUrl);
  console.log("CDP connected");

  // Attach immediately — BEFORE the ready marker is written and before any
  // further await — so a disconnect during the startup window cannot be
  // missed. CRI emits 'disconnect' exactly once from the underlying ws
  // 'close'; a handler registered later loses the event and leaves a zombie
  // polling a dead client (the source of the intermittent non-exit).
  client.on("disconnect", () => {
    console.log("CDP connection lost — shutting down");
    cleanup("CDP disconnect");
  });
  // CRI never surfaces ws errors as a client 'error' event (they reject the
  // connect promise), but keep a handler so any future emit cannot throw an
  // unhandled 'error' and so an error path still shuts down deterministically.
  client.on("error", (err) => {
    console.error(`CDP client error: ${err && err.message ? err.message : err}`);
    cleanup("CDP error");
  });

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  tabSessionId = await ensureSingleTab(client);
  console.log(`Tab attached, sessionId: ${tabSessionId}`);

  try {
    const collectors = await import("../lib/collectors.mjs");
    if (collectors.collectorsHook) {
      collectorsHandle = await collectors.collectorsHook(client, tabSessionId, sDir);
      console.log("Collectors enabled");
    }
  } catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
    console.log("Collectors not available");
  }

  await prepareQueueDirs(sDir);
  await secureWrite(readyMarker, String(process.pid), { encoding: "utf-8" });

  try {
    const recorder = await import("../lib/recorder.mjs");
    if (recorder.reconcileRecorder && (await recorder.reconcileRecorder(sDir))) {
      console.log("Recorder state reconciled: stale running flag reset");
    }
  } catch {}

  console.log(`Daemon ready (pid ${process.pid})`);

  // Keep the ready marker's mtime fresh while this daemon's event loop is
  // alive, so launchDaemon can distinguish a live daemon from a stale-but-
  // alive zombie (whose loop has stopped touching the marker). The same
  // unref'd tick backstops a missed close event: if the underlying CDP socket
  // is already CLOSED, shut down instead of polling forever.
  touchReady = globalThis.setInterval(() => {
    utimes(readyMarker, new Date(), new Date()).catch(() => {});
    if (!shuttingDown && cdpSocketClosed(client)) {
      console.log("CDP socket closed — shutting down");
      cleanup("CDP socket closed (liveness check)");
    }
  }, 2000);
  if (touchReady.unref) touchReady.unref();

  await startQueueLoop(client, tabSessionId, sDir);
} catch (err) {
  if (!shuttingDown) {
    console.error(`Daemon error: ${err.message}`);
    try {
      await removeOwnPidFile();
    } catch {}
    try {
      await rm(readyMarker);
    } catch {}
    if (client) {
      try {
        await withTimeout(client.close(), 2000, "CDP close").catch(() => {});
      } catch {}
    }
    process.exit(1);
  }
  // shuttingDown: cleanup() owns the exit path — do not race it with exit(1).
}
