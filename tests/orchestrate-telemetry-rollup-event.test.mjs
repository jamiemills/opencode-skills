"use strict";

// T001 verification: the skill-progress-rollup telemetry event type is
// registered in TELEMETRY_EVENT_TYPES and the telemetry-event schema, so
// rollup events emit successfully and validate against the registry.
import assert from "node:assert/strict";
import test from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import {
  TELEMETRY_EVENT_TYPES,
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";

const CONFIG = "sha256:" + "f".repeat(64);

test("skill-progress-rollup is a registered telemetry event type", () => {
  assert.ok(TELEMETRY_EVENT_TYPES.includes("skill-progress-rollup"));
});

test("a skill-progress-rollup event emits and validates against the registry", async () => {
  const events = [];
  const emitter = createTelemetryEmitter({
    transport: createMemoryTransport(),
    runId: "run-rollup-event-check",
    effectiveConfigDigest: CONFIG,
  });
  const emitted = emitter.emit({
    eventType: "skill-progress-rollup",
    phaseId: "phase-rollup-check-p1",
    edgeId: "edge-node-p1-csm-scan",
    childRunId: "run-rollup-check-child",
    payload: { fraction: 0.4, evidenceRef: "skill-progress:progress-x@3" },
  });
  assert.equal(emitted.eventType, "skill-progress-rollup");
  events.push(emitted);

  const registry = await loadSchemaRegistry();
  const result = registry.validate("csm-orchestrate-telemetry-event/1", emitted);
  assert.equal(result.valid, true, JSON.stringify(result.errors ?? []));
  assert.equal(events.length, 1);
});
