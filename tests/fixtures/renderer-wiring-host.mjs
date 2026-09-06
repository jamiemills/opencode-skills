"use strict";

// Minimal read-only fixture host for renderer-wiring driver tests. Digests are
// constants: the evidence schema pins the sha256 form, and the orchestrator's
// identity checks are expectation-echo based, so no hashing is needed here.
const DIGEST = "sha256:" + "a".repeat(64);

export default function hostFixture() {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const source = {
        path: "result-1.json",
        artifactId: "art-result-1",
        digest: DIGEST,
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId: "ev-render-wiring-1",
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        validation: { signal: "fixture deliverable produced", status: "pass" },
        source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-render-wiring-1",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: DIGEST,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return {
          status: "resolved",
          path,
          owner: expected.expectedOwner ?? item.owner,
          fileDigest: expected.expectedFileDigest ?? item.source.digest,
          value: item,
        };
      },
    },
  };
}
