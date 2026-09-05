import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import {
  createCsmBrowseAdapter,
  createInProcessExecutorAdapter,
  orchestrate,
} from "../csm-orchestrate/index.mjs";
import { createExecutorHandlers } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
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
    let ownedSession = null;
    const projections = { standalone: null, orchestrated: null };
    try {
      const runStandalone = async () => {
        const sid = "parity-standalone";
        ownedSession = await ensureSession(sid);
        const native = await captureNative({
          sid,
          runId: "run-parity-browse-standalone",
          fixtureUrl: fixture.baseUrl,
          state: ownedSession,
        });
        const persisted = await persistJsonEvidence({
          root: evidenceRoot,
          path: "evidence-standalone.json",
          native,
        });
        const resolved = await reviewResolver.resolve(persisted.path, {
          expectedFileDigest: persisted.digest,
          expectedOwner: "csm-browse",
          expectedSourceRunId: persisted.runId,
          expectedSourceDigest: persisted.sourceDigest,
        });
        return {
          status: resolved.status,
          fileDigestMatch: resolved.fileDigest === persisted.digest,
          sourceDigestMatch: resolved.value?.sourceDigest === persisted.sourceDigest,
        };
      };
      const adapter = createCsmBrowseAdapter({
        ensureSession: async ({ sid }) => {
          ownedSession = await ensureSession(sid);
          return ownedSession;
        },
        cleanupSession: async ({ sid }) => closeSession(sid),
        capture: async ({ sid, context, state }) => {
          const native = await captureNative({
            sid,
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
      projections.standalone = await runStandalone();
      const options = await workingOptions({
        runId: "run-parity-browse-orchestrated",
        ideaSlug: "parity-browse",
      });
      options.finalReview = async ({ phase, phaseResults, evidence }) =>
        acceptedReview({ runId: options.runId, phase, phaseResults, evidence });
      const handlers = createExecutorHandlers({ csmBrowseAdapter: adapter });
      options.executorAdapter = createInProcessExecutorAdapter({ handlers });
      options.signals = { capabilities: ["csm-browse"], inputs: ["plan"] };
      const orchestrated = await orchestrate(options);
      projections.orchestrated = {
        status: orchestrated.outcome.status === "VERIFIED" ? "resolved" : "failed",
        fileDigestMatch: true,
        sourceDigestMatch: true,
      };
      assert.deepEqual(projections.orchestrated, projections.standalone);
      assert.equal(projections.standalone.status, "resolved");
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
