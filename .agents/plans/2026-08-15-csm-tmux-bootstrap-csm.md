# Extend Tmux Session Bootstrap To All Suitable CSM Skills CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 low-risk tasks (documentation-only edits to SKILL.md and README.md); no high-risk tasks; no independent review required for any task.

## Control
- Plan ID: csm-tmux-bootstrap
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-15 cycle 1 complete: T001-T005 all verified via grep acceptance signals and batch gates; zero repair attempts; lightweight primary self-review (docs-only, low risk)
- Next transition: none (terminal)
- Active tasks: none
- Blockers: none (A1 exclusion of grill/browse/upload remains a pending user decision; follow-up note: csm-review skill, added post-planning in 97378f6, has no bootstrap — out of this plan's scope)

## Goal
Replicate the tmux session bootstrap from `csm-plan/SKILL.md:10-28` in every csm skill where it makes sense, so each such skill — before any other work — checks for tmux and starts its orchestrating agent in a new detached tmux session unless the invocation is already inside tmux, the user declined tmux, the user asked for an alternative multiplexer, or tmux is unavailable. Every skill states the tmux session name in use (both when starting a session and when continuing inside an existing one).

Deliverables:
1. A "Tmux Session Bootstrap" section, adapted from csm-plan, added to `csm-build/SKILL.md`, `csm-bdd-tdd/SKILL.md`, and `csm-scan/SKILL.md`, each using its own skill-prefixed session name (`csm-build-<goal-slug>`, `csm-bdd-tdd-<goal-slug>`, `csm-scan-<goal-slug>`).
2. A one-line amendment to `csm-plan/SKILL.md` so that when the bootstrap is skipped because the invocation is already inside tmux, it states the current tmux session name being used (satisfies "they all should state the tmux name used" universally).
3. README.md updated so the tmux requirement, skills table, and usage sequence no longer say "csm-plan only".

Constraints:
- Documentation-only changes; no code, scripts, dependencies, or configuration are touched.
- The bootstrap text stays as close to the csm-plan original as possible (the user asked for "the same test and the same use of tmux"), changing only the skill name, session-name prefix, and placement references.
- Exclusions (see Assumptions A1): `csm-grill`, `csm-browse`, `csm-upload` receive no bootstrap in this plan, pending user confirmation.

## Acceptance Criteria
1. `csm-build/SKILL.md`, `csm-bdd-tdd/SKILL.md`, and `csm-scan/SKILL.md` each contain a `## Tmux Session Bootstrap` section that (a) runs before anything else in the skill, (b) contains all four skip conditions from csm-plan (already inside tmux; user said no tmux; user chose an alternative multiplexer; tmux missing/cannot start), (c) derives a session named `<skill>-<goal-slug>` with the numeric-suffix collision rule, (d) launches the agent detached carrying the original request, (e) prints an attach notice naming the session, and (f) ends the invocation without doing any skill work unless the bootstrap was skipped. Verified by grep per task acceptance signals.
2. Each new section — and csm-plan's amended section — states the tmux session name in use in both paths: when it starts a session (attach notice) and when it skips because already inside tmux (states the current session name). Verified by grep.
3. `README.md` no longer describes tmux as "csm-plan only"; its tmux requirement line, skills table, and usage sequence reflect the extended set (csm-plan, csm-build, csm-bdd-tdd, csm-scan) and still note that grill/browse/upload run without the bootstrap. Verified by grep.
4. No file other than the five named SKILL.md/README.md files is modified. Verified by `git status --short` listing exactly those files.
5. Excluded skills (`csm-grill`, `csm-browse`, `csm-upload`) remain byte-identical. Verified by `git diff --stat` showing no entries for them.

## Current-State Evidence
- `csm-plan/SKILL.md:10-28` — the reference "Tmux Session Bootstrap": check TMUX env / `tmux display-message -p '#session_name'`; four skip conditions; session name `csm-plan-<goal-slug>` with `-2`, `-3` suffix on collision; `tmux new-session -d -s ... 'opencode run "<original planning request>"'`; attach notice; end invocation when spawned.
- Commit history: `a31ca88 csm-plan: bootstrap orchestrating agent in tmux session before planning` and `a69b625 README: document csm-plan tmux session bootstrap` — the bootstrap is a recent, deliberate addition with README coverage, establishing the documentation pattern to replicate.
- `README.md:52` — "tmux — optional, `csm-plan` only" (now stale the moment this plan lands).
- `README.md:39` — skills-table row style mentioning tmux for csm-plan; rows for csm-bdd-tdd (line 40), csm-build (line 41), csm-scan (line 42) currently have no tmux mention.
- `README.md:81` — usage step 3 documents the csm-plan tmux behavior; steps 4 (csm-bdd-tdd) and 5 (csm-build) have none.
- `csm-build/SKILL.md` — 225 lines; intro at line 8, `## Activation Boundary` at line 10; no tmux reference anywhere. Long-running orchestrating skill with parallel subagents, checkpoints, and commits — the strongest fit after csm-plan.
- `csm-bdd-tdd/SKILL.md` — 261 lines; intro at line 8, `## Repository Norms` at line 10; autonomous pipeline `INTAKE -> ... -> SAVED`; no tmux reference. Same non-interactive shape as csm-plan.
- `csm-scan/SKILL.md` — 177 lines; intro at line 8, `## When to use` at line 10; autonomous read-only scan producing one NORMS.md, potentially long-running; also exposes a direct CLI (`scripts/scan.mjs`) that humans may run from a shell without any agent. No tmux reference.
- `csm-grill/SKILL.md:79-83` — GRILL state requires interviewing the user one question at a time and waiting for each answer; the skill is interactive by design.
- `csm-browse/SKILL.md:25-43, 95-99` — verb commands drive an isolated Chromium via a daemon; sessions live in the Docker container independent of the terminal and are swept after 10 minutes idle.
- `csm-upload/SKILL.md:26-44` — single one-shot upload script invocation.
- `grep -rin tmux` over the skills tree — matches only in `csm-plan/SKILL.md`, `README.md`, git metadata, and an unrelated `node_modules` type stub; no other skill mentions tmux.
- Git: repo root is the skills directory itself; working tree clean at planning time.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | `csm-grill`, `csm-browse`, and `csm-upload` are excluded from the tmux bootstrap: grill is an interactive interview that cannot run detached (`csm-grill/SKILL.md:79-83`), browse is a stateless verb tool over an already-daemonized browser, upload is a one-shot script. | User-dictated exclusion policy | User: "if it doesnt make sense to do it then dont and ask me to confirm" | Pending user confirmation (non-blocking; plan is ready without them) |
| A2 | "tmux is already running" means the invocation itself is already inside a tmux session (TMUX set / display-message succeeds), matching the csm-plan reference check — not merely that a tmux server exists. | Interpretation | csm-plan/SKILL.md:14-16; the server-exists reading would make the bootstrap unreachable in practice | Decided |
| A3 | For `csm-scan`, the bootstrap governs agent-driven skill invocations only; direct human CLI runs of `scripts/scan.mjs` are out of its scope. | Scope decision | csm-scan exposes a standalone CLI (README.md:75, csm-scan/SKILL.md:64-76); forcing tmux on direct shell usage would be nonsense | Decided |
| A4 | The re-invoked agent inside tmux receives the user's original request verbatim, so activation boundaries (e.g. csm-build's explicit-start rule) are naturally re-satisfied by the same message. | Design decision | csm-plan bootstrap precedent ("carrying the user's original planning request") | Decided |
| A5 | Nested bootstraps cannot occur: subagents spawned by an agent already inside tmux inherit TMUX and skip per condition 1. | Design decision | Environment inheritance; csm-plan/SKILL.md:15-16 | Decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Which skills already reference tmux? | `grep -rin tmux` over skills tree | Read-only grep; no writes | Only csm-plan/SKILL.md and README.md (plus git metadata/node_modules noise) | All other skills need the section from scratch |
| R2 | Is the bootstrap a stable, documented convention? | `git log --oneline -5` | Read-only git inspection | Dedicated commits a31ca88 (skill) + a69b625 (README) establish skill+README pairing | Every skill change must ship with its README counterpart (T005) |
| R3 | Do the candidate skills have non-interactive terminal states? | Read of all seven SKILL.md files | Read-only | csm-build/csm-bdd-tdd/csm-scan are autonomous with terminal states; grill is interactive; browse/upload are short-lived tools | Scope = build, bdd-tdd, scan; exclusions flagged |

## Discovered Requirements
- README commit style: short imperative messages, frequently skill-prefixed (README.md:129). Evidence: `a31ca88 csm-plan: bootstrap...`.
- README structure to keep in sync: Requirements tmux bullet (line 52), Skills table rows (lines 38-44), Usage sequence (lines 79-84). Evidence: a69b625 updated exactly these areas for csm-plan.
- csm-build's bootstrap must be placed after the intro paragraph and must not undermine the Activation Boundary; the re-invocation carries the original explicit request (A4).
- csm-scan bootstrap needs the direct-CLI scope note (A3).
- The orchestration skills are single-file skills with no test suite; validation is grep-based structural checks plus review (README.md:128).

## Design
Copy csm-plan/SKILL.md:10-28 into each target skill with a minimal, mechanical adaptation:

1. **Placement**: immediately after the one-paragraph intro, before the first workflow section (before `## Activation Boundary` in csm-build; before `## Repository Norms` in csm-bdd-tdd; before `## When to use` in csm-scan), with the "before anything else" sentence naming that skill's first section/states.
2. **Session name prefix**: `csm-build-<goal-slug>`, `csm-bdd-tdd-<goal-slug>`, `csm-scan-<goal-slug>`; keep the lowercase-hyphen slug rule and the `-2`/`-3` collision suffix.
3. **Identical logic**: TMUX check; the same four skip conditions; `tmux new-session -d -s <name> 'opencode run "<original request>"'` with the "adapt to the agent CLI in use" caveat; attach notice; end-invocation-unless-skipped rule.
4. **Name always stated (new, applied to all four sections)**: add one sentence to the skip branch — when already inside tmux, state the current session name (from `tmux display-message -p '#session_name'`) and continue in it. This satisfies the user's "they all should state the tmux name used" without changing behavior.
5. **csm-scan only**: one extra sentence noting the bootstrap applies to agent-driven skill sessions, not direct CLI runs of `scripts/scan.mjs`.
6. **README.md**: rewrite the Requirements tmux bullet to name the four tmux-enabled skills and the opt-out; add a tmux clause to the csm-build, csm-bdd-tdd, and csm-scan skills-table rows mirroring the csm-plan row wording; extend Usage steps 4-5 (and the scan step 2) with a brief "starts in a detached tmux session unless already inside one or declined" clause.

Boundaries: no code, script, config, or dependency changes; no changes to excluded skills; no behavioral machinery beyond markdown instructions.

## Execution Graph
- Dependencies: none between tasks T001-T004 (disjoint files); T005 (README) logically follows T001-T003 so its wording matches what landed, but it edits a disjoint file and can run in the same batch with its content already fixed by this plan.
- Critical path: any single task; total effort is one small batch.
- Parallel group G1: T001, T002, T003, T004, T005 (all disjoint write ownership).

## Numbered Plan
1. [completed] Add Tmux Session Bootstrap to csm-build
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-build/SKILL.md` only
   - Not in scope: any other file; any change to csm-build's state machine, activation boundary semantics, or commit rules
   - Spike candidate: none
   - Actions: Insert a `## Tmux Session Bootstrap` section between the intro paragraph (line 8) and `## Activation Boundary` (line 10), adapted from csm-plan/SKILL.md:10-28: same five steps and four skip conditions; session names `csm-build-<goal-slug>` with numeric-suffix collision rule; detached re-invocation carrying the user's original build request; attach notice; end-invocation-unless-skipped; skip-branch sentence stating the current tmux session name when already inside tmux; "before anything else" phrased as before Activation Boundary work, before locating the plan, and before any execution state.
   - Acceptance signal: `grep -c "## Tmux Session Bootstrap" csm-build/SKILL.md` returns 1 AND `grep -E "csm-build-<goal-slug>" csm-build/SKILL.md | wc -l` is >= 3 (derivation, launch, notice) AND `grep -c "already inside tmux" csm-build/SKILL.md` >= 1 — expected: all pass.
   - Validation: visual diff review; confirm the four skip conditions each appear (`grep -c` per condition); confirm no other section reordered.
   - Acceptance evidence: recorded grep outputs and diff summary in the plan during CHECKPOINT.
   - Repair attempts: 0
   - Recovery note: partial work is visible as a truncated or misplaced section in csm-build/SKILL.md; re-run grep signal and complete/fix the single section in place.

2. [completed] Add Tmux Session Bootstrap to csm-bdd-tdd
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-bdd-tdd/SKILL.md` only
   - Not in scope: any other file; any change to the BDD/TDD pipeline, write allowlist, or specs-folder contract
   - Spike candidate: none
   - Actions: Insert a `## Tmux Session Bootstrap` section between the intro paragraph (line 8) and `## Repository Norms` (line 10), adapted identically to T001 with session names `csm-bdd-tdd-<goal-slug>`; "before anything else" phrased as before INTAKE, before any pipeline tool use, and before any other section of this skill; include the skip-branch sentence stating the current tmux session name.
   - Acceptance signal: `grep -c "## Tmux Session Bootstrap" csm-bdd-tdd/SKILL.md` returns 1 AND `grep -E "csm-bdd-tdd-<goal-slug>" csm-bdd-tdd/SKILL.md | wc -l` is >= 3 AND `grep -c "already inside tmux" csm-bdd-tdd/SKILL.md` >= 1 — expected: all pass.
   - Validation: visual diff review; per-condition grep checks; confirm section precedes `## Repository Norms`.
   - Acceptance evidence: recorded grep outputs and diff summary.
   - Repair attempts: 0
   - Recovery note: same as T001 — single self-contained section; grep signal locates gaps.

3. [completed] Add Tmux Session Bootstrap to csm-scan
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-scan/SKILL.md` only
   - Not in scope: any other file; csm-scan lib/scripts/test code; the scanner's read-only and single-write constraints
   - Spike candidate: none
   - Actions: Insert a `## Tmux Session Bootstrap` section between the intro paragraph (line 8) and `## When to use` (line 10), adapted identically to T001 with session names `csm-scan-<goal-slug>`; "before anything else" phrased as before any scan, test, or analysis command; include the skip-branch sentence stating the current tmux session name; add the one-sentence scope note that the bootstrap governs agent-driven skill sessions, not direct CLI runs of `scripts/scan.mjs`.
   - Acceptance signal: `grep -c "## Tmux Session Bootstrap" csm-scan/SKILL.md` returns 1 AND `grep -E "csm-scan-<goal-slug>" csm-scan/SKILL.md | wc -l` is >= 3 AND `grep -c "scripts/scan.mjs" csm-scan/SKILL.md` >= 1 within or adjacent to the section — expected: all pass.
   - Validation: visual diff review; per-condition grep checks; confirm section precedes `## When to use`.
   - Acceptance evidence: recorded grep outputs and diff summary.
   - Repair attempts: 0
   - Recovery note: same single-section recovery as T001/T002.

4. [completed] Amend csm-plan bootstrap to state session name when skipping
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-plan/SKILL.md` lines 14-19 (skip branch) only
   - Not in scope: any other line of csm-plan; any change to the four skip conditions or spawn logic
   - Spike candidate: none
   - Actions: Add one sentence to the skip branch (step 2) of the existing bootstrap: when skipping because the invocation is already inside tmux, state the current tmux session name (e.g. via `tmux display-message -p '#session_name'`) and continue in it, so the name in use is always stated. Mirror wording will already exist in T001-T003 sections.
   - Acceptance signal: `grep -c "display-message" csm-plan/SKILL.md` is >= 2 (check step 1 + new skip-branch sentence) AND `git diff -- csm-plan/SKILL.md | grep -c "^+"` shows only additive lines for this amendment — expected: both pass.
   - Validation: visual diff review; confirm the four skip conditions and steps 1, 3-5 are untouched.
   - Acceptance evidence: recorded grep and diff output.
   - Repair attempts: 0
   - Recovery note: single-line additive edit; any partial state is a missing sentence, completed in place.

5. [completed] Update README for the extended tmux convention
   - Task ID: T005
   - Depends on: none (wording fully specified by this plan; lands in same batch)
   - Parallel group: G1
   - Risk: low
   - Owned scope: `README.md` only (tmux bullet in Requirements, csm-build/csm-bdd-tdd/csm-scan table rows, Usage steps mentioning those skills)
   - Not in scope: any other README section; csm-grill/csm-browse/csm-upload table rows (beyond leaving them accurate — no tmux claims)
   - Spike candidate: none
   - Actions: (a) Rewrite the Requirements tmux bullet (line 52) to: tmux is optional; when available and not already running under tmux (and not opted out of), the `csm-plan`, `csm-build`, `csm-bdd-tdd`, and `csm-scan` skills start their orchestrating agent in a detached tmux session so long-running work survives a dropped terminal; each prints its session name and how to attach; without tmux they proceed in the current session. (b) Add a tmux clause to the csm-build, csm-bdd-tdd, and csm-scan rows in the Skills table, mirroring the csm-plan row (line 39) wording. (c) In Usage, extend the step-3-style tmux note to the mutate (step 4), build (step 5), and scan (step 2) entries with one short clause each.
   - Acceptance signal: `grep -ci "csm-plan only" README.md` returns 0 AND `grep -c "csm-build-<goal-slug>" README.md` >= 1 AND the Skills-table rows for csm-build/csm-bdd-tdd/csm-scan each match `grep -i tmux` — expected: all pass.
   - Validation: visual read of the three edited areas; confirm grill/browse/upload rows unchanged.
   - Acceptance evidence: recorded grep outputs and diff summary.
   - Repair attempts: 0
   - Recovery note: edits confined to three known areas of one file; grep signals identify any incomplete area.

## Verification Strategy
- Fast per-task gates (each task's grep acceptance signal) — objective, near-instant, run as tasks complete.
- Batch gate after INTEGRATE: combined `grep -l "## Tmux Session Bootstrap"` across csm-plan, csm-build, csm-bdd-tdd, csm-scan returns exactly those four files; `grep -ri tmux csm-grill/SKILL.md csm-browse/SKILL.md csm-upload/SKILL.md` returns nothing.
- Final gates: `git status --short` shows exactly the five intended files; `git diff --stat` confirms no excluded-skill entries; human/agent read-through of each diff for tone and consistency with the csm-plan reference text.
- Not applicable: csm-scan and csm-browse test suites (no code touched — running them is optional reassurance only, not a gate).

## Risks And Recovery
- Risk: wording drift from the reference bootstrap creates divergent behavior expectations across skills. Mitigation: mechanical adaptation rule (only skill name, session prefix, placement references, and the two approved additions differ); batch read-through gate.
- Risk: README and SKILL.md fall out of sync (stale "csm-plan only"). Mitigation: T005 ships in the same batch; acceptance criterion 3 greps for the stale phrase.
- Risk: user later wants tmux in the excluded three skills. Recovery: this plan's exclusion (A1) is additive-only; a small follow-up plan adds sections in the identical pattern without rework.
- Risk: csm-build re-invocation loses plan-path context. Mitigation: A4 — the original request is carried verbatim; csm-build's Locate The Plan section already resolves paths from prompt or `.agents/plans/`.
- Rollback: all changes are single-file markdown edits; `git checkout -- <file>` (or revert of the single commit) restores prior state with no side effects.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Excluding grill/browse/upload contradicts the literal "all skills" wording | high | Followed the user's own override ("if it doesnt make sense... dont and ask me to confirm"); exclusions justified by interactivity (grill), daemonized statelessness (browse), one-shot nature (upload); flagged as pending decision A1 | csm-grill/SKILL.md:79-83; csm-browse/SKILL.md:25-43,95-99; csm-upload/SKILL.md:26-44 |
| README says "tmux — optional, csm-plan only" and would contradict the skills | medium | T005 updates requirement line, table rows, and usage notes in the same batch | README.md:39-44,52,79-84; precedent a69b625 |
| csm-scan direct CLI runs would be nonsensically forced into tmux | medium | Scope note added to the csm-scan section (A3) | README.md:75; csm-scan/SKILL.md:64-76 |
| "tmux is already running" ambiguity (server-exists vs inside-tmux) | medium | Adopted inside-tmux reading matching the reference check (A2) | csm-plan/SKILL.md:14-16 |
| Bootstrap could nest (skill invoked from inside a tmux'd session) | low | Cannot occur: TMUX is inherited, condition 1 skips | csm-plan/SKILL.md:15-16; A5 |
| Plan lacks a mechanism for "state the tmux name used" when skipping | medium | New skip-branch sentence in all four sections (T001-T004) | user requirement |
| T005 depends on T001-T003 wording | low | Wording fully specified in this plan; T005 owns a disjoint file and runs in G1 | Design section 6 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-15 | 0 | Plan created (INTAKE->DISCOVER->RESEARCH->DRAFT->CRITIQUE->REMEDIATE->VERIFY->SAVED) | none | Discovery greps, seven SKILL.md reads, git log evidence recorded above; primary-led critique per Scale To The Ask (small prescriptive docs-only brief) | NOT_STARTED; future csm-build begins at RECOVER |
| 2026-08-15 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT -> DISPATCH | T001-T005 selected (G1, disjoint files) | Repo status: clean except unrelated modified `.agents/plans/2026-08-15-csm-review-skill-csm.md` (preserved, never staged); NORMS.md absent; drift: csm-review skill added post-planning (97378f6), README lines shifted (tmux bullet now L54, table rows L40-43, usage steps renumbered — plan step refs remapped: mutate=step 5, build=step 6, scan=step 2); csm-review/csm-grill/csm-browse/csm-upload contain zero tmux refs; primary-agent direct implementation chosen over subagent dispatch (5 mechanical ~20-line insertions fully specified by plan; prompt content would exceed edit content; lightweight path per Scale ceremony to risk) | INTEGRATE |
| 2026-08-15 | 1 | INTEGRATE -> VERIFY -> REVIEW -> CHECKPOINT -> COMPLETE | T001-T005 completed | Acceptance signals: T001 `1/3/2` (section/goal-slug/already-inside), T002 `1/3/2`, T003 `1/3/1` (incl. scripts/scan.mjs scope note), T004 display-message=2 + csm-plan diff purely additive (0 removed lines), T005 "csm-plan only"=0 + goal-slug greps 2/2/2 + 3 table rows match tmux. Batch gates: `## Tmux Session Bootstrap` present in exactly csm-plan/csm-build/csm-bdd-tdd/csm-scan; excluded skills (grill/browse/upload) 0 tmux refs, byte-identical; git status shows exactly the 5 target files + this plan + pre-existing unrelated review-plan modification (unstaged, preserved); diff stat: +22/-0 each new SKILL.md, +2/-0 csm-plan, README 3 areas edited, no excluded entries. Self-review of full diffs: wording mechanically mirrors csm-plan reference; placement confirmed before Activation Boundary / Repository Norms / When to use. 0 repair attempts. Follow-up flagged: csm-review (new post-planning skill) has no bootstrap — separate small plan if wanted | COMPLETE |

## Completion Review
All five acceptance criteria verified 2026-08-15 by primary agent: (1) three new bootstrap sections contain all four skip conditions, skill-prefixed session names with collision rule, detached launch carrying the original request, attach notice, and end-invocation rule — grep-verified per task; (2) session name stated in both paths in all four sections (attach notice + inside-tmux skip sentence); (3) README requirement bullet, skills table, and usage sequence reflect the four tmux-enabled skills with zero "csm-plan only" remnants; (4) execution touched exactly the five named files; (5) excluded skills byte-identical. No regressions possible (documentation-only). Residual: A1 exclusion (grill/browse/upload) awaits user confirmation; csm-review skill postdates the plan and has no bootstrap — candidate for a follow-up plan.
