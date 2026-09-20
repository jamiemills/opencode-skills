"use strict";
// Dependency-free repo identity helpers: resolve the git *common* directory so
// that every linked worktree of a repository shares one trace log and one state
// directory. The common dir is resolved with `--path-format=absolute` while
// spawning git with `cwd: root`, so the result is absolute and independent of
// the caller's process.cwd(). When git is unavailable or root is not a repo, a
// deterministic per-repo fallback under $XDG_STATE_HOME (or ~/.local/state) is
// used instead. Never path.resolve() possibly-relative git output.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const GIT_COMMON_DIR_ARGS = ["rev-parse", "--path-format=absolute", "--git-common-dir"];

function sha256hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fallbackStateHome() {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
}

function fallbackCommonDir(root) {
  return join(fallbackStateHome(), "csm-repos", sha256hex(realpathSync(root)));
}

export function repoCommonDir(root = process.cwd()) {
  const result = spawnSync("git", GIT_COMMON_DIR_ARGS, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return fallbackCommonDir(root);
  const output = (result.stdout ?? "").trim();
  if (output.length === 0 || !isAbsolute(output)) return fallbackCommonDir(root);
  return output;
}

export function repoLogPath(root = process.cwd()) {
  return join(repoCommonDir(root), "csm", "logs", "trace.jsonl");
}

export function repoStateDir(root = process.cwd()) {
  return join(repoCommonDir(root), "csm", "state");
}
