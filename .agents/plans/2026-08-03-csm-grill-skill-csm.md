# csm-grill Skill (First Cut) CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 3 tasks, all low risk (documentation-only: one new SKILL.md, one README edit, one review pass). No security, data, destructive, or public-interface impact; primary self-review acceptable per csm-build's lightweight path, but T003 mandates one fresh-eyes review subagent because this skill is the entry point to the whole CSM workflow.

## Control
- Plan ID: csm-grill-skill
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-03 — plan drafted, critiqued (12 findings), remediated, verified; not started
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Create a first cut of a new OpenCode skill named `csm-grill` in this repository, along the lines of the existing csm-* skills and based on Matt Pocock's "grill me" skill. When a user shares an idea, the skill runs a cyclic (not linear) state machine that: (1) clarifies context the idea needs; (2) spawns a research subagent to identify areas needing clarification; (3) grills the user with questions; (4) spawns deep-research subagents into the user's clarifications to understand the ask and surface further options; (5) synthesizes everything into a big-picture phased proposal where each phase is a brief for a future csm-plan activity; (6) devises the final approach from the answers; (7) confirms phasing and approach with the user — cycling until the user explicitly agrees. On agreement it saves exactly one dated, labelled Markdown approach document in `.agents/` at the repo root (or cwd if not a repo), containing ASCII and Mermaid diagrams of the agreed phasing.

Deliverables: `csm-grill/SKILL.md` (new); `README.md` (updated to cover the new skill).
Constraints: house style of sibling skills (csm-plan, csm-build, csm-bdd-tdd — single-file SKILL.md, frontmatter `name` + `description`, boundary section, core rules, uppercase state machine with numbered per-state steps, terminal SAVED/STOP); Matt Pocock grilling mechanics (relentless, one question at a time, recommended answer per question, facts looked up rather than asked, decisions owned by the user, no action until shared understanding is confirmed); strict write discipline inside the designed skill (the only persistent write is the single approach document; temp files only in a fresh temp dir, cleaned up; never invokes csm-plan or csm-build).
Exclusions: no scripts, tests, or supporting files for csm-grill (sibling orchestration skills have none); no changes to any other skill; no implementation of the skill's runtime behavior (this plan builds the skill document only); no touching the pre-existing dirty csm-scan working-tree files; no README rewrite beyond adding csm-grill.

## Acceptance Criteria
1. `csm-grill/SKILL.md` exists with valid sibling-style frontmatter (`name: csm-grill`, a trigger-rich model-invoked `description`) and a body containing: activation boundary, core rules, the cyclic state machine `INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP` with explicit cycle-back transitions, write-discipline rules, the required approach-document template (including ASCII and Mermaid phasing diagrams and per-phase csm-plan briefs), anti-patterns, and done criteria. Evidence: grep gate (defined in T001) passes.
2. The SKILL.md demonstrably encodes all seven prescribed behaviors from the brief and the cyclic-until-agreed requirement: each maps to a named state or rule per the mapping table in this plan's Design section. Evidence: T003 review confirms every mapping row is present in the written skill, and T001's gate greps the pinned state line and cycle-edge strings.
3. `README.md` covers csm-grill: workflow Mermaid diagram shows csm-grill upstream of csm-plan, skills table has a csm-grill row linking to `csm-grill/SKILL.md` whose purpose text begins with the pinned leading clause, a `### csm-grill` usage subsection exists, the table of contents links it, the installation "need no further setup" list includes it, the repository-layout section lists `csm-grill/`, and prose stating the skill count ("six") is corrected to seven. Evidence: grep gate (defined in T002) passes; README-referenced path existence is checked at the final gate.
4. The execution changes exactly two paths — new `csm-grill/SKILL.md` and modified `README.md` (plus this plan file's own updates). Pre-existing csm-scan working-tree modifications are untouched and never staged. Evidence: `git status --porcelain` recorded at completion and compared against the baseline in Current-State Evidence; commit(s) stage only the two deliverables.
5. SKILL.md line budget: 180–280 lines (orchestration siblings run 225–261). Evidence: `wc -l` recorded.

## Current-State Evidence
- Repo root listing (2026-08-03): six skill dirs (`csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-scan`, `csm-browse`, `csm-upload`), `README.md`, `.gitignore` (`node_modules/` only), `.agents/plans/` with one existing plan. No `AGENTS.md`.
- Sibling orchestration skills are single-file skills: `csm-plan/SKILL.md` (231 lines), `csm-build/SKILL.md` (225 lines), `csm-bdd-tdd/SKILL.md` (261 lines); frontmatter is exactly `name` + `description`; each has an activation/planning boundary section, core rules, a state machine line like `INTAKE -> DISCOVER -> ... -> SAVED -> STOP`, numbered per-state steps, and terminal-state display-and-stop rules.
- `csm-plan/SKILL.md:142`: plans save to `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md` at repo root and are committed at SAVED unless the user declines — the house convention the csm-grill output rule mirrors.
- Matt Pocock `grill-me/SKILL.md` (raw.githubusercontent.com/mattpocock/skills/main, fetched 2026-08-03): frontmatter `name: grill-me`, `disable-model-invocation: true`; body delegates to `/grilling`.
- Matt Pocock `grilling/SKILL.md` (same source): "Interview me relentlessly … Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time, waiting for feedback on each question before continuing. … If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer. Do not act on it until I confirm we have reached a shared understanding."
- Matt Pocock `writing-great-skills/SKILL.md` (same source): predictability as root virtue; checkable completion criteria; leading words; prune no-ops and duplication; avoid negation-based steering where a positive statement works.
- `README.md` current state: intro paragraph enumerates the six skills by name in two parenthetical groups (line 3); workflow Mermaid starts at csm-scan (lines 24-31); skills table has six rows (lines 39-46); usage has six subsections with TOC entries (lines 12-17); installation says "copy the six skill folders" (line 57); the "need no further setup" sentence at line 63 names five skills; repo layout lists six skill dirs (lines 125-140).
- `git status --porcelain` (2026-08-03, before planning): 8 modified files (`csm-scan/lib/scan/deep/architecture.mjs`, `csm-scan/lib/scan/deep/practices/model.mjs`, `csm-scan/lib/scan/deep/testing.mjs`, `csm-scan/lib/scan/render/architecture-craft.mjs`, `csm-scan/lib/scan/render/config.mjs`, `csm-scan/lib/scan/render/maintainability.mjs`, `csm-scan/lib/scan/render/testing.mjs`, `csm-scan/test/config.test.mjs` plus `csm-scan/test/expansion-architecture-extension.test.mjs`, `csm-scan/test/expansion-maintainability.test.mjs`, `csm-scan/test/testing.test.mjs`) and 1 untracked (`csm-scan/lib/scan/deep/practices/style.mjs`) — all pre-existing, not caused by this planning session; must remain untouched and unstaged by execution. Re-checked after planning: identical.
- `git log --oneline`: plan commits use the style `plan: <goal>` (e.g. `813131a plan: csm-scan comprehensive style guide and conventions`); skill commits are skill-prefixed.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | csm-grill is model-invoked like every sibling csm skill (frontmatter `name` + trigger-rich `description`, no `disable-model-invocation`) | user-dictated pattern | "along the lines of my other opencode csm skills"; no sibling uses disable-model-invocation | decided |
| A2 | Approach documents save to `.agents/approaches/<yyyy-mm-dd>-<idea-slug>-approach.md` at the git root, or cwd when not in a repo | design decision | user prescribed ".agents folder … date stamped and labelled md approach document"; mirrors csm-plan's `.agents/plans/` convention | decided |
| A3 | The designed skill commits the approach document at SAVED unless the user declines, skipping the commit when not in a git repo; the skill's Write Discipline section states explicitly that this single optional commit is the only sanctioned git mutation and is not a write-discipline violation | design decision | house convention from csm-plan SAVED and csm-bdd-tdd SAVED | decided |
| A4 | State names are `INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP`; the states plus the cycle rules cover the brief's seven prescribed steps and the cyclic requirement per the mapping table in Design | design decision | house style (uppercase state names); mapping table resolves step 6 to the final SYNTHESIZE step, presented at CONFIRM | decided |
| A5 | csm-grill keeps no durable control file mid-session; the conversation plus an optional temp-dir journal carries state, preserving the "write nothing but the approach document" rule; the skill carries a best-effort clause to clean a leftover temp dir when a session resumes after interruption | design decision | user's strict write discipline; grilling sessions are conversational, unlike multi-day builds | decided |
| A6 | Exact frontmatter description and other contract strings (state names, state line, three pinned cycle edges, section headers, README leading clause) are fixed in this plan's Design so T001 and T002 have disjoint scopes and can run in parallel; pruning during T001 never touches contract strings | decision | enables safe G1 parallelism; final gate greps the pinned leading clause in both files | decided |
| A7 | First cut has no scripts/tests; validation is grep-based structural gates plus a fresh-eyes review task | decision | sibling orchestration skills (plan/build/bdd-tdd) ship SKILL.md only | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What do Matt Pocock's grill-me / grilling skills actually prescribe? | webfetch of raw SKILL.md files (read-only GET) | no writes; network read-only | grill-me delegates to grilling: relentless interview; one question at a time; recommended answer per question; facts from environment, decisions from user; act only after confirmed shared understanding | GRILL state encodes these exact mechanics; CONFIRM/SAVED encode "act only after confirmation" |
| R2 | What makes a skill well-written per Matt Pocock? | webfetch of writing-great-skills SKILL.md (read-only GET) | no writes | predictability; checkable completion criteria; leading words; prune no-ops/duplication; prefer positive phrasing | T001 actions include a pruning pass over body prose; state steps end with checkable exit criteria |
| R3 | What is the house skeleton of a csm skill? | Read csm-plan, csm-build, csm-bdd-tdd SKILL.md (read-only) | no writes | frontmatter name+description; boundary section; core rules; state machine line + numbered states; SAVED commits and displays; anti-patterns/done-criteria sections in bdd-tdd | Design mirrors this skeleton exactly |
| R4 | Where do csm artifacts live and are they committed? | csm-plan SKILL.md SAVED section; existing `.agents/plans/` dir; git log | read-only | `.agents/plans/<date>-<slug>-csm.md`, committed at SAVED with `plan: <goal>` style messages | csm-grill output mirrors: `.agents/approaches/<date>-<slug>-approach.md`, commit at SAVED unless declined |
| R5 | Does the repo have AGENTS.md or other agent instructions? | root listing | read-only | none | no extra instructions to obey |
| R6 | Working tree safety | `git status --porcelain` before and after planning | baseline captured; post-planning re-check identical | 11 modified + 1 untracked under `csm-scan/`, all pre-existing | execution stages only the two deliverables; completion gate compares against this baseline |

## Discovered Requirements
- Pre-existing dirty working tree under `csm-scan/` (11 modified, 1 untracked — exact paths in Current-State Evidence). Execution must never stage, commit, revert, or edit those paths. Acceptance criterion 4 checks this.
- `.gitignore` covers only `node_modules/` — `csm-grill/`, `README.md`, and `.agents/` are all trackable.
- README count/list touchpoints (all must include csm-grill after the edit): intro paragraph skill groups (line 3), skills table, TOC usage links (lines 12-17), "copy the six skill folders" (line 57), "need no further setup" list (line 63), repository layout (lines 125-140).
- OpenCode discovers skills on restart (`README.md:63` "Restart OpenCode so it picks up the skills") — csm-grill becomes invocable after a restart; worth a closing note to the user at SAVED, not a build step.
- Commit style for plans: `plan: <goal>`; skill commits: `csm-grill: ...` prefix fits house style.
- Markdown must be GitHub-renderable; Mermaid fenced blocks acceptable (README already uses one).

## Design

### Contract strings (pinned; exempt from pruning — A6)

Frontmatter (exact text, also the source of T002's README row):

```
---
name: csm-grill
description: Grill an idea into an agreed, phased approach document — a relentless one-question-at-a-time interview backed by research subagents, cycling until the user agrees, then saving a single dated approach doc under .agents/approaches whose phases are ready-made briefs for future csm-plan invocations; use when the user shares an idea and wants to be grilled, interviewed, or stress-tested before any planning. Never plans or implements.
---
```

State line (exact): `INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP`

Pinned cycle edges (exact strings the T001 gate greps): `DEEP_DIVE -> GRILL`, `SYNTHESIZE -> GRILL`, `CONFIRM -> GRILL`

README leading clause (exact; opens the T002 table-row purpose and is grepped in both files at the final gate): `Grill an idea into an agreed, phased approach`

### Mapping table — brief steps to states (transcribed into SKILL.md; T003 checks every row)

| Brief step (user prescription) | State / rule |
|---|---|
| (1) clarify any context needed for the idea | INTAKE |
| (2) spawn a subagent to research and identify areas needing clarification | SCOUT |
| (3) get clarification from the user by asking questions | GRILL |
| (4) subagent deep research into the user's clarifications → understand the ask + further options | DEEP_DIVE |
| (5) synthesize → big-picture plan of parts, each a brief for a future csm-plan activity | SYNTHESIZE |
| (6) understand the answers and devise the final approach | final SYNTHESIZE step (draft the approach); presented at CONFIRM |
| (7) confirm the user is happy with phasing and approach | CONFIRM |
| cyclic, not linear, until the user agrees | cycle rules |
| save the agreed approach to a single dated document in `.agents/` | SAVED |

### The skill being built

**File**: `csm-grill/SKILL.md` — single-file skill, no scripts. Line budget 180–280 (A5/A7 keep it lean).

**Body skeleton** (mirrors the sibling skeleton):

1. `# CSM Grill` intro paragraph: turn a rough idea into an agreed, phased approach through a relentless, research-backed interview; the output is a single approach document whose phases are briefs for future, separately invoked csm-plan sessions; never plans, never implements, never invokes csm-plan or csm-build.
2. `## Activation Boundary` — activate when the user shares an idea and asks to be grilled or invokes csm-grill; the approach document is not a plan and authorizes nothing; SAVED is terminal — display and stop.
3. `## Core Rules` — primary owns orchestration, synthesis, and state transitions; subagents are read-only researchers; facts are looked up (environment/web), decisions belong to the user; one question at a time, each with a recommended answer; cyclic not linear — keep cycling until explicit agreement; write discipline (below); scale ceremony to idea size (small idea: primary-led scouting and deep dives; large idea: parallel subagents).
4. `## Write Discipline And Temp Files` — the only persistent write is the single approach document; temporary files only inside a freshly created isolated temp dir (e.g. `mktemp -d /tmp/csm-grill-XXXXXX`), never in the repo, deleted before STOP, with best-effort cleanup of any leftover temp dir when a session resumes after interruption; research subagents are read-only and receive the same rule; never write plans, specs, code, or docs. One clarifying sentence: the optional approach-document commit at SAVED (skipped when the user declines or the directory is not a git repo) is the only sanctioned git mutation and is not a write-discipline violation.
5. `## Grilling State Machine` — the pinned state line; cycle rules: GRILL -> DEEP_DIVE when an answer surfaces researchable uncertainty; DEEP_DIVE -> GRILL when research surfaces new user decisions; SYNTHESIZE -> GRILL when synthesis exposes unresolved decisions; CONFIRM -> GRILL (open questions), CONFIRM -> DEEP_DIVE (evidence/options gap), or CONFIRM -> SYNTHESIZE (re-phase) when the user is not happy; CONFIRM -> SAVED only on explicit user agreement. Then the mapping table above, then numbered per-state steps, each ending in a checkable exit criterion:
   - **INTAKE**: restate the idea as understood; harvest discoverable facts from the environment (repo, docs, web) with tools — never ask the user for what can be looked up; list what is still unknown. Exit: idea restated, fact base gathered, unknowns listed.
   - **SCOUT**: dispatch a research subagent (parallel scouts per domain for big ideas) to investigate the idea's context and return: assumptions, unknowns that could invalidate the idea, ambiguities and conflicts, and a ranked list of areas needing user clarification with suggested questions. Exit: ranked clarification-area list in hand.
   - **GRILL**: interview the user one question at a time, in decision-tree dependency order, each question with a recommended answer; wait for each answer before the next; walk every branch. Route to DEEP_DIVE when an answer raises researchable uncertainty. Exit: every open decision either answered by the user or parked as an explicit open question.
   - **DEEP_DIVE**: dispatch parallel research subagents into the user's clarifications to deepen understanding of the ask and direction and return further options with trade-offs; then back to GRILL with anything the user must decide. Exit: research synthesized into options and implications.
   - **SYNTHESIZE**: primary-only. Produce the proposed approach: refined idea statement, decision log, chosen options with rationale, and the phased big picture — a small number of phases, each written as a brief for a future csm-plan invocation (goal, scope, constraints, acceptance hints, dependencies). Final step: draft the complete final approach (brief step 6). Exit: complete draft approach ready to present.
   - **CONFIRM**: present the phasing and approach with the ASCII and Mermaid view; ask directly whether the user is happy; route dissatisfaction back per the cycle rules; loop until explicit agreement. Exit: user explicitly agrees.
   - **SAVED**: write `.agents/approaches/<yyyy-mm-dd>-<idea-slug>-approach.md` (git root, or cwd if not a git repo); commit it unless the user declined or not a git repo; delete the temp dir; display the document and path; stop — never invoke csm-plan or csm-build.
6. `## Required Approach Document` — template: title + idea slug + date + `Status: agreed`; agreed idea statement; decisions log (question, answer, rationale); research synthesis (findings, options, choices); **Phasing** with both an ASCII diagram and a Mermaid diagram of phases and dependencies; **Phase briefs** — each: title, goal, deliverables, scope/out-of-scope, constraints, acceptance-criteria hints, dependencies on other phases, context pointers — written to paste straight into a csm-plan invocation, at big-part granularity (task decomposition is csm-plan's job, never csm-grill's); how-to-execute note (each phase brief goes to its own explicit csm-plan invocation); open questions and rejected options.
7. `## Anti-Patterns` — question batching (bewildering); asking for facts the environment can supply; linear single-pass with no cycle; writing anything but the approach document; plan-grade task detail in phase briefs; invoking csm-plan or csm-build; presenting options without a recommendation.
8. `## Done Criteria` — user explicitly agreed to phasing and approach; exactly one approach document saved and displayed; temp dir deleted; nothing else written; no plan or implementation started.

### README changes (T002)
- Intro paragraph (line 3): add `csm-grill` as the upstream idea-grilling entry point of the CSM workflow (edit the first parenthetical group; keep the sentence structure).
- Workflow Mermaid (lines 24-31): add a `grill["csm-grill<br/>idea → agreed phased approach"]` node with a dotted edge labelled "phase briefs" into `plan`, styled like the optional scan edge.
- Skills table: add a csm-grill row whose purpose begins with the pinned leading clause, linking `csm-grill/SKILL.md`.
- TOC (lines 12-17): add `- [csm-grill](#csm-grill)` in the usage list.
- Usage: new `### csm-grill` subsection — invoke by name with an idea; output path pattern `.agents/approaches/<yyyy-mm-dd>-<idea-slug>-approach.md`; note it never plans or implements and that phases feed future csm-plan invocations.
- Installation (line 57): "copy the six skill folders" → seven; (line 63): add `csm-grill` to the "need no further setup" list.
- Repository layout: add `├── csm-grill/         # SKILL.md — the idea-grilling interview` and keep alignment.

## Execution Graph
- G1 (parallel, genuinely disjoint scopes): T001 (writes new `csm-grill/SKILL.md`) ∥ T002 (edits `README.md` only). No dependency: all contract strings T002 needs (frontmatter description, leading clause, paths) are pinned in this plan; T002's gate checks README content only, never T001's file.
- G2: T003 (fresh-eyes review + polish of both deliverables) after G1.
- Critical path: G1 → G2.

## Numbered Plan
1. [pending] Author `csm-grill/SKILL.md`
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `csm-grill/SKILL.md` (new file, new directory)
   - Not in scope: `README.md`; any other skill; scripts/tests; the pre-existing dirty `csm-scan/` files
   - Spike candidate: none — design fully determined by this plan
   - Actions: create `csm-grill/` and write SKILL.md following the Design section: exact pinned frontmatter; the pinned state line and cycle rules; the mapping table transcribed verbatim; per-state numbered steps each ending in a checkable exit criterion; write-discipline rules including the sanctioned-commit clarification and best-effort temp cleanup; approach-document template with ASCII + Mermaid phasing diagrams and the per-phase csm-plan brief contract; anti-patterns; done criteria. Prune per writing-great-skills (no no-op sentences, no duplication, positive phrasing, leading words: grill, cycle, phase brief) — body prose only; contract strings (frontmatter, state names, state line, pinned cycle edges, section headers, template field names) are exempt from pruning and rewording. Stay within 180–280 lines.
   - Acceptance signal: `f=csm-grill/SKILL.md; test -f "$f" && head -1 "$f" | grep -qx -- '---' && head -4 "$f" | grep -qx 'name: csm-grill' && grep -q '^description: Grill an idea' "$f" && grep -qF 'INTAKE -> SCOUT -> GRILL -> DEEP_DIVE -> SYNTHESIZE -> CONFIRM -> SAVED -> STOP' "$f" && for e in 'DEEP_DIVE -> GRILL' 'SYNTHESIZE -> GRILL' 'CONFIRM -> GRILL'; do grep -qF "$e" "$f" || exit 1; done && for s in INTAKE SCOUT GRILL DEEP_DIVE SYNTHESIZE CONFIRM SAVED STOP; do grep -q "$s" "$f" || exit 1; done && for sec in 'Activation Boundary' 'Core Rules' 'Write Discipline' 'State Machine' 'Approach Document' 'Anti-Patterns' 'Done Criteria' 'csm-plan' '.agents/approaches/' 'mktemp' 'cwd'; do grep -q "$sec" "$f" || exit 1; done && grep -qi 'never invoke' "$f" && grep -qi 'mermaid' "$f" && grep -qi 'ascii' "$f" && echo PASS` → prints PASS
   - Validation: `wc -l csm-grill/SKILL.md` within 180–280; balanced code fences (even count of ` ``` ` lines); mapping table rows match the Design table verbatim.
   - Acceptance evidence: PASS output, wc -l count, fence-count parity, mapping-table check recorded in the plan journal.
   - Repair attempts: 0
   - Recovery note: the file either exists with full content or not; if partial, rewrite wholesale from the Design section — no incremental state to preserve.
2. [pending] Update `README.md` for csm-grill
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: `README.md` only
   - Not in scope: `csm-grill/SKILL.md`; any skill body; restructuring README beyond the listed edits
   - Spike candidate: none
   - Actions: apply exactly the README changes listed in Design → README changes: intro paragraph, workflow Mermaid node + dotted "phase briefs" edge, skills table row opening with the pinned leading clause and linking `csm-grill/SKILL.md`, TOC entry `- [csm-grill](#csm-grill)`, new `### csm-grill` usage subsection, "six skill folders" → "seven skill folders", add `csm-grill` to the "need no further setup" list, repository-layout entry. Match existing tone and table formatting; keep quickstart-level and link to SKILL.md for depth. Contract strings (leading clause, paths, anchor) are used verbatim from Design.
   - Acceptance signal: `grep -q 'csm-grill' README.md && grep -q 'csm-grill/SKILL.md' README.md && grep -q '### csm-grill' README.md && grep -q '(#csm-grill)' README.md && grep -qF 'Grill an idea into an agreed, phased approach' README.md && ! grep -q 'six skill' README.md && echo PASS` → prints PASS
   - Validation: Mermaid block still well-formed (even ` ``` ` fence count over README.md); skills table now has 7 rows (count `| \`csm-` occurrences); the "need no further setup" sentence names csm-grill.
   - Acceptance evidence: PASS output, fence count, 7-row table check recorded.
   - Repair attempts: 0
   - Recovery note: README edits are idempotent textual insertions; detect partial work by grepping for the added markers and re-apply only the missing ones.
3. [pending] Fresh-eyes fidelity review and polish
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G2
   - Risk: low
   - Owned scope: `csm-grill/SKILL.md`, `README.md`
   - Not in scope: any other file; redesigning the skill (design is fixed by this plan — reviewer flags drift, does not redesign)
   - Spike candidate: none
   - Actions: dispatch one review subagent (did not author T001/T002) with: the seven prescribed behaviors + cyclic requirement from the user's brief, this plan's Design section including contract strings and mapping table, Matt Pocock's grilling mechanics (quoted in Current-State Evidence), and sibling skills csm-plan/csm-bdd-tdd for style parity. Require findings citing file:line, severity, and a concrete correction for: any prescribed behavior missing or diluted; missing cycle-back transitions; write-discipline holes (including the cwd fallback, temp cleanup, and never-invoke rule); missing ASCII/Mermaid/phasing or csm-plan-brief requirements in the template; contract-string drift from the pinned Design text; style drift from siblings; no-op or duplicated prose. Primary triages all findings and applies valid corrections with recorded reasoning.
   - Acceptance signal: re-run the T001 and T002 acceptance signals after corrections; both print PASS
   - Validation: primary reads the final SKILL.md end-to-end once, checking every Design mapping-table row against the brief's seven steps and the cyclic rule.
   - Acceptance evidence: review report (every checklist item pass or corrected), findings with resolutions, re-run PASS outputs recorded.
   - Repair attempts: 0
   - Recovery note: corrections are small text edits; if SKILL.md becomes inconsistent, regenerate from the Design section and re-run the review checklist.

## Verification Strategy
Per-task fast gates (cheapest first, seconds to run): T001 and T002 grep-based structural signals; fence-parity and line-count checks; mapping-table verbatim check. Batch gate at T003: independent review plus re-run of both grep gates. Final gate (csm-build completion): all acceptance criteria have recorded evidence; every README-referenced path exists on disk (`test -f csm-grill/SKILL.md` plus the six pre-existing skill links); the pinned leading clause `Grill an idea into an agreed, phased approach` is present verbatim in both `csm-grill/SKILL.md` and `README.md` (`grep -F`); `git status --porcelain` shows only `csm-grill/SKILL.md` (new), `README.md` (modified), and this plan file changed by this execution against the pre-existing csm-scan dirty baseline; commits staged only those paths. No test suites exist for orchestration skills (A7), so no slower layers apply. Environment-sensitive checks: none.

## Risks And Recovery
- Prescription drift — the written skill drops or dilutes one of the seven prescribed behaviors or the cyclic-until-agreed rule. Mitigation: the Design mapping table is the transcription source; T001's gate greps the pinned state line and cycle edges; T003 checks each row explicitly. Recovery: correct SKILL.md from the mapping table and re-run gates.
- Contract-string drift — pruning or rewording alters pinned strings, breaking T001∥T002 consistency. Mitigation: A6 exemption recorded in T001 actions; pinned strings in Design; final gate greps the leading clause in both files. Recovery: restore pinned strings from Design, re-run gates.
- Sprawl — SKILL.md bloats past the line budget. Mitigation: 180–280 budget in T001 with pruning rules. Recovery: prune per writing-great-skills and re-run gates.
- Dirty-tree contamination — execution stages pre-existing csm-scan modifications. Mitigation: baseline recorded in Current-State Evidence; commits stage only the two deliverables. Recovery: unstage (never revert) and re-stage correctly; report to user.
- README incompleteness — a count/list/TOC touchpoint missed. Mitigation: Discovered Requirements enumerates every touchpoint; T002's gate and validation check them. Recovery: apply the missing edit, re-run gate.
- Over-engineering the skill — adding scripts, harnesses, or resume machinery the user didn't ask for. Mitigation: A5/A7 record the deliberate simplicity; T003 flags speculative structure. Recovery: remove it.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| 1. Plan missing Critique Resolution, Progress Journal, Completion Review sections; Control checkpoint claim unevidenced | critical | All three sections added to this plan; Control checkpoint now matches the journal's recorded transitions | this document's final three sections and Progress Journal |
| 2. T002 acceptance signal contained `test -f csm-grill/SKILL.md`, falsifying the G1 no-dependency claim | major | Cross-task check removed from T002's signal; README-referenced path existence moved to the final gate in Verification Strategy; AC3 evidence reworded to match | T002 signal; Verification Strategy final gate; AC3 |
| 3. AC2 cited a mapping table absent from Design; A4's "1:1" claim arithmetically false (7 steps vs 6 non-terminal states; step 6 homeless) | major | Real 9-row mapping table added to Design (steps 1-7 + cyclic rule + save); step 6 resolved to the final SYNTHESIZE step presented at CONFIRM; A4 reworded to "states plus cycle rules cover the seven steps … per the mapping table" | Design mapping table; A4 |
| 4. No gate verified the cyclic requirement — a linear SKILL.md would pass T001 | major | T001 signal now greps the full pinned state line and the three pinned cycle edges (`DEEP_DIVE -> GRILL`, `SYNTHESIZE -> GRILL`, `CONFIRM -> GRILL`), with exact strings pinned in Design | T001 signal; Design contract strings |
| 5. README edit list omitted the TOC and the line-63 "need no further setup" list | major | Both added to Design → README changes and T002 actions; `grep -q '(#csm-grill)'` added to T002's signal; Discovered Requirements now enumerates every README touchpoint with line numbers | Design README changes; T002; Discovered Requirements |
| 6. "Write per Design exactly" vs "prune" instruction conflict; A6 parallelism contract unenforced | minor | T001 actions now state pruning applies to body prose only and contract strings are exempt; final gate greps the pinned leading clause in both files | T001 actions; A6; Verification Strategy |
| 7. Skill's "write nothing but the approach document" vs its own SAVED commit step — apparent contradiction | minor | Design Write Discipline now carries the clarifying sentence: the optional SAVED commit is the only sanctioned git mutation and not a write-discipline violation | Design §4; A3 |
| 8. T003 acceptance signal partially non-runnable | minor | Signal split: runnable core = re-run of T001+T002 gates printing PASS; review checklist demoted to required acceptance evidence | T003 signal and evidence fields |
| 9. Gate coverage gaps: cwd fallback, never-invoke rule, temp-dir rule ungated | minor | T001 signal extended with greps for `mktemp`, `cwd`, and case-insensitive `never invoke` | T001 signal |
| 10. "Sibling band 150–300" mislabeled (siblings run 225–261) | nit | Reworded as a line budget of 180–280 with sibling range cited | AC5; T001 validation |
| 11. Unevidenced restart assertion; temp cleanup unspecified for interrupted sessions | nit | Restart claim now cites `README.md:63` in Discovered Requirements; Write Discipline gains a best-effort cleanup-on-resumption clause (A5) | Discovered Requirements; A5; Design §4 |
| 12. `head -4` frontmatter gate never asserts lines 1/4 are `---` | nit | T001 signal prefixed with `head -1 "$f" \| grep -qx -- '---'` | T001 signal |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | START -> INTAKE | — | Brief classified: prescriptive (7 mandated steps + output + write rules), small-medium size; full plan depth chosen since the skill is the workflow entry point | DISCOVER |
| 2026-08-03 | 0 | INTAKE -> DISCOVER | — | Repo inspected: six sibling skills, README touchpoints, no AGENTS.md, dirty csm-scan baseline captured (11 modified + 1 untracked) | RESEARCH |
| 2026-08-03 | 0 | DISCOVER -> RESEARCH | — | Fetched Matt Pocock grill-me, grilling, writing-great-skills (read-only); house skeleton extracted from csm-plan/csm-build/csm-bdd-tdd; R1–R6 recorded | DRAFT |
| 2026-08-03 | 0 | RESEARCH -> DRAFT | — | Design fixed: 8 states with cycle rules, mapping table, contract strings, write discipline, approach-doc template; 3 tasks in G1∥G2 | CRITIQUE |
| 2026-08-03 | 0 | DRAFT -> CRITIQUE | — | Fresh-eyes critique subagent (did not author draft): 12 findings (1 critical, 4 major, 5 minor, 2 nit), verdict NOT READY | REMEDIATE |
| 2026-08-03 | 0 | CRITIQUE -> REMEDIATE | — | All 12 findings resolved with surgical plan-text edits; no redesign needed; resolutions recorded in Critique Resolution | VERIFY |
| 2026-08-03 | 0 | REMEDIATE -> VERIFY | — | Primary personally re-verified: template sections complete; every task has runnable signal/risk/anti-scope/spike note; G1 scopes disjoint post-fix; gates match brief's central requirements (cyclic, single-file output, temp rules, .agents location, ASCII+Mermaid, csm-plan briefs) | SAVED |
| 2026-08-03 | 0 | VERIFY -> SAVED | — | Plan saved to `.agents/plans/2026-08-03-csm-grill-skill-csm.md`; committed as `plan: csm-grill skill (first cut)` staging only the plan file | STOP (planning terminal; execution awaits explicit csm-build invocation) |

## Completion Review
<filled by csm-build when all criteria are verified>
