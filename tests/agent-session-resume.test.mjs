"use strict";

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import { createCsmBuildHandoff } from "../csm-orchestrate/lib/csm-build-handoff.mjs";
import { createCsmBuildAgentSessionExecutor } from "../scripts/lib/agent-session-executor.mjs";

const EXEC_ENV = "CSM_AGENT_SESSION_EXEC";
const IDENTITY = {
  invocationId: "invocation-resume",
  parentRunId: "run-resume-parent",
  childRunId: "run-resume-child",
  phaseId: "phase-resume",
  edgeId: "edge-resume",
  skill: "csm-build",
};
const INPUT_SCHEMA_DIGEST = digest({ schema: "resume-input/1" });
const OUTPUT_SCHEMA_DIGEST = digest({ schema: "resume-output/1" });

// A fake child that never writes child-output.json and never closes, so the
// executor's wait loop always reaches its timeout branch. No real process,
// network, or filesystem side effect beyond the fixture worktree.
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = undefined;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

function fakeSpawn(records) {
  return (file, args, options) => {
    records.push({ file, args, options });
    return new FakeChild();
  };
}

async function withExecEnv(value, fn) {
  const had = Object.hasOwn(process.env, EXEC_ENV);
  const previous = process.env[EXEC_ENV];
  if (value === undefined) delete process.env[EXEC_ENV];
  else process.env[EXEC_ENV] = value;
  try {
    return await fn();
  } finally {
    if (had) process.env[EXEC_ENV] = previous;
    else delete process.env[EXEC_ENV];
  }
}

async function fixtureWorktree() {
  const root = await mkdtemp(join(tmpdir(), "agent-session-resume-wt-"));
  await mkdir(join(root, ".git"));
  return root;
}

function request(overrides = {}) {
  return {
    schema: "request/1",
    ...IDENTITY,
    attempt: 0,
    input: {},
    inputSchema: "request/1",
    outputSchema: "csm-build-output/1",
    inputSchemaDigest: INPUT_SCHEMA_DIGEST,
    outputSchemaDigest: OUTPUT_SCHEMA_DIGEST,
    ...overrides,
  };
}

function executor(worktree, records, overrides = {}) {
  return createCsmBuildAgentSessionExecutor({
    agentCli: "/fake/agent-cli",
    worktreeRoot: worktree,
    spawn: fakeSpawn(records),
    timeoutMs: 40,
    pollIntervalMs: 5,
    ...overrides,
  });
}

function handoff(execute) {
  return createCsmBuildHandoff({
    skill: "csm-build",
    execute,
    inputSchemaDigest: INPUT_SCHEMA_DIGEST,
    outputSchemaDigest: OUTPUT_SCHEMA_DIGEST,
  });
}

test("a guard-reported work-remaining timeout resumes to the hard cap and stays resumable", async () => {
  const wt = await fixtureWorktree();
  const records = [];
  const traces = [];
  try {
    await withExecEnv("1", async () => {
      const result = await executor(wt, records, {
        autoResume: true,
        resumeGuard: () => true,
        maxResumeAttempts: 2,
        trace: (entry) => traces.push(entry),
      }).execute(request());
      assert.equal(result.status, "failed");
      assert.equal(result.failure.code, "agent-session-timeout");
      assert.equal(result.resumable, true);
    });
    assert.equal(records.length, 3, "one initial attempt plus two capped resumes");
    assert.equal(traces.filter((entry) => entry.action === "agent-session-attempt").length, 3);
    assert.equal(traces.filter((entry) => entry.action === "agent-session-resume").length, 2);
  } finally {
    await rm(wt, { recursive: true, force: true });
  }
});

test("a timeout with no work remaining is a terminal non-resumable failure", async () => {
  const wt = await fixtureWorktree();
  const records = [];
  try {
    await withExecEnv("1", async () => {
      const result = await executor(wt, records, {
        autoResume: true,
        resumeGuard: () => false,
        maxResumeAttempts: 2,
      }).execute(request());
      assert.equal(result.status, "failed");
      assert.equal(result.failure.code, "agent-session-timeout");
      assert.equal(result.resumable, false);
    });
    assert.equal(records.length, 1, "a non-resumable timeout is not retried");
  } finally {
    await rm(wt, { recursive: true, force: true });
  }
});

test("auto-resume is off by default and a guard-less timeout stays byte-identical", async () => {
  const wt = await fixtureWorktree();
  const guardedRecords = [];
  try {
    await withExecEnv("1", async () => {
      const guarded = await executor(wt, guardedRecords, {
        resumeGuard: () => true,
      }).execute(request());
      assert.equal(guarded.status, "failed");
      assert.equal(guarded.resumable, true);
      assert.equal(guardedRecords.length, 1, "guard alone never resumes without autoResume");
    });

    const plainRecords = [];
    await withExecEnv("1", async () => {
      const plain = await executor(wt, plainRecords).execute(request());
      assert.equal(plain.status, "failed");
      assert.equal(plain.failure.code, "agent-session-timeout");
      assert.equal(Object.hasOwn(plain, "resumable"), false, "no guard leaves the shape unchanged");
      assert.equal(plainRecords.length, 1);
    });
  } finally {
    await rm(wt, { recursive: true, force: true });
  }
});

test("the handoff passes the resumable flag through without collapsing it to completion", async () => {
  const wt = await fixtureWorktree();
  const records = [];
  try {
    await withExecEnv("1", async () => {
      const wrapped = await handoff(
        executor(wt, records, { resumeGuard: () => true }).execute,
      ).execute({ ...request(), retry: { attempt: 0 } });
      assert.equal(wrapped.status, "failed");
      assert.notEqual(wrapped.status, "completed");
      assert.equal(wrapped.resumable, true);

      const plain = await handoff(executor(wt, []).execute).execute({
        ...request(),
        retry: { attempt: 0 },
      });
      assert.equal(plain.status, "failed");
      assert.equal(Object.hasOwn(plain, "resumable"), false);
    });
  } finally {
    await rm(wt, { recursive: true, force: true });
  }
});
