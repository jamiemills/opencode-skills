import assert from "node:assert/strict";
import test from "node:test";
import { orchestrate } from "../csm-orchestrate/index.mjs";

test("orchestration requires an explicitly injected executor after CLI migration", async () => {
  const result = await orchestrate({ approach: { runId: "run-migration" } });
  assert.equal(result.outcome.status, "BLOCKED");
  assert.equal(result.reason, "executor-required");
  assert.equal(result.childReceipts.length, 0);
});
