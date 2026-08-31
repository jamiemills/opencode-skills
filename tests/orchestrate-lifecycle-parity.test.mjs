import assert from "node:assert/strict";
import test from "node:test";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { compileApproach } from "../csm-orchestrate/lib/phase-compiler.mjs";
import {
  coordinateFinalReview,
  reviewAcceptance,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const capabilities = await loadCapabilities();

function approach() {
  return {
    schema: "csm-approach/1",
    schemaRevision: 1,
    status: "agreed",
    runId: "run-lifecycle-parity",
    ideaSlug: "lifecycle-parity",
    phases: [
      {
        phaseId: "P1",
        title: "Foundation",
        goal: "implementation",
        deliverables: ["foundation"],
        scope: ["repository"],
        outOfScope: ["production"],
        constraints: [],
        acceptanceHints: ["technical pass", "functional pass"],
        context: [],
        dependencies: [],
      },
      {
        phaseId: "P2",
        title: "Finish",
        goal: "implementation",
        deliverables: ["finish"],
        scope: ["repository"],
        outOfScope: ["production"],
        constraints: [],
        acceptanceHints: ["technical pass", "functional pass"],
        context: [],
        dependencies: ["P1"],
      },
    ],
  };
}

function graph() {
  return {
    runId: "run-lifecycle-parity",
    graphRevision: 1,
    phases: [
      {
        phaseId: "phase-one",
        parentPhaseId: null,
        insertion: { mode: "initial", ordinal: 0 },
        order: 0,
        dependencies: [],
        remediationBudget: 1,
      },
      {
        phaseId: "phase-two",
        parentPhaseId: null,
        insertion: { mode: "initial", ordinal: 1 },
        order: 1,
        dependencies: ["phase-one"],
        remediationBudget: 1,
      },
      {
        phaseId: "phase-three",
        parentPhaseId: null,
        insertion: { mode: "initial", ordinal: 2 },
        order: 2,
        dependencies: ["phase-two"],
        remediationBudget: 1,
      },
    ],
  };
}

function rejectedReview() {
  return {
    status: "REJECTED",
    runId: "run-lifecycle-parity",
    reviewId: "review-remediate",
    findings: [{ code: "missing-behavior", severity: "high" }],
  };
}

function remediation(overrides = {}) {
  return {
    phaseId: "phase-remediation",
    parentPhaseId: "phase-one",
    graphRevision: 2,
    insertion: { insertedAfter: "phase-one" },
    route: "csm-review",
    requirementDelta: ["req-fix"],
    requirementIds: ["req-fix"],
    acceptanceSignals: ["functional pass"],
    approvalScope: ["read"],
    idempotency: { key: "remediation-effect", mode: "natural" },
    sideEffects: ["read-only"],
    remediationBudget: 1,
    ...overrides,
  };
}

test("multi-phase compilation preserves identity, dependency order, requirements, and exact signals", async () => {
  const result = await compileApproach(approach(), {
    capabilities,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    graphRevision: 7,
  });
  assert.equal(result.graphRevision, 7);
  assert.deepEqual(
    result.phases.map((phase) => phase.phaseId),
    ["phase-lifecycle-parity-p1", "phase-lifecycle-parity-p2"],
  );
  assert.deepEqual(result.phases[1].dependencies, ["phase-lifecycle-parity-p1"]);
  assert.equal(
    result.phases.every((phase) => phase.requirementIds.length === 1),
    true,
  );
  assert.equal(
    result.phases.every((phase) => phase.acceptanceSignalIds.length === 3),
    true,
  );
});

test("remediation increments graph revision, inserts after its anchor, and reindexes later phases", () => {
  const result = coordinateFinalReview({
    graph: graph(),
    review: rejectedReview(),
    remediation: remediation(),
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.equal(result.graph.graphRevision, 2);
  assert.deepEqual(
    result.graph.phases.map((phase) => phase.phaseId),
    ["phase-one", "phase-remediation", "phase-two", "phase-three"],
  );
  assert.deepEqual(
    result.graph.phases.map((phase) => phase.order),
    [0, 1, 2, 3],
  );
  assert.deepEqual(result.remediationBudget, {
    total: 3,
    consumed: 1,
    remaining: 2,
    cycles: 1,
    exhausted: false,
  });
  assert.equal(result.remediation.sourceReviewId, "review-remediate");
  assert.equal(result.remediation.acceptanceContract.requiresTechnicalAndFunctionalGates, true);
});

test("stale revision, duplicate effects, duplicate IDs, and cycles are rejected", () => {
  assert.throws(
    () =>
      coordinateFinalReview({
        graph: graph(),
        review: rejectedReview(),
        remediation: remediation({ graphRevision: 1 }),
      }),
    /graph revision is stale/,
  );
  assert.throws(
    () =>
      coordinateFinalReview({
        graph: graph(),
        review: rejectedReview(),
        remediation: remediation({
          sideEffects: ["network"],
          idempotency: { key: "new", mode: "required" },
        }),
        completedEffects: new Set(["network"]),
      }),
    /repeats a non-idempotent effect/,
  );
  assert.throws(
    () =>
      coordinateFinalReview({
        graph: graph(),
        review: rejectedReview(),
        remediation: remediation({ phaseId: "phase-two" }),
      }),
    /duplicate remediation phase ID/,
  );
  assert.throws(
    () =>
      coordinateFinalReview({
        graph: graph(),
        review: rejectedReview(),
        remediation: remediation({ dependencies: ["phase-remediation"] }),
      }),
    /creates a cycle/,
  );
});

test("remediation budget exhaustion blocks rather than inserting another phase", () => {
  const exhausted = coordinateFinalReview({
    graph: { ...graph(), remediationBudget: { total: 1, consumed: 1, cycles: 1 } },
    review: rejectedReview(),
    remediation: remediation({ graphRevision: 2 }),
  });
  assert.equal(exhausted.status, "BLOCKED");
  assert.equal(exhausted.routing.reason, "remediation-budget-exhausted");
  assert.equal(exhausted.graph.phases.length, 3);
  assert.equal(exhausted.remediationBudget.exhausted, true);
});

test("an accepted review without the host trust token cannot produce VERIFIED", () => {
  const review = reviewAcceptance({
    runId: "run-lifecycle-parity",
    requirements: [],
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    completion: true,
  });
  assert.equal(coordinateFinalReview({ graph: graph(), review }).status, "INCOMPLETE");
});
