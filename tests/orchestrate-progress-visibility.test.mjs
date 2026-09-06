"use strict";
// Progress visibility verification (quality delivery cycle 5):
//   V-A live onProgress snapshots render the TASK PROGRESS projection
//   V-B driver prints TASK PROGRESS + Milestones and reaches VERIFIED
//   V-C child csm-skill-progress records roll up into the parent tracker
//   V-D recordSkillProgress writes schema-valid records
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { validateSkillProgress } from "../lib/progress-tracker.mjs";
import { recordSkillProgress } from "../scripts/lib/skill-progress-recorder.mjs";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const SHA_A = "sha256:" + "a".repeat(64);
const SHA_B = "sha256:" + "b".repeat(64);
const NOW = () => new Date("2026-09-05T12:00:00Z");

const approachFor = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "visprogress",
  signals: { capabilities: ["csm-scan"] },
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

function hostFixture({ progressDir } = {}) {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const descriptorBody = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-vis-1",
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
      if (progressDir)
        await recordSkillProgress({ dir: progressDir, request, goal: request.phaseId });
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-vis-1",
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

const memoryCursorStore = () => ({
  cursors: new Map(),
  async saveCursor(cursor) {
    this.cursors.set(cursor.cursorId, cursor);
  },
  async loadCursor(cursorId) {
    return this.cursors.get(cursorId) ?? null;
  },
});

async function orchestrateOptions(runId, host, extra = {}) {
  const capabilities = await loadCapabilities();
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "vis-review-"));
  const schemaRegistry = await loadSchemaRegistry();
  return {
    approach: approachFor(runId),
    runId,
    host,
    capabilities,
    signals: approachFor(runId).signals,
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryCursorStore(),
    schemaRegistry,
    artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),
    childArtifactResolver: host.artifactResolver,
    ...extra,
  };
}

test("V-A: onProgress observes snapshots that render the TASK PROGRESS projection", async () => {
  const runId = "run-vis-progress-live";
  const snapshots = [];
  const host = hostFixture();
  await orchestrate(
    await orchestrateOptions(runId, host, {
      onProgress: (snapshot) => snapshots.push(snapshot),
    }),
  );
  assert.ok(snapshots.length >= 2, "expected multiple progress observations");
  assert.ok(snapshots[0].revision < snapshots[snapshots.length - 1].revision);
  const rendered = projectProgress(snapshots[snapshots.length - 1], { width: 28 });
  assert.match(rendered.text, /TASK PROGRESS/);
  assert.match(rendered.text, /Milestones/);
});

test("V-B: driver prints TASK PROGRESS + Milestones and reaches VERIFIED", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "vis-driver-"));
  try {
    const runId = "run-vis-progress-driver-" + process.pid;
    const approachPath = join(sandbox, "approach.json");
    const hostPath = join(sandbox, "host.mjs");
    await writeFile(approachPath, JSON.stringify(approachFor(runId), null, 2) + "\n");
    await writeFile(hostPath, HOST_TEMPLATE + "\n");
    const { stdout } = await exec(
      process.execPath,
      [
        join(repoRoot, "scripts", "run-orchestrator.mjs"),
        "--approach",
        approachPath,
        "--host",
        hostPath,
        "--final-review",
        join(repoRoot, "scripts", "independent-reviewer.mjs"),
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.match(stdout, /TASK PROGRESS/);
    assert.match(stdout, /Milestones/);
    assert.match(stdout, /status: VERIFIED/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

const HOST_TEMPLATE = `
"use strict";
const DIGEST = "sha256:" + "a".repeat(64);
export default function hostFixture() {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const source = {
        path: "result-1.json",
        artifactId: "art-result-1",
        digest: DIGEST,
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId: "ev-driver-vis-1",
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        validation: { signal: "fixture deliverable produced", status: "pass" },
        source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-driver-vis-1",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: DIGEST,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return {
          status: "resolved",
          path,
          owner: expected.expectedOwner ?? item.owner,
          fileDigest: expected.expectedFileDigest ?? item.source.digest,
          value: item,
        };
      },
    },
  };
}
`;

test("V-C: child skill-progress records roll up into the parent tracker", async () => {
  const runId = "run-vis-progress-rollup";
  const progressDir = await mkdtemp(join(tmpdir(), "vis-rollup-"));
  const host = hostFixture({ progressDir });
  const result = await orchestrate(
    await orchestrateOptions(runId, host, { skillProgressRollupDir: progressDir }),
  );
  const rolledUp = result.progress.items.some((item) =>
    (item.evidenceRefs ?? []).some((ref) => String(ref).startsWith("skill-progress:")),
  );
  assert.ok(rolledUp, "expected a rolled-up skill-progress evidence ref");
  await rm(progressDir, { recursive: true, force: true });
});

test("V-D: recordSkillProgress writes a schema-valid record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vis-recorder-"));
  try {
    const record = await recordSkillProgress({
      dir,
      request: {
        childRunId: "run-vis-recorder-child",
        skill: "csm-scan",
        phaseId: "phase-vis-progress-p1",
      },
      goal: "record a valid child progress record",
    });
    assert.equal(validateSkillProgress(record).ok, true);
    assert.equal(record.runId, "run-vis-recorder-child");
    assert.equal(record.overallPercent, 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
