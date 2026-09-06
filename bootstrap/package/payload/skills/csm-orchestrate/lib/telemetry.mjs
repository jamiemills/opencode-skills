"use strict";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendDurableJsonLine,
  atomicWrite,
  readJsonLines,
} from "../../../lib/durable-json/index.mjs";

export const TELEMETRY_EVENT_SCHEMA_ID = "csm-orchestrate-telemetry-event/1";
export const TELEMETRY_EVENT_TYPES = Object.freeze([
  "dispatch",
  "approval",
  "cursor",
  "retry",
  "timeout",
  "cancellation",
  "review",
  "skill-progress-rollup",
  "remediation",
  "reconciliation",
  "terminal",
  "config_resolution",
  "telemetry_loss",
]);
export const REDACTED_VALUE = "[redacted]";
export const DEFAULT_REDACT_KEYS = Object.freeze([
  "token",
  "secret",
  "password",
  "credential",
  "credentials",
  "authorization",
  "apikey",
  "privatekey",
  "sessionid",
  "cookie",
  "accesstoken",
  "refreshtoken",
  "url",
  "uri",
  "candidate",
  "candidates",
]);

const RUN_ID_PATTERN = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const PHASE_ID_PATTERN = /^phase-[a-z0-9][a-z0-9-]{1,127}$/;
const EDGE_ID_PATTERN = /^edge-[a-z0-9][a-z0-9-]{1,127}$/;
const EVENT_ID_PATTERN = /^evt-[a-z0-9][a-z0-9-]{1,127}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRedactKeys(keys) {
  return new Set(
    keys.map((key) =>
      String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    ),
  );
}

function normalizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key, sensitive) {
  const normalized = normalizeKey(key);
  if (sensitive.has(normalized)) return true;
  for (const name of sensitive) if (normalized.endsWith(name)) return true;
  return false;
}

function redactValue(value, sensitive) {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, sensitive));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitiveKey(key, sensitive) ? REDACTED_VALUE : redactValue(child, sensitive);
    }
    return out;
  }
  return value;
}

export function redactPayload(payload, redactKeys = DEFAULT_REDACT_KEYS) {
  if (!isPlainObject(payload)) throw new TypeError("payload must be an object");
  return redactValue(payload, normalizeRedactKeys(redactKeys));
}

export function createMemoryTransport() {
  const events = [];
  return {
    write(event) {
      events.push(event);
    },
    list() {
      return events.slice();
    },
  };
}

export function createJsonlTransport(filePath) {
  if (typeof filePath !== "string" || filePath.length < 1)
    throw new TypeError("filePath must be a non-empty string");
  const pendingWrites = [];
  let writeQueue = Promise.resolve();
  // S3a: torn tails found by list() are recovered (never thrown) and reported
  // through this array so callers can quarantine/repair durably. A file that
  // was never written reads as an empty event list, not an error.
  const partialTails = [];
  // S3b: the queue must never become a poison pill — a rejected append resets
  // the chain so later writes attempt again instead of failing forever.
  return {
    partialTails,
    write(event) {
      const attempt = writeQueue.then(() =>
        appendDurableJsonLine(filePath, event, { mode: 0o600 }),
      );
      writeQueue = attempt.then(
        () => undefined,
        () => undefined,
      );
      pendingWrites.push(attempt);
      return attempt;
    },
    async list() {
      while (pendingWrites.length) await pendingWrites.shift().catch(() => {});
      try {
        return await readJsonLines(filePath, {
          recoverPartialTail: true,
          onPartialTail: (tail) => partialTails.push(tail),
        });
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
  };
}

// S3a write-side repair: after a crash mid-append the JSONL may end in an
// unterminated line. Quarantine the torn bytes to
// `<file>.partial-<ts>-<uuid>.quarantine` and atomically rewrite the clean
// prefix so later appends never concatenate onto the torn tail. Missing file
// and already-clean files are no-ops. Callers must hold the run lease.
export async function repairTelemetryJsonlTail(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { repaired: false, quarantinedPath: null };
    throw error;
  }
  const newlineIndex = text.lastIndexOf("\n");
  if (newlineIndex === text.length - 1 || text.length === 0)
    return { repaired: false, quarantinedPath: null };
  const torn = text.slice(newlineIndex + 1);
  const clean = text.slice(0, newlineIndex + 1);
  const quarantinedPath = `${filePath}.partial-${Date.now()}-${randomUUID()}.quarantine`;
  await mkdir(dirname(quarantinedPath), { recursive: true });
  await writeFile(quarantinedPath, torn, { mode: 0o600, flag: "wx" });
  await atomicWrite(filePath, clean);
  return { repaired: true, quarantinedPath, tornLength: torn.length };
}

function optionalId(value, pattern, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !pattern.test(value))
    throw new TypeError(`${label} must match its canonical id pattern or be null`);
  return value;
}

function correlate(receipt, event) {
  if (event.runId !== receipt.runId) return false;
  if (event.payload?.receiptId !== undefined) return event.payload.receiptId === receipt.receiptId;
  if (receipt.childRunId !== undefined) return event.childRunId === receipt.childRunId;
  return false;
}

export function createTelemetryEmitter(options = {}) {
  if (!isPlainObject(options)) throw new TypeError("telemetry emitter options must be an object");
  if (options.runId !== undefined && !RUN_ID_PATTERN.test(options.runId))
    throw new TypeError("runId must match run-<lowercase-hyphen-id>");
  if (
    options.effectiveConfigDigest !== undefined &&
    !DIGEST_PATTERN.test(options.effectiveConfigDigest)
  )
    throw new TypeError("effectiveConfigDigest must be a sha256 digest");
  const transport = options.transport ?? createMemoryTransport();
  if (
    !isPlainObject(transport) ||
    typeof transport.write !== "function" ||
    typeof transport.list !== "function"
  )
    throw new TypeError("transport must provide write(event) and list()");
  const now =
    typeof options.now === "function"
      ? options.now
      : options.now !== undefined
        ? () => options.now
        : () => new Date().toISOString();
  const redactKeys = options.redactKeys ?? DEFAULT_REDACT_KEYS;

  let sequence = 0;
  let emittedCount = 0;
  const recordedReceipts = [];
  const lossRecords = [];

  // S3b durable loss markers (Option A): every recorded loss also enqueues a
  // full telemetry event of type telemetry_loss carrying the FAILED event's
  // own sequence and complete field set, so a rejecting transport leaves a
  // durable record that survives reopen. Markers are written WITHOUT
  // recursion (a marker-write failure is swallowed — recordLoss never calls
  // itself) and never bump sequence/emittedCount (they are not emissions).
  function buildLossMarker(event, error) {
    return Object.freeze({
      schema: TELEMETRY_EVENT_SCHEMA_ID,
      eventId: `evt-${randomUUID()}`,
      sequence: event.sequence ?? 0,
      runId: event.runId ?? options.runId,
      phaseId: event.phaseId ?? null,
      edgeId: event.edgeId ?? null,
      childRunId: event.childRunId ?? null,
      eventType: "telemetry_loss",
      timestamp: event.timestamp ?? now(),
      attempt: event.attempt ?? 0,
      payload: Object.freeze({
        lostEvent: event,
        code: error?.code ?? "telemetry-write-failed",
        message: error?.message ?? "telemetry event could not be written",
      }),
      effectiveConfigDigest: event.effectiveConfigDigest ?? options.effectiveConfigDigest,
      fencingToken: event.fencingToken ?? null,
    });
  }

  function enqueueLossMarker(event, error) {
    const marker = buildLossMarker(event, error);
    try {
      const write = transport.write(marker);
      if (write && typeof write.then === "function") write.catch(() => {});
    } catch {
      // Marker writes never recurse into recordLoss (no second marker) and
      // never surface: the loss record above remains the in-memory fallback.
    }
  }

  function recordLoss(event, error) {
    lossRecords.push(
      Object.freeze({
        schema: "csm-orchestrate-telemetry-loss/1",
        eventType: "telemetry_loss",
        runId: event.runId ?? options.runId,
        phaseId: event.phaseId ?? null,
        edgeId: event.edgeId ?? null,
        childRunId: event.childRunId ?? null,
        attempt: event.attempt ?? 0,
        sequence: event.sequence ?? null,
        code: error?.code ?? "telemetry-write-failed",
        message: error?.message ?? "telemetry event could not be written",
      }),
    );
    enqueueLossMarker(event, error);
  }

  function emit(event) {
    if (!isPlainObject(event)) throw new TypeError("telemetry event must be an object");
    if (!TELEMETRY_EVENT_TYPES.includes(event.eventType))
      throw new TypeError(`unsupported telemetry event type ${String(event.eventType)}`);
    const runId = event.runId ?? options.runId;
    if (!RUN_ID_PATTERN.test(String(runId ?? "")))
      throw new TypeError("runId is required and must match run-<lowercase-hyphen-id>");
    const effectiveConfigDigest = event.effectiveConfigDigest ?? options.effectiveConfigDigest;
    if (!DIGEST_PATTERN.test(String(effectiveConfigDigest ?? "")))
      throw new TypeError("effectiveConfigDigest is required and must be a sha256 digest");
    const phaseId = optionalId(event.phaseId, PHASE_ID_PATTERN, "phaseId");
    const edgeId = optionalId(event.edgeId, EDGE_ID_PATTERN, "edgeId");
    const childRunId = optionalId(event.childRunId, RUN_ID_PATTERN, "childRunId");
    const attempt = event.attempt ?? 0;
    if (!Number.isInteger(attempt) || attempt < 0)
      throw new TypeError("attempt must be a non-negative integer");
    const fencingToken = event.fencingToken ?? null;
    if (fencingToken !== null && (!Number.isInteger(fencingToken) || fencingToken < 1))
      throw new TypeError("fencingToken must be a positive integer or null");
    const payload = event.payload ?? {};
    if (!isPlainObject(payload)) throw new TypeError("payload must be an object");
    sequence += 1;
    emittedCount += 1;
    const full = Object.freeze({
      schema: TELEMETRY_EVENT_SCHEMA_ID,
      eventId: `evt-${randomUUID()}`,
      sequence,
      runId,
      phaseId,
      edgeId,
      childRunId,
      eventType: event.eventType,
      timestamp: event.timestamp ?? now(),
      attempt,
      payload: Object.freeze(redactPayload(payload, redactKeys)),
      effectiveConfigDigest,
      fencingToken,
    });
    if (!EVENT_ID_PATTERN.test(full.eventId)) throw new TypeError("eventId is not canonical");
    try {
      const write = transport.write(full);
      if (write && typeof write.then === "function")
        Promise.resolve(write).catch((error) => recordLoss(full, error));
    } catch (error) {
      recordLoss(full, error);
      throw error;
    }
    return full;
  }

  function recordTerminalReceipt(receipt) {
    if (!isPlainObject(receipt)) throw new TypeError("terminal receipt must be an object");
    if (typeof receipt.receiptId !== "string" || receipt.receiptId.length < 1)
      throw new TypeError("terminal receipt requires a non-empty receiptId");
    if (!RUN_ID_PATTERN.test(String(receipt.runId ?? "")))
      throw new TypeError("terminal receipt requires a canonical runId");
    const recorded = {
      receiptId: receipt.receiptId,
      runId: receipt.runId,
      ...(receipt.phaseId !== undefined ? { phaseId: receipt.phaseId } : {}),
      ...(receipt.childRunId !== undefined ? { childRunId: receipt.childRunId } : {}),
    };
    recordedReceipts.push(recorded);
    return recorded;
  }

  function checkCompleteness(terminalReceipts) {
    const receipts = terminalReceipts === undefined ? recordedReceipts.slice() : terminalReceipts;
    if (!Array.isArray(receipts)) throw new TypeError("terminalReceipts must be an array");
    const inspect = (events) => {
      const terminalEvents = events.filter((event) => event.eventType === "terminal");
      const missing = receipts.filter(
        (receipt) => !terminalEvents.some((event) => correlate(receipt, event)),
      );
      return {
        complete: missing.length === 0,
        total: receipts.length,
        correlated: receipts.length - missing.length,
        missing: missing.map((receipt) => ({ receiptId: receipt.receiptId, runId: receipt.runId })),
      };
    };
    const events = transport.list();
    return events?.then ? events.then(inspect) : inspect(events);
  }

  function detectLoss() {
    const inspect = (observed) => {
      // S3b marker-scan semantics: telemetry_loss markers are durable
      // slot-fillers — a marker carrying a failed event's sequence proves the
      // event was RECOVERED, not lost. Plain sequence/count checks against the
      // raw row list would under-report once markers exist, so losses are
      // computed over real (non-marker) events with markers consulted per
      // sequence. The in-memory getLossRecords() surface stays as fallback.
      const markers = observed.filter((event) => event.eventType === "telemetry_loss");
      const events = observed.filter((event) => event.eventType !== "telemetry_loss");
      const realSequences = new Set(events.map((event) => event.sequence));
      const markerSequences = new Set(markers.map((event) => event.sequence));
      const missingSequences = [];
      const recoveredViaMarkers = [];
      for (let expected = 1; expected <= emittedCount; expected += 1) {
        if (realSequences.has(expected)) continue;
        if (markerSequences.has(expected)) recoveredViaMarkers.push(expected);
        else missingSequences.push(expected);
      }
      const outOfRange = (rows) =>
        rows
          .filter(
            (event) =>
              !Number.isInteger(event.sequence) ||
              event.sequence < 1 ||
              event.sequence > emittedCount,
          )
          .map((event) => event.sequence);
      const unexpectedSequences = [...outOfRange(events), ...outOfRange(markers)];
      return {
        lost:
          missingSequences.length > 0 ||
          unexpectedSequences.length > 0 ||
          events.length + recoveredViaMarkers.length !== emittedCount,
        emittedCount,
        observedCount: events.length,
        markerCount: markers.length,
        missingSequences,
        recoveredViaMarkers,
        unexpectedSequences,
      };
    };
    const events = transport.list();
    return events?.then ? events.then(inspect) : inspect(events);
  }

  function getEvents(filter = {}) {
    if (!isPlainObject(filter)) throw new TypeError("event filter must be an object");
    const keys = Object.keys(filter).filter((key) => filter[key] !== undefined);
    const inspect = (events) =>
      events.filter((event) => keys.every((key) => event[key] === filter[key]));
    const events = transport.list();
    return events?.then ? events.then(inspect) : inspect(events);
  }

  async function flush() {
    // drain async transports so persisted telemetry is complete when the
    // process exits (honest-failure fix: jsonl writes were lost on exit)
    const drained = transport.list();
    if (drained?.then) await drained;
  }

  return {
    emit,
    recordTerminalReceipt,
    checkCompleteness,
    detectLoss,
    getEvents,
    getLossRecords: () => lossRecords.slice(),
    flush,
  };
}

export default {
  TELEMETRY_EVENT_SCHEMA_ID,
  TELEMETRY_EVENT_TYPES,
  REDACTED_VALUE,
  DEFAULT_REDACT_KEYS,
  redactPayload,
  createMemoryTransport,
  createJsonlTransport,
  createTelemetryEmitter,
  repairTelemetryJsonlTail,
};
