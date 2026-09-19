import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");
const docPath = path.join(root, "docs/enforcement-evaluator-spike.md");
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

// Extracts the single fenced command that carries CSM_LOOP_RECORD, then the
// embedded `node -e '...'` program. The spike test executes that program
// directly (env-injected record path) so the documented fallback command is the
// artifact under test, not a re-implementation of it.
function extractGuardCode(text) {
  const fences = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const guards = fences.filter((fence) => fence.includes("CSM_LOOP_RECORD"));
  assert.equal(guards.length, 1, "expected exactly one fallback command fence");
  const match = guards[0].match(/node -e '([\s\S]*)'/);
  assert.ok(match, "fallback fence must contain a `node -e '<program>'` command");
  return match[1];
}

function runGuard(record) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "loop-guard-spike-"));
  try {
    const file = path.join(dir, "record.json");
    writeFileSync(file, JSON.stringify(record));
    return spawnSync(process.execPath, ["-e", extractGuardCode(doc)], {
      encoding: "utf8",
      env: { ...process.env, CSM_LOOP_RECORD: file },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("spike findings doc exists and is non-empty", () => {
  assert.ok(existsSync(docPath), `missing ${docPath}`);
  assert.ok(doc.trim().length > 0, "spike doc must not be empty");
});

test("doc states the dispatch+obedience question", () => {
  assert.match(doc, /dispatch\+obedience question/i);
  assert.match(doc, /dispatch feasibility/i);
  assert.match(doc, /obedience feasibility/i);
});

test("doc reasons from the three in-repo evaluator precedents", () => {
  assert.match(doc, /csm-deep-research/i);
  assert.match(doc, /challenger/i);
  assert.match(doc, /judge/i);
  assert.match(doc, /csm-orchestrate/i);
  assert.match(doc, /independent final review/i);
  assert.match(doc, /csm-autoresearch/i);
  assert.match(doc, /separate evaluator/i);
});

test("doc records a go/no-go verdict", () => {
  assert.match(doc, /go\s*\/\s*no-go/i);
  assert.match(doc, /CONDITIONAL GO/);
  assert.match(doc, /NO-GO/);
  assert.match(doc, /obedience-only/i);
});

test("doc defines the deterministic fallback and residual uncertainty", () => {
  assert.match(doc, /deterministic in-loop fallback/i);
  assert.match(doc, /process\.exit\(2\)/);
  assert.match(doc, /process\.exit\(0\)/);
  assert.match(doc, /residual uncertainty/i);
  const guard = extractGuardCode(doc);
  assert.match(guard, /CSM_LOOP_RECORD/);
  assert.match(guard, /process\.exit\(2\)/);
  assert.match(guard, /process\.exit\(0\)/);
});

test("guard exits non-zero when a plan has open work", () => {
  const result = runGuard({
    schema: "csm-plan/2",
    status: "ready",
    control: { activeTasks: [] },
    tasks: [{ taskId: "T001", status: "pending" }],
  });
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /loop-guard: work remains/);
});

test("guard exits non-zero when the lifecycle says complete but a task is pending", () => {
  const result = runGuard({
    schema: "csm-plan/2",
    status: "complete",
    control: { activeTasks: [] },
    tasks: [
      { taskId: "T001", status: "completed" },
      { taskId: "T002", status: "pending" },
    ],
  });
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
});

test("guard exits non-zero when build-state has active tasks", () => {
  const result = runGuard({
    schema: "csm-build-state/2",
    status: "in_progress",
    control: { activeTasks: ["T003"] },
    completion: { status: "pending" },
  });
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
});

test("guard exits zero when all work is complete", () => {
  const result = runGuard({
    schema: "csm-build-state/2",
    status: "complete",
    control: { activeTasks: [] },
    completion: { status: "complete" },
    tasks: [
      { taskId: "T001", status: "completed" },
      { taskId: "T002", status: "superseded" },
    ],
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
});
