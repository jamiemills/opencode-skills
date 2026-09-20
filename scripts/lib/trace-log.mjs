"use strict";
// Append-only UTC trace log (JSONL). appendTrace/recordDecision write exactly
// one JSON object per line with the durable schema fields
// ts/runId/actor/action/target/justification/outcome, plus a `kind` marker
// ("action" for traces, "decision" for decisions). Timestamps are always UTC
// (ISO-8601 ending in Z); a non-UTC caller-supplied ts is refused. Every string
// field is redacted for credential-shaped values before it is written, so a
// secret can never reach disk. Records are durable evidence, not telemetry.
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isUtc, utcNow } from "./utc.mjs";

const REQUIRED_FIELDS = ["runId", "actor", "action", "target", "justification", "outcome"];

// Credential-shaped values: `Bearer <token>` and `*_KEY`/`*_TOKEN`/`*_SECRET`
// assignments (mirrors the artifact diagnostic redaction). The value is always
// replaced, never persisted.
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const CREDENTIAL_RE =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}"']+)/gi;
const REDACTED = "[REDACTED]";

function redactString(value) {
  return value
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(CREDENTIAL_RE, (_match, key, separator) => `${key}${separator}${REDACTED}`);
}

function redact(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = redact(inner);
    return out;
  }
  return value;
}

function resolveNow(now) {
  if (typeof now === "function") return now();
  if (now !== undefined && now !== null) return now;
  return utcNow();
}

function defaultFile(runId, ts) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.includes(".."))
    throw new TypeError("runId is not a canonical trace id");
  return join(".agents", "logs", `${ts.slice(0, 10)}-${runId}-trace.jsonl`);
}

async function writeTrace(entry, { file, now, kind } = {}) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry))
    throw new TypeError("trace entry must be an object");
  const ts = entry.ts ?? resolveNow(now);
  if (!isUtc(ts))
    throw new TypeError("trace entry ts must be a UTC ISO-8601 timestamp ending in Z");
  for (const field of REQUIRED_FIELDS) {
    if (typeof entry[field] !== "string" || entry[field].length === 0)
      throw new TypeError(`trace entry is missing required field: ${field}`);
  }
  const record = redact({ ...entry, ts, kind });
  const target = resolve(file ?? defaultFile(entry.runId, ts));
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o644 });
  return { file: target, entry: record };
}

export function appendTrace(entry, options = {}) {
  return writeTrace(entry, { ...options, kind: entry?.kind ?? "action" });
}

export function recordDecision(entry, options = {}) {
  return writeTrace(entry, { ...options, kind: "decision" });
}
