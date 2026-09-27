import { test } from "node:test";
import assert from "node:assert/strict";

import { createDecisionService } from "../csm-orchestrate/lib/decision-adapter/service.mjs";

test("off by default: every method is a no-op and behavior is unchanged", async () => {
  const service = createDecisionService({ adapter: null });
  assert.equal(service.enabled, false);
  assert.deepEqual(await service.consult(["p1"], { token: "secret" }), {});
  assert.equal(await service.prefetch(["p1"], { token: "secret" }), undefined);
  assert.equal(service.stats(), null);
});

test("advisory-only: consult returns advice that never applies, and state is redacted", async () => {
  let seenState;
  const adapter = {
    decideBatch: async (ids, state) => {
      seenState = state;
      return { p1: { answer: "uphold", confidence: 0.5, applied: true, advisory: false } };
    },
    stats: () => ({ consulted: 1 }),
  };
  const service = createDecisionService({ adapter, redact: () => ({ redacted: true }) });
  assert.equal(service.enabled, true);
  const out = await service.consult(["p1"], { token: "raw-secret" });
  assert.deepEqual(seenState, { redacted: true }, "state must be redacted before send");
  assert.equal(out.p1.advisory, true);
  assert.equal(out.p1.applied, false);
  assert.deepEqual(service.stats(), { consulted: 1 });
});

test("prefetch never throws even when the adapter fails", async () => {
  const adapter = {
    decideBatch: async () => {
      throw new Error("provider down");
    },
  };
  const service = createDecisionService({ adapter });
  await service.prefetch(["p1"], {});
});
