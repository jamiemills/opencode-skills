// T006: the loop CLIs (csm-build/csm-plan/csm-review) append best-effort trace
// entries for a guard evaluation and record the verdict as a `kind:decision`
// line, without changing the guard's exit code. Each case runs the real CLI
// against a temp git repo with an absolute CSM_TRACE_LOG override.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "csm-loop-trace-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    return await fn({ dir, traceFile: join(dir, "trace.jsonl") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(relativePath, args, { dir, traceFile }, env = {}) {
  const base = { ...process.env, ...env };
  if (traceFile !== null) base.CSM_TRACE_LOG = traceFile;
  else delete base.CSM_TRACE_LOG;
  base.CSM_RUN_ID = "run-loop-trace";
  return spawnSync(process.execPath, [join(ROOT, relativePath), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: base,
  });
}

function readRecords(traceFile) {
  let raw;
  try {
    raw = readFileSync(traceFile, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function writeJson(dir, name, value) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

// ── csm-build ────────────────────────────────────────────────────────────────

test("csm-build loop-guard traces one action + one decision without changing its exit code", async () => {
  await withTempRepo(async ({ dir, traceFile }) => {
    const pendingRecord = writeJson(dir, "pending.json", {
      status: "in_progress",
      tasks: [{ taskId: "T001", status: "pending" }],
    });
    const completeRecord = writeJson(dir, "complete.json", {
      status: "complete",
      tasks: [{ taskId: "T001", status: "completed" }],
    });

    const pending = runCli("csm-build/lib/loop-guard.mjs", ["--record", pendingRecord], {
      dir,
      traceFile,
    });
    const complete = runCli("csm-build/lib/loop-guard.mjs", ["--record", completeRecord], {
      dir,
      traceFile,
    });
    assert.equal(pending.status, 2, pending.stderr);
    assert.equal(complete.status, 0, complete.stderr);

    const baseline = runCli("csm-build/lib/loop-guard.mjs", ["--record", pendingRecord], {
      dir,
      traceFile: null,
    });
    assert.equal(baseline.status, pending.status, "tracing must not change the guard exit code");

    const records = readRecords(traceFile);
    const actions = records.filter(
      (record) =>
        record.kind === "action" && record.actor === "csm-build" && record.action === "loop-guard",
    );
    const decisions = records.filter(
      (record) => record.kind === "decision" && record.actor === "csm-build",
    );
    assert.equal(actions.length, 2, JSON.stringify(records));
    assert.equal(decisions.length, 2, JSON.stringify(records));
    assert.ok(decisions.every((record) => record.action === "loop-guard-decision"));
    assert.deepEqual(actions.map((record) => record.outcome).toSorted(), ["complete", "continue"]);
  });
});

// ── csm-plan ─────────────────────────────────────────────────────────────────

test("csm-plan loop-evaluator traces guard and evaluator decisions with exit codes unchanged", async () => {
  await withTempRepo(async ({ dir, traceFile }) => {
    const pendingPlan = writeJson(dir, "plan.json", {
      status: "ready",
      tasks: [{ taskId: "T001", status: "pending", acceptanceSignal: "node --test exits 0" }],
      acceptanceCriteria: [],
    });

    const guard = runCli("csm-plan/lib/loop-evaluator.mjs", ["guard", "--record", pendingPlan], {
      dir,
      traceFile,
    });
    const evaluate = runCli(
      "csm-plan/lib/loop-evaluator.mjs",
      ["evaluate", "--record", pendingPlan],
      { dir, traceFile },
    );
    assert.equal(guard.status, 2, guard.stderr);
    assert.equal(evaluate.status, 0, evaluate.stderr);
    assert.equal(JSON.parse(evaluate.stdout).verdict, "continue");

    const records = readRecords(traceFile);
    const guardActions = records.filter(
      (record) => record.actor === "csm-plan" && record.action === "loop-guard",
    );
    const guardDecisions = records.filter(
      (record) =>
        record.kind === "decision" &&
        record.actor === "csm-plan" &&
        record.action === "loop-guard-decision",
    );
    const evaluatorDecisions = records.filter(
      (record) =>
        record.kind === "decision" &&
        record.actor === "csm-plan" &&
        record.action === "evaluator-verdict-decision",
    );
    assert.equal(guardActions.length, 1, JSON.stringify(records));
    assert.equal(guardActions[0].kind, "action");
    assert.equal(guardActions[0].outcome, "continue");
    assert.equal(guardDecisions.length, 1, JSON.stringify(records));
    assert.equal(guardDecisions[0].outcome, "continue");
    assert.equal(evaluatorDecisions.length, 1, JSON.stringify(records));
    assert.equal(evaluatorDecisions[0].outcome, "continue");
  });
});

// ── csm-review ───────────────────────────────────────────────────────────────

test("csm-review loop-closure traces one action + one decision without changing its exit code", async () => {
  await withTempRepo(async ({ dir, traceFile }) => {
    const unresolved = writeJson(dir, "unresolved.json", {
      schema: "csm-review-findings/2",
      control: { status: "in_progress" },
      findings: [{ id: "F-001" }],
      verificationStatus: { status: "INCOMPLETE", unresolved: [] },
    });
    const clean = writeJson(dir, "clean.json", {
      schema: "csm-review-findings/2",
      findings: [{ id: "F-001", closure: { status: "closed", disposition: "remediated" } }],
      verificationStatus: { status: "VERIFIED", unresolved: [] },
    });

    const open = runCli("csm-review/lib/loop-closure.mjs", ["--record", unresolved], {
      dir,
      traceFile,
    });
    const done = runCli("csm-review/lib/loop-closure.mjs", ["--record", clean], {
      dir,
      traceFile,
    });
    assert.equal(open.status, 2, open.stderr);
    assert.equal(done.status, 0, done.stderr);

    const records = readRecords(traceFile);
    const actions = records.filter(
      (record) =>
        record.kind === "action" && record.actor === "csm-review" && record.action === "loop-guard",
    );
    const decisions = records.filter(
      (record) =>
        record.kind === "decision" &&
        record.actor === "csm-review" &&
        record.action === "loop-guard-decision",
    );
    assert.equal(actions.length, 2, JSON.stringify(records));
    assert.equal(decisions.length, 2, JSON.stringify(records));
    assert.deepEqual(decisions.map((record) => record.outcome).toSorted(), [
      "complete",
      "continue",
    ]);
  });
});
