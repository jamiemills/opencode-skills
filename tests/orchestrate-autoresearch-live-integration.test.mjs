import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createCsmAutoresearchAdapter } from "../csm-orchestrate/lib/csm-autoresearch-adapter.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import {
  createDockerGeneratedProvider,
  createDockerSandboxProvider,
} from "../csm-autoresearch/lib/providers/docker.mjs";
import { hash as generatedHash } from "../csm-autoresearch/lib/providers/generated.mjs";
import { sharedRunId } from "../csm-autoresearch/lib/artifacts/index.mjs";
import { hash } from "../csm-autoresearch/lib/ledger/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const limits = { timeoutMs: 1000, maxOutputBytes: 4096, maxWorkspaceBytes: 1024 * 1024 };
const runId = "run-live-docker-composed";
const forgedNativeRunId = "native-live-docker-composed";
const evaluatorHash = hash("csm-autoresearch-docker-evaluator/1");
const environmentHash = hash("node-22-docker-environment/1");
const source = "export default (value) => ({ score: Number(value) + 1 });";

const approach = {
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "docker-composed",
  phases: [
    {
      phaseId: "P1",
      title: "Evaluate synthetic candidate",
      goal: "run one autoresearch evaluator in an attested Docker sandbox",
      deliverables: ["verified generated report"],
      scope: ["synthetic candidate"],
      outOfScope: ["production data", "promotion"],
      constraints: ["network disabled", "credentials absent"],
      acceptanceHints: ["Docker attestation verified", "cleanup verified"],
      context: [],
      dependencies: [],
    },
  ],
};

function contract(nativeRunId, boundSharedRunId) {
  return {
    format: "csm-autoresearch-contract/1",
    runId: nativeRunId,
    ...(boundSharedRunId === undefined ? {} : { sharedRunId: boundSharedRunId }),
    source: {
      mode: "generated",
      id: "synthetic-docker-candidate",
      sourceHash: generatedHash(source),
    },
    metric: { name: "score", unit: "points", direction: "maximize", aggregation: "max" },
    mutation: { mode: "diff", allowedPaths: ["synthetic-candidate.mjs"], maxChangedBytes: 1000 },
    budget: { maxTrials: 1, maxProposals: 1, timeoutMs: limits.timeoutMs },
    policy: {
      format: "csm-autoresearch-policy/1",
      mode: "target",
      target: { operator: ">=", value: 5 },
      hardGates: [{ id: "valid", kind: "valid" }],
      population: { enabled: false, activateAfterStagnantTrials: 1, maxArchive: 1 },
      execution: {
        network: "disabled",
        credentials: "none",
        evaluatorAssets: "isolated",
        isolation: "verified-sandbox",
        limits,
      },
    },
  };
}

function childArtifactResolver(root, schemaRegistry) {
  return {
    async resolve(path, expected = {}) {
      const absolute = path.startsWith("/") ? path : join(root, path);
      const bytes = await readFile(absolute);
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const manifestPath = path.endsWith("-manifest.json")
        ? absolute
        : absolute.replace(/-(?:ledger|report)\.(?:jsonl|json)$/, "-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath));
      const registered = manifest.artifactDescriptors.find(
        (item) => item.artifact.artifactId === expected.expectedArtifactId,
      );
      const descriptor = registered ?? {
        schema: "csm-artifact/1",
        artifact: {
          artifactId: expected.expectedArtifactId,
          kind: "autoresearch-manifest",
          owner: expected.expectedOwner,
          runId: sharedRunId(manifest.nativeRunId),
          digest: actual,
          createdAt: "2026-08-31T00:00:00.000Z",
          revision: 1,
        },
        contentType: "application/json",
        location: "manifest.json",
        lifecycleStatus: "completed",
      };
      const schemaMatch = descriptor.schema.match(/^(.*)\/(\d+)$/);
      schemaRegistry.resolve(schemaMatch[1], Number(schemaMatch[2]));
      return {
        status: "resolved",
        path,
        owner: descriptor.artifact.owner,
        fileDigest: actual,
        value: descriptor,
      };
    },
  };
}

test("csm-orchestrate composes the Docker generated provider and proves cleanup", async () => {
  const provider = createDockerGeneratedProvider({ limits });
  if (provider.sandboxProvider !== "docker" || provider.sandboxVerified !== true)
    assert.fail(
      `Docker host attestation unavailable: ${provider.sandbox?.unavailable ?? "unverified"}`,
    );

  const artifactRoot = await mkdtemp(join(tmpdir(), "orchestrate-docker-live-"));
  const sandbox = createDockerSandboxProvider({ limits });
  const store = createSqliteStore({ mode: "memory", now: () => "2026-08-31T00:00:00.000Z" });
  const capabilities = await loadCapabilities();
  const schemaRegistry = await loadSchemaRegistry();
  const autoresearch = createCsmAutoresearchAdapter({ providers: { generated: provider } });
  const handlers = createExecutorHandlers({ csmAutoresearchAdapter: autoresearch });
  const descriptor = createExecutorDescriptors({
    handlers,
    csmAutoresearchAdapter: autoresearch,
  }).find((item) => item.skill === "csm-autoresearch");
  const registry = await createSkillExecutorRegistry({ descriptors: [descriptor] });
  const bindings = { "csm-autoresearch": descriptor };
  const requests = [];
  const childResponses = [];
  const productionResolver = createArtifactResolver({ root: artifactRoot, schemaRegistry });
  const inProcess = createInProcessExecutorAdapter({
    registry,
    bindings,
    capabilities,
    cursorStore: store,
    inputForRequest: async (request) => {
      return {
        contract: contract(request.childRunId, request.childRunId),
        artifactRoot,
        evaluatorHash,
        environmentHash,
        baseline: {
          id: "synthetic-baseline",
          parentId: null,
          sourceHash: generatedHash(source),
          patchHash: hash("synthetic-baseline-patch"),
        },
        candidates: [
          {
            id: "synthetic-candidate",
            parentId: "synthetic-baseline",
            sourceHash: generatedHash(source),
            patchHash: hash("synthetic-patch-v1"),
          },
        ],
        evaluatorInput: { source, value: 4 },
      };
    },
    artifactResolver: childArtifactResolver(artifactRoot, schemaRegistry),
    schemaRegistry,
  });
  const executorAdapter = {
    async invoke(request, options) {
      requests.push(request);
      const response = await inProcess.invoke(request, options);
      childResponses.push(response);
      return response;
    },
  };

  const independentReview = createIndependentFinalReviewExecutor({
    reviewerId: "csm-review-independent",
    executorId: "csm-orchestrate-final-review",
    producerExecutorId: "csm-autoresearch",
    artifactRoot,
    reviewer: async ({ requirements, evidence, phaseResults }) => ({
      status: "ACCEPTED",
      requirementCoverage: requirements.map((requirement) => ({
        requirementId: requirement.requirementId,
        evidenceRefs: evidence
          .filter((item) => item.requirementIds?.includes(requirement.requirementId))
          .map((item) => item.evidenceId),
      })),
      evidenceEntailment: "supported",
      technical: phaseResults.flatMap((item) => item.gate?.technical ?? []),
      functional: phaseResults.flatMap((item) => item.gate?.functional ?? []),
      findings: [],
    }),
  });
  try {
    const sandboxResult = await sandbox.execute({
      source,
      input: 4,
      limits,
      policy: provider.policy,
    });
    assert.equal(sandboxResult.status, "ok", JSON.stringify(sandboxResult));
    assert.equal(sandboxResult.metrics.score, 5);
    assert.equal(sandboxResult.attestation.status, "verified");
    assert.equal(sandboxResult.cleanup.status, "verified");
    assert.equal(sandboxResult.cleanup.containerAbsent, true);
    assert.equal(sandboxResult.cleanup.descendantsAbsent, true);
    assert.equal(sandboxResult.cleanup.workspaceRemoved, true);

    const result = await orchestrate({
      approach,
      runId,
      capabilities,
      signals: { capabilities: ["csm-autoresearch"], inputs: ["run contract"] },
      executorRegistry: registry,
      executorBindings: bindings,
      executorAdapter,
      cursorStore: store,
      approvals: async ({ phase, node, childRunId }) => ({
        schema: "csm-orchestrate-approval/1",
        approvalId: `approval-${childRunId}`,
        binding: {
          parentRunId: runId,
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
      artifactResolver: productionResolver,
      childArtifactResolver: childArtifactResolver(artifactRoot, schemaRegistry),
      finalReviewExecutor: independentReview,
      producerExecutorId: "csm-autoresearch",
      reviewArtifactRoot: artifactRoot,
    });

    assert.equal(requests.length, 1);
    assert.equal(childResponses.length, 1);
    assert.equal(childResponses[0].status, "completed", JSON.stringify(childResponses[0]));
    assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
    assert.equal(result.outcome.accepted, true);
    assert.equal(
      requests[0].childRunId,
      `run-${runId}-phase-docker-composed-p1-csm-autoresearch-0`,
    );
    assert.equal(result.receipt.outcome.status, "VERIFIED");
    assert.equal(provider.sandboxAttestation.status, "verified");
    assert.match(provider.sandboxAttestation.imageDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(provider.sandboxAttestation.network, "disabled");
    assert.deepEqual(provider.sandboxAttestation.mounts, []);
    assert.equal(provider.sandboxAttestation.controls.cleanupVerification, true);

    const reviewChildRunId = result.receipt.extensions.finalReview?.provenance?.reviewerChildRunId;
    assert.match(reviewChildRunId, /^run-/);
    for (const ref of result.reviewArtifactRefs ?? result.receipt.extensions.reviewArtifactRefs) {
      await readFile(join(artifactRoot, ref.path));
      const resolved = await productionResolver.resolve(ref.path, {
        expectedFileDigest: ref.digest,
        expectedOwner: ref.sourceOwner,
        expectedSourceDigest: ref.sourceDigest,
        expectedSourceRunId: ref.sourceRunId,
        expectedSourceArtifactId: ref.sourceArtifactId,
      });
      assert.equal(resolved.status, "resolved", JSON.stringify(resolved));
      assert.equal(resolved.fileDigest, ref.digest);
      assert.equal(resolved.owner, ref.sourceOwner);
    }
    const receipt = JSON.parse(
      await readFile(join(artifactRoot, `review-receipt-${reviewChildRunId}.json`), "utf8"),
    );
    assert.match(receipt.receiptDigest, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("Docker composition remains fail-closed when the host cannot attest through the adapter", async () => {
  const unavailable = createDockerGeneratedProvider({ docker: "csm-no-such-docker" });
  assert.equal(unavailable.sandboxVerified, false);
  assert.equal(unavailable.sandboxAttestation, null);

  for (const provider of [
    unavailable,
    { ...unavailable, sandboxAttestation: { status: "verified", provider: "docker" } },
  ]) {
    const adapter = createCsmAutoresearchAdapter({ providers: { generated: provider } });
    await assert.rejects(
      adapter.execute({
        context: { runId: sharedRunId(forgedNativeRunId), owner: "csm-autoresearch", attempt: 1 },
        input: { contract: contract(forgedNativeRunId) },
      }),
      /host-attested/,
    );
  }
});

test("Docker adapter rejects missing and mismatched explicit shared run bindings", async () => {
  const provider = createDockerGeneratedProvider({ docker: "csm-no-such-docker" });
  const adapter = createCsmAutoresearchAdapter({ providers: { generated: provider } });
  const native = "native-live-docker-binding";
  const context = { runId: "run-live-docker-binding", owner: "csm-autoresearch", attempt: 1 };

  await assert.rejects(
    adapter.execute({ context, input: { contract: contract(native) } }),
    /native and shared run IDs are not bound/,
  );
  await assert.rejects(
    adapter.execute({
      context,
      input: { contract: contract(native, "run-live-docker-other") },
    }),
    /native and shared run IDs are not bound/,
  );
});
