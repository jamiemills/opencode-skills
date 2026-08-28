import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-deep-research/lib/config.mjs";
import { AUTHORITY_FIELDS, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-deep-research: no config resolves to native defaults (differential)", async () => {
  const ctx = await fixture();
  try {
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const viaResolver = resolveSkillConfig(resolved.effective);
    const viaBuiltinNamespace = resolveSkillConfig(envelope({ [SKILL_NAME]: {} }));
    const viaAbsentNamespace = resolveSkillConfig(envelope({}));
    assert.deepEqual(viaResolver.config, DEFAULT_CONFIG);
    assert.deepEqual(DEFAULT_CONFIG, { defaultTier: "STANDARD", defaultSourceMode: "hybrid" });
    assert.deepEqual(viaResolver.config, viaBuiltinNamespace.config);
    assert.deepEqual(viaResolver.config, viaAbsentNamespace.config);
    assert.equal(viaResolver.schema, CONFIG_SCHEMA_ID);
    assert.equal(viaResolver.schema, "csm-deep-research-config/1");
    assert.equal(viaResolver.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-deep-research: valid namespace applies preferences over defaults", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { defaultTier: "QUICK", defaultSourceMode: "local" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const full = resolveSkillConfig(resolved.effective);
    assert.deepEqual(full.config, { defaultTier: "QUICK", defaultSourceMode: "local" });
    assert.equal(full.source, "configured");
    assert.equal(Object.isFrozen(full.config), true);

    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { defaultSourceMode: "web" } },
    });
    const partial = resolveSkillConfig(
      (await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) })).effective,
    );
    assert.deepEqual(partial.config, { defaultTier: "STANDARD", defaultSourceMode: "web" });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-deep-research: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { defaultTier: "DEEP", browseVerbAllowlist: ["eval"] } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /browseVerbAllowlist/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { browseVerbAllowlist: ["eval"] } })),
      (error) => error.code === "unknown-key" && /browseVerbAllowlist/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-deep-research: invalid types and enum values are rejected", () => {
  for (const namespace of [
    { defaultTier: "quick" },
    { defaultTier: 2 },
    { defaultSourceMode: "browser" },
    { defaultSourceMode: ["local", "web"] },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-deep-research: malformed effective config fails closed", () => {
  assert.throws(
    () => resolveSkillConfig(null),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig({ skills: [] }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null })),
    (error) => error.code === "config-schema",
  );
});

test("csm-deep-research: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-grill": { verbosity: "loud" },
    "csm-plan": { batchSize: 999 },
    "csm-browse": { hardened: false },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-deep-research: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
