"use strict";

import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { isGitWorktree, killTree, scrubChildEnv } from "../scripts/lib/agent-session-executor.mjs";

test("T014: scrubChildEnv removes credential-shaped keys but keeps benign ones", () => {
  const env = scrubChildEnv({
    PATH: "/usr/bin",
    HOME: "/home/x",
    GITHUB_TOKEN: "ghp_secret",
    GH_TOKEN: "x",
    NPM_TOKEN: "x",
    AWS_SECRET_ACCESS_KEY: "x",
    MY_TOKEN: "x",
    SIGNING_KEY: "x",
    DB_PASSWORD: "x",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    HTTPS_PROXY: "http://user:pass@proxy",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/x");
  for (const key of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NPM_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "MY_TOKEN",
    "SIGNING_KEY",
    "DB_PASSWORD",
    "SSH_AUTH_SOCK",
    "HTTPS_PROXY",
  ])
    assert.equal(Object.hasOwn(env, key), false, `${key} should be scrubbed`);
});

test("T014: isGitWorktree rejects symlinks and non-worktree directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-hardening-"));
  try {
    const plain = join(dir, "plain");
    await mkdir(plain);
    assert.equal(isGitWorktree(plain), false);
    const worktree = join(dir, "wt");
    await mkdir(worktree);
    await symlink("/somewhere/.git", join(worktree, ".git"));
    assert.equal(isGitWorktree(worktree), false, "symlinked .git marker is refused");
    const linked = join(dir, "link-to-wt");
    await symlink(worktree, linked);
    assert.equal(isGitWorktree(linked), false, "symlinked directory is refused");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T014: killTree reaps the child process group including descendants", async () => {
  const script =
    'const { spawn } = require("node:child_process");' +
    'const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });' +
    "process.stdout.write(String(g.pid));" +
    "setInterval(()=>{},1000);";
  const child = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const grandchildPid = await new Promise((resolve) => {
    child.stdout.on("data", (chunk) => resolve(Number(String(chunk).trim())));
  });
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
  killTree(child, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 300));
  let alive = true;
  try {
    process.kill(grandchildPid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, "grandchild should be reaped with the process group");
});
