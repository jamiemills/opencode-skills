"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { checkPromotionGates } from "../../lib/rollout/promotion.mjs";

function gateEvidence(passed, failed = 0, details = null) {
  return details === null ? { passed, failed } : { passed, failed, details };
}

function fullLocalEvidence() {
  return {
    G0: gateEvidence(12),
    G1: gateEvidence(38),
    G2: gateEvidence(9),
    G3: gateEvidence(6),
    G4: gateEvidence(11),
  };
}

function fullDeploymentEvidence() {
  return {
    G5: gateEvidence(3, 0, "independent reviewer acceptance"),
    G6: gateEvidence(4),
    G7: gateEvidence(2),
    G8: gateEvidence(1, 0, "canary + exercised rollback"),
  };
}

test("promotion: all nine gates passing makes the review promotable", () => {
  const review = checkPromotionGates({
    local: fullLocalEvidence(),
    deployment: fullDeploymentEvidence(),
  });
  assert.equal(review.promotable, true);
  assert.equal(review.gates.length, 9);
  assert.ok(review.gates.every((gate) => gate.status === "pass"));
  assert.deepEqual(
    review.gates.map((gate) => gate.id),
    ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"],
  );
  const g8 = review.gates.find((gate) => gate.id === "G8");
  assert.equal(g8.evidence.source, "deployment");
  assert.equal(g8.evidence.details, "canary + exercised rollback");
});

test("promotion: a single failed gate blocks promotion", () => {
  const local = fullLocalEvidence();
  local.G2 = gateEvidence(8, 1, "forgery regression");
  const review = checkPromotionGates({ local, deployment: fullDeploymentEvidence() });
  assert.equal(review.promotable, false);
  const gate = review.gates.find((entry) => entry.id === "G2");
  assert.equal(gate.status, "fail");
  assert.equal(gate.evidence.failed, 1);
  assert.equal(gate.evidence.source, "local");
});

test("promotion: G5-G8 are blocked without deployment evidence", () => {
  const review = checkPromotionGates({ local: fullLocalEvidence() });
  assert.equal(review.promotable, false);
  for (const gateId of ["G5", "G6", "G7", "G8"]) {
    const gate = review.gates.find((entry) => entry.id === gateId);
    assert.equal(gate.status, "blocked", `${gateId} must be blocked`);
    assert.equal(gate.reason, "deployment-evidence-required");
    assert.equal(gate.evidence, null);
  }
  for (const gateId of ["G0", "G1", "G2", "G3", "G4"]) {
    const gate = review.gates.find((entry) => entry.id === gateId);
    assert.equal(gate.status, "pass", `${gateId} accepts local evidence`);
  }
});

test("promotion: local evidence never satisfies the deployment-only gates", () => {
  const local = fullLocalEvidence();
  local.G5 = gateEvidence(50);
  local.G8 = gateEvidence(50);
  const review = checkPromotionGates({ local, deployment: fullDeploymentEvidence() });
  assert.equal(review.promotable, true);
  const g5 = review.gates.find((gate) => gate.id === "G5");
  assert.equal(g5.evidence.source, "deployment");
  assert.equal(g5.ignoredLocalEvidence, true);
  const g8 = review.gates.find((gate) => gate.id === "G8");
  assert.equal(g8.ignoredLocalEvidence, true);

  const blocked = checkPromotionGates({ local });
  const g5Blocked = blocked.gates.find((gate) => gate.id === "G5");
  assert.equal(g5Blocked.status, "blocked");
  assert.equal(g5Blocked.reason, "deployment-evidence-required");
  assert.equal(g5Blocked.ignoredLocalEvidence, true);
});

test("promotion: missing local evidence for G0-G4 blocks rather than passes", () => {
  const local = fullLocalEvidence();
  delete local.G3;
  const review = checkPromotionGates({ local, deployment: fullDeploymentEvidence() });
  assert.equal(review.promotable, false);
  const gate = review.gates.find((entry) => entry.id === "G3");
  assert.equal(gate.status, "blocked");
  assert.equal(gate.reason, "no-evidence");
  assert.equal(gate.evidence, null);
});

test("promotion: zero-count evidence is blocked as no positive evidence", () => {
  const local = fullLocalEvidence();
  local.G1 = gateEvidence(0, 0);
  const review = checkPromotionGates({ local, deployment: fullDeploymentEvidence() });
  const gate = review.gates.find((entry) => entry.id === "G1");
  assert.equal(gate.status, "blocked");
  assert.equal(gate.reason, "no-positive-evidence");
  assert.equal(review.promotable, false);
});

test("promotion: deployment evidence may satisfy the local gates and wins over local failures", () => {
  const local = fullLocalEvidence();
  local.G1 = gateEvidence(10, 2);
  const review = checkPromotionGates({
    local,
    deployment: { ...fullDeploymentEvidence(), G1: gateEvidence(14) },
  });
  const gate = review.gates.find((entry) => entry.id === "G1");
  assert.equal(gate.status, "pass");
  assert.equal(gate.evidence.source, "deployment");
  assert.equal(review.promotable, true);

  const localOnly = checkPromotionGates({ local });
  assert.equal(localOnly.gates.find((entry) => entry.id === "G1").status, "fail");
  assert.equal(localOnly.promotable, false);
});

test("promotion: malformed evidence fails closed", () => {
  assert.throws(
    () => checkPromotionGates(null),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ local: "nope" }),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ local: { G0: { passed: -1, failed: 0 } } }),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ local: { G0: { passed: 1.5, failed: 0 } } }),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ local: { G0: { failed: 0 } } }),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ local: { G9: gateEvidence(1) } }),
    (error) => error.code === "invalid-evidence",
  );
  assert.throws(
    () => checkPromotionGates({ surprise: {} }),
    (error) => error.code === "invalid-evidence",
  );
});

test("promotion: the review is frozen", () => {
  const review = checkPromotionGates({
    local: fullLocalEvidence(),
    deployment: fullDeploymentEvidence(),
  });
  assert.throws(() => {
    review.promotable = false;
  }, TypeError);
  assert.throws(() => {
    review.gates[0].status = "fail";
  }, TypeError);
});
