// One-command orchestrator driver: wires the durable store, telemetry, and
// autonomy policy, runs orchestrate() on an approach file, and persists the
// terminal receipt as deployment evidence.
//
// Usage:
//   node scripts/run-orchestrator.mjs --fixture
//   node scripts/run-orchestrator.mjs --approach <approach.json> [--host <host.mjs>] [--run-id <runId>]
//            [--approvals <approvals.mjs>]  (default: createAutonomyPolicy — 3 read-only skills auto-approve)
//
// --fixture  self-test: built-in fixture host + trivial approach; must VERIFIED.
// --approach approach file (csm-approach/1) for a real run.
// --host     module exporting `default` = host factory ({runId}) -> host
//            ({invokeSiblingSkill, invokeReview?}). Required for real runs.
//            The host IS your workload: implement your real skill dispatch there.
"use strict";

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import { orchestrate } from "../csm-orchestrate/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function loadApproach(approachPath) {
  const approach = JSON.parse(await readFile(approachPath, "utf8"));
  assert.equal(approach.schema, "csm-approach/1", "approach file must be csm-approach/1");
  assert.equal(typeof approach.runId, "string", "approach.runId is required");
  return approach;
}

async function loadHostModule(hostPath, runId) {
  const module = await import(pathToFileURL(path.resolve(hostPath)).href);
  if (typeof module.default !== "function") {
    throw new TypeError("host module must default-export a factory: ({runId}) => host");
  }
  return module.default({ runId });
}

async function fixtureMode() {
  const { hostFixture, approachFor, reviewEvidenceRoot } =
    await import("../tests/helpers-final-review.mjs");
  const { createIndependentFinalReviewExecutor } =
    await import("../csm-orchestrate/lib/adversarial-final-review.mjs");
  const { createArtifactResolver } = await import("../lib/artifact-resolver/index.mjs");
  const { loadSchemaRegistry } = await import("../lib/schema-runtime/index.mjs");
  const runId = `run-orchestrator-fixture-${Date.now()}`;
  const host = hostFixture({ ideaSlug: "driver-fixture" });
  const capabilities = await loadCapabilities();
  const reviewArtifactRoot = reviewEvidenceRoot("driver-review-");
  const reviewSchemaRegistry = await loadSchemaRegistry();
  const reviewResolver = createArtifactResolver({
    root: reviewArtifactRoot,
    schemaRegistry: reviewSchemaRegistry,
  });
  const evidenceDir = await mkdtemp(join(tmpdir(), "orchestrator-fixture-"));
  const dbPath = join(evidenceDir, "cursor.db");
  const telemetryPath = join(evidenceDir, "telemetry.jsonl");
  const cursorStore = createSqliteStore({ mode: "wal", databasePath: dbPath });
  const telemetryEmitter = createTelemetryEmitter({
    transport: createJsonlTransport(telemetryPath),
    runId,
  });
  const result = await orchestrate({
    approach: approachFor(runId, "driver-fixture"),
    runId,
    host,
    capabilities,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    // fixture-only: permissive approvals. Real runs use createAutonomyPolicy
    // (3 read-only skills auto-approve; everything else stays human-gated).
    approvals: async ({ phase, node, childRunId }) => ({
      schema: "csm-orchestrate-approval/1",
      approvalId: `approval-${childRunId}`,
      binding: {
        parentRunId: runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: node.approvalScope.length ? node.approvalScope : ["read"],
      approvedDigest: node.capabilityDigest,
      approvedAt: "2026-09-05T00:00:00.000Z",
      expiresAt: "2099-09-05T00:00:00.000Z",
      status: "approved",
    }),
    cursorStore,
    maxSteps: 25,
    telemetryEmitter,
    artifactResolver: reviewResolver,
    childArtifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
    reviewArtifactRoot,
    finalReviewExecutor: createIndependentFinalReviewExecutor({
      producerExecutorId: "csm-build",
      artifactRoot: reviewArtifactRoot,
      reviewer: async ({ requirements, evidence: reviewEvidence, phaseResults: reviewPhases }) => ({
        status: "ACCEPTED",
        requirementCoverage: requirements.map((requirement) => ({
          requirementId: requirement.requirementId,
          evidenceRefs: reviewEvidence
            .filter((item) => item.requirementIds?.includes(requirement.requirementId))
            .map((item) => item.evidenceId),
        })),
        evidenceEntailment: "supported",
        technical: reviewPhases.flatMap((item) => item.gate.technical),
        functional: reviewPhases.flatMap((item) => item.gate.functional),
        findings: [],
      }),
    }),
    producerExecutorId: "csm-build",
  });
  await writeFile(
    join(evidenceDir, "receipt.json"),
    `${JSON.stringify(result.receipt, null, 2)}\n`,
  );
  console.log(
    "FIXTURE DRIVER:",
    result.receipt.outcome.status,
    "| reason:",
    result.reason ?? "none",
  );
  await rm(evidenceDir, { recursive: true, force: true });
  return result.receipt.outcome.status === "VERIFIED" ? 0 : 1;
}

async function realMode() {
  const approachPath = argValue("--approach");
  if (!approachPath) {
    console.error("real runs require --approach <approach.json> (and --host <host.mjs>)");
    return 1;
  }
  const hostPath = argValue("--host");
  if (!hostPath) {
    console.error(
      "real runs require --host <host.mjs> (default-exported factory ({runId}) => host with invokeSiblingSkill)",
    );
    return 1;
  }
  const approach = await loadApproach(approachPath);
  const runId = argValue("--run-id") ?? approach.runId;
  const host = await loadHostModule(hostPath, runId);
  const capabilities = await loadCapabilities();
  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);
  await mkdir(evidenceDir, { recursive: true });
  const cursorStore = createSqliteStore({
    mode: "wal",
    databasePath: join(evidenceDir, "cursor.db"),
  });
  const telemetryEmitter = createTelemetryEmitter({
    transport: createJsonlTransport(join(evidenceDir, "telemetry.jsonl")),
    runId,
  });
  const { loadSchemaRegistry: loadRealRegistry } = await import("../lib/schema-runtime/index.mjs");
  const schemaRegistry = await loadRealRegistry();
  const approvalsModule = argValue("--approvals")
    ? await import(pathToFileURL(path.resolve(argValue("--approvals"))).href)
    : null;
  const result = await orchestrate({
    approach,
    runId,
    host,
    capabilities,
    signals: { capabilities: [], inputs: [] },
    approvals: approvalsModule ? approvalsModule.default : createAutonomyPolicy(capabilities),
    cursorStore,
    maxSteps: 25,
    telemetryEmitter,
    schemaRegistry,
  });
  await copyFile(approachPath, join(evidenceDir, "approach.json"));
  await writeFile(
    join(evidenceDir, "receipt.json"),
    `${JSON.stringify(result.receipt, null, 2)}\n`,
  );
  console.log("status:", result.receipt.outcome.status);
  console.log("reason:", result.reason ?? "none");
  console.log("evidence:", evidenceDir);
  return 0;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  (async () => {
    if (args[0] === "--fixture") process.exit(await fixtureMode());
    if (args[0] === "--approach") process.exit(await realMode());
    console.error(
      "usage: run-orchestrator.mjs --fixture | --approach <approach.json> [--host <host.mjs>] [--run-id <runId>]",
    );
    process.exit(1);
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
