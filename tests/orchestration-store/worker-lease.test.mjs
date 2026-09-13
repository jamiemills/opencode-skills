"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { WorkerLeaseError } from "../../lib/orchestration-store/index.mjs";
import { withStore } from "./helpers.mjs";

const CLOCK = { now: "2026-09-12T00:00:00.000Z" };
const minutes = (n) => new Date(Date.parse("2026-09-12T00:00:00.000Z") + n * 60_000).toISOString();
const options = () => ({ driver: "memory-js", now: () => CLOCK.now });

test("worker leases: claim is fail-fast against a live duplicate and fences increase", async () => {
  await withStore(options(), async (s) => {
    const first = await s.claimWorker({
      workerId: "worker-build-1",
      runId: "run-build-1",
      taskId: "task-build-1",
      leaseMs: 60_000,
    });
    assert.equal(first.state, "active");
    assert.equal(first.fencingToken, 1);
    assert.equal(first.expiresAt, minutes(1));
    await assert.rejects(
      s.claimWorker({ workerId: "worker-build-1", runId: "run-build-1", leaseMs: 60_000 }),
      WorkerLeaseError,
    );
  });
});

test("worker leases: heartbeat extends expiry and release allows a higher-fenced reclaim", async () => {
  await withStore(options(), async (s) => {
    const first = await s.claimWorker({
      workerId: "worker-build-1",
      runId: "run-build-1",
      leaseMs: 60_000,
    });
    CLOCK.now = minutes(0.5);
    const beat = await s.heartbeatWorker({
      workerId: "worker-build-1",
      leaseToken: first.leaseToken,
      leaseMs: 120_000,
    });
    assert.equal(beat.expiresAt, minutes(2.5));
    await s.releaseWorker({
      workerId: "worker-build-1",
      leaseToken: first.leaseToken,
      state: "completed",
    });
    const reclaimed = await s.claimWorker({
      workerId: "worker-build-1",
      runId: "run-build-1",
      attempt: 2,
      leaseMs: 60_000,
    });
    assert.equal(reclaimed.fencingToken, 2);
    assert.equal(reclaimed.attempt, 2);
  });
});

test("worker leases: expired leases reconcile as stale and become reclaimable", async () => {
  await withStore(options(), async (s) => {
    await s.claimWorker({ workerId: "worker-build-1", runId: "run-build-1", leaseMs: 60_000 });
    CLOCK.now = minutes(5);
    const stale = await s.reconcileStaleWorkers({ at: CLOCK.now });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].workerId, "worker-build-1");
    const row = await s.loadWorker("worker-build-1");
    assert.equal(row.state, "stale");
    const reclaimed = await s.claimWorker({
      workerId: "worker-build-1",
      runId: "run-build-1",
      leaseMs: 60_000,
    });
    assert.equal(reclaimed.state, "active");
    assert.equal(reclaimed.fencingToken, 2);
  });
});

test("worker leases: heartbeat rejects a wrong or stale token", async () => {
  await withStore(options(), async (s) => {
    await s.claimWorker({ workerId: "worker-build-1", runId: "run-build-1", leaseMs: 60_000 });
    await assert.rejects(
      s.heartbeatWorker({
        workerId: "worker-build-1",
        leaseToken: "not-the-token",
        leaseMs: 60_000,
      }),
      WorkerLeaseError,
    );
    CLOCK.now = minutes(10);
    await assert.rejects(
      s.heartbeatWorker({
        workerId: "worker-build-1",
        leaseToken: "not-the-token",
        leaseMs: 60_000,
      }),
      WorkerLeaseError,
    );
  });
});
