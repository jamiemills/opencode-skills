"use strict";

// T002/T003: the shared, run-scoped decision service. Built once per run and
// used by every consumer (the driver's advisory verdicts, and any skill lib
// that is handed the service). It is OPTIONAL and OFF by default: with no
// adapter every method is a no-op returning empty advice, so behavior is
// byte-identical to the layer being absent. Advice is advisory only and never
// applied. T003 adds a coverage profile, a run-level budget guard, and
// per-decision telemetry; the guard only decides whether to CONSULT and never
// pauses the run.

import { createConsultSeam } from "./consult.mjs";
import { createBudgetGuard, decisionTelemetry, resolveCoverageProfile } from "./budget.mjs";

export const DECISION_SERVICE_ENV = "CSM_DECISION_SERVICE";
export const DECISION_COVERAGE_ENV = "CSM_DECISION_COVERAGE";
export const DECISION_MAX_CALLS_ENV = "CSM_DECISION_MAX_CALLS";
export const DECISION_MAX_COST_ENV = "CSM_DECISION_MAX_COST";

export function createDecisionService({
  adapter = null,
  redact,
  profile,
  coverage,
  budget,
  env = process.env,
} = {}) {
  const requested = coverage ?? profile ?? env?.[DECISION_COVERAGE_ENV];
  const coverageProfile =
    requested === undefined ? resolveCoverageProfile("wide") : resolveCoverageProfile(requested);
  const budgetConfig =
    budget ??
    (env?.[DECISION_MAX_CALLS_ENV] || env?.[DECISION_MAX_COST_ENV]
      ? {
          maxCalls: Number(env?.[DECISION_MAX_CALLS_ENV]),
          maxCost: Number(env?.[DECISION_MAX_COST_ENV]),
        }
      : undefined);
  const guard = createBudgetGuard(budgetConfig ?? {});
  const enabled =
    Boolean(adapter && typeof adapter.decideBatch === "function") && coverageProfile.enabled;
  const seam = enabled
    ? createConsultSeam(redact === undefined ? { adapter } : { adapter, redact })
    : null;
  const telemetry = [];

  async function consult(pointIds, state = null) {
    if (!seam) return Object.freeze({});
    const ids = (Array.isArray(pointIds) ? pointIds : []).filter((id) => guard.allowCall(id));
    if (ids.length === 0) return Object.freeze({});
    for (const id of ids) guard.noteCall(id);
    const startedAt = Date.now();
    const advice = await seam.consultPoints(ids, state);
    const latencyMs = Date.now() - startedAt;
    for (const id of ids) {
      const answer = advice?.[id];
      if (Number.isFinite(answer?.usage?.cost)) guard.noteCost(answer.usage.cost);
      telemetry.push(
        decisionTelemetry({
          pointId: id,
          latencyMs,
          usage: answer?.usage ?? null,
          applied: false,
        }),
      );
    }
    return advice;
  }

  return Object.freeze({
    enabled,
    coverage: coverageProfile.id,
    consult,
    async prefetch(pointIds, state = null) {
      if (!seam) return;
      try {
        await consult(pointIds, state);
      } catch {
        /* advisory best-effort; never blocks */
      }
    },
    stats() {
      return enabled && typeof adapter.stats === "function" ? adapter.stats() : null;
    },
    telemetry: () => Object.freeze(telemetry.slice()),
    budget: () => guard.snapshot(),
  });
}
