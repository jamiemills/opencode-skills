import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPlanArtifact, writePlanArtifact } from "../csm-plan/lib/plan.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";

test("plan consumer replays only the canonical JSON descriptor", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-plan-consumer-"));
  try {
    const plan = createPlanArtifact({ planId: "consumer-replay" });
    await writePlanArtifact(
      join(root, ".agents", "plans", "2026-08-25-consumer-replay-csm.json"),
      plan,
    );
    const planPath = ".agents/plans/2026-08-25-consumer-replay-csm.json";
    const resolved = await resolvePlanInput("plan", planPath, { root });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.schema, "csm-plan/1");
    assert.equal(resolved.value.planId, "consumer-replay");
    assert.equal((await resolvePlanInput("plan", "plan.md", { root })).code, "migration-required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
