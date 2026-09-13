"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSchemaValidator, digest, parseJson } from "../lib/schema-runtime/index.mjs";
import {
  createJsonlTransport,
  createTelemetryEmitter,
  sequenceHighWaterMark,
} from "../csm-orchestrate/lib/telemetry.mjs";
import { createWorkerStateReducer, foldWorkerState } from "../csm-orchestrate/lib/worker-state.mjs";

const RUN_ID = "run-worker-state-1";
const CONFIG_DIGEST = digest({ config: "worker-state" });
const projectionSchema = parseJson(
  await readFile(
    new URL("../csm-orchestrate/schemas/csm-worker-projection.schema.json", import.meta.url),
    "utf8",
  ),
);
const validator = createSchemaValidator({ schemas: [projectionSchema] });

const emitter = (transport) =>
  createTelemetryEmitter({ runId: RUN_ID, effectiveConfigDigest: CONFIG_DIGEST, transport });

test("idempotent worker events dedupe on logicalKey across a simulated resume", () => {
  const first = emitter().emit({
    eventType: "worker.completed",
    workerId: "worker-build-1",
    taskId: "task-build-1",
    attempt: 1,
  });
  const second = emitter().emit({
    eventType: "worker.completed",
    workerId: "worker-build-1",
    taskId: "task-build-1",
    attempt: 1,
  });
  assert.equal(first.logicalKey, second.logicalKey);
  const state = foldWorkerState([first, second]);
  assert.equal(state.workers.length, 1);
  assert.equal(state.workers[0].state, "completed");
  assert.equal(state.aggregate.completed, 1);
  assert.equal(validator.validate("csm-worker-projection/1", state).valid, true);
});

test("high-frequency heartbeat/progress events are observational and never deduped", () => {
  const source = emitter();
  const a = source.emit({
    eventType: "worker.heartbeat",
    workerId: "worker-build-1",
    timestamp: "2026-09-12T00:00:01.000Z",
  });
  const b = source.emit({
    eventType: "worker.heartbeat",
    workerId: "worker-build-1",
    timestamp: "2026-09-12T00:00:05.000Z",
  });
  assert.equal(a.logicalKey, null);
  assert.equal(b.logicalKey, null);
  const state = foldWorkerState([a, b], { now: "2026-09-12T00:00:10.000Z" });
  assert.equal(state.workers.length, 1);
  assert.equal(state.workers[0].heartbeatAgeMs, 5000);
});

test("sequence rehydration adopts the persisted high-water mark across a resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csm-worker-state-"));
  const file = join(directory, "telemetry.jsonl");
  try {
    const first = createJsonlTransport(file);
    const a = emitter(first);
    a.emit({ eventType: "dispatch", childRunId: "run-child-1" });
    a.emit({ eventType: "worker.started", workerId: "worker-build-1" });
    await a.flush();

    const rows = await createJsonlTransport(file).list();
    assert.equal(sequenceHighWaterMark(rows), 2);

    const resumed = emitter(createJsonlTransport(file));
    assert.equal(await resumed.rehydrate(), 2);
    const next = resumed.emit({ eventType: "worker.completed", workerId: "worker-build-1" });
    assert.equal(next.sequence, 3);
    await resumed.flush();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the reducer folds an appended suffix incrementally and matches a full fold", () => {
  const source = emitter();
  const events = [
    source.emit({
      eventType: "worker.started",
      workerId: "worker-build-1",
      taskId: "task-build-1",
    }),
    source.emit({
      eventType: "worker.progress",
      workerId: "worker-build-1",
      payload: { activity: "install" },
    }),
  ];
  const FIXED = "2026-09-12T00:00:10.000Z";
  const reducer = createWorkerStateReducer();
  const partial = reducer.applyEvents(events, { now: FIXED });
  assert.equal(partial.workers[0].state, "running");
  events.push(
    source.emit({
      eventType: "worker.completed",
      workerId: "worker-build-1",
      taskId: "task-build-1",
    }),
  );
  const incremental = reducer.applyEvents(events, { now: FIXED });
  const full = foldWorkerState(events, { now: FIXED });
  assert.deepEqual(incremental.workers, full.workers);
  assert.equal(incremental.workers[0].state, "completed");
});
