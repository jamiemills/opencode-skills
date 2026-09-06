"use strict";

// Progress movement verification (quality delivery cycle 7 / plan progress-movement-fixes):
//   MV-A recorder percent mapping produces validator-passing partial records
//   MV-B mid-run partial rollups move the rendered percentage during a run
//   MV-C skill-progress-rollup telemetry events are emitted (T001 registration)
//   MV-D the driver prints only visible changes and persists progress.json/progress.txt
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { validateSkillProgress } from "../lib/progress-tracker.mjs";
import { recordSkillProgress } from "../scripts/lib/skill-progress-recorder.mjs";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const SHA_A = "sha256:" + "a".repeat(64);
const SHA_B = "sha256:" + "b".repeat(64);
const CONFIG = "sha256:" + "f".repeat(64);
const NOW = () => new Date("2026-09-06T12:00:00Z");

const approachFor = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "movement",
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

function partialHost({ dir, partials, childMs }) {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const timers = partials.map(({ at, percent }) =>
        setTimeout(() => {
          void recordSkillProgress({ dir, request, goal: request.phaseId, percent }).catch(
            () => {},
          );
        }, at),
      );
      await new Promise((resolve) => setTimeout(resolve, childMs));
      for (const timer of timers) clearTimeout(timer);
      const descriptorBody = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-movement-1",
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: "fixture-movement.json",
          artifactId: "art-movement",
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      const descriptor = { ...descriptorBody, digest: SHA_B };
      artifacts.set(descriptorBody.source.path, descriptor);
      await recordSkillProgress({ dir, request, goal: request.phaseId, percent: 100 });
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-movement-1",
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
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "movement-review-"));
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
    retryBackoffMs: 0,
    ...extra,
  };
}

let SQLITE_AVAILABLE = true;
try {
  await import("node:sqlite");
} catch {
  SQLITE_AVAILABLE = false;
}

const percentOf = (text) => {
  const match = text.match(/(\d+)%/);
  return match ? Number(match[1]) : -1;
};

test("MV-A: recorder percent mapping produces validator-passing partial records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "movement-recorder-"));
  try {
    const request = {
      childRunId: "run-movement-recorder-child",
      skill: "csm-scan",
      phaseId: "phase-movement-p1",
    };
    for (const percent of [0, 1, 15, 25, 30, 40, 65, 71, 85, 98, 99, 100]) {
      const record = await recordSkillProgress({ dir, request, goal: "g", percent });
      const verdict = validateSkillProgress(record);
      assert.equal(verdict.ok, true, `percent ${percent}: ${verdict.reason}`);
      assert.equal(record.overallPercent, percent);
      assert.equal(record.status, percent >= 100 ? "complete" : "active");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MV-B: mid-run partial rollups move the rendered percentage before completion", async () => {
  const runId = "run-movement-live";
  const progressDir = await mkdtemp(join(tmpdir(), "movement-rollup-"));
  const host = partialHost({
    dir: progressDir,
    partials: [
      { at: 1500, percent: 25 },
      { at: 3000, percent: 50 },
    ],
    childMs: 6000,
  });
  const texts = [];
  const result = await orchestrate(
    await orchestrateOptions(runId, host, {
      skillProgressRollupDir: progressDir,
      onProgress: (snapshot) => texts.push(projectProgress(snapshot, { width: 28 }).text),
    }),
  );
  const percentages = [...new Set(texts.map(percentOf))];
  assert.ok(
    percentages.some((pct) => pct > 0 && pct < 100),
    "expected a mid-run rendered percentage strictly between 0 and 100: " + percentages.join(","),
  );
  assert.ok(
    texts.some((text) => text.includes("25%")),
    "expected the 25-partial to render: " + texts.join(" | "),
  );
  assert.ok(texts.some((text) => text.includes("complete")));
  assert.equal(result.receipt.statuses.child, "completed");
  await rm(progressDir, { recursive: true, force: true });
});

test("MV-C: skill-progress-rollup telemetry events are emitted during the run", async () => {
  const runId = "run-movement-telemetry";
  const progressDir = await mkdtemp(join(tmpdir(), "movement-telemetry-"));
  const transport = createMemoryTransport();
  const telemetryEmitter = createTelemetryEmitter({
    transport,
    runId,
    effectiveConfigDigest: CONFIG,
  });
  const host = partialHost({
    dir: progressDir,
    partials: [
      { at: 1500, percent: 25 },
      { at: 3000, percent: 50 },
    ],
    childMs: 6000,
  });
  await orchestrate(
    await orchestrateOptions(runId, host, {
      skillProgressRollupDir: progressDir,
      telemetryEmitter,
    }),
  );
  const events = await telemetryEmitter.getEvents();
  const rollups = events.filter((event) => event.eventType === "skill-progress-rollup");
  assert.ok(rollups.length >= 1, "expected at least one rollup telemetry event");
  assert.ok(
    rollups.some((event) => event.payload.fraction > 0 && event.payload.fraction < 1),
    "expected at least one MID-RUN rollup event",
  );
  assert.ok(rollups.every((event) => event.payload.fraction > 0 && event.payload.fraction <= 1));
  await rm(progressDir, { recursive: true, force: true });
});

test(
  "MV-D: driver prints only visible changes and persists progress artifacts",
  { skip: SQLITE_AVAILABLE ? false : "node:sqlite unavailable (driver requires Node >= 22.13)" },
  async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "movement-driver-"));
    try {
      const runId = "run-movement-driver-" + process.pid;
      // partial records must land in the DRIVER rollup dir (evidence dir convention)
      const progressDir = join(
        repoRoot,
        ".agents",
        "evidence",
        "orchestrator",
        runId,
        "skill-progress",
      );
      await mkdir(progressDir, { recursive: true });
      const approachPath = join(sandbox, "approach.json");
      await writeFile(approachPath, JSON.stringify(approachFor(runId), null, 2) + "\n");
      const hostPath = join(sandbox, "host.mjs");
      await writeFile(
        hostPath,
        buildPartialHostSource({
          dir: progressDir,
          partials: [
            { at: 1500, percent: 25 },
            { at: 3000, percent: 60 },
          ],
          childMs: 5500,
        }) + "\n",
      );
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
      assert.match(stdout, /status: VERIFIED/);
      // compare full blocks (bar + Milestones + row): different blocks may share
      // an identical bar line while the milestone row changes
      const parts = stdout.split(/(?=TASK PROGRESS)/g).filter((b) => b.startsWith("TASK PROGRESS"));
      assert.ok(parts.length >= 3, "expected at least three distinct progress blocks");
      for (let i = 1; i < parts.length; i += 1)
        assert.notEqual(parts[i], parts[i - 1], "consecutive identical blocks must be suppressed");
      const evidenceLine = stdout.split("\n").find((line) => line.startsWith("evidence:"));
      const evidenceDir = evidenceLine.slice("evidence:".length).trim();
      const progressJson = JSON.parse(await readFile(join(evidenceDir, "progress.json"), "utf8"));
      assert.equal(progressJson.schema, "csm-progress/1");
      const progressTxt = await readFile(join(evidenceDir, "progress.txt"), "utf8");
      assert.match(progressTxt, /TASK PROGRESS/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  },
);

function buildPartialHostSource({ dir, partials, childMs }) {
  const partialLiterals = partials
    .map((p) => "{ at: " + p.at + ", percent: " + p.percent + " }")
    .join(", ");
  return [
    '"use strict";',
    "import { recordSkillProgress } from " +
      JSON.stringify(join(repoRoot, "scripts", "lib", "skill-progress-recorder.mjs")) +
      ";",
    'const DIGEST = "sha256:" + "a".repeat(64);',
    "const PROGRESS_DIR = " + JSON.stringify(dir) + ";",
    "const PARTIALS = [" + partialLiterals + "];",
    "const CHILD_MS = " + childMs + ";",
    "export default function hostFixture() {",
    "  const artifacts = new Map();",
    "  return {",
    "    async invokeSiblingSkill(request) {",
    "      const timers = PARTIALS.map(({ at, percent }) =>",
    "        setTimeout(() => {",
    "          void recordSkillProgress({ dir: PROGRESS_DIR, request, goal: request.phaseId, percent }).catch(() => {});",
    "        }, at),",
    "      );",
    "      await new Promise((resolve) => setTimeout(resolve, CHILD_MS));",
    "      for (const timer of timers) clearTimeout(timer);",
    "      const descriptorBody = {",
    '        schema: "csm-orchestrate-evidence/2",',
    '        evidenceId: "ev-movement-driver-1",',
    '        kind: "acceptance",',
    '        status: "current",',
    "        owner: request.skill,",
    "        runId: request.childRunId,",
    '        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],',
    "        acceptanceSignalId: request.acceptanceSignalIds?.[0],",
    "        source: {",
    '          path: "fixture-movement-driver.json",',
    '          artifactId: "art-movement-driver",',
    "          digest: DIGEST,",
    '          schema: "csm-orchestrate-evidence/2",',
    "          sourceRunId: request.childRunId,",
    "        },",
    "      };",
    "      const descriptor = { ...descriptorBody, digest: DIGEST };",
    "      artifacts.set(descriptorBody.source.path, descriptor);",
    "      await recordSkillProgress({ dir: PROGRESS_DIR, request, goal: request.phaseId, percent: 100 });",
    "      return {",
    '        status: "completed",',
    '        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
    '        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
    "        evidence: [descriptor],",
    "        childReceipt: {",
    '          receiptId: "receipt-movement-driver-1",',
    '          schema: "csm-orchestrate-child-receipt/1",',
    "          runId: request.childRunId,",
    "          digest: DIGEST,",
    "          owner: request.skill,",
    '          status: "completed",',
    "        },",
    "      };",
    "    },",
    "    artifactResolver: {",
    "      async resolve(path, expected = {}) {",
    "        const item = artifacts.get(path);",
    "        if (!item)",
    '          return { status: "missing", code: "missing", message: "missing artifact: " + path };',
    "        return {",
    '          status: "resolved",',
    "          path,",
    "          owner: expected.expectedOwner ?? item.owner,",
    "          fileDigest: expected.expectedFileDigest ?? item.source.digest,",
    "          value: item,",
    "        };",
    "      },",
    "    },",
    "  };",
    "}",
  ].join("\n");
}
