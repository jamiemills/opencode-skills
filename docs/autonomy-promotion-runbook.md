# Autonomy Promotion Runbook

User decision gate: `.agents/plans/2026-09-05-defrelease-autonomy-gates-csm.json` T007.
Autonomy remains **disabled** until every G0–G8 gate passes with real deployment
evidence and an accountable approval (D6). There is no runtime flag that flips
automatically: `checkPromotionGates` is procedural, and post-promotion widening
is policy data (`createAutonomyPolicy` inputs / deny-list) applied per this
runbook.

## Prerequisites

- Deployment MVD exists per `docs/autonomy-deployment.md` (user-confirmed)
- G3 ruling recorded (`.agents/docs/g3-ruling.md`) and applied per the ruling
- Publication completed (this pack's consumers run from the published release)

## Steps (ordered)

1. **Collect deployment evidence** over a representative duration on the MVD:
   - G5: independent acceptance records on real artifacts (per
     `docs/autonomy-deployment.md` G5 procedure)
   - G6: correlated receipt/trace/metrics/audit runs + telemetry-loss counts
   - G7: frozen held-out corpus confirmation against deployment-like data,
     with threshold confirmation records
   - G8: representative-duration canary vs contemporaneous control, every stop
     rule exercised (including induced telemetry blindness), and a rollback
     drill with `rollback.verify(canaryId) === true`
2. **Assemble the bundle**: `node scripts/collect-gate-evidence.mjs --evidence <dir>`
   (G5.json…G8.json per the collector's documented shapes; G0-G4 counts from
   their local suites; G3 per the ruling).
3. **Submit**: `checkPromotionGates(bundle)` — promotable requires every gate
   `pass`; any `fail`/`blocked` (including `deployment-evidence-required`)
   stops here. Record the full review JSON.
4. **Accountable approval (user only)**: record a signed approval entry —
   `{ decidedBy, decidedAt, sha, ciRun, gatesReviewRef, statement }` — in
   `.agents/evidence/`. The approver is the MVD's accountable operator.
5. **Widen autonomy (only after approval)**: per `docs/autonomy-guide.md`,
   adjust `createAutonomyPolicy` inputs (auto-approve set, caps, kill-switch,
   checkpoint/backup cadence) as policy data. The current default auto-approves
   exactly `csm-ddd`, `csm-review-python`, `csm-scan`; widening adds skills with
   recorded rationale. No enforcement code changes.
6. **Verify**: run one real workload through the widened policy on the MVD;
   confirm approvals, receipts, telemetry, and the kill switch behave per the
   guide. Record the transcript.

## Fallback

If any gate regresses or a stop rule trips post-promotion: fence the version
and execute the rollback procedure (`docs/rollout-policy.md:81-124`); autonomy
returns to the previous policy data (or disabled) immediately — the safe state
is dispatch blocked.

## Records to keep

checkPromotionGates review JSON, per-gate evidence bundles, canary/rollback
drill transcripts, the accountability approval entry, and the post-promotion
verification transcript.
