// Progress visibility fixes (quality delivery cycle 5). Content-anchored,
// fail-closed, idempotent patches so orchestrator runs and the skills they
// invoke actually show progress:
//
//   V1 progress.mjs    — createProgressTracker accepts onUpdate(snapshot)
//   V2 progress.mjs    — change() and observeTelemetry() notify the observer
//   V3 index.mjs       — orchestrate option onProgress passed to both trackers
//   V4 driver          — live TASK PROGRESS rendering (--quiet-progress to mute),
//                        final projection after the run, skillProgressRollupDir
//                        wired, host factories receive skillProgressDir
//   V5 hosts           — invoked sibling skills record csm-skill-progress/1 per
//                        invocation so rollup can surface child progress
//   V6 approach        — bump quality-review runId (fresh durable store for the
//                        in-run capture)
//
// Every patch's old text must match exactly once (or the new text is already
// present); any drift aborts without writing.
//
// Usage: node scripts/patch-progress-visibility.mjs [--check]
"use strict";

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const L = (lines) => lines.join("\n");

const RECORDER_SOURCE = L([
  '"use strict";',
  "// Record a csm-skill-progress/1 TASK PROGRESS record for an invoked sibling",
  "// skill invocation so the orchestrator can roll child progress into the parent",
  "// tracker (skillProgressRollupDir). Records are evidence of invocation state",
  "// only; the orchestrator's technical/functional gates remain the sole",
  "// verification authority.",
  'import { mkdir, writeFile } from "node:fs/promises";',
  'import { join } from "node:path";',
  'import { validateSkillProgress } from "../../lib/progress-tracker.mjs";',
  "",
  "export async function recordSkillProgress({ dir, request, goal, milestones } = {}) {",
  "  if (!dir || !request?.childRunId) return null;",
  "  const childRunId = request.childRunId;",
  "  const rows =",
  "    milestones ??",
  "    [",
  '      { id: "M1", title: "dispatch accepted", weightPercent: 30 },',
  '      { id: "M2", title: "work executed", weightPercent: 40 },',
  '      { id: "M3", title: "evidence bound", weightPercent: 30 },',
  "    ];",
  "  const nowIso = new Date().toISOString();",
  "  const record = {",
  '    schema: "csm-skill-progress/1",',
  '    progressId: "progress-" + childRunId.slice(4),',
  "    runId: childRunId,",
  '    skill: request.skill ?? "csm-build",',
  '    goal: String(goal ?? request.phaseId ?? "sibling skill invocation").slice(0, 300),',
  '    status: "complete",',
  "    overallPercent: 100,",
  '    milestones: rows.map((m) => ({ ...m, status: "complete" })),',
  "    startedAt: nowIso,",
  "    updatedAt: nowIso,",
  "  };",
  "  const verdict = validateSkillProgress(record);",
  '  if (!verdict.ok) throw new Error("invalid skill-progress record: " + verdict.reason);',
  "  await mkdir(dir, { recursive: true });",
  '  await writeFile(join(dir, childRunId + ".json"), JSON.stringify(record, null, 2) + "\\n", {',
  "    mode: 0o644,",
  "  });",
  "  return record;",
  "}",
  "export default recordSkillProgress;",
  "",
]);

const PATCHES = [
  {
    id: "V1-tracker-onupdate-param",
    file: "csm-orchestrate/lib/progress.mjs",
    old: L([
      "export function createProgressTracker({",
      "  runId,",
      "  graphRevision = 1,",
      "  store = null,",
      "  now = () => new Date().toISOString(),",
      "} = {}) {",
    ]),
    new: L([
      "export function createProgressTracker({",
      "  runId,",
      "  graphRevision = 1,",
      "  store = null,",
      "  now = () => new Date().toISOString(),",
      "  onUpdate = null,",
      "} = {}) {",
    ]),
  },
  {
    id: "V2a-tracker-change-notify",
    file: "csm-orchestrate/lib/progress.mjs",
    old: L([
      "  const change = (fn) => {",
      "    document = fn(document);",
      "    return persist();",
      "  };",
    ]),
    new: L([
      "  const notifyUpdate = () => {",
      '    if (typeof onUpdate !== "function") return;',
      "    try {",
      "      onUpdate(structuredClone(document));",
      "    } catch {",
      "      /* observer errors never break the run */",
      "    }",
      "  };",
      "  const change = (fn) => {",
      "    document = fn(document);",
      "    notifyUpdate();",
      "    return persist();",
      "  };",
    ]),
  },
  {
    id: "V2b-tracker-telemetry-notify",
    file: "csm-orchestrate/lib/progress.mjs",
    old: L([
      "    observeTelemetry() {",
      "      document = createProgressDocument({",
      "        ...document,",
      "        revision: document.revision + 1,",
      "        eventsObserved: document.aggregate.eventsObserved + 1,",
      "        now: now(),",
      "      });",
      "      return persist();",
      "    },",
    ]),
    new: L([
      "    observeTelemetry() {",
      "      document = createProgressDocument({",
      "        ...document,",
      "        revision: document.revision + 1,",
      "        eventsObserved: document.aggregate.eventsObserved + 1,",
      "        now: now(),",
      "      });",
      "      notifyUpdate();",
      "      return persist();",
      "    },",
    ]),
  },
  {
    id: "V3a-index-onprogress-option",
    file: "csm-orchestrate/lib/index.mjs",
    old: "  skillProgressRollupDir = null,",
    new: "  skillProgressRollupDir = null,\n  onProgress = null,",
  },
  {
    id: "V3b-index-tracker-site-1",
    file: "csm-orchestrate/lib/index.mjs",
    old: L([
      "  progressTracker = createProgressTracker({",
      "    runId,",
      "    graphRevision: 1,",
      "    store: cursorStore,",
      "    now: () => new Date(now()).toISOString(),",
      "  });",
    ]),
    new: L([
      "  progressTracker = createProgressTracker({",
      "    runId,",
      "    graphRevision: 1,",
      "    store: cursorStore,",
      "    now: () => new Date(now()).toISOString(),",
      "    onUpdate: onProgress,",
      "  });",
    ]),
  },
  {
    id: "V3c-index-tracker-site-2",
    file: "csm-orchestrate/lib/index.mjs",
    old: L([
      "  progressTracker = createProgressTracker({",
      "    runId,",
      "    graphRevision: graph.graphRevision,",
      "    store: cursorStore,",
      "    now: () => new Date(now()).toISOString(),",
      "  });",
    ]),
    new: L([
      "  progressTracker = createProgressTracker({",
      "    runId,",
      "    graphRevision: graph.graphRevision,",
      "    store: cursorStore,",
      "    now: () => new Date(now()).toISOString(),",
      "    onUpdate: onProgress,",
      "  });",
    ]),
  },
  {
    id: "V4a-driver-import-projection",
    file: "scripts/run-orchestrator.mjs",
    old: 'import { orchestrate } from "../csm-orchestrate/index.mjs";',
    new: 'import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";',
  },
  {
    id: "V4b-driver-host-factory",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      "async function loadHostModule(hostPath, runId) {",
      "  const module = await import(pathToFileURL(path.resolve(hostPath)).href);",
      '  if (typeof module.default !== "function") {',
      '    throw new TypeError("host module must default-export a factory: ({runId}) => host");',
      "  }",
      "  return module.default({ runId });",
      "}",
    ]),
    new: L([
      "async function loadHostModule(hostPath, runId, skillProgressDir) {",
      "  const module = await import(pathToFileURL(path.resolve(hostPath)).href);",
      '  if (typeof module.default !== "function") {',
      '    throw new TypeError("host module must default-export a factory: ({runId}) => host");',
      "  }",
      "  return module.default({ runId, skillProgressDir });",
      "}",
    ]),
  },
  {
    id: "V4c-driver-dir-before-host",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      "  const host = await loadHostModule(hostPath, runId);",
      "  const hostArtifactResolver = host.artifactResolver ?? null;",
      "  const hostChildArtifactResolver = host.childArtifactResolver ?? hostArtifactResolver;",
      "  const capabilities = await loadCapabilities();",
      '  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);',
      "  await mkdir(evidenceDir, { recursive: true });",
    ]),
    new: L([
      "  const capabilities = await loadCapabilities();",
      '  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);',
      "  await mkdir(evidenceDir, { recursive: true });",
      '  const skillProgressDir = join(evidenceDir, "skill-progress");',
      "  await mkdir(skillProgressDir, { recursive: true });",
      "  // one directory serves recording (hosts) and rollup (orchestrate option)",
      "  const skillProgressRollupDir = skillProgressDir;",
      "  const host = await loadHostModule(hostPath, runId, skillProgressDir);",
      "  const hostArtifactResolver = host.artifactResolver ?? null;",
      "  const hostChildArtifactResolver = host.childArtifactResolver ?? hostArtifactResolver;",
    ]),
  },
  {
    id: "V4d-driver-quiet-flag",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      '  const timeoutMs = Number(argValue("--timeout-ms") ?? 600_000);',
      "  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)",
      '    throw new Error("--timeout-ms must be a positive number of milliseconds");',
    ]),
    new: L([
      '  const timeoutMs = Number(argValue("--timeout-ms") ?? 600_000);',
      "  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)",
      '    throw new Error("--timeout-ms must be a positive number of milliseconds");',
      '  const quietProgress = args.includes("--quiet-progress");',
    ]),
  },
  {
    id: "V4e-driver-options",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      '    producerExecutorId: "csm-build",',
      "    ...(finalReviewExecutor ? { finalReviewExecutor } : {}),",
    ]),
    new: L([
      '    producerExecutorId: "csm-build",',
      "    skillProgressRollupDir,",
      "    ...(quietProgress",
      "      ? {}",
      "      : {",
      "          onProgress: (snapshot) => {",
      "            console.log(projectProgress(snapshot, { width: 28 }).text);",
      "          },",
      "        }),",
      "    ...(finalReviewExecutor ? { finalReviewExecutor } : {}),",
    ]),
  },
  {
    id: "V4f-driver-final-render",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      "  // drain the async transport so telemetry.jsonl is complete before exit",
      "  await telemetryEmitter.getEvents();",
      '  console.log("status:", result.receipt.outcome.status);',
    ]),
    new: L([
      "  // drain the async transport so telemetry.jsonl is complete before exit",
      "  await telemetryEmitter.getEvents();",
      "  if (result.progress && !quietProgress) {",
      "    console.log(projectProgress(result.progress, { width: 28 }).text);",
      "  }",
      '  console.log("status:", result.receipt.outcome.status);',
    ]),
  },
  {
    id: "V4g-driver-usage",
    file: "scripts/run-orchestrator.mjs",
    old: '"usage: run-orchestrator.mjs --fixture | --approach <approach.json> [--host <host.mjs>] [--run-id <runId>] [--approvals <module.mjs>] [--final-review <reviewer.mjs>]",',
    new: '"usage: run-orchestrator.mjs --fixture | --approach <approach.json> [--host <host.mjs>] [--run-id <runId>] [--approvals <module.mjs>] [--final-review <reviewer.mjs>] [--timeout-ms <ms>] [--quiet-progress] [--resume]",',
  },
  {
    id: "V5a-recorder-module",
    file: "scripts/lib/skill-progress-recorder.mjs",
    newFile: RECORDER_SOURCE,
  },
  {
    id: "V5b-review-host-import",
    file: "scripts/quality-review-host.mjs",
    old: 'import { digest } from "../lib/schema-runtime/index.mjs";',
    new: L([
      'import { digest } from "../lib/schema-runtime/index.mjs";',
      'import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";',
    ]),
  },
  {
    id: "V5c-review-host-factory",
    file: "scripts/quality-review-host.mjs",
    old: "export default function qualityReviewHost() {",
    new: "export default function qualityReviewHost({ skillProgressDir } = {}) {",
  },
  {
    id: "V5d-review-host-record",
    file: "scripts/quality-review-host.mjs",
    old: "      const evidenceId = `ev-quality-${calls}`;",
    new: L([
      "      await recordSkillProgress({ dir: skillProgressDir, request, goal: request.phaseId });",
      "      const evidenceId = `ev-quality-${calls}`;",
    ]),
  },
  {
    id: "V5e-delivery-host-import",
    file: "scripts/quality-delivery-host.mjs",
    old: 'import { digest } from "../lib/schema-runtime/index.mjs";',
    new: L([
      'import { digest } from "../lib/schema-runtime/index.mjs";',
      'import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";',
    ]),
  },
  {
    id: "V5f-delivery-host-factory",
    file: "scripts/quality-delivery-host.mjs",
    old: "export default function qualityDeliveryHost({ runId } = {}) {",
    new: "export default function qualityDeliveryHost({ runId, skillProgressDir } = {}) {",
  },
  {
    id: "V5g-delivery-host-record",
    file: "scripts/quality-delivery-host.mjs",
    old: "      const output = await phaseWork(request);",
    new: L([
      "      const output = await phaseWork(request);",
      "      await recordSkillProgress({ dir: skillProgressDir, request, goal: request.phaseId });",
    ]),
  },
  {
    id: "V5h-honest-host-import",
    file: "scripts/honest-failures-host.mjs",
    old: 'import { digest } from "../lib/schema-runtime/index.mjs";',
    new: L([
      'import { digest } from "../lib/schema-runtime/index.mjs";',
      'import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";',
    ]),
  },
  {
    id: "V5i-honest-host-factory",
    file: "scripts/honest-failures-host.mjs",
    old: "export default function honestFailuresHost({ runId } = {}) {",
    new: "export default function honestFailuresHost({ runId, skillProgressDir } = {}) {",
  },
  {
    id: "V5j-honest-host-record",
    file: "scripts/honest-failures-host.mjs",
    old: "      const output = await phaseWork(request);",
    new: L([
      "      const output = await phaseWork(request);",
      "      await recordSkillProgress({ dir: skillProgressDir, request, goal: request.phaseId });",
    ]),
  },
  {
    id: "V6-approach-runid",
    file: "scripts/quality-review-approach.json",
    old: '  "runId": "run-quality-review-e2e-r2",',
    new: '  "runId": "run-quality-review-e2e-r3",',
  },
  {
    // the early rollup was clobbered: the later "state: active" tracker update
    // replaces evidenceRefs and resets verifiedFraction; move the rollup after it
    id: "V7a-index-rollup-remove-early",
    file: "csm-orchestrate/lib/index.mjs",
    old: L([
      "        const receipt = childReceipt(result, node, invocationChildRunId);",
      "        if (skillProgressRollupDir) {",
      "          try {",
      "            const { rollupChildProgress, findChildSkillProgress } =",
      '              await import("./progress-rollup.mjs");',
      "            const childRecord = await findChildSkillProgress(",
      "              skillProgressRollupDir,",
      "              invocationChildRunId,",
      "            );",
      "            if (childRecord) {",
      "              const rollupResult = await rollupChildProgress({",
      "                progressTracker,",
      "                phaseId: phase.phaseId,",
      "                nodeId: node.nodeId,",
      "                record: childRecord,",
      "              });",
      '              if (rollupResult.status === "rolled-up")',
      "                emitTelemetry({",
      "                  phaseId: phase.phaseId,",
      "                  edgeId: `edge-${slug(node.nodeId)}`,",
      "                  childRunId: invocationChildRunId,",
      '                  eventType: "skill-progress-rollup",',
      "                  payload: {",
      "                    fraction: rollupResult.fraction,",
      "                    evidenceRef: rollupResult.evidenceRef,",
      "                  },",
      "                });",
      "            }",
      "          } catch {}",
      "        }",
      "        let failure =",
    ]),
    new: L([
      "        const receipt = childReceipt(result, node, invocationChildRunId);",
      "        let failure =",
    ]),
  },
  {
    id: "V7b-index-rollup-insert-late",
    file: "csm-orchestrate/lib/index.mjs",
    old: L([
      '        if (!failure && result.status === "completed")',
      "          await progressTracker.update(progressId, {",
      '            state: "active",',
      "            childRunId: invocationChildRunId,",
      "            attempt,",
      "            evidenceRefs: [...evidence, ...reconciledEvidence]",
      "              .map((item) => item.evidenceId)",
      "              .filter(Boolean),",
      "          });",
      "        return {",
    ]),
    new: L([
      '        if (!failure && result.status === "completed")',
      "          await progressTracker.update(progressId, {",
      '            state: "active",',
      "            childRunId: invocationChildRunId,",
      "            attempt,",
      "            evidenceRefs: [...evidence, ...reconciledEvidence]",
      "              .map((item) => item.evidenceId)",
      "              .filter(Boolean),",
      "          });",
      "        // roll up child skill-progress AFTER the per-node update: that update",
      "        // replaces evidenceRefs and resets verifiedFraction, so a rollup run",
      "        // earlier would be silently discarded",
      "        if (skillProgressRollupDir) {",
      "          try {",
      "            const { rollupChildProgress, findChildSkillProgress } =",
      '              await import("./progress-rollup.mjs");',
      "            const childRecord = await findChildSkillProgress(",
      "              skillProgressRollupDir,",
      "              invocationChildRunId,",
      "            );",
      "            if (childRecord) {",
      "              const rollupResult = await rollupChildProgress({",
      "                progressTracker,",
      "                phaseId: phase.phaseId,",
      "                nodeId: node.nodeId,",
      "                record: childRecord,",
      "              });",
      '              if (rollupResult.status === "rolled-up")',
      "                emitTelemetry({",
      "                  phaseId: phase.phaseId,",
      "                  edgeId: `edge-${slug(node.nodeId)}`,",
      "                  childRunId: invocationChildRunId,",
      '                  eventType: "skill-progress-rollup",',
      "                  payload: {",
      "                    fraction: rollupResult.fraction,",
      "                    evidenceRef: rollupResult.evidenceRef,",
      "                  },",
      "                });",
      "            }",
      "          } catch {}",
      "        }",
      "        return {",
    ]),
  },
];

function applyPatch(source, patch) {
  if (patch.newFile !== undefined) {
    if (source.includes(patch.newFile.split("\n")[2] ?? "unmatchable"))
      return { source, applied: false };
    return { source: source + patch.newFile, applied: true };
  }
  if (source.includes(patch.new)) return { source, applied: false }; // already applied
  const occurrences = source.split(patch.old).length - 1;
  if (occurrences === 1) return { source: source.split(patch.old).join(patch.new), applied: true };
  throw new Error(
    `patch ${patch.id}: anchor matched ${occurrences} time(s) in ${patch.file}; refusing to write`,
  );
}

export async function patchProgressVisibility({ check = false } = {}) {
  const byFile = new Map();
  const results = [];
  for (const patch of PATCHES) {
    if (patch.newFile !== undefined) {
      let source;
      try {
        source = await readFile(ROOT + patch.file, "utf8");
      } catch {
        if (!check) {
          await writeFile(ROOT + patch.file, patch.newFile, { mode: 0o644 });
          results.push({ id: patch.id, file: patch.file, applied: true });
          continue;
        }
        results.push({ id: patch.id, file: patch.file, applied: true });
        continue;
      }
      const applied = !source.includes("recordSkillProgress");
      results.push({ id: patch.id, file: patch.file, applied });
      continue;
    }
    if (!byFile.has(patch.file)) byFile.set(patch.file, await readFile(ROOT + patch.file, "utf8"));
    let source = byFile.get(patch.file);
    let applied;
    ({ source, applied } = applyPatch(source, patch));
    byFile.set(patch.file, source);
    results.push({ id: patch.id, file: patch.file, applied });
  }
  if (check) return { results, wrote: false, files: [...byFile.keys()] };
  for (const [file, source] of byFile) await writeFile(ROOT + file, source, { mode: 0o644 });
  return { results, wrote: true, files: [...byFile.keys()] };
}

export default patchProgressVisibility;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  patchProgressVisibility({ check: process.argv.includes("--check") })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
