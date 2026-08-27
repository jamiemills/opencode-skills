import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import { loadCapabilities, SUPPORTED_SKILLS } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";

const runId = "run-e2e-orchestrate";
const approach = (goal = "build the change") => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "e2e",
  phases: [
    {
      phaseId: "P1",
      title: "Deliver",
      goal,
      deliverables: ["working result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass", "functional pass"],
      context: [],
      dependencies: [],
    },
  ],
});

function fixture({ outcome = {}, evidence = true } = {}) {
  let calls = 0;
  const artifacts = new Map();
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill(request) {
      calls += 1;
      const item = evidence
        ? {
            evidenceId: `ev-result-${calls}`,
            kind: "technical",
            status: "current",
            owner: request.skill,
            runId: request.childRunId,
            digest: `sha256:${"a".repeat(64)}`,
            requirementIds: ["req-e2e-p1", "req-remediation-p1"],
            acceptanceSignalId: request.acceptanceSignalIds?.[0],
            source: {
              path: `fixture-${calls}.json`,
              artifactId: `art-result-${calls}`,
              digest: `sha256:${"a".repeat(64)}`,
              schema: "csm-fixture/1",
              sourceRunId: request.childRunId,
            },
          }
        : null;
      if (item) artifacts.set(item.source.path, item);
      return {
        status: outcome.status ?? "completed",
        failure: outcome.failure,
        technical: outcome.technical ?? [
          { id: "technical", status: "pass", evidenceRefs: [`ev-result-${calls}`] },
        ],
        functional: outcome.functional ?? [
          { id: "functional", status: "pass", evidenceRefs: [`ev-result-${calls}`] },
        ],
        evidence: item ? [item] : [],
        childReceipt: {
          receiptId: `receipt-child-${calls}`,
          schema: "csm-fixture-receipt/1",
          runId: request.childRunId,
          digest: `sha256:${"b".repeat(64)}`,
          owner: request.skill,
          status: outcome.status === "failed" ? "failed" : "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        if (path.startsWith("review-"))
          return {
            status: "resolved",
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: {
              artifactId: expected.expectedArtifactId,
              sourceRunId: expected.expectedSourceRunId,
            },
          };
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: `missing artifact: ${path}` };
        return {
          status: "resolved",
          path,
          owner: item.owner,
          fileDigest: item.digest,
          value: {
            ...item,
            schema: item.source.schema,
            artifactId: item.source.artifactId,
            sourceRunId: item.source.sourceRunId,
          },
        };
      },
    },
  };
}

async function approvalFor({ phase, node, childRunId }) {
  return {
    schema: "csm-orchestrate-approval/1",
    approvalId: `approval-${childRunId}`,
    binding: {
      parentRunId: runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: `edge-${node.nodeId}`,
    },
    scope: node.approvalScope.length ? node.approvalScope : ["read"],
    approvedDigest: node.capabilityDigest,
    approvedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-27T00:00:00.000Z",
    status: "approved",
  };
}

const defaultReview = async ({ phaseResults, evidence }) => ({
  schema: "csm-orchestrate-adversarial-review/1",
  reviewId: "review-e2e-final",
  runId,
  status: "ACCEPTED",
  independent: true,
  provenance: {
    mode: "host-backed",
    reviewer: "csm-test-host",
    owner: "csm-test-host",
    reviewerChildRunId: "run-review-e2e",
    receipt: { digest: `sha256:${"c".repeat(64)}` },
    artifact: { digest: `sha256:${"d".repeat(64)}` },
    approval: {
      approvalId: "approval-review-e2e",
      edgeId: "edge-review-e2e",
      parentRunId: runId,
      reviewerChildRunId: "run-review-e2e",
    },
  },
  requirementCoverage: phaseResults.flatMap(({ phase }) =>
    phase.requirementIds.map((requirementId) => ({
      requirementId,
      evidenceRefs: evidence
        .filter((item) => item.requirementIds?.includes(requirementId) && item.status === "current")
        .map((item) => item.evidenceId),
    })),
  ),
  evidenceEntailment: "supported",
  technical: [{ status: "pass" }],
  functional: [{ status: "pass" }],
  findings: [],
});

const options = async (host, extra = {}) => {
  const reviewProvider = Object.hasOwn(extra, "finalReview") ? extra.finalReview : defaultReview;
  const reviewHost =
    reviewProvider && extra.hostReview !== false
      ? {
          ...host,
          async invokeReview(request) {
            const review = await reviewProvider(request);
            review.schema = "csm-orchestrate-adversarial-review/2";
            review.phaseId = request.phaseId;
            review.provenance = {
              ...review.provenance,
              receipt: {
                artifactId: "art-review-receipt",
                runId: review.provenance.reviewerChildRunId,
                digest: review.provenance.receipt?.digest ?? `sha256:${"c".repeat(64)}`,
                owner: review.provenance.owner,
                schema: "csm-review-receipt/1",
                path: "review-receipt.json",
                resolution: "fixture",
              },
              artifact: {
                artifactId: "art-review",
                runId: review.provenance.reviewerChildRunId,
                digest: review.provenance.artifact?.digest ?? `sha256:${"d".repeat(64)}`,
                owner: review.provenance.owner,
                schema: "csm-review/1",
                path: "review-artifact.json",
                resolution: "fixture",
              },
              approval: {
                ...review.provenance.approval,
                phaseId: request.phaseId,
                edgeId: request.edgeId,
                parentRunId: runId,
                reviewerChildRunId: review.provenance.reviewerChildRunId,
                approvedDigest: review.provenance.artifact?.digest ?? `sha256:${"d".repeat(64)}`,
              },
            };
            return {
              review,
              reviewReceipt: review.provenance.receipt,
              reviewArtifact: review.provenance.artifact,
            };
          },
        }
      : host;
  return {
    approach: approach(),
    runId,
    host: reviewHost,
    capabilities: await loadCapabilities(),
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    approvals: approvalFor,
    now: () => new Date("2026-08-27T12:00:00Z"),
    cursorStore: {
      cursors: new Map(),
      async saveCursor(cursor) {
        this.cursors.set(cursor.cursorId, cursor);
      },
      async loadCursor(cursorId) {
        return this.cursors.get(cursorId) ?? null;
      },
    },
    artifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
    ...extra,
    finalReview: extra.hostReview === false ? extra.finalReview : undefined,
  };
};

test("one-shot asks produce a verified final receipt", async () => {
  const result = await orchestrate(await options(fixture()));
  assert.equal(result.finalReview?.status, "ACCEPTED", JSON.stringify(result));
  assert.equal(result.outcome.status, "VERIFIED");
  assert.deepEqual(
    result.extensions.phaseSummaries.map((phase) => phase.phaseId),
    ["phase-e2e-p1"],
  );
  assert.equal(result.extensions.graphRevision, 1);
  assert.ok(result.extensions.reviewIds.includes("review-e2e-final"));
  assert.equal(result.outcome.accepted, true);
});

test("normal completion without an independent final review requires review", async () => {
  const result = await orchestrate(await options(fixture(), { finalReview: undefined }));
  assert.equal(result.outcome.status, "REQUIRES_REVIEW");
  assert.equal(result.outcome.accepted, false);
  assert.equal(result.reason, "independent-final-review-required");
});

test("caller-supplied host provenance cannot create VERIFIED without host invocation", async () => {
  const result = await orchestrate(
    await options(fixture(), {
      finalReview: async () => ({
        schema: "csm-orchestrate-adversarial-review/2",
        reviewId: "review-forged",
        runId,
        status: "ACCEPTED",
        independent: true,
        provenance: {
          mode: "host-backed",
          reviewer: "forged",
          owner: "csm-review",
          reviewerChildRunId: "run-review-forged",
          receipt: { artifactId: "forged", runId, digest: `sha256:${"a".repeat(64)}` },
          artifact: { artifactId: "forged", runId, digest: `sha256:${"a".repeat(64)}` },
          approval: {
            approvalId: "approval-forged",
            edgeId: "edge-final-review",
            parentRunId: runId,
            reviewerChildRunId: "run-review-forged",
            phaseId: "phase-e2e-p1",
            approvedDigest: `sha256:${"a".repeat(64)}`,
          },
        },
        requirementCoverage: [],
        evidenceEntailment: "supported",
        technical: [{ status: "pass" }],
        functional: [{ status: "pass" }],
        findings: [],
      }),
    }),
  );
  assert.notEqual(result.outcome.status, "VERIFIED");
});

test("conditional routing invokes only the declared route", async () => {
  const host = fixture();
  await orchestrate(await options(host));
  assert.equal(host.calls, 1);
});

test("unrelated external artifact refs are excluded from each node request", async () => {
  const base = fixture();
  const requests = [];
  const host = {
    async invokeSiblingSkill(request, context) {
      requests.push(request);
      return base.invokeSiblingSkill(request, context);
    },
  };
  const external = {
    name: "plan",
    kind: "artifact",
    artifactId: "artifact-plan",
    sourceOwner: "csm-plan",
    sourceRunId: "run-external-plan",
    sourceArtifactId: "artifact-plan",
    schema: "csm-plan/1",
    schemaRevision: 1,
    path: "external-plan.json",
    resolution: "fixture",
    digest: `sha256:${"e".repeat(64)}`,
  };
  const result = await orchestrate(
    await options(host, {
      inputArtifactRefs: [external, { ...external, name: "unrelated", sourceArtifactId: "other" }],
      artifactResolver: {
        async resolve(path, expected) {
          if (path !== external.path && !path.startsWith("review-"))
            return base.artifactResolver.resolve(path, expected);
          return {
            status: "resolved",
            owner: expected.expectedOwner,
            fileDigest: expected.expectedFileDigest,
            value: {
              artifactId: expected.expectedArtifactId,
              sourceRunId: expected.expectedSourceRunId,
            },
          };
        },
      },
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
  assert.deepEqual(requests[0].inputArtifactRefs, [external]);
});

test("conditional all-skill routing remains declared and ordered", async () => {
  const host = fixture();
  const result = await orchestrate(
    await options(host, {
      signals: {
        capabilities: [...SUPPORTED_SKILLS],
        inputs: [
          "plan",
          "run contract",
          "browser task",
          "research question",
          "idea",
          "configuration",
          "publication descriptor",
        ],
      },
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED");
  assert.equal(host.calls, SUPPORTED_SKILLS.length);
});

test("missing evidence is incomplete, not verified", async () => {
  const result = await orchestrate(await options(fixture({ evidence: false })));
  assert.equal(result.outcome.status, "INCOMPLETE");
});

test("host evidence without resolver is incomplete, not verified", async () => {
  const result = await orchestrate(await options(fixture(), { artifactResolver: undefined }));
  assert.equal(result.outcome.status, "INCOMPLETE");
});

test("final review can create a bounded remediation phase", async () => {
  const result = await orchestrate(
    await options(fixture(), {
      finalReview: async ({ phase, phaseResults, evidence }) =>
        phase.phaseId === "phase-remediation-e2e"
          ? {
              schema: "csm-orchestrate-adversarial-review/1",
              reviewId: "review-remediation-e2e",
              runId,
              status: "ACCEPTED",
              independent: true,
              provenance: {
                mode: "host-backed",
                reviewer: "csm-test-host",
                owner: "csm-test-host",
                reviewerChildRunId: "run-review-remediation",
                receipt: { digest: `sha256:${"c".repeat(64)}` },
                artifact: { digest: `sha256:${"d".repeat(64)}` },
                approval: {
                  approvalId: "approval-review-remediation",
                  edgeId: "edge-review-remediation",
                  parentRunId: runId,
                  reviewerChildRunId: "run-review-remediation",
                },
              },
              requirementCoverage: phaseResults.flatMap(({ phase: resultPhase }) =>
                resultPhase.requirementIds.map((requirementId) => ({
                  requirementId,
                  evidenceRefs: evidence
                    .filter((item) => item.requirementIds?.includes(requirementId))
                    .map((item) => item.evidenceId),
                })),
              ),
              evidenceEntailment: "supported",
              technical: [{ status: "pass" }],
              functional: [{ status: "pass" }],
              findings: [],
            }
          : {
              schema: "csm-orchestrate-adversarial-review/1",
              reviewId: "review-initial-e2e",
              runId,
              status: "REJECTED",
              independent: true,
              provenance: {
                mode: "host-backed",
                reviewer: "csm-test-host",
                owner: "csm-test-host",
                reviewerChildRunId: "run-review-initial",
                receipt: { digest: `sha256:${"c".repeat(64)}` },
                artifact: { digest: `sha256:${"d".repeat(64)}` },
                approval: {
                  approvalId: "approval-review-initial",
                  edgeId: "edge-review-initial",
                  parentRunId: runId,
                  reviewerChildRunId: "run-review-initial",
                },
              },
              findings: [{ code: "gap", severity: "high" }],
            },
      remediationFactory: async ({ graph }) => ({
        phaseId: "phase-remediation-e2e",
        parentPhaseId: graph.phases[0].phaseId,
        graphRevision: graph.graphRevision + 1,
        insertion: { insertedAfter: graph.phases[0].phaseId },
        route: "csm-ddd",
        requirementDelta: ["req-e2e"],
        requirementIds: ["req-e2e"],
        acceptanceSignals: ["reviewed"],
        approvalScope: ["read", "execute"],
        idempotency: { key: "remediation-e2e", mode: "natural" },
        sideEffects: ["read-only"],
        remediationBudget: 1,
      }),
    }),
  );
  assert.equal(result.outcome.status, "VERIFIED");
  assert.deepEqual(
    result.extensions.phaseSummaries.map((phase) => phase.phaseId),
    ["phase-e2e-p1", "phase-remediation-e2e"],
  );
  assert.equal(result.extensions.remediationLineage[0].sourceReviewId, "review-initial-e2e");
  assert.ok(result.extensions.reviewIds.includes("review-initial-e2e"));
  assert.ok(result.extensions.reviewIds.includes("review-remediation-e2e"));
  assert.ok(result.extensions.childReceipts.length >= 2);
});

test("transport interruption retries with a new child identity", async () => {
  let first = true;
  const base = fixture();
  const host = {
    async invokeSiblingSkill(request, context) {
      if (first) {
        first = false;
        return { status: "failed", failure: { class: "transport", code: "network" } };
      }
      return base.invokeSiblingSkill(request, context);
    },
  };
  const result = await orchestrate(
    await options(host, { artifactResolver: base.artifactResolver }),
  );
  assert.equal(result.outcome.status, "VERIFIED", JSON.stringify(result));
});

test("approval denial and host absence fail closed", async () => {
  const denied = await orchestrate(await options(fixture(), { approvals: {} }));
  assert.equal(denied.outcome.status, "BLOCKED");
  const unavailable = await orchestrate({ approach: approach(), runId });
  assert.equal(unavailable.outcome.status, "BLOCKED");
});

test("execution requires durable cursor persistence", async () => {
  const result = await orchestrate({
    ...(await options(fixture())),
    cursorStore: undefined,
  });
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "durable-cursor-required");
});

test("foreign child receipts are rejected instead of being re-correlated", async () => {
  const result = await orchestrate(
    await options({
      async invokeSiblingSkill(request) {
        return {
          status: "completed",
          technical: [{ status: "pass" }],
          functional: [{ status: "pass" }],
          evidence: [],
          childReceipt: {
            receiptId: "receipt-foreign",
            schema: "csm-fixture-receipt/1",
            runId: "run-foreign-child",
            digest: `sha256:${"b".repeat(64)}`,
            owner: request.skill,
            status: "completed",
          },
        };
      },
    }),
  );
  assert.equal(result.outcome.status, "BLOCKED");
});

test("foreign durable terminal records are blocked before reconciliation", async () => {
  const firstHost = fixture();
  const cursorStore = {
    cursors: new Map(),
    async saveCursor(cursor) {
      this.cursors.set(cursor.cursorId, cursor);
    },
    async loadCursor(cursorId) {
      return this.cursors.get(cursorId) ?? null;
    },
    async loadTerminalRecords() {
      return [
        {
          childRunId: "run-foreign-child",
          status: "completed",
          result: { status: "completed" },
        },
      ];
    },
  };
  await orchestrate(await options(firstHost, { cursorStore }));
  const result = await orchestrate(
    await options(
      {
        artifactResolver: firstHost.artifactResolver,
        async invokeSiblingSkill() {
          throw new Error("foreign terminal record must block before dispatch");
        },
      },
      { cursorStore },
    ),
  );
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "invalid-durable-terminal-child");
});

test("child failures map to FAILED while policy blocks remain BLOCKED", async () => {
  const failed = await orchestrate(
    await options(
      fixture({ outcome: { status: "failed", failure: { class: "child", code: "defect" } } }),
      { maxAttempts: 0 },
    ),
  );
  assert.equal(failed.outcome.status, "FAILED");
  const blocked = await orchestrate(
    await options(
      fixture({ outcome: { status: "blocked", failure: { class: "policy", code: "denied" } } }),
    ),
  );
  assert.equal(blocked.outcome.status, "BLOCKED");
});

test("receipt IDs remain deterministic for a fixed fixture", async () => {
  const first = await orchestrate(await options(fixture()));
  const second = await orchestrate(await options(fixture()));
  assert.equal(first.receiptId, second.receiptId);
  assert.equal(digest(first.outcome), digest(second.outcome));
});

test("dependency-ready read-only nodes overlap but never exceed four", async () => {
  const base = fixture();
  const selected = ["csm-ddd", "csm-deep-research", "csm-review", "csm-review-python", "csm-scan"];
  const directory = await mkdtemp(join(tmpdir(), "csm-orchestrate-cursors-"));
  const cursorStore = {
    async saveCursor(cursor) {
      await writeFile(join(directory, cursor.cursorId), JSON.stringify(cursor));
    },
    async loadCursor(cursorId) {
      try {
        return JSON.parse(await readFile(join(directory, cursorId), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
  };
  let active = 0;
  let maximum = 0;
  const started = [];
  const host = {
    artifactResolver: base.artifactResolver,
    async invokeSiblingSkill(request) {
      started.push(request.skill);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return base.invokeSiblingSkill(request);
    },
  };
  try {
    const result = await orchestrate(
      await options(host, {
        cursorStore,
        signals: { capabilities: selected, inputs: ["plan", "research question"] },
      }),
    );
    assert.equal(result.outcome.status, "VERIFIED");
    assert.ok(maximum > 1);
    assert.ok(maximum <= 4);
    assert.equal(started.length, selected.length);
    assert.deepEqual(
      result.childReceipts.map((receipt) => receipt.owner),
      selected,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a read-only failure stops later batches and retains running outcomes", async () => {
  const base = fixture();
  const selected = ["csm-ddd", "csm-deep-research", "csm-review", "csm-review-python", "csm-scan"];
  const calls = [];
  const host = {
    artifactResolver: base.artifactResolver,
    async invokeSiblingSkill(request) {
      calls.push(request.skill);
      if (request.skill === "csm-review")
        return {
          status: "failed",
          failure: { class: "child", code: "fixture-failure" },
          technical: [],
          functional: [],
          evidence: [],
          childReceipt: {
            receiptId: "receipt-child-failure",
            schema: "csm-fixture-receipt/1",
            runId: request.childRunId,
            digest: `sha256:${"b".repeat(64)}`,
            owner: request.skill,
            status: "failed",
          },
        };
      return base.invokeSiblingSkill(request);
    },
  };
  const result = await orchestrate(
    await options(host, {
      maxAttempts: 0,
      signals: { capabilities: selected, inputs: ["plan", "research question"] },
    }),
  );
  assert.equal(result.outcome.status, "FAILED");
  assert.equal(calls.length, 4);
  assert.ok(!calls.includes("csm-scan"));
  assert.deepEqual(
    result.childReceipts.map((receipt) => receipt.owner),
    selected.slice(0, 4).filter((skill) => skill !== "csm-review"),
  );
});
