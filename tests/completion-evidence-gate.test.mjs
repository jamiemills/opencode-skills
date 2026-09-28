// T006: completion-evidence gate wired into validate-plan-lineage, scoped to
// csm-plan/2 and fail-closed. Proves:
//   - a /2 bulk close-out (all tasks completed, unadvanced cursor, null
//     completionReview, no receipts) FAILS the gate;
//   - a valid /2 in-progress plan with pending tasks PASSES;
//   - a legacy /1 completed plan with no receipts PASSES (exempt);
//   - an unreadable/malformed record FAILS closed.
// T006b adds the completion-evidence cutoff: a /2 record whose effective
// timestamp is before the cutoff (provenance, else latest journal event, else
// date-prefixed filename) is grandfathered; a record with no determinable
// timestamp still fails closed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appendPlanJournal, createPlanArtifact } from "../csm-plan/lib/plan.mjs";
import { validatePlanLineage } from "../scripts/validate-plan-lineage.mjs";

const ACTIVE = "2026-09-20T00:00:00.000Z";
const PRE_CUTOFF = "2026-09-16T19:16:58.000Z";

async function makeRepo(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "csm-completion-gate-"));
  await fs.promises.mkdir(path.join(root, ".agents", "plans"), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePlan(root, name, value) {
  fs.writeFileSync(
    path.join(root, ".agents", "plans", name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function task(taskId, status = "pending") {
  return { taskId, ordinal: Number(taskId.slice(1)), status, acceptanceSignal: "test -n ok" };
}

test("csm-plan/2 bulk close-out with no receipts fails the evidence gate", async (t) => {
  const root = await makeRepo(t);
  const base = createPlanArtifact({
    schemaRevision: 2,
    planId: "bulk-goal",
    status: "in_progress",
    provenance: { producedAt: ACTIVE },
    control: { blockers: [] },
    tasks: [task("T001", "completed"), task("T002", "completed")],
  });
  // Close the goal on an unadvanced cursor (cycle 0) with no completionReview
  // and no per-task receipts: exactly the bulk close-out the gate must reject.
  const closed = appendPlanJournal(base, {
    timestamp: ACTIVE,
    cycle: 0,
    transition: "NOT_STARTED -> COMPLETE",
    evidence: "bulk close-out",
    nextState: "COMPLETE",
  });
  writePlan(root, "2026-09-20-bulk-csm.json", closed);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  const findings = report.findings.join("\n");
  assert.match(findings, /bulk-csm\.json: completion evidence: bulk-completion/);
  assert.match(findings, /bulk-csm\.json: completion evidence: completed-task-missing-receipt/);
  assert.match(
    findings,
    /bulk-csm\.json: completion evidence: complete-with-null-completion-review/,
  );
});

test("a valid csm-plan/2 in-progress plan with pending tasks passes", async (t) => {
  const root = await makeRepo(t);
  writePlan(
    root,
    "2026-09-20-active-csm.json",
    createPlanArtifact({
      schemaRevision: 2,
      planId: "active-goal",
      status: "in_progress",
      provenance: { producedAt: ACTIVE },
      control: { blockers: [] },
      tasks: [task("T001"), task("T002")],
    }),
  );

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.deepEqual(report.findings, []);
});

test("a legacy csm-plan/1 completed plan with no receipts is exempt", async (t) => {
  const root = await makeRepo(t);
  const base = createPlanArtifact({
    planId: "legacy-goal",
    status: "in_progress",
    provenance: { producedAt: ACTIVE },
    control: { blockers: [] },
    tasks: [task("T001", "completed")],
  });
  const closed = appendPlanJournal(base, {
    timestamp: ACTIVE,
    cycle: 0,
    transition: "NOT_STARTED -> COMPLETE",
    evidence: "legacy close-out",
    nextState: "COMPLETE",
  });
  assert.equal(closed.schema, "csm-plan/1");
  writePlan(root, "2026-09-20-legacy-v1-csm.json", closed);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.deepEqual(report.findings, []);
});

test("a pre-cutoff csm-plan/2 completed record without receipts is exempt", async (t) => {
  const root = await makeRepo(t);
  const base = createPlanArtifact({
    schemaRevision: 2,
    planId: "historic-goal",
    status: "in_progress",
    provenance: { producedAt: PRE_CUTOFF },
    control: { blockers: [] },
    tasks: [task("T001", "completed"), task("T002", "completed")],
  });
  // Same bulk close-out shape as the failing case, but before the
  // completion-evidence cutoff: it must be grandfathered, not gated.
  const closed = appendPlanJournal(base, {
    timestamp: PRE_CUTOFF,
    cycle: 0,
    transition: "NOT_STARTED -> COMPLETE",
    evidence: "historic close-out",
    nextState: "COMPLETE",
  });
  writePlan(root, "2026-09-14-historic-csm.json", closed);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.deepEqual(report.findings, []);
  assert.equal(report.completionGrandfathered, 1);
});

test("timestamp falls back to the latest journal event when provenance is absent", async (t) => {
  const root = await makeRepo(t);
  const base = createPlanArtifact({
    schemaRevision: 2,
    planId: "journal-goal",
    status: "in_progress",
    provenance: { producedAt: PRE_CUTOFF },
    control: { blockers: [] },
    tasks: [task("T001", "completed")],
  });
  const closed = appendPlanJournal(base, {
    timestamp: PRE_CUTOFF,
    cycle: 0,
    transition: "NOT_STARTED -> COMPLETE",
    evidence: "journal fallback close-out",
    nextState: "COMPLETE",
  });
  // No provenance.producedAt; the filename is post-cutoff, so only the journal
  // timestamp can grandfather the record (as historical plans rely on).
  delete closed.provenance.producedAt;
  writePlan(root, "2026-09-20-journal-goal-csm.json", closed);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.deepEqual(report.findings, []);
  assert.equal(report.completionGrandfathered, 1);
});

test("a csm-plan/2 record with no determinable timestamp still fails closed", async (t) => {
  const root = await makeRepo(t);
  const record = createPlanArtifact({
    schemaRevision: 2,
    planId: "undated-goal",
    status: "in_progress",
    provenance: { producedAt: ACTIVE },
    control: { blockers: [] },
    tasks: [task("T001", "completed")],
  });
  // No provenance timestamp, no journal timestamp, and a filename without a
  // date prefix: the record is otherwise active, so the anti-bypass must hold.
  delete record.provenance.producedAt;
  writePlan(root, "undated-csm.json", record);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  assert.match(
    report.findings.join("\n"),
    /undated-csm\.json: completion evidence: completed-task-missing-receipt/,
  );
});

test("unreadable and malformed records fail closed", async (t) => {
  const root = await makeRepo(t);
  fs.writeFileSync(
    path.join(root, ".agents", "plans", "2026-09-20-unreadable-csm.json"),
    "{ not json",
  );
  writePlan(root, "2026-09-20-malformed-csm.json", { schema: "csm-plan/2", tasks: [] });

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  const findings = report.findings.join("\n");
  assert.match(findings, /unreadable-csm\.json: unreadable/);
  assert.match(findings, /malformed-csm\.json: invalid plan artifact/);
});
