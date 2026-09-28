// T008: additive csm-plan/2 completionContract + continuationPolicy + per-task
// executionReceipt.
//
// The /2 revision gains an optional top-level completion contract
// (definitionOfDone + closeOutSequence) and continuation policy (sessionUnit,
// checkpointCadence, expectedCycles, guardCommand), plus an optional per-task
// executionReceipt (command, exitCode, digest, recordedAt). The /1 revision is
// frozen: a /1 record carrying any of those fields is rejected, and a frozen
// /1 record without them still validates.
import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../lib/schema-runtime/index.mjs";
import {
  PLAN_SCHEMA,
  PLAN_SCHEMA_V2,
  createPlanArtifact,
  validatePlanArtifact,
} from "../csm-plan/lib/plan.mjs";

const SIGNAL = "node --test tests/plan-completion-contract.test.mjs";
const COMPLETION_CONTRACT = {
  definitionOfDone: "all /2 completion fields validate and the /1 contract stays frozen",
  closeOutSequence: [
    "independent completion verdict recorded",
    { step: "push and confirm CI green", required: true },
  ],
};
const CONTINUATION_POLICY = {
  sessionUnit: "one bounded build cycle",
  checkpointCadence: "after every task cycle",
  expectedCycles: 3,
  guardCommand: "node scripts/verify-traces.mjs --run-id run-t008",
};
const EXECUTION_RECEIPT = {
  command: SIGNAL,
  exitCode: 0,
  digest: `sha256:${"a".repeat(64)}`,
  recordedAt: "2026-09-28T00:00:00Z",
};

function task(overrides = {}) {
  return {
    taskId: "T001",
    ordinal: 1,
    status: "pending",
    acceptanceSignal: SIGNAL,
    ...overrides,
  };
}

test("a /2 plan carries the completion contract, continuation policy, and task receipt", () => {
  const plan = createPlanArtifact({
    planId: "completion-contract-v2",
    schemaRevision: 2,
    completionContract: COMPLETION_CONTRACT,
    continuationPolicy: CONTINUATION_POLICY,
    tasks: [task({ executionReceipt: EXECUTION_RECEIPT })],
  });
  assert.equal(plan.schema, PLAN_SCHEMA_V2);
  assert.equal(plan.schemaRevision, 2);
  assert.deepEqual(plan.completionContract, COMPLETION_CONTRACT);
  assert.deepEqual(plan.continuationPolicy, CONTINUATION_POLICY);
  assert.deepEqual(plan.tasks[0].executionReceipt, EXECUTION_RECEIPT);
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });
  // The content digest covers the additive fields.
  assert.equal(
    plan.digest,
    digest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "digest"))),
  );
});

test("a /2 plan validates with the contract fields and no task receipt", () => {
  const plan = createPlanArtifact({
    planId: "completion-contract-v2-partial",
    schemaRevision: 2,
    completionContract: COMPLETION_CONTRACT,
    continuationPolicy: CONTINUATION_POLICY,
    tasks: [task()],
  });
  assert.equal(Object.hasOwn(plan.tasks[0], "executionReceipt"), false);
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });
});

test("a /1 record carrying the /2-only fields is rejected", () => {
  const base = createPlanArtifact({ planId: "completion-contract-v1", tasks: [task()] });
  assert.equal(base.schema, PLAN_SCHEMA);
  assert.deepEqual(validatePlanArtifact(base), { valid: true, errors: [] });

  const withContract = {
    ...base,
    completionContract: COMPLETION_CONTRACT,
    continuationPolicy: CONTINUATION_POLICY,
  };
  assert.equal(validatePlanArtifact(withContract).valid, false);

  const withReceipt = {
    ...base,
    tasks: [{ ...base.tasks[0], executionReceipt: EXECUTION_RECEIPT }],
  };
  const receiptResult = validatePlanArtifact(withReceipt);
  assert.equal(receiptResult.valid, false);
  assert.ok(receiptResult.errors.some((error) => error.includes("executionReceipt")));
});

test("createPlanArtifact refuses to emit a /1 plan carrying the /2-only fields", () => {
  assert.throws(
    () =>
      createPlanArtifact({
        planId: "completion-contract-v1-reject",
        completionContract: COMPLETION_CONTRACT,
        continuationPolicy: CONTINUATION_POLICY,
      }),
    (error) => error instanceof TypeError,
  );
  assert.throws(
    () =>
      createPlanArtifact({
        planId: "completion-contract-v1-receipt",
        tasks: [task({ executionReceipt: EXECUTION_RECEIPT })],
      }),
    (error) => error instanceof TypeError,
  );
});

test("a frozen /1 record without the /2-only fields still validates", () => {
  const plan = createPlanArtifact({ planId: "frozen-v1", tasks: [task()] });
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(Object.hasOwn(plan, "completionContract"), false);
  assert.equal(Object.hasOwn(plan, "continuationPolicy"), false);
  assert.equal(Object.hasOwn(plan.tasks[0], "executionReceipt"), false);
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });
});
