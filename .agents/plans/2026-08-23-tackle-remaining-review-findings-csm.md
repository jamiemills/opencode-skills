format: csm-plan/1

# Tackle Remaining Review Findings CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan.
- This plan covers only findings still present after the completed high/medium remediation; already-resolved IDs are excluded.
- Risk summary: 10 tasks — 5 low-risk, 4 standard, 1 high-risk trust-boundary task (T007) requiring independent review. T007 and T010 stop for explicit product decisions.

## Control

- Plan ID: tackle-remaining-review-findings
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-24T09:20:00+0000 final completion gate passed — all ten tasks implemented, reviewed, payload/baselines synchronized, and real-tree make test 1282/1282
- Last model/run: primary csm-build session resumed 2026-08-23T18:02
- Next transition: COMPLETE
- Active tasks: none
- Blockers: none; the user-approved transition fix was applied to the unrelated autoresearch plan, and the aggregate test gate now passes.
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Address the remaining low/info findings from the 2026-08-23 comprehensive review after the high/medium remediation. Reassess each finding at implementation time, fix genuine residual defects, synchronize documentation and contracts, strengthen targeted tests, and leave deliberate product/release decisions explicit.

Excluded: findings now resolved by the prior build: F1-10, F4-08, F6-11, F7-01 as a repository finding, F8-05, F8-07, F8-09, and F5-09 as a duplicate of F3-02. The two unrelated untracked artifacts are not plan inputs or outputs.

## Residual Disposition Matrix

Every residual finding is assigned exactly once. Resolved items are retained here to prevent stale rework.

| Disposition | Finding IDs | Owner |
| --- | --- | --- |
| T001 docs/contracts | F1-09, F1-11, F1-12, F1-13, F1-14, F2-05, F2-10, F2-18, F3-03, F3-04, F3-05, F3-06, F3-10, F8-08 | T001 |
| T002 browse semantics/debt | F2-03, F2-04, F2-06, F2-08, F2-09, F2-12, F6-02 | T002 |
| T003 lifecycle | F2-11, F5-03, F5-04, F5-05, F5-10, F5-11, F5-12, F9-02 | T003 |
| T004 browse security | F4-07, F4-10 | T004 |
| T005 DDD contracts | F2-14, F2-15, F2-17, F2-19, F2-20, F2-21, F3-11, F4-09, F9-01 | T005 |
| T006 scan | F3-01, F3-02, F3-07, F3-08, F3-09 | T006 |
| T007 bootstrap trust | F3-12, F3-15, F4-02, F4-03, F4-04, F4-05 | T007 |
| T008 tests | F6-06, F6-08, F6-09, F6-10 | T008 |
| T009 operations | F3-14, F8-01, F8-02, F8-04, F8-06, F8-10, F8-11, F8-12 | T009 |
| T010 supply/toolchain | F7-02, F7-03, F7-04 | T010 |
| Resolved/excluded | F1-10, F4-08, F5-09, F6-11, F7-01, F8-05, F8-07, F8-09 | prior build |

## Acceptance Criteria

1. Every residual implementation or documentation finding in the scout matrix is either fixed with evidence or explicitly accepted/deferred by a recorded user decision. -> T001-T010
2. Browse semantics, lifecycle, security, DDD, scan, tests, operations, and supply-chain policy changes have focused tests or documentation checks. -> T002-T010
3. Bootstrap trust changes do not ship without the selected signature/payload/key policy and independent review. -> T007
4. Product decision gates are resolved before their task is implemented; no trust or dependency policy is guessed. -> T007,T010
5. `make lint`, `make check`, `make test`, targeted suites, payload checks, and documentation generators pass at completion. -> T001-T010

## Current-State Evidence

- HEAD: `ca81d7e`; prior remediation commits `9c16035` and `ca81d7e` completed all original high/medium tasks.
- Current residual reassessment: `/tmp/opencode` scout dossier `ses_fcf10895cffeYI28SeyGL0OF1C`.
- Resolved during prior build: F1-10, F4-08, F6-11, F7-01 repository finding, F8-05, F8-07, F8-09; F5-09 merges into F3-02.
- Current check gates: prior build recorded `make check` at 955 checks and `make test` at 1278/1278.
- Bootstrap residuals: optional payload-index binding, fixture trust root, shell denylist assurance, validator-copy drift, and publication-gated signing remain at `bootstrap/package/bin/csm-skills-bootstrap.js`, `bootstrap/protocol.md`, `bootstrap/keyring.json`, and `tests/bootstrap-trust.test.mjs`.
- Current local-state residuals: csm-browse's ignored `node_modules` may record an older pnpm; no tracked repository vulnerability was found.
- Current residual count is intentionally lower than the original report because accidental fixes were rechecked against current source.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | Documentation-only corrections should prefer current behavior over changing public behavior. | planning default | Most residuals are stale contracts or wording. | decided |
| D2 | Retain unsigned local bootstrap flow as advisory-only; signed/payload-binding hardening is not required in this cycle. | user decision | User selected “Advisory only”. | decided |
| D3 | Use a manual dependency update policy; do not add Dependabot/Renovate or external automation. | user decision | User selected “Manual policy”. | decided |
| D4 | F7-02 is local-only state and is not a repository defect; clean-install verification may be added to T010. | evidence-based | Scout confirmed `.modules.yaml` is ignored local state. | decided |
| D5 | Dead code is removable only when imports/tests prove no production use; otherwise document a retirement seam. | safety guard | Applies to F2-08/F2-09/F3-07/F3-15; no product choice needed. | decided |
| D6 | T005 uses strict contracts: `--fail-on-gaps` implies non-interactive mode and report/graph runId linkage is required at publication. | user decision | User selected “Strict contracts”. | decided |
| D7 | T004 documents loopback-only VNC exposure as accepted; no password-generation change in this cycle. | user decision | User selected “Document loopback acceptance”. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | Which old findings remain after remediation? | Read-only scout over current HEAD, review report, source, and tests | No repository writes or execution | Residual matrix and accidental-fix audit complete; 0 unresolved evidence questions | Use the 10 clusters below, not the stale original count |
| R2 | Are external specifications needed? | Repository/source review | No external retrieval or mutation needed | All questions concern local contracts and implementation | No csm-deep-research dispatch required |

## Discovered Requirements

- Any bootstrap bin or payload change requires `node scripts/pack-bootstrap.mjs`, payload/index verification, and `tests/bootstrap-trust.test.mjs` plus `tests/package-audit.test.mjs`.
- csm-browse unit tests are offline-safe but require the csm-browse dependency install; use the existing `make test-browse-unit` target.
- csm-scan deterministic baselines must be regenerated only with `test/scripts/regen-baselines.mjs --write`, then checked.
- Orchestration boilerplate edits must use `scripts/sync-skill-boilerplate.mjs`; hand edits to managed sections are invalid.
- Check-suite uses tracked-file snapshots in tests; new tests must be staged/committed before tracked-corpus tests can see them.
- Node >=22 is required for bootstrap suites; use `scripts/with-node22.mjs` through `make test-bootstrap`.

## Design

The plan is partitioned by non-overlapping ownership:

- T001 owns documentation and contract prose only.
- T002-T004 own csm-browse behavior, lifecycle, and security in separate file groups.
- T005 owns csm-ddd correctness/contracts and its direct tests.
- T006 owns csm-scan facts, diagnostics, and bounded parser/trace behavior.
- T007 owns bootstrap trust and release posture; it is decision-gated and independently reviewed.
- T008 owns missing direct tests and flaky test patterns.
- T009 owns local gate/operation behavior.
- T010 owns dependency/toolchain policy and clean-install evidence.

No task silently implements the unresolved bootstrap or dependency policy decisions. If the user does not select an option, the future build marks that task BLOCKED and continues only with independent tasks.

## Execution Graph

- Parallel group G1: T001, T006, T007, T010 (T007/T010 remain decision-gated; T001/T006 have disjoint source ownership).
- Serial browse chain: T001 -> T002 -> T003 -> T004; T002 owns browse behavior/tests, T003 owns lifecycle files/tests, and T004 owns security/VNC files/tests.
- Serial DDD/operations/test chain: T005 -> T009 -> T008; T005 owns DDD contract tests, T009 owns cache-health/operations code, and T008 owns remaining coverage tests.
- Decision gate: T007 runs only after D2 choices are recorded.
- Final integration: generated payload/index refresh, documentation generators, full gates, and independent review after all tasks.

## Numbered Plan

1. [complete] Synchronize residual documentation and contracts
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: authoritative `README.md`, `AGENTS.md`, source SKILL.md files, orchestration boilerplate source/config, and `scripts/lib/contracts.mjs`; generated outputs are separate: README matrix via `gen-readme-matrix.mjs`, managed SKILL sections via `sync-skill-boilerplate.mjs`, and payload copies/index via `pack-bootstrap.mjs`
   - Not in scope: behavior changes, bootstrap trust policy, direct edits to generated payload copies/index; final integration must run the named generators after source wording stabilizes
   - Spike candidate: none
   - Actions: fix F1-09/F1-11/F1-12/F1-13/F1-14; align F2-05/10/18; update F3-03/04/05/06/10; correct F8-08 wording; use boilerplate sync for managed sections; remove stale checked-in e2e summary only if current test paths confirm it is dead.
   - Acceptance signal: after source edits, `node scripts/sync-skill-boilerplate.mjs --write && node scripts/gen-readme-matrix.mjs --write && node scripts/pack-bootstrap.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check && make check` exits 0; generated outputs are reviewed, not hand-edited.
   - Validation: targeted grep assertions for skill counts, NORMS authenticity rule, current browse semantics, and current cache-health model scope.
   - Acceptance evidence: diff plus command output and a residual-ID mapping.
   - Repair attempts: 0
   - Recovery note: documentation-only changes are isolated; regenerate payload after final wording is settled.

2. [complete] Correct csm-browse verb semantics and dead code
   - Task ID: T002
   - Depends on: T001 where behavior wording is selected
   - Parallel group: browse chain
   - Risk: standard
   - Owned scope: `csm-browse/lib/verbs/dom.mjs`, `nav.mjs`, `record.mjs`, `recorder.mjs`, `constants.mjs`, `lib/docker.mjs`, and related unit tests; all daemon/recorder/tunnel lifecycle files remain exclusively T003
   - Not in scope: lifecycle/PID cleanup (T003), credential regex policy (T004)
   - Spike candidate: decide innerText vs textContent and readyState vs load-event semantics from current callers/tests; if behavior is ambiguous, document current behavior rather than changing it.
   - Actions: resolve F2-03/F2-04/F2-06; remove or quarantine F2-08/F2-09 dead seams/constants; suppress normal “not recording” shutdown noise for F2-12; add focused tests for speed metadata/name collisions and chosen DOM/navigation semantics. F2-03/F2-04 behavior choices are recorded in T001 before implementation.
   - Acceptance signal: `node --test --test-concurrency=1 tests/unit/` from csm-browse exits 0 with named focused tests present.
   - Validation: `node scripts/check-skill.mjs` and `make lint`.
   - Acceptance evidence: behavior decision and targeted test output.
   - Repair attempts: 0
   - Recovery note: preserve current public semantics unless the spike records a deliberate change.

3. [complete] Harden csm-browse lifecycle and cleanup
   - Task ID: T003
   - Depends on: T002
   - Parallel group: browse chain
   - Risk: standard
   - Owned scope: `csm-browse/lib/ports.mjs`, `scripts/session-daemon.mjs`, `scripts/ensure-browser.mjs` lifecycle portions, `lib/session.mjs`, `lib/sweep.mjs`, `scripts/cdp-gate.mjs`, and lifecycle tests; T004 owns only security-specific VNC changes after this seam is stable
   - Not in scope: bootstrap trust or URL redaction
   - Spike candidate: model the stale-claim restore race and SIGKILL tunnel orphan in a `/tmp` synthetic copy before changing cleanup order.
   - Actions: address F2-11, F5-03/04/05/10/11/12, F9-02 with identity-preserving restore, bounded close/finalize, atomic state writes, argv re-verification before signals, and explicit tunnel-child teardown; add regression tests for each ownership boundary.
   - Acceptance signal: `node --test --test-concurrency=1 tests/unit/session-daemon-stale-claim.test.mjs tests/unit/lifecycle-identity.test.mjs tests/unit/sweep-ports.test.mjs tests/unit/daemon.test.mjs` from csm-browse exits 0 with lifecycle regression names present.
   - Validation: `make lint`, focused PID/sweep/daemon tests, no orphaned child in synthetic teardown.
    - Acceptance evidence: bounded timing and ownership test transcripts.
    - Repair attempts: 0
    - Completion evidence: identity-aware daemon liveness is shared by status/log/sweep; stale claim and port-lock restoration never overwrite a fresh claim; state writes use unique temp names and sweep revocation uses saveState; daemon recorder finalize and CDP close are bounded; retry marker cleanup requires child exit and identity ownership; gate shutdown tracks and reaps tunnel children. Exact focused suite passed 23/23, full csm-browse unit suite passed 194/194, and `make lint` passed.
    - Recovery note: never broaden signal targets; preserve existing identity guards.

4. [complete] Harden csm-browse security and credential handling
   - Task ID: T004
   - Depends on: T001/T002 for contract choices
   - Parallel group: G1 after browse semantics
   - Risk: high for VNC policy; standard for malformed-regex handling
   - Owned scope: `csm-browse/lib/verbs/log.mjs`, `scripts/ensure-browser.mjs`, security tests
   - Not in scope: DDD redaction vocabulary (T005)
   - Spike candidate: measure false-positive impact of regex filters and review VNC threat boundary; do not change password policy without a decision.
   - Actions: handle invalid/pathological `--filter` regexes safely (F4-07); document loopback-only VNC exposure as the accepted risk for F4-10 without changing password generation.
   - Acceptance signal: `node --test --test-concurrency=1 tests/unit/security.test.mjs tests/unit/recorder.test.mjs tests/unit/log.test.mjs` from csm-browse exits 0 with malformed-regex and selected VNC cases.
   - Validation: `make test-browse-unit`, lint, no credential leakage in synthetic telemetry.
    - Acceptance evidence: threat decision plus tests.
    - Repair attempts: 0
    - Completion evidence: F4-07 now bounds `--filter` at 256 characters and reports malformed regexes without a raw crash; F4-10 documents and tests the accepted loopback-only VNC boundary without changing password generation. Focused tests passed 32/32, VNC security-gate tests passed 17/17, full csm-browse unit suite passed 197/197, `node scripts/check-skill.mjs` passed, and `make lint` passed. No lifecycle sections in `scripts/ensure-browser.mjs` were changed by T004.
    - Recovery note: redact/credential behavior changes require independent review.

5. [complete] Tighten csm-ddd correctness and contract synchronization
   - Task ID: T005
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-ddd/lib/ddd/clarify.mjs`, `render.mjs`, `synthesize.mjs`, `contracts.mjs`, graph schema, `scripts/ddd.mjs`, direct tests
   - Not in scope: extractor size/redaction fixes already completed
   - Spike candidate: decide D6 options: make report/graph runId cross-link a hard CLI invariant or retain validation-only behavior; make `--fail-on-gaps` imply non-interactive, reject interactive use, or retain the two-flag contract. Record choices before implementation.
   - Actions: fix F2-14/15/17/18/19/20/21, F3-11, F9-01; synchronize enums or add a contract test; enforce report/graph runId linkage at publication; make `--fail-on-gaps` imply non-interactive mode; test flags, output counts, render order, dead `void` paths, and payload-index error handling.
   - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1` exits 0 with direct contract/CLI tests.
   - Validation: schema validator, CLI negative paths, `make check`.
   - Acceptance evidence: decision record and focused suite output.
   - Repair attempts: 0
   - Completion evidence: 47/47 DDD tests pass, including strict fail-on-gaps, runId cross-link, enum synchronization, answer counts, payload-index error, and redaction coverage.
   - Recovery note: preserve artifact compatibility unless the decision explicitly changes the contract.

6. [complete] Improve csm-scan correctness and diagnostics
   - Task ID: T006
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-scan/lib/scan/deep/git.mjs`, `shared/command.mjs`, `report/verbose-trace.mjs`, `write.mjs`, registry headers, `shared/ignore.mjs`, `survey.mjs`, tests/baselines
   - Not in scope: scanner architecture rewrite or new external dependencies
   - Spike candidate: none; use existing fixtures and deterministic baseline generator.
   - Actions: fix F3-01/02/08/09; align F3-04/05/06/10 docs; remove dead exports F3-07; clarify F3-03 atomic-write contract; ensure verbose trace fallback/error reporting is truthful; regenerate baselines only through the official tool.
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1 && out=$(node test/scripts/regen-baselines.mjs); printf '%s\n' "$out"; printf '%s\n' "$out" | grep -Fx 'baselines clean'` exits 0.
   - Validation: `make check`, deterministic two-run comparison for verbose/parser cases, and one named regression test per selected F3 finding.
   - Acceptance evidence: fixture results and baseline output.
    - Repair attempts: 0
    - Completion evidence: F2-03 now emits documented `textContent`; F2-04 waits for `Page.loadEventFired` with the listener armed before navigation; F2-06 records effective speed FPS and preserves names equal to speed values; F2-08 production mutator removed and all unit imports use the test helper; F2-09 `FFMPEG_ARGS` removed; F2-12 ignores the normal `not recording` shutdown sentinel; F6-02 named DOM/navigation/recording coverage added. `node --test --test-concurrency=1 tests/unit/` passed 192/192, `node scripts/check-skill.mjs` passed, and `make lint` passed.
    - Completion evidence: F3-01/F3-02/F3-07/F3-08/F3-09 regressions pass; focused csm-scan suite 49/49; `make lint` passes; official baseline check prints `baselines clean`. Full csm-scan run reached 1279/1282 with unrelated concurrent T201/T228 failures; those files were not changed.
   - Recovery note: preserve the command broker’s current allowlist and output bounds.

7. [complete] Resolve bootstrap trust and release posture
   - Task ID: T007
   - Depends on: explicit bootstrap decisions D2 only; D3/D6/D7 belong to other tasks and must not block T007
   - Parallel group: decision gate
   - Risk: HIGH — trust boundary/publication impact; mandatory independent review
   - Owned scope: bootstrap bin/protocol/release checklist/keyring, trust-policy/engine copies, bootstrap tests, payload/index
   - Not in scope: implementation before decisions; no publishing/deploying or key generation against real credentials
   - Spike candidate: isolated synthetic envelope matrix in `/tmp` for unsigned, omitted payload digest, malformed steps, fixture key, and validator parity.
   - Actions: resolve F3-12/15 and F4-02/03/04/05; explicitly record F4-01 as already resolved by the prior signed-marker build; implement only the selected signature requirement, payload binding, structured-step validation posture, validator parity, and fixture-key release gate; document non-production key custody.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs && node scripts/with-node22.mjs --exec node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs` exits 0 with every selected refusal/acceptance case.
   - Validation: payload/index consistency, source-parity checks, independent security review, no publish.
   - Acceptance evidence: decision table, synthetic matrix, reviewer approval.
   - Repair attempts: 1
   - Completion evidence: independent review repair completed; bootstrap suite 15/15, deterministic isolated packs pass, malformed index/mode/release-fixture cases pass, `make check` and lint green.
   - Recovery note: if any policy decision is absent, mark T007 BLOCKED rather than guessing.

8. [complete] Close targeted test and flakiness gaps
   - Task ID: T008
   - Depends on: T002, T003, T005, T009 behavior decisions and code stabilization
   - Parallel group: G1 after implementation contracts
   - Risk: standard
   - Owned scope: csm-ddd renderer/CLI coverage tests not owned by T005, recorder timing tests, cache-health tests; T002 owns core browse-verb tests and T005 owns DDD contract tests
   - Not in scope: broad test-suite generation or mutation tooling
   - Actions: address F6-06/08/09/10 with direct renderReport/CLI-cap/cache-health-main-path tests; replace fixed sleeps with bounded event/file waits. F6-02 is owned by T002.
   - Acceptance signal: `node --test tests/cache-health.test.mjs tests/wt-session.test.mjs && cd csm-ddd && node --test --test-concurrency=1 test/cli.test.mjs && cd ../csm-browse && node --test --test-concurrency=1 tests/unit/recorder.test.mjs` exits 0; no fixed sleep remains in targeted recorder paths.
   - Validation: `make test` and named direct renderer/CLI tests after T002-T006.
   - Acceptance evidence: test names/results and flake-resistant wait proof.
   - Repair attempts: 0
   - Completion evidence: focused T008 suites pass 17/17, 14/14, and 7/7; recorder sleeps replaced by bounded waits; aggregate blocker is unrelated untracked plan only.
   - Recovery note: add tests before changing behavior where possible.

9. [complete] Improve local operations and gate behavior
   - Task ID: T009
   - Depends on: T001 and T005 where docs/contracts overlap
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `.lefthook.yml`, `scripts/record-gate-baseline.mjs`, `scripts/check-suite.mjs`, `scripts/close-plan.mjs`, `scripts/wt-session.mjs`, `scripts/cache-health.mjs`
   - Not in scope: changing unrelated review findings already resolved
   - Spike candidate: measure duplicate gate cost and close-plan failure recovery in `/tmp` copies before changing hook ordering or writes.
   - Actions: address F3-14, F8-01/02/04/06/10/11/12; make failure labels accurate, make worktree matching exact, improve close-plan recovery, reconcile baseline documentation/code, expose cache model scope, and decide whether duplicate gate execution is acceptable.
   - Acceptance signal: `make test-hooks && node --test tests/cache-health.test.mjs tests/wt-session.test.mjs && make check` exits 0.
   - Validation: synthetic prefix-collision worktree, failed close-plan recovery, and one-gate timing transcript.
   - Acceptance evidence: before/after operational output.
   - Repair attempts: 0
   - Completion evidence: hook 8/8, focused operations 15/15, prefix/model/close-plan/failure-label probes pass, `make check` 967 checks.
   - Recovery note: preserve guard-first ordering and never weaken staged/unstaged protections.

10. [complete] Establish dependency and toolchain policy
    - Task ID: T010
   - Depends on: none; D3 is decided
    - Parallel group: decision gate
    - Risk: standard
    - Owned scope: package manifests/lockfiles, optional dependency automation config, install documentation/tests
    - Not in scope: committing ignored node_modules or changing runtime versions without evidence
    - Spike candidate: isolated clean install in `/tmp` using both package manifests; compare pnpm versions and lockfile resolution.
   - Actions: resolve F7-02/03/04 through a manual policy: document update cadence, lockfile review, ws-major tracking, and exact-vs-range rationale; add a reproducible clean-install check. F7-01 remains local-only and must not be committed.
   - Acceptance signal: in a fresh `/tmp` copy with redirected HOME/XDG/TMPDIR, `make install` exits 0 with both frozen lockfiles and no writes outside the copy; `make check` verifies the manual policy text and manifest/lockfile parity.
   - Validation: manifest/lockfile parity and `pnpm list --depth=0` in the isolated copy; OSV is research evidence only, not an acceptance gate.
     - Acceptance evidence: policy decision and isolated install transcript.
     - Repair attempts: 0
     - Recovery note: if automation credentials/access would be required, document config-only scope and stop before external mutation.
     - Completion evidence: `node --input-type=module -e '...'` policy/parity check passed; `make lint` passed; isolated Node 22 copy `/tmp/opencode/t010-install.EV0oeV` ran `make install` with frozen lockfiles and `pnpm list --depth=0` successfully; no `.github` automation exists. Full `make check` was attempted and is blocked by unrelated concurrent payload/boilerplate/plan drift.

## Verification Strategy

Run focused tests first, then each cluster's suite, then `make lint`, `make check`, documentation/payload generators, and final `make test`. T007 requires independent security review; T001/T009 require documentation/gate review; T010 requires clean-install evidence. Keep all experiments in disposable `/tmp` copies. Generated payload/index and csm-scan baselines are refreshed only after source changes stabilize.

## Risks And Recovery

- Bootstrap policy disagreement blocks T007; do not ship a guessed trust policy.
- Dependency automation may require repository-owner or GitHub policy decisions; keep it configuration-only unless approved.
- Lifecycle fixes can introduce shutdown ordering regressions; use synthetic child/PID/tunnel tests and bounded timeouts.
- csm-scan baseline changes must be generated, not hand-edited.
- Existing untracked review/research artifacts are preserved and excluded from future commits unless explicitly requested.
- Each task owns distinct files; shared generated payload/index work happens last.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| B1 residual traceability was opaque | blocker | Embedded a per-finding residual disposition matrix with resolved/excluded rows and one owner per remaining ID | Residual Disposition Matrix |
| B2 open product decisions with ready status | blocker | Plan status changed to blocked; D2/D3/D6/D7 list concrete options and task-specific consequences | Control; Assumptions And Decisions |
| M1 T001 payload anti-scope conflicted with make check | major | Source/generated ownership separated; T001 acceptance runs sync, matrix, pack, then check | T001 |
| M2 T010 lacked runnable signal | major | Isolated `/tmp` clean-install command and credential-free automation validation specified | T010 |
| M3 T006 baseline signal was non-failing on drift | major | Acceptance now asserts exact `baselines clean` output after the suite | T006 |
| M4/M6 ownership and graph overlap | major | Browse and DDD/operations/test chains explicitly serialized with one owner per shared file family | Execution Graph; T002-T009 |
| M5 T007 depended on unrelated decisions and omitted prior F4-01 disposition | major | T007 depends only on D2; F4-01 explicitly recorded as previously resolved; D3/D6/D7 assigned elsewhere | T007; matrix |
| M7 weak acceptance signals | major | Focused commands and named test files added for browse, lifecycle, security, DDD, scan, tests, and operations | T002-T009 |
| m1 risk schema | minor | T004 now distinguishes high VNC policy from standard regex work; T008 uses one standard tier | T004/T008 |
| m2 generated-output boundary | minor | Authoritative sources and generators explicitly separated | T001 |
| m3 broad scan cluster | minor | T006 requires one named regression per selected F3 implementation finding | T006 |
| m4 OSV as acceptance | minor | OSV retained only as research evidence; install/policy checks are deterministic | T010 |
| m5 protected-state verification | minor | T001/T007/T010 specify isolated copies, generated-output review, and no external mutation | T001/T007/T010 |
| Residual matrix may include accidental fixes | major | Scout rechecked current HEAD and marked resolved IDs excluded | `/tmp/opencode` residual dossier |
| Bootstrap policy choices are product decisions | blocker if guessed | T007 has explicit decision gate D2-D5 and BLOCKED recovery | T007/D2-D5 |
| Dependency automation is a repository policy choice | major | T010 decision gate D3; no automation assumed | T010/D3 |
| Low findings overlap across files | medium | Ten ownership clusters with explicit dependencies and no duplicate F5-09 task | Execution Graph/T001-T010 |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-23T23:22:54+0000 | 0 | INTAKE -> DISCOVER | none | explicit request received; tmux session renamed; current HEAD ca81d7e; no NORMS.md; no implementation authorized | DISCOVER |
| 2026-08-23T23:27:09+0000 | 0 | DISCOVER -> RESEARCH | none | residual scout reassessed all listed IDs; accidental fixes removed; 10 clusters and 10 decision questions identified | RESEARCH |
| 2026-08-23T23:30:00+0000 | 0 | RESEARCH -> DRAFT | none | repository-only evidence sufficient; no external research needed; draft written | DRAFT |
| 2026-08-23T23:35:00+0000 | 0 | DRAFT -> CRITIQUE | T001-T010 | hostile critique dispatched; found 2 blockers, 7 majors, 5 minors | CRITIQUE |
| 2026-08-23T23:40:00+0000 | 0 | CRITIQUE -> REMEDIATE | T001-T010 | traceability matrix embedded, plan blocked on explicit decisions, ownership/dependencies/acceptance signals corrected | REMEDIATE |
| 2026-08-23T23:45:00+0000 | 0 | REMEDIATE -> VERIFY | T001-T010 | primary verification: every residual ID has one disposition, every task has runnable signal/risk/anti-scope, decision gates explicit; status remains blocked pending user choices | VERIFY |
| 2026-08-23T23:50:00+0000 | 0 | VERIFY -> SAVED | none | user decisions recorded: advisory bootstrap, accepted loopback VNC risk, strict DDD contracts, manual dependency policy; plan status changed to ready; implementation not started | SAVED |
| 2026-08-24T00:20:00+0000 | 1 | CHECKPOINT | T010 | Added README manual dependency policy and credential-free manifest/lockfile parity gate. Focused policy check, lint, Node 22 isolated frozen install, and top-level package listing passed. `make check` and check-suite regression remain blocked by unrelated concurrent payload/boilerplate/plan drift; no unrelated files changed. | SELECT |
| 2026-08-24T00:35:00+0000 | 1 | INTEGRATE -> CHECKPOINT | T001 | Fixed F1-09/F1-11/F1-12/F1-13/F1-14, F2-05/F2-10/F2-18, F3-03/F3-04/F3-05/F3-06/F3-10, and F8-08 through authoritative documentation/contracts; generated boilerplate, README matrix, and bootstrap payload. Sync check, matrix check, baseline JSON validation, and `make check` passed (967 checks). Concurrent non-T001 changes remain preserved. | SELECT |
| 2026-08-24T01:05:00+0000 | 1 | INTEGRATE -> CHECKPOINT | T006 | Fixed F3-01/F3-02/F3-07/F3-08/F3-09; focused 49/49 pass, `make lint` passes, and official baseline check prints `baselines clean`. Full csm-scan run recorded 1279/1282; remaining T201/T228 failures are concurrent cross-task gate failures and were not modified. | SELECT |
| 2026-08-24T06:05:04+0000 | 1 | INTEGRATE -> CHECKPOINT | T002 | Fixed browse DOM/load semantics, recording FPS/name parsing metadata, production test seam, dead FFMPEG_ARGS, and normal shutdown noise; added named core verb/recording tests. Browse unit suite passed 192/192; `node scripts/check-skill.mjs` and `make lint` passed. | SELECT |
| 2026-08-24T00:00:00+0000 | 1 | INTEGRATE -> CHECKPOINT | T003 | Fixed lifecycle identity drift, stale-claim restore clobbering, bounded daemon shutdown/finalization, unique state writes, identity-gated sweep signals, and explicit gate tunnel reaping. Exact focused suite passed 23/23; full csm-browse unit suite passed 194/194; `make lint` passed. No commits or external mutation per request. | SELECT |
| 2026-08-24T06:25:00+0000 | 1 | INTEGRATE -> CHECKPOINT | T004 | Fixed F4-07 with bounded, CLI-safe network filter compilation and added malformed/oversized regex tests. Recorded D7 in user-facing VNC documentation and pinned the loopback-only mapping/documentation contract in security-gate tests; password generation and lifecycle sections were unchanged. Focused 32/32, VNC gate 17/17, full browse 197/197, check-skill, lint, and diff checks passed. No commit or external mutation. | SELECT |
| 2026-08-24T09:00:00+0000 | 1 | INTEGRATE -> VERIFY | T001,T002,T003,T004,T005,T006,T007,T008,T009,T010 | All ten tasks have focused evidence; T007 independently reviewed and repaired twice; pack/check/lint pass at 967 checks; DDD 47/47; csm-scan 1282/1282; bootstrap 15/15; browse 197/197; operations/hooks and T008 focused suites pass. | VERIFY |
| 2026-08-24T09:05:00+0000 | 1 | VERIFY -> BLOCKED | final gate | Real-tree `make test` fails only because unrelated untracked `.agents/plans/2026-08-23-autoresearch-evaluator-csm-csm.md` has invalid `Control Next transition: NOT_STARTED -> RECOVER on...`; isolated copy with that file removed passes resume-semantics 5/5. User ownership decision required; file preserved. | BLOCKED |
| 2026-08-24T09:20:00+0000 | 1 | BLOCKED -> COMPLETE | final gate | User approved the one-line transition fix; real-tree resume semantics 5/5 and make test 1282/1282 now pass; final review found no new material defect. | COMPLETE |

## Completion Review

Status: COMPLETE.

- All ten planned residual tasks have implementation evidence and focused validation.
- Repository gates pass: `make check` 967 checks, `make lint`, payload pack/index, DDD 47/47, csm-scan 1282/1282, bootstrap 15/15, browse 197/197, operations/test-focused suites, and real-tree `make test` 1282/1282.
- T007 received two independent security review/repair cycles; advisory-only unsigned behavior, exact mode validation, malformed-index refusal, and release fixture-key refusal are tested.
- The user-approved one-line transition fix was applied to the concurrent autoresearch plan; other unrelated untracked review/draft artifacts remain preserved and are not part of this build.
