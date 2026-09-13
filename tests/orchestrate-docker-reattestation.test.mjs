"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  attestDockerWorker,
  buildWorkerAttestation,
  createReattestationMonitor,
  inspectionFromAttestation,
  verifyWorkerAttestation,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const ANCHOR_KEY = Buffer.from("reattest-anchor-key-0123456789");
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;

const healthy = {
  id: "worker-1",
  image: "sha256:abc",
  repoDigests: [`node:22@${IMAGE_DIGEST}`],
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

test("T005: the re-attestation monitor records snapshots, kills, and fails closed on drift", async () => {
  const observations = [healthy, { ...healthy, mounts: [{ type: "bind", bind: "/host:/x" }] }];
  let index = 0;
  const drifts = [];
  let killed = 0;
  const monitor = createReattestationMonitor({
    inspect: async () => observations[Math.min(index++, observations.length - 1)],
    stop: async () => {
      killed += 1;
    },
    cadenceMs: 60_000,
    onDrift: (event) => drifts.push(event),
  });

  const first = await monitor.tick();
  assert.equal(first.drift, false);
  const second = await monitor.tick();
  assert.equal(second.drift, true);
  assert.deepEqual(second.failed, ["mountsEmpty"]);
  assert.equal(killed, 1, "drift must kill the worker");
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].reason, "attestation-drift");
  assert.equal(monitor.snapshots().length, 2);

  // After drift the monitor is terminal: further ticks do not advance.
  const third = await monitor.tick();
  assert.equal(third, second);
  assert.equal(monitor.snapshots().length, 2);
});

test("T005: the re-attestation monitor fails closed when inspect errors", async () => {
  let killed = 0;
  const drifts = [];
  const monitor = createReattestationMonitor({
    inspect: async () => {
      throw new Error("docker inspect failed");
    },
    stop: async () => {
      killed += 1;
    },
    onDrift: (event) => drifts.push(event),
  });
  const snapshot = await monitor.tick();
  assert.equal(snapshot.drift, true);
  assert.deepEqual(snapshot.failed, ["inspect-error"]);
  assert.equal(killed, 1);
  assert.equal(drifts[0].reason, "inspect-error");
});

test("T005: attestDockerWorker requires every frozen control", () => {
  assert.equal(attestDockerWorker({ ...healthy, network: "bridge" }).networkIsolated, false);
  assert.equal(attestDockerWorker({ ...healthy, init: false }).reapingInit, false);
  assert.equal(attestDockerWorker(healthy).imagePinned, false);
  const all = attestDockerWorker(healthy, { expectedImageDigest: IMAGE_DIGEST });
  assert.equal(all.imagePinned, true);
  assert.equal(Object.values(all).filter((value) => value === false).length, 0);
});

test("T008: worker attestation is schema-shaped and registry-valid", async () => {
  const registry = await loadSchemaRegistry();
  const inspection = inspectionFromAttestation(
    attestDockerWorker(healthy, { expectedImageDigest: IMAGE_DIGEST }),
    "2026-09-13T00:00:00.000Z",
  );
  const document = buildWorkerAttestation({
    workerId: "worker-build-1",
    runId: "run-worker-1",
    policyDigest: `sha256:${"a".repeat(64)}`,
    imageDigest: `sha256:${"b".repeat(64)}`,
    inspections: [inspection],
    anchorKey: ANCHOR_KEY,
    now: () => "2026-09-13T00:00:00.000Z",
  });
  const result = registry.validate("csm-orchestrate-worker-attestation/1", document);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.match(document.anchor.headDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(document.anchor.external, true);
  assert.equal(verifyWorkerAttestation({ doc: document, anchorKey: ANCHOR_KEY }), true);
  const tampered = structuredClone(document);
  tampered.inspections[0].controlResults.mountsEmpty = false;
  assert.equal(
    verifyWorkerAttestation({ doc: tampered, anchorKey: ANCHOR_KEY }),
    false,
    "content change must change the keyed head",
  );
  assert.throws(
    () =>
      buildWorkerAttestation({
        workerId: "worker-build-1",
        runId: "run-worker-1",
        policyDigest: `sha256:${"a".repeat(64)}`,
        imageDigest: `sha256:${"b".repeat(64)}`,
        inspections: [inspection],
      }),
    /keyed anchor/,
  );
});
