"use strict";
// Dependency-free repo identity helpers: resolve the git *common* directory so
// that every linked worktree of a repository shares one trace log and one state
// directory, and resolve the *main* worktree root so the shared trace log and
// its default location are worktree-independent. The common dir is resolved
// with `--path-format=absolute` while spawning git with `cwd: root`, so the
// result is absolute and independent of the caller's process.cwd(). When git is
// unavailable or root is not a repo, a deterministic per-repo fallback under
// $XDG_STATE_HOME (or ~/.local/state) is used instead. Never path.resolve()
// possibly-relative git output.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

const GIT_COMMON_DIR_ARGS = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
const GIT_IS_BARE_ARGS = ["rev-parse", "--is-bare-repository"];
const GIT_WORKTREE_ARGS = ["worktree", "list", "--porcelain"];
const GIT_TOPLEVEL_ARGS = ["rev-parse", "--path-format=absolute", "--show-toplevel"];

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

// Run a git subcommand with cwd=root, returning trimmed stdout or null on
// failure (git missing, non-zero exit, or root not a repository).
function gitStdout(args, root) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? "").trim();
}

export function repoCommonDir(root = process.cwd()) {
  const output = gitStdout(GIT_COMMON_DIR_ARGS, root);
  if (output === null || output.length === 0 || !isAbsolute(output)) return fallbackCommonDir(root);
  return output;
}

// The MAIN worktree root: normally the first `worktree <path>` record of
// `git worktree list --porcelain`. The main worktree is listed first from any
// linked worktree, so this is worktree-independent (the default trace log and
// state home stay anchored to the main checkout, never the caller's worktree or
// a removed one). A bare repo has no main worktree, so its own bare/common dir
// is returned (traces live under the bare dir).
//
// A submodule is the exception: its first worktree record is the gitdir
// (`<superproject>/.git/modules/<name>`), NOT a real working tree. When that
// first record equals the common dir, is contained under it, or lives under a
// `.git/modules/` segment, we resolve the submodule's own working tree with
// `git rev-parse --show-toplevel` instead — so a submodule's default trace log
// is never written under any `.git` directory. Only when a verified non-bare
// repo's `worktree list` fails do we fall back to `dirname(commonDir)` if the
// common dir is a `.git` dir, else the per-repo fallback dir. Output is always
// absolute; possibly-relative git output is never path.resolve()d.
export function repoMainRoot(root = process.cwd()) {
  if (gitStdout(GIT_IS_BARE_ARGS, root) === "true") return repoCommonDir(root);

  const common = repoCommonDir(root);
  const listed = gitStdout(GIT_WORKTREE_ARGS, root);
  if (listed !== null) {
    for (const line of listed.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const candidate = line.slice("worktree ".length).trim();
      if (!isAbsolute(candidate)) break;
      const underCommon = candidate === common || candidate.startsWith(`${common}${sep}`);
      const underModules = candidate.includes(`${sep}.git${sep}modules${sep}`);
      if (underCommon || underModules) break;
      return candidate;
    }
    const toplevel = gitStdout(GIT_TOPLEVEL_ARGS, root);
    if (toplevel !== null && toplevel.length > 0 && isAbsolute(toplevel)) return toplevel;
  }

  if (basename(common) === ".git") return dirname(common);
  return fallbackCommonDir(root);
}

// True when a RELATIVE configured log path resolves to a location under
// `mainRoot`. `join` normalises `..`, so a clone-controlled project value like
// `../../evil.jsonl` would otherwise append outside the repo; resolve +
// containment is the one rule that keeps a relative configured path inside it.
export function relativeLogPathStaysUnderRoot(mainRoot, configured) {
  const resolved = resolve(mainRoot, configured);
  return resolved === mainRoot || resolved.startsWith(`${mainRoot}${sep}`);
}

// The shared trace log. An ABSOLUTE configured path wins and is honoured as-is
// (the operator/agent explicitly chose a location). A RELATIVE configured path
// is contained under the main worktree root; a value that would escape the repo
// (a `..` traversal) is refused and falls back to the in-repo default. With no
// (or empty) configuration the default is `<mainRoot>/.agents/logs/trace.jsonl`
// — at the repo root, deliberately NOT inside `.git` (the state registry stays
// under the common dir; see repoStateDir).
export function repoLogPath(root = process.cwd(), { configured } = {}) {
  const main = repoMainRoot(root);
  const fallback = join(main, ".agents", "logs", "trace.jsonl");
  if (typeof configured === "string" && configured.length > 0) {
    if (isAbsolute(configured)) return configured;
    if (relativeLogPathStaysUnderRoot(main, configured)) return resolve(main, configured);
    return fallback;
  }
  return fallback;
}

export function repoStateDir(root = process.cwd()) {
  return join(repoCommonDir(root), "csm", "state");
}
