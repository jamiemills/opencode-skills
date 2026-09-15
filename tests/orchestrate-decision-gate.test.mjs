"use strict";

// T006: decision gate + six-condition adversarial isolation matrix. The
// hermetic run always executes (fake Docker transport, real decision logic);
// when Docker is available the same gate re-runs live. Both runs persist to
// throwaway temp paths — the tracked artifact at EVIDENCE_PATH is a
// deterministic, freshness-explicit baseline that no test may rewrite (T004).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import {
  createHermeticProbes,
  createLiveProbes,
  DECISION_CONDITIONS,
  DECISION_GATE_SCHEMA,
  ISOLATION_MATRIX_PROPERTIES,
  runDecisionGate,
} from "../csm-orchestrate/lib/decision-gate.mjs";
import {
  classifyConcurrency,
  detectDuplicate,
  reconcileSideEffects,
  replayRoute,
  selectParallelBatch,
} from "../csm-orchestrate/lib/recovery.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
  redactSecretValues,
  REDACTED_VALUE,
} from "../csm-orchestrate/lib/telemetry.mjs";
import { foldWorkerState } from "../csm-orchestrate/lib/worker-state.mjs";
import { projectWorkerTable } from "../csm-orchestrate/output/projection.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_PATH = join(
  REPO_ROOT,
  ".agents",
  "evidence",
  "dynamic-worker-runtime",
  "decision-gate.json",
);
const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const NOW = () => "2026-09-13T00:00:00.000Z";

// T006 concurrency repair: the live gate provisions fixed-name Docker
// networks/broker ("csm-internal-1"/"csm-egress-1"), so two concurrent
// `make test-orchestrate` processes could collide. Serialize across processes
// with a repository-relative filesystem lock. Artifact writes now go to
// throwaway temp paths, but the Docker serialization is still required.
// Assertions and coverage are unchanged.
const DECISION_GATE_LOCK = join(
  REPO_ROOT,
  ".agents",
  "evidence",
  "orchestrator",
  ".decision-gate-test.lock",
);
let decisionGateLock = null;

async function acquireDecisionGateLock(lockPath, { timeoutMs = 300_000, staleMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      return handle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > staleMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        /* lock disappeared between open and stat: retry */
      }
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for the decision-gate test lock ${lockPath}`, {
          cause: error,
        });
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 50 + Math.floor(Math.random() * 100)),
      );
    }
  }
}

test.before(async () => {
  await mkdir(dirname(DECISION_GATE_LOCK), { recursive: true });
  decisionGateLock = await acquireDecisionGateLock(DECISION_GATE_LOCK);
});
test.after(async () => {
  if (!decisionGateLock) return;
  await decisionGateLock.close();
  decisionGateLock = null;
  await rm(DECISION_GATE_LOCK, { force: true });
});

function assertAllPass(artifact) {
  assert.equal(
    artifact.verdict,
    "pass",
    `gate failed: ${artifact.failedConditions.join(", ")} :: ${JSON.stringify(
      artifact.conditions.filter((condition) => condition.status !== "pass"),
    )}`,
  );
  assert.equal(artifact.conditions.length, 6);
  for (const condition of artifact.conditions)
    assert.equal(
      condition.status,
      "pass",
      `${condition.id} (${condition.title}) failed: ${JSON.stringify(condition.evidence)}`,
    );
  assert.equal(artifact.isolationMatrix.status, "pass", JSON.stringify(artifact.isolationMatrix));
  for (const property of ISOLATION_MATRIX_PROPERTIES)
    assert.equal(
      artifact.isolationMatrix.properties[property],
      "pass",
      `matrix property ${property} failed: ${JSON.stringify(
        artifact.isolationMatrix.evidence?.[property],
      )}`,
    );
}

// ---------------------------------------------------------------------------
// T011 / AC10 (F3): the compat-plan's SIX named prototype decision conditions.
// The T006 gate above records the isolation/adversarial matrix; this gate
// records the original plan T021 + compatibility-research conditions, which are
// about the worker runtime rather than the isolation boundary. It reuses the
// real runtime modules and the real worker projection renderer. Conditions that
// cannot be demonstrated are recorded as `fail` with the gap in `evidence`.
// ---------------------------------------------------------------------------
const PROTOTYPE_GATE_SCHEMA = "csm-orchestrate-prototype-gate/1";
const PROTOTYPE_GATE_SCHEMA_REVISION = 1;
const PROTOTYPE_GATE_PATH = join(
  REPO_ROOT,
  ".agents",
  "evidence",
  "dynamic-worker-runtime",
  "prototype-gate.json",
);
const AUTHORITY_SUITES = Object.freeze([
  "tests/orchestrate-recovery-replay.test.mjs",
  "tests/orchestrate-evidence-gates.test.mjs",
  "tests/orchestrate-phase-requirement-receipt.test.mjs",
  "tests/final-receipt.test.mjs",
]);

const readOnlyNode = (nodeId, ordering) => ({
  nodeId,
  skill: "csm-review",
  ordering,
  parallelism: "independent-read-only",
  sideEffects: ["read-only"],
  dependencies: [],
});

const serialNode = (nodeId) => ({
  nodeId,
  skill: "csm-build",
  ordering: 1,
  sideEffects: ["workspace-write"],
  dependencies: [],
});

// P1 — concurrent independent workers run at the configured width.
async function probeConcurrentWidth() {
  const configuredWidth = 3;
  const ready = [
    readOnlyNode("edge-a", 1),
    readOnlyNode("edge-b", 2),
    readOnlyNode("edge-c", 3),
    readOnlyNode("edge-d", 4),
  ];
  const batch = selectParallelBatch(ready, { maxParallelism: configuredWidth });
  const capped = selectParallelBatch(ready, { maxParallelism: 2 });
  const serialized = selectParallelBatch([serialNode("edge-serial")], { maxParallelism: 4 });
  const mode = classifyConcurrency(ready).mode;
  return {
    pass:
      mode === "parallel-independent-read-only" &&
      batch.length === configuredWidth &&
      capped.length === 2 &&
      serialized.length === 1,
    evidence: {
      concurrencyMode: mode,
      configuredWidth,
      observedBatchWidth: batch.length,
      cappedAtTwo: capped.length,
      sideEffectingNodeSerialized: serialized.length === 1,
      dispatchCallSite: "csm-orchestrate/lib/index.mjs:1285",
      testRefs: [
        "tests/orchestrate-batch-width.test.mjs:33",
        "tests/orchestrate-driver-worker-runtime.test.mjs:503",
      ],
    },
  };
}

// P2 — event ordering is deterministic and idempotent replay survives a resume.
async function probeEventOrdering() {
  const transport = createMemoryTransport();
  const emitter = () =>
    createTelemetryEmitter({
      runId: "run-prototype-gate",
      effectiveConfigDigest: digest({ prototypeGate: "ordering" }),
      transport,
      now: () => "2026-09-13T00:00:00.000Z",
    });
  const first = emitter();
  first.emit({ eventType: "worker.started", workerId: "worker-build-1", taskId: "task-build-1" });
  const completed = first.emit({
    eventType: "worker.completed",
    workerId: "worker-build-1",
    taskId: "task-build-1",
    attempt: 1,
  });
  const resumed = emitter();
  const highWaterMark = await resumed.rehydrate();
  resumed.emit({
    eventType: "worker.progress",
    workerId: "worker-build-1",
    payload: { activity: "verify" },
  });
  const replayed = resumed.emit({
    eventType: "worker.completed",
    workerId: "worker-build-1",
    taskId: "task-build-1",
    attempt: 1,
  });
  const events = transport.list();
  const sequences = events.map((event) => event.sequence);
  const strictlyIncreasing = sequences.every(
    (value, index) => index === 0 || value > sequences[index - 1],
  );
  const unique = new Set(sequences).size === sequences.length;
  const idempotentKey = replayed.logicalKey === completed.logicalKey;
  const folded = foldWorkerState(events, { now: "2026-09-13T00:00:00.000Z" });
  return {
    pass:
      highWaterMark === 2 &&
      strictlyIncreasing &&
      unique &&
      idempotentKey &&
      folded.workers.length === 1 &&
      folded.aggregate.completed === 1,
    evidence: {
      persistedHighWaterMark: highWaterMark,
      sequences,
      strictlyIncreasing,
      unique,
      replayLogicalKeyMatched: idempotentKey,
      foldedWorkers: folded.workers.length,
      foldedCompleted: folded.aggregate.completed,
      testRefs: [
        "tests/orchestrate-worker-state.test.mjs:29",
        "tests/orchestrate-worker-state.test.mjs:69",
        "tests/orchestrate-driver-worker-runtime.test.mjs:426",
      ],
    },
  };
}

// P3 — replay reconciliation produces no duplicate side effects.
async function probeReplayNoDuplicateSideEffects() {
  const single = reconcileSideEffects({
    expected: ["publication"],
    observed: [{ effect: "publication" }],
  });
  const duplicated = reconcileSideEffects({
    expected: ["publication"],
    observed: [{ effect: "publication" }, { effect: "publication" }],
  });
  const existing = detectDuplicate({
    idempotencyKey: "publish-key",
    records: [{ idempotencyKey: "publish-key" }],
  });
  const fresh = detectDuplicate({ idempotencyKey: "fresh-key", records: [] });
  const replay = replayRoute(
    [
      { nodeId: "a", dependencies: [], sideEffects: ["workspace-write"] },
      { nodeId: "b", dependencies: [], sideEffects: ["read-only"] },
    ],
    { completed: new Set(["a"]) },
  );
  return {
    pass:
      single.status === "reconciled" &&
      duplicated.status === "blocked" &&
      duplicated.duplicates.includes("publication") &&
      existing.duplicate === true &&
      fresh.duplicate === false &&
      replay.status === "blocked" &&
      replay.reason === "duplicate-side-effect",
    evidence: {
      singleStatus: single.status,
      duplicatedStatus: duplicated.status,
      duplicatedEffects: duplicated.duplicates,
      idempotencyKeyRecognized: existing.duplicate === true,
      freshKeyRecognized: fresh.duplicate === false,
      replayRouteStatus: replay.status,
      replayRouteReason: replay.reason,
      testRefs: [
        "tests/orchestrate-recovery-replay.test.mjs:143",
        "tests/orchestrate-recovery-replay.test.mjs:381",
      ],
    },
  };
}

// P4 — redaction covers the new telemetry fields.
async function probeRedaction() {
  const source = createTelemetryEmitter({
    runId: "run-prototype-gate",
    effectiveConfigDigest: digest({ prototypeGate: "redaction" }),
    now: () => "2026-09-13T00:00:00.000Z",
  });
  const event = source.emit({
    eventType: "worker.started",
    workerId: "worker-build-1",
    taskId: "task-build-1",
    invocationId: "invocation-build-1",
    payload: {
      authorization: "Bearer sk-abcdefghijklmnop1234",
      command: "curl -H 'Authorization: Bearer sk-abcdefghijklmnop1234' https://registry.npmjs.org",
      targetHost: "registry.npmjs.org",
      credentialRef: "credref-npm-token",
      percent: 40,
      nested: { password: "also-secret", token: "tok-1234567890" },
    },
  });
  const valueScrub = redactSecretValues("Authorization: Bearer sk-abcdefghijklmnop1234");
  const leaked =
    JSON.stringify(event.payload).includes("sk-abcdefghijklmnop1234") ||
    JSON.stringify(event.payload).includes("Bearer");
  return {
    pass:
      event.payload.authorization === REDACTED_VALUE &&
      !leaked &&
      event.payload.targetHost === "registry.npmjs.org" &&
      event.payload.credentialRef === "credref-npm-token" &&
      event.payload.percent === 40 &&
      event.payload.nested.password === REDACTED_VALUE &&
      event.payload.nested.token === REDACTED_VALUE &&
      !valueScrub.includes("sk-abcdefghijklmnop1234") &&
      typeof event.logicalKey === "string",
    evidence: {
      authorizationFieldRedacted: event.payload.authorization === REDACTED_VALUE,
      valueLevelSecretScrubbed: !leaked,
      egressTargetPreserved: event.payload.targetHost === "registry.npmjs.org",
      credentialRefPreserved: event.payload.credentialRef === "credref-npm-token",
      nestedWorkerFieldsRedacted:
        event.payload.nested.password === REDACTED_VALUE &&
        event.payload.nested.token === REDACTED_VALUE,
      directValueScrub: !valueScrub.includes("sk-abcdefghijklmnop1234"),
      newCorrelationFields: ["workerId", "taskId", "invocationId", "logicalKey"].filter((field) =>
        Object.hasOwn(event, field),
      ),
      testRefs: [
        "tests/telemetry/telemetry-redaction.test.mjs:29",
        "tests/telemetry/telemetry-worker-events.test.mjs:69",
      ],
    },
  };
}

// P5 — a rendered worker snapshot is produced.
async function probeRenderedSnapshot() {
  const source = createTelemetryEmitter({
    runId: "run-prototype-gate",
    effectiveConfigDigest: digest({ prototypeGate: "snapshot" }),
    now: () => "2026-09-13T00:00:00.000Z",
  });
  const events = [
    source.emit({
      eventType: "worker.started",
      workerId: "worker-build-1",
      taskId: "task-build-1",
      payload: { skill: "csm-build" },
    }),
    source.emit({
      eventType: "worker.completed",
      workerId: "worker-build-1",
      taskId: "task-build-1",
      payload: { skill: "csm-build" },
    }),
    source.emit({
      eventType: "worker.failed",
      workerId: "worker-review-1",
      taskId: "task-review-1",
      payload: { skill: "csm-review" },
    }),
  ];
  const snapshot = foldWorkerState(events, { now: "2026-09-13T00:00:00.000Z" });
  const rendered = projectWorkerTable(snapshot);
  return {
    pass:
      snapshot.schema === "csm-worker-projection/1" &&
      rendered.schema === "csm-worker-projection-render/1" &&
      rendered.rows.length === 2 &&
      rendered.aggregate.completed === 1 &&
      rendered.aggregate.failed === 1 &&
      /WORKERS\s+total=2/.test(rendered.text),
    evidence: {
      snapshotSchema: snapshot.schema,
      renderSchema: rendered.schema,
      renderedRows: rendered.rows.length,
      aggregate: rendered.aggregate,
      textSummary: rendered.text.split("\n").at(-1),
      testRefs: [
        "tests/worker-projection-render.test.mjs:45",
        "tests/orchestrate-driver-worker-runtime.test.mjs:426",
      ],
    },
  };
}

// P6 — no receipt/cursor/evidence/gate regression. Re-runs the authoritative
// authority-plane suites as subprocesses and re-runs the hermetic decision gate
// in-process (never persisted here; the T006 tests own that artifact).
async function probeAuthorityRegression() {
  // The parent runner sets NODE_TEST_CONTEXT in our env; strip it so the
  // grandchild emits the canonical TAP summary (and its real pass/fail counts).
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const suites = [];
  for (const file of AUTHORITY_SUITES) {
    const result = spawnSync(process.execPath, ["--test", file], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 180_000,
      env: childEnv,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const pass = Number((output.match(/^# pass (\d+)/m) ?? [])[1] ?? 0);
    const fail = Number((output.match(/^# fail (\d+)/m) ?? [])[1] ?? 0);
    const ok = result.status === 0 && fail === 0 && pass > 0;
    suites.push({ file, status: ok ? "pass" : "fail", pass, fail });
  }
  const gate = await runDecisionGate({
    probes: createHermeticProbes(),
    now: () => "2026-09-13T00:00:00.000Z",
    persist: false,
  });
  return {
    pass: suites.every((suite) => suite.status === "pass") && gate.verdict === "pass",
    evidence: {
      suites,
      decisionGateVerdict: gate.verdict,
      decisionGateFailedConditions: gate.failedConditions,
      testRefs: [
        "tests/orchestrate-recovery-replay.test.mjs (cursor + terminal receipt)",
        "tests/orchestrate-evidence-gates.test.mjs (evidence gates)",
        "tests/orchestrate-phase-requirement-receipt.test.mjs",
        "tests/final-receipt.test.mjs",
      ],
    },
  };
}

const PROTOTYPE_CONDITIONS = Object.freeze([
  {
    id: "P1",
    key: "concurrentWidth",
    title: "concurrent independent workers run at the configured width",
    probe: probeConcurrentWidth,
  },
  {
    id: "P2",
    key: "eventOrdering",
    title: "event ordering is deterministic and idempotent replay survives a resume",
    probe: probeEventOrdering,
  },
  {
    id: "P3",
    key: "replayNoDuplicateSideEffects",
    title: "replay reconciliation produces no duplicate side effects",
    probe: probeReplayNoDuplicateSideEffects,
  },
  {
    id: "P4",
    key: "redaction",
    title: "redaction covers the new telemetry fields",
    probe: probeRedaction,
  },
  {
    id: "P5",
    key: "renderedSnapshot",
    title: "a rendered worker snapshot is produced",
    probe: probeRenderedSnapshot,
  },
  {
    id: "P6",
    key: "authorityRegression",
    title: "no receipt/cursor/evidence/gate regression",
    probe: probeAuthorityRegression,
  },
]);

// N6 (T011 follow-up): like `runDecisionGate`, there is deliberately NO
// tracked-path default. The recorded baseline at PROTOTYPE_GATE_PATH is durable
// evidence; a bare `runPrototypeGate()` must never be able to rewrite it.
// Persistence requires an explicit, caller-supplied path.
async function runPrototypeGate({
  now = () => new Date().toISOString(),
  evidencePath = null,
  persist = true,
  probeOverrides = {},
} = {}) {
  const generatedAt = now();
  const conditions = [];
  for (const condition of PROTOTYPE_CONDITIONS) {
    const probe = probeOverrides[condition.key] ?? condition.probe;
    let outcome;
    try {
      outcome = await probe();
    } catch (error) {
      outcome = { pass: false, evidence: { error: String(error?.message ?? error) } };
    }
    conditions.push({
      id: condition.id,
      key: condition.key,
      title: condition.title,
      status: outcome?.pass === true ? "pass" : "fail",
      evidence: outcome?.evidence ?? {},
    });
  }
  const failedConditions = conditions
    .filter((condition) => condition.status !== "pass")
    .map((condition) => condition.id);
  const artifact = {
    schema: PROTOTYPE_GATE_SCHEMA,
    schemaRevision: PROTOTYPE_GATE_SCHEMA_REVISION,
    generatedAt,
    source: {
      acceptanceCriterion: "AC10",
      plan: "2026-09-12-dynamic-worker-runtime T021 / compatibility research",
      note: "Six named prototype decision conditions; the adversarial isolation matrix is recorded separately at .agents/evidence/dynamic-worker-runtime/decision-gate.json.",
    },
    conditions,
    verdict: failedConditions.length === 0 ? "pass" : "fail",
    failedConditions,
  };
  if (persist !== false && typeof evidencePath === "string" && evidencePath.length > 0) {
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`);
    artifact.artifactPath = evidencePath;
  }
  return artifact;
}

test("T006: the hermetic gate passes all six conditions and every isolation-matrix property", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-gate-hermetic-"));
  try {
    const scratch = join(dir, "decision-gate.json");
    const artifact = await runDecisionGate({
      probes: createHermeticProbes(),
      now: NOW,
      evidencePath: scratch,
    });
    assertAllPass(artifact);
    assert.equal(artifact.schema, DECISION_GATE_SCHEMA);
    assert.equal(artifact.mode, "hermetic");
    assert.equal(artifact.generatedAt, NOW());
    assert.equal(artifact.freshness.kind, "observed");

    const onDisk = JSON.parse(await readFile(scratch, "utf8"));
    assert.equal(onDisk.schema, DECISION_GATE_SCHEMA);
    assert.equal(onDisk.verdict, "pass");
    assert.equal(onDisk.conditions.length, 6);
    assert.deepEqual(
      onDisk.conditions.map((condition) => condition.id),
      DECISION_CONDITIONS.map((condition) => condition.id),
    );
    assert.deepEqual(Object.keys(onDisk.isolationMatrix.properties), [
      ...ISOLATION_MATRIX_PROPERTIES,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T006: a failing probe yields a fail verdict naming the failing condition", async () => {
  const artifact = await runDecisionGate({
    probes: {
      ...createHermeticProbes(),
      egressDefaultDeny: async () => ({ pass: false, evidence: { reason: "forced-denial" } }),
    },
    now: NOW,
    persist: false,
  });
  assert.equal(artifact.verdict, "fail");
  assert.deepEqual(artifact.failedConditions, ["C3"]);
  const failing = artifact.conditions.find((condition) => condition.id === "C3");
  assert.equal(failing.status, "fail");
  assert.equal(failing.evidence.reason, "forced-denial");
});

test("T006: artifactPath is runtime-only and never persisted into the artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-gate-"));
  try {
    const scratch = join(dir, "decision-gate.json");
    const artifact = await runDecisionGate({
      probes: createHermeticProbes(),
      now: NOW,
      evidencePath: scratch,
    });
    assertAllPass(artifact);
    const onDisk = JSON.parse(await readFile(scratch, "utf8"));
    assert.equal(onDisk.verdict, "pass");
    assert.equal(onDisk.artifactPath, undefined, "artifactPath is runtime-only, never persisted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "T006: the live gate passes all six conditions and the isolation matrix under Docker",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "csm-decision-gate-live-"));
    try {
      const scratch = join(dir, "decision-gate.json");
      const artifact = await runDecisionGate({
        probes: createLiveProbes(),
        now: NOW,
        evidencePath: scratch,
      });
      assertAllPass(artifact);
      assert.equal(artifact.mode, "live");
      assert.equal(artifact.freshness.kind, "observed");
      const onDisk = JSON.parse(await readFile(scratch, "utf8"));
      assert.equal(onDisk.verdict, "pass");
      assert.equal(onDisk.mode, "live");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("T004: the tracked decision-gate.json is a deterministic, freshness-explicit baseline the suite never rewrites", async () => {
  const before = await readFile(EVIDENCE_PATH);
  const onDisk = JSON.parse(before.toString("utf8"));

  // The recorded mode and freshness must be explicit, never runner-inferred.
  assert.equal(onDisk.schema, DECISION_GATE_SCHEMA);
  assert.equal(onDisk.schemaRevision, 1);
  assert.equal(onDisk.verdict, "pass");
  assert.deepEqual(onDisk.failedConditions, []);
  assert.ok(
    onDisk.mode === "hermetic" || onDisk.mode === "live",
    `mode must be an explicit recording mode, got ${JSON.stringify(onDisk.mode)}`,
  );
  assert.equal(typeof onDisk.freshness, "object");
  assert.equal(onDisk.freshness.kind, "baseline");
  assert.equal(onDisk.freshness.mode, onDisk.mode);
  assert.equal(onDisk.freshness.generatedAt, onDisk.generatedAt);
  assert.ok(
    Number.isFinite(Date.parse(onDisk.generatedAt)),
    `generatedAt must be an ISO-8601 timestamp, got ${JSON.stringify(onDisk.generatedAt)}`,
  );

  // The baseline is byte-reproducible from the deterministic hermetic probes.
  const expected = await runDecisionGate({
    probes: createHermeticProbes(),
    now: NOW,
    persist: false,
    freshnessKind: "baseline",
  });
  assert.equal(
    `${JSON.stringify(expected, null, 2)}\n`,
    before.toString("utf8"),
    "tracked decision-gate.json is not the deterministic hermetic baseline",
  );

  // Running the suite (hermetic + live, both to temp paths) never rewrites it.
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-gate-baseline-"));
  try {
    await runDecisionGate({
      probes: createHermeticProbes(),
      now: NOW,
      evidencePath: join(dir, "hermetic.json"),
    });
    if (DOCKER_AVAILABLE) {
      const live = await runDecisionGate({
        probes: createLiveProbes(),
        now: NOW,
        evidencePath: join(dir, "live.json"),
      });
      assert.equal(live.mode, "live");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const after = await readFile(EVIDENCE_PATH);
  assert.ok(after.equals(before), "the suite rewrote the tracked decision-gate baseline");
});

test("T003 (N6): a pathless runDecisionGate() cannot rewrite the tracked baseline", async () => {
  const before = await readFile(EVIDENCE_PATH);

  // No evidencePath, no persist opt-out: the hardened default must write nothing.
  const artifact = await runDecisionGate({ probes: createHermeticProbes(), now: NOW });
  assertAllPass(artifact);
  assert.equal(
    artifact.artifactPath,
    undefined,
    "a pathless runDecisionGate() must not report a persisted artifact path",
  );

  const after = await readFile(EVIDENCE_PATH);
  assert.ok(
    after.equals(before),
    "a pathless runDecisionGate() rewrote the tracked decision-gate baseline",
  );
});

test("T011: the compat-plan six prototype conditions pass and are recorded (AC10)", async () => {
  const before = await readFile(PROTOTYPE_GATE_PATH);
  const dir = await mkdtemp(join(tmpdir(), "csm-prototype-gate-"));
  try {
    const scratch = join(dir, "prototype-gate.json");
    const artifact = await runPrototypeGate({ now: NOW, evidencePath: scratch });
    assert.equal(artifact.schema, PROTOTYPE_GATE_SCHEMA);
    assert.equal(artifact.schemaRevision, PROTOTYPE_GATE_SCHEMA_REVISION);
    assert.equal(artifact.generatedAt, NOW());
    assert.equal(
      artifact.verdict,
      "pass",
      `prototype gate failed: ${artifact.failedConditions.join(", ")} :: ${JSON.stringify(
        artifact.conditions.filter((condition) => condition.status !== "pass"),
      )}`,
    );
    assert.equal(artifact.conditions.length, 6);
    assert.deepEqual(
      artifact.conditions.map((condition) => condition.id),
      PROTOTYPE_CONDITIONS.map((condition) => condition.id),
    );
    for (const condition of artifact.conditions) {
      assert.equal(
        condition.status,
        "pass",
        `${condition.id} (${condition.title}) failed: ${JSON.stringify(condition.evidence)}`,
      );
      assert.ok(
        condition.evidence && Object.keys(condition.evidence).length > 0,
        `${condition.id} must carry evidence`,
      );
    }
    assert.deepEqual(artifact.failedConditions, []);

    const onDisk = JSON.parse(await readFile(scratch, "utf8"));
    assert.equal(onDisk.schema, PROTOTYPE_GATE_SCHEMA);
    assert.equal(onDisk.verdict, "pass");
    assert.equal(onDisk.conditions.length, 6);
    assert.equal(onDisk.artifactPath, undefined, "artifactPath is runtime-only, never persisted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const after = await readFile(PROTOTYPE_GATE_PATH);
  assert.ok(
    after.equals(before),
    "the suite rewrote the tracked prototype-gate baseline; record to a throwaway temp path",
  );
});

// N6 (T011 follow-up): a pathless runPrototypeGate() must not persist anything,
// so it can never nondeterministically rewrite the tracked baseline.
test("T011 (N6): a pathless runPrototypeGate() cannot rewrite the tracked baseline", async () => {
  const before = await readFile(PROTOTYPE_GATE_PATH);
  const artifact = await runPrototypeGate({
    now: NOW,
    probeOverrides: {
      authorityRegression: async () => ({ pass: true, evidence: { injected: true } }),
    },
  });
  assert.equal(artifact.verdict, "pass");
  assert.equal(
    artifact.artifactPath,
    undefined,
    "a pathless runPrototypeGate() must not report a persisted artifact path",
  );
  const after = await readFile(PROTOTYPE_GATE_PATH);
  assert.ok(
    after.equals(before),
    "a pathless runPrototypeGate() rewrote the tracked prototype-gate baseline",
  );
});

test("T011: a failing prototype probe yields a fail verdict naming the condition", async () => {
  const artifact = await runPrototypeGate({
    now: NOW,
    persist: false,
    probeOverrides: {
      replayNoDuplicateSideEffects: async () => ({
        pass: false,
        evidence: { reason: "forced-gap" },
      }),
    },
  });
  assert.equal(artifact.verdict, "fail");
  assert.deepEqual(artifact.failedConditions, ["P3"]);
  const failing = artifact.conditions.find((condition) => condition.id === "P3");
  assert.equal(failing.status, "fail");
  assert.equal(failing.evidence.reason, "forced-gap");
});

test("T004 (N7): the recorded decision-gate and prototype-gate artifacts validate against their registered schemas", async () => {
  const registry = await loadSchemaRegistry();

  const decisionGate = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  assert.equal(decisionGate.schema, "csm-orchestrate-decision-gate/1");
  const decisionResult = registry.validate("csm-orchestrate-decision-gate/1", decisionGate);
  assert.equal(decisionResult.valid, true, JSON.stringify(decisionResult.errors));

  const prototypeGate = JSON.parse(await readFile(PROTOTYPE_GATE_PATH, "utf8"));
  assert.equal(prototypeGate.schema, "csm-orchestrate-prototype-gate/1");
  const prototypeResult = registry.validate("csm-orchestrate-prototype-gate/1", prototypeGate);
  assert.equal(prototypeResult.valid, true, JSON.stringify(prototypeResult.errors));

  // A fresh in-memory gate artifact is the same registered shape as the baseline.
  const fresh = await runDecisionGate({ probes: createHermeticProbes(), now: NOW, persist: false });
  const freshResult = registry.validate("csm-orchestrate-decision-gate/1", fresh);
  assert.equal(freshResult.valid, true, JSON.stringify(freshResult.errors));
});
