# Build csm-review Skill CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 4 tasks — 1 low (README docs), 3 standard (new-skill SKILL.md is a public-interface artifact; review + remediation tasks are report/plan-only). No security/data/destructive tasks; all writes are documentation files inside this repository.

## Control
- Plan ID: csm-review-skill
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-15 build cycle 1 — all 4 tasks complete; 45 review findings repaired and verified; T004 final gate FINAL-GATE-PASS; Completion Review filled
- Next transition: none (terminal)
- Active tasks: none
- Blockers: none

## Goal

Build `csm-review`, the eighth skill in this suite: an extremely detailed, adversarial, multi-agent repository-review skill that itself runs as a cyclic state machine (CSM). Given a target repository, csm-review systematically detects and reports every category in the canonical list below, then saves a single findings report.

Canonical category list (from the user's brief; every category must map to ≥1 review dimension):
- C1 defects/issues
- C2 technical debt
- C3 poor practices
- C4 bad patterns/anti-patterns
- C5 unsafe code (security implementation weaknesses, memory/resource safety)
- C6 unsafe practices (security control gaps, secrets exposure, missing input validation)
- C7 test presence/absence and coverage
- C8 test-type adequacy — unit, integration, e2e, performance, property-based, mutation, fuzz, security
- C9 outdated libraries/packages
- C10 outdated tooling
- C11 outdated language versions
- C12 race conditions and concurrency hazards
- C13 CVEs/vulnerable dependencies
- C14 other concerns — error handling, observability/operability, CI/build quality, docs, licensing

Deliverables:
1. `csm-review/SKILL.md` — a single-file orchestration skill (no lib/, scripts/, or tests) implementing the review CSM, adversarial protocol, dimension taxonomy, findings model, safety posture, and report format specified in Design.
2. `README.md` updated to wire csm-review into the suite (touchpoints listed in Design D9), fixing the existing 16-vs-17 csm-scan dimension staleness, while integrating with (never reverting) any concurrent edits from the tmux-bootstrap-extension plan.

Constraints:
- csm-review is review-only: it never fixes reviewed code, never invokes csm-plan/csm-build/csm-scan automatically, and ends at a SAVED report.
- The only writes to a reviewed repository are the report file (with embedded control journal) under `.agents/reviews/`.
- No implementation of csm-review itself beyond the SKILL.md document and README edits (this plan builds a skill document, not code).

Exclusions (anti-scope):
- No lib/, scripts/, package.json, or test suite for csm-review (orchestration-skill shape, like csm-grill/csm-plan).
- No changes to any other skill's SKILL.md, to csm-scan code, or to .gitignore.
- No running of csm-review against a real repository during the build (validation is structural + review-based; live invocation is post-build usage).

## Acceptance Criteria

1. `csm-review/SKILL.md` exists as a single file of 200–340 lines passing the T001 structural gate: the embedded bash one-liner verifies frontmatter `name: csm-review`, the full state-line string `INTAKE -> SCOPE -> EVIDENCE -> FIND -> CHALLENGE -> ADJUDICATE -> VERIFY -> SAVED -> STOP`, all required section headers (Activation Boundary, Core Rules, Scale To The Ask, Execution Posture, Review State Machine, Review Dimensions, Finding Record, Report Format, NORMS.md, Subagent Resilience, Anti-Patterns, Done Criteria, STOP), the literal boundary phrase `never fixes`, and all 18 dimension names. Evidence: gate output `GATE-PASS` recorded in Acceptance Evidence.
2. SKILL.md defines a cyclic review state machine (D2) in which every critical/high/medium finding is challenged by an agent that did not author it; low/info findings are challenged per Scale To The Ask (primary-led challenge acceptable with recorded independence caveat). Evidence: rg checks for the state line, the CHALLENGE subsection, and the finder-not-challenger rule.
3. Every canonical category C1–C14 maps to at least one review dimension: a coverage matrix (category → dimension(s) → SKILL.md anchor) recorded in T004 Acceptance Evidence shows 14/14 mapped, verified by `grep -q` per dimension name in SKILL.md.
4. The findings model in SKILL.md specifies: severity spine (critical/high/medium/low/info) with CVSS-B score+vector+assumptions overlay for dependency/CVE findings (and tool-verified exploitation findings); confidence (verified/high/medium/low) anchored to evidence classes E1–E4, orthogonal to severity; the finding-record field list; two-stage dedup via line-number-free fingerprints; and the snippet/redaction policy (never quote secret values; `[REDACTED:<type>]`). Evidence: T001/T004 gate markers (`CVSS`, `E1`, `E4`, `REDACTED`, `fingerprint`, `upheld`, `retracted`, `sort_key`).
5. The execution-posture section specifies rungs R0–R3 with the sandbox recipe (fresh /tmp sandbox, `--depth 1`, no submodules, env redirection, time bounds, post-run containment check over monitored locations), the egress rule (blocked where a mechanism exists; otherwise network-avoiding test selection with disclosed residual risk), and forbidden actions. Evidence: T001/T004 gate markers (`R0`, `R3`, `forbidden`, `--depth 1`).
6. README.md wires csm-review into every D9 touchpoint (T002 gate: `csm-review` appears on ≥8 lines including the skills-table row `csm-review/SKILL.md`, the usage step referencing `.agents/reviews`, and a mermaid node `review[`), no longer contains "16 evidence dimensions", states 17, and preserves tmux-bootstrap content (`csm-plan-<goal-slug>` still present). Evidence: T002 gate output `README-GATE-PASS`.
7. An independent hostile review of the completed SKILL.md exists at `csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md` with per-pass verdicts (conformance, coverage, CSM integrity, safety, executability) and findings numbered `R-1, R-2, …` (or the literal line `Findings: none`); every R-N finding is resolved, disproved, or deferred with recorded reasoning in this plan's Critique Resolution table. Evidence: T003 + T004 gates.
8. Suite conformance: SKILL.md matches the house skeleton — frontmatter description ending in a Never-X clause, Activation Boundary with SAVED terminal display-and-stop behavior, Scale To The Ask with "reduces depth, never the required structure" semantics, Anti-Patterns, Done Criteria, and house commit/display conventions. Evidence: T003 conformance pass verdict recorded in the review doc.

## Current-State Evidence

- Repository at HEAD `cca5396` (2026-08-15 18:30); clean tree. Concurrent user activity preserved and modeled: `a31ca88` (csm-plan tmux bootstrap), `a69b625` (README documents it), and `cca5396` — which commits a second, not-yet-executed plan `.agents/plans/2026-08-15-csm-tmux-bootstrap-csm.md` ("extend tmux session bootstrap to csm-build, csm-bdd-tdd, csm-scan") whose deliverables edit README.md (Requirements tmux bullet, skills-table rows, Usage steps — the same areas as this plan's T002) plus three other SKILL.mds. T002 must integrate with whatever that plan lands, by content grep, never reverting it (see Risks).
- This planning session verified it already runs inside tmux (`TMUX=/tmp/tmux-1000/default,...`), so the bootstrap's skip-when-inside-tmux clause applied; planning continued in-session.
- Suite inventory: 7 skills (README.md intro); orchestration skills are single-file with no test suite — "validate by invoking them" (README Development & testing). Sibling SKILL.md sizes at the a69b625 baseline: csm-grill 207, csm-plan 251, csm-bdd-tdd 261, csm-build 225 (the tmux-extension plan will grow three of these; T001 must not cite sibling line counts, only the 200–340 own-budget).
- The one real in-repo adversarial multi-agent review precedent: `csm-scan/.agents/docs/csm-scan-review-2026-08-02.md` — 5 facet reviewers, verdict conventions P0/P1/P2 + Present/Partial/Absent, file:line evidence mandate; its P0 list became the remediation backlog (plan `7423fa7` → complete `ad741e0`). Gaps it left (no verification pass, no dedup ledger, no severity rubric beyond one-liners) are closed by this design.
- Subagent empty-result incidents are a known live reliability issue: 12 recorded incidents + fallbacks across plan journals (e.g. `.agents/plans/2026-08-03-csm-grill-skill-csm.md:232`; `csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md:547` "third minimal-prompt dispatch landed"). This planning session hit 4/5 empty first-batch research returns; all four succeeded on re-dispatch.
- Sandbox execution feasibility proven live during planning (R&D record R6): clone + test-run + containment check passed; zero writes detected outside `/tmp/opencode/csm-review-exp-20260815-181506/` in monitored locations.
- External anchors verified live 2026-08-15 (R2): OWASP Top 10 now 2025 edition; CWE Top 25 2025; ASVS v5.0.0 (2025-05-30); TSan wiki (2022); test-smells catalog live; OSV API + endoflife.date API verified auth-free with live queries. Rotted: sqale.org, iso25000.com 25010 page, old SonarSource code-smells URL (replacement verified).
- README staleness: skills-table csm-scan row says "16 evidence dimensions" while csm-scan/SKILL.md:18 says 17.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Skill name is `csm-review`; it must itself run as a CSM including adversarial agentic reviews; coverage must include categories C1–C14 | user-dictated | User brief 2026-08-15; canonical list derived from the brief's own wording | decided |
| A2 | csm-review is a single-file orchestration skill (SKILL.md only, 200–340 lines), not a code-backed tool | evidence-based | Deterministic inventory already exists (csm-scan); review is agentic judgment work; csm-grill precedent shipped single-file deliberately (2026-08-03-csm-grill-skill-csm.md A7); suite split: scan inventories / review judges | decided |
| A3 | csm-review judges; csm-scan inventories. csm-scan = neutral facts, no judgment (voice gate); csm-review = severity-tagged findings | evidence-based | csm-scan voice-gate history (2026-08-02-csm-scan-language-parity plan); user asked for issues/debt/unsafe, i.e., judgment | decided |
| A4 | Report home: `.agents/reviews/<yyyy-mm-dd>-<repo-slug>-review.md` at the reviewed repo's git root (cwd if not a repo), with embedded Control journal mirroring plan documents. Artifact dates always use the plan save date (2026-08-15) even if the build runs later | evidence-based | Plans/approaches precedent (.agents/ subdirs, dated slugs); journal-in-document precedent (csm-plan Control/Progress Journal); no `REVIEW.md` root-file precedent exists | decided |
| A5 | Default posture R0 (static + auth-free external queries); rungs R1–R3 only inside the mandated sandbox recipe; never in-place; sandbox execution attempted only when the target repo is local and the user has not declined | evidence-based | R3/R6: install/test of foreign code executes arbitrary code (npm scripts, PEP 517, build.rs); sandbox experiment proves containment; osv-scanner docs themselves warn on untrusted projects | decided |
| A6 | Severity ⊥ confidence; 5-level spine; CVSS-B overlay (score+vector+assumptions together, FIRST disclosure rule) for dependency/CVE findings and tool-verified exploitation findings only; confidence anchored to evidence classes E1–E4 | evidence-based | R5: CodeQL/GitHub separate severity from precision; SonarQube hotspots withhold severity until certainty; FIRST requires vector disclosure; LLM-authored vectors without exploitation proof are pseudo-precision (critique finding 27) | decided |
| A7 | Finder ≠ challenger: findings authored by one agent are challenged by a different agent before adjudication; primary adjudicates and never delegates the VERIFY gate | evidence-based | R1: intrinsic self-correction fails (arXiv:2310.01798); SGCR propose-then-verify with separate verifier ensemble; csm-build REVIEW non-author rule | decided |
| A8 | csm-review never fixes; findings carry remediation sketches only; the report's How-To-Execute note points to future explicit csm-plan/csm-grill invocations | user-dictated + evidence | Suite invariant "planning never silently becomes implementation" (README core loop); grill terminal-state precedent | decided |
| A9 | Report commits itself in a single commit staging only the report, unless user declines; never push | evidence-based | csm-plan SAVED commit rule | decided |
| A10 | NORMS.md consumed as optional, validated, ≤30-day-fresh hints that are re-verified, never trusted as ground truth | evidence-based | csm-build detection/validation rules; csm-scan claim-status model (unverified/inferred statuses must not propagate) | decided |
| A11 | Subagent failure fallback ladder is first-class skill text: minimal-prompt retry → re-dispatch → fresh agent → primary completion / primary-led challenge (low/info findings only, journaled with independence caveat); critical/high/medium never bypass independent challenge — retries continue or the finding's confidence is capped with a recorded caveat | evidence-based | 12 recorded incidents; only recorded prompt-level mitigation that worked was minimal-prompt retry | decided |
| A12 | Live invocation of csm-review against a real repo is out of scope for the build; validation is structural gates + hostile review (T003) — matching the suite's "validate by invoking" convention for orchestration skills, performed post-build by the user | evidence-based | README "orchestration skills … validate by invoking them" | decided |
| A13 | Target intake: a local repository path or cwd; a remote URL is cloned `--depth 1` into the sandbox at INTAKE and the clone becomes the pinned citation source | evidence-based | Critique finding 22; sandbox recipe already covers clone mechanics | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What architectures reduce hallucination in agentic review? | Web research: SGCR (arXiv:2512.17540), RovoDev (arXiv:2601.01129), BitsAI-CR (arXiv:2501.15134), AutoCommenter (arXiv:2405.13565), survey (arXiv:2602.13377), self-correction (arXiv:2310.01798) | Read-only retrieval; repo clean | Staged pipelines (find → independent verify → filter/dedup → rank) beat single-shot; SGCR dual-pathway (anchor-walking + free proposal) 42% vs 22% adoption; verifier must differ from proposer; guidelines dominate prompt quality; ReviewFilter raised precision 57→75% | CHALLENGE state with finder≠challenger; anchor-walking + free proposal in FIND; dedup in ADJUDICATE; parallel reviewer tracks in T003 |
| R2 | Which detection-taxonomy anchors are live and current? | Web verification of ~25 candidate anchors | Read-only retrieval | OWASP Top 10:2025, CWE Top 25 2025, ASVS 5.0.0, TSan wiki, Go race docs + memory model, test-smells.github.io, PIT/Stryker/mutmut, hypothesis/fast-check, eng-practices, Fowler quadrant/coverage, ISTQB CTFL v4.0.1, endoflife.date (464 products), OSV.dev all live; sqale.org + iso25000.com rotted; SonarSource URL moved (replacement found) | 18-dimension taxonomy (D3) with per-dimension anchors + editions; skill instructs verifying anchors at review time |
| R3 | Safe execution posture for foreign repos? | Web research: npm/pip/cargo docs, Backstabber's Knife Collection (arXiv:2005.09577), git 2.45.1 relnotes, osv-scanner docs | Read-only retrieval | Install/build runs foreign code (lifecycle scripts, PEP 517, build.rs); audit tools passive; mutation/race/coverage inherently execute tests; clone itself had CVEs (submodules) | R0–R3 ladder + forbidden rung (D6); `--depth 1`, no submodules, scripts-disabled installs, time bounds, containment checks, egress rule |
| R4 | Suite precedents (CSM shapes, severity, outputs, boundaries, README wiring)? | Read-only local mining: all SKILL.mds, plan journals, csm-scan review docs, git log | Read-only; git clean throughout | House skeleton extracted; 12 subagent-failure incidents + fallbacks; house finding format (location+severity+reasoning+file:line+correction); README touchpoints + 16-vs-17 staleness; csm-scan redaction list | SKILL.md structure (D1); fallback ladder (D8); report format (D7); T002 wiring list (D9) |
| R5 | Finding schema + severity/confidence models? | Web research: CVSS v4.0 user guide, SARIF 2.1.0 spec, SonarQube docs, eng-practices, CodeQL metadata, GitHub SARIF docs | Read-only retrieval | SARIF has no confidence concept (property bags used); severity↔certainty separation is industry norm; SARIF fingerprints exclude line numbers; pentest-report conventions demand methodology + reproducibility | Schema, dual-scale severity, E1–E4, sort key, dedup, report skeleton with anti-coverage (D5, D7) |
| R6 | Does clone→run→containment-check work mechanically? | Bounded sandbox experiment: `git clone --depth 1 file://<repo>` into fresh sandbox; `node --test test/ignore.test.mjs` in clone with HOME/TMPDIR/XDG redirected | Baseline `ad741e0` clean before and after; no writes detected outside sandbox in monitored locations; clone git status clean post-run | 6/6 tests pass in 276 ms; containment held | Sandbox recipe in D6 proven feasible; R1–R3 rungs practical |
| R7 | OSV + endoflife APIs usable auth-free? | Live queries: POST api.osv.dev/v1/query (lodash 4.17.20), GET endoflife.date/api/nodejs.json | Read-only public-API queries | Both return correct data, auth-free; OSV docs state no current limits | R0 includes external CVE/EOL queries as evidence rung |

Note: first research batch returned 4/5 empty subagent results (known tooling flakiness); all four completed on re-dispatch. Incident + resolution recorded per A11.

## Discovered Requirements

1. Frontmatter: `name:` + `description:` that names triggers and ends with a Never-X clause (all four orchestration siblings).
2. SKILL.md line budget: 200–340 lines (critique-verified feasible at ~230–290 for mandated content; do not cite sibling line counts — they are moving under the concurrent tmux plan).
3. House finding format: affected location + severity + reasoning/impact + file:line evidence + concrete correction (csm-plan CRITIQUE precedent).
4. Boundary sentence patterns: copy csm-grill/csm-plan activation-boundary phrasing (D1); the literal words "never fixes" must appear.
5. NORMS.md detection order + authenticity markers + 30-day staleness warning: verbatim csm-build rules (D8).
6. Redaction: never quote secret values; `[REDACTED:<type>]`; import csm-scan's exclusion list (emails, names, absolute paths, URL credentials, secrets) into report-rendering rules.
7. Snippets: ≤5 lines, ≤200 chars, ≤3 per finding, verbatim from pinned commit SHA.
8. Dedup fingerprints must not include line numbers (SARIF Appendix B rule).
9. Anchor citations must carry editions (e.g., "OWASP Top 10:2025"); rotted anchors (sqale.org, iso25000.com) must not be cited.
10. README.md: locate touchpoints by content grep, never line numbers — the file moved at a69b625 and will move again when the tmux-extension plan lands; fix "16 evidence dimensions" → 17; integrate with, never revert, concurrent tmux edits.
11. Commit style: short imperative, skill- or plan-prefixed (e.g., `csm-review: …`); stage only files this execution changed; never push.
12. Concurrent-change rule: preserve user commits a31ca88/a69b625/cca5396 and any future tmux-plan output; never revert or overwrite unrelated content.
13. Acceptance-signal bash hygiene: patterns beginning with `-` must use `grep -q -e "$m"`; no placeholder text in signals; `grep -c` under `set -e` exits nonzero on zero matches — guard or require ≥1.
14. Artifact dates = plan save date (2026-08-15) even if the build executes later.

## Design

### D1 Shape, boundary, skeleton

Single-file `csm-review/SKILL.md`, 200–340 lines, following the house skeleton: frontmatter (name `csm-review`; description naming triggers — review/audit a repository for issues, debt, unsafe code, test adequacy, outdated dependencies, races, CVEs — and ending with the Never-X clause "Review-only: never fixes reviewed code, never invokes other skills; ends at a saved report") → title + intro (one paragraph: "csm-review judges what is wrong with a repository; csm-scan inventories what is there. Multi-agent adversarial review as a cyclic state machine producing a single dated findings report.") → Activation Boundary → Core Rules → Scale To The Ask → Execution Posture And Safety → Review State Machine → Review Dimensions → Finding Record → Report Format → NORMS.md (optional input) → Subagent Resilience → Anti-Patterns → Done Criteria.

Activation Boundary (house phrasing): activate when the user explicitly asks to review, audit, or assess a repository (or invokes csm-review by name). Target intake per A13. csm-review is review-only: it never fixes reviewed code, never generates patches, never invokes csm-plan/csm-build/csm-scan automatically; the report is findings plus remediation sketches, not a plan. `SAVED` is the terminal state: display the complete report, the saved path, the commit hash or skip reason, and stop — never ask whether to start fixing.

Core Rules (≥ these): primary agent owns orchestration, adjudication, and the VERIFY gate; subagents are finders, challengers, and researchers with bounded context; maximize parallelism with non-overlapping dimension/file ownership; every finding must be evidence-grounded — its citation must resolve at the pinned commit, and a finding whose citation does not resolve is retracted, not reported; severity assumes the finding is true, confidence carries the probability it is true — never blend them; never quote secret values; the only writes to the reviewed repo are the report file; obey the reviewed repo's instructions; findings use neutral professional language — criticism targets code, never people.

Scale To The Ask: QUICK pass (focused dimensions named by the user, single finder batch, primary-led challenge for low/info findings) vs FULL audit (all 18 dimensions, sandbox rungs where safe, independent challenge for every critical/high/medium finding); in both scales low/info findings may receive primary-led challenge with a recorded independence caveat. Proportionality reduces depth, never the required structure — every report still carries methodology, coverage, anti-coverage, and the findings model.

### D2 Review state machine

`INTAKE -> SCOPE -> EVIDENCE -> FIND -> CHALLENGE -> ADJUDICATE -> VERIFY -> SAVED -> STOP`

Cycle rules (cyclic, not linear): CHALLENGE -> FIND when challenge surfaces brand-new findings (bounded below); CHALLENGE -> EVIDENCE when verification needs a tool run or external query; ADJUDICATE -> EVIDENCE (missing evidence) or -> FIND (dedup reveals an unreviewed seam); VERIFY -> CHALLENGE (challenge-coverage gaps), VERIFY -> ADJUDICATE (schema/redaction/sort failures), VERIFY -> FIND (coverage-matrix gaps), VERIFY -> SCOPE (coverage plan itself wrong); SAVED only from VERIFY.

Adversarial cycle cap (termination rule): challenge-discovered findings enter at most one further FIND→CHALLENGE round. Total adversarial cycles per finding ≤ 2; beyond the cap the primary adjudicates with confidence capped at medium and a recorded "adversarially exhausted" caveat. This bounds CHALLENGE→FIND recursion.

Every transition is recorded in the report's embedded Control journal before proceeding.

1. INTAKE — classify QUICK vs FULL; resolve target (local path or cwd; remote URL cloned `--depth 1` into the sandbox per A13); posture decision per D6 (default R0; R1–R3 offered when repo is local and user has not declined); NORMS.md detect/validate per D8; pin the commit SHA (all evidence cites it; if the worktree is dirty or diverged from the pinned SHA, citations come from `git show <SHA>:<path>` / `git grep <pattern> <SHA>` rather than the worktree); create the report scaffold with Control journal at `.agents/reviews/<yyyy-mm-dd>-<repo-slug>-review.md` (git root of reviewed repo, else cwd; create only this directory/file). Exit: repo pinned, scale set, report scaffold written.
2. SCOPE — enumerate review surfaces (tree, manifests, CI, docs); partition large repos into chunks by module/domain with per-chunk context budgets (bdd-tdd Context Budget Rules analog); assign the 18 dimensions to finder agents with non-overlapping primary ownership; record the coverage plan AND the anti-coverage draft (what will not be reviewed and why: vendored/generated code, binaries, docs-only dirs, time-boxed-out areas — each with a risk note). Exit: dimension×chunk assignment matrix + anti-coverage draft recorded.
3. EVIDENCE — gather rung-appropriate shared evidence before finding: R0 static facts (manifest/lockfile inventory, test inventory, CI inventory); OSV querybatch per pinned dependency and endoflife.date per declared runtime; optional R1–R3 sandbox runs per D6. Every artifact records command, inputs, result, and containment evidence. Exit: shared evidence pack recorded; unavailable evidence labeled with its degradation.
4. FIND — dispatch parallel finder agents (one per dimension×chunk). Each finder receives: the dimension's anchor list (D3), the evidence-pack slice, its chunk map, the finding-record schema (D5), and both SGCR-pathway instructions: walk the anchors systematically AND propose issues the anchors don't name. Findings return with locations, snippet (redaction rule), anchor ref or null, proposed severity+confidence, impact reasoning. Finders never write the report; they return structured findings to the primary. Exit: raw findings ledger complete for all dispatched dimensions.
5. CHALLENGE — for every critical/high/medium finding (FULL) and as capacity allows elsewhere: an independent challenger agent — never the finding's author — receives the challenger view: title, dimension, anchor_ref, locations, quoted_snippet, proposed severity+confidence — deliberately NOT the finder's explanation/impact rationale, to avoid anchoring — plus the cited files at the pinned SHA, and attempts disproof: re-locate the citation; check reachability/exploitability against actual call sites; look for mitigations the finder missed; check anchor applicability. Verdict: agree / downgrade (proposed severity+confidence) / retract, each with rationale. Dissents recorded verbatim in the finding. Low/info findings may receive primary-led challenge with a recorded independence caveat. Exit: every in-scope finding carries ≥1 challenge verdict.
6. ADJUDICATE — primary-only. Two-stage dedup: (1) fingerprint = repo ‖ normalized path ‖ symbol/category ‖ anchor (no line numbers); (2) semantic merge of same-root-cause findings — union locations, keep best evidence class, record merged_from, increment corroborators. Independent discovery by ≥2 finders raises confidence one band (E3→high, E4→medium) — the sole confidence-raise path not requiring E1, applied only here by the primary. Apply challenge verdicts: status upheld/downgraded/retracted with adjudication rationale; severity is never averaged or summed across merges. Order the ledger by sort key (D5). Exit: adjudicated findings ledger + adjudication log complete.
7. VERIFY — primary-personal gate, never delegated: every finding has all schema fields required for its evidence class; every critical/high finding is E2+ (independently challenged) or explicitly caveated; coverage matrix filled (every dimension×chunk has a finding-or-clean verdict); anti-coverage honest (nothing quietly skipped); redaction pass over every snippet and verification output; report renders per D7; methodology discloses reviewers, tools, versions, timestamps, rungs actually used, and containment-check results. Cycle back per the cycle rules on any failure. Exit: report passes all gate checks.
8. SAVED — finalize the report file; unless the user declined, commit it in a single commit staging only the report (skip with a note if not a git repo); display the complete report plus saved path, commit hash or skip reason, posture rungs actually achieved, and residual unknowns. Then stop. Never invoke another skill; the report's How-To-Execute note states that remediation happens through a future explicit csm-plan or csm-grill invocation.

### D3 Review dimensions (18) and anchors

| # | Dimension | Covers | Anchor(s) (verify at review time; cite editions) |
|---|---|---|---|
| 1 | Correctness & defects | C1 | Google eng-practices (Functionality); ISO/IEC 25010:2023 functional suitability |
| 2 | Technical debt & architecture | C2 | Fowler TechnicalDebtQuadrant; ISO/IEC 25010 maintainability |
| 3 | Code smells & poor practices | C3 | SonarSource concepts (docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/concepts.md); Fowler Refactoring catalog |
| 4 | Anti-patterns | C4 | eng-practices (Design/Complexity) + per-stack framework docs |
| 5 | Security implementation weaknesses | C5 | OWASP Top 10:2025; CWE Top 25 (2025); CWE id per finding |
| 6 | Security control verification | C6 | OWASP ASVS v5.0.0 (per-requirement pass/fail) |
| 7 | Secrets & data exposure | C6 | CWE-798; ASVS v5 crypto/logging chapters; gitleaks-style rule families |
| 8 | Concurrency & races | C12 | TSan wiki (DetectableBugs, 11 classes); Go race detector + memory model; CWE-362/367/609/667 |
| 9 | Memory & resource safety | C5 | Sanitizers wiki (ASan/MSan); CWE-416/476/401 |
| 10 | Error handling & resilience | C14 | ISO/IEC 25010 reliability (fault tolerance, recoverability) |
| 11 | Input validation & trust boundaries | C6 | ASVS validation/encoding chapters; CWE-20 |
| 12 | Test presence & coverage | C7 | Fowler TestCoverage (coverage as heuristic, not target); per-module uncovered critical paths |
| 13 | Test quality | C7 | testsmells.github.io catalog (~21 smells); Google flaky-tests post (2016) |
| 14 | Test-type adequacy | C8 | Google Test Sizes S/M/L (integration/e2e/performance-Large); ISTQB CTFL v4.0 levels/types; PIT/Stryker/mutmut (mutation); hypothesis/fast-check (property); fuzz signal via OSS-Fuzz advisories in OSV |
| 15 | Dependency vulnerabilities | C13, C9 (vulnerable pins) | OSV.dev API (querybatch); CISA KEV via CWE KEV list |
| 16 | Toolchain & language currency | C9, C10, C11 | endoflife.date API (464 products); declared runtimes/toolchains vs EOL |
| 17 | Observability & operability | C14 | ISO/IEC 25010 operability; instrumentation inventory |
| 18 | CI, build, docs & licensing | C14 | SonarSource quality-gate concepts; eng-practices Documentation; license-hygiene inventory |

Dimension rows group for finder assignment: quality (1–4), security (5–7, 9, 11), concurrency (8), resilience (10), tests (12–14), supply chain (15–16), operations (17–18).

### D4 Adversarial protocol

- Finder agents: parallel, one per dimension×chunk, anchor-walking + free proposal (SGCR dual pathway); bounded context (evidence-pack slice + chunk map + schema); return structured findings, never prose essays.
- Challenger agents: independent of finders; receive the D5 challenger view (title, dimension, anchor_ref, locations, snippet, proposed severity+confidence — not the finder's rationale) plus cited files at the pinned SHA; must attempt disproof; verdict agree/downgrade/retract + rationale; challengers cannot raise severity or confidence (raises happen only via the adjudication corroboration bump or new E1 evidence).
- Primary: adjudicator and gatekeeper; triages every verdict; never dismisses a finding or dissent without recorded reasoning (csm-build REVIEW rule); owns VERIFY personally; enforces the adversarial cycle cap.

### D5 Findings model

- Severity spine: `critical / high / medium / low / info` (+ integer rank 4–0). CVSS v4.0 CVSS-B overlay (score AND vector AND assumptions[], FIRST disclosure rule; worst-case scoring per user-guide library guidance with a re-score-per-call-site note) applies to dependency/CVE findings and tool-verified exploitation findings; other security findings use the spine alone unless the primary can justify a vector with explicit assumptions.
- Confidence, anchored to evidence class, orthogonal to severity: `verified` (E1: deterministic tool reproduces — analyzer output, failing test, live OSV match), `high` (E2: ≥1 independent challenger agreed), `medium` (E3: cited static evidence at pinned SHA, challenged only by primary or unchallenged), `low` (E4: reasoned judgment; labeled as such in prose). Confidence may never exceed its evidence class; the sole exception path is the ADJUDICATE corroboration bump (independent discovery by ≥2 finders: E3→high, E4→medium; never to verified without E1).
- Finding record fields: id (`F-###` sequence), title (≤120 chars), dimension, category, anchor_ref (CWE/OWASP/ASVS id or null), severity + cvss{} where applicable, confidence + evidence_class, locations[] (file:line, primary first), quoted_snippet[] (policy below), commit_sha, explanation (2–6 sentences), impact, remediation_sketch (approach-level, not a patch), verification{method,command,result} | null (required for E1), challenges[] (verdict + rationale), dissents[] (unresolved disagreements), status (upheld/downgraded/retracted) + status_note, corroborators[], sort_key = (severity rank DESC, confidence rank DESC, evidence class DESC as tie-break, id ASC).
- Snippet policy: verbatim from pinned SHA; ≤5 lines, ≤200 chars, ≤3 per finding; secret-bearing lines replaced with `[REDACTED:<type>]`; report never contains raw credential values, personal data, or absolute paths (csm-scan exclusion list imported).
- Dedup: stage 1 fingerprint (repo ‖ normalized path ‖ symbol/category ‖ anchor; no line numbers); stage 2 semantic merge of same-root-cause findings (union locations, best evidence class wins, merged_from recorded); cross-dimension clusters stay split (a security and a maintainability finding on one line are two findings).

### D6 Execution posture and safety

Evidence rungs (every finding/verification records its rung):
- R0 `static` (default, always): read-only inspection at the pinned SHA; OSV querybatch + endoflife.date GET (auth-free, verified R7).
- R1 `sandbox-static-verified`: fresh sandbox `/tmp/opencode/csm-review-<run-id>/`; `git clone --depth 1` (file:// for local; never `--recurse-submodules`); env redirect HOME/TMPDIR/XDG_* into sandbox; scripts-disabled installs (`npm --ignore-scripts`, `pip --only-binary :all:`, prefer lockfile static resolution); build failure from disabled scripts is a finding-input, not an error — degrade to R0 labels.
- R2 `sandbox-collected`: dependency audits (npm/pip-audit/cargo audit in lockfile/no-fetch modes), test inventory (`--collect-only`), `go vet`-class static checks in sandbox.
- R3 `sandbox-executed`: bounded test run, coverage, `-race`/TSan where cheap, mutation dry-run/mini-run (Stryker `--dry-run` first; hard caps on mutants and wall time). Egress rule: network egress blocked during execution where a mechanism exists (`unshare -rn`, or a container with `--network none`); when no mechanism exists, select tests that avoid network and disclose the residual egress risk in Methodology. Every process time-bounded and terminated within the step.
- X forbidden (always): in-place runs against the reviewed repo; `fix`/upgrade/mutating package-manager commands; sudo/daemons; contacting production services; running anything from the reviewed repo outside the sandbox.

Containment check (required after every R1–R3 step): post-run `git -C <sandbox-clone> status --short` clean-or-explained; no writes detected in monitored locations (reviewed-repo git status, sandbox parent directory, redirected env paths); results disclosed in the report's Methodology section. R6 proves the recipe works mechanically.

Posture selection at INTAKE: R0 always; offer R1–R3 when the repo is local and the user has not declined; the Methodology section must disclose which rungs were achieved and what degraded to static labels.

### D7 Report format

```markdown
# Repository Review — <repo> @ <short-sha> (<date>)
## Control                    # embedded journal: state, cycle, posture rungs used, next transition; updated every transition
## How To Execute             # remediation happens via future explicit csm-plan/csm-grill invocations; this report fixes nothing
## Executive Summary          # 3-6 bullets: top upheld findings, systemic themes, overall posture sentence
## Methodology Disclosure     # reviewers (finder/challenger assignment), dimensions, tools+versions, rungs used, containment results, egress disclosure, timestamps, dedup method, anchor editions
## Coverage                   # dimension × chunk matrix with finding-or-clean verdicts
## Anti-Coverage              # what was NOT reviewed and why (vendored/generated/binaries/skipped), each with risk note — mandatory, never omitted
## Findings Summary           # counts by severity × dimension; confidence distribution; dedup stats (raw → upheld)
## Findings                   # adjudicated records rendered per D5 schema, ordered by sort_key; each with challenges + dissents + status
## Adjudication Log           # every downgrade/retraction with rationale
## Retracted Findings         # kept visible with disproof evidence (false-positive transparency)
## Reproducibility            # pinned SHA, commands, tool versions, sandbox paths
```

### D8 NORMS.md + subagent resilience

NORMS.md (optional input): detection order user-explicit → `<git-root>/NORMS.md` → `<cwd>/NORMS.md`; authenticity markers ("Generated by csm-scan" OR "## Repository Overview" + Code Conventions + Architecture sections); >30-day staleness warning; consumed as hints to re-verify — every NORMS.md claim used by a finding is verified against the repo before the finding reaches CHALLENGE; NORMS.md/finding contradictions become findings. Absent or inauthentic NORMS.md never blocks.

Subagent resilience (fallback ladder, journal every incident, never silently): minimal-prompt retry → re-dispatch → fresh agent → primary completion (for evidence gathering) / primary-led challenge (low/info findings only, with recorded independence caveat). Critical/high/medium findings never bypass independent challenge because of subagent failure — keep retrying, or cap the finding's confidence at medium with a recorded "challenge unavailable" caveat and surface it in residual unknowns.

### D9 README wiring (T002)

Touchpoints (locate by content grep — the file moved at a69b625 and will move again when the tmux-extension plan lands): (1) intro enumeration (seven → eight skills; add "adversarial repository review (`csm-review`)"); (2) mermaid workflow diagram (add a `review` node + edge, e.g., repo/scan → review → plan); (3) core-loop narrative sentence; (4) skills table — new row linking `csm-review/SKILL.md`; also fix the csm-scan row "16 evidence dimensions" → "17 evidence dimensions"; (5) Installation "copy the seven skill folders" → eight + "need no further setup" list; (6) Usage counts (four core → five orchestration; three tooling unchanged) + a typical-sequence step ("Review — `csm-review` → `.agents/reviews/<date>-<repo>-review.md`"); (7) repository layout (`csm-review/` entry); (8) Development & testing orchestration-skills list; (9) any other occurrence of "seven"/"7 skill" (grep to catch all). Requirements gains no new bullet (no runtime deps). Preserve all tmux content verbatim.

## Execution Graph

- G1 (parallel, disjoint file ownership): T001 owns `csm-review/SKILL.md` only; T002 owns `README.md` only.
- G2: T003 owns `csm-review/.agents/docs/` only; depends on T001 + T002.
- G3: T004 owns `csm-review/SKILL.md`, `README.md`, and this plan document; depends on T003.
- Critical path: T001 → T003 → T004; T002 rides parallel to T001 and joins at T003.

## Numbered Plan

1. [completed] Author csm-review/SKILL.md — 291 lines, T001 gate GATE-PASS (cycle 1, committed 97378f6 + repaired 08e04da)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (public-interface: a new skill other agents and users will invoke)
   - Owned scope: `csm-review/SKILL.md` (creates directory + file)
   - Not in scope: README.md (T002), any other file, lib/scripts/tests, `csm-review/.agents/docs/` (T003)
   - Spike candidate: none — design fully specified in Design D1–D8
   - Actions: create `csm-review/`; write SKILL.md per D1 skeleton implementing D2 state machine (9 states + cycle rules + adversarial cycle cap + per-state exits), D3 dimension table (18 rows, anchors with editions), D4 adversarial protocol (incl. challenger view), D5 findings model (severity spine, CVSS-B scope, E1–E4, schema, dedup, redaction), D6 posture/safety (rungs, egress rule, containment check), D7 report format (template block), D8 NORMS.md + resilience, Anti-Patterns (≥8: prose-essay findings; finder=challenger; severity-confidence blending; quoting secrets; silent skips (no anti-coverage); trusting NORMS.md claims unverified; averaging severity across merges; running target-repo code in place; dismissing dissents without reasoning), Done Criteria (≥6, mapping to ACs 1–8). Keep 200–340 lines; house voice; no code.
   - Acceptance signal: `bash -c 'set -e; L=$(wc -l < csm-review/SKILL.md); test $L -ge 200 -a $L -le 340; for m in "name: csm-review" "INTAKE -> SCOPE -> EVIDENCE -> FIND -> CHALLENGE -> ADJUDICATE -> VERIFY -> SAVED -> STOP" "Review State Machine" "Activation Boundary" "Core Rules" "Scale To The Ask" "Execution Posture" "Review Dimensions" "Finding Record" "Report Format" "NORMS.md" "Subagent Resilience" "Anti-Patterns" "Done Criteria" "STOP" "never fixes" "CVSS" "E1" "E4" "REDACTED" "fingerprint" "upheld" "retracted" "sort_key" "R0" "R3" "forbidden" "--depth 1" "OSV" "endoflife" "OWASP" "CWE" "ASVS" "Anti-Coverage"; do grep -q -e "$m" csm-review/SKILL.md || { echo "MISSING: $m"; exit 1; }; done; for d in "Correctness" "Technical debt" "Code smells" "Anti-patterns" "Security implementation" "Security control" "Secrets" "Concurrency" "Memory" "Error handling" "Input validation" "Test presence" "Test quality" "Test-type adequacy" "Dependency vulnerabilities" "Toolchain" "Observability" "CI, build"; do grep -q -e "$d" csm-review/SKILL.md || { echo "MISSING DIM: $d"; exit 1; }; done; echo GATE-PASS'` → expected `GATE-PASS`, exit 0
   - Validation: (1) acceptance signal; (2) `grep -c "^## " csm-review/SKILL.md` — expect 10–14 sections; (3) self-check that every state in the D2 line has its own numbered subsection with an exit criterion and that every cycle-back rule names its trigger; (4) frontmatter description contains a Never-X clause and trigger words (review, audit).
   - Acceptance evidence: gate output `GATE-PASS` + section count + line count recorded at CHECKPOINT.
   - Repair attempts: 0
   - Recovery note: partial SKILL.md is detectable via the acceptance gate (the MISSING marker names exactly what is absent); re-run the gate and complete missing sections only — never rewrite wholesale.

2. [completed] Wire csm-review into README.md and fix 16-vs-17 staleness — T002 gate README-GATE-PASS, 9 touchpoints, integrated with concurrent tmux plan
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: low (documentation)
   - Owned scope: `README.md`
   - Not in scope: csm-review/SKILL.md, any SKILL.md, .gitignore, mermaid nodes for skills other than csm-review
   - Spike candidate: none
   - Actions: apply the D9 touchpoints by content grep; add the csm-review skills-table row linking `csm-review/SKILL.md`; fix csm-scan row "16 evidence dimensions" → 17; update counts (seven→eight; four→five orchestration in Usage); add typical-sequence step referencing `.agents/reviews/<date>-<repo>-review.md`; add layout entry `csm-review/`; add to the orchestration-skills list in Development & testing. Before editing, check `git log --oneline -5` and `git status`: if the tmux-extension plan (`.agents/plans/2026-08-15-csm-tmux-bootstrap-csm.md`) has landed changes, integrate with them — never revert or overwrite its tmux wording.
   - Acceptance signal: `bash -c 'set -e; test $(grep -c "csm-review" README.md) -ge 8; grep -q "csm-review/SKILL.md" README.md; grep -q ".agents/reviews" README.md; grep -qF "review[" README.md; grep -q "17 evidence dimensions" README.md; ! grep -q "16 evidence dimensions" README.md; grep -qF "csm-plan-<goal-slug>" README.md; echo README-GATE-PASS'` → expected `README-GATE-PASS`, exit 0
   - Validation: (1) acceptance signal; (2) diff review — only csm-review wiring + the 16→17 fix touched; all tmux content intact; intro/usage counts consistent.
   - Acceptance evidence: gate output + diff summary recorded.
   - Repair attempts: 0
   - Recovery note: partial wiring detected via `grep -n "csm-review" README.md` — check each D9 touchpoint area and complete missing ones only.

3. [completed] Independent hostile review of the csm-review skill — 5 passes, 45 findings, doc csm-review-skill-review-2026-08-15.md
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G2
   - Risk: standard (review gates the public-interface artifact)
   - Owned scope: `csm-review/.agents/docs/` (creates `csm-review-skill-review-2026-08-15.md`)
   - Not in scope: editing SKILL.md or README.md (report only; fixes are T004)
   - Spike candidate: none
   - Actions: dispatch five parallel fresh-eyes review subagents (never the T001/T002 author context), one per pass: (a) conformance — house skeleton, boundary language, SAVED behavior (AC8 evidence); (b) coverage — C1–C14 → dimensions mapping complete, all anchors carry editions; (c) CSM integrity — walk QUICK-small-repo, FULL-large-repo, and FULL-with-sandbox scenarios through every state; hunt dead states, missing exit criteria, unreachable cycle-backs, section contradictions; (d) safety — posture rungs, egress rule, containment check, redaction; (e) executability — could a fresh agent run this skill as written? Primary aggregates the five pass reports into `csm-review-skill-review-2026-08-15.md` with: per-pass verdicts, findings each numbered `R-1, R-2, …` with severity (critical/major/minor/nit), SKILL.md section reference, reasoning, concrete correction — or the literal line `Findings: none` if a pass is clean. Apply the fallback ladder on empty subagent results (minimal-prompt retry → re-dispatch → fresh agent; primary-led review only as last resort with recorded caveat).
   - Acceptance signal: `bash -c 'set -e; F=csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md; test -f "$F"; grep -q "Verdict" "$F"; grep -qE "R-[0-9]+|Findings: none" "$F"; echo REVIEW-GATE-PASS'` → expected `REVIEW-GATE-PASS`, exit 0
   - Validation: review doc contains all five passes (a)–(e) with per-pass verdicts; every finding has an R-N id, severity, section reference, and correction.
   - Acceptance evidence: verdict + per-pass summary + finding count recorded.
   - Repair attempts: 0
   - Recovery note: an empty/missing review doc means dispatch failure mid-flight — re-dispatch per the ladder; never fabricate review content.

4. [completed] Remediate review findings, verify coverage, final gate — 45/45 repaired, FINAL-GATE-PASS, Completion Review filled
   - Task ID: T004
   - Depends on: T003
   - Parallel group: G3
   - Risk: standard (final quality gate for the public artifact)
   - Owned scope: `csm-review/SKILL.md`, `README.md`, `.agents/plans/2026-08-15-csm-review-skill-csm.md` (this plan: Control, journal, Critique Resolution)
   - Not in scope: `csm-review/.agents/docs/` (historical record, not edited), any other file
   - Spike candidate: none
   - Actions: triage every R-N finding (accept → edit SKILL.md/README; disprove → recorded reasoning; defer → recorded as user decision); regenerate the coverage matrix (C1–C14 → dimensions → SKILL.md anchors, verified by per-dimension grep); re-walk any CSM scenario the review flagged; fill Critique Resolution with one row per R-N finding; update Control at the completion gate.
   - Acceptance signal: `bash -c 'set -e; F=csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md; P=.agents/plans/2026-08-15-csm-review-skill-csm.md; test -f "$F"; if grep -qE "R-[0-9]+" "$F"; then for i in $(grep -oE "R-[0-9]+" "$F" | sort -u); do grep -q "$i" "$P" || { echo "UNRESOLVED: $i"; exit 1; }; done; fi; L=$(wc -l < csm-review/SKILL.md); test $L -ge 200 -a $L -le 340; for m in "name: csm-review" "INTAKE -> SCOPE -> EVIDENCE -> FIND -> CHALLENGE -> ADJUDICATE -> VERIFY -> SAVED -> STOP" "Review State Machine" "Activation Boundary" "Core Rules" "Scale To The Ask" "Execution Posture" "Review Dimensions" "Finding Record" "Report Format" "NORMS.md" "Subagent Resilience" "Anti-Patterns" "Done Criteria" "STOP" "never fixes" "CVSS" "E1" "E4" "REDACTED" "fingerprint" "upheld" "retracted" "sort_key" "R0" "R3" "forbidden" "--depth 1" "OSV" "endoflife" "OWASP" "CWE" "ASVS" "Anti-Coverage"; do grep -q -e "$m" csm-review/SKILL.md || { echo "MISSING: $m"; exit 1; }; done; for d in "Correctness" "Technical debt" "Code smells" "Anti-patterns" "Security implementation" "Security control" "Secrets" "Concurrency" "Memory" "Error handling" "Input validation" "Test presence" "Test quality" "Test-type adequacy" "Dependency vulnerabilities" "Toolchain" "Observability" "CI, build"; do grep -q -e "$d" csm-review/SKILL.md || { echo "MISSING DIM: $d"; exit 1; }; done; test $(grep -c "csm-review" README.md) -ge 8; grep -q "csm-review/SKILL.md" README.md; grep -q ".agents/reviews" README.md; grep -qF "review[" README.md; grep -q "17 evidence dimensions" README.md; ! grep -q "16 evidence dimensions" README.md; grep -qF "csm-plan-<goal-slug>" README.md; echo FINAL-GATE-PASS'` → expected `FINAL-GATE-PASS`, exit 0
   - Validation: coverage matrix (recorded in journal) shows 14/14 categories mapped; Critique Resolution has a row for every R-N; final `git status` clean after checkpoint commit.
   - Acceptance evidence: gate output, coverage matrix, completed Critique Resolution table.
   - Repair attempts: 0
   - Recovery note: partial remediation detected via R-N ids absent from Critique Resolution; complete rows; never mark complete with unresolved critical/major findings.

## Verification Strategy

Cheapest first: (1) per-task structural gates (T001/T002/T004 embedded grep/bash one-liners — seconds); (2) T003 parallel hostile review (the suite's quality bar for public-interface artifacts); (3) T004 regression re-run of all gates + coverage matrix. No test suite exists for orchestration skills (suite convention: "validate by invoking"); first live invocation is post-build and out of scope. All gates are deterministic greps — no flakiness expected; the only environment sensitivity is subagent dispatch reliability in T003, covered by the fallback ladder.

## Risks And Recovery

- Subagent empty-results during build (known issue) → fallback ladder in T003 actions; every incident journaled; primary-led aggregation as last resort with independence caveat recorded.
- SKILL.md over-length (18-dimension table is verbose) → compress table rows to name + covers + anchor; 340-line ceiling enforced by gates; content priority: state machine > safety > schema > taxonomy > extras; floor is 200.
- Anchor rot between plan and build (editions move) → SKILL.md cites editions inline and instructs verifying anchors at review time; T003 pass (b) re-checks.
- Concurrent activity: the committed-but-not-executed tmux-extension plan (`.agents/plans/2026-08-15-csm-tmux-bootstrap-csm.md`) edits the same README areas as T002; further user commits may land during the build → csm-build RECOVER protects concurrent changes; T002 works by content grep and integrates, never overwrites; never revert user work (a31ca88/a69b625/cca5396 preserved).
- Scope creep into code (lib/scripts for csm-review) → anti-scope in every task; A2 decision recorded; review treats code as a defect.
- Review-skill design drift from plan → T003 checks SKILL.md against Design D1–D9 explicitly.
- Rollback: every task writes only new files or forward edits; rollback = delete `csm-review/` or `git revert` the checkpoint commit; no task touches shared state beyond README.md and this plan.

## Critique Resolution

Hostile critique of the draft (2026-08-15) returned 28 findings; verdict NOT READY. All addressed:

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| R-c1 T001 gate `grep -q "$m"` option-injection on `--depth 1` — gate unpassable | critical | All marker loops now `grep -q -e "$m"` in T001 and T004 | T001/T004 acceptance signals |
| R-c2 T004 signal contained literal `<re-run T001 gate>` placeholders — bash syntax error | critical | T004 signal inlines both gates verbatim | T004 acceptance signal |
| R-c3 Baseline stale (a69b625) + unmodeled collision with concurrent tmux-extension plan (cca5396) editing same README areas | critical | Re-baselined to cca5396; concurrent plan named in Current-State Evidence, Risks, Discovered Requirement 10/12, and T002 actions (integrate, never overwrite) | Current-State Evidence; Risks; T002 |
| R-c4 AC2 vs D1/D2 contradiction on challenge scope (low in FULL unspecified) | major | AC2 reworded: critical/high/medium always independently challenged; low/info per Scale To The Ask with primary-led caveat in both scales | AC2; D1; D2 step 5 |
| R-c5 README gate `≥ 11` unsatisfiable (real max ~9) | major | Gate rewritten: total ≥ 8 + per-touchpoint greps (table row, usage step, mermaid node, 16→17, tmux preservation) | T002 acceptance signal |
| R-c6 T003 single reviewer weaker than plan's own evidence (ensembles) | major | T003 now dispatches five parallel fresh-eyes reviewers, one per pass (a)–(e); primary aggregates | T003 actions |
| R-c7 Critique Resolution punted to csm-build (process inversion); Control `ready` while journal said CRITIQUE pending | major | Table filled during planning REMEDIATE; journal completed through VERIFY/SAVED; Control updated at save | This table; Progress Journal |
| R-c8 "13 user categories" never enumerated | major | Canonical list C1–C14 enumerated in Goal; AC3 and T003/T004 reference it; matrix target 14/14 | Goal; AC3 |
| R-c9 VERIFY cycle-backs incomplete | major | Added VERIFY -> ADJUDICATE and VERIFY -> FIND | D2 cycle rules |
| R-c10 CHALLENGE→FIND recursion unbounded | major | Adversarial cycle cap: ≤1 extra FIND→CHALLENGE round for challenge-discovered findings, ≤2 total, then adjudicate with confidence cap + caveat | D2 termination rule |
| R-c11 R3 "egress blocked" asserted without mechanism | major | Egress rule specifies mechanisms (`unshare -rn`, container `--network none`) or network-avoiding selection + disclosed residual risk | D6 R3; AC5 |
| R-c12 T004 critique-count check vacuous (ID convention never mandated) | major | T003 mandates `R-N` ids (or `Findings: none`); T004 checks every R-N appears in the plan | T003 actions; T004 signal |
| R-c13 AC1 gate missed boundary/state-line/STOP markers | minor | Markers added: full state-line string, `Review State Machine`, `STOP`, `never fixes` | T001 signal |
| R-c14 AC4/AC5/AC8 evidence never instantiated | minor | Gate markers extended (fingerprint/upheld/retracted/sort_key/R0/R3/forbidden); AC8 evidence = T003 pass (a) verdict | T001/T004 signals; AC8 |
| R-c15 T003 signal `grep -c` exits 1 on zero under `set -e` | minor | Signal now uses `grep -qE "R-[0-9]+|Findings: none"` | T003 signal |
| R-c16 Challenger context undefined | minor | Challenger view defined (title/dimension/anchor/locations/snippet/proposed severity+confidence; NOT finder rationale) | D2 step 5; D4 |
| R-c17 D4 corroboration-bump contradiction | minor | Bump declared the sole non-E1 raise path, applied only in ADJUDICATE by the primary; cross-referenced in D4/D5 | D4; D5 |
| R-c18 Pinned-SHA citation mechanics for dirty worktrees undefined | minor | EVIDENCE states `git show <SHA>:<path>` / `git grep <SHA>` when worktree dirty/diverged | D2 step 1/3 |
| R-c19 D8 escape clause covered critical/high only | major | Extended to medium; critical/high/medium never bypass independent challenge — retry or cap with caveat | D8; A11 |
| R-c20 Execution Graph contained draft dross ("no, docs dir is T003's") | minor | Sentence cleaned | Execution Graph |
| R-c21 Containment check overpromised ("zero writes" unprovable) | minor | Reworded to "no writes detected in monitored locations", disclosed in Methodology | D6; AC5 |
| R-c22 Remote-repo target undefined | minor | INTAKE spec + A13: remote URL → `--depth 1` clone into sandbox; clone is citation source | D2 step 1; A13 |
| R-c23 Wrong evidence path for practices-dimension journal | minor | Corrected to `csm-scan/.agents/plans/…` | Current-State Evidence |
| R-c24 "mermaid renders by inspection" + "rg one-liners" wording | minor | Dropped mermaid check pretense (diff review only); wording now "grep/bash one-liners" | T002 validation; Verification Strategy |
| R-c25 Hard-pinned dates silently wrong if build runs later | minor | Date rule recorded: artifact dates = plan save date | A4; Discovered Requirement 14 |
| R-c26 Weak markers; F-id hash unspecified; dim-14 missing fuzz/perf anchors; 180 floor unreachable | nit | State-line full-string marker added; F-id simplified to sequence; dim-14 anchors extended (Test Sizes Large/perf, OSS-Fuzz via OSV); floor raised to 200 | T001 signal; D3 #14; AC1 |
| R-c27 CVSS vectors on every security finding = pseudo-precision | nit | CVSS-B overlay scoped to dependency/CVE + tool-verified exploitation findings | A6; D5 |
| R-c28 No rollback statement | nit | Rollback sentence added (new files only; revert = delete or git revert) | Risks And Recovery |

Build review findings (T003, cycle 1): five hostile passes (a) conformance, (b) coverage, (c) CSM integrity, (d) safety, (e) executability; 45 findings across passes, numbered R-1…R-14 within each pass (unique ids R-1…R-14). All accepted and fixed; full per-pass disposition in `csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md`.

| Finding | Pass(es) | Resolution | Evidence |
|---|---|---|---|
| R-1 | a: boundary bullet; d: obey-repo-instructions (critical); e: evidence-pack slice (critical) | Activation Boundary enumerates all five skills (no "automatically"); Core Rules untrusted-hints clause; FIND step 2 defines the slice | csm-review/SKILL.md |
| R-2 | a: dangling "researchers"; d: R3 no OS isolation (major); e: no resume path (critical) | Role removed; R3 best-effort-isolation disclosure + bubblewrap/landlock preference + non-execution fallback; INTAKE resume pre-step | csm-review/SKILL.md |
| R-3 | a: QUICK challenge rule; b: rot-prone anchors (medium); c: CHALLENGE exit (minor); d: env scrub (major); e: challenge assignment (critical) | Challenge-assignment block in Scale To The Ask; anchor counts replaced with "current catalog"/"taxonomy"; CHALLENGE exit amended; Env scrub rule; identical assignment rule (combined) | csm-review/SKILL.md |
| R-4 | a: containment vs scaffold; b: inconsistent editions (medium); c: no Entry conditions (minor); d: redaction after CHALLENGE (major); e: field matrix (major) | Scaffold exempted in monitored locations; uniform 25010:2023/ASVS v5.0.0 editions; Entry: lines ×9; FIND→CHALLENGE redaction gate; per-class field matrix in VERIFY | csm-review/SKILL.md |
| R-5 | a: template headings; b: C9 non-vulnerable EOL (low); c: SAVED/STOP contradiction (minor); d: egress probe (minor); e: chunking (major) | `## ` headings; D15 extended (unmaintained/deprecated + EOL status); "SAVED is the final state" wording; connectivity probe; chunk rule (24-cap, ≈16k budget) | csm-review/SKILL.md |
| R-6 | a: exclusion list; b: D18 licensing (low); c: cycle-back semantics (minor); d: time bounds R3-only (minor); e: QUICK finder count (major) | Exclusions inlined in snippet policy; SPDX license list in D18; cycle-back resume-semantics note; time bounds at all rungs; QUICK one-finder-per-named-dimension | csm-review/SKILL.md |
| R-7 | c: exit enumeration (nit); d: only-file-committed (minor); e: sort_key circular (major) | Happy-path-exits note; "only file added and committed is the report"; ranked sort_key (verified=3…low=0; E1=3…E4=0) | csm-review/SKILL.md |
| R-8 | c: cycle definition (nit); d: per-ecosystem guard (minor); e: researchers (minor) | Adversarial-cycle definition; per-ecosystem scripts-disabled guard; role removed | csm-review/SKILL.md |
| R-9 | d: R2 collect-only executes code (minor); e: exclusion-list import (minor) | R3 protections apply at R2; exclusions inlined | csm-review/SKILL.md |
| R-10 | d: confidence-cap caveat (minor); e: run-id undefined (minor) | Caveat in finding record + residual unknowns; run-id = %Y%m%d%H%M%S-repo-slug | csm-review/SKILL.md |
| R-11 | d: sandbox perms (nit); e: template headings (minor) | umask 077 / mode 700; `## ` headings | csm-review/SKILL.md |
| R-12 | e: rung-menu mechanic (minor) | Rung menu at INTAKE; silence = R0; remote clones R0 unless opted into R1+ | csm-review/SKILL.md |
| R-13 | e: unknowns/artifacts have no section (minor) | Folded into Methodology Disclosure / Reproducibility | csm-review/SKILL.md |
| R-14 | e: journal format (nit) | `[<timestamp>] <From> -> <To> :: cycle <n> :: trigger: <reason> :: rungs: <r>` | csm-review/SKILL.md |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-15 | 0 | INTAKE | none | Brief classified: large, prescriptive; user-dictated A1, A8; canonical categories C1–C14 derived | DISCOVER |
| 2026-08-15 | 0 | DISCOVER | none | Baseline ad741e0 clean; scout report: assumptions/unknowns/conflicts ranked (U1 hallucination highest) | RESEARCH |
| 2026-08-15 | 0 | RESEARCH | none | 5 parallel tracks; first batch 4/5 empty (known tooling issue) → re-dispatched, all 5 complete (R1–R7 incl. live sandbox experiment + API verification); concurrent user commits a31ca88/a69b625 detected and preserved; session confirmed inside tmux | DRAFT |
| 2026-08-15 | 0 | DRAFT | none | Draft written to /tmp/opencode/csm-plan-csm-review-20260815/draft-plan.md; design D1–D10 | CRITIQUE |
| 2026-08-15 | 0 | CRITIQUE | none | Hostile non-author critique: 28 findings (3 critical, 10 major, 12 minor, 3 nit); verdict NOT READY; concurrent HEAD cca5396 verified independently; tmux-extension plan confirmed ready/NOT_STARTED (two plans share README ownership — modeled in Risks) | REMEDIATE |
| 2026-08-15 | 0 | REMEDIATE | none | All 28 findings resolved (see Critique Resolution); gates rewritten runnable; baseline re-set to cca5396; category list enumerated; cycle cap + egress mechanism + challenger view specified | VERIFY |
| 2026-08-15 | 0 | VERIFY | none | Primary-personal gate: AC1–8 mapped to tasks + runnable evidence; dependency order G1→G2→G3 sound with disjoint ownership; all statuses pending, state NOT_STARTED; signals are literal runnable bash (checked `-e` hygiene, no placeholders); recovery notes present per task | SAVED |
| 2026-08-15 | 0 | SAVED | none | Plan saved to .agents/plans/2026-08-15-csm-review-skill-csm.md; single commit staging only the plan file | STOP |
| 2026-08-15 | 1 | RECOVER | none | HEAD f03fecd clean; no NORMS.md (optional, skipped); csm-review/ absent; tmux plan still ready/NOT_STARTED (README last touched at a69b625); plan control matches saved state | VALIDATE |
| 2026-08-15 | 1 | VALIDATE | none | README targets verified present: seven skill folders x1, 16 evidence dimensions x1, csm-plan-goal-slug x2, four-core/three-tooling x1; plan commands/files match repo | SELECT |
| 2026-08-15 | 1 | SELECT | none | Ready set: T001 (SKILL.md, owns csm-review/) + T002 (README.md) — deps satisfied (none), disjoint ownership; no spike needed (design fully specified) | DISPATCH |
| 2026-08-15 | 1 | DISPATCH | T001, T002 | Both dispatched in parallel with full design spec + acceptance signals; both returned gate-passing results | INTEGRATE |
| 2026-08-15 | 1 | INTEGRATE | T001, T002 | Diffs inspected directly: SKILL.md 264 lines, 9 state subsections w/ exits, 12 sections, 18 dims, all spec fields; README diff covers all 9 D9 touchpoints, tmux content intact, 16->17 fixed, counts seven->eight/four->five; T001 deviations (STOP subsection added, template headings indented) accepted — house-consistent and validation-compliant | VERIFY |
| 2026-08-15 | 1 | VERIFY | T001, T002 | Both acceptance gates re-run by primary: GATE-PASS + README-GATE-PASS (exit 0); section count 12 (10-14 range) | REVIEW |
| 2026-08-15 | 1 | REVIEW | T003 | Five parallel hostile review passes dispatched; verdicts: conformance PASS (6 minor/nit), coverage PARTIAL (1 high/3 med/2 low), CSM integrity PARTIAL (2 major/4 minor/2 nit), safety FAIL (1 critical/3 major/6 minor/1 nit), executability FAIL (3 critical/4 major/7 minor/nit) — 45 findings total, all accepted | REPAIR |
| 2026-08-15 | 1 | REPAIR | T004 | All 45 findings fixed in csm-review/SKILL.md: untrusted-hints clause (critical), env scrub, best-effort-isolation disclosure, FIND→CHALLENGE redaction gate, global adversarial cycle cap, VERIFY budget, Entry: lines ×9, evidence-pack slice, resume pre-step, challenge-assignment block, chunk caps, ranked sort_key, inlined exclusions, D14 literal 8 test types, uniform anchor editions, connectivity probe, run-id, journal format | VERIFY |
| 2026-08-15 | 1 | VERIFY | T004 | T001 gate re-run post-repair: GATE-PASS (291 lines, 9 states, D14-OK); spot greps confirm every critical/major fix present; review doc aggregated at csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md (verdict PASS after repair) | CHECKPOINT |

## Completion Review

Build of the csm-review skill, plan `csm-review-skill`, cycle 1, is complete. Evidence:

- AC1: `csm-review/SKILL.md` exists, 291 lines (200–340), T001 gate GATE-PASS (all markers, state line, boundary phrase, 18 dimensions).
- AC2: cyclic review state machine with finder≠challenger challenge; Challenge-assignment block (critical/high always independent, medium per scale, low/info primary-led with caveat).
- AC3: coverage matrix C1–C14 → dimensions 1–18 verified by T003 pass (b) reviewer (mapping complete; D14/D15/D18 strengthened); all 18 dimension names pass gate greps.
- AC4: findings model complete — severity spine, CVSS-B overlay scoped, E1–E4 confidence, field list, two-stage dedup, redaction policy with inlined exclusions.
- AC5: posture R0–R3 + X-forbidden, sandbox recipe (umask 077, --depth 1, no submodules, env scrub, time bounds), egress probe, containment check, per-ecosystem guard.
- AC6: README gate README-GATE-PASS — csm-review in ≥8 lines incl. table row, `.agents/reviews` step, `review[` mermaid node; "16 evidence dimensions" → 17; tmux content preserved.
- AC7: independent hostile review at `csm-review/.agents/docs/csm-review-skill-review-2026-08-15.md`; Verdict: PASS (after repair); 45 findings, all resolved — R-N ids referenced in this plan.
- AC8: suite conformance verified by T003 pass (a) reviewer (frontmatter Never-X, Activation Boundary, SAVED display-and-stop, Scale To The Ask, Anti-Patterns, Done Criteria).

Commits: `97378f6` (G1: SKILL.md + README + plan control), this checkpoint commit (T003/T004 evidence + repaired SKILL.md). Nothing pushed. Working tree clean.
(filled by csm-build when all criteria are verified)
