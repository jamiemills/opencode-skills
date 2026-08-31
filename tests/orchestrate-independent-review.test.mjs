import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIndependentFinalReviewExecutor,
  validateReviewProvenance,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const evidence = {
  evidenceId: "ev-independent",
  kind: "technical",
  status: "current",
  owner: "csm-build",
  runId: "run-producer",
  digest,
  requirementIds: ["req-result"],
  acceptanceSignalId: "sig-result",
  source: {
    path: "producer.json",
    artifactId: "artifact-producer",
    digest,
    schema: "csm-fixture/1",
    sourceRunId: "run-producer",
  },
};
const request = {
  parentRunId: "run-producer",
  producerExecutorId: "csm-build-executor",
  phaseId: "phase-result",
  edgeId: "edge-final-review",
  graphRevision: 1,
  timeoutMs: 50,
  requirements: [
    { requirementId: "req-result", criticality: "critical", acceptanceSignalIds: ["sig-result"] },
  ],
  evidence: [evidence],
  phaseResults: [
    {
      phase: { requirementIds: ["req-result"], acceptanceSignalIds: ["sig-result"] },
      gate: {
        status: "VERIFIED",
        technical: [{ status: "pass" }],
        functional: [{ status: "pass" }],
      },
    },
  ],
  childReceipts: [],
  producerRationale: "producer says this is complete",
};

const accepted = () => ({ status: "ACCEPTED", findings: [] });

test("independent executor freezes context and creates separate reviewer lineage", async () => {
  let seen;
  const executor = createIndependentFinalReviewExecutor({
    reviewer: async (input) => {
      seen = input;
      assert.equal(Object.isFrozen(input), true);
      assert.throws(() => input.evidence.push({}), TypeError);
      return accepted();
    },
    producerExecutorId: "csm-build-executor",
  });
  const result = await executor.invokeReview(request);
  assert.equal(seen.producerRationale, undefined);
  assert.equal(result.status, "completed");
  assert.notEqual(result.review.provenance.reviewerChildRunId, request.parentRunId);
  assert.notEqual(result.review.provenance.reviewer, "csm-build");
  assert.equal(result.review.provenance.mode, "in-process-independent");
  assert.equal(
    result.review.provenance.approval.approvedDigest,
    result.review.provenance.artifact.digest,
  );
  assert.notEqual(
    result.review.provenance.receipt.artifactId,
    result.review.provenance.artifact.artifactId,
  );
  assert.equal(validateReviewProvenance(result.review, request.parentRunId).length, 0);
});

test("forged candidate provenance and stale evidence cannot become accepted", async () => {
  const executor = createIndependentFinalReviewExecutor({
    reviewer: async () => ({
      status: "ACCEPTED",
      findings: [],
      provenance: { mode: "host-backed", reviewerChildRunId: "run-forged" },
    }),
  });
  const result = await executor.invokeReview({
    ...request,
    evidence: [{ ...evidence, status: "stale" }],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.review.status, "REJECTED");
  assert.ok(
    result.review.findings.some((finding) => finding.code === "uncovered-critical-requirement"),
  );
  assert.equal(result.review.provenance.mode, "in-process-independent");
});

test("cancelled and timed-out reviewers return typed UNKNOWN outcomes", async () => {
  const controller = new AbortController();
  const executor = createIndependentFinalReviewExecutor({
    reviewer: async (_input, { signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });
  const cancelled = executor.invokeReview(request, { signal: controller.signal });
  controller.abort();
  assert.equal((await cancelled).failure.code, "cancelled");

  const timed = await createIndependentFinalReviewExecutor({
    reviewer: () => new Promise(() => {}),
  }).invokeReview({ ...request, timeoutMs: 1 });
  assert.equal(timed.status, "unknown");
  assert.equal(timed.failure.code, "review-timeout");
});

test("producer identity cannot be reused as an independent executor identity", () => {
  assert.throws(
    () =>
      createIndependentFinalReviewExecutor({
        reviewer: accepted,
        producerExecutorId: "csm-review-independent",
      }),
    /must differ/,
  );
});

test("request-level producer executor identity cannot be relabeled", async () => {
  const executor = createIndependentFinalReviewExecutor({ reviewer: accepted });
  const result = await executor.invokeReview({
    ...request,
    producerExecutorId: "csm-review-independent",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.failure.code, "self-review");
});
