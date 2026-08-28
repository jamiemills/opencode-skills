import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { LIMITS, resolveConfig } from "../lib/config/index.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csm-config-security-"));
  const ctx = { root, project: join(root, "repo"), xdg: join(root, "xdg") };
  await mkdir(ctx.project, { recursive: true });
  await mkdir(ctx.xdg, { recursive: true });
  return ctx;
}

async function writeRaw(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function writeProject(ctx, value) {
  await writeRaw(join(ctx.project, ".csm-skills.json"), `${JSON.stringify(value, null, 2)}\n`);
}

function layerEnv(ctx, extra = {}) {
  return { XDG_CONFIG_HOME: ctx.xdg, HOME: join(ctx.root, "home"), ...extra };
}

const CONFIG = (skills) => ({ schema: "csm-skills-config/1", skills });

const nested = (depth) => {
  let value = { leaf: true };
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
};

async function rejects(resolvePromise, code, fragment) {
  await assert.rejects(
    resolvePromise,
    (error) => error.code === code && (!fragment || error.message.includes(fragment)),
    `expected code ${code}${fragment ? ` containing '${fragment}'` : ""}`,
  );
}

test("duplicate JSON object keys are rejected", async () => {
  const ctx = await fixture();
  try {
    await writeRaw(
      join(ctx.project, ".csm-skills.json"),
      '{"schema":"csm-skills-config/1","skills":{"csm-scan":{"a":1,"a":2}}}',
    );
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "invalid-json",
      "duplicate",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("malformed and empty config files are rejected", async () => {
  const ctx = await fixture();
  try {
    await writeRaw(join(ctx.project, ".csm-skills.json"), "{ not json ");
    await rejects(resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }), "invalid-json");
    await writeRaw(join(ctx.project, ".csm-skills.json"), "");
    await rejects(resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }), "invalid-json");
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("symbolic link config files are rejected in every layer", async () => {
  const ctx = await fixture();
  try {
    const realProject = join(ctx.root, "real-project.json");
    await writeRaw(realProject, `${JSON.stringify(CONFIG({ "csm-scan": { a: 1 } }))}\n`);
    await symlink(realProject, join(ctx.project, ".csm-skills.json"));
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "symlink",
      "symbolic link",
    );

    const realRun = join(ctx.root, "real-run.json");
    await writeRaw(realRun, `${JSON.stringify(CONFIG({}))}\n`);
    const runLink = join(ctx.root, "run-link.json");
    await symlink(realRun, runLink);
    await rejects(
      resolveConfig({ projectRoot: ctx.project, configPath: runLink, env: layerEnv(ctx) }),
      "symlink",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("symbolic link path components are rejected", async () => {
  const ctx = await fixture();
  try {
    const realXdg = join(ctx.root, "real-xdg");
    await writeRaw(
      join(realXdg, "csm", "skills.json"),
      `${JSON.stringify(CONFIG({ "csm-grill": { a: 1 } }))}\n`,
    );
    await symlink(realXdg, join(ctx.root, "xdg-link"));
    await rejects(
      resolveConfig({
        projectRoot: ctx.project,
        env: { XDG_CONFIG_HOME: join(ctx.root, "xdg-link") },
      }),
      "symlink",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("oversized config files are rejected before parsing", async () => {
  const ctx = await fixture();
  try {
    const oversized = {
      schema: "csm-skills-config/1",
      skills: { "csm-scan": { padding: `${"x".repeat(LIMITS.maxFileBytes)}` } },
    };
    await writeRaw(join(ctx.project, ".csm-skills.json"), JSON.stringify(oversized));
    const statInfo = await stat(join(ctx.project, ".csm-skills.json"));
    assert.ok(statInfo.size > LIMITS.maxFileBytes);
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "size-limit",
      String(LIMITS.maxFileBytes),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("deeply nested JSON beyond the depth limit is rejected, within it is accepted", async () => {
  const ctx = await fixture();
  try {
    await writeProject(ctx, CONFIG({ "csm-scan": nested(20) }));
    const accepted = await resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) });
    let leaf = accepted.effective.skills["csm-scan"];
    while (leaf.child) leaf = leaf.child;
    assert.equal(leaf.leaf, true);

    await writeProject(ctx, CONFIG({ "csm-scan": nested(40) }));
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "depth-limit",
      String(LIMITS.maxJsonDepth),
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("non-regular config paths are rejected", async () => {
  const ctx = await fixture();
  try {
    const directory = join(ctx.root, "a-directory");
    await mkdir(directory);
    await rejects(
      resolveConfig({ projectRoot: ctx.project, configPath: directory, env: layerEnv(ctx) }),
      "not-regular-file",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("unknown top-level keys and unknown skill namespaces are rejected with JSON paths", async () => {
  const ctx = await fixture();
  try {
    await writeProject(ctx, { schema: "csm-skills-config/1", skills: {}, extra: true });
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "unknown-key",
      "'extra' at /extra",
    );

    await writeProject(ctx, CONFIG({ "csm-typo-skill": {} }));
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "unknown-skill",
      "'csm-typo-skill' at /skills/csm-typo-skill",
    );

    await writeProject(ctx, CONFIG({ "csm-scan": "flat" }));
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "config-schema",
      "/skills/csm-scan",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("wrong schema identity or version is rejected", async () => {
  const ctx = await fixture();
  try {
    await writeProject(ctx, { schema: "csm-skills-config/2", skills: {} });
    await rejects(resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }), "config-schema");

    await writeProject(ctx, { schema: "csm-skills-config/1", version: 2, skills: {} });
    await rejects(
      resolveConfig({ projectRoot: ctx.project, env: layerEnv(ctx) }),
      "config-schema",
      "version",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("a missing explicit per-run config path fails closed", async () => {
  const ctx = await fixture();
  try {
    await rejects(
      resolveConfig({
        projectRoot: ctx.project,
        configPath: join(ctx.root, "does-not-exist.json"),
        env: layerEnv(ctx),
      }),
      "missing-config",
      "does-not-exist.json",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("invalid options are rejected as type errors", async () => {
  const ctx = await fixture();
  try {
    await assert.rejects(
      resolveConfig({ projectRoot: ctx.project, configPath: "", env: layerEnv(ctx) }),
      TypeError,
    );
    await assert.rejects(
      resolveConfig({ projectRoot: ctx.project, configPath: 42, env: layerEnv(ctx) }),
      TypeError,
    );
    await assert.rejects(resolveConfig({ projectRoot: "", env: layerEnv(ctx) }), TypeError);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});

test("every layer is parsed and validated before merge: malformed lower layers still fail closed", async () => {
  const ctx = await fixture();
  try {
    const runPath = join(ctx.root, "run.json");
    await writeRaw(
      join(ctx.xdg, "csm", "skills.json"),
      '{"schema":"csm-skills-config/1","skills":{},"skills":{}}',
    );
    await writeRaw(runPath, `${JSON.stringify(CONFIG({ "csm-plan": { a: 1 } }))}\n`);
    await rejects(
      resolveConfig({ projectRoot: ctx.project, configPath: runPath, env: layerEnv(ctx) }),
      "invalid-json",
    );
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
});
