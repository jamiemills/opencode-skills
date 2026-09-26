// One-command orchestrator driver: wires the durable store, telemetry, and
// autonomy policy, runs orchestrate() on an approach file, and persists the
// terminal receipt as deployment evidence.
//
// Usage:
//   node scripts/run-orchestrator.mjs --fixture
//   node scripts/run-orchestrator.mjs --approach <approach.json> [--host <host.mjs>] [--run-id <runId>]
//   node scripts/run-orchestrator.mjs --plan <plan.json>
//   node scripts/run-orchestrator.mjs --request <request.json>
//            [--approvals <approvals.mjs>]  (default: createAutonomyPolicy — 3 read-only skills auto-approve)
//            [--final-review <reviewer.mjs>]  (independent terminal review; without it a fully
//                                              executed run ends REQUIRES_REVIEW)
//            [--verified-sandbox <config.json|config.mjs>]  (T012/N1: pass a
//                                              verified-sandbox runtime config through to
//                                              orchestrate(); a .mjs must default-export it so
//                                              function fields can be supplied)
//            [--use-jev]  (T009: opt in to the provider-pluggable typed-decision layer;
//                                              dormant — no adapter, no network — without the
//                                              flag and without a resolved provider + key)
//
// Input flags route on the artifact's schema marker (lib/intake.mjs):
// --fixture  self-test: built-in fixture host + trivial approach; must VERIFIED.
// --approach approach file (csm-approach/1) for a real run.
// --plan     csm-plan/1 or csm-plan/2 envelope: classified kind execute-plan -> csm-build route.
// --request  csm-orchestrate-request/1 envelope: classified via lib/request-router.mjs.
//            Plan/request routes exit with the blocked agent-session-required result
//            unless the env gate CSM_AGENT_SESSION_EXEC=1 is set AND the classified
//            route is csm-build, when the driver fabricates a handoff identity,
//            applies the approvals gate, and runs the agent-session executor directly
//            (see realModeBypass; env vars documented there).
// --host     module exporting `default` = host factory ({runId}) -> host
//            ({invokeSiblingSkill, invokeReview?}). Required for the --approach path
//            only (plan/request bypass routes to skill executors, never hosts).
//            The host IS your workload: implement your real skill dispatch there.
"use strict";

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, lstat, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createWorkerStateReducer,
  orchestrate,
  projectProgress,
  projectWorkerTable,
} from "../csm-orchestrate/index.mjs";
import { emitRunProjections } from "./lib/run-projections.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import {
  createExecutorHandlers,
  createExecutorDescriptors,
  resolveThinWorkerAdapter,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { createInProcessExecutorAdapter } from "../csm-orchestrate/lib/skill-executor-adapter.mjs";
import { createSkillExecutorRegistry } from "../csm-orchestrate/lib/skill-executor-registry.mjs";
import {
  createAllBuildHandoffs,
  createCsmBuildHandoff,
} from "../csm-orchestrate/lib/csm-build-handoff.mjs";
import { intakeArtifact } from "../csm-orchestrate/lib/intake.mjs";
import { persistAdapterDecisions } from "../csm-orchestrate/lib/decision-adapter/artifact.mjs";
import { createTraceLifecycleHooks } from "../csm-orchestrate/lib/trace-hooks.mjs";
import { appendTrace, recordDecision } from "./lib/trace-log.mjs";
import { resolveTracePolicy, evaluateTraceGate } from "./lib/trace-enforcement.mjs";
import { resolveVerificationPath, verifyTraces } from "./verify-traces.mjs";
import { createConsultSeam } from "../csm-orchestrate/lib/decision-adapter/consult.mjs";
import { classifyRequest } from "../csm-orchestrate/lib/request-router.mjs";
import {
  explicitModeSkills,
  guardRouteDecision,
  isNoRouteError,
  resolveRouteDecision,
} from "../csm-orchestrate/lib/phase-compiler.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import {
  createJsonlTransport,
  createTelemetryEmitter,
  repairTelemetryJsonlTail,
} from "../csm-orchestrate/lib/telemetry.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest } from "../lib/schema-runtime/index.mjs";
import { createCsmBuildAgentSessionExecutor } from "./lib/agent-session-executor.mjs";

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

// T003: explicit host-side trace-enforcement flag. A repo-controlled config
// file can never force enforcement off; only this flag / CSM_TRACE_ENFORCE can.
function tracePolicyFlag() {
  if (args.includes("--require-trace")) return "required";
  if (args.includes("--no-require-trace")) return "off";
  return null;
}

// T003: audit-emission gate. It never mutates the run receipt and never gates on
// Jev; it reports whether the run's trace is missing under the resolved policy.
export async function enforceTraceGate({
  traceFile,
  runId,
  scheduled,
  actor = "csm-orchestrate",
  jevActive = false,
}) {
  const policy = resolveTracePolicy({ flag: tracePolicyFlag(), env: process.env, jevActive });
  const matched = verifyTraces({ file: traceFile, runId }).matched;
  const gate = evaluateTraceGate({ policy, scheduled, matched });
  if (gate.ok) return gate;
  try {
    await recordDecision(
      {
        runId,
        actor,
        action: "trace-verification-failed",
        target: traceFile,
        justification: `policy ${policy}`,
        outcome: gate.reason,
      },
      { file: traceFile },
    );
  } catch {
    console.error(`trace-verification-failed: ${gate.reason} (${traceFile})`);
  }
  return gate;
}

// Intake binds the input flag to the artifact's schema marker so a --approach
// file can never silently run the plan/request bypass (or vice versa). The
// marker switch + light field checks (never full JSON-schema validation of
// plan/request envelopes) live in lib/intake.mjs (intakeArtifact).
const INPUT_FLAG_KIND = {
  "--approach": "approach",
  "--plan": "plan",
  "--request": "request",
};

async function loadInput(inputPath, flag) {
  const expectedKind = INPUT_FLAG_KIND[flag];
  const intake = await intakeArtifact(inputPath);
  if (intake.kind !== expectedKind)
    throw new TypeError(
      `run-orchestrator: ${flag} requires a ${expectedKind} artifact; ` +
        `intake resolved schema marker "${intake.artifact.schema}" as kind ${intake.kind}`,
    );
  return intake;
}

async function loadHostModule(hostPath, runId, skillProgressDir) {
  const module = await import(pathToFileURL(path.resolve(hostPath)).href);
  if (typeof module.default !== "function") {
    throw new TypeError("host module must default-export a factory: ({runId}) => host");
  }
  return module.default({ runId, skillProgressDir });
}

// T012/N1: optional verified-sandbox runtime config. The driver config path is
// the smallest safe step that makes `verifiedSandboxRuntime` driver-wireable
// instead of an API-only option: orchestrate() already resolves and binds the
// config, so the driver only loads it and passes it through. A `.json` path is
// parsed as a plain config; any other path must default-export a config object
// (or a ready runtime) so function-valued fields — provider, forward,
// sandboxExecutor — can be supplied. An enabled config that cannot be
// constructed still resolves to a fail-closed runtime, never a silent
// unmediated sandbox.
async function loadVerifiedSandboxConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (resolved.endsWith(".json")) return JSON.parse(await readFile(resolved, "utf8"));
  const module = await import(pathToFileURL(resolved).href);
  const config = module.default ?? module.sandboxRuntime ?? null;
  if (config === null || typeof config !== "object")
    throw new TypeError("--verified-sandbox module must default-export a config object");
  return config;
}

// T009: optional Jev typed-decision opt-in. The layer is dormant by default:
// with no --use-jev flag and no request/2 decision block, no provider registry
// is consulted and no adapter is constructed. --use-jev forces live mode; a
// request/2 artifact may also opt in via its {decision:{mode,points}} block. Even
// when opted in, the adapter is built only when the selected provider resolves
// (CSM_DECISION_PROVIDER, default openrouter) AND its apiKeyEnv is set — a
// missing key leaves the run byte-identical to the decision-free path and makes
// no network call. The key is read from process.env at construction, handed to
// the transport in a single-key env, and never logged or persisted. T010 owns
// consuming the returned adapter (guarded routing); this only wires the driver.
const USE_JEV_FLAG = "--use-jev";
const DECISION_MODES = Object.freeze(["off", "shadow", "live"]);

// A malformed/absent decision block is ignored (dormant), never fatal — the
// fail-open contract. The explicit flag takes precedence over the artifact mode.
function parseDecisionOptIn(artifact, kind) {
  if (args.includes(USE_JEV_FLAG)) return { mode: "live", points: null };
  const block = kind === "request" ? artifact?.decision : null;
  if (block === null || typeof block !== "object" || Array.isArray(block)) return null;
  if (!DECISION_MODES.includes(block.mode) || block.mode === "off") return null;
  const points =
    Array.isArray(block.points) && block.points.length
      ? block.points.filter((point) => typeof point === "string" && point.length > 0)
      : null;
  return { mode: block.mode, points: points && points.length ? points : null };
}

async function resolveDecisionAdapter(artifact, kind, runId = null) {
  const optin = parseDecisionOptIn(artifact, kind);
  if (!optin) return null;
  try {
    const { createProviderRegistry } =
      await import("../csm-orchestrate/lib/decision-adapter/providers/index.mjs");
    const registry = await createProviderRegistry();
    const selection = registry.select();
    if (selection.unresolved || selection.descriptor === null) {
      console.error(
        `--use-jev ignored: decision provider "${selection.id}" is unresolved (deterministic harness retained)`,
      );
      return null;
    }
    const descriptor = selection.descriptor;
    const [{ createDecisionAdapter }, { createDecisionTransport }, { resolveApiKey }] =
      await Promise.all([
        import("../csm-orchestrate/lib/decision-adapter/index.mjs"),
        import("../csm-orchestrate/lib/decision-adapter/transport.mjs"),
        import("../csm-orchestrate/lib/decision-adapter/key-resolution.mjs"),
      ]);
    const resolvedKey = await resolveApiKey({
      apiKeyEnv: descriptor.apiKeyEnv,
      env: process.env,
      repoRoot: process.cwd(),
    });
    if (resolvedKey.key === null) {
      console.error(
        `--use-jev ignored: ${descriptor.apiKeyEnv} is unset in the environment and .env (deterministic harness retained)`,
      );
      return null;
    }
    const apiKey = resolvedKey.key;
    const transport = createDecisionTransport({
      provider: descriptor,
      env: { [descriptor.apiKeyEnv]: apiKey },
    });
    return createDecisionAdapter({
      mode: optin.mode,
      transport,
      // F4: a real runId makes the adapter retain successful results across
      // calls (cross-call memoization); without one it still single-flights.
      runId,
      ...(optin.points ? { points: optin.points } : {}),
    });
  } catch (error) {
    console.error(
      `--use-jev disabled: ${error?.message ?? error} (deterministic harness retained)`,
    );
    return null;
  }
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

// Mirrors the default csm-build handoff blocked failure (csm-build-handoff.mjs):
// the deterministic agent-session-required message a plan/request route surfaces
// until a skill executor exists to run the instruction-led SKILL.md lifecycle.
const agentSessionRequiredMessage = (skill) =>
  `${skill} requires an agent session running its SKILL.md lifecycle. Direct function dispatch is not available for instruction-led skills.`;

// Bypass env surface for the T006 agent-session route. The driver mirrors the
// executor's CSM_AGENT_SESSION_EXEC gate and injects the remaining executor
// options + the approvals test hook through the same process env namespace:
//   CSM_AGENT_SESSION_EXEC          "1" enables the bypass spawn (blocked below).
//   CSM_AGENT_SESSION_APPROVED      "1" documented test hook: grants the bypass
//                                   approval when no --approvals module is given
//                                   (csm-build has workspace-write effects and is
//                                   never auto-approved; real runs need a module).
//   CSM_AGENT_SESSION_AGENT_CLI     path of the agent CLI binary to spawn.
//   CSM_AGENT_SESSION_WORKTREE_ROOT pre-created wt-session worktree root (the
//                                   executor accepts a dir with a .git marker).
//   CSM_AGENT_SESSION_TIMEOUT_MS / CSM_AGENT_SESSION_POLL_INTERVAL_MS optional.
const AGENT_SESSION_EXEC = "CSM_AGENT_SESSION_EXEC";
const AGENT_SESSION_APPROVED = "CSM_AGENT_SESSION_APPROVED";
const AGENT_SESSION_AGENT_CLI = "CSM_AGENT_SESSION_AGENT_CLI";
const AGENT_SESSION_WORKTREE_ROOT = "CSM_AGENT_SESSION_WORKTREE_ROOT";
const AGENT_SESSION_TIMEOUT_MS = "CSM_AGENT_SESSION_TIMEOUT_MS";
const AGENT_SESSION_POLL_INTERVAL_MS = "CSM_AGENT_SESSION_POLL_INTERVAL_MS";

function envPositiveNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function agentSessionExecutorOptions() {
  const options = {};
  const agentCli = process.env[AGENT_SESSION_AGENT_CLI];
  if (agentCli) options.agentCli = agentCli;
  const worktreeRoot = process.env[AGENT_SESSION_WORKTREE_ROOT];
  if (worktreeRoot) options.worktreeRoot = worktreeRoot;
  const timeoutMs = envPositiveNumber(AGENT_SESSION_TIMEOUT_MS);
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  const pollIntervalMs = envPositiveNumber(AGENT_SESSION_POLL_INTERVAL_MS);
  if (pollIntervalMs !== undefined) options.pollIntervalMs = pollIntervalMs;
  return options;
}

// Fabricated-bypass identity slug (H1): plan envelopes carry a slug-like planId,
// request envelopes an explicit goalSlug; fall back to a stable literal.
function bypassGoalSlug(artifact, kind) {
  const raw =
    kind === "request" && typeof artifact.goalSlug === "string" && artifact.goalSlug !== ""
      ? artifact.goalSlug
      : kind === "plan" && typeof artifact.planId === "string" && artifact.planId !== ""
        ? artifact.planId
        : null;
  const slug = String(raw ?? "request")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+$/g, "")
    .slice(0, 48);
  return slug || "request";
}

// Child run id derived from the driver run id must stay canonical (^run-...).
function bypassChildRunId(runId) {
  const trimmed = String(runId).replace(/-+$/, "");
  const base = trimmed.length > 118 ? trimmed.slice(0, 118).replace(/-+$/, "") : trimmed;
  const child = `${base}-child`;
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(child))
    throw new TypeError(`bypass childRunId "${child}" is not a canonical run id`);
  return child;
}

function fabricateBypassApproval({ runId, childRunId, phaseId, edgeId }) {
  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + 3_600_000);
  return Object.freeze({
    schema: "csm-orchestrate-approval/2",
    approvalId: `approval-bypass-${childRunId}`,
    binding: { parentRunId: runId, childRunId, phaseId, edgeId },
    scope: ["read", "write"],
    approvedDigest: digest({ skill: "csm-build", authority: "agent-session-bypass-test-hook" }),
    approvedAt: approvedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "approved",
  });
}

// Approvals gate for the bypass, run BEFORE any spawn. csm-build has
// workspace-write effects, so the default createAutonomyPolicy never approves it
// (an external --approvals module is the real grant authority). When no module
// is provided the documented CSM_AGENT_SESSION_APPROVED=1 test hook stands in as
// the approval; otherwise the gate denies exactly like orchestrate's
// missing-approval hard block.
async function resolveBypassApproval({ runId, childRunId, phaseId, edgeId, approvalsModule }) {
  const phase = { runId, phaseId };
  const node = {
    skill: "csm-build",
    nodeId: edgeId.replace(/^edge-/, ""),
    sideEffects: ["workspace-write"],
  };
  if (approvalsModule) {
    if (typeof approvalsModule.default !== "function")
      throw new TypeError("--approvals module must default-export an approvals function");
    const approval = await approvalsModule.default({ phase, node, childRunId });
    return approval?.status === "approved" ? approval : null;
  }
  if (process.env[AGENT_SESSION_APPROVED] === "1")
    return fabricateBypassApproval({ runId, childRunId, phaseId, edgeId });
  const capabilities = await loadCapabilities();
  const approval = await createAutonomyPolicy(capabilities)({ phase, node, childRunId });
  return approval?.status === "approved" ? approval : null;
}

const bypassDenialMessage = ({ runId, skill, phaseId, edgeId, childRunId }) =>
  `${skill} bypass dispatch for run ${runId} (${phaseId}/${edgeId}/${childRunId}) was denied: ` +
  `no approval granted (missing-approval: approval is required; telemetry approval denied). ` +
  `${skill} has workspace-write effects and is never auto-approved — approve it via an external ` +
  `--approvals module, or set ${AGENT_SESSION_APPROVED}=1 (documented test hook only).`;

// T010: guarded routing seam for the plan/request bypass. The deterministic
// classifier stays authoritative; an injected Jev decision may only replace an
// empty route set or confirm an existing route, explicit-mode skills are never
// Jev-selectable, and any disagreement (or an absent/off/shadow adapter) leaves
// the classification byte-identical.
async function classifyRequestGuarded(request, decisionAdapter) {
  let classification = null;
  let failure = null;
  try {
    classification = classifyRequest(request);
  } catch (error) {
    if (!isNoRouteError(error)) throw error;
    failure = error;
  }
  if (!decisionAdapter) {
    if (failure) throw failure;
    return classification;
  }
  const loaded = await loadCapabilities();
  const capabilities = Array.isArray(loaded) ? loaded : (loaded?.skills ?? []);
  const deterministicRoutes = classification?.routes ?? [];
  const decision = await resolveRouteDecision(decisionAdapter, {
    seam: "request-router",
    pointId: "route-classification",
    request,
    deterministicRoutes,
    candidates: capabilities
      .filter((capability) => capability?.activation?.mode !== "explicit")
      .map((capability) => capability.skill),
  });
  const guard = guardRouteDecision(deterministicRoutes, decision, {
    explicitSkills: explicitModeSkills(capabilities),
    selectableSkills: new Set(capabilities.map((capability) => capability.skill)),
  });
  if (!classification) {
    if (!guard.applied) throw failure;
    return {
      goalSlug:
        typeof request?.goalSlug === "string" && request.goalSlug.trim() !== ""
          ? request.goalSlug
          : "request",
      kind: null,
      routes: [...guard.routes],
      signals: { capabilities: [...guard.routes], inputs: [] },
    };
  }
  return classification;
}

// T004/T006 realMode bypass for plan/request intakes (approach keeps the
// orchestrate() flow above; --host is approach-only). The driver classifies the
// request and, unless the env gate CSM_AGENT_SESSION_EXEC=1 is on AND the route
// is csm-build, exits non-zero with the blocked agent-session-required result —
// thrown so it surfaces exactly like every other realMode error at the bottom
// isMain catch (message on stderr, exit 1). For the csm-build route under the
// gate, the driver fabricates the handoff identity from the artifact's canonical
// runId (invocation-<slug>-<childRunId> / parentRunId=runId / phase-<goalSlug>-
// execute / edge-<goalSlug>-execute), applies the approvals gate BEFORE any
// spawn, and invokes the createCsmBuildHandoff({skill:"csm-build", execute})
// wrapper directly (its defaults provide the request/1 + csm-build-output/1
// schema digests). No orchestrate() graph or executor registry is involved; the
// executor wiring keys its evidence/lease off the driver runId.
async function realModeBypass({ kind, artifact, artifactPath }) {
  // Driver runId is the artifact's own canonical runId (validated by
  // intakeArtifact) — unique per plan/request artifact, so the executor keys
  // evidence dir + lease off it without changes.
  const runId = artifact.runId;
  const request =
    kind === "plan"
      ? { kind: "execute-plan", artifactRef: "plan" } // plan envelope -> csm-build
      : artifact;
  // T009/T010: build the dormant decision adapter (null without opt-in); only
  // when one is injected does classification go through the guard. The
  // deterministic path stays byte-identical when no adapter is present.
  const decisionAdapter = await resolveDecisionAdapter(artifact, kind, runId);
  const guardedClassification =
    decisionAdapter === null
      ? classifyRequest(request)
      : await classifyRequestGuarded(request, decisionAdapter);
  // (b) keep the blocked behavior for route skills other than csm-build and for
  // the env-off case (pre-executor parity).
  if (
    process.env[AGENT_SESSION_EXEC] !== "1" ||
    !guardedClassification.routes.includes("csm-build")
  ) {
    const blocked = guardedClassification.routes
      .map((skill) => agentSessionRequiredMessage(skill))
      .join("\n");
    throw new Error(blocked);
  }
  const slug = bypassGoalSlug(artifact, kind);
  const childRunId = bypassChildRunId(runId);
  const phaseId = `phase-${slug}-execute`;
  const edgeId = `edge-${slug}-execute`;
  const invocationId = `invocation-${slug}-${childRunId}`;
  const approvalsModulePath = argValue("--approvals");
  const approvalsModule = approvalsModulePath
    ? await import(pathToFileURL(path.resolve(approvalsModulePath)).href)
    : null;
  const approval = await resolveBypassApproval({
    runId,
    childRunId,
    phaseId,
    edgeId,
    approvalsModule,
  });
  if (!approval)
    throw new Error(
      bypassDenialMessage({ runId, skill: "csm-build", phaseId, edgeId, childRunId }),
    );
  const evidenceDir = join(".agents", "evidence", "orchestrator", runId);
  await mkdir(evidenceDir, { recursive: true });
  const executor = createCsmBuildAgentSessionExecutor(agentSessionExecutorOptions());
  const handoff = createCsmBuildHandoff({ skill: "csm-build", execute: executor.execute });
  const result = await handoff.execute({
    invocationId,
    parentRunId: runId,
    childRunId,
    phaseId,
    edgeId,
    skill: "csm-build",
    retry: { attempt: 0 },
    input: { artifactPath, plan: artifact },
    ...(decisionAdapter ? { decisionAdapter } : {}),
  });
  // F2: persist the run's applied decisions. Fail-open: an absent/off adapter,
  // no real runId, or no applied record writes nothing.
  if (decisionAdapter) await persistAdapterDecisions({ adapter: decisionAdapter, runId });
  await writeFile(join(evidenceDir, "bypass-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  // T003: the bypass path schedules one deterministic run trace and is gated on
  // it, so a run that fails to emit still fails closed.
  const traceFile = await resolveVerificationPath({ root: process.cwd(), env: process.env });
  try {
    await appendTrace(
      {
        runId,
        actor: "csm-build",
        action: "bypass-run",
        target: kind,
        justification: "deterministic bypass handoff",
        outcome: String(result.status),
      },
      { file: traceFile },
    );
  } catch {
    /* best-effort */
  }
  const traceGate = await enforceTraceGate({
    traceFile,
    runId,
    scheduled: 1,
    actor: "csm-build",
    jevActive: decisionAdapter !== null,
  });
  // T006: optional Jev advisory verifier on the bypass path too, AFTER the
  // deterministic gate so it can never change the outcome. Advisory only.
  if (decisionAdapter) {
    try {
      const seam = createConsultSeam({ adapter: decisionAdapter });
      const advice = await seam.consultPoints(["trace-emission-verdict"], {
        runId,
        traceLogPath: traceFile,
        scheduled: 1,
        matched: verifyTraces({ file: traceFile, runId }).matched,
        gate: traceGate.reason,
      });
      const verdict = advice["trace-emission-verdict"];
      if (verdict)
        await recordDecision(
          {
            runId,
            actor: "csm-build",
            action: "trace-emission-advisory",
            target: traceFile,
            justification: "jev advisory trace-emission verdict",
            outcome: String(verdict.answer ?? "n/a"),
          },
          { file: traceFile },
        );
    } catch {
      /* advisory best-effort */
    }
  }
  console.log("status:", result.status);
  console.log("evidence:", evidenceDir);
  if (!traceGate.ok) {
    console.error(`trace enforcement failed: ${traceGate.reason}`);
    return 1;
  }
  return result.status === "completed" ? 0 : 1;
}

async function realMode() {
  const inputFlag = args[0];
  const inputPath = argValue(inputFlag);
  if (!inputPath) {
    console.error(
      inputFlag === "--approach"
        ? "real runs require --approach <approach.json> (and --host <host.mjs>)"
        : `real runs require ${inputFlag} <artifact.json>`,
    );
    return 1;
  }
  const { kind, artifact } = await loadInput(inputPath, inputFlag);
  // plan/request kinds take the deterministic bypass: no host is involved (host
  // stays approach-only). A csm-build route under CSM_AGENT_SESSION_EXEC=1 runs
  // the T005 agent-session executor handoff directly; everything else terminates
  // with the blocked agent-session-required result.
  if (kind !== "approach") return realModeBypass({ kind, artifact, artifactPath: inputPath });
  const hostPath = argValue("--host");
  if (!hostPath) {
    console.error(
      "real runs require --host <host.mjs> (default-exported factory ({runId}) => host with invokeSiblingSkill)",
    );
    return 1;
  }
  const approach = artifact;
  const approachPath = inputPath;
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
    // T002/T010: optional dynamic-proposal exposure and csm-orchestrate config.
    const dynamicProposalFlag = argValue("--dynamic-proposal");
    const dynamicApprovedFlag = process.argv.includes("--dynamic-approved");
    const dynamicRouteKindFlag = argValue("--dynamic-route-kind") ?? "research";
    const dynamicProposal = dynamicProposalFlag
      ? JSON.parse(await readFile(path.resolve(dynamicProposalFlag), "utf8"))
      : null;
    const configFlag = argValue("--config");
    let maxParallelism;
    if (configFlag) {
      const { resolveSkillConfig } = await import("../csm-orchestrate/lib/config.mjs");
      const effectiveConfig = JSON.parse(await readFile(path.resolve(configFlag), "utf8"));
      maxParallelism = resolveSkillConfig(effectiveConfig).config.maxParallelism;
    }
    const verifiedSandboxFlag = argValue("--verified-sandbox");
    const verifiedSandboxConfig = verifiedSandboxFlag
      ? await loadVerifiedSandboxConfig(verifiedSandboxFlag)
      : null;
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
    // T003: fold worker lifecycle events into an observational worker table.
    const workerReducer = createWorkerStateReducer();
    let lastWorkerText = "";
    let lastWorkerRenderAt = 0;
    const renderWorkerTableOnChange = async ({ force = false } = {}) => {
      // The live JSONL is being appended while the run proceeds; reading it on
      // every progress tick raced the writer and threw concurrent-replacement.
      // Throttle, and treat a mid-read replacement as a skipped render.
      if (!force && Date.now() - lastWorkerRenderAt < 2000) return;
      let events;
      try {
        events = await telemetryEmitter.getEvents();
      } catch {
        return;
      }
      lastWorkerRenderAt = Date.now();
      workerReducer.applyEvents(events, { now: new Date().toISOString() });
      const projection = workerReducer.snapshot();
      if (!projection.workers.length) return;
      const text = projectWorkerTable(projection).text;
      if (text === lastWorkerText) return;
      lastWorkerText = text;
      console.log(text);
    };
    const onProgress = (snapshot) => {
      renderProgressOnChange(snapshot);
      renderWorkerTableOnChange().catch(() => {});
    };
    const cursorStore = createSqliteStore({
      mode: "wal",
      databasePath: join(evidenceDir, "cursor.db"),
    });
    // S3a: fix the write-after-crash concatenation hazard before any emitter
    // runs — a torn telemetry tail is quarantined and the file is atomically
    // rewritten clean while the run lease is held.
    const telemetryPath = join(evidenceDir, "telemetry.jsonl");
    const tailRepair = await repairTelemetryJsonlTail(telemetryPath);
    if (tailRepair.repaired) {
      console.error(
        `run ${runId}: quarantined torn telemetry tail (${tailRepair.tornLength} bytes) to ${tailRepair.quarantinedPath}`,
      );
    }
    const telemetryEmitter = createTelemetryEmitter({
      transport: createJsonlTransport(telemetryPath),
      runId,
    });
    // T003: resume-safe ordering — adopt the persisted sequence high-water mark
    // before the first emission so a resumed run continues rather than restarting.
    await telemetryEmitter.rehydrate();
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
      // T001: opt-in thin child-side worker seam. --thin-worker-handler names a
      // child-side handler module; resolveThinWorkerAdapter constructs the
      // adapter only under the CSM_AGENT_SESSION_EXEC=1 gate (null otherwise), so
      // gate-off runs keep the default blocked handoffs unchanged — never a
      // silent bypass. The thin worker skills are removed from the default
      // blocked handoff set so they dispatch through scripts/run-worker.mjs
      // instead of being shadowed by the default agent-session-required handoff.
      const thinHandlerPath = argValue("--thin-worker-handler");
      const thinSkillsArg = argValue("--thin-worker-skills");
      const thinWorkerSkillsArg = thinSkillsArg
        ? thinSkillsArg
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean)
        : null;
      const thin = resolveThinWorkerAdapter({
        handlerPath: thinHandlerPath,
        workerScript: fileURLToPath(new URL("./run-worker.mjs", import.meta.url)),
        skills: thinWorkerSkillsArg,
      });
      if (thinHandlerPath && !thin)
        console.error(
          `--thin-worker-handler ignored: CSM_AGENT_SESSION_EXEC=1 is required to enable the thin child-side worker seam (keeping default blocked handoffs)`,
        );
      const thinWorkerSkills = thin?.thinWorkerSkills ?? [];
      const buildHandoffs = createAllBuildHandoffs().filter(
        (handoff) => !thinWorkerSkills.includes(handoff.skill),
      );
      const handlers = createExecutorHandlers({
        csmBuildHandoffs: buildHandoffs,
        ...(thin ? { thinWorkerAdapter: thin.thinWorkerAdapter, thinWorkerSkills } : {}),
      });
      const descriptors = createExecutorDescriptors({
        handlers,
        csmBuildHandoffs: buildHandoffs,
        ...(thin ? { thinWorkerAdapter: thin.thinWorkerAdapter, thinWorkerSkills } : {}),
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
    // T009: optional Jev decision adapter, dormant unless --use-jev (or a
    // request/2 decision block on the bypass path) opted in AND a provider/key
    // resolved. Passed through orchestrate()'s options so T010 can consume the
    // injected `decisionAdapter`; orchestrate currently ignores unknown options,
    // so an absent adapter leaves the call byte-identical.
    const decisionAdapter = await resolveDecisionAdapter(approach, kind, runId);
    // Built-in advisory tracing for the run's lifecycle hooks: every hook emits
    // one action trace to the shared log (best-effort, never fails the run).
    // T003: resolve the shared trace path once and share it between the hook
    // writer and the completion verifier so an override never mismatches.
    const traceFile = await resolveVerificationPath({ root: process.cwd(), env: process.env });
    const traceHooks = createTraceLifecycleHooks({
      actor: "csm-orchestrate",
      runId,
      write: (recordKind, entry) =>
        recordKind === "decision"
          ? recordDecision(entry, { file: traceFile })
          : appendTrace(entry, { file: traceFile }),
    });
    const result = await orchestrate({
      approach,
      runId,
      host,
      lifecycleHooks: traceHooks.definitions,
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
            onProgress,
          }),
      ...(dynamicProposal
        ? {
            dynamicProposal,
            dynamicApproved: dynamicApprovedFlag,
            dynamicRouteKind: dynamicRouteKindFlag,
          }
        : {}),
      ...(maxParallelism ? { maxParallelism } : {}),
      ...(verifiedSandboxConfig ? { verifiedSandboxRuntime: verifiedSandboxConfig } : {}),
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
      ...(decisionAdapter ? { decisionAdapter } : {}),
    });
    // F2: persist the run's applied decisions to one redacted
    // `.agents/decisions/<runId>.json`. Fail-open: an absent/off adapter, no real
    // runId, or no applied record writes nothing and never fails the run.
    if (decisionAdapter) await persistAdapterDecisions({ adapter: decisionAdapter, runId });
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
    // drain the async transport so telemetry.jsonl is complete before exit.
    // RK5: a concurrent append can make this read race the crash-path terminal
    // event; observability is best-effort and must never fail a VERIFIED run.
    try {
      await telemetryEmitter.getEvents();
    } catch {
      /* telemetry drain is best-effort */
    }
    // drain pending lifecycle trace writes before exit (best-effort).
    try {
      await traceHooks.flush();
    } catch {
      /* trace drain is best-effort */
    }
    // T003: fail closed when the run scheduled tracing but produced none. This
    // is an audit-emission gate: it never mutates result.receipt.
    const traceGate = await enforceTraceGate({
      traceFile,
      runId,
      scheduled: traceHooks.emitted(),
      jevActive: decisionAdapter !== null,
    });
    // T006: optional Jev advisory verifier, AFTER the deterministic gate so it
    // can never change the outcome. Advisory only, off unless opted in.
    if (decisionAdapter) {
      try {
        const seam = createConsultSeam({ adapter: decisionAdapter });
        const advice = await seam.consultPoints(["trace-emission-verdict"], {
          runId,
          traceLogPath: traceFile,
          scheduled: traceHooks.emitted(),
          matched: verifyTraces({ file: traceFile, runId }).matched,
          gate: traceGate.reason,
        });
        const verdict = advice["trace-emission-verdict"];
        if (verdict)
          await recordDecision(
            {
              runId,
              actor: "csm-orchestrate",
              action: "trace-emission-advisory",
              target: traceFile,
              justification: "jev advisory trace-emission verdict",
              outcome: String(verdict.answer ?? "n/a"),
            },
            { file: traceFile },
          );
      } catch {
        /* advisory best-effort */
      }
    }
    if (!traceGate.ok) {
      console.error(`trace enforcement failed: ${traceGate.reason}`);
      return 1;
    }
    if (result.progress && !quietProgress) {
      renderProgressOnChange(result.progress);
      await renderWorkerTableOnChange({ force: true });
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
    if (["--approach", "--plan", "--request"].includes(args[0])) process.exit(await realMode());
    console.error(
      "usage: run-orchestrator.mjs --fixture | --approach <approach.json> [--host <host.mjs>] [--run-id <runId>] | --plan <plan.json> | --request <request.json> [--approvals <module.mjs>] [--final-review <reviewer.mjs>] [--timeout-ms <ms>] [--progress-poll-ms <ms>] [--allow-host-dispatch] [--quiet-progress] [--resume] [--config <config.json>] [--verified-sandbox <config.json|config.mjs>] [--thin-worker-handler <module.mjs>] [--thin-worker-skills <skill,skill>] [--use-jev]",
    );
    console.error(
      "       --host is required for --approach only; --plan/--request route by schema marker (blocked agent-session-required unless CSM_AGENT_SESSION_EXEC=1 + a csm-build route, when an agent session runs under an approvals gate)",
    );
    console.error(
      "       --thin-worker-handler is approach-only and opt-in: with CSM_AGENT_SESSION_EXEC=1 the named child-side handler module dispatches csm-build-owned skills through scripts/run-worker.mjs (default skills: all csm-build-owned; narrow with --thin-worker-skills); without the gate it is ignored and default blocked handoffs stay in place",
    );
    console.error(
      "       --use-jev is opt-in and dormant by default: it builds the provider-pluggable decision adapter (CSM_DECISION_PROVIDER, default openrouter) only when the selected provider resolves and its apiKeyEnv is set; a missing flag, unresolved provider, or unset key leaves the deterministic harness unchanged (no adapter, no network), and the key is never logged",
    );
    process.exit(1);
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
