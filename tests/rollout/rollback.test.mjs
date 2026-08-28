"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  createRolloutStack,
  healthyMetrics,
  seedActiveGoodVersion,
  sequenceClock,
} from "./helpers.mjs";

function rolloutFixture(options = {}) {
  const stack = createRolloutStack(options);
  const good = seedActiveGoodVersion(stack.versionRegistry);
  const candidate = stack.versionRegistry.register({ mode: "candidate" });
  stack.canary.start({ mode: "candidate" }, { configVersion: candidate.versionId });
  return { ...stack, good, candidate };
}

function triggerStop(canary, overrides = {}) {
  const evaluation = canary.checkSLOs(healthyMetrics({ falseVerified: 1, ...overrides }));
  assert.equal(evaluation.decision, "rollback");
  return evaluation;
}

test("rollback: execute fences the bad version, blocks dispatch, and restores the last known good pointer", () => {
  const { versionRegistry, canary, rollback, good, candidate } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary);
  const record = rollback.execute(canaryId, "false-verified-stop");
  assert.equal(record.fenced, true);
  assert.equal(record.dispatchBlocked, true);
  assert.equal(record.badVersion, candidate.versionId);
  assert.equal(record.lastKnownGoodVersionId, good.versionId);
  assert.equal(record.activeVersionIdAfter, good.versionId);
  assert.equal(versionRegistry.get(candidate.versionId).state, "fenced");
  assert.equal(versionRegistry.get(candidate.versionId).fenceReason, "false-verified-stop");
  assert.equal(versionRegistry.getActiveVersionId(), good.versionId);
  assert.equal(versionRegistry.authorizeDispatch(candidate.versionId).allowed, false);
  assert.equal(versionRegistry.authorizeDispatch(candidate.versionId).reason, "version-fenced");
  assert.equal(versionRegistry.authorizeDispatch(good.versionId).allowed, true);
  assert.equal(canary.getStatus().state, "rolled-back");
  assert.equal(canary.getStatus().rollbackReason, "false-verified-stop");
});

test("rollback: the fenced version can never be re-activated or re-dispatched (cross-boundary retry prevention)", () => {
  const { versionRegistry, canary, rollback, candidate } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary);
  rollback.execute(canaryId, "stop");
  assert.throws(
    () => versionRegistry.activate(candidate.versionId),
    (error) => error.code === "version-fenced",
  );
  assert.throws(
    () => versionRegistry.assertDispatchable(candidate.versionId),
    (error) => error.code === "version-fenced",
  );
});

test("rollback: verify confirms dispatch blocked, pointer moved, history preserved, and in-flight reconciled", () => {
  const { canary, rollback } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary);
  rollback.execute(canaryId, "false-verified-stop");
  const verification = rollback.verify(canaryId);
  assert.equal(verification.verified, true);
  assert.deepEqual(
    verification.checks.map((check) => check.id),
    ["dispatch-blocked", "pointer-moved", "history-preserved", "in-flight-reconciled"],
  );
  assert.ok(verification.checks.every((check) => check.pass === true));
});

test("rollback: in-flight effects require reconciliation before verification passes", () => {
  const { canary, rollback } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary, {
    unauthorizedEffects: 1,
    inFlightEffects: [
      {
        effectId: "eff-idempotent",
        kind: "publish",
        idempotent: true,
        dispatchedAt: "2026-08-28T00:00:01.000Z",
      },
      {
        effectId: "eff-unique",
        kind: "email",
        idempotent: false,
        dispatchedAt: "2026-08-28T00:00:02.000Z",
      },
    ],
  });
  const record = rollback.execute(canaryId, "unauthorized-effect");
  assert.equal(record.reconciliation.length, 2);
  assert.deepEqual(
    record.reconciliation.map((entry) => entry.state),
    ["reconciliation-required", "reconciliation-required"],
  );
  assert.equal(record.reconciliation[0].strategy, "sink-idempotency-verification");
  assert.equal(record.reconciliation[1].strategy, "manual-verification-required");
  let verification = rollback.verify(canaryId);
  assert.equal(verification.verified, false);
  const failedCheck = verification.checks.find((check) => check.id === "in-flight-reconciled");
  assert.equal(failedCheck.pass, false);
  assert.deepEqual(failedCheck.detail.pending, ["eff-idempotent", "eff-unique"]);

  rollback.markReconciled(canaryId, "eff-idempotent", "duplicate-suppressed");
  const entry = rollback.markReconciled(canaryId, "eff-unique", "compensated");
  assert.equal(entry.state, "reconciled");
  assert.equal(entry.resolution, "compensated");
  verification = rollback.verify(canaryId);
  assert.equal(verification.verified, true);
  assert.throws(
    () => rollback.markReconciled(canaryId, "eff-unknown", "compensated"),
    (error) => error.code === "unknown-effect",
  );
  assert.throws(
    () => rollback.markReconciled(canaryId, "eff-idempotent", "not-a-resolution"),
    (error) => error.code === "invalid-resolution",
  );
});

test("rollback: history and receipts are preserved, never deleted", () => {
  const { versionRegistry, canary, rollback, candidate } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary);
  const record = rollback.execute(canaryId, "false-verified-stop");
  assert.equal(versionRegistry.historySize(), 2);
  assert.equal(record.history.versionsBefore, 2);
  assert.equal(record.history.versionsAfter, 2);
  assert.equal(record.history.canaryEvaluationsPreserved, 1);
  const verification = rollback.verify(canaryId);
  const historyCheck = verification.checks.find((check) => check.id === "history-preserved");
  assert.equal(historyCheck.pass, true);
  assert.equal(historyCheck.detail.canaryEvaluations, 1);
  const fenced = versionRegistry.get(candidate.versionId);
  assert.equal(fenced.state, "fenced");
  assert.deepEqual(
    versionRegistry
      .list()
      .map((entry) => entry.versionId)
      .includes(candidate.versionId),
    true,
  );
  assert.equal(canary.getStatus().evaluations.count, 1);
});

test("rollback: rollback time is measured and reported", () => {
  const timed = rolloutFixture({ rollbackClock: sequenceClock([500, 517]) });
  const canaryId = timed.canary.getStatus().canaryId;
  triggerStop(timed.canary);
  const record = timed.rollback.execute(canaryId, "false-verified-stop");
  assert.equal(record.rollbackTimeMs, 17);
  assert.equal(timed.rollback.getRollbackTime(canaryId), 17);
});

test("rollback: re-executing a rollback is idempotent and never rewrites history", () => {
  const { canary, rollback } = rolloutFixture({ rollbackClock: sequenceClock([500, 517]) });
  const canaryId = canary.getStatus().canaryId;
  triggerStop(canary);
  const first = rollback.execute(canaryId, "false-verified-stop");
  assert.equal(first.repeated, false);
  const second = rollback.execute(canaryId, "false-verified-stop");
  assert.equal(second.repeated, true);
  assert.equal(second.rollbackId, first.rollbackId);
  assert.equal(rollback.getRollbackTime(canaryId), 17);
  assert.equal(rollback.verify(canaryId).verified, true);
});

test("rollback: unknown canaries and pre-execution verification fail closed", () => {
  const { canary, rollback } = rolloutFixture();
  const canaryId = canary.getStatus().canaryId;
  assert.throws(
    () => rollback.execute("canary-does-not-exist", "reason"),
    (error) => error.code === "unknown-canary",
  );
  assert.throws(
    () => rollback.verify(canaryId),
    (error) => error.code === "rollback-not-executed",
  );
  assert.throws(
    () => rollback.getRollbackTime(canaryId),
    (error) => error.code === "rollback-not-executed",
  );
  assert.throws(
    () => rollback.execute(canaryId, ""),
    (error) => error.code === "invalid-reason",
  );
});

test("rollback: a promoted version can still be rolled back and the pointer falls back further", () => {
  const stack = createRolloutStack();
  const first = seedActiveGoodVersion(stack.versionRegistry, { mode: "good-1" });
  stack.versionRegistry.activate(first.versionId);
  const candidate = stack.versionRegistry.register({ mode: "candidate" });
  stack.canary.start({ mode: "candidate" }, { configVersion: candidate.versionId });
  stack.canary.checkSLOs(healthyMetrics({ samples: 100 }));
  stack.canary.markPromoted();
  stack.versionRegistry.activate(candidate.versionId);
  assert.equal(stack.versionRegistry.getActiveVersionId(), candidate.versionId);
  stack.canary.checkSLOs(healthyMetrics({ telemetryBlindSpots: 2 }));
  const record = stack.rollback.execute(stack.canary.getStatus().canaryId, "telemetry-blindness");
  assert.equal(record.badVersion, candidate.versionId);
  assert.equal(record.lastKnownGoodVersionId, first.versionId);
  assert.equal(stack.versionRegistry.getActiveVersionId(), first.versionId);
  assert.equal(stack.versionRegistry.get(candidate.versionId).state, "fenced");
});
