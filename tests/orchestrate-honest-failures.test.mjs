"use strict";
// Honest-failure fix verification (quality delivery cycle 4):
//   F1 read-only child timeout is retried safely; side-effecting timeout stays
//      fail-closed (reconciliation-required)
//   F2 orchestrate fails fast on runId !== approach.runId
//   F3 telemetryEmitter.flush() drains async transports
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const SHA_A = "sha256:" + "a".repeat(64);
const SHA_B = "sha256:" + "b".repeat(64);
const CONFIG = "sha256:" + "f".repeat(64);
const NOW = () => new Date("2026-09-05T12:00:00Z");

const approachFor = (runId, skill) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "honest",
  signals:
    skill === "csm-build"
      ? { capabilities: ["csm-build"], inputs: ["plan"] }
      : { capabilities: ["csm-scan"] },
  phases: [
    {
      phaseId: "P1",
      title: "Deliver",
      goal: "produce the deliverable",
      deliverables: ["typed result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass", "functional pass"],
      context: [],
      dependencies: [],
    },
  ],
});

function hostFixture({ hangFirstMs = 0 } = {}) {
  let calls = 0;
  const artifacts = new Map();
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill(request) {
      calls += 1;
      if (calls === 1 && hangFirstMs > 0)
        await new Promise((resolveValue) => setTimeout(resolveValue, hangFirstMs));
      const descriptorBody = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-honest-" + calls,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: "fixture-" + request.childRunId + ".json",
          artifactId: "art-" + request.childRunId,
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      const descriptor = { ...descriptorBody, digest: SHA_B };
      artifacts.set(descriptorBody.source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-honest-" + calls,
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: SHA_B,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(refPath, expected = {}) {
        const value = artifacts.get(refPath);
        if (!value)
          return { status: "missing", code: "missing", message: "missing artifact: " + refPath };
        return {
          status: "resolved",
          path: refPath,
          owner: expected.expectedOwner,
          fileDigest: expected.expectedFileDigest,
          value: { ...value, schema: value.source.schema },
        };
      },
    },
  };
}

const buildApproval = async ({ phase, node, childRunId }) => {
  if (!phase || !node || !childRunId) return undefined;
  const approvedAt = new Date(NOW());
  return {
    schema: "csm-orchestrate-approval/2",
    approvalId: "approval-honest-" + childRunId,
    binding: {
      parentRunId: phase.runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: "edge-" + node.nodeId,
    },
    scope: [...node.approvalScope],
    approvedDigest: node.capabilityDigest,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 3_600_000).toISOString(),
    status: "approved",
  };
};

const memoryCursorStore = () => ({
  cursors: new Map(),
  async saveCursor(cursor) {
    this.cursors.set(cursor.cursorId, cursor);
  },
  async loadCursor(cursorId) {
    return this.cursors.get(cursorId) ?? null;
  },
});

async function orchestrateOptions(runId, skill, host, extra = {}) {
  const capabilities = await loadCapabilities();
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "honest-review-"));
  const schemaRegistry = await loadSchemaRegistry();
  return {
    approach: approachFor(runId, skill),
    runId,
    host,
    capabilities,
    signals: approachFor(runId, skill).signals,
    approvals:
      skill === "csm-build" ? buildApproval : createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryCursorStore(),
    schemaRegistry,
    artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),
    childArtifactResolver: host.artifactResolver,
    retryBackoffMs: 0,
    ...extra,
  };
}

test("F1: read-only child timeout is retried safely and the phase completes", async () => {
  const runId = "run-honest-readonly-timeout";
  const host = hostFixture({ hangFirstMs: 1200 });
  const result = await orchestrate(
    await orchestrateOptions(runId, "csm-scan", host, {
      timeoutMs: 250,
      maxAttempts: 2,
    }),
  );
  assert.equal(host.calls, 2, "expected exactly one safe retry");
  assert.equal(result.phases?.[0]?.gate?.status, "VERIFIED");
  assert.equal(result.receipt.statuses.child, "completed");
});

test("F1b: side-effecting child timeout stays fail-closed (reconciliation-required)", async () => {
  const runId = "run-honest-build-timeout";
  const host = hostFixture({ hangFirstMs: 1200 });
  const result = await orchestrate(
    await orchestrateOptions(runId, "csm-build", host, {
      timeoutMs: 250,
      maxAttempts: 2,
    }),
  );
  assert.equal(host.calls, 1, "side-effecting timeout must not auto-retry");
  assert.equal(result.receipt.outcome.status, "INCOMPLETE");
  assert.equal(result.reason, "reconciliation-required");
});

test("F2: orchestrate rejects runId divergence from approach.runId", async () => {
  const host = hostFixture();
  await assert.rejects(
    orchestrate(
      await orchestrateOptions("run-honest-divergent", "csm-scan", host, {
        runId: "run-honest-other",
      }),
    ),
    /runId must equal approach.runId/,
  );
});

test("F3: telemetryEmitter.flush drains the async jsonl transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "honest-flush-"));
  try {
    const telemetryPath = join(dir, "telemetry.jsonl");
    const emitter = createTelemetryEmitter({
      transport: createJsonlTransport(telemetryPath),
      runId: "run-honest-flush",
      effectiveConfigDigest: CONFIG,
    });
    emitter.emit({ eventType: "dispatch", payload: { skill: "csm-scan" } });
    await emitter.flush();
    const lines = (await readFile(telemetryPath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).eventType, "dispatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
