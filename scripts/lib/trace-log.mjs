"use strict";
// Append-only UTC trace log (JSONL). appendTrace/recordDecision write exactly
// one JSON object per line with the durable schema fields
// ts/runId/actor/action/target/justification/outcome, plus a `kind` marker
// ("action" for traces, "decision" for decisions). Timestamps are always UTC
// (ISO-8601 ending in Z); a non-UTC caller-supplied ts is refused. Every string
// field is redacted for credential-shaped values before it is written, so a
// secret can never reach disk. Records are durable evidence, not telemetry.
//
// The default target is the ONE shared per-repo log resolved from the git
// common dir (repo-state.repoLogPath(process.cwd())), so every run, agent, and
// linked worktree appends to `<git-common-dir>/csm/logs/trace.jsonl`, which
// survives worktree closure. An explicit `file` overrides the default.
//
// Each record is serialized to a single line and written with exactly ONE
// write() to an O_APPEND descriptor (never read-modify-write). Cross-process
// append is atomic on local POSIX; elsewhere it is best-effort. A serialized
// line is bounded (MAX_LINE_BYTES); when a record would exceed the bound its
// longest string fields are truncated after redaction with an explicit
// `…[truncated:<n>]` marker. A record is NEVER dropped: loss-less means every
// record is represented, not that oversized fields are stored verbatim.
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repoLogPath } from "./repo-state.mjs";
import { isUtc, utcNow } from "./utc.mjs";

const REQUIRED_FIELDS = ["runId", "actor", "action", "target", "justification", "outcome"];

// Bounded single-write size: the serialized line (including its trailing
// newline) must fit in one write() so no writer can observe a torn line.
const MAX_LINE_BYTES = 512 * 1024;
const TRUNCATION_MARKER = (removed) => `\u2026[truncated:${removed}]`;

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

// Collect mutable references to every string reachable in the record so the
// longest ones can be shortened in place (required fields stay present).
function collectStringSlots(container, slots = []) {
  if (Array.isArray(container)) {
    container.forEach((item, index) => {
      if (typeof item === "string")
        slots.push({ get: () => container[index], set: (value) => (container[index] = value) });
      else collectStringSlots(item, slots);
    });
  } else if (container && typeof container === "object") {
    for (const key of Object.keys(container)) {
      const inner = container[key];
      if (typeof inner === "string")
        slots.push({ get: () => container[key], set: (value) => (container[key] = value) });
      else collectStringSlots(inner, slots);
    }
  }
  return slots;
}

// Serialize the record to one newline-terminated line, truncating its longest
// string fields (after redaction) until it fits MAX_LINE_BYTES. Never rejects:
// if even fully-truncated strings cannot fit, the (over-bound) represented
// record is returned so no record is ever dropped.
function fitLine(record) {
  const encode = () => `${JSON.stringify(record)}\n`;
  let line = encode();
  if (Buffer.byteLength(line, "utf8") <= MAX_LINE_BYTES) return line;
  const slots = collectStringSlots(record);
  const truncated = new Set();
  while (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
    let chosen = null;
    for (const slot of slots) {
      if (truncated.has(slot)) continue;
      if (chosen === null || slot.get().length > chosen.get().length) chosen = slot;
    }
    if (chosen === null) break;
    const original = chosen.get();
    let low = 0;
    let high = original.length;
    let keep = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      chosen.set(original.slice(0, mid) + TRUNCATION_MARKER(original.length - mid));
      if (Buffer.byteLength(encode(), "utf8") <= MAX_LINE_BYTES) {
        keep = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    chosen.set(
      keep >= 0
        ? original.slice(0, keep) + TRUNCATION_MARKER(original.length - keep)
        : TRUNCATION_MARKER(original.length),
    );
    truncated.add(chosen);
    line = encode();
  }
  return line;
}

// Exactly one append write per record. A short write is a hard error: a torn
// line must surface, never be silently retried into an interleaving.
function writeLine(target, line) {
  mkdirSync(dirname(target), { recursive: true });
  const buffer = Buffer.from(line, "utf8");
  const fd = openSync(target, "a", 0o644);
  try {
    const bytesWritten = writeSync(fd, buffer);
    if (bytesWritten !== buffer.length)
      throw new Error(`short write to trace log: wrote ${bytesWritten} of ${buffer.length} bytes`);
  } finally {
    closeSync(fd);
  }
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
  const target = resolve(file ?? repoLogPath(process.cwd()));
  writeLine(target, fitLine(record));
  return { file: target, entry: record };
}

export function appendTrace(entry, options = {}) {
  return writeTrace(entry, { ...options, kind: entry?.kind ?? "action" });
}

export function recordDecision(entry, options = {}) {
  return writeTrace(entry, { ...options, kind: "decision" });
}
