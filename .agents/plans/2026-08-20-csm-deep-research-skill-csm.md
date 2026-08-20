format: csm-plan/1
# Build the csm-deep-research Skill CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 2 high (T001 public-interface artifact, T002 suite-wide gates), 1 standard (T005 remediation), 2 low (T003, T004). High-risk tasks always require independent review (T005 provides it). Blast radius covers contracts, check-suite, README, tests, bootstrap payload, and the new skill dir.

## Control
- Plan ID: csm-deep-research-skill
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-20 — plan created from approach .agents/approaches/2026-08-20-csm-deep-research-skill-approach.md (agreed, format csm-grill/1)
- Last model/run: deepseek-v4-flash — planning session
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal
Build and integrate the new single-file orchestration skill `csm-deep-research` into this suite per the agreed approach document: author csm-deep-research/SKILL.md (deep research / R&D / validation queries answered with one dated, exhaustively cited research finding via triage, mixture-of-experts, adversarial challenge, LLM-as-judge, tier-scaled citation verification; standalone; tmux-managed; write discipline = temp dir + single `.agents/research/` output); register it in every suite gate (contracts, boilerplate, check-suite corpus, README, .agents index); ship it in the bootstrap payload; update hardcoded test counts; seed the research corpus; run a hostile 5-pass review with full remediation; and leave every gate green.

Deliverables:
1. csm-deep-research/SKILL.md (~340-420 lines, single file, no scripts/tests).
2. Suite registration: MANIFEST/INTERFACES/NEVER_INVOKE/FORMAT_VERSIONS in scripts/lib/contracts.mjs; TMUX_PARAMS/RESILIENCE_PARAMS in scripts/lib/boilerplate.mjs; research corpus block in scripts/check-suite.mjs; README.md row + tmux bullet + prose counts; .agents/README.md `## research/` section.
3. Bootstrap payload: pack-bootstrap.mjs skillDirs, bootstrap/package/payload/skills/csm-deep-research/SKILL.md, payload-index.json refresh.
4. Tests updated 8->9: tests/package-audit.test.mjs, tests/integration/bootstrap-flow.test.mjs, tests/protocol/protocol.test.mjs.
5. Corpus seed: .agents/research/2026-08-20-csm-deep-research-skill-research.md (format: csm-deep-research/1, 8-H2 template sequence).
6. Review + remediation: .agents/docs/csm-deep-research-skill-review-2026-08-20.md, 100% findings remediated/traced.

Constraints:
- Prescribed by the approach document (user-dictated): name csm-deep-research; standalone (no csm-plan handoff); `.agents/research/` corpus with format marker csm-deep-research/1; tmux orchestration; 3 tiers x 3 source modes; clarifications off by default; csm-review-style pipeline (anti-anchored challenger, dedicated judge subagent, tier-scaled verification); 9-part progressive-disclosure finding (part 1 = H1 title, then exactly 8 H2 sections); single-file orchestration skill; heavy hostile-review build; payload now; no NORMS.md dependency.
- Do not modify csm-grill, csm-plan, csm-build, csm-bdd-tdd, csm-review, csm-scan, csm-browse, or csm-upload skill content (their Interface bullets stay 8-name; see D22).
- Do not touch `.agents/plans/` other than this plan. Existing check-suite behavior otherwise unchanged (baseline at HEAD 7350a78: 8 skills, 522 checks, exit 0; T002 adds checks by design).
- csm-deep-research/SKILL.md is owned by T001 only; T002's `sync-skill-boilerplate.mjs --write` must produce zero drift in it (revert + record if it rewrites).
- The two synced sections (Tmux Session Bootstrap, Subagent Resilience) are byte-exact boilerplate; never hand-edit them after registration.
- Sibling skills' `- Never invokes:` bullets are NOT edited (D22): the NEVER_INVOKE matrix gains only the new row; expected sets derive from filtered row keys (check-suite.mjs:444), so siblings stay consistent at 8 names.

Exclusions:
- No implementation of the skill's runtime behavior beyond the SKILL.md text itself (the skill is instructions-only).
- No csm-bdd-tdd mutation, no csm-review invocation, no payload deferral, no NORMS.md integration.
- No changes to Makefile, .lefthook.yml, .oxlintrc.json, package.json, pnpm-lock.yaml, node_modules, LICENSE.

## Acceptance Criteria
1. csm-deep-research/SKILL.md exists, 340-420 lines, passes frontmatter/state-machine/interface/sections checks; evidence: `node scripts/check-suite.mjs` exit 0 (after T004) and the T001 gate command printing PASS.
2. Every suite gate knows the skill: MANIFEST, INTERFACES, NEVER_INVOKE (new row only, D22), FORMAT_VERSIONS, TMUX_PARAMS, RESILIENCE_PARAMS, research corpus block; evidence: `node scripts/gen-readme-matrix.mjs --check` clean, `node scripts/sync-skill-boilerplate.mjs --check` clean, check-suite green.
3. Bootstrap payload ships the skill byte-identical; evidence: `diff -rq bootstrap/package/payload/skills/csm-deep-research csm-deep-research` clean and the three test suites green at 9 skills.
4. Research corpus has its seed; evidence: check-suite research-corpus checks pass.
5. Hostile review completed with every finding remediated/traced; evidence: .agents/docs/csm-deep-research-skill-review-2026-08-20.md + plan Critique Resolution + Completion Review.
6. Working tree contains only the intended file set at completion; evidence: `git status --porcelain` reviewed at final gate (intended set enumerated in T005).

## Current-State Evidence
- HEAD 7350a78 ("plan amendment: token efficiency ON by default — committed .agents/token-efficiency.json"; the commit itself changed only .agents/plans/2026-08-20-cache-token-efficiency-csm.md — no token-efficiency.json exists in the tree; prior HEAD 5faf3c8 fixed the formatMarkerOf bare-marker contract). Baseline: `node scripts/check-suite.mjs` exits 0 — "OK — 8 skills, 522 checks" (verified 2026-08-20). `git status --porcelain` shows only this plan's `.draft` sidecar. No NORMS.md at root or cwd. `git config core.hooksPath` = `scripts/hooks` — the pre-commit gate is LIVE (see DR-14).
- formatMarkerOf (scripts/check-suite.mjs:62-71) accepts BOTH `---`-delimited frontmatter AND a bare top-of-file `format: <kind>/<n>` marker (branch at :68-69). The approach doc's bare `format: csm-grill/1` on line 1 parses fine — no frontmatter fix is required (supersedes the earlier red-baseline finding).
- check-suite auto-discovers any dir matching `^csm-[a-z-]+$` containing SKILL.md (:352,358-366); missing MANIFEST entry hard-fails (:377-378 dead-registry check).
- Corpus blocks: plans 555-589, reviews 591-619, approaches 621-643. Pattern: readdir by suffix (`-csm.md`, `-review.md`, `-approach.md`), hard min-count check (`no *-... corpus found`), per-file `formatMarkerOf`, H2-subsequence vs template extracted from the producer SKILL.md section (extraction at :513-522, e.g. approachTemplate from csm-grill Required Approach Document).
- verifyMachine (check-suite.mjs:212-273): chain line must match `CHAIN_RE` (/:37); exactly one `### <n>. <TOKEN>` heading per chain token (STATE_HEADING_RE :38), consecutive from 1 (:252-253), no numbered headings outside the chain (:247-248), no duplicates; `entryExit:false` requires no Entry:/Exit: lines (:255-271); STOP terminal-exemption at :242-245 (chain ending in STOP with no STOP heading drops STOP from required tokens).
- NEVER_CLAUSE_RE (check-suite.mjs:35): `\bnever\b[^.]{0,120}\b(only|beyond|elsewhere|writes?|runs?|invok\w*|starts?|plans?|planning|implement\w*|fix\w*|patch\w*|review\w*|execut\w*|push\w*|targets?)\b/i` — no period allowed within 120 chars after "never" before the verb.
- Interface checks (check-suite.mjs:428-447): exactly 4 labeled bullets (Consumes/Produces/Hands off/Never invokes); expected never-invokes set = `Object.keys(NEVER_INVOKE[skill]).filter(nm => row[nm])` (:444). The matrix is NOT required to be square — adding only the csm-deep-research row (self=false) keeps sibling bullets valid without editing them (D22).
- README.md: tmux bullet line 79 lists the 5 tmux skills; check-suite:664-666 requires one line naming all MANIFEST.tmux skills; skills table rows 45-52; README path references check :652-658; layout tree entries validated :668-690; prose counts at lines 85 ("eight skill folders"), 91 ("...need no further setup" list), 145 ("five orchestration skills"), 147 ("three tooling skills").
- tests/package-audit.test.mjs:11 skillNames list, :90 `assert.equal(skillEntries.length, 8)`, :108 `verified >= 118`; tests/integration/bootstrap-flow.test.mjs:16 list, :42 count 8; tests/protocol/protocol.test.mjs:27 skillsPlaced deepEqual (alphabetical; csm-deep-research slots between csm-build and csm-grill).
- scripts/pack-bootstrap.mjs:18 skillDirs (8, sorted); :21 mapping.skills derived; buildIndex sort by path (:76); payload-index.json currently lists the 8 payload/skills entries; bootstrap/package/payload/skills byte-identical to root skill dirs (verified). NOTE: `packBootstrap()` (invoked by pack-bootstrap.mjs AND by the three test suites) rewrites `bootstrap/package/payload/*` and `bootstrap/payload-index.json` inside the repo with deterministic identical bytes (benign for `git status`) and accumulates `/tmp/csm-pack-*` dirs.
- scripts/lib/boilerplate.mjs: SYNC_SECTIONS built from TMUX_PARAMS (:79-83) + RESILIENCE_PARAMS (:84-87); exports only SYNC_SECTIONS. sync-skill-boilerplate.mjs checkDrift (:67-94) and syncWrite (:96-123) iterate only registered skills — unregistered skills are never visited, so pre-T002 the new sections are unvalidated and `--write` will not create/delete/rewrite them.
- Plan artifact validation (scripts/lib/plan-validation.mjs): Control `Status:` must be in CONTROL_STATUSES; `Current CSM state:` must be a machine token or CONTROL_STOP_VALUES (NOT_STARTED is); `Next transition:` accepts the prefix `On a future explicit csm-build invocation, ` followed by a valid `A -> B` pair; journal rows require 6 columns and a Next-state cell whose base token is in MACHINE_ENUM (PLAN_MACHINE ∪ BUILD_MACHINE) or JOURNAL_TERMINALS. F-050 template-format-marker checks are PENDING_DEBT-gated (:545-553) for csm-plan/csm-grill/csm-review only — not extended to the new skill (D14).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Skill name csm-deep-research; frontmatter name == dir | User-dictated | Grill decision 1; check-suite name==dir check | agreed |
| D2 | Standalone skill: no csm-plan/bdd/build/review handoff; NEVER_INVOKE row all-true off-diagonal | User-dictated | Grill decision 2 (revised); approach doc | agreed |
| D3 | Output `.agents/research/<yyyy-mm-dd>-<slug>-research.md`, format csm-deep-research/1, new check-suite corpus block | User-dictated | Grill decision 3; corpus block pattern 621-643 | agreed |
| D4 | tmux orchestration (MANIFEST.tmux true, synced Tmux Session Bootstrap + Subagent Resilience) | User-dictated | Grill decision 4; boilerplate.mjs 79-87 | agreed |
| D5 | Triage 3 tiers x 3 source modes; clarifications OFF by default (opt-in flag, budget 3, strategy confirm when on) | User-dictated | Grill decisions 5-6 | agreed |
| D6 | Pipeline: parallel experts -> primary synthesis -> anti-anchored challenger -> dedicated judge subagent (rubric, reasoning-before-verdict) -> remediate/kill-the-draft -> tier-scaled verification; one adversarial cycle cap; VERIFY budget <=3 distinct failures | User-dictated | Grill decisions 7-9; csm-review/SKILL.md challenger/verify mechanics | agreed |
| D7 | 9-part progressive-disclosure finding: part 1 = H1 title; then exactly 8 H2 sections in order: TL;DR, Executive Summary, Key Findings, Detail Sections, Recommendation, Unverified Claims, References, Process Appendix | User-dictated | Grill decision 10; approach doc | agreed |
| D8 | Single-file orchestration skill, 340-420 lines, no scripts/tests | User-dictated | Grill decision 11; orchestration siblings 225-323 lines, hard <500 gate (check-suite.mjs:395) | agreed |
| D9 | Heavy hostile-review build (5 passes, numbered findings, remediation trace) | User-dictated | Grill decision 12; csm-review-skill run precedent | agreed |
| D10 | Payload now: pack-bootstrap skillDirs + refresh + 3 test files 8->9 | User-dictated | Grill decision 13 | agreed |
| D11 | No NORMS.md dependency (MANIFEST.norms false) | User-dictated | Grill decision 14 | agreed |
| D12 | State chain `INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE -> JUDGE -> REMEDIATE -> VERIFY -> SAVED -> STOP`; 9 numbered headings (STOP terminal-exempt, no ### 10. STOP) | Primary decision | check-suite.mjs:242-245 terminal exemption | agreed |
| D13 | MANIFEST sections list = 11 pinned H2s: Interface, Tmux Session Bootstrap, Activation Boundary, Core Rules, Write Discipline And File Allowlist, Triage, Research State Machine, Required Research Document, Anti-Patterns, Done Criteria, Subagent Resilience | Primary decision | check-suite sections check; approach doc | agreed |
| D14 | Research corpus block mirrors the approach block (suffix glob, hard min, marker, H2-subsequence; no Control/Journal/H1 checks); F-050 template-format-marker machinery NOT extended to the new skill | Primary decision | corpus precedent 621-643; PENDING_DEBT scope 545-553 | agreed |
| D15 | ~~Approach-doc frontmatter fix~~ SUPERSEDED: formatMarkerOf now accepts bare top-of-file markers (5faf3c8, check-suite.mjs:68-69); baseline is green, no fix needed | Superseded | Verified baseline "OK — 8 skills, 522 checks" | superseded |
| D16 | Pinned description: "...Never writes outside the research document, never invokes other skills. Biases towards retrieval from current documentation over pre-trained knowledge." — two never-clauses with NO period between them (NEVER_CLAUSE_RE window) | Primary decision | NEVER_CLAUSE_RE (check-suite.mjs:35); sibling description pattern | agreed |
| D17 | T002's sync --write is a zero-drift gate: if it rewrites csm-deep-research/SKILL.md, revert that file's diff immediately and record a finding for T005 | Primary decision | sync-skill-boilerplate.mjs syncWrite 96-123; T001 write ownership | agreed |
| D18 | README prose updated: line 85 "eight"->"nine"; line 91 "need no further setup" list gains csm-deep-research; line 145 "five"->"six" + name; line 240 orchestration-skills list gains csm-deep-research; line 147 unchanged | Primary decision | README:85,91,145,147,240; partly cosmetic, not gate-enforced | agreed |
| D19 | Template fence in Required Research Document starts with `format: csm-deep-research/1` (self-consistency; seed copies it) | Primary decision | approach doc parked recommendation; sibling templates | agreed |
| D20 | Interface artifact pattern entry in plan-validation.mjs ARTIFACT_PATTERNS omitted (vacuous pass); Interface prose carries the artifact path | Primary decision | plan-validation.mjs ARTIFACT_PATTERNS; validation is by skill key lookup | agreed |
| D21 | Bootstrap test suites (`package-audit`, `bootstrap-flow`, `protocol`) are run with `node --test --test-concurrency=1` because each invokes packBootstrap() which rewrites repo payload files concurrently (deterministic identical bytes; benign for git status, latent race otherwise); /tmp/csm-pack-* dirs accumulate (harmless) | Primary decision | Critique R12; pack-bootstrap.mjs:99-112,152 | agreed |
| D22 | NEVER_INVOKE gains ONLY the new csm-deep-research row (9 keys, self=false); the 8 sibling rows and their SKILL.md bullets are untouched. Supersedes the approach doc's append-to-all-rows prescription | Primary decision | Expected sets derive from filtered row keys (check-suite.mjs:444); no squareness check exists; avoids 8 sibling edits (Critique R1) | agreed |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD-1 | Exact rendered text of the two synced sections for csm-deep-research | Replicated the boilerplate.mjs pure render functions (7-17, 42-64) in node with pinned params; no repo writes | Read-only node eval; `git status` unchanged | Verbatim section bodies captured (see T001 Actions) | T001 embeds them verbatim; T002 sync --write must produce zero drift |
| RD-2 | Does sync-skill-boilerplate --check/--write touch unregistered skills? | Code-read of sync-skill-boilerplate.mjs:67-123 + boilerplate.mjs:79-87 | Read-only inspection | Registry-driven: unregistered skills never visited; no drift flags, no create/delete/rewrite | Pre-T002 the new sections are unvalidated; register params in T002 then --check |
| RD-3 | Is the suite gate green at HEAD? | Ran `node scripts/check-suite.mjs` at 5faf3c8 | Read-only (check-suite writes nothing) | GREEN: "OK — 8 skills, 522 checks" — the earlier red baseline was fixed upstream by 5faf3c8 (formatMarkerOf bare-marker branch) | No frontmatter fix needed (D15 superseded); plan evidence re-pinned |
| RD-4 | Does the pinned description pass NEVER_CLAUSE_RE? | Regex analysis of check-suite.mjs:35 vs pinned text | Read-only | Passes: "never writes" matches `writes?`; second "never invokes" within 120-char no-period window of first "never" | Pin wording exactly; do not add a period between the clauses |
| RD-5 | Where does the corpus H2 template come from? | Read check-suite.mjs:513-522 | Read-only | Corpus H2 template = H2 lines inside the fenced block after the producer SKILL.md's required-document heading | Research corpus block must extract the same way; seed H2s must equal the template fence's H2 sequence |
| RD-6 | Can NEVER_INVOKE gain only the new row without breaking siblings? | Code-read of check-suite.mjs:432-447 (expected = filtered row keys) + critique simulation | Read-only + critique's scratch simulation (deleted) | Yes: sibling rows/bullets unchanged; new row's expected = 8 names matching T001's pinned bullet; no squareness check exists | D22 adopted |
| RD-7 | Can T002 gate while T001 is in flight? | Critique simulation in /tmp scratch (Case A: registry in, SKILL.md absent) | Scratch copy deleted after run | No: dead-registry, README path, layout tree, boilerplate drift, template-extraction failures are untolerated and out of T002 scope | Serialize: T002 depends on T001 (G1 = T001 alone) |

## Discovered Requirements
- DR-1: formatMarkerOf (check-suite.mjs:62-71) accepts bare top-of-file `format: <kind>/<n>` markers — corpus files may use `---` frontmatter OR the bare form; the approach doc (bare form) already passes. No fix needed.
- DR-2: check-suite auto-discovers any `csm-[a-z-]+` dir with SKILL.md and hard-fails if unregistered (check-suite.mjs:352,358-366,377-378). The MANIFEST entry must list only real H2s of the SKILL.md.
- DR-3: NEVER_CLAUSE_RE forbids a period within 120 chars after "never" before a matching verb (check-suite.mjs:35) — keep the two never-clauses in one sentence (D16).
- DR-4: The Interface section must have exactly 4 labeled bullets; the Never invokes bullet must match the filtered NEVER_INVOKE row exactly (8 names, alphabetical) (check-suite.mjs:428-447, D22).
- DR-5: Chain line + state headings: 9 headings `### 1. INTAKE` .. `### 9. SAVED`, consecutive, no extra numbered headings; no STOP heading (terminal-exempt, check-suite.mjs:242-245); entryExit:false means no Entry:/Exit: lines.
- DR-6: Synced sections are byte-exact boilerplate once registered; edit only via boilerplate.mjs + sync --write (check-suite.mjs:701-704).
- DR-7: gen-readme-matrix --check and sync-skill-boilerplate --check are strict byte compares; README matrix region is generated only (README.md:54-69).
- DR-8: README tmux bullet must name all six tmux skills on one line once csm-deep-research is registered (check-suite.mjs:664-666).
- DR-9: Corpus globs are suffix-based and hard-min >=1 file; research corpus stays empty (one expected failure) until T004 seeds it.
- DR-10: Tests list skills alphabetically; csm-deep-research sorts between csm-build and csm-grill.
- DR-11: payload-index.json and bootstrap/package/payload must be refreshed by `node scripts/pack-bootstrap.mjs` (the only sanctioned path); payload mirror must stay byte-identical to the live skill dir. Running the bootstrap test suites also invokes packBootstrap() — run them with `--test-concurrency=1` (D21).
- DR-12: `.lefthook.yml` pre-commit runs check-suite on every commit (live via core.hooksPath=scripts/hooks); during build, commits that fail gates must be fixed, not bypassed (bypass --no-verify only with a recorded reason).
- DR-13: Plan-artifact validation (plan-validation.mjs): journal Next-state must be a MACHINE_ENUM token or terminal marker; Control `Next transition:` uses the exact prefix `On a future explicit csm-build invocation, `.
- DR-14: The live pre-commit hook hard-fails any commit while the research corpus is empty (the designed, tolerated failure until T004). Commit policy for this build: defer checkpoints/commits until T004's green battery completes; any commit before then uses `--no-verify` with the reason recorded in the journal (hook also enforces the unstaged guard — stage all intended files).

## Design
csm-deep-research is a single-file instructions-only orchestration skill. At runtime (per the SKILL.md text we author) it: bootstraps into a detached tmux session `csm-deep-research-<goal-slug>`; runs INTAKE (resume-from-journal, protected-state baseline, clarification flag handling off-by-default) -> TRIAGE (QUICK/STANDARD/DEEP x local/web/hybrid; strategy presented when clarification mode on) -> RESEARCH (parallel read-only expert researchers, source URL + retrieval date per claim) -> SYNTHESIZE (primary-only draft of the 9-part finding) -> CHALLENGE (independent challenger receiving only the draft's claims + evidence mapping, never the author's rationale; verdicts uphold/downgrade/retract/suggest_new_claim recorded verbatim; one adversarial cycle cap) -> JUDGE (dedicated subagent scoring rubric accuracy/citation-grounding/completeness/clarity 0-1 + pass/fail, reasoning-before-verdict) -> REMEDIATE (fix or kill-the-draft) -> VERIFY (primary-personal gate: tier-scaled citation verification, protected-state re-run, budget <=3 distinct failures then caveat-and-SAVED) -> SAVED (single dated `.agents/research/<yyyy-mm-dd>-<slug>-research.md`, optional single-file commit, default none) -> STOP. Write discipline: temp dir `mktemp -d /tmp/csm-deep-research-XXXXXX`, read-only git ops, nothing else written in the researched repo.

The build changes (this plan's real scope) are the suite integration, serialized because the gates cross files (RD-7):
- T001 authors the skill text with all contract strings pinned (description D16, sections D13, chain D12, interface D4/D20/D22, template D19, synced sections RD-1).
- T002 (after T001) registers it in contracts.mjs (D22), boilerplate.mjs, check-suite.mjs (corpus block D14), README.md (D18), .agents/README.md; regenerates matrix + syncs boilerplate (D17).
- T003 (after T001) wires pack-bootstrap + payload + 3 test files (DR-10, D21).
- T004 (after T001+T002+T003) seeds the corpus (DR-9) and runs the full verification battery.
- T005 runs the 5-pass hostile review and remediates everything to a final green gate.

## Execution Graph
```text
[G1: T001 SKILL.md] -> [G2: T002 registry] -> [G3: T004 seed+battery] -> [G4: T005 review+remediation]
                   -> [G2: T003 payload+tests] ->/
```
- G1: T001 only (no parallel group: check-suite gates cross into the SKILL.md, so the registry cannot land first — RD-7).
- G2 (parallel): T002 (registry + surfaces) and T003 (payload + tests) both depend on T001; disjoint file ownership (contracts/boilerplate/check-suite/README/.agents vs pack-bootstrap/payload-index/tests).
- G3: T004 depends on T001 (template H2s), T002 (corpus block + MANIFEST), T003 (bootstrap suites read the refreshed payload — RD-7/Critique R6).
- G4: T005 depends on T003 + T004; owns the review doc; remediation may touch any earlier deliverable.
- Critical path: T001 -> T002 -> T004 -> T005.

## Numbered Plan
1. [pending] Author csm-deep-research/SKILL.md
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (public-interface artifact; new skill consumed by model invocation and all suite gates)
   - Owned scope: `csm-deep-research/SKILL.md` (new dir + file only)
   - Not in scope: contracts.mjs, boilerplate.mjs, check-suite.mjs, README.md, tests, payload, .agents files (T002-T005); edits to any existing skill; Makefile/.lefthook.yml/package.json
   - Spike candidate: none — every contract string is pinned below and in Discovered Requirements
   - Actions:
     1. Create `csm-deep-research/SKILL.md`. Frontmatter verbatim:
        ```
        ---
        name: csm-deep-research
        description: Deep research, R&D, and validation queries answered with a comprehensive, exhaustively cited research finding. Use when asked to research how to build something, which algorithm or technique to use, the original spec or standard, or proof of a way forward. Never writes outside the research document, never invokes other skills. Biases towards retrieval from current documentation over pre-trained knowledge.
        ---
        ```
     2. H1 exactly one: `# csm-deep-research`. NO other `# ` H1 lines anywhere in the file (including inside fences — the template fence's example title line is `# <Topic> Research Finding`, so the gate counts `^# csm-deep-research$` specifically).
     3. `## Interface` — exactly 4 labeled bullets:
        - `- Consumes: a research question or topic; retrievable sources (repository, docs, web)`
        - `- Produces: one dated research document at .agents/research/<yyyy-mm-dd>-<slug>-research.md`
        - `- Hands off: the research document to the user; a future csm-plan may cite it as context (human-mediated)`
        - `- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload`
     4. `## Tmux Session Bootstrap` — heading, then ONE blank line, then embed the body VERBATIM (the render starts with a leading blank line; byte-exact, no trailing blank beyond the template's final line):
        ```
        Run first — before any research work or other sections. Not a research state.

        1. In tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds)? Skip — continue with research.
        2. Skip too when the user/prompt forbade tmux, chose another multiplexer (never start tmux alongside), or tmux is missing (note it, continue without).
        3. Else, before any research work, launch this same agent invocation in a new detached session named `csm-deep-research-<goal-slug>` (from session + prompt; lowercase, hyphen-separated, tmux-safe; `-2`/`-3` on collision): `tmux new-session -d -s csm-deep-research-<goal-slug> 'opencode run "<original research request>"'` (adapt to the agent CLI).
        4. Print `Started tmux session "csm-deep-research-<goal-slug>". Attach: tmux attach-session -t csm-deep-research-<goal-slug>`, then end the invocation — tmux does the research from the start.
        5. Only when skipped (step 2) continue into the research workflow below.
        ```
     5. `## Activation Boundary` — research-only: produces a finding, never implements/plans/builds; SAVED terminal; words like "build" in queries describe future work; the skill never hands off to csm-plan; it never executes repo code or mutates the researched repo.
     6. `## Core Rules` — primary owns orchestration, synthesis, adjudication, and the VERIFY gate; subagents are read-only researchers (findings as text, never write files); facts come from tools (webfetch / docs-search MCP / repo reads), never memory alone, every claim cites source URL + retrieval date; triage tiers reduce depth, never required structure; clarifications are OFF by default (opt-in flag; budget 3; strategy confirmation; mid-run only user-owned decisions, else record as assumption); standalone terminal at SAVED.
     7. `## Write Discipline And File Allowlist` — composite (grill+review wording, adapted):
        - The only persistent write is the single research document at SAVED. Never write plans, specs, code, or docs.
        - The complete write allowlist is exactly: (1) the research document `.agents/research/<yyyy-mm-dd>-<research-slug>-research.md` and the creation of its `.agents/research/` directory (creating an absent parent `.agents/` if needed), at the invocation cwd's git root or cwd if not a git repo — never inside the temp dir; (2) one fresh isolated temp dir per session (`mktemp -d /tmp/csm-deep-research-XXXXXX`) for scratch notes, research journals, retrieved-source copies, and redacted evidence passed to researchers — never create temp files in the repo; (3) a single commit staging only the research document, when the user explicitly requests one in the invocation.
        - Research subagents are read-only and receive the same rule: return findings as text, never write files.
        - Nothing else may be written anywhere in the researched repository or on the host.
        - Git operations against the researched repo's state are read-only (`rev-parse`, `status`, `log`, `show`, `grep`).
        - Capture a protected-state baseline at INTAKE (`git -C <repo> status --short`, else a top-level listing) and re-run it before SAVED: the only permitted difference is the research document — any other change is a critical incident, surfaced to the user, never silently reverted.
        - Delete the temp dir before STOP; on resume, clean up any leftover temp dir from the earlier session on a best-effort basis.
        - By default nothing is committed and SAVED reports "not committed (write discipline)".
     8. `## Triage` — classify each query on two axes before any research: complexity tier (QUICK: single-pass lookup, 1-2 authoritative sources, no panel; STANDARD: parallel expert panel + one challenge + judge; DEEP: full mixture of experts — parallel experts, adversarial challenge, judge loop, kill-the-draft option, per-claim verification) and source mode (local: repository/docs only; web: fetch only; hybrid: both, default). Present the chosen strategy when clarification mode is on; otherwise proceed and record the strategy in the process appendix.
     9. `## Research State Machine` — chain line verbatim: `` `INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE -> JUDGE -> REMEDIATE -> VERIFY -> SAVED -> STOP` ``. Cycle rules (CHALLENGE/JUDGE -> SYNTHESIZE or REMEDIATE; VERIFY -> TRIAGE on coverage gaps; SAVED only from VERIFY; a cycle-back resumes linear flow, only the artifact that triggered the back-edge is re-collected). Termination rules: one adversarial cycle cap (challenge-discovered claims receive at most one further RESEARCH->CHALLENGE round; beyond that primary adjudicates with a recorded "adversarially exhausted" caveat); VERIFY budget (<=3 distinct failures then record residual unknowns, caveat, proceed to SAVED). Journal: record every transition `[<timestamp>] <From> -> <To> :: cycle <n> :: trigger: <reason>` in the research document's embedded Control journal before proceeding. Quota note: hard quota exhaustion stops the run cleanly once the transition is journaled; resume via the research document's Control journal — a state recorded before SAVED is restored at INTAKE, no re-scaffold. Then exactly 9 state headings, each `### <n>. <TOKEN>` with numbered steps 1..k, NO Entry:/Exit: lines, NO `### 10. STOP` heading:
        - `### 1. INTAKE` — resume check (read Control journal in existing research doc, restore state, do not re-scaffold); parse clarification flag (default OFF; when ON, ask up to 3 one-at-a-time questions on ambiguity/options with no obvious choice, each with a recommended answer; confirm triage strategy); record protected-state baseline; create research doc scaffold with Control journal at `.agents/research/<yyyy-mm-dd>-<slug>-research.md`.
        - `### 2. TRIAGE` — classify tier x source mode per `## Triage`; define research tracks (QUICK: 1 track; STANDARD: 2-4 parallel experts; DEEP: 4+ parallel experts by angle); record triage output in the process appendix.
        - `### 3. RESEARCH` — dispatch parallel read-only researcher subagents (one per track/angle), each returning findings with source URL + retrieval date, quoted evidence, assumptions, unknowns, confidence; subagent resilience ladder applies; researchers never write files.
        - `### 4. SYNTHESIZE` — primary-only synthesis of the draft finding per the Required Research Document; every claim carries its source reference; unresolved items move to the Unverified Claims section, never silently dropped.
        - `### 5. CHALLENGE` — dispatch an independent challenger agent (never the draft author) receiving only the challenger view: the draft's claim->evidence mapping and sources — deliberately NOT the synthesizer's reasoning (anti-anchoring); the challenger attempts disproof: re-locate each citation, check the source actually supports the claim, look for counter-evidence and missing alternatives; verdicts: uphold / downgrade / retract / suggest_new_claim, each with rationale; dissents recorded verbatim.
        - `### 6. JUDGE` — dispatch a dedicated judge subagent (never the author, never the challenger) scoring the draft against the rubric: factual accuracy, citation accuracy, completeness, clarity (each 0-1 plus pass/fail), reasoning-before-verdict (judge states its reasoning before the score), judge sees no author rationale; verdicts recorded verbatim in the process appendix.
        - `### 7. REMEDIATE` — primary (or fresh subagent, never the critic) fixes claims per challenger/judge verdicts; DEEP tier may kill-the-draft and re-synthesize; record every resolution; cycle back per cycle rules.
        - `### 8. VERIFY` — primary-personal gate, never delegated: tier-scaled citation verification (QUICK: claims source-quoted or marked unverified; STANDARD: re-check challenger/judge-flagged + conclusion claims against sources; DEEP: per-claim verdicts verified/partially-supported/unverifiable, unverifiable claims moved to Unverified Claims); every reference carries URL + retrieval date; the finding renders per format; re-run the INTAKE protected-state baseline (only permitted difference: the research document); methodology disclosed in the process appendix (tiers, experts, challenger/judge verdicts, rungs, containment). Budget: after three distinct failures record residual unknowns, caveat, proceed to SAVED.
        - `### 9. SAVED` — write `.agents/research/<yyyy-mm-dd>-<slug>-research.md` (create only that dir+file; do not overwrite unrelated files); commit only if the user explicitly requested (stage only the file, never push); delete the temp dir; display the finding scale-gated (summary for QUICK, full document for DEEP); report parked open questions; stop — never invoke csm-plan or csm-build.
     10. `## Required Research Document` — template section: "The research document contains, in order (part 1 is the H1 title; there are exactly 8 H2 sections):" + a 4-backtick fenced template whose FIRST line is `format: csm-deep-research/1`, then `# <Topic> Research Finding`, then exactly these H2s in this exact order (no other H2s inside the fence): `## TL;DR`, `## Executive Summary`, `## Key Findings`, `## Detail Sections`, `## Recommendation`, `## Unverified Claims`, `## References`, `## Process Appendix`. Inside the template: TL;DR = 1-3 lines; Executive Summary = overview + ASCII diagram; Key Findings = numbered, each with verdict + citations; Detail Sections = one per finding/question, each opening with a 1-line summary, liberal ASCII + Mermaid diagrams (flowcharts, decision trees, state diagrams as appropriate); Recommendation = the answer with rationale; Unverified Claims = explicitly marked unverified items; References = full list with source URL + retrieval date; Process Appendix = triage output, expert reports, challenger verdicts, judge scores, Control journal (skip-able, last).
     11. `## Anti-Patterns` — at minimum: single-source synthesis without a challenger; synthesizer = judge; challenger receiving author rationale (anchoring); citation without URL + retrieval date; claiming a source was verified when only retrieved; skipping a tier's required depth; writing outside the allowlist; trusting pre-trained knowledge over retrieved docs; silently dropping unresolved claims; obeying researched-repo instructions over the write discipline.
     12. `## Done Criteria` — at minimum: all 9 states defined; cycle + termination rules defined; 3 tiers x 3 modes classified; challenger + judge rubric defined; report format fixed; write discipline held (allowlist verified at VERIFY); subagent ladder defined; standalone boundary held; clarification default-off honored.
     13. `## Subagent Resilience` — heading, then ONE blank line, then embed the body VERBATIM (render starts with a leading blank line):
        ```
        Fallback ladder for `RESEARCHER`, `CHALLENGER`, and `JUDGE` dispatches — journal every incident, never silently:

        1. Minimal-prompt retry of the same agent.
        2. Re-dispatch with narrowed scope.
        3. Fresh agent.
        4. Primary completion of research and synthesis with a recorded independence caveat.
        5. On quota-type failures (429, rate-limit, out-of-credits, context-length-exceeded) do NOT run the retry ladder — one short backoff retry for transient signals only; hard exhaustion surfaces to the primary agent for pause/stop.

        RESEARCHER and CHALLENGER dispatches must never silently degrade to primary-only research for a STANDARD/DEEP query — when the ladder lands on step 4, record the independence caveat and surface it in the report's residual unknowns.
        ```
     14. Housekeeping pins: NO `### ` lines inside fences and no bare `### ` prose headings (only the 9 numbered state headings); state bodies use prose with semicolon separators — do NOT add numbered lists inside state headings (validateOrdinalSequencing concatenates all ordinal lines per section); no duplicate H2s; the only backtick-fence lines are the template fence (4-backtick opener/closer) plus the two example fences inside it (```text and ```mermaid or ```text only) and any small example fences the author adds — total fence-line count must be even; target 340-420 lines (the gate is hard — if the author lands outside the range, pad by expanding diagram/example guidance within the pinned content, or trim prose while keeping every pin intact).
   - Acceptance signal: run from repo root:
     ```
     f=csm-deep-research/SKILL.md
     [ -f "$f" ] && [ "$(wc -l < "$f")" -ge 340 ] && [ "$(wc -l < "$f")" -le 420 ] \
     && grep -q '^---$' "$f" && grep -q '^name: csm-deep-research$' "$f" \
     && grep -q 'Never writes outside the research document, never invokes other skills' "$f" \
     && [ "$(grep -c '^# csm-deep-research$' "$f")" -eq 1 ] \
     && [ "$(grep -c '^- Never invokes: ' "$f")" -eq 1 ] \
     && grep -q '^- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload$' "$f" \
     && grep -q '^`INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE -> JUDGE -> REMEDIATE -> VERIFY -> SAVED -> STOP`$' "$f" \
     && for i in 1 2 3 4 5 6 7 8 9; do grep -q "^### $i\. [A-Z]" "$f" || exit 1; done \
     && [ "$(grep -c '^### ' "$f")" -eq 9 ] \
     && ! grep -q '^### 10\.' "$f" \
     && grep -q '^## Research State Machine$' "$f" \
     && grep -q '^## Required Research Document$' "$f" \
     && grep -q '^## Tmux Session Bootstrap$' "$f" \
     && grep -q '^## Subagent Resilience$' "$f" \
     && grep -q '^format: csm-deep-research/1$' "$f" \
     && grep -q '^## TL;DR$' "$f" && grep -q '^## Process Appendix$' "$f" \
     && [ "$(grep -c '^```' "$f")" -ge 2 ] && [ "$(( $(grep -c '^```' "$f") % 2 ))" -eq 0 ] \
     && echo PASS
     ```
     Expected: PASS. Record the output.
   - Validation: (cheapest first) the gate command above; balanced backtick fences (even count); `node scripts/check-suite.mjs` after T002 lands — csm-deep-research content checks must pass there (any failure is a genuine defect); line count 340-420; no `Entry:`/`Exit:` lines inside state headings.
   - Acceptance evidence: gate output PASS recorded in the plan journal; final file content committed at INTEGRATE.
   - Repair attempts: 0
   - Recovery note: partial = file exists but gate fails. The gate is self-contained and the pinned strings are in Actions 1-13: re-check each failing probe against its pin (common failures: H1 count via the template's `# <Topic> Research Finding` line — the gate counts `^# csm-deep-research$` specifically; fence evenness from a stray backtick; a `### ` line inside a fence). If file absent, re-create from Actions. Never edit another task's files to make this gate pass.

2. [pending] Register the skill in the suite gates
   - Task ID: T002
   - Depends on: T001 (the gates cross into the SKILL.md — dead-registry, README path, layout tree, boilerplate drift, and corpus template-extraction checks all fail while it is absent, so this cannot run in parallel with T001)
   - Parallel group: G2
   - Risk: high (suite-wide gate edits; existing checks must stay green; NEVER_INVOKE row must stay consistent with all bullets)
   - Owned scope: `scripts/lib/contracts.mjs`, `scripts/lib/boilerplate.mjs`, `scripts/check-suite.mjs`, `README.md`, `.agents/README.md`
   - Not in scope: `csm-deep-research/SKILL.md` content (T001; sync --write must not alter it — see action 8); tests + bootstrap payload (T003); seed file (T004); sibling skills' SKILL.md files (D22 — their Interface bullets stay 8-name); other skills' files
   - Spike candidate: none — every edit pinned below
   - Actions:
     1. `scripts/lib/contracts.mjs`:
        - MANIFEST: add
          ```js
          'csm-deep-research': {
            sections: ['Interface', 'Tmux Session Bootstrap', 'Activation Boundary', 'Core Rules', 'Write Discipline And File Allowlist', 'Triage', 'Research State Machine', 'Required Research Document', 'Anti-Patterns', 'Done Criteria', 'Subagent Resilience'],
            tmux: true,
            norms: false,
            machine: { section: 'Research State Machine', entryExit: false },
          },
          ```
        - INTERFACES: add
          ```js
          'csm-deep-research': {
            entryConditions: ['research question or topic', 'explicit deep-research request'],
            consumes: ['research question', 'retrievable sources (web, docs, repositories)'],
            produces: ['one dated research document at .agents/research/<yyyy-mm-dd>-<slug>-research.md'],
            handoff: ['research document to the user'],
            midPipeline: ['subagent dispatches', 'findings ledger', 'synthesis'],
          },
          ```
        - NEVER_INVOKE (D22): add ONLY the new row — do NOT touch the 8 existing rows:
          ```js
          'csm-deep-research': { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': true, 'csm-deep-research': false },
          ```
        - FORMAT_VERSIONS: add `'csm-deep-research': 1,`.
     2. `scripts/lib/boilerplate.mjs`: add to TMUX_PARAMS:
        ```js
        'csm-deep-research': {
          prelude: 'Run first — before any research work or other sections. Not a research state.',
          step2: 'research', work: 'research', request: 'research', activity: 'research', workflow: 'research',
        },
        ```
        and to RESILIENCE_PARAMS:
        ```js
        'csm-deep-research': {
          intro: 'Fallback ladder for `RESEARCHER`, `CHALLENGER`, and `JUDGE` dispatches — journal every incident, never silently:',
          step4: 'Primary completion of research and synthesis with a recorded independence caveat.',
          guard: 'RESEARCHER and CHALLENGER dispatches must never silently degrade to primary-only research for a STANDARD/DEEP query — when the ladder lands on step 4, record the independence caveat and surface it in the report\'s residual unknowns.',
        },
        ```
     3. `scripts/check-suite.mjs`: after the approaches corpus block (ends ~line 643), add the research corpus block mirroring the approach block (D14): readdir `.agents/research` filtered by `f.endsWith('-research.md')` (catch -> []); `check(researchFiles.length > 0, \`no *-research.md research corpus found under ${path.join('.agents', 'research')}\`)`; per file: `formatMarkerOf` check `marker.kind === 'csm-deep-research' && marker.version >= 1 && marker.version <= (FORMAT_VERSIONS['csm-deep-research'] ?? 0)` with message `research corpus .agents/research/${f} missing/unknown format marker (want frontmatter "format: csm-deep-research/<n>")`; H2-subsequence check against a `researchTemplate` extracted from `csm-deep-research/SKILL.md`'s `Required Research Document` section using the same `sectionRange` + `fencedBlockAfter` mechanism as the approach template (check-suite.mjs:513-522), with message `research corpus .agents/research/${f}: missing/out-of-order required section "## ${gap}"`; add a `check(researchTemplate.length > 0, 'could not extract the Required Research Document template from csm-deep-research/SKILL.md')`. Do NOT add Control/Journal/H1 checks (D14).
     4. `README.md`: add a skills-table row for `csm-deep-research` (purpose prose + `[csm-deep-research/SKILL.md](csm-deep-research/SKILL.md)`); add `` `csm-deep-research` `` to the tmux bullet (line 79) in the inline skill list; line 85 "eight skill folders" -> "nine skill folders"; line 91 "need no further setup" list gains `` `csm-deep-research` ``; line 145 "The five orchestration skills (...)" -> "The six orchestration skills (`csm-grill`, `csm-plan`, `csm-bdd-tdd`, `csm-build`, `csm-review`, and `csm-deep-research`)"; line 240 orchestration-skills list gains `csm-deep-research`; add a layout-tree entry under the repo layout; do NOT hand-edit the generated matrix region (action 6 regenerates it).
     5. `.agents/README.md`: add a `## research/` section with the index line `- `2026-08-20-csm-deep-research-skill-research.md` — 2026-08-20 — seed research document for the csm-deep-research corpus — status: reference` (the file itself arrives in T004).
     6. Run `node scripts/gen-readme-matrix.mjs --write`, then `node scripts/gen-readme-matrix.mjs --check` (must be clean).
     7. Run `node scripts/sync-skill-boilerplate.mjs --write`, then `node scripts/sync-skill-boilerplate.mjs --check` (must be clean). If `--write` rewrote `csm-deep-research/SKILL.md` (D17), immediately restore that file to its pre-write content and record a finding for T005 remediation (the pinned sections in T001 must match the boilerplate renders byte-exact; a rewrite means T001 mis-pasted).
     8. Run `node scripts/check-suite.mjs` capturing exit status AND output (see acceptance signal). With T001 complete, the ONLY tolerated failure is the corpus-empty line (`no *-research.md research corpus found under .agents/research`). Everything else — including the 8 sibling Interface checks and the csm-deep-research content checks — must pass.
   - Acceptance signal: from repo root:
     ```
     node -e "import('./scripts/lib/contracts.mjs')" \
     && node scripts/gen-readme-matrix.mjs --check \
     && node scripts/sync-skill-boilerplate.mjs --check
     set -o pipefail && node scripts/check-suite.mjs 2>&1 | tee /tmp/opencode/t002-gate.log; s=$?
     grep -E '^MISSING' /tmp/opencode/t002-gate.log > /tmp/opencode/t002-missing.log
     [ $s -eq 1 ] && grep -c 'MISSING: no \*-research\.md research corpus found' /tmp/opencode/t002-missing.log | grep -q '^1$' \
     && [ "$(grep -vc 'MISSING: no \*-research\.md research corpus found' /tmp/opencode/t002-missing.log)" -eq 0 ] \
     && echo GATE-PASS
     ```
     Expected: `GATE-PASS` (check-suite exit 1 with the corpus-empty failure as the ONLY MISSING line; matrix + sync --check clean; contracts import clean). Also assert the sibling Interface checks passed by grepping the log for `Never invokes does not match` — it must not appear.
   - Validation: (cheapest first) the gate above; `git diff` review of each owned file; confirm NEVER_INVOKE has exactly 9 rows and the 8 sibling rows are byte-unchanged (git diff shows no sibling rows); confirm README tmux bullet lists all 6 tmux skills.
   - Acceptance evidence: gate log saved to the journal; matrix + sync --check clean outputs recorded.
   - Repair attempts: 0
   - Recovery note: partial = some registry entries missing or check-suite reports unexpected MISSING lines. Re-verify each owned file against actions 1-8; if sibling Interface mismatches appear, check that NEVER_INVOKE sibling rows were NOT modified (D22) — if they were, restore them. If sync --write touched csm-deep-research/SKILL.md, restore it (D17). If check-suite exited 0 (corpus pre-seeded unexpectedly), verify no stray `*-research.md` file exists outside T004's scope and record a note. If a `lint gate: oxlint reported` MISSING line appears, fix the lint finding in the owned files (oxlint is installed; the gate runs). Never edit T001's file or sibling skills' files to make this gate pass. Re-run gate.

3. [pending] Wire the installer payload and update hardcoded test counts
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: `scripts/pack-bootstrap.mjs`, `bootstrap/package/payload/skills/csm-deep-research/` (new), `bootstrap/payload-index.json`, `tests/package-audit.test.mjs`, `tests/integration/bootstrap-flow.test.mjs`, `tests/protocol/protocol.test.mjs`
   - Not in scope: contracts/boilerplate/check-suite/README (T002); seed (T004); review (T005); any other test file
   - Spike candidate: none
   - Actions:
     1. `scripts/pack-bootstrap.mjs`: add `'csm-deep-research'` to the skillDirs array at line ~18, keeping the array sorted (between `'csm-build'` and `'csm-grill'`). No change to mapping.skills (derived) or supportingFiles (single-file skill).
     2. Run `node scripts/pack-bootstrap.mjs` from the repo root. Verify it created `bootstrap/package/payload/skills/csm-deep-research/SKILL.md` and refreshed `bootstrap/payload-index.json` (new sha256/bytes entry, path-sorted between csm-build and csm-grill). Record the printed digest in the journal.
     3. `tests/package-audit.test.mjs`: line 11 skillNames — insert `'csm-deep-research'` at sorted position (between `'csm-build'` and `'csm-grill'`); line 90 `8` -> `9`; line 108 `>= 118` -> `>= 119`.
     4. `tests/integration/bootstrap-flow.test.mjs`: line 16 skillNames — same insertion; line 42 `8` -> `9`.
     5. `tests/protocol/protocol.test.mjs`: line 27 skillsPlaced deepEqual array — insert `'csm-deep-research'` at sorted position.
     6. Run `node --test --test-concurrency=1 tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs` — all must pass. (D21: serialized because each suite invokes packBootstrap() which rewrites repo payload files with deterministic identical bytes; running them is sanctioned and the payload refresh must be re-run after the suites so the committed payload matches the final skillDirs state.)
     7. Re-run `node scripts/pack-bootstrap.mjs` once more after the suites, then verify `diff -rq bootstrap/package/payload/skills/csm-deep-research csm-deep-research` is clean.
   - Acceptance signal: from repo root:
     ```
     set -o pipefail
     node scripts/pack-bootstrap.mjs >/tmp/opencode/t003-pack.log && diff -rq bootstrap/package/payload/skills/csm-deep-research csm-deep-research
     node --test --test-concurrency=1 tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs 2>&1 | tee /tmp/opencode/t003-tests.log | tail -20; s=$?
     [ $s -eq 0 ] && grep -q '^# pass' /tmp/opencode/t003-tests.log && echo GATE-PASS
     ```
     Expected: pack succeeds with digest printed; no diff output; all three test files pass (`# pass` for each). Record outputs.
   - Validation: `node --test --test-concurrency=1 tests/resume-semantics.test.mjs` still passes (unaffected, sanity); payload-index.json entry present with sha256 matching `sha256sum csm-deep-research/SKILL.md`.
   - Acceptance evidence: test outputs + digest recorded in the journal.
   - Repair attempts: 0
   - Recovery note: partial = payload regenerated but tests fail. Re-check list insertions at the pinned lines (alphabetical order); re-run pack only after skillDirs is correct; do not hand-edit payload-index.json (always regenerate via pack-bootstrap.mjs).

4. [pending] Seed the research corpus and run the full verification battery
   - Task ID: T004
   - Depends on: T001, T002, T003 (bootstrap suites in the battery read the refreshed payload, which only exists after T003)
   - Parallel group: G3
   - Risk: low
   - Owned scope: `.agents/research/2026-08-20-csm-deep-research-skill-research.md` (new dir + file only)
   - Not in scope: .agents/README.md (T002 owns the index line); review doc (T005); any source file
   - Spike candidate: none
   - Actions:
     1. Author `.agents/research/2026-08-20-csm-deep-research-skill-research.md` answering "how should the csm-deep-research skill be designed" — a genuine research finding grounded in `.agents/approaches/2026-08-20-csm-deep-research-skill-approach.md` (its Research Synthesis: suite conformance manifest, external research patterns — Anthropic multi-agent research system, MT-Bench judge biases, RARR/SAFE, CLAMBER, NN/g progressive disclosure — and the csm-review-skill run precedent) plus this plan's Current-State Evidence.
     2. Frontmatter: `---` / `format: csm-deep-research/1` / `---`. Exactly one H1 with the concrete title `# csm-deep-research Skill Design Research Finding` (part 1 of the 9-part skeleton).
     3. H2 sequence EXACTLY (order matters, must match the Required Research Document template fence in the SKILL.md per DR-9/RD-5): `## TL;DR`, `## Executive Summary`, `## Key Findings`, `## Detail Sections`, `## Recommendation`, `## Unverified Claims`, `## References`, `## Process Appendix`. No other H2s outside fences; no numbered `### ` headings (the corpus has no heading-number checks, but keep the finding clean).
     4. Content per the 9-part skeleton (D7): TL;DR 1-3 lines; Executive Summary with an ASCII overview diagram; Key Findings numbered with verdicts + citations; Detail Sections each opening with a 1-line summary and liberal ASCII/Mermaid diagrams — ALL diagrams inside ```text or ```mermaid fences so h2Titles can never pick up a stray `## ` line from bare ASCII art; Recommendation with rationale; Unverified Claims honest; References with source URL + retrieval date (retrieval date 2026-08-20); Process Appendix with the design decision trail.
     5. Run the full battery from repo root (serialized bootstrap suites per D21):
        - `node scripts/check-suite.mjs` — must exit 0 (fully green; research corpus now non-empty).
        - `node scripts/sync-skill-boilerplate.mjs --check` — clean.
        - `node scripts/gen-readme-matrix.mjs --check` — clean.
        - `node --test --test-concurrency=1 tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs` — green.
        - `node --test --test-concurrency=1 tests/resume-semantics.test.mjs` — green (plan corpus checks).
        - `make lint` — run only if `node_modules/.bin/oxlint` exists; must pass; otherwise record the skip notice.
   - Acceptance signal: from repo root:
     ```
     node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check
     ```
     Expected: check-suite exit 0 with the research-corpus checks passing; both --check clean. Record outputs.
   - Validation: seed file renders per the skeleton (H2 order verified by the corpus subsequence check itself); diagrams balanced; no `### ` numbered headings.
   - Acceptance evidence: battery outputs recorded in the journal.
   - Repair attempts: 0
   - Recovery note: partial = seed exists but corpus check fails. Re-verify H2 sequence + frontmatter against the SKILL.md template fence; re-run check-suite. If the SKILL.md template changed under T005 remediation, align the seed to it. If the battery fails on the bootstrap suites, verify T003 completed first (payload refresh) and re-run with --test-concurrency=1.

5. [pending] Hostile review, remediation, and final gate
   - Task ID: T005
   - Depends on: T003, T004
   - Parallel group: G4
   - Risk: standard
   - Owned scope: `.agents/docs/csm-deep-research-skill-review-2026-08-20.md` (new file); remediation may edit any earlier deliverable
   - Not in scope: new functionality beyond findings; any repo change unrelated to findings; sibling skills' content
   - Spike candidate: none
   - Actions:
     1. Dispatch FIVE parallel fresh-eyes review subagents (none authored the deliverables): (a) conformance — every check-suite/frontmatter/machine/boilerplate/README/test requirement; (b) coverage — the skill's runtime instruction set covers all 14 grill decisions and the 9-part skeleton; (c) CSM integrity — state machine, cycle rules, termination rules, journal, quota note, write discipline, done criteria coherent; (d) safety — write discipline, temp dirs, no repo mutation, no secrets, no destructive commands; (e) executability — a fresh agent could run the skill end-to-end from the text alone (triage, clarification flag, subagents, judge rubric, tiers).
     2. Each pass returns numbered findings R-N with severity, affected section, reasoning, concrete correction. Reviewers receive the deliverables (csm-deep-research/SKILL.md, contracts/boilerplate/check-suite diffs, README, tests, payload, seed) and this plan; they never write files.
     3. Primary triages all findings (recorded reasoning for every dismissal — do not dismiss without recorded reasoning). Remediate via fresh subagents (never the critics): fix the SKILL.md or integration per each accepted finding; T001-pinned strings remain authoritative unless a review pass proves a gate mismatch — then align to the gate.
     4. Record every finding + resolution in this plan's Critique Resolution table and in the review doc.
     5. Final gate — re-run from repo root and record:
        - `node scripts/check-suite.mjs` exit 0
        - `node scripts/sync-skill-boilerplate.mjs --check` clean
        - `node scripts/gen-readme-matrix.mjs --check` clean
        - `node --test --test-concurrency=1 tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs tests/resume-semantics.test.mjs` green
        - `node scripts/pack-bootstrap.mjs` re-run (payload refresh) + `diff -rq bootstrap/package/payload/skills/csm-deep-research csm-deep-research` clean
        - `make lint` (only if `node_modules/.bin/oxlint` exists) clean
        - `git status --porcelain` reviewed: ONLY the intended file set present — new: `csm-deep-research/SKILL.md`, `.agents/research/2026-08-20-csm-deep-research-skill-research.md`, `.agents/docs/csm-deep-research-skill-review-2026-08-20.md`; modified: `scripts/lib/contracts.mjs`, `scripts/lib/boilerplate.mjs`, `scripts/check-suite.mjs`, `README.md`, `.agents/README.md`, `scripts/pack-bootstrap.mjs`, `bootstrap/payload-index.json`, `bootstrap/package/payload/skills/csm-deep-research/SKILL.md`, `tests/package-audit.test.mjs`, `tests/integration/bootstrap-flow.test.mjs`, `tests/protocol/protocol.test.mjs`; plus this plan file `.agents/plans/2026-08-20-csm-deep-research-skill-csm.md` (renamed from `.draft` and committed at plan SAVED — tracked before the build starts). Nothing else.
     6. Fill the Completion Review section of this plan with the final verification evidence.
   - Acceptance signal: from repo root:
     ```
     node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check
     ```
     Expected: all clean; PLUS every R-N id appears in the Critique Resolution with a resolution; PLUS the final `git status --porcelain` matches the intended set (recorded in the journal). Record all outputs.
   - Validation: five per-pass verdicts present in the review doc; remediation diff reviewed; re-run of the full T004 battery.
   - Acceptance evidence: final gate outputs, review doc, Critique Resolution, Completion Review all recorded in the plan journal.
   - Repair attempts: 0
   - Recovery note: partial = some findings unremediated or a gate red. Keep the review doc as source of truth for pending R-N ids; fix forward (never delete findings); re-run the final gate; if blocked by a user decision, record BLOCKED in Control and stop.

## Verification Strategy
- Cheap per-task gates: T001 gate command (self-contained grep/wc checks) and T002 gate (imports + matrix/sync --check + strict PIPESTATUS-captured check-suite with the single tolerated corpus-empty line), run at task completion; T003 (pack + diff + 3 test files serialized); T004 (check-suite + --check pair + battery).
- Expensive/final gates: full `node scripts/check-suite.mjs` (green) at T004 and again at T005; bootstrap suites at T003/T004/T005 (always `--test-concurrency=1`, D21); `make lint` at T004/T005 (only when `node_modules/.bin/oxlint` exists); final `git status --porcelain` review at T005.
- Parallelizable: the three bootstrap test files run in one serialized `node --test` invocation; the five review passes at T005 run concurrently.
- Environment sensitivity: `make lint` is skipped with a notice when `node_modules/.bin/oxlint` is absent; `node --test` bootstrap suites rewrite payload files with deterministic identical bytes (benign, see D21); no network-dependent checks.

## Risks And Recovery
- Boilerplate drift (highest): synced sections byte-compared once registered. Mitigation: T001 embeds the exact pinned renders (RD-1); T002 zero-drift gate (D17); T005 conformance pass. Recovery: align via boilerplate.mjs + sync --write only.
- Registry divergence: unregistered skill silently bypasses gates. Mitigation: T002 registers MANIFEST before any gate relies on it (serialized after T001); T004/T005 run the full battery.
- NEVER_INVOKE edit errors (D22): touching sibling rows breaks sibling bullets. Mitigation: pinned single-row addition; T002 validation asserts sibling rows byte-unchanged via git diff.
- Cross-file gate coupling (RD-7): check-suite gates reach into the SKILL.md and the payload. Mitigation: serialized G1 -> G2 -> G3 -> G4; tolerated-failure sets asserted precisely at each gate.
- Payload digest churn: refresh is plan-sanctioned; digest recorded at T003; T005 re-diff after a final pack.
- Test-count misses: three pinned files with exact lines; T003 validation re-runs suites.
- Bootstrap-suite payload rewrites (D21): deterministic identical bytes; final pack re-run in T003 action 7 and T005 final gate keeps the committed payload canonical.
- Copy-then-adapt drift in the skill text (state chain, sections, rubric): pinned strings in T001; T005 executability pass validates the text as a whole.
- Rollback: each task's owned files are small and revertible via git; the plan is checkpointed per cycle by csm-build; a failed gate blocks forward motion rather than shipping red.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| R1: NEVER_INVOKE 9x9 append-to-all-rows breaks 8 sibling bullets | critical | D22: add only the new row (self=false); expected derives from filtered row keys (check-suite.mjs:444); sibling rows/bullets untouched | Code-read :432-447; critique simulation |
| R2: T002 gate cannot pass while T001 unfinished (dead-registry/README/layout/boilerplate/template failures) | critical | Serialize: T002 depends on T001; G1 = T001 alone; tolerated set = corpus-empty only | Critique simulation; RD-7 |
| R3: T001 gate H1 count fence-blind (template H1 counted) | critical | Gate counts `^# csm-deep-research$` exactly 1; pin "no other H1 lines" | Gate rewrite in T001 |
| R4: Stale "red baseline" (fixed upstream by 5faf3c8) | major | D15 superseded; evidence re-pinned to green baseline 522 checks; no frontmatter fix task | Verified check-suite run at HEAD |
| R5: T001 gate fence-count `-ge 4` fails conforming file | major | Relax to `-ge 2` + even; pin fence inventory in action 14 | Gate rewrite in T001 |
| R6: Hidden dependency T004 -> T003 (bootstrap suites read payload) | major | T004 depends on T001+T002+T003; graph updated | Test-source read; critique simulation |
| R7: Journal Next-state "ready for csm-build" invalid | major | Next state set to RECOVER (MACHINE_ENUM token) | validatePlanJournal read (plan-validation.mjs) |
| R8: Recovery notes don't name concrete blockers | major | Rewritten per task with named failing checks + escapes | Remediation pass |
| R9: T002 tolerated set inaccurate | major | Serialization makes corpus-empty the ONLY tolerated line; gate asserts it via PIPESTATUS | Remediation pass + RD-7 |
| R10: File:line pins stale | minor | Re-pinned to HEAD 5faf3c8 numbers throughout Current-State Evidence | Verified reads at HEAD |
| R11: "328-check" count stale | minor | Baseline now "8 skills, 522 checks"; noted | check-suite run |
| R12: "tests write only temp dirs" false | minor | D21: serialized suites + payload rewrite note + final pack re-run | pack-bootstrap.mjs:99-112,152 |
| R13: T002 gate masks check-suite exit via tee | minor | PIPESTATUS capture + exact tolerated-line assertion | Gate rewrite in T002 |
| R14: README:91 "need no further setup" stale | minor | D18: add csm-deep-research to that list | README:91 read |
| R15: Final-gate intended set omits the plan file | minor | Enumerated, including the renamed plan file | Remediation pass |
| R16: T001 `### ` checks fence-blind | minor | Pin "no `### ` lines inside fences"; keep count == 9 | Action 14 pin |
| R17: "9-part" skeleton lists 8 H2s | nit | D7: part 1 = H1 title; exactly 8 H2s | Remediation pass |
| R18: make lint conditional under-specified | nit | Gate on `node_modules/.bin/oxlint` existence | Makefile:13 read |
| R19: T002 gate PIPESTATUS is bash-only; platform shell is zsh | major | `set -o pipefail` + `s=$?` (portable), same for T003 acceptance (R23) | Round-2 critique; verified under zsh |
| R20: live pre-commit hook blocks commits while corpus empty | major | DR-14: defer commits until T004's green battery; earlier commits --no-verify with recorded reason | `git config core.hooksPath` = scripts/hooks; .lefthook.yml:17-19 |
| R21: Current-State Evidence misstates 7350a78 (no token-efficiency.json in tree) | minor | Re-pinned: 7350a78 changed only the cache-token-efficiency plan; vacuous exclusion removed | `git show 7350a78 --stat` |
| R22: README:240 orchestration list omitted from D18 | minor | D18 + T002 action 4 include line 240 | README:240 read |
| R23: T003 acceptance masks node --test exit via tail | minor | pipefail + tee + captured `s=$?` + `# pass` grep | Round-2 critique |
| R24: 340-420 line gate called "target" | minor | Wording: hard gate with pad/trim guidance in action 14 | Round-2 critique |
| R25: T002 recovery note misses pre-seeded-corpus and lint-gate cases | minor | Extended recovery note | Round-2 critique |
| R26: synced-section pins omit required leading blank line | minor | Actions 4/13 pin "heading, one blank line, then body" | Render output begins with `\n` |
| R27: "already committed" for the plan file inaccurate at draft time | nit | T005 wording: renamed + committed at plan SAVED | git status |
| R28: state bodies vs ordinal sequencing | nit | Action 14 pins prose/semicolon bodies, no numbered lists in state headings | validateOrdinalSequencing read |
| R29: seed H1 literal placeholder + bare-ASCII diagram risk | nit | T004 pins concrete H1 title + diagrams inside fences | h2Titles semantics |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE -> DISCOVER -> RESEARCH -> DRAFT -> CRITIQUE -> REMEDIATE -> CRITIQUE -> REMEDIATE | — | Approach consumed (format csm-grill/1 OK); baseline green (522 checks) at HEAD 7350a78; round-1 critique 18 findings remediated; round-2 fresh-eyes critique 11 findings (2 major: zsh-safe gates, commit policy DR-14) remediated; draft re-pinned | VERIFY |

## Completion Review
<filled by csm-build when all criteria are verified>
