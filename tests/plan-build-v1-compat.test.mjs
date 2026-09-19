// T004/P2c: non-disruption guard for the additive csm-plan/2 +
// csm-build-state/2 revisions. The skills are used live by other agents, so
// this suite pins the frozen /1 contract: the /1 writer still emits
// byte-identical records, the /1 reader still accepts them, a previously-valid
// /1 artifact is neither regressed nor silently upgraded to /2, and the frozen
// /1 schema ids are still resolvable alongside the additive /2 ids.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PLAN_SCHEMA,
  PLAN_SCHEMA_V2,
  PLAN_SCHEMAS,
  appendPlanJournal,
  createPlan,
  createPlanArtifact,
  readPlan,
  readPlanArtifact,
  resumePlanArtifact,
  serializePlanArtifact,
  validatePlan,
  validatePlanArtifact,
  writePlan,
  writePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import {
  BUILD_SCHEMA,
  BUILD_SCHEMA_V2,
  BUILD_SCHEMAS,
  createBuildState,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

// Captured at the T004 baseline, before the additive /2 revision landed: the
// exact canonical bytes and digest the /1 writer must keep emitting.
const V1_PLAN_CANONICAL =
  '{"acceptanceCriteria":[],"applicability":null,"artifactId":"art-v1frozenplan","assumptionsAndDecisions":[],"completionReview":null,"control":{"activeTasks":[],"blockers":[],"commits":"disabled","currentState":"NOT_STARTED","cycle":0,"lastCheckpoint":"none","lastModelRun":"","nextTransition":"On a future explicit csm-build invocation, NOT_STARTED -> RECOVER","resume":{"instruction":"re-read control, latest journal, recovery notes, requirements, and working-tree diff"},"status":"ready"},"critiqueResolution":[],"currentStateEvidence":{},"design":{},"digest":"sha256:bdfe5f43fe314286600c519785a0e0d97da347a71b24876304a731f407140320","discoveredRequirements":[],"executionGraph":{},"goal":{},"inputs":[],"journal":[],"planId":"v1-frozen-plan","projection":{"legacyMarkdownStatus":"history-only","profile":"csm-plan-human/1"},"provenance":{"producedAt":"2026-09-19T00:00:00.000Z","producer":"csm-plan","producerVersion":"csm-plan/1","sourceDigests":[]},"rdRecord":[],"risksAndRecovery":{},"runId":"run-v1frozenplan","schema":"csm-plan/1","schemaRevision":1,"status":"ready","tasks":[{"acceptanceSignal":"node --test tests/plan-build-v1-compat.test.mjs","ordinal":1,"status":"pending","taskId":"T001"}],"verificationStrategy":{}}';
const V1_PLAN_DIGEST = "sha256:bdfe5f43fe314286600c519785a0e0d97da347a71b24876304a731f407140320";

const V1_PLAN_INPUT = {
  planId: "v1-frozen-plan",
  runId: "run-v1frozenplan",
  artifactId: "art-v1frozenplan",
  provenance: { producedAt: "2026-09-19T00:00:00.000Z" },
  tasks: [
    {
      taskId: "T001",
      ordinal: 1,
      status: "pending",
      acceptanceSignal: "node --test tests/plan-build-v1-compat.test.mjs",
    },
  ],
};

// A real git-committed csm-build-state/1 record (HEAD before the /2 migration):
// the strongest form of "previously-valid" evidence — it was written and
// accepted by the pre-/2 code.
const V1_BUILD_STATE = Object.freeze({
  schema: "csm-build-state/1",
  schemaRevision: 1,
  artifactId: "art-build-patch-reliability-20260830",
  runId: "run-20260830t073000z-patch-reliability-build",
  owner: "csm-build",
  status: "in_progress",
  control: {
    currentState: "RECOVER",
    cycle: 0,
    nextTransition: "RECOVER -> VALIDATE",
    activeTasks: [],
    blockers: [],
    lastCheckpoint: "2026-08-30T07:30:00Z: build recovered from csm-orchestrate compiled approach",
    lastModelRun: "gpt-5.6-luna / patch-reliability-build",
  },
  inputs: [
    {
      name: "plan",
      artifactId: "art-patch-reliability-20260830",
      schema: "csm-plan/1",
      runId: "run-20260830t071500z-patch-reliability",
      owner: "csm-plan",
      digest: "sha256:b2befb9946657a6312b8ac928c793fd235a34f940aadf8045336fa8bd2d54ca6",
      path: ".agents/plans/2026-08-30-patch-reliability-csm.json",
      status: "resolved",
    },
  ],
  journal: [
    {
      sequence: 0,
      timestamp: "2026-08-30T07:30:00Z",
      from: "NOT_STARTED",
      to: "RECOVER",
      evidence:
        "Recovered the explicit patch-reliability build request after csm-orchestrate compiled the repaired approach to csm-build-only phases.",
      inputDigests: [],
    },
  ],
  artifacts: [],
  completion: null,
  provenance: {
    sourcePlan: "art-patch-reliability-20260830",
    sourceDigests: ["sha256:b2befb9946657a6312b8ac928c793fd235a34f940aadf8045336fa8bd2d54ca6"],
  },
  projection: { sourceOnly: true, allowed: ["markdown", "html"] },
});

test("the frozen /1 plan writer still emits the baseline canonical bytes and digest", () => {
  const plan = createPlanArtifact(V1_PLAN_INPUT);
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.schemaRevision, 1);
  assert.equal(plan.digest, V1_PLAN_DIGEST);
  assert.equal(Object.hasOwn(plan, "supersession"), false, "/1 must not carry /2 fields");
  assert.equal(serializePlanArtifact(plan), `${V1_PLAN_CANONICAL}\n`);
  assert.equal(
    serializePlanArtifact(createPlanArtifact(V1_PLAN_INPUT)),
    serializePlanArtifact(plan),
  );
  assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });
});

test("the /1 plan round-trips through the old reader and writer paths unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-v1-compat-"));
  try {
    const plansDir = join(root, ".agents", "plans");
    await mkdir(plansDir, { recursive: true });
    const filename = join(plansDir, "2026-09-19-v1-frozen-plan-csm.json");

    const plan = createPlanArtifact(V1_PLAN_INPUT);
    await writePlanArtifact(filename, plan);
    const bytes = await readFile(filename, "utf8");
    assert.equal(bytes, `${V1_PLAN_CANONICAL}\n`, "the /1 writer must not perturb the bytes");

    const reread = await readPlanArtifact(filename);
    assert.equal(reread.schema, PLAN_SCHEMA);
    assert.equal(reread.schemaRevision, 1);
    assert.equal(reread.digest, V1_PLAN_DIGEST);
    assert.deepEqual(reread, plan, "read(write(/1)) must be identity");
    assert.equal(serializePlanArtifact(reread), bytes, "re-serialization must be byte-stable");

    // A second write to a fresh path must reproduce the frozen bytes exactly.
    const secondPath = join(plansDir, "2026-09-19-v1-frozen-plan-copy-csm.json");
    await writePlanArtifact(secondPath, reread);
    assert.equal(await readFile(secondPath, "utf8"), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a previously-valid /1 plan is not regressed or silently upgraded to /2", async () => {
  const registry = await loadSchemaRegistry();
  const frozen = JSON.parse(V1_PLAN_CANONICAL);

  assert.deepEqual(validatePlanArtifact(frozen), { valid: true, errors: [] });
  assert.equal(registry.validate(PLAN_SCHEMA, frozen).valid, true);
  assert.equal(
    registry.validate(PLAN_SCHEMA_V2, frozen).valid,
    false,
    "a /1 record must not validate as /2",
  );
  assert.equal(serializePlanArtifact(frozen), `${V1_PLAN_CANONICAL}\n`);

  // The old reader path resolves the frozen /1 record from disk.
  const root = await mkdtemp(join(tmpdir(), "csm-v1-resolve-"));
  try {
    const rel = ".agents/plans/2026-09-19-v1-frozen-plan-csm.json";
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    await writeFile(join(root, rel), `${V1_PLAN_CANONICAL}\n`);
    const resolved = await resolvePlanInput("plan", rel, { root });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.schema, PLAN_SCHEMA);
    assert.equal(resolved.value.digest, V1_PLAN_DIGEST);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the /1 plan journal and resume paths stay on revision 1", () => {
  const paused = appendPlanJournal(createPlanArtifact(V1_PLAN_INPUT), {
    timestamp: "2026-09-19T00:01:00.000Z",
    cycle: 0,
    transition: "NOT_STARTED -> PAUSED",
    evidence: "paused for the compatibility check",
    nextState: "PAUSED",
  });
  assert.equal(paused.schema, PLAN_SCHEMA);
  assert.equal(paused.schemaRevision, 1);

  const resumed = resumePlanArtifact(paused, { timestamp: "2026-09-19T00:02:00.000Z" });
  assert.equal(resumed.schema, PLAN_SCHEMA);
  assert.equal(resumed.schemaRevision, 1);
  assert.equal(resumed.control.currentState, "RECOVER");
  assert.equal(Object.hasOwn(resumed, "supersession"), false);
});

test("the committed /1 build state validates and transitions without leaving revision 1", async () => {
  const registry = await loadSchemaRegistry();
  assert.equal(V1_BUILD_STATE.schema, BUILD_SCHEMA);
  assert.equal(V1_BUILD_STATE.schemaRevision, 1);
  assert.deepEqual(validateBuildState(V1_BUILD_STATE), { valid: true, errors: [] });

  const advanced = transitionBuildState(V1_BUILD_STATE, "VALIDATE", { evidence: "compat check" });
  assert.equal(advanced.schema, BUILD_SCHEMA);
  assert.equal(advanced.schemaRevision, 1);
  assert.equal(advanced.journal.at(-1).to, "VALIDATE");
  assert.deepEqual(validateBuildState(advanced), { valid: true, errors: [] });
  assert.deepEqual(V1_BUILD_STATE.control.currentState, "RECOVER", "input must not be mutated");
  assert.equal(registry.validate(BUILD_SCHEMA, V1_BUILD_STATE).valid, true);
  assert.equal(
    registry.validate(BUILD_SCHEMA_V2, V1_BUILD_STATE).valid,
    false,
    "a /1 build state must not validate as /2",
  );
});

test("the /1 schema ids are frozen and the pre-/2 entry points remain callable", async () => {
  const registry = await loadSchemaRegistry();
  assert.equal(PLAN_SCHEMA, "csm-plan/1");
  assert.equal(PLAN_SCHEMA_V2, "csm-plan/2");
  assert.equal(BUILD_SCHEMA, "csm-build-state/1");
  assert.equal(BUILD_SCHEMA_V2, "csm-build-state/2");
  assert.deepEqual([...PLAN_SCHEMAS], [PLAN_SCHEMA, PLAN_SCHEMA_V2]);
  assert.deepEqual([...BUILD_SCHEMAS], [BUILD_SCHEMA, BUILD_SCHEMA_V2]);

  assert.equal(registry.resolve("csm-plan", 1).id, PLAN_SCHEMA);
  assert.equal(registry.resolve("csm-plan", 2).id, PLAN_SCHEMA_V2);
  assert.equal(registry.resolve("csm-build-state", 1).id, BUILD_SCHEMA);
  assert.equal(registry.resolve("csm-build-state", 2).id, BUILD_SCHEMA_V2);

  for (const entry of [createPlan, readPlan, writePlan, validatePlan, createPlanArtifact])
    assert.equal(typeof entry, "function");
  assert.equal(validatePlanArtifact, validatePlan);
  assert.equal(readPlanArtifact, readPlan);
  assert.equal(writePlanArtifact, writePlan);
  assert.equal(createPlanArtifact, createPlan);
});

async function loadRepoJson(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}

test("the /1 schemas stay frozen while /2 stays strictly additive", async () => {
  const planV1 = await loadRepoJson("../csm-plan/schemas/csm-plan.schema.json");
  const planV2 = await loadRepoJson("../csm-plan/schemas/csm-plan.v2.schema.json");
  const buildV1 = await loadRepoJson("../csm-build/schemas/state.schema.json");
  const buildV2 = await loadRepoJson("../csm-build/schemas/state.v2.schema.json");

  assert.equal(planV1.$id, PLAN_SCHEMA);
  assert.equal(planV1.properties.schema.const, PLAN_SCHEMA);
  assert.equal(Object.hasOwn(planV1.properties, "supersession"), false);
  assert.equal(planV1.properties.status.enum.includes("superseded"), false);
  assert.equal(planV2.$id, PLAN_SCHEMA_V2);
  assert.equal(planV2.properties.schema.const, PLAN_SCHEMA_V2);
  assert.ok(planV2.properties.supersession);
  assert.equal(planV2.properties.status.enum.includes("superseded"), true);

  assert.equal(buildV1.$id, BUILD_SCHEMA);
  assert.equal(buildV1.properties.schema.const, BUILD_SCHEMA);
  assert.equal(buildV1.$defs.control.properties.currentState.enum.includes("SUPERSEDED"), false);
  assert.equal(buildV2.$id, BUILD_SCHEMA_V2);
  assert.equal(buildV2.properties.schema.const, BUILD_SCHEMA_V2);
  assert.ok(buildV2.properties.supersession);
  assert.equal(buildV2.$defs.control.properties.currentState.enum.includes("SUPERSEDED"), true);
});

test("a /1 plan cannot absorb the /2-only supersession marker", () => {
  const forced = JSON.parse(V1_PLAN_CANONICAL);
  forced.supersession = {
    supersededBy: {
      artifactId: "art-successor",
      runId: "run-successor",
      schema: PLAN_SCHEMA_V2,
      digest: `sha256:${"a".repeat(64)}`,
      path: ".agents/plans/2026-09-19-successor-csm.json",
    },
    supersededAt: "2026-09-19T00:00:00Z",
    reason: "must not be accepted on /1",
  };
  assert.equal(validatePlanArtifact(forced).valid, false);

  assert.throws(
    () => createPlanArtifact({ ...V1_PLAN_INPUT, supersession: forced.supersession }),
    (error) => error instanceof TypeError,
  );
  assert.equal(
    createBuildState({
      sourcePlan: { artifactId: "art-plan", digest: `sha256:${"b".repeat(64)}` },
      schemaRevision: 2,
    }).schema,
    BUILD_SCHEMA_V2,
  );
});
