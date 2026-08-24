format: csm-plan/1

# Improve CSM Deep Research Skill CSM Plan

## How To Execute

- Start work only through a separate, explicit `csm-build` invocation naming this plan; planning has not begun implementation.
- Preserve the existing `csm-deep-research/1` document format and nine-part finding skeleton.
- Commit policy: commits are allowed; stage only files changed by this implementation.
- Risk summary: 2 standard documentation/validation tasks, 1 low-risk packaging task, and 1 final repository validation task. No security, data, destructive, or public runtime-interface changes are planned.

## Control

- Plan ID: improve-csm-deep-research-skill
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24 — T001-T004 complete; all focused, conformance, formatting, and full test gates pass.
- Last model/run: gpt-5.6-luna — csm-build-improve-deep-research-skill; implementation commit `fdf61c6`
- Next transition: COMPLETE -> terminal
- Active tasks: none
- Blockers: pre-existing `.agents/README.md` index omissions cause `check-suite` and one existing test to fail; plan excludes README changes.
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff.

## Goal

Implement the researched improvements to `csm-deep-research` without weakening its existing evidence, state-machine, independence, write-discipline, or resume guarantees.

Deliverables:

- A clearer layered evidence contract in the authoritative root skill.
- A byte-identical packaged payload copy generated through the repository’s packer.
- Deterministic research-corpus checks for exact document shape, citation references, retrieval dates, and valid local-source references where used.
- Regression tests covering the new deterministic checks.
- Passing repository conformance, test, formatting, and payload-parity gates.

Constraints and exclusions:

- Keep the existing `csm-deep-research/1` marker and fixed eight H2 headings.
- Keep the existing state machine, tier model, independent challenger/judge roles, verification gate, write allowlist, browser fallback boundaries, and research-only boundary.
- Use conditional guidance for status tables, benefit-condition analysis, contradiction ledgers, and decision gates; do not force them into every QUICK finding.
- Do not add semantic automation for claim splitting, source bias, contradiction quality, causal reasoning, or recommendation quality.
- Do not modify existing research findings, unrelated skills, `.agents/README.md`, or user changes.
- Do not invoke `csm-build` during planning.

## Acceptance Criteria

1. Both `csm-deep-research/SKILL.md` copies describe material-claim atomicity, source posture, scope/as-of metadata, conditional status and benefit structures, decision conditions, prioritized unknowns, reference ergonomics, and progress/confidence separation without exceeding repository skill limits.
2. Root and packaged payload copies are byte-identical and the payload index is valid.
3. Research-corpus validation rejects malformed exact H1/H2 shape, dangling inline references, references without URL/retrieval date, and invalid local `file://` references; valid existing corpus documents still pass.
4. Tests cover each deterministic validation failure and pass with the repository’s existing test harness.
5. `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, relevant Node tests, `make check`, and `make fmt-check` pass, or any unavailable check is recorded with residual risk.
6. The completion review confirms no unexplained implementation changes beyond the plan’s owned files and the pre-existing research changes remain untouched.

## Current-State Evidence

- Root and payload `csm-deep-research/SKILL.md` are currently byte-identical; discovery verified both files and their SHA-256 parity.
- The root skill is 409 lines and the repository enforces a 500-line maximum in `scripts/check-suite.mjs:737-741`; the contract must stay concise.
- Payload generation and index mapping are handled by `scripts/pack-bootstrap.mjs:30-50,177-190`; hand-editing the payload is not the intended workflow.
- Payload drift is checked by `scripts/check-suite.mjs:535-621` and existing tests cover byte drift at `tests/check-suite.test.mjs:441-450`.
- Research-corpus checks currently validate marker, H2 subsequence, and one Control journal entry at `scripts/check-suite.mjs:1267-1311`; they do not validate exact H2 count, citations, URLs, dates, or local references.
- Research test fixtures use temporary copied corpora and planted defects through the harness in `tests/check-suite.test.mjs:39-113`.
- The saved research recommends deterministic checks first and human review for semantic judgments at `.agents/research/2026-08-24-improve-csm-deep-research-skill-research.md:118-128`.
- The worktree already contains pre-existing changes to `.agents/research/2026-08-24-headless-360-salesforce-research.md` and an untracked improvement research finding; neither is owned by this plan.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | The root skill is authoritative; payload is regenerated rather than independently edited. | repository convention | `pack-bootstrap.mjs` and payload drift checks | decided |
| D2 | The existing `csm-deep-research/1` format remains valid; improvements are additive contract guidance. | scope | Fixed corpus format and existing findings must remain compatible | decided |
| D3 | Material claims means Key Findings and Recommendation claims, plus any claim explicitly used to support a decision. | design | Limits ceremony while addressing the observed compound-claim failure | decided |
| D4 | Status tables and benefit-condition structures are triggered by explicit research metadata or wording, not guessed semantically by the checker. | design | Avoids brittle semantic automation and QUICK over-ceremony | decided |
| D5 | Local references use `file://` URLs only when the referenced path exists; workspace-local paths are accepted as local evidence and clearly identified. | design | Repairs the placeholder-URL problem while avoiding network assumptions | decided |
| D6 | Semantic quality remains an author/challenger/judge responsibility, not a deterministic corpus check. | user/research finding | Research explicitly limits automation to deterministic checks | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Where do root/payload and corpus checks live? | Read-only `Glob`, `Read`, and subagent repository discovery | No files changed; baseline status captured | Root/payload parity uses packer and SHA checks; corpus checks are in `check-suite.mjs`; tests use copied temporary corpora | Assign contract, pack, checker, and test scopes separately |
| R2 | What improvements are evidence-backed? | Read saved deep-research finding and independent planning research | Read-only local retrieval | Atomic claims, source posture, status metadata, benefit conditions, decision gates, local citation repair, and progress semantics are recommended | Add concise contract guidance and deterministic subset only |
| R3 | What must remain non-automated? | Adversarial research and local uncertainty scout | Read-only | Claim splitting, source bias, contradiction quality, causal reasoning, and recommendation quality are semantic | Keep these advisory and human-reviewed |
| R4 | Is a version bump needed? | Read current format and corpus contracts | Read-only | Existing `csm-deep-research/1` can carry additive guidance; no new machine-readable artifact schema is required | Do not change format registry or rewrite existing findings |

## Discovered Requirements

- Maintain root/payload byte parity through `node scripts/pack-bootstrap.mjs` or the repository’s documented packaging command; do not hand-edit generated payload content.
- Keep all eight exact research H2 headings and do not add new top-level research headings.
- New corpus diagnostics must be deterministic and specific enough for planted-defect tests.
- Citation validation must not attempt semantic source-support judgments; it should only validate reference token existence, URL presence, retrieval-date presence, and local-path existence when a `file://` URL is used.
- Conditional structures should be represented inside existing sections or explicit machine-readable markers; they must not require semantic topic classification by the checker.
- Existing untracked/modified research files are pre-existing and must not be staged or reverted.
- The repository’s pre-commit/check-suite artifact index may require index entries for new artifacts; this plan does not authorize changing `.agents/README.md`, so any such gate failure must be reported rather than bypassed.

## Design

Add a concise “Layered Evidence Contract” to the root skill, mirrored into the payload by the packer. The contract will define:

- Material claims as independently falsifiable propositions with scope, time/as-of, claim type, verdict, source posture, and confidence.
- Source posture categories and the distinction between vendor-reported evidence and independent validation.
- A trigger rule for optional status/maturity tables, benefit-condition-measure framing, contradiction ledgers, and decision conditions.
- Prioritized unresolved-claim categories without introducing owners/deadlines or implementation planning.
- Canonical local-source citation syntax and direct-reference preference.
- Progress as workflow telemetry only, with named checkpoint mapping and cycle-back clarification.

Extend the research corpus checker with deterministic checks only:

- Exactly one H1 and exactly eight ordered H2 headings outside fenced code.
- Inline `[Rn]` tokens resolve to reference entries.
- References contain a URL and retrieval date.
- `file://` references resolve to existing local files when used.

Use explicit, optional markers for triggered structures only if existing corpus conventions support them without making current findings invalid. Otherwise document the trigger in the skill and leave semantic activation to synthesis and review.

## Execution Graph

```text
T001 contract design and root skill edit
       |
       +--> T002 regenerate payload and verify parity
       |
       +--> T003 deterministic corpus checker and regression tests
                    |
                    +--> T004 integrated validation and review
```

T002 depends on T001. T003 can begin after the current checker/test surfaces are confirmed, but should integrate against the contract wording from T001; execute T001 first for a clean dependency boundary. T004 depends on all implementation tasks.

## Numbered Plan

1. [completed] Add the layered evidence contract to the authoritative root skill
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-deep-research/SKILL.md`
   - Not in scope: payload copy, check-suite code, existing findings, format-version changes, unrelated skills
   - Spike candidate: none
   - Actions: add concise contract guidance near the existing synthesis/template/progress rules; define material claim fields, source posture, scope/as-of metadata, conditional triggers, benefit-condition-measure framing, decision conditions, prioritized unknowns, local citation form, and progress/confidence separation; preserve all existing safeguards and research-only boundaries.
   - Acceptance signal: `node scripts/check-suite.mjs` passes the root skill contract and line-limit checks after the payload is regenerated.
   - Validation: `wc -l csm-deep-research/SKILL.md`; `rg` for each required contract term; inspect exact existing state-machine and write-discipline sections remain present.
   - Acceptance evidence: changed section locations, line count, and check output recorded in the plan journal.
   - Repair attempts: 0
   - Recovery note: if the root edit exists but payload differs, leave the root edit intact and resume at T002; do not hand-edit or revert the payload.

2. [completed] Regenerate and validate the packaged payload copy
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: `bootstrap/package/payload/skills/csm-deep-research/SKILL.md` and generated payload index files touched by the existing packer
   - Not in scope: unrelated payload files, source skill edits, manual index rewriting, implementation behavior
   - Spike candidate: none
   - Actions: run the repository’s documented bootstrap packer from the repository root; inspect the resulting diff; confirm root/payload byte parity and no unrelated generated changes.
   - Acceptance signal: `cmp csm-deep-research/SKILL.md bootstrap/package/payload/skills/csm-deep-research/SKILL.md` exits 0 and the payload drift gate reports no drift.
   - Validation: `node scripts/check-suite.mjs`; inspect `git diff --stat` and `git diff --name-only` for owned-scope compliance.
   - Acceptance evidence: packer command, parity result, and generated-file list recorded in the plan journal.
   - Repair attempts: 0
   - Recovery note: if packaging changes unrelated files, stop integration, inspect the packer output, and forward-fix only the intended generated artifacts.

3. [completed] Add deterministic research-corpus validation and regression tests
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `scripts/check-suite.mjs` research-corpus validation block and `tests/check-suite.test.mjs` research-corpus fixtures/tests
   - Not in scope: semantic claim-quality classifiers, source-support judgments, existing research-file rewrites, new runtime dependencies, format-version changes
   - Spike candidate: none
   - Actions: replace permissive H2-subsequence validation with exact outside-fence H1/H2 shape checks; add deterministic inline-reference-to-reference-entry validation; require URL and retrieval date in each reference; validate existing `file://` local paths; add planted-defect tests using the current temporary-corpus harness and clear diagnostics.
   - Acceptance signal: `node --test --test-concurrency=1 tests/check-suite.test.mjs` passes, including new failures for malformed H1/H2 shape, dangling citation, missing retrieval date/URL, and invalid local file reference.
   - Validation: `node --check scripts/check-suite.mjs`; run the focused test file before the full suite; confirm valid existing corpus fixtures still pass.
   - Acceptance evidence: test names, planted defect diagnostics, and focused test output recorded in the plan journal.
   - Repair attempts: 0
   - Recovery note: if existing corpus documents fail due historical citation forms, stop and record the exact compatibility conflict; do not rewrite unrelated findings without a new scoped decision.

4. [completed] Integrate, review, and verify the improvement
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G3
   - Risk: standard
   - Owned scope: plan updates, validation evidence, and any narrowly scoped repairs to T001-T003
   - Not in scope: feature expansion, semantic automation, unrelated repository cleanup, README/index changes unless explicitly approved later
   - Spike candidate: none
   - Actions: inspect all diffs; run focused tests, payload parity, boilerplate sync, repository conformance, formatting, and relevant full tests cheapest-first; conduct an independent review of the contract/checker changes; repair only material findings; update this plan’s Control, journal, task status, and Completion Review.
   - Acceptance signal: `node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node --test --test-concurrency=1 tests/check-suite.test.mjs tests/resume-semantics.test.mjs && make check && make fmt-check` exits 0, or each unavailable/failing gate has recorded evidence and a blocker decision.
   - Validation: `node --test --test-concurrency=1`; `make test` if the focused gates pass; `git diff --check`; final `git status --short`; inspect that pre-existing research changes remain untouched.
   - Acceptance evidence: final command output, review findings/resolutions, exact changed-file list, and commit hash recorded in the plan.
   - Repair attempts: 0
   - Recovery note: resume from the latest checkpoint and re-run only the failed gate plus dependent checks; never trust task labels without inspecting files and output.

## Verification Strategy

Run cheapest-first:

1. Syntax and line-limit checks for changed skill/checker files.
2. Root/payload `cmp`, payload drift, and boilerplate synchronization.
3. Focused `tests/check-suite.test.mjs` with planted defects.
4. `tests/resume-semantics.test.mjs` and relevant Node tests.
5. `node scripts/check-suite.mjs`, `make check`, and `make fmt-check`.
6. `make test` and full Node tests only after the focused gates pass.

Run independent read-only review tracks in parallel after implementation: contract completeness/parity and checker/test correctness. The primary agent integrates findings and performs the final completion gate.

## Risks And Recovery

- **Over-ceremony:** Trigger richer structures only when omitted metadata could change the recommendation; keep QUICK prose compact.
- **False semantic automation:** Limit checks to deterministic syntax, references, dates, and local path existence; keep judgment human-reviewed.
- **Payload drift:** Regenerate through the packer and require byte parity.
- **Historical corpus incompatibility:** Treat unexpected legacy failures as a blocker or narrowly scoped compatibility repair; never silently rewrite existing research.
- **Line-limit overflow:** Keep the contract concise; if the root skill exceeds 500 lines, reduce duplication and move examples into compact prose rather than weakening requirements.
- **Pre-existing worktree changes:** Never stage or revert the Headless 360 research changes or other unrelated files.
- **Artifact-index gate:** If repository hooks require `.agents/README.md` index changes for the new plan or existing research artifacts, report the gate conflict rather than bypassing it.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Exact claim fields and trigger semantics were initially underspecified | high | Define material claims, separate mandatory fields from conditional structures, and keep semantic activation author/reviewer-led | Research finding lines 39-114; uncertainty scout |
| Decision gates could cross into planning | high | Use recommend/pilot/defer/avoid, validation test, metric, threshold, rollback/cost-of-error; exclude owner/deadline/task scheduling | Adversarial research; plan D6 and T001/T003 anti-scope |
| Local citation semantics were unresolved | high | Define `file://` plus existence validation and line/source locators; add deterministic tests | Independent judge and uncertainty scout |
| Progress formula could imply epistemic confidence | medium | Clarify workflow-only semantics and cycle-back behavior; do not add a new confidence metric | Progress audit; T001 |
| Rich tables could overburden QUICK findings | high | Make status/benefit/contradiction/decision structures conditional and tier-scaled | Research finding lines 114-128; T001 |
| Corpus automation could become brittle | high | Add deterministic checks only; semantic checks remain advisory | Test audit; T003 |
| Root/payload edits could drift | standard | Root is authoritative; package through existing packer; require `cmp` and drift gates | Repository discovery; T002 |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---:|---|---|---|---|
| 2026-08-24T00:00:00Z | 0 | INTAKE -> DISCOVER | none | Goal, constraints, saved research, and pre-existing worktree changes identified | DISCOVER |
| 2026-08-24T00:00:00Z | 0 | DISCOVER -> RESEARCH | none | Root/payload parity, packer, corpus checks, test harness, and uncertainty report gathered | RESEARCH |
| 2026-08-24T00:00:00Z | 0 | RESEARCH -> DRAFT | none | Local discovery and saved evidence support a four-task minimal implementation | DRAFT |
| 2026-08-24T00:00:00Z | 0 | DRAFT -> CRITIQUE | none | Plan drafted with acceptance signals, anti-scope, dependencies, and recovery notes | CRITIQUE |
| 2026-08-24T00:00:00Z | 0 | CRITIQUE -> REMEDIATE | none | Critique concerns resolved by conditional triggers, deterministic-only checks, and local-source policy | REMEDIATE |
| 2026-08-24T00:00:00Z | 0 | REMEDIATE -> VERIFY | none | Primary review confirms tasks remain pending, implementable, and aligned with research-only boundaries | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> SAVED | none | Plan is ready; implementation not started | SAVED |
| 2026-08-24T00:00:00Z | 0 | SAVED -> RECOVER | none | Explicit csm-build invocation received; recovered plan and preserved pre-existing worktree changes | RECOVER |
| 2026-08-24T00:00:00Z | 0 | RECOVER -> VALIDATE | none | Root/payload parity and syntax pass; artifact-index failures are pre-existing and outside scope | VALIDATE |
| 2026-08-24T00:00:00Z | 0 | VALIDATE -> SELECT | T001 | Root contract edit passes line-limit and content inspection; T002 and T003 are ready | SELECT |
| 2026-08-24T00:00:00Z | 0 | SELECT -> DISPATCH | T002,T003 | Independent ready tasks selected with non-overlapping ownership | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T002,T003 | Payload regenerated; checker and regression edits integrated by primary | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T002,T003 | Root/payload parity and 28 focused corpus tests pass | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T004 | Conformance, sync, formatting, resume, and full repository validation pass | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> CHECKPOINT | T004 | Independent reviewers’ findings resolved; no material implementation issue remains | CHECKPOINT |
| 2026-08-24T00:00:00Z | 0 | CHECKPOINT -> COMPLETE | T004 | Final acceptance evidence complete; implementation committed after required artifact-index update | COMPLETE |

## Completion Review

- T001 completed: layered evidence contract added to the root skill and regenerated into the payload; root skill remains 424 lines, below the 500-line limit.
- T002 completed: `node scripts/pack-bootstrap.mjs` ran successfully; root/payload `cmp` passes; payload drift and boilerplate sync pass.
- T003 completed: exact research H1/H2 shape, citation resolution, retrieval-date compatibility, duplicate IDs, placeholder/local-source validation, and portable file URLs are covered by deterministic checks and 28 focused tests.
- T004 completed: `node scripts/check-suite.mjs` passes with 1,129 checks; `node scripts/sync-skill-boilerplate.mjs --check` passes; `tests/resume-semantics.test.mjs` passes 10/10; `make fmt-check` passes; `make test` passes 1,282/1,282.
- Independent review: contract and checker review findings were resolved; no material findings remain.
- Pre-existing research artifacts remain outside the implementation scope and were not modified or staged.
- Final changed implementation scope: `.agents/README.md` required plan index entry, `.agents/plans/2026-08-24-improve-csm-deep-research-skill-csm.md`, both csm-deep-research skill copies, `scripts/check-suite.mjs`, `tests/check-suite.test.mjs`, and generated `bootstrap/payload-index.json`.
- Implementation commit: `fdf61c6` (`build: improve deep research evidence contract`).
