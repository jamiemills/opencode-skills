"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { optimize } from "../../csm-autoresearch/lib/optimizer/index.mjs";
import { hash } from "../../csm-autoresearch/lib/ledger/index.mjs";
import { promote, rollback } from "../../csm-autoresearch/lib/population/index.mjs";
import {
  createArtifactDescriptor,
  sharedRunId,
} from "../../csm-autoresearch/lib/artifacts/index.mjs";
import { readFile, realpath } from "node:fs/promises";
import { validateProducerArtifacts } from "../../csm-autoresearch/lib/artifacts/index.mjs";

const HASH = /^sha256:[a-f0-9]{64}$/;
const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const failure = (code, message) => ({ class: "policy", code, message });

function receipt(context, status = "completed") {
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: `receipt-${context.runId.slice(4)}-${context.attempt}`,
    runId: context.runId,
    owner: "csm-autoresearch",
    attempt: context.attempt,
    status,
  };
  return { ...body, digest: digest(body) };
}

function artifactRef({ context, native, descriptor, path, value }) {
  const body = {
    artifactId: descriptor.artifact.artifactId,
    schema: descriptor.schema,
    runId: context.runId,
    owner: "csm-autoresearch",
    bytes: Buffer.byteLength(JSON.stringify(value)),
    value,
    path,
    resolution: "resolver-required",
    sourceArtifactId: descriptor.artifact.artifactId,
    sourceRunId: context.runId,
    nativeRunId: native,
    nativeArtifactId: descriptor.artifact.artifactId,
  };
  return { ...body, digest: digest(body) };
}

function assertHash(value, name) {
  if (!HASH.test(value ?? "") || /^sha256:0{64}$/.test(value))
    throw new TypeError(`${name} must be an evidence-bound sha256 hash`);
}

function assertContext(context) {
  if (!context?.runId || context.owner !== "csm-autoresearch")
    throw new TypeError("autoresearch child context is required");
}

function providerFor(providers, mode) {
  const provider = providers?.[mode] ?? (providers?.mode === mode ? providers : null);
  if (!provider || typeof provider.evaluate !== "function" || provider.mode !== mode)
    throw Object.assign(new Error(`${mode} provider is not injected`), {
      code: "provider-required",
    });
  return provider;
}

async function nativeArtifacts(result, native, context, artifactRoot) {
  const { paths } = result;
  const root = await realpath(resolve(artifactRoot));
  const contained = async (path) => {
    const absolute = resolve(path);
    const relativePath = relative(root, absolute);
    if (relativePath.startsWith("..") || isAbsolute(relativePath))
      throw new TypeError("autoresearch artifact path is not contained");
    const actual = await realpath(absolute);
    const actualRelativePath = relative(root, actual);
    if (actualRelativePath.startsWith("..") || isAbsolute(actualRelativePath))
      throw new TypeError("autoresearch artifact path is not contained");
    return actual;
  };
  const ledgerPath = await contained(paths.ledger);
  const reportPath = await contained(paths.report);
  const manifestPath = await contained(paths.manifest);
  const { manifest, report } = await validateProducerArtifacts({
    ledgerPath,
    reportPath,
    manifestPath,
    nativeRunId: native,
  });
  const manifestBytes = await readFile(manifestPath);
  const reportDescriptor = manifest.artifactDescriptors.find(
    (descriptor) => descriptor.artifact.kind === "autoresearch-report",
  );
  const ledgerDescriptor = manifest.artifactDescriptors.find(
    (descriptor) => descriptor.artifact.kind === "autoresearch-ledger",
  );
  const manifestDescriptor = createArtifactDescriptor({
    nativeRunId: native,
    kind: "autoresearch-manifest",
    digest: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
    location: manifestPath.replace(/^\//, ""),
    contentType: "application/json",
    lifecycleStatus: report.status === "blocked" ? "blocked" : "completed",
    createdAt: new Date().toISOString(),
    sourceArtifactIds: [reportDescriptor.artifact.artifactId],
  });
  const envelope = manifest.envelope;
  const values = [
    {
      descriptor: ledgerDescriptor,
      value: { nativeRunId: native, sharedRunId: context.runId, manifest, report },
      path: ledgerPath,
    },
    {
      descriptor: reportDescriptor,
      value: { nativeRunId: native, sharedRunId: context.runId, report, manifest, envelope },
      path: reportPath,
    },
    {
      descriptor: manifestDescriptor,
      value: { nativeRunId: native, sharedRunId: context.runId, manifest },
      path: manifestPath,
    },
  ];
  return values.map((item) => artifactRef({ ...item, context, native }));
}

function createCsmAutoresearchAdapter({ providers, optimizeRun = optimize, promotion = {} } = {}) {
  if (!providers || typeof providers !== "object")
    throw new TypeError("autoresearch providers are required");
  const execute = async ({ input = {}, signal, context }) => {
    assertContext(context);
    if (signal?.aborted)
      return {
        status: "cancelled",
        effects: [],
        artifacts: [],
        receipt: receipt(context, "incomplete"),
        failure: failure("cancelled", "execution cancelled before dispatch"),
      };
    if (typeof input.evaluate === "function")
      throw new TypeError("evaluator callback must be host-injected");
    const contract = structuredClone(input.contract);
    if (!contract || !NATIVE_ID.test(contract.runId))
      throw new TypeError("native autoresearch runId is required");
    const native = contract.runId;
    if (sharedRunId(native) !== context.runId)
      throw new TypeError("native and shared run IDs are not bound");
    const mode = contract.source?.mode;
    const provider = providerFor(providers, mode);
    if (mode === "trusted-local" && provider.trust !== "trusted-process-no-os-isolation")
      throw new TypeError("trusted-local provider must declare weaker process trust");
    if (mode === "generated") {
      const controls = {
        network: contract.policy.execution.network,
        mounts: [],
        evaluatorAssets: contract.policy.execution.evaluatorAssets,
        credentials: contract.policy.execution.credentials,
        limits: contract.policy.execution.limits,
      };
      if (
        !provider.sandboxAttestation ||
        typeof provider.verifySandboxAttestation !== "function" ||
        provider.verifySandboxAttestation(provider.sandboxAttestation, controls) !== true
      )
        throw new TypeError("generated provider must be host-attested");
    }
    const policyHash = hash(contract.policy);
    const contractHash = hash(contract);
    assertHash(policyHash, "policyHash");
    assertHash(contractHash, "contractHash");
    const evaluatorHash = input.evaluatorHash ?? provider.evaluatorHash;
    const environmentHash = input.environmentHash ?? provider.environmentHash;
    assertHash(evaluatorHash, "evaluatorHash");
    assertHash(environmentHash, "environmentHash");
    const evaluate = async (candidate, details) => {
      if (signal?.aborted)
        throw Object.assign(new Error("candidate evaluation cancelled"), { code: "cancelled" });
      return provider.evaluate({
        format: "csm-autoresearch-evaluator-request/1",
        requestId: `${context.runId}-${candidate.id}-${details.attempt ?? 0}`,
        runId: native,
        candidate,
        limits: { ...contract.policy.execution.limits, network: "disabled" },
        input: input.evaluatorInput ?? input.value ?? {},
      });
    };
    const result = await optimizeRun({
      contract,
      policy: contract.policy,
      evaluate,
      candidates: input.candidates ?? [],
      baseline: input.baseline,
      ledgerRoot: input.artifactRoot ?? ".agents/autoresearch",
      retryLimit: input.retryLimit ?? 0,
      contractHash,
      evaluatorHash,
      environmentHash,
      policyHash,
      now: input.now ? new Date(input.now) : new Date(),
    });
    if (signal?.aborted)
      return {
        status: "incomplete",
        effects: [],
        artifacts: [],
        receipt: receipt(context, "incomplete"),
        failure: failure("cancelled", "candidate dispatch became ambiguous"),
      };
    const artifactRoot = input.artifactRoot ?? ".agents/autoresearch";
    const artifacts = await nativeArtifacts(result, native, context, artifactRoot);
    return {
      status: "completed",
      effects: ["workspace-write"],
      artifacts,
      output: {
        nativeRunId: native,
        sharedRunId: context.runId,
        evaluatorHash,
        contractHash,
        policyHash,
        sourceMode: mode,
        artifactRoot: input.artifactRoot ?? ".agents/autoresearch",
        report: result.report,
        manifest: result.manifest,
        candidateHashes: (input.candidates ?? []).map((candidate) => ({
          id: candidate.id,
          hash: hash(candidate),
        })),
        quarantine: result.report.trials.filter((trial) => trial.decision === "quarantine"),
        promotion: "human-approval-required",
        rollback: result.report.rollback ?? null,
        rollbackBoundary: "exact-before-state-required",
      },
      receipt: receipt(context),
      evidence: [],
    };
  };
  const promoteCandidate = async (request) => {
    if (request?.approval?.approved !== true)
      throw new Error("human approval is required for promotion");
    return (promotion.promote ?? promote)(request);
  };
  const rollbackCandidate = async (request) => {
    return (promotion.rollback ?? rollback)(request);
  };
  return Object.freeze({ execute, promote: promoteCandidate, rollback: rollbackCandidate });
}

export { createCsmAutoresearchAdapter };
