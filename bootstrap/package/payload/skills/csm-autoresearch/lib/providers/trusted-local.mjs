"use strict";

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  cleanupWorkspace,
  createWorkspace,
  executeCandidate,
  snapshotWorkspace,
} from "../runtime/index.mjs";
import { validateRequest, validateResponse } from "../protocol/index.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN = /^(?:evaluator|tests?|fixtures?|policy|credentials?)$/i;

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function inside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
function safeRelative(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.split(/[\\/]+/).some((part) => part === ".." || FORBIDDEN.test(part))
  )
    throw new TypeError(`${label} is outside the mutation boundary`);
  return value;
}
async function noSymlink(path, label, { mustExist = true } = {}) {
  const absolute = resolve(path);
  const parts = absolute.split(sep);
  let current = parts[0] || sep;
  for (const part of parts.slice(1)) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new TypeError(`${label} symlink is not allowed`);
    } catch (error) {
      if (error.code === "ENOENT" && !mustExist) return absolute;
      throw error;
    }
  }
  return realpath(absolute);
}
function approval(value) {
  if (
    !value ||
    value.status !== "approved" ||
    typeof value.approver !== "string" ||
    !value.approver ||
    typeof value.reason !== "string" ||
    !value.reason
  )
    throw new TypeError("explicit approval metadata is required");
  return { status: value.status, approver: value.approver, reason: value.reason };
}
function response(
  request,
  status,
  diagnostics,
  evaluatorHash,
  environmentHash,
  limits,
  metrics = {},
) {
  const value = {
    format: "csm-autoresearch-evaluator-response/1",
    requestId: request.requestId,
    runId: request.runId,
    status,
    valid: status === "ok",
    metrics,
    diagnostics,
    provenance: { evaluatorHash, environmentHash, limits: { ...limits }, redacted: true },
  };
  validateResponse(value);
  return value;
}

async function createTrustedLocalProvider({
  sourcePath,
  sourceHash,
  workspace,
  evolutionRegion,
  mutationAllowlist,
  env = {},
  envAllowlist,
  evaluatorHash,
  environmentHash,
  limits,
  approval: approvalMetadata,
} = {}) {
  if (
    !HASH.test(sourceHash ?? "") ||
    !HASH.test(evaluatorHash ?? "") ||
    !HASH.test(environmentHash ?? "")
  )
    throw new TypeError("provider hashes must be sha256");
  if (!Array.isArray(mutationAllowlist) || mutationAllowlist.length === 0)
    throw new TypeError("mutation allowlist is required");
  if (!Array.isArray(envAllowlist) || envAllowlist.some((key) => typeof key !== "string"))
    throw new TypeError("explicit environment allowlist is required");
  if (
    limits?.network !== undefined ||
    limits?.maxMemoryMb !== undefined ||
    limits?.maxProcesses !== undefined
  )
    throw new TypeError("trusted-local cannot enforce declared memory, process, or network limits");
  const approved = approval(approvalMetadata);
  const root = await noSymlink(workspace, "workspace");
  const source = await noSymlink(sourcePath, "source");
  if (!inside(root, source)) throw new TypeError("source is outside the trusted workspace");
  safeRelative(relative(root, source), "source path");
  const sourceBytes = await readFile(source);
  if (hash(sourceBytes) !== sourceHash) throw new TypeError("trusted source hash mismatch");
  const region = safeRelative(evolutionRegion, "evolution region");
  for (const path of mutationAllowlist) {
    const relativePath = safeRelative(path, "mutation path");
    if (!inside(root, resolve(root, relativePath)))
      throw new TypeError("mutation path is outside the trusted workspace");
    await noSymlink(resolve(root, relativePath), "mutation path", { mustExist: false });
  }
  if (!inside(root, resolve(root, region)))
    throw new TypeError("evolution region is outside the trusted workspace");
  return Object.freeze({
    mode: "trusted-local",
    approval: approved,
    sourceHash,
    evolutionRegion: region,
    mutationAllowlist: [...mutationAllowlist],
    envAllowlist: [...envAllowlist],
    async evaluate(request) {
      validateRequest(request);
      if (request.candidate.sourceHash !== sourceHash)
        return response(
          request,
          "policy_violation",
          ["trusted source hash mismatch"],
          evaluatorHash,
          environmentHash,
          limits,
        );
      if (request.candidate.patchHash !== hash(`${region}\n${mutationAllowlist.join("\n")}`))
        return response(
          request,
          "policy_violation",
          ["mutation allowlist or evolution region mismatch"],
          evaluatorHash,
          environmentHash,
          limits,
        );
      const trial = await createWorkspace(undefined, "csm-autoresearch-trial-");
      try {
        await snapshotWorkspace(root, trial);
        const trialSource = resolve(trial, relative(root, source));
        const result = await executeCandidate({
          command: process.execPath,
          args: [
            "--input-type=module",
            "-e",
            "const m=await import(process.argv[1]); const v=await m.default(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(v));",
            trialSource,
            JSON.stringify(request.input),
          ],
          cwd: trial,
          env,
          envAllowlist,
          timeoutMs: limits.timeoutMs,
          maxOutputBytes: limits.maxOutputBytes,
          maxWorkspaceBytes: limits.maxWorkspaceBytes,
          workspace: trial,
        });
        if (result.status !== "ok")
          return response(
            request,
            result.status,
            result.diagnostics,
            evaluatorHash,
            environmentHash,
            limits,
          );
        try {
          const metrics = JSON.parse(result.stdout);
          if (
            !metrics ||
            typeof metrics !== "object" ||
            Array.isArray(metrics) ||
            Object.values(metrics).some(
              (value) => typeof value !== "number" || !Number.isFinite(value),
            )
          )
            throw new Error("invalid metrics");
          return response(request, "ok", [], evaluatorHash, environmentHash, limits, metrics);
        } catch {
          return response(
            request,
            "invalid",
            ["trusted source returned invalid metrics"],
            evaluatorHash,
            environmentHash,
            limits,
          );
        }
      } finally {
        try {
          await cleanupWorkspace(trial);
        } catch {
          /* executeCandidate performs and verifies normal cleanup */
        }
      }
    },
  });
}

export { createTrustedLocalProvider, hash, safeRelative };
