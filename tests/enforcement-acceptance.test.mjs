// T009/P7 integration acceptance: no covered loop ends with work remaining.
//
// This is the cross-skill acceptance gate for the in-loop completion
// enforcement. It proves, against each loop's OWN durable record and its OWN
// guard/close function:
//
//   A1  every covered loop (csm-build, csm-plan, csm-review, csm-orchestrate)
//       refuses premature termination absent a passing evaluator receipt, and
//       its deterministic guard reports outstanding work (exit 2 / fail-closed
//       verdict) for a synthetic non-terminal record;
//   A2  the canonical goal-owned corpus validates under strict /2 with zero
//       failures;
//   A3  concurrent invocations stay per-run local: no skills-directory lock
//       appears and N concurrent runs overlap instead of serializing;
//   A4  a mid-run /1 plan/build-state passes through the updated readers and
//       guards without being failed (dual-revision tolerance).
//
// The suite records its own results (assertion id, status, evidence) into
// `.agents/evidence/enforcement/acceptance.json` after all tests run.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

import {
  PLAN_SCHEMA,
  createPlanArtifact,
  readPlanArtifact,
  validatePlanArtifact,
  writePlanArtifact,
} from "../csm-plan/lib/plan.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import {
  closePlan,
  createEvaluatorReceipt as createPlanEvaluatorReceipt,
  loopGuard as planLoopGuard,
  outstandingWork,
} from "../csm-plan/lib/loop-evaluator.mjs";
import {
  BUILD_SCHEMA,
  BUILD_SCHEMA_V2,
  completeBuild,
  createBuildState,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";
import { assertLoopGuard, evaluateLoopGuard } from "../csm-build/lib/loop-guard.mjs";
import {
  assertCanSaveVerified,
  canSaveVerified,
  closureRequired,
  remainingWork as reviewRemainingWork,
} from "../csm-review/lib/loop-closure.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { validateCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { evaluateRunRemainder } from "../csm-orchestrate/lib/recovery.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const POSITIVE_SIGNAL = "`node --test tests/enforcement-acceptance.test.mjs` passes (exit 0)";
const SOURCE_PLAN = { artifactId: "art-acceptance-plan", digest: `sha256:${"a".repeat(64)}` };
const EVIDENCE_PATH = join(ROOT, ".agents", "evidence", "enforcement", "acceptance.json");

// ── result registry + evidence artifact ──────────────────────────────────────

const results = new Map();
const EXPECTED_ASSERTIONS = 8;

function acceptanceTest(id, title, fn) {
  test(`${id}: ${title}`, async () => {
    try {
      const evidence = await fn();
      results.set(id, { id, title, status: "pass", evidence: evidence ?? {} });
    } catch (error) {
      results.set(id, {
        id,
        title,
        status: "fail",
        evidence: { message: String(error?.message ?? error) },
      });
      throw error;
    }
  });
}

after(async () => {
  const assertions = [...results.values()];
  const failedAssertions = assertions
    .filter((assertion) => assertion.status !== "pass")
    .map((assertion) => assertion.id);
  const complete = assertions.length === EXPECTED_ASSERTIONS;
  const artifact = {
    schema: "csm-enforcement-acceptance/1",
    schemaRevision: 1,
    task: "T009",
    plan: "2026-09-14-csm-completion-fixes-csm.json",
    generatedAt: new Date().toISOString(),
    generator: "tests/enforcement-acceptance.test.mjs",
    node: process.version,
    assertionsExpected: EXPECTED_ASSERTIONS,
    assertionsRecorded: assertions.length,
    assertions,
    overallVerdict: complete && failedAssertions.length === 0 ? "pass" : "fail",
    failedAssertions,
  };
  // Deterministic idempotent write: assertion `evidence` can carry run timings,
  // so compare only the stable projection (id/title/status + verdict) and skip
  // the rewrite when nothing stable changed — otherwise every test run dirties
  // the tracked artifact and blocks the repo's unstaged-guard commit path.
  const stableProjection = JSON.stringify({
    overallVerdict: artifact.overallVerdict,
    failedAssertions: artifact.failedAssertions,
    assertions: assertions.map(({ id, title, status }) => ({ id, title, status })),
  });
  let existing = null;
  try {
    existing = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  } catch {
    existing = null;
  }
  const existingProjection = existing
    ? JSON.stringify({
        overallVerdict: existing.overallVerdict,
        failedAssertions: existing.failedAssertions,
        assertions: (existing.assertions ?? []).map(({ id, title, status }) => ({
          id,
          title,
          status,
        })),
      })
    : null;
  if (existingProjection !== stableProjection) {
    await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  }
});

// ── shared helpers ───────────────────────────────────────────────────────────

function capture(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to throw" });
}

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCli(relativePath, args) {
  return spawnSync(process.execPath, [join(ROOT, relativePath), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function pendingPlan() {
  return createPlanArtifact({
    planId: "acceptance-pending",
    runId: "run-acceptancepending",
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: POSITIVE_SIGNAL }],
  });
}

function passingPlanReceipt(value) {
  const { receiptDigest, ...body } = createPlanEvaluatorReceipt(value);
  void receiptDigest;
  const signed = {
    ...body,
    verdict: "complete",
    evidence: `${body.evidence}; independently verified`,
  };
  return { ...signed, receiptDigest: digest(signed) };
}

function checkpointState(revision) {
  let value = createBuildState({
    runId: `run-acceptancebuild${revision}`,
    artifactId: `art-acceptancebuild${revision}`,
    sourcePlan: SOURCE_PLAN,
    ...(revision === 2 ? { schemaRevision: 2 } : {}),
  });
  value = transitionBuildState(value, "VALIDATE", { evidence: "validated" });
  value = transitionBuildState(value, "SELECT", { evidence: "selected" });
  return transitionBuildState(value, "CHECKPOINT", { evidence: "checkpoint" });
}

function unresolvedReviewRecord() {
  return {
    schema: "csm-review-findings/2",
    schemaRevision: 2,
    verificationStatus: {
      format: "csm-verification-status/1",
      status: "VERIFIED",
      unresolved: [],
    },
    findings: [
      {
        id: "F-001",
        closure: {
          format: "csm-review-closure/1",
          disposition: "unresolved",
          status: "open",
          action: "remediation not yet scheduled",
          evidence: "no closing action recorded at review time",
        },
      },
    ],
  };
}

// ── A1: every covered loop refuses premature termination ─────────────────────

acceptanceTest(
  "A1-csm-build",
  "csm-build refuses COMPLETE until the guard passes and a complete evaluator receipt exists",
  async () => {
    const state = checkpointState(2);
    assert.equal(state.schema, BUILD_SCHEMA_V2);
    const pending = [{ taskId: "T001", status: "pending" }];
    const terminal = [{ taskId: "T001", status: "completed" }];

    const guardError = capture(() => completeBuild(state, { tasks: pending }));
    assert.equal(guardError.code, "loop-guard", guardError.message);

    const receiptError = capture(() => completeBuild(state, { tasks: terminal }));
    assert.equal(receiptError.code, "evaluator-verdict-required", receiptError.message);

    const verdict = evaluateLoopGuard(state, { tasks: pending });
    assert.equal(verdict.status, "continue");
    assert.equal(verdict.exitCode, 2);
    const assertError = capture(() => assertLoopGuard(state, { tasks: pending }));
    assert.equal(assertError.code, "loop-guard");

    const cli = await withTempDir("csm-accept-build-", async (dir) => {
      const recordPath = join(dir, "record.json");
      const planPath = join(dir, "plan.json");
      await writeFile(recordPath, JSON.stringify(state));
      await writeFile(
        planPath,
        JSON.stringify({ schema: "csm-plan/2", status: "ready", tasks: pending }),
      );
      return runCli("csm-build/lib/loop-guard.mjs", ["--record", recordPath, "--plan", planPath]);
    });
    assert.equal(cli.status, 2, cli.stderr);
    assert.match(cli.stderr, /loop-guard: work remains/);

    return {
      refusedGuard: guardError.code,
      refusedReceipt: receiptError.code,
      guardExit: cli.status,
    };
  },
);

acceptanceTest(
  "A1-csm-plan",
  "csm-plan refuses closure without a passing receipt and its guard exits non-zero",
  async () => {
    const plan = pendingPlan();
    const missing = capture(() => closePlan(plan));
    assert.equal(missing.code, "missing-evaluator-receipt");

    const work = capture(() => closePlan(plan, { receipt: passingPlanReceipt(plan) }));
    assert.equal(work.code, "pending-work");
    assert.deepEqual(
      work.openTasks.map((task) => task.taskId),
      ["T001"],
    );

    assert.equal(outstandingWork(plan).done, false);
    assert.equal(planLoopGuard(plan).done, false);

    const cli = await withTempDir("csm-accept-plan-", async (dir) => {
      const recordPath = join(dir, "record.json");
      await writeFile(recordPath, JSON.stringify(plan));
      return runCli("csm-plan/lib/loop-evaluator.mjs", ["guard", "--record", recordPath]);
    });
    assert.equal(cli.status, 2, cli.stderr);
    assert.match(cli.stderr, /loop-guard: work remains/);

    return { refusedReceipt: missing.code, refusedWork: work.code, guardExit: cli.status };
  },
);

acceptanceTest(
  "A1-csm-review",
  "csm-review refuses VERIFIED with an unresolved finding and its guard exits non-zero",
  async () => {
    const record = unresolvedReviewRecord();
    assert.equal(closureRequired(record), true);
    assert.equal(canSaveVerified(record), false);
    const error = capture(() => assertCanSaveVerified(record));
    assert.equal(error.code, "unresolved-findings");
    assert.deepEqual(reviewRemainingWork(record).findings, ["F-001"]);

    const cli = await withTempDir("csm-accept-review-", async (dir) => {
      const recordPath = join(dir, "record.json");
      await writeFile(recordPath, JSON.stringify(record));
      return runCli("csm-review/lib/loop-closure.mjs", ["--record", recordPath]);
    });
    assert.equal(cli.status, 2, cli.stderr);
    assert.match(cli.stderr, /loop-guard: work remains/);

    return { refusedVerified: error.code, guardExit: cli.status };
  },
);

acceptanceTest(
  "A1-csm-orchestrate",
  "csm-orchestrate's run evaluator never returns complete with pending work and fails closed",
  async () => {
    const failure = {
      status: "failed",
      failure: { class: "technical", code: "node-hard-failure" },
    };
    const blocked = evaluateRunRemainder({
      runId: "run-acceptanceorchestrate",
      phaseId: "phase-acceptance",
      failedNodeId: "node-a",
      failure,
      pendingNodes: ["node-b"],
      pendingPhases: ["phase-later"],
      remaindersUsed: 1,
      remainderPolicy: { maxRemainders: 1 },
    });
    assert.notEqual(blocked.verdict, "complete");
    assert.equal(blocked.verdict, "blocked");
    assert.equal(blocked.failClosed, true);
    assert.equal(blocked.supersession.failClosed, true);
    assert.equal(blocked.supersession.resumable, true);
    assert.deepEqual([...blocked.supersession.pendingNodes], ["node-b"]);

    const remainder = evaluateRunRemainder({
      runId: "run-acceptanceorchestrate",
      phaseId: "phase-acceptance",
      failedNodeId: "node-a",
      failure,
      pendingNodes: ["node-b"],
      remaindersUsed: 0,
      remainderPolicy: { maxRemainders: 1 },
    });
    assert.notEqual(remainder.verdict, "complete");
    assert.equal(remainder.verdict, "remainder");
    assert.equal(remainder.failClosed, true);

    const result = await runFailingOrchestrate();
    assert.equal(result.receipt.outcome.accepted, false);
    assert.notEqual(result.receipt.outcome.status, "VERIFIED");
    assert.equal(result.supersession.resumable, true);
    assert.deepEqual([...result.supersession.pendingNodes], ["node-p1-csm-grill"]);

    return {
      blockedVerdict: blocked.verdict,
      remainderVerdict: remainder.verdict,
      runOutcome: result.receipt.outcome.status,
      runAccepted: result.receipt.outcome.accepted,
    };
  },
);

// ── A2: canonical corpus validates under strict /2 ───────────────────────────

acceptanceTest(
  "A2-corpus-strict-v2",
  "the canonical corpus validates under strict /2 with zero failures",
  () => {
    const cli = spawnSync(process.execPath, ["scripts/validate-corpus-v2.mjs", "--quiet"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const match = cli.stdout.match(/validate-corpus-v2: (\d+) records, (\d+) failures/);
    assert.ok(match, cli.stdout);
    assert.equal(Number(match[2]), 0);
    return {
      command: "node scripts/validate-corpus-v2.mjs",
      records: Number(match[1]),
      failures: 0,
      exitCode: cli.status,
    };
  },
);

// ── A3: concurrent invocations stay unserialized ─────────────────────────────

const CONCURRENCY = 4;
const HOLD_MS = 300;
const SCANNED_DIRS = Object.freeze([
  "csm-plan",
  "csm-build",
  "csm-review",
  "csm-orchestrate",
  "csm-bdd-tdd",
  "lib",
  "schemas",
  "scripts",
]);
const LOCK_PATTERN = /(^|[.\-_])(append-)?lock($|[.\-_])/i;

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
  const buildGuard = await import(pathToFileURL(join(root, "csm-build/lib/loop-guard.mjs")).href);
  const planGuard = await import(pathToFileURL(join(root, "csm-plan/lib/loop-evaluator.mjs")).href);
  const reviewGuard = await import(pathToFileURL(join(root, "csm-review/lib/loop-closure.mjs")).href);
  const runGuard = await import(pathToFileURL(join(root, "csm-orchestrate/lib/recovery.mjs")).href);
  const plansDir = join(work, ".agents", "plans");
  await mkdir(plansDir, { recursive: true });
  const shared = await planLib.readPlanArtifact(join(plansDir, "2026-09-19-shared-csm.json"));
  const own = planLib.createPlanArtifact({
    planId: "concurrent-" + slot,
    runId: "run-concurrent" + slot,
    artifactId: "art-concurrent" + slot,
    provenance: { producedAt: "2026-09-19T00:00:00.000Z" },
    schemaRevision: 2,
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" }],
  });
  const ownPath = join(plansDir, "2026-09-19-concurrent-slot-" + slot + "-csm.json");
  await planLib.writePlanArtifact(ownPath, own);
  const reread = await planLib.readPlanArtifact(ownPath);
  const build = stateLib.transitionBuildState(
    stateLib.createBuildState({
      runId: "run-concurrentbuild" + slot,
      artifactId: "art-concurrentbuild" + slot,
      schemaRevision: 2,
      sourcePlan: { artifactId: "art-source", digest: "sha256:" + "a".repeat(64) },
    }),
    "VALIDATE",
    { evidence: "concurrent validate" },
  );
  const buildVerdict = buildGuard.evaluateLoopGuard(build, {
    tasks: [{ taskId: "T001", status: "pending" }],
  }).exitCode;
  const planVerdict = planGuard.outstandingWork({
    schema: "csm-plan/2",
    status: "ready",
    tasks: [{ taskId: "T001", status: "pending" }],
  }).done;
  const reviewVerdict = reviewGuard.loopGuardDecision({
    schema: "csm-review-findings/2",
    schemaRevision: 2,
    verificationStatus: { status: "VERIFIED", unresolved: [] },
    findings: [{ id: "F-001", closure: { status: "open", disposition: "unresolved" } }],
  }).code;
  const runVerdict = runGuard.evaluateRunRemainder({
    runId: "run-concurrent" + slot,
    phaseId: "phase-concurrent" + slot,
    failure: { failure: { class: "technical", code: "boom" } },
    pendingNodes: ["node-x"],
    remainderPolicy: { maxRemainders: 0 },
  }).verdict;
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  process.stdout.write(JSON.stringify({
    slot: Number(slot),
    startedAt,
    endedAt: Date.now(),
    ok: true,
    sharedSchema: shared.schema,
    ownSchema: reread.schema,
    buildVerdict,
    planVerdict,
    reviewVerdict,
    runVerdict,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ slot: Number(slot), ok: false, error: String(error && error.stack ? error.stack : error) }));
  process.exitCode = 1;
}
`;

function toPosix(value) {
  return value.split(sep).join("/");
}

async function listLockFilesUnder(dir) {
  const found = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (LOCK_PATTERN.test(entry.name)) found.push(toPosix(relative(ROOT, absolute)));
    }
  }
  await visit(dir);
  return found.toSorted();
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

acceptanceTest(
  "A3-parallel-safety",
  "N concurrent enforcement invocations overlap with no skills-directory lock",
  async () => {
    const work = await mkdtemp(join(tmpdir(), "csm-acceptance-parallel-"));
    try {
      const workerPath = join(work, "worker.mjs");
      await writeFile(workerPath, WORKER_SOURCE);
      const plansDir = join(work, ".agents", "plans");
      const sharedPath = join(plansDir, "2026-09-19-shared-csm.json");
      await writePlanArtifact(
        sharedPath,
        createPlanArtifact({
          planId: "shared-acceptance",
          runId: "run-sharedacceptance",
          artifactId: "art-sharedacceptance",
          provenance: { producedAt: "2026-09-19T00:00:00.000Z" },
          schemaRevision: 2,
          tasks: [
            { taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" },
          ],
        }),
      );
      const sharedBefore = createHash("sha256")
        .update(await readFile(sharedPath))
        .digest("hex");

      const warmup = await runWorker(workerPath, work, 90, 25);
      assert.equal(warmup.code, 0, warmup.stderr);
      const singleA = await runWorker(workerPath, work, 91, HOLD_MS);
      const singleB = await runWorker(workerPath, work, 92, HOLD_MS);
      assert.equal(singleA.code, 0, singleA.stderr);
      assert.equal(singleB.code, 0, singleB.stderr);
      const singleElapsed = Math.min(singleA.elapsedMs, singleB.elapsedMs);

      const startedAt = Date.now();
      const runs = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, slot) =>
          runWorker(workerPath, work, slot, HOLD_MS),
        ),
      );
      const concurrentElapsed = Date.now() - startedAt;

      for (const run of runs) {
        assert.equal(run.code, 0, run.stderr);
        assert.ok(run.parsed?.ok, run.parsed?.error ?? run.stdout);
        assert.deepEqual(
          {
            sharedSchema: run.parsed.sharedSchema,
            ownSchema: run.parsed.ownSchema,
            buildVerdict: run.parsed.buildVerdict,
            planVerdict: run.parsed.planVerdict,
            reviewVerdict: run.parsed.reviewVerdict,
            runVerdict: run.parsed.runVerdict,
          },
          {
            sharedSchema: "csm-plan/2",
            ownSchema: "csm-plan/2",
            buildVerdict: 2,
            planVerdict: false,
            reviewVerdict: 2,
            runVerdict: "blocked",
          },
        );
      }
      const starts = runs.map((run) => run.parsed.startedAt);
      const ends = runs.map((run) => run.parsed.endedAt);
      assert.ok(Math.max(...starts) < Math.min(...ends), "concurrent windows must overlap");
      assert.ok(
        concurrentElapsed < singleElapsed * CONCURRENCY * 0.85,
        `concurrent=${concurrentElapsed}ms must not scale linearly (a global lock would serialize ${CONCURRENCY} runs to ~${singleElapsed * CONCURRENCY}ms)`,
      );

      const skillsLocks = [];
      for (const dir of SCANNED_DIRS)
        skillsLocks.push(...(await listLockFilesUnder(join(ROOT, dir))));
      assert.deepEqual(skillsLocks, [], "no skills-directory lock may appear");
      assert.deepEqual(
        await listLockFilesUnder(work),
        [],
        "the per-run work root must not gain a lock either",
      );
      const sharedAfter = createHash("sha256")
        .update(await readFile(sharedPath))
        .digest("hex");
      assert.equal(sharedAfter, sharedBefore, "the shared artifact must not be mutated");

      return {
        concurrency: CONCURRENCY,
        concurrentElapsedMs: concurrentElapsed,
        singleElapsedMs: singleElapsed,
        skillsLocks,
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);

// ── A4: a mid-run /1 artifact is not failed (dual-revision tolerance) ────────

acceptanceTest(
  "A4-mid-run-v1-plan",
  "a mid-run /1 plan passes through the updated readers/guards without failing",
  async () => {
    const plan = createPlanArtifact({
      planId: "v1-inflight",
      runId: "run-v1inflight",
      tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: POSITIVE_SIGNAL }],
    });
    assert.equal(plan.schema, PLAN_SCHEMA);
    assert.equal(plan.schemaRevision, 1);
    assert.deepEqual(validatePlanArtifact(plan), { valid: true, errors: [] });

    const before = JSON.stringify(plan);
    assert.equal(outstandingWork(plan).done, false);
    assert.equal(planLoopGuard(plan).done, false);
    assert.equal(planLoopGuard(plan).lifecycleOpen, true);
    assert.equal(JSON.stringify(plan), before, "guards must not mutate the /1 record");

    const resolved = await withTempDir("csm-accept-v1plan-", async (dir) => {
      const path = join(dir, ".agents", "plans", "2026-09-19-v1-inflight-csm.json");
      await mkdir(dirname(path), { recursive: true });
      await writePlanArtifact(path, plan);
      const reread = await readPlanArtifact(path);
      assert.equal(reread.schema, PLAN_SCHEMA);
      assert.equal(reread.schemaRevision, 1);
      return resolvePlanInput("plan", ".agents/plans/2026-09-19-v1-inflight-csm.json", {
        root: dir,
      });
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.schema, PLAN_SCHEMA);

    return { schema: plan.schema, midRunDone: false, resolved: resolved.status };
  },
);

acceptanceTest(
  "A4-mid-run-v1-build",
  "a mid-run /1 build-state is processed by the guard and can still complete without a /2 receipt",
  async () => {
    const state = checkpointState(1);
    assert.equal(state.schema, BUILD_SCHEMA);
    assert.equal(state.schemaRevision, 1);
    assert.deepEqual(validateBuildState(state), { valid: true, errors: [] });

    const withWork = { ...state, control: { ...state.control, activeTasks: ["T001"] } };
    const before = JSON.stringify(withWork);
    const verdict = evaluateLoopGuard(withWork, { tasks: [{ taskId: "T001", status: "pending" }] });
    assert.equal(verdict.status, "continue");
    assert.equal(verdict.exitCode, 2);
    const error = capture(() =>
      assertLoopGuard(withWork, { tasks: [{ taskId: "T001", status: "pending" }] }),
    );
    assert.equal(error.code, "loop-guard");
    assert.equal(JSON.stringify(withWork), before, "the guard must not mutate the /1 record");

    // Dual-revision tolerance: a /1 build completes with no /2-only evaluator
    // receipt, so the updated loop does not fail it by demanding revision 2.
    const completed = completeBuild(state, { tasks: [{ taskId: "T001", status: "completed" }] });
    assert.equal(completed.schema, BUILD_SCHEMA);
    assert.equal(completed.control.currentState, "COMPLETE");
    assert.deepEqual(validateBuildState(completed), { valid: true, errors: [] });

    return {
      schema: state.schema,
      midRunGuardExit: verdict.exitCode,
      completedState: completed.control.currentState,
    };
  },
);

// ── csm-orchestrate failing-run harness (compact, default fail-closed policy) ─

const APPROACH_SIGNALS = { capabilities: ["csm-ddd", "csm-grill"] };
const NOW = () => new Date("2026-09-19T12:00:00Z");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function trustedCapabilities() {
  const manifest = JSON.parse(
    await readFile(join(ROOT, "csm-orchestrate", "capabilities.json"), "utf8"),
  );
  for (const capability of manifest.skills) {
    capability.digest = sha256(await readFile(join(ROOT, capability.source.skillPath)));
    if (capability.source.entrypoint && capability.source.libraryDigest)
      capability.source.libraryDigest = sha256(
        await readFile(join(ROOT, capability.source.entrypoint)),
      );
  }
  manifest.contentDigest = digest(manifest.skills);
  return validateCapabilities(manifest);
}

function approachFor(runId) {
  return {
    schema: "csm-approach/1",
    schemaRevision: 1,
    status: "agreed",
    runId,
    ideaSlug: "acceptance",
    signals: APPROACH_SIGNALS,
    phases: [
      {
        phaseId: "P1",
        title: "Deliver",
        goal: "produce the deliverable",
        deliverables: ["typed result"],
        scope: ["repository"],
        outOfScope: ["production"],
        constraints: [],
        acceptanceHints: ["technical pass", "functional pass"],
        context: [],
        dependencies: [],
      },
    ],
  };
}

function failingHost() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill() {
      calls += 1;
      return {
        status: "failed",
        failure: { class: "policy", code: "node-hard-failure", message: "planned hard failure" },
      };
    },
    artifactResolver: {
      async resolve(refPath) {
        return { status: "missing", code: "missing", message: `missing ${refPath}` };
      },
    },
  };
}

function memoryCursorStore() {
  return {
    cursors: new Map(),
    async saveCursor(cursor) {
      this.cursors.set(cursor.cursorId, cursor);
    },
    async loadCursor(cursorId) {
      return this.cursors.get(cursorId) ?? null;
    },
  };
}

async function approveNode({ phase, node, childRunId }) {
  if (!phase || !node || !childRunId) return undefined;
  const approvedAt = new Date(NOW());
  return {
    schema: "csm-orchestrate-approval/2",
    approvalId: `approval-${childRunId}`,
    binding: {
      parentRunId: phase.runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: `edge-${node.nodeId}`,
    },
    scope: [...node.approvalScope],
    approvedDigest: node.capabilityDigest,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 3_600_000).toISOString(),
    status: "approved",
  };
}

async function runFailingOrchestrate() {
  const runId = "run-acceptance-failclosed";
  const host = failingHost();
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "csm-acceptance-review-"));
  const schemaRegistry = await loadSchemaRegistry();
  return orchestrate({
    approach: approachFor(runId),
    runId,
    host,
    capabilities: await trustedCapabilities(),
    signals: APPROACH_SIGNALS,
    approvals: approveNode,
    now: NOW,
    cursorStore: memoryCursorStore(),
    schemaRegistry,
    artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),
    childArtifactResolver: host.artifactResolver,
    retryBackoffMs: 0,
  });
}
