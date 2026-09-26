"use strict";

// Fail-fast run lease at <evidenceDir>/.run-lock (ledger-style EEXIST claim,
// inode+token-guarded release). Two concurrent fresh starts on one runId race
// here: the lease is the atomic claim. `resume` takes over a STALE lease
// (owner pid known-dead) via an atomic rename so only one racer can win; a
// live-owner conflict is a hard error naming the holder. Extracted so the claim
// can be tested directly.

import { createHash } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const RUN_LOCK = ".run-lock";
export const RUN_LOCK_FORMAT = "csm-run-lock/1";

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function makeLease({ lockPath, claim, ino, handle }) {
  let released = false;
  return {
    lockPath,
    claim,
    async release() {
      if (released) return;
      released = true;
      try {
        const current = await lstat(lockPath).catch(() => null);
        if (current === null || current.ino !== ino) return;
        // Fail closed on an unparseable/foreign claim: never delete a lock that
        // is not provably ours (guards inode reuse and read/write races).
        let holder = null;
        try {
          holder = JSON.parse(await readFile(lockPath, "utf8"));
        } catch {
          holder = null;
        }
        if (holder === null || holder.token !== claim.token) return;
        await rm(lockPath, { force: true });
      } finally {
        await handle.close().catch(() => {});
      }
    },
  };
}

export async function acquireRunLease({ evidenceDir, runId, resume = false }) {
  const lockPath = join(evidenceDir, RUN_LOCK);
  const claim = {
    format: RUN_LOCK_FORMAT,
    kind: "run",
    token: createHash("sha256")
      .update(`${process.pid}-${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 16),
    pid: process.pid,
    runId,
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o644);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = null;
      try {
        owner = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        owner = null;
      }
      const ownerPid = owner && typeof owner.pid === "number" ? owner.pid : null;
      const ownerAlive = ownerPid !== null && isPidAlive(ownerPid);
      if (resume && ownerPid !== null && !ownerAlive) {
        // Atomically claim the stale lock by renaming it: exactly one racer can
        // rename a given path, so concurrent resumes cannot both win.
        const stale = `${lockPath}.stale-${claim.token}-${attempt}`;
        try {
          await rename(lockPath, stale);
        } catch (renameError) {
          if (renameError.code === "ENOENT") continue; // another racer won; retry open
          throw renameError;
        }
        await rm(stale, { force: true });
        console.error(
          `run ${runId}: removed stale run lease (held by dead pid ${ownerPid}) under --resume`,
        );
        continue;
      }
      const where = ownerAlive ? "is already active" : "has a stale lease";
      throw new Error(
        `run ${runId} ${where} (lease ${lockPath} held by pid ${ownerPid ?? "unknown"}); wait for it to finish, or pass --resume only when that process is dead`,
        { cause: error },
      );
    }
    // Never leave a partial or unwritable lock behind: clean up on failure so a
    // failed acquisition cannot permanently fence the run.
    try {
      const { ino } = await handle.stat();
      await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`);
      return makeLease({ lockPath, claim, ino, handle });
    } catch (writeError) {
      await handle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
      throw writeError;
    }
  }
  throw new Error(`run ${runId} could not acquire the run lease after retries`);
}
