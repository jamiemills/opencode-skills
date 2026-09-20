#!/usr/bin/env node
"use strict";

// The deterministic trace sink for explicit/instruction-led use. It writes ONE
// validated, redacted, UTC record to the shared per-repo trace log via
// scripts/lib/trace-log.mjs (the same writer wt-session and the loop CLIs use).
// It never touches the network and never writes anywhere except the trace log.
//
// Usage:
//   node scripts/trace.mjs action   --actor <a> --action <name> --target <t> \
//                                   --justification <j> --outcome <o> [--run-id <id>] [--file <path>] [--json]
//   node scripts/trace.mjs decision (same flags; forces kind=decision)
//   node scripts/trace.mjs --stdin [--decision] [--file <path>]   # one JSON object on stdin
//
// runId comes from --run-id, else CSM_RUN_ID, else a generated id. The library
// supplies ts (UTC now) and re-validates the required fields and redaction.

import { pathToFileURL } from "node:url";

import { appendTrace, recordDecision } from "./lib/trace-log.mjs";

const FLAG_NAMES = new Set([
  "run-id",
  "actor",
  "action",
  "target",
  "justification",
  "outcome",
  "file",
]);
const REQUIRED = ["actor", "action", "target", "justification", "outcome"];

export function safeRunId(raw) {
  if (typeof raw === "string" && /^[A-Za-z0-9._-]+$/.test(raw) && !raw.includes("..")) return raw;
  return `run-${Date.now().toString(36)}-${process.pid.toString(36)}`;
}

export function parseArgs(argv = []) {
  const flags = {};
  const positional = [];
  let stdin = false;
  let decision = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stdin") {
      stdin = true;
      continue;
    }
    if (token === "--decision") {
      decision = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token.startsWith("--")) {
      const name = token.slice(2);
      if (!FLAG_NAMES.has(name)) throw new TypeError(`unknown flag --${name}`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new TypeError(`--${name} needs a value`);
      flags[name] = value;
      index += 1;
      continue;
    }
    positional.push(token);
  }
  const mode = positional[0] ?? null;
  if (!stdin && mode !== "action" && mode !== "decision")
    throw new TypeError("first argument must be action or decision (or use --stdin)");
  return { flags, positional, stdin, decision: decision || mode === "decision", json, mode };
}

export function entryFromArgs({ flags, stdin, decision }, input, env = process.env) {
  const source = stdin ? input : flags;
  const entry = {
    runId:
      source.runId ?? source["run-id"] ?? flags["run-id"] ?? env.CSM_RUN_ID ?? safeRunId(undefined),
    actor: source.actor,
    action: source.action,
    target: source.target,
    justification: source.justification,
    outcome: source.outcome,
  };
  for (const field of REQUIRED) {
    if (typeof entry[field] !== "string" || entry[field].length === 0)
      throw new TypeError(`${field} must be a non-empty string`);
  }
  return { entry, decision: decision || source.kind === "decision" };
}

export async function runTraceCli({
  argv = process.argv.slice(2),
  env = process.env,
  readStdin = async () => {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  },
  write = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const parsed = parseArgs(argv);
  let input = {};
  if (parsed.stdin) {
    const raw = await readStdin();
    if (raw.trim().length === 0) throw new TypeError("--stdin received no input");
    input = JSON.parse(raw);
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("--stdin JSON must be an object");
  }
  const { entry, decision } = entryFromArgs(parsed, input, env);
  const options = parsed.flags.file ? { file: parsed.flags.file } : {};
  const result = decision
    ? await recordDecision(entry, options)
    : await appendTrace(entry, options);
  write(parsed.json ? JSON.stringify(result) : result.file);
  return result;
}

function isDirectInvocation() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectInvocation()) {
  runTraceCli().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  });
}
