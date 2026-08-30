import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSchemaValidator, digest, parseJson } from "../lib/schema-runtime/index.mjs";
import {
  loadCapabilities,
  validateCapabilities,
  SUPPORTED_SKILLS,
} from "../csm-orchestrate/lib/capabilities.mjs";

const manifest = await loadCapabilities();
const schema = parseJson(
  await readFile(
    new URL("../csm-orchestrate/schemas/capabilities.schema.json", import.meta.url),
    "utf8",
  ),
);
const validator = createSchemaValidator({ schemas: [schema] });

test("all 13 capabilities validate and resolve deterministically", () => {
  assert.equal(validator.validate("csm-orchestrate-capabilities/1", manifest).valid, true);
  assert.deepEqual(
    manifest.skills.map(({ skill }) => skill),
    [...SUPPORTED_SKILLS],
  );
  assert.equal(manifest.skills.length, 13);
  assert.equal(
    manifest.contentDigest,
    "sha256:f1d6a332bc73f758b4222320b7961f257e30a5e412828c8f07b0dd6ed4a17285",
  );
});

test("schema rejects missing capability metadata and unknown revisions", () => {
  const missing = structuredClone(manifest);
  delete missing.skills[0].recovery;
  assert.equal(validator.validate("csm-orchestrate-capabilities/1", missing).valid, false);
  assert.throws(
    () => validator.validate("csm-orchestrate-capabilities/2", manifest),
    /schema must be object or boolean/,
  );
});

test("semantic validation fails closed on digest drift and contradictions", async () => {
  const drift = structuredClone(manifest);
  drift.skills[0].digest = `sha256:${"0".repeat(64)}`;
  drift.contentDigest = digest(drift.skills);
  await assert.rejects(validateCapabilities(drift), /source digest mismatch/);

  const contradiction = structuredClone(manifest);
  contradiction.skills.find(({ skill }) => skill === "csm-upload").approvalClass = "none";
  contradiction.contentDigest = digest(contradiction.skills);
  await assert.rejects(
    validateCapabilities(contradiction, { verifySources: false }),
    /side effect lacks approval/,
  );
});

test("producer metadata is checked when present", async () => {
  const invalid = structuredClone(manifest);
  invalid.skills.find(({ skill }) => skill === "csm-ddd").source.producerPath =
    "csm-review/producer.json";
  invalid.contentDigest = digest(invalid.skills);
  await assert.rejects(validateCapabilities(invalid), /producer identity mismatch/);
});
