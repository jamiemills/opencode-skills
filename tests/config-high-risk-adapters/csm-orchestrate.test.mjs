import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-orchestrate/lib/config.mjs";
import { AUTHORITY_FIELDS_BY_SKILL, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-orchestrate: no config resolves to native defaults (differential)", async () => {
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
    assert.equal(viaResolver.schema, "csm-orchestrate-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-orchestrate: valid namespace applies bounded execution preferences", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { defaultTimeoutMs: 5000, maxParallelism: 2 } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source } = resolveSkillConfig(resolved.effective);
    assert.deepEqual(config, { defaultTimeoutMs: 5000, maxParallelism: 2 });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(Object.isFrozen(config), true);
    const partial = resolveSkillConfig(envelope({ [SKILL_NAME]: { maxParallelism: 1 } }));
    assert.deepEqual(partial.config, { defaultTimeoutMs: 30_000, maxParallelism: 1 });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-orchestrate: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { maxParallelism: 2, mystery: true } },
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

test("csm-orchestrate: timeout and parallelism bounds are enforced", () => {
  for (const namespace of [
    { defaultTimeoutMs: 999 },
    { defaultTimeoutMs: 300001 },
    { defaultTimeoutMs: -1 },
    { defaultTimeoutMs: 1000.5 },
    { defaultTimeoutMs: "30000" },
    { maxParallelism: 0 },
    { maxParallelism: 5 },
    { maxParallelism: null },
    { maxParallelism: 2.5 },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { defaultTimeoutMs: 300000, maxParallelism: 1 } }))
      .config,
    { defaultTimeoutMs: 300000, maxParallelism: 1 },
  );
  assert.deepEqual(
    resolveSkillConfig(envelope({ [SKILL_NAME]: { defaultTimeoutMs: 1000, maxParallelism: 4 } }))
      .config,
    { defaultTimeoutMs: 1000, maxParallelism: 4 },
  );
});

test("csm-orchestrate: malformed effective config fails closed", () => {
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
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: [5000] })),
    (error) => error.code === "config-schema",
  );
});

test("csm-orchestrate: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-build": { verbosity: "quiet" },
    "csm-browse": { viewport: "mobile" },
    "csm-autoresearch": { logVerbosity: "minimal" },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-orchestrate: authority escalation is rejected (host, capabilities, approvals, gates, trust roots, autonomy)", () => {
  for (const field of AUTHORITY_FIELDS_BY_SKILL[SKILL_NAME]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
