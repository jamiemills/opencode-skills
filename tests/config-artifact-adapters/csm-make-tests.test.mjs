import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { resolveConfig } from "../../lib/config/index.mjs";
import {
  CONFIG_SCHEMA_ID,
  DEFAULT_CONFIG,
  SKILL_NAME,
  resolveSkillConfig,
} from "../../csm-make-tests/lib/config.mjs";
import { AUTHORITY_FIELDS, envelope, fixture, layerEnv, writeJson } from "./helpers.mjs";

test("csm-make-tests: no config resolves to native defaults (differential)", async () => {
  const ctx = await fixture();
  try {
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const viaResolver = resolveSkillConfig(resolved.effective);
    const viaBuiltinNamespace = resolveSkillConfig(envelope({ [SKILL_NAME]: {} }));
    const viaAbsentNamespace = resolveSkillConfig(envelope({}));
    assert.deepEqual(viaResolver.config, DEFAULT_CONFIG);
    assert.deepEqual(viaResolver.config, viaBuiltinNamespace.config);
    assert.deepEqual(viaResolver.config, viaAbsentNamespace.config);
    assert.deepEqual(viaResolver.config.testDimensions, [
      "characterization",
      "property",
      "contract",
      "performance",
    ]);
    assert.equal(viaResolver.schema, CONFIG_SCHEMA_ID);
    assert.equal(viaResolver.schema, "csm-make-tests-config/1");
    assert.equal(viaResolver.source, "defaults");
    assert.equal(viaAbsentNamespace.source, "defaults");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-make-tests: valid namespace replaces dimensions wholesale and bounds files", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { testDimensions: ["property", "contract"] } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const partial = resolveSkillConfig(resolved.effective);
    assert.deepEqual(partial.config, {
      testDimensions: ["property", "contract"],
      maxFiles: 100,
    });
    assert.equal(partial.schema, CONFIG_SCHEMA_ID);
    assert.equal(partial.source, "configured");
    assert.equal(Object.isFrozen(partial.config), true);
    const full = resolveSkillConfig(
      envelope({ [SKILL_NAME]: { testDimensions: ["performance"], maxFiles: 7 } }),
    );
    assert.deepEqual(full.config, { testDimensions: ["performance"], maxFiles: 7 });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-make-tests: unknown namespace key is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeJson(`${ctx.project}/.csm-skills.json`, {
      schema: "csm-skills-config/1",
      skills: { [SKILL_NAME]: { maxFiles: 10, ledgerAuthority: "me" } },
    });
    const resolved = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.throws(
      () => resolveSkillConfig(resolved.effective),
      (error) => error.code === "unknown-key" && /ledgerAuthority/.test(error.message),
    );
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { mystery: true } })),
      (error) => error.code === "unknown-key" && /mystery/.test(error.message),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("csm-make-tests: invalid ranges, dimensions, and types are rejected", () => {
  for (const namespace of [
    { maxFiles: 0 },
    { maxFiles: 1001 },
    { maxFiles: 1.5 },
    { maxFiles: "100" },
    { maxFiles: null },
    { testDimensions: ["mutation"] },
    { testDimensions: "property" },
    { testDimensions: ["property", "property"] },
    { testDimensions: [42] },
    { testDimensions: null },
  ]) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: namespace })),
      (error) => error.code === "skill-config",
      JSON.stringify(namespace),
    );
  }
});

test("csm-make-tests: malformed effective config fails closed", () => {
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
    () => resolveSkillConfig(envelope({ [SKILL_NAME]: ["property"] })),
    (error) => error.code === "config-schema",
  );
});

test("csm-make-tests: unrelated namespaces are ignored", () => {
  const effective = envelope({
    "csm-bdd-tdd": { outputStyle: "compact", mystery: true },
    "csm-upload": { github: "someone", label: "" },
    "csm-orchestrate": { autonomy: true },
  });
  const { config, source } = resolveSkillConfig(effective);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(source, "defaults");
});

test("csm-make-tests: authority fields are not accepted", () => {
  for (const field of AUTHORITY_FIELDS) {
    assert.throws(
      () => resolveSkillConfig(envelope({ [SKILL_NAME]: { [field]: { grant: "everything" } } })),
      (error) => error.code === "unknown-key" && error.message.includes(field),
      field,
    );
  }
});
