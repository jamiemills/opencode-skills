---
format: csm-plan/1
---

# csm-grill Brief-Conformance Verification CSM Plan

## How To Execute
- This plan verifies the built `csm-grill` skill against the user's original brief and defines remediation for the gaps found. It is planning-only; it does not edit the skill.
- Remediation tasks (T001, T002) are `pending` and run via a separate, explicit csm-build invocation. Both edit the same file (`csm-grill/SKILL.md`) so they are sequenced, not parallel.
- Risk summary: 2 tasks, both low risk (small text edits to one markdown skill). No security, data, destructive, or public-interface impact.

## Control
- Plan ID: csm-grill-brief-conformance
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-03 — cycle 1: T001 + T002 applied (primary-led, sequenced); all gates green
- Next transition: none (terminal)
- Active tasks: none
- Blockers: none

## Goal
Confirm whether the built `csm-grill` skill (`csm-grill/SKILL.md`) meets the user's original brief, with per-requirement evidence; and, for any material gap, define minimal remediation tasks. The user's brief (distilled into 17 testable requirements — see Acceptance Criterion 1) prescribed: a Matt Pocock "grill me"-style skill named `csm-grill`, along the lines of the other csm skills, that takes an idea and runs a cyclic (non-linear) CSM through seven behaviors (clarify context → scout clarification areas via subagent → question the user → deep-research the answers via subagent → synthesize into big-picture phases each being a csm-plan brief → devise final approach → confirm with the user), cycling until the user agrees, then saving a single date-stamped labelled markdown approach document in `.agents/` at the repo home (or cwd if not a repo), whose parts are optimized for csm-plan, with ASCII + Mermaid phasing diagrams, strict single-file write discipline, and temp files confined to a temp dir and cleaned up.

Deliverable of THIS plan: a saved verification document (this file) containing the evidence map and the remediation tasks. It does not modify the skill.

## Acceptance Criteria
1. Every one of the 17 brief requirements is mapped to concrete evidence (`csm-grill/SKILL.md` file:line) with a verdict of MET or PARTIAL/NOT-MET. Evidence: the "Brief-Conformance Evidence Map" section below.
2. Each PARTIAL/NOT-MET requirement either has a remediation task defined in the Numbered Plan or is recorded as a defensible interpretation with rationale in Assumptions And Decisions. Evidence: the evidence map's verdicts cross-reference task IDs or decision IDs.
3. Each remediation task names a runnable acceptance signal (grep gate) and a regression gate (re-run of the build plan's T001 contract-string signal) so the fix provably closes the gap without breaking contract strings. Evidence: the task blocks below.

## Brief-Conformance Evidence Map
Source audited: `csm-grill/SKILL.md` (206 lines). Independent audit reference: R1.

| # | Brief requirement | Verdict | Evidence (`csm-grill/SKILL.md`) | Disposition |
|---|---|---|---|---|
| 1 | Name `csm-grill`; csm-skill style; Matt Pocock "grill me" lineage (relentless, one-q-at-a-time, recommended answer, look-up-don't-ask, user owns decisions, no action before shared understanding) | MET (one quality gap — see #18) | L2 name; L6/#CSM Grill; L22-23 look-up + one-q-at-a-time + recommended answer; L21 user owns decisions; L46/L109 no SAVED before agreement; L8/L15 never acts outside the approach doc | #18 → T002 |
| 2 | Triggered by the user sharing an idea | MET | L3 description ("use when the user shares an idea and wants to be grilled"); L12 activation | decision D1 (activation also requires explicit ask — matches sibling house style) |
| 3 | (1) clarify any context needed — via CSM state | MET | L52,62-68 INTAKE restate + harvest facts + list unknowns | decision D2 (step 1 = establish context, non-interactively; step 3 = question the user — clean separation the brief itself implies) |
| 4 | (2) subagent researches/identifies clarification areas | PARTIAL | L70-75 SCOUT dispatches a subagent — BUT L26 permits "primary-led scouting" for small ideas (zero subagents) | **T001** |
| 5 | (3) get clarification by asking questions | MET | L77-84 GRILL: one q at a time, dependency order, recommended answer, wait for reply | — |
| 6 | (4) subagent deep research + further options | PARTIAL | L86-92 DEEP_DIVE dispatches subagents returning options — BUT L26 permits "primary-led deep dives" for small ideas (zero subagents) | **T001** |
| 7 | (5) synthesize → big-picture phases, each a csm-plan brief | MET | L94-101 SYNTHESIZE; L122 paste-ready; L173-184 phase-brief fields | — |
| 8 | (6) devise final approach | MET | L57,L99 final SYNTHESIZE step drafts the complete approach | — |
| 9 | (7) confirm user happy with phasing + approach | MET | L103-109 CONFIRM asks directly, gates SAVED on explicit agreement | — |
| 10 | NOT linear — cycles until agreement | MET | L24,L40-46,L107 explicit cycle-back edges; CONFIRM→SAVED only on agreement | — |
| 11 | Single saved file | MET | L30,L113,L204 only persistent write is the one approach document | — |
| 12 | `.agents/` at repo home, or cwd if not a repo | MET | L113 `.agents/approaches/…` at git root, or cwd if not a git repo | decision D3 (subfolder mirrors sibling `.agents/plans/` convention; still inside `.agents/`) |
| 13 | Date-stamped + labelled markdown | MET | L113,L141-142 `<yyyy-mm-dd>-<idea-slug>-approach.md` + template date/Status | — |
| 14 | Each part paste-ready for csm-plan | MET | L8,L98,L122,L132,L146,L173-184 | — |
| 15 | Write nothing but the approach document | MET | L30,L33,L196,L205; commit carve-out justified L34 | decision D4 (file-writes, not git ops; the single sanctioned commit is scoped to the one file) |
| 16 | Temp files only in temp dir, cleaned up | MET | L31-33,L115 `mktemp -d /tmp/csm-grill-XXXXXX`, deleted before STOP + at SAVED, resume cleans leftovers | — |
| 17 | ASCII AND Mermaid phasing diagrams | MET | L105,L130,L162-171 required in body, shown at CONFIRM, present in template | (linearity note → T002 polish) |
| 18 | (quality) "relentless" operationalized, not decorative | PARTIAL | L3,L8 name it; GRILL L77-84 enforces sequencing but not anti-vagueness; L84 lets the agent park questions | **T002** |

**Tally: 16 MET, 2 PARTIAL (req 4 and 6 share one root cause → T001; req 18 → T002).**

## Current-State Evidence
- `csm-grill/SKILL.md` exists, 206 lines, committed at `2458127` (build cycle 1) with a narrative follow-up at `c3eba29`.
- The build plan `.agents/plans/2026-08-03-csm-grill-skill-csm.md` records the build as COMPLETE with all its acceptance gates green.
- `csm-grill/SKILL.md:26` (the gap): "Scale ceremony to idea size: a small, well-understood idea uses primary-led scouting and deep dives; a large or uncertain idea fans out to parallel research subagents. Proportionality reduces depth, never the required structure."
- `csm-grill/SKILL.md:72` SCOUT step 1: "Dispatch a research subagent to investigate the idea's context; for big ideas, dispatch parallel scouts per domain." (the "for big ideas" qualifier leaves small ideas ambiguous).
- `csm-grill/SKILL.md:88` DEEP_DIVE step 1: "Dispatch parallel research subagents into the user's clarifications…" (parallel implied for all, but L26 overrides toward primary-led for small ideas).
- `csm-grill/SKILL.md:84` GRILL exit: "every open decision either answered by the user or parked as an explicit open question" (agent-initiated parking).
- Contract strings that must remain intact after remediation (build plan T001 gate): frontmatter `name: csm-grill` + `description: Grill an idea…`; state line `INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP`; pinned cycle edges `DEEP_DIVE -> GRILL`, `SYNTHESIZE -> GRILL`, `CONFIRM -> GRILL`; section headers; `.agents/approaches/`; `mktemp`; `cwd`; `never invoke`; `mermaid`; `ascii`.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Activation requires an explicit ask or name invocation (not bare idea-sharing) | defensible interpretation | matches every sibling csm skill (csm-plan/build/bdd-tdd all require explicit invocation); the opencode model is invocation-based; description L3 still triggers on "shares an idea and wants to be grilled" | decided — no change |
| D2 | Brief step (1) "clarify any context" = establish the idea's context non-interactively (facts + unknowns); step (3) = question the user | defensible interpretation | the brief itself separates "clarify context" (step 1) from "get clarification from the user by asking questions" (step 3); INTAKE→GRILL realizes that split cleanly | decided — no change |
| D3 | Output path `.agents/approaches/<date>-<slug>-approach.md` satisfies "in the .agents folder" | defensible interpretation | the subfolder is inside `.agents/` and mirrors the sibling `.agents/plans/` convention; the build plan recorded this as decision A2 | decided — no change |
| D4 | "Must not write anything other than the approach document" governs file-writes; the single scoped commit at SAVED is a sanctioned git op, not a write-discipline violation | defensible interpretation | `csm-grill/SKILL.md:34` states this explicitly; mirrors csm-plan/csm-bdd-tdd SAVED convention | decided — no change |
| D5 | Scope additions not in the brief (Decisions Log, Research Synthesis, Open Questions sections in the approach doc) are kept | defensible interpretation | they support the brief's intent (decisions/options captured for csm-plan) and are mild, non-harmful structure; removing them would reduce the doc's usefulness to csm-plan | decided — no change |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Does `csm-grill/SKILL.md` conform to the user's original brief? | Independent fresh-eyes audit subagent (read-only); primary cross-checked each finding against the file | no writes; subagent read the file only | 16/17 MET, 2 PARTIAL; material gap = L26 escape hatch letting small ideas skip SCOUT/DEEP_DIVE subagents (contradicts brief steps 2 & 4); quality gap = "relentless" not operationalized + agent-initiated parking | T001 (escape hatch), T002 (relentless); defensible items recorded as D1-D5 |
| R2 | Are the defensible interpretations actually defensible? | Primary reasoning against the brief text and sibling skills (read-only) | no writes | D1-D5 each have a rationale grounded in brief text or house convention | recorded as decisions, no tasks |

## Discovered Requirements
- Both remediation tasks edit `csm-grill/SKILL.md` → overlapping write ownership → tasks must sequence (T001 then T002), never parallel.
- Contract strings (listed in Current-State Evidence) are gated by the build plan's T001 signal; remediation must not alter them. The regression gate re-runs that signal.
- Commit style: skill-prefixed (`csm-grill: …`), per house convention.

## Design
Two surgical text edits to `csm-grill/SKILL.md`, each closing one audited gap. No structural change, no new files, no contract-string edits.

### T001 — make subagent dispatch mandatory at SCOUT and DEEP_DIVE
Root cause: the "scale ceremony" rule (`csm-grill/SKILL.md:26`) lets a small idea use "primary-led scouting and deep dives," i.e. zero subagents, contradicting the brief's hard "spawn a sub agent" for steps (2) and (4).

Exact replacement text:
- L26 bullet → "Scale ceremony to idea size by varying the number and depth of research subagents — but always dispatch at least one research subagent at SCOUT and at DEEP_DIVE, never zero. Proportionality reduces depth, never the required structure."
- SCOUT step 1 (L72) → "Always dispatch at least one research subagent to investigate the idea's context; for big ideas, dispatch parallel scouts per domain."
- DEEP_DIVE step 1 (L88) → "Always dispatch at least one research subagent into the user's clarifications to deepen understanding of the ask and the direction; for big ideas, dispatch parallel subagents per theme."

### T002 — operationalize "relentless" and depict non-linear phasing
Root cause: GRILL enforces sequencing but not anti-vagueness, and L84 lets the agent park questions (opposite of relentless). The brief references Matt Pocock's "grill me" lineage, which is relentless.

Exact additions:
- GRILL: add a bullet "Drill into vague or hand-wavy answers — re-ask with a sharper recommended answer until the reply is concrete enough to act on."
- GRILL exit (L84) → "Exit: every open decision either answered concretely by the user or explicitly deferred by the user (never parked on the user's behalf)."
- Required Approach Document, Phasing item (L130) → append "Phases may run in sequence, branch, or overlap — depict the real shape, not a forced line."

## Execution Graph
- G1: T001 (edits `csm-grill/SKILL.md`).
- G2: T002 (edits `csm-grill/SKILL.md`) — depends on T001 (same file; serial ownership).
- Critical path: T001 → T002.

## Numbered Plan
1. [completed] Make subagent dispatch mandatory at SCOUT and DEEP_DIVE
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-grill/SKILL.md` (Core Rules L26 bullet, SCOUT step 1, DEEP_DIVE step 1)
   - Not in scope: any other line; contract strings; README; T002's edits
   - Spike candidate: none
   - Actions: apply the three exact text replacements in the Design (T001) section verbatim. Make no other edits.
   - Acceptance signal: `f=csm-grill/SKILL.md; ! grep -q 'primary-led scouting and deep dives' "$f" && grep -q 'always dispatch at least one research subagent' "$f" && echo PASS` → prints PASS
   - Validation: SCOUT and DEEP_DIVE step 1 each contain "Always dispatch at least one research subagent"; L26 no longer contains the escape-hatch phrase.
   - Acceptance evidence: PASS output recorded.
   - Repair attempts: 0
   - Recovery note: three localized text replacements; detect partial work by grepping for the old/new phrases and re-apply missing ones.
2. [completed] Operationalize "relentless" in GRILL and allow non-linear phasing in the template
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: `csm-grill/SKILL.md` (GRILL bullets + exit line; Required Approach Document Phasing item)
   - Not in scope: any other line; contract strings; README; T001's edits
   - Spike candidate: none
   - Actions: apply the exact additions in the Design (T002) section verbatim — add the "Drill into vague or hand-wavy answers…" bullet to GRILL; replace the GRILL exit line with the "explicitly deferred by the user" wording; append the "branch, or overlap" sentence to the Phasing item. Make no other edits.
   - Acceptance signal: `f=csm-grill/SKILL.md; grep -qi 'drill into vague or hand-wavy' "$f" && grep -q 'explicitly deferred by the user' "$f" && grep -qi 'branch, or overlap' "$f" && echo PASS` → prints PASS
   - Validation: GRILL has the drilling bullet and the user-only-deferral exit; the Phasing item notes non-linear shapes.
   - Acceptance evidence: PASS output recorded.
   - Repair attempts: 0
   - Recovery note: three localized text additions; detect partial work by grepping for the pinned phrases and re-apply missing ones.

## Verification Strategy
Per-task fast gates: the T001 and T002 grep signals (seconds). Regression gate (run after T002, cheapest-first): re-run the build plan's T001 contract-string signal to prove no contract string (frontmatter, state line, cycle edges, section headers, `.agents/approaches/`, `mktemp`, `cwd`, `never invoke`, `mermaid`, `ascii`) was broken —
`f=csm-grill/SKILL.md; test -f "$f" && head -1 "$f" | grep -qx -- '---' && head -4 "$f" | grep -qx 'name: csm-grill' && grep -q '^description: Grill an idea' "$f" && grep -qF 'INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP' "$f" && for e in 'DEEP_DIVE -> GRILL' 'SYNTHESIZE -> GRILL' 'CONFIRM -> GRILL'; do grep -qF "$e" "$f" || exit 1; done && for s in INTAKE SCOUT GRILL DEEP_DIVE SYNTHESIZE CONFIRM SAVED STOP; do grep -q "$s" "$f" || exit 1; done && for sec in 'Activation Boundary' 'Core Rules' 'Write Discipline' 'State Machine' 'Approach Document' 'Anti-Patterns' 'Done Criteria' 'csm-plan' '.agents/approaches/' 'mktemp' 'cwd'; do grep -q "$sec" "$f" || exit 1; done && grep -qi 'never invoke' "$f" && grep -qi 'mermaid' "$f" && grep -qi 'ascii' "$f" && echo REGRESSION-PASS`
Final gate: line count still 180–280 (`wc -l`); `git status --porcelain` shows only `csm-grill/SKILL.md` (and the plan file) changed by the execution. No test suites exist for orchestration skills.

## Risks And Recovery
- Escaping the contract strings while editing — mitigated by the regression gate (re-runs the build signal); recovery = restore the pinned string from the build plan.
- Over-editing beyond the two gaps — mitigated by "make no other edits" in each task; recovery = revert the extra edit.
- Same-file sequencing hazard (T001/T002) — mitigated by the explicit G1→G2 dependency; recovery = re-apply the later task's edits if clobbered.

## Critique Resolution
| Finding (primary self-critique of this plan) | Severity | Resolution | Evidence |
|---|---|---|---|
| Are the 2 tasks genuinely independent of the 5 defensible interpretations, or did the plan quietly defer real gaps? | major (self-raise) | Re-checked D1-D5 against the brief text and siblings: D1 matches sibling invocation model; D2 reflects the brief's own step-1-vs-step-3 split; D3/D4 mirror build-plan decisions A2/A3 already accepted by the user; D5 is mild, useful structure. None hides a brief violation. Recorded, not tasked. | D1-D5; brief text |
| Should T001/T002 be one task (same file) instead of two? | minor | Kept as two for traceability (distinct findings → distinct gates), with an explicit G1→G2 dependency to handle same-file ownership. csm-plan permits sequenced atomic tasks. | Execution Graph |
| Is "always dispatch at least one research subagent" too rigid (forces a subagent even for a trivial idea)? | minor | It honors the brief's unqualified "spawn a sub agent" for steps 2 and 4; the number/depth still scales. This is the brief's intent, not over-engineering. | brief steps (2),(4) |
| Does the regression gate actually cover all contract strings? | minor | It is the verbatim build-plan T001 signal, which the build verified green; it covers frontmatter, state line, cycle edges, sections, and all grepped tokens. | Verification Strategy |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | START -> INTAKE | — | Brief distilled to 17 requirements; goal = verification + remediation for gaps; small/medium prescriptive ask | DISCOVER |
| 2026-08-03 | 0 | INTAKE -> DISCOVER | — | Skill content and build-plan status known; brief and siblings known | RESEARCH |
| 2026-08-03 | 0 | DISCOVER -> RESEARCH | — | Independent fresh-eyes audit subagent (R1) returned a 17-row evidence map: 16 MET, 2 PARTIAL; primary cross-checked each finding against the file (R2) | DRAFT |
| 2026-08-03 | 0 | RESEARCH -> DRAFT | — | Evidence map + 2 remediation tasks (T001 escape-hatch, T002 relentless+phasing) + D1-D5 decisions drafted | CRITIQUE |
| 2026-08-03 | 0 | DRAFT -> CRITIQUE | — | Primary self-critique (small plan): 4 findings, all resolved (see Critique Resolution); no redesign | REMEDIATE |
| 2026-08-03 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | — | Surgical edits to plan text only; verified template sections complete; tasks have runnable signals + regression gate; G1→G2 dependency correct | SAVED |
| 2026-08-03 | 0 | VERIFY -> SAVED | — | Plan saved to `.agents/plans/2026-08-03-csm-grill-brief-conformance-csm.md`; committed as `plan: csm-grill brief-conformance verification` staging only the plan file | STOP |
| 2026-08-03 | 1 | NOT_STARTED -> RECOVER | — | Explicit csm-build invocation. Working tree clean; no NORMS.md; both gap phrases confirmed present (`SKILL.md:26` escape hatch, `SKILL.md:84` agent-parked questions); both tasks pending | VALIDATE |
| 2026-08-03 | 1 | RECOVER -> VALIDATE | — | Exact text of the 5 edit lines confirmed; regression baseline re-run → REGRESSION-BASELINE-PASS (all contract strings intact before edits). Plan not stale | SELECT |
| 2026-08-03 | 1 | VALIDATE -> SELECT | T001 | Ready set = {T001} (T002 depends on T001 — same file, serial). Both tasks are 3 trivial text replacements each; primary-led implementation chosen per csm-build lightweight path (small low-risk batch, shared-file ownership, and this session's subagent runtime has returned empty twice) | DISPATCH |
| 2026-08-03 | 1 | DISPATCH -> INTEGRATE -> VERIFY | T001, T002 | T001 applied (L26 + SCOUT step 1 + DEEP_DIVE step 1) → T001-PASS; T002 applied (GRILL step 5 + new Exit + Phasing note) → T002-PASS. Regression gate → REGRESSION-PASS. `wc -l` = 207 (budget 180–280) | REVIEW |
| 2026-08-03 | 1 | VERIFY -> REVIEW | T001, T002 | Primary self-review of own edits: read all 5 changed regions — prose consistent with surroundings, no broken markdown, contract strings untouched. No findings | CHECKPOINT |
| 2026-08-03 | 1 | REVIEW -> CHECKPOINT -> COMPLETE | T001, T002 | Completion gate passed (all 8 checks). Committing `csm-grill/SKILL.md` + plan update; nothing pushed | COMPLETE (terminal) |

## Completion Review
- **Goal met**: Yes. Both brief-conformance gaps closed in `csm-grill/SKILL.md`.
- **T001 (reqs 4 & 6)**: the L26 escape hatch ("primary-led scouting and deep dives") is gone; SCOUT and DEEP_DIVE now "always dispatch at least one research subagent." A small idea can no longer skip the subagents the brief mandates for steps (2) and (4); only the number/depth of subagents scales with idea size.
- **T002 (req 18)**: GRILL gained step 5 ("Drill into vague or hand-wavy answers…") and the Exit line now requires the *user* to explicitly defer ("never parked on the user's behalf") — "relentless" is operationalized, not decorative. The Phasing template item now notes phases "may run in sequence, branch, or overlap."
- **Acceptance evidence**: T001-PASS, T002-PASS, REGRESSION-PASS (build contract-string signal still green — frontmatter, state line, cycle edges, section headers, `.agents/approaches/`, `mktemp`, `cwd`, `never invoke`, `mermaid`, `ascii` all intact), `wc -l` = 207 (within 180–280).
- **Conformance**: the verification plan's evidence map now has all 17 requirements at MET (reqs 4, 6, and 18 moved from PARTIAL to MET). The 5 defensible interpretations (D1–D5) stand unchanged.
- **Commits**: this cycle stages only `csm-grill/SKILL.md` and this plan file; nothing pushed.
- **Limitation**: primary self-review only (authorship + review by the same agent); acceptable for low-risk docs-only edits under csm-build's lightweight path, less independent than a fresh-eyes reviewer.
