import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSkillProgress } from "../../lib/progress-tracker.mjs";

// Roll a child skill's csm-skill-progress/1 record into the orchestrator
// progress tracker. Pure mapping: never transitions item state, never touches
// terminal items, never overrides gate authority. The orchestrator's own
// technical/functional gates remain the sole verification authority.
//
// Returns one of:
//   { status: "rolled-up", fraction, evidenceRef }
//   { status: "skipped-terminal" }
//   { status: "skipped-unknown-node" }
//   { status: "skipped-no-record" }
// Throws TypeError on an invalid child record (fail-closed).
export async function rollupChildProgress({ progressTracker, phaseId, nodeId, record }) {
  const verdict = validateSkillProgress(record);
  if (!verdict.ok) throw new TypeError(`invalid child skill-progress record: ${verdict.reason}`);

  const itemId = progressTracker.itemId(phaseId, nodeId);
  if (!itemId) return { status: "skipped-unknown-node" };

  const snapshot = progressTracker.snapshot;
  const item = snapshot.items.find((i) => i.itemId === itemId);
  if (!item) return { status: "skipped-unknown-node" };
  if (["verified", "failed", "blocked", "incomplete"].includes(item.state))
    return { status: "skipped-terminal" };

  const fraction = record.overallPercent / 100;
  const evidenceRef = `skill-progress:${record.progressId}@${snapshot.revision}`;
  const evidenceRefs = [...new Set([...(item.evidenceRefs ?? []), evidenceRef])];

  await progressTracker.update(itemId, {
    verifiedFraction: fraction,
    evidenceRefs,
  });

  return { status: "rolled-up", fraction, evidenceRef };
}

// Find the child skill-progress record whose runId matches childRunId inside
// dir. Returns null when no record matches.
export async function findChildSkillProgress(dir, childRunId) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  for (const f of files.filter((name) => name.endsWith(".json"))) {
    try {
      const record = JSON.parse(await readFile(join(dir, f), "utf-8"));
      if (record?.schema === "csm-skill-progress/1" && record?.runId === childRunId) return record;
    } catch {}
  }
  return null;
}
