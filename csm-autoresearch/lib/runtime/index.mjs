"use strict";

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, stat, writeFile, readdir, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const POSIX = process.platform !== "win32";
const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const RUNTIME_CAPABILITIES = Object.freeze({
  timeout: true,
  output: true,
  workspace: true,
  network: false,
  memory: false,
  processes: false,
  descendants: false,
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function redactedProvenance({ evaluatorHash, environmentHash, limits, sandboxProvider } = {}) {
  const result = { evaluatorHash, environmentHash, limits: { ...limits }, redacted: true };
  if (sandboxProvider) result.sandboxProvider = String(sandboxProvider).replace(/[\r\n]/g, "");
  return result;
}

async function createWorkspace(parent = tmpdir(), prefix = "candidate-") {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(resolve(parent, prefix));
}

async function cleanupWorkspace(workspace) {
  if (!POSIX)
    return {
      supported: false,
      verifiable: false,
      descendantContainment: "unverified",
      cleaned: false,
      reason: "process-group cleanup unsupported on this platform",
    };
  await rm(workspace, { recursive: true, force: true });
  let cleaned = false;
  try {
    await stat(workspace);
  } catch (error) {
    if (error.code === "ENOENT") cleaned = true;
    else throw error;
  }
  return {
    supported: true,
    verifiable: true,
    descendantContainment: "unverified",
    cleaned,
    reason: cleaned
      ? "workspace removal verified; descendant containment is not provided"
      : "workspace remains after cleanup",
  };
}

async function copyTree(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const sourcePath = `${from}/${entry.name}`;
    const targetPath = `${to}/${entry.name}`;
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) throw new TypeError("workspace contains a symlink");
    if (info.isDirectory()) {
      await mkdir(targetPath, { mode: 0o700 });
      await copyTree(sourcePath, targetPath);
    } else await cp(sourcePath, targetPath, { force: false, dereference: false });
  }
}

async function snapshotWorkspace(source, destination) {
  await copyTree(source, destination);
  return destination;
}

async function workspaceBytes(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) total += await workspaceBytes(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

function killGroup(child) {
  if (!POSIX) return false;
  try {
    process.kill(-child.pid, "SIGKILL");
    return true;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

async function executeCandidate({
  command,
  args = [],
  cwd,
  env = {},
  envAllowlist = Object.keys(env),
  timeoutMs = 1000,
  maxOutputBytes = DEFAULT_OUTPUT_BYTES,
  maxWorkspaceBytes = 10 * 1024 * 1024,
  maxMemoryMb,
  maxProcesses,
  network,
  requireDescendantContainment = false,
  signal,
  workspace,
}) {
  if (!POSIX)
    return {
      status: "blocked",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: ["unsupported_capability: POSIX process-group cleanup is unavailable"],
    };
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string")
  )
    return {
      status: "policy_violation",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: ["command must be an argument array"],
    };
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1
  )
    return {
      status: "policy_violation",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: ["invalid resource limits"],
    };
  if (maxMemoryMb !== undefined || maxProcesses !== undefined || network !== undefined)
    return {
      status: "policy_violation",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: ["declared memory, process, or network limits are not enforced by this runtime"],
    };
  if (requireDescendantContainment)
    return {
      status: "policy_violation",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: [
        "unsupported_capability: descendant containment is not provided by this runtime",
      ],
    };
  if (!Array.isArray(envAllowlist) || envAllowlist.some((key) => typeof key !== "string"))
    return {
      status: "policy_violation",
      valid: false,
      stdout: "",
      stderr: "",
      diagnostics: ["environment allowlist is invalid"],
    };
  const allowedEnv = Object.fromEntries(
    envAllowlist.filter((key) => Object.hasOwn(env, key)).map((key) => [key, String(env[key])]),
  );
  if (workspace) {
    if (!Number.isInteger(maxWorkspaceBytes) || maxWorkspaceBytes < 1)
      return {
        status: "policy_violation",
        valid: false,
        stdout: "",
        stderr: "",
        diagnostics: ["invalid workspace limit"],
      };
    let bytes;
    try {
      bytes = await workspaceBytes(workspace);
    } catch {
      return {
        status: "blocked",
        valid: false,
        stdout: "",
        stderr: "",
        diagnostics: ["workspace inspection failed before execution"],
      };
    }
    if (bytes > maxWorkspaceBytes)
      return {
        status: "resource_exhausted",
        valid: false,
        stdout: "",
        stderr: "",
        diagnostics: ["workspace limit exceeded before execution"],
      };
  }
  const child = spawn(command, args, {
    cwd,
    env: allowedEnv,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let outputBytes = 0;
  let exhausted = false;
  const collect = (stream, which) =>
    new Promise((resolveStream) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolveStream();
        }
      };
      stream
        .on("data", (chunk) => {
          if (exhausted) return;
          const next = Buffer.concat([which === "stdout" ? stdout : stderr, chunk]);
          const remaining = maxOutputBytes - outputBytes;
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) {
            const bounded = chunk.subarray(0, Math.max(remaining, 0));
            const boundedNext = Buffer.concat([which === "stdout" ? stdout : stderr, bounded]);
            if (which === "stdout") stdout = boundedNext;
            else stderr = boundedNext;
            exhausted = true;
            killGroup(child);
            stopCollecting();
            return;
          }
          if (which === "stdout") stdout = next;
          else stderr = next;
        })
        .on("end", finish)
        .on("close", finish)
        .on("error", finish);
    });
  let timedOut = false;
  let cancelled = false;
  let resolveDeadline;
  const deadline = new Promise((resolveDeadlineValue) => {
    resolveDeadline = resolveDeadlineValue;
  });
  function stopCollecting() {
    child.stdout?.removeAllListeners("data");
    child.stderr?.removeAllListeners("data");
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child);
    stopCollecting();
    resolveDeadline({ code: null, signal: "SIGKILL" });
  }, timeoutMs);
  const onAbort = () => {
    cancelled = true;
    killGroup(child);
    stopCollecting();
    resolveDeadline({ code: null, signal: "SIGKILL" });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const normalCompletion = Promise.all([
    new Promise((resolveExit) => {
      child.once("error", (error) => resolveExit({ code: null, signal: null, error }));
      child.once("close", (code, signalName) => resolveExit({ code, signal: signalName }));
    }),
    collect(child.stdout, "stdout"),
    collect(child.stderr, "stderr"),
  ]);
  const [exit] = await Promise.race([normalCompletion, deadline.then((value) => [value])]);
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  let status = "ok";
  let diagnostics = [];
  if (exhausted) {
    status = "resource_exhausted";
    diagnostics.push("output limit exceeded");
  } else if (timedOut) {
    status = "timed_out";
    diagnostics.push("timeout exceeded");
  } else if (cancelled) {
    status = "blocked";
    diagnostics.push("cancelled");
  } else if (exit.error) {
    status = "failed";
    diagnostics.push(exit.error.code === "ENOENT" ? "command not found" : "process failed");
  } else if (exit.code !== 0) {
    status = "failed";
    diagnostics.push(`exit code ${exit.code ?? "signal"}`);
  }
  if (workspace && status === "ok") {
    let bytes;
    try {
      bytes = await workspaceBytes(workspace);
    } catch {
      status = "blocked";
      diagnostics.push("workspace inspection failed");
    }
    if (bytes > maxWorkspaceBytes) {
      status = "resource_exhausted";
      diagnostics.push("workspace limit exceeded");
    }
  }
  const cleanup = workspace
    ? await cleanupWorkspace(workspace)
    : {
        supported: false,
        verifiable: false,
        cleaned: false,
        reason: "disposable workspace is required",
      };
  if (!cleanup.supported || !cleanup.verifiable || !cleanup.cleaned) {
    status = "blocked";
    diagnostics.push(cleanup.reason ?? "cleanup verification failed");
  }
  return {
    status,
    valid: status === "ok",
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    diagnostics,
    exit,
    cleanup,
  };
}

async function publishAtomic(path, value, { mode = 0o600 } = {}) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const data =
    typeof value === "string" || Buffer.isBuffer(value) ? value : `${JSON.stringify(value)}\n`;
  await writeFile(temp, data, { mode });
  await rename(temp, target);
  return target;
}

async function readBoundedFile(path, maxBytes) {
  const data = await readFile(path);
  if (data.length > maxBytes) throw new Error("artifact exceeds byte limit");
  return data;
}

export {
  POSIX,
  RUNTIME_CAPABILITIES,
  cleanupWorkspace,
  createWorkspace,
  executeCandidate,
  publishAtomic,
  readBoundedFile,
  redactedProvenance,
  sha256,
  snapshotWorkspace,
  workspaceBytes,
};
