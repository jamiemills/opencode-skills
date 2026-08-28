import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-ddd/lib/config.mjs";
import { AUTHORITY_FIELDS, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-ddd: no config resolves to native defaults (differential)", async () => {
  const ctx = await fixture();
  try {
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const viaResolver = resolveSkillConfig(resolved.effective);
    const viaBuiltinNamespace = resolveSkillConfig(envelope({ [SKILL_NAME]: {} }));
    const viaAbsentNamespace = resolveSkillConfig(envelope({}));
    assert.deepEqual(viaResolver.config, DEFAULT_CONFIG);
    assert.deepEqual(DEFAULT_CONFIG, { maxFiles: 2000, maxBytes: 2000000 });
    assert.deepEqual(viaResolver.config, viaBuiltinNamespace.config);
    assert.deepEqual(viaResolver.config, viaAbsentNamespace.config);
    assert.equal(viaResolver.schema, CONFIG_SCHEMA_ID);
    assert.equal(viaResolver.schema, "csm-ddd-config/1");
    assert.equal(viaResolver.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-ddd: valid namespace narrows analysis caps over defaults", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { maxFiles: 250, maxBytes: 500000 } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const full = resolveSkillConfig(resolved.effective);
    assert.deepEqual(full.config, { maxFiles: 250, maxBytes: 500000 });
    assert.equal(full.source, "configured");
    assert.equal(Object.isFrozen(full.config), true);

    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { maxFiles: 1 } },
    });
    const partial = resolveSkillConfig(
      (await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) })).effective,
    );
    assert.deepEqual(partial.config, { maxFiles: 1, maxBytes: 2000000 });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-ddd: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { maxFiles: 100, outReport: "/tmp/report.json" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /outReport/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { outReport: "/tmp/report.json" } })),
      (error) => error.code === "unknown-key" && /outReport/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-ddd: out-of-range and non-integer caps are rejected", () => {
  for (const namespace of [
    { maxFiles: 0 },
    { maxFiles: 5001 },
    { maxFiles: 2.5 },
    { maxFiles: "2000" },
    { maxBytes: 0 },
    { maxBytes: 10000001 },
    { maxBytes: 2000000.5 },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-ddd: malformed effective config fails closed", () => {
  assert.throws(
    () => resolveSkillConfig(null),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig({ skills: "all" }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null })),
    (error) => error.code === "config-schema",
  );
});

test("csm-ddd: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-grill": { verbosity: 7 },
    "csm-review-python": { mode: "agentic" },
    "csm-upload": { github: "someone" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-ddd: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
