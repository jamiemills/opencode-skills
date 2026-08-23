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
- `2026-08-20-lint-strictness-enforcement-csm.md` — 2026-08-20 — lint strictness: fix 979 warnings, .oxlintrc.json quality bar, three-layer enforcement — status: complete
- `2026-08-23-csm-ddd-skill-csm.md` — 2026-08-23 — build the csm-ddd skill (DDD repository analyzer) — status: complete
- `2026-08-23-csm-plan-build-ddd-intake-csm.md` — 2026-08-23 — make csm-plan/csm-build optionally consume csm-ddd artifacts via input triage — status: complete
- `2026-08-20-deep-research-browse-fallback-csm.md` — 2026-08-20 — csm-deep-research fallback to csm-browse when pages need a browser — status: complete
- `2026-08-20-tdad-verification-machinery-csm.md` — 2026-08-20 — TDAD phase 1 verification machinery in csm-build — status: ready (not started)
- `2026-08-21-deep-research-commit-on-save-csm.md` — 2026-08-21 — csm-deep-research commit-at-SAVED flow — status: complete
- `2026-08-21-review-remediation-csm.md` — 2026-08-21 — remediate the 2026-08-21 audit findings — status: complete
- `2026-08-22-csm-make-tests-skill-build-csm.md` — 2026-08-22 — build the csm-make-tests skill — status: complete
- `2026-08-22-csm-python-doctrine-review-skill-build-csm.md` — 2026-08-22 — build the csm-review-python skill — status: complete
- `2026-08-23-fix-high-medium-findings-csm.md` — 2026-08-23 — fix all high and medium findings from the 2026-08-23 review (22 tasks) — status: in_progress

## docs/

- `csm-suite-performance-baseline-2026-08-15.md` — 2026-08-15 — performance baseline for the csm-scan suite — status: reference
- `csm-suite-review-2026-08-15.md` — 2026-08-15 — three-pass hostile review of the csm-suite-improvements build — status: reference
- `cache-token-efficiency-2026-08-20.md` — 2026-08-20 — cache maximization and token efficiency reference (DeepSeek caching, measured ratios, docs-only config block, monitor, toggle) — status: reference
- `gate-baselines.json` — 2026-08-20 — machine-recorded gate pass counts for check-suite (source for journal numbers) — status: reference
- `journal-lessons.md` — 2026-08-20 — 43 mined journal themes grouped by class with embracing mechanisms — status: reference
- `deferred.md` — 2026-08-20 — deferred-work ledger (5 carried records: CI/audit, sandbox, README plan, eval harness, publication) cited by `[DEF:<slug>]` in non-COMPLETE plans — status: reference
- `csm-ddd-token-efficiency-liability.md` — 2026-08-23 — deferred liability: csm-ddd description vs the token-efficiency budget (reconciled by WORD_BUDGET re-pin 2026-08-23) — status: reference
- `csm-deep-research-skill-review-2026-08-20.md` — 2026-08-20 — csm-review audit of the csm-deep-research skill — status: reference

## reviews/

- `2026-08-15-skills-review.md` — 2026-08-15 — full adversarial review of all 8 skills (findings F-001..F-077) — status: remediated by `plans/2026-08-16-skills-remediation-csm.md`
- `2026-08-19-skills-review.md` — 2026-08-19 — adversarial review of the skills suite — status: reference
- `2026-08-21-skills-review.md` — 2026-08-21 — adversarial review of the skills suite — status: remediated by `plans/2026-08-21-review-remediation-csm.md`
- `2026-08-21-skills-review-2.md` — 2026-08-21 — follow-up review (second pass) — status: remediated by `plans/2026-08-21-review-remediation-csm.md`

## research/

- `2026-08-20-csm-deep-research-skill-research.md` — 2026-08-20 — seed research document for the csm-deep-research corpus — status: reference
- `2026-08-20-characterization-testing-research.md` — 2026-08-20 — repo behavior-continuity (characterization) testing techniques — status: reference
- `2026-08-20-disney-plus-turkish-us-creative-assets-research.md` — 2026-08-20 — Disney+ Turkish and US creative assets research — status: reference
- `2026-08-20-disney-plus-uk-creative-assets-research.md` — 2026-08-20 — Disney+ UK creative assets research — status: reference
- `2026-08-20-llm-wiki-research.md` — 2026-08-20 — building and maintaining an LLM-enhanced wiki — status: reference
- `2026-08-22-characterization-skill-implementation-research.md` — 2026-08-22 — characterization-suite skill implementation research — status: reference
- `2026-08-22-clojure-to-python-llm-migration-research.md` — 2026-08-22 — deterministic LLM-driven Clojure-to-Python migration research — status: reference
- `2026-08-22-ddd-repo-analysis-refactoring-research.md` — 2026-08-22 — domain-driven repository analysis for refactoring research — status: reference
- `2026-08-22-pep20-idiomatic-python-consolidated-research.md` — 2026-08-22 — PEP 20 and idiomatic Python practice consolidated research (feeds csm-review-python doctrine) — status: reference
- `2026-08-23-llm-hill-climbing-autoresearch-skill-research.md` — 2026-08-23 — LLM-guided hill-climbing and autoresearch skill architecture — status: reference
- `2026-08-20-disney-plus-turkish-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ Turkish creative-assets schema artifact — status: reference
- `2026-08-20-disney-plus-uk-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ UK creative-assets schema artifact — status: reference
- `2026-08-20-disney-plus-us-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ US creative-assets schema artifact — status: reference
- `2026-08-22-python-idiomatic-reviewer-rules.json` (under research/artifacts/) — 2026-08-22 — 140-rule Python idiomatic reviewer ruleset (bundled input for csm-review-python) — status: reference

## Retention

Completed plans are retained as process evidence; prune after 6 months or when
superseded. Reviews and docs are retained while their findings/numbers are
still cited (the remediation plan and baselines reference them).

## approaches/

- `2026-08-16-suite-coherence-contracts-approach.md` — 2026-08-16 — agreed approach behind the suite-coherence plan — status: complete
- `2026-08-20-csm-deep-research-skill-approach.md` — 2026-08-20 — grill approach for the csm-deep-research skill — status: complete
- `2026-08-20-tdad-verification-layer-approach.md` — 2026-08-20 — grill approach for the TDAD verification layer — status: reference (plan not started)
- `2026-08-22-csm-make-tests-approach.md` — 2026-08-22 — grill approach for the csm-make-tests skill — status: complete
- `2026-08-22-csm-python-doctrine-review-approach.md` — 2026-08-22 — grill approach for the csm-review-python skill — status: complete
- `2026-08-22-ddd-repository-analyzer-approach.md` — 2026-08-22 — grill approach for the DDD repository analyzer (became csm-ddd) — status: complete
- `2026-08-23-autoresearch-evaluator-csm-approach.md` — 2026-08-23 — agreed CSM approach for the autoresearch evaluator skill — status: agreed
## ddd/

- `2026-08-23-opencode-skills-ddd-report.md` — 2026-08-23 — csm-ddd self-analysis of this repository — status: complete
- `2026-08-23-opencode-skills-ddd-graph.json` — 2026-08-23 — graph companion of the self-analysis — status: complete
- `2026-08-23-modular-fixture-ddd-report.md` — 2026-08-23 — csm-ddd analysis of the modular test fixture — status: complete
- `2026-08-23-modular-fixture-ddd-graph.json` — 2026-08-23 — graph companion of the modular-fixture analysis — status: complete
- `2026-08-23-tangled-fixture-ddd-report.md` — 2026-08-23 — csm-ddd analysis of the tangled test fixture — status: complete
- `2026-08-23-tangled-fixture-ddd-graph.json` — 2026-08-23 — graph companion of the tangled-fixture analysis — status: complete
- `2026-08-23-csm-ddd-validation-notes.md` (under ddd/artifacts/) — 2026-08-23 — fixture-corpus + adjacency validation evidence — status: complete
