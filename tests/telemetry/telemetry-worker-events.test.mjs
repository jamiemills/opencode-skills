"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSchemaValidator, digest, parseJson } from "../../lib/schema-runtime/index.mjs";
import {
  TELEMETRY_EVENT_SCHEMA_ID,
  TELEMETRY_EVENT_SCHEMA_ID_V2,
  REDACTED_VALUE,
  createTelemetryEmitter,
} from "../../csm-orchestrate/lib/telemetry.mjs";

const RUN_ID = "run-worker-telemetry-1";
const CONFIG_DIGEST = digest({ config: "worker" });
const schema = parseJson(
  await readFile(
    new URL("../../csm-orchestrate/schemas/telemetry-event.v2.schema.json", import.meta.url),
    "utf8",
  ),
);
const validator = createSchemaValidator({ schemas: [schema] });

function emitter() {
  return createTelemetryEmitter({
    runId: RUN_ID,
    effectiveConfigDigest: CONFIG_DIGEST,
    now: "2026-09-12T00:00:00.000Z",
  });
}

test("worker lifecycle events emit under the v2 schema with task/worker/invocation/tool correlation", () => {
  const source = emitter();
  const event = source.emit({
    eventType: "worker.started",
    taskId: "task-build-1",
    workerId: "worker-build-1",
    invocationId: "invocation-build-1",
    toolId: "tool-npm-install",
    childRunId: "run-child-1",
    attempt: 1,
    payload: { skill: "csm-build" },
  });
  assert.equal(event.schema, TELEMETRY_EVENT_SCHEMA_ID_V2);
  assert.equal(event.taskId, "task-build-1");
  assert.equal(event.workerId, "worker-build-1");
  assert.equal(event.invocationId, "invocation-build-1");
  assert.equal(event.toolId, "tool-npm-install");
  assert.equal(validator.validate(TELEMETRY_EVENT_SCHEMA_ID_V2, event).valid, true);
});

test("v1 lifecycle events are unchanged and stay on the v1 schema", () => {
  const source = emitter();
  const event = source.emit({ eventType: "dispatch", childRunId: "run-child-1" });
  assert.equal(event.schema, TELEMETRY_EVENT_SCHEMA_ID);
  assert.equal(Object.hasOwn(event, "taskId"), false);
  assert.equal(Object.hasOwn(event, "workerId"), false);
});

test("worker events without correlation ids validate with null coordinates", () => {
  const source = emitter();
  const event = source.emit({ eventType: "worker.heartbeat" });
  assert.equal(event.schema, TELEMETRY_EVENT_SCHEMA_ID_V2);
  assert.equal(event.taskId, null);
  assert.equal(event.workerId, null);
  assert.equal(validator.validate(TELEMETRY_EVENT_SCHEMA_ID_V2, event).valid, true);
});

test("worker events reject malformed correlation ids and still redact payloads", () => {
  const source = emitter();
  assert.throws(
    () => source.emit({ eventType: "worker.started", workerId: "not-a-worker-id" }),
    /workerId/,
  );
  const event = source.emit({
    eventType: "worker.progress",
    workerId: "worker-build-1",
    payload: { authorization: "Bearer secret", percent: 40 },
  });
  assert.equal(event.payload.authorization, REDACTED_VALUE);
  assert.equal(event.payload.percent, 40);
});
