"use strict";

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { cleanupWorkspace, createWorkspace, executeCandidate } from "../runtime/index.mjs";
import { validateRequest, validateResponse } from "../protocol/index.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN = /^(?:evaluator|tests?|fixtures?|policy|credentials?)$/i;
const BUILTIN = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "process",
  "stream",
  "url",
  "util",
]);
const IMPORT =
  /(?:\bimport\s*(?:[^"']*?\sfrom\s*)?|\bexport\s+[^"']*?\sfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const DEFAULT_MAX_WORKSPACE_BYTES = 10 * 1024 * 1024;

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
async function copyAllowlistedPath(source, destination, root, label, state) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new TypeError(`${label} symlink is not allowed`);
  if (!inside(root, resolve(source)))
    throw new TypeError(`${label} is outside the trusted workspace`);
  if (info.isDirectory()) {
    await mkdir(destination, { mode: 0o700 });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      safeRelative(relative(root, resolve(source, entry.name)), label);
      await copyAllowlistedPath(
        resolve(source, entry.name),
        resolve(destination, entry.name),
        root,
        label,
        state,
      );
    }
    return;
  }
  if (!info.isFile()) throw new TypeError(`${label} must contain regular files only`);
  const bytes = await readFile(source);
  state.bytes += bytes.length;
  if (state.bytes > state.maxBytes) throw new RangeError("workspace snapshot exceeds byte limit");
  await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
}
function declaredPath(path, allowlist, root) {
  return allowlist.some((entry) => {
    const base = resolve(root, entry);
    return path === base || inside(base, path);
  });
}
async function validateImports(files, dependencyAllowlist, root) {
  for (const file of files) {
    const source = (await readFile(file)).toString("utf8");
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1];
      if (BUILTIN.has(specifier) || specifier.startsWith("node:")) continue;
      if (!specifier.startsWith("."))
        throw new TypeError(`undeclared workspace dependency: ${specifier}`);
      const imported = resolve(file, "..", specifier);
      if (!inside(root, imported) || !declaredPath(imported, dependencyAllowlist, root))
        throw new TypeError(`undeclared workspace dependency: ${specifier}`);
    }
  }
}
async function regularFiles(path) {
  const info = await lstat(path);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) throw new TypeError("dependency must contain regular files only");
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true }))
    files.push(...(await regularFiles(resolve(path, entry.name))));
  return files;
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
    provenance: {
      evaluatorHash,
      environmentHash,
      limits: { ...limits, trust: "trusted-process-no-os-isolation" },
      redacted: true,
    },
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
  dependencyAllowlist,
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
  if (!Array.isArray(dependencyAllowlist))
    throw new TypeError("explicit dependency allowlist is required");
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
  const dependencies = [];
  for (const dependency of dependencyAllowlist) {
    const relativePath = safeRelative(dependency, "dependency path");
    const dependencyPath = await noSymlink(resolve(root, relativePath), "dependency path");
    if (!inside(root, dependencyPath))
      throw new TypeError("dependency is outside the trusted workspace");
    dependencies.push(relativePath);
  }
  for (const path of mutationAllowlist) {
    const relativePath = safeRelative(path, "mutation path");
    if (!inside(root, resolve(root, relativePath)))
      throw new TypeError("mutation path is outside the trusted workspace");
    await noSymlink(resolve(root, relativePath), "mutation path", { mustExist: false });
  }
  if (!inside(root, resolve(root, region)))
    throw new TypeError("evolution region is outside the trusted workspace");
  const snapshotFiles = [source, ...dependencies.map((path) => resolve(root, path))];
  await validateImports(
    (await Promise.all(snapshotFiles.map((path) => regularFiles(path)))).flat(),
    dependencies,
    root,
  );
  return Object.freeze({
    mode: "trusted-local",
    trust: "trusted-process-no-os-isolation",
    approval: approved,
    sourceHash,
    evolutionRegion: region,
    mutationAllowlist: [...mutationAllowlist],
    dependencyAllowlist: [...dependencies],
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
        const snapshotPaths = [relative(root, source), ...dependencies, ...mutationAllowlist];
        const state = {
          bytes: 0,
          maxBytes: limits.maxWorkspaceBytes ?? DEFAULT_MAX_WORKSPACE_BYTES,
        };
        const copied = new Set();
        try {
          for (const path of snapshotPaths) {
            const relativePath = safeRelative(path, "snapshot path");
            if (
              [...copied].some(
                (existing) =>
                  relativePath === existing || relativePath.startsWith(`${existing}${sep}`),
              )
            )
              continue;
            copied.add(relativePath);
            const snapshotPath = resolve(root, relativePath);
            try {
              await noSymlink(snapshotPath, "snapshot path");
            } catch (error) {
              if (error.code === "ENOENT" && mutationAllowlist.includes(relativePath)) continue;
              throw error;
            }
            await copyAllowlistedPath(
              snapshotPath,
              resolve(trial, relativePath),
              root,
              "snapshot path",
              state,
            );
          }
        } catch (error) {
          return response(
            request,
            error instanceof RangeError ? "resource_exhausted" : "policy_violation",
            [error.message],
            evaluatorHash,
            environmentHash,
            limits,
          );
        }
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
