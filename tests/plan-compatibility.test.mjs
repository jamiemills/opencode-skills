import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createPlanArtifact,
  readPlanArtifact,
  validatePlanArtifact,
} from "../csm-plan/lib/plan.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("legacy Markdown plans require explicit migration", async () => {
  await assert.rejects(
    () =>
      readPlanArtifact(
        join(root, ".agents/plans/2026-08-25-json-only-rendered-skill-outputs-csm.md"),
      ),
    { code: "migration-required" },
  );
});

test("unknown plan schema revisions fail closed", async () => {
  const unknown = { ...createPlanArtifact({ planId: "unknown-version" }), schema: "csm-plan/99" };
  assert.equal(validatePlanArtifact(unknown).valid, false);
  assert.ok(
    validatePlanArtifact(unknown).errors.some((error) =>
      error.includes("must be equal to constant"),
    ),
  );
});
