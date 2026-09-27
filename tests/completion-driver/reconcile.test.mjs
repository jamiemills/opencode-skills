import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSignalCommand,
  reconcilePlan,
  splitCommand,
} from "../../scripts/completion/reconcile.mjs";

test("parseSignalCommand extracts the backticked command", () => {
  assert.equal(
    parseSignalCommand("`node --test tests/x.test.mjs` exits 0."),
    "node --test tests/x.test.mjs",
  );
});

test("reconcilePlan marks complete only when the signal exits 0", () => {
  const plan = {
    planId: "demo",
    tasks: [
      { taskId: "T001", title: "a", acceptanceSignal: "`cmd-a` exits 0." },
      { taskId: "T002", title: "b", acceptanceSignal: "`cmd-b` exits 0." },
      { taskId: "T003", title: "c", acceptanceSignal: "`cmd-c` exits 0." },
    ],
  };
  const results = { "cmd-a": { ok: true, code: 0 }, "cmd-b": { ok: false, code: 1 } };
  const ledger = reconcilePlan({
    plan,
    runSignal: (command) => results[command] ?? { ok: false, code: null },
    sampledAt: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(ledger.total, 3);
  assert.equal(ledger.complete, 1);
  assert.equal(ledger.pending, 2);
  assert.deepEqual(
    ledger.tasks.map((task) => task.status),
    ["complete", "pending", "pending"],
  );
  assert.equal(ledger.tasks[0].exitCode, 0);
});

test("splitCommand parses argv without a shell and rejects metacharacters", () => {
  assert.deepEqual(splitCommand("node --test a.test.mjs").args, ["--test", "a.test.mjs"]);
  assert.equal(splitCommand("CSM_X=1 node --test a").env.CSM_X, "1");
  assert.throws(() => splitCommand("node --test a; rm -rf /"), /unsafe/);
});

test("a passing signal whose dependencies are incomplete is blocked-deps", () => {
  const plan = {
    planId: "dep",
    tasks: [
      { taskId: "T001", ordinal: 1, acceptanceSignal: "`cmd-a` exits 0.", dependsOn: [] },
      { taskId: "T002", ordinal: 2, acceptanceSignal: "`cmd-b` exits 0.", dependsOn: ["T001"] },
    ],
  };
  const ledger = reconcilePlan({
    plan,
    runSignal: (command) => (command === "cmd-b" ? { ok: true, code: 0 } : { ok: false, code: 1 }),
    sampledAt: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(ledger.tasks[0].status, "pending");
  assert.equal(ledger.tasks[1].status, "blocked-deps");
});

test("a skipped test is partial, not complete", () => {
  const plan = {
    planId: "skip",
    tasks: [{ taskId: "T001", ordinal: 1, acceptanceSignal: "`cmd-a` exits 0.", dependsOn: [] }],
  };
  const ledger = reconcilePlan({ plan, runSignal: () => ({ ok: true, code: 0, skipped: true }) });
  assert.equal(ledger.tasks[0].status, "partial");
});
