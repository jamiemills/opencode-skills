"use strict";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { createSqliteStore } from "../../lib/orchestration-store/index.mjs";
import { SQLITE_AVAILABLE, baseCursor, withTempDir } from "./helpers.mjs";

const childScript = new URL("./child-process.mjs", import.meta.url).pathname;

function runChild(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [childScript, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("two stores on the same database file serialize claims to exactly one winner", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  await withTempDir(async (dir) => {
    const databasePath = `${dir}/dual-store.db`;
    const seed = createSqliteStore({ databasePath, mode: "wal" });
    const cursor = baseCursor({ cursorId: "cursor-dual" });
    await seed.saveCursor(cursor);
    seed.close();

    const storeA = createSqliteStore({ databasePath, mode: "wal" });
    const storeB = createSqliteStore({ databasePath, mode: "wal" });
    try {
      const attempts = await Promise.allSettled([
        storeA.claimCursor(cursor.cursorId, 1),
        storeB.claimCursor(cursor.cursorId, 1),
      ]);
      const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
      const losers = attempts.filter((attempt) => attempt.status === "rejected");
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.match(String(losers[0].reason?.name ?? ""), /CasMismatch/);
      const reconciled = await storeB.getCursorMeta(cursor.cursorId);
      assert.equal(reconciled.revision, 2, "the losing store observes the winner's revision");
      assert.equal(reconciled.fencingToken, 1);
    } finally {
      storeA.close();
      storeB.close();
    }
  });
});

test("two OS processes racing one claim: exactly one succeeds", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  await withTempDir(async (dir) => {
    const databasePath = `${dir}/process-race.db`;
    const seed = createSqliteStore({ databasePath, mode: "wal" });
    const cursor = baseCursor({ cursorId: "cursor-race" });
    await seed.saveCursor(cursor);
    seed.close();

    const children = await Promise.all(
      Array.from({ length: 4 }, () =>
        runChild(["claim", databasePath, cursor.cursorId, "1"]).then(({ stdout }) =>
          JSON.parse(stdout.trim().split("\n").at(-1)),
        ),
      ),
    );
    assert.equal(children.filter((child) => child.ok).length, 1);
    const failures = children.filter((child) => !child.ok);
    assert.equal(failures.length, 3);
    for (const failure of failures) assert.equal(failure.name, "CasMismatchError");

    const reopened = createSqliteStore({ databasePath, mode: "wal" });
    try {
      const meta = await reopened.getCursorMeta(cursor.cursorId);
      assert.equal(meta.revision, 2);
      assert.equal(meta.fencingToken, 1);
      const history = await reopened.getHistory(cursor.cursorId);
      assert.equal(history.filter((event) => event.eventType === "cursor-claimed").length, 1);
    } finally {
      reopened.close();
    }
  });
});

test("concurrent fresh opens migrate exactly once and stay consistent", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  await withTempDir(async (dir) => {
    const databasePath = `${dir}/migration-race.db`;
    const children = await Promise.all([
      runChild(["claim-fresh", databasePath, "cursor-mig-a", "run-mig", "phase-mig"]),
      runChild(["claim-fresh", databasePath, "cursor-mig-b", "run-mig", "phase-mig"]),
    ]);
    const results = children.map(({ stdout }) => JSON.parse(stdout.trim().split("\n").at(-1)));
    assert.ok(results.every((result) => result.ok));

    const reopened = createSqliteStore({ databasePath, mode: "wal" });
    try {
      assert.equal(await reopened.getSchemaVersion(), 1, "migration replay is idempotent");
      assert.ok(await reopened.claimCursor("cursor-mig-a", 1));
    } finally {
      reopened.close();
    }
  });
});

test("crash recovery: a hard exit without close persists committed WAL state", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  await withTempDir(async (dir) => {
    const databasePath = `${dir}/crash.db`;
    const crashed = await runChild(["crash-write", databasePath]);
    assert.equal(crashed.code, 0, crashed.stderr);

    const recovered = createSqliteStore({ databasePath, mode: "wal" });
    try {
      assert.equal(recovered.getBackendInfo().journalMode, "wal");
      const cursor = await recovered.loadCursor("cursor-crash-child");
      assert.equal(cursor.checkpointState, "saved");
      assert.equal(cursor.attempt, 1);
      const meta = await recovered.getCursorMeta("cursor-crash-child");
      assert.equal(meta.revision, 2);
      assert.equal(meta.fencingToken, 1);
      await assert.rejects(
        recovered.consumeApproval("approval-crash", "cursor-crash-child"),
        /already consumed/,
      );
      const reconciliation = await recovered.getReconciliation("run-crash-grandchild");
      assert.equal(reconciliation.outcome, "UNKNOWN");
      await recovered.recordReconciliation("run-crash-grandchild", "RESOLVED-COMPLETED", {
        observed: "recovered-sink-state",
      });
      const intent = await recovered.createDispatchIntent(
        "cursor-crash-child",
        "run-crash-grandchild",
        1,
      );
      assert.equal(intent.created, false, "the pre-crash intent is reconstructed, not duplicated");
      const history = await recovered.getHistory("cursor-crash-child");
      assert.ok(history.some((event) => event.eventType === "dispatch-timeout"));
    } finally {
      recovered.close();
    }
  });
});
