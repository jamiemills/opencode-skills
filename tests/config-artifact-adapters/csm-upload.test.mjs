import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  legacyConfigPath,
  loadLegacyConfig,
  resolveSkillConfig,
} from "../../csm-upload/lib/config.mjs";
import {
  AUTHORITY_FIELDS,
  envelope,
  fixture,
  layerEnv,
  legacyPath,
  writeJson,
} from "./helpers.mjs";

test("csm-upload: no config and no legacy resolve to empty defaults (differential)", async () => {
  const ctx = await fixture();
  try {
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const viaResolver = resolveSkillConfig(resolved.effective, { legacy: null });
    const viaBuiltinNamespace = resolveSkillConfig(envelope({ [SKILL_NAME]: {} }), {
      legacy: null,
    });
    const viaAbsentNamespace = resolveSkillConfig(envelope({}), { legacy: null });
    assert.deepEqual(viaResolver.config, { legacyMode: false });
    assert.deepEqual(viaResolver.config, viaBuiltinNamespace.config);
    assert.deepEqual(viaResolver.config, viaAbsentNamespace.config);
    assert.deepEqual(DEFAULT_CONFIG, {});
    assert.equal(viaResolver.schema, CONFIG_SCHEMA_ID);
    assert.equal(viaResolver.schema, "csm-upload-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaResolver.legacyMode, false);
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: valid namespace applies additive settings", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { github: "suite-user", pagesRepo: "suite-pages" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const { config, schema, source, legacyMode } = resolveSkillConfig(resolved.effective, {
      legacy: null,
    });
    assert.deepEqual(config, { github: "suite-user", pagesRepo: "suite-pages", legacyMode: false });
    assert.equal(schema, CONFIG_SCHEMA_ID);
    assert.equal(source, "configured");
    assert.equal(legacyMode, false);
    assert.equal(Object.isFrozen(config), true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { github: "u", pushToken: "ghp_x" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective, { legacy: null }),
      (error) => error.code === "unknown-key" && /pushToken/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { mystery: true } }), { legacy: null }),
      (error) => error.code === "unknown-key" && /mystery/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: invalid types and empty strings are rejected", () => {
  for (const namespace of [
    { github: 42 },
    { github: null },
    { pagesRepo: ["x"] },
    { label: "" },
    { label: 7 },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace }), { legacy: null }),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-upload: malformed effective config and legacy option fail closed", () => {
  assert.throws(
    () => resolveSkillConfig(null, { legacy: null }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig({}, { legacy: null }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: null }), { legacy: null }),
    (error) => error.code === "config-schema",
  );
  assert.throws(
    () => resolveSkillConfig(envelope({}), { legacy: "legacy-user" }),
    (error) => error.code === "legacy-config",
  );
});

test("csm-upload: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-bdd-tdd": { outputStyle: "compact", mystery: true },
    "csm-make-tests": { maxFiles: 0 },
    "csm-grill": { verbosity: "nope" },
  });
  const { config, source } = resolveSkillConfig(effective, { legacy: null });
  assert.deepEqual(config, { legacyMode: false });
  assert.equal(source, "defaults");
});

test("csm-upload: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () =>
        resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } }), {
          legacy: null,
        }),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});

test("csm-upload: legacy config coexists with suite config additively", async () => {
  const ctx = await fixture();
  try {
    await writeJson(legacyPath(ctx), { github: "legacy-user" });
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { github: "suite-user", pagesRepo: "suite-pages", label: "demo" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const legacy = await loadLegacyConfig({ env: layerEnv(ctx) });
    assert.equal(legacy.present, true);
    assert.deepEqual(legacy.config, { github: "legacy-user" });
    const { config, source, legacyMode } = resolveSkillConfig(resolved.effective, {
      legacy: legacy.config,
    });
    assert.deepEqual(config, {
      github: "legacy-user",
      pagesRepo: "suite-pages",
      label: "demo",
      legacyMode: true,
    });
    assert.equal(source, "configured");
    assert.equal(legacyMode, true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: suite values never override legacy-set fields", async () => {
  const ctx = await fixture();
  try {
    await writeJson(legacyPath(ctx), { github: "legacy-user", pagesRepo: "legacy-pages" });
    const legacy = await loadLegacyConfig({ env: layerEnv(ctx) });
    const effective = envelope({
      [SKILL_NAME]: { github: "suite-user", pagesRepo: "suite-pages", label: "suite-label" },
    });
    const { config, legacyMode } = resolveSkillConfig(effective, { legacy: legacy.config });
    assert.deepEqual(config, {
      github: "legacy-user",
      pagesRepo: "legacy-pages",
      label: "suite-label",
      legacyMode: true,
    });
    assert.equal(legacyMode, true);
    const legacyOnly = resolveSkillConfig(envelope({}), { legacy: legacy.config });
    assert.deepEqual(legacyOnly.config, {
      github: "legacy-user",
      pagesRepo: "legacy-pages",
      legacyMode: true,
    });
    assert.equal(legacyOnly.source, "defaults");
    assert.equal(legacyOnly.legacyMode, true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: legacy file is never modified, created, or deleted by the adapter", async () => {
  const ctx = await fixture();
  try {
    await writeJson(legacyPath(ctx), { github: "legacy-user" });
    const before = {
      bytes: await readFile(legacyPath(ctx), "utf8"),
      stats: await stat(legacyPath(ctx)),
    };
    const legacy = await loadLegacyConfig({ env: layerEnv(ctx) });
    resolveSkillConfig(envelope({ [SKILL_NAME]: { github: "suite-user", label: "demo" } }), {
      legacy: legacy.config,
    });
    const after = {
      bytes: await readFile(legacyPath(ctx), "utf8"),
      stats: await stat(legacyPath(ctx)),
    };
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.stats.mtimeMs, before.stats.mtimeMs);
    assert.equal(after.stats.size, before.stats.size);
    assert.equal(legacyConfigPath(layerEnv(ctx)), legacyPath(ctx));
    const absent = await loadLegacyConfig({
      env: layerEnv(ctx, { HOME: join(ctx.root, "empty") }),
    });
    assert.deepEqual(absent, { present: false, config: null, path: absent.path });
    await assert.rejects(
      () => stat(absent.path),
      (error) => error.code === "ENOENT",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: malformed legacy config fails closed", async () => {
  const ctx = await fixture();
  try {
    await mkdir(dirname(legacyPath(ctx)), { recursive: true });
    await writeFile(legacyPath(ctx), "{ not json");
    await assert.rejects(
      () => loadLegacyConfig({ env: layerEnv(ctx) }),
      (error) => error.code === "legacy-config",
    );
    await writeJson(legacyPath(ctx), ["array-root"]);
    await assert.rejects(
      () => loadLegacyConfig({ env: layerEnv(ctx) }),
      (error) => error.code === "legacy-config",
    );
    await writeJson(legacyPath(ctx), { github: 42 });
    await assert.rejects(
      () => loadLegacyConfig({ env: layerEnv(ctx) }),
      (error) => error.code === "legacy-config" && /github/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-upload: unknown legacy keys are tolerated like the legacy loader", async () => {
  const ctx = await fixture();
  try {
    await writeJson(legacyPath(ctx), { github: "legacy-user", futureField: "ignored" });
    const legacy = await loadLegacyConfig({ env: layerEnv(ctx) });
    assert.deepEqual(legacy.config, { github: "legacy-user" });
    const { config, legacyMode } = resolveSkillConfig(envelope({}), { legacy: legacy.config });
    assert.deepEqual(config, { github: "legacy-user", legacyMode: true });
    assert.equal(legacyMode, true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});
