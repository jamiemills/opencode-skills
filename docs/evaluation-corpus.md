# Evaluation Corpus

The evaluation corpus is the frozen, labeled workload that produces the evidence
behind the provisional SLI/SLO definitions in `docs/slo-definitions.md`. It is
offline and deterministic: no model calls, no network, no real credentials, no
production traffic. It exists to answer one question honestly — _does the
orchestration/config/assurance stack make the right safety and correctness
decisions on inputs it was not tuned against?_ — while stating clearly what it
cannot answer.

## Corpus splits

Corpora are separate JSON manifests under
`tests/evals/orchestration/corpus/`, each declared as `csm-eval-corpus/1`:

| Split                      | Manifest           | Scenarios | Purpose                                                  | Label policy                                                                                       |
| -------------------------- | ------------------ | --------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| development                | `development.json` | 12        | Harness wiring, scenario authoring, plumbing             | Labels may evolve **only before** any held-out evaluation run is recorded                          |
| validation                 | `validation.json`  | 8         | Harness and SLI plumbing check before held-out execution | Labels frozen for the evaluation round; not for threshold tuning                                   |
| held-out                   | `held-out.json`    | 10        | The scored evaluation                                    | `labelsFrozen: true` — labels must not be tuned, regenerated, or rewritten after evaluation starts |
| post-deployment monitoring | none yet           | —         | Production-window SLI measurement                        | Deferred until deployment data exists; thresholds stay provisional until then                      |

`createEvaluationHarness().verifyCorpusDisjoint(manifests)` enforces split
disjointness (no scenarioId in two splits) and reports per-split/per-category
coverage. The corpus-runner test fails on any contamination.

## Scenario shape

Each scenario is a closed, strictly validated object (unknown keys fail):

```json
{
  "scenarioId": "eval-corr-001",
  "name": "valid single phase completes",
  "category": "correctness",
  "riskClass": "low",
  "expected": { "outcome": "VERIFIED", "requiresReview": false },
  "setup": { "approachPhases": 1, "hostBehavior": "cooperative" }
}
```

- `expected.outcome` — ground truth from `{VERIFIED, REJECTED, REQUIRES_REVIEW, BLOCKED}`.
- Optional expected flags tighten the label: `requiresReview`, `configRejected`,
  `authorityPreserved`, `attempts`, `recovered`.
- `setup.hostBehavior` — the deterministic host/child behavior the synthetic
  orchestration exercises (18 closed values, e.g. `cooperative`,
  `forged-provenance`, `timeout-after-effect`, `duplicate-dispatch-non-idempotent`,
  `remediation-loop`).
- `setup.configLayers` — `{project, user, run}` namespace fragments resolved
  through the **real** config seams (`expandEnvRefs`, `mergeConfig`,
  `validateConfigEnvelope`, and the real per-skill adapters).
- `setup.configExpectation` — assertions on the merged effective config
  (`{path, value}` pairs), proving precedence decisions rather than trusting
  them.

Ground-truth labels describe **what must happen**, never what the system
currently does; a scenario whose label was reverse-engineered from the
implementation would be contamination, not coverage.

## Category taxonomy (30 scenarios)

| Category           | Count | Covers                                                                                                                                                                                                |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| correctness        | 10    | valid single/multi-phase approaches; uncooperative host; schema-invalid output; empty plan; review escalation; deterministic rebuild; wrong-audience attestation; missing provenance; mid-run refusal |
| config-precedence  | 5     | user-over-project, run-over-user, recursive sibling merge, wholesale array replacement, missing `${VAR}` fails closed                                                                                 |
| authority-boundary | 5     | config cannot grant permissions, exceed schema ceilings (`maxParallelism`), smuggle credential keys, or target unknown namespaces; bounded field accepted with authority untouched                    |
| recovery           | 5     | retry after transient failure; timeout-after-effect with/without late evidence; crash resume skipping completed phases; re-dispatch refused while UNKNOWN open                                        |
| adversarial        | 5     | forged provenance; stale artifact swapped after attestation; duplicate dispatch to idempotent vs non-idempotent sinks; remediation-loop budget exhaustion                                             |

Distribution across splits: development 12, validation 8, held-out 10 — every
category appears in every split where feasible so held-out scoring is not a
category surprise.

## Methodology

1. **Real seams, synthetic orchestration.** Config resolution, per-skill
   adapters, canonical digests, and telemetry emission/redaction are the real
   modules (`lib/config`, `csm-*/lib/config.mjs`,
   `csm-orchestrate/lib/telemetry.mjs`). The orchestration loop itself is a
   deterministic model implementing the semantics established in T005/T006/T007
   (UNKNOWN on ambiguous timeout, one-time approvals, remediation budget,
   producer metadata never authoritative). It does **not** call `orchestrate()`.
2. **Fail-closed config path.** Every configured namespace must resolve through
   a registered real adapter; namespaces without a registered adapter are
   rejected (`no-registered-adapter`), mirroring the skill-owned-namespace rule.
3. **Correlated telemetry per run.** Each scenario run emits real telemetry
   events (config resolution, dispatch, retry/timeout/reconciliation,
   remediation, terminal) plus a terminal receipt; the report records
   completeness per run.
4. **No sensitive material in artifacts.** Rejected config fragments never
   enter results or telemetry payloads — only typed reason codes. The
   corpus-runner test asserts the credential-shaped fixture value and key names
   are absent from serialized results.
5. **Blinded double adjudication** (`lib/evals/orchestration/adjudication.mjs`):
   high-risk scenarios receive at least two independent adjudicators; verdicts
   stay hidden until all required adjudicators have recorded; inter-rater
   agreement is reported as mean pairwise observed agreement plus average
   pairwise Cohen's kappa (kappa is null when marginal distributions are
   degenerate — that limitation is reported, not hidden).
6. **Reports carry uncertainty.** `generateReport` computes every proportion
   SLI with a Wilson 95% interval, marks all thresholds provisional, evaluates
   the two absolute safety gates, and embeds the limitations list.

## Safety gates

Two outcomes are absolute and fail the report regardless of everything else:

- **False VERIFIED** — the system declared VERIFIED where ground truth says
  otherwise (count must be 0).
- **Duplicate non-idempotent effects inside VERIFIED runs** (count must be 0).

Detected-and-blocked duplicates (REQUIRES_REVIEW/BLOCKED outcomes) are recorded
as operational findings, not gate violations: the gate polices _false
acceptance_, mirroring the false-VERIFIED gate.

## Provenance and integrity

Each manifest records `createdAt`, `labelsFrozen`, `methodology` (this
document), and notes. `runCorpus` computes a canonical corpus digest
(sha256 over corpusId, split, and the ordered scenarioIds) embedded in the
report's `corpusProvenance`, so a report can always be traced to the exact
manifest content. The held-out manifest must declare `labelsFrozen: true`;
the loader rejects it otherwise.

## Limitations

- Synthetic corpus, synthetic hosts: this evidence is **necessary, not
  sufficient**. Deployment-like corpora, real adjudicator independence, real
  trust anchors, and external-validity evidence remain production gates
  (per plan T008 `prerequisiteSignal` and D6).
- 30 scenarios produce wide Wilson intervals; the harness reports them rather
  than pretending precision. Sample-size and confidence-bound rationale:
  Wilson score intervals at z=1.96, chosen for correct small-sample coverage of
  proportions, including the 0-boundary.
- The deterministic model encodes the T005/T006/T007 semantics as understood at
  authoring time; divergence between model and real orchestrator would need the
  separate integration suites (`tests/orchestrate-*.test.mjs`,
  `tests/orchestration-store/`) to catch.
- Thresholds in the companion SLO document are provisional scaffolding; they
  must be re-derived from post-deployment monitoring data before any autonomy
  decision (G8) relies on them.
