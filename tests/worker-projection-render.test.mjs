"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import { createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";
import { foldWorkerState } from "../csm-orchestrate/lib/worker-state.mjs";
import { projectWorkerTable } from "../csm-orchestrate/output/projection.mjs";

const emitter = () =>
  createTelemetryEmitter({
    runId: "run-worker-render-1",
    effectiveConfigDigest: digest({ config: "render" }),
  });

function folded() {
  const source = emitter();
  return foldWorkerState([
    source.emit({
      eventType: "worker.started",
      workerId: "worker-build-1",
      taskId: "task-build-1",
      payload: { skill: "csm-build" },
    }),
    source.emit({
      eventType: "worker.progress",
      workerId: "worker-build-1",
      payload: { activity: "install" },
    }),
    source.emit({
      eventType: "worker.completed",
      workerId: "worker-build-1",
      taskId: "task-build-1",
      payload: { skill: "csm-build" },
    }),
    source.emit({
      eventType: "worker.failed",
      workerId: "worker-review-1",
      taskId: "task-review-1",
      payload: { skill: "csm-review" },
    }),
  ]);
}

test("worker table renders rows and an aggregate summary from the folded state", () => {
  const rendered = projectWorkerTable(folded());
  assert.equal(rendered.rows.length, 2);
  assert.equal(rendered.aggregate.completed, 1);
  assert.equal(rendered.aggregate.failed, 1);
  assert.match(rendered.text, /worker-build-1/);
  assert.match(rendered.text, /worker-review-1/);
  assert.match(rendered.text, /WORKERS  total=2 running=0 completed=1 failed=1/);
});

test("worker table is pure presentation and carries no acceptance authority fields", () => {
  const rendered = projectWorkerTable(folded());
  const serialized = JSON.stringify(rendered);
  for (const field of ["receiptId", "cursorId", "fencingToken", "terminalReceipt", "verified"])
    assert.equal(serialized.includes(field), false, `renderer must not emit ${field}`);
});

test("worker table rejects non-canonical input", () => {
  assert.throws(() => projectWorkerTable("TASK PROGRESS [####] 100%"), /canonical JSON/);
  assert.throws(
    () => projectWorkerTable({ schema: "csm-progress/1", workers: [] }),
    /csm-worker-projection\/1/,
  );
});
