"use strict";

import { createHash } from "node:crypto";
import { readDurableBytes, readDurableJson } from "../../../lib/durable-json/index.mjs";
import { isAbsolute } from "node:path";
import { hash, validateReport, AppendOnlyLedger } from "../ledger/index.mjs";

const HASH = /^sha256:[a-f0-9]{64}$/;
const PROJECTION = /\.(?:md|markdown|html|htm)$/i;
const SCHEMAS = Object.freeze({
  contract: "csm-autoresearch-contract/1",
  policy: "csm-autoresearch-policy/1",
  request: "csm-autoresearch-evaluator-request/1",
  response: "csm-autoresearch-evaluator-response/1",
  ledger: "csm-autoresearch-ledger-event/1",
  report: "csm-autoresearch-report/1",
  llm: "csm-autoresearch-llm-adapter/1",
  artifact: "csm-artifact/1",
  envelope: "csm-envelope/1",
});

function sharedRunId(runId) {
  if (typeof runId !== "string" || runId.length === 0) throw new TypeError("runId is required");
  return `run-${createHash("sha256").update(runId).digest("hex").slice(0, 32)}`;
}

function resolveNativeRunId({ nativeRunId, runId } = {}) {
  if (nativeRunId !== undefined && runId !== undefined && nativeRunId !== runId)
    throw new TypeError("nativeRunId and runId mismatch");
  const value = nativeRunId ?? runId;
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("nativeRunId is required");
  return value;
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function artifactId(runId, kind, digest) {
  return `art-${createHash("sha256")
    .update(`${runId}\0${kind}\0${digest}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function validateDescriptor(descriptor) {
  if (!descriptor || descriptor.schema !== "csm-artifact/1" || !descriptor.artifact)
    throw new TypeError("invalid csm-artifact descriptor");
  const { artifact } = descriptor;
  if (!/^art-[a-z0-9][a-z0-9-]{1,127}$/.test(artifact.artifactId))
    throw new TypeError("invalid artifactId");
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(artifact.runId))
    throw new TypeError("invalid shared runId");
  if (
    artifact.owner !== "csm-autoresearch" ||
    artifact.revision !== 1 ||
    !HASH.test(artifact.digest)
  )
    throw new TypeError("invalid artifact identity");
  if (
    typeof descriptor.location !== "string" ||
    isAbsolute(descriptor.location) ||
    descriptor.location.includes("..")
  )
    throw new TypeError("artifact location must be relative and contained");
  if (!["application/json", "application/jsonl"].includes(descriptor.contentType))
    throw new TypeError("invalid artifact content type");
  return descriptor;
}

function createArtifactDescriptor({
  runId,
  nativeRunId: suppliedNativeRunId,
  kind,
  digest,
  location,
  contentType,
  lifecycleStatus = "completed",
  createdAt = new Date().toISOString(),
  sourceArtifactIds,
  rollbackArtifactId,
}) {
  const native = resolveNativeRunId({ nativeRunId: suppliedNativeRunId, runId });
  if (!HASH.test(digest)) throw new TypeError("artifact digest must be sha256");
  const descriptor = {
    schema: "csm-artifact/1",
    artifact: {
      artifactId: artifactId(native, kind, digest),
      kind,
      owner: "csm-autoresearch",
      runId: sharedRunId(native),
      digest,
      createdAt,
      revision: 1,
    },
    contentType,
    location,
    lifecycleStatus,
  };
  if (sourceArtifactIds?.length) descriptor.sourceArtifactIds = [...new Set(sourceArtifactIds)];
  if (rollbackArtifactId) descriptor.rollbackArtifactId = rollbackArtifactId;
  return validateDescriptor(descriptor);
}

function createArtifactEnvelope(
  descriptor,
  { nativeRunId, startedAt, endedAt, sourceDigests = [] } = {},
) {
  validateDescriptor(descriptor);
  const native = resolveNativeRunId({ nativeRunId });
  if (descriptor.artifact.runId !== sharedRunId(native))
    throw new TypeError("nativeRunId and envelope runId mismatch");
  const envelope = {
    schema: "csm-envelope/1",
    schemaRevision: 1,
    artifact: descriptor.artifact,
    run: { runId: descriptor.artifact.runId, startedAt, ...(endedAt ? { endedAt } : {}) },
    lifecycleStatus: descriptor.lifecycleStatus,
    verificationStatus: descriptor.lifecycleStatus === "completed" ? "verified" : "incomplete",
    payloadSchema: { id: "csm-artifact", revision: 1 },
    payload: descriptor,
    contentType: "application/json",
    provenance: {
      producer: "csm-autoresearch",
      producerVersion: "1",
      producedAt: endedAt ?? startedAt,
      nativeRunId: native,
      sourceDigests: [...new Set(sourceDigests.filter((value) => HASH.test(value)))],
    },
  };
  if (envelope.provenance.sourceDigests.length === 0)
    envelope.provenance.sourceDigests.push(hash(native));
  return envelope;
}

function validateArtifactEnvelope(envelope, suppliedIdentity) {
  if (!envelope || envelope.schema !== "csm-envelope/1" || !envelope.artifact || !envelope.payload)
    throw new TypeError("invalid csm-envelope");
  const native = resolveNativeRunId(suppliedIdentity);
  validateDescriptor(envelope.payload);
  if (
    envelope.schemaRevision !== 1 ||
    envelope.payloadSchema?.id !== "csm-artifact" ||
    envelope.payloadSchema?.revision !== 1 ||
    envelope.artifact.artifactId !== envelope.payload.artifact.artifactId ||
    envelope.artifact.runId !== envelope.payload.artifact.runId ||
    envelope.run?.runId !== sharedRunId(native) ||
    envelope.provenance?.nativeRunId !== native
  )
    throw new TypeError("nativeRunId and envelope run identity mismatch");
  return envelope;
}

async function replayLedger(path, runId, provenance = {}) {
  const ledger = new AppendOnlyLedger(path, { runId, provenance });
  return ledger.open();
}

async function replayReport(path, runId) {
  const report = await readDurableJson(path);
  return validateReport(report, runId);
}

async function validateProducerArtifacts({
  ledgerPath,
  reportPath,
  manifestPath,
  runId,
  nativeRunId: suppliedNativeRunId,
}) {
  const native = resolveNativeRunId({ nativeRunId: suppliedNativeRunId, runId });
  const records = await replayLedger(ledgerPath, native);
  const report = validateReport(await readDurableJson(reportPath), native);
  const reportBytes = await readDurableBytes(reportPath);
  const manifest = await readDurableJson(manifestPath);
  if (
    manifest.format !== "csm-autoresearch-manifest/1" ||
    manifest.runId !== native ||
    manifest.nativeRunId !== native ||
    manifest.runHash !== hash(report) ||
    manifest.ledger !== ledgerPath.replace(/^\//, "") ||
    manifest.report !== reportPath.replace(/^\//, "")
  )
    throw new Error("artifact manifest is inconsistent");
  const descriptors = manifest.artifactDescriptors;
  if (!Array.isArray(descriptors) || descriptors.length !== 2)
    throw new Error("artifact manifest descriptors are incomplete");
  const ledgerDescriptor = descriptors.find(
    (descriptor) => descriptor.artifact?.kind === "autoresearch-ledger",
  );
  const reportDescriptor = descriptors.find(
    (descriptor) => descriptor.artifact?.kind === "autoresearch-report",
  );
  if (!ledgerDescriptor || !reportDescriptor)
    throw new Error("artifact descriptors are incomplete");
  validateDescriptor(ledgerDescriptor);
  validateDescriptor(reportDescriptor);
  if (
    ledgerDescriptor.artifact.digest !== digestBytes(await readDurableBytes(ledgerPath)) ||
    reportDescriptor.artifact.digest !== digestBytes(reportBytes) ||
    reportDescriptor.sourceArtifactIds?.[0] !== ledgerDescriptor.artifact.artifactId
  )
    throw new Error("artifact digest consistency failure");
  const envelope = validateArtifactEnvelope(manifest.envelope, { nativeRunId: native });
  if (envelope.artifact.artifactId !== reportDescriptor.artifact.artifactId)
    throw new Error("artifact envelope is inconsistent");
  if (
    ledgerDescriptor.artifact.runId !== sharedRunId(native) ||
    reportDescriptor.artifact.runId !== sharedRunId(native)
  )
    throw new Error("artifact descriptor run identity mismatch");
  return { records, report, manifest };
}

function rejectProjectionInput(path) {
  if (path && typeof path === "object") {
    if (path.schema === "csm-projection/1") {
      const error = new Error("projection is not a machine input");
      error.code = "projection-not-input";
      throw error;
    }
    return path;
  }
  if (typeof path !== "string") throw new TypeError("artifact path is required");
  if (PROJECTION.test(path)) {
    const error = new Error("projection is not a machine input");
    error.code = "projection-not-input";
    throw error;
  }
  return path;
}

function registerSchemas(entries = []) {
  const registered = new Map(Object.entries(SCHEMAS).map(([name, id]) => [id, name]));
  for (const entry of entries) {
    if (!entry?.id || !/^csm-[a-z0-9][a-z0-9-]*\/[1-9][0-9]*$/.test(entry.id))
      throw new TypeError("invalid schema registration");
    if (registered.has(entry.id)) throw new TypeError(`duplicate schema registration: ${entry.id}`);
    const base = entry.id.slice(0, entry.id.lastIndexOf("/"));
    if ([...registered.keys()].some((id) => id.startsWith(`${base}/`)))
      throw new RangeError(`unknown schema revision: ${entry.id}`);
    registered.set(entry.id, entry.name ?? entry.id);
  }
  return registered;
}

export {
  SCHEMAS,
  artifactId,
  createArtifactDescriptor,
  createArtifactEnvelope,
  validateArtifactEnvelope,
  digestBytes,
  registerSchemas,
  rejectProjectionInput,
  replayLedger,
  replayReport,
  validateProducerArtifacts,
  sharedRunId,
  validateDescriptor,
};
