"use strict";
// Independent final reviewer for real orchestration runs, consumed through
// run-orchestrator.mjs --final-review <module> or a host invokeReview seam
// wrapped in createIndependentFinalReviewExecutor.
//
// The reviewer is a separate acceptance layer from the producer: it re-derives
// requirement coverage and evidence entailment from the frozen review invocation
// only, checks binding invariants (evidence-requirement binding, current status,
// acceptance-signal binding, child receipt status, gate completion), and returns
// a typed ACCEPTED/REJECTED decision. The executor still runs reviewAcceptance
// authoritatively and forces REJECTED when the producer gates do not hold.

const EVIDENCE_ID = /^ev-[a-z0-9][a-z0-9-]{1,127}$/;

export function reviewCoverage(requirements = [], evidence = []) {
  const coverage = [];
  const findings = [];
  for (const requirement of requirements) {
    const requirementId = requirement.requirementId;
    const supporting = evidence.filter(
      (item) =>
        Array.isArray(item.requirementIds) &&
        item.requirementIds.includes(requirementId) &&
        item.status === "current" &&
        typeof item.evidenceId === "string" &&
        EVIDENCE_ID.test(item.evidenceId) &&
        typeof item.digest === "string" &&
        item.digest.startsWith("sha256:") &&
        (!requirement.acceptanceSignalIds?.length ||
          (item.acceptanceSignalId &&
            requirement.acceptanceSignalIds.includes(item.acceptanceSignalId))),
    );
    coverage.push({
      requirementId,
      evidenceRefs: supporting.map((item) => ({
        evidenceId: item.evidenceId,
        ...(item.acceptanceSignalId ? { acceptanceSignalId: item.acceptanceSignalId } : {}),
      })),
    });
    if (!supporting.length)
      findings.push({
        code: "uncovered-requirement",
        severity: "high",
        summary: "requirement " + requirementId + " lacks current, digest-bound evidence",
      });
  }
  return { coverage, findings };
}

export default async function independentReviewer(input) {
  const { requirements = [], evidence = [], phaseResults = [], childReceipts = [] } = input;
  const findings = [];

  const { coverage, findings: coverageFindings } = reviewCoverage(requirements, evidence);
  findings.push(...coverageFindings);

  for (const entry of phaseResults) {
    const gate = entry.gate;
    const phaseId = entry.phase?.phaseId ?? "unknown";
    if (gate?.status !== "VERIFIED")
      findings.push({
        code: "gate-not-verified",
        severity: "critical",
        summary: "phase " + phaseId + " gate is " + (gate?.status ?? "missing"),
      });
  }

  for (const receipt of childReceipts) {
    if (receipt.status !== "completed")
      findings.push({
        code: "incomplete-child",
        severity: "high",
        summary:
          "child receipt " +
          (receipt.receiptId ?? "unknown") +
          " is " +
          (receipt.status ?? "unknown"),
      });
  }

  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  for (const entry of coverage) {
    for (const ref of entry.evidenceRefs) {
      if (!evidenceIds.has(ref.evidenceId))
        findings.push({
          code: "dangling-evidence-ref",
          severity: "high",
          summary:
            "requirement " + entry.requirementId + " references unknown evidence " + ref.evidenceId,
        });
    }
  }

  const uniqueFindings = Object.values(
    Object.fromEntries(findings.map((finding) => [finding.code + ":" + finding.summary, finding])),
  );

  return {
    status: uniqueFindings.length ? "REJECTED" : "ACCEPTED",
    requirementCoverage: coverage,
    evidenceEntailment: uniqueFindings.length ? "failed" : "supported",
    technical: [
      {
        id: "independent-structural-verification",
        status: uniqueFindings.length ? "fail" : "pass",
        evidenceRefs: evidence.map((item) => item.evidenceId),
      },
    ],
    functional: [
      {
        id: "independent-requirement-coverage",
        status: uniqueFindings.length ? "fail" : "pass",
        scenarioIds: requirements.map((requirement) => requirement.requirementId),
        evidenceRefs: coverage.flatMap((entry) => entry.evidenceRefs.map((ref) => ref.evidenceId)),
      },
    ],
    findings: uniqueFindings,
  };
}
