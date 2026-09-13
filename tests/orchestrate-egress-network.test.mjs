"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createEgressNetworkEnforcer,
  DROP_PROBE_IMAGE_TAG,
  parseDropCount,
  parseDropRecords,
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

test("T004/T002: parseDropCount reads the CSM_EGRESS_DROP counter on the DROP rule", () => {
  const listing =
    "Chain OUTPUT (policy ACCEPT)\n" +
    "pkts bytes target prot opt in out     source    destination\n" +
    "42   3360 NFLOG  all  --  *  csm0   0.0.0.0/0 0.0.0.0/0 /* CSM_EGRESS_DROP_COUNT */ nflog-prefix CSMDROP- nflog-group 7\n" +
    "3    240  DROP   all  --  *  csm0   0.0.0.0/0 0.0.0.0/0 /* CSM_EGRESS_DROP_COUNT */\n";
  assert.equal(parseDropCount(listing), 42);
  assert.equal(parseDropCount(""), 0);
  assert.equal(parseDropCount("no rules here"), 0);
});

test("T002: parseDropRecords extracts per-drop destination facts from ulogd JSON", () => {
  const jsonl =
    JSON.stringify({
      timestamp: "2026-09-13T14:05:24.572014",
      "oob.prefix": "CSMDROP-",
      "ip.protocol": 6,
      src_port: 52868,
      dest_port: 443,
      src_ip: "172.22.0.2",
      dest_ip: "203.0.113.7",
    }) +
    "\n" +
    JSON.stringify({ "oob.prefix": "OTHER-", dest_port: 53, dest_ip: "10.0.0.1" }) +
    "\n" +
    "not json\n" +
    JSON.stringify({
      "oob.prefix": "CSMDROP-",
      "ip.protocol": 17,
      dest_port: 53,
      dest_ip: "8.8.8.8",
    }) +
    "\n";
  assert.deepEqual(parseDropRecords(jsonl), [
    {
      dest_ip: "203.0.113.7",
      dest_port: 443,
      protocol: 6,
      prefix: "CSMDROP-",
      timestamp: "2026-09-13T14:05:24.572014",
    },
    { dest_ip: "8.8.8.8", dest_port: 53, protocol: 17, prefix: "CSMDROP-", timestamp: null },
  ]);
  assert.deepEqual(parseDropRecords(""), []);
});

test("T002: drop capture is observably degraded until it is provisioned", async () => {
  const enforcer = createEgressNetworkEnforcer({
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  const result = await enforcer.collectDrops({ workerId: "unprovisioned" });
  assert.equal(result.degraded, true);
  assert.deepEqual(result.drops, []);
  assert.equal(result.reason, "drop-capture-not-provisioned");
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

test(
  "T002: blackhole+NFLOG yields per-drop facts and never sees broker/DNS traffic",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const enforcer = createEgressNetworkEnforcer();
    const workerName = `csm-drop-worker-${process.pid}`;
    const brokerName = `csm-drop-broker-${process.pid}`;
    let provisioned = null;
    let workerStarted = false;
    spawnSync("docker", ["rm", "-f", workerName, brokerName], { stdio: "ignore" });
    try {
      provisioned = await enforcer.provision({
        brokerName,
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
      workerStarted = true;

      const provisionedCapture = await enforcer.provisionDropLogging({ workerId: workerName });
      assert.equal(provisionedCapture.capture.degraded, false);

      // A TEST-NET attempt is DROPped, so connect() hangs until our own bound
      // fires; the drop itself is what we assert below.
      const attempt = await enforcer.probe({
        workerId: workerName,
        timeoutMs: 20_000,
        script:
          'const s=require("net").connect(443,"203.0.113.7");s.setTimeout(1500,()=>{s.destroy();process.stdout.write("TIMEOUT")});s.on("connect",()=>{process.stdout.write("CONNECTED");s.destroy()});s.on("error",e=>process.stdout.write("ERR:"+e.code));',
      });
      assert.match(attempt.stdout, /^(ERR:|TIMEOUT)/);

      // ulogd flushes with sync=1 but NFLOG delivery is asynchronous; poll the
      // collector instead of racing a fixed sleep.
      let captured = null;
      let drop = null;
      for (let poll = 0; poll < 20 && !drop; poll += 1) {
        captured = await enforcer.collectDrops({ workerId: workerName });
        drop = captured.drops.find((row) => row.dest_ip === "203.0.113.7" && row.dest_port === 443);
        if (!drop) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal(captured.degraded, false, JSON.stringify(captured));
      assert.ok(drop, `expected a per-drop record, got ${JSON.stringify(captured.drops)}`);
      assert.equal(drop.protocol, 6);

      // The broker lives on eth0; the `-o csm0` rule must not touch it.
      const allowed = await enforcer.probe({
        workerId: workerName,
        script: `require("http").get("http://${brokerName}:8080",(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>process.stdout.write("BROKER:"+d));}).on("error",e=>process.stdout.write("ERR:"+e.code));`,
      });
      assert.match(allowed.stdout, /BROKER:ok/);

      // A closed broker port resets (ECONNREFUSED) instead of being dropped.
      const refused = await enforcer.probe({
        workerId: workerName,
        script: `require("net").connect(9,"${brokerName}").on("connect",()=>process.stdout.write("CONNECTED")).on("error",(e)=>process.stdout.write("ERR:"+e.code));`,
      });
      assert.match(refused.stdout, /ERR:ECONNREFUSED/);

      // The embedded DNS resolver at 127.0.0.11 is on the loopback path.
      const dns = await enforcer.probe({
        workerId: workerName,
        script: `require("dns").lookup("${brokerName}",(e,a)=>process.stdout.write(e?"DNSERR:"+e.code:"DNS:"+a));`,
      });
      assert.match(dns.stdout, /^DNS:\d+\.\d+\.\d+\.\d+/);

      // New records must be TEST-NET drops only: no broker subnet, no DNS.
      const after = await enforcer.collectDrops({ workerId: workerName });
      for (const row of after.drops) {
        assert.notEqual(row.dest_ip, "127.0.0.11", "DNS must not be dropped");
        assert.ok(
          !row.dest_ip.startsWith("172."),
          `broker-side traffic must not be captured: ${JSON.stringify(row)}`,
        );
      }
    } finally {
      if (workerStarted) spawnSync("docker", ["rm", "-f", workerName], { stdio: "ignore" });
      spawnSync("docker", ["rm", "-f", brokerName], { stdio: "ignore" });
      if (provisioned)
        await enforcer.teardown({
          network: provisioned.internalNetwork,
          egressNetwork: provisioned.egressNetwork,
          brokerName: provisioned.brokerName,
        });
      spawnSync("docker", ["rmi", "-f", DROP_PROBE_IMAGE_TAG], { stdio: "ignore" });
    }
  },
);
