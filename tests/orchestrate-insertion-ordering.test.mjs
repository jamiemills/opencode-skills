import assert from "node:assert/strict";
import test from "node:test";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import {
  coordinateFinalReview,
  reviewAcceptance,
} from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import {
  acceptedReview,
  rejectedReview,
  remediationFor,
  workingOptions,
} from "./helpers-final-review.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const base = {
  runId: "run-insertion-test",
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
    { artifactId: "artifact-result", path: "result.json", digest, runId: "run-insertion-test" },
  ],
  technical: [{ status: "pass" }],
  functional: [{ status: "pass" }],
  completion: true,
};

const threePhaseGraph = () => ({
  runId: "run-insertion-test",
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
});

test("insertedAfter places the remediation phase physically after the anchor phase", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const result = coordinateFinalReview({
    graph: threePhaseGraph(),
    review,
    remediation: {
      phaseId: "phase-remediate",
      parentPhaseId: "phase-one",
      graphRevision: 2,
      insertion: { insertedAfter: "phase-one" },
      route: "csm-review",
      requirementDelta: ["req-outcome"],
      requirementIds: ["req-outcome"],
      acceptanceSignals: ["verified"],
      approvalScope: ["read"],
      idempotency: { key: "remediate-insert", mode: "natural" },
      sideEffects: ["read-only"],
      remediationBudget: 1,
    },
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.deepEqual(
    result.graph.phases.map((phase) => phase.phaseId),
    ["phase-one", "phase-remediate", "phase-two", "phase-three"],
  );
  assert.deepEqual(
    result.graph.phases.map((phase) => phase.order),
    [0, 1, 2, 3],
    "order fields are re-indexed for subsequent phases",
  );
  assert.equal(result.remediation.phaseId, "phase-remediate");
  assert.equal(result.remediation.insertion.mode, "insert");
  assert.deepEqual(result.graph.phases[2].dependencies, ["phase-one"]);
  assert.deepEqual(result.graph.phases[3].dependencies, ["phase-two"]);
});

test("insertion at the end preserves the append behavior and budget accounting", () => {
  const review = reviewAcceptance({ ...base, completion: false });
  const result = coordinateFinalReview({
    graph: threePhaseGraph(),
    review,
    remediation: {
      phaseId: "phase-remediate",
      parentPhaseId: "phase-three",
      graphRevision: 2,
      insertion: { insertedAfter: "phase-three" },
      route: "csm-review",
      requirementDelta: ["req-outcome"],
      requirementIds: ["req-outcome"],
      acceptanceSignals: ["verified"],
      approvalScope: ["read"],
      idempotency: { key: "remediate-append", mode: "natural" },
      sideEffects: ["read-only"],
      remediationBudget: 1,
    },
  });
  assert.equal(result.status, "REMEDIATION_REQUIRED");
  assert.deepEqual(
    result.graph.phases.map((phase) => phase.phaseId),
    ["phase-one", "phase-two", "phase-three", "phase-remediate"],
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
});

const threePhaseApproach = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "insertion-e2e",
  phases: [
    {
      phaseId: "P1",
      title: "First",
      goal: "implementation",
      deliverables: ["increment"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass"],
      context: [],
      dependencies: [],
    },
    {
      phaseId: "P2",
      title: "Second",
      goal: "implementation",
      deliverables: ["increment"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass"],
      context: [],
      dependencies: ["P1"],
    },
    {
      phaseId: "P3",
      title: "Third",
      goal: "implementation",
      deliverables: ["increment"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass"],
      context: [],
      dependencies: ["P2"],
    },
  ],
});

test("end-to-end: mid-array insertion executes the remediation without re-running later phases", async () => {
  const runId = "run-insertion-e2e";
  const capabilities = await loadCapabilities();
  let rejected = false;
  const options = await workingOptions({
    runId,
    ideaSlug: "insertion-e2e",
    capabilities,
    finalReview: async ({ phase, phaseResults, evidence }) => {
      if (!rejected && phase.insertion?.mode !== "insert") {
        rejected = true;
        return rejectedReview({ runId, phaseResults, evidence });
      }
      return acceptedReview({ runId, phaseResults, evidence });
    },
    remediationFactory: async ({ graph }) =>
      remediationFor({
        graph,
        key: "mid",
        parentPhaseId: graph.phases[0].phaseId,
        insertedAfter: graph.phases[0].phaseId,
      }),
  });
  const result = await orchestrate({ ...options, approach: threePhaseApproach(runId) });
  assert.equal(result.outcome.status, "VERIFIED");
  assert.deepEqual(
    result.extensions.phaseSummaries.map((phase) => phase.phaseId),
    [
      "phase-insertion-e2e-p1",
      "phase-insertion-e2e-p2",
      "phase-insertion-e2e-p3",
      "phase-remediation-mid",
    ],
    "execution order is preserved and the remediation runs exactly once",
  );
  assert.equal(options.calls(), 4, "already-executed phases are not re-invoked after insertion");
  const remediationPhase = result.extensions.phaseContracts.find(
    (phase) => phase.phaseId === "phase-remediation-mid",
  );
  assert.equal(remediationPhase.insertion.mode, "insert");
  assert.equal(remediationPhase.insertion.insertedAfter, "phase-insertion-e2e-p1");
  assert.equal(remediationPhase.order, 1);
  assert.deepEqual(result.extensions.remediationLineage.length, 1);
});
