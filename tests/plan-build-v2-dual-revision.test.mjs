// T002/P2a: additive csm-plan/2 + csm-build-state/2 schemas and dual-revision
// readers. Proves the /2 records validate (typed supersession + terminal
// superseded), that every named /1 consumer reads both revisions, that the
// build-state cursor accepts any declared transition of the current state, and
// that previously-valid /1 artifacts are unaffected.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  PLAN_SCHEMA,
  PLAN_SCHEMA_V2,
  EVALUATOR_CONTRACT,
  createPlanArtifact,
  validatePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import "./helpers/trace-isolation.mjs";
import {
  BUILD_SCHEMA,
  BUILD_SCHEMA_V2,
  createBuildState,
  supersedeBuildState,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";
import { resolveBddInput } from "../csm-build/lib/bdd-input-resolver.mjs";
import { intakeArtifact } from "../csm-orchestrate/lib/intake.mjs";
import {
  PLAN_SOURCE_SCHEMAS,
  createBddPackage,
  isSupportedPlanSchema,
  validateBddPackage,
} from "../csm-bdd-tdd/lib/package.mjs";
import { planFormatVersionAccepted } from "../scripts/check-suite.mjs";
import { loadSchemaRegistry, digest } from "../lib/schema-runtime/index.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const successorPointer = {
  artifactId: "art-successor",
  runId: "run-successor",
  schema: PLAN_SCHEMA_V2,
  digest: `sha256:${"a".repeat(64)}`,
  path: ".agents/plans/2026-09-19-successor-csm.json",
};

function supersededPlan(overrides = {}) {
  return createPlanArtifact({
    planId: "superseded-plan",
    schemaRevision: 2,
    status: "superseded",
    control: { currentState: "STOP", nextTransition: "none; closed as superseded" },
    supersession: {
      supersededBy: successorPointer,
      supersededAt: "2026-09-19T00:00:00Z",
      reason: "successor plan created",
    },
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" }],
    journal: [
      {
        sequence: 0,
        timestamp: "2026-09-19T00:00:00Z",
        cycle: 0,
        transition: "SAVED -> STOP",
        evidence: "closed as superseded",
        nextState: "STOP",
      },
    ],
    ...overrides,
  });
}

function buildStateV2() {
  return createBuildState({
    runId: "run-build-v2",
    artifactId: "art-build-v2",
    sourcePlan: { artifactId: "art-plan", digest: `sha256:${"b".repeat(64)}` },
    schemaRevision: 2,
  });
}

test("csm-plan/2 validates a typed supersession and terminal superseded status", () => {
  const plan = supersededPlan();
  assert.equal(plan.schema, PLAN_SCHEMA_V2);
  assert.equal(plan.schemaRevision, 2);
  assert.equal(plan.status, "superseded");
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });

  const missingPointer = supersededPlan();
  delete missingPointer.supersession;
  assert.equal(validatePlanArtifact(missingPointer).valid, false);
  assert.ok(
    validatePlanArtifact(missingPointer).errors.some((error) => error.includes("supersession")),
  );

  const wrongCursor = supersededPlan();
  wrongCursor.control.currentState = "COMPLETE";
  assert.equal(validatePlanArtifact(wrongCursor).valid, false);
});

test("csm-plan/1 rejects the /2-only superseded status (schema stays frozen)", () => {
  const plan = createPlanArtifact({ planId: "v1-not-superseded" });
  assert.equal(plan.schema, PLAN_SCHEMA);
  const forced = {
    ...plan,
    status: "superseded",
    control: { ...plan.control, status: "superseded" },
  };
  assert.equal(validatePlanArtifact(forced).valid, false);
});

test("csm-build-state/2 validates and closes as terminal superseded", () => {
  const state = buildStateV2();
  assert.equal(state.schema, BUILD_SCHEMA_V2);
  assert.deepEqual(validateBuildState(state), { valid: true, errors: [] });

  const superseded = supersedeBuildState(state, {
    supersededBy: { artifactId: "art-next", runId: "run-next", schema: BUILD_SCHEMA_V2 },
    reason: "superseded by the replacement build",
  });
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.control.currentState, "SUPERSEDED");
  assert.equal(superseded.control.nextTransition, "none (terminal)");
  assert.equal(superseded.journal.at(-1).to, "SUPERSEDED");
  assert.deepEqual(validateBuildState(superseded), { valid: true, errors: [] });

  const withoutPointer = structuredClone(superseded);
  delete withoutPointer.supersession;
  assert.equal(validateBuildState(withoutPointer).valid, false);
});

test("every named /1 consumer reads both csm-plan revisions", async () => {
  const registry = await loadSchemaRegistry();
  assert.equal(registry.resolve("csm-plan", 1).id, PLAN_SCHEMA);
  assert.equal(registry.resolve("csm-plan", 2).id, PLAN_SCHEMA_V2);

  // csm-plan/lib/plan.mjs
  const planV1 = createPlanArtifact({ planId: "dual-plan-v1" });
  const planV2 = createPlanArtifact({ planId: "dual-plan-v2", schemaRevision: 2 });
  assert.equal(validatePlanArtifact(planV1).valid, true);
  assert.equal(validatePlanArtifact(planV2).valid, true);
  assert.equal(registry.validate(PLAN_SCHEMA, planV1).valid, true);
  assert.equal(registry.validate(PLAN_SCHEMA_V2, planV2).valid, true);
  assert.equal(registry.validate(PLAN_SCHEMA_V2, supersededPlan()).valid, true);

  // csm-plan/lib/input-resolver.mjs
  const root = await mkdtemp(join(tmpdir(), "csm-plan-dual-"));
  try {
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    await writeFile(
      join(root, ".agents", "plans", "2026-09-19-dual-v1-csm.json"),
      JSON.stringify(planV1),
    );
    await writeFile(
      join(root, ".agents", "plans", "2026-09-19-dual-v2-csm.json"),
      JSON.stringify(planV2),
    );
    const resolvedV1 = await resolvePlanInput("plan", ".agents/plans/2026-09-19-dual-v1-csm.json", {
      root,
    });
    const resolvedV2 = await resolvePlanInput("plan", ".agents/plans/2026-09-19-dual-v2-csm.json", {
      root,
    });
    assert.equal(resolvedV1.status, "resolved");
    assert.equal(resolvedV1.schema, PLAN_SCHEMA);
    assert.equal(resolvedV2.status, "resolved");
    assert.equal(resolvedV2.schema, PLAN_SCHEMA_V2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("csm-build state and bdd readers accept both plan revisions", async () => {
  const sourcePlan = { artifactId: "art-plan", digest: `sha256:${"c".repeat(64)}` };
  const stateV1 = createBuildState({ runId: "run-build-1", sourcePlan });
  assert.equal(stateV1.schema, BUILD_SCHEMA);
  assert.equal(validateBuildState(stateV1).valid, true);
  assert.equal(validateBuildState(buildStateV2()).valid, true);
  const registry = await loadSchemaRegistry();
  assert.equal(registry.validate(BUILD_SCHEMA, stateV1).valid, true);
  assert.equal(registry.validate(BUILD_SCHEMA_V2, buildStateV2()).valid, true);

  const root = await mkdtemp(join(tmpdir(), "csm-build-dual-"));
  try {
    const planV2 = createPlanArtifact({
      planId: "bdd-dual",
      schemaRevision: 2,
      runId: "run-bdd-dual",
    });
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    await mkdir(join(root, "specs", "example"), { recursive: true });
    await writeFile(join(root, ".agents", "plans", "source-csm.json"), JSON.stringify(planV2));
    const packageV2Pointer = createBddPackage({
      sourcePlan: {
        artifactId: planV2.artifactId,
        runId: planV2.runId,
        schema: PLAN_SCHEMA,
        path: ".agents/plans/source-csm.json",
        digest: digest(planV2),
      },
    });
    await writeFile(
      join(root, "specs", "example", "package.json"),
      JSON.stringify(packageV2Pointer),
    );
    const resolved = await resolveBddInput("specs/example/package.json", { root });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.sourcePlan.value.schema, PLAN_SCHEMA_V2);
    assert.equal(resolved.sourcePlan.schema, PLAN_SCHEMA_V2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("csm-orchestrate intake classifies both plan markers and refuses unknown revisions", async () => {
  const markerV1 = await intakeArtifact({
    schema: PLAN_SCHEMA,
    planId: "intake-v1",
    runId: "run-intake-v1",
  });
  const markerV2 = await intakeArtifact({
    schema: PLAN_SCHEMA_V2,
    planId: "intake-v2",
    runId: "run-intake-v2",
  });
  assert.equal(markerV1.kind, "plan");
  assert.equal(markerV2.kind, "plan");
  await assert.rejects(
    () => intakeArtifact({ schema: "csm-plan/99", planId: "intake-v99", runId: "run-intake-v99" }),
    /unsupported schema marker/,
  );
});

test("csm-bdd-tdd package accepts both source-plan revisions", () => {
  assert.deepEqual(PLAN_SOURCE_SCHEMAS, [PLAN_SCHEMA, PLAN_SCHEMA_V2]);
  assert.equal(isSupportedPlanSchema(PLAN_SCHEMA), true);
  assert.equal(isSupportedPlanSchema(PLAN_SCHEMA_V2), true);
  assert.equal(isSupportedPlanSchema("csm-plan/99"), false);
  assert.equal(validateBddPackage(createBddPackage()).valid, true);
  const packageV2 = createBddPackage({
    sourcePlan: {
      artifactId: "art-source",
      runId: "run-source-plan",
      schema: PLAN_SCHEMA_V2,
      path: ".agents/plans/source-csm.json",
      digest: `sha256:${"d".repeat(64)}`,
    },
  });
  assert.equal(packageV2.sourcePlan.schema, PLAN_SCHEMA_V2);
  assert.equal(validateBddPackage(packageV2).valid, true);
});

test("run-orchestrator classifies a /2 plan envelope as a plan route", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-driver-dual-"));
  try {
    const path = join(root, "plan.json");
    await writeFile(path, JSON.stringify(supersededPlan()));
    const env = { ...process.env };
    delete env.CSM_AGENT_SESSION_EXEC;
    const result = spawnSync(process.execPath, ["scripts/run-orchestrator.mjs", "--plan", path], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an agent session/);
    assert.doesNotMatch(result.stderr, /requires a plan artifact/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("check-suite and capabilities treat /2 as an accepted plan revision", async () => {
  assert.equal(planFormatVersionAccepted(1), true);
  assert.equal(planFormatVersionAccepted(2), true);
  assert.equal(planFormatVersionAccepted(3), false);

  const capabilities = JSON.parse(
    await readFile(join(ROOT, "csm-orchestrate", "capabilities.json"), "utf8"),
  );
  const planRevisionFields = [];
  for (const capability of capabilities.skills) {
    for (const input of capability.inputs ?? [])
      if (input.schema?.startsWith("csm-plan"))
        planRevisionFields.push(`${capability.skill}:in:${input.schema}`);
    for (const output of capability.outputs ?? [])
      if (output.schema?.startsWith("csm-plan"))
        planRevisionFields.push(`${capability.skill}:out:${output.schema}`);
  }
  assert.deepEqual(planRevisionFields.toSorted(), [
    "csm-bdd-tdd:in:csm-plan/2",
    "csm-build:in:csm-plan/2",
    "csm-plan:out:csm-plan/2",
  ]);

  const matrix = JSON.parse(
    await readFile(join(ROOT, "schemas", "compatibility-matrix.json"), "utf8"),
  );
  const planCompat = matrix.entries.find(
    (entry) =>
      entry.schema === "csm-plan" && entry.producerRevision === 1 && entry.consumerRevision === 2,
  );
  assert.equal(planCompat?.status, "compatible");
});

test("build-state cursor accepts any declared transition of the current state", () => {
  const sourcePlan = { artifactId: "art-plan", digest: `sha256:${"e".repeat(64)}` };
  const checkpoint = () => {
    let value = createBuildState({ sourcePlan });
    value = transitionBuildState(value, "VALIDATE");
    value = transitionBuildState(value, "SELECT");
    return transitionBuildState(value, "CHECKPOINT");
  };

  for (const next of ["CHECKPOINT -> SELECT", "CHECKPOINT -> COMPLETE", "CHECKPOINT -> BLOCKED"]) {
    const value = checkpoint();
    value.control.nextTransition = next;
    assert.equal(validateBuildState(value).valid, true, next);
  }

  const illegal = checkpoint();
  illegal.control.nextTransition = "CHECKPOINT -> VERIFY";
  assert.equal(validateBuildState(illegal).valid, false);

  // /1 regression: the first declared transition still validates.
  const firstExit = checkpoint();
  assert.equal(firstExit.control.nextTransition, "CHECKPOINT -> SELECT");
  assert.equal(validateBuildState(firstExit).valid, true);
});

test("evaluator contract is documented and binding", () => {
  assert.equal(EVALUATOR_CONTRACT.format, "csm-evaluator-contract/1");
  assert.deepEqual(EVALUATOR_CONTRACT.inputs, ["control", "goal", "acceptance"]);
  assert.deepEqual(EVALUATOR_CONTRACT.outputs, ["continue", "complete", "blocked"]);
  assert.match(EVALUATOR_CONTRACT.binding, /binds the loop cursor/);
  assert.equal(EVALUATOR_CONTRACT.receipt, "journaled");
});

test("previously-valid /1 artifacts are not regressed", () => {
  const planV1 = createPlanArtifact({ planId: "regression-v1" });
  assert.equal(validatePlanArtifact(planV1).valid, true);
  const stateV1 = createBuildState({
    sourcePlan: { artifactId: "art-plan", digest: `sha256:${"f".repeat(64)}` },
  });
  assert.equal(validateBuildState(stateV1).valid, true);
});
