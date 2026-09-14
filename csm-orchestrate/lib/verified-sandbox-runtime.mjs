"use strict";

import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import {
  createDockerWorkerProvider,
  createReattestationMonitor,
} from "./docker-worker-provider.mjs";
import {
  RELAY_LISTEN_PORT,
  createEgressNetworkEnforcer,
  discoverHostGateway,
  generateRelayBrokerScript,
} from "./egress-network.mjs";
import {
  EGRESS_ANCHOR_TRUST_DOMAINS,
  EgressPolicyError,
  createEgressBroker,
  createEgressBrokerListener,
  createEgressBrokerRelayServer,
  createEgressLedger,
} from "./egress-broker.mjs";
import { VERIFIED_SANDBOX } from "./skill-executor-preflight.mjs";
import { digest } from "../../lib/schema-runtime/index.mjs";

// T003: configuration-driven verified-sandbox runtime. A caller enables one
// runtime (via `orchestrate({ verifiedSandboxRuntime: config })` or
// `createInProcessExecutorAdapter({ sandboxRuntime: config })`) and the runtime
// constructs the Docker worker provider + egress network enforcer + host-side
// broker listener and supplies the `sandboxExecutor`/`egressPolicy`/
// `egressLedger`/`egressForward` plumbing that callers previously hand-passed
// per request.
//
// Egress mediation stays host-side: the sandboxed worker has no route (its
// default route is a blackhole device) and asks the host, over the sustained
// worker session, to reach a target. The host applies `createEgressBroker`
// policy, injects credentials only on allow, forwards through the configured
// transport, and records every decision (including kernel-dropped direct
// attempts) in the keyed ledger. A worker that ignores the mediation protocol
// and dials directly is kernel-dropped and captured by the NFLOG probe.
//
// The broker container provisioned by the enforcer is the worker's only network
// peer. When `egressRelay` is enabled the runtime generates a relay broker
// script: the worker dials the broker's internal address, the broker pipes the
// bytes to a host-side relay server bound on the default-bridge gateway, and
// only that server applies policy, injects credentials, and records decisions.
// The worker (internal-only, blackhole default route) cannot reach the gateway,
// so an unmediated dial is still kernel-dropped and captured by the NFLOG probe.
// This runtime is fail-closed: an enabled config missing its egress
// policy/ledger or a provider/broker that cannot start raises, and the caller's
// gate turns that into a typed `isolation-unavailable` refusal.

// The broker container's default job is to be the internal network's peer and to
// host the drop-probe netns; mediated egress is decided host-side. It serves
// nothing, so an unmediated worker gets no usable upstream. When N5 relay mode
// is enabled the runtime replaces this with a generated relay script.
const DEFAULT_BROKER_SCRIPT = 'require("net").createServer(() => {}).listen(0, "0.0.0.0")';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// T001 (AC6): a long-lived live worker is attested once at start; the runtime
// must keep re-observing the frozen controls on the cadence the sandbox policy
// declares. The default keeps a policy-less invocation under periodic
// attestation rather than silently skipping it.
export const DEFAULT_REATTESTATION_CADENCE_MS = 60_000;

export function resolveReattestationCadenceMs(policy, fallback = null) {
  const cadence = policy?.attestation?.cadenceMs;
  if (Number.isInteger(cadence) && cadence > 0) return cadence;
  return Number.isInteger(fallback) && fallback > 0 ? fallback : DEFAULT_REATTESTATION_CADENCE_MS;
}

// T001 (AC6): mirror the expectations `provider.start` attested against so a
// re-attestation snapshot compares like-for-like. With no policy the network
// check falls back to `none` and the image pin is not required.
export function reattestationExpectations(policy, started) {
  if (!policy) return {};
  const imageRef = policy.image;
  const expectedImageDigest =
    typeof imageRef === "string" && imageRef.includes("@")
      ? imageRef.slice(imageRef.indexOf("@") + 1)
      : null;
  const limits = policy.limits ?? {};
  return {
    expectedImageDigest,
    expectedMemory: limits.memoryBytes ?? null,
    expectedPids: limits.pidsLimit ?? null,
    expectedNetwork: started?.egress?.internalNetwork ?? null,
  };
}

// T001 (AC6): turn a drift snapshot into the typed, terminal failure the live
// runtime surfaces after the monitor has already killed the worker.
export function reattestationFailure(snapshot) {
  if (!snapshot || snapshot.drift !== true) return null;
  const reason = snapshot.failed?.includes("inspect-error") ? "inspect-error" : "attestation-drift";
  return Object.assign(
    new Error(
      `verified-sandbox worker re-attestation failed (${reason}): ${(snapshot.failed ?? []).join(", ")}`,
    ),
    {
      code: "verified-sandbox-attestation-drift",
      reason,
      failed: snapshot.failed ?? [],
      at: snapshot.at ?? null,
    },
  );
}

// T002: resolve the trust domain a terminal sink may be accepted under. A
// declared `external` domain, or any supplied host-external anchor (ledger or
// worker provider), forces `external` and therefore a host-external
// re-authorization; otherwise the recorded g3-ruling boundary `os-user-bound`
// is the accepted domain. The result is explicit and observable, never a silent
// downgrade.
export function resolveAcceptedTrustDomain({
  declared = null,
  ledgerBoundary = null,
  providerBoundary = null,
} = {}) {
  if (declared !== null && declared !== undefined) {
    if (
      declared !== EGRESS_ANCHOR_TRUST_DOMAINS.osUser &&
      declared !== EGRESS_ANCHOR_TRUST_DOMAINS.external
    )
      throw Object.assign(
        new TypeError(
          `unsupported anchor trust domain: ${String(declared)} (expected ${EGRESS_ANCHOR_TRUST_DOMAINS.osUser} or ${EGRESS_ANCHOR_TRUST_DOMAINS.external})`,
        ),
        { code: "verified-sandbox-trust-domain" },
      );
  }
  if (
    declared === EGRESS_ANCHOR_TRUST_DOMAINS.external ||
    ledgerBoundary?.hostExternal === true ||
    providerBoundary?.hostExternal === true
  )
    return EGRESS_ANCHOR_TRUST_DOMAINS.external;
  return declared ?? EGRESS_ANCHOR_TRUST_DOMAINS.osUser;
}

// T002: typed terminal failure when the live path cannot re-authorize a sink.
export function trustAnchorFailure(trust, scope) {
  const reason =
    scope === "worker-attestation" ? (trust.attestation?.reason ?? null) : (trust.reason ?? null);
  return Object.assign(
    new Error(
      `verified-sandbox trust anchor re-authorization failed (${scope}): ${String(reason)}`,
    ),
    {
      code: "verified-sandbox-trust-anchor",
      scope,
      reason,
      domain: trust.domain,
      trust,
    },
  );
}

// T002: the live terminal trust gate. After the worker's egress decisions and
// drops are recorded and before the runtime returns, re-authorize the egress
// chain's final sink (`ledger.authorizeFinalSink`) and the worker attestation
// (`provider.reauthorizeAttestation`) under the accepted trust domain. Fail
// closed (typed error) on any unavailability or mismatch; an accepted
// OS-user-bound sink is recorded, not silent.
export function enforceTerminalTrust({
  ledger = null,
  provider = null,
  started = null,
  declaredDomain = null,
  at = null,
} = {}) {
  const ledgerBoundary =
    ledger && typeof ledger.trustBoundary === "function" ? ledger.trustBoundary() : null;
  const providerBoundary =
    provider && typeof provider.trustBoundary === "function" ? provider.trustBoundary() : null;
  const domain = resolveAcceptedTrustDomain({
    declared: declaredDomain,
    ledgerBoundary,
    providerBoundary,
  });
  const requireHostExternal = domain === EGRESS_ANCHOR_TRUST_DOMAINS.external;
  const trust = {
    domain,
    hostExternal: ledgerBoundary?.hostExternal === true || providerBoundary?.hostExternal === true,
    authorized: true,
    reason: "no-egress-decisions",
    sink: "egress-chain-terminal",
    attestation: null,
  };
  // Re-authorize the egress chain only when it actually finalized decisions; an
  // empty chain has no sink to authorize. A configured-but-broken/mismatched
  // anchor always fails closed.
  if (
    ledger &&
    typeof ledger.authorizeFinalSink === "function" &&
    typeof ledger.length === "function" &&
    ledger.length() > 0
  ) {
    const finalSink = ledger.authorizeFinalSink({
      acceptedTrustDomain: domain,
      requireHostExternal,
      sink: trust.sink,
      at,
    });
    trust.authorized = finalSink.authorized === true;
    trust.reason = finalSink.reasonCode ?? null;
    trust.headDigest = finalSink.headDigest ?? null;
    trust.anchor = finalSink.anchor ?? ledgerBoundary;
    if (!finalSink.authorized) throw trustAnchorFailure(trust, "egress-final-sink");
  }
  // Re-authorize the worker attestation under the same accepted domain whenever
  // the provider returns a keyed attestation document.
  if (started?.attestationDoc && typeof provider?.reauthorizeAttestation === "function") {
    const reauthorized = provider.reauthorizeAttestation({
      doc: started.attestationDoc,
      requireHostExternal,
      acceptedTrustDomain: domain,
    });
    trust.attestation = {
      authorized: reauthorized.authorized === true,
      reason: reauthorized.reasonCode ?? null,
      hostExternal: reauthorized.hostExternal === true,
      domain,
    };
    if (!reauthorized.authorized) throw trustAnchorFailure(trust, "worker-attestation");
  }
  return trust;
}

// N2: safe defaults so a caller only has to enable the runtime and supply the
// (app-specific) worker source/executor. The default egress policy denies
// everything — mediation stays fail-closed until a caller supplies an allowlist.
export function defaultEgressPolicy() {
  return Object.freeze({
    schema: "csm-orchestrate-egress-policy/1",
    schemaRevision: 1,
    defaultAction: "deny",
    failMode: "blocked",
    entries: [],
    credentialInjections: [],
  });
}

// N2: default outbound transport for HTTP(S) targets. Credentials are injected
// by the listener (never here); this only performs the request. A caller with a
// non-HTTP upstream still injects its own `forward`.
export function createHttpForward({ timeoutMs = null } = {}) {
  return function httpForward({ target = {}, method = "GET", headers = {}, body = null, signal }) {
    const scheme = String(target.scheme ?? "https").toLowerCase();
    const transport = scheme === "http" ? http : https;
    const host = target.host;
    const port = target.port ?? (scheme === "http" ? 80 : 443);
    if (typeof host !== "string" || host.length === 0)
      throw new TypeError("egress forward requires a target host");
    const path = target.path ?? "/";
    return new Promise((resolve, reject) => {
      const req = transport.request({ host, port, method, path, headers, signal }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });
      req.on("error", reject);
      if (timeoutMs)
        req.setTimeout(timeoutMs, () => req.destroy(new Error("egress forward timeout")));
      if (body !== null && body !== undefined) req.write(body);
      req.end();
    });
  };
}

// T003: source per-drop facts, retrying so asynchronous NFLOG delivery is not
// mistaken for "no drops". The provider's collectDrops is already lossless
// across batches; this only polls until the first drop is observed.
async function collectDropsWithRetry(provider, options, poll = null) {
  const attempts = Number.isInteger(poll?.attempts) && poll.attempts > 0 ? poll.attempts : 1;
  const delayMs = Number.isFinite(poll?.delayMs) && poll.delayMs >= 0 ? poll.delayMs : 0;
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await provider.collectDrops(options);
    if (Number.isInteger(last?.count) && last.count > 0) return last;
    if (attempt < attempts - 1 && delayMs > 0) await delay(delayMs);
  }
  return last;
}

// T003: the default in-sandbox executor. It owns the mediated worker protocol.
// With N5 relay mode the worker is handed `input.egressRelay` (the broker's
// internal address + the relay port) and dials the broker container for every
// mediated request; the broker relays to the host-side listener. The session
// still carries the work item and `{type:"done"}`, and the legacy
// `{type:"egress", ...}` session path remains supported for callers that did
// not enable the relay. A caller may inject `sandboxExecutor` for another
// contract.
export function createDefaultSandboxExecutor() {
  return async function defaultSandboxExecutor({
    request = {},
    worker = null,
    provider = null,
    listener = null,
    relay = null,
    signal = null,
  } = {}) {
    if (!listener || typeof listener.handle !== "function")
      throw new TypeError("verified-sandbox default executor requires a broker listener");
    if (!provider || typeof provider.session !== "function")
      throw new TypeError("verified-sandbox default executor requires a provider session");
    const decisions = [];
    let output = null;
    const meta = {
      runId: request.parentRunId ?? null,
      workerId: worker?.id ? `worker-${worker.id}` : null,
      invocationId: request.invocationId ?? null,
      attempt: request.retry?.attempt ?? 0,
      taskId: request.taskId ?? null,
    };
    const relayTarget =
      relay && worker?.egress?.brokerName
        ? { host: worker.egress.brokerName, port: RELAY_LISTEN_PORT }
        : null;
    const input = { ...request.input };
    if (relayTarget) input.egressRelay = relayTarget;
    await provider.session({
      id: worker.id,
      messages: [{ type: "work", input }],
      signal,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      onResponse: async (message) => {
        if (message?.type === "done") {
          output = message.output ?? null;
          return null;
        }
        if (message?.type === "egress") {
          const handled = await listener.handle(
            {
              target: message.target,
              headers: message.headers ?? {},
              body: message.body ?? null,
            },
            meta,
          );
          decisions.push({
            id: message.id ?? null,
            decision: handled.decision,
            reasonCode: handled.reasonCode ?? null,
          });
          return {
            type: "egress.result",
            id: message.id ?? null,
            decision: handled.decision,
            reasonCode: handled.reasonCode ?? null,
            upstream: handled.upstream ?? null,
          };
        }
        return null;
      },
    });
    return { status: "completed", output, egress: { decisions } };
  };
}

// T003: the live runtime. `provider`/`egressEnforcer` may be injected (tests);
// otherwise the Docker provider + network enforcer are constructed from config.
// `defaults` carries the configuration-supplied plumbing (policy, ledger
// factory, forward transport, worker source, executor) that callers no longer
// pass per request. Request-level fields still override for specialized runs.
export function createLiveVerifiedSandboxRuntime({
  provider = null,
  egressEnforcer = null,
  docker = "docker",
  image = undefined,
  brokerFactory = null,
  defaults = null,
} = {}) {
  const base = defaults ?? {};
  const declaredTrustDomain = base.anchorTrustDomain ?? null;
  const activeProvider =
    provider ??
    createDockerWorkerProvider({
      docker,
      ...(image ? { image } : {}),
      ...(declaredTrustDomain ? { anchorTrustDomain: declaredTrustDomain } : {}),
      egressEnforcer: egressEnforcer ?? createEgressNetworkEnforcer({ docker }),
    });
  if (typeof activeProvider.start !== "function" || typeof activeProvider.stop !== "function")
    throw new TypeError("live verified-sandbox runtime requires a provider with start/stop");
  // The broker listener stays host-side: policy and credential refs never cross
  // the listener boundary. A caller may inject its own composition; otherwise
  // the T001 broker listener is built per invocation from the configured (or
  // request-supplied) egress policy/ledger/transport. In N5 relay mode it also
  // binds a host-side relay server on the default bridge gateway so the broker
  // container can pipe worker bytes to it; discovery or bind failure is
  // fail-closed (the invocation raises rather than degrading to unmediated).
  const composeBroker =
    brokerFactory ??
    (async ({ request, emit }) => {
      const policy = request.egressPolicy ?? base.policy ?? null;
      if (!policy) return null;
      const ledger =
        request.egressLedger ??
        (typeof base.ledgerFactory === "function" ? base.ledgerFactory({ request, emit }) : null) ??
        base.ledger ??
        null;
      if (!ledger) return null;
      const forward = request.egressForward ?? base.forward ?? null;
      if (typeof forward !== "function" && typeof base.sandboxExecutor !== "function")
        throw new EgressPolicyError("verified-sandbox egress forward transport is required");
      const broker = createEgressBroker({
        policy,
        ledger,
        emitter: { emit },
        policyDigest: request.egressPolicyDigest ?? base.policyDigest ?? null,
        credentials: request.egressCredentials ?? base.credentials ?? {},
      });
      const listener = createEgressBrokerListener({
        broker,
        forward:
          forward ??
          (() => {
            throw new Error("egress forward transport is required");
          }),
      });
      const relayEnabled = request.egressRelay ?? base.egressRelay ?? false;
      if (!relayEnabled) return { broker, listener, ledger };
      const relayHost =
        request.relayGateway ?? base.relayGateway ?? (await discoverHostGateway({ docker }));
      if (typeof relayHost !== "string" || relayHost.length === 0)
        throw new EgressPolicyError(
          "verified-sandbox relay transport unavailable: no host gateway to bind",
        );
      const relay = await createEgressBrokerRelayServer({
        listener,
        host: relayHost,
        meta: {
          runId: request.parentRunId ?? null,
          workerId: null,
          invocationId: request.invocationId ?? null,
          attempt: request.retry?.attempt ?? 0,
          taskId: request.taskId ?? null,
        },
      });
      return { broker, listener, ledger, relay };
    });
  return Object.freeze({
    async invoke({ request = {}, emitEgress = null } = {}, { signal } = {}) {
      const sandboxExecutor = request.sandboxExecutor ?? base.sandboxExecutor ?? null;
      if (typeof sandboxExecutor !== "function")
        throw new TypeError("verified-sandbox invocation requires request.sandboxExecutor");
      const workerSource = request.workerSource ?? base.workerSource ?? null;
      if (typeof workerSource !== "string" || workerSource.length < 1)
        throw new TypeError("verified-sandbox invocation requires request.workerSource");
      let started = null;
      let broker = null;
      let listener = null;
      let ledger = null;
      let relay = null;
      let monitor = null;
      try {
        if (typeof composeBroker === "function") {
          const composed = await composeBroker({ request, emit: (event) => emitEgress?.(event) });
          broker = composed?.broker ?? null;
          listener = composed?.listener ?? null;
          ledger = composed?.ledger ?? null;
          relay = composed?.relay ?? null;
        }
        const baseEgress = request.egress ?? base.egress ?? null;
        const egressConfig =
          relay && baseEgress
            ? {
                ...baseEgress,
                brokerScript: generateRelayBrokerScript({
                  relayHost: relay.host,
                  relayPort: relay.port,
                }),
              }
            : baseEgress;
        const sandboxPolicy = request.sandboxPolicy ?? base.sandboxPolicy ?? null;
        started = await activeProvider.start({
          name: request.workerName ?? base.workerName ?? `csm-sandbox-${request.childRunId}`,
          workerSource,
          policy: sandboxPolicy,
          egress: egressConfig,
        });
        if (relay && started?.id) relay.meta.workerId = `worker-${started.id}`;
        // T001 (AC6): a long-lived worker is attested once by `start`; keep
        // re-observing the frozen controls on the policy cadence. The monitor
        // kills on drift/inspect-error (fail-closed) and is stopped on
        // teardown. The runtime surfaces the terminal failure after the worker
        // is already gone, so a drift can never be swallowed.
        if (started?.id) {
          monitor = createReattestationMonitor({
            inspect: () => activeProvider.inspect({ id: started.id }),
            stop: () => activeProvider.stop({ id: started.id }),
            cadenceMs: resolveReattestationCadenceMs(
              sandboxPolicy,
              base.reattestationCadenceMs ?? null,
            ),
            expected: reattestationExpectations(sandboxPolicy, started),
          });
          monitor.start();
        }
        let result;
        try {
          result = await sandboxExecutor({
            request,
            worker: started,
            provider: activeProvider,
            broker,
            listener,
            ledger,
            relay,
            emitEgress,
            signal,
          });
        } catch (error) {
          throw reattestationFailure(monitor?.snapshots?.().at(-1) ?? null) ?? error;
        }
        const drift = reattestationFailure(monitor?.snapshots?.().at(-1) ?? null);
        if (drift) throw drift;
        if (broker && typeof activeProvider.collectDrops === "function")
          await collectDropsWithRetry(
            activeProvider,
            {
              id: started.id,
              broker,
              meta: {
                runId: request.parentRunId,
                workerId: `worker-${started.id}`,
                invocationId: request.invocationId,
                attempt: request.retry?.attempt ?? 0,
              },
            },
            request.dropCapturePoll ?? base.dropCapturePoll ?? null,
          );
        // T002: the live terminal trust gate. After every egress decision/drop
        // is recorded and before the runtime returns, re-authorize the egress
        // chain's final sink and the worker attestation under the accepted
        // trust domain. Fail closed (typed error) when unavailable/mismatched;
        // an accepted OS-user-bound sink is recorded in `result.trust`.
        const trust = enforceTerminalTrust({
          ledger,
          provider: activeProvider,
          started,
          declaredDomain: request.anchorTrustDomain ?? base.anchorTrustDomain ?? null,
          at: request.trustAuthorizedAt ?? null,
        });
        if (ledger && typeof ledger.records === "function" && result && typeof result === "object")
          result = {
            ...result,
            egress: {
              ...result.egress,
              records: ledger.records(),
              verify: typeof ledger.verify === "function" ? ledger.verify() : null,
            },
          };
        if (result && typeof result === "object") result = { ...result, trust };
        return result;
      } finally {
        if (monitor) monitor.stop();
        if (relay && typeof relay.close === "function") {
          try {
            await relay.close();
          } catch {
            // relay teardown is best-effort; the listener stops with the process
          }
        }
        if (started?.id) {
          try {
            await activeProvider.stop({ id: started.id });
          } catch {
            // teardown is best-effort; the provider's stop remains authoritative
          }
        }
      }
    },
    effectiveIsolation: () => ({
      isolation: VERIFIED_SANDBOX,
      required: VERIFIED_SANDBOX,
      attestation: "required",
      selfProvided: false,
      satisfiable: null,
    }),
  });
}

// T003/N2: build the live runtime from a declarative config. A caller enables
// the runtime and supplies the app-specific worker source/executor; the
// egress policy (default deny-all), HTTP(S) forward transport, and ledger key
// (per-run generated) now default, so no per-request plumbing remains. Still
// fail-closed: a config with no worker source/executor is rejected rather than
// degrading to an unmediated sandbox.
export function createVerifiedSandboxRuntime(config = {}) {
  if (config?.enabled !== true)
    throw Object.assign(new Error("verified-sandbox runtime is not enabled"), {
      code: "verified-sandbox-disabled",
    });
  // N2: default to a deny-all policy so mediation stays fail-closed without a
  // caller-supplied allowlist; the caller supplies one only to permit upstreams.
  const policy = config.policy ?? defaultEgressPolicy();
  if (typeof policy !== "object")
    throw Object.assign(new TypeError("verified-sandbox policy must be an object"), {
      code: "verified-sandbox-config",
    });
  const sandboxExecutor =
    typeof config.sandboxExecutor === "function"
      ? config.sandboxExecutor
      : createDefaultSandboxExecutor();
  if (typeof config.workerSource !== "string" && typeof config.sandboxExecutor !== "function")
    throw Object.assign(
      new TypeError("verified-sandbox runtime requires a workerSource or sandboxExecutor"),
      { code: "verified-sandbox-config" },
    );
  // N2: default to an HTTP(S) forwarder unless a custom executor owns transport.
  const forward =
    typeof config.forward === "function"
      ? config.forward
      : typeof config.sandboxExecutor === "function"
        ? null
        : createHttpForward({ timeoutMs: config.forwardTimeoutMs ?? null });
  const ledgerFactory =
    typeof config.ledgerFactory === "function"
      ? config.ledgerFactory
      : ({ request }) => {
          if (config.ledger) return config.ledger;
          // N2: a per-runtime generated key keeps the chain verifiable within the
          // run when the caller does not supply a key/anchor. External anchoring
          // still requires an explicit `ledgerKey` (+ publish/readAnchor).
          const key = randomBytes(32).toString("hex");
          const runId = config.ledgerRunId ?? request.parentRunId ?? request.childRunId;
          return createEgressLedger({
            runId,
            key,
            filePath: config.ledgerFilePath ?? null,
            // T002: an explicit `trustAnchor` provider carries its own trust
            // domain; legacy publish/read callbacks stay OS-user-bounded.
            trustAnchor: config.trustAnchor ?? null,
            publishAnchor: config.publishAnchor ?? null,
            readAnchor: config.readAnchor ?? null,
          });
        };
  const defaults = {
    policy,
    forward,
    sandboxExecutor,
    workerSource: config.workerSource ?? null,
    credentials: config.credentials ?? {},
    policyDigest: config.policyDigest ?? digest(policy),
    ledgerFactory,
    sandboxPolicy: config.sandboxPolicy ?? null,
    workerName: config.workerName ?? null,
    // T002: the trust domain a terminal sink may be accepted under. Defaults to
    // the recorded g3-ruling boundary `os-user-bound`; declaring `external` (or
    // supplying a host-external anchor) forces host-external re-authorization.
    anchorTrustDomain: config.anchorTrustDomain ?? null,
    // T001 (AC6): cadence used when no sandbox policy declares one. A policy's
    // `attestation.cadenceMs` always wins.
    reattestationCadenceMs: config.reattestationCadenceMs ?? null,
    // N5: opt-in broker-container relay. When enabled the runtime binds a
    // host-side relay server and hands the generated relay script to the
    // provider; unavailable transport raises rather than degrading.
    egressRelay: config.egressRelay === true,
    relayGateway: config.relayGateway ?? null,
    egress: config.egress ?? {
      ...(config.brokerImage ? { brokerImage: config.brokerImage } : {}),
      brokerScript: config.brokerScript ?? DEFAULT_BROKER_SCRIPT,
      ...(config.requireDropCapture !== undefined
        ? { requireDropCapture: config.requireDropCapture }
        : {}),
    },
    dropCapturePoll: config.dropCapturePoll ?? { attempts: 12, delayMs: 250 },
  };
  return createLiveVerifiedSandboxRuntime({
    provider: config.provider ?? null,
    egressEnforcer: config.egressEnforcer ?? null,
    docker: config.docker ?? "docker",
    image: config.image,
    brokerFactory: config.brokerFactory ?? null,
    defaults,
  });
}

// T003: a runtime that always refuses, used when an explicitly enabled config
// cannot be constructed. Dispatch routes to it (it is invocable) and the typed
// throw is surfaced by the caller's gate as `isolation-unavailable`, so a
// malformed config can never silently degrade to an unmediated sandbox.
function createFailClosedRuntime(reason) {
  const message = `verified-sandbox runtime could not be constructed: ${String(
    reason?.message ?? reason,
  )}`;
  return Object.freeze({
    async invoke() {
      throw Object.assign(new Error(message), { code: "verified-sandbox-unavailable" });
    },
    effectiveIsolation: () => ({
      isolation: VERIFIED_SANDBOX,
      required: VERIFIED_SANDBOX,
      attestation: "required",
      selfProvided: false,
      satisfiable: false,
      reason: message,
    }),
  });
}

// T003: normalize the many accepted shapes to one runtime or null. An existing
// runtime (anything with `invoke`) is passed through for back-compat; a config
// with `enabled: true` is constructed; anything else (including a disabled
// config) is "no runtime configured" and leaves the caller's fail-closed
// isolation-unavailable behavior untouched.
export function resolveVerifiedSandboxRuntime(input = null) {
  if (input === null || input === undefined) return null;
  if (typeof input.invoke === "function") return input;
  if (input.enabled !== true) return null;
  try {
    return createVerifiedSandboxRuntime(input);
  } catch (error) {
    return createFailClosedRuntime(error);
  }
}

export { DEFAULT_BROKER_SCRIPT };
