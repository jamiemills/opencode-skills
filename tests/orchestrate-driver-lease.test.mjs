"use strict";

// S1: realMode run lease (.run-lock) contract. Spawns the real driver and
// asserts the lease races, takeover rules, and release lifecycle. Evidence
// dirs live under .agents/evidence/orchestrator/<runId> (gitignored).
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const evidenceRoot = join(repoRoot, ".agents", "evidence", "orchestrator");
const LEASE = ".run-lock";

// The durable sqlite store requires Node >= 22.13; the driver must run under
// the repo's node22 shim when the ambient node is older.
const NODE22 = spawnSync(
  process.execPath,
  [join(repoRoot, "scripts", "with-node22.mjs"), "--print"],
  { encoding: "utf8" },
);
if (NODE22.status !== 0) throw new Error("with-node22 could not resolve a node >= 22 binary");
const driverNode = NODE22.stdout.trim();

function uniqueRunId(tag) {
  return `run-driver-lease-${tag}-${process.pid}-${Date.now()}`;
}

function runDriver(args) {
  return exec(driverNode, [driverPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 90_000,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message),
    }),
  );
}

async function writeFixture(runId, { hostSleepMs = 4000 } = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-lease-"));
  const approachPath = join(sandbox, "approach.json");
  await writeFile(
    approachPath,
    JSON.stringify({
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId,
      ideaSlug: "driver-lease",
      signals: { capabilities: [], inputs: [] },
      phases: [],
    }) + "\n",
  );
  const hostPath = join(sandbox, "host.mjs");
  // The host factory is the deterministic post-lease failure point: it sleeps
  // (holding the lease long enough for a concurrent spawn to observe it), then
  // throws. Empty-phase approaches otherwise reach the final telemetry drain
  // with a never-created telemetry.jsonl and fail there instead.
  await writeFile(
    hostPath,
    `export default async () => {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ${hostSleepMs}));
  throw new Error("host-load-exploded");
};
`,
  );
  return { sandbox, approachPath, hostPath };
}

async function waitForLease(runId, { timeoutMs = 20_000 } = {}) {
  const lockPath = join(evidenceRoot, runId, LEASE);
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(lockPath)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for lease ${lockPath}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return lockPath;
}

async function cleanupEvidence(runIds) {
  for (const runId of runIds) await rm(join(evidenceRoot, runId), { recursive: true, force: true });
}

test("(i) two concurrent fresh driver starts: exactly one claims the lease, the other fails fast", async () => {
  const runId = uniqueRunId("race");
  const { sandbox, approachPath, hostPath } = await writeFixture(runId);
  const lockPath = join(evidenceRoot, runId, LEASE);
  try {
    const first = runDriver(["--approach", approachPath, "--host", hostPath]);
    await waitForLease(runId);
    const relativeLock = join(".agents", "evidence", "orchestrator", runId, LEASE);
    const second = await runDriver(["--approach", approachPath, "--host", hostPath]);
    assert.notEqual(second.code, 0, "second driver must fail while the first holds the lease");
    assert.match(second.stderr, /already active/);
    assert.match(
      second.stderr,
      new RegExp(relativeLock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "lease message names the lock path",
    );
    assert.doesNotMatch(second.stderr, /host-load-exploded/, "loser never loaded the host");
    const firstResult = await first;
    assert.notEqual(firstResult.code, 0, "winner ends at the host-load failure");
    assert.match(firstResult.stderr, /host-load-exploded/);
    assert.doesNotMatch(firstResult.stderr, /already active/, "winner was not lease-blocked");
    assert.ok(
      !existsSync(lockPath),
      "lease released by the winner after its run ended (every path incl. errors)",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});

test("(ii) stale lease (dead owner): fails fast without --resume; --resume takes over and proceeds", async () => {
  const runId = uniqueRunId("stale");
  const { sandbox, approachPath, hostPath } = await writeFixture(runId);
  const evidenceDir = join(evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const lockPath = join(evidenceDir, LEASE);
  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({
        format: "csm-run-lock/1",
        kind: "run",
        token: "deadbeef",
        pid: 999999,
        runId,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    const blocked = await runDriver(["--approach", approachPath, "--host", hostPath]);
    assert.notEqual(blocked.code, 0, "stale lease without --resume must fail fast");
    assert.match(blocked.stderr, /stale lease/);
    assert.match(blocked.stderr, /999999/);
    const resumed = await runDriver(["--approach", approachPath, "--host", hostPath, "--resume"]);
    assert.notEqual(resumed.code, 0, "winner ends at the host-load failure");
    assert.match(resumed.stderr, /removed stale run lease/);
    assert.match(resumed.stderr, /host-load-exploded/, "takeover run proceeded past the lease");
    assert.doesNotMatch(resumed.stderr, /already active|stale lease/);
    assert.ok(!existsSync(lockPath), "lease released after takeover run");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});

test("(iii) live owner + --resume fails with the active-run message", async () => {
  const runId = uniqueRunId("live");
  const { sandbox, approachPath, hostPath } = await writeFixture(runId);
  const evidenceDir = join(evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const lockPath = join(evidenceDir, LEASE);
  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({
        format: "csm-run-lock/1",
        kind: "run",
        token: "live-owner",
        pid: process.pid,
        runId,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    const r = await runDriver(["--approach", approachPath, "--host", hostPath, "--resume"]);
    assert.notEqual(r.code, 0, "live owner must refuse a --resume takeover");
    assert.match(r.stderr, /already active/);
    assert.match(r.stderr, new RegExp(String(process.pid)));
    assert.ok(existsSync(lockPath), "live owner's lease untouched");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});

test("(iv) existing cursor.db without --resume keeps the honest-failure message before any lease", async () => {
  const runId = uniqueRunId("durable");
  const { sandbox, approachPath, hostPath } = await writeFixture(runId);
  const evidenceDir = join(evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "cursor.db"), "not-a-real-db");
  try {
    const r = await runDriver(["--approach", approachPath, "--host", hostPath]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /already has durable state; pass --resume/);
    assert.doesNotMatch(r.stderr, /already active/, "honest-failure guard precedes the lease");
    assert.ok(
      !existsSync(join(evidenceDir, LEASE)),
      "no lease is created when the honest-failure guard fires first",
    );
    await rm(join(evidenceDir, "cursor.db"), { force: true });
    const resumed = await runDriver(["--approach", approachPath, "--host", hostPath, "--resume"]);
    assert.notEqual(resumed.code, 0, "winner ends at the host-load failure");
    assert.match(resumed.stderr, /host-load-exploded/, "resumed run proceeded past the lease");
    assert.doesNotMatch(resumed.stderr, /already active/);
    assert.ok(!existsSync(join(evidenceDir, LEASE)), "lease released after resumed run");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await cleanupEvidence([runId]);
  }
});
