"use strict";
// Record a csm-skill-progress/1 TASK PROGRESS record for an invoked sibling
// skill invocation so the orchestrator can roll child progress into the parent
// tracker (skillProgressRollupDir). Records are evidence of invocation state
// only; the orchestrator's technical/functional gates remain the sole
// verification authority.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSkillProgress } from "../../lib/progress-tracker.mjs";

export async function recordSkillProgress({ dir, request, goal, milestones } = {}) {
  if (!dir || !request?.childRunId) return null;
  const childRunId = request.childRunId;
  const rows = milestones ?? [
    { id: "M1", title: "dispatch accepted", weightPercent: 30 },
    { id: "M2", title: "work executed", weightPercent: 40 },
    { id: "M3", title: "evidence bound", weightPercent: 30 },
  ];
  const nowIso = new Date().toISOString();
  const record = {
    schema: "csm-skill-progress/1",
    progressId: "progress-" + childRunId.slice(4),
    runId: childRunId,
    skill: request.skill ?? "csm-build",
    goal: String(goal ?? request.phaseId ?? "sibling skill invocation").slice(0, 300),
    status: "complete",
    overallPercent: 100,
    milestones: rows.map((m) => ({ ...m, status: "complete" })),
    startedAt: nowIso,
    updatedAt: nowIso,
  };
  const verdict = validateSkillProgress(record);
  if (!verdict.ok) throw new Error("invalid skill-progress record: " + verdict.reason);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, childRunId + ".json"), JSON.stringify(record, null, 2) + "\n", {
    mode: 0o644,
  });
  return record;
}
export default recordSkillProgress;
