format: csm-plan/1
# TDAD Phase 1: Verification Machinery In csm-build CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 6 standard tasks (tooling and documentation edits; no security, data, destructive, or public-interface impact). No task mandates independent review; the T007 integration battery is primary-verified and re-runs the full suite.

## Control
- Plan ID: tdad-verification-machinery
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-20T21:40Z — user amendments applied (manifest assessment in the verification loop; TRIAGE re-scoped to exceptional capability-equipment); gate re-verified
- Last model/run: deepseek-v4-flash (planning session)
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Implement Phase 1 of the TDAD verification layer in this repo: every csm-build iteration emits a versioned, content-hashed evidence manifest with honest `pass` / `fail` / `inconclusive` outcomes, driven by a plan-level Verification Contract, diff-grounded test selection, and a manifest **assessment** that confirms what was intended has been built — evaluated against the plan intent as adapted during the build (adaptations agreed during the build phase must be considered). A new TRIAGE state at build start handles, in exceptional circumstances only, the case where the build lacks the tools and skills to execute the plan it was given (e.g., an unfamiliar language): it dispatches a scoped csm-deep-research run to learn how to equip itself (tools, CLI recipes, skills), makes the equipment available for use, drafts a PR contribution back to this repo (human-sent; never pushed), and only then continues the build.

Deliverables:
1. `scripts/lib/verification.mjs` — zero-dependency ESM module: Verification Contract parser (shallow YAML incl. one-level nested maps), changed-file collection, test discovery, static-import map, workspace package map, affected-test selection with confidence + rationale, three-state status derivation, manifest emit/validate. Unit tests in `tests/verification.test.mjs` + fixtures under `tests/fixtures/verification/`.
2. `csm-build/SKILL.md` — new TRIAGE state (`RECOVER -> TRIAGE -> VALIDATE -> ...`) as an **exceptional capability-equipment step** (build lacks the tools/skills to execute the plan; e.g. a new language): scoped csm-deep-research dispatch to learn how to equip, equipment made available before the build continues, PR draft back to this repo; three-state VERIFY/CHECKPOINT semantics including the manifest **assessment pass** (intent vs built, adaptations considered); `inconclusive` -> BLOCKED decision protocol; per-cycle manifest emission; `Last manifest:` Control bullet; evidence manifest added to the Interface Produces bullet.
3. `scripts/lib/plan-validation.mjs` — add `TRIAGE` to `BUILD_MACHINE`.
4. `scripts/lib/contracts.mjs` — csm-build row gains `'csm-deep-research': false` in NEVER_INVOKE; INTERFACES csm-deep-research entryConditions/handoff gain csm-build; matrix comment updated.
5. `csm-deep-research/SKILL.md` — Hands off prose gains csm-build (triage-scoped dispatch).
6. `README.md` — dispatch-edge statement updated; README matrix regenerated via `gen-readme-matrix.mjs --write`; chain prose updated; workflow diagram and skills table gain the triage dispatch edge.
7. `csm-plan/SKILL.md` — Verification Contract guidance (body section with fenced YAML example, outside the template fence) + one sentence on its own line under the template's `## Design` heading (heading line itself unchanged); build-state chain mention gains TRIAGE.
8. `csm-bdd-tdd/SKILL.md` — scenario `@type=<taxonomy>` Gherkin tag (acceptance | negative-abuse | regression | property-invariant | contract | integration).
9. Ecosystem knowledge base convention `.agents/ecosystems/<ecosystem-slug>.md` + PR-draft protocol `.agents/ecosystems/drafts/<date>-<ecosystem-slug>-pr.md` — documented in csm-build/SKILL.md TRIAGE section; `.agents/README.md` gains `## ecosystems/` index section.
10. Re-synced payload mirror, green gate (count change intentional and documented), passing tests.

Constraints:
- No new skill registration; no plan-format version bump (`format: csm-plan/1` unchanged); no new gated checks; the check-suite count rises only by this plan's own corpus checks when the plan is committed — the baseline re-record at T007 is an explicit, documented step.
- No mutation/property execution, no metric fields, no AST/symbol graphs (deferred per approach doc).
- The build never pushes; PRs are drafted as description files, sent by the human.
- Zero new runtime dependencies (repo tooling is node:builtins-only; hand-rolled shallow YAML parser).
- The csm-plan template fence must not gain nested fences or trailing text on its `## ` heading lines; the Verification Contract example lives in the SKILL body.

Exclusions:
- csm-tdad skill (Phase 2), ecosystem KB *content* (created by TRIAGE at runtime, not by this plan), mutation/property machinery, metrics, dashboards, waivers.

## Acceptance Criteria

1. `scripts/lib/verification.mjs` exports the documented API (including `buildPackageMap` and `buildAssessment`) and `node --test tests/verification.test.mjs` passes: contract parsing (this plan's own contract block, absent, malformed, nested-map variants), changed-file collection against a temp git fixture, discovery + selection on fixtures, status derivation for all pass/fail/inconclusive combinations **including assessment-influenced outcomes** (assessment fail -> fail; assessment inconclusive -> inconclusive; adaptations recorded and considered), manifest emit/validate round-trip, and the score-threshold mapping.
2. csm-build/SKILL.md contains the TRIAGE state in its chain as an exceptional capability-equipment step (capability-gap trigger only, human-gated deep-research dispatch, equipment available before the build continues, PR draft), the `inconclusive` -> BLOCKED protocol, per-cycle manifest emission, and the VERIFY/CHECKPOINT **assessment pass** (built diff assessed against the adapted plan intent — Goal, ACs, Design, task scope — with adaptations agreed during the build read from the plan journal/Control as the baseline, and undocumented divergence recorded as a gap); `node scripts/check-suite.mjs` passes (machine, matrix, interface, payload, F-052 checks green) after each task's pack-bootstrap re-sync.
3. contracts.mjs NEVER_INVOKE csm-build row contains `'csm-deep-research': false`; csm-build's "Never invokes" bullet is unchanged; README matrix regenerated and drift-free; the workflow diagram and skills table show the triage dispatch edge.
4. csm-plan and csm-bdd-tdd SKILL.md contain the new guidance (contract block + scenario typing); the csm-plan template's `## Design` heading line is byte-unchanged and the template fence contains no nested fences; payload mirror byte-identical after each task's `node scripts/pack-bootstrap.mjs`.
5. `make lint` passes; `make test` and the suite-tooling test line (`node --test tests/check-suite.test.mjs tests/token-efficiency.test.mjs tests/cache-health.test.mjs tests/wt-session.test.mjs tests/verification.test.mjs`) pass.
6. The gate-baseline is re-recorded at SAVED for the post-plan count (expected +~5 checks, RD-07), documented in the journal; the T007 `--check` passes with no further change; if the count moves for any other reason, it is investigated before re-recording.

## Current-State Evidence
- csm-build chain today: `RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT` (csm-build/SKILL.md:96, headings :104-197); no TRIAGE, no third verification outcome; only carve-out is "unavailable check with stated reason and residual risk" (csm-build/SKILL.md:235).
- NEVER_INVOKE csm-build row: 8 columns, no csm-deep-research (scripts/lib/contracts.mjs:176); expected sets derive from true-valued filtered row keys (check-suite.mjs:708-710) so a false cell needs no bullet edit; the matrix comment (:165-172) goes stale.
- INTERFACES csm-deep-research entryConditions/handoff name only grill/plan dispatch (contracts.mjs:139,142); README matrix fence is gate-enforced via gen-readme-matrix.mjs drift (check-suite.mjs:1081-1082); regenerate with `node scripts/gen-readme-matrix.mjs --write`.
- README.md:115 states the only sanctioned dispatch edge is csm-grill/csm-plan -> csm-deep-research; README.md:123 carries the build chain prose; the mermaid workflow (:39-45) and skills table (:70-79) name dispatchers.
- BUILD_MACHINE lacks TRIAGE (scripts/lib/plan-validation.mjs:46) — any plan/journal mention of TRIAGE would fail the gate until added.
- parsePlanControl recognizes exactly Status / Current CSM state / Next transition (plan-validation.mjs:141-155); extra Control bullets like `- Last manifest:` are fully tolerated; close-plan.mjs rewrites only 6 prefixes (close-plan.mjs:109-132), so `Last manifest:` survives.
- Template mechanics: csm-plan template is one outer fence (csm-plan/SKILL.md:203); template h2 headings are extracted as the whole line with no trailing-text trimming (check-suite.mjs:796-797) and matched by exact equality in subsequenceGap (:285-299, :881-882) — heading lines must stay byte-identical; a nested fence inside the template would break fencedBlockAfter extraction (:790-799) and fail the corpus gate; the Verification Contract example must stay outside the template fence.
- Boilerplate sync: TMUX_PARAMS covers 6 skills, RESILIENCE_PARAMS covers 5 (scripts/lib/boilerplate.mjs:19-44, 59-85); for csm-build only `Tmux Session Bootstrap` is synced — Execution State Machine and Required Plan Document edits trigger no boilerplate drift (verified by the critic).
- No YAML/JSON-schema dependency in repo tooling (package.json devDeps: lefthook, oxlint only); scripts/lib is zero-dep ESM (node:builtins only); csm-scan has a hand-rolled shallow YAML parser (csm-scan/lib/scan/shared/parse.mjs:438) but it lives in csm-scan's closure.
- Payload mirror is a hard gate: every SKILL.md edit requires `node scripts/pack-bootstrap.mjs` (checkPayloadDrift, check-suite.mjs:511-548); the pack step is idempotent and content-derived from the whole tree, so concurrent packs converge on identical mirrors.
- Committing a new corpus plan raises the parsed check count (~5 checks per plan; counter at check-suite.mjs:57-60); the pre-commit gate-baseline job hard-fails on any deviation (record-gate-baseline.mjs, .lefthook.yml:17-24); the baseline was recorded at 649 (commit 9d799ec).
- Runner CLI facts (retrieved 2026-08-20): Jest `--findRelatedTests <files> --listTests --passWithNoTests` (combination de-facto, not documented; jest docs v30.4); Vitest `vitest related <files> --run`, `vitest list --filesOnly --json --static-parse` (4.1+), `--changed <ref> --run` (v4.1.11 docs); node:test has NO affected selection and NO json reporter (built-ins spec/tap/dot/junit/lcov; v26.7.0 docs; discovery default globs documented); pytest `--collect-only -q` imports modules during collection (not side-effect-free), pytest-picked 0.5.1 (2024-11-06) git-status based; cargo-test-changed 0.1.1 (2025-04-04) `--dry-run -j`, crate-level, github.com/felixpackard.
- .agents/ has approaches/, docs/, plans/, research/ (+artifacts/), reviews/, README.md, token-efficiency.json; no evidence/ or ecosystems/ yet. .agents/README.md is a hand-maintained one-line-per-artifact ledger (not gate-enforced).
- Gate currently green: "check-suite: OK — 9 skills, 649 checks".
- Deep-research dispatch mechanics: no SKILL.md line restricts dispatchers (csm-deep-research/SKILL.md:37-47); the restriction lives in contracts.mjs data; dispatching skill provides question + goal-slug, findings land at `.agents/research/<date>-<slug>-research.md`, artifacts under `.agents/research/artifacts/` (SKILL.md:18, 69, 138).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| AD-01 | TRIAGE is a first-class build state between RECOVER and VALIDATE, not a sub-step of RECOVER | user-dictated (approach doc decision 6b) | grill decision B "deployed at an early triage step of the build (before validation)"; gate machine checks are fully dynamic (verifyMachine, check-suite.mjs:311-372) | accepted |
| AD-02 | Matrix edit adds a false cell; no csm-build "Never invokes" bullet change | decision | expected sets derive from true-filtered row keys (check-suite.mjs:708-710); matches grill/plan rows pattern (contracts.mjs:177-178) | accepted |
| AD-03 | Verification Contract attaches as fenced YAML inside the plan's Design section; example lives outside the csm-plan template fence; the template's `## Design` heading line stays byte-identical and the guidance sentence goes on its own line under the heading | user-dictated (approach doc decision A) + critique F4 | template h2 lines are exact-matched (check-suite.mjs:796-797, 285-299); nested fences break fencedBlockAfter (check-suite.mjs:790-799) | accepted |
| AD-04 | Overall status derivation: fail if any required check failed; else inconclusive if any required check unavailable or not-applicable; else pass. `not-applicable` is green-side only when the check is not required | user-dictated (approach doc decision Q3) | decision log row 3; only required evidence derives inconclusive | accepted |
| AD-05 | Manifest lifecycle: per-cycle manifests are disposable; the latest cycle's manifest persists in the working tree (`.agents/evidence/<plan-id>-<cycle>-manifest.json`), overwritten at each CHECKPOINT; only the final-cycle manifest is committed with the plan at COMPLETE, referenced via `Last manifest:` Control bullet | decision + critique F9 | plan is the durable record; parsePlanControl tolerates extra bullets; close-plan.mjs does not clobber `Last manifest:` | accepted |
| AD-06 | Baseline-failure attribution reads the prior-cycle manifest with match key = check name + command + sorted selectedTests (`baselineFailure: true` when the same check previously failed); first cycle records no baseline manifest | decision + critique F9 | cheapest honest attribution; consistent with AD-05 retention (prior manifest exists until overwritten) | accepted |
| AD-07 | Selection module: runner-native affected flags when the framework is detected (Jest/Vitest/cargo-test-changed); node:test and pytest via static-import + path/package heuristics (pytest enumeration only when import-safe); runner-native commands are executed list-only where possible; confidence + rationale always recorded | user-dictated (approach doc decision Q5) + critique F7 | scout 2 findings (retrieved 2026-08-20); pytest --collect-only imports modules | accepted |
| AD-08 | TRIAGE trigger = capability gap, exceptional only: the plan's required evidence or tasks need tooling with no executable recipe available (no KB entry for the detected ecosystem/language, not detectable in the repo, no suite guidance), so the build cannot validate or proceed without it; one dispatch per ecosystem per repo; any other use is out of scope | user amendment (2026-08-20) | user: "intended to be invoked for new code bases where csm-build lacks access to tools and skills to proceed with building a plan it has been given — exceptional circumstances only, nothing more" | accepted |
| AD-09 | PR draft = description file `.agents/ecosystems/drafts/<date>-<ecosystem-slug>-pr.md` (title, body, changed files, exact `gh pr create` command); never pushed by the build | user-dictated (approach doc decision 6b) | suite never-push rule absolute (csm-build/SKILL.md:38); no gh pr mechanism exists in repo (scout 3) | accepted |
| AD-10 | `.agents/ecosystems/` entries are advisory data; no new gate corpus; `.agents/README.md` gains a hand-maintained `## ecosystems/` section | decision | NORMS.md optional/advisory model (contracts.mjs:150-153); approach doc line 88 | accepted |
| AD-11 | No new gated checks; the check-suite count rises only by this plan's own corpus checks when the plan is first staged (untracked corpus files are skipped — check-suite.mjs:616-620); the baseline is re-recorded at SAVED when the plan enters the tracked corpus, and again at T007 only if the build phase changes the count | decision + critique F6 | committing a corpus plan adds ~5 checks (check-suite.mjs:57-60); gate-baseline hard-fails on deviation (.lefthook.yml:17-24) | accepted |
| AD-12 | Lib is zero-dependency; shallow YAML parser hand-rolled: flat keys, scalars (incl. quoted), booleans, `- ` lists, and one-level nested maps whose leaves are scalars or lists; anything else -> parse error, not silent pass | decision + critique F3 | repo tooling is node:builtins-only; csm-scan parser not importable from scripts/lib; the agreed contract shape includes `humanApproval: {required, requiredWhen}` | accepted |
| AD-13 | TRIAGE dispatch of csm-deep-research is optional for the human: if declined, the manifest records the learning request as unavailable evidence -> contributes to inconclusive | decision | keeps the human terminal gate; no silent skip | accepted |
| AD-14 | csm-bdd-tdd scenario typing rides a Gherkin tag `@type=<taxonomy>` directly above the Scenario keyword in the scenario template; mutated-plan task blocks unchanged | decision + critique F10 | Gherkin-native syntax (tags); scenarios already carry stable ids referenced from tasks | accepted |
| AD-15 | Selection scoring: exact-import edge = 1.0, direct source-to-test adjacency = 0.9, same-package = 0.7, transitive/package-level = 0.5; required = score >= 0.7, recommended = 0.5 <= score < 0.7; runner-native affected output overrides and is recorded alongside | decision + critique F8 | deterministic defaults; override path preserves runner truth | accepted |
| AD-16 | Ecosystem slug rule: lowercase alphanumerics + hyphens; any other character (e.g. `:` in `node:test`) replaced with `-` | decision + critique F11 | slug used for KB file, PR draft, goal-slug, and tmux session name | accepted |
| AD-17 | Each SKILL-editing task runs `node scripts/pack-bootstrap.mjs` + `node scripts/check-suite.mjs` in its own actions and acceptance (the pack step is idempotent and tree-derived, so concurrent packs converge) | decision + critique F5 | payload mirror is a hard gate (check-suite.mjs:511-548); deferring to T007 left every G1 gate red | accepted |
| AD-18 | Manifest assessment: `assessment{intentMatch: pass|fail|inconclusive, adaptations[], gaps[]}` is a required manifest section produced by a primary-agent judgment pass at VERIFY/CHECKPOINT; the assessment compares the built diff against the plan intent AS ADAPTED during the build — adaptations agreed during the build phase (Discovered Requirements, re-scoped tasks, corrected interfaces, blocker resolutions, journaled plan updates) are the baseline, not the original plan text alone; undocumented divergence is a gap | user amendment (2026-08-20) | user: manifest "needs assessed as a part of the verification loop ... to confirm that what is intended has been built (subject to adaptations agreed during the build phase which must be considered)"; csm-build already journals adaptations (CHECKPOINT/REPAIR/SELECT) | accepted |
| AD-19 | Assessment participates in overall derivation: fail if any required check failed OR assessment.intentMatch = fail; inconclusive if (no fail) and (any required check unavailable/not-applicable OR assessment.intentMatch = inconclusive); else pass | decision | extension of AD-04; the manifest's purpose is confirming intent was built, so its assessment cannot be ornamental | accepted |
| AD-20 | Equipment flow order: research (deep-research dispatch) -> equip (KB entry written and consumed as inline guidance for the remainder of the build) -> PR draft -> then VALIDATE; the build does not proceed past TRIAGE until equipment is available or the human declines | user amendment (2026-08-20) | user: "identify how best to equip itself with tools skills and such, make them available for use, and send a PR with this info back to the repo, before continuing with the build" | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD-01 | Would adding TRIAGE to the csm-build chain break the machine gate or tests? | read-only code inspection (check-suite.mjs verifyMachine, tests/check-suite.test.mjs machine family) | no commands run; git status unchanged | verifyMachine is fully dynamic; no chain-length literals; machine test corrupts csm-plan, not csm-build | safe; must renumber headings and update BUILD_MACHINE (plan-validation.mjs:46) or plans mentioning TRIAGE fail the gate |
| RD-02 | Does a false matrix cell require a SKILL.md bullet edit? | read-only inspection of expected-set derivation | no commands run | expected = true-filtered row keys; false cells excluded | csm-build "Never invokes" bullet unchanged; comment at contracts.mjs:168 goes stale -> update comment |
| RD-03 | Would a fenced-YAML Verification Contract inside the csm-plan template break the gate? | read-only inspection of template extraction and corpus checks | no commands run | template h2 lines are exact-matched as whole lines (check-suite.mjs:796-797, 285-299); nested fences break fencedBlockAfter (:790-799) | keep the example in the SKILL body; template gains prose only on its own line under `## Design`; heading lines byte-identical |
| RD-04 | Does any plan parser reject unknown Control bullets / Design content? | read-only inspection of plan-validation.mjs, close-plan.mjs, check-plan-signals.mjs | no commands run | parsePlanControl matches 3 keys only; no unknown-bullet rejection; close-plan rewrites 6 prefixes; extractSignals fence-aware; validateOrdinalSequencing skips fences | `- Last manifest:` bullet and fenced YAML in Design are safe |
| RD-05 | What are the current runner-native affected-test commands? | webfetch (jestjs.io/docs/cli v30.4; vitest.dev/guide/cli v4.1.11; nodejs.org docs v26.7.0; docs.pytest.org 9.1.1; docs.rs cargo-test-changed 0.1.1) — retrieved 2026-08-20 | read-only retrieval only; no local writes | Jest findRelatedTests+listTests (combo de-facto); Vitest related/list --static-parse --run; node:test none (globs only, no json reporter); pytest --collect-only imports code; cargo-test-changed --dry-run -j | selection module per AD-07; document the jest combo caveat in the module header |
| RD-06 | Are KB entries and manifest files gate-validated? | read-only inspection of check-suite.mjs corpus blocks and README_PATH_RE | no commands run | research corpus readdir is non-recursive, filter `*-research.md`; README_PATH_RE requires `csm-<skill>/` prefix | `.agents/ecosystems/` and `.agents/evidence/` are outside all gate scans; advisory/disposable per AD-10/AD-05 |
| RD-07 | Does committing this plan raise the parsed check count? | read-only inspection of the plan corpus check and counter (check-suite.mjs:57-60, 876-921) + live probe | gate run with the plan at its final path | untracked plan is skipped (check-suite.mjs:616-620) — count stays 649; once staged/tracked the count rises ~5 | baseline re-recorded at SAVED (AD-11); T007 only re-checks |
| RD-08 | Is pytest enumeration side-effect-free? | read-only inspection of plan draft + external docs (docs.pytest.org, retrieved 2026-08-20) | no commands run | `--collect-only` imports modules and conftest during collection | pytest defaults to the heuristic path (AD-07, critique F7) |

## Discovered Requirements
- TRIAGE must be added to BUILD_MACHINE in scripts/lib/plan-validation.mjs:46 before any plan, journal, or Control value mentions TRIAGE; otherwise `validatePlanControl`/journal checks fail the gate (RD-01, scout 1 §2).
- Every edit to csm-plan/SKILL.md, csm-build/SKILL.md, csm-bdd-tdd/SKILL.md, or csm-deep-research/SKILL.md requires `node scripts/pack-bootstrap.mjs` to re-sync `bootstrap/package/payload/skills/**` (byte-identical mirror gate, check-suite.mjs:511-548); each SKILL-editing task runs it before its own gate check (AD-17).
- README matrix fence is gate-enforced: after any INTERFACES edit, run `node scripts/gen-readme-matrix.mjs --write` (check-suite.mjs:1081-1082).
- The csm-plan template fence (csm-plan/SKILL.md:203) must never contain nested backtick fences, and its `## ` heading lines must remain byte-identical (exact-match subsequence, check-suite.mjs:796-797, 285-299); template prose describing the Verification Contract goes on its own line under `## Design` without literal triple-backtick sequences (RD-03, F4).
- State-machine headings must be consecutively numbered from 1 in chain order (check-suite.mjs:349-352); inserting TRIAGE renumbers sections 2-10.
- Zero-dependency constraint: scripts/lib modules use node:builtins only (package.json devDeps = lefthook, oxlint; AD-12).
- Node >= 22, ESM modules (.mjs), 'use strict' convention per plan-validation.mjs/token-efficiency.mjs.
- The csm-build chain appears in prose at csm-plan/SKILL.md:159, csm-bdd-tdd/SKILL.md:190, README.md:123 — update all three for coherence (not gate-checked).
- F-052 README path scan is untouched by new `.agents/` dirs (regex requires `csm-<skill>/` prefix).
- The matrix comment at contracts.mjs:168 ("the 6 other rows carry 8 columns") becomes stale after the edit; update to "5 other rows".
- gate-baseline: `make check`/pre-commit parse "N checks" and fail on deviation from `.agents/docs/gate-baselines.json` (recorded 649); the plan's own staging raises the count (RD-07) — the baseline is re-recorded at SAVED, with documentation (AD-11).
- Jest `--listTests --findRelatedTests` combination is de-facto, not documented (jest v30.4 docs) — the module should fall back to `--listTests` alone + heuristics if the combo output is empty/unexpected.
- node:test has no JSON reporter; the selection module discovers node:test files by replicating the documented default globs (`**/*.test.{cjs,mjs,js}`, `**/*-test.*`, `**/*_test.*`, `**/test-*.*`, `**/test.*`, `**/test/**/*.{cjs,mjs,js}`).
- The payload mirror is a shared write target across G1 tasks; the pack step is idempotent and tree-derived so concurrent packs converge on identical mirrors (AD-17).

## Design

### Verification Contract block (this plan — dogfoods the new convention)

```yaml
verification:
  changeClass: skill-suite-tooling-and-docs
  riskTier: medium
  nonGoals:
    - No new skill registration
    - No plan-format version bump
    - No mutation/property execution
  invariants:
    - csm-build state machine chain remains valid under verifyMachine
    - README matrix stays drift-free against contracts.mjs
    - payload mirror stays byte-identical
    - check-suite count changes only intentionally
    - manifest assessment confirms intent or records adaptations
  requiredEvidence:
    - lint
    - check-suite
    - unit-tests
  escalationTriggers:
    - payload-drift
    - matrix-drift
    - gate-count-change
  humanApproval:
    required: false
```

### Target behavior

1. **Verification Contract** (`scripts/lib/verification.mjs`): `parseVerificationContract(planText)` extracts the fenced YAML block under `## Design` whose top-level key is `verification:`; the shallow YAML reader handles flat keys, scalars (incl. quoted strings), booleans, `- ` lists, and one-level nested maps whose leaves are scalars or lists; anything else returns `{contract: null, reason}` — never a silent partial parse. Field validation: `changeClass`, `riskTier`, `requiredEvidence` required; `nonGoals`, `invariants`, `escalationTriggers`, `humanApproval` optional.
2. **Changed-file collection**: `collectChangedFiles()` = `git diff --name-only HEAD` (staged + unstaged) plus `git ls-files --others --exclude-standard` (untracked, excluding `.agents/` artifacts); baseSha = current HEAD.
3. **Test discovery + selection**: `discoverTestFiles(root)` detects the primary runner (jest.config*/vitest.config*/pytest.*/pyproject.toml [tool.pytest]/Cargo.toml/else node:test) and enumerates test files. Enumeration is runner-native only where import-safe: vitest `list --filesOnly --json --static-parse` (4.1+), jest `--listTests`, cargo manifest walk; pytest `--collect-only -q` is used only when the repo is known import-safe, otherwise the heuristic path; node:test via replicated default globs. `buildStaticImportMap(files)` = regex scan of ESM/TS `import`/`export ... from`/`require(` lines (no full AST). `buildPackageMap(root)` = workspace detection (pnpm-workspace.yaml, package.json workspaces, Cargo.toml members, go.work) -> package name per directory. `selectAffectedTests(changedFiles, testFiles, importMap, pkgMap)` returns `{required: [{test, reason, score}], recommended: [...], confidence}` with the AD-15 weights: exact-import = 1.0, direct adjacency = 0.9, same-package = 0.7, transitive/package-level = 0.5; required = score >= 0.7, recommended = 0.5 <= score < 0.7. When a runner-native affected flag exists (jest `--findRelatedTests --listTests`, vitest `related`, cargo-test-changed `--dry-run -j`), it is invoked list-only and its output overrides the heuristic result; both are recorded.
4. **Three-state semantics**: `deriveOverallStatus(checks, assessment, contract)` — per-check status `pass | fail | unavailable | not-applicable`; the manifest assessment (AD-18/AD-19) participates in the outcome: overall = `fail` if any required check failed OR `assessment.intentMatch` = fail; else `inconclusive` if any required check is `unavailable` or `not-applicable` OR `assessment.intentMatch` = inconclusive (with the missing-evidence/gap list); else `pass`. `not-applicable` outside required evidence never blocks. `buildAssessment({intentMatch, adaptations, gaps})` assembles and validates the assessment record (the judgment itself is the primary agent's VERIFY pass, not a lib function).
5. **Manifest** (`emitManifest`, `validateManifest`): JSON at `.agents/evidence/<plan-id>-<cycle>-manifest.json`; schema v1 — `schemaVersion`, `change{gitSha, baseSha, diffHash, changedFiles[]}`, `contract{id?, riskTier, changeClass, invariants[]}`, `testSelection{algorithmVersion, confidence, required[], recommended[]}`, `checks[]{name, category, status, command, durationMs, selectedTests[], junitRef?, baselineFailure?}`, `assessment{intentMatch, adaptations[{what, approvedBy, when}], gaps[]}`, `learningRequest?{ecosystem, status}`, `policy{riskTier, decision, escalations[]}`, `overall{status, generatedAt}`. `diffHash` = sha256 of `git diff HEAD` output. Content hash = sha256 of the canonical JSON minus the hash field. Lifecycle per AD-05/AD-06: the latest cycle's manifest persists untracked and is overwritten at each CHECKPOINT; baseline attribution reads the prior manifest (match key = check name + command + sorted selectedTests); the final-cycle manifest is committed with the plan at COMPLETE.
6. **csm-build TRIAGE state** (new `### 2. TRIAGE`) — exceptional capability equipment, nothing more (AD-08): (1) collect changed files + classify change class/risk from the contract; (2) capability-gap detection: can the plan's required evidence and tasks be executed with available tooling? Signals = no KB entry for the detected ecosystem/language (KB = `.agents/ecosystems/<ecosystem-slug>.md`, slug rule AD-16), tooling not detectable in the repo, no suite guidance; (3) only on a gap, offer the human a scoped csm-deep-research dispatch: question "How should this suite equip itself to build and verify <ecosystem> projects?" (tools, CLI recipes, test-impact flags, agent-facing skill guidance) + goal-slug `<ecosystem-slug>-verification-tooling`; on acceptance, dispatch by name (terminal run writing only `.agents/research/`); (4) **equip before continuing** (AD-20): curate findings into the KB entry — the equipping artifact, consumed as inline guidance for the remainder of the build — then draft `.agents/ecosystems/drafts/<date>-<ecosystem-slug>-pr.md` (title, body, changed files, exact `gh pr create` command) to contribute the equipment back to opencode-skills, record `learningRequest{status: learned|declined|failed}` (decline/failure -> unavailable evidence -> inconclusive contribution, AD-13); (5) only then pass changed files + selection input to VALIDATE. No gap -> TRIAGE passes straight through at zero added cost.
7. **VERIFY/CHECKPOINT semantics**: VERIFY runs checks in the contract's `requiredEvidence` order (cheapest-first per task), recording per-check status + command + durationMs + selectedTests, then runs the **assessment pass** (AD-18): the primary agent assesses the built diff against the adapted plan intent — Goal, Acceptance Criteria, Design, task scope — reading adaptations agreed during the build from the plan journal and Control (Discovered Requirements, re-scoped tasks, corrected interfaces, blocker resolutions) as the baseline; undocumented divergence is recorded as a gap. CHECKPOINT derives overall (checks + assessment), emits the manifest, journals `- Last manifest: <path>`, and on `inconclusive` transitions to BLOCKED with exactly one numbered question (accept-with-residual-risk / broaden-verification / repair) per the Blocker Rules format; `fail` follows the existing REPAIR path.

### Interfaces

- `scripts/lib/verification.mjs` exports: `parseVerificationContract`, `collectChangedFiles`, `discoverTestFiles`, `buildStaticImportMap`, `buildPackageMap`, `selectAffectedTests`, `deriveOverallStatus`, `buildAssessment`, `emitManifest`, `validateManifest`.
- Manifest schema v1 is the interchange for Phase 2 (csm-tdad) and future measurement; the schema docblock in the module is the source of truth.
- Ecosystem KB entry shape: `## Overview`, `## Test frameworks and discovery`, `## Affected-test commands`, `## Mutation/property tooling`, `## CLI recipes`, `## Agent-facing guidance` (skill-like instructions for building and verifying this ecosystem), `## Sources` (dated, URL + retrieval date).

## Execution Graph

- G1 (parallel, non-overlapping write ownership): T001 (lib + tests + fixtures), T003 (csm-build SKILL + plan-validation), T004 (contracts + deep-research SKILL + README + matrix regen), T005 (csm-plan SKILL), T006 (csm-bdd-tdd SKILL). The payload mirror is a shared re-sync target but the pack step is idempotent and tree-derived, so each task's own pack+gate converges (AD-17).
- G2: T007 (integration battery, baseline re-record, ledger, Makefile) — depends on all of G1.
- Critical path: T001 -> T007.
- No cross-task file collisions: verification.mjs vs csm-build/SKILL.md vs contracts.mjs/README vs csm-plan/SKILL.md vs csm-bdd-tdd/SKILL.md.

## Numbered Plan

1. [pending] Implement verification lib + unit tests
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `scripts/lib/verification.mjs`, `tests/verification.test.mjs`, `tests/fixtures/verification/**`
   - Not in scope: any SKILL.md, contracts.mjs, README, Makefile edits; no new dependencies; no mutation/property logic
   - Spike candidate: none — design fully specified in this plan's Design section
   - Actions:
     1. Write `scripts/lib/verification.mjs` per Design section (zero-dep ESM, 'use strict', JSDoc header; export the 10 documented functions).
     2. Hand-rolled shallow YAML reader for the contract block per AD-12 (flat keys, scalars incl. quoted, booleans, lists, one-level nested maps with scalar/list leaves; anything else -> `{contract: null, reason}`).
     3. Selection module per AD-07/AD-15 with the runner table from Discovered Requirements (include the Jest combo caveat in the header comment).
     4. `buildAssessment` per AD-18/AD-19 (assembles + validates the assessment record: intentMatch, adaptations[{what, approvedBy, when}], gaps; rejects missing intentMatch).
     5. Manifest emit/validate per schema v1 (content hash = sha256 of canonical JSON minus hash field; assessment section required).
     6. Write `tests/verification.test.mjs` (node --test) + fixtures: contract parse on this plan's own block (incl. its nested `humanApproval` map), absent/malformed variants; changed-file collection against a temp git fixture; discovery + selection on `tests/fixtures/verification/` (fake package tree with import edges); score-threshold mapping per AD-15; deriveOverallStatus for all pass/fail/inconclusive combinations **including assessment-influenced outcomes** (assessment fail -> fail; assessment inconclusive -> inconclusive; adaptations present and considered); buildAssessment validation; manifest emit/validate round-trip in a temp dir.
   - Acceptance signal: `node --test tests/verification.test.mjs` — all tests pass; plus `node --check scripts/lib/verification.mjs`
   - Validation: `node -e 'import("./scripts/lib/verification.mjs").then(m => { const c = m.parseVerificationContract(require("fs").readFileSync(".agents/plans/2026-08-20-tdad-verification-machinery-csm.md", "utf8")); if (!c.contract || c.contract.riskTier !== "medium" || !Array.isArray(c.contract.requiredEvidence)) process.exit(1); console.log("contract ok") })'` — prints `contract ok` (this plan's own contract parses, nested map included)
   - Acceptance evidence: test run output recorded in the plan journal; the round-trip result
   - Repair attempts: 0
   - Recovery note: if `tests/fixtures/verification/` is partially written, the missing fixture is detectable by failing tests; resume from the fixture step

2. [pending] Add TRIAGE state and three-state semantics to csm-build; extend BUILD_MACHINE
   - Task ID: T003
   - Depends on: none (references the T001 module API as specified in this plan's Design)
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-build/SKILL.md`, `scripts/lib/plan-validation.mjs`; payload mirror via pack-bootstrap (AD-17)
   - Not in scope: contracts.mjs, README, csm-plan/csm-bdd-tdd SKILL.md
   - Spike candidate: none
   - Actions:
     1. In `scripts/lib/plan-validation.mjs`, add `'TRIAGE'` to `BUILD_MACHINE` between RECOVER and VALIDATE (line ~46).
     2. In `csm-build/SKILL.md`, change the Execution State Machine chain to `RECOVER -> TRIAGE -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`; insert `### 2. TRIAGE` (renumber the rest consecutively 3-10).
     3. Write the TRIAGE section per Design item 6 and AD-08/AD-13/AD-16/AD-20: capability-gap detection (exceptional trigger only — the plan's required evidence/tasks need tooling with no executable recipe: no KB entry for the detected ecosystem/language, not detectable in the repo, no suite guidance), the human-gated scoped csm-deep-research dispatch (question "How should this suite equip itself to build and verify <ecosystem> projects?" + goal-slug `<ecosystem-slug>-verification-tooling`; consume only `.agents/research/` findings), the **equip-before-continue** ordering (KB entry written and consumed as inline guidance, then PR draft `.agents/ecosystems/drafts/<date>-<ecosystem-slug>-pr.md` with title/body/changed-files/exact `gh pr create` command, then `learningRequest` recording, then VALIDATE), decline/failure -> unavailable evidence, and the KB entry shape (Design section, incl. Agent-facing guidance). State explicitly: TRIAGE passes straight through at zero added cost when no gap exists.
     4. Update the VERIFY section: per-check statuses `pass|fail|unavailable|not-applicable`, run order per contract `requiredEvidence`, record command + durationMs + selectedTests, baseline-failure attribution via prior-cycle manifest comparison (match key per AD-06), and the **assessment pass** (AD-18): primary agent assesses the built diff against the adapted plan intent — Goal, ACs, Design, task scope — with adaptations agreed during the build read from the plan journal and Control as the baseline; undocumented divergence recorded as a gap; the assessment record feeds `buildAssessment` and the overall derivation (AD-19).
     5. Update CHECKPOINT: emit manifest via the lib (checks + assessment), add `- Last manifest: <path>` Control bullet, derive overall status from checks AND assessment; `inconclusive` -> BLOCKED with exactly one numbered question (accept-with-residual-risk / broaden-verification / repair); `fail` -> REPAIR as today.
     6. Update the Blocker Rules section with the inconclusive decision protocol; update the Completion Gate to require the final manifest, its journal reference, and a `pass` assessment (intent confirmed against the adapted plan) before COMPLETE.
     7. Add "evidence manifest (per-cycle; final referenced in Control)" to the csm-build Interface Produces bullet.
     8. Run `node scripts/pack-bootstrap.mjs` then `node scripts/check-suite.mjs` — the gate must pass.
   - Acceptance signal: `node scripts/check-suite.mjs` passes (machine, interface, payload checks green with the new TRIAGE chain)
   - Validation: `node -e 'import("./scripts/lib/plan-validation.mjs").then(m => console.log(m.BUILD_MACHINE.includes("TRIAGE") ? "enum ok" : "MISSING"))'` prints `enum ok`; review the renumbered headings 1-10; `git status --short` shows only csm-build/SKILL.md, plan-validation.mjs, and payload/skills/csm-build/SKILL.md
   - Acceptance evidence: gate output; the enum probe output
   - Repair attempts: 0
   - Recovery note: partial renumbering is detectable by the gate ("state headings out of chain order"); payload drift by the payload check with the file list; resume by re-reading the machine chain

3. [pending] Grant csm-build the triage-scoped deep-research dispatch edge; update README
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `scripts/lib/contracts.mjs`, `csm-deep-research/SKILL.md`, `README.md`; payload mirror for the deep-research SKILL edit (AD-17)
   - Not in scope: csm-build/csm-plan/csm-bdd-tdd SKILL.md, plan-validation.mjs
   - Spike candidate: none
   - Actions:
     1. In `scripts/lib/contracts.mjs`: add `'csm-deep-research': false` to the csm-build NEVER_INVOKE row; update the matrix comment (:168) "5 other rows carry 8 columns" and the asymmetry note to include csm-build (triage-scoped).
     2. Update `INTERFACES['csm-deep-research'].entryConditions` (add `'dispatch from csm-build (triage step)'`) and `.handoff` (name a dispatching csm-grill, csm-plan, or csm-build (triage step)); update the csm-build INTERFACES `consumes` (add "verification contract (in-plan)").
     3. In `csm-deep-research/SKILL.md`, update the Hands off line to name csm-build (triage-scoped dispatch) alongside csm-grill/csm-plan.
     4. In `README.md`: update the dispatch-edge statement (line ~115) to name csm-build's triage-scoped edge; update the chain prose (line ~123) to include TRIAGE; update the edge-semantics block (line ~48) and the mermaid workflow (:39-45) and skills table (:70-79) so the triage dispatch edge is visible.
     5. Run `node scripts/gen-readme-matrix.mjs --write` (regenerates the composition matrix from INTERFACES) and `node scripts/gen-readme-matrix.mjs --check`; run `node scripts/pack-bootstrap.mjs` then `node scripts/check-suite.mjs`.
   - Acceptance signal: `node scripts/gen-readme-matrix.mjs --check` exits 0; `node scripts/check-suite.mjs` passes (matrix drift + interface + payload checks green)
   - Validation: `node -e 'import("./scripts/lib/contracts.mjs").then(({NEVER_INVOKE}) => { if (NEVER_INVOKE["csm-build"]["csm-deep-research"] !== false) process.exit(1); console.log("edge ok") })'` prints `edge ok`; grep README.md for "triage" in the dispatch statement and diagram
   - Acceptance evidence: matrix check output; gate output
   - Repair attempts: 0
   - Recovery note: a stale README matrix fails the gate with the drift message — re-run `--write`; payload drift with the file list — re-run pack-bootstrap; resume at the regen step

4. [pending] Add Verification Contract guidance to csm-plan
   - Task ID: T005
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-plan/SKILL.md`; payload mirror (AD-17)
   - Not in scope: contracts.mjs, README, other SKILL.md files
   - Spike candidate: none
   - Actions:
     1. In the SKILL body (outside the template fence), add a `## Verification Contract` section: purpose, the fenced YAML example (changeClass, riskTier, nonGoals, invariants, requiredEvidence, escalationTriggers, humanApproval with nested required/requiredWhen), when to include it (material changes), and the parser reference (scripts/lib/verification.mjs).
     2. In the template, leave the `## Design` heading line byte-identical; add one sentence on its own line directly beneath it, without any literal triple-backtick sequences inside the template fence: "When the change is material, include a Verification Contract as a fenced YAML block under this section naming changeClass, riskTier, nonGoals, invariants, requiredEvidence, escalationTriggers, and humanApproval (see the Verification Contract section above)."
     3. Update the build-state chain prose (line ~159) to `RECOVER -> TRIAGE -> VALIDATE -> ...` and the DRAFT state guidance to mention producing the contract for material changes.
     4. Run `node scripts/pack-bootstrap.mjs` then `node scripts/check-suite.mjs`.
   - Acceptance signal: `node scripts/check-suite.mjs` passes (template marker F-050, corpus subsequence, boilerplate, payload checks green)
   - Validation: `node -e 'const s=require("fs").readFileSync("csm-plan/SKILL.md","utf8"); if (!s.includes("## Verification Contract")) process.exit(1); const t=s.split("```markdown")[1].split("```")[0]; if (t.includes("```yaml")) process.exit(2); if (t.includes("## Design When")) process.exit(3); console.log("template fence clean")'` prints `template fence clean` (no nested fence; heading line untouched)
   - Acceptance evidence: gate output; the template-fence probe output
   - Repair attempts: 0
   - Recovery note: a nested fence inside the template or a mutated heading line breaks corpus checks repo-wide — if the gate reports template/corpus failures, the template is the first suspect; resume from the template edit

5. [pending] Add scenario typing to csm-bdd-tdd
   - Task ID: T006
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `csm-bdd-tdd/SKILL.md`; payload mirror (AD-17)
   - Not in scope: other SKILL.md files, contracts.mjs, README
   - Spike candidate: none
   - Actions:
     1. In the SCENARIOS section rules, add the type taxonomy (acceptance / negative-abuse / regression / property-invariant / contract / integration) and require each scenario to carry exactly one `@type=<taxonomy>` Gherkin tag directly above its Scenario keyword.
     2. Add the tag line to the Gherkin scenario template in the SKILL (inside the ```gherkin fence) and note that scenario typing is orthogonal to the one-behavior-per-scenario rule.
     3. Update the build-state chain prose (line ~190) to include TRIAGE.
     4. Run `node scripts/pack-bootstrap.mjs` then `node scripts/check-suite.mjs`.
   - Acceptance signal: `node scripts/check-suite.mjs` passes (machine + interface + payload checks green); the gherkin template fence contains the `@type=` tag line
   - Validation: `node -e 'const s=require("fs").readFileSync("csm-bdd-tdd/SKILL.md","utf8"); const g=s.split("```gherkin")[1].split("```")[0]||""; if (!/@type=/.test(g)) process.exit(1); console.log("typing ok")'` prints `typing ok` (probe targets the template fence, not the prose)
   - Acceptance evidence: gate output; the probe output
   - Repair attempts: 0
   - Recovery note: csm-bdd-tdd is a single-file skill; a malformed edit is caught by the gate's machine/section checks; payload drift by the payload check

6. [pending] Integrate: payload mirror, ledger, Makefile, full suite, baseline
   - Task ID: T007
   - Depends on: T001, T003, T004, T005, T006
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `bootstrap/package/payload/skills/**` (final re-sync), `.agents/README.md`, `Makefile`, `.agents/docs/gate-baselines.json` (re-record)
   - Not in scope: new gated checks, new skill registration, plan-format changes
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs` once more and confirm `node scripts/check-suite.mjs` shows no payload drift.
     2. Add `## ecosystems/` index section to `.agents/README.md` (one line per entry convention; a note line until the first KB entry lands).
     3. Add a `test-verification` Makefile target (`node --test tests/verification.test.mjs`) and include it in the `test` target.
     4. Run the full verification battery: `make lint`; `node scripts/check-suite.mjs`; `node --test tests/verification.test.mjs`; `node --test tests/check-suite.test.mjs tests/token-efficiency.test.mjs tests/cache-health.test.mjs tests/wt-session.test.mjs tests/verification.test.mjs`; `make test`.
     5. Confirm the baseline matches the current count: run `node scripts/record-gate-baseline.mjs --check` (expect OK — the SAVED-time re-record already covers the plan's own checks). If the build phase changed the count (it should not: no gated checks are added), investigate before re-recording with documentation.
     6. Confirm `git status --short` shows only intended files.
   - Acceptance signal: `make test` passes; `node scripts/check-suite.mjs` prints "OK — 9 skills" with no payload drift; `node scripts/record-gate-baseline.mjs --check` OK after the re-record
   - Validation: `node scripts/pack-bootstrap.mjs` re-run idempotency (no drift on second run); `node scripts/gen-readme-matrix.mjs --check` exits 0
   - Acceptance evidence: full battery output + the baseline re-record row recorded in the journal
   - Repair attempts: 0
   - Recovery note: payload drift is reported with the file list — re-run pack-bootstrap; a gate-baseline deviation is fixed only by the documented re-record command

## Verification Strategy

- Fast per-task gates (each task): `node --check` on changed .mjs; the task's probe command; `node scripts/pack-bootstrap.mjs` + `node scripts/check-suite.mjs` (~3s) after each SKILL/contracts edit — never proceed past a red gate.
- The VERIFY assessment pass (AD-18) is primary-agent work, never delegated: it reads the adapted plan intent from the plan journal/Control and compares it against the built diff, recording adaptations and gaps.
- Batch gate (T007): `make lint` (oxlint --deny-warnings); full check-suite; gate-baseline re-record + check; verification unit tests; suite-tooling tests; `make test` (test-hooks, test-bootstrap, test-browse, test-scan).
- Final acceptance evidence: journaled outputs of the battery; `git status --short` review; commit of the verified batch.
- Environment-sensitive: `make test` includes csm-scan (~2min serial) and csm-browse sanity — known slow, not flaky; run once at T007, not per task.
- No external services, no network, no pushes. The only runner execution is the local node:test suite.

## Risks And Recovery

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Template fence corruption (nested backticks or mutated `## Design` line) breaks corpus checks repo-wide | low (guarded by probe) | high | T005 probe forbids nested fences and heading-line mutations; gate catches it; recovery = revert the template edit |
| Gate-baseline deviation on the plan's own commit blocks the SAVED commit | certain | medium | AD-11: re-record at SAVED when the plan is first staged (count ~654, RD-07); T007 only re-checks |
| `--listTests --findRelatedTests` combo misbehaves in the field | medium (only affects consumer repos, not this repo) | low | module falls back to `--listTests` + heuristics; caveat documented in the module header |
| TRIAGE dispatch adds a heavy deep-research run to builds | low (capability-gap trigger only) | medium | human-gated offer (AD-13); exceptional trigger per AD-08; one dispatch per ecosystem per repo; decline path records unavailable evidence |
| TRIAGE scope creep (routine use for non-exceptional gaps) | low (documented trigger) | medium | AD-08 caps the trigger to capability gaps with no executable recipe; AD-20 fixes equip-before-continue; any other use is out of scope — flagged in the TRIAGE section wording |
| Payload mirror forgotten after a SKILL edit | low (each task runs pack) | medium | gate fails with file list; recovery = re-run pack-bootstrap |
| README matrix drift after INTERFACES edits | low (write in T004) | low | `--write` then `--check`; gate enforces |
| csm-build's new state-machine prose drifts from csm-plan/csm-bdd-tdd/README chain prose | low | low | not gate-checked; T003/T005/T006/T004 update all four in the same batch |
| Inconclusive-at-BLOCKED loops stall progress | low | medium | one numbered question, three options; acceptance or broaden both continue; repair cycles back to CHECKPOINT |
| Concurrent pack-bootstrap runs in G1 race on the mirror | low (idempotent, tree-derived) | none | AD-17: packs converge on identical mirrors regardless of order |

Rollback: all changes are additive SKILL.md/tooling edits; revert = git revert of the batch commit. The manifest/KB conventions add no gate surface, so rollback is fully safe.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1: plan lacks `## Acceptance Criteria` H2 (template exact-match subsequence) | blocker | moved ACs out of Goal into a real `## Acceptance Criteria` section | check-suite.mjs:796-797, 285-299, 881-882 |
| F2: draft never renamed + journal claims SAVED | blocker | journal rows now record actual transitions; rename to `-csm.md` happens at SAVED; T001's validation path correct post-rename | csm-plan SAVED state |
| F3: dogfood contract's nested `humanApproval` map unparseable by flat parser | blocker | AD-12 extended: shallow parser supports one-level nested maps with scalar/list leaves; contract block unchanged | AD-12, Design item 1 |
| F4: appending prose to the template `## Design` line breaks corpus | high | guidance sentence on its own line under the heading; heading line byte-identical; probe checks both | AD-03, T005 actions 2 + probe |
| F5: payload mirror deferred to T007 leaves G1 gates red | high | AD-17: each SKILL-editing task runs pack-bootstrap + gate in its own actions/acceptance | check-suite.mjs:511-548; AD-17 |
| F6: "stays 649" breaks when the plan is committed | high | AD-11: expected rise (~+5, RD-07); explicit documented re-record at T007 | check-suite.mjs:57-60; .lefthook.yml:17-24 |
| F7: pytest listed side-effect-free contradicts own record | high | AD-07/Design item 3: pytest enumeration only when import-safe, else heuristic path | docs.pytest.org (retrieved 2026-08-20) |
| F8: scoring + package map under-specified | medium | AD-15 default weights; `buildPackageMap` added to API | AD-15, Design item 3 |
| F9: manifest lifecycle contradicts baseline attribution | medium | AD-05/AD-06: latest-cycle retention, overwrite-at-checkpoint, match key = name+command+sorted selectedTests | AD-05, AD-06 |
| F10: `type:` syntax ambiguous, probe weak | medium | AD-14: Gherkin tag `@type=<taxonomy>` above Scenario; probe targets the ```gherkin template fence | AD-14, T006 probe |
| F11: ecosystem slug not sanitized | medium | AD-16: lowercase alphanumerics + hyphens; `:` -> `-` | AD-16 |
| F12: boilerplate-sync claim wrong | low | Current-State Evidence corrected: TMUX_PARAMS 6 skills, RESILIENCE_PARAMS 5 | boilerplate.mjs:19-44, 59-85 |
| F13: csm-build Produces bullet + README diagram not updated | low | T003 action 7 (Produces gains evidence manifest); T004 action 4 (mermaid + skills table gain triage edge) | T003, T004 |
| F14: risk summary garbled | low | rewritten: 6 standard tasks; T007 primary-verified; no mandatory independent review | How To Execute |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20T21:05Z | 0 | INTAKE | — | approach doc consumed (format: csm-grill/1 OK); 10 grill decisions; Phase 1 scope restated; draft sidecar created | DISCOVER |
| 2026-08-20T21:15Z | 0 | DISCOVER | — | uncertainty scout + 2 research tracks completed (repo mechanics, runner CLI facts, precedent conventions) | RESEARCH |
| 2026-08-20T21:15Z | 0 | RESEARCH | — | all uncertainties resolved from repo inspection + webfetch (retrieved 2026-08-20); no open tracks; no spike candidates | DRAFT |
| 2026-08-20T21:16Z | 0 | DRAFT | — | full plan drafted (6 tasks, G1+G2, dogfood contract block) | CRITIQUE |
| 2026-08-20T21:17Z | 0 | CRITIQUE | — | independent critic returned 14 findings (3 blockers, 4 high, 4 medium, 3 low); all repo line refs verified | REMEDIATE |
| 2026-08-20T21:20Z | 0 | REMEDIATE | — | all 14 findings resolved (see Critique Resolution); plan rewritten; AD-11/T007 corrected so the baseline re-record lands at SAVED (untracked-plan probe showed count 649 until staging) | VERIFY |
| 2026-08-20T21:24Z | 0 | VERIFY | — | primary gate: every AC maps to numbered work; signals/risk/anti-scope present; file names verified against repo; probes syntax-checked; gate run green with the plan at its final path (649, untracked) | SAVED |
| 2026-08-20T21:25Z | 0 | SAVED | — | plan staged, baseline re-recorded for the tracked count, committed | STOP |
| 2026-08-20T21:40Z | 0 | AMEND | — | user amendments applied: (1) manifest assessment in the verification loop — assessment{intentMatch, adaptations, gaps} participates in overall derivation, evaluated against the adapted plan intent (AD-18/AD-19); (2) TRIAGE re-scoped to exceptional capability-equipment only — deep-research how to equip, make available, draft PR, then continue (AD-08/AD-20). Design items 4-7, ACs 1-2, T001/T003 actions, Verification Strategy, Risks, and the plan's own contract block updated; gate re-verified | STOP |

## Completion Review

<filled by csm-build when all criteria are verified>
