"use strict";

// N4 / T002: CLI-level thin-worker driver acceptance. The driver exposes the
// opt-in thin child-side worker seam (--thin-worker-handler / --thin-worker-skills)
// and must gate it on CSM_AGENT_SESSION_EXEC=1 through resolveThinWorkerAdapter:
//   (a) gate on  -> the approach run dispatches the declared skill through
//                   scripts/run-worker.mjs -> the handler module (written marker)
//                   and the driver persists a terminal receipt for the run;
//   (b) gate off -> the flag is ignored, the default csm-build-owned handoff
//                   stays in place, and the route blocks with
//                   agent-session-required.
// The handler module runs in a child process, so all assertions are pinned to
// the marker it writes and the persisted receipt/telemetry, never to the
// parent's in-memory state.
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import "./helpers/trace-isolation.mjs";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const evidenceRoot = join(repoRoot, ".agents", "evidence", "orchestrator");
const digestModule = pathToFileURL(
  fileURLToPath(new URL("../lib/schema-runtime/index.mjs", import.meta.url)),
).href;

// The durable sqlite store the driver requires needs Node >= 22.13; resolve the
// repo's node22 shim so the test passes under any ambient node.
const NODE22 = spawnSync(
  process.execPath,
  [join(repoRoot, "scripts", "with-node22.mjs"), "--print"],
  { encoding: "utf8" },
);
if (NODE22.status !== 0) throw new Error("with-node22 could not resolve a node >= 22 binary");
const driverNode = NODE22.stdout.trim();

// csm-review-python is csm-build-owned (so the thin seam can register it) and
// read-only, so the default autonomy policy auto-approves it without an
// external --approvals module.
const THIN_SKILL = "csm-review-python";

const approachFor = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "thin-worker-driver",
  signals: { capabilities: [THIN_SKILL] },
  phases: [
    {
      phaseId: "P1",
      title: "Deliver",
      goal: "produce the deliverable",
      deliverables: ["typed result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["technical pass", "functional pass"],
      context: [],
      dependencies: [],
    },
  ],
});

// Host is required for the approach path but must never be invoked: skill-first
// dispatch is enforced (no --allow-host-dispatch), so a host call is a failure.
const NOOP_HOST = `
"use strict";
export default function host() {
  return {
    async invokeSiblingSkill() {
      throw new Error("host dispatch must not run when skill-first routing is enforced");
    },
  };
}
`;

// A minimal but valid child result: the receipt identity/digest must match the
// orchestrator's child context, otherwise the parent refuses the dispatch.
const handlerSource = (marker) => `
"use strict";
import { writeFileSync } from "node:fs";
import { digest } from ${JSON.stringify(digestModule)};
export async function execute(invocation) {
  writeFileSync(
    ${JSON.stringify(marker)},
    JSON.stringify({ skill: invocation.skill, childRunId: invocation.childRunId, attempt: invocation.attempt }) + "\\n",
  );
  const body = {
    schema: "csm-orchestrate-child-receipt/1",
    receiptId: "receipt-thin-worker-driver",
    runId: invocation.childRunId,
    owner: invocation.skill,
    attempt: invocation.attempt,
    status: "completed",
  };
  return {
    status: "completed",
    effects: [],
    artifacts: [],
    receipt: { ...body, digest: digest(body) },
    failure: null,
  };
}
`;

const GATE_ENV_KEYS = ["CSM_AGENT_SESSION_EXEC", "CSM_AGENT_SESSION_APPROVED"];

// A fresh env without leaked gate keys so each invocation is hermetic against a
// parent process that already set the seam env.
function driverEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of GATE_ENV_KEYS) delete env[key];
  return { ...env, ...overrides };
}

async function driverArgs(sandbox, runId, marker) {
  const approachPath = join(sandbox, "approach.json");
  const hostPath = join(sandbox, "host.mjs");
  const handlerPath = join(sandbox, "handler.mjs");
  await writeFile(approachPath, `${JSON.stringify(approachFor(runId), null, 2)}\n`);
  await writeFile(hostPath, NOOP_HOST);
  await writeFile(handlerPath, handlerSource(marker));
  return [
    driverPath,
    "--approach",
    approachPath,
    "--host",
    hostPath,
    "--thin-worker-handler",
    handlerPath,
    "--thin-worker-skills",
    THIN_SKILL,
  ];
}

async function runDriver(args, env) {
  return exec(driverNode, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 90_000,
    env: driverEnv(env),
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message),
    }),
  );
}

test("gate on: the driver dispatches the approach through the thin worker and persists a receipt", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "thin-worker-driver-on-"));
  const runId = `run-thin-worker-driver-on-${process.pid}-${Date.now()}`;
  const marker = join(sandbox, "thin-worker.marker");
  try {
    const { code, stdout, stderr } = await runDriver(await driverArgs(sandbox, runId, marker), {
      CSM_AGENT_SESSION_EXEC: "1",
    });
    assert.equal(code, 0, `driver must exit 0: ${stderr}`);
    assert.match(stdout, /status: /, "the driver must report a terminal status");

    // (a) The thin worker ran: run-worker.mjs invoked the handler module, which
    // wrote the marker with the dispatched skill before returning the child
    // result.
    assert.equal(existsSync(marker), true, "the thin worker handler must have run");
    const observed = JSON.parse(await readFile(marker, "utf8"));
    assert.equal(observed.skill, THIN_SKILL);
    assert.match(observed.childRunId, /^run-/);
    assert.equal(typeof observed.attempt, "number");

    // The parent persisted a terminal receipt for the run and did not fall back
    // to the host or the blocked agent-session handoff.
    const receipt = JSON.parse(await readFile(join(evidenceRoot, runId, "receipt.json"), "utf8"));
    assert.equal(receipt.runId, runId);
    assert.notEqual(receipt.outcome.status, "BLOCKED");
    assert.notEqual(receipt.outcome.status, "FAILED");

    // Telemetry records the dispatch of the thin-worker skill.
    const telemetry = await readFile(join(evidenceRoot, runId, "telemetry.jsonl"), "utf8");
    const dispatch = telemetry
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.eventType === "dispatch");
    assert.ok(dispatch.length >= 1, "the run must emit a dispatch event");
    assert.ok(
      dispatch.some((event) => JSON.stringify(event).includes(THIN_SKILL)),
      "the dispatch event must name the thin-worker skill",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(join(evidenceRoot, runId), { recursive: true, force: true });
  }
});

test("gate off: the thin-worker flag is ignored and the route blocks with agent-session-required", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "thin-worker-driver-off-"));
  const runId = `run-thin-worker-driver-off-${process.pid}-${Date.now()}`;
  const marker = join(sandbox, "thin-worker.marker");
  try {
    const { stdout, stderr } = await runDriver(await driverArgs(sandbox, runId, marker));
    assert.doesNotMatch(
      stdout,
      /status: VERIFIED/,
      "gate-off must never run as if the thin worker succeeded",
    );
    assert.match(
      `${stdout}${stderr}`,
      /agent-session-required/,
      "the csm-build-owned route must surface the blocked agent-session-required result",
    );
    assert.match(
      stdout,
      /reason: agent-session-required/,
      "the driver must report the blocked route reason",
    );
    assert.equal(
      existsSync(marker),
      false,
      "the thin worker handler must not run when CSM_AGENT_SESSION_EXEC is unset",
    );

    const receipt = JSON.parse(await readFile(join(evidenceRoot, runId, "receipt.json"), "utf8"));
    assert.equal(receipt.outcome.status, "BLOCKED");
    assert.equal(receipt.statuses.route, "blocked");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(join(evidenceRoot, runId), { recursive: true, force: true });
  }
});
