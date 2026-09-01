import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { descriptorDigest, payloadDigest } from "../lib/digest-taxonomy/index.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { HOST_REVIEW } from "../csm-orchestrate/lib/review-token.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createExecutorDescriptors } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const RUN_PREFIX = "run-outcome-corpus";
const capabilities = await loadCapabilities();
const scanDescriptor = createExecutorDescriptors().find((item) => item.skill === "csm-scan");
const dddDescriptor = createExecutorDescriptors().find((item) => item.skill === "csm-ddd");
const accepted = async () => ({ status: "ACCEPTED", findings: [] });
const fileDigest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function approach(runId, goal = "repository conventions") {
  return {
    schema: "csm-approach/1",
    schemaRevision: 1,
    status: "agreed",
    runId,
    ideaSlug: "outcome",
    phases: [
      {
        phaseId: "P1",
        title: "Inspect",
        goal,
        deliverables: ["typed result"],
        scope: ["repository"],
        outOfScope: ["production"],
        constraints: [],
        acceptanceHints: ["technical pass", "functional pass"],
        context: [],
        dependencies: [],
      },
    ],
  };
}

function evidenceFor(request, mode, context) {
  if (mode === "partial") return null;
  const body = {
    schema: "csm-orchestrate-evidence/2",
    evidenceId: `ev-${context.runId.slice(4)}`,
    kind: "technical",
    status: "current",
    owner: context.owner,
    runId: context.runId,
    requirementIds: [
      "req-outcome-p1",
      "req-outcome-phase-p1",
      "req-outcome-remediation-outcome",
      "req-remediation-p1",
    ],
    acceptanceSignalId: request.acceptanceSignalIds[0],
    source: {
      path: `outcome-${context.runId}.json`,
      artifactId: `art-${context.runId}`,
      digest: digest({ runId: context.runId, mode }),
      schema: "csm-orchestrate-evidence/2",
      sourceRunId: context.runId,
    },
  };
  return { ...body, digest: digest(body) };
}

function makeHarness(mode) {
  const store = createSqliteStore({ mode: "memory", now: () => "2026-08-31T00:00:00.000Z" });
  const effects = [];
  const artifacts = new Map();
  let reviewArtifactRoot;
  let handlerCalls = 0;
  let reviewCalls = 0;
  const handler = async ({ context, input }) => {
    handlerCalls += 1;
    effects.push({ key: input.idempotencyKey, effect: "read-only" });
    if (mode === "refusal")
      return {
        status: "blocked",
        failure: { class: "policy", code: "approval-denied", message: "fixture refusal" },
        effects: [],
        artifacts: [],
        receipt: null,
      };
    const evidence = evidenceFor(input, mode, context);
    if (evidence) artifacts.set(evidence.source.path, evidence);
    const receiptBody = {
      schema: "csm-orchestrate-child-receipt/1",
      receiptId: `receipt-${context.runId.slice(4)}-${context.attempt}`,
      runId: context.runId,
      owner: context.owner,
      attempt: context.attempt,
      status: "completed",
    };
    return {
      status: "completed",
      effects: ["read-only"],
      receipt: { ...receiptBody, digest: digest(receiptBody) },
      evidence: evidence ? [evidence] : [],
      artifacts: [],
      technical: [{ id: "technical", status: "pass" }],
      functional: [{ id: "functional", status: "pass" }],
    };
  };
  const bindings = {
    "csm-scan": { ...scanDescriptor, handler },
    "csm-ddd": { ...dddDescriptor, handler },
  };
  const setup = async () => {
    const registry = await createSkillExecutorRegistry({ descriptors: Object.values(bindings) });
    const inProcessAdapter = createInProcessExecutorAdapter({
      registry,
      bindings,
      capabilities,
      cursorStore: store,
      inputForRequest: async (request) => ({
        idempotencyKey: request.retry.idempotencyKey,
        acceptanceSignalIds: request.acceptanceSignalIds,
      }),
    });
    const adapter = {
      async invoke(request, options) {
        const result = await inProcessAdapter.invoke(request, options);
        if (result.status !== "completed") return result;
        return {
          ...result,
          technical: [
            {
              id: "technical",
              status: "pass",
              evidenceRefs: result.evidence.map((item) => item.evidenceId),
            },
          ],
          functional: [
            {
              id: "functional",
              status: "pass",
              evidenceRefs: result.evidence.map((item) => item.evidenceId),
            },
          ],
        };
      },
    };
    reviewArtifactRoot = await mkdtemp(join(tmpdir(), "outcome-review-"));
    const schemaRegistry = await loadSchemaRegistry();
    const options = {
      approach: approach(`${RUN_PREFIX}-${mode}`),
      runId: `${RUN_PREFIX}-${mode}`,
      capabilities,
      signals: { capabilities: ["csm-scan"], inputs: ["repository"] },
      executorRegistry: registry,
      executorBindings: bindings,
      executorAdapter: adapter,
      cursorStore: store,
      approvals: async ({ phase, node, childRunId }) => ({
        schema: "csm-orchestrate-approval/1",
        approvalId: `approval-${childRunId}`,
        binding: {
          parentRunId: `${RUN_PREFIX}-${mode}`,
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
      now: () => new Date("2026-08-31T00:00:00.000Z"),
      schemaRegistry,
      artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),
      childArtifactResolver: {
        async resolve(path, expected = {}) {
          const value = artifacts.get(path);
          if (!value) return { status: "missing", code: "missing", message: "fixture missing" };
          return {
            status: "resolved",
            path,
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: { ...value, schema: value.source.schema },
          };
        },
      },
      reviewArtifactRoot,
    };
    return { options, adapter, reviewArtifactRoot };
  };
  return {
    setup,
    get handlerCalls() {
      return handlerCalls;
    },
    get reviewCalls() {
      return reviewCalls;
    },
    effects,
    async finalReview(request) {
      reviewCalls += 1;
      const status = mode === "remediation" && reviewCalls === 1 ? "REJECTED" : "ACCEPTED";
      const parentRunId = request.graph.runId;
      const phaseId = request.phase.phaseId;
      const edgeId = "edge-final-review";
      const inputDigest = digest(
        JSON.stringify({
          parentRunId,
          phaseId,
          evidenceIds: request.evidence.map((item) => item.evidenceId),
        }),
      );
      const reviewerChildRunId = `run-outcome-review-${reviewCalls}`;
      const artifact = {
        artifactId: `art-outcome-review-${reviewCalls}`,
        runId: reviewerChildRunId,
        owner: "csm-outcome-reviewer",
        schema: "csm-orchestrate-adversarial-review/2",
        path: `review-${reviewCalls}.json`,
        resolution: "in-process-independent-review",
        digest: digest({ inputDigest, status }),
      };
      const review = {
        schema: "csm-orchestrate-adversarial-review/2",
        reviewId: `review-outcome-${reviewCalls}`,
        runId: parentRunId,
        phaseId,
        status,
        independent: true,
        inputDigest,
        provenance: {
          mode: "host-backed",
          reviewer: "csm-outcome-reviewer",
          executor: "csm-outcome-review-executor",
          owner: "csm-outcome-reviewer",
          reviewerChildRunId,
          receipt: {
            artifactId: `receipt-outcome-review-${reviewCalls}`,
            runId: reviewerChildRunId,
            owner: "csm-outcome-reviewer",
            schema: "csm-review-receipt/1",
            path: `review-receipt-${reviewCalls}.json`,
            resolution: "in-process-independent-review",
            digest: digest({ inputDigest, status, receipt: true }),
          },
          artifact,
          approval: {
            schema: "csm-orchestrate-approval/2",
            approvalId: `approval-outcome-review-${reviewCalls}`,
            edgeId,
            runId: parentRunId,
            parentRunId,
            reviewerChildRunId,
            phaseId,
            approvedDigest: artifact.digest,
            binding: {
              parentRunId,
              childRunId: reviewerChildRunId,
              phaseId,
              edgeId,
            },
            scope: ["review"],
            approvedAt: "2026-08-31T00:00:00.000Z",
            expiresAt: "2099-08-31T00:00:00.000Z",
            status: "approved",
          },
        },
        requirementCoverage: request.phaseResults.flatMap(({ phase }) =>
          phase.requirementIds.map((requirementId) => ({
            requirementId,
            evidenceRefs: request.evidence
              .filter((item) => item.requirementIds?.includes(requirementId))
              .map((item) => ({
                evidenceId: item.evidenceId,
                acceptanceSignalId: item.acceptanceSignalId,
              })),
          })),
        ),
        evidenceEntailment: "supported",
        technical: [{ status: "pass" }],
        functional: [{ status: "pass" }],
        findings: status === "REJECTED" ? [{ code: "gap", severity: "high" }] : [],
      };
      Object.defineProperty(review, HOST_REVIEW, { value: true });
      const artifactRecord = {
        schema: "csm-artifact/1",
        artifact: {
          artifactId: artifact.artifactId,
          kind: "orchestrate-final-review",
          owner: artifact.owner,
          runId: reviewerChildRunId,
          digest: artifact.digest,
          createdAt: "2026-08-31T00:00:00.000Z",
          revision: 1,
        },
        contentType: "application/json",
        lifecycleStatus: "completed",
        location: `review-artifact-${reviewerChildRunId}.json`,
        sourceDigest: inputDigest,
        sourceRunId: reviewerChildRunId,
        sourceArtifactIds: [artifact.artifactId],
      };
      artifactRecord.payloadDigest = payloadDigest(artifactRecord);
      artifactRecord.descriptorDigest = descriptorDigest(artifactRecord);
      const receiptBody = {
        schema: "csm-review-receipt/1",
        receiptId: `receipt-outcome-review-${reviewCalls}`,
        runId: reviewerChildRunId,
        owner: artifact.owner,
        status: "completed",
        reviewId: review.reviewId,
        reviewArtifactId: artifact.artifactId,
        reviewDigest: artifact.digest,
        inputDigest,
        sourceDigest: inputDigest,
        sourceRunId: reviewerChildRunId,
        sourceArtifactIds: [artifact.artifactId],
      };
      const receipt = { ...receiptBody, receiptDigest: digest(receiptBody) };
      review.owner = artifact.owner;
      review.sourceDigest = inputDigest;
      review.sourceRunId = reviewerChildRunId;
      review.sourceArtifactIds = [artifact.artifactId];
      review.provenance.receipt = {
        ...review.provenance.receipt,
        digest: fileDigest(Buffer.from(`${JSON.stringify(receipt)}\n`)),
      };
      const records = [
        ["review", review],
        ["artifact", artifactRecord],
        ["receipt", receipt],
      ];
      const refs = [];
      for (const [recordType, value] of records) {
        const path = `${recordType}-${reviewerChildRunId}.json`;
        const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
        await writeFile(join(reviewArtifactRoot, path), bytes);
        refs.push({
          recordType,
          recordId:
            recordType === "review"
              ? value.reviewId
              : recordType === "artifact"
                ? value.artifact.artifactId
                : value.receiptId,
          schema: value.schema,
          path,
          digest: fileDigest(bytes),
          sourceOwner: artifact.owner,
          sourceRunId: reviewerChildRunId,
          sourceDigest: inputDigest,
          sourceArtifactId: artifact.artifactId,
        });
      }
      return { status: "completed", review, reviewArtifactRefs: refs };
    },
    get reviewArtifactRoot() {
      return reviewArtifactRoot;
    },
    async cleanup() {
      if (reviewArtifactRoot) await rm(reviewArtifactRoot, { recursive: true, force: true });
    },
  };
}

async function run(mode, { review = true } = {}) {
  const harness = makeHarness(mode);
  const { options } = await harness.setup();
  if (review) options.finalReview = (request) => harness.finalReview(request);
  if (mode === "remediation")
    options.remediationFactory = async ({ graph }) => ({
      phaseId: "phase-remediation-outcome",
      parentPhaseId: graph.phases[0].phaseId,
      graphRevision: graph.graphRevision + 1,
      insertion: { insertedAfter: graph.phases[0].phaseId },
      route: "csm-ddd",
      requirementDelta: ["req-remediation-p1"],
      requirementIds: ["req-remediation-p1"],
      acceptanceSignals: ["reviewed"],
      approvalScope: ["read"],
      idempotency: { key: "outcome-remediation", mode: "read-only" },
      sideEffects: ["read-only"],
      remediationBudget: 1,
    });
  try {
    return { result: await orchestrate(options), harness, options };
  } finally {
    await harness.cleanup();
  }
}

async function runInvalidPersistedReview(mutate) {
  const harness = makeHarness("success");
  const { options } = await harness.setup();
  options.finalReview = async (request) => {
    const result = await harness.finalReview(request);
    await mutate(result, harness);
    return result;
  };
  try {
    return await orchestrate(options);
  } finally {
    await harness.cleanup();
  }
}

test("outcome corpus preserves verified success and zero duplicate effects", async () => {
  const first = await run("success");
  assert.equal(first.result.outcome.status, "VERIFIED", JSON.stringify(first.result));
  assert.equal(first.harness.handlerCalls, 1);
  assert.equal(new Set(first.harness.effects.map((item) => item.key)).size, 1);
  assert.equal(first.harness.effects.length, 1);
});

test("outcome corpus preserves refusal and partial outcomes without false VERIFIED", async () => {
  const refused = await run("refusal");
  assert.equal(refused.result.outcome.status, "BLOCKED", JSON.stringify(refused.result));
  const partial = await run("partial");
  assert.equal(partial.result.outcome.status, "INCOMPLETE", JSON.stringify(partial.result));
  assert.notEqual(partial.result.outcome.status, "VERIFIED");
});

test("outcome corpus preserves bounded remediation and final verification", async () => {
  const { result, harness } = await run("remediation");
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.deepEqual(
    result.extensions.phaseSummaries.map((phase) => phase.phaseId),
    ["phase-outcome-p1", "phase-remediation-outcome"],
  );
  assert.equal(harness.handlerCalls, 2);
  assert.equal(harness.reviewCalls, 2);
  assert.equal(harness.effects.length, 2);
});

test("unsupported and model routes fail closed, while absent review requires review", async () => {
  const unsupported = await run("success");
  unsupported.options.signals = { capabilities: ["csm-browse"], inputs: ["browser task"] };
  const blocked = await orchestrate(unsupported.options);
  assert.equal(blocked.outcome.status, "BLOCKED", JSON.stringify(blocked));
  assert.equal(unsupported.harness.handlerCalls, 1);

  const model = await run("success");
  model.options.signals = { capabilities: ["csm-build"], inputs: ["plan"] };
  const modelBlocked = await orchestrate(model.options);
  assert.equal(modelBlocked.outcome.status, "BLOCKED", JSON.stringify(modelBlocked));
  assert.equal(model.harness.handlerCalls, 1);

  const reviewMissing = await run("success", { review: false });
  assert.equal(
    reviewMissing.result.outcome.status,
    "REQUIRES_REVIEW",
    JSON.stringify(reviewMissing.result),
  );
  assert.notEqual(reviewMissing.result.outcome.status, "VERIFIED");
});

test("in-process final review verifies only with distinct producer and reviewer identities", async () => {
  const distinct = makeHarness("success");
  const distinctSetup = await distinct.setup();
  distinctSetup.options.finalReviewExecutor = createIndependentFinalReviewExecutor({
    reviewer: accepted,
    reviewerId: "csm-independent-reviewer",
    executorId: "csm-independent-review-executor",
    artifactRoot: distinctSetup.reviewArtifactRoot,
  });
  distinctSetup.options.producerExecutorId = "csm-scan-executor";
  const verified = await orchestrate(distinctSetup.options);
  await distinct.cleanup();
  assert.equal(verified.outcome.status, "VERIFIED", JSON.stringify(verified));
  assert.notEqual(
    verified.finalReview.provenance.reviewer,
    distinctSetup.options.producerExecutorId,
  );

  const missing = makeHarness("success");
  const missingSetup = await missing.setup();
  missingSetup.options.finalReviewExecutor = createIndependentFinalReviewExecutor({
    reviewer: accepted,
  });
  const missingResult = await orchestrate(missingSetup.options);
  assert.equal(missingResult.outcome.status, "REQUIRES_REVIEW");
  assert.equal(missingResult.reviewState, "UNKNOWN");

  const self = makeHarness("success");
  const selfSetup = await self.setup();
  selfSetup.options.finalReviewExecutor = createIndependentFinalReviewExecutor({
    reviewer: accepted,
  });
  selfSetup.options.producerExecutorId = "csm-review-independent";
  const selfResult = await orchestrate(selfSetup.options);
  assert.equal(selfResult.outcome.status, "REQUIRES_REVIEW");
  assert.equal(selfResult.reviewState, "UNKNOWN");
});

test("default resolver review failures never become VERIFIED", async () => {
  const cases = [
    ["absent refs", (result) => delete result.reviewArtifactRefs],
    ["forged refs", (result) => (result.reviewArtifactRefs[0].path = "forged-review.json")],
    [
      "deleted record",
      async (result, harness) =>
        unlink(join(harness.reviewArtifactRoot, result.reviewArtifactRefs[1].path)),
    ],
    [
      "partial persistence failure",
      async (result, harness) =>
        unlink(join(harness.reviewArtifactRoot, result.reviewArtifactRefs[2].path)),
    ],
    [
      "wrong source identity",
      (result) => (result.reviewArtifactRefs[0].sourceArtifactId = "art-forged"),
    ],
    ["wrong schema", (result) => (result.reviewArtifactRefs[0].schema = "csm-review-receipt/1")],
    [
      "source digest mismatch",
      (result) => (result.reviewArtifactRefs[0].sourceDigest = digest("wrong-source")),
    ],
    [
      "file digest mismatch",
      (result) => (result.reviewArtifactRefs[0].digest = digest("wrong-file")),
    ],
  ];
  for (const [name, mutate] of cases) {
    const result = await runInvalidPersistedReview(mutate);
    assert.ok(["BLOCKED", "REQUIRES_REVIEW"].includes(result.outcome.status), name);
    assert.notEqual(result.outcome.status, "VERIFIED", name);
  }
});
