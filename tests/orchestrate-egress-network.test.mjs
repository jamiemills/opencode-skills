"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createEgressNetworkEnforcer,
  parseDropCount,
} from "../csm-orchestrate/lib/egress-network.mjs";

const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

test(
  "T004: a worker on the internal network reaches the broker but not the internet",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const enforcer = createEgressNetworkEnforcer();
    const workerName = `csm-net-worker-${process.pid}`;
    let provisioned = null;
    spawnSync("docker", ["rm", "-f", workerName], { stdio: "ignore" });
    try {
      provisioned = await enforcer.provision({
        brokerName: `csm-net-broker-${process.pid}`,
        brokerScript: 'require("http").createServer((q,s)=>s.end("ok")).listen(8080,"0.0.0.0")',
      });
      const worker = spawnSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          workerName,
          "--network",
          provisioned.network,
          "node:22-bookworm-slim",
          "sleep",
          "infinity",
        ],
        { encoding: "utf8" },
      );
      assert.equal(worker.status, 0, worker.stderr);

      const allowed = await enforcer.probe({
        workerId: workerName,
        script: `require("http").get("http://${provisioned.brokerName}:8080", (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { process.stdout.write(d); }); }).on("error", (e) => { process.stdout.write("ERR:" + e.code); });`,
      });
      assert.match(allowed.stdout, /ok/);

      const blocked = await enforcer.probe({
        workerId: workerName,
        script:
          'require("net").connect(443, "1.1.1.1").on("connect", () => process.stdout.write("CONNECTED")).on("error", (e) => process.stdout.write("ERR:" + e.code));',
      });
      assert.match(blocked.stdout, /^ERR:/);
    } finally {
      spawnSync("docker", ["rm", "-f", workerName], { stdio: "ignore" });
      if (provisioned) await enforcer.teardown(provisioned);
    }
  },
);

test(
  "T001: an allowlisted upstream is reachable only through the dual-homed broker",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const enforcer = createEgressNetworkEnforcer();
    const workerName = `csm-up-worker-${process.pid}`;
    const upstreamName = `csm-up-upstream-${process.pid}`;
    const brokerName = `csm-up-broker-${process.pid}`;
    let provisioned = null;
    for (const name of [workerName, upstreamName, brokerName])
      spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    try {
      provisioned = await enforcer.provision({
        brokerName,
        // The broker proxies the internal-facing port to the upstream that
        // lives on the (worker-invisible) egress network.
        brokerScript: `const http=require("http");http.createServer((q,s)=>{const p=http.request({host:"${upstreamName}",port:8080,path:q.url,method:q.method},(u)=>{s.writeHead(u.statusCode||200);u.pipe(s);});p.on("error",()=>{s.writeHead(502);s.end("bad-gateway");});q.pipe(p);}).listen(8080,"0.0.0.0")`,
      });
      // Upstream joins only the egress network — the worker can never see it.
      const upstream = spawnSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          upstreamName,
          "--network",
          provisioned.egressNetwork,
          "node:22-bookworm-slim",
          "node",
          "-e",
          'require("http").createServer((q,s)=>s.end("upstream-ok")).listen(8080,"0.0.0.0")',
        ],
        { encoding: "utf8" },
      );
      assert.equal(upstream.status, 0, upstream.stderr);

      const worker = spawnSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          workerName,
          "--network",
          provisioned.internalNetwork,
          "node:22-bookworm-slim",
          "sleep",
          "infinity",
        ],
        { encoding: "utf8" },
      );
      assert.equal(worker.status, 0, worker.stderr);

      const viaBroker = await enforcer.probe({
        workerId: workerName,
        script: `require("http").get("http://${brokerName}:8080/app", (r) => { let d=""; r.on("data",(c)=>d+=c); r.on("end",()=>process.stdout.write(d)); }).on("error",(e)=>process.stdout.write("ERR:"+e.code));`,
      });
      assert.match(viaBroker.stdout, /upstream-ok/, "broker must proxy the allowlisted upstream");

      const directUpstream = await enforcer.probe({
        workerId: workerName,
        script: `require("net").connect(8080, "${upstreamName}").on("connect",()=>process.stdout.write("CONNECTED")).on("error",(e)=>process.stdout.write("ERR:"+e.code));`,
      });
      assert.match(
        directUpstream.stdout,
        /^ERR:/,
        "the worker must not reach the upstream directly (not on the egress network)",
      );
    } finally {
      for (const name of [workerName, upstreamName, brokerName])
        spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
      if (provisioned)
        await enforcer.teardown({
          network: provisioned.internalNetwork,
          egressNetwork: provisioned.egressNetwork,
          brokerName: provisioned.brokerName,
        });
    }
  },
);

test("T004: provision dual-homes the broker and keeps the worker internal-only", async () => {
  const calls = [];
  const run = async (_docker, args) => {
    calls.push(args.join(" "));
    if (args[0] === "run") return { code: 0, stdout: "brokerid\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const enforcer = createEgressNetworkEnforcer({ run });
  const provisioned = await enforcer.provision({
    brokerName: "b1",
    brokerScript: "x",
    internalNetwork: "csm-internal-1",
    egressNetwork: "csm-egress-1",
  });
  assert.equal(provisioned.network, "csm-internal-1");
  assert.equal(provisioned.internalNetwork, "csm-internal-1");
  assert.equal(provisioned.egressNetwork, "csm-egress-1");
  assert.ok(
    calls.some((c) => c === "network create --internal csm-internal-1"),
    "internal network must be isolated",
  );
  assert.ok(
    calls.some((c) => c === "network create csm-egress-1"),
    "egress network is routed",
  );
  assert.ok(
    calls.some((c) => c === "network connect csm-egress-1 b1"),
    "only the broker is dual-homed onto the egress network",
  );
  // The worker is never attached to the egress (routed) network.
  assert.ok(!calls.some((c) => c.startsWith("network connect csm-egress-1 ") && !c.endsWith("b1")));
});

test("T004: parseDropCount reads the CSM_EGRESS_DROP packet counter", () => {
  const listing =
    "Chain OUTPUT (policy ACCEPT)\n" +
    "pkts bytes target prot opt in out     source    destination\n" +
    "42   3360 ACCEPT all  --  *  *      0.0.0.0/0 0.0.0.0/0 /* CSM_EGRESS_DROP_COUNT */\n" +
    "3    240  LOG    all  --  *  *      0.0.0.0/0 0.0.0.0/0 /* CSM_EGRESS_DROP_LOG */\n";
  assert.equal(parseDropCount(listing), 42);
  assert.equal(parseDropCount(""), 0);
  assert.equal(parseDropCount("no rules here"), 0);
});

test("T009: attachWorker failure cleans up the egress network and broker", async () => {
  const calls = [];
  const run = async (_docker, args) => {
    calls.push(args.join(" "));
    // Fail only the worker attach; the broker dual-homing connect must succeed.
    if (args[0] === "network" && args[1] === "connect" && args[3] === "w1")
      return { code: 1, stdout: "", stderr: "attach failed" };
    if (args[0] === "run") return { code: 0, stdout: "brokerid", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const enforcer = createEgressNetworkEnforcer({ run });
  const provisioned = await enforcer.provision({ brokerName: "b1", brokerScript: "x" });
  await assert.rejects(
    enforcer.attachWorker({ network: provisioned.network, workerId: "w1" }),
    /attach failed/,
  );
  assert.ok(
    calls.some((c) => c.startsWith("rm -f")),
    "broker must be removed",
  );
  assert.ok(
    calls.some((c) => c.startsWith("network rm")),
    "network must be removed",
  );
});
