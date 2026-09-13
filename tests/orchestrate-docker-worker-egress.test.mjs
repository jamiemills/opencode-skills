"use strict";

// T004: the Docker worker provider honors a mediated-egress configuration —
// the worker is created on the broker-only internal network, the enforcer
// provisions dual-homing + drop logging, drops are sourced, and stop tears the
// network/broker down. Hermetic (fake docker run + fake enforcer).
import assert from "node:assert/strict";
import test from "node:test";
import { createDockerWorkerProvider } from "../csm-orchestrate/lib/docker-worker-provider.mjs";

const IMAGE_DIGEST = "sha256:" + "b".repeat(64);

function fakeRun(calls) {
  return async (_docker, args) => {
    calls.push(args.join(" "));
    if (args[0] === "create") return { code: 0, stdout: "cid-worker\n", stderr: "" };
    if (args[0] === "inspect")
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            Id: "cid-worker",
            Image: IMAGE_DIGEST,
            Mounts: [],
            HostConfig: {
              ReadonlyRootfs: true,
              NetworkMode: "csm-internal-1",
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

const SAMPLE_DROPS = [
  { dest_ip: "203.0.113.7", dest_port: 443, protocol: 6 },
  { dest_ip: "203.0.113.7", dest_port: 443, protocol: 6 },
  { dest_ip: "198.51.100.9", dest_port: 53, protocol: 17 },
];

function fakeEnforcer(log, { drops = SAMPLE_DROPS, degraded = false, provisionError = null } = {}) {
  return {
    async provision(options) {
      log.push(["provision", options]);
      return {
        network: "csm-internal-1",
        internalNetwork: "csm-internal-1",
        egressNetwork: "csm-egress-1",
        brokerId: "bid",
        brokerName: "b1",
      };
    },
    async provisionDropLogging(options) {
      log.push(["provisionDropLogging", options]);
      if (provisionError) throw provisionError;
      return options;
    },
    async collectDrops(options) {
      log.push(["collectDrops", options]);
      return {
        workerId: options.workerId,
        count: drops.length,
        drops,
        degraded,
        reason: degraded ? "iptables-unavailable" : null,
      };
    },
    async removeDropLogging(options) {
      log.push(["removeDropLogging", options]);
      return { workerId: options.workerId, removed: true };
    },
    async teardown(options) {
      log.push(["teardown", options]);
    },
  };
}

test("T004: provider starts the worker on the internal network and tears down egress", async () => {
  const calls = [];
  const log = [];
  const provider = createDockerWorkerProvider({
    run: fakeRun(calls),
    egressEnforcer: fakeEnforcer(log),
  });
  const started = await provider.start({
    name: "w1",
    workerSource: "export {};\n",
    egress: { brokerScript: "serve()", brokerImage: "broker:img" },
  });

  assert.ok(
    calls.some((c) => c.includes("--network csm-internal-1")),
    "worker must be created on the internal network, not `none`",
  );
  assert.equal(started.egress.internalNetwork, "csm-internal-1");
  assert.equal(started.egress.egressNetwork, "csm-egress-1");
  assert.equal(started.attestation.networkIsolated, true, "internal network counts as isolated");
  assert.ok(
    log.some(
      ([name, options]) => name === "provisionDropLogging" && options.workerId === "cid-worker",
    ),
    "drop logging must be installed in the worker netns",
  );

  const drops = await provider.collectDrops({ id: "cid-worker" });
  assert.equal(drops.count, 3);

  await provider.stop({ id: "cid-worker" });
  assert.ok(
    log.some(
      ([name, options]) =>
        name === "teardown" &&
        options.network === "csm-internal-1" &&
        options.egressNetwork === "csm-egress-1" &&
        options.brokerName === "b1",
    ),
    "stop must tear down both networks and the broker",
  );
  assert.ok(
    log.some(
      ([name, options]) => name === "removeDropLogging" && options.workerId === "cid-worker",
    ),
    "stop must remove the drop reader from the worker netns",
  );
});

test("T002: provider feeds per-drop facts into broker.recordDrop", async () => {
  const calls = [];
  const log = [];
  const recorded = [];
  const broker = {
    recordDrop(options) {
      recorded.push(options);
      return { decision: "dropped-unmediated", ...options };
    },
  };
  const provider = createDockerWorkerProvider({
    run: fakeRun(calls),
    egressEnforcer: fakeEnforcer(log),
  });
  await provider.start({
    name: "w2",
    workerSource: "export {};\n",
    egress: { brokerScript: "serve()" },
  });

  const result = await provider.collectDrops({
    id: "cid-worker",
    broker,
    meta: { taskId: "T002" },
  });
  assert.equal(result.degraded, false);
  assert.equal(result.recorded.length, 3);
  assert.equal(recorded[0].targetHost, "203.0.113.7");
  assert.equal(recorded[0].targetPort, 443);
  assert.equal(recorded[0].reasonCode, "kernel-drop");
  assert.equal(recorded[0].workerId, "worker-cid-worker");
  assert.equal(recorded[0].taskId, "T002");
  assert.equal(recorded[2].targetHost, "198.51.100.9");
});

test("T002: capture degradation is observable and only fails closed when required", async () => {
  const calls = [];
  const log = [];
  const provider = createDockerWorkerProvider({
    run: fakeRun(calls),
    egressEnforcer: fakeEnforcer(log, {
      drops: [],
      provisionError: new Error("iptables-unavailable"),
    }),
  });

  const started = await provider.start({
    name: "w3",
    workerSource: "export {};\n",
    egress: { brokerScript: "serve()", requireDropCapture: false },
  });
  assert.equal(started.egress.capture.degraded, true);
  assert.match(started.egress.capture.reason, /iptables-unavailable/);

  const drops = await provider.collectDrops({ id: "cid-worker" });
  assert.equal(drops.degraded, true);
  assert.deepEqual(drops.drops, []);

  await assert.rejects(
    provider.start({
      name: "w4",
      workerSource: "export {};\n",
      egress: { brokerScript: "serve()", requireDropCapture: true },
    }),
    /iptables-unavailable/,
    "policy that requires capture must fail closed",
  );
});
