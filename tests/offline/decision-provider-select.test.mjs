"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createProviderRegistry,
  DEFAULT_PROVIDER_ID,
  PROVIDER_SELECTION_ENV,
} from "../../csm-orchestrate/lib/decision-adapter/providers/index.mjs";
import { createDecisionTransport } from "../../csm-orchestrate/lib/decision-adapter/transport.mjs";

const OPENROUTER_SOURCE_URL = new URL(
  "../../csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs",
  import.meta.url,
);

const VERCEL_FIXTURE = `export default {
  id: "vercel",
  endpoint: "https://ai-gateway.vercel.sh/v1/evaluate",
  apiKeyEnv: "AI_GATEWAY_API_KEY",
  defaultModel: "typesafe-ai/jev",
  buildRequest: (input) => ({
    url: "https://ai-gateway.vercel.sh/v1/evaluate",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + (input.env?.AI_GATEWAY_API_KEY ?? ""),
    },
    body: { model: "typesafe-ai/jev", state: input.state ?? null, questions: input.questions ?? [] },
  }),
  parseResponse: (json) => ({ answer: json?.choice ?? null, confidence: null, usage: {} }),
  classifyError: (status) => ({
    class: status === 401 ? "authentication" : "unmapped",
    retryable: false,
  }),
};
`;

async function withProvidersDir(t, files) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-select-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source);
  return dir;
}

test("with an empty env the registry selects the default openrouter provider", async () => {
  const registry = await createProviderRegistry({ env: {} });
  assert.equal(registry.requestedId, DEFAULT_PROVIDER_ID);
  assert.equal(registry.requestedId, "openrouter");
  assert.equal(registry.unresolved, false);
  assert.ok(registry.ids().includes("openrouter"));

  const selection = registry.select();
  assert.equal(selection.id, "openrouter");
  assert.equal(selection.unresolved, false);
  assert.equal(selection.descriptor.defaultModel, "typesafe/jev-1.13");
});

test("the default transport sends through openrouter when a key is present", async () => {
  const registry = await createProviderRegistry({ env: {} });
  const env = { OPENROUTER_ROUTER_KEY: "sk-default-openrouter" };
  const calls = [];
  const transport = createDecisionTransport({
    provider: registry.select().descriptor,
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choice: "csm-scan", confidence: 0.5 }), { status: 200 });
    },
  });
  const result = await transport.send({ state: { a: 1 }, questions: ["q"] });

  assert.equal(result.ok, true);
  assert.equal(result.decision.answer, "csm-scan");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(calls[0].init.headers.authorization, "Bearer sk-default-openrouter");
});

test("an unknown provider id is unresolved and the transport fails open without a request", async () => {
  const env = { [PROVIDER_SELECTION_ENV]: "unknown" };
  const registry = await createProviderRegistry({ env });
  assert.equal(registry.unresolved, true);
  const selection = registry.select();
  assert.equal(selection.unresolved, true);
  assert.equal(selection.descriptor, null);
  assert.equal(selection.reason, "unknown-provider");

  const calls = [];
  const transport = createDecisionTransport({
    provider: selection.descriptor,
    env,
    fetchImpl: async (...args) => {
      calls.push(args);
      throw new Error("network must not be reached for an unresolved provider");
    },
  });
  const result = await transport.send({ state: {}, questions: [] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failure, { class: "unresolved_provider", retryable: false });
  assert.equal(calls.length, 0);
});

test("selecting vercel never leaks the openrouter key", async (t) => {
  const realOpenrouter = await readFile(OPENROUTER_SOURCE_URL, "utf8");
  const dir = await withProvidersDir(t, {
    "openrouter.mjs": realOpenrouter,
    "vercel.mjs": VERCEL_FIXTURE,
  });
  const env = {
    [PROVIDER_SELECTION_ENV]: "vercel",
    OPENROUTER_ROUTER_KEY: "sk-openrouter-secret",
    AI_GATEWAY_API_KEY: "gw-gateway-key",
  };
  const registry = await createProviderRegistry({ providersDir: dir, env });
  const selection = registry.select();
  assert.equal(selection.unresolved, false);
  assert.equal(selection.id, "vercel");
  assert.equal(selection.descriptor.defaultModel, "typesafe-ai/jev");

  const calls = [];
  const transport = createDecisionTransport({
    provider: selection.descriptor,
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choice: "csm-scan" }), { status: 200 });
    },
  });
  const result = await transport.send({ state: {}, questions: [] });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ai-gateway.vercel.sh/v1/evaluate");
  assert.equal(calls[0].init.headers.authorization, "Bearer gw-gateway-key");
  assert.ok(!JSON.stringify(calls[0]).includes("sk-openrouter-secret"));
  assert.ok(!JSON.stringify(result).includes("sk-openrouter-secret"));
});
