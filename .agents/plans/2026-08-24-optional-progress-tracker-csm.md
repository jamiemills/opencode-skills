format: csm-plan/1

# Optional Progress Tracker CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan.
- Add one shared, optional horizontal progress-tracker contract to every eligible skill definition and its packaged payload copy.
- Exclude `csm-upload` and `csm-browse` exactly as requested.
- The tracker is OFF by default; existing skill output must remain unchanged unless the invocation explicitly requests progress, for example with `--progress` or a direct progress-tracker request.
- Risk summary: 4 tasks — 2 low, 2 standard. T002/T003 require independent review because they change all eligible public skill instructions and packaged copies.

## Control

- Plan ID: optional-progress-tracker
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24T19:35:00+0000 T003 verification passed: parity/exclusion audits, `make check`, `make fmt-check`, pre-commit integration tests, and `make test` all pass; payload index regenerated from packaged skill changes.
- Last model/run: primary planning session 2026-08-24
- Next transition: CHECKPOINT -> COMPLETE
- Active tasks: T004
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Give every skill except `csm-upload` and `csm-browse` a consistent optional progress indicator. When explicitly enabled, the skill declares weighted horizontal milestones and renders one overall horizontal bar plus a horizontal milestone row. The milestone row has no per-milestone bars. When not enabled, the skill behaves exactly as it does today.

## Acceptance Criteria

1. All 11 eligible skills have the same tracker contract in their root `SKILL.md` and `bootstrap/package/payload/skills/*/SKILL.md` copies; `csm-upload` and `csm-browse` have no tracker contract.
2. The contract is explicitly opt-in and states that default output remains unchanged.
3. The enabled format matches the approved example: one overall bar, followed by a horizontal milestone row such as `[Research ✓ 20%] [Plan ✓ 15%] [Build ▶ 45%] [Verify ○ 20%]`, with no per-milestone progress bars.
4. The contract defines weighted completion calculation, milestone status symbols, scope changes, unknown estimates, and truthful progress reporting without inventing precision.
5. Root and payload copies remain byte-identical per eligible skill, and repository checks pass.

## Current-State Evidence

- `git ls-files 'csm-*/SKILL.md' 'bootstrap/package/payload/skills/*/SKILL.md'` shows root and packaged skill definitions for 13 skills.
- `csm-upload/SKILL.md` and `csm-browse/SKILL.md` are the two user-requested exclusions.
- `cmp` across the 11 eligible root/payload pairs produced no differences, so both copies must be updated together.
- Skill definitions are instruction documents; their output contracts are expressed as Markdown guidance rather than runtime code.
- Existing skill output varies by state machine and artifact type, so the tracker must use a shared rendering contract while allowing skill-specific milestone names.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | Exclude `csm-upload` and `csm-browse`. | user-dictated | Explicit user request. | decided |
| D2 | Progress is OFF by default and enabled only by an explicit `--progress` option or direct user request. | user-dictated / design | User requested optional-by-default behavior; explicit opt-in prevents output regressions. | decided |
| D3 | Render one overall bar and one horizontal milestone row; never render per-milestone bars. | user-dictated | User selected the first example and clarified the milestone section must not contain progress bars. | decided |
| D4 | Use declared milestone weights totaling 100%; overall completion is completed weight plus the current milestone's honestly estimated completed fraction. | design | Gives comparable progress across skills without relying on tokens or fabricated elapsed-time estimates. | decided |
| D5 | Update root and packaged payload copies together and require byte parity. | evidence-based | Current repository keeps exact duplicate skill definitions in both locations. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | Which skill files are in scope? | `glob`, `git ls-files`, repository reads | Read-only inspection; no source changes before plan save | 13 skills exist; 11 are eligible after the two exclusions. | T002 owns exactly 22 skill files. |
| R2 | Are packaged copies already synchronized? | `cmp` over all eligible root/payload pairs | Read-only comparison | All eligible pairs are byte-identical. | Require parity validation after implementation. |
| R3 | Is a runtime helper needed? | Read-only inspection of skill formats and repository tooling | No execution or writes needed | Skills are instruction documents with no shared response renderer. | Implement the smallest shared instruction contract; do not add runtime code. |

## Discovered Requirements

- Use ASCII-safe punctuation and the repository's existing Markdown style; the visual bar may use the approved block characters in examples, but the contract must remain readable in plain text.
- The tracker must not be confused with a task-status claim: a skill may show only milestones it has declared and may revise weights only when scope changes are recorded.
- Skill-specific lifecycle state machines remain authoritative; the tracker supplements them and does not replace state transitions, acceptance evidence, or final verification.
- Progress must be omitted when disabled, including from intermediate status messages and final output.
- The packaged payload is generated/maintained separately from root skill files; parity is a required gate, not an assumption.

## Design

Add the same `Optional Progress Tracker` section to each eligible skill definition and its packaged copy. The section will specify:

- Default OFF behavior and explicit opt-in via `--progress` or a direct user request.
- Declaration of 3–6 skill-appropriate milestones and weights totaling 100% before execution begins when enabled.
- One overall 30-character horizontal bar using `█` and `░`, followed by the percentage.
- A horizontal milestone row containing status symbols (`✓` complete, `▶` active, `○` pending), names, and expected weights only.
- No per-milestone progress bars.
- Overall calculation based on completed weighted milestones plus the verified fraction of the active milestone; no fabricated precision when scope or expected work is unknown.
- Scope-change handling: add or reweight milestones only with a brief explanation and recompute the total.

## Execution Graph

- G1 serial: T001 establish the exact eligible skill list and shared contract text.
- G2 serial: T002 update all 22 root/payload skill files; primary owns the shared text to prevent drift.
- G3 parallel: T003 parity and exclusion checks; T004 focused documentation/gate validation.
- G4 serial: primary final review, plan checkpoint, and completion commit.

## Numbered Plan

1. [completed] Freeze eligible skill inventory and contract
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: plan evidence and shared tracker wording
   - Not in scope: skill behavior changes, upload/browse files, runtime renderer code
   - Spike candidate: none
   - Actions: confirm the 11 eligible skills and finalize the exact shared section, including opt-in, bar format, milestone row, calculation, and scope-change rules.
   - Acceptance signal: `test "$(git ls-files 'csm-*/SKILL.md' | grep -vE 'csm-(upload|browse)/SKILL.md' | wc -l)" -eq 11` and the plan contains the approved format decisions.
   - Validation: compare the eligible root/payload file list and confirm upload/browse are excluded.
   - Acceptance evidence: inventory command output and this plan's Design section.
   - Repair attempts: 0
   - Recovery note: if the inventory changes, update only the eligible list and dependent task scope before editing files.

2. [completed] Add the optional tracker contract to eligible skills
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: 22 eligible `SKILL.md` files under root and `bootstrap/package/payload/skills`
   - Not in scope: `csm-upload`, `csm-browse`, runtime code, skill state machines, activation boundaries, and unrelated documentation
   - Spike candidate: none
   - Actions: insert identical tracker guidance into every eligible root/payload pair; preserve each skill's existing content and local lifecycle instructions.
   - Acceptance signal: a scripted audit confirms each eligible pair contains the exact section and excluded skills contain zero tracker markers.
   - Validation: `git diff --check`; inspect representative planning, analysis, and build skills; confirm default-off wording is present everywhere.
   - Acceptance evidence: changed-file list, section hash/parity output, and exclusion audit.
   - Repair attempts: 0
   - Recovery note: if a pair diverges, restore parity from the exact shared contract without changing unrelated skill text.

3. [completed] Validate parity, format, and behavior contract
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: validation scripts/commands and eligible skill documents only
   - Not in scope: adding a runtime progress engine, enabling the tracker by default, or modifying excluded skills
   - Spike candidate: none
   - Actions: run root/payload byte-parity checks, excluded-skill audit, Markdown/format checks, and relevant repository checks.
   - Acceptance signal: `make check && make fmt-check` exits 0 and the parity/exclusion audit exits 0.
   - Validation: run targeted skill corpus tests first, then the full repository test gate if available.
   - Acceptance evidence: exact command results and zero unexpected diffs.
   - Repair attempts: 0
   - Recovery note: any failure is classified as content drift, formatter behavior, or pre-existing environment failure before repair.

4. [in_progress] Review, checkpoint, and complete the plan
   - Task ID: T004
   - Depends on: T003
   - Parallel group: G4
   - Risk: low
   - Owned scope: plan journal/completion review and final commit
   - Not in scope: pushing, deployment, or changes outside the plan scope
   - Spike candidate: none
   - Actions: personally review all acceptance criteria, update Control/journal/Completion Review, commit only the implementation and plan files, and leave the worktree clean.
   - Acceptance signal: `git diff --check && git status --short` exits clean after the completion commit and the plan records `Status: complete` and `Current CSM state: COMPLETE`.
   - Validation: inspect the final diff and commit contents against T002 ownership.
   - Acceptance evidence: final commit hash, clean status, and completed plan.
   - Repair attempts: 0
   - Recovery note: resume from the latest checkpoint and never include unrelated concurrent changes.

## Verification Strategy

Run the cheapest checks first: inventory/parity and exact marker audits, then `git diff --check`, then repository documentation/format checks, then `make check` and any full test gate. Review the final diff for unchanged excluded skills and unchanged unrelated skill content. No runtime behavior test is needed because this change modifies instruction documents only; the contract audit is the behavior check.

## Risks And Recovery

- Repeated copies can drift; use exact shared-section comparison across every root/payload pair.
- Optional output could accidentally become default; audit explicit OFF-by-default language and test a marker absence in unrelated baseline content.
- Weighted estimates can imply false precision; require declared weights, honest unknown handling, and scope-change notes.
- A tracker section could override a skill's lifecycle; state explicitly that the tracker supplements, never replaces, the skill's state machine and acceptance evidence.
- Recovery is file-local: preserve unrelated edits, repair only the affected pair, and rerun parity plus repository gates.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| Runtime implementation path was uncertain | major | Resolved by repository inspection: skills are instruction documents, so use a shared contract rather than adding a renderer. | R3 |
| Optional activation needed a deterministic trigger | major | Use explicit `--progress` or direct user request; default remains OFF. | D2, Design |
| Milestone bars could conflict with the selected format | major | Only the overall bar is rendered; milestone row contains labels, symbols, and weights without bars. | D3, Design |
| Root/payload duplication could drift | major | Update both copies together and require byte parity. | R2, D5, T003 |
| Upload/browse scope could be accidentally included | minor | Explicit 11-skill inventory and exclusion audit. | D1, T001/T003 |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-24T19:00:00+0000 | 0 | INTAKE -> DISCOVER -> RESEARCH | none | User selected weighted horizontal milestones with one overall bar; repository inspection found 11 eligible root/payload skill pairs and two explicit exclusions. | DRAFT |
| 2026-08-24T19:05:00+0000 | 0 | RESEARCH -> DRAFT -> CRITIQUE -> REMEDIATE -> VERIFY -> SAVED | T001-T004 | Shared instruction-contract design reviewed against all eligible skill formats; default-off behavior, exact rendering, parity, and exclusion gates resolved. Implementation not started during planning. | SAVED |
| 2026-08-24T19:10:00+0000 | 0 | SAVED -> RECOVER -> VALIDATE -> SELECT -> DISPATCH | T001,T002 | Explicit user requested immediate execution; plan format/index validation passed, eligible inventory confirmed, and shared contract ready for implementation. | INTEGRATE |
| 2026-08-24T19:20:00+0000 | 0 | DISPATCH -> INTEGRATE -> VERIFY | T002,T003 | Identical tracker contract added to all 11 eligible root/payload pairs; parity, exclusion, inventory, and `git diff --check` audits pass. | REVIEW |
| 2026-08-24T19:35:00+0000 | 0 | VERIFY -> REVIEW -> REPAIR -> VERIFY -> CHECKPOINT | T003,T004 | Independent review found and repaired two wording gaps: explicit disabled-output preservation and active-weight multiplication. `make check`, `make fmt-check`, pre-commit integration tests (8/8), and `make test` (1282/1282) pass; generated payload index is consistent. | COMPLETE |

## Completion Review

Implementation complete. The optional tracker contract is present in all eligible root/payload skill pairs, excluded from upload/browse, and verified by repository gates. Final commit is pending after this checkpoint.
