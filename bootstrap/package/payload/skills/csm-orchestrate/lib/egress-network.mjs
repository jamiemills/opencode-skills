"use strict";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// T004: egress network enforcement primitives. A sandbox worker is attached only
// to an internal Docker network (`--internal`, no default route); the only peer
// on that network is the broker. The broker is DUAL-HOMED: attached to the
// internal network (worker-facing) and to a second egress network that has a
// default route, so only the broker can reach upstream. This module owns the
// network plumbing, isolation probing, and network-layer drop sourcing; it owns
// no acceptance authority.

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

export function createEgressNetworkEnforcer({ docker = "docker", run: runFn = run } = {}) {
  const provisionedByNetwork = new Map();
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

  // Network-layer drop sourcing. A short-lived privileged helper joins the
  // worker's network namespace and installs an OUTPUT LOG rule (never in the
  // worker image itself); the packet counter on that rule is the number of
  // egress attempts the internal network refused. `recordDrop` consumes the
  // delta. Requires NET_ADMIN on the helper only.
  async function provisionDropLogging({ workerId, helperImage = "node:22-bookworm-slim" }) {
    // One unbounded rule whose packet counter is the true drop count. Rate
    // limiting is applied on a SEPARATE LOG rule so it cannot undercount.
    const script =
      "command -v iptables >/dev/null 2>&1 || { echo iptables-unavailable >&2; exit 127; }; " +
      "iptables -C OUTPUT -m comment --comment CSM_EGRESS_DROP_COUNT -j ACCEPT 2>/dev/null || " +
      "iptables -A OUTPUT -m comment --comment CSM_EGRESS_DROP_COUNT -j ACCEPT; " +
      "iptables -C OUTPUT -m limit -m comment --comment CSM_EGRESS_DROP_LOG -j LOG 2>/dev/null || " +
      "iptables -A OUTPUT -m limit -m comment --comment CSM_EGRESS_DROP_LOG -j LOG";
    const result = await runFn(
      docker,
      [
        "run",
        "--rm",
        "--net",
        `container:${workerId}`,
        "--cap-add",
        "NET_ADMIN",
        helperImage,
        "sh",
        "-c",
        script,
      ],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0) throw new Error(result.stderr || "drop logging install failed");
    return { workerId };
  }

  async function collectDrops({ workerId, helperImage = "node:22-bookworm-slim" }) {
    const result = await runFn(
      docker,
      [
        "run",
        "--rm",
        "--net",
        `container:${workerId}`,
        "--cap-add",
        "NET_ADMIN",
        helperImage,
        "sh",
        "-c",
        "iptables -vnxL OUTPUT",
      ],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0)
      return { workerId, count: 0, error: result.stderr.trim() || "drop count unavailable" };
    return { workerId, count: parseDropCount(result.stdout) };
  }

  async function teardown({
    network = null,
    egressNetwork = null,
    brokerId = null,
    brokerName = null,
  } = {}) {
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
    provisionDropLogging,
    collectDrops,
    teardown,
  });
}

export { run as runDockerCommand };
