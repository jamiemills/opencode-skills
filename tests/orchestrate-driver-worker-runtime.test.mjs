"use strict";

// Final-gaps acceptance tests: the driver renders the worker table from real
// emitted events (T001), exposes --dynamic-proposal (T002), and accepts a
// --config maxParallelism envelope (T010).
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const approachFor = (runId) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "worker-runtime",
  signals: { capabilities: ["csm-scan"] },
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

const HOST_TEMPLATE = `
"use strict";
const DIGEST = "sha256:" + "a".repeat(64);
export default function hostFixture() {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const source = { path: "result-1.json", artifactId: "art-result-1", digest: DIGEST, schema: "csm-orchestrate-evidence/2", sourceRunId: request.childRunId };
      const descriptorBody = {
        schema: source.schema, evidenceId: "ev-driver-worker-1", kind: "acceptance", status: "current", owner: request.skill,
        runId: request.childRunId, requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0], validation: { signal: "fixture deliverable produced", status: "pass" }, source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: { receiptId: "receipt-driver-worker-1", schema: "csm-orchestrate-child-receipt/1", runId: request.childRunId, digest: DIGEST, owner: request.skill, status: "completed" },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item) return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return { status: "resolved", path, owner: expected.expectedOwner ?? item.owner, fileDigest: expected.expectedFileDigest ?? item.source.digest, value: item };
      },
    },
  };
}
`;

async function driverArgs(sandbox, runId, extra = []) {
  const approachPath = join(sandbox, "approach.json");
  const hostPath = join(sandbox, "host.mjs");
  await writeFile(approachPath, JSON.stringify(approachFor(runId), null, 2) + "\n");
  await writeFile(hostPath, HOST_TEMPLATE + "\n");
  return [
    join(repoRoot, "scripts", "run-orchestrator.mjs"),
    "--approach",
    approachPath,
    "--host",
    hostPath,
    "--final-review",
    join(repoRoot, "scripts", "independent-reviewer.mjs"),
    "--allow-host-dispatch",
    ...extra,
  ];
}

const WIDTH_SKILLS = [
  "csm-ddd",
  "csm-deep-research",
  "csm-review",
  "csm-review-python",
  "csm-scan",
];

const WIDTH_HOST_TEMPLATE = `
"use strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const DIGEST = "sha256:" + "a".repeat(64);
const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export default function widthHost({ skillProgressDir }) {
  const artifacts = new Map();
  let active = 0;
  let peak = 0;
  let count = 0;
  const outPath = join(skillProgressDir, "driver-width.json");
  const publish = () => writeFile(outPath, JSON.stringify({ peak, active, count }) + "\\n");
  return {
    async invokeSiblingSkill(request) {
      active += 1;
      count += 1;
      if (active > peak) peak = active;
      await publish();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
      active -= 1;
      await publish();
      const skill = slugify(request.skill);
      const evidenceId = "ev-width-" + skill;
      const source = { path: "result-" + skill + ".json", artifactId: "art-width-" + skill, digest: DIGEST, schema: "csm-orchestrate-evidence/2", sourceRunId: request.childRunId };
      const descriptorBody = {
        schema: source.schema, evidenceId, kind: "acceptance", status: "current", owner: request.skill,
        runId: request.childRunId, requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0], validation: { signal: "fixture deliverable produced", status: "pass" }, source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: { receiptId: "receipt-width-" + skill, schema: "csm-orchestrate-child-receipt/1", runId: request.childRunId, digest: DIGEST, owner: request.skill, status: "completed" },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item) return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return { status: "resolved", path, owner: expected.expectedOwner ?? item.owner, fileDigest: expected.expectedFileDigest ?? item.source.digest, value: item };
      },
    },
  };
}
`;

const WIDTH_APPROVALS = `
export default async function approvals({ phase, node, childRunId }) {
  return {
    schema: "csm-orchestrate-approval/2",
    approvalId: "approval-width-" + childRunId,
    binding: { parentRunId: phase.runId, childRunId, phaseId: phase.phaseId, edgeId: "edge-" + node.nodeId },
    scope: [...node.approvalScope],
    approvedDigest: node.capabilityDigest,
    approvedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2099-09-09T00:00:00.000Z",
    status: "approved",
  };
}
`;

async function widthDriverArgs(sandbox, runId, maxParallelism) {
  const approachPath = join(sandbox, "width-approach.json");
  const hostPath = join(sandbox, "width-host.mjs");
  const approvalsPath = join(sandbox, "width-approvals.mjs");
  const configPath = join(sandbox, "width-config.json");
  await writeFile(
    approachPath,
    JSON.stringify(
      { ...approachFor(runId), ideaSlug: "worker-width", signals: { capabilities: WIDTH_SKILLS } },
      null,
      2,
    ) + "\n",
  );
  await writeFile(hostPath, WIDTH_HOST_TEMPLATE + "\n");
  await writeFile(approvalsPath, WIDTH_APPROVALS + "\n");
  await writeFile(
    configPath,
    JSON.stringify({ skills: { "csm-orchestrate": { maxParallelism } } }) + "\n",
  );
  return [
    join(repoRoot, "scripts", "run-orchestrator.mjs"),
    "--approach",
    approachPath,
    "--host",
    hostPath,
    "--final-review",
    join(repoRoot, "scripts", "independent-reviewer.mjs"),
    "--allow-host-dispatch",
    "--approvals",
    approvalsPath,
    "--config",
    configPath,
  ];
}

function evidenceDirFor(runId) {
  return join(repoRoot, ".agents", "evidence", "orchestrator", runId);
}

async function readTelemetryEvents(evidenceDir) {
  const text = await readFile(join(evidenceDir, "telemetry.jsonl"), "utf8");
  assert.ok(text.endsWith("\n"), "telemetry.jsonl must not end in a torn line");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readTelemetrySequences(evidenceDir) {
  return (await readTelemetryEvents(evidenceDir)).map((event) => event.sequence);
}

function assertCleanOutput(label, text) {
  assert.doesNotMatch(
    text,
    /concurrent-replacement/i,
    `${label} must not surface a telemetry read race`,
  );
  assert.doesNotMatch(
    text,
    /UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/,
    `${label} must not surface an unhandled rejection`,
  );
}

test("the driver renders the worker table from real emitted events", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-driver-"));
  try {
    const runId = "run-worker-render-" + process.pid;
    const { stdout } = await exec(process.execPath, await driverArgs(sandbox, runId), {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.match(stdout, /WORKERS\s+total=/);
    assert.match(stdout, /worker-/);
    assert.match(stdout, /status: VERIFIED/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("the driver exposes --dynamic-proposal and refuses the plan route", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-dynamic-"));
  try {
    const runId = "run-worker-dynamic-" + process.pid;
    const proposalPath = join(sandbox, "proposal.json");
    await writeFile(
      proposalPath,
      JSON.stringify({
        phaseId: "phase-dynamic",
        nodes: [{ taskId: "review-1", skill: "csm-review" }],
      }) + "\n",
    );
    const { stdout } = await exec(
      process.execPath,
      await driverArgs(sandbox, runId, [
        "--dynamic-proposal",
        proposalPath,
        "--dynamic-approved",
        "--dynamic-route-kind",
        "plan",
      ]),
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    ).catch((error) => ({ stdout: String(error.stdout ?? "") }));
    assert.match(stdout, /dynamic-refused-plan-route/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("the driver enforces a --config maxParallelism envelope", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-config-"));
  try {
    const runId = "run-worker-config-" + process.pid;
    const configPath = join(sandbox, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ skills: { "csm-orchestrate": { maxParallelism: 2 } } }) + "\n",
    );
    const { stdout } = await exec(
      process.execPath,
      await driverArgs(sandbox, runId, ["--config", configPath]),
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.match(stdout, /status: VERIFIED/);

    // The envelope is enforced: an over-ceiling value is rejected by config
    // resolution rather than silently accepted.
    const overCeiling = join(sandbox, "config-over.json");
    await writeFile(
      overCeiling,
      JSON.stringify({ skills: { "csm-orchestrate": { maxParallelism: 9 } } }) + "\n",
    );
    let rejected = false;
    try {
      await exec(
        process.execPath,
        await driverArgs(sandbox, "run-worker-config-over-" + process.pid, [
          "--config",
          overCeiling,
        ]),
        { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
      );
    } catch (error) {
      rejected = true;
      const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
      assert.match(text, /maxParallelism|config/i);
    }
    assert.equal(rejected, true, "an over-ceiling maxParallelism must be rejected");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("the driver compiles an approved dynamic proposal on the research route", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-dynamic-research-"));
  try {
    const runId = "run-worker-dynamic-research-" + process.pid;
    const proposalPath = join(sandbox, "proposal.json");
    await writeFile(
      proposalPath,
      JSON.stringify({
        phaseId: "phase-dynamic",
        nodes: [{ taskId: "review-1", skill: "csm-review" }],
      }) + "\n",
    );
    let stdout;
    try {
      ({ stdout } = await exec(
        process.execPath,
        await driverArgs(sandbox, runId, [
          "--dynamic-proposal",
          proposalPath,
          "--dynamic-approved",
          "--dynamic-route-kind",
          "research",
        ]),
        { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
      ));
    } catch (error) {
      stdout = String(error.stdout ?? "");
    }
    // The dynamic csm-review node reaches executeNode's approval gate; the
    // default autonomy policy withholds approval for csm-review (network).
    assert.match(stdout, /missing-approval/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("a resumed run rehydrates the persisted telemetry and renders the worker table on both runs", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-resume-"));
  const runId = "run-worker-resume-" + process.pid;
  const evidenceDir = evidenceDirFor(runId);
  const env = { ...process.env, NODE_OPTIONS: "--unhandled-rejections=strict" };
  try {
    const first = await exec(process.execPath, await driverArgs(sandbox, runId), {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
      env,
    });
    assert.match(
      first.stdout,
      /\bWORKERS\s+total=[1-9]/,
      "the first run must render a non-empty worker table",
    );
    assert.match(first.stdout, /status: VERIFIED/);
    assertCleanOutput("the first run", `${first.stdout}${first.stderr}`);
    const before = await readTelemetrySequences(evidenceDir);
    const dispatchesBefore = (await readTelemetryEvents(evidenceDir)).filter(
      (event) => event.eventType === "dispatch",
    ).length;
    assert.ok(dispatchesBefore >= 1, "the first run must dispatch the durable child");

    // TRUE completed-run resume: keep ALL durable state (including cursor.db),
    // so reconcile must rehydrate the child's evidence from the durable terminal
    // child attempt rather than the per-process host fixture resolver (RK7).
    assert.ok(
      (await readdir(evidenceDir)).includes("cursor.db"),
      "a true resume retains the durable cursor",
    );

    const second = await exec(process.execPath, await driverArgs(sandbox, runId, ["--resume"]), {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
      env,
    });
    assert.match(
      second.stdout,
      /\bWORKERS\s+total=[1-9]/,
      "the resumed run must render the folded worker table",
    );
    assert.match(second.stdout, /status: VERIFIED/);
    assertCleanOutput("the resumed run", `${second.stdout}${second.stderr}`);

    const after = await readTelemetrySequences(evidenceDir);
    assert.equal(
      new Set(after).size,
      after.length,
      "telemetry sequences stay unique across the resume",
    );
    for (let index = 1; index < after.length; index += 1)
      assert.ok(
        after[index] > after[index - 1],
        "telemetry sequences stay strictly increasing across the resume",
      );
    // Durable telemetry must survive the resume intact: every sequence written
    // by the first run is still present, with no duplicates and no gaps. (The
    // resumed run continues past the persisted high-water mark at the emitter
    // level, covered deterministically by orchestrate-worker-state.test.mjs.)
    const beforeSet = new Set(before);
    for (const sequence of beforeSet)
      assert.ok(after.includes(sequence), `resume must not lose persisted telemetry ${sequence}`);
    assert.equal(
      (await readTelemetryEvents(evidenceDir)).filter((event) => event.eventType === "dispatch")
        .length,
      dispatchesBefore,
      "a reconciled true resume must not re-dispatch the durable child",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(evidenceDir, { recursive: true, force: true });
  }
});

test("the configured maxParallelism is the effective batch width in the driver path", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "wr-width-"));
  const runId = "run-worker-width-" + process.pid;
  const evidenceDir = evidenceDirFor(runId);
  try {
    const { stdout } = await exec(process.execPath, await widthDriverArgs(sandbox, runId, 3), {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.match(stdout, /status: VERIFIED/);
    assert.match(stdout, new RegExp(`\\bWORKERS\\s+total=${WIDTH_SKILLS.length}\\b`));

    const observed = JSON.parse(
      await readFile(join(evidenceDir, "skill-progress", "driver-width.json"), "utf8"),
    );
    assert.equal(observed.count, WIDTH_SKILLS.length, "every ready read-only node dispatches");
    assert.equal(observed.peak, 3, "configured maxParallelism is the observed batch width");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(evidenceDir, { recursive: true, force: true });
  }
});
