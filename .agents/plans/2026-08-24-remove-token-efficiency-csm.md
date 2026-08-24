format: csm-plan/1

# Remove Token Efficiency CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan.
- This plan removes the token-efficiency feature entirely; it does not introduce a replacement toggle or budget system.
- Risk summary: 6 tasks — 2 low, 4 standard. T002/T004/T005/T006 require independent integration review because they alter gates, live instructions, generated outputs, and repository-wide verification. No production services, credentials, or destructive external actions.

## Control

- Plan ID: remove-token-efficiency
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24T18:20:00+0000 final verification passed after repairing the unrelated csm-scan renderer baseline.
- Last model/run: primary csm-plan session 2026-08-24
- Next transition: none
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Remove the repository’s token-efficiency flag and its live behavior completely. Remove the toggle resolver, repository config, fixtures, dedicated tests, check-suite budget/volatile branches, cache-health gating, live instructions, and current-reference claims. Preserve completed historical plans, research, reviews, and journal evidence as archive; clearly mark current reference documents retired rather than rewriting history.

## Acceptance Criteria

1. No live runtime/config/test/fixture path contains token-efficiency toggle handling, `isEnabled`, `parseToggle`, `findToggleFile`, `WORD_BUDGET`, or `VOLATILE_DESC_RE`. -> T001,T002,T003
2. `cache-health` runs unconditionally for its existing fixed model scope and retains parsing, aggregation, cost, `--days`, SQL, and failure handling. -> T003
3. Live AGENTS/README/check-suite documentation no longer presents token efficiency as an active feature; historical records remain intact or are explicitly labeled retired. -> T004
4. Generated artifacts remain consistent and no payload is unexpectedly changed. -> T005
5. Targeted, hook, lint, check, and full test suites pass; final live-reference audit reports no non-archival matches. -> T006

## Current-State Evidence

- `scripts/lib/token-efficiency.mjs` is the live toggle resolver; `.agents/token-efficiency.json` is the repository toggle.
- `scripts/check-suite.mjs` imports the resolver and owns `VOLATILE_DESC_RE`, `WORD_BUDGET`, `descWordTotal`, and enabled/disabled branches.
- `scripts/cache-health.mjs` imports the resolver and exits early when the toggle is disabled; its fixed model filter is `%deepseek-v4-flash%`.
- `tests/token-efficiency.test.mjs` and `tests/fixtures/token-efficiency/**` are dedicated feature tests/fixtures.
- `tests/cache-health.test.mjs` creates a token-efficiency fixture toggle for its CLI path.
- Live docs include `AGENTS.md`, `README.md`, `.agents/README.md`, and current reference docs under `.agents/docs/`.
- Historical plans/research/approaches/reviews contain feature references that document prior work and must not be falsified.
- `pack-bootstrap.mjs` has no token-efficiency mapping; `payload-index.json` has no token-efficiency entry. Payload drift checks remain required as proof.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | Remove the feature rather than preserve compatibility with the disabled toggle. | user-dictated | User explicitly wants the token-efficiency flag removed entirely. | decided |
| D2 | Keep cache-health’s fixed deepseek-v4-flash scope; remove only toggle refusal/gating. | evidence-based | Existing report/query behavior is independent of the toggle. | decided |
| D3 | Preserve historical plans, research, reviews, approaches, and journal lessons unchanged; add an explicit `Retired reference: token-efficiency feature removed` banner to the two current `.agents/docs` references and mark their `.agents/README.md` entries retired. | archive policy | Historical artifacts are durable process evidence; current docs must not remain active guidance. | decided |
| D4 | No payload copy/index change is expected; run payload drift validation anyway. | evidence-based | Scout found no payload mapping for token-efficiency files. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | What is live versus historical? | Read-only grep/glob/scout | No repository writes or execution | Live resolver, gate, cache-health, config, fixtures, tests, docs isolated; historical corpus identified | Six tasks cover removal and verification without rewriting history |
| R2 | Does cache-health need a replacement feature? | Read-only source inspection | No writes | It already has fixed model filtering, parsing, aggregation, cost, and subprocess errors | Remove toggle branch only; retain report behavior |
| R3 | Does bootstrap payload need regeneration? | Read-only pack mapping/index inspection | No writes | No token-efficiency mapping/index entry | Run drift check; do not hand-edit payload/index |

## Discovered Requirements

- `scripts/check-suite.mjs` must no longer import or resolve token-efficiency state.
- `.agents/token-efficiency.json` must be removed from the artifact-index exemption once the file is deleted.
- `.lefthook.yml` and `.oxfmtignore` contain fixture-specific exclusions that must be removed with the fixtures.
- `tests/check-suite.test.mjs` uses tracked-file snapshots; deleted files must be reflected in the staged/committed corpus before full verification.
- Cache-health CLI tests must prove execution proceeds without any toggle/config file.
- Historical documents are immutable evidence by default; only live docs/current references receive retirement wording.

## Design

- **Removal:** delete `scripts/lib/token-efficiency.mjs`, `.agents/token-efficiency.json`, `tests/token-efficiency.test.mjs`, and `tests/fixtures/token-efficiency/**`.
- **Gate simplification:** remove resolver import, volatile regex, word budget, word accumulation, enabled/disabled notices, budget checks, and toggle-file index exemption from check-suite. Preserve all unrelated frontmatter/section/state checks.
- **Cache-health:** always execute the existing fixed-model report/query path; retain current read-only DB error handling and `--days` behavior.
- **Documentation:** remove active instructions from AGENTS.md and README.md; add the exact retirement banner to the two current token-efficiency docs; update `.agents/README.md` entries while preserving completed plans/research/reviews/approaches/journal content byte-for-byte.
- **Generated consistency:** run existing sync/matrix/pack checks, but do not regenerate payload unless a source change actually requires it.

## Execution Graph

- G1 parallel: T001 runtime/config/tests deletion; T003 cache-health rewrite; T004 live/history documentation.
- G2 serial after G1: T002 check-suite simplification, because it depends on deleted fixtures/config and affects shared test expectations.
- G3 final: T005 generated consistency and T006 complete validation/reference audit.

## Numbered Plan

1. [completed] Remove toggle/config/fixture/test surfaces
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `scripts/lib/token-efficiency.mjs`, `.agents/token-efficiency.json`, `tests/token-efficiency.test.mjs`, `tests/fixtures/token-efficiency/**`, `.lefthook.yml`, `.oxfmtignore`
   - Not in scope: check-suite logic, cache-health logic, historical docs
   - Spike candidate: none
   - Actions: delete the resolver/config/dedicated tests/fixtures; remove only their lefthook and formatter exclusions.
   - Acceptance signal: `bash -euc 'test ! -e scripts/lib/token-efficiency.mjs; test ! -e .agents/token-efficiency.json; test ! -e tests/token-efficiency.test.mjs; test ! -d tests/fixtures/token-efficiency'`
   - Validation: repository-wide live-reference search excludes only documented archive paths.
   - Acceptance evidence: deletion list and search output.
   - Repair attempts: 0
   - Recovery note: deletion is isolated and reversible through the build commit if required.

2. [completed] Remove token-efficiency branches from check-suite
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `scripts/check-suite.mjs`, check-suite tests only where assertions reference removed behavior
   - Not in scope: unrelated frontmatter validation, cache-health, historical docs
   - Spike candidate: none
   - Actions: remove resolver import/call, `VOLATILE_DESC_RE`, `WORD_BUDGET`, description accumulation, enabled/disabled notices, budget/volatile checks, and `.agents/token-efficiency.json` artifact-index exemption. Keep all ordinary skill frontmatter checks.
   - Acceptance signal: `node --check scripts/check-suite.mjs && node --test tests/check-suite.test.mjs && make lint && bash -euc '! rg -n "isEnabled|parseToggle|findToggleFile|WORD_BUDGET|VOLATILE_DESC_RE|descWordTotal|token-efficiency" scripts/check-suite.mjs'` exits 0.
   - Validation: `node scripts/check-suite.mjs` passes without toggle notices and ordinary frontmatter/manifest/contract/plan/review/README/index checks remain present.
   - Acceptance evidence: targeted test and gate output.
   - Repair attempts: 0
   - Recovery note: compare the diff against the pre-removal check-suite to ensure unrelated checks remain.

3. [completed] Make cache-health unconditional
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G1
   - Risk: low
   - Owned scope: `scripts/cache-health.mjs`, `tests/cache-health.test.mjs`
   - Not in scope: DB schema/query redesign, model-filter change, new telemetry
   - Spike candidate: none
   - Actions: remove resolver import, toggle lookup, disabled warning, and early exit; remove fixture-toggle setup from tests; add a test that asserts the toggle file is absent, the fake `opencode db` command is called, fixed-model SQL/report output is produced, and no disabled notice appears; preserve `--days`, TSV aggregation, cost, SQL, and subprocess failure paths.
   - Acceptance signal: `node --test tests/cache-health.test.mjs` exits 0 with the named no-toggle CLI test and fake DB invocation assertion.
   - Validation: `node scripts/cache-health.mjs --help` and existing pure-function tests remain green.
   - Acceptance evidence: test output and fixed-model report behavior.
   - Repair attempts: 0
   - Recovery note: only the gate around existing behavior should change.

4. [completed] Remove active documentation and retire current references
   - Task ID: T004
   - Depends on: T001, T002
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `AGENTS.md`, `README.md`, `.agents/README.md`, `.agents/docs/cache-token-efficiency-2026-08-20.md`, `.agents/docs/csm-ddd-token-efficiency-liability.md`
   - Not in scope: completed plans, research, approaches, reviews, or journal lessons; do not rewrite historical claims
   - Spike candidate: none
   - Actions: remove active token-efficiency policy/toggle/budget instructions from AGENTS.md and README.md; remove token-efficiency test/module references; mark current reference docs and index entries retired while preserving their original content; remove `.agents/token-efficiency.json` from live layout text.
   - Acceptance signal: `node --input-type=module -e 'import {readFileSync} from "node:fs"; const files=["AGENTS.md","README.md",".lefthook.yml",".oxfmtignore"]; const bad=files.flatMap(f=>readFileSync(f,"utf8").split("\\n").map((l,i)=>/token.?efficiency|WORD_BUDGET|VOLATILE_DESC_RE|volatile\/budget/i.test(l)?f+":"+(i+1):null).filter(Boolean)); if(bad.length){console.error(bad.join("\\n"));process.exit(1)}'`
   - Validation: `make check`, README/matrix checks, and inspect the two retired docs/index entries for the exact banner/status; completed historical artifact content remains unchanged.
   - Acceptance evidence: live-vs-archive search report.
   - Repair attempts: 0
   - Recovery note: historical files remain untouched except optional retirement metadata in current reference docs/index.

5. [completed] Verify generated artifacts and formatting
   - Task ID: T005
   - Depends on: T002,T003,T004
   - Parallel group: G3
   - Risk: standard
   - Owned scope: generated verification only; no manual payload/index edits
   - Not in scope: unrelated generated drift or historical artifact rewrites
   - Spike candidate: none
   - Actions: snapshot the generated payload/index file list and hashes, run boilerplate/matrix checks, payload drift check, and formatter check; run pack-bootstrap only in a disposable copy unless source changes require generated outputs, then compare every generated file against the pre-pack snapshot.
   - Acceptance signal: `node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check && make check && make fmt-check` exits 0; any pack output is either byte-identical to the snapshot or listed with its authoritative source and committed together.
   - Validation: `make fmt-check` and `make check`.
   - Acceptance evidence: generator/drift output.
   - Repair attempts: 0
   - Recovery note: any unexpected payload change returns to T002/T004 for source review.

6. [completed] Run final removal audit and full verification
   - Task ID: T006
   - Depends on: T005
   - Parallel group: G3
   - Risk: standard
   - Owned scope: final verification and plan evidence only
   - Not in scope: modifying historical archives or unrelated untracked work
   - Spike candidate: none
   - Actions: run live-reference audit excluding `.agents/plans/**`, `.agents/research/**`, `.agents/approaches/**`, `.agents/reviews/**`; run targeted tests, hooks, lint, check, and full test suite; update the plan completion review.
   - Acceptance signal: `make lint && make check && make test && node --test tests/check-suite.test.mjs tests/cache-health.test.mjs` all exit 0, followed by the live-reference audit command with zero output and exit 0.
   - Validation: `git diff --check`; `bash -euc '! rg -n "token.?efficiency|token efficiency|WORD_BUDGET|VOLATILE_DESC_RE|volatile/budget|isEnabled|parseToggle|findToggleFile" AGENTS.md README.md .lefthook.yml .oxfmtignore scripts tests'` must produce zero output; separately assert the two retired `.agents/docs` files contain the exact retirement banner. Historical plans/research/approaches/reviews are archive evidence and are not scanned as live code.
   - Acceptance evidence: full command outputs and final reference-audit result.
    - Repair attempts: 1 (unrelated csm-scan renderer baseline regenerated after deep investigation)
   - Recovery note: any live match becomes an explicit repair task rather than an ignored grep result.

## Verification Strategy

Delete/rewrite tasks use focused syntax/tests first. T002 and T003 run targeted tests before `make check`; T005 runs generators/format checks; T006 runs hooks, lint, check, and full test last. Historical archive references are checked separately from live-code references. All planning R&D is read-only or isolated under `/tmp`; implementation-time generators are future csm-build actions.

## Risks And Recovery

- Removing the feature permanently eliminates the dormant volatile-description and word-budget checks; this is the requested behavior, not an accidental weakening.
- Cache-health will query its existing database path unconditionally; its existing subprocess error path remains the safeguard.
- Historical docs will retain feature references by design; live-reference audit must distinguish archive paths explicitly.
- Payload/index should not change; any change requires source attribution before acceptance.
- Concurrent untracked files are preserved and excluded from the plan’s implementation scope.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| Live/archive boundary unclear | major | Inventory and T004 explicitly separate live docs from immutable historical artifacts | Scout dossier; T004 |
| Cache-health replacement unspecified | major | T003 keeps fixed model/report behavior and removes only toggle gating | T003 |
| Gate removal could delete unrelated checks | major | T002 names exact branches and requires check-suite regression tests | T002 |
| Payload implications uncertain | minor | T005 uses official generators and requires no unexpected payload diff | T005 |
| T002 no-match command failed on rg exit 1 | blocker | Acceptance uses explicit `bash -euc '! rg ...'` and adds lint/check-suite regression validation | T002 |
| T005 pack command could mutate generated files unexpectedly | blocker | Generator ownership and pre/post snapshot comparison made explicit; no unconditional zero-diff claim after legitimate source changes | T005 |
| T004 depended on T002 | major | T004 now depends on T001/T002 before `make check` acceptance | T004 |
| T006 did not run the complete root test battery | major | Final signal includes `make test` plus root check-suite/cache-health tests | T006 |
| T003 test setup still created the toggle | major | No-toggle cache-health test explicitly asserts absent config, fake DB invocation, output, and no disabled notice | T003 |
| T002 dead locals/ordinary checks | major | Acceptance scans `descWordTotal`/toggle symbols, runs lint, and names ordinary gate families | T002 |
| T004 archive policy ambiguous | major | Exact retirement banner/status policy added; historical content remains unchanged | T004/D3 |
| T001-T005 ownership overlap | major | Generated ownership and task dependencies clarified; repository-wide audit moved to T006 | Execution Graph |
| T004/T005 risk tiers understated | minor | Gate/docs/generated tasks classified standard | Task risks |
| T006 live audit was prose-only | minor | Exact no-match bash audit and retirement-banner assertions added | T006 |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-24T10:12:12+0000 | 0 | INTAKE -> DISCOVER | none | user explicitly requested complete token-efficiency removal; session bootstrapped; untracked concurrent files preserved | DISCOVER |
| 2026-08-24T10:15:00+0000 | 0 | DISCOVER -> RESEARCH | none | inventory scout classified live removal targets and archival references; no unresolved product decision | RESEARCH |
| 2026-08-24T10:20:00+0000 | 0 | RESEARCH -> DRAFT | none | draft plan written; no implementation started | DRAFT |
| 2026-08-24T10:25:00+0000 | 0 | DRAFT -> CRITIQUE | T001-T006 | hostile critique found 2 blockers, 7 majors, 5 minors | CRITIQUE |
| 2026-08-24T10:30:00+0000 | 0 | CRITIQUE -> REMEDIATE | T001-T006 | corrected traceability, dependency order, exact shell signals, cache-health no-toggle proof, archive policy, and generated-output ownership | REMEDIATE |
| 2026-08-24T10:35:00+0000 | 0 | REMEDIATE -> VERIFY | T001-T006 | primary verification: all critique items resolved; all tasks have runnable signals, risks, anti-scope, and historical/live disposition | VERIFY |
| 2026-08-24T16:00:00+0000 | 0 | SAVED -> RECOVER | none | Explicit csm-build requested; isolated worktree created and root/csm-browse tooling bootstrapped. | VALIDATE |
| 2026-08-24T16:10:00+0000 | 0 | RECOVER -> VALIDATE -> SELECT -> DISPATCH | T001,T003,T004 | Baseline check-suite passed 1114 checks; G1 independent removal/cache/docs tasks dispatched. | DISPATCH |
| 2026-08-24T16:35:00+0000 | 0 | CHECKPOINT | T001,T002,T003,T004 | Toggle surfaces deleted; cache-health 8 tests pass; live docs retired; check-suite branches removed. Deleted tracked config will clear after checkpoint commit; next T005. | SELECT |
| 2026-08-24T17:00:00+0000 | 0 | CHECKPOINT | T001,T002,T003,T004,T005 | Removal checkpoint committed as 7681648; hooks and check-suite pass at 1113 checks; generated/matrix/format checks pass. | VERIFY |
| 2026-08-24T18:00:00+0000 | 0 | BLOCKED | T006 | Live-reference audit is empty; cache-health 8 tests, lint, formatting, generators, and check-suite pass. `make test` fails in unrelated `csm-scan/test/expansion-baseline.test.mjs:49` because committed Markdown table padding differs from current renderer output. | BLOCKED |
| 2026-08-24T18:15:00+0000 | 0 | BLOCKED -> REPAIR | T006 | User explicitly authorized deep investigation and repair of the csm-scan renderer baseline mismatch. | REPAIR |
| 2026-08-24T18:20:00+0000 | 0 | REPAIR -> COMPLETE | T006 | Regenerated the stale csm-scan renderer golden and excluded the deterministic baseline from formatter rewrites. `make test-scan` passed 1282 tests; `make test`, final live-reference audit, retirement-banner checks, and `git diff --check` passed. | COMPLETE |

## Completion Review

Completion Review: token-efficiency runtime/config/test/fixture surfaces are removed; cache-health is unconditional; live docs are clean and current references are marked retired; generators, lint, formatting, conformance, and the full test battery pass; live-reference audit is empty. The unrelated csm-scan renderer baseline was regenerated to match current deterministic output and excluded from formatter rewrites. Token-removal implementation is committed as `7681648`; final verification checkpoint is `36d4717` plus the scanner baseline repair changes in the working tree.
