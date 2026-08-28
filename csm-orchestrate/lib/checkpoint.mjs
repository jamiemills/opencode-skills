import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|apiKey|authorization/i;
const REDACTED = "[REDACTED]";

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function splitZ(output) {
  return output.split("\0").filter((entry) => entry !== "");
}

function parseStatus(output) {
  const modified = [];
  const staged = [];
  const untracked = [];
  const entries = splitZ(output);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const indexStatus = entry.charAt(0);
    const worktreeStatus = entry.charAt(1);
    const filePath = entry.slice(3);
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      worktreeStatus === "R" ||
      worktreeStatus === "C"
    ) {
      i += 1;
    }
    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked.push(filePath);
      continue;
    }
    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push(filePath);
    }
    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      modified.push(filePath);
    }
  }
  return { modified, staged, untracked };
}

function samePaths(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  const known = new Set(b);
  return a.every((item) => known.has(item));
}

export async function preAutonomyRun(runId, cwd) {
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const branchOutput = (await git(cwd, ["branch", "--show-current"])).trim();
  const branch = branchOutput === "" ? "detached" : branchOutput;
  const { modified, staged, untracked } = parseStatus(
    await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
  const ignored = splitZ(
    await git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]),
  );
  const wasDirty = modified.length > 0 || staged.length > 0 || untracked.length > 0;
  const createdAt = new Date().toISOString();
  if (!wasDirty) {
    return { checkpointDir: null, head, branch, manifest: null, wasDirty: false, createdAt };
  }
  const checkpointDir = await fsp.mkdtemp(path.join(os.tmpdir(), "csm-checkpoint-"), {
    mode: 0o700,
  });
  const trackedPatch = await git(cwd, ["diff", "--binary"]);
  const stagedPatch = await git(cwd, ["diff", "--cached", "--binary"]);
  await fsp.writeFile(path.join(checkpointDir, "tracked.patch"), trackedPatch, "utf8");
  await fsp.writeFile(path.join(checkpointDir, "staged.patch"), stagedPatch, "utf8");
  for (const relativePath of untracked) {
    const source = path.join(cwd, relativePath);
    const destination = path.join(checkpointDir, "untracked", relativePath);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
  const manifest = { head, branch, modified, staged, untracked, ignored, createdAt };
  await fsp.writeFile(
    path.join(checkpointDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return {
    checkpointDir,
    head,
    branch,
    manifest: { modified, staged, untracked, ignored },
    wasDirty: true,
    createdAt,
  };
}

export async function rollbackToCheckpoint(checkpoint, cwd) {
  await git(cwd, ["reset", "--hard", checkpoint.head]);
  await git(cwd, ["clean", "-fd"]);
  const checkpointDir = checkpoint.checkpointDir;
  if (checkpointDir) {
    const trackedPatchPath = path.join(checkpointDir, "tracked.patch");
    const stagedPatchPath = path.join(checkpointDir, "staged.patch");
    const trackedPatch = await fsp.readFile(trackedPatchPath, "utf8");
    const stagedPatch = await fsp.readFile(stagedPatchPath, "utf8");
    if (stagedPatch.trim() !== "") {
      await git(cwd, ["apply", "--index", stagedPatchPath]);
    }
    if (trackedPatch.trim() !== "") {
      await git(cwd, ["apply", trackedPatchPath]);
    }
    for (const relativePath of checkpoint.manifest.untracked) {
      const source = path.join(checkpointDir, "untracked", relativePath);
      const destination = path.join(cwd, relativePath);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      try {
        await fsp.copyFile(source, destination);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  const current = parseStatus(
    await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
  const expected = checkpoint.manifest ?? { modified: [], staged: [], untracked: [] };
  const verified =
    samePaths(current.modified, expected.modified) &&
    samePaths(current.staged, expected.staged) &&
    samePaths(current.untracked, expected.untracked);
  if (!verified) {
    return { restored: false, reason: "verification-mismatch" };
  }
  if (checkpointDir) {
    await fsp.rm(checkpointDir, { recursive: true, force: true });
  }
  return { restored: true };
}

export function stripSecretsFromContext(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretsFromContext(item));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : stripSecretsFromContext(child);
    }
    return out;
  }
  return value;
}
