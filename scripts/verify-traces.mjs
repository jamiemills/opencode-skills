#!/usr/bin/env node
"use strict";

// T001: the deterministic trace verifier. It resolves the SAME log path the
// writer uses (repoLogPath + resolveTraceLogPath), scans the JSONL, and reports
// whether a run's trace is present. It is read-only: it never creates, rotates,
// or truncates the log. Exit codes: 0 ok, 2 not-ok, 1 usage/read error.
//
// The gate's own failure audit action is EXCLUDED from matching so recording a
// failure cannot satisfy the invariant (no self-healing).

import { existsSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { repoLogPath } from "./lib/repo-state.mjs";
import { resolveTraceLogPath } from "./lib/trace-config.mjs";

export const VERIFY_SCHEMA = "csm-trace-verification/1";
export const AUDIT_ACTIONS = Object.freeze(["trace-verification-failed"]);
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export async function resolveVerificationPath({ root = process.cwd(), env = process.env } = {}) {
  const configured = await resolveTraceLogPath({ root, env });
  return repoLogPath(root, { configured });
}

// Pure scan over an already-resolved file. Never throws on a readable file.
export function verifyTraces({
  file,
  runId = null,
  expectAtLeast = 1,
  kinds = null,
  actions = null,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (typeof file !== "string" || file.length === 0)
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched: 0,
      malformed: 0,
      file: null,
      reason: "no-path",
    };
  if (!existsSync(file))
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched: 0,
      malformed: 0,
      file,
      reason: "log-absent",
    };
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched: 0,
      malformed: 0,
      file,
      reason: "log-unreadable",
    };
  }
  if (size > maxBytes)
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched: 0,
      malformed: 0,
      file,
      reason: "log-too-large",
    };
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched: 0,
      malformed: 0,
      file,
      reason: "log-unreadable",
    };
  }
  let matched = 0;
  let malformed = 0;
  let firstTs = null;
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      malformed += 1;
      continue;
    }
    if (AUDIT_ACTIONS.includes(record.action)) continue;
    if (runId !== null && record.runId !== runId) continue;
    if (Array.isArray(kinds) && !kinds.includes(record.kind)) continue;
    if (Array.isArray(actions) && !actions.includes(record.action)) continue;
    matched += 1;
    if (typeof record.ts === "string" && (firstTs === null || record.ts < firstTs))
      firstTs = record.ts;
  }
  if (malformed > 0)
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched,
      malformed,
      file,
      reason: "malformed-record",
      firstTs,
    };
  if (matched < expectAtLeast)
    return {
      schema: VERIFY_SCHEMA,
      ok: false,
      matched,
      malformed: 0,
      file,
      reason: "no-trace-for-run",
      firstTs,
    };
  return { schema: VERIFY_SCHEMA, ok: true, matched, malformed: 0, file, reason: "ok", firstTs };
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    if (name === "json") {
      flags.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new TypeError(`--${name} needs a value`);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

export async function runVerifyTracesCli({
  argv = process.argv.slice(2),
  env = process.env,
  root = process.cwd(),
  write = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const flags = parseArgs(argv);
  const expectAtLeast =
    flags["expect-at-least"] === undefined ? 1 : Number(flags["expect-at-least"]);
  if (!Number.isInteger(expectAtLeast) || expectAtLeast < 0)
    throw new TypeError("--expect-at-least must be a non-negative integer");
  const file = flags.file ?? (await resolveVerificationPath({ root, env }));
  const result = verifyTraces({
    file,
    runId: flags["run-id"] ?? null,
    expectAtLeast,
    kinds: flags.kind ? [flags.kind] : null,
    actions: flags.action ? [flags.action] : null,
  });
  write(
    flags.json
      ? JSON.stringify(result)
      : `verify-traces: ${result.reason} (matched ${result.matched})`,
  );
  return result;
}

function isDirectInvocation() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectInvocation()) {
  runVerifyTracesCli()
    .then((result) => process.exit(result.ok ? 0 : 2))
    .catch((error) => {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exit(1);
    });
}
