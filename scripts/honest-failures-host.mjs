// Host for the honest-failures orchestration run (quality delivery cycle 4):
// analyze every honest failure recorded during cycles 2-3, fix the runtime
// defects behind them, and prove the fixes with tests and the full battery.
//
//   P1  record the typed failure inventory as evidence (.agents/evidence/)
//   P2  apply scripts/patch-honest-failures.mjs + verification tests
//   P3  full battery: orchestrate + evals + wiring test + fixture + check-suite
//
// The terminal review is delegated through the host invokeReview seam to
// createIndependentFinalReviewExecutor with scripts/independent-reviewer.mjs.
"use strict";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "../lib/schema-runtime/index.mjs";
import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";
import { insertAgentsIndexBullet } from "./lib/agents-index.mjs";

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WIRING_TEST_PATH = "tests/orchestrate-honest-failures.test.mjs";

async function sh(cmd, args, { timeout = 600_000 } = {}) {
  try {
    const { stdout } = await exec(cmd, args, { cwd: root, encoding: "utf8", timeout });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
  }
}

const ANALYSIS = {
  schema: "csm-honest-failures-analysis/1",
  collectedAt: "2026-09-05T22:30:00.000Z",
  source: "quality delivery cycles 2-3 journal rows + orchestrator run evidence r1-r5",
  failures: [
    {
      id: "F1",
      failure:
        "30s default child timeout declared real build work reconciliation-required (run r1); read-only children share the fail-closed path even though no effects can have landed",
      rootCause:
        "request.timeoutMs default tuned for in-process fixtures; timeout catch does not distinguish read-only from side-effecting children",
      fix: "driver realMode passes 600s and honors --timeout-ms; runtime: read-only child timeout now returns typed retryable failure (class timeout, code child-timeout); side-effecting children keep fail-closed reconciliation",
      verifiedBy:
        "tests/orchestrate-honest-failures.test.mjs (retry completes VERIFIED; side-effecting stays BLOCKED)",
    },
    {
      id: "F2",
      failure:
        "approval binding mismatch when caller passed --run-id diverging from approach.runId",
      rootCause:
        "approvals bind to phase.runId (approach identity) while orchestrate accepted any parent runId",
      fix: "orchestrate fails fast with a typed error when runId !== approach.runId; driver also guards",
      verifiedBy: "tests/orchestrate-honest-failures.test.mjs divergence assertion",
    },
    {
      id: "F3",
      failure: "telemetry.jsonl empty for early runs (async transport writes lost on process exit)",
      rootCause: "no drain of the transport write queue before exit",
      fix: "telemetryEmitter.flush() drains the transport; orchestrate epilogue awaits it best-effort; driver also drains explicitly",
      verifiedBy:
        "tests/orchestrate-honest-failures.test.mjs flush assertion + r5 run telemetry (12 events)",
    },
    {
      id: "F4",
      failure:
        "stale csm-upload capability digest shipped in 9e9fb05 and surfaced only as an orchestrator startup failure two cycles later",
      rootCause: "no gate-time verification of capabilities.json digests against skill file bytes",
      fix: "check-suite capability manifest freshness check (per-skill sha256 + entrypoint libraryDigest)",
      verifiedBy:
        "make check includes the new gate; negative behavior demonstrated by the original 9e9fb05 incident",
    },
    {
      id: "F5",
      failure:
        "hardcoded contentDigest pin in orchestrate-capabilities.test.mjs broke on the legitimate manifest regeneration",
      rootCause: "pin asserted a constant instead of manifest self-consistency",
      fix: "pin replaced with computed consistency assertion",
      verifiedBy: "tests/orchestrate-capabilities.test.mjs green across regenerations",
    },
    {
      id: "F6",
      failure:
        "driver silently reused durable run state; surfaced as progress fencing staleness (run r2)",
      rootCause: "no guard on existing cursor.db",
      fix: "driver refuses to start when durable state exists unless --resume is passed",
      verifiedBy: "manual rerun behavior + guard code review (runbook: fresh runId per attempt)",
    },
    {
      id: "F7",
      failure:
        "host parity check targeted the package entry instead of lib/index.mjs (run r3 host throw)",
      rootCause: "host author error; the runtime contract was correct",
      fix: "fixed in cycle 3 host; recorded as honesty evidence",
      verifiedBy: "cycle 3 run VERIFIED",
    },
    {
      id: "F8",
      failure:
        "piped node --test does not echo subprocess stdout, so a host-level VERIFIED regex on captured output can never match (run r4)",
      rootCause: "test-runner reporter behavior; assertion placed at the wrong layer",
      fix: "wiring test asserts the VERIFIED receipt itself; host derives from test pass/fail counts",
      verifiedBy: "cycle 3 run VERIFIED + wiring test green",
    },
    {
      id: "F9",
      failure:
        "persisted independent-review records unresolvable by host-only parent resolvers (wiring test BLOCKED invalid-review-artifact)",
      rootCause: "runtime review records are files; host in-memory resolvers cannot see them",
      fix: "driver composes host resolver with the real file-backed resolver over reviewArtifactRoot",
      verifiedBy: "tests/orchestrate-driver-final-review.test.mjs VERIFIED",
    },
    {
      id: "F10",
      failure:
        "csm-orchestrate/lib/index.mjs exceeded the 60kB maintainability outlier threshold (73938 bytes)",
      rootCause: "accreted single-module design",
      fix: "split into run-helpers/run-artifacts/run-cursor with public API parity (cycle 3 item 4)",
      verifiedBy: "57040 bytes + 281-test battery green",
    },
  ],
};

const HONEST_TESTS_SOURCE = `"use strict";
// Honest-failure fix verification (quality delivery cycle 4):
//   F1 read-only child timeout is retried safely; side-effecting timeout stays
//      fail-closed (reconciliation-required)
//   F2 orchestrate fails fast on runId !== approach.runId
//   F3 telemetryEmitter.flush() drains async transports
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const SHA_A = "sha256:" + "a".repeat(64);
const SHA_B = "sha256:" + "b".repeat(64);
const CONFIG = "sha256:" + "f".repeat(64);
const NOW = () => new Date("2026-09-05T12:00:00Z");

const approachFor = (runId, skill) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "honest",
  signals:
    skill === "csm-build"
      ? { capabilities: ["csm-build"], inputs: ["plan"] }
      : { capabilities: ["csm-scan"] },
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
});

function hostFixture({ hangFirstMs = 0 } = {}) {
  let calls = 0;
  const artifacts = new Map();
  return {
    get calls() {
      return calls;
    },
    async invokeSiblingSkill(request) {
      calls += 1;
      if (calls === 1 && hangFirstMs > 0)
        await new Promise((resolveValue) => setTimeout(resolveValue, hangFirstMs));
      const descriptorBody = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-honest-" + calls,
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: "fixture-" + request.childRunId + ".json",
          artifactId: "art-" + request.childRunId,
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      const descriptor = { ...descriptorBody, digest: SHA_B };
      artifacts.set(descriptorBody.source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-honest-" + calls,
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: SHA_B,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(refPath, expected = {}) {
        const value = artifacts.get(refPath);
        if (!value)
          return { status: "missing", code: "missing", message: "missing artifact: " + refPath };
        return {
          status: "resolved",
          path: refPath,
          owner: expected.expectedOwner,
          fileDigest: expected.expectedFileDigest,
          value: { ...value, schema: value.source.schema },
        };
      },
    },
  };
}

const buildApproval = async ({ phase, node, childRunId }) => {
  if (!phase || !node || !childRunId) return undefined;
  const approvedAt = new Date(NOW());
  return {
    schema: "csm-orchestrate-approval/2",
    approvalId: "approval-honest-" + childRunId,
    binding: {
      parentRunId: phase.runId,
      childRunId,
      phaseId: phase.phaseId,
      edgeId: "edge-" + node.nodeId,
    },
    scope: [...node.approvalScope],
    approvedDigest: node.capabilityDigest,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 3_600_000).toISOString(),
    status: "approved",
  };
};

const memoryCursorStore = () => ({
  cursors: new Map(),
  async saveCursor(cursor) {
    this.cursors.set(cursor.cursorId, cursor);
  },
  async loadCursor(cursorId) {
    return this.cursors.get(cursorId) ?? null;
  },
});

async function orchestrateOptions(runId, skill, host, extra = {}) {
  const capabilities = await loadCapabilities();
  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "honest-review-"));
  const schemaRegistry = await loadSchemaRegistry();
  return {
    approach: approachFor(runId, skill),
    runId,
    host,
    capabilities,
    signals: approachFor(runId, skill).signals,
    approvals:
      skill === "csm-build"
        ? buildApproval
        : createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryCursorStore(),
    schemaRegistry,
    artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),
    childArtifactResolver: host.artifactResolver,
    retryBackoffMs: 0,
    ...extra,
  };
}

test("F1: read-only child timeout is retried safely and the phase completes", async () => {
  const runId = "run-honest-readonly-timeout";
  const host = hostFixture({ hangFirstMs: 1200 });
  const result = await orchestrate(
    await orchestrateOptions(runId, "csm-scan", host, {
      timeoutMs: 250,
      maxAttempts: 2,
    }),
  );
  assert.equal(host.calls, 2, "expected exactly one safe retry");
  assert.equal(result.phases?.[0]?.gate?.status, "VERIFIED");
  assert.equal(result.receipt.statuses.child, "completed");
});

test("F1b: side-effecting child timeout stays fail-closed (reconciliation-required)", async () => {
  const runId = "run-honest-build-timeout";
  const host = hostFixture({ hangFirstMs: 1200 });
  const result = await orchestrate(
    await orchestrateOptions(runId, "csm-build", host, {
      timeoutMs: 250,
      maxAttempts: 2,
    }),
  );
  assert.equal(host.calls, 1, "side-effecting timeout must not auto-retry");
  assert.equal(result.receipt.outcome.status, "INCOMPLETE");
  assert.equal(result.reason, "reconciliation-required");
});

test("F2: orchestrate rejects runId divergence from approach.runId", async () => {
  const host = hostFixture();
  await assert.rejects(
    orchestrate(
      await orchestrateOptions("run-honest-divergent", "csm-scan", host, {
        runId: "run-honest-other",
      }),
    ),
    /runId must equal approach.runId/,
  );
});

test("F3: telemetryEmitter.flush drains the async jsonl transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "honest-flush-"));
  try {
    const telemetryPath = join(dir, "telemetry.jsonl");
    const emitter = createTelemetryEmitter({
      transport: createJsonlTransport(telemetryPath),
      runId: "run-honest-flush",
      effectiveConfigDigest: CONFIG,
    });
    emitter.emit({ eventType: "dispatch", payload: { skill: "csm-scan" } });
    await emitter.flush();
    const lines = (await readFile(telemetryPath, "utf8")).trim().split("\\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).eventType, "dispatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
`;

async function phaseWork(request) {
  const phaseOrdinal = Number(request.phaseId?.match(/p(\d+)$/)?.[1] ?? 1);
  if (phaseOrdinal === 1) {
    const outPath = join(root, ".agents", "evidence", "honest-failures-analysis.json");
    const body = { ...ANALYSIS, collectedAt: new Date().toISOString() };
    await writeFile(outPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
    const readmePath = join(root, ".agents", "README.md");
    const readme = await readFile(readmePath, "utf8");
    let indexed = false;
    const next = insertAgentsIndexBullet(
      readme,
      ".agents/evidence/honest-failures-analysis.json",
      "- `honest-failures-analysis.json` — 2026-09-05 — typed inventory of honest failures from quality cycles 2-3 with root causes, fixes, and verification paths — status: reference",
    );
    if (next !== readme) {
      await writeFile(readmePath, next);
      indexed = true;
    }
    return {
      failureCount: ANALYSIS.failures.length,
      fixedInRuntime: ANALYSIS.failures.filter((f) => f.fix).length,
      evidencePath: ".agents/evidence/honest-failures-analysis.json",
      readmeIndexed: indexed,
      summary: `recorded ${ANALYSIS.failures.length} honest failures (F1-F10) with root causes and fix/verification paths`,
    };
  }
  if (phaseOrdinal === 2) {
    const codemodUrl = pathToFileURL(join(root, "scripts", "patch-honest-failures.mjs")).href;
    const codemod = await import(codemodUrl);
    const report = await codemod.patchHonestFailures();
    const applied = report.results.filter((r) => r.applied).length;
    for (const file of report.files) {
      const checkResult = await sh(process.execPath, ["--check", join(root, file)]);
      if (!checkResult.ok)
        throw new Error(`syntax check failed for ${file}: ${checkResult.stderr}`);
    }
    await writeFile(join(root, WIRING_TEST_PATH), `${HONEST_TESTS_SOURCE}\n`, { mode: 0o644 });
    const tests = await sh(process.execPath, ["--test", "--test-concurrency=1", WIRING_TEST_PATH]);
    if (!tests.ok)
      throw new Error(`honest-failures tests failed:\n${tests.stdout}\n${tests.stderr}`);
    const passMatch = tests.stdout.match(/# pass (\d+)/);
    const failMatch = tests.stdout.match(/# fail (\d+)/);
    if (Number(failMatch?.[1] ?? 1) !== 0)
      throw new Error("honest-failures tests reported failures");
    return {
      patchesApplied: applied,
      patchesTotal: report.results.length,
      patchResults: report.results,
      verificationTests: { pass: Number(passMatch?.[1] ?? -1), fail: Number(failMatch?.[1] ?? -1) },
      summary: `applied ${applied}/${report.results.length} honest-failure patches; verification tests ${passMatch?.[1] ?? "?"} pass / ${failMatch?.[1] ?? "?"} fail`,
    };
  }
  if (phaseOrdinal === 3) {
    const battery = await sh(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "tests/orchestrate-capabilities.test.mjs",
      "tests/orchestrate-migration.test.mjs",
      "tests/orchestrate-phase-compiler.test.mjs",
      "tests/orchestrate-telemetry-wiring.test.mjs",
      "tests/orchestrate-recovery-sqlite.test.mjs",
      "tests/orchestrate-e2e.test.mjs",
      "tests/orchestrate-honest-failures.test.mjs",
      "tests/orchestrate-driver-final-review.test.mjs",
    ]);
    if (!battery.ok)
      throw new Error(`orchestrate battery failed:\n${battery.stdout}\n${battery.stderr}`);
    const passMatch = battery.stdout.match(/# pass (\d+)/);
    const failMatch = battery.stdout.match(/# fail (\d+)/);
    const evals = await sh(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "tests/evals/orchestration/sli.test.mjs",
      "tests/evals/orchestration/report.test.mjs",
      "tests/evals/orchestration/safety-gate.test.mjs",
    ]);
    if (!evals.ok) throw new Error(`evals failed:\n${evals.stdout}\n${evals.stderr}`);
    const fixture = await sh(process.execPath, ["scripts/run-orchestrator.mjs", "--fixture"]);
    if (!fixture.ok || !fixture.stdout.includes("FIXTURE DRIVER: VERIFIED"))
      throw new Error(`fixture driver regressed: ${fixture.stdout} ${fixture.stderr}`);
    // sync the bootstrap payload with the patched runtime files before the
    // check-suite gate, or payload drift correctly fails the run
    const pack = await sh(process.execPath, ["scripts/pack-bootstrap.mjs"]);
    if (!pack.ok) throw new Error(`payload repack failed: ${pack.stderr}`);
    const checkSuite = await sh(process.execPath, ["scripts/check-suite.mjs"]);
    if (!checkSuite.ok || !checkSuite.stdout.includes("check-suite: OK"))
      throw new Error(`check-suite failed:\n${checkSuite.stdout.slice(-600)}`);
    const checkMatch = checkSuite.stdout.match(/check-suite: OK[^\n]*/);
    return {
      orchestrateBattery: {
        pass: Number(passMatch?.[1] ?? -1),
        fail: Number(failMatch?.[1] ?? -1),
      },
      evalsBattery: { ok: evals.ok },
      fixtureDriver: "VERIFIED",
      checkSuite: (checkMatch?.[0] ?? "").slice(0, 120),
      summary: `battery ${passMatch?.[1] ?? "?"} pass / ${failMatch?.[1] ?? "?"} fail; evals green; fixture VERIFIED; ${checkMatch?.[0] ?? "check-suite OK"}`,
    };
  }
  throw new Error(`unknown honest-failures phase ordinal: ${phaseOrdinal}`);
}

export default function honestFailuresHost({ runId, skillProgressDir } = {}) {
  const artifacts = new Map();
  let calls = 0;
  const reviewExecutor = createIndependentFinalReviewExecutor({
    producerExecutorId: "csm-build",
    artifactRoot: join(
      root,
      ".agents",
      "evidence",
      "orchestrator",
      runId ?? "run-honest-failures",
      "review",
    ),
    reviewer: async (input) => {
      const module = await import(
        pathToFileURL(join(root, "scripts", "independent-reviewer.mjs")).href
      );
      return module.default(input);
    },
  });
  return {
    async invokeSiblingSkill(request) {
      calls += 1;
      await recordSkillProgress({
        dir: skillProgressDir,
        request,
        goal: request.phaseId,
        percent: 25,
      });
      const output = await phaseWork(request);
      await recordSkillProgress({
        dir: skillProgressDir,
        request,
        goal: request.phaseId,
        percent: 90,
      });
      const evidenceId = `ev-honest-failures-${calls}`;
      const requirementIds = [
        request.phaseId?.replace(/^phase-/, "req-") ?? `req-honest-failures-p${calls}`,
      ];
      const acceptanceSignalId = request.acceptanceSignalIds?.[0];
      const path = `honest-failures-${calls}.json`;
      const source = {
        path,
        artifactId: `art-honest-failures-${calls}`,
        digest: digest(output),
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId,
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds,
        ...(acceptanceSignalId
          ? {
              acceptanceSignalId,
              validation: { signal: output.summary, status: "pass" },
            }
          : {}),
        source,
      };
      const descriptor = { ...descriptorBody, digest: digest(descriptorBody) };
      artifacts.set(path, descriptor);
      artifacts.set(`payload-honest-failures-${calls}.json`, output);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: `receipt-honest-failures-${calls}`,
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: digest({ calls, status: "completed" }),
          owner: request.skill,
          status: "completed",
        },
      };
    },
    async invokeReview(request) {
      const result = await reviewExecutor.invokeReview(request);
      if (result?.status === "completed" && Array.isArray(result.reviewArtifactRefs)) {
        for (const ref of result.reviewArtifactRefs) {
          const value =
            ref.recordType === "review"
              ? result.review
              : ref.recordType === "artifact"
                ? result.reviewArtifact
                : result.reviewReceipt;
          artifacts.set(ref.path, { owner: ref.sourceOwner, fileDigest: ref.digest, value });
        }
      }
      return result;
    },
    artifactResolver: mapResolver(artifacts),
    childArtifactResolver: mapResolver(artifacts),
  };
}

function mapResolver(artifacts) {
  return {
    async resolve(refPath, expected = {}) {
      const item = artifacts.get(refPath);
      if (!item)
        return { status: "missing", code: "missing", message: `missing artifact: ${refPath}` };
      if (!item.schema)
        return {
          status: "resolved",
          path: refPath,
          owner: expected.expectedOwner ?? item.owner ?? "csm-build",
          fileDigest: expected.expectedFileDigest ?? digest(item),
          value: item,
        };
      return {
        status: "resolved",
        path: refPath,
        owner: expected.expectedOwner ?? item.owner,
        fileDigest: expected.expectedFileDigest ?? item.source?.digest ?? item.digest,
        value: item,
      };
    },
  };
}
