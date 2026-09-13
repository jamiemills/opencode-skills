"use strict";

import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("../scripts/run-worker.mjs", import.meta.url));
const INVOCATION = {
  schema: "csm-orchestrate-invocation/2",
  outputSchema: "csm-orchestrate-receipt/2",
  skill: "csm-scan",
  attempt: 1,
};

function run(args, env = {}) {
  return spawnSync(process.execPath, [WORKER, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("thin worker entry is fail-closed when the env gate is off", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-worker-"));
  try {
    const invocation = join(dir, "invocation.json");
    await writeFile(invocation, `${JSON.stringify(INVOCATION)}\n`);
    const result = run(["--invocation", invocation], { CSM_AGENT_SESSION_EXEC: "" });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.status, "blocked");
    assert.equal(output.failure.code, "agent-session-required");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("thin worker entry runs one invocation and returns a raw child result when enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-worker-"));
  try {
    const invocation = join(dir, "invocation.json");
    await writeFile(invocation, `${JSON.stringify(INVOCATION)}\n`);
    const handler = join(dir, "handler.mjs");
    await writeFile(
      handler,
      'export async function execute(request) { return { status: "completed", skill: request.skill, effects: ["read-only"], artifacts: [] }; }\n',
    );
    const result = run(["--invocation", invocation, "--handler", handler], {
      CSM_AGENT_SESSION_EXEC: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.status, "completed");
    assert.equal(output.skill, "csm-scan");
    assert.deepEqual(Object.keys(output).toSorted(), [
      "artifacts",
      "attempt",
      "effects",
      "failure",
      "receipt",
      "schema",
      "skill",
      "status",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("thin worker entry refuses a symlinked invocation file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-worker-"));
  try {
    const real = join(dir, "real.json");
    const link = join(dir, "link.json");
    await writeFile(real, `${JSON.stringify(INVOCATION)}\n`);
    await symlink(real, link);
    const result = run(["--invocation", link], { CSM_AGENT_SESSION_EXEC: "1" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /regular file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
