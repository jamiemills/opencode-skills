import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-plan/lib/config.mjs";
import { AUTHORITY_FIELDS, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-plan: no config resolves to native defaults (differential)", async () => {
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
    assert.equal(viaResolver.schema, "csm-plan-config/1");
    assert.equal(viaResolver.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-plan: valid namespace applies settings and keeps unset defaults", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { verbosity: "quiet", batchSize: 12 } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const full = resolveSkillConfig(resolved.effective);
    assert.deepEqual(full.config, { verbosity: "quiet", batchSize: 12 });
    assert.equal(full.source, "configured");
    assert.equal(Object.isFrozen(full.config), true);

    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { batchSize: 1 } },
    });
    const partial = resolveSkillConfig(
      (await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) })).effective,
    );
    assert.deepEqual(partial.config, { verbosity: "normal", batchSize: 1 });
    assert.equal(partial.source, "configured");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-plan: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { batchSize: 5, sandboxRoot: "/tmp" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /sandboxRoot/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { sandboxRoot: "/tmp" } })),
      (error) => error.code === "unknown-key" && /sandboxRoot/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-plan: invalid types and ranges are rejected", () => {
  for (const namespace of [
    { batchSize: 0 },
    { batchSize: 21 },
    { batchSize: "5" },
    { batchSize: 2.5 },
    { verbosity: false },
    { verbosity: "loud" },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-plan: malformed effective config fails closed", () => {
  assert.throws(
    () => resolveSkillConfig(null),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig({ schema: "csm-skills-config/1" }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null })),
    (error) => error.code === "config-schema",
  );
});

test("csm-plan: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-grill": { verbosity: "loud" },
    "csm-ddd": { maxFiles: 999999, maxBytes: "unbounded" },
    "csm-upload": { pagesRepo: "somewhere" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-plan: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
