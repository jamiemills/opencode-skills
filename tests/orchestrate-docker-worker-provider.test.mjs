"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDockerWorkerProvider } from "../csm-orchestrate/lib/docker-worker-provider.mjs";

const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

function makeTar(dir) {
  const result = spawnSync("tar", ["-cf", "-", "--owner=0", "--group=0", "-C", dir, "."], {
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

const WORKER_SOURCE =
  'import readline from "node:readline";\n' +
  "const rl = readline.createInterface({ input: process.stdin });\n" +
  'rl.on("line", (line) => { const m = JSON.parse(line); process.stdout.write(JSON.stringify({ echo: m }) + "\\n"); });\n';

test(
  "T004: the docker worker provider runs a long-lived session inside the frozen boundary",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "csm-dw-"));
    const anchorKey = Buffer.from("test-anchor-key-0123456789abcdef");
    const provider = createDockerWorkerProvider({
      image: "node:22-bookworm-slim",
      anchorKey,
    });
    let id = null;
    try {
      await writeFile(join(dir, "seed.txt"), "seed\n");
      const started = await provider.start({
        workspaceTar: makeTar(dir),
        workerSource: WORKER_SOURCE,
      });
      id = started.id;
      assert.equal(typeof started.attestation.imageDigest, "string");
      assert.equal(started.attestation.imageDigest.length > 0, true);
      assert.equal(
        started.attestation.imagePinned,
        false,
        "an unpinned image must not report imagePinned=true",
      );
      for (const control of [
        "mountsEmpty",
        "rootFilesystemReadOnly",
        "networkIsolated",
        "capDropAll",
        "noNewPrivileges",
        "credentialsNone",
        "reapingInit",
        "resourceEnvelope",
      ])
        assert.equal(started.attestation[control], true, `control ${control} failed`);
      assert.match(started.attestation.workspaceDigest, /^sha256:[a-f0-9]{64}$/);
      const { loadSchemaRegistry } = await import("../lib/schema-runtime/index.mjs");
      const registry = await loadSchemaRegistry();
      const docResult = registry.validate(
        "csm-orchestrate-worker-attestation/1",
        started.attestationDoc,
      );
      assert.equal(docResult.valid, true, JSON.stringify(docResult.errors));
      const { verifyWorkerAttestation } =
        await import("../csm-orchestrate/lib/docker-worker-provider.mjs");
      assert.equal(
        verifyWorkerAttestation({ doc: started.attestationDoc, anchorKey }),
        true,
        "untampered attestation must verify under the anchor key",
      );
      const tampered = structuredClone(started.attestationDoc);
      tampered.inspections[0].controlResults.networkIsolated = false;
      assert.equal(
        verifyWorkerAttestation({ doc: tampered, anchorKey }),
        false,
        "tampered inspections must not verify",
      );
      assert.equal(
        verifyWorkerAttestation({ doc: started.attestationDoc, anchorKey: Buffer.from("wrong") }),
        false,
        "a wrong anchor key must not verify",
      );
      const { responses } = await provider.session({
        id,
        messages: [{ n: 1 }, { n: 2 }],
        timeoutMs: 30_000,
      });
      assert.equal(responses.length, 2);
      assert.deepEqual(responses[0], { echo: { n: 1 } });
      assert.deepEqual(responses[1], { echo: { n: 2 } });
    } finally {
      if (id) await provider.stop({ id });
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "T004: the docker worker session sustains multiple round-trips over one stdin",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "csm-dw-sustained-"));
    const provider = createDockerWorkerProvider({
      image: "node:22-bookworm-slim",
      anchorKey: Buffer.from("test-anchor-key-0123456789abcdef"),
    });
    let id = null;
    try {
      await writeFile(join(dir, "seed.txt"), "seed\n");
      const started = await provider.start({
        workspaceTar: makeTar(dir),
        workerSource: WORKER_SOURCE,
      });
      id = started.id;
      const result = await provider.session({
        id,
        messages: [{ round: 1 }],
        timeoutMs: 30_000,
        onResponse: (response, index) => {
          if (index === 0) return { round: 2 };
          if (index === 1) return { round: 3 };
          return null;
        },
      });
      assert.equal(result.sustained, true);
      assert.equal(result.responses.length, 3, "all three rounds must be echoed");
      assert.equal(result.roundTrips, 2, "stdin must stay open across round trips");
      assert.deepEqual(result.responses[0], { echo: { round: 1 } });
      assert.deepEqual(result.responses[1], { echo: { round: 2 } });
      assert.deepEqual(result.responses[2], { echo: { round: 3 } });
    } finally {
      if (id) await provider.stop({ id });
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "T004: the docker worker session heartbeats until the caller aborts",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "csm-dw-heartbeat-"));
    const provider = createDockerWorkerProvider({
      image: "node:22-bookworm-slim",
      anchorKey: Buffer.from("test-anchor-key-0123456789abcdef"),
    });
    let id = null;
    try {
      await writeFile(join(dir, "seed.txt"), "seed\n");
      const started = await provider.start({
        workspaceTar: makeTar(dir),
        workerSource: WORKER_SOURCE,
      });
      id = started.id;
      const controller = new AbortController();
      const result = await provider.session({
        id,
        timeoutMs: 30_000,
        heartbeatMs: 25,
        signal: controller.signal,
        onResponse: (response, index) => {
          if (index >= 2) controller.abort();
          return undefined;
        },
      });
      assert.equal(result.sustained, true);
      assert.equal(
        result.heartbeats >= 3,
        true,
        `expected sustained heartbeats, got ${result.heartbeats}`,
      );
      assert.equal(result.responses.length >= 3, true);
      assert.equal(
        result.responses.every((response) => response.echo?.type === "heartbeat"),
        true,
      );
    } finally {
      if (id) await provider.stop({ id });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
