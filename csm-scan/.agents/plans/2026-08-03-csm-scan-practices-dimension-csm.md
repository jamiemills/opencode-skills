# csm-scan Development-Practices Dimension CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 17 tasks — 2 high (T002 contracts, T011 activation cutover), 11 standard, 4 low. Task that always requires independent review: T012 (contract-test/fixture reconciliation, per 2026-08-03 precedent).
- The system is fully activated (no inert phase): contract/registry changes land as one atomic unit (T002), and the run.mjs cutover is a single owned task (T011). Shared indexes (contracts, registry, run.mjs, `analysis-catalog.mjs`, `builtin/index.mjs`, and the shared registration test file) are owned by exactly one task each, and the parallel group G2 must fully drain before G4 (T011's activation requires the renderer T005 to be registered first — rendering a 17-dimension deep without it throws UNKNOWN_DIMENSION).
- Ten-dimension output freeze: `architecture`, `conventions`, `config`, `testing`, `operations`, and `git` are legacy-ten scanners whose findings feed the SHA-hashed `fixture-behavior.json`. NO task may change their `scan()` findings or renderer output. Craft facts for architecture are derived in the provider layer (adapter observations, expanded pipeline only); style-guide facts live in the new practices dimension (expanded-only); maintainability is expanded-only. Conventions findings stay byte-identical.

## Control
- Plan ID: csm-scan-practices-dimension
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-03 — T001 baseline gate verified: `node --test --test-concurrency=1` → 1010/1010 pass (~73s), working tree clean apart from unrelated untracked `README.md` at skills root (preserved, not staged)
- Next transition: SELECT -> T002 (contracts + registry)
- Active tasks: T002
- Blockers: none

## Goal
Enhance the csm-scan skill (Node.js repo-analysis tool at `/home/jamiemills/.config/opencode/skills/csm-scan/`) so that scanning a repository reports the **development patterns and practices embraced in the repo**, as evidenced by committed static declarations, lexical measurement, and local read-only git state. The resulting NORMS.md is an **agent-adoption brief**: a follow-on agent can read it and adopt the style already used in the repo (craft measurements, style-guide values, language idioms, workflow practices).

Deliverables:
1. New 17th dimension `DIM-practices-v1` ("Development Practices") with 7 claims and 7 evidence categories: methodology, enforcement, automation, ritual, quality_gate, agent_workflow, style_guide. New scanner/model under `deep/practices/`, provider adapter in the analysis catalog, renderer, voice/privacy-gated, plugin-compatible. Registered LAST in canonical order (after assurance).
2. Contract migration: `TOTAL_DIMENSION_COUNT` 16→17, `PROVIDER_DIMENSION_COUNT` 14→15, expected claims 83→93.
3. Craft/style assessment layer (3 new claims + 1 enrichment; NO ten-dimension scanner output changes):
   - `CLM-practices-style-guide-v1` (practices dimension, category `style_guide`): style-guide values and language idioms — line-length/indent/quote config values (ruff, black, prettier, rustfmt, gofmt), naming-pattern details, zen/principle documents (PEP 20, Go proverbs, Rust API guidelines, JS styleguide deps), standards-conformance facts (PEP 8 and per-language equivalents).
   - `CLM-maintainability-dead-code-v1` (maintainability, category `dead_code`): dead-code signals — vulture configs/whitelists, `noUnusedLocals`/`no-unused-vars` rules, `#[allow(dead_code)]` counts, unused-import lexical markers.
   - `CLM-architecture-coupling-v1` (architecture, category `coupling`): coupling aggregates derived in the PROVIDER LAYER from the existing import graph (adapter observations, expanded pipeline only) — max/top fan-in and fan-out, files above fan-in threshold, cyclic-group sizes, layer-boundary edge counts. Architecture `scan()` findings stay byte-identical.
   - `CLM-architecture-solid-indicators-v1` (architecture, category `design_pattern`): SOLID/pattern indicators derived in the provider layer — interface-typed reference counts, abstract/interface usage, dependency-direction indicators between layers, port/contract/adapter dir markers, pattern-suffix naming counts.
   - Plus an enrichment: per-function cyclomatic-complexity counts and distributions folded into the existing `CLM-maintainability-branch-complexity-v1` facts (extending the maintainability tokenizer's branch-point measurement; maintainability is expanded-only, so legacy hashes are untouched).
4. Bounded enrichments to existing dimensions (user-dictated hybrid): git commit-style vocabulary (task-prefix conventions), config strict-type flags (pyright/mypy), testing coverage thresholds (`fail_under`), operations workflow step-level tool scan — all subject to the ten-dimension output freeze (facts added only where legacy fixtures cannot match them; byte-identity rule below).
5. Full test-suite reconciliation (contracts, registration, activation, fixtures, final acceptance, provider catalogs, synthetic plugin, determinism, scan-cli, maintainability, architecture-extension), SHA-lock baseline **verification** (no regeneration required — proven during planning), SKILL.md documentation, and a real-repo acceptance probe on perplexity-cli whose NORMS.md is verified to contain the craft/style facts an agent needs to adopt the repo's style.

Constraints (non-negotiable, from SKILL.md and contracts):
- Zero npm dependencies; Node built-ins only; no installs/builds in scanned repos; read-only scanning; exactly one output write.
- Deterministic output; privacy model (no commit subjects, no identities, no raw excerpts); neutral factual voice (voice gate rejects evaluative terms).
- No new broker command IDs (existing `rg` + git IDs suffice); no changes to `enrich.mjs`, `validate.mjs`, `write.mjs` (all auto-adapt from the registry).
- All practices/craft claims must be phrased as declared-evidence or measured-fact inventory (`observed`/`inferred`), never verdicts on quality or culture. "Assessment" = measured counts, declared thresholds, and indicator presence — never "high coupling", "good style", "SOLID-conformant", or "violation" verdicts. Banned renderer vocabulary (already asserted): "high coupling", "hub", "criticality", "dead code".
- KV-style gate files (e.g. `quality/gates.conf`) are parsed with a key allowlist; raw values are never retained in the model (the privacy gate runs `assertPrivacySafe` over the whole practices model).
- The practices scanner must report a complete search space on empty repos (`not_detected` semantics), like every dimension in the fixture matrix.

Exclusions:
- Forge-external state (branch protection, required status checks, review approvals, merge policy), actual gate pass/fail, CI runtime state, achieved coverage/mutation scores, TDD ordering, commit subjects, `.git/hooks` (never committed), new git command IDs, cross-repo edges for the new dimension, registry/claim version-constant bumps (precedent: no bump for 6-dimension addition), any change to `enrich.mjs`/`validate.mjs`/`write.mjs`, SHA-lock baseline regeneration (verified unnecessary), practices must NOT be added to `RUNTIME_DIMENSION_IDS`, NO new dimension for craft/style, and NO changes to ten-dimension scanner findings or renderers (`architecture.mjs`, `conventions.mjs`, `config.mjs`, `testing.mjs`, `operations.mjs`, `git.mjs` scan output must stay byte-identical — fixture-behavior.json hashes depend on it).

## Acceptance Criteria
1. `node --test --test-concurrency=1` in the csm-scan repo passes 100% (pass count ≥ baseline 1010 plus the new tests added by T003/T005/T007/T016/T017), with all 17 dimension counts, 93 expected claims, and 15 provider dimensions asserted consistently.
2. `node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/practices-probe.md` (read-only on the target, output to sandbox) renders a "Development Practices" section with observed facts for at least: mutation testing, property-based testing, fuzzing, quality-gate thresholds, baseline/ratchet artifacts, plan-driven workflow, agent configs, coverage thresholds, CI gate steps, and style-guide values (line-length config, docstring dialect, naming patterns, standards like PEP 8); the CLI emits `[CSM] deep phase — dispatching 17 scanners` and an `Expected claim coverage: {"expected":93,"eligible":93,"complete":93,...}` JSON line with ratio 1.
3. The probe NORMS.md also contains craft facts usable as an agent-adoption brief: per-file cyclomatic-complexity distribution and dead-code markers (maintainability section), coupling aggregates (max fan-in/fan-out, files above threshold, cyclic groups) and SOLID/pattern indicators (architecture provider-evidence block), style-guide values (practices section) — all neutral-voiced, no quality verdicts.
4. `CLM-practices-*` (7), `CLM-maintainability-dead-code-v1`, `CLM-architecture-coupling-v1`, and `CLM-architecture-solid-indicators-v1` appear in the registry with globally unique IDs; voice gate, privacy gate, determinism gate, and constraint gates all pass.
5. Ten-dimension scanner findings and renderer output are byte-identical to baseline (fixture-behavior.json hashes unchanged — verified by T013); existing dimension claims are unchanged except the documented enrichments (git commit-style vocabulary, config strict flags, testing coverage thresholds, operations step scan, maintainability complexity facts); no fact is claimed by two dimensions — enforced by the T012 fixture assertions (EXPECTED_STATUS rows and explicit no-duplicate-fact checks per the Design boundary table).

## Current-State Evidence
- `lib/scan/contracts/dimension.mjs:32` `TOTAL_DIMENSION_COUNT = 16`; `:33` `PROVIDER_DIMENSION_COUNT = 14`; `:209-211` `validateDimensions` requires exactly `TOTAL_DIMENSION_COUNT` entries, error literal "must contain exactly 16 entries".
- `lib/scan/contracts/evidence.mjs:37-54` `DIMENSION_EVIDENCE_CATEGORIES` drives `DIMENSION_IDS` (`dimension.mjs:26`), `PROVIDER_DIMENSION_IDS` (`:28-30`), and `EVIDENCE_CATEGORIES` (`:56-62`); `lib/scan/contracts/provider.mjs:12-14` `PROVIDER_CATEGORIES[id] = DIMENSION_EVIDENCE_CATEGORIES[id]` — new categories flow into provider/plugin validation automatically once added to the dimension map (no catalog allowlist edits needed: `providers/base.mjs:138` enforces `PROVIDER_CATEGORIES[dimensionId]?.includes(category)`). `CONTRACT_LIMITS.expectedClaims = 128` — 93 claims fits.
- `lib/scan/registry/dimensions.mjs:74-270` `DIMENSION_SOURCES` (16 entries, `CLM-<dim>-<topic>-v1` claim IDs, rendererId `RND-<short>-v1`); `:319-337` `CROSS_REPO_GLOBAL_STAGE.order = TOTAL_DIMENSION_COUNT` auto-tracks.
- `lib/scan/pipeline/run.mjs:243-278` `scanDimension` switch; `:324-386` `fallbackDimension` (SCANNER_FAILURE models, `FAILURE_SEARCH_SPACE`); `:388+` `safeScanDimension`; `:444` `assertSixteenDimensionsPresent`; `:452-454` `PRIVACY_ENFORCED_DIMENSIONS`; `:619-621` `RUNTIME_DIMENSION_IDS` (must NOT gain practices); `:734-736` `collectProviderEvidence` consumes all analysis-plugin groups; `:848` `analysisProviderResults` call site (where the practices model is passed; also where architecture graph facts flow — currently passed as `facts: {}`); `:869-884` `mergeProviderEvidence` merges provider observations into deep findings — EXPANDED pipeline only; `:910` `providerEvidenceSection` renders provider evidence per dimension; `:974` `[CSM] deep phase — dispatching ${deepResults.length} scanners`; `:1039-1047` `Expected claim coverage: ${JSON.stringify(...)}`.
- Ten-dimension pipeline: `lib/scan/pipeline/existing-ten.mjs:12-23` enumerates structure/stack/config/testing/conventions/git/architecture/documentation/security/operations — `architecture` and `conventions` ARE legacy-ten scanners shared with the expanded pipeline (`run.mjs:245-255` deepScan route). Their `scan()` findings and renderers feed `test/fixtures-pipeline.test.mjs:130-131`, `test/expansion-production-pipeline.test.mjs:148-172`, and `test/expansion-activation.test.mjs:416-420` hash assertions against `fixture-behavior.json` (semantic + markdown SHA). Any findings change breaks all three and requires baseline regeneration — this plan avoids it entirely. Maintainability/practices are expanded-only (dispatched via their own scanners, not deepScan-ten).
- `lib/scan/render/registry.mjs:115-119` `DIMENSION_RENDERER_ORDER`; `:131-460` `DIMENSION_RENDERER_SOURCES`; `:490-498` `factoryRenderers`; voice gate terms `:80-86`; `:634-636` UNKNOWN_DIMENSION throw on unregistered dimensions (why T005 must land before T011's acceptance can render).
- Coupling primitives already computed: `lib/scan/deep/architecture/graph-facts.mjs:40-61` `computeFanInOut` (pure, no fs); `architecture.mjs:1309-1380` graph facts (fan-in/fan-out, edge-kind counts, Tarjan SCC) — header states "Raw values only — no hub/coupling/quality verdict". `test/expansion-architecture-extension.test.mjs:318-321` asserts the exact findings key set (`asciiGraph, c4Code, c4Component, c4Container, c4Context, importGraph, layers, modules`) — architecture `scan()` findings must NOT gain keys. `render/architecture-extension.mjs` is inert (imported only by the test) — craft facts render through the generic `providerEvidenceSection`, not a new renderer. Banned words asserted at `expansion-architecture-extension.test.mjs:484`: "high coupling|hub|criticality|dead code".
- Maintainability measurement primitives: `lib/scan/deep/maintainability/tokenizer.mjs:213,656` `tokenize`/`tokenizeText` for 5 dialects; `:184` branch-point counting; `scanner.mjs:48,161,226` tokenizes files and emits `branchPoints: branchRecords`. `model.mjs:262-264` `normalizeBranchPoint` uses `exactKeys(['capped','counts','dialect','path','tokens'])` — per-function complexity must be a NEW model stream, not added to branch records. `test/expansion-maintainability.test.mjs:624-626` fixes the observed provider categories to `['branch_point','file_metric','measurement_universe']` — dead-code/complexity facts flow from scanner findings ONLY, never `providers/maintainability.mjs`.
- Conventions standards detection: `lib/scan/deep/conventions.mjs:920-1159` `languageStandards` (PEP 8/257/484/621, ESLint, TS-ESLint, rustfmt/clippy) — "DETECTED, not asserted (P0-21)"; docstring dialect detection at `:840`. Conventions findings MUST stay byte-identical (ten-dimension freeze) — style-guide values therefore live in the practices scanner.
- Provider catalogs: `lib/scan/providers/analysis-catalog.mjs:51-55` `ANALYSIS_DIMENSION_IDS` (architecture/conventions/documentation — the catalog the new dimension joins); it has NO `CATALOG_DEFINITIONS` allowlist structure (that exists only in `assurance-catalog.mjs:100` / `runtime-catalog.mjs:65`); category admission is automatic via `base.mjs:138`. `lib/scan/providers/assurance-catalog.mjs:142-148` is the maintainability provider entry (hardcoded category list — subset OK; `:169` is the GENERIC fallback capability); `validateProviders` enforces subset, not full-list (`provider.mjs:47-57`). `lib/scan/providers/builtin/index.mjs:89-97` sets analysis provider categories by REFERENCE (`categories: PROVIDER_CATEGORIES[dimensionId]`) — full-list equality at `test/expansion-dimension-registration.test.mjs:481` auto-adapts when T002 edits the contract; `BUILTIN_DIMENSION_COUNT = 14` (`:159`).
- `test/expansion-dimension-registration.test.mjs:436-454` builtin-index block derives coverage from `PROVIDER_DIMENSION_IDS` while asserting `BUILTIN_DIMENSION_COUNT === 14` — the T002/T006 ownership seam; `:470-474` analysis mirror block gains the practices entry; `:252-269` dimension/renderer counts; `:561` `CROSS_REPO_GLOBAL_STAGE.order`; `:578` renderer+global set; `:148-237,296-335` `CATEGORY_TOPIC_COVERAGE` (10 new rows required: 7 practices + dead_code + coupling + design_pattern).
- `test/expansion-final-acceptance.test.mjs:146-155` `SIX_NEW_DIMENSIONS`/`TEN_DIMENSIONS`/`ALL_SIXTEEN = [...TEN, ...SIX]`; `:336,780,847,1292` `deep.length === 16`; `:420` `registryClaims === 83`; `:722-740` `FXLANG_FILES`; `:784` `first.markdown.includes('RUL-accept-practices-v1')`.
- `test/expansion-synthetic-plugin.test.mjs:100-115` `RULE_BLUEPRINTS`; `:163` `mergeCatalogs`; `:313+` per-dimension assertions; `:277-281` fixture artifact per provider dimension.
- `test/expansion-render-registration.test.mjs:186-246` `sixteenDeep()`/`sixteenFindings()`; `:286-292,297-310,341,603` count and slice-index assertions; `:467-484` heading ternary chain.
- Focused test files for the craft enrichments: `test/expansion-maintainability.test.mjs`, `test/expansion-architecture-extension.test.mjs` (imports `analyzeGraphFacts` + `detectDynamicIndicators` + the extension renderer).
- `test/expansion-fixtures.test.mjs:51` `SIX_NEW_DIMENSIONS` constant; `:102-105` `newDimensionStatus` helper; `:129-154` `EXPECTED_STATUS` matrix; `:415-431` empty-repo `not_detected` loop iterating the constant — the practices rows must extend all three.
- `test/expansion-provider-assurance-catalog.test.mjs:250` hardcodes the analysis dimension set (`DIM-architecture-v1`, `DIM-conventions-v1`, `DIM-documentation-v1`) and `:260-261` asserts "all 14 provider dimensions exactly once" — both must gain practices.
- Baseline SHA-lock facts (verified during planning): `test/baselines/expansion/supersession.json` records `deep/git.mjs` only in the SUPERSEDED entry `personal-identity-output` whose policy requires at least one legacy lock no longer to apply — the current git.mjs hash already differs from the recorded `bf73675c...`, so a git.mjs change (T007) cannot flip the assertion and **no regeneration is needed**; `capabilities.json` locks `shared/command.mjs` only; `test-integrity.json` locks 8 test files the plan does not touch. `fixture-behavior.json` hashes are protected by the ten-dimension freeze (AC5) — no regeneration. Consumers: `expansion-baseline.test.mjs:137,155`, `expansion-constraints.test.mjs:132`.
- Baseline suite run (2026-08-03, this planning session): `node --test --test-concurrency=1` → 1010/1010 pass, duration ~70s.
- Prior plans: `.agents/plans/2026-08-02-csm-scan-comprehensive-evidence-expansion-csm.md` (29 tasks, T200-T228: contracts first → inert leaf modules → inert registries → one atomic activation → fixtures → gates → docs) and `.agents/plans/2026-08-03-csm-scan-claim-coverage-caps-csm.md` (5 tasks; fixture/contract updates require independent review).
- Repo state: skills monorepo (`~/.config/opencode/skills/.git`), branch `main`, clean tree; csm-scan repo itself has no package.json/CI/hooks (a sparse negative fixture — see R&D).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| AD1 | Deliver as a new 17th dimension plus bounded enrichments to existing dimensions (hybrid) | User-dictated | User selected "Hybrid" at planning intake | Accepted |
| AD2 | Agent-workflow artifacts (.agents/plans, .agents/docs, AGENTS.md, .claude, .opencode, opencode.jsonc) are first-class practice signals | User-dictated | User selected "Include them" | Accepted |
| AD3 | Output is a neutral declared-practices/measured-facts inventory, never a quality/culture verdict | Architecture-forced | Evidence model + voice gate (`render/registry.mjs:80-86`) reject evaluative prose; "assessment" = measured counts and indicator presence; banned words asserted in `expansion-architecture-extension.test.mjs:484` | Accepted |
| AD4 | The new dimension is provider-capable and joins the analysis catalog | Architecture-forced | `PROVIDER_DIMENSION_IDS` derives by excluding structure/git; `validateDimension` enforces the flag; analysis catalog is the closest semantic cluster | Accepted |
| AD5 | 7 practices claims + 3 craft claims, 10 new evidence categories, all 1:1 with claim topics; expected claims 83→93; practices registered LAST in canonical order | Design decision | `CATEGORY_TOPIC_COVERAGE` set-inclusion tests require every category to map to a claim topic; `ALL_SEVENTEEN = [...TEN, ...SIX, 'practices']` and the determinism test require last position; `CONTRACT_LIMITS.expectedClaims = 128` accommodates 93 | Accepted |
| AD6 | No changes to enrich.mjs, validate.mjs, write.mjs; no new broker command IDs; no version-constant bumps; NO baseline regeneration at all (SHA-lock baselines AND fixture-behavior.json — the latter by ten-dimension freeze) | Design decision | All auto-adapt from registry; superseded locks already non-applying; craft facts routed so ten-dimension output never changes | Accepted |
| AD7 | Boundary: practices owns methodology/enforcement/automation/ritual/quality-gate/agent-workflow/style-guide fact families; craft claims live in maintainability/architecture via non-ten-dimension paths; presence-level facts stay with existing dims (Design boundary table, enforced by T012 fixture assertions) | Design decision | Track-B delta analysis of all 16 claim sets; prevents duplicate claims and enrich contradictions | Accepted |
| AD8 | Plan is saved in the csm-scan repo's `.agents/plans/` and committed to the skills monorepo (git root `~/.config/opencode/skills`) | Evidence | 4 prior plans live there and are tracked; monorepo branch `main` clean | Accepted |
| AD9 | Acceptance fixture is perplexity-cli (rich: mutation/property/fuzz/gates/baselines/agent configs); csm-scan itself is a sparse negative case (no package.json, no .git at dir level) | Evidence | Track-C survey of both repos | Accepted |
| AD10 | Craft/style assessment avoids any change to ten-dimension scanner findings: style-guide lives in the practices scanner (expanded-only), coupling/SOLID are derived as provider observations from existing graph facts (expanded-only merge), dead-code and complexity live in maintainability (expanded-only) | Architecture-forced | `existing-ten.mjs:12-23`; architecture exact-keys assertion (`expansion-architecture-extension.test.mjs:318-321`); fixture-behavior.json consumers (fixtures-pipeline:130-131, production-pipeline:148-172, activation:416-420); provider evidence merged only in the expanded pipeline (`run.mjs:869-884`) | Accepted |
| AD11 | Cyclomatic complexity folds into the existing `CLM-maintainability-branch-complexity-v1` facts (per-function counts + distribution) rather than a new claim | Design decision | The claim already owns branch/complexity measurement; extending facts avoids a near-duplicate claim; branch records keep their exact-keys schema (`model.mjs:262-264`) with complexity in a NEW model stream | Accepted |
| AD12 | Dead-code/coupling/SOLID/style-guide claims emit measured facts and indicator presence only; never "dead code found"/"violates SOLID"/"hub"/"high coupling" verdicts | Architecture-forced | Voice gate + privacy model; architecture graph-facts header and the banned-words renderer assertion | Accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD1 | Is the current suite green before any change? | `node --test --test-concurrency=1` in csm-scan repo | Read-only run; harness writes only to `fs.mkdtempSync(os.tmpdir())` (`test/harness.mjs:7-17`); `git status --short` unchanged after run | 1010/1010 pass, ~70s; suite self-contains a perplexity-cli pipeline test | T001 records the number; T015 asserts ≥ 1010 + new tests |
| RD2 | Does a 17th dimension break provider-capability validation? | Read-only source analysis of `dimension.mjs:28-30,192-194` and `provider.mjs` | No commands run | `PROVIDER_DIMENSION_IDS` is derived (exclusion list); a new dimension is provider-capable automatically; `providerCapability` flag must be true or validation fails | Practices dimension must be fully provider-wired (adapter, catalog, builtin index) — no non-provider shortcut exists |
| RD3 | Which production/test files hardcode 16/14/83? | Read-only grep across `lib/` and `test/` | No commands run | Full break-point inventory captured in Current-State Evidence and T002/T006/T012 ownership lists | Contract task owns production constants + contracts test; T006 owns the shared registration-file builtin block; T012 owns mechanical count updates |
| RD4 | What practice signals exist in real repos, and what is not feasible? | Read-only survey of csm-scan and perplexity-cli; read-only `git log --oneline -100` / `git branch -a` on perplexity-cli | Read-only git; privacy model excludes raw subjects from output | Confirmed 15+ detectable signals; not feasible: .git/hooks (not committed), forge state, gate pass/fail, commit subjects, achieved coverage | Claim set fixed; enforcement claims are presence-of-declaration, never behaviour |
| RD5 | Do the SHA-lock baselines regenerate automatically or fail hard? | Read-only inspection of `test/baselines/expansion/` + consumers (`expansion-baseline.test.mjs:137,155`, `expansion-constraints.test.mjs:132`) | No commands run | git.mjs appears only in a SUPERSEDED supersession entry whose lock already does not apply (current hash differs); capabilities.json locks command.mjs only; test-integrity.json locks 8 files the plan never touches | NO regeneration needed — T013 is verification-only; never write new hashes |
| RD6 | Is a new renderer auto-covered by the voice/privacy/determinism gates? | Read-only inspection of `expansion-voice-gate.test.mjs` (iterates `DIMENSION_RENDERER_ENTRIES`), determinism test (`renderProseLabel` map), privacy gate | No commands run | Voice/privacy gates auto-iterate registry entries; determinism test needs an explicit `renderProseLabel['practices']` entry | T005 runs the voice gate in its acceptance; T012 adds the determinism heading |
| RD7 | Does T011's acceptance depend on the renderer registration? | Read-only inspection of `render/registry.mjs:634-636` and `expansion-activation.test.mjs` CLI/hash tests | No commands run | Rendering an unregistered dimension throws UNKNOWN_DIMENSION; activation tests render end-to-end | T011 depends on T005; G2 fully drains before G4 |
| RD8 | Can T002's acceptance pass while the builtin index still covers 14 dims? | Read-only inspection of `expansion-dimension-registration.test.mjs:436-454` | No commands run | The builtin block compares BUILTIN coverage against `PROVIDER_DIMENSION_IDS` — it cannot pass until production builtin index and assertions both change | Builtin assertion updates move to T006's ownership; T002's acceptance is the contracts test only |
| RD9 | Do coupling primitives already exist for an aggregate claim? | Read-only inspection of `architecture/graph-facts.mjs:40-61` and `architecture.mjs:1309-1380` | No commands run | `computeFanInOut` is pure (no fs) and already computed in the model; architecture findings keys are asserted exactly (`expansion-architecture-extension.test.mjs:318-321`) | CLM-architecture-coupling-v1 derives aggregates in the provider layer from the existing model — scan() findings stay byte-identical |
| RD10 | Can the maintainability tokenizer support per-function cyclomatic counts? | Read-only inspection of `maintainability/tokenizer.mjs` (`tokenize`, `countBranchPoints`, 5 dialects) | No commands run | Lexical branch-point counting exists per file; per-function scope counting requires scope-tracking extension (brace/indent); branch records use `exactKeys` (`model.mjs:262-264`) | T016 carries a spike candidate to prove per-function counting on all 5 dialects; complexity facts go in a NEW model stream, never inside branch records |
| RD11 | Do new evidence categories need catalog/builtin changes? | Read-only inspection of `provider.mjs:12-14`, `base.mjs:138`, `analysis-catalog.mjs`, `assurance-catalog.mjs:142-148,169`, `builtin/index.mjs:89-97`, `expansion-dimension-registration.test.mjs:470-495` | No commands run | PROVIDER_CATEGORIES derives from the dimension map (auto); category admission is automatic via `base.mjs:138` (analysis-catalog has NO allowlist structure); builtin analysis categories are set by REFERENCE (`builtin/index.mjs:89-97`) so the full-list equality (test:481) auto-adapts; maintainability catalog entry is a subset — `dead_code` needs no catalog change | T004 needs only the practices adapter + ANALYSIS_DIMENSION_IDS/PROVIDER_IDS + test updates; T006 needs only the practices mirror + count + test updates; NO allowlist-editing steps exist |
| RD12 | What does conventions already detect about standards? | Read-only inspection of `conventions.mjs:920-1159` and `:840` | No commands run | `languageStandards` detects PEP 8/257/484/621, ESLint, TS-ESLint, rustfmt/clippy presence; docstring dialect detected; conventions is a TEN-dimension scanner — its findings feed fixture-behavior.json | Style-guide VALUES live in the practices scanner (expanded-only); conventions findings stay byte-identical |
| RD13 | Would editing ten-dimension scanners change fixture hashes? | Read-only inspection of `existing-ten.mjs:12-23`, `fixtures-pipeline.test.mjs:130-131`, `expansion-production-pipeline.test.mjs:148-172`, `expansion-activation.test.mjs:416-420` | No commands run | architecture/conventions/config/testing/operations/git are legacy-ten; fixture-behavior.json locks their findings and markdown; T008/T009/T010 are safe only because legacy fixtures lack the new sections (byte-identity rule) | Ten-dimension output freeze (AC5): craft facts never enter ten-dimension findings; T016/T017/T003 are the only craft homes |

## Discovered Requirements
- Hidden-path probing: `rg --files` prunes dot-directories; `.github`, `.agents`, `.opencode`, `.quality-gates`, `AGENTS.md` must be probed explicitly via the governance pattern (`deep/governance/scanner.mjs` `hiddenGovernancePaths` idiom). (Evidence: `shared/enum.mjs`; Track-C)
- Voice gate + banned vocabulary: the renderer's static `label`/`prose` in `render/registry.mjs` must be neutral (e.g. "Development Practices"); words like "mature", "healthy", "embraces", "strong" trigger `VOICE_HIT` at registry build. Provider-evidence prose for coupling/SOLID must avoid the already-asserted banned words "high coupling", "hub", "criticality", "dead code" (`expansion-architecture-extension.test.mjs:484`) and any verdict phrasing ("violation" → "layer-boundary edge counts").
- Privacy: commit-style evidence is aggregate-only (counts, labels); raw subjects and identities are rejected by `shared/privacy.mjs`. KV-style gate files are parsed with a key allowlist; raw values are never retained — `assertFindingsPrivacy` (run.mjs:464-493) runs `assertPrivacySafe` over the entire practices model.
- Parser caps: `quality/gates.conf` is KV-format, not TOML/YAML — bounded KV parse required (spike in T003). Parse failures degrade to `unverified` search-space state, never absence or crash (T202 contract).
- Empty-repo semantics: every scanner must report a complete search space on empty repos so the fixture matrix's `not_detected` assertions hold (`expansion-fixtures.test.mjs:415-431`).
- Contract literals: the "exactly 16 entries" error string (`dimension.mjs:210`) and its regex (`expansion-contracts.test.mjs:182`) must change in lockstep.
- Canonical ordering: `DIM-practices-v1` is appended LAST (after `DIM-assurance-v1`) in `DIMENSION_SOURCES` (`registry/dimensions.mjs`) and `DIMENSION_RENDERER_ORDER` (`render/registry.mjs`); `ALL_SEVENTEEN = [...TEN_DIMENSIONS, ...SIX_NEW_DIMENSIONS, 'practices']` (`expansion-final-acceptance.test.mjs:146-155`); determinism asserts canonical heading order. The 3 craft claims slot into their EXISTING dimensions' claim lists in `DIMENSION_SOURCES`.
- Ten-dimension output freeze: `architecture`, `conventions`, `config`, `testing`, `operations`, `git` scan() findings and renderers must stay byte-identical (fixture-behavior.json). Craft facts route: practices (expanded-only scanner), maintainability (expanded-only scanner), architecture (provider-derived observations merged only in the expanded pipeline, `run.mjs:869-884`).
- Provider wiring: `RUNTIME_DIMENSION_IDS` (run.mjs:619-621) must NOT gain practices; plugin observations auto-wire once `DIM-practices-v1` joins `ANALYSIS_DIMENSION_IDS`; only the `analysisProviderResults` call site (run.mjs:848) needs the practices model passed. Category admission is automatic (`base.mjs:138`); no catalog allowlist edits exist.
- csm-build appends new discoveries each cycle and applies them to all remaining tasks.

## Design
Target behaviour: scanning any repo yields a 17th NORMS.md section "Development Practices" reporting declared practice evidence per claim (7 claims incl. style-guide values); the Maintainability section carries complexity distributions and dead-code markers; the Architecture provider-evidence block carries coupling aggregates and SOLID indicators. The full NORMS.md is an agent-adoption brief: an agent can read the style values, idioms, naming, dialect, complexity norms, and workflow practices and match them in new code.

Claim set (each claim owns one category, 1:1 with `CATEGORY_TOPIC_COVERAGE`):

| Claim | Category | Factual scope (signals) |
|---|---|---|
| CLM-practices-methodology-v1 | methodology | BDD/Gherkin (.feature files, behave/robot deps), mutation testing ([tool.mutmut], mutmut dep, mutation-named CI jobs), property-based testing (hypothesis dep, strategies.py, property markers), fuzzing (atheris dep, fuzz_corpus dirs, fuzz markers) |
| CLM-practices-enforcement-v1 | enforcement | Commit-convention enforcement (commitlint/gitlint configs), CI gate steps (tool names in workflow steps), hook commands (lefthook/pre-commit command lists) |
| CLM-practices-automation-v1 | automation | Release automation (release-drafter.yml, semantic-release/release-please configs, publish workflows), dependency-update automation (dependabot.yml, renovate.json), docs-build toolchain (mkdocs/sphinx/docusaurus configs), reproducible dev env (devcontainer.json, .devcontainer/, mise/asdf/nix) |
| CLM-practices-rituals-v1 | ritual | PR/issue template contents (required sections), review-bot configs, changelog enforcement (CHANGELOG format + release-drafter coupling) |
| CLM-practices-quality-gates-v1 | quality_gate | Gate declaration files (quality/gates.conf, .quality-gates*), threshold values (bounded KV parse with key allowlist), baseline/ratchet systems (*baseline*.json, ratchet scripts, test/baselines) |
| CLM-practices-agent-workflow-v1 | agent_workflow | Plan-driven workflow (.agents/plans/*-csm.md or plans/, docs/plans with Control/Status headers), design/acceptance records (.agents/docs, quality/remediation), agent configs (AGENTS.md, CLAUDE.md, .claude, .opencode, opencode.jsonc) |
| CLM-practices-style-guide-v1 | style_guide | Style-guide values: line-length/indent/quote config values (ruff, black, prettier, rustfmt, gofmt), naming-pattern details, zen/principle documents (PEP 20, Go proverbs, Rust API guidelines, JS styleguide deps), standards-conformance facts (PEP 8 and per-language equivalents) |
| CLM-maintainability-dead-code-v1 | dead_code | Dead-code signals: vulture configs/whitelists, noUnusedLocals / no-unused-vars rule presence, `#[allow(dead_code)]` counts, unused-import lexical markers per dialect, dead-code tooling in manifests |
| CLM-architecture-coupling-v1 | coupling | Coupling aggregates (provider-derived from the import graph): max and top fan-in/fan-out, files above fan-in threshold, cyclic-group sizes (Tarjan SCC), layer-boundary edge counts, edge-kind counts |
| CLM-architecture-solid-indicators-v1 | design_pattern | SOLID/pattern indicators (provider-derived): interface-typed reference counts, abstract-class/interface usage, dependency-direction indicators between layers, port/contract/adapter dir markers, pattern-suffix naming (Service/Factory/Repository/Adapter), inheritance-depth signals |

Enrichment (existing claim, no new claim): `CLM-maintainability-branch-complexity-v1` facts gain per-function cyclomatic-complexity counts and file-level distributions (min/median/p95/max) in a NEW model stream (`complexityRecords`), extending the tokenizer's branch-point measurement without touching branch-record schema.

Boundary table (fact family → owning dimension; no fact claimed twice):
- Commit-style classification, branch naming, template presence → git (existing claims; T007 only extends the vocabulary)
- Hook-config presence + top-level keys → config (existing); hook commands/contents → practices-enforcement
- Coverage tool/config presence → testing (existing); threshold value (`fail_under`) → testing (T009); gate application in CI steps/hooks → practices-enforcement
- CI job/trigger inventory → operations (existing); step-level tool names → operations (T010) and gate semantics → practices-enforcement
- Lint/format/type tool presence → config (existing); pyright/mypy strict flags → config (T008); style VALUES (line length, indent, quotes) + zen docs + naming details → practices-style-guide (T003); standards presence (PEP 8 etc.) + docstring dialect → conventions (existing facts, byte-identical)
- ADR inventory, CODEOWNERS, CONTRIBUTING, release file presence → governance (existing); plan/agent artifacts → practices-agent-workflow; automation configs → practices-automation
- Maintainability tool presence, duplicates, complexity, measurement universe → maintainability (existing); per-function complexity → branch-complexity facts (T016); dead-code tooling + lexical markers → maintainability-dead-code (T016); gate thresholds + baselines/ratchets → practices-quality-gates
- Raw graph facts (fan-in/out, SCC, edges) → architecture findings (existing, byte-identical); derived coupling aggregates + SOLID indicators → architecture provider observations (T017, expanded-only)
- Lockfiles, pins, SBOM/SARIF, dependabot boolean → security/assurance (existing); dependabot/renovate config content → practices-automation

Architecture wiring (new files and touchpoints):
- `deep/practices/scanner.mjs` + `model.mjs`: hidden-path probes, TOML-section probes (`tomlSectionPresent` idiom), bounded KV parse (key allowlist, no raw values), workflow-step regex, `shared/detection.mjs` `PRACTICE_TOOLS` table, style-value extraction (line-length/indent/quote from config files, zen-doc detection, naming details); model with `summary`/`entries`/`diagnostics`/`searchSpace`, `assertPrivacySafe`, `encodeMatchedKey`; complete search space on empty repos. 7 claims / 7 categories.
- Maintainability: `deep/maintainability/tokenizer.mjs` (per-function scope tracking + cyclomatic counting), `deep/maintainability/scanner.mjs` + `model.mjs` (new `complexityRecords` + `deadCode` findings streams), `render/maintainability.mjs` (neutral craft facts), `test/expansion-maintainability.test.mjs`. No catalog/builtin change (assurance subset).
- Architecture craft: NEW pure derivation helper `lib/scan/deep/architecture/craft.mjs` (computes coupling aggregates and SOLID indicators from the model's importGraph/layers — pure, no fs) consumed by the analysis-catalog adapter to emit observations; `lib/scan/providers/analysis-catalog.mjs` (after T004) wires the architecture craft observations; rendered via the generic `providerEvidenceSection`; `test/expansion-architecture-extension.test.mjs` extended. Architecture `scan()` findings byte-identical; exact-keys assertion intact.
- `providers/practices.mjs` adapter (PRV-analysis-practices-v1) + `analysis-catalog.mjs` extension (practices entry; architecture craft observations) + `builtin/index.mjs` practices mirror (categories auto-adapt by reference).
- `render/practices.mjs` + `render/registry.mjs` registration (order last, sources, factory).
- `pipeline/run.mjs`: `scanDimension` case, `fallbackDimension` SCANNER_FAILURE model, `PRIVACY_ENFORCED_DIMENSIONS`, `assertSixteenDimensionsPresent` rename, `analysisProviderResults` call-site wiring (practices model + architecture craft facts); NOT `RUNTIME_DIMENSION_IDS`.
- Contracts: `evidence.mjs` category map (10 new categories), `dimension.mjs` counts + literal, `registry/dimensions.mjs` (practices entry last with 7 claims; 3 craft claims into existing dimension entries).
- Plugins: no schema change — dimension and new categories become plugin-targetable automatically once registered.

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
    T016 maintainability craft (leaf) <- T002
    T017 architecture craft (leaf) <- T002, T004
G4  T011 activation cutover        <- T003,T004,T005,T006   (G2 fully drains before G4)
G5  T012 suite reconciliation      <- T011,T007,T008,T009,T010,T016,T017   (independent review)
    T013 baseline verification     <- T007                        (verification only)
G6  T014 SKILL.md                  <- T011
    T015 final gate + probe        <- T012,T013,T014
```
Critical path: T001 → T002 → (T003/T004/T005/T006) → T011 → T012 → T015.
Parallel groups: G2 {T003,T004,T005,T006} and G3 {T007,T008,T009,T010,T016,T017} are pairwise disjoint file owners (T017 depends on T004 for `analysis-catalog.mjs` sequencing and starts after it); G2 and G3 may run concurrently. G2 must fully drain before G4. G5 {T012,T013} disjoint. Shared-file ownership: `analysis-catalog.mjs` → T004 (practices entry) then T017 (architecture craft observations, sequential); `builtin/index.mjs` → T006 only; `test/expansion-dimension-registration.test.mjs` → T002 (registry/renderer/CATEGORY_TOPIC_COVERAGE blocks) + T006 (builtin block, lines 436-495); T006's acceptance runs the whole file after both land, so T006 depends on T002. T016/T017 touch no ten-dimension scanner output.

## Numbered Plan
1. [completed] Baseline gate
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
   - DONE (cycle 1, 2026-08-03): `node --test --test-concurrency=1` → 1010 pass / 0 fail / ~72.6s; tree clean (only unrelated untracked README.md at skills root).

2. [pending] Contracts and registry: 17th dimension + 3 craft claims
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G1
   - Risk: high (touches the exactly-16 contract; every downstream task conforms to this)
   - Owned scope: `lib/scan/contracts/evidence.mjs`, `lib/scan/contracts/dimension.mjs`, `lib/scan/registry/dimensions.mjs`, `test/expansion-contracts.test.mjs`, `test/expansion-dimension-registration.test.mjs` (registry/renderer/CATEGORY_TOPIC_COVERAGE blocks ONLY — NOT the builtin-index block at lines 436-495, owned by T006)
   - Not in scope: `run.mjs`, providers, renderers, fixtures, other test files (their breakage is expected until T011/T012); the registration test's builtin-index block (T006)
   - Spike candidate: none — the exact edit set is proven by Track-A research (file:line inventory in Current-State Evidence)
   - Actions: (a) Add `DIM-practices-v1` to `DIMENSION_EVIDENCE_CATEGORIES` with categories `['methodology','enforcement','automation','ritual','quality_gate','agent_workflow','style_guide']` and add `dead_code` to `DIM-maintainability-v1`, `coupling` + `design_pattern` to `DIM-architecture-v1`; (b) bump `TOTAL_DIMENSION_COUNT` 16→17 and `PROVIDER_DIMENSION_COUNT` 14→15; change the `validateDimensions` error literal to "exactly 17 entries"; (c) add the `DIMENSION_SOURCES` entry for practices LAST (after assurance): short `practices`, `DIM-practices-v1`, `DEFAULT_APPLICABILITY`, the 7 `CLM-practices-*-v1` claim IDs; append `CLM-maintainability-dead-code-v1` to the maintainability entry, `CLM-architecture-coupling-v1` + `CLM-architecture-solid-indicators-v1` to the architecture entry; (d) update `test/expansion-contracts.test.mjs` (counts, provider-category keys, `slice(0,15)`→`slice(0,16)` negative case with `/exactly 17/`, `computeCoverage` expectations built from `DIMENSION_IDS`); (e) update the registry/renderer blocks of `test/expansion-dimension-registration.test.mjs` (`DIMENSION_DEFINITIONS.length` 17, renderer counts 17, `CROSS_REPO_GLOBAL_STAGE.order` 17, renderer+global set 18, `CATEGORY_TOPIC_COVERAGE` rows for the 10 new categories mapping to the 10 new claims) — leave the builtin-index block untouched.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-contracts.test.mjs` passes 100%.
   - Validation: `node -e "import('./lib/scan/registry/dimensions.mjs').then(m => console.log(m.DIMENSION_REGISTRY.length, m.EXPECTED_CLAIM_IDS.length))"` prints `17 93`; the registration test file passes EXCEPT the builtin-index block (documented expected failure until T006).
   - Acceptance evidence: targeted-run pass output + registry length/claim-count output recorded.
   - Repair attempts: 0
   - Recovery note: If registry validation fails, the dimension.mjs/evidence.mjs/registry edits must land together (they are one atomic change); detect partial application by the failed `validateDimensions` call and re-apply the missing piece.

3. [pending] Practices scanner and model (7 claims incl. style-guide)
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/deep/practices/model.mjs`, `lib/scan/deep/practices/scanner.mjs`, `lib/scan/shared/detection.mjs` (add `PRACTICE_TOOLS` detection table only), `test/expansion-practices.test.mjs` (new)
   - Not in scope: `run.mjs` wiring (T011), provider adapter (T004), renderer (T005), conventions/config scanners (ten-dimension freeze — style-guide values are computed HERE, not in conventions)
   - Spike candidate: prove the bounded KV parse of `quality/gates.conf`-style files (key allowlist, no raw values) and the workflow-step tool regex against perplexity-cli's committed `quality/gates.conf` + `.github/workflows/mutation-scheduled.yml` in a `/tmp/opencode` sandbox with copied read-only inputs; expected: threshold keys and mutation tool name extracted without TOML/YAML parser failures and without retaining raw values.
   - Actions: (a) `model.mjs`: dimension id, category allowlist (7 categories, must equal the registry entry), limits mirroring GOVERNANCE_LIMITS, `summary`/`entries`/`diagnostics`/`searchSpace` shapes, `assertPrivacySafe` before freeze, `encodeMatchedKey`; (b) `scanner.mjs`: enumerate → hidden-path probes (`existsSync`/`readdirSync` for `.github`, `.agents`, `.opencode`, `.quality-gates*`, root `AGENTS.md`/`CLAUDE.md`/`opencode.jsonc`), TOML-section probes (`tomlSectionPresent` idiom), bounded reads via `readArtifacts`, detection via `PRACTICE_TOOLS` + `matchDep`, workflow-step regex, KV parser for gate files with key allowlist, style-value extraction (line-length/indent/quote values from ruff/black/prettier/rustfmt/gofmt configs, zen/principle doc detection, naming-pattern details, styleguide dependency presence) into the style_guide category; complete search space on empty repos (not_detected semantics); return `{ dimension: 'practices', signal, findings: model }`; (c) `detection.mjs`: add the `PRACTICE_TOOLS` table (mutmut, hypothesis, atheris, diff-cover, import-linter, deptry, vulture, actionlint, commitlint, gitlint, semantic-release, release-please, renovate, sphinx, mkdocs, docusaurus, pre-commit, lefthook, bandit, radon, eslint-config-airbnb, black, prettier); (d) write `test/expansion-practices.test.mjs`: positive fixture exercising all 7 categories (including hidden-dir artifacts and a style-guide config with line-length values) and negative cases asserting `not_detected` only after complete searches.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/expansion-detection.test.mjs` still passes (detection table extension must not disturb existing maps); privacy canary: the model contains no raw KV values (covered by the task's own fixture asserting a `token=...`-style pair is never retained); the conventions `languageStandards` facts remain untouched (no conventions edits).
   - Acceptance evidence: targeted-run outputs; fixture paths exercised per category; style-value samples; privacy-canary result.
   - Repair attempts: 0
   - Recovery note: partial scanner state is detectable by missing `searchSpace` or missing categories in the model; the model must be deep-frozen and privacy-safe before acceptance.

4. [pending] Provider adapter and analysis-catalog extension
   - Task ID: T004
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/providers/practices.mjs` (new), `lib/scan/providers/analysis-catalog.mjs` (practices entry ONLY — the architecture craft observations are added later by T017), `test/expansion-provider-analysis-catalog.test.mjs`
   - Not in scope: `builtin/index.mjs` (T006), `run.mjs` wiring (T011), maintainability provider (T016 — no catalog change), architecture craft observations (T017, sequential on this file)
   - Spike candidate: none
   - Actions: (a) `providers/practices.mjs`: adapter mirroring `providers/governance.mjs` — `PRV-analysis-practices-v1` id, `sourceKindFor(category)` map, bounded matched keys, `practicesProviderResult(model)` → `createProviderResult`; (b) `analysis-catalog.mjs`: append `DIM-practices-v1` to `ANALYSIS_DIMENSION_IDS` (last), add `practices: 'PRV-analysis-practices-v1'` to `ANALYSIS_PROVIDER_IDS`, import and wire the practices adapter into the catalog results path (NO category-allowlist edits — category admission is automatic via `base.mjs:138` once T002 registers the categories); (c) update `test/expansion-provider-analysis-catalog.test.mjs` for the new dimension (`ANALYSIS_DIMENSION_IDS.length` 3→4, provider count and category checks).
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-analysis-catalog.test.mjs` passes 100%.
   - Validation: provider foundation contract test (`test/expansion-provider-foundation.test.mjs`) still passes.
   - Acceptance evidence: targeted-run outputs; catalog entries recorded.
   - Repair attempts: 0
   - Recovery note: a missing adapter or dimension id surfaces as a typed unknown-dimension error in the catalog test; re-apply the entry and re-run.

5. [pending] Practices renderer and render-registry registration
   - Task ID: T005
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/render/practices.mjs` (new), `lib/scan/render/registry.mjs`, `test/expansion-render-registration.test.mjs`
   - Not in scope: `run.mjs`, fixtures, existing-dimension renderers (ten-dimension freeze — none may change)
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
   - Not in scope: the registry/renderer/CATEGORY_TOPIC_COVERAGE blocks of the registration test (T002); analysis-catalog.mjs (T004); NO category-list edits — analysis provider categories are set by reference (`builtin/index.mjs:89-97`) and auto-adapt from `PROVIDER_CATEGORIES`
   - Spike candidate: none
   - Actions: (a) production: add the practices mirror to `BUILTIN_DEFINITIONS` (categories by reference, auto-adapting) and bump `BUILTIN_DIMENSION_COUNT` 14→15; (b) tests: update the builtin block — `BUILTIN_DIMENSION_COUNT` 15, test title "all 14 provider dimensions" → 15, and the analysis mirror block (470-474) gains `[ANALYSIS_PROVIDER_IDS.practices, ANALYSIS_DIMENSION_IDS[3]]`; the coverage comparison (438-439) and full-list equality (481) auto-adapt once production and `PROVIDER_DIMENSION_IDS` both hold 15.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-dimension-registration.test.mjs` passes 100% (the whole file — T002's blocks plus this task's builtin block — green together).
   - Validation: `node -e "import('./lib/scan/providers/builtin/index.mjs').then(m => console.log(m.BUILTIN_DIMENSION_COUNT))"` prints `15`.
   - Acceptance evidence: targeted-run output + printed count.
   - Repair attempts: 0
   - Recovery note: missing mirror surfaces as a mismatch between `BUILTIN_DIMENSION_COUNT` and the registry or as the coverage-comparison failure at 438-439; re-apply the definition and re-run. Do NOT append categories to the analysis definitions — that would trip `validateProviders` DUPLICATE_ID.

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
   - Validation: existing `test/regression-parity.test.mjs` still passes (legacy classifier behaviour unchanged for old vocab); legacy fixtures' git logs must not reclassify (their logs are conventional-style).
   - Acceptance evidence: targeted-run outputs; classifier label mapping recorded.
   - Repair attempts: 0
   - Recovery note: the supersession lock for `deep/git.mjs` is SUPERSEDED and already non-applying (current hash differs from the recorded lock), so no lock test can fail from this change — verified in T013. If a fixture git row reclassifies, reconcile in T012 (dep declared).

8. [pending] Configuration strict-type-flag facts
   - Task ID: T008
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/deep/config.mjs` (tool facts only), `test/config.test.mjs`
   - Not in scope: tsconfig strict (already covered), style VALUES (practices-style-guide, T003), fixture expectations (T012), SHA-lock files (T013)
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
    - Not in scope: other test files (T012), SKILL.md (T014); do NOT add practices to `RUNTIME_DIMENSION_IDS` (run.mjs:619-621) — it is an analysis-catalog dimension; do NOT touch ten-dimension dispatch paths
    - Spike candidate: verify the activation ordering against `collectGlobalSnapshot`/`mergeProviderEvidence` so the new dimension's model flows through enrichment and validation unchanged — read-only tracing before editing.
    - Actions: (a) add `case 'practices': return scanPractices(repoPath, overview);` to `scanDimension`; (b) add the `fallbackDimension` case returning a `buildPracticesModel` SCANNER_FAILURE model (FAILURE_SEARCH_SPACE); (c) append `'practices'` to `PRIVACY_ENFORCED_DIMENSIONS`; (d) rename `assertSixteenDimensionsPresent` to `assertAllDimensionsPresent` (iterate `DIMENSION_REGISTRY` — auto-adapts); (e) pass the practices model into the `analysisProviderResults` call site (run.mjs:848) — plugin observations need no extra wiring (they flow via `ANALYSIS_DIMENSION_IDS` from T004, consumed at run.mjs:734-736); (f) update `test/expansion-activation.test.mjs` (`deep.length` 17, `registryClaims`/`coverage.expected` 93).
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-activation.test.mjs` passes 100%.
    - Validation: `node --test --test-concurrency=1 test/expansion-constraints.test.mjs test/expansion-privacy-gate.test.mjs` still pass (one-write, zero-dep, read-only, privacy canaries).
    - Acceptance evidence: targeted-run outputs; activated dimension count recorded.
    - Repair attempts: 0
    - Recovery note: a crash in the new scanner must degrade to the SCANNER_FAILURE model (claims `unverified`), never abort — verify by temporarily injecting a failure in the sandbox if needed; the cutover edits land as one atomic change.

12. [pending] Suite reconciliation: fixtures, counts, plugin blueprints, headings (requires independent review)
    - Task ID: T012
    - Depends on: T011, T007, T008, T009, T010, T016, T017
    - Parallel group: G5
    - Risk: standard (independent review required per precedent)
    - Owned scope: `test/fixtures-expansion/` (new practices fixture), `test/expansion-fixtures.test.mjs`, `test/expansion-final-acceptance.test.mjs`, `test/expansion-synthetic-plugin.test.mjs`, `test/expansion-provider-assurance-catalog.test.mjs`, `test/expansion-determinism.test.mjs`, `test/scan-cli.test.mjs`
    - Not in scope: SHA-lock baseline files (T013 — verification only), production code, the focused craft test files (T016/T017 own `expansion-maintainability.test.mjs`/`expansion-architecture-extension.test.mjs`); fixture-behavior.json (must NOT change — ten-dimension freeze, AC5)
    - Spike candidate: none — count targets are enumerated in Track-D research and the Current-State Evidence inventory
    - Actions: (a) add a practices fixture exercising all 7 categories including hidden-dir artifacts and a style-guide config (positive) and an empty repo (negative, asserting complete-search-space `not_detected`); (b) update `expansion-fixtures.test.mjs`: extend the `SIX_NEW_DIMENSIONS` constant (:51) and the `newDimensionStatus` helper (:102-105) with practices, add `EXPECTED_STATUS` rows for practices with observed + not_detected cases, extend the empty-repo `not_detected` loop (:415-431), extend the maintainability and architecture rows covering the new craft claims' observed + not_detected cases, and add boundary assertions that no dimension re-asserts facts owned by another (per the Design boundary table — e.g. practices does not re-assert commit-style presence); (c) update `expansion-final-acceptance.test.mjs`: `registryClaims` 93, `deep.length` 17 at all four sites (336/780/847/1292), `ALL_SIXTEEN`→`ALL_SEVENTEEN = [...TEN_DIMENSIONS, ...SIX_NEW_DIMENSIONS, 'practices']` (146-155, 339/431/433), provider counts 15 (753-755), a practices plugin blueprint in `PLUGIN_BLUEPRINTS` with a matching artifact in `FXLANG_FILES` (722-740) so `first.markdown.includes('RUL-accept-practices-v1')` (784) passes, heading assertions; (d) update `expansion-synthetic-plugin.test.mjs`: add the 15th `RULE_BLUEPRINTS` entry for `DIM-practices-v1` (allowlisted category + selector, 100-115), a matching artifact in `FIXTURELANG_FILES` (277-281), pass `practices: byDim.practices` into `analysisProviderResults` inside `mergeCatalogs` (163, 186-191), and 16→17/14→15 count updates (391, 225-372); (e) update `expansion-provider-assurance-catalog.test.mjs`: add `DIM-practices-v1` to the hardcoded analysis dimension set at :250, reword "14 provider dimensions" → 15 at 246/260-261; (f) update `expansion-determinism.test.mjs` `renderProseLabel` map with the practices heading (239-256); (g) extend `scan-cli.test.mjs` label coverage for the practices dimension.
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs test/expansion-final-acceptance.test.mjs test/expansion-synthetic-plugin.test.mjs test/expansion-provider-assurance-catalog.test.mjs test/expansion-determinism.test.mjs test/scan-cli.test.mjs` passes 100%.
    - Validation: determinism gate byte-identical on two consecutive fixture runs (covered by `expansion-determinism.test.mjs`); the full fixture matrix passes with the new craft rows; fixture-behavior.json hashes unchanged (AC5).
    - Acceptance evidence: targeted-run outputs; per-file count deltas recorded; independent-review sign-off noted in the journal.
    - Repair attempts: 0
    - Recovery note: fixtures failing only after this task means a production change (T003-T011, T016-T017) and a fixture expectation drifted apart; reconcile the fixture, not the production claim. If a fixture-behavior hash fails, a ten-dimension scanner changed — stop and identify the offending task.

13. [pending] Baseline SHA-lock verification (verification only — NO regeneration)
    - Task ID: T013
    - Depends on: T007
    - Parallel group: G5
    - Risk: low (no file writes; verifies the planning-phase finding that no lock applies to this plan's changes)
    - Owned scope: none (read-only verification of `test/baselines/expansion/capabilities.json`, `supersession.json`, `test-integrity.json`, and `fixture-behavior.json` byte-identity)
    - Not in scope: any file modification; do NOT write new hashes — the supersession policy ("requires at least one legacy lock no longer to apply") would break if a still-applying hash were written into the SUPERSEDED `personal-identity-output` entry
    - Spike candidate: none — the mechanism was proven during planning (RD5): git.mjs appears only in the SUPERSEDED `personal-identity-output` entry whose lock already does not apply (current hash ≠ recorded `bf73675c...`); `capabilities.json` locks `shared/command.mjs` only; `test-integrity.json` locks 8 files this plan never touches; fixture-behavior.json is protected by the ten-dimension freeze
    - Actions: (a) confirm `git status` shows no changes to the three baseline files and `fixture-behavior.json`; (b) run `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs` and confirm they pass unchanged; (c) record in the journal the hash-diff evidence for git.mjs and the policy reasoning (superseded entry requires non-application, which T007's change preserves).
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs` passes 100% with zero baseline-file modifications.
    - Validation: `git diff --stat test/baselines/` is empty.
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
    - Actions: Update the dimension table (16→17, add Development Practices as the 17th row with its 7 claim topics; note the craft claims in Maintainability/Architecture), the pipeline description ("16-dimension registry" → 17), the provider section (14→15 provider dimensions), the plugin section (dimension count references), the test-suite section if counts appear.
    - Acceptance signal: `rg -n '16-dimension|14 provider|exactly 16|16 dimensions|all 16' SKILL.md` returns nothing; `rg -n 'DIM-practices-v1|Development Practices|17' SKILL.md` returns the expected new rows.
    - Validation: the dimension table row for practices matches the registry claim IDs; the craft claims are named; no dangling "16-dimension"/"16 dimensions"/"all 16" phrasing remains.
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
    - Actions: (a) full suite `node --test --test-concurrency=1` — 100% pass, pass count ≥ 1010 plus the new tests added by T003 (expansion-practices.test.mjs), T005 (render-registration additions), T007 (git-commit-vocab.test.mjs), T016/T017 (maintainability/architecture additions); record the exact count; (b) real-repo probe from a neutral workdir: `node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/practices-probe.md` (read-only on the target; output to sandbox); verify the NORMS.md contains a "Development Practices" section with observed facts for at least: mutation testing, property-based testing, fuzzing, quality-gate thresholds, baseline/ratchet artifacts, plan-driven workflow, agent configs, coverage thresholds, CI gate steps, and style-guide values (line-length config, docstring dialect, naming patterns, standards like PEP 8); (c) verify the craft facts: Maintainability shows per-file cyclomatic-complexity distribution and dead-code markers (vulture whitelist, unused-import signals); Architecture provider-evidence block shows coupling aggregates (max fan-in/fan-out, files above threshold, cyclic-group sizes) and SOLID/pattern indicators — these are the agent-adoption facts; (d) verify the CLI emits the exact strings `[CSM] deep phase — dispatching 17 scanners` and `Expected claim coverage: {"expected":93,"eligible":93,"complete":93,...}` (JSON line, ratio 1) — match the actual reporter output formats (`run.mjs:974`, `run.mjs:1039-1047`); (e) verify the new sections are neutral-voiced and contain no raw subjects, identities, secrets, raw KV values, banned words, or quality verdicts.
    - Acceptance signal: full suite exits 0 with 0 failures AND pass count ≥ 1010 + new tests, AND the probe output satisfies AC2/AC3/AC4 (practices section populated incl. style-guide values, craft facts present, "dispatching 17 scanners", 93/93 coverage JSON line).
    - Validation: `git status --short` in the skills monorepo shows only the plan file and intended commits.
    - Acceptance evidence: full-suite summary with exact count, probe NORMS.md path, facts checklist, coverage line, neutral-voice/privacy check.
    - Repair attempts: 0
    - Recovery note: any failing test or missing probe fact loops back to the owning task (T002-T014, T016-T017); record the exact failing test in the journal before returning to SELECT.

16. [pending] Maintainability craft: cyclomatic complexity + dead-code signals
    - Task ID: T016
    - Depends on: T002
    - Parallel group: G3
    - Risk: standard (tokenizer extension is the riskiest piece — spike first)
    - Owned scope: `lib/scan/deep/maintainability/tokenizer.mjs`, `lib/scan/deep/maintainability/scanner.mjs`, `lib/scan/deep/maintainability/model.mjs`, `lib/scan/render/maintainability.mjs`, `test/expansion-maintainability.test.mjs`
    - Not in scope: `assurance-catalog.mjs` / `builtin/index.mjs` / `providers/maintainability.mjs` (no change — dead-code/complexity facts flow from scanner findings ONLY; the provider-parity assertion at `expansion-maintainability.test.mjs:624-626` stays at `['branch_point','file_metric','measurement_universe']`), practices scanner (T003), fixture expectations (T012), ten-dimension files (maintainability is expanded-only — no fixture-behavior impact)
    - Spike candidate: prove per-function cyclomatic scope counting on all 5 tokenizer dialects (python, javascript, typescript, rust, shell) against small synthetic files in a `/tmp/opencode` sandbox; expected: function/class-scope branch counts produce stable distributions (min/median/p95/max) per file without brace/indent false positives.
    - Actions: (a) `tokenizer.mjs`: extend with per-function scope tracking (brace/indent nesting) and cyclomatic counting (branch keywords + boolean operators per function scope); keep the existing file-level branch-point counts byte-identical; (b) `scanner.mjs`/`model.mjs`: emit per-file complexity distributions as a NEW `complexityRecords` findings stream (extending `CLM-maintainability-branch-complexity-v1` — no new claim; branch records keep their exact-keys schema `['capped','counts','dialect','path','tokens']` at `model.mjs:262-264`) and `deadCode` entries (vulture config/whitelist presence, `noUnusedLocals`/`no-unused-vars` rules, `#[allow(dead_code)]` counts, unused-import lexical markers per dialect) into `CLM-maintainability-dead-code-v1` (category `dead_code`); all entries `assertPrivacySafe`, complete search space on empty repos; (c) `render/maintainability.mjs`: neutral rendering of complexity distribution + dead-code markers (counts and paths only; the banned word "dead code" must not appear in renderer prose — use "unused-code markers"); (d) extend `test/expansion-maintainability.test.mjs` with positive/negative cases for both the complexity facts and dead-code signals, including a privacy canary (a `token=...`-style line in a dead-code artifact is never retained).
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-maintainability.test.mjs` passes 100%.
    - Validation: `node --test --test-concurrency=1 test/regression-parity.test.mjs` still passes (existing branch-point counts unchanged); legacy ten-dimension fixtures stay byte-identical (fixture-behavior.json rule per T008/T009).
    - Acceptance evidence: targeted-run outputs; complexity distribution sample; dead-code entries sample.
    - Repair attempts: 0
    - Recovery note: if existing branch-point counts change, the tokenizer extension regressed — revert the scope-tracking change and re-run; partial model state is detectable by missing `searchSpace` or deadCode entries without diagnostics.

17. [pending] Architecture craft: coupling aggregates + SOLID/pattern indicators (provider-derived)
    - Task ID: T017
    - Depends on: T002, T004 (analysis-catalog.mjs sequencing)
    - Parallel group: G3
    - Risk: standard
    - Owned scope: `lib/scan/deep/architecture/craft.mjs` (NEW pure derivation helper), `lib/scan/providers/analysis-catalog.mjs` (architecture craft observations — after T004's practices entry), `test/expansion-architecture-extension.test.mjs`
    - Not in scope: `lib/scan/deep/architecture.mjs` scan() findings (ten-dimension freeze — exact-keys assertion `expansion-architecture-extension.test.mjs:318-321` and fixture-behavior hashes must stay intact), `render/architecture*.mjs` (no renderer changes — craft facts render via the generic `providerEvidenceSection`), `builtin/index.mjs` (T006), fixture expectations (T012)
    - Spike candidate: derive coupling aggregates (max/top fan-in, max/top fan-out, files above fan-in threshold, cyclic-group sizes, layer-boundary edge counts) from the architecture model's importGraph/layers via a pure recomputation in a `/tmp/opencode` sandbox (read-only source copy); expected: stable deterministic aggregates; confirm the raw findings remain byte-identical.
    - Actions: (a) `deep/architecture/craft.mjs`: pure functions (no fs, no process) computing coupling aggregates from the model's `importGraph` (fan-in/fan-out per file via `computeFanInOut` reuse or equivalent pure logic) and `layers` (layer-boundary edge counts), plus SOLID/pattern indicators (interface-typed reference counts, abstract-class/interface usage, dependency-direction between layers, port/contract/adapter dir markers, pattern-suffix naming counts) — all counts/indicators, no verdicts; (b) `analysis-catalog.mjs` (after T004): wire the architecture craft observations into the architecture provider results (category `coupling` / `design_pattern`) — these observations render in the architecture provider-evidence block of the EXPANDED pipeline only (`run.mjs:869-884,910`); (c) extend `test/expansion-architecture-extension.test.mjs` with positive/negative cases for both claims' observations; (d) verify the observations prose avoids the banned words "high coupling", "hub", "criticality", "dead code" (asserted at `:484`) and any verdict phrasing ("layer-boundary edge counts", "files above fan-in threshold").
    - Acceptance signal: `node --test --test-concurrency=1 test/expansion-architecture-extension.test.mjs` passes 100%.
    - Validation: `node --test --test-concurrency=1 test/architecture.test.mjs` still passes — raw graph facts byte-identical; the exact-keys assertion (318-321) passes unchanged; `test/expansion-provider-analysis-catalog.test.mjs` still passes (T004's file, extended observations); fixture-behavior hashes unchanged.
    - Acceptance evidence: targeted-run outputs; aggregate sample; indicator sample; banned-words check.
    - Repair attempts: 0
    - Recovery note: raw-graph regressions surface in the existing architecture tests — revert the craft additions if raw facts change; the header note "Raw values only — no hub/coupling/quality verdict" governs phrasing; if the exact-keys assertion fails, findings were modified — move the facts back into the provider layer.

## Verification Strategy
Ordered cheapest-first:
- Per-task gates: each task's targeted `node --test --test-concurrency=1 test/<owned>.test.mjs` runs (fast, ~seconds to a minute). Fast per-task gates: T002 (contracts test), T003 (practices + detection), T004 (analysis catalog + provider foundation), T005 (render registration + voice gate), T006 (registration test whole file), T007 (git vocab + parity), T008-T010 (config/testing/operations + parity + fixture-behavior byte-identity), T016 (maintainability + parity + fixture-behavior byte-identity), T017 (architecture-extension + architecture + analysis catalog + banned-words check).
- Expensive batch gates: T012's six-file reconciliation run and T013's baseline/lock verification; the full suite (T001, T015) at ~70s — the authoritative gate.
- Final gates: full suite (determinism, privacy, constraints, voice all included) plus the real-repo probe at T015.
- Parallelism: G2 and G3 run concurrently; per-task gates within a group may run in parallel (disjoint files); the full suite must run with `--test-concurrency=1` (authoritative, per SKILL.md) and serially with respect to other commands.
- Known environment sensitivity: none identified; suite runtime ~70s baseline. Note: `golden.test.mjs` uses content regexes and a test-count range, not a hash baseline — nothing to regenerate there; the real-repo probe targets perplexity-cli read-only.

## Risks And Recovery
| Risk | Mitigation | Recovery |
|---|---|---|
| R1 Contract/registry blast radius (exactly-16 contract, 10+ test gates, 10 new categories) | T002 lands as one atomic task; strict G1→G2/G3→G4 sequencing (G2 drains before G4); per-task targeted gates; break-point inventory pre-enumerated | Revert T002's three production edits together; re-run contracts test |
| R2 SHA-lock interference | Planning-phase proof (RD5) that no lock applies to this plan's files; T013 is verification-only and never writes hashes | A lock failure means an out-of-scope change — stop and identify it; never regenerate/disable locks |
| R3 Voice-gate rejection of practices/craft prose | Prose drafted against the fixed voice-term list before registration; voice gate in T005 acceptance; T016/T017 renderer/adapter prose checked for neutral phrasing and banned words | Reword label/prose; re-run voice-gate + render-registration tests |
| R4 Hidden-path silent `not_detected` (.github, .agents, .opencode, AGENTS.md) | Explicit probes per governance pattern in T003; positive fixture in T012 covers hidden dirs | Add missing probe; add fixture case; re-run practices + fixtures tests |
| R5 Overclaiming enforcement/behaviour from presence (including craft verdicts) | Claims are declared-evidence/measured-fact inventory; `inferred` only where deterministic derivation exists; neutral phrasing; "assessment" never a verdict; banned vocabulary enforced | Adjust claim facts/limitations; re-run practices/maintainability/architecture tests |
| R6 Provider wiring gap (new dimension never receives plugin/generic evidence) | T004 catalog + T011 `analysisProviderResults` call-site wiring; cross-checks via catalog + activation tests; T012 plugin-blueprint assertions | Verify the practices model reaches `analysisProviderResults`; add plugin observation case |
| R7 Duplicate facts across dimensions → enrich contradictions | Design boundary table (AD7) with T012 no-duplicate-fact fixture assertions; style-guide vs config/conventions boundary explicit | Move the conflicting fact to its owning dimension; re-run fixtures + acceptance |
| R8 Full-suite drift after mechanical count updates | T012 targeted six-file run before full suite; T015 final gate | Fix the specific failing assertion; re-run targeted file then full suite |
| R9 Interrupted task state | Per-task recovery notes; journal checkpoints; registry/contracts tasks detect partial application via validation failures | Resume at RECOVER with journal; re-run the interrupted task's acceptance signal |
| R10 T011/T012 acceptances blocked by renderer not yet registered | T005 is a declared dependency of T011; G2 drains before G4 | If UNKNOWN_DIMENSION appears, T005 has not landed — complete G2 before G4 |
| R11 Tokenizer regression (per-function scope counting changes existing branch-point counts) | T016 spike first; validation requires byte-identical branch-point facts + fixture-behavior | Revert scope-tracking change; re-run maintainability + parity tests |
| R12 Craft facts perceived as verdicts (coupling/SOLID/style "assessment") | Measured counts and indicator presence only; architecture raw-values note governs; banned-words check in T016/T017 validation | Reword renderer/adapter prose; re-run affected tests |
| R13 Ten-dimension freeze violation (any scan() findings or renderer change to architecture/conventions/config/testing/operations/git) | AC5 + explicit freeze in T007/T008/T009/T010/T017 scopes; fixture-behavior byte-identity in every task validation; T013 verification | Stop and identify the offending task; revert the findings-shape change; re-run fixture-behavior consumers |
| R14 Analysis-catalog sequencing conflict (T004 practices entry + T017 craft observations, same file) | T017 depends on T004; ownership notes in both tasks | If concurrent edits collide, complete T004 first and rebase T017's edits onto it |

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1: T002/T006 share `expansion-dimension-registration.test.mjs`; both stated acceptances unsatisfiable | Blocker | Builtin-index block (436-495) ownership moved to T006; T002's acceptance is the contracts test only; T006's acceptance runs the whole registration file after both land (T006 depends on T002); graph and ownership notes updated | `expansion-dimension-registration.test.mjs:436-454` coverage comparison vs `PROVIDER_DIMENSION_IDS` |
| F2: T011/T012 omit the T005 renderer dependency; acceptance would throw UNKNOWN_DIMENSION | Major | T005 added to T011's dependencies; G2 must fully drain before G4; critical path and graph updated; R10 added | `render/registry.mjs:634-636`; activation tests render end-to-end |
| F3: T013's regeneration premise false; writing hashes would break the supersession policy | Major | T013 rewritten as verification-only (no writes); AD6, R2, T007 recovery note updated; RD5 records the proof | `supersession.json` SUPERSEDED entry `personal-identity-output`; `capabilities.json` broker-only; `test-integrity.json` 8 untouched files |
| F4: T012 synthetic-plugin scope under-specified (blueprint, artifact, mergeCatalogs) | Major | T012 action (d) now enumerates the 15th `RULE_BLUEPRINTS` entry, `FIXTURELANG_FILES` artifact, `mergeCatalogs` wiring, and final-acceptance `FXLANG_FILES`/`RUL-accept-practices-v1` | `expansion-synthetic-plugin.test.mjs:100-115,163,277-281,313+`; `expansion-final-acceptance.test.mjs:722-740,784` |
| F5: T005 render-registration edits incomplete (sixteenDeep + slice indexes) | Major | T005 action (c) now includes the `sixteenDeep()` practices entry and every slice-index shift (292-341, 603) | `expansion-render-registration.test.mjs:186-246,467-484` |
| F6: AC2/T015 strings don't match CLI output | Minor | AC2 and T015 now assert the exact reporter formats: `[CSM] deep phase — dispatching 17 scanners` and the `Expected claim coverage: {"expected":93,...}` JSON line; concrete test-count floor stated | `run.mjs:974,1039-1047` |
| F7: practices canonical position unspecified | Minor | Position fixed as LAST (after assurance) in `DIMENSION_SOURCES` and `DIMENSION_RENDERER_ORDER`; `ALL_SEVENTEEN` composition stated in T002/T005/T012 and Discovered Requirements | `expansion-final-acceptance.test.mjs:146-155`; determinism canonical-order test |
| F8: ten-dimension fixture-behavior.json lock has no owner guard | Minor | T008/T009/T016 validations require byte-identical fixture output with a stop-and-report rule; R13 added; T012 recovery note names the freeze | `test-integrity.json`; legacy fixtures lack the new sections |
| F9: golden test has no hash baseline to regenerate | Minor | Verification Strategy corrected — `golden.test.mjs` uses content regexes + count range; regen note removed | `golden.test.mjs:185-229` |
| F10: "analysisPluginObservations grouper" wiring is a no-op | Observation | T011 action (e) rephrased: only the `analysisProviderResults` call site (run.mjs:848) needs the practices model; plugin observations auto-flow via `ANALYSIS_DIMENSION_IDS` | `run.mjs:734-736,848` |
| F11: RUNTIME_DIMENSION_IDS exclusion | Observation | Noted as an explicit do-not-touch in T011 scope and Exclusions | `run.mjs:619-621` |
| F12: T014 acceptance not runnable | Minor | Replaced with concrete `rg` acceptances including the "16 dimensions"/"all 16" phrasings | SKILL.md dimension table |
| F13: KV model exposed to `assertFindingsPrivacy` | Minor | T003 requires key-allowlist parsing, no raw value retention; privacy-canary fixture case added to T003 validation; Discovered Requirements updated | `run.mjs:464-493`; `shared/privacy.mjs` |
| F14: complete-search-space semantics on empty repos | Minor | T003/T016/T017 and the T012 negative fixture require complete search space for `not_detected`; Discovered Requirements updated | `expansion-fixtures.test.mjs:415-431` |
| F15: boundary table "enforced by tests" not named | Observation | AC5 and T012 action (b) now name the boundary assertions: no-duplicate-fact checks in the fixture rows | Design boundary table |
| F16 (amendment 1): craft claims need catalog/builtin ownership | Major | Resolved by verification: category admission is automatic (`base.mjs:138`); builtin analysis categories are by-reference (`builtin/index.mjs:89-97`) — T004/T006 need only the practices entry/mirror; no allowlist edits exist; maintainability `dead_code` needs no catalog change (assurance subset, `assurance-catalog.mjs:142-148`) | `provider.mjs:12-14`; `expansion-dimension-registration.test.mjs:481`; `assurance-catalog.mjs:142-148` |
| F17 (amendment 1): complexity as enrichment vs new claim | Observation | Complexity folds into `CLM-maintainability-branch-complexity-v1` facts (AD11) in a NEW `complexityRecords` stream (branch-record schema untouched, `model.mjs:262-264`); dead code gets its own claim; claim count 93 stays within the 128 bound | `maintainability/tokenizer.mjs`; `CONTRACT_LIMITS.expectedClaims` |
| F18 (amendment 2): T017/T018 would change ten-dimension scanner output and break fixture-behavior.json; no owner | Blocker | Ten-dimension output freeze (AC5, R13): style-guide claim moved into the practices dimension (expanded-only scanner, T003); coupling/SOLID derived as provider observations in `deep/architecture/craft.mjs` + `analysis-catalog.mjs` (expanded-only merge at `run.mjs:869-884`); architecture/conventions findings stay byte-identical; no baseline regeneration anywhere | `existing-ten.mjs:12-23`; `fixtures-pipeline.test.mjs:130-131`; `expansion-production-pipeline.test.mjs:148-172`; `expansion-activation.test.mjs:416-420`; exact-keys assertion `expansion-architecture-extension.test.mjs:318-321` |
| F19 (amendment 2): architecture craft facts have no rendering channel; findings keys asserted | Major | Coupling/SOLID render via the generic `providerEvidenceSection` (`run.mjs:910`); scanner findings unchanged (exact-keys assertion intact); T017 owns `deep/architecture/craft.mjs` (pure helper) + analysis-catalog wiring (after T004) | `run.mjs:645,869-884,910`; `expansion-architecture-extension.test.mjs:318-321` |
| F20 (amendment 2): CATALOG_DEFINITIONS fiction in analysis catalog | Major | Removed: analysis-catalog has no allowlist structure; category admission automatic via `base.mjs:138`; T004 edits are the practices adapter + dimension/provider-id lists + tests | `base.mjs:138`; `analysis-catalog.mjs` |
| F21 (amendment 2): builtin full-list manual extension would trip DUPLICATE_ID | Major | Removed the false action; builtin analysis categories auto-adapt by reference (`builtin/index.mjs:89-97`); T006 = practices mirror + count + test updates only | `builtin/index.mjs:89-97`; `provider.mjs:47-57` |
| F22 (amendment 2): banned/verdict vocabulary ("hub", "violation") | Minor | T017 phrasing fixed: "files above fan-in threshold", "layer-boundary edge counts"; banned-words check added to T017 validation and R5/R12 | `expansion-architecture-extension.test.mjs:484` |
| F23 (amendment 2): assurance-catalog hardcoded analysis set at :250 | Minor | T012 action (e) now adds `DIM-practices-v1` to the set and rewrites "14"→"15" | `expansion-provider-assurance-catalog.test.mjs:250,260-261` |
| F24 (amendment 2): fixtures helpers iterate SIX_NEW_DIMENSIONS, not just EXPECTED_STATUS | Observation | T012 action (b) extends the constant (:51), `newDimensionStatus` (:102-105), and the empty-repo loop (:415-431) | `expansion-fixtures.test.mjs:51,102-105,415-431` |
| F25 (amendment 2): maintainability facts must not flow through the provider | Observation | T016 scope states facts flow from scanner findings only; provider-parity assertion (`expansion-maintainability.test.mjs:624-626`) stays untouched; complexity in a new model stream | `maintainability/model.mjs:262-264`; `expansion-maintainability.test.mjs:624-626` |
| F26 (amendment 2): assurance-catalog:169 mis-cited | Observation | Citation fixed to the maintainability entry `:142-148`; conclusion unchanged (subset OK, dead_code needs no catalog change) | `assurance-catalog.mjs:142-148,169` |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | INTAKE | — | Ask classified: large, open. User decisions AD1 (hybrid) and AD2 (agent artifacts included) recorded | DISCOVER |
| 2026-08-03 | 0 | DISCOVER | — | Repo state, plan location, 16-dimension contract, wiring points inspected (file:line evidence) | RESEARCH |
| 2026-08-03 | 0 | RESEARCH | — | 5 parallel tracks: uncertainty scout, wiring anatomy, coverage delta, signal inventory, test impact; baseline suite run 1010/1010 (RD1) | DRAFT |
| 2026-08-03 | 0 | DRAFT | — | 15 tasks (T001-T015), 7 groups, 6 cycles; hybrid design with boundary table | CRITIQUE |
| 2026-08-03 | 0 | CRITIQUE | — | Independent hostile review: 15 findings (2 blockers, 6 major, 6 minor, 2 observations), all with file:line evidence | REMEDIATE |
| 2026-08-03 | 0 | REMEDIATE | — | All 15 findings resolved (F1 ownership seam, F2 dependency, F3 verification-only T013, F4/F5 enumerated edits, F6-F15 corrections); graph/risks/journal updated | VERIFY |
| 2026-08-03 | 0 | VERIFY | — | Primary-agent verification passed: ACs map to tasks, every task has runnable acceptance/risk/anti-scope/spike, dependencies consistent, file:line references verified | SAVED |
| 2026-08-03 | 0 | SAVED | — | Plan committed to skills monorepo (7caf26d); implementation NOT started | STOP |
| 2026-08-03 | 1 | INTAKE | — | Amendment brief: add craft/style assessment (cyclomatic complexity, dead code, coupling, SOLID, PEP 8/PEP 20-for-any-language conventions); NORMS.md as agent-adoption brief | DISCOVER |
| 2026-08-03 | 1 | RESEARCH | — | RD9-RD13: coupling primitives exist (graph-facts, pure), tokenizer extensible (5 dialects), category admission automatic (base.mjs:138), builtin categories by-reference, conventions is a TEN-dimension scanner (fixture-behavior freeze) | DRAFT |
| 2026-08-03 | 1 | DRAFT | — | Amendment integrated: 4 craft claims (style-guide→practices, dead-code→maintainability, coupling+SOLID→architecture), complexity enrichment, 93 expected claims, T016/T017 added, catalog/builtin ownership verified | CRITIQUE |
| 2026-08-03 | 1 | CRITIQUE | — | Amendment critique: 10 findings — 1 blocker (T017/T018 ten-dimension hash breakage), 3 major (rendering channel, CATALOG_DEFINITIONS fiction, builtin full-list fiction), 6 minor/observation | REMEDIATE |
| 2026-08-03 | 1 | REMEDIATE | — | F18-F26 resolved: ten-dimension output freeze (AC5/R13); style-guide moved into practices scanner (T003, 7 claims); coupling/SOLID provider-derived (T017, `deep/architecture/craft.mjs` + analysis-catalog after T004); CATALOG_DEFINITIONS/builtin-list actions removed; T012 fixture-helper enumeration; banned vocabulary fixed; 17 tasks final | VERIFY |
| 2026-08-03 | 1 | VERIFY | — | Primary-agent verification passed: 17 tasks, 2 high/11 standard/4 low, AC1-AC5 mapped, counts 93/17/15 consistent across T002/T011/T012/AC2, ten-dimension freeze verified against fixture-behavior consumers | SAVED |
| 2026-08-03 | 1 | SAVED | — | Amended plan committed to skills monorepo; implementation NOT started | STOP |
| 2026-08-03 | 1 | RECOVER | — | Repo inspected: skills monorepo main, tree clean except unrelated untracked README.md (preserved); node v20.20.2; no NORMS.md in csm-scan repo (norms integration skipped, optional); plan file present at .agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md | VALIDATE |
| 2026-08-03 | 1 | VALIDATE | T001 | Toolchain matches planning baseline; plan references verified against source during planning and unchanged since | SELECT |
| 2026-08-03 | 1 | SELECT | T001 | Ready set: T001 (G0) | DISPATCH |
| 2026-08-03 | 1 | DISPATCH | T001 | Baseline run executed by primary agent (verification-only task) | VERIFY |
| 2026-08-03 | 1 | VERIFY | T001 | `node --test --test-concurrency=1` → 1010 pass / 0 fail / 72.6s — acceptance signal satisfied | CHECKPOINT |
| 2026-08-03 | 1 | CHECKPOINT | T001 | T001 completed with evidence; Control updated; next: SELECT -> T002 | SELECT |

## Completion Review
<filled by csm-build when all criteria are verified>
