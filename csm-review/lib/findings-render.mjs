"use strict";

import { canonicalize, loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";
import { createRenderModel } from "../../lib/render-model/index.mjs";
import { assertFindingsPayload } from "./findings-validator.mjs";
import {
  HUMAN_PROFILE,
  HUMAN_SOURCE_SCHEMA,
  REDACTION_POLICY,
  SOURCE_REF,
} from "./human-profile.mjs";

const MARKER = REDACTION_POLICY.marker;

function fail(message) {
  throw new TypeError(`invalid csm-review-findings/1 payload: ${message}`);
}

function validateLineage(payload) {
  assertFindingsPayload(payload, "csm-review-findings/1");
  const { artifact, ownership } = payload;
  if (!artifact.artifactId.startsWith("art-review-"))
    fail("artifact ID does not identify a csm-review artifact");
  if (artifact.owner !== "csm-review") fail("artifact owner is not csm-review");
  if (artifact.owner !== ownership.owner) fail("artifact owner does not match ownership owner");
  if (artifact.runId !== ownership.runId) fail("artifact run does not match ownership run");
  if (!artifact.terminal) fail("source artifact must be terminal");
  if (payload.findings.some((finding) => finding.commitSha !== payload.source.commitSha))
    fail("finding commit does not match source commit");
  return payload;
}

function locationText(location) {
  return `${location.path}:${location.line}${location.symbol ? ` (${location.symbol})` : ""}`;
}

function cvssText(cvss) {
  if (!cvss) return "";
  return [
    `score=${cvss.score}`,
    `vector=${cvss.vector}`,
    ...(cvss.assumptions.length ? [`assumptions=${cvss.assumptions.join("; ")}`] : []),
  ].join("; ");
}

function challengeText(challenges) {
  return challenges.map((challenge) => `${challenge.challengeId}: ${challenge.verdict}`).join("; ");
}

function dissentText(dissents) {
  if (!dissents.length) return "none";
  return `${dissents.length} present (${dissents.map((dissent) => dissent.dissentId).join(", ")})`;
}

function findingRow(finding) {
  return {
    id: finding.id,
    title: finding.title,
    dimension: finding.dimension,
    category: finding.category,
    anchor: finding.anchorRef ?? "none",
    cvss: cvssText(finding.cvss),
    severity: finding.severity,
    confidence: finding.confidence,
    evidenceClass: finding.evidenceClass,
    locations: finding.locations.map(locationText).join("; "),
    quotedSnippets: finding.quotedSnippets.join("; "),
    commitSha: finding.commitSha,
    explanation: finding.explanation,
    impact: finding.impact,
    remediation: finding.remediationSketch,
    fixActions: finding.fixActions
      .toSorted((left, right) => left.order - right.order)
      .map((action) => `${action.actionId}: ${action.action} (verify: ${MARKER})`)
      .join("; "),
    verificationMethod: finding.verification?.method ?? "none",
    verificationCommand: finding.verification ? MARKER : "none",
    verificationResult: finding.verification ? MARKER : "none",
    challengeVerdict: challengeText(finding.challenges) || "none",
    challengeRationale: finding.challenges.length ? MARKER : "none",
    dissentPresence: dissentText(finding.dissents),
    dissentRationale: finding.dissents.length ? MARKER : "none",
    status: finding.status,
    statusNote: finding.statusNote,
    corroborators: finding.corroborators.join("; ") || "none",
    sortKey: finding.sortKey,
  };
}

function normalizedSource(payload) {
  const findings = payload.findings.toSorted((left, right) =>
    right.sortKey.localeCompare(left.sortKey),
  );
  return {
    artifact: {
      artifactId: payload.artifact.artifactId,
      owner: payload.artifact.owner,
      runId: payload.artifact.runId,
      digest: payload.artifact.digest,
      createdAt: payload.artifact.createdAt,
    },
    source: {
      commitSha: payload.source.commitSha,
      ...(payload.source.repository ? { repository: payload.source.repository } : {}),
    },
    findings: findings.map(findingRow),
    verificationStatus: {
      status: payload.verificationStatus.status,
      unresolved: [...payload.verificationStatus.unresolved],
    },
    redaction: {
      status: payload.redaction.status,
      rules: [...payload.redaction.rules],
      redactedFields: payload.redaction.redactedFields,
    },
    sortOrder: { ...payload.sortOrder },
  };
}

export async function createFindingsRenderModel(payload, { schemaRegistry } = {}) {
  validateLineage(payload);
  const registry = schemaRegistry ?? (await loadSchemaRegistry());
  const source = normalizedSource(payload);
  const model = createRenderModel({
    source,
    sourceSchema: HUMAN_SOURCE_SCHEMA,
    profile: HUMAN_PROFILE,
    sourceRef: SOURCE_REF,
    schemaRegistry: registry,
  });
  return {
    ...model,
    source,
    sourceDescriptor: {
      artifactId: payload.artifact.artifactId,
      digest: payload.artifact.digest,
      schema: SOURCE_REF,
      runId: payload.artifact.runId,
      owner: payload.artifact.owner,
    },
    profile: HUMAN_PROFILE,
    sourceBytes: canonicalize(source),
  };
}

export { normalizedSource, validateLineage };
