# .agents/ — process artifacts index

Index of CSM process artifacts. One line per artifact: date, goal, status
(`superseded-by` only where applicable).

## plans/

- `2026-08-03-comprehensive-readme-csm.md` — 2026-08-03 — rewrite the repo README as a progressive-disclosure index — status: complete (dispatched 2026-08-19 by user direction lifting the T007 deferral; deliverable already satisfied by later README rewrites, verified against this plan's criteria with zero corrective edits)
- `2026-08-03-csm-grill-skill-csm.md` — 2026-08-03 — create the csm-grill skill — status: complete
- `2026-08-03-csm-grill-brief-conformance-csm.md` — 2026-08-03 — align csm-grill brief output with csm-plan consumption — status: complete
- `2026-08-15-csm-review-skill-csm.md` — 2026-08-15 — create the csm-review skill — status: complete
- `2026-08-15-csm-review-write-discipline-csm.md` — 2026-08-15 — harden csm-review report write discipline — status: complete
- `2026-08-15-csm-suite-improvements-csm.md` — 2026-08-15 — suite-wide improvements (performance baseline + review follow-ups) — status: complete
- `2026-08-15-csm-tmux-bootstrap-csm.md` — 2026-08-15 — detached-tmux bootstrap for the orchestration skills — status: complete
- `2026-08-16-coherence-followups-hook-rollout-csm.md` — 2026-08-16 — suite-coherence follow-ups (staged snapshots, multi-user hardening, hygiene) plus authorized pre-commit hook rollout — status: complete
- `2026-08-16-skills-remediation-csm.md` — 2026-08-16 — remediate the 77 findings of the 2026-08-15 skills review (10 phases, T001–T014) — status: complete
- `2026-08-16-suite-coherence-contracts-csm.md` — 2026-08-16 — suite coherence via executable contracts (7 tasks, P1-P4) — status: complete
- `2026-08-17-agent-agnostic-installable-skills-csm.md` — 2026-08-17 — make the eight skills installable without cloning this repository — status: complete (closed as superseded; superseded-by `2026-08-18-universal-agent-skills-bootstrap-csm.md`)
- `2026-08-18-agent-agnostic-url-npx-bootstrap-csm.md` — 2026-08-18 — one-URL npx-driven bootstrap for the skills collection — status: complete (closed as superseded; superseded-by `2026-08-18-universal-agent-skills-bootstrap-csm.md`)
- `2026-08-18-remaining-active-suite-work-csm.md` — 2026-08-18 — execute the four active remaining-suite-work tasks (CDP auth, legacy retirement, test tiers, refinements) — status: complete
- `2026-08-18-remaining-suite-work-csm.md` — 2026-08-18 — remaining non-installer suite work (CDP auth, legacy retirement, test tiers, refinements) — status: complete (closed as superseded; superseded-by `2026-08-19-consolidated-remaining-work-csm.md`; deferred records moved to the consolidated plan)
- `2026-08-18-universal-agent-skills-bootstrap-csm.md` — 2026-08-18 — any-agent skills bootstrap via one URL with a signed payload manifest — status: complete
- `2026-08-19-consolidated-remaining-work-csm.md` — 2026-08-19 — consolidate remaining work (payload refresh, CDP-auth residuals, pre-release readiness, stale-plan closure) — status: complete (closed as superseded 2026-08-20; superseded-by `2026-08-20-t010-t011-csm.md`; T001-T004/T012 done in-suite, T010/T011 completed by the combined plan; T005-T009 deferred records live in `.agents/docs/deferred.md`)
- `2026-08-20-embrace-journal-learnings-csm.md` — 2026-08-20 — embrace journal learnings — status: complete (closed as superseded 2026-08-20; superseded-by `2026-08-20-t010-t011-csm.md`; T001-T007 executed as J1-J7 by the combined plan)
- `2026-08-20-t010-t011-csm.md` — 2026-08-20 — execute the consolidated plan's T010 (68 review findings) + T011 (7 journal-learnings tasks) in one build — status: complete (16/16 tasks; check-suite 621 -> 618 checks; deferred records in `.agents/docs/deferred.md`)
- `2026-08-20-skill-suite-efficiency-resilience-csm.md` — 2026-08-20 — skill-suite efficiency and quota resilience — status: complete
- `2026-08-20-cache-token-efficiency-csm.md` — 2026-08-20 — cache maximization and token efficiency (research operationalized) — status: complete
- `2026-08-20-csm-deep-research-skill-csm.md` — 2026-08-20 — build the csm-deep-research skill (grill->plan->build, 5 phases, hostile review) — status: complete
- `2026-08-20-oxlint-lefthook-precommit-csm.md` — 2026-08-20 — oxlint + lefthook pre-commit gate + pnpm-only installs — status: complete
- `2026-08-20-lint-strictness-enforcement-csm.md` — 2026-08-20 — lint strictness: fix 979 warnings, .oxlintrc.json quality bar, three-layer enforcement — status: in_progress (executing)

## docs/

- `csm-suite-performance-baseline-2026-08-15.md` — 2026-08-15 — performance baseline for the csm-scan suite — status: reference
- `csm-suite-review-2026-08-15.md` — 2026-08-15 — three-pass hostile review of the csm-suite-improvements build — status: reference
- `cache-token-efficiency-2026-08-20.md` — 2026-08-20 — cache maximization and token efficiency reference (DeepSeek caching, measured ratios, docs-only config block, monitor, toggle) — status: reference
- `gate-baselines.json` — 2026-08-20 — machine-recorded gate pass counts for check-suite (source for journal numbers) — status: reference
- `journal-lessons.md` — 2026-08-20 — 43 mined journal themes grouped by class with embracing mechanisms — status: reference
- `deferred.md` — 2026-08-20 — deferred-work ledger (5 carried records: CI/audit, sandbox, README plan, eval harness, publication) cited by `[DEF:<slug>]` in non-COMPLETE plans — status: reference

## reviews/

- `2026-08-15-skills-review.md` — 2026-08-15 — full adversarial review of all 8 skills (findings F-001..F-077) — status: remediated by `plans/2026-08-16-skills-remediation-csm.md`

## research/

- `2026-08-20-csm-deep-research-skill-research.md` — 2026-08-20 — seed research document for the csm-deep-research corpus — status: reference

## Retention

Completed plans are retained as process evidence; prune after 6 months or when
superseded. Reviews and docs are retained while their findings/numbers are
still cited (the remediation plan and baselines reference them).

## approaches/

- `2026-08-16-suite-coherence-contracts-approach.md` — 2026-08-16 — agreed approach behind the suite-coherence plan — status: complete
