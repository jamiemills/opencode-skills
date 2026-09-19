import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../../../lib/schema-runtime/index.mjs";

// Per-cycle completion enforcement is two layers, both inside the loop:
//
//   1. an independent evaluator subagent owns the continue|complete|blocked
//      verdict and journals it as a binding receipt (EVALUATOR_CONTRACT);
//   2. this deterministic guard owns the mechanical veto — it exits non-zero
//      while any work remains, so completion never depends on model obedience.
//
// The guard is intentionally status-only: it answers "is outstanding work left
// in the durable record?", never "is the evidence good?" (that stays with the
// evaluator and the existing gates). It is run in-loop, never in CI or a
// Makefile, and it fails closed: unreadable or malformed records are treated as
// not-done, never as done.
export const TERMINAL_TASK_STATUSES = Object.freeze([
  "complete",
  "completed",
  "done",
  "closed",
  "superseded",
  "abandoned",
  "skipped",
  "verified",
]);
const TERMINAL = new Set(TERMINAL_TASK_STATUSES);

export const EVALUATOR_VERDICTS = Object.freeze(["continue", "complete", "blocked"]);
export const EVALUATOR_RECEIPT_SCHEMA = "csm-evaluator-receipt/1";
export const EVALUATOR_RECEIPT_KIND = "evaluator-verdict";
const RECEIPT_KIND_PREFIX = `${EVALUATOR_RECEIPT_KIND}/`;

const normalize = (value) =>
  String(value === undefined || value === null ? "" : value).toLowerCase();

// "Ready"/"in_progress" describe a live loop, not leftover work; terminal
// statuses are done. Every other lifecycle value (blocked, failed, pending,
// ...) counts as outstanding. The lifecycle is read from completion first, then
// control, then the record — csm-plan carries control.status, csm-build-state
// carries completion.status and keeps its own in-flight top-level status.
const IN_FLIGHT_STATUSES = new Set(["", "ready", "in_progress", "in-progress"]);
function lifecycleStatus(record) {
  const completion =
    record?.completion && typeof record.completion === "object" ? record.completion.status : "";
  if (completion) return completion;
  const control =
    record?.control && typeof record.control === "object" ? record.control.status : "";
  if (control) return control;
  const top = record?.status;
  const normalized = normalize(top);
  return IN_FLIGHT_STATUSES.has(normalized) ? "" : top;
}

const taskId = (task) => (task && (task.taskId || task.id)) || "?";

// A record with no recognizable work shape (no tasks array, no activeTasks set,
// no lifecycle status) is not evidence of completion. The guard fails closed on
// it and reports work remaining rather than vacuously declaring done.
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

// Pending work in either record shape: csm-plan/* and csm-build-state/* both
// expose tasks[] (the build loop also passes the source plan's tasks in), and
// csm-build-state always exposes control.activeTasks.
export function openTasks(record, tasks = []) {
  const recordTasks = Array.isArray(record?.tasks) ? record.tasks : [];
  const planTasks = Array.isArray(tasks) ? tasks : [];
  return [...recordTasks, ...planTasks].filter((task) => !TERMINAL.has(normalize(task?.status)));
}

export function evaluateLoopGuard(record, { tasks = [] } = {}) {
  const remaining = [];
  if (!hasRecognizableWorkShape(record)) remaining.push("record:unrecognized");
  const open = openTasks(record, tasks);
  if (open.length > 0) remaining.push(`tasks:${open.map(taskId).join(",")}`);
  const active = Array.isArray(record?.control?.activeTasks) ? record.control.activeTasks : [];
  if (active.length > 0) remaining.push(`activeTasks:${active.join(",")}`);
  const state = normalize(lifecycleStatus(record));
  if (state !== "" && !TERMINAL.has(state)) remaining.push(`lifecycle:${state}`);
  return Object.freeze({
    status: remaining.length > 0 ? "continue" : "complete",
    remaining: Object.freeze(remaining),
    exitCode: remaining.length > 0 ? 2 : 0,
  });
}

export function assertLoopGuard(record, options = {}) {
  const result = evaluateLoopGuard(record, options);
  if (result.exitCode !== 0)
    throw Object.assign(new Error(`loop-guard: work remains (${result.remaining.join(", ")})`), {
      code: "loop-guard",
      remaining: result.remaining,
    });
  return result;
}

// A durable, content-bound evaluator receipt. Its digest is the schema-runtime
// digest, so the descriptor can be journaled in a build state's artifacts[] and
// revalidated by validateBuildState without a second digest implementation.
export function createEvaluatorReceipt({
  verdict,
  evidence,
  runId,
  cycle = 0,
  evaluatorId = "independent-evaluator",
  inputDigests = [],
} = {}) {
  if (!EVALUATOR_VERDICTS.includes(verdict))
    throw Object.assign(
      new TypeError(`evaluator verdict must be one of ${EVALUATOR_VERDICTS.join("|")}`),
      { code: "invalid-verdict" },
    );
  if (typeof evidence !== "string" || !evidence.trim())
    throw Object.assign(new TypeError("evaluator verdict requires evidence"), {
      code: "missing-evidence",
    });
  const body = {
    schema: EVALUATOR_RECEIPT_SCHEMA,
    runId,
    cycle,
    evaluatorId,
    verdict,
    evidence,
    inputDigests: Array.isArray(inputDigests) ? [...inputDigests] : [],
  };
  return Object.freeze({ ...body, receiptDigest: digest(body) });
}

export function evaluatorReceiptDescriptor(
  receipt,
  { runId = receipt?.runId, path = ".agents/build/evaluator-verdict.json" } = {},
) {
  if (!receipt?.receiptDigest)
    throw Object.assign(new TypeError("evaluator receipt is required"), {
      code: "invalid-evaluator-receipt",
    });
  const body = {
    schema: "csm-build-artifact/1",
    artifactId: `art-eval-${receipt.receiptDigest.slice(-12)}`,
    kind: `${RECEIPT_KIND_PREFIX}${receipt.verdict}`,
    runId,
    owner: "csm-build",
    digest: receipt.receiptDigest,
    path,
    contentType: "application/json",
    lifecycleStatus: "completed",
    sourceArtifactIds: [...(receipt.inputDigests ?? [])],
    rollbackArtifactId: null,
  };
  return { ...body, descriptorDigest: digest(body) };
}

export function isEvaluatorReceipt(descriptor) {
  if (
    !descriptor ||
    descriptor.schema !== "csm-build-artifact/1" ||
    typeof descriptor.kind !== "string" ||
    !descriptor.kind.startsWith(RECEIPT_KIND_PREFIX) ||
    typeof descriptor.descriptorDigest !== "string"
  )
    return false;
  const body = Object.fromEntries(
    Object.entries(descriptor).filter(([key]) => key !== "descriptorDigest"),
  );
  return descriptor.descriptorDigest === digest(body);
}

export function evaluatorVerdictOf(descriptor) {
  if (typeof descriptor?.kind !== "string" || !descriptor.kind.startsWith(RECEIPT_KIND_PREFIX))
    return null;
  const verdict = descriptor.kind.slice(RECEIPT_KIND_PREFIX.length);
  return EVALUATOR_VERDICTS.includes(verdict) ? verdict : null;
}

export function findEvaluatorVerdict(record) {
  const evidence = record?.completion?.evidence ?? [];
  const candidates = [...(Array.isArray(record?.artifacts) ? record.artifacts : []), ...evidence];
  return candidates.filter((descriptor) => isEvaluatorReceipt(descriptor)).at(-1) ?? null;
}

// Journal the evaluator's binding verdict into the durable build state. The
// caller keeps the original value; a clone is returned.
export function recordEvaluatorReceipt(value, receipt, options = {}) {
  const descriptor = isEvaluatorReceipt(receipt)
    ? receipt
    : evaluatorReceiptDescriptor(receipt, { runId: value?.runId, ...options });
  const next = structuredClone(value);
  next.artifacts = [...(next.artifacts ?? []), descriptor];
  return next;
}

// The completion gate the loop must pass before writing COMPLETE:
//   - deterministic: no open tasks, no active tasks, terminal lifecycle;
//   - binding: when required, a journaled `complete` evaluator verdict.
export function assertCompletionGate({
  record,
  tasks = [],
  evaluatorReceipt = null,
  requireEvaluator = false,
} = {}) {
  const guard = assertLoopGuard(record, { tasks });
  if (!requireEvaluator) return { verdict: null, descriptor: null };
  const descriptor = evaluatorReceipt
    ? isEvaluatorReceipt(evaluatorReceipt)
      ? evaluatorReceipt
      : evaluatorReceiptDescriptor(evaluatorReceipt, { runId: record?.runId })
    : findEvaluatorVerdict(record);
  if (!descriptor)
    throw Object.assign(
      new Error("completion refused: a binding evaluator verdict receipt is required"),
      { code: "evaluator-verdict-required" },
    );
  if (!isEvaluatorReceipt(descriptor))
    throw Object.assign(new Error("completion refused: evaluator receipt is invalid"), {
      code: "invalid-evaluator-receipt",
    });
  const verdict = evaluatorVerdictOf(descriptor);
  if (verdict !== "complete")
    throw Object.assign(
      new Error(`completion refused: evaluator verdict is ${verdict ?? "unknown"}`),
      { code: "evaluator-verdict-required", verdict },
    );
  return { verdict, descriptor, guard };
}

const argValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

async function readRecord(path, label) {
  const raw = await readFile(path, "utf8");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be a JSON object`);
  return value;
}

export async function runLoopGuardCli(argv = process.argv.slice(2)) {
  const recordPath = argValue(argv, "--record");
  const planPath = argValue(argv, "--plan");
  let record;
  let tasks = [];
  try {
    if (!recordPath) throw new TypeError("--record is required");
    record = await readRecord(recordPath, "record");
    if (
      typeof record.schema === "string" &&
      record.schema.startsWith("csm-build-state/") &&
      !planPath
    )
      throw new TypeError(
        "--plan is required for a csm-build-state record (source-plan tasks must be checked)",
      );
    if (planPath) {
      const plan = await readRecord(planPath, "plan");
      tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    }
  } catch (error) {
    // Fail closed: an unreadable or malformed record is not-done.
    console.error(`loop-guard: unreadable record (${error.message})`);
    return 2;
  }
  const result = evaluateLoopGuard(record, { tasks });
  if (result.exitCode !== 0) {
    console.error(`loop-guard: work remains (${result.remaining.join(", ")})`);
    return 2;
  }
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(await runLoopGuardCli());
