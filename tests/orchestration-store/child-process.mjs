"use strict";

// T006 child process fixtures for multi-process and crash-injection tests.
// Usage:
//   node child-process.mjs claim <dbPath> <cursorId> <expectedRevision>
//   node child-process.mjs claim-fresh <dbPath> <cursorId> <runId> <phaseId>
//   node child-process.mjs crash-write <dbPath>
// Prints one JSON line on stdout; "crash-write" exits without closing the
// store (simulated crash mid-flight, WAL left on disk).

import process from "node:process";
import { createSqliteStore } from "../../lib/orchestration-store/index.mjs";

const command = process.argv[2];
const dbPath = process.argv[3];
const cursorId = process.argv[4];
const expectedRevision = command === "claim" ? Number(process.argv[5]) : 0;
const runId = command === "claim-fresh" ? process.argv[5] : undefined;
const phaseId = command === "claim-fresh" ? process.argv[6] : undefined;

async function main() {
  if (command === "claim" || command === "claim-fresh") {
    const store = createSqliteStore({ databasePath: dbPath, mode: "wal" });
    try {
      const revision = command === "claim" ? Number(expectedRevision) : 0;
      const meta = command === "claim" ? undefined : { runId, phaseId };
      const claim = await store.claimCursor(cursorId, revision, meta);
      process.stdout.write(`${JSON.stringify({ ok: true, claim })}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, name: error.name, message: error.message })}\n`,
      );
    } finally {
      store.close();
    }
    return;
  }
  if (command === "crash-write") {
    const store = createSqliteStore({ databasePath: dbPath, mode: "wal" });
    const cursor = {
      schema: "csm-orchestrate-cursor/2",
      cursorId: "cursor-crash-child",
      runId: "run-crash-child",
      phaseId: "phase-crash-child",
      routeState: "selected",
      checkpointState: "saved",
      attempt: 1,
      idempotencyKey: "phase-crash-key",
      childReceiptIds: [],
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    await store.saveCursor(cursor);
    const claim = await store.claimCursor(cursor.cursorId, 1);
    await store.consumeApproval("approval-crash", cursor.cursorId);
    await store.createDispatchIntent(cursor.cursorId, "run-crash-grandchild", claim.fencingToken);
    await store.appendEvent(cursor.cursorId, "dispatch-timeout", { afterMs: 250 });
    await store.recordReconciliation("run-crash-grandchild", "UNKNOWN", { cause: "timeout" });
    process.stdout.write(`${JSON.stringify({ ok: true, written: true })}\n`);
    // Deliberate hard exit without store.close(): the WAL must recover.
    process.exit(0);
  }
  process.stderr.write(`child-process.mjs: unknown command ${command}\n`);
  process.exit(2);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
