"use strict";

// T001: decision-table tests for the pure continuation core. No filesystem,
// network, or clock access is required -- every case is a pure function call.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decideContinuation,
  evaluateReadiness,
  recordDigest,
} from "../../scripts/opencode-plugin/csm-continue-core.mjs";
import { evaluateLoopGuard } from "../../csm-build/lib/loop-guard.mjs";

const RECORD = Object.freeze({ schema: "csm-build-state/1", status: "in_progress", tasks: [] });
const GUARD_CONTINUE = Object.freeze({ exitCode: 2, remaining: ["tasks:T001"] });
const GUARD_DONE = Object.freeze({ exitCode: 0, remaining: [] });
const BASE = Object.freeze({ record: RECORD, guard: GUARD_CONTINUE, budget: {}, env: {} });

test("continue on guard exit 2", () => {
  const decision = decideContinuation(BASE);
  assert.equal(decision.action, "continue");
  assert.equal(decision.reason, "work-remaining");
  assert.equal(
    decision.command,
    "node csm-build/lib/loop-guard.mjs --record <record-path> --plan <plan-path>",
  );
});

test("resume command uses supplied record/plan paths", () => {
  const decision = decideContinuation({
    ...BASE,
    record: { ...RECORD, recordPath: ".agents/build/state.json", planPath: ".agents/plans/p.json" },
  });
  assert.equal(
    decision.command,
    "node csm-build/lib/loop-guard.mjs --record .agents/build/state.json --plan .agents/plans/p.json",
  );
});

test("stop on guard exit 0", () => {
  assert.deepEqual(decideContinuation({ ...BASE, guard: GUARD_DONE }), {
    action: "stop",
    reason: "no-work-remaining",
    command: null,
  });
});

test("pause on blocked", () => {
  const decision = decideContinuation({
    ...BASE,
    record: { ...RECORD, status: "blocked" },
  });
  assert.deepEqual(decision, { action: "pause", reason: "blocked-or-paused", command: null });
});

test("pause on paused", () => {
  const decision = decideContinuation({
    ...BASE,
    record: { ...RECORD, control: { status: "paused" } },
  });
  assert.deepEqual(decision, { action: "pause", reason: "blocked-or-paused", command: null });
});

test("stop on kill switch", () => {
  const decision = decideContinuation({ ...BASE, env: { CSM_CONTINUE_KILL: "1" } });
  assert.deepEqual(decision, { action: "stop", reason: "kill-switch", command: null });
});

test("stop on budget exhaustion", () => {
  const decision = decideContinuation({
    ...BASE,
    budget: { continues: 3, maxContinues: 3 },
  });
  assert.deepEqual(decision, { action: "stop", reason: "budget-exhausted", command: null });
});

test("stop on unchanged digest", () => {
  const digest = recordDigest(RECORD);
  const decision = decideContinuation({
    ...BASE,
    budget: { lastDigest: digest, digest },
  });
  assert.deepEqual(decision, { action: "stop", reason: "no-progress", command: null });
});

test("continue when digest advances", () => {
  const decision = decideContinuation({
    ...BASE,
    budget: { lastDigest: "sha256:previous", digest: recordDigest(RECORD) },
  });
  assert.equal(decision.action, "continue");
});

test("CSM_CONTINUE_MODE off stops", () => {
  const decision = decideContinuation({ ...BASE, env: { CSM_CONTINUE_MODE: "off" } });
  assert.deepEqual(decision, { action: "stop", reason: "kill-switch", command: null });
});

test("recordDigest is stable across key order", () => {
  assert.equal(recordDigest({ b: 2, a: 1 }), recordDigest({ a: 1, b: 2 }));
});

// The pure readiness check the installed wrapper uses in place of the
// repository loop guard: status-only, no I/O, same exit-code contract.
test("readiness is 2 while a task is pending", () => {
  const result = evaluateReadiness({
    record: { schema: "csm-plan/2", status: "in_progress", tasks: [] },
    tasks: [{ taskId: "T001", status: "pending" }],
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.remaining.some((reason) => reason === "tasks:T001"));
});

test("readiness is 0 when every task is terminal", () => {
  const result = evaluateReadiness({
    record: { schema: "csm-plan/2", status: "completed", tasks: [] },
    tasks: [
      { taskId: "T001", status: "completed" },
      { taskId: "T002", status: "superseded" },
    ],
  });
  assert.deepEqual(result, { exitCode: 0, remaining: [] });
});

test("readiness is 2 while control.activeTasks is non-empty", () => {
  const result = evaluateReadiness({
    record: {
      schema: "csm-build-state/1",
      status: "in_progress",
      control: { status: "in_progress", activeTasks: ["T009"] },
      tasks: [{ taskId: "T001", status: "complete" }],
    },
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.remaining.includes("activeTasks:T009"));
});

test("readiness is 2 on a non-terminal lifecycle state", () => {
  const result = evaluateReadiness({
    record: { schema: "csm-plan/2", status: "blocked", tasks: [] },
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.remaining.includes("lifecycle:blocked"));
});

// T015 parity: the installed wrapper cannot import the repository loop guard, so
// the core re-implements the status-only semantics by value. This pins them
// against the authority: for every fixture, evaluateReadiness(...).exitCode must
// equal evaluateLoopGuard(...).exitCode. A drift between the two is a failure.
const PARITY_FIXTURES = [
  {
    name: "pending task",
    record: { control: { activeTasks: [] } },
    tasks: [{ taskId: "T1", status: "pending" }],
  },
  {
    name: "all tasks terminal",
    record: { control: { activeTasks: [] } },
    tasks: [{ taskId: "T1", status: "completed" }],
  },
  { name: "empty tasks", record: { control: { activeTasks: [] } }, tasks: [] },
  { name: "non-empty activeTasks", record: { control: { activeTasks: ["T1"] } }, tasks: [] },
  {
    name: "blocked lifecycle",
    record: { control: { activeTasks: [], status: "blocked" } },
    tasks: [],
  },
  {
    name: "in-progress lifecycle",
    record: { status: "in_progress", control: { activeTasks: [] } },
    tasks: [],
  },
  {
    name: "complete lifecycle",
    record: { completion: { status: "complete" }, control: { activeTasks: [] } },
    tasks: [],
  },
  {
    name: "record tasks pending",
    record: { tasks: [{ taskId: "T1", status: "pending" }], control: { activeTasks: [] } },
    tasks: [],
  },
];

test("evaluateReadiness matches evaluateLoopGuard exit codes across fixtures", () => {
  for (const fixture of PARITY_FIXTURES) {
    const readiness = evaluateReadiness({ record: fixture.record, tasks: fixture.tasks });
    const guard = evaluateLoopGuard(fixture.record, { tasks: fixture.tasks });
    assert.equal(
      readiness.exitCode,
      guard.exitCode,
      `exit-code drift for "${fixture.name}": readiness=${readiness.exitCode} guard=${guard.exitCode}`,
    );
  }
});
