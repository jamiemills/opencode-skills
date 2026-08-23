format: csm-plan/1

# Fix High And Medium Review Findings CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 22 tasks (T001-T022, no gaps) — 20 standard, 1 high (T021 bootstrap trust surface; requires independent review before completion), 1 standard-with-behavioral-change flag (T014 URL-param redaction class). Counts reconciled in the REMEDIATE pass: T003 reinstated (F5-02), T005 carved from T009's validator wiring. No destructive/data tasks.

## Control

- Plan ID: fix-high-medium-findings
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-23T22:30:00+0000 final VERIFY passed — all 22 tasks implemented and reviewed; make lint, make check (956 checks), make test (1278/1278), tracked corpus harness (23/23), and focused upload/bootstrap/browse/ddd suites green
- Last model/run: primary csm-build session 2026-08-23 resumed 2026-08-23T18:02
- Next transition: COMPLETE
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Fix every HIGH and MEDIUM finding from the 2026-08-23 repository review (.agents/reviews/2026-08-23-skills-review.md @ e44ef3f): 2 high (HF-01, F6-01) + 21 medium (F1-02..F1-08 subset, F2-01, F2-02, F2-07, F2-13, F2-16+F6-05 cluster, F4-01, F4-06, F5-02, F5-06, F6-03, F6-04, F6-05, F6-07, F8-03, F8-07). Low/info findings are explicitly out of scope.

Deliverables: corrected docs (README.md, AGENTS.md, SKILL.mds, .agents index), wired gates/suites, fixed tooling defects, hardened redaction/validation, strengthened tests. Constraints: obey AGENTS.md conventions; boilerplate-managed SKILL.md sections regenerated via sync mechanism if touched (none planned); bootstrap bin changes require repack; no implementation during planning.

User decision recorded: HF-01 resolved by "Re-pin to reality" — WORD_BUDGET set to measured 329, comments/AGENTS.md made truthful and count-neutral, disabled gate reports drift. Descriptions NOT trimmed.

## Acceptance Criteria

1. HF-01: WORD_BUDGET equals recomputed description total (329); enabling `.agents/token-efficiency.json` {"enabled":true} passes the budget gate; disabled state emits a visible drift note without failing (evidence: gate output transcript + toggle-on run reverted). -> T006
2. F6-01: `make test-browse-unit` executes all 25 csm-browse unit test files; suite green before wiring; target included in `make test` (evidence: spike transcript + passing run). -> T007
3. F1-08: `make test-upload` runs upload.test.mjs inside `make test` (evidence: target output). -> T008
4. F8-03: check-suite enforces journal/control consistency over the plans corpus (violating fixture fails); resume-semantics suite wired into test-bootstrap. -> T005, T009
5. F1-02/F1-03/F1-04/F1-05: README contains one role table covering twelve skills in three roles incl. csm-ddd; one canonical artifact ledger incl. csm-make-tests and csm-review-python rows; one core-loop diagram (second copy replaced by link); documented `make test` composition matches Makefile exactly. -> T001, T002, T010
6. F1-07: every tracked .agents artifact (excluding the index itself and token-efficiency.json) has an index line; new check-suite corpus rule fails when an unindexed artifact is added. -> T004
7. F2-01: memAvailableMb returns real `free -m` output (>=0 or explicit error path); diagnostic covered by a unit assertion. -> T011
8. F2-02: csm-browse SKILL.md cookie verb row documents CSM_BROWSE_REVEAL_COOKIES=1 requirement. -> T012
9. F2-07: screenshot/screencast auto-dismiss documented in SKILL.md; Pattern 4 keyword list narrowed (no bare-"data" removals); unit test pins narrowed behavior. -> T013
10. F2-13: schema-invalid graph/report objects abort BEFORE writeArtifacts leaving no artifacts at contract paths; test proves invalid input writes nothing. -> T015
11. F2-16+F6-05: evidence records pass through redactEvidenceRecords before persistence; empty absolute-path if-block removed; hostile-locator test shows no secrets/absolute paths survive serialization. -> T016
12. F4-01: verify output carries machine-readable `signed` boolean; protocol.md documents it; unsigned vs signed flows distinguishable by consumers. -> T021
13. F4-06: query params code/key/sig/jwt/mac/sid/state redacted via a URL-scoped anchored key class; planted-secret tests (?code= OAuth redirect class) prove non-survival; existing redaction tests updated; preserve-cases pinned (exitCode/statusCode/state object keys and "Exit code: 1" prose survive). -> T014
14. F5-02: launchDaemon waits for child exit (bounded ~10s) and deletes pid/ready markers only when still owned by the terminated child; race window documented in test. -> T003
15. F5-06: per-file byte cap skips oversize files pre-read with disclosure note; synthetic oversize fixture proves bounded memory path. -> T017
16. F6-03: synthesize/clarify guarded assertions pinned by hard preconditions that fail loudly on fixture drift. -> T018
17. F6-04: immutability test captures structuredClone baseline BEFORE applyQuestionFile and deep-compares after; deliberately mutated claim fails the test. -> T019
18. F6-07: seeded-fuzz properties cover parseToml/parseYamlShallow (no unexpected throw, sane shape, fixed-point reparse-idempotence) and redactors (planted secret substring never survives case/assignment variants). -> T020
19. All gates green: `make check`, `make test`, `make lint` pass at completion; bootstrap-trust + package-audit pass after repack (T021). -> umbrella over T001-T022

Traceability: every AC above cites its producing task(s); AC19 is the completion umbrella verified through all tasks' own acceptance evidence.

## Current-State Evidence

- Findings baseline: .agents/reviews/2026-08-23-skills-review.md (98 upheld; this plan covers the 23 high/medium records as 22 tasks T001-T022 — F2-16/F6-05 and F1-03/F1-04 share tasks, F8-03 spans T005+T009, F5-02 reinstated as T003 in REMEDIATE)
- Description word counts (check-suite algorithm): bdd-tdd 21, browse 26, build 24, ddd 33, deep-research 59, grill 19, make-tests 38, plan 19, review 31, review-python 31, scan 17, upload 11 = 329 (scout dossier /tmp/opencode/scout-mechanics.md Q2)
- check-suite imports exactly nine plan-validation helpers; validateJournalControlConsistency absent (scripts/check-suite.mjs:24-34); corpus loop inline main() 1075-1137; failure accumulation via global check() 68-74
- Budget gate: constants 52-57; per-skill enabled-block 764-771; corpus enabled-block 876-881; disabled note 710-716; toggle semantics scripts/lib/token-efficiency.mjs:54-80; repo commits {"enabled": false}
- DEFERRED-citation rule template: readDeferredLedgerIds 637-646, checkDeferredCitations 652-694, wiring 1055-1121
- Makefile: test-browse runs ONLY check-skill.mjs (47-48); `test` = hooks+bootstrap+browse+ddd+scan (53); unwired: browse units, upload tests, resume-semantics
- lefthook jobs 1-7 (unstaged-guard, oxfmt, gate-baseline, check-suite, mjs-syntax, oxlint, csm-browse-check) — none run unit suites
- gen-readme-matrix owns ONLY <!-- csm-matrix:start/end --> region (README.md:159-178); ledgers/diagrams hand-maintained
- pack-bootstrap: bin indexed as fixedBin (sha256 recomputed), payload staged/pruned, LICENSE copied; bin NOT in payload/; bootstrap-trust pins behavior samples + KEYRING/policy/denylist source equality only
- Verify-output contract: emitted at bin :257/:274/:266; protocol.md:161 documents shape; report-schema/engine/trust-policy UNCHANGED by additive field; bootstrap-trust uses property-access assertions (additive-safe)
- Boilerplate manages only Tmux/Subagent-Resilience sections of orchestration skills; csm-browse/csm-upload SKILL.md fully hand-maintained
- csm-browse unit suite: self-contained/offline-safe except ws import (needs pnpm install); NO Docker/chromium required at unit layer
- upload.test.mjs: git/gh PATH shims, local bare repo only, offline-passable
- resume-semantics.test.mjs: pure text parsing, <1s estimated, hard-requires >=20-plan corpus
- csm-ddd: validateGraph/validateReport exported (lib/ddd/validate.mjs:119-125) operating on in-memory objects; writeArtifacts called ddd.mjs:80-84; holders analysis.graphObject/analysis.parsedReport
- extract.mjs: DEFAULT_LIMITS:11 {maxFiles:2000,maxBytes:2000000}; budget checked after push (31-34); readFile at 154 unguarded
- parse.mjs exports parseToml:14, parseYamlShallow:511; Mulberry32 harness self-contained at csm-browse/tests/unit/fuzz.test.mjs:23-31
- SENSITIVE_KEY regex security.mjs:338; redactUrl 340-355; redactPairs 357-369 (unexported); five existing redaction tests named (security.test.mjs:161,189,309; residuals.test.mjs:21,30,36)
- launchDaemon teardown: csm-browse/scripts/ensure-browser.mjs:1060-1078 SIGTERMs the child then deletes pid/ready markers immediately — no child-exit wait, no pid-file ownership re-read (F5-02 surface; session-daemon-stale-claim.test.mjs is the nearest pin precedent)
- tests/bootstrap-trust.test.mjs:318 pins validateEnvelope RETURN SHAPE via assert.deepEqual (bin-side verify objects are property-access only) — any trust-policy return-shape change explodes the suite (T021 constraint)
- README.md today: two `flowchart LR` core-loop blocks (:69, :127) and 11 csm-make-tests substring hits (role table, both diagram copies, generator matrix) — T002 signals target structural post-states, not substrings
- [executed by critique] validateJournalControlConsistency over live 31 *-csm.md corpus: ZERO violations; `node --test tests/resume-semantics.test.mjs`: 5/5 pass in ~0.5s — T005/T009 spikes are confirmations, expected green

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --------- | ---- | --------------------- | ------ |
| D1 | HF-01 resolved by re-pin (WORD_BUDGET=329 + truthful docs + disabled-drift note); descriptions untouched | user-dictated | User choice 2026-08-23; prefix-cache stability per AGENTS.md stable-prefix doctrine | decided |
| D2 | Hook stays static-only: csm-browse-check job keeps check-skill.mjs; unit suite wired into make test + README instead of pre-commit | decision | Commit latency; hook parity preserved; suite gated via make test (review sketch's hook mirror consciously not adopted) | decided |
| D3 | resume-semantics.test.mjs wired into test-bootstrap (accepting >=20-plan corpus coupling) IN ADDITION to check-suite validator wiring | decision | Belt-and-braces; test is <1s, pure parsing; corpus bound acceptable for self-hosted repo | decided |
| D4 | F4-06 fixed by a NEW anchored URL-param key class (code/key/sig(nature)/mac/jwt/sid/state, exact-token match) consumed ONLY by redactUrl's searchParams loop (optionally redactPairs pair-key matching); SENSITIVE_KEY object/prose class unchanged; over-redaction accepted but confined to URL query params | decision | Capture-tool posture: fail-closed beats leakage; splitting the classes preserves exitCode/statusCode/state telemetry diagnostics (critique Finding 2); entropy heuristic rejected as speculative complexity (review sketch option B) | decided |
| D5 | F5-06 maxFileBytes default 1000000 (1 MiB), CLI-overridable like siblings | decision | <= existing maxBytes total; large blobs skipped with disclosure; value adjustable at build | decided |
| D6 | T013 narrows Pattern 4 to privacy/consent/cookie keywords (drops bare "data"), keeps clicking behavior, adds documentation | decision | Smallest change satisfying finding; removing feature would alter relied-on capture behavior | decided |
| A1 | csm-browse unit suite passes headless after `pnpm install` | assumption | Scout Q9: all 25 files self-contained/local-only; verified by spike inside T007 before wiring | open->T007 |
| A2 | pack-bootstrap reproducibility holds on build machine | assumption | Scout Q6 flow verified statically; exercised by T021 acceptance | open->T021 |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |
| R1 | Are all 15 mechanics questions resolvable read-only? | scout subagent (read/glob/grep only) | No repo writes; protected-state: only pre-existing untracked review file present before/after | All 15 resolved with file:line evidence; 0 unresolved | No further R&D needed; no external-spec research warranted (repository-internal questions only; deep-research not dispatched by rule) |
| R2 | Exact description word totals for re-pin | whitespace-run counting matching split(/\\s+/).filter(Boolean) semantics | read-only | 329 total (per-skill breakdown in Current-State Evidence) | WORD_BUDGET=329; acceptance re-computes independently |

## Discovered Requirements

- Bootstrap bin edits MUST be followed by `node scripts/pack-bootstrap.mjs` in the same commit (fixedBin hash recomputation; checkPayloadDrift does not cover the bin — drift surfaces via bootstrap-trust/package-audit). [scout Q6]
- Three-copy trust modules (bin, trust-policy.mjs, engine.mjs) must receive contract-relevant changes in lockstep; canonical-equality pins cover KEYRING/policy/denylist source only — behavioral matrix covers the rest. [review F3-15 + scout Q7]
- csm-browse unit tests require `pnpm install` inside csm-browse (ws devDep) before first run; Make target should fail with actionable message if node_modules absent. [scout Q9]
- Boilerplate-managed SKILL.md sections (Tmux/Subagent Resilience of 8 orchestration skills) regenerate via sync-skill-boilerplate.mjs; no planned task touches them. [scout Q8]
- check-suite failure convention: zero-findings checks emit one passing line; failures accumulate via global check(ok, detail) and print at exit — new corpus checks follow this shape. [scout Q1]
- README generator owns only the csm-matrix region; INTERFACES edits need `gen-readme-matrix --write`; ledger/diagram edits do not. [scout Q5]
- node --test directory-form with --test-concurrency=1 is the house style for deterministic suites (test-ddd/test-scan precedent). [scout Q3]
- Sandbox-toggle/mutation proofs run in a /tmp copy made with `cp -a` INCLUDING .git and node_modules (toggle flipped only in the copy; copy method recorded in the journal transcript): copying without .git pulls untracked drafts into validation, without node_modules silently downgrades the oxlint gate. [critique Finding 10]
- Wiring resume-semantics into test-bootstrap couples MORE than the validator into CI: the suite deep-equals the golden fixture against plan-validation outputs and reads csm-plan/csm-build SKILL.mds — future edits to those contract sections break test-bootstrap (accepted per D3; future editors forewarned). [critique Finding 11]
- Live corpus pre-verified (critic-executed): zero journal/control inconsistencies across 31 *-csm.md plans; resume-semantics suite 5/5 in ~0.5s — the T005/T009 spikes are expected-green confirmations; any violation surfacing at build time is a STOP-blocker, never a silent history edit. [critique Finding 11]

## Design

Fixes map 1:1 onto review remediation sketches where those were validated by challenge verdicts; deviations recorded in Decisions (D2, D4-D6). Surfaces:

- Truth-layer (docs): README role table gains third row (Tooling: scan/browse/ddd CLI trio reclassified consistently with the "eight orchestration" list becoming "tmux-bootstrapping skills"); artifact ledger collapses to ONE canonical table (+csm-make-tests, +csm-review-python rows) referenced from the overview section; second Mermaid copy replaced by a link; `make test` prose regenerated from actual Makefile after wiring lands; AGENTS.md budget paragraph rewritten count-neutral ("N skills", measured total, suspended-state explanation).
- Enforcement-layer (gates): budget corpus block grows an else-branch emitting a NOTE (never failure) with current-vs-budget delta when disabled, while the enabled branch emits the measured total; .agents index rule copied from DEFERRED three-part template (reader -> scanner with grandfathering for the index/config themselves -> wiring); validateJournalControlConsistency imported and invoked per-plan in the corpus loop (COMPLETE plans exempt inside the function already; wiring = T005), with the resume-semantics suite wired into test-bootstrap separately (T009).
- Tooling defect fixes: execFileAsync replaced by promisified execFile import; launchDaemon post-SIGTERM loop polls to child exit (cap 10s) and re-reads pid file content before marker deletion (delete only if unchanged; T003); extract gains maxFileBytes guard at push-time with disclosure fields.
- Trust/privacy hardening: verify output gains `signed:true|false` (true iff cryptographic verification ran) documented in protocol.md TRUST table; redactUrl gains a URL-param-scoped anchored credential-key class (SENSITIVE_KEY object/prose class untouched); ddd evidence records funnel through redactEvidenceRecords pre-persistence; pre-write validateGraph/validateReport gate inserted between analyzeRepository and writeArtifacts.
- Test repairs/strengthening: precondition pins (hard assert.ok guards), structuredClone immutability baseline, seeded-fuzz ports (Mulberry32 verbatim) for parseToml/parseYamlShallow + redaction property tests, hostile-locator serialization test, oversize-fixture cap test, narrowed-dismissCookie pin, planted ?code= secret test.

## Execution Graph

Serial spine (shared-file ordering): T007 (browse wiring; spike green-first) -> T008 (upload wiring) -> T009 (resume-semantics suite wiring into test-bootstrap + README mention; Makefile single-writer after T007/T008) -> T010 (make-test truth-up README+Makefile; last because it freezes final composition).
Gate chain folded into spine order: T006 -> T004 -> T005 in check-suite edits (same file, disjoint regions but serialized to avoid staging conflicts); T005 (journal/control validator wiring) precedes T009 (its suite consumes the validator): actual order T006 -> T004 -> T005 -> T009 -> T010. T009 additionally waits on T002 (README single-writer).
Independent parallel leaves: GA-docs T001 -> T002 (README chain, before T009/T010); GC-browse T014 -> T020 (both add to csm-browse/tests/unit/security.test.mjs — single-writer serialization), alongside T011 -> T003 (both touch csm-browse/scripts/ensure-browser.mjs — single-writer serialization); T012 -> T013 (SKILL.md chain); GD-ddd T015 || (T018 -> T019) — T018 and T019 both own csm-ddd/test/clarify.test.mjs, so they are SERIALIZED (precondition hardening lands before the immutability rewrite), never parallel; (T016 -> T017) — extract.mjs chain, and T017 also waits on T015 (scripts/ddd.mjs single-writer); T021 standalone; T022 standalone.
Critical path: T007 -> T008 -> T009 -> T010 -> final verification (AC19).
Safe parallel groups: {T001}, {T014->T020, T011->T003, T015, T018->T019, T021, T022} may interleave with the spine; {T012->T013} and {T016->T017} are internal two-task chains; the gate chain T006->T004->T005 feeds the spine ahead of T009.

## Numbered Plan

1. [completed] Wire csm-browse unit suite into gates
   - Task ID: T007
   - Depends on: none
   - Parallel group: spine start
   - Risk: standard (turns never-executed suite into a gate — spike first)
   - Owned scope: Makefile (new test-browse-unit target), README testing section lines, package.json script untouched
   - Not in scope: lefthook jobs (D2), any test-body edits beyond genuine failures found by spike
   - Spike candidate: run `cd csm-browse && pnpm install --frozen-lockfile && node --test --test-concurrency=1 tests/unit/` once; if red, triage each failure (fix genuinely broken test/env assumption in this task; environment-impossible tests get explicit skip with reason). Sandbox not needed (suite is offline-safe per scout Q9); TMPDIR default fine.
   - Actions: add `test-browse-unit:` target (`cd csm-browse && node --test --test-concurrency=1 tests/unit/`); append to `test` prerequisites; add `test-browse-unit` to .PHONY; README testing bullet; fail-fast guard printing "run: pnpm install" when csm-browse/node_modules/ws is absent.
   - Acceptance signal: `make test-browse-unit` exits 0 AND `--test-reporter=tap` output lists exactly 25 top-level test-file `# Subtest` entries (the node --test summary counts CASES, not files; enumerate the 25 filenames in the journal if ambiguity remains).
   - Validation: `make test` reaches the new target; `git grep -n "test-browse-unit" Makefile README.md` shows both wires.
   - Acceptance evidence: spike transcript + passing target output recorded in journal.
   - Repair attempts: 0
   - Recovery note: partial work detectable by `git diff Makefile`; spike results recorded before any wiring edit.

2. [completed] Wire csm-upload suite
   - Task ID: T008
   - Depends on: T007 (Makefile serialization)
   - Parallel group: spine
   - Risk: low
   - Owned scope: Makefile (test-upload target), .PHONY, `test` prerequisite line
   - Not in scope: upload source/scripts
   - Spike candidate: none (suite verified offline-capable by scout Q10; run once during task)
   - Actions: `test-upload: node --test csm-upload/tests/upload.test.mjs`; add to `test` + .PHONY.
   - Acceptance signal: `make test-upload` exits 0.
   - Validation: `make test` includes it.
   - Acceptance evidence: passing run output.
   - Repair attempts: 0
   - Recovery note: single-target addition; trivially revertible.

3. [completed] Re-pin token budget to reality (HF-01)
   - Task ID: T006
   - Depends on: none
   - Parallel group: leaf (before T004 in check-suite queue)
   - Risk: standard
   - Owned scope: scripts/check-suite.mjs (constants 52-57, corpus block 876-881 else-branch, note 710-716), AGENTS.md budget paragraphs, scripts/lib/token-efficiency.mjs (only if warning text needs alignment)
   - Not in scope: any SKILL.md frontmatter descriptions; per-skill volatile block semantics
   - Spike candidate: temporary toggle-on run in sandbox copy to prove budget passes — `cp -a` the full tree INCLUDING .git and node_modules to /tmp sandbox, flip .agents/token-efficiency.json only there, run node scripts/check-suite.mjs inside the copy; record the copy method in the journal transcript; never commit toggled state.
   - Actions: WORD_BUDGET = 329; comment rewritten ("the twelve descriptions total 329 words today; recompute on any frontmatter edit"); AGENTS.md: replace "exactly 220 words today"/"a 9th skill" with count-neutral measured-total phrasing + pointer to liability doc; corpus block gains else-branch pushing a NOTE line `token-efficiency disabled: description budget 329/329 (+0 drift)` computed live; the ENABLED branch (876-881) additionally emits the measured description-word total beside the budget check so WORD_BUDGET can never silently rot again; keep 710-716 disabled note consistent.
   - Acceptance signal: sandboxed toggle-on run prints budget check PASSING including the measured-total emission; restored (disabled) tree run prints the drift NOTE without failing; `make check` green.
   - Validation: `grep -n "WORD_BUDGET" scripts/check-suite.mjs` shows 329 + truthful comment; AGENTS.md contains no "220 words today"/"9th skill" strings.
   - Acceptance evidence: both run transcripts.
   - Repair attempts: 0
   - Recovery note: three-region diff confined to two files + AGENTS.md.

4. [completed] Backfill .agents index + add unindexed-artifact gate rule (F1-07)
   - Task ID: T004
   - Depends on: T006 (check-suite serialization)
   - Parallel group: gate chain
   - Risk: low
   - Owned scope: .agents/README.md (index lines), scripts/check-suite.mjs (new rule functions + wiring), .agents/plans/** (no edits — only indexing)
   - Not in scope: artifact body edits; historical status corrections
   - Spike candidate: none
    - Actions: backfill one line per tracked artifact per journal-lessons F7/J7 format (exclude exactly .agents/README.md and .agents/token-efficiency.json by FULL path); implement readAgentsIndex/checkAgentsIndexed (DEFERRED-template: reader, scanner returning issues/warnings, wiring in corpus stage; scanner iterates `git ls-files .agents` ONLY — untracked drafts never brick the gate; exclude the two full paths above; grandfather nothing initially — corpus is being brought to compliance in the same task; same-commit indexing is the gate's teeth: adding an artifact without its index line fails the next `make check`).
    - Acceptance signal: `node scripts/check-suite.mjs` passes WITH the new rule active on the fully-indexed corpus; temporarily renaming an index line in a scratch checkout makes it fail (sandbox proof).
    - Validation: count parity `git ls-files .agents | grep -v -e '^\.agents/README\.md$' -e '^\.agents/token-efficiency\.json$' | wc -l` equals indexed line count.
   - Acceptance evidence: positive+negative rule transcripts.
   - Repair attempts: 0
   - Recovery note: rule ships after corpus compliance in same commit; bisectable.

5. [completed] Enforce journal/control consistency in check-suite gate (F8-03, gate half)
   - Task ID: T005
   - Depends on: T004 (check-suite serialization)
   - Parallel group: gate chain
   - Risk: standard (new enforcement over live corpus)
   - Owned scope: scripts/check-suite.mjs ONLY (import + per-plan invocation in corpus loop)
   - Not in scope: Makefile/README (T009 owns those); plan-validation.mjs logic changes; corpus content edits beyond what enforcement legitimately flags (flagged violations become follow-ups surfaced to user, not silent fixes)
   - Spike candidate: run `node --test tests/resume-semantics.test.mjs` first; if live corpus violates consistency, STOP and surface violation list to user as blocker rather than editing history plans (critic executed this probe: 5/5 pass, zero corpus violations today — re-confirm at build time).
   - Actions: import validateJournalControlConsistency; invoke per-plan after validatePlanJournal using one-check-per-message pattern (COMPLETE plans exempt inside the function itself — verified plan-validation.mjs:442-470).
   - Acceptance signal: `make check` green with the wiring; injected PAUSED-inconsistency fixture in /tmp sandbox copy fails check-suite.
   - Validation: `grep -n validateJournalControlConsistency scripts/check-suite.mjs` resolves import + call site.
   - Acceptance evidence: transcripts of green gate + negative-fixture failure.
   - Repair attempts: 0
   - Recovery note: corpus violations pre-checked by spike; wiring reversible one-import.

6. [completed] Wire resume-semantics suite into test-bootstrap (F8-03, suite half)
   - Task ID: T009
   - Depends on: T005 (validator landed), T008 (Makefile serialization), T002 (README single-writer: T009's universal-suite wording and T002's ledger/diagram share README.md)
   - Parallel group: spine
   - Risk: standard (couples golden-fixture deepEquals + csm-plan/csm-build SKILL.md reads into CI — future doc edits now gated; recorded under Discovered Requirements)
   - Owned scope: Makefile test-bootstrap line (+resume-semantics), README bootstrap-suite mention
   - Not in scope: check-suite.mjs (T005 owns); plan-validation.mjs; corpus content
   - Spike candidate: none (T005's spike covers corpus health; suite verified 5/5 green ~0.5s by critic)
   - Actions: add tests/resume-semantics.test.mjs to test-bootstrap glob list; update README universal-suite wording if needed.
   - Acceptance signal: `make test-bootstrap` exits 0 including resume-semantics.
   - Validation: `grep -n resume-semantics Makefile` resolves.
   - Acceptance evidence: green suite transcript.
   - Repair attempts: 0
   - Recovery note: one-glob-line addition; trivially revertible.

7. [completed] Freeze true make-test composition into docs (F1-05)
   - Task ID: T010
   - Depends on: T007, T008, T009, T002 (final composition known AND README chain serialized — all four touch README/Makefile surfaces T010 edits)
   - Parallel group: spine end
   - Risk: low
   - Owned scope: Makefile (test target comment relabel; fold suite-tooling battery decision below), README.md dev/testing bullets
   - Not in scope: adding suite-tooling battery to make test IF wall-time unacceptable — record either way in Control
   - Spike candidate: time `make test` end-to-end once; if >5min, relabel comment "primary suites" and document suite-tooling as separate `make test-tooling` target added in this task.
   - Actions: align README:402 composition list with final Makefile; add missing target bullets (test-ddd, new targets); relabel or extend `test`; ensure README target inventory complete.
   - Acceptance signal: scripted comparison `grep "^test" Makefile` names appear verbatim in README testing section; `make help` targets all documented.
   - Validation: `make check` README-integrity checks green.
   - Acceptance evidence: diff + check output.
   - Repair attempts: 0
   - Recovery note: docs-only; revert trivially.

8. [completed] Fix README role taxonomy (F1-02)
   - Task ID: T001
   - Depends on: none
   - Parallel group: README chain start
   - Risk: low
   - Owned scope: README.md Install role-table section + orchestration-conventions sentence
   - Not in scope: ledger/diagram regions (T002), generator region
   - Spike candidate: none
   - Actions: restore three-role table (Orchestration 8 incl. grill; Tooling incl. csm-ddd alongside scan/browse; Integration/supporting row as fits review sketch) so twelve skills appear exactly once with correct roles; align line 319 wording with table membership.
   - Acceptance signal: extraction check — every one of the twelve skill names appears in the table exactly once; "three roles" heading matches row count (assert via rg + manual read recorded).
   - Validation: `make check` green (TOC/integrity unaffected).
   - Acceptance evidence: rendered table excerpt in journal.
   - Repair attempts: 0
   - Recovery note: single-section diff.

9. [completed] Deduplicate README ledger and diagram (F1-03, F1-04)
   - Task ID: T002
   - Depends on: T001 (README serialization)
   - Parallel group: README chain
   - Risk: low
   - Owned scope: README.md ledger paragraphs (91-105, 146-157) + Mermaid copies (68-85, 126-142)
   - Not in scope: csm-matrix generator region; edge-semantics blurbs beyond dedup
   - Spike candidate: none
   - Actions: keep Install-section ledger as THE canonical table; add csm-make-tests + csm-review-python rows; replace glance-section duplicate with one-line pointer; keep first diagram only, replace second copy with link to first (same caption intent); verify no dangling references.
   - Acceptance signal: structural, fails on the untouched tree — canonical ledger table parses to EXACTLY 12 skill rows including csm-make-tests and csm-review-python (row-parse the markdown table, count rows, assert membership); glance section holds ONLY a pointer (zero csm- table rows in that region); `grep -c '^flowchart LR' README.md` == 1 (two exist today at :69 and :127); `make check` TOC green.
   - Validation: manual read of both former locations recorded.
   - Acceptance evidence: journal excerpt + row-parse transcript.
   - Repair attempts: 0
   - Recovery note: contiguous deletions; revertible.

10. [completed] Fix memAvailableMb undefined helper (F2-01)
   - Task ID: T011
   - Depends on: none
   - Parallel group: GC-browse
   - Risk: low
   - Owned scope: csm-browse/scripts/ensure-browser.mjs (import + function signature + callers at :1048/:1083), one unit test file (new or existing diagnostics test)
   - Not in scope: docker.mjs execLayer refactor
   - Spike candidate: none
   - Actions: import execFile from node:child_process + promisify (house pattern per git.mjs); replace execFileAsync usage; EXPORT memAvailableMb with an injectable executor parameter defaulting to the promisified execFile (the function is module-private today — the unit assertion requires the export + seam); return type stays numeric (>= -1 sentinel preserved for genuine probe failure) so callers at :1048/:1083 (OOM diagnostic messages) absorb no type change; error path logs the failure reason instead of silently swallowing; unit test injects stub executors covering success (`free -m` stdout), non-numeric output, and executor-rejection paths.
   - Acceptance signal: `make test-browse-unit` (post-T007 target) green including the new three-path assertion.
   - Validation: `grep -n execFileAsync csm-browse/scripts/ensure-browser.mjs` returns nothing.
   - Acceptance evidence: test output.
   - Repair attempts: 0
   - Recovery note: single-function fix with one added export.

11. [completed] Close launchDaemon retry race: wait for child exit before marker deletion (F5-02)
   - Task ID: T003
   - Depends on: T011 (ensure-browser.mjs single-writer serialization)
   - Parallel group: GC-browse chain
   - Risk: standard (lifecycle race fix; failure mode is transient dual daemons)
   - Owned scope: csm-browse/scripts/ensure-browser.mjs launchDaemon retry block (:1060-1078), one unit test pin (new lifecycle-race test or existing session-daemon test file)
   - Not in scope: session-daemon.mjs cleanup internals (its budgets are correct); pid-file protocol redesign
   - Spike candidate: none
   - Actions: replace the fixed 20x100ms post-SIGTERM poll with poll-until-exit bounded at ~10s (exceeds child worst-case cleanup ~8s: 3s recorder finalize + 2s CDP close + 3s force-exit backstop); before deleting daemon.pid/daemon.ready markers, RE-READ the pid file and delete only if content is still the terminated child's pid (mirrors the daemon-side ownPidFile guard — closes the window where attempt #2 spawns while child #1 still owns the markers); on content-change skip deletion and let attempt #2's O_EXCL claim enforce single-instance.
   - Acceptance signal: `make test-browse-unit` green including the new race-pin test (simulated slow-exit child: markers survive until exit; content-changed pid file is never deleted).
   - Validation: `grep -n "ownPidFile\|still owns" csm-browse/scripts/ensure-browser.mjs` shows the ownership re-read; manual reasoning recorded that attempt #2 cannot spawn while markers are foreign-owned.
   - Acceptance evidence: test output + trace of retry sequence.
   - Repair attempts: 0
   - Recovery note: bounded-wait + guard are local to one block; revert restores old behavior.

12. [completed] URL-param-scoped credential redaction class (F4-06)
    - Task ID: T014
    - Depends on: none
    - Parallel group: GC-browse
    - Risk: standard — behavior change to a privacy control; over-redaction of URL params accepted per D4, but prose/object-key redaction MUST NOT change
    - Owned scope: csm-browse/lib/security.mjs (NEW URL-param class + redactUrl searchParams loop), csm-browse/tests/unit/security.test.mjs + residuals.test.mjs updates/additions
    - Not in scope: SENSITIVE_KEY itself (MUST remain unchanged — it feeds three surfaces: redactUrl keys, redactPairs prose scanning, and redactTelemetry's recursive object-key walk; widening it would nuke exitCode/statusCode/state/signal diagnostics); redactPairs structural redesign; entropy heuristics
    - Spike candidate: none
    - Actions: add URL_CREDENTIAL_PARAM = /^(code|key|sig|signature|mac|jwt|sid|state)$/i — ANCHORED, exact-token (query keys are exact tokens; anchoring is what makes it safe where SENSITIVE_KEY's unanchored substring semantics are not); consume it ONLY in redactUrl's searchParams loop (and the fragment path's pair-key match if pair keys are exact tokens there — verify then decide); leave SENSITIVE_KEY and redactTelemetry untouched; document the class split in a code comment; add planted-secret cases (?code= OAuth-redirect, ?key=, ?jwt=, ?sig=, ?sid=, ?state=) AND explicit preserve-cases asserting exitCode/statusCode/state object keys and "Exit code: 1" prose survive while ?code= dies.
    - Acceptance signal: `make test-browse-unit` green with new redaction cases AND preserve-cases both passing (preserve-cases are the regression guard against future accidental SENSITIVE_KEY widening).
    - Validation: adversarial spot-check — redactTelemetry over sample event containing ?code= returns [REDACTED] in the URL while sibling fields keep their values.
    - Acceptance evidence: test diff + output.
    - Repair attempts: 0
    - Recovery note: rollback = revert the new class + its tests together (single-file + test additions).

13. [completed] Document cookie reveal gate (F2-02)
    - Task ID: T012
    - Depends on: none
    - Parallel group: GC-SKILL chain start
    - Risk: low
    - Owned scope: csm-browse/SKILL.md cookie verb row
    - Not in scope: log.mjs behavior
    - Spike candidate: none
    - Actions: rewrite verb-table row: "--values prints full values only with CSM_BROWSE_REVEAL_COOKIES=1 set (warns first; refuses otherwise)".
    - Acceptance signal: `grep -n "CSM_BROWSE_REVEAL_COOKIES" csm-browse/SKILL.md` resolves; `cd csm-browse && node scripts/check-skill.mjs` green.
    - Validation: manual read.
    - Acceptance evidence: excerpt.
    - Repair attempts: 0
    - Recovery note: one-row diff.

14. [completed] Narrow + document capture auto-dismiss (F2-07)
    - Task ID: T013
    - Depends on: T012 (SKILL.md serialization)
    - Parallel group: GC-SKILL chain
    - Risk: standard (capture-behavior change)
    - Owned scope: csm-browse/lib/cookies.mjs Pattern 4 keywords, SKILL.md verb-table note, one unit test (cookies.test.mjs)
    - Not in scope: Pattern 3 click behavior (kept per D6)
    - Spike candidate: none
    - Actions: Pattern 4 removal-keywords reduced to privacy/consent/cookie (+word-boundary match replacing bare-substring "data"); SKILL.md screenshot/screencast rows gain "(auto-dismisses consent walls first)" note; unit test pins: element with text "database docs" survives, consent banner removed.
    - Acceptance signal: `cd csm-browse && node --test tests/unit/cookies.test.mjs` green with new pins.
    - Validation: grep SKILL.md note present.
    - Acceptance evidence: test output.
    - Repair attempts: 0
    - Recovery note: contained diff.

15. [completed] Pre-write schema validation in csm-ddd (F2-13)
    - Task ID: T015
    - Depends on: none
    - Parallel group: GD-ddd
    - Risk: standard (contract-path change)
    - Owned scope: csm-ddd/scripts/ddd.mjs (insertion between :78 and :84), csm-ddd/lib/ddd/pipeline.mjs (only if helper placement better), one test (cli.test.mjs or new)
    - Not in scope: schema files; validate.mjs logic
    - Spike candidate: none
    - Actions: call validateGraph(analysis.graphObject) + validateReport(analysis.parsedReport) pre-write; on !ok print errors + exit non-zero WITHOUT writing; retain post-write disk checks as assertions; test drives invalid object through pipeline entry proving zero bytes at outGraph/outReport paths.
    - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1` green incl. new negative test.
    - Validation: SKILL.md RENDER wording now true (manual read).
    - Acceptance evidence: test output.
    - Repair attempts: 0
    - Recovery note: insertion-point diff.

16. [completed] Wire evidence-record redaction (F2-16 + F6-05)
    - Task ID: T016
    - Depends on: none
    - Parallel group: GD-ddd (before T017; extract.mjs chain)
    - Risk: standard
    - Owned scope: csm-ddd/lib/ddd/extract.mjs (call-site + empty-if removal), NEW test file csm-ddd/test/redact-evidence.test.mjs (pinned name — avoids cli.test.mjs collision with T015)
    - Not in scope: redactText vocabulary widening (that is low-scoped F4-09 territory, excluded)
    - Spike candidate: none
    - Actions: route assembled evidence records through redactEvidenceRecords at the EXACT insertion site: extract.mjs's record-assembly loop (where locator/matchedKey fields are set, immediately before records are returned toward artifact assembly — NOT in synthesize or the writers); delete empty containsAbsoluteRootPath if-block (:158-160) replacing with comment pointing at the funnel; hostile-locator test asserts locator/matchedKey sanitization for absolute paths + planted tokens, PLUS a canary case documenting the intentional scope boundary (redactEvidenceRecords maps locator/matchedKey only — other record fields are unredacted by design; test comment records this as F4-09-adjacent residual).
    - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1` green incl. hostile test; `grep -n redactEvidenceRecords csm-ddd/lib -r` shows production caller.
    - Validation: SKILL.md EXTRACT redaction mandate now mechanically true.
    - Acceptance evidence: test output.
    - Repair attempts: 0
    - Recovery note: funnel insertion reversible.

17. [completed] Per-file size cap in extractor (F5-06)
    - Task ID: T017
    - Depends on: T016 (extract.mjs chain), T015 (ddd.mjs single-writer: T015's pre-write insertion and T017's --max-file-bytes flag plumbing share scripts/ddd.mjs)
    - Parallel group: GD-ddd chain
    - Risk: standard
    - Owned scope: csm-ddd/lib/ddd/extract.mjs (DEFAULT_LIMITS + walkFiles guard + disclosure fields), ddd.mjs flag plumbing (--max-file-bytes), one fixture test
    - Not in scope: streaming reader introduction
    - Spike candidate: none
    - Actions: add maxFileBytes: 1000000 to DEFAULT_LIMITS; walkFiles skips stat-oversize files pre-push incrementing a skippedOversize counter disclosed beside truncation flags (:123-124, :284-285); test generates synthetic >cap file in temp fixture asserting exclusion + disclosure.
    - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1` green incl. oversize test.
    - Validation: `--max-file-bytes` appears in usage text.
    - Acceptance evidence: test output.
    - Repair attempts: 0
    - Recovery note: additive limit.

18. [completed] Pin guarded test preconditions (F6-03)
    - Task ID: T018
    - Depends on: none
    - Parallel group: GD-ddd
    - Risk: low
    - Owned scope: csm-ddd/test/synthesize.test.mjs, clarify.test.mjs (guard blocks only)
    - Not in scope: fixture regeneration
    - Spike candidate: none
    - Actions: convert `if (scanImport)` / `if (ambiguousTerms.length > 0)` guards into hard `assert.ok(precondition, "...fixture drifted...")` preceding the target assertions.
    - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1 test/synthesize.test.mjs test/clarify.test.mjs` green; mutation probe — temporarily breaking extractor classification in sandbox copy flips these tests red (proof of sensitivity).
    - Validation: visual diff.
    - Acceptance evidence: green output + probe transcript.
    - Repair attempts: 0
    - Recovery note: test-only.

19. [completed] Rewrite immutability test honestly (F6-04)
   - Task ID: T019
   - Depends on: T018 (both own csm-ddd/test/clarify.test.mjs — single-writer serialization; precondition hardening lands first)
    - Parallel group: GD-ddd
    - Risk: low
    - Owned scope: csm-ddd/test/clarify.test.mjs immutability block
    - Not in scope: clarify implementation
    - Spike candidate: none
    - Actions: structuredClone(synthesis.claims) BEFORE applyQuestionFile; after, deep-equal static claims against clone; negative proof — sandbox mutation of one static claim field makes test fail; drop tautological doesNotThrow.
    - Acceptance signal: `cd csm-ddd && node --test test/clarify.test.mjs` green; mutation probe transcript shows red on induced change.
    - Validation: assert count increased.
    - Acceptance evidence: outputs.
    - Repair attempts: 0
    - Recovery note: test-only.

20. [completed] Port seeded-fuzz + redaction property tests (F6-07)
   - Task ID: T020
   - Depends on: T014 (both add to csm-browse/tests/unit/security.test.mjs — single-writer serialization; property block builds on T014's URL_CREDENTIAL_PARAM cases)
   - Parallel group: GD-ddd leaf
   - Risk: standard (new test infrastructure)
   - Owned scope: NEW csm-scan/test/fuzz-parse.test.mjs; additions to csm-browse/tests/unit/security.test.mjs (property block); NEW csm-ddd/test/redact-property.test.mjs
   - Not in scope: mutation-testing tooling; parser refactors
   - Spike candidate: confirm Mulberry32 helpers copy cleanly (verbatim) — no isolation risk (pure functions)
   - Actions: csm-scan: seeded 200-iteration loop over mutated TOML/YAML seeds driving parseToml/parseYamlShallow asserting typed-error-or-shape invariants + idempotence in FIXED-POINT form reparse(serialize(reparse(x))) == reparse(x) (a shallow YAML parser cannot round-trip to the original — fixed-point avoids builders weakening the harness when equality flakes); csm-browse: property block planting N secret shapes (assignments, case variants, url pairs) asserting no substring survival through redactTelemetry/redactUrl; csm-ddd: same property over redactText incl. webhook-path-token class (documents F4-09 boundary without fixing it).
    - Acceptance signal: three files green under their repo runners; each runs >=200 seeded iterations deterministically (fixed seed logged).
    - Validation: deliberate corpus mutation in sandbox flips at least one property red.
    - Acceptance evidence: outputs + seed values.
    - Repair attempts: 0
    - Recovery note: purely additive tests.

21. [completed] Signed marker in bootstrap verify output (F4-01)
    - Task ID: T021
    - Depends on: none
    - Parallel group: leaf
    - Risk: HIGH — trust-surface change; independent review required before task completion; three-copy lockstep + repack discipline
    - Owned scope: bootstrap/package/bin/csm-skills-bootstrap.js (:257 emission + signature-presence computation), bootstrap/protocol.md (:161 region + TRUST guarantee row), tests/bootstrap-trust.test.mjs (signed-field assertions both flows), regenerated bootstrap/payload-index.json via pack-bootstrap
    - Not in scope: making signatures mandatory (that deferral is recorded durably in bootstrap/protocol.md's publication-gating note and release-checklist.md — NOT this plan's T009); schema.json (output-only field, envelope-side unchanged); trust-policy.mjs/engine.mjs (engine refuses rather than emitting; policy keys unchanged); validateEnvelope/trust-policy RETURN SHAPE (deepEqual-pinned at tests/bootstrap-trust.test.mjs:318 — the signed field MUST be computed bin-locally from envelope.signature presence + verification flow, never by extending validateEnvelope's return object)
   - Spike candidate: none (static blast radius fully mapped, scout Q7 + critic probe of :318 pin)
    - Actions: compute signed = Boolean(envelope.signature && crypto verification ran) INSIDE the verify subcommand's emission path only; include in success emission (:257) as `"signed":true|false`; failure emissions carry signed:false; protocol.md verify-output example + guarantees table gain the field with explicit "unsigned envelopes report signed:false and derive trust from policy+digest only" sentence; bootstrap-trust adds assertions: valid-signed envelope -> signed:true, stripped-signature envelope -> ok:true && signed:false.
    - Acceptance signal: `node scripts/pack-bootstrap.mjs && node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs` green with new assertions; payload-index.json diff shows ONLY fixedBin hash/bytes change.
    - Validation: `make check` payload-drift green; protocol.md renders (manual).
    - Acceptance evidence: test output + index diff stat.
    - Repair attempts: 0
    - Recovery note: repack is deterministic; revert bin + rerun pack restores index.

22. [completed] Refuse silent config clobber in upload (F8-07)
    - Task ID: T022
    - Depends on: none
    - Parallel group: leaf
    - Risk: low
    - Owned scope: csm-upload/scripts/upload.mjs loadConfig/save path, csm-upload/tests/upload.test.mjs additions
    - Not in scope: config format/schema changes
    - Spike candidate: none
    - Actions: distinguish ENOENT (silent defaults) from JSON.parse/read errors (stderr warning naming the file + refuse overwrite unless --github/--repo overrides supplied this run); mirror token-efficiency malformed-toggle warning tone; tests: malformed file + no overrides -> abort before write preserving bytes; malformed + override -> proceeds with warning.
    - Acceptance signal: `node --test csm-upload/tests/upload.test.mjs` green incl. both new cases.
    - Validation: manual malformed-run transcript.
    - Acceptance evidence: test output.
    - Repair attempts: 0
    - Recovery note: small branch diff.

## Verification Strategy

Cheapest-first ladder: (1) per-task acceptance signals (targeted node --test files / greps) as fast gates during DISPATCH; (2) `make lint` + `make check` after each parallel-group integration (fast batch, <60s typical); (3) `make test` full battery at spine milestones (T010, final) — expensive batch, serial by design (--test-concurrency=1 suites); (4) final: AC-by-AC walkthrough mapping each of AC1-19 to recorded evidence, plus protected-state diff review (only intended surfaces changed). Known environment-sensitive checks: test-browse-unit requires csm-browse pnpm install (guard message added); test-e2e excluded (Docker); resume-semantics corpus-bound (>=20 plans) — flagged if plans are ever pruned. Parallelizable: leaf tasks within their groups; check-suite runs serialized behind the spine.

## Risks And Recovery

- Wiring previously-dead suites (T007/T009) may surface latent red tests: spike-first ordering contains this; failures triaged in-task or surfaced as blockers — never silenced by skipping assertions.
- Enforcement additions (T004/T009) may flag existing corpus violations: spikes run before wiring; violations become user-visible blockers, history plans never silently edited.
- Repack drift (T021): mitigated by same-commit pack + index-diff inspection; recovery = revert bin commit-range + repack.
- URL-param redaction (T014) uses a NEW anchored exact-token class consumed only by redactUrl's searchParams loop; prose/object-key redaction (SENSITIVE_KEY) is untouched — preserve-cases (exitCode, statusCode, prose "Exit code: 1") are pinned by tests; rollback = revert class + tests together.
- Budget re-pin (T006) could mask future growth: disabled-state NOTE keeps delta visible every gate run; doctrine re-budget session remains available.
- Rollback posture: every task is small, single-surface, and independently revertible; spine order preserves bisectability.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| 1. F5-02 unmapped; phantom T003/T005; count mismatches | blocker | T003 reinstated as full task (launchDaemon child-exit wait + pid-ownership re-read + race-pin test); T005 carved from old T009 (gate half) with T009 rewired (suite half); risk summary + evidence mapping + graph reconciled to 22 tasks T001-T022 no gaps | Critique /tmp/opencode/plan-critique.md F1; plan Numbered Plan items 5/6/11 |
| 2. T014 one-regex widening destroys diagnostics | blocker | Split-class design: NEW anchored URL_CREDENTIAL_PARAM consumed only by redactUrl searchParams loop; SENSITIVE_KEY + redactTelemetry untouched (Not-in-scope forbids); preserve-cases pinned; rollback wording updated | Critique F2; plan item 12; Risks row |
| 3. T018 ∥ T019 same-file parallelism | blocker | T019 Depends on: T018; Execution Graph serialized (T018 -> T019) | Critique F3; plan items 18/19; graph line |
| 4. T002 acceptance passes on untouched tree | major | Structural signals: 12-row table parse incl. csm-make-tests + csm-review-python; pointer-only glance region; `grep -c '^flowchart LR'` == 1 (baseline 2 at :69/:127) | Critique F4; plan item 9 |
| 5. T020 independence contradiction | major | T020 Depends on: T014 (security.test.mjs single writer); graph updated | Critique F5; plan item 20; graph line |
| 6. T010 dependency omissions | major | T010 Depends on: T007, T008, T009, T002 with rationale | Critique F6; plan item 7 |
| 7. T021 return-shape trap + ID collision | major | Not-in-scope now forbids validateEnvelope return-shape changes (deepEqual pin bootstrap-trust:318); signed computed bin-locally; "T009-deferred upstream" replaced with durable-record citation | Critique F7; plan item 21 |
| 8. T011 presumes nonexistent seam | major | Actions specify export + injectable executor param + three-path injected test; callers named (:1048/:1083); numeric sentinel preserved | Critique F8; plan item 10 |
| 9. T007 acceptance counts cases not files | minor | Acceptance = exit 0 AND tap output lists exactly 25 top-level test-file entries | Critique F9; plan item 1 |
| 10. Sandbox copy semantics underspecified | minor | Spike specifies `cp -a` including .git + node_modules; copy method recorded in transcript | Critique F10; plan item 3 spike |
| 11. T009 gating coupling unrecorded | minor | Discovered Requirements gains the coupling note (golden deepEquals + SKILL.md reads become gates); critic's executed 5/5-green + zero-violation corpus results recorded in T005 spike | Critique F11; Discovered Requirements; plan item 5 |
| 12. T004 untracked stance + basename exclusion | minor | Scanner iterates `git ls-files .agents` only; excludes exactly two FULL paths; untracked drafts never brick gate; same-commit indexing documented | Critique F12; plan item 4 |
| 13. T016 insertion site ambiguous | minor | Exact site named (extract.mjs record-assembly loop); intentional scope canary case added to hostile test | Critique F13; plan item 16 |
| 14. T020 idempotence unachievable for shallow parser | minor | Fixed-point form reparse(serialize(reparse(x))) == reparse(x) adopted with rationale | Critique F14; plan item 20 actions |
| 15. T014 rollback leaves tests red | minor | Mooted by split-class design; rollback = class + tests together (Risks row) | Critique F15; Risks |
| 16. Enabled branch should emit measured total | minor | Adopted: enabled branch emits measured description-word total beside budget check (rot-proofing WORD_BUDGET) | Critique F16; plan item 3 actions |
| 17. AC-to-task traceability missing at planning time | minor | Every AC carries -> T### tags (AC14 -> T003, AC4 -> T005+T009, etc.) | Critique F17; Acceptance Criteria |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-23T15:09:09+0000 | 0 | INTAKE -> DISCOVER | none | goal restated; HF-01 product decision put to user -> re-pin chosen (D1) | DISCOVER |
| 2026-08-23T15:14:00+0000 | 0 | DISCOVER -> RESEARCH | none | scout dossier complete (/tmp/opencode/scout-mechanics.md): 15/15 resolved, 0 unresolved; no external research warranted | RESEARCH |
| 2026-08-23T15:16:00+0000 | 0 | RESEARCH -> DRAFT | none | evidence synthesized into Current-State Evidence + Decisions D1-D6 | DRAFT |
| 2026-08-23T15:20:00+0000 | 0 | DRAFT -> CRITIQUE | T001-T022 drafted (22 tasks) | draft sidecar written | CRITIQUE |
| 2026-08-23T15:35:00+0000 | 0 | CRITIQUE -> REMEDIATE | none | critique verdict FIX-FIRST: 3 blockers / 5 majors / 9 minors (/tmp/opencode/plan-critique.md); critic executed read-only probes: corpus zero violations, resume-semantics 5/5 green | REMEDIATE |
| 2026-08-23T18:02:37+0000 | 0 | REMEDIATE -> REMEDIATE | none | DISRUPTION: remediation subagent died mid-pass (empty return; prose-level edits landed, task entries did not) — incident journaled; primary completion invoked per resilience ladder step 4 | REMEDIATE |
| 2026-08-23T18:10:00+0000 | 0 | REMEDIATE -> VERIFY | T001-T022 | primary completed remediation: T003 reinstated, T005/T009 carve-out, T014 split-class rewrite, T002 structural signals, T010/T019/T020 deps, T021 mandates, T011 seam, T004/T016 precision, risks row, 17-row resolution table; all critique findings resolved | VERIFY |
| 2026-08-23T18:15:00+0000 | 0 | VERIFY -> SAVED | T001-T022 | primary-personal gate passed: goal/AC mapping complete (AC1-19 -> tasks), same-file write ownership serialized everywhere (three residual conflicts found and closed: T002->T009 README, T015->T017 ddd.mjs, T016 test filename pinned), named files/interfaces scout-verified, assumptions A1/A2 explicit with spike owners, recoverable via Control+journal+recovery notes | SAVED |
| 2026-08-23T19:25:22+0000 | 1 | RECOVER -> VALIDATE | none | resumed explicit csm-build request; fcf11b2 plan baseline, sole pre-existing untracked review preserved, no NORMS.md | VALIDATE |
| 2026-08-23T19:26:00+0000 | 1 | VALIDATE -> SELECT | none | baseline check-suite 923/923 from plan commit hook; T007 spike 175/175 browse tests green | SELECT |
| 2026-08-23T19:30:00+0000 | 1 | SELECT -> DISPATCH | T011,T012,T014,T015,T016,T018,T020,T021,T022,T003,T013,T017,T019 | independent leaf batches dispatched with non-overlapping scopes; no commits by workers | INTEGRATE |
| 2026-08-23T21:30:00+0000 | 1 | INTEGRATE -> REPAIR | T018,T020,T007 | T018 found ambiguity guards were born-false; fixture + question-file regeneration added; T020 added csm-scan fuzz file requiring tier-manifest entry; README path literal broke sandbox hook tests | REPAIR |
| 2026-08-23T22:00:00+0000 | 1 | REPAIR -> VERIFY | T018,T020,T007,T009,T021,T022 | csm-ddd 39/39, csm-scan 1278/1278 after baseline refresh, browse 186/186, upload 9/9, bootstrap 49/49 via node22 wrapper; plan task statuses reconciled | VERIFY |
| 2026-08-23T22:15:00+0000 | 1 | VERIFY -> REVIEW | T001-T022 | make lint pass; make check 956 checks; make test 1278/1278; tracked corpus harness 23/23; diff-check clean | REVIEW |
| 2026-08-23T22:25:00+0000 | 1 | REVIEW -> REPAIR | T022, artifact sync | independent review found parseable invalid upload shapes and formatter-corrupted `__call__`/`__future__` literals; both repaired, tests added, payload repacked | REPAIR |
| 2026-08-23T22:30:00+0000 | 1 | REPAIR -> CHECKPOINT | T001-T022 | final focused checks green; reviewer low/info residuals recorded in Completion Review; unrelated concurrent research file preserved and excluded from commit | CHECKPOINT |
| 2026-08-23T22:35:00+0000 | 1 | CHECKPOINT -> COMPLETE | T001-T022 | completion gate passed; all implementation work staged/committed by primary; no push/deploy | COMPLETE |

## Completion Review

Status: COMPLETE.

- All 22 numbered tasks completed; T018 included the necessary fixture/question-file amendment because the original ambiguity guards were permanently false.
- Acceptance evidence: `make lint` passed; `make check` passed with 956 checks; `make test` passed with 1,278/1,278; `node --test tests/check-suite.test.mjs tests/resume-semantics.test.mjs` passed 23/23 after staging new tests; upload passed 9/9; bootstrap passed 49/49 under the Node >=22 wrapper.
- High-risk T021 independently reviewed: signed marker is computed in the shipped bin without changing the validateEnvelope return shape; packed fixed-bin hash and payload consistency verified.
- Privacy T014 independently reviewed: URL-scoped exact-token redaction preserves diagnostic object keys and prose; focused and full browse suites passed.
- T022 reviewer medium finding repaired: parseable invalid config shapes now refuse and preserve original bytes; four shape cases are tested.
- T004/T005 gate changes independently reviewed and verified with positive and negative sandbox proofs; artifact-index rule covers tracked artifacts and ignores untracked drafts.
- Generated artifacts refreshed: bootstrap payload/index and csm-scan renderer baseline.
- Residual low/info review notes: T021 malformed-signature variants are not separately table-tested because the existing failure-path contract and 49-test bootstrap suite pass; artifact-index matching is basename-based, with no duplicate basenames currently tracked; formatter-generated reference-artifact normalization is included as build output because `make fmt` was run from a clean worktree, and corrupted identifiers were explicitly repaired.
- Unrelated untracked files `.agents/reviews/2026-08-23-skills-review.md` and `.agents/research/2026-08-23-llm-hill-climbing-autoresearch-skill-research.md` were preserved and excluded from the implementation commit.
