"use strict";

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProviderRegistry } from "../../csm-orchestrate/lib/decision-adapter/providers/index.mjs";

const PROVIDERS_INDEX_URL = new URL(
  "../../csm-orchestrate/lib/decision-adapter/providers/index.mjs",
  import.meta.url,
);
const DECISION_ADAPTER_INDEX_URL = new URL(
  "../../csm-orchestrate/lib/decision-adapter/index.mjs",
  import.meta.url,
);

const FIXTURE_PROVIDER_ID = "acme";

const ACME_FIXTURE = `export default {
  id: "acme",
  endpoint: "https://acme.example/v1/decisions",
  apiKeyEnv: "ACME_DECISION_KEY",
  defaultModel: "acme-control-1",
  buildRequest: (input) => ({
    url: "https://acme.example/v1/decisions",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + (input.env?.ACME_DECISION_KEY ?? ""),
    },
    body: { model: "acme-control-1", state: input.state ?? null, questions: input.questions ?? [] },
  }),
  parseResponse: (json) => ({ answer: json?.answer ?? null, confidence: null, usage: {} }),
  classifyError: (status) => ({
    class: status === 401 ? "authentication" : "unmapped",
    retryable: false,
  }),
};
`;

const MALFORMED_FIXTURE = `export default {
  id: "broken",
  endpoint: "https://broken.example/v1/decisions",
};
`;

async function withTempProvidersDir(t, files) {
  const base = await mkdtemp(join(tmpdir(), "csm-decision-discovery-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const providersDir = join(base, "providers");
  await mkdir(providersDir, { recursive: true });
  for (const [name, source] of Object.entries(files))
    await writeFile(join(providersDir, name), source);
  return providersDir;
}

test("discovers a third provider by descriptor filename convention and resolves it", async (t) => {
  const providersDir = await withTempProvidersDir(t, { "acme.mjs": ACME_FIXTURE });
  const registry = await createProviderRegistry({
    providersDir,
    env: { CSM_DECISION_PROVIDER: FIXTURE_PROVIDER_ID },
  });

  assert.equal(registry.requestedId, FIXTURE_PROVIDER_ID);
  assert.equal(registry.unresolved, false);
  assert.ok(registry.ids().includes(FIXTURE_PROVIDER_ID));

  const descriptor = registry.resolve(FIXTURE_PROVIDER_ID);
  assert.equal(descriptor.id, FIXTURE_PROVIDER_ID);
  assert.equal(descriptor.defaultModel, "acme-control-1");
  assert.equal(typeof descriptor.buildRequest, "function");
  assert.equal(typeof descriptor.parseResponse, "function");
  assert.equal(typeof descriptor.classifyError, "function");

  const selection = registry.select();
  assert.equal(selection.id, FIXTURE_PROVIDER_ID);
  assert.equal(selection.unresolved, false);
  assert.equal(selection.descriptor, descriptor);
});

test("extension is descriptor-only: registry sources contain no acme id or hard-coded switch", async () => {
  const [providersSource, adapterSource] = await Promise.all([
    readFile(PROVIDERS_INDEX_URL, "utf8"),
    readFile(DECISION_ADAPTER_INDEX_URL, "utf8"),
  ]);

  for (const [name, source] of [
    ["providers/index.mjs", providersSource],
    ["decision-adapter/index.mjs", adapterSource],
  ]) {
    assert.ok(
      !source.includes(FIXTURE_PROVIDER_ID),
      `${name} must not contain the fixture provider id ${FIXTURE_PROVIDER_ID}`,
    );
  }

  assert.ok(
    !/\bswitch\s*\(/.test(providersSource),
    "providers/index.mjs must not contain a hard-coded provider switch statement",
  );
  assert.ok(
    !/case\s+["'`]/.test(providersSource),
    "providers/index.mjs must not dispatch providers through literal switch cases",
  );
});

test("a malformed sibling descriptor is quarantined without blocking a valid provider", async (t) => {
  const providersDir = await withTempProvidersDir(t, {
    "acme.mjs": ACME_FIXTURE,
    "broken.mjs": MALFORMED_FIXTURE,
  });
  const registry = await createProviderRegistry({
    providersDir,
    env: { CSM_DECISION_PROVIDER: FIXTURE_PROVIDER_ID },
  });

  const invalid = registry.invalid();
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].id, "broken");
  assert.equal(invalid[0].file, "broken.mjs");
  assert.match(invalid[0].error, /invalid provider descriptor broken/);

  assert.equal(registry.unresolved, false);
  assert.ok(registry.resolve("broken") === null);
  assert.equal(registry.resolve(FIXTURE_PROVIDER_ID).id, FIXTURE_PROVIDER_ID);
  assert.equal(registry.select().unresolved, false);
});
