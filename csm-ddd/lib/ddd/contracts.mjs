"use strict";

import { createHash } from "node:crypto";

export const GRAPH_FORMAT = "csm-ddd-graph/1";
export const REPORT_FORMAT = "csm-ddd-report/1";
export const PRODUCER_DESCRIPTOR_FORMAT = "csm-ddd-producer/1";

export const DDD_PRODUCER_DESCRIPTOR = Object.freeze({
  format: PRODUCER_DESCRIPTOR_FORMAT,
  producer: "csm-ddd",
  report: { format: REPORT_FORMAT, schema: "ddd-report.schema.json", authoritative: true },
  graph: { format: GRAPH_FORMAT, schema: "ddd-graph.schema.json", authoritative: true },
  pair: { format: "csm-ddd-publication/1", atomic: true },
  projections: { markdown: "explicit-only", html: "explicit-only" },
});

export function buildPairDescriptor({ runId, report, graph, reportSha256, graphSha256, manifest }) {
  requireId(runId, "pair.runId");
  return Object.freeze({
    ...DDD_PRODUCER_DESCRIPTOR,
    runId,
    report: { ...DDD_PRODUCER_DESCRIPTOR.report, path: report, sha256: reportSha256 },
    graph: { ...DDD_PRODUCER_DESCRIPTOR.graph, path: graph, sha256: graphSha256 },
    manifest,
    rollback: "last-complete-pointer",
  });
}

export const STATUSES = Object.freeze([
  "observed",
  "inferred",
  "not_detected",
  "unsupported",
  "unverified",
  "not_applicable",
]);

export const CLAIM_KINDS = Object.freeze([
  "capability",
  "term",
  "workflow",
  "invariant",
  "ownership",
  "context_hypothesis",
  "relationship",
  "seam",
  "slice",
  "ordering",
]);

export const BASES = Object.freeze(["static_analysis", "git_history", "norms_md", "user_provided"]);

export const CONFIDENCES = Object.freeze(["low", "medium", "high"]);

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new ContractError(`${label} must be one of ${allowed.join("|")} (got: ${String(value)})`);
  }
  return value;
}

export function assertStatus(status) {
  return requireEnum(status, STATUSES, "status");
}

export function assertClaimKind(kind) {
  return requireEnum(kind, CLAIM_KINDS, "claimKind");
}

export function assertBasis(basis) {
  return requireEnum(basis, BASES, "basis");
}

export function assertConfidence(confidence) {
  return requireEnum(confidence, CONFIDENCES, "confidence");
}

export function makeEvidenceId({ claimId, sourceKind, path, locator, matchedKey }) {
  const parts = [claimId, sourceKind, path, locator, matchedKey];
  if (parts.some((p) => typeof p !== "string" || p.length === 0)) {
    throw new ContractError("makeEvidenceId requires non-empty string parts");
  }
  if (/^([a-zA-Z]:\\|\/)/.test(path)) {
    throw new ContractError(`evidence path must be repository-relative (got: ${path})`);
  }
  const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
  return `ev-${digest.slice(0, 24)}`;
}

export function buildEvidence({ claimId, sourceKind, path, locator, matchedKey = "" }) {
  requireId(claimId, "evidence.claimId");
  const id = makeEvidenceId({ claimId, sourceKind, path, locator, matchedKey });
  return Object.freeze({ id, claimId, sourceKind, path, locator, matchedKey });
}

export function buildClaim({
  id,
  claimKind,
  status,
  subject,
  basis,
  confidence,
  evidenceIds = [],
  note = "",
}) {
  requireId(id, "claim.id");
  requireId(subject, "claim.subject");
  assertClaimKind(claimKind);
  assertStatus(status);
  assertBasis(basis);
  assertConfidence(confidence);
  if (claimKind === "context_hypothesis" && status === "observed") {
    throw new ContractError("context_hypothesis claims may never use status 'observed'");
  }
  for (const evidenceId of evidenceIds) {
    if (typeof evidenceId !== "string" || !evidenceId.startsWith("ev-")) {
      throw new ContractError(
        `evidenceIds entries must be evidence IDs (got: ${String(evidenceId)})`,
      );
    }
  }
  return Object.freeze({
    id,
    claimKind,
    status,
    subject,
    basis,
    confidence,
    evidenceIds: [...evidenceIds],
    note,
  });
}

export function buildGraphNode({ id, kind, label }) {
  requireId(id, "node.id");
  requireId(kind, "node.kind");
  return Object.freeze({ id, kind, label: label ?? id });
}

export function buildGraphEdge({ source, target, relation }) {
  requireId(source, "edge.source");
  requireId(target, "edge.target");
  requireId(relation, "edge.relation");
  return Object.freeze({ source, target, relation });
}

export function buildQuestion({ id, subject, text, dependsOn = [] }) {
  requireId(id, "question.id");
  requireId(text, "question.text");
  return Object.freeze({ id, subject: subject ?? null, text, dependsOn: [...dependsOn] });
}

export function buildAnswer({ questionId, subject, value, providedBy = "user" }) {
  requireId(questionId, "answer.questionId");
  return Object.freeze({ questionId, subject: subject ?? questionId, value, providedBy });
}

export function findStaticClaims(claims, subject) {
  return claims.filter((c) => c.subject === subject && c.basis !== "user_provided");
}

export function assertAnswerDoesNotOverwriteStatic(claims, answer) {
  const conflicting = findStaticClaims(claims, answer.subject);
  if (conflicting.length > 0) {
    throw new ContractError(
      `answer for ${answer.questionId} conflicts with ${conflicting.length} static-evidence claim(s); record it as an alternative hypothesis instead`,
    );
  }
  return true;
}

export function buildGraphEnvelope({ runId, generatedAt }) {
  requireId(runId, "runId");
  return {
    format: GRAPH_FORMAT,
    runId,
    generatedAt,
    nodes: [],
    edges: [],
    claims: [],
    evidence: [],
    questions: [],
    answers: [],
  };
}

export function buildReportEnvelope({ runId, generatedAt, title }) {
  requireId(runId, "runId");
  return {
    format: REPORT_FORMAT,
    runId,
    graphRunId: runId,
    generatedAt,
    title: title ?? "DDD repository analysis",
    sections: [],
  };
}

export function assertReportContract(report, graph) {
  if (report.format !== REPORT_FORMAT) throw new ContractError("report has an unsupported format");
  if (report.runId !== graph.runId || report.graphRunId !== graph.runId) {
    throw new ContractError("report and graph run IDs do not match");
  }
  if (!Array.isArray(report.sections) || report.sections.length === 0) {
    throw new ContractError("report must contain typed sections");
  }
  for (const section of report.sections) {
    if (!Array.isArray(section.findings))
      throw new ContractError("report sections require findings");
    for (const finding of section.findings) {
      if (finding.claimId && !graph.claims.some((claim) => claim.id === finding.claimId)) {
        throw new ContractError(
          `report finding ${finding.id} references missing claim ${finding.claimId}`,
        );
      }
      for (const evidenceId of finding.evidenceIds ?? []) {
        if (!graph.evidence.some((evidence) => evidence.id === evidenceId)) {
          throw new ContractError(
            `report finding ${finding.id} references missing evidence ${evidenceId}`,
          );
        }
      }
    }
  }
  return true;
}

export function assertPairRunId(runId, report, graph) {
  requireId(runId, "pair.runId");
  if (report?.runId !== runId || report?.graphRunId !== runId || graph?.runId !== runId) {
    throw new ContractError("published report and graph run IDs must match the pair run ID");
  }
  return true;
}

const ID_COLLECTIONS = ["nodes", "evidence", "questions", "answers"];

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function canonicalizeGraph(graph) {
  const out = { format: graph.format, runId: graph.runId, generatedAt: graph.generatedAt };
  for (const key of ID_COLLECTIONS) {
    out[key] = [...graph[key]].toSorted(byId);
  }
  out.claims = [...graph.claims].toSorted(byId);
  out.edges = [...graph.edges].toSorted((a, b) => {
    const ka = `${a.source}\u0000${a.target}\u0000${a.relation}`;
    const kb = `${b.source}\u0000${b.target}\u0000${b.relation}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

export function serializeGraph(graph) {
  return `${JSON.stringify(canonicalizeGraph(graph), null, 2)}\n`;
}

export function validateGraphReferences(graph) {
  const errors = [];
  const evidenceIds = new Set(graph.evidence.map((e) => e.id));
  const claimIds = new Set(graph.claims.map((c) => c.id));
  const questionIds = new Set(graph.questions.map((q) => q.id));
  for (const claim of graph.claims) {
    for (const id of claim.evidenceIds) {
      if (!evidenceIds.has(id)) errors.push(`claim ${claim.id}: dangling evidence ID ${id}`);
    }
  }
  for (const record of graph.evidence) {
    if (!claimIds.has(record.claimId))
      errors.push(`evidence ${record.id}: dangling claim ID ${record.claimId}`);
  }
  for (const answer of graph.answers) {
    if (!questionIds.has(answer.questionId))
      errors.push(`answer: dangling question ID ${answer.questionId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertReportMatchesGraph(report, graph) {
  if (report.graphRunId !== graph.runId) {
    throw new ContractError(
      `report graphRunId ${report.graphRunId} does not reference graph runId ${graph.runId}`,
    );
  }
  return true;
}
