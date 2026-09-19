"use strict";

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSchemaValidator, parseJson } from "../../lib/schema-runtime/index.mjs";
import {
  buildAuditRecord,
  findCredentialShapes,
  redactDecisionArtifact,
  writeDecisionArtifact,
} from "../../csm-orchestrate/lib/decision-adapter/artifact.mjs";

const RUN_ID = "run-jev-optin-artifact-001";
const STATE_DIGEST = `sha256:${"a".repeat(64)}`;
const SCHEMA = parseJson(
  await readFile(
    new URL("../../csm-orchestrate/schemas/csm-decision.schema.json", import.meta.url),
    "utf8",
  ),
);
const validator = createSchemaValidator({ schemas: [SCHEMA] });

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-artifact-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function auditRecord({ decision = {}, build = {}, baseline = undefined } = {}) {
  return buildAuditRecord({
    runId: RUN_ID,
    decision: {
      pointId: "route-classification",
      answer: { type: "choice", choice: "csm-scan" },
      confidence: 0.8,
      routingBand: "apply",
      applied: true,
      stateDigest: STATE_DIGEST,
      ...decision,
    },
    provider: { id: "openrouter", model: "typesafe/jev-1.13" },
    usage: { inputTokens: 11, outputTokens: 7, cost: 0.0004 },
    latencyMs: 42,
    ...(baseline === undefined
      ? { baseline: { answer: { type: "choice", choice: "csm-scan" } } }
      : { baseline }),
    ...build,
  });
}

test("writes one run file with the expected per-applied audit fields", async (t) => {
  const dir = await tempDir(t);
  const result = await writeDecisionArtifact({
    runId: RUN_ID,
    records: [auditRecord()],
    outputDir: dir,
    indexer: async () => {
      throw new Error("indexer must not run for a temp output dir");
    },
  });

  assert.equal(result.recordCount, 1);
  assert.equal(result.relativePath, `.agents/decisions/${RUN_ID}.json`);
  assert.equal(result.path, join(dir, `${RUN_ID}.json`));
  assert.equal(result.redacted, true);

  const parsed = JSON.parse(await readFile(result.path, "utf8"));
  assert.ok(Array.isArray(parsed), "run file is a JSON array of records");
  assert.equal(parsed.length, 1);
  const [entry] = parsed;
  assert.equal(entry.schema, "csm-decision/1");
  assert.equal(entry.pointId, "route-classification");
  assert.equal(entry.baselineAgreement, true);
  assert.equal(entry.provider.id, "openrouter");
  assert.equal(entry.provider.model, "typesafe/jev-1.13");
  assert.deepEqual(entry.usage, { inputTokens: 11, outputTokens: 7, cost: 0.0004 });
  assert.equal(entry.latencyMs, 42);
  assert.equal(entry.routingBand, "apply");
  assert.equal(entry.applied, true);
  assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("records the baseline disagreement and keeps only applied decisions", async (t) => {
  const dir = await tempDir(t);
  const agreed = auditRecord();
  const disagreed = auditRecord({
    decision: { answer: { type: "choice", choice: "csm-scan" } },
    baseline: { answer: { type: "choice", choice: "csm-ddd" } },
    build: { decisionId: "decision-disagree-0002" },
  });
  const skipped = auditRecord({
    decision: { applied: false },
    build: { decisionId: "decision-skipped-0003" },
  });

  const result = await writeDecisionArtifact({
    runId: RUN_ID,
    records: [agreed, disagreed, skipped],
    outputDir: dir,
  });
  assert.equal(result.appliedCount, 2);
  assert.equal(result.recordCount, 2);

  const parsed = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].baselineAgreement, true);
  assert.equal(parsed[1].baselineAgreement, false);
  for (const entry of parsed) assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("builds a schema-valid record from a raw decision plus its baseline", async (t) => {
  const dir = await tempDir(t);
  const raw = {
    pointId: "spike-candidacy",
    answer: { type: "choice", choice: "spike" },
    confidence: 0.4,
    routingBand: "apply",
    applied: true,
    stateDigest: STATE_DIGEST,
    baseline: { answer: { type: "choice", choice: "no-spike" } },
    provider: { id: "openrouter", model: "typesafe/jev-1.13" },
    usage: { inputTokens: 3 },
    latencyMs: 9,
  };

  const result = await writeDecisionArtifact({ runId: RUN_ID, records: [raw], outputDir: dir });
  const [entry] = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(entry.pointId, "spike-candidacy");
  assert.equal(entry.baselineAgreement, false);
  assert.equal(entry.latencyMs, 9);
  assert.deepEqual(entry.usage, { inputTokens: 3 });
  assert.equal(validator.validate("csm-decision/1", entry).valid, true);
});

test("redacts env secret values, Authorization headers, and Bearer tokens", () => {
  const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";
  const gateway = "gw-abcdefghijklmnopqrstuvwxyz";
  const env = {
    OPENROUTER_ROUTER_KEY: secret,
    AI_GATEWAY_API_KEY: gateway,
    UNRELATED_VALUE: "keep-me",
  };
  const input = {
    headers: { Authorization: `Bearer ${secret}`, "x-custom": `Bearer ${gateway}` },
    OPENROUTER_ROUTER_KEY: secret,
    nested: { note: `uses ${secret} inline`, apiKey: secret },
    keep: "plain-value",
  };

  const out = redactDecisionArtifact(input, { env });
  const text = JSON.stringify(out);
  assert.ok(!text.includes(secret), "env secret must not survive");
  assert.ok(!text.includes(gateway), "second env secret must not survive");
  assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/.test(text), "Bearer + token must not survive");
  assert.equal(out.keep, "plain-value");
  assert.equal(out.headers.Authorization, "[REDACTED:Authorization]");
  assert.equal(out.OPENROUTER_ROUTER_KEY, "[REDACTED:OPENROUTER_ROUTER_KEY]");
  assert.equal(out.nested.note, "uses [REDACTED:OPENROUTER_ROUTER_KEY] inline");
  assert.deepEqual(findCredentialShapes(out), []);
});

test("a written artifact never contains key-shaped material", async (t) => {
  const dir = await tempDir(t);
  const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";
  const record = auditRecord();
  record.provenance.sessionId = secret;
  record.provenance.transport = `Bearer ${secret}`;

  const result = await writeDecisionArtifact({
    runId: RUN_ID,
    records: [record],
    env: { OPENROUTER_ROUTER_KEY: secret },
    outputDir: dir,
  });
  const text = await readFile(result.path, "utf8");
  assert.ok(!text.includes(secret));
  assert.ok(!/Bearer\s+\S+/.test(text));
  assert.ok(text.includes("[REDACTED:OPENROUTER_ROUTER_KEY]"));
  assert.deepEqual(findCredentialShapes(JSON.parse(text)), []);
});

test("indexing is attempted only for the real decisions dir", async (t) => {
  const dir = await tempDir(t);
  const calls = [];
  const indexer = async (payload) => {
    calls.push(payload);
    return true;
  };

  await writeDecisionArtifact({ runId: RUN_ID, records: [auditRecord()], outputDir: dir, indexer });
  assert.equal(calls.length, 0, "temp output dir must not index");

  const forced = await writeDecisionArtifact({
    runId: RUN_ID,
    records: [auditRecord()],
    outputDir: dir,
    indexer,
    index: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(forced.indexed, true);
  assert.equal(calls[0].relativePath, `.agents/decisions/${RUN_ID}.json`);
  assert.match(calls[0].bullet, new RegExp(`^- \`${RUN_ID}\\.json\``));
});

test("the default indexer inserts a section-anchored bullet in a real cwd", async (t) => {
  const root = await tempDir(t);
  await mkdir(join(root, ".agents", "decisions"), { recursive: true });
  await writeFile(
    join(root, ".agents", "README.md"),
    [
      "# Agents",
      "",
      "## decisions/",
      "",
      "- `2026-09-19-jev-optin-sample.json` — sample",
      "",
      "## progress/",
      "",
      "- `example.json` — example",
      "",
    ].join("\n"),
  );

  const result = await writeDecisionArtifact({
    runId: RUN_ID,
    records: [auditRecord()],
    cwd: root,
  });
  assert.equal(result.indexed, true);

  const readme = await readFile(join(root, ".agents", "README.md"), "utf8");
  assert.match(readme, new RegExp(`- \`${RUN_ID}\\.json\``));
  assert.ok(
    readme.indexOf(`${RUN_ID}.json`) < readme.indexOf("## progress/"),
    "bullet belongs in the ## decisions/ section",
  );
});
