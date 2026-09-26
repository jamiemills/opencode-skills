"use strict";

// T004: the orchestrator's built-in trace lifecycle hook. Hooks are advisory and
// synchronous, so the trace handler must fire-and-forget and never throw; flush
// drains writes.

import assert from "node:assert/strict";
import test from "node:test";

import { LIFECYCLE_HOOK_NAMES } from "../../csm-orchestrate/lib/lifecycle-hooks.mjs";
import { createTraceLifecycleHooks } from "../../csm-orchestrate/lib/trace-hooks.mjs";
import { createLifecycleHookRunner } from "../../csm-orchestrate/lib/lifecycle-hooks.mjs";

test("definitions cover every lifecycle hook name", () => {
  const { definitions } = createTraceLifecycleHooks({ write: async () => {} });
  assert.deepEqual(Object.keys(definitions).toSorted(), [...LIFECYCLE_HOOK_NAMES].toSorted());
  for (const name of LIFECYCLE_HOOK_NAMES) assert.equal(definitions[name].length, 1);
});

test("a hook invocation appends an action trace and flush drains it", async () => {
  const written = [];
  const { definitions, flush } = createTraceLifecycleHooks({
    write: async (kind, entry) => {
      written.push({ kind, entry });
      return { file: "/tmp/x", entry };
    },
  });
  const runner = createLifecycleHookRunner(definitions);
  runner.run("task-complete", {
    runId: "run-1",
    taskId: "T001",
    skill: "csm-build",
    status: "complete",
  });
  await flush();
  assert.equal(written.length, 1);
  assert.equal(written[0].kind, "action");
  assert.equal(written[0].entry.runId, "run-1");
  assert.equal(written[0].entry.actor, "csm-build");
  assert.equal(written[0].entry.action, "task-complete");
  assert.equal(written[0].entry.target, "T001");
  assert.equal(written[0].entry.outcome, "complete");
});

test("a throwing writer never fails the run and flush still drains", async () => {
  const { definitions, flush } = createTraceLifecycleHooks({
    write: async () => {
      throw new Error("writer down");
    },
  });
  const runner = createLifecycleHookRunner(definitions);
  const result = runner.run("checkpoint", { runId: "run-2", taskId: "T002" });
  assert.equal(result.errors, 0, "the hook itself does not throw");
  await flush();
  assert.equal(runner.invocations().length, 1);
});

test("runId option is the fallback and emitted() counts scheduled writes", async () => {
  const written = [];
  const { definitions, flush, emitted } = createTraceLifecycleHooks({
    runId: "run-abc",
    write: async (kind, entry) => {
      written.push(entry);
    },
  });
  const runner = createLifecycleHookRunner(definitions);
  runner.run("task-create", { taskId: "T1" });
  await flush();
  assert.equal(written[0].runId, "run-abc", "configured runId is the fallback");
  assert.equal(emitted(), 1);
});

test("with no injected writer the hook is a no-op and never throws", async () => {
  const { definitions, flush } = createTraceLifecycleHooks();
  const runner = createLifecycleHookRunner(definitions);
  assert.doesNotThrow(() => runner.run("worker-start", { runId: "run-3", skill: "csm-review" }));
  await flush();
  assert.equal(runner.invocations().length, 1);
});
