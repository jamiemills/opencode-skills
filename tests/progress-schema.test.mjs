import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import matrix from "../schemas/compatibility-matrix.json" with { type: "json" };
import { canonicalize, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createCompatibilityRuntime } from "../lib/compatibility-runtime/index.mjs";
import { ORCHESTRATE_COMPATIBILITY_ADAPTERS } from "../csm-orchestrate/lib/compatibility.mjs";

const registry = await loadSchemaRegistry();
const compatibility = createCompatibilityRuntime({
  schemaRegistry: registry,
  matrix,
  adapters: ORCHESTRATE_COMPATIBILITY_ADAPTERS,
});
const timestamp = "2026-08-29T22:00:00Z";
const validProgress = {
  schema: "csm-progress/1",
  progressId: "progress-run-1",
  runId: "run-progress-1",
  graphRevision: 2,
  revision: 3,
  items: [
    {
      itemId: "item-phase-1-node-1",
      phaseId: "phase-main-1",
      nodeId: "node-1",
      graphRevision: 2,
      skill: "csm-build",
      weight: 2,
      state: "active",
      verifiedFraction: 0,
      attempt: 2,
      childRunId: "run-child-1",
      evidenceRefs: ["ev-progress-1"],
      receiptId: null,
      blocker: null,
    },
  ],
  aggregate: {
    plannedProgress: 0,
    observedWork: 1,
    outcome: "active",
    counts: { pending: 0, active: 1, verified: 0, failed: 0, blocked: 0, incomplete: 0 },
    eventsObserved: 4,
  },
  updatedAt: timestamp,
};

test("csm-progress/1 represents graph-bound retry lineage and aggregate state", () => {
  const result = registry.validate("csm-progress/1", validProgress);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(compatibility.negotiate("csm-progress", 1, 1).mode, "direct");
});

test("empty canonical progress has null plannedProgress", () => {
  const empty = structuredClone(validProgress);
  empty.items = [];
  empty.aggregate = {
    plannedProgress: null,
    observedWork: 0,
    outcome: "indeterminate",
    counts: { pending: 0, active: 0, verified: 0, failed: 0, blocked: 0, incomplete: 0 },
    eventsObserved: 0,
  };
  assert.equal(registry.validate("csm-progress/1", empty).valid, true);
});

test("canonical progress serialization is stable and does not depend on property order", () => {
  const reordered = { updatedAt: timestamp, ...structuredClone(validProgress) };
  assert.equal(canonicalize(validProgress), canonicalize(reordered));
});

test("malformed state, duplicate items, invalid weights, and unknown revisions fail closed", () => {
  for (const [field, value] of [
    ["state", "running"],
    ["weight", 0],
    ["verifiedFraction", 1.1],
  ]) {
    const invalid = structuredClone(validProgress);
    invalid.items[0][field] = value;
    assert.equal(registry.validate("csm-progress/1", invalid).valid, false, field);
  }
  const duplicate = structuredClone(validProgress);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.equal(registry.validate("csm-progress/1", duplicate).valid, false);
  assert.throws(() => registry.resolve("csm-progress", 2), /unknown schema revision/);
  assert.throws(() => compatibility.negotiate("csm-progress", 1, 2), /unknown schema revision/);
});

test("closed progress objects reject extra and missing fields", () => {
  const extra = structuredClone(validProgress);
  extra.items[0].unexpected = true;
  assert.equal(registry.validate("csm-progress/1", extra).valid, false);
  const missing = structuredClone(validProgress);
  delete missing.items[0].blocker;
  assert.equal(registry.validate("csm-progress/1", missing).valid, false);
});

test("progress remains separate from receipt v2", async () => {
  const receipt = await readFile(
    new URL("../csm-orchestrate/schemas/receipt.v2.schema.json", import.meta.url),
    "utf8",
  );
  assert.equal(JSON.parse(receipt).$id, "csm-orchestrate-receipt/2");
  const invalid = structuredClone(validProgress);
  invalid.receiptId = "receipt-not-a-progress-field";
  assert.equal(registry.validate("csm-progress/1", invalid).valid, false);
});
