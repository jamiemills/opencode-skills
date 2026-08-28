import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  preAutonomyRun,
  rollbackToCheckpoint,
  stripSecretsFromContext,
} from "../csm-orchestrate/lib/checkpoint.mjs";

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function makeRepo() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "checkpoint-test-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "t@test"]);
  await git(root, ["config", "user.name", "test"]);
  await fsp.writeFile(path.join(root, ".gitignore"), "*.log\n");
  await fsp.writeFile(path.join(root, "seed.txt"), "one\n");
  await fsp.writeFile(path.join(root, "tracked.txt"), "base\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "seed"]);
  return root;
}

test("clean tree: checkpoint is a no-op and rollback succeeds", async () => {
  const root = await makeRepo();
  try {
    const head = await git(root, ["rev-parse", "HEAD"]);
    const checkpoint = await preAutonomyRun("run-clean", root);
    assert.equal(checkpoint.wasDirty, false);
    assert.equal(checkpoint.checkpointDir, null);
    assert.equal(checkpoint.manifest, null);
    assert.equal(checkpoint.head, head);
    assert.equal(checkpoint.branch, "main");
    assert.ok(checkpoint.createdAt);
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: true });
    assert.equal(await git(root, ["status", "--porcelain"]), "");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("modified tracked file: rollback restores the pre-run modification after further edits", async () => {
  const root = await makeRepo();
  try {
    await fsp.writeFile(path.join(root, "seed.txt"), "two\n");
    const checkpoint = await preAutonomyRun("run-modified", root);
    assert.equal(checkpoint.wasDirty, true);
    assert.ok(checkpoint.checkpointDir);
    assert.deepEqual(checkpoint.manifest.modified, ["seed.txt"]);
    assert.deepEqual(checkpoint.manifest.staged, []);
    assert.deepEqual(checkpoint.manifest.untracked, []);
    assert.deepEqual(checkpoint.manifest.ignored, []);
    await fsp.writeFile(path.join(root, "seed.txt"), "clobbered by run\n");
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: true });
    assert.equal(await fsp.readFile(path.join(root, "seed.txt"), "utf8"), "two\n");
    await assert.rejects(fsp.stat(checkpoint.checkpointDir));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("untracked file: checkpoint captures it and rollback restores it after the run deletes it", async () => {
  const root = await makeRepo();
  try {
    await fsp.writeFile(path.join(root, "notes.md"), "draft\n");
    const checkpoint = await preAutonomyRun("run-untracked", root);
    assert.equal(checkpoint.wasDirty, true);
    assert.deepEqual(checkpoint.manifest.modified, []);
    assert.deepEqual(checkpoint.manifest.untracked, ["notes.md"]);
    await fsp.rm(path.join(root, "notes.md"));
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: true });
    assert.equal(await fsp.readFile(path.join(root, "notes.md"), "utf8"), "draft\n");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("staged + unstaged + untracked: rollback restores all three and preserves ignored files", async () => {
  const root = await makeRepo();
  try {
    await fsp.writeFile(path.join(root, "seed.txt"), "two\n");
    await git(root, ["add", "seed.txt"]);
    await fsp.writeFile(path.join(root, "tracked.txt"), "changed\n");
    await fsp.writeFile(path.join(root, "fresh.txt"), "new\n");
    await fsp.writeFile(path.join(root, "debug.log"), "noise\n");
    const checkpoint = await preAutonomyRun("run-mixed", root);
    assert.equal(checkpoint.wasDirty, true);
    assert.deepEqual(checkpoint.manifest.staged, ["seed.txt"]);
    assert.deepEqual(checkpoint.manifest.modified, ["tracked.txt"]);
    assert.deepEqual(checkpoint.manifest.untracked, ["fresh.txt"]);
    assert.deepEqual(checkpoint.manifest.ignored, ["debug.log"]);
    await fsp.writeFile(path.join(root, "seed.txt"), "run\n");
    await fsp.writeFile(path.join(root, "tracked.txt"), "run\n");
    await fsp.rm(path.join(root, "fresh.txt"));
    await fsp.writeFile(path.join(root, "run-junk.txt"), "junk\n");
    await fsp.writeFile(path.join(root, "debug.log"), "run-noise\n");
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: true });
    assert.equal(await fsp.readFile(path.join(root, "seed.txt"), "utf8"), "two\n");
    assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "seed.txt");
    assert.equal(await fsp.readFile(path.join(root, "tracked.txt"), "utf8"), "changed\n");
    assert.equal(await git(root, ["diff", "--name-only"]), "tracked.txt");
    assert.equal(await fsp.readFile(path.join(root, "fresh.txt"), "utf8"), "new\n");
    await assert.rejects(fsp.readFile(path.join(root, "run-junk.txt"), "utf8"));
    assert.equal(
      await fsp.readFile(path.join(root, "debug.log"), "utf8"),
      "run-noise\n",
      "ignored file survives git clean -fd",
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("rollback reports verification-mismatch when the snapshot cannot fully restore", async () => {
  const root = await makeRepo();
  try {
    await fsp.writeFile(path.join(root, "seed.txt"), "two\n");
    await fsp.writeFile(path.join(root, "notes.md"), "draft\n");
    const checkpoint = await preAutonomyRun("run-mismatch", root);
    await fsp.writeFile(path.join(root, "seed.txt"), "run\n");
    await fsp.rm(path.join(root, "notes.md"));
    await fsp.rm(path.join(checkpoint.checkpointDir, "untracked", "notes.md"));
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: false, reason: "verification-mismatch" });
    await assert.doesNotReject(fsp.stat(checkpoint.checkpointDir));
    assert.equal(await fsp.readFile(path.join(root, "seed.txt"), "utf8"), "two\n");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("same-file staged and unstaged changes are both restored by rollback", async () => {
  const root = await makeRepo();
  try {
    await fsp.writeFile(path.join(root, "seed.txt"), "two\n");
    await git(root, ["add", "seed.txt"]);
    await fsp.writeFile(path.join(root, "seed.txt"), "three\n");
    const checkpoint = await preAutonomyRun("run-partial", root);
    assert.deepEqual(checkpoint.manifest.staged, ["seed.txt"]);
    assert.deepEqual(checkpoint.manifest.modified, ["seed.txt"]);
    await fsp.writeFile(path.join(root, "seed.txt"), "run\n");
    await git(root, ["add", "seed.txt"]);
    const result = await rollbackToCheckpoint(checkpoint, root);
    assert.deepEqual(result, { restored: true });
    assert.equal(await fsp.readFile(path.join(root, "seed.txt"), "utf8"), "three\n");
    assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "seed.txt");
    assert.equal(await git(root, ["diff", "--name-only"]), "seed.txt");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
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
