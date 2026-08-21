format: csm-plan/1

# Review Remediation (2026-08-21 audit) CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 17 tasks — 0 high, 3 standard-security (T006, T010, T011), rest low/standard. T010 and T011 always require independent review (security/integrity surfaces).

## Control

- Plan ID: review-remediation-2026-08-21
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: planning SAVED 2026-08-21 after two-pass review evidence (reports .agents/reviews/2026-08-21-skills-review.md and -2.md @ d94c840)
- Last model/run: ox-alpha / opencode session 2026-08-21
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Remediate all HIGH and MEDIUM findings from .agents/reviews/2026-08-21-skills-review-2.md (F-001..F-020) plus six verified quick-win LOWs (L14/L17/L19-partial/L20/L21/L22), at pinned repo d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3 or descendant. Deliverables: fully green test suites (scan 1270/1270 incl AC20; bootstrap 20/20), working run-tier, patched packageManager, closed payload-drift gap, corrected compose parsing, fixed daemon lifecycle bugs, guarded wt-session. Exclusions: F-014 kept minimal (consolidation only); LOW bundle L1-L13, L15, L16, L23-L28 out of scope; no publication-gate flip for unsigned envelopes (documented deferred decision stays deferred); no CI introduction beyond the tier-partition gate wiring (L19 remains open).

## Acceptance Criteria

1. `cd csm-scan && node --test --test-concurrency=1` → 1270 pass, 0 fail (AC20 green).
2. `node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs` → 0 fail.
3. `node csm-scan/test/scripts/run-tier.mjs s|m|l|all` → partition check passes and named tier executes.
4. Both manifests pin pnpm ≥10.34.2; `pnpm install --frozen-lockfile --ignore-scripts` succeeds.
5. Adding a synthetic source file under a mapped payload dir makes `node scripts/check-suite.mjs` FAIL with MISSING-IN-PAYLOAD; removing it restores OK.
6. Synthetic compose fixture without capital-Z letters yields volumes+networks in scan output.
7. Stale daemon pidfile scenario: relaunch claims and boots (unit-proven).
8. `make analyze` green; browse unit suite green.
9. Repo status contains no unexplained changes; every task has recorded acceptance evidence.

## Current-State Evidence

- All findings line-verified in review-2 report (verification matrix). Suite baseline measured at R3 sandbox: scan 1255/1270 (15 fails), bootstrap 19/20, check-suite OK, lint PASS, run-tier exits 1.
- Quote-drift root: oxfmt double quotes vs single-quote pins — expansion-command-core.test.mjs:248-251; expansion-command-deep.test.mjs:99-100,460-464; baselines/expansion/renderer.md padded tables vs lib/scan/write.mjs:111-119 + render/* compact emitters; tests/bootstrap-trust.test.mjs:451-453 regex vs bin :29-34.
- tiers.mjs holds 65 entries; 80 test files exist; 13 remediation-f0xx-* + render-git + verbose-trace unlisted; run-tier.mjs:93-107 hard-fails on missing.
- pnpm registry: 10.34.2 exists (fix for GHSA-3qhv-2rgh-x77r); latest 10.x line = 10.34.5; engines node >=18.12 compatible. Retrieved 2026-08-21 via registry.npmjs.org GET.
- Payload drift gate: scripts/check-suite.mjs:584 walks payload tree only; srcMap consulted only via .get(); buildPayloadSrcMap at :546-563; pack mapping at scripts/pack-bootstrap.mjs:42-63 (srcDir csm-scan/lib/scan).
- Compose bug: lib/scan/deep/operations.mjs:654 `\Z`, :673 `|Z)`, :679 `(?=Z)` — literal capital Z in JS regex; volumes match null empirically.
- Daemon: session-daemon.mjs:2 imports lack rename; calls :56,:63 inside try/catch :55-59 (swallows → silent no-op → CLAIM_DEADLINE exit(1) :80); kill(pid,0)-only liveness :122, ports.mjs:29; marker counted unconditionally ports.mjs:129-133; pool 9224-9234 (11 pairs, constants.mjs:94-95); sweep freshness mtime-only sweep.mjs:29-31; adoption writes marker once ensure-browser.mjs:673-683.
- wt-session.mjs: rebase-before-guard :104-111 (`cwd = wt || root`), no try/finally around rebase, nuke non-atomic :154-158, basename fallback :131-136; zero coverage of fallback path in tests/wt-session.test.mjs.
- Tarjan: graph-facts.mjs strongConnect unconditional recursion (:117-127), limits.files 50_000 (:31); pipeline/run.mjs:331 wraps only PRIVACY_ENFORCED_DIMENSIONS.
- Bootstrap integrity: bin binding conditional (:52-53,:129-130); fixtures/valid.json lacks payload_index_sha256; bin has zero limits handling; trust-policy enforces bounds (:110-121,:143).
- Collectors: splice-then-empty-catch collectors.mjs:46-54; recorder.mjs droppedFrames pattern exists (:212,:297,:317,:454) as in-repo precedent.
- CANARIES: privacy-gate 19 vs acceptance 18 (:55-75 vs :1349-1368); delta alice:secret@github.com.
- README: oxfmt omitted ×5 (:134,:183,:185,:245,:254); fmt/fmt-check/fmt-staged/test-e2e absent from target list (:250-262); engines root >=22 vs subs >=22 <25; pack-bootstrap version literal :125; with-node22 hardcoded v22.23.2 :10; pre-commit shim machine path :19,:21.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --------- | ---- | --------------------- | ------ |
| A1 | Fix quote-style literals rather than reformat sources | decided | Sources are canonical oxfmt output; assertions are the stale side | open |
| A2 | Baselines regenerated via NEW committed regen script (resolves F-017 simultaneously) | decided | No writer exists anywhere (F-017 verified); hand-recompute is undocumented tribal knowledge | open |
| A3 | pnpm bumped to 10.34.5 (latest patched 10.x), not 11.x | decided | 11.x is a major jump; advisory fixed in 10.34.2; lockfileVersion 9.0 unchanged | open |
| A4 | Index signing uses existing embedded Ed25519 keyring at pack time; verify requires binding when signature present | decided | Reuses shipped validator; publication hard-gate stays deferred (prior documented decision) | open |
| A5 | PID identity = argv[1] basename + /proc/<pid>/stat starttime stored in pidfile/lock JSON | decided | Matches existing isSessionDaemon precedent (cleanup.mjs:17) | open |
| A6 | Marker heartbeat during adoption via periodic utimes touch | decided | Mirrors daemon ready-marker touch loop precedent | open |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |
| R1 | Patched pnpm availability/compat | registry.npmjs.org GET 2026-08-21 | read-only retrieval | 10.34.2..10.34.5 exist; node >=18.12 | T005 safe |
| R2 | Does quote-fix turn all 15 failures green? | deferred spike | n/a | Unknown until executed | Spike question in T001/T002 acceptance; other stale spots possible |
| R3 | Can regen script reuse test helpers? | code inspection | none needed | expansion-shared/pipeline-mirror helpers already construct canonical output used by tests | T002 imports them; ~small script |

## Discovered Requirements

- oxfmt formats all tracked .mjs/.js including generated bin — any assertion pinning source bytes must be format-agnostic (quote-normalize or parse).
- Serial-only scan suite: never introduce timing sleeps; fixtures via test/harness.mjs mkdtemp pattern.
- check-suite gates are the repo conformance surface: new gates must be deterministic and offline.
- Security ordering guarantees in csm-browse/lib/security.mjs (lstat ancestor walk before O_NOFOLLOW open) must be preserved when converting sync→promise — ordering identical, only sync-ness changes.
- Pre-commit hook runs fmt-staged + gates on every commit; generated bin edits will be reformatted by oxfmt — run `make fmt-check` before committing.
- Commits: conventional concise messages referencing task IDs; hooks active (lefthook installed).

## Design

Minimal-diff remediation grouped by subsystem. Tests-infra: make stale assertions format-agnostic (strip/normalize quotes before matching); add csm-scan/test/scripts/regen-baselines.mjs importing pipeline-mirror/expansion-shared to recompute all six artifacts with explicit --write; regenerate renderer.md (+ any sibling stale artifacts the spike reveals). Tier manifest gains the 15 missing entries; check-suite grows a tier-partition gate calling assertManifestPartition logic. Bootstrap: R5 policy extraction becomes quote-agnostic (parse block, strip quotes); bin gains limits validation mirroring trust-policy (max_bytes integer bounds, allowed_origin https URL, hex digest format) and a canonical-equality drift test pinning bin checks to trust-policy semantics; pack-bootstrap signs canonical payload-index.json bytes with embedded-keyring Ed25519 (sig recorded in index), valid.json regenerated carrying correct payload_index_sha256, verify enforces binding whenever envelope is signed. Scanner: operations.mjs compose regexes end conditions become `(?=^\S)|$` under m-flag (or slice-by-top-level-keys); graph-facts strongConnect converted to iterative Tarjan (explicit stack); pipeline wraps architecture dimension via safeScanDimension like privacy dimensions. Daemon/lifecycle: add rename import; breakStaleClaim unit test; pidfile/lock payloads gain creator identity {argv1, starttime}; liveness checks compare identity before declaring alive; claimedPortSet ignores markers whose creator pid is provably dead AND age > grace; adoption loop touches creating.marker every ≤30s until saveState. wt-session: fail-closed when worktree missing (no `|| root` fallback); guard cur!=="main" BEFORE fetch/rebase; try/catch with rebase --abort; nuke deletes branch first then worktree; basename fallback removed (branch must match wt/<slug>); tests added for fallback-refusal and branch-deletion. Browse quality: collectors flush failure increments droppedWrites surfaced in recorder.json/status output; security.mjs lstatSync chains converted to awaited lstat preserving order, cleanup rmSync→awaited rm; verbs route through shared attachFirstPage(client) extracted into cdp.mjs (log/capture/status/daemon-core call sites updated, error text unified). Docs/config: engines aligned >=22 <25 root; pack reads version from bootstrap/package.json; README passages fixed (oxfmt ×5, four missing targets); with-node22 globs ~/.nvm/versions/node/v22.* picking highest <25; committed pre-commit shim normalized to portable branches only.

## Execution Graph

```
G1 (tests-infra, independent): T001, T002(dep T001 for stable baseline? no—independent), T003, T004, T015
G2 (scan-lib): T007, T009
G3 (bootstrap/tooling): T006, T010
G4 (browse-lifecycle serial chain): T008 -> T011
G5 (browse-quality): T013, T014, T017
G6 (docs/config): T005, T012, T016
Final gate batch (serial): full suites + analyze (all groups)
Critical path: G4 chain then final gate. All groups mutually file-disjoint.
```

## Numbered Plan

1. [pending] Normalize quote-style assertions in capability gates (F-001)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: csm-scan/test/expansion-command-core.test.mjs, csm-scan/test/expansion-command-deep.test.mjs
   - Not in scope: lib/scan/shared/command.mjs, other test files
   - Spike candidate: do remaining 10 failures clear after T001+T002? (observe in acceptance runs; isolation: none needed)
   - Actions: replace exact-quote regex/includes needles with quote-normalized comparison (normalize both sides `'`→`"` before match); keep assertion strength (still proves sole-import invariant)
   - Acceptance signal: `node --test csm-scan/test/expansion-command-core.test.mjs csm-scan/test/expansion-command-deep.test.mjs` → 0 fail
   - Validation: `cd csm-scan && node --test --test-concurrency=1` → count failures drops from 15 by ≥3
   - Acceptance evidence: test output pasted to journal
   - Repair attempts: 0
   - Recovery note: single-file edits; revert via git checkout if partial

2. [pending] Regen-baselines script + refresh renderer baseline (F-002, F-017)
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: csm-scan/test/scripts/regen-baselines.mjs (new), csm-scan/test/baselines/expansion/* regeneration
   - Not in scope: renderer implementation (lib/scan/write.mjs, render/*)
   - Spike candidate: which of the six artifacts are stale at current SHA? (script diff-summary answers; isolation: run in /tmp copy first)
   - Actions: script imports pipeline-mirror/expansion-shared helpers, recomputes semantic.json/renderer.md/inventory.json/supersession.json/fixtures-behavior/capabilities digests deterministically, prints diff summary, writes only with --write; regenerate stale artifacts
   - Acceptance signal: `node --test csm-scan/test/expansion-baseline.test.mjs csm-scan/test/expansion-render-registration.test.mjs` → 0 fail
   - Validation: git diff shows ONLY intended baseline bytes changed; no production file touched
   - Acceptance evidence: script path + regenerated artifact list in journal
   - Repair attempts: 0
   - Recovery note: baselines are git-tracked; restore via checkout

3. [pending] Quote-agnostic R5 policy extraction in bootstrap drift test (F-003)
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: tests/bootstrap-trust.test.mjs (R5 extraction block only)
   - Not in scope: bootstrap/package/bin/**
   - Actions: extract policy fields with quote-insensitive parser (e.g. strip quotes then key:value match); keep SHELL_DENYLIST source-compare half untouched
   - Acceptance signal: `node --test tests/bootstrap-trust.test.mjs` → 0 fail (R5 passes)
   - Validation: deliberately mutate bin policy value in /tmp copy → R5 must still catch drift (negative check)
   - Acceptance evidence: both outputs journaled
   - Repair attempts: 0
   - Recovery note: single-test edit; checkout reverts

4. [pending] Tier manifest completeness + partition gate (F-004)
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: csm-scan/test/scripts/tiers.mjs, scripts/check-suite.mjs (new gate section only)
   - Not in scope: run-tier.mjs runner logic
   - Actions: add 15 unlisted files (13 remediation-* → M or L per subprocess dependence; render-git + verbose-trace → S); export assertManifestPartition-reusing check in check-suite that fails on manifest/disk divergence
   - Acceptance signal: `node csm-scan/test/scripts/run-tier.mjs s` → executes S-tier tests (exit reflects test results, not partition failure)
   - Validation: `node scripts/check-suite.mjs` → OK with new gate listed; temporarily remove an entry → gate fails (negative check in /tmp copy)
   - Acceptance evidence: outputs journaled
   - Repair attempts: 0
   - Recovery note: manifest is data-only; checkout reverts

5. [pending] CANARIES/SARIF/SBOM shared fixtures + equality pin (F-018)
   - Task ID: T015
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: csm-scan/test/helpers/privacy-fixtures.mjs (new), the two consumer test files' fixture blocks
   - Not in scope: gate logic itself
   - Actions: extract CANARIES/SARIF/SBOM into helper; both suites import it; add equality-pin test mirroring BANNED_VOICE pattern; include alice:secret@github.com canary everywhere
   - Acceptance signal: `node --test csm-scan/test/expansion-privacy-gate.test.mjs csm-scan/test/expansion-final-acceptance.test.mjs` → 0 fail
   - Validation: grep confirms single CANARIES definition site
   - Acceptance evidence: outputs journaled
   - Repair attempts: 0
   - Recovery note: additive helper; checkout reverts consumers

6. [pending] Compose end-of-section anchors fix (F-005)
   - Task ID: T007
   - Depends on: none
   - Parallel group: G2
   - Risk: low
   - Owned scope: csm-scan/lib/scan/deep/operations.mjs (:654,:673,:679 region), its direct test file if exists under csm-scan/test
   - Not in scope: deployment/extractor.mjs consolidation (larger refactor, excluded)
   - Actions: replace `(?=^\S|\Z)` with `(?=^\S|$)`+m-flag equivalents; bare-Z alternations with `$`; add unit test with typical compose text asserting volumes/networks/deps captured
   - Acceptance signal: new unit test passes with capital-Z-free fixture proving volumes+networks parsed
   - Validation: affected deep-dimension tests green; `rg -n '\\\\Z\|\(\?=Z\)' csm-scan/lib` returns nothing
   - Acceptance evidence: fixture + output in journal
   - Repair attempts: 0
   - Recovery note: contained regex edits

7. [pending] Iterative Tarjan + wrap architecture dimension (F-020)
   - Task ID: T009
   - Depends on: none
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-scan/lib/scan/deep/architecture/graph-facts.mjs (strongConnect region), csm-scan/lib/scan/pipeline/run.mjs (dimension wrap list)
   - Not in scope: other legacy dimensions' wrap policy debate — wrap architecture only
   - Actions: convert recursive strongConnect to iterative explicit-stack Tarjan preserving output ordering (toSorted adjacency retained); include architecture in safeScanDimension-wrapped set so failure degrades instead of aborting; unit test with synthetic 10k linear chain in mkdtemp fixture
   - Acceptance signal: new deep-chain test completes without RangeError and returns expected SCC count (all singletons)
   - Validation: existing graph/architecture tests green; injected throw in architecture dimension yields degraded finding not pipeline abort (test)
   - Acceptance evidence: outputs journaled
   - Repair attempts: 0
   - Recovery note: algorithm swap localized; benchmark parity via existing tests

8. [pending] Payload-drift reverse direction (F-008)
   - Task ID: T006
   - Depends on: none
   - Parallel group: G3
   - Risk: standard (release-integrity control)
   - Owned scope: scripts/check-suite.mjs (checkPayloadDrift only)
   - Not in scope: pack-bootstrap.mjs mapping definition
   - Actions: after payload walk, iterate buildPayloadSrcMap entries and push MISSING-IN-PAYLOAD issue for mapped dests absent from tree; extend gate-count expectations where tests assert them
   - Acceptance signal: sandbox check — create stray file in mapped dir WITHOUT packing → `node scripts/check-suite.mjs` exits nonzero listing MISSING-IN-PAYLOAD; remove → OK
   - Validation: normal run stays OK ({compared:119+,issues:[]})
   - Acceptance evidence: both runs journaled
   - Repair attempts: 0
   - Recovery note: additive issue class
   - Independent review required: yes (integrity control)

9. [pending] Sign payload-index at pack + enforce binding & limits parity in bin (F-009, F-010)
   - Task ID: T010
   - Depends on: T003 (stable R5 harness)
   - Parallel group: G3 (after G1's T003 lands; still same cycle acceptable if sequenced within dispatch)
   - Risk: high (trust boundary — independent review mandatory)
   - Owned scope: scripts/pack-bootstrap.mjs, bootstrap/package/bin/csm-skills-bootstrap.js, bootstrap/fixtures/valid.json, bootstrap/schema.json, tests/protocol/* additions, tests/package-audit.test.mjs expectations
   - Not in scope: flipping unsigned-envelope acceptance (deferred decision stands), key rotation machinery
   - Actions: pack computes Ed25519 signature over canonical index bytes using existing keyring material and embeds sig+payload_index_sha256 in envelopes it documents; bin adds limits validation (integer max_bytes 1..CAP, https origin, hex digest) mirroring trust-policy exactly; verify rejects signed envelopes whose index hash mismatches; new protocol tests cover tampered-index rejection and limits bounds; R5-style drift pin extended to limits checks
   - Acceptance signal: `node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/protocol/*.test.mjs tests/integration/*.test.mjs` → 0 fail, including new tamper/bounds cases
   - Validation: schema.json validates regenerated valid.json; negative tamper test red-if-unfixed (verify by reverting mentally — test written first)
   - Acceptance evidence: outputs journaled
   - Repair attempts: 0
   - Recovery note: fixtures regenerable via pack script; keep old fixtures in git history for rollback
   - Independent review required: yes (security)

10. [pending] Daemon crash-recovery import + stale-claim test (F-006)
    - Task ID: T008
    - Depends on: none
    - Parallel group: G4 (first)
    - Risk: low
    - Owned scope: csm-browse/scripts/session-daemon.mjs (import line), csm-browse/tests/unit/session-daemon-stale-claim.test.mjs (new; follow existing unit patterns)
    - Not in scope: claim logic redesign
    - Actions: add rename to fs/promises import; unit test plants dead-pid pidfile → spawn claims and boots
    - Acceptance signal: new unit test passes (relaunch succeeds over planted stale pidfile)
    - Validation: existing daemon-related units stay green
    - Acceptance evidence: output journaled
    - Repair attempts: 0
    - Recovery note: one-line + additive test

11. [pending] Lifecycle races: identity-checked liveness, heartbeat markers, opportunistic port reap (F-011, F-012, F-013)
    - Task ID: T011
    - Depends on: T008
    - Parallel group: G4 (second)
    - Risk: high (process lifecycle safety — independent review mandatory)
    - Owned scope: csm-browse/scripts/session-daemon.mjs (:117-129 liveness), csm-browse/lib/ports.mjs (:26-31,:86-91,:129-133), csm-browse/scripts/ensure-browser.mjs (adoption heartbeat), csm-browse/lib/sweep.mjs (marker staleness honoring heartbeat)
    - Not in scope: pool resize, sweep redesign
    - Actions: store {pid, argvBase, starttime} in pidfile/port-lock payloads; alive-check verifies identity before treating holder as live (fallback: treat mismatched as dead → break); adoption touches creating.marker every ≤30s until saveState; sweep treats recently-heartbeated markers fresh regardless of age; claimedPortSet skips dead-creator markers older than grace; update writers/readers consistently (both creation paths :673-683 and :792-801)
    - Acceptance signal: new unit tests — recycled pid w/ wrong identity breaks lock; heartbeating marker survives sweep past old window; dead-creator marker ignored at allocate — all pass
    - Validation: full browse unit suite green; e2e NOT required (excluded env)
    - Acceptance evidence: outputs journaled
    - Repair attempts: 0
    - Recovery note: behavior flagged behind same defaults; rollback = revert commit
    - Independent review required: yes (lifecycle safety)

12. [pending] Collectors droppedWrites accounting (F-015)
    - Task ID: T013
    - Depends on: none
    - Parallel group: G5
    - Risk: low
    - Owned scope: csm-browse/lib/collectors.mjs, status/recorder surfacing point it already feeds
    - Not in scope: retry queues
    - Actions: catch increments droppedWrites (module counter + persisted field alongside droppedFrames precedent); rotate failures counted too; expose in recorder.json/status output
    - Acceptance signal: unit test forcing secureAppend failure asserts droppedWrites increment and surfacing
    - Validation: existing collector units green
    - Acceptance evidence: output journaled
    - Repair attempts: 0
    - Recovery note: additive counter

13. [pending] Async fs conversion on hot path (F-016)
    - Task ID: T014
    - Depends on: none
    - Parallel group: G5
    - Risk: standard (security-ordering preservation)
    - Owned scope: csm-browse/lib/security.mjs (sync→promise lstat/stat conversions), csm-browse/lib/cleanup.mjs (:113 rmSync→rm)
    - Not in scope: caching layers, startup-hoisting refactor
    - Actions: convert lstatSync sites to awaited lstat keeping identical check order per path (ancestor walk then open); convert recursive delete to awaited rm; keep O_NOFOLLOW open flow byte-for-byte
    - Acceptance signal: browse unit suite green including security-path tests (symlink/O_NOFOLLOW cases if present)
    - Validation: rg confirms zero lstatSync/rmSync remain in touched files
    - Acceptance evidence: outputs journaled
    - Repair attempts: 0
    - Recovery note: mechanical conversion; revert-safe
    - Independent review required: yes-light (ordering preservation) — reviewer confirms sequence unchanged

14. [pending] CDP attach consolidation (F-014)
    - Task ID: T017
    - Depends on: none
    - Parallel group: G5
    - Risk: standard (public-ish verb behavior — error text unification)
    - Owned scope: csm-browse/lib/cdp.mjs (attachFirstPage export), lib/daemon-core.mjs (:82-101), lib/verbs/log.mjs (:147-158,:200-215), lib/verbs/capture.mjs (:132-145), lib/verbs/status.mjs (:13-19)
    - Not in scope: verb CLI interfaces, capture/log features
    - Actions: extract attachFirstPage(client)+shared error text into cdp.mjs; replace five copies; log/capture drop direct CRI imports; status keeps discovery-only via shared helper variant
    - Acceptance signal: browse unit suite green; `rg -c 'getTargets' csm-browse/lib` shows ≤2 sites (cdp.mjs + daemon-core fallback)
    - Validation: manual smoke of status verb against running container skipped (env) — covered by units
    - Acceptance evidence: outputs journaled
    - Repair attempts: 0
    - Recovery note: per-site mechanical replacement

15. [pending] wt-session fail-closed merge + atomic nuke + tests (F-019, L23, L25-partial)
    - Task ID: T012
    - Depends on: none
    - Parallel group: G6
    - Risk: standard (mutates dev workflow tooling)
    - Owned scope: scripts/wt-session.mjs, tests/wt-session.test.mjs
    - Not in scope: push/rebase strategy overhaul
    - Actions: remove `|| root` fallback → fail closed with guidance; move cur!=="main" guard before fetch/rebase; wrap rebase in try/catch issuing `rebase --abort` on failure; nuke deletes branch before worktree removal (tolerate already-gone with warning); require branch match refs/heads/wt/<slug> (drop basename fallback); add tests: branch-without-worktree throws AND main SHA unchanged; post-nuke rev-parse fails; conflict path aborts cleanly
    - Acceptance signal: `node --test tests/wt-session.test.mjs` → 0 fail including new cases
    - Validation: happy-path create/merge/nuke flow still exercised by existing tests
    - Acceptance evidence: outputs journaled
    - Repair attempts: 0
    - Recovery note: tool-only change; no repo state mutated by tests (temp fixtures)

16. [pending] pnpm bump to 10.34.5 (F-007)
    - Task ID: T005
    - Depends on: none
    - Parallel group: G6
    - Risk: low
    - Owned scope: package.json, csm-browse/package.json, README.md (:134,:245), pnpm-lock.yaml regeneration if importer metadata records packageManager
    - Not in scope: pnpm 11 migration
    - Actions: set packageManager pnpm@10.34.5 both manifests; update README requirement text; reinstall with frozen lockfile to confirm compatibility
    - Acceptance signal: `grep -A1 packageManager package.json csm-browse/package.json` shows 10.34.5 AND `pnpm install --frozen-lockfile --ignore-scripts` succeeds clean
    - Validation: OSV query for 10.34.5 returns no advisories
    - Acceptance evidence: command outputs journaled
    - Repair attempts: 0
    - Recovery note: single-field revert

17. [pending] Docs/config hygiene batch (L14, L17, L20, L21, L22)
    - Task ID: T016
    - Depends on: T005 (README edits land after version bump text settled)
    - Parallel group: G6 (second)
    - Risk: low
    - Owned scope: README.md, package.json engines, scripts/pack-bootstrap.mjs (:125 read-from-manifest), scripts/with-node22.mjs (:10 glob), scripts/hooks/pre-commit + scripts/install-hooks.mjs (portable shim normalization)
    - Not in scope: CI introduction (L19 stays open), other README sections
    - Actions: align root engines to ">=22 <25"; pack reads version from bootstrap/package.json; README adds oxfmt to 5 dep-list passages + fmt/fmt-check/fmt-staged/test-e2e targets; with-node22 globs v22.* highest <25; install-hooks post-processes committed shim to portable git-rev-parse form (drop machine-specific absolute lines)
    - Acceptance signal: `node scripts/check-suite.mjs` OK (README structural gates still pass) + targeted greps: engines aligned, no v22.23.2 literal, no user-home absolute path in tracked shim
    - Validation: `node --test tests/package-audit.test.mjs` green (version now sourced from manifest)
    - Acceptance evidence: outputs journaled
    - Repair attempts: 0
    - Recovery note: config/docs only

## Verification Strategy

Cheapest-first per task (unit/greps above), then batch gates in order: (1) `pnpm exec oxlint --deny-warnings`; (2) `pnpm exec oxfmt --check`; (3) `node scripts/check-suite.mjs`; (4) `node --test scripts/hooks/test/pre-commit.test.mjs`; (5) bootstrap suite (AC2); (6) `cd csm-browse && node scripts/check-skill.mjs` + unit suite; (7) `cd csm-scan && node --test --test-concurrency=1` full (AC1, ~2min serial); (8) run-tier s then l (AC3). Final: `make analyze && make test` equivalent sequence. Expensive: scan full suite + coverage-sensitive gates — run once at checkpoint, not per-task. Known environment-sensitive: scan subprocess tests need git+rg binaries; e2e excluded (Docker absent).

## Risks And Recovery

- R1: Quote-normalization weakens an assertion silently → mitigated: each edit keeps invariant intent; negative checks specified in T001/T003.
- R2: Regen script bakes in a WRONG renderer output (if current output is itself buggy) → mitigation: diff summary human-reviewed at checkpoint; renderer behavior locked by behavioral tests elsewhere.
- R3: Bin limits-parity drifts again after T010 → mitigation: canonical-equality drift test pins bin checks to trust-policy (same mechanism as R5).
- R4: Identity-in-lock format breaks older running daemons mid-upgrade → mitigation: readers tolerate legacy plain-pid payloads (treat as identity-less: fall back to current kill(pid,0) semantics).
- R5: Lifecycle changes introduce new races → mitigation: independent review mandatory (T011), serial suite green, heartbeat interval documented.
- Rollback: every task is small-scope and git-revertible; commits per checkpoint enable bisectable recovery. Forward-fix preferred over revert for review findings.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| (primary-led critique; independence caveat: critique subagent unavailable after retries this session) T004 gate could double-run partition logic | low | reuse imported function, no duplicate implementation | Design §tier gate |
| A4 signing scope creep risk | medium | constrained to index-signature + binding-on-signed; publication gate untouched | Assumptions A4 |
| T011 legacy-daemon compat | medium | R4 fallback rule added | Risks |
| T017 status.mjs discovery-only shape | low | helper variant documented in actions | T017 |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-21 | 0 | INTAKE->DISCOVER | none | brief = review-2 report; scale medium; evidence exhaustive | DISCOVER |
| 2026-08-21 | 0 | DISCOVER->RESEARCH | none | uncertainty scout folded into review pass-2 (independent verifications already resolved unknowns); residual uncertainties logged as spikes R2/A-open | RESEARCH |
| 2026-08-21 | 0 | RESEARCH->DRAFT | none | R1 registry check done (10.34.5 available, node>=18.12); R2 deferred to execution spike | DRAFT |
| 2026-08-21 | 0 | DRAFT->CRITIQUE | 17 drafted | primary-led critique (subagent unavailable; caveat recorded) | CRITIQUE |
| 2026-08-21 | 0 | CRITIQUE->REMEDIATE->VERIFY | resolutions table filled | see Critique Resolution | VERIFY |
| 2026-08-21 | 0 | VERIFY->SAVED | all pending | primary personal gate: template fields complete; acceptance signals runnable; groups disjoint; evidence matches repo at d94c840 | SAVED |

## Completion Review

(filled by csm-build when all criteria are verified)
