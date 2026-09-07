"use strict";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import { createCsmBuildHandoff } from "../csm-orchestrate/lib/csm-build-handoff.mjs";
import { createCsmBuildAgentSessionExecutor } from "../scripts/lib/agent-session-executor.mjs";

const EXEC_ENV = "CSM_AGENT_SESSION_EXEC";
const IDENTITY = {
  invocationId: "invocation-agent-session",
  parentRunId: "run-agent-parent",
  childRunId: "run-agent-child",
  phaseId: "phase-agent-session",
  edgeId: "edge-agent-session",
  skill: "csm-build",
};
const INPUT_SCHEMA_DIGEST = digest("agent-session-input-schema");
const OUTPUT_SCHEMA_DIGEST = digest("agent-session-output-schema");
const agentSessionRequiredMessage = (skill) =>
  `${skill} requires an agent session running its SKILL.md lifecycle. Direct function dispatch is not available for instruction-led skills.`;

function withExecEnv(value, fn) {
  const had = Object.hasOwn(process.env, EXEC_ENV);
  const previous = process.env[EXEC_ENV];
  if (value === undefined) delete process.env[EXEC_ENV];
  else process.env[EXEC_ENV] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[EXEC_ENV] = previous;
    else delete process.env[EXEC_ENV];
  }
}

function request(overrides = {}) {
  return {
    ...IDENTITY,
    input: { goalSlug: "agent-session-exec-test" },
    retry: { attempt: 0 },
    ...overrides,
  };
}

function handoff(execute) {
  return createCsmBuildHandoff({
    skill: "csm-build",
    execute,
    inputSchemaDigest: INPUT_SCHEMA_DIGEST,
    outputSchemaDigest: OUTPUT_SCHEMA_DIGEST,
  });
}

function recordingSpawn(records) {
  return (file, args, options) => {
    records.push({ file, args, options });
    return spawn(file, args, options);
  };
}

const SUCCESS_STUB = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
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

const SLEEP_STUB = `#!/usr/bin/env node
"use strict";
setTimeout(() => process.exit(0), 60000);
`;

const MARKER_STUB = `#!/usr/bin/env node
"use strict";
require("node:fs").writeFileSync(process.env.CSMA_WT_SESSION_MARKER, "ran");
process.exit(9);
`;

async function fixtureWorktree() {
  const root = await mkdtemp(join(tmpdir(), "agent-session-wt-"));
  await mkdir(join(root, ".git"));
  return root;
}

async function writeExecutable(file, body) {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

test("env off returns the blocked agent-session-required result by default", async () => {
  await withExecEnv(undefined, async () => {
    const executor = createCsmBuildAgentSessionExecutor({});
    const result = await executor.execute({
      schema: "request/1",
      skill: "csm-build",
      attempt: 0,
      outputSchema: "csm-build-output/1",
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.failure.code, "agent-session-required");
    assert.equal(result.failure.class, "policy");
    assert.equal(result.failure.message, agentSessionRequiredMessage("csm-build"));
    assert.deepEqual(result.effects, []);
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.receipt, null);

    const wrapped = await handoff(executor.execute).execute(request());
    assert.equal(wrapped.status, "blocked");
    assert.equal(wrapped.failure.code, "agent-session-required");
    assert.equal(wrapped.schema, "csm-build-output/1");
    assert.equal(wrapped.skill, "csm-build");
  });
});

test("env on runs the agent CLI in a pre-created worktree and the handoff round-trip validates", async () => {
  const wt = await fixtureWorktree();
  const agentRoot = await mkdtemp(join(tmpdir(), "agent-session-cli-"));
  const agentCli = join(agentRoot, "agent-stub");
  const marker = join(agentRoot, "wt-ran.marker");
  const wtSessionScript = join(agentRoot, "wt-session-stub");
  await writeExecutable(agentCli, SUCCESS_STUB);
  await writeExecutable(wtSessionScript, MARKER_STUB);
  const records = [];
  try {
    await withExecEnv("1", async () => {
      const executor = createCsmBuildAgentSessionExecutor({
        agentCli,
        worktreeRoot: wt,
        wtSessionScript,
        spawn: recordingSpawn(records),
      });
      const result = await handoff(executor.execute).execute(request());
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.equal(result.schema, "csm-build-output/1");
      assert.equal(result.skill, "csm-build");
      assert.equal(result.attempt, 0);
      assert.equal(result.requestIdentity.invocationId, IDENTITY.invocationId);
      assert.equal(result.requestIdentity.childRunId, IDENTITY.childRunId);
      assert.equal(result.requestIdentity.skill, "csm-build");
      assert.equal(result.requestIdentity.digest, digest({ ...IDENTITY }));
      assert.equal(result.inputSchemaDigest, INPUT_SCHEMA_DIGEST);
      assert.equal(result.outputSchemaDigest, OUTPUT_SCHEMA_DIGEST);
      assert.equal(result.outputDigest, digest(result.output));
      assert.equal(result.output.ok, true);
      assert.deepEqual(result.effects, ["workspace-write"]);
    });
    assert.equal(records.length, 1, "only the agent CLI spawn should occur");
    const call = records[0];
    assert.equal(call.file, agentCli);
    assert.deepEqual(call.args.slice(0, 2), ["run", "--prompt-file"]);
    assert.equal(call.args.length, 3);
    assert.equal(call.options.cwd, wt);
    assert.equal(typeof call.args[2], "string");
    assert.equal(
      call.args[2],
      join(wt, ".agents", "evidence", IDENTITY.childRunId, "session-prompt.md"),
    );
    const promptStat = await stat(call.args[2]);
    assert.equal(promptStat.mode & 0o777, 0o600);

    const envelope = JSON.parse(
      await readFile(
        join(wt, ".agents", "evidence", IDENTITY.childRunId, "handoff-envelope.json"),
        "utf8",
      ),
    );
    for (const field of ["invocationId", "parentRunId", "childRunId", "phaseId", "edgeId", "skill"])
      assert.equal(envelope[field], IDENTITY[field]);
    assert.equal(envelope.inputSchemaDigest, INPUT_SCHEMA_DIGEST);
    assert.equal(envelope.outputSchemaDigest, OUTPUT_SCHEMA_DIGEST);
    assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
  } finally {
    await rm(wt, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
  }
});

test("wt-session create is never invoked when the worktree root already exists", async () => {
  const wt = await fixtureWorktree();
  const agentRoot = await mkdtemp(join(tmpdir(), "agent-session-skip-"));
  const marker = join(agentRoot, "wt-session-ran.marker");
  const wtSessionScript = join(agentRoot, "wt-session-stub");
  await writeExecutable(join(agentRoot, "agent-stub"), SUCCESS_STUB);
  await writeExecutable(wtSessionScript, MARKER_STUB);
  const records = [];
  try {
    await withExecEnv("1", async () => {
      const executor = createCsmBuildAgentSessionExecutor({
        agentCli: join(agentRoot, "agent-stub"),
        worktreeRoot: wt,
        wtSessionScript,
        env: { CSMA_WT_SESSION_MARKER: marker },
        spawn: recordingSpawn(records),
      });
      const result = await handoff(executor.execute).execute(request());
      assert.equal(result.status, "completed");
      assert.equal(records.length, 1);
      assert.equal(records[0].file, join(agentRoot, "agent-stub"));
    });
    assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
  } finally {
    await rm(wt, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
  }
});

test("an agent session that never writes child-output.json times out to a failed result", async () => {
  const wt = await fixtureWorktree();
  const agentRoot = await mkdtemp(join(tmpdir(), "agent-session-timeout-"));
  const agentCli = join(agentRoot, "sleep-stub");
  await writeExecutable(agentCli, SLEEP_STUB);
  try {
    await withExecEnv("1", async () => {
      const executor = createCsmBuildAgentSessionExecutor({
        agentCli,
        worktreeRoot: wt,
        timeoutMs: 1200,
        pollIntervalMs: 200,
      });
      const result = await handoff(executor.execute).execute(request());
      assert.equal(result.status, "failed");
      assert.equal(result.failure.class, "timeout");
      assert.equal(result.failure.code, "agent-session-timeout");
    });
  } finally {
    await rm(wt, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
  }
});

test("the plan artifact is copied into the worktree when input.artifactPath is present", async () => {
  const wt = await fixtureWorktree();
  const sourceRoot = await mkdtemp(join(tmpdir(), "agent-session-src-"));
  const agentRoot = await mkdtemp(join(tmpdir(), "agent-session-art-"));
  const artifactPath = join(sourceRoot, "2026-09-06-fake-plan-csm.json");
  const plan = { schema: "csm-plan/1", planId: "fake-plan", runId: IDENTITY.childRunId };
  const agentCli = join(agentRoot, "agent-stub");
  await writeFile(artifactPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeExecutable(agentCli, SUCCESS_STUB);
  try {
    await withExecEnv("1", async () => {
      const executor = createCsmBuildAgentSessionExecutor({ agentCli, worktreeRoot: wt });
      const result = await handoff(executor.execute).execute(
        request({ input: { goalSlug: "fake-plan-artifact", artifactPath } }),
      );
      assert.equal(result.status, "completed");
    });
    const copied = await readFile(
      join(wt, ".agents", "plans", "2026-09-06-fake-plan-csm.json"),
      "utf8",
    );
    assert.equal(copied, `${JSON.stringify(plan, null, 2)}\n`);
  } finally {
    await rm(wt, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(agentRoot, { recursive: true, force: true });
  }
});

test("module references are free of the opencode runtime word", async () => {
  const source = await readFile(
    new URL("../scripts/lib/agent-session-executor.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /opencode/i);
});
