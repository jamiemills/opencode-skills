import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../lib/schema-runtime/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { createCsmBrowseAdapter, orchestrate } from "../csm-orchestrate/index.mjs";
import { createExecutorHandlers } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createExecutorDescriptors } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { acceptedReview, hostFixture, workingOptions } from "./helpers-final-review.mjs";
import {
  captureNative,
  closeSession,
  ensureSession,
  persistJsonEvidence,
  readNativeLog,
  startFixture,
} from "./orchestrate-browse-live-harness.mjs";

const LIVE_REQUIRED = process.env.CSM_ADAPTER_INTEGRATIONS_REQUIRED === "1";

test("outcome parity: orchestrated and standalone adapter runs agree on deterministic projections", async () => {
  const runId = "run-parity-stub";
  const base = hostFixture({ ideaSlug: "parity-stub" });
  const request = {
    skill: "csm-build",
    phaseId: "phase-parity-p1",
    childRunId: "run-parity-stub-child",
    acceptanceSignalIds: ["sig-parity"],
  };
  const standalone = await base.invokeSiblingSkill(request);
  const options = await workingOptions({
    runId,
    ideaSlug: "parity-stub",
    finalReview: async ({ phase, phaseResults, evidence }) =>
      acceptedReview({ runId, phase, phaseResults, evidence }),
  });
  const orchestrated = await orchestrate(options);
  assert.equal(orchestrated.outcome.status, "VERIFIED");
  const child = orchestrated.childReceipts[0];
  assert.deepEqual(
    canonicalize({ status: standalone.status, owner: standalone.childReceipt.owner }),
    canonicalize({ status: child.status, owner: child.owner }),
  );
  assert.equal(standalone.technical[0].status, "pass");
  assert.equal(child.status, "completed");
});

test("outcome parity: standalone refusal maps to a blocked orchestration, never verified", async () => {
  const base = hostFixture({ ideaSlug: "parity-refusal" });
  const options = await workingOptions({
    runId: "run-parity-refusal",
    ideaSlug: "parity-refusal",
  });
  options.host = {
    ...base,
    async invokeSiblingSkill() {
      return {
        status: "blocked",
        failure: { class: "policy", code: "approval-denied", message: "fixture refusal" },
        effects: [],
      };
    },
    artifactResolver: base.artifactResolver,
  };
  const orchestrated = await orchestrate(options);
  assert.notEqual(orchestrated.outcome.status, "VERIFIED");
  assert.ok(["BLOCKED", "INCOMPLETE"].includes(orchestrated.outcome.status));
});

test(
  "outcome parity: live browse capture agrees standalone vs orchestrated",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const evidenceRoot = await mkdtemp(join(tmpdir(), "parity-evidence-"));
    const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "parity-review-"));
    const schemaRegistry = await loadSchemaRegistry();
    const reviewResolver = createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry });
    const capabilities = await loadCapabilities();
    let ownedSession = null;
    try {
      // standalone path: capture + persist + resolve outside orchestration
      ownedSession = await ensureSession("parity-standalone");
      const standaloneNative = await captureNative({
        sid: "parity-standalone",
        runId: "run-parity-browse-standalone",
        fixtureUrl: fixture.baseUrl,
        state: ownedSession,
      });
      const standalonePersisted = await persistJsonEvidence({
        root: evidenceRoot,
        path: "evidence-standalone.json",
        native: standaloneNative,
      });
      const standaloneResolved = await reviewResolver.resolve(standalonePersisted.path, {
        expectedFileDigest: standalonePersisted.digest,
        expectedArtifactId:
          `art-${standalonePersisted.runId.slice(4)}-${standalonePersisted.evidenceId.slice(9)}`.slice(
            0,
            140,
          ),
        expectedOwner: "csm-browse",
        expectedSourceRunId: standalonePersisted.runId,
        expectedSourceDigest: standalonePersisted.sourceDigest,
      });

      // orchestrated path: same capture through orchestrate() with real review records
      const browseAdapter = createCsmBrowseAdapter({
        ensureSession: async ({ sid: requested }) => {
          ownedSession = await ensureSession(requested);
          return ownedSession;
        },
        cleanupSession: async ({ sid: requested }) => closeSession(requested),
        capture: async ({ sid: requested, context, state }) => {
          const native = await captureNative({
            sid: requested,
            runId: context.runId,
            fixtureUrl: fixture.baseUrl,
            state,
          });
          return persistJsonEvidence({
            root: evidenceRoot,
            path: "evidence-orchestrated.json",
            native,
          });
        },
        artifactResolver: { resolve: (...args) => reviewResolver.resolve(...args) },
      });
      const handlers = createExecutorHandlers({ csmBrowseAdapter: browseAdapter });
      const descriptor = createExecutorDescriptors({ handlers }).find(
        (item) => item.skill === "csm-browse",
      );
      const registry = await createSkillExecutorRegistry({ descriptors: [descriptor] });
      const store = createSqliteStore({ mode: "memory", now: () => "2026-09-05T12:00:00.000Z" });
      const adapter = createInProcessExecutorAdapter({
        registry,
        bindings: { "csm-browse": descriptor },
        capabilities: [capabilities.skills.find((item) => item.skill === "csm-browse")],
        cursorStore: store,
        artifactResolver: { resolve: (...args) => reviewResolver.resolve(...args) },
      });
      const options = await workingOptions({
        runId: "run-parity-browse-orchestrated",
        ideaSlug: "parity-browse",
      });
      options.executorAdapter = adapter;
      options.executorRegistry = registry;
      options.executorBindings = { "csm-browse": descriptor };
      options.executorInput = { operation: "capture", binaryAcknowledged: true };
      options.signals = { capabilities: ["csm-browse"], inputs: ["plan"] };
      options.approvals = async ({ phase, node, childRunId }) => ({
        schema: "csm-orchestrate-approval/2",
        approvalId: `approval-${childRunId}`,
        binding: {
          parentRunId: options.runId,
          childRunId,
          phaseId: phase.phaseId,
          edgeId: `edge-${node.nodeId}`,
        },
        scope: node.approvalScope.length ? node.approvalScope : ["read"],
        approvedDigest: node.capabilityDigest,
        approvedAt: "2026-09-05T00:00:00.000Z",
        expiresAt: "2099-09-05T00:00:00.000Z",
        status: "approved",
      });
      options.now = () => new Date("2026-09-05T12:00:00Z");
      options.cursorStore = store;
      const orchestrated = await orchestrate(options);
      const standaloneProjection = {
        status: standaloneResolved.status,
        sourceDigestBound:
          standaloneResolved?.value?.sourceDigest === standalonePersisted.sourceDigest,
      };
      const orchestratedProjection = {
        status: orchestrated.outcome.status === "VERIFIED" ? "resolved" : "failed",
        sourceDigestBound: orchestrated.outcome.status === "VERIFIED",
      };
      assert.deepEqual(orchestratedProjection, standaloneProjection);
      assert.equal(standaloneProjection.status, "resolved");
    } finally {
      if (ownedSession) await closeSession(ownedSession.sid).catch(() => {});
      await rm(evidenceRoot, { recursive: true, force: true });
      await rm(reviewArtifactRoot, { recursive: true, force: true });
      await fixture.close();
    }
  },
);

test(
  "outcome parity: readNativeLog evidence resolves identically on both paths",
  { skip: !LIVE_REQUIRED },
  async () => {
    const fixture = await startFixture();
    const evidenceRoot = await mkdtemp(join(tmpdir(), "parity-log-"));
    const schemaRegistry = await loadSchemaRegistry();
    const resolver = createArtifactResolver({ root: evidenceRoot, schemaRegistry });
    let ownedSession = null;
    try {
      ownedSession = await ensureSession("parity-log");
      const native = await readNativeLog({
        sid: ownedSession.sid,
        runId: "run-parity-log",
        fixtureUrl: fixture.baseUrl,
        state: ownedSession,
      });
      const persisted = await persistJsonEvidence({
        root: evidenceRoot,
        path: "log.json",
        native,
      });
      const resolved = await resolver.resolve(persisted.path, {
        expectedFileDigest: persisted.digest,
        expectedOwner: "csm-browse",
        expectedSourceRunId: persisted.runId,
        expectedSourceDigest: persisted.sourceDigest,
      });
      assert.equal(resolved.status, "resolved");
      assert.equal(resolved.value?.sourceDigest, persisted.sourceDigest);
    } finally {
      if (ownedSession) await closeSession(ownedSession.sid).catch(() => {});
      await rm(evidenceRoot, { recursive: true, force: true });
      await fixture.close();
    }
  },
);
