"use strict";

import { performance } from "node:perf_hooks";
import { RolloutError, cloneData, deepFreeze, isPlainObject } from "./internal.mjs";

export const ROLLBACK_RECORD_FORMAT = "csm-rollback-record/1";
export const RECONCILIATION_RESOLUTIONS = Object.freeze([
  "duplicate-suppressed",
  "effect-confirmed",
  "compensated",
  "verified-no-effect",
]);

export class RollbackError extends RolloutError {}

export function createRollbackController(options = {}) {
  if (options !== null && !isPlainObject(options))
    throw new RollbackError(
      "invalid-options",
      "rollback controller options must be a plain object",
    );
  const { canary, versionRegistry } = options;
  if (!isPlainObject(canary) || typeof canary.getStatus !== "function")
    throw new RollbackError("invalid-options", "rollback controller requires a canary controller");
  if (!isPlainObject(versionRegistry) || typeof versionRegistry.fence !== "function")
    throw new RollbackError("invalid-options", "rollback controller requires a version registry");
  const now = options.now ?? (() => new Date().toISOString());
  const clock = options.clock ?? (() => performance.now());

  let rollbackSequence = 0;
  const rollbacks = new Map();

  function requireRecord(canaryId) {
    const record = rollbacks.get(canaryId);
    if (record === undefined)
      throw new RollbackError(
        "rollback-not-executed",
        `no rollback executed for canary '${canaryId}'`,
      );
    return record;
  }

  function execute(canaryId, reason) {
    if (typeof canaryId !== "string" || canaryId.length === 0)
      throw new RollbackError("invalid-canary-id", "canaryId must be a non-empty string");
    if (typeof reason !== "string" || reason.length === 0)
      throw new RollbackError("invalid-reason", "rollback reason must be a non-empty string");
    const existing = rollbacks.get(canaryId);
    if (existing !== undefined) return deepFreeze({ ...cloneData(existing), repeated: true });
    const status = canary.getStatus();
    if (status.canaryId === null || status.canaryId !== canaryId)
      throw new RollbackError("unknown-canary", `no canary '${canaryId}' on this controller`);
    const executedAt = now();
    const startClock = clock();
    const badVersion = status.configVersion;
    const historyBefore = versionRegistry.historySize();
    const evaluationsPreserved = status.evaluations.count;
    let fenced = false;
    if (badVersion !== null) {
      versionRegistry.fence(badVersion, reason);
      fenced = true;
    }
    const reconciliation = status.inFlightEffects.map((effect) => ({
      effectId: effect.effectId,
      kind: effect.kind ?? "unknown",
      idempotent: effect.idempotent === true,
      state: "reconciliation-required",
      strategy:
        effect.idempotent === true
          ? "sink-idempotency-verification"
          : "manual-verification-required",
      recordedAt: executedAt,
      resolvedAt: null,
      resolution: null,
    }));
    let lastKnownGoodVersionId = null;
    if (badVersion !== null) {
      const lastKnownGood = versionRegistry.getLastKnownGood({ excluding: badVersion });
      if (lastKnownGood !== null) {
        versionRegistry.activate(lastKnownGood.versionId);
        lastKnownGoodVersionId = lastKnownGood.versionId;
      }
    }
    const rollbackTimeMs = clock() - startClock;
    rollbackSequence += 1;
    const record = {
      rollbackId: `rollback-${rollbackSequence}`,
      canaryId,
      reason,
      executedAt,
      badVersion,
      fenced,
      dispatchBlocked:
        badVersion === null
          ? true
          : versionRegistry.authorizeDispatch(badVersion).allowed === false,
      lastKnownGoodVersionId,
      activeVersionIdAfter: versionRegistry.getActiveVersionId(),
      reconciliation,
      history: {
        versionsBefore: historyBefore,
        versionsAfter: versionRegistry.historySize(),
        canaryEvaluationsPreserved: evaluationsPreserved,
      },
      rollbackTimeMs,
      repeated: false,
    };
    rollbacks.set(canaryId, record);
    canary.markRolledBack(reason);
    return deepFreeze(cloneData(record));
  }

  function markReconciled(canaryId, effectId, resolution) {
    const record = requireRecord(canaryId);
    if (typeof effectId !== "string" || effectId.length === 0)
      throw new RollbackError("invalid-effect", "effectId must be a non-empty string");
    if (!RECONCILIATION_RESOLUTIONS.includes(resolution))
      throw new RollbackError(
        "invalid-resolution",
        `resolution must be one of: ${RECONCILIATION_RESOLUTIONS.join(", ")}`,
      );
    const entry = record.reconciliation.find((candidate) => candidate.effectId === effectId);
    if (entry === undefined)
      throw new RollbackError(
        "unknown-effect",
        `no in-flight effect '${effectId}' awaiting reconciliation`,
      );
    entry.state = "reconciled";
    entry.resolvedAt = now();
    entry.resolution = resolution;
    return deepFreeze(cloneData(entry));
  }

  function verify(canaryId) {
    const record = requireRecord(canaryId);
    const status = canary.getStatus();
    const checks = [];
    if (record.badVersion !== null) {
      const dispatch = versionRegistry.authorizeDispatch(record.badVersion);
      let probeRefused = false;
      try {
        versionRegistry.assertDispatchable(record.badVersion);
      } catch {
        probeRefused = true;
      }
      checks.push({
        id: "dispatch-blocked",
        pass: dispatch.allowed === false && probeRefused,
        detail: { reason: dispatch.reason },
      });
      const activeVersionId = versionRegistry.getActiveVersionId();
      checks.push({
        id: "pointer-moved",
        pass: activeVersionId !== record.badVersion,
        detail: { activeVersionId },
      });
      const badRecord = versionRegistry.get(record.badVersion);
      checks.push({
        id: "history-preserved",
        pass:
          badRecord.state === "fenced" &&
          badRecord.fenceReason === record.reason &&
          versionRegistry.historySize() >= record.history.versionsAfter &&
          versionRegistry.historySize() >= record.history.versionsBefore &&
          status.evaluations.count >= record.history.canaryEvaluationsPreserved,
        detail: {
          versionState: badRecord.state,
          versions: versionRegistry.historySize(),
          canaryEvaluations: status.evaluations.count,
        },
      });
    } else {
      checks.push({
        id: "dispatch-blocked",
        pass: true,
        detail: { reason: "no-version-registry" },
      });
      checks.push({ id: "pointer-moved", pass: true, detail: { activeVersionId: null } });
      checks.push({
        id: "history-preserved",
        pass: status.evaluations.count >= record.history.canaryEvaluationsPreserved,
        detail: { canaryEvaluations: status.evaluations.count },
      });
    }
    const pending = record.reconciliation
      .filter((entry) => entry.state !== "reconciled")
      .map((entry) => entry.effectId);
    checks.push({
      id: "in-flight-reconciled",
      pass: pending.length === 0,
      detail: { pending },
    });
    return deepFreeze({
      verified: checks.every((check) => check.pass),
      checks,
      verifiedAt: now(),
    });
  }

  function getRollbackTime(canaryId) {
    return requireRecord(canaryId).rollbackTimeMs;
  }

  return Object.freeze({ execute, markReconciled, verify, getRollbackTime });
}
