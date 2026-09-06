"use strict";
// Record a csm-skill-progress/1 TASK PROGRESS record for an invoked sibling
// skill invocation so the orchestrator can roll child progress into the parent
// tracker (skillProgressRollupDir). Records are evidence of invocation state
// only; the orchestrator's technical/functional gates remain the sole
// verification authority.
//
// { percent } below 100 emits an in-progress record (status "active") whose
// milestones are derived to hit the target exactly: percent < 30 -> M1 active
// at percent/30; 30-70 -> M1 complete, M2 active at (percent-30)/40; 70-99 ->
// M1/M2 complete, M3 active at (percent-70)/30. The shipped validator derives
// overallPercent from milestone weights/fractions and rejects any mismatch.
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../../lib/durable-json/index.mjs";
import { join } from "node:path";
import { validateSkillProgress } from "../../lib/progress-tracker.mjs";

const frac = (value, weight) => Math.ceil((value / weight) * 10000 - 1e-9) / 10000;

function deriveMilestones(percent) {
  if (percent >= 100)
    return [
      { id: "M1", title: "dispatch accepted", weightPercent: 30, status: "complete" },
      { id: "M2", title: "work executed", weightPercent: 40, status: "complete" },
      { id: "M3", title: "evidence bound", weightPercent: 30, status: "complete" },
    ];
  if (percent >= 70)
    return [
      { id: "M1", title: "dispatch accepted", weightPercent: 30, status: "complete" },
      { id: "M2", title: "work executed", weightPercent: 40, status: "complete" },
      {
        id: "M3",
        title: "evidence bound",
        weightPercent: 30,
        status: "active",
        verifiedFraction: frac(percent - 70, 30),
      },
    ];
  if (percent >= 30)
    return [
      { id: "M1", title: "dispatch accepted", weightPercent: 30, status: "complete" },
      {
        id: "M2",
        title: "work executed",
        weightPercent: 40,
        status: "active",
        verifiedFraction: frac(percent - 30, 40),
      },
      { id: "M3", title: "evidence bound", weightPercent: 30, status: "pending" },
    ];
  return [
    {
      id: "M1",
      title: "dispatch accepted",
      weightPercent: 30,
      status: "active",
      verifiedFraction: frac(percent, 30),
    },
    { id: "M2", title: "work executed", weightPercent: 40, status: "pending" },
    { id: "M3", title: "evidence bound", weightPercent: 30, status: "pending" },
  ];
}

export async function recordSkillProgress({ dir, request, goal, percent = 100, milestones } = {}) {
  if (!dir || !request?.childRunId) return null;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new TypeError("percent must be an integer between 0 and 100");
  const childRunId = request.childRunId;
  // F-022: the id feeds a file path - enforce the canonical shape here, not
  // only remotely via schema validation downstream
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(childRunId) || childRunId.includes("/"))
    throw new TypeError("childRunId must be a canonical run id");
  const rows = milestones ?? deriveMilestones(percent);
  const nowIso = new Date().toISOString();
  const record = {
    schema: "csm-skill-progress/1",
    progressId: "progress-" + childRunId.slice(4),
    runId: childRunId,
    skill: request.skill ?? "csm-build",
    goal: String(goal ?? request.phaseId ?? "sibling skill invocation").slice(0, 300),
    status: percent >= 100 ? "complete" : "active",
    overallPercent: percent,
    milestones: milestones
      ? rows.map((m) => ({
          ...m,
          status: percent >= 100 ? "complete" : (m.status ?? "complete"),
        }))
      : rows,
    startedAt: nowIso,
    updatedAt: nowIso,
  };
  const verdict = validateSkillProgress(record);
  if (!verdict.ok) throw new Error("invalid skill-progress record: " + verdict.reason);
  await mkdir(dir, { recursive: true });
  await atomicWrite(join(dir, childRunId + ".json"), JSON.stringify(record, null, 2) + "\n", {
    mode: 0o644,
  });
  return record;
}
export default recordSkillProgress;
