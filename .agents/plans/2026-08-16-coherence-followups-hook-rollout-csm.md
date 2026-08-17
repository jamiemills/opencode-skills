---
format: csm-plan/1
---

# Coherence Follow-ups And Hook Rollout CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan.
- This plan does not authorize changes to repositories outside the skills repository.
- External-clone hook activation requires explicit approval for each selected repository.
- Risk summary: 5 tasks — T002 high (multi-user security boundary), T005 high/blocker until approvals, T001 standard, T003 standard, T004 standard.

## Control
- Plan ID: coherence-followups-hook-rollout
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-17 cycle 1 T003 verified — focused upload tests 2/2, syntax/check-suite/diff checks clean; T005 blocked pending approved CSM-suite clone paths
- Next transition: CHECKPOINT -> SELECT
- Active tasks: none
- Blockers: T005 requires explicit per-repository approval before external `.git/config` changes

## Goal
Address the remaining minor follow-ups from the completed suite-coherence work and define a safe rollout for the pre-commit hook across other verified clones of this CSM suite. Improve staged-snapshot correctness, harden csm-browse for multi-user hosts, close upload/test-tooling hygiene gaps, and activate hooks only where the user explicitly authorizes it.

**Out of scope**: CI/T013, full legacy-pipeline deletion, full per-session CDP authentication redesign, Chromium sandbox redesign, per-line daemon-log semantics, live-LLM evaluation, and any unapproved external-repository mutation.

## Acceptance Criteria
1. The hook strictly rejects tracked working-tree changes before running repo-wide gates; partial staging cannot silently validate the wrong content, and ordering is tested.
2. csm-browse's local state is private and validated: per-user runtime root, directory/file modes, ownership checks, telemetry redaction, and persisted state-field validation have focused tests.
3. csm-upload dry-run remains network-free and safe against preview symlinks; SIGTERM handling does not leave an uncontrolled git child or temp clone.
4. Test/tooling hygiene is improved without weakening assertions: no duplicate fixture test registration, explicit test dependency where justified, bounded docker execution, and any test-size split remains green.
5. For every approved external clone, `core.hooksPath` points to an intentional hook location, the hook passes a clean-repository check, and no unapproved repository is changed.

## Current-State Evidence
- Skills clone: `/home/jamiemills/.config/opencode/skills`, hook active with `core.hooksPath=scripts/hooks`; suite-coherence plan complete at commit `58fafea`.
- Current gates: check-suite 424, csm-scan 1229/1229, csm-browse 55/55, e2e 76/76.
- Hook limitation: `scripts/hooks/pre-commit` runs repo-wide gates against the working tree while staged `.mjs` syntax checks use the index file list; partial staging can validate unstaged content.
- csm-browse deferred surfaces: `/tmp/csm-browse` runtime root, default umask-dependent modes, unredacted URLs/console data, persisted state fields, and container-local unauthenticated per-session CDP.
- csm-upload deferred surfaces: predictable `/tmp/<demo>.preview.html` preview path and incomplete child cancellation on SIGTERM.
- Other-clone inventory is read-only evidence only: the listed application repositories have no active `core.hooksPath`; none was verified as a second CSM-suite root.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Strictly reject commits when tracked working-tree changes exist; do not run repo-wide gates against a mixed index/worktree | planning decision | Smallest fail-closed correction; avoids a larger temporary-index implementation | decided |
| D2 | Multi-user csm-browse support is a hardening objective, not a promise of full CDP authentication | scope boundary | Full F-033 authentication redesign is explicitly out of scope; local state privacy and validation are still actionable | decided |
| D3 | T005 may modify only explicitly approved clones that are verified CSM-suite roots; arbitrary application repositories are ineligible | safety constraint | The hook invokes suite-specific scripts and cannot be installed into unrelated repositories safely | decided |
| D4 | Low-priority test refinements are grouped and may be individually deferred if they require architectural churn | proportionality | Double-registration, explicit `ws`, timeout seams, and test-size splitting vary substantially in cost | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Which clones need hook rollout? | Read-only filesystem/git-config inventory | No writes or config changes | Skills clone is active; listed external clones have no hook path | T005 is approval-gated per clone |
| R2 | What is the smallest hook correctness fix? | Read-only hook/source inspection | No writes | Current hook mixes working-tree repo gates with staged-file checks | T001 chooses strict rejection unless user selects snapshot materialization |
| R3 | Where is browse multi-user risk concentrated? | Review findings + current source inventory | Read-only | `/tmp` root, umask modes, telemetry, persisted state validation | T002 owns focused hardening + tests |
| R4 | Does current upload/test evidence remain green? | Existing dry-run and suite evidence from completed build | No new writes | Dry-run, csm-scan, and browse tests are green before follow-ups | T003/T004 must preserve these gates |

## Discovered Requirements
- Do not run hook installation in another clone during planning or without explicit approval.
- `scripts/install-hooks.mjs` currently operates on the current Git root; rollout must verify the target root before mutating it.
- csm-browse tests must remain Docker-free for unit coverage; e2e remains separate.
- csm-scan test changes must preserve 1229/1229 and the 96% coverage baseline.
- Upload dry-run must not contact GitHub, write credentials, or write previews through symlinks.
- Any external-clone rollout must record the target path, prior `core.hooksPath`, new value, verification result, and rollback command.

## Design
Use five bounded tasks. T001 fixes the hook's snapshot policy and adds regression coverage. T002 handles csm-browse local-state privacy and validation without attempting full CDP authentication; it also owns browse timeout seams. T003 closes upload temporary-file and child-lifecycle gaps. T004 groups low-risk csm-scan/test-tooling refinements and separates any work that proves too invasive. T005 is an approval-gated rollout task for verified CSM-suite clones only: inventory candidates, obtain explicit per-path approval, install hooks only in approved clones, and verify/record rollback information.

## Execution Graph
- Wave 1: T001 and T004 can proceed independently.
- Wave 2: T002 and T003 can proceed independently after baseline gates pass.
- Wave 3: T005 runs last, after the hook behavior is stable; it is blocked until target repositories are explicitly approved.
- Critical path: T001 -> T005 for rollout; T002/T003 are independent hardening branches.

## Numbered Plan
1. [completed] Make pre-commit validation snapshot-correct
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `scripts/hooks/pre-commit`, hook tests/fixtures under a new test-owned directory, README hook policy text
   - Not in scope: CI, external clones, full temporary-index implementation unless the strict policy proves infeasible
   - Spike candidate: none; strict rejection is the selected policy.
   - Actions: before any repo-wide gate, compare tracked worktree state with the index; if unstaged tracked changes exist, fail with a clear message and do not invoke check-suite or sync checks. Add regression tests for staged-only changes, unstaged-only changes, mixed files, deletions, untracked files, clean commits, `--no-verify`, and ordering.
   - Acceptance signal: a partial-staging fixture exits non-zero before any repo-wide gate output; clean commit passes; `--no-verify` bypasses; hook remains under 5 seconds.
   - Validation: `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, `git diff --cached --check`, named hook test command.
   - Acceptance evidence: before/after staged snapshot transcripts and timing.
   - Repair attempts: 0
   - Completion evidence: `node --test scripts/hooks/test/pre-commit.test.mjs` (4/4, 2.43s); isolated temporary repositories proved clean, staged-only, staged deletion, untracked, unstaged-only, mixed-file, unstaged deletion, ordering, and `git commit --no-verify`; `node scripts/check-suite.mjs` (428 checks); `node scripts/sync-skill-boilerplate.mjs --check`; `node --check` for hook and test; `git diff --check`.
   - Recovery note: hook-only changes are isolated; unset `core.hooksPath` to disable locally.

2. [completed] Harden csm-browse for multi-user local-state safety
   - Task ID: T002
   - Depends on: none
   - Parallel group: G2
   - Risk: high (security/data boundary)
   - Owned scope: csm-browse constants/session/collectors/cleanup/daemon-core/ensure-browser/session-daemon/close/status/capture/sweep/ports/docker modules and Docker-free unit tests; e2e runtime-root/summary paths where required.
   - Not in scope: full per-session CDP authentication, Chromium sandbox redesign, deployment changes.
   - Spike candidate: prove XDG runtime directory availability and ownership semantics in an isolated temp sandbox before changing the default root.
   - Actions: use per-user XDG runtime or private home fallback; enforce 0700 directories and 0600 state/log/event files; redact credential-like URL query parameters and console payloads; validate profileDir/publicPort/wsUrl before destructive use; add symlink-safe writes where applicable; update e2e/runtime summary paths to honor the selected root and preserve Docker fixture reachability.
   - Acceptance signal: unit tests prove private modes, ownership/shape rejection, telemetry redaction, and safe cleanup; `cd csm-browse && npm test` and `node scripts/check-skill.mjs` pass.
   - Validation: e2e quick remains 76/76 or records an updated expected count; no host files outside isolated runtime roots are touched.
   - Acceptance evidence: mode/ownership assertions, redaction fixtures, and focused test output.
    - Repair attempts: 0
    - Completion evidence: `cd csm-browse && npm test` (61/61); `node scripts/check-skill.mjs` (PASS); `node --check` for all touched modules; `node tests/e2e.mjs --quick` (76/76). Default runtime root now uses `$XDG_RUNTIME_DIR/csm-browse` or `~/.local/state/csm-browse`; `CSM_BROWSE_SESSIONS_ROOT` remains an explicit override. Existing `/tmp/csm-browse` sessions are not migrated or deleted.
   - Recovery note: preserve an environment override for the old root during migration; never delete existing user sessions automatically.

3. [completed] Harden upload temporary files and child lifecycle
   - Task ID: T003
   - Depends on: none
   - Parallel group: G2
   - Risk: standard (temporary-file and subprocess safety)
   - Owned scope: csm-upload/scripts/upload.mjs and focused dry-run tests.
   - Not in scope: GitHub Pages workflow changes, credential storage redesign, real uploads.
   - Spike candidate: test exclusive preview creation and SIGTERM cleanup in `/tmp` with synthetic files and no network.
   - Actions: create previews in a private temporary directory or with exclusive no-follow creation; replace promise-only git execution with tracked child handles; terminate and await children on SIGINT/SIGTERM; make cleanup idempotent; preserve dry-run no-network behavior and existing filename/HTML escaping.
   - Acceptance signal: symlink redirection test cannot overwrite its target; SIGTERM harness leaves no child/temp clone; dry-run performs no git/gh/network operations.
   - Validation: `node --check csm-upload/scripts/upload.mjs` and existing dry-run tests.
    - Acceptance evidence: isolated symlink and signal harness output.
    - Repair attempts: 0
    - Completion evidence: `node --test csm-upload/tests/upload.test.mjs` (2/2); symlink redirection preserved the target and verified private preview modes 0700/0600 with no git/gh stub operations; SIGTERM covered clone, commit, and push and verified exit 143, no temporary clone, and no child process; `node --check csm-upload/scripts/upload.mjs`; `node scripts/check-suite.mjs` (428 checks); `git diff --check`. No network, GitHub repository, credentials, or real upload was used.
    - Recovery note: no real Pages repository or credentials may be used.

4. [pending] Group low-priority test and tooling refinements
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: csm-scan test harness/runner, csm-browse test dependency and timeout seams, fixtures-pipeline registration, only the related package lock/test files.
   - Not in scope: F-055 legacy pipeline deletion, CI/audit, full CDP authentication, log line semantics, unrelated refactors.
   - Spike candidate: measure each candidate separately in `/tmp` and retain only changes with a clear reduction in flakiness, duplicate counts, or hidden dependency risk.
   - Actions: remove fixture-pipeline double registration; add bounded exec timeout tests only if not covered by T002; consider splitting csm-scan S/M/L tests without changing acceptance coverage; declare `ws` explicitly only if package policy and lockfile update are approved.
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` remains green; test counts and coverage changes are explained; any deferred candidate is named in the checkpoint rather than silently omitted.
   - Validation: run focused tests before the full suites; no assertion weakening or silent skips.
   - Acceptance evidence: before/after test counts, runtime, and coverage report.
   - Repair attempts: 0
   - Recovery note: each refinement must be independently revertible; defer any candidate that requires broad pipeline redesign.

5. [blocked] Activate hooks in explicitly approved external clones
   - Task ID: T005
   - Depends on: T001
   - Parallel group: G3
   - Risk: high (external repository configuration and file mutation)
   - Owned scope: only approved CSM-suite clones, their `.git/config`, and provisioned hook files if explicitly approved; rollout evidence in this plan.
   - Not in scope: application repositories such as `perplexity-cli`, `base`, `langfuse`, or `openclaw`; unapproved repositories; source-file edits, commits, pushes, or hook installation during planning.
   - Spike candidate: none; eligibility is determined by read-only markers (`scripts/check-suite.mjs`, `scripts/lib/contracts.mjs`, and CSM skill dirs).
   - Actions: inventory candidate roots read-only; obtain explicit path-by-path approval; for each approved CSM root, record existing `core.hooksPath`, provision or confirm the tracked `scripts/hooks/pre-commit`, run `node scripts/install-hooks.mjs` from that root, verify `git config --show-origin --get core.hooksPath`, and record rollback (prior value or unset). If no eligible approved clone exists, remain blocked with no mutations.
   - Acceptance signal: every approved CSM clone reports the intended hook path and passes a clean-repository hook check; an unapproved application clone remains byte/config unchanged; zero-approved case is an explicit blocked result, not a false completion.
   - Validation: before/after `git config`, `git status`, hook existence/permissions, and rollback rehearsal only in an approved clone.
   - Acceptance evidence: target eligibility/approval matrix with prior value, hook source/path, verification, and rollback.
   - Repair attempts: 0
   - Recovery note: remain blocked until the user supplies approved paths; do not guess based on filesystem discovery.

## Verification Strategy
- Fast gates first: syntax checks, hook-specific tests, `git diff --cached --check`, and focused unit tests.
- Then csm-scan suite with coverage and csm-browse unit/check-skill gates.
- E2E only after unit gates pass; use isolated runtime roots and no real uploads.
- External clone rollout is verified per target and never batched without explicit approvals.
- Known environment sensitivity: Node 22 is required for browse glob tests; use the established PATH-prepend on this host.

## Risks And Recovery
- Hook snapshot correction could reject legitimate partial staging; document the policy and provide `--no-verify` only as an explicit bypass.
- Runtime-root migration could strand existing sessions; preserve an override and migrate only new sessions by default.
- Telemetry redaction can hide useful diagnostics; test token-shaped values and preserve non-sensitive URLs.
- External hook rollout can alter a user's repository configuration; approval and before/after rollback evidence are mandatory.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Hook policy/ordering | major | Resolved to strict fail-closed rejection of unstaged tracked changes before repo-wide gates; add ordering tests | Scout: working-tree/index mismatch |
| Browse ownership overlap | moderate | T002 owns all browse runtime-root/state/timeout surfaces; T004 only owns csm-scan/test-tooling refinements | Critique: no parallel file collision |
| External rollout feasibility | blocker | Restrict T005 to verified CSM-suite clones; arbitrary application repos are ineligible; no-approved-target remains blocked | Current hook invokes suite-specific gates |
| Upload child cleanup | major | T003 explicitly requires tracked child handles, signal termination, await, and idempotent cleanup | Scout deferred finding |
| Test refinements optionality | moderate | T004 names candidates and requires each retained change to have before/after evidence; unproven candidates remain deferred | D4 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-16 | 0 | INTAKE -> DISCOVER -> RESEARCH -> DRAFT | none | Completed read-only inventory and scout; hook active only in skills clone; external activation approval is a blocker | CRITIQUE |
| 2026-08-16 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT -> DISPATCH | T001 | Baseline check-suite 428; working tree clean; T005 remains approval-blocked | INTEGRATE |
| 2026-08-16 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Critique found hook ordering ambiguity, browse ownership overlap, upload cleanup gap, and arbitrary-clone rollout blocker; revised to strict fail-closed hook policy, widened T002 ownership, narrowed T004, and restricted T005 to verified CSM-suite clones | SAVED |
| 2026-08-16 | 2 | SELECT -> DISPATCH (T002) -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR x3 -> CHECKPOINT | T002 | Security reviews found mode/symlink/redaction gaps; repairs added private runtime enforcement, 0600 pid/lock/password/marker/queue/event/summary/artifact writes, URL/fragment/structured redaction, capture+recorder mode tests. Final: npm test 66/66, check-skill PASS, syntax PASS. Residual external ffmpeg pathname TOCTOU documented; full CDP auth remains out of scope | SELECT (T003) |
| 2026-08-16 | 3 | SELECT -> DISPATCH (T003) -> INTEGRATE -> VERIFY -> CHECKPOINT | T003 | Upload hardening: mkdtemp + O_EXCL/O_NOFOLLOW 0600 previews, tracked child processes, SIGINT/SIGTERM cleanup. Focused tests 2/2; node --check, check-suite 428, git diff --check pass; no network or real upload | SELECT (T004) |
| 2026-08-17 | 1 | INTEGRATE -> VERIFY -> REVIEW -> CHECKPOINT | T001 | Added strict tracked-worktree preflight before check-suite/sync and Docker-free isolated hook harness; 4/4 focused tests pass in 2.43s, check-suite 428, sync clean, syntax and diff checks clean. No external repositories or Git config changed. | SELECT |
| 2026-08-17 | 1 | SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> CHECKPOINT | T002 | Added owned 0700 runtime roots, explicit 0600 state/log/event/summary writes, state/path/port validation before destructive use, telemetry redaction, selected-root e2e fixtures, and Docker-free security tests. Unit 61/61, check-skill clean, syntax clean, e2e quick 76/76. No external repositories or existing sessions changed. Existing-session migration remains intentionally undecided and is not required for this rollout because the override preserves deliberate access. | SELECT |

| 2026-08-17 | 1 | SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> CHECKPOINT | T003 | Added private exclusive/no-follow previews, tracked git/gh children, signal termination/await, and idempotent cleanup. Focused Docker/network-free harness 2/2; syntax, check-suite 428, and diff checks clean. No external repositories, credentials, network, or real upload used. | SELECT |

## Completion Review
(filled by csm-build when all approved work is verified)
