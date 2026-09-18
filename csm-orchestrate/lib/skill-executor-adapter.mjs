"use strict";

import { createHostInvocationAdapter } from "./invocation.mjs";
import { executeSkill } from "./skill-executor-handlers.mjs";
import { csmBuildOwnedSkills } from "./csm-build-handoff.mjs";
import { digest } from "../../lib/schema-runtime/index.mjs";
import canonicalCapabilities from "../capabilities.json" with { type: "json" };
import {
  effectiveIsolationFloor,
  isolationRouting,
  ISOLATION_FAILURE_CODE,
  WORKER_ATTESTATION_EVIDENCE_KIND,
} from "./skill-executor-preflight.mjs";
import { isHostIsolationVerifier } from "./docker-worker-provider.mjs";
import {
  createLiveVerifiedSandboxRuntime,
  resolveVerifiedSandboxRuntime,
} from "./verified-sandbox-runtime.mjs";

export { createLiveVerifiedSandboxRuntime };

// T005 (N1 follow-up) / T003: prefer the provider's host-held verifier over any
// caller-supplied brand. A real provider (the Docker worker provider) binds its
// host-held anchor key into `evidenceVerifier()`; the live verified-sandbox
// runtime now passes `evidenceVerifier()`/`trustBoundary()` through from the
// provider (T003), so a constructed runtime object is the primary source and
// the default path reaches the host-held verifier without the caller reaching
// into the raw provider config. The raw config supplied as `sandboxRuntime`
// (`{ provider: { evidenceVerifier } }`, the documented
// `createInProcessExecutorAdapter({ sandboxRuntime: config })` shape) stays a
// fallback for runtimes that predate the passthrough. Best effort: when no host
// verifier is reachable the caller-supplied `isolationVerifier` remains the
// explicit fallback.
function resolveHostIsolationVerifier(runtime, rawConfig) {
  const sources = [
    typeof runtime?.evidenceVerifier === "function" ? runtime : null,
    typeof rawConfig?.evidenceVerifier === "function" ? rawConfig : null,
    typeof rawConfig?.provider?.evidenceVerifier === "function" ? rawConfig.provider : null,
  ];
  for (const source of sources) {
    try {
      const verifier = source.evidenceVerifier();
      if (isHostIsolationVerifier(verifier)) return verifier;
    } catch {
      // A provider that cannot produce a usable anchor verifier is skipped.
    }
  }
  return null;
}

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
  isolationAnchorKey = null,
  isolationVerifier = null,
  sandboxRuntime = null,
  isolationReporters = null,
  egressEmitter = null,
} = {}) {
  if (!registry || typeof registry.resolveExact !== "function")
    throw new TypeError("in-process executor registry is required");
  // T003: accept either a constructed runtime or a declarative config; a
  // disabled/absent config stays "no runtime" and leaves the existing
  // fail-closed isolation-unavailable behavior intact.
  const activeSandboxRuntime = resolveVerifiedSandboxRuntime(sandboxRuntime);
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
        // T003: a missing reporter is unknown, not the static declaration. The
        // in-process floor satisfies trusted-in-process; a higher requirement
        // fails closed as isolation-unavailable instead of silently inheriting
        // the declared isolation.
        const effective = effectiveIsolationFloor({
          report,
          capability: capabilityFor(request.skill),
        });
        // T005 (N1 follow-up): out-of-band anchoring (the provider's host-held
        // verifier, or a caller-supplied anchor key/verifier) applies to the
        // keyed `worker-attestation` kind. A csm-autoresearch
        // `provider-attestation` keeps its own evidence-carried provider
        // verifier, so the generated route is not displaced by a
        // worker-attestation verifier. Within the worker-attestation kind the
        // provider's host-held verifier wins over any caller-supplied brand.
        const workerAttestationEvidence =
          effective?.evidence?.kind === WORKER_ATTESTATION_EVIDENCE_KIND;
        const hostVerifier = resolveHostIsolationVerifier(activeSandboxRuntime, sandboxRuntime);
        const gateVerifier = workerAttestationEvidence ? (hostVerifier ?? isolationVerifier) : null;
        const gateAnchorKey = workerAttestationEvidence ? isolationAnchorKey : null;
        const routing = isolationRouting({
          adapter: { effectiveIsolation: () => effective },
          request: boundRequest,
          capability: capabilityFor(request.skill),
          enabled: isolationGateEnabled,
          runtimeInvocable: typeof activeSandboxRuntime?.invoke === "function",
          anchorKey: gateAnchorKey,
          verifier: gateVerifier,
        });
        if (routing.action === "blocked")
          return { status: "blocked", failure: routing.failure.failure };
        if (routing.action === "sandbox") {
          try {
            return await activeSandboxRuntime.invoke(
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
