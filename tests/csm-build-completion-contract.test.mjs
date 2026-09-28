// T010: csm-build consumes the csm-plan/2 completion contract.
//
// When a plan carries `completionContract`, csm-build derives the mandated
// close-out task sequence from `completionContract.closeOutSequence`
// (defaulting to the canonical independent-verdict / authorized-commit /
// push+CI-green / close sequence). A legacy csm-plan/1 plan has no contract
// and keeps the pre-existing baseline behavior. This test also guards the
// SKILL pointer and the file's line budget.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  CANONICAL_CLOSE_OUT_SEQUENCE,
  LEGACY_CLOSE_OUT_SEQUENCE,
  closeOutSequenceFor,
  hasCompletionContract,
} from "../csm-build/lib/completion-contract.mjs";
import { createPlanArtifact } from "../csm-plan/lib/plan.mjs";

const root = join(import.meta.dirname, "..");
const SIGNAL = "node --test tests/csm-build-completion-contract.test.mjs";
const CONTRACT = {
  definitionOfDone: "close-out sequence is consumed and legacy plans are unchanged",
  closeOutSequence: [
    "independent completion verdict recorded",
    { step: "push and confirm CI green", required: true },
    "close",
  ],
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

test("a /2 plan with a completion contract yields its close-out sequence", () => {
  const plan = createPlanArtifact({
    planId: "build-close-out-v2",
    schemaRevision: 2,
    completionContract: CONTRACT,
    tasks: [task()],
  });
  assert.equal(plan.schema, "csm-plan/2");
  assert.equal(hasCompletionContract(plan), true);
  assert.deepEqual(closeOutSequenceFor(plan), CONTRACT.closeOutSequence);
  assert.notEqual(closeOutSequenceFor(plan), plan.completionContract.closeOutSequence);
});

test("a completion contract without an explicit sequence defaults to the canonical sequence", () => {
  assert.deepEqual(
    closeOutSequenceFor({ completionContract: { definitionOfDone: "done" } }),
    CANONICAL_CLOSE_OUT_SEQUENCE,
  );
  assert.deepEqual(
    closeOutSequenceFor({ completionContract: { definitionOfDone: "done", closeOutSequence: [] } }),
    CANONICAL_CLOSE_OUT_SEQUENCE,
  );
});

test("a legacy /1 plan without a completion contract behaves as before", () => {
  const plan = createPlanArtifact({ planId: "build-close-out-v1", tasks: [task()] });
  assert.equal(plan.schema, "csm-plan/1");
  assert.equal(hasCompletionContract(plan), false);
  assert.deepEqual(closeOutSequenceFor(plan), LEGACY_CLOSE_OUT_SEQUENCE);
  assert.deepEqual(closeOutSequenceFor(plan), []);
  assert.deepEqual(closeOutSequenceFor(null), []);
  assert.deepEqual(closeOutSequenceFor({}), []);
});

test("the derived sequence is an isolated frozen copy", () => {
  const plan = {
    completionContract: { definitionOfDone: "done", closeOutSequence: [{ step: "x" }] },
  };
  const sequence = closeOutSequenceFor(plan);
  assert.ok(Object.isFrozen(sequence));
  assert.notEqual(sequence, plan.completionContract.closeOutSequence);
  assert.notEqual(sequence[0], plan.completionContract.closeOutSequence[0]);
});

test("csm-build/SKILL.md points at the library and the mandated close-out sequence", async () => {
  const text = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  assert.match(text, /csm-build\/lib\/completion-contract\.mjs/);
  assert.match(text, /closeOutSequenceFor/);
  assert.match(text, /close-out sequence/i);
});

test("csm-build/SKILL.md stays under the 500-line limit", async () => {
  const text = await readFile(join(root, "csm-build", "SKILL.md"), "utf8");
  const lines = text.split(/\r?\n/).length;
  assert.ok(lines < 500, `csm-build/SKILL.md is ${lines} lines (must be < 500)`);
});
