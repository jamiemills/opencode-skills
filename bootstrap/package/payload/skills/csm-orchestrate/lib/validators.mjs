"use strict";

import { canonicalize, createSchemaValidator, digest } from "../../../lib/schema-runtime/index.mjs";

export const VALIDATOR_SCHEMA_ID = "csm-orchestrate-validator/1";
export const VALIDATOR_RESULT_SCHEMA_ID = "csm-orchestrate-validator-result/1";
export const PREDICATE_TYPES = Object.freeze(["string-contains", "schema-valid", "digest-match"]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SIGNAL_ID_PATTERN = /^signal-[a-z0-9][a-z0-9-]{1,127}$/;
const VALIDATOR_ID_PATTERN = /^validator-[a-z0-9][a-z0-9-]{1,127}$/;
const ARTIFACT_ID_PATTERN = /^art-[a-z0-9][a-z0-9-]{1,127}$/;

const inputSchemaValidators = new Map();

function inputSchemaValidatorFor(schema) {
  const key = canonicalize(schema);
  let entry = inputSchemaValidators.get(key);
  if (entry === undefined) {
    const id = `csm-orchestrate-validator-input/${digest(schema).slice("sha256:".length, "sha256:".length + 12)}`;
    entry = { id, validator: createSchemaValidator({ schemas: [{ $id: id, allOf: [schema] }] }) };
    inputSchemaValidators.set(key, entry);
  }
  return entry;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function definitionProblems(definition) {
  const problems = [];
  if (definition.schema !== undefined && definition.schema !== VALIDATOR_SCHEMA_ID)
    problems.push("schema must be csm-orchestrate-validator/1");
  if (!SIGNAL_ID_PATTERN.test(String(definition.signalId ?? "")))
    problems.push("signalId must match signal-<lowercase-hyphen-id>");
  if (!VALIDATOR_ID_PATTERN.test(String(definition.validatorId ?? "")))
    problems.push("validatorId must match validator-<lowercase-hyphen-id>");
  if (!Number.isInteger(definition.version) || definition.version < 1)
    problems.push("version must be an integer >= 1");
  if (!isPlainObject(definition.inputSchema) && typeof definition.inputSchema !== "boolean")
    problems.push("inputSchema must be a JSON Schema object or boolean");
  if (!isPlainObject(definition.predicate)) problems.push("predicate must be an object");
  else {
    if (!PREDICATE_TYPES.includes(definition.predicate.type))
      problems.push(`predicate.type must be one of ${PREDICATE_TYPES.join(", ")}`);
    if (definition.predicate.type === "string-contains") {
      if (
        typeof definition.predicate.pattern !== "string" ||
        definition.predicate.pattern.length < 1
      )
        problems.push("string-contains predicate requires a non-empty pattern");
    }
    if (definition.predicate.type === "digest-match") {
      if (!DIGEST_PATTERN.test(String(definition.predicate.expectedDigest ?? "")))
        problems.push("digest-match predicate requires an expectedDigest sha256 digest");
    }
    const allowed = new Set(["type", "pattern", "expectedDigest"]);
    for (const key of Object.keys(definition.predicate)) {
      if (!allowed.has(key)) problems.push(`predicate has unknown field ${key}`);
    }
  }
  if (!DIGEST_PATTERN.test(String(definition.policyDigest ?? "")))
    problems.push("policyDigest must be a sha256 digest");
  return problems;
}

export function validatorDigestOf(definition) {
  if (!isPlainObject(definition)) throw new TypeError("validator definition must be an object");
  const { validatorDigest: _omitted, ...bound } = definition;
  return digest(bound);
}

export function createSignalValidator(definition) {
  if (!isPlainObject(definition)) throw new TypeError("validator definition must be an object");
  const normalized = { schema: VALIDATOR_SCHEMA_ID, ...definition };
  const problems = definitionProblems(normalized);
  if (problems.length > 0)
    throw new TypeError(`invalid validator definition: ${problems.join("; ")}`);
  return Object.freeze({ ...normalized, validatorDigest: validatorDigestOf(normalized) });
}

function artifactValue(artifact) {
  if (isPlainObject(artifact) && Object.hasOwn(artifact, "value")) return artifact.value;
  return artifact;
}

export function deterministicStringContains(artifact, pattern) {
  if (typeof pattern !== "string" || pattern.length < 1)
    throw new TypeError("pattern must be a non-empty string");
  return canonicalize(artifactValue(artifact)).includes(pattern);
}

export function deterministicSchemaValid(artifact, schema) {
  if (!isPlainObject(schema) && typeof schema !== "boolean")
    throw new TypeError("schema must be a JSON Schema object or boolean");
  const { id, validator } = inputSchemaValidatorFor(schema);
  return validator.validate(id, artifactValue(artifact)).valid;
}

export function deterministicDigestMatch(artifact, expectedDigest) {
  if (!DIGEST_PATTERN.test(String(expectedDigest ?? "")))
    throw new TypeError("expectedDigest must be a sha256 digest");
  return digest(artifactValue(artifact)) === expectedDigest;
}

const PREDICATE_EVALUATORS = Object.freeze({
  "string-contains": (value, predicate) => deterministicStringContains(value, predicate.pattern),
  "schema-valid": (value, _predicate, validator) =>
    deterministicSchemaValid(value, validator.inputSchema),
  "digest-match": (value, predicate) => deterministicDigestMatch(value, predicate.expectedDigest),
});

function snapshotProblems(snapshot) {
  const problems = [];
  if (!isPlainObject(snapshot)) return ["artifact snapshot must be an object"];
  if (!ARTIFACT_ID_PATTERN.test(String(snapshot.artifactId ?? "")))
    problems.push("artifactId must match art-<lowercase-hyphen-id>");
  if (!Object.hasOwn(snapshot, "value")) problems.push("value is required");
  else if (snapshot.value === undefined) problems.push("value must not be undefined");
  if (snapshot.fileDigest !== undefined && !DIGEST_PATTERN.test(String(snapshot.fileDigest)))
    problems.push("fileDigest must be a sha256 digest when present");
  return problems;
}

export function validateSignal(validator, artifactSnapshot, options = {}) {
  if (!isPlainObject(validator)) throw new TypeError("validator must be an object");
  if (
    typeof validator.validatorDigest !== "string" ||
    validator.validatorDigest !== validatorDigestOf(validator)
  )
    throw new TypeError("validator definition digest mismatch; definition was tampered with");
  const definitionProblemsFound = definitionProblems(validator);
  if (definitionProblemsFound.length > 0)
    throw new TypeError(`invalid validator definition: ${definitionProblemsFound.join("; ")}`);
  const problems = snapshotProblems(artifactSnapshot);
  if (problems.length > 0) throw new TypeError(`invalid artifact snapshot: ${problems.join("; ")}`);
  const evaluator = PREDICATE_EVALUATORS[validator.predicate.type];
  const artifactDigest = digest(artifactSnapshot.value);
  const passed = evaluator(artifactSnapshot.value, validator.predicate, validator);
  const evaluatedAt =
    typeof options.now === "function"
      ? options.now()
      : options.now !== undefined
        ? options.now
        : new Date().toISOString();
  return Object.freeze({
    schema: VALIDATOR_RESULT_SCHEMA_ID,
    signalId: validator.signalId,
    validatorId: validator.validatorId,
    validatorVersion: validator.version,
    artifactId: artifactSnapshot.artifactId,
    artifactDigest,
    result: passed ? "pass" : "fail",
    predicateType: validator.predicate.type,
    evaluatedAt,
  });
}

export default {
  VALIDATOR_SCHEMA_ID,
  VALIDATOR_RESULT_SCHEMA_ID,
  PREDICATE_TYPES,
  validatorDigestOf,
  createSignalValidator,
  validateSignal,
  deterministicStringContains,
  deterministicSchemaValid,
  deterministicDigestMatch,
};
