"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  CasMismatchError,
  OrchestrationStoreError,
  StaleFenceError,
  createSqliteStore,
} from "../../lib/orchestration-store/index.mjs";
import { SQLITE_AVAILABLE, baseCursor, withStore } from "./helpers.mjs";

const backends = [
  { label: "sqlite-wal", options: { mode: "wal" }, skip: !SQLITE_AVAILABLE },
  { label: "sqlite-memory", options: { mode: "memory" }, skip: !SQLITE_AVAILABLE },
  { label: "memory-js", options: { driver: "memory-js" }, skip: false },
];

for (const backend of backends) {
  const { label, options, skip } = backend;

  test(`[${label}] saveCursor upserts and bumps the internal revision`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore({ ...options, now: () => "2026-08-27T12:00:00.000Z" }, async (store) => {
      const cursor = baseCursor();
      await store.saveCursor(cursor);
      let meta = await store.getCursorMeta(cursor.cursorId);
      assert.equal(meta.revision, 1);
      await store.saveCursor({ ...cursor, checkpointState: "validated" });
      meta = await store.getCursorMeta(cursor.cursorId);
      assert.equal(meta.revision, 2);
      const loaded = await store.loadCursor(cursor.cursorId);
      assert.equal(loaded.checkpointState, "validated");
      assert.equal(loaded.schema, "csm-orchestrate-cursor/2");
      assert.equal(loaded.revision, undefined, "internal revision must not leak into the document");
    });
  });

  test(`[${label}] saveCursor CAS rejects a stale expected revision`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor();
      await store.saveCursor(cursor);
      await assert.rejects(
        store.saveCursor({ ...cursor, checkpointState: "validated" }, { expectedRevision: 0 }),
        (error) => error instanceof CasMismatchError && error.info.currentRevision === 1,
      );
      await store.saveCursor({ ...cursor, checkpointState: "validated" }, { expectedRevision: 1 });
      assert.equal((await store.getCursorMeta(cursor.cursorId)).revision, 2);
    });
  });

  test(`[${label}] claimCursor is an atomic CAS and mints a fencing token`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor();
      await store.saveCursor(cursor);
      const claim = await store.claimCursor(cursor.cursorId, 1);
      assert.deepEqual(claim, { cursorId: cursor.cursorId, revision: 2, fencingToken: 1 });
      await assert.rejects(
        store.claimCursor(cursor.cursorId, 1),
        (error) => error instanceof CasMismatchError && error.info.currentRevision === 2,
      );
      const reclaim = await store.claimCursor(cursor.cursorId, 2);
      assert.equal(reclaim.fencingToken, 2, "tokens are monotonic per cursor");
      assert.equal(reclaim.revision, 3);
    });
  });

  test(`[${label}] concurrent claims on one revision: exactly one succeeds`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-claim-race" });
      await store.saveCursor(cursor);
      const attempts = await Promise.allSettled([
        store.claimCursor(cursor.cursorId, 1),
        store.claimCursor(cursor.cursorId, 1),
        store.claimCursor(cursor.cursorId, 1),
        store.claimCursor(cursor.cursorId, 1),
        store.claimCursor(cursor.cursorId, 1),
      ]);
      const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
      const rejected = attempts.filter((attempt) => attempt.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 4);
      for (const attempt of rejected) assert.ok(attempt.reason instanceof CasMismatchError);
      assert.equal((await store.getCursorMeta(cursor.cursorId)).revision, 2);
    });
  });

  test(`[${label}] a stale fencing token cannot write the cursor`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-fence-write" });
      await store.saveCursor(cursor);
      const first = await store.claimCursor(cursor.cursorId, 1);
      const second = await store.claimCursor(cursor.cursorId, 2);
      await assert.rejects(
        store.saveCursor(
          { ...cursor, checkpointState: "validated" },
          { fencingToken: first.fencingToken },
        ),
        (error) =>
          error instanceof StaleFenceError && error.info.currentToken === second.fencingToken,
      );
      await store.saveCursor(
        { ...cursor, checkpointState: "validated" },
        { fencingToken: second.fencingToken },
      );
      assert.equal((await store.loadCursor(cursor.cursorId)).checkpointState, "validated");
    });
  });

  test(`[${label}] dispatch intents reject stale and unissued fencing tokens`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      const cursor = baseCursor({ cursorId: "cursor-fence-intent" });
      await store.saveCursor(cursor);
      const claim = await store.claimCursor(cursor.cursorId, 1);
      await store.claimCursor(cursor.cursorId, 2);
      await assert.rejects(
        store.createDispatchIntent(cursor.cursorId, "run-fence-child", claim.fencingToken),
        (error) => error instanceof StaleFenceError,
      );
      await assert.rejects(
        store.createDispatchIntent(cursor.cursorId, "run-fence-child", 99),
        (error) => error instanceof OrchestrationStoreError && /never issued/.test(error.message),
      );
    });
  });

  test(`[${label}] claiming an unknown cursor requires run and phase identity`, async (t) => {
    if (skip) return t.skip("node:sqlite unavailable");
    await withStore(options, async (store) => {
      await assert.rejects(
        store.claimCursor("cursor-ghost", 0),
        (error) =>
          error instanceof OrchestrationStoreError && /runId\/phaseId required/.test(error.message),
      );
      const claim = await store.claimCursor("cursor-ghost", 0, {
        runId: "run-ghost",
        phaseId: "phase-ghost",
      });
      assert.equal(claim.revision, 1);
      assert.equal(claim.fencingToken, 1);
    });
  });
}

test("mode wal without node:sqlite degrades to an explicit non-durable backend", async () => {
  if (SQLITE_AVAILABLE) return;
  const store = createSqliteStore({ driver: "memory-js" });
  assert.equal(store.backend, "memory-js");
  assert.equal(store.getBackendInfo().durable, false);
  store.close();
});
