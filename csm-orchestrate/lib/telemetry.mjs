"use strict";

import { randomUUID } from "node:crypto";

export const TELEMETRY_EVENT_SCHEMA_ID = "csm-orchestrate-telemetry-event/1";
export const TELEMETRY_EVENT_TYPES = Object.freeze([
  "dispatch",
  "approval",
  "cursor",
  "retry",
  "timeout",
  "cancellation",
  "review",
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
    transport.write(full);
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
    const terminalEvents = transport.list().filter((event) => event.eventType === "terminal");
    const missing = receipts.filter(
      (receipt) => !terminalEvents.some((event) => correlate(receipt, event)),
    );
    return {
      complete: missing.length === 0,
      total: receipts.length,
      correlated: receipts.length - missing.length,
      missing: missing.map((receipt) => ({ receiptId: receipt.receiptId, runId: receipt.runId })),
    };
  }

  function detectLoss() {
    const observed = transport.list();
    const observedSequences = new Set(observed.map((event) => event.sequence));
    const missingSequences = [];
    for (let expected = 1; expected <= emittedCount; expected += 1) {
      if (!observedSequences.has(expected)) missingSequences.push(expected);
    }
    const unexpectedSequences = observed
      .filter(
        (event) =>
          !Number.isInteger(event.sequence) || event.sequence < 1 || event.sequence > emittedCount,
      )
      .map((event) => event.sequence);
    return {
      lost:
        missingSequences.length > 0 ||
        unexpectedSequences.length > 0 ||
        observed.length !== emittedCount,
      emittedCount,
      observedCount: observed.length,
      missingSequences,
      unexpectedSequences,
    };
  }

  function getEvents(filter = {}) {
    if (!isPlainObject(filter)) throw new TypeError("event filter must be an object");
    const keys = Object.keys(filter).filter((key) => filter[key] !== undefined);
    return transport.list().filter((event) => keys.every((key) => event[key] === filter[key]));
  }

  return {
    emit,
    recordTerminalReceipt,
    checkCompleteness,
    detectLoss,
    getEvents,
  };
}

export default {
  TELEMETRY_EVENT_SCHEMA_ID,
  TELEMETRY_EVENT_TYPES,
  REDACTED_VALUE,
  DEFAULT_REDACT_KEYS,
  redactPayload,
  createMemoryTransport,
  createTelemetryEmitter,
};
