import assert from "node:assert/strict";
import { test } from "node:test";
import { createSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";
import { readFile } from "node:fs/promises";
import {
  coordinateFinalReview,
  reviewAcceptance,
  validateInjectedFinalReview,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const base = {
  runId: "run-review-test",
  requirements: [
    { requirementId: "req-outcome", criticality: "critical", acceptanceSignalIds: ["sig-outcome"] },
  ],
  claims: [
    {
      requirementIds: ["req-outcome"],
      acceptanceSignalId: "sig-outcome",
      evidenceRefs: [{ evidenceId: "ev-result", acceptanceSignalId: "sig-outcome" }],
    },
  ],
  evidence: [
    {
      evidenceId: "ev-result",
      status: "current",
      requirementIds: ["req-outcome"],
      acceptanceSignalId: "sig-outcome",
    },
  ],
  artifacts: [
    { artifactId: "artifact-result", path: "result.json", digest, runId: "run-review-test" },
  ],
  technical: [{ status: "pass" }],
  functional: [{ status: "pass" }],
  completion: true,
};

test("fresh-context review rejects unsupported completion and does not require producer rationale", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  assert.equal(review.status, "REJECTED");
  assert.equal(review.independent, true);
  assert.ok(review.findings.some((item) => item.code === "false-completion"));
});

test("review catches omissions, stale identity, unsafe actions, and technical/functional failures", () => {
  const review = reviewAcceptance({
    ...base,
    omissions: ["export"],
    actions: [{ authorized: false }],
    artifacts: [{ artifactId: "artifact-result", path: "result.json", digest, stale: true }],
    technical: [{ status: "pass" }],
    functional: [{ status: "fail" }],
  });
  assert.equal(review.status, "REJECTED");
  assert.deepEqual(
    new Set(review.findings.map((item) => item.code)),
    new Set(["omissions", "unsafe-action", "stale-duplicate-output", "gate-failure"]),
  );
});

test("failed final review inserts a bounded phase and supplies risk-based csm-review routing", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const graph = { graphRevision: 1, phases: [{ phaseId: "phase-root", parentPhaseId: null }] };
  const result = coordinateFinalReview({
    graph,
    phase: graph.phases[0],
    review,
    remediation: {
      phaseId: "phase-remediate",
      parentPhaseId: "phase-root",
      graphRevision: 2,
      insertion: { insertedAfter: "phase-root" },
      route: "csm-review",
      requirementDelta: ["req-outcome"],
      requirementIds: ["req-outcome"],
      acceptanceSignals: ["verified export"],
      approvalScope: ["read", "write"],
      idempotency: { key: "remediate-1", mode: "required" },
      remediationBudget: 1,
    },
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.equal(result.routing.route, "csm-review");
  assert.equal(result.remediation.parentPhaseId, "phase-root");
  assert.equal(result.graph.graphRevision, 2);
  assert.deepEqual(result.remediation.reviewFindings, review.findings);
  assert.equal(result.remediation.sourceReviewId, review.reviewId);
  assert.equal(result.remediation.acceptanceContract.evidenceRequired, true);
});

test("accepted injected review without contextual evidence cannot verify the parent", () => {
  const result = coordinateFinalReview({
    graph: { runId: "run-review-test", graphRevision: 1, phases: [] },
    review: {
      schema: "csm-orchestrate-adversarial-review/1",
      reviewId: "review-self-attested",
      runId: "run-review-test",
      status: "ACCEPTED",
      independent: true,
      findings: [],
    },
    injected: true,
  });
  assert.equal(result.status, "INCOMPLETE");
});

test("same-process independent flag cannot produce VERIFIED", () => {
  const result = coordinateFinalReview({
    graph: { runId: "run-review-test", graphRevision: 1, phases: [] },
    review: { ...reviewAcceptance(base), status: "ACCEPTED" },
    injected: true,
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.routing.reason, "untrusted-review-provenance");
});

test("host-backed review requires distinct child identity and bound provenance", () => {
  const review = {
    ...reviewAcceptance(base),
    status: "ACCEPTED",
    phaseId: "phase-root",
    provenance: {
      mode: "host-backed",
      reviewer: "independent-reviewer",
      owner: "csm-review",
      reviewerChildRunId: "run-review-child",
      receipt: { artifactId: "art-review-receipt", runId: "run-review-child", digest },
      artifact: { artifactId: "art-review", runId: "run-review-child", digest },
      approval: {
        approvalId: "approval-review",
        edgeId: "edge-review",
        parentRunId: "run-review-test",
        reviewerChildRunId: "run-review-child",
        phaseId: "phase-root",
        approvedDigest: digest,
      },
    },
  };
  assert.equal(
    coordinateFinalReview({
      graph: { runId: "run-review-test", graphRevision: 1, phases: [] },
      review,
    }).status,
    "INCOMPLETE",
  );
  assert.equal(
    coordinateFinalReview({
      graph: { runId: "run-review-test", graphRevision: 1, phases: [] },
      review: {
        ...review,
        provenance: { ...review.provenance, reviewerChildRunId: "run-review-test" },
      },
    }).status,
    "INCOMPLETE",
  );
});

test("injected acceptance must cover every critical parent requirement with matching current evidence", () => {
  const result = validateInjectedFinalReview({
    review: {
      runId: "run-review-test",
      status: "ACCEPTED",
      findings: [],
      technical: [{ status: "pass" }],
      functional: [{ status: "pass" }],
      evidenceEntailment: "supported",
      requirementCoverage: [{ requirementId: "req-one", evidenceRefs: ["ev-one"] }],
    },
    runId: "run-review-test",
    phaseResults: [
      {
        phase: { requirementIds: ["req-one", "req-two"] },
        gate: { technical: {}, functional: {} },
      },
    ],
    evidence: [
      { evidenceId: "ev-one", status: "current", requirementIds: ["req-one"] },
      { evidenceId: "ev-two", status: "current", requirementIds: ["req-two"] },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((item) => item.includes("req-two")));
});

test("insertion rejects duplicate IDs, cycles, stale revisions, exhausted budgets, and repeated effects", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const graph = { graphRevision: 1, phases: [{ phaseId: "phase-root", parentPhaseId: null }] };
  const remediation = {
    phaseId: "phase-remediate",
    parentPhaseId: "phase-root",
    graphRevision: 2,
    insertion: { insertedAfter: "phase-root" },
    route: "csm-review",
    requirementDelta: ["req-outcome"],
    acceptanceSignals: ["verified"],
    approvalScope: [],
    idempotency: { key: "effect", mode: "required" },
    remediationBudget: 1,
  };
  for (const [change, message] of [
    [{ phaseId: "phase-root" }, "duplicate"],
    [{ parentPhaseId: "phase-remediate" }, "cycle"],
    [{ graphRevision: 1 }, "stale"],
    [{ remediationBudget: 0 }, "budget"],
    [{ idempotency: { key: "effect", mode: "required" } }, "effect"],
  ]) {
    assert.throws(
      () =>
        coordinateFinalReview({
          graph,
          review,
          remediation: { ...remediation, ...change },
          completedEffects: message === "effect" ? new Set(["effect"]) : new Set(),
        }),
      /invalid|duplicate|cycle|revision|budget|repeats|unknown/,
    );
  }
});

test("review artifacts are registered and schema-valid", async () => {
  const registry = parseJson(
    await readFile(new URL("../schemas/registry.json", import.meta.url), "utf8"),
  );
  const schemas = await Promise.all(
    registry.entries.map(async (entry) => {
      const schema = parseJson(
        await readFile(new URL(`../${entry.schemaPath}`, import.meta.url), "utf8"),
      );
      Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
      return schema;
    }),
  );
  const checked = createSchemaRegistry({ registry, schemas });
  assert.equal(
    checked.validate("csm-orchestrate-adversarial-review/2", reviewAcceptance(base)).valid,
    true,
  );
  assert.equal(
    checked.validate("csm-orchestrate-adversarial-review/1", {
      ...reviewAcceptance(base),
      provenance: undefined,
    }).valid,
    false,
  );
});
