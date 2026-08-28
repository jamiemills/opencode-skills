import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-review/lib/config.mjs";
import { AUTHORITY_FIELDS, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-review: no config resolves to native defaults (differential)", async () => {
  const ctx = await fixture();
  try {
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const viaResolver = resolveSkillConfig(resolved.effective);
    const viaBuiltinNamespace = resolveSkillConfig(envelope({ [SKILL_NAME]: {} }));
    const viaAbsentNamespace = resolveSkillConfig(envelope({}));
    assert.deepEqual(viaResolver.config, DEFAULT_CONFIG);
    assert.deepEqual(viaResolver.config, viaBuiltinNamespace.config);
    assert.deepEqual(viaResolver.config, viaAbsentNamespace.config);
    assert.equal(viaResolver.schema, CONFIG_SCHEMA_ID);
    assert.equal(viaResolver.schema, "csm-review-config/1");
    assert.equal(viaResolver.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-review: valid namespace applies presentation settings", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { verbosity: "quiet" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source } = resolveSkillConfig(resolved.effective);
    assert.deepEqual(config, { verbosity: "quiet" });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(Object.isFrozen(config), true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-review: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { verbosity: "verbose", severity: "advisory" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /severity/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { severity: "advisory" } })),
      (error) => error.code === "unknown-key" && /severity/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-review: invalid types and enum values are rejected", () => {
  for (const namespace of [{ verbosity: 1 }, { verbosity: "loud" }, { verbosity: ["verbose"] }]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-review: malformed effective config fails closed", () => {
  assert.throws(
    () => resolveSkillConfig(null),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig([]),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null })),
    (error) => error.code === "config-schema",
  );
});

test("csm-review: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-review-python": { mode: "tool-assisted" },
    "csm-scan": { outputFormat: "markdown" },
    "csm-grill": { verbosity: "loud" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-review: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
