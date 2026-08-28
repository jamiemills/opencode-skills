// T004 end-to-end autonomy test: one autonomous read-only run exercising every
// safety component wired in T001-T003 plus the SQLite backup from T004.
// Git-backed fixtures build throwaway repositories under os.tmpdir(); nothing
// in the real repository is touched.

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSqliteStore, resolveSqliteDriver } from "../lib/orchestration-store/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { preAutonomyRun, rollbackToCheckpoint } from "../csm-orchestrate/lib/checkpoint.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifyScript = path.join(repoRoot, "scripts", "verify-orchestration-backup.mjs");

const SQLITE_AVAILABLE = resolveSqliteDriver().available;
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const CONFIG_DIGEST = `sha256:${"f".repeat(64)}`;
const NOW = () => new Date("2026-08-28T12:00:00Z");
const STORE_NOW = () => "2026-08-28T12:00:00.000Z";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "e2e@test"]);
  git(root, ["config", "user.name", "e2e"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "one");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return root;
}

const approachFor = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "autonomy-e2e",
  phases: [
    {
      phaseId: "P1",
      title: "Phase 1",
      goal: "audit the repository",
      deliverables: ["audited result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass", "functional pass"],
      context: [],
      dependencies: [],
    },
  ],
});

function hostFixture() {
  let calls = 0;
  const artifacts = new Map();
  const requests = [];
  return {
    get calls() {
      return calls;
    },
    requests,
    async invokeSiblingSkill(request) {
      requests.push(request);
      calls += 1;
      const item = {
        evidenceId: `ev-result-${calls}`,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        digest: SHA_A,
        requirementIds: ["req-autonomy-e2e-p1"],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: `fixture-${request.childRunId}.json`,
          artifactId: `art-${request.childRunId}`,
          digest: SHA_A,
          schema: "csm-fixture/1",
          sourceRunId: request.childRunId,
        },
      };
      artifacts.set(item.source.path, item);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [item.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [item.evidenceId] }],
        evidence: [item],
        childReceipt: {
          receiptId: `receipt-${request.childRunId}`,
          schema: "csm-fixture-receipt/1",
          runId: request.childRunId,
          digest: SHA_B,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(artifactPath, expected = {}) {
        if (artifactPath.startsWith("review-"))
          return {
            status: "resolved",
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: {
              artifactId: expected.expectedArtifactId,
              sourceRunId: expected.expectedSourceRunId,
            },
          };
        const item = artifacts.get(artifactPath);
        if (!item)
          return {
            status: "missing",
            code: "missing",
            message: `missing artifact: ${artifactPath}`,
          };
        return {
          status: "resolved",
          path: artifactPath,
          owner: item.owner,
          fileDigest: item.digest,
          value: {
            ...item,
            schema: item.source.schema,
            artifactId: item.source.artifactId,
            sourceRunId: item.source.sourceRunId,
          },
        };
      },
    },
  };
}

const withReviewHost = (host, runId) => ({
  ...host,
  async invokeReview(request) {
    const review = {
      schema: "csm-orchestrate-adversarial-review/2",
      reviewId: `review-${runId}-final`,
      runId,
      phaseId: request.phaseId,
      status: "ACCEPTED",
      independent: true,
      provenance: {
        mode: "host-backed",
        reviewer: "csm-test-host",
        owner: "csm-test-host",
        reviewerChildRunId: `run-review-${runId}`,
        receipt: {
          artifactId: "art-review-receipt",
          runId: `run-review-${runId}`,
          digest: SHA_C,
          owner: "csm-test-host",
          schema: "csm-review-receipt/1",
          path: "review-receipt.json",
          resolution: "fixture",
        },
        artifact: {
          artifactId: "art-review",
          runId: `run-review-${runId}`,
          digest: SHA_D,
          owner: "csm-test-host",
          schema: "csm-review/1",
          path: "review-artifact.json",
          resolution: "fixture",
        },
        approval: {
          approvalId: `approval-review-${runId}`,
          edgeId: request.edgeId,
          phaseId: request.phaseId,
          parentRunId: runId,
          reviewerChildRunId: `run-review-${runId}`,
          approvedDigest: SHA_D,
        },
      },
      requirementCoverage: [
        {
          requirementId: "req-autonomy-e2e-p1",
          evidenceRefs: ["ev-result-1"],
        },
      ],
      evidenceEntailment: "supported",
      technical: [{ status: "pass" }],
      functional: [{ status: "pass" }],
      findings: [],
    };
    return {
      review,
      reviewReceipt: review.provenance.receipt,
      reviewArtifact: review.provenance.artifact,
    };
  },
});

const orchestrateOptions = async (host, { runId, cursorStore, telemetryEmitter }) => {
  const capabilities = await loadCapabilities();
  return {
    approach: approachFor(runId),
    runId,
    host: withReviewHost(host, runId),
    capabilities,
    signals: { capabilities: ["csm-scan"] },
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore,
    telemetryEmitter,
    effectiveConfigDigest: CONFIG_DIGEST,
    artifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
  };
};

const runVerifyScript = async (backupPath) => {
  const { stdout } = await execFileAsync(process.execPath, [verifyScript, backupPath], {
    encoding: "utf8",
  });
  return stdout;
};

test("end-to-end autonomous run: checkpoint, telemetry, durable receipt, restorable backup", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  const workdir = await mkdtemp(path.join(tmpdir(), "autonomy-e2e-"));
  const runId = "run-autonomy-e2e";
  const store = createSqliteStore({
    mode: "wal",
    databasePath: path.join(workdir, "orchestration.db"),
    now: STORE_NOW,
  });
  const transport = createJsonlTransport(path.join(workdir, `${runId}.jsonl`));
  try {
    // 1. Git checkpoint on a dirty tree.
    const repoDir = makeRepo(path.join(workdir, "repo"));
    fs.writeFileSync(path.join(repoDir, "seed.txt"), "dirty-before-run");
    const checkpoint = await preAutonomyRun(runId, repoDir);
    assert.deepEqual(checkpoint, { checkpointRef: "stash@{0}", wasDirty: true });

    // 2. Autonomous orchestration with JSONL telemetry and the SQLite store.
    const telemetryEmitter = createTelemetryEmitter({
      transport,
      runId,
      effectiveConfigDigest: CONFIG_DIGEST,
      now: NOW,
    });
    const host = hostFixture();
    const result = await orchestrate(
      await orchestrateOptions(host, { runId, cursorStore: store, telemetryEmitter }),
    );
    assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
    assert.equal(host.calls, 1);
    assert.equal(
      host.requests[0].approval.approvalId,
      `approval-auto-${host.requests[0].childRunId}`,
    );

    // 3. Telemetry file holds correlated dispatch and terminal events.
    const events = await transport.list();
    assert.ok(events.length >= 2);
    assert.ok(events.every((event) => event.runId === runId));
    assert.ok(events.every((event) => event.effectiveConfigDigest === CONFIG_DIGEST));
    const dispatch = events.find((event) => event.eventType === "dispatch");
    assert.equal(dispatch.phaseId, host.requests[0].phaseId);
    assert.equal(dispatch.edgeId, host.requests[0].edgeId);
    assert.equal(dispatch.childRunId, host.requests[0].childRunId);
    const terminal = events.find((event) => event.eventType === "terminal");
    assert.equal(terminal.payload.receiptId, result.receiptId);
    assert.equal(terminal.payload.status, "VERIFIED");
    assert.deepEqual(
      events.map((event) => event.sequence),
      Array.from({ length: events.length }, (_, index) => index + 1),
      "no telemetry loss: sequences are contiguous from 1",
    );

    // 4. The SQLite store holds the terminal receipt.
    const stored = await store.loadTerminalReceipt(result.receiptId);
    assert.equal(stored.runId, runId);
    assert.equal(stored.outcome.status, "VERIFIED");

    // 5. Backup is restorable and matches the live database.
    const backupPath = path.join(workdir, "backups", "orchestration-backup.db");
    const backup = await store.backup(backupPath);
    assert.equal(backup.path, backupPath);
    assert.ok(backup.bytes > 0);
    assert.equal(backup.timestamp, "2026-08-28T12:00:00.000Z");
    const restored = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      const receipts = restored.prepare("SELECT receipt_id, status FROM terminal_receipts").all();
      assert.deepEqual(
        receipts.map((row) => row.receipt_id),
        [result.receiptId],
      );
      assert.equal(receipts[0].status, "completed");
      assert.ok(Number(restored.prepare("SELECT COUNT(*) AS n FROM cursors").get().n) > 0);
      assert.ok(Number(restored.prepare("SELECT COUNT(*) AS n FROM events").get().n) > 0);
    } finally {
      restored.close();
    }
    const stdout = await runVerifyScript(backupPath);
    assert.match(stdout, /^PASS: /m);
    assert.match(stdout, /terminal|cursors/);

    // 6. Rollback restores the pre-run working tree.
    const rollback = await rollbackToCheckpoint(repoDir);
    assert.deepEqual(rollback, { restored: true });
    assert.equal(fs.readFileSync(path.join(repoDir, "seed.txt"), "utf8"), "dirty-before-run");
    assert.equal(git(repoDir, ["stash", "list"]), "", "stash consumed by rollback");
  } finally {
    store.close();
    // Drain queued JSONL appends so cleanup never races a late write.
    await transport.list().catch(() => {});
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("memory-mode store backup yields a restorable SQLite snapshot", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  const workdir = await mkdtemp(path.join(tmpdir(), "autonomy-e2e-mem-"));
  const store = createSqliteStore({ mode: "memory", now: STORE_NOW });
  try {
    await store.saveCursor({
      schema: "csm-orchestrate-cursor/2",
      cursorId: "cursor-memory-backup",
      runId: "run-memory-backup",
      phaseId: "phase-memory-backup",
      routeState: "selected",
      checkpointState: "saved",
      attempt: 0,
      idempotencyKey: "phase-memory-key",
      childReceiptIds: [],
      updatedAt: "2026-08-28T12:00:00.000Z",
    });
    await store.saveTerminalReceipt({
      schema: "csm-orchestrate-receipt/2",
      receiptId: "receipt-memory-backup",
      runId: "run-memory-backup",
      phaseId: "phase-memory-backup",
      outcome: { status: "VERIFIED" },
    });
    const backupPath = path.join(workdir, "memory-backup.db");
    const backup = await store.backup(backupPath);
    assert.ok(backup.bytes > 0);
    const stdout = await runVerifyScript(backupPath);
    assert.match(stdout, /^PASS: /m);
    assert.match(stdout, /schema_version rows: 1/);
    const restored = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(
        restored.prepare("SELECT receipt_id FROM terminal_receipts").get().receipt_id,
        "receipt-memory-backup",
      );
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("memory-js fallback store exports a JSON backup the verify script accepts", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "autonomy-e2e-js-"));
  const store = createSqliteStore({ driver: "memory-js", now: STORE_NOW });
  try {
    await store.saveCursor({
      schema: "csm-orchestrate-cursor/2",
      cursorId: "cursor-js-backup",
      runId: "run-js-backup",
      phaseId: "phase-js-backup",
      routeState: "selected",
      checkpointState: "saved",
      attempt: 0,
      idempotencyKey: "phase-js-key",
      childReceiptIds: [],
      updatedAt: "2026-08-28T12:00:00.000Z",
    });
    const backupPath = path.join(workdir, "js-backup.json");
    const first = await store.backup(backupPath);
    assert.ok(first.bytes > 0);
    assert.equal(first.timestamp, "2026-08-28T12:00:00.000Z");
    const second = await store.backup(backupPath);
    assert.ok(second.bytes > 0, "re-backup to the same path is idempotent");
    const stdout = await runVerifyScript(backupPath);
    assert.match(stdout, /PASS: .+\(memory-js export\)/);
    assert.match(stdout, /cursors rows: 1/);
  } finally {
    store.close();
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
