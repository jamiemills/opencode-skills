"use strict";

import { createHash } from "node:crypto";
import { validateRequest, validateResponse } from "../protocol/index.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_LIMITS = ["timeoutMs", "maxOutputBytes", "maxWorkspaceBytes"];
const HOST_CAPABILITY = Symbol("host-owned-sandbox-capability");

export function createHostSandboxCapability({ attest, verifyCleanup, verifyLimits } = {}) {
  if (
    typeof attest !== "function" ||
    typeof verifyCleanup !== "function" ||
    typeof verifyLimits !== "function"
  )
    throw new TypeError("sandbox capability attestation functions are required");
  return Object.freeze({
    [HOST_CAPABILITY]: true,
    attest,
    verifyCleanup,
    verifyLimits,
  });
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function response(
  request,
  status,
  diagnostics,
  evaluatorHash,
  environmentHash,
  limits,
  sandboxProvider,
  metricValues = {},
) {
  const value = {
    format: "csm-autoresearch-evaluator-response/1",
    requestId: request.requestId,
    runId: request.runId,
    status,
    valid: status === "ok",
    metrics: metricValues,
    diagnostics,
    provenance: {
      evaluatorHash,
      environmentHash,
      limits: { ...limits },
      redacted: true,
      sandboxProvider,
    },
  };
  validateResponse(value);
  return value;
}

function policyChecks({
  sandbox,
  network,
  mounts,
  evaluatorAssets,
  credentials,
  limits,
  cleanup,
} = {}) {
  const checks = [];
  if (!sandbox || typeof sandbox.execute !== "function")
    checks.push("sandbox provider is required");
  if (network !== "disabled") checks.push("network must be disabled");
  if (!Array.isArray(mounts) || mounts.length !== 0) checks.push("candidate mounts must be empty");
  if (evaluatorAssets !== "isolated") checks.push("evaluator assets must be isolated");
  if (credentials !== "none") checks.push("credentials must be absent");
  if (!limits || REQUIRED_LIMITS.some((key) => !Number.isInteger(limits[key]) || limits[key] < 1))
    checks.push("bounded execution limits are required");
  if (!cleanup || cleanup.supported !== true || cleanup.verifiable !== true)
    checks.push("verifiable cleanup metadata is required");
  return checks;
}

function metrics(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "number" || !Number.isFinite(item))
  )
    return null;
  return value;
}

function hostAttestation({
  sandbox,
  hostCapability,
  sandboxProvider,
  limits,
  network,
  mounts,
  evaluatorAssets,
  credentials,
}) {
  if (
    !hostCapability ||
    hostCapability[HOST_CAPABILITY] !== true ||
    typeof hostCapability.attest !== "function" ||
    typeof hostCapability.verifyCleanup !== "function" ||
    typeof hostCapability.verifyLimits !== "function"
  )
    return { diagnostics: ["host-owned sandbox capability is required"] };
  if (sandbox?.capability !== hostCapability)
    return { diagnostics: ["sandbox capability is not host-bound"] };
  let evidence;
  try {
    evidence = hostCapability.attest({
      sandbox,
      provider: sandboxProvider,
      limits: { ...limits },
      network,
      mounts: [...mounts],
      evaluatorAssets,
      credentials,
    });
  } catch (error) {
    return {
      diagnostics: [
        `sandbox attestation failed: ${String(error?.message ?? "host attestation failed").slice(0, 2000)}`,
      ],
    };
  }
  if (
    !evidence ||
    evidence.provider !== sandboxProvider ||
    evidence.network !== "disabled" ||
    evidence.mounts?.length !== 0 ||
    evidence.evaluatorAssets !== "isolated" ||
    evidence.credentials !== "none" ||
    hostCapability.verifyLimits(evidence, limits) !== true
  )
    return { diagnostics: ["host sandbox attestation is invalid"] };
  return { evidence };
}

function createGeneratedProvider({
  sandbox,
  evaluatorHash,
  environmentHash,
  limits,
  approval,
  hostCapability,
  network = "disabled",
  mounts = [],
  evaluatorAssets = "isolated",
  credentials = "none",
  sandboxProvider = "unverified",
} = {}) {
  if (!HASH.test(evaluatorHash ?? "") || !HASH.test(environmentHash ?? ""))
    throw new TypeError("provider hashes must be sha256");
  if (
    !approval ||
    approval.status !== "approved" ||
    typeof approval.approver !== "string" ||
    !approval.approver ||
    typeof approval.reason !== "string" ||
    !approval.reason
  )
    throw new TypeError("explicit approval metadata is required");
  const diagnostics = policyChecks({
    sandbox,
    network,
    mounts,
    evaluatorAssets,
    credentials,
    limits,
    cleanup: { supported: true, verifiable: true },
  });
  if (!sandbox || sandbox.name !== sandboxProvider)
    diagnostics.push("sandbox provider identity is not bound");
  const attestation = hostAttestation({
    sandbox,
    hostCapability,
    sandboxProvider,
    limits,
    network,
    mounts,
    evaluatorAssets,
    credentials,
  });
  diagnostics.push(...(attestation.diagnostics ?? []));
  const provider = Object.freeze({
    mode: "generated",
    sandboxProvider,
    sandboxVerified: diagnostics.length === 0,
    sandboxAttestation: attestation.evidence ?? null,
    verifySandboxAttestation(value, controls) {
      return (
        value === attestation.evidence &&
        value?.provider === sandboxProvider &&
        value?.network === controls.network &&
        value?.evaluatorAssets === controls.evaluatorAssets &&
        value?.credentials === controls.credentials &&
        Array.isArray(value?.mounts) &&
        value.mounts.length === controls.mounts.length &&
        value.mounts.every((mount, index) => mount === controls.mounts[index]) &&
        hostCapability.verifyLimits(value, controls.limits) === true
      );
    },
    approval: { status: approval.status, approver: approval.approver, reason: approval.reason },
    policy: Object.freeze({
      network,
      mounts: [...mounts],
      evaluatorAssets,
      credentials,
      limits: { ...limits },
      cleanup: { supported: true, verifiable: true },
    }),
    async evaluate(request) {
      validateRequest(request);
      if (diagnostics.length > 0)
        return response(
          request,
          "sandbox_unavailable",
          diagnostics,
          evaluatorHash,
          environmentHash,
          limits ?? {},
          sandboxProvider,
        );
      const source = request.input?.source;
      if (typeof source !== "string" || source.length === 0)
        return response(
          request,
          "policy_violation",
          ["generated source is required"],
          evaluatorHash,
          environmentHash,
          limits,
          sandboxProvider,
        );
      if (request.candidate.sourceHash !== hash(source))
        return response(
          request,
          "policy_violation",
          ["generated source hash mismatch"],
          evaluatorHash,
          environmentHash,
          limits,
          sandboxProvider,
        );
      try {
        const result = await sandbox.execute({
          source,
          input: request.input?.value,
          limits: { ...limits },
          policy: provider.policy,
        });
        let cleanupVerified = false;
        try {
          cleanupVerified =
            result && hostCapability.verifyCleanup(result, attestation.evidence) === true;
        } catch {
          cleanupVerified = false;
        }
        if (!cleanupVerified)
          return response(
            request,
            "blocked",
            ["host could not verify sandbox cleanup"],
            evaluatorHash,
            environmentHash,
            limits,
            sandboxProvider,
          );
        if (result.status !== "ok")
          return response(
            request,
            result.status,
            result.diagnostics ?? ["sandbox execution failed"],
            evaluatorHash,
            environmentHash,
            limits,
            sandboxProvider,
          );
        const value = metrics(result.metrics);
        return value
          ? response(
              request,
              "ok",
              [],
              evaluatorHash,
              environmentHash,
              limits,
              sandboxProvider,
              value,
            )
          : response(
              request,
              "invalid",
              ["generated source returned invalid metrics"],
              evaluatorHash,
              environmentHash,
              limits,
              sandboxProvider,
            );
      } catch (error) {
        return response(
          request,
          "failed",
          [String(error?.message ?? "sandbox execution failed").slice(0, 2000)],
          evaluatorHash,
          environmentHash,
          limits,
          sandboxProvider,
        );
      }
    },
  });
  return provider;
}

function probeSandbox({ provider } = {}) {
  const limits = { timeoutMs: 1000, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 };
  const capability = provider?.capability;
  const checks = policyChecks({
    sandbox: provider,
    network: "disabled",
    mounts: [],
    evaluatorAssets: "isolated",
    credentials: "none",
    limits,
    cleanup: { supported: true, verifiable: true },
  });
  const attestation = hostAttestation({
    sandbox: provider,
    hostCapability: capability,
    sandboxProvider: provider?.name,
    limits,
    network: "disabled",
    mounts: [],
    evaluatorAssets: "isolated",
    credentials: "none",
  });
  checks.push(...(attestation.diagnostics ?? []));
  return {
    status: checks.length === 0 ? "available" : "sandbox_unavailable",
    verified: checks.length === 0,
    provider: provider?.name ?? null,
    diagnostics: checks,
  };
}

export { createGeneratedProvider, hash, policyChecks, probeSandbox };
