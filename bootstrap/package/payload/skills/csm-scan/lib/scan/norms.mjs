import { createHash } from "node:crypto";

import { assertLegacyPrivacySafe } from "./shared/privacy.mjs";
import { DIMENSION_REGISTRY } from "./registry/dimensions.mjs";
import { loadSchemaRegistry } from "../../../../lib/schema-runtime/index.mjs";

export const NORMS_SCHEMA = "csm-norms/1";
export const NORMS_SCHEMA_REVISION = 1;
const DIMENSIONS = Object.freeze(
  DIMENSION_REGISTRY.map((entry) => ({
    id: entry.id,
    name: entry.id.replace(/^DIM-/, "").replace(/-v1$/, ""),
    order: entry.order,
  })),
);
export const NORMS_PRODUCER_DESCRIPTOR = Object.freeze({
  producer: "csm-scan",
  schema: NORMS_SCHEMA,
  schemaRevision: NORMS_SCHEMA_REVISION,
  artifactKind: "norms",
  canonicalPath: "NORMS.json",
  dimensions: DIMENSIONS,
  consumers: Object.freeze(["csm-plan", "csm-build", "csm-review", "csm-bdd-tdd"]),
  legacyPath: "NORMS.md",
  legacyStatus: "history-only",
});

const digest = (value) =>
  `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function rootIdentity(root) {
  return `root-${createHash("sha256").update(String(root)).digest("hex").slice(0, 24)}`;
}

function pluginRecords(repos) {
  const records = [];
  for (const repo of repos) {
    for (const entry of repo.deep ?? []) {
      for (const observation of entry.findings?.providerObservations ?? []) {
        if (typeof observation.plugin !== "string") continue;
        records.push({ plugin: observation.plugin, dimension: entry.dimension, observation });
      }
    }
  }
  records.sort((a, b) =>
    `${a.plugin}\0${a.dimension}\0${canonicalize(a.observation)}`.localeCompare(
      `${b.plugin}\0${b.dimension}\0${canonicalize(b.observation)}`,
    ),
  );
  const grouped = new Map();
  for (const record of records) {
    const list = grouped.get(record.plugin) ?? [];
    list.push(record.observation);
    grouped.set(record.plugin, list);
  }
  return [...grouped]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([id, observations]) => ({ id, observations }));
}

export function createNormsArtifact(
  findings,
  { producerRevision = "csm-scan", sourceCommits = [] } = {},
) {
  if (!findings || !Array.isArray(findings.repos) || findings.repos.length === 0)
    throw new TypeError("norms findings require repositories");
  const repositories = findings.repos
    .map((repo, sourceOrder) => {
      const source = {
        order: sourceOrder,
        name: String(repo.overview?.name ?? "unknown"),
        rootIdentity: rootIdentity(
          repo.overview?.gitRoot ?? repo.overview?.path ?? repo.overview?.name,
        ),
        commit: sourceCommits[sourceOrder] ?? null,
      };
      const dimensions = validateDimensions(repo.deep, source.name).map((entry, order) => ({
        order,
        id: entry.registry.id,
        dimension: DIMENSIONS[order].name,
        signal: entry.signal,
        confidence: entry.confidence,
        coverage: entry.coverage,
        findings: entry.findings ?? {},
      }));
      return { source, dimensions, sourceOrder };
    })
    .toSorted(
      (a, b) =>
        `${a.source.name}\0${a.source.rootIdentity}`.localeCompare(
          `${b.source.name}\0${b.source.rootIdentity}`,
        ) || canonicalize(a).localeCompare(canonicalize(b)),
    )
    .map((repository, order) => ({ ...repository, source: { ...repository.source, order } }));
  const artifact = {
    schema: NORMS_SCHEMA,
    schemaRevision: NORMS_SCHEMA_REVISION,
    artifactDigest: null,
    provenance: { producer: "csm-scan", producerRevision, generated: findings.generated },
    source: { repositoryCount: repositories.length },
    repositories: repositories.map(({ sourceOrder: _sourceOrder, ...repository }) => repository),
    plugins: pluginRecords(findings.repos),
    privacy: {
      status: "passed",
      outcomes: [
        { scope: "scanner-findings", status: "passed" },
        { scope: "provider-observations", status: "passed" },
        { scope: "global-snapshot", status: "passed" },
      ],
    },
    crossObservations: repositories
      .flatMap(({ sourceOrder }) => findings.repos[sourceOrder].crossObservations ?? [])
      .toSorted((a, b) => canonicalize(a).localeCompare(canonicalize(b))),
    global: findings.global ?? null,
  };
  assertLegacyPrivacySafe(artifact);
  artifact.artifactDigest = digest({ ...artifact, artifactDigest: null });
  return artifact;
}

function validateDimensions(entries, repository) {
  if (!Array.isArray(entries) || entries.length !== DIMENSIONS.length)
    throw new TypeError(`repository ${repository} must provide all registered dimensions`);
  const seen = new Set();
  return entries.map((entry, order) => {
    const actual = String(entry?.dimension ?? "");
    const registry = DIMENSION_REGISTRY.find(
      (candidate) =>
        candidate.id === actual || candidate.id.replace(/^DIM-/, "").replace(/-v1$/, "") === actual,
    );
    if (!registry) throw new TypeError(`repository ${repository} has unknown dimension ${actual}`);
    if (seen.has(registry.id))
      throw new TypeError(`repository ${repository} has duplicate dimension ${actual}`);
    seen.add(registry.id);
    if (registry.order !== order)
      throw new TypeError(`repository ${repository} dimensions are not in registry order`);
    return { ...entry, registry };
  });
}

function envelopeIdentity(value, prefix) {
  return `${prefix}-${createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 32)}`;
}

export async function createNormsEnvelope(payload) {
  const startedAt = `${payload.provenance.generated}T00:00:00.000Z`;
  const runId = envelopeIdentity({ schema: NORMS_SCHEMA, payload }, "run");
  const artifactId = envelopeIdentity({ runId, digest: payload.artifactDigest }, "art");
  const envelope = {
    schema: "csm-envelope/1",
    schemaRevision: 1,
    contentType: "application/json",
    artifact: {
      artifactId,
      kind: "norms",
      owner: "csm-scan",
      runId,
      digest: payload.artifactDigest,
      createdAt: startedAt,
      revision: 1,
    },
    run: { runId, startedAt, endedAt: startedAt },
    lifecycleStatus: "completed",
    verificationStatus: "verified",
    payloadSchema: { id: NORMS_SCHEMA, revision: NORMS_SCHEMA_REVISION },
    payload,
    provenance: {
      producer: "csm-scan",
      producerVersion: payload.provenance.producerRevision,
      producedAt: startedAt,
      sourceDigests: payload.repositories.map(({ source }) =>
        digest({ name: source.name, rootIdentity: source.rootIdentity, commit: source.commit }),
      ),
    },
  };
  const registry = await loadSchemaRegistry();
  const result = registry.validate("csm-envelope/1", envelope);
  if (!result.valid)
    throw new TypeError(`invalid norms envelope: ${JSON.stringify(result.errors)}`);
  return envelope;
}

export function validateNormsArtifact(artifact) {
  const errors = [];
  if (!artifact || artifact.schema !== NORMS_SCHEMA || artifact.schemaRevision !== 1)
    errors.push("schema");
  if (!Array.isArray(artifact?.repositories) || artifact.repositories.length === 0)
    errors.push("repositories");
  else {
    for (const repository of artifact.repositories) {
      try {
        validateDimensions(repository.dimensions, repository.source?.name ?? "unknown");
      } catch {
        errors.push("dimensions");
      }
    }
  }
  if (artifact?.privacy?.status !== "passed") errors.push("privacy");
  const expected = digest({ ...artifact, artifactDigest: null });
  if (artifact?.artifactDigest !== expected) errors.push("artifactDigest");
  return { valid: errors.length === 0, errors };
}

export function serializeNormsArtifact(artifact) {
  if (artifact?.schema === "csm-envelope/1") return `${canonicalize(artifact)}\n`;
  const result = validateNormsArtifact(artifact);
  if (!result.valid) throw new TypeError(`invalid norms artifact: ${result.errors.join(", ")}`);
  return `${canonicalize(artifact)}\n`;
}
