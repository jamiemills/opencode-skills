import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGates,
  reconcileRequirementEvidence,
} from "../csm-orchestrate/lib/evidence-gates.mjs";
import {
  coordinateFinalReview,
  createIndependentFinalReviewExecutor,
  reviewAcceptance,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
  REDACTED_VALUE,
} from "../csm-orchestrate/lib/telemetry.mjs";

const parentRunId = "run-adapter-review";
const digest = (letter) => `sha256:${letter.repeat(64)}`;

const adapterEvidence = [
  {
    evidenceId: "ev-build",
    kind: "technical",
    status: "current",
    owner: "csm-build",
    runId: parentRunId,
    digest: digest("a"),
    requirementIds: ["req-build"],
    acceptanceSignalId: "sig-build",
    source: {
      path: "build-output.json",
      artifactId: "artifact-build-output",
      digest: digest("a"),
      schema: "csm-build-output/1",
      sourceRunId: "run-build-native",
      nativeRunId: "run-build-native",
      nativeArtifactId: "artifact-build-native",
    },
  },
  {
    evidenceId: "ev-browse",
    kind: "functional",
    status: "current",
    owner: "csm-browse",
    runId: parentRunId,
    digest: digest("b"),
    requirementIds: ["req-browse"],
    acceptanceSignalId: "sig-browse",
    source: {
      path: "browse-evidence.json",
      artifactId: "artifact-browse-evidence",
      digest: digest("b"),
      schema: "csm-orchestrate-evidence/2",
      sourceRunId: "run-browse-native",
      nativeRunId: "run-browse-native",
      nativeArtifactId: "ev-native-browse",
    },
  },
  {
    evidenceId: "ev-autoresearch",
    kind: "technical",
    status: "current",
    owner: "csm-autoresearch",
    runId: parentRunId,
    digest: digest("c"),
    requirementIds: ["req-autoresearch"],
    acceptanceSignalId: "sig-autoresearch",
    source: {
      path: "autoresearch-report.json",
      artifactId: "artifact-autoresearch-report",
      digest: digest("c"),
      schema: "csm-autoresearch-artifact/1",
      sourceRunId: "run-autoresearch-native",
      nativeRunId: "run-autoresearch-native",
      nativeArtifactId: "artifact-autoresearch-native",
    },
  },
];

const requirements = adapterEvidence.map((item) => ({
  requirementId: item.requirementIds[0],
  criticality: "critical",
  acceptanceSignalIds: [item.acceptanceSignalId],
}));

const artifacts = adapterEvidence.map((item) => ({
  artifactId: item.source.artifactId,
  path: item.source.path,
  digest: item.digest,
  runId: parentRunId,
}));

test("real adapter-shaped evidence follows exact requirement and gate paths", () => {
  const ledger = {
    schema: "csm-orchestrate-requirement/2",
    ledgerId: "ledger-adapters",
    requirements: requirements.map((requirement) => ({
      ...requirement,
      status: "open",
      evidenceRefs: [
        {
          evidenceId: adapterEvidence.find(
            (item) => item.requirementIds[0] === requirement.requirementId,
          ).evidenceId,
          requirementId: requirement.requirementId,
          digest: digest(
            requirement.requirementId === "req-build"
              ? "a"
              : requirement.requirementId === "req-browse"
                ? "b"
                : "c",
          ),
          acceptanceSignalId: requirement.acceptanceSignalIds[0],
        },
      ],
    })),
  };
  const reconciled = reconcileRequirementEvidence(
    ledger,
    { evidence: adapterEvidence, failures: [] },
    { now: new Date("2026-08-31T00:00:00Z") },
  );
  assert.equal(reconciled.failures.length, 0);
  assert.ok(reconciled.requirements.every((item) => item.status === "verified"));
  const gate = aggregateGates({
    runId: parentRunId,
    phaseId: "phase-adapters",
    technical: [
      { id: "build", status: "pass", evidenceRefs: ["ev-build"] },
      { id: "autoresearch", status: "pass", evidenceRefs: ["ev-autoresearch"] },
    ],
    functional: [{ id: "browse", status: "pass", evidenceRefs: ["ev-browse"] }],
    evidence: adapterEvidence,
    requirementResult: reconciled,
  });
  assert.equal(gate.status, "VERIFIED");
  const review = reviewAcceptance({
    runId: parentRunId,
    requirements,
    claims: adapterEvidence.map((item) => ({
      requirementIds: item.requirementIds,
      acceptanceSignalId: item.acceptanceSignalId,
      evidenceRefs: [{ evidenceId: item.evidenceId, acceptanceSignalId: item.acceptanceSignalId }],
    })),
    evidence: adapterEvidence,
    artifacts,
    technical: gate.technical.scenarioIds.map((id) => ({ id, status: "pass" })),
    functional: gate.functional.scenarioIds.map((id) => ({ id, status: "pass" })),
    completion: true,
  });
  assert.equal(review.status, "ACCEPTED");
  assert.deepEqual(
    review.requirementCoverage.map((item) => item.requirementId),
    ["req-build", "req-browse", "req-autoresearch"],
  );
});

test("independent review receives frozen context and cannot self-assert provenance", async () => {
  let frozen = false;
  const executor = createIndependentFinalReviewExecutor({
    reviewer: async (context) => {
      frozen = Object.isFrozen(context) && Object.isFrozen(context.evidence);
      assert.throws(() => context.evidence.push({}), TypeError);
      return { status: "ACCEPTED", findings: [], evidenceEntailment: "supported" };
    },
    reviewerId: "reviewer-adapter-test",
    executorId: "executor-adapter-test",
    producerExecutorId: "producer-adapter-test",
  });
  const result = await executor.invokeReview({
    parentRunId,
    phaseId: "phase-adapters",
    edgeId: "edge-final-review",
    graphRevision: 1,
    producerExecutorId: "producer-adapter-test",
    requirements: JSON.parse(JSON.stringify(requirements)),
    evidence: JSON.parse(JSON.stringify(adapterEvidence)),
    phaseResults: [
      {
        phase: {
          requirementIds: requirements.map((item) => item.requirementId),
          acceptanceSignalIds: requirements.flatMap((item) => item.acceptanceSignalIds),
        },
        gate: {
          status: "VERIFIED",
          technical: [{ status: "pass" }],
          functional: [{ status: "pass" }],
        },
      },
    ],
  });
  assert.equal(frozen, true);
  assert.equal(result.status, "completed");
  assert.equal(result.review.provenance.reviewerChildRunId === parentRunId, false);
});

test("rejected review inserts bounded remediation for gate re-entry", () => {
  const rejected = reviewAcceptance({
    runId: parentRunId,
    requirements: [requirements[0]],
    claims: [],
    evidence: [],
    artifacts: [],
    technical: [{ status: "fail" }],
    functional: [{ status: "pass" }],
    completion: false,
  });
  const result = coordinateFinalReview({
    graph: {
      runId: parentRunId,
      graphRevision: 1,
      phases: [{ phaseId: "phase-adapters", parentPhaseId: null }],
    },
    review: rejected,
    remediation: {
      phaseId: "phase-remediation-adapters",
      parentPhaseId: "phase-adapters",
      graphRevision: 2,
      insertion: { insertedAfter: "phase-adapters" },
      route: "csm-build",
      requirementDelta: ["req-build"],
      requirementIds: ["req-build"],
      acceptanceSignals: ["sig-build"],
      approvalScope: ["read"],
      idempotency: { key: "remediation-adapters", mode: "natural" },
      remediationBudget: 1,
    },
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.equal(result.remediation.acceptanceContract.requiresIndependentReview, true);
  assert.equal(result.graph.phases[1].insertion.mode, "insert");
});

test("telemetry loss, reorder, duplicate, and partial writes are detected without authority", async () => {
  const events = [];
  const transport = {
    write(event) {
      if (event.sequence === 2) throw new Error("partial write");
      events.push(event);
    },
    list() {
      return events.slice().toReversed();
    },
  };
  const emitter = createTelemetryEmitter({
    transport,
    runId: parentRunId,
    effectiveConfigDigest: digest("f"),
    now: () => "2026-08-31T00:00:00.000Z",
  });
  emitter.emit({
    eventType: "dispatch",
    childRunId: "run-child-adapter",
    payload: { skill: "csm-build" },
  });
  assert.throws(
    () =>
      emitter.emit({
        eventType: "terminal",
        childRunId: "run-child-adapter",
        payload: { status: "VERIFIED" },
      }),
    /partial write/,
  );
  events.push({ ...events[0], sequence: 3, eventId: "evt-duplicate" });
  const loss = emitter.detectLoss();
  assert.equal(loss.lost, true);
  assert.deepEqual(loss.missingSequences, [2]);
  assert.equal(
    emitter.checkCompleteness([{ receiptId: "receipt-adapter", runId: parentRunId }]).complete,
    false,
  );
  await Promise.resolve();
});

test("telemetry redacts URLs, tokens, credentials, and candidate payloads", () => {
  const transport = createMemoryTransport();
  const emitter = createTelemetryEmitter({
    runId: parentRunId,
    effectiveConfigDigest: digest("f"),
    transport,
  });
  emitter.emit({
    eventType: "review",
    payload: {
      url: "https://example.test/path?token=secret",
      accessToken: "token-secret",
      credentials: { password: "pw" },
      candidate: { source: "generated payload", value: "secret candidate" },
      candidateHash: digest("a"),
    },
  });
  const payload = transport.list()[0].payload;
  assert.equal(payload.url, REDACTED_VALUE);
  assert.equal(payload.accessToken, REDACTED_VALUE);
  assert.equal(payload.credentials, REDACTED_VALUE);
  assert.equal(payload.candidate, REDACTED_VALUE);
  assert.equal(payload.candidateHash, digest("a"));
  assert.equal(JSON.stringify(payload).includes("secret"), false);
});
