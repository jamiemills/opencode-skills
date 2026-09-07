"use strict";

// T006 verification: scripts/run-orchestrator.mjs realMode bypass wiring. For a
// plan/request intake whose classified route is csm-build, the driver keeps the
// blocked agent-session-required behavior unless the CSM_AGENT_SESSION_EXEC=1
// env gate is on. Under the gate it fabricates the handoff identity from the
// artifact's canonical runId (invocation-<slug>-<childRunId> /
// phase-<goalSlug>-execute / edge-<goalSlug>-execute), applies the approvals
// gate BEFORE any spawn (default createAutonomyPolicy never auto-approves
// csm-build; CSM_AGENT_SESSION_APPROVED=1 is the documented test hook when no
// --approvals module is given), then runs the T005 agent-session executor
// handoff and persists the typed csm-build-output/1 result under
// .agents/evidence/orchestrator/<runId>/bypass-result.json.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const evidenceRoot = join(repoRoot, ".agents", "evidence", "orchestrator");

// The durable sqlite store requires Node >= 22.13; the driver must run under
// the repo's node22 shim when the ambient node is older.
const NODE22 = spawnSync(
  process.execPath,
  [join(repoRoot, "scripts", "with-node22.mjs"), "--print"],
  { encoding: "utf8" },
);
if (NODE22.status !== 0) throw new Error("with-node22 could not resolve a node >= 22 binary");
const driverNode = NODE22.stdout.trim();

const BYPASS_ENV_KEYS = [
  "CSM_AGENT_SESSION_EXEC",
  "CSM_AGENT_SESSION_APPROVED",
  "CSM_AGENT_SESSION_AGENT_CLI",
  "CSM_AGENT_SESSION_WORKTREE_ROOT",
  "CSM_AGENT_SESSION_TIMEOUT_MS",
  "CSM_AGENT_SESSION_POLL_INTERVAL_MS",
  "CSMA_AGENT_SESSION_MARKER",
];

// A fresh env without any leaked bypass keys, then the overrides: each driver
// invocation is hermetic against a parent process that set bypass env vars.
function driverEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of BYPASS_ENV_KEYS) delete env[key];
  return { ...env, ...overrides };
}

async function runDriver(args, env = {}) {
  return exec(driverNode, [driverPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 90_000,
    env: driverEnv(env),
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message),
    }),
  );
}

function uniqueRunId(tag) {
  return `run-driver-agent-session-${tag}-${process.pid}-${Date.now()}`;
}

// Minimal csm-plan/1 envelope; intake does light field checks only (never full
// JSON-schema validation of plan/1 envelopes).
function planFixture(runId, planId) {
  return {
    schema: "csm-plan/1",
    schemaRevision: 1,
    planId,
    runId,
    owner: "test",
    status: "complete",
    goal: "Driver bypass real-path acceptance fixture plan.",
  };
}

function requestFixture(runId) {
  return {
    schema: "csm-orchestrate-request/1",
    schemaRevision: 1,
    requestId: "driver-agent-session-research",
    runId,
    kind: "research",
    prompt: "Research how to generalize request intake in csm-orchestrate.",
    goalSlug: "orchestrate-request-intake-router",
    artifactRef: null,
    repo: null,
  };
}

const BLOCKED = /requires an agent session running its SKILL\.md lifecycle/;

// The stub agent CLI (a real csm-build agent session is deferred to the build's
// final acceptance): it records its invocation via the marker env, then reads
// the executor envelope and writes the typed child-output.json the executor
// validates and reconstructs into the completed handoff result.
const SUCCESS_STUB = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const marker = process.env.CSMA_AGENT_SESSION_MARKER;
if (marker) fs.writeFileSync(marker, "ran");
const envelope = JSON.parse(fs.readFileSync(process.env.CSM_AGENT_SESSION_ENVELOPE, "utf8"));
const outPath = process.env.CSM_AGENT_SESSION_CHILD_OUTPUT;
const rawAttempt = process.env.CSM_AGENT_SESSION_ATTEMPT;
const attempt = rawAttempt === "" ? 0 : Number(rawAttempt);
const output = {
  ok: true,
  echoed: { invocationId: envelope.invocationId, childRunId: envelope.childRunId },
};
const result = {
  schema: envelope.outputSchema,
  skill: envelope.skill,
  attempt,
  status: "completed",
  invocationId: envelope.invocationId,
  parentRunId: envelope.parentRunId,
  childRunId: envelope.childRunId,
  phaseId: envelope.phaseId,
  edgeId: envelope.edgeId,
  requestIdentity: {
    invocationId: envelope.invocationId,
    parentRunId: envelope.parentRunId,
    childRunId: envelope.childRunId,
    phaseId: envelope.phaseId,
    edgeId: envelope.edgeId,
    skill: envelope.skill,
    digest: "sha256:" + "0".repeat(64),
  },
  inputSchemaDigest: envelope.inputSchemaDigest,
  outputSchemaDigest: envelope.outputSchemaDigest,
  output,
  outputDigest: "sha256:" + "1".repeat(64),
  effects: ["workspace-write"],
  artifacts: [],
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
`;

async function writeExecutable(file, body) {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

// A throwaway pre-created wt-session worktree: a temp dir with a .git marker
// only is accepted by the executor as pre-created (the executor copies the plan
// artifact into it; it never runs `wt-session create` on an existing root).
async function fixtureWorktree() {
  const root = await mkdtemp(join(tmpdir(), "driver-agent-session-wt-"));
  await mkdir(join(root, ".git"));
  return root;
}

async function cleanupEvidence(runIds) {
  for (const runId of runIds) await rm(join(evidenceRoot, runId), { recursive: true, force: true });
}

test("(i) --approach path is unchanged: host-required error (no agent-session block)", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-agent-session-approach-"));
  const runId = uniqueRunId("approach");
  try {
    const approachPath = join(sandbox, "approach.json");
    await writeFile(
      approachPath,
      `${JSON.stringify(
        {
          schema: "csm-approach/1",
          schemaRevision: 1,
          status: "agreed",
          runId,
          ideaSlug: "driver-agent-session",
          signals: { capabilities: [], inputs: [] },
          phases: [],
        },
        null,
        2,
      )}\n`,
    );
    const { code, stderr } = await runDriver(["--approach", approachPath]);
    assert.notEqual(code, 0, "approach path still requires --host");
    assert.match(stderr, /real runs require --host/);
    assert.doesNotMatch(stderr, BLOCKED, "approach path never blocks on agent session");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("(ii) --plan with the executor env off exits blocked agent-session-required", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-agent-session-planoff-"));
  const runId = uniqueRunId("planoff");
  try {
    const planPath = join(sandbox, "plan.json");
    await writeFile(
      planPath,
      `${JSON.stringify(planFixture(runId, "driver-agent-session"), null, 2)}\n`,
    );
    const { code, stderr } = await runDriver(["--plan", planPath]);
    assert.notEqual(code, 0, "env-off plan route must exit non-zero");
    assert.match(stderr, /csm-build requires an agent session running its SKILL\.md lifecycle/);
    assert.match(stderr, BLOCKED);
    assert.doesNotMatch(
      stderr,
      /was denied/,
      "env-off is a blocked route, not an approvals denial",
    );
    assert.equal(
      existsSync(join(evidenceRoot, runId, "bypass-result.json")),
      false,
      "blocked route persists no bypass result",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("(iii) real-path acceptance: --plan env on + stub agent CLI + approval -> completed typed result persisted", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-agent-session-real-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "driver-agent-session-cli-"));
  const wt = await fixtureWorktree();
  const runId = uniqueRunId("real");
  const planId = "driver-bypass-acceptance";
  const marker = join(agentRoot, "agent-ran.marker");
  const agentCli = join(agentRoot, "agent-stub");
  await writeExecutable(agentCli, SUCCESS_STUB);
  try {
    const planPath = join(sandbox, "2026-09-06-driver-bypass-acceptance-csm.json");
    await writeFile(planPath, `${JSON.stringify(planFixture(runId, planId), null, 2)}\n`);
    const started = Date.now();
    const { code, stdout, stderr } = await runDriver(["--plan", planPath], {
      CSM_AGENT_SESSION_EXEC: "1",
      CSM_AGENT_SESSION_APPROVED: "1",
      CSM_AGENT_SESSION_AGENT_CLI: agentCli,
      CSM_AGENT_SESSION_WORKTREE_ROOT: wt,
      CSM_AGENT_SESSION_TIMEOUT_MS: "20000",
      CSM_AGENT_SESSION_POLL_INTERVAL_MS: "100",
      CSMA_AGENT_SESSION_MARKER: marker,
    });
    const elapsed = Date.now() - started;
    t.diagnostic(`real-path driver --plan run completed in ${elapsed}ms`);
    assert.equal(code, 0, `driver must exit 0 on a completed bypass run: ${stderr}`);
    assert.match(stdout, /status: completed/);
    assert.equal(
      await readFile(marker, "utf8").catch(() => ""),
      "ran",
      "stub agent CLI was spawned",
    );

    const resultPath = join(evidenceRoot, runId, "bypass-result.json");
    assert.equal(existsSync(resultPath), true, "bypass-result.json is persisted");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    // Full-form typed csm-build-output/1 result (createCsmBuildHandoff defaults).
    assert.equal(result.schema, "csm-build-output/1");
    assert.equal(result.skill, "csm-build");
    assert.equal(result.status, "completed");
    assert.equal(result.attempt, 0);
    assert.equal(result.output.ok, true);
    assert.deepEqual(result.effects, ["workspace-write"]);
    // Fabricated identity (H1): phase-<goalSlug>-execute / edge-<goalSlug>-execute
    // / invocation-<goalSlug>-<childRunId> with the driver runId as parent.
    assert.equal(result.requestIdentity.parentRunId, runId);
    assert.equal(result.requestIdentity.childRunId, `${runId}-child`);
    assert.equal(result.requestIdentity.phaseId, `phase-${planId}-execute`);
    assert.equal(result.requestIdentity.edgeId, `edge-${planId}-execute`);
    assert.equal(result.requestIdentity.invocationId, `invocation-${planId}-${runId}-child`);
    assert.equal(result.requestIdentity.skill, "csm-build");
    assert.match(result.requestIdentity.digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.inputSchemaDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.outputSchemaDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.outputDigest, /^sha256:[a-f0-9]{64}$/);
    // The executor copied the plan artifact into the pre-created worktree and ran
    // the agent session with the child output under the worktree evidence dir.
    const copied = JSON.parse(
      await readFile(
        join(wt, ".agents", "plans", "2026-09-06-driver-bypass-acceptance-csm.json"),
        "utf8",
      ),
    );
    assert.equal(copied.runId, runId);
    assert.equal(
      existsSync(join(wt, ".agents", "evidence", `${runId}-child`, "child-output.json")),
      true,
      "child-output.json exists under the worktree evidence dir",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
    await rm(wt, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});

test("(iv) --request research-kind with the env on stays blocked (no executor for non-csm-build routes)", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-agent-session-research-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "driver-agent-session-norexec-"));
  const runId = uniqueRunId("research");
  const marker = join(agentRoot, "agent-ran.marker");
  const agentCli = join(agentRoot, "agent-stub");
  await writeExecutable(agentCli, SUCCESS_STUB);
  try {
    const requestPath = join(sandbox, "request.json");
    await writeFile(requestPath, `${JSON.stringify(requestFixture(runId), null, 2)}\n`);
    const { code, stderr } = await runDriver(["--request", requestPath], {
      CSM_AGENT_SESSION_EXEC: "1",
      CSM_AGENT_SESSION_APPROVED: "1",
      CSM_AGENT_SESSION_AGENT_CLI: agentCli,
      CSM_AGENT_SESSION_WORKTREE_ROOT: agentRoot,
      CSMA_AGENT_SESSION_MARKER: marker,
    });
    assert.notEqual(code, 0, "research route must exit non-zero even with the env on");
    assert.match(
      stderr,
      /csm-deep-research requires an agent session running its SKILL\.md lifecycle/,
    );
    assert.match(stderr, BLOCKED);
    assert.equal(
      await readFile(marker, "utf8").catch(() => ""),
      "",
      "stub agent CLI was never spawned",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
  }
});

test("(v) approvals denied (env approved unset) + env on blocks the spawn with a denial", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-agent-session-denied-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "driver-agent-session-denycli-"));
  const runId = uniqueRunId("denied");
  const marker = join(agentRoot, "agent-ran.marker");
  const agentCli = join(agentRoot, "agent-stub");
  await writeExecutable(agentCli, SUCCESS_STUB);
  try {
    const planPath = join(sandbox, "plan.json");
    await writeFile(
      planPath,
      `${JSON.stringify(planFixture(runId, "driver-agent-session"), null, 2)}\n`,
    );
    const { code, stdout, stderr } = await runDriver(["--plan", planPath], {
      CSM_AGENT_SESSION_EXEC: "1",
      CSM_AGENT_SESSION_AGENT_CLI: agentCli,
      CSM_AGENT_SESSION_WORKTREE_ROOT: agentRoot,
      CSMA_AGENT_SESSION_MARKER: marker,
    });
    assert.notEqual(code, 0, "approvals-denied bypass must exit non-zero");
    assert.match(stderr, /was denied/);
    assert.match(stderr, /missing-approval/);
    assert.match(stderr, /approval is required/);
    assert.equal(
      await readFile(marker, "utf8").catch(() => ""),
      "",
      "stub agent CLI was never spawned",
    );
    assert.doesNotMatch(stdout, /status: completed/, "no completed status on a denied run");
    assert.equal(
      existsSync(join(evidenceRoot, runId, "bypass-result.json")),
      false,
      "denied run persists no bypass result",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});
