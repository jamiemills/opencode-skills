"use strict";

import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { canonicalize, loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";

// T004/T005: build-shaped Docker worker provider. Reuses the isolation shape
// verified by the T001 spike (mounts [], read-only rootfs, network none,
// cap-drop ALL, no-new-privileges, --init reaper) with a build-sized resource
// envelope. The repo is staged by streaming a tar into the container's tmpfs
// (no host mount), and an NDJSON worker session runs over a `docker exec -i`.
// A finite message batch keeps stdin-close-after-one-batch behavior; supplying
// `onResponse` and/or `heartbeatMs` sustains the session across multiple
// round-trips until the caller aborts/closes or the timeout elapses. The
// provider owns no acceptance authority: it returns attestation and worker
// responses only.

const DEFAULT_IMAGE = "node:22.23.2-bookworm-slim";
const WORKER_ENTRY = "/workspace/worker.mjs";
const WORKSPACE = "/workspace";
export const WORKER_ENVELOPE = Object.freeze({
  memoryBytes: 2147483648,
  pidsLimit: 512,
  cpuQuota: 100000,
  cpuPeriod: 100000,
  workspaceSizeBytes: 1610612736,
  sessionTimeoutMs: 3_600_000,
});

// T005: the registered docker-worker policy revisions a provider accepts. The
// frozen /1 envelope and the additive /2 envelope (optional `dropCapture`) are
// both registered; any other schema identity is refused before a container is
// created.
export const WORKER_POLICY_SCHEMAS = Object.freeze([
  "csm-orchestrate-docker-worker-policy/1",
  "csm-orchestrate-docker-worker-policy/2",
]);

// T003 (g3-ruling): the host trust boundary of the attestation anchor key. The
// frozen /1 attestation `anchor.external` marks that the keyed head is external
// to the *worker* sandbox; it is not evidence that the key is held beyond the
// OS user. `os-user-bound` (the default) means the provider generates/holds the
// anchor key in-process; `external` means the caller manages it beyond the OS
// user (for example a KMS/HSM or remote signer). `trustBoundary()` is the
// authoritative signal and `reauthorizeAttestation()` fails closed by default
// against a non-external key.
export const WORKER_ANCHOR_TRUST_DOMAINS = Object.freeze({
  osUser: "os-user-bound",
  external: "external",
});

// T005: validate a supplied policy against the schema registry, fail closed.
// Returns null for an absent policy; throws for anything else that does not
// validate, so a provider can never start a worker under an unrecognized or
// malformed policy (including a policy that does not pin the image by digest).
export function validateWorkerPolicy(policy, { registry } = {}) {
  if (policy === null || policy === undefined) return null;
  if (typeof policy !== "object" || Array.isArray(policy))
    throw new TypeError("worker policy must be an object");
  if (!WORKER_POLICY_SCHEMAS.includes(policy.schema))
    throw new Error(`unsupported worker policy schema: ${String(policy.schema)}`);
  if (!registry || typeof registry.validate !== "function")
    throw new TypeError("worker policy validation requires a schema registry");
  let result;
  try {
    result = registry.validate(policy.schema, policy);
  } catch (error) {
    throw new Error(
      `worker policy ${policy.schema} could not be validated: ${String(error?.message ?? error)}`,
      { cause: error },
    );
  }
  if (!result.valid)
    throw new Error(`worker policy failed ${policy.schema}: ${JSON.stringify(result.errors)}`);
  return policy;
}

// T006: a killed/closed docker child can emit EPIPE (or ERR_STREAM_DESTROYED)
// on its stdio streams after teardown. Without an 'error' listener a Node
// stream re-emits that as an uncaughtException, which would crash the caller
// (observed as `write EPIPE` from the session heartbeat interval under load).
// These failures are expected once the child is gone and are already surfaced
// via exit code / close handling, so swallow them here.
function ignoreStreamErrors(child) {
  child.stdin?.on("error", () => {});
  child.stdout?.on("error", () => {});
  child.stderr?.on("error", () => {});
}

function runCommand(docker, args, { timeoutMs = 60_000, stdin = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(docker, args, { stdio: ["pipe", "pipe", "pipe"] });
    ignoreStreamErrors(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

// Docker reports bind mounts in top-level `.Mounts` and `HostConfig.Binds`
// (not `HostConfig.Mounts`), so all three sources must be read.
function parseInspect(text) {
  const value = JSON.parse(text);
  const [entry] = Array.isArray(value) ? value : [value];
  const host = entry.HostConfig ?? {};
  const repoDigests = Array.isArray(entry.RepoDigests) ? entry.RepoDigests : [];
  const topMounts = Array.isArray(entry.Mounts) ? entry.Mounts : [];
  const hostMounts = Array.isArray(host.Mounts) ? host.Mounts : [];
  const binds = Array.isArray(host.Binds) ? host.Binds : [];
  const mounts = [...topMounts, ...hostMounts, ...binds.map((bind) => ({ type: "bind", bind }))];
  return {
    id: entry.Id,
    image: entry.Image,
    repoDigests,
    mounts,
    rootFilesystem: host.ReadonlyRootfs ? "read-only" : "writable",
    network: host.NetworkMode,
    capDrop: Array.isArray(host.CapDrop) ? host.CapDrop : [],
    securityOpt: Array.isArray(host.SecurityOpt) ? host.SecurityOpt : [],
    env: Array.isArray(host.Env) ? host.Env : [],
    pidsLimit: host.PidsLimit,
    memory: host.Memory,
    init: host.Init === true,
  };
}

// Extract the `sha256:...` portion of a `name@sha256:...` RepoDigest reference.
function repoDigestValue(digestRef) {
  const at = String(digestRef).indexOf("@");
  return at >= 0 ? String(digestRef).slice(at + 1) : null;
}

// T005: the attestation object co-locates observational data (image id/digest,
// workspace digest, digest source) with the boolean sandbox controls. Only these
// keys are exempt from the failed-control predicate; every other `false` value is
// still a failed control (fail-closed by default), so recording a `false` data
// signal — e.g. `repoDigestsObserved: false` on the configured fallback — cannot
// be misread as a sandbox failure.
const WORKER_ATTESTATION_DATA_KEYS = Object.freeze([
  "imageDigest",
  "imageId",
  "matchedRepoDigest",
  "matchedRepoDigestSource",
  "repoDigestsObserved",
  "workspaceDigest",
]);

function failedWorkerControls(attestation, { pinRequired = true } = {}) {
  return Object.entries(attestation)
    .filter(([key, value]) => value === false && !WORKER_ATTESTATION_DATA_KEYS.includes(key))
    .filter(([key]) => !(key === "imagePinned" && !pinRequired))
    .map(([key]) => key);
}

export function attestDockerWorker(
  inspect,
  {
    expectedImageDigest = null,
    expectedMemory = null,
    expectedPids = null,
    workspaceDigest = null,
    expectedNetwork = null,
  } = {},
) {
  const repoDigests = (inspect.repoDigests ?? []).map((digestRef) => String(digestRef));
  // The container's `.Image` is a mutable image ID; pinning must be proven
  // against the registry RepoDigest(s). Require a full digest so a short suffix
  // cannot be spoofed by a longer digest that happens to end in it.
  const fullExpectedDigest =
    expectedImageDigest !== null && /^sha256:[a-f0-9]{64}$/.test(String(expectedImageDigest));
  const matchedRepoDigest =
    expectedImageDigest !== null
      ? (repoDigests.find((digestRef) => digestRef.endsWith(`@${expectedImageDigest}`)) ?? null)
      : null;
  // T005: some daemons report no RepoDigests at all for a container created from
  // a digest-pinned ref, which would spuriously fail (or fail to prove) the pin
  // invariant. The pin is still enforced because `docker create` was handed the
  // `name@sha256:<64hex>` reference, so when the daemon observed no RepoDigests
  // (never a partial/mismatched set) and a full digest was configured, fall back
  // to that configured digest and record the source. A present-but-mismatched
  // digest still fails closed (`imagePinned` remains false).
  const repoDigestsObserved = repoDigests.length > 0;
  const configuredDigestFallback = fullExpectedDigest && !repoDigestsObserved;
  const matchedRepoDigestSource = matchedRepoDigest
    ? "inspect"
    : configuredDigestFallback
      ? "configured"
      : "none";
  // T005: bind the signed attestation to the registry RepoDigest (the matched
  // one when pinning; the configured digest when the daemon observed none;
  // otherwise the image's first full RepoDigest), never the container image ID.
  const observedRepoDigest =
    repoDigests.find((digestRef) =>
      /^sha256:[a-f0-9]{64}$/.test(repoDigestValue(digestRef) ?? ""),
    ) ?? null;
  const imageDigest = matchedRepoDigest
    ? repoDigestValue(matchedRepoDigest)
    : configuredDigestFallback
      ? String(expectedImageDigest)
      : observedRepoDigest
        ? repoDigestValue(observedRepoDigest)
        : inspect.image;
  return {
    imageDigest,
    imageId: inspect.image,
    matchedRepoDigest,
    matchedRepoDigestSource,
    repoDigestsObserved,
    imagePinned: fullExpectedDigest && (matchedRepoDigest !== null || configuredDigestFallback),
    mountsEmpty: inspect.mounts.length === 0,
    rootFilesystemReadOnly: inspect.rootFilesystem === "read-only",
    // With egress the worker is on the broker-only internal network; isolation
    // means exactly that network (never a routed/default network).
    networkIsolated:
      expectedNetwork === null ? inspect.network === "none" : inspect.network === expectedNetwork,
    capDropAll: JSON.stringify(inspect.capDrop) === JSON.stringify(["ALL"]),
    noNewPrivileges: inspect.securityOpt.some((opt) => opt.startsWith("no-new-privileges")),
    credentialsNone: inspect.env.length === 0,
    reapingInit: inspect.init === true,
    resourceEnvelope:
      (expectedMemory === null || inspect.memory === expectedMemory) &&
      (expectedPids === null || inspect.pidsLimit === expectedPids),
    workspaceDigest,
  };
}

// T008: turn provider/monitor attestation into a schema-shaped
// csm-orchestrate-worker-attestation/1 document with a keyed anchor.
export function buildWorkerAttestation({
  workerId,
  runId,
  policyDigest,
  imageDigest,
  status = "verified",
  inspections,
  keyId = "host-key-1",
  anchorKey,
  now = () => new Date().toISOString(),
}) {
  if (!Array.isArray(inspections) || inspections.length === 0)
    throw new TypeError("worker attestation requires at least one inspection");
  if (anchorKey === undefined || anchorKey === null || anchorKey.length === 0)
    throw new TypeError("worker attestation requires a keyed anchor");
  const headDigest = `sha256:${createHmac("sha256", anchorKey)
    .update(canonicalize({ workerId, runId, policyDigest, imageDigest, status, inspections }))
    .digest("hex")}`;
  return {
    schema: "csm-orchestrate-worker-attestation/1",
    schemaRevision: 1,
    workerId,
    runId,
    policyDigest,
    imageDigest,
    status,
    inspections,
    anchor: {
      algorithm: "hmac-sha256",
      keyId,
      headDigest,
      signedAt: now(),
      external: true,
    },
  };
}

export function verifyWorkerAttestation({ doc, anchorKey } = {}) {
  if (!doc || typeof doc !== "object" || !doc.anchor)
    throw new TypeError("verifyWorkerAttestation requires a worker attestation document");
  if (anchorKey === undefined || anchorKey === null || anchorKey.length === 0)
    throw new TypeError("verifyWorkerAttestation requires the anchor key");
  const expected = `sha256:${createHmac("sha256", anchorKey)
    .update(
      canonicalize({
        workerId: doc.workerId,
        runId: doc.runId,
        policyDigest: doc.policyDigest,
        imageDigest: doc.imageDigest,
        status: doc.status,
        inspections: doc.inspections,
      }),
    )
    .digest("hex")}`;
  return expected === doc.anchor.headDigest;
}

export function inspectionFromAttestation(attestation, at = new Date().toISOString()) {
  return {
    at,
    controlResults: {
      mountsEmpty: attestation.mountsEmpty === true,
      rootFilesystemReadOnly: attestation.rootFilesystemReadOnly === true,
      capDropAll: attestation.capDropAll === true,
      noNewPrivileges: attestation.noNewPrivileges === true,
      networkIsolated: attestation.networkIsolated === true,
      credentialsNone: attestation.credentialsNone === true,
    },
  };
}

// T004: the explicit `policy.network` <-> egress contract. `none` forbids a
// mediated-egress configuration and `broker` requires one; any other declared
// value fails closed. A false declaration (or a mismatch) can no longer start a
// worker whose network posture and egress mediation disagree: it throws with a
// stable typed code so callers can branch on the failure deterministically.
export const WORKER_NETWORK_EGRESS_CODES = Object.freeze({
  noneForbidsEgress: "network-none-forbids-egress",
  brokerRequiresEgress: "network-broker-requires-egress",
  unsupported: "network-unsupported",
});

export function assertNetworkEgressContract(network, egress) {
  if (network === null || network === undefined) return network ?? null;
  if (network !== "none" && network !== "broker")
    throw Object.assign(new Error(`unsupported worker policy network: ${String(network)}`), {
      code: WORKER_NETWORK_EGRESS_CODES.unsupported,
    });
  if (network === "none" && egress)
    throw Object.assign(new Error("worker policy network=none forbids an egress configuration"), {
      code: WORKER_NETWORK_EGRESS_CODES.noneForbidsEgress,
    });
  if (network === "broker" && !egress)
    throw Object.assign(
      new Error("worker policy network=broker requires an egress configuration"),
      { code: WORKER_NETWORK_EGRESS_CODES.brokerRequiresEgress },
    );
  return network;
}

export function createDockerWorkerProvider({
  docker = "docker",
  image = DEFAULT_IMAGE,
  envelope = WORKER_ENVELOPE,
  run = runCommand,
  now = () => new Date().toISOString(),
  anchorKey = randomBytes(32),
  keyId = "host-key-1",
  anchorTrustDomain = WORKER_ANCHOR_TRUST_DOMAINS.osUser,
  egressEnforcer = null,
} = {}) {
  if (
    anchorTrustDomain !== WORKER_ANCHOR_TRUST_DOMAINS.osUser &&
    anchorTrustDomain !== WORKER_ANCHOR_TRUST_DOMAINS.external
  )
    throw new TypeError(
      `unsupported anchor trust domain: ${String(anchorTrustDomain)} (expected ${WORKER_ANCHOR_TRUST_DOMAINS.osUser} or ${WORKER_ANCHOR_TRUST_DOMAINS.external})`,
    );
  const hostExternal = anchorTrustDomain === WORKER_ANCHOR_TRUST_DOMAINS.external;
  const egressById = new Map();
  const policyById = new Map();
  async function start({
    name = `csm-worker-${randomUUID()}`,
    workspaceTar = null,
    workerSource,
    policy = null,
    egress = null,
  } = {}) {
    const registry = await loadSchemaRegistry();
    // T005: validate the supplied policy before any provisioning or container
    // creation, and refuse to silently start without the controls it declares.
    validateWorkerPolicy(policy, { registry });
    const limits = policy?.limits ?? envelope;
    const workspaceSize =
      policy?.workspace?.sizeBytes ?? limits.workspaceSizeBytes ?? envelope.workspaceSizeBytes;
    const imageRef = policy?.image ?? image;
    const expectedImageDigest =
      typeof imageRef === "string" && imageRef.includes("@")
        ? imageRef.slice(imageRef.indexOf("@") + 1)
        : null;
    // T005: a policy declares an image-pin invariant, so a policy without a
    // full-digest image must fail closed rather than silently skip the pin.
    if (policy !== null && expectedImageDigest === null)
      throw new Error("worker policy requires a digest-pinned image (name@sha256:<64 hex>)");
    const pinRequired = policy !== null || expectedImageDigest !== null;
    // T004: enforce the policy `network` declaration against the supplied
    // egress configuration. `none` forbids mediated egress; `broker` requires
    // it; a mismatch fails closed with a typed code (see
    // assertNetworkEgressContract).
    assertNetworkEgressContract(policy?.network ?? null, egress);
    // T005: `dropCapture.required` is the authoritative policy control (optional
    // by default); the older `egress.requireDropCapture` stays honored.
    const requireDropCapture =
      policy?.dropCapture?.required === true || egress?.requireDropCapture === true;
    let id = null;
    let provisioned = null;
    let egressReleased = false;
    const releaseEgress = async () => {
      if (!provisioned || egressReleased) return;
      egressReleased = true;
      await egressEnforcer.teardown({
        network: provisioned.internalNetwork,
        egressNetwork: provisioned.egressNetwork,
        brokerName: provisioned.brokerName,
      });
    };
    try {
      // T004: mediated egress. When configured, the worker runs on the
      // broker-only internal network (never a routed network) and the broker is
      // dual-homed to an egress network for upstream.
      if (egress) {
        if (!egressEnforcer?.provision)
          throw new TypeError("egress requires an egress network enforcer");
        provisioned = await egressEnforcer.provision({
          brokerImage: egress.brokerImage,
          brokerScript: egress.brokerScript,
          ...(egress.brokerName ? { brokerName: egress.brokerName } : {}),
        });
      }
      const networkMode = provisioned ? provisioned.network : "none";
      const created = await run(docker, [
        "create",
        "--name",
        name,
        "--init",
        "--network",
        networkMode,
        "--read-only",
        "--tmpfs",
        `${WORKSPACE}:rw,noexec,nosuid,nodev,size=${workspaceSize}`,
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        String(limits.pidsLimit),
        "--memory",
        String(limits.memoryBytes),
        "--cpu-quota",
        String(limits.cpuQuota ?? envelope.cpuQuota),
        "--cpu-period",
        String(limits.cpuPeriod ?? envelope.cpuPeriod),
        imageRef,
        "sleep",
        "infinity",
      ]);
      if (created.code !== 0) throw new Error(created.stderr || "docker create failed");
      id = created.stdout.trim();
      const started = await run(docker, ["start", id]);
      if (started.code !== 0) throw new Error(started.stderr || "docker start failed");
      if (workspaceTar) {
        const staged = await run(
          docker,
          ["exec", "-i", id, "tar", "--no-same-owner", "-xf", "-", "-C", WORKSPACE],
          { stdin: workspaceTar, timeoutMs: 120_000 },
        );
        if (staged.code !== 0) throw new Error(staged.stderr || "workspace staging failed");
      }
      if (workerSource) {
        const wrote = await run(docker, ["exec", "-i", id, "sh", "-c", `cat > ${WORKER_ENTRY}`], {
          stdin: workerSource,
          timeoutMs: 60_000,
        });
        if (wrote.code !== 0) throw new Error(wrote.stderr || "worker staging failed");
      }
      const workspaceDigest = workspaceTar
        ? `sha256:${createHash("sha256").update(workspaceTar).digest("hex")}`
        : null;
      const inspected = parseInspect((await run(docker, ["inspect", id])).stdout);
      const attestation = attestDockerWorker(inspected, {
        expectedImageDigest,
        expectedMemory: limits.memoryBytes,
        expectedPids: limits.pidsLimit,
        workspaceDigest,
        expectedNetwork: provisioned ? provisioned.network : null,
      });
      const failed = failedWorkerControls(attestation, { pinRequired });
      if (failed.length)
        throw new Error(`worker sandbox control failed attestation: ${failed.join(", ")}`);
      // T005: the signed attestation binds the matched registry RepoDigest (not
      // the container image ID); fall back to a digest of the ID only if the
      // daemon reported no RepoDigest at all.
      const boundImageDigest = /^sha256:[a-f0-9]{64}$/.test(String(attestation.imageDigest))
        ? attestation.imageDigest
        : `sha256:${createHash("sha256").update(String(attestation.imageId)).digest("hex")}`;
      const attestationDoc = buildWorkerAttestation({
        workerId: `worker-${id}`,
        runId: policy?.runId ?? `run-${id}`,
        policyDigest:
          policy?.policyDigest ??
          `sha256:${createHash("sha256")
            .update(canonicalize(policy ?? {}))
            .digest("hex")}`,
        imageDigest: boundImageDigest,
        status: "verified",
        inspections: [inspectionFromAttestation(attestation, now())],
        anchorKey,
        keyId,
        now,
      });
      const docResult = registry.validate("csm-orchestrate-worker-attestation/1", attestationDoc);
      if (!docResult.valid)
        throw new Error(
          `worker attestation document failed schema: ${JSON.stringify(docResult.errors)}`,
        );
      let capture = { degraded: false, reason: null };
      if (provisioned) {
        // Audit capture must not make the worker unstartable by default: the
        // drop-probe helper image build or iptables may be unavailable. A policy
        // that REQUIRES capture (`dropCapture.required`, or the legacy
        // `egress.requireDropCapture`) fails closed; otherwise the degradation is
        // recorded and observable.
        try {
          await egressEnforcer.provisionDropLogging({ workerId: id });
        } catch (error) {
          if (requireDropCapture) throw error;
          capture = { degraded: true, reason: String(error?.message ?? error) };
        }
        egressById.set(id, { releaseEgress, capture });
      }
      // T005: remember the policy session declaration so `session()` consumes it.
      if (policy) policyById.set(id, policy);
      return {
        id,
        name,
        attestation,
        attestationDoc,
        session: policy
          ? {
              mode: policy.session.mode,
              heartbeatMs: policy.session.heartbeatMs,
              reapingInit: policy.session.reapingInit,
            }
          : null,
        egress: provisioned
          ? {
              internalNetwork: provisioned.internalNetwork,
              egressNetwork: provisioned.egressNetwork,
              brokerName: provisioned.brokerName,
              capture,
            }
          : null,
      };
    } catch (error) {
      await stop({ id });
      await releaseEgress();
      throw error;
    }
  }

  // T004: one session implementation covers both shapes. A finite `messages`
  // batch with no interactive hooks keeps the original behavior (write, close
  // stdin, resolve once every message has echoed). Supplying `onResponse` and/or
  // `heartbeatMs` switches to a sustained session: stdin stays open, each
  // response may yield a follow-up round-trip, and a heartbeat keeps the pipe
  // warm until the caller aborts/closes or the timeout elapses.
  async function session({
    id,
    messages = [],
    timeoutMs = envelope.sessionTimeoutMs,
    signal = null,
    onResponse = null,
    heartbeatMs = null,
    heartbeat = () => ({ type: "heartbeat", at: now() }),
  }) {
    // T005: consume the policy's `session.heartbeatMs` as the default liveness
    // cadence for a sustained session. A finite batch without an interactive
    // hook keeps its one-shot behavior (no implicit heartbeats).
    const policyHeartbeat = policyById.get(id)?.session?.heartbeatMs;
    const effectiveHeartbeatMs =
      heartbeatMs ??
      (typeof onResponse === "function" && Number.isFinite(policyHeartbeat)
        ? policyHeartbeat
        : null);
    const sustained = typeof onResponse === "function" || Number.isFinite(effectiveHeartbeatMs);
    return new Promise((resolve) => {
      const child = spawn(docker, ["exec", "-i", id, "node", WORKER_ENTRY], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      ignoreStreamErrors(child);
      const responses = [];
      let buffer = "";
      let stderr = "";
      let settled = false;
      let timer = null;
      let heartbeatTimer = null;
      let roundTrips = 0;
      let heartbeats = 0;
      const expected = messages.length;
      const write = (message) => {
        if (!child.stdin.writable) return;
        try {
          child.stdin.write(`${JSON.stringify(message)}\n`);
        } catch {
          // Stream torn down between the writable check and the write; the
          // child close handler is authoritative.
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        signal?.removeEventListener?.("abort", onAbort);
        resolve({ responses, stderr, roundTrips, heartbeats, sustained });
      };
      const handleResponse = (response) => {
        responses.push(response);
        if (!sustained) {
          if (expected && responses.length >= expected) child.kill("SIGTERM");
          return;
        }
        if (typeof onResponse !== "function") return;
        Promise.resolve()
          .then(() => onResponse(response, responses.length - 1))
          .then((next) => {
            if (next === null) {
              child.stdin.end();
              return;
            }
            if (next === undefined) return;
            write(next);
            roundTrips += 1;
          })
          .catch(() => child.kill("SIGKILL"));
      };
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let response;
          try {
            response = JSON.parse(line);
          } catch {
            response = { raw: line };
          }
          handleResponse(response);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      if (timer.unref) timer.unref();
      const onAbort = () => child.kill("SIGKILL");
      signal?.addEventListener?.("abort", onAbort, { once: true });
      child.on("error", (error) => {
        stderr = `${stderr}${error.message}`;
        finish();
      });
      child.on("close", () => finish());
      for (const message of messages) write(message);
      if (!sustained) {
        child.stdin.end();
      } else if (Number.isFinite(effectiveHeartbeatMs) && effectiveHeartbeatMs > 0) {
        heartbeatTimer = setInterval(() => {
          if (!child.stdin.writable) return;
          write(heartbeat());
          heartbeats += 1;
        }, effectiveHeartbeatMs);
        if (heartbeatTimer.unref) heartbeatTimer.unref();
      }
      if (signal?.aborted) child.kill("SIGKILL");
    });
  }

  async function stop({ id }) {
    if (!id) return;
    const entry = egressById.get(id);
    if (entry && typeof egressEnforcer.removeDropLogging === "function") {
      try {
        await egressEnforcer.removeDropLogging({ workerId: id });
      } catch {
        // The reader shares the worker netns; removing the worker below is the
        // authoritative teardown, so a failed reader removal must not block it.
      }
    }
    await run(docker, ["rm", "-f", id], { timeoutMs: 30_000 });
    policyById.delete(id);
    if (entry) {
      egressById.delete(id);
      await entry.releaseEgress();
    }
  }

  // T001 (AC6): re-observe a running worker's controls for periodic
  // re-attestation. Runs the same `docker inspect` + parse path `start` uses for
  // its initial attestation, so a snapshot compares like-for-like.
  async function inspect({ id } = {}) {
    if (!id) throw new TypeError("worker inspect requires a worker id");
    const result = await run(docker, ["inspect", id]);
    if (result.code !== 0) throw new Error(result.stderr || "docker inspect failed");
    return parseInspect(result.stdout);
  }

  // T002: source per-drop network-layer facts against the worker's internal
  // network and, when a broker is supplied, feed each one into
  // `broker.recordDrop`. `degraded` is true whenever capture was impossible, so
  // a caller that requires capture can fail closed while a best-effort caller
  // only observes it.
  async function collectDrops({ id, broker = null, meta = {} } = {}) {
    if (!id || !egressById.has(id))
      return { id, count: 0, drops: [], recorded: [], degraded: false, reason: null };
    const entry = egressById.get(id);
    const result = await egressEnforcer.collectDrops({ workerId: id });
    const drops = Array.isArray(result.drops) ? result.drops : [];
    const recorded = [];
    if (broker && typeof broker.recordDrop === "function") {
      for (const drop of drops) {
        if (!Number.isInteger(drop.dest_port)) continue;
        recorded.push(
          broker.recordDrop({
            targetHost: drop.dest_ip,
            targetPort: drop.dest_port,
            reasonCode: "kernel-drop",
            workerId: `worker-${id}`,
            ...meta,
          }),
        );
      }
    }
    const degraded = result.degraded === true || entry.capture?.degraded === true;
    return {
      id,
      count: typeof result.count === "number" ? result.count : drops.length,
      drops,
      recorded,
      degraded,
      reason: result.reason ?? entry.capture?.reason ?? null,
    };
  }

  // T003: the explicit host trust boundary of this provider's attestation
  // anchor. `hostExternal` is true only when the caller declared an
  // out-of-OS-user anchor key/source.
  function trustBoundary() {
    return {
      trustDomain: anchorTrustDomain,
      hostExternal,
      keyId,
      anchorKeySource: hostExternal ? "external" : "in-process",
    };
  }

  // T003/T002: final-sink re-authorization for a terminal attestation. Re-verify
  // the keyed head and, by default (`requireHostExternal: true`), refuse an
  // OS-user-bounded anchor rather than silently accepting it as externally
  // anchored. Fail closed on any failed re-verification.
  //
  // T002: `acceptedTrustDomain` is an explicit trust-domain parameter that is
  // authoritative over `requireHostExternal` when supplied: `external` requires
  // a host-external key/source; `os-user-bound` accepts the in-process key
  // (the recorded g3-ruling boundary) only when the caller names it.
  function reauthorizeAttestation({
    doc,
    requireHostExternal = true,
    acceptedTrustDomain = null,
  } = {}) {
    let requireExternal = requireHostExternal;
    if (acceptedTrustDomain !== null && acceptedTrustDomain !== undefined) {
      if (
        acceptedTrustDomain !== WORKER_ANCHOR_TRUST_DOMAINS.osUser &&
        acceptedTrustDomain !== WORKER_ANCHOR_TRUST_DOMAINS.external
      )
        throw new TypeError(
          `unsupported accepted trust domain: ${String(acceptedTrustDomain)} (expected ${WORKER_ANCHOR_TRUST_DOMAINS.osUser} or ${WORKER_ANCHOR_TRUST_DOMAINS.external})`,
        );
      requireExternal = acceptedTrustDomain === WORKER_ANCHOR_TRUST_DOMAINS.external;
    }
    const base = { hostExternal, acceptedTrustDomain, anchor: trustBoundary() };
    let verified = false;
    try {
      verified = verifyWorkerAttestation({ doc, anchorKey }) === true;
    } catch {
      verified = false;
    }
    if (!verified) return { ...base, authorized: false, reasonCode: "attestation-invalid" };
    if (requireExternal && !hostExternal)
      return { ...base, authorized: false, reasonCode: "anchor-not-external-to-host" };
    return { ...base, authorized: true, reasonCode: "anchored" };
  }

  return Object.freeze({
    start,
    session,
    stop,
    inspect,
    collectDrops,
    attest: attestDockerWorker,
    trustBoundary,
    reauthorizeAttestation,
    now,
  });
}

// T005: periodic re-attestation. Re-runs the frozen-control predicate on a
// cadence and fails closed on any drift or inspect error (invokes `stop` to kill
// the worker). The snapshot chain is observational evidence, never acceptance
// authority.
export function createReattestationMonitor({
  inspect,
  stop = null,
  cadenceMs = 60_000,
  expected = {},
  onDrift = () => {},
  onSnapshot = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof inspect !== "function")
    throw new TypeError("reattestation requires an inspect function");
  if (!Number.isInteger(cadenceMs) || cadenceMs < 1)
    throw new TypeError("reattestation cadenceMs must be a positive integer");
  let timer = null;
  let stopped = false;
  const snapshots = [];
  async function tick() {
    if (stopped) return snapshots.at(-1) ?? null;
    let snapshot;
    try {
      const attestation = attestDockerWorker(await inspect(), expected);
      const failed = failedWorkerControls(attestation, {
        pinRequired: expected?.expectedImageDigest != null,
      });
      snapshot = { at: now(), attestation, drift: failed.length > 0, failed };
    } catch (error) {
      snapshot = {
        at: now(),
        attestation: null,
        drift: true,
        failed: ["inspect-error"],
        error: String(error?.message ?? error),
      };
    }
    snapshots.push(snapshot);
    // Handle drift/kill BEFORE any observer hook so a throwing hook cannot
    // leave the worker running (fail-closed ordering).
    if (snapshot.drift) {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stop) {
        try {
          await stop();
        } catch {
          // kill is best-effort; the drift is still terminal
        }
      }
      onDrift({
        reason: snapshot.failed.includes("inspect-error") ? "inspect-error" : "attestation-drift",
        failed: snapshot.failed,
      });
    }
    try {
      onSnapshot(snapshot);
    } catch {
      // observer hooks are best-effort and must never block the kill
    }
    return snapshot;
  }
  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => {
        void tick().catch(() => {});
      }, cadenceMs);
      if (timer.unref) timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    snapshots: () => snapshots.map((snapshot) => ({ ...snapshot })),
  };
}

export { parseInspect };
