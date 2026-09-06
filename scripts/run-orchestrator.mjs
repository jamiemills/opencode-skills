// One-command orchestrator driver: wires the durable store, telemetry, and
// autonomy policy, runs orchestrate() on an approach file, and persists the
// terminal receipt as deployment evidence.
//
// Usage:
//   node scripts/run-orchestrator.mjs --fixture
//   node scripts/run-orchestrator.mjs --approach <approach.json> [--host <host.mjs>] [--run-id <runId>]
//            [--approvals <approvals.mjs>]  (default: createAutonomyPolicy — 3 read-only skills auto-approve)
//            [--final-review <reviewer.mjs>]  (independent terminal review; without it a fully
//                                              executed run ends REQUIRES_REVIEW)
//
// --fixture  self-test: built-in fixture host + trivial approach; must VERIFIED.
// --approach approach file (csm-approach/1) for a real run.
// --host     module exporting `default` = host factory ({runId}) -> host
//            ({invokeSiblingSkill, invokeReview?}). Required for real runs.
//            The host IS your workload: implement your real skill dispatch there.
"use strict";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, lstat, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";
import { emitRunProjections } from "./lib/run-projections.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import {
  createExecutorHandlers,
  createExecutorDescriptors,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import { createAllBuildHandoffs } from "../csm-orchestrate/lib/csm-build-handoff.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function loadApproach(approachPath) {
  const approach = JSON.parse(await readFile(approachPath, "utf8"));
  assert.equal(approach.schema, "csm-approach/1", "approach file must be csm-approach/1");
  assert.equal(typeof approach.runId, "string", "approach.runId is required");
  return approach;
}

async function loadHostModule(hostPath, runId, skillProgressDir) {
  const module = await import(pathToFileURL(path.resolve(hostPath)).href);
  if (typeof module.default !== "function") {
    throw new TypeError("host module must default-export a factory: ({runId}) => host");
  }
  return module.default({ runId, skillProgressDir });
}

const RUN_LOCK = ".run-lock";
const RUN_LOCK_FORMAT = "csm-run-lock/1";

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// S1/A3: fail-fast run lease at <evidenceDir>/.run-lock (ledger-style EEXIST
// claim, inode-guarded release — never durable-json acquireLock and never
// auto-takeover of a LIVE owner). --resume performs a guarded takeover of a
// STALE lease only (owner pid dead via kill(pid, 0)); any live-owner conflict
// is a hard error naming the holder. Two concurrent fresh starts on one runId
// race here after the honest-failure guard: the lease is the atomic claim.
async function acquireRunLease({ evidenceDir, runId, resume = false }) {
  const lockPath = join(evidenceDir, RUN_LOCK);
  const claim = {
    format: RUN_LOCK_FORMAT,
    kind: "run",
    token: createHash("sha256")
      .update(`${process.pid}-${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 16),
    pid: process.pid,
    runId,
    createdAt: new Date().toISOString(),
  };
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o644);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      owner = null;
    }
    const ownerPid = owner && typeof owner.pid === "number" ? owner.pid : "unknown";
    const ownerAlive = typeof ownerPid === "number" && isPidAlive(ownerPid);
    if (resume && !ownerAlive && typeof ownerPid === "number") {
      await rm(lockPath, { force: true });
      handle = await open(lockPath, "wx", 0o644);
      console.error(
        `run ${runId}: removed stale run lease (held by dead pid ${ownerPid}) under --resume`,
      );
    } else {
      const where = ownerAlive ? "is already active" : "has a stale lease";
      throw new Error(
        `run ${runId} ${where} (lease ${lockPath} held by pid ${ownerPid}); wait for it to finish, or pass --resume only when that process is dead`,
        { cause: error },
      );
    }
  }
  const { ino } = await handle.stat();
  await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`);
  return {
    lockPath,
    claim,
    async release() {
      try {
        const current = await lstat(lockPath).catch(() => null);
        if (current !== null && current.ino === ino) await rm(lockPath, { force: true });
      } finally {
        await handle.close();
      }
    },
  };
}

async function fixtureMode() {
  const { hostFixture, approachFor, reviewEvidenceRoot } =
    await import("../tests/helpers-final-review.mjs");
  const { createIndependentFinalReviewExecutor } =
    await import("../csm-orchestrate/lib/adversarial-final-review.mjs");
  const { createArtifactResolver } = await import("../lib/artifact-resolver/index.mjs");
  const { loadSchemaRegistry } = await import("../lib/schema-runtime/index.mjs");
  const runId = `run-orchestrator-fixture-${Date.now()}`;
  const host = hostFixture({ ideaSlug: "driver-fixture" });
  const capabilities = await loadCapabilities();
  const reviewArtifactRoot = reviewEvidenceRoot("driver-review-");
  const reviewSchemaRegistry = await loadSchemaRegistry();
  const reviewResolver = createArtifactResolver({
    root: reviewArtifactRoot,
    schemaRegistry: reviewSchemaRegistry,
  });
  const evidenceDir = await mkdtemp(join(tmpdir(), "orchestrator-fixture-"));
  const dbPath = join(evidenceDir, "cursor.db");
  const telemetryPath = join(evidenceDir, "telemetry.jsonl");
  const cursorStore = createSqliteStore({ mode: "wal", databasePath: dbPath });
  const telemetryEmitter = createTelemetryEmitter({
    transport: createJsonlTransport(telemetryPath),
    runId,
  });
  // fixture self-test uses the host invocation path (not skill dispatch);
  // enforcement stays off for this test-only mode
  const result = await orchestrate({
    approach: approachFor(runId, "driver-fixture"),
    enforceSkillFirstRouting: false,
    runId,
    host,
    capabilities,
    signals: { capabilities: ["csm-build"], inputs: ["plan"] },
    // fixture-only: permissive approvals. Real runs use createAutonomyPolicy
    // (3 read-only skills auto-approve; everything else stays human-gated).
    approvals: async ({ phase, node, childRunId }) => ({
      schema: "csm-orchestrate-approval/1",
      approvalId: `approval-${childRunId}`,
      binding: {
        parentRunId: runId,
        childRunId,
        phaseId: phase.phaseId,
        edgeId: `edge-${node.nodeId}`,
      },
      scope: node.approvalScope.length ? node.approvalScope : ["read"],
      approvedDigest: node.capabilityDigest,
      approvedAt: "2026-09-05T00:00:00.000Z",
      expiresAt: "2099-09-05T00:00:00.000Z",
      status: "approved",
    }),
    cursorStore,
    maxSteps: 25,
    telemetryEmitter,
    artifactResolver: reviewResolver,
    childArtifactResolver: host.artifactResolver,
    schemaRegistry: {
      resolve() {},
      validate() {
        return { valid: true, errors: [] };
      },
    },
    reviewArtifactRoot,
    finalReviewExecutor: createIndependentFinalReviewExecutor({
      producerExecutorId: "csm-build",
      artifactRoot: reviewArtifactRoot,
      reviewer: async ({ requirements, evidence: reviewEvidence, phaseResults: reviewPhases }) => ({
        status: "ACCEPTED",
        requirementCoverage: requirements.map((requirement) => ({
          requirementId: requirement.requirementId,
          evidenceRefs: reviewEvidence
            .filter((item) => item.requirementIds?.includes(requirement.requirementId))
            .map((item) => item.evidenceId),
        })),
        evidenceEntailment: "supported",
        technical: reviewPhases.flatMap((item) => item.gate.technical),
        functional: reviewPhases.flatMap((item) => item.gate.functional),
        findings: [],
      }),
    }),
    producerExecutorId: "csm-build",
  });
  await writeFile(
    join(evidenceDir, "receipt.json"),
    `${JSON.stringify(result.receipt, null, 2)}\n`,
  );
  console.log(
    "FIXTURE DRIVER:",
    result.receipt.outcome.status,
    "| reason:",
    result.reason ?? "none",
  );
  await rm(evidenceDir, { recursive: true, force: true });
  return result.receipt.outcome.status === "VERIFIED" ? 0 : 1;
}

async function realMode() {
  const approachPath = argValue("--approach");
  if (!approachPath) {
    console.error("real runs require --approach <approach.json> (and --host <host.mjs>)");
    return 1;
  }
  const hostPath = argValue("--host");
  if (!hostPath) {
    console.error(
      "real runs require --host <host.mjs> (default-exported factory ({runId}) => host with invokeSiblingSkill)",
    );
    return 1;
  }
  const approach = await loadApproach(approachPath);
  const runId = argValue("--run-id") ?? approach.runId;
  // skill-first routing: real runs dispatch to csm skills by default. Host-based
  // incidental/test runs opt out explicitly with --allow-host-dispatch.
  const allowHostDispatch = args.includes("--allow-host-dispatch");
  if (allowHostDispatch)
    console.error(
      "SKILL-FIRST DISPATCH DISABLED — phase work will not route to csm skills (--allow-host-dispatch)",
    );
  if (runId !== approach.runId)
    throw new Error(
      "--run-id must equal approach.runId (autonomy approvals bind to the compiled phase.runId); " +
        `got ${runId}, approach declares ${approach.runId}`,
    );
  const capabilities = await loadCapabilities();
  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);
  await mkdir(evidenceDir, { recursive: true });
  const skillProgressDir = join(evidenceDir, "skill-progress");
  await mkdir(skillProgressDir, { recursive: true });
  // one directory serves recording (hosts) and rollup (orchestrate option)
  const skillProgressRollupDir = skillProgressDir;
  // honest-failure guard: silently reusing durable state surfaces as progress
  // fencing staleness; require an explicit --resume or a fresh approach.runId
  if (!args.includes("--resume") && existsSync(join(evidenceDir, "cursor.db")))
    throw new Error(
      `run ${runId} already has durable state; pass --resume to continue recovery or use a fresh approach.runId`,
    );
  // S1: fail-fast run lease — the atomic claim for two concurrent fresh starts
  // on one runId. Acquired after the honest-failure guard (its message stays
  // preserved) and before the host module loads; released on every path below.
  const lease = await acquireRunLease({
    evidenceDir,
    runId,
    resume: args.includes("--resume"),
  });
  try {
    const host = await loadHostModule(hostPath, runId, skillProgressDir);
    const hostArtifactResolver = host.artifactResolver ?? null;
    const hostChildArtifactResolver = host.childArtifactResolver ?? hostArtifactResolver;
    const timeoutMs = Number(argValue("--timeout-ms") ?? 600_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("--timeout-ms must be a positive number of milliseconds");
    const quietProgress = args.includes("--quiet-progress");
    const progressPollMs = Number(argValue("--progress-poll-ms") ?? 2000);
    if (!Number.isFinite(progressPollMs) || progressPollMs <= 0)
      throw new Error("--progress-poll-ms must be a positive number of milliseconds");
    // one dedupe closure for live and final renders: consecutive identical TASK
    // PROGRESS blocks are suppressed everywhere
    const renderProgressOnChange = (() => {
      let lastProgressText = "";
      return (snapshot) => {
        const text = projectProgress(snapshot, { width: 28 }).text;
        if (text === lastProgressText) return; // render on visible change only
        lastProgressText = text;
        console.log(text);
      };
    })();
    const cursorStore = createSqliteStore({
      mode: "wal",
      databasePath: join(evidenceDir, "cursor.db"),
    });
    const telemetryEmitter = createTelemetryEmitter({
      transport: createJsonlTransport(join(evidenceDir, "telemetry.jsonl")),
      runId,
    });
    const { loadSchemaRegistry: loadRealRegistry } =
      await import("../lib/schema-runtime/index.mjs");
    const schemaRegistry = await loadRealRegistry();
    const approvalsModule = argValue("--approvals")
      ? await import(pathToFileURL(path.resolve(argValue("--approvals"))).href)
      : null;
    // Independent final review: --final-review <module.mjs> default-exports an
    // async reviewer(input) -> {status: ACCEPTED|REJECTED, ...}; it is wrapped in
    // createIndependentFinalReviewExecutor so review records are persisted and
    // provenance is built by the runtime, never by the reviewer itself.
    const finalReviewPath = argValue("--final-review");
    let finalReviewExecutor = null;
    const reviewRoot = join(evidenceDir, "review");
    if (finalReviewPath) {
      const { createIndependentFinalReviewExecutor } =
        await import("../csm-orchestrate/lib/adversarial-final-review.mjs");
      const reviewerModule = await import(pathToFileURL(path.resolve(finalReviewPath)).href);
      const reviewer =
        typeof reviewerModule.default === "function"
          ? reviewerModule.default
          : typeof reviewerModule.reviewer === "function"
            ? reviewerModule.reviewer
            : null;
      if (!reviewer) throw new Error("--final-review module must export a reviewer function");
      finalReviewExecutor = createIndependentFinalReviewExecutor({
        producerExecutorId: "csm-build",
        artifactRoot: reviewRoot,
        reviewer,
      });
    }
    // The parent resolver serves host artifacts first, then falls back to the
    // real file-backed resolver over the review artifact root, so runtime-
    // persisted independent-review records resolve without host knowledge.
    const { createArtifactResolver } = await import("../lib/artifact-resolver/index.mjs");
    const reviewFileResolver = createArtifactResolver({ root: reviewRoot, schemaRegistry });
    const parentResolver = hostArtifactResolver
      ? {
          async resolve(refPath, expected = {}) {
            const fromHost = await hostArtifactResolver.resolve(refPath, expected);
            if (fromHost?.status === "resolved") return fromHost;
            return reviewFileResolver.resolve(refPath, expected);
          },
        }
      : reviewFileResolver;
    // skill-first dispatch: when enforcement is on, wire an in-process executor
    // adapter over the registered csm skill handlers so phase routes genuinely
    // dispatch to skills (csm-ddd/csm-scan/csm-upload run real pipelines;
    // csm-build-owned skills return blocked/agent-session-required until the
    // agent-session protocol ships). --allow-host-dispatch opts out entirely.
    let executorAdapter = null;
    let executorRegistry = null;
    let executorBindings = {};
    if (!allowHostDispatch) {
      const handlers = createExecutorHandlers({ csmBuildHandoffs: createAllBuildHandoffs() });
      const descriptors = createExecutorDescriptors({
        handlers,
        csmBuildHandoffs: createAllBuildHandoffs(),
      });
      const registry = await createSkillExecutorRegistry({ descriptors });
      executorBindings = Object.fromEntries(
        descriptors.map((descriptor) => [descriptor.skill, descriptor]),
      );
      executorAdapter = createInProcessExecutorAdapter({
        registry,
        bindings: executorBindings,
        capabilities,
        artifactResolver: parentResolver,
        schemaRegistry,
        cursorStore,
      });
      executorRegistry = registry;
    }
    const result = await orchestrate({
      approach,
      runId,
      host,
      capabilities,
      signals: approach.signals ?? { capabilities: [], inputs: [] },
      approvals: approvalsModule ? approvalsModule.default : createAutonomyPolicy(capabilities),
      cursorStore,
      maxSteps: 25,
      // real hosts do real work (test suites, evaluations); the 30s runtime
      // default is tuned for in-process fixtures and fails legitimate builds
      timeoutMs,
      telemetryEmitter,
      schemaRegistry,
      producerExecutorId: "csm-build",
      skillProgressRollupDir,
      progressPollIntervalMs: progressPollMs,
      ...(quietProgress
        ? {}
        : {
            onProgress: renderProgressOnChange,
          }),
      ...(finalReviewExecutor ? { finalReviewExecutor } : {}),
      artifactResolver: parentResolver,
      reviewArtifactRoot: reviewRoot,
      ...(hostChildArtifactResolver ? { childArtifactResolver: hostChildArtifactResolver } : {}),
      enforceSkillFirstRouting: !allowHostDispatch,
      ...(executorAdapter
        ? {
            executorAdapter,
            executorRegistry,
            executorBindings,
          }
        : {}),
    });
    await copyFile(approachPath, join(evidenceDir, "approach.json"));
    await writeFile(
      join(evidenceDir, "receipt.json"),
      `${JSON.stringify(result.receipt, null, 2)}\n`,
    );
    // human-readable projections (untrusted presentation; JSON stays authoritative)
    await emitRunProjections({
      dir: evidenceDir,
      receipt: result.receipt,
      runId,
      schemaRegistry,
    });
    // persist the final progress snapshot (machine + human) into the evidence dir
    if (result.progress) {
      await writeFile(
        join(evidenceDir, "progress.json"),
        `${JSON.stringify(result.progress, null, 2)}\n`,
      );
      await writeFile(
        join(evidenceDir, "progress.txt"),
        `${projectProgress(result.progress, { width: 28 }).text}\n`,
      );
    }
    // drain the async transport so telemetry.jsonl is complete before exit
    await telemetryEmitter.getEvents();
    if (result.progress && !quietProgress) {
      renderProgressOnChange(result.progress);
    }
    console.log("status:", result.receipt.outcome.status);
    console.log("reason:", result.reason ?? "none");
    console.log("evidence:", evidenceDir);
    return 0;
  } finally {
    await lease.release();
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  (async () => {
    if (args[0] === "--fixture") process.exit(await fixtureMode());
    if (args[0] === "--approach") process.exit(await realMode());
    console.error(
      "usage: run-orchestrator.mjs --fixture | --approach <approach.json> [--host <host.mjs>] [--run-id <runId>] [--approvals <module.mjs>] [--final-review <reviewer.mjs>] [--timeout-ms <ms>] [--progress-poll-ms <ms>] [--allow-host-dispatch] [--quiet-progress] [--resume]",
    );
    process.exit(1);
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
