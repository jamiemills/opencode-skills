import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import matrix from "../schemas/compatibility-matrix.json" with { type: "json" };
import {
  createCompatibilityRuntime,
  validateCompatibilityMatrix,
  classifySchemaDiff,
} from "../lib/compatibility-runtime/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const schemaRegistry = await loadSchemaRegistry();
const compatibility = createCompatibilityRuntime({ schemaRegistry, matrix });

test("registered exact same-revision pairs are compatible only through the matrix", () => {
  const result = compatibility.negotiate("csm-envelope", 1, 1);
  assert.equal(result.mode, "direct");
  assert.equal(result.status, "compatible");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.adapter), true);
  assert.throws(() => {
    result.mode = "adapter";
  }, TypeError);
  assert.throws(() => compatibility.negotiate("csm-envelope", 1, 2), /unknown schema revision/);
  const withoutEnvelope = createCompatibilityRuntime({
    schemaRegistry,
    matrix: {
      ...matrix,
      entries: matrix.entries.filter((entry) => entry.schema !== "csm-envelope"),
    },
  });
  assert.throws(
    () => withoutEnvelope.negotiate("csm-envelope", 1, 1),
    /unregistered compatibility pair/,
  );
});

test("unregistered legacy trace, manifest, and verification revisions fail closed", () => {
  for (const schema of ["csm-trace", "csm-skill-manifest", "csm-verification-status"])
    assert.throws(() => compatibility.negotiate(schema, 1, 1), /unknown schema revision/);
});

test("malformed matrices and adapters fail closed", () => {
  assert.throws(
    () =>
      validateCompatibilityMatrix({
        ...matrix,
        entries: [{ ...matrix.entries[0], status: "maybe" }],
      }),
    /status/,
  );
  assert.throws(
    () =>
      createCompatibilityRuntime({
        schemaRegistry,
        matrix: {
          ...matrix,
          entries: [
            {
              schema: "csm-envelope",
              producerRevision: 1,
              consumerRevision: 2,
              status: "incompatible",
              adapter: "missing",
            },
          ],
        },
      }),
    /unregistered adapter/,
  );
  assert.throws(
    () =>
      createCompatibilityRuntime({
        schemaRegistry,
        matrix,
        adapters: [
          { id: "bad", version: "1", schema: "csm-envelope", sourceRevision: 1, targetRevision: 2 },
        ],
      }),
    /transform function/,
  );
});

test("schema diff policy distinguishes additive changes from breaking changes", () => {
  const oldSchema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  };
  const additive = {
    ...oldSchema,
    properties: { ...oldSchema.properties, note: { type: "string" } },
  };
  const breaking = { ...additive, required: ["value", "note"] };
  assert.equal(classifySchemaDiff(oldSchema, additive), "additive");
  assert.equal(classifySchemaDiff(oldSchema, breaking), "breaking");
});

test("schema diff treats structural keyword changes as breaking", () => {
  const oldSchema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  };
  for (const change of [
    { additionalProperties: false },
    { patternProperties: { "^x-": { type: "string" } } },
    { unevaluatedProperties: false },
    { properties: { value: { type: "string", minLength: 2 } } },
    { $defs: { value: { type: "string" } } },
    { anyOf: [{ required: ["value"] }, { required: ["other"] }] },
  ]) {
    assert.equal(classifySchemaDiff(oldSchema, { ...oldSchema, ...change }), "breaking");
  }
  assert.equal(classifySchemaDiff(oldSchema, { ...oldSchema, title: "renamed" }), "same");
  assert.equal(classifySchemaDiff(oldSchema, oldSchema), "same");
});

test("the supported old fixture is a valid registered artifact", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/compatibility/valid-old-record.json", import.meta.url)),
  );
  assert.equal(schemaRegistry.validate("csm-artifact/1", fixture).valid, true);
});
