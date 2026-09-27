#!/usr/bin/env node
"use strict";

// T013: deterministic completion verifier. Given a csm plan and a typed
// multi-reviewer verdict, it asserts (a) >= 2 independent reviewers all return
// `complete`, and (b) every plan task carries a terminal per-task verdict with
// evidence. `--git-clean` asserts the tree has no uncommitted changes; a CI
// mode is deferred to the landing step. Exit codes: 0 ok, 2 not-ok, 1 usage.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { createSchemaValidator } from "../lib/schema-runtime/index.mjs";

export const VERDICT_SCHEMA = "csm-completion-verdict/1";
export const TERMINAL_TASK_VERDICTS = Object.freeze(["complete", "blocked-deps"]);
const VERDICT_SCHEMA_PATH = "schemas/csm-completion-verdict.schema.json";

function loadVerdictValidator() {
  const schema = JSON.parse(
    readFileSync(new URL(`../${VERDICT_SCHEMA_PATH}`, import.meta.url), "utf8"),
  );
  return createSchemaValidator({ schemas: [schema] });
}

function taskIdOf(task) {
  return String(task?.taskId ?? task?.id ?? task?.ordinal ?? "");
}

// Pure verdict over already-parsed plan + verdict objects.
export function verifyCompletion({ plan, verdict } = {}) {
  if (!plan || typeof plan !== "object")
    return { schema: VERDICT_SCHEMA, ok: false, reason: "plan-missing" };
  if (!verdict || typeof verdict !== "object")
    return { schema: VERDICT_SCHEMA, ok: false, reason: "verdict-missing" };

  const valid = loadVerdictValidator().validate(VERDICT_SCHEMA, verdict);
  if (!valid.valid) return { schema: VERDICT_SCHEMA, ok: false, reason: "verdict-schema-invalid" };

  const reviewers = verdict.reviewers ?? [];
  const distinct = new Set(reviewers.map((r) => r.id));
  if (reviewers.length < 2 || distinct.size < 2)
    return { schema: VERDICT_SCHEMA, ok: false, reason: "reviewers-not-independent" };
  if (reviewers.some((r) => r.verdict !== "complete"))
    return { schema: VERDICT_SCHEMA, ok: false, reason: "reviewer-incomplete" };
  if (verdict.verdict !== "complete")
    return { schema: VERDICT_SCHEMA, ok: false, reason: "verdict-incomplete" };
  if (plan.planId !== undefined && verdict.planId !== plan.planId)
    return { schema: VERDICT_SCHEMA, ok: false, reason: "plan-id-mismatch" };

  const byId = new Map((verdict.tasks ?? []).map((t) => [String(t.id), t]));
  const missing = [];
  for (const task of plan.tasks ?? []) {
    const id = taskIdOf(task);
    const entry = byId.get(id);
    if (!entry) {
      missing.push(id);
      continue;
    }
    if (!TERMINAL_TASK_VERDICTS.includes(entry.verdict)) {
      missing.push(id);
      continue;
    }
    if (entry.verdict === "complete" && (entry.evidence ?? "").trim().length === 0)
      missing.push(`${id}(no-evidence)`);
  }
  if (missing.length)
    return { schema: VERDICT_SCHEMA, ok: false, reason: "tasks-incomplete", missing };
  return { schema: VERDICT_SCHEMA, ok: true, reason: "ok", tasks: (plan.tasks ?? []).length };
}

export function verifyGitClean({ cwd = process.cwd(), run = spawnSync } = {}) {
  const result = run("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return { schema: VERDICT_SCHEMA, ok: false, reason: "git-unavailable" };
  const dirty = String(result.stdout ?? "").trim();
  if (dirty.length > 0)
    return {
      schema: VERDICT_SCHEMA,
      ok: false,
      reason: "git-dirty",
      dirty: dirty.split("\n").length,
    };
  return { schema: VERDICT_SCHEMA, ok: true, reason: "ok" };
}

function parseArgs(argv) {
  const flags = { mode: "verdict" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--git-clean") {
      flags.mode = "git-clean";
      continue;
    }
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--"))
      throw new TypeError(`--${name} needs a value`);
    flags[name] = value;
    i += 1;
  }
  return flags;
}

export function runVerifyCompletionCli({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const flags = parseArgs(argv);
  if (flags.mode === "git-clean") return verifyGitClean({ cwd });
  if (typeof flags.plan !== "string" || typeof flags.verdict !== "string")
    throw new TypeError("usage: verify-completion --plan <path> --verdict <path> | --git-clean");
  const plan = JSON.parse(readFileSync(flags.plan, "utf8"));
  const verdict = JSON.parse(readFileSync(flags.verdict, "utf8"));
  return verifyCompletion({ plan, verdict });
}

function isDirectInvocation() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectInvocation()) {
  try {
    const result = runVerifyCompletionCli({});
    process.stdout.write(
      `verify-completion: ${result.reason}${result.missing ? ` (${result.missing.join(", ")})` : ""}\n`,
    );
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  }
}
