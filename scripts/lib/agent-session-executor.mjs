"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn as defaultSpawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { digest, parseJson } from "../../lib/schema-runtime/index.mjs";

// Agent-session executor for instruction-led csm-build dispatch (P3a).
//
// This module is the `execute` callback for
// `createCsmBuildHandoff({ skill: "csm-build", execute })`. Its execute()
// returns either the exact blocked agent-session-required short form (when the
// CSM_AGENT_SESSION_EXEC environment gate is not `1`) or, when enabled, spawns
// a real agent CLI inside an isolated worktree that runs the csm-build
// SKILL.md lifecycle and writes a typed child-output.json back. The full-form
// completed result is reconstructed from the request identity + schema digests
// (never trusted from the child) so `createCsmBuildHandoff.execute()` full
// identity/schema-digest validation passes (csm-build-handoff.mjs:87-153).

const EXEC_ENV = "CSM_AGENT_SESSION_EXEC";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_CHILD_BYTES = 64 * 1024;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WT_SESSION = path.join(MODULE_DIR, "..", "wt-session.mjs");
const DEFAULT_SKILL_MD = path.join(MODULE_DIR, "..", "..", "csm-build", "SKILL.md");
const DEFAULT_WT_BASE = path.join(os.homedir(), "csm-wt");
const IDENTITY_FIELDS = ["invocationId", "parentRunId", "childRunId", "phaseId", "edgeId", "skill"];

const agentSessionRequiredMessage = (skill) =>
  `${skill} requires an agent session running its SKILL.md lifecycle. Direct function dispatch is not available for instruction-led skills.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function identityOf(request) {
  return {
    invocationId: request.invocationId,
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    phaseId: request.phaseId,
    edgeId: request.edgeId,
    skill: request.skill,
  };
}

function identityDigest(identity) {
  return digest(identity);
}

function shortResult(request, status, failure, { effects = [], artifacts = [] } = {}) {
  return {
    schema: request.outputSchema,
    skill: request.skill,
    attempt: request.attempt,
    status,
    effects,
    artifacts,
    receipt: null,
    failure,
  };
}

function blockedResult(request) {
  return shortResult(request, "blocked", {
    class: "policy",
    code: "agent-session-required",
    message: agentSessionRequiredMessage(request.skill),
  });
}

function failedResult(request, failure) {
  return shortResult(request, "failed", failure);
}

function assertOptions(name, condition, detail) {
  if (!condition) throw new TypeError(`agent-session executor ${name} ${detail}`);
}

function normalizeOptions(options = {}) {
  const {
    agentCli,
    spawn = defaultSpawn,
    env = {},
    worktreeRoot = null,
    wtSessionScript = DEFAULT_WT_SESSION,
    skillMdPath = DEFAULT_SKILL_MD,
    evidenceDir = null,
    repoRoot = null,
    parentDir = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;
  if (agentCli !== undefined && agentCli !== null)
    assertOptions(
      "agentCli",
      typeof agentCli === "string" && agentCli.length > 0,
      "must be a non-empty executable path/command when provided",
    );
  assertOptions("spawn", typeof spawn === "function", "must be a spawn function");
  assertOptions(
    "env",
    env !== null && typeof env === "object" && !Array.isArray(env),
    "must be an object",
  );
  for (const [name, value] of [
    ["worktreeRoot", worktreeRoot],
    ["wtSessionScript", wtSessionScript],
    ["skillMdPath", skillMdPath],
    ["evidenceDir", evidenceDir],
    ["repoRoot", repoRoot],
    ["parentDir", parentDir],
  ])
    if (value !== null && value !== undefined)
      assertOptions(
        name,
        typeof value === "string" && value.length > 0,
        "must be a non-empty path",
      );
  assertOptions(
    "timeoutMs",
    Number.isFinite(timeoutMs) && timeoutMs > 0,
    "must be a positive number of milliseconds",
  );
  assertOptions(
    "pollIntervalMs",
    Number.isFinite(pollIntervalMs) && pollIntervalMs > 0,
    "must be a positive number of milliseconds",
  );
  return Object.freeze({
    agentCli: agentCli ?? null,
    spawn,
    env: { ...env },
    worktreeRoot: worktreeRoot ? path.resolve(worktreeRoot) : null,
    wtSessionScript: path.resolve(wtSessionScript),
    skillMdPath: path.resolve(skillMdPath),
    evidenceDir: evidenceDir ? path.resolve(evidenceDir) : null,
    repoRoot: repoRoot ? path.resolve(repoRoot) : null,
    parentDir: parentDir ? path.resolve(parentDir) : null,
    timeoutMs,
    pollIntervalMs,
  });
}

function isGitWorktree(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return fs.existsSync(path.join(dir, ".git"));
}

function gitTopLevel(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return path.join(MODULE_DIR, "..", "..");
  }
}

function deriveSlug(request) {
  const { input } = request;
  const goalSlug = input && typeof input === "object" ? input.goalSlug : undefined;
  const prompt = input && typeof input === "object" ? input.prompt : undefined;
  const raw =
    (typeof goalSlug === "string" && goalSlug.trim() !== "" ? goalSlug : undefined) ??
    (typeof prompt === "string" && prompt.trim() !== "" ? prompt : undefined) ??
    request.childRunId ??
    "csm-build";
  const slug = raw
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (slug === "") return "csm-build-session";
  return slug;
}

function runToCompletion(spawnFn, file, args, options, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let child;
    const output = { stdout: "", stderr: "" };
    const capture = (stream, name) => {
      stream?.on("data", (chunk) => {
        output[name] = (output[name] + String(chunk)).slice(-MAX_CHILD_BYTES);
      });
    };
    try {
      child = spawnFn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);
    capture(child.stdout, "stdout");
    capture(child.stderr, "stderr");
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function launch(spawnFn, file, args, cwd, env) {
  const child = spawnFn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout = (output.stdout + String(chunk)).slice(-MAX_CHILD_BYTES);
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr = (output.stderr + String(chunk)).slice(-MAX_CHILD_BYTES);
  });
  return { child, output };
}

async function waitForSessionOutput({ child, outputPath, timeoutMs, pollIntervalMs, signal }) {
  let spawnError = null;
  let closed = false;
  let exitCode = null;
  let notifyClosed;
  const closedPromise = new Promise((resolve) => {
    notifyClosed = resolve;
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  child.on("close", (code) => {
    closed = true;
    exitCode = code;
    notifyClosed();
  });
  const deadline = Date.now() + timeoutMs;
  const kill = (sig) => {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  };
  const timer = setTimeout(() => kill("SIGTERM"), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        kill("SIGKILL");
        return { status: "aborted" };
      }
      if (fs.existsSync(outputPath)) return { status: "found" };
      if (spawnError) {
        kill("SIGKILL");
        return { status: "spawn-error", error: spawnError };
      }
      if (closed) {
        if (exitCode !== 0) return { status: "exit-failure", code: exitCode };
        // A clean exit that wrote nothing yet gets plain cadence polling from
        // here (no close-wakeup race, which would busy-spin once resolved).
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
        continue;
      }
      await Promise.race([
        sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))),
        closedPromise,
      ]);
    }
    kill("SIGKILL");
    return { status: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureWorktree(config, request) {
  const explicit = config.worktreeRoot;
  let worktree;
  let slug;
  let parentDir;
  if (explicit) {
    worktree = explicit;
    slug = path.basename(explicit);
    parentDir = path.dirname(explicit);
  } else {
    slug = deriveSlug(request);
    parentDir = config.parentDir ?? DEFAULT_WT_BASE;
    worktree = path.join(parentDir, slug);
  }
  if (isGitWorktree(worktree)) return worktree;
  const repoRoot = config.repoRoot ?? gitTopLevel(process.cwd());
  const env = { ...process.env, ...config.env };
  const outcome = await runToCompletion(
    config.spawn,
    process.execPath,
    [config.wtSessionScript, "create", slug, "--root", repoRoot, "--dir", parentDir, "--no-setup"],
    { cwd: repoRoot, env },
  );
  if (outcome.code !== 0)
    throw new Error(
      `wt-session create failed (exit ${outcome.code}): ${outcome.output.stderr.trim() || outcome.output.stdout.trim()}`,
    );
  if (!isGitWorktree(worktree)) throw new Error(`wt-session create did not produce ${worktree}`);
  return worktree;
}

function plansDir(worktree) {
  return path.join(worktree, ".agents", "plans");
}

async function copyPlanArtifact(config, request, worktree) {
  const input = request.input && typeof request.input === "object" ? request.input : {};
  const artifactPath = typeof input.artifactPath === "string" ? input.artifactPath : null;
  await mkdir(plansDir(worktree), { recursive: true });
  if (artifactPath) {
    const source = path.resolve(artifactPath);
    const base = path.basename(source);
    const safeBase = base === "." || base === ".." || base === "" ? "plan.json" : base;
    const target = path.join(plansDir(worktree), safeBase);
    await copyFile(source, target);
    return target;
  }
  if (input && Object.keys(input).length > 0) {
    const target = path.join(plansDir(worktree), "session-input.json");
    await writeFile(target, `${JSON.stringify(input, null, 2)}\n`);
    return target;
  }
  return null;
}

async function readSkillReference(config, worktree) {
  try {
    return await readFile(config.skillMdPath, "utf8");
  } catch {
    return `Load and follow ${path.join(worktree, "csm-build", "SKILL.md")} inside this worktree.`;
  }
}

function buildPrompt({
  planPath,
  envelopePath,
  evidenceDir,
  childOutputPath,
  attempt,
  skillReference,
}) {
  const planLine = planPath ? `Plan file (implement this saved CSM plan): ${planPath}` : "";
  return [
    "CSM AGENT SESSION — orchestrator-dispatched csm-build execution.",
    "",
    "You are running inside an isolated git worktree. Work ONLY inside this",
    "worktree; never read from or write to the main checkout you were launched from.",
    planLine,
    "",
    "Activate the csm-build skill on that plan exactly per its `Activation Boundary`",
    "section (reference below) and follow its full SKILL.md lifecycle (RECOVER ->",
    "VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> COMPLETE,",
    "journaling every state transition) until the plan is finished or genuinely",
    "blocked. Update the plan and persist progress inside this worktree.",
    "",
    `Identity envelope (read the handoff identity + schema digests verbatim): ${envelopePath}`,
    `Evidence dir (write all skill evidence here): ${evidenceDir}`,
    `Child output (write this exact file when finished): ${childOutputPath}`,
    `Attempt: ${attempt}`,
    "",
    "When the plan lifecycle is finished, write the child output file as one JSON",
    "document with this exact shape:",
    "",
    "```json",
    "{",
    '  "schema": "csm-build-output/1",',
    '  "skill": "csm-build",',
    `  "attempt": ${attempt},`,
    '  "status": "completed",',
    '  "requestIdentity": { "invocationId": "<from envelope>", "parentRunId": "<from envelope>",',
    '    "childRunId": "<from envelope>", "phaseId": "<from envelope>",',
    '    "edgeId": "<from envelope>", "skill": "csm-build", "digest": "<optional: recomputed>" },',
    '  "inputSchemaDigest": "<verbatim from envelope>",',
    '  "outputSchemaDigest": "<verbatim from envelope>",',
    '  "output": { "state": { "control": { "currentState": "COMPLETE" } },',
    '    "summary": "describe what was implemented and verified" },',
    '  "outputDigest": "<optional: recomputed by the orchestrator>"',
    "}",
    "```",
    "",
    "Requirements for the child output file:",
    "- Echo the envelope identity fields (invocationId/parentRunId/childRunId/phaseId/",
    "  edgeId/skill) and the inputSchemaDigest/outputSchemaDigest VERBATIM from the",
    "  envelope at the path above. These are mandatory.",
    "- `attempt` must equal the attempt value listed above.",
    '- Set `status` to "completed". Put the durable build output under `output`.',
    "- `requestIdentity.digest` and `outputDigest` may be omitted (the orchestrator",
    "  recomputes and validates them).",
    "- Also write it to the path given by the CSM_AGENT_SESSION_CHILD_OUTPUT",
    "  environment variable, which equals the child output path above.",
    "",
    "--- csm-build SKILL.md reference ---",
    skillReference,
  ].join("\n");
}

function validateChildResult(request, child) {
  const identity = identityOf(request);
  if (!child || typeof child !== "object" || Array.isArray(child))
    return "child output is not an object";
  for (const field of IDENTITY_FIELDS)
    if (child[field] !== identity[field])
      return `child output ${field} does not match the handoff identity`;
  if (child.inputSchemaDigest !== request.inputSchemaDigest)
    return "child output inputSchemaDigest does not match the handoff";
  if (child.outputSchemaDigest !== request.outputSchemaDigest)
    return "child output outputSchemaDigest does not match the handoff";
  if (child.attempt !== request.attempt)
    return `child output attempt ${child.attempt} does not match ${request.attempt}`;
  if (child.status !== "completed") return `child output status is ${child.status}, not completed`;
  return null;
}

function completedResult(request, child) {
  const identity = identityOf(request);
  return {
    schema: request.outputSchema,
    skill: request.skill,
    attempt: request.attempt,
    status: "completed",
    requestIdentity: { ...identity, digest: identityDigest(identity) },
    inputSchemaDigest: request.inputSchemaDigest,
    outputSchemaDigest: request.outputSchemaDigest,
    output: child.output ?? null,
    outputDigest: digest(child.output ?? null),
    effects:
      Array.isArray(child.effects) && child.effects.length > 0
        ? child.effects
        : ["workspace-write"],
    artifacts: Array.isArray(child.artifacts) ? child.artifacts : [],
  };
}

async function runAgentSession(config, request, layout) {
  const { child, output } = launch(
    config.spawn,
    config.agentCli,
    ["run", "--prompt-file", layout.promptPath],
    layout.worktree,
    {
      ...process.env,
      ...config.env,
      CSM_AGENT_SESSION_ENVELOPE: layout.envelopePath,
      CSM_AGENT_SESSION_EVIDENCE_DIR: layout.evidenceDir,
      CSM_AGENT_SESSION_CHILD_OUTPUT: layout.childOutputPath,
      CSM_AGENT_SESSION_ATTEMPT: String(request.attempt ?? ""),
    },
  );
  const outcome = await waitForSessionOutput({
    child,
    outputPath: layout.childOutputPath,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    signal: request.signal,
  });
  if (outcome.status === "aborted")
    return shortResult(request, "failed", {
      class: "timeout",
      code: "cancelled",
      message: "execution cancelled",
    });
  if (outcome.status === "spawn-error")
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-spawn-failed",
      message: `${config.agentCli} failed to start: ${outcome.error.message}`,
    });
  if (outcome.status === "exit-failure")
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-exited",
      message:
        `${config.agentCli} exited (${outcome.code}) without writing child-output.json: ${output.stderr.trim() || output.stdout.trim()}`.slice(
          0,
          2000,
        ),
    });
  if (outcome.status === "timeout")
    return failedResult(request, {
      class: "timeout",
      code: "agent-session-timeout",
      message:
        `${request.skill} agent session did not produce child-output.json within ${config.timeoutMs}ms: ${output.stderr.trim() || output.stdout.trim()}`.slice(
          0,
          2000,
        ),
    });
  let childResult;
  try {
    childResult = parseJson(await readFile(layout.childOutputPath, "utf8"));
  } catch (error) {
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-child-invalid",
      message: `child-output.json is not valid JSON: ${error.message}`,
    });
  }
  const problem = validateChildResult(request, childResult);
  if (problem !== null)
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-child-invalid",
      message: problem,
    });
  return completedResult(request, childResult);
}

async function execute(config, request) {
  if (process.env[EXEC_ENV] !== "1") return blockedResult(request);
  if (!config.agentCli)
    return failedResult(request, {
      class: "policy",
      code: "agent-session-not-configured",
      message: "an agent CLI is required to run an agent session (agentCli option)",
    });
  let worktree;
  let planPath;
  try {
    worktree = await ensureWorktree(config, request);
    planPath = await copyPlanArtifact(config, request, worktree);
  } catch (error) {
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-worktree-failed",
      message: error.message,
    });
  }
  const evidenceDir =
    config.evidenceDir ?? path.join(worktree, ".agents", "evidence", request.childRunId);
  const layout = {
    worktree,
    evidenceDir,
    envelopePath: path.join(evidenceDir, "handoff-envelope.json"),
    childOutputPath: path.join(evidenceDir, "child-output.json"),
    promptPath: path.join(evidenceDir, "session-prompt.md"),
  };
  try {
    await mkdir(evidenceDir, { recursive: true });
    const identity = identityOf(request);
    const envelope = {
      ...identity,
      inputSchema: request.inputSchema,
      inputSchemaDigest: request.inputSchemaDigest,
      outputSchema: request.outputSchema,
      outputSchemaDigest: request.outputSchemaDigest,
      evidenceDir,
    };
    await writeFile(layout.envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
    const skillReference = await readSkillReference(config, worktree);
    const promptText = buildPrompt({
      planPath,
      envelopePath: layout.envelopePath,
      evidenceDir,
      childOutputPath: layout.childOutputPath,
      attempt: request.attempt,
      skillReference,
    });
    await writeFile(layout.promptPath, promptText, { mode: 0o600 });
    await chmod(layout.promptPath, 0o600);
  } catch (error) {
    return failedResult(request, {
      class: "runtime",
      code: "agent-session-prepare-failed",
      message: error.message,
    });
  }
  return runAgentSession(config, request, layout);
}

export function createCsmBuildAgentSessionExecutor(options = {}) {
  const config = normalizeOptions(options);
  return Object.freeze({
    execute: async (request) => execute(config, request),
  });
}

export {
  identityOf as agentSessionRequestIdentity,
  identityDigest as agentSessionRequestIdentityDigest,
};
