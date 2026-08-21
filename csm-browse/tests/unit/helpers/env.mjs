import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// MUST be called before any csm-browse lib module is imported: constants.mjs
// reads CSM_BROWSE_SESSIONS_ROOT once at module load and freezes SESSIONS_ROOT.
// Test files therefore set the env first, then use a dynamic `await import()`.
export async function freshSessionsRoot(prefix = "csm-browse-unit-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  process.env.CSM_BROWSE_SESSIONS_ROOT = root;
  return root;
}

export async function removeRoot(root) {
  await rm(root, { recursive: true, force: true });
}

export async function backage(path, ageMs = 30 * 60 * 1000) {
  const t = new Date(Date.now() - ageMs);
  await utimes(path, t, t);
}

// Patches process.kill so only the pids in `alive` resolve; every other pid
// throws ESRCH (dead). Records all signals for assertions. Returns a restore fn.
export function patchKill(alive = new Set()) {
  const orig = process.kill.bind(process);
  const signals = [];
  process.kill = (pid, sig) => {
    signals.push([pid, sig]);
    if (!alive.has(pid)) {
      const e = new Error(`kill ESRCH ${pid}`);
      e.code = "ESRCH";
      throw e;
    }
    return true;
  };
  return () => {
    process.kill = orig;
    return signals;
  };
}
