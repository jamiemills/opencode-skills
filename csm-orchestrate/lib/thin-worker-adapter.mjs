"use strict";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubChildEnv } from "./env-scrub.mjs";

// T003: bind `scripts/run-worker.mjs` behind the executor-adapter contract. The
// adapter is child-side only: it writes exactly one invocation to a file, runs
// the env-gated thin worker, and returns a raw child result. It owns no cursor,
// receipt, gate, or acceptance authority — the parent orchestrator does.

function run(spawnFn, file, args, env, timeoutMs, signal) {
  return new Promise((resolve) => {
    const child = spawnFn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-65536);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-65536);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

function toRawChildResult(short) {
  if (short.status === "completed")
    return {
      status: "completed",
      childReceipt: short.receipt ?? null,
      evidence: short.artifacts ?? [],
      outputArtifactRefs: short.artifacts ?? [],
      technical: null,
      functional: null,
    };
  return {
    status: short.status === "failed" ? "failed" : "blocked",
    failure: short.failure ?? {
      class: "runtime",
      code: "thin-worker-failed",
      message: "worker failed",
    },
  };
}

export function createThinWorkerAdapter({
  workerScript,
  handlerPath = null,
  spawnFn = spawn,
  timeoutMs = 60_000,
  env = {},
} = {}) {
  if (typeof workerScript !== "string" || workerScript.length < 1)
    throw new TypeError("thin worker adapter requires workerScript");
  const invoke = async (request, options = {}) => {
    if (options.signal?.aborted)
      return {
        status: "failed",
        failure: { class: "timeout", code: "cancelled", message: "execution cancelled" },
      };
    const dir = await mkdtemp(join(tmpdir(), "csm-thin-worker-"));
    try {
      const invocationPath = join(dir, "invocation.json");
      await writeFile(invocationPath, `${JSON.stringify(request)}\n`);
      const args = [workerScript, "--invocation", invocationPath];
      if (handlerPath) args.push("--handler", handlerPath);
      const childEnv = { ...scrubChildEnv(process.env), ...env, CSM_AGENT_SESSION_EXEC: "1" };
      const { code, stdout, stderr } = await run(
        spawnFn,
        process.execPath,
        args,
        childEnv,
        timeoutMs,
        options.signal,
      );
      if (code !== 0)
        return {
          status: "blocked",
          failure: {
            class: "runtime",
            code: "thin-worker-failed",
            message: stderr.trim() || `thin worker exited ${code}`,
          },
        };
      let short;
      try {
        short = JSON.parse(stdout.trim().split("\n").at(-1));
      } catch {
        return {
          status: "blocked",
          failure: {
            class: "runtime",
            code: "thin-worker-invalid-result",
            message: "thin worker did not return JSON",
          },
        };
      }
      if (!["completed", "failed", "blocked"].includes(short.status))
        return {
          status: "blocked",
          failure: {
            class: "runtime",
            code: "thin-worker-invalid-result",
            message: "thin worker returned an invalid status",
          },
        };
      return toRawChildResult(short);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  // T003: the executor-adapter contract used by the registry/handlers is an
  // `.execute({ input, signal, context })` callback that returns a raw child
  // result. This is a thin translation over `invoke` so the entry can be
  // registered like every other adapter; authority stays with the parent.
  const execute = async ({ input, signal, context } = {}) => {
    if (!context || typeof context !== "object" || typeof context.owner !== "string")
      throw new TypeError("thin worker adapter requires a child context");
    const result = await invoke(
      {
        invocationId: context.invocationId ?? null,
        parentRunId: context.parentRunId ?? null,
        childRunId: context.runId,
        phaseId: context.phaseId ?? null,
        edgeId: context.edgeId ?? null,
        skill: context.owner,
        attempt: context.attempt,
        input: input ?? {},
      },
      { signal },
    );
    if (result.status === "completed")
      return {
        status: "completed",
        effects: [],
        artifacts: result.outputArtifactRefs ?? [],
        receipt: result.childReceipt,
        evidence: [],
        output: null,
        technical: [],
        functional: [],
      };
    return {
      status: result.status === "failed" ? "failed" : "blocked",
      effects: [],
      artifacts: [],
      receipt: null,
      evidence: [],
      failure: result.failure ?? {
        class: "runtime",
        code: "thin-worker-failed",
        message: "worker failed",
      },
    };
  };
  return Object.freeze({ invoke, execute });
}
