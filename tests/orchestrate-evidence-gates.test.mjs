import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateGates,
  reconcileChildArtifacts,
  reconcileRequirementEvidence,
} from "../csm-orchestrate/lib/evidence-gates.mjs";
import { reviewAcceptance } from "../csm-orchestrate/lib/adversarial-final-review.mjs";

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

test("acceptance evidence requires the exact declared signal", () => {
  const base = {
    runId: "run-signal-test",
    requirements: [
      { requirementId: "req-signal", criticality: "critical", acceptanceSignalIds: ["sig-exact"] },
    ],
    claims: [
      {
        requirementIds: ["req-signal"],
        acceptanceSignalId: "sig-wrong",
        evidenceRefs: [{ evidenceId: "ev-signal", acceptanceSignalId: "sig-wrong" }],
      },
    ],
    evidence: [
      {
        evidenceId: "ev-signal",
        status: "current",
        requirementIds: ["req-signal"],
        acceptanceSignalId: "sig-wrong",
      },
    ],
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    completion: true,
  };
  assert.equal(reviewAcceptance(base).status, "REJECTED");
  assert.equal(
    reviewAcceptance({
      ...base,
      claims: [
        {
          ...base.claims[0],
          acceptanceSignalId: "sig-exact",
          evidenceRefs: [{ evidenceId: "ev-signal", acceptanceSignalId: "sig-exact" }],
        },
      ],
      evidence: [{ ...base.evidence[0], acceptanceSignalId: "sig-exact" }],
    }).status,
    "ACCEPTED",
  );
});

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
            {
              evidenceId: "ev-stale",
              kind: "functional",
              requirementId: "req-critical",
              status: "available",
              digest,
            },
          ],
        },
      ],
    },
    {
      evidence: [
        { evidenceId: "ev-stale", status: "stale", digest, requirementIds: ["req-critical"] },
      ],
      failures: [],
    },
  );
  assert.equal(result.requirements[0].status, "unverified");
  assert.equal(result.failures[0].class, "stale");
});

test("critical evidence requires a declared exact signal", () => {
  const ledger = {
    schema: "csm-orchestrate-requirement/2",
    ledgerId: "ledger-signal-binding",
    requirements: [
      {
        requirementId: "req-signal-binding",
        criticality: "critical",
        acceptanceSignalIds: ["sig-declared"],
        evidenceRefs: [
          {
            evidenceId: "ev-signal-binding",
            requirementId: "req-signal-binding",
            digest,
            acceptanceSignalId: "sig-forged",
          },
        ],
      },
    ],
  };
  const evidence = {
    evidence: [
      {
        evidenceId: "ev-signal-binding",
        status: "current",
        digest,
        requirementIds: ["req-signal-binding"],
        acceptanceSignalId: "sig-forged",
      },
    ],
    failures: [],
  };
  const rejected = reconcileRequirementEvidence(ledger, evidence);
  assert.equal(rejected.requirements[0].status, "unverified");
  assert.equal(rejected.failures[0].code, "acceptance-signal-mismatch");
  const accepted = reconcileRequirementEvidence(
    {
      ...ledger,
      requirements: [
        {
          ...ledger.requirements[0],
          evidenceRefs: [
            { ...ledger.requirements[0].evidenceRefs[0], acceptanceSignalId: "sig-declared" },
          ],
        },
      ],
    },
    { ...evidence, evidence: [{ ...evidence.evidence[0], acceptanceSignalId: "sig-declared" }] },
  );
  assert.equal(accepted.requirements[0].status, "verified");
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

test("unrelated current evidence cannot satisfy a critical requirement", () => {
  const result = reconcileRequirementEvidence(
    {
      schema: "csm-orchestrate-requirement/1",
      ledgerId: "ledger-unrelated",
      requirements: [
        {
          requirementId: "req-critical",
          criticality: "critical",
          statement: "the critical behavior works",
          status: "open",
          evidenceRefs: [
            {
              evidenceId: "ev-unrelated",
              kind: "functional",
              requirementId: "req-other",
              status: "available",
              digest,
            },
          ],
        },
      ],
    },
    {
      evidence: [
        { evidenceId: "ev-unrelated", status: "current", digest, requirementIds: ["req-other"] },
      ],
      failures: [],
    },
  );
  assert.equal(result.requirements[0].status, "unverified");
  assert.equal(result.failures[0].code, "requirement-binding-mismatch");
});
