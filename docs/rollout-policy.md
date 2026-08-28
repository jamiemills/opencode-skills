# Rollout and Rollback Policy

Task reference: T009 of
`.agents/plans/2026-08-27-all-skills-config-production-assurance-csm.json`
(AC8 — shadow mode, contemporaneous-control canary, stop rules, and exercised
rollback before any autonomy). Implementation: `lib/rollout/`
(`shadow.mjs`, `canary.mjs`, `rollback.mjs`, `versions.mjs`,
`promotion.mjs`). Tests: `tests/rollout/`.

This policy governs how a configuration version moves toward production and
how it is removed when it misbehaves. It is a local controller policy: it
coordinates versions, decisions, and evidence; it does not claim to
atomically control arbitrary external effects (at-least-once plus
reconciliation remains the external-effect model, per D5/R2).

## Progression: shadow -> canary -> promote

| Stage                                | Mode                                                            | External effects                              | Exit                                                                     |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Shadow (`createShadowRunner`)     | read-only analysis                                              | none — record-only effect sinks on both sides | outcome parity + `assertZeroSideEffects`                                 |
| 2. Canary (`createCanaryController`) | isolated, time-limited, pinned version, contemporaneous control | only what the deployment authorizes           | all SLO evaluations healthy + samples/duration met, or a stop rule trips |
| 3. Promotion (`checkPromotionGates`) | gates G0–G8                                                     | n/a                                           | every gate `pass`; any `fail`/`blocked` blocks promotion                 |

A version never skips a stage. Shadow divergence does not itself stop
anything (it is analysis), but a canary is not started for a version whose
shadow comparison diverges without an accepted rationale.

## Shadow execution

- Both the candidate and the control config execute against a private clone
  of the same scenario input; mutating the received input is detected and
  reported (`inputMutated`).
- Effectful operations go through the record-only toolkit sink
  (`toolkit.effects.record`): intents are recorded with
  `applied: false`; there is no apply path in shadow mode.
- Comparisons: outcome match (canonical deep equality), latency delta and
  ratio (monotonic clock, injectable), and per-key resource deltas.
- `shadow.assertZeroSideEffects(runResult)` fails closed (throws
  `shadow-side-effect`) on any applied effect, any non-recorded-only
  effect entry, or any input mutation.

## Canary stop conditions (exact thresholds)

Stop rules are declared at controller creation (`stopRules`), deep-frozen,
and can never be changed while a canary runs. Defaults:

### Absolute (any occurrence -> immediate `rollback` decision)

| Rule                            | Threshold | Meaning                                                               |
| ------------------------------- | --------- | --------------------------------------------------------------------- |
| `falseVerified`                 | > 0       | a run the system declared VERIFIED that was not correct               |
| `unauthorizedEffects`           | > 0       | an effect outside authorized boundaries                               |
| `duplicateNonIdempotentEffects` | > 0       | a repeated effect to a non-idempotent sink                            |
| `provenanceMismatches`          | > 0       | observed config/artifact provenance does not match the pinned version |
| `telemetryBlindSpots`           | > 0       | any period where the canary cannot be observed                        |

Missing or non-finite measurements (either side's p99 latency, error rate,
sample counts, or any absolute counter) are treated as telemetry blindness
and stop the canary — the controller fails closed rather than guessing.

### Relative (vs the contemporaneous control)

| Rule        | Threshold                  | Boundary semantics                                                          |
| ----------- | -------------------------- | --------------------------------------------------------------------------- |
| p99 latency | canary > control x **1.5** | exactly 1.5x does not trip                                                  |
| error rate  | canary > control x **2**   | exactly 2x does not trip; a zero-error control means any canary error trips |

### Promotion preconditions (all required)

- last SLO evaluation healthy and zero violations over the canary's life —
  one stop decision permanently disqualifies the canary, even if later
  evaluations look healthy;
- accumulated samples >= `minSamples` (default 50);
- elapsed time >= `minDurationMs` (default 60 000 ms);
- canary state `running`.

Thresholds are provisional in the same sense as the SLO definitions
(`docs/slo-definitions.md`): deployment monitoring data must confirm them
before they are treated as production SLOs.

## Rollback procedure

`createRollbackController({ canary, versionRegistry })` executes, for a
canary id and a non-empty reason:

1. **Stop new dispatch immediately** — the bad version is fenced; fencing
   the active version clears the active pointer, so
   `authorizeDispatch` refuses before anything else happens.
2. **Fence the bad config version** — `fenced` is a terminal state; a
   fenced version can never be re-activated, re-dispatched, or marked
   known-good (cross-boundary retry prevention).
3. **Record reconciliation state for in-flight effects** — every in-flight
   effect reported by the canary becomes a reconciliation entry:
   `sink-idempotency-verification` for idempotent effects,
   `manual-verification-required` otherwise. Entries resolve only through
   `rollback.markReconciled` with a typed resolution
   (`duplicate-suppressed`, `effect-confirmed`, `compensated`,
   `verified-no-effect`).
4. **Preserve all receipts and history** — nothing is deleted: version
   records, activation history, fence evidence, canary evaluations, and
   rollback records are append-only.
5. **Move the active-version pointer to the last known good** — the most
   recently marked known-good version that is not fenced and not the bad
   version; if none exists the pointer stays null (dispatch remains
   blocked, which is the safe state).

`rollback.execute` is idempotent (a repeat returns the same record with
`repeated: true`) and records the measured `rollbackTimeMs`
(`rollback.getRollbackTime`).

### Rollback verification

`rollback.verify(canaryId)` confirms, with per-check evidence:

- `dispatch-blocked` — dispatch under the bad version is refused,
  including a live `assertDispatchable` probe;
- `pointer-moved` — the active pointer no longer references the bad
  version;
- `history-preserved` — the bad version's record still exists (fenced,
  with the original reason), version history did not shrink, and canary
  evaluation receipts survived;
- `in-flight-reconciled` — every in-flight effect reached `reconciled`.

A rollback is complete only when `verified` is true.

## Configuration versioning and active-pointer semantics

`createConfigVersionRegistry` owns version identity and traffic steering:

- States: `registered` -> `active` -> `superseded`; `fenced` is terminal
  and reachable from any other state. Registration is idempotent by
  effective-config digest (sha256 over the canonical config).
- There is exactly one active pointer. `activate` is atomic per call: the
  previous active version is marked superseded and the new one active,
  with an append-only activation history.
- Dispatch authorization (`authorizeDispatch` / `assertDispatchable`)
  allows only the single active, unfenced version; everything else —
  unknown, merely registered, superseded, or fenced — is refused with a
  typed reason.
- Known-good marks (`markKnownGood`) record evidence (e.g. the promoting
  canary id and sample counts) and define the rollback target; fenced
  versions can never be marked known-good.
- History is structurally append-only: there is no delete or rewrite API,
  and every returned record (including the frozen config snapshot) is
  deep-frozen.

## Promotion gates (G0–G8)

`checkPromotionGates(evidence)` evaluates all nine gates; the review is
promotable only when every gate is `pass`. Any `fail` or `blocked` gate
means not promotable.

| Gate | Name                     | Accepted evidence   |
| ---- | ------------------------ | ------------------- |
| G0   | contract safety          | local or deployment |
| G1   | config assurance         | local or deployment |
| G2   | authorization            | local or deployment |
| G3   | host execution assurance | local or deployment |
| G4   | durable execution        | local or deployment |
| G5   | independent acceptance   | deployment only     |
| G6   | telemetry completeness   | deployment only     |
| G7   | held-out evaluation      | deployment only     |
| G8   | canary/rollback          | deployment only     |

Evidence shape per gate: `{ passed, failed, details? }` — non-negative
integer counts. `failed > 0` -> `fail`; zero-total evidence -> `blocked`
(`no-positive-evidence`); absent -> `blocked`. Local evidence offered for
G5–G8 is ignored and flagged (`ignoredLocalEvidence`) — those gates answer
`deployment-evidence-required` until real deployment evidence exists.
Deployment evidence wins where both sources are present. Malformed
evidence (unknown gates, non-integer or negative counts, non-object
shapes) throws `invalid-evidence` — the check fails closed.

## Evidence required per gate

- **G0** — schema/contract suites green, including negative tests
  (unknown keys, revisions, malformed inputs).
- **G1** — config resolver determinism, security (path/limits/env),
  precedence, and provenance suites green with the effective digest.
- **G2** — forgery, replay, wrong-audience, wrong-digest, and
  authority-boundary tests green; config never widens authority.
- **G3** — host attestation verification green (authenticated host,
  trust anchors, final-sink reauthorization) — real host identity is
  inherently deployment evidence.
- **G4** — SQLite WAL store suites green: CAS, fencing, leases,
  crash/cancellation UNKNOWN semantics, receipt reconstruction.
- **G5** — independent (non-producer) acceptance of real artifacts by
  isolated reviewers/validators with recorded attestations.
- **G6** — terminal runs with correlated trace/metrics/audit/receipts,
  export-loss detection, and redaction verified on deployment traffic.
- **G7** — frozen held-out evaluation with blinded adjudication, recorded
  uncertainty, and thresholds confirmed against deployment-like data.
- **G8** — a representative-duration isolated canary against a
  contemporaneous control with attributable metrics, every stop rule
  exercised (including telemetry blindness), and a verified rollback
  drill on the deployment.

## Limitations and deployment blockers

Local shadow/canary/rollback tests are necessary, not sufficient (T009
prerequisite signal): representative workload, isolated control
population, deployment telemetry, accountable rollback authority, and
external-validity evidence remain production blockers. The local
controllers exercise the decision semantics only; production autonomy
stays disabled until every G0–G8 gate has observed deployment evidence
(D6).
