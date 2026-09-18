"use strict";

// Pure helpers shared by the orchestration run loop. Extracted from index.mjs
// (quality-delivery item 4); index.mjs re-exports makeAutonomousFunctionalGate
// for public API parity.
import { digest } from "../../../lib/schema-runtime/index.mjs";
import { projectChildStatus } from "./recovery.mjs";
import { validateSignal } from "./validators.mjs";

const slug = (value) =>
  (() => {
    const normalized = String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return normalized.length <= 110
      ? normalized
      : `${normalized.slice(0, 98)}-${digest(normalized).slice(7, 19)}`;
  })();

// T010: a child identity must be unique per NODE, not per (phase, skill). Two
// nodes in one phase may share a skill (same-skill read-only fan-out is allowed
// up to the capability's maxConcurrency), so nodeId is the stable discriminator
// and `phaseIndex` a deterministic tiebreaker. The retry identity extends the
// same base. The node-scoped idempotency key (`<phase.idempotency.key>:<nodeId>`)
// remains the consistency anchor for resume/reconciliation.
//
// Child ids must stay bounded: downstream contracts cap request/run ids (e.g.
// the csm-autoresearch evaluator-request `requestId` at 100 chars), so the
// readable form is used when it fits and a digest-token form when it does not.
const CHILD_RUN_ID_MAX = 96;
const boundedRunToken = (runId) => {
  const value = slug(runId);
  return value.length <= 40 ? value : `${value.slice(0, 28)}-${digest(value).slice(7, 19)}`;
};
const childRunIdForNode = (runId, phaseId, nodeId, phaseIndex) => {
  const readable = `run-${boundedRunToken(runId)}-${slug(phaseId)}-${slug(nodeId)}-${phaseIndex}`;
  if (readable.length <= CHILD_RUN_ID_MAX) return readable;
  const compact = `run-${boundedRunToken(runId)}-${digest(`${phaseId}|${nodeId}`).slice(7, 27)}-${phaseIndex}`;
  if (compact.length <= CHILD_RUN_ID_MAX) return compact;
  return `run-${boundedRunToken(runId).slice(0, 32)}-${digest(`${phaseId}|${nodeId}|${phaseIndex}`).slice(7, 27)}`;
};
const retryChildRunIdForNode = (runId, phaseId, nodeId, phaseIndex, attempt) =>
  `${childRunIdForNode(runId, phaseId, nodeId, phaseIndex)}-${attempt}`;

function jsonProjection(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol")
    return undefined;
  if (Array.isArray(value)) return value.map(jsonProjection).filter((item) => item !== undefined);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, jsonProjection(item)])
        .filter(([, item]) => item !== undefined),
    );
  return value;
}

const materialDigest = (value) =>
  digest(
    jsonProjection(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "status" && key !== "requestDigest"),
      ),
    ),
  );
const unique = (values) => [...new Set(values.filter(Boolean))];
const invocationApproval = (approval) =>
  approval?.schema === "csm-orchestrate-approval/1"
    ? { ...approval, schema: "csm-orchestrate-approval/2" }
    : approval;
const receiptApproval = (approval) =>
  approval && Array.isArray(approval.scope) && typeof approval.approvalId === "string"
    ? {
        approvalId: approval.approvalId,
        scope: [...approval.scope],
        approvedDigest: approval.approvedDigest,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        status: approval.status,
      }
    : null;
const progressByReceipt = new WeakMap();

const abortFailure = () => ({
  status: "incomplete",
  failure: { class: "timeout", code: "aborted", message: "run was aborted via kill switch" },
});

const stepCapFailure = () => ({
  status: "incomplete",
  failure: {
    class: "policy",
    code: "max-steps-exceeded",
    message: "global step cap reached",
  },
});

async function raceDeadline(promise, ms, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(code), { timeout: true })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const dispatchIntentFailure = (error) => ({
  status: "blocked",
  failure: {
    class: "policy",
    code:
      error?.name === "ReconciliationRequiredError" ? "reconciliation-required" : "stale-writer",
    message: error?.message ?? "durable dispatch intent could not be created",
  },
});

function terminalReceipt(
  runId,
  phaseId,
  approval,
  status,
  childReceipts,
  acceptanceRefs,
  extra = {},
) {
  return Object.freeze({
    schema: "csm-orchestrate-receipt/2",
    receiptId: `receipt-${slug(runId)}-${slug(phaseId)}`,
    runId,
    phaseId,
    childReceipts: [...childReceipts],
    approval: receiptApproval(approval) ?? {
      approvalId: "approval-not-supplied",
      scope: ["none"],
      approvedDigest: digest({ status }),
      approvedAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
      status: "expired",
    },
    statuses: {
      route: status === "BLOCKED" || status === "REFUSED" ? "blocked" : "complete",
      child: projectChildStatus(childReceipts),
      artifact: childReceipts.length ? "completed" : "none",
      verification:
        status === "VERIFIED" ? "verified" : status === "INCOMPLETE" ? "incomplete" : "rejected",
      parent: status === "REQUIRES_REVIEW" ? "incomplete" : status.toLowerCase(),
    },
    outcome: { status, accepted: status === "VERIFIED", acceptanceRefs: unique(acceptanceRefs) },
    idempotencyKey: digest({ runId, phaseId, status }),
    ...jsonProjection(extra),
  });
}

function childReceipt(result, node, childRunId) {
  const receipt = result?.childReceipt;
  if (!receipt || receipt.runId !== childRunId || receipt.owner !== node.skill || !receipt.digest)
    return null;
  return {
    receiptId: receipt.receiptId ?? `receipt-${slug(childRunId)}`,
    schema: receipt.schema ?? "csm-child-receipt/1",
    runId: childRunId,
    digest: receipt.digest,
    owner: node.skill,
    status: ["completed", "failed", "blocked", "incomplete"].includes(receipt.status)
      ? receipt.status
      : "completed",
  };
}

function normalizeEvidence(result, node, childRunId) {
  return (result?.evidence ?? []).map((item) => {
    if (item.runId !== childRunId || item.owner !== node.skill)
      throw new TypeError("child evidence identity does not match invocation");
    return {
      ...item,
      evidenceId: item.evidenceId,
      kind: item.kind,
      status: item.status ?? "current",
      owner: item.owner,
      runId: item.runId,
      ...(item.requirementIds ? { requirementIds: unique(item.requirementIds) } : {}),
    };
  });
}

function defaultGate(result, kind) {
  return result?.[kind] ?? [];
}
function makeAutonomousFunctionalGate(validatorBindings) {
  if (!Array.isArray(validatorBindings)) throw new TypeError("validator bindings must be an array");
  for (const binding of validatorBindings) {
    if (!binding?.validator) throw new TypeError("each validator binding requires a validator");
    if (typeof binding.artifactResolver !== "function")
      throw new TypeError("each validator binding requires an artifactResolver function");
  }
  return async ({ phase, node, result } = {}) => {
    const entries = [];
    for (const binding of validatorBindings) {
      const signalId = binding.signalId ?? binding.validator.signalId;
      const evidenceId = binding.evidenceId ?? `ev-${String(signalId).replace(/^signal-/, "")}`;
      try {
        const resolved = await binding.artifactResolver({ phase, node, result });
        const isSnapshot =
          resolved !== null &&
          typeof resolved === "object" &&
          Object.hasOwn(resolved, "value") &&
          typeof resolved.artifactId === "string";
        const snapshot = isSnapshot
          ? {
              artifactId: resolved.artifactId,
              value: resolved.value,
              ...((resolved.fileDigest ?? resolved.digest)
                ? { fileDigest: resolved.fileDigest ?? resolved.digest }
                : {}),
            }
          : { artifactId: binding.artifactId, value: resolved };
        const validation = validateSignal(binding.validator, snapshot);
        entries.push({
          status: validation.result === "pass" ? "pass" : "fail",
          scenarioId: signalId,
          scenarioIds: [signalId],
          evidenceRefs: [evidenceId],
        });
      } catch {
        entries.push({
          status: "fail",
          scenarioId: signalId,
          scenarioIds: [signalId],
          evidenceRefs: [],
        });
      }
    }
    return entries;
  };
}

export {
  slug,
  childRunIdForNode,
  retryChildRunIdForNode,
  jsonProjection,
  materialDigest,
  unique,
  invocationApproval,
  receiptApproval,
  progressByReceipt,
  abortFailure,
  stepCapFailure,
  raceDeadline,
  dispatchIntentFailure,
  terminalReceipt,
  childReceipt,
  normalizeEvidence,
  defaultGate,
  makeAutonomousFunctionalGate,
};
