format: csm-plan/1

# csm-plan/csm-build Optional DDD Intake CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 4 tasks — 2 standard (T001/T002: public-interface SKILL.md prose of two core skills), 1 standard (T003: shared registry), 1 low (T004 closeout). T001-T003 receive independent review in-batch.

## Control

- Plan ID: csm-plan-build-ddd-intake
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 2
- Commits: allowed
- Last checkpoint: COMPLETE 2026-08-23 — all 4 tasks verified; check-suite OK 12 skills/919 checks; repo suite 89/89; csm-ddd 35/35; procedure dry-run proves graph validation + runId match
- Last model/run: stealth/ox-alpha opencode 2026-08-23
- Next transition: COMPLETE (terminal)
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Make `csm-plan` and `csm-build` work optimally when a caller hands them the outputs of the `csm-ddd` skill — as an OPTIONAL input path recognized by each skill's own input triage, never a mandatory prerequisite. DDD artifacts are one of several possible evidence sources; absence must leave every existing behavior byte-for-byte unchanged.

- Deliverables: csm-plan intake step for optional DDD artifacts (+ doctrine pointer for structural-change plans); csm-build RECOVER/DISPATCH hooks for plans citing DDD context; registry recognition (INTERFACES consumes strings + one CONTRACTS entry); regenerated README matrix; re-recorded gate baseline.
- Constraints: optional-only; artifact reading is not skill invocation (NEVER_INVOKE matrix untouched); zero behavior change when no DDD artifacts are referenced; all suite gates stay green; no new H2 sections (MANIFEST untouched); <500-line caps respected.
- Exclusions: no multi-slice program orchestrator; no changes to csm-ddd itself; no new skills; no JSON-LD; no enforcement beyond what gates already provide.

## Acceptance Criteria

1. With no DDD artifacts present, `node scripts/check-suite.mjs` exits 0 and both skills' documents differ from current behavior only by additive prose — verified by gate green plus prose review.
2. When a brief references `.agents/ddd/<date>-<slug>-ddd-report.md`, csm-plan's documented procedure loads and validates the pair (schema-valid graph, matching runIds) and treats claims as hypotheses (basis/confidence), citing them in Current-State Evidence — evidenced by the documented steps plus one worked example committed under `.agents/plans/` fixtures NOT required (procedure-level acceptance, see T001 signal).
3. When a saved plan cites a DDD graph, csm-build's documented RECOVER procedure verifies existence, parseability, and runId match before VALIDATE, and DISPATCH prompt requirements include seam constraints — same procedure-level acceptance.
4. Registry: `INTERFACES["csm-plan"].consumes` and `INTERFACES["csm-build"].consumes` name the optional artifacts; one CONTRACTS entry enforces the producer needle (csm-ddd) against both consumer needles; README composition matrix regenerated to match; `node scripts/check-suite.mjs` exits 0.
5. Full verification battery green: check-suite, `with-node22` repo suite, `make test-ddd`.

## Current-State Evidence

- csm-plan/SKILL.md INTAKE has 4 numbered steps (state body, ~line 114ff section "Planning State Machine"); adding a sequential step 5 is machine-safe (`### n.` ordinal rules require strictly sequential lists — appending keeps 1..5 contiguous). Interface Consumes bullet at :109 already uses the "optional … when dispatched" phrasing pattern.
- csm-plan has an established optional-input pattern: "Repository Norms (NORMS.md)" section with Detection/Validation/Integration subsections (SKILL.md:69-89).
- csm-build/SKILL.md RECOVER is a 7-item numbered list (~:100ff); DISPATCH prompt requirements include per-plan extras precedent: "for BDD/TDD plans: … scenario and unit-test-design paths …" (:153). Locate The Plan shows optional-supersession handling (:82-88). Interface Consumes at :92 ends "optional NORMS.md artifact".
- CONTRACTS shape (scripts/lib/contracts.mjs:171-183): `{id, source:{skill,needle}, consumers:[{skill,needle}], rule:"prefix"}`; gate iterates at scripts/check-suite.mjs:883-907 checking needles appear outside fences in the named skills' SKILL.md.
- csm-ddd produces exactly two artifact paths (`.agents/ddd/<yyyy-mm-dd>-<repo-slug>-ddd-{report.md,graph.json}`), cross-linked by runId; graph schema ships at `csm-ddd/schemas/`; validator CLI exists (`node csm-ddd/lib/ddd/validate.mjs graph|report FILE`).
- ARTIFACT_PATTERNS need NO change: patterns are only tested against each skill's own Interface prose; extra path literals in prose without patterns pass trivially (plan-validation.mjs missing-key default []).
- NEVER_INVOKE: reading another skill's artifacts is the suite's standard human-mediated handoff (e.g. review findings feed plan runs today) — no matrix change.
- README composition matrix renders from INTERFACES only; regenerate via `node scripts/gen-readme-matrix.mjs --write`.
- Gate baseline currently 909 (recorded 2026-08-23); count WILL grow (new CONTRACTS entry adds checks) — re-record after green, tolerance 0.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --------- | ---- | --------------------- | ------ |
| B1 | DDD artifacts enter BOTH skills purely as optional triaged inputs: detection is by explicit reference in the brief/plan (never ambient auto-loading of `.agents/ddd/**`) | user-dictated | User instruction: "optional but optimal… likely only one source or input… considered by the triage done therein"; ambient scanning would violate isolation and surprise | decided |
| B2 | Reading DDD artifacts is artifact consumption, not invocation — NEVER_INVOKE stays untouched | decision | Suite-wide terminal-skill semantics; review-findings→plan precedent | decided |
| B3 | Guidance lands inside EXISTING structures (csm-plan INTAKE step 5; csm-build RECOVER item + DISPATCH bullet) — no new H2 sections, so MANIFEST/machine checks are untouched | decision | Smallest change; avoids section-list ripple in contracts.mjs MANIFEST | decided |
| B4 | Structural-change doctrine: when a plan's tasks modify module/service boundaries informed by DDD hypotheses, csm-plan must include parity-baseline and rollback-criteria tasks and cite the DDD research doc (`.agents/research/2026-08-22-ddd-repo-analysis-refactoring-research.md`) | decision | Closes gap #2 from the post-build adequacy review; research §5-§7 already supplies the technique content | decided |
| B5 | One CONTRACTS entry (`ddd-analysis-to-planners`) covers both consumers; needle `.agents/ddd/` (prefix rule) | decision | Mirrors `plan-save-path` precedent; single source needle already in csm-ddd prose | decided |
| B6 | Validation depth in both skills is procedure-level (readable, deterministic instructions), NOT new executable tooling — the shipped `validate.mjs` CLI is referenced, not duplicated | decision | Skills are instruction-led; building new validators would duplicate csm-ddd's own | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |
| R1 | Where do optional inputs enter each skill today? | targeted reads of csm-plan/SKILL.md + csm-build/SKILL.md | read-only rg/sed | NORMS Detection pattern (plan); BDD-when-present + Locate-The-Plan precedence (build) | T001/T002 insertion points |
| R2 | What does the CONTRACTS gate actually enforce? | read contracts.mjs:171-183 + check-suite.mjs:883-907 | read-only | Producer/consumer needles checked outside fences, prefix rule | B5 contract shape |
| R3 | Do ARTIFACT_PATTERNS need updating when prose gains path literals? | read plan-validation.mjs:98-114,417-430 | read-only | Missing key defaults []; patterns only tested against own Interface prose | No pattern changes needed |
| R4 | Machine-safety of appending INTAKE step 5? | read csm-plan state-machine ordinal rules usage | read-only | Strictly sequential append keeps 1..5 valid | T001 design |
| R5 | Will the check count move? | live `node scripts/check-suite.mjs` (909 today) | read-only | New CONTRACTS entry adds checks; matrix region changes | Baseline re-record in T004 |

## Discovered Requirements

- Gate-baseline tolerance 0: after T003 lands and the gate goes green, re-record BEFORE committing (pre-commit hook compares observed vs recorded).
- README matrix drift gate: any INTERFACES change requires `gen-readme-matrix --write` in the same batch.
- The synthetic-corpus harness (tests/check-suite.test.mjs) clones tracked files only — land prose+registry atomically in one commit so the corpus self-consistently contains both sides of the new CONTRACTS needles.
- oxfmt formats staged non-.agents files; oxlint runs repo-wide via check-suite — prose-only edits are format-sensitive (tables/wrapping) but lint-inert.
- Plan-corpus lint applies to THIS plan once saved: no `<placeholder>` tokens in Acceptance-signal backticks; journal Next-state values must be enum tokens; Control Next transition must be TOKEN -> TOKEN.
- Description word budget: descriptions of csm-plan/csm-build are NOT edited by this plan — no token-efficiency interaction.

## Design

**csm-plan (T001).** Two additive prose edits, nothing else:
1. Interface Consumes bullet (:109) gains: "; optional csm-ddd analysis artifacts when explicitly referenced".
2. INTAKE gains sequential step 5: "Optional-input triage: if the brief explicitly references csm-ddd artifacts (report and/or graph under `.agents/ddd/`), load them as evidence — validate the graph with the shipped validator (`node csm-ddd/lib/ddd/validate.mjs graph <path>`), confirm report and graph share one runId, and treat every claim as a hypothesis (status/basis/confidence), never ground truth. Cite loaded seams/hypotheses in Current-State Evidence; let slice-ordering ranks inform task sequencing; and for plans whose tasks alter module or service boundaries, include parity-baseline and rollback-criteria tasks per the DDD research doctrine. Absent an explicit reference, do nothing." 

**csm-build (T002).** Three additive prose edits:
1. Interface Consumes bullet (:92) gains: "; optional csm-ddd analysis artifacts when the plan cites them".
2. RECOVER gains item 8: "DDD-context check: if the plan cites `.agents/ddd/` artifacts, verify each referenced file exists and parses, confirm the plan's cited runId equals the graph's runId, and record mismatches as a VALIDATE blocker; absent citations, skip."
3. DISPATCH prompt-requirements bullet list gains: "for plans citing DDD context: carry the relevant seam constraints (rollback option, observable behavior) into every task touching that seam".

**Registry (T003).**
- `INTERFACES["csm-plan"].consumes` += `"optional csm-ddd analysis artifacts when explicitly referenced"`; `INTERFACES["csm-build"].consumes` += `"optional csm-ddd analysis artifacts when the plan cites them"` (matrix re-render reflects these).
- New CONTRACTS entry after `bdd-plan-suffix`: id `ddd-analysis-to-planners`, source `{skill:"csm-ddd", needle:".agents/ddd/<yyyy-mm-dd>-<repo-slug>-ddd-report.md"}`, consumers `[{skill:"csm-plan",needle:".agents/ddd/"},{skill:"csm-build",needle:".agents/ddd/"}]`, rule `"prefix"`.

**Data flow**: caller passes a brief/plan referencing DDD artifacts → triage detects explicit reference → validation (schema + runId) → evidence integration (plan) or constraint propagation (build). No reference → identical legacy behavior.

## Execution Graph

```text
G1 { T001 csm-plan prose ∥ T002 csm-build prose }
  -> T003 registry + matrix + baseline
  -> T004 verification + closeout
```

Critical path: T003→T004. Prose-first is safe for ARTIFACT_PATTERNS and CONTRACTS (inert until registered) but NOT for the payload-drift gate: any root SKILL.md edit stales its payload copy, so the first full-gate run happens in T003 AFTER `pack-bootstrap.mjs` regenerates payload copies. G1 acceptance is therefore targeted-checks-only; no gate run and NO pack invocation inside G1 (concurrent packs would race on payload-index.json).

## Numbered Plan

1. [completed] csm-plan: optional DDD intake procedure
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (public-interface prose of a core skill)
   - Owned scope: `csm-plan/SKILL.md`
   - Not in scope: contracts.mjs (T003); any other skill; line-cap violations (file stays <500 lines)
   - Spike candidate: none
   - Actions: extend Interface Consumes bullet per Design; append INTAKE step 5 verbatim-per-Design (strictly sequential after step 4); keep all other bytes untouched
   - Acceptance signal: `rg -c "optional csm-ddd analysis artifacts when explicitly referenced" csm-plan/SKILL.md` prints 1 AND `rg -n "Optional-input triage" csm-plan/SKILL.md` matches AND `wc -l csm-plan/SKILL.md` reports fewer than 500 lines
   - Validation: line count `wc -l csm-plan/SKILL.md` still <500; INTAKE ordered list remains 1..5 with no gaps (`rg -n "^([1-5])\. " csm-plan/SKILL.md` within the state body)
   - Acceptance evidence: command outputs recorded in journal
   - Repair attempts: 0
   - Recovery note: prose-only; revert = restore prior bullet/step
2. [completed] csm-build: DDD-context recovery and dispatch hooks
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (public-interface prose of a core skill)
   - Owned scope: `csm-build/SKILL.md`
   - Not in scope: contracts.mjs (T003); any other skill
   - Spike candidate: none
   - Actions: apply the three Design edits (Consumes bullet, RECOVER item 8, DISPATCH bullet)
   - Acceptance signal: `rg -c "optional csm-ddd analysis artifacts when the plan cites them" csm-build/SKILL.md` prints 1 AND `rg -n "DDD-context check" csm-build/SKILL.md` matches AND `wc -l csm-build/SKILL.md` reports fewer than 500 lines
   - Validation: `wc -l csm-build/SKILL.md` <500; RECOVER list remains contiguous 1..8; DISPATCH bullet sits inside the prompt-requirements list
   - Acceptance evidence: command outputs recorded in journal
   - Repair attempts: 0
   - Recovery note: prose-only; revert = remove added items
3. [completed] Registry recognition: INTERFACES, CONTRACTS, matrix, baseline
   - Task ID: T003
   - Depends on: T001, T002 (consumer needles must exist in prose before the gate checks them)
   - Parallel group: G2
   - Risk: standard (shared registry file)
   - Owned scope: `scripts/lib/contracts.mjs` (INTERFACES consumes strings ×2 + CONTRACTS entry); pack-regenerated outputs `bootstrap/package/payload/skills/{csm-plan,csm-build}/SKILL.md` and `bootstrap/payload-index.json` (commit as generated); generated README matrix region; `.agents/docs/gate-baselines.json`
   - Not in scope: MANIFEST, FORMAT_VERSIONS, NEVER_INVOKE, ARTIFACT_PATTERNS, any SKILL.md
   - Spike candidate: none
   - Actions: apply B5 contract entry + two consumes strings; run `node scripts/pack-bootstrap.mjs` (regenerates both payload SKILL.md copies + payload-index.json — this is what clears the payload-drift gate); run `node scripts/gen-readme-matrix.mjs --write`; run full gate; time it; re-record baseline with observed values
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 printing 12 skills with the new contract satisfied (no MISSING-contract messages)
   - Validation: `rg -c "ddd-analysis-to-planners" scripts/lib/contracts.mjs` = 1; matrix region diff shows the two new consumes cells; pack idempotent (`node scripts/pack-bootstrap.mjs` twice after first regen, second run no diff)
   - Acceptance evidence: gate output + baseline record line
   - Repair attempts: 0
   - Recovery note: registry is additive; revert = drop entry + regenerate matrix
4. [completed] Verification battery and closeout
   - Task ID: T004
   - Depends on: T003
   - Parallel group: G3
   - Risk: low
   - Owned scope: this plan document (journal/completion); final baseline record
   - Not in scope: product code
   - Spike candidate: none
   - Actions: add one sentence to the README edge-semantics paragraph noting the optional human-mediated csm-ddd→plan/build artifact feed; run the full battery; exercise a manual dry-run of the documented procedures against the real `.agents/ddd/2026-08-23-opencode-skills-ddd-*` artifacts (read-only: validate graph, compare runIds) recording results as procedure-level evidence for AC2/AC3; append journal rows; set COMPLETE
   - Acceptance signal: `node scripts/check-suite.mjs && node scripts/with-node22.mjs --exec node --test tests && make test-ddd` all exit 0 in one chain, then `node csm-ddd/lib/ddd/validate.mjs graph .agents/ddd/2026-08-23-opencode-skills-ddd-graph.json` exits 0
   - Validation: `git status --porcelain` shows only expected paths; baseline matches last observed count
   - Acceptance evidence: chained output + journal row
   - Repair attempts: 0
   - Recovery note: docs-only tail; safe to resume anywhere

## Verification Strategy

Cheapest-first: per-task `rg` asserts + single-file reads (seconds) → batch gate `node scripts/check-suite.mjs` after T003 and T004 (~3s) → repo suite under with-node22 + `make test-ddd` at T004 only → manual procedure dry-run (AC2/AC3 evidence) last. Parallel-safe: T001/T002 touch disjoint files. Environment sensitivities: tolerance-0 baseline (re-record after green, never mid-run); harness clones tracked files only (commit prose+registry atomically); plan-corpus lint governs this document's own signals/states.

## Risks And Recovery

- **Gate-red window between T003 and commit**: contained — T003 includes baseline re-record; commit lands immediately after.
- **Contract needle mismatch**: gate names the missing needle location; fix prose or needle, re-run.
- **Behavioral surprise regression**: mitigated by B1 (explicit-reference detection only) and AC1 (gate green + prose diff review proves additive-only).
- **Rollback**: all edits are additive prose/registry; revert commit restores prior behavior exactly.
- **Recovery**: Control + journal give a fresh agent the exact next action; no partial states possible beyond an uncommitted edit.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| 1. HIGH: G1 gate runs impossible — payload drift fires on root SKILL.md edits | blocker | T001/T002 signals rewritten to targeted checks; pack moved into T003; no concurrent pack in G1 (write-race on payload-index.json) | pack-bootstrap.mjs:33,38,177-179; check-suite.mjs:584-605 |
| 2. MEDIUM: T003 wrote files outside its owned scope | major | Payload SKILL.md copies + payload-index.json + pack invocation added to T003 scope/actions | syncPayload deletes/rewrites unmapped-stale files |
| 3. LOW: README lifecycle prose omits new optional feed | minor | One-sentence addition moved into T004 actions | README.md:87,142 edge-semantics paragraph |
| 4. INFO: placeholder critique row + double-labeled risk summary | minor | Fixed at remediation time (this table) | plan self-consistency |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-23 | 0 | INTAKE | none | Classified small/prescriptive; optional-triage stance recorded as B1 | DISCOVER |
| 2026-08-23 | 0 | DISCOVER | none | R1-R5 recorded: insertion points, CONTRACTS shape, pattern non-requirements confirmed | RESEARCH |
| 2026-08-23 | 0 | RESEARCH | none | All questions repo-internal; no external retrieval needed (proportionality) | DRAFT |
| 2026-08-23 | 0 | DRAFT | 4 pending | Plan drafted | CRITIQUE |
| 2026-08-23 | 0 | CRITIQUE | 4 pending | Independent subagent critique (channel recovered): ready-after-remediation — 1 blocker (payload-drift vs G1 gate runs), 1 major (T003 scope), 2 minor | REMEDIATE |
| 2026-08-23 | 0 | REMEDIATE | 4 pending | All 4 findings resolved (signals retargeted, pack+scope moved to T003, README sentence added to T004, table filled); ordinal/machine safety, contract shape/direction, line caps, and signal lint independently verified OK | VERIFY |
| 2026-08-23T10:15Z | 1 | CHECKPOINT | T001 completed, T002 completed | Subagent dispatch recovered (both landed cleanly); diffs inspected hunk-by-hunk — exactly the planned additive edits; G1 targeted signals pass; line caps 308/277 | SELECT |
| 2026-08-23T10:22Z | 2 | CHECKPOINT | T003 completed | Registry: consumes strings x2 + ddd-analysis-to-planners contract; pack regenerated payload copies; matrix re-rendered; gate OK 919 checks (+5 as predicted); baseline re-recorded | VERIFY |
| 2026-08-23T10:30Z | 2 | COMPLETE | T004 completed | Full battery: repo suite 89/89 (cwd discovery mode), csm-ddd 35/35, gate green; AC2/AC3 procedure dry-run on real artifacts: graph schema-valid, report/graph runIds match. README edge-semantics sentence added to both copies. Completion gate passed by primary | STOP |

## Completion Review

All five acceptance criteria verified 2026-08-23:
1. No-DDD behavior unchanged: gate green throughout; diffs are purely additive prose (inspected hunk-by-hunk).
2. csm-plan intake documented and exercised: validator CLI validates the real graph; runId match proven in dry-run.
3. csm-build RECOVER/DISPATCH hooks documented; the same dry-run satisfies the runId-match check RECOVER item 8 prescribes.
4. Registry: two INTERFACES consumes strings + ddd-analysis-to-planners CONTRACTS entry enforced by the gate (no MISSING messages); matrix regenerated; pack idempotent.
5. Battery: check-suite OK 12 skills/919 checks; with-node22 repo suite 89/89; make test-ddd 35/35.
Independent review: critique subagent (pre-build), hunk-level diff inspection, objective gates. Residual risk: doctrine-level only (guidance is procedural, not code-enforced).
