# .agents/ — process artifacts index

Index of CSM process artifacts. One line per artifact: date, goal, status
(`superseded-by` only where applicable).

## plans/

- `2026-08-03-comprehensive-readme-csm.md` — 2026-08-03 — rewrite the repo README as a progressive-disclosure index — status: ready (saved, never dispatched)
- `2026-08-03-csm-grill-skill-csm.md` — 2026-08-03 — create the csm-grill skill — status: complete
- `2026-08-03-csm-grill-brief-conformance-csm.md` — 2026-08-03 — align csm-grill brief output with csm-plan consumption — status: complete
- `2026-08-15-csm-review-skill-csm.md` — 2026-08-15 — create the csm-review skill — status: complete
- `2026-08-15-csm-review-write-discipline-csm.md` — 2026-08-15 — harden csm-review report write discipline — status: complete
- `2026-08-15-csm-suite-improvements-csm.md` — 2026-08-15 — suite-wide improvements (performance baseline + review follow-ups) — status: complete
- `2026-08-15-csm-tmux-bootstrap-csm.md` — 2026-08-15 — detached-tmux bootstrap for the orchestration skills — status: complete
- `2026-08-16-skills-remediation-csm.md` — 2026-08-16 — remediate the 77 findings of the 2026-08-15 skills review (10 phases, T001–T014) — status: complete
- `2026-08-16-suite-coherence-contracts-csm.md` — 2026-08-16 — suite coherence via executable contracts (7 tasks, P1-P4) — status: in_progress

## docs/

- `csm-suite-performance-baseline-2026-08-15.md` — 2026-08-15 — performance baseline for the csm-scan suite — status: reference
- `csm-suite-review-2026-08-15.md` — 2026-08-15 — three-pass hostile review of the csm-suite-improvements build — status: reference

## reviews/

- `2026-08-15-skills-review.md` — 2026-08-15 — full adversarial review of all 8 skills (findings F-001..F-077) — status: remediated by `plans/2026-08-16-skills-remediation-csm.md`

## Retention

Completed plans are retained as process evidence; prune after 6 months or when
superseded. Reviews and docs are retained while their findings/numbers are
still cited (the remediation plan and baselines reference them).

## approaches/

- `2026-08-16-suite-coherence-contracts-approach.md` — 2026-08-16 — agreed approach behind the suite-coherence plan — status: complete
