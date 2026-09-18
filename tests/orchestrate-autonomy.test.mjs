import assert from "node:assert/strict";
import test from "node:test";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autonomyGate } from "../csm-orchestrate/lib/recovery.mjs";
import { childRunIdForNode, retryChildRunIdForNode } from "../csm-orchestrate/lib/run-helpers.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";
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
        schema: "csm-orchestrate-adversarial-review/2",
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
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "review-"));
  const reviewSchemaRegistry = await loadSchemaRegistry();
  return {
    approach: approachFor(runId, phaseCount),
    runId,
    host: withReviewHost(host, runId),
    capabilities,
    signals,
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryCursorStore(),
    artifactResolver: createArtifactResolver({
      root: reviewArtifactRoot,
      schemaRegistry: reviewSchemaRegistry,
    }),
    childArtifactResolver: host.artifactResolver,
    reviewArtifactRoot,
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
  const transport = createMemoryTransport();
  const telemetryEmitter = createTelemetryEmitter({
    runId: "run-autonomy-abort",
    effectiveConfigDigest: SHA_A,
    transport,
  });
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-abort",
      phaseCount: 3,
      signals: { capabilities: ["csm-scan"] },
      signal: controller.signal,
      telemetryEmitter,
    }),
  );
  assert.equal(result.outcome.status, "INCOMPLETE");
  assert.equal(result.reason, "aborted");
  assert.equal(host.calls, 1);
  assert.equal(result.schema, "csm-orchestrate-receipt/2");
  assert.match(result.receiptId, /^receipt-run-autonomy-abort-/);
  assert.equal(result.statuses.verification, "incomplete");
  const events = transport.list();
  assert.equal(events.filter((event) => event.eventType === "cancellation").length, 1);
  assert.deepEqual(events.find((event) => event.eventType === "cancellation").payload, {
    reason: "aborted",
  });
});

test("stale worker leases reconcile as visible replayed events without failing the run", async () => {
  const host = hostFixture();
  const transport = createMemoryTransport();
  const telemetryEmitter = createTelemetryEmitter({
    runId: "run-autonomy-stale",
    effectiveConfigDigest: SHA_A,
    transport,
  });
  const cursorStore = {
    ...memoryCursorStore(),
    async reconcileStaleWorkers() {
      return [
        {
          workerId: "worker-build-1",
          runId: "run-autonomy-stale",
          taskId: "task-build-1",
          attempt: 1,
          expiresAt: "2026-08-27T11:00:00.000Z",
        },
      ];
    },
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-stale",
      signals: { capabilities: ["csm-scan"] },
      telemetryEmitter,
      cursorStore,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED");
  const events = transport.list();
  const replayed = events.filter((event) => event.eventType === "worker.replayed");
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].workerId, "worker-build-1");
  assert.equal(replayed[0].taskId, "task-build-1");
  assert.ok(events.some((event) => event.eventType === "reconciliation"));
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
      retryBackoffMs: 250,
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

test("T002/T005: loop emits v2 worker lifecycle events and fires all seven hooks", async () => {
  const seen = new Set();
  const record = (name) => () => seen.add(name);
  const lifecycleHooks = {
    "worker-start": [record("worker-start")],
    "worker-stop": [record("worker-stop")],
    "task-create": [record("task-create")],
    "task-complete": [record("task-complete")],
    "tool-exec": [record("tool-exec")],
    checkpoint: [record("checkpoint")],
    cancel: [record("cancel")],
  };
  const transport = createMemoryTransport();
  const telemetryEmitter = createTelemetryEmitter({
    runId: "run-autonomy-hooks",
    effectiveConfigDigest: SHA_A,
    transport,
  });
  const host = hostFixture();
  await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-hooks",
      signals: { capabilities: ["csm-scan"] },
      lifecycleHooks,
      telemetryEmitter,
    }),
  );
  const controller = new AbortController();
  const abortHost = hostFixture({ afterInvoke: () => controller.abort() });
  await orchestrate(
    await autonomyOptions(abortHost, {
      runId: "run-autonomy-hooks-abort",
      signals: { capabilities: ["csm-scan"] },
      signal: controller.signal,
      lifecycleHooks,
    }),
  );
  for (const name of [
    "worker-start",
    "worker-stop",
    "task-create",
    "task-complete",
    "tool-exec",
    "checkpoint",
    "cancel",
  ])
    assert.ok(seen.has(name), `hook ${name} did not fire`);
  const types = transport.list().map((event) => event.eventType);
  for (const type of ["task.created", "worker.started", "worker.completed", "task.completed"])
    assert.ok(types.includes(type), `telemetry missing ${type}`);
});

test("T003: an approved dynamicProposal is compiled and executed through executeNode", async () => {
  const host = hostFixture();
  const real = await loadCapabilities();
  const approvals = async ({ phase, node, childRunId }) => {
    const capability = real.skills.find((entry) => entry.skill === node.skill);
    return {
      schema: "csm-orchestrate-approval/2",
      approvalId: `approval-dynamic-${childRunId}`,
      binding: {
        parentRunId: phase.runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: [...capability.permissions],
      approvedDigest: capability.digest,
      approvedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      status: "approved",
    };
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-dynamic",
      signals: { capabilities: ["csm-scan"] },
      approvals,
      dynamicProposal: {
        phaseId: "phase-dynamic",
        nodes: [{ taskId: "dyn-1", skill: "csm-review" }],
      },
      dynamicApproved: true,
      dynamicRouteKind: "research",
    }),
  );
  assert.notEqual(result.outcome.status, "BLOCKED", JSON.stringify({ reason: result.reason }));
  assert.ok(host.calls >= 2, `expected the dynamic worker to dispatch (calls=${host.calls})`);
  assert.ok(
    result.childReceipts.some((receipt) => receipt.owner === "csm-review"),
    "the dynamic proposal must dispatch through executeNode",
  );
});

test("T003: dynamic mode is refused for the plan route", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-dynamic-plan",
      signals: { capabilities: ["csm-scan"] },
      dynamicProposal: {
        phaseId: "phase-dynamic",
        nodes: [{ taskId: "review-1", skill: "csm-review" }],
      },
      dynamicApproved: true,
      dynamicRouteKind: "plan",
    }),
  );
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "dynamic-refused-plan-route");
});

test("T003: an unapproved dynamicProposal is refused", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-dynamic-unapproved",
      signals: { capabilities: ["csm-scan"] },
      dynamicProposal: {
        phaseId: "phase-dynamic",
        nodes: [{ taskId: "review-1", skill: "csm-review" }],
      },
    }),
  );
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "dynamic-approval-required");
});

test("T004: worker leases are claimed and released around dispatch", async () => {
  const claims = [];
  const releases = [];
  const cursorStore = {
    ...memoryCursorStore(),
    async claimWorker({ workerId }) {
      claims.push(workerId);
      return { leaseToken: `lease-${workerId}`, fencingToken: 1 };
    },
    async heartbeatWorker() {},
    async releaseWorker({ workerId, state }) {
      releases.push(`${workerId}:${state}`);
    },
  };
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-lease",
      signals: { capabilities: ["csm-scan"] },
      cursorStore,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED");
  assert.ok(claims.length >= 1, "a worker lease must be claimed");
  assert.ok(releases.length >= 1, "the worker lease must be released");
});

test("T003: a duplicate live worker lease blocks the run with worker-lease-held", async () => {
  const cursorStore = {
    ...memoryCursorStore(),
    async claimWorker() {
      throw new Error("worker lease is held by another live run");
    },
    async heartbeatWorker() {},
    async releaseWorker() {},
  };
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-lease-held",
      signals: { capabilities: ["csm-scan"] },
      cursorStore,
    }),
  );
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "worker-lease-held");
});

// T002: bounded writable parallel workers are deferred. This locks the runtime
// side of the guard: dependency-free writable workers must be dispatched one at
// a time through the single executeNode/cursor/receipt path, never concurrently,
// and each must produce exactly one receipt (no duplicate side effects).
test("T002: dependency-free writable workers dispatch serially with one receipt each", async () => {
  let active = 0;
  let maxActive = 0;
  const dispatches = new Map();
  const host = hostFixture();
  const baseInvoke = host.invokeSiblingSkill.bind(host);
  host.invokeSiblingSkill = async (request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    dispatches.set(request.skill, (dispatches.get(request.skill) ?? 0) + 1);
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return await baseInvoke(request);
    } finally {
      active -= 1;
    }
  };
  const real = await loadCapabilities();
  const approvals = async ({ phase, node, childRunId }) => {
    const capability = real.skills.find((entry) => entry.skill === node.skill);
    return {
      schema: "csm-orchestrate-approval/2",
      approvalId: `approval-writable-${childRunId}`,
      binding: {
        parentRunId: phase.runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: [...capability.permissions],
      approvedDigest: capability.digest,
      approvedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      status: "approved",
    };
  };
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-writable-serial",
      signals: { capabilities: ["csm-scan"] },
      approvals,
      maxParallelism: 8,
      dynamicProposal: {
        phaseId: "phase-writable-parallel",
        nodes: [
          { taskId: "build-a", skill: "csm-build", effects: ["workspace-write"] },
          { taskId: "make-tests-b", skill: "csm-make-tests", effects: ["workspace-write"] },
        ],
      },
      dynamicApproved: true,
      dynamicRouteKind: "research",
    }),
  );
  assert.notEqual(result.outcome.status, "BLOCKED", JSON.stringify({ reason: result.reason }));
  assert.equal(
    maxActive,
    1,
    "writable workers must never overlap, even when proposed dependency-free with a wide maxParallelism",
  );
  assert.equal(
    dispatches.get("csm-build"),
    1,
    "the csm-build writable node dispatches exactly once",
  );
  assert.equal(
    dispatches.get("csm-make-tests"),
    1,
    "the csm-make-tests writable node dispatches exactly once",
  );
  const writableReceipts = result.childReceipts.filter((receipt) =>
    ["csm-build", "csm-make-tests"].includes(receipt.owner),
  );
  assert.equal(writableReceipts.length, 2, "one terminal receipt per writable node");
  assert.equal(
    new Set(writableReceipts.map((receipt) => receipt.runId)).size,
    2,
    "each writable node keeps its own child run identity (no shared authority)",
  );
});

// T010: per-node child identity. `childRunId` was derived from
// (runId, phaseId, skill, phaseIndex), so two nodes in one phase with the same
// skill collided on approvals, cursors, durable child attempts, and terminal
// receipts even though `validateProposedSet` permits same-skill fan-out up to a
// capability's maxConcurrency. The identity now carries the graph-unique nodeId
// and the node-scoped idempotency key stays the consistency anchor.
test("T010: per-node child identity helpers are unique and node-consistent", () => {
  const a = childRunIdForNode("run-parent", "phase-x", "edge-a-11111111", 1);
  const b = childRunIdForNode("run-parent", "phase-x", "edge-b-22222222", 1);
  assert.notEqual(a, b, "different node ids must not share a child run id");
  assert.equal(a, "run-run-parent-phase-x-edge-a-11111111-1");
  assert.equal(b, "run-run-parent-phase-x-edge-b-22222222-1");
  assert.equal(retryChildRunIdForNode("run-parent", "phase-x", "edge-a-11111111", 1, 2), `${a}-2`);
  assert.notEqual(retryChildRunIdForNode("run-parent", "phase-x", "edge-a-11111111", 1, 2), b);
});

const nodeBoundApprovals = async ({ phase, node, childRunId }) => {
  const capabilities = await loadCapabilities();
  const capability = capabilities.skills.find((entry) => entry.skill === node.skill);
  return {
    schema: "csm-orchestrate-approval/2",
    approvalId: `approval-node-${node.nodeId}-${childRunId}`,
    binding: {
      parentRunId: phase.runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: `edge-${node.nodeId}`,
    },
    scope: [...capability.permissions],
    approvedDigest: capability.digest,
    approvedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: "approved",
  };
};

const sameSkillProposal = {
  phaseId: "phase-node-identity",
  nodes: [
    { taskId: "review-a", skill: "csm-review" },
    { taskId: "review-b", skill: "csm-review" },
  ],
};

test("T010: two same-skill nodes in one phase get distinct child identities", async () => {
  const host = hostFixture();
  const result = await orchestrate(
    await autonomyOptions(host, {
      runId: "run-autonomy-node-identity",
      signals: { capabilities: ["csm-scan"] },
      approvals: nodeBoundApprovals,
      maxParallelism: 4,
      dynamicProposal: sameSkillProposal,
      dynamicApproved: true,
      dynamicRouteKind: "research",
    }),
  );
  assert.notEqual(result.outcome.status, "BLOCKED", JSON.stringify({ reason: result.reason }));
  const reviewRequests = host.requests.filter((request) => request.skill === "csm-review");
  assert.equal(reviewRequests.length, 2, "both same-skill nodes dispatch");
  const childRunIds = reviewRequests.map((request) => request.childRunId);
  assert.equal(new Set(childRunIds).size, 2, "childRunId must be unique per node");
  for (const request of reviewRequests) {
    const nodeSlug = request.edgeId.replace(/^edge-/, "");
    assert.ok(
      request.childRunId.includes(`-${nodeSlug}-`),
      `childRunId ${request.childRunId} must carry node discriminator ${nodeSlug}`,
    );
    assert.equal(request.approval.binding.childRunId, request.childRunId);
    assert.equal(request.approval.binding.edgeId, request.edgeId);
  }
  assert.equal(
    new Set(reviewRequests.map((request) => request.approval.approvalId)).size,
    2,
    "approvals must be bound per node",
  );
  const receipts = result.childReceipts.filter((receipt) => receipt.owner === "csm-review");
  assert.equal(receipts.length, 2, "one terminal receipt per same-skill node");
  assert.equal(new Set(receipts.map((receipt) => receipt.runId)).size, 2);
  assert.equal(new Set(receipts.map((receipt) => receipt.receiptId)).size, 2);
});

const durableCursorStore = () => {
  const cursors = new Map();
  const attempts = new Map();
  const byKey = new Map();
  return {
    async saveCursor(cursor) {
      cursors.set(cursor.cursorId, structuredClone(cursor));
    },
    async loadCursor(cursorId) {
      return cursors.has(cursorId) ? structuredClone(cursors.get(cursorId)) : null;
    },
    async beginChildAttempt(record) {
      if (byKey.has(record.logicalKey)) throw new Error("duplicate child attempt");
      const stored = { ...record, state: "dispatched" };
      attempts.set(record.attemptId, stored);
      byKey.set(record.logicalKey, stored);
    },
    async saveChildAttemptResult(attemptId, response, state = "terminal") {
      const record = attempts.get(attemptId) ?? { attemptId };
      record.response = structuredClone(response);
      record.state = state;
      attempts.set(attemptId, record);
      if (record.logicalKey) byKey.set(record.logicalKey, record);
    },
    async loadChildAttemptByKey(key) {
      return byKey.get(key) ?? null;
    },
    async recordReconciliation() {},
  };
};

test("T010: resume reconciles completed same-skill nodes without re-dispatch", async () => {
  const store = durableCursorStore();
  const shared = {
    runId: "run-autonomy-node-resume",
    signals: { capabilities: ["csm-scan"] },
    approvals: nodeBoundApprovals,
    maxParallelism: 4,
    dynamicProposal: sameSkillProposal,
    dynamicApproved: true,
    dynamicRouteKind: "research",
    cursorStore: store,
  };

  const firstHost = hostFixture();
  const first = await orchestrate(await autonomyOptions(firstHost, shared));
  assert.notEqual(first.outcome.status, "BLOCKED", JSON.stringify({ reason: first.reason }));
  const firstChildRunIds = firstHost.requests
    .filter((request) => request.skill === "csm-review")
    .map((request) => request.childRunId);
  assert.equal(firstChildRunIds.length, 2);
  assert.equal(new Set(firstChildRunIds).size, 2);

  const resumedHost = hostFixture();
  const resumed = await orchestrate(await autonomyOptions(resumedHost, shared));
  assert.equal(resumedHost.calls, 0, "completed nodes must reconcile, not re-dispatch");
  const resumedReceipts = resumed.childReceipts.filter((receipt) => receipt.owner === "csm-review");
  assert.equal(resumedReceipts.length, 2, "each node reconciles its own terminal receipt");
  assert.deepEqual(
    resumedReceipts.map((receipt) => receipt.runId).toSorted(),
    [...firstChildRunIds].toSorted(),
    "resume reuses every node's distinct child identity",
  );
});

test("T010: child identities stay bounded for long names and retries", () => {
  const long = "x".repeat(300);
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = childRunIdForNode(long, long, `${long}-${i}`, i);
    assert.ok(id.length <= 96, `child id must be bounded: ${id.length}`);
    ids.add(id);
  }
  assert.equal(ids.size, 200, "bounded long-name ids must remain unique");
  const base = childRunIdForNode(long, long, `${long}-retry`, 1);
  const retry = retryChildRunIdForNode(long, long, `${long}-retry`, 1, 2);
  assert.ok(base.length <= 96, "base id bounded");
  assert.ok(retry.length <= 100, `retry id must fit the 100-char contract cap: ${retry.length}`);
  assert.ok(retry.endsWith("-2"), "retry id keeps the attempt suffix");
});
