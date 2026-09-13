"use strict";

// T012: deterministic lifecycle hook runner. Hooks observe bounded,
// frozen context at fixed ordering points; they can neither mutate shared
// state nor fail a run, and they receive no cursor/receipt/gate handle, so
// they can never write acceptance state.
const HOOK_NAMES = Object.freeze([
  "worker-start",
  "worker-stop",
  "task-create",
  "task-complete",
  "tool-exec",
  "checkpoint",
  "cancel",
]);
const HOOK_NAME_SET = new Set(HOOK_NAMES);

export function createLifecycleHookRunner(definitions = {}) {
  if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions))
    throw new TypeError("lifecycle hook definitions must be an object");
  const hooks = new Map();
  for (const [name, handlers] of Object.entries(definitions)) {
    if (!HOOK_NAME_SET.has(name)) throw new TypeError(`unknown lifecycle hook ${name}`);
    if (!Array.isArray(handlers)) throw new TypeError(`lifecycle hook ${name} must be an array`);
    hooks.set(name, handlers.slice());
  }
  const invocations = [];
  function run(name, context = {}) {
    if (!HOOK_NAME_SET.has(name)) throw new TypeError(`unknown lifecycle hook ${name}`);
    const handlers = hooks.get(name);
    if (!handlers || handlers.length === 0) return { name, ran: 0, errors: 0 };
    const frozen = Object.freeze({ ...context });
    let ran = 0;
    let errors = 0;
    for (const handler of handlers) {
      try {
        handler(frozen);
        ran += 1;
      } catch {
        // Hooks are advisory: a throwing hook is counted and skipped, never
        // allowed to fail or reorder the run.
        errors += 1;
      }
    }
    invocations.push({ name, ran, errors });
    return { name, ran, errors };
  }
  return {
    run,
    hooks: () => [...hooks.keys()].toSorted(),
    invocations: () => invocations.map((entry) => ({ ...entry })),
  };
}

export const LIFECYCLE_HOOK_NAMES = HOOK_NAMES;
