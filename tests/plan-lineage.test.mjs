import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  appendPlanJournal,
  createPlanArtifact,
  readPlanArtifact,
  writePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import { canonicalize, digest } from "../lib/schema-runtime/index.mjs";
import { validatePlanLineage } from "../scripts/validate-plan-lineage.mjs";

const ACTIVE = "2026-09-20T00:00:00.000Z";
const LEGACY = "2026-08-01T00:00:00.000Z";

async function makeRepo(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "csm-plan-lineage-"));
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
  return {
    taskId,
    ordinal: Number(taskId.slice(1)),
    status,
    acceptanceSignal: "test -n ok",
  };
}

function readyPlan({
  planId = "demo-goal",
  tasks = [task("T001")],
  producedAt = ACTIVE,
  blockers = [],
} = {}) {
  return createPlanArtifact({
    planId,
    status: "in_progress",
    provenance: { producedAt },
    control: { blockers },
    tasks,
  });
}

function completePlan({
  planId = "demo-goal",
  tasks = [task("T001", "completed")],
  producedAt = ACTIVE,
  blockers = [],
} = {}) {
  const base = createPlanArtifact({
    planId,
    status: "in_progress",
    provenance: { producedAt },
    control: { blockers },
    tasks,
  });
  return appendPlanJournal(base, {
    timestamp: producedAt,
    cycle: 0,
    transition: "NOT_STARTED -> COMPLETE",
    evidence: "goal closed",
    nextState: "COMPLETE",
  });
}

function supersededPlan({
  planId = "demo-goal",
  open = ["T001"],
  successorPath,
  producedAt = ACTIVE,
  blockers = [],
} = {}) {
  return createPlanArtifact({
    schemaRevision: 2,
    planId,
    status: "superseded",
    provenance: { producedAt },
    control: {
      currentState: "STOP",
      nextTransition: "none; closed as superseded",
      status: "superseded",
      blockers,
    },
    supersession: {
      supersededBy: {
        artifactId: `art-${"a".repeat(32)}`,
        runId: `run-${"b".repeat(32)}`,
        schema: "csm-plan/2",
        path: successorPath,
      },
      supersededAt: producedAt,
      reason: "superseded by successor plan",
    },
    tasks: open.map((id) => task(id)),
  });
}

test("compliant active goal passes (single plan and superseded->complete lineage)", async (t) => {
  const root = await makeRepo(t);
  writePlan(
    root,
    "2026-09-20-standalone-csm.json",
    readyPlan({ planId: "standalone-goal", tasks: [task("T001"), task("T002")] }),
  );
  writePlan(
    root,
    "2026-09-20-lineage-pred-csm.json",
    supersededPlan({
      planId: "lineage-goal",
      open: ["T001", "T002"],
      successorPath: ".agents/plans/2026-09-20-lineage-succ-csm.json",
    }),
  );
  writePlan(
    root,
    "2026-09-20-lineage-succ-csm.json",
    completePlan({
      planId: "lineage-goal",
      tasks: [task("T001", "completed"), task("T002", "completed")],
    }),
  );

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.equal(report.checked, 3);
  assert.deepEqual(report.findings, []);
});

test("terminal (complete) plan retaining a blocker fails", async (t) => {
  const root = await makeRepo(t);
  writePlan(
    root,
    "2026-09-20-blocker-csm.json",
    completePlan({
      planId: "blocker-goal",
      tasks: [task("T001", "completed")],
      blockers: ["release gate unsatisfied"],
    }),
  );

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /terminal \(complete\) plan retains 1 control\.blocker/);
});

test("superseded plan whose successor omits an open task fails", async (t) => {
  const root = await makeRepo(t);
  writePlan(
    root,
    "2026-09-20-forward-pred-csm.json",
    supersededPlan({
      planId: "forward-goal",
      open: ["T001", "T002"],
      successorPath: ".agents/plans/2026-09-20-forward-succ-csm.json",
    }),
  );
  writePlan(
    root,
    "2026-09-20-forward-succ-csm.json",
    readyPlan({ planId: "forward-goal", tasks: [task("T001")] }),
  );

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /omits open task identity\/identities T002/);
});

test("legacy pre-cutoff plan is grandfathered, not parsed or checked", async (t) => {
  const root = await makeRepo(t);
  writePlan(
    root,
    "2026-08-01-legacy-csm.json",
    supersededPlan({
      planId: "legacy-goal",
      open: ["T001"],
      successorPath: ".agents/plans/does-not-exist-csm.json",
      producedAt: LEGACY,
      blockers: ["legacy blocker"],
    }),
  );

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, true, report.findings.join("; "));
  assert.equal(report.checked, 0);
  assert.equal(report.grandfathered, 1);
  assert.deepEqual(report.findings, []);
});

test("a plan with missing/invalid provenance.producedAt and pending work fails (not grandfathered)", async (t) => {
  const root = await makeRepo(t);

  // Terminal plans that retain a pending task and a blocker must be caught; a
  // missing/invalid producedAt cannot grandfather them out of the rules.
  const missing = completePlan({
    planId: "no-timestamp-goal",
    tasks: [task("T001")],
    blockers: ["unresolved"],
  });
  delete missing.provenance.producedAt;
  writePlan(root, "2026-09-20-no-timestamp-csm.json", missing);

  const invalid = completePlan({
    planId: "bad-timestamp-goal",
    tasks: [task("T001")],
    blockers: ["unresolved"],
  });
  invalid.provenance.producedAt = "yesterday";
  writePlan(root, "2026-09-20-bad-timestamp-csm.json", invalid);

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  assert.equal(report.grandfathered, 0, "missing/invalid producedAt is never grandfathered");
  const findings = report.findings.join("\n");
  assert.match(findings, /no-timestamp-csm\.json: terminal \(complete\) plan retains/);
  assert.match(findings, /bad-timestamp-csm\.json: terminal \(complete\) plan retains/);
});

test("two terminal complete plans for one goal fail the single-tip rule", async (t) => {
  const root = await makeRepo(t);
  writePlan(root, "2026-09-20-dup-a-csm.json", completePlan({ planId: "dup-goal" }));
  writePlan(root, "2026-09-20-dup-b-csm.json", completePlan({ planId: "dup-goal" }));

  const report = validatePlanLineage({ root });
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /2 terminal \(complete\) plans/);
});

test("digest regression: createPlanArtifact/writePlanArtifact round-trips through readPlanArtifact", async (t) => {
  const root = await makeRepo(t);
  const plan = createPlanArtifact({ planId: "digest-goal", tasks: [task("T001")] });
  const target = path.join(root, ".agents", "plans", "2026-09-21-digest-goal-csm.json");

  const written = await writePlanArtifact(target, plan);
  const read = await readPlanArtifact(target);

  assert.equal(read.digest, plan.digest);
  assert.match(written.digest, /^sha256:[a-f0-9]{64}$/);
  const payload = Object.fromEntries(Object.entries(read).filter(([key]) => key !== "digest"));
  assert.equal(read.digest, digest(payload));
  assert.equal(canonicalize(read).length > 0, true);
});
