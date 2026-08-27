import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateGates,
  reconcileChildArtifacts,
  reconcileRequirementEvidence,
} from "../csm-orchestrate/lib/evidence-gates.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const schemaRegistry = {
  resolve() {},
  validate(_schema, value) {
    return {
      valid: value?.schema === "csm-build-state/1" || value?.schema === "csm-fixture/1",
      errors: [],
    };
  },
};

test("technical and functional results remain separate and functional failure is not masked", () => {
  const receipt = aggregateGates({
    runId: "run-gates-test",
    phaseId: "phase-gates-test",
    technical: [{ id: "typecheck", status: "pass", evidenceRefs: ["ev-tech"] }],
    functional: [{ id: "scenario-1", status: "fail", evidenceRefs: ["ev-fn"] }],
    evidence: [
      {
        evidenceId: "ev-tech",
        digest,
        owner: "csm-build",
        source: { path: "tech.json", schema: "csm-build-state/1" },
      },
      {
        evidenceId: "ev-fn",
        digest,
        owner: "csm-bdd-tdd",
        source: { path: "fn.json", schema: "csm-bdd-tdd-spec/1" },
      },
    ],
  });
  assert.equal(receipt.technical.status, "pass");
  assert.equal(receipt.functional.status, "fail");
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.sourceLineage.length, 2);
  assert.equal(receipt.failures[0].class, "functional");
});

test("critical requirements require current evidence, not narrative completion", () => {
  const result = reconcileRequirementEvidence(
    {
      schema: "csm-orchestrate-requirement/1",
      ledgerId: "ledger-gates-test",
      requirements: [
        {
          requirementId: "req-critical",
          criticality: "critical",
          statement: "the outcome works",
          status: "verified",
          evidenceRefs: [
            { evidenceId: "ev-stale", kind: "functional", status: "available", digest },
          ],
        },
      ],
    },
    { evidence: [{ evidenceId: "ev-stale", status: "stale", digest }], failures: [] },
  );
  assert.equal(result.requirements[0].status, "unverified");
  assert.equal(result.failures[0].class, "stale");
});

test("waiver is explicit and does not turn a stale artifact into current evidence", () => {
  const result = reconcileRequirementEvidence(
    {
      schema: "csm-orchestrate-requirement/1",
      ledgerId: "ledger-waived",
      requirements: [
        {
          requirementId: "req-waived",
          criticality: "critical",
          statement: "accepted risk",
          status: "verified",
          waiver: "operator accepted risk",
          evidenceRefs: [],
        },
      ],
    },
    { evidence: [], failures: [] },
  );
  assert.equal(result.requirements[0].status, "waived");
  assert.equal(result.failures.length, 0);
});

test("missing technical or functional gates are incomplete", () => {
  const result = aggregateGates({
    runId: "run-missing-gates",
    phaseId: "phase-missing-gates",
    technical: [],
    functional: [],
  });
  assert.equal(result.technical.status, "incomplete");
  assert.equal(result.functional.status, "incomplete");
  assert.equal(result.status, "INCOMPLETE");
});

const artifactRef = {
  evidenceId: "ev-resolved",
  kind: "technical",
  owner: "csm-build",
  sourceRunId: "run-child-resolved",
  schema: "csm-build-state/1",
  fileDigest: digest,
  path: "state.json",
};

test("host evidence without a resolver is not accepted", async () => {
  await assert.rejects(
    reconcileChildArtifacts({ refs: [artifactRef] }),
    /artifact resolver is required/,
  );
});

test("stale and foreign resolved artifacts remain unavailable", async () => {
  const result = await reconcileChildArtifacts({
    refs: [{ ...artifactRef, status: "stale" }],
    expectedOwner: "csm-build",
    expectedRunId: "run-child-resolved",
    schemaRegistry,
    resolver: {
      async resolve(path) {
        return {
          status: "resolved",
          path,
          owner: "csm-other",
          fileDigest: digest,
          value: {
            evidenceId: "ev-resolved",
            kind: "technical",
            owner: "csm-other",
            runId: "run-foreign",
            schema: "csm-build-state/1",
            digest,
          },
        };
      },
    },
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.failures[0].code, "ownership-mismatch");
});

test("resolver-backed evidence is current only when identity is complete", async () => {
  const result = await reconcileChildArtifacts({
    refs: [artifactRef],
    expectedOwner: "csm-build",
    expectedRunId: "run-child-resolved",
    schemaRegistry,
    resolver: {
      async resolve(path) {
        return {
          status: "resolved",
          path,
          owner: "csm-build",
          fileDigest: digest,
          value: {
            evidenceId: "ev-resolved",
            kind: "technical",
            owner: "csm-build",
            runId: "run-child-resolved",
            schema: "csm-build-state/1",
            digest,
          },
        };
      },
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.evidence[0].status, "current");
});

test("resolved artifact values are rejected when their registered schema does not validate", async () => {
  const result = await reconcileChildArtifacts({
    refs: [artifactRef],
    expectedOwner: "csm-build",
    expectedRunId: "run-child-resolved",
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: false, errors: [] };
      },
    },
    resolver: {
      async resolve(path) {
        return {
          status: "resolved",
          path,
          owner: "csm-build",
          fileDigest: digest,
          value: {
            evidenceId: "ev-resolved",
            kind: "technical",
            owner: "csm-build",
            runId: "run-child-resolved",
            schema: "csm-build-state/1",
            digest,
          },
        };
      },
    },
  });
  assert.equal(result.failures[0].code, "schema-invalid");
});
