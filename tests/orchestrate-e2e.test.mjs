import assert from "node:assert/strict";
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
      async resolve(path) {
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

const options = async (host, extra = {}) => ({
  approach: approach(),
  runId,
  host,
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
  finalReview: async ({ phaseResults, evidence }) => ({
    schema: "csm-orchestrate-adversarial-review/1",
    reviewId: "review-e2e-final",
    runId,
    status: "ACCEPTED",
    independent: true,
    requirementCoverage: phaseResults.flatMap(({ phase }) =>
      phase.requirementIds.map((requirementId) => ({
        requirementId,
        evidenceRefs: evidence
          .filter(
            (item) => item.requirementIds?.includes(requirementId) && item.status === "current",
          )
          .map((item) => item.evidenceId),
      })),
    ),
    evidenceEntailment: "supported",
    technical: [{ status: "pass" }],
    functional: [{ status: "pass" }],
    findings: [],
  }),
  ...extra,
});

test("one-shot asks produce a verified final receipt", async () => {
  const result = await orchestrate(await options(fixture()));
  assert.equal(result.finalReview?.status, "ACCEPTED", JSON.stringify(result));
  assert.equal(result.outcome.status, "VERIFIED");
  assert.equal(result.outcome.accepted, true);
});

test("normal completion without an independent final review requires review", async () => {
  const result = await orchestrate(await options(fixture(), { finalReview: undefined }));
  assert.equal(result.outcome.status, "REQUIRES_REVIEW");
  assert.equal(result.outcome.accepted, false);
  assert.equal(result.reason, "independent-final-review-required");
});

test("conditional routing invokes only the declared route", async () => {
  const host = fixture();
  await orchestrate(await options(host));
  assert.equal(host.calls, 1);
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
  assert.equal(result.outcome.status, "VERIFIED");
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
