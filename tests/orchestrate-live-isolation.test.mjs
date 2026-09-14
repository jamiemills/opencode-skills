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
  approvedHostIsolationOptOut,
  HOST_ISOLATION_OPT_OUT_SCOPE,
  isolationGate,
  isolationRouting,
  TRUSTED_IN_PROCESS,
  VERIFIED_SANDBOX,
  verifyIsolationEvidence,
} from "../csm-orchestrate/lib/skill-executor-preflight.mjs";
import {
  buildWorkerAttestation,
  verifyWorkerAttestation,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";
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

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

// T002: a valid host-invocation fixture so a host-dispatched node can complete.
function completedHostFixture() {
  const artifacts = new Map();
  return {
    invoked: false,
    async invokeSiblingSkill(request) {
      this.invoked = true;
      const descriptorBody = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-iso-1",
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: `fixture-${request.childRunId}.json`,
          artifactId: `art-${request.childRunId}`,
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      const descriptor = { ...descriptorBody, digest: SHA_B };
      artifacts.set(descriptorBody.source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-iso-1",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: SHA_B,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(refPath, expected = {}) {
        const value = artifacts.get(refPath);
        if (!value)
          return { status: "missing", code: "missing", message: `missing artifact: ${refPath}` };
        return {
          status: "resolved",
          path: refPath,
          owner: expected.expectedOwner,
          fileDigest: expected.expectedFileDigest,
          value: { ...value, schema: value.source.schema },
        };
      },
    },
  };
}

const optOutApproval = (overrides = {}) => ({
  status: "approved",
  approvalId: "approval-x",
  scope: [HOST_ISOLATION_OPT_OUT_SCOPE],
  binding: { runId: "run-x", skill: "csm-scan" },
  ...overrides,
});

const selfProvidedIsolation = (extra = {}) => ({
  isolation: VERIFIED_SANDBOX,
  required: VERIFIED_SANDBOX,
  selfProvided: true,
  ...extra,
});

const approachFor = (runId, capability) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "live-isolation",
  signals: { capabilities: [capability], inputs: ["repository"] },
  phases: [
    {
      phaseId: "P1",
      title: "Work",
      goal: "run the routed node",
      deliverables: ["result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["done"],
      context: [],
      dependencies: [],
    },
  ],
});

// T003: a custom host/fixture adapter may omit `effectiveIsolation`. The declared
// capability remains the required side; the absent report is the effective side.
// A verified-sandbox requirement therefore cannot be resolved and must fail
// closed with the typed `isolation-unavailable` code.
const verifiedSandboxCapabilities = async () => {
  const base = await loadCapabilities();
  const skills = structuredClone(base.skills).map((capability) =>
    capability.skill === "csm-scan"
      ? {
          ...capability,
          execution: {
            ...capability.execution,
            isolation: VERIFIED_SANDBOX,
            attestation: "required",
          },
        }
      : capability,
  );
  return { ...structuredClone(base), skills, contentDigest: digest(skills) };
};

test("T003: host/fixture adapter omitting effectiveIsolation refuses a verified-sandbox requirement", async () => {
  const capabilities = await verifiedSandboxCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-host-unknown-"));
  try {
    const skill = "csm-scan";
    const binding = bindingFor(skill, completedHandler());
    const executorRegistry = await createSkillExecutorRegistry({ descriptors: [binding] });
    const runId = "run-live-host-unknown";
    let adapterInvoked = false;
    // Custom host/fixture shape: no top-level `effectiveIsolation`, and the
    // bound handler carries no reporter either.
    const executorAdapter = {
      async invoke() {
        adapterInvoked = true;
        return { status: "completed", output: { ok: true } };
      },
    };
    const result = await orchestrate({
      approach: approachFor(runId, skill),
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
      maxAttempts: 1,
    });
    assert.equal(adapterInvoked, false, "an unverifiable isolation node must not be invoked");
    assert.equal(result.receipt.outcome.status, "BLOCKED");
    assert.equal(result.reason, "isolation-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T003: host/fixture adapter omitting effectiveIsolation still admits trusted-in-process", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-host-trusted-"));
  try {
    const skill = "csm-scan";
    const binding = bindingFor(skill, completedHandler());
    const executorRegistry = await createSkillExecutorRegistry({ descriptors: [binding] });
    const runId = "run-live-host-trusted";
    let adapterInvoked = false;
    const executorAdapter = {
      async invoke(request) {
        adapterInvoked = true;
        return {
          status: "completed",
          childReceipt: validReceipt({
            runId: request.childRunId,
            owner: request.skill,
            attempt: request.retry?.attempt ?? 1,
          }),
          evidence: [],
          outputArtifactRefs: [],
        };
      },
    };
    const result = await orchestrate({
      approach: approachFor(runId, skill),
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
      maxAttempts: 1,
    });
    assert.equal(adapterInvoked, true, "the trusted-in-process node must reach the adapter");
    assert.notEqual(result.reason, "isolation-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

// T002: host-dispatch isolation seam. The host-invocation path (no executor
// adapter) must refuse a route whose declared requirement exceeds the
// in-process floor unless an explicit approved opt-out is bound; incidental and
// trusted-in-process host routes still run.

test("T002: host dispatch refuses a verified-sandbox requirement without an approved opt-out", async () => {
  const capabilities = await verifiedSandboxCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-host-refuse-"));
  try {
    const skill = "csm-scan";
    const runId = "run-live-host-refuse";
    const host = completedHostFixture();
    const result = await orchestrate({
      approach: approachFor(runId, skill),
      runId,
      host,
      capabilities,
      signals: { capabilities: [skill] },
      approvals: createAutonomyPolicy(capabilities, { now: NOW }),
      now: NOW,
      cursorStore: durableStore(),
      schemaRegistry: registry,
      artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
      childArtifactResolver: host.artifactResolver,
      maxAttempts: 1,
    });
    assert.equal(
      host.invoked,
      false,
      "the host must not run an unsatisfiable verified-sandbox route",
    );
    assert.equal(result.receipt.outcome.status, "BLOCKED");
    assert.equal(result.reason, "isolation-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T002: host dispatch still runs an incidental/trusted route", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-host-trusted-"));
  try {
    const skill = "csm-scan";
    const runId = "run-live-host-trusted";
    const host = completedHostFixture();
    const result = await orchestrate({
      approach: approachFor(runId, skill),
      runId,
      host,
      capabilities,
      signals: { capabilities: [skill] },
      approvals: createAutonomyPolicy(capabilities, { now: NOW }),
      now: NOW,
      cursorStore: durableStore(),
      schemaRegistry: registry,
      artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
      childArtifactResolver: host.artifactResolver,
      maxAttempts: 1,
    });
    assert.equal(host.invoked, true, "the trusted-in-process host route must reach the host");
    assert.notEqual(result.reason, "isolation-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T002: host dispatch admits a verified-sandbox requirement with a bound approved opt-out", async () => {
  const capabilities = await verifiedSandboxCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-isolation-host-optout-"));
  try {
    const skill = "csm-scan";
    const runId = "run-live-host-optout";
    const host = completedHostFixture();
    const result = await orchestrate({
      approach: approachFor(runId, skill),
      runId,
      host,
      hostIsolationOptOut: {
        schema: "csm-orchestrate-isolation-opt-out/1",
        status: "approved",
        approvalId: "approval-host-optout",
        scope: [VERIFIED_SANDBOX],
        binding: { runId, skill },
      },
      capabilities,
      signals: { capabilities: [skill] },
      approvals: createAutonomyPolicy(capabilities, { now: NOW }),
      now: NOW,
      cursorStore: durableStore(),
      schemaRegistry: registry,
      artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
      childArtifactResolver: host.artifactResolver,
      maxAttempts: 1,
    });
    assert.equal(host.invoked, true, "a bound approved opt-out must admit the host route");
    assert.notEqual(result.reason, "isolation-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T002: approvedHostIsolationOptOut only admits an explicitly bound, approved opt-out", () => {
  const context = { runId: "run-x", skill: "csm-scan", required: VERIFIED_SANDBOX };
  assert.equal(approvedHostIsolationOptOut(null, context), false);
  assert.equal(approvedHostIsolationOptOut({ status: "requested" }, context), false);
  assert.equal(
    approvedHostIsolationOptOut(optOutApproval({ approvalId: "" }), context),
    false,
    "an opt-out without an approvalId is not approved",
  );
  assert.equal(
    approvedHostIsolationOptOut(
      optOutApproval({ binding: { runId: "run-other", skill: "csm-scan" } }),
      context,
    ),
    false,
    "an opt-out bound to another run is not admitted",
  );
  assert.equal(
    approvedHostIsolationOptOut(optOutApproval({ scope: [TRUSTED_IN_PROCESS] }), context),
    false,
    "an opt-out that names a weaker tier does not waive verified-sandbox",
  );
  assert.equal(approvedHostIsolationOptOut(optOutApproval(), context), true);
  assert.equal(
    approvedHostIsolationOptOut(optOutApproval({ scope: [VERIFIED_SANDBOX] }), context),
    true,
  );
});

// T003: effective isolation must be evidence-bound, not a bare asserted string.

test("T003: a self-provided verified-sandbox claim is refused unless evidence-bound", () => {
  const capability = {
    skill: "csm-autoresearch",
    execution: { isolation: VERIFIED_SANDBOX, attestation: "required" },
  };
  const payload = { status: "verified", provider: "docker", controls: { networkIsolation: true } };
  const bound = {
    kind: "provider-attestation",
    digest: digest(payload),
    payload,
    verify: () => true,
  };

  const unbound = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation() },
    request: { skill: "csm-autoresearch" },
    capability,
    runtimeInvocable: true,
  });
  assert.equal(unbound.action, "blocked");
  assert.equal(unbound.failure.failure.code, "isolation-unavailable");

  const bareString = isolationRouting({
    adapter: { effectiveIsolation: () => VERIFIED_SANDBOX },
    request: { skill: "csm-autoresearch" },
    capability,
    runtimeInvocable: false,
  });
  assert.equal(bareString.action, "blocked", "a bare asserted string is not a self-provided claim");

  const admitted = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: bound }) },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(admitted.action, "invoke");

  const tampered = { ...bound, payload: { ...payload, status: "forged" } };
  assert.equal(verifyIsolationEvidence(tampered), false, "a digest/payload mismatch is unbindable");
  const failedVerify = { ...bound, verify: () => false };
  assert.equal(verifyIsolationEvidence(failedVerify), false);
  const noVerifier = { digest: digest(payload), payload };
  assert.equal(verifyIsolationEvidence(noVerifier), false);

  const refusedTampered = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: tampered }) },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(refusedTampered.action, "blocked");
});

test("T003: a worker attestation verified through verifyWorkerAttestation admits the claim", () => {
  const anchorKey = Buffer.from("host-anchor-key");
  const doc = buildWorkerAttestation({
    workerId: "worker-1",
    runId: "run-worker-1",
    policyDigest: `sha256:${"c".repeat(64)}`,
    imageDigest: `sha256:${"d".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  const evidence = {
    kind: "worker-attestation",
    digest: digest(doc),
    payload: doc,
    verify: () => verifyWorkerAttestation({ doc, anchorKey }),
  };
  assert.equal(verifyIsolationEvidence(evidence), true);

  const routing = isolationRouting({
    adapter: {
      effectiveIsolation: () => ({
        isolation: VERIFIED_SANDBOX,
        required: VERIFIED_SANDBOX,
        selfProvided: true,
        evidence,
      }),
    },
    request: { skill: "csm-autoresearch" },
    capability: { skill: "csm-autoresearch", execution: { isolation: VERIFIED_SANDBOX } },
  });
  assert.equal(routing.action, "invoke");

  const wrongKey = {
    ...evidence,
    verify: () => verifyWorkerAttestation({ doc, anchorKey: Buffer.from("other-key") }),
  };
  assert.equal(verifyIsolationEvidence(wrongKey), false);
});

test("T003: csm-autoresearch generated report binds its provider attestation", () => {
  const attestation = {
    provider: "docker",
    status: "verified",
    network: "disabled",
    mounts: [],
    evaluatorAssets: "isolated",
    credentials: "none",
    limits: { timeoutMs: 1000, maxOutputBytes: 4096, maxWorkspaceBytes: 1024 },
    policyDigest: `sha256:${"1".repeat(64)}`,
    imageDigest: `sha256:${"2".repeat(64)}`,
    sourceHash: `sha256:${"3".repeat(64)}`,
    controls: { networkIsolation: true },
  };
  const provider = {
    mode: "generated",
    sandboxProvider: "docker",
    sandboxAttestation: attestation,
    policy: {
      network: "disabled",
      mounts: [],
      evaluatorAssets: "isolated",
      credentials: "none",
      limits: { timeoutMs: 1000, maxOutputBytes: 4096, maxWorkspaceBytes: 1024 },
    },
    verifySandboxAttestation: (value, controls) =>
      value === attestation && controls.network === "disabled" && controls.credentials === "none",
  };

  const report = autoresearchEffectiveIsolation("generated", provider);
  assert.equal(report.isolation, VERIFIED_SANDBOX);
  assert.equal(report.selfProvided, true);
  assert.ok(report.evidence, "the generated report must bind the provider attestation");
  assert.equal(verifyIsolationEvidence(report.evidence), true);

  const capability = { skill: "csm-autoresearch", execution: { isolation: VERIFIED_SANDBOX } };
  const admitted = isolationRouting({
    adapter: { effectiveIsolation: () => report },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(admitted.action, "invoke");

  const rejected = autoresearchEffectiveIsolation("generated", {
    ...provider,
    verifySandboxAttestation: () => false,
  });
  assert.equal(verifyIsolationEvidence(rejected.evidence), false);
  const refused = isolationRouting({
    adapter: { effectiveIsolation: () => rejected },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(refused.action, "blocked");
  assert.equal(refused.failure.failure.code, "isolation-unavailable");
});
