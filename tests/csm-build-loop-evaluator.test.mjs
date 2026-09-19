// T005/P3: csm-build in-loop completion enforcement. Proves three things at the
// loop boundary, never in CI:
//   1. the deterministic loop guard exits non-zero while work remains, so
//      completion cannot depend on model obedience;
//   2. a /2 build cannot reach COMPLETE while tasks remain, and requires a
//      binding `complete` evaluator verdict receipt;
//   3. resolveBuildInputs requires plan/bdd/tests but treats ddd/norms as
//      optional, and current-context cannot auto-walk to COMPLETE around the
//      gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { digest } from "../lib/schema-runtime/index.mjs";
import {
  BUILD_SCHEMA_V2,
  EVALUATOR_CONTRACT,
  completeBuild,
  createBuildState,
  createEvaluatorReceipt,
  isEvaluatorReceipt,
  recordEvaluatorReceipt,
  resolveBuildInputs,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";
import { EVALUATOR_VERDICTS, evaluateLoopGuard } from "../csm-build/lib/loop-guard.mjs";
import { createCsmBuildCurrentContextCaller } from "../csm-build/lib/current-context.mjs";
import { replayFixtures, writeBuildFixtures } from "./fixtures/json-migration/replay-fixtures.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOOP_GUARD = join(ROOT, "csm-build", "lib", "loop-guard.mjs");
const SOURCE_PLAN = { artifactId: "art-plan", digest: `sha256:${"a".repeat(64)}` };

async function withTempDir(fn) {
  const base = await mkdtemp(join(tmpdir(), "csm-build-loop-eval-"));
  try {
    return await fn(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function checkpointV2(overrides = {}) {
  let value = createBuildState({
    runId: "run-build-loop",
    artifactId: "art-build-loop",
    sourcePlan: SOURCE_PLAN,
    schemaRevision: 2,
    ...overrides,
  });
  value = transitionBuildState(value, "VALIDATE", { evidence: "validated" });
  value = transitionBuildState(value, "SELECT", { evidence: "selected" });
  return transitionBuildState(value, "CHECKPOINT", { evidence: "checkpoint" });
}

function runGuard(record, plan) {
  return withTempDir(async (dir) => {
    const recordPath = join(dir, "record.json");
    await writeFile(recordPath, JSON.stringify(record));
    const args = [LOOP_GUARD, "--record", recordPath];
    if (plan) {
      const planPath = join(dir, "plan.json");
      await writeFile(planPath, JSON.stringify(plan));
      args.push("--plan", planPath);
    }
    return spawnSync(process.execPath, args, { encoding: "utf8" });
  });
}

// ── 1. deterministic guard ───────────────────────────────────────────────────

test("loop guard exits 2 while any task, active task, or non-terminal lifecycle remains", async () => {
  const pending = await runGuard(
    { schema: BUILD_SCHEMA_V2, status: "in_progress", control: { activeTasks: [] } },
    { schema: "csm-plan/2", status: "ready", tasks: [{ taskId: "T001", status: "pending" }] },
  );
  assert.equal(pending.status, 2, pending.stderr);
  assert.match(pending.stderr, /loop-guard: work remains/);

  const active = await runGuard({
    schema: BUILD_SCHEMA_V2,
    status: "in_progress",
    control: { activeTasks: ["T003"] },
  });
  assert.equal(active.status, 2, active.stderr);

  const blocked = await runGuard({
    schema: BUILD_SCHEMA_V2,
    status: "blocked",
    control: { activeTasks: [] },
  });
  assert.equal(blocked.status, 2, blocked.stderr);
});

test("loop guard exits 0 only when every task is terminal and the lifecycle is complete", async () => {
  const done = await runGuard(
    {
      schema: BUILD_SCHEMA_V2,
      status: "complete",
      control: { activeTasks: [] },
      completion: { status: "complete" },
    },
    {
      schema: "csm-plan/2",
      status: "complete",
      tasks: [
        { taskId: "T001", status: "completed" },
        { taskId: "T002", status: "superseded" },
      ],
    },
  );
  assert.equal(done.status, 0, done.stderr);
});

test("loop guard fails closed when the durable record is missing or malformed", async () => {
  const missing = await withTempDir((dir) =>
    spawnSync(process.execPath, [LOOP_GUARD, "--record", join(dir, "absent.json")], {
      encoding: "utf8",
    }),
  );
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /unreadable record/);

  const malformed = await withTempDir(async (dir) => {
    const recordPath = join(dir, "malformed.json");
    await writeFile(recordPath, "{ not json");
    return spawnSync(process.execPath, [LOOP_GUARD, "--record", recordPath], { encoding: "utf8" });
  });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /unreadable record/);
});

test("loop guard fails closed on an empty or unrecognized record", async () => {
  assert.equal(evaluateLoopGuard({}).exitCode, 2);
  assert.equal(evaluateLoopGuard({}).status, "continue");
  assert.equal(evaluateLoopGuard({ foo: "bar" }).exitCode, 2);
  assert.ok(
    evaluateLoopGuard({}).remaining.some((reason) => reason.includes("unrecognized")),
    "an unrecognized record must be reported as remaining work",
  );

  const empty = await runGuard({});
  assert.equal(empty.status, 2, empty.stderr);
  assert.match(empty.stderr, /loop-guard: work remains/);

  const unrecognized = await runGuard({ foo: "bar" });
  assert.equal(unrecognized.status, 2, unrecognized.stderr);
});

test("loop guard CLI requires --plan for a csm-build-state record", async () => {
  const result = await runGuard({
    schema: BUILD_SCHEMA_V2,
    status: "complete",
    control: { activeTasks: [] },
    completion: { status: "complete" },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /--plan is required/);
});

// ── 2. binding evaluator verdict receipt ─────────────────────────────────────

test("evaluator contract is the frozen binding surface", () => {
  assert.equal(EVALUATOR_CONTRACT.format, "csm-evaluator-contract/1");
  assert.deepEqual(EVALUATOR_CONTRACT.outputs, ["continue", "complete", "blocked"]);
  assert.equal(EVALUATOR_CONTRACT.receipt, "journaled");
  assert.deepEqual(EVALUATOR_VERDICTS, ["continue", "complete", "blocked"]);
  assert.equal(Object.isFrozen(EVALUATOR_CONTRACT), true);
  assert.throws(
    () => createEvaluatorReceipt({ verdict: "maybe", evidence: "x", runId: "run-x" }),
    (error) => error.code === "invalid-verdict",
  );
  assert.throws(
    () => createEvaluatorReceipt({ verdict: "complete", evidence: "", runId: "run-x" }),
    (error) => error.code === "missing-evidence",
  );
});

test("a /2 build cannot COMPLETE with pending tasks, active tasks, or no complete verdict", () => {
  const checkpoint = checkpointV2();
  const receipt = createEvaluatorReceipt({
    verdict: "complete",
    evidence: "all acceptance checks pass",
    runId: checkpoint.runId,
    cycle: 1,
  });
  const withReceipt = recordEvaluatorReceipt(checkpoint, receipt);

  assert.throws(
    () => completeBuild(withReceipt, { tasks: [{ taskId: "T001", status: "pending" }] }),
    (error) => error.code === "loop-guard",
  );
  assert.throws(
    () =>
      completeBuild({ ...withReceipt, control: { ...withReceipt.control, activeTasks: ["T002"] } }),
    (error) => error.code === "loop-guard",
  );
  assert.throws(
    () => completeBuild(checkpoint),
    (error) => error.code === "evaluator-verdict-required",
  );
  assert.throws(
    () =>
      completeBuild(
        recordEvaluatorReceipt(
          checkpoint,
          createEvaluatorReceipt({
            verdict: "continue",
            evidence: "work remains",
            runId: checkpoint.runId,
          }),
        ),
      ),
    (error) => error.code === "evaluator-verdict-required" && error.verdict === "continue",
  );
});

test("a complete verdict receipt is journaled and revalidates in the completed /2 state", () => {
  const checkpoint = checkpointV2();
  const receipt = createEvaluatorReceipt({
    verdict: "complete",
    evidence: "every task verified against its acceptance signal",
    runId: checkpoint.runId,
    cycle: 2,
    inputDigests: [SOURCE_PLAN.digest],
  });
  const completed = completeBuild(recordEvaluatorReceipt(checkpoint, receipt), {
    tasks: [
      { taskId: "T001", status: "completed" },
      { taskId: "T002", status: "completed" },
    ],
  });
  assert.equal(completed.control.currentState, "COMPLETE");
  const target = completed.completion.evidence.find((descriptor) =>
    descriptor.kind.startsWith("evaluator-verdict/"),
  );
  assert.ok(target, "evaluator verdict receipt must be journaled in completion evidence");
  assert.equal(target.kind, "evaluator-verdict/complete");
  assert.equal(isEvaluatorReceipt(target), true);
  assert.deepEqual(validateBuildState(completed), { valid: true, errors: [] });

  const tampered = structuredClone(completed);
  tampered.completion.evidence.find((descriptor) =>
    descriptor.kind.startsWith("evaluator-verdict/"),
  ).kind = "evaluator-verdict/continue";
  assert.equal(validateBuildState(tampered).valid, false);
});

// ── 3. input gate: ddd/norms optional ────────────────────────────────────────

test("resolveBuildInputs requires plan/bdd/tests but treats ddd/norms as optional", async () => {
  const { payloads, verification } = await replayFixtures();
  const root = await mkdtemp(join(tmpdir(), "csm-build-inputs-"));
  try {
    await writeBuildFixtures(root, payloads, verification);
    const options = { root, expectedPlanDigest: digest(payloads.plan) };

    const full = await resolveBuildInputs(
      {
        plan: payloads.plan,
        bdd: payloads.bdd,
        tests: payloads.tests,
        ddd: payloads.ddd,
        norms: payloads.norms,
      },
      options,
    );
    assert.equal(full.status, "resolved");
    assert.deepEqual(
      full.inputs.map((input) => input.name),
      ["plan", "bdd", "tests", "ddd", "norms"],
    );

    const optional = await resolveBuildInputs(
      { plan: payloads.plan, bdd: payloads.bdd, tests: payloads.tests },
      options,
    );
    assert.equal(optional.status, "resolved");
    assert.deepEqual(
      optional.inputs.map((input) => input.name),
      ["plan", "bdd", "tests"],
    );

    const missingPlan = await resolveBuildInputs(
      { bdd: payloads.bdd, tests: payloads.tests },
      options,
    );
    assert.equal(missingPlan.status, "rejected");
    assert.equal(missingPlan.input, "plan");

    const untypedDdd = await resolveBuildInputs(
      { plan: payloads.plan, bdd: payloads.bdd, tests: payloads.tests, ddd: { artifactId: "ddd" } },
      options,
    );
    assert.equal(untypedDdd.status, "rejected");
    assert.equal(untypedDdd.input, "ddd");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 4. current-context cannot auto-walk to COMPLETE ──────────────────────────

function resolvedPlan(plan) {
  const planDigest = digest(plan);
  return {
    status: "resolved",
    inputs: [
      {
        name: "plan",
        artifactId: plan.artifactId ?? "art-plan",
        schema: plan.schema ?? "csm-plan/1",
        runId: plan.runId ?? "run-plan",
        owner: "csm-plan",
        digest: planDigest,
        path: "plan.json",
        status: "resolved",
      },
    ],
    values: { plan: { status: "resolved", value: plan, digest: planDigest, path: "plan.json" } },
  };
}

function buildRequest(plan) {
  return {
    invocationId: "invocation-loop-eval",
    parentRunId: "run-loop-parent",
    childRunId: "run-loop-child",
    phaseId: "phase-loop-eval",
    edgeId: "edge-loop-eval",
    skill: "csm-plan",
    input: { plan },
    retry: { attempt: 1 },
  };
}

function completedDelivery() {
  return {
    output: { verified: true },
    effects: ["workspace-write"],
    artifacts: [],
    evidence: [],
  };
}

test("current-context refuses COMPLETE while the source plan has pending tasks", async () => {
  const plan = {
    schema: "csm-plan/1",
    artifactId: "art-plan-loop",
    runId: "run-plan-loop",
    digest: digest({ plan: "loop" }),
    tasks: [{ taskId: "T001", status: "pending" }],
  };
  const caller = createCsmBuildCurrentContextCaller({
    resolveInputs: async () => resolvedPlan(plan),
    execute: async () => completedDelivery(),
  });
  const result = await caller.execute(buildRequest(plan));
  assert.equal(result.status, "blocked");
  assert.equal(result.failure.code, "incomplete-work");
  assert.notEqual(result.state.control.currentState, "COMPLETE");
  assert.equal(result.state.control.currentState, "CHECKPOINT");
  assert.match(result.failure.message, /cannot reach COMPLETE/);
});

test("current-context reaches COMPLETE only after the deterministic gate passes", async () => {
  const plan = {
    schema: "csm-plan/1",
    artifactId: "art-plan-loop",
    runId: "run-plan-loop",
    digest: digest({ plan: "done" }),
    tasks: [{ taskId: "T001", status: "completed" }],
  };
  const caller = createCsmBuildCurrentContextCaller({
    resolveInputs: async () => resolvedPlan(plan),
    execute: async () => completedDelivery(),
  });
  const result = await caller.execute(buildRequest(plan));
  assert.equal(result.status, "completed");
  assert.equal(result.state.control.currentState, "COMPLETE");
});
