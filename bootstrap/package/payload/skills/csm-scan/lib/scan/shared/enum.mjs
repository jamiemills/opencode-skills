import { statSync } from "node:fs";
import { join } from "node:path";
import { commandBroker } from "./command.mjs";
import { isIgnoredPath } from "./ignore.mjs";

function extOf(relPath) {
  const base = relPath.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot > 0) return base.slice(dot).toLowerCase();
  return "";
}

export function byExtension(files) {
  const counts = {};
  for (const f of files) {
    const ext = extOf(f);
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

export function sumSizes(repoPath, files) {
  let total = 0;
  for (const f of files) {
    try {
      total += statSync(join(repoPath, f)).size;
    } catch {}
  }
  return total;
}

const TRUNCATED_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

function splitLines(stdout) {
  return stdout
    .split("\n")
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .toSorted();
}

async function gitTrackedScope(repoPath, broker) {
  try {
    const result = await broker.execute("git:ls-files", { cwd: repoPath });
    if (!result.ok) return null;
    const files = splitLines(result.stdout);
    return Object.freeze({
      available: true,
      truncated: false,
      files,
      extCounts: byExtension(files),
      totalFiles: files.length,
    });
  } catch (error) {
    const truncated = error && error.code === TRUNCATED_CODE;
    return Object.freeze({
      available: false,
      truncated,
      files: [],
      extCounts: {},
      totalFiles: 0,
    });
  }
}

export async function enumerate(repoPath, broker = commandBroker) {
  const result = await broker.execute("rg:files", { cwd: repoPath });
  const raw = result.ok || result.noMatch ? result.stdout : "";

  const files = splitLines(raw).filter((f) => !isIgnoredPath(f));

  const extCounts = byExtension(files);
  const totalBytes = sumSizes(repoPath, files);
  const gitTracked = await gitTrackedScope(repoPath, broker);

  return {
    files,
    extCounts,
    totalFiles: files.length,
    totalBytes,
    gitTracked,
  };
}

// Bounded hidden/gitignored enumeration (F-018): `rg --files --hidden
// --no-ignore` lists dotfiles and gitignored files the survey enumeration
// prunes. The broker command's shared ignore globs exclude .git/node_modules
// and the other ignored directories; isIgnoredPath double-guards the result.
// Consumers apply their own file-count budget. Returns `{ files, failed }` so
// a failed pass (rg error, timeout, spawn failure) is distinguishable from
// "no hidden files" — never silently report an empty list as coverage.
export async function enumerateHiddenFiles(repoPath, broker = commandBroker) {
  try {
    const result = await broker.execute("rg:files-hidden", { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : "";
    const files = splitLines(raw).filter((f) => !isIgnoredPath(f));
    return Object.freeze({ files, failed: !(result.ok || result.noMatch) });
  } catch {
    return Object.freeze({ files: [], failed: true });
  }
}
