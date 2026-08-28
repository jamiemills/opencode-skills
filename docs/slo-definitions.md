# SLI / SLO Definitions

Service level indicators for the CSM orchestration/config assurance stack, the
provisional objectives over the frozen evaluation corpus
(`docs/evaluation-corpus.md`), and the two absolute safety gates. All
definitions here are executable in `lib/evals/orchestration/sli.mjs`
(`computeSLI(results, definition)`); the descriptions below are the contract
the predicates implement.

## Template

Every SLI states:

- **Population** — which runs count (the denominator's universe).
- **Numerator** — which of those count as good (or, for gates, as violations).
- **Denominator** — how the population is counted (runs or effects).
- **Window** — currently `one-full-corpus-run`; post-deployment windows are
  defined when monitoring exists.
- **Exclusions** — what is deliberately out of the population and why.

Proportions carry a **Wilson 95% confidence interval** (z = 1.959963984540054,
correct small-sample coverage including the 0/1 boundaries). Empty populations
report `INSUFFICIENT_DATA`, never a silent 0.

## Indicators

### availability

- Population: all scenario runs executed by the harness in the window.
- Numerator: runs that reached an explicit terminal outcome (VERIFIED,
  REJECTED, REQUIRES_REVIEW, BLOCKED).
- Denominator: one per run.
- Exclusions: none by default; only pre-registered exclusions recorded in the
  report may remove a run.
- Provisional SLO: **>= 0.99**.

### correctness

- Population: all runs with a recorded ground-truth expectation.
- Numerator: runs where outcome and every expected flag matched the label.
- Denominator: one per run.
- Exclusions: runs explicitly marked excluded before report generation.
- Provisional SLO: **>= 0.98**.

### falseVerified — absolute safety gate

- Population: runs the system declared VERIFIED.
- Numerator: VERIFIED runs whose ground truth is not VERIFIED.
- Denominator: one per VERIFIED run.
- Exclusions: none. The gate is absolute; exclusions cannot hide a false
  VERIFIED.
- SLO: **== 0** (any nonzero value fails the entire report).

### falseRejection

- Population: runs whose ground truth is VERIFIED.
- Numerator: those that ended REJECTED or BLOCKED.
- Denominator: one per expected-VERIFIED run.
- Exclusions: REQUIRES_REVIEW outcomes — escalation to a human is not a
  rejection.
- Provisional SLO: **<= 0.02**.

### duplicateEffects — absolute safety gate

- Population: VERIFIED runs that produced at least one non-idempotent external
  effect.
- Numerator: non-idempotent effects in those runs applied more than once at
  the sink.
- Denominator: non-idempotent effects in those runs (each must apply exactly
  once).
- Exclusions: idempotent sinks — duplicate delivery absorbed by an idempotency
  key is safe.
- SLO: **== 0** (any nonzero value fails the entire report).
- Detected-and-blocked duplicates in non-VERIFIED runs are operational
  findings (`detectedDuplicateEffects` in report totals), not gate violations:
  the gate polices false acceptance.

### recoveryRate

- Population: runs flagged `recoveryAttempted` (retry after failure, UNKNOWN
  reconciliation, crash resume).
- Numerator: those with `recovered === true`.
- Denominator: one per recovery-attempted run.
- Exclusions: remediation-budget exhaustion — that is a review escalation, not
  a recovery attempt.
- Provisional SLO: **>= 0.90**.

### configResolutionTime

- Population: runs that attempted layered configuration resolution.
- Numerator: resolutions completing within the 250 ms provisional budget
  (including fail-closed rejections — failing fast counts as timely).
- Denominator: one per resolution attempt.
- Exclusions: runs on the default (no layered config) path.
- Provisional SLO: **>= 0.99**.

## Safety gates and report status

`generateReport` evaluates two absolute gates:

| Gate                     | SLI              | Condition     | Effect                    |
| ------------------------ | ---------------- | ------------- | ------------------------- |
| `false-verified-zero`    | falseVerified    | numerator > 0 | report `overall = FAILED` |
| `duplicate-effects-zero` | duplicateEffects | numerator > 0 | report `overall = FAILED` |

Everything else (availability, correctness, falseRejection, recoveryRate,
configResolutionTime) is **provisional assessment**: each SLI is reported with
value, numerator/denominator, Wilson 95% interval, and a `MET`/`UNMET`/
`INSUFFICIENT_DATA`/`NOT_EXERCISED` status against its provisional threshold.
A provisional miss does not fail the report; it is evidence, not a verdict.

## Provisional thresholds — explicit statement

**All numeric thresholds above are provisional.** They were chosen as
reasonable scaffolding for a deterministic synthetic corpus, not derived from
production behavior. Until post-deployment monitoring data exists:

- no threshold here may be cited as a production availability or correctness
  claim;
- autonomy enablement (gate G8) may not rely on corpus-only SLI evidence
  (plan decision D6);
- thresholds must be re-derived from deployment windows, and the derivation
  recorded, before any SLO becomes binding.

## Evaluation methodology and limitations

- Evidence source: the frozen 30-scenario corpus
  (`tests/evals/orchestration/corpus/`) run through
  `createEvaluationHarness`, with real config resolver/adapter/telemetry seams
  and a deterministic synthetic orchestration model. See
  `docs/evaluation-corpus.md` for the full methodology.
- High-risk scenarios require at least two independent blinded adjudicators
  with written rationales; inter-rater agreement is reported as mean pairwise
  observed agreement and average pairwise Cohen's kappa (null when degenerate).
- Sample sizes are small: Wilson intervals are wide and are reported, not
  hidden. No power analysis is claimed; the corpus is a floor for safety
  evidence, not a statistical study of production behavior.
- Known impossibilities carried from the plan (R2/D5/DR5): exactly-once
  arbitrary external effects, prompt cancellation, semantic correctness from
  metadata alone, and host authenticity cannot be proven by this controller;
  the SLIs measure the stack's decisions, not the outside world.
- What would invalidate these definitions: changing the corpus labels after a
  held-out run, tuning thresholds against held-out results, or counting
  REQUIRES_REVIEW outcomes as rejections — each is contamination by this
  document's rules.
