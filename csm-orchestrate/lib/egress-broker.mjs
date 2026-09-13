"use strict";

import { createHmac } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { digest } from "../../lib/schema-runtime/index.mjs";

function durableAppend(filePath, line) {
  appendFileSync(filePath, line, { mode: 0o600 });
  const fd = openSync(filePath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// T007: mediated egress policy + keyed audit chain. This module owns the
// host-side decision, the HMAC-keyed hash chain, durable persistence with
// external head anchoring, credential injection, unmediated-drop recording, and
// fail-closed enforcement of the matched rule's maxBytes/timeoutMs budgets.
// Still pending (broker-upstream T004/T005): sourcing real network-layer drops
// and wiring the broker into the live dispatch path. The policy/decision core
// remains pure and testable without Docker.
//
// Credentials are never placed in a record: only an opaque credentialRef is
// logged. Target identity uses targetHost/targetOrigin (never url/uri) so the
// telemetry redactor cannot destroy audit evidence.

const ZERO_HASH = `sha256:${"0".repeat(64)}`;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class EgressPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "EgressPolicyError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateEgressPolicy(policy) {
  if (!isPlainObject(policy)) throw new EgressPolicyError("egress policy must be an object");
  if (policy.defaultAction !== "deny" || policy.failMode !== "blocked")
    throw new EgressPolicyError("egress policy must be default-deny with failMode blocked");
  if (!Array.isArray(policy.entries))
    throw new EgressPolicyError("egress policy requires entries[]");
  for (const entry of policy.entries) {
    if (!isPlainObject(entry) || typeof entry.host !== "string" || !entry.host)
      throw new EgressPolicyError("each egress entry requires a host");
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535)
      throw new EgressPolicyError(`egress entry ${entry.host} requires a valid port`);
    if (entry.scheme !== undefined && (typeof entry.scheme !== "string" || !entry.scheme))
      throw new EgressPolicyError(`egress entry ${entry.host} scheme must be a non-empty string`);
    if (
      entry.methods !== undefined &&
      (!Array.isArray(entry.methods) ||
        entry.methods.some((method) => typeof method !== "string" || !method))
    )
      throw new EgressPolicyError(
        `egress entry ${entry.host} methods must be an array of non-empty strings`,
      );
    if (entry.pathPrefix !== undefined && typeof entry.pathPrefix !== "string")
      throw new EgressPolicyError(`egress entry ${entry.host} pathPrefix must be a string`);
    if (entry.maxBytes !== undefined && (!Number.isInteger(entry.maxBytes) || entry.maxBytes < 1))
      throw new EgressPolicyError(`egress entry ${entry.host} maxBytes must be a positive integer`);
    if (
      entry.timeoutMs !== undefined &&
      (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1)
    )
      throw new EgressPolicyError(
        `egress entry ${entry.host} timeoutMs must be a positive integer`,
      );
  }
  if (!Array.isArray(policy.credentialInjections))
    throw new EgressPolicyError("egress policy requires credentialInjections[]");
  for (const injection of policy.credentialInjections) {
    if (
      !isPlainObject(injection) ||
      typeof injection.host !== "string" ||
      !injection.host ||
      typeof injection.header !== "string" ||
      !injection.header ||
      typeof injection.credentialRef !== "string" ||
      !/^credref-[a-z0-9][a-z0-9-]{1,127}$/.test(injection.credentialRef)
    )
      throw new EgressPolicyError(
        "each credential injection requires a host, header, and credref-<id> credentialRef",
      );
  }
  return policy;
}

export function evaluateEgress(policy, target = {}) {
  validateEgressPolicy(policy);
  const host = String(target.host ?? "").toLowerCase();
  const port = Number(target.port);
  const scheme = target.scheme ? String(target.scheme).toLowerCase() : null;
  const method = target.method ? String(target.method).toUpperCase() : null;
  const requestPath =
    target.path === undefined || target.path === null ? null : String(target.path);
  for (const entry of policy.entries) {
    if (String(entry.host).toLowerCase() !== host) continue;
    if (Number(entry.port) !== port) continue;
    // A scheme-scoped entry requires an exact scheme match; a scheme-less
    // target never satisfies a scheme-scoped rule.
    if (entry.scheme) {
      if (!scheme || String(entry.scheme).toLowerCase() !== scheme) continue;
    }
    if (Array.isArray(entry.methods) && entry.methods.length) {
      if (!method || !entry.methods.map((value) => String(value).toUpperCase()).includes(method))
        continue;
    }
    if (typeof entry.pathPrefix === "string" && entry.pathPrefix) {
      if (requestPath === null) continue;
      let decodedPath = requestPath;
      try {
        decodedPath = decodeURIComponent(requestPath);
      } catch {
        decodedPath = requestPath;
      }
      const normalizedPath = posix.normalize(decodedPath);
      const normalizedPrefix = posix.normalize(entry.pathPrefix);
      const boundary = normalizedPrefix.endsWith("/") ? normalizedPrefix : `${normalizedPrefix}/`;
      if (normalizedPath !== normalizedPrefix && !normalizedPath.startsWith(boundary)) continue;
    }
    return {
      decision: "allowed",
      reasonCode: "allowlist-match",
      limits: { maxBytes: entry.maxBytes ?? null, timeoutMs: entry.timeoutMs ?? null },
    };
  }
  return { decision: "denied", reasonCode: "default-deny" };
}

// T004: enforce the byte/time budget a matched rule declared. The broker is
// fail-closed: an allowlist match is downgraded to a denial (never forwarded)
// when the request's declared or observed size exceeds maxBytes, or when its
// declared/observed allowed time exceeds the entry's timeoutMs. Absent
// measurement cannot be proven over budget, so it is left to the caller/proxy to
// report counters; a measured overage always denies with a distinct reason code.
//
// T001 (broker listener): the entry `timeoutMs` is the ENFORCEMENT BUDGET, never
// a caller measurement. A caller-supplied `timeoutMs`/`declaredTimeoutMs` is the
// caller's declared budget and an `elapsedMs`/`latencyMs` is observed wall time;
// both are compared against the entry budget, never conflated with it.
export const EGRESS_LIMIT_REASONS = Object.freeze({
  maxBytes: "max-bytes-exceeded",
  timeoutMs: "timeout-exceeded",
});

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = finiteNonNegative(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function measuredRequestBytes(target, meta) {
  const bytesIn = firstFinite(target.bytesIn, meta.bytesIn);
  const bytesOut = firstFinite(target.bytesOut, meta.bytesOut);
  if (bytesIn !== null || bytesOut !== null) return (bytesIn ?? 0) + (bytesOut ?? 0);
  return firstFinite(target.declaredBytes, target.bytes, meta.declaredBytes, meta.bytes);
}

// Caller-declared timeout budget: intent, not observed time.
function declaredRequestMs(target, meta) {
  return firstFinite(
    target.declaredTimeoutMs,
    target.requestTimeoutMs,
    target.allowedMs,
    target.timeoutMs,
    meta.declaredTimeoutMs,
    meta.requestTimeoutMs,
    meta.allowedMs,
    meta.timeoutMs,
  );
}

// Observed elapsed wall time: measurement, never treated as the budget.
function observedRequestMs(target, meta) {
  return firstFinite(
    target.elapsedMs,
    target.latencyMs,
    target.observedElapsedMs,
    meta.elapsedMs,
    meta.latencyMs,
    meta.observedElapsedMs,
  );
}

export function enforceEgressLimits(decision, target = {}, meta = {}) {
  if (decision?.decision !== "allowed") return decision;
  const limits = decision.limits ?? {};
  const maxBytes = finiteNonNegative(limits.maxBytes);
  if (maxBytes !== null) {
    const bytes = measuredRequestBytes(target, meta);
    if (bytes !== null && bytes > maxBytes)
      return { decision: "denied", reasonCode: EGRESS_LIMIT_REASONS.maxBytes, limits };
  }
  const timeoutMs = finiteNonNegative(limits.timeoutMs);
  if (timeoutMs !== null) {
    const elapsedMs = observedRequestMs(target, meta);
    if (elapsedMs !== null && elapsedMs > timeoutMs)
      return { decision: "denied", reasonCode: EGRESS_LIMIT_REASONS.timeoutMs, limits };
    const declaredMs = declaredRequestMs(target, meta);
    if (declaredMs !== null && declaredMs > timeoutMs)
      return { decision: "denied", reasonCode: EGRESS_LIMIT_REASONS.timeoutMs, limits };
  }
  return decision;
}

// Pure, keyed chain verification over an arbitrary record list so an external
// auditor can detect edits, reordering, and wrong-key chains.
export function verifyEgressChain(records, key) {
  if (!Array.isArray(records)) throw new EgressPolicyError("egress chain requires an array");
  if (typeof key !== "string" || key.length < 8)
    throw new EgressPolicyError("egress verify requires a key");
  let previousHash = ZERO_HASH;
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return { valid: false, at: index, why: "record-shape" };
    if (record.previousHash !== previousHash)
      return { valid: false, at: record.sequence, why: "previousHash" };
    const { recordHash, anchor, ...base } = record;
    if (digest(base) !== recordHash)
      return { valid: false, at: record.sequence, why: "recordHash" };
    if (!anchor || typeof anchor !== "object" || !DIGEST_PATTERN.test(anchor.headDigest ?? ""))
      return { valid: false, at: record.sequence, why: "anchor-shape" };
    // The HMAC covers the anchor metadata too, so keyId/algorithm/signedAt/
    // external cannot be mutated without invalidating the chain.
    const expected = `sha256:${createHmac("sha256", key)
      .update(
        `${recordHash}|${record.sequence}|${anchor.algorithm}|${anchor.keyId}|${anchor.signedAt}|${anchor.external}`,
      )
      .digest("hex")}`;
    if (anchor.headDigest !== expected)
      return { valid: false, at: record.sequence, why: "anchor-mac" };
    previousHash = recordHash;
  }
  return { valid: true };
}

export function createEgressLedger({
  runId,
  key,
  keyId = "host-key-1",
  filePath = null,
  publishAnchor = null,
  readAnchor = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof runId !== "string" || !/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(runId))
    throw new EgressPolicyError("egress ledger requires a canonical runId");
  if (typeof key !== "string" || key.length < 8)
    throw new EgressPolicyError("egress ledger requires a key of at least 8 characters");
  if (publishAnchor !== null && typeof publishAnchor !== "function")
    throw new EgressPolicyError("publishAnchor must be a function or null");
  if (readAnchor !== null && typeof readAnchor !== "function")
    throw new EgressPolicyError("readAnchor must be a function or null");
  const records = [];
  // Durability: reload and re-verify an existing on-disk chain before appending.
  if (filePath && existsSync(filePath)) {
    const lines = readFileSync(filePath, "utf8").split("\n");
    // A trailing element without a newline is a torn write; drop it and let the
    // remaining prefix re-verify. A malformed interior line is fail-closed.
    const trailing = lines.pop();
    if (trailing && trailing.trim().length > 0) {
      // torn tail: recover the clean prefix
    }
    const loaded = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new EgressPolicyError(`egress chain line ${index} is malformed`);
      }
      if (record?.schema !== "csm-orchestrate-egress-event/1")
        throw new EgressPolicyError(`egress chain line ${index} has an unknown schema`);
      if (record.runId !== runId)
        throw new EgressPolicyError(`egress chain line ${index} belongs to a different run`);
      loaded.push(record);
    }
    const persisted = verifyEgressChain(loaded, key);
    if (!persisted.valid) throw new EgressPolicyError("existing egress chain failed verification");
    if (readAnchor) {
      const expected = readAnchor();
      const head = loaded.at(-1)?.anchor?.headDigest ?? null;
      if (!expected)
        throw new EgressPolicyError("external anchor returned no head to reconcile against");
      if (expected !== head)
        throw new EgressPolicyError(
          "existing egress chain head does not match the external anchor",
        );
    }
    records.push(...loaded);
  }

  const anchorMac = (recordHash, sequence, anchor) =>
    `sha256:${createHmac("sha256", key)
      .update(
        `${recordHash}|${sequence}|${anchor.algorithm}|${anchor.keyId}|${anchor.signedAt}|${anchor.external}`,
      )
      .digest("hex")}`;

  function append(input = {}) {
    if (!["allowed", "denied", "dropped-unmediated"].includes(input.decision))
      throw new EgressPolicyError("egress record requires a valid decision");
    if (typeof input.targetHost !== "string" || !input.targetHost)
      throw new EgressPolicyError("egress record requires targetHost");
    if (!Number.isInteger(input.targetPort) || input.targetPort < 1 || input.targetPort > 65535)
      throw new EgressPolicyError("egress record requires a valid targetPort");
    if (
      input.credentialRef !== undefined &&
      input.credentialRef !== null &&
      !/^credref-[a-z0-9][a-z0-9-]{1,127}$/.test(input.credentialRef)
    )
      throw new EgressPolicyError("credentialRef must match credref-<id>");
    const previousHash = records.length ? records.at(-1).recordHash : ZERO_HASH;
    const sequence = records.length;
    const base = {
      schema: "csm-orchestrate-egress-event/1",
      schemaRevision: 1,
      sequence,
      previousHash,
      runId,
      decision: input.decision,
      scheme: input.scheme ?? null,
      targetHost: input.targetHost,
      targetOrigin: input.targetOrigin ?? null,
      targetPort: input.targetPort,
      requestMethod: input.requestMethod ?? null,
      requestPath: input.requestPath ?? null,
      bytesIn: input.bytesIn ?? null,
      bytesOut: input.bytesOut ?? null,
      latencyMs: input.latencyMs ?? null,
      reasonCode: input.reasonCode ?? null,
      policyDigest: input.policyDigest ?? `sha256:${"0".repeat(64)}`,
      credentialRef: input.credentialRef ?? null,
      taskId: input.taskId ?? null,
      workerId: input.workerId ?? null,
      invocationId: input.invocationId ?? null,
      attempt: input.attempt ?? 0,
      timestamp: input.timestamp ?? now(),
    };
    const recordHash = digest(base);
    const anchorMeta = {
      algorithm: "hmac-sha256",
      keyId,
      signedAt: now(),
      external: true,
    };
    const record = {
      ...base,
      recordHash,
      anchor: { ...anchorMeta, headDigest: anchorMac(recordHash, sequence, anchorMeta) },
    };
    // Fail closed: a record is not accepted unless its keyed head is anchored
    // (when an anchor is configured) and durably persisted.
    if (publishAnchor) {
      try {
        publishAnchor({ headDigest: record.anchor.headDigest, sequence: record.sequence });
      } catch (error) {
        throw new EgressPolicyError(
          `egress anchor publication failed: ${String(error?.message ?? error)}`,
        );
      }
    }
    if (filePath) durableAppend(filePath, `${JSON.stringify(record)}\n`);
    records.push(record);
    return record;
  }

  function verify() {
    return verifyEgressChain(records, key);
  }

  return {
    append,
    verify,
    records: () => records.map((record) => ({ ...record })),
    length: () => records.length,
  };
}

export function createEgressBroker({
  policy,
  ledger,
  emitter = null,
  policyDigest = null,
  credentials = {},
} = {}) {
  validateEgressPolicy(policy);
  if (!ledger || typeof ledger.append !== "function")
    throw new EgressPolicyError("egress broker requires a ledger");
  if (!isPlainObject(credentials))
    throw new EgressPolicyError("broker credentials must be an object of credentialRef -> secret");
  const injectionByHost = new Map(
    (policy.credentialInjections ?? []).map((injection) => [
      String(injection.host).toLowerCase(),
      injection,
    ]),
  );
  function emit(decision, target, meta) {
    if (!emitter || typeof emitter.emit !== "function") return;
    emitter.emit({
      eventType: "egress.decision",
      taskId: meta.taskId ?? null,
      workerId: meta.workerId ?? null,
      invocationId: meta.invocationId ?? null,
      payload: {
        decision,
        targetHost: target.host,
        targetOrigin: target.origin ?? null,
        reasonCode: meta.reasonCode ?? null,
        credentialRef: meta.credentialRef ?? null,
      },
    });
  }
  // Pure decision: policy match + budget enforcement + credential resolution.
  // No ledger write and no emission, so a transport listener can forward first
  // and then record the real (allow/timeout) outcome exactly once.
  function decide(target = {}, meta = {}) {
    // T004: enforce the matched rule's declared byte/time budgets before the
    // request can be forwarded or credentialed.
    let decision = enforceEgressLimits(evaluateEgress(policy, target), target, meta);
    // Credentials are held broker-side and injected only after a successful
    // allowlist match; only the opaque ref is ever logged. A configured
    // injection with no available secret fails closed rather than allowing
    // an unauthenticated request.
    let injection = null;
    let auditCredentialRef = meta.credentialRef ?? null;
    if (decision.decision === "allowed") {
      const rule = injectionByHost.get(String(target.host ?? "").toLowerCase());
      if (rule) {
        auditCredentialRef = rule.credentialRef;
        const secret = credentials[rule.credentialRef];
        if (typeof secret === "string" && secret.length > 0)
          injection = { header: rule.header, value: secret };
        else decision = { decision: "denied", reasonCode: "credential-unavailable" };
      }
    }
    return { ...decision, injection, credentialRef: auditCredentialRef };
  }

  // Single authoritative ledger write + correlated telemetry for a decision.
  function record(decided, target = {}, meta = {}) {
    const recordRow = ledger.append({
      decision: decided.decision,
      scheme: target.scheme,
      targetHost: target.host,
      targetOrigin: target.origin ?? null,
      targetPort: target.port,
      requestMethod: target.method,
      requestPath: target.path,
      bytesIn: firstFinite(target.bytesIn, meta.bytesIn),
      bytesOut: firstFinite(target.bytesOut, meta.bytesOut),
      latencyMs: firstFinite(
        decided.elapsedMs,
        target.latencyMs,
        target.elapsedMs,
        meta.latencyMs,
        meta.elapsedMs,
      ),
      reasonCode: decided.reasonCode,
      policyDigest,
      credentialRef: decided.credentialRef,
      taskId: meta.taskId ?? null,
      workerId: meta.workerId ?? null,
      invocationId: meta.invocationId ?? null,
      attempt: meta.attempt ?? 0,
    });
    emit(decided.decision, target, { ...meta, reasonCode: decided.reasonCode });
    return recordRow;
  }

  return {
    decide,
    record,
    async handle(target = {}, meta = {}) {
      const decided = decide(target, meta);
      const recordRow = record(decided, target, meta);
      const { injection, credentialRef: _credentialRef, ...decision } = decided;
      return { ...decision, record: recordRow, injection };
    },
    // Network-layer drops (kernel-dropped / out-of-band attempts that never
    // reach the app broker) are recorded into the same chain.
    recordDrop({ targetHost, targetPort, reasonCode = "kernel-drop", ...meta } = {}) {
      const recordRow = ledger.append({
        decision: "dropped-unmediated",
        targetHost,
        targetPort,
        reasonCode,
        policyDigest,
        taskId: meta.taskId ?? null,
        workerId: meta.workerId ?? null,
        invocationId: meta.invocationId ?? null,
        attempt: meta.attempt ?? 0,
      });
      emit("dropped-unmediated", { host: targetHost }, { ...meta, reasonCode });
      return recordRow;
    },
    verify: () => ledger.verify(),
  };
}

// Strip a resolved credential injection from a decision before it is returned to
// the worker: only the opaque credentialRef may cross the listener boundary.
function withoutSecret(decided) {
  const { injection: _injection, ...safe } = decided;
  return { ...safe, injection: null };
}

// T001 (broker listener): a policy-bound listener on the wire. The worker talks
// only to this listener on the internal (worker-facing) network; the listener
// forwards allowed requests to the upstream reached through the host's egress
// network, so policy and credential refs stay host-side. The transport is
// injected (`forward`) so the listener is pure and testable without Docker.
//
// The matched rule's `timeoutMs` is the ENFORCEMENT BUDGET: a forward that
// exceeds it is aborted and denied with the distinct `timeout-exceeded` reason
// code. Credentials from `decide` are injected into the forwarded request only
// on allow and are never returned on a denial.
export function createEgressBrokerListener({
  broker = null,
  forward,
  now = () => Date.now(),
  ...brokerOptions
} = {}) {
  const activeBroker = broker ?? createEgressBroker(brokerOptions);
  if (typeof activeBroker.decide !== "function" || typeof activeBroker.record !== "function")
    throw new EgressPolicyError("egress broker listener requires a broker with decide/record");
  if (typeof forward !== "function")
    throw new EgressPolicyError("egress broker listener requires a forward function");
  return {
    async handle(request = {}, meta = {}) {
      const target = request.target ?? request;
      let decided = activeBroker.decide(target, meta);
      if (decided.decision !== "allowed")
        return {
          ...withoutSecret(decided),
          upstream: null,
          record: activeBroker.record(decided, target, meta),
          elapsedMs: null,
        };

      const budgetMs = finiteNonNegative(decided.limits?.timeoutMs);
      const controller = new AbortController();
      let timedOut = false;
      let timer = null;
      if (budgetMs !== null) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, budgetMs);
      }
      const headers = { ...request.headers };
      if (decided.injection) headers[decided.injection.header] = decided.injection.value;
      const startedAt = now();
      let upstream = null;
      try {
        upstream = await forward({
          target,
          method: target.method ?? "GET",
          headers,
          body: request.body ?? null,
          signal: controller.signal,
        });
      } catch (error) {
        if (!timedOut) {
          if (timer) clearTimeout(timer);
          throw error;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      const elapsedMs = Math.max(0, now() - startedAt);
      if (timedOut) {
        decided = {
          decision: "denied",
          reasonCode: EGRESS_LIMIT_REASONS.timeoutMs,
          limits: decided.limits,
          injection: null,
          credentialRef: decided.credentialRef,
        };
        return {
          ...withoutSecret(decided),
          upstream: null,
          record: activeBroker.record(decided, target, meta),
          elapsedMs,
        };
      }
      decided = { ...decided, elapsedMs };
      return {
        ...withoutSecret(decided),
        upstream,
        record: activeBroker.record(decided, target, meta),
        elapsedMs,
      };
    },
  };
}
