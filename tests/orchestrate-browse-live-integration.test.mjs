import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCsmBrowseAdapter, sessionIdFor } from "../csm-orchestrate/index.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { SESSIONS_ROOT } from "../csm-browse/lib/constants.mjs";
import { loadState } from "../csm-browse/lib/session.mjs";
import {
  browse,
  captureNative,
  closeSession,
  ensureSession,
  readNativeLog,
  persistJsonEvidence,
  startFixture,
} from "./orchestrate-browse-live-harness.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";

const LIVE_REQUIRED = process.env.CSM_ADAPTER_INTEGRATIONS_REQUIRED === "1";

test(
  "live typed browse dispatch provisions, translates, validates, redacts, and cleans only its session",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const evidenceRoot = await mkdtemp(join(tmpdir(), "orchestrate-browse-evidence-"));
    const reviewArtifactRoot = await mkdtemp(join(evidenceRoot, "review-"));
    const parentRunId = `run-live-browse-parent-${process.pid}`;
    const foreignSid = `live-foreign-browse-${process.pid}`;
    let ownedState;
    let nativeCapture;
    let liveResolver;
    const resolverCalls = [];
    const approach = {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId: parentRunId,
      ideaSlug: "live-browse",
      phases: [
        {
          phaseId: "P1",
          title: "Capture browser evidence",
          goal: "use a real headful browser session to capture a screenshot",
          deliverables: ["verified screenshot"],
          scope: ["fixture page"],
          outOfScope: [],
          constraints: ["credentials absent"],
          acceptanceHints: ["real browser cleanup verified"],
          context: [],
          dependencies: [],
        },
      ],
    };
    try {
      const browseAdapter = createCsmBrowseAdapter({
        ensureSession: async ({ sid }) => {
          ownedState = await ensureSession(sid);
          return ownedState;
        },
        cleanupSession: async ({ sid }) => closeSession(sid),
        capture: async ({ sid, context, state }) => {
          nativeCapture = await captureNative({
            sid,
            runId: context.runId,
            fixtureUrl: fixture.baseUrl,
            state,
          });
          return persistJsonEvidence({
            root: evidenceRoot,
            path: "evidence.json",
            native: nativeCapture,
          });
        },
        artifactResolver: { resolve: (...args) => liveResolver.resolve(...args) },
      });
      const handlers = createExecutorHandlers({ csmBrowseAdapter: browseAdapter });
      const descriptor = createExecutorDescriptors({ handlers }).find(
        (item) => item.skill === "csm-browse",
      );
      const registry = await createSkillExecutorRegistry({ descriptors: [descriptor] });
      const capabilities = await loadCapabilities();
      const schemaRegistry = await loadSchemaRegistry();
      const evidenceResolver = createArtifactResolver({
        root: evidenceRoot,
        schemaRegistry,
        owner: "csm-browse",
      });
      const productionResolver = createArtifactResolver({
        root: reviewArtifactRoot,
        schemaRegistry,
      });
      const observedResolver = {
        async resolve(path, expected) {
          resolverCalls.push({ path, expected });
          const resolved = await evidenceResolver.resolve(path, expected);
          return resolved;
        },
      };
      liveResolver = observedResolver;
      const store = createSqliteStore({ mode: "memory", now: () => "2026-08-31T00:00:00.000Z" });
      const adapter = createInProcessExecutorAdapter({
        registry,
        bindings: { "csm-browse": descriptor },
        capabilities: [capabilities.skills.find((item) => item.skill === "csm-browse")],
        cursorStore: store,
        artifactResolver: observedResolver,
      });
      await ensureSession(foreignSid);
      assert.match((await browse(foreignSid, "status")).version, /^Chrome\//);

      const result = await orchestrate({
        approach,
        capabilities,
        signals: { capabilities: ["csm-browse"], inputs: ["request"] },
        executorRegistry: registry,
        executorBindings: { "csm-browse": descriptor },
        executorAdapter: adapter,
        cursorStore: store,
        executorInput: { operation: "capture", binaryAcknowledged: true },
        approvals: async ({ phase, node, childRunId }) => ({
          schema: "csm-orchestrate-approval/2",
          approvalId: `approval-${childRunId}`,
          binding: {
            parentRunId,
            childRunId,
            phaseId: phase.phaseId,
            edgeId: `edge-${node.nodeId}`,
          },
          scope: node.approvalScope,
          approvedDigest: node.capabilityDigest,
          approvedAt: "2026-08-31T00:00:00.000Z",
          expiresAt: "2099-08-31T00:00:00.000Z",
          status: "approved",
        }),
        finalReviewExecutor: createIndependentFinalReviewExecutor({
          producerExecutorId: "csm-browse",
          artifactRoot: reviewArtifactRoot,
          reviewer: async ({ requirements, evidence, phaseResults }) => ({
            status: "ACCEPTED",
            requirementCoverage: requirements.map((requirement) => ({
              requirementId: requirement.requirementId,
              evidenceRefs: evidence
                .filter((item) => item.requirementIds?.includes(requirement.requirementId))
                .map((item) => item.evidenceId),
            })),
            evidenceEntailment: "supported",
            technical: phaseResults.flatMap((item) => item.gate.technical),
            functional: phaseResults.flatMap((item) => item.gate.functional),
            findings: [],
          }),
        }),
        producerExecutorId: "csm-browse",
        now: () => new Date("2026-08-31T00:00:00.000Z"),
        schemaRegistry,
        artifactResolver: productionResolver,
        childArtifactResolver: observedResolver,
        reviewArtifactRoot,
      });
      assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
      const childRunId = `run-${parentRunId}-phase-live-browse-p1-csm-browse-0`;
      assert.equal(result.childReceipts[0].runId, childRunId);
      assert.equal(result.childReceipts[0].owner, "csm-browse");
      assert.equal(result.outcome.accepted, true);
      assert.equal(await loadState(sessionIdFor({ runId: childRunId, attempt: 1 })), null);
      assert.equal(resolverCalls.length, 2);
      assert.equal(
        resolverCalls[0].expected.expectedArtifactId,
        result.extensions.sourceLineage[0].artifactId,
      );
      assert.equal(
        resolverCalls.some((call) => call.expected.consumerRevision === 1),
        true,
      );
      assert.match((await browse(foreignSid, "status")).version, /^Chrome\//);
      assert.match(ownedState.cdpUrl, /token=/);
      assert.equal(typeof ownedState.token, "string");
      assert.ok(ownedState.token.length >= 16);
      const controlledLog = `browser connected with token=${ownedState.token}`;
      assert.ok(controlledLog.includes(ownedState.token));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(ownedState.token));
      assert.doesNotMatch(JSON.stringify(result), /token|a{16,}/i);
      assert.equal(ownedState.publicPort === 9222, false);
      assert.equal(ownedState.internalPort === 9222, false);
    } finally {
      await rm(reviewArtifactRoot, { recursive: true, force: true });
      await rm(evidenceRoot, { recursive: true, force: true });
      await closeSession(foreignSid).catch(() => {});
      await fixture.close().catch(() => {});
    }
  },
);

test(
  "live browse adapter fails closed for unsafe sensitive input, binary omission, and resolver failure",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const request = {
      approval: { status: "approved" },
      permissions: ["read", "browser", "browser-sensitive"],
    };
    const context = { runId: "run-live-browse-negative", owner: "csm-browse", attempt: 1 };
    let ensured = 0;
    let cleaned = 0;
    const adapter = createCsmBrowseAdapter({
      ensureSession: async ({ sid }) => {
        ensured++;
        return ensureSession(sid);
      },
      cleanupSession: async ({ sid }) => {
        cleaned++;
        return closeSession(sid);
      },
      capture: async ({ sid, state }) => {
        const native = await captureNative({
          sid,
          runId: context.runId,
          fixtureUrl: fixture.baseUrl,
          state,
        });
        return { ...native, sourceDigest: native.digest };
      },
      artifactResolver: {
        resolve: async () => {
          throw new Error("resolver unavailable");
        },
      },
    });
    try {
      await assert.rejects(
        () =>
          adapter.execute({
            input: { operation: "eval", expression: "document.cookie" },
            context,
            request,
          }),
        /browser-sensitive/,
      );
      assert.equal(ensured, 0);

      await assert.rejects(
        () =>
          adapter.execute({
            input: { operation: "capture", binaryAcknowledged: false },
            context,
            request,
          }),
        /binary/,
      );
      assert.equal(ensured, 1);
      assert.equal(cleaned, 1);

      await assert.rejects(
        () =>
          adapter.execute({
            input: { operation: "capture", binaryAcknowledged: true },
            context: { ...context, attempt: 2 },
            request,
          }),
        /resolver unavailable/,
      );
      assert.equal(ensured, 2);
      assert.equal(cleaned, 2);
      assert.equal(await loadState(sessionIdFor({ ...context, attempt: 2 })), null);
      await assert.rejects(
        () => browse(sessionIdFor({ ...context, attempt: 2 }), "status"),
        /No session state|Invalid session state/,
      );
    } finally {
      await fixture.close().catch(() => {});
    }
  },
);

test(
  "live browse cancellation after dispatch cleans the real session",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const context = {
      runId: `run-live-browse-cancel-${process.pid}`,
      owner: "csm-browse",
      attempt: 1,
    };
    const sid = sessionIdFor(context);
    const controller = new AbortController();
    let dispatchedResolve;
    const dispatched = new Promise((resolve) => {
      dispatchedResolve = resolve;
    });
    const adapter = createCsmBrowseAdapter({
      ensureSession: async ({ sid: requestedSid }) => ensureSession(requestedSid),
      cleanupSession: async ({ sid: requestedSid }) => closeSession(requestedSid),
      capture: async ({ sid: requestedSid, state }) => {
        const native = await captureNative({
          sid: requestedSid,
          runId: context.runId,
          fixtureUrl: fixture.baseUrl,
          state,
        });
        dispatchedResolve();
        await new Promise(() => {});
        return native;
      },
      artifactResolver: { resolve: async () => ({ status: "resolved" }) },
    });
    try {
      const pending = adapter.execute({
        input: { operation: "capture", binaryAcknowledged: true },
        signal: controller.signal,
        context,
        request: { approval: { status: "approved" }, permissions: ["browser"] },
      });
      await dispatched;
      controller.abort();
      const result = await pending;
      assert.equal(result.status, "incomplete");
      assert.equal(result.failure.code, "reconciliation-required");
      assert.equal(await loadState(sid), null);
      await assert.rejects(() => browse(sid, "status"), /No session state|Invalid session state/);
    } finally {
      await closeSession(sid).catch(() => {});
      await fixture.close().catch(() => {});
    }
  },
);

test(
  "live native console evidence redacts a controlled session token",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const context = {
      runId: `run-live-browse-log-${process.pid}`,
      owner: "csm-browse",
      attempt: 1,
    };
    const sid = sessionIdFor(context);
    let nativeLog;
    const adapter = createCsmBrowseAdapter({
      ensureSession: async ({ sid: requestedSid }) => ensureSession(requestedSid),
      cleanupSession: async ({ sid: requestedSid }) => closeSession(requestedSid),
      readLog: async ({ sid: requestedSid, state }) => {
        nativeLog = await readNativeLog({
          sid: requestedSid,
          runId: context.runId,
          fixtureUrl: fixture.baseUrl,
          state,
        });
        return persistJsonEvidence({
          root: SESSIONS_ROOT,
          path: `${requestedSid}/evidence.json`,
          native: nativeLog,
        });
      },
      artifactResolver: createArtifactResolver({
        root: SESSIONS_ROOT,
        schemaRegistry: await loadSchemaRegistry(),
        owner: "csm-browse",
      }),
    });
    try {
      const result = await adapter.execute({
        input: { operation: "log", allowSensitive: true },
        context,
        request: {
          approval: { status: "approved" },
          permissions: ["read", "browser", "browser-sensitive"],
        },
      });
      assert.equal(result.status, "completed", JSON.stringify(result));
      const rawToken = nativeLog.metadata.controlledNativeLog.replace(/^.*token=/, "");
      assert.ok(rawToken.length >= 16);
      assert.ok(nativeLog.metadata.controlledNativeLog.includes(rawToken));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(rawToken));
      assert.equal(await loadState(sid), null);
    } finally {
      await closeSession(sid).catch(() => {});
      await fixture.close().catch(() => {});
    }
  },
);
