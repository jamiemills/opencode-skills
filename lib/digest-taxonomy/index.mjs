"use strict";

import { createHash } from "node:crypto";
import { canonicalize } from "../schema-runtime/index.mjs";

export const DIGEST_FIELDS = Object.freeze([
  "fileDigest",
  "payloadDigest",
  "sourceDigest",
  "descriptorDigest",
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function digestBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
    throw new TypeError("fileDigest input must be bytes");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function without(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("digest input must be an object");
  const excluded = new Set(Array.isArray(fields) ? fields : [fields]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

export function payloadDigest(payload) {
  // Digest metadata describes the descriptor, not its canonical payload.
  return digestValueWithout(payload, ["payloadDigest", "descriptorDigest", "fileDigest"]);
}

export function descriptorDigest(descriptor) {
  return digestValueWithout(descriptor, "descriptorDigest");
}

function digestValueWithout(value, field) {
  return `sha256:${createHash("sha256")
    .update(canonicalize(without(value, field)), "utf8")
    .digest("hex")}`;
}

export function assertDigest(value, field) {
  if (!DIGEST_FIELDS.includes(field)) throw new TypeError(`unknown digest field: ${field}`);
  if (!DIGEST_PATTERN.test(value ?? ""))
    throw Object.assign(new TypeError(`${field} must be a sha256 digest`), {
      code: "invalid-${field}",
    });
  return value;
}

export function validateDigestTaxonomy(value, { required = [], source } = {}) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { valid: false, errors: ["digest-bearing value must be an object"] };
  for (const field of required) {
    if (!DIGEST_FIELDS.includes(field)) errors.push(`unknown digest field: ${field}`);
    else if (!Object.hasOwn(value, field)) errors.push(`${field} is required`);
    else if (!DIGEST_PATTERN.test(value[field])) errors.push(`${field} is invalid`);
  }
  if (
    Object.hasOwn(value, "fileDigest") &&
    source?.fileDigest !== undefined &&
    value.fileDigest !== source.fileDigest
  )
    errors.push("fileDigest does not match serialized bytes");
  if (Object.hasOwn(value, "payloadDigest") && value.payloadDigest !== payloadDigest(value))
    errors.push("payloadDigest does not match canonical payload");
  if (
    Object.hasOwn(value, "descriptorDigest") &&
    value.descriptorDigest !== descriptorDigest(value)
  )
    errors.push("descriptorDigest does not match canonical descriptor");
  return { valid: errors.length === 0, errors };
}

export function legacyDigestFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fields = [];
  if (Object.hasOwn(value, "digest")) fields.push("digest");
  if (Object.hasOwn(value.provenance ?? {}, "sourceDigest")) fields.push("provenance.sourceDigest");
  if (Array.isArray(value.provenance?.sourceDigests)) fields.push("provenance.sourceDigests");
  if (Object.hasOwn(value.sourcePlan ?? {}, "planDigest")) fields.push("sourcePlan.planDigest");
  return fields;
}

export function legacyDigestAdapter(field) {
  assertDigest("sha256:" + "0".repeat(64), field);
  return Object.freeze({
    status: "migration-required",
    code: "ambiguous-legacy-digest",
    field,
    message: `legacy digest must be explicitly migrated to ${field}`,
  });
}
