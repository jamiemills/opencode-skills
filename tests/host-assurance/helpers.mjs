"use strict";

import { readFile } from "node:fs/promises";
import { createSchemaValidator, digest, parseJson } from "../../lib/schema-runtime/index.mjs";

export async function loadSchema(file) {
  const schema = parseJson(
    await readFile(new URL(`../../csm-orchestrate/schemas/${file}`, import.meta.url), "utf8"),
  );
  return schema;
}

export async function schemaValidatorFor(file) {
  const schema = await loadSchema(file);
  return { schema, validator: createSchemaValidator({ schemas: [schema] }) };
}

export const sha = (value) => digest(value);

export const digests = () => ({
  requestDigest: sha({ canonical: "request" }),
  inputSetDigest: sha({ canonical: "inputs" }),
  policyDigest: sha({ canonical: "policy" }),
});

export const FIXED_NOW = new Date("2026-08-28T00:00:00.000Z");

export function attestationFields(overrides = {}) {
  const { requestDigest, inputSetDigest, policyDigest } = digests();
  return {
    issuer: "host:test-anchor",
    subject: "run-host-assurance-child-1",
    audience: "csm-orchestrate-controller",
    requestDigest,
    inputSetDigest,
    policyDigest,
    result: { status: "completed", outcome: "pass" },
    nonce: "n-fixed-nonce-0123456789",
    issuedAt: FIXED_NOW.toISOString(),
    expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
    keyEpoch: 1,
    ...overrides,
  };
}

export function verificationContext(overrides = {}) {
  const { requestDigest, inputSetDigest, policyDigest } = digests();
  return {
    audience: "csm-orchestrate-controller",
    requestDigest,
    inputSetDigest,
    policyDigest,
    keyEpoch: 1,
    now: FIXED_NOW,
    ...overrides,
  };
}
