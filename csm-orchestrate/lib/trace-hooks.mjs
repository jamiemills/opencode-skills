"use strict";

// Built-in action/decision tracing for the orchestrator's lifecycle hooks. The
// hook runner (./lifecycle-hooks.mjs) invokes handlers SYNCHRONOUSLY and treats
// them as advisory (a throwing hook is counted and skipped, never fatal), while
// the trace writer returns a promise. So each handler fires-and-forgets the
// write and tracks the promise in a pending set; the caller awaits flush()
// before exiting. The writer is INJECTED by the driver (which lives under
// scripts/ and can import scripts/lib/trace-log.mjs): the packaged payload
// mirror has no scripts/ tree, so this module must not import the writer
// itself. With no injected writer the hook is a no-op, never a run failure.

import { LIFECYCLE_HOOK_NAMES } from "./lifecycle-hooks.mjs";

const DEFAULT_ACTOR = "csm-orchestrate";

function noopWriter() {
  return null;
}

function targetOf(context) {
  const candidate =
    context.taskId ?? context.workerId ?? context.childRunId ?? context.phaseId ?? "run";
  const value = String(candidate);
  return value.length > 0 ? value : "run";
}

// Returns { definitions, flush }. `definitions` is the {hookName: [handler]}
// map to pass as orchestrate({ lifecycleHooks }); `flush` drains pending writes.
export function createTraceLifecycleHooks({ actor = DEFAULT_ACTOR, write = null } = {}) {
  const pending = new Set();
  const invoke = typeof write === "function" ? write : noopWriter;

  function emit(hookName, context) {
    let promise;
    try {
      const entry = {
        runId: typeof context?.runId === "string" && context.runId ? context.runId : "unknown-run",
        actor: typeof context?.skill === "string" && context.skill ? context.skill : actor,
        action: hookName,
        target: targetOf(context ?? {}),
        justification: `lifecycle ${hookName}`,
        outcome:
          typeof context?.status === "string" && context.status
            ? context.status
            : String(context?.state ?? "ok"),
      };
      promise = Promise.resolve(invoke("action", entry)).catch(() => {});
    } catch {
      return;
    }
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  }

  const definitions = {};
  for (const name of LIFECYCLE_HOOK_NAMES) definitions[name] = [(context) => emit(name, context)];

  async function flush() {
    await Promise.allSettled(pending);
  }

  return Object.freeze({ definitions: Object.freeze(definitions), flush });
}

export default { createTraceLifecycleHooks };
