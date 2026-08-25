import { extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createSchemaValidator, canonicalize, digest } from "../../lib/schema-runtime/index.mjs";
import schema from "../schemas/csm-approach.schema.json" with { type: "json" };

export const APPROACH_SCHEMA = "csm-approach/1";
export const APPROACH_PRODUCER_DESCRIPTOR = Object.freeze({
  producer: "csm-grill",
  schema: APPROACH_SCHEMA,
  schemaRevision: 1,
  artifactKind: "approach",
  authority: "json",
  legacyStatus: "history-only",
  projectionProfile: "csm-grill-human/1",
});
const validator = createSchemaValidator({ schemas: [schema] });
const identity = (value, prefix) =>
  `${prefix}-${createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 32)}`;

export function validateApproachArtifact(value) {
  const result = validator.validate(APPROACH_SCHEMA, value);
  const errors = result.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
  const decisions = Array.isArray(value?.decisions) ? value.decisions : [];
  const decisionIds = decisions.map((decision) => decision?.decisionId);
  if (new Set(decisionIds).size !== decisionIds.length)
    errors.push("/decisions decision IDs must be unique");
  const phases = Array.isArray(value?.phases) ? value.phases : [];
  const phaseIds = phases.map((phase) => phase?.phaseId);
  if (new Set(phaseIds).size !== phaseIds.length) errors.push("/phases phase IDs must be unique");
  const knownPhaseIds = new Set(phaseIds);
  for (const [index, phase] of phases.entries()) {
    if (!Array.isArray(phase?.dependencies)) continue;
    for (const dependency of phase.dependencies)
      if (!knownPhaseIds.has(dependency))
        errors.push(`/phases/${index}/dependencies dependency must reference an existing phase`);
  }
  return { valid: errors.length === 0, errors };
}

export function createApproachArtifact(input, { producerVersion = "csm-grill/1" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("approach input must be an object");
  if (input.schema !== undefined && input.schema !== APPROACH_SCHEMA)
    throw new TypeError("invalid approach schema/version");
  const producedAt = input.provenance?.producedAt ?? new Date().toISOString();
  const runId = input.runId ?? identity({ ideaSlug: input.ideaSlug, producedAt }, "run");
  const payload = {
    schema: APPROACH_SCHEMA,
    schemaRevision: 1,
    artifactId: input.artifactId ?? identity({ runId, ideaSlug: input.ideaSlug }, "art"),
    runId,
    ideaSlug: input.ideaSlug,
    status: "agreed",
    ideaStatement: input.ideaStatement,
    decisions: structuredClone(input.decisions ?? []),
    researchSynthesis: input.researchSynthesis,
    phases: structuredClone(input.phases ?? []),
    projection: { profile: "csm-grill-human/1", legacyMarkdownStatus: "history-only" },
    provenance: {
      producer: "csm-grill",
      producerVersion,
      producedAt,
      sourceDigests: [...(input.provenance?.sourceDigests ?? [])],
    },
  };
  const result = validateApproachArtifact(payload);
  if (!result.valid) throw new TypeError(`invalid approach artifact: ${result.errors.join(", ")}`);
  return payload;
}

export function createApproachEnvelope(payload) {
  const result = validateApproachArtifact(payload);
  if (!result.valid) throw new TypeError(`invalid approach artifact: ${result.errors.join(", ")}`);
  const artifactId = payload.artifactId ?? identity(payload, "art");
  return {
    schema: "csm-envelope/1",
    schemaRevision: 1,
    contentType: "application/json",
    artifact: {
      artifactId,
      kind: "approach",
      owner: "csm-grill",
      runId: payload.runId,
      digest: digest(payload),
      createdAt: payload.provenance.producedAt,
      revision: 1,
    },
    run: { runId: payload.runId, startedAt: payload.provenance.producedAt },
    lifecycleStatus: "completed",
    verificationStatus: "verified",
    payloadSchema: { id: APPROACH_SCHEMA, revision: 1 },
    payload,
    provenance: payload.provenance,
  };
}

export function resumeApproachArtifact(value) {
  if (value?.lifecycleStatus === "completed" || value?.status === "agreed")
    throw new Error("terminal approach cannot resume; grill is non-resumable");
  throw new Error("grill is non-resumable before SAVED");
}

export function serializeApproachArtifact(value) {
  const result = validateApproachArtifact(value);
  if (!result.valid) throw new TypeError(`invalid approach artifact: ${result.errors.join(", ")}`);
  return `${canonicalize(value)}\n`;
}

export async function writeApproachArtifact(path, value) {
  if (extname(path) !== ".json")
    throw new TypeError("approach artifacts must be persisted as JSON");
  await writeFile(path, serializeApproachArtifact(value), { encoding: "utf8", flag: "wx" });
  return { path, digest: digest(value) };
}

export async function readApproachArtifact(path) {
  if (extname(path) !== ".json")
    throw new Error("legacy Markdown approach requires migration-required reconstruction");
  return JSON.parse(await readFile(path, "utf8"));
}
