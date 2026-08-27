"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";
import { compileApproach } from "./phase-compiler.mjs";
import { createHostInvocationAdapter, validateDurableTerminalRecords } from "./invocation.mjs";
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
  classifyResume,
  createParentCursor,
  loadCursor,
  persistTerminalReceipt,
  persistCursor,
  retryDecision,
} from "./recovery.mjs";
import { assertSchema } from "./contracts.mjs";

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
    schema: "csm-orchestrate-receipt/1",
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
      child: childReceipts.some((item) => item.status === "failed") ? "failed" : "completed",
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

function normalizeEvidence(result, node, childRunId, requirementIds) {
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
      requirementIds: unique([...(item.requirementIds ?? []), ...requirementIds]),
    };
  });
}

function defaultGate(result, kind) {
  return result?.[kind] ?? [];
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

async function saveCursor({ runId, phase, node, childRunId, attempt, state, store, now }) {
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
      idempotencyKey: phase.idempotency.key,
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
  inputArtifactRefs = [],
  artifactResolver,
  schemaRegistry,
  parentPhaseId = null,
  phaseIdOverride = null,
} = {}) {
  if (!RUN_ID.test(runId ?? "")) throw new TypeError("canonical parent runId is required");
  if (!host || typeof host.invokeSiblingSkill !== "function")
    return terminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "unavailable-host",
    });
  if (
    !cursorStore ||
    typeof cursorStore.saveCursor !== "function" ||
    typeof cursorStore.loadCursor !== "function"
  )
    return terminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "durable-cursor-required",
    });
  const graph = await compileApproach(approach, {
    capabilities,
    signals,
    parentPhaseId,
    phaseIdOverride,
  });
  const adapter = createHostInvocationAdapter({ host, capabilities, now });
  const childReceipts = [];
  const allEvidence = [];
  const phaseResults = [];
  const completedNodeIds = new Set();
  let activeGraph = graph;
  let terminalApproval = null;

  for (let index = 0; index < activeGraph.phases.length; index += 1) {
    const phase = activeGraph.phases[index];
    let phaseEvidence = [];
    let phaseTechnical = [];
    let phaseFunctional = [];
    let phaseFailure = null;
    for (const node of phase.routeNodes) {
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
      terminalApproval = approval;
      const request = {
        schema: "csm-orchestrate-invocation/1",
        invocationId: `invocation-${slug(childRunId)}`,
        parentRunId: runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${slug(node.nodeId)}`,
        skill: node.skill,
        skillDigest: node.capabilityDigest,
        inputArtifactRefs,
        outputArtifactRefs: [],
        permissions: node.approvalScope.length ? node.approvalScope : ["read"],
        approval,
        timeoutMs,
        cancellation: { requested: false },
        retry: { attempt: 0, idempotencyKey: `${phase.idempotency.key}:${node.nodeId}` },
        status: "ready",
      };
      const durableError = await validateDurableTerminalRecords(terminalRecords, request);
      if (durableError)
        return terminalReceipt(runId, phase.phaseId, null, "BLOCKED", childReceipts, [], {
          reason: "invalid-durable-terminal-child",
          detail: durableError,
        });
      const resume = savedCursor
        ? classifyResume({ cursor: savedCursor, phase, child: node, terminalRecords })
        : { action: "restart", reason: "no-cursor" };
      if (["blocked"].includes(resume.action))
        return terminalReceipt(runId, phase.phaseId, null, "BLOCKED", childReceipts, [], {
          reason: resume.reason,
        });
      if ((node.dependencies ?? []).some((dependency) => !completedNodeIds.has(dependency)))
        return terminalReceipt(runId, phase.phaseId, null, "BLOCKED", childReceipts, [], {
          reason: "route-dependency-incomplete",
        });
      await saveCursor({
        runId,
        phase,
        node,
        childRunId,
        attempt: 0,
        state: "dispatching",
        store: cursorStore,
        now,
      });
      let result =
        resume.action === "reconcile"
          ? terminalRecords.find((record) => record.status === "completed")?.result
          : null;
      if (!result && resume.action === "reconcile")
        return terminalReceipt(
          runId,
          phase.phaseId,
          terminalApproval,
          "INCOMPLETE",
          childReceipts,
          [],
          {
            reason: "terminal-child-result-missing",
          },
        );
      result ??= await adapter.invoke(request);
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
        attempt = decision.nextAttempt;
        const retryChild = `run-${slug(runId)}-${slug(phase.phaseId)}-${slug(node.skill)}-${index}-${attempt}`;
        const retryApproval =
          typeof approvals === "function"
            ? await approvals({ phase, node, childRunId: retryChild, attempt })
            : (approvals?.[node.skill] ?? approvals);
        result = await adapter.invoke({
          ...request,
          childRunId: retryChild,
          invocationId: `invocation-${slug(retryChild)}`,
          approval: retryApproval,
          retry: { attempt, idempotencyKey: `${phase.idempotency.key}:${node.nodeId}:${attempt}` },
        });
        invocationChildRunId = retryChild;
        terminalApproval = retryApproval;
      }
      const receipt = childReceipt(result, node, invocationChildRunId);
      if (result.status === "completed" && !receipt)
        phaseFailure = {
          status: "blocked",
          failure: { class: "policy", code: "child-identity-mismatch" },
        };
      if (receipt) childReceipts.push(receipt);
      phaseEvidence.push(
        ...normalizeEvidence(result, node, invocationChildRunId, phase.requirementIds),
      );
      if (result.status === "completed") {
        const reconciliation = await reconcileResult(
          result,
          node,
          invocationChildRunId,
          artifactResolver,
          schemaRegistry,
        );
        if (reconciliation.failures.length)
          phaseFailure = { status: "incomplete", failure: reconciliation.failures[0] };
        phaseEvidence.push(
          ...reconciliation.evidence.filter(
            (item) => !phaseEvidence.some((existing) => existing.evidenceId === item.evidenceId),
          ),
        );
      }
      phaseTechnical.push(
        ...(technicalGate
          ? await technicalGate({ phase, node, result })
          : defaultGate(result, "technical")),
      );
      phaseFunctional.push(
        ...(functionalGate
          ? await functionalGate({ phase, node, result })
          : defaultGate(result, "functional")),
      );
      if (result.status !== "completed") {
        phaseFailure = result;
        break;
      }
      completedNodeIds.add(node.nodeId);
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
    }
    allEvidence.push(...phaseEvidence);
    const ledger = {
      schema: "csm-orchestrate-requirement/1",
      ledgerId: `ledger-${slug(runId)}-${slug(phase.phaseId)}`,
      requirements: phase.requirementIds.map((requirementId) => ({
        requirementId,
        criticality: "critical",
        statement: phase.acceptanceSignals.join("; "),
        status: "open",
        evidenceRefs: phaseEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          status: item.status === "current" ? "available" : item.status,
          digest: item.digest,
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
            requirementIds: item.requirementIds,
            evidenceRefs: [item.evidenceId],
          })),
          evidence: phaseEvidence,
          technical: phaseTechnical,
          functional: phaseFunctional,
          completion: !phaseFailure && gate.status === "VERIFIED",
        });
    await assertSchema("csm-orchestrate-adversarial-review/1", review);
    phaseResults.push({ phase, gate, review });
    if (phaseFailure)
      return terminalReceipt(
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
        { gate, review },
      );
    if (gate.status !== "VERIFIED" || review.status !== "ACCEPTED")
      return terminalReceipt(
        runId,
        phase.phaseId,
        terminalApproval,
        gate.status === "BLOCKED" ? "BLOCKED" : gate.status === "FAILED" ? "FAILED" : "INCOMPLETE",
        childReceipts,
        phaseEvidence.map((item) => item.evidenceId),
        { gate, review },
      );
  }

  if (!finalReview)
    return terminalReceipt(
      runId,
      phaseResults.at(-1)?.phase.phaseId ?? "phase-intake",
      terminalApproval,
      "REQUIRES_REVIEW",
      childReceipts,
      allEvidence.map((item) => item.evidenceId),
      { reason: "independent-final-review-required", phases: phaseResults },
    );
  const final = finalReview
    ? await finalReview({
        phase: phaseResults.at(-1)?.phase,
        graph: activeGraph,
        phaseResults,
        evidence: allEvidence,
        childReceipts,
      })
    : null;
  await assertSchema("csm-orchestrate-adversarial-review/1", final);
  if (finalReview && final.status === "ACCEPTED") {
    const contextual = validateInjectedFinalReview({
      review: final,
      runId,
      phaseResults,
      evidence: allEvidence,
    });
    if (!contextual.valid)
      return terminalReceipt(
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
  await assertSchema("csm-orchestrate-final-review/1", coordinated);
  if (coordinated.status === "REMEDIATION_REQUIRED") {
    activeGraph = coordinated.graph;
    const remediationPhase = activeGraph.phases.at(-1);
    const remediationReceipt = await runOrchestrationInternal({
      approach: {
        schema: "csm-approach/1",
        schemaRevision: 1,
        status: "agreed",
        runId,
        ideaSlug: "remediation",
        phases: [
          {
            phaseId: "P1",
            title: remediationPhase.outcome?.title ?? "Remediate review finding",
            goal: remediationPhase.outcome?.goal ?? remediationPhase.acceptanceSignals.join("; "),
            deliverables: remediationPhase.outcome?.deliverables ?? ["review gap closed"],
            scope: remediationPhase.scope?.include ?? ["declared review gap"],
            outOfScope: remediationPhase.scope?.exclude ?? [],
            constraints: [],
            acceptanceHints: remediationPhase.acceptanceSignals,
            context: [],
            dependencies: [],
          },
        ],
      },
      runId,
      host,
      capabilities,
      signals: { ...signals, capabilities: [remediationPhase.route] },
      approvals,
      now,
      cursorStore,
      technicalGate,
      functionalGate,
      adversarialReview,
      finalReview,
      remediationFactory: null,
      maxAttempts,
      timeoutMs,
      inputArtifactRefs,
      artifactResolver,
      schemaRegistry,
      parentPhaseId: remediationPhase.parentPhaseId,
      phaseIdOverride: remediationPhase.phaseId,
    });
    return Object.freeze({
      ...remediationReceipt,
      remediationLineage: {
        sourceReviewId: remediationPhase.sourceReviewId,
        findings: remediationPhase.reviewFindings,
        requirementDelta: remediationPhase.requirementDelta,
        phaseId: remediationPhase.phaseId,
        parentPhaseId: remediationPhase.parentPhaseId,
        acceptanceContract: remediationPhase.acceptanceContract,
      },
    });
  }
  return terminalReceipt(
    runId,
    activeGraph.phases.at(-1).phaseId,
    terminalApproval,
    coordinated.status,
    childReceipts,
    allEvidence.map((item) => item.evidenceId),
    { finalReview: coordinated.finalReview, phases: phaseResults },
  );
}

export async function orchestrate(options) {
  const result = await runOrchestrationInternal(options);
  const durable = {
    schema: result.schema,
    receiptId: result.receiptId,
    runId: result.runId,
    phaseId: result.phaseId,
    childReceipts: result.childReceipts,
    approval: result.approval,
    statuses: result.statuses,
    outcome: result.outcome,
    idempotencyKey: result.idempotencyKey,
  };
  await assertSchema("csm-orchestrate-receipt/1", durable);
  if (options?.cursorStore?.saveTerminalReceipt)
    await persistTerminalReceipt(durable, options.cursorStore);
  return result;
}

export const runOrchestration = orchestrate;
