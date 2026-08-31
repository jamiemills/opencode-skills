"use strict";

import { createHostInvocationAdapter } from "./invocation.mjs";
import { executeSkill } from "./skill-executor-handlers.mjs";
import { digest } from "../../lib/schema-runtime/index.mjs";

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
} = {}) {
  if (!registry || typeof registry.resolveExact !== "function")
    throw new TypeError("in-process executor registry is required");
  const manifest =
    capabilities ??
    Object.entries(bindings).map(([skill, binding]) => ({
      skill,
      digest: binding.digest ?? binding.skillDigest,
    }));
  const resolve = (request) => {
    const pinned = bindings[request.skill];
    if (!pinned)
      throw Object.assign(new Error(`${request.skill}: exact executor binding is required`), {
        code: "stale-handler",
      });
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
      receiptSchemaDigest: pinned.receiptSchemaDigest,
      evidenceSchemaDigest: pinned.evidenceSchemaDigest,
      effectiveConfigDigest: pinned.effectiveConfigDigest,
    });
    for (const field of [
      "contractDigest",
      "handlerDigest",
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
        return durable.invoke(boundRequest, options);
      } catch (error) {
        return {
          status: "blocked",
          failure: { class: "policy", code: error.code ?? "stale-handler", message: error.message },
        };
      }
    },
  });
}
