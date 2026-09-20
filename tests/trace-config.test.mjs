import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveTraceLogPath } from "../scripts/lib/trace-config.mjs";

function envelope(namespace = {}) {
  return { schema: "csm-skills-config/1", version: 1, skills: { "csm-orchestrate": namespace } };
}

// Hermetic fixture: HOME and XDG_CONFIG_HOME point inside a throwaway temp dir,
// and the repo layer is a real (temp) git repo so repoMainRoot(root) === repo.
// Nothing below can touch the developer's real ~/.config.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csm-trace-config-"));
  const repo = join(root, "repo");
  const xdg = join(root, "xdg");
  const home = join(root, "home");
  await mkdir(repo, { recursive: true });
  await mkdir(xdg, { recursive: true });
  await mkdir(home, { recursive: true });
  const git = spawnSync("git", ["init", "-q"], { cwd: repo, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr ?? "git init failed");
  return { root, repo, xdg, home, env: { XDG_CONFIG_HOME: xdg, HOME: home } };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeRaw(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

const projectFile = (ctx) => join(ctx.repo, ".csm-skills.json");
const userFile = (ctx) => join(ctx.xdg, "csm", "skills.json");

async function withFixture(body) {
  const ctx = await fixture();
  try {
    await body(ctx);
  } finally {
    await rm(ctx.root, { recursive: true, force: true });
  }
}

test("an escaping relative project traceLogPath fails safe to null (no fall-through)", async () => {
  await withFixture(async (ctx) => {
    await writeJson(
      projectFile(ctx),
      envelope({ traceLogPath: "../../../../tmp/evil/trace.jsonl" }),
    );
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
  });
});

test("an escaping relative user traceLogPath fails safe to null", async () => {
  await withFixture(async (ctx) => {
    await writeJson(userFile(ctx), envelope({ traceLogPath: "../evil/trace.jsonl" }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
  });
});

test("absolute CSM_TRACE_LOG override wins over both config layers", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), envelope({ traceLogPath: "/proj/trace.jsonl" }));
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    const env = { ...ctx.env, CSM_TRACE_LOG: "/env/trace.jsonl" };
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env }), "/env/trace.jsonl");
  });
});

test("empty-string CSM_TRACE_LOG is ignored and falls through to the project layer", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), envelope({ traceLogPath: "/proj/trace.jsonl" }));
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    const env = { ...ctx.env, CSM_TRACE_LOG: "" };
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env }), "/proj/trace.jsonl");
  });
});

test("non-absolute CSM_TRACE_LOG is ignored and falls through to the project layer", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), envelope({ traceLogPath: "/proj/trace.jsonl" }));
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    const env = { ...ctx.env, CSM_TRACE_LOG: "relative/trace.jsonl" };
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env }), "/proj/trace.jsonl");
  });
});

test("project layer overrides the user layer for this key", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), envelope({ traceLogPath: "/proj/trace.jsonl" }));
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), "/proj/trace.jsonl");
  });
});

test("user layer is used when no project config exists", async () => {
  await withFixture(async (ctx) => {
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), "/user/trace.jsonl");
  });
});

test("user layer falls back to $HOME/.config when XDG_CONFIG_HOME is unset", async () => {
  await withFixture(async (ctx) => {
    await writeJson(
      join(ctx.home, ".config", "csm", "skills.json"),
      envelope({ traceLogPath: "/home/trace.jsonl" }),
    );
    const env = { HOME: ctx.home };
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env }), "/home/trace.jsonl");
  });
});

test("null when neither layer configures the key", async () => {
  await withFixture(async (ctx) => {
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
    await writeJson(projectFile(ctx), envelope());
    await writeJson(userFile(ctx), envelope({ unrelated: true }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
  });
});

test("a malformed project file yields null and never throws (no fallback to user)", async () => {
  await withFixture(async (ctx) => {
    await writeRaw(projectFile(ctx), "{ not json");
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    await assert.doesNotReject(async () => {
      assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
    });
  });
});

test("a malformed user file yields null and never throws", async () => {
  await withFixture(async (ctx) => {
    await writeRaw(userFile(ctx), "{ not json");
    await assert.doesNotReject(async () => {
      assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
    });
  });
});

test("a duplicate-key JSON file yields null and never throws", async () => {
  await withFixture(async (ctx) => {
    await writeRaw(
      projectFile(ctx),
      '{"schema":"csm-skills-config/1","schema":"csm-skills-config/1","skills":{"csm-orchestrate":{"traceLogPath":"/dup"}}}',
    );
    await assert.doesNotReject(async () => {
      assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
    });
  });
});

test("a non-CSM JSON document is not sourced (fail-safe null)", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), { traceLogPath: "/proj/trace.jsonl" });
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), null);
  });
});

test("a present-but-invalid envelope never falls through to a valid user layer", async () => {
  const configured = { "csm-orchestrate": { traceLogPath: "/proj/trace.jsonl" } };
  const invalidEnvelopes = {
    "bad version": { schema: "csm-skills-config/1", version: 2, skills: configured },
    "unknown top-level key": {
      schema: "csm-skills-config/1",
      version: 1,
      extra: true,
      skills: configured,
    },
    "non-object csm-orchestrate namespace": {
      schema: "csm-skills-config/1",
      version: 1,
      skills: { "csm-orchestrate": "/proj/trace.jsonl" },
    },
    "non-object skills": { schema: "csm-skills-config/1", version: 1, skills: "nope" },
  };
  for (const [label, invalidEnvelope] of Object.entries(invalidEnvelopes)) {
    await withFixture(async (ctx) => {
      await writeJson(projectFile(ctx), invalidEnvelope);
      await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
      assert.equal(
        await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }),
        null,
        `${label}: invalid project layer fails safe to null`,
      );
    });
  }
});

test("an empty traceLogPath value is treated as not configured", async () => {
  await withFixture(async (ctx) => {
    await writeJson(projectFile(ctx), envelope({ traceLogPath: "" }));
    await writeJson(userFile(ctx), envelope({ traceLogPath: "/user/trace.jsonl" }));
    assert.equal(await resolveTraceLogPath({ root: ctx.repo, env: ctx.env }), "/user/trace.jsonl");
  });
});
