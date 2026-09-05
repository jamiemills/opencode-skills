# .agents/ — process artifacts index

## Durable Artifact Identity

Instruction-led durable artifacts use a validated immutable run ID, generated once per invocation or supplied explicitly, in addition to date and normalized slug. Canonical paths are `<date>-<slug>-<run-id>-<artifact-type>`. The run ID binds the git root, slug, and artifact type; date/slug alone never establish ownership. Only an exact owner-matching nonterminal artifact may resume. Terminal artifacts are immutable and replacement, deletion, renaming, and mutable `latest` aliases are refused. Same-day duplicate slugs require a new run ID, while legacy date/slug artifacts remain read-only history. Delegated research is written only by csm-deep-research; parent skills record and verify the exact handoff path but do not write, rename, delete, or replace delegated artifacts. csm-review-python exclusively owns its doctrine report.

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
- `2026-08-23-tackle-remaining-review-findings-csm.md` — 2026-08-23 — tackle the remaining low and info findings from the 2026-08-23 review — status: ready; decisions recorded
- `2026-08-24-remove-token-efficiency-csm.md` — 2026-08-24 — remove the token-efficiency flag, gate, fixtures, tests, and live documentation — status: ready
- `2026-08-24-optional-progress-tracker-csm.md` — 2026-08-24 — add an optional horizontal progress tracker to every skill except upload and browse — status: ready
- `2026-08-24-ddd-clean-code-csm-gates-csm.md` — 2026-08-24 — conditionally apply DDD and clean-code design gates in csm-plan/csm-build — status: ready
- `2026-08-24-improve-csm-deep-research-skill-csm.md` — 2026-08-24 — improve csm-deep-research evidence contract and corpus validation — status: complete
- `2026-08-24-agent-harness-remediation-csm.md` — 2026-08-24 — remediate agent-harness, skills-framework, lifecycle, runtime, packaging, evaluation, documentation, and CI findings — status: complete
- `2026-08-25-hardening-remediation-csm.md` — 2026-08-25 — remediate security, concurrency, artifact, browser/upload, CI, and release-trust findings — status: complete
- `2026-08-25-json-only-rendered-skill-outputs-csm.md` — 2026-08-25 — implement JSON-only skill outputs with compatibility-controlled Markdown/HTML projections — status: in progress (T023 contract/bootstrap synchronization)
- `2026-08-26-json-migration-hardening-remediation-csm.md` — 2026-08-26 — harden JSON migration consumer edges, integrity, concurrency, and final evidence — status: in progress
- `2026-08-23-autoresearch-evaluator-csm-csm.md` — 2026-08-23 — implement the agreed autoresearch evaluator CSM skill — status: ready
- `2026-08-27-csm-orchestrate-csm.json` — 2026-08-27 — implement csm-orchestrate outer-loop controller — status: ready
- `2026-08-27-csm-orchestrate-remediation-csm.json` — 2026-08-27 — remediate csm-orchestrate approach-review findings — status: complete
- `2026-08-28-min-viable-autonomy-csm.json` — 2026-08-28 — minimum viable safe autonomy for csm-orchestrate — status: complete
- `2026-08-28-autonomy-safety-hardening-csm.json` — 2026-08-28 — close autonomy safety gaps from adversarial research — status: ready
- `2026-08-29-findings-human-rendering-csm.json` — 2026-08-29 — complete human-facing csm-review findings Markdown/HTML projections — status: ready
- `2026-08-29-progress-tracking-runtime-csm.json` — 2026-08-29 — implement default-on cross-skill progress and orchestrator aggregation — status: blocked at commit boundary
- `2026-08-29-all-human-rendering-optionals-csm.json` — 2026-08-29 — complete optional human rendering and projection follow-ups — status: quarantined (copied application-root plan; preserved pending provenance review)
- `2026-08-29-complete-progress-tracking-csm.json` — 2026-08-29 — complete progress tracking across skills, orchestration, and persistence — status: quarantined (copied application-root plan; preserved pending provenance review)
- `2026-08-29-durable-progress-persistence-csm.json` — 2026-08-29 — add durable browser-local progress persistence — status: quarantined (copied application-root plan; preserved pending provenance review)
- `2026-08-29-orchestrator-progress-model-csm.json` — 2026-08-29 — separate task, invocation, attempt, telemetry, and aggregate progress — status: retained historical complete plan
- `2026-08-29-progress-artifact-reconciliation-csm.json` — 2026-08-29 — reconcile copied progress artifacts and execution-root provenance — status: indexed successor/reconciliation plan
- `2026-08-29-progress-tracking-implementation-csm.json` — 2026-08-29 — implement progress tracking in the application checkout — status: superseded by `2026-08-30-progress-followups-csm.json` (terminal blocked history retained)
- `2026-08-29-skill-progress-tracking-csm.json` — 2026-08-29 — add default-on progress tracking to catalog skills — status: retained historical complete plan
- `2026-08-30-progress-followups-csm.json` — 2026-08-30 — close remaining progress-tracking operational gaps — status: superseded by `2026-09-04-skill-progress-tracker-enforcement-csm.json` (T004 outcome preserved; remaining tasks covered by the successor plan)
- `2026-08-30-patch-reliability-csm.json` — 2026-08-30 — prevent recurring patch-context failures with fail-closed editing guidance and contract tests — status: indexed active plan
- `2026-08-30-remove-opencode-csm.json` — 2026-08-30 — initial no-OpenCode executor replacement plan — status: superseded by `2026-08-30-remove-opencode-proper-csm.json`
- `2026-08-30-remove-opencode-proper-csm.json` — 2026-08-30 — implement no-OpenCode csm-orchestrate execution with original-goal parity — status: blocked at full route runtime coverage
- `2026-08-31-build-all-orchestrate-adapters-csm.json` — 2026-08-31 — build csm-build, csm-browse, and csm-autoresearch adapters with full orchestration proof — status: indexed active plan
- `2026-08-31-complete-all-orchestrate-adapters-csm.json` — 2026-08-31 — complete all remaining orchestrator adapters and release gates — status: blocked at uncommitted-baseline hook fixture
- `2026-08-31-remediate-browser-sandbox-release-blockers-csm.json` — 2026-08-31 — remediate browser and sandbox release blockers — status: blocked at unavailable host provider
- `2026-08-31-unblock-orchestrator-release-evidence-csm.json` — 2026-08-31 — unblock orchestrator release evidence — status: blocked at browser and sandbox gates
- `2026-08-31-docker-host-attested-sandbox-csm.json` — 2026-08-31 — implement Docker host-attested generated sandbox — status: in progress
- `2026-08-31-lean-mvp-orchestrator-release-build-csm.json` — 2026-08-31 — execute lean orchestrator release build — status: in progress
- `2026-09-01-close-live-evidence-ci-csm.json` — 2026-09-01 — close live evidence and CI gates — status: blocked
- `2026-09-01-minimum-unblock-csm.json` — 2026-09-01 — minimum persisted-review and CI unblock — status: blocked at runner prerequisites
- `2026-09-01-production-evidence-boundaries-csm.json` — 2026-09-01 — repair production evidence boundaries — status: blocked
- `2026-09-02-ci-runner-unblock-csm.json` — 2026-09-02 — unblock required CI runner gates — status: in progress
- `2026-09-03-ci-blockers-followup-csm.json` — 2026-09-03 — finish default-suite and adapter cleanup blockers — status: blocked at npm registry audit timeout
- `2026-09-03-npm-audit-ci-resilience-csm.json` — 2026-09-03 — add bounded npm audit retry resilience — status: superseded by `2026-09-04-replace-npm-audit-ci-gate-csm.json` (retries disproven by run 33833838983)
- `2026-09-04-replace-npm-audit-ci-gate-csm.json` — 2026-09-04 — replace npm audit CI gate with fail-closed pinned OSV audit — status: complete (run 33903446355 green on 0ec452a)
- `2026-09-04-skill-progress-tracker-enforcement-csm.json` — 2026-09-04 — enforce skill progress tracker records — status: complete (CI run 33928035357 / fa79f36 fully green)

## docs/

- `2026-08-30-progress-followups-t002-inventory.json` — 2026-08-30 — T002 untracked artifact inventory and retention evidence — status: reference
- `csm-suite-performance-baseline-2026-08-15.md` — 2026-08-15 — performance baseline for the csm-scan suite — status: reference
- `csm-suite-review-2026-08-15.md` — 2026-08-15 — three-pass hostile review of the csm-suite-improvements build — status: reference
- `cache-token-efficiency-2026-08-20.md` — 2026-08-20 — cache maximization and token efficiency reference (DeepSeek caching, measured ratios, docs-only config block, monitor, toggle) — status: retired
- `gate-baselines.json` — 2026-08-20 — machine-recorded gate pass counts for check-suite (source for journal numbers) — status: reference
- `journal-lessons.md` — 2026-08-20 — 43 mined journal themes grouped by class with embracing mechanisms — status: reference
- `deferred.md` — 2026-08-20 — deferred-work ledger (5 carried records: CI/audit, sandbox, README plan, eval harness, publication) cited by `[DEF:<slug>]` in non-COMPLETE plans — status: reference
- `csm-ddd-token-efficiency-liability.md` — 2026-08-23 — deferred liability: csm-ddd description vs the token-efficiency budget (reconciled by WORD_BUDGET re-pin 2026-08-23) — status: retired
- `csm-deep-research-skill-review-2026-08-20.md` — 2026-08-20 — csm-review audit of the csm-deep-research skill — status: reference
- `2026-08-30-remove-opencode-proper-t001-route-coverage.json` — 2026-08-30 — route/runtime coverage inventory for no-OpenCode execution — status: blocked reference

## reviews/

- `2026-08-15-skills-review.md` — 2026-08-15 — full adversarial review of all 8 skills (findings F-001..F-077) — status: remediated by `plans/2026-08-16-skills-remediation-csm.md`
- `2026-08-19-skills-review.md` — 2026-08-19 — adversarial review of the skills suite — status: reference
- `2026-08-21-skills-review.md` — 2026-08-21 — adversarial review of the skills suite — status: remediated by `plans/2026-08-21-review-remediation-csm.md`
- `2026-08-21-skills-review-2.md` — 2026-08-21 — follow-up review (second pass) — status: remediated by `plans/2026-08-21-review-remediation-csm.md`
- `2026-08-23-skills-review.md` — 2026-08-23 — comprehensive skills-suite review — status: reference
- `2026-08-24-opencode-skills-review.md` — 2026-08-24 — parallel full static review of skills, runtime, packaging, README, and release surfaces — status: reference
- `2026-08-25-opencode-skills-review.md` — 2026-08-25 — full static hardening review of skills, runtime, packaging, README, and release surfaces — status: reference
- `2026-08-27-csm-orchestrate-approach-review-20260827t130000z-a1b2c3d4e5f6-review.json` — 2026-08-27 — focused csm-orchestrate approach-fidelity and remediation review — status: complete
- `2026-08-29-opencode-skills-20260829t063809z-0916749aa6da-review.json` — 2026-08-29 — terminal adversarial review of the skills suite — status: retained historical review
- `2026-08-30-opencode-skills-20260830t120000z-orchestrate-review.json` — 2026-08-30 — focused csm-orchestrate host/execution-boundary review — status: incomplete review evidence

## research/

- `2026-08-29-progress-tracking-gaps-20260829t210000z-a7c4e91b2d6f-research.json` — 2026-08-29 — progress-tracking contract, runtime, aggregation, and persistence research — status: reference
- `2026-08-30-orchestrate-without-opencode-20260830t120000z-research.json` — 2026-08-30 — no-OpenCode executor architecture research — status: reference
- `2026-08-30-remove-opencode-plan-assurance-20260830t140000z-research.json` — 2026-08-30 — assurance review of the no-OpenCode implementation plan — status: reference
- `2026-08-31-build-all-orchestrate-adapters-20260831t040000z-research.json` — 2026-08-31 — deep research for all remaining orchestrator adapters and proof gates — status: reference
- `2026-09-05-orchestrate-release-validation-20260905t060229z-41bef79510aa-research.json` — 2026-09-05 — validate remaining orchestrator release work: build paths, completeness, necessity — status: reference (DEEP x hybrid; 4 tracks; challenge + judge PASS; verdict: list stale and incomplete, revised 9-item work list inside)
- `2026-08-31-lean-mvp-orchestrator-release-20260831t220000z-7c4d9e2a1b6f-research.json` — 2026-08-31 — lean orchestrator release research finding — status: reference
- `2026-08-29-json-renderers-human-findings-20260829t074546z-5fdd2180dc5f-research.json` — 2026-08-29 — JSON renderer and human-findings integration research — status: retained terminal research
- `2026-08-29-agentic-evals-repo-augmentation-20260829t090750z-df51a9921bc7-research.json` — 2026-08-29 — evals for agentic engineering practice and repo augmentation (taxonomy, practice, local inventory, tooling, failure modes; W1/W2/W3 change plan) — status: reference
- `2026-08-25-typed-json-interstage-payloads-research.md` — 2026-08-25 — authoritative standards and implementation guidance for typed JSON inter-stage payloads — status: reference
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
- `2026-08-24-headless-360-salesforce-research.md` — 2026-08-24 — Salesforce Headless 360 research finding — status: reference
- `2026-08-24-improve-csm-deep-research-skill-research.md` — 2026-08-24 — evidence-backed csm-deep-research improvement research — status: reference
- `2026-08-24-agent-harness-skills-framework-review-research.md` — 2026-08-24 — agent harness and skills framework comparison with repository remediation findings — status: reference
- `2026-08-25-repo-issues-deep-research-research.md` — 2026-08-25 — deep hybrid validation of repository hardening and additional security/concurrency issues — status: reference
- `2026-08-25-agent-friendly-repository-architecture-20260825t220516z-a1b2c3d4e5f6-research.md` — 2026-08-25 — agent-friendly repository architecture research finding — status: reference
- `2026-08-26-agent-friendly-repository-architecture-20260826t095339z-a1b2c3d4e5f6-research.json` — 2026-08-26 — deeper agent-friendly repository architecture research finding — status: reference
- `2026-08-26-csm-orchestrate-skill-architecture-20260826t180032z-a1b2c3d4e5f6-research.json` — 2026-08-26 — csm-orchestrate skill architecture research finding — status: reference
- `2026-08-26-csm-orchestrate-adversarial-assurance-20260826t200041z-a1b2c3d4e5f6-research.json` — 2026-08-26 — csm-orchestrate adversarial assurance research finding — status: reference
- `2026-08-27-csm-orchestrate-approach-review-20260827t055059z-a1b2c3d4e5f6-research.json` — 2026-08-27 — csm-orchestrate approach review finding — status: reference
- `2026-08-27-claude-code-dynamic-workflows-oss-expansion-20260827t130000z-e3f4a5b6c7d8-research.json` — 2026-08-27 — Claude Code dynamic workflows OSS expansion research — status: reference
- `2026-08-27-claude-code-dynamic-workflows-skills-20260827t120000z-d7e8f9a0b1c2-research.json` — 2026-08-27 — Claude Code dynamic workflows skills research — status: reference
- `2026-08-27-csm-orchestrate-three-pass-20260827t010000z-c3d4e5f6a1b2-research.json` — 2026-08-27 — csm-orchestrate three-pass consolidated research — status: reference
- `2026-08-27-csm-orchestrate-three-pass-20260827t230000z-a1b2c3d4e5f6-research.json` — 2026-08-27 — csm-orchestrate approach-fidelity research pass 1 — status: reference
- `2026-08-27-csm-orchestrate-three-pass-20260827t234500z-b2c3d4e5f6a1-research.json` — 2026-08-27 — csm-orchestrate approach-fidelity research pass 2 — status: reference
- `2026-08-27-csm-skills-sandbox-options-20260827t140000z-f4a5b6c7d8e9-research.json` — 2026-08-27 — local sandbox options research — status: reference
- `2026-08-27-shared-all-skills-config-security-20260827t235900z-c7d8e9f0a1b2-research.md` — 2026-08-27 — shared all-skills configuration security research — status: reference
- `2026-08-28-all-skills-config-production-assurance-20260827t020000z-d4e5f6a1b2c3-research.json` — 2026-08-28 — all-skills configuration and production assurance research — status: reference
- `2026-08-28-enterprise-features-skipped-20260828t160000z-c9d0e1f2a3b4-research.json` — 2026-08-28 — enterprise features skipped by minimum viable autonomy — status: reference
- `2026-08-28-skill-standards-packaging-20260828t055549z-9b7c6d5e4f3a-research.json` — 2026-08-28 — current standards, codification, packaging, and deployment for a skill suite (concurrent-session research; index line added by the T010 synchronization dispatch to satisfy the same-commit artifact-index gate) — status: reference
- `2026-08-26-json-migration-implementation-assessment-research.md` — 2026-08-26 — JSON migration implementation assessment — status: reference
- `2026-08-20-disney-plus-turkish-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ Turkish creative-assets schema artifact — status: reference
- `2026-08-20-disney-plus-uk-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ UK creative-assets schema artifact — status: reference
- `2026-08-20-disney-plus-us-creative-assets-schema.json` (under research/artifacts/) — 2026-08-20 — Disney+ US creative-assets schema artifact — status: reference
- `2026-08-22-python-idiomatic-reviewer-rules.json` (under research/artifacts/) — 2026-08-22 — 140-rule Python idiomatic reviewer ruleset (bundled input for csm-review-python) — status: reference

## Retention

Completed plans are retained as process evidence; prune after 6 months or when
superseded. Reviews and docs are retained while their findings/numbers are
still cited (the remediation plan and baselines reference them).
Untracked process artifacts are never deleted by reconciliation: current
artifacts are indexed, historical artifacts are retained, provenance-ambiguous
copies are quarantined, and explicit supersession is recorded without changing
the source file. Deletion remains awaiting explicit authorization.

## approaches/

- `2026-08-30-fix-patch-application-reliability-approach.json` — 2026-08-30 — canonical approach for diagnosing and fixing recurring patch-context failures — status: agreed
- `2026-08-16-suite-coherence-contracts-approach.md` — 2026-08-16 — agreed approach behind the suite-coherence plan — status: complete
- `2026-08-20-csm-deep-research-skill-approach.md` — 2026-08-20 — grill approach for the csm-deep-research skill — status: complete
- `2026-08-20-tdad-verification-layer-approach.md` — 2026-08-20 — grill approach for the TDAD verification layer — status: reference (plan not started)
- `2026-08-22-csm-make-tests-approach.md` — 2026-08-22 — grill approach for the csm-make-tests skill — status: complete
- `2026-08-22-csm-python-doctrine-review-approach.md` — 2026-08-22 — grill approach for the csm-review-python skill — status: complete
- `2026-08-22-ddd-repository-analyzer-approach.md` — 2026-08-22 — grill approach for the DDD repository analyzer (became csm-ddd) — status: complete
- `2026-08-23-autoresearch-evaluator-csm-approach.md` — 2026-08-23 — agreed CSM approach for the autoresearch evaluator skill — status: agreed
- `2026-08-25-json-only-rendered-skill-outputs-approach.md` — 2026-08-25 — agreed suite-wide JSON-only outputs with Markdown/HTML projections — status: agreed
- `2026-08-26-csm-orchestrate-approach.md` — 2026-08-26 — agreed csm-orchestrate outer-loop approach — status: agreed
- `2026-08-27-all-skills-config-production-assurance-approach.md` — 2026-08-27 — agreed all-skills configuration and production-assurance approach — status: agreed
- `2026-08-27-all-skills-config-production-assurance-csm.json` — 2026-08-27 — build all-skills configuration and production assurance — status: ready

## builds/

- `2026-08-27-csm-orchestrate-remediation-build.json` — 2026-08-27 — execute csm-orchestrate remediation plan — status: complete
- `2026-08-28-all-skills-config-production-assurance-build.json` — 2026-08-28 — execute the all-skills config production-assurance plan (T001-T010 dispatch log; per-dispatch cycles recorded in the plan journal) — status: in progress
- `progress-tracking-runtime-20260829.json` — 2026-08-30 — csm-build checkpoint for cross-skill progress implementation — status: blocked at commit boundary
- `progress-followups-20260830.json` — 2026-08-30 — csm-build checkpoint for progress follow-up work — status: indexed active checkpoint
- `patch-reliability-20260830.json` — 2026-08-30 — csm-build checkpoint for patch-context reliability work — status: indexed active checkpoint
- `remove-opencode-proper-20260830.json` — 2026-08-30 — csm-build checkpoint for no-OpenCode orchestrator implementation — status: blocked at full route coverage
- `build-all-orchestrate-adapters-20260831.json` — 2026-08-31 — csm-build checkpoint for all remaining orchestrator adapters — status: indexed active checkpoint
- `complete-all-orchestrate-adapters-20260831.json` — 2026-08-31 — csm-build checkpoint for completed adapter work and release gates — status: blocked at T008 hook fixture baseline
- `remediate-browser-sandbox-release-blockers-20260831.json` — 2026-08-31 — csm-build checkpoint for browser and sandbox remediation — status: blocked at unavailable host provider
- `unblock-orchestrator-release-evidence-20260831.json` — 2026-08-31 — csm-build checkpoint for release evidence — status: blocked at browser and sandbox gates
- `docker-host-attested-sandbox-20260831.json` — 2026-08-31 — csm-build checkpoint for Docker sandbox implementation — status: in progress
- `progress-tracking-implementation-20260829.json` — 2026-08-29 — csm-build checkpoint for progress implementation — status: retained terminal blocked history
- `lean-mvp-orchestrator-release-build-20260831.json` — 2026-08-31 — csm-build checkpoint for lean orchestrator release — status: in progress
- `close-live-evidence-ci-20260901.json` — 2026-09-01 — csm-build checkpoint for live evidence and CI closure — status: blocked
- `ci-blockers-followup-20260903.json` — 2026-09-03 — csm-build checkpoint for default-suite and adapter cleanup blockers — status: blocked at npm registry audit timeout
- `npm-audit-ci-resilience-20260904.json` — 2026-09-04 — csm-build checkpoint for npm audit CI resilience — status: superseded by `replace-npm-audit-ci-gate-20260904.json`
- `replace-npm-audit-ci-gate-20260904.json` — 2026-09-04 — csm-build checkpoint for the OSV audit CI gate replacement — status: complete
- `skill-progress-tracker-enforcement-20260904.json` — 2026-09-04 — csm-build checkpoint for skill progress tracker enforcement — status: complete (shipped on fa79f36; CI run 33928035357 fully green)

## progress/

- `2026-09-04-skill-progress-tracker-enforcement-20260904t200000z-progress.json` — 2026-09-04 — csm-build invocation progress for the skill-progress-tracker-enforcement build — status: complete
- `2026-09-05-orchestrate-release-validation-progress.json` — 2026-09-05 — csm-deep-research progress record for orchestrate release validation — status: complete
- `2026-09-05-production-evidence-t002-progress.json` — 2026-09-05 — csm-build progress record for production-evidence-boundaries T002 resume — status: complete
- `2026-09-05-orchestrate-release-completion-csm.json` — 2026-09-05 — complete remaining orchestration release work (T001-T005) — status: ready
- `2026-09-05-orchestrate-release-completion-plan-progress.json` — 2026-09-05 — csm-plan progress record for the release-completion plan — status: complete
- `2026-09-05-orchestrate-release-completion-build-progress.json` — 2026-09-05 — csm-build progress record for the release-completion build — status: active

## ddd/

- `2026-08-23-opencode-skills-ddd-report.md` — 2026-08-23 — csm-ddd self-analysis of this repository — status: complete
- `2026-08-23-opencode-skills-ddd-graph.json` — 2026-08-23 — graph companion of the self-analysis — status: complete
- `2026-08-23-modular-fixture-ddd-report.md` — 2026-08-23 — csm-ddd analysis of the modular test fixture — status: complete
- `2026-08-23-modular-fixture-ddd-graph.json` — 2026-08-23 — graph companion of the modular-fixture analysis — status: complete
- `2026-08-23-tangled-fixture-ddd-report.md` — 2026-08-23 — csm-ddd analysis of the tangled test fixture — status: complete
- `2026-08-23-tangled-fixture-ddd-graph.json` — 2026-08-23 — graph companion of the tangled-fixture analysis — status: complete
- `2026-08-23-csm-ddd-validation-notes.md` (under ddd/artifacts/) — 2026-08-23 — fixture-corpus + adjacency validation evidence — status: complete


## evidence/

- `run-g1-final-review.mjs` — 2026-09-05 — reproducible independent final release review for orchestrate-release-completion G1 (SHA 2f08063) — status: reference
- `review-run-7aefc81cc340ede2295111d59c67e1ee.json` — 2026-09-05 — accepted adversarial review record (csm-orchestrate-adversarial-review/2) — status: reference
- `review-artifact-run-7aefc81cc340ede2295111d59c67e1ee.json` — 2026-09-05 — review artifact record (csm-artifact/1) — status: reference
- `review-receipt-run-7aefc81cc340ede2295111d59c67e1ee.json` — 2026-09-05 — review receipt record (csm-review-receipt/1) — status: reference