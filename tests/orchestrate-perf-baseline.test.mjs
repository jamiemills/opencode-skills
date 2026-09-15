"use strict";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import {
  buildBaseline,
  measureEgressDecisionLatency,
  PERF_SCHEMA,
  summarize,
} from "../scripts/bench-dwrr.mjs";

const HARNESS = fileURLToPath(new URL("../scripts/bench-dwrr.mjs", import.meta.url));
const PERF_BASELINE_PATH = fileURLToPath(
  new URL("../.agents/evidence/dynamic-worker-runtime/perf-baseline.json", import.meta.url),
);

function assertStat(stat, count) {
  assert.equal(stat.count, count);
  for (const key of ["min", "median", "mean", "max"]) {
    assert.equal(typeof stat[key], "number", `${key} must be numeric`);
    assert.equal(stat[key] >= 0, true, `${key} must be non-negative`);
  }
  assert.equal(stat.min <= stat.median, true);
  assert.equal(stat.median <= stat.max, true);
}

test("summarize returns null for no samples and ordered stats for samples", () => {
  assert.equal(summarize([]), null);
  const stat = summarize([5, 1, 3]);
  assert.equal(stat.count, 3);
  assert.equal(stat.min, 1);
  assert.equal(stat.median, 3);
  assert.equal(stat.max, 5);
  assert.equal(stat.mean, 3);
});

test("egress decision latency is measured hermetically for allow and deny paths", () => {
  const measured = measureEgressDecisionLatency({ iterations: 4, warmup: 1, filePath: null });
  assert.equal(measured.unit, "ms");
  assert.equal(measured.durable, false);
  assert.deepEqual(Object.keys(measured.operations).toSorted(), [
    "decideAllow",
    "decideDeny",
    "mediateAllow",
    "mediateDeny",
  ]);
  for (const stat of Object.values(measured.operations)) assertStat(stat, 4);
});

test("hermetic baseline emits the artifact shape with an explicit worker-start deferral", async () => {
  const artifact = await buildBaseline({
    mode: "hermetic",
    iterations: 1,
    egressIterations: 3,
    durableEgress: false,
  });
  assert.equal(artifact.schema, PERF_SCHEMA);
  assert.equal(artifact.schemaRevision, 1);
  assert.equal(typeof artifact.generatedAt, "string");
  assert.equal(Number.isNaN(Date.parse(artifact.generatedAt)), false);
  assert.equal(artifact.host.nodeVersion, process.version);
  assert.deepEqual(artifact.measurement.measured, ["egressDecision"]);
  assert.deepEqual(artifact.measurement.deferred, ["workerStart"]);
  assert.equal(artifact.workerStart.status, "deferred");
  assert.equal(artifact.workerStart.reason, "docker-unavailable");
  assert.match(artifact.measurement.rationale, /no outcome is inferred/);
  assert.equal(typeof artifact.egressDecision.operations.decideAllow.median, "number");
  assert.equal(artifact.egressDecision.durable, false);
});

test("requireWorkerStart fails closed when Docker cannot provide a measurement", async () => {
  await assert.rejects(
    () =>
      buildBaseline({
        mode: "hermetic",
        iterations: 1,
        egressIterations: 1,
        durableEgress: false,
        requireWorkerStart: true,
      }),
    /no Docker daemon is available/,
  );
});

test("the harness CLI writes a schema-marked baseline artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-bench-cli-"));
  try {
    const out = join(dir, "perf-baseline.json");
    const result = spawnSync(
      process.execPath,
      [HARNESS, "--hermetic", "--iterations", "1", "--egress-iterations", "3", "--out", out],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const artifact = JSON.parse(await readFile(out, "utf8"));
    assert.equal(artifact.schema, PERF_SCHEMA);
    assert.equal(artifact.workerStart.status, "deferred");
    assert.equal(artifact.egressDecision.operations.decideAllow.count, 3);
    assert.equal(artifact.egressDecision.operations.mediateDeny.count, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T004 (N7): the recorded perf baseline validates against csm-orchestrate-perf-baseline/1", async () => {
  const registry = await loadSchemaRegistry();
  const recorded = JSON.parse(await readFile(PERF_BASELINE_PATH, "utf8"));
  assert.equal(recorded.schema, PERF_SCHEMA);
  const recordedResult = registry.validate("csm-orchestrate-perf-baseline/1", recorded);
  assert.equal(recordedResult.valid, true, JSON.stringify(recordedResult.errors));

  // A fresh hermetic artifact (workerStart explicitly deferred) is the same shape.
  const fresh = await buildBaseline({
    mode: "hermetic",
    iterations: 1,
    egressIterations: 3,
    durableEgress: false,
  });
  const freshResult = registry.validate("csm-orchestrate-perf-baseline/1", fresh);
  assert.equal(freshResult.valid, true, JSON.stringify(freshResult.errors));
});
