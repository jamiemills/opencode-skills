"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDockerGeneratedProvider,
  createDockerSandboxProvider,
} from "../lib/providers/docker.mjs";
import { hash } from "../lib/providers/generated.mjs";

const limits = { timeoutMs: 300, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 * 1024 };
const available = createDockerSandboxProvider();

const generatedRequest = (source) => ({
  format: "csm-autoresearch-evaluator-request/1",
  requestId: "docker-generated-request",
  runId: "docker-generated-run",
  candidate: {
    id: "docker-generated",
    parentId: null,
    sourceHash: hash(source),
    patchHash: hash("docker-generated"),
  },
  limits: { timeoutMs: 1000, maxOutputBytes: 1024, network: "disabled" },
  input: { source, value: 4 },
});

test("Docker provider is explicit and fails closed when Docker is unavailable", () => {
  const provider = createDockerSandboxProvider({ docker: "csm-no-such-docker" });
  assert.equal(provider.name, "docker");
  assert.match(provider.unavailable, /not found|ENOENT|spawn/i);
});

test(
  "Docker-shaped execution flows through generated.evaluate",
  { skip: Boolean(available.unavailable) },
  async () => {
    const source = "export default (value) => ({ score: Number(value) + 1 });";
    const generated = createDockerGeneratedProvider({
      limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 * 1024 },
    });
    const result = await generated.evaluate(generatedRequest(source));
    assert.equal(result.status, "ok");
    assert.deepEqual(result.metrics, { score: 5 });
    assert.equal(result.provenance.sandboxProvider, "docker");
  },
);

test(
  "Docker provider runs a disposable candidate with inspect-bound controls",
  { skip: Boolean(available.unavailable) },
  async () => {
    const result = await available.execute({
      source: "export default (value) => ({ score: Number(value) + 1 });",
      input: 4,
      limits,
    });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.metrics, { score: 5 });
    assert.match(result.attestation.imageDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.attestation.inspectBefore.network, "none");
    assert.deepEqual(result.attestation.inspectBefore.mounts, []);
    assert.equal(result.attestation.inspectBefore.rootFilesystem, "read-only");
    assert.deepEqual(result.attestation.inspectBefore.capDrop, ["ALL"]);
    assert.equal(result.attestation.status, "verified");
    assert.deepEqual(result.cleanup, {
      status: "verified",
      containerAbsent: true,
      descendantsAbsent: true,
      workspaceRemoved: true,
    });
    assert.equal(result.attestation.inspectBefore.credentialNames.length, 0);
    assert.equal(result.attestation.controls.sourceHashBinding, true);
    assert.equal(result.attestation.controls.outputLimit, true);
  },
);

test(
  "Docker provider timeout and cancellation still verify cleanup",
  { skip: Boolean(available.unavailable) },
  async () => {
    const timedOut = await available.execute({
      source:
        "export default async () => { setInterval(() => {}, 10000); await new Promise(() => {}); };",
      input: null,
      limits,
    });
    assert.equal(timedOut.status, "timed_out");
    assert.equal(timedOut.cleanup.status, "verified");

    const controller = new AbortController();
    const cancelledPromise = available.execute({
      source:
        "export default async () => { setInterval(() => {}, 10000); await new Promise(() => {}); };",
      input: null,
      limits: { ...limits, timeoutMs: 1000 },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    const cancelled = await cancelledPromise;
    assert.equal(cancelled.status, "blocked");
    assert.equal(cancelled.cleanup.status, "verified");
  },
);

test(
  "Docker provider fails closed on stdout/stderr output races",
  { skip: Boolean(available.unavailable) },
  async () => {
    const result = await available.execute({
      source:
        "export default () => { process.stdout.write('x'.repeat(900)); process.stderr.write('y'.repeat(900)); return { score: 1 }; };",
      input: null,
      limits: { ...limits, maxOutputBytes: 1024 },
    });
    assert.equal(result.status, "resource_exhausted");
    assert.equal(result.cleanup.status, "verified");
    assert.equal(result.attestation.controls.outputLimit, false);
  },
);

test(
  "Docker provider verifies descendants are gone after candidate termination",
  { skip: Boolean(available.unavailable) },
  async () => {
    const result = await available.execute({
      source:
        "import { spawn } from 'node:child_process'; export default async () => { spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); await new Promise(() => {}); };",
      input: null,
      limits,
    });
    assert.equal(result.status, "timed_out");
    assert.equal(result.cleanup.status, "verified");
    assert.equal(result.attestation.controls.descendantContainment, true);
  },
);
