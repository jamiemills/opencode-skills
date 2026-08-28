import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  computeEffectiveDigest,
  expandEnvRefs,
  mergeConfig,
  resolveConfig,
} from "../lib/config/index.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csm-config-resolver-"));
  const ctx = { root, project: join(root, "repo"), xdg: join(root, "xdg") };
  await mkdir(ctx.project, { recursive: true });
  await mkdir(ctx.xdg, { recursive: true });
  return ctx;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function layerEnv(ctx, extra = {}) {
  return { XDG_CONFIG_HOME: ctx.xdg, HOME: join(ctx.root, "home"), ...extra };
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;

test("no config anywhere resolves to built-in defaults with absent sources", async () => {
  const ctx = await fixture();
  try {
    const result = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.deepEqual(result.effective, {
      schema: "csm-skills-config/1",
      version: 1,
      skills: Object.fromEntries(
        [
          "csm-autoresearch",
          "csm-bdd-tdd",
          "csm-browse",
          "csm-build",
          "csm-ddd",
          "csm-deep-research",
          "csm-grill",
          "csm-make-tests",
          "csm-orchestrate",
          "csm-plan",
          "csm-review",
          "csm-review-python",
          "csm-scan",
          "csm-upload",
        ].map((name) => [name, {}]),
      ),
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.effectiveDigest, computeEffectiveDigest(result.effective));
    assert.deepEqual(result.envRefs, []);
    assert.deepEqual(
      result.sources.map((source) => source.kind),
      ["defaults", "project", "user", "run"],
    );
    assert.equal(result.sources[0].present, true);
    assert.match(result.sources[0].contentDigest, SHA256);
    assert.equal(result.sources[0].path, null);
    const absent = [
      { kind: "project", path: join(ctx.project, ".csm-skills.json") },
      { kind: "user", path: join(ctx.xdg, "csm", "skills.json") },
      { kind: "run", path: null },
    ];
    for (const [index, expected] of absent.entries()) {
      const source = result.sources[index + 1];
      assert.equal(source.kind, expected.kind);
      assert.equal(source.present, false, source.kind);
      assert.equal(source.contentDigest, null, source.kind);
      assert.equal(source.path, expected.path, source.kind);
    }
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("project layer loads from <repo root>/.csm-skills.json", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { output: "norms.json" } },
    });
    const result = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.equal(result.effective.skills["csm-scan"].output, "norms.json");
    assert.deepEqual(result.effective.skills["csm-grill"], {});
    const project = result.sources.find((source) => source.kind === "project");
    assert.equal(project.present, true);
    assert.match(project.contentDigest, SHA256);
    assert.equal(result.sources.find((source) => source.kind === "user").present, false);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("user layer loads from $XDG_CONFIG_HOME/csm/skills.json and overrides project", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { depth: "project", onlyProject: true } },
    });
    await writeJson(join(ctx.xdg, "csm", "skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { depth: "user" } },
    });
    const result = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.equal(result.effective.skills["csm-scan"].depth, "user");
    assert.equal(result.effective.skills["csm-scan"].onlyProject, true);
    assert.equal(result.sources.find((source) => source.kind === "user").present, true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("one explicit per-run path overrides defaults, project, and user", async () => {
  const ctx = await fixture();
  try {
    const runPath = join(ctx.root, "run-config.json");
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { depth: "project" }, "csm-grill": { from: "project" } },
    });
    await writeJson(join(ctx.xdg, "csm", "skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { depth: "user" }, "csm-plan": { from: "user" } },
    });
    await writeJson(runPath, {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { depth: "run" }, "csm-ddd": { from: "run" } },
    });
    const result = await resolveConfig({
      projectRoot: ctx.project,
      configPath: runPath,
      env: layerEnv(ctx),
    });
    const { skills } = result.effective;
    assert.equal(skills["csm-scan"].depth, "run");
    assert.equal(skills["csm-grill"].from, "project");
    assert.equal(skills["csm-plan"].from, "user");
    assert.equal(skills["csm-ddd"].from, "run");
    assert.deepEqual(
      result.sources.map((source) => source.kind),
      ["defaults", "project", "user", "run"],
    );
    for (const source of result.sources) {
      assert.equal(source.present, true, source.kind);
      assert.match(source.contentDigest, SHA256, source.kind);
    }
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("omitted keys inherit and objects merge recursively across layers", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-grill": { a: { x: 1, y: 2 }, keep: "project" } },
    });
    await writeJson(join(ctx.xdg, "csm", "skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-grill": { a: { z: 3 }, b: "user" } },
    });
    const result = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.deepEqual(result.effective.skills["csm-grill"], {
      a: { x: 1, y: 2, z: 3 },
      keep: "project",
      b: "user",
    });
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("mergeConfig replaces arrays wholesale, keeps explicit null, and merges objects", () => {
  assert.deepEqual(
    mergeConfig(
      { list: [1, 2, 3], nested: { items: [{ a: 1 }] } },
      { list: [9], nested: { items: [{ b: 2 }] } },
    ),
    { list: [9], nested: { items: [{ b: 2 }] } },
  );
  assert.deepEqual(mergeConfig({ value: { deep: true } }, { value: null }), { value: null });
  assert.deepEqual(mergeConfig({ value: null }, { value: { deep: true } }), {
    value: { deep: true },
  });
  assert.deepEqual(mergeConfig({ a: 1, b: 2 }, { b: undefined, c: 3 }), { a: 1, b: 2, c: 3 });
  assert.deepEqual(mergeConfig({ a: "old" }, { a: "new" }), { a: "new" });
  assert.deepEqual(mergeConfig({}, {}), {});
  assert.throws(() => mergeConfig(null, {}), TypeError);
  assert.throws(() => mergeConfig({}, []), TypeError);
  assert.throws(() => mergeConfig({}, "no"), TypeError);
});

test("mergeConfig does not pollute prototypes through __proto__ keys", () => {
  const overlay = JSON.parse('{"__proto__": {"polluted": true}, "real": 1}');
  const merged = mergeConfig({ safe: 1 }, overlay);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(merged["__proto__"], { polluted: true });
  assert.equal(merged.real, 1);
});

test("resolver keeps __proto__ inside a skill namespace as an own data value", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: JSON.parse('{"csm-scan": {"__proto__": {"polluted": true}, "real": 1}}'),
    });
    const result = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(result.effective), Object.prototype);
    assert.deepEqual(result.effective.skills["csm-scan"]["__proto__"], { polluted: true });
    assert.equal(result.effective.skills["csm-scan"].real, 1);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("expandEnvRefs performs one-pass ${VAR_NAME} substitution in string values only", () => {
  const env = { FOO: "foo", BAR: "bar" };
  const input = {
    plain: "no refs",
    single: "prefix-${FOO}",
    multi: "${FOO}-${BAR}-${FOO}",
    number: 42,
    keepNull: null,
    flag: true,
    list: ["x-${FOO}", 7, null],
    nested: { deep: { value: "${BAR}" } },
  };
  const { value, envRefs } = expandEnvRefs(input, { env });
  assert.deepEqual(value, {
    plain: "no refs",
    single: "prefix-foo",
    multi: "foo-bar-foo",
    number: 42,
    keepNull: null,
    flag: true,
    list: ["x-foo", 7, null],
    nested: { deep: { value: "bar" } },
  });
  assert.deepEqual(envRefs, ["BAR", "FOO"]);
  assert.deepEqual(input.plain, "no refs");
  assert.equal(input.single, "prefix-${FOO}");
});

test("expandEnvRefs does not expand keys, rescan substitutions, or accept bad grammar", () => {
  const kept = expandEnvRefs({ "${FOO}": "value" }, { env: { FOO: "foo" } });
  assert.deepEqual(Object.keys(kept.value), ["${FOO}"]);
  assert.deepEqual(kept.envRefs, []);

  const onePass = expandEnvRefs("${FOO}", { env: { FOO: "${BAR}", BAR: "inner" } });
  assert.equal(onePass.value, "${BAR}");

  const plain = expandEnvRefs("$FOO and $ {FOO} stay literal", { env: { FOO: "foo" } });
  assert.equal(plain.value, "$FOO and $ {FOO} stay literal");

  for (const bad of ["${9BAD}", "${BAD-NAME}", "${FOO", "closed ${FOO} then ${}", "${FOO BAR}"]) {
    assert.throws(
      () => expandEnvRefs(bad, { env: { FOO: "foo", BAR: "bar" } }),
      (error) => error.code === "invalid-env-ref" && error.message.includes(bad),
      `expected grammar rejection for ${bad}`,
    );
  }
  assert.throws(
    () => expandEnvRefs("value ${MISSING_VAR} here", { env: {} }),
    (error) => error.code === "missing-env" && error.message.includes("MISSING_VAR"),
  );
});

test("resolver expands environment references in values and records names only", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: {
        "csm-upload": {
          label: "run-${BUILD_ID}",
          targets: ["${REGION}", "static"],
          untouched: 5,
        },
      },
    });
    const result = await resolveConfig({
      projectRoot: ctx.project,
      env: layerEnv(ctx, { BUILD_ID: "1234", REGION: "eu" }),
    });
    assert.deepEqual(result.effective.skills["csm-upload"], {
      label: "run-1234",
      targets: ["eu", "static"],
      untouched: 5,
    });
    assert.deepEqual(result.envRefs, ["BUILD_ID", "REGION"]);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("resolver fails closed when a referenced variable is missing", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-upload": { label: "${ABSENT_VARIABLE}" } },
    });
    await assert.rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      (error) => error.code === "missing-env" && error.message.includes("ABSENT_VARIABLE"),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("equivalent inputs produce identical effective digests regardless of key order", async () => {
  const ctx = await fixture();
  try {
    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { alpha: 1, beta: 2 } },
    });
    const first = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    const repeat = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.equal(first.effectiveDigest, repeat.effectiveDigest);

    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { beta: 2, alpha: 1 } },
    });
    const reordered = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.equal(reordered.effectiveDigest, first.effectiveDigest);

    await writeJson(join(ctx.project, ".csm-skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { alpha: 1, beta: 3 } },
    });
    const changed = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    assert.notEqual(changed.effectiveDigest, first.effectiveDigest);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("provenance sources carry exactly kind, path, present, and contentDigest", async () => {
  const ctx = await fixture();
  try {
    const runPath = join(ctx.root, "run.json");
    await writeJson(join(ctx.xdg, "csm", "skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-plan": { a: 1 } },
    });
    await writeJson(runPath, { schema: "csm-skills-config/1", skills: {} });
    const result = await resolveConfig({
      projectRoot: ctx.project,
      configPath: runPath,
      env: layerEnv(ctx),
    });
    for (const source of result.sources) {
      assert.deepEqual(Object.keys(source).toSorted(), [
        "contentDigest",
        "kind",
        "path",
        "present",
      ]);
      assert.equal(typeof source.kind, "string");
    }
    const run = result.sources.find((source) => source.kind === "run");
    assert.equal(run.present, true);
    assert.match(run.contentDigest, SHA256);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("user layer falls back to $HOME/.config when XDG_CONFIG_HOME is unset", async () => {
  const ctx = await fixture();
  try {
    const home = join(ctx.root, "home-fallback");
    await writeJson(join(home, ".config", "csm", "skills.json"), {
      schema: "csm-skills-config/1",
      skills: { "csm-grill": { source: "home-fallback" } },
    });
    const result = await resolveConfig({ projectRoot: ctx.project, env: { HOME: home } });
    assert.equal(result.effective.skills["csm-grill"].source, "home-fallback");
    assert.equal(result.sources.find((source) => source.kind === "user").present, true);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});
