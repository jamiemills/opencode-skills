"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanupWorkspace,
  executeCandidate,
  publishAtomic,
  redactedProvenance,
  sha256,
} from "../lib/runtime/index.mjs";

async function temp() {
  return mkdtemp(join(tmpdir(), "csm-autoresearch-test-"));
}
const node = process.execPath;

test("candidate execution uses argument arrays and an explicit environment allowlist", async () => {
  const root = await temp();
  const result = await executeCandidate({
    command: node,
    args: [
      "-e",
      "process.stdout.write(process.env.VISIBLE || 'missing'); process.stdout.write(process.env.HIDDEN || '')",
    ],
    cwd: root,
    env: { VISIBLE: "yes", HIDDEN: "no" },
    envAllowlist: ["VISIBLE"],
    timeoutMs: 1000,
    maxOutputBytes: 100,
    workspace: root,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.stdout, "yes");
  assert.equal(result.cleanup.verifiable, true);
  assert.equal((await cleanupWorkspace(root)).cleaned, true);
});

test("output, timeout, cancellation, and workspace limits fail closed", async () => {
  const outputRoot = await temp();
  const output = await executeCandidate({
    command: node,
    args: ["-e", "process.stdout.write('x'.repeat(1000))"],
    cwd: outputRoot,
    timeoutMs: 1000,
    maxOutputBytes: 10,
    workspace: outputRoot,
  });
  assert.equal(output.status, "resource_exhausted");
  await cleanupWorkspace(outputRoot);
  const timeoutRoot = await temp();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const cancelled = await executeCandidate({
    command: node,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    cwd: timeoutRoot,
    timeoutMs: 1000,
    signal: controller.signal,
    workspace: timeoutRoot,
  });
  assert.equal(cancelled.status, "blocked");
  await cleanupWorkspace(timeoutRoot);
  const workspaceRoot = await temp();
  const full = await executeCandidate({
    command: node,
    args: ["-e", "require('fs').writeFileSync('large', '123456789')"],
    cwd: workspaceRoot,
    timeoutMs: 1000,
    maxWorkspaceBytes: 3,
    workspace: workspaceRoot,
  });
  assert.equal(full.status, "resource_exhausted");
  await cleanupWorkspace(workspaceRoot);
});

test("atomic publication and redacted provenance do not expose paths", async () => {
  const root = await temp();
  const path = join(root, "report.json");
  await publishAtomic(path, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ok: true });
  const provenance = redactedProvenance({
    evaluatorHash: sha256("evaluator"),
    environmentHash: sha256("environment"),
    limits: { timeoutMs: 1 },
    sandboxProvider: "provider\nsecret",
  });
  assert.equal(provenance.redacted, true);
  assert.equal(provenance.sandboxProvider, "providersecret");
  assert.equal(JSON.stringify(provenance).includes(root), false);
  assert.equal((await cleanupWorkspace(root)).cleaned, true);
});

test("unsupported command capabilities are not enabled by fallback", async () => {
  const result = await executeCandidate({
    command: node,
    args: [],
    cwd: "/tmp",
    envAllowlist: "not-an-array",
  });
  assert.equal(result.status, "policy_violation");
  const unsupported = await executeCandidate({
    command: node,
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    maxOutputBytes: 100,
    maxMemoryMb: 32,
    workspace: "/tmp/csm-nonexistent-trial",
  });
  assert.equal(unsupported.status, "policy_violation");
});

test("network and unbounded process claims fail before hostile code runs", async () => {
  const root = await temp();
  let executed = false;
  const result = await executeCandidate({
    command: node,
    args: ["-e", "process.env.CREDENTIAL = 'leaked'; process.stdout.write('executed')"],
    cwd: root,
    network: "disabled",
    maxProcesses: 2,
    env: { CREDENTIAL: "synthetic-secret" },
    envAllowlist: ["CREDENTIAL"],
    workspace: root,
  });
  executed = result.stdout === "executed";
  assert.equal(result.status, "policy_violation");
  assert.equal(executed, false);
  assert.equal(result.stdout, "");
  await cleanupWorkspace(root);
});
