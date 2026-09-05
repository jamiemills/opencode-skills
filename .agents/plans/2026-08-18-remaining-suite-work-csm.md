---
format: csm-plan/1
---

# Remaining CSM Suite Work CSM Plan

## How To Execute
- This plan is closed as superseded. Do not invoke csm-build with this plan; its active tasks T001-T004 were completed by the sibling build `.agents/plans/2026-08-18-remaining-active-suite-work-csm.md` (attribution only), and the deferred records T005-T008 were moved to `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md`.
- The agent-agnostic/no-clone installer is explicitly excluded because another session owns it.
- Deferred tasks (T005-T008) remain in this plan for traceability but must not be dispatched in this build.
- Risk summary: none — this plan is closed; T001-T004 were completed by the sibling build `2026-08-18-remaining-active-suite-work-csm.md`; the 4 deferred tasks (T005-T008) are blocked records moved to `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md` and are never dispatched from this plan.

## Control
- Plan ID: remaining-suite-work-2026-08-18
- Status: complete
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-19 closed by consolidated-remaining-work-2026-08-19 plan, T001
- Next transition: none; closed as superseded — active tasks completed by sibling plan
- Active tasks: none
- Blockers: none; closure is intentional and not an implementation result

## Closure
- Closure status: closed as superseded; T001-T004 were completed and evidenced by the sibling build `.agents/plans/2026-08-18-remaining-active-suite-work-csm.md`; no acceptance criteria are claimed by this plan.
- Replacement plan: `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md`.
- Task disposition: T001-T004 were completed by the sibling build; T005-T008 DEFERRED records were moved to the replacement plan; T007's target `.agents/plans/2026-08-03-comprehensive-readme-csm.md` remains ready/never-dispatched, referenced from the replacement plan.

## Goal
Address the remaining non-installer work identified after the CSM suite review and coherence build: design and implement full per-session CDP authentication, retire the legacy ten-dimension pipeline safely, improve test-suite structure, and close remaining low-risk technical refinements. Preserve the completed suite behavior and keep CI, Chromium sandbox redesign, and the old README plan explicitly deferred rather than silently forgotten.

**Explicit exclusion**: agent-agnostic/no-clone skill installation is owned by a parallel workstream and is not included here.

## Acceptance Criteria
1. csm-browse per-session CDP access requires an authenticated, least-privilege channel; unauthenticated session hijacking tests fail closed; shared loopback CDP/VNC protections remain intact.
2. The legacy ten-dimension pipeline and its parity harness are either retired with documented baseline migration or reduced to a clearly named compatibility fixture with no production entry point and no misleading duplicate orchestration.
3. csm-scan tests have meaningful size/concurrency tiers or a documented evidence-based reason for retaining a single tier; full coverage and determinism remain green.
4. Remaining low-risk refinements are completed or individually recorded as deferred with evidence: exec timeout coverage, daemon-log line semantics, explicit test dependency policy, and any safe remaining cleanup.
5. Deferred work is explicit: CI/dependency audit, Chromium sandbox redesign, and the old comprehensive README plan are not dispatched in this build.

## Current-State Evidence
- Suite coherence is complete at commit `58fafea`; current follow-up baseline is check-suite 434, csm-scan 1225/1225, csm-browse 66/66, and e2e 76/76.
- Follow-up plan T001-T004 completed at `f890929`; external clone hook rollout was explicitly excluded at `11568be`.
- csm-browse host-facing CDP/VNC exposure is loopback-bound, but review F-033 remains for full per-session CDP authentication.
- Legacy `runExistingTenPipeline` remains as a test/parity harness; full retirement is still open (F-055).
- csm-scan duplicate fixture registration was fixed, but broad S/M/L test-tier restructuring remains open (F-058).
- Remaining low-priority candidates include `execDetached` timeout coverage, daemon-log per-line timestamps, and explicit `ws` test dependency policy.
- Ready but unstarted plans unrelated to this scope include the old comprehensive README plan and three installer plans; installer work is excluded here.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Full per-session CDP authentication is active scope and requires a design spike before implementation | user-directed | User said item 3 should be added and fixed; review identified unauthenticated session ports | decided |
| D2 | CI/dependency audit is included only as deferred work, not dispatched | user-directed | User requested item 2 included but deferred | decided |
| D3 | Chromium `--no-sandbox` redesign is included only as deferred work | user-directed | User requested item 4 included but deferred | decided |
| D4 | Test-suite restructuring is active planning scope; implementation may split or defer individual changes based on measured evidence | user-directed | User requested a plan for item 5 | decided |
| D5 | Full legacy-pipeline retirement is active scope | user-directed | User requested item 6 fixed | decided |
| D6 | Installer/no-clone work is excluded | user-directed | Another parallel session owns it | decided |
| D7 | The old comprehensive README plan is included as deferred/never-dispatched work | user-directed | User requested item 8 included, then asked to mark a subset deferred/won't-do | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What remains after prior builds? | Read-only plan/review/commit inventory | No writes | CDP auth, legacy retirement, test tiers, and minor refinements remain; local hardening is complete | Active tasks T001-T004/T005 |
| R2 | What is the CDP auth design risk? | Review F-033 + current csm-browse source | Read-only | Session socat ports are container-network reachable without auth; full auth needs a bounded design spike | T001 starts with isolated design proof |
| R3 | What test work remains? | Review F-058 + current test inventory | Read-only | Duplicate registration fixed; broad size/concurrency split remains uncertain | T003 requires measured before/after evidence |
| R4 | Which items are safe to defer? | User decisions + existing plan exclusions | Read-only | CI, sandbox redesign, README plan, installer are outside active execution | Deferred tasks remain pending/blocked |

## Discovered Requirements
- T001 must not expose real credentials or contact production services; use synthetic CDP clients and isolated containers/ports only.
- T001 must preserve loopback host bindings and document residual network reachability if full authentication cannot be completed safely.
- T002 legacy retirement must preserve or explicitly migrate parity baselines; no silent deletion of historical evidence.
- T003 must not reduce assertion quality, add hidden skips, or weaken coverage thresholds.
- T004 low-priority fixes require focused tests and may be deferred individually when they need broad redesign.
- Deferred tasks must remain clearly marked and must not be selected by csm-build.

## Design
User-item mapping: item 2 -> T005 deferred CI/audit; item 3 -> T001 active full per-session CDP authentication; item 4 -> T006 deferred Chromium sandbox redesign; item 5 -> T003 active test-tier restructuring; item 6 -> T002 active legacy-pipeline retirement; item 7 -> T004 active remaining low-risk refinements; item 8 -> T007 deferred old README plan. The installer/no-clone effort is explicitly excluded and belongs to another session.

The active build begins with T001's isolated CDP-auth design spike and implementation, followed by T002 and T003 in parallel with disjoint ownership. T004 closes only low-risk remaining refinements after both branches. T005-T007 are retained as deferred records and are never selected.

## Execution Graph
- Wave 1: T001 CDP authentication design/implementation; independent security review required.
- Wave 2: T002 and T003 run in parallel after T001's baseline/security gate, with disjoint ownership.
- Wave 3: T004 minor refinements after T002/T003; final active gate.
- Deferred records T005-T007 are excluded from dispatch.
- Critical path: T001 -> (T002 || T003) -> T004.

## Numbered Plan
1. [blocked] Full per-session CDP authentication (completed by remaining-active-suite-work-2026-08-18)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (security boundary; independent security review required)
   - Owned scope: csm-browse per-session transport, ports, ensure-browser/session state, Docker-free protocol tests, isolated e2e/security harnesses.
   - Not in scope: shared host CDP/VNC loopback binding already fixed; Chromium sandbox redesign; real credentials or production services.
   - Spike candidate: compare authenticated localhost proxy/token handshake, Unix-socket/remote-debugging-pipe transport, and container-network token validation in an isolated synthetic environment; record reachability, compatibility, and failure behavior before selecting one. The selected design must specify token format, SID/generation binding, storage mode, rotation/revocation, HTTP discovery behavior, WebSocket forwarding, and failure codes.
   - Actions: choose the smallest viable authenticated channel; implement opaque per-session token binding to SID/generation; reject unauthenticated HTTP discovery and WebSocket upgrades; rotate/revoke tokens during cleanup; preserve existing client APIs where possible; add a synthetic container-network attacker harness. No unauthenticated compatibility path may remain in the completion state.
   - Acceptance signal: unauthenticated synthetic clients are rejected before browser commands; authenticated client can discover and issue a harmless command; token reuse after rotation/revocation fails; csm-browse unit/e2e tests pass; host ports remain loopback-only.
   - Validation: `cd csm-browse && npm test`, check-skill, syntax checks, isolated network probe, security review by a non-implementer.
   - Acceptance evidence: protocol design decision, threat model, negative/positive traces, and residual-risk record.
   - Repair attempts: 0
   - Recovery note: if migration is interrupted, preserve the existing loopback-only behavior without introducing a network-reachable unauthenticated fallback; resume from the recorded protocol decision.

2. [blocked] Retire or formally isolate the legacy ten-dimension pipeline (completed by remaining-active-suite-work-2026-08-18)
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (baseline/data compatibility)
   - Owned scope: `csm-scan/lib/scan/pipeline/run.mjs` legacy entry point, `pipeline/existing-ten.mjs`, `test/expansion-activation.test.mjs`, `test/expansion-production-pipeline.test.mjs`, parity/baseline metadata, and renderer compatibility harness. No test-tier manifests or runner scripts.
   - Not in scope: rewriting the expanded 17-dimension pipeline; deleting historical evidence without replacement.
   - Spike candidate: map all production and test callers of `runExistingTenPipeline`, then prove whether a projection adapter can preserve parity without retaining a full duplicate pipeline.
   - Actions: remove production-dead legacy orchestration; preserve a small explicit parity fixture only if required by supersession evidence; migrate baselines through documented canonical regeneration; rename tests/comments so no retired path is presented as production coverage.
   - Acceptance signal: no production caller remains; parity tests either pass against the documented compatibility fixture or are retired with replacement evidence; full csm-scan suite and coverage pass.
   - Validation: import/caller graph, baseline digest diff, deterministic reruns, check-suite.
   - Acceptance evidence: caller inventory, migration rationale, baseline changes, and test output.
   - Repair attempts: 0
   - Recovery note: preserve the old baseline in a supersession artifact until replacement tests are committed.

3. [blocked] Restructure csm-scan test sizes and concurrency safely (completed by remaining-active-suite-work-2026-08-18)
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `csm-scan/test/harness.mjs`, new test-tier manifests/scripts, fixture isolation, coverage commands, and test files only where needed to assign tiers. No legacy pipeline files, parity tests, or supersession baselines owned by T002.
   - Not in scope: changing production behavior, removing tests, lowering coverage, or adding hidden skips.
   - Spike candidate: classify tests by runtime and filesystem/process behavior in a temporary report; compare parallel S-tier versus serial M/L-tier runtime and flake behavior before moving files.
   - Actions: define S/M/L conventions; isolate pure unit tests that can run concurrently; keep pipeline/subprocess tests serial; add capability checks for required `rg`/`git`; preserve full-suite and coverage gates; fix duplicate registration only as already done, without broad rewrites unless measured.
   - Acceptance signal: categorized runner commands pass; full serial suite remains green; coverage does not regress; repeated parallel S-tier run is stable.
   - Validation: runtime/flake comparison over repeated isolated runs; check-suite and coverage gate.
   - Acceptance evidence: category manifest, before/after timings, repeated-run results, coverage comparison.
   - Repair attempts: 0
   - Recovery note: if parallelism produces flakes, revert category assignment and retain serial execution with the evidence recorded.

4. [blocked] Close remaining low-risk technical refinements (completed by remaining-active-suite-work-2026-08-18)
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G3
   - Risk: standard
   - Owned scope: execDetached/execInContainer timeout tests, daemon-log line timestamp semantics, explicit `ws` dependency decision, and any small cleanup proven by focused tests.
   - Not in scope: CDP authentication, CI, sandbox redesign, legacy-pipeline redesign, installer, or speculative dependency churn.
   - Spike candidate: measure each candidate independently; retain only changes with a clear defect/flakiness/diagnostic benefit.
   - Actions: add bounded timeout coverage where seams exist; decide whether per-line timestamps are worth the log buffering complexity; add `ws` only with package/lockfile justification; document deferred candidates explicitly.
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` remains green at the current 1225-test baseline or has an explained intentional count change; `cd csm-browse && npm test` remains green at 66 tests or has an explained intentional count change; coverage does not regress; every retained candidate has a focused regression test.
   - Validation: syntax, focused tests, full suites, diff review.
   - Acceptance evidence: before/after metrics and a list of retained/deferred candidates.
   - Repair attempts: 0
   - Recovery note: each refinement is independently revertible.

5. [blocked] DEFERRED [DEF:CI] — CI and scheduled dependency audits (moved to .agents/plans/2026-08-19-consolidated-remaining-work-csm.md)
   - Task ID: T005
   - Depends on: T004
   - Parallel group: G4
   - Risk: high (public-repository workflow)
   - Owned scope: future `.github/workflows` CI/audit files only.
   - Not in scope: current build.
   - Spike candidate: none.
   - Actions: retain the prior T013 definition for a future plan/build.
   - Acceptance signal: not applicable in this build.
   - Validation: deferred.
   - Acceptance evidence: deferred record.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

6. [blocked] DEFERRED [DEF:SANDBOX] — Chromium sandbox redesign (moved to .agents/plans/2026-08-19-consolidated-remaining-work-csm.md)
   - Task ID: T006
   - Depends on: T001
   - Parallel group: G4
   - Risk: high (browser containment)
   - Owned scope: future Chromium launch/container security design.
   - Not in scope: current build.
   - Spike candidate: future isolated Docker/kernel compatibility study.
   - Actions: retain as a future security plan item.
   - Acceptance signal: not applicable in this build.
   - Validation: deferred.
   - Acceptance evidence: deferred record.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

7. [blocked] DEFERRED [DEF:README] — old comprehensive README plan (moved to .agents/plans/2026-08-19-consolidated-remaining-work-csm.md)
   - Task ID: T007
   - Depends on: none
   - Parallel group: G4
   - Risk: low
   - Owned scope: `.agents/plans/2026-08-03-comprehensive-readme-csm.md` only in a future plan.
   - Not in scope: current build; the current README has already been updated by later work.
   - Spike candidate: none.
   - Actions: leave unstarted and mark as future-plan candidate.
   - Acceptance signal: not applicable in this build.
   - Validation: deferred.
   - Acceptance evidence: deferred record.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

8. [blocked] DEFERRED [DEF:EVAL] — live-LLM behavioral evaluation harness (F-017 tier-b) (moved to .agents/plans/2026-08-19-consolidated-remaining-work-csm.md)
   - Task ID: T008
   - Depends on: none
   - Parallel group: G4
   - Risk: standard
   - Owned scope: future deterministic-eval harness with canned transcripts and a stubbed model, asserting activation-boundary answers for the doc-only skills.
   - Not in scope: current build; the deterministic corpus tier (F-017 tier-a) was completed by T011 of the skills-remediation build.
   - Spike candidate: none; deferred by explicit user decision 2026-08-18.
   - Actions: leave as a future-plan candidate only.
   - Acceptance signal: not applicable in this build.
   - Validation: deferred.
   - Acceptance evidence: deferred record.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

## Resolved Elsewhere (not open work)
The following review findings were completed by prior builds and are recorded here so this plan's coverage is accurate:
- F-060 (multi-user csm-browse hardening) — done: follow-up plan T002 (XDG runtime root, 0700/0600 modes, ownership checks).
- F-061 (telemetry redaction) — done: follow-up plan T002 (URL/fragment/structured redaction).
- F-062 (cookie masking) — done: skills-remediation T012.
- F-063 (capture filename validation) — done: skills-remediation T012.
- F-065 (cookies listener leak) — done: skills-remediation T012.
- F-066 (browse dead-code cluster) — done: skills-remediation T012.
- F-073 (.agents index/retention) — done: skills-remediation T012 + suite-coherence T003.
- F-075 (scan CLI --verbose) — done: skills-remediation T012.
- Upload preview symlink + SIGTERM child orphan — done: follow-up plan T003.
- fixtures-pipeline double-registration — done: follow-up plan T004.

## Verification Strategy
- T001: cheapest syntax/unit checks, then isolated protocol/security tests, then independent security review.
- T002/T003: focused tests first, then full csm-scan/csm-browse suites and coverage.
- T004: focused refinements, then full suite and check-suite battery.
- Deferred T005-T007 are never included in active build selection.

## Risks And Recovery
- CDP authentication may require a product decision after the spike; block with options rather than weakening security.
- Legacy baseline migration may expose consumers; preserve supersession evidence and provide a compatibility adapter where necessary.
- Test parallelism may introduce flakes; revert categorization rather than hiding failures.
- Deferred tasks remain explicit and do not silently become active.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Stale baseline and missing item mapping | major | Updated current counts and added explicit item 2-8 mapping; installer excluded | critique + current check-suite/test runs |
| CDP auth under-specified | major | T001 now requires token format, SID/generation binding, storage, lifecycle, HTTP/WS behavior, failure codes, and attacker harness; no compatibility fallback | critique, review F-033 |
| T002/T003 ownership overlap | major | T002 owns legacy pipeline/parity files; T003 owns runner/manifests/tier files; graph is T001 -> (T002 || T003) -> T004 | critique |
| Deferred work could be dispatched accidentally | minor | Deferred tasks are blocked, labeled DEFERRED, and explicitly excluded from csm-build selection | plan execution graph |
| T003 acceptance lacked named runners | moderate | T003 now requires creation of named tier manifests/runners before claiming categorized acceptance | critique |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-18 | 0 | INTAKE -> DISCOVER -> RESEARCH -> DRAFT | none | User selected active CDP auth, legacy retirement, test restructuring, and minor fixes; CI/sandbox/README plan explicitly deferred; installer excluded | CRITIQUE |
| 2026-08-18 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Independent critique found stale counts, missing mapping, CDP-auth ambiguity, overlapping ownership, and deferred-task dispatch risk; all corrected in the plan; check-suite 434 passes | SAVED |
| 2026-08-18 | 0 (cont.) | SAVED -> SAVED (user-directed amendment) | T008 | User requested F-017 tier-b added as deferred; added T008 (deferred live-LLM behavioral eval harness) and a Resolved-Elsewhere section recording F-060/061/062/063/065/066/073/075 plus upload/tests fixes completed by prior builds | SAVED |
| 2026-08-19 | 0 | SAVED -> closed (user-directed) | none | Closed as superseded by the consolidated-remaining-work-2026-08-19 plan: T001-T004 were completed by the sibling build 2026-08-18-remaining-active-suite-work; T005-T008 deferred records moved to the replacement plan | closed |

## Completion Review
(filled by csm-build when active criteria are verified)
