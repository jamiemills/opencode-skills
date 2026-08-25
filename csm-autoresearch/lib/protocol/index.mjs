"use strict";

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 2000;
const STATUSES = Object.freeze([
  "ok",
  "invalid",
  "failed",
  "timed_out",
  "resource_exhausted",
  "policy_violation",
  "sandbox_unavailable",
  "blocked",
  "protocol_error",
]);
const HASH = /^sha256:[0-9a-f]{64}$/;

function fail(message, path = "request") {
  const error = new TypeError(`${path}: ${message}`);
  error.code = "PROTOCOL_ERROR";
  throw error;
}

function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("must be an object", path);
}

function string(value, path, max = Infinity) {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    fail("must be a bounded non-empty string", path);
}

function integer(value, path, min, max = Infinity) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail("must be a bounded integer", path);
}

function noUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`unknown field ${key}`, path);
}

function validateRequest(value) {
  object(value, "request");
  noUnknown(
    value,
    new Set(["format", "requestId", "runId", "candidate", "limits", "input"]),
    "request",
  );
  if (value.format !== "csm-autoresearch-evaluator-request/1")
    fail("invalid format", "request.format");
  string(value.requestId, "request.requestId", 100);
  string(value.runId, "request.runId", 100);
  object(value.candidate, "request.candidate");
  noUnknown(
    value.candidate,
    new Set(["id", "parentId", "sourceHash", "patchHash"]),
    "request.candidate",
  );
  string(value.candidate.id, "request.candidate.id", 100);
  if (value.candidate.parentId !== null)
    string(value.candidate.parentId, "request.candidate.parentId", 100);
  if (!HASH.test(value.candidate.sourceHash ?? "") || !HASH.test(value.candidate.patchHash ?? ""))
    fail("must be sha256", "request.candidate");
  object(value.limits, "request.limits");
  noUnknown(
    value.limits,
    new Set(["timeoutMs", "maxOutputBytes", "network", "maxWorkspaceBytes"]),
    "request.limits",
  );
  integer(value.limits.timeoutMs, "request.limits.timeoutMs", 1, 3600000);
  integer(value.limits.maxOutputBytes, "request.limits.maxOutputBytes", 1, 10485760);
  if (value.limits.network !== "disabled")
    fail("network must be disabled", "request.limits.network");
  if ("maxWorkspaceBytes" in value.limits)
    integer(value.limits.maxWorkspaceBytes, "request.limits.maxWorkspaceBytes", 1, 1073741824);
  return value;
}

function validateResponse(value) {
  object(value, "response");
  noUnknown(
    value,
    new Set([
      "format",
      "requestId",
      "runId",
      "status",
      "valid",
      "metrics",
      "samples",
      "diagnostics",
      "provenance",
    ]),
    "response",
  );
  if (value.format !== "csm-autoresearch-evaluator-response/1")
    fail("invalid format", "response.format");
  string(value.requestId, "response.requestId", 100);
  string(value.runId, "response.runId", 100);
  if (!STATUSES.includes(value.status)) fail("invalid status", "response.status");
  if (typeof value.valid !== "boolean" || (value.status === "ok") !== value.valid)
    fail("valid does not match status", "response.valid");
  object(value.metrics, "response.metrics");
  if (Object.keys(value.metrics).length > 50) fail("too many metrics", "response.metrics");
  for (const [key, metric] of Object.entries(value.metrics))
    if (typeof metric !== "number" || !Number.isFinite(metric))
      fail("must contain finite numbers", `response.metrics.${key}`);
  if (value.samples !== undefined) {
    if (
      !Array.isArray(value.samples) ||
      value.samples.length > 10000 ||
      value.samples.some((x) => typeof x !== "number" || !Number.isFinite(x))
    )
      fail("invalid samples", "response.samples");
  }
  if (value.diagnostics !== undefined) {
    if (
      !Array.isArray(value.diagnostics) ||
      value.diagnostics.length > 100 ||
      value.diagnostics.some(
        (x) => typeof x !== "string" || Buffer.byteLength(x) > MAX_DIAGNOSTIC_BYTES,
      )
    )
      fail("invalid diagnostics", "response.diagnostics");
  }
  object(value.provenance, "response.provenance");
  noUnknown(
    value.provenance,
    new Set(["evaluatorHash", "environmentHash", "limits", "redacted", "sandboxProvider"]),
    "response.provenance",
  );
  if (
    !HASH.test(value.provenance.evaluatorHash ?? "") ||
    !HASH.test(value.provenance.environmentHash ?? "")
  )
    fail("invalid provenance hash", "response.provenance");
  object(value.provenance.limits, "response.provenance.limits");
  if (value.provenance.redacted !== true) fail("must be true", "response.provenance.redacted");
  return value;
}

function parseLine(line, maxBytes = MAX_LINE_BYTES) {
  if (typeof line !== "string" && !Buffer.isBuffer(line)) fail("line must be text");
  const text = Buffer.isBuffer(line) ? line.toString("utf8") : line;
  if (Buffer.byteLength(text) > maxBytes) fail("line exceeds byte limit");
  if (text.includes("\n") || text.includes("\r")) fail("must contain exactly one line");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("invalid JSON");
  }
  return validateRequest(value);
}

function encodeResponse(response, maxBytes = MAX_LINE_BYTES) {
  validateResponse(response);
  const line = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(line) > maxBytes) fail("response exceeds byte limit");
  return line;
}

export { MAX_LINE_BYTES, STATUSES, encodeResponse, parseLine, validateRequest, validateResponse };
