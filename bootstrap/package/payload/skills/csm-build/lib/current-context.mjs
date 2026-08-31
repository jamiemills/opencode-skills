"use strict";

import { digest } from "../../../lib/schema-runtime/index.mjs";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  completeBuild,
  createArtifactDescriptor,
  createBuildState,
  dispatchBuild,
  resolveBuildInputs,
  transitionBuildState,
} from "./state.mjs";

const OUTPUT_SCHEMA = "csm-build-output/1";
const failure = (code, message, errorClass = "policy") => ({ class: errorClass, code, message });

function sharedArtifact(native, runId, owner) {
  const body = {
    artifactId: `art-${runId.slice(4)}-shared-${native.artifactId}`,
    schema: native.schema ?? "csm-build-artifact/1",
    runId,
    owner,
    nativeRunId: native.runId,
    nativeArtifactId: native.artifactId,
    sourceArtifactId: native.artifactId,
    bytes: native.bytes ?? 0,
    value: native,
  };
  return { ...body, digest: digest(body) };
}

function identityOf(request) {
  return {
    invocationId: request.invocationId,
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    phaseId: request.phaseId,
    edgeId: request.edgeId,
    skill: request.skill,
    digest:
      request.requestIdentity?.digest ??
      digest({
        invocationId: request.invocationId,
        parentRunId: request.parentRunId,
        childRunId: request.childRunId,
        phaseId: request.phaseId,
        edgeId: request.edgeId,
        skill: request.skill,
      }),
  };
}

async function validateNativeArtifact(item, { root, runId, owner }) {
  if (
    !item ||
    typeof item !== "object" ||
    item.schema !== "csm-build-artifact/1" ||
    typeof item.artifactId !== "string" ||
    typeof item.kind !== "string" ||
    item.runId !== runId ||
    item.owner !== owner ||
    !/^sha256:[a-f0-9]{64}$/.test(item.digest ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(item.descriptorDigest ?? "") ||
    typeof item.path !== "string" ||
    typeof item.contentType !== "string" ||
    !Array.isArray(item.sourceArtifactIds)
  )
    throw new TypeError("native build artifact descriptor is invalid");
  const rootPath = await realpath(resolve(root));
  const artifactPath = resolve(rootPath, item.path);
  const pathFromRoot = relative(rootPath, artifactPath);
  if (isAbsolute(item.path) || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot))
    throw new TypeError("native build artifact path is not contained");
  const contentPath = await realpath(artifactPath);
  const realPathFromRoot = relative(rootPath, contentPath);
  if (realPathFromRoot.startsWith("..") || isAbsolute(realPathFromRoot))
    throw new TypeError("native build artifact path is not contained");
  const content = await readFile(contentPath);
  if (item.bytes !== content.byteLength)
    throw new TypeError(`native build artifact byte count mismatch: ${item.artifactId}`);
  if (item.digest !== `sha256:${createHash("sha256").update(content).digest("hex")}`)
    throw new TypeError(`native build artifact content digest mismatch: ${item.artifactId}`);
  const descriptor = Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== "descriptorDigest"),
  );
  if (item.descriptorDigest !== digest(descriptor))
    throw new TypeError(`native build artifact descriptor digest mismatch: ${item.artifactId}`);
  return item;
}

function outputBase(
  request,
  resolved,
  state,
  status,
  output,
  effects,
  artifacts,
  evidence,
  delivery,
  failureValue = null,
) {
  return {
    schema: OUTPUT_SCHEMA,
    skill: request.skill,
    attempt: request.retry?.attempt ?? request.attempt,
    requestIdentity: identityOf(request),
    inputSchemaDigest: request.inputSchemaDigest,
    outputSchemaDigest: request.outputSchemaDigest,
    status,
    effects,
    artifacts,
    evidence,
    output,
    outputDigest: digest(output),
    state,
    inputs: resolved?.inputs ?? [],
    delivery,
    failure: failureValue,
  };
}

export function createCsmBuildCurrentContextCaller({
  execute,
  resolveInputs = resolveBuildInputs,
  root = process.cwd(),
  now = () => new Date().toISOString(),
  workspace = null,
} = {}) {
  if (typeof execute !== "function")
    throw new TypeError("current-context csm-build executor is required");
  if (typeof resolveInputs !== "function")
    throw new TypeError("csm-build input resolver is required");

  return Object.freeze({
    async execute(request, signal) {
      const attempt = request.retry?.attempt ?? request.attempt;
      const identity = identityOf(request);
      const delivery = {
        requestDigest: digest(
          Object.fromEntries(
            Object.entries(request).filter(
              ([key, value]) => key !== "status" && key !== "requestDigest" && value !== undefined,
            ),
          ),
        ),
        inputDigests: [],
        workspace: workspace ?? request.input?.workspace ?? null,
        nativeArtifacts: [],
      };
      const empty = (status, failureValue, state = null, resolved = null) =>
        outputBase(request, resolved, state, status, null, [], [], [], delivery, failureValue);
      if (signal?.aborted)
        return empty("cancelled", failure("cancelled", "execution cancelled before dispatch"));

      const input = request.input ?? {};
      const resolved = await resolveInputs(input, { root });
      if (resolved.status !== "resolved")
        return empty("blocked", failure(resolved.code, resolved.message), null, resolved);
      delivery.inputDigests = resolved.inputs.map((item) => item.digest);
      const plan = resolved.values.plan.value;
      let state = createBuildState({
        runId: request.childRunId,
        artifactId: `art-${request.childRunId.slice(4)}-build`,
        sourcePlan: { artifactId: plan.artifactId, digest: resolved.values.plan.digest },
        timestamp: now(),
      });
      state = transitionBuildState(state, "VALIDATE", {
        timestamp: now(),
        evidence: "current-context inputs validated",
        inputDigests: delivery.inputDigests,
      });
      state = transitionBuildState(state, "SELECT", {
        timestamp: now(),
        evidence: "current-context route selected",
      });
      const selected = dispatchBuild(state, resolved);
      state = selected;
      if (signal?.aborted)
        return empty(
          "cancelled",
          failure("cancelled", "execution cancelled before dispatch"),
          state,
          resolved,
        );

      let raw;
      try {
        raw = await execute({
          skill: request.skill,
          identity: Object.freeze(identity),
          attempt,
          inputs: resolved.values,
          inputDescriptors: resolved.inputs,
          state,
          workspace: delivery.workspace,
          signal,
        });
      } catch (error) {
        return empty(
          error.code === "cancelled" ? "cancelled" : "failed",
          failure(error.code ?? "current-context-failed", error.message, "execution"),
          state,
          resolved,
        );
      }
      if (!raw || typeof raw !== "object")
        return empty(
          "failed",
          failure(
            "malformed-delivery",
            "current-context executor returned no delivery",
            "delivery",
          ),
          state,
          resolved,
        );
      const nativeArtifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
      let validatedNativeArtifacts;
      try {
        validatedNativeArtifacts = await Promise.all(
          nativeArtifacts.map((item) =>
            validateNativeArtifact(item, { root, runId: request.childRunId, owner: request.skill }),
          ),
        );
      } catch (error) {
        return empty(
          "failed",
          failure("malformed-delivery", error.message, "delivery"),
          state,
          resolved,
        );
      }
      delivery.nativeArtifacts = validatedNativeArtifacts;
      const artifacts = validatedNativeArtifacts.map((item) =>
        sharedArtifact(item, request.childRunId, request.skill),
      );
      const effects = raw.effects ?? [];
      if (effects.some((effect) => !["workspace-write", "read-only"].includes(effect)))
        return empty(
          "failed",
          failure(
            "undeclared-effect",
            "current-context executor reported an undeclared effect",
            "delivery",
          ),
          state,
          resolved,
        );
      if (signal?.aborted)
        return outputBase(
          request,
          resolved,
          state,
          "cancelled",
          raw.output ?? null,
          [],
          artifacts,
          raw.evidence ?? [],
          delivery,
          failure("cancelled", "execution cancelled", "execution"),
        );
      if (raw.status && raw.status !== "completed")
        return outputBase(
          request,
          resolved,
          state,
          raw.status,
          raw.output ?? null,
          effects,
          artifacts,
          raw.evidence ?? [],
          delivery,
          raw.failure ?? null,
        );
      for (const target of ["INTEGRATE", "VERIFY", "REVIEW", "CHECKPOINT"])
        state = transitionBuildState(state, target, {
          timestamp: now(),
          evidence: `current-context ${target.toLowerCase()} complete`,
        });
      const evidence = raw.evidence ?? [];
      const completionEvidence = evidence.length
        ? evidence
        : [
            createArtifactDescriptor({
              artifactId: `${request.childRunId}-delivery`,
              kind: "delivery-evidence",
              runId: request.childRunId,
              digest: digest(raw.output ?? null),
              path: ".agents/build/current-context-delivery.json",
              sourceArtifactIds: validatedNativeArtifacts.map((item) => item.artifactId),
            }),
          ];
      state = completeBuild(state, { evidence: completionEvidence, verifiedAt: now() });
      return outputBase(
        request,
        resolved,
        state,
        raw.status ?? "completed",
        raw.output ?? null,
        effects,
        artifacts,
        evidence,
        delivery,
      );
    },
  });
}

export { OUTPUT_SCHEMA as CSM_BUILD_OUTPUT_SCHEMA };
