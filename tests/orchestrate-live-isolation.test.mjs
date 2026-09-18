"use strict";

// T004: mode-aware effective-isolation gate + live provider/broker wiring.
//   (a) a verified-sandbox node routes through the live runtime and fails closed
//       with a typed `isolation-unavailable` code when it cannot be satisfied;
//   (b) an unknown effective isolation is refused;
//   (c) the trusted-in-process route is still admitted (no regression), and the
//       csm-autoresearch generated/trusted-local modes report effective trust.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  isRecognizedIsolationEvidenceKind,
  isolationGate,
  isolationRouting,
  PROVIDER_ATTESTATION_EVIDENCE_KIND,
  TRUSTED_IN_PROCESS,
  VERIFIED_SANDBOX,
  verifyIsolationEvidence,
  WORKER_ATTESTATION_EVIDENCE_KIND,
} from "../csm-orchestrate/lib/skill-executor-preflight.mjs";
import {
  buildWorkerAttestation,
  createDockerWorkerProvider,
  createHostIsolationVerifier,
  createWorkerAttestationVerifier,
  isHostIsolationVerifier,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";
import {
  EGRESS_ANCHOR_REASONS,
  EGRESS_ANCHOR_TRUST_DOMAINS,
  createEgressLedger,
  createExternalAnchor,
} from "../csm-orchestrate/lib/egress-broker.mjs";
import { enforceTerminalTrust } from "../csm-orchestrate/lib/verified-sandbox-runtime.mjs";
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

// T001 (N1): effective isolation must be host/independently anchored, not a bare
// asserted string and not a caller-supplied verify() closure.

test("T001: a bare caller verify() cannot admit a self-provided verified-sandbox claim", () => {
  const capability = {
    skill: "csm-autoresearch",
    execution: { isolation: VERIFIED_SANDBOX, attestation: "required" },
  };
  const payload = { status: "verified", provider: "docker", controls: { networkIsolation: true } };
  const bare = {
    kind: "provider-attestation",
    digest: digest(payload),
    payload,
    verify: () => true,
  };
  assert.equal(
    verifyIsolationEvidence(bare),
    false,
    "a bare caller closure is not a host-held anchor",
  );

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

  const refusedBare = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: bare }) },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(refusedBare.action, "blocked", "a caller verify() must not admit the claim");

  // A provider-owned verifier bound at construction (branded) is admitted, and
  // its verdict is authoritative: a payload it rejects is refused.
  const providerOwned = {
    kind: "provider-attestation",
    digest: digest(payload),
    payload,
    verify: createHostIsolationVerifier((value) => value === payload),
  };
  const admitted = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: providerOwned }) },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(admitted.action, "invoke");

  const tampered = { ...providerOwned, payload: { ...payload, status: "forged" } };
  assert.equal(verifyIsolationEvidence(tampered), false, "a digest/payload mismatch is unbindable");
  const noVerifier = { kind: "provider-attestation", digest: digest(payload), payload };
  assert.equal(verifyIsolationEvidence(noVerifier), false);
  const unanchoredKind = {
    digest: digest(payload),
    payload,
    verify: createHostIsolationVerifier(() => true),
  };
  assert.equal(
    verifyIsolationEvidence(unanchoredKind),
    false,
    "an unrecognizable (kind-less) evidence form is refused",
  );

  const refusedTampered = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: tampered }) },
    request: { skill: "csm-autoresearch" },
    capability,
  });
  assert.equal(refusedTampered.action, "blocked");

  // A gate-bound verifier is authoritative and must itself be host-branded.
  const boundVerifier = createHostIsolationVerifier((value) => value === payload);
  assert.equal(verifyIsolationEvidence(noVerifier, { verifier: boundVerifier }), true);
  assert.equal(verifyIsolationEvidence(noVerifier, { verifier: () => true }), false);
});

test("T001: a worker attestation is admitted only with the host-held anchor key", () => {
  const anchorKey = Buffer.from("host-anchor-key");
  const doc = buildWorkerAttestation({
    workerId: "worker-1",
    runId: "run-worker-1",
    policyDigest: `sha256:${"c".repeat(64)}`,
    imageDigest: `sha256:${"d".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  const evidence = { kind: "worker-attestation", digest: digest(doc), payload: doc };
  // The bare closure is not a host anchor.
  assert.equal(verifyIsolationEvidence({ ...evidence, verify: () => true }), false);
  // No key supplied -> unbindable (fail closed).
  assert.equal(verifyIsolationEvidence(evidence), false);
  // The real keyed doc with the host anchor key is admitted.
  assert.equal(verifyIsolationEvidence(evidence, { anchorKey }), true);
  // A wrong key is refused.
  assert.equal(verifyIsolationEvidence(evidence, { anchorKey: Buffer.from("other-key") }), false);

  // A provider-owned verifier bound to the same key is admitted too.
  const bound = { ...evidence, verify: createWorkerAttestationVerifier({ anchorKey }) };
  assert.equal(verifyIsolationEvidence(bound), true);
  const wrongBound = {
    ...evidence,
    verify: createWorkerAttestationVerifier({
      anchorKey: Buffer.from("other-key"),
    }),
  };
  assert.equal(verifyIsolationEvidence(wrongBound), false);

  const admitted = isolationRouting({
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
    anchorKey,
  });
  assert.equal(admitted.action, "invoke");
  const refused = isolationRouting({
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
    anchorKey: Buffer.from("other-key"),
  });
  assert.equal(refused.action, "blocked");
  assert.equal(refused.failure.failure.code, "isolation-unavailable");
});

test("T001: the docker provider binds its host anchor key into a branded verifier", () => {
  const anchorKey = Buffer.from("provider-anchor-key");
  const provider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey,
  });
  const verifier = provider.evidenceVerifier();
  const doc = buildWorkerAttestation({
    workerId: "worker-9",
    runId: "run-worker-9",
    policyDigest: `sha256:${"1".repeat(64)}`,
    imageDigest: `sha256:${"2".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  assert.equal(
    verifyIsolationEvidence(
      { kind: "worker-attestation", digest: digest(doc), payload: doc },
      {
        verifier,
      },
    ),
    true,
  );
  const wrong = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey: Buffer.from("other-key"),
  }).evidenceVerifier();
  assert.equal(
    verifyIsolationEvidence(
      { kind: "worker-attestation", digest: digest(doc), payload: doc },
      {
        verifier: wrong,
      },
    ),
    false,
  );
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

// T005 (N1 follow-up): the evidence `kind` is an allowlist, so a forged or
// future kind cannot smuggle a self-provided verified-sandbox claim past the
// gate even with a matching digest and a host-branded verifier.
test("T005: the isolation gate refuses an unrecognized evidence kind", () => {
  const payload = { status: "verified", controls: { networkIsolation: true } };
  const unknownKind = {
    kind: "worker-attestation-v2",
    digest: digest(payload),
    payload,
    verify: createHostIsolationVerifier(() => true),
  };
  assert.equal(isRecognizedIsolationEvidenceKind(unknownKind.kind), false);
  assert.equal(verifyIsolationEvidence(unknownKind), false);
  assert.equal(verifyIsolationEvidence(unknownKind, { anchorKey: Buffer.from("k") }), false);

  const routing = isolationRouting({
    adapter: { effectiveIsolation: () => selfProvidedIsolation({ evidence: unknownKind }) },
    request: { skill: "csm-autoresearch" },
    capability: { skill: "csm-autoresearch", execution: { isolation: VERIFIED_SANDBOX } },
  });
  assert.equal(routing.action, "blocked");
  assert.equal(routing.failure.failure.code, "isolation-unavailable");

  // The two kinds actually produced remain recognized and admissible.
  for (const kind of [WORKER_ATTESTATION_EVIDENCE_KIND, PROVIDER_ATTESTATION_EVIDENCE_KIND]) {
    assert.equal(isRecognizedIsolationEvidenceKind(kind), true);
    assert.equal(
      verifyIsolationEvidence({
        kind,
        digest: digest(payload),
        payload,
        verify: createHostIsolationVerifier(() => true),
      }),
      true,
    );
  }
});

// T005 (N1 follow-up): the in-process adapter prefers the provider's host-held
// verifier (`provider.evidenceVerifier()`, reached through a config-supplied
// `sandboxRuntime`) over any caller-supplied `isolationVerifier` brand.
async function hostAnchoredAdapter({ skill = "csm-scan", provider, report, callerVerifier }) {
  const binding = bindingFor(skill, completedHandler());
  const registry = await createSkillExecutorRegistry({ descriptors: [binding] });
  return createInProcessExecutorAdapter({
    registry,
    bindings: { [skill]: binding },
    capabilities: [{ skill, digest: digest("a"), execution: { isolation: TRUSTED_IN_PROCESS } }],
    cursorStore: durableStore(),
    isolationReporters: { [skill]: () => report },
    sandboxRuntime: {
      enabled: true,
      provider,
      sandboxExecutor: async () => ({ status: "completed" }),
    },
    isolationVerifier: callerVerifier,
  });
}

test("T005: the executor adapter prefers the provider's host-held verifier over a caller brand", async () => {
  const anchorKey = Buffer.from("adapter-host-anchor-key");
  const doc = buildWorkerAttestation({
    workerId: "worker-adapter",
    runId: "run-adapter",
    policyDigest: `sha256:${"c".repeat(64)}`,
    imageDigest: `sha256:${"d".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  const evidence = {
    kind: WORKER_ATTESTATION_EVIDENCE_KIND,
    digest: digest(doc),
    payload: doc,
  };
  const provider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey,
  });
  // The caller brand rejects everything, yet the host provider verifier accepts
  // the keyed document, so admission proves the provider verifier was used.
  const admitted = await hostAnchoredAdapter({
    provider,
    report: selfProvidedIsolation({
      required: VERIFIED_SANDBOX,
      attestation: "required",
      evidence,
    }),
    callerVerifier: createHostIsolationVerifier(() => false),
  });
  const admittedResult = await admitted.invoke(requestFor("csm-scan", "run-adapter-allow"));
  assert.equal(admittedResult.status, "completed", JSON.stringify(admittedResult));

  // A caller brand that accepts everything cannot override the host provider
  // verifier's rejection of a mismatched anchor key.
  const wrongProvider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey: Buffer.from("other-host-key"),
  });
  const refused = await hostAnchoredAdapter({
    provider: wrongProvider,
    report: selfProvidedIsolation({
      required: VERIFIED_SANDBOX,
      attestation: "required",
      evidence,
    }),
    callerVerifier: createHostIsolationVerifier(() => true),
  });
  const refusedResult = await refused.invoke(requestFor("csm-scan", "run-adapter-deny"));
  assert.equal(refusedResult.status, "blocked");
  assert.equal(refusedResult.failure.code, "isolation-unavailable");
});

test("T005: the host verifier does not displace the csm-autoresearch generated route", async () => {
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
  const generatedProvider = {
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
      value === attestation && controls.network === "disabled",
  };
  const report = autoresearchEffectiveIsolation("generated", generatedProvider);
  assert.equal(report.evidence.kind, PROVIDER_ATTESTATION_EVIDENCE_KIND);

  const dockerProvider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey: Buffer.from("adapter-host-anchor-key"),
  });
  const adapter = await hostAnchoredAdapter({
    provider: dockerProvider,
    report,
    callerVerifier: createHostIsolationVerifier(() => false),
  });
  const result = await adapter.invoke(requestFor("csm-scan", "run-autoresearch-generated"));
  assert.equal(result.status, "completed", JSON.stringify(result));
});

// T001: the live terminal trust gate is the live wiring for the host-external
// anchor. The accepted boundary is `os-user-bound` (the recorded scope
// decision); a host-external requirement is satisfied only by an explicit
// host-external provider and fails closed when the provider is absent,
// unavailable, or mismatched. These tests pin that decision so a future change
// cannot silently weaken the boundary or overstate what was delivered.
test("T001: the live terminal gate records the OS-user boundary without claiming host-external", () => {
  const ledger = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
  });
  ledger.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  const trust = enforceTerminalTrust({ ledger });
  assert.equal(trust.domain, EGRESS_ANCHOR_TRUST_DOMAINS.osUser);
  assert.equal(trust.hostExternal, false);
  assert.equal(trust.authorized, true);
  assert.equal(trust.reason, EGRESS_ANCHOR_REASONS.anchored);
});

test("T001: requiring host-external without a host-external anchor fails closed", () => {
  const ledger = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
  });
  ledger.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  assert.throws(
    () => enforceTerminalTrust({ ledger, declaredDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external }),
    (error) => {
      assert.equal(error.code, "verified-sandbox-trust-anchor");
      assert.equal(error.scope, "egress-final-sink");
      assert.equal(error.reason, EGRESS_ANCHOR_REASONS.notHostExternal);
      assert.equal(error.domain, EGRESS_ANCHOR_TRUST_DOMAINS.external);
      return true;
    },
  );
});

test("T001: an explicit host-external anchor satisfies the external requirement", () => {
  const published = [];
  const ledger = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
    trustAnchor: createExternalAnchor({
      publish: (event) => published.push(event),
      read: () => published.at(-1)?.headDigest ?? null,
    }),
  });
  ledger.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  const trust = enforceTerminalTrust({
    ledger,
    declaredDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
  });
  assert.equal(trust.domain, EGRESS_ANCHOR_TRUST_DOMAINS.external);
  assert.equal(trust.hostExternal, true);
  assert.equal(trust.authorized, true);
  assert.equal(trust.reason, EGRESS_ANCHOR_REASONS.anchored);
});

test("T001: a mismatched or unavailable host-external anchor fails closed", () => {
  const mismatched = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
    trustAnchor: createExternalAnchor({
      publish: () => {},
      read: () => `sha256:${"f".repeat(64)}`,
    }),
  });
  mismatched.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  assert.throws(
    () =>
      enforceTerminalTrust({
        ledger: mismatched,
        declaredDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
      }),
    (error) =>
      error.code === "verified-sandbox-trust-anchor" &&
      error.reason === EGRESS_ANCHOR_REASONS.mismatch,
  );

  const unavailable = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
    trustAnchor: createExternalAnchor({
      publish: () => {},
      read: () => {
        throw new Error("sink down");
      },
    }),
  });
  unavailable.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  assert.throws(
    () =>
      enforceTerminalTrust({
        ledger: unavailable,
        declaredDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
      }),
    (error) =>
      error.code === "verified-sandbox-trust-anchor" &&
      error.reason === EGRESS_ANCHOR_REASONS.unavailable,
  );
});

test("T001: worker attestation under an external requirement fails closed on an OS-user provider", () => {
  const published = [];
  const ledger = createEgressLedger({
    runId: "run-anchor-scope",
    key: "anchor-scope-key-0123456789",
    trustAnchor: createExternalAnchor({
      publish: (event) => published.push(event),
      read: () => published.at(-1)?.headDigest ?? null,
    }),
  });
  ledger.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
  const provider = {
    trustBoundary: () => ({
      trustDomain: EGRESS_ANCHOR_TRUST_DOMAINS.osUser,
      hostExternal: false,
      publishAvailable: true,
      readAvailable: true,
      required: false,
      label: "os-user-anchor",
      reason: null,
    }),
    reauthorizeAttestation: ({ acceptedTrustDomain }) => ({
      authorized: false,
      reasonCode: EGRESS_ANCHOR_REASONS.notHostExternal,
      hostExternal: false,
      acceptedTrustDomain,
    }),
  };
  assert.throws(
    () =>
      enforceTerminalTrust({
        ledger,
        provider,
        started: { attestationDoc: { schema: "csm-orchestrate-worker-attestation/1" } },
        declaredDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
      }),
    (error) => {
      assert.equal(error.code, "verified-sandbox-trust-anchor");
      assert.equal(error.scope, "worker-attestation");
      assert.equal(error.reason, EGRESS_ANCHOR_REASONS.notHostExternal);
      return true;
    },
  );
});

// T003: the host-held isolation verifier must be reachable through the
// constructed live runtime on the default path, not only through a raw provider
// config. `createLiveVerifiedSandboxRuntime` passes the provider's
// `evidenceVerifier()`/`trustBoundary()` through, and the executor adapter
// prefers that runtime verifier over any caller-carried brand.

test("T003: the live runtime exposes the provider's host-held verifier and trust boundary", () => {
  const anchorKey = Buffer.from("runtime-host-anchor-key");
  const provider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey,
  });
  const runtime = createLiveVerifiedSandboxRuntime({ provider });
  assert.equal(typeof runtime.evidenceVerifier, "function");
  assert.equal(typeof runtime.trustBoundary, "function");
  const verifier = runtime.evidenceVerifier();
  assert.equal(
    isHostIsolationVerifier(verifier),
    true,
    "the runtime passthrough must be a branded host-held verifier",
  );
  assert.equal(runtime.trustBoundary().hostExternal, false);

  const doc = buildWorkerAttestation({
    workerId: "worker-runtime",
    runId: "run-runtime",
    policyDigest: `sha256:${"c".repeat(64)}`,
    imageDigest: `sha256:${"d".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  assert.equal(
    verifyIsolationEvidence(
      { kind: WORKER_ATTESTATION_EVIDENCE_KIND, digest: digest(doc), payload: doc },
      { verifier },
    ),
    true,
  );

  // A provider with no host-held material exposes null, never a fake brand.
  const bare = createLiveVerifiedSandboxRuntime({
    provider: { start: async () => ({}), stop: async () => {} },
  });
  assert.equal(bare.evidenceVerifier(), null);
  assert.equal(bare.trustBoundary(), null);
});

test("T003: the executor adapter reaches the provider verifier through the live runtime", async () => {
  const anchorKey = Buffer.from("runtime-adapter-anchor-key");
  const doc = buildWorkerAttestation({
    workerId: "worker-runtime-adapter",
    runId: "run-runtime-adapter",
    policyDigest: `sha256:${"c".repeat(64)}`,
    imageDigest: `sha256:${"d".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
  const evidence = { kind: WORKER_ATTESTATION_EVIDENCE_KIND, digest: digest(doc), payload: doc };
  const report = selfProvidedIsolation({ attestation: "required", evidence });

  const build = async (runtime, callerVerifier) => {
    const binding = bindingFor("csm-scan", completedHandler());
    const registry = await createSkillExecutorRegistry({ descriptors: [binding] });
    return createInProcessExecutorAdapter({
      registry,
      bindings: { "csm-scan": binding },
      capabilities: [
        { skill: "csm-scan", digest: digest("a"), execution: { isolation: TRUSTED_IN_PROCESS } },
      ],
      cursorStore: durableStore(),
      isolationReporters: { "csm-scan": () => report },
      sandboxRuntime: runtime,
      isolationVerifier: callerVerifier,
    });
  };

  const provider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey,
  });
  const runtime = createLiveVerifiedSandboxRuntime({ provider });
  // The caller brand rejects everything; admission proves the runtime's
  // provider verifier (not the caller brand) was consulted.
  const admitted = await (
    await build(
      runtime,
      createHostIsolationVerifier(() => false),
    )
  ).invoke(requestFor("csm-scan", "run-runtime-adapter"));
  assert.equal(admitted.status, "completed", JSON.stringify(admitted));

  // A caller brand that accepts everything cannot override the runtime
  // provider verifier's rejection of a mismatched anchor key.
  const wrongProvider = createDockerWorkerProvider({
    run: async () => ({ code: 0, stdout: "cid", stderr: "" }),
    anchorKey: Buffer.from("other-runtime-key"),
  });
  const wrongRuntime = createLiveVerifiedSandboxRuntime({ provider: wrongProvider });
  const refused = await (
    await build(
      wrongRuntime,
      createHostIsolationVerifier(() => true),
    )
  ).invoke(requestFor("csm-scan", "run-runtime-adapter-deny"));
  assert.equal(refused.status, "blocked");
  assert.equal(refused.failure.code, "isolation-unavailable");
});

// T005: the thin child entry (`scripts/run-worker.mjs`) is deliberately not part
// of the packaged payload — `scripts/pack-bootstrap.mjs` maps only skill payload
// files, so a packaged install ships no `scripts/` tree and cannot run the thin
// entry. Running the thin worker therefore requires the dev checkout (or a
// caller-supplied worker script). The requirement is recorded in
// docs/dynamic-worker-runtime.md; this check fails if the documented
// requirement, the dev entry, or the packaged-payload boundary regresses.
test("T005: the thin child entry packaging requirement stays documented and unshipped", async () => {
  const workerEntry = fileURLToPath(new URL("../scripts/run-worker.mjs", import.meta.url));
  assert.ok(
    (await stat(workerEntry)).isFile(),
    "scripts/run-worker.mjs must exist in the dev checkout",
  );

  const docs = await readFile(
    fileURLToPath(new URL("../docs/dynamic-worker-runtime.md", import.meta.url)),
    "utf8",
  );
  assert.match(
    docs,
    /Thin child entry packaging requirement/,
    "docs/dynamic-worker-runtime.md must record the thin-entry packaging requirement",
  );
  assert.match(
    docs,
    /not\s+(?:part of|in)\s+the\s+packaged payload/i,
    "the docs must state the thin entry is not in the packaged payload",
  );

  const packagedEntry = fileURLToPath(
    new URL(
      "../bootstrap/package/payload/skills/csm-orchestrate/scripts/run-worker.mjs",
      import.meta.url,
    ),
  );
  await assert.rejects(
    () => stat(packagedEntry),
    (error) => error.code === "ENOENT",
    "the packaged payload must not ship a thin worker entry it cannot resolve",
  );
});
