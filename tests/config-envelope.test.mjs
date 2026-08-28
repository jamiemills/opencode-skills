import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONFIG_SCHEMA_ID,
  CONFIG_SCHEMA_VERSION,
  LIMITS,
  PROJECT_CONFIG_FILE_NAME,
  SKILL_NAMES,
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_FILE_NAME,
  validateConfigEnvelope,
} from "../lib/config/index.mjs";
import { digest, loadSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const schemaText = await readFile(join(REPO, "schemas", "csm-skills-config.schema.json"), "utf8");
const schema = parseJson(schemaText);

function allSkills(value) {
  const skills = {};
  for (const name of SKILL_NAMES) skills[name] = structuredClone(value);
  return skills;
}

test("envelope schema accepts a minimal transport with empty skills", async () => {
  const result = await validateConfigEnvelope({ schema: CONFIG_SCHEMA_ID, skills: {} });
  assert.equal(result.valid, true);
});

test("envelope schema accepts all 14 namespaces with arbitrary per-skill structure", async () => {
  const config = {
    schema: CONFIG_SCHEMA_ID,
    version: 1,
    skills: allSkills({
      nested: { deeper: { leaf: [1, "two", null, { three: true }] } },
    }),
  };
  const result = await validateConfigEnvelope(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("envelope schema rejects invalid shapes", async () => {
  const cases = [
    { schema: "csm-skills-config/2", skills: {} },
    { schema: CONFIG_SCHEMA_ID, skills: {}, version: 2 },
    { schema: CONFIG_SCHEMA_ID },
    { schema: CONFIG_SCHEMA_ID, skills: [] },
    { schema: CONFIG_SCHEMA_ID, skills: {}, extra: "no" },
    { schema: CONFIG_SCHEMA_ID, skills: { "csm-frobnicate": {} } },
    { schema: CONFIG_SCHEMA_ID, skills: { "csm-scan": "not-an-object" } },
    ["not", "an", "object"],
  ];
  for (const instance of cases) {
    const result = await validateConfigEnvelope(instance);
    assert.equal(result.valid, false, `expected rejection: ${JSON.stringify(instance)}`);
    assert.ok(result.errors.length > 0);
  }
});

test("envelope schema is closed at the top level and inside skills", () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).toSorted(), ["schema", "skills", "version"]);
  assert.equal(schema.properties.schema.const, CONFIG_SCHEMA_ID);
  assert.equal(schema.properties.version.const, CONFIG_SCHEMA_VERSION);
  assert.deepEqual(schema.required.toSorted(), ["schema", "skills"]);
  const skills = schema.properties.skills;
  assert.equal(skills.additionalProperties, false);
  assert.deepEqual(Object.keys(skills.properties).toSorted(), [...SKILL_NAMES].toSorted());
  for (const name of SKILL_NAMES)
    assert.deepEqual(skills.properties[name], { type: "object" }, name);
});

test("config schema is registered immutably with a matching canonical digest", async () => {
  const runtime = await loadSchemaRegistry();
  const entry = runtime.resolve("csm-skills-config", 1);
  assert.equal(entry.id, CONFIG_SCHEMA_ID);
  assert.equal(entry.revision, 1);
  assert.equal(entry.immutable, true);
  assert.equal(entry.unknownFieldPolicy, "reject");
  assert.equal(entry.schemaContentDigest, digest(schema));
  const good = runtime.validate(CONFIG_SCHEMA_ID, { schema: CONFIG_SCHEMA_ID, skills: {} });
  assert.equal(good.valid, true);
  const bad = runtime.validate(CONFIG_SCHEMA_ID, { schema: "other/1", skills: {} });
  assert.equal(bad.valid, false);
});

test("exported path constants and limits match the agreed contract", () => {
  assert.equal(PROJECT_CONFIG_FILE_NAME, ".csm-skills.json");
  assert.equal(USER_CONFIG_DIR_NAME, "csm");
  assert.equal(USER_CONFIG_FILE_NAME, "skills.json");
  assert.equal(SKILL_NAMES.length, 14);
  assert.deepEqual(LIMITS, { maxFileBytes: 1024 * 1024, maxJsonDepth: 32 });
});
