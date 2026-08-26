import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPlanArtifact } from "../csm-plan/lib/plan.mjs";
import { createBddPackage } from "../csm-bdd-tdd/lib/package.mjs";
import { resolveBddInput } from "../csm-build/lib/bdd-input-resolver.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

test("build replays a JSON BDD package only with matching source-plan lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-bdd-build-"));
  try {
    const plan = createPlanArtifact({ planId: "bdd-source", runId: "run-source-plan" });
    const sourcePath = ".agents/plans/source-csm.json";
    const packagePath = "specs/example/package.json";
    await mkdir(join(root, ".agents/plans"), { recursive: true });
    await mkdir(join(root, "specs/example"), { recursive: true });
    await writeFile(join(root, sourcePath), JSON.stringify(plan));
    await writeFile(
      join(root, packagePath),
      JSON.stringify(
        createBddPackage({
          sourcePlan: {
            artifactId: plan.artifactId,
            runId: plan.runId,
            schema: "csm-plan/1",
            path: sourcePath,
            digest: digest(plan),
          },
        }),
      ),
    );
    const resolved = await resolveBddInput(packagePath, { root });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.sourcePlan.value.planId, "bdd-source");
    await writeFile(
      join(root, "specs/example/collision.json"),
      JSON.stringify(
        createBddPackage({
          sourcePlan: {
            artifactId: "art-collision",
            runId: plan.runId,
            schema: "csm-plan/1",
            path: "specs/example/collision.json",
            digest: digest(plan),
          },
        }),
      ),
    );
    assert.equal(
      (await resolveBddInput("specs/example/collision.json", { root })).code,
      "source-plan-collision",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build rejects source-plan collisions, mismatched run IDs, missing links, and projections", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-bdd-negative-"));
  try {
    const plan = createPlanArtifact({ planId: "bdd-source", runId: "run-source-plan" });
    const sourcePath = ".agents/plans/source-csm.json";
    await mkdir(join(root, ".agents/plans"), { recursive: true });
    await mkdir(join(root, "specs"), { recursive: true });
    await writeFile(join(root, sourcePath), JSON.stringify(plan));
    const mismatch = createBddPackage({
      sourcePlan: {
        artifactId: plan.artifactId,
        runId: "run-other",
        schema: "csm-plan/1",
        path: sourcePath,
        digest: digest(plan),
      },
    });
    await writeFile(join(root, "specs/package.json"), JSON.stringify(mismatch));
    assert.equal(
      (await resolveBddInput("specs/package.json", { root })).code,
      "source-plan-lineage-mismatch",
    );
    assert.equal((await resolveBddInput("specs/legacy.md", { root })).code, "migration-required");
    assert.equal(
      (await resolveBddInput({ schema: "csm-projection/1" }, { root })).code,
      "projection-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
