"use strict";

import { createHostInvocationAdapter } from "./invocation.mjs";
import { executeSkill } from "./skill-executor-handlers.mjs";
import { csmBuildOwnedSkills } from "./csm-build-handoff.mjs";
import { digest } from "../../lib/schema-runtime/index.mjs";
import canonicalCapabilities from "../capabilities.json" with { type: "json" };
import {
  isolationRouting,
  ISOLATION_FAILURE_CODE,
  VERIFIED_SANDBOX,
} from "./skill-executor-preflight.mjs";
import { createDockerWorkerProvider } from "./docker-worker-provider.mjs";
import { createEgressNetworkEnforcer } from "./egress-network.mjs";
import { createEgressBroker, createEgressBrokerListener } from "./egress-broker.mjs";

// This adapter is deliberately opt-in. It is an in-process execution boundary,
// not a host or a fallback to another runtime.
export function createInProcessExecutorAdapter({
  registry,
  bindings = {},
  capabilities,
  inputForRequest,
  artifactResolver,
  schemaRegistry,
  cursorStore = null,
  now = () => new Date(),
  terminalInvocations = new Map(),
  publicationBindings = {},
  isolationGateEnabled = true,
  sandboxRuntime = null,
  isolationReporters = null,
  egressEmitter = null,
} = {}) {
  if (!registry || typeof registry.resolveExact !== "function")
    throw new TypeError("in-process executor registry is required");
  const manifest =
    capabilities ??
    Object.entries(bindings).map(([skill, binding]) => ({
      skill,
      digest: binding.digest ?? binding.skillDigest,
    }));
  const capabilityEntries = Array.isArray(manifest) ? manifest : (manifest?.skills ?? []);
  const capabilityFor = (skill) => {
    const provided = capabilityEntries.find((capability) => capability.skill === skill) ?? null;
    const canonical =
      canonicalCapabilities.skills.find((capability) => capability.skill === skill) ?? null;
    if (!provided) return canonical;
    if (provided.execution || !canonical) return provided;
    // A caller may pass a reduced manifest (identity digests only); the
    // canonical capability manifest remains the source of the declared
    // isolation/attestation requirement.
    return { ...provided, execution: canonical.execution };
  };
  const reporterMap = new Map();
  if (isolationReporters instanceof Map)
    for (const [skill, reporter] of isolationReporters) reporterMap.set(skill, reporter);
  else if (isolationReporters && typeof isolationReporters === "object")
    for (const [skill, reporter] of Object.entries(isolationReporters))
      reporterMap.set(skill, reporter);
  const reporterFor = (skill) => {
    const explicit = reporterMap.get(skill);
    if (typeof explicit === "function") return explicit;
    if (explicit && typeof explicit.effectiveIsolation === "function")
      return explicit.effectiveIsolation;
    const viaHandler = bindings[skill]?.handler?.effectiveIsolation;
    return typeof viaHandler === "function" ? viaHandler : null;
  };
  // T004: per-invocation effective isolation reported by the owning adapter
  // (handler) or an explicit reporter. Falls back to the static declaration in
  // the gate when no reporter exists.
  async function effectiveIsolation(request = {}) {
    const reporter = reporterFor(request.skill);
    if (!reporter) return null;
    let input = request.input;
    if (input === undefined && typeof inputForRequest === "function") {
      try {
        input = await inputForRequest(request);
      } catch (error) {
        return { isolation: "unknown", reason: String(error?.message ?? error) };
      }
    }
    try {
      return reporter({ ...request, input });
    } catch (error) {
      return { isolation: "unknown", reason: String(error?.message ?? error) };
    }
  }
  // Correlation is owned by the caller's telemetry emitter; the adapter only
  // forwards the broker listener's decision with the parent/child identity.
  function emitEgress(request, event = {}) {
    if (!egressEmitter || typeof egressEmitter.emit !== "function") return;
    egressEmitter.emit({
      runId: event.runId ?? request.parentRunId,
      phaseId: event.phaseId ?? request.phaseId,
      edgeId: event.edgeId ?? request.edgeId,
      childRunId: event.childRunId ?? request.childRunId,
      eventType: "egress.decision",
      attempt: event.attempt ?? request.retry?.attempt ?? 0,
      taskId: event.taskId ?? null,
      workerId: event.workerId ?? null,
      invocationId: event.invocationId ?? request.invocationId ?? null,
      payload: event.payload ?? {
        decision: event.decision ?? null,
        targetHost: event.targetHost ?? null,
        reasonCode: event.reasonCode ?? null,
      },
    });
  }
  const resolve = (request) => {
    const pinned = bindings[request.skill];
    if (!pinned)
      throw Object.assign(
        new Error(
          `${request.skill}: skill executor not registered — substantial work must route to the matching csm skill`,
        ),
        {
          code: "stale-handler",
        },
      );
    if (
      request.skill === "csm-upload" &&
      (!publicationBindings[request.skill] ||
        !Object.hasOwn(publicationBindings[request.skill], "destination") ||
        !Object.hasOwn(publicationBindings[request.skill], "executor"))
    )
      throw Object.assign(new Error("csm-upload: explicit publication binding is required"), {
        code: "stale-handler",
      });
    const descriptor = registry.resolveExact({
      skill: request.skill,
      contractDigest: pinned.contractDigest,
      handlerDigest: pinned.handlerDigest,
      inputSchemaDigest: pinned.inputSchemaDigest,
      outputSchemaDigest: pinned.outputSchemaDigest,
      receiptSchemaDigest: pinned.receiptSchemaDigest,
      evidenceSchemaDigest: pinned.evidenceSchemaDigest,
      effectiveConfigDigest: pinned.effectiveConfigDigest,
    });
    for (const field of [
      "contractDigest",
      "handlerDigest",
      "inputSchemaDigest",
      "outputSchemaDigest",
      "receiptSchemaDigest",
      "evidenceSchemaDigest",
      "effectiveConfigDigest",
    ])
      if (
        request[field] !== undefined &&
        (request[field] !== pinned[field] || request[field] !== descriptor[field])
      )
        throw Object.assign(new Error(`${request.skill}: executable identity mismatch`), {
          code: "stale-handler",
        });
    return descriptor;
  };
  // The callback is intentionally private: the durable adapter owns policy and
  // this callback is only the in-process execution boundary.
  const durable = createHostInvocationAdapter({
    capabilities: manifest,
    artifactResolver,
    schemaRegistry,
    cursorStore,
    now,
    terminalInvocations,
    requireExecutableIdentity: true,
    host: {
      async invokeSiblingSkill(request, { signal } = {}) {
        const descriptor = resolve(request);
        const result = await executeSkill(
          request.skill,
          {
            input: inputForRequest ? await inputForRequest(request) : (request.input ?? {}),
            context: {
              runId: request.childRunId,
              owner: request.skill,
              attempt: request.retry?.attempt ?? 1,
              invocationId: request.invocationId,
              parentRunId: request.parentRunId,
              phaseId: request.phaseId,
              edgeId: request.edgeId,
              publication: publicationBindings[request.skill] ?? null,
            },
            signal,
          },
          {
            handlers: new Map([[request.skill, descriptor.handler]]),
            descriptor,
            trustedBindings: publicationBindings[request.skill] ?? null,
          },
        );
        if (result.status !== "completed") return result;
        const childReceipt = Object.fromEntries(
          Object.entries(result.receipt).filter(([key]) => key !== "attempt"),
        );
        return {
          status: "completed",
          childReceipt,
          evidence: result.evidence,
          outputArtifactRefs: result.artifacts,
          technical: result.technical ?? null,
          functional: result.functional ?? null,
        };
      },
    },
  });
  return Object.freeze({
    async invoke(request, options = {}) {
      try {
        const descriptor = resolve(request);
        const boundRequest = {
          ...request,
          contractDigest: descriptor.contractDigest,
          handlerDigest: descriptor.handlerDigest,
          inputSchemaDigest: descriptor.inputSchemaDigest,
          outputSchemaDigest: descriptor.outputSchemaDigest,
          receiptSchemaDigest: descriptor.receiptSchemaDigest,
          evidenceSchemaDigest: descriptor.evidenceSchemaDigest,
          effectiveConfigDigest: descriptor.effectiveConfigDigest,
        };
        boundRequest.requestDigest = digest(
          Object.fromEntries(
            Object.entries(boundRequest).filter(
              ([key]) => key !== "status" && key !== "requestDigest",
            ),
          ),
        );
        const report = await effectiveIsolation(boundRequest);
        const routing = isolationRouting({
          adapter: { effectiveIsolation: () => report },
          request: boundRequest,
          capability: capabilityFor(request.skill),
          enabled: isolationGateEnabled,
          runtimeInvocable: typeof sandboxRuntime?.invoke === "function",
        });
        if (routing.action === "blocked")
          return { status: "blocked", failure: routing.failure.failure };
        if (routing.action === "sandbox") {
          try {
            return await sandboxRuntime.invoke(
              {
                request: boundRequest,
                descriptor,
                effectiveIsolation: routing.gate,
                emitEgress: (event) => emitEgress(boundRequest, event),
              },
              options,
            );
          } catch (error) {
            return {
              status: "blocked",
              failure: {
                class: "policy",
                code: ISOLATION_FAILURE_CODE,
                message: `${request.skill}: verified-sandbox runtime failed: ${String(
                  error?.message ?? error,
                )}`,
              },
            };
          }
        }
        return durable.invoke(boundRequest, options);
      } catch (error) {
        return {
          status: "blocked",
          failure: { class: "policy", code: error.code ?? "stale-handler", message: error.message },
        };
      }
    },
    effectiveIsolation,
    supportedCsmBuildSkills: Object.freeze(
      csmBuildOwnedSkills().filter((skill) => Boolean(bindings[skill])),
    ),
  });
}

// T004: the live verified-sandbox runtime. It composes a real worker provider
// (createDockerWorkerProvider) with an optional host-side egress broker composed
// by `brokerFactory` (createEgressBroker/Listener). The provider owns
// network/enforcer provisioning and drop collection; this runtime owns the
// worker lifecycle and forwards every egress decision through `emitEgress` so
// the caller can emit correlated `egress.decision` telemetry. It owns no
// acceptance authority. The actual work is delegated to the injected
// `request.sandboxExecutor` so the runtime stays transport-agnostic and testable.
export function createLiveVerifiedSandboxRuntime({
  provider = null,
  egressEnforcer = null,
  docker = "docker",
  image = undefined,
  brokerFactory = null,
} = {}) {
  const activeProvider =
    provider ??
    createDockerWorkerProvider({
      docker,
      ...(image ? { image } : {}),
      egressEnforcer: egressEnforcer ?? createEgressNetworkEnforcer({ docker }),
    });
  if (typeof activeProvider.start !== "function" || typeof activeProvider.stop !== "function")
    throw new TypeError("live verified-sandbox runtime requires a provider with start/stop");
  // The broker listener stays host-side: policy and credential refs never cross
  // the listener boundary. A caller may inject its own composition; otherwise
  // the T001 broker listener is built per invocation from the request's egress
  // policy/ledger/transport.
  const composeBroker =
    brokerFactory ??
    (({ request, emit }) => {
      if (!request.egressPolicy || !request.egressLedger) return null;
      const broker = createEgressBroker({
        policy: request.egressPolicy,
        ledger: request.egressLedger,
        emitter: { emit },
        policyDigest: request.egressPolicyDigest ?? null,
        credentials: request.egressCredentials ?? {},
      });
      const listener = createEgressBrokerListener({
        broker,
        forward:
          request.egressForward ??
          (() => {
            throw new Error("egress forward transport is required");
          }),
      });
      return { broker, listener };
    });
  return Object.freeze({
    async invoke({ request = {}, emitEgress = null } = {}, { signal } = {}) {
      if (typeof request.sandboxExecutor !== "function")
        throw new TypeError("verified-sandbox invocation requires request.sandboxExecutor");
      if (typeof request.workerSource !== "string" || request.workerSource.length < 1)
        throw new TypeError("verified-sandbox invocation requires request.workerSource");
      let started = null;
      let broker = null;
      let listener = null;
      try {
        if (typeof composeBroker === "function") {
          const composed = await composeBroker({ request, emit: (event) => emitEgress?.(event) });
          broker = composed?.broker ?? null;
          listener = composed?.listener ?? null;
        }
        started = await activeProvider.start({
          name: request.workerName ?? `csm-sandbox-${request.childRunId}`,
          workerSource: request.workerSource,
          policy: request.sandboxPolicy ?? null,
          egress: request.egress ?? null,
        });
        const result = await request.sandboxExecutor({
          request,
          worker: started,
          broker,
          listener,
          emitEgress,
          signal,
        });
        if (broker && typeof activeProvider.collectDrops === "function")
          await activeProvider.collectDrops({
            id: started.id,
            broker,
            meta: {
              runId: request.parentRunId,
              workerId: `worker-${started.id}`,
              invocationId: request.invocationId,
              attempt: request.retry?.attempt ?? 0,
            },
          });
        return result;
      } finally {
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
