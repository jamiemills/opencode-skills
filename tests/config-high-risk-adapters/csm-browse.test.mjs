import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-browse/lib/config.mjs";
import { AUTHORITY_FIELDS_BY_SKILL, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-browse: no config resolves to native defaults (differential)", async () => {
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
    assert.equal(viaResolver.schema, "csm-browse-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-browse: valid namespace applies bounded preferences over defaults", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: {
        [SKILL_NAME]: { viewport: "mobile", screenshotQuality: "high", cleanupAgeHours: 48 },
      },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source } = resolveSkillConfig(resolved.effective);
    assert.deepEqual(config, {
      viewport: "mobile",
      screenshotQuality: "high",
      cleanupAgeHours: 48,
    });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(Object.isFrozen(config), true);
    const partial = resolveSkillConfig(envelope({ [SKILL_NAME]: { viewport: "wide" } }));
    assert.deepEqual(partial.config, {
      viewport: "wide",
      screenshotQuality: "standard",
      cleanupAgeHours: 24,
    });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-browse: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { viewport: "wide", mystery: true } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /mystery/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { mystery: true } })),
      (error) => error.code === "unknown-key" && /mystery/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-browse: invalid enums, types, and cleanup bounds are rejected", () => {
  for (const namespace of [
    { viewport: "huge" },
    { viewport: 2 },
    { viewport: null },
    { screenshotQuality: "ultra" },
    { cleanupAgeHours: 0 },
    { cleanupAgeHours: 721 },
    { cleanupAgeHours: -1 },
    { cleanupAgeHours: 24.5 },
    { cleanupAgeHours: "24" },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { cleanupAgeHours: 720 } })).config.cleanupAgeHours,
    720,
  );
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { cleanupAgeHours: 1 } })).config.cleanupAgeHours,
    1,
  );
});

test("csm-browse: malformed effective config fails closed", () => {
  assert.throws(
    () => resolveSkillConfig(null),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig({}),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null })),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: ["wide"] })),
    (error) => error.code === "config-schema",
  );
});

test("csm-browse: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-orchestrate": { maxParallelism: 2 },
    "csm-autoresearch": { logVerbosity: "detailed" },
    "csm-build": { verbosity: "quiet" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-browse: authority escalation is rejected (ports, tokens, credentials, container, origins, cookies)", () => {
  for (const field of AUTHORITY_FIELDS_BY_SKILL[SKILL_NAME]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
