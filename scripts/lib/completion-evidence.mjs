"use strict";

// T005: pure completion-evidence predicate over a single csm-plan record. It
// inspects one plan artifact and never reads build-state, so a "completed"
// task or a "complete" plan cannot be asserted without the durable evidence
// (per-task executionReceipt, advanced control cursor, completionReview) that
// the taxonomy requires.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A receipt is real evidence only when it is an object carrying the command
// that ran and the exit code it produced; digest/recordedAt are optional.
function isExecutionReceipt(value) {
  return isObject(value) && typeof value.command === "string" && typeof value.exitCode === "number";
}

// The cursor is unadvanced when no cycle has run or no checkpoint was recorded.
function cursorUnadvanced(control) {
  return control.cycle === 0 || !control.lastCheckpoint || control.lastCheckpoint === "none";
}

export function evaluateCompletionEvidence(plan) {
  const source = isObject(plan) ? plan : {};
  const control = isObject(source.control) ? source.control : {};
  const tasks = Array.isArray(source.tasks) ? source.tasks : [];
  const violations = [];
  const seen = new Set();

  const push = (code, detail, taskId, taskKey) => {
    const key = `${code}\u0000${taskKey ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(taskId === undefined ? { code, detail } : { code, taskId, detail });
  };

  tasks.forEach((task, index) => {
    if (!isObject(task) || task.status !== "completed") return;
    if (!isExecutionReceipt(task.executionReceipt)) {
      push(
        "completed-task-missing-receipt",
        `completed task ${task.taskId ?? "(unknown)"} has no valid executionReceipt`,
        task.taskId,
        task.taskId ?? index,
      );
    }
  });

  if (source.status === "complete" && cursorUnadvanced(control)) {
    push(
      "complete-with-unadvanced-cursor",
      'plan is complete but control.cycle is 0 or control.lastCheckpoint is falsy/"none"',
    );
  }

  if (source.status === "complete" && source.completionReview == null) {
    push("complete-with-null-completion-review", "plan is complete but completionReview is null");
  }

  const allCompleted =
    tasks.length > 0 && tasks.every((task) => isObject(task) && task.status === "completed");
  if (allCompleted && cursorUnadvanced(control)) {
    push(
      "bulk-completion",
      'every task is completed while control.cycle is 0 or control.lastCheckpoint is falsy/"none"',
    );
  }

  return { ok: violations.length === 0, violations };
}

export function runCompletionEvidenceCli({ argv = process.argv.slice(2) } = {}) {
  const index = argv.indexOf("--record");
  const recordPath = index >= 0 ? argv[index + 1] : undefined;
  if (!recordPath) throw new TypeError("usage: completion-evidence --record <plan.json>");
  const plan = JSON.parse(readFileSync(recordPath, "utf8"));
  return evaluateCompletionEvidence(plan);
}

function isDirectInvocation() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectInvocation()) {
  try {
    const result = runCompletionEvidenceCli({});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  }
}
