"use strict";

import { digest } from "../../../lib/schema-runtime/index.mjs";
import { compileApproach } from "./phase-compiler.mjs";
import {
  createHostInvocationAdapter,
  validateDurableTerminalRecords,
  validateHandoffRef,
} from "./invocation.mjs";
import {
  aggregateGates,
  reconcileChildArtifacts,
  reconcileRequirementEvidence,
} from "./evidence-gates.mjs";
import {
  coordinateFinalReview,
  reviewAcceptance,
  validateInjectedFinalReview,
} from "./adversarial-final-review.mjs";
import { HOST_REVIEW } from "./review-token.mjs";
import {
  autonomyGate,
  classifyResume,
  classifyConcurrency,
  createParentCursor,
  loadCursor,
  persistTerminalReceipt,
  persistCursor,
  retryDecision,
  projectChildStatus,
} from "./recovery.mjs";
import { assertSchema } from "./contracts.mjs";
import { validateSignal } from "./validators.mjs";
import { createProgressTracker } from "./progress.mjs";
import { preflightSkillRoutes } from "./skill-executor-preflight.mjs";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
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

function upstreamRefsFor(node, phase, outputsByNode) {
  return phase.handoffEdges
    .filter((edge) => edge.consumerNodeId === node.nodeId)
    .flatMap((edge) => {
      const refs = outputsByNode.get(edge.producerNodeId) ?? [];
      const compatible = refs.filter(
        (ref) =>
          ref.outputName === edge.producerOutput &&
          !validateHandoffRef(ref, {
            owner: edge.producerSkill,
            schema: edge.schema,
            schemaRevision: edge.schemaRevision,
          }),
      );
      if (!compatible.length) throw new TypeError(`missing compatible handoff for ${edge.edgeId}`);
      return compatible.map(({ outputName: _outputName, ...ref }) => ref);
    });
}

async function externalRefsFor(node, refs, artifactResolver, schemaRegistry) {
  const relevant = refs.filter((ref) =>
    node.inputs.some(
      (input) =>
        (ref.inputName ?? ref.name) === input.name &&
        (ref.kind ?? "artifact") === input.kind &&
        (!input.schema || ref.schema === input.schema),
    ),
  );
  for (const ref of relevant) {
    const input = node.inputs.find(
      (candidate) =>
        (ref.inputName ?? ref.name) === candidate.name &&
        (ref.kind ?? "artifact") === candidate.kind &&
        (!candidate.schema || ref.schema === candidate.schema),
    );
    const error = validateHandoffRef(ref, {
      owner: ref.sourceOwner,
      runId: ref.sourceRunId,
      artifactId: ref.sourceArtifactId,
      schema: input.schema ?? undefined,
      schemaRevision: input.schemaRevision ?? undefined,
    });
    if (error)
      throw new TypeError(`invalid external input ${ref.sourceArtifactId ?? ref.name}: ${error}`);
    if (!schemaRegistry?.resolve || !artifactResolver?.resolve)
      throw new TypeError("resolver-backed external inputs are required");
    schemaRegistry.resolve(ref.schema, ref.schemaRevision);
    const resolved = await artifactResolver.resolve(ref.path, {
      expectedOwner: ref.sourceOwner,
      expectedSourceRunId: ref.sourceRunId,
      ...(ref.recordType === "receipt" ? {} : { expectedArtifactId: ref.sourceArtifactId }),
      expectedFileDigest: ref.digest,
    });
    if (
      resolved?.status !== "resolved" ||
      resolved.owner !== ref.sourceOwner ||
      resolved.fileDigest !== ref.digest ||
      resolved.value?.artifactId !== ref.sourceArtifactId ||
      resolved.value?.sourceRunId !== ref.sourceRunId
    )
      throw new TypeError(`external input resolver identity mismatch: ${ref.sourceArtifactId}`);
  }
  return relevant;
}

async function reconcileResult(result, node, childRunId, artifactResolver, schemaRegistry) {
  const refs = [...(result?.outputArtifactRefs ?? [])].map((ref) => ({
    ...ref,
    fileDigest: ref.fileDigest ?? ref.digest,
    sourceRunId: ref.sourceRunId ?? ref.runId,
    requirementIds: [...node.requirementIds],
    acceptanceSignalId: ref.acceptanceSignalId ?? node.acceptanceSignalIds[0],
  }));
  if (!refs.length)
    refs.push(
      ...(result?.evidence ?? []).map((item) => ({
        ...item.source,
        evidenceId: item.evidenceId,
        kind: item.kind,
        owner: item.owner,
        sourceRunId: item.sourceRunId ?? item.runId,
        fileDigest: item.source?.digest ?? item.digest,
        requirementIds: item.requirementIds ?? [...node.requirementIds],
        acceptanceSignalId: item.acceptanceSignalId ?? node.acceptanceSignalIds[0],
      })),
    );
  const resolver = artifactResolver;
  if (!resolver || typeof resolver.resolve !== "function")
    return {
      status: "incomplete",
      evidence: [],
      failures: [
        {
          class: "missing",
          code: "artifact-resolver-required",
          message: "production evidence requires resolver-backed artifact validation",
        },
      ],
    };
  if (
    !schemaRegistry ||
    typeof schemaRegistry.validate !== "function" ||
    typeof schemaRegistry.resolve !== "function"
  )
    return {
      status: "incomplete",
      evidence: [],
      failures: [
        {
          class: "policy",
          code: "schema-registry-required",
          message: "production evidence requires the registered schema registry",
        },
      ],
    };
  for (const ref of result?.outputArtifactRefs ?? []) {
    const declared = node.evidence.find((entry) => entry.kind === ref.kind)?.schema;
    if (declared && ref.schema !== declared)
      return {
        status: "incomplete",
        evidence: [],
        failures: [
          { class: "policy", code: "schema-invalid", message: "artifact schema is not declared" },
        ],
      };
    if (declared && schemaRegistry?.resolve) {
      const match = declared.match(/^(.*)\/(\d+)$/);
      schemaRegistry.resolve(match?.[1] ?? declared, Number(match?.[2] ?? 1));
    }
  }
  return reconcileChildArtifacts({
    artifactRefs: refs,
    resolver,
    expectedOwner: node.skill,
    expectedRunId: childRunId,
    consumerRevision: 1,
    schemaRegistry,
  });
}

async function validateReviewArtifacts(reviewResult, artifactResolver, schemaRegistry) {
  const refs = reviewResult?.reviewArtifactRefs;
  if (!Array.isArray(refs) || refs.length !== 3)
    throw new TypeError("independent review persisted record references are required");
  const recordTypes = new Set(refs.map((ref) => ref?.recordType));
  if (
    recordTypes.size !== 3 ||
    !["review", "artifact", "receipt"].every((type) => recordTypes.has(type))
  )
    throw new TypeError("independent review persisted record references are incomplete");
  const expectedSchemas = {
    review: "csm-orchestrate-adversarial-review/2",
    artifact: "csm-artifact/1",
    receipt: "csm-review-receipt/1",
  };
  const resolvedRecords = new Map();
  for (const ref of refs) {
    if (
      !ref?.recordType ||
      !ref.recordId ||
      !ref.schema ||
      !ref.path ||
      !ref.digest ||
      !ref.sourceDigest ||
      !ref.sourceArtifactId ||
      !ref.sourceRunId ||
      !ref.sourceOwner
    )
      throw new TypeError("independent review artifact reference is incomplete");
    if (ref.schema !== expectedSchemas[ref.recordType])
      throw new TypeError(`independent review reference schema mismatch: ${ref.recordId}`);
    const schemaMatch = ref.schema.match(/^(.*)\/(\d+)$/);
    schemaRegistry.resolve(schemaMatch?.[1] ?? ref.schema, Number(schemaMatch?.[2] ?? 1));
    const resolved = await artifactResolver.resolve(ref.path, {
      expectedOwner: ref.sourceOwner,
      expectedSourceRunId: ref.sourceRunId,
      expectedSourceDigest: ref.sourceDigest,
      ...(ref.recordType === "artifact" ? { expectedArtifactId: ref.sourceArtifactId } : {}),
      expectedFileDigest: ref.digest,
    });
    const value = resolved?.value;
    const identity =
      ref.recordType === "review"
        ? value?.reviewId
        : ref.recordType === "artifact"
          ? value?.artifact?.artifactId
          : value?.receiptId;
    if (
      resolved?.status !== "resolved" ||
      resolved.owner !== ref.sourceOwner ||
      resolved.fileDigest !== ref.digest ||
      value?.schema !== ref.schema ||
      identity !== ref.recordId ||
      (value?.sourceRunId ?? value?.artifact?.runId) !== ref.sourceRunId ||
      (value?.sourceArtifactIds ?? []).includes(ref.sourceArtifactId) !== true ||
      (value?.sourceDigest ?? value?.artifact?.sourceDigest) !== ref.sourceDigest
    )
      throw new TypeError(`independent review resolver identity mismatch: ${ref.recordId}`);
    resolvedRecords.set(ref.recordType, value);
  }
  const review = resolvedRecords.get("review");
  const artifact = resolvedRecords.get("artifact");
  const receipt = resolvedRecords.get("receipt");
  const artifactId = artifact?.artifact?.artifactId;
  const sourceArtifactIds = new Set(refs.map((ref) => ref.sourceArtifactId));
  const childRunId = review?.provenance?.reviewerChildRunId;
  if (
    sourceArtifactIds.size !== 1 ||
    !sourceArtifactIds.has(artifactId) ||
    review?.runId !== reviewResult?.review?.runId ||
    review?.owner !== refs.find((ref) => ref.recordType === "review")?.sourceOwner ||
    review?.provenance?.owner !== review?.owner ||
    review?.provenance?.reviewerChildRunId !==
      refs.find((ref) => ref.recordType === "review")?.sourceRunId ||
    review?.sourceDigest !== refs.find((ref) => ref.recordType === "review")?.sourceDigest ||
    review?.provenance?.artifact?.artifactId !== artifactId ||
    review?.provenance?.artifact?.digest !== artifact?.artifact?.digest ||
    review?.provenance?.artifact?.runId !== childRunId ||
    review?.provenance?.artifact?.owner !== review?.owner ||
    review?.provenance?.receipt?.artifactId !== receipt?.receiptId ||
    review?.provenance?.receipt?.digest !==
      refs.find((ref) => ref.recordType === "receipt")?.digest ||
    review?.provenance?.receipt?.owner !== review?.owner ||
    artifact?.artifact?.owner !== review?.owner ||
    receipt?.owner !== review?.owner ||
    receipt?.reviewId !== review?.reviewId ||
    receipt?.reviewArtifactId !== artifactId ||
    receipt?.reviewDigest !== artifact?.artifact?.digest ||
    receipt?.inputDigest !== review?.inputDigest ||
    receipt?.sourceRunId !== childRunId ||
    receipt?.sourceDigest !== review?.sourceDigest
  )
    throw new TypeError("independent review persisted provenance is not bound to final review");
}

async function saveCursor({
  runId,
  phase,
  node,
  childRunId,
  attempt,
  state,
  store,
  now,
  approval,
  idempotencyKey,
  terminalIntent,
  fencingToken,
}) {
  if (!store) return;
  await persistCursor(
    createParentCursor({
      cursorId: `cursor-${slug(runId)}-${slug(phase.phaseId)}-${slug(node?.nodeId ?? "phase")}`,
      runId,
      phaseId: phase.phaseId,
      edgeId: node ? `edge-${slug(node.nodeId)}` : null,
      routeNodeId: node?.nodeId ?? null,
      childRunId,
      routeState:
        state === "dispatching" ? "selected" : state === "validated" ? "collecting" : state,
      checkpointState: state === "validated" ? "validated" : "saved",
      attempt,
      idempotencyKey: idempotencyKey ?? phase.idempotency.key,
      ...(approval
        ? {
            approvalBinding: {
              approvalId: approval.approvalId,
              parentRunId: runId,
              childRunId,
              phaseId: phase.phaseId,
              edgeId: `edge-${slug(node?.nodeId ?? "phase")}`,
            },
          }
        : {}),
      ...(terminalIntent ? { terminalIntent } : {}),
      updatedAt: new Date(now()).toISOString(),
    }),
    store,
    fencingToken === undefined ? {} : { fencingToken },
  );
}

export function createOrchestrator(defaults = {}) {
  return Object.freeze({
    run: (input) => orchestrate({ ...defaults, ...input }),
  });
}

async function runOrchestrationInternal({
  approach,
  runId = approach?.runId,
  host,
  capabilities,
  signals = {},
  approvals,
  now = () => new Date(),
  cursorStore,
  technicalGate,
  functionalGate,
  adversarialReview,
  finalReview,
  remediationFactory,
  maxAttempts = 2,
  timeoutMs = 30_000,
  maxSteps = Infinity,
  reviewTimeoutMs = 300_000,
  maxOutputSize = 2 * 1024 * 1024,
  retryBackoffMs = 1000,
  signal = null,
  telemetryEmitter = null,
  effectiveConfigDigest = null,
  inputArtifactRefs = [],
  artifactResolver,
  childArtifactResolver = artifactResolver,
  schemaRegistry,
  executorRegistry,
  executorBindings = {},
  executorAdapter = null,
  finalReviewExecutor = null,
  producerExecutorId = null,
  reviewArtifactRoot = null,
  executorInput,
  parentPhaseId = null,
  phaseIdOverride = null,
} = {}) {
  if (!RUN_ID.test(runId ?? "")) throw new TypeError("canonical parent runId is required");
  if (telemetryEmitter && !effectiveConfigDigest)
    effectiveConfigDigest = digest({ runId, timestamp: Date.now() });
  const emitTelemetry = (event) => {
    if (!telemetryEmitter || typeof telemetryEmitter.emit !== "function") return;
    try {
      telemetryEmitter.emit({
        runId,
        attempt: 0,
        effectiveConfigDigest: effectiveConfigDigest ?? undefined,
        fencingToken: null,
        ...event,
      });
      if (progressTracker) void progressTracker.observeTelemetry().catch(() => undefined);
      return true;
    } catch (error) {
      if (typeof telemetryEmitter.getLossRecords !== "function")
        telemetryLosses.push({
          schema: "csm-orchestrate-telemetry-loss/1",
          eventType: "telemetry_loss",
          runId,
          phaseId: event.phaseId ?? null,
          edgeId: event.edgeId ?? null,
          childRunId: event.childRunId ?? null,
          attempt: event.attempt ?? 0,
          sequence: null,
          code: error?.code ?? "telemetry-write-failed",
          message: error?.message ?? "telemetry event could not be written",
        });
      return false;
    }
  };
  let progressTracker = null;
  const telemetryLosses = [];
  const emitTerminalReceipt = (...args) => {
    const receipt = terminalReceipt(...args);
    if (progressTracker) {
      progressByReceipt.set(receipt, progressTracker);
      progressTracker.associateReceipt(receipt.receiptId, receipt.phaseId);
    }
    emitTelemetry({
      phaseId: receipt.phaseId,
      eventType: "terminal",
      payload: { receiptId: receipt.receiptId, status: receipt.outcome.status },
    });
    const losses = [...telemetryLosses, ...(telemetryEmitter?.getLossRecords?.() ?? [])];
    if (!losses.length) return receipt;
    const surfaced = Object.freeze({ ...receipt, telemetryLosses: losses });
    if (progressTracker) progressByReceipt.set(surfaced, progressTracker);
    return surfaced;
  };
  progressTracker = createProgressTracker({
    runId,
    graphRevision: 1,
    store: cursorStore,
    now: () => new Date(now()).toISOString(),
  });
  if (!executorAdapter && (!host || typeof host.invokeSiblingSkill !== "function"))
    return await (async () => {
      await progressTracker.persist();
      return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
        reason: "executor-required",
      });
    })();
  if (
    !cursorStore ||
    typeof cursorStore.saveCursor !== "function" ||
    typeof cursorStore.loadCursor !== "function"
  ) {
    await progressTracker.persist();
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "durable-cursor-required",
    });
  }
  const graph = await compileApproach(approach, {
    capabilities,
    signals,
    parentPhaseId,
    phaseIdOverride,
  });
  if (executorAdapter && (!executorRegistry || typeof executorRegistry.resolveExact !== "function"))
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "unsupported-handler",
      failure: {
        class: "policy",
        code: "unsupported-handler",
        message: "in-process executor registry is required",
      },
    });
  if (executorRegistry) {
    const executorPreflight = preflightSkillRoutes(
      graph.phases.flatMap((phase) => phase.routeNodes),
      executorRegistry,
      executorBindings,
      { requireBindings: Boolean(executorAdapter), capabilities },
    );
    if (!executorPreflight.ok)
      return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
        reason: executorPreflight.failure.failure.code,
        failure: executorPreflight.failure.failure,
      });
  }
  progressTracker = createProgressTracker({
    runId,
    graphRevision: graph.graphRevision,
    store: cursorStore,
    now: () => new Date(now()).toISOString(),
  });
  await progressTracker.reload();
  await progressTracker.materialize(graph.phases);
  const adapter =
    executorAdapter ??
    createHostInvocationAdapter({
      host,
      capabilities,
      artifactResolver,
      schemaRegistry,
      cursorStore,
      now,
    });
  const preflight = autonomyGate({
    host: host ?? executorAdapter,
    permissions: graph.phases.flatMap((phase) => phase.approvalScope),
    approvals,
    idempotency: graph.phases.map((phase) => phase.idempotency),
    route: graph.phases.flatMap((phase) => phase.routeNodes),
    evaluation: { signals, technicalGate, functionalGate },
  });
  if (!preflight.enabled) {
    for (const progressItem of progressTracker.snapshot.items)
      if (progressItem.state === "pending" || progressItem.state === "active")
        await progressTracker.update(progressItem.itemId, {
          state: "blocked",
          blocker: { code: "AUTONOMY_PREFLIGHT", message: "autonomy preflight blocked execution" },
        });
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "autonomy-preflight-blocked",
      missing: preflight.missing,
    });
  }
  let dispatchedSteps = 0;
  const dispatchBlocked = () =>
    signal?.aborted ? abortFailure() : dispatchedSteps >= maxSteps ? stepCapFailure() : null;
  const beginDispatchIntent = async (cursorId, phaseId, childRunId) => {
    if (typeof cursorStore?.createDispatchIntent !== "function") return null;
    let fencingToken = 1;
    if (typeof cursorStore.claimCursor === "function") {
      const meta =
        typeof cursorStore.getCursorMeta === "function"
          ? await cursorStore.getCursorMeta(cursorId)
          : null;
      const claim = await cursorStore.claimCursor(cursorId, meta?.revision ?? 0, {
        runId,
        phaseId,
        childRunId,
      });
      fencingToken = claim?.fencingToken ?? 1;
      progressTracker.setFencingToken(fencingToken);
    }
    return cursorStore.createDispatchIntent(cursorId, childRunId, fencingToken);
  };
  const resolveDispatchIntent = async (intent, status) => {
    if (!intent || typeof cursorStore?.resolveDispatchIntent !== "function") return;
    if (status?.failure?.code === "reconciliation-required") return;
    try {
      await cursorStore.resolveDispatchIntent(
        intent.intentId,
        status === "completed" ? "completed" : status === "failed" ? "failed" : "cancelled",
      );
    } catch {
      /* resolution is advisory; the terminal receipt stays authoritative */
    }
  };
  const capOutputSize = (result) =>
    Buffer.byteLength(JSON.stringify(result)) > maxOutputSize
      ? {
          status: "failed",
          failure: {
            class: "policy",
            code: "output-size-exceeded",
            message: "result exceeded maxOutputSize",
          },
        }
      : result;
  const invokeAdapter = async (request, cursorId, dispatchIntentId) => {
    dispatchedSteps += 1;
    const invocationOptions = cursorId ? { cursorId } : {};
    if (signal) invocationOptions.signal = signal;
    if (dispatchIntentId) invocationOptions.dispatchIntentId = dispatchIntentId;
    return adapter.invoke(request, invocationOptions);
  };
  const childReceipts = [];
  const allEvidence = [];
  const phaseResults = [];
  const completedNodeIds = new Set();
  const validatedOutputs = new Map();
  let activeGraph = graph;
  let terminalApproval = null;
  let phaseIndex = 0;
  const executedPhaseIds = new Set();
  const reviewIds = [];
  const remediationLineage = [];
  const receiptExtensions = () => ({
    schema: "csm-orchestrate-receipt-extension/2",
    graphRevision: activeGraph.graphRevision,
    phaseSummaries: phaseResults.map(({ phase, gate, review }) => ({
      phaseId: phase.phaseId,
      parentPhaseId: phase.parentPhaseId,
      graphRevision: phase.graphRevision,
      gateStatus: gate.status,
      reviewStatus: review.status,
    })),
    remediationLineage,
    reviewIds: unique(reviewIds),
    evidenceRefs: unique(allEvidence.map((item) => item.evidenceId)),
    acceptanceRefs: unique([
      ...allEvidence.map((item) => item.evidenceId),
      ...phaseResults.flatMap(({ phase }) => phase.requirementIds),
    ]),
    childReceipts: [...childReceipts],
    sourceLineage: allEvidence.map((item) => item.source).filter(Boolean),
    phaseContracts: phaseResults.map(({ phase }) => phase),
    phaseResults: phaseResults.map(({ gate, review }) => ({ gate, review })),
  });

  while (true) {
    while (phaseIndex < activeGraph.phases.length) {
      if (executedPhaseIds.has(activeGraph.phases[phaseIndex].phaseId)) {
        phaseIndex += 1;
        continue;
      }
      const index = phaseIndex;
      phaseIndex += 1;
      const phase = activeGraph.phases[index];
      let phaseEvidence = [];
      let phaseTechnical = [];
      let phaseFunctional = [];
      let phaseFailure = null;
      const executeNode = async (node) => {
        const progressId = progressTracker.itemId(phase.phaseId, node.nodeId);
        const cursorId = `cursor-${slug(runId)}-${slug(phase.phaseId)}-${slug(node.nodeId)}`;
        const savedCursor = await loadCursor(cursorId, cursorStore, {
          runId,
          phaseId: phase.phaseId,
          routeNodeId: node.nodeId,
          edgeId: `edge-${slug(node.nodeId)}`,
        });
        const childRunId =
          savedCursor?.childRunId ??
          `run-${slug(runId)}-${slug(phase.phaseId)}-${slug(node.skill)}-${index}`;
        let terminalRecords =
          typeof cursorStore.loadTerminalRecords === "function"
            ? await cursorStore.loadTerminalRecords(childRunId)
            : [];
        const approval =
          typeof approvals === "function"
            ? await approvals({ phase, node, childRunId })
            : (approvals?.[node.skill] ?? approvals);
        emitTelemetry({
          phaseId: phase.phaseId,
          edgeId: `edge-${slug(node.nodeId)}`,
          childRunId,
          eventType: "approval",
          payload: { skill: node.skill, approvalId: approval?.approvalId ?? "denied" },
        });
        let upstreamArtifactRefs;
        let nodeInputArtifactRefs;
        try {
          upstreamArtifactRefs = upstreamRefsFor(node, phase, validatedOutputs);
          nodeInputArtifactRefs = await externalRefsFor(
            node,
            inputArtifactRefs,
            childArtifactResolver,
            schemaRegistry,
          );
        } catch (error) {
          return {
            node,
            approval,
            failure: {
              status: "blocked",
              failure: {
                class: "policy",
                code: "invalid-upstream-handoff",
                message: error.message,
              },
            },
          };
        }
        const request = {
          schema: "csm-orchestrate-invocation/2",
          invocationId: `invocation-${slug(childRunId)}`,
          parentRunId: runId,
          childRunId,
          phaseId: phase.phaseId,
          edgeId: `edge-${slug(node.nodeId)}`,
          skill: node.skill,
          skillDigest: node.capabilityDigest,
          ...Object.fromEntries(
            [
              "contractDigest",
              "handlerDigest",
              "receiptSchemaDigest",
              "evidenceSchemaDigest",
              "effectiveConfigDigest",
            ]
              .filter((field) => (node.executor ?? executorBindings[node.skill])?.[field])
              .map((field) => [field, (node.executor ?? executorBindings[node.skill])[field]]),
          ),
          sideEffects: node.sideEffects,
          inputArtifactRefs: nodeInputArtifactRefs,
          upstreamArtifactRefs,
          acceptanceSignalIds: phase.acceptanceSignalIds,
          outputArtifactRefs: [],
          permissions: node.approvalScope.length ? node.approvalScope : ["read"],
          approval: invocationApproval(approval),
          timeoutMs,
          cancellation: { requested: false },
          retry: {
            attempt: savedCursor?.attempt || 1,
            idempotencyKey:
              savedCursor?.idempotencyKey ?? `${phase.idempotency.key}:${node.nodeId}`,
          },
          status: "ready",
          ...(executorInput
            ? {
                input: jsonProjection(
                  typeof executorInput === "function"
                    ? await executorInput({
                        phase,
                        node,
                        childRunId,
                        attempt: savedCursor?.attempt || 1,
                      })
                    : (executorInput[node.skill] ?? executorInput),
                ),
              }
            : {}),
        };
        request.requestDigest = materialDigest(request);
        const durableAttempt =
          typeof cursorStore.loadChildAttemptByKey === "function"
            ? await cursorStore.loadChildAttemptByKey(request.retry.idempotencyKey)
            : null;
        if (durableAttempt?.state === "terminal" && durableAttempt.response)
          terminalRecords = [
            ...terminalRecords,
            {
              childRunId,
              status: durableAttempt.response.status,
              result: durableAttempt.response,
            },
          ];
        const durableError = await validateDurableTerminalRecords(terminalRecords, request);
        if (durableError)
          return {
            node,
            approval,
            failure: {
              status: "blocked",
              failure: {
                class: "policy",
                code: "invalid-durable-terminal-child",
                message: durableError,
              },
            },
          };
        const resume = savedCursor
          ? classifyResume({ cursor: savedCursor, phase, child: node, terminalRecords })
          : { action: "restart", reason: "no-cursor" };
        if (["blocked"].includes(resume.action))
          return {
            node,
            approval,
            failure: { status: "blocked", failure: { class: "policy", code: resume.reason } },
          };
        if (savedCursor && typeof cursorStore.recordReconciliation === "function") {
          if (resume.action === "reconcile") {
            try {
              await cursorStore.recordReconciliation(childRunId, "RESOLVED-COMPLETED", {
                reason: resume.reason,
              });
              emitTelemetry({
                phaseId: phase.phaseId,
                edgeId: request.edgeId,
                childRunId,
                eventType: "reconciliation",
                attempt: savedCursor.attempt || 1,
                payload: { status: "RESOLVED-COMPLETED", reason: resume.reason },
              });
            } catch {
              /* already durably resolved; the terminal record remains authoritative */
            }
          } else if (!terminalRecords.length) {
            try {
              await cursorStore.recordReconciliation(childRunId, "UNKNOWN", {
                reason: resume.reason,
              });
              emitTelemetry({
                phaseId: phase.phaseId,
                edgeId: request.edgeId,
                childRunId,
                eventType: "reconciliation",
                attempt: savedCursor.attempt || 1,
                payload: { status: "UNKNOWN", reason: resume.reason },
              });
            } catch (error) {
              return {
                node,
                approval,
                failure: {
                  status: "blocked",
                  failure: {
                    class: "policy",
                    code: "reconciliation-required",
                    message: error?.message ?? "durable reconciliation failed",
                  },
                },
              };
            }
          }
        }
        await saveCursor({
          runId,
          phase,
          node,
          childRunId,
          attempt: savedCursor?.attempt || 1,
          state: "dispatching",
          store: cursorStore,
          now,
          approval,
        });
        let result =
          resume.action === "reconcile"
            ? terminalRecords.find((record) => record.status === "completed")?.result
            : null;
        if (!result && resume.action === "reconcile")
          return {
            node,
            approval,
            failure: {
              status: "incomplete",
              failure: { class: "missing", code: "terminal-child-result-missing" },
            },
          };
        if (!result) {
          const blocked = dispatchBlocked();
          if (blocked) return { node, approval, failure: blocked };
          await progressTracker.update(progressId, {
            state: "active",
            childRunId,
            attempt: savedCursor?.attempt || 1,
          });
          emitTelemetry({
            phaseId: phase.phaseId,
            edgeId: request.edgeId,
            childRunId,
            eventType: "dispatch",
            attempt: request.retry.attempt,
            payload: { skill: request.skill, invocationId: request.invocationId },
          });
          let dispatchIntent = null;
          try {
            dispatchIntent = await beginDispatchIntent(cursorId, phase.phaseId, childRunId);
          } catch (error) {
            return { node, approval, failure: dispatchIntentFailure(error) };
          }
          result = jsonProjection(
            capOutputSize(await invokeAdapter(request, cursorId, dispatchIntent?.intentId)),
          );
          await resolveDispatchIntent(dispatchIntent, result.status);
        }
        let attempt = savedCursor?.attempt || 1;
        let invocationChildRunId = childRunId;
        while (result.status === "failed" || result.status === "incomplete") {
          const decision = retryDecision({
            failure: result.failure,
            attempt,
            maxAttempts,
            retryability: node.sideEffects.every((effect) => effect === "read-only")
              ? "safe"
              : "bounded",
            idempotencyMode: node.idempotency.mode,
            sideEffects: node.sideEffects,
          });
          if (decision.action !== "retry") break;
          const retryBlocked = dispatchBlocked();
          if (retryBlocked) return { node, approval, failure: retryBlocked };
          attempt = decision.nextAttempt;
          const retryChild = `run-${slug(runId)}-${slug(phase.phaseId)}-${slug(node.skill)}-${index}-${attempt}`;
          const retryApproval =
            typeof approvals === "function"
              ? await approvals({ phase, node, childRunId: retryChild, attempt })
              : (approvals?.[node.skill] ?? approvals);
          emitTelemetry({
            phaseId: phase.phaseId,
            edgeId: `edge-${slug(node.nodeId)}`,
            childRunId: retryChild,
            eventType: "approval",
            payload: { skill: node.skill, approvalId: retryApproval?.approvalId ?? "denied" },
          });
          const retryIdempotencyKey = `${phase.idempotency.key}:${node.nodeId}:${attempt}`;
          await saveCursor({
            runId,
            phase,
            node,
            childRunId: retryChild,
            attempt,
            state: "dispatching",
            store: cursorStore,
            now,
            approval: invocationApproval(retryApproval),
            idempotencyKey: retryIdempotencyKey,
            terminalIntent: {
              state: "retry-selected",
              childRunId: retryChild,
              attempt,
              idempotencyKey: retryIdempotencyKey,
            },
          });
          await progressTracker.update(progressId, {
            state: "active",
            childRunId: retryChild,
            attempt,
          });
          emitTelemetry({
            phaseId: phase.phaseId,
            edgeId: request.edgeId,
            childRunId: retryChild,
            eventType: "retry",
            attempt,
            payload: {
              skill: request.skill,
              invocationId: `invocation-${slug(retryChild)}`,
              priorFailureCode: result.failure?.code ?? null,
            },
          });
          if (retryBackoffMs > 0)
            await new Promise((resolve) =>
              setTimeout(resolve, retryBackoffMs * Math.pow(2, attempt - 1)),
            );
          let retryIntent = null;
          try {
            retryIntent = await beginDispatchIntent(cursorId, phase.phaseId, retryChild);
          } catch (error) {
            return { node, approval, failure: dispatchIntentFailure(error) };
          }
          result = jsonProjection(
            capOutputSize(
              await invokeAdapter(
                (() => {
                  const retryRequest = {
                    ...request,
                    childRunId: retryChild,
                    invocationId: `invocation-${slug(retryChild)}`,
                    approval: invocationApproval(retryApproval),
                    retry: {
                      attempt,
                      idempotencyKey: retryIdempotencyKey,
                    },
                  };
                  retryRequest.requestDigest = materialDigest(retryRequest);
                  return retryRequest;
                })(),
                cursorId,
                retryIntent?.intentId,
              ),
            ),
          );
          await resolveDispatchIntent(retryIntent, result.status);
          invocationChildRunId = retryChild;
          terminalApproval = retryApproval;
        }
        const receipt = childReceipt(result, node, invocationChildRunId);
        let failure =
          result.status === "completed" && !receipt
            ? { status: "blocked", failure: { class: "policy", code: "child-identity-mismatch" } }
            : result.status === "completed"
              ? null
              : result;
        const evidence = normalizeEvidence(result, node, invocationChildRunId);
        let outputRefs = [];
        if (result.status === "completed") {
          try {
            outputRefs = (result.outputArtifactRefs ?? []).map((ref) => {
              const declared = node.outputs.find(
                (output) =>
                  output.name === (ref.outputName ?? ref.name) && output.kind === ref.kind,
              );
              if (!declared) throw new TypeError("undeclared child output ref");
              const error = validateHandoffRef(ref, {
                owner: node.skill,
                runId: invocationChildRunId,
                schema: declared.schema,
                schemaRevision: declared.schemaRevision,
              });
              if (error) throw new TypeError(error);
              return {
                ...ref,
                outputName: ref.outputName ?? ref.name,
                requirementIds: [...node.requirementIds],
              };
            });
          } catch (error) {
            failure = {
              status: "blocked",
              failure: { class: "policy", code: "undeclared-child-output", message: error.message },
            };
          }
        }
        const reconciliation =
          result.status === "completed" && !failure
            ? await reconcileResult(
                result,
                node,
                invocationChildRunId,
                childArtifactResolver,
                schemaRegistry,
              )
            : { evidence: [], failures: [] };
        if (reconciliation.failures.length)
          failure = { status: "incomplete", failure: reconciliation.failures[0] };
        if (failure)
          await progressTracker.update(progressId, {
            state:
              failure.status === "blocked"
                ? "blocked"
                : failure.status === "failed"
                  ? "failed"
                  : "incomplete",
            blocker: {
              code: String(failure.failure?.code ?? "CHILD_FAILURE")
                .toUpperCase()
                .replace(/[^A-Z0-9_]/g, "_")
                .slice(0, 64),
              message: String(
                failure.failure?.message ?? failure.failure?.code ?? "child failed",
              ).slice(0, 500),
            },
          });
        const technical = [
          ...(technicalGate
            ? await technicalGate({ phase, node, result })
            : defaultGate(result, "technical")),
        ];
        const functional = [
          ...(functionalGate
            ? await functionalGate({ phase, node, result })
            : defaultGate(result, "functional")),
        ];
        const reconciledEvidence = reconciliation.evidence ?? [];
        if (!failure && result.status === "completed")
          await saveCursor({
            runId,
            phase,
            node,
            childRunId: invocationChildRunId,
            attempt,
            state: "validated",
            store: cursorStore,
            now,
          });
        if (!failure && result.status === "completed")
          await progressTracker.update(progressId, {
            state: "active",
            childRunId: invocationChildRunId,
            attempt,
            evidenceRefs: [...evidence, ...reconciledEvidence]
              .map((item) => item.evidenceId)
              .filter(Boolean),
          });
        return {
          node,
          approval,
          result,
          receipt,
          evidence: [...evidence, ...reconciledEvidence],
          technical,
          functional,
          outputRefs,
          failure,
        };
      };
      const pending = new Map(phase.routeNodes.map((node) => [node.nodeId, node]));
      while (pending.size && !phaseFailure) {
        const blocked = dispatchBlocked();
        if (blocked) {
          phaseFailure = blocked;
          break;
        }
        const ready = [...pending.values()]
          .filter((node) =>
            (node.dependencies ?? []).every((dependency) => completedNodeIds.has(dependency)),
          )
          .toSorted((a, b) => a.ordering - b.ordering);
        if (!ready.length) {
          phaseFailure = {
            status: "blocked",
            failure: { class: "policy", code: "route-dependency-incomplete" },
          };
          break;
        }
        const concurrency = classifyConcurrency(ready);
        const batch =
          concurrency.mode === "parallel-independent-read-only"
            ? ready.slice(0, 4)
            : ready.slice(0, 1);
        const results = (await Promise.all(batch.map(executeNode))).toSorted(
          (a, b) => a.node.ordering - b.node.ordering,
        );
        if (!phaseFailure && signal?.aborted) phaseFailure = abortFailure();
        for (const item of results) {
          pending.delete(item.node.nodeId);
          terminalApproval = item.approval;
          if (item.receipt && !item.failure) childReceipts.push(item.receipt);
          phaseEvidence.push(...(item.evidence ?? []));
          phaseTechnical.push(...(item.technical ?? []));
          phaseFunctional.push(...(item.functional ?? []));
          if (!item.failure && item.result?.status === "completed") {
            completedNodeIds.add(item.node.nodeId);
            validatedOutputs.set(item.node.nodeId, item.outputRefs);
          } else if (!phaseFailure) {
            phaseFailure = item.failure ?? item.result;
          }
        }
      }
      allEvidence.push(...phaseEvidence);
      const ledger = {
        schema: "csm-orchestrate-requirement/2",
        ledgerId: `ledger-${slug(runId)}-${slug(phase.phaseId)}`,
        requirements: phase.requirementIds.map((requirementId) => ({
          requirementId,
          criticality: "critical",
          statement: phase.acceptanceSignals.join("; "),
          acceptanceSignalIds: [...phase.acceptanceSignalIds],
          status: "open",
          evidenceRefs: phaseEvidence
            .filter((item) => item.requirementIds?.includes(requirementId))
            .map((item) => ({
              evidenceId: item.evidenceId,
              kind: item.kind,
              requirementId,
              status: item.status === "current" ? "available" : item.status,
              digest: item.digest,
              ...(item.acceptanceSignalId ? { acceptanceSignalId: item.acceptanceSignalId } : {}),
            })),
        })),
      };
      const requirementResult = reconcileRequirementEvidence(
        ledger,
        {
          evidence: phaseEvidence,
          failures: phaseFailure
            ? [phaseFailure.failure]
                .filter(Boolean)
                .map((item) =>
                  [
                    "missing",
                    "stale",
                    "contradicted",
                    "unavailable",
                    "infrastructure",
                    "technical",
                    "functional",
                    "policy",
                  ].includes(item.class)
                    ? item
                    : { ...item, class: "infrastructure" },
                )
            : [],
        },
        { now: now() },
      );
      const requirements = requirementResult.requirements;
      const gate = aggregateGates({
        runId,
        phaseId: phase.phaseId,
        technical: phaseTechnical,
        functional: phaseFunctional,
        evidence: phaseEvidence,
        requirementResult,
      });
      await assertSchema("csm-orchestrate-gate/1", gate);
      let review;
      let reviewTimedOut = false;
      if (adversarialReview) {
        try {
          review = await raceDeadline(
            adversarialReview({ phase, evidence: phaseEvidence, gate, childReceipts }),
            reviewTimeoutMs,
            "review-timeout",
          );
        } catch (error) {
          if (!error?.timeout) throw error;
          reviewTimedOut = true;
          review = {
            schema: "csm-orchestrate-adversarial-review/2",
            reviewId: `review-${slug(runId)}-${slug(phase.phaseId)}-timeout`,
            runId,
            phaseId: phase.phaseId,
            status: "REJECTED",
            independent: true,
            provenance: {
              mode: "local-test-seam",
              reviewer: "race-deadline",
              reviewerChildRunId: `run-${slug(runId)}-review-timeout`,
            },
            requirementCoverage: [],
            evidenceEntailment: "failed",
            technical: [],
            functional: [],
            findings: [{ code: "review-timeout", summary: "adversarial review timed out" }],
          };
        }
      } else
        review = reviewAcceptance({
          runId,
          requirements,
          claims: phaseEvidence.map((item) => ({
            ...(item.requirementIds ? { requirementIds: item.requirementIds } : {}),
            evidenceRefs: [
              {
                evidenceId: item.evidenceId,
                ...(item.acceptanceSignalId ? { acceptanceSignalId: item.acceptanceSignalId } : {}),
              },
            ],
          })),
          evidence: phaseEvidence,
          technical: phaseTechnical,
          functional: phaseFunctional,
          completion: !phaseFailure && gate.status === "VERIFIED",
        });
      emitTelemetry({
        phaseId: phase.phaseId,
        edgeId: "edge-final-review",
        childRunId: `run-${slug(runId)}-review-${slug(phase.phaseId)}`,
        eventType: "review",
        payload: { status: review.status, reviewId: review.reviewId },
      });
      await assertSchema("csm-orchestrate-adversarial-review/2", review);
      const phaseState = phaseFailure
        ? phaseFailure.status === "blocked"
          ? "blocked"
          : phaseFailure.status === "failed"
            ? "failed"
            : "incomplete"
        : gate.status === "BLOCKED"
          ? "blocked"
          : gate.status === "VERIFIED" && review.status === "ACCEPTED"
            ? "verified"
            : "incomplete";
      for (const progressItem of progressTracker.snapshot.items.filter(
        (item) => item.phaseId === phase.phaseId,
      ))
        if (progressItem.state === "pending" || progressItem.state === "active")
          await progressTracker.update(progressItem.itemId, {
            state: phaseState,
            ...(phaseState === "verified" ? { verifiedFraction: 1 } : {}),
          });
      phaseResults.push({ phase, requirements, gate, review });
      if (review?.reviewId) reviewIds.push(review.reviewId);
      executedPhaseIds.add(phase.phaseId);
      if (phaseFailure)
        return emitTerminalReceipt(
          runId,
          phase.phaseId,
          terminalApproval,
          phaseFailure.status === "blocked"
            ? "BLOCKED"
            : phaseFailure.status === "incomplete"
              ? "INCOMPLETE"
              : "FAILED",
          childReceipts,
          phaseEvidence.map((item) => item.evidenceId),
          {
            gate,
            review,
            reason: phaseFailure.failure?.code ?? "child-failure",
            extensions: receiptExtensions(),
          },
        );
      if (gate.status !== "VERIFIED" || review.status !== "ACCEPTED")
        return emitTerminalReceipt(
          runId,
          phase.phaseId,
          terminalApproval,
          gate.status === "BLOCKED"
            ? "BLOCKED"
            : gate.status === "FAILED"
              ? "FAILED"
              : "INCOMPLETE",
          childReceipts,
          phaseEvidence.map((item) => item.evidenceId),
          {
            gate,
            review,
            ...(reviewTimedOut ? { reason: "review-timeout" } : {}),
            extensions: receiptExtensions(),
          },
        );
    }

    if (signal?.aborted)
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "INCOMPLETE",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: "aborted", extensions: receiptExtensions() },
      );

    if (!finalReviewExecutor && !finalReview && typeof host?.invokeReview !== "function")
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "REQUIRES_REVIEW",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: "independent-final-review-required", phases: phaseResults },
      );
    if (
      finalReviewExecutor &&
      (typeof producerExecutorId !== "string" || producerExecutorId.length === 0)
    )
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "REQUIRES_REVIEW",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        {
          reason: "producer-executor-identity-required",
          reviewState: "UNKNOWN",
          extensions: receiptExtensions(),
        },
      );
    const reviewInvocation = JSON.parse(
      JSON.stringify(
        jsonProjection({
          parentRunId: runId,
          producerExecutorId,
          phase: phaseResults.at(-1)?.phase,
          phaseId: phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          edgeId: "edge-final-review",
          phaseResults: phaseResults.map(({ phase, gate }) => ({
            phase,
            gate: {
              schema: gate.schema,
              gateId: gate.gateId,
              runId: gate.runId,
              phaseId: gate.phaseId,
              technical: gate.technical,
              functional: gate.functional,
              status: gate.status,
            },
          })),
          evidence: allEvidence.map((item) => ({
            evidenceId: item.evidenceId,
            kind: item.kind,
            status: item.status,
            owner: item.owner,
            runId: item.runId,
            digest: item.digest,
            requirementIds: item.requirementIds,
            acceptanceSignalId: item.acceptanceSignalId,
            source: item.source
              ? {
                  path: item.source.path,
                  artifactId: item.source.artifactId,
                  digest: item.source.digest,
                  schema: item.source.schema,
                  sourceRunId: item.source.sourceRunId,
                }
              : undefined,
          })),
          childReceipts: childReceipts.map(
            ({ receiptId, schema, runId: childRunId, digest: childDigest, owner, status }) => ({
              receiptId,
              schema,
              runId: childRunId,
              digest: childDigest,
              owner,
              status,
            }),
          ),
          requirements: phaseResults.flatMap((item) =>
            (item.requirements ?? []).map((requirement) => ({
              requirementId: requirement.requirementId,
              criticality: requirement.criticality,
              acceptanceSignalIds: requirement.acceptanceSignalIds,
              waiver: requirement.waiver,
            })),
          ),
          timeoutMs: reviewTimeoutMs,
          ...(reviewArtifactRoot ? { artifactRoot: reviewArtifactRoot } : {}),
        }),
      ),
    );
    const hostReview = finalReviewExecutor
      ? await finalReviewExecutor.invokeReview(reviewInvocation, { signal })
      : typeof adapter.invokeReview === "function"
        ? await adapter.invokeReview(reviewInvocation)
        : null;
    emitTelemetry({
      phaseId: reviewInvocation.phaseId,
      edgeId: reviewInvocation.edgeId,
      childRunId: hostReview?.review?.provenance?.reviewerChildRunId ?? null,
      eventType: "review",
      payload: {
        status: hostReview?.status ?? "unknown",
        reviewId: hostReview?.review?.reviewId ?? null,
        failureCode: hostReview?.failure?.code ?? null,
      },
    });
    if (hostReview?.status !== "completed" && !finalReview)
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "REQUIRES_REVIEW",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        {
          reason:
            hostReview?.failure?.message ?? hostReview?.failure?.code ?? "ambiguous-final-review",
          reviewState: "UNKNOWN",
          extensions: receiptExtensions(),
        },
      );
    if (hostReview?.failure?.code === "review-timeout")
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "INCOMPLETE",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: "review-timeout", extensions: receiptExtensions() },
      );
    if (hostReview?.status === "completed" && hostReview.review) {
      const final = hostReview.review;
      if (
        (finalReviewExecutor || hostReview.reviewArtifactRefs) &&
        (!artifactResolver?.resolve || !schemaRegistry?.resolve)
      )
        return emitTerminalReceipt(
          runId,
          phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          terminalApproval,
          "REQUIRES_REVIEW",
          childReceipts,
          allEvidence.map((item) => item.evidenceId),
          { reason: "review-artifact-resolver-required", reviewState: "UNKNOWN" },
        );
      try {
        if (finalReviewExecutor || hostReview.reviewArtifactRefs)
          await validateReviewArtifacts(hostReview, artifactResolver, schemaRegistry);
      } catch (error) {
        return emitTerminalReceipt(
          runId,
          phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          terminalApproval,
          "BLOCKED",
          childReceipts,
          allEvidence.map((item) => item.evidenceId),
          {
            reason: "invalid-review-artifact",
            failure: { class: "policy", code: "invalid-review-artifact", message: error.message },
          },
        );
      }
      if (hostReview.reviewArtifactRefs || finalReviewExecutor)
        await assertSchema("csm-orchestrate-adversarial-review/2", final);
      if (final?.reviewId) reviewIds.push(final.reviewId);
      let hostRemediation = null;
      if (remediationFactory) {
        try {
          hostRemediation = await raceDeadline(
            remediationFactory({ graph: activeGraph, review: final, phaseResults }),
            reviewTimeoutMs,
            "remediation-timeout",
          );
        } catch (error) {
          if (!error?.timeout) throw error;
          hostRemediation = null;
        }
      }
      const coordinated = coordinateFinalReview({
        graph: activeGraph,
        review: final,
        remediation: hostRemediation,
        completedEffects: new Set(activeGraph.phases.flatMap((phase) => phase.sideEffects)),
      });
      emitTelemetry({
        phaseId: phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        edgeId: "edge-final-review",
        eventType: "remediation",
        payload: {
          status: coordinated.status,
          reviewId: final?.reviewId ?? null,
          phaseId: coordinated.remediation?.phaseId ?? null,
        },
      });
      if (hostReview.reviewArtifactRefs || finalReviewExecutor)
        await assertSchema("csm-orchestrate-final-review/2", coordinated);
      if (coordinated.status === "REMEDIATION_REQUIRED") {
        const rawRemediation = coordinated.remediation;
        const insertAt = coordinated.graph.phases.findIndex(
          (phase) => phase.phaseId === rawRemediation.phaseId,
        );
        const remediationGraph = await compileApproach(
          {
            schema: "csm-approach/1",
            schemaRevision: 1,
            status: "agreed",
            runId,
            ideaSlug: "remediation",
            phases: [
              {
                phaseId: "P1",
                title: rawRemediation.outcome?.title ?? "Remediate review finding",
                goal: rawRemediation.outcome?.goal ?? rawRemediation.acceptanceSignals.join("; "),
                deliverables: rawRemediation.outcome?.deliverables ?? ["review gap closed"],
                scope: rawRemediation.scope?.include ?? ["declared review gap"],
                outOfScope: rawRemediation.scope?.exclude ?? [],
                constraints: [],
                acceptanceHints: rawRemediation.acceptanceSignals,
                context: [],
                dependencies: [],
              },
            ],
          },
          {
            capabilities,
            signals: { ...signals, capabilities: [rawRemediation.route] },
            graphRevision: coordinated.graph.graphRevision,
            parentPhaseId: rawRemediation.parentPhaseId,
            phaseIdOverride: rawRemediation.phaseId,
          },
        );
        activeGraph = {
          ...coordinated.graph,
          phases: [
            ...coordinated.graph.phases.slice(0, insertAt),
            Object.freeze({
              ...rawRemediation,
              ...remediationGraph.phases[0],
              graphRevision: rawRemediation.graphRevision,
              parentPhaseId: rawRemediation.parentPhaseId,
              insertion: rawRemediation.insertion,
              order: rawRemediation.order,
              remediationBudget: rawRemediation.remediationBudget,
              requirementDelta: rawRemediation.requirementDelta,
              reviewFindings: rawRemediation.reviewFindings,
              sourceReviewId: rawRemediation.sourceReviewId,
              acceptanceContract: rawRemediation.acceptanceContract,
            }),
            ...coordinated.graph.phases.slice(insertAt + 1),
          ],
        };
        const remediationPhase = activeGraph.phases[insertAt];
        await progressTracker.addPhase(remediationPhase);
        remediationLineage.push({
          sourceReviewId: remediationPhase.sourceReviewId,
          findings: remediationPhase.reviewFindings,
          requirementDelta: remediationPhase.requirementDelta,
          phaseId: remediationPhase.phaseId,
          parentPhaseId: remediationPhase.parentPhaseId,
          acceptanceContract: remediationPhase.acceptanceContract,
        });
        phaseIndex = insertAt;
        continue;
      }
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        coordinated.status,
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        {
          finalReview: coordinated.finalReview,
          reviewArtifactRefs: hostReview.reviewArtifactRefs,
          ...(coordinated.status === "BLOCKED"
            ? { reason: coordinated.routing?.reason ?? "final-review-blocked" }
            : {}),
          phases: phaseResults,
          extensions: receiptExtensions(),
        },
      );
    }
    let final = null;
    let finalTimedOut = false;
    if (finalReview) {
      try {
        final = await raceDeadline(
          finalReview(
            jsonProjection({
              phase: phaseResults.at(-1)?.phase,
              graph: activeGraph,
              phaseResults,
              evidence: allEvidence,
              childReceipts,
              ...(reviewArtifactRoot ? { artifactRoot: reviewArtifactRoot } : {}),
            }),
          ),
          reviewTimeoutMs,
          "review-timeout",
        );
      } catch (error) {
        if (!error?.timeout) throw error;
        final = null;
        finalTimedOut = true;
      }
    }
    if (!final)
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "INCOMPLETE",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: finalTimedOut ? "review-timeout" : "invalid-final-review" },
      );
    const injectedReviewRefs = final.reviewArtifactRefs;
    final = final.review ?? final;
    if (injectedReviewRefs || reviewArtifactRoot)
      await assertSchema("csm-orchestrate-adversarial-review/2", final);
    if (final?.reviewId) reviewIds.push(final.reviewId);
    if (finalReview && final.status === "ACCEPTED" && (injectedReviewRefs || reviewArtifactRoot)) {
      if (!artifactResolver?.resolve || !schemaRegistry?.resolve)
        return emitTerminalReceipt(
          runId,
          phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          terminalApproval,
          "REQUIRES_REVIEW",
          childReceipts,
          allEvidence.map((item) => item.evidenceId),
          { reason: "review-artifact-resolver-required", reviewState: "UNKNOWN" },
        );
      try {
        await validateReviewArtifacts(
          { review: final, reviewArtifactRefs: injectedReviewRefs },
          artifactResolver,
          schemaRegistry,
        );
        final = Object.defineProperty({ ...final }, HOST_REVIEW, { value: true });
      } catch (error) {
        return emitTerminalReceipt(
          runId,
          phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          terminalApproval,
          "BLOCKED",
          childReceipts,
          allEvidence.map((item) => item.evidenceId),
          {
            reason: "invalid-review-artifact",
            failure: { class: "policy", code: "invalid-review-artifact", message: error.message },
          },
        );
      }
      const contextual = validateInjectedFinalReview({
        review: final,
        runId,
        phaseResults,
        evidence: allEvidence,
      });
      if (!contextual.valid)
        return emitTerminalReceipt(
          runId,
          phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
          terminalApproval,
          "BLOCKED",
          childReceipts,
          allEvidence.map((item) => item.evidenceId),
          {
            reason: "untrusted-final-review",
            reviewFailures: contextual.failures,
          },
        );
    }
    let remediation = null;
    if (remediationFactory) {
      try {
        remediation = await raceDeadline(
          remediationFactory({ graph: activeGraph, review: final, phaseResults }),
          reviewTimeoutMs,
          "remediation-timeout",
        );
      } catch (error) {
        if (!error?.timeout) throw error;
        remediation = null;
      }
    }
    const coordinated = coordinateFinalReview({
      graph: activeGraph,
      review: final,
      remediation,
      completedEffects: new Set(activeGraph.phases.flatMap((phase) => phase.sideEffects)),
      injected: Boolean(finalReview),
    });
    emitTelemetry({
      phaseId: phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
      edgeId: "edge-final-review",
      eventType: "remediation",
      payload: {
        status: coordinated.status,
        reviewId: final?.reviewId ?? null,
        phaseId: coordinated.remediation?.phaseId ?? null,
      },
    });
    if (injectedReviewRefs || reviewArtifactRoot)
      await assertSchema("csm-orchestrate-final-review/2", coordinated);
    if (coordinated.status === "REMEDIATION_REQUIRED") {
      const rawRemediation = coordinated.remediation;
      const insertAt = coordinated.graph.phases.findIndex(
        (phase) => phase.phaseId === rawRemediation.phaseId,
      );
      const remediationGraph = await compileApproach(
        {
          schema: "csm-approach/1",
          schemaRevision: 1,
          status: "agreed",
          runId,
          ideaSlug: "remediation",
          phases: [
            {
              phaseId: "P1",
              title: rawRemediation.outcome?.title ?? "Remediate review finding",
              goal: rawRemediation.outcome?.goal ?? rawRemediation.acceptanceSignals.join("; "),
              deliverables: rawRemediation.outcome?.deliverables ?? ["review gap closed"],
              scope: rawRemediation.scope?.include ?? ["declared review gap"],
              outOfScope: rawRemediation.scope?.exclude ?? [],
              constraints: [],
              acceptanceHints: rawRemediation.acceptanceSignals,
              context: [],
              dependencies: [],
            },
          ],
        },
        {
          capabilities,
          signals: { ...signals, capabilities: [rawRemediation.route] },
          graphRevision: coordinated.graph.graphRevision,
          parentPhaseId: rawRemediation.parentPhaseId,
          phaseIdOverride: rawRemediation.phaseId,
        },
      );
      activeGraph = {
        ...coordinated.graph,
        phases: [
          ...coordinated.graph.phases.slice(0, insertAt),
          Object.freeze({
            ...rawRemediation,
            ...remediationGraph.phases[0],
            graphRevision: rawRemediation.graphRevision,
            parentPhaseId: rawRemediation.parentPhaseId,
            insertion: rawRemediation.insertion,
            order: rawRemediation.order,
            remediationBudget: rawRemediation.remediationBudget,
            requirementDelta: rawRemediation.requirementDelta,
            reviewFindings: rawRemediation.reviewFindings,
            sourceReviewId: rawRemediation.sourceReviewId,
            acceptanceContract: rawRemediation.acceptanceContract,
          }),
          ...coordinated.graph.phases.slice(insertAt + 1),
        ],
      };
      const remediationPhase = activeGraph.phases[insertAt];
      await progressTracker.addPhase(remediationPhase);
      remediationLineage.push({
        sourceReviewId: remediationPhase.sourceReviewId,
        findings: remediationPhase.reviewFindings,
        requirementDelta: remediationPhase.requirementDelta,
        phaseId: remediationPhase.phaseId,
        parentPhaseId: remediationPhase.parentPhaseId,
        acceptanceContract: remediationPhase.acceptanceContract,
      });
      phaseIndex = insertAt;
      continue;
    }
    return emitTerminalReceipt(
      runId,
      phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
      terminalApproval,
      coordinated.status,
      childReceipts,
      allEvidence.map((item) => item.evidenceId),
      {
        finalReview: coordinated.finalReview,
        ...(injectedReviewRefs ? { reviewArtifactRefs: injectedReviewRefs } : {}),
        ...(coordinated.status === "VERIFIED" ? { reason: "accepted" } : {}),
        ...(coordinated.status === "BLOCKED"
          ? { reason: coordinated.routing?.reason ?? "final-review-blocked" }
          : {}),
        phases: phaseResults,
        extensions: receiptExtensions(),
      },
    );
  }
}

export async function orchestrate(options) {
  const result = await runOrchestrationInternal(options);
  const progressTracker = progressByReceipt.get(result);
  if (progressTracker) await progressTracker.flush();
  const progress = progressTracker?.snapshot ?? null;
  const durable = {
    schema: result.schema,
    receiptId: result.receiptId,
    runId: result.runId,
    phaseId: result.phaseId,
    childReceipts: [...(result.childReceipts ?? [])],
    approval: result.approval,
    statuses: result.statuses,
    outcome: result.outcome,
    idempotencyKey: result.idempotencyKey,
    ...(result.extensions
      ? {
          extensions: {
            ...result.extensions,
            phaseResults: result.phases ?? [],
            finalReview: result.finalReview ?? null,
          },
        }
      : {}),
  };
  await assertSchema("csm-orchestrate-receipt/2", durable);
  if (options?.cursorStore?.saveTerminalReceipt)
    await persistTerminalReceipt(durable, options.cursorStore);
  return {
    ...result,
    progress,
    receipt: durable,
    ...(durable.extensions?.reviewArtifactRefs
      ? { reviewArtifactRefs: durable.extensions.reviewArtifactRefs }
      : {}),
  };
}

export const runOrchestration = orchestrate;

export function makeAutonomousFunctionalGate(validatorBindings) {
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
