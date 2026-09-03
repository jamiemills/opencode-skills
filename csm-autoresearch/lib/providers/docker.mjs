"use strict";

import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGeneratedProvider, createHostSandboxCapability, hash } from "./generated.mjs";

export const DOCKER_IMAGE_TAG = "node:22.22.0-bookworm-slim";
export const DOCKER_IMAGE_DIGEST =
  "sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94";
export const DOCKER_IMAGE = `node@${DOCKER_IMAGE_DIGEST}`;

const COMMAND_TIMEOUT_MS = 5000;
const COMMAND_OUTPUT_BYTES = 64 * 1024;

const imageInspect = (docker, image) =>
  JSON.parse(
    execFileSync(docker, ["image", "inspect", image], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: COMMAND_OUTPUT_BYTES,
    }),
  )[0];
const boundedInspect = async (docker, id) => {
  const result = await runCommand(docker, ["inspect", id], {
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxOutputBytes: COMMAND_OUTPUT_BYTES,
  });
  if (result.code !== 0 || result.timedOut || result.exceeded)
    throw new Error(result.stderr || "Docker inspect failed");
  return JSON.parse(result.stdout)[0];
};

function imageDigest(info, reference) {
  const repository = reference.split("@")[0].replace(/:[^/:]+$/, "");
  const match = (info.RepoDigests ?? []).find((value) => value.startsWith(`${repository}@`));
  return match?.slice(match.indexOf("@") + 1) ?? null;
}

async function processIds(docker, id) {
  try {
    const result = await runCommand(docker, ["top", id, "-eo", "pid,ppid"]);
    if (result.timedOut || result.code !== 0 || result.exceeded) {
      const state = await boundedInspect(docker, id)
        .then((value) => value.State ?? {})
        .catch(() => null);
      return state?.Running === false && Number(state.Pid) === 0 ? [] : null;
    }
    const lines = result.stdout.trim().split("\n");
    if (!/^\s*PID\s+PPID\s*$/i.test(lines[0] ?? "")) return null;
    const ids = lines.slice(1).map((line) => line.trim().split(/\s+/));
    if (ids.some((parts) => parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])))
      return null;
    return ids.map((parts) => parts[0]);
  } catch {
    return null;
  }
}

async function inspectObservation(docker, value, limits, reference, expectedEnvironmentNames) {
  const host = value.HostConfig ?? {};
  const mounts = value.Mounts ?? [];
  const workspaceTmpfs = host.Tmpfs?.["/workspace"] ?? "";
  const size = /(?:^|,)size=(\d+)/.exec(workspaceTmpfs)?.[1];
  const environment = value.Config?.Env ?? [];
  const names = [...new Set(environment.map((entry) => entry.split("=", 1)[0]))];
  const credentialNames = names.filter((name) =>
    /(?:TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|AUTH)/i.test(name),
  );
  const actualImage = value.Image ? imageInspect(docker, value.Image) : null;
  const descendants = await processIds(docker, value.Id);
  if (descendants === null) throw new Error("Docker descendant state was not observable");
  return {
    containerId: value.Id,
    imageDigest: actualImage ? imageDigest(actualImage, reference) : null,
    network: host.NetworkMode,
    mounts: mounts.map((mount) => ({
      source: mount.Source,
      destination: mount.Destination,
      type: mount.Type,
    })),
    rootFilesystem: host.ReadonlyRootfs === true ? "read-only" : "writable",
    tmpfs: {
      workspace: "/workspace",
      sizeBytes: Number(size),
      mode: workspaceTmpfs.replace(/,?size=\d+/, ""),
    },
    capDrop: host.CapDrop ?? [],
    noNewPrivileges: (host.SecurityOpt ?? []).includes("no-new-privileges:true"),
    privileged: host.Privileged === true,
    hostPid: host.PidMode === "host",
    hostIpc: host.IpcMode === "host",
    dockerSocket: mounts.some((mount) => mount.Destination === "/var/run/docker.sock"),
    limits: {
      cpuQuotaUs: host.CpuQuota,
      memoryBytes: host.Memory,
      pids: host.PidsLimit,
      maxOutputBytes: limits.maxOutputBytes,
      timeoutMs: limits.timeoutMs,
      workspaceBytes: limits.maxWorkspaceBytes,
    },
    environmentNames: names,
    credentialNames,
    environmentPolicy: JSON.stringify(names) === JSON.stringify(expectedEnvironmentNames),
    running: value.State?.Running === true,
    descendantCount: descendants.length,
  };
}

function boundedCapture(stream, limit, onLimit, state = { bytes: 0 }) {
  let bytes = 0;
  let value = "";
  let exceeded = false;
  stream.on("data", (chunk) => {
    if (exceeded) return;
    bytes += chunk.byteLength;
    state.bytes += chunk.byteLength;
    if (state.bytes > limit) {
      exceeded = true;
      onLimit();
      stream.destroy();
      return;
    }
    value += chunk.toString();
  });
  return () => ({ value, exceeded, bytes });
}

function runCommand(docker, args, { maxOutputBytes = 2000, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stop = false;
    let timer = setTimeout(() => {
      stop = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const state = { bytes: 0 };
    const readOut = boundedCapture(
      child.stdout,
      maxOutputBytes,
      () => {
        stop = true;
        child.kill("SIGKILL");
      },
      state,
    );
    const readErr = boundedCapture(
      child.stderr,
      maxOutputBytes,
      () => {
        stop = true;
        child.kill("SIGKILL");
      },
      state,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: readOut().value,
        stderr: readErr().value,
        exceeded: readOut().exceeded || readErr().exceeded,
        timedOut: stop && !readOut().exceeded && !readErr().exceeded,
      });
    });
  });
}

async function stageFile(docker, id, path, contents, timeoutMs) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(docker, ["exec", "-i", id, "/bin/sh", "-c", `cat > ${path}`], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const readErr = boundedCapture(child.stderr, 2000, () => child.kill("SIGKILL"));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: readErr().value, timedOut: code === null });
    });
    child.stdin.end(contents);
  });
  if (result.code !== 0 || result.timedOut)
    throw new Error(result.stderr || "Docker source staging failed");
}

async function stagedHash(docker, id, timeoutMs) {
  const result = await runCommand(
    docker,
    [
      "exec",
      id,
      "/usr/local/bin/node",
      "-e",
      "const fs=require('fs'),c=require('crypto'); process.stdout.write('sha256:'+c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))",
      "/workspace/candidate.mjs",
    ],
    { timeoutMs },
  );
  return result.code === 0 && !result.exceeded ? result.stdout.trim() : null;
}

export function createDockerSandboxProvider({ docker = "docker", image = DOCKER_IMAGE } = {}) {
  let imageInfo;
  let digest;
  try {
    imageInfo = imageInspect(docker, image);
    digest = imageDigest(imageInfo, image);
    if (!digest) throw new Error("image inspect did not provide a repository digest");
  } catch (error) {
    return {
      name: "docker",
      unavailable: String(error?.message ?? "Docker unavailable").slice(0, 2000),
    };
  }
  const imageEnvironmentNames = [
    ...new Set((imageInfo.Config?.Env ?? []).map((entry) => entry.split("=", 1)[0])),
  ];

  const policyDigestFor = (limits, sourceHash = hash("")) => {
    const policy = {
      format: "csm-autoresearch-docker-sandbox-policy/1",
      provider: "docker",
      image: { reference: image, digest },
      network: "none",
      mounts: [],
      rootFilesystem: "read-only",
      tmpfs: {
        workspace: "/workspace",
        sizeBytes: limits.maxWorkspaceBytes,
        mode: "rw,noexec,nosuid,nodev",
      },
      security: {
        capDrop: ["ALL"],
        noNewPrivileges: true,
        privileged: false,
        hostPid: false,
        hostIpc: false,
        dockerSocket: false,
      },
      limits: {
        cpuQuotaUs: 100000,
        memoryBytes: 64 * 1024 * 1024,
        pids: 32,
        maxOutputBytes: limits.maxOutputBytes,
        timeoutMs: limits.timeoutMs,
        workspaceBytes: limits.maxWorkspaceBytes,
      },
      process: { killContainerOnExit: true, verifyDescendantsAbsent: true },
      source: { hash: sourceHash },
      environment: { allowlist: [], credentials: "none" },
    };
    return hash(JSON.stringify(policy));
  };
  const capability = createHostSandboxCapability({
    attest: ({ provider, limits }) => ({
      provider,
      limits: { ...limits },
      network: "disabled",
      mounts: [],
      evaluatorAssets: "isolated",
      credentials: "none",
      policyDigest: policyDigestFor(limits),
      imageDigest: digest,
      sourceHash: hash(""),
      status: "verified",
      controls: {
        pinnedImage: true,
        networkIsolation: true,
        mountIsolation: true,
        credentialIsolation: true,
        resourceLimits: true,
        readOnlyRootfs: true,
        boundedTmpfs: true,
        capDropAll: true,
        noNewPrivileges: true,
        cpuLimit: true,
        memoryLimit: true,
        pidLimit: true,
        outputLimit: true,
        processContainment: true,
        descendantContainment: true,
        sourceHashBinding: true,
        cleanupVerification: true,
      },
      networkIsolation: true,
      mountIsolation: true,
      credentialIsolation: true,
      resourceLimits: true,
      processContainment: true,
      descendantContainment: true,
      sourceHashBinding: true,
      cleanupVerification: true,
    }),
    verifyLimits: (evidence, limits) =>
      evidence?.limits && Object.keys(limits).every((key) => evidence.limits[key] === limits[key]),
    verifyPolicy: (evidence, controls) =>
      evidence?.policyDigest === policyDigestFor(controls.limits, controls.sourceHash),
    verifyCleanup: (result) => result?.cleanup?.status === "verified",
  });
  const provider = {
    name: "docker",
    capability,
    async execute({ source, input, limits, signal }) {
      const workspace = await mkdtemp(join(tmpdir(), "csm-docker-candidate-"));
      const sourceHash = hash(source);
      const policy = {
        format: "csm-autoresearch-docker-sandbox-policy/1",
        provider: "docker",
        image: { reference: image, digest },
        network: "none",
        mounts: [],
        rootFilesystem: "read-only",
        tmpfs: {
          workspace: "/workspace",
          sizeBytes: limits.maxWorkspaceBytes,
          mode: "rw,noexec,nosuid,nodev",
        },
        security: {
          capDrop: ["ALL"],
          noNewPrivileges: true,
          privileged: false,
          hostPid: false,
          hostIpc: false,
          dockerSocket: false,
        },
        limits: {
          cpuQuotaUs: 100000,
          memoryBytes: 64 * 1024 * 1024,
          pids: 32,
          maxOutputBytes: limits.maxOutputBytes,
          timeoutMs: limits.timeoutMs,
          workspaceBytes: limits.maxWorkspaceBytes,
        },
        process: { killContainerOnExit: true, verifyDescendantsAbsent: true },
        source: { hash: sourceHash },
        environment: { allowlist: [], credentials: "none" },
      };
      const policyDigest = policyDigestFor(limits, sourceHash);
      const name = `csm-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let id;
      let before;
      let after;
      let outputExceeded = false;
      let stagedSourceHash = null;
      const cleanup = {
        status: "unknown",
        containerAbsent: false,
        descendantsAbsent: false,
        workspaceRemoved: false,
      };
      let outcome = {
        status: "sandbox_unavailable",
        diagnostics: ["Docker execution did not complete"],
      };
      try {
        await writeFile(join(workspace, "candidate.mjs"), source, { mode: 0o600 });
        await writeFile(
          join(workspace, "runner.mjs"),
          "import candidate from './candidate.mjs'; const value = await candidate(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(value));\n",
          { mode: 0o600 },
        );
        const created = await runCommand(
          docker,
          [
            "create",
            "--name",
            name,
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            `/workspace:rw,noexec,nosuid,nodev,size=${limits.maxWorkspaceBytes}`,
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--pids-limit",
            "32",
            "--memory",
            "67108864",
            "--cpu-quota",
            "100000",
            "--cpu-period",
            "100000",
            image.includes("@") ? image : `${image}@${digest}`,
            "sleep",
            "infinity",
          ],
          { timeoutMs: COMMAND_TIMEOUT_MS },
        );
        if (created.code !== 0 || created.timedOut || created.exceeded)
          throw new Error(created.stderr || "Docker create failed");
        id = created.stdout.trim();
        const started = await runCommand(docker, ["start", id], { timeoutMs: COMMAND_TIMEOUT_MS });
        if (started.code !== 0 || started.timedOut || started.exceeded)
          throw new Error(started.stderr || "Docker start failed");
        await stageFile(docker, id, "/workspace/candidate.mjs", source, COMMAND_TIMEOUT_MS);
        await stageFile(
          docker,
          id,
          "/workspace/runner.mjs",
          "import candidate from './candidate.mjs'; const value = await candidate(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(value));\n",
          COMMAND_TIMEOUT_MS,
        );
        stagedSourceHash = await stagedHash(docker, id, COMMAND_TIMEOUT_MS);
        before = await inspectObservation(
          docker,
          await boundedInspect(docker, id),
          limits,
          image,
          imageEnvironmentNames,
        );
        if (
          before.imageDigest !== digest ||
          before.network !== "none" ||
          before.mounts.length ||
          before.rootFilesystem !== "read-only" ||
          JSON.stringify(before.capDrop) !== JSON.stringify(["ALL"]) ||
          !before.noNewPrivileges ||
          before.privileged ||
          before.hostPid ||
          before.hostIpc ||
          before.dockerSocket ||
          before.credentialNames.length ||
          !before.environmentPolicy ||
          before.limits.cpuQuotaUs !== policy.limits.cpuQuotaUs ||
          before.limits.memoryBytes !== policy.limits.memoryBytes ||
          before.limits.pids !== policy.limits.pids ||
          before.tmpfs.sizeBytes !== policy.tmpfs.sizeBytes ||
          before.tmpfs.mode !== policy.tmpfs.mode
        )
          throw new Error("Docker inspect did not prove launch policy");
        if (stagedSourceHash !== sourceHash) throw new Error("staged source hash mismatch");
        const child = spawn(
          docker,
          [
            "exec",
            id,
            "/usr/local/bin/node",
            "/workspace/runner.mjs",
            JSON.stringify(input ?? null),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stop = false;
        const outputState = { bytes: 0 };
        const readOut = boundedCapture(
          child.stdout,
          limits.maxOutputBytes,
          () => {
            outputExceeded = true;
            stop = true;
            child.kill("SIGKILL");
          },
          outputState,
        );
        const readErr = boundedCapture(
          child.stderr,
          limits.maxOutputBytes,
          () => {
            outputExceeded = true;
            stop = true;
            child.kill("SIGKILL");
          },
          outputState,
        );
        const result = await new Promise((resolve) => {
          let timer = setTimeout(() => {
            stop = true;
            child.kill("SIGKILL");
            resolve({ timedOut: true });
          }, limits.timeoutMs);
          const cancel = () => {
            stop = true;
            child.kill("SIGKILL");
            resolve({ cancelled: true });
          };
          signal?.addEventListener("abort", cancel, { once: true });
          child.once("close", (code) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            resolve({ code, timedOut: false, cancelled: false });
          });
          if (signal?.aborted) cancel();
        });
        const stdout = readOut().value;
        const stderr = readErr().value;
        if (result.timedOut)
          outcome = { status: "timed_out", diagnostics: ["Docker candidate timeout"] };
        else if (result.cancelled)
          outcome = { status: "blocked", diagnostics: ["Docker candidate cancelled"] };
        else if (outputExceeded || stop)
          outcome = {
            status: "resource_exhausted",
            diagnostics: ["Docker candidate output limit exceeded"],
          };
        else if (result.code === 0)
          outcome = { status: "ok", metrics: JSON.parse(stdout), diagnostics: [] };
        else
          outcome = {
            status: "failed",
            diagnostics: [stderr.slice(0, 2000) || "Docker candidate failed"],
          };
      } catch (error) {
        outcome = {
          status: "sandbox_unavailable",
          diagnostics: [String(error?.message ?? "Docker execution failed").slice(0, 2000)],
        };
      } finally {
        if (id) {
          await runCommand(docker, ["kill", id], { timeoutMs: COMMAND_TIMEOUT_MS }).catch(() => {});
          await runCommand(docker, ["wait", id], { timeoutMs: COMMAND_TIMEOUT_MS }).catch(() => {});
          try {
            after = await inspectObservation(
              docker,
              await boundedInspect(docker, id),
              limits,
              image,
              imageEnvironmentNames,
            );
          } catch {
            after = null;
          }
          const descendants = after ? await processIds(docker, id) : null;
          const hadNoDescendants = descendants?.length === 0;
          await runCommand(docker, ["rm", "-f", id], { timeoutMs: COMMAND_TIMEOUT_MS }).catch(
            () => {},
          );
          try {
            await boundedInspect(docker, id);
          } catch {
            cleanup.containerAbsent = true;
          }
          cleanup.descendantsAbsent = hadNoDescendants === true && cleanup.containerAbsent;
        }
        await rm(workspace, { recursive: true, force: true });
        try {
          await writeFile(join(workspace, "never"), "");
        } catch {
          cleanup.workspaceRemoved = true;
        }
        cleanup.status =
          cleanup.containerAbsent && cleanup.descendantsAbsent && cleanup.workspaceRemoved
            ? "verified"
            : "unknown";
      }
      const controls =
        before && after
          ? {
              pinnedImage: before.imageDigest === digest && after.imageDigest === digest,
              networkIsolation: before.network === "none" && after.network === "none",
              mountIsolation: before.mounts.length === 0 && after.mounts.length === 0,
              credentialIsolation:
                before.credentialNames.length === 0 &&
                after.credentialNames.length === 0 &&
                before.environmentPolicy &&
                after.environmentPolicy,
              resourceLimits:
                before.limits.cpuQuotaUs === policy.limits.cpuQuotaUs &&
                after.limits.cpuQuotaUs === policy.limits.cpuQuotaUs &&
                before.limits.memoryBytes === policy.limits.memoryBytes &&
                after.limits.memoryBytes === policy.limits.memoryBytes &&
                before.limits.pids === policy.limits.pids &&
                after.limits.pids === policy.limits.pids,
              readOnlyRootfs:
                before.rootFilesystem === "read-only" && after.rootFilesystem === "read-only",
              boundedTmpfs:
                before.tmpfs.sizeBytes === policy.tmpfs.sizeBytes &&
                after.tmpfs.sizeBytes === policy.tmpfs.sizeBytes,
              capDropAll:
                JSON.stringify(before.capDrop) === JSON.stringify(["ALL"]) &&
                JSON.stringify(after.capDrop) === JSON.stringify(["ALL"]),
              noNewPrivileges: before.noNewPrivileges && after.noNewPrivileges,
              cpuLimit:
                before.limits.cpuQuotaUs === policy.limits.cpuQuotaUs &&
                after.limits.cpuQuotaUs === policy.limits.cpuQuotaUs,
              memoryLimit:
                before.limits.memoryBytes === policy.limits.memoryBytes &&
                after.limits.memoryBytes === policy.limits.memoryBytes,
              pidLimit:
                before.limits.pids === policy.limits.pids &&
                after.limits.pids === policy.limits.pids,
              outputLimit: outputExceeded === false,
              processContainment:
                !before.hostPid && !before.hostIpc && !before.privileged && !before.dockerSocket,
              descendantContainment: cleanup.descendantsAbsent,
              sourceHashBinding: stagedSourceHash === sourceHash,
              cleanupVerification: cleanup.status === "verified",
            }
          : {};
      outcome.cleanup = cleanup;
      outcome.attestation =
        before && after
          ? {
              format: "csm-autoresearch-docker-sandbox-attestation/1",
              provider: "docker",
              policyDigest,
              containerId: id,
              imageDigest: digest,
              sourceHash,
              network: "disabled",
              mounts: [],
              evaluatorAssets: "isolated",
              credentials: "none",
              limits: { ...limits },
              inspectBefore: before,
              inspectAfter: after,
              controls,
              cleanup,
              status:
                Object.values(controls).every(Boolean) && cleanup.status === "verified"
                  ? "verified"
                  : cleanup.status,
            }
          : null;
      if (outcome.status === "ok" && outcome.attestation?.status !== "verified") {
        outcome.status = "sandbox_unavailable";
        outcome.diagnostics = ["Docker inspect or cleanup attestation was incomplete"];
      }
      return outcome;
    },
  };
  return Object.freeze(provider);
}

export function createDockerGeneratedProvider({
  evaluatorHash = hash("csm-autoresearch-docker-evaluator/1"),
  environmentHash = hash("node-22-docker-environment/1"),
  limits = { timeoutMs: 1000, maxOutputBytes: 64 * 1024, maxWorkspaceBytes: 1024 * 1024 },
  approval = {
    status: "approved",
    approver: "docker-host",
    reason: "explicit Docker sandbox integration",
  },
  ...dockerOptions
} = {}) {
  const sandbox = createDockerSandboxProvider(dockerOptions);
  return createGeneratedProvider({
    sandbox,
    hostCapability: sandbox.capability,
    evaluatorHash,
    environmentHash,
    limits,
    approval,
    sandboxProvider: "docker",
  });
}
