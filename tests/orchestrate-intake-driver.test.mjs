"use strict";

// T004 verification: scripts/run-orchestrator.mjs routes --approach/--plan/
// --request inputs through csm-orchestrate/lib/intake.mjs (intakeArtifact) and
// branches on the intake kind. The approach path is byte-for-byte parity
// (runId === approach.runId, --host required, lease guards) while plan/request
// kinds take the deterministic pre-executor bypass: classifyRequest runs up
// front and the driver exits non-zero with the blocked agent-session-required
// result (parity with the default csm-build handoff) until a skill executor
// route exists (T005/T006). Non-canonical runIds fail intake.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const PARALLELISM_PLAN_URL = new URL(
  "../.agents/plans/2026-09-06-parallelism-conflict-free-change-set-csm.json",
  import.meta.url,
);

// The durable sqlite store requires Node >= 22.13; the driver must run under
// the repo's node22 shim when the ambient node is older.
const NODE22 = spawnSync(
  process.execPath,
  [join(repoRoot, "scripts", "with-node22.mjs"), "--print"],
  { encoding: "utf8" },
);
if (NODE22.status !== 0) throw new Error("with-node22 could not resolve a node >= 22 binary");
const driverNode = NODE22.stdout.trim();

const BLOCKED = /requires an agent session running its SKILL\.md lifecycle/;
const BLOCKED_TAIL = /Direct function dispatch is not available for instruction-led skills/;

async function runDriver(args) {
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

const REQUEST_RESEARCH = {
  schema: "csm-orchestrate-request/1",
  schemaRevision: 1,
  requestId: "request-intake-driver-research",
  runId: "run-20260906t230626z-4f3a9b2c1d8e",
  kind: "research",
  prompt: "Research how to generalize request intake in csm-orchestrate.",
  goalSlug: "orchestrate-request-intake-router",
  artifactRef: null,
  repo: null,
};

test("(i) --plan intakes a csm-plan/1 envelope and exits blocked agent-session-required (csm-build route)", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "intake-driver-plan-"));
  try {
    const planPath = join(sandbox, "plan.json");
    const envelope = JSON.parse(await readFile(PARALLELISM_PLAN_URL, "utf8"));
    assert.equal(envelope.schema, "csm-plan/1");
    await writeFile(planPath, `${JSON.stringify(envelope, null, 2)}\n`);
    const { code, stderr } = await runDriver(["--plan", planPath]);
    assert.notEqual(code, 0, "plan route must exit non-zero pre-executor");
    assert.match(stderr, /csm-build requires an agent session running its SKILL\.md lifecycle/);
    assert.match(stderr, BLOCKED);
    assert.match(stderr, BLOCKED_TAIL);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("(ii) --request research-kind routes to csm-deep-research and exits blocked agent-session-required", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "intake-driver-request-"));
  try {
    const requestPath = join(sandbox, "request.json");
    await writeFile(requestPath, `${JSON.stringify(REQUEST_RESEARCH, null, 2)}\n`);
    const { code, stderr } = await runDriver(["--request", requestPath]);
    assert.notEqual(code, 0, "request route must exit non-zero pre-executor");
    assert.match(
      stderr,
      /csm-deep-research requires an agent session running its SKILL\.md lifecycle/,
    );
    assert.match(stderr, BLOCKED_TAIL);
    assert.doesNotMatch(stderr, /--host/, "request path never requires --host");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("(iii) --request with a non-canonical runId fails intake with exit non-zero", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "intake-driver-runid-"));
  try {
    const requestPath = join(sandbox, "request.json");
    await writeFile(
      requestPath,
      `${JSON.stringify({ ...REQUEST_RESEARCH, runId: "not-a-canonical-run" }, null, 2)}\n`,
    );
    const { code, stderr } = await runDriver(["--request", requestPath]);
    assert.notEqual(code, 0);
    assert.match(stderr, /intake: runId "not-a-canonical-run" must match \^run-/);
    assert.doesNotMatch(stderr, BLOCKED, "intake failure precedes any classification");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("(iv) --approach with a valid approach fixture keeps the approach path (host-required without --host)", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "intake-driver-approach-"));
  try {
    const approachPath = join(sandbox, "approach.json");
    await writeFile(
      approachPath,
      `${JSON.stringify(
        {
          schema: "csm-approach/1",
          schemaRevision: 1,
          status: "agreed",
          runId: "run-intake-driver-approach",
          ideaSlug: "intake-driver",
          signals: { capabilities: ["csm-scan"] },
          phases: [],
        },
        null,
        2,
      )}\n`,
    );
    const { code, stderr } = await runDriver(["--approach", approachPath]);
    assert.notEqual(code, 0);
    assert.match(stderr, /real runs require --host/);
    assert.doesNotMatch(stderr, BLOCKED, "approach path never blocks on agent session");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
