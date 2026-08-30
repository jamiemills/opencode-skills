import assert from "node:assert/strict";
import test from "node:test";
import { createCliHost, parseJsonResult } from "../csm-orchestrate/lib/cli-host.mjs";

const request = {
  parentRunId: "run-parent",
  childRunId: "run-child",
  phaseId: "phase-one",
  edgeId: "edge-one",
  skill: "csm-build",
  skillDigest: `sha256:${"a".repeat(64)}`,
  inputArtifactRefs: [],
  permissions: ["read", "write"],
  retry: { attempt: 1, idempotencyKey: "plan-task-1" },
};

test("strict parser accepts the final JSON result and ignores preceding events", () => {
  assert.deepEqual(parseJsonResult('{"type":"text"}\n{"status":"completed"}'), {
    status: "completed",
  });
});

test("strict parser rejects output without a result object", () => {
  assert.throws(() => parseJsonResult('{"type":"text"}'), /did not return a JSON result/);
});

test("CLI host passes bounded context and returns the child result", async () => {
  let call;
  const host = createCliHost({
    command: "opencode",
    cwd: "/workspace",
    agentForSkill: () => "build",
    runner: async (...args) => {
      call = args;
      return {
        stdout: JSON.stringify({
          status: "blocked",
          failure: { class: "policy", code: "approval-required" },
        }),
      };
    },
  });
  const result = await host.invokeSiblingSkill(request);
  assert.equal(result.status, "blocked");
  assert.deepEqual(call[0], "opencode");
  assert.deepEqual(call[1].slice(0, 7), [
    "run",
    "--format",
    "json",
    "--agent",
    "build",
    "--dir",
    "/workspace",
  ]);
  assert.match(call[1].at(-1), /parentRunId/);
});

test("CLI host converts malformed child output to incomplete", async () => {
  const host = createCliHost({ runner: async () => ({ stdout: "not-json" }) });
  const result = await host.invokeSiblingSkill(request);
  assert.deepEqual(result.failure, {
    class: "host",
    code: "invalid-child-output",
    message: "child host did not return a JSON result object",
  });
});

test("CLI host converts timeout and cancellation to incomplete", async () => {
  const timeout = createCliHost({
    runner: async () => {
      const error = new Error("timed out");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });
  assert.equal((await timeout.invokeSiblingSkill(request)).failure.code, "timeout");
  const controller = new AbortController();
  controller.abort();
  const cancelled = createCliHost({ runner: async () => ({ stdout: "never" }) });
  assert.equal(
    (await cancelled.invokeSiblingSkill(request, { signal: controller.signal })).failure.code,
    "cancelled",
  );
});
