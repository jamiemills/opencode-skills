"use strict";

// F-004: driver realMode guard clauses have test coverage (they previously had
// zero). These spawn the real driver and assert exit + message per guard.
// F-020: guard-branch units for scripts/lib modules (run-projections,
// skill-progress-recorder) that previously only had happy-path coverage.
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
import { validateSkillProgress } from "../lib/progress-tracker.mjs";
import { emitRunProjections } from "../scripts/lib/run-projections.mjs";
import { recordSkillProgress } from "../scripts/lib/skill-progress-recorder.mjs";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");

async function runDriver(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [driverPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message),
    };
  }
}

test("F-004: driver refuses a --run-id that diverges from approach.runId", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-contract-"));
  try {
    const approachPath = join(sandbox, "approach.json");
    await writeFile(
      approachPath,
      JSON.stringify({
        schema: "csm-approach/1",
        schemaRevision: 1,
        status: "agreed",
        runId: "run-driver-contract-a",
        ideaSlug: "driver-contract",
        signals: { capabilities: ["csm-scan"] },
        phases: [],
      }) + "\n",
    );
    const { code, stderr } = await runDriver([
      "--approach",
      approachPath,
      "--host",
      join(sandbox, "host.mjs"),
      "--run-id",
      "run-driver-contract-b",
    ]);
    assert.notEqual(code, 0);
    assert.match(stderr, /--run-id must equal approach.runId/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F-004: driver rejects an invalid --progress-poll-ms", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-contract-poll-"));
  const approachPath = join(sandbox, "approach.json");
  await writeFile(
    approachPath,
    JSON.stringify({
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId: "run-driver-contract-poll",
      ideaSlug: "driver-contract",
      signals: { capabilities: ["csm-scan"] },
      phases: [],
    }) + "\n",
  );
  const hostPath = join(sandbox, "host.mjs");
  await writeFile(
    hostPath,
    Buffer.from("ZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gaCgpIHsgcmV0dXJuIHt9OyB9", "base64").toString(),
  );
  const { code, stderr } = await runDriver([
    "--approach",
    approachPath,
    "--host",
    hostPath,
    "--progress-poll-ms",
    "0",
  ]);
  assert.notEqual(code, 0);
  assert.match(stderr, /--progress-poll-ms must be a positive/);
  await rm(sandbox, { recursive: true, force: true });
});

test("F-004: driver rejects a reused durable state without --resume", async () => {
  const runId = "run-driver-contract-durable-" + process.pid;
  const evidenceDir = join(repoRoot, ".agents", "evidence", "orchestrator", runId);
  await mkdir(join(evidenceDir), { recursive: true });
  await writeFile(join(evidenceDir, "cursor.db"), "not-a-real-db");
  try {
    const sandbox = await mkdtemp(join(tmpdir(), "driver-contract-"));
    const approachPath = join(sandbox, "approach.json");
    await writeFile(
      approachPath,
      JSON.stringify({
        schema: "csm-approach/1",
        schemaRevision: 1,
        status: "agreed",
        runId,
        ideaSlug: "driver-contract",
        signals: { capabilities: ["csm-scan"] },
        phases: [],
      }) + "\n",
    );
    const hostPath = join(sandbox, "host.mjs");
    await writeFile(hostPath, "export default function h() { return {}; }");
    const { code, stderr } = await runDriver(["--approach", approachPath, "--host", hostPath]);
    assert.notEqual(code, 0);
    assert.match(stderr, /already has durable state; pass --resume/);
    await rm(sandbox, { recursive: true, force: true });
    await rm(evidenceDir, { recursive: true, force: true });
  } catch (error) {
    await rm(evidenceDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
});

test("F-020: run-projections guards reject bad inputs", async () => {
  const registry = await loadSchemaRegistry();
  await assert.rejects(
    () => emitRunProjections({ receipt: {}, runId: "run-x", schemaRegistry: registry }),
    /projection output directory is required/,
  );
  await assert.rejects(
    () => emitRunProjections({ dir: "/tmp/opencode/whatever", schemaRegistry: registry }),
    /terminal receipt is required/,
  );
  await assert.rejects(
    () => emitRunProjections({ dir: "/tmp/opencode/whatever", receipt: {} }),
    /schemaRegistry is required/,
  );
});

test("F-020: run-projections falls back when the receipt lacks ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "render-fallback-"));
  try {
    const registry = await loadSchemaRegistry();
    const receipt = {
      schema: "csm-orchestrate-receipt/2",
      receiptId: "receipt-render-fallback",
      runId: "run-render-fallback",
      phaseId: "phase-render-fallback-p1",
      childReceipts: [],
      approval: {
        approvalId: "approval-render-fallback",
        scope: ["read"],
        approvedDigest: "sha256:" + "a".repeat(64),
        approvedAt: "2026-09-06T00:00:00.000Z",
        expiresAt: "2099-09-06T00:00:00.000Z",
        status: "approved",
      },
      statuses: {
        route: "complete",
        child: "completed",
        artifact: "completed",
        verification: "verified",
        parent: "verified",
      },
      outcome: { status: "VERIFIED", accepted: true, acceptanceRefs: [] },
      idempotencyKey: "sha256:" + "b".repeat(64),
    };
    const out = await emitRunProjections({
      dir,
      receipt,
      runId: "run-render-fallback",
      schemaRegistry: registry,
    });
    const md = await readFile(out.markdownPath, "utf8");
    assert.match(md, /receipt-render-fallback/);
    assert.match(md, /run-render-fallback/);
    assert.match(md, /approved/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F-020: recordSkillProgress guard branches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recorder-guards-"));
  try {
    assert.equal(await recordSkillProgress({}), null);
    await assert.rejects(
      () =>
        recordSkillProgress({
          dir,
          request: { childRunId: "run-x", skill: "csm-scan" },
          percent: 1.5,
        }),
      /percent must be an integer/,
    );
    await assert.rejects(
      () =>
        recordSkillProgress({
          dir,
          request: { childRunId: "run-x", skill: "csm-scan" },
          percent: 101,
        }),
      /percent must be an integer/,
    );
    const record = await recordSkillProgress({
      dir,
      request: { childRunId: "run-recorder-guards", skill: "csm-scan", phaseId: "phase-guards" },
      goal: "g".repeat(500),
      milestones: [
        { id: "M1", title: "a", weightPercent: 40 },
        { id: "M2", title: "b", weightPercent: 30 },
        { id: "M3", title: "c", weightPercent: 30 },
      ],
    });
    assert.equal(validateSkillProgress(record).ok, true);
    assert.equal(record.skill, "csm-scan");
    assert.ok(record.goal.length <= 300);
    assert.equal(record.overallPercent, 100);
    const bad = await recordSkillProgress({
      dir,
      request: { childRunId: "../../evil", skill: "csm-scan", phaseId: "phase-guards" },
    }).catch((error) => error);
    assert.match(bad.message, /canonical run id/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
