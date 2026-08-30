"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateProgress,
  appendProgressItems,
  createProgressDocument,
  createProgressTracker,
  itemForNode,
  updateProgress,
  validateProgressDocument,
} from "../csm-orchestrate/lib/progress.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import {
  createSqliteStore,
  resolveSqliteDriver,
  CasMismatchError,
  StaleFenceError,
} from "../lib/orchestration-store/index.mjs";

const phase = { phaseId: "phase-progress", graphRevision: 1, routeNodes: [] };
const node = { nodeId: "node-progress", skill: "csm-build" };
const item = itemForNode({ runId: "run-progress", graphRevision: 1, phase, node });

test("progress lifecycle keeps one logical item across activation, retry, and verification", () => {
  let document = createProgressDocument({ runId: "run-progress", items: [item] });
  document = updateProgress(document, item.itemId, {
    state: "active",
    childRunId: "run-child-progress",
    attempt: 1,
  });
  document = updateProgress(document, item.itemId, {
    state: "active",
    childRunId: "run-child-progress-retry",
    attempt: 2,
  });
  document = updateProgress(document, item.itemId, {
    state: "verified",
    verifiedFraction: 1,
    evidenceRefs: ["ev-progress"],
  });
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0].attempt, 2);
  assert.equal(document.aggregate.plannedProgress, 1);
  assert.equal(document.aggregate.observedWork, 1);
});

test("parallel updates preserve siblings through serialized tracker writes", async () => {
  const second = itemForNode({
    runId: "run-progress",
    graphRevision: 1,
    phase,
    node: { nodeId: "node-progress-two", skill: "csm-build" },
  });
  const tracker = createProgressTracker({ runId: "run-progress" });
  await tracker.materialize([
    { ...phase, routeNodes: [node, { nodeId: "node-progress-two", skill: "csm-build" }] },
  ]);
  await Promise.all([
    tracker.update(item.itemId, { state: "active" }),
    tracker.update(second.itemId, { state: "active" }),
  ]);
  assert.deepEqual(
    tracker.snapshot.items.map((entry) => entry.state),
    ["active", "active"],
  );
});

test("blocked, incomplete, and empty routes remain distinct", () => {
  const blocked = updateProgress(
    createProgressDocument({ runId: "run-progress", items: [item] }),
    item.itemId,
    { state: "blocked", blocker: { code: "APPROVAL", message: "approval required" } },
  );
  const incomplete = updateProgress(
    createProgressDocument({ runId: "run-progress", items: [item] }),
    item.itemId,
    { state: "incomplete" },
  );
  assert.equal(blocked.aggregate.outcome, "blocked");
  assert.equal(incomplete.aggregate.outcome, "incomplete");
  assert.equal(aggregateProgress([]).outcome, "indeterminate");
});

test("remediation appends work while preserving graph revision lineage", () => {
  const document = createProgressDocument({
    runId: "run-progress",
    graphRevision: 1,
    items: [item],
  });
  const remediation = itemForNode({
    runId: "run-progress",
    graphRevision: 2,
    phase: { phaseId: "phase-remediation", graphRevision: 2 },
    node: { nodeId: "node-remediation", skill: "csm-review" },
  });
  const next = appendProgressItems(document, [remediation], { graphRevision: 2 });
  assert.equal(next.graphRevision, 2);
  assert.equal(next.items.length, 2);
  assert.equal(next.items[0].phaseId, "phase-progress");
  assert.equal(next.items[1].phaseId, "phase-remediation");
});

test("progress snapshots use independent CAS/fencing and survive SQLite reopen", async (t) => {
  if (!resolveSqliteDriver().available) return t.skip("node:sqlite unavailable");
  const dir = await mkdtemp(join(tmpdir(), "progress-runtime-"));
  const path = join(dir, "progress.db");
  try {
    const store = createSqliteStore({ databasePath: path, mode: "wal" });
    const first = createProgressDocument({ runId: "run-progress", items: [item], revision: 1 });
    await store.saveProgress(first, { expectedRevision: 0, fencingToken: 1 });
    await assert.rejects(
      store.saveProgress({ ...first, revision: 2 }, { expectedRevision: 0 }),
      CasMismatchError,
    );
    await assert.rejects(
      store.saveProgress({ ...first, revision: 2 }, { expectedRevision: 1, fencingToken: 0 }),
      StaleFenceError,
    );
    store.close();
    const reopened = createSqliteStore({ databasePath: path, mode: "wal" });
    assert.deepEqual(await reopened.loadProgress(first.progressId, { fencingToken: 1 }), first);
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("receipt fields and telemetry loss do not become progress authority", () => {
  const document = createProgressDocument({
    runId: "run-progress",
    items: [item],
    eventsObserved: 99,
  });
  assert.equal(document.receiptId, undefined);
  assert.equal(document.aggregate.eventsObserved, 99);
  const active = updateProgress(document, item.itemId, { state: "active" }, { eventsObserved: 0 });
  assert.equal(active.aggregate.plannedProgress, 0);
  assert.equal(active.aggregate.eventsObserved, 0);
});

test("progress mutations do not increment telemetry observations", async () => {
  const tracker = createProgressTracker({ runId: "run-progress" });
  await tracker.materialize([{ ...phase, routeNodes: [node] }]);
  await tracker.update(item.itemId, { state: "active" });
  assert.equal(tracker.snapshot.aggregate.eventsObserved, 0);
  await tracker.observeTelemetry();
  assert.equal(tracker.snapshot.aggregate.eventsObserved, 1);
});

test("durable queued writes capture immutable snapshots and reload before materialization", async () => {
  const saved = [];
  const store = {
    async saveProgress(snapshot) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      saved.push(structuredClone(snapshot));
    },
    async loadProgress() {
      return saved.at(-1) ?? null;
    },
  };
  const tracker = createProgressTracker({ runId: "run-progress", store });
  const reloadPhase = { phaseId: "phase-progress", graphRevision: 1, routeNodes: [node] };
  await tracker.materialize([reloadPhase]);
  await Promise.all([
    tracker.update(item.itemId, { state: "active" }),
    tracker.update(item.itemId, { state: "verified" }),
  ]);
  await tracker.flush();
  assert.deepEqual(
    saved.map((entry) => entry.revision),
    [1, 2, 3],
  );
  assert.equal(saved[1].items[0].state, "active");
  assert.equal(saved[2].items[0].state, "verified");
  const reloaded = createProgressTracker({ runId: "run-progress", store });
  await reloaded.reload();
  await reloaded.materialize([reloadPhase]);
  assert.equal(reloaded.snapshot.items[0].state, "verified");
});

test("progress preserves item graph revisions, fractional work, and phase-scoped receipts", async () => {
  const first = itemForNode({ runId: "run-progress", graphRevision: 1, phase, node });
  const second = itemForNode({
    runId: "run-progress",
    graphRevision: 2,
    phase: { phaseId: "phase-next", graphRevision: 2 },
    node: { nodeId: "node-next", skill: "csm-review" },
  });
  const tracker = createProgressTracker({ runId: "run-progress", graphRevision: 1 });
  await tracker.materialize([
    { ...phase, routeNodes: [node] },
    {
      phaseId: "phase-next",
      graphRevision: 2,
      routeNodes: [{ nodeId: "node-next", skill: "csm-review" }],
    },
  ]);
  await tracker.update(first.itemId, { state: "active", verifiedFraction: 0.25 });
  await tracker.update(second.itemId, { state: "verified" });
  await tracker.associateReceipt("receipt-progress-p1", "phase-progress");
  assert.equal(
    tracker.snapshot.items.find((entry) => entry.itemId === first.itemId).receiptId,
    "receipt-progress-p1",
  );
  assert.equal(
    tracker.snapshot.items.find((entry) => entry.itemId === second.itemId).receiptId,
    null,
  );
  assert.equal(
    tracker.snapshot.items.find((entry) => entry.itemId === first.itemId).graphRevision,
    1,
  );
  assert.equal(
    tracker.snapshot.items.find((entry) => entry.itemId === second.itemId).graphRevision,
    2,
  );
  assert.equal(tracker.snapshot.aggregate.plannedProgress, 0.625);
  validateProgressDocument(tracker.snapshot);
});

test("invalid progress aggregate and stale fencing are rejected", async () => {
  const store = createSqliteStore({ mode: "memory" });
  const valid = createProgressDocument({ runId: "run-progress", items: [item], revision: 1 });
  await assert.rejects(
    store.saveProgress(
      { ...valid, aggregate: { ...valid.aggregate, plannedProgress: 1 } },
      { expectedRevision: 0, fencingToken: 1 },
    ),
    /aggregate/,
  );
  await store.saveProgress(valid, { expectedRevision: 0, fencingToken: 2 });
  await assert.rejects(
    store.saveProgress({ ...valid, revision: 2 }, { expectedRevision: 1, fencingToken: 1 }),
    StaleFenceError,
  );
  store.close();
});

test("tokenless progress writes and reloads are rejected after fencing", async () => {
  const store = createSqliteStore({ mode: "memory" });
  const valid = createProgressDocument({ runId: "run-progress", items: [item], revision: 1 });
  await store.saveProgress(valid, { expectedRevision: 0, fencingToken: 1 });
  await assert.rejects(
    store.saveProgress({ ...valid, revision: 2 }, { expectedRevision: 1 }),
    StaleFenceError,
  );
  await assert.rejects(store.loadProgress(valid.progressId), StaleFenceError);
  assert.deepEqual(await store.loadProgress(valid.progressId, { fencingToken: 1 }), valid);
  store.close();
});

test("malformed persisted progress is rejected on reload", async () => {
  const tracker = createProgressTracker({
    runId: "run-progress",
    store: {
      async loadProgress() {
        return {
          schema: "csm-progress/1",
          progressId: "progress-run-progress",
          runId: "run-progress",
        };
      },
    },
  });
  await assert.rejects(tracker.reload(), /invalid progress/);
});

test("two trackers reject stale writes, then reload and resume under a new fence", async () => {
  const store = createSqliteStore({ mode: "memory" });
  const first = createProgressTracker({ runId: "run-progress", store });
  const second = createProgressTracker({ runId: "run-progress", store });
  first.setFencingToken(1);
  await first.materialize([{ ...phase, routeNodes: [node] }]);
  second.setFencingToken(1);
  await second.reload();
  first.setFencingToken(2);
  await first.update(item.itemId, { state: "active", childRunId: "run-child-progress" });
  await assert.rejects(second.update(item.itemId, { state: "active" }), CasMismatchError);
  second.setFencingToken(2);
  await second.reload();
  await second.update(item.itemId, { state: "verified" });
  assert.equal(second.snapshot.items[0].state, "verified");
  store.close();
});

test("early orchestration exits return and persist progress snapshots", async () => {
  const saved = [];
  const store = {
    async saveProgress(snapshot) {
      saved.push(structuredClone(snapshot));
    },
    async loadProgress() {
      return saved.at(-1) ?? null;
    },
  };
  for (const options of [
    { runId: "run-early-host", cursorStore: store },
    { runId: "run-early-cursor", host: { invokeSiblingSkill() {} }, cursorStore: store },
  ]) {
    const result = await orchestrate(options);
    assert.equal(result.progress.schema, "csm-progress/1");
    assert.equal(result.progress.items.length, 0);
  }
  assert.equal(saved.length, 2);
});

test("preflight-blocked materialized progress is terminal", async () => {
  const tracker = createProgressTracker({ runId: "run-preflight-blocked" });
  await tracker.materialize([{ ...phase, routeNodes: [node] }]);
  await tracker.update(tracker.itemId(phase.phaseId, node.nodeId), {
    state: "blocked",
    blocker: { code: "AUTONOMY_PREFLIGHT", message: "autonomy preflight blocked execution" },
  });
  assert.equal(tracker.snapshot.aggregate.outcome, "blocked");
  assert.equal(tracker.snapshot.items[0].state, "blocked");
});
