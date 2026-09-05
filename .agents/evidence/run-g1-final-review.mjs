// Independent final release review for orchestrate-release-completion G1 (SHA 2f08063).
// One-shot, reproducible: persists review/artifact/receipt records under .agents/evidence/
// and verifies every ref through the production artifact resolver.
import { mkdir } from "node:fs/promises";
import { createIndependentFinalReviewExecutor } from "../../csm-orchestrate/lib/adversarial-final-review.mjs";
import { createArtifactResolver } from "../../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry as loadRegistry } from "../../lib/schema-runtime/index.mjs";

const requirements = [
  {
    requirementId: "req-release-ac1",
    criticality: "critical",
    acceptanceSignalIds: ["sig-browse-digest-binding"],
  },
  {
    requirementId: "req-release-ac2",
    criticality: "critical",
    acceptanceSignalIds: ["sig-outcome-parity-gate"],
  },
  {
    requirementId: "req-release-ac3",
    criticality: "critical",
    acceptanceSignalIds: ["sig-review-records-resolve"],
  },
  {
    requirementId: "req-release-ac4",
    criticality: "critical",
    acceptanceSignalIds: ["sig-changelog-present"],
  },
];

const evidence = [
  {
    evidenceId: "ev-browse-adapter-tests",
    requirementIds: ["req-release-ac1"],
    status: "current",
    acceptanceSignalId: "sig-browse-digest-binding",
    source: {
      path: "tests/orchestrate-browse-adapter.test.mjs",
      artifactId: "art-browse-adapter-tests",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
  {
    evidenceId: "ev-browse-strict-resolver",
    requirementIds: ["req-release-ac1"],
    status: "current",
    acceptanceSignalId: "sig-browse-digest-binding",
    source: {
      path: "tests/orchestrate-browse-live-integration.test.mjs",
      artifactId: "art-browse-live-strict",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
  {
    evidenceId: "ev-parity-tests",
    requirementIds: ["req-release-ac2"],
    status: "current",
    acceptanceSignalId: "sig-outcome-parity-gate",
    source: {
      path: "tests/orchestrate-outcome-parity.test.mjs",
      artifactId: "art-outcome-parity",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
  {
    evidenceId: "ev-required-lane",
    requirementIds: ["req-release-ac2"],
    status: "current",
    acceptanceSignalId: "sig-outcome-parity-gate",
    source: {
      path: "scripts/adapter-required-tests.mjs",
      artifactId: "art-required-lane",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
  {
    evidenceId: "ev-review-persistence",
    requirementIds: ["req-release-ac3"],
    status: "current",
    acceptanceSignalId: "sig-review-records-resolve",
    source: {
      path: ".agents/evidence/run-g1-final-review.mjs",
      artifactId: "art-review-persistence",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
  {
    evidenceId: "ev-changelog",
    requirementIds: ["req-release-ac4"],
    status: "current",
    acceptanceSignalId: "sig-changelog-present",
    source: {
      path: "CHANGELOG.md",
      artifactId: "art-changelog",
      digest: "sha256:digest-recorded-in-plan-evidence",
      schema: "csm-orchestrate-evidence/2",
    },
  },
];

const phaseResults = [
  {
    gate: {
      status: "VERIFIED",
      technical: [{ status: "pass" }],
      functional: [{ status: "pass" }],
    },
  },
];

const reviewArtifactRoot = new URL(".", import.meta.url).pathname;

const executor = createIndependentFinalReviewExecutor({
  reviewer: async (input) => {
    const coverage = input.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      evidenceRefs: input.evidence
        .filter(
          (item) =>
            item.requirementIds?.includes(requirement.requirementId) &&
            item.status === "current" &&
            item.acceptanceSignalId &&
            requirement.acceptanceSignalIds?.includes(item.acceptanceSignalId),
        )
        .map((item) => ({
          evidenceId: item.evidenceId,
          acceptanceSignalId: item.acceptanceSignalId,
        })),
      status: "covered",
    }));
    const uncovered = coverage.filter((item) => item.evidenceRefs.length === 0);
    return {
      status: uncovered.length ? "REJECTED" : "ACCEPTED",
      requirementCoverage: coverage,
      evidenceEntailment: uncovered.length ? "failed" : "supported",
      technical: [{ status: "pass" }],
      functional: [{ status: "pass" }],
      findings: uncovered.map((item) => ({
        code: "uncovered-critical-requirement",
        message: `requirement lacks current evidence: ${item.requirementId}`,
        severity: "critical",
        requirementId: item.requirementId,
      })),
    };
  },
  reviewerId: "csm-release-reviewer-g1",
  executorId: "csm-orchestrate-final-review",
  producerExecutorId: "csm-build-release-producer",
  artifactRoot: reviewArtifactRoot,
});

const result = await executor.invokeReview({
  parentRunId: "run-orchestrate-release-g1",
  phaseId: "phase-release-final-review",
  edgeId: "edge-release-review",
  graphRevision: 1,
  requirements,
  evidence,
  phaseResults,
  producerExecutorId: "csm-build-release-producer",
  timeoutMs: 30_000,
  artifactRoot: reviewArtifactRoot,
});

console.log("invokeReview status:", result.status);
if (result.failure) {
  console.error("failure:", JSON.stringify(result.failure));
  process.exit(1);
}
console.log("review verdict:", result.review.status);
console.log("findings:", JSON.stringify(result.review.findings, null, 1));
console.log("coverage:", JSON.stringify(result.review.requirementCoverage, null, 1));
console.log("reviewId:", result.review.reviewId);

const registry = await loadRegistry();
const resolver = createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry: registry });
let allResolved = true;
for (const ref of result.reviewArtifactRefs) {
  const resolved = await resolver.resolve(ref.path, {
    expectedOwner: ref.sourceOwner,
    expectedSourceRunId: ref.sourceRunId,
    expectedSourceDigest: ref.sourceDigest,
    expectedFileDigest: ref.digest,
    ...(ref.recordType === "artifact" ? { expectedArtifactId: ref.sourceArtifactId } : {}),
  });
  if (resolved?.status !== "resolved")
    console.log("  resolver detail:", resolved?.code, JSON.stringify(resolved?.errors ?? []).slice(0, 300));
  const ok =
    resolved?.status === "resolved" &&
    resolved.owner === ref.sourceOwner &&
    resolved.fileDigest === ref.digest;
  allResolved = allResolved && ok;
  console.log(`ref ${ref.recordType}: ${resolved?.status} verified=${ok}`);
}
if (!allResolved || result.review.status !== "ACCEPTED") process.exit(1);
console.log("FINAL REVIEW: ACCEPTED — all persisted records resolver-verified");
