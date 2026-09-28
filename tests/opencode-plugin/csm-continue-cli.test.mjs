// T003 (PART A): runner CLI contract. Invoking scripts/csm-continue.mjs against
// a fixture build-state + plan prints a decision JSON and exits 0.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_PLAN, DEFAULT_RECORD } from "../../scripts/csm-continue.mjs";

const cliPath = path.join(import.meta.dirname, "..", "..", "scripts", "csm-continue.mjs");

function writeFixture(dir, { status = "in_progress", taskStatus = "pending" } = {}) {
  const recordPath = path.join(dir, "build-state.json");
  const planPath = path.join(dir, "plan.json");
  writeFileSync(
    recordPath,
    JSON.stringify({
      schema: "csm-build-state/1",
      status,
      control: { activeTasks: [] },
      tasks: [{ taskId: "T001", status: taskStatus }],
    }),
  );
  writeFileSync(
    planPath,
    JSON.stringify({
      schema: "csm-plan/2",
      status,
      tasks: [{ taskId: "T001", status: taskStatus }],
    }),
  );
  return { recordPath, planPath };
}

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("defaults point at this plan's durable record and plan", () => {
  assert.match(DEFAULT_RECORD, /2026-09-28-completion-supervisor-contract-build\.json$/);
  assert.match(DEFAULT_PLAN, /2026-09-28-completion-supervisor-contract-csm\.json$/);
});

test("prints a continue decision carrying the run paths and exits 0", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-continue-cli-"));
  try {
    const { recordPath, planPath } = writeFixture(dir);
    const result = runCli("--record", recordPath, "--plan", planPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.action, "continue");
    assert.equal(decision.reason, "work-remaining");
    assert.match(decision.command, /loop-guard\.mjs/);
    assert.ok(decision.command.includes(recordPath));
    assert.ok(decision.command.includes(planPath));
    assert.deepEqual(Object.keys(decision), ["action", "reason", "command"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prints a stop/no-work-remaining decision for a terminal run", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-continue-cli-done-"));
  try {
    const { recordPath, planPath } = writeFixture(dir, {
      status: "complete",
      taskStatus: "completed",
    });
    const result = runCli("--record", recordPath, "--plan", planPath);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      action: "stop",
      reason: "no-work-remaining",
      command: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
