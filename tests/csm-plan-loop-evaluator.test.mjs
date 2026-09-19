// T006/P4: csm-plan in-loop completion enforcement.
// Proves: (1) a plan with pending tasks cannot close without a passing evaluator
// receipt, and cannot close with one while work remains; (2) disjunctive
// "Either ... OR record a deferral" acceptance signals are refused and genuine
// deferrals stay blocked; (3) creating a successor closes the predecessor via
// the typed /2 supersession pointer; (4) the deterministic loop guard exits
// non-zero (via the module CLI) when work remains and fails closed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { digest } from "../lib/schema-runtime/index.mjs";
import {
  EVALUATOR_CONTRACT,
  createPlanArtifact,
  validatePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import {
  EVALUATOR_RECEIPT_FORMAT,
  closePlan,
  closePredecessorOnSuccessor,
  createEvaluatorReceipt,
  lintAcceptanceSignal,
  lintPlanAcceptanceSignals,
  loopGuard,
  outstandingWork,
  supersedePlanArtifact,
} from "../csm-plan/lib/loop-evaluator.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "csm-plan", "lib", "loop-evaluator.mjs");
const POSITIVE_SIGNAL = "`node --test tests/example.test.mjs` passes (exit 0)";

function planWithTask({ planId, status, acceptanceSignal = POSITIVE_SIGNAL, schemaRevision } = {}) {
  return createPlanArtifact({
    planId,
    ...(schemaRevision ? { schemaRevision } : {}),
    tasks: [
      {
        taskId: "T001",
        ordinal: 1,
        status,
        acceptanceSignal,
      },
    ],
  });
}

function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to throw" });
}

function passingReceipt(value, verdict = "complete") {
  const { receiptDigest, ...body } = createEvaluatorReceipt(value);
  void receiptDigest;
  const signed = { ...body, verdict, evidence: `${body.evidence}; independently verified` };
  return { ...signed, receiptDigest: digest(signed) };
}

async function withTempJson(record, run) {
  const dir = await mkdtemp(join(tmpdir(), "csm-plan-loop-"));
  try {
    const path = join(dir, "record.json");
    await writeFile(path, typeof record === "string" ? record : JSON.stringify(record));
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runGuard(record) {
  return withTempJson(record, (path) =>
    spawnSync(process.execPath, [CLI, "guard", "--record", path], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  );
}

test("evaluator contract is single-verdict and binding", () => {
  assert.equal(EVALUATOR_CONTRACT.format, "csm-evaluator-contract/1");
  assert.deepEqual(EVALUATOR_CONTRACT.outputs, ["continue", "complete", "blocked"]);
  assert.match(EVALUATOR_CONTRACT.binding, /cannot advance to a terminal state/);
});

test("a plan with pending tasks cannot close without a passing receipt", () => {
  const pending = planWithTask({ planId: "pending-no-receipt", status: "pending" });
  const error = captureThrow(() => closePlan(pending));
  assert.equal(error.code, "missing-evaluator-receipt");
  assert.deepEqual(validatePlanArtifact(pending), { valid: true, errors: [] });
});

test("a passing receipt cannot override outstanding work", () => {
  const pending = planWithTask({ planId: "pending-with-receipt", status: "pending" });
  const error = captureThrow(() => closePlan(pending, { receipt: passingReceipt(pending) }));
  assert.equal(error.code, "pending-work");
  assert.deepEqual(
    error.openTasks.map((task) => task.taskId),
    ["T001"],
  );
});

test("a plan with all tasks terminal and a passing receipt closes", () => {
  const done = planWithTask({ planId: "all-terminal", status: "completed" });
  const closed = closePlan(done, { receipt: passingReceipt(done) });
  assert.equal(closed.status, "complete");
  assert.equal(closed.control.currentState, "COMPLETE");
  assert.equal(closed.journal.at(-1).nextState, "COMPLETE");
  assert.equal(closed.journal.at(-1).receipt.format, EVALUATOR_RECEIPT_FORMAT);
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});

test("a journaled receipt is accepted on a later close", () => {
  const done = planWithTask({ planId: "journaled-receipt", status: "completed" });
  const withJournal = structuredClone(done);
  withJournal.journal.push({
    sequence: 0,
    timestamp: "2026-09-19T00:00:00Z",
    cycle: 0,
    transition: "NOT_STARTED -> VERIFY",
    tasks: ["T001"],
    evidence: "planning complete",
    nextState: "VERIFY",
    receipt: passingReceipt(done),
  });
  withJournal.control.currentState = "VERIFY";
  const closed = closePlan(withJournal);
  assert.equal(closed.status, "complete");
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});

test("evaluator verdicts are continue, blocked, and complete", () => {
  const pending = planWithTask({ planId: "verdict-pending", status: "pending" });
  assert.equal(createEvaluatorReceipt(pending).verdict, "continue");

  const blocked = planWithTask({ planId: "verdict-blocked", status: "blocked" });
  assert.equal(createEvaluatorReceipt(blocked).verdict, "blocked");

  const done = planWithTask({ planId: "verdict-done", status: "completed" });
  assert.equal(createEvaluatorReceipt(done).verdict, "complete");
});

test("disjunctive acceptance signals are refused", () => {
  const disjunctive =
    "Either run `node --test tests/a.test.mjs` OR record a deferral in Discovered Requirements";
  const codes = lintAcceptanceSignal(disjunctive).map((error) => error.code);
  assert.ok(codes.includes("disjunctive-acceptance-signal"));
  assert.ok(codes.includes("deferral-escape-signal"));

  const plan = planWithTask({
    planId: "disjunctive-plan",
    status: "completed",
    acceptanceSignal: disjunctive,
  });
  assert.equal(lintPlanAcceptanceSignals(plan).length, 2);
  const receipt = createEvaluatorReceipt(plan);
  assert.equal(receipt.verdict, "blocked");
  assert.equal(receipt.signalErrors.length, 2);
  const error = captureThrow(() => closePlan(plan, { receipt: passingReceipt(plan) }));
  assert.equal(error.code, "invalid-acceptance-signal");
});

test("the acceptance-signal lint CLI fails closed on a disjunctive plan", async () => {
  const plan = planWithTask({
    planId: "cli-disjunctive",
    status: "completed",
    acceptanceSignal: "Either run the suite OR document the deferral",
  });
  const result = await withTempJson(plan, (path) =>
    spawnSync(process.execPath, [CLI, "lint", "--record", path], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  );
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /disjunctive-acceptance-signal/);
});

test("a genuine deferral is a blocked task with a positive signal, never a close", () => {
  const deferred = planWithTask({ planId: "genuine-deferral", status: "blocked" });
  assert.deepEqual(lintPlanAcceptanceSignals(deferred), []);
  const receipt = createEvaluatorReceipt(deferred);
  assert.equal(receipt.verdict, "blocked");
  const error = captureThrow(() => closePlan(deferred, { receipt }));
  assert.equal(error.code, "evaluator-not-passing");
});

test("creating a successor closes the predecessor via typed supersession", () => {
  const predecessor = planWithTask({
    planId: "predecessor-plan",
    status: "pending",
    schemaRevision: 2,
  });
  const successor = createPlanArtifact({ planId: "successor-plan", schemaRevision: 2 });
  const closed = closePredecessorOnSuccessor(predecessor, {
    successor,
    reason: "successor plan created",
  });
  assert.equal(closed.status, "superseded");
  assert.equal(closed.control.currentState, "STOP");
  assert.equal(closed.control.nextTransition, "none; closed as superseded");
  assert.equal(closed.supersession.supersededBy.artifactId, successor.artifactId);
  assert.equal(closed.supersession.supersededBy.runId, successor.runId);
  assert.equal(closed.supersession.supersededBy.schema, successor.schema);
  assert.equal(closed.supersession.reason, "successor plan created");
  // Pending tasks are preserved: supersession is terminal by successor, not by
  // task completion (T003 depends on this).
  assert.equal(closed.tasks[0].status, "pending");
  assert.deepEqual(validatePlanArtifact(closed), { valid: true, errors: [] });
});

test("supersession requires a /2 predecessor and a successor pointer", () => {
  const v1 = planWithTask({ planId: "v1-predecessor", status: "pending" });
  const successor = createPlanArtifact({ planId: "successor-for-v1", schemaRevision: 2 });
  assert.throws(() => supersedePlanArtifact(v1, { successor, reason: "nope" }), {
    code: "unknown-revision",
  });
  const v2 = planWithTask({ planId: "v2-predecessor", status: "pending", schemaRevision: 2 });
  assert.throws(() => supersedePlanArtifact(v2, { reason: "missing successor" }), {
    code: "invalid-supersession",
  });
});

test("outstandingWork is status-only and treats blocked as work", () => {
  assert.equal(
    outstandingWork(planWithTask({ planId: "ow-pending", status: "pending" })).done,
    false,
  );
  assert.equal(
    outstandingWork(planWithTask({ planId: "ow-blocked", status: "blocked" })).done,
    false,
  );
  assert.equal(
    outstandingWork(planWithTask({ planId: "ow-done", status: "completed" })).done,
    true,
  );
});

test("loop guard requires a terminal lifecycle status", () => {
  const readyButDone = planWithTask({ planId: "guard-ready", status: "completed" });
  assert.equal(loopGuard(readyButDone).done, false);
  assert.equal(loopGuard(readyButDone).lifecycleOpen, true);
  const closed = closePlan(readyButDone, { receipt: passingReceipt(readyButDone) });
  assert.equal(loopGuard(closed).done, true);
});

test("the deterministic loop guard CLI exits 2 while work remains, 0 when done, 1 when unreadable", async () => {
  const pending = planWithTask({ planId: "cli-pending", status: "pending" });
  const pendingResult = await runGuard(pending);
  assert.equal(pendingResult.status, 2, pendingResult.stderr);
  assert.match(pendingResult.stderr, /loop-guard: work remains/);

  const readyButDone = planWithTask({ planId: "cli-ready", status: "completed" });
  const closed = closePlan(readyButDone, { receipt: passingReceipt(readyButDone) });
  const doneResult = await runGuard(closed);
  assert.equal(doneResult.status, 0, doneResult.stderr);

  const malformed = await runGuard("{ not json");
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Unexpected token|JSON/);
});

test("the guard fails closed on an empty or unrecognized record", async () => {
  assert.equal(outstandingWork({}).done, false);
  assert.equal(loopGuard({}).done, false);
  assert.equal(loopGuard({ schema: "csm-plan/2" }).done, false);

  const empty = await runGuard({});
  assert.equal(empty.status, 2, empty.stderr);
  assert.match(empty.stderr, /loop-guard: work remains/);
});

test("closePlan refuses a fabricated or tampered evaluator receipt", () => {
  const done = planWithTask({ planId: "forged-receipt", status: "completed" });
  const fabricated = {
    format: EVALUATOR_RECEIPT_FORMAT,
    verdict: "complete",
    evidence: "looks legitimate",
  };
  const fabricatedError = captureThrow(() => closePlan(done, { receipt: fabricated }));
  assert.equal(fabricatedError.code, "invalid-evaluator-receipt");

  const valid = passingReceipt(done);
  const tampered = { ...valid, evidence: "tampered after signing" };
  const tamperedError = captureThrow(() => closePlan(done, { receipt: tampered }));
  assert.equal(tamperedError.code, "invalid-evaluator-receipt");

  assert.equal(closePlan(done, { receipt: valid }).status, "complete");
});
