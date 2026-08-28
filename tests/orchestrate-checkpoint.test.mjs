// Hermetic tests for the autonomy checkpoint helper
// (csm-orchestrate/lib/checkpoint.mjs). Git-backed tests build throwaway
// repositories under os.tmpdir(); nothing in the real repository is touched.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  preAutonomyRun,
  rollbackToCheckpoint,
  stripSecretsFromContext,
} from "../csm-orchestrate/lib/checkpoint.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-test-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "t@test"]);
  git(root, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "one");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return root;
}

test("preAutonomyRun on a dirty tree stashes changes and reports the checkpoint", async () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "seed.txt"), "two");
    const result = await preAutonomyRun("run-1", root);
    assert.equal(result.wasDirty, true);
    assert.equal(result.checkpointRef, "stash@{0}");
    const stashList = git(root, ["stash", "list"]);
    assert.ok(
      stashList.includes("pre-autonomy-run-1"),
      `stash entry message recorded: ${stashList}`,
    );
    assert.equal(git(root, ["status", "--porcelain"]), "", "tree is clean after checkpoint");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("preAutonomyRun on a clean tree is a no-op", async () => {
  const root = makeRepo();
  try {
    const result = await preAutonomyRun("run-2", root);
    assert.equal(result.wasDirty, false);
    assert.equal(result.checkpointRef, null);
    assert.equal(git(root, ["stash", "list"]), "", "no stash created");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rollbackToCheckpoint restores the stashed working tree", async () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "seed.txt"), "two");
    await preAutonomyRun("run-3", root);
    assert.equal(fs.readFileSync(path.join(root, "seed.txt"), "utf8"), "one");
    const result = await rollbackToCheckpoint(root);
    assert.deepEqual(result, { restored: true });
    assert.equal(
      fs.readFileSync(path.join(root, "seed.txt"), "utf8"),
      "two",
      "dirty content restored",
    );
    assert.equal(git(root, ["stash", "list"]), "", "stash consumed by pop");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stripSecretsFromContext redacts sensitive keys in nested objects and arrays", () => {
  const input = {
    model: "glm",
    apiToken: "abc123",
    Authorization: "Bearer x",
    nested: {
      password: "hunter2",
      safe: "keep",
      deeper: [{ apiKey: "k1", name: "n1" }],
    },
    credentials: { user: "u", secretKey: "s" },
  };
  const stripped = stripSecretsFromContext(input);
  assert.equal(stripped.apiToken, "[REDACTED]");
  assert.equal(stripped.Authorization, "[REDACTED]");
  assert.equal(stripped.model, "glm");
  assert.equal(stripped.nested.password, "[REDACTED]");
  assert.equal(stripped.nested.safe, "keep");
  assert.equal(stripped.nested.deeper[0].apiKey, "[REDACTED]");
  assert.equal(stripped.nested.deeper[0].name, "n1");
  assert.equal(stripped.credentials, "[REDACTED]");
});

test("stripSecretsFromContext does not mutate its input", () => {
  const input = {
    sessionToken: "t0",
    nested: [{ SECRET: "s0", ok: 1 }],
  };
  stripSecretsFromContext(input);
  assert.equal(input.sessionToken, "t0");
  assert.equal(input.nested[0].SECRET, "s0");
  assert.equal(input.nested[0].ok, 1);
});
