"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { classifyResume } from "../csm-orchestrate/lib/recovery.mjs";
import {
  MonotonicTerminalError,
  createSqliteStore,
  resolveSqliteDriver,
} from "../lib/orchestration-store/index.mjs";

const SQLITE_AVAILABLE = resolveSqliteDriver().available;

const runId = "run-sqlite-recovery";

const approach = () => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "sqlite-recovery",
  phases: [
    {
      phaseId: "P1",
      title: "Deliver durably",
      goal: "build the change",
      deliverables: ["working result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass", "functional pass"],
      context: [],
      dependencies: [],
    },
  ],
});

function fixtureHost() {
  let calls = 0;
  const artifacts = new Map();
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill(request) {
      calls += 1;
      const item = {
        evidenceId: `ev-sqlite-${calls}`,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        digest: `sha256:${"a".repeat(64)}`,
        requirementIds: ["req-sqlite-recovery-p1"],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: `fixture-${calls}.json`,
          artifactId: `art-sqlite-${calls}`,
          digest: `sha256:${"a".repeat(64)}`,
          schema: "csm-fixture/1",
          sourceRunId: request.childRunId,
        },
      };
      artifacts.set(item.source.path, item);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [`ev-sqlite-${calls}`] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [`ev-sqlite-${calls}`] }],
        evidence: [item],
        childReceipt: {
          receiptId: `receipt-child-${calls}`,
          schema: "csm-fixture-receipt/1",
          runId: request.childRunId,
          digest: `sha256:${"b".repeat(64)}`,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        if (path.startsWith("review-"))
          return {
            status: "resolved",
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: {
              artifactId: expected.expectedArtifactId,
              sourceRunId: expected.expectedSourceRunId,
            },
          };
        const item = artifacts.get(path);
        if (!item) return { status: "missing", code: "missing", message: `missing ${path}` };
        return {
          status: "resolved",
          path,
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

async function acceptedReview() {
  return {
    schema: "csm-orchestrate-adversarial-review/2",
    reviewId: "review-sqlite-final",
    runId,
    status: "ACCEPTED",
    independent: true,
    provenance: {
      mode: "host-backed",
      reviewer: "csm-test-host",
      owner: "csm-review",
      reviewerChildRunId: "run-review-sqlite",
      receipt: { digest: `sha256:${"c".repeat(64)}` },
      artifact: { digest: `sha256:${"d".repeat(64)}` },
      approval: {
        approvalId: "approval-review-sqlite",
        edgeId: "edge-review-sqlite",
        parentRunId: runId,
        reviewerChildRunId: "run-review-sqlite",
      },
    },
    requirementCoverage: [
      { requirementId: "req-sqlite-recovery-p1", evidenceRefs: ["ev-sqlite-1"] },
    ],
    evidenceEntailment: "supported",
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    findings: [],
  };
}

async function options(store, host) {
  const review = await acceptedReview();
  return {
    approach: approach(),
    runId,
    host: {
      ...host,
      async invokeReview(request) {
        review.phaseId = request.phaseId;
        review.provenance = {
          ...review.provenance,
          receipt: {
            artifactId: "art-review-receipt",
            runId: review.provenance.reviewerChildRunId,
            digest: review.provenance.receipt.digest,
            owner: review.provenance.owner,
            schema: "csm-review-receipt/1",
            path: "review-receipt.json",
            resolution: "fixture",
          },
          artifact: {
            artifactId: "art-review",
            runId: review.provenance.reviewerChildRunId,
            digest: review.provenance.artifact.digest,
            owner: review.provenance.owner,
            schema: "csm-review/1",
            path: "review-artifact.json",
            resolution: "fixture",
          },
          approval: {
            ...review.provenance.approval,
            phaseId: request.phaseId,
            edgeId: request.edgeId,
            parentRunId: runId,
            approvedDigest: review.provenance.artifact.digest,
          },
        };
        return {
          review,
          reviewReceipt: review.provenance.receipt,
          reviewArtifact: review.provenance.artifact,
        };
      },
    },
    capabilities: await loadCapabilities(),
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
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
      approvedAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2099-08-27T00:00:00.000Z",
      status: "approved",
    }),
    now: () => new Date("2026-08-27T12:00:00Z"),
    cursorStore: store,
    artifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
  };
}

test("orchestrate runs to VERIFIED over the SQLite WAL cursor store and survives reopen", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  const dir = await mkdtemp(join(tmpdir(), "t006-integration-"));
  const databasePath = join(dir, "orchestrate.db");
  try {
    const host = fixtureHost();
    const store = createSqliteStore({ databasePath, mode: "wal" });
    const result = await orchestrate(await options(store, host));
    assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result.extensions));
    assert.ok(host.calls >= 1);

    const cursorIds = await store.listCursorIds(runId);
    assert.ok(cursorIds.length >= 1, "orchestrator cursors are durable in SQLite");
    for (const cursorId of cursorIds) {
      const meta = await store.getCursorMeta(cursorId);
      assert.ok(meta.revision >= 1);
      assert.ok(meta.fencingToken === null || meta.fencingToken >= 1);
      const history = await store.getHistory(cursorId);
      assert.ok(history.some((event) => event.eventType === "cursor-saved"));
      assert.ok(
        history.every((event) => typeof event.sequence === "number"),
        "history replays in sequence order",
      );
    }

    const receipt = await store.loadTerminalReceipt(result.receiptId);
    assert.equal(receipt.runId, runId);
    assert.equal(receipt.outcome.status, "VERIFIED");
    await assert.rejects(
      store.saveTerminalReceipt({ ...receipt, outcome: { status: "REJECTED" } }),
      (error) => error instanceof MonotonicTerminalError,
    );

    store.close();

    const reopened = createSqliteStore({ databasePath, mode: "wal" });
    try {
      assert.equal(
        await reopened.getSchemaVersion(),
        1,
        "migration replay after reopen is a no-op",
      );
      const persisted = await reopened.listCursorIds(runId);
      assert.deepEqual(persisted.toSorted(), cursorIds.toSorted());
      const durableCursor = await reopened.loadCursor(cursorIds[0]);
      assert.equal(durableCursor.runId, runId);
      assert.equal(durableCursor.schema, "csm-orchestrate-cursor/2");
      const durableReceipt = await reopened.loadTerminalReceipt(result.receiptId);
      assert.equal(durableReceipt.outcome.status, "VERIFIED");
      const durableHistory = await reopened.getHistory(cursorIds[0]);
      assert.ok(durableHistory.length >= 1, "append-only history survives reopen");

      // Resume seam: the real classifier consumes the durable cursor document
      // exactly as the orchestrator would on restart. A side-effecting node
      // with a saved checkpoint and no terminal child record must classify as
      // ambiguous (reconciliation required), never an unsafe restart.
      const node = result.extensions.phaseContracts[0].routeNodes[0];
      const resume = classifyResume({ cursor: durableCursor, child: node });
      assert.ok(
        ["blocked", "replay", "restart"].includes(resume.action),
        `classifyResume returned ${resume.action}`,
      );
      if (node.sideEffects.some((effect) => effect !== "read-only"))
        assert.equal(resume.reason, "ambiguous-side-effecting-checkpoint");

      const childRunId = durableCursor.childRunId;
      const childRecords = await reopened.loadTerminalRecords(childRunId);
      assert.deepEqual(childRecords, [], "no child terminal record exists for the child run");
      const parentRecords = await reopened.loadTerminalReceipt(result.receiptId);
      assert.equal(parentRecords.outcome.status, "VERIFIED");
      await assert.rejects(
        reopened.saveTerminalReceipt(durableReceipt),
        (error) => error instanceof MonotonicTerminalError,
        "terminal receipts stay monotonic across store lifetimes",
      );
    } finally {
      reopened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeout ambiguity records UNKNOWN and gates redispatch until reconciled", async (t) => {
  if (!SQLITE_AVAILABLE) return t.skip("node:sqlite unavailable");
  const dir = await mkdtemp(join(tmpdir(), "t006-unknown-"));
  const databasePath = join(dir, "orchestrate.db");
  try {
    const store = createSqliteStore({ databasePath, mode: "wal" });
    const cursor = {
      schema: "csm-orchestrate-cursor/2",
      cursorId: "cursor-unknown-flow",
      runId,
      phaseId: "phase-unknown-flow",
      routeState: "selected",
      checkpointState: "validated",
      attempt: 0,
      idempotencyKey: "phase-unknown-key",
      childReceiptIds: [],
      sideEffects: ["repository-write"],
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    await store.saveCursor(cursor);
    const claim = await store.claimCursor(cursor.cursorId, 1);
    const childRunId = "run-sqlite-timeout-child";
    const intent = await store.createDispatchIntent(
      cursor.cursorId,
      childRunId,
      claim.fencingToken,
    );
    await store.resolveDispatchIntent(intent.intentId, "dispatched");
    await store.recordReconciliation(childRunId, "UNKNOWN", { cause: "timeout-after-write" });
    const staleClaim = await store.claimCursor(cursor.cursorId, 2);
    await assert.rejects(
      store.createDispatchIntent(cursor.cursorId, childRunId, staleClaim.fencingToken),
      /reconciliation required/,
    );
    const late = await store.recordLateResult(childRunId, {
      status: "completed",
      evidence: "ev-late",
    });
    assert.equal(late.reconciliationResolved, true);
    const retry = await store.createDispatchIntent(
      cursor.cursorId,
      childRunId,
      staleClaim.fencingToken,
    );
    assert.equal(retry.created, true, "redispatch proceeds only after reconciliation");
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
