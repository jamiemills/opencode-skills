import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompatibilityRuntime } from "../lib/compatibility-runtime/index.mjs";
import { createSchemaValidator, digest } from "../lib/schema-runtime/index.mjs";

const oldSchema = {
  $id: "test-record/1",
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};
const newSchema = {
  $id: "test-record/2",
  type: "object",
  properties: { value: { type: "string" }, label: { type: "string" } },
  required: ["value", "label"],
  additionalProperties: false,
};
const validator = createSchemaValidator({ schemas: [oldSchema, newSchema] });
const schemaRegistry = {
  resolve(schema, revision) {
    const id = `${schema}/${revision}`;
    if (![oldSchema.$id, newSchema.$id].includes(id))
      throw new RangeError("unknown schema revision");
    return { id, revision };
  },
  validate(id, value) {
    return validator.validate(id, value);
  },
};
const matrix = {
  format: "csm-compatibility-matrix/1",
  policy: "unknown revisions fail closed; incompatible revisions require an explicit adapter",
  schemaDiffPolicy: {
    same: "matrix-entry-required",
    additive: "matrix-entry-required",
    breaking: "explicit-adapter-required",
  },
  entries: [
    {
      schema: "test-record",
      producerRevision: 1,
      consumerRevision: 2,
      status: "incompatible",
      adapter: "record-forward",
    },
    {
      schema: "test-record",
      producerRevision: 2,
      consumerRevision: 1,
      status: "incompatible",
      adapter: "record-backward",
    },
  ],
  adapters: ["record-forward", "record-backward"],
};
const runtime = createCompatibilityRuntime({
  schemaRegistry,
  matrix,
  adapters: [
    {
      id: "record-forward",
      version: "1.0.0",
      schema: "test-record",
      sourceRevision: 1,
      targetRevision: 2,
      transform: (record) => ({ ...record, label: "legacy" }),
    },
    {
      id: "record-backward",
      version: "1.0.0",
      schema: "test-record",
      sourceRevision: 2,
      targetRevision: 1,
      transform: (record) => ({ value: record.value }),
    },
  ],
});

test("old to new replay uses an explicit adapter and preserves digest provenance", () => {
  const old = { value: "hello" };
  const result = runtime.replay({
    schema: "test-record",
    producerRevision: 1,
    consumerRevision: 2,
    value: old,
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.value, { value: "hello", label: "legacy" });
  assert.equal(result.provenance.sourceDigest, digest(old));
  assert.equal(result.provenance.sourceSchema, "test-record");
  assert.equal(result.provenance.sourceSchemaId, "test-record/1");
  assert.equal(result.provenance.sourceRevision, 1);
  assert.equal(result.provenance.targetSchemaId, "test-record/2");
  assert.equal(result.provenance.targetRevision, 2);
  assert.equal(result.provenance.adapterId, "record-forward");
  assert.equal(result.provenance.adapterVersion, "1.0.0");
  assert.deepEqual(result.provenance.adapter, { id: "record-forward", version: "1.0.0" });
});

test("new to old replay is independently testable", () => {
  const result = runtime.replay({
    schema: "test-record",
    producerRevision: 2,
    consumerRevision: 1,
    value: { value: "hello", label: "current" },
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.value, { value: "hello" });
  assert.equal(result.provenance.adapterId, "record-backward");
});

test("malformed adapter output is quarantined and batch replay does not cut over", () => {
  const unsafe = createCompatibilityRuntime({
    schemaRegistry,
    matrix,
    adapters: [
      {
        id: "record-forward",
        version: "1.0.0",
        schema: "test-record",
        sourceRevision: 1,
        targetRevision: 2,
        transform: () => ({ value: "missing-label" }),
      },
      {
        id: "record-backward",
        version: "1.0.0",
        schema: "test-record",
        sourceRevision: 2,
        targetRevision: 1,
        transform: () => ({ value: "ok" }),
      },
    ],
  });
  const replay = unsafe.replayBatch([
    { schema: "test-record", producerRevision: 1, consumerRevision: 2, value: { value: "hello" } },
    {
      schema: "test-record",
      producerRevision: 2,
      consumerRevision: 1,
      value: { value: "hello", label: "current" },
    },
  ]);
  assert.equal(replay.status, "quarantined");
  assert.equal(replay.cutover, false);
  assert.deepEqual(replay.outputs, []);
  assert.equal(replay.quarantine.length, 1);
});

test("thrown null adapter values are safely quarantined", () => {
  const unsafe = createCompatibilityRuntime({
    schemaRegistry,
    matrix,
    adapters: [
      {
        id: "record-forward",
        version: "1.0.0",
        schema: "test-record",
        sourceRevision: 1,
        targetRevision: 2,
        transform: () => {
          throw null;
        },
      },
      {
        id: "record-backward",
        version: "1.0.0",
        schema: "test-record",
        sourceRevision: 2,
        targetRevision: 1,
        transform: (record) => ({ value: record.value }),
      },
    ],
  });
  const result = unsafe.replay({
    schema: "test-record",
    producerRevision: 1,
    consumerRevision: 2,
    value: { value: "hello" },
  });
  assert.equal(result.status, "quarantined");
  assert.equal(result.quarantine.code, "replay-failed");
  assert.equal(result.quarantine.message, "replay failed with thrown null");
});

test("malformed batch records are quarantined instead of throwing", () => {
  const replay = runtime.replayBatch([
    null,
    "primitive",
    42,
    { schema: "test-record", producerRevision: 1, consumerRevision: 2 },
    { schema: "test-record", producerRevision: 1, value: { value: "missing-target" } },
  ]);
  assert.equal(replay.status, "quarantined");
  assert.equal(replay.cutover, false);
  assert.deepEqual(replay.outputs, []);
  assert.equal(replay.quarantine.length, 5);
});

test("non-array batch containers are quarantined instead of throwing", () => {
  for (const records of [null, {}, "records"]) {
    const replay = runtime.replayBatch(records);
    assert.equal(replay.status, "quarantined");
    assert.equal(replay.cutover, false);
    assert.deepEqual(replay.outputs, []);
    assert.equal(replay.quarantine.length, 1);
    assert.equal(replay.quarantine[0].status, "quarantined");
  }
});

test("accepted provenance and exposed dispatch snapshots are immutable", () => {
  const result = runtime.replay({
    schema: "test-record",
    producerRevision: 1,
    consumerRevision: 2,
    value: { value: "hello" },
  });
  assert.equal(Object.isFrozen(result.provenance), true);
  assert.equal(Object.isFrozen(result.provenance.adapter), true);
  assert.throws(() => {
    result.provenance.adapterVersion = "tampered";
  }, TypeError);
  assert.equal(result.provenance.adapterVersion, "1.0.0");

  assert.equal(Object.isFrozen(runtime.matrix), true);
  assert.equal(Object.isFrozen(runtime.matrix.entries), true);
  assert.equal(Object.isFrozen(runtime.matrix.entries[0]), true);
  assert.equal(Object.isFrozen(runtime.adapters), true);
  assert.equal(Object.isFrozen(runtime.adapters[0]), true);
  const plan = runtime.negotiate("test-record", 1, 2);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.adapter), true);
  assert.throws(() => {
    plan.adapter.version = "tampered";
  }, TypeError);
  assert.throws(() => {
    runtime.matrix.entries[0].status = "compatible";
  }, TypeError);
  assert.throws(() => {
    runtime.adapters.push({ id: "tampered" });
  }, TypeError);
});

test("adapter descriptors are snapshotted at registration", () => {
  const adapter = {
    id: "record-forward",
    version: "1.0.0",
    schema: "test-record",
    sourceRevision: 1,
    targetRevision: 2,
    transform: (record) => ({ ...record, label: "legacy" }),
  };
  const isolated = createCompatibilityRuntime({
    schemaRegistry,
    matrix: {
      ...matrix,
      entries: matrix.entries.filter((entry) => entry.adapter === "record-forward"),
      adapters: ["record-forward"],
    },
    adapters: [adapter],
  });
  adapter.version = "9.9.9";
  adapter.schema = "other-record";
  adapter.sourceRevision = 2;
  adapter.transform = () => ({ value: "tampered" });
  const result = isolated.replay({
    schema: "test-record",
    producerRevision: 1,
    consumerRevision: 2,
    value: { value: "hello" },
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.provenance.adapterId, "record-forward");
  assert.equal(result.provenance.adapterVersion, "1.0.0");
  assert.deepEqual(result.value, { value: "hello", label: "legacy" });
});
