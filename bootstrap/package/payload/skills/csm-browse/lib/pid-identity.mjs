import { readFile, unlink } from "node:fs/promises";
import { readDurableJson, writeDurableJson } from "../../../lib/durable-json/index.mjs";

// F-012: creator identity for lock/pid artifacts. A recycled PID owned by an
// unrelated process must never pass a liveness probe. Identity is the
// recorded /proc starttime (field 22) — unique to one process lifetime, so a
// recycled PID always mismatches. Artifacts without a sidecar (legacy) keep
// the old kill(pid, 0)-only semantics.

async function procStartTime(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // comm may contain spaces/parens; fields restart after the last ')'.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterComm[19]; // field 22 (starttime) minus the 3 skipped head fields
  } catch {
    return null;
  }
}

export async function currentIdentity() {
  return { pid: process.pid, starttime: await procStartTime(process.pid) };
}

export async function writeCreatorArtifact(artifactPath) {
  await writeDurableJson(`${artifactPath}.creator`, await currentIdentity(), { mode: 0o600 });
}

export async function clearCreatorArtifact(artifactPath) {
  try {
    await unlink(`${artifactPath}.creator`);
  } catch {}
}

// Returns true when the holder at `pid` should be considered ALIVE. A missing
// or unreadable sidecar preserves legacy behavior; a mismatched starttime
// proves the original holder is gone even though the PID was recycled.
export async function holderIdentityMatches(artifactPath, pid) {
  let identity;
  try {
    identity = await readDurableJson(`${artifactPath}.creator`);
  } catch {
    return true;
  }
  if (!identity || typeof identity.pid !== "number" || typeof identity.starttime !== "string") {
    return true;
  }
  if (identity.pid !== pid) return true; // sidecar belongs to a different claim cycle
  const now = await procStartTime(pid);
  return now === null || now === identity.starttime;
}
