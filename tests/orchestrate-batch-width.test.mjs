import assert from "node:assert/strict";
import test from "node:test";
import { classifyConcurrency, selectParallelBatch } from "../csm-orchestrate/lib/recovery.mjs";

const readOnly = (nodeId, skill, extra = {}) => ({
  nodeId,
  skill,
  ordering: 1,
  parallelism: "independent-read-only",
  sideEffects: ["read-only"],
  dependencies: [],
  ...extra,
});

const serial = (nodeId, skill) => ({
  nodeId,
  skill,
  ordering: 1,
  sideEffects: ["workspace-write"],
  dependencies: [],
});

test("serial route nodes always select a single node", () => {
  assert.equal(selectParallelBatch([serial("edge-a", "csm-build")]).length, 1);
  assert.equal(
    selectParallelBatch([serial("edge-a", "csm-build"), serial("edge-b", "csm-review")], {
      maxParallelism: 4,
    }).length,
    1,
  );
});

test("parallel read-only batches are capped by maxParallelism and node count", () => {
  const ready = [
    readOnly("edge-a", "csm-review"),
    readOnly("edge-b", "csm-review"),
    readOnly("edge-c", "csm-review"),
  ];
  assert.equal(selectParallelBatch(ready, { maxParallelism: 4 }).length, 3);
  assert.equal(selectParallelBatch(ready, { maxParallelism: 2 }).length, 2);
  assert.equal(selectParallelBatch(ready, { maxParallelism: 1 }).length, 1);
});

test("per-skill bounds cap that skill without throttling other skills", () => {
  const ready = [
    readOnly("edge-a", "csm-review"),
    readOnly("edge-b", "csm-review"),
    readOnly("edge-c", "csm-scan"),
  ];
  const capabilities = { skills: [{ skill: "csm-review", bounds: { maxConcurrency: 1 } }] };
  const batch = selectParallelBatch(ready, { maxParallelism: 4, capabilities });
  assert.equal(batch.length, 2);
  assert.equal(batch.filter((node) => node.skill === "csm-review").length, 1);
  assert.equal(batch.filter((node) => node.skill === "csm-scan").length, 1);
});

test("selectParallelBatch rejects a non-positive or non-integer maxParallelism", () => {
  const ready = [readOnly("edge-a", "csm-review")];
  assert.throws(() => selectParallelBatch(ready, { maxParallelism: 0 }), /positive integer/);
  assert.throws(() => selectParallelBatch(ready, { maxParallelism: 2.5 }), /positive integer/);
});

// T002: bounded writable parallel workers are deferred (see the task report).
// Until per-worker worktrees with serialized ff-only integration and a
// worktree isolation tier are wired, the serial-writable guard must stay
// fail-closed: a writable node can never be admitted to the read-only batch,
// no matter what concurrency hint it carries or how wide maxParallelism is.

test("T002: a writable node cannot launder itself into the read-only batch via a read-only claim", () => {
  const liar = {
    nodeId: "edge-liar",
    skill: "csm-build",
    ordering: 1,
    parallelism: "independent-read-only",
    sideEffects: ["workspace-write"],
    dependencies: [],
  };
  assert.equal(classifyConcurrency([liar]).mode, "serial");
  assert.equal(selectParallelBatch([liar], { maxParallelism: 4 }).length, 1);
});

test("T002: any writable node in the ready set makes the whole batch serial", () => {
  const ready = [
    readOnly("edge-a", "csm-review"),
    readOnly("edge-b", "csm-review"),
    serial("edge-c", "csm-build"),
  ];
  assert.equal(classifyConcurrency(ready).mode, "serial");
  assert.equal(selectParallelBatch(ready, { maxParallelism: 4 }).length, 1);
});

test("T002: a read-only parallelGroup hint on a writable node does not widen the batch", () => {
  const hinted = {
    nodeId: "edge-hinted",
    skill: "csm-make-tests",
    ordering: 1,
    parallelGroup: "read-only",
    sideEffects: ["workspace-write"],
    dependencies: [],
  };
  assert.equal(classifyConcurrency([hinted]).mode, "serial");
  assert.equal(selectParallelBatch([hinted], { maxParallelism: 4 }).length, 1);
});

test("T002: non-read-only side effects of any kind keep a node out of the read-only batch", () => {
  const browser = {
    nodeId: "edge-browser",
    skill: "csm-browse",
    ordering: 1,
    parallelism: "independent-read-only",
    sideEffects: ["browser-session", "workspace-write"],
    dependencies: [],
  };
  assert.equal(classifyConcurrency([browser]).mode, "serial");
  assert.equal(selectParallelBatch([browser], { maxParallelism: 4 }).length, 1);
});

test("T002: unknown or worktree-declared parallelism modes fail closed to serial", () => {
  for (const mode of ["independent-workspace-write", "worktree-write", "parallel", "independent"]) {
    const node = {
      nodeId: "edge-unknown",
      skill: "csm-build",
      ordering: 1,
      parallelism: mode,
      sideEffects: ["read-only"],
      dependencies: [],
    };
    assert.equal(classifyConcurrency([node]).mode, "serial", `mode ${mode} must be serial`);
    assert.equal(
      selectParallelBatch([node], { maxParallelism: 8 }).length,
      1,
      `mode ${mode} must select one node`,
    );
  }
});

test("T002: per-skill bounds cannot widen a serial writable set", () => {
  const ready = [serial("edge-a", "csm-build"), serial("edge-b", "csm-build")];
  const capabilities = { skills: [{ skill: "csm-build", bounds: { maxConcurrency: 8 } }] };
  assert.equal(selectParallelBatch(ready, { maxParallelism: 8, capabilities }).length, 1);
});
