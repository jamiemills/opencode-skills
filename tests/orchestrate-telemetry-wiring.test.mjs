import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { makeAutonomousFunctionalGate, orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import {
  createJsonlTransport,
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";
import { createSignalValidator } from "../csm-orchestrate/lib/validators.mjs";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const SHA_E = `sha256:${"e".repeat(64)}`;
const CONFIG_DIGEST = `sha256:${"f".repeat(64)}`;
const NOW = () => new Date("2026-08-28T12:00:00Z");

const approachFor = (runId, phaseCount = 1) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "telemetry",
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

function hostFixture({ failFirst = 0 } = {}) {
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
      if (calls <= failFirst)
        return {
          status: "failed",
          failure: {
            class: "transport",
            code: "connection-reset",
            message: "transient transport failure",
          },
        };
      const requirementId = `req-telemetry-${request.phaseId.split("-").at(-1)}`;
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

const orchestrateOptions = async (host, { runId, ...extra }) => {
  const capabilities = await loadCapabilities();
  return {
    approach: approachFor(runId),
    runId,
    host: withReviewHost(host, runId),
    capabilities,
    signals: { capabilities: ["csm-scan"] },
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

const statusValidator = () =>
  createSignalValidator({
    signalId: "signal-report-status",
    validatorId: "validator-report-status",
    version: 1,
    inputSchema: { type: "string" },
    predicate: { type: "string-contains", pattern: "status: PASS" },
    policyDigest: SHA_E,
  });

test("createJsonlTransport writes and reads events round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telemetry-jsonl-"));
  try {
    const filePath = join(dir, "events.jsonl");
    const transport = createJsonlTransport(filePath);
    await transport.write({
      schema: "csm-orchestrate-telemetry-event/1",
      eventId: "evt-one",
      sequence: 1,
    });
    transport.write({
      schema: "csm-orchestrate-telemetry-event/1",
      eventId: "evt-two",
      sequence: 2,
    });
    const events = await transport.list();
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event) => event.eventId),
      ["evt-one", "evt-two"],
    );
    assert.deepEqual(events[1], {
      schema: "csm-orchestrate-telemetry-event/1",
      eventId: "evt-two",
      sequence: 2,
    });
    const mode = (await stat(filePath)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.deepEqual(await transport.list(), events);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("orchestrate emits correlated dispatch and terminal events to the JSONL transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telemetry-wiring-"));
  try {
    const runId = "run-telemetry-wiring";
    const transport = createJsonlTransport(join(dir, `${runId}.jsonl`));
    const telemetryEmitter = createTelemetryEmitter({
      transport,
      runId,
      effectiveConfigDigest: CONFIG_DIGEST,
      now: NOW,
    });
    const host = hostFixture();
    const result = await orchestrate(
      await orchestrateOptions(host, {
        runId,
        telemetryEmitter,
        effectiveConfigDigest: CONFIG_DIGEST,
      }),
    );
    assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
    const events = await transport.list();
    assert.ok(events.length >= 2);
    assert.ok(events.every((event) => event.runId === runId));
    assert.ok(events.every((event) => event.effectiveConfigDigest === CONFIG_DIGEST));
    const dispatchEvents = events.filter((event) => event.eventType === "dispatch");
    assert.equal(dispatchEvents.length, 1);
    assert.equal(dispatchEvents[0].phaseId, host.requests[0].phaseId);
    assert.equal(dispatchEvents[0].edgeId, host.requests[0].edgeId);
    assert.equal(dispatchEvents[0].childRunId, host.requests[0].childRunId);
    assert.equal(dispatchEvents[0].attempt, 1);
    assert.equal(dispatchEvents[0].payload.skill, "csm-scan");
    assert.equal(dispatchEvents[0].payload.invocationId, host.requests[0].invocationId);
    const terminalEvents = events.filter((event) => event.eventType === "terminal");
    assert.equal(terminalEvents.length, 1);
    assert.equal(terminalEvents[0].payload.receiptId, result.receiptId);
    assert.equal(terminalEvents[0].payload.status, "VERIFIED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("orchestrate emits a retry event with the retried child correlation ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telemetry-retry-"));
  try {
    const runId = "run-telemetry-retry";
    const transport = createJsonlTransport(join(dir, `${runId}.jsonl`));
    const telemetryEmitter = createTelemetryEmitter({
      transport,
      runId,
      effectiveConfigDigest: CONFIG_DIGEST,
      now: NOW,
    });
    const host = hostFixture({ failFirst: 1 });
    const result = await orchestrate(await orchestrateOptions(host, { runId, telemetryEmitter }));
    assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
    assert.equal(host.calls, 2);
    const events = await transport.list();
    assert.equal(events.filter((event) => event.eventType === "dispatch").length, 1);
    const retryEvents = events.filter((event) => event.eventType === "retry");
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].runId, runId);
    assert.equal(retryEvents[0].phaseId, host.requests[1].phaseId);
    assert.equal(retryEvents[0].childRunId, host.requests[1].childRunId);
    assert.equal(retryEvents[0].attempt, 2);
    assert.equal(retryEvents[0].payload.priorFailureCode, "connection-reset");
    assert.equal(events.filter((event) => event.eventType === "terminal").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telemetry emitter failures never break the run", async () => {
  const host = hostFixture();
  const telemetryEmitter = createTelemetryEmitter({
    transport: {
      write() {
        throw Object.assign(new Error("telemetry sink unavailable"), { code: "sink-down" });
      },
      list: () => [],
    },
    runId: "run-telemetry-broken",
    effectiveConfigDigest: CONFIG_DIGEST,
  });
  const result = await orchestrate(
    await orchestrateOptions(host, {
      runId: "run-telemetry-broken",
      telemetryEmitter,
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.equal(host.calls, 1);
  assert.ok(result.telemetryLosses.length > 0);
  assert.equal(result.telemetryLosses[0].eventType, "telemetry_loss");
  assert.equal(result.telemetryLosses[0].code, "sink-down");
});

test("telemetry auto-computes effectiveConfigDigest when not provided", async () => {
  const transport = createMemoryTransport();
  const telemetryEmitter = createTelemetryEmitter({ transport, runId: "run-telemetry-autodigest" });
  const host = hostFixture();
  const result = await orchestrate(
    await orchestrateOptions(host, { runId: "run-telemetry-autodigest", telemetryEmitter }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  const events = transport.list();
  assert.ok(events.length >= 2, "events are emitted instead of silently dropped");
  assert.ok(
    events.every((event) => /^sha256:[a-f0-9]{64}$/.test(event.effectiveConfigDigest ?? "")),
    "every event carries an auto-computed effectiveConfigDigest",
  );
});

test("makeAutonomousFunctionalGate returns pass for a valid artifact", async () => {
  const gate = makeAutonomousFunctionalGate([
    {
      validator: statusValidator(),
      artifactResolver: async () => ({
        artifactId: "art-report-status",
        value: "report status: PASS",
      }),
    },
  ]);
  const entries = await gate({ phase: {}, node: {}, result: {} });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "pass");
  assert.deepEqual(entries[0].scenarioIds, ["signal-report-status"]);
  assert.deepEqual(entries[0].evidenceRefs, ["ev-report-status"]);
});

test("makeAutonomousFunctionalGate returns fail for an invalid artifact", async () => {
  const gate = makeAutonomousFunctionalGate([
    {
      validator: statusValidator(),
      artifactResolver: async () => ({
        artifactId: "art-report-status",
        value: "report status: FAIL",
      }),
    },
  ]);
  const entries = await gate({ phase: {}, node: {}, result: {} });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "fail");
  assert.deepEqual(entries[0].scenarioIds, ["signal-report-status"]);
  const broken = makeAutonomousFunctionalGate([
    {
      validator: statusValidator(),
      artifactResolver: async () => {
        throw new Error("artifact unreadable");
      },
    },
  ]);
  assert.deepEqual(await broken({ phase: {}, node: {}, result: {} }), [
    {
      status: "fail",
      scenarioId: "signal-report-status",
      scenarioIds: ["signal-report-status"],
      evidenceRefs: [],
    },
  ]);
});

test("functionalGate with a valid artifact lets the phase complete VERIFIED", async () => {
  const host = hostFixture();
  const functionalGate = makeAutonomousFunctionalGate([
    {
      validator: statusValidator(),
      artifactResolver: async () => ({
        artifactId: "art-report-status",
        value: "report status: PASS",
      }),
    },
  ]);
  const result = await orchestrate(
    await orchestrateOptions(host, { runId: "run-gate-valid", functionalGate }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.deepEqual(result.extensions.phaseResults[0].gate.functional, {
    status: "pass",
    scenarioIds: ["signal-report-status"],
    evidenceRefs: ["ev-report-status"],
  });
});

test("functionalGate with an invalid artifact blocks phase completion", async () => {
  const host = hostFixture();
  const functionalGate = makeAutonomousFunctionalGate([
    {
      validator: statusValidator(),
      artifactResolver: async () => ({
        artifactId: "art-report-status",
        value: "report status: FAIL",
      }),
    },
  ]);
  const result = await orchestrate(
    await orchestrateOptions(host, { runId: "run-gate-invalid", functionalGate }),
  );
  assert.notEqual(result.outcome.status, "VERIFIED");
  assert.equal(result.outcome.status, "FAILED");
  assert.equal(result.extensions.phaseResults[0].gate.functional.status, "fail");
  assert.equal(result.statuses.verification, "rejected");
});
