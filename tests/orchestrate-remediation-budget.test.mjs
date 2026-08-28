import assert from "node:assert/strict";
import test from "node:test";
import { assertSchema } from "../csm-orchestrate/lib/contracts.mjs";
import {
  coordinateFinalReview,
  reviewAcceptance,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import {
  acceptedReview,
  rejectedReview,
  remediationFor,
  workingOptions,
} from "./helpers-final-review.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const base = {
  runId: "run-budget-test",
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
    { artifactId: "artifact-result", path: "result.json", digest, runId: "run-budget-test" },
  ],
  technical: [{ status: "pass" }],
  functional: [{ status: "pass" }],
  completion: true,
};

const initialGraph = () => ({
  runId: "run-budget-test",
  graphRevision: 1,
  phases: [
    {
      phaseId: "phase-root",
      parentPhaseId: null,
      insertion: { mode: "initial", ordinal: 0 },
      order: 0,
      remediationBudget: 1,
    },
  ],
});

const remediation = (graphRevision, key) => ({
  phaseId: `phase-remediate-${key}`,
  parentPhaseId: "phase-root",
  graphRevision,
  insertion: { insertedAfter: "phase-root" },
  route: "csm-review",
  requirementDelta: ["req-outcome"],
  requirementIds: ["req-outcome"],
  acceptanceSignals: ["verified export"],
  approvalScope: ["read"],
  idempotency: { key: `remediate-${key}`, mode: "natural" },
  sideEffects: ["read-only"],
  remediationBudget: 1,
});

test("a single remediation consumes budget visibly in graph metadata", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const result = coordinateFinalReview({
    graph: initialGraph(),
    review,
    remediation: remediation(2, "one"),
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.deepEqual(result.remediationBudget, {
    total: 1,
    consumed: 1,
    remaining: 0,
    cycles: 1,
    exhausted: false,
  });
  assert.deepEqual(result.graph.remediationBudget, result.remediationBudget);
  assert.equal(result.graph.phases.length, 2);
});

test("an exhausted run-level budget produces BLOCKED instead of another remediation phase", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const first = coordinateFinalReview({
    graph: initialGraph(),
    review,
    remediation: remediation(2, "one"),
  });
  assert.equal(first.status, "REMEDIATION_REQUIRED");
  const second = coordinateFinalReview({
    graph: first.graph,
    review,
    remediation: remediation(3, "two"),
  });
  assert.equal(second.status, "BLOCKED");
  assert.equal(second.routing.reason, "remediation-budget-exhausted");
  assert.equal(second.graph.phases.length, 2, "no additional phase is inserted");
  assert.deepEqual(second.remediationBudget, {
    total: 1,
    consumed: 2,
    remaining: -1,
    cycles: 2,
    exhausted: true,
  });
  assert.deepEqual(second.graph.remediationBudget, second.remediationBudget);
});

test("pre-consumed graph budget metadata is honored and fails closed", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const graph = {
    ...initialGraph(),
    remediationBudget: { total: 1, consumed: 1, cycles: 1 },
  };
  const result = coordinateFinalReview({ graph, review, remediation: remediation(2, "one") });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.routing.reason, "remediation-budget-exhausted");
  assert.equal(result.graph.phases.length, 1);
});

test("blocked final-review coordination is schema-valid", async () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const result = coordinateFinalReview({
    graph: {
      ...initialGraph(),
      remediationBudget: { total: 1, consumed: 1, cycles: 1 },
    },
    review,
    remediation: remediation(2, "one"),
  });
  await assertSchema("csm-orchestrate-final-review/2", result);
});

test("end-to-end: repeated remediation demand beyond the initial budget blocks the run", async () => {
  const capabilities = await loadCapabilities();
  const reviews = { count: 0 };
  const options = await workingOptions({
    capabilities,
    runId: "run-budget-e2e",
    finalReview: async ({ phase, phaseResults, evidence }) => {
      reviews.count += 1;
      return reviews.count === 1
        ? rejectedReview({ runId: "run-budget-e2e", phase, phaseResults, evidence })
        : rejectedReview({ runId: "run-budget-e2e", phase, phaseResults, evidence });
    },
    remediationFactory: async ({ graph }) =>
      remediationFor({
        graph,
        key: `e2e-${reviews.count}`,
        parentPhaseId: graph.phases[0].phaseId,
        insertedAfter: graph.phases[0].phaseId,
      }),
  });
  const result = await orchestrate(options);
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "remediation-budget-exhausted");
  assert.equal(result.extensions.phaseSummaries.length, 2);
  assert.equal(result.extensions.remediationLineage.length, 1);
  assert.ok(result.childReceipts.length >= 2);
});

test("end-to-end: a single remediation within budget still verifies", async () => {
  const capabilities = await loadCapabilities();
  const reviews = { count: 0 };
  const options = await workingOptions({
    capabilities,
    runId: "run-budget-verify-e2e",
    finalReview: async ({ phase, phaseResults, evidence }) => {
      reviews.count += 1;
      return reviews.count === 1
        ? rejectedReview({ runId: "run-budget-verify-e2e", phase, phaseResults, evidence })
        : acceptedReview({ runId: "run-budget-verify-e2e", phase, phaseResults, evidence });
    },
    remediationFactory: async ({ graph }) =>
      remediationFor({
        graph,
        key: `e2e-${reviews.count}`,
        parentPhaseId: graph.phases[0].phaseId,
        insertedAfter: graph.phases[0].phaseId,
      }),
  });
  const result = await orchestrate(options);
  assert.equal(result.outcome.status, "VERIFIED");
  assert.equal(result.extensions.remediationLineage.length, 1);
});
