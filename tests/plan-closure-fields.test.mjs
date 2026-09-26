// T004: close the csm-plan write-only repair/applicability fields in the loop.
//
// The retro found `repairAttempts`/`critiqueResolution` never written, and
// applicability obligations left `required`/`missing` on completed plans while
// `spikeCandidate` stayed unused. This suite pins the enforcement:
//   R1  `recordRepair` increments `repairAttempts` and appends a
//       `critiqueResolution` row on every REPAIR cycle;
//   R2  `closePlan` closes every applicability obligation to `satisfied` or
//       `not_applicable` and clears every non-`none` `spikeCandidate`;
//   R3  `closePlan` fails closed (`missing-ddd-reason`) when a warranted plan
//       has no `dddArtifacts` and no recorded reason;
//   R4  `closePlan` fails closed (`unresolved-obligation`) while a required
//       obligation is still unresolved.
import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../lib/schema-runtime/index.mjs";
import {
  PLAN_SCHEMA,
  PLAN_SCHEMA_V2,
  createPlanArtifact,
  validatePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import {
  APPLICABILITY_CLOSURE_FORMAT,
  closePlan,
  createEvaluatorReceipt,
  recordRepair,
} from "../csm-plan/lib/loop-evaluator.mjs";

const SIGNAL = "`node --test tests/plan-closure-fields.test.mjs` passes (exit 0)";
const DDG_ARTIFACT = {
  report: ".agents/ddd/report.md",
  graph: ".agents/ddd/graph.json",
  runId: "run-ddd",
  reportRunId: "run-ddd",
  graphRunId: "run-ddd",
};

function applicability(overrides = {}) {
  return {
    format: "csm-applicability/1",
    decision: "warranted",
    mode: "risk-first",
    matchedSignals: ["public_contract"],
    evidence: [{ source: "brief", locator: "request", observation: "public contract changed" }],
    obligations: [
      { id: "contract", status: "required" },
      { id: "parity", status: "required" },
      { id: "observable_behavior", status: "required" },
    ],
    taskApplicability: { warranted: ["T001"], lightweight: [] },
    dddArtifacts: [DDG_ARTIFACT],
    unresolvedRisks: [],
    bypass: { requested: false, rationale: null },
    ...overrides,
  };
}

function planWithClosure({ planId, schemaRevision, applicability: record, spikeCandidate } = {}) {
  return createPlanArtifact({
    planId,
    ...(schemaRevision ? { schemaRevision } : {}),
    ...(record ? { applicability: record } : {}),
    tasks: [
      {
        taskId: "T001",
        ordinal: 1,
        status: "completed",
        acceptanceSignal: SIGNAL,
        ...(spikeCandidate ? { spikeCandidate } : {}),
      },
    ],
  });
}

function passingReceipt(value) {
  const { receiptDigest, ...body } = createEvaluatorReceipt(value);
  void receiptDigest;
  const signed = {
    ...body,
    verdict: "complete",
    evidence: `${body.evidence}; independently verified`,
  };
  return { ...signed, receiptDigest: digest(signed) };
}

function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to throw" });
}

test("recordRepair increments repairAttempts and appends a critiqueResolution row", () => {
  const plan = planWithClosure({ planId: "repair-attempts" });
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });
  assert.equal(plan.tasks[0].repairAttempts ?? 0, 0);
  assert.deepEqual(plan.critiqueResolution, []);

  const once = recordRepair(plan, {
    taskId: "T001",
    finding: "acceptance signal was disjunctive",
    severity: "high",
    resolution: "rewrote as one positive assertion",
    evidence: "node csm-plan/lib/loop-evaluator.mjs lint --record plan.json",
  });
  assert.equal(once.tasks[0].repairAttempts, 1);
  assert.equal(once.critiqueResolution.length, 1);
  assert.deepEqual(
    {
      taskId: once.critiqueResolution[0].taskId,
      severity: once.critiqueResolution[0].severity,
    },
    { taskId: "T001", severity: "high" },
  );
  assert.match(once.critiqueResolution[0].finding, /disjunctive/);
  assert.match(once.critiqueResolution[0].resolution, /positive assertion/);
  assert.match(once.critiqueResolution[0].evidence, /lint/);
  assert.deepEqual(validatePlanArtifact(once), { valid: true, errors: [] });

  const twice = recordRepair(once, {
    taskId: "T001",
    finding: "still flaky",
    severity: "low",
    resolution: "isolated the fixture",
  });
  assert.equal(twice.tasks[0].repairAttempts, 2);
  assert.equal(twice.critiqueResolution.length, 2);
  // The helper is immutable and refreshes the content digest.
  assert.equal(once.critiqueResolution.length, 1);
  assert.equal(plan.tasks[0].repairAttempts ?? 0, 0);
  assert.equal(
    twice.digest,
    digest(Object.fromEntries(Object.entries(twice).filter(([key]) => key !== "digest"))),
  );
});

test("recordRepair is additive across both plan revisions and refuses bad input", () => {
  for (const schemaRevision of [undefined, 2]) {
    const plan = planWithClosure({
      planId: `repair-revision-${schemaRevision ?? 1}`,
      schemaRevision,
    });
    const repaired = recordRepair(plan, {
      taskId: "T001",
      finding: "finding",
      severity: "medium",
      resolution: "resolution",
    });
    assert.equal(repaired.schema, schemaRevision === 2 ? PLAN_SCHEMA_V2 : PLAN_SCHEMA);
    assert.equal(repaired.tasks[0].repairAttempts, 1);
    assert.deepEqual(validatePlanArtifact(repaired), { valid: true, errors: [] });
  }

  const plan = planWithClosure({ planId: "repair-bad-input" });
  assert.equal(
    captureThrow(() => recordRepair(plan, { taskId: "T999", finding: "f", resolution: "r" })).code,
    "unknown-task",
  );
  assert.equal(
    captureThrow(() => recordRepair(plan, { taskId: "T001", finding: "", resolution: "r" })).code,
    "invalid-repair",
  );
});

test("closePlan closes every applicability obligation and clears spikeCandidate", () => {
  const plan = planWithClosure({
    planId: "closure-closes",
    applicability: applicability(),
    spikeCandidate: "does this need a prototype?",
  });
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });

  const closed = closePlan(plan, { receipt: passingReceipt(plan) });
  assert.equal(closed.status, "complete");
  for (const obligation of closed.applicability.obligations) {
    assert.ok(
      ["satisfied", "not_applicable"].includes(obligation.status),
      `obligation ${obligation.id} closed as ${obligation.status}`,
    );
  }
  assert.equal(
    closed.applicability.obligations.some(({ status }) => ["required", "missing"].includes(status)),
    false,
  );
  assert.equal(closed.applicability.closure.format, APPLICABILITY_CLOSURE_FORMAT);
  assert.equal(typeof closed.applicability.closure.closedAt, "string");
  assert.deepEqual(closed.applicability.closure.spikeCandidates, [
    { taskId: "T001", candidate: "does this need a prototype?" },
  ]);

  // The write-only spike field is resolved to `none` on the completed plan.
  assert.equal(closed.tasks[0].spikeCandidate, "none");
  // The closure record survives validation (it is an additive applicability key).
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});

test("closePlan refuses a warranted plan with no dddArtifacts and no recorded reason", () => {
  const plan = planWithClosure({
    planId: "closure-missing-ddd-reason",
    applicability: applicability({ dddArtifacts: [] }),
  });
  const error = captureThrow(() => closePlan(plan, { receipt: passingReceipt(plan) }));
  assert.equal(error.code, "missing-ddd-reason");
  // Nothing terminal was written; the input is untouched.
  assert.equal(plan.status, "ready");
  assert.equal(plan.applicability.closure, undefined);
});

test("closePlan accepts an empty-dddArtifacts plan when a reason is recorded and closes as not_applicable", () => {
  const plan = planWithClosure({
    planId: "closure-with-ddd-reason",
    applicability: applicability({ dddArtifacts: [] }),
  });
  const closed = closePlan(plan, {
    receipt: passingReceipt(plan),
    dddReason: "public contract is documentation-only; no DDD analysis required",
  });
  assert.match(closed.applicability.closure.reason, /documentation-only/);
  for (const obligation of closed.applicability.obligations)
    assert.ok(["satisfied", "not_applicable"].includes(obligation.status), obligation.status);
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});

test("closePlan refuses while a required obligation is unresolved", () => {
  const plan = planWithClosure({
    planId: "closure-unresolved-obligation",
    applicability: applicability({
      obligations: [
        { id: "contract", status: "unverified" },
        { id: "parity", status: "required" },
        { id: "observable_behavior", status: "required" },
      ],
    }),
  });
  const error = captureThrow(() => closePlan(plan, { receipt: passingReceipt(plan) }));
  assert.equal(error.code, "unresolved-obligation");
  assert.deepEqual(error.obligations, ["contract"]);
  assert.equal(plan.status, "ready");
});

test("closePlan leaves plans without applicability/spike fields unchanged in behaviour", () => {
  const plan = createPlanArtifact({
    planId: "closure-no-applicability",
    tasks: [{ taskId: "T001", ordinal: 1, status: "completed", acceptanceSignal: SIGNAL }],
  });
  const closed = closePlan(plan, { receipt: passingReceipt(plan) });
  assert.equal(closed.status, "complete");
  assert.equal(closed.applicability, null);
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});
