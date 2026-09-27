# Remaining-work final report (2026-09-27)

## Outcome

The continuous-run plan `.agents/plans/2026-09-27-remaining-work-continuous-run-csm.json`
(16 tasks) and the base plan `.agents/plans/2026-09-26-system-remediation-jev-embedding-csm.json`
(36 tasks) are **complete**. The base ledger reconciles to **36/36 complete** and both
plans carry a terminal `COMPLETE` cursor + journal state.

## What landed

- **T001–T005** — completion ledger/reconciler, the deterministic Jev decision
  service (coverage/budget/telemetry), the offline calibration program, and the
  trust-ladder schemas + never-Jev boundary.
- **T006** — trace-evidence substrate: production/fixture labels, bounded
  rotation, and `requireProduction` coverage (fails closed on a fixture-only run).
- **T007** — csm-browse guidance-only packaging + hermetic port tests (the unit
  suite no longer binds a fixed host port).
- **T008** — producer-descriptor lockstep (`csm-producer-descriptor/1` header).
- **T009** — portable `${CSM_SKILLS_DIR}` skill paths (no hardcoded install root).
- **T010** — drop-capture fails closed when required (request/egress/policy).
- **T011** — frozen `/1` evaluator receipt with a behavioural `/1`-vs-`/2` guard.
- **T012** — acceptance battery: check-suite, regen `--check`, corpus, traces,
  hygiene all green.
- **T013** — `scripts/verify-completion.mjs` + `csm-completion-verdict/1`; the
  final verdict is backed by **two independent reviewers** (reviewer-A,
  reviewer-B), both `complete`, with 36/36 per-task evidence.
- **T014** — owned paths committed; `--git-clean` green.
- **T015** — `main` pushed; `--ci-green --sha HEAD` green.
- **T016** — both plans marked complete; loop guard green.

## Verification

- `node scripts/check-suite.mjs` — OK (14 skills, 1169 checks)
- `node scripts/regen.mjs --check` — fresh
- `node scripts/validate-corpus-v2.mjs` — 99 records, 0 failures
- `node scripts/verify-traces.mjs` — ok (production traces)
- `node scripts/verify-completion.mjs --plan <base> --verdict <verdict>` — ok
- `node scripts/verify-completion.mjs --git-clean` — ok
- `node scripts/verify-completion.mjs --ci-green --sha HEAD` — ok
- `node csm-plan/lib/loop-evaluator.mjs guard --record <plan>` — no outstanding work

## Residuals (recorded, non-blocking)

- The trust ladder is enforced by test, not yet wired into a live gate, and the
  bare-label pipe is not yet consumed by production code (T005).
- Host-external trust anchoring remains deferred (recorded g3-ruling boundary).
