"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostInvocationAdapter } from "../csm-orchestrate/lib/invocation.mjs";
import { createCsmBrowseAdapter } from "../csm-orchestrate/lib/csm-browse-adapter.mjs";
import { persistTerminalReceipt } from "../csm-orchestrate/lib/recovery.mjs";
import { createSqliteStore, resolveSqliteDriver } from "../lib/orchestration-store/index.mjs";
import { digest as stableDigest } from "../lib/schema-runtime/index.mjs";
import { SESSIONS_ROOT } from "../csm-browse/lib/constants.mjs";

const SQLITE_AVAILABLE = resolveSqliteDriver().available;
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const skills = ["csm-build", "csm-browse", "csm-autoresearch"];

function request(skill, overrides = {}) {
  return {
    schema: "csm-orchestrate-invocation/2",
    invocationId: `invocation-recovery-${skill}`,
    parentRunId: "run-adapter-recovery-parent",
    childRunId: `run-adapter-recovery-${skill}`,
    phaseId: "phase-adapter-recovery",
    edgeId: `edge-${skill}`,
    skill,
    skillDigest: digest("a"),
    inputArtifactRefs: [],
    upstreamArtifactRefs: [],
    outputArtifactRefs: [],
    permissions: ["read", "write"],
    approval: {
      schema: "csm-orchestrate-approval/2",
      approvalId: `approval-${skill}`,
      binding: {
        parentRunId: "run-adapter-recovery-parent",
        childRunId: `run-adapter-recovery-${skill}`,
        phaseId: "phase-adapter-recovery",
        edgeId: `edge-${skill}`,
      },
      scope: ["read", "write"],
      approvedDigest: digest("a"),
      approvedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2099-08-31T00:00:00.000Z",
      status: "approved",
    },
    timeoutMs: 100,
    cancellation: { requested: false },
    retry: { attempt: 1, idempotencyKey: `recovery-key-${skill}` },
    status: "ready",
    sideEffectClass: "workspace-write",
    ...overrides,
  };
}

function faultStore(store, method, mode = "before") {
  let fired = false;
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== method || typeof value !== "function") return value;
      return async (...args) => {
        if (!fired && mode === "before") {
          fired = true;
          throw new Error(`fault:${String(method)}`);
        }
        const result = await value.apply(target, args);
        if (!fired && mode === "after") {
          fired = true;
          throw new Error(`fault:${String(method)}`);
        }
        return result;
      };
    },
  });
}

function completed(skill, calls) {
  return {
    status: "completed",
    output: { skill, calls },
    evidence: [],
    outputArtifactRefs: [],
  };
}

async function freshStore(t, name) {
  if (!SQLITE_AVAILABLE) {
    t.skip("node:sqlite unavailable");
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), `t006-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, databasePath: join(dir, "orchestrate.db") };
}

test("pre-dispatch cancellation mutates no durable child state", async (t) => {
  const paths = await freshStore(t, "cancel");
  if (!paths) return;
  const store = createSqliteStore({ databasePath: paths.databasePath, mode: "wal" });
  try {
    let calls = 0;
    const result = await createHostInvocationAdapter({
      capabilities: [{ skill: "csm-build", digest: digest("a") }],
      cursorStore: store,
      host: { invokeSiblingSkill: async () => (++calls, completed("csm-build", calls)) },
    }).invoke(request("csm-build", { cancellation: { requested: true } }));
    assert.equal(result.failure.code, "cancelled");
    assert.equal(calls, 0);
    assert.deepEqual(await store.loadChildAttempts("run-adapter-recovery-csm-build"), []);
  } finally {
    store.close();
  }
});

test("a restarted dispatched attempt becomes durable UNKNOWN instead of replaying an effect", async (t) => {
  const paths = await freshStore(t, "unknown");
  if (!paths) return;
  const store = createSqliteStore({ databasePath: paths.databasePath, mode: "wal" });
  const req = request("csm-browse");
  try {
    await store.beginChildAttempt({
      attemptId: "attempt-recovery-dispatched",
      logicalKey: req.retry.idempotencyKey,
      requestDigest: stableDigest(
        Object.fromEntries(Object.entries(req).filter(([key]) => key !== "status")),
      ),
      parentRunId: req.parentRunId,
      childRunId: req.childRunId,
      phaseId: req.phaseId,
      attempt: 1,
      capabilityDigest: req.skillDigest,
      contractDigest: digest("c"),
      handlerDigest: digest("d"),
      receiptSchemaDigest: digest("e"),
      evidenceSchemaDigest: digest("f"),
      configDigest: digest("0"),
      sideEffectClass: "browser-session",
    });
    store.close();
    const reopened = createSqliteStore({ databasePath: paths.databasePath, mode: "wal" });
    try {
      let calls = 0;
      const result = await createHostInvocationAdapter({
        capabilities: [{ skill: "csm-browse", digest: digest("a") }],
        cursorStore: reopened,
        host: { invokeSiblingSkill: async () => (++calls, completed("csm-browse", calls)) },
      }).invoke({ ...req, sideEffectClass: "foreign-effect" });
      assert.equal(
        result.failure.code,
        "idempotency-conflict",
        "tampered request digest fails closed",
      );

      const matching = { ...req };
      const unknown = await createHostInvocationAdapter({
        capabilities: [{ skill: "csm-browse", digest: digest("a") }],
        cursorStore: reopened,
        host: { invokeSiblingSkill: async () => (++calls, completed("csm-browse", calls)) },
      }).invoke(matching);
      assert.equal(unknown.failure.code, "reconciliation-required");
      assert.equal(calls, 0);
      assert.equal(
        (await reopened.loadChildAttemptByKey(req.retry.idempotencyKey)).state,
        "UNKNOWN",
      );
      assert.equal((await reopened.getReconciliation(req.childRunId)).outcome, "UNKNOWN");
    } finally {
      reopened.close();
    }
  } finally {
    if (!store.closed) store.close();
  }
});

test("matching terminal responses replay across WAL reopen for all adapter-shaped routes", async (t) => {
  const paths = await freshStore(t, "replay");
  if (!paths) return;
  for (const skill of skills) {
    const databasePath = join(paths.dir, `${skill}.db`);
    const store = createSqliteStore({ databasePath, mode: "wal" });
    let calls = 0;
    const first = await createHostInvocationAdapter({
      capabilities: [{ skill, digest: digest("a") }],
      cursorStore: store,
      host: { invokeSiblingSkill: async () => (++calls, completed(skill, calls)) },
    }).invoke(request(skill));
    store.close();
    const reopened = createSqliteStore({ databasePath, mode: "wal" });
    try {
      const replay = await createHostInvocationAdapter({
        capabilities: [{ skill, digest: digest("a") }],
        cursorStore: reopened,
        host: { invokeSiblingSkill: async () => (++calls, completed(skill, calls)) },
      }).invoke(request(skill));
      assert.deepEqual(replay, first);
      assert.equal(calls, 1, `${skill} effect was duplicated`);
    } finally {
      reopened.close();
    }
  }
});

test("effect failure after dispatch and terminal persistence fault are reconciliation-safe", async (t) => {
  const paths = await freshStore(t, "faults");
  if (!paths) return;
  const databasePath = paths.databasePath;
  let store = createSqliteStore({ databasePath, mode: "wal" });
  try {
    let effects = 0;
    const failed = await createHostInvocationAdapter({
      capabilities: [{ skill: "csm-autoresearch", digest: digest("a") }],
      cursorStore: store,
      host: {
        invokeSiblingSkill: async () => {
          effects++;
          throw new Error("crash after evaluator effect");
        },
      },
    }).invoke(request("csm-autoresearch"));
    assert.equal(failed.failure.code, "reconciliation-required");
    assert.equal(
      (await store.getReconciliation("run-adapter-recovery-csm-autoresearch")).outcome,
      "UNKNOWN",
    );
    store.close();
    store = createSqliteStore({ databasePath, mode: "wal" });
    const replay = await createHostInvocationAdapter({
      capabilities: [{ skill: "csm-autoresearch", digest: digest("a") }],
      cursorStore: store,
      host: { invokeSiblingSkill: async () => (++effects, completed("csm-autoresearch", effects)) },
    }).invoke(request("csm-autoresearch"));
    assert.equal(replay.failure.code, "reconciliation-required");
    assert.equal(effects, 1);
  } finally {
    store.close();
  }
});

test("cleanup is reached on cancellation without accepting a foreign session", async (t) => {
  const paths = await freshStore(t, "cleanup");
  if (!paths) return;
  const controller = new AbortController();
  let cleaned = 0;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const adapter = createCsmBrowseAdapter({
    ensureSession: async ({ sid }) => {
      return {
        sid,
        sessionDir: `${SESSIONS_ROOT}/${sid}`,
        publicPort: 9225,
        internalPort: 9224,
      };
    },
    cleanupSession: async ({ sid, state }) => {
      assert.equal(state.sid, sid);
      cleaned++;
    },
    capture: async () => {
      startedResolve();
      return new Promise((resolve) =>
        controller.signal.addEventListener("abort", resolve, { once: true }),
      );
    },
    artifactResolver: { resolve: async () => ({ status: "resolved" }) },
  });
  const pending = adapter.execute({
    input: { operation: "capture", binaryAcknowledged: true },
    signal: controller.signal,
    context: { runId: "run-adapter-recovery-browse-cleanup", owner: "csm-browse", attempt: 1 },
    request: { approval: { status: "approved" }, permissions: ["browser"] },
  });
  await started;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "incomplete");
  assert.equal(cleaned, 1);
  void paths;
});

test("review terminal records remain monotonic after an after-write fault", async (t) => {
  const paths = await freshStore(t, "review");
  if (!paths) return;
  const store = createSqliteStore({ databasePath: paths.databasePath, mode: "wal" });
  const receipt = {
    schema: "csm-orchestrate-receipt/1",
    receiptId: "receipt-adapter-recovery-review",
    runId: "run-adapter-recovery-parent",
    phaseId: "phase-adapter-recovery",
    childReceipts: [],
    approval: {
      approvalId: "approval-review",
      scope: ["review"],
      approvedDigest: digest("a"),
      approvedAt: "2026-08-31T00:00:00Z",
      expiresAt: "2099-08-31T00:00:00Z",
      status: "approved",
    },
    statuses: {
      route: "complete",
      child: "completed",
      artifact: "none",
      verification: "verified",
      parent: "verified",
    },
    outcome: { status: "VERIFIED", accepted: true, acceptanceRefs: [] },
    idempotencyKey: "review-recovery-key",
  };
  try {
    await assert.rejects(
      persistTerminalReceipt(receipt, faultStore(store, "saveTerminalReceipt", "after")),
      /fault:saveTerminalReceipt/,
    );
    assert.equal((await store.loadTerminalReceipt(receipt.receiptId)).outcome.status, "VERIFIED");
  } finally {
    store.close();
  }
});
