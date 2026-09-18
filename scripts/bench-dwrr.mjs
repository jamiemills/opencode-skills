#!/usr/bin/env node
"use strict";

// T007: outcome-measurement harness for the dynamic worker runtime.
//
// Measures two observable outcomes against a recorded baseline:
//   (a) sandbox worker start latency — the full Docker provisioning path
//       (create -> start -> workspace/worker staging -> inspect -> keyed
//       attestation) via createDockerWorkerProvider. Docker-gated: when the
//       daemon is unavailable (or mode=hermetic) the measurement is recorded as
//       an explicit deferral with a rationale instead of being inferred.
//   (b) mediated-egress decision latency — the pure policy decision and the
//       decision+audit-record path via createEgressBroker. Hermetic: needs no
//       Docker and runs on every invocation.
//
// The artifact is observational only. It carries no acceptance authority and
// never infers productivity, latency, cost, or correctness from any external
// model's behavior.
//
// Usage:
//   node scripts/bench-dwrr.mjs [--out <path>] [--iterations N]
//     [--egress-iterations N] [--warmup N] [--hermetic]
//     [--require-worker-start] [--print] [--trend-out <path>] [--no-trend]
// Default output: .agents/evidence/dynamic-worker-runtime/perf-baseline.json
// Default trend:  a sibling perf-trend.json (append; deltas vs the previous
//                 like-for-like run: same mode + hostname). Use --no-trend to
//                 skip it or --trend-out to redirect it.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, hostname, platform, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerWorkerProvider } from "../csm-orchestrate/lib/docker-worker-provider.mjs";
import { createEgressBroker, createEgressLedger } from "../csm-orchestrate/lib/egress-broker.mjs";

export const PERF_SCHEMA = "csm-orchestrate-perf-baseline/1";
export const DEFAULT_OUT = ".agents/evidence/dynamic-worker-runtime/perf-baseline.json";
// T007: ongoing benchmarking. Successive runs append to a sibling trend artifact
// so drift is observable over time. It stores only the recorded numbers plus the
// host/date of each run: observational, no outcome inference, no acceptance
// authority. Deltas compare like-for-like runs (same mode + hostname) only.
export const PERF_TREND_SCHEMA = "csm-orchestrate-perf-trend/1";
export const DEFAULT_TREND_NAME = "perf-trend.json";
export const TREND_MAX_RUNS = 200;
export const TREND_METRICS = Object.freeze([
  "workerStartMedianMs",
  "workerStartMeanMs",
  "egressDecideAllowMedianMs",
  "egressDecideDenyMedianMs",
  "egressMediateAllowMedianMs",
  "egressMediateDenyMedianMs",
]);
// Kept in sync with the provider default; the provider does not export it.
const DEFAULT_BENCH_IMAGE = "node:22.23.2-bookworm-slim";
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

// A minimal worker source so the measured start path includes the worker-staging
// exec the real provider performs. Never executed by `start`.
const WORKER_SOURCE = "process.stdin.resume();\n";

export const EGRESS_POLICY = Object.freeze({
  defaultAction: "deny",
  failMode: "blocked",
  entries: [
    {
      host: "api.example.test",
      port: 443,
      scheme: "https",
      methods: ["GET"],
      pathPrefix: "/v1",
      maxBytes: 1_048_576,
      timeoutMs: 5_000,
    },
    { host: "registry.npmjs.org", port: 443, scheme: "https" },
  ],
  credentialInjections: [],
});

const ALLOW_TARGET = Object.freeze({
  host: "api.example.test",
  port: 443,
  scheme: "https",
  method: "GET",
  path: "/v1/ping",
  bytesIn: 128,
});
const DENY_TARGET = Object.freeze({
  host: "blocked.example.test",
  port: 443,
  scheme: "https",
  method: "POST",
  bytesIn: 128,
});

function round(value) {
  return Number(value.toFixed(4));
}

export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].toSorted((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    min: round(sorted[0]),
    median: round(median),
    mean: round(total / sorted.length),
    max: round(sorted.at(-1)),
  };
}

function metricMedian(operation) {
  return operation && typeof operation.median === "number" ? operation.median : null;
}

// Flattens a baseline artifact into the small set of numbers the trend tracks.
// A deferred workerStart records null (never an inferred value); the hermetic
// egress numbers are always present.
export function trendNumbers(artifact) {
  const egress = artifact?.egressDecision?.operations ?? {};
  const worker = artifact?.workerStart;
  const workerStats = worker?.status === "measured" ? worker.stats : null;
  return {
    workerStartMedianMs: workerStats?.median ?? null,
    workerStartMeanMs: workerStats?.mean ?? null,
    egressDecideAllowMedianMs: metricMedian(egress.decideAllow),
    egressDecideDenyMedianMs: metricMedian(egress.decideDeny),
    egressMediateAllowMedianMs: metricMedian(egress.mediateAllow),
    egressMediateDenyMedianMs: metricMedian(egress.mediateDeny),
  };
}

export function buildTrendEntry(artifact) {
  if (!artifact || typeof artifact !== "object")
    throw new TypeError("trend entry requires a baseline artifact");
  return {
    runAt: artifact.generatedAt ?? null,
    mode: artifact.mode ?? null,
    host: {
      hostname: artifact.host?.hostname ?? null,
      platform: artifact.host?.platform ?? null,
      arch: artifact.host?.arch ?? null,
      nodeVersion: artifact.host?.nodeVersion ?? null,
    },
    docker: {
      available: artifact.environment?.docker?.available ?? null,
      serverVersion: artifact.environment?.docker?.serverVersion ?? null,
    },
    numbers: trendNumbers(artifact),
  };
}

function normalizeTrend(trend) {
  if (trend === null || trend === undefined) return { runs: [] };
  if (typeof trend !== "object" || !Array.isArray(trend.runs))
    throw new TypeError("trend artifact must be an object with a runs array");
  if (trend.schema !== undefined && trend.schema !== PERF_TREND_SCHEMA)
    throw new TypeError(`unexpected trend schema: ${String(trend.schema)}`);
  return trend;
}

function priorComparableRun(runs, entry) {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run?.mode === entry.mode && run?.host?.hostname === entry.host.hostname) return run;
  }
  return null;
}

export function computeTrendDeltas(previous, entry) {
  const deltas = { baselineRunAt: previous?.runAt ?? null };
  for (const metric of TREND_METRICS) {
    const before = previous?.numbers?.[metric];
    const after = entry?.numbers?.[metric];
    deltas[metric] =
      typeof before === "number" && typeof after === "number" ? round(after - before) : null;
  }
  return deltas;
}

// Pure append: given the existing trend (or null) and a run entry, returns the
// next trend object. Deterministic for identical inputs, so repeated runs only
// differ by their measured numbers/date.
export function appendTrendRun(trend, entry, { maxRuns = TREND_MAX_RUNS } = {}) {
  if (!entry || typeof entry !== "object") throw new TypeError("trend run entry is required");
  const runs = normalizeTrend(trend).runs;
  const previous = priorComparableRun(runs, entry);
  const nextRun = {
    sequence: (runs.at(-1)?.sequence ?? 0) + 1,
    ...entry,
    deltas: computeTrendDeltas(previous, entry),
  };
  const appended = [...runs, nextRun];
  const retained = Number.isInteger(maxRuns) && maxRuns > 0 ? appended.slice(-maxRuns) : appended;
  return {
    schema: PERF_TREND_SCHEMA,
    schemaRevision: 1,
    observational: true,
    unit: "ms",
    updatedAt: entry.runAt ?? null,
    maxRuns,
    runs: retained,
  };
}

export async function readTrend(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function recordTrendRun({ artifact, trendPath, maxRuns = TREND_MAX_RUNS }) {
  const entry = buildTrendEntry(artifact);
  const trend = appendTrendRun(await readTrend(trendPath), entry, { maxRuns });
  await mkdir(dirname(resolve(trendPath)), { recursive: true });
  await writeFile(resolve(trendPath), `${JSON.stringify(trend, null, 2)}\n`);
  return trend;
}

function sampleSync(fn, iterations, warmup) {
  const samples = [];
  for (let index = 0; index < warmup + iterations; index += 1) {
    const start = process.hrtime.bigint();
    fn();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (index >= warmup) samples.push(elapsedMs);
  }
  return samples;
}

function dockerState() {
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  const available = info.status === 0;
  if (!available) return { available: false, serverVersion: null };
  const version = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  return {
    available: true,
    serverVersion: version.status === 0 ? version.stdout.trim() : null,
  };
}

export function measureEgressDecisionLatency({
  iterations = 200,
  warmup = 20,
  filePath = null,
} = {}) {
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new TypeError("egress iterations must be a positive integer");
  if (!Number.isInteger(warmup) || warmup < 0)
    throw new TypeError("egress warmup must be a non-negative integer");
  // A durable ledger makes the decision+record path include the fsync'd append,
  // so the mediated number reflects the immutable audit log, not just the rule
  // match. A null filePath keeps the chain in memory (no durability).
  const ledger = createEgressLedger({
    runId: "run-perf-baseline",
    key: "perf-baseline-egress-key-0001",
    filePath,
  });
  const broker = createEgressBroker({
    policy: EGRESS_POLICY,
    ledger,
    policyDigest: ZERO_DIGEST,
  });
  const mediate = (target) => {
    const decided = broker.decide(target);
    broker.record(decided, target, {});
  };
  return {
    unit: "ms",
    iterations,
    warmup,
    durable: filePath !== null,
    policyDigest: ZERO_DIGEST,
    operations: {
      decideAllow: summarize(sampleSync(() => broker.decide(ALLOW_TARGET), iterations, warmup)),
      decideDeny: summarize(sampleSync(() => broker.decide(DENY_TARGET), iterations, warmup)),
      mediateAllow: summarize(sampleSync(() => mediate(ALLOW_TARGET), iterations, warmup)),
      mediateDeny: summarize(sampleSync(() => mediate(DENY_TARGET), iterations, warmup)),
    },
  };
}

export async function measureWorkerStartLatency({
  iterations = 5,
  warmup = 1,
  image = DEFAULT_BENCH_IMAGE,
  docker = "docker",
} = {}) {
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new TypeError("worker-start iterations must be a positive integer");
  if (!Number.isInteger(warmup) || warmup < 0)
    throw new TypeError("worker-start warmup must be a non-negative integer");
  const provider = createDockerWorkerProvider({ docker, image });
  const samples = [];
  let observed = null;
  for (let index = 0; index < warmup + iterations; index += 1) {
    const name = `csm-bench-${process.pid}-${index}-${randomUUID()}`;
    const start = process.hrtime.bigint();
    let started;
    try {
      started = await provider.start({ name, workerSource: WORKER_SOURCE });
    } catch (error) {
      throw new Error(`worker start sample ${index} failed: ${String(error?.message ?? error)}`, {
        cause: error,
      });
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    observed = started;
    await provider.stop({ id: started.id });
    if (index >= warmup) samples.push(elapsedMs);
  }
  return {
    unit: "ms",
    iterations,
    warmup,
    image,
    imageDigest: observed?.attestation?.imageDigest ?? null,
    definition:
      "docker create -> start -> worker-source staging -> inspect -> keyed attestation (excludes container stop)",
    samples: samples.map(round),
    stats: summarize(samples),
  };
}

export async function buildBaseline({
  mode = "auto",
  iterations = 5,
  warmup = 1,
  egressIterations = 200,
  image = DEFAULT_BENCH_IMAGE,
  requireWorkerStart = false,
  durableEgress = true,
  now = () => new Date().toISOString(),
} = {}) {
  if (mode !== "auto" && mode !== "hermetic") throw new TypeError(`unknown mode: ${String(mode)}`);
  const docker = mode === "hermetic" ? { available: false, serverVersion: null } : dockerState();

  // A durable ledger makes `mediate*` include the fsync'd append; the temp
  // directory is removed after measurement so the harness leaves no residue.
  const egressDir = durableEgress ? await mkdtemp(join(tmpdir(), "csm-bench-")) : null;
  let egressDecision;
  try {
    egressDecision = measureEgressDecisionLatency({
      iterations: egressIterations,
      warmup: Math.min(20, egressIterations),
      filePath: egressDir ? join(egressDir, "egress.ndjson") : null,
    });
  } finally {
    if (egressDir) await rm(egressDir, { recursive: true, force: true });
  }

  const measured = ["egressDecision"];
  const deferred = [];
  let workerStart;
  if (docker.available) {
    try {
      workerStart = await measureWorkerStartLatency({ iterations, warmup, image });
      measured.push("workerStart");
    } catch (error) {
      if (requireWorkerStart) throw error;
      workerStart = {
        status: "deferred",
        rationale: "worker start measurement failed on an otherwise-available Docker daemon",
        reason: String(error?.message ?? error),
      };
      deferred.push("workerStart");
    }
  } else {
    if (requireWorkerStart)
      throw new Error("worker start was required but no Docker daemon is available to measure it");
    const rationale =
      mode === "hermetic"
        ? "hermetic mode requested: the real Docker worker start is intentionally not measured"
        : "no Docker daemon on this host: the real worker start cannot be measured meaningfully";
    workerStart = { status: "deferred", rationale, reason: "docker-unavailable" };
    deferred.push("workerStart");
  }
  if (workerStart.status !== "deferred") workerStart = { status: "measured", ...workerStart };

  const artifact = {
    schema: PERF_SCHEMA,
    schemaRevision: 1,
    generatedAt: now(),
    mode,
    host: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? null,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      nodeVersion: process.version,
    },
    environment: { docker },
    measurement: {
      measured,
      deferred,
      rationale:
        deferred.length === 0
          ? "both outcomes measured live on this host"
          : `deferred: ${deferred.join(", ")} — measured live: ${measured.join(", ")}; no outcome is inferred from external model behavior`,
    },
    definitions: {
      workerStart: workerStart.definition ?? null,
      egressDecision:
        "decideAllow/decideDeny: broker.decide (pure allowlist + budget match). mediateAllow/mediateDeny: decide + record (HMAC-keyed audit chain, plus a durable fsync'd append when durable=true)",
    },
    workerStart,
    egressDecision,
    reproduce: `node scripts/with-node22.mjs --exec node scripts/bench-dwrr.mjs --out ${DEFAULT_OUT}`,
    notes: [
      "Observational baseline only; carries no acceptance authority.",
      "workerStart is Docker-gated and records an explicit deferral when unavailable or hermetic.",
      "egressDecision is hermetic and measured on every invocation.",
    ],
  };
  return artifact;
}

function parseArgs(argv) {
  const args = {
    mode: "auto",
    iterations: 5,
    warmup: 1,
    egressIterations: 200,
    out: DEFAULT_OUT,
    requireWorkerStart: false,
    print: false,
    trend: true,
    trendOut: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out") args.out = argv[++index];
    else if (token === "--iterations") args.iterations = Number(argv[++index]);
    else if (token === "--egress-iterations") args.egressIterations = Number(argv[++index]);
    else if (token === "--warmup") args.warmup = Number(argv[++index]);
    else if (token === "--hermetic") args.mode = "hermetic";
    else if (token === "--require-worker-start") args.requireWorkerStart = true;
    else if (token === "--print") args.print = true;
    else if (token === "--trend-out") args.trendOut = argv[++index];
    else if (token === "--no-trend") args.trend = false;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = await buildBaseline({
    mode: args.mode,
    iterations: args.iterations,
    warmup: args.warmup,
    egressIterations: args.egressIterations,
    requireWorkerStart: args.requireWorkerStart,
  });
  if (args.print) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    return;
  }
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), `${JSON.stringify(artifact, null, 2)}\n`);
  let trendSummary = "";
  if (args.trend) {
    // Default trend path is a sibling of the baseline so a custom --out stays
    // self-contained (tests and temp runs never touch the tracked artifact).
    const trendPath = args.trendOut ?? join(dirname(resolve(args.out)), DEFAULT_TREND_NAME);
    const trend = await recordTrendRun({ artifact, trendPath });
    const latest = trend.runs.at(-1);
    const delta = latest?.deltas?.egressDecideAllowMedianMs;
    trendSummary = ` trendRuns=${trend.runs.length} trendDeltaEgressDecideMs=${
      delta === null || delta === undefined ? "n/a" : delta
    } trend=${trendPath}`;
  }
  const started = artifact.workerStart.status === "measured" ? "measured" : "deferred";
  process.stdout.write(
    `perf-baseline: ${artifact.schema} workerStart=${started} ` +
      `egressDecideMedianMs=${artifact.egressDecision.operations.decideAllow.median} ` +
      `-> ${args.out}${trendSummary}\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(1);
  });
}
