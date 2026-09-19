// T004/P2c: parallelism safety guard for the additive /2 enforcement revision.
// The skills are used live by other agents in other repos, so this suite proves
// the new code is per-run local: no skills-directory lock or shared mutable
// state is created, inputs are never mutated, and N concurrent invocations
// (reads of one artifact plus writes to distinct paths) all proceed without
// serialization.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as planModule from "../csm-plan/lib/plan.mjs";
import * as stateModule from "../csm-build/lib/state.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCANNED_DIRS = Object.freeze([
  "csm-plan",
  "csm-build",
  "csm-orchestrate",
  "csm-bdd-tdd",
  "lib",
  "schemas",
  "scripts",
]);
const LOCK_PATTERN = /(^|[.\-_])(append-)?lock($|[.\-_])/i;
const PRODUCED_AT = "2026-09-19T00:00:00.000Z";
const CONCURRENCY = 4;
const HOLD_MS = 400;

const WORKER_SOURCE = String.raw`
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const [root, work, slot, holdRaw] = process.argv.slice(2);
const holdMs = Number(holdRaw);
const startedAt = Date.now();
try {
  const planLib = await import(pathToFileURL(join(root, "csm-plan/lib/plan.mjs")).href);
  const stateLib = await import(pathToFileURL(join(root, "csm-build/lib/state.mjs")).href);
  const plansDir = join(work, ".agents", "plans");
  await mkdir(plansDir, { recursive: true });
  const shared = await planLib.readPlanArtifact(join(plansDir, "2026-09-19-shared-csm.json"));
  const own = planLib.createPlanArtifact({
    planId: "concurrent-plan-" + slot,
    runId: "run-concurrentplan" + slot,
    artifactId: "art-concurrentplan" + slot,
    provenance: { producedAt: "2026-09-19T00:00:00.000Z" },
    schemaRevision: 2,
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" }],
  });
  const ownPath = join(plansDir, "2026-09-19-concurrent-slot-" + slot + "-csm.json");
  await planLib.writePlanArtifact(ownPath, own);
  const reread = await planLib.readPlanArtifact(ownPath);
  let build = stateLib.createBuildState({
    runId: "run-concurrentbuild" + slot,
    artifactId: "art-concurrentbuild" + slot,
    schemaRevision: 2,
    sourcePlan: { artifactId: "art-source", digest: "sha256:" + "a".repeat(64) },
  });
  build = stateLib.transitionBuildState(build, "VALIDATE", { evidence: "concurrent validate" });
  const buildValid = stateLib.validateBuildState(build).valid;
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  process.stdout.write(JSON.stringify({
    slot: Number(slot),
    startedAt,
    endedAt: Date.now(),
    ok: true,
    sharedSchema: shared.schema,
    ownSchema: reread.schema,
    buildValid,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    slot: Number(slot),
    ok: false,
    error: String(error && error.stack ? error.stack : error),
  }));
  process.exitCode = 1;
}
`;

function toPosix(value) {
  return value.split(sep).join("/");
}

async function visitFiles(dir, onFile) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) await visitFiles(absolute, onFile);
    else await onFile(absolute, entry);
  }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function snapshotSkillsTree() {
  const entries = new Map();
  const record = async (absolute) => {
    entries.set(toPosix(relative(ROOT, absolute)), await hashFile(absolute));
  };
  for (const dir of SCANNED_DIRS) await visitFiles(join(ROOT, dir), (absolute) => record(absolute));
  for (const entry of await readdir(ROOT, { withFileTypes: true }))
    if (entry.isFile()) await record(join(ROOT, entry.name));
  return entries;
}

async function listLockFilesUnder(dir) {
  const found = [];
  await visitFiles(dir, (absolute) => {
    if (LOCK_PATTERN.test(absolute.split(sep).at(-1)))
      found.push(toPosix(relative(ROOT, absolute)));
  });
  return found.toSorted();
}

async function collectSkillsLockFiles() {
  const found = [];
  for (const dir of SCANNED_DIRS) found.push(...(await listLockFilesUnder(join(ROOT, dir))));
  return found.toSorted();
}

function buildPlanInput(overrides = {}) {
  return {
    planId: "parallel-safety",
    runId: "run-parallelsafety",
    artifactId: "art-parallelsafety",
    schemaRevision: 2,
    provenance: { producedAt: PRODUCED_AT },
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" }],
    ...overrides,
  };
}

function buildStateInput(overrides = {}) {
  return {
    runId: "run-parallelsafetybuild",
    artifactId: "art-parallelsafetybuild",
    schemaRevision: 2,
    sourcePlan: { artifactId: "art-source", digest: `sha256:${"a".repeat(64)}` },
    ...overrides,
  };
}

function runWorker(workerPath, work, slot, holdMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [workerPath, ROOT, work, String(slot), String(holdMs)], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        parsed = null;
      }
      resolve({ code, elapsedMs: Date.now() - startedAt, parsed, stdout, stderr });
    });
  });
}

test("the additive /2 reader/writer paths create no lock or shared state in the skills directory", async () => {
  const before = await snapshotSkillsTree();
  assert.deepEqual(await collectSkillsLockFiles(), [], "the source tree must start lock-free");

  const root = await mkdtemp(join(tmpdir(), "csm-parallel-inproc-"));
  try {
    const plansDir = join(root, ".agents", "plans");
    await mkdir(plansDir, { recursive: true });
    const path = join(plansDir, "2026-09-19-parallel-inproc-csm.json");
    const plan = planModule.createPlanArtifact(buildPlanInput());
    assert.equal(plan.schema, planModule.PLAN_SCHEMA_V2);
    await planModule.writePlanArtifact(path, plan);
    const reread = await planModule.readPlanArtifact(path);
    assert.equal(reread.schema, planModule.PLAN_SCHEMA_V2);
    assert.equal(planModule.validatePlanArtifact(reread).valid, true);

    const advanced = stateModule.transitionBuildState(
      stateModule.createBuildState(buildStateInput()),
      "VALIDATE",
      { evidence: "in-process parallel safety" },
    );
    assert.equal(stateModule.validateBuildState(advanced).valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const after = await snapshotSkillsTree();
  assert.deepEqual(
    after,
    before,
    "the skills directory must be byte-identical after /2 operations",
  );
  assert.deepEqual(await collectSkillsLockFiles(), [], "no skills-directory lock may be created");
});

test("the enforcement modules expose no lock and keep every shared value frozen", () => {
  for (const [name, value] of Object.entries({ ...planModule, ...stateModule })) {
    assert.doesNotMatch(name, /lock|mutex|semaphore/i, `unexpected lock-like export ${name}`);
    if (value && typeof value === "object")
      assert.ok(Object.isFrozen(value), `${name} must be frozen (no shared mutable state)`);
  }
  assert.equal(Reflect.set(planModule.PLAN_SCHEMAS, "0", "csm-plan/99"), false);
  assert.deepEqual([...planModule.PLAN_SCHEMAS], ["csm-plan/1", "csm-plan/2"]);
  assert.equal(Reflect.set(stateModule.EVALUATOR_CONTRACT, "format", "tampered"), false);
  assert.equal(stateModule.EVALUATOR_CONTRACT.format, "csm-evaluator-contract/1");
});

test("enforcement state is per-run local: inputs are never mutated and outputs are fresh clones", () => {
  const plan = planModule.createPlanArtifact(buildPlanInput());
  const planBefore = JSON.stringify(plan);
  assert.equal(planModule.validatePlanArtifact(plan).valid, true);
  assert.equal(JSON.stringify(plan), planBefore, "validation must not mutate the record");

  const state = stateModule.createBuildState(buildStateInput());
  const stateBefore = JSON.stringify(state);
  const advanced = stateModule.transitionBuildState(state, "VALIDATE", { evidence: "local" });
  assert.notStrictEqual(advanced.control, state.control);
  assert.notStrictEqual(advanced.journal, state.journal);
  assert.equal(
    JSON.stringify(state),
    stateBefore,
    "transitioning must not mutate the source state",
  );
  assert.notEqual(advanced.control.currentState, state.control.currentState);
});

test("concurrent /2 reads of one artifact and writes to distinct paths all proceed", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-parallel-promises-"));
  try {
    const plansDir = join(root, ".agents", "plans");
    await mkdir(plansDir, { recursive: true });
    const sharedPath = join(plansDir, "2026-09-19-shared-csm.json");
    await planModule.writePlanArtifact(
      sharedPath,
      planModule.createPlanArtifact(buildPlanInput({ planId: "shared-promises" })),
    );

    const reads = await Promise.all(
      Array.from({ length: 16 }, () => planModule.readPlanArtifact(sharedPath)),
    );
    for (const value of reads) assert.equal(value.schema, planModule.PLAN_SCHEMA_V2);

    const writes = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const path = join(plansDir, `2026-09-19-write-${index}-csm.json`);
        const plan = planModule.createPlanArtifact(
          buildPlanInput({
            planId: `write-${index}`,
            runId: `run-write${index}`,
            artifactId: `art-write${index}`,
          }),
        );
        await planModule.writePlanArtifact(path, plan);
        return planModule.readPlanArtifact(path);
      }),
    );
    for (const value of writes) assert.equal(value.schema, planModule.PLAN_SCHEMA_V2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("N concurrent cross-process invocations overlap and never serialize behind a lock", async () => {
  const work = await mkdtemp(join(tmpdir(), "csm-parallel-workers-"));
  const workerPath = join(work, "worker.mjs");
  try {
    await writeFile(workerPath, WORKER_SOURCE);
    const plansDir = join(work, ".agents", "plans");
    await mkdir(plansDir, { recursive: true });
    await planModule.writePlanArtifact(
      join(plansDir, "2026-09-19-shared-csm.json"),
      planModule.createPlanArtifact(buildPlanInput({ planId: "shared-workers" })),
    );

    const warmup = await runWorker(workerPath, work, 90, 25);
    assert.equal(warmup.code, 0, warmup.stderr);
    const singleA = await runWorker(workerPath, work, 91, HOLD_MS);
    const singleB = await runWorker(workerPath, work, 92, HOLD_MS);
    assert.equal(singleA.code, 0, singleA.stderr);
    assert.equal(singleB.code, 0, singleB.stderr);
    const singleElapsed = Math.min(singleA.elapsedMs, singleB.elapsedMs);

    const startedAt = Date.now();
    const runs = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, slot) => runWorker(workerPath, work, slot, HOLD_MS)),
    );
    const concurrentElapsed = Date.now() - startedAt;

    for (const run of runs) {
      assert.equal(run.code, 0, run.stderr);
      assert.ok(run.parsed?.ok, run.parsed?.error ?? run.stdout);
      assert.equal(run.parsed.sharedSchema, planModule.PLAN_SCHEMA_V2);
      assert.equal(run.parsed.ownSchema, planModule.PLAN_SCHEMA_V2);
      assert.equal(run.parsed.buildValid, true);
    }
    const starts = runs.map((run) => run.parsed.startedAt);
    const ends = runs.map((run) => run.parsed.endedAt);
    assert.ok(
      Math.max(...starts) < Math.min(...ends),
      "every concurrent invocation window must overlap",
    );
    assert.ok(
      concurrentElapsed < singleElapsed * CONCURRENCY * 0.85,
      `concurrent=${concurrentElapsed}ms must not scale linearly (a global lock would serialize ${CONCURRENCY} runs to ~${singleElapsed * CONCURRENCY}ms)`,
    );
    assert.deepEqual(await collectSkillsLockFiles(), [], "no skills-directory lock may appear");
    assert.deepEqual(
      await listLockFilesUnder(work),
      [],
      "the per-run work root must not gain a lock either",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
