# Autonomy Deployment: Minimum Viable Deployment and Gate-Evidence Procedures

Defines what counts as "the deployment" for promotion gates G5–G8 (which accept
**deployment-only** evidence per `docs/rollout-policy.md:160-172` and
`lib/rollout/promotion.mjs`), and how each gate's evidence is collected. G0–G4
accept local evidence and are covered by their existing suites; this document
governs the deployment-only half.

## Minimum Viable Deployment (MVD)

The MVD is a **single-host opencode runtime** that:

1. Runs real skill workloads through `orchestrate()` (not synthetic fixtures)
   for a **representative duration** (>= the canary `minDurationMs` default of
   60 000 ms and >= `minSamples` default of 50 attributable samples).
2. Exports telemetry to durable storage: terminal receipts, correlated
   trace/metrics/audit events, telemetry-loss records, and progress snapshots.
3. Has an **attributable operator** — a named human accountable for approvals
   and the promotion decision (the OS-user trust anchor per
   `docs/autonomy-guide.md`).

Whether a given host qualifies as the MVD is confirmed by the user at the T007
decision gate of `.agents/plans/2026-09-05-defrelease-autonomy-gates-csm.json`.

## Per-gate evidence procedures

### G5 — independent acceptance (deployment only)

- Collector: independent (non-producer) reviewers accept real artifacts
  produced on the MVD. Each acceptance is recorded as an attested record:
  `{ artifactId, reviewerId (!= producer), evidenceRefs, decidedAt }`.
- Counting: `passed` = accepted artifacts; `failed` = rejected artifacts or
  acceptance attempts lacking a recorded attestation.
- Existing machinery: adversarial final-review records under `.agents/evidence/`
  are the attestation format precedent.

### G6 — telemetry completeness (deployment only)

- Collector: over the MVD run window, correlate every terminal run with its
  receipt, trace events, audit events, and progress snapshot; count runs where
  any stream is missing as failures. `telemetryLosses` records (already surfaced
  on receipts) count as failures.
- Counting: `passed` = fully correlated terminal runs; `failed` = runs with any
  missing stream or any recorded telemetry loss.

### G7 — held-out evaluation (deployment only)

- Collector: run the frozen held-out evaluation corpus (blinded adjudication)
  against deployment-like data from the MVD; confirm the provisional thresholds
  in `docs/slo-definitions.md` or record the confirmed values.
- Counting: `passed` = scenarios meeting confirmed thresholds; `failed` =
  scenarios below threshold or with unrecorded uncertainty.

### G8 — canary/rollback (deployment only)

- Collector: one representative-duration canary on the MVD against a
  contemporaneous control using `createCanaryController`, with **every** stop
  rule exercised (including an induced telemetry-blindness window) and a
  `createRollbackController` drill whose `rollback.verify(canaryId)` returns
  `verified: true`.
- Counting: `passed` = stop rules exercised + rollback verified; `failed` = any
  unexercised stop rule or unverified rollback.

## Evidence bundle assembly

`scripts/collect-gate-evidence.mjs --dry-run` assembles and shape-validates:

```json
{
  "deployment": { "G5": { "passed": 0, "failed": 0, "details": "" }, "G6": {}, "G7": {}, "G8": {} }
}
```

via `checkPromotionGates` (dry-run against synthetic counts proves shape
acceptance; real counts come from the procedures above). The promotion decision
is procedural and user-owned: see `docs/autonomy-promotion-runbook.md`.
