import assert from "node:assert/strict";
import test from "node:test";
import { selectParallelBatch } from "../csm-orchestrate/lib/recovery.mjs";

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
