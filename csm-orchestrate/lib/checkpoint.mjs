import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|apiKey|authorization/i;
const REDACTED = "[REDACTED]";

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

export async function preAutonomyRun(runId, cwd) {
  const status = await git(cwd, ["status", "--porcelain"]);
  if (status.length === 0) {
    return { checkpointRef: null, wasDirty: false };
  }
  await git(cwd, ["stash", "push", "-m", `pre-autonomy-${runId}`]);
  return { checkpointRef: "stash@{0}", wasDirty: true };
}

export async function rollbackToCheckpoint(cwd) {
  await git(cwd, ["stash", "pop"]);
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
