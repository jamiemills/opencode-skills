import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const digestA = `sha256:${"a".repeat(64)}`;

export function reviewEvidenceRoot(prefix = "orchestrate-review-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function approachFor(runId, ideaSlug) {
  return {
    schema: "csm-approach/1",
    schemaRevision: 1,
    status: "agreed",
    runId,
    ideaSlug,
    phases: [
      {
        phaseId: "P1",
        title: "Deliver",
        goal: "build the change",
        deliverables: ["working result"],
        scope: ["repository"],
        outOfScope: ["production"],
        constraints: [],
        acceptanceHints: ["technical pass", "functional pass"],
        context: [],
        dependencies: [],
      },
    ],
  };
}

export function hostFixture({ ideaSlug } = {}) {
  let calls = 0;
  const artifacts = new Map();
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill(request) {
      calls += 1;
      const requirementIds = request.phaseId?.startsWith("phase-remediation")
        ? ["req-remediation-p1"]
        : [request.phaseId?.replace(/^phase-/, "req-") ?? `req-${ideaSlug}-p1`];
      const item = {
        evidenceId: `ev-result-${calls}`,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        digest: digestA,
        requirementIds,
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: `fixture-${calls}.json`,
          artifactId: `art-result-${calls}`,
          digest: digestA,
          schema: "csm-fixture/1",
          sourceRunId: request.childRunId,
        },
      };
      artifacts.set(item.source.path, item);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [item.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [item.evidenceId] }],
        evidence: [item],
        childReceipt: {
          receiptId: `receipt-child-${calls}`,
          schema: "csm-fixture-receipt/1",
          runId: request.childRunId,
          digest: `sha256:${"b".repeat(64)}`,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        if (path.startsWith("review-"))
          return {
            status: "resolved",
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: {
              artifactId: expected.expectedArtifactId,
              sourceRunId: expected.expectedSourceRunId,
            },
          };
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: `missing artifact: ${path}` };
        return {
          status: "resolved",
          path,
          owner: item.owner,
          fileDigest: item.digest,
          value: {
            ...item,
            schema: item.source.schema,
            artifactId: item.source.artifactId,
            sourceRunId: item.source.sourceRunId,
          },
        };
      },
    },
  };
}

export async function workingOptions({
  runId,
  ideaSlug = "e2e",
  finalReview,
  remediationFactory,
  capabilities,
}) {
  const loaded = capabilities ?? (await loadCapabilities());
  const base = hostFixture({ ideaSlug });
  const reviewArtifactRoot = reviewEvidenceRoot(`review-${ideaSlug}-`);
  const reviewSchemaRegistry = await loadSchemaRegistry();
  const host = {
    ...base,
    async invokeReview(request) {
      const review = await finalReview(request);
      review.schema = "csm-orchestrate-adversarial-review/2";
      review.phaseId = request.phaseId;
      review.provenance = {
        ...review.provenance,
        mode: "host-backed",
        reviewer: review.provenance?.reviewer ?? "csm-test-host",
        owner: review.provenance?.owner ?? "csm-test-host",
        reviewerChildRunId: review.provenance?.reviewerChildRunId ?? `run-review-${ideaSlug}-child`,
        receipt: {
          artifactId: "art-review-receipt",
          runId: review.provenance?.reviewerChildRunId ?? `run-review-${ideaSlug}-child`,
          digest: review.provenance?.receipt?.digest ?? `sha256:${"c".repeat(64)}`,
          owner: review.provenance?.owner ?? "csm-test-host",
          schema: "csm-review-receipt/1",
          path: "review-receipt.json",
          resolution: "fixture",
        },
        artifact: {
          artifactId: "art-review",
          runId: review.provenance?.reviewerChildRunId ?? `run-review-${ideaSlug}-child`,
          digest: review.provenance?.artifact?.digest ?? `sha256:${"d".repeat(64)}`,
          owner: review.provenance?.owner ?? "csm-test-host",
          schema: "csm-orchestrate-adversarial-review/2",
          path: "review-artifact.json",
          resolution: "fixture",
        },
        approval: {
          ...review.provenance?.approval,
          approvalId: review.provenance?.approval?.approvalId ?? `approval-review-${ideaSlug}`,
          edgeId: request.edgeId,
          phaseId: request.phaseId,
          parentRunId: runId,
          reviewerChildRunId:
            review.provenance?.reviewerChildRunId ?? `run-review-${ideaSlug}-child`,
          approvedDigest: review.provenance?.artifact?.digest ?? `sha256:${"d".repeat(64)}`,
        },
      };
      return {
        review,
        reviewReceipt: review.provenance.receipt,
        reviewArtifact: review.provenance.artifact,
      };
    },
  };
  return {
    approach: approachFor(runId, ideaSlug),
    runId,
    host,
    calls: () => base.calls,
    capabilities: loaded,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    approvals: async ({ phase, node, childRunId }) => ({
      schema: "csm-orchestrate-approval/1",
      approvalId: `approval-${childRunId}`,
      binding: {
        parentRunId: runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: node.approvalScope.length ? node.approvalScope : ["read"],
      approvedDigest: node.capabilityDigest,
      approvedAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2099-08-27T00:00:00.000Z",
      status: "approved",
    }),
    now: () => new Date("2026-08-27T12:00:00Z"),
    cursorStore: {
      cursors: new Map(),
      async saveCursor(cursor) {
        this.cursors.set(cursor.cursorId, cursor);
      },
      async loadCursor(cursorId) {
        return this.cursors.get(cursorId) ?? null;
      },
    },
    artifactResolver: createArtifactResolver({
      root: reviewArtifactRoot,
      schemaRegistry: reviewSchemaRegistry,
    }),
    childArtifactResolver: base.artifactResolver,
    reviewArtifactRoot,
    reviewSchemaRegistry,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
    remediationFactory,
  };
}

export function rejectedReview({ runId, phaseResults, evidence }) {
  return {
    schema: "csm-orchestrate-adversarial-review/1",
    reviewId: `review-rejected-${phaseResults.length}-${evidence.length}`,
    runId,
    status: "REJECTED",
    independent: true,
    provenance: { mode: "host-backed" },
    requirementCoverage: phaseResults.flatMap(({ phase }) =>
      phase.requirementIds.map((requirementId) => ({
        requirementId,
        evidenceRefs: evidence
          .filter((item) => item.requirementIds?.includes(requirementId))
          .map((item) => item.evidenceId),
      })),
    ),
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    findings: [{ code: "gap", severity: "high" }],
  };
}

export function acceptedReview({ runId, phaseResults, evidence }) {
  return {
    schema: "csm-orchestrate-adversarial-review/1",
    reviewId: `review-accepted-${phaseResults.length}-${evidence.length}`,
    runId,
    status: "ACCEPTED",
    independent: true,
    provenance: { mode: "host-backed" },
    requirementCoverage: phaseResults.flatMap(({ phase }) =>
      phase.requirementIds.map((requirementId) => ({
        requirementId,
        evidenceRefs: evidence
          .filter(
            (item) =>
              item.requirementIds?.includes(requirementId) &&
              item.status === "current" &&
              item.acceptanceSignalId &&
              phase.acceptanceSignalIds?.includes(item.acceptanceSignalId),
          )
          .map((item) => ({
            evidenceId: item.evidenceId,
            acceptanceSignalId: item.acceptanceSignalId,
          })),
      })),
    ),
    evidenceEntailment: "supported",
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    findings: [],
  };
}

export function remediationFor({ graph, key, parentPhaseId, insertedAfter }) {
  return {
    phaseId: `phase-remediation-${key}`,
    parentPhaseId,
    graphRevision: graph.graphRevision + 1,
    insertion: { insertedAfter },
    route: "csm-ddd",
    requirementDelta: ["req-remediation-p1"],
    requirementIds: ["req-remediation-p1"],
    acceptanceSignals: ["reviewed"],
    approvalScope: ["read", "execute"],
    idempotency: { key: `remediation-${key}`, mode: "natural" },
    sideEffects: ["read-only"],
    remediationBudget: 1,
  };
}
