// T006/P4: csm-plan in-loop completion enforcement.
//
// Three pieces make "cannot close with work remaining" true without relying on
// model obedience:
//   1. a per-cycle evaluator verdict (continue|complete|blocked) journaled as a
//      typed binding receipt (`csm-plan-evaluator-receipt/1`);
//   2. a deterministic loop guard (`guard`/`loopGuard`) that reads only the
//      durable record and exits non-zero while outstanding work remains;
//   3. a strict acceptance-signal lint that refuses disjunctive "Either ... OR
//      record a deferral" signals, so closure cannot be earned by an escape
//      hatch. Genuine deferrals become `blocked` tasks with a user decision.
import { readFile } from "node:fs/promises";
import { digest } from "../../../lib/schema-runtime/index.mjs";
import {
  EVALUATOR_CONTRACT,
  PLAN_SCHEMA_V2,
  appendPlanJournal,
  validatePlanArtifact,
} from "./plan.mjs";

export const EVALUATOR_RECEIPT_FORMAT = "csm-plan-evaluator-receipt/1";
export const LOOP_GUARD_FORMAT = "csm-plan-loop-guard/1";
export { EVALUATOR_CONTRACT };

// Terminal task and lifecycle statuses across record shapes (csm-plan/* and
// csm-build-state/*). `blocked` is deliberately NOT terminal: it is outstanding
// work that must surface to the user, never a silent close.
const TERMINAL_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "closed",
  "superseded",
  "abandoned",
  "skipped",
  "verified",
]);

const DISJUNCTIVE_SIGNAL = /\beither\b[\s\S]{0,200}?\bor\b/i;
const DEFERRAL_ALTERNATIVE =
  /\bor\s+(?:record|document|note|log|defer|deferral|postpone|waive|skip|omit)\b/i;
const DEFERRAL_WORD = /\b(?:defer|defers|deferred|deferral|deferrals|postpone[ds]?|waive[ds]?)\b/i;

const normalize = (value) => String(value ?? "").toLowerCase();

// A record with no recognizable work shape (no tasks array, no activeTasks set,
// no lifecycle status) is not evidence of completion. The guard fails closed on
// it and reports outstanding work rather than vacuously declaring done.
function hasRecognizableWorkShape(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (Array.isArray(record.tasks)) return true;
  if (Array.isArray(record.control?.activeTasks)) return true;
  if (
    record.control &&
    typeof record.control === "object" &&
    normalize(record.control.status) !== ""
  )
    return true;
  if (
    record.completion &&
    typeof record.completion === "object" &&
    normalize(record.completion.status) !== ""
  )
    return true;
  if (normalize(record.status) !== "") return true;
  return false;
}

// The status-only predicate from the T013 spike: outstanding work is any
// non-terminal task or any non-empty control.activeTasks. It is deterministic
// and fails closed on unreadable input.
export function outstandingWork(record) {
  const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
  const openTasks = tasks
    .map((task, index) => ({
      taskId: String(task?.taskId ?? task?.id ?? `#${index + 1}`),
      status: normalize(task?.status),
    }))
    .filter((task) => !TERMINAL_STATUSES.has(task.status));
  const activeTasks = (
    Array.isArray(record?.control?.activeTasks) ? record.control.activeTasks : []
  ).map((taskId) => String(taskId));
  const blockedOnly = openTasks.length > 0 && openTasks.every((task) => task.status === "blocked");
  const recognizable = hasRecognizableWorkShape(record);
  const done = recognizable && openTasks.length === 0 && activeTasks.length === 0;
  const evidence = done
    ? "loop-guard: no outstanding work"
    : recognizable
      ? `loop-guard: work remains (tasks=${openTasks.map((task) => task.taskId).join(",")}, active=${activeTasks.length}, state=${normalize(record?.control?.status ?? record?.status)})`
      : "loop-guard: work remains (unrecognized record)";
  return Object.freeze({
    format: LOOP_GUARD_FORMAT,
    done,
    openTasks: Object.freeze(openTasks),
    activeTasks: Object.freeze(activeTasks),
    blockedOnly,
    evidence,
  });
}

// Full guard used by the CLI and by an execution loop: it additionally requires
// a terminal lifecycle status. csm-plan closure consumes `outstandingWork`
// because a still-`ready` plan is normal immediately before it is terminalized.
export function loopGuard(record) {
  const work = outstandingWork(record);
  const lifecycleStatus = normalize(
    record?.completion?.status ?? record?.control?.status ?? record?.status,
  );
  const lifecycleOpen = lifecycleStatus !== "" && !TERMINAL_STATUSES.has(lifecycleStatus);
  const done = work.done && !lifecycleOpen;
  return Object.freeze({
    ...work,
    done,
    lifecycleStatus,
    lifecycleOpen,
    evidence: done
      ? "loop-guard: no outstanding work"
      : work.done
        ? `loop-guard: work remains (lifecycle=${lifecycleStatus})`
        : work.evidence,
  });
}

// A single positive acceptance signal, or nothing. Disjunction and the
// "or record/document a deferral" escape hatch are refused; a genuine deferral
// must be a `blocked` task with a user decision instead.
export function lintAcceptanceSignal(signal) {
  if (typeof signal !== "string" || !signal.trim())
    return [
      {
        code: "empty-acceptance-signal",
        message: "acceptance signal must be a non-empty runnable assertion",
      },
    ];
  const errors = [];
  if (DISJUNCTIVE_SIGNAL.test(signal))
    errors.push({
      code: "disjunctive-acceptance-signal",
      message:
        "acceptance signal must be a single positive assertion; 'Either ... OR ...' alternatives are refused",
    });
  if (DEFERRAL_ALTERNATIVE.test(signal) || (DEFERRAL_WORD.test(signal) && /\bor\b/i.test(signal)))
    errors.push({
      code: "deferral-escape-signal",
      message:
        "a deferral cannot be an acceptance alternative; record it as a blocked task with a user decision",
    });
  return errors;
}

export function lintPlanAcceptanceSignals(plan) {
  const errors = [];
  for (const task of plan?.tasks ?? [])
    for (const error of lintAcceptanceSignal(task?.acceptanceSignal))
      errors.push({ ...error, taskId: task?.taskId ?? null });
  return errors;
}

// The per-cycle evaluator verdict. Exactly one of continue|complete|blocked, per
// EVALUATOR_CONTRACT; evidence is required and the receipt is journaled.
export function createEvaluatorReceipt(
  value,
  { evaluator = "csm-plan-evaluator", timestamp = new Date().toISOString() } = {},
) {
  const work = outstandingWork(value);
  const signalErrors = lintPlanAcceptanceSignals(value);
  const verdict =
    signalErrors.length > 0
      ? "blocked"
      : work.done
        ? "complete"
        : work.blockedOnly
          ? "blocked"
          : "continue";
  const receipt = {
    format: EVALUATOR_RECEIPT_FORMAT,
    verdict,
    evidence: work.evidence,
    inputs: {
      schema: value?.schema ?? null,
      artifactId: value?.artifactId ?? null,
      runId: value?.runId ?? null,
      controlDigest: digest(value?.control ?? {}),
      goalDigest: digest(value?.goal ?? {}),
      acceptanceDigest: digest(value?.acceptanceCriteria ?? []),
    },
    signalErrors,
    evaluator,
    createdAt: timestamp,
  };
  return { ...receipt, receiptDigest: digest(receipt) };
}

// Content binding: a receipt is only trustworthy when its stored
// `receiptDigest` is the digest of its own body. This refuses a fabricated
// `{ verdict: "complete" }` object and any receipt tampered with after signing.
export function verifyEvaluatorReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  if (typeof receipt.receiptDigest !== "string" || receipt.receiptDigest === "") return false;
  const { receiptDigest, ...body } = receipt;
  return receiptDigest === digest(body);
}

function latestEvaluatorReceipt(value) {
  const journal = value?.journal ?? [];
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const receipt = journal[index]?.receipt;
    if (receipt?.format === EVALUATOR_RECEIPT_FORMAT) return receipt;
  }
  return null;
}

function withFreshDigest(value) {
  const next = structuredClone(value);
  delete next.digest;
  next.digest = digest(next);
  return next;
}

// Terminalize a plan as complete. A plan with pending/in-progress/blocked tasks,
// a non-empty activeTasks set, a disjunctive acceptance signal, or no passing
// receipt is refused — the guard, not the model, owns the decision.
export function closePlan(value, { receipt, timestamp = new Date().toISOString(), evidence } = {}) {
  const check = validatePlanArtifact(value);
  if (!check.valid)
    throw Object.assign(new TypeError("invalid plan artifact"), {
      code: "schema-invalid",
      errors: check.errors,
    });
  if (value.status === "complete" || value.status === "superseded")
    throw Object.assign(new Error("terminal plan is immutable"), { code: "terminal-immutable" });

  const signalErrors = lintPlanAcceptanceSignals(value);
  if (signalErrors.length)
    throw Object.assign(new Error("plan has an invalid acceptance signal"), {
      code: "invalid-acceptance-signal",
      errors: signalErrors,
    });

  const resolved = receipt ?? latestEvaluatorReceipt(value);
  if (!resolved)
    throw Object.assign(
      new Error(
        "a plan cannot be closed without a passing evaluator receipt; run the per-cycle evaluator first",
      ),
      { code: "missing-evaluator-receipt" },
    );
  if (
    resolved.format !== EVALUATOR_RECEIPT_FORMAT ||
    typeof resolved.verdict !== "string" ||
    !verifyEvaluatorReceipt(resolved)
  )
    throw Object.assign(new Error("evaluator receipt has an invalid shape or content binding"), {
      code: "invalid-evaluator-receipt",
    });
  if (resolved.verdict !== "complete")
    throw Object.assign(
      new Error(`evaluator verdict ${resolved.verdict} does not permit closure`),
      { code: "evaluator-not-passing", verdict: resolved.verdict },
    );

  const work = outstandingWork(value);
  if (!work.done)
    throw Object.assign(new Error(work.evidence), {
      code: "pending-work",
      openTasks: work.openTasks,
      activeTasks: work.activeTasks,
    });

  const next = appendPlanJournal(value, {
    timestamp,
    cycle: value.control.cycle,
    transition: `${value.control.currentState} -> COMPLETE`,
    tasks: [],
    evidence: evidence ?? `completion evaluator verdict complete; ${work.evidence}`,
    nextState: "COMPLETE",
    receipt: resolved,
  });
  return withFreshDigest(next);
}

function planPointer(successor) {
  if (!successor || typeof successor !== "object" || Array.isArray(successor)) return null;
  const pointer = {
    artifactId: successor.artifactId,
    runId: successor.runId,
    schema: successor.schema,
  };
  if (
    typeof pointer.artifactId !== "string" ||
    typeof pointer.runId !== "string" ||
    typeof pointer.schema !== "string" ||
    !pointer.schema.startsWith("csm-plan/")
  )
    return null;
  if (successor.digest) pointer.digest = successor.digest;
  if (successor.path) pointer.path = successor.path;
  return pointer;
}

// On successor creation, close the predecessor through the typed /2
// supersession pointer. Supersession is the one terminal path that may retain
// pending tasks: the successor artifact is the authority, and the predecessor
// becomes immutable with a STOP cursor.
export function supersedePlanArtifact(
  predecessor,
  { successor, reason, timestamp = new Date().toISOString(), evidence } = {},
) {
  const check = validatePlanArtifact(predecessor);
  if (!check.valid)
    throw Object.assign(new TypeError("invalid plan artifact"), {
      code: "schema-invalid",
      errors: check.errors,
    });
  if (predecessor.schema !== PLAN_SCHEMA_V2)
    throw Object.assign(new Error("supersession requires a csm-plan/2 record"), {
      code: "unknown-revision",
    });
  if (predecessor.status === "complete" || predecessor.status === "superseded")
    throw Object.assign(new Error("terminal plan is immutable"), { code: "terminal-immutable" });

  const pointer = planPointer(successor);
  if (!pointer || typeof reason !== "string" || !reason.trim())
    throw Object.assign(new TypeError("supersession requires a successor pointer and reason"), {
      code: "invalid-supersession",
    });

  const from = predecessor.control.currentState;
  const next = structuredClone(predecessor);
  next.status = "superseded";
  next.control.status = "superseded";
  next.control.currentState = "STOP";
  next.control.nextTransition = "none; closed as superseded";
  next.control.activeTasks = [];
  next.supersession = {
    supersededBy: pointer,
    supersededAt: timestamp,
    reason: reason.trim(),
  };
  next.journal.push({
    sequence: next.journal.length,
    timestamp,
    cycle: next.control.cycle,
    transition: `${from} -> STOP`,
    tasks: [],
    evidence: evidence ?? `closed as superseded by ${pointer.artifactId}`,
    nextState: "STOP",
  });

  const result = validatePlanArtifact(next);
  if (!result.valid)
    throw Object.assign(new TypeError("invalid superseded plan artifact"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  return withFreshDigest(next);
}

export const closePredecessorOnSuccessor = supersedePlanArtifact;

function isMain() {
  return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
}

async function readRecord(recordPath) {
  return JSON.parse(await readFile(recordPath, "utf8"));
}

async function main(argv) {
  const [command, ...rest] = argv;
  const recordIndex = rest.findIndex((arg) => arg === "--record" || arg === "-r");
  const recordPath =
    (recordIndex >= 0 ? rest[recordIndex + 1] : undefined) ??
    rest.find((arg) => !arg.startsWith("-"));
  if (command === "guard" || command === "evaluate" || command === "lint") {
    if (!recordPath)
      throw new Error("usage: loop-evaluator.mjs <guard|evaluate|lint> --record <path>");
    const record = await readRecord(recordPath);
    if (command === "guard") {
      const guard = loopGuard(record);
      if (!guard.done) {
        console.error(guard.evidence);
        process.exit(2);
      }
      console.log(guard.evidence);
      return;
    }
    if (command === "lint") {
      const signalErrors = lintPlanAcceptanceSignals(record);
      if (signalErrors.length) {
        for (const error of signalErrors)
          console.error(
            `acceptance-signal ${error.taskId ?? "?"}: ${error.code}: ${error.message}`,
          );
        process.exit(2);
      }
      console.log("acceptance signals: OK");
      return;
    }
    console.log(JSON.stringify(createEvaluatorReceipt(record), null, 2));
    return;
  }
  throw new Error(`unknown command: ${command ?? "(none)"} (expected guard|evaluate|lint)`);
}

if (isMain()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
