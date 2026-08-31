import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGates,
  reconcileRequirementEvidence,
} from "../csm-orchestrate/lib/evidence-gates.mjs";
import { reviewAcceptance } from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import { validateFinalOutcome } from "../csm-orchestrate/lib/contracts.mjs";

const digest = `sha256:${"a".repeat(64)}`;

function ledger(signal = "sig-exact") {
  return {
    schema: "csm-orchestrate-requirement/2",
    ledgerId: "ledger-entailment",
    requirements: [
      {
        requirementId: "req-critical",
        criticality: "critical",
        status: "open",
        acceptanceSignalIds: [signal],
        evidenceRefs: [
          {
            evidenceId: "ev-result",
            requirementId: "req-critical",
            acceptanceSignalId: signal,
            digest,
          },
        ],
      },
    ],
  };
}

function evidence({
  requirementIds = ["req-critical"],
  signal = "sig-exact",
  status = "current",
} = {}) {
  return {
    evidence: [
      {
        evidenceId: "ev-result",
        status,
        digest,
        requirementIds,
        acceptanceSignalId: signal,
      },
    ],
    failures: [],
  };
}

test("only current evidence with the exact requirement signal verifies a critical requirement", () => {
  const result = reconcileRequirementEvidence(ledger(), evidence());
  assert.equal(result.requirements[0].status, "verified");
  assert.equal(result.requirements[0].evidenceRefs[0].status, "available");

  const wrongSignal = reconcileRequirementEvidence(ledger(), evidence({ signal: "sig-unrelated" }));
  assert.equal(wrongSignal.requirements[0].status, "unverified");
  assert.equal(wrongSignal.failures.at(-1).code, "critical-evidence-contradicted");
});

test("current but foreign or unrelated evidence cannot satisfy a critical requirement", () => {
  const result = reconcileRequirementEvidence(
    ledger(),
    evidence({ requirementIds: ["req-other"] }),
  );
  assert.equal(result.requirements[0].status, "unverified");
  assert.equal(result.failures[0].code, "evidence-binding-mismatch");
  assert.equal(result.failures.at(-1).code, "critical-evidence-contradicted");
});

test("stale evidence remains unavailable even when its digest and signal are current", () => {
  const result = reconcileRequirementEvidence(ledger(), evidence({ status: "stale" }));
  assert.equal(result.requirements[0].status, "unverified");
  assert.equal(result.requirements[0].evidenceRefs[0].status, "stale");
  assert.equal(result.failures.at(-1).code, "critical-evidence-stale");
});

test("technical success does not mask a failed functional gate", () => {
  const result = aggregateGates({
    runId: "run-entailment",
    phaseId: "phase-entailment",
    technical: [{ id: "schema", status: "pass" }],
    functional: [{ id: "behavior", status: "fail" }],
  });
  assert.equal(result.technical.status, "pass");
  assert.equal(result.functional.status, "fail");
  assert.equal(result.status, "FAILED");
  assert.equal(
    result.failures.some((item) => item.class === "functional"),
    true,
  );
});

test("false VERIFIED is rejected when acceptance evidence does not entail the requirement", () => {
  const review = reviewAcceptance({
    runId: "run-false-verified",
    requirements: [
      {
        requirementId: "req-critical",
        criticality: "critical",
        acceptanceSignalIds: ["sig-exact"],
      },
    ],
    claims: [
      {
        requirementIds: ["req-critical"],
        evidenceRefs: [{ evidenceId: "ev-result", acceptanceSignalId: "sig-wrong" }],
      },
    ],
    evidence: [
      {
        evidenceId: "ev-result",
        status: "current",
        requirementIds: ["req-critical"],
        acceptanceSignalId: "sig-wrong",
      },
    ],
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    completion: true,
  });
  assert.equal(review.status, "REJECTED");
  assert.throws(
    () =>
      validateFinalOutcome(
        { requirements: [{ criticality: "critical", status: "unverified" }] },
        { status: "VERIFIED" },
      ),
    /unresolved critical requirements/,
  );
});
