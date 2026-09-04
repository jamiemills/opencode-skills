import assert from "node:assert/strict";
import test from "node:test";
import { rollupChildProgress } from "../csm-orchestrate/lib/progress-rollup.mjs";
import { createProgressTracker } from "../csm-orchestrate/lib/progress.mjs";

function tracker(phaseId, nodeId) {
  const t = createProgressTracker({
    runId: "run-rollup-test",
    now: () => "2026-09-04T20:00:00.000Z",
  });
  t.materialize([
    {
      phaseId,
      graphRevision: 1,
      routeNodes: [{ nodeId, skill: "csm-browse", ordering: 0, dependencies: [] }],
      approvalScope: [],
      idempotency: { key: "k" },
      requirementIds: [],
      acceptanceSignalIds: [],
    },
  ]);
  return t;
}

function record(overrides = {}) {
  return {
    schema: "csm-skill-progress/1",
    progressId: "progress-child-goal",
    runId: "run-20260904t200000z-child",
    skill: "csm-browse",
    goal: "child work",
    status: "active",
    overallPercent: 60,
    milestones: [
      { id: "M1", title: "A", weightPercent: 40, status: "complete" },
      { id: "M2", title: "B", weightPercent: 20, status: "complete" },
      { id: "M3", title: "C", weightPercent: 40, status: "active", verifiedFraction: 0 },
    ],
    startedAt: "2026-09-04T19:00:00.000Z",
    updatedAt: "2026-09-04T20:00:00.000Z",
    ...overrides,
  };
}

test("rollup maps overallPercent onto non-terminal verifiedFraction and adds evidence ref", async () => {
  const t = tracker("phase-p1", "node-n1");
  const result = await rollupChildProgress({
    progressTracker: t,
    phaseId: "phase-p1",
    nodeId: "node-n1",
    record: record(),
  });
  assert.equal(result.status, "rolled-up");
  assert.equal(result.fraction, 0.6);
  const item = t.snapshot.items.find((i) => i.nodeId === "node-n1");
  assert.equal(item.verifiedFraction, 0.6);
  assert.ok(item.evidenceRefs.some((ref) => ref.startsWith("skill-progress:progress-child-goal@")));
  assert.equal(item.state, "pending");
});

test("rollup skips terminal items without mutation", async () => {
  const t = tracker("phase-p1", "node-n1");
  const itemId = t.itemId("phase-p1", "node-n1");
  await t.update(itemId, { state: "verified", verifiedFraction: 1 });
  const before = t.snapshot.items[0];
  const result = await rollupChildProgress({
    progressTracker: t,
    phaseId: "phase-p1",
    nodeId: "node-n1",
    record: record(),
  });
  assert.equal(result.status, "skipped-terminal");
  assert.deepEqual(t.snapshot.items[0], before);
});

test("rollup fails closed on an invalid child record", async () => {
  const t = tracker("phase-p1", "node-n1");
  await assert.rejects(
    () =>
      rollupChildProgress({
        progressTracker: t,
        phaseId: "phase-p1",
        nodeId: "node-n1",
        record: record({ overallPercent: 99 }),
      }),
    /invalid child skill-progress record/,
  );
});

test("rollup skips unknown nodeIds", async () => {
  const t = tracker("phase-p1", "node-n1");
  const result = await rollupChildProgress({
    progressTracker: t,
    phaseId: "phase-p1",
    nodeId: "node-does-not-exist",
    record: record(),
  });
  assert.equal(result.status, "skipped-unknown-node");
});
