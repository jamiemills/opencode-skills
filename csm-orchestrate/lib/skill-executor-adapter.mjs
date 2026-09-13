"use strict";

import { createHostInvocationAdapter } from "./invocation.mjs";
import { executeSkill } from "./skill-executor-handlers.mjs";
import { csmBuildOwnedSkills } from "./csm-build-handoff.mjs";
import { digest } from "../../lib/schema-runtime/index.mjs";
import canonicalCapabilities from "../capabilities.json" with { type: "json" };
import { isolationRouting, ISOLATION_FAILURE_CODE } from "./skill-executor-preflight.mjs";
import {
  createLiveVerifiedSandboxRuntime,
  resolveVerifiedSandboxRuntime,
} from "./verified-sandbox-runtime.mjs";

export { createLiveVerifiedSandboxRuntime };

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
        const routing = isolationRouting({
          adapter: { effectiveIsolation: () => report },
          request: boundRequest,
          capability: capabilityFor(request.skill),
          enabled: isolationGateEnabled,
          runtimeInvocable: typeof activeSandboxRuntime?.invoke === "function",
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
