"use strict";

// csm-review remediation-closure loop enforcement (T007/P5).
//
// Two coupled pieces, both per-run local (no lock, no shared mutable state):
//
// 1. A remediation-closure/disposition link: every finding in the additive
//    `csm-review-findings/2` revision maps to a closing action or an explicit
//    disposition that cites evidence.
// 2. A per-cycle evaluator receipt plus a deterministic loop-guard fallback. The
//    guard reads the durable record and exits non-zero while any work remains, so
//    a review with unresolved findings cannot be saved VERIFIED. Because there is
//    no Stop hook, the deterministic guard -- not a model's willingness to obey a
//    verdict -- carries the enforcement weight (see
//    docs/enforcement-evaluator-spike.md).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REVIEW_FINDINGS_SCHEMA = "csm-review-findings/1";
export const REVIEW_FINDINGS_SCHEMA_V2 = "csm-review-findings/2";
// Dual-revision reader contract: /1 stays byte-frozen and /2 is additive, so the
// validator accepts both emitted ids.
export const REVIEW_FINDINGS_SCHEMAS = Object.freeze([
  REVIEW_FINDINGS_SCHEMA,
  REVIEW_FINDINGS_SCHEMA_V2,
]);

export const CLOSURE_FORMAT = "csm-review-closure/1";
export const EVALUATOR_RECEIPT_SCHEMA = "csm-evaluator-receipt/1";

// A terminal disposition closes the finding; an open disposition is a valid,
// explicit statement that remediation is still outstanding. `deferred` and
// `unresolved` are open by construction.
export const TERMINAL_DISPOSITIONS = Object.freeze([
  "remediated",
  "accepted-risk",
  "false-positive",
  "not-applicable",
]);
export const OPEN_DISPOSITIONS = Object.freeze(["deferred", "unresolved"]);

export const EVALUATOR_CONTRACT = Object.freeze({
  format: "csm-evaluator-contract/1",
  inputs: Object.freeze(["control", "findings", "acceptance"]),
  outputs: Object.freeze(["continue", "complete", "blocked"]),
  evidence: "required with every verdict",
  binding:
    "the verdict binds the loop cursor; a non-passing verdict cannot advance to a terminal state",
  receipt: "journaled",
});

const OPEN_DISPOSITION_SET = new Set(OPEN_DISPOSITIONS);
const DONE = new Set([
  "complete",
  "completed",
  "done",
  "closed",
  "superseded",
  "abandoned",
  "skipped",
  "verified",
]);

const norm = (value) => String(value === undefined || value === null ? "" : value).toLowerCase();

// A record with no recognizable work shape (no findings array, no tasks array,
// no lifecycle status, no verificationStatus) is not evidence of completion.
// The guard fails closed on it and reports work remaining rather than
// vacuously declaring done.
function hasRecognizableWorkShape(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (Array.isArray(record.findings)) return true;
  if (Array.isArray(record.tasks)) return true;
  const control = record.control;
  if (
    control &&
    typeof control === "object" &&
    (Array.isArray(control.activeTasks) || norm(control.status) !== "")
  )
    return true;
  if (
    record.completion &&
    typeof record.completion === "object" &&
    norm(record.completion.status) !== ""
  )
    return true;
  if (record.verificationStatus && typeof record.verificationStatus === "object") return true;
  if (norm(record.status) !== "") return true;
  return false;
}

// Closure is mandatory only for the additive /2 revision (or when a finding
// already carries a closure object). Frozen /1 records keep their existing
// meaning so reverting a /2 writer cannot invalidate them.
export function closureRequired(record) {
  if (!record || !Array.isArray(record.findings)) return false;
  if (record.schema === REVIEW_FINDINGS_SCHEMA_V2) return true;
  if (Number.isInteger(record.schemaRevision) && record.schemaRevision >= 2) return true;
  return record.findings.some(
    (finding) => finding && typeof finding === "object" && "closure" in finding,
  );
}

export function findingIsClosed(finding, required = true) {
  if (!required) return true;
  const closure = finding?.closure;
  if (!closure || typeof closure !== "object") return false;
  return closure.status === "closed" && !OPEN_DISPOSITION_SET.has(closure.disposition);
}

export function unresolvedFindings(record) {
  if (!record || !Array.isArray(record.findings)) return [];
  const required = closureRequired(record);
  return record.findings
    .filter((finding) => !findingIsClosed(finding, required))
    .map((finding) => finding.id ?? "?");
}

export function canSaveVerified(record) {
  if (record?.verificationStatus?.status !== "VERIFIED") return false;
  if ((record.verificationStatus.unresolved ?? []).length > 0) return false;
  return unresolvedFindings(record).length === 0;
}

export function assertCanSaveVerified(record) {
  if (canSaveVerified(record)) return record;
  const unresolved = unresolvedFindings(record);
  const error = new TypeError(
    `cannot save VERIFIED with unresolved findings or checks: ${
      unresolved.join(", ") || "unresolved verification checks"
    }`,
  );
  error.code = "unresolved-findings";
  error.unresolvedFindings = unresolved;
  throw error;
}

export function unreconciledFindings(record) {
  if (!record || !Array.isArray(record.findings)) return [];
  if (!closureRequired(record)) return [];
  return record.findings
    .filter((finding) => !finding || !finding.closure || typeof finding.closure !== "object")
    .map((finding) => finding?.id ?? "?");
}

// Deterministic "is there outstanding work left?" predicate for the review loop.
// A finding with an explicit closure/disposition is reconciled even when that
// disposition is open: a review may honestly terminate INCOMPLETE/BLOCKED with
// open findings. Work remains when a closure-required finding has no closure, or
// when the record claims VERIFIED while not verification-clean. It is
// deliberately not a correctness judgement; evidence quality stays with the
// evaluator and the existing gates.
export function remainingWork(record) {
  const reasons = [];
  const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
  const openTasks = tasks
    .filter((task) => !DONE.has(norm(task && task.status)))
    .map((task) => (task && (task.taskId || task.id)) || "?");
  const control = record?.control && typeof record.control === "object" ? record.control : {};
  const active = Array.isArray(control.activeTasks) ? control.activeTasks.length : 0;
  const completion =
    record?.completion && typeof record.completion === "object" ? record.completion : {};
  const state = norm(completion.status || control.status || record?.status);
  const openState = state !== "" && !DONE.has(state);
  const verification = norm(record?.verificationStatus?.status);
  const hasFindings = Array.isArray(record?.findings);
  const unresolved = unresolvedFindings(record);
  const unreconciled = unreconciledFindings(record);
  const unresolvedChecks = Array.isArray(record?.verificationStatus?.unresolved)
    ? record.verificationStatus.unresolved.map(String)
    : [];
  const missingVerification = hasFindings && verification === "";
  const falseVerified = verification === "verified" && !canSaveVerified(record);

  if (!hasRecognizableWorkShape(record)) reasons.push("unrecognized-record");
  if (openTasks.length > 0) reasons.push(`tasks=${openTasks.join(",")}`);
  if (active > 0) reasons.push(`active=${active}`);
  if (openState) reasons.push(`state=${state}`);
  if (unreconciled.length > 0) reasons.push(`unreconciled=${unreconciled.join(",")}`);
  if (missingVerification) reasons.push("verificationStatus=missing");
  if (falseVerified) {
    reasons.push("verificationStatus=verified-with-unresolved");
    if (unresolved.length > 0) reasons.push(`findings=${unresolved.join(",")}`);
  }

  return {
    ok: reasons.length === 0,
    findings: unresolved,
    unreconciled,
    tasks: openTasks,
    active,
    unresolvedChecks,
    state,
    verification,
    openState,
    missingVerification,
    falseVerified,
    reasons,
  };
}

export function loopGuardDecision(record) {
  const work = remainingWork(record);
  if (work.ok) return { ok: true, code: 0, message: "loop-guard: no work remains" };
  return {
    ok: false,
    code: 2,
    message: `loop-guard: work remains (${work.reasons.join("; ")})`,
  };
}

// The evaluator reads only durable state and the goal/acceptance contract and
// emits exactly one binding verdict with evidence; the receipt is journaled
// before the cursor advances.
export function createEvaluatorReceipt(
  record,
  { cycle = 0, emittedAt = new Date().toISOString() } = {},
) {
  const work = remainingWork(record);
  const blocked = work.state === "blocked" || work.verification === "blocked";
  const clean = canSaveVerified(record);
  const verdict = blocked ? "blocked" : clean ? "complete" : "continue";
  const evidence = !work.ok
    ? work.reasons.join("; ")
    : clean
      ? "deterministic closure: VERIFIED with 0 unresolved findings and 0 unresolved checks"
      : `not VERIFIED-clean (verificationStatus=${work.verification || "missing"})`;
  return Object.freeze({
    schema: EVALUATOR_RECEIPT_SCHEMA,
    producer: "csm-review",
    contract: EVALUATOR_CONTRACT.format,
    runId: record?.artifact?.runId ?? record?.runId ?? null,
    cycle,
    evaluatorId: "independent-evaluator",
    verdict,
    inputs: [...EVALUATOR_CONTRACT.inputs],
    unresolvedFindings: [...work.findings],
    unresolvedChecks: [...work.unresolvedChecks],
    openTasks: [...work.tasks],
    activeTasks: work.active,
    state: work.state,
    evidence,
    binding: EVALUATOR_CONTRACT.binding,
    emittedAt,
  });
}

export function runLoopGuard(recordPath) {
  let raw;
  try {
    raw = readFileSync(recordPath, "utf8");
  } catch (error) {
    const wrapped = new Error(`loop-guard: unreadable record ${recordPath}: ${error.message}`);
    wrapped.code = "unreadable-record";
    throw wrapped;
  }
  try {
    return loopGuardDecision(JSON.parse(raw));
  } catch (error) {
    const wrapped = new Error(`loop-guard: malformed record ${recordPath}: ${error.message}`);
    wrapped.code = "malformed-record";
    throw wrapped;
  }
}

function parseRecordPath(argv) {
  const index = argv.indexOf("--record");
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
  const recordPath = parseRecordPath(argv);
  if (!recordPath) {
    process.stderr.write("loop-guard: --record <path> is required\n");
    process.exit(2);
  }
  let decision;
  try {
    decision = runLoopGuard(recordPath);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (decision.code === 0) {
    process.stdout.write(`${decision.message}\n`);
    process.exit(0);
  }
  process.stderr.write(`${decision.message}\n`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv);
