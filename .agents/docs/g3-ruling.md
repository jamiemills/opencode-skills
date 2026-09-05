# G3 Ruling: Host Execution Assurance Evidence Source

**Status: RULED 2026-09-05 — Option (b): defer to deployment.**
Decided by the user (jamiemills). G3 will be submitted with deployment counts
once the MVD exists (T007); the local bundle below remains recorded as
supporting evidence only. Originally recorded by
`.agents/plans/2026-09-05-defrelease-autonomy-gates-csm.json` T003.

## The question

Promotion gate G3 ("host execution assurance") accepts **local or deployment**
evidence per `docs/rollout-policy.md:158` and `lib/rollout/promotion.mjs`
(`evidenceSources: ["local", "deployment"]`). The shipped Docker-attested
sandbox produces verified, schema-frozen attestation bundles today
(`csm-autoresearch/lib/providers/docker.mjs:560-629`; host-assurance suites
20/20 green on 2026-09-05), so a **local** G3 evidence bundle is mechanically
producible now.

However, the gate's defined evidence class is broader
(`rollout-policy.md:182-184`): "host attestation verification green
(authenticated host, trust anchors, final-sink reauthorization)". Two pieces of
that definition have **no implementation**: trust anchors beyond the OS-user
boundary (`docs/autonomy-guide.md:8-10`; `attestation.mjs` has keyEpoch
structure but no keys or signatures), and final-sink reauthorization (zero code
matches outside docs/research). `docs/production-readiness-report.md:28,91-93`
therefore marks G3 **BLOCKED** on real host identity.

## Options

1. **Accept-with-documented-deviation**: submit the local Docker-attested
   bundle as G3 local evidence (the gate code permits it). Counts derive from
   the host-assurance suites and the sandbox attestation probe (both green:
   host-assurance 20/20; probe `{status: "available", verified: true,
   provider: "docker", execution: {status: "ok"}}` on 2026-09-05).
   - Consequence: G3 passes on sandbox-attestation evidence while the wider
     definition (authenticated host, trust anchors, final-sink reauthorization)
     remains unimplemented. This is a **recorded deviation** against
     `rollout-policy.md:182-184` — a locally accepted G3 must never be
     described as "gate green" against the full definition.
2. **Defer to deployment (recommended)**: G3 waits for deployment evidence
   like G5-G8. The local bundle is still recorded as supporting evidence but
   the gate submits only deployment counts once the MVD exists.

## Recommendation

Option 2 (defer to deployment) — it preserves D6's stated intent that
production autonomy waits for real deployment evidence, and the cost is only
that autonomy promotion waits for the MVD (which T007 requires anyway).

## Bundle (recorded either way)

- Host-assurance suites: 20 passed / 0 failed (2026-09-05)
- Docker sandbox attestation probe: verified, provider docker, execution ok
  (2026-09-05)
- Evidence file (counts in `checkPromotionGates` shape):
  `.agents/evidence/g3-bundle.json`
