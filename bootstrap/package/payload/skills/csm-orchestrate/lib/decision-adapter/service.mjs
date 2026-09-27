"use strict";

// T002: the shared, run-scoped decision service. Built once per run and used by
// every consumer (the driver's advisory verdicts, and any skill lib that is
// handed the service). It is OPTIONAL and OFF by default: with no adapter every
// method is a no-op returning empty advice, so behavior is byte-identical to the
// layer being absent. Advice is advisory only and never applied.

import { createConsultSeam } from "./consult.mjs";

export const DECISION_SERVICE_ENV = "CSM_DECISION_SERVICE";

export function createDecisionService({ adapter = null, redact } = {}) {
  const enabled = Boolean(adapter && typeof adapter.decideBatch === "function");
  const seam = enabled
    ? createConsultSeam(redact === undefined ? { adapter } : { adapter, redact })
    : null;
  return Object.freeze({
    enabled,
    async consult(pointIds, state = null) {
      if (!seam) return Object.freeze({});
      return seam.consultPoints(pointIds, state);
    },
    async prefetch(pointIds, state = null) {
      if (!seam) return;
      try {
        await seam.consultPoints(pointIds, state);
      } catch {
        /* advisory best-effort; never blocks */
      }
    },
    stats() {
      return enabled && typeof adapter.stats === "function" ? adapter.stats() : null;
    },
  });
}
