"use strict";

// T003 (dynamic-worker-runtime closure): the live default path. A caller enables
// one configuration-driven verified-sandbox runtime and the runtime constructs
// the Docker provider + egress network enforcer + host-side policy-bound
// listener, supplies the sandbox executor / egress policy / ledger / forward
// transport, and mediates every worker egress request host-side. These tests
// prove:
//   (a) Docker e2e: a real sandboxed worker reaches an allowlisted upstream ONLY
//       through the host listener, an unlisted target is denied, and the
//       kernel-dropped direct attempt is recorded;
//   (b) the in-process executor adapter accepts the config and routes through it
//       without any per-request plumbing (hermetic);
//   (c) a disabled/absent config preserves fail-closed isolation-unavailable and
//       the trusted-in-process csm-autoresearch route is unaffected;
//   (d) orchestrate builds the config runtime and routes verified-sandbox nodes
//       through it (hermetic).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createDockerWorkerProvider } from "../csm-orchestrate/lib/docker-worker-provider.mjs";
import {
  EGRESS_ANCHOR_TRUST_DOMAINS,
  createEgressLedger,
  createExternalAnchor,
} from "../csm-orchestrate/lib/egress-broker.mjs";
import {
  createLiveVerifiedSandboxRuntime,
  createVerifiedSandboxRuntime,
  resolveVerifiedSandboxRuntime,
} from "../csm-orchestrate/lib/verified-sandbox-runtime.mjs";
import { createExecutorDescriptors } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import {
  TRUSTED_IN_PROCESS,
  VERIFIED_SANDBOX,
} from "../csm-orchestrate/lib/skill-executor-preflight.mjs";

const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const NOW = () => new Date("2026-09-13T00:00:00Z");
const PARENT_RUN = "run-live-sandbox-parent";

const EGRESS_POLICY = Object.freeze({
  defaultAction: "deny",
  failMode: "blocked",
  entries: [
    {
      host: "api.allowed.test",
      port: 443,
      scheme: "https",
      methods: ["GET"],
      maxBytes: 65536,
      timeoutMs: 10000,
    },
  ],
  credentialInjections: [],
});

// T001 (AC6): a schema-valid sandbox policy declaring a 1s re-attestation
// cadence, so a live session actually re-attests within the test. The image
// digest matches the node image the Docker worker provider defaults to.
const SANDBOX_POLICY = Object.freeze({
  schema: "csm-orchestrate-docker-worker-policy/2",
  schemaRevision: 2,
  image:
    "node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5",
  network: "none",
  mounts: [],
  rootFilesystem: "read-only",
  capabilitiesDrop: ["ALL"],
  noNewPrivileges: true,
  dropCapture: { required: false },
  workspace: { mode: "tmpfs", path: "/workspace", sizeBytes: 1610612736 },
  limits: {
    memoryBytes: 2147483648,
    pidsLimit: 512,
    cpuQuota: 100000,
    cpuPeriod: 100000,
    sessionTimeoutMs: 30000,
  },
  session: { mode: "long-lived", heartbeatMs: 15000, reapingInit: true },
  attestation: {
    required: true,
    cadenceMs: 1000,
    controls: [
      "mountsEmpty",
      "rootFilesystemReadOnly",
      "capDropAll",
      "noNewPrivileges",
      "networkIsolated",
      "credentialsNone",
    ],
  },
});

// A worker that stays alive and silent: it holds the session open so the
// re-attestation monitor has time to tick.
const IDLE_WORKER_SOURCE = `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", () => {});
`;

// A mediated-egress worker: it dials the broker container's relay (handed to it
// as `input.egressRelay`) and the broker pipes the bytes to the host listener,
// then makes a direct attempt to a TEST-NET address that the network enforcer
// kernel-drops.
const WORKER_SOURCE = `
import net from "node:net";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let relay = null;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

function egress(target) {
  return new Promise((resolve) => {
    if (!relay) {
      resolve({ decision: "error", reasonCode: "relay-unavailable" });
      return;
    }
    const socket = net.connect(relay.port, relay.host);
    let buffer = "";
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve({ decision: "error", reasonCode: "timeout" });
    });
    socket.on("connect", () => socket.write(JSON.stringify({ id: "e", target }) + "\\n"));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\\n");
      if (newline === -1) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.on("error", (error) => resolve({ decision: "error", reasonCode: error.code ?? "error" }));
  });
}

function bypass() {
  return new Promise((resolve) => {
    const socket = net.connect(443, "203.0.113.7");
    socket.setTimeout(1200, () => {
      socket.destroy();
      resolve("timeout");
    });
    socket.on("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.on("error", (error) => resolve(error.code ?? "error"));
  });
}

async function run() {
  const allowed = await egress({
    host: "api.allowed.test",
    port: 443,
    scheme: "https",
    method: "GET",
    path: "/v1",
  });
  const denied = await egress({
    host: "evil.denied.test",
    port: 443,
    scheme: "https",
    method: "GET",
    path: "/v1",
  });
  const bypassResult = await bypass();
  send({
    type: "done",
    output: {
      allowedDecision: allowed.decision,
      allowedStatus: allowed.upstream?.status ?? null,
      allowedBody: allowed.upstream?.body ?? null,
      deniedDecision: denied.decision,
      deniedReason: denied.reasonCode,
      deniedUpstream: denied.upstream ?? null,
      bypassResult,
    },
  });
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "work") {
    relay = message.input?.egressRelay ?? null;
    void run();
  }
});
`;

function startUpstream() {
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push({ url: request.url, method: request.method });
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("upstream-ok");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        hits,
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function fetchUpstream(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: requestPath ?? "/v1" },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on("error", reject);
  });
}

// A hermetic stand-in for the provider/enforcer pair: it replays the mediated
// worker protocol and reports one kernel drop, so the runtime's config wiring
// can be asserted without Docker.
function createFakeSandbox({ allowHost = "api.allowed.test" } = {}) {
  const calls = [];
  const provider = {
    calls,
    async start(options) {
      calls.push(["start", options.name]);
      return {
        id: "cid-fake",
        name: options.name,
        attestation: {},
        egress: {
          internalNetwork: "n1",
          egressNetwork: "e1",
          brokerName: "b1",
          capture: { degraded: false },
        },
      };
    },
    async session({ onResponse }) {
      await onResponse({
        type: "egress",
        id: "e1",
        target: { host: allowHost, port: 443, scheme: "https", method: "GET", path: "/v1" },
      });
      await onResponse({
        type: "egress",
        id: "e2",
        target: {
          host: "evil.denied.test",
          port: 443,
          scheme: "https",
          method: "GET",
          path: "/v1",
        },
      });
      await onResponse({ type: "done", output: { fake: true } });
      return { responses: [], stderr: "", roundTrips: 0, heartbeats: 0, sustained: true };
    },
    async collectDrops({ broker, meta }) {
      broker.recordDrop({ targetHost: "203.0.113.7", targetPort: 443, ...meta });
      return { count: 1, drops: [], recorded: [], degraded: false, reason: null };
    },
    async stop({ id }) {
      calls.push(["stop", id]);
    },
  };
  const egressEnforcer = {
    async provision() {
      return {
        network: "n1",
        internalNetwork: "n1",
        egressNetwork: "e1",
        brokerId: "bid",
        brokerName: "b1",
      };
    },
    async provisionDropLogging() {
      return { capture: { degraded: false } };
    },
    async collectDrops() {
      return { count: 0, drops: [], degraded: false, reason: null };
    },
    async removeDropLogging() {
      return { removed: true };
    },
    async teardown() {},
  };
  return { provider, egressEnforcer, calls };
}

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

const adapterFor = async ({ skill, report, sandboxRuntime = null }) => {
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
    }),
  };
};

test(
  "T003: the configured default path mediates allow/deny egress and records drops",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const upstream = await startUpstream();
    // The caller supplies ONLY the runtime config; no per-request sandbox
    // executor, egress policy, ledger, forward transport, or worker source.
    const request = {
      parentRunId: PARENT_RUN,
      childRunId: "run-live-sandbox-child",
      invocationId: "invocation-live-sandbox",
      skill: "csm-scan",
    };
    for (const field of [
      "sandboxExecutor",
      "egressPolicy",
      "egressLedger",
      "egressForward",
      "workerSource",
    ])
      assert.equal(Object.hasOwn(request, field), false, `caller must not hand-supply ${field}`);
    const forwarded = [];
    const events = [];
    const config = {
      enabled: true,
      docker: "docker",
      workerSource: WORKER_SOURCE,
      policy: EGRESS_POLICY,
      ledgerKey: "t003-live-ledger-key-0123456789",
      credentials: {},
      egressRelay: true,
      requireDropCapture: true,
      dropCapturePoll: { attempts: 24, delayMs: 250 },
      forward: async ({ target }) => {
        forwarded.push({ host: target.host, port: target.port, path: target.path });
        return fetchUpstream(upstream.port, target.path);
      },
    };
    try {
      const runtime = createVerifiedSandboxRuntime(config);
      assert.equal(typeof runtime.invoke, "function");
      const result = await runtime.invoke({
        request,
        emitEgress: (event) => events.push(event),
      });
      assert.equal(result.status, "completed", JSON.stringify(result));
      // Allowlisted target reached upstream through the host listener only.
      assert.equal(result.output.allowedDecision, "allowed");
      assert.equal(result.output.allowedStatus, 200);
      assert.equal(result.output.allowedBody, "upstream-ok");
      assert.equal(forwarded.length, 1);
      assert.equal(forwarded[0].host, "api.allowed.test");
      assert.equal(upstream.hits.length, 1);
      assert.equal(upstream.hits[0].url, "/v1");
      // Unlisted target denied and never forwarded.
      assert.equal(result.output.deniedDecision, "denied");
      assert.equal(result.output.deniedReason, "default-deny");
      assert.equal(result.output.deniedUpstream, null);
      assert.equal(forwarded.length, 1);
      assert.equal(upstream.hits.length, 1);
      // Drops sourced from the network layer and recorded into the chain.
      assert.ok(result.egress, JSON.stringify(result));
      assert.equal(result.egress.verify.valid, true);
      const decisions = result.egress.records.map((record) => record.decision);
      assert.ok(decisions.includes("allowed"), JSON.stringify(decisions));
      assert.ok(decisions.includes("denied"), JSON.stringify(decisions));
      assert.ok(decisions.includes("dropped-unmediated"), JSON.stringify(decisions));
      const drop = result.egress.records.find((record) => record.decision === "dropped-unmediated");
      assert.equal(drop.targetHost, "203.0.113.7");
      assert.equal(drop.targetPort, 443);
      const egressEvents = events.filter((event) => event.eventType === "egress.decision");
      assert.ok(egressEvents.length >= 3, JSON.stringify(egressEvents));
    } finally {
      await upstream.close();
    }
  },
);

test(
  "T001: a live sandbox session re-attests on cadence and drift kills the worker",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const realProvider = createDockerWorkerProvider({ docker: "docker" });
    let inspectCalls = 0;
    let workerId = null;
    // A real Docker worker, but the re-attestation inspect is wrapped to
    // simulate post-start drift: the first cadence tick is healthy and every
    // later tick reports an unexpected host bind mount.
    const provider = {
      ...realProvider,
      async start(options) {
        const started = await realProvider.start(options);
        workerId = started.id;
        return started;
      },
      async inspect({ id }) {
        inspectCalls += 1;
        const snapshot = await realProvider.inspect({ id });
        if (inspectCalls > 1) return { ...snapshot, mounts: [{ type: "bind", bind: "/host:/x" }] };
        return snapshot;
      },
    };
    const runtime = createLiveVerifiedSandboxRuntime({
      provider,
      defaults: {
        workerSource: IDLE_WORKER_SOURCE,
        reattestationCadenceMs: 1000,
        sandboxExecutor: async ({ worker, provider: active, signal }) => {
          await active.session({
            id: worker.id,
            messages: [{ type: "work", input: {} }],
            signal,
            onResponse: () => undefined,
          });
          return { status: "completed" };
        },
      },
    });
    try {
      await assert.rejects(
        () =>
          runtime.invoke({
            request: {
              parentRunId: PARENT_RUN,
              childRunId: "run-reattest-child",
              invocationId: "invocation-reattest",
            },
          }),
        (error) => {
          assert.equal(error.code, "verified-sandbox-attestation-drift");
          assert.equal(error.reason, "attestation-drift");
          assert.ok(error.failed.includes("mountsEmpty"));
          return true;
        },
      );
      assert.ok(inspectCalls >= 2, "the monitor must re-attest on its cadence");
      let gone = false;
      for (let attempt = 0; attempt < 50 && !gone; attempt += 1) {
        if (spawnSync("docker", ["inspect", workerId]).status !== 0) gone = true;
        else await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(gone, true, "drift must kill the worker");
    } finally {
      if (workerId) spawnSync("docker", ["rm", "-f", workerId], { stdio: "ignore" });
    }
  },
);

test("T001: the live runtime consumes the sandbox policy cadence and drift fails closed", async () => {
  const policy = {
    ...SANDBOX_POLICY,
    attestation: { ...SANDBOX_POLICY.attestation, cadenceMs: 20 },
  };
  const healthy = {
    id: "cid-reattest",
    image: "sha256:abc",
    repoDigests: [SANDBOX_POLICY.image],
    mounts: [],
    rootFilesystem: "read-only",
    network: "none",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges:true"],
    env: [],
    pidsLimit: SANDBOX_POLICY.limits.pidsLimit,
    memory: SANDBOX_POLICY.limits.memoryBytes,
    init: true,
  };
  let inspectCalls = 0;
  let stopped = 0;
  let resolveStopped;
  const stoppedPromise = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const provider = {
    async start() {
      return { id: "cid-reattest", attestation: {}, egress: null };
    },
    async stop() {
      stopped += 1;
      resolveStopped();
    },
    async inspect() {
      inspectCalls += 1;
      if (inspectCalls > 1) return { ...healthy, mounts: [{ type: "bind", bind: "/host:/x" }] };
      return healthy;
    },
    async session() {
      await stoppedPromise;
      return { responses: [], stderr: "" };
    },
  };
  const runtime = createLiveVerifiedSandboxRuntime({
    provider,
    defaults: {
      workerSource: "export {};\n",
      sandboxPolicy: policy,
      sandboxExecutor: async ({ worker, provider: active }) => {
        await active.session({ id: worker.id });
        return { status: "completed" };
      },
    },
  });
  // The monitor interval is unref'd by design; hold the loop open so the
  // cadence can fire.
  const keepAlive = setTimeout(() => {}, 5000);
  await assert
    .rejects(
      () =>
        runtime.invoke({
          request: { parentRunId: PARENT_RUN, childRunId: "run-policy-cadence" },
        }),
      (error) => {
        assert.equal(error.code, "verified-sandbox-attestation-drift");
        return true;
      },
    )
    .finally(() => clearTimeout(keepAlive));
  assert.ok(inspectCalls >= 2, "the policy cadence must drive re-attestation");
  assert.ok(stopped >= 1, "drift must stop the worker");
});

test("T003: the in-process adapter accepts the config and routes through it", async () => {
  const { provider, egressEnforcer } = createFakeSandbox();
  const forwarded = [];
  const config = {
    enabled: true,
    provider,
    egressEnforcer,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    ledgerKey: "t003-hermetic-ledger-key-123456",
    requireDropCapture: false,
    dropCapturePoll: { attempts: 1 },
    forward: async ({ target }) => {
      forwarded.push(target.host);
      return { status: 200, body: "ok" };
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
    sandboxRuntime: config,
  });
  const result = await adapter.invoke(requestFor("csm-scan", "run-hermetic-sandbox"));
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(forwarded, ["api.allowed.test"]);
  assert.equal(result.egress.verify.valid, true);
  const decisions = result.egress.records.map((record) => record.decision);
  assert.deepEqual(decisions, ["allowed", "denied", "dropped-unmediated"]);
});

test("T003: disabled/absent config preserves fail-closed and trusted-in-process routes", async () => {
  assert.equal(resolveVerifiedSandboxRuntime(null), null);
  assert.equal(resolveVerifiedSandboxRuntime({ enabled: false }), null);

  const broken = resolveVerifiedSandboxRuntime({ enabled: true });
  assert.equal(typeof broken.invoke, "function");
  await assert.rejects(() => broken.invoke({ request: {} }), /could not be constructed/);

  const { adapter } = await adapterFor({
    skill: "csm-scan",
    report: {
      isolation: VERIFIED_SANDBOX,
      required: VERIFIED_SANDBOX,
      attestation: "required",
      selfProvided: false,
    },
    sandboxRuntime: { enabled: true },
  });
  const blocked = await adapter.invoke(requestFor("csm-scan", "run-broken-config"));
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.failure.code, "isolation-unavailable");

  const trusted = await adapterFor({
    skill: "csm-scan",
    report: { isolation: TRUSTED_IN_PROCESS, required: TRUSTED_IN_PROCESS },
    sandboxRuntime: { enabled: true },
  });
  const trustedResult = await trusted.adapter.invoke(requestFor("csm-scan", "run-trusted-config"));
  assert.equal(trustedResult.status, "completed", JSON.stringify(trustedResult));
  assert.equal(trustedResult.childReceipt.owner, "csm-scan");
});

test("T003: orchestrate builds and routes through a config-supplied sandbox runtime", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-live-sandbox-e2e-"));
  const { provider, egressEnforcer } = createFakeSandbox();
  const forwarded = [];
  try {
    const skill = "csm-scan";
    const binding = bindingFor(skill, completedHandler());
    const executorRegistry = await createSkillExecutorRegistry({ descriptors: [binding] });
    const runId = "run-live-sandbox-index";
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
    const result = await orchestrate({
      approach: {
        schema: "csm-approach/1",
        schemaRevision: 1,
        status: "agreed",
        runId,
        ideaSlug: "live-sandbox-e2e",
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
      verifiedSandboxRuntime: {
        enabled: true,
        provider,
        egressEnforcer,
        workerSource: "export {};\n",
        policy: EGRESS_POLICY,
        ledgerKey: "t003-index-ledger-key-123456789",
        requireDropCapture: false,
        dropCapturePoll: { attempts: 1 },
        forward: async ({ target }) => {
          forwarded.push(target.host);
          return { status: 200, body: "ok" };
        },
      },
      maxAttempts: 1,
    });
    assert.equal(adapterInvoked, false, "the node must not use the in-process adapter");
    assert.deepEqual(forwarded, ["api.allowed.test"]);
    assert.ok(result.receipt, "an authoritative receipt must still be produced");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T002: live terminal trust-anchor enforcement. After egress decisions/drops are
// recorded, the live path re-authorizes the egress final sink and the worker
// attestation under an accepted trust domain. A hermetic provider stands in for
// the Docker provider so the terminal path is exercised without Docker.
function createTrustSandbox({ hostExternal = false } = {}) {
  const reauthorizations = [];
  const provider = {
    reauthorizations,
    trustBoundary: () => ({
      trustDomain: hostExternal ? "external" : "os-user-bound",
      hostExternal,
      keyId: "host-key-1",
      anchorKeySource: hostExternal ? "external" : "in-process",
    }),
    async start(options) {
      return {
        id: "cid-trust",
        name: options.name,
        attestation: {},
        attestationDoc: {
          schema: "csm-orchestrate-worker-attestation/1",
          schemaRevision: 1,
          workerId: "worker-cid-trust",
          runId: PARENT_RUN,
          policyDigest: digest("p"),
          imageDigest: `sha256:${"c".repeat(64)}`,
          status: "verified",
          inspections: [{ at: "2026-09-13T00:00:00.000Z", controlResults: { mountsEmpty: true } }],
          anchor: {
            algorithm: "hmac-sha256",
            keyId: "host-key-1",
            headDigest: `sha256:${"d".repeat(64)}`,
            signedAt: "2026-09-13T00:00:00.000Z",
            external: true,
          },
        },
        egress: {
          internalNetwork: "n1",
          egressNetwork: "e1",
          brokerName: "b1",
          capture: { degraded: false },
        },
      };
    },
    async session({ onResponse }) {
      await onResponse({
        type: "egress",
        id: "e1",
        target: {
          host: "api.allowed.test",
          port: 443,
          scheme: "https",
          method: "GET",
          path: "/v1",
        },
      });
      await onResponse({ type: "done", output: { fake: true } });
      return { responses: [], stderr: "", roundTrips: 0, heartbeats: 0, sustained: true };
    },
    async collectDrops() {
      return { count: 0, drops: [], recorded: [], degraded: false, reason: null };
    },
    reauthorizeAttestation({ doc, requireHostExternal = true, acceptedTrustDomain = null }) {
      reauthorizations.push({ doc, requireHostExternal, acceptedTrustDomain });
      if (requireHostExternal && !hostExternal)
        return { authorized: false, reasonCode: "anchor-not-external-to-host", hostExternal };
      return { authorized: true, reasonCode: "anchored", hostExternal };
    },
    async stop() {},
  };
  return { provider, reauthorizations };
}

const trustRequest = (childRunId, invocationId) => ({
  parentRunId: PARENT_RUN,
  childRunId,
  invocationId,
});

test("T002: the live path re-authorizes the final sink and attestation under the recorded OS-user-bound domain", async () => {
  const { provider, reauthorizations } = createTrustSandbox();
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    forward: async () => ({ status: 200, body: "ok" }),
    dropCapturePoll: { attempts: 1 },
  });
  const result = await runtime.invoke({
    request: trustRequest("run-trust-default", "inv-trust-default"),
  });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.ok(result.trust, JSON.stringify(result));
  assert.equal(result.trust.domain, EGRESS_ANCHOR_TRUST_DOMAINS.osUser);
  assert.equal(result.trust.hostExternal, false);
  assert.equal(result.trust.authorized, true);
  assert.equal(result.trust.reason, "anchored");
  assert.equal(result.egress.verify.valid, true);
  assert.ok(result.egress.records.length > 0, "a non-empty chain must be finalized");
  assert.ok(result.trust.headDigest, "an accepted sink records the keyed head");
  assert.equal(reauthorizations.length, 1, "the live path must re-authorize the attestation");
  assert.equal(reauthorizations[0].requireHostExternal, false);
  assert.equal(
    reauthorizations[0].acceptedTrustDomain,
    EGRESS_ANCHOR_TRUST_DOMAINS.osUser,
    "the live path must pass the recorded trust domain to the attestation anchor",
  );
  assert.equal(result.trust.attestation.authorized, true);
  assert.equal(result.trust.attestation.domain, EGRESS_ANCHOR_TRUST_DOMAINS.osUser);
});

test("T002: a mismatched terminal anchor fails the live path closed", async () => {
  const { provider } = createTrustSandbox();
  const ledger = createEgressLedger({
    runId: "run-trust-mismatch",
    key: "t002-mismatch-key-0123456789",
    publishAnchor: () => {},
    readAnchor: () => `sha256:${"f".repeat(64)}`,
  });
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    ledgerFactory: () => ledger,
    forward: async () => ({ status: 200, body: "ok" }),
    dropCapturePoll: { attempts: 1 },
  });
  await assert.rejects(
    () => runtime.invoke({ request: trustRequest("run-trust-mismatch", "inv-trust-mismatch") }),
    (error) => {
      assert.equal(error.code, "verified-sandbox-trust-anchor");
      assert.equal(error.scope, "egress-final-sink");
      assert.equal(error.reason, "anchor-mismatch");
      return true;
    },
  );
});

test("T002: an unavailable terminal anchor fails the live path closed", async () => {
  const { provider } = createTrustSandbox();
  const ledger = createEgressLedger({
    runId: "run-trust-unavailable",
    key: "t002-unavailable-key-0123456",
    publishAnchor: () => {},
    readAnchor: () => {
      throw new Error("sink down");
    },
  });
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    ledgerFactory: () => ledger,
    forward: async () => ({ status: 200, body: "ok" }),
    dropCapturePoll: { attempts: 1 },
  });
  await assert.rejects(
    () =>
      runtime.invoke({ request: trustRequest("run-trust-unavailable", "inv-trust-unavailable") }),
    (error) => {
      assert.equal(error.code, "verified-sandbox-trust-anchor");
      assert.equal(error.reason, "anchor-unavailable");
      return true;
    },
  );
});

test("T002: a configured external anchor requires host-external authorization on the live path", async () => {
  const { provider, reauthorizations } = createTrustSandbox({ hostExternal: true });
  const published = [];
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    anchorTrustDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
    trustAnchor: createExternalAnchor({
      publish: (event) => published.push(event),
      read: () => published.at(-1)?.headDigest ?? null,
    }),
    forward: async () => ({ status: 200, body: "ok" }),
    dropCapturePoll: { attempts: 1 },
  });
  const result = await runtime.invoke({
    request: trustRequest("run-trust-external", "inv-trust-external"),
  });
  assert.equal(result.trust.domain, EGRESS_ANCHOR_TRUST_DOMAINS.external);
  assert.equal(result.trust.hostExternal, true);
  assert.equal(result.trust.authorized, true);
  assert.equal(result.trust.reason, "anchored");
  assert.equal(reauthorizations.length, 1);
  assert.equal(reauthorizations[0].requireHostExternal, true);
  assert.equal(
    reauthorizations[0].acceptedTrustDomain,
    EGRESS_ANCHOR_TRUST_DOMAINS.external,
    "a host-external anchor must be re-authorized under the external domain",
  );
  assert.equal(result.trust.attestation.authorized, true);
});

test("T002: a declared external domain without a host-external anchor fails closed", async () => {
  const { provider } = createTrustSandbox({ hostExternal: true });
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    provider,
    workerSource: "export {};\n",
    policy: EGRESS_POLICY,
    anchorTrustDomain: EGRESS_ANCHOR_TRUST_DOMAINS.external,
    forward: async () => ({ status: 200, body: "ok" }),
    dropCapturePoll: { attempts: 1 },
  });
  await assert.rejects(
    () => runtime.invoke({ request: trustRequest("run-trust-noanchor", "inv-trust-noanchor") }),
    (error) => {
      assert.equal(error.code, "verified-sandbox-trust-anchor");
      assert.equal(error.reason, "anchor-not-external-to-host");
      return true;
    },
  );
});
