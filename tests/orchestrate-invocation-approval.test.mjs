import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostInvocationAdapter,
  validateHandoffRef,
} from "../csm-orchestrate/lib/invocation.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const capabilities = { skills: [{ skill: "csm-build", digest }] };
const adapterOptions = (host) => ({ host, capabilities });
const base = (overrides = {}) => ({
  schema: "csm-orchestrate-invocation/1",
  invocationId: "invocation-test",
  parentRunId: "run-parent-20260827",
  childRunId: "run-child-20260827",
  phaseId: "phase-test",
  edgeId: "edge-test",
  skill: "csm-build",
  skillDigest: digest,
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  permissions: ["read"],
  approval: {
    schema: "csm-orchestrate-approval/1",
    approvalId: "approval-test",
    binding: {
      parentRunId: "run-parent-20260827",
      childRunId: "run-child-20260827",
      phaseId: "phase-test",
      edgeId: "edge-test",
    },
    scope: ["read"],
    approvedDigest: digest,
    approvedAt: "2026-08-27T00:00:00Z",
    expiresAt: "2099-08-28T00:00:00Z",
    status: "approved",
  },
  timeoutMs: 100,
  cancellation: { requested: false },
  retry: { attempt: 0, idempotencyKey: "invoke-test" },
  status: "ready",
  ...overrides,
});

test("missing approval and changed digest fail closed before host access", async () => {
  let calls = 0;
  const adapter = createHostInvocationAdapter({
    ...adapterOptions({
      invokeSiblingSkill: async () => {
        calls += 1;
      },
    }),
    now: () => new Date("2026-08-27T12:00:00Z"),
  });
  assert.equal(
    (await adapter.invoke(base({ approval: undefined }))).failure.code,
    "missing-approval",
  );
  assert.equal(
    (await adapter.invoke(base({ skillDigest: `sha256:${"b".repeat(64)}` }))).failure.code,
    "skill-digest-mismatch",
  );
  assert.equal(calls, 0);
});

test("strict executor mode requires all executable digests and a recomputed request digest", async () => {
  const adapter = createHostInvocationAdapter({
    capabilities,
    requireExecutableIdentity: true,
    host: { invokeSiblingSkill: async () => ({ status: "completed" }) },
  });
  const result = await adapter.invoke(base());
  assert.equal(result.failure.code, "invalid-invocation");
  assert.match(result.failure.message, /contractDigest/);
});

test("requested skill and digest must be in the canonical manifest", async () => {
  const adapter = createHostInvocationAdapter({
    ...adapterOptions({
      invokeSiblingSkill: async () => {
        throw new Error("must not dispatch");
      },
    }),
  });
  assert.equal(
    (await adapter.invoke(base({ skill: "csm-orchestrate" }))).failure.code,
    "unauthorized-skill",
  );
  assert.equal(
    (await adapter.invoke(base({ skillDigest: `sha256:${"b".repeat(64)}` }))).failure.code,
    "skill-digest-mismatch",
  );
});

test("expired approval and unavailable host produce explicit policy and transport failures", async () => {
  const expired = base({ approval: { ...base().approval, expiresAt: "2026-08-27T11:00:00Z" } });
  const adapter = createHostInvocationAdapter({
    ...adapterOptions(undefined),
    now: () => new Date("2026-08-27T12:00:00Z"),
  });
  assert.deepEqual((await adapter.invoke(expired)).failure, {
    class: "policy",
    code: "approval-expired",
    message: "approval has expired",
  });
  assert.deepEqual((await adapter.invoke(base())).failure, {
    class: "transport",
    code: "unavailable-host",
    message: "host invocation API is unavailable",
  });
});

test("duplicate terminal invocation is rejected deterministically", async () => {
  const adapter = createHostInvocationAdapter({
    capabilities,
    host: { invokeSiblingSkill: async () => ({ status: "completed" }) },
  });
  assert.equal((await adapter.invoke(base())).status, "completed");
  assert.equal((await adapter.invoke(base())).failure.code, "duplicate-terminal-invocation");
});

test("undefined optional request fields are ignored by the material digest", async () => {
  const adapter = createHostInvocationAdapter({
    capabilities,
    host: { invokeSiblingSkill: async () => ({ status: "completed" }) },
  });
  const result = await adapter.invoke(
    base({ approval: undefined, input: { optional: undefined } }),
  );
  assert.equal(result.failure.code, "missing-approval");
});

test("child, evaluator, timeout, and incomplete failures remain distinct", async () => {
  const invoke = (result) =>
    createHostInvocationAdapter({
      capabilities,
      host: { invokeSiblingSkill: async () => result },
    }).invoke(base());
  assert.equal(
    (await invoke({ status: "failed", failure: { class: "child", code: "child-failed" } })).failure
      .class,
    "child",
  );
  assert.equal(
    (await invoke({ status: "failed", failure: { class: "evaluator", code: "bad-eval" } })).failure
      .class,
    "evaluator",
  );
  assert.equal(
    (await invoke({ status: "incomplete", failure: { code: "missing-evidence" } })).failure.class,
    "incomplete",
  );
  const timed = createHostInvocationAdapter({
    capabilities,
    host: { invokeSiblingSkill: async () => new Promise(() => {}) },
  }).invoke(base({ timeoutMs: 1 }));
  assert.equal((await timed).failure.class, "timeout");
});

test("unknown and rejected child statuses fail closed", async () => {
  let calls = 0;
  const adapter = createHostInvocationAdapter({
    capabilities,
    host: { invokeSiblingSkill: async () => ({ status: calls++ === 0 ? "ready" : "rejected" }) },
  });
  assert.equal(
    (
      await adapter.invoke(
        base({ status: "ready", retry: { attempt: 0, idempotencyKey: "unknown" } }),
      )
    ).failure.code,
    "invalid-child-result",
  );
  assert.equal(
    (
      await adapter.invoke(
        base({
          childRunId: "run-child-rejected",
          approval: {
            ...base().approval,
            approvalId: "approval-rejected",
            binding: { ...base().approval.binding, childRunId: "run-child-rejected" },
          },
          retry: { attempt: 0, idempotencyKey: "rejected" },
        }),
      )
    ).failure.code,
    "invalid-child-result",
  );
});

test("typed upstream handoffs reject incomplete and identity-mismatched refs before dispatch", async () => {
  const ref = {
    sourceOwner: "csm-build",
    sourceRunId: "run-upstream-20260827",
    sourceArtifactId: "artifact-plan",
    schema: "csm-plan/1",
    schemaRevision: 1,
    path: "plans/plan.json",
    resolution: "sha256:resolution",
    digest,
  };
  assert.equal(validateHandoffRef(ref, { owner: "csm-build", runId: ref.sourceRunId }), null);
  assert.equal(
    validateHandoffRef({ ...ref, sourceOwner: "csm-review" }, { owner: "csm-build" }),
    "handoff source owner mismatch",
  );
  assert.equal(
    validateHandoffRef({ ...ref, digest: `sha256:${"b".repeat(64)}` }, { digest }),
    "handoff digest mismatch",
  );
  let calls = 0;
  const adapter = createHostInvocationAdapter({
    ...adapterOptions({
      invokeSiblingSkill: async (_request) => {
        calls += 1;
        return { status: "completed" };
      },
    }),
  });
  const result = await adapter.invoke(
    base({ upstreamArtifactRefs: [{ ...ref, digest: "not-a-digest" }] }),
  );
  assert.equal(result.failure.code, "invalid-invocation");
  assert.equal(calls, 0);
});

test("review provenance cannot be forged through the host review boundary", async () => {
  const adapter = createHostInvocationAdapter({
    ...adapterOptions({
      invokeReview: async () => ({
        review: {
          runId: "run-parent-20260827",
          phaseId: "phase-test",
          status: "ACCEPTED",
          provenance: {
            mode: "host-backed",
            reviewer: "forged-reviewer",
            owner: "csm-review",
            reviewerChildRunId: "run-parent-20260827",
            receipt: { artifactId: "forged", runId: "run-parent-20260827", digest },
            artifact: { artifactId: "forged", runId: "run-parent-20260827", digest },
            approval: {
              approvalId: "approval-forged",
              edgeId: "edge-test",
              parentRunId: "run-parent-20260827",
              reviewerChildRunId: "run-parent-20260827",
              phaseId: "phase-test",
              approvedDigest: digest,
            },
          },
        },
      }),
    }),
  });
  const result = await adapter.invokeReview({
    parentRunId: "run-parent-20260827",
    phaseId: "phase-test",
    edgeId: "edge-test",
  });
  assert.equal(result.failure.code, "invalid-review-provenance");
});
