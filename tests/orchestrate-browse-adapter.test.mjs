import assert from "node:assert/strict";
import test from "node:test";
import { createCsmBrowseAdapter, sessionIdFor } from "../csm-orchestrate/index.mjs";
import {
  createExecutorHandlers,
  executeSkill,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { SESSIONS_ROOT } from "../csm-browse/lib/constants.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const context = { runId: "run-browse-adapter", owner: "csm-browse", attempt: 1 };
const request = {
  approval: { status: "approved" },
  permissions: ["read", "browser", "browser-sensitive"],
};

function state(sid, port = 9225) {
  const token = "a".repeat(16);
  return {
    sid,
    sessionDir: `${SESSIONS_ROOT}/${sid}`,
    publicPort: port,
    internalPort: port - 1,
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/test?token=${token}`,
    cdpUrl: `http://127.0.0.1:${port}/?token=${token}`,
    token,
    profileDir: `/config/csm-browse/sessions/${sid}`,
  };
}

function nativeEvidence() {
  const body = {
    schema: "csm-browse-evidence/1",
    evidenceId: "evidence-capture-test",
    runId: "run-native-browse",
    owner: "csm-browse",
    kind: "screenshot",
    path: "artifacts/capture.png",
    digest: digest("bytes"),
    bytes: 5,
    contentType: "image/png",
    capturedAt: "2026-08-31T00:00:00.000Z",
    metadata: {},
    binaryAcknowledged: true,
  };
  return { ...body, descriptorDigest: digest(body) };
}

test("browse derives an owned session and translates resolver-validated evidence", async () => {
  let ensured = 0;
  let cleaned = 0;
  const native = nativeEvidence();
  const adapter = createCsmBrowseAdapter({
    ensureSession: async ({ sid }) => {
      ensured++;
      return state(sid);
    },
    cleanupSession: async () => {
      cleaned++;
    },
    capture: async () => native,
    artifactResolver: { resolve: async () => ({ status: "resolved", fileDigest: native.digest }) },
  });
  const result = await executeSkill(
    "csm-browse",
    { input: { operation: "capture", binaryAcknowledged: true }, context, request },
    {
      handlers: createExecutorHandlers({ csmBrowseAdapter: adapter }),
      descriptor: { effects: ["browser-session", "workspace-write"] },
    },
  );
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(ensured, 1);
  assert.equal(cleaned, 1);
  assert.equal(result.evidence[0].source.nativeArtifactId, native.evidenceId);
  assert.equal(result.artifacts[0].nativeRunId, native.runId);
});

test("browse cleanup failure preserves UNKNOWN reconciliation authority after cancellation", async () => {
  const controller = new AbortController();
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const adapter = createCsmBrowseAdapter({
    ensureSession: async ({ sid }) => state(sid),
    cleanupSession: async () => {
      throw new Error("cleanup unavailable");
    },
    capture: async () => {
      startedResolve();
      return new Promise(() => {});
    },
    artifactResolver: { resolve: async () => ({ status: "resolved" }) },
  });
  const pending = adapter.execute({
    input: { operation: "capture", binaryAcknowledged: true },
    signal: controller.signal,
    context: { runId: "run-browse-cleanup-failure", owner: "csm-browse", attempt: 1 },
    request,
  });
  await started;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "incomplete");
  assert.equal(result.failure.code, "reconciliation-required");
  assert.match(result.failure.message, /cleanup unavailable/);
});

test("browse rejects unsafe ports, sensitive operations, and binary output before dispatch", async () => {
  let ensured = 0;
  const adapter = createCsmBrowseAdapter({
    ensureSession: async ({ sid }) => {
      ensured++;
      return state(sid, 9222);
    },
    cleanupSession: async () => {},
    capture: async () => nativeEvidence(),
    artifactResolver: {
      resolve: async () => ({ status: "resolved", fileDigest: digest("bytes") }),
    },
  });
  const handlers = createExecutorHandlers({ csmBrowseAdapter: adapter });
  const blocked = await executeSkill(
    "csm-browse",
    { input: { operation: "capture", binaryAcknowledged: true }, context, request },
    { handlers, descriptor: { effects: ["browser-session", "workspace-write"] } },
  );
  assert.equal(blocked.status, "failed");
  assert.equal(blocked.failure.code, "shared-port-forbidden");
  assert.equal(ensured, 1);

  let called = false;
  const sensitive = createCsmBrowseAdapter({
    ensureSession: async ({ sid }) => {
      called = true;
      return state(sid);
    },
    cleanupSession: async () => {},
  });
  await assert.rejects(
    () => sensitive.execute({ input: { operation: "eval", expression: "1" }, context, request }),
    /browser-sensitive/,
  );
  assert.equal(called, false);
  await assert.rejects(
    () =>
      sensitive.execute({
        input: { operation: "capture", binaryAcknowledged: false },
        context,
        request,
      }),
    /binary/,
  );
});

test("browse pre-dispatch cancellation provisions no session and identity is deterministic", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const adapter = createCsmBrowseAdapter({
    ensureSession: async () => {
      called = true;
    },
    cleanupSession: async () => {},
  });
  const result = await adapter.execute({
    input: { operation: "navigate", url: "https://example.test" },
    signal: controller.signal,
    context,
    request,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(called, false);
  assert.match(sessionIdFor(context), /^orch-[a-f0-9]{32}$/);
});
