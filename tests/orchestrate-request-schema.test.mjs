"use strict";

// T001 verification: csm-orchestrate-request/1 is registered with a canonical
// digest, validates a well-formed request, and fails closed on an unknown
// kind, a non-canonical runId, and any extra property.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createSchemaValidator,
  digest,
  loadSchemaRegistry,
  parseJson,
} from "../lib/schema-runtime/index.mjs";

const SCHEMA_ID = "csm-orchestrate-request/1";

const VALID_REQUEST = {
  schema: "csm-orchestrate-request/1",
  schemaRevision: 1,
  requestId: "request-intake-valid-sample",
  runId: "run-20260906t230626z-4f3a9b2c1d8e",
  kind: "research",
  prompt: "Research how to generalize request intake in csm-orchestrate.",
  goalSlug: "orchestrate-request-intake-router",
  artifactRef: null,
  repo: "/tmp/example-repo",
  constraints: ["read-only", "bounded"],
  requestedSignals: { inputs: ["plan"], capabilities: ["csm-deep-research"] },
};

test("registry resolves csm-orchestrate-request/1 with a canonical schema digest", async () => {
  const registry = await loadSchemaRegistry();
  const entry = registry.resolve("csm-orchestrate-request", 1);
  assert.equal(entry.id, SCHEMA_ID);
  assert.equal(entry.revision, 1);
  assert.equal(entry.schemaPath, "csm-orchestrate/schemas/csm-orchestrate-request.schema.json");
  assert.equal(entry.immutable, true);
  assert.equal(entry.unknownFieldPolicy, "reject");
  assert.deepEqual(entry.aliases, []);
  const schemaFile = parseJson(
    await readFile(
      new URL("../csm-orchestrate/schemas/csm-orchestrate-request.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(entry.schemaContentDigest, digest(schemaFile));
  assert.equal(entry.schemaContentDigest, digest(entry.schema));
});

test("a well-formed request validates against csm-orchestrate-request/1", async () => {
  const registry = await loadSchemaRegistry();
  const validator = createSchemaValidator({ schemas: registry.entries.map((e) => e.schema) });
  const result = validator.validate(SCHEMA_ID, structuredClone(VALID_REQUEST));
  assert.equal(result.valid, true, JSON.stringify(result.errors ?? []));
});

test("requests fail closed on unknown kind, non-canonical runId, and extra properties", async () => {
  const registry = await loadSchemaRegistry();
  const validator = createSchemaValidator({ schemas: registry.entries.map((e) => e.schema) });

  const unknownKind = { ...structuredClone(VALID_REQUEST), kind: "orchestrate" };
  assert.equal(validator.validate(SCHEMA_ID, unknownKind).valid, false);

  const nonCanonicalRunId = {
    ...structuredClone(VALID_REQUEST),
    runId: "run-Not-Canonical-1",
  };
  const runResult = validator.validate(SCHEMA_ID, nonCanonicalRunId);
  assert.equal(runResult.valid, false);
  assert.ok(runResult.errors.some((error) => error.instancePath === "/runId"));

  const extraProperty = { ...structuredClone(VALID_REQUEST), unexpected: true };
  assert.equal(validator.validate(SCHEMA_ID, extraProperty).valid, false);

  const missingRequired = structuredClone(VALID_REQUEST);
  delete missingRequired.prompt;
  assert.equal(validator.validate(SCHEMA_ID, missingRequired).valid, false);
});
