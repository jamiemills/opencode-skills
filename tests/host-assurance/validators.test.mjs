"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../lib/schema-runtime/index.mjs";
import {
  PREDICATE_TYPES,
  VALIDATOR_SCHEMA_ID,
  createSignalValidator,
  deterministicDigestMatch,
  deterministicSchemaValid,
  deterministicStringContains,
  validateSignal,
} from "../../csm-orchestrate/lib/validators.mjs";
import { schemaValidatorFor, sha } from "./helpers.mjs";

const policyDigest = sha({ policy: "signal-validators" });

function stringContainsValidator(pattern) {
  return createSignalValidator({
    signalId: "signal-acceptance-text",
    validatorId: "validator-contains-1",
    version: 1,
    inputSchema: { type: "object" },
    predicate: { type: "string-contains", pattern },
    policyDigest,
  });
}

function schemaValidValidator(inputSchema) {
  return createSignalValidator({
    signalId: "signal-artifact-shape",
    validatorId: "validator-schema-1",
    version: 2,
    inputSchema,
    predicate: { type: "schema-valid" },
    policyDigest,
  });
}

function digestMatchValidator(expectedDigest) {
  return createSignalValidator({
    signalId: "signal-artifact-digest",
    validatorId: "validator-digest-1",
    version: 1,
    inputSchema: { type: "object" },
    predicate: { type: "digest-match", expectedDigest },
    policyDigest,
  });
}

test("validators: definitions are bound by a canonical validator digest", () => {
  const validator = stringContainsValidator("technical pass");
  assert.equal(validator.schema, VALIDATOR_SCHEMA_ID);
  assert.equal(validator.predicate.type, "string-contains");
  const { validatorDigest: _omitted, ...bound } = validator;
  assert.equal(validator.validatorDigest, digest(bound));
  assert.ok(Object.isFrozen(validator));
});

test("validators: validateSignal passes and fails on actual artifact data", () => {
  const validator = stringContainsValidator("technical pass");
  const pass = validateSignal(validator, {
    artifactId: "art-evidence-1",
    value: { acceptance: "technical pass recorded" },
  });
  assert.equal(pass.result, "pass");
  assert.equal(pass.signalId, validator.signalId);
  assert.equal(pass.validatorVersion, 1);
  assert.equal(pass.artifactDigest, digest({ acceptance: "technical pass recorded" }));
  const fail = validateSignal(validator, {
    artifactId: "art-evidence-2",
    value: { acceptance: "functional fail recorded" },
  });
  assert.equal(fail.result, "fail");
  assert.notEqual(fail.artifactDigest, pass.artifactDigest);
});

test("validators: producer-supplied pass metadata is never authoritative", () => {
  const validator = stringContainsValidator("technical pass");
  const hostile = validateSignal(
    validator,
    {
      artifactId: "art-hostile-1",
      producerClaim: "pass",
      producerResult: "pass",
      value: { acceptance: "producer says pass but data does not" },
    },
    { now: "2026-08-28T00:00:00.000Z" },
  );
  assert.equal(hostile.result, "fail");
  assert.equal(hostile.evaluatedAt, "2026-08-28T00:00:00.000Z");
  const understated = validateSignal(validator, {
    artifactId: "art-hostile-2",
    producerClaim: "fail",
    value: { acceptance: "technical pass present in data" },
  });
  assert.equal(understated.result, "pass");
});

test("validators: schema-valid predicate evaluates the input schema over the snapshot", () => {
  const validator = schemaValidValidator({
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: { status: { enum: ["pass", "fail"] } },
  });
  const pass = validateSignal(validator, { artifactId: "art-shape-1", value: { status: "pass" } });
  assert.equal(pass.result, "pass");
  const fail = validateSignal(validator, {
    artifactId: "art-shape-2",
    value: { status: "unknown", extra: true },
  });
  assert.equal(fail.result, "fail");
});

test("validators: digest-match predicate binds the artifact value digest", () => {
  const value = { evidence: "canonical-bytes" };
  const validator = digestMatchValidator(digest(value));
  const pass = validateSignal(validator, { artifactId: "art-digest-1", value });
  assert.equal(pass.result, "pass");
  const fail = validateSignal(validator, {
    artifactId: "art-digest-2",
    value: { evidence: "tampered-bytes" },
  });
  assert.equal(fail.result, "fail");
  assert.equal(fail.artifactDigest, digest({ evidence: "tampered-bytes" }));
});

test("validators: tampered validator definitions are rejected", () => {
  const validator = stringContainsValidator("technical pass");
  const tampered = {
    ...validator,
    predicate: { type: "string-contains", pattern: "functional pass" },
  };
  assert.throws(() => validateSignal(tampered, { artifactId: "art-any", value: {} }), /tampered/);
  assert.throws(
    () => validateSignal({ signalId: "signal-x" }, { artifactId: "art-any", value: {} }),
    /tampered/,
  );
});

test("validators: malformed definitions and snapshots fail closed", () => {
  assert.throws(
    () =>
      createSignalValidator({
        signalId: "signal-bad",
        validatorId: "validator-bad",
        version: 0,
        inputSchema: { type: "object" },
        predicate: { type: "digest-match" },
        policyDigest,
      }),
    /invalid validator definition/,
  );
  assert.throws(
    () => createSignalValidator({ signalId: "signal-bad", predicate: { type: "unknown" } }),
    /invalid validator definition/,
  );
  const validator = stringContainsValidator("x");
  assert.throws(() => validateSignal(validator, { artifactId: "art-x" }), /snapshot/);
  assert.throws(() => validateSignal(validator, "not-a-snapshot"), /snapshot/);
  assert.throws(
    () => validateSignal(validator, { artifactId: "art-x", value: {}, fileDigest: "sha256:zz" }),
    /fileDigest/,
  );
});

test("validators: example evaluators are deterministic and self-contained", () => {
  const artifact = { value: { note: "needle present" } };
  assert.equal(deterministicStringContains(artifact, "needle"), true);
  assert.equal(deterministicStringContains(artifact, "absent"), false);
  assert.equal(deterministicStringContains({ note: "needle present" }, "needle"), true);
  assert.equal(deterministicSchemaValid(artifact, { type: "object", required: ["note"] }), true);
  assert.equal(deterministicSchemaValid(artifact, { type: "array" }), false);
  assert.equal(deterministicDigestMatch(artifact, digest({ note: "needle present" })), true);
  assert.equal(deterministicDigestMatch(artifact, digest({ note: "other" })), false);
  assert.throws(() => deterministicStringContains(artifact, ""), /pattern/);
  assert.throws(() => deterministicDigestMatch(artifact, "not-a-digest"), /expectedDigest/);
});

test("validators: schema parity — definitions validate against the registered schema", async () => {
  const { schema, validator: schemaCheck } = await schemaValidatorFor("validator.schema.json");
  assert.equal(schema.$id, VALIDATOR_SCHEMA_ID);
  const validator = digestMatchValidator(digest({ a: 1 }));
  assert.equal(schemaCheck.validate(VALIDATOR_SCHEMA_ID, validator).valid, true);
  for (const predicateType of PREDICATE_TYPES) {
    assert.equal(typeof predicateType, "string");
  }
  const broken = { ...validator, predicate: { type: "remote-execution" } };
  assert.equal(schemaCheck.validate(VALIDATOR_SCHEMA_ID, broken).valid, false);
});
