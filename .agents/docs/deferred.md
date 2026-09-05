# Deferred Work Ledger

Single reference for work carried as deferred records across plans
(embrace-journal-learnings T004; T010-T011 J4). Any `[blocked] DEFERRED` task
in a NON-COMPLETE plan must cite `[DEF:<slug>]` matching one of the IDs below —
the check-suite DEFERRED-citation rule enforces it. DEFERRED tasks in COMPLETE
plans are grandfathered (warn only, never a gate failure), so closed plans are
never edited by this rule.

## DEF-CI

- ID: DEF-CI
- Item: CI workflow + scheduled dependency audits
- Rationale: public-repository workflow; deferred by the user across four plans and kept out of every build. Local gates (check-suite, lefthook, per-suite test batteries) cover the non-CI halves of the findings that reference it (F-041 CI job, F-053 CI component, F-032 CI note).
- Owning plans: `2026-08-16-skills-remediation-csm.md` T013; `2026-08-19-consolidated-remaining-work-csm.md` T005
- User decision: 2026-08-16 (deferred by user)
- Status: open

## DEF-SANDBOX

- ID: DEF-SANDBOX
- Item: Chromium sandbox redesign
- Rationale: browser-containment redesign (Chromium launch/container security). Docker's default seccomp profile satisfies the profile component and the hardening half (`--cap-drop=ALL`, no-new-privileges, read-only rootfs) has shipped; the full redesign stays deferred.
- Owning plans: `2026-08-19-consolidated-remaining-work-csm.md` T006
- User decision: carried record (deferral recorded 2026-08-18, carried via consolidated T006)
- Status: open

## DEF-README

- ID: DEF-README
- Item: 2026-08-03 comprehensive README plan
- Rationale: the dated repo-README rewrite plan (`2026-08-03-comprehensive-readme-csm.md`, ready, never dispatched in its own build). Deferral lifted 2026-08-19 by user direction; the target plan was completed with zero corrective edits because later README rewrites already satisfied its criteria. Record retained for traceability.
- Owning plans: `2026-08-19-consolidated-remaining-work-csm.md` T007 (target `2026-08-03-comprehensive-readme-csm.md`)
- Status: resolved (deferral lifted 2026-08-19; target plan completed with zero corrective edits; record retained for traceability)
- User decision: deferred 2026-08-16; lifted 2026-08-19 (user direction)

## DEF-EVAL

- ID: DEF-EVAL
- Item: Live-LLM behavioral evaluation harness
- Rationale: deterministic-eval harness with canned transcripts and a stubbed model, asserting activation-boundary answers for the doc-only skills (F-017 tier-b). The deterministic corpus tier (F-017 tier-a) is complete; the live-LLM harness stays deferred by explicit user decision.
- Owning plans: `2026-08-19-consolidated-remaining-work-csm.md` T008
- User decision: 2026-08-18 (deferred by explicit user decision)
- Status: open

## DEF-RELEASE

- ID: DEF-RELEASE
- Item: Bootstrap publication, hosting, key rotation, post-publication replay
- Rationale: credential-gated public release: npm publish of the exact audited bytes, signed-envelope hosting at an immutable HTTPS URL with origin pin + re-sign, keyring rotation, post-publication registry-spec offline replay, steps.md re-sign. Includes the hard-enforcement halves kept publication-gated — F-045 (Ed25519 signature hard-required), F-046 (envelope required fields beyond the shipped `payload_index_sha256`), F-060 (engine-strict ceiling remainder). Every action requires explicit user approval and credentials per `bootstrap/release-checklist.md`.
- Owning plans: `2026-08-19-consolidated-remaining-work-csm.md` T009; `2026-09-05-defrelease-autonomy-gates-csm.json` T001/T005/T006
- User decision: carried record (release-stage, user-approved execution only)
- Status: open (halves resolved 2026-09-05 by defrelease-autonomy-gates T001: F-045 strict mode shipped flag-gated default-off — CSM_BOOTSTRAP_REQUIRE_SIGNATURE=1 in both validator copies, parity-pinned; F-046 remainder resolved: payload_index_sha256 is sufficient, no additional envelope fields specified; F-060 resolved: engines >=22 <25 shipped, bootstrap/.npmrc engine-strict=true is a dev-side guard only — consumer-side engine enforcement is impossible because npm always excludes .npmrc from packs; a ROOT-level .npmrc was evaluated and declined for this repo: the dev machine currently runs node v20.20.2, so repo-wide engine-strict would fail every local gate until the toolchain moves to node >=22. Remaining: the user-gated publication execution itself (T006 of the owning plan).)


## DEF-AUTONOMY-PROMOTION

- ID: DEF-AUTONOMY-PROMOTION
- Item: Autonomy promotion (deployment evidence for G5-G8, G3 ruling, promotion approval, policy widening)
- Rationale: deployment-evidence-gated per D6 — G5-G8 accept deployment-only evidence, so promotion cannot proceed until the user provides the deployment MVD and the accountable approval. Prepared by `.agents/plans/2026-09-05-defrelease-autonomy-gates-csm.json` (T003-T005); execution is the T007 user gate.
- Owning plans: `2026-09-05-defrelease-autonomy-gates-csm.json` T007
- User decision: deployment environment + promotion approval (user-owned)
- Status: open
