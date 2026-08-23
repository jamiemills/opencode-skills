# Performance Playbook

Continuity gates for a repo with no performance baseline. Sequence is fixed: profile
before load, smoke before baseline, baseline before micro-bench gates. Depth layers are
recommended, not executed by default (PERF step 4 in SKILL.md).

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Order Of Operations

1. **PROFILE** hot paths first — load against an unprofiled service measures nothing.
2. **SMOKE** — one minimal load script with thresholds-as-code; the first perf CI gate.
3. **BASELINE** — save one named average-load run; record the runner class beside it.
4. **MICRO-BENCH** — compare-fail gate on the hottest pure functions (local hardware).
5. **DEPTH** — allocations, complexity sizes, soak, cold-start, profile diff, trend
   windows: recommend in the report; execute only on explicit request.

## Profile Before Load

| Tool                                                            | Mode                        | Best for                                   |
| --------------------------------------------------------------- | --------------------------- | ------------------------------------------ |
| cProfile (`python -m cProfile -o out.pstats app.py`)            | deterministic, instrumented | batch jobs, offline reproduction           |
| py-spy (`py-spy top`, `py-spy record -o flame.svg --pid <pid>`) | sampling                    | live services; no restart, no code changes |

- cProfile provides deterministic profiling but is explicitly not for benchmarking —
  timing claims come from the micro-bench layer, never from profiler output [K19].
- py-spy is production-safe: it samples without restarting the program or modifying
  code [K19]. It exports speedscope format, but neither tool documents a diff workflow —
  numeric profile comparison is `perf diff`'s job (below) [K27].
- Store profile/flamegraph artifacts in the temp dir and reference their paths in the
  verification report (the temp dir is deleted at OUTPUT — SKILL.md PERF step 1).

## Smoke Gate: k6 With Thresholds As Code

One script, tiny load, wired to fail CI on breach [K19][K20]:

```javascript
import http from "k6/http";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<200"],
  },
};

export default function () {
  http.get(`${__ENV.BASE_URL}/`);
}
```

- A breached threshold ends the run in failed status with a non-zero exit code — that
  exit code is the CI gate [K19].
- Set `abortOnFail: true` on a threshold to stop early instead of burning the remaining
  duration after a breach [K19].
- Run the script twice before trusting it; ignore unreliable runs whose results swing
  across identical executions [K19].
- Keep smoke distinct from average-load scripts: k6's methodology uses smoke to validate
  the script itself and average-load runs to produce baselines — never mix the roles [K19].

## CLI And Batch Surfaces

No long-lived service means the smoke role becomes a hyperfine harness around the
command: hyperfine defaults to at least 10 runs over at least 3 seconds with warmup and
outlier detection [K19]. Save the first result set as the baseline and re-run it on
demand.

## Baseline Plus Micro-Bench Gates

1. Save the average-load baseline under a stable name/tag; record the runner class
   (local bare metal, self-hosted, shared CI) with every saved baseline.
2. Add ONE pytest-benchmark test around the hottest pure function [K20]:
   - capture: `pytest --benchmark-autosave` (JSON baselines saved automatically);
   - gate: `pytest --benchmark-compare-fail=min:5%` fails the suite on regression.
3. Scope honesty: `min:5%` compare-fail is a LOCAL micro-benchmark gate on known
   hardware. On shared CI runners it is noise, not protection — see Trend Windows [K19][D9].
4. Rust equivalent: criterion adds warmup/measurement/analysis/comparison phases, Tukey
   outlier classification, and a configurable noise threshold [K19].

## Allocation Tracking Per Stack

Allocation churn is often the regression that averaged latency hides [K27].

| Stack  | Mechanism                                                    | Notes                                                                                                                   |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Go     | `go test -benchmem`; `AllocedBytesPerOp()` / `AllocsPerOp()` | benchmark-integrated; A/B via benchstat (statistically robust)                                                          |
| Java   | JFR allocation sampling (JEP 331)                            | ~3% overhead                                                                                                            |
| .NET   | `dotnet-counters collect`                                    | `dotnet.gc.heap.total_allocated`, `dotnet.monitor.lock_contentions`, `dotnet.thread_pool.queue.length`; CSV/JSON export |
| Python | `tracemalloc` snapshot diff                                  | snapshot, workload, snapshot, diff — leak detection; no benchmark integration                                           |

Go is the only stack where allocation tracking is part of benchmark output; elsewhere it
is a separate diagnostic pass. Pull lock-contention and thread-pool queue counters into
.NET reports whenever concurrency regressions are suspected [K27].

## Complexity Shifts: Multi-Size Recipe

No turnkey tool gates asymptotic behavior — candidate curve-fitting tools are dead or
gate per-measure rather than growth curves [K27]. Practical recipe:

1. Benchmark N input sizes spanning orders of magnitude.
2. Store per-size timings in the baseline artifact.
3. After refactors, compare PER SIZE. Flat ratios mean constant-factor drift; ratios
   that grow toward large N mean a complexity-class change.
4. Gate at release checkpoints; automation beyond store-and-compare remains DIY.

## Soak Runs (Recommend, Do Not Execute By Default)

k6 soak guidance: durations of 3, 4, 8, 12, 24, and 48 to 72 hours, targeting response
time degradation, memory or other resource leaks, data saturation, and storage
depletion [K27]. Recommend a duration matched to the user's release cadence; execution
belongs to a pre-release checkpoint the user schedules.

## Cold Start

Spring Boot exposes structured startup timelines through the `startup` actuator
endpoint; diff those timelines across dependency or framework upgrades [K27]. On other
stacks, measure process start-to-first-request inside the smoke harness and record it.

## Profile Diff Across Refactors

`perf diff` over two `perf.data` captures (delta, ratio, and weighted-diff/wdiff modes,
down to basic-block cycles) is the only documented numeric A/B profile comparison [K27].
Checkpoint workflow: capture before, capture after, `perf diff old.data new.data`,
attach the output to the report. Sampler flamegraphs stay visual-only.

## Trend Windows On Shared Runners

Never gate with bare small-percentage absolutes on noisy infrastructure [K19][K27]:

- Bencher documents GitHub-hosted runners varying more than 30% between runs versus
  under 2% on bare metal — prefer self-hosted runners for anything gated [K19].
- Bencher threshold models: time windows (`--threshold-window`), minimum/maximum sample
  sizes, seven statistical tests (percentage, z_score, t_test, log_normal, iqr,
  delta_iqr, static), alerts optionally failing CI [K27].
- github-action-benchmark splits alert-threshold from fail-threshold and warns that
  benchmarks show plus-or-minus 10–20% amplitude noise [K19].

Decision rule: local hardware allows percentage compare-fail gates; shared CI demands a
trend/statistical window over many runs, wider bounds, or no hard gate at all.

## Report Wiring

PERF outputs recorded in the verification report: profile artifacts, smoke script path
plus thresholds, baseline name/tag plus runner class, micro-bench commands, and
recommended depth work (soak duration, profile-diff checkpoints) marked not-run with
reasons.
