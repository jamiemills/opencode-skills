"use strict";

// F2: the live-path artifact wiring. `persistAdapterDecisions` is the call site
// the orchestrator driver uses after its decision path completes. No network:
// every case drives a fake transport and writes only to a temp output dir.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDecisionAdapter } from "../../csm-orchestrate/lib/decision-adapter/index.mjs";
import {
  findCredentialShapes,
  persistAdapterDecisions,
} from "../../csm-orchestrate/lib/decision-adapter/artifact.mjs";

const POINT = "route-classification";
const RUN_ID = "run-jev-wiring-001";
const STATE = { request: "route this", baselineAnswer: "csm-scan" };

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-wiring-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeTransport(overrides = {}) {
  return {
    providerId: "openrouter",
    providerModel: "typesafe/jev-1.13",
    send: async () => ({
      ok: true,
      decision: { answer: "csm-scan", confidence: 0.7, usage: { inputTokens: 9 } },
    }),
    ...overrides,
  };
}

test("a live fake-transport run persists one redacted run artifact", async (t) => {
  const dir = await tempDir(t);
  const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";
  const adapter = createDecisionAdapter({
    mode: "live",
    transport: fakeTransport(),
    runId: RUN_ID,
  });
  await adapter.decide(POINT, STATE);
  assert.equal(adapter.records().length, 1);
  assert.equal(adapter.records()[0].applied, true);

  const result = await persistAdapterDecisions({
    adapter,
    runId: RUN_ID,
    env: { OPENROUTER_ROUTER_KEY: secret },
    outputDir: dir,
  });

  assert.ok(result, "an active adapter with an applied record must write");
  assert.equal(result.runId, RUN_ID);
  assert.equal(result.recordCount, 1);
  assert.equal(result.redacted, true);
  assert.equal(result.path, join(dir, `${RUN_ID}.json`));

  const text = await readFile(result.path, "utf8");
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed) && parsed.length === 1);
  assert.equal(parsed[0].schema, "csm-decision/1");
  assert.equal(parsed[0].provider.model, "typesafe/jev-1.13");
  assert.notEqual(parsed[0].provider.model, "unspecified");
  assert.ok(!text.includes(secret), "env secret must not survive");
  assert.deepEqual(findCredentialShapes(parsed), []);
});

test("nothing is written without an active adapter, applied record, or real runId", async (t) => {
  const dir = await tempDir(t);
  const live = createDecisionAdapter({ mode: "live", transport: fakeTransport(), runId: RUN_ID });
  const off = createDecisionAdapter({ mode: "off", transport: fakeTransport(), runId: RUN_ID });
  const shadow = createDecisionAdapter({
    mode: "shadow",
    transport: fakeTransport(),
    runId: RUN_ID,
  });
  await shadow.decide(POINT, STATE);
  assert.equal(shadow.records().length, 1);
  assert.equal(shadow.records()[0].applied, false);

  for (const call of [
    { adapter: null, runId: RUN_ID },
    { adapter: off, runId: RUN_ID },
    { adapter: shadow, runId: RUN_ID },
    { adapter: live, runId: null },
    { adapter: live, runId: "not-a-run-id" },
  ]) {
    const result = await persistAdapterDecisions({ ...call, outputDir: dir });
    assert.equal(result, null);
  }
  // A live adapter with no consulted decision writes nothing either.
  assert.equal(
    await persistAdapterDecisions({ adapter: live, runId: RUN_ID, outputDir: dir }),
    null,
  );
});

test("fail-open: a write error never throws into the run", async (t) => {
  const dir = await tempDir(t);
  const adapter = createDecisionAdapter({
    mode: "live",
    transport: fakeTransport(),
    runId: RUN_ID,
  });
  await adapter.decide(POINT, STATE);
  // A file where a directory must be makes mkdir throw; the wiring seam must
  // swallow it and return null rather than failing the run.
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "not a directory\n");
  const result = await persistAdapterDecisions({
    adapter,
    runId: RUN_ID,
    outputDir: join(blocker, "decisions"),
  });
  assert.equal(result, null);
});
