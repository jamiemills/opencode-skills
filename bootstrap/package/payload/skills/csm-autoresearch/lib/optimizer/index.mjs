"use strict";

import {
  artifactPaths,
  AppendOnlyLedger,
  atomicJson,
  evidenceHash,
  hash,
  redact,
  validateReport,
} from "../ledger/index.mjs";
import { readDurableBytes, readDurableJson } from "../../../../lib/durable-json/index.mjs";
import {
  createArtifactDescriptor,
  createArtifactEnvelope,
  digestBytes,
  validateProducerArtifacts,
} from "../artifacts/index.mjs";

const finiteMetrics = (metrics) =>
  metrics &&
  Object.values(metrics).every((value) => typeof value === "number" && Number.isFinite(value));
const TERMINAL_BLOCKED = new Set(["sandbox_unavailable", "blocked", "policy_violation"]);
const HASH = /^sha256:[a-f0-9]{64}$/;

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy))
    throw new TypeError("policy must be an object");
  if (policy.format !== "csm-autoresearch-policy/1") throw new TypeError("invalid policy format");
  if (!["target", "hill-climb"].includes(policy.mode)) throw new TypeError("invalid policy mode");
  if (!Array.isArray(policy.hardGates) || policy.hardGates.length === 0)
    throw new TypeError("policy hardGates are required");
  if (!policy.population || typeof policy.population.enabled !== "boolean")
    throw new TypeError("policy population is required");
  if (
    !policy.execution ||
    policy.execution.network !== "disabled" ||
    policy.execution.credentials !== "none" ||
    policy.execution.evaluatorAssets !== "isolated"
  )
    throw new TypeError(
      "policy execution must be networkless, credentialless, and evaluator-isolated",
    );
  if (
    !["trusted-in-process", "snapshot-process", "verified-sandbox"].includes(
      policy.execution.isolation,
    )
  )
    throw new TypeError("unsupported policy isolation");
  if (policy.mode === "target" && (!policy.target || typeof policy.target.value !== "number"))
    throw new TypeError("target policy requires a numeric target");
  return policy;
}

function validateContract(contract) {
  if (
    !contract ||
    typeof contract !== "object" ||
    !contract.runId ||
    !contract.source ||
    !contract.metric ||
    !contract.budget
  )
    throw new TypeError("invalid run contract");
  if (!HASH.test(contract.source.sourceHash ?? ""))
    throw new TypeError("invalid contract source hash");
  if (
    !Number.isInteger(contract.budget.maxTrials) ||
    !Number.isInteger(contract.budget.maxProposals)
  )
    throw new TypeError("invalid contract budget");
  validatePolicy(contract.policy);
  if (
    typeof contract.runId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(contract.runId)
  )
    throw new TypeError("runId must be a canonical path-safe identifier");
  return contract;
}
function better(value, incumbent, direction, margin = 0) {
  return direction === "minimize" ? value < incumbent - margin : value > incumbent + margin;
}
function targetPassed(value, target) {
  return {
    "<": value < target.value,
    "<=": value <= target.value,
    ">": value > target.value,
    ">=": value >= target.value,
    "=": Math.abs(value - target.value) <= (target.tolerance ?? 0),
  }[target.operator];
}

function evaluateHardGates(result, gates = [], context = {}) {
  const failed = [];
  for (const gate of gates) {
    let passed = false;
    if (gate.kind === "valid")
      passed = result.status === "ok" && result.valid === true && finiteMetrics(result.metrics);
    else if (gate.kind === "hidden-validation")
      passed =
        context.heldOut?.status === "ok" &&
        context.heldOut.valid === true &&
        finiteMetrics(context.heldOut.metrics);
    else if (typeof context.gates?.[gate.id] === "boolean") passed = context.gates[gate.id];
    else passed = result.gates?.[gate.id] === true;
    if (!passed) failed.push(gate.id);
  }
  return { passed: failed.length === 0, failed };
}

async function establishBaseline({
  evaluate,
  baseline = { id: "baseline", parentId: null },
  ledger,
}) {
  const result = await evaluate(baseline, { partition: "training", baseline: true });
  if (TERMINAL_BLOCKED.has(result?.status)) return { ...baseline, result };
  if (result?.status !== "ok" || !finiteMetrics(result.metrics))
    throw new Error("baseline failed deterministic evaluation");
  await ledger?.append("baseline", {
    candidateId: baseline.id,
    parentId: null,
    decision: "keep",
    payload: { metrics: result.metrics, status: result.status },
  });
  return { ...baseline, result };
}

async function optimize(options) {
  const {
    contract,
    policy: executionPolicy,
    evaluate,
    candidates = [],
    ledgerRoot = ".agents/autoresearch",
    now = new Date(),
    retryLimit = 0,
  } = options;
  validateContract(contract);
  const contractPolicy = validatePolicy(contract.policy);
  if (executionPolicy !== undefined) validatePolicy(executionPolicy);
  const suppliedPolicyHash = options.policyHash;
  const contractPolicyHash = hash(contractPolicy);
  if (suppliedPolicyHash !== undefined && suppliedPolicyHash !== contractPolicyHash)
    throw new Error("execution policy hash mismatch");
  if (executionPolicy !== undefined && hash(executionPolicy) !== contractPolicyHash)
    throw new Error("execution policy mismatch");
  const policy = contractPolicy;
  if (typeof evaluate !== "function") throw new TypeError("evaluate is required");
  const paths = artifactPaths(ledgerRoot, contract.runId, now.toISOString().slice(0, 10));
  const provenance = {
    contractHash: options.contractHash ?? hash(contract),
    evaluatorHash: options.evaluatorHash ?? hash("deterministic-evaluator"),
    environmentHash: options.environmentHash ?? hash("deterministic-environment"),
    policyHash: contractPolicyHash,
  };
  for (const [name, value] of Object.entries(provenance)) evidenceHash(value, name);
  const ledger = new AppendOnlyLedger(paths.ledger, { runId: contract.runId, provenance });
  const lease = await ledger.acquireRunLease();
  try {
    const previous = await ledger.open();
    const terminalStatuses = new Set([
      "stopped",
      "completed",
      "blocked",
      "approval_pending",
      "promoted",
      "rolled_back",
    ]);
    let existingReport;
    try {
      existingReport = await readDurableJson(paths.report);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existingReport?.runId !== undefined && existingReport.runId !== contract.runId)
      throw new Error("refusing report collision with another run");
    if (terminalStatuses.has(existingReport?.status)) {
      const persisted = await validateProducerArtifacts({
        ledgerPath: paths.ledger,
        reportPath: paths.report,
        manifestPath: paths.manifest,
        runId: contract.runId,
      });
      return {
        report: persisted.report,
        manifest: persisted.manifest,
        paths,
        incumbent: null,
        reportPersisted: false,
      };
    }
    await ledger.append("intake", { payload: { mode: policy.mode, resumed: previous.length > 0 } });
    const metric = contract.metric;
    const baselineRecord = previous.find((record) => record.event === "baseline");
    const previousBlocked = previous.toReversed().find((record) => record.event === "blocked");
    const persist = async (report, incumbent) => {
      if (report.status !== "blocked") validateReport(report, contract.runId);
      const manifest = {
        format: "csm-autoresearch-manifest/1",
        runId: contract.runId,
        nativeRunId: contract.runId,
        runHash: hash(report),
        ledger: paths.ledger.replace(/^\//, ""),
        report: paths.report.replace(/^\//, ""),
        redacted: true,
      };
      const createdAt = now.toISOString();
      const ledgerBytes = await readDurableBytes(paths.ledger);
      const ledgerDescriptor = createArtifactDescriptor({
        runId: contract.runId,
        kind: "autoresearch-ledger",
        digest: digestBytes(ledgerBytes),
        location: paths.ledger.replace(/^\//, ""),
        contentType: "application/jsonl",
        lifecycleStatus: report.status === "blocked" ? "blocked" : "completed",
        createdAt,
      });
      const reportDescriptor = createArtifactDescriptor({
        runId: contract.runId,
        kind: "autoresearch-report",
        digest: digestBytes(Buffer.from(`${JSON.stringify(report, null, 2)}\n`)),
        location: paths.report.replace(/^\//, ""),
        contentType: "application/json",
        lifecycleStatus: report.status === "blocked" ? "blocked" : "completed",
        createdAt,
        sourceArtifactIds: [ledgerDescriptor.artifact.artifactId],
      });
      manifest.artifactDescriptors = [ledgerDescriptor, reportDescriptor];
      manifest.envelope = createArtifactEnvelope(reportDescriptor, {
        nativeRunId: contract.runId,
        startedAt: createdAt,
        endedAt: createdAt,
        sourceDigests: Object.values(provenance),
      });
      let reportPersisted = true;
      try {
        const existing = await readDurableJson(paths.report);
        if (existing.runId !== contract.runId)
          throw new Error("refusing report collision with another run");
        if (
          [
            "stopped",
            "completed",
            "blocked",
            "approval_pending",
            "promoted",
            "rolled_back",
          ].includes(existing.status)
        )
          reportPersisted = false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (reportPersisted) {
        await atomicJson(paths.report, report);
        await atomicJson(paths.manifest, manifest);
        await validateProducerArtifacts({
          ledgerPath: paths.ledger,
          reportPath: paths.report,
          manifestPath: paths.manifest,
          runId: contract.runId,
        });
      }
      return { report, manifest, paths, incumbent, reportPersisted };
    };
    const blockedReport = async (result, trials = [], baselineMetrics = {}) => {
      const status = result?.status ?? "blocked";
      const diagnostics = result?.diagnostics ?? ["terminal blocked evaluation"];
      await ledger.append("blocked", {
        decision: "blocked",
        payload: { status, diagnostics, terminal: true },
      });
      return persist(
        redact({
          format: "csm-autoresearch-report/1",
          runId: contract.runId,
          status: "blocked",
          mode: policy.mode,
          sourceMode: contract.source.mode,
          baseline: { metrics: baselineMetrics, status: "ok" },
          trials: [...trials, { candidateId: "blocked", status, decision: "blocked", diagnostics }],
          gates: { hardPassed: false, failed: diagnostics },
          artifactRefs: [paths.ledger, paths.manifest].map((path) => path.replace(/^\//, "")),
        }),
        null,
      );
    };
    if (previousBlocked)
      return blockedReport(previousBlocked.payload, [], baselineRecord?.payload?.metrics ?? {});
    const baseline = baselineRecord
      ? {
          ...(options.baseline ?? { id: baselineRecord.candidateId }),
          result: {
            status: baselineRecord.payload.status,
            valid: true,
            metrics: baselineRecord.payload.metrics,
          },
        }
      : await establishBaseline({ evaluate, ledger, baseline: options.baseline });
    if (TERMINAL_BLOCKED.has(baseline.result?.status))
      return blockedReport(baseline.result, [], baseline.result.metrics ?? {});
    const candidateById = new Map([
      [(options.baseline ?? baseline).id, options.baseline ?? baseline],
      ...candidates.map((candidate) => [candidate.id, candidate]),
    ]);
    const decisions = previous.filter((record) =>
      ["decision", "quarantine"].includes(record.event),
    );
    const trials = decisions.map((record) => ({
      candidateId: record.candidateId,
      status: record.payload?.status ?? "quarantine",
      decision: record.decision,
      metrics: record.payload?.metrics,
      diagnostics:
        record.payload?.gates?.failed ??
        (record.event === "quarantine" ? ["anomaly_or_invalid_metrics"] : []),
    }));
    const lastKeep = decisions
      .toReversed()
      .find((record) => record.event === "decision" && record.decision === "keep");
    let incumbent = lastKeep
      ? {
          ...(candidateById.get(lastKeep.candidateId) ?? {
            id: lastKeep.candidateId,
            parentId: lastKeep.parentId,
          }),
          result: {
            status: lastKeep.payload.status,
            valid: true,
            metrics: lastKeep.payload.metrics,
          },
        }
      : baseline;
    const maxTrials = contract.budget.maxTrials;
    const margin = options.margin ?? policy.margin ?? 0;
    const seen = new Set(
      previous
        .filter((record) =>
          ["proposal", "evaluation", "decision", "quarantine"].includes(record.event),
        )
        .map((record) => record.candidateId),
    );
    const priorStop = previous.toReversed().find((record) => record.event === "stopped");
    let status = priorStop?.payload?.status ?? "stopped";
    let stopReason = priorStop?.payload?.reason ?? "trial_budget";
    let proposals = previous.filter((record) => record.event === "proposal").length;
    const pendingCandidates = priorStop?.payload?.status === "completed" ? [] : candidates;
    for (const candidate of pendingCandidates) {
      if (seen.has(candidate.id)) {
        await ledger.append("screen", {
          candidateId: candidate.id,
          parentId: candidate.parentId ?? null,
          decision: "reject",
          payload: { excluded: "already_recorded", resumed: true },
        });
        continue;
      }
      if (proposals >= contract.budget.maxProposals) {
        await ledger.append("screen", {
          candidateId: candidate.id,
          parentId: candidate.parentId ?? null,
          decision: "reject",
          payload: { excluded: "proposal_budget" },
        });
        continue;
      }
      if (trials.length >= maxTrials) {
        await ledger.append("screen", {
          candidateId: candidate.id,
          parentId: candidate.parentId ?? null,
          decision: "reject",
          payload: { excluded: "trial_budget" },
        });
        continue;
      }
      proposals++;
      const parentId = candidate.parentId ?? incumbent.id;
      await ledger.append("proposal", {
        candidateId: candidate.id,
        parentId,
        payload: { trial: trials.length + 1 },
      });
      let result;
      let attempts = 0;
      while (attempts <= retryLimit) {
        attempts++;
        await ledger.append("evaluation", {
          candidateId: candidate.id,
          parentId,
          payload: { attempt: attempts, partition: "training" },
        });
        try {
          result = await evaluate(candidate, {
            partition: "training",
            attempt: attempts,
            parentId,
          });
        } catch (error) {
          result = { status: "failed", valid: false, diagnostics: [String(error.message)] };
        }
        if (result?.status === "ok" || attempts > retryLimit) break;
      }
      if (TERMINAL_BLOCKED.has(result?.status))
        return blockedReport(result, trials, baseline.result.metrics ?? {});
      const anomalous =
        !result ||
        !finiteMetrics(result.metrics) ||
        ["timed_out", "resource_exhausted", "protocol_error"].includes(result.status);
      if (anomalous) {
        await ledger.append("quarantine", {
          candidateId: candidate.id,
          parentId,
          decision: "quarantine",
          payload: { status: result?.status ?? "anomaly", attempts },
        });
        trials.push({
          candidateId: candidate.id,
          status: result?.status ?? "anomaly",
          decision: "quarantine",
          diagnostics: ["anomaly_or_invalid_metrics"],
        });
        continue;
      }
      const visibleGates = (policy.hardGates ?? []).filter(
        (gate) => gate.kind !== "hidden-validation",
      );
      const gates = evaluateHardGates(result, visibleGates, { gates: result.gates });
      let heldOut;
      const needsHeldOut = (policy.hardGates ?? []).some(
        (gate) => gate.kind === "hidden-validation",
      );
      if (gates.passed && (needsHeldOut || options.validate)) {
        if (typeof options.validate !== "function")
          throw new Error("hidden validation is required");
        heldOut = await options.validate(candidate, { partition: "held-out", parentId });
        if (TERMINAL_BLOCKED.has(heldOut?.status))
          return blockedReport(heldOut, trials, baseline.result.metrics ?? {});
        await ledger.append("validation", {
          candidateId: candidate.id,
          parentId,
          payload: { partition: "held-out", status: heldOut.status, metrics: heldOut.metrics },
        });
      }
      const hiddenGates = evaluateHardGates(
        result,
        (policy.hardGates ?? []).filter((gate) => gate.kind === "hidden-validation"),
        { heldOut },
      );
      const allGates =
        gates.passed &&
        hiddenGates.passed &&
        (!heldOut ||
          (heldOut.status === "ok" && heldOut.valid === true && finiteMetrics(heldOut.metrics)));
      const value = result.metrics[metric.name];
      const wins =
        allGates &&
        (policy.mode === "target"
          ? targetPassed(value, policy.target)
          : better(value, incumbent.result.metrics[metric.name], metric.direction, margin));
      const decision = wins ? "keep" : "reject";
      if (wins) incumbent = { ...candidate, result: heldOut ?? result };
      const failedGates = [...gates.failed, ...hiddenGates.failed];
      await ledger.append("decision", {
        candidateId: candidate.id,
        parentId,
        decision,
        payload: {
          status: result.status,
          metrics: result.metrics,
          heldOut: heldOut
            ? { status: heldOut.status, valid: heldOut.valid, metrics: heldOut.metrics }
            : undefined,
          gates: { passed: allGates, failed: failedGates },
          attempts,
          runHash: hash({ candidate, result }),
          trialHash: hash({ candidate, result, parentId }),
          parentHash: hash(parentId),
        },
      });
      trials.push({
        candidateId: candidate.id,
        status: result.status,
        decision,
        metrics: result.metrics,
        diagnostics: failedGates,
      });
      if (policy.mode === "target" && wins) {
        status = "completed";
        stopReason = "target_reached";
        break;
      }
    }
    await ledger.append("stopped", {
      decision: "pending",
      payload: { reason: stopReason, status, trials: trials.length },
    });
    const report = redact({
      format: "csm-autoresearch-report/1",
      runId: contract.runId,
      status,
      mode: policy.mode,
      sourceMode: contract.source.mode,
      baseline: { metrics: baseline.result.metrics, status: "ok" },
      trials,
      gates: {
        hardPassed: trials.every((trial) => trial.decision !== "quarantine"),
        failed: trials.flatMap((trial) => trial.diagnostics ?? []),
      },
      artifactRefs: [paths.ledger, paths.manifest].map((path) => path.replace(/^\//, "")),
    });
    validateReport(report, contract.runId);
    return persist(report, incumbent);
  } finally {
    await ledger.releaseRunLease(lease);
  }
}

export {
  establishBaseline,
  evaluateHardGates,
  better,
  targetPassed,
  optimize,
  validateContract,
  validatePolicy,
};
