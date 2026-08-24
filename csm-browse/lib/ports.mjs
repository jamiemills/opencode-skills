import { execLayer } from "./docker.mjs";
import { open, rename, unlink, readFile, stat, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createServer as netServer } from "node:net";
import {
  CDP_RETRY_TIMEOUT_MS,
  SESSIONS_ROOT,
  PORT_POOL_START,
  PORT_POOL_END,
} from "./constants.mjs";
import { prepareRuntimeRoot, validateState } from "./security.mjs";
import {
  clearCreatorArtifact,
  holderIdentityMatches,
  writeCreatorArtifact,
} from "./pid-identity.mjs";

const LOCK_FILE = join(SESSIONS_ROOT, ".ports.lock");
const LOCK_STALE_MS = 5000;
// Must exceed the maximum time any creator holds the lock (allocation +
// chromium/gate launch). The 30s CDP readiness wait happens OUTSIDE the lock.
const LOCK_WAIT_MS = 35000;

export async function breakStaleLock() {
  try {
    const st = await stat(LOCK_FILE);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return;
    let raw;
    try {
      raw = await readFile(LOCK_FILE, "utf-8");
    } catch {
      return;
    }
    const pid = parseInt(raw.trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        // F-012: a live probe alone cannot distinguish the original holder
        // from a recycled PID. When a creator sidecar exists and its recorded
        // /proc starttime differs, the original holder is dead — break.
        if (await holderIdentityMatches(LOCK_FILE, pid)) return;
      } catch {} // holder dead — fall through to the atomic capture below
    }
    // F-018: atomic capture replaces read-then-unlink. The stale lock is
    // renamed to a unique tombstone in the same directory, so the inspect and
    // the removal operate on the exact artifact that was at the path — there
    // is no window in which a fresh holder's replacement lock can be
    // destroyed. If the captured artifact is NOT the stale one we inspected
    // (a live holder slipped its lock in first), it is restored in place,
    // never unlinked.
    const tombstone = `${LOCK_FILE}.stale-${process.pid}-${Date.now()}`;
    let captured;
    try {
      await rename(LOCK_FILE, tombstone);
    } catch {
      return; // ENOENT (already gone) or EACCES — nothing to break
    }
    try {
      captured = await readFile(tombstone, "utf-8");
    } catch {}
    if (captured !== raw) {
      // Restore the displaced artifact only if the lock pathname is vacant.
      // rename(old, path) would replace a fresh O_EXCL claim.
      try {
        const fh = await open(
          LOCK_FILE,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        );
        try {
          await fh.writeFile(captured ?? "");
        } finally {
          await fh.close();
        }
      } catch {}
      try {
        await unlink(tombstone);
      } catch {}
      return;
    }
    try {
      await unlink(tombstone);
    } catch {}
  } catch {}
}

export async function acquirePortLock() {
  await prepareRuntimeRoot(SESSIONS_ROOT);
  const start = Date.now();
  for (;;) {
    try {
      const fh = await open(
        LOCK_FILE,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        await fh.chmod(0o600);
        await fh.writeFile(String(process.pid));
      } finally {
        await fh.close();
      }
      // Tolerance mirrors claimPidFile: a failed sidecar write must not
      // strand a created lock with no owner identity for peers to break.
      try {
        await writeCreatorArtifact(LOCK_FILE);
      } catch {}
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    await breakStaleLock();
    if (Date.now() - start > LOCK_WAIT_MS) {
      throw new Error(`Timed out acquiring port allocation lock at ${LOCK_FILE}`);
    }
    await setTimeout(100);
  }
}

export async function releasePortLock() {
  // F-018/F-067-15: never unlink a lock we did not create. Only release when
  // the lock still holds OUR pid; a foreign holder's lock (or one that has
  // been stale-broken and re-claimed since) is left untouched. Safe as a
  // read-then-unlink here because breakStaleLock refuses to rename a live
  // holder's artifact (holder liveness is probed before capture).
  try {
    const raw = await readFile(LOCK_FILE, "utf-8");
    if (raw.trim() !== String(process.pid)) return;
    await unlink(LOCK_FILE);
    await clearCreatorArtifact(LOCK_FILE);
  } catch {}
}

// Ports already claimed by other sessions, recorded on disk under the port
// lock: state.json for live sessions, creating.marker for in-flight creations.
// The lock serializes claim writes, so this scan closes the window where a
// second creator allocates the same pair after the first released the lock
// but before chromium actually binds its debug port. Exported so tests can
// assert the F-009/F-015 claim-freed invariant without binding host ports.

const MARKER_REAP_GRACE_MS = CDP_RETRY_TIMEOUT_MS + 60000;

async function markerCreatorDead(markerPath, marker) {
  let mtime;
  try {
    const st = await stat(markerPath);
    mtime = st.mtimeMs;
  } catch {
    return false;
  }
  if (Date.now() - mtime < MARKER_REAP_GRACE_MS) return false;
  if (typeof marker.pid !== "number") return false;
  try {
    process.kill(marker.pid, 0);
    return false; // creator still alive
  } catch {
    return true; // creator provably dead past grace
  }
}

export async function claimedPortSet() {
  const claimed = new Set();
  let dirs;
  try {
    dirs = await readdir(SESSIONS_ROOT);
  } catch {
    return claimed;
  }
  for (const d of dirs) {
    if (d.startsWith(".")) continue;
    try {
      const state = JSON.parse(await readFile(join(SESSIONS_ROOT, d, "state.json"), "utf-8"));
      validateState(state);
      if (state && typeof state.internalPort === "number") claimed.add(state.internalPort);
      if (state && typeof state.publicPort === "number") claimed.add(state.publicPort);
    } catch {}
    try {
      const markerPath = join(SESSIONS_ROOT, d, "creating.marker");
      const marker = JSON.parse(await readFile(markerPath, "utf-8"));
      if (!marker) continue;
      // F-013: a marker-only dir from a CRASHED creator must not strand its
      // port pair until the next sweep. When the marker is older than the
      // creation grace window AND its recorded creator pid is provably dead,
      // treat the pair as free so allocate() can proceed.
      if (await markerCreatorDead(markerPath, marker)) continue;
      if (typeof marker.internal === "number") claimed.add(marker.internal);
      if (typeof marker.public === "number") claimed.add(marker.public);
    } catch {}
  }
  return claimed;
}

// Host-side liveness probe for a pool public port: the CDP gate listens on
// 127.0.0.1:<pub> on the HOST (container-side socat is gone), so availability
// is decided here, not inside the container.
function hostPortFree(port) {
  return new Promise((resolve) => {
    const srv = netServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

// Pre-T001 sessions left container-side TCP-LISTEN socats that forward their
// pub port to the OLD session's internal port. A NEW session can own that
// same internal port, so a stale socat would relay to the new chromium
// without a token. During the upgrade window, skip any pair whose pub port is
// still held by such a listener; sweep() reaps the stale socats.
async function containerHasStaleSocat(container, pub) {
  const matches = await execLayer.pgrepMatch(container, `TCP-LISTEN:${pub},`);
  return matches.length > 0;
}

export async function allocate(container) {
  const claimed = await claimedPortSet();

  for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
    const internal = p;
    const pub = p + 1;

    if (claimed.has(internal) || claimed.has(pub)) continue;

    const internalFree = await execLayer.isPortFree(container, internal);
    if (!internalFree) continue;

    const publicFree = await hostPortFree(pub);
    if (!publicFree) continue;

    if (await containerHasStaleSocat(container, pub)) continue;

    return { internal, public: pub };
  }

  throw new Error(`No free port pair available in range ${PORT_POOL_START}-${PORT_POOL_END}`);
}
