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
- Status: resolved (deferral lifted 2026-08-19; target plan completed with zero corrective edits)
- User decision: deferred 2026-08-16; lifted 2026-08-19 (user direction)
- Status: open (record retained; deferral lifted, target plan complete)

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
- Owning plans: `2026-08-19-consolidated-remaining-work-csm.md` T009
- User decision: carried record (release-stage, user-approved execution only)
- Status: open
