import { createHash } from "node:crypto";

// T001: the pure continuation core. Given a durable record, the deterministic
// loop-guard result, the continuation budget, and the environment, it decides
// whether the plugin may continue the build loop. It performs no filesystem or
// network I/O and reads ONLY the continuation switches (CSM_CONTINUE_KILL and
// CSM_CONTINUE_MODE) -- never CSM_DECISION_*. A fresh session can run this to
// recompute the same verdict from the durable record alone.
//
// Precedence, highest first:
//   1. kill switch          -> stop  (kill-switch)
//   2. guard exitCode 0     -> stop  (no-work-remaining)
//   3. blocked/paused       -> pause (blocked-or-paused)
//   4. guard exitCode 2     -> budget/progress checks, else continue
//   5. any other guard code -> stop  (guard-unrecognized; fail closed)

// Documented placeholders used when the record/plan path is not supplied. They
// are never executed; they force the caller to fill in the real paths.
export const RECORD_PATH_PLACEHOLDER = "<record-path>";
export const PLAN_PATH_PLACEHOLDER = "<plan-path>";

const TRUTHY_OFF = new Set(["", "0", "false", "no", "off", "null", "undefined"]);
const PAUSING_STATES = new Set(["blocked", "paused"]);

const normalize = (value) => String(value ?? "").toLowerCase();

function isTruthy(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return !TRUTHY_OFF.has(normalize(value).trim());
}

// Canonical JSON: object keys sorted, no whitespace. Stable across insertion
// order so two structurally equal records digest identically.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return "null";
}

// Stable, pure digest of a record (canonical JSON, sha256).
export function recordDigest(record) {
  return `sha256:${createHash("sha256").update(canonical(record), "utf8").digest("hex")}`;
}

function isBlockedOrPaused(record) {
  return [record?.completion?.status, record?.control?.status, record?.status, record?.state].some(
    (value) => PAUSING_STATES.has(normalize(value)),
  );
}

// Status-only readiness, self-contained in the core so the installed wrapper
// needs no repository import. These mirror the deterministic loop guard's
// task/lifecycle semantics: a task is outstanding unless its status is
// terminal, a non-empty control.activeTasks set is outstanding, and a non-empty
// non-terminal lifecycle state is outstanding. It answers "is work left?", never
// "is the evidence good?", and reports no digest or I/O.
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
const TERMINAL_TASKS = new Set(TERMINAL_TASK_STATUSES);
const IN_FLIGHT_STATUSES = new Set(["", "ready", "in_progress", "in-progress"]);

// Lifecycle is read from completion first, then control, then the record. A
// top-level live status ("", ready, in_progress) is normalised to "" so it is
// not itself outstanding; every other non-terminal value (blocked, failed,
// pending, ...) counts as work remaining.
function lifecycleStatus(record) {
  const completion =
    record?.completion && typeof record.completion === "object" ? record.completion.status : "";
  if (completion) return completion;
  const control =
    record?.control && typeof record.control === "object" ? record.control.status : "";
  if (control) return control;
  const top = record?.status;
  return IN_FLIGHT_STATUSES.has(normalize(top)) ? "" : top;
}

const readinessTaskId = (task) => (task && (task.taskId || task.id)) || "?";

export function evaluateReadiness({ record, tasks } = {}) {
  const remaining = [];
  const open = [
    ...(Array.isArray(record?.tasks) ? record.tasks : []),
    ...(Array.isArray(tasks) ? tasks : []),
  ].filter((task) => !TERMINAL_TASKS.has(normalize(task?.status)));
  if (open.length > 0) remaining.push(`tasks:${open.map(readinessTaskId).join(",")}`);
  const active = Array.isArray(record?.control?.activeTasks) ? record.control.activeTasks : [];
  if (active.length > 0) remaining.push(`activeTasks:${active.join(",")}`);
  const state = normalize(lifecycleStatus(record));
  if (state !== "" && !TERMINAL_TASKS.has(state)) remaining.push(`lifecycle:${state}`);
  return { exitCode: remaining.length > 0 ? 2 : 0, remaining };
}

// Resume command paths are read from the explicit `recordPath`/`planPath`
// fields on the record (or guard); absent, the documented placeholders stand in
// so the command is never silently wrong.
function resumeCommand(record, guard) {
  const recordPath = record?.recordPath ?? guard?.recordPath ?? RECORD_PATH_PLACEHOLDER;
  const planPath = record?.planPath ?? guard?.planPath ?? PLAN_PATH_PLACEHOLDER;
  return `node csm-build/lib/loop-guard.mjs --record ${recordPath} --plan ${planPath}`;
}

const decision = (action, reason, command = null) => ({ action, reason, command });

export function decideContinuation({ record, guard, budget, env } = {}) {
  if (isTruthy(env?.CSM_CONTINUE_KILL) || normalize(env?.CSM_CONTINUE_MODE) === "off")
    return decision("stop", "kill-switch");
  if (guard?.exitCode === 0) return decision("stop", "no-work-remaining");
  if (isBlockedOrPaused(record)) return decision("pause", "blocked-or-paused");
  if (guard?.exitCode !== 2) return decision("stop", "guard-unrecognized");

  const continues = Number.isFinite(budget?.continues) ? budget.continues : 0;
  if (Number.isFinite(budget?.maxContinues) && continues >= budget.maxContinues)
    return decision("stop", "budget-exhausted");

  const lastDigest = budget?.lastDigest;
  if (lastDigest) {
    const currentDigest = budget?.digest ?? recordDigest(record);
    if (lastDigest === currentDigest) return decision("stop", "no-progress");
  }

  return decision("continue", "work-remaining", resumeCommand(record, guard));
}
