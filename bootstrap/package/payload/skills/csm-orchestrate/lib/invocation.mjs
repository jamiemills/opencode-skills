"use strict";

import { execFile } from "node:child_process";
import { assertSchema, validSchema } from "./contracts.mjs";
import {
  validateInjectedFinalReview,
  validateReviewProvenance,
} from "./adversarial-final-review.mjs";
import { HOST_REVIEW } from "./review-token.mjs";

const FAILURE_CLASSES = Object.freeze([
  "transport",
  "child",
  "policy",
  "timeout",
  "evaluator",
  "incomplete",
]);
const ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function validateHandoffRef(
  ref,
  { owner, runId, artifactId, schema, schemaRevision, path, resolution, digest } = {},
) {
  if (!ref || typeof ref !== "object") return "handoff ref must be an object";
  if (
    !ref.sourceOwner ||
    !ref.sourceRunId ||
    !ref.sourceArtifactId ||
    !ref.schema ||
    !Number.isInteger(ref.schemaRevision) ||
    !ref.path ||
    !ref.resolution ||
    !DIGEST.test(ref.digest ?? "")
  )
    return "handoff ref is incomplete";
  if (owner !== undefined && ref.sourceOwner !== owner) return "handoff source owner mismatch";
  if (runId !== undefined && ref.sourceRunId !== runId) return "handoff source run mismatch";
  if (artifactId !== undefined && ref.sourceArtifactId !== artifactId)
    return "handoff source artifact mismatch";
  if (schema !== undefined && ref.schema !== schema) return "handoff schema mismatch";
  if (schemaRevision !== undefined && ref.schemaRevision !== schemaRevision)
    return "handoff schema revision mismatch";
  if (path !== undefined && ref.path !== path) return "handoff path mismatch";
  if (resolution !== undefined && ref.resolution !== resolution)
    return "handoff resolution mismatch";
  if (digest !== undefined && ref.digest !== digest) return "handoff digest mismatch";
  return null;
}

function failure(status, failureClass, code, message) {
  return { status, failure: { class: failureClass, code, message } };
}

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

async function assertRequest(request) {
  if (!request || typeof request !== "object")
    throw new TypeError("invocation request is required");
  for (const field of [
    "parentRunId",
    "childRunId",
    "phaseId",
    "edgeId",
    "skill",
    "skillDigest",
    "approval",
    "permissions",
    "timeoutMs",
    "cancellation",
    "retry",
  ]) {
    if (!(field in request)) throw new TypeError(`invocation request requires ${field}`);
  }
  if (
    !ID.test(request.parentRunId) ||
    !ID.test(request.childRunId) ||
    request.parentRunId === request.childRunId
  )
    throw new TypeError("parent and child run IDs must be distinct canonical run IDs");
  if (!request.retry.idempotencyKey) throw new TypeError("idempotency key is required");
  for (const ref of request.upstreamArtifactRefs ?? []) {
    const error = validateHandoffRef(ref);
    if (error) throw new TypeError(error);
  }
  if (request.approval)
    await assertSchema(request.schema ?? "csm-orchestrate-invocation/1", request);
}

function approvalFailure(approval, request, now, consumed) {
  if (!approval) return ["missing-approval", "approval is required"];
  if (approval.status === "revoked") return ["approval-revoked", "approval was revoked"];
  if (approval.status === "consumed" || consumed.has(approval.approvalId))
    return ["approval-consumed", "approval was already consumed"];
  if (new Date(approval.expiresAt).getTime() <= now.getTime())
    return ["approval-expired", "approval has expired"];
  if (approval.status !== "approved") return ["approval-not-approved", "approval is not approved"];
  if (approval.approvedDigest !== request.skillDigest)
    return ["approval-digest-mismatch", "approval digest does not match skill digest"];
  const expected = {
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    phaseId: request.phaseId,
    edgeId: request.edgeId,
  };
  if (Object.keys(expected).some((key) => approval.binding?.[key] !== expected[key]))
    return ["approval-binding-mismatch", "approval binding does not match invocation"];
  if (
    approval.scope.length !== request.permissions.length ||
    request.permissions.some((permission) => !approval.scope.includes(permission))
  )
    return ["approval-scope-mismatch", "approval scope does not cover permissions"];
  return null;
}

export function childIdentityFailure(result, request) {
  const receipt = result?.childReceipt;
  if (receipt && (receipt.runId !== request.childRunId || receipt.owner !== request.skill))
    return "child receipt identity does not match invocation";
  for (const item of result?.evidence ?? []) {
    if (item.runId !== request.childRunId || item.owner !== request.skill)
      return "child evidence identity does not match invocation";
    if (item.source?.sourceRunId && item.source.sourceRunId !== request.childRunId)
      return "child evidence source run does not match invocation";
  }
  for (const ref of result?.outputArtifactRefs ?? []) {
    if (ref.sourceRunId && ref.sourceRunId !== request.childRunId)
      return "child artifact source run does not match invocation";
    if (ref.owner && ref.owner !== request.skill)
      return "child artifact owner does not match invocation";
  }
  return null;
}

export async function validateChildResult(result, request) {
  const statuses = new Set(["completed", "failed", "blocked", "incomplete"]);
  if (!statuses.has(result?.status))
    return result?.status === "rejected" ? "rejected child status" : "unknown child status";
  if (result.childReceipt) {
    if (result.childReceipt.status !== result.status) return "child receipt status mismatch";
    if (!request.approval) return "invalid child receipt";
    const receipt = {
      schema: "csm-orchestrate-receipt/1",
      receiptId: "receipt-validation",
      runId: request.parentRunId,
      phaseId: request.phaseId,
      childReceipts: [result.childReceipt],
      approval: {
        approvalId: request.approval.approvalId,
        scope: request.approval.scope,
        approvedDigest: request.approval.approvedDigest,
        approvedAt: request.approval.approvedAt,
        expiresAt: request.approval.expiresAt,
        status: request.approval.status,
      },
      statuses: {
        route: "complete",
        child: result.status === "completed" ? "completed" : result.status,
        artifact: "none",
        verification: "unverified",
        parent: "active",
      },
      outcome: { status: "INCOMPLETE", accepted: false, acceptanceRefs: [] },
      idempotencyKey: request.retry.idempotencyKey,
    };
    if (!(await validSchema("csm-orchestrate-receipt/1", receipt))) return "invalid child receipt";
  }
  for (const item of result.evidence ?? []) {
    const evidence = {
      schema: item.acceptanceSignalId ? "csm-orchestrate-evidence/2" : "csm-orchestrate-evidence/1",
      ...item,
      source: {
        ...item.source,
        sourceRunId: item.source?.sourceRunId ?? item.runId,
      },
    };
    if (!(await validSchema(evidence.schema, evidence))) return "invalid child evidence";
  }
  return null;
}

export async function validateDurableTerminalRecords(records, request) {
  if (!Array.isArray(records)) return "terminal records must be an array";
  const statuses = new Set(["completed", "failed", "blocked", "incomplete"]);
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return "malformed durable terminal record";
    if (
      (record.childRunId !== undefined && record.childRunId !== request.childRunId) ||
      (record.runId !== undefined && record.runId !== request.childRunId) ||
      (record.childRunId === undefined && record.runId === undefined)
    )
      return "durable terminal record identity mismatch";
    if (!statuses.has(record.status) || !record.result || typeof record.result !== "object")
      return "malformed durable terminal record";
    if (record.result.status !== record.status) return "durable terminal status mismatch";
    const resultError = await validateChildResult(record.result, request);
    if (resultError) return resultError;
    const identityError = childIdentityFailure(record.result, request);
    if (identityError) return identityError;
  }
  return null;
}

export function createHostInvocationAdapter({
  host,
  capabilities,
  artifactResolver,
  schemaRegistry,
  cursorStore = null,
  now = () => new Date(),
  terminalInvocations = new Map(),
} = {}) {
  const consumedApprovals = new Set();
  const manifest = Array.isArray(capabilities) ? capabilities : capabilities?.skills;
  const capabilityBySkill = new Map((manifest ?? []).map((item) => [item.skill, item]));
  return Object.freeze({
    async invoke(request, { signal, cursorId } = {}) {
      try {
        await assertRequest(request);
      } catch (error) {
        return failure("blocked", "policy", "invalid-invocation", error.message);
      }
      const capability = capabilityBySkill.get(request.skill);
      if (!capability || request.skill === "csm-orchestrate")
        return failure(
          "blocked",
          "policy",
          "unauthorized-skill",
          "skill is not an authorized sibling",
        );
      if (request.skillDigest !== capability.digest)
        return failure(
          "blocked",
          "policy",
          "skill-digest-mismatch",
          "skill digest is not in the canonical capability manifest",
        );
      const key = request.retry.idempotencyKey;
      if (terminalInvocations.has(key))
        return failure(
          "rejected",
          "policy",
          "duplicate-terminal-invocation",
          "terminal invocation already exists",
        );
      const durableCursorId =
        cursorId ??
        `cursor-${request.parentRunId}-${request.phaseId}-${request.edgeId.replace(/^edge-/, "")}`;
      if (cursorStore && typeof cursorStore.recordIdempotency === "function") {
        try {
          await cursorStore.recordIdempotency(key, durableCursorId);
        } catch {
          return failure(
            "rejected",
            "policy",
            "duplicate-terminal-invocation",
            "terminal invocation already exists",
          );
        }
      }
      const current = new Date(now());
      const approvalError = approvalFailure(request.approval, request, current, consumedApprovals);
      if (approvalError) return failure("blocked", "policy", approvalError[0], approvalError[1]);
      if (!host || typeof host.invokeSiblingSkill !== "function")
        return failure(
          "blocked",
          "transport",
          "unavailable-host",
          "host invocation API is unavailable",
        );
      if (request.cancellation.requested || signal?.aborted)
        return failure(
          "rejected",
          "timeout",
          "cancelled",
          "invocation was cancelled before dispatch",
        );
      if (cursorStore && typeof cursorStore.consumeApproval === "function") {
        try {
          await cursorStore.consumeApproval(request.approval.approvalId, durableCursorId);
        } catch {
          return failure("blocked", "policy", "approval-consumed", "approval was already consumed");
        }
      }
      consumedApprovals.add(request.approval.approvalId);
      const controller = new AbortController();
      let childResult = null;
      // Best-effort: tmux-detached grandchildren live in the tmux server's session;
      // without pid-namespaces this cannot guarantee cleanup
      const killTmuxSession = () => {
        const sessionName = childResult?.tmuxSessionName;
        if (typeof sessionName !== "string" || sessionName === "") return;
        execFile("tmux", ["kill-session", "-t", sessionName], () => {});
      };
      const hostInvocation = host.invokeSiblingSkill(request, { signal: controller.signal });
      Promise.resolve(hostInvocation).then(
        (result) => {
          childResult = result;
          if (controller.signal.aborted) killTmuxSession();
        },
        () => {},
      );
      const cancellation = new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            controller.abort();
            killTmuxSession();
            reject(Object.assign(new Error("invocation was cancelled"), { cancelled: true }));
          },
          { once: true },
        );
      });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          killTmuxSession();
          reject(Object.assign(new Error("child invocation timed out"), { timeout: true }));
        }, request.timeoutMs);
      });
      try {
        const result = await Promise.race([hostInvocation, timeout, cancellation]);
        clearTimeout(timer);
        const resultError = await validateChildResult(result, request);
        if (resultError) return failure("blocked", "policy", "invalid-child-result", resultError);
        const status = result.status;
        const identityError = childIdentityFailure(result, request);
        if (identityError) {
          const terminal = failure("blocked", "policy", "child-identity-mismatch", identityError);
          terminalInvocations.set(key, terminal);
          return terminal;
        }
        if (status === "failed" || status === "blocked") {
          const klass = FAILURE_CLASSES.includes(result.failure?.class)
            ? result.failure.class
            : "child";
          const terminal = {
            status,
            failure: {
              class: klass,
              code: result.failure?.code ?? "child-failed",
              message: result.failure?.message ?? "child invocation failed",
            },
          };
          terminalInvocations.set(key, terminal);
          return terminal;
        }
        if (status === "incomplete")
          return failure(
            "incomplete",
            "incomplete",
            result.failure?.code ?? "child-incomplete",
            result.failure?.message ?? "child evidence is incomplete",
          );
        const terminal = {
          status: "completed",
          outputArtifactRefs: result?.outputArtifactRefs ?? [],
          childReceipt: result?.childReceipt ?? null,
          evidence: result?.evidence ?? [],
          technical: result?.technical ?? null,
          functional: result?.functional ?? null,
        };
        terminalInvocations.set(key, terminal);
        return terminal;
      } catch (error) {
        clearTimeout(timer);
        if (error?.timeout)
          return failure("failed", "timeout", "timeout", "child invocation timed out");
        if (error?.cancelled)
          return failure("rejected", "timeout", "cancelled", "invocation was cancelled");
        if (FAILURE_CLASSES.includes(error?.failureClass))
          return failure(
            "failed",
            error.failureClass,
            error.code ?? `${error.failureClass}-failed`,
            error.message ?? `${error.failureClass} failure`,
          );
        return failure(
          "failed",
          "transport",
          "transport-failed",
          error?.message ?? "host transport failed",
        );
      }
    },
    async invokeReview(request) {
      if (!host || typeof host.invokeReview !== "function")
        return failure(
          "blocked",
          "transport",
          "unavailable-review-host",
          "host review API is unavailable",
        );
      let result;
      try {
        result = await raceDeadline(
          host.invokeReview(Object.freeze({ ...request, status: "ready" })),
          request.timeoutMs || 30_000,
          "review-timeout",
        );
      } catch (error) {
        if (!error?.timeout) throw error;
        return failure("blocked", "timeout", "review-timeout", "review invocation timed out");
      }
      const review = result?.review;
      const receipt = result?.reviewReceipt;
      const artifact = result?.reviewArtifact;
      const failures = validateReviewProvenance(review, request.parentRunId);
      if (review?.runId !== request.parentRunId || review?.phaseId !== request.phaseId)
        failures.push("host review is not bound to the requested parent phase");
      if (review?.provenance?.approval?.edgeId !== request.edgeId)
        failures.push("host review approval is not bound to the requested edge");
      if (
        !receipt ||
        !artifact ||
        review?.provenance?.receipt?.artifactId !== receipt.artifactId ||
        review?.provenance?.receipt?.digest !== receipt.digest ||
        review?.provenance?.artifact?.artifactId !== artifact.artifactId ||
        review?.provenance?.artifact?.digest !== artifact.digest
      )
        failures.push("host review receipt and artifact records are not bound to provenance");
      for (const record of [receipt, artifact]) {
        if (
          !record?.owner ||
          record.owner !== review?.provenance?.owner ||
          record.runId !== review?.provenance?.reviewerChildRunId ||
          !record.artifactId ||
          !record.schema ||
          !record.digest ||
          !record.path ||
          !record.resolution
        ) {
          failures.push("host review record identity is incomplete");
          continue;
        }
        if (artifactResolver?.resolve) {
          const resolved = await artifactResolver.resolve(record.path, {
            expectedFileDigest: record.digest,
            expectedArtifactId: record.artifactId,
            expectedOwner: record.owner,
            expectedSourceRunId: record.runId,
          });
          if (
            resolved?.status !== "resolved" ||
            resolved.owner !== record.owner ||
            resolved.fileDigest !== record.digest ||
            resolved.value?.artifactId !== record.artifactId ||
            resolved.value?.sourceRunId !== record.runId
          )
            failures.push("host review artifact could not be resolver-validated");
        } else failures.push("host review artifact resolver is required");
        try {
          schemaRegistry.resolve(
            record.schema,
            record.schemaRevision ?? Number(record.schema.split("/").at(-1)),
          );
        } catch {
          failures.push("host review artifact schema is not registered");
        }
      }
      if (review?.status === "ACCEPTED") {
        const contextual = validateInjectedFinalReview({
          review,
          runId: request.parentRunId,
          phaseResults: request.phaseResults,
          evidence: request.evidence,
        });
        failures.push(...contextual.failures);
      }
      if (failures.length)
        return failure("blocked", "policy", "invalid-review-provenance", failures.join("; "));
      Object.defineProperty(review, HOST_REVIEW, { value: true });
      return { status: "completed", review };
    },
  });
}

export { FAILURE_CLASSES };
