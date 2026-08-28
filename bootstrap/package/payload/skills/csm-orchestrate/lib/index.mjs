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
    ...extra,
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
      expectedArtifactId: ref.sourceArtifactId,
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
        requirementIds: item.requirementIds,
        ...(item.acceptanceSignalId ? { acceptanceSignalId: item.acceptanceSignalId } : {}),
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
    if (declared && schemaRegistry?.resolve) schemaRegistry.resolve(declared);
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
  signal = null,
  telemetryEmitter = null,
  effectiveConfigDigest = null,
  inputArtifactRefs = [],
  artifactResolver,
  schemaRegistry,
  parentPhaseId = null,
  phaseIdOverride = null,
} = {}) {
  if (!RUN_ID.test(runId ?? "")) throw new TypeError("canonical parent runId is required");
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
    } catch {
      return;
    }
  };
  const emitTerminalReceipt = (...args) => {
    const receipt = terminalReceipt(...args);
    emitTelemetry({
      phaseId: receipt.phaseId,
      eventType: "terminal",
      payload: { receiptId: receipt.receiptId, status: receipt.outcome.status },
    });
    return receipt;
  };
  if (!host || typeof host.invokeSiblingSkill !== "function")
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "unavailable-host",
    });
  if (
    !cursorStore ||
    typeof cursorStore.saveCursor !== "function" ||
    typeof cursorStore.loadCursor !== "function"
  )
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "durable-cursor-required",
    });
  const graph = await compileApproach(approach, {
    capabilities,
    signals,
    parentPhaseId,
    phaseIdOverride,
  });
  const adapter = createHostInvocationAdapter({
    host,
    capabilities,
    artifactResolver,
    schemaRegistry,
    now,
  });
  const preflight = autonomyGate({
    host,
    permissions: graph.phases.flatMap((phase) => phase.approvalScope),
    approvals,
    idempotency: graph.phases.map((phase) => phase.idempotency),
    route: graph.phases.flatMap((phase) => phase.routeNodes),
    evaluation: { signals, technicalGate, functionalGate },
  });
  if (!preflight.enabled)
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "autonomy-preflight-blocked",
      missing: preflight.missing,
    });
  let dispatchedSteps = 0;
  const dispatchBlocked = () =>
    signal?.aborted ? abortFailure() : dispatchedSteps >= maxSteps ? stepCapFailure() : null;
  const invokeAdapter = async (request) => {
    dispatchedSteps += 1;
    return adapter.invoke(request, signal ? { signal } : undefined);
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
        const terminalRecords =
          typeof cursorStore.loadTerminalRecords === "function"
            ? await cursorStore.loadTerminalRecords(childRunId)
            : [];
        const approval =
          typeof approvals === "function"
            ? await approvals({ phase, node, childRunId })
            : (approvals?.[node.skill] ?? approvals);
        let upstreamArtifactRefs;
        let nodeInputArtifactRefs;
        try {
          upstreamArtifactRefs = upstreamRefsFor(node, phase, validatedOutputs);
          nodeInputArtifactRefs = await externalRefsFor(
            node,
            inputArtifactRefs,
            artifactResolver,
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
          inputArtifactRefs: nodeInputArtifactRefs,
          upstreamArtifactRefs,
          acceptanceSignalIds: phase.acceptanceSignalIds,
          outputArtifactRefs: [],
          permissions: node.approvalScope.length ? node.approvalScope : ["read"],
          approval: invocationApproval(approval),
          timeoutMs,
          cancellation: { requested: false },
          retry: {
            attempt: savedCursor?.attempt ?? 0,
            idempotencyKey:
              savedCursor?.idempotencyKey ?? `${phase.idempotency.key}:${node.nodeId}`,
          },
          status: "ready",
        };
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
        await saveCursor({
          runId,
          phase,
          node,
          childRunId,
          attempt: 0,
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
          emitTelemetry({
            phaseId: phase.phaseId,
            edgeId: request.edgeId,
            childRunId,
            eventType: "dispatch",
            attempt: request.retry.attempt,
            payload: { skill: request.skill, invocationId: request.invocationId },
          });
          result = await invokeAdapter(request);
        }
        let attempt = savedCursor?.attempt ?? 0;
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
          result = await invokeAdapter({
            ...request,
            childRunId: retryChild,
            invocationId: `invocation-${slug(retryChild)}`,
            approval: invocationApproval(retryApproval),
            retry: {
              attempt,
              idempotencyKey: retryIdempotencyKey,
            },
          });
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
              return { ...ref, outputName: ref.outputName ?? ref.name };
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
                artifactResolver,
                schemaRegistry,
              )
            : { evidence: [], failures: [] };
        if (reconciliation.failures.length)
          failure = { status: "incomplete", failure: reconciliation.failures[0] };
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
          if (item.receipt) childReceipts.push(item.receipt);
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
      const review = adversarialReview
        ? await adversarialReview({ phase, evidence: phaseEvidence, gate, childReceipts })
        : reviewAcceptance({
            runId,
            requirements,
            claims: phaseEvidence.map((item) => ({
              ...(item.requirementIds ? { requirementIds: item.requirementIds } : {}),
              evidenceRefs: [
                {
                  evidenceId: item.evidenceId,
                  ...(item.acceptanceSignalId
                    ? { acceptanceSignalId: item.acceptanceSignalId }
                    : {}),
                },
              ],
            })),
            evidence: phaseEvidence,
            technical: phaseTechnical,
            functional: phaseFunctional,
            completion: !phaseFailure && gate.status === "VERIFIED",
          });
      await assertSchema("csm-orchestrate-adversarial-review/2", review);
      phaseResults.push({ phase, gate, review });
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
          { gate, review, extensions: receiptExtensions() },
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

    if (!finalReview && typeof host.invokeReview !== "function")
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "REQUIRES_REVIEW",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: "independent-final-review-required", phases: phaseResults },
      );
    const reviewInvocation = {
      parentRunId: runId,
      phase: phaseResults.at(-1)?.phase,
      phaseId: phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
      edgeId: "edge-final-review",
      graphRevision: activeGraph.graphRevision,
      phaseResults,
      evidence: allEvidence,
      childReceipts,
    };
    const hostReview =
      typeof adapter.invokeReview === "function"
        ? await adapter.invokeReview(reviewInvocation)
        : null;
    if (hostReview?.status === "completed" && hostReview.review) {
      const final = hostReview.review;
      await assertSchema("csm-orchestrate-adversarial-review/2", final);
      if (final?.reviewId) reviewIds.push(final.reviewId);
      const coordinated = coordinateFinalReview({
        graph: activeGraph,
        review: final,
        remediation: remediationFactory
          ? await remediationFactory({ graph: activeGraph, review: final, phaseResults })
          : null,
        completedEffects: new Set(activeGraph.phases.flatMap((phase) => phase.sideEffects)),
      });
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
          ...(coordinated.status === "BLOCKED"
            ? { reason: coordinated.routing?.reason ?? "final-review-blocked" }
            : {}),
          phases: phaseResults,
          extensions: receiptExtensions(),
        },
      );
    }
    const final = finalReview
      ? await finalReview({
          phase: phaseResults.at(-1)?.phase,
          graph: activeGraph,
          phaseResults,
          evidence: allEvidence,
          childReceipts,
        })
      : null;
    if (!final)
      return emitTerminalReceipt(
        runId,
        phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
        terminalApproval,
        "INCOMPLETE",
        childReceipts,
        allEvidence.map((item) => item.evidenceId),
        { reason: "invalid-final-review" },
      );
    await assertSchema("csm-orchestrate-adversarial-review/2", final);
    if (final?.reviewId) reviewIds.push(final.reviewId);
    if (finalReview && final.status === "ACCEPTED") {
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
    const coordinated = coordinateFinalReview({
      graph: activeGraph,
      review: final,
      remediation: remediationFactory
        ? await remediationFactory({ graph: activeGraph, review: final, phaseResults })
        : null,
      completedEffects: new Set(activeGraph.phases.flatMap((phase) => phase.sideEffects)),
      injected: Boolean(finalReview),
    });
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
  return result;
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
