"use strict";

import { createHash } from "node:crypto";
import { validateRequest, validateResponse } from "../protocol/index.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function approval(value) {
  if (
    !value ||
    value.status !== "approved" ||
    typeof value.approver !== "string" ||
    value.approver.length === 0 ||
    typeof value.reason !== "string" ||
    value.reason.length === 0
  ) {
    throw new TypeError("explicit approval metadata is required");
  }
  return { status: value.status, approver: value.approver, reason: value.reason };
}

function createRegisteredProvider({
  registry,
  evaluatorHash,
  environmentHash,
  limits,
  approval: approvalMetadata,
  isolation = "trusted-in-process",
} = {}) {
  if (!registry || typeof registry !== "object")
    throw new TypeError("registered registry is required");
  if (!HASH.test(evaluatorHash ?? "") || !HASH.test(environmentHash ?? ""))
    throw new TypeError("provider hashes must be sha256");
  const approved = approval(approvalMetadata);
  if (isolation !== "trusted-in-process")
    throw new TypeError("registered callables require the explicit trusted-in-process posture");
  const entries = new Map(
    Object.entries(registry).map(([id, entry]) => {
      if (!entry || typeof entry.callable !== "function" || !HASH.test(entry.sourceHash ?? ""))
        throw new TypeError(`invalid registered entry: ${id}`);
      return [id, Object.freeze({ callable: entry.callable, sourceHash: entry.sourceHash })];
    }),
  );
  return Object.freeze({
    mode: "registered",
    approval: approved,
    async evaluate(request) {
      validateRequest(request);
      const entry = entries.get(request.candidate.id);
      if (!entry || request.candidate.sourceHash !== entry.sourceHash)
        return response(
          request,
          "policy_violation",
          ["registered identity or source hash mismatch"],
          evaluatorHash,
          environmentHash,
          limits,
        );
      try {
        // Registered callables are trusted code, not a sandbox. Freeze the input and
        // keep the trust claim explicit so this provider cannot be mistaken for host isolation.
        const input =
          request.input && typeof request.input === "object"
            ? Object.freeze(request.input)
            : request.input;
        const result = await entry.callable(input);
        const metrics = typeof result === "number" ? { score: result } : result;
        if (
          !metrics ||
          typeof metrics !== "object" ||
          Array.isArray(metrics) ||
          Object.values(metrics).some(
            (value) => typeof value !== "number" || !Number.isFinite(value),
          )
        )
          return response(
            request,
            "invalid",
            ["registered callable returned invalid metrics"],
            evaluatorHash,
            environmentHash,
            limits,
          );
        return response(request, "ok", [], evaluatorHash, environmentHash, limits, metrics);
      } catch (error) {
        return response(
          request,
          "failed",
          [String(error?.message ?? "registered callable failed").slice(0, 2000)],
          evaluatorHash,
          environmentHash,
          limits,
        );
      }
    },
  });
}

function response(
  request,
  status,
  diagnostics,
  evaluatorHash,
  environmentHash,
  limits = {},
  metrics = {},
) {
  const value = {
    format: "csm-autoresearch-evaluator-response/1",
    requestId: request.requestId,
    runId: request.runId,
    status,
    valid: status === "ok",
    metrics,
    diagnostics,
    provenance: {
      evaluatorHash,
      environmentHash,
      limits: { ...limits, trust: "trusted-in-process-no-os-isolation" },
      redacted: true,
    },
  };
  validateResponse(value);
  return value;
}

export { createRegisteredProvider, hash };
