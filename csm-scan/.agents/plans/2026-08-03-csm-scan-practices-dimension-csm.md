# csm-scan Development-Practices Dimension CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 15 tasks — 2 high (T002 contracts, T011 activation cutover), 10 standard, 3 low. Task that always requires independent review: T012 (contract-test/fixture reconciliation, per 2026-08-03 precedent).
- The system is fully activated (no inert phase): contract/registry changes land as one atomic unit (T002), and the run.mjs cutover is a single owned task (T011). Shared indexes (contracts, registry, run.mjs, and the shared registration test file) are owned by exactly one task each, and the parallel group G2 must fully drain before G4 (T011's activation requires the renderer T005 to be registered first — rendering a 17-dimension deep without it throws UNKNOWN_DIMENSION).

## Control
- Plan ID: csm-scan-practices-dimension
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-03 — plan authored, critiqued, remediated, and validated at baseline 1010/1010
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Enhance the csm-scan skill (Node.js repo-analysis tool at `/home/jamiemills/.config/opencode/skills/csm-scan/`) so that scanning a repository reports the **development patterns and practices embraced in the repo**, as evidenced by committed static declarations and local read-only git state.

Deliverables:
1. New 17th dimension `DIM-practices-v1` ("Development Practices") with 6 claims and 6 evidence categories: methodology, enforcement, automation, ritual, quality_gate, agent_workflow. New scanner/model under `deep/practices/`, provider adapter in the analysis catalog, renderer, voice/privacy-gated, plugin-compatible. Registered LAST in canonical order (after assurance).
2. Contract migration: `TOTAL_DIMENSION_COUNT` 16→17, `PROVIDER_DIMENSION_COUNT` 14→15, expected claims 83→89.
3. Bounded enrichments to existing dimensions (user-dictated hybrid): git commit-style vocabulary (task-prefix conventions), config strict-type flags (pyright/mypy), testing coverage thresholds (`fail_under`), operations workflow step-level tool scan.
4. Full test-suite reconciliation (contracts, registration, activation, fixtures, final acceptance, provider catalogs, synthetic plugin, determinism, scan-cli), SHA-lock baseline **verification** (no regeneration required — proven during planning), SKILL.md documentation, and a real-repo acceptance probe on perplexity-cli.

Constraints (non-negotiable, from SKILL.md and contracts):
- Zero npm dependencies; Node built-ins only; no installs/builds in scanned repos; read-only scanning; exactly one output write.
- Deterministic output; privacy model (no commit subjects, no identities, no raw excerpts); neutral factual voice (voice gate rejects evaluative terms).
- No new broker command IDs (existing `rg` + git IDs suffice); no changes to `enrich.mjs`, `validate.mjs`, `write.mjs` (all auto-adapt from the registry).
- Practices claims must be phrased as declared-evidence inventory (`observed`/`inferred`), never verdicts on culture or quality ("embraced" = committed declarations present).
- KV-style gate files (e.g. `quality/gates.conf`) are parsed with a key allowlist; raw values are never retained in the model (the privacy gate runs `assertPrivacySafe` over the whole practices model).
- The practices scanner must report a complete search space on empty repos (`not_detected` semantics), like every dimension in the fixture matrix.

Exclusions:
- Forge-external state (branch protection, required status checks, review approvals, merge policy), actual gate pass/fail, CI runtime state, achieved coverage/mutation scores, TDD ordering, commit subjects, `.git/hooks` (never committed), new git command IDs, cross-repo edges for the new dimension, registry/claim version-constant bumps (precedent: no bump for 6-dimension addition), any change to `enrich.mjs`/`validate.mjs`/`write.mjs`, SHA-lock baseline regeneration (verified unnecessary), and practices must NOT be added to `RUNTIME_DIMENSION_IDS` (it is an analysis-catalog dimension).

## Acceptance Criteria
1. `node --test --test-concurrency=1` in the csm-scan repo passes 100% (pass count ≥ baseline 1010 plus the new tests added by T003/T005/T007), with all 17 dimension counts, 89 expected claims, and 15 provider dimensions asserted consistently.
2. `node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/practices-probe.md` (read-only on the target, output to sandbox) renders a "Development Practices" section with observed facts for at least: mutation testing, property-based testing, fuzzing, quality-gate thresholds, baseline/ratchet artifacts, plan-driven workflow, agent configs, coverage thresholds, CI gate steps; the CLI emits `[CSM] deep phase — dispatching 17 scanners` and an `Expected claim coverage: {"expected":89,"eligible":89,"complete":89,...}` JSON line with ratio 1.
3. `CLM-practices-*` claims appear in the registry with globally unique IDs; voice gate, privacy gate, determinism gate, and constraint gates all pass.
4. Existing dimension claims are unchanged except the documented enrichments (git commit-style vocabulary, config strict flags, testing coverage thresholds, operations step scan); no practice fact is claimed by two dimensions — enforced by the T012 fixture assertions (EXPECTED_STATUS rows and explicit no-duplicate-fact checks per the Design boundary table).

## Current-State Evidence
- `lib/scan/contracts/dimension.mjs:32` `TOTAL_DIMENSION_COUNT = 16`; `:33` `PROVIDER_DIMENSION_COUNT = 14`; `:209-211` `validateDimensions` requires exactly `TOTAL_DIMENSION_COUNT` entries, error literal "must contain exactly 16 entries".
- `lib/scan/contracts/evidence.mjs:37-54` `DIMENSION_EVIDENCE_CATEGORIES` drives `DIMENSION_IDS` (`dimension.mjs:26`), `PROVIDER_DIMENSION_IDS` (`:28-30`), and `EVIDENCE_CATEGORIES` (`:56-62`); a new dimension is therefore provider-capable by construction (all except structure/git), and `validateDimension` (`dimension.mjs:192-194`) enforces the flag.
- `lib/scan/registry/dimensions.mjs:74-270` `DIMENSION_SOURCES` (16 entries, `CLM-<dim>-<topic>-v1` claim IDs, rendererId `RND-<short>-v1`); `:319-337` `CROSS_REPO_GLOBAL_STAGE.order = TOTAL_DIMENSION_COUNT` auto-tracks.
- `lib/scan/pipeline/run.mjs:243-278` `scanDimension` switch; `:324-386` `fallbackDimension` (SCANNER_FAILURE models, `FAILURE_SEARCH_SPACE`); `:388+` `safeScanDimension`; `:444` `assertSixteenDimensionsPresent`; `:452-454` `PRIVACY_ENFORCED_DIMENSIONS`; `:619-621` `RUNTIME_DIMENSION_IDS` (must NOT gain practices); `:734-736` `collectProviderEvidence` consumes all analysis-plugin groups; `:848` `analysisProviderResults` call site (the one place the practices model must be passed); `:974` `[CSM] deep phase — dispatching ${deepResults.length} scanners`; `:1039-1047` `Expected claim coverage: ${JSON.stringify(...)}`.
- `lib/scan/render/registry.mjs:115-119` `DIMENSION_RENDERER_ORDER`; `:131-460` `DIMENSION_RENDERER_SOURCES`; `:490-498` `factoryRenderers`; voice gate terms `:80-86`; `:634-636` UNKNOWN_DIMENSION throw on unregistered dimensions (why T005 must land before T011's acceptance can render).
- `lib/scan/providers/analysis-catalog.mjs:51-55` `ANALYSIS_DIMENSION_IDS` (architecture/conventions/documentation) — the catalog the new dimension joins; `lib/scan/providers/builtin/index.mjs` `BUILTIN_DIMENSION_COUNT = 14` (`:159`).
- `test/expansion-dimension-registration.test.mjs:436-454` builtin-index block derives coverage from `PROVIDER_DIMENSION_IDS` while asserting `BUILTIN_DIMENSION_COUNT === 14` — the T002/T006 ownership seam; `:470-474` analysis mirror block gains the practices entry; `:252-269` dimension/renderer counts; `:561` `CROSS_REPO_GLOBAL_STAGE.order`; `:578` renderer+global set; `:148-237,296-335` `CATEGORY_TOPIC_COVERAGE`.
- `test/expansion-final-acceptance.test.mjs:146-155` `SIX_NEW_DIMENSIONS`/`TEN_DIMENSIONS`/`ALL_SIXTEEN = [...TEN, ...SIX]`; `:336,780,847,1292` `deep.length === 16`; `:420` `registryClaims === 83`; `:722-740` `FXLANG_FILES`; `:784` `first.markdown.includes('RUL-accept-practices-v1')`.
- `test/expansion-synthetic-plugin.test.mjs:100-115` `RULE_BLUEPRINTS`; `:163` `mergeCatalogs`; `:313+` per-dimension assertions; `:277-281` fixture artifact per provider dimension.
- `test/expansion-render-registration.test.mjs:186-246` `sixteenDeep()`/`sixteenFindings()`; `:286-292,297-310,341,603` count and slice-index assertions; `:467-484` heading ternary chain.
- Baseline SHA-lock facts (verified during planning): `test/baselines/expansion/supersession.json` records `deep/git.mjs` only in the SUPERSEDED entry `personal-identity-output` whose policy requires at least one legacy lock no longer to apply — the current git.mjs hash already differs from the recorded `bf73675c...`, so a git.mjs change (T007) cannot flip the assertion and **no regeneration is needed**; `capabilities.json` locks `shared/command.mjs` only (git.mjs appears only in the historical `originalLegacyOwnerUniverse`); `test-integrity.json` locks 8 test files the plan does not touch. Consumers: `expansion-baseline.test.mjs:137,155`, `expansion-constraints.test.mjs:132`.
- Baseline suite run (2026-08-03, this planning session): `node --test --test-concurrency=1` → 1010/1010 pass, duration ~70s.
- Prior plans: `.agents/plans/2026-08-02-csm-scan-comprehensive-evidence-expansion-csm.md` (29 tasks, T200-T228: contracts first → inert leaf modules → inert registries → one atomic activation → fixtures → gates → docs) and `.agents/plans/2026-08-03-csm-scan-claim-coverage-caps-csm.md` (5 tasks; fixture/contract updates require independent review).
- Repo state: skills monorepo (`~/.config/opencode/skills/.git`), branch `main`, clean tree; csm-scan repo itself has no package.json/CI/hooks (a sparse negative fixture — see R&D).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| AD1 | Deliver as a new 17th dimension plus bounded enrichments to git/config/testing/operations (hybrid) | User-dictated | User selected "Hybrid" at planning intake | Accepted |
| AD2 | Agent-workflow artifacts (.agents/plans, .agents/docs, AGENTS.md, .claude, .opencode, opencode.jsonc) are first-class practice signals | User-dictated | User selected "Include them" | Accepted |
| AD3 | Output is a neutral declared-practices inventory, never a quality/culture verdict | Architecture-forced | Evidence model + voice gate (`render/registry.mjs:80-86`) reject evaluative prose; SKILL.md guarantees neutral voice | Accepted |
| AD4 | The new dimension is provider-capable and joins the analysis catalog | Architecture-forced | `PROVIDER_DIMENSION_IDS` derives by excluding structure/git; `validateDimension` enforces the flag; analysis catalog is the closest semantic cluster (how code is written/worked) | Accepted |
| AD5 | 6 claims / 6 evidence categories, 1:1 mapping; expected claims 83→89; practices registered LAST in canonical order | Design decision | Simplest set satisfying the delta; `CATEGORY_TOPIC_COVERAGE` set-inclusion tests require every category to map to a claim topic; `ALL_SEVENTEEN = [...TEN, ...SIX, 'practices']` and the determinism test require last position | Accepted |
| AD6 | No changes to enrich.mjs, validate.mjs, write.mjs; no new broker command IDs; no version-constant bumps; NO SHA-lock baseline regeneration (verified unnecessary) | Design decision | All auto-adapt from registry; superseded locks already non-applying; precedent (evidence-expansion) never bumped versions | Accepted |
| AD7 | Boundary: practices owns methodology/enforcement/automation/ritual/quality-gate/agent-workflow fact families; presence-level facts stay with existing dims (Design boundary table, enforced by T012 fixture assertions) | Design decision | Track-B delta analysis of all 16 claim sets; prevents duplicate claims and enrich contradictions | Accepted |
| AD8 | Plan is saved in the csm-scan repo's `.agents/plans/` and committed to the skills monorepo (git root `~/.config/opencode/skills`) | Evidence | 4 prior plans live there and are tracked; monorepo branch `main` clean | Accepted |
| AD9 | Acceptance fixture is perplexity-cli (rich: mutation/property/fuzz/gates/baselines/agent configs); csm-scan itself is a sparse negative case (no package.json, no .git at dir level) | Evidence | Track-C survey of both repos | Accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD1 | Is the current suite green before any change? | `node --test --test-concurrency=1` in csm-scan repo | Read-only run; harness writes only to `fs.mkdtempSync(os.tmpdir())` (`test/harness.mjs:7-17`); `git status --short` unchanged after run | 1010/1010 pass, ~70s; suite self-contains a perplexity-cli pipeline test | T001 records the number; T015 asserts ≥ 1010 + new tests |
| RD2 | Does a 17th dimension break provider-capability validation? | Read-only source analysis of `dimension.mjs:28-30,192-194` and `provider.mjs` | No commands run | `PROVIDER_DIMENSION_IDS` is derived (exclusion list); a new dimension is provider-capable automatically; `providerCapability` flag must be true or validation fails | Practices dimension must be fully provider-wired (adapter, catalog, builtin index) — no non-provider shortcut exists |
| RD3 | Which production/test files hardcode 16/14/83? | Read-only grep across `lib/` and `test/` | No commands run | Full break-point inventory captured in Current-State Evidence and T002/T006/T012 ownership lists | Contract task owns production constants + contracts test; T006 owns the shared registration-file builtin block; T012 owns mechanical count updates |
| RD4 | What practice signals exist in real repos, and what is not feasible? | Read-only survey of csm-scan and perplexity-cli; read-only `git log --oneline -100` / `git branch -a` on perplexity-cli | Read-only git; privacy model excludes raw subjects from output | Confirmed 15+ detectable signals; not feasible: .git/hooks (not committed), forge state, gate pass/fail, commit subjects, achieved coverage | Claim set fixed at 6; enforcement claims are presence-of-declaration, never behaviour |
| RD5 | Do the SHA-lock baselines regenerate automatically or fail hard? | Read-only inspection of `test/baselines/expansion/` + consumers (`expansion-baseline.test.mjs:137,155`, `expansion-constraints.test.mjs:132`) | No commands run | git.mjs appears only in a SUPERSEDED supersession entry whose lock already does not apply (current hash differs); capabilities.json locks command.mjs only; test-integrity.json locks 8 files the plan never touches | NO regeneration needed — T013 is verification-only; never write new hashes |
| RD6 | Is a new renderer auto-covered by the voice/privacy/determinism gates? | Read-only inspection of `expansion-voice-gate.test.mjs` (iterates `DIMENSION_RENDERER_ENTRIES`), determinism test (`renderProseLabel` map), privacy gate | No commands run | Voice/privacy gates auto-iterate registry entries; determinism test needs an explicit `renderProseLabel['practices']` entry | T005 runs the voice gate in its acceptance; T012 adds the determinism heading |
| RD7 | Does T011's acceptance depend on the renderer registration? | Read-only inspection of `render/registry.mjs:634-636` and `expansion-activation.test.mjs` CLI/hash tests | No commands run | Rendering an unregistered dimension throws UNKNOWN_DIMENSION; activation tests render end-to-end | T011 depends on T005; G2 fully drains before G4 |
| RD8 | Can T002's acceptance pass while the builtin index still covers 14 dims? | Read-only inspection of `expansion-dimension-registration.test.mjs:436-454` | No commands run | The builtin block compares BUILTIN coverage against `PROVIDER_DIMENSION_IDS` — it cannot pass until production builtin index and assertions both change | Builtin assertion updates move to T006's ownership; T002's acceptance is the contracts test only |

## Discovered Requirements
- Hidden-path probing: `rg --files` prunes dot-directories; `.github`, `.agents`, `.opencode`, `.quality-gates`, `AGENTS.md` must be probed explicitly via the governance pattern (`deep/governance/scanner.mjs` `hiddenGovernancePaths` idiom). (Evidence: `shared/enum.mjs`; Track-C)
- Voice gate: the renderer's static `label`/`prose` in `render/registry.mjs` must be neutral (e.g. "Development Practices"); words like "mature", "healthy", "embraces", "strong" trigger `VOICE_HIT` at registry build. (Evidence: `render/registry.mjs:80-86`)
- Privacy: commit-style evidence is aggregate-only (counts, labels); raw subjects and identities are rejected by `shared/privacy.mjs`. KV-style gate files are parsed with a key allowlist; raw values are never retained — `assertFindingsPrivacy` (run.mjs:464-493) runs `assertPrivacySafe` over the entire practices model, and a retained `token=...`/`password=...` value would abort the run. (Evidence: SKILL.md Privacy; run.mjs)
- Parser caps: `quality/gates.conf` is KV-format, not TOML/YAML — bounded KV parse required (spike in T003). Parse failures degrade to `unverified` search-space state, never absence or crash (T202 contract).
- Empty-repo semantics: the practices scanner must report a complete (not unsupported/`unverified`) search space on empty repos so the fixture matrix's `not_detected` assertions hold (`expansion-fixtures.test.mjs:415-431`).
- Contract literals: the "exactly 16 entries" error string (`dimension.mjs:210`) and its regex (`expansion-contracts.test.mjs:182`) must change in lockstep.
- Canonical ordering: `DIM-practices-v1` is appended LAST (after `DIM-assurance-v1`) in `DIMENSION_SOURCES` (`registry/dimensions.mjs`) and `DIMENSION_RENDERER_ORDER` (`render/registry.mjs`); `ALL_SEVENTEEN = [...TEN_DIMENSIONS, ...SIX_NEW_DIMENSIONS, 'practices']` (`expansion-final-acceptance.test.mjs:146-155`); determinism asserts canonical heading order.
- `RUNTIME_DIMENSION_IDS` (run.mjs:619-621) must NOT gain practices; plugin observations auto-wire once `DIM-practices-v1` joins `ANALYSIS_DIMENSION_IDS` — only the `analysisProviderResults` call site (run.mjs:848) needs the practices model passed.
- csm-build appends new discoveries each cycle and applies them to all remaining tasks.

## Design
Target behaviour: scanning any repo yields a 17th NORMS.md section "Development Practices" reporting declared practice evidence per claim, plus enriched facts in Git Practices / Configuration / Testing / Operations sections.

Claim set (each claim owns one category, 1:1 with `CATEGORY_TOPIC_COVERAGE`):

| Claim | Category | Factual scope (signals) |
|---|---|---|
| CLM-practices-methodology-v1 | methodology | BDD/Gherkin (.feature files, behave/robot deps), mutation testing ([tool.mutmut], mutmut dep, mutation-named CI jobs), property-based testing (hypothesis dep, strategies.py, property markers), fuzzing (atheris dep, fuzz_corpus dirs, fuzz markers) |
| CLM-practices-enforcement-v1 | enforcement | Commit-convention enforcement (commitlint/gitlint configs), CI gate steps (tool names in workflow steps), hook commands (lefthook/pre-commit command lists) |
| CLM-practices-automation-v1 | automation | Release automation (release-drafter.yml, semantic-release/release-please configs, publish workflows), dependency-update automation (dependabot.yml, renovate.json), docs-build toolchain (mkdocs/sphinx/docusaurus configs), reproducible dev env (devcontainer.json, .devcontainer/, mise/asdf/nix) |
| CLM-practices-rituals-v1 | ritual | PR/issue template contents (required sections), review-bot configs, changelog enforcement (CHANGELOG format + release-drafter coupling) |
| CLM-practices-quality-gates-v1 | quality_gate | Gate declaration files (quality/gates.conf, .quality-gates*), threshold values (bounded KV parse with key allowlist), baseline/ratchet systems (*baseline*.json, ratchet scripts, test/baselines) |
| CLM-practices-agent-workflow-v1 | agent_workflow | Plan-driven workflow (.agents/plans/*-csm.md or plans/, docs/plans with Control/Status headers), design/acceptance records (.agents/docs, quality/remediation), agent configs (AGENTS.md, CLAUDE.md, .claude, .opencode, opencode.jsonc) |

Boundary table (fact family → owning dimension; practices claims never re-assert presence facts):
- Commit-style classification, branch naming, template presence → git (existing claims; T007 only extends the vocabulary)
- Hook-config presence + top-level keys → config (existing); hook commands/contents → practices-enforcement
- Coverage tool/config presence → testing (existing); threshold value (`fail_under`) → testing (T009); gate application in CI steps/hooks → practices-enforcement
- CI job/trigger inventory → operations (existing); step-level tool names → operations (T010) and gate semantics → practices-enforcement
- Lint/format/type tool presence → config (existing); pyright/mypy strict flags → config (T008)
- ADR inventory, CODEOWNERS, CONTRIBUTING, release file presence → governance (existing); plan/agent artifacts → practices-agent-workflow; automation configs → practices-automation
- Maintainability tool presence, duplicates, complexity → maintainability (existing); gate thresholds + baselines/ratchets → practices-quality-gates
- Lockfiles, pins, SBOM/SARIF, dependabot boolean → security/assurance (existing); dependabot/renovate config content → practices-automation

Architecture wiring (new files and touchpoints):
- `deep/practices/scanner.mjs` + `model.mjs`: hidden-path probes, TOML-section probes (`tomlSectionPresent` idiom), bounded KV parse (key allowlist, no raw values), workflow-step regex, `shared/detection.mjs` `PRACTICE_TOOLS` table; model with `summary`/`entries`/`diagnostics`/`searchSpace`, `assertPrivacySafe`, `encodeMatchedKey`; complete search space on empty repos.
- `providers/practices.mjs` adapter (PRV-analysis-practices-v1) + `analysis-catalog.mjs` extension (ANALYSIS_DIMENSION_IDS, PROVIDER_IDS, CATALOG_DEFINITIONS, models map) + `builtin/index.mjs` mirror.
- `render/practices.mjs` + `render/registry.mjs` registration (order last, sources, factory).
- `pipeline/run.mjs`: `scanDimension` case, `fallbackDimension` SCANNER_FAILURE model, `PRIVACY_ENFORCED_DIMENSIONS`, `assertSixteenDimensionsPresent` rename, `analysisProviderResults` call-site wiring (run.mjs:848); NOT `RUNTIME_DIMENSION_IDS`.
- Contracts: `evidence.mjs` category map, `dimension.mjs` counts + literal, `registry/dimensions.mjs` entry (last).
- Plugins: no schema change — dimension becomes plugin-targetable automatically once registered (Track-A confirmation).

## Execution Graph
```
G0  T001 baseline gate
G1  T002 contracts+registry        <- T001
G2  T003 scanner+model     (leaf)  <- T002
    T004 provider+catalog  (leaf)  <- T002
    T005 renderer          (leaf)  <- T002
    T006 builtin index     (leaf)  <- T002
G3  T007 git vocab         (leaf)  <- T002
    T008 config strict     (leaf)  <- T002
    T009 testing thresholds(leaf)  <- T002
    T010 ops step scan     (leaf)  <- T002
G4  T011 activation cutover        <- T003,T004,T005,T006   (G2 fully drains before G4)
G5  T012 suite reconciliation      <- T011,T007,T008,T009,T010   (independent review)
    T013 baseline verification     <- T007                        (verification only)
G6  T014 SKILL.md                  <- T011
    T015 final gate + probe        <- T012,T013,T014
```
Critical path: T001 → T002 → (T003/T004/T005/T006) → T011 → T012 → T015.
Parallel groups: G2 {T003,T004,T005,T006} and G3 {T007,T008,T009,T010} are pairwise disjoint file owners; G2 and G3 may run concurrently (no shared files; T003's `shared/detection.mjs` edit is unique to it). G2 must fully drain before G4. G5 {T012,T013} disjoint. The shared file `test/expansion-dimension-registration.test.mjs` is owned by exactly one task: T002 edits the registry/renderer/CATEGORY_TOPIC_COVERAGE blocks, T006 edits the builtin-index block (lines 436-495); T006's acceptance runs the whole file after both land, so T006 depends on T002.

## Numbered Plan
1. [pending] Baseline gate
   - Task ID: T001
   - Depends on: none
   - Parallel group: G0
   - Risk: low
   - Owned scope: none (verification only)
   - Not in scope: any file changes
   - Spike candidate: none
   - Actions: Run `node --test --test-concurrency=1` in the csm-scan repo; verify 100% pass; record pass count and duration in the progress journal (baseline recorded in planning R&D RD1: 1010/1010).
   - Acceptance signal: `node --test --test-concurrency=1` exits 0 with 1010 passing, 0 failing.
   - Validation: `git status --short` clean afterwards (no working-tree writes).
   - Acceptance evidence: journal entry with pass count, duration, and clean-tree confirmation.
   - Repair attempts: 0
   - Recovery note: If any test fails, the tree is dirty or the node version mismatches the previous baseline; stop and report rather than proceed.

2. [pending] Contracts and registry: 17th dimension
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G1
   - Risk: high (touches the exactly-16 contract; every downstream task conforms to this)
   - Owned scope: `lib/scan/contracts/evidence.mjs`, `lib/scan/contracts/dimension.mjs`, `lib/scan/registry/dimensions.mjs`, `test/expansion-contracts.test.mjs`, `test/expansion-dimension-registration.test.mjs` (registry/renderer/CATEGORY_TOPIC_COVERAGE blocks ONLY — NOT the builtin-index block at lines 436-495, owned by T006)
   - Not in scope: `run.mjs`, providers, renderers, fixtures, other test files (their breakage is expected until T011/T012); the registration test's builtin-index block (T006)
   - Spike candidate: none — the exact edit set is proven by Track-A research (file:line inventory in Current-State Evidence)
   - Actions: (a) Add `DIM-practices-v1` to `DIMENSION_EVIDENCE_CATEGORIES` with categories `['methodology','enforcement','automation','ritual','quality_gate','agent_workflow']`; (b) bump `TOTAL_DIMENSION_COUNT` 16→17 and `PROVIDER_DIMENSION_COUNT` 14→15; change the `validateDimensions` error literal to "exactly 17 entries"; (c) add the `DIMENSION_SOURCES` entry LAST (after assurance): short `practices`, `DIM-practices-v1`, `DEFAULT_APPLICABILITY`, the 6 `CLM-practices-*-v1` claim IDs; (d) update `test/expansion-contracts.test.mjs` (counts, provider-category keys, `slice(0,15)`→`slice(0,16)` negative case with `/exactly 17/`, `computeCoverage` expectations built from `DIMENSION_IDS`); (e) update the registry/renderer blocks of `test/expansion-dimension-registration.test.mjs` (`DIMENSION_DEFINITIONS.length` 17, renderer counts 17, `CROSS_REPO_GLOBAL_STAGE.order` 17, renderer+global set 18, `CATEGORY_TOPIC_COVERAGE` rows for the 6 new categories mapping to the 6 new claims) — leave the builtin-index block untouched.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-contracts.test.mjs` passes 100%.
   - Validation: `node -e "import('./lib/scan/registry/dimensions.mjs').then(m => console.log(m.DIMENSION_REGISTRY.length, m.EXPECTED_CLAIM_IDS.length))"` prints `17 89`; the registration test file passes EXCEPT the builtin-index block (documented expected failure until T006).
   - Acceptance evidence: targeted-run pass output + registry length/claim-count output recorded.
   - Repair attempts: 0
   - Recovery note: If registry validation fails, the dimension.mjs/evidence.mjs/registry edits must land together (they are one atomic change); detect partial application by the failed `validateDimensions` call and re-apply the missing piece.

3. [pending] Practices scanner and model
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/deep/practices/model.mjs`, `lib/scan/deep/practices/scanner.mjs`, `lib/scan/shared/detection.mjs` (add `PRACTICE_TOOLS` detection table only), `test/expansion-practices.test.mjs` (new)
   - Not in scope: `run.mjs` wiring (T011), provider adapter (T004), renderer (T005)
   - Spike candidate: prove the bounded KV parse of `quality/gates.conf`-style files (key allowlist, no raw values) and the workflow-step tool regex against perplexity-cli's committed `quality/gates.conf` + `.github/workflows/mutation-scheduled.yml` in a `/tmp/opencode` sandbox with copied read-only inputs; expected: threshold keys and mutation tool name extracted without TOML/YAML parser failures and without retaining raw values.
   - Actions: (a) `model.mjs`: dimension id, category allowlist (must equal the registry entry), limits mirroring GOVERNANCE_LIMITS, `summary`/`entries`/`diagnostics`/`searchSpace` shapes, `assertPrivacySafe` before freeze, `encodeMatchedKey`; (b) `scanner.mjs`: enumerate → hidden-path probes (`existsSync`/`readdirSync` for `.github`, `.agents`, `.opencode`, `.quality-gates*`, root `AGENTS.md`/`CLAUDE.md`/`opencode.jsonc`), TOML-section probes (`tomlSectionPresent` idiom), bounded reads via `readArtifacts`, detection via `PRACTICE_TOOLS` + `matchDep`, workflow-step regex, KV parser for gate files with key allowlist; complete search space on empty repos (not_detected semantics); return `{ dimension: 'practices', signal, findings: model }`; (c) `detection.mjs`: add the `PRACTICE_TOOLS` table (mutmut, hypothesis, atheris, diff-cover, import-linter, deptry, vulture, actionlint, commitlint, gitlint, semantic-release, release-please, renovate, sphinx, mkdocs, docusaurus, pre-commit, lefthook, bandit, radon); (d) write `test/expansion-practices.test.mjs`: positive fixture exercising all 6 categories (including hidden-dir artifacts) and negative cases asserting `not_detected` only after complete searches.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/expansion-detection.test.mjs` still passes (detection table extension must not disturb existing maps); privacy canary: the model contains no raw KV values (covered by the task's own fixture asserting a `token=...`-style pair is never retained).
   - Acceptance evidence: targeted-run outputs; fixture paths exercised per category; privacy-canary result.
   - Repair attempts: 0
   - Recovery note: partial scanner state is detectable by missing `searchSpace` or missing categories in the model; the model must be deep-frozen and privacy-safe before acceptance.

4. [pending] Provider adapter and analysis-catalog extension
   - Task ID: T004
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/providers/practices.mjs` (new), `lib/scan/providers/analysis-catalog.mjs`, `test/expansion-provider-analysis-catalog.test.mjs`
   - Not in scope: `builtin/index.mjs` (T006), `run.mjs` wiring (T011)
   - Spike candidate: none
   - Actions: (a) `providers/practices.mjs`: adapter mirroring `providers/governance.mjs` — `PRV-analysis-practices-v1` id, `sourceKindFor(category)` map, bounded matched keys, `practicesProviderResult(model)` → `createProviderResult`; (b) `analysis-catalog.mjs`: append `DIM-practices-v1` to `ANALYSIS_DIMENSION_IDS` (last), add `practices: 'PRV-analysis-practices-v1'` to `ANALYSIS_PROVIDER_IDS`, add the `CATALOG_DEFINITIONS` entry with the full category allowlist, wire the practices model into the catalog results map; (c) update `test/expansion-provider-analysis-catalog.test.mjs` for the new dimension (counts and category checks).
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-analysis-catalog.test.mjs` passes 100%.
   - Validation: provider foundation contract test (`test/expansion-provider-foundation.test.mjs`) still passes.
   - Acceptance evidence: targeted-run outputs; catalog definition entry recorded.
   - Repair attempts: 0
   - Recovery note: a missing `CATALOG_DEFINITIONS` entry surfaces as a typed unknown-dimension/category error in the catalog test; re-apply the entry and re-run.

5. [pending] Practices renderer and render-registry registration
   - Task ID: T005
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/render/practices.mjs` (new), `lib/scan/render/registry.mjs`, `test/expansion-render-registration.test.mjs`
   - Not in scope: `run.mjs`, fixtures
   - Spike candidate: none — voice-gate vocabulary is fixed (`render/registry.mjs:80-86`); draft prose against it in the task before registration
   - Actions: (a) `render/practices.mjs`: `renderPractices(_repoName, model, context)` neutral Markdown section + `createPracticesRenderer({ context })` factory (governance template); (b) `render/registry.mjs`: import, add `'practices'` LAST to `DIMENSION_RENDERER_ORDER` (canonical order must equal registry order), add the `DIMENSION_RENDERER_SOURCES` entry (label "Development Practices", rendererId `RND-practices-v1`, neutral prose), add `practices: createPracticesRenderer({ context })` to `factoryRenderers`; (c) update `test/expansion-render-registration.test.mjs`: `DIMENSION_RENDERER_COUNT` 17, `RENDERER_SNAPSHOT_COUNT` 18, all slice-index shifts (`slice(0,16)`→`slice(0,17)` at 292/297/300/305/310/341, `RENDERER_SNAPSHOT[16]`→`[17]` global position at 317/603), heading ternary case for the practices heading (467-484), AND add a minimal practices entry to `sixteenDeep()` (186-246) so the injected-rendering heading assertion passes.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-render-registration.test.mjs test/expansion-voice-gate.test.mjs` passes 100% (voice gate auto-iterates the new renderer entry).
   - Validation: manual render of the new section prose against the neutral-voice terms list.
   - Acceptance evidence: targeted-run outputs; label/prose text recorded.
   - Repair attempts: 0
   - Recovery note: `verifyRenderRegistry` fails typed on missing/duplicate/unknown entries — the four registration edits must land together; the `sixteenDeep()` entry and slice shifts must land with them or the injected-rendering tests fail.

6. [pending] Builtin provider index mirror and registration-test builtin block
   - Task ID: T006
   - Depends on: T002
   - Parallel group: G2
   - Risk: low
   - Owned scope: `lib/scan/providers/builtin/index.mjs`, the builtin-index block of `test/expansion-dimension-registration.test.mjs` (lines 436-495)
   - Not in scope: the registry/renderer/CATEGORY_TOPIC_COVERAGE blocks of the registration test (T002)
   - Spike candidate: none
   - Actions: (a) production: add the practices mirror to `BUILTIN_DEFINITIONS` and bump `BUILTIN_DIMENSION_COUNT` 14→15; (b) tests: update the builtin block — `BUILTIN_DIMENSION_COUNT` 15, test title "all 14 provider dimensions" → 15, and the analysis mirror block (470-474) gains `[ANALYSIS_PROVIDER_IDS.practices, ANALYSIS_DIMENSION_IDS[3]]`; the coverage comparison (438-439) auto-adapts once production and `PROVIDER_DIMENSION_IDS` both hold 15.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-dimension-registration.test.mjs` passes 100% (the whole file — T002's blocks plus this task's builtin block — green together).
   - Validation: `node -e "import('./lib/scan/providers/builtin/index.mjs').then(m => console.log(m.BUILTIN_DIMENSION_COUNT))"` prints `15`.
   - Acceptance evidence: targeted-run output + printed count.
   - Repair attempts: 0
   - Recovery note: missing mirror surfaces as a mismatch between `BUILTIN_DIMENSION_COUNT` and the registry or as the coverage-comparison failure at 438-439; re-apply the definition and re-run.

7. [pending] Git commit-style vocabulary extension
   - Task ID: T007
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/git.mjs` (commit-style classifier only), `test/git-commit-vocab.test.mjs` (new focused unit test)
   - Not in scope: any other git.mjs behaviour, branch/template logic, fixture assertions (T012 reconciles), SHA-lock files (T013 verifies — no regeneration needed)
   - Spike candidate: validate the extended classifier against perplexity-cli's real log (read-only `git log --oneline -100`) in a `/tmp/opencode` sandbox copy; expected: task-prefix patterns (`T\d{3}:`, `P\d+C?:`, `CSM`, `REPAIR`) classified into an aggregate label without raw-subject output.
   - Actions: Extend `analyzeCommitStyle` vocabulary with task-identifier and plan prefixes (aggregate classification only, privacy-safe labels); add `test/git-commit-vocab.test.mjs` covering conventional, task-prefixed, hybrid, and plain styles.
   - Acceptance signal: `node --test --test-concurrency=1 test/git-commit-vocab.test.mjs` passes 100%.
   - Validation: existing `test/regression-parity.test.mjs` still passes (legacy classifier behaviour unchanged for old vocab).
   - Acceptance evidence: targeted-run outputs; classifier label mapping recorded.
   - Repair attempts: 0
   - Recovery note: the supersession lock for `deep/git.mjs` is SUPERSEDED and already non-applying (current hash differs from the recorded lock), so no lock test can fail from this change — verified in T013.

8. [pending] Configuration strict-type-flag facts
   - Task ID: T008
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/config.mjs` (tool facts only), `test/config.test.mjs`
   - Not in scope: tsconfig strict (already covered), fixture expectations (T012), SHA-lock files (T013)
   - Spike candidate: none
   - Actions: Extend the config scanner's tool facts to read pyright `typeCheckingMode` and mypy `strict` flags from `pyproject.toml` sections / config files (bounded TOML-section reads); update `test/config.test.mjs` with positive and negative cases.
   - Acceptance signal: `node --test --test-concurrency=1 test/config.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/regression-parity.test.mjs` still passes; verify the ten-dimension fixture output is unchanged (the legacy fixtures contain no `[tool.mypy]`/`[tool.pyright]` sections, so `fixture-behavior.json` must stay byte-identical — if it changes, stop and report; T012 owns any required regen with review).
   - Acceptance evidence: targeted-run outputs; sample fact recorded; fixture-behavior unchanged confirmation.
   - Repair attempts: 0
   - Recovery note: facts must extend, never replace, existing config claims; detect regression by parity-matrix or fixture-hash failures.

9. [pending] Testing coverage-threshold facts
   - Task ID: T009
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/testing.mjs` (coverage facts only), `test/testing.test.mjs`
   - Not in scope: coverage tool presence (existing), gate-application semantics (practices-enforcement claim), fixture expectations (T012), SHA-lock files (T013)
   - Spike candidate: none
   - Actions: Extend the testing scanner's coverage facts to parse `fail_under` from `[tool.coverage.report]` and diff-cover threshold declarations (bounded reads); update `test/testing.test.mjs` with positive/negative cases.
   - Acceptance signal: `node --test --test-concurrency=1 test/testing.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/regression-parity.test.mjs` still passes; legacy fixtures contain no coverage sections, so `fixture-behavior.json` must stay byte-identical (same stop-and-report rule as T008).
   - Acceptance evidence: targeted-run outputs; threshold fact recorded.
   - Repair attempts: 0
   - Recovery note: parse failures must degrade to `unverified` search-space state, never absence or crash (T202 contract).

10. [pending] Operations workflow step-level tool scan
    - Task ID: T010
    - Depends on: T002
    - Parallel group: G3
    - Risk: standard
    - Owned scope: `lib/scan/deep/operations.mjs` (workflow analysis only), `test/operations.test.mjs`
    - Not in scope: job/trigger inventory (existing), gate semantics (practices-enforcement), fixture expectations (T012), SHA-lock files (T013)
    - Spike candidate: none
    - Actions: Extend the CI workflow analysis to scan workflow steps for practice-tool names (coverage, mutation, semgrep, gitleaks, pyright, mypy, diff-cover, actionlint, scorecard) via bounded regex over step content; update `test/operations.test.mjs` with positive/negative cases.
    - Acceptance signal: `node --test --test-concurrency=1 test/operations.test.mjs` passes 100%.
    - Validation: `node --test --test-concurrency=1 test/regression-parity.test.mjs` still passes.
    - Acceptance evidence: targeted-run outputs; step-tool fact recorded.
    - Repair attempts: 0
    - Recovery note: bounded regex with explicit caps; oversized/block-scalar workflows must degrade to `unverified`, never crash.

11. [pending] Activation cutover in the pipeline
    - Task ID: T011
    - Depends on: T003, T004, T005, T006 (G2 fully drains first — rendering without the T005 registration throws UNKNOWN_DIMENSION at `render/registry.mjs:634-636`)
    - Parallel group: G4
    - Risk: high (single-owner shared index; everything downstream conforms)
    - Owned scope: `lib/scan/pipeline/run.mjs`, `test/expansion-activation.test.mjs`
    - Not in scope: other test files (T012), SKILL.md (T014); do NOT add practices to `RUNTIME_DIMENSION_IDS` (run.mjs:619-621) — it is an analysis-catalog dimension
    - Spike candidate: verify the activation ordering against `collectGlobalSnapshot`/`mergeProviderEvidence` so the new dimension's model flows through enrichment and validation unchanged — read-only tracing before editing.
    - Actions: (a) add `case 'practices': return scanPractices(repoPath, overview);` to `scanDimension`; (b) add the `fallbackDimension` case returning a `buildPracticesModel` SCANNER_FAILURE model (FAILURE_SEARCH_SPACE); (c) append `'practices'` to `PRIVACY_ENFORCED_DIMENSIONS`; (d) rename `assertSixteenDimensionsPresent` to `assertAllDimensionsPresent` (iterate `DIMENSION_REGISTRY` — auto-adapts); (e) pass the practices model into the `analysisProviderResults` call site (run.mjs:848) — plugin observations need no extra wiring (they flow via `ANALYSIS_DIMENSION_IDS` from T004, consumed at run.mjs:734-736); (f) update `test/expansion-activation.test.mjs` (`deep.length` 17, `registryClaims`/`coverage.expected` 89).
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-activation.test.mjs` passes 100%.
    - Validation: `node --test --test-concurrency=1 test/expansion-constraints.test.mjs test/expansion-privacy-gate.test.mjs` still pass (one-write, zero-dep, read-only, privacy canaries).
    - Acceptance evidence: targeted-run outputs; activated dimension count recorded.
    - Repair attempts: 0
    - Recovery note: a crash in the new scanner must degrade to the SCANNER_FAILURE model (claims `unverified`), never abort — verify by temporarily injecting a failure in the sandbox if needed; the cutover edits land as one atomic change.

12. [pending] Suite reconciliation: fixtures, counts, plugin blueprints, headings (requires independent review)
    - Task ID: T012
    - Depends on: T011, T007, T008, T009, T010
    - Parallel group: G5
    - Risk: standard (independent review required per precedent)
    - Owned scope: `test/fixtures-expansion/` (new practices fixture), `test/expansion-fixtures.test.mjs`, `test/expansion-final-acceptance.test.mjs`, `test/expansion-synthetic-plugin.test.mjs`, `test/expansion-provider-assurance-catalog.test.mjs`, `test/expansion-determinism.test.mjs`, `test/scan-cli.test.mjs`
    - Not in scope: SHA-lock baseline files (T013 — verification only), production code
    - Spike candidate: none — count targets are enumerated in Track-D research and the Current-State Evidence inventory
    - Actions: (a) add a practices fixture exercising all 6 categories including hidden-dir artifacts (positive) and an empty repo (negative, asserting complete-search-space `not_detected`); (b) update `expansion-fixtures.test.mjs` (`deep.length` 17, `EXPECTED_STATUS` rows for practices with observed + not_detected cases, coverage expectations) and add boundary assertions that practices claims do NOT re-assert presence facts owned by git/config/testing/governance (per the Design boundary table); (c) update `expansion-final-acceptance.test.mjs`: `registryClaims` 89, `deep.length` 17 at all four sites (336/780/847/1292), `ALL_SIXTEEN`→`ALL_SEVENTEEN = [...TEN_DIMENSIONS, ...SIX_NEW_DIMENSIONS, 'practices']` (146-155, 339/431/433), provider counts 15 (753-755), a practices plugin blueprint in `PLUGIN_BLUEPRINTS` with a matching artifact in `FXLANG_FILES` (722-740) so `first.markdown.includes('RUL-accept-practices-v1')` (784) passes, heading assertions; (d) update `expansion-synthetic-plugin.test.mjs`: add the 15th `RULE_BLUEPRINTS` entry for `DIM-practices-v1` (allowlisted category + selector, 100-115), a matching artifact in `FIXTURELANG_FILES` (277-281), pass `practices: byDim.practices` into `analysisProviderResults` inside `mergeCatalogs` (163, 186-191), and 16→17/14→15 count updates (391, 225-372); (e) update `expansion-provider-assurance-catalog.test.mjs` ("all 15 provider dimensions exactly once", 246/261); (f) update `expansion-determinism.test.mjs` `renderProseLabel` map with the practices heading (239-256); (g) extend `scan-cli.test.mjs` label coverage for the practices dimension.
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs test/expansion-final-acceptance.test.mjs test/expansion-synthetic-plugin.test.mjs test/expansion-provider-assurance-catalog.test.mjs test/expansion-determinism.test.mjs test/scan-cli.test.mjs` passes 100%.
    - Validation: determinism gate byte-identical on two consecutive fixture runs (covered by `expansion-determinism.test.mjs`).
    - Acceptance evidence: targeted-run outputs; per-file count deltas recorded; independent-review sign-off noted in the journal.
    - Repair attempts: 0
    - Recovery note: fixtures failing only after this task means a production change (T003-T011) and a fixture expectation drifted apart; reconcile the fixture, not the production claim.

13. [pending] Baseline SHA-lock verification (verification only — NO regeneration)
    - Task ID: T013
    - Depends on: T007
    - Parallel group: G5
    - Risk: low (no file writes; verifies the planning-phase finding that no lock applies to this plan's changes)
    - Owned scope: none (read-only verification of `test/baselines/expansion/capabilities.json`, `supersession.json`, `test-integrity.json`)
    - Not in scope: any file modification; do NOT write new hashes — the supersession policy ("requires at least one legacy lock no longer to apply") would break if a still-applying hash were written into the SUPERSEDED `personal-identity-output` entry
    - Spike candidate: none — the mechanism was proven during planning (RD5): git.mjs appears only in the SUPERSEDED `personal-identity-output` entry whose lock already does not apply (current hash ≠ recorded `bf73675c...`); `capabilities.json` locks `shared/command.mjs` only; `test-integrity.json` locks 8 files this plan never touches
    - Actions: (a) confirm `git status` shows no changes to the three baseline files; (b) run `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs` and confirm they pass unchanged; (c) record in the journal the hash-diff evidence for git.mjs and the policy reasoning (superseded entry requires non-application, which T007's change preserves).
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs` passes 100% with zero baseline-file modifications.
    - Validation: `git diff --stat test/baselines/expansion/` is empty.
    - Acceptance evidence: journal entry with the git.mjs hash before/after T007 and the policy reasoning; empty-diff confirmation.
    - Repair attempts: 0
    - Recovery note: if a lock test DOES fail, a production file outside the plan's scope was changed — stop and identify it; never regenerate or disable a lock to pass.

14. [pending] SKILL.md documentation update
    - Task ID: T014
    - Depends on: T011
    - Parallel group: G6
    - Risk: low
    - Owned scope: `SKILL.md`
    - Not in scope: any code or test file
    - Spike candidate: none
    - Actions: Update the dimension table (16→17, add Development Practices as the 17th row with its 6 claim topics), the pipeline description ("16-dimension registry" → 17), the provider section (14→15 provider dimensions), the plugin section (dimension count references), the test-suite section if counts appear.
    - Acceptance signal: `rg -n '16-dimension|14 provider|exactly 16' SKILL.md` returns nothing; `rg -n 'DIM-practices-v1|Development Practices|17' SKILL.md` returns the expected new rows.
    - Validation: the dimension table row for practices matches the registry claim IDs; no dangling "16-dimension" phrasing remains.
    - Acceptance evidence: rg outputs and the SKILL.md diff recorded.
    - Repair attempts: 0
    - Recovery note: doc-only task; partial application detectable by leftover "16-dimension" phrasing.

15. [pending] Final gate and real-repo probe
    - Task ID: T015
    - Depends on: T012, T013, T014
    - Parallel group: G6
    - Risk: standard
    - Owned scope: none (verification only)
    - Not in scope: any file changes
    - Spike candidate: none
    - Actions: (a) full suite `node --test --test-concurrency=1` — 100% pass, pass count ≥ 1010 plus the new tests added by T003 (expansion-practices.test.mjs), T005 (render-registration additions), and T007 (git-commit-vocab.test.mjs); record the exact count; (b) real-repo probe from a neutral workdir: `node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/practices-probe.md` (read-only on the target; output to sandbox); verify the NORMS.md contains a "Development Practices" section with observed facts for at least: mutation testing, property-based testing, fuzzing, quality-gate thresholds, baseline/ratchet artifacts, plan-driven workflow, agent configs, coverage thresholds, CI gate steps; (c) verify the CLI emits the exact strings `[CSM] deep phase — dispatching 17 scanners` and `Expected claim coverage: {"expected":89,"eligible":89,"complete":89,...}` (JSON line, ratio 1) — match the actual reporter output formats (`run.mjs:974`, `run.mjs:1039-1047`); (d) verify the new section is neutral-voiced and contains no raw subjects, identities, secrets, or raw KV values.
    - Acceptance signal: full suite exits 0 with 0 failures AND pass count ≥ 1010 + new tests, AND the probe output satisfies AC2 (practices section populated with the listed facts, "dispatching 17 scanners", 89/89 coverage JSON line).
    - Validation: `git status --short` in the skills monorepo shows only the plan file and intended commits.
    - Acceptance evidence: full-suite summary with exact count, probe NORMS.md path, facts checklist, coverage line, neutral-voice/privacy check.
    - Repair attempts: 0
    - Recovery note: any failing test or missing probe fact loops back to the owning task (T002-T014); record the exact failing test in the journal before returning to SELECT.

## Verification Strategy
Ordered cheapest-first:
- Per-task gates: each task's targeted `node --test --test-concurrency=1 test/<owned>.test.mjs` runs (fast, ~seconds to a minute). Fast per-task gates: T002 (contracts test), T003 (practices + detection), T004 (analysis catalog + provider foundation), T005 (render registration + voice gate), T006 (registration test whole file), T007 (git vocab + parity), T008-T010 (config/testing/operations + parity + fixture-behavior byte-identity).
- Expensive batch gates: T012's six-file reconciliation run and T013's baseline/lock verification; the full suite (T001, T015) at ~70s — the authoritative gate.
- Final gates: full suite (determinism, privacy, constraints, voice all included) plus the real-repo probe at T015.
- Parallelism: G2 and G3 run concurrently; per-task gates within a group may run in parallel (disjoint files); the full suite must run with `--test-concurrency=1` (authoritative, per SKILL.md) and serially with respect to other commands.
- Known environment sensitivity: none identified; suite runtime ~70s baseline. Note: `golden.test.mjs` uses content regexes and a test-count range, not a hash baseline — nothing to regenerate there; the real-repo probe targets perplexity-cli read-only.

## Risks And Recovery
| Risk | Mitigation | Recovery |
|---|---|---|
| R1 Contract/registry blast radius (exactly-16 contract, 10+ test gates) | T002 lands as one atomic task; strict G1→G2/G3→G4 sequencing (G2 drains before G4); per-task targeted gates; break-point inventory pre-enumerated | Revert T002's three production edits together; re-run contracts test |
| R2 SHA-lock interference | Planning-phase proof (RD5) that no lock applies to this plan's files; T013 is verification-only and never writes hashes | A lock failure means an out-of-scope change — stop and identify it; never regenerate/disable locks |
| R3 Voice-gate rejection of practices prose | Prose drafted against the fixed voice-term list before registration; voice gate in T005 acceptance | Reword label/prose; re-run voice-gate + render-registration tests |
| R4 Hidden-path silent `not_detected` (.github, .agents, .opencode, AGENTS.md) | Explicit probes per governance pattern in T003; positive fixture in T012 covers hidden dirs | Add missing probe; add fixture case; re-run practices + fixtures tests |
| R5 Overclaiming enforcement/behaviour from presence | Claims are declared-evidence inventory; `inferred` only where deterministic derivation exists; neutral phrasing | Adjust claim facts/limitations; re-run practices tests |
| R6 Provider wiring gap (new dimension never receives plugin/generic evidence) | T004 catalog + T011 `analysisProviderResults` call-site wiring; cross-checks via catalog + activation tests; T012 plugin-blueprint assertions | Verify the practices model reaches `analysisProviderResults`; add plugin observation case |
| R7 Duplicate facts across dimensions → enrich contradictions | Design boundary table (AD7) with T012 no-duplicate-fact fixture assertions | Move the conflicting fact to its owning dimension; re-run fixtures + acceptance |
| R8 Full-suite drift after mechanical count updates | T012 targeted six-file run before full suite; T015 final gate | Fix the specific failing assertion; re-run targeted file then full suite |
| R9 Interrupted task state | Per-task recovery notes; journal checkpoints; registry/contracts tasks detect partial application via validation failures | Resume at RECOVER with journal; re-run the interrupted task's acceptance signal |
| R10 T011/T012 acceptances blocked by renderer not yet registered | T005 is a declared dependency of T011; G2 drains before G4 | If UNKNOWN_DIMENSION appears, T005 has not landed — complete G2 before G4 |

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1: T002/T006 share `expansion-dimension-registration.test.mjs`; both stated acceptances unsatisfiable | Blocker | Builtin-index block (436-495) ownership moved to T006; T002's acceptance is the contracts test only; T006's acceptance runs the whole registration file after both land (T006 depends on T002); graph and ownership notes updated | `expansion-dimension-registration.test.mjs:436-454` coverage comparison vs `PROVIDER_DIMENSION_IDS` |
| F2: T011/T012 omit the T005 renderer dependency; acceptance would throw UNKNOWN_DIMENSION | Major | T005 added to T011's dependencies; G2 must fully drain before G4; critical path and graph updated; R10 added | `render/registry.mjs:634-636`; activation tests render end-to-end |
| F3: T013's regeneration premise false; writing hashes would break the supersession policy | Major | T013 rewritten as verification-only (no writes); AD6, R2, T007 recovery note updated; RD5 records the proof | `supersession.json` SUPERSEDED entry `personal-identity-output`; `capabilities.json` broker-only; `test-integrity.json` 8 untouched files |
| F4: T012 synthetic-plugin scope under-specified (blueprint, artifact, mergeCatalogs) | Major | T012 action (d) now enumerates the 15th `RULE_BLUEPRINTS` entry, `FIXTURELANG_FILES` artifact, `mergeCatalogs` wiring, and final-acceptance `FXLANG_FILES`/`RUL-accept-practices-v1` | `expansion-synthetic-plugin.test.mjs:100-115,163,277-281,313+`; `expansion-final-acceptance.test.mjs:722-740,784` |
| F5: T005 render-registration edits incomplete (sixteenDeep + slice indexes) | Major | T005 action (c) now includes the `sixteenDeep()` practices entry and every slice-index shift (292-341, 603) | `expansion-render-registration.test.mjs:186-246,467-484` |
| F6: AC2/T015 strings don't match CLI output | Minor | AC2 and T015 now assert the exact reporter formats: `[CSM] deep phase — dispatching 17 scanners` and the `Expected claim coverage: {"expected":89,...}` JSON line; concrete test-count floor stated | `run.mjs:974,1039-1047` |
| F7: practices canonical position unspecified | Minor | Position fixed as LAST (after assurance) in `DIMENSION_SOURCES` and `DIMENSION_RENDERER_ORDER`; `ALL_SEVENTEEN` composition stated in T002/T005/T012 and Discovered Requirements | `expansion-final-acceptance.test.mjs:146-155`; determinism canonical-order test |
| F8: ten-dimension fixture-behavior.json lock has no owner guard | Minor | T008/T009 validations require byte-identical fixture output with a stop-and-report rule; T012 named as fallback owner | `test-integrity.json`; legacy fixtures lack the new sections |
| F9: golden test has no hash baseline to regenerate | Minor | Verification Strategy corrected — `golden.test.mjs` uses content regexes + count range; regen note removed | `golden.test.mjs:185-229` |
| F10: "analysisPluginObservations grouper" wiring is a no-op | Observation | T011 action (e) rephrased: only the `analysisProviderResults` call site (run.mjs:848) needs the practices model; plugin observations auto-flow via `ANALYSIS_DIMENSION_IDS` | `run.mjs:734-736,848` |
| F11: RUNTIME_DIMENSION_IDS exclusion | Observation | Noted as an explicit do-not-touch in T011 scope and Exclusions | `run.mjs:619-621` |
| F12: T014 acceptance not runnable | Minor | Replaced with concrete `rg` acceptances (no dangling "16-dimension"/"14 provider"/"exactly 16" refs; expected new rows present) | SKILL.md dimension table |
| F13: KV model exposed to `assertFindingsPrivacy` | Minor | T003 requires key-allowlist parsing, no raw value retention; privacy-canary fixture case added to T003 validation; Discovered Requirements updated | `run.mjs:464-493`; `shared/privacy.mjs` |
| F14: complete-search-space semantics on empty repos | Minor | T003 and the T012 negative fixture require complete search space for `not_detected`; Discovered Requirements updated | `expansion-fixtures.test.mjs:415-431` |
| F15: boundary table "enforced by tests" not named | Observation | AC4 and T012 action (b) now name the boundary assertions: no-duplicate-fact checks in the practices fixture rows | Design boundary table |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | INTAKE | — | Ask classified: large, open. User decisions AD1 (hybrid) and AD2 (agent artifacts included) recorded | DISCOVER |
| 2026-08-03 | 0 | DISCOVER | — | Repo state, plan location, 16-dimension contract, wiring points inspected (file:line evidence) | RESEARCH |
| 2026-08-03 | 0 | RESEARCH | — | 5 parallel tracks: uncertainty scout, wiring anatomy, coverage delta, signal inventory, test impact; baseline suite run 1010/1010 (RD1) | DRAFT |
| 2026-08-03 | 0 | DRAFT | — | 15 tasks (T001-T015), 7 groups, 6 cycles; hybrid design with boundary table | CRITIQUE |
| 2026-08-03 | 0 | CRITIQUE | — | Independent hostile review: 15 findings (2 blockers, 6 major, 6 minor, 2 observations), all with file:line evidence | REMEDIATE |
| 2026-08-03 | 0 | REMEDIATE | — | All 15 findings resolved (F1 ownership seam, F2 dependency, F3 verification-only T013, F4/F5 enumerated edits, F6-F15 corrections); graph/risks/journal updated | VERIFY |
| 2026-08-03 | 0 | VERIFY | — | Primary-agent verification of every acceptance criterion mapping and dependency (pending) | SAVED |
| 2026-08-03 | 0 | SAVED | — | Plan committed to skills monorepo; implementation NOT started | STOP |

## Completion Review
<filled by csm-build when all criteria are verified>
