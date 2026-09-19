// T007/P5: csm-review loop closure enforcement.
//
// Proves the acceptance signal for the csm-review loop:
//   - a review with unresolved findings cannot be saved VERIFIED;
//   - every finding carries a remediation-closure/disposition link;
//   - the per-cycle evaluator emits a binding receipt;
//   - the deterministic loop-guard fallback exits non-zero while work remains;
//   - enforcement is per-run local (no lock, no mutation).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EVALUATOR_CONTRACT,
  REVIEW_FINDINGS_SCHEMAS,
  REVIEW_FINDINGS_SCHEMA,
  REVIEW_FINDINGS_SCHEMA_V2,
  assertCanSaveVerified,
  canSaveVerified,
  closureRequired,
  createEvaluatorReceipt,
  loopGuardDecision,
  remainingWork,
  unresolvedFindings,
} from "../csm-review/lib/loop-closure.mjs";
import { validateFindingsPayload } from "../csm-review/lib/findings-validator.mjs";
import { createFindingsRenderModel } from "../csm-review/lib/findings-render.mjs";
import * as closureModule from "../csm-review/lib/loop-closure.mjs";

const root = path.join(import.meta.dirname, "..");
const guardPath = path.join(root, "csm-review/lib/loop-closure.mjs");
const fixturePath = path.join(root, "tests/fixtures/review-json/review-valid.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function closedClosure(disposition = "remediated") {
  return {
    format: "csm-review-closure/1",
    disposition,
    status: "closed",
    action: "fix-001: validate the result before returning it",
    evidence: "src/app.js:12 now fails the targeted test when the guard is removed",
  };
}

function buildV2() {
  const payload = structuredClone(fixture);
  payload.schema = REVIEW_FINDINGS_SCHEMA_V2;
  payload.schemaRevision = 2;
  payload.findings = payload.findings.map((finding) => ({
    ...finding,
    closure: closedClosure(),
  }));
  return payload;
}

function withClosure(payload, closure) {
  payload.findings[0].closure = closure;
  return payload;
}

function runGuard(record) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-review-guard-"));
  try {
    const recordPath = path.join(dir, "review.json");
    writeFileSync(recordPath, JSON.stringify(record));
    return spawnSync(process.execPath, [guardPath, "--record", recordPath], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("dual-revision contract is frozen and per-run local", () => {
  assert.deepEqual(
    [...REVIEW_FINDINGS_SCHEMAS],
    ["csm-review-findings/1", "csm-review-findings/2"],
  );
  assert.equal(REVIEW_FINDINGS_SCHEMA, "csm-review-findings/1");
  assert.equal(REVIEW_FINDINGS_SCHEMA_V2, "csm-review-findings/2");
  assert.ok(Object.isFrozen(REVIEW_FINDINGS_SCHEMAS));
  assert.equal(EVALUATOR_CONTRACT.format, "csm-evaluator-contract/1");
  assert.ok(Object.isFrozen(EVALUATOR_CONTRACT));
  assert.equal(Reflect.set(EVALUATOR_CONTRACT, "format", "tampered"), false);
  for (const name of Object.keys(closureModule))
    assert.doesNotMatch(name, /lock|mutex|semaphore/i, `unexpected lock-like export ${name}`);
});

test("the frozen /1 revision stays readable without a closure requirement", () => {
  assert.equal(closureRequired(fixture), false);
  assert.equal(validateFindingsPayload(fixture).valid, true);
  assert.equal(unresolvedFindings(fixture).length, 0);
  assert.equal(canSaveVerified(fixture), true);
});

test("every /2 finding carries a closure/disposition link and validates VERIFIED", () => {
  const payload = buildV2();
  assert.equal(closureRequired(payload), true);
  assert.equal(validateFindingsPayload(payload).valid, true);
  assert.equal(canSaveVerified(payload), true);
  for (const finding of payload.findings) {
    assert.ok(finding.closure, `${finding.id} must carry a closure`);
    assert.equal(finding.closure.status, "closed");
  }
});

test("/2 requires a closure on every finding", () => {
  const payload = buildV2();
  delete payload.findings[0].closure;
  assert.equal(validateFindingsPayload(payload).valid, false);
});

test("an unresolved finding cannot be saved VERIFIED", () => {
  const payload = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "remediation not yet scheduled",
    evidence: "no closing action recorded at review time",
  });
  const result = validateFindingsPayload(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.map((error) => error.message).join("; "), /unresolved findings/i);
  assert.equal(canSaveVerified(payload), false);
  assert.throws(() => assertCanSaveVerified(payload), /unresolved/i);
});

test("an open finding is representable when the report is not VERIFIED", () => {
  const payload = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "deferred",
    status: "open",
    action: "tracked for the next remediation cycle",
    evidence: "deferred decision recorded in the adjudication log",
  });
  payload.verificationStatus = {
    format: "csm-verification-status/1",
    status: "INCOMPLETE",
    unresolved: ["F-001 remediation deferred"],
  };
  assert.equal(validateFindingsPayload(payload).valid, true);
  assert.equal(canSaveVerified(payload), false);
  assert.deepEqual(unresolvedFindings(payload), ["F-001"]);
});

test("closure disposition and status must agree", () => {
  const terminalOpen = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "remediated",
    status: "open",
    action: "a",
    evidence: "b",
  });
  terminalOpen.verificationStatus.status = "INCOMPLETE";
  assert.equal(validateFindingsPayload(terminalOpen).valid, false);

  const deferredClosed = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "deferred",
    status: "closed",
    action: "a",
    evidence: "b",
  });
  deferredClosed.verificationStatus.status = "INCOMPLETE";
  assert.equal(validateFindingsPayload(deferredClosed).valid, false);
});

test("the evaluator emits one binding verdict with evidence", () => {
  const complete = createEvaluatorReceipt(buildV2(), {
    cycle: 3,
    emittedAt: "2026-09-19T00:00:00.000Z",
  });
  assert.equal(complete.verdict, "complete");
  assert.equal(complete.schema, "csm-evaluator-receipt/1");
  assert.deepEqual(complete.unresolvedFindings, []);
  assert.equal(complete.emittedAt, "2026-09-19T00:00:00.000Z");
  assert.deepEqual([...complete.inputs], ["control", "findings", "acceptance"]);
  assert.match(complete.binding, /cannot advance to a terminal state/);
  assert.ok(Object.isFrozen(complete));

  const open = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "pending",
    evidence: "pending",
  });
  const continuation = createEvaluatorReceipt(open, { cycle: 4 });
  assert.equal(continuation.verdict, "continue");
  assert.deepEqual(continuation.unresolvedFindings, ["F-001"]);
  assert.match(continuation.evidence, /findings=F-001/);

  const blocked = buildV2();
  blocked.verificationStatus.status = "BLOCKED";
  assert.equal(createEvaluatorReceipt(blocked).verdict, "blocked");
});

test("remaining work is derived from findings, checks, and lifecycle state", () => {
  const complete = buildV2();
  assert.equal(remainingWork(complete).ok, true);
  assert.equal(loopGuardDecision(complete).code, 0);

  const open = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "pending",
    evidence: "pending",
  });
  const decision = loopGuardDecision(open);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 2);
  assert.match(decision.message, /loop-guard: work remains/);
  assert.deepEqual(remainingWork(open).findings, ["F-001"]);

  const withChecks = buildV2();
  withChecks.verificationStatus.unresolved = ["anchor reachability unverified"];
  assert.equal(loopGuardDecision(withChecks).code, 2);

  // An honest INCOMPLETE/BLOCKED save with every finding explicitly
  // dispositioned reconciles the loop; it is never a false VERIFIED.
  const honest = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "recorded for the next cycle",
    evidence: "the defect is real and unfixed at the pinned commit",
  });
  honest.verificationStatus = {
    format: "csm-verification-status/1",
    status: "INCOMPLETE",
    unresolved: ["F-001 unfixed"],
  };
  assert.equal(canSaveVerified(honest), false);
  assert.equal(remainingWork(honest).ok, true);
  assert.equal(loopGuardDecision(honest).code, 0);

  // A closure-required finding with no closure is unreconciled work.
  const unreconciled = buildV2();
  unreconciled.verificationStatus.status = "INCOMPLETE";
  delete unreconciled.findings[0].closure;
  assert.deepEqual(remainingWork(unreconciled).unreconciled, ["F-001"]);
  assert.equal(loopGuardDecision(unreconciled).code, 2);
});

test("the deterministic fallback exits non-zero while work remains and fails closed", () => {
  const complete = runGuard(buildV2());
  assert.equal(complete.status, 0, complete.stderr);

  const open = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "pending",
    evidence: "pending",
  });
  const blocked = runGuard(open);
  assert.equal(blocked.status, 2, blocked.stdout);
  assert.match(blocked.stderr, /loop-guard: work remains/);

  const dir = mkdtempSync(path.join(os.tmpdir(), "csm-review-guard-bad-"));
  try {
    const bad = path.join(dir, "malformed.json");
    writeFileSync(bad, "{ not json");
    const malformed = spawnSync(process.execPath, [guardPath, "--record", bad], {
      encoding: "utf8",
    });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /loop-guard:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enforcement is pure: the record is never mutated", () => {
  const open = withClosure(buildV2(), {
    format: "csm-review-closure/1",
    disposition: "unresolved",
    status: "open",
    action: "pending",
    evidence: "pending",
  });
  const before = JSON.stringify(open);
  remainingWork(open);
  unresolvedFindings(open);
  canSaveVerified(open);
  createEvaluatorReceipt(open);
  assert.equal(JSON.stringify(open), before);
});

test("the render model reads both revisions and surfaces the closure", async () => {
  const v2 = await createFindingsRenderModel(buildV2());
  const row = v2.model.sections.find((section) => section.id === "findings").items[0].value[0];
  assert.equal(row.closureDisposition, "remediated");
  assert.equal(row.closureStatus, "closed");
  assert.equal(row.closureEvidence, "[REDACTED]");

  const v1 = await createFindingsRenderModel(fixture);
  const v1row = v1.model.sections.find((section) => section.id === "findings").items[0].value[0];
  assert.equal(v1row.closureDisposition, "none");
});

test("the guard fails closed on an empty or unrecognized record", () => {
  assert.equal(remainingWork({}).ok, false);
  assert.equal(remainingWork({ foo: "bar" }).ok, false);
  assert.match(remainingWork({}).reasons.join("; "), /unrecognized-record/);
  assert.equal(loopGuardDecision({}).ok, false);
  assert.equal(loopGuardDecision({}).code, 2);

  const empty = runGuard({});
  assert.equal(empty.status, 2, empty.stdout);
  assert.match(empty.stderr, /loop-guard: work remains/);
});
