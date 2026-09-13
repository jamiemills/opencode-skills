"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createEgressBroker,
  createEgressBrokerListener,
  createEgressLedger,
} from "../csm-orchestrate/lib/egress-broker.mjs";
import {
  completeRecordBytes,
  createEgressNetworkEnforcer,
  DROP_DEDUPE_WINDOW_MS,
  DROP_PROBE_IMAGE_TAG,
  dedupeDrops,
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

test("T005: the host-side listener routes allowlist-allow vs default-deny, not a blind proxy", async () => {
  const policy = {
    defaultAction: "deny",
    failMode: "blocked",
    entries: [
      { host: "api.example.test", port: 443, scheme: "https", methods: ["GET"], maxBytes: 1024 },
    ],
    credentialInjections: [],
  };
  const ledger = createEgressLedger({
    runId: "run-egress-network",
    key: "test-key-0123456789",
  });
  const forwarded = [];
  const decisions = [];
  const broker = createEgressBroker({
    policy,
    ledger,
    policyDigest: `sha256:${"a".repeat(64)}`,
    emitter: { emit: (event) => decisions.push(event) },
  });
  // The T001 listener owns the policy decision and only forwards on allow; the
  // injected transport records what actually crossed the listener boundary.
  const listener = createEgressBrokerListener({
    broker,
    forward: async ({ target, method, headers, body }) => {
      forwarded.push({ target, method, headers, body });
      return { status: 200, body: "upstream-ok" };
    },
  });

  const allowed = await listener.handle(
    {
      target: { host: "api.example.test", port: 443, scheme: "https", method: "GET", path: "/v1" },
      headers: {},
    },
    { taskId: "T005" },
  );
  assert.equal(allowed.decision, "allowed");
  assert.equal(allowed.reasonCode, "allowlist-match");
  assert.equal(allowed.upstream.body, "upstream-ok");
  assert.equal(forwarded.length, 1, "an allowlisted target must be forwarded exactly once");
  assert.equal(allowed.record.decision, "allowed");
  assert.equal(allowed.record.reasonCode, "allowlist-match");
  assert.equal(allowed.record.taskId, "T005");

  const denied = await listener.handle(
    {
      target: { host: "evil.example.test", port: 443, scheme: "https", method: "GET" },
      headers: {},
    },
    { taskId: "T005" },
  );
  assert.equal(denied.decision, "denied");
  assert.equal(denied.reasonCode, "default-deny");
  assert.equal(denied.upstream, null, "a denied target must never be forwarded");
  assert.equal(forwarded.length, 1, "the policy decision, not a blind proxy, gates forwarding");
  assert.equal(denied.record.decision, "denied");
  assert.equal(denied.record.reasonCode, "default-deny");

  const overLimit = await listener.handle(
    {
      target: {
        host: "api.example.test",
        port: 443,
        scheme: "https",
        method: "GET",
        path: "/v1",
        bytesOut: 2048,
      },
      headers: {},
    },
    {},
  );
  assert.equal(overLimit.decision, "denied");
  assert.equal(overLimit.reasonCode, "max-bytes-exceeded");
  assert.equal(forwarded.length, 1, "an over-limit request must not be forwarded");

  assert.equal(broker.verify().valid, true);
  assert.deepEqual(
    ledger.records().map((record) => record.decision),
    ["allowed", "denied", "denied"],
  );
  assert.equal(decisions.length, 3);
  assert.equal(decisions[0].eventType, "egress.decision");
  assert.equal(decisions[0].payload.decision, "allowed");
  assert.equal(decisions[1].payload.reasonCode, "default-deny");
});

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
      src_ip: "172.22.0.2",
      src_port: 52868,
      prefix: "CSMDROP-",
      timestamp: "2026-09-13T14:05:24.572014",
    },
    {
      dest_ip: "8.8.8.8",
      dest_port: 53,
      protocol: 17,
      src_ip: null,
      src_port: null,
      prefix: "CSMDROP-",
      timestamp: null,
    },
  ]);
  assert.deepEqual(parseDropRecords(""), []);
});

test("T007: completeRecordBytes counts only newline-terminated bytes", () => {
  assert.equal(completeRecordBytes("a\nb\n"), 4);
  assert.equal(completeRecordBytes("a\nb"), 2);
  assert.equal(completeRecordBytes("partial"), 0);
  assert.equal(completeRecordBytes(""), 0);
  assert.equal(completeRecordBytes("héllo\n"), 7);
});

test("T007: dedupeDrops collapses NFLOG 5-tuple redeliveries within a window", () => {
  const base = {
    dest_ip: "203.0.113.7",
    dest_port: 443,
    protocol: 6,
    src_ip: "172.22.0.2",
    src_port: 52868,
  };
  const at = (timestamp) => ({ ...base, timestamp });
  assert.equal(
    dedupeDrops([at("2026-09-13T14:05:24.572014"), at("2026-09-13T14:05:24.612014")]).length,
    1,
    "redelivery within the window is collapsed",
  );
  assert.equal(
    dedupeDrops([at("2026-09-13T14:05:24.572014"), at("2026-09-13T14:05:26.572014")]).length,
    2,
    "distinct drops outside the window are kept",
  );
  assert.equal(
    dedupeDrops([at("2026-09-13T14:05:24.572014"), at("2026-09-13T14:05:25.572014")]).length,
    2,
    "an exclusive window keeps a TCP retransmit exactly one window later (N6)",
  );
  assert.equal(
    dedupeDrops([
      at("2026-09-13T14:05:24.572014"),
      { ...at("2026-09-13T14:05:24.582014"), dest_port: 8443 },
    ]).length,
    2,
    "a different 5-tuple is a distinct drop",
  );
  assert.equal(
    dedupeDrops([
      { ...base, timestamp: null },
      { ...base, timestamp: null },
    ]).length,
    2,
    "ambiguous drops are never undercounted",
  );
  const shared = new Map();
  dedupeDrops([at("2026-09-13T14:05:24.572014")], { seen: shared });
  assert.equal(
    dedupeDrops([at("2026-09-13T14:05:24.612014")], { seen: shared }).length,
    0,
    "a shared seen map dedupes across collect batches",
  );
  assert.equal(DROP_DEDUPE_WINDOW_MS, 1_000);
});

test("T007: collectDrops advances a byte offset and never loses a split record", async () => {
  const log = { bytes: "" };
  let readerName = null;
  const run = async (_docker, args) => {
    if (args[0] === "image") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "run") {
      readerName = args[args.indexOf("--name") + 1];
      return { code: 0, stdout: "readerid\n", stderr: "" };
    }
    if (args[0] === "inspect") return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "exec") {
      const command = args[args.length - 1];
      const match = /tail -c \+(\d+)/.exec(command);
      assert.ok(match, `unexpected collect command: ${command}`);
      return { code: 0, stdout: log.bytes.slice(Number(match[1]) - 1), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const enforcer = createEgressNetworkEnforcer({ run });
  await enforcer.provisionDropLogging({ workerId: "w1" });
  assert.ok(readerName, "reader container must be started");

  const first = JSON.stringify({
    timestamp: "2026-09-13T14:05:24.500000",
    dest_ip: "203.0.113.7",
    dest_port: 443,
    src_ip: "172.22.0.2",
    src_port: 40000,
    "ip.protocol": 6,
  });
  const second = JSON.stringify({
    timestamp: "2026-09-13T14:05:25.500000",
    dest_ip: "198.51.100.9",
    dest_port: 8443,
    src_ip: "172.22.0.2",
    src_port: 41000,
    "ip.protocol": 6,
  });
  // A complete record plus the first half of a second record (split write).
  log.bytes = `${first}\n${second.slice(0, 20)}`;
  const partial = await enforcer.collectDrops({ workerId: "w1" });
  assert.equal(partial.degraded, false);
  assert.equal(partial.count, 1, "only complete records are consumed");
  assert.equal(partial.drops[0].dest_ip, "203.0.113.7");

  // The rest of the split record arrives; it must be re-read whole, not lost.
  log.bytes += `${second.slice(20)}\n`;
  const completed = await enforcer.collectDrops({ workerId: "w1" });
  assert.equal(completed.count, 1);
  assert.equal(completed.drops[0].dest_ip, "198.51.100.9");

  // Two copies of the same new packet in one batch collapse to one audit record.
  const retransmit = JSON.stringify({
    timestamp: "2026-09-13T14:05:26.500000",
    dest_ip: "203.0.113.7",
    dest_port: 443,
    src_ip: "172.22.0.2",
    src_port: 40000,
    "ip.protocol": 6,
  });
  log.bytes += `${retransmit}\n${retransmit}\n`;
  const deduped = await enforcer.collectDrops({ workerId: "w1" });
  assert.equal(deduped.count, 1, "NFLOG redelivery is deduped");
});

test("T002: the broker gets no added capabilities while the drop helper keeps NET_ADMIN", async () => {
  const calls = [];
  const run = async (_docker, args) => {
    calls.push(args);
    if (args[0] === "run") return { code: 0, stdout: "id\n", stderr: "" };
    if (args[0] === "inspect") return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "image") return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const enforcer = createEgressNetworkEnforcer({ run });
  await enforcer.provision({
    brokerName: "b1",
    brokerScript: "x",
    internalNetwork: "n1",
    egressNetwork: "e1",
  });
  const brokerRun = calls.find((args) => args[0] === "run");
  assert.ok(brokerRun, "broker must start");
  assert.ok(!brokerRun.includes("--cap-add"), "broker must not add capabilities");
  assert.ok(!brokerRun.includes("NET_ADMIN"), "broker must not carry NET_ADMIN");

  await enforcer.provisionDropLogging({ workerId: "w1" });
  const helperRun = calls.find((args) => args[0] === "run" && args.includes("container:w1"));
  assert.ok(helperRun, "drop helper must start");
  assert.ok(helperRun.includes("--cap-add"), "drop helper needs a capability");
  assert.ok(helperRun.includes("NET_ADMIN"), "drop helper keeps NET_ADMIN");
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
      // T002: the broker runs least-privilege (no NET_ADMIN) and still serves.
      const brokerCaps = spawnSync(
        "docker",
        ["inspect", "-f", "{{json .HostConfig.CapAdd}}", brokerName],
        { encoding: "utf8" },
      );
      assert.ok(
        !String(brokerCaps.stdout).includes("NET_ADMIN"),
        `broker must not carry NET_ADMIN: ${brokerCaps.stdout}`,
      );
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
      // T002: the drop-probe helper is the only container that needs NET_ADMIN.
      const helperCaps = spawnSync(
        "docker",
        ["inspect", "-f", "{{json .HostConfig.CapAdd}}", provisionedCapture.readerName],
        { encoding: "utf8" },
      );
      assert.ok(
        String(helperCaps.stdout).includes("NET_ADMIN"),
        `drop helper must carry NET_ADMIN: ${helperCaps.stdout}`,
      );

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
