import assert from "node:assert/strict";
import test from "node:test";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { autonomyGate } from "../csm-orchestrate/lib/recovery.mjs";
import {
  createSqliteStore,
  OrchestrationStoreError,
  resolveSqliteDriver,
} from "../lib/orchestration-store/index.mjs";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const NOW = () => new Date("2026-08-27T12:00:00Z");

const approachFor = (runId, phaseCount = 1) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "autonomy",
  phases: Array.from({ length: phaseCount }, (_, index) => ({
    phaseId: `P${index + 1}`,
    title: `Phase ${index + 1}`,
    goal: "audit the repository",
    deliverables: ["audited result"],
    scope: ["repository"],
    outOfScope: ["production"],
    constraints: [],
    acceptanceHints: ["technical pass", "functional pass"],
    context: [],
    dependencies: index === 0 ? [] : [`P${index}`],
  })),
});

function hostFixture({ afterInvoke } = {}) {
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
      const requirementId = `req-autonomy-${request.phaseId.split("-").at(-1)}`;
      const item = {
        evidenceId: `ev-result-${calls}`,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        digest: SHA_A,
        requirementIds: [requirementId],
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
      if (afterInvoke) afterInvoke(calls);
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
        if (!item)
          return { status: "missing", code: "missing", message: `missing artifact: ${path}` };
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

const defaultReview =
  (runId) =>
  async ({ phaseResults, evidence }) => ({
    schema: "csm-orchestrate-adversarial-review/1",
    reviewId: `review-${runId}-final`,
    runId,
    status: "ACCEPTED",
    independent: true,
    provenance: {
      mode: "host-backed",
      reviewer: "csm-test-host",
      owner: "csm-test-host",
      reviewerChildRunId: `run-review-${runId}`,
      receipt: { digest: SHA_C },
      artifact: { digest: SHA_D },
      approval: {
        approvalId: `approval-review-${runId}`,
        edgeId: "edge-final-review",
        parentRunId: runId,
        reviewerChildRunId: `run-review-${runId}`,
      },
    },
    requirementCoverage: phaseResults.flatMap(({ phase }) =>
      phase.requirementIds.map((requirementId) => ({
        requirementId,
        evidenceRefs: evidence
          .filter(
            (item) => item.requirementIds?.includes(requirementId) && item.status === "current",
          )
          .map((item) => item.evidenceId),
      })),
    ),
    evidenceEntailment: "supported",
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    findings: [],
  });

const withReviewHost = (host, runId) => ({
  ...host,
  async invokeReview(request) {
    const review = await defaultReview(runId)(request);
    review.schema = "csm-orchestrate-adversarial-review/2";
    review.phaseId = request.phaseId;
    review.provenance = {
      ...review.provenance,
      receipt: {
        artifactId: "art-review-receipt",
        runId: review.provenance.reviewerChildRunId,
        digest: review.provenance.receipt?.digest ?? SHA_C,
        owner: review.provenance.owner,
        schema: "csm-review-receipt/1",
        path: "review-receipt.json",
        resolution: "fixture",
      },
      artifact: {
        artifactId: "art-review",
        runId: review.provenance.reviewerChildRunId,
        digest: review.provenance.artifact?.digest ?? SHA_D,
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
        reviewerChildRunId: review.provenance.reviewerChildRunId,
        approvedDigest: review.provenance.artifact?.digest ?? SHA_D,
      },
    };
    return {
      review,
      reviewReceipt: review.provenance.receipt,
      reviewArtifact: review.provenance.artifact,
    };
  },
});

const memoryCursorStore = () => ({
  cursors: new Map(),
  async saveCursor(cursor) {
    this.cursors.set(cursor.cursorId, cursor);
  },
  async loadCursor(cursorId) {
    return this.cursors.get(cursorId) ?? null;
  },
});

const autonomyOptions = async (host, { runId, signals, phaseCount = 1, ...extra }) => {
  const capabilities = await loadCapabilities();
  return {
    approach: approachFor(runId, phaseCount),
    runId,
    host: withReviewHost(host, runId),
    capabilities,
    signals,
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryCursorStore(),
    artifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
    ...extra,
  };
};

test("read-only skills are auto-approved and complete autonomously", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-ro",
      signals: { capabilities: ["csm-scan"] },
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.equal(host.calls, 1);
  const request = host.requests[0];
  assert.equal(request.approval.approvalId, `approval-auto-${request.childRunId}`);
  assert.equal(request.approval.status, "approved");
  assert.equal(request.approval.approvedDigest, request.skillDigest);
  assert.deepEqual(request.approval.scope, request.permissions);
  assert.deepEqual(request.approval.binding, {
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    phaseId: request.phaseId,
    edgeId: request.edgeId,
  });
  assert.equal(result.approval.approvalId, `approval-auto-${request.childRunId}`);
});

test("write skills are denied without human approval", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-write",
      signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    }),
  );
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "missing-approval");
  assert.equal(host.calls, 0);
});

test("maxSteps caps global dispatches with an INCOMPLETE receipt", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-cap",
      phaseCount: 4,
      signals: { capabilities: ["csm-scan"] },
      maxSteps: 3,
    }),
  );
  assert.equal(result.outcome.status, "INCOMPLETE");
  assert.equal(result.reason, "max-steps-exceeded");
  assert.equal(host.calls, 3);
});

test("abort signal halts the run with a clean INCOMPLETE receipt", async () => {
  const controller = new AbortController();
  const host = hostFixture({ afterInvoke: () => controller.abort() });
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-abort",
      phaseCount: 3,
      signals: { capabilities: ["csm-scan"] },
      signal: controller.signal,
    }),
  );
  assert.equal(result.outcome.status, "INCOMPLETE");
  assert.equal(result.reason, "aborted");
  assert.equal(host.calls, 1);
  assert.equal(result.schema, "csm-orchestrate-receipt/2");
  assert.match(result.receiptId, /^receipt-run-autonomy-abort-/);
  assert.equal(result.statuses.verification, "incomplete");
});

test("autonomyGate preflight blocks runs with missing prerequisites", async () => {
  const complete = autonomyGate({
    host: { invokeSiblingSkill() {} },
    permissions: ["read"],
    approvals: async () => {},
    idempotency: { key: "k" },
    route: [{ nodeId: "node-p1-csm-scan" }],
    evaluation: { signals: {} },
  });
  assert.equal(complete.enabled, true);
  assert.deepEqual(complete.missing, []);
  const host = hostFixture();
  const options = await autonomyOptions(host, {
    runId: "run-autonomy-preflight",
    signals: { capabilities: ["csm-scan"] },
  });
  const result = await orchestrate({ ...options, approvals: undefined });
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "autonomy-preflight-blocked");
  assert.ok(result.missing.includes("approvals"));
  assert.equal(host.calls, 0);
});

test("autonomy policy mints manifest-bound single-use approvals for read-only skills", async () => {
  const capabilities = await loadCapabilities();
  const scan = capabilities.skills.find((capability) => capability.skill === "csm-scan");
  const policy = createAutonomyPolicy(capabilities, { now: NOW });
  const approval = await policy({
    phase: { runId: "run-autonomy-unit", phaseId: "phase-autonomy-p1" },
    node: { skill: "csm-scan", nodeId: "node-p1-csm-scan", sideEffects: ["read-only"] },
    childRunId: "run-autonomy-unit-p1-scan",
  });
  assert.equal(approval.schema, "csm-orchestrate-approval/2");
  assert.equal(approval.approvalId, "approval-auto-run-autonomy-unit-p1-scan");
  assert.equal(approval.approvedDigest, scan.digest);
  assert.deepEqual(approval.scope, [...scan.permissions]);
  assert.deepEqual(approval.binding, {
    parentRunId: "run-autonomy-unit",
    childRunId: "run-autonomy-unit-p1-scan",
    phaseId: "phase-autonomy-p1",
    edgeId: "edge-node-p1-csm-scan",
  });
  assert.equal(approval.approvedAt, "2026-08-27T12:00:00.000Z");
  assert.equal(approval.expiresAt, "2026-08-27T13:00:00.000Z");
  assert.equal(approval.status, "approved");
});

test("autonomy policy denies write skills and unverified read-only claims", async () => {
  const policy = createAutonomyPolicy(await loadCapabilities());
  const phase = { runId: "run-autonomy-unit", phaseId: "phase-autonomy-p1" };
  assert.equal(
    await policy({
      phase,
      node: { skill: "csm-build", nodeId: "node-p1-csm-build", sideEffects: ["workspace-write"] },
      childRunId: "run-autonomy-unit-p1-build",
    }),
    undefined,
  );
  assert.equal(
    await policy({
      phase,
      node: { skill: "csm-build", nodeId: "node-p1-csm-build", sideEffects: ["read-only"] },
      childRunId: "run-autonomy-unit-p1-build",
    }),
    undefined,
  );
  assert.equal(
    await policy({
      phase,
      node: { skill: "csm-unknown", nodeId: "node-p1-csm-unknown", sideEffects: ["read-only"] },
      childRunId: "run-autonomy-unit-p1-unknown",
    }),
    undefined,
  );
});

test("auto-approve set is exactly csm-ddd, csm-review-python, csm-scan", async () => {
  const capabilities = await loadCapabilities();
  const policy = createAutonomyPolicy(capabilities, { now: NOW });
  const phase = { runId: "run-autonomy-strict", phaseId: "phase-autonomy-p1" };
  const request = (skill) => ({
    phase,
    node: { skill, nodeId: `node-p1-${skill}`, sideEffects: ["read-only"] },
    childRunId: `run-autonomy-strict-p1-${skill}`,
  });
  for (const skill of ["csm-ddd", "csm-review-python", "csm-scan"]) {
    const approval = await policy(request(skill));
    assert.ok(approval, `${skill} must be auto-approved`);
    assert.equal(approval.status, "approved");
    assert.equal(approval.approvalId, `approval-auto-run-autonomy-strict-p1-${skill}`);
  }
  for (const skill of ["csm-review", "csm-deep-research"]) {
    assert.equal(
      await policy(request(skill)),
      undefined,
      `${skill} must be denied by the strict auto-approve policy`,
    );
  }
  for (const skill of ["csm-build", "csm-grill", "csm-plan", "csm-upload", "csm-browse"]) {
    assert.equal(await policy(request(skill)), undefined, `${skill} must be denied`);
  }
});

test("wal-mode store fails closed when node:sqlite is unavailable", (t) => {
  if (resolveSqliteDriver().available)
    return t.skip("node:sqlite available; throw path untestable");
  assert.throws(
    () => createSqliteStore({ mode: "wal" }),
    (error) =>
      error instanceof OrchestrationStoreError && /node:sqlite unavailable/.test(error.message),
  );
  const memory = createSqliteStore({ mode: "memory" });
  memory.close();
  const memoryJs = createSqliteStore({ driver: "memory-js" });
  memoryJs.close();
});

test("hung injected finalReview times out into an INCOMPLETE receipt", async () => {
  const host = hostFixture();
  const options = await autonomyOptions(host, {
    runId: "run-autonomy-review-timeout",
    signals: { capabilities: ["csm-scan"] },
    reviewTimeoutMs: 100,
    finalReview: () => new Promise(() => {}),
  });
  options.host = host;
  const result = await orchestrate(options);
  assert.equal(result.outcome.status, "INCOMPLETE");
  assert.match(result.reason, /timeout/);
});

test("oversized child results are replaced with a policy failure", async () => {
  const blob = "x".repeat(3 * 1024 * 1024);
  const host = hostFixture();
  host.invokeSiblingSkill = async () => ({
    status: "completed",
    technical: [{ id: "technical", status: "pass", evidenceRefs: [], blob }],
    functional: [],
    evidence: [],
    outputArtifactRefs: [],
  });
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-oversized",
      signals: { capabilities: ["csm-scan"] },
      retryBackoffMs: 0,
    }),
  );
  assert.equal(result.outcome.status, "FAILED");
  assert.equal(result.reason, "output-size-exceeded");
  assert.equal(result.statuses.verification, "rejected");
});

test("retry backoff creates a measurable delay before the retry dispatch", async () => {
  const host = hostFixture();
  const original = host.invokeSiblingSkill.bind(host);
  const dispatchedAt = [];
  let calls = 0;
  host.invokeSiblingSkill = async (request) => {
    calls += 1;
    dispatchedAt.push(Date.now());
    if (calls === 1)
      return {
        status: "failed",
        failure: { class: "transport", code: "connection-reset", message: "transient" },
      };
    return original(request);
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-backoff",
      signals: { capabilities: ["csm-scan"] },
      retryBackoffMs: 150,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.equal(calls, 2);
  const elapsed = dispatchedAt[1] - dispatchedAt[0];
  assert.ok(elapsed >= 150, `retry delay was ${elapsed}ms; expected >= 150ms`);
});

test("durable cursorStore consumes single-use approvals at dispatch", async () => {
  const host = hostFixture();
  const consumed = [];
  const store = memoryCursorStore();
  store.consumeApproval = async (approvalId, cursorId) => {
    consumed.push({ approvalId, cursorId });
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-durable-approval",
      signals: { capabilities: ["csm-scan"] },
      cursorStore: store,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].approvalId, `approval-auto-${host.requests[0].childRunId}`);
  assert.match(consumed[0].cursorId, /^cursor-run-autonomy-durable-approval-/);
});

test("durable store wiring records idempotency and dispatch intents around each invoke", async () => {
  const host = hostFixture();
  const calls = [];
  const store = memoryCursorStore();
  store.recordIdempotency = async (key, cursorId) => {
    calls.push(["idempotency", key, cursorId]);
  };
  store.consumeApproval = async (approvalId, cursorId) => {
    calls.push(["approval", approvalId, cursorId]);
  };
  store.createDispatchIntent = async (cursorId, childRunId, fencingToken) => {
    calls.push(["intent-created", cursorId, childRunId, fencingToken]);
    return { intentId: `intent-${childRunId}` };
  };
  store.resolveDispatchIntent = async (intentId, status) => {
    calls.push(["intent-resolved", intentId, status]);
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-store-wiring",
      signals: { capabilities: ["csm-scan"] },
      cursorStore: store,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  const childRunId = host.requests[0].childRunId;
  const cursorId = calls.find(([kind]) => kind === "idempotency")?.[2];
  assert.ok(cursorId, "idempotency is recorded against the durable cursor id");
  const created = calls.find(([kind]) => kind === "intent-created");
  assert.deepEqual(created, ["intent-created", cursorId, childRunId, 1]);
  const resolved = calls.find(([kind]) => kind === "intent-resolved");
  assert.deepEqual(resolved, ["intent-resolved", `intent-${childRunId}`, "completed"]);
  const approvalRecord = calls.find(([kind]) => kind === "approval");
  assert.equal(approvalRecord[1], `approval-auto-${childRunId}`);
  assert.equal(approvalRecord[2], cursorId);
});
