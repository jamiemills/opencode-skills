"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSchemaValidator, digest } from "../../lib/schema-runtime/index.mjs";
import { readJsonLines } from "../../lib/durable-json/index.mjs";
import {
  DEFAULT_REDACT_KEYS,
  REDACTED_VALUE,
  TELEMETRY_EVENT_SCHEMA_ID,
  TELEMETRY_EVENT_TYPES,
  createJsonlTransport,
  createMemoryTransport,
  createTelemetryEmitter,
  redactPayload,
  repairTelemetryJsonlTail,
} from "../../csm-orchestrate/lib/telemetry.mjs";
import { loadSchema } from "../host-assurance/helpers.mjs";

const RUN_ID = "run-telemetry-correlated-1";
const CONFIG_DIGEST = digest({ config: "effective" });
const FIXED_NOW = "2026-08-28T00:00:00.000Z";

function emitter(overrides = {}) {
  return createTelemetryEmitter({
    runId: RUN_ID,
    effectiveConfigDigest: CONFIG_DIGEST,
    now: FIXED_NOW,
    ...overrides,
  });
}

test("telemetry: emit assigns canonical ids, monotonic sequences, and coordinates", () => {
  const source = emitter();
  const first = source.emit({ eventType: "dispatch", childRunId: "run-child-1", attempt: 1 });
  const second = source.emit({
    eventType: "retry",
    phaseId: "phase-p1",
    edgeId: "edge-p1-out",
    childRunId: "run-child-1",
    attempt: 2,
    payload: { reason: "timeout-uncertain" },
  });
  assert.equal(first.schema, TELEMETRY_EVENT_SCHEMA_ID);
  assert.ok(first.eventId.startsWith("evt-"));
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(first.runId, RUN_ID);
  assert.equal(first.childRunId, "run-child-1");
  assert.equal(second.phaseId, "phase-p1");
  assert.equal(first.attempt, 1);
  assert.equal(first.timestamp, FIXED_NOW);
  assert.equal(first.effectiveConfigDigest, CONFIG_DIGEST);
  assert.equal(first.fencingToken, null);
  assert.equal(second.payload.reason, "timeout-uncertain");
  assert.ok(Object.isFrozen(first));
});

test("telemetry: invalid events and unsupported types fail closed", () => {
  const source = emitter();
  assert.throws(() => source.emit({ eventType: "not-a-type" }), /unsupported telemetry event type/);
  assert.throws(() => source.emit({ eventType: "dispatch", runId: "bad" }), /runId/);
  assert.throws(
    () => source.emit({ eventType: "dispatch", effectiveConfigDigest: "sha256:x" }),
    /effectiveConfigDigest/,
  );
  assert.throws(() => source.emit({ eventType: "dispatch", attempt: -1 }), /attempt/);
  assert.throws(() => source.emit({ eventType: "dispatch", fencingToken: 0 }), /fencingToken/);
  assert.throws(() => source.emit({ eventType: "dispatch", payload: [] }), /payload/);
  assert.throws(() => emitter({ runId: "nope" }), /runId/);
});

test("telemetry: events correlate by run, child, phase, and type filters", () => {
  const source = emitter();
  source.emit({ eventType: "dispatch", childRunId: "run-child-1", attempt: 1 });
  source.emit({ eventType: "timeout", childRunId: "run-child-1", attempt: 1 });
  source.emit({ eventType: "dispatch", childRunId: "run-child-2", attempt: 1 });
  assert.equal(source.getEvents({ runId: RUN_ID }).length, 3);
  assert.equal(source.getEvents({ childRunId: "run-child-1" }).length, 2);
  assert.equal(source.getEvents({ eventType: "dispatch" }).length, 2);
  assert.deepEqual(
    source
      .getEvents({ childRunId: "run-child-1", eventType: "timeout" })
      .map((event) => event.attempt),
    [1],
  );
});

test("telemetry: every lifecycle event type is emittable", () => {
  const source = emitter();
  let index = 0;
  for (const eventType of TELEMETRY_EVENT_TYPES) {
    index += 1;
    const event = source.emit({ eventType, payload: { step: index } });
    assert.equal(event.eventType, eventType);
    assert.equal(event.sequence, index);
  }
  assert.equal(index, TELEMETRY_EVENT_TYPES.length);
});

test("telemetry: completeness — every terminal receipt needs a correlated terminal event", () => {
  const source = emitter();
  const receipt = source.recordTerminalReceipt({
    receiptId: "receipt-terminal-1",
    runId: RUN_ID,
    childRunId: "run-child-1",
  });
  const before = source.checkCompleteness();
  assert.equal(before.complete, false);
  assert.equal(before.total, 1);
  assert.equal(before.correlated, 0);
  assert.deepEqual(before.missing, [{ receiptId: "receipt-terminal-1", runId: RUN_ID }]);
  source.emit({
    eventType: "terminal",
    childRunId: "run-child-1",
    payload: { receiptId: "receipt-terminal-1", status: "completed" },
  });
  const after = source.checkCompleteness();
  assert.equal(after.complete, true);
  assert.equal(after.correlated, 1);
  assert.deepEqual(after.missing, []);
  assert.ok(receipt.receiptId);
  const external = source.checkCompleteness([{ receiptId: "receipt-external-9", runId: RUN_ID }]);
  assert.equal(external.complete, false);
  assert.equal(external.missing[0].receiptId, "receipt-external-9");
});

test("telemetry: a terminal event for another receipt does not complete the run", () => {
  const source = emitter();
  source.recordTerminalReceipt({ receiptId: "receipt-a", runId: RUN_ID });
  source.emit({
    eventType: "terminal",
    payload: { receiptId: "receipt-b", status: "completed" },
  });
  const result = source.checkCompleteness();
  assert.equal(result.complete, false);
  assert.equal(result.correlated, 0);
});

test("telemetry: loss detection reports dropped sequences", () => {
  const memory = createMemoryTransport();
  const dropping = {
    write(event) {
      if (event.eventType !== "review") memory.write(event);
    },
    list: () => memory.list(),
  };
  const source = emitter({ transport: dropping });
  source.emit({ eventType: "dispatch", childRunId: "run-child-1" });
  source.emit({ eventType: "review", childRunId: "run-child-1" });
  source.emit({ eventType: "cursor", phaseId: "phase-p1" });
  const loss = source.detectLoss();
  assert.equal(loss.lost, true);
  assert.equal(loss.emittedCount, 3);
  assert.equal(loss.observedCount, 2);
  assert.deepEqual(loss.missingSequences, [2]);
  const report = source.emit({
    eventType: "telemetry_loss",
    payload: { missingSequences: loss.missingSequences },
  });
  assert.equal(report.eventType, "telemetry_loss");
  assert.deepEqual(report.payload.missingSequences, [2]);
});

test("telemetry: detectLoss is clean without drops", () => {
  const source = emitter();
  source.emit({ eventType: "dispatch" });
  source.emit({ eventType: "terminal", payload: { receiptId: "receipt-terminal-1" } });
  const loss = source.detectLoss();
  assert.equal(loss.lost, false);
  assert.deepEqual(loss.missingSequences, []);
  assert.equal(loss.emittedCount, loss.observedCount);
});

test("telemetry: sensitive payload keys are redacted recursively", () => {
  assert.equal(DEFAULT_REDACT_KEYS.length > 0, true);
  const redacted = redactPayload({
    apiToken: "raw-token-value",
    nested: { secret: "raw-secret-value", keep: "visible", apiKey: "raw-key" },
    items: [{ password: "raw-password" }],
  });
  assert.equal(redacted.apiToken, REDACTED_VALUE);
  assert.equal(redacted.nested.secret, REDACTED_VALUE);
  assert.equal(redacted.nested.keep, "visible");
  assert.equal(redacted.nested.apiKey, REDACTED_VALUE);
  assert.equal(redacted.items[0].password, REDACTED_VALUE);
  const source = emitter();
  const event = source.emit({
    eventType: "approval",
    payload: { authorization: "Bearer raw-bearer-secret", hint: "Bearer visible-note" },
  });
  assert.equal(event.payload.authorization, REDACTED_VALUE);
  assert.equal(event.payload.hint, "Bearer visible-note");
  assert.ok(!JSON.stringify(source.getEvents()).includes("raw-bearer-secret"));
});

test("telemetry: custom redaction key families are honored", () => {
  const source = emitter({ redactKeys: ["internalNote"] });
  const event = source.emit({
    eventType: "review",
    payload: { internalNote: "raw-note", apiToken: "raw-token-value" },
  });
  assert.equal(event.payload.internalNote, REDACTED_VALUE);
  assert.equal(event.payload.apiToken, "raw-token-value");
});

test("telemetry: emitted events validate against the registered schema", async () => {
  const schema = await loadSchema("telemetry-event.schema.json");
  const validator = createSchemaValidator({ schemas: [schema] });
  const source = emitter();
  source.emit({ eventType: "dispatch", childRunId: "run-child-1", fencingToken: 3 });
  source.emit({ eventType: "telemetry_loss", payload: { missingSequences: [] } });
  for (const event of source.getEvents()) {
    const result = validator.validate(TELEMETRY_EVENT_SCHEMA_ID, event);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
  const broken = {
    schema: TELEMETRY_EVENT_SCHEMA_ID,
    eventId: "evt-x",
    sequence: 0,
    runId: RUN_ID,
    eventType: "dispatch",
    timestamp: FIXED_NOW,
    attempt: 0,
    payload: {},
    effectiveConfigDigest: CONFIG_DIGEST,
    fencingToken: null,
    extra: true,
  };
  assert.equal(validator.validate(TELEMETRY_EVENT_SCHEMA_ID, broken).valid, false);
});

test("telemetry: jsonl transport recovers torn tails and reports them without throwing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telemetry-torn-"));
  const path = join(directory, "telemetry.jsonl");
  await writeFile(path, '{"sequence":1,"ok":true}\n{"sequence":2,"ok":true');
  const transport = createJsonlTransport(path);
  const records = await transport.list();
  assert.deepEqual(records, [{ sequence: 1, ok: true }]);
  assert.deepEqual(transport.partialTails, ['{"sequence":2,"ok":true']);
  const missing = createJsonlTransport(join(directory, "never-written.jsonl"));
  assert.deepEqual(await missing.list(), [], "a never-written file reads as an empty list");
});

test("telemetry: repairTelemetryJsonlTail quarantines the torn tail and rewrites clean", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telemetry-repair-"));
  const path = join(directory, "telemetry.jsonl");
  const torn = '{"sequence":1}\n{"sequence":2}\n{"sequence":3';
  await writeFile(path, torn);
  const result = await repairTelemetryJsonlTail(path);
  assert.equal(result.repaired, true);
  assert.ok(result.quarantinedPath.endsWith(".quarantine"));
  assert.equal(await readFile(result.quarantinedPath, "utf8"), '{"sequence":3');
  assert.deepEqual(await readJsonLines(path), [{ sequence: 1 }, { sequence: 2 }]);
  assert.equal((await repairTelemetryJsonlTail(path)).repaired, false, "clean file is a no-op");
  assert.equal(
    (await repairTelemetryJsonlTail(join(directory, "absent.jsonl"))).repaired,
    false,
    "missing file is a no-op",
  );
});
