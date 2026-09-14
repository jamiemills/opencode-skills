"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertNetworkEgressContract,
  attestDockerWorker,
  buildWorkerAttestation,
  createDockerWorkerProvider,
  createReattestationMonitor,
  verifyWorkerAttestation,
  WORKER_ANCHOR_TRUST_DOMAINS,
  WORKER_NETWORK_EGRESS_CODES,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";

const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

// T006 concurrency repair: two concurrent `make test-orchestrate` processes both
// drive the same Docker daemon and raced on the long-lived exec stream (the
// heartbeat interval could write to a socket already torn down -> unhandled
// EPIPE) and on shared resources. Serialize this file's Docker-backed tests
// across processes with a repository-relative filesystem lock. Assertions and
// coverage are unchanged; only the cross-process interleaving is removed.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCKER_TEST_LOCK = join(
  REPO_ROOT,
  ".agents",
  "evidence",
  "orchestrator",
  ".docker-provider-test.lock",
);
let dockerTestLock = null;

async function acquireDockerTestLock(lockPath, { timeoutMs = 300_000, staleMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      return handle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > staleMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        /* lock disappeared between open and stat: retry */
      }
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for the Docker test lock ${lockPath}`, {
          cause: error,
        });
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 50 + Math.floor(Math.random() * 100)),
      );
    }
  }
}

if (DOCKER_AVAILABLE) {
  test.before(async () => {
    await mkdir(dirname(DOCKER_TEST_LOCK), { recursive: true });
    dockerTestLock = await acquireDockerTestLock(DOCKER_TEST_LOCK);
  });
  test.after(async () => {
    if (!dockerTestLock) return;
    await dockerTestLock.close();
    dockerTestLock = null;
    await rm(DOCKER_TEST_LOCK, { force: true });
  });
}

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

function fakeRun(records, { digest = PINNED_DIGEST, imageId = IMAGE_ID, repoDigests } = {}) {
  const digests = repoDigests === undefined ? [`node@${digest}`] : repoDigests;
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
            RepoDigests: digests,
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

// T005: hermetic `docker inspect`-shaped fixture for the RepoDigests quirk.
function inspectFixture({ repoDigests = [`node@${PINNED_DIGEST}`], imageId = IMAGE_ID } = {}) {
  return {
    id: "cid-t005",
    image: imageId,
    repoDigests,
    mounts: [],
    rootFilesystem: "read-only",
    network: "none",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges:true"],
    env: [],
    pidsLimit: 512,
    memory: 2147483648,
    init: true,
  };
}

const CHECKED_IN_POLICY_PATH = new URL(
  "../csm-orchestrate/policies/docker-worker-policy.json",
  import.meta.url,
);

test("T004: the network/egress contract is explicit and fails closed with typed codes", () => {
  const egress = { brokerScript: "serve()" };
  assert.equal(assertNetworkEgressContract("none", null), "none");
  assert.equal(assertNetworkEgressContract("broker", egress), "broker");
  assert.equal(
    assertNetworkEgressContract(null, egress),
    null,
    "an absent policy declaration permits egress",
  );
  assert.equal(assertNetworkEgressContract(undefined, null), null);

  assert.throws(
    () => assertNetworkEgressContract("none", egress),
    (error) =>
      error.code === WORKER_NETWORK_EGRESS_CODES.noneForbidsEgress &&
      /network=none forbids an egress configuration/.test(error.message),
  );
  assert.throws(
    () => assertNetworkEgressContract("broker", null),
    (error) =>
      error.code === WORKER_NETWORK_EGRESS_CODES.brokerRequiresEgress &&
      /network=broker requires an egress configuration/.test(error.message),
  );
  assert.throws(
    () => assertNetworkEgressContract("bridge", egress),
    (error) => error.code === WORKER_NETWORK_EGRESS_CODES.unsupported,
  );
});

test("T004: the checked-in /2 policy declares broker and matches the contract", async () => {
  const policy = JSON.parse(await readFile(CHECKED_IN_POLICY_PATH, "utf8"));
  assert.equal(policy.schema, "csm-orchestrate-docker-worker-policy/2");
  assert.equal(
    policy.network,
    "broker",
    "the build-shaped policy is broker-mediated, matching the egress runtime",
  );
  assert.equal(assertNetworkEgressContract(policy.network, { brokerScript: "serve()" }), "broker");
  assert.throws(
    () => assertNetworkEgressContract(policy.network, null),
    (error) => error.code === WORKER_NETWORK_EGRESS_CODES.brokerRequiresEgress,
  );
});

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

// T005 quirk: a digest-pinned create can yield a container whose inspect reports
// no RepoDigests at all. The pin is proven from the configured digest with a
// recorded source, while a present-but-mismatched set still fails closed.
test("T005 quirk: a matching RepoDigest proves the pin from inspect", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records) });
  const started = await provider.start({ name: "w-present-match", policy: policyFixture() });
  try {
    assert.equal(started.attestation.imagePinned, true);
    assert.equal(started.attestation.repoDigestsObserved, true);
    assert.equal(started.attestation.matchedRepoDigestSource, "inspect");
    assert.equal(started.attestationDoc.imageDigest, PINNED_DIGEST);
  } finally {
    await provider.stop({ id: started.id });
  }
});

test("T005 quirk: a present but mismatched RepoDigest fails closed (source=none)", async () => {
  const attestation = attestDockerWorker(
    inspectFixture({ repoDigests: [`node@sha256:${"c".repeat(64)}`] }),
    { expectedImageDigest: PINNED_DIGEST },
  );
  assert.equal(attestation.imagePinned, false);
  assert.equal(attestation.repoDigestsObserved, true);
  assert.equal(attestation.matchedRepoDigestSource, "none");
});

test("T005 quirk: absent RepoDigests fall back to the configured digest with a recorded signal", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records, { repoDigests: [] }) });
  const started = await provider.start({ name: "w-absent-configured", policy: policyFixture() });
  try {
    assert.equal(started.attestation.imagePinned, true);
    assert.equal(started.attestation.repoDigestsObserved, false);
    assert.equal(started.attestation.matchedRepoDigestSource, "configured");
    assert.equal(started.attestation.matchedRepoDigest, null);
    assert.equal(started.attestation.imageDigest, PINNED_DIGEST);
    assert.equal(started.attestationDoc.imageDigest, PINNED_DIGEST);
  } finally {
    await provider.stop({ id: started.id });
  }
});

test("T005 quirk: absent RepoDigests with no configured digest proves no pin", () => {
  const attestation = attestDockerWorker(inspectFixture({ repoDigests: [] }));
  assert.equal(attestation.imagePinned, false);
  assert.equal(attestation.repoDigestsObserved, false);
  assert.equal(attestation.matchedRepoDigestSource, "none");
  assert.equal(attestation.imageDigest, IMAGE_ID);
});

test("T005 quirk: an unpinned image with no RepoDigests is allowed and binds the image id", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({
    run: fakeRun(records, { repoDigests: [] }),
    image: "node:22-bookworm-slim",
  });
  const started = await provider.start({ workerSource: "export {};\n" });
  try {
    assert.equal(started.attestation.imagePinned, false);
    assert.equal(started.attestation.repoDigestsObserved, false);
    assert.equal(started.attestation.matchedRepoDigestSource, "none");
    assert.equal(started.attestationDoc.imageDigest, IMAGE_ID);
  } finally {
    await provider.stop({ id: started.id });
  }
});

test("T005 quirk: re-attestation does not drift when the daemon omits RepoDigests", async () => {
  let killed = 0;
  const monitor = createReattestationMonitor({
    inspect: async () => inspectFixture({ repoDigests: [] }),
    stop: async () => {
      killed += 1;
    },
    expected: { expectedImageDigest: PINNED_DIGEST },
  });
  const snapshot = await monitor.tick();
  assert.equal(snapshot.drift, false, JSON.stringify(snapshot.failed));
  assert.equal(killed, 0);
  assert.equal(snapshot.attestation.matchedRepoDigestSource, "configured");
});

test("T004: start fails closed on a network/egress mismatch before any docker call", async () => {
  const records = [];
  const provider = createDockerWorkerProvider({ run: fakeRun(records) });
  await assert.rejects(
    provider.start({ policy: policyFixture({ network: "broker" }) }),
    (error) =>
      error.code === WORKER_NETWORK_EGRESS_CODES.brokerRequiresEgress &&
      /network=broker requires an egress configuration/.test(error.message),
  );
  await assert.rejects(
    provider.start({
      policy: policyFixture({ network: "none" }),
      egress: { brokerScript: "serve()" },
    }),
    (error) =>
      error.code === WORKER_NETWORK_EGRESS_CODES.noneForbidsEgress &&
      /network=none forbids an egress configuration/.test(error.message),
  );
  assert.equal(records.length, 0, "a mismatch must not reach docker");
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

// T003 (g3-ruling): the attestation anchor is external to the worker sandbox but
// OS-user-bounded by default. The final-sink re-authorization refuses that
// boundary unless the caller explicitly declares an external anchor key/source.
function t003Attestation(anchorKey) {
  return buildWorkerAttestation({
    workerId: "worker-t003",
    runId: "run-t003",
    policyDigest: `sha256:${"a".repeat(64)}`,
    imageDigest: `sha256:${"b".repeat(64)}`,
    inspections: [{ at: "2026-09-13T00:00:00.000Z", controlResults: { mountsEmpty: true } }],
    anchorKey,
  });
}

test("T003: the provider declares an OS-user-bounded anchor by default", () => {
  const provider = createDockerWorkerProvider({
    run: fakeRun([]),
    anchorKey: Buffer.from("t003-anchor-key-0123456789abcdef"),
  });
  const boundary = provider.trustBoundary();
  assert.equal(boundary.trustDomain, WORKER_ANCHOR_TRUST_DOMAINS.osUser);
  assert.equal(boundary.hostExternal, false);
  assert.equal(boundary.anchorKeySource, "in-process");
  assert.throws(
    () => createDockerWorkerProvider({ anchorTrustDomain: "somewhere-else" }),
    /unsupported anchor trust domain/,
  );
});

test("T003: final-sink attestation re-authorization fails closed on an OS-user-bounded anchor", () => {
  const anchorKey = Buffer.from("t003-anchor-key-0123456789abcdef");
  const provider = createDockerWorkerProvider({ run: fakeRun([]), anchorKey });
  const doc = t003Attestation(anchorKey);

  const refused = provider.reauthorizeAttestation({ doc });
  assert.equal(refused.authorized, false);
  assert.equal(refused.reasonCode, "anchor-not-external-to-host");
  assert.equal(refused.hostExternal, false);

  const accepted = provider.reauthorizeAttestation({ doc, requireHostExternal: false });
  assert.equal(accepted.authorized, true);
  assert.equal(accepted.reasonCode, "anchored");

  const tampered = structuredClone(doc);
  tampered.inspections[0].controlResults.mountsEmpty = false;
  assert.equal(
    provider.reauthorizeAttestation({ doc: tampered, requireHostExternal: false }).reasonCode,
    "attestation-invalid",
  );
});

test("T003: a declared external anchor authorizes the terminal attestation sink", () => {
  const anchorKey = Buffer.from("t003-anchor-key-0123456789abcdef");
  const provider = createDockerWorkerProvider({
    run: fakeRun([]),
    anchorKey,
    anchorTrustDomain: WORKER_ANCHOR_TRUST_DOMAINS.external,
  });
  const result = provider.reauthorizeAttestation({ doc: t003Attestation(anchorKey) });
  assert.equal(result.authorized, true);
  assert.equal(result.hostExternal, true);
  assert.equal(result.anchor.trustDomain, WORKER_ANCHOR_TRUST_DOMAINS.external);
});
