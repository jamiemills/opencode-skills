import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSchemaRegistry,
  digest as schemaDigest,
  parseJson,
} from "../../lib/schema-runtime/index.mjs";

export const RESEARCH_SCHEMA = "csm-research/1";
export const RESEARCH_SCHEMA_REVISION = 1;
export const FIXED_SECTION_ORDER = Object.freeze([
  "tldr",
  "executiveSummary",
  "keyFindings",
  "detailSections",
  "recommendation",
  "unverifiedClaims",
  "references",
  "processAppendix",
]);
export const RESEARCH_PRODUCER_DESCRIPTOR = Object.freeze({
  producer: "csm-deep-research",
  schema: RESEARCH_SCHEMA,
  schemaRevision: RESEARCH_SCHEMA_REVISION,
  artifactKind: "research-finding",
  fixedSections: FIXED_SECTION_ORDER,
  projectionProfile: "csm-research-human/1",
  legacyStatus: "history-only",
});

const digest = (value) =>
  `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function identity(value, prefix) {
  return `${prefix}-${createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 32)}`;
}

function journalEventType(entry) {
  const text = `${entry.state} ${entry.event}`.toLowerCase();
  if (entry.state === "SAVED") return "run.completed";
  if (entry.state === "BLOCKED" || text.includes("blocked")) return "run.failed";
  if (text.includes("quarantined")) return "artifact.quarantined";
  if (text.includes("verified")) return "artifact.verified";
  if (text.includes("created")) return "artifact.created";
  if (text.includes("failed") || text.includes("error")) return "run.failed";
  return "run.started";
}

function journalLifecycleStatus(entry) {
  if (entry.state === "SAVED") return "completed";
  if (entry.state === "BLOCKED") return "blocked";
  const text = `${entry.state} ${entry.event}`.toLowerCase();
  if (text.includes("quarantined")) return "quarantined";
  if (text.includes("failed") || text.includes("error")) return "failed";
  return "active";
}

function journalVerificationStatus(entry) {
  if (entry.state === "SAVED") return "verified";
  if (entry.state === "BLOCKED") return "incomplete";
  return "unverified";
}

async function loadResearchSchemaRegistry() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const registry = parseJson(await readFile(resolve(root, "schemas/registry.json"), "utf8"));
  const schemas = await Promise.all(
    registry.entries.map(async (entry) => {
      const schema = parseJson(await readFile(resolve(root, entry.schemaPath), "utf8"));
      Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
      return schema;
    }),
  );
  const localRegistry = structuredClone(registry);
  const researchEntry = localRegistry.entries.find((entry) => entry.id === RESEARCH_SCHEMA);
  const researchSchema = schemas.find((schema) => schema.$id === RESEARCH_SCHEMA);
  if (researchEntry && researchSchema)
    researchEntry.schemaContentDigest = schemaDigest(researchSchema);
  return createSchemaRegistry({ registry: localRegistry, schemas, root });
}

function semanticErrors(payload) {
  const errors = [];
  const references = new Set((payload.references ?? []).map(({ referenceId }) => referenceId));
  const artifactIds = new Set(
    (payload.declaredArtifacts ?? []).map(({ artifactId }) => artifactId),
  );
  for (const [index, claim] of (payload.claims ?? []).entries()) {
    for (const citation of claim.citations ?? []) {
      if (!references.has(citation.referenceId))
        errors.push(`/claims/${index}/citations: unknown reference ${citation.referenceId}`);
    }
  }
  for (const [index, artifact] of (payload.declaredArtifacts ?? []).entries()) {
    if (artifact.artifactId === payload.artifactId)
      errors.push(`/declaredArtifacts/${index}: finding cannot declare itself`);
    if (!artifactIds.has(artifact.artifactId))
      errors.push(`/declaredArtifacts/${index}: invalid artifact id`);
    if (!/^\.agents\/research\/artifacts\/[a-z0-9][a-z0-9./-]+$/.test(artifact.path ?? ""))
      errors.push(`/declaredArtifacts/${index}: invalid artifact path`);
  }
  for (const [index, reference] of (payload.references ?? []).entries())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reference.retrievedAt ?? ""))
      errors.push(`/references/${index}: retrieval date is required`);
  const sequences = (payload.journal ?? []).map(({ sequence }) => sequence);
  if (sequences.some((sequence, index) => sequence !== index))
    errors.push("/journal: sequence must be contiguous from zero");
  return errors;
}

export function validateResearchArtifact(payload) {
  const errors = [];
  if (!payload || payload.schema !== RESEARCH_SCHEMA || payload.schemaRevision !== 1)
    errors.push("schema/version");
  if (payload?.projection?.sectionOrder?.join("\0") !== FIXED_SECTION_ORDER.join("\0"))
    errors.push("projection/sectionOrder");
  errors.push(...semanticErrors(payload ?? {}));
  return { valid: errors.length === 0, errors };
}

export function createResearchArtifact(input, { producerVersion = "csm-deep-research/1" } = {}) {
  if (!input || typeof input !== "object") throw new TypeError("research input must be an object");
  if (input.schema !== undefined && input.schema !== RESEARCH_SCHEMA)
    throw new TypeError("invalid research artifact: schema/version");
  if (input.schemaRevision !== undefined && input.schemaRevision !== RESEARCH_SCHEMA_REVISION)
    throw new TypeError("invalid research artifact: schema/version");
  const sections = structuredClone(input.sections ?? {});
  const producedAt = input.provenance?.producedAt ?? new Date().toISOString();
  const runId =
    input.runId ??
    identity({ title: String(input.title ?? "Research Finding"), producedAt }, "run");
  const payload = {
    schema: RESEARCH_SCHEMA,
    schemaRevision: RESEARCH_SCHEMA_REVISION,
    title: String(input.title ?? "Research Finding"),
    runId,
    sections: Object.fromEntries(
      FIXED_SECTION_ORDER.map((id) => [id, sections[id] ?? { id, content: "Pending" }]),
    ),
    claims: structuredClone(input.claims ?? []),
    references: structuredClone(input.references ?? []),
    journal: structuredClone(input.journal ?? []),
    declaredArtifacts: structuredClone(input.declaredArtifacts ?? []),
    provenance: {
      producer: "csm-deep-research",
      producerVersion,
      producedAt,
      sourceDigests: [...(input.provenance?.sourceDigests ?? [])],
    },
    projection: {
      profile: "csm-research-human/1",
      sectionOrder: [...FIXED_SECTION_ORDER],
      legacyMarkdownStatus: "history-only",
    },
  };
  const result = validateResearchArtifact(payload);
  if (!result.valid) throw new TypeError(`invalid research artifact: ${result.errors.join(", ")}`);
  return payload;
}

export async function createResearchEnvelope(
  payload,
  { startedAt = payload.provenance.producedAt } = {},
) {
  const result = validateResearchArtifact(payload);
  if (!result.valid) throw new TypeError(`invalid research artifact: ${result.errors.join(", ")}`);
  const runId = payload.runId;
  const artifactId = identity({ runId, payload }, "art");
  const payloadWithIdentity = { ...payload, artifactId };
  const registry = await loadResearchSchemaRegistry();
  const payloadValidation = registry.validate(RESEARCH_SCHEMA, payloadWithIdentity);
  if (!payloadValidation.valid)
    throw new TypeError(`invalid research payload: ${JSON.stringify(payloadValidation.errors)}`);
  const sourceJournal = payload.journal.length
    ? payload.journal
    : [{ sequence: 0, state: "INTAKE", event: "run started", occurredAt: startedAt }];
  const terminalEntry = sourceJournal.at(-1);
  const lifecycleStatus = journalLifecycleStatus(terminalEntry);
  const envelope = {
    schema: "csm-envelope/1",
    schemaRevision: 1,
    contentType: "application/json",
    artifact: {
      artifactId,
      kind: "research-finding",
      owner: "csm-deep-research",
      runId,
      digest: digest(payloadWithIdentity),
      createdAt: startedAt,
      revision: 1,
    },
    run: { runId, startedAt },
    lifecycleStatus,
    verificationStatus: journalVerificationStatus(terminalEntry),
    payloadSchema: { id: RESEARCH_SCHEMA, revision: 1 },
    payload: payloadWithIdentity,
    provenance: {
      producer: "csm-deep-research",
      producerVersion: payload.provenance.producerVersion,
      producedAt: startedAt,
      sourceDigests: payload.provenance.sourceDigests,
    },
    journal: sourceJournal.map((entry, sequence) => ({
      schema: "csm-journal-event/1",
      eventId: `evt-${runId.slice(4)}-${sequence}`,
      runId,
      sequence,
      eventType: journalEventType(entry),
      occurredAt: entry.occurredAt,
      lifecycleStatus: journalLifecycleStatus(entry),
      data: { state: entry.state, event: entry.event },
    })),
  };
  const validation = registry.validate("csm-envelope/1", envelope);
  if (!validation.valid)
    throw new TypeError(`invalid research envelope: ${JSON.stringify(validation.errors)}`);
  return envelope;
}

export function resumeResearchArtifact(value, { expectedRunId, terminal = false } = {}) {
  const envelope = value?.schema === "csm-envelope/1";
  const runId = envelope ? value.run?.runId : value?.runId;
  const terminalState = envelope
    ? ["completed", "failed", "blocked", "superseded", "quarantined"].includes(
        value.lifecycleStatus,
      )
    : value?.journal?.some(({ state }) => state === "SAVED" || state === "BLOCKED");
  if (terminal || terminalState) throw new Error("terminal research artifact cannot resume");
  if (expectedRunId && expectedRunId !== runId)
    throw new Error("research resume run identity mismatch");
  if (envelope && value.payload?.runId !== runId)
    throw new Error("research resume run identity mismatch");
  return structuredClone(value);
}

export function serializeResearchArtifact(value) {
  const payload = value?.schema === "csm-envelope/1" ? value : value;
  const result =
    payload?.schema === RESEARCH_SCHEMA
      ? validateResearchArtifact(payload)
      : { valid: false, errors: ["schema/version"] };
  if (!result.valid) throw new TypeError(`invalid research artifact: ${result.errors.join(", ")}`);
  return `${canonicalize(payload)}\n`;
}

export async function writeResearchArtifact(path, payload) {
  if (extname(path) !== ".json")
    throw new TypeError("research artifacts must be persisted as JSON");
  const serialized = serializeResearchArtifact(payload);
  const registry = await loadResearchSchemaRegistry();
  const validation = registry.validate(RESEARCH_SCHEMA, payload);
  if (!validation.valid)
    throw new TypeError(`invalid research payload: ${JSON.stringify(validation.errors)}`);
  await writeFile(path, serialized, { encoding: "utf8", flag: "wx" });
  return { path, digest: digest(payload) };
}

export { canonicalize, digest };
