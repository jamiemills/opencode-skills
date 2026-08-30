"use strict";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHILD_STATUSES = new Set(["completed", "failed", "blocked", "incomplete"]);
const AGENT_BY_SKILL = Object.freeze({
  "csm-build": "build",
  "csm-deep-research": "research",
  "csm-review": "review",
  "csm-plan": "plan",
});

function requestContext(request) {
  return JSON.stringify({
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    phaseId: request.phaseId,
    edgeId: request.edgeId,
    skill: request.skill,
    skillDigest: request.skillDigest,
    inputArtifactRefs: request.inputArtifactRefs,
    upstreamArtifactRefs: request.upstreamArtifactRefs ?? [],
    permissions: request.permissions,
    retry: request.retry,
  });
}

function parseJsonResult(text) {
  const candidates = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .toReversed();
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value) && "status" in value)
        return value;
    } catch {
      continue;
    }
  }
  throw new TypeError("child host did not return a JSON result object");
}

function incomplete(code, message) {
  return { status: "incomplete", failure: { class: "host", code, message } };
}

export function createCliHost({
  command = "opencode",
  cwd = process.cwd(),
  timeoutMs = 300_000,
  agentForSkill = (skill) => AGENT_BY_SKILL[skill] ?? "build",
  runner = execFileAsync,
} = {}) {
  if (typeof command !== "string" || command.length === 0)
    throw new TypeError("host command is required");
  if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("host cwd is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("host timeout must be positive");
  if (typeof agentForSkill !== "function" || typeof runner !== "function")
    throw new TypeError("host agent selector and runner are required");

  return Object.freeze({
    async invokeSiblingSkill(request, { signal } = {}) {
      const agent = agentForSkill(request?.skill);
      if (typeof agent !== "string" || agent.length === 0)
        return incomplete("invalid-agent", "no agent is configured for the requested skill");
      if (signal?.aborted)
        return incomplete("cancelled", "child invocation was cancelled before launch");
      const prompt = [
        "Execute this CSM sibling-skill invocation in the supplied repository context.",
        "Do not commit, push, deploy, or mutate external systems.",
        "Your final output MUST contain exactly one JSON object with status completed, failed, blocked, or incomplete.",
        "For completed output, include childReceipt with the requested childRunId and skill owner, plus evidence/outputArtifactRefs when applicable.",
        `Invocation: ${requestContext(request)}`,
      ].join("\n");
      try {
        const result = await runner(
          command,
          ["run", "--format", "json", "--agent", agent, "--dir", cwd, "--prompt", prompt],
          {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
            signal,
            windowsHide: true,
          },
        );
        const parsed = parseJsonResult(result?.stdout ?? result);
        if (!CHILD_STATUSES.has(parsed.status))
          return incomplete("invalid-child-status", "child result has an unsupported status");
        return parsed;
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted)
          return incomplete("cancelled", "child invocation was cancelled");
        if (error?.code === "ETIMEDOUT") return incomplete("timeout", "child invocation timed out");
        if (
          error instanceof SyntaxError ||
          /did not return a JSON result/.test(error?.message ?? "")
        )
          return incomplete("invalid-child-output", error.message);
        return {
          status: "failed",
          failure: {
            class: "host",
            code: "child-process-failed",
            message: error?.message ?? "child process failed",
          },
        };
      }
    },
  });
}

export { parseJsonResult };
