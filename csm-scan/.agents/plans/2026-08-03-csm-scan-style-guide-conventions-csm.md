# csm-scan Comprehensive Style Guide & Conventions CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 8 tasks — 0 high, 7 standard, 1 low. Tasks that always require independent review: T007 (suite reconciliation including review of the deliberate gate-value policy test flips, per 2026-08-03 precedent).
- The system is fully activated; the ten-dimension output freeze (AC5) governs every task: NO unconditional `scan()` findings or renderer changes to config/testing/operations/conventions/git/architecture/stack — new facts are emitted only under conditional-absent keys and validated byte-identical against `fixture-behavior.json`. Two facts (Makefile targets, ruff line-length) are forced into expanded-only hosts because the shell/python legacy fixtures already contain those artifacts.
- Token rule (critique B1): every value carried in `kinds[]` must be a bounded printable-ASCII token WITHOUT spaces — multi-word names (import-linter contract names, convention headings, gate tokens) are hyphenated slugs; numeric values go in `count` (integers) or as slug tokens (floats, grades); never emit raw multi-word prose as kinds.

## Control
- Plan ID: csm-scan-style-guide-conventions
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-03 — planning research + hostile critique completed; both critique blockers (token rule, static/extractor dedup) and all majors resolved in this revision; baseline 1100/1100 at a387f69
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Enhance the csm-scan skill (at `/home/jamiemills/.config/opencode/skills/csm-scan/`) so that every future run emits, in NORMS.md, a **comprehensive per-repo Style Guide & Conventions** section and a detailed conventions list, incorporating the deep-assessment feedback (10 verified gaps + 17 new gaps from the 2026-08-03 subagent review). The goal is an agent-adoption brief: a coding agent can read NORMS.md and build new features to the repo's standards (style values, lint/type rules, gate thresholds, test taxonomy, command map, hooks semantics, architecture contracts, deny/allow rules) without opening the underlying config files. Declared-conventions content is surfaced as heading-level signals plus value-carrying style facts (prose extraction is explicitly out of scope — see Exclusions).

Deliverables:
1. A new pure parser module `lib/scan/deep/practices/style.mjs` extracting declared style/convention facts: ruff select/ignore/per-file-ignores/line-length/quote-style/pydocstyle dialect, Makefile targets, lefthook stage semantics (fixing the existing `.commands` vs `.jobs` bug), `quality/gates.conf` threshold values (policy change, privacy-safe), `opencode.jsonc` deny rules + plugin inventory, declared-conventions section headings (AGENTS.md/CONTRIBUTING.md, heading-signal only), and exceptions-hub role detection. All values carried as bounded slugs/ints per the token rule.
2. A bounded INI section-block reader in `shared/` for `.importlinter`, consumed by the architecture dimension (single home — M7): conditional-absent contract fact + rendering in the Architecture Craft Assessment (expanded-only wrapper).
3. Comprehensive rendering: a "Style Guide & Conventions" block in the practices renderer (kinds/counts/values; currently paths-only), a marker-taxonomy line in Testing (conditional, self-contained in deep/testing.mjs), a conditional pyright-strict line in Configuration, and an aggregate per-function complexity line in Maintainability.
4. Zero contract churn: NO new claims, NO new evidence categories — all new facts are new `kind` values under existing claims/categories; expected claims stay 93; the registry is untouched.
5. A gate-value privacy policy change (documented, evidence-backed): bounded numeric thresholds (ints in `count`, floats/grades as slug tokens in `kinds`) are retained in quality_gate entries (provably allowed by `assertPrivacySafe`); the model's "values never survive" contract comment and the deliberate policy tests are updated — the production-causing task (T003) lands its own test flips green, and T007 independently reviews the policy rationale.

Constraints (non-negotiable):
- Zero npm dependencies; Node built-ins only; read-only scanning; single output write; deterministic; privacy model (no emails, identities, raw excerpts, secrets, absolute paths); neutral voice (voice gate).
- Ten-dimension output freeze: `fixture-behavior.json` semantic + markdown hashes, `renderer.md`, and the five legacy fixtures must stay byte-identical (AC5).
- No changes to `enrich.mjs`, `validate.mjs`, `write.mjs`, supersession entries, or `test-integrity.json`; no baseline regeneration.
- Token rule: kinds are bounded printable-ASCII tokens without spaces; multi-word names are hyphenated slugs; values never appear as raw `KEY=value` strings.
- Static EXACT_PATHS entries and content extractors must use DISTINCT kinds (static presence kind vs content kind) so the dedup in `buildPracticesModel` (first-wins on matchedKey+path) never drops content (critique B2).

Exclusions:
- The AGENTS.md deliverable for perplexity-cli (repo-side, not the skill) — noted as follow-up.
- New claims/categories/dimensions; contract or registry count changes; baseline regeneration; forge-external state; actual gate pass/fail.
- Conventions PROSE extraction (free-form lists are fragile — heading signals + values only); the 20-point conventions block extraction from `.opencode/plugins/*.ts` source (fragile) — the plugin inventory + deny rules substitute.
- `.importlinter` facts do NOT live in the practices dimension (single home: architecture, M7). Pytest markers do NOT live in practices (single home: deep/testing.mjs, M6).
- `SEMGREP_SEVERITY` value is not rendered (command-line flags — key presence only); `DISTANCE_THRESHOLD=0.3` renders as a slug token (M3).
- Changes to ten-dimension findings shape beyond the conditional-absent enrichments listed; unconditional shared-renderer changes.

## Acceptance Criteria
1. Full suite `node --test --test-concurrency=1` passes 100% (baseline 1100 + new tests), with registry claims still 93, dimensions 17, provider dimensions 15 — zero contract churn.
2. Real-repo probe (`node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/style-probe.md`) renders a comprehensive Style Guide & Conventions block containing at least: ruff rule families (select/ignore/per-file-ignores with counts), line-length=100, pydocstyle dialect (Google), Makefile target count, lefthook stage/job facts, gate threshold values (MIN_COVERAGE=85 as count, FAIL_UNDER=85, RADON_CC_GRADE=B as token, RADON_MI_GRADE=B, FILE_SIZE_CAP=1000, DIFF_COVERAGE_THRESHOLD=90, MAX_FLAGGED=30, DISTANCE_THRESHOLD=0.3 as token, MIN_CONFIDENCE=80), opencode deny rules + plugin inventory, declared-conventions headings, exceptions-hub detection; Configuration shows pyright strict; Testing shows the marker taxonomy (9 markers); Maintainability shows an aggregate complexity line; Architecture Craft Assessment shows the import-linter contracts (names rendered backticked). Coverage line remains `{"expected":93,"eligible":93,"complete":93,"ratio":1}` and the practices dimension is NOT in SCANNER_FAILURE.
3. Ten-dimension freeze held: `fixture-behavior.json` byte-identity (fixtures-pipeline 5/5, regression-parity, renderer.md, production-pipeline, baseline) — part of T005's acceptance signal.
4. Gate-value policy change landed: quality_gate entries carry bounded values (ints in `count`, slugs in `kinds`); the model privacy-contract comment states the new rule; the deliberate policy tests flipped by T003 (its own green gate) and reviewed in T007; `assertPrivacySafe` passes with zero redactions.
5. Voice gate, privacy gate, determinism gate, constraints gate all green; contract names and values render backticked or in table value cells (never bare prose in first cells) — no voice-term collisions.

## Current-State Evidence
- Registry: 17 dimensions, 93 expected claims, practices dimension with 7 claims — `lib/scan/registry/dimensions.mjs:277-285`; expected-claim count asserted at `test/expansion-activation.test.mjs:516-517`, `test/expansion-constraints.test.mjs:343`, `test/expansion-final-acceptance.test.mjs:432` (all `93`).
- Practices scanner/model: `lib/scan/deep/practices/{scanner,model}.mjs`; `CATEGORY_EXTRACTORS` dispatch `scanner.mjs:62-71`; entry schema `model.mjs:73-75`; `PRACTICES_LIMITS` `model.mjs:57-71` (maxKinds 32); TOKEN_PATTERN `model.mjs:78` (`/^[\x21-\x7e]+$/` — NO spaces — critique B1); privacy contract comment `model.mjs:11-17`; KV allowlist `QUALITY_GATE_ALLOWLIST` `model.mjs:936`; `lefthookCommands` bug `model.mjs:788-817` (`.commands` vs `.jobs`); `hasRelevantExtension` `model.mjs:606-610`, `isCandidatePath` `model.mjs:619-630` (rejects Makefile/.importlinter/CONTRIBUTING.md); `EXACT_PATHS` `model.mjs:405-502` (lowercase keys — `classifyPracticePath` lowercases before lookup `model.mjs:685-687`); dedup first-wins on matchedKey+path `model.mjs:320-326` + static-first push `scanner.mjs:141-143` (critique B2).
- Renderer: `render/practices.mjs` paths-only (`renderCategoryGroup` 107-116); `render/registry.mjs` practices prose 472-488, architecture-craft wired at `registry.mjs:37,262`.
- Ten-dimension map: `lib/scan/pipeline/existing-ten.mjs:12-23`; shared renderers `render/existing-ten.mjs:1-11`; expanded-only: practices, maintainability, architecture-craft.mjs.
- Byte-identity mechanism: `test/baselines/expansion/fixture-behavior.json:10-14`, `test/fixtures-pipeline.test.mjs:128-131`; conditional-absent precedent `config.mjs:544-554`, `testing.mjs:480-484`; coverage% = reported/total keys (`enrich.mjs:25-31`).
- Legacy fixture inventory (verified): shell HAS `Makefile` (`test/fixtures/shell.mjs:4-11`); python HAS `[tool.ruff] line-length=100` (`test/fixtures/python.mjs:20-21`) and `[tool.pytest.ini_options] testpaths` (NO markers key — marker fact is byte-identity-safe); NO fixture has lefthook.yml, `[tool.ruff.lint]`, `[tool.pyright]`, `.importlinter`, gates.conf, opencode deny rules, AGENTS.md conventions.
- Parser idioms (empirically verified): `parseToml` full support incl. per-file-ignores (`shared/parse.mjs:14-432`); `parseYamlShallow` throws on block scalars → regex-over-YAML `operations.mjs:80-104`; `makefileExtractor` `declarations.mjs:170-203`; JSONC scrubber `architecture.mjs:79-142` (module-private); `tomlSectionPresent`/`readSectionValue` `config.mjs:128-136,491-518` single-line-only → NEW bounded INI section-block reader for `.importlinter` (goes in `shared/declarations.mjs`).
- Privacy memo (empirically verified): numbers pass through `assertPrivacySafe` (`evidence.mjs:135`); SECRET regex `privacy.mjs:23` does not match "MIN_COVERAGE=85"; evidence records require `details === null` (`evidence.mjs:330`) but provider observation details accept numbers (`base.mjs:115-130`); `entry.count` already carries bounded ints; field names name/token/owner/... banned (`privacy.mjs:28`); voice terms include must/should/good/bad/strong but NOT grade/warning; `stripNonProse` masks backticks and table value cells but NOT first cells (`expansion-voice-gate.test.mjs:104-118`) — contract names containing "must" must be backticked.
- Real-file facts (verified): `.importlinter` has 13 contracts with space-containing names ("adapter must not import non-allowed layers", "Independence (cycles): formatting"); `lefthook.yml` has 2 top-level stages (pre-commit :28, pre-push :255) and 53 job names; `exit_codes.py` constants are bare uppercase (`SUCCESS`, `GENERAL_FAILURE` — NOT `EXIT_*`); gates.conf has `DISTANCE_THRESHOLD = 0.3` (float), `SEMGREP_SEVERITY = --severity ERROR --severity WARNING` (flags), `RADON_CC_GRADE = B`.
- Baseline: full suite 1100/1100 (~80s) at commit a387f69; tree clean.
- Prior plan patterns: `/home/jamiemills/.config/opencode/skills/csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md` (byte-identity enrichment tasks, reconciliation with independent review, verification-only baseline, real-repo probe).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| AD1 | NO new claims/categories/dimensions: all feedback items become new fact KINDS under existing claims/categories + conditional-absent byte-identity enrichments | Design decision | Track D: every item maps to an existing claim topic; reuse keeps 93/17/15 counts and CATEGORY_TOPIC_COVERAGE (98 rows) untouched; new kinds are invisible to the coverage table | Accepted |
| AD2 | Gate threshold VALUES retained as bounded numbers/slugs (policy change) | Design decision (user goal implies it) | Privacy memo: provably allowed; the goal requires values an agent cannot legally edit (gates.conf is edit-denied); contract comment + deliberate tests change | Accepted |
| AD3 | New practices parsers live in a new `deep/practices/style.mjs` pure module; the JSONC scrubber lifts to `shared/jsonc.mjs`; the INI section-block reader goes to `shared/declarations.mjs` | Design decision | Track B: model.mjs is 1080+ lines; scanner dispatch needs no surgery; the INI reader must be shared (architecture consumes it, not practices — M7) | Accepted |
| AD4 | Entry shape: one aggregated entry per artifact+signal (count = real total, kinds = deduped bounded SLUG tokens); maxKinds 32→256 | Design decision | Track B: make=120, lefthook=53, ruff≈86 exceed 32; aggregation is the house pattern; 256 fits assertDataOnly | Accepted |
| AD5 | Routing: ruff rules (all incl. select/ignore/per-file) → practices expanded-only; Makefile targets + line-length → practices expanded-only (legacy fixtures contain those artifacts); pytest markers → deep/testing.mjs (self-contained, byte-identity-safe); import-linter contracts → architecture (single home, conditional-absent + craft render); lefthook stages + gates values + deny rules + plugin inventory + conventions headings + exceptions hub → practices | Design decision | Track A routing + critique M6/M7/M10: fixtures absence verified; markers and importlinter single-homed; AD5 and tasks now agree | Accepted |
| AD6 | Declared-conventions extraction is heading-signal only (kinds = hyphenated heading slugs), never prose | Design decision | Track B + O20: free-form extraction is fragile; heading signals are bounded/deterministic; Goal discloses this scope | Accepted |
| AD7 | `.opencode/plugins/*.ts` conventions block NOT extracted; plugin inventory (names from opencode.jsonc) + deny rules substitute | Design decision | Track B (no TS-extraction idiom); plugin inventory now has an implementing action in T003 (M12) | Accepted |
| AD8 | Radon grade renders from practices gate values (the maintainability renderer only receives its model — cross-dimension data unavailable) | Design decision | Verified `render/registry.mjs:533`; maintainability renders only the aggregate complexity line | Accepted |
| AD9 | No supersession/baseline regeneration; `renderer.md` and `fixture-behavior.json` stay byte-identical | Architecture-forced | Track A: no proposed host file sits in legacy_locked entries; conditional-absent facts keep hashes stable | Accepted |
| AD10 | Plan saved in csm-scan `.agents/plans/` and committed to the skills monorepo | Evidence | All prior plans live there; branch main clean | Accepted |
| AD11 | Token rule: kinds are space-free slugs; static EXACT_PATHS kinds differ from content extractor kinds (no dedup collision) | Architecture-forced (critique B1/B2) | TOKEN_PATTERN `model.mjs:78`; first-wins dedup `model.mjs:320-326` + static-first `scanner.mjs:141-143` | Accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD1 | Which hosts are ten-dimension-shared vs expanded-only? | Read-only: existing-ten.mjs + render/existing-ten.mjs | No writes | Shared: config/testing/operations/conventions/git/architecture scanners AND renderers; expanded-only: practices, maintainability, architecture-craft | Routing (AD5) |
| RD2 | Do legacy fixtures contain the new artifacts? | Read-only: test/fixtures/*.mjs | No writes | shell HAS Makefile; python HAS ruff line-length + pytest testpaths (NO markers key); nothing else | Makefile/line-length expanded-only; markers byte-identity-safe |
| RD3 | Can existing parsers handle the targets? | /tmp/opencode/pxtest experiments on real-file copies | All writes in sandbox; repo untouched | parseToml full support; parseYamlShallow throws on block scalars (regex idiom); makefileExtractor exists; JSONC scrubber private; single-line readers insufficient for .importlinter | style.mjs design; shared INI reader; JSONC lift; lefthook jobs fix |
| RD4 | Is retaining gate values privacy-safe? | Read-only + in-memory simulations | In-memory only | assertPrivacySafe passes ints/tokens; SECRET mismatch; provider details accept numbers; voice terms exclude grade/warning; backticks/table cells mask prose but NOT first cells | Policy change is documentation + test flips; backtick rule for contract names |
| RD5 | Test-suite impact of reuse vs new claims? | Read-only grep of 93-sites, CATEGORY_TOPIC_COVERAGE, fixture assertions | No writes | 4 literal 93 sites; 98 coverage rows; exact-kind assertion `expansion-fixtures.test.mjs:408`; fixtures-expansion shell HAS Makefile → EXPECTED_STATUS flip | Reuse path; T007 reconciliation |
| RD6 | Shared-renderer change vs renderer.md/supersession? | Read-only: supersession entries + baseline tests | No writes | renderer.md locked in legacy_locked entry; unconditional shared-render changes forbidden | All shared-render changes conditional |
| RD7 | Token/slug + dedup feasibility? | Read-only + in-memory buildPracticesModel simulations | In-memory only | TOKEN_PATTERN rejects spaces → buildPracticesModel THROWS on space-containing kinds; static+extractor same matchedKey+path → static wins, content dropped | AD11: slug rule + distinct static/extractor kinds |
| RD8 | Real-file extraction targets? | Read-only reads of .importlinter/lefthook.yml/exit_codes.py/gates.conf | No writes | 13 space-named contracts; 2 stages + 53 jobs; bare uppercase exit constants; float + flags in gates.conf | T003/T005 action details (slugs, count rules, stage expectation) |

## Discovered Requirements
- Token rule: `kinds[]` tokens are `[\x21-\x7e]+` (no spaces); multi-word contract names/headings MUST be hyphenated slugs ("adapter-must-not-import-non-allowed-layers"); floats/grades as slug tokens ("0.3", "B"); raw `KEY=value` strings never emitted.
- Static/extractor dedup: `buildPracticesModel` keeps the FIRST entry on matchedKey+path; `classifyResult` pushes static hits first — static EXACT_PATHS kinds must differ from content kinds (static 'makefile' vs content 'make-targets'; static 'import-linter' vs architecture fact; static 'contributing' vs content 'declared-conventions').
- Conditional-absent facts: new ten-dimension findings keys must be ABSENT when the artifact is missing (coverage% = reported/total, `enrich.mjs:25-31`); precedent `config.mjs:544-554`, `testing.mjs:480-484`.
- Backtick/value-cell rule: strings containing voice terms (contract names contain "must") render backticked or in table value cells — `stripNonProse` masks those but NOT first cells (`expansion-voice-gate.test.mjs:104-118`).
- `EXACT_PATHS` keys must be lowercase ('makefile', 'gnumakefile', '.importlinter', 'contributing.md', '.github/contributing.md').
- `.importlinter` is a root dotfile: add to `PRACTICES_HIDDEN_FILES`? NO — it is now architecture-owned (M7): the architecture scanner must probe it explicitly (root dotfile not enumerated by rg).
- `lefthook.yml` has 2 top-level stages (pre-commit/pre-push) and 53 job names; nested `group.jobs` + `stage_fixed`; block scalars require the regex-over-YAML idiom.
- Banned field keys (`name`, `token`, `owner`, ...); avoid SECRET-shaped kind tokens.
- csm-build appends new discoveries each cycle and applies them to all remaining tasks.

## Design
Target behaviour: every NORMS.md run gains a comprehensive, value-carrying Style Guide & Conventions surface while the 17-dimension/93-claim contract stays frozen.

Fact flow (single homes; zero contract churn):
- practices (`deep/practices/style.mjs`, NEW pure module; wired via CATEGORY_EXTRACTORS):
  - ruff → style_guide `ruff-rules` (count=unique codes, kinds=deduped slug families+codes) + line-length/quote-style/dialect values (line-length int → count; dialect token)
  - Makefile → automation `make-targets` (count=targets, kinds=slug target names) — expanded-only (shell fixture)
  - lefthook → enforcement `hook-stages` (count=2 stages+53 jobs, kinds=['pre-commit','pre-push']) — fixes `.jobs` bug
  - gates.conf → quality_gate per-key entries (ints → count; floats/grades → slug kinds; SEMGREP_SEVERITY key-presence only)
  - opencode.jsonc → agent_workflow `deny-rules` (kinds=deny globs) + `opencode-plugins` (kinds=plugin names)
  - AGENTS.md/CONTRIBUTING.md → style_guide `declared-conventions` (kinds=hyphenated heading slugs) — heading-signal only
  - exceptions hub → style_guide `exceptions-hub` (basename pattern incl. exit_codes/exceptions/errors/error_handler; count=exception classes + bare uppercase constants)
- architecture (ten-dimension, conditional-absent fact + expanded-only render): `.importlinter` contracts via the shared INI reader → `importContracts` findings key (absent when no .importlinter; single home M7) rendered by `render/architecture-craft.mjs` as an "Import Contracts" subsection (names backticked).
- testing (ten-dimension, self-contained): `[tool.pytest.ini_options] markers` → conditional-absent `markers` fact (M6 — no style.mjs role); `quality/gates.conf` added to the diff-cover threshold scan sources (fixes `unverified` → 90).
- renderers: `render/practices.mjs` "Style Guide & Conventions" block (kinds/counts/values; values backticked/table cells); `render/config.mjs` conditional pyright-strict line; `render/testing.mjs` conditional marker-taxonomy line; `render/maintainability.mjs` aggregate median/p95/max complexity line (expanded-only).
- Foundations: `shared/jsonc.mjs` (lifted scrubber; architecture.mjs refactored, byte-identical); `shared/declarations.mjs` gains the INI section-block reader; `PRACTICES_LIMITS.maxKinds` 32→256; `QUALITY_GATE_ALLOWLIST` extended; EXACT_PATHS + PRACTICES_HIDDEN_FILES additions (lowercase, distinct static kinds); model privacy-contract comment updated.
- NO changes to: registry, contracts, provider catalogs, enrich/validate/write, supersession baselines, test-integrity.json.

Gap traceability (feedback → task/exclusion):
| Gap | Coverage |
|---|---|
| a gates values | T003 + T007 (policy) |
| b deny rule | T003 (deny-rules) |
| c pyright strict | T005 |
| d ruff rules | T003 |
| e importlinter contracts | T005 (architecture single home) |
| f lefthook stages | T003 |
| g markers + make map | markers T005; make map T003 |
| h AGENTS wiring | EXCLUDED (repo-side follow-up) |
| i Google dialect | T003 (ruff pydocstyle) |
| j aggregate complexity + radon grade | T006 (aggregate); radon grade T003 (gate value) |
| N1 dual dev-deps | EXCLUDED (stack is ten-dimension; rendering both dev sets would risk the freeze — recorded as follow-up) |
| N2 S101 per-file scope | T003 (per-file-ignores) |
| N3 diff-cover unverified | T005 (gates.conf source) |
| N4 FAIL_UNDER mirror | T003 (failunder gate value rendered; semantics disclosed via the value row) |
| N5 ratchet discipline | PARTIAL — ratchet/baseline inventory already renders; behavioural semantics EXCLUDED (not statically declarable) |
| N6 deny/permission contract | T003 (deny-rules + plugins) |
| N7 conventions block | PARTIAL — heading signals (AD6/AD7); prose EXCLUDED |
| N8 uv floors | Stack already renders dep floors; EXCLUDED for this wave |
| N9 make-command map | T003 (make-targets) |
| N10 marker semantics | T005 (markers fact) |
| N11 mutmut policy | EXCLUDED (mutmut ignore manifest is test-lane detail; mutation jobs already render) |
| N12 exceptions hub / exit codes | T003 (exceptions-hub) |
| N13 independence contracts | T005 (all 13 importlinter contracts) |
| N14 semgrep/gitleaks policies | EXCLUDED (rules-scope prose; tool presence + audit refs already render) |
| N15 vulture_whitelist | EXCLUDED (vulture config renders; whitelist file presence not a style rule) |
| N16 py.typed/__all__ | EXCLUDED (export inventory already renders in API Surface) |
| N17 ci-* targets | PARTIAL — make-targets includes ci-* targets |

## Execution Graph
```
G0  T001 baseline gate
G1  T002 style-engine foundations   <- T001
G2  T003 style parsers module       <- T002
    T005 ten-dim byte-identity      <- T002   (architecture.mjs sequencing, M5)
    T006 maintainability aggregate  <- T001
G3  T004 practices renderer         <- T003
    T007 suite reconciliation       <- T003,T005,T006   (independent review)
G4  T008 final gate + SKILL.md      <- T004,T007
```
Critical path: T001 → T002 → T003 → T004 → T008.
Parallel groups: G2 {T003,T005,T006} disjoint (T003: practices style.mjs/model/scanner + expansion-practices.test.mjs; T005: render/config.mjs, deep/testing.mjs, deep/architecture.mjs, render/architecture-craft.mjs + their tests; T006: render/maintainability.mjs + expansion-maintainability.test.mjs). G3 {T004,T007} disjoint (T004: render/practices.mjs + render/registry.mjs; T007: expansion-fixtures.test.mjs + review). Shared-file ownership: `model.mjs`/`scanner.mjs` → T002 then T003 (sequential); `architecture.mjs` → T002 (scrubber lift) then T005 (importlinter fact) — T005 depends on T002; `expansion-practices.test.mjs` → T002 (foundations), T003 (extractors + policy flips), T007 (review only, no edits unless findings).

## Numbered Plan
1. [pending] Baseline gate
   - Task ID: T001
   - Depends on: none
   - Parallel group: G0
   - Risk: low
   - Owned scope: none (verification only)
   - Not in scope: any file changes
   - Spike candidate: none
   - Actions: Run `node --test --test-concurrency=1`; verify 100% pass (planning baseline 1100/1100 at a387f69); confirm `git status` clean.
   - Acceptance signal: `node --test --test-concurrency=1` exits 0 with 1100 passing, 0 failing.
   - Validation: `git status --short` clean.
   - Acceptance evidence: journal entry with pass count and clean-tree confirmation.
   - Repair attempts: 0
   - Recovery note: any failure or dirty tree stops the run — report rather than proceed.

2. [pending] Style-engine foundations
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `lib/scan/shared/jsonc.mjs` (NEW — lifted scrubber), `lib/scan/deep/architecture.mjs` (refactor to import the lifted scrubber — behavior byte-identical), `lib/scan/shared/declarations.mjs` (NEW bounded INI section-block reader for `.importlinter`), `lib/scan/deep/practices/model.mjs` (PRACTICES_LIMITS.maxKinds 32→256, QUALITY_GATE_ALLOWLIST extension, lowercase EXACT_PATHS additions with DISTINCT static kinds, PRACTICES_HIDDEN_FILES addition, privacy-contract comment update), `test/expansion-practices.test.mjs` (foundations cases)
   - Not in scope: style.mjs parsers (T003), renderers (T004), ten-dimension fact enrichment (T005), registry/contracts (frozen)
   - Spike candidate: none — scrubber lift, INI reader shape, and allowlist extension verified in RD3/RD4/RD7
   - Actions: (a) create `shared/jsonc.mjs` exporting `stripJsonComments` + `removeJsonTrailingCommas` + `readJsonc` (lifted from architecture.mjs:79-142) and refactor `architecture.mjs` to import them — architecture tests must stay green (byte-identical); (b) `PRACTICES_LIMITS.maxKinds` 32→256 (no test asserts 32 — verified; just the constant); (c) extend `QUALITY_GATE_ALLOWLIST` with: maxflagged, distancethreshold, mincoverage, failunder, minconfidence, radonccgrade, radonmigrade, filesizecap, semgrepseverity, diffcoveragethreshold (keep existing entries); (d) EXACT_PATHS additions (all lowercase, DISTINCT static kinds so they never collide with T003 content kinds): `makefile`/`gnumakefile` → automation kind `makefile` (content kind will be `make-targets`), `contributing.md`/`.github/contributing.md` → style_guide kind `contributing` (content kind `declared-conventions`); add `.importlinter` to PRACTICES_HIDDEN_FILES is NOT needed (architecture-owned — instead note in T005); (e) update the model privacy-contract comment (model.mjs:11-17) to the new values rule; (f) update `test/expansion-practices.test.mjs` foundations cases (limits, allowlist, EXACT_PATHS).
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs test/architecture.test.mjs test/expansion-architecture-extension.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/regression-parity.test.mjs test/fixtures-pipeline.test.mjs` still pass (architecture refactor byte-identical; fixture hashes unchanged).
   - Acceptance evidence: targeted-run outputs; diff of the model comment + limits recorded.
   - Repair attempts: 0
   - Recovery note: architecture hash regressions surface in fixtures-pipeline/architecture tests — revert the scrubber lift if behavior changed; partial model edits detectable by limit/allowlist test failures.

3. [pending] Style parsers module
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: standard (token/slug discipline + it lands the deliberate policy flips green)
   - Owned scope: `lib/scan/deep/practices/style.mjs` (NEW), `lib/scan/deep/practices/model.mjs` (lefthookCommands `.jobs` fix + wiring), `lib/scan/deep/practices/scanner.mjs` (CATEGORY_EXTRACTORS wiring), `test/expansion-practices.test.mjs` (extractor cases AND the deliberate gate-value policy flips its production change causes)
   - Not in scope: renderers (T004), markers + importlinter (T005, single-homed), registry/contracts (frozen)
   - Spike candidate: prove the lefthook regex-over-YAML stage extraction (2 top-level stages pre-commit/pre-push, 53 job names, nested `group.jobs`, `stage_fixed`) and the slug encoder for multi-word names against copies of the real files in `/tmp/opencode`; expected: `['pre-commit','pre-push']` + job count 53 extracted without throws; nothing written outside the sandbox.
   - Actions: (a) `style.mjs`: pure extractors per the Design — ruff (parseToml walker over select/ignore/per-file-ignores/line-length/quote-style/pydocstyle convention; one `style_guide:ruff-rules` entry, count=unique codes, kinds=slug families+codes; line-length int → count; dialect token), Makefile targets (makefileExtractor idiom, count + capped slug kinds), lefthook stages (regex-over-YAML; fixes the `.commands`-key bug — parse `.jobs` incl. nested `group.jobs` and `stage_fixed`; `enforcement:hook-stages`, kinds=['pre-commit','pre-push'], count=stages+jobs), gates.conf values (per-key entries: ints → count, floats/grades → slug kinds e.g. '0.3','B'; SEMGREP_SEVERITY key-presence only; allowlist from T002), opencode deny rules + plugin inventory (JSONC read via shared/jsonc.mjs; `permission.edit` deny globs → kinds; `plugin` list names → kinds), declared-conventions headings (AGENTS.md/CONTRIBUTING.md heading-signal → hyphenated slug kinds), exceptions hub (basename pattern `(?:exit_codes|exceptions|errors|error_handler)\.py`; count=exception classes + bare uppercase constant lines); ALL multi-word kinds hyphenated slugs per the token rule; (b) wire into `scanner.mjs` CATEGORY_EXTRACTORS; (c) fix `lefthookCommands` (model.mjs:788-817) to parse `.jobs` + nested groups; (d) extend `test/expansion-practices.test.mjs`: extractor cases (real-file-derived fixtures), slug/space-rejection cases, AND flip the deliberate policy assertions its production change invalidates — the aggregated `quality_gate:gate-thresholds` matchedKey find (~372-374), the '85'-never-survives assertions (~282-300, ~375) → now assert `MIN_COVERAGE=85` renders as count 85 and `RADON_CC_GRADE=B` as a kind slug, and a `token=...` value still never survives; keep the privacy canary.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-practices.test.mjs` passes 100% (WITH the flipped policy assertions green — T003 lands its own consequences).
   - Validation: `node --test --test-concurrency=1 test/expansion-detection.test.mjs` still passes; spike results recorded.
   - Acceptance evidence: targeted-run outputs; per-extractor entry samples (ruff count, hook stages, gate value entries incl. count 85 and slug 'B').
   - Repair attempts: 0
   - Recovery note: a space-containing kind throws `INVALID_DETAILS` — the slug encoder must cover every multi-word source; the lefthook fix must keep degrade-to-unverified for unparseable hook configs.

4. [pending] Practices renderer: comprehensive Style Guide & Conventions
   - Task ID: T004
   - Depends on: T003
   - Parallel group: G3
   - Risk: standard
   - Owned scope: `lib/scan/render/practices.mjs`, `lib/scan/render/registry.mjs` (practices prose list), `test/expansion-render-registration.test.mjs` (if prose snapshot changes)
   - Not in scope: other renderers (T005/T006), ten-dimension renderers (frozen unless conditional), registry/contracts
   - Spike candidate: none — voice-term collisions verified absent in RD4 (grade/warning not in the vocabulary; backtick/value-cell rule applies)
   - Actions: (a) `render/practices.mjs`: extend the category groups to render kinds/counts/values in addition to paths — a "Style Guide & Conventions" block: ruff families + line-length + dialect, make targets, lefthook stages, gate thresholds table (key | value, values backticked or in value cells), deny rules + plugins, declared-conventions headings, exceptions hub; keep the path inventory; neutral prose, no voice terms in headings/first cells; (b) `render/registry.mjs` practices prose list extended with the new subsection headings; (c) update `test/expansion-render-registration.test.mjs` only if the prose snapshot changes.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-render-registration.test.mjs test/expansion-voice-gate.test.mjs test/expansion-privacy-gate.test.mjs` passes 100%.
   - Validation: manual render of the Style Guide block against the voice-term list; CLI smoke on a synthetic fixture (paths under /tmp/opencode) renders values.
   - Acceptance evidence: targeted-run outputs; the rendered Style Guide sample; voice/privacy confirmations.
   - Repair attempts: 0
   - Recovery note: voice-gate failures pinpoint the offending heading/term — backtick it or reword; privacy failures pinpoint a leaked raw value — move to count/kinds.

5. [pending] Ten-dimension byte-identity enrichments
   - Task ID: T005
   - Depends on: T002 (architecture.mjs sequencing — M5)
   - Parallel group: G2
   - Risk: standard (byte-identity discipline; stop-and-report rule)
   - Owned scope: `lib/scan/render/config.mjs` (conditional pyright-strict line), `lib/scan/deep/testing.mjs` (marker taxonomy fact — self-contained parse of `[tool.pytest.ini_options] markers`; gates.conf as a diff-cover threshold source), `lib/scan/render/testing.mjs` (conditional marker-taxonomy line), `lib/scan/deep/architecture.mjs` (`.importlinter` contracts fact via the shared INI reader — conditional-absent key, SINGLE home), `lib/scan/render/architecture-craft.mjs` (Import Contracts subsection — names backticked), their tests (`test/config.test.mjs`, `test/testing.test.mjs`, `test/expansion-architecture-extension.test.mjs`)
   - Not in scope: practices renderer (T004), style.mjs (T003), registry/contracts (frozen), any unconditional shared-renderer change, baseline regeneration
   - Spike candidate: none — conditional-absent patterns proven and fixture absence verified in RD2
   - Actions: (a) `render/config.mjs`: conditional pyright `strict`/`typeCheckingMode` line (fact computed at deep/config.mjs:522-533; line absent when no pyright); (b) `deep/testing.mjs`: parse `[tool.pytest.ini_options] markers` into a conditional-absent `markers` fact (NOT via style.mjs — self-contained); add `quality/gates.conf` to the diff-cover threshold scan sources (fixes `fail_under=unverified` → 90); (c) `render/testing.mjs`: conditional marker-taxonomy line gated on the new fact (absent in all five fixtures; do NOT gate on existing rust `#[test]` facts); (d) `deep/architecture.mjs`: `.importlinter` contract fact (13 contracts via the shared INI reader; conditional-absent key `importContracts`); (e) `render/architecture-craft.mjs`: "Import Contracts" subsection rendering contract names BACKTICKED (they contain voice terms like "must" — first cells must stay clean); (f) update the owned tests.
   - Acceptance signal: `node --test --test-concurrency=1 test/config.test.mjs test/testing.test.mjs test/expansion-architecture-extension.test.mjs` passes 100% AND `node --test --test-concurrency=1 test/fixtures-pipeline.test.mjs test/regression-parity.test.mjs test/expansion-production-pipeline.test.mjs test/expansion-baseline.test.mjs` ALL pass (byte-identity batch is part of the acceptance).
   - Validation: voice gate + privacy gate still pass.
   - Acceptance evidence: targeted-run outputs; per-change conditional-absent confirmation (fixtures unaffected); diff-cover value sample; contract-fact sample.
   - Repair attempts: 0
   - Recovery note: a fixture-hash failure means an unconditional change slipped in — identify the line, make it conditional, re-run; the stop-and-report rule forbids baseline regeneration.

6. [pending] Maintainability aggregate complexity line
   - Task ID: T006
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: `lib/scan/render/maintainability.mjs`, `test/expansion-maintainability.test.mjs`
   - Not in scope: radon grade (renders from practices gate values, AD8), other renderers
   - Spike candidate: none
   - Actions: (a) `render/maintainability.mjs`: render a repo-wide aggregate line from the existing `complexityRecords` per-function values — total functions, median, p95, max (nearest-rank, reusing the model's distribution helpers); keep the per-file table; (b) extend `test/expansion-maintainability.test.mjs` with an aggregate-assertion case.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-maintainability.test.mjs` passes 100%.
   - Validation: `node --test --test-concurrency=1 test/expansion-voice-gate.test.mjs test/expansion-privacy-gate.test.mjs` still pass (maintainability is expanded-only).
   - Acceptance evidence: targeted-run output; aggregate line sample.
   - Repair attempts: 0
   - Recovery note: deterministic nearest-rank stats must be stable — if the determinism gate fails, the aggregation order is wrong.

7. [pending] Suite reconciliation (requires independent review)
   - Task ID: T007
   - Depends on: T003, T005, T006
   - Parallel group: G3
   - Risk: standard (independent review required — reviews the deliberate gate-value policy flips)
   - Owned scope: `test/expansion-fixtures.test.mjs` (EXPECTED_STATUS + exact-kind + boundary assertions), review of the policy flips T003 landed in `test/expansion-practices.test.mjs`, any determinism/scan-cli touches
   - Not in scope: production code, registry/contracts, baselines; the policy flips themselves are landed by T003 (its green gate) — T007 REVIEWS them
   - Spike candidate: none — the shell-fixture flip and kind-exactness sites are enumerated in RD5
   - Actions: (a) `expansion-fixtures.test.mjs`: update EXPECTED_STATUS rows — the fixtures-expansion shell fixture HAS a Makefile → practices automation make-targets becomes observed (flip the shell row + the not_detected loop); extend the practices rows for the new kinds (observed cases); update the exact-kind assertion (~408) to the per-key gate structure (REPLACE, not augment — the aggregated `gate-thresholds` entry is replaced by per-key entries; verify the fixture gates.conf carries the new keys and add a `RADON_CC_GRADE=B` case to the fixture if needed); extend boundary assertions (style_guide kinds must not collide with config tool names; automation make-targets vs operations Makefile presence); (b) REVIEW the deliberate policy flips in `test/expansion-practices.test.mjs` (the '85' assertions now expect bounded values) — confirm they are policy-documented (AD2/RD4), not test weakening; (c) any determinism/scan-cli drift from new renderer subsections.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs test/expansion-practices.test.mjs test/expansion-determinism.test.mjs test/scan-cli.test.mjs` passes 100%.
   - Validation: `test/expansion-final-acceptance.test.mjs test/expansion-activation.test.mjs test/expansion-constraints.test.mjs` still pass (93 claims unchanged).
   - Acceptance evidence: per-file deltas; review sign-off on the policy flips recorded in the journal.
   - Repair attempts: 0
   - Recovery note: a hash failure means a production change drifted — reconcile the fixture, not the production claim; the policy flips must be reviewed as deliberate changes, not test weakening.

8. [pending] Final gate: full suite, SKILL.md, real-repo probe
   - Task ID: T008
   - Depends on: T004, T007
   - Parallel group: G4
   - Risk: standard
   - Owned scope: none (verification + `SKILL.md` doc update + stale-comment housekeeping)
   - Not in scope: production code
   - Spike candidate: none
   - Actions: (a) full suite `node --test --test-concurrency=1` — 100% pass, count ≥ 1100 + new tests; (b) `SKILL.md`: document the comprehensive Style Guide & Conventions output (practices description, maintainability aggregate, config/testing/architecture enrichments) — acceptance: `rg 'Style Guide|declared conventions|markers|import contracts' SKILL.md` shows the rows; (c) stale-comment housekeeping: update `deep/practices/model.mjs:3` and `render/practices.mjs:3` ownership comments to this plan's tasks, and `run.mjs:242` "16-dimension" → 17; (d) real-repo probe: `node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli --out /tmp/opencode/style-probe.md` — verify AC2's fact checklist (ruff families + line-length + dialect, make targets, lefthook stages, gate values incl. MIN_COVERAGE=85/RADON_CC_GRADE=B/FILE_SIZE_CAP=1000/DIFF_COVERAGE_THRESHOLD=90/DISTANCE_THRESHOLD=0.3, deny rules + plugins, conventions headings, exceptions hub, pyright strict, markers, aggregate complexity, import contracts, `{"expected":93,"eligible":93,"complete":93,"ratio":1}`, practices NOT in SCANNER_FAILURE); (e) neutral-voice + no-secrets scan of the probe.
   - Acceptance signal: full suite exits 0 with 0 failures AND the probe satisfies AC2 AND the coverage line is `{"expected":93,...}`.
   - Validation: `git status --short` shows only this execution's changes; SKILL.md rg acceptances.
   - Acceptance evidence: full-suite summary, probe NORMS.md path + fact checklist, coverage line.
   - Repair attempts: 0
   - Recovery note: any failing test or missing probe fact loops to the owning task (T002-T007); record the exact failure before returning to SELECT.

## Verification Strategy
Ordered cheapest-first:
- Per-task gates: T002 (practices+architecture+architecture-extension), T003 (practices+detection), T004 (render-registration+voice+privacy), T005 (config+testing+architecture-extension THEN the byte-identity batch as acceptance: fixtures-pipeline, regression-parity, production-pipeline, baseline), T006 (maintainability), T007 (fixtures+practices+determinism+scan-cli), T008 (full suite + probe).
- Expensive batch gates: T005's byte-identity acceptance batch; the full suite at T001/T008 (~80s) — authoritative with `--test-concurrency=1`.
- Final gates: full suite + real-repo probe at T008; voice/privacy/determinism/constraints all included in the full suite.
- Parallelism: G2 {T003,T005,T006} and G3 {T004,T007} run concurrently within their groups; per-task gates may run in parallel (disjoint files); the full suite is serial.
- Known environment sensitivity: none identified; the golden test scans the real perplexity-cli repo read-only.

## Risks And Recovery
| Risk | Mitigation | Recovery |
|---|---|---|
| R1 Byte-identity break in ten-dimension tasks | Conditional-absent facts only; byte-identity batch IN T005's acceptance; artifact-absence inventory (RD2) | Identify the unconditional line; make conditional; re-run the batch; never regenerate |
| R2 Space-token rejection / dedup collision (critique B1/B2) | Token rule (slug encoder) + distinct static/extractor kinds (AD11); T003 cases cover both | A throw surfaces as SCANNER_FAILURE — find the un-slugged source; a dropped content entry surfaces in the probe — rename the static kind |
| R3 Gate-value policy change misread as test weakening | Flips landed by the causing task (T003) with its green gate; T007 independently reviews | Review sign-off; record rationale per flipped assertion |
| R4 Parser fragility (lefthook block scalars, importlinter continuations, markdown headings) | Proven idioms (regex-over-YAML, shared INI reader, heading signals only); spike in T003; degrade-to-unverified | Adjust the extractor; never fabricate facts; keep degrade-to-unverified |
| R5 maxKinds raise ripples | Checked: assertDataOnly maxArray 4096; no test asserts 32 | Revert the raise if a bound test fails elsewhere |
| R6 Voice-gate collision (contract names contain "must") | Backtick/value-cell rule in T005 action (e) and T004; acceptance includes the voice gate | Backtick the offending token; re-run voice gate |
| R7 Privacy leak via value retention | Values restricted to allowlisted keys via count/slug kinds; privacy canary kept; T007 reviews policy flips | Move leaked values to count/kinds or drop the key |
| R8 Registry/contract churn (goal says frozen) | AD1 enforced; T007 validates 93/17/15 unchanged | Revert any contract edit; re-run contracts/registration tests |
| R9 Double-owned architecture.mjs (T002 refactor + T005 fact) | T005 depends on T002 (M5) | If collided, complete T002 first and rebase T005's edits |
| R10 Interrupted task state | Per-task recovery notes; journal checkpoints | Resume at RECOVER; re-run the interrupted task's acceptance |

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| B1: kinds tokens reject spaces — real contract names/headings throw SCANNER_FAILURE | Blocker | Token rule (AD11): hyphenated slugs for all multi-word kinds; slug encoder in style.mjs; T003 cases cover space rejection | TOKEN_PATTERN model.mjs:78; .importlinter:6; CONTRIBUTING.md:3 |
| B2: static EXACT_PATHS kind collides with extractor kind — content dropped by first-wins dedup | Blocker | Distinct static vs content kinds (static 'makefile'/'contributing' vs content 'make-targets'/'declared-conventions'); T002 action (d) corrected | scanner.mjs:141-143 + model.mjs:320-326 |
| M3: gate values not implementable for floats/flags | Major | Floats/grades → slug kinds ('0.3','B'); SEMGREP_SEVERITY key-presence only (exclusion); AC2 updated | gates.conf DISTANCE_THRESHOLD/SEMGREP_SEVERITY |
| M4: T003's production change breaks policy assertions it doesn't own — its acceptance would fail | Major | T003 lands its own flips (aggregated gate-thresholds find, '85' assertions) green; T007 reviews | expansion-practices.test.mjs:282-300,372-375 |
| M5: architecture.mjs double-owned, sequencing undeclared | Major | T005 depends on T002; graph + shared-file notes updated | Execution Graph |
| M6: T005 undeclared dependency on T003 for markers | Major | Marker parse self-contained in deep/testing.mjs; style.mjs has no marker role | Design + T005 action (b) |
| M7: import-contracts dual-homed (practices + architecture) | Major | Single home = architecture (conditional-absent fact + craft render); practices excludes importlinter; shared INI reader in shared/declarations.mjs | AD5 + Exclusions |
| M8: no per-gap traceability for the 27 items | Major | Gap→task/exclusion table added to Design | Design traceability table |
| M9: T007 scope mis-describes gate-test restructure | Major | Replace-vs-augment stated (per-key REPLACES aggregated); full assertion set enumerated; fixture gains RADON_CC_GRADE case | T007 actions |
| M10: AD5 routing inconsistent with tasks | Minor | AD5 corrected: ALL ruff facts → practices; markers + importlinter single-homed | AD5 |
| M11: exit_codes constants not EXIT_* | Minor | Count bare uppercase constant lines; pattern includes exit_codes.py | exit_codes.py:17-25 |
| M12: plugin inventory has no action | Minor | T003 extracts opencode.jsonc `plugin` names → kinds | opencode.jsonc:28-32 |
| M13: lefthook "4 stage groups" wrong | Minor | Spike/actions corrected: 2 top-level stages + 53 jobs | lefthook.yml:28,255 |
| M14: T003 large | Observation | Kept atomic (single module, one owner); blast radius noted in R4 | — |
| M15: T005 acceptance excludes its core risk | Minor | Byte-identity batch moved INTO T005's acceptance signal | T005 |
| M16: voice masking for contract names unspecified | Minor | Backtick/value-cell rule stated in T005 action (e) + T004 | stripNonProse first-cell behaviour |
| M17: stale ownership comments | Minor | T008 housekeeping action (model.mjs:3, render/practices.mjs:3, run.mjs:242) | T008 action (c) |
| M18: EXACT_PATHS keys must be lowercase | Minor | T002 action (d) uses lowercase keys | classifyPracticePath model.mjs:685-687 |
| M19: factual slips (maxKinds test, isCandidatePath line) | Minor | Corrected in Current-State Evidence | — |
| O20: heading-only conventions undersell the goal | Observation | Goal/Deliverables disclose heading-signal scope; AC2 matches; prose excluded | AD6 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | INTAKE | — | Ask classified: large, prescriptive (deep-assessment is the requirements document); goal: comprehensive Style Guide & Conventions in every NORMS.md run | DISCOVER |
| 2026-08-03 | 0 | DISCOVER | — | Skills repo verified (clean, a387f69, 1100/1100); uncertainty scout folded into the four research tracks | RESEARCH |
| 2026-08-03 | 0 | RESEARCH | — | 4 parallel tracks: freeze map/routing (RD1-2), parser feasibility with /tmp experiments (RD3), privacy memo with simulations (RD4), test impact (RD5-6); all evidence-backed | DRAFT |
| 2026-08-03 | 0 | DRAFT | — | 8 tasks, 4 groups; reuse-only; style.mjs; gate-value policy (AD2); ten-dimension byte-identity enrichments | CRITIQUE |
| 2026-08-03 | 0 | CRITIQUE | — | Hostile review: 2 blockers (space-token rejection B1; static/extractor dedup B2), 8 majors (M3-M9 + float/flags + double-owned architecture + markers dep + importlinter dual-home + traceability + policy-flip ownership), 9 minors, 2 observations — all evidence-backed | REMEDIATE |
| 2026-08-03 | 0 | REMEDIATE | — | All findings resolved: token rule + distinct static kinds (AD11); single homes for markers/importlinter (M6/M7); T005←T002 (M5); T003 lands its policy flips (M4); floats→slugs (M3); gap traceability table (M8); byte-identity batch in T005 acceptance (M15); lowercase EXACT_PATHS (M18); plugin inventory action (M12); lefthook 2-stage expectation (M13); housekeeping in T008 (M17); factual slips corrected (M19) | VERIFY |
| 2026-08-03 | 0 | VERIFY | — | Primary-agent verification: AC1-AC5 map to tasks; every task has runnable acceptance/risk/anti-scope; ownership sequencing declared (model.mjs T002→T003; architecture.mjs T002→T005); counts 93/17/15 unchanged; token rule enforced | SAVED |
| 2026-08-03 | 0 | SAVED | — | Plan committed to skills monorepo; implementation NOT started | STOP |

## Completion Review
<filled by csm-build when all criteria are verified>
