"use strict";

import { analyzeRepository } from "../../csm-ddd/lib/ddd/pipeline.mjs";
import { runExpandedPipeline } from "../../csm-scan/lib/scan/pipeline/run.mjs";
import { publishPublicationDescriptor } from "../../csm-upload/lib/publication.mjs";
import { assertSchema } from "./contracts.mjs";
import { digest } from "../../../lib/schema-runtime/index.mjs";
import { skillExecutorContractDigest } from "./skill-executor-registry.mjs";
import { csmBuildOwnedSkills } from "./csm-build-handoff.mjs";
import canonicalCapabilities from "../capabilities.json" with { type: "json" };

const RESULT_SCHEMA = "csm-orchestrate-child-result/1";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{1,127}$/;

const failure = (code, message) => ({ class: "policy", code, message });

function contextOf(input) {
  const context = input?.context;
  if (!context || typeof context !== "object") throw new TypeError("child context is required");
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(context.runId))
    throw new TypeError("invalid child run identity");
  if (!/^csm-[a-z0-9][a-z0-9-]{1,63}$/.test(context.owner))
    throw new TypeError("invalid child owner identity");
  if (!Number.isInteger(context.attempt) || context.attempt < 1)
    throw new TypeError("invalid child attempt identity");
  return context;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function artifact(value, context) {
  if (!value || typeof value !== "object" || !ID.test(value.artifactId ?? ""))
    throw new TypeError("invalid child artifact");
  if (value.runId !== context.runId || value.owner !== context.owner)
    throw new TypeError("child artifact identity mismatch");
  const body = { ...value };
  delete body.digest;
  const actual = digest(body);
  if (value.digest !== actual) throw new TypeError("child artifact digest mismatch");
  return value;
}

function receipt(value, context) {
  if (!value || value.schema !== "csm-orchestrate-child-receipt/1")
    throw new TypeError("invalid child receipt schema");
  if (
    value.runId !== context.runId ||
    value.owner !== context.owner ||
    value.attempt !== context.attempt
  )
    throw new TypeError("child receipt identity mismatch");
  const body = { ...value };
  delete body.digest;
  if (value.digest !== digest(body)) throw new TypeError("child receipt digest mismatch");
  return value;
}

async function normalize(raw, descriptor, context) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("handler output must be an object");
  if (raw.effects?.some((effect) => !descriptor.effects.includes(effect)))
    throw new TypeError("handler reported an undeclared effect");
  if (!Array.isArray(raw.artifacts)) throw new TypeError("handler artifacts must be an array");
  if (descriptor.declaredArtifacts) {
    for (const item of raw.artifacts) {
      if (!descriptor.declaredArtifacts.includes(item.artifactId))
        throw new TypeError("handler returned an undeclared artifact");
    }
  }
  const artifacts = raw.artifacts.map((item) => artifact(item, context));
  const result = {
    schema: RESULT_SCHEMA,
    status: raw.status ?? "completed",
    context,
    effects: raw.effects ?? [],
    receipt: raw.receipt,
    evidence: raw.evidence ?? [],
    artifacts,
    output: raw.output ?? null,
    failure: raw.failure ?? null,
  };
  receipt(result.receipt, context);
  for (const item of result.evidence) {
    await assertSchema("csm-orchestrate-evidence/2", item);
    if (item.runId !== context.runId || item.owner !== context.owner)
      throw new TypeError("child evidence identity mismatch");
    const body = { ...item };
    delete body.digest;
    if (item.digest !== digest(body)) throw new TypeError("child evidence digest mismatch");
  }
  if (jsonBytes(result) > (descriptor.maxOutputBytes ?? MAX_OUTPUT_BYTES))
    throw Object.assign(new Error("handler output exceeds size limit"), {
      code: "output-too-large",
    });
  return Object.freeze(result);
}

function normalizeBlocked(raw, context, descriptor) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("blocked handler output must be an object");
  if (raw.effects?.length) throw new TypeError("blocked handler cannot report effects");
  if (raw.artifacts?.length) throw new TypeError("blocked handler cannot return artifacts");
  const result = {
    schema: RESULT_SCHEMA,
    status: "blocked",
    context,
    effects: [],
    receipt: null,
    evidence: [],
    artifacts: [],
    output: null,
    failure: raw.failure ?? { class: "policy", code: "blocked", message: "handler blocked" },
  };
  if (jsonBytes(result) > (descriptor?.maxOutputBytes ?? MAX_OUTPUT_BYTES))
    throw Object.assign(new Error("handler output exceeds size limit"), {
      code: "output-too-large",
    });
  return Object.freeze(result);
}

function makeReceipt(context, owner, status = "completed") {
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: `receipt-${context.runId.slice(4)}-${context.attempt}`,
    runId: context.runId,
    owner,
    attempt: context.attempt,
    status,
  };
  return { ...body, digest: digest(body) };
}

function makeArtifact(artifactId, schema, value, context) {
  const body = {
    artifactId,
    schema,
    runId: context.runId,
    owner: context.owner,
    bytes: jsonBytes(value),
    value,
  };
  return { ...body, digest: digest(body) };
}

function directAdapter(skill, invoke) {
  return async ({ input, signal, context, trustedBindings }) => {
    if (!context) throw new TypeError("child context is required");
    if (signal?.aborted)
      return {
        status: "cancelled",
        effects: [],
        artifacts: [],
        receipt: makeReceipt(context, skill, "incomplete"),
        failure: failure("cancelled", "execution cancelled before dispatch"),
      };
    const output = await invoke(input ?? {}, signal, context, { trustedBindings });
    if (signal?.aborted)
      return {
        status: "cancelled",
        effects: [],
        artifacts: [],
        receipt: makeReceipt(context, skill, "incomplete"),
        failure: failure("cancelled", "execution cancelled"),
      };
    return output;
  };
}

export function createExecutorHandlers({ csmBuildHandoff = null, csmBuildHandoffs = [] } = {}) {
  const handlers = new Map();
  const handoffs = [
    ...(Array.isArray(csmBuildHandoffs) ? csmBuildHandoffs : Object.values(csmBuildHandoffs ?? {})),
    ...(csmBuildHandoff ? [csmBuildHandoff] : []),
  ];
  handlers.set(
    "csm-ddd",
    directAdapter("csm-ddd", async (input, signal, context) => {
      const analysis = await analyzeRepository({ ...input, runId: context.runId, signal });
      return {
        output: { runId: analysis.runId, repoName: analysis.repoName },
        effects: ["read-only"],
        artifacts: [
          makeArtifact(
            `${context.runId}-ddd-report`,
            "csm-ddd-report/1",
            analysis.reportObject,
            context,
          ),
          makeArtifact(
            `${context.runId}-ddd-graph`,
            "csm-ddd-graph/1",
            analysis.graphObject,
            context,
          ),
        ],
        receipt: makeReceipt(context, "csm-ddd"),
        evidence: [],
      };
    }),
  );
  handlers.set(
    "csm-scan",
    directAdapter("csm-scan", async (input, signal, context) => {
      const result = await runExpandedPipeline({
        ...input,
        repos: input.repos,
        out: undefined,
        sink: async (findings) => findings,
        signal,
        runId: context.runId,
      });
      return {
        output: {
          generated: result.generated,
          expectedClaimCoverage: result.expectedClaimCoverage,
        },
        effects: ["read-only"],
        artifacts: [
          makeArtifact(`${context.runId}-norms`, "csm-norms/1", result.findings, context),
        ],
        receipt: makeReceipt(context, "csm-scan"),
        evidence: [],
      };
    }),
  );
  handlers.set(
    "csm-upload",
    directAdapter("csm-upload", async (input, signal, context, request) => {
      if (signal?.aborted)
        throw Object.assign(new Error("execution cancelled"), { code: "cancelled" });
      const publicationBinding = request.trustedBindings;
      if (
        !publicationBinding ||
        !Object.hasOwn(publicationBinding, "destination") ||
        !Object.hasOwn(publicationBinding, "executor")
      )
        throw Object.assign(new Error("explicit publication binding is required"), {
          code: "publication-binding-required",
        });
      const published = await publishPublicationDescriptor(input.descriptor, {
        root: input.root,
        destination: publicationBinding.destination,
        confirm: input.confirm === true,
        executor: publicationBinding.executor,
      });
      return {
        output: published,
        effects: ["publication", "external-side-effect", "credential-use"],
        artifacts: [
          makeArtifact(
            `${context.runId}-publication`,
            "csm-upload-publication/1",
            published,
            context,
          ),
        ],
        receipt: makeReceipt(context, "csm-upload"),
        evidence: [],
      };
    }),
  );
  for (const skill of ["csm-autoresearch", "csm-browse"]) {
    handlers.set(skill, async () => ({
      status: "blocked",
      effects: [],
      artifacts: [],
      receipt: null,
      failure: failure("unsupported-runtime", `${skill} requires its approved host adapter`),
    }));
  }
  for (const handoff of handoffs) {
    if (typeof handoff?.execute !== "function")
      throw new TypeError("csm-build handoff adapter is required");
    for (const skill of csmBuildOwnedSkills())
      if (handoff.skill === skill)
        handlers.set(skill, async ({ input, signal, context }) => {
          const result = await handoff.execute(
            {
              invocationId: context.invocationId,
              parentRunId: context.parentRunId,
              childRunId: context.runId,
              phaseId: context.phaseId,
              edgeId: context.edgeId,
              skill,
              input,
              retry: { attempt: context.attempt },
            },
            signal,
          );
          if (result.status === "cancelled")
            return {
              status: "cancelled",
              effects: [],
              artifacts: [],
              receipt: makeReceipt(context, skill, "incomplete"),
              failure: result.failure,
            };
          return {
            status: result.status ?? "completed",
            effects: result.effects ?? handoff.effects,
            artifacts: result.artifacts ?? [],
            evidence: result.evidence ?? [],
            output: result.output ?? null,
            receipt: result.receipt ?? makeReceipt(context, skill, result.status ?? "completed"),
            failure: result.failure ?? null,
          };
        });
  }
  return Object.freeze(handlers);
}

export async function executeSkill(
  skill,
  request,
  { handlers = createExecutorHandlers(), descriptor, trustedBindings = null } = {},
) {
  const handler = handlers.get(skill);
  if (typeof handler !== "function")
    return {
      status: "blocked",
      failure: failure("unsupported-handler", `${skill} is not registered`),
    };
  const context = contextOf(request);
  if (request.signal?.aborted)
    return {
      status: "cancelled",
      failure: failure("cancelled", "execution cancelled before dispatch"),
    };
  try {
    const raw = await handler({ ...request, context, trustedBindings });
    if (raw.status === "blocked") return normalizeBlocked(raw, context, descriptor);
    return await normalize(
      raw,
      descriptor ?? { effects: raw.effects ?? [], maxOutputBytes: MAX_OUTPUT_BYTES },
      context,
    );
  } catch (error) {
    return {
      status: error.code === "cancelled" ? "cancelled" : "failed",
      failure: failure(error.code ?? "handler-failed", error.message),
    };
  }
}

export async function normalizeChildResult(result, descriptor, context) {
  contextOf({ context });
  return normalize(result, descriptor, context);
}

export function selectExecutorHandler(skill, { handlers = createExecutorHandlers() } = {}) {
  return handlers.get(skill) ?? null;
}

export function createExecutorDescriptors({
  handlers = createExecutorHandlers(),
  csmBuildHandoff = null,
  csmBuildHandoffs = [],
} = {}) {
  const direct = ["csm-ddd", "csm-scan", "csm-upload"];
  const handoffs = [
    ...(Array.isArray(csmBuildHandoffs) ? csmBuildHandoffs : Object.values(csmBuildHandoffs ?? {})),
    ...(csmBuildHandoff ? [csmBuildHandoff] : []),
  ];
  const handoffFor = (skill) => handoffs.find((item) => item?.skill === skill);
  const owned = handoffs.map((item) => item?.skill).filter((skill) => skill && handlers.has(skill));
  return [...direct, ...owned]
    .filter((skill) => handlers.has(skill))
    .map((skill) => {
      const capability = canonicalCapabilities.skills.find((item) => item.skill === skill);
      if (!capability) throw new TypeError(`missing canonical capability metadata for ${skill}`);
      const base = {
        schema: "csm-orchestrate-skill-executor/1",
        version: 1,
        skill,
        handlerDigest: owned.includes(skill)
          ? handoffFor(skill).handlerDigest
          : digest({ skill, implementation: "direct-adapter/1" }),
        inputSchemaDigest: owned.includes(skill)
          ? handoffFor(skill).inputSchemaDigest
          : digest({ skill, schema: "input/1" }),
        outputSchemaDigest: owned.includes(skill)
          ? handoffFor(skill).outputSchemaDigest
          : digest({ schema: RESULT_SCHEMA }),
        receiptSchemaDigest: digest({ schema: "csm-orchestrate-child-receipt/1" }),
        evidenceSchemaDigest: digest({ schema: "csm-orchestrate-evidence/2" }),
        effectiveConfigDigest: owned.includes(skill)
          ? handoffFor(skill).effectiveConfigDigest
          : digest({ skill, config: "default/1" }),
        permissions: [...capability.permissions],
        effects: [...capability.effects],
        cancellation: "cooperative",
        idempotency: skill === "csm-upload" ? "forbidden" : "natural",
        handler: handlers.get(skill),
      };
      return { ...base, contractDigest: skillExecutorContractDigest(base) };
    });
}

export { MAX_OUTPUT_BYTES, RESULT_SCHEMA };
