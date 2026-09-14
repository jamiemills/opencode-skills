"use strict";

// T006: prototype decision gate over worker/egress behavior. It runs SIX
// decision conditions plus a per-property adversarial isolation matrix, each
// returning pass/fail with evidence, and (by default) persists one recorded
// artifact. The caller-owned `freshnessKind` distinguishes the deterministic
// checked-in baseline from a fresh runner-dependent observation, so a baseline
// is never rewritten non-deterministically by a test run. Probes are injectable,
// so the same gate runs hermetically (fake
// Docker transport + real pure decision logic) and optionally live under Docker
// (real provider + egress network enforcer) with no branch inside the gate.
//
// This module owns evidence only, never acceptance authority: a `fail` verdict
// names the failing condition and the caller decides what to do about it.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaRegistry } from "../../../lib/schema-runtime/index.mjs";
import {
  createEgressBroker,
  createEgressBrokerListener,
  createEgressLedger,
  evaluateEgress,
  verifyEgressChain,
} from "./egress-broker.mjs";
import {
  attestDockerWorker,
  buildWorkerAttestation,
  createDockerWorkerProvider,
  createReattestationMonitor,
  inspectionFromAttestation,
  verifyWorkerAttestation,
} from "./docker-worker-provider.mjs";
import { createEgressNetworkEnforcer } from "./egress-network.mjs";
import {
  ISOLATION_FAILURE_CODE,
  VERIFIED_SANDBOX,
  isolationRouting,
} from "./skill-executor-preflight.mjs";

export const DECISION_GATE_SCHEMA = "csm-orchestrate-decision-gate/1";
export const DECISION_GATE_SCHEMA_REVISION = 1;

export const ISOLATION_MATRIX_PROPERTIES = Object.freeze([
  "mounts",
  "readOnlyRootfs",
  "capDropAll",
  "noNewPrivileges",
  "networkIsolation",
  "credentialsNone",
  "reapingInit",
]);

export const DECISION_CONDITIONS = Object.freeze([
  {
    id: "C1",
    key: "isolation",
    title:
      "declared isolation is satisfied on effective trust (verified-sandbox routed to a real provider, or fail closed)",
  },
  {
    id: "C2",
    key: "attestation",
    title: "sandbox attestation is schema-valid and keyed/content-bound",
  },
  {
    id: "C3",
    key: "egressDefaultDeny",
    title: "egress is default-deny (unlisted target denied by evaluateEgress)",
  },
  {
    id: "C4",
    key: "egressChain",
    title: "every mediated attempt yields a chain-valid immutable record (verifyEgressChain)",
  },
  {
    id: "C5",
    key: "credentialsOpaque",
    title: "credentials never cross as plaintext (only opaque credentialRef)",
  },
  {
    id: "C6",
    key: "failClosed",
    title:
      "fail-closed on drift/unavailable (unsatisfiable isolation, capture-required-but-degraded, attach failure)",
  },
]);

const DEFAULT_EVIDENCE_PATH = fileURLToPath(
  new URL("../../.agents/evidence/dynamic-worker-runtime/decision-gate.json", import.meta.url),
);

const ANCHOR_KEY = Buffer.from("decision-gate-anchor-key-0123456789");
const GATE_KEY = "0123456789abcdef";
const SECRET = "super-secret-gate-token";
const RUN_ID = "run-decision-gate";
const IMAGE_DIGEST = `sha256:${"c".repeat(64)}`;

const controlOf = Object.freeze({
  mounts: "mountsEmpty",
  readOnlyRootfs: "rootFilesystemReadOnly",
  capDropAll: "capDropAll",
  noNewPrivileges: "noNewPrivileges",
  networkIsolation: "networkIsolated",
  credentialsNone: "credentialsNone",
  reapingInit: "reapingInit",
});

// An inspect snapshot that satisfies every frozen control, with per-property
// overrides used to manufacture adversarial drift.
export function healthyInspect(overrides = {}) {
  return {
    id: "cid-gate",
    image: IMAGE_DIGEST,
    repoDigests: [`node:22@${IMAGE_DIGEST}`],
    mounts: [],
    rootFilesystem: "read-only",
    network: "none",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges:true"],
    env: [],
    pidsLimit: 512,
    memory: 2147483648,
    init: true,
    ...overrides,
  };
}

function gatePolicy() {
  return {
    defaultAction: "deny",
    failMode: "blocked",
    entries: [{ host: "api.example.com", port: 443, scheme: "https" }],
    credentialInjections: [
      { host: "api.example.com", header: "Authorization", credentialRef: "credref-gate-1" },
    ],
  };
}

const ALLOWED_TARGET = { host: "api.example.com", port: 443, scheme: "https", method: "GET" };

const verifiedSandboxReport = () => ({
  isolation: VERIFIED_SANDBOX,
  required: VERIFIED_SANDBOX,
  selfProvided: false,
});

// Raw docker-inspect JSON (the shape parseInspect reads), as opposed to the
// parsed attestation shape `healthyInspect` returns.
function rawInspect({ network = "none" } = {}) {
  return {
    Id: "cid-gate",
    Image: IMAGE_DIGEST,
    RepoDigests: [`node:22@${IMAGE_DIGEST}`],
    Mounts: [],
    HostConfig: {
      ReadonlyRootfs: true,
      NetworkMode: network,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Env: [],
      PidsLimit: 512,
      Memory: 2147483648,
      Init: true,
      Mounts: [],
      Binds: [],
    },
  };
}

function fakeProviderRun({ network = "none" } = {}) {
  const calls = [];
  return {
    calls,
    run: async (_docker, args) => {
      calls.push(args.join(" "));
      if (args[0] === "create") return { code: 0, stdout: "cid-gate\n", stderr: "" };
      if (args[0] === "inspect")
        return { code: 0, stdout: JSON.stringify([rawInspect({ network })]), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

// Fail-closed enforcer transport: the first network connect (dual-homing the
// broker) succeeds, the second (attaching the worker) fails.
function attachFailRun() {
  let connects = 0;
  return async (_docker, args) => {
    if (args[0] === "network" && args[1] === "create") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "run") return { code: 0, stdout: "bid\n", stderr: "" };
    if (args[0] === "network" && args[1] === "connect") {
      connects += 1;
      return connects === 1
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "no such container" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
}

async function probeIsolation({ provider = null } = {}) {
  const capability = { execution: { isolation: VERIFIED_SANDBOX, attestation: "required" } };
  const routed = isolationRouting({
    adapter: { effectiveIsolation: verifiedSandboxReport },
    request: { skill: "csm-scan" },
    capability,
    runtimeInvocable: true,
  });
  const refused = isolationRouting({
    adapter: { effectiveIsolation: verifiedSandboxReport },
    request: { skill: "csm-scan" },
    capability,
    runtimeInvocable: false,
  });
  const active =
    provider ?? createDockerWorkerProvider({ run: fakeProviderRun().run, anchorKey: ANCHOR_KEY });
  let started = null;
  try {
    started = await active.start({ name: "csm-gate-worker", workerSource: "export {};\n" });
  } finally {
    if (started?.id) await active.stop({ id: started.id });
  }
  const dispatched = routed.action === "sandbox";
  const closed =
    refused.action === "blocked" && refused.failure?.failure?.code === ISOLATION_FAILURE_CODE;
  const providerStarted = Boolean(started?.id);
  const controlsHeld =
    started?.attestation &&
    ISOLATION_MATRIX_PROPERTIES.every(
      (property) => started.attestation[controlOf[property]] === true,
    );
  return {
    pass: dispatched && closed && providerStarted && controlsHeld === true,
    evidence: {
      routed: routed.action,
      refused: refused.action,
      refusalCode: refused.failure?.failure?.code ?? null,
      providerStarted,
      providerControlsHeld: controlsHeld === true,
    },
  };
}

async function probeAttestation({ attestationDoc = null } = {}) {
  let doc = attestationDoc;
  let source = "built";
  if (!doc) {
    const att = attestDockerWorker(healthyInspect(), {
      expectedImageDigest: IMAGE_DIGEST,
      expectedMemory: 2147483648,
      expectedPids: 512,
    });
    doc = buildWorkerAttestation({
      workerId: "worker-cid-gate",
      runId: RUN_ID,
      policyDigest: `sha256:${"d".repeat(64)}`,
      imageDigest: IMAGE_DIGEST,
      inspections: [inspectionFromAttestation(att, "2026-09-13T00:00:00.000Z")],
      anchorKey: ANCHOR_KEY,
      keyId: "host-key-1",
      now: () => "2026-09-13T00:00:00.000Z",
    });
  } else {
    source = "worker";
  }
  const registry = await loadSchemaRegistry();
  const schema = registry.validate("csm-orchestrate-worker-attestation/1", doc);
  const bound = verifyWorkerAttestation({ doc, anchorKey: ANCHOR_KEY }) === true;
  const tampered = structuredClone(doc);
  tampered.inspections[0].controlResults.networkIsolated = false;
  const tamperRejected =
    verifyWorkerAttestation({ doc: tampered, anchorKey: ANCHOR_KEY }) === false;
  const wrongKeyRejected =
    verifyWorkerAttestation({ doc, anchorKey: Buffer.from("wrong-anchor-key") }) === false;
  return {
    pass: schema.valid === true && bound && tamperRejected && wrongKeyRejected,
    evidence: {
      source,
      schemaValid: schema.valid === true,
      schemaErrors: schema.valid ? [] : schema.errors,
      contentBound: bound,
      tamperRejected,
      wrongKeyRejected,
    },
  };
}

async function probeIsolationMatrix({ inspect = null } = {}) {
  const base = inspect ?? healthyInspect();
  const healthy = attestDockerWorker(base);
  const mutations = {
    mounts: { mounts: [{ type: "bind", bind: "/host:/x" }] },
    readOnlyRootfs: { rootFilesystem: "writable" },
    capDropAll: { capDrop: [] },
    noNewPrivileges: { securityOpt: [] },
    networkIsolation: { network: "bridge" },
    credentialsNone: { env: ["AWS_SECRET_ACCESS_KEY=leak"] },
    reapingInit: { init: false },
  };
  const properties = {};
  const evidence = {};
  for (const property of ISOLATION_MATRIX_PROPERTIES) {
    const control = controlOf[property];
    const enforced = healthy[control] === true;
    const detected = attestDockerWorker({ ...base, ...mutations[property] })[control] === false;
    properties[property] = enforced && detected;
    evidence[property] = { control, enforced, detectsViolation: detected };
  }
  return {
    pass: Object.values(properties).every((value) => value === true),
    properties,
    evidence,
  };
}

async function probeEgressDefaultDeny() {
  const policy = gatePolicy();
  const allowed = evaluateEgress(policy, ALLOWED_TARGET);
  const unlisted = evaluateEgress(policy, { host: "evil.example.com", port: 443, scheme: "https" });
  const wrongPort = evaluateEgress(policy, { host: "api.example.com", port: 80 });
  return {
    pass:
      allowed.decision === "allowed" &&
      unlisted.decision === "denied" &&
      unlisted.reasonCode === "default-deny" &&
      wrongPort.decision === "denied",
    evidence: { allowed, unlisted, wrongPort },
  };
}

async function probeEgressChain() {
  const ledger = createEgressLedger({ runId: RUN_ID, key: GATE_KEY });
  const broker = createEgressBroker({
    policy: gatePolicy(),
    ledger,
    credentials: { "credref-gate-1": SECRET },
  });
  const allow = broker.decide(ALLOWED_TARGET, {});
  broker.record(allow, ALLOWED_TARGET, {});
  const deniedTarget = { host: "evil.example.com", port: 443 };
  broker.record(broker.decide(deniedTarget, {}), deniedTarget, {});
  broker.recordDrop({ targetHost: "203.0.113.9", targetPort: 443 });
  const chain = ledger.records();
  const verified = verifyEgressChain(chain, GATE_KEY);
  const tampered = structuredClone(chain);
  tampered[0].decision = "denied";
  const tamperRejected = verifyEgressChain(tampered, GATE_KEY).valid === false;
  const reordered = [chain[1], chain[0], chain[2]];
  const reorderRejected = verifyEgressChain(reordered, GATE_KEY).valid === false;
  return {
    pass: chain.length === 3 && verified.valid === true && tamperRejected && reorderRejected,
    evidence: {
      records: chain.length,
      decisions: chain.map((record) => record.decision),
      chainValid: verified.valid === true,
      tamperRejected,
      reorderRejected,
    },
  };
}

async function probeCredentialsOpaque() {
  const ledger = createEgressLedger({ runId: RUN_ID, key: GATE_KEY });
  const broker = createEgressBroker({
    policy: gatePolicy(),
    ledger,
    credentials: { "credref-gate-1": SECRET },
  });
  const forwarded = [];
  const listener = createEgressBrokerListener({
    broker,
    forward: async (request) => {
      forwarded.push(request);
      return { status: 200 };
    },
  });
  const allowed = await listener.handle({ target: ALLOWED_TARGET, headers: {} }, {});
  const denied = await listener.handle(
    { target: { host: "evil.example.com", port: 443 }, headers: {} },
    {},
  );
  const injected = forwarded[0]?.headers?.Authorization === SECRET;
  const allowedWire = JSON.stringify(allowed);
  const deniedWire = JSON.stringify(denied);
  const ledgerWire = JSON.stringify(ledger.records());
  const opaqueRef = allowed.record?.credentialRef === "credref-gate-1";
  return {
    pass:
      injected &&
      !allowedWire.includes(SECRET) &&
      !deniedWire.includes(SECRET) &&
      !ledgerWire.includes(SECRET) &&
      opaqueRef,
    evidence: {
      injectedUpstream: injected,
      allowedDecision: allowed.decision,
      deniedDecision: denied.decision,
      listenerLeakedSecret: allowedWire.includes(SECRET) || deniedWire.includes(SECRET),
      ledgerLeakedSecret: ledgerWire.includes(SECRET),
      recordedRef: allowed.record?.credentialRef ?? null,
    },
  };
}

async function probeFailClosed() {
  // (a) unsatisfiable isolation is refused, never silently downgraded.
  const unsat = isolationRouting({
    adapter: {
      effectiveIsolation: () => ({
        isolation: VERIFIED_SANDBOX,
        required: VERIFIED_SANDBOX,
        selfProvided: false,
        satisfiable: false,
        reason: "docker-unavailable",
      }),
    },
    request: { skill: "csm-scan" },
    capability: { execution: { isolation: VERIFIED_SANDBOX } },
    runtimeInvocable: true,
  });
  const unsatisfiableClosed =
    unsat.action === "blocked" && unsat.failure?.failure?.code === ISOLATION_FAILURE_CODE;

  // (b) capture-required-but-degraded fails the start, not the audit.
  const degradedProvider = createDockerWorkerProvider({
    run: fakeProviderRun({ network: "csm-internal-1" }).run,
    anchorKey: ANCHOR_KEY,
    egressEnforcer: {
      async provision() {
        return {
          network: "csm-internal-1",
          internalNetwork: "csm-internal-1",
          egressNetwork: "csm-egress-1",
          brokerName: "b1",
        };
      },
      async provisionDropLogging() {
        throw new Error("iptables-unavailable");
      },
      async teardown() {},
    },
  });
  let captureClosed = false;
  try {
    await degradedProvider.start({
      name: "w-capture",
      workerSource: "export {};\n",
      egress: { brokerScript: "setInterval(() => {}, 1e9)", requireDropCapture: true },
    });
  } catch {
    captureClosed = true;
  }

  // (c) a failed worker attach tears the network/broker down and throws.
  const enforcer = createEgressNetworkEnforcer({ run: attachFailRun() });
  let attachClosed = false;
  try {
    await enforcer.provision({ brokerScript: "setInterval(() => {}, 1e9)" });
    await enforcer.attachWorker({ network: "csm-internal-x", workerId: "missing" });
  } catch {
    attachClosed = true;
  }

  // (d) re-attestation drift kills the worker and is terminal.
  const observations = [
    healthyInspect(),
    healthyInspect({ mounts: [{ type: "bind", bind: "/host:/x" }] }),
  ];
  let index = 0;
  let killed = 0;
  const monitor = createReattestationMonitor({
    inspect: async () => observations[Math.min(index++, observations.length - 1)],
    stop: async () => {
      killed += 1;
    },
    cadenceMs: 60_000,
  });
  const first = await monitor.tick();
  const second = await monitor.tick();
  const driftClosed = first.drift === false && second.drift === true && killed === 1;

  return {
    pass: unsatisfiableClosed && captureClosed && attachClosed && driftClosed,
    evidence: {
      unsatisfiableClosed,
      captureRequiredDegradedClosed: captureClosed,
      attachFailureClosed: attachClosed,
      driftClosed,
    },
  };
}

// Hermetic probes: real decision logic and the real provider/egress modules with
// an injected Docker transport. Deterministic and Docker-free.
export function createHermeticProbes() {
  return Object.freeze({
    mode: "hermetic",
    isolation: () => probeIsolation(),
    attestation: () => probeAttestation(),
    egressDefaultDeny: () => probeEgressDefaultDeny(),
    egressChain: () => probeEgressChain(),
    credentialsOpaque: () => probeCredentialsOpaque(),
    failClosed: () => probeFailClosed(),
    isolationMatrix: () => probeIsolationMatrix(),
  });
}

// Live probes: the same gate over a real Docker worker (conditions C1/C2 and the
// isolation matrix) and the real egress network enforcer (attach-failure).
// Pure egress conditions keep their real module implementations.
export function createLiveProbes({ docker = "docker" } = {}) {
  const provider = createDockerWorkerProvider({ docker, anchorKey: ANCHOR_KEY });
  let started = null;
  const ensureWorker = async () => {
    if (!started)
      started = await provider.start({
        name: `csm-gate-${Date.now()}`,
        workerSource: "export {};\n",
      });
    return started;
  };
  const enforcer = createEgressNetworkEnforcer({ docker });
  const liveAttachFailure = async () => {
    try {
      const provisioned = await enforcer.provision({
        brokerScript: "setInterval(() => {}, 1e9)",
      });
      // A failed worker attach must tear down the provisioned network/broker.
      await enforcer.attachWorker({ network: provisioned.network, workerId: "missing" });
      return false;
    } catch {
      return true;
    }
  };
  return Object.freeze({
    mode: "live",
    isolation: () => probeIsolation({ provider }),
    attestation: async () =>
      probeAttestation({ attestationDoc: (await ensureWorker()).attestationDoc }),
    egressDefaultDeny: () => probeEgressDefaultDeny(),
    egressChain: () => probeEgressChain(),
    credentialsOpaque: () => probeCredentialsOpaque(),
    failClosed: async () => {
      const hermetic = await probeFailClosed();
      const attachFailureClosed = await liveAttachFailure();
      return {
        pass: hermetic.pass && attachFailureClosed,
        evidence: { ...hermetic.evidence, liveAttachFailureClosed: attachFailureClosed },
      };
    },
    isolationMatrix: async () => {
      const worker = await ensureWorker();
      const base = healthyInspect({ network: "none" });
      const hermetic = await probeIsolationMatrix({ inspect: base });
      const liveControlsHeld = ISOLATION_MATRIX_PROPERTIES.every(
        (property) => worker.attestation[controlOf[property]] === true,
      );
      return {
        pass: hermetic.pass && liveControlsHeld,
        properties: hermetic.properties,
        evidence: {
          ...hermetic.evidence,
          liveControlsHeld,
          liveImageDigest: worker.attestation.imageDigest,
        },
      };
    },
    cleanup: async () => {
      if (started?.id) {
        const id = started.id;
        started = null;
        await provider.stop({ id });
      }
    },
  });
}

function summarizeOutcome(outcome) {
  if (outcome === null || outcome === undefined) return { error: "probe-returned-nothing" };
  if (typeof outcome !== "object") return { error: `probe-returned-${typeof outcome}` };
  if (outcome.evidence !== undefined) return outcome.evidence;
  const { pass: _pass, ...rest } = outcome;
  return rest;
}

export async function runDecisionGate({
  probes = null,
  now = () => new Date().toISOString(),
  evidencePath = DEFAULT_EVIDENCE_PATH,
  persist = true,
  freshnessKind = "observed",
} = {}) {
  const active = probes ?? createHermeticProbes();
  const generatedAt = now();
  const mode = active.mode ?? "injected";
  const conditions = [];
  try {
    for (const condition of DECISION_CONDITIONS) {
      const probe = active[condition.key];
      let outcome;
      if (typeof probe !== "function") {
        outcome = { pass: false, evidence: { error: "probe-missing" } };
      } else {
        try {
          outcome = await probe();
        } catch (error) {
          outcome = { pass: false, evidence: { error: String(error?.message ?? error) } };
        }
      }
      conditions.push({
        id: condition.id,
        title: condition.title,
        status: outcome?.pass === true ? "pass" : "fail",
        evidence: summarizeOutcome(outcome),
      });
    }

    let matrixOutcome;
    try {
      matrixOutcome =
        typeof active.isolationMatrix === "function"
          ? await active.isolationMatrix()
          : { pass: false, evidence: { error: "probe-missing" } };
    } catch (error) {
      matrixOutcome = { pass: false, evidence: { error: String(error?.message ?? error) } };
    }
    const matrixProperties = {};
    for (const property of ISOLATION_MATRIX_PROPERTIES)
      matrixProperties[property] = matrixOutcome?.properties?.[property] === true ? "pass" : "fail";
    const isolationMatrix = {
      status: matrixOutcome?.pass === true ? "pass" : "fail",
      properties: matrixProperties,
      evidence: summarizeOutcome(matrixOutcome),
    };

    const failedConditions = conditions
      .filter((condition) => condition.status !== "pass")
      .map((condition) => condition.id);
    if (isolationMatrix.status !== "pass") failedConditions.push("MATRIX");

    const artifact = {
      schema: DECISION_GATE_SCHEMA,
      schemaRevision: DECISION_GATE_SCHEMA_REVISION,
      generatedAt,
      mode,
      // Explicit freshness marker: `kind` is "baseline" only for the
      // deterministic checked-in artifact, so a recorded baseline can never be
      // mistaken for a fresh, runner-dependent observation.
      freshness: { kind: freshnessKind, mode, generatedAt },
      conditions,
      isolationMatrix,
      verdict: failedConditions.length === 0 ? "pass" : "fail",
      failedConditions,
    };

    if (persist !== false && typeof evidencePath === "string" && evidencePath.length > 0) {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`);
      artifact.artifactPath = evidencePath;
    }
    return artifact;
  } finally {
    if (typeof active.cleanup === "function") await active.cleanup();
  }
}
