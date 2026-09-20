"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ENV_FILE,
  parseDotEnv,
  resolveApiKey,
} from "../../csm-orchestrate/lib/decision-adapter/key-resolution.mjs";

test("parseDotEnv reads simple KEY=VALUE lines and skips malformed ones", () => {
  const parsed = parseDotEnv(
    [
      "# comment",
      "OPENROUTER_ROUTER_KEY=abc123",
      "QUOTED='quoted value'",
      'DQUOTED="double value"',
      "not a line",
      "EMPTY=",
      "=novalue",
    ].join("\n"),
  );
  assert.equal(parsed.OPENROUTER_ROUTER_KEY, "abc123");
  assert.equal(parsed.QUOTED, "quoted value");
  assert.equal(parsed.DQUOTED, "double value");
  assert.equal(parsed.EMPTY, "");
  assert.equal(Object.hasOwn(parsed, ""), false);
  assert.equal(parseDotEnv(null).OPENROUTER_ROUTER_KEY, undefined);
});

test("environment takes precedence over the .env file", async () => {
  const result = await resolveApiKey({
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
    env: { OPENROUTER_ROUTER_KEY: "from-env" },
    readFileImpl: async () => "OPENROUTER_ROUTER_KEY=from-file",
    repoRoot: "/repo",
  });
  assert.deepEqual(result, { key: "from-env", source: "env", apiKeyEnv: "OPENROUTER_ROUTER_KEY" });
});

test("falls back to the repository .env when the env var is unset or blank", async () => {
  const result = await resolveApiKey({
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
    env: { OPENROUTER_ROUTER_KEY: "   " },
    readFileImpl: async (path) => {
      assert.ok(path.endsWith(`/${DEFAULT_ENV_FILE}`));
      return "OPENROUTER_ROUTER_KEY=from-file\nAI_GATEWAY_API_KEY=other\n";
    },
    repoRoot: "/repo",
  });
  assert.equal(result.key, "from-file");
  assert.equal(result.source, "env-file");
});

async function readVercelOnlyEnv() {
  return "AI_GATEWAY_API_KEY=vercel-secret\n";
}

test("provider isolation: a provider only reads its own apiKeyEnv name", async () => {
  const readFileImpl = readVercelOnlyEnv;
  const openrouter = await resolveApiKey({
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
    env: {},
    readFileImpl,
    repoRoot: "/repo",
  });
  assert.equal(openrouter.key, null);
  assert.equal(openrouter.source, "missing");
  const vercel = await resolveApiKey({
    apiKeyEnv: "AI_GATEWAY_API_KEY",
    env: {},
    readFileImpl,
    repoRoot: "/repo",
  });
  assert.equal(vercel.key, "vercel-secret");
});

test("a missing env file and missing key is a fail-open missing result, never a throw", async () => {
  const result = await resolveApiKey({
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
    env: {},
    readFileImpl: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    repoRoot: "/repo",
  });
  assert.deepEqual(result, {
    key: null,
    source: "missing",
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
  });
});

test("resolveApiKey validates the env name and never returns the key in diagnostics", async () => {
  await assert.rejects(
    () => resolveApiKey({ apiKeyEnv: "not a name", env: {} }),
    /environment variable name/,
  );
  const result = await resolveApiKey({
    apiKeyEnv: "OPENROUTER_ROUTER_KEY",
    env: { OPENROUTER_ROUTER_KEY: "super-secret" },
  });
  assert.ok(!JSON.stringify({ ...result, key: undefined }).includes("super-secret"));
});
