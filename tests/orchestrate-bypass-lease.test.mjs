import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUN_LOCK, acquireRunLease } from "../scripts/lib/run-lease.mjs";

const freshDir = () => mkdtemp(join(tmpdir(), "csm-lease-"));

test("two concurrent acquisitions of one runId: exactly one wins", async () => {
  const evidenceDir = await freshDir();
  const settled = await Promise.allSettled([
    acquireRunLease({ evidenceDir, runId: "run-race" }),
    acquireRunLease({ evidenceDir, runId: "run-race" }),
  ]);
  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  const rejected = settled.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one acquisition must win the lease");
  assert.equal(rejected.length, 1, "the loser must fail closed");
  assert.match(rejected[0].reason.message, /already active/);
  await fulfilled[0].value.release();
});

test("release removes the lease so a later run can acquire it", async () => {
  const evidenceDir = await freshDir();
  const first = await acquireRunLease({ evidenceDir, runId: "run-release" });
  await first.release();
  const second = await acquireRunLease({ evidenceDir, runId: "run-release" });
  assert.equal(typeof second.claim.token, "string");
  await second.release();
});

test("a live owner blocks a resume takeover", async () => {
  const evidenceDir = await freshDir();
  const live = await acquireRunLease({ evidenceDir, runId: "run-live" });
  await assert.rejects(
    () => acquireRunLease({ evidenceDir, runId: "run-live", resume: true }),
    /already active/,
  );
  await live.release();
});

test("a stale lease (dead pid) is refused without --resume and taken over with it", async () => {
  const evidenceDir = await freshDir();
  // A pid that cannot be alive: process.kill(pid, 0) throws ESRCH.
  await writeFile(
    join(evidenceDir, RUN_LOCK),
    `${JSON.stringify({ format: "csm-run-lock/1", kind: "run", pid: 2147483647, runId: "run-stale" })}\n`,
  );
  await assert.rejects(() => acquireRunLease({ evidenceDir, runId: "run-stale" }), /stale lease/);
  const taken = await acquireRunLease({ evidenceDir, runId: "run-stale", resume: true });
  const onDisk = JSON.parse(await readFile(join(evidenceDir, RUN_LOCK), "utf8"));
  assert.equal(onDisk.pid, process.pid);
  assert.notEqual(onDisk.pid, 2147483647);
  await taken.release();
});

test("concurrent --resume takeovers of one stale lock: exactly one wins", async () => {
  const evidenceDir = await freshDir();
  await writeFile(
    join(evidenceDir, RUN_LOCK),
    `${JSON.stringify({ format: "csm-run-lock/1", kind: "run", pid: 2147483647, runId: "run-resume" })}\n`,
  );
  const settled = await Promise.allSettled([
    acquireRunLease({ evidenceDir, runId: "run-resume", resume: true }),
    acquireRunLease({ evidenceDir, runId: "run-resume", resume: true }),
  ]);
  const won = settled.filter((entry) => entry.status === "fulfilled");
  assert.equal(won.length, 1, "exactly one concurrent resume may take the stale lease");
  await won[0].value.release();
});

test("release is inode-guarded: it never deletes a successor's lease", async () => {
  const evidenceDir = await freshDir();
  const first = await acquireRunLease({ evidenceDir, runId: "run-inode" });
  await first.release();
  const second = await acquireRunLease({ evidenceDir, runId: "run-inode" });
  // A second release of the retired handle must not remove the current holder.
  await first.release();
  const onDisk = JSON.parse(await readFile(join(evidenceDir, RUN_LOCK), "utf8"));
  assert.equal(onDisk.token, second.claim.token);
  await second.release();
});
