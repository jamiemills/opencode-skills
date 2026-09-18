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
  appendTrendRun,
  buildBaseline,
  buildTrendEntry,
  measureEgressDecisionLatency,
  PERF_SCHEMA,
  PERF_TREND_SCHEMA,
  summarize,
  TREND_METRICS,
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

function trendEntry(runAt, hostname, numbers, mode = "hermetic") {
  return {
    runAt,
    mode,
    host: { hostname, platform: "linux", arch: "x64", nodeVersion: "v22.0.0" },
    docker: { available: false, serverVersion: null },
    numbers: {
      workerStartMedianMs: null,
      workerStartMeanMs: null,
      egressDecideAllowMedianMs: null,
      egressDecideDenyMedianMs: null,
      egressMediateAllowMedianMs: null,
      egressMediateDenyMedianMs: null,
      ...numbers,
    },
  };
}

test("trend artifact appends runs carrying host/date/numbers with computed deltas", () => {
  const first = appendTrendRun(
    null,
    trendEntry("2026-09-17T00:00:00.000Z", "host-a", {
      egressDecideAllowMedianMs: 0.01,
      egressMediateAllowMedianMs: 3.5,
    }),
  );
  assert.equal(first.schema, PERF_TREND_SCHEMA);
  assert.equal(first.schemaRevision, 1);
  assert.equal(first.observational, true);
  assert.equal(first.unit, "ms");
  assert.equal(first.updatedAt, "2026-09-17T00:00:00.000Z");
  assert.equal(first.runs.length, 1);
  const [run] = first.runs;
  assert.equal(run.sequence, 1);
  assert.equal(run.runAt, "2026-09-17T00:00:00.000Z");
  assert.equal(run.host.hostname, "host-a");
  assert.equal(run.numbers.egressDecideAllowMedianMs, 0.01);
  assert.deepEqual(Object.keys(run.numbers).toSorted(), [...TREND_METRICS].toSorted());
  assert.equal(run.deltas.baselineRunAt, null);
  for (const metric of TREND_METRICS) assert.equal(run.deltas[metric], null);

  const second = appendTrendRun(
    first,
    trendEntry("2026-09-17T01:00:00.000Z", "host-a", {
      egressDecideAllowMedianMs: 0.011,
      egressMediateAllowMedianMs: 4,
    }),
  );
  assert.equal(second.runs.length, 2);
  assert.equal(second.runs[1].sequence, 2);
  assert.equal(second.runs[1].deltas.baselineRunAt, "2026-09-17T00:00:00.000Z");
  assert.equal(second.runs[1].deltas.egressDecideAllowMedianMs, 0.001);
  assert.equal(second.runs[1].deltas.egressMediateAllowMedianMs, 0.5);
  assert.equal(second.runs[1].deltas.workerStartMedianMs, null);
});

test("trend append is deterministic and only compares like-for-like runs", () => {
  const base = trendEntry("t1", "host-a", { egressDecideAllowMedianMs: 1 });
  const foreign = trendEntry("t2", "host-b", { egressDecideAllowMedianMs: 5 });
  const forwarded = appendTrendRun(appendTrendRun(null, base), foreign);
  assert.equal(forwarded.runs[1].deltas.baselineRunAt, null);
  assert.equal(forwarded.runs[1].deltas.egressDecideAllowMedianMs, null);

  const next = appendTrendRun(
    forwarded,
    trendEntry("t3", "host-a", { egressDecideAllowMedianMs: 3 }),
  );
  assert.equal(next.runs[2].deltas.baselineRunAt, "t1");
  assert.equal(next.runs[2].deltas.egressDecideAllowMedianMs, 2);

  const repeated = appendTrendRun(appendTrendRun(null, base), foreign);
  assert.deepEqual(repeated, forwarded);
});

test("a hermetic baseline maps to a trend entry with an explicit null worker-start number", async () => {
  const artifact = await buildBaseline({
    mode: "hermetic",
    iterations: 1,
    egressIterations: 2,
    durableEgress: false,
    now: () => "2026-09-17T00:00:00.000Z",
  });
  const entry = buildTrendEntry(artifact);
  assert.equal(entry.runAt, "2026-09-17T00:00:00.000Z");
  assert.equal(entry.mode, "hermetic");
  assert.equal(entry.host.hostname, artifact.host.hostname);
  assert.equal(entry.docker.available, false);
  assert.equal(entry.numbers.workerStartMedianMs, null);
  assert.equal(entry.numbers.workerStartMeanMs, null);
  assert.equal(typeof entry.numbers.egressDecideAllowMedianMs, "number");
  assert.deepEqual(Object.keys(entry.numbers).toSorted(), [...TREND_METRICS].toSorted());
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

test("the harness CLI appends successive runs to a sibling trend artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-bench-trend-"));
  try {
    const out = join(dir, "perf-baseline.json");
    const args = [
      HARNESS,
      "--hermetic",
      "--iterations",
      "1",
      "--egress-iterations",
      "3",
      "--out",
      out,
    ];
    for (let run = 0; run < 2; run += 1) {
      const result = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /trendRuns=\d+/);
    }
    const trend = JSON.parse(await readFile(join(dir, "perf-trend.json"), "utf8"));
    assert.equal(trend.schema, PERF_TREND_SCHEMA);
    assert.equal(trend.runs.length, 2);
    assert.deepEqual(
      trend.runs.map((run) => run.sequence),
      [1, 2],
    );
    for (const run of trend.runs) {
      assert.equal(typeof run.runAt, "string");
      assert.equal(run.host.hostname.length > 0, true);
      assert.equal(run.numbers.workerStartMedianMs, null);
      assert.equal(typeof run.numbers.egressDecideAllowMedianMs, "number");
    }
    assert.equal(trend.runs[0].deltas.baselineRunAt, null);
    assert.equal(trend.runs[1].deltas.baselineRunAt, trend.runs[0].runAt);
    assert.equal(typeof trend.runs[1].deltas.egressMediateAllowMedianMs, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--no-trend leaves no trend artifact beside the baseline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-bench-notrend-"));
  try {
    const out = join(dir, "perf-baseline.json");
    const result = spawnSync(
      process.execPath,
      [
        HARNESS,
        "--hermetic",
        "--iterations",
        "1",
        "--egress-iterations",
        "2",
        "--out",
        out,
        "--no-trend",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /trendRuns=/);
    await assert.rejects(() => readFile(join(dir, "perf-trend.json"), "utf8"), { code: "ENOENT" });
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
