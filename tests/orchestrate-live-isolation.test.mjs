"use strict";

// T004: mode-aware effective-isolation gate + live provider/broker wiring.
//   (a) a verified-sandbox node routes through the live runtime and fails closed
//       with a typed `isolation-unavailable` code when it cannot be satisfied;
//   (b) an unknown effective isolation is refused;
//   (c) the trusted-in-process route is still admitted (no regression), and the
//       csm-autoresearch generated/trusted-local modes report effective trust.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import {
  createInProcessExecutorAdapter,
  createLiveVerifiedSandboxRuntime,
} from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createExecutorDescriptors } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import {
  isolationGate,
  isolationRouting,
  TRUSTED_IN_PROCESS,
  VERIFIED_SANDBOX,
} from "../csm-orchestrate/lib/skill-executor-preflight.mjs";
import {
  autoresearchEffectiveIsolation,
  createCsmAutoresearchAdapter,
} from "../csm-orchestrate/lib/csm-autoresearch-adapter.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";

const NOW = () => new Date("2026-09-13T00:00:00Z");
const PARENT_RUN = "run-live-parent";

const validReceipt = (context, status = "completed") => {
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: `receipt-${context.runId.slice(4)}-${context.attempt}`,
    runId: context.runId,
    owner: context.owner,
    attempt: context.attempt,
    status,
  };
  return { ...body, digest: digest(body) };
};

const completedHandler =
  () =>
  async ({ context: childContext }) => ({
    status: "completed",
    effects: ["read-only"],
    receipt: validReceipt(childContext),
    evidence: [],
    artifacts: [],
    output: { ok: true },
  });

function durableStore() {
  const attempts = new Map();
  return {
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
    async saveCursor() {},
    async loadCursor() {
      return null;
    },
  };
}

function requestFor(skill, runId) {
  return {
    schema: "csm-orchestrate-invocation/2",
    invocationId: `invocation-${runId}`,
    parentRunId: PARENT_RUN,
    childRunId: runId,
    phaseId: "phase-live",
    edgeId: "edge-live",
    skill,
    skillDigest: digest("a"),
    inputArtifactRefs: [],
    upstreamArtifactRefs: [],
    acceptanceSignalIds: ["sig-live"],
    outputArtifactRefs: [],
    permissions: ["read"],
    approval: {
      schema: "csm-orchestrate-approval/2",
      approvalId: `approval-${runId}`,
      binding: {
        parentRunId: PARENT_RUN,
        childRunId: runId,
        phaseId: "phase-live",
        edgeId: "edge-live",
      },
      scope: ["read"],
      approvedDigest: digest("a"),
      approvedAt: "2026-09-13T00:00:00Z",
      expiresAt: "2099-09-13T00:00:00Z",
      status: "approved",
    },
    timeoutMs: 30_000,
    cancellation: { requested: false },
    retry: { attempt: 1, idempotencyKey: `idem-${runId}` },
    status: "ready",
  };
}

const bindingFor = (skill, handler) => {
  const descriptor = createExecutorDescriptors().find((item) => item.skill === skill);
  assert.ok(descriptor, `missing executor descriptor for ${skill}`);
  return { ...descriptor, handler };
};

const adapterFor = async ({ skill, report, sandboxRuntime = null, egressEmitter = null }) => {
  const binding = bindingFor(skill, completedHandler());
  const registry = await createSkillExecutorRegistry({ descriptors: [binding] });
  return {
    binding,
    adapter: createInProcessExecutorAdapter({
      registry,
      bindings: { [skill]: binding },
      capabilities: [{ skill, digest: digest("a"), execution: { isolation: TRUSTED_IN_PROCESS } }],
      cursorStore: durableStore(),
      isolationReporters: { [skill]: () => report },
      sandboxRuntime,
      egressEmitter,
    }),
  };
};

test("T004: the gate reports a typed isolation-unavailable refusal for an unsatisfied verified-sandbox", () => {
  const capability = {
    skill: "csm-scan",
    execution: { isolation: VERIFIED_SANDBOX, attestation: "required" },
  };
  const refused = isolationGate({
    adapter: {
      effectiveIsolation: () => ({
        isolation: TRUSTED_IN_PROCESS,
        required: VERIFIED_SANDBOX,
      }),
    },
    request: { skill: "csm-scan" },
    capability,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.failure.failure.code, "isolation-unavailable");

  // Adapter-reported effective isolation takes precedence over the static
  // declaration: the trusted route is admitted despite a verified-sandbox static
  // declaration.
  const admitted = isolationGate({
    adapter: {
      effectiveIsolation: () => ({
        isolation: TRUSTED_IN_PROCESS,
        required: TRUSTED_IN_PROCESS,
      }),
    },
    request: { skill: "csm-scan" },
    capability,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.source, "adapter");

  // Unknown effective isolation is refused (gate enabled by default).
  const unknown = isolationGate({
    adapter: { effectiveIsolation: () => ({ isolation: "unknown" }) },
    request: { skill: "csm-scan" },
    capability,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.failure.failure.code, "isolation-unavailable");

  // Routing: non-self-provided verified sandbox goes to the runtime; a
  // self-provided sandbox (csm-autoresearch generated) stays on the adapter.
  const route = isolationRouting({
    adapter: {
      effectiveIsolation: () => ({ isolation: VERIFIED_SANDBOX, selfProvided: false }),
    },
    request: { skill: "csm-scan" },
    capability,
    runtimeInvocable: true,
  });
  assert.equal(route.action, "sandbox");
  const noRuntime = isolationRouting({
    adapter: {
      effectiveIsolation: () => ({ isolation: VERIFIED_SANDBOX, selfProvided: false }),
    },
    request: { skill: "csm-scan" },
    capability,
    runtimeInvocable: false,
  });
  assert.equal(noRuntime.action, "blocked");
  assert.equal(noRuntime.failure.failure.code, "isolation-unavailable");
});

test("T004: verified-sandbox node routes through the runtime and emits correlated egress.decision", async () => {
  const transport = createMemoryTransport();
  const egressEmitter = createTelemetryEmitter({
    runId: PARENT_RUN,
    effectiveConfigDigest: digest({}),
    transport,
  });
  const calls = [];
  const sandboxRuntime = {
    async invoke(payload) {
      calls.push(payload);
      payload.emitEgress({
        decision: "allowed",
        targetHost: "example.com",
        reasonCode: "allowlist-match",
      });
      return { status: "completed", output: { sandbox: true } };
    },
  };
  const { adapter } = await adapterFor({
    skill: "csm-scan",
    report: {
      isolation: VERIFIED_SANDBOX,
      required: VERIFIED_SANDBOX,
      attestation: "required",
      selfProvided: false,
    },
    sandboxRuntime,
    egressEmitter,
  });

  const runId = "run-live-sandbox";
  const result = await adapter.invoke(requestFor("csm-scan", runId));
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(calls.length, 1, "the verified-sandbox runtime must be invoked");
  assert.equal(calls[0].request.childRunId, runId);

  const decision = transport.list().find((event) => event.eventType === "egress.decision");
  assert.ok(decision, "an egress.decision event must be emitted on the live path");
  assert.equal(decision.runId, PARENT_RUN);
  assert.equal(decision.childRunId, runId);
  assert.equal(decision.invocationId, `invocation-${runId}`);
  assert.equal(decision.payload.decision, "allowed");
  assert.equal(decision.payload.targetHost, "example.com");
});

test("T004: unsatisfiable verified-sandbox fails closed with a typed code", async () => {
  const { adapter } = await adapterFor({
    skill: "csm-scan",
    report: {
      isolation: VERIFIED_SANDBOX,
      required: VERIFIED_SANDBOX,
      attestation: "required",
      selfProvided: false,
    },
    sandboxRuntime: {
      async invoke() {
        throw new Error("docker unavailable");
      },
    },
  });
  const result = await adapter.invoke(requestFor("csm-scan", "run-live-unsat"));
  assert.equal(result.status, "blocked");
  assert.equal(result.failure.code, "isolation-unavailable");
  assert.match(result.failure.message, /docker unavailable/);
});

test("T004: unknown effective isolation is refused at the executor seam", async () => {
  const { adapter } = await adapterFor({
    skill: "csm-scan",
    report: { isolation: "unknown", reason: "missing mode" },
  });
  const result = await adapter.invoke(requestFor("csm-scan", "run-live-unknown"));
  assert.equal(result.status, "blocked");
  assert.equal(result.failure.code, "isolation-unavailable");
});

test("T004: trusted-in-process path is still admitted (no regression)", async () => {
  const { adapter } = await adapterFor({
    skill: "csm-scan",
    report: { isolation: TRUSTED_IN_PROCESS, required: TRUSTED_IN_PROCESS },
  });
  const runId = "run-live-trusted";
  const result = await adapter.invoke(requestFor("csm-scan", runId));
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.childReceipt.owner, "csm-scan");
  assert.equal(result.childReceipt.runId, runId);
  const report = await adapter.effectiveIsolation(requestFor("csm-scan", runId));
  assert.equal(report.isolation, TRUSTED_IN_PROCESS);
});

test("T004: csm-autoresearch reports mode-aware effective isolation", () => {
  assert.equal(autoresearchEffectiveIsolation("generated", {}).isolation, VERIFIED_SANDBOX);
  assert.equal(autoresearchEffectiveIsolation("generated", {}).selfProvided, true);
  assert.equal(autoresearchEffectiveIsolation("trusted-local", null).isolation, TRUSTED_IN_PROCESS);
  assert.equal(autoresearchEffectiveIsolation("registered", null).isolation, TRUSTED_IN_PROCESS);
  assert.equal(autoresearchEffectiveIsolation("nonsense", null).isolation, "unknown");

  const adapter = createCsmAutoresearchAdapter({
    providers: {
      registered: { mode: "registered", evaluate: async () => ({ status: "ok" }) },
      generated: { mode: "generated", sandboxAttestation: { status: "verified" } },
    },
  });
  assert.equal(
    adapter.effectiveIsolation({ input: { contract: { source: { mode: "generated" } } } })
      .isolation,
    VERIFIED_SANDBOX,
  );
  assert.equal(
    adapter.effectiveIsolation({ input: { contract: { source: { mode: "registered" } } } })
      .isolation,
    TRUSTED_IN_PROCESS,
  );
});

test("T004: live runtime starts/stops the real provider and forwards drop decisions", async () => {
  const calls = [];
  const provider = {
    async start(options) {
      calls.push(["start", options.name]);
      return { id: "cid-1", attestation: {}, egress: null };
    },
    async stop({ id }) {
      calls.push(["stop", id]);
    },
    async collectDrops({ id, broker }) {
      calls.push(["collectDrops", id]);
      broker.recordDrop({ targetHost: "203.0.113.7", targetPort: 443 });
      return { id, count: 1 };
    },
  };
  const runtime = createLiveVerifiedSandboxRuntime({
    provider,
    brokerFactory: async ({ emit }) => ({
      broker: {
        recordDrop: (drop) => emit({ decision: "dropped-unmediated", targetHost: drop.targetHost }),
      },
      listener: {},
    }),
  });
  const events = [];
  const result = await runtime.invoke({
    request: {
      parentRunId: PARENT_RUN,
      childRunId: "run-live-runtime",
      invocationId: "invocation-live-runtime",
      workerSource: "export {};",
      sandboxExecutor: async () => ({ status: "completed" }),
    },
    emitEgress: (event) => events.push(event),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(
    calls.map(([name]) => name),
    ["start", "collectDrops", "stop"],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, "dropped-unmediated");
  assert.equal(events[0].targetHost, "203.0.113.7");
  assert.equal(runtime.effectiveIsolation().isolation, VERIFIED_SANDBOX);
});

test("T004: executeNode routes a verified-sandbox node through the injected runtime", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-"));
  const runtimeCalls = [];
  const transport = createMemoryTransport();
  try {
    const skill = "csm-scan";
    const binding = bindingFor(skill, completedHandler());
    const executorRegistry = await createSkillExecutorRegistry({ descriptors: [binding] });
    const runId = "run-live-index";
    const telemetryEmitter = createTelemetryEmitter({
      runId,
      effectiveConfigDigest: digest({}),
      transport,
    });
    let adapterInvoked = false;
    const executorAdapter = {
      async effectiveIsolation() {
        return {
          isolation: VERIFIED_SANDBOX,
          required: VERIFIED_SANDBOX,
          attestation: "required",
          selfProvided: false,
        };
      },
      async invoke() {
        adapterInvoked = true;
        throw new Error("verified-sandbox node must not hit the in-process adapter");
      },
    };
    const verifiedSandboxRuntime = {
      async invoke({ request, emitEgress }) {
        runtimeCalls.push(request.childRunId);
        emitEgress({ decision: "allowed", targetHost: "example.com" });
        return { status: "completed", output: { sandbox: true } };
      },
    };
    const result = await orchestrate({
      approach: {
        schema: "csm-approach/1",
        schemaRevision: 1,
        status: "agreed",
        runId,
        ideaSlug: "live-isolation",
        signals: { capabilities: [skill], inputs: ["repository"] },
        phases: [
          {
            phaseId: "P1",
            title: "Work",
            goal: "run in a verified sandbox",
            deliverables: ["result"],
            scope: ["repository"],
            outOfScope: ["production"],
            constraints: [],
            acceptanceHints: ["done"],
            context: [],
            dependencies: [],
          },
        ],
      },
      runId,
      capabilities,
      signals: { capabilities: [skill] },
      approvals: createAutonomyPolicy(capabilities, { now: NOW }),
      now: NOW,
      cursorStore: durableStore(),
      schemaRegistry: registry,
      artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
      executorAdapter,
      executorRegistry,
      executorBindings: { [skill]: binding },
      telemetryEmitter,
      verifiedSandboxRuntime,
      maxAttempts: 1,
    });
    assert.equal(runtimeCalls.length, 1, "verified-sandbox node must route to the runtime");
    assert.equal(adapterInvoked, false);
    const decisions = transport.list().filter((event) => event.eventType === "egress.decision");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].payload.targetHost, "example.com");
    assert.equal(decisions[0].runId, runId);
    assert.ok(result.receipt, "an authoritative receipt must still be produced");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
