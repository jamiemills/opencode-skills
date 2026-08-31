"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const BUILD_OWNED = new Set([
  "csm-bdd-tdd",
  "csm-build",
  "csm-deep-research",
  "csm-grill",
  "csm-make-tests",
  "csm-plan",
  "csm-review",
  "csm-review-python",
]);

const identityOf = (request) => ({
  invocationId: request.invocationId,
  parentRunId: request.parentRunId,
  childRunId: request.childRunId,
  phaseId: request.phaseId,
  edgeId: request.edgeId,
  skill: request.skill,
});

const identityDigest = (identity) => digest(identity);

function assertIdentity(identity, expected) {
  if (!identity || typeof identity !== "object")
    throw new TypeError("handoff request identity is required");
  for (const field of ["invocationId", "parentRunId", "childRunId", "phaseId", "edgeId", "skill"])
    if (typeof identity[field] !== "string" || identity[field] !== expected[field])
      throw new TypeError("handoff request identity mismatch");
  if (!RUN_ID.test(identity.parentRunId) || !RUN_ID.test(identity.childRunId))
    throw new TypeError("handoff request identity has invalid run IDs");
}

function assertDigest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`invalid handoff ${name}`);
}

export function createCsmBuildHandoff({
  execute,
  skill,
  inputSchema = "request/1",
  outputSchema = "csm-build-output/1",
  inputSchemaDigest = digest({ schema: inputSchema }),
  outputSchemaDigest = digest({ schema: outputSchema }),
  handlerDigest = digest({ skill, implementation: "csm-build-handoff/1" }),
  effectiveConfigDigest = digest({ skill, config: "csm-build-current-context/1" }),
  permissions = ["read", "write"],
  effects = ["workspace-write"],
} = {}) {
  if (!BUILD_OWNED.has(skill)) throw new TypeError("skill is not csm-build-owned");
  if (typeof execute !== "function") throw new TypeError("csm-build handoff executor is required");
  for (const [value, name] of [
    [inputSchemaDigest, "input schema digest"],
    [outputSchemaDigest, "output schema digest"],
    [handlerDigest, "handler digest"],
    [effectiveConfigDigest, "configuration digest"],
  ])
    assertDigest(value, name);
  return Object.freeze({
    schema: "csm-build-handoff/1",
    owner: "csm-build",
    skill,
    inputSchema,
    outputSchema,
    inputSchemaDigest,
    outputSchemaDigest,
    handlerDigest,
    effectiveConfigDigest,
    permissions: [...permissions],
    effects: [...effects],
    cancellation: "cooperative",
    async execute(request, signal) {
      if (signal?.aborted)
        return {
          schema: outputSchema,
          skill,
          attempt: request.retry?.attempt,
          status: "cancelled",
          failure: { class: "timeout", code: "cancelled", message: "execution cancelled" },
        };
      const identity = identityOf(request);
      assertIdentity(identity, identity);
      const expected = {
        ...identity,
        attempt: request.retry?.attempt,
        inputSchemaDigest,
        outputSchemaDigest,
      };
      const result = await execute({
        skill,
        input: request.input ?? {},
        requestIdentity: Object.freeze({ ...identity, digest: identityDigest(identity) }),
        attempt: expected.attempt,
        inputSchema,
        inputSchemaDigest,
        outputSchema,
        outputSchemaDigest,
        signal,
      });
      if (!result || typeof result !== "object")
        throw new TypeError("csm-build handoff result is required");
      if (
        result.schema !== outputSchema ||
        result.skill !== skill ||
        result.attempt !== expected.attempt
      )
        throw new TypeError("csm-build handoff result identity mismatch");
      assertIdentity(result.requestIdentity, identity);
      if (result.requestIdentity.digest !== identityDigest(identity))
        throw new TypeError("csm-build request identity digest mismatch");
      if (
        result.inputSchemaDigest !== inputSchemaDigest ||
        result.outputSchemaDigest !== outputSchemaDigest
      )
        throw new TypeError("csm-build handoff schema digest mismatch");
      if (
        result.outputDigest !== undefined &&
        result.outputDigest !== digest(result.output ?? null)
      )
        throw new TypeError("csm-build output digest mismatch");
      return result;
    },
  });
}

export function createCsmBuildHandoffAdapter(options = {}) {
  return createCsmBuildHandoff(options);
}

export function csmBuildOwnedSkills() {
  return [...BUILD_OWNED];
}

export { identityOf as csmBuildRequestIdentity, identityDigest as csmBuildRequestIdentityDigest };
