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
import {
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
