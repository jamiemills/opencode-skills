import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-autoresearch/lib/config.mjs";
import { AUTHORITY_FIELDS_BY_SKILL, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-autoresearch: no config resolves to native defaults (differential)", async () => {
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
    assert.equal(viaResolver.schema, "csm-autoresearch-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-autoresearch: valid namespace applies presentation and retention settings", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { logVerbosity: "detailed", archiveLimit: 250 } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source } = resolveSkillConfig(resolved.effective);
    assert.deepEqual(config, { logVerbosity: "detailed", archiveLimit: 250 });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(Object.isFrozen(config), true);
    const partial = resolveSkillConfig(envelope({ [SKILL_NAME]: { logVerbosity: "minimal" } }));
    assert.deepEqual(partial.config, { logVerbosity: "minimal", archiveLimit: 100 });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-autoresearch: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { logVerbosity: "minimal", mystery: true } },
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

test("csm-autoresearch: invalid enums, types, and archive bounds are rejected", () => {
  for (const namespace of [
    { logVerbosity: "loud" },
    { logVerbosity: 3 },
    { logVerbosity: null },
    { archiveLimit: 0 },
    { archiveLimit: 1001 },
    { archiveLimit: -5 },
    { archiveLimit: 10.5 },
    { archiveLimit: "100" },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { archiveLimit: 1000 } })).config.archiveLimit,
    1000,
  );
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { archiveLimit: 1 } })).config.archiveLimit,
    1,
  );
});

test("csm-autoresearch: malformed effective config fails closed", () => {
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
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: ["detailed"] })),
    (error) => error.code === "config-schema",
  );
});

test("csm-autoresearch: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-browse": { viewport: "mobile" },
    "csm-orchestrate": { defaultTimeoutMs: 5000 },
    "csm-build": { reportStyle: "compact" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-autoresearch: authority escalation is rejected (live mode, sandbox, evaluator, budgets, execute)", () => {
  for (const field of AUTHORITY_FIELDS_BY_SKILL[SKILL_NAME]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
