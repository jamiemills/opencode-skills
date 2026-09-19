"use strict";

// T020: hermetic telemetry coverage for the published cap defaults and the
// per-applied `csm-decision/1` record. No network: the live case drives the
// adapter with a fake transport, and every write targets a temp directory.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSchemaValidator, parseJson } from "../../lib/schema-runtime/index.mjs";
import {
  buildAuditRecord,
  DECISION_TELEMETRY_FIELDS,
  findCredentialShapes,
  normalizeDecisionUsage,
  writeDecisionArtifact,
} from "../../csm-orchestrate/lib/decision-adapter/artifact.mjs";
import {
  createDecisionAdapter,
  DECISION_ADAPTER_DEFAULTS,
  DEFAULT_DECISION_DEADLINE_MS,
  DEFAULT_DECISION_MAX_COST,
  DEFAULT_DECISION_MAX_STATE_BYTES,
  DEFAULT_MAX_CALLS_PER_POINT,
} from "../../csm-orchestrate/lib/decision-adapter/index.mjs";

const POINT = "route-classification";
const STATE_DIGEST = `sha256:${"a".repeat(64)}`;
const SCHEMA = parseJson(
  await readFile(
    new URL("../../csm-orchestrate/schemas/csm-decision.schema.json", import.meta.url),
    "utf8",
  ),
);
const validator = createSchemaValidator({ schemas: [SCHEMA] });

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-telemetry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the cap defaults are published, frozen, and match the adapter constants", () => {
  assert.ok(Object.isFrozen(DECISION_ADAPTER_DEFAULTS), "defaults must be frozen");
  assert.deepEqual(Object.keys(DECISION_ADAPTER_DEFAULTS).toSorted(), [
    "deadlineMs",
    "maxCallsPerPoint",
    "maxCost",
    "maxStateBytes",
  ]);
  assert.equal(DECISION_ADAPTER_DEFAULTS.deadlineMs, DEFAULT_DECISION_DEADLINE_MS);
  assert.equal(DECISION_ADAPTER_DEFAULTS.maxStateBytes, DEFAULT_DECISION_MAX_STATE_BYTES);
  assert.equal(DECISION_ADAPTER_DEFAULTS.maxCost, DEFAULT_DECISION_MAX_COST);
  assert.equal(DECISION_ADAPTER_DEFAULTS.maxCallsPerPoint, DEFAULT_MAX_CALLS_PER_POINT);

  for (const key of ["deadlineMs", "maxStateBytes", "maxCallsPerPoint"])
    assert.ok(
      Number.isInteger(DECISION_ADAPTER_DEFAULTS[key]) && DECISION_ADAPTER_DEFAULTS[key] > 0,
      `${key} must be a positive integer`,
    );
  assert.ok(
    DECISION_ADAPTER_DEFAULTS.maxCost === null ||
      (Number.isFinite(DECISION_ADAPTER_DEFAULTS.maxCost) &&
        DECISION_ADAPTER_DEFAULTS.maxCost >= 0),
    "maxCost must be a non-negative number or null",
  );

  // The adapter applies exactly the published defaults when no override is given.
  const stats = createDecisionAdapter({ mode: "off" }).stats();
  assert.equal(stats.deadlineMs, DECISION_ADAPTER_DEFAULTS.deadlineMs);
  assert.equal(stats.maxStateBytes, DECISION_ADAPTER_DEFAULTS.maxStateBytes);
  assert.equal(stats.maxCost, DECISION_ADAPTER_DEFAULTS.maxCost);
  assert.equal(stats.maxCallsPerPoint, DECISION_ADAPTER_DEFAULTS.maxCallsPerPoint);

  assert.deepEqual(DECISION_TELEMETRY_FIELDS, ["provider", "usage", "latencyMs"]);
});

test("a written record carries provider.id/model, normalized usage, and latencyMs", async (t) => {
  const dir = await tempDir(t);
  const runId = "run-telemetry-openrouter-001";
  const result = await writeDecisionArtifact({
    runId,
    records: [
      {
        pointId: POINT,
        answer: { type: "choice", choice: "csm-scan" },
        confidence: 0.7,
        routingBand: "apply",
        applied: true,
        stateDigest: STATE_DIGEST,
        baseline: { answer: { type: "choice", choice: "csm-scan" } },
        provider: { id: "openrouter", model: "typesafe/jev-1.13" },
        // Snapshot-shaped aliases plus an unknown key: all must normalize.
        usage: { input_tokens: 11, completion_tokens: 7, total_cost: 0.0004, ignored: "drop-me" },
        latencyMs: 42,
      },
    ],
    outputDir: dir,
  });

  const [entry] = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(entry.provider.id, "openrouter");
  assert.equal(entry.provider.model, "typesafe/jev-1.13");
  assert.deepEqual(entry.usage, { inputTokens: 11, outputTokens: 7, cost: 0.0004 });
  assert.equal(entry.latencyMs, 42);
  assert.equal(entry.baselineAgreement, true);
  assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("a provider that reports no cost yields a record with no fabricated cost", async (t) => {
  const dir = await tempDir(t);
  const runId = "run-telemetry-vercel-002";
  const transport = {
    providerId: "vercel",
    providerModel: "typesafe-ai/jev",
    send: async () => ({
      ok: true,
      decision: {
        answer: "csm-scan",
        confidence: 0.9,
        usage: { inputTokens: 5, outputTokens: 2, ignored: 1 },
      },
    }),
  };
  const adapter = createDecisionAdapter({ mode: "live", transport, runId });
  const applied = await adapter.decide(POINT, {
    request: "route this",
    baselineAnswer: "csm-scan",
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.advice.providerId, "vercel");
  assert.equal(applied.advice.providerModel, "typesafe-ai/jev");
  assert.ok(Number.isFinite(applied.advice.latencyMs) && applied.advice.latencyMs >= 0);

  const result = await writeDecisionArtifact({ runId, records: [applied], outputDir: dir });
  const [entry] = JSON.parse(await readFile(result.path, "utf8"));

  assert.equal(entry.provider.id, "vercel");
  assert.equal(entry.provider.model, "typesafe-ai/jev");
  assert.equal(Object.hasOwn(entry.usage, "cost"), false, "cost must not be invented");
  assert.deepEqual(entry.usage, { inputTokens: 5, outputTokens: 2 });
  assert.equal(Object.hasOwn(entry.usage, "ignored"), false, "unknown usage keys are dropped");
  assert.ok(Number.isFinite(entry.latencyMs) && entry.latencyMs >= 0);
  assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("normalizeDecisionUsage omits cost and drops unknown keys", () => {
  assert.deepEqual(normalizeDecisionUsage({ inputTokens: 3, outputTokens: 4 }), {
    inputTokens: 3,
    outputTokens: 4,
  });
  assert.deepEqual(
    normalizeDecisionUsage({
      prompt_tokens: 2,
      completion_tokens: 1,
      total_cost: 0.5,
      extra: true,
    }),
    { inputTokens: 2, outputTokens: 1, cost: 0.5 },
  );
  assert.deepEqual(normalizeDecisionUsage(null), {});
});

test("a LIVE fake-transport decision carries the provider's real model, never unspecified", async (t) => {
  const dir = await tempDir(t);
  const runId = "run-telemetry-model-004";
  const transport = {
    providerId: "openrouter",
    providerModel: "typesafe/jev-1.13",
    send: async () => ({
      ok: true,
      decision: { answer: "csm-scan", confidence: 0.6, usage: { inputTokens: 4 } },
    }),
  };
  const adapter = createDecisionAdapter({ mode: "live", transport, runId });
  const applied = await adapter.decide(POINT, {
    request: "route this",
    baselineAnswer: "csm-scan",
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.advice.providerId, "openrouter");
  assert.equal(applied.advice.providerModel, "typesafe/jev-1.13");

  const result = await writeDecisionArtifact({ runId, records: [applied], outputDir: dir });
  const [entry] = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(entry.provider.id, "openrouter");
  assert.equal(entry.provider.model, "typesafe/jev-1.13");
  assert.notEqual(entry.provider.model, "unspecified");
  assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("a written telemetry record never contains key-shaped material", async (t) => {
  const dir = await tempDir(t);
  const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";
  const record = buildAuditRecord({
    runId: "run-telemetry-redaction-003",
    decision: {
      pointId: POINT,
      answer: { type: "choice", choice: "csm-scan" },
      applied: true,
      routingBand: "apply",
      stateDigest: STATE_DIGEST,
    },
    baseline: { answer: { type: "choice", choice: "csm-scan" } },
    provider: { id: "openrouter", model: "typesafe/jev-1.13" },
    usage: { inputTokens: 1 },
    latencyMs: 3,
    sessionId: secret,
  });

  const result = await writeDecisionArtifact({
    runId: "run-telemetry-redaction-003",
    records: [record],
    env: { OPENROUTER_ROUTER_KEY: secret },
    outputDir: dir,
  });
  const text = await readFile(result.path, "utf8");

  assert.ok(!text.includes(secret), "secret must not survive in the artifact");
  assert.deepEqual(findCredentialShapes(JSON.parse(text)), []);
});
