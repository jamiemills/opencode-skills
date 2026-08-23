"use strict";

import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GIT_LIMITS = Object.freeze({
  maxCommits: 500,
  maxLogBytes: 4 * 1024 * 1024,
  timeoutMs: 10_000,
  maxCoChangePairs: 50,
});

function gitEnv() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

export class GitUnavailableError extends Error {
  constructor(cause) {
    super("git unavailable or target is not a git repository");
    this.name = "GitUnavailableError";
    this.cause = cause;
  }
}

async function runGit(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["--no-pager", "-C", root, ...args], {
      shell: false,
      timeout: GIT_LIMITS.timeoutMs,
      maxBuffer: GIT_LIMITS.maxLogBytes,
      env: gitEnv(),
    });
    return stdout;
  } catch (error) {
    throw new GitUnavailableError(error);
  }
}

export async function isGitRepository(root) {
  try {
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function headCommit(root) {
  const out = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  return out.length > 0 ? out : null;
}

export async function commitCount(root) {
  const out = await runGit(root, ["rev-list", "--count", "HEAD"]);
  return Number(out.trim());
}

export async function authorshipSummary(root) {
  const log = await runGit(root, ["log", `-n`, `${GIT_LIMITS.maxCommits}`, "--pretty=format:%an"]);
  const names = log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const total = names.length;
  let topShare = 0;
  for (const count of counts.values()) topShare = Math.max(topShare, count / Math.max(total, 1));
  return {
    commits: total,
    authors: counts.size,
    topAuthorCommitShare: Number(topShare.toFixed(2)),
  };
}

export async function coChangePairs(root) {
  const log = await runGit(root, [
    "log",
    `-n`,
    `${GIT_LIMITS.maxCommits}`,
    "--name-only",
    "--pretty=format:@@COMMIT@@",
  ]);
  const pairs = new Map();
  let current = [];
  for (const line of log.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "@@COMMIT@@") {
      emitPairs(current, pairs);
      current = [];
      continue;
    }
    if (trimmed.length > 0 && !trimmed.startsWith("@@")) current.push(trimmed);
  }
  emitPairs(current, pairs);
  return [...pairs.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split("\u0000");
      return { a, b, count };
    })
    .toSorted((x, y) => y.count - x.count)
    .slice(0, GIT_LIMITS.maxCoChangePairs);
}

function emitPairs(files, pairs) {
  const unique = [...new Set(files)].toSorted();
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const key = `${unique[i]}\u0000${unique[j]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
}
