"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";
import { compileApproach } from "./phase-compiler.mjs";
import {
  createHostInvocationAdapter,
  validateDurableTerminalRecords,
  validateHandoffRef,
} from "./invocation.mjs";
import { aggregateGates, reconcileRequirementEvidence } from "./evidence-gates.mjs";
import {
  coordinateFinalReview,
  reviewAcceptance,
  validateInjectedFinalReview,
} from "./adversarial-final-review.mjs";
import { HOST_REVIEW } from "./review-token.mjs";
import {
  autonomyGate,
  classifyResume,
  selectParallelBatch,
  loadCursor,
  persistTerminalReceipt,
  retryDecision,
} from "./recovery.mjs";
import { assertSchema } from "./contracts.mjs";
import { createLifecycleHookRunner } from "./lifecycle-hooks.mjs";
import { createProgressTracker } from "./progress.mjs";
import {
  approvedHostIsolationOptOut,
  collectEffectiveIsolation,
  declaredIsolation,
  effectiveIsolationFloor,
  isKnownIsolation,
  preflightSkillRoutes,
  isolationRouting,
  TRUSTED_IN_PROCESS,
} from "./skill-executor-preflight.mjs";
import { resolveVerifiedSandboxRuntime } from "./verified-sandbox-runtime.mjs";

import {
  abortFailure,
  childReceipt,
  childRunIdForNode,
  defaultGate,
  dispatchIntentFailure,
  invocationApproval,
  jsonProjection,
  materialDigest,
  normalizeEvidence,
  progressByReceipt,
  raceDeadline,
  retryChildRunIdForNode,
  slug,
  stepCapFailure,
  terminalReceipt,
  unique,
} from "./run-helpers.mjs";
import {
  externalRefsFor,
  reconcileResult,
  spliceRemediationPhase,
  upstreamRefsFor,
  validateReviewArtifacts,
} from "./run-artifacts.mjs";
import { saveCursor } from "./run-cursor.mjs";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;

// RK7: on a true completed-run resume the transient host fixture resolver has no
// artifacts (its in-memory map was built by the prior process). The durable
// terminal child attempt already carries the child's normalized evidence and
// artifact descriptors, so reconcile resolves from that durable source instead.
// This is scoped strictly to the reconcile resume path; live dispatches still
// validate against the configured artifact resolver.
function durableEvidenceResolver(result) {
  const records = new Map();
  for (const item of result?.evidence ?? []) {
    const path = item?.source?.path ?? item?.path;
    if (path) records.set(path, item);
  }
  for (const ref of result?.outputArtifactRefs ?? []) if (ref?.path) records.set(ref.path, ref);
  return {
    async resolve(path, expected = {}) {
      const record = records.get(path);
      if (!record)
        return { status: "missing", code: "missing", message: `missing durable artifact: ${path}` };
      // T010: a live resolver echoes back the artifact schema at the top level
      // (a resumed durable evidence record may only carry it under `source`).
      // Add only that required field: the evidence schema forbids extra
      // properties, so the durable value must otherwise stay shape-identical.
      return {
        status: "resolved",
        path,
        owner: expected.expectedOwner ?? record.owner,
        fileDigest: expected.expectedFileDigest ?? record.digest,
        value: record.schema ? record : { ...record, schema: record.source?.schema },
      };
    },
  };
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
  maxParallelism = 4,
  dynamicProposal = null,
  dynamicApproved = false,
  dynamicRouteKind = "research",
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
  verifiedSandboxEnabled = true,
  verifiedSandboxRuntime = null,
  producerExecutorId = null,
  reviewArtifactRoot = null,
  skillProgressRollupDir = null,
  progressPollIntervalMs = 2000,
  onProgress = null,
  lifecycleHooks = null,
  enforceSkillFirstRouting = false,
  hostIsolationOptOut = null,
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
  const hooks = lifecycleHooks ? createLifecycleHookRunner(lifecycleHooks) : null;
  // T010: cancellation is emitted at most once per run, whichever abort site
  // observes it first, so operators always get a visible cancellation signal
  // without duplicate events from repeated abort checks.
  let cancellationEmitted = false;
  const emitCancellation = (reason, context = {}) => {
    if (cancellationEmitted) return;
    cancellationEmitted = true;
    emitTelemetry({
      eventType: "cancellation",
      phaseId: context.phaseId ?? null,
      edgeId: context.edgeId ?? null,
      childRunId: context.childRunId ?? null,
      payload: { reason },
    });
    hooks?.run("cancel", { runId, reason, phaseId: context.phaseId ?? null });
  };
  let progressTracker = null;
  const telemetryLosses = [];
  const workerLeases = new Map();
  const emitTerminalReceipt = (...args) => {
    const receipt = terminalReceipt(...args);
    if (progressTracker) {
      progressByReceipt.set(receipt, progressTracker);
      void progressTracker.associateReceipt(receipt.receiptId, receipt.phaseId).catch((error) => {
        telemetryLosses.push({
          schema: "csm-orchestrate-telemetry-loss/1",
          eventType: "telemetry_loss",
          runId: receipt.runId,
          phaseId: receipt.phaseId,
          edgeId: null,
          childRunId: null,
          attempt: 0,
          sequence: null,
          code: "receipt-association-failed",
          message: String(error?.message ?? error),
        });
      });
    }
    emitTelemetry({
      phaseId: receipt.phaseId,
      eventType: "terminal",
      payload: { receiptId: receipt.receiptId, status: receipt.outcome.status },
    });
    hooks?.run("worker-stop", {
      runId: receipt.runId,
      childRunId: receipt.childRunId ?? null,
      status: receipt.outcome.status,
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
    onUpdate: onProgress,
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
  // T002: skill-first routing enforcement fires before any graph work: when
  // enforced, orchestrate must dispatch to csm skills through an executor
  // adapter. The host invocation adapter is incidental/test-only.
  if (enforceSkillFirstRouting && !executorAdapter)
    return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
      reason: "executor-adapter-required",
      failure: {
        class: "policy",
        code: "executor-adapter-required",
        message:
          "skill-first routing is enforced: orchestrate must dispatch to csm skills via an executor adapter. Host invocation is available for incidental tasks and testing only (pass enforceSkillFirstRouting: false to allow).",
      },
    });
  // T010: reconcile stale per-worker leases left by a prior interrupted run.
  // Replayed workers are surfaced as visible observational events; a verified
  // terminal child result is still preferred over re-execution by the resume
  // classifier, so reconciliation never triggers duplicate side effects.
  if (typeof cursorStore.reconcileStaleWorkers === "function") {
    try {
      const stale = await cursorStore.reconcileStaleWorkers({ at: new Date(now()).toISOString() });
      for (const worker of stale ?? []) {
        emitTelemetry({
          eventType: "reconciliation",
          payload: {
            workerId: worker.workerId,
            reason: "stale-worker-lease",
            expiresAt: worker.expiresAt ?? null,
          },
        });
        emitTelemetry({
          eventType: "worker.replayed",
          workerId: worker.workerId,
          taskId: worker.taskId ?? null,
          attempt: worker.attempt ?? 0,
          payload: { reason: "stale-lease-reconciled" },
        });
      }
    } catch {
      // Observability is best-effort and must never fail a run.
    }
  }
  let graph = await compileApproach(approach, {
    capabilities,
    signals,
    parentPhaseId,
    phaseIdOverride,
  });
  // T003: opt-in hybrid dynamic mode. A model-proposed worker set is validated
  // and compiled into a canonical csm-orchestrate-phase/2 phase appended to the
  // graph BEFORE preflight, so its nodes run through the same executeNode /
  // cursor / gate path as every other phase. The plan/execute-plan route is
  // refused by assertDynamicModeAllowed.
  if (dynamicProposal) {
    try {
      const { compileDynamicPhase } = await import("./dynamic-scheduler.mjs");
      const dynamicPhase = compileDynamicPhase(dynamicProposal, {
        capabilities,
        runId,
        approved: dynamicApproved === true,
        routeKind: dynamicRouteKind,
        graphRevision: graph.graphRevision,
        ordinal: graph.phases.length,
      });
      graph = Object.freeze({ ...graph, phases: Object.freeze([...graph.phases, dynamicPhase]) });
      emitTelemetry({
        eventType: "reconciliation",
        payload: {
          dynamicProposal: true,
          phaseId: dynamicPhase.phaseId,
          nodes: dynamicPhase.routeNodes.length,
        },
      });
    } catch (error) {
      return emitTerminalReceipt(runId, "phase-intake", null, "BLOCKED", [], [], {
        reason: error?.code ?? "dynamic-proposal-rejected",
        failure: {
          class: "policy",
          code: error?.code ?? "dynamic-proposal-rejected",
          message: String(error?.message ?? error),
        },
      });
    }
  }
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
    onUpdate: onProgress,
  });
  // F-001: adopt the run-level progress fence token before reload so a resumed
  // run (fence row written by a prior dispatch) does not crash with
  // StaleFenceError. Peeking reads the current token without creating any
  // cursor/fence rows; stores without fences or peek support skip it.
  try {
    const token = await cursorStore.peekFencingToken?.(`progress:progress-${slug(runId)}`);
    if (Number.isInteger(token) && token >= 1) progressTracker.setFencingToken(token);
  } catch {
    /* peek is advisory */
  }
  try {
    await progressTracker.reload();
  } catch (error) {
    emitTelemetry({
      phaseId: "phase-intake",
      edgeId: null,
      eventType: "reconciliation",
      payload: {
        status: "progress-reload-skipped",
        reason: String(error?.message ?? error).slice(0, 200),
      },
    });
  }
  await progressTracker.materialize(graph.phases);
  const adapter =
    // F-002/T002: when skill-first routing is enforced, executorAdapter is
    // required — the orchestrator must dispatch to csm skills, not host scripts.
    // The host invocation adapter remains available for incidental tasks and
    // testing (enforceSkillFirstRouting: false).
    executorAdapter ??
    (enforceSkillFirstRouting
      ? null // will be caught by the BLOCKED check below
      : createHostInvocationAdapter({
          host,
          capabilities,
          artifactResolver,
          schemaRegistry,
          cursorStore,
          now,
        }));

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
  const dispatchBlocked = () => {
    if (signal?.aborted) {
      emitCancellation("aborted");
      return abortFailure();
    }
    return dispatchedSteps >= maxSteps ? stepCapFailure() : null;
  };
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
  const capabilityEntries = Array.isArray(capabilities)
    ? capabilities
    : (capabilities?.skills ?? []);
  const capabilityForSkill = (skill) =>
    capabilityEntries.find((capability) => capability.skill === skill) ?? null;
  const verifiedSandboxInvocable = typeof verifiedSandboxRuntime?.invoke === "function";
  // T004/T003: resolve the effective isolation for a node from the executor
  // adapter's per-invocation report (precedence adapter > declared > refuse).
  // T003: on the executor-adapter dispatch seam the absence of a report must
  // never silently inherit the static declaration. A custom adapter may omit
  // `effectiveIsolation`; the bound executor/handler is still consulted, and
  // when nothing can report, the trusted-in-process floor is assumed while any
  // higher declared requirement (verified-sandbox) fails closed as unknown.
  // T002: the host invocation adapter is the incidental/test seam. An
  // incidental/trusted route still runs, but a route whose declared requirement
  // exceeds the in-process floor is refused unless the caller binds an explicit
  // approved opt-out.
  const resolveNodeIsolation = async (request, node) => {
    if (verifiedSandboxEnabled !== true) return { action: "invoke", enabled: false };
    const capability = capabilityForSkill(node.skill);
    const declared = declaredIsolation(capability);
    const gateWith = (effective, runtimeInvocable = verifiedSandboxInvocable) =>
      isolationRouting({
        adapter: { effectiveIsolation: () => effective },
        request,
        capability,
        node,
        enabled: true,
        runtimeInvocable,
      });
    if (!executorAdapter) {
      if (declared === null || declared === TRUSTED_IN_PROCESS) return { action: "invoke" };
      if (
        approvedHostIsolationOptOut(hostIsolationOptOut, {
          runId,
          skill: node.skill,
          required: declared,
        })
      )
        return { action: "invoke", enabled: true, optedOut: true };
      return gateWith(effectiveIsolationFloor({ report: null, capability }), false);
    }
    const binding = node.executor ?? executorBindings[node.skill];
    // The adapter's own reporter is authoritative (unknown is refused).
    if (typeof adapter?.effectiveIsolation === "function") {
      const report = await collectEffectiveIsolation({
        reporters: [(req) => adapter.effectiveIsolation(req)],
        request,
      });
      return gateWith(report);
    }
    // An isolation-aware bound executor that cannot resolve a known mode before
    // dispatch (e.g. it derives its mode from the invocation input at invoke
    // time) defers to its own internal gate; a known report is enforced here.
    const bindingReporter =
      typeof binding?.effectiveIsolation === "function"
        ? (req) => binding.effectiveIsolation(req)
        : typeof binding?.handler?.effectiveIsolation === "function"
          ? (req) => binding.handler.effectiveIsolation(req)
          : null;
    if (bindingReporter) {
      const report = await collectEffectiveIsolation({ reporters: [bindingReporter], request });
      if (!report || !isKnownIsolation(report.isolation)) return { action: "invoke" };
      return gateWith(report);
    }
    // No reporter at all: an incidental node has nothing to enforce, a
    // trusted-in-process requirement is satisfied by the in-process floor, and
    // a higher declared requirement is unverifiable and fails closed.
    if (declared === null) return { action: "invoke" };
    return gateWith(effectiveIsolationFloor({ report: null, capability }));
  };
  const invokeAdapter = async (request, cursorId, dispatchIntentId, routing = null) => {
    dispatchedSteps += 1;
    const invocationOptions = cursorId ? { cursorId } : {};
    if (signal) invocationOptions.signal = signal;
    if (dispatchIntentId) invocationOptions.dispatchIntentId = dispatchIntentId;
    if (routing?.action === "sandbox") {
      try {
        return await verifiedSandboxRuntime.invoke(
          {
            request,
            effectiveIsolation: routing.gate,
            emitEgress: (event) =>
              emitTelemetry({
                phaseId: request.phaseId,
                edgeId: request.edgeId,
                childRunId: request.childRunId,
                eventType: "egress.decision",
                attempt: request.retry?.attempt ?? 0,
                taskId: event.taskId ?? null,
                workerId: event.workerId ?? null,
                invocationId: event.invocationId ?? request.invocationId,
                payload: event.payload ?? {
                  decision: event.decision ?? null,
                  targetHost: event.targetHost ?? null,
                  reasonCode: event.reasonCode ?? null,
                },
              }),
          },
          invocationOptions,
        );
      } catch (error) {
        return {
          status: "blocked",
          failure: {
            class: "policy",
            code: "isolation-unavailable",
            message: `${request.skill}: verified-sandbox runtime failed: ${String(
              error?.message ?? error,
            )}`,
          },
        };
      }
    }
    return adapter.invoke(request, invocationOptions);
  };
  // mid-invocation progress poller: child skill-progress records with a
  // mid-range percent roll onto the active item while the child runs, so the
  // rendered bar moves during real phase work. Terminal (100%) records stay
  // with the post-return rollup: the exact-1 clamp would reset the bar on a
  // non-verified item. Inert unless skillProgressRollupDir is configured.
  const startProgressPoll = (pollChildRunId, pollPhase, pollNode) => {
    if (!skillProgressRollupDir) return () => {};
    let pollGeneration = 0; // F-009: in-flight ticks must not write after stop
    const timer = setInterval(() => {
      const generation = ++pollGeneration;
      try {
        void (async () => {
          const { rollupChildProgress, findChildSkillProgress } =
            await import("./progress-rollup.mjs");
          if (generation !== pollGeneration) return; // superseded tick
          const childRecord = await findChildSkillProgress(skillProgressRollupDir, pollChildRunId);
          if (generation !== pollGeneration) return;
          if (!childRecord || childRecord.overallPercent >= 100) return;
          const rollupResult = await rollupChildProgress({
            progressTracker,
            phaseId: pollPhase.phaseId,
            nodeId: pollNode.nodeId,
            record: childRecord,
          });
          if (rollupResult.status === "rolled-up")
            emitTelemetry({
              phaseId: pollPhase.phaseId,
              edgeId: `edge-${slug(pollNode.nodeId)}`,
              childRunId: pollChildRunId,
              eventType: "skill-progress-rollup",
              payload: {
                fraction: rollupResult.fraction,
                evidenceRef: rollupResult.evidenceRef,
              },
            });
        })().catch(() => {});
      } catch {}
    }, progressPollIntervalMs);
    timer.unref?.();
    return () => {
      pollGeneration += 1;
      clearInterval(timer);
    };
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
          savedCursor?.childRunId ?? childRunIdForNode(runId, phase.phaseId, node.nodeId, index);
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
          // RK4: persist the node-suffixed idempotency key so a resumed run
          // reloads the same durable child attempt (reconcile) instead of
          // missing it (resume) and regressing terminal progress.
          idempotencyKey: request.retry.idempotencyKey,
        });
        let result =
          resume.action === "reconcile"
            ? terminalRecords.find((record) => record.status === "completed")?.result
            : null;
        let routeIsolation = { action: "invoke" };
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
          routeIsolation = await resolveNodeIsolation(request, node);
          if (routeIsolation.action === "blocked")
            return {
              node,
              approval,
              failure: { status: "blocked", failure: routeIsolation.failure.failure },
            };
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
          hooks?.run("worker-start", {
            runId,
            phaseId: phase.phaseId,
            childRunId,
            skill: request.skill,
            attempt: request.retry.attempt,
          });
          const taskId = `task-${slug(request.edgeId ?? childRunId)}`;
          const workerId = `worker-${slug(childRunId)}`;
          emitTelemetry({
            eventType: "task.created",
            phaseId: phase.phaseId,
            edgeId: request.edgeId,
            childRunId,
            taskId,
            workerId,
            invocationId: request.invocationId,
            payload: { skill: request.skill },
          });
          emitTelemetry({
            eventType: "worker.started",
            phaseId: phase.phaseId,
            edgeId: request.edgeId,
            childRunId,
            taskId,
            workerId,
            invocationId: request.invocationId,
            attempt: request.retry.attempt,
            payload: { skill: request.skill },
          });
          hooks?.run("task-create", { runId, taskId, workerId, skill: request.skill });
          hooks?.run("tool-exec", {
            runId,
            taskId,
            invocationId: request.invocationId,
            phase: "start",
          });
          hooks?.run("checkpoint", { runId, taskId, state: "dispatching" });
          // T004: per-worker lease — fail fast on a duplicate live claim and
          // track the lease so it is released regardless of outcome.
          if (typeof cursorStore.claimWorker === "function") {
            try {
              const lease = await cursorStore.claimWorker({
                workerId,
                runId,
                taskId,
                attempt: request.retry.attempt ?? 0,
                leaseMs: 60_000,
              });
              // Sustained heartbeat so a long dispatch never lets the lease
              // expire between claim and release.
              let timer = null;
              if (typeof cursorStore.heartbeatWorker === "function") {
                timer = setInterval(() => {
                  try {
                    const beat = cursorStore.heartbeatWorker({
                      workerId,
                      leaseToken: lease.leaseToken,
                      leaseMs: 60_000,
                    });
                    if (beat && typeof beat.then === "function") beat.catch(() => {});
                  } catch {
                    // heartbeat is best-effort
                  }
                }, 20_000);
                if (typeof timer.unref === "function") timer.unref();
              }
              workerLeases.set(node.nodeId, {
                workerId,
                leaseToken: lease.leaseToken,
                timer,
              });
            } catch (error) {
              return {
                node,
                approval,
                failure: {
                  status: "blocked",
                  failure: {
                    class: "policy",
                    code: "worker-lease-held",
                    message: String(error?.message ?? error),
                  },
                },
              };
            }
          }
          let dispatchIntent = null;
          try {
            dispatchIntent = await beginDispatchIntent(cursorId, phase.phaseId, childRunId);
          } catch (error) {
            return { node, approval, failure: dispatchIntentFailure(error) };
          }
          // mid-invocation rollup poller: child skill-progress partial records
          // land while the child runs; without this the bar cannot move during
          // real phase work (terminal records stay with the post-return rollup)
          const stopPoll = startProgressPoll(childRunId, phase, node);
          try {
            result = jsonProjection(
              capOutputSize(
                await invokeAdapter(request, cursorId, dispatchIntent?.intentId, routeIsolation),
              ),
            );
          } finally {
            stopPoll?.();
          }
          await resolveDispatchIntent(dispatchIntent, result.status);
        }
        let attempt = savedCursor?.attempt || 1;
        let invocationChildRunId = childRunId;
        while (result.status === "failed" || result.status === "incomplete") {
          if (result.failure?.class === "timeout") {
            emitTelemetry({
              phaseId: phase.phaseId,
              edgeId: request.edgeId,
              childRunId,
              eventType: "timeout",
              attempt,
              payload: { skill: request.skill, code: result.failure?.code ?? null },
            });
          }
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
          const retryChild = retryChildRunIdForNode(
            runId,
            phase.phaseId,
            node.nodeId,
            index,
            attempt,
          );
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
          if (retryBackoffMs > 0 && !signal?.aborted) {
            // F-027: attempt is already the NEXT attempt number, so the first
            // retry waits 1x retryBackoffMs (the old code slept 2x). The await
            // is part of run control flow, so the timer must hold the loop.
            const delay = retryBackoffMs * Math.pow(2, attempt - 2);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          let retryIntent = null;
          try {
            retryIntent = await beginDispatchIntent(cursorId, phase.phaseId, retryChild);
          } catch (error) {
            return { node, approval, failure: dispatchIntentFailure(error) };
          }
          const stopRetryPoll = startProgressPoll(retryChild, phase, node);
          try {
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
                  routeIsolation,
                ),
              ),
            );
          } finally {
            stopRetryPoll?.();
          }
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
                // RK7: a true resume reconciles the durable terminal child's own
                // stored evidence; a live dispatch still resolves host artifacts.
                resume?.action === "reconcile"
                  ? durableEvidenceResolver(result)
                  : childArtifactResolver,
                schemaRegistry,
              )
            : { evidence: [], failures: [] };
        if (reconciliation.failures.length)
          failure = { status: "incomplete", failure: reconciliation.failures[0] };
        // A reconciled node was already recorded terminal/verified by the prior
        // run. Re-deriving its evidence must never regress that terminal
        // progress (which would crash): return the failure cleanly instead.
        if (failure && resume?.action === "reconcile") return { node, approval, failure };
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
            // RK4: keep the node-suffixed key on the terminal cursor write too,
            // otherwise it overwrites the dispatching cursor's key and a resume
            // cannot reload the durable terminal attempt.
            idempotencyKey: request.retry.idempotencyKey,
          });
        if (!failure && result.status === "completed") {
          // A true completed-run resume reloads the node's progress item as
          // terminal; re-marking it active would regress terminal progress (and
          // throw). Keep the terminal state and its already-persisted evidence.
          const currentItem = progressTracker.snapshot.items.find(
            (item) => item.itemId === progressId,
          );
          const terminal = ["verified", "failed", "blocked", "incomplete"].includes(
            currentItem?.state,
          );
          if (!terminal)
            await progressTracker.update(progressId, {
              state: "active",
              childRunId: invocationChildRunId,
              attempt,
              evidenceRefs: [...evidence, ...reconciledEvidence]
                .map((item) => item.evidenceId)
                .filter(Boolean),
            });
        }
        // roll up child skill-progress AFTER the per-node update: that update
        // replaces evidenceRefs and resets verifiedFraction, so a rollup run
        // earlier would be silently discarded
        if (skillProgressRollupDir) {
          try {
            const { rollupChildProgress, findChildSkillProgress } =
              await import("./progress-rollup.mjs");
            const childRecord = await findChildSkillProgress(
              skillProgressRollupDir,
              invocationChildRunId,
            );
            if (childRecord) {
              const rollupResult = await rollupChildProgress({
                progressTracker,
                phaseId: phase.phaseId,
                nodeId: node.nodeId,
                record: childRecord,
              });
              if (rollupResult.status === "rolled-up")
                emitTelemetry({
                  phaseId: phase.phaseId,
                  edgeId: `edge-${slug(node.nodeId)}`,
                  childRunId: invocationChildRunId,
                  eventType: "skill-progress-rollup",
                  payload: {
                    fraction: rollupResult.fraction,
                    evidenceRef: rollupResult.evidenceRef,
                  },
                });
            }
          } catch {}
        }
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
        const batch = selectParallelBatch(ready, { maxParallelism, capabilities });
        let batchResults;
        try {
          batchResults = await Promise.all(batch.map(executeNode));
        } catch (error) {
          // A rejected node aborts the results loop; release every lease the
          // failed batch claimed so none is leaked until TTL/reconcile.
          for (const held of workerLeases.values()) {
            if (held.timer) clearInterval(held.timer);
            if (typeof cursorStore.releaseWorker === "function") {
              try {
                await cursorStore.releaseWorker({
                  workerId: held.workerId,
                  leaseToken: held.leaseToken,
                  state: "failed",
                });
              } catch {
                // best effort
              }
            }
          }
          workerLeases.clear();
          throw error;
        }
        const results = batchResults.toSorted((a, b) => a.node.ordering - b.node.ordering);
        if (!phaseFailure && signal?.aborted) {
          emitCancellation("aborted", { phaseId: phase.phaseId });
          phaseFailure = abortFailure();
        }
        for (const item of results) {
          pending.delete(item.node.nodeId);
          terminalApproval = item.approval;
          if (item.receipt && !item.failure) childReceipts.push(item.receipt);
          phaseEvidence.push(...(item.evidence ?? []));
          phaseTechnical.push(...(item.technical ?? []));
          phaseFunctional.push(...(item.functional ?? []));
          const itemTaskId = `task-${slug(item.node.nodeId)}`;
          const itemChildRunId = item.receipt?.runId ?? null;
          const itemWorkerId = `worker-${slug(itemChildRunId ?? item.node.nodeId)}`;
          const itemCompleted = !item.failure && item.result?.status === "completed";
          emitTelemetry({
            eventType: itemCompleted ? "worker.completed" : "worker.failed",
            phaseId: phase.phaseId,
            childRunId: itemChildRunId,
            taskId: itemTaskId,
            workerId: itemWorkerId,
            payload: { skill: item.node.skill, status: item.result?.status ?? "failed" },
          });
          if (itemCompleted) {
            emitTelemetry({
              eventType: "task.completed",
              phaseId: phase.phaseId,
              childRunId: itemChildRunId,
              taskId: itemTaskId,
              workerId: itemWorkerId,
              payload: { skill: item.node.skill },
            });
          }
          hooks?.run("task-complete", {
            runId,
            taskId: itemTaskId,
            workerId: itemWorkerId,
            skill: item.node.skill,
            status: itemCompleted ? "completed" : "failed",
          });
          hooks?.run("tool-exec", { runId, taskId: itemTaskId, phase: "complete" });
          const heldLease = workerLeases.get(item.node.nodeId);
          if (heldLease) {
            if (heldLease.timer) clearInterval(heldLease.timer);
            if (typeof cursorStore.releaseWorker === "function") {
              try {
                await cursorStore.releaseWorker({
                  workerId: heldLease.workerId,
                  leaseToken: heldLease.leaseToken,
                  state: itemCompleted ? "completed" : "failed",
                });
              } catch {
                // A release failure must not fail the run; stale leases reconcile.
              }
            }
            workerLeases.delete(item.node.nodeId);
          }
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
      await assertSchema("csm-orchestrate-final-review/2", coordinated);
      if (coordinated.status === "REMEDIATION_REQUIRED") {
        const splice = await spliceRemediationPhase({
          coordinated,
          capabilities,
          signals,
          runId,
          progressTracker,
          remediationLineage,
        });
        activeGraph = splice.graph;
        phaseIndex = splice.insertAt;
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
      const splice = await spliceRemediationPhase({
        coordinated,
        capabilities,
        signals,
        runId,
        progressTracker,
        remediationLineage,
      });
      activeGraph = splice.graph;
      phaseIndex = splice.insertAt;
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
  if (
    options &&
    typeof options.approach?.runId === "string" &&
    typeof options.runId === "string" &&
    options.runId !== options.approach.runId
  )
    throw new TypeError(
      "runId must equal approach.runId: approvals and cursors bind to the approach run identity",
    );
  let result;
  try {
    // T003: accept a declarative verified-sandbox runtime config and build the
    // provider/enforcer/listener plumbing once, so callers no longer hand-pass
    // sandboxExecutor/egressPolicy/egressLedger/egressForward per request. A
    // disabled/absent config normalizes to null and preserves fail-closed.
    result = await runOrchestrationInternal(
      options
        ? {
            ...options,
            verifiedSandboxRuntime: resolveVerifiedSandboxRuntime(options.verifiedSandboxRuntime),
          }
        : options,
    );
  } catch (error) {
    if (process.env.CSM_DEBUG2) console.error("CSM_DEBUG2 crash:", error.stack);
    // F-002: a crash must still persist an authoritative terminal record
    const runId = typeof options?.runId === "string" ? options.runId : "run-crashed";
    const receipt = Object.freeze({
      schema: "csm-orchestrate-receipt/2",
      receiptId: `receipt-${runId}-crash`,
      runId,
      phaseId: "phase-intake",
      childReceipts: [],
      approval: {
        approvalId: "approval-not-supplied",
        scope: ["none"],
        approvedDigest: "sha256:" + "0".repeat(64),
        approvedAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        status: "expired",
      },
      statuses: {
        route: "blocked",
        child: "not-started",
        artifact: "none",
        verification: "rejected",
        parent: "blocked",
      },
      outcome: { status: "BLOCKED", accepted: false, acceptanceRefs: [] },
      idempotencyKey: "sha256:" + "0".repeat(64),
    });
    try {
      await options?.cursorStore?.saveTerminalReceipt?.(receipt);
    } catch {}
    // T005: the crash path can follow an interrupted run that left pending
    // reconciliation/terminal writes in the async transport queue. Drain them
    // before appending the authoritative terminal event so the terminal marker
    // is ordered after (never replaces) reconciliation history.
    try {
      if (typeof options?.telemetryEmitter?.flush === "function")
        await options.telemetryEmitter.flush();
    } catch {}
    try {
      if (typeof options?.telemetryEmitter?.emit === "function")
        options.telemetryEmitter.emit({
          runId,
          attempt: 0,
          eventType: "terminal",
          phaseId: "phase-intake",
          edgeId: null,
          childRunId: null,
          payload: {
            receiptId: receipt.receiptId,
            status: "BLOCKED",
            crash: String(error?.message ?? error).slice(0, 200),
          },
        });
    } catch {}
    // T005: await the flush before this crash handler finalizes and returns, so
    // the terminal (and any prior reconciliation) event is persisted even when
    // the caller exits or the process dies immediately after.
    try {
      if (typeof options?.telemetryEmitter?.flush === "function")
        await options.telemetryEmitter.flush();
    } catch {}
    return {
      ...receipt,
      progress: null,
      receipt,
      reason: "unhandled-exception",
    };
  }
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
  if (options?.cursorStore?.saveTerminalReceipt) {
    // RK8: the run-level receipt id is deterministic. A resumed run finalizing
    // the same runId must not collide with its own prior terminal record, so
    // skip the write when that exact receipt is already durable.
    let alreadyPersisted = false;
    if (typeof options.cursorStore.loadTerminalRecords === "function") {
      try {
        const records = await options.cursorStore.loadTerminalRecords(durable.runId);
        alreadyPersisted = (records ?? []).some(
          (record) => (record.receiptId ?? record.receipt_id) === durable.receiptId,
        );
      } catch {
        alreadyPersisted = false;
      }
    }
    if (!alreadyPersisted) await persistTerminalReceipt(durable, options.cursorStore);
  }
  if (typeof options?.telemetryEmitter?.flush === "function")
    await options.telemetryEmitter.flush().catch(() => {});
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
export { makeAutonomousFunctionalGate } from "./run-helpers.mjs";
export {
  createVerifiedSandboxRuntime,
  resolveVerifiedSandboxRuntime,
} from "./verified-sandbox-runtime.mjs";
