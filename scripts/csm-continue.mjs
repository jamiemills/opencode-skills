#!/usr/bin/env node
"use strict";

// T003 (PART A): runner CLI for the opencode continuation supervisor. It reads
// the active run's durable build-state and source plan, runs the deterministic
// loop guard, and prints the pure continuation decision as JSON. It is
// import-safe (the direct-invocation guard prevents execution on import) and
// performs no writes.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { evaluateLoopGuard } from "../csm-build/lib/loop-guard.mjs";
import { decideContinuation } from "./opencode-plugin/csm-continue-core.mjs";

// Repo defaults for this plan's active run; both are overridable with
// --record/--plan (resolved against the current working directory).
export const DEFAULT_RECORD =
  ".agents/csm-build-state/2026-09-28-completion-supervisor-contract-build.json";
export const DEFAULT_PLAN = ".agents/plans/2026-09-28-completion-supervisor-contract-csm.json";

const argValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

async function readJson(filePath, label) {
  const raw = await readFile(filePath, "utf8");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be a JSON object`);
  return value;
}

export async function runContinuationCli(argv = process.argv.slice(2)) {
  const recordPath = path.resolve(argValue(argv, "--record") ?? DEFAULT_RECORD);
  const planPath = path.resolve(argValue(argv, "--plan") ?? DEFAULT_PLAN);
  let record;
  let plan;
  try {
    record = await readJson(recordPath, "build-state");
    plan = await readJson(planPath, "plan");
  } catch (error) {
    // Fail closed: an unreadable run is not a reason to continue.
    process.stdout.write(
      `${JSON.stringify({
        action: "stop",
        reason: "unreadable-record",
        command: null,
        error: error.message,
      })}\n`,
    );
    return 1;
  }
  const guard = evaluateLoopGuard(record, {
    tasks: Array.isArray(plan.tasks) ? plan.tasks : [],
  });
  // Carry the resolved paths on the record so the resume command is concrete.
  const decision = decideContinuation({
    record: { ...record, recordPath, planPath },
    guard,
    budget: {},
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(await runContinuationCli());
