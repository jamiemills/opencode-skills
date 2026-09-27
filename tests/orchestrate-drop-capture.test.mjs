"use strict";

// T010: the live verified-sandbox runtime consumes the provider's degraded
// drop-capture fact. A run that REQUIRES capture fails closed (typed
// `drop-capture-degraded`) when capture degrades mid-run; a best-effort run
// still completes and surfaces the degradation.
import assert from "node:assert/strict";
import test from "node:test";
import { createLiveVerifiedSandboxRuntime } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createVerifiedSandboxRuntime } from "../csm-orchestrate/lib/verified-sandbox-runtime.mjs";

const PARENT_RUN = "run-drop-capture-parent";

function runtimeWith(collectDrops, defaults = {}) {
  const provider = {
    async start() {
      return { id: "cid-drop", attestation: {}, egress: null };
    },
    async stop() {},
    async collectDrops({ id }) {
      return collectDrops(id);
    },
  };
  return createLiveVerifiedSandboxRuntime({
    provider,
    brokerFactory: async () => ({ broker: { recordDrop: () => {} }, listener: {} }),
    defaults,
  });
}

const request = (extra = {}) => ({
  parentRunId: PARENT_RUN,
  childRunId: "run-drop-capture",
  invocationId: "invocation-drop-capture",
  workerSource: "export {};",
  sandboxExecutor: async () => ({ status: "completed" }),
  dropCapturePoll: { attempts: 1, delayMs: 0 },
  ...extra,
});

const degraded = (id) => ({
  id,
  count: 0,
  drops: [],
  degraded: true,
  reason: "nft-unavailable",
});

test("a required run fails closed when capture degrades mid-run", async () => {
  const runtime = runtimeWith(degraded, { requireDropCapture: true });
  await assert.rejects(
    () => runtime.invoke({ request: request(), emitEgress: () => {} }),
    (error) => error?.code === "drop-capture-degraded",
  );
});

test("a best-effort run completes and surfaces the degradation", async () => {
  const runtime = runtimeWith(degraded);
  const result = await runtime.invoke({ request: request(), emitEgress: () => {} });
  assert.equal(result.status, "completed");
  assert.equal(result.dropCapture.degraded, true);
  assert.equal(result.dropCapture.reason, "nft-unavailable");
});

test("a required run with healthy capture completes", async () => {
  const runtime = runtimeWith(
    (id) => ({ id, count: 1, drops: [], degraded: false, reason: null }),
    { requireDropCapture: true },
  );
  const result = await runtime.invoke({ request: request(), emitEgress: () => {} });
  assert.equal(result.status, "completed");
  assert.equal(result.dropCapture.degraded, false);
});

// F1 regression: the config/policy routes (not just a top-level default) must
// drive the fail-closed drop-capture control on the public builder.
function configRuntime(extra) {
  const provider = {
    async start() {
      return { id: "cid-drop", attestation: {}, egress: null };
    },
    async stop() {},
    async collectDrops({ id }) {
      return degraded(id);
    },
  };
  return createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    sandboxExecutor: async () => ({ status: "completed" }),
    brokerFactory: async () => ({ broker: { recordDrop: () => {} }, listener: {} }),
    ...extra,
  });
}

test("config.egress.requireDropCapture fails closed on the builder route", async () => {
  const runtime = configRuntime({ egress: { requireDropCapture: true } });
  await assert.rejects(
    () => runtime.invoke({ request: request(), emitEgress: () => {} }),
    (error) => error?.code === "drop-capture-degraded",
  );
});

test("policy.dropCapture.required fails closed on the builder route", async () => {
  const runtime = configRuntime({ policy: { dropCapture: { required: true } } });
  await assert.rejects(
    () => runtime.invoke({ request: request(), emitEgress: () => {} }),
    (error) => error?.code === "drop-capture-degraded",
  );
});
