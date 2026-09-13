"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFECYCLE_HOOK_NAMES,
  createLifecycleHookRunner,
} from "../csm-orchestrate/lib/lifecycle-hooks.mjs";

test("lifecycle hooks fire in registration order at named points", () => {
  const order = [];
  const runner = createLifecycleHookRunner({
    "worker-start": [() => order.push("start-1"), () => order.push("start-2")],
    "worker-stop": [() => order.push("stop")],
    cancel: [() => order.push("cancel")],
  });
  runner.run("worker-start", { workerId: "worker-build-1" });
  runner.run("worker-stop", { workerId: "worker-build-1" });
  runner.run("cancel", { reason: "aborted" });
  assert.deepEqual(order, ["start-1", "start-2", "stop", "cancel"]);
  assert.deepEqual(
    runner.invocations().map((entry) => entry.name),
    ["worker-start", "worker-stop", "cancel"],
  );
});

test("hooks observe frozen context and cannot fail or reorder the run", () => {
  const runner = createLifecycleHookRunner({
    "task-complete": [
      (context) => {
        assert.throws(() => {
          context.state = "verified";
        }, TypeError);
        throw new Error("hook blew up");
      },
      (context) => assert.equal(context.taskId, "task-build-1"),
    ],
  });
  const result = runner.run("task-complete", { taskId: "task-build-1", state: "running" });
  assert.deepEqual(result, { name: "task-complete", ran: 1, errors: 1 });
});

test("unknown hook names fail closed and hook sets are enumerable", () => {
  assert.throws(() => createLifecycleHookRunner({ "mystery-hook": [] }), /unknown lifecycle hook/);
  assert.throws(() => createLifecycleHookRunner({ "worker-start": "nope" }), /must be an array/);
  assert.ok(LIFECYCLE_HOOK_NAMES.includes("checkpoint"));
  assert.equal(LIFECYCLE_HOOK_NAMES.length, 7);
});
