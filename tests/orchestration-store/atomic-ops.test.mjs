"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  ApprovalAlreadyConsumedError,
  DuplicateIdempotencyError,
  MonotonicTerminalError,
  ReconciliationRequiredError,
} from "../../lib/orchestration-store/index.mjs";
import { SQLITE_AVAILABLE, baseCursor, withStore } from "./helpers.mjs";

const backends = [
  { label: "sqlite-wal", options: { mode: "wal" }, skip: !SQLITE_AVAILABLE },
  { label: "sqlite-memory", options: { mode: "memory" }, skip: !SQLITE_AVAILABLE },
  { label: "memory-js", options: { driver: "memory-js" }, skip: false },
];

test("approval consumption is one-time and records the consumer", async () => {
  await withStore({}, async (store) => {
    const cursor = baseCursor({ cursorId: "cursor-approval" });
    await store.saveCursor(cursor);
    const consumed = await store.consumeApproval("approval-once", cursor.cursorId);
    assert.equal(consumed.approvalId, "approval-once");
    assert.equal(consumed.consumedByCursor, cursor.cursorId);
    await assert.rejects(
      store.consumeApproval("approval-once", cursor.cursorId),
      (error) =>
        error instanceof ApprovalAlreadyConsumedError &&
        error.info.consumedByCursor === cursor.cursorId,
    );
    const different = await store.consumeApproval("approval-second", cursor.cursorId);
    assert.equal(different.approvalId, "approval-second");
  });
});

test("idempotency keys are single-writer and duplicate keys are rejected", async () => {
  await withStore({}, async (store) => {
    const cursor = baseCursor({ cursorId: "cursor-idem" });
    await store.saveCursor(cursor);
    const record = await store.recordIdempotency("phase-key:node:0", cursor.cursorId);
    assert.equal(record.key, "phase-key:node:0");
    await assert.rejects(
      store.recordIdempotency("phase-key:node:0", cursor.cursorId),
      (error) =>
        error instanceof DuplicateIdempotencyError && error.info.cursorId === cursor.cursorId,
    );
    const other = await store.recordIdempotency("phase-key:node:1", cursor.cursorId);
    assert.equal(other.key, "phase-key:node:1");
  });
});

for (const backend of backends) {
  const { label, options, skip } = backend;

  test(`[${label}] dispatch intents are created atomically and resolved once`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-intent" });
      await store.saveCursor(cursor);
      const claim = await store.claimCursor(cursor.cursorId, 1);
      const intent = await store.createDispatchIntent(
        cursor.cursorId,
        "run-intent-child",
        claim.fencingToken,
      );
      assert.equal(intent.created, true);
      assert.equal(intent.status, "pending");
      const replay = await store.createDispatchIntent(
        cursor.cursorId,
        "run-intent-child",
        claim.fencingToken,
      );
      assert.equal(replay.created, false);
      assert.equal(replay.intentId, intent.intentId);
      assert.equal(replay.status, "pending");
      const resolved = await store.resolveDispatchIntent(intent.intentId, "completed");
      assert.equal(resolved.changed, true);
      const same = await store.resolveDispatchIntent(intent.intentId, "completed");
      assert.equal(same.changed, false, "same-status re-resolution is idempotent");
      await assert.rejects(store.resolveDispatchIntent(intent.intentId, "failed"), (error) =>
        /cannot be resolved/.test(error.message),
      );
      const reclaimed = await store.claimCursor(cursor.cursorId, 2);
      const retry = await store.createDispatchIntent(
        cursor.cursorId,
        "run-intent-child",
        reclaimed.fencingToken,
      );
      assert.notEqual(retry.intentId, intent.intentId, "a new token is a new logical attempt");
      assert.equal(retry.created, true);
    });
  });

  test(`[${label}] history is append-only, ordered, and replayable`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-history" });
      await store.saveCursor(cursor);
      await store.claimCursor(cursor.cursorId, 1);
      const first = await store.appendEvent(cursor.cursorId, "node-note", { step: 1 });
      const second = await store.appendEvent(cursor.cursorId, "node-note", { step: 2 });
      assert.ok(second.sequence > first.sequence);
      await store.saveCursor({ ...cursor, checkpointState: "validated" });
      const history = await store.getHistory(cursor.cursorId);
      assert.ok(history.length >= 4);
      const sequences = history.map((event) => event.sequence);
      assert.deepEqual(
        sequences,
        sequences.toSorted((a, b) => a - b),
      );
      assert.deepEqual(
        history.filter((event) => event.eventType === "node-note").map((event) => event.payload),
        [{ step: 1 }, { step: 2 }],
      );
      const saved = history.filter((event) => event.eventType === "cursor-saved");
      assert.deepEqual(
        saved.map((event) => event.payload.revision),
        [1, 3],
        "the intervening claim consumes revision 2",
      );
    });
  });

  test(`[${label}] terminal receipts are monotonic and cannot be overwritten`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const receipt = {
        schema: "csm-orchestrate-receipt/2",
        receiptId: "receipt-terminal",
        runId: "run-terminal",
        phaseId: "phase-terminal",
        childReceipts: [],
        approval: null,
        statuses: [],
        outcome: { status: "VERIFIED", accepted: true },
        idempotencyKey: "terminal-key",
      };
      const saved = await store.saveTerminalReceipt(receipt);
      assert.equal(saved.receiptId, receipt.receiptId);
      await assert.rejects(
        store.saveTerminalReceipt({ ...receipt, outcome: { status: "REJECTED", accepted: false } }),
        (error) =>
          error instanceof MonotonicTerminalError && error.info.existingStatus === "completed",
      );
      await assert.rejects(
        store.saveTerminalReceipt(receipt),
        (error) => error instanceof MonotonicTerminalError,
      );
      const loaded = await store.loadTerminalReceipt(receipt.receiptId);
      assert.deepEqual(loaded.outcome, { status: "VERIFIED", accepted: true });
      const records = await store.loadTerminalRecords("run-terminal");
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "completed");
      assert.equal(records[0].childRunId, "run-terminal");
      assert.equal(records[0].result.status, records[0].status);
    });
  });

  test(`[${label}] UNKNOWN reconciliation blocks dispatch until resolved`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-unknown" });
      await store.saveCursor(cursor);
      const claim = await store.claimCursor(cursor.cursorId, 1);
      const unknown = await store.recordReconciliation("run-unknown-child", "UNKNOWN", {
        cause: "timeout-after-possible-side-effect",
      });
      assert.equal(unknown.outcome, "UNKNOWN");
      assert.equal(unknown.resolvedAt, null);
      await assert.rejects(
        store.createDispatchIntent(cursor.cursorId, "run-unknown-child", claim.fencingToken),
        (error) => error instanceof ReconciliationRequiredError,
      );
      const resolved = await store.recordReconciliation("run-unknown-child", "RESOLVED-COMPLETED", {
        observed: "sink-confirmed-once",
      });
      assert.equal(resolved.outcome, "RESOLVED-COMPLETED");
      assert.ok(resolved.resolvedAt);
      const intent = await store.createDispatchIntent(
        cursor.cursorId,
        "run-unknown-child",
        claim.fencingToken,
      );
      assert.equal(intent.created, true, "dispatch is allowed after reconciliation");
      await assert.rejects(
        store.recordReconciliation("run-unknown-child", "UNKNOWN", {}),
        (error) => error instanceof MonotonicTerminalError,
      );
      await assert.rejects(
        store.recordReconciliation("run-unknown-child", "RESOLVED-FAILED", {}),
        (error) => error instanceof MonotonicTerminalError,
      );
    });
  });

  test(`[${label}] late results are recorded but never overwrite terminal state`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-late" });
      await store.saveCursor(cursor);
      await store.recordReconciliation("run-late-child", "UNKNOWN", { cause: "cancellation" });
      const receipt = {
        schema: "csm-orchestrate-receipt/2",
        receiptId: "receipt-late",
        runId: "run-late-parent",
        phaseId: "phase-late",
        childReceipts: [],
        approval: null,
        statuses: [],
        outcome: { status: "VERIFIED", accepted: true },
        idempotencyKey: "late-key",
      };
      await store.saveTerminalReceipt(receipt);
      const late = await store.recordLateResult("run-late-child", {
        status: "completed",
        artifact: "art-late",
      });
      assert.equal(late.recordedAsEvent, true);
      assert.equal(late.reconciliationResolved, true);
      assert.equal(late.terminalStateModified, false);
      const reconciliation = await store.getReconciliation("run-late-child");
      assert.equal(reconciliation.outcome, "RESOLVED-LATE-RESULT");
      assert.deepEqual(reconciliation.details.lateResult, {
        status: "completed",
        artifact: "art-late",
      });
      const loaded = await store.loadTerminalReceipt("receipt-late");
      assert.deepEqual(loaded.outcome, { status: "VERIFIED", accepted: true });
      const lateHistory = await store.getHistory("reconciliation:run-late-child");
      assert.ok(lateHistory.some((event) => event.eventType === "late-result"));
      const afterResolution = await store.recordLateResult("run-late-child", {
        status: "completed",
      });
      assert.equal(afterResolution.reconciliationResolved, false);
      const stable = await store.getReconciliation("run-late-child");
      assert.equal(stable.outcome, "RESOLVED-LATE-RESULT");
    });
  });

  test(`[${label}] closed stores reject further operations`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      store.close();
      await assert.rejects(store.loadCursor("cursor-closed"), /closed/);
      await assert.rejects(store.appendEvent("cursor-closed", "nope", {}), /closed/);
      store.close();
    });
  });
}
