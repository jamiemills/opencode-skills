"use strict";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T004: egress network enforcement primitives. A sandbox worker is attached only
// to an internal Docker network (`--internal`, no default route); the only peer
// on that network is the broker. The broker is DUAL-HOMED: attached to the
// internal network (worker-facing) and to a second egress network that has a
// default route, so only the broker can reach upstream. This module owns the
// network plumbing, isolation probing, and network-layer drop sourcing; it owns
// no acceptance authority.
//
// T002: a real drop source. An `--internal` network has no default route, so a
// connect() fails with ENETUNREACH before netfilter runs and a DROP rule never
// sees a packet. The worker netns therefore gets a blackhole `csm0` dummy
// device + default route, and scoped OUTPUT-only rules on `-o csm0` NFLOG (group
// 7) then DROP. The NFLOG reader (ulogd, JSON) runs in the same netns from a
// baked helper image and yields genuine per-drop facts
// (`{dest_ip, dest_port, protocol}`). Broker/DNS traffic on `eth0` is untouched.

const DROP_RULE_COMMENT = "CSM_EGRESS_DROP_COUNT";
const DROP_NFLOG_GROUP = 7;
const DROP_NFLOG_PREFIX = "CSMDROP-";
const DROP_LOG_PATH = "/run/csm-drops.json";
// Pin the base image by digest so the baked helper is reproducible. The tag is
// reused when present so the in-test build is paid at most once per host.
const DROP_PROBE_IMAGE_TAG = "csm-egress-drop-probe:alpine3.20";
const DROP_PROBE_BASE_IMAGE =
  "alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";

const ULOGD_CONFIG = `[global]
logfile="/dev/null"

plugin="/usr/lib/ulogd/ulogd_inppkt_NFLOG.so"
plugin="/usr/lib/ulogd/ulogd_raw2packet_BASE.so"
plugin="/usr/lib/ulogd/ulogd_filter_IP2STR.so"
plugin="/usr/lib/ulogd/ulogd_output_JSON.so"

stack=log${DROP_NFLOG_GROUP}:NFLOG,base1:BASE,ip2str1:IP2STR,json1:JSON

[log${DROP_NFLOG_GROUP}]
group=${DROP_NFLOG_GROUP}

[json1]
sync=1
file="${DROP_LOG_PATH}"
timestamp=1
`;

const DROP_PROBE_DOCKERFILE = `FROM ${DROP_PROBE_BASE_IMAGE}
RUN apk add --no-cache iptables iproute2 ulogd ulogd-json
COPY csm-ulogd.conf /etc/csm-ulogd.conf
`;

function run(docker, args, { timeoutMs = 60_000, stdin = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(docker, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    if (timer.unref) timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

// Parse the packet counter for the `CSM_EGRESS_DROP` logging rule from
// `iptables -vnxL OUTPUT` output (column 1 is the packet count). Returns 0 when
// the rule is absent, so a missing collector degrades to "no drops observed"
// rather than throwing.
export function parseDropCount(iptablesOutput) {
  for (const line of String(iptablesOutput ?? "").split("\n")) {
    if (!line.includes("CSM_EGRESS_DROP_COUNT")) continue;
    const columns = line.trim().split(/\s+/);
    const packets = Number(columns[0]);
    if (Number.isFinite(packets)) return packets;
  }
  return 0;
}

// Parse ulogd's JSON output (one NFLOG record per line) into per-drop facts.
// Only records carrying the CSM drop prefix and a destination IP are kept, so a
// shared collector cannot inject unrelated NFLOG traffic into the audit.
export function parseDropRecords(jsonlOutput) {
  const drops = [];
  for (const line of String(jsonlOutput ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (row === null || typeof row !== "object") continue;
    const prefix = row["oob.prefix"];
    if (prefix !== undefined && !String(prefix).startsWith(DROP_NFLOG_PREFIX)) continue;
    const destIp = row.dest_ip;
    if (typeof destIp !== "string" || destIp.length === 0) continue;
    const destPort = Number.isInteger(row.dest_port) ? row.dest_port : null;
    const protocol = Number.isInteger(row["ip.protocol"]) ? row["ip.protocol"] : null;
    drops.push({
      dest_ip: destIp,
      dest_port: destPort,
      protocol,
      prefix: prefix ?? null,
      timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
    });
  }
  return drops;
}

export function createEgressNetworkEnforcer({ docker = "docker", run: runFn = run } = {}) {
  const provisionedByNetwork = new Map();
  const dropReaders = new Map();
  function tracking(network) {
    for (const [internal, entry] of provisionedByNetwork)
      if (internal === network || entry.egressNetwork === network) return entry;
    return null;
  }
  async function provision({
    brokerName = `csm-broker-${randomUUID()}`,
    brokerImage = "node:22-bookworm-slim",
    brokerScript,
    internalNetwork = `csm-internal-${randomUUID()}`,
    egressNetwork = `csm-egress-${randomUUID()}`,
  } = {}) {
    if (typeof brokerScript !== "string" || brokerScript.length < 1)
      throw new TypeError("egress broker script is required");
    const createdInternal = await runFn(docker, [
      "network",
      "create",
      "--internal",
      internalNetwork,
    ]);
    if (createdInternal.code !== 0)
      throw new Error(createdInternal.stderr || "internal network create failed");
    const createdEgress = await runFn(docker, ["network", "create", egressNetwork]);
    if (createdEgress.code !== 0) {
      await runFn(docker, ["network", "rm", internalNetwork]);
      throw new Error(createdEgress.stderr || "egress network create failed");
    }
    const broker = await runFn(docker, [
      "run",
      "-d",
      "--name",
      brokerName,
      "--network",
      internalNetwork,
      "--cap-add",
      "NET_ADMIN",
      brokerImage,
      "node",
      "-e",
      brokerScript,
    ]);
    if (broker.code !== 0) {
      await runFn(docker, ["network", "rm", internalNetwork]);
      await runFn(docker, ["network", "rm", egressNetwork]);
      throw new Error(broker.stderr || "egress broker start failed");
    }
    // Dual-home the broker: a second NIC on the egress network gives only the
    // broker an upstream route, so the worker stays internal-only.
    const homed = await runFn(docker, ["network", "connect", egressNetwork, brokerName]);
    if (homed.code !== 0) {
      await runFn(docker, ["rm", "-f", brokerName]);
      await runFn(docker, ["network", "rm", internalNetwork]);
      await runFn(docker, ["network", "rm", egressNetwork]);
      throw new Error(homed.stderr || "broker upstream attach failed");
    }
    const entry = { brokerName, internalNetwork, egressNetwork };
    provisionedByNetwork.set(internalNetwork, entry);
    return {
      network: internalNetwork,
      internalNetwork,
      egressNetwork,
      brokerId: broker.stdout.trim(),
      brokerName,
    };
  }

  async function attachWorker({ network, workerId }) {
    const attached = await runFn(docker, ["network", "connect", network, workerId]);
    if (attached.code !== 0) {
      // Fail-closed cleanup: a failed attach must not leak the network/broker.
      const tracked = tracking(network);
      await teardown({
        network: tracked?.internalNetwork ?? network,
        egressNetwork: tracked?.egressNetwork ?? null,
        brokerName: tracked?.brokerName ?? null,
      });
      throw new Error(attached.stderr || "worker attach failed");
    }
    return { network, workerId };
  }

  async function probe({ workerId, script, timeoutMs = 15_000 }) {
    const result = await runFn(docker, ["exec", workerId, "node", "-e", script], { timeoutMs });
    return { code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }

  // Build (or reuse) the baked drop-probe image. Joining a worker netns has no
  // network, so iptables/ulogd must already be present in the image; the base is
  // pinned by digest for reproducibility.
  async function ensureDropProbeImage({
    imageTag = DROP_PROBE_IMAGE_TAG,
    baseImage = DROP_PROBE_BASE_IMAGE,
    timeoutMs = 180_000,
  } = {}) {
    const present = await runFn(docker, ["image", "inspect", imageTag], { timeoutMs: 30_000 });
    if (present.code === 0) return { image: imageTag, built: false };
    const context = mkdtempSync(join(tmpdir(), "csm-drop-probe-"));
    try {
      writeFileSync(
        join(context, "Dockerfile"),
        DROP_PROBE_DOCKERFILE.replace(DROP_PROBE_BASE_IMAGE, baseImage),
      );
      writeFileSync(join(context, "csm-ulogd.conf"), ULOGD_CONFIG);
      const built = await runFn(docker, ["build", "-t", imageTag, context], { timeoutMs });
      if (built.code !== 0)
        throw new Error(
          `drop-probe image build failed: ${(built.stderr || built.stdout).trim() || "unknown error"}`,
        );
      return { image: imageTag, built: true };
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  }

  async function readerRunning(readerName) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const inspected = await runFn(docker, ["inspect", "-f", "{{.State.Running}}", readerName]);
      if (inspected.code === 0 && inspected.stdout.trim() === "true") return true;
      if (inspected.code !== 0) return false;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }

  // Network-layer drop sourcing. A baked helper joins the worker's netns and
  // installs a blackhole route plus OUTPUT-only rules scoped to `-o csm0`, so
  // broker/DNS traffic on `eth0` is never seen by this rule. The NFLOG rule
  // (group 7) runs BEFORE the DROP rule, so every dropped packet is observed.
  // Requires NET_ADMIN on the helper only (never --privileged).
  async function provisionDropLogging({
    workerId,
    imageTag = DROP_PROBE_IMAGE_TAG,
    baseImage = DROP_PROBE_BASE_IMAGE,
    timeoutMs = 60_000,
  } = {}) {
    if (typeof workerId !== "string" || workerId.length < 1)
      throw new TypeError("drop logging requires a workerId");
    const { image } = await ensureDropProbeImage({ imageTag, baseImage });
    const readerName = `csm-drop-reader-${randomUUID()}`;
    const setup = [
      "set -e",
      "ip link add csm0 type dummy 2>/dev/null || true",
      "ip link set csm0 up",
      "ip route replace default dev csm0",
      `iptables -C OUTPUT -o csm0 -m comment --comment ${DROP_RULE_COMMENT} -j NFLOG --nflog-group ${DROP_NFLOG_GROUP} --nflog-prefix ${DROP_NFLOG_PREFIX} 2>/dev/null || iptables -A OUTPUT -o csm0 -m comment --comment ${DROP_RULE_COMMENT} -j NFLOG --nflog-group ${DROP_NFLOG_GROUP} --nflog-prefix ${DROP_NFLOG_PREFIX}`,
      `iptables -C OUTPUT -o csm0 -m comment --comment ${DROP_RULE_COMMENT} -j DROP 2>/dev/null || iptables -A OUTPUT -o csm0 -m comment --comment ${DROP_RULE_COMMENT} -j DROP`,
      "exec ulogd -c /etc/csm-ulogd.conf -v",
    ].join("; ");
    const started = await runFn(
      docker,
      [
        "run",
        "-d",
        "--name",
        readerName,
        "--net",
        `container:${workerId}`,
        "--cap-add",
        "NET_ADMIN",
        "--security-opt",
        "no-new-privileges",
        image,
        "sh",
        "-c",
        setup,
      ],
      { timeoutMs },
    );
    if (started.code !== 0)
      throw new Error(started.stderr.trim() || "drop-logging reader start failed");
    dropReaders.set(workerId, { readerName, image });
    if (!(await readerRunning(readerName))) {
      const logs = await runFn(docker, ["logs", readerName], { timeoutMs: 15_000 });
      dropReaders.delete(workerId);
      await runFn(docker, ["rm", "-f", readerName], { timeoutMs: 15_000 });
      throw new Error(
        `drop-probe reader exited: ${(logs.stderr || logs.stdout).trim() || "unknown error"}`,
      );
    }
    return { workerId, readerName, capture: { degraded: false } };
  }

  async function collectDrops({ workerId } = {}) {
    const reader = dropReaders.get(workerId);
    if (!reader)
      return {
        workerId,
        count: 0,
        drops: [],
        degraded: true,
        reason: "drop-capture-not-provisioned",
      };
    const running = await runFn(docker, ["inspect", "-f", "{{.State.Running}}", reader.readerName]);
    if (running.code !== 0 || running.stdout.trim() !== "true")
      return {
        workerId,
        count: 0,
        drops: [],
        degraded: true,
        reason: "drop-probe-reader-not-running",
      };
    const read = await runFn(
      docker,
      ["exec", reader.readerName, "sh", "-c", `cat ${DROP_LOG_PATH}; : > ${DROP_LOG_PATH}`],
      { timeoutMs: 30_000 },
    );
    if (read.code !== 0)
      return {
        workerId,
        count: 0,
        drops: [],
        degraded: true,
        reason: read.stderr.trim() || "drop-log-unreadable",
      };
    const drops = parseDropRecords(read.stdout);
    return { workerId, count: drops.length, drops, degraded: false, reason: null };
  }

  async function removeDropLogging({ workerId } = {}) {
    const reader = dropReaders.get(workerId);
    if (!reader) return { workerId, removed: false };
    dropReaders.delete(workerId);
    await runFn(docker, ["rm", "-f", reader.readerName], { timeoutMs: 30_000 });
    return { workerId, removed: true };
  }

  async function teardown({
    network = null,
    egressNetwork = null,
    brokerId = null,
    brokerName = null,
  } = {}) {
    // Safety net: a drop reader shares the worker netns and keeps it alive after
    // the worker is removed, so it must be reaped even if the caller forgot
    // removeDropLogging. This never touches broker/DNS state.
    for (const reader of dropReaders.values())
      await runFn(docker, ["rm", "-f", reader.readerName], { timeoutMs: 30_000 });
    dropReaders.clear();
    if (brokerId || brokerName)
      await runFn(docker, ["rm", "-f", brokerId || brokerName], { timeoutMs: 30_000 });
    if (network) {
      await runFn(docker, ["network", "rm", network], { timeoutMs: 30_000 });
      provisionedByNetwork.delete(network);
    }
    if (egressNetwork) await runFn(docker, ["network", "rm", egressNetwork], { timeoutMs: 30_000 });
  }

  return Object.freeze({
    provision,
    attachWorker,
    probe,
    ensureDropProbeImage,
    provisionDropLogging,
    collectDrops,
    removeDropLogging,
    teardown,
  });
}

export { DROP_PROBE_IMAGE_TAG, DROP_PROBE_BASE_IMAGE, DROP_LOG_PATH, run as runDockerCommand };
