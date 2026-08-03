# csm-scan NORMS-Feedback Remediation CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 3 high-risk tasks (T002 broker boundary + command baselines, T004 canonical architecture + claim registry, T007 test-glob universe change) — all three always require independent review; 9 standard-risk tasks; 3 low-risk tasks. Baseline regeneration of shared pipeline-output baselines is single-owned by T014 with independent review; command-test baselines are owned by T002.

## Control
- Plan ID: csm-scan-norms-feedback
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: plan saved 2026-08-03 (planning session only)
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Fix the `csm-scan` skill (repository root: `/home/jamiemills/.config/opencode/skills/csm-scan`, git monorepo root: `/home/jamiemills/.config/opencode/skills`) so that a future scan of a repository such as `perplexity-cli` produces a NORMS.md report that (a) no longer emits the 15 wrong/stale facts (b1–b15) and the internal comment-ratio contradiction (b9) documented in `NORM-fixed.md`, and (b) includes the additional dimensions of insight currently missing: the 26 missing dimensions (a1–a26), 12 shallow-coverage items (c1–c12), and 10 enforcement/workflow insights (d1–d10). The corrected report should match the "additional insights and correct insights" captured in `/home/jamiemills/code/projects/perplexity-cli/NORM-fixed.md` Part 3.

Deliverables:
- Scanner source changes under `lib/scan/` (detectors, renderers, registry, shared primitives, command broker).
- New/updated tests under `test/` (fixture-driven, node:test).
- Consciously re-baselined expectations where established-dimension output changes are intended (single-owner baseline regeneration, see DR1).
- SKILL.md dimension-description updates reflecting new capabilities.

Constraints (non-negotiable, from SKILL.md):
- Read-only scanning: only the broker's registered `rg`/Git read-only argv forms execute; no new executables, no shell strings, no target commands.
- Single output file: exactly one `writeFile(outPath, content)` call in the production pipeline.
- Zero npm dependencies: Node.js built-ins only.
- No installs, no builds, no target-command execution.
- Deterministic: identical inputs produce byte-identical Markdown.
- Privacy/voice/determinism/constraint gates must stay green.

Exclusions:
- No new dimensions (stays at 17). No changes to the plugin framework, cross-repo synthesis, standards registry, or provider catalogs.
- d9 historical part ("grandfathered baseline refresh history 91→143 identities"): deliberately out of scope — it would require a new `git:show`/`git:log -p` broker command (historical file-content reads), which is a scope decision, not a constraint; only the current-state facts (block-new-unannotated gate, current baseline identity count) are reported (T006 fixes the d9 block-gate sub-fact; the history sub-fact is declined).
- a26's "untracked, created-at-test-time" claim for `.hypothesis` is NOT provable from committed files; only the `.gitignore`-absence fact is reported (hedged as inferred).
- b2: dependabot branch presence is reported from `git:branch-list` (already a broker command); branch dating is NOT attempted (would need a new `git for-each-ref` command).
- a18/d5 "blocking status" semantics are reported as static declarations (`if:`/`continue-on-error`/`needs:`), never as verified enforcement.

## Acceptance Criteria
1. Full authoritative test suite green after all tasks: `node --test --test-concurrency=1` exits 0 with all existing + new tests passing, and the per-gate suites (constraints, determinism, privacy-gate, voice-gate, golden) pass.
2. Real-repo probe on `/home/jamiemills/code/projects/perplexity-cli` (via `node --test --test-concurrency=1 test/golden.test.mjs` and/or the pipeline CLI on a temp output path) shows the corrected facts, each with its measurement universe disclosed in the rendered text:
   - Async/await counted over the production source universe (non-test, non-fixture source files; for pxcli this is `src/perplexity_cli/**`): 31 async def / 51 await (not 7/10).
   - Docstring coverage measured over the same production source universe with the test-exemption disclosed: ≈96%+ for pxcli (not 71%).
   - Total files reported as both git-tracked (572) and rg-scoped (527) with a scope caveat; `.py` counts consistent across both scopes.
   - File-naming distribution: snake_case dominant, zero true-camelCase basenames (mononyms classified as `other`), over the full enumeration universe with the universe disclosed.
   - Test-file count 146 (real `tests/test_*.py` modules, rule disclosed) instead of 269.
   - Canonical 7-layer architecture section citing `quality/architecture.toml` with exact per-layer module counts; heuristic layer table/C4 clearly labelled "heuristic".
   - `semgrepseverity` shows the real value `--severity ERROR --severity WARNING`.
   - Data Architecture contains no `Test*` "django" entities and no Pydantic-model false positives.
   - Commit-style reports the conventional/task split over a ≥200-commit window.
   - Dependabot reports branch evidence when `dependabot/*` branches exist.
   - Security reports the first-party auth subsystem.
   - Comment ratio appears once with a single consistent denominator label ("X comment / Y total lines") in both Conventions and Documentation sections.
3. The new insight sections are present in the probe output: 20-rule conventions block (tokenized), suppression `owner:/reason:` policy + fingerprint ratchet mechanics, CSM/no-BDD methodology + plan-gate removal meta-test, gate-lock semantics (`CHECK_*` toggles, deny rule, human-override protocol), lefthook piped-stage pipeline (5 pre-commit / 4 pre-push with gitleaks sole stdin consumer), opencode plugin behaviours + toolchain, meta-test inventory, network guard, hypothesis profile ladder + property manifest parity, coverage authority chain, mutation policy (exit codes 0/1/2, waivers unsupported), exit-code taxonomy (SUCCESS=0…INTERRUPTED=130), release pipeline (triple-match, OIDC, skip-existing), action SHA pins + permission asymmetry, QUALITY_GATES.md/SECURITY.md in Documentation, `dev` extra deps in the stack table, ruff `select` vs `ignore` distinction, and the full Configuration toolchain inventory (refurb, ty, radon, mutmut, hypothesis, import-linter, diff-cover, actionlint).
4. Every one of the 63 shortfall items (a1–a26, b1–b15, c1–c12, d1–d10) is either fixed by a numbered task with passing acceptance evidence, or explicitly declined with documented rationale (Exclusions / Discovered Requirements / Critique Resolution). No shortfall ships silently.
5. Constraint invariants hold after all changes: command-boundary tests, one-write test, zero-dependency test, determinism test, privacy canary, and voice gate all pass.
6. Baselines are deliberately updated only where intended, per DR1's ownership split: command-test baselines (`test/baselines/expansion/capabilities.json` replacementTests digests, `test/baselines/expansion/test-integrity.json`) are regenerated by T002; pipeline-output baselines (`test/baselines/expansion/fixture-behavior.json` per-ecosystem digests, `test/baselines/expansion/renderer.md`, `test/baselines/expansion/semantic.json`) are regenerated by T014 as single owner, each diff independently reviewed. Claim count 93→94 (one new claim `CLM-architecture-layer-model-v1`, T004) with every `93` literal updated.

## Current-State Evidence
- NORMS.md (generated by csm-scan, 2026-08-03): wrong facts at NORMS.md:23 (527 files), :183 (402 .py), :288 (naming 79/74 of 200), :291 vs :528 (comment-ratio contradiction 7,300 vs 5,941), :293 (7 async / 10 await), :295 (type hints 99.9% 950/951), :301 (docstrings 71% 570/807), :335/338 (commit style "Task-identified"), :348–393 (4 heuristic architecture layers, 133 files, 323 edges), :539 (auth "no framework detected"), :547 (dependabot "not configured"), :877–882 (6 "django" entities incl. `Test*` classes), :1460 (95 Make targets), :1464 (55 lefthook entries), :1496 (`semgrepseverity` = `present`).
- NORM-fixed.md Part 3 (shortfall report, lines 656–921): 63 items — 26 missing (a1–a26, lines 696–726), 15 wrong (b1–b15, lines 722–741), 12 shallow (c1–c12, lines 736–747), 10 enforcement (d1–d10, lines 748–757); ranked top-10 improvements at lines 897–908; verdict at 912–920.
- Root-cause tracing (research, verified against scanner source):
  - b1: `deep/conventions.mjs:468` `.slice(0, 40)` sample → 7/10 (actual 31/51).
  - b4/b5: `shared/enum.mjs:32-52` `rg --files` scope (hidden + gitignore + IGNORE_DIRS) → 527/402 (git-tracked 572/406).
  - b6: `deep/conventions.mjs:812` `.slice(0, 30)` → 570/807 = 71% (src universe ≈ 96%+).
  - b7: `deep/conventions.mjs:264` `.slice(0, 200)` + `:275` camelCase regex matches mononyms.
  - b8: `deep/practices/style.mjs:250` sums stages (2) + jobs (53) = "55 entries".
  - b9: `render/documentation.mjs:53` prints "code lines" (total−comment) while ratio uses total; `deep/documentation.mjs:182-204` vs `deep/conventions.mjs:699-723` share the same sample/comment source.
  - b10: `deep/practices/style.mjs:188` target regex includes `.PHONY` (95 vs 94).
  - b11: `deep/practices/style.mjs:281-284` discards the value (token-safety); `render/practices.mjs:216` prints `` `present` ``.
  - b12: `deep/data/extractor.mjs:1020` django regex `\bmodels\.[A-Za-z_]\w*(?:Field)?\b` matches Pydantic + test classes.
  - b13: `deep/architecture.mjs:861-927` heuristic `identifyLayers`; **zero references to `quality/architecture.toml` anywhere in lib/scan** (grep-verified).
  - b14: `shared/ecosystem.mjs:165` `testFileGlobs` incl. `tests/**/*.py` + `*_test.py` → 269 (real: 146).
  - b15: `deep/security.mjs:151-154` detects only third-party `AUTH_LIBS` deps.
  - b2: `deep/security.mjs:416-417` file-existence check only; `git:branch-list` (command.mjs:112) already exists and is used by git.mjs:140 but never cross-referenced.
  - b3: `deep/git.mjs:5-50` over `git:log-oneline-50` (command.mjs:111) + project-specific `taskRe` (git.mjs:11).
  - c4: Configuration section lists only `ruff, bandit, vulture, pyright, deptry, semgrep` (NORMS.md:251); `deep/config.mjs:180-198` `collectTools` is descriptor-driven and omits refurb, ty, radon, mutmut, hypothesis, import-linter, diff-cover, actionlint (declared at pyproject.toml:44-57, 195-210).
- Skill state: 6 plans all complete (latest suite baseline 1133/1133); 93 claims / 17 dimensions / 15 providers; baselines under `test/baselines/expansion/` (fixture-behavior.json per-ecosystem digests, semantic.json, renderer.md, capabilities.json with `replacementTests` sha256 digests asserted at `test/expansion-constraints.test.mjs:183`, test-integrity.json asserted at `test/expansion-baseline.test.mjs:149-151`); real-repo golden test at `test/golden.test.mjs:185-230` scans perplexity-cli and asserts a test-file count in the 240–320 range (golden.test.mjs:204-205 — must be updated by T007 with the b14 fix).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A001 | The 63 shortfalls in NORM-fixed.md Part 3 are the authoritative feedback set; every one must be addressed or explicitly declined. | user-directed | NORM-fixed.md:680-688, 692-921 | accepted |
| A002 | Fixes are implemented as new fact `kinds` under existing claims wherever possible; only one new claim (`CLM-architecture-layer-model-v1`) is added (T004). | design | style-guide plan precedent (zero-claim expansion, 08-03 plan); practices plan precedent for claim additions (10 claims, 93 total) | accepted |
| A003 | Established-dimension output changes (structure, conventions, testing, security, data, architecture, operations, git, practices, documentation, stack) intentionally break existing baselines; baseline regeneration follows DR1's ownership split (T002 for command-test baselines, T014 for pipeline-output baselines), each diff independently reviewed. | design | practices/style plans held the freeze by only touching dimension 17; this plan deliberately changes established dimensions | accepted |
| A004 | The `dependabot` fact uses existing `git:branch-list` evidence; no branch-dating claims are made. | design | research: broker already permits `git branch -a` (command.mjs:112) | accepted |
| A005 | Two new broker command IDs are added: `git:ls-files` and `git:log-oneline-200`. T209 command-boundary test allowances are extended in T002 (the owner of `test/expansion-command-deep.test.mjs`) to permit `git:branch-list` from security.mjs (consumed by T009) and the new IDs from their consumers. | design | research: b4/b3 require git-tracked counts and a wider log window; T209 deep-scanner allowlist at `test/expansion-command-deep.test.mjs:90-118` | accepted |
| A006 | The `.hypothesis` fact is reported only as `.gitignore`-absence + scanner-ignore coverage; the untracked-state claim is dropped. | design | a26 research: not provable from committed files | accepted |
| A007 | d9 historical baseline-refresh counts are out of scope (deliberate scope decision: would require `git:show`/`git:log -p` broker commands for historical file-content reads); current-state facts only. | design | research: d9 history not readable through the broker as currently defined | accepted |
| A008 | Conventions-block content (pxcli-quality.ts:30-64) is emitted as tokenized rule facts, never verbatim prose, to keep the neutral-voice and privacy gates green. | design | voice-gate tests exist (expansion-voice-gate.test.mjs); verbatim prose risks tripping them | accepted |
| A009 | The plan is executed against the csm-scan skill repo (monorepo root `/home/jamiemills/.config/opencode/skills`), not the pxcli repo; the pxcli repo is only a probe target. | design | skill location + golden test | accepted |
| A010 | No changes to the plugin framework, providers catalogs, cross-repo stage, standards registry, or the generic fallback. | design | scope containment; research found no shortfall requiring them | accepted |
| A011 | Convention measurement universes are pinned: "production source universe" = non-test, non-fixture source files (`src/**` + package-root modules; excludes `tests/**`, `**/fixtures/**`, test harnesses); the universe rule is disclosed in every rendered count. | design | critique C1: AC2 numbers only reproducible under a defined universe; NORM-fixed b1/b6 verified against `src/` | accepted |
| A012 | `test/golden.test.mjs` is owned by T007 (its real-repo test-count assertion 240–320 conflicts with the b14 fix and must be updated in the same task). | design | critique C2: golden.test.mjs:204-205 pins the wrong count | accepted |
| A013 | T004 additionally owns the `93` claim-count literals in `test/expansion-constraints.test.mjs:343` and `test/expansion-activation.test.mjs:516-517`; DR2 is the complete checklist. | design | critique C3: literal 93 assertions outside original scope | accepted |
| A014 | T013 additionally owns `deep/stack.mjs` (optionalDeps never reach the stack model today). | design | critique C12: render/stack.mjs alone cannot deliver c10 | accepted |
| A015 | Wave ordering (G1→G2→G3→G4→G5) is the mechanism that serializes T002 before the G3 wave; per-task "Depends on" fields state true input dependencies only. | design | critique C14: 8 of 9 G3 tasks do not consume T002 output | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R01 | Which csm-scan changes close each of the 63 shortfalls? | 63-item mapping vs scanner source (subagent A, read-only) | No writes; only Read/Grep/Glob; skill repo untouched (git status clean before/after) | Every item maps to a module + change category (i)–(v); 8 shared clusters; 5 risky changes; 3 constraint-limited items (d9, a26, b2-dating) | Tasks cluster by owned module; exclusions A006/A007; risk flags T002/T004/T007 |
| R02 | Where do the 15 wrong facts originate and what are the root causes? | Origin tracing + exact reproduction of scanner algorithms (subagent B, read-only) | No writes; reproduced 7/10, 71%, 527, 402, 269 exactly from the same slices/globs | 5 sampling, 4 heuristic, 3 universe, 1 value-collapse, 1 presentation, 1 conflation; canonical architecture.toml never read (zero grep hits); broker already allows branch queries | Concrete file:line targets for b1–b15; A005 broker additions; b9 is a renderer-label fix only |
| R03 | What is already built/tested in the skill repo, and what plan conventions must the new plan follow? | Inventory of 6 plans, 4 docs, registry, tests (subagent C, read-only) | No writes; read-only git log | All 6 prior plans COMPLETE; suite 1133/1133; 93 claims/17 dims/15 providers; fixture/harness conventions; real-repo golden; plan template sections | Baseline T001; baseline-ownership constraints (DR1); claim-count test updates; plan file name/sections |
| R04 | Is the draft plan executable as written? | Independent hostile review (subagent, read-only) | No writes; source spot-checks read-only | 16 findings: c4 unmapped (critical), G3 baseline write-conflict (critical), golden.test.mjs vs b14 (critical), claim-literal gaps (critical), 2 major scope gaps (T013/T004), T209 allowlist gap (major), dependency overstatement (major), b9 anchor direction (major) | Remediated: T015 added, DR1 ownership split, A011–A015, T007 owns golden, T004 owns constraint/activation tests, T013 owns deep/stack.mjs, T209 allowance in T002 |

## Discovered Requirements
- DR1 **Baseline ownership split**. Command-test baselines `test/baselines/expansion/capabilities.json` (replacementTests sha256 digests, asserted at `expansion-constraints.test.mjs:183`) and `test/baselines/expansion/test-integrity.json` (asserted at `expansion-baseline.test.mjs:149-151`) are regenerated **only by T002** (they pin the command tests T002 edits). Pipeline-output baselines `test/baselines/expansion/fixture-behavior.json` (per-ecosystem whole-pipeline digests, asserted by `fixtures-pipeline.test.mjs:128-131`), `test/baselines/expansion/renderer.md`, and `test/baselines/expansion/semantic.json` (asserted by `expansion-baseline.test.mjs:76-97` and `expansion-render-existing-ten.test.mjs:54-73`) are regenerated **only by T014** as single owner, with independent diff review. No other task may write these five files; tasks that intentionally change their outputs record the expected deltas in their acceptance evidence for T014. No automated `--update-baseline` helper exists (T001 spike confirms); T014 documents the manual recompute procedure in the journal. Rollback: a task that breaks a shared baseline reverts only its own source diff, never the baseline.
- DR2 **Claim-count 93→94 checklist** (T004 only): (1) `lib/scan/registry/dimensions.mjs` `DIMENSION_SOURCES` architecture `claims` array; (2) evidence category in `lib/scan/contracts/evidence.mjs:37-54` only if a new category is introduced (automatic admission via `base.mjs:138` otherwise); (3) claim-count literals: `test/expansion-dimension-registration.test.mjs` (CATEGORY_TOPIC_COVERAGE), `test/expansion-final-acceptance.test.mjs` (registryClaims area), `test/expansion-constraints.test.mjs:343` (`coverage.expected === 93`), `test/expansion-activation.test.mjs:516-517` (`registryClaims === 93`). `test/expansion-fixtures.test.mjs:640` self-adapts.
- DR3 **Command broker contract**: new command IDs in `lib/scan/shared/command.mjs` use exact argv arrays passed to `execFile('git', argv)` (the argv is the args only, e.g. `['ls-files']`), `shell: false`, reduced environment, timeouts, output caps, disabled Git prompts/pagers, and `GIT_OPTIONAL_LOCKS=0`; command tests live in `test/expansion-command-core.test.mjs` / `test/expansion-command-deep.test.mjs` (T209 allowlist at `:90-118` — extended in T002 for `git:branch-list` from security.mjs and the new IDs).
- DR4 **Privacy/voice gates**: any new prose-emitting extractor must emit bounded token/count facts; the privacy canary test (`expansion-privacy-gate.test.mjs`) and voice gates (`expansion-voice-gate.test.mjs`, `voice-gate.test.mjs`) run as per-task validation for every task that adds renderer text.
- DR5 **Deterministic ordering**: all new fact lists (exit-code constants, lefthook stages, action pins, gates.conf keys, conventions-block rules) are emitted in deterministic (declaration or canonical-sorted) order; evidence IDs remain deterministic hashes of claim/detector/source/path/locator/key.
- DR6 **Fixture conventions**: fixtures are `files`-map exports in `test/fixtures/*.mjs` / `test/fixtures-expansion/*.mjs`; assertions are substring/regex on markdown or deepEqual on scanner models; fixture-heavy tests must run with `--test-concurrency=1`. Git-dependent fixtures use `test/helpers/git-fixture.mjs` (`makeGitRepo`) or a recording/mock broker where the scanner accepts a broker argument (enum.mjs:32).
- DR7 **Test taxonomy**: the authoritative suite is `node --test --test-concurrency=1`; per-gate suites exist for constraints, determinism, privacy, voice, golden. `golden.test.mjs` scans the real perplexity-cli repo and is skipped with a warning if the path is absent.
- DR8 **Golden test coupling**: `test/golden.test.mjs:204-205` asserts the real-repo test-file count in 240–320; T007's b14 fix changes that to ≈146 and MUST update the assertion in the same task.
- DR9 **Zero churn for untouched dimensions**: the five pipeline-output/semantic baselines reflect intended deltas only (T014 verifies each regenerated baseline diff contains exactly the intended dimension changes and nothing else).
- DR10 **Task-identified evidence**: each task's acceptance evidence must record the exact command, result, and diff scope (the repo's own conventions: acceptance is evidence, not claims).

## Design
Target behavior: NORMS.md for a Python/JS/TS repo like pxcli reports verified counts with disclosed universes, reads canonical declarative models when present (architecture.toml, gates.conf, lefthook.yml, opencode.jsonc), and surfaces the "self-enforcing quality system" character of such repos (policies, ratchets, meta-tests, plugin behaviours) as bounded facts.

Key decisions:
1. **Universe discipline (A011)** — every measured count (files, extensions, docstrings, async, naming, type hints, test files, comment ratio) reports its measurement universe and sample basis in the rendered text; sampling caps are raised to the production source universe where feasible (async, naming, docstrings) with the rule disclosed in the render.
2. **Canonical-before-heuristic** — architecture reads `quality/architecture.toml` when present and renders the canonical layer model as the primary section; the heuristic module graph/C4 remains, explicitly labelled "heuristic".
3. **Value fidelity** — gate thresholds carry their real string values (bounded token-safe channel); `semgrepseverity` renders `--severity ERROR --severity WARNING`.
4. **Policy-content readers** — a new `deep/practices/content.mjs` reads bounded sections of policy files (`scripts/check_*.py`, `scripts/_ratchet.py`, `scripts/mutation_policy.py`, `.opencode/plugins/*.ts`, `tests/fuzz_corpus/README.md`, `quality/analyser-contracts.toml`) to emit policy-semantics facts, tokenized and voice-safe.
5. **Broker extensions** — two new read-only Git command IDs (`git:ls-files`, `git:log-oneline-200`) plus T209 allowlist extension (A005); no new executables.
6. **Consistent presentation** — comment ratio appears once with one denominator label ("X comment / Y total lines") anchored by T012 (documentation moves to total-lines; T003 only verifies the conventions label); stack table renders the `dev` extra (deep/stack.mjs + render/stack.mjs); documentation section lists QUALITY_GATES.md/SECURITY.md and the doc toolchain; Configuration lists the full declared toolchain (T015).
7. **One new claim** — `CLM-architecture-layer-model-v1` (canonical layers); everything else is new kinds under existing claims.

Interfaces/data flow: survey → 17 dimension scanners (extended detectors in conventions/architecture/practices/testing/operations/security/data/git/documentation/config/stack) → enrich (unchanged) → validate (unchanged) → render (extended renderers) → single write. New facts flow through the existing claim/evidence model; no new pipeline stages. Cross-dimension evidence (dependabot branches) is re-fetched by security.mjs via the broker (no new plumbing), consistent with how git.mjs already re-fetches branch data.

## Execution Graph
```
T001 baseline (G1)
  └─> T002 broker+enumeration+command baselines (G2)
       ├─> G3 wave (11 parallel tasks, pairwise-disjoint source/test files):
       │     T003 conventions        T004 architecture+claim   T005 practices/style
       │     T007 testing+golden     T008 operations           T009 security
       │     T010 data               T011 git (needs T002)     T012 documentation
       │     T013 stack              T015 config toolchain
       └─> T006 practices/content (G4, needs T003 + T005 merge-order)
            └─> T014 final gate: pipeline baselines + SKILL.md + probe (G5, needs all)
```
Critical path: T001 → T002 → (G3 wave) → T006 → T014. Wave ordering (not per-task dependencies) serializes T002 before G3 and T006 after G3; per-task "Depends on" states true input dependencies only (A015). G3 is the maximum parallel set: 11 tasks with pairwise-disjoint owned source/test files; no G3 task may write the five shared baseline files (DR1).

## Numbered Plan

1. [pending] Baseline gate: suite, probe, and baseline inventory
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: no source writes; read-only verification; plan journal/evidence notes
   - Not in scope: any scanner or test changes
   - Spike candidate: identify the exact tests enforcing the baseline files (capabilities.json, test-integrity.json, fixture-behavior.json, renderer.md, semantic.json) and the regeneration mechanism for each (read-only inspection of their consumers: expansion-constraints.test.mjs:183, expansion-baseline.test.mjs:76-97,149-151, fixtures-pipeline.test.mjs:128-131, expansion-render-existing-ten.test.mjs:54-73; record whether any `--update-baseline`-style helper exists — none is known — and document the manual recompute procedure in the journal). Isolation: read-only; no regeneration executed.
   - Actions:
     1. Run the authoritative suite: `node --test --test-concurrency=1`; record pass count and runtime.
     2. Run the per-gate suites (constraints, determinism, privacy-gate, voice-gate, golden) and record results.
     3. Run the real-repo probe against `/home/jamiemills/code/projects/perplexity-cli` and save the current NORMS.md output to a temp file (outside the skill repo) as the "before" artifact.
     4. Record the claim count (93), dimension count (17), and the baseline digest state.
     5. Answer the spike: for each of the five baseline files, which test asserts it and how is it regenerated (manual recompute documented).
   - Acceptance signal: `node --test --test-concurrency=1` exits 0, and the journal records suite count, gate results, probe "before" artifact path, claim/dimension counts, and the spike answers.
   - Validation:
     1. `node --test --test-concurrency=1 test/expansion-constraints.test.mjs` passes.
     2. `git status --short` in the skill repo is unchanged by the task (no writes).
   - Acceptance evidence: journal rows with command outputs; spike answers with file:line.
   - Repair attempts: 0
   - Recovery note: if the suite is already red, the plan is BLOCKED pending a pre-existing-failure investigation; do not start source tasks on a red baseline.

2. [pending] Broker extensions, enumeration universe, and command baselines
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (new command-boundary surface, all-repo output churn, command-baseline regeneration) — always requires independent review
   - Owned scope: `lib/scan/shared/command.mjs`, `lib/scan/shared/enum.mjs`, `lib/scan/render/structure.mjs`, `test/expansion-command-core.test.mjs`, `test/expansion-command-deep.test.mjs` (including the T209 deep-scanner allowlist at `:90-118`), `test/structure.test.mjs`, `test/enum.test.mjs`, `test/baselines/expansion/capabilities.json` (replacementTests digests), `test/baselines/expansion/test-integrity.json`
   - Not in scope: ignore-vocabulary redefinition beyond the hidden-file policy; git.mjs/security.mjs consumer changes (T011/T009 consume this task's outputs and allowances)
   - Spike candidate: none
   - Actions:
     1. Add `git:ls-files` (broker executes `execFile('git', ['ls-files'])`; output caps, `GIT_OPTIONAL_LOCKS=0`, disabled prompts/pagers) and `git:log-oneline-200` (same discipline; keep `git:log-oneline-50` for compat or migrate consumers in T011).
     2. Extend enumeration to report both scopes: rg-scoped enumeration (current, with hidden-file policy applied) and git-tracked (`git:ls-files`), including hidden/dot-dir tracked files; disclose each scope in the model.
     3. Render Total Files and the extension table with both figures and a scope caveat (e.g. "Total Files: 572 git-tracked (527 in rg-scoped enumeration, excluding hidden/gitignored paths)").
     4. Extend the T209 deep-scanner allowlist (`expansion-command-deep.test.mjs:90-118`) to permit `git:branch-list` from security.mjs (consumed by T009) and the new `git:*` IDs from their consumers (git.mjs), mirroring git.mjs's existing allowance.
     5. Regenerate `capabilities.json` (replacementTests sha256 digests for the edited command tests) and `test-integrity.json`; submit both diffs for independent review (DR1).
     6. Update structure/enum tests with git-scoped fixtures: hidden tracked files vs gitignored files (use `test/helpers/git-fixture.mjs` `makeGitRepo`, or a recording/mock broker since enum.mjs accepts a broker argument — name the chosen mechanism in the evidence).
     7. Fixes shortfalls: b4, b5.
   - Acceptance signal: `node --test --test-concurrency=1 test/structure.test.mjs test/enum.test.mjs test/expansion-command-core.test.mjs test/expansion-command-deep.test.mjs test/expansion-constraints.test.mjs` exits 0, and a new unit test asserts the dual-scope totals (git-tracked count > rg-scoped count when hidden tracked files exist).
   - Validation:
     1. Broker rejects an unregistered command ID (existing contract test still passes).
     2. Determinism gate passes: two identical pipeline runs produce byte-identical structure output.
     3. Independent review of the capabilities.json/test-integrity.json diffs (only command-test-related deltas expected).
   - Acceptance evidence: test output; baseline diff record; review note.
   - Repair attempts: 0
   - Recovery note: if `git:ls-files` output exceeds caps on the probe repo, record the cap truncation and adjust caps with disclosure; never drop the git-tracked count silently. If a baseline digest mismatch fails constraints tests, regenerate only the affected entries and re-review.

3. [pending] Conventions dimension: measurement-universe corrections
   - Task ID: T003
   - Depends on: T002 (enumeration scope changes the file set this scanner receives)
   - Parallel group: G3
   - Risk: standard (established-dimension count changes)
   - Owned scope: `lib/scan/deep/conventions.mjs`, `lib/scan/render/conventions.mjs`, `test/conventions.test.mjs`
   - Not in scope: the Code Conventions citation of the enforced 20-rule block (T006); documentation-section denominator (T012); shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. Async/await: count over the production source universe (non-test, non-fixture source files, per A011), not `.slice(0, 40)`; disclose the universe in the rendered line. Fixes b1.
     2. Docstrings: measure over the production source universe (`src/**` + package root, excluding tests/fixtures/harnesses); disclose the universe and the deliberate test exemption. Fixes b6.
     3. File naming: classify the full enumeration universe (post-T002 scope); reorder checks (snake_case before camelCase); camelCase requires an internal uppercase (`^[a-z][a-zA-Z0-9]*[A-Z]`); mononyms (no underscore, no internal capital) classify as `other`/ambiguous; disclose the universe. Fixes b7.
     4. Type hints: report the measured universe (sample basis) and surface the pyright `strict` fact + ratchet as the meaningful headline, not just the percentage. Fixes c11.
     5. Comment density: keep the shared comment source; verify the conventions-section label already uses "X comment / Y total lines" wording (the anchor per b9's 18.6% = 1359/7300 math); do NOT align to the documentation side (T012 does that). Fixes b9 (conventions side verification).
     6. Update conventions fixtures/tests; record the expected pipeline-baseline deltas in the acceptance evidence for T014 (do not write the shared baselines).
   - Acceptance signal: `node --test --test-concurrency=1 test/conventions.test.mjs` exits 0, and a new fixture test asserts production-source-universe async counts and src-universe docstring coverage with the universe disclosed in the rendered text.
   - Validation:
     1. Naming fixture includes mononym and true-camelCase files; assert 0 camelCase for mononym-only sets.
     2. Voice gate and privacy gate pass.
     3. Expected baseline deltas recorded (T014 consumes).
   - Acceptance evidence: test output; before/after probe lines for b1/b6/b7/c11; expected-delta record.
   - Repair attempts: 0
   - Recovery note: if the probe shows regressions in other dimensions' renderers, revert only the renderer label change and re-run; the deep-scanner changes are additive counts.

4. [pending] Architecture dimension: canonical layer model from quality/architecture.toml
   - Task ID: T004
   - Depends on: T001 (wave ordering provides T002 first)
   - Parallel group: G3
   - Risk: high (highest-visibility section; new claim; registry/claim-count churn) — always requires independent review
   - Owned scope: `lib/scan/deep/architecture.mjs`, new `lib/scan/deep/architecture/canonical.mjs`, `lib/scan/render/architecture.mjs`, `lib/scan/render/architecture-extension.mjs`, `lib/scan/registry/dimensions.mjs` (claim registration), `lib/scan/contracts/evidence.mjs` (evidence category only if needed), `test/architecture.test.mjs`, `test/expansion-dimension-registration.test.mjs`, `test/expansion-final-acceptance.test.mjs` (registryClaims area), `test/expansion-constraints.test.mjs:343`, `test/expansion-activation.test.mjs:516-517`, fixtures-expansion architecture fixture
   - Not in scope: replacing the heuristic import graph (kept, labelled); changes to craft-assessment facts; shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. New parser `canonical.mjs`: parse `quality/architecture.toml` (and equivalents by convention, e.g. `architecture.toml` at repo root or under `quality/`): `[[layers]]` name/allowed_deps/modules membership and adapter-independence groups; emit `CLM-architecture-layer-model-v1` claim facts with exact per-layer module counts and the source file as evidence. Fixes a23, b13 (canonical half).
     2. Composition-root seam wiring fact: scan the composition-root module for the seam-wiring pattern (`_wire_*_seam` assignments), consistent with deep/architecture.mjs's existing bounded source parsing. Fixes a22 (seam half; whitelists from action 1).
     3. Register the claim in `lib/scan/registry/dimensions.mjs`; update evidence categories if a new category is introduced; complete the DR2 checklist (all four `93` literal locations updated).
     4. Render a new canonical section (primary, labelled "canonical — declared layer model") plus keep the heuristic module graph/C4 labelled "heuristic — import-derived". Fixes c2.
   - Acceptance signal: `node --test --test-concurrency=1 test/architecture.test.mjs test/expansion-dimension-registration.test.mjs test/expansion-constraints.test.mjs test/expansion-activation.test.mjs test/expansion-final-acceptance.test.mjs` exits 0, and a new fixture with an `architecture.toml` (7 layers, exact module lists) renders the canonical section with exact counts and a heuristic label on the legacy section.
   - Validation:
     1. Fixture without `architecture.toml` falls back to the heuristic section unchanged (backward compatibility).
     2. DR2 checklist complete: grep finds no remaining `93` claim-count literal in tests (except intentional fixtures).
     3. Determinism gate passes.
     4. Independent review of the claim registration and any expected-delta record.
   - Acceptance evidence: test output; probe showing canonical 7-layer section for pxcli; claim-count diff; review note.
   - Repair attempts: 0
   - Recovery note: partial claim registration (registry updated, tests not) fails validation loudly; complete DR2 edits in the same task before acceptance. If the seam-wiring scan proves unreliable across fixtures, downgrade the fact to the adapter-independence whitelists only and record a2 as partially fixed.

5. [pending] Practices dimension: style-engine depth (gates, lefthook, make, exit codes, opencode jsonc)
   - Task ID: T005
   - Depends on: T001 (wave ordering provides T002 first)
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/practices/style.mjs`, `lib/scan/render/practices.mjs` (style-guide block only), `test/expansion-practices.test.mjs`
   - Not in scope: policy-content extractors and plugin-content extraction (T006); conventions-block citation (T006); shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. gates.conf: emit `CHECK_*` toggles (13) as `quality_gate:check-toggle` kinds; read the header-comment semantics (locked floors, denied-to-agents, human-override protocol) as tokenized kinds. Fixes a4.
     2. Gate values: carry real string values through a bounded value channel; `semgrepseverity` renders `--severity ERROR --severity WARNING` instead of `` `present` ``. Fixes b11.
     3. opencode.jsonc: read comment text adjacent to permission deny entries (override env var, human change protocol) via the JSONC comment reader. Fixes a5.
     4. lefthook: parse `piped:`/`group:`/`run:` structure; emit 5 pre-commit and 4 pre-push stage facts with ordering, abort-on-failure semantics, and stdin ownership (gitleaks sole stdin consumer); report stage count and job count as separate records (not summed). Fixes a6, d1, b8.
     5. Make targets: exclude `.PHONY`/pseudo-targets from the count; emit `check` composition (13 `CHECK_*` toggles) and `ci-quality` membership (17 members) as automation facts. Fixes b10, a21.
     6. Exit-code taxonomy: parse `exit_codes.py` constants (SUCCESS=0…INTERRUPTED=130) and the exception→code table + HTTP special-casing as tokenized kinds. Fixes a7.
     7. Ruff rules: emit `select` (live codes) separately from `ignore`/per-file. Fixes c12.
     8. Update practices fixtures/tests; record expected pipeline-baseline deltas for T014.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs` exits 0, and new fixture tests assert: CHECK_* toggles emitted; `semgrepseverity` value rendered verbatim; lefthook stage facts (5/4) with gitleaks stdin ownership; `.PHONY` excluded from target count; exit-code pairs emitted.
   - Validation:
     1. Determinism of new fact ordering (declaration order for gates/exit codes).
     2. Voice gate and privacy gate pass.
     3. Expected baseline deltas recorded (T014 consumes).
   - Acceptance evidence: test output; probe lines for the Style Guide & Conventions block; expected-delta record.
   - Repair attempts: 0
   - Recovery note: if the value-channel change breaks the token-safety contract for other gate keys, gate the value channel to allowlist keys and re-run.

6. [pending] Practices dimension: policy-content and agent-workflow extractors
   - Task ID: T006
   - Depends on: T003, T005 (merge order: must run after the G3 wave; shares render/practices.mjs and render/conventions.mjs)
   - Parallel group: G4
   - Risk: standard (voice/privacy risk on conventions-block text; renderer merges)
   - Owned scope: new `lib/scan/deep/practices/content.mjs`, `lib/scan/deep/practices/model.mjs` (wiring), `lib/scan/render/practices.mjs` (category-group behaviour facts), `lib/scan/render/conventions.mjs` (one enforced-block citation line), `test/expansion-practices.test.mjs`, `test/conventions.test.mjs`
   - Not in scope: testing-dimension facts (T007); operations facts (T008); shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. Suppression policy reader: extract `owner:/reason:` requirement, `file:line:type[:detail]` fingerprint identity, block-new-unannotated gate from `scripts/check_suppression_reasons.py` / `check_suppressions.py`; report current grandfathered-baseline identity count from `quality/baselines/suppressions.json`. Fixes a2, a9, d3 (current-state), d9 (block-gate sub-fact).
     2. Ratchet mechanics: extract fingerprint-diff engine + `--update-baseline` workflow from `scripts/_ratchet.py`. Fixes a9, d3.
     3. Mutation policy: extract exit codes 0/1/2, waivers-unsupported, diff-vs-full split, weekly schedule from `scripts/mutation_policy.py` + `mutation-scheduled.yml`. Fixes a15.
     4. Methodology aggregator: CSM-planned (≥1 `.agents/plans/*-csm.md`), zero BDD (no `.feature`), plan-gate removal certified by `tests/test_removed_plan_gate.py` presence. Fixes a3, a25.
     5. Fuzz replay contract: lexicographic seed order, authoritative failure semantics, JSON state file from `tests/fuzz_corpus/README.md`; class/test decomposition from `tests/test_fuzz.py`; blocking-CI and atheris platform gating. Fixes a12.
     6. Policy-validation tools: `validate_make_policy.py`, `validate_workflow_policy.py --strict`, actionlint wiring. Fixes d7.
     7. Analyser-contract registry: `quality/analyser-contracts.toml` + `check_analyser_contracts.py --validate` wiring. Fixes d8.
     8. Agent-workflow content: parse `.opencode/plugins/*.ts` for the 20-rule conventions block (tokenized rule facts: complexity-le-5, max-4-params, percent-s-lazy-logging, british-english, version-floors, etc.) and per-plugin behaviour markers (quality-gate bypass blocking, pxcli-quality reactive checks, pre-push-docs first-push block); parse `.opencode/package.json` scripts and `vitest.config.ts` thresholds. Fixes a1, a19, a20, c1, d2.
     9. Render: wire behaviour facts into the category groups (c8) and add the single enforced-block citation line to the Code Conventions section.
     10. Record expected pipeline-baseline deltas for T014.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs test/conventions.test.mjs` exits 0, and new fixture tests assert: suppression-policy kinds; ratchet kinds; mutation exit-code kinds; methodology csm/no-bdd kinds; plugin-behaviour kinds; the conventions-block citation line present in the Code Conventions render.
   - Validation:
     1. Voice gate passes on the tokenized conventions-block facts (no verbatim prose).
     2. Privacy gate passes (plugin sources contain no identities beyond bounded tokens).
     3. Determinism: conventions-block rules render in canonical order.
     4. Independent review of the renderer merge diffs (render/practices.mjs, render/conventions.mjs).
   - Acceptance evidence: test output; probe showing new Development Practices behaviour facts; review note.
   - Repair attempts: 0
   - Recovery note: if the voice gate trips on conventions-block wording, further tokenize (rule IDs over phrases) and re-run; do not weaken the voice gate.

7. [pending] Testing dimension: accurate test-file universe + depth facts
   - Task ID: T007
   - Depends on: T001 (wave ordering provides T002 first)
   - Parallel group: G3
   - Risk: high (glob change affects all Python repos) — always requires independent review
   - Owned scope: `lib/scan/deep/testing.mjs`, `lib/scan/shared/ecosystem.mjs` (python `testFileGlobs`), `lib/scan/render/testing.mjs`, `test/testing.test.mjs`, `test/ecosystem.test.mjs`, `test/golden.test.mjs` (real-repo test-count assertion at `:204-205`), fixtures (python + fixtures-expansion)
   - Not in scope: test-runner execution; pytest-marker behaviour beyond declarations; shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. Test-file universe: tighten python `testFileGlobs` to `tests/test_*.py` + `tests/**/test_*.py` + `conftest.py`, excluding `tests/fixtures/**`, `tests/support/**`, `_fuzz_harnesses.py`, `strategies.py`, `__init__.py` (as non-tests); scope `*_test.py` to test directories so `scripts/smoke_test.py` is excluded; disclose the counting rule in the rendered section. Fixes b14.
     2. Update `test/golden.test.mjs:204-205`: the real-repo test-count assertion range 240–320 becomes ≈146 with the disclosed counting rule (DR8). Update T007's Validation accordingly.
     3. Meta-test classification: classify `test_quality_*.py`, `test_workflow_policy.py`, `test_make_policy.py`, `test_removed_plan_gate.py`, `test_analyser_contracts.py`, `test_repository_hygiene.py`, `test_suppressions*.py`, `test_coverage_policy.py`, `test_module_coverage.py`, `test_import_graph.py`, `test_architecture.py`, `test_cyclomatic_complexity.py` as `meta-test` facts. Fixes a10, d4.
     4. Network guard: detect `tests/support/network_guard.py` pattern (socket/curl_cffi interception, loopback-only, env scrubbing, real_api bypass) as a testing fact. Fixes a11.
     5. Hypothesis profiles: parse `tests/conftest.py` `settings(max_examples=…)` per profile + `quality/property-inventory.toml` parity count. Fixes a13.
     6. Coverage authority chain: detect `check_module_coverage.py` sole-authority language, diff-cover sole changed-line authority, `--dist loadfile` determinism from Makefile. Fixes a14, d6.
     7. Marker-lane exclusions + isolation: detect the `-m "not property and not …"` selector and the literal `MUTATION_PROPERTY_FILES` manifest from the Makefile; autouse isolation fixtures from conftest. Fixes c3.
     8. `.hypothesis`: report `.gitignore`-absence (inferred, per A006) and the scanner's own ignore coverage. Fixes a26 (hedged).
     9. Update fixtures/tests; record expected pipeline-baseline deltas for T014.
   - Acceptance signal: `node --test --test-concurrency=1 test/testing.test.mjs test/ecosystem.test.mjs test/golden.test.mjs` exits 0, and a fixture test asserts the real-module counting semantics (fixtures/support excluded, `scripts/smoke_test.py` excluded) and a network-guard fact.
   - Validation:
     1. Golden test passes with its own updated assertion (real-repo probe shows ≈146).
     2. Independent review of ecosystem.mjs glob diff.
     3. Determinism gate passes.
   - Acceptance evidence: test output; probe before/after test-file count; golden-diff review note.
   - Repair attempts: 0
   - Recovery note: if the glob change breaks framework detection in another ecosystem's fixtures, isolate the python descriptor change and re-run the affected fixture suites.

8. [pending] Operations dimension: workflow anatomy, pinning, permissions, release pipeline
   - Task ID: T008
   - Depends on: T001 (wave ordering provides T002 first)
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/operations.mjs`, `lib/scan/render/operations.mjs`, `test/operations.test.mjs`, fixtures
   - Not in scope: release-pipeline facts owned by practices automation (keep the operations-side job/step facts here); shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. Action pinning: per workflow, collect `uses: owner/repo@<sha> # <version>` pins and the `permissions:` map at workflow and job level; emit permission-asymmetry facts. Fixes a17.
     2. Per-job semantics: `runs-on`, `needs:`, `if:`/`continue-on-error` (blocking status as declaration), matrix rows, `fail-fast`. Fixes a18, d5.
     3. Concurrency groups + `cancel-in-progress`. Fixes c7 (part).
     4. Release pipeline (operations side): `publish-to-pypi.yml` triggers/jobs, OIDC `id-token: write`, `skip-existing`, triple-match steps as static declarations. Fixes a16, d10 (declaration-level).
     5. Record expected pipeline-baseline deltas for T014.
   - Acceptance signal: `node --test --test-concurrency=1 test/operations.test.mjs` exits 0, and a fixture with a workflow containing SHA-pinned actions + escalated permissions asserts pin and permission facts.
   - Validation: determinism gate; voice gate; privacy gate (no raw action SHAs beyond declared pins — follow existing privacy projections).
   - Acceptance evidence: test output; probe showing pin/permission facts; expected-delta record.
   - Repair attempts: 0
   - Recovery note: workflow-parsing regressions in other fixture workflows show up in operations tests; revert the parser to additive facts and re-run.

9. [pending] Security dimension: dependabot evidence, first-party auth, gitleaks context
   - Task ID: T009
   - Depends on: T001 (wave ordering provides T002 first, including the T209 allowlist extension for security.mjs)
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/security.mjs`, `lib/scan/render/security.mjs`, `test/security.test.mjs`
   - Not in scope: dependabot branch dating (declined in Exclusions); new broker commands (T002); shared baseline files (DR1 — record expected deltas only)
   - Spike candidate: none
   - Actions:
     1. Dependabot: issue `git:branch-list` via the broker (allowance added in T002) and cross-reference for `dependabot/*` branches; report "not configured (no .github/dependabot.yml); dependabot/* branches present" as inferred when branches exist. Fixes b2.
     2. First-party auth: after dep-based detection, scan the source tree for `auth`/`token`/`oauth`/`session`/`encryption`/`cookies` module clusters and report a first-party auth subsystem. Fixes b15.
     3. Gitleaks context: read `.gitleaks.toml` allowlist policy (exact-file exceptions, stopwords) and `.gitleaksignore` entry count; label secret-pattern matches as fixture-allowlisted where the policy so declares. Fixes c6.
     4. Record expected pipeline-baseline deltas for T014.
   - Acceptance signal: `node --test --test-concurrency=1 test/security.test.mjs` exits 0, and new fixture tests assert branch-evidence dependabot and first-party auth subsystem facts.
   - Validation:
     1. Determinism; privacy (no secret values in facts).
     2. T209 command-boundary test still passes with the T002 allowance (security.mjs may now issue `git:branch-list`).
   - Acceptance evidence: test output; probe before/after Security section lines; expected-delta record.
   - Repair attempts: 0
   - Recovery note: if branch evidence is capped/truncated by the broker, record truncation and emit `unverified` for the dependabot branch fact rather than a stale "not configured".

10. [pending] Data Architecture: eliminate django false positives
    - Task ID: T010
    - Depends on: T001 (wave ordering provides T002 first)
    - Parallel group: G3
    - Risk: standard
    - Owned scope: `lib/scan/deep/data/extractor.mjs`, `lib/scan/deep/data/model.mjs` (if dialect field changes), `lib/scan/render/data.mjs` (if entity table changes), `test/expansion-data.test.mjs`, fixtures
    - Not in scope: new data-source types; relation inference changes; shared baseline files (DR1 — record expected deltas only)
    - Spike candidate: none
    - Actions:
      1. Require real Django signals before classifying `django`: base-class inheritance (`(models.Model)`) or `models.<Field>` assignment pattern with a supporting import; drop the bare `\bmodels\.[A-Za-z_]\w*(?:Field)?\b` match. Fixes b12 (part 1).
      2. Exclude `tests/**` (and fixture paths) from data-source entity extraction. Fixes b12 (part 2).
      3. Update data fixtures (pydantic model + Test* classes must not become entities); record expected pipeline-baseline deltas for T014.
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-data.test.mjs` exits 0, and a fixture containing a Pydantic model with `self.models.items()` and `Test*` classes asserts zero django entities while a real `models.Model` subclass is detected.
    - Validation: determinism; backward-compat fixture (existing django fixture still detected).
    - Acceptance evidence: test output; probe before/after Data Architecture section; expected-delta record.
    - Repair attempts: 0
    - Recovery note: if a real django fixture regresses, adjust the signal check (require import evidence) and re-run both fixtures.

11. [pending] Git dimension: commit-style window and branch-structure depth
    - Task ID: T011
    - Depends on: T002 (uses the new `git:log-oneline-200` command ID)
    - Parallel group: G3
    - Risk: standard
    - Owned scope: `lib/scan/deep/git.mjs`, `test/git-commit-vocab.test.mjs`, fixtures
    - Not in scope: new broker commands (added in T002); shared baseline files (DR1 — record expected deltas only)
    - Spike candidate: none
    - Actions:
      1. Migrate commit-style analysis to `git:log-oneline-200` (command ID from T002); report the conventional-vs-task split over the window with counts, not a single headline. Fixes b3.
      2. Branch naming: when a `remediation` prefix is detected, emit the `remediation/<date>/<id>/attempt-N` depth structure. Fixes a8.
      3. Update git fixtures/tests (fixture with 200+ commits, conventional-dominated); record expected pipeline-baseline deltas for T014.
    - Acceptance signal: `node --test --test-concurrency=1 test/git-commit-vocab.test.mjs` exits 0, and a fixture with conventional-dominant history asserts the split fact and a remediation depth fact.
    - Validation: determinism (window ordering stable); existing commit-vocab tests updated intentionally (review the diff).
    - Acceptance evidence: test output; probe before/after Git Practices lines; review note.
    - Repair attempts: 0
    - Recovery note: if the wider window changes other repos' classification, record before/after in the journal and verify the classification thresholds are evidence-gated (conventional < task), not ordering-gated.

12. [pending] Documentation dimension: reference artifacts, doc toolchain, single comment-ratio denominator
    - Task ID: T012
    - Depends on: T001 (wave ordering provides T002 first)
    - Parallel group: G3
    - Risk: low
    - Owned scope: `lib/scan/deep/documentation.mjs`, `lib/scan/render/documentation.mjs`, `test/documentation.test.mjs`
    - Not in scope: conventions-section denominator label (T003 verifies only; this task anchors the label); shared baseline files (DR1 — record expected deltas only)
    - Spike candidate: none
    - Actions:
      1. Reference artifacts: detect QUALITY_GATES.md / equivalent reference docs (RFC 2119 vocabulary, stable gate IDs, agent replication cards) as documentation facts; add SECURITY.md to the docs section inventory. Fixes a24, c9 (part).
      2. Doc toolchain: detect `check-config`/`pre-push-docs-check`-style doc-validation scripts referenced in Makefile/plugins. Fixes c9 (part).
      3. Comment ratio anchor: render the Documentation section as "X comment / Y total lines" (the anchor per 18.6% = 1359/7300), replacing the "code lines" label (render/documentation.mjs:53). Fixes b9 (documentation side).
      4. Record expected pipeline-baseline deltas for T014.
    - Acceptance signal: `node --test --test-concurrency=1 test/documentation.test.mjs` exits 0, and a fixture with a large reference doc asserts the reference-artifact fact and a single "X comment / Y total lines" denominator.
    - Validation: golden test (README assertions unaffected); determinism.
    - Acceptance evidence: test output; probe before/after Documentation lines; expected-delta record.
    - Repair attempts: 0
    - Recovery note: denominator-label change is presentation-only; if a voice/prose gate trips, use numeric-only phrasing.

13. [pending] Stack dimension: dev-extra dependencies reach the model and renderer
    - Task ID: T013
    - Depends on: T001 (wave ordering provides T002 first)
    - Parallel group: G3
    - Risk: low
    - Owned scope: `lib/scan/deep/stack.mjs` (surface `manifest.optionalDeps` in the stack findings model), `lib/scan/render/stack.mjs`, `test/stack.test.mjs`
    - Not in scope: manifest parsing changes (optional-deps already parsed by shared/manifest.mjs:151-157); shared baseline files (DR1 — record expected deltas only)
    - Spike candidate: none
    - Actions:
      1. Extend `deep/stack.mjs` to surface the optional-dependencies groups (e.g. the `dev` extra) in the stack findings (today only `manifest.devDependencies` reaches the model).
      2. Render the `dev` extra into the Dev Dependencies table/section so the full toolchain (pytest, pytest-mock, pytest-cov, pytest-asyncio, ruff, refurb, ty, lefthook, bandit, diff-cover) is listed. Fixes c10.
      3. Update stack fixtures/tests; record expected pipeline-baseline deltas for T014.
    - Acceptance signal: `node --test --test-concurrency=1 test/stack.test.mjs` exits 0, and a python fixture with a `[project.optional-dependencies].dev` block asserts the dev-extra tools appear in the rendered stack.
    - Validation: determinism; golden test.
    - Acceptance evidence: test output; probe before/after Dev Dependencies table; expected-delta record.
    - Repair attempts: 0
    - Recovery note: if the dev extra duplicates existing dependency rows, dedupe by constraint source and re-run.

14. [pending] Configuration dimension: complete toolchain inventory
    - Task ID: T015
    - Depends on: T001 (wave ordering provides T002 first)
    - Parallel group: G3
    - Risk: standard
    - Owned scope: `lib/scan/deep/config.mjs` (supplementary declared-tool detector — do NOT modify the shared ecosystem descriptor, which T007 owns), `lib/scan/render/config.mjs`, `test/config.test.mjs`
    - Not in scope: shared/ecosystem.mjs descriptor changes (T007 owns); shared baseline files (DR1 — record expected deltas only)
    - Spike candidate: none
    - Actions:
      1. Add a supplementary detector in `deep/config.mjs` that inventories declared tool configs/deps not covered by the descriptor-driven `collectTools` (refurb, ty, radon, mutmut, hypothesis, import-linter, diff-cover, actionlint from pyproject `[dependency-groups]`/extras and tool config sections). Fixes c4.
      2. Render the complete toolchain in the Configuration section (distinguish descriptor-detected vs declared-supplementary provenance).
      3. Update config fixtures/tests; record expected pipeline-baseline deltas for T014.
    - Acceptance signal: `node --test --test-concurrency=1 test/config.test.mjs` exits 0, and a python fixture declaring the missing tools asserts they appear in the Configuration toolchain list.
    - Validation: determinism; no ecosystem-descriptor change (git diff shows shared/ecosystem.mjs untouched).
    - Acceptance evidence: test output; probe before/after Configuration section; expected-delta record.
    - Repair attempts: 0
    - Recovery note: if a tool is detected twice (descriptor + supplementary), dedupe by name with merged provenance and re-run.

15. [pending] Final gate: pipeline baselines, full suite, constraint gates, real-repo probe fact-by-fact, SKILL.md
    - Task ID: T014
    - Depends on: T002, T003, T004, T005, T006, T007, T008, T009, T010, T011, T012, T013, T015
    - Parallel group: G5
    - Risk: standard (SKILL.md is a skill artifact; baseline regeneration; verify independently)
    - Owned scope: `test/baselines/expansion/fixture-behavior.json`, `test/baselines/expansion/renderer.md`, `test/baselines/expansion/semantic.json` (single-owner regeneration per DR1), SKILL.md (dimension-description updates), probe evidence artifacts; no other production scanner files
    - Not in scope: new feature work beyond SKILL.md wording; command-test baselines (owned by T002)
    - Spike candidate: none
    - Actions:
      1. Consume every G3/G4 task's expected-delta records and regenerate the three pipeline-output baselines (fixture-behavior.json, renderer.md, semantic.json) using the documented recompute procedure (from T001's spike); submit each diff for independent review verifying only intended dimension deltas (DR9).
      2. Run the full authoritative suite `node --test --test-concurrency=1`; record the new pass count.
      3. Run every per-gate suite: constraints, determinism, privacy-gate, voice-gate, golden, and the T228 acceptance matrix; all green.
      4. Run the real-repo probe on perplexity-cli and verify AC2 and AC3 fact-by-fact against the saved "before" artifact (T001) — record a before/after table.
      5. Verify AC6: claim count is 94; every `93` literal updated (DR2); the baseline diffs contain exactly the intended dimensions.
      6. Verify no shortfall ships silently: walk a1–d10 and confirm each is fixed (evidence cited) or declined (A006/A007 + Exclusions).
      7. Update SKILL.md dimension descriptions (Conventions, Architecture, Testing, Security, Operations, Data, Documentation, Stack, Configuration, Practices, Git) to reflect the new facts; keep SKILL.md constraints wording intact.
    - Acceptance signal: `node --test --test-concurrency=1` exits 0 with the recorded new count; the probe fact-by-fact checklist (AC2, AC3) is fully evidenced; SKILL.md diff reviewed and committed.
    - Validation:
      1. Determinism gate: two identical probe runs byte-identical.
      2. One-write and zero-dependency constraint tests pass.
      3. Independent review of SKILL.md diff and each regenerated baseline diff.
    - Acceptance evidence: journal rows for every gate; probe before/after table; shortfall walk (a1–d10) table; baseline review notes.
    - Repair attempts: 0
    - Recovery note: if any gate fails, enter REPAIR on the owning task (map the failing test to its task via DR1/DR2/DR4/DR7), fix there, then re-run the full suite; do not bypass gates.

## Verification Strategy
Ordered cheapest-first; parallel where independent:
- Fast per-task gates (run inside each task): the task's own `node --test --test-concurrency=1 test/<dimension>.test.mjs` suites; voice gate + privacy gate for any task adding renderer/prose (T005, T006, T008, T012); determinism gate for count/ordering changes (T002, T003, T004, T007, T011).
- Medium per-task gates: expected-delta records for the shared pipeline baselines (T002–T013, T015 record; T014 regenerates); command-test baseline regeneration + independent diff review (T002).
- Expensive batch/final gates (T014): full `node --test --test-concurrency=1` suite; per-gate suites (constraints, determinism, privacy-gate, voice-gate, golden, expansion-final-acceptance); real-repo probe fact-by-fact; pipeline-baseline regeneration with independent review.
- Shared-baseline assertions (fixtures-pipeline.test.mjs, expansion-baseline.test.mjs, expansion-render-existing-ten.test.mjs) are expected to be red after G3/G4 source changes and are only re-run in T014 after regeneration; do not treat their intermediate failures as task failures (record in journal).
- Known environment-sensitive items: `golden.test.mjs` real-repo test is skipped with a warning if `/home/jamiemills/code/projects/perplexity-cli` is absent; the authoritative suite must run with `--test-concurrency=1` (parallel mode races fixture tests).

## Risks And Recovery
- R1 Broker boundary breach (T002): new Git command IDs must stay read-only and capped; mitigation — exact argv, `GIT_OPTIONAL_LOCKS=0`, output caps, tests asserting argv; recovery — revert broker change only, keep enum change disabled until broker reviewed.
- R2 Baseline churn (DR1): mitigations — ownership split (T002 command baselines; T014 pipeline baselines), expected-delta records, independent review of every regeneration; recovery — a task that breaks a shared baseline reverts only its own source diff (never the baseline), then T014 regenerates; a T002 baseline break reverts and regenerates within T002.
- R3 Claim-count/registry churn (T004): mitigations — DR2 checklist (registry + evidence categories + all four `93` literal locations); recovery — complete the checklist in one task; validation fails loudly on partial registration.
- R4 Voice/privacy gate trips (T006 conventions block, T008 pins): mitigations — tokenized facts only, follow existing privacy projections; recovery — further tokenize, never weaken gates.
- R5 Ecosystem-wide glob change (T007 b14): mitigations — python-descriptor-scoped change, full fixture wave, golden assertion updated in the same task (DR8); recovery — isolate python descriptor, re-run all five-ecosystem fixture suites.
- R6 Wrong facts regress after fix (b1–b15): mitigation — probe before/after table in T014 plus per-fact unit fixtures; recovery — REPAIR on the owning task.
- R7 Determinism drift from new fact ordering: mitigation — canonical-sorted/declaration-order emission everywhere; recovery — fix ordering in the emitting task and re-run determinism gate.
- R8 T209 command-boundary regression (T009's branch query): mitigation — allowlist extension completed in T002 before T009 runs (wave ordering); recovery — revert security.mjs to file-existence-only dependabot detection, flag b2 as partially fixed, re-open T009.
- Rollback: each task is a scoped module change with per-task tests; a failing task rolls back by reverting its owned files (git) and re-running its suite; plan-level rollback is not needed since tasks are independent modules.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| C1 AC2 universe mismatch (async/docstring numbers not reproducible) | critical | AC2 + T003 now pin the production-source-universe rule (A011) with disclosure; naming fact states snake_case-dominant/0-camelCase without exact counts | critique finding 1; NORM-fixed b1/b6 universe |
| C2 golden.test.mjs 240–320 conflicts with b14; no owner | critical | T007 owns test/golden.test.mjs and updates the assertion (DR8); validation adjusted | critique finding 2; golden.test.mjs:204-205 |
| C3 claim-count 93→94 misses expansion-constraints.test.mjs:343 + expansion-activation.test.mjs:516-517 | critical | T004 owns both files; DR2 lists all four literal locations | critique finding 3 |
| C4 T002 edits command tests pinned by capabilities.json/test-integrity.json | critical | T002 owns both baselines; regeneration + independent review; DR1 split | critique finding 4; expansion-constraints.test.mjs:183; expansion-baseline.test.mjs:149-151 |
| C5 AC6 freeze description wrong (per-ecosystem, omits dimensions) | critical | AC6 rewritten to enumerate the five baseline files and the full dimension set; DR1 ownership split; DR9 zero-churn verification | critique finding 5; fixture-behavior.json:10-14; fixtures-pipeline.test.mjs:63-74 |
| C6 c4 unmapped (ships silently) | critical | New task T015 (Configuration toolchain inventory); AC3/AC4 updated | critique finding 6; NORM-fixed c4 |
| C7 d9 split/decline not explicit; rationale overstated | major | T006 fixes d9 block-gate sub-fact; Exclusions/A007 rephrased as deliberate scope decision | critique finding 7 |
| C8 a22 seam-wiring fact infeasible from TOML parse | major | T004 action 2 scans the composition-root module for the `_wire_*_seam` pattern; fallback downgrade documented | critique finding 8; cli.py:36-77 |
| C9 G3 parallel-safety false (shared baseline files) | critical | DR1 single-owner split (T002/T014); no G3 task writes shared baselines; R2 rewritten | critique finding 9 |
| C10 b9 anchor direction contradictory in G3 | major | T012 anchors "X comment / Y total lines"; T003 verifies conventions label only | critique finding 10 |
| C11 T009 breaks T209 command-boundary test | major | T002 action 4 extends the T209 allowlist (git:branch-list for security.mjs); T009 consumes the allowance; R8 added | critique finding 11; expansion-command-deep.test.mjs:90-118 |
| C12 T013 cannot deliver c10 (optionalDeps not in stack model) | major | T013 owns deep/stack.mjs; A014 | critique finding 12; deep/stack.mjs:309,413 |
| C13 T002 fixture mechanism unstated | minor | T002 action 6 names makeGitRepo or recording broker | critique finding 13 |
| C14 Dependencies overstated for 8 of 9 G3 tasks | major | A015: wave ordering is the gate; per-task Depends state true inputs only (T003/T011 on T002; rest on T001) | critique finding 14 |
| C15 Execution-graph vs Depends reconcile | nit | Execution Graph notes wave ordering; T006 Depends unchanged | critique finding 15 |
| C16 DR1/R2 rollback broken for shared baselines | major | DR1 rollback rule + R2 rewritten (revert own source, never baseline; single regenerator) | critique finding 16 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | INTAKE | — | Ask classified: large, prescriptive; goal = fix csm-scan so future NORMS.md runs carry NORM-fixed.md's added/corrected insights; deliverables = plan only | DISCOVER |
| 2026-08-03 | 0 | DISCOVER | — | Read NORMS.md (1524 lines), NORM-fixed.md (921 lines), csm-scan SKILL.md, skill repo inventory (202 files, 6 complete plans, 1133/1133 baseline) | RESEARCH |
| 2026-08-03 | 0 | RESEARCH | 3 parallel tracks | Track A: 63-item shortfall→module mapping (8 clusters, 5 risky, 3 constraint-limited); Track B: root causes for b1–b15 reproduced exactly (file:line); Track C: skill state, registry, test/plan conventions; all read-only, skill repo untouched | DRAFT |
| 2026-08-03 | 0 | DRAFT | — | Draft written: 14 tasks (G1–G5), AC1–AC6, exclusions A006/A007, one new claim, freeze re-baseline plan | CRITIQUE |
| 2026-08-03 | 0 | CRITIQUE | — | Independent hostile review: NEEDS-CORRECTION, 16 findings (6 critical, 7 major, 3 minor/nit) incl. unmapped c4, G3 baseline conflict, golden.test.mjs vs b14, claim-literal gaps, T209 allowlist, dependency overstatement | REMEDIATE |
| 2026-08-03 | 0 | REMEDIATE | — | All 16 findings resolved: T015 added (c4), DR1 baseline ownership split, A011–A015, T007 owns golden, T004 owns constraint/activation tests + seam scan, T013 owns deep/stack.mjs, T209 allowance in T002, b9 anchor in T012, dependencies corrected, Exclusions/A007 rephrased | VERIFY |
| 2026-08-03 | 0 | VERIFY | — | Primary-agent gate passed: all 63 shortfalls mapped (61 fixed + 2 declined sub-facts with rationale); every task has runnable acceptance signal, risk tier, anti-scope, recovery note, `[pending]`; G3 pairwise-disjoint source ownership + DR1 baseline split; named files match observed repo; AC1–AC6 map to numbered work; journal/Control enable fresh-agent recovery | SAVED |

## Completion Review
Filled by csm-build when all criteria are verified.
