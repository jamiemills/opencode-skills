import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
  createModelExecutor,
  executeSkill,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";

const context = { runId: "run-handler-test", owner: "csm-scan", attempt: 1 };
const body = {
  schema: "csm-orchestrate-child-receipt/1",
  receiptId: "receipt-handler-test-1",
  runId: context.runId,
  owner: context.owner,
  attempt: context.attempt,
  status: "completed",
};
const validReceipt = { ...body, digest: digest(body) };
const artifactBody = {
  artifactId: "artifact-handler-test",
  schema: "csm-test-artifact/1",
  runId: context.runId,
  owner: context.owner,
  bytes: 2,
  value: "ok",
};
const validArtifact = { ...artifactBody, digest: digest(artifactBody) };

function handler(result = {}) {
  return async () => ({
    status: "completed",
    effects: ["read-only"],
    receipt: validReceipt,
    evidence: [],
    artifacts: [validArtifact],
    output: { ok: true },
    ...result,
  });
}

const descriptor = { effects: ["read-only"], declaredArtifacts: [validArtifact.artifactId] };

test("normalizes a valid child result and enforces handler selection", async () => {
  const result = await executeSkill(
    "csm-scan",
    { context },
    { handlers: new Map([["csm-scan", handler()]]), descriptor },
  );
  assert.equal(result.schema, "csm-orchestrate-child-result/1");
  assert.equal(result.context.runId, context.runId);
  assert.equal(result.artifacts[0].digest, validArtifact.digest);
  const handlers = createExecutorHandlers();
  assert.equal(
    (
      await executeSkill(
        "csm-build",
        { context: { ...context, owner: "csm-build" }, input: {} },
        { handlers },
      )
    ).status,
    "blocked",
  );
});

test("rejects malformed output, wrong identity, and undeclared artifacts", async () => {
  assert.equal(
    (
      await executeSkill(
        "csm-scan",
        { context },
        { handlers: new Map([["csm-scan", handler({ receipt: null })]]), descriptor },
      )
    ).status,
    "failed",
  );
  const wrong = { ...validReceipt, runId: "run-other" };
  assert.equal(
    (
      await executeSkill(
        "csm-scan",
        { context },
        { handlers: new Map([["csm-scan", handler({ receipt: wrong })]]), descriptor },
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await executeSkill(
        "csm-scan",
        { context },
        {
          handlers: new Map([
            [
              "csm-scan",
              handler({ artifacts: [{ ...validArtifact, artifactId: "artifact-other" }] }),
            ],
          ]),
          descriptor,
        },
      )
    ).status,
    "failed",
  );
});

test("rejects oversized output and undeclared effects", async () => {
  await assert.equal(
    (
      await executeSkill(
        "csm-scan",
        { context },
        {
          handlers: new Map([["csm-scan", handler({ output: "x".repeat(100) })]]),
          descriptor: { ...descriptor, maxOutputBytes: 64 },
        },
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await executeSkill(
        "csm-scan",
        { context },
        { handlers: new Map([["csm-scan", handler({ effects: ["subprocess:git"] })]]), descriptor },
      )
    ).status,
    "failed",
  );
});

test("reports cancellation and has no OpenCode invocation path", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await executeSkill(
    "csm-scan",
    { context, signal: controller.signal },
    { handlers: new Map([["csm-scan", handler()]]) },
  );
  assert.equal(result.status, "cancelled");
  assert.equal(createModelExecutor(), null);
  const handlers = createExecutorHandlers({
    modelExecutor: createModelExecutor({ execute: async () => ({}) }),
  });
  assert.equal(typeof handlers.get("csm-plan"), "function");
  assert.doesNotMatch(JSON.stringify(createExecutorDescriptors()), /opencode/i);
});

test("built-in direct routes use canonical capability permissions and effects", async () => {
  const descriptors = createExecutorDescriptors();
  const registry = await createSkillExecutorRegistry({ descriptors });
  assert.equal(registry.size, 3);
  assert.deepEqual(registry.resolveExact(descriptors[0]).permissions, ["read", "execute"]);
  assert.deepEqual(registry.resolveExact(descriptors[1]).effects, ["read-only"]);
});

test("blocked handlers cannot smuggle identity-bearing results through normalization", async () => {
  const result = await executeSkill(
    "csm-scan",
    { context },
    {
      handlers: new Map([
        [
          "csm-scan",
          async () => ({
            status: "blocked",
            effects: [],
            artifacts: [],
            evidence: [{ runId: "run-forged", owner: "csm-scan" }],
            failure: { class: "policy", code: "blocked" },
          }),
        ],
      ]),
      descriptor,
    },
  );
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.evidence, []);
});

test("built-in direct handlers execute synthetic DDD, scan, and upload inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-executor-handler-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "synthetic" }));
    await writeFile(join(root, "index.js"), "export const value = 1;\n");
    const handlers = createExecutorHandlers();
    for (const [skill, input] of [
      ["csm-ddd", { root }],
      ["csm-scan", { repos: [root] }],
    ]) {
      const result = await executeSkill(
        skill,
        { input, context: { runId: `run-${skill.slice(4)}-synthetic`, owner: skill, attempt: 1 } },
        {
          handlers,
          descriptor: {
            effects:
              skill === "csm-ddd"
                ? ["read-only", "subprocess:git", "filesystem:read"]
                : ["read-only", "subprocess:rg", "subprocess:git", "filesystem:read"],
          },
        },
      );
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.equal(result.schema, "csm-orchestrate-child-result/1");
      assert.equal(result.context.owner, skill);
      assert.ok(result.artifacts.length > 0);
    }
    const file = Buffer.from("publication\n");
    const fileDigest = `sha256:${createHash("sha256").update(file).digest("hex")}`;
    await writeFile(join(root, "publication.txt"), file);
    const publication = {
      schema: "csm-upload-publication/1",
      artifactId: "art-publication-synthetic",
      runId: "run-upload-source",
      owner: "csm-upload",
      sourceRunId: "run-browse-source",
      destination: { github: "nobody", pagesRepo: "demo", path: "synthetic" },
      inputs: [
        {
          evidenceId: "evidence-publication",
          path: "publication.txt",
          digest: fileDigest,
          bytes: file.byteLength,
          contentType: "text/plain",
        },
      ],
      confirmation: { required: true, confirmed: true, confirmedAt: "2026-08-30T00:00:00Z" },
      snapshot: { maxFiles: 1, maxBytes: 1024 },
      binaryAcknowledgment: { required: false, acknowledged: false },
      status: "draft",
      deployment: { status: "not-started" },
      cleanup: { status: "not-needed", path: null },
    };
    publication.descriptorDigest = digest(publication);
    const result = await executeSkill(
      "csm-upload",
      {
        input: {
          descriptor: publication,
          root,
          destination: publication.destination,
          confirm: true,
        },
        context: { runId: "run-upload-synthetic", owner: "csm-upload", attempt: 1 },
      },
      { handlers, trustedBindings: { destination: publication.destination, executor: {} } },
    );
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.artifacts[0].schema, "csm-upload-publication/1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("in-process adapter uses durable invocation semantics without a host or CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-executor-adapter-"));
  try {
    const descriptors = createExecutorDescriptors();
    let handlerCalls = 0;
    const binding = {
      ...descriptors.find((item) => item.skill === "csm-scan"),
      handler: async ({ context: childContext }) => {
        handlerCalls += 1;
        const receiptBody = {
          schema: "csm-orchestrate-child-receipt/1",
          receiptId: `receipt-${childContext.runId.slice(4)}-${childContext.attempt}`,
          runId: childContext.runId,
          owner: childContext.owner,
          attempt: childContext.attempt,
          status: "completed",
        };
        return {
          status: "completed",
          effects: ["read-only"],
          receipt: { ...receiptBody, digest: digest(receiptBody) },
          evidence: [],
          artifacts: [],
          output: { inProcess: true },
        };
      },
    };
    const registry = await createSkillExecutorRegistry({ descriptors: [binding] });
    const attempts = new Map();
    const durable = {
      async recordIdempotency() {},
      async consumeApproval() {},
      async loadChildAttemptByKey(key) {
        return [...attempts.values()].find((item) => item.logicalKey === key) ?? null;
      },
      async beginChildAttempt(record) {
        const existing = await this.loadChildAttemptByKey(record.logicalKey);
        if (existing) return existing;
        const saved = { ...record, state: "dispatched", response: null };
        attempts.set(record.attemptId, saved);
        return saved;
      },
      async saveChildAttemptResult(attemptId, response, state = "terminal") {
        const record = attempts.get(attemptId);
        record.response = structuredClone(response);
        record.state = state;
        return record;
      },
    };
    const request = {
      schema: "csm-orchestrate-invocation/2",
      invocationId: "invocation-adapter-synthetic",
      parentRunId: "run-adapter-parent",
      childRunId: "run-adapter-synthetic",
      phaseId: "phase-adapter",
      edgeId: "edge-adapter",
      skill: "csm-scan",
      skillDigest: digest("a"),
      inputArtifactRefs: [],
      upstreamArtifactRefs: [],
      acceptanceSignalIds: ["sig-adapter"],
      outputArtifactRefs: [],
      permissions: ["read"],
      approval: {
        schema: "csm-orchestrate-approval/2",
        approvalId: "approval-adapter",
        binding: {
          parentRunId: "run-adapter-parent",
          childRunId: "run-adapter-synthetic",
          phaseId: "phase-adapter",
          edgeId: "edge-adapter",
        },
        scope: ["read"],
        approvedDigest: digest("a"),
        approvedAt: "2026-08-30T00:00:00Z",
        expiresAt: "2099-08-30T00:00:00Z",
        status: "approved",
      },
      timeoutMs: 30_000,
      cancellation: { requested: false },
      retry: { attempt: 1, idempotencyKey: "adapter-idempotency" },
      status: "ready",
    };
    let inputCalls = 0;
    const adapter = createInProcessExecutorAdapter({
      registry,
      bindings: { "csm-scan": binding },
      capabilities: [{ skill: "csm-scan", digest: digest("a") }],
      cursorStore: durable,
      inputForRequest: async () => {
        inputCalls += 1;
        return { repos: [root] };
      },
    });
    assert.equal(adapter.invokeSiblingSkill, undefined);
    const result = await adapter.invoke(request);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.childReceipt.runId, request.childRunId);
    assert.equal(result.childReceipt.owner, request.skill);
    assert.equal(attempts.size, 1);
    assert.equal(attempts.values().next().value.state, "terminal");
    const replay = await createInProcessExecutorAdapter({
      registry,
      bindings: { "csm-scan": binding },
      capabilities: [{ skill: "csm-scan", digest: digest("a") }],
      cursorStore: durable,
      inputForRequest: async () => {
        inputCalls += 1;
        return { repos: [root] };
      },
    }).invoke(request);
    assert.deepEqual(replay, result);
    assert.equal(handlerCalls, 1);
    assert.equal(inputCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
