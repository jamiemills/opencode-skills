"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDockerWorkerProvider,
  verifyWorkerAttestation,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";

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

// T005: hermetic policy/attestation tests (no Docker needed).
const PINNED_DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE_ID = `sha256:${"b".repeat(64)}`;

function policyFixture(overrides = {}) {
  return {
    schema: "csm-orchestrate-docker-worker-policy/2",
    schemaRevision: 2,
    image: `node:22-bookworm-slim@${PINNED_DIGEST}`,
    network: "none",
    mounts: [],
    rootFilesystem: "read-only",
    capabilitiesDrop: ["ALL"],
    noNewPrivileges: true,
    dropCapture: { required: false },
    workspace: { mode: "tmpfs", path: "/workspace", sizeBytes: 1024 },
    limits: {
      memoryBytes: 2147483648,
      pidsLimit: 512,
      cpuQuota: 100000,
      cpuPeriod: 100000,
      sessionTimeoutMs: 3_600_000,
    },
    session: { mode: "long-lived", heartbeatMs: 15000, reapingInit: true },
    attestation: { required: true, cadenceMs: 60000, controls: ["mountsEmpty"] },
    ...overrides,
  };
}

function fakeRun(records, { digest = PINNED_DIGEST, imageId = IMAGE_ID } = {}) {
  return async (_docker, args) => {
    records.push(args.join(" "));
    if (args[0] === "create") return { code: 0, stdout: "cid-t005\n", stderr: "" };
    if (args[0] === "inspect")
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            Id: "cid-t005",
            Image: imageId,
            RepoDigests: [`node@${digest}`],
            Mounts: [],
            HostConfig: {
              ReadonlyRootfs: true,
              NetworkMode: "none",
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges:true"],
              Env: [],
              PidsLimit: 512,
              Memory: 2147483648,
              Init: true,
              Mounts: [],
              Binds: [],
            },
          },
        ]),
        stderr: "",
      };
    return { code: 0, stdout: "", stderr: "" };
  };
}

test("T005: start validates the policy against /1 or /2 and fails closed first", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records) });
  await assert.rejects(
    provider.start({
      policy: policyFixture({ schema: "csm-orchestrate-docker-worker-policy/3" }),
    }),
    /unsupported worker policy schema/,
  );
  await assert.rejects(
    provider.start({ policy: policyFixture({ image: "node:22-bookworm-slim" }) }),
    /worker policy failed csm-orchestrate-docker-worker-policy\/2/,
  );
  const noLimits = policyFixture();
  delete noLimits.limits;
  await assert.rejects(provider.start({ policy: noLimits }), /worker policy failed/);
  assert.equal(records.length, 0, "no docker call may happen under an invalid policy");
});

test("T005: start accepts both registered policy revisions", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records) });
  const v1Policy = policyFixture({
    schema: "csm-orchestrate-docker-worker-policy/1",
    schemaRevision: 1,
  });
  delete v1Policy.dropCapture;
  const started = await provider.start({ name: "w-v1", policy: v1Policy });
  try {
    assert.equal(started.attestation.imagePinned, true);
    assert.equal(started.attestationDoc.imageDigest, PINNED_DIGEST);
    assert.equal(started.session.mode, "long-lived");
  } finally {
    await provider.stop({ id: started.id });
  }
});

test("T005: the signed attestation binds the matched RepoDigest, not the image ID", async () => {
  const records = [];
  const anchorKey = Buffer.from("t005-anchor-key-0123456789abcdef");
  const provider = createDockerWorkerProvider({ run: fakeRun(records), anchorKey });
  const started = await provider.start({ name: "w-tier2", policy: policyFixture() });
  try {
    assert.equal(started.attestation.imagePinned, true);
    assert.equal(started.attestation.imageId, IMAGE_ID);
    assert.equal(started.attestation.imageDigest, PINNED_DIGEST);
    assert.equal(started.attestationDoc.imageDigest, PINNED_DIGEST);
    assert.notEqual(started.attestationDoc.imageDigest, IMAGE_ID);
    assert.match(started.attestation.matchedRepoDigest, /@sha256:[a-f0-9]{64}$/);
    assert.equal(verifyWorkerAttestation({ doc: started.attestationDoc, anchorKey }), true);
  } finally {
    await provider.stop({ id: started.id });
  }
});

test("T005: a mismatched RepoDigest fails the policy pin invariant", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({
    run: fakeRun(records, { digest: `sha256:${"c".repeat(64)}` }),
  });
  await assert.rejects(provider.start({ policy: policyFixture() }), /imagePinned/);
});

test("T005: the policy network declaration is consumed and cannot lie", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records) });
  await assert.rejects(
    provider.start({ policy: policyFixture({ network: "broker" }) }),
    /network=broker requires an egress configuration/,
  );
  await assert.rejects(
    provider.start({
      policy: policyFixture({ network: "none" }),
      egress: { brokerScript: "serve()" },
    }),
    /network=none forbids an egress configuration/,
  );
  assert.equal(records.length, 0);
});

test("T005: an unpinned image is allowed only when no pin is required", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({
    run: fakeRun(records),
    image: "node:22-bookworm-slim",
  });
  const started = await provider.start({ workerSource: "export {};\n" });
  try {
    assert.equal(started.attestation.imagePinned, false);
    assert.equal(started.attestationDoc.imageDigest, PINNED_DIGEST);
  } finally {
    await provider.stop({ id: started.id });
  }
});
