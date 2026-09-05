// Apply the honest-failure fixes (quality delivery cycle 4) as content-anchored,
// fail-closed, idempotent patches:
//
//   F1 invocation.mjs      — read-only child timeout returns a typed retryable
//                            failure instead of a permanent reconciliation block
//                            (side-effecting children keep fail-closed semantics)
//   F2 telemetry.mjs       — emitter.flush() drains async transports
//   F3 index.mjs           — orchestrate epilogue drains telemetry so receipts
//                            and telemetry.jsonl are consistent on exit
//   F4 index.mjs           — orchestrate fails fast when runId !== approach.runId
//                            (approvals and cursors bind to the approach identity)
//   F5 check-suite.mjs     — capability manifest freshness gate (skill digests
//                            verified against file bytes at gate time)
//   F6 run-orchestrator    — refuse silent durable-state reuse (--resume), and a
//                            configurable --timeout-ms for real hosts
//
// Every patch's old text must match exactly once; any drift aborts without
// writing. Already-applied patches are skipped so the codemod is idempotent.
//
// Usage: node scripts/patch-honest-failures.mjs [--check]
"use strict";

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const PATCHES = [
  {
    id: "F1-invocation-read-only-timeout",
    file: "csm-orchestrate/lib/invocation.mjs",
    old: `      } catch (error) {
        clearTimeout(timer);
        if (error?.timeout || error?.cancelled) {
          const terminal = failure(
            "incomplete",
            error?.timeout ? "timeout" : "timeout",
            "reconciliation-required",`,
    new: `      } catch (error) {
        clearTimeout(timer);
        if (error?.timeout || error?.cancelled) {
          // Honest-failure fix (cycle 4): a read-only child has no external
          // effects, so a post-dispatch timeout is unambiguous — return a typed
          // retryable failure instead of a permanent reconciliation block.
          // Side-effecting children keep the fail-closed reconciliation path.
          if (error?.timeout && attemptRecord.sideEffectClass === "read-only") {
            const retryable = failure(
              "failed",
              "timeout",
              "child-timeout",
              "read-only child invocation timed out; safe retry allowed",
            );
            await persistTerminal(retryable);
            return retryable;
          }
          const terminal = failure(
            "incomplete",
            error?.timeout ? "timeout" : "timeout",
            "reconciliation-required",`,
  },
  {
    id: "F2-telemetry-flush-return",
    file: "csm-orchestrate/lib/telemetry.mjs",
    old: `  return {
    emit,
    recordTerminalReceipt,`,
    new: `  async function flush() {
    // drain async transports so persisted telemetry is complete when the
    // process exits (honest-failure fix: jsonl writes were lost on exit)
    const drained = transport.list();
    if (drained?.then) await drained;
  }

  return {
    emit,
    recordTerminalReceipt,`,
  },
  {
    id: "F2-telemetry-flush-export",
    file: "csm-orchestrate/lib/telemetry.mjs",
    old: `    getLossRecords: () => lossRecords.slice(),
  };`,
    new: `    getLossRecords: () => lossRecords.slice(),
    flush,
  };`,
  },
  {
    id: "F3-orchestrate-telemetry-drain",
    file: "csm-orchestrate/lib/index.mjs",
    old: `  await assertSchema("csm-orchestrate-receipt/2", durable);
  if (options?.cursorStore?.saveTerminalReceipt)
    await persistTerminalReceipt(durable, options.cursorStore);
  return {`,
    new: `  await assertSchema("csm-orchestrate-receipt/2", durable);
  if (options?.cursorStore?.saveTerminalReceipt)
    await persistTerminalReceipt(durable, options.cursorStore);
  if (typeof options?.telemetryEmitter?.flush === "function")
    await options.telemetryEmitter.flush().catch(() => {});
  return {`,
  },
  {
    id: "F4-orchestrate-runid-divergence",
    file: "csm-orchestrate/lib/index.mjs",
    old: `export async function orchestrate(options) {
  const result = await runOrchestrationInternal(options);`,
    new: `export async function orchestrate(options) {
  if (
    options &&
    typeof options.approach?.runId === "string" &&
    typeof options.runId === "string" &&
    options.runId !== options.approach.runId
  )
    throw new TypeError(
      "runId must equal approach.runId: approvals and cursors bind to the approach run identity",
    );
  const result = await runOrchestrationInternal(options);`,
  },
  {
    id: "F5-checksuite-capability-freshness-call",
    file: "scripts/check-suite.mjs",
    old: `  for (const issue of checkProgressTrackerContracts(root))
    check(false, \`progress tracker contract: \${issue}\`);`,
    new: `  for (const issue of checkProgressTrackerContracts(root))
    check(false, \`progress tracker contract: \${issue}\`);
  for (const issue of checkCapabilityManifestFreshness(root))
    check(false, \`capability manifest: \${issue}\`);`,
  },
  {
    id: "F5-checksuite-capability-freshness-fn",
    file: "scripts/check-suite.mjs",
    old: `function checkPayloadDrift(rootDir) {`,
    new: `// Honest-failure fix (cycle 4): skill files can change without regenerating
// csm-orchestrate/capabilities.json; the drift only surfaced later as an
// orchestrator startup failure ("invalid capability manifest"). Verify every
// manifest digest against the file bytes at gate time.
function checkCapabilityManifestFreshness(rootDir) {
  const issues = [];
  const manifestPath = path.join(rootDir, "csm-orchestrate", "capabilities.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return ["capabilities.json missing or unreadable"];
  }
  for (const capability of manifest.skills ?? []) {
    const skillPath = path.join(rootDir, capability.source?.skillPath ?? "");
    let actual;
    try {
      actual = \`sha256:\${createHash("sha256").update(fs.readFileSync(skillPath)).digest("hex")}\`;
    } catch {
      issues.push(\`\${capability.skill}: skill file missing (\${capability.source?.skillPath})\`);
      continue;
    }
    if (capability.digest && actual !== capability.digest)
      issues.push(
        \`\${capability.skill}: manifest digest stale — regenerate csm-orchestrate/capabilities.json\`,
      );
    if (capability.source?.entrypoint && capability.source?.libraryDigest) {
      let entryDigest;
      try {
        entryDigest = \`sha256:\${createHash("sha256").update(fs.readFileSync(path.join(rootDir, capability.source.entrypoint))).digest("hex")}\`;
      } catch {
        issues.push(\`\${capability.skill}: entrypoint file missing (\${capability.source.entrypoint})\`);
        continue;
      }
      if (entryDigest !== capability.source.libraryDigest)
        issues.push(
          \`\${capability.skill}: entrypoint libraryDigest stale — regenerate csm-orchestrate/capabilities.json\`,
        );
    }
  }
  return issues;
}

function checkPayloadDrift(rootDir) {`,
  },
  {
    id: "F6-driver-durable-state-guard",
    file: "scripts/run-orchestrator.mjs",
    old: `  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);
  await mkdir(evidenceDir, { recursive: true });
  const cursorStore = createSqliteStore({`,
    new: `  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);
  await mkdir(evidenceDir, { recursive: true });
  // honest-failure guard: silently reusing durable state surfaces as progress
  // fencing staleness; require an explicit --resume or a fresh approach.runId
  if (!args.includes("--resume") && existsSync(join(evidenceDir, "cursor.db")))
    throw new Error(
      \`run \${runId} already has durable state; pass --resume to continue recovery or use a fresh approach.runId\`,
    );
  const timeoutMs = Number(argValue("--timeout-ms") ?? 600_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("--timeout-ms must be a positive number of milliseconds");
  const cursorStore = createSqliteStore({`,
  },
  {
    id: "F6-driver-timeout-var",
    file: "scripts/run-orchestrator.mjs",
    old: `    maxSteps: 25,
    // real hosts do real work (test suites, evaluations); the 30s default is
    // tuned for in-process fixtures and fails a legitimate build attempt
    timeoutMs: 600_000,`,
    new: `    maxSteps: 25,
    // real hosts do real work (test suites, evaluations); the 30s runtime
    // default is tuned for in-process fixtures and fails legitimate builds
    timeoutMs,`,
  },
  {
    id: "F6-driver-existsync-import",
    file: "scripts/run-orchestrator.mjs",
    old: `import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";`,
    new: `import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";`,
  },
];

function applyPatch(source, patch) {
  // idempotency first: insertion patches keep their anchor inside the applied
  // text, so presence of the new text must win over anchor counting
  if (source.includes(patch.new)) return { source, applied: false }; // already applied
  const occurrences = source.split(patch.old).length - 1;
  if (occurrences === 1) return { source: source.split(patch.old).join(patch.new), applied: true };
  throw new Error(
    `patch ${patch.id}: anchor matched ${occurrences} time(s) in ${patch.file}; refusing to write`,
  );
}

export async function patchHonestFailures({ check = false } = {}) {
  const byFile = new Map();
  const results = [];
  for (const patch of PATCHES) {
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

export default patchHonestFailures;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  patchHonestFailures({ check: process.argv.includes("--check") })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
