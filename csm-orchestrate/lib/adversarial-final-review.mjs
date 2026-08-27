"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";

const PHASE_ID = /^phase-[a-z0-9][a-z0-9-]{1,127}$/;
import { HOST_REVIEW } from "./review-token.mjs";
const unique = (values) => [...new Set(values.filter(Boolean))];

function finding(code, message, severity = "high", details = {}) {
  return { code, message, severity, ...details };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function checkEvidence(requirements, claims, evidence) {
  const byId = new Map(list(evidence).map((item) => [item.evidenceId, item]));
  const coverage = [];
  const failures = [];
  for (const requirement of list(requirements)) {
    const related = list(claims).filter((claim) =>
      list(claim.requirementIds).includes(requirement.requirementId),
    );
    const refs = unique(related.flatMap((claim) => list(claim.evidenceRefs)));
    const requiredSignals = new Set(
      list(requirement.acceptanceSignalIds ?? [requirement.acceptanceSignalId]).filter(Boolean),
    );
    const usable = refs.filter((ref) => {
      const id = typeof ref === "string" ? ref : ref?.evidenceId;
      const claim = related.find((item) =>
        list(item.evidenceRefs).some(
          (candidate) => (typeof candidate === "string" ? candidate : candidate?.evidenceId) === id,
        ),
      );
      const signal = typeof ref === "object" ? ref.acceptanceSignalId : claim?.acceptanceSignalId;
      const item = byId.get(id);
      return (
        item?.status === "current" &&
        item?.requirementIds?.includes(requirement.requirementId) &&
        requiredSignals.has(signal) &&
        (item.acceptanceSignalId === signal || item.validation?.signalId === signal)
      );
    });
    coverage.push({
      requirementId: requirement.requirementId,
      evidenceRefs: refs,
      status: usable.length ? "covered" : "uncovered",
    });
    if (requirement.criticality === "critical" && !usable.length && !requirement.waiver)
      failures.push(
        finding(
          "uncovered-critical-requirement",
          `critical requirement is not covered: ${requirement.requirementId}`,
          "critical",
          { requirementId: requirement.requirementId },
        ),
      );
    for (const ref of refs) {
      const id = typeof ref === "string" ? ref : ref?.evidenceId;
      const item = byId.get(id);
      if (!item)
        failures.push(
          finding("missing-evidence", `claim cites missing evidence: ${id}`, "high", {
            evidenceId: id,
          }),
        );
      else if (!item.requirementIds?.includes(requirement.requirementId))
        failures.push(
          finding(
            "evidence-binding-mismatch",
            `evidence is not bound to requirement: ${id}`,
            "critical",
            { evidenceId: id, requirementId: requirement.requirementId },
          ),
        );
      else if (!requiredSignals.size || (!item.acceptanceSignalId && !item.validation?.signalId))
        failures.push(
          finding(
            "missing-acceptance-signal",
            `claim lacks a bound acceptance signal: ${id}`,
            "critical",
            { evidenceId: id },
          ),
        );
      else if (
        typeof ref === "object" &&
        ref.acceptanceSignalId !== undefined &&
        !requiredSignals.has(ref.acceptanceSignalId)
      )
        failures.push(
          finding(
            "acceptance-signal-mismatch",
            `claim signal does not match requirement: ${id}`,
            "critical",
            { evidenceId: id },
          ),
        );
      else if (typeof ref === "object" && ref.digest !== undefined && ref.digest !== item.digest)
        failures.push(
          finding(
            "evidence-digest-mismatch",
            `claim digest does not match evidence: ${id}`,
            "critical",
            {
              evidenceId: id,
            },
          ),
        );
      else if (item.status !== "current")
        failures.push(
          finding("non-current-evidence", `claim cites ${item.status} evidence: ${id}`, "high", {
            evidenceId: id,
          }),
        );
    }
  }
  return { coverage, failures };
}

function checkArtifacts(artifacts, expectedRunId) {
  const failures = [];
  const seen = new Map();
  for (const artifact of list(artifacts)) {
    const id = artifact.artifactId;
    if (!id || !artifact.digest || !artifact.path)
      failures.push(finding("artifact-identity-missing", "artifact identity is incomplete"));
    if (artifact.runId && expectedRunId && artifact.runId !== expectedRunId)
      failures.push(
        finding("artifact-run-mismatch", `artifact is from another run: ${id}`, "critical", {
          artifactId: id,
        }),
      );
    if (seen.has(id))
      failures.push(
        finding(
          "duplicate-artifact-output",
          `artifact was presented more than once: ${id}`,
          "high",
          { artifactId: id },
        ),
      );
    if (seen.has(id) && seen.get(id) !== artifact.digest)
      failures.push(
        finding(
          "duplicate-artifact-conflict",
          `artifact has conflicting digests: ${id}`,
          "critical",
          { artifactId: id },
        ),
      );
    seen.set(id, artifact.digest);
  }
  return failures;
}

export function reviewAcceptance({
  runId,
  requirements = [],
  claims = [],
  evidence = [],
  artifacts = [],
  technical = [],
  functional = [],
  actions = [],
  scope = {},
  completion,
  omissions = [],
  assumptions = [],
  producerRationale: _producerRationale,
} = {}) {
  const failures = [];
  const checked = checkEvidence(requirements, claims, evidence);
  failures.push(...checked.failures, ...checkArtifacts(artifacts, runId));
  if (list(omissions).length)
    failures.push(finding("omissions", "declared omissions remain", "high", { items: omissions }));
  if (list(assumptions).some((item) => item?.accepted !== true))
    failures.push(finding("unaccepted-assumption", "an assumption is not explicitly accepted"));
  if (list(actions).some((action) => action?.authorized !== true || action?.unsafe === true))
    failures.push(finding("unsafe-action", "an action is unauthorized or unsafe", "critical"));
  if (list(scope.creep).length)
    failures.push(
      finding("scope-creep", "output exceeds declared scope", "high", { items: scope.creep }),
    );
  if (list(artifacts).some((item) => item?.stale === true || item?.duplicate === true))
    failures.push(
      finding("stale-duplicate-output", "stale or duplicate output was presented as final"),
    );
  if (
    list(technical).some((item) => item?.status !== "pass") ||
    list(functional).some((item) => item?.status !== "pass")
  )
    failures.push(
      finding("gate-failure", "technical or functional results did not pass", "critical"),
    );
  if (!technical.length)
    failures.push(
      finding("missing-technical-result", "technical results were not supplied", "critical"),
    );
  if (!functional.length)
    failures.push(
      finding("missing-functional-result", "functional results were not supplied", "critical"),
    );
  if (completion !== true)
    failures.push(
      finding(
        "false-completion",
        "completion is not supported by independent acceptance evidence",
        "critical",
      ),
    );
  return Object.freeze({
    schema: "csm-orchestrate-adversarial-review/2",
    reviewId: `review-${digest({ runId, requirements, claims, evidence, artifacts }).slice(7, 39)}`,
    runId,
    status: failures.length ? "REJECTED" : "ACCEPTED",
    independent: true,
    provenance: {
      mode: "local-test-seam",
      reviewer: "csm-orchestrate",
      reviewerChildRunId: runId,
    },
    requirementCoverage: checked.coverage,
    evidenceEntailment: checked.failures.length ? "failed" : "supported",
    artifactIdentity: failures.filter((item) => item.code.includes("artifact")).length
      ? "failed"
      : "verified",
    omissions: list(omissions),
    assumptions: list(assumptions),
    scope: { creep: list(scope.creep) },
    staleDuplicateOutputs: list(artifacts)
      .filter((item) => item.stale === true || item.duplicate === true)
      .map((item) => item.artifactId),
    unsafeActions: list(actions).filter((item) => item.authorized !== true || item.unsafe === true),
    technical: list(technical),
    functional: list(functional),
    falseCompletion: completion !== true,
    findings: failures,
  });
}

export function validateInjectedFinalReview({
  review,
  runId,
  phaseResults = [],
  evidence = [],
} = {}) {
  const failures = [];
  if (!review || review.runId !== runId)
    failures.push("final review is not bound to the parent run");
  if (!Array.isArray(review?.findings)) failures.push("final review findings are required");
  if (!Array.isArray(review?.technical) || !review.technical.length)
    failures.push("final review technical acceptance evidence is required");
  if (!Array.isArray(review?.functional) || !review.functional.length)
    failures.push("final review functional acceptance evidence is required");
  if (review?.evidenceEntailment !== "supported")
    failures.push("final review evidence entailment is not supported");
  failures.push(...validateReviewProvenance(review, runId));
  if (!Array.isArray(review?.requirementCoverage) || !review.requirementCoverage.length)
    failures.push("final review requirement coverage is required");
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const criticalRequirementIds = new Set(
    phaseResults.flatMap((item) => item.phase.requirementIds ?? []),
  );
  const coverage = new Map(
    (review?.requirementCoverage ?? []).map((item) => [item.requirementId, item]),
  );
  for (const requirementId of criticalRequirementIds) {
    const item = coverage.get(requirementId);
    const current = (item?.evidenceRefs ?? []).filter((ref) => {
      const id = typeof ref === "string" ? ref : ref?.evidenceId;
      const evidenceItem = evidenceById.get(id);
      const phase = phaseResults.find((result) =>
        list(result.phase?.requirementIds).includes(requirementId),
      )?.phase;
      const signals = list(phase?.acceptanceSignalIds);
      const signal =
        typeof ref === "object" ? ref.acceptanceSignalId : evidenceItem?.acceptanceSignalId;
      return (
        evidenceItem?.status === "current" &&
        evidenceItem?.requirementIds?.includes(requirementId) &&
        signals.length > 0 &&
        signals.includes(signal) &&
        (evidenceItem.acceptanceSignalId === signal || evidenceItem.validation?.signalId === signal)
      );
    });
    if (!item || !current.length)
      failures.push(
        `final review lacks current evidence for critical requirement: ${requirementId}`,
      );
    for (const ref of current) {
      const evidenceId = typeof ref === "string" ? ref : ref.evidenceId;
      if (!(evidenceById.get(evidenceId).requirementIds ?? []).includes(requirementId))
        failures.push(`final review evidence requirement ID does not match: ${evidenceId}`);
    }
  }
  for (const requirementId of coverage.keys())
    if (!criticalRequirementIds.has(requirementId))
      failures.push(`final review contains unknown requirement: ${requirementId}`);
  const expectedStatuses = phaseResults.flatMap((item) => [
    item.gate.technical,
    item.gate.functional,
  ]);
  const technical = Array.isArray(review?.technical) ? review.technical : [];
  const functional = Array.isArray(review?.functional) ? review.functional : [];
  if (
    expectedStatuses.length &&
    [...technical, ...functional].some(
      (result) => !expectedStatuses.some((expected) => expected.status === result.status),
    )
  )
    failures.push("final review gate evidence is not bound to parent gates");
  if (review.status === "ACCEPTED" && failures.length)
    failures.push("accepted self-attested review rejected");
  return { valid: failures.length === 0, failures };
}

export function validateReviewProvenance(review, parentRunId) {
  const provenance = review?.provenance;
  const failures = [];
  if (!provenance || provenance.mode !== "host-backed")
    return ["final review lacks host-backed provenance"];
  if (!provenance.reviewer || !provenance.owner || !provenance.reviewerChildRunId)
    failures.push("final review reviewer identity is incomplete");
  if (provenance.reviewerChildRunId === parentRunId)
    failures.push("final review reviewer child run must differ from parent run");
  for (const field of ["receipt", "artifact"])
    if (!provenance[field]?.digest) failures.push(`final review ${field} provenance is required`);
  if (!provenance.approval?.approvalId || !provenance.approval?.edgeId)
    failures.push("final review approval edge binding is required");
  if (provenance.approval?.parentRunId !== parentRunId)
    failures.push("final review approval is not bound to the parent run");
  if (provenance.approval?.reviewerChildRunId !== provenance.reviewerChildRunId)
    failures.push("final review approval is not bound to reviewer child run");
  if (provenance.approval?.phaseId !== review?.phaseId)
    failures.push("final review approval is not bound to phase");
  if (provenance.approval?.approvedDigest !== provenance.artifact?.digest)
    failures.push("final review approval is not bound to review artifact digest");
  return failures;
}

function assertInsertion(graph, phase, existingEffects) {
  if (!phase || !PHASE_ID.test(phase.phaseId))
    throw new TypeError("remediation phase ID is invalid");
  const phases = list(graph?.phases);
  const ids = new Set(phases.map((item) => item.phaseId));
  if (ids.has(phase.phaseId)) throw new TypeError("duplicate remediation phase ID");
  if (!ids.has(phase.parentPhaseId)) throw new TypeError("remediation parent phase is unknown");
  if (!ids.has(phase.insertion?.insertedAfter))
    throw new TypeError("remediation insertion point is unknown");
  if (phase.route !== "csm-review" && !/^csm-[a-z0-9][a-z0-9-]{1,63}$/.test(phase.route ?? ""))
    throw new TypeError("remediation route is invalid");
  if (
    (!Array.isArray(phase.requirementDelta) &&
      (!phase.requirementDelta || typeof phase.requirementDelta !== "object")) ||
    Object.keys(phase.requirementDelta ?? {}).length === 0
  )
    throw new TypeError("remediation requirement delta is required");
  if (!Array.isArray(phase.acceptanceSignals) || phase.acceptanceSignals.length === 0)
    throw new TypeError("remediation acceptance signals are required");
  if (!Array.isArray(phase.approvalScope))
    throw new TypeError("remediation approval scope is required");
  if (
    phase.insertion.insertedAfter === phase.phaseId ||
    phase.dependencies?.includes(phase.phaseId)
  )
    throw new TypeError("remediation insertion creates a cycle");
  if (phase.graphRevision !== graph.graphRevision + 1)
    throw new TypeError("remediation graph revision is stale");
  if (!Number.isInteger(phase.remediationBudget) || phase.remediationBudget < 1)
    throw new TypeError("remediation budget is exhausted");
  if (
    !phase.idempotency?.key ||
    !["read-only", "required", "natural"].includes(phase.idempotency?.mode)
  )
    throw new TypeError("remediation idempotency policy is required");
  if (
    phase.idempotency.mode !== "read-only" &&
    (existingEffects.has(phase.idempotency.key) ||
      list(phase.sideEffects).some((effect) => existingEffects.has(effect)))
  )
    throw new TypeError("remediation repeats a non-idempotent effect");
  const insertionPoint = phase.insertedAfter ?? phase.insertion.insertedAfter;
  if (insertionPoint !== phase.insertion.insertedAfter)
    throw new TypeError("remediation insertion points disagree");
  const dependencyGraph = new Map(
    [...phases, phase].map((item) => [
      item.phaseId,
      [...list(item.dependencies), ...(item.parentPhaseId ? [item.parentPhaseId] : [])],
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new TypeError("remediation insertion creates a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencyGraph.get(id) ?? []) {
      if (!dependencyGraph.has(dependency))
        throw new TypeError("remediation dependency is unknown");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  visit(phase.phaseId);
  const byId = new Map(phases.map((item) => [item.phaseId, item]));
  let cursor = phase.parentPhaseId;
  while (cursor !== null) {
    if (cursor === phase.phaseId) throw new TypeError("remediation parentage creates a cycle");
    cursor = byId.get(cursor)?.parentPhaseId ?? null;
  }
}

export function coordinateFinalReview({
  graph,
  phase: _phase,
  review,
  remediation,
  completedEffects = new Set(),
  route = "csm-review",
  _injected = false,
} = {}) {
  const provenanceFailures = validateReviewProvenance(review, graph?.runId);
  if (review?.status === "ACCEPTED" && review[HOST_REVIEW] !== true)
    provenanceFailures.push("review was not produced by the host review invocation path");
  if (review?.status === "ACCEPTED" && provenanceFailures.length)
    return Object.freeze({
      schema: "csm-orchestrate-final-review/2",
      status: "INCOMPLETE",
      finalReview: review,
      graph,
      routing: { route, reason: "untrusted-review-provenance", domainAudit: false },
    });
  if (
    review.status === "ACCEPTED" &&
    review.provenance?.mode === "host-backed" &&
    review.runId === graph?.runId &&
    Array.isArray(review.findings) &&
    Array.isArray(review.technical) &&
    review.technical.length > 0 &&
    Array.isArray(review.functional) &&
    review.functional.length > 0 &&
    review.evidenceEntailment === "supported" &&
    Array.isArray(review.requirementCoverage) &&
    review.requirementCoverage.length > 0
  )
    return Object.freeze({
      schema: "csm-orchestrate-final-review/2",
      status: "VERIFIED",
      finalReview: review,
      graph,
    });
  if (review.status === "ACCEPTED")
    return Object.freeze({
      schema: "csm-orchestrate-final-review/2",
      status: "INCOMPLETE",
      finalReview: review,
      graph,
      routing: { route, reason: "unbound-final-review", domainAudit: false },
    });
  if (!remediation)
    return Object.freeze({
      schema: "csm-orchestrate-final-review/2",
      status: "INCOMPLETE",
      finalReview: review,
      graph,
      routing: { route, reason: "final-review-failed", domainAudit: false },
    });
  assertInsertion(graph, remediation, completedEffects);
  const nextGraph = {
    ...graph,
    graphRevision: remediation.graphRevision,
    phases: [
      ...graph.phases,
      Object.freeze({
        ...remediation,
        reviewFindings: Object.freeze(list(review.findings)),
        sourceReviewId: review.reviewId,
        acceptanceContract: Object.freeze({
          signals: Object.freeze(list(remediation.acceptanceSignals)),
          requiresIndependentReview: true,
          requiresTechnicalAndFunctionalGates: true,
          evidenceRequired: true,
        }),
        insertion: { ...remediation.insertion, mode: "insert" },
        status: "planned",
      }),
    ],
  };
  const riskClass = review.findings.some((item) => item.severity === "critical")
    ? "critical"
    : "high";
  return Object.freeze({
    schema: "csm-orchestrate-final-review/2",
    status: "REMEDIATION_REQUIRED",
    finalReview: review,
    graph: nextGraph,
    remediation: nextGraph.phases.at(-1),
    routing: {
      route,
      riskClass,
      risk: review.findings.map((item) => item.code),
      domainAudit: false,
    },
  });
}

export const createAcceptanceReview = reviewAcceptance;
export const runFinalReview = coordinateFinalReview;
