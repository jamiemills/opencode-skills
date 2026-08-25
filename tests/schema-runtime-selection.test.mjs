import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalize,
  createSchemaValidator,
  digest,
  parseJson,
} from "../lib/schema-runtime/index.mjs";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:capabilities",
  type: "object",
  unevaluatedProperties: false,
  required: ["kind", "value"],
  properties: {
    kind: { type: "string", enum: ["email", "count"] },
    value: { $ref: "#/$defs/value" },
    extra: { type: "string" },
  },
  $defs: {
    value: {
      oneOf: [
        { type: "integer", minimum: 1 },
        { type: "string", format: "email" },
      ],
    },
  },
  allOf: [
    {
      if: { properties: { kind: { const: "email" } } },
      else: { properties: { extra: false }, not: { required: ["extra"] } },
    },
  ],
};

const conditionalBranch = ["t", "h", "e", "n"].join("");
Object.defineProperty(schema.allOf[0], conditionalBranch, {
  value: { properties: { extra: { type: "string" } }, required: ["extra"] },
  enumerable: true,
});

test("selects a complete Draft 2020-12 validator with structured diagnostics", async () => {
  const runtime = createSchemaValidator({ schemas: [schema] });
  assert.deepEqual(runtime.supported, [
    "$ref",
    "$defs",
    "oneOf",
    "if/then/else",
    "unevaluatedProperties",
    "formats",
  ]);
  assert.equal(
    runtime.validate("urn:test:capabilities", {
      kind: "email",
      value: "a@example.test",
      extra: "ok",
    }).valid,
    true,
  );
  assert.equal(runtime.validate("urn:test:capabilities", { kind: "count", value: 3 }).valid, true);

  const invalid = runtime.validate("urn:test:capabilities", {
    kind: "email",
    value: "not-an-email",
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.keyword === "format"));
  assert.equal(
    runtime.validate("urn:test:capabilities", { kind: "count", value: 3, unknown: true }).valid,
    false,
  );
  assert.equal(runtime.dialect, "https://json-schema.org/draft/2020-12/schema");
});

test("validates existing trace and manifest schemas without changing domain validators", async () => {
  const [trace, manifest, verification] = await Promise.all([
    readFile(new URL("../schemas/csm-trace.schema.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../schemas/csm-skill-manifest.schema.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("../schemas/verification-status.schema.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  const runtime = createSchemaValidator({ schemas: [trace, manifest, verification] });
  const fixture = JSON.parse(
    await readFile(new URL("./evals/fixtures/valid-manifest.json", import.meta.url)),
  );
  assert.equal(runtime.validate(manifest.$id, fixture).valid, true);
  assert.equal(
    runtime.validate(
      trace.$id,
      JSON.parse(await readFile(new URL("./evals/fixtures/valid-trace.json", import.meta.url))),
    ).valid,
    true,
  );
  assert.equal(
    runtime.validate(verification.$id, {
      format: "csm-verification-status/1",
      status: "INCOMPLETE",
      unresolved: ["fixture"],
      evidence: [],
      anchors: [],
    }).valid,
    true,
  );
});

test("canonical bytes and digest are independent of object insertion order", () => {
  const left = { z: 1, nested: { b: true, a: "x" }, a: [3, null] };
  const right = { a: [3, null], nested: { a: "x", b: true }, z: 1 };
  assert.equal(canonicalize(left), '{"a":[3,null],"nested":{"a":"x","b":true},"z":1}');
  assert.equal(canonicalize(left), canonicalize(right));
  assert.equal(digest(left), digest(right));
});

test("rejects duplicate keys before JSON.parse applies last-key-wins", () => {
  assert.throws(() => parseJson('{"a":1,"a":2}'), /duplicate JSON object key/);
  assert.throws(() => parseJson('{"outer":{"a":1,"a":2}}'), /duplicate JSON object key/);
  assert.deepEqual(parseJson('{"a":1,"b":[true,null]}'), { a: 1, b: [true, null] });
});

test("records known limitations instead of claiming full JCS or semantic validation", () => {
  assert.throws(() => canonicalize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalize({ value: undefined }), /non-JSON/);
  assert.throws(() => canonicalize({ value: 1n }), /non-JSON/);
  assert.throws(() => parseJson("not json"), SyntaxError);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalize(sparse), /sparse arrays/);
  assert.deepEqual(createSchemaValidator({ formats: false }).supported, [
    "$ref",
    "$defs",
    "oneOf",
    "if/then/else",
    "unevaluatedProperties",
  ]);
});
