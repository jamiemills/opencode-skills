"use strict";

import { validateProgressDocument } from "../lib/progress.mjs";

const SAFE_REFERENCE = /^(?:sha256:[a-f0-9]{64}|(?:ev|art|receipt)-[a-z0-9][a-z0-9-]*)$/;

const stateLabel = (state) => {
  if (state === "verified") return "complete";
  if (state === "pending") return "pending";
  return state;
};

function bar(value, width) {
  if (value === null) return `[${"?".repeat(width)}]`;
  const filled = Math.round(value * width);
  return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
}

function safeMilestone(item, profile, detail, totalWeight) {
  const restricted =
    profile === "csm-browse" ||
    profile === "csm-upload" ||
    item.skill === "csm-browse" ||
    item.skill === "csm-upload";
  const name = restricted ? `${item.skill}/${item.phaseId}` : `${item.skill}/${item.nodeId}`;
  const milestone = {
    name,
    state: stateLabel(item.state),
    weight: item.weight,
    weightPercent: Math.round((item.weight / totalWeight) * 100),
    verifiedFraction: item.verifiedFraction,
    attempt: item.attempt,
  };
  if (detail !== "reduced" && !restricted)
    milestone.evidenceRefs = item.evidenceRefs.filter((reference) =>
      SAFE_REFERENCE.test(reference),
    );
  if (item.state === "blocked" || item.state === "failed" || item.state === "incomplete") {
    milestone.blocked = true;
    if (!restricted && item.blocker?.code) milestone.blockerCode = item.blocker.code;
  }
  return milestone;
}

function invocationMetrics(items) {
  const bySkill = new Map();
  for (const item of items) {
    const current = bySkill.get(item.skill) ?? { total: 0, observed: 0, states: {} };
    current.total += 1;
    if (item.state !== "pending") current.observed += 1;
    current.states[item.state] = (current.states[item.state] ?? 0) + 1;
    bySkill.set(item.skill, current);
  }
  return {
    total: items.length,
    observed: items.filter((item) => item.state !== "pending").length,
    bySkill: Object.fromEntries(bySkill),
  };
}

/** Render disposable operator text and metrics from a validated canonical snapshot. */
export function projectProgress(
  document,
  { quiet = false, profile = null, detail = "full", width = 28 } = {},
) {
  if (typeof document !== "object" || document === null || Array.isArray(document))
    throw new TypeError("progress projection requires canonical JSON");
  validateProgressDocument(document);
  if (!Number.isInteger(width) || width < 10 || width > 120)
    throw new TypeError("projection width is out of range");
  if (detail !== "full" && detail !== "reduced") throw new TypeError("invalid projection detail");
  if (profile !== null && typeof profile !== "string")
    throw new TypeError("invalid projection profile");

  const aggregate = document.aggregate;
  const indeterminate = aggregate.outcome === "indeterminate";
  const percentage = indeterminate ? null : Math.round(aggregate.plannedProgress * 100);
  const totalWeight = document.items.reduce((sum, item) => sum + item.weight, 0);
  const milestones = document.items.map((item) =>
    safeMilestone(item, profile, detail, totalWeight),
  );
  const attempts = {
    total: document.items.reduce((sum, item) => sum + item.attempt, 0),
    retried: document.items.filter((item) => item.attempt > 1).length,
  };
  const projection = {
    schema: "csm-progress-projection/1",
    source: {
      schema: document.schema,
      progressId: document.progressId,
      revision: document.revision,
    },
    quiet,
    profile,
    detail,
    overall: {
      value: aggregate.plannedProgress,
      percentage,
      outcome: aggregate.outcome,
      bar: bar(aggregate.plannedProgress, width),
    },
    milestones,
    metrics: {
      aggregate: {
        plannedProgress: aggregate.plannedProgress,
        outcome: aggregate.outcome,
        counts: { ...aggregate.counts },
      },
      skillInvocations: invocationMetrics(document.items),
      attempts,
      telemetry: { eventsObserved: aggregate.eventsObserved },
    },
  };
  if (quiet) return { ...projection, text: "" };

  const overallText = indeterminate
    ? `TASK PROGRESS  ${projection.overall.bar} not estimated (${aggregate.outcome})`
    : `TASK PROGRESS  ${projection.overall.bar} ${percentage}% (${aggregate.outcome})`;
  const row = milestones.length
    ? milestones
        .map((milestone) => `[${milestone.name} ${milestone.state} ${milestone.weightPercent}%]`)
        .join(" ")
    : "[no selected milestones indeterminate]";
  return { ...projection, text: `${overallText}\nMilestones\n${row}` };
}

/**
 * Render a disposable operator worker table from a canonical
 * csm-worker-projection/1 document. Pure presentation: it reads the folded
 * snapshot and never sets or returns cursor, receipt, gate, or evidence
 * authority fields.
 */
export function projectWorkerTable(document) {
  if (typeof document !== "object" || document === null || Array.isArray(document))
    throw new TypeError("worker projection requires canonical JSON");
  if (document.schema !== "csm-worker-projection/1")
    throw new TypeError("worker projection requires csm-worker-projection/1");
  if (!Array.isArray(document.workers)) throw new TypeError("worker projection requires workers[]");
  if (typeof document.aggregate !== "object" || document.aggregate === null)
    throw new TypeError("worker projection requires aggregate");

  const rows = document.workers.map((worker) => ({
    workerId: worker.workerId,
    taskId: worker.taskId ?? null,
    skill: worker.skill ?? null,
    state: worker.state,
    activity: worker.activity ?? null,
    attempt: worker.attempt ?? 0,
    heartbeatAgeMs: worker.heartbeatAgeMs ?? null,
    evidenceCount: (worker.evidenceRefs ?? []).length,
    gateStatus: worker.gateStatus ?? null,
  }));

  const header =
    "WORKER".padEnd(18) +
    "TASK".padEnd(16) +
    "SKILL".padEnd(18) +
    "STATE".padEnd(11) +
    "ATT".padEnd(5) +
    "HEARTBEAT".padEnd(11) +
    "EVID".padEnd(5) +
    "GATE";
  const body = rows.length
    ? rows
        .map(
          (row) =>
            String(row.workerId).padEnd(18) +
            String(row.taskId ?? "-").padEnd(16) +
            String(row.skill ?? "-").padEnd(18) +
            String(row.state).padEnd(11) +
            String(row.attempt).padEnd(5) +
            String(row.heartbeatAgeMs === null ? "-" : `${row.heartbeatAgeMs}ms`).padEnd(11) +
            String(row.evidenceCount).padEnd(5) +
            String(row.gateStatus ?? "-"),
        )
        .join("\n")
    : "WORKERS  (none)";
  const summary = `WORKERS  total=${document.aggregate.workers} running=${document.aggregate.running} completed=${document.aggregate.completed} failed=${document.aggregate.failed}`;

  return {
    schema: "csm-worker-projection-render/1",
    source: { schema: document.schema, runId: document.runId ?? null },
    aggregate: { ...document.aggregate },
    rows,
    text: `${header}\n${body}\n${summary}`,
  };
}

export const renderProgressProjection = projectProgress;
export const renderProgress = projectProgress;
export const renderWorkerTable = projectWorkerTable;
