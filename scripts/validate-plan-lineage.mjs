#!/usr/bin/env node
"use strict";

// T003 plan-lineage gate (session-lifecycle-enforcement).
//
// Active/new JSON plans — `provenance.producedAt >= PLAN_LINEAGE_CUTOFF` — must
// form a sound lineage: each goal has exactly one terminal (complete) tip, no
// terminal plan retains `control.blockers` or non-terminal tasks, and a
// superseded plan forwards every open task identity to the successor named by
// its typed supersession pointer. A plan is grandfathered ONLY when its
// `provenance.producedAt` is a valid ISO timestamp strictly before the cutoff:
// legacy plans ARE JSON-parsed so the timestamp can be read, but their body is
// then not validated, exactly like the pre-existing `-csm.md` corpus
// grandfathering, so the gate never demands a rewrite of historical plans. A
// plan whose `producedAt` is missing or invalid is NOT grandfathered — it is
// treated as active, so `validatePlanArtifact` and the lineage rules run against
// it and a hand-authored new plan cannot bypass them by omitting the field.
//
// The gate deliberately validates schema/semantics through
// `validatePlanArtifact` and does NOT enforce the stored digest: historical
// plans carry pre-fix provenance/digest shapes, and the digest contract itself
// is pinned by the writer regression in tests/plan-lineage.test.mjs.
//
// The spike (STEP 0) showed the proposed 2026-09-10 cutoff would reject
// legitimate historical plans (12 superseded plans with forwarded, not copied,
// open tasks and 22 digest-mismatch plans), so the scope is narrowed to the
// first clean day boundary after the last non-compliant lineage plan
// (2026-09-13T06:39:38Z): 2026-09-14T00:00:00Z.
//
// T006b completion-evidence cutoff: the completion-evidence gate (below) only
// applies to `csm-plan/2` records at/after COMPLETION_EVIDENCE_CUTOFF, the first
// clean day boundary after the last historical plan that was completed before
// the per-task `executionReceipt` field existed
// (2026-09-16T19:16:58Z): 2026-09-17T00:00:00Z. A record's effective timestamp
// is `provenance.producedAt`, else its latest journal timestamp, else its
// date-prefixed filename. Records determinably before the cutoff are
// grandfathered (never re-validated) exactly like the lineage cutoff; a record
// whose timestamp cannot be determined at all fails closed (the anti-bypass
// behavior: a new hand-authored plan cannot dodge the gate by omitting every
// timestamp), but records that are determinably old are never gated.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PLAN_SCHEMA_V2, validatePlanArtifact } from "../csm-plan/lib/plan.mjs";
import { evaluateCompletionEvidence } from "./lib/completion-evidence.mjs";

export const PLAN_LINEAGE_CUTOFF = "2026-09-14T00:00:00.000Z";
export const COMPLETION_EVIDENCE_CUTOFF = "2026-09-17T00:00:00.000Z";
export const TERMINAL_TIP_STATUS = "complete";

const PLAN_FILE_RE = /-csm\.json$/;

function producedAtMs(value) {
  const raw = value?.provenance?.producedAt;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// Latest valid journal timestamp, or null when the journal carries none.
function latestJournalMs(value) {
  const journal = Array.isArray(value?.journal) ? value.journal : [];
  let latest = null;
  for (const event of journal) {
    const raw = event?.timestamp;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest;
}

// Leading `YYYY-MM-DD` date prefix of a plan filename, or null when absent.
function filenameDateMs(file) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(path.basename(file));
  if (!match) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Effective timestamp for the completion-evidence cutoff: a record's
// provenance, else its latest journal event, else its date-prefixed filename.
// null means no timestamp could be determined (the caller fails closed there).
function effectiveTimestampMs(value, file) {
  const produced = producedAtMs(value);
  if (produced !== null) return produced;
  const journal = latestJournalMs(value);
  if (journal !== null) return journal;
  return filenameDateMs(file);
}

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: error.message };
  }
}

function taskIds(value) {
  return (value?.tasks ?? []).map((task) => task?.taskId).filter((id) => typeof id === "string");
}

function openTaskIds(value) {
  return (value?.tasks ?? [])
    .filter((task) => task?.status !== "completed")
    .map((task) => task?.taskId)
    .filter((id) => typeof id === "string");
}

function blockers(value) {
  return Array.isArray(value?.control?.blockers) ? value.control.blockers : [];
}

// Resolve the successor named by a superseded plan's typed pointer. The
// pointer path (contained inside the plans directory) is preferred; an
// artifactId match is the fallback for a pointer that omits `path`.
function resolveSuccessor(root, plansDir, plans, value) {
  const pointer = value?.supersession?.supersededBy;
  if (!pointer || typeof pointer !== "object") return { error: "missing supersession pointer" };
  if (typeof pointer.path === "string" && pointer.path.trim() !== "") {
    const plansRoot = path.resolve(plansDir);
    const resolved = path.resolve(root, pointer.path);
    const relative = path.relative(plansRoot, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
      return { error: `successor path escapes the plans directory (${pointer.path})` };
    const parsed = readJson(resolved);
    if (parsed.error) return { error: `successor unreadable (${pointer.path}): ${parsed.error}` };
    return { value: parsed.value, label: pointer.path };
  }
  if (typeof pointer.artifactId === "string") {
    for (const plan of plans.values())
      if (plan.value?.artifactId === pointer.artifactId)
        return { value: plan.value, label: plan.file };
  }
  return { error: "successor cannot be resolved (no usable path or artifactId match)" };
}

// Validates the active/new plan lineage under `<root>/.agents/plans`. Returns
// { ok, cutoff, completionCutoff, checked, grandfathered,
// completionGrandfathered, findings }. `tracked` (a Set of repo-relative paths)
// skips untracked drafts, matching the corpus gates.
export function validatePlanLineage({ root, cutoff = PLAN_LINEAGE_CUTOFF, tracked = null } = {}) {
  const plansDir = path.join(root, ".agents", "plans");
  const findings = [];
  let files;
  try {
    files = fs
      .readdirSync(plansDir)
      .filter((name) => PLAN_FILE_RE.test(name))
      .toSorted();
  } catch (error) {
    return {
      ok: false,
      cutoff,
      checked: 0,
      grandfathered: 0,
      findings: [`plans directory unreadable: ${error.message}`],
    };
  }
  const cutoffMs = Date.parse(cutoff);
  const COMPLETION_EVIDENCE_CUTOFF_MS = Date.parse(COMPLETION_EVIDENCE_CUTOFF);

  const plans = new Map();
  let grandfathered = 0;
  for (const file of files) {
    if (tracked !== null && !tracked.has(`.agents/plans/${file}`)) continue;
    const parsed = readJson(path.join(plansDir, file));
    if (parsed.error) {
      findings.push(`${file}: unreadable (${parsed.error})`);
      continue;
    }
    const produced = producedAtMs(parsed.value);
    // Grandfather only a valid ISO timestamp strictly before the cutoff. A
    // missing/invalid producedAt falls through to the active set below so
    // validatePlanArtifact and the lineage rules still apply (never a silent
    // bypass).
    if (produced !== null && produced < cutoffMs) {
      grandfathered += 1;
      continue;
    }
    plans.set(file, { file, value: parsed.value });
  }

  const valid = new Map();
  for (const [file, entry] of plans) {
    const result = validatePlanArtifact(entry.value);
    if (!result.valid) {
      findings.push(`${file}: invalid plan artifact: ${result.errors.slice(0, 3).join("; ")}`);
      continue;
    }
    valid.set(file, entry);
  }

  // T006 completion-evidence gate: a `csm-plan/2` record may not assert
  // completed tasks or a complete plan without the durable evidence the
  // taxonomy requires (per-task executionReceipt, advanced control cursor,
  // completionReview). Legacy `csm-plan/1` records are EXEMPT — receipts are a
  // /2 feature — and grandfathered pre-cutoff plans never reach here. The gate
  // is itself cut off at COMPLETION_EVIDENCE_CUTOFF so historical /2 plans
  // completed before `executionReceipt` existed are grandfathered: a record
  // determinably before the cutoff is skipped, a record at/after it (or one
  // with no determinable timestamp at all, which is the anti-bypass case) is
  // evaluated. The predicate already fails closed on malformed input; every
  // violation is surfaced so a bulk close-out cannot slip through.
  let completionGrandfathered = 0;
  for (const [file, entry] of valid) {
    if (entry.value?.schema !== PLAN_SCHEMA_V2) continue;
    const timestamp = effectiveTimestampMs(entry.value, file);
    if (timestamp !== null && timestamp < COMPLETION_EVIDENCE_CUTOFF_MS) {
      completionGrandfathered += 1;
      continue;
    }
    for (const violation of evaluateCompletionEvidence(entry.value).violations)
      findings.push(`${file}: completion evidence: ${violation.code} (${violation.detail})`);
  }

  // Rule 1: exactly one terminal (complete) tip per goal, with no active
  // straggler sharing the goal.
  const byGoal = new Map();
  for (const entry of valid.values()) {
    const key =
      typeof entry.value.planId === "string" && entry.value.planId.trim() !== ""
        ? entry.value.planId
        : entry.file;
    if (!byGoal.has(key)) byGoal.set(key, []);
    byGoal.get(key).push(entry);
  }
  for (const [goal, entries] of byGoal) {
    const tips = entries.filter((entry) => entry.value.status === TERMINAL_TIP_STATUS);
    if (tips.length > 1)
      findings.push(
        `goal ${goal}: ${tips.length} terminal (complete) plans (${tips.map((entry) => entry.file).join(", ")}); a goal must have exactly one terminal plan`,
      );
    else if (tips.length === 1)
      for (const entry of entries)
        if (entry.value.status !== TERMINAL_TIP_STATUS && entry.value.status !== "superseded")
          findings.push(
            `goal ${goal}: terminal plan ${tips[0].file} coexists with non-terminal plan ${entry.file}`,
          );
  }

  // Rules 2/3: terminal plans must be closed; superseded plans must forward
  // every open task identity to their successor.
  for (const [file, entry] of valid) {
    const value = entry.value;
    if (value.status === TERMINAL_TIP_STATUS) {
      const retained = blockers(value);
      if (retained.length > 0)
        findings.push(
          `${file}: terminal (complete) plan retains ${retained.length} control.blocker(s)`,
        );
      const open = openTaskIds(value);
      if (open.length > 0)
        findings.push(
          `${file}: terminal (complete) plan retains non-terminal task(s) ${open.join(", ")}`,
        );
      continue;
    }
    if (value.status !== "superseded") continue;
    const retained = blockers(value);
    if (retained.length > 0)
      findings.push(
        `${file}: terminal (superseded) plan retains ${retained.length} control.blocker(s)`,
      );
    const open = openTaskIds(value);
    if (open.length === 0) continue;
    const successor = resolveSuccessor(root, plansDir, plans, value);
    if (successor.error) {
      findings.push(
        `${file}: open task(s) ${open.join(", ")} cannot be forwarded: ${successor.error}`,
      );
      continue;
    }
    const successorCheck = validatePlanArtifact(successor.value);
    if (!successorCheck.valid)
      findings.push(`${file}: successor ${successor.label} is not a valid plan artifact`);
    const successorTasks = new Set(taskIds(successor.value));
    const omitted = open.filter((id) => !successorTasks.has(id));
    if (omitted.length > 0)
      findings.push(
        `${file}: successor ${successor.label} omits open task identity/identities ${omitted.join(", ")}`,
      );
  }

  return {
    ok: findings.length === 0,
    cutoff,
    completionCutoff: COMPLETION_EVIDENCE_CUTOFF,
    checked: valid.size,
    grandfathered,
    completionGrandfathered,
    findings,
  };
}

function parseRoot(argv) {
  let root = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && argv[i + 1]) root = path.resolve(argv[i + 1]);
  }
  return root;
}

function main() {
  const report = validatePlanLineage({ root: parseRoot(process.argv.slice(2)) });
  console.log(
    `plan lineage: {checked:${report.checked}, grandfathered:${report.grandfathered}, completionGrandfathered:${report.completionGrandfathered}, findings:${report.findings.length}}`,
  );
  for (const finding of report.findings) console.log(`FAIL: ${finding}`);
  process.exit(report.ok ? 0 : 1);
}

let isMain = false;
if (process.argv[1]) {
  try {
    isMain =
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    isMain = false;
  }
}
if (isMain) main();
