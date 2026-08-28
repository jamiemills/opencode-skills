import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-build/lib/config.mjs";
import { AUTHORITY_FIELDS_BY_SKILL, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-build: no config resolves to native defaults (differential)", async () => {
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
    assert.equal(viaResolver.schema, "csm-build-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-build: valid namespace applies presentation settings only", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { verbosity: "quiet", reportStyle: "compact" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source } = resolveSkillConfig(resolved.effective);
    assert.deepEqual(config, { verbosity: "quiet", reportStyle: "compact" });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(Object.isFrozen(config), true);
    const partial = resolveSkillConfig(envelope({ [SKILL_NAME]: { verbosity: "quiet" } }));
    assert.deepEqual(partial.config, { verbosity: "quiet", reportStyle: "standard" });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-build: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { verbosity: "quiet", mystery: true } },
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

test("csm-build: invalid enums and types are rejected", () => {
  for (const namespace of [
    { verbosity: "loud" },
    { verbosity: 1 },
    { verbosity: null },
    { reportStyle: "fancy" },
    { reportStyle: [] },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-build: malformed effective config fails closed", () => {
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
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: ["quiet"] })),
    (error) => error.code === "config-schema",
  );
});

test("csm-build: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-orchestrate": { maxParallelism: 1 },
    "csm-browse": { viewport: "wide" },
    "csm-autoresearch": { archiveLimit: 5 },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-build: authority escalation is rejected (dispatch, write scope, commit, push, lifecycle, execute)", () => {
  for (const field of AUTHORITY_FIELDS_BY_SKILL[SKILL_NAME]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
