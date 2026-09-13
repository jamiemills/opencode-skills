#!/usr/bin/env node
"use strict";

// T019: thin, child-side worker entry. Runs exactly ONE invocation and returns
// a raw child result. It never compiles phases, owns cursors/receipts/gates, or
// accepts work: the parent orchestrator remains the single acceptance
// authority. Env-gated by CSM_AGENT_SESSION_EXEC like the agent-session
// executor, and fail-closed when disabled or when no handler is supplied.

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXEC_ENV = "CSM_AGENT_SESSION_EXEC";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--invocation") args.invocation = argv[++index];
    else if (token === "--handler") args.handler = argv[++index];
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function readJsonFile(filePath, label) {
  if (typeof filePath !== "string" || filePath.length === 0)
    throw new Error(`${label} path is required`);
  const absolute = resolve(filePath);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${label} must be a regular file, not a symlink or directory`);
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function blockedResult(invocation, code, message) {
  return {
    schema: invocation?.outputSchema ?? null,
    skill: invocation?.skill ?? null,
    attempt: invocation?.attempt ?? 0,
    status: "blocked",
    effects: [],
    artifacts: [],
    receipt: null,
    failure: { class: "policy", code, message },
  };
}

function normalizeResult(invocation, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("worker handler must return a result object");
  if (!["completed", "failed", "blocked"].includes(value.status))
    throw new Error("worker handler result requires a valid status");
  return {
    schema: value.schema ?? invocation?.outputSchema ?? null,
    skill: value.skill ?? invocation?.skill ?? null,
    attempt: value.attempt ?? invocation?.attempt ?? 0,
    status: value.status,
    effects: Array.isArray(value.effects) ? value.effects : [],
    artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
    receipt: value.receipt ?? null,
    failure: value.failure ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const invocation = readJsonFile(args.invocation, "invocation");

  if (process.env[EXEC_ENV] !== "1") {
    process.stdout.write(
      `${JSON.stringify(blockedResult(invocation, "agent-session-required", "thin worker entry is disabled (CSM_AGENT_SESSION_EXEC != 1)"))}\n`,
    );
    return 0;
  }
  if (!args.handler) {
    process.stdout.write(
      `${JSON.stringify(blockedResult(invocation, "worker-handler-required", "no worker handler was supplied"))}\n`,
    );
    return 0;
  }
  const handler = await import(resolve(args.handler));
  if (typeof handler.execute !== "function")
    throw new Error("worker handler must export an execute(request) function");
  const value = await handler.execute(invocation);
  process.stdout.write(`${JSON.stringify(normalizeResult(invocation, value))}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  },
);
