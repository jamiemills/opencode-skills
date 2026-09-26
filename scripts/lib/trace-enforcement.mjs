"use strict";

// T003 (pure policy): decide whether a run's missing trace is a failure. Kept
// dependency-free and side-effect-free so it is trivially unit-tested.
//
// Policy precedence (a repo-controlled config file must NEVER be able to force
// enforcement off):
//   1. explicit flag --require-trace (required) / --no-require-trace (off)
//   2. CSM_TRACE_ENFORCE env (off | auto | required)
//   3. default: auto
//
// Semantics:
//   off       -> never fail
//   required  -> fail unless the run produced >= 1 trace
//   auto      -> fail only when the run actually scheduled tracing (>= 1 hook
//                emitted) but produced none

export const TRACE_ENFORCEMENT_POLICIES = Object.freeze(["off", "auto", "required"]);
export const DEFAULT_TRACE_ENFORCEMENT = "auto";

export function resolveTracePolicy({ flag = null, env = process.env } = {}) {
  if (flag === "required" || flag === "off") return flag;
  const raw = env?.CSM_TRACE_ENFORCE;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (TRACE_ENFORCEMENT_POLICIES.includes(trimmed)) return trimmed;
  }
  return DEFAULT_TRACE_ENFORCEMENT;
}

export function evaluateTraceGate({
  policy = DEFAULT_TRACE_ENFORCEMENT,
  scheduled = 0,
  matched = 0,
} = {}) {
  if (policy === "off") return Object.freeze({ enforce: false, ok: true, reason: "policy-off" });
  if (policy === "required")
    return matched >= 1
      ? Object.freeze({ enforce: true, ok: true, reason: "ok" })
      : Object.freeze({ enforce: true, ok: false, reason: "no-trace-for-run" });
  // auto
  if (scheduled < 1) return Object.freeze({ enforce: false, ok: true, reason: "not-scheduled" });
  return matched >= 1
    ? Object.freeze({ enforce: true, ok: true, reason: "ok" })
    : Object.freeze({ enforce: true, ok: false, reason: "no-trace-for-run" });
}

export default {
  TRACE_ENFORCEMENT_POLICIES,
  DEFAULT_TRACE_ENFORCEMENT,
  resolveTracePolicy,
  evaluateTraceGate,
};
