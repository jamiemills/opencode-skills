"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../lib/schema-runtime/index.mjs";
import {
  ATTESTATION_KINDS,
  ATTESTATION_SCHEMA_ID,
  attestationDigestOf,
  createAttestation,
  createHostAttestation,
  createReviewerAttestation,
  createValidatorAttestation,
  verifyAttestation,
} from "../../csm-orchestrate/lib/attestation.mjs";
import { attestationFields, schemaValidatorFor, verificationContext } from "./helpers.mjs";

test("attestation: host, reviewer, and validator envelopes bind every required field", () => {
  const host = createHostAttestation(attestationFields());
  const reviewer = createReviewerAttestation(
    attestationFields({ issuer: "reviewer:independent-1", subject: "run-reviewed-run-1" }),
  );
  const validator = createValidatorAttestation(
    attestationFields({ issuer: "validator:signal-1", subject: "run-validated-run-1" }),
  );
  for (const attestation of [host, reviewer, validator]) {
    assert.equal(attestation.schema, ATTESTATION_SCHEMA_ID);
    assert.ok(ATTESTATION_KINDS.includes(attestation.kind));
    assert.equal(attestation.keyEpoch, 1);
    assert.ok(attestation.attestationId.startsWith("att-"));
    assert.ok(attestation.nonce.length >= 16);
    const { attestationDigest: _omitted, ...bound } = attestation;
    assert.equal(attestation.attestationDigest, digest(bound));
    assert.ok(Object.isFrozen(attestation));
  }
  assert.equal(host.kind, "host");
  assert.equal(reviewer.kind, "reviewer");
  assert.equal(validator.kind, "validator");
});

test("attestation: structural verification accepts a fresh envelope for the right audience", () => {
  const attestation = createAttestation(attestationFields({ kind: "host" }));
  const context = verificationContext({ nonceLog: new Set() });
  assert.deepEqual(verifyAttestation(attestation, context), { valid: true });
  assert.equal(attestation.nonce.length >= 16, true);
});

test("attestation: wrong audience is rejected", () => {
  const attestation = createHostAttestation(attestationFields({ audience: "some-other-service" }));
  const result = verifyAttestation(attestation, verificationContext());
  assert.equal(result.valid, false);
  assert.equal(result.code, "wrong-audience");
});

test("attestation: expired envelopes are rejected", () => {
  const attestation = createHostAttestation(
    attestationFields({
      issuedAt: new Date("2026-08-27T00:00:00.000Z").toISOString(),
      expiresAt: new Date("2026-08-27T00:01:00.000Z").toISOString(),
    }),
  );
  const result = verifyAttestation(attestation, verificationContext());
  assert.equal(result.valid, false);
  assert.equal(result.code, "expired");
});

test("attestation: wrong request, input-set, or policy digest is rejected", () => {
  const attestation = createHostAttestation(attestationFields());
  for (const field of ["requestDigest", "inputSetDigest", "policyDigest"]) {
    const result = verifyAttestation(
      attestation,
      verificationContext({ [field]: digest({ tampered: field }) }),
    );
    assert.equal(result.valid, false, field);
    assert.equal(result.code, "digest-mismatch", field);
  }
});

test("attestation: reused nonces are rejected and fresh nonces are consumed once", () => {
  const nonceLog = new Set();
  const first = createHostAttestation(attestationFields());
  const second = createHostAttestation(attestationFields({ nonce: first.nonce }));
  assert.equal(verifyAttestation(first, verificationContext({ nonceLog })).valid, true);
  const replay = verifyAttestation(second, verificationContext({ nonceLog }));
  assert.equal(replay.valid, false);
  assert.equal(replay.code, "nonce-reused");
});

test("attestation: missing issuer is rejected even with a recomputed envelope digest", () => {
  const attestation = createHostAttestation(attestationFields());
  const { issuer: _removed, ...forged } = attestation;
  const noIssuer = { ...forged, attestationDigest: attestationDigestOf(forged) };
  const result = verifyAttestation(noIssuer, verificationContext());
  assert.equal(result.valid, false);
  assert.equal(result.code, "missing-issuer");
});

test("attestation: tampered envelopes fail the structural digest binding", () => {
  const attestation = createHostAttestation(attestationFields());
  const tampered = { ...attestation, result: { status: "completed", outcome: "forged" } };
  const result = verifyAttestation(tampered, verificationContext());
  assert.equal(result.valid, false);
  assert.equal(result.code, "digest-mismatch");
});

test("attestation: structural problems fail closed", () => {
  const badKind = verifyAttestation(
    { ...createHostAttestation(attestationFields()), kind: "ghost" },
    verificationContext(),
  );
  assert.equal(badKind.valid, false);
  assert.equal(badKind.code, "invalid-structure");
  const badDigest = verifyAttestation(
    { ...createHostAttestation(attestationFields()), requestDigest: "sha256:zz" },
    verificationContext(),
  );
  assert.equal(badDigest.valid, false);
  assert.equal(badDigest.code, "invalid-structure");
  const notAnObject = verifyAttestation("nope", verificationContext());
  assert.equal(notAnObject.valid, false);
  assert.equal(notAnObject.code, "invalid-structure");
});

test("attestation: creation rejects malformed fields", () => {
  assert.throws(() => createHostAttestation(attestationFields({ nonce: "short" })), /nonce/);
  assert.throws(
    () => createHostAttestation(attestationFields({ subject: "not-an-id" })),
    /subject/,
  );
  assert.throws(() => createHostAttestation(attestationFields({ keyEpoch: 0 })), /keyEpoch/);
  assert.throws(
    () =>
      createHostAttestation(
        attestationFields({
          issuedAt: new Date("2026-08-28T00:01:00.000Z").toISOString(),
          expiresAt: new Date("2026-08-28T00:00:00.000Z").toISOString(),
        }),
      ),
    /expiresAt/,
  );
});

test("attestation: schema parity — envelopes validate against the registered schema", async () => {
  const { schema, validator } = await schemaValidatorFor("attestation.schema.json");
  assert.equal(schema.$id, ATTESTATION_SCHEMA_ID);
  const attestation = createValidatorAttestation(attestationFields());
  assert.equal(validator.validate(ATTESTATION_SCHEMA_ID, attestation).valid, true);
  const { issuer: _removed, ...forged } = attestation;
  const schemaResult = validator.validate(ATTESTATION_SCHEMA_ID, forged);
  assert.equal(schemaResult.valid, false);
});
