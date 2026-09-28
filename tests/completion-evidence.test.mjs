// T005/C: completion-evidence predicate over a single csm-plan record.
//
// Proves the acceptance signal for the evidence gate:
//   - a live, evidenced plan (advanced cursor + receipts + review) is ok;
//   - a bulk close-out with an unadvanced cursor fails;
//   - a completed task without a receipt fails;
//   - a complete plan with a null completionReview fails;
//   - the CLI fails closed on unreadable input.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateCompletionEvidence } from "../scripts/lib/completion-evidence.mjs";

const cliPath = path.join(import.meta.dirname, "..", "scripts/lib/completion-evidence.mjs");

function receipt(command = "node --test tests/x.test.mjs") {
  return { command, exitCode: 0, digest: "sha256:abc", recordedAt: "2026-09-28T00:00:00.000Z" };
}

function livePlan() {
  return {
    schema: "csm-plan/2",
    status: "complete",
    control: { cycle: 2, lastCheckpoint: "CHECKPOINT" },
    completionReview: { reviewer: "evaluator", verdict: "complete" },
    tasks: [
      { taskId: "T001", status: "completed", executionReceipt: receipt() },
      {
        taskId: "T002",
        status: "completed",
        executionReceipt: receipt("node --test tests/y.test.mjs"),
      },
    ],
  };
}

test("a live, evidenced plan is ok", () => {
  const result = evaluateCompletionEvidence(livePlan());
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("a bulk close-out with an unadvanced cursor fails", () => {
  const plan = livePlan();
  plan.status = "in_progress";
  plan.control = { cycle: 0, lastCheckpoint: "none" };
  const result = evaluateCompletionEvidence(plan);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === "bulk-completion"));
});

test("a completed task without a receipt fails once, deduped", () => {
  const plan = livePlan();
  plan.tasks[1].executionReceipt = undefined;
  const result = evaluateCompletionEvidence(plan);
  assert.equal(result.ok, false);
  const missing = result.violations.filter(
    (violation) => violation.code === "completed-task-missing-receipt",
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].taskId, "T002");
});

test("a complete plan with a null completionReview fails", () => {
  const plan = livePlan();
  plan.completionReview = null;
  const result = evaluateCompletionEvidence(plan);
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some(
      (violation) => violation.code === "complete-with-null-completion-review",
    ),
  );
});

test("a complete plan with an advanced cursor and review does not trip cursor violations", () => {
  const result = evaluateCompletionEvidence(livePlan());
  assert.equal(
    result.violations.some((violation) => violation.code === "complete-with-unadvanced-cursor"),
    false,
  );
});

test("undefined tasks are treated as an empty list", () => {
  const result = evaluateCompletionEvidence({ status: "in_progress", control: { cycle: 1 } });
  assert.equal(result.ok, true);
});

test("the CLI exits 0 for an ok record and 2 for violations", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-completion-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const okPath = path.join(dir, "ok.json");
  writeFileSync(okPath, JSON.stringify(livePlan()));
  const okRun = spawnSync(process.execPath, [cliPath, "--record", okPath], { encoding: "utf8" });
  assert.equal(okRun.status, 0);
  assert.equal(JSON.parse(okRun.stdout).ok, true);

  const badPath = path.join(dir, "bad.json");
  const bad = livePlan();
  bad.tasks[0].executionReceipt = undefined;
  writeFileSync(badPath, JSON.stringify(bad));
  const badRun = spawnSync(process.execPath, [cliPath, "--record", badPath], { encoding: "utf8" });
  assert.equal(badRun.status, 2);
  assert.equal(JSON.parse(badRun.stdout).ok, false);
});

test("the CLI fails closed on unreadable or malformed input", () => {
  const missing = spawnSync(
    process.execPath,
    [cliPath, "--record", path.join(os.tmpdir(), "does-not-exist-csm.json")],
    { encoding: "utf8" },
  );
  assert.notEqual(missing.status, 0);

  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-completion-evidence-"));
  try {
    const malformed = path.join(dir, "malformed.json");
    writeFileSync(malformed, "{ not json");
    const result = spawnSync(process.execPath, [cliPath, "--record", malformed], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
