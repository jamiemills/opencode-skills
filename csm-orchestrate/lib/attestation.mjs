"use strict";

import { randomUUID } from "node:crypto";
import { digest } from "../../lib/schema-runtime/index.mjs";

export const ATTESTATION_SCHEMA_ID = "csm-orchestrate-attestation/1";
export const ATTESTATION_KINDS = Object.freeze(["host", "reviewer", "validator"]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ATTESTATION_ID_PATTERN = /^att-[a-z0-9][a-z0-9-]{1,127}$/;
const SUBJECT_PATTERN = /^(?:run|phase|edge|cursor)-[a-z0-9][a-z0-9-]{1,127}$/;
const DEFAULT_TTL_MS = 300_000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} is not a valid date`);
  return date;
}

function optionalDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveNow(now) {
  if (typeof now === "function") return isoDate(now(), "now");
  if (now === undefined || now === null) return new Date();
  return isoDate(now, "now");
}

function envelopeProblems(envelope) {
  const problems = [];
  const push = (problem) => problems.push(problem);
  if (envelope.schema !== ATTESTATION_SCHEMA_ID)
    push("schema must be csm-orchestrate-attestation/1");
  if (!ATTESTATION_ID_PATTERN.test(String(envelope.attestationId ?? "")))
    push("attestationId must match att-<lowercase-hyphen-id>");
  if (!ATTESTATION_KINDS.includes(envelope.kind)) push("kind must be host, reviewer, or validator");
  if (
    typeof envelope.issuer !== "string" ||
    envelope.issuer.length < 1 ||
    envelope.issuer.length > 256
  )
    push("issuer is required");
  if (!SUBJECT_PATTERN.test(String(envelope.subject ?? "")))
    push("subject must be a run-/phase-/edge-/cursor- id");
  if (
    typeof envelope.audience !== "string" ||
    envelope.audience.length < 1 ||
    envelope.audience.length > 256
  )
    push("audience is required");
  for (const field of ["requestDigest", "inputSetDigest", "policyDigest"]) {
    if (!DIGEST_PATTERN.test(String(envelope[field] ?? "")))
      push(`${field} must be a sha256 digest`);
  }
  if (!Object.hasOwn(envelope, "result")) push("result is required");
  if (
    typeof envelope.nonce !== "string" ||
    envelope.nonce.length < 16 ||
    envelope.nonce.length > 128
  )
    push("nonce must be a 16-128 character string");
  const issuedAt = optionalDate(envelope.issuedAt);
  const expiresAt = optionalDate(envelope.expiresAt);
  if (issuedAt === null) push("issuedAt is not a valid date");
  if (expiresAt === null) push("expiresAt is not a valid date");
  if (issuedAt !== null && expiresAt !== null && expiresAt.getTime() <= issuedAt.getTime())
    push("expiresAt must be after issuedAt");
  if (!Number.isInteger(envelope.keyEpoch) || envelope.keyEpoch < 1)
    push("keyEpoch must be an integer >= 1");
  if (!DIGEST_PATTERN.test(String(envelope.attestationDigest ?? "")))
    push("attestationDigest must be a sha256 digest");
  return problems;
}

export function attestationDigestOf(envelope) {
  if (!isPlainObject(envelope)) throw new TypeError("attestation must be an object");
  const { attestationDigest: _omitted, ...bound } = envelope;
  return digest(bound);
}

export function createAttestation(fields = {}) {
  if (!isPlainObject(fields)) throw new TypeError("attestation fields must be an object");
  const issuedAt =
    fields.issuedAt !== undefined ? isoDate(fields.issuedAt, "issuedAt") : resolveNow(fields.now);
  const expiresAt =
    fields.expiresAt !== undefined
      ? isoDate(fields.expiresAt, "expiresAt")
      : new Date(issuedAt.getTime() + DEFAULT_TTL_MS);
  const envelope = {
    schema: ATTESTATION_SCHEMA_ID,
    attestationId: fields.attestationId ?? `att-${randomUUID()}`,
    kind: fields.kind,
    issuer: fields.issuer,
    subject: fields.subject,
    audience: fields.audience,
    requestDigest: fields.requestDigest,
    inputSetDigest: fields.inputSetDigest,
    policyDigest: fields.policyDigest,
    result: fields.result,
    nonce: fields.nonce ?? `n-${randomUUID()}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    keyEpoch: fields.keyEpoch ?? 1,
  };
  const attestationDigest = attestationDigestOf(envelope);
  const problems = envelopeProblems({ ...envelope, attestationDigest });
  if (problems.length > 0) throw new TypeError(`invalid attestation: ${problems.join("; ")}`);
  return Object.freeze({ ...envelope, attestationDigest });
}

export function createHostAttestation(fields = {}) {
  return createAttestation({ ...fields, kind: "host" });
}

export function createReviewerAttestation(fields = {}) {
  return createAttestation({ ...fields, kind: "reviewer" });
}

export function createValidatorAttestation(fields = {}) {
  return createAttestation({ ...fields, kind: "validator" });
}

export function verifyAttestation(attestation, context = {}) {
  if (!isPlainObject(attestation)) {
    return { valid: false, code: "invalid-structure", message: "attestation must be an object" };
  }
  if (typeof attestation.issuer !== "string" || attestation.issuer.length < 1) {
    return { valid: false, code: "missing-issuer", message: "attestation has no issuer" };
  }
  const problems = envelopeProblems(attestation);
  if (problems.length > 0) {
    return { valid: false, code: "invalid-structure", message: problems.join("; ") };
  }
  if (attestationDigestOf(attestation) !== attestation.attestationDigest) {
    return {
      valid: false,
      code: "digest-mismatch",
      message: "attestationDigest does not bind the envelope contents",
    };
  }
  if (context.audience !== undefined && attestation.audience !== context.audience) {
    return {
      valid: false,
      code: "wrong-audience",
      message: `attestation audience ${attestation.audience} is not ${context.audience}`,
    };
  }
  const now = resolveNow(context.now);
  if (isoDate(attestation.expiresAt, "expiresAt").getTime() <= now.getTime()) {
    return { valid: false, code: "expired", message: "attestation expired" };
  }
  for (const field of ["requestDigest", "inputSetDigest", "policyDigest"]) {
    if (context[field] !== undefined && attestation[field] !== context[field]) {
      return {
        valid: false,
        code: "digest-mismatch",
        message: `${field} does not match the expected canonical digest`,
      };
    }
  }
  if (context.keyEpoch !== undefined && attestation.keyEpoch !== context.keyEpoch) {
    return {
      valid: false,
      code: "key-epoch-mismatch",
      message: `key epoch ${attestation.keyEpoch} is not the expected ${context.keyEpoch}`,
    };
  }
  if (context.nonceLog !== undefined) {
    if (typeof context.nonceLog.has !== "function" || typeof context.nonceLog.add !== "function") {
      throw new TypeError("nonceLog must be a Set-like with has() and add()");
    }
    if (context.nonceLog.has(attestation.nonce)) {
      return { valid: false, code: "nonce-reused", message: "nonce was already consumed" };
    }
    context.nonceLog.add(attestation.nonce);
  }
  return { valid: true };
}

export default {
  ATTESTATION_SCHEMA_ID,
  ATTESTATION_KINDS,
  attestationDigestOf,
  createAttestation,
  createHostAttestation,
  createReviewerAttestation,
  createValidatorAttestation,
  verifyAttestation,
};
