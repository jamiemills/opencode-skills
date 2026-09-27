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

test("a coverage profile of off disables consultation", async () => {
  const adapter = { decideBatch: async () => ({ p1: { answer: "x" } }) };
  const service = createDecisionService({ adapter, profile: "off" });
  assert.equal(service.enabled, false);
  assert.deepEqual(await service.consult(["p1"], {}), {});
});

test("the budget guard caps per-point consultation and telemetry is recorded", async () => {
  let calls = 0;
  const adapter = {
    decideBatch: async (ids) => {
      calls += 1;
      return Object.fromEntries(ids.map((id) => [id, { answer: "x" }]));
    },
  };
  const service = createDecisionService({ adapter, profile: "wide", budget: { maxPointCalls: 1 } });
  await service.consult(["p1"], {});
  await service.consult(["p1"], {});
  assert.equal(calls, 1, "the per-point cap must bound consultation");
  assert.equal(service.telemetry().length, 1);
  assert.equal(service.budget().tier, "NORMAL");
});

test("telemetry records usage and the cost budget engages", async () => {
  const adapter = {
    decideBatch: async (ids) =>
      Object.fromEntries(
        ids.map((id) => [id, { answer: "a", usage: { cost: 0.6, inputTokens: 9 } }]),
      ),
  };
  const service = createDecisionService({ adapter, profile: "wide", budget: { maxCost: 1 } });
  await service.consult(["p1"], {});
  assert.equal(service.telemetry()[0].cost, 0.6);
  assert.equal(service.budget().cost, 0.6);
  assert.equal(service.budget().tier, "NORMAL");
});

test("the coverage profile comes from the env when not passed", async () => {
  const adapter = {
    decideBatch: async (ids) => Object.fromEntries(ids.map((id) => [id, { answer: "a" }])),
  };
  const service = createDecisionService({ adapter, env: { CSM_DECISION_COVERAGE: "off" } });
  assert.equal(service.enabled, false);
  assert.equal(service.coverage, "off");
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
