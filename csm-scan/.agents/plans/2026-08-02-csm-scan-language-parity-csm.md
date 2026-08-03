# csm-scan Language-Parity Hardening CSM Plan

## How To Execute
- Start work only through a separate, explicit `csm-build` invocation naming this plan; this planning session did **not** begin execution.
- Commit policy and live state are maintained in Control by `csm-build`.
- This plan builds on the completed `2026-08-02-csm-scan-overhaul-csm.md` (the foundational overhaul). It does NOT redo foundation work; it deepens/corrects the 5 language paths to parity.
- Risk summary: **3 high-risk tasks** (T104 architecture import-graph, T108 conventions, T112 fixtures/regression) always benefit from independent review; **8 standard**; **2 low**. T104 owns the single highest-conflict file (`architecture.mjs`); all import-graph work is consolidated there to avoid write overlap.

## Control
- Plan ID: `csm-scan-language-parity`
- Status: completed
- Current CSM state: COMPLETE
- Cycle: 10
- Commits: disabled (skill directory is not a git repository; A5)
- Last checkpoint: 2026-08-02 parity cycle 10 — T127-T129 done; definitive 309/309 full and 88/88 final acceptance tests; real perplexity-cli pipeline clean; both independent reviewers PASS with no material findings.
- Next transition: none (complete)
- Active tasks: none
- Blockers: none

## Goal
Bring **Python, JavaScript, TypeScript, Shell, and Rust** to **equal breadth, depth, and thoroughness** in `csm-scan`, by fixing every P0 correctness defect and implementing the P1 depth/breadth and P2 polish gaps identified in the adversarial review — so that `NORMS.md` is a genuinely comprehensive audit of practices, architecture, processes, and tools for any of the five ecosystems.

**Stance — neutral factual voice (non-negotiable):** `NORMS.md` must describe **how the repo IS**, as observed facts. It must **not** assess how things are critically: no judgment, grading, or critique of the repo. Concretely: report presence and absence as facts ("X is present" / "no X found"); co-existing facts are stated as co-existing facts, **not** as "contradictions" or problems; no severity-of-issue framing; no "should/must/ought/poor/good/bad/weak/strong/recommended/anti-pattern". Meta-scores describe **scan detection-coverage** (how much was observed) and **epistemic basis** (observed/inferred/unverified), never repo quality.

### Deliverables
1. **Accurate import graph for all 5 languages** (the review's weakest dimension): TS `import type` no longer a runtime edge; JS/TS path-alias resolution; Python multi-line + PEP 420 namespace + multi-package resolution; Rust `mod foo;` (edition-2018 file-as-dir), `use self::`/`super::`, external-vs-internal discrimination, crate-root distinction.
2. **Language-generic cross-cutting detection**: C4 DBs/external-APIs, security auth/validation/rate-limit, operations monitoring tables populated for all 5 ecosystems (currently JS/Python-only).
3. **Complete manifest normalization**: JS (`main`/`module`/`exports`/`engines`/`peerDependencies`/`workspaces`/`imports`), Rust (`[workspace]`/`[features]`/`[build-dependencies]`/`[lib]`/`rust-version`/`edition`), Python (PEP 735 `[dependency-groups]`, `requirements*.txt` content, `[project.gui-scripts]`/`[project.entry-points]`).
4. **Monorepo support**: JS workspaces, TS project references, Rust `[workspace].members`, Python multi-package — with bare-import → internal-package edge resolution.
5. **Conventions depth**: symbol-level naming, async/await, custom exceptions, `set -euo pipefail` adoption + shebangs (Shell), `unsafe` (Rust), `Option`/`unwrap`/`anyhow`/`thiserror` (Rust), type-hint posture (Python), annotation density (TS); consistent comment-density across `conventions` & `documentation`.
6. **Expanded tooling breadth (P2)**: additional linters/formatters/type-checkers/test frameworks, ecosystem markers, lockfile completeness, robust runtime probes.
7. **Regression fixtures + tests** guarding every P0 scenario.
8. **Neutral factual voice**: the pipeline reports observations as facts — "contradictions" reframed as neutral cross-observations of co-existing facts (no severity), scores presented as factual detection-coverage (not repo-quality grades), and a **voice-gate test** that fails the build if any judgmental terminology appears in the rendered `NORMS.md`.

### Constraints (unchanged from SKILL.md)
- Zero npm dependencies (`node:` builtins + read-only `rg`/`git`/`find`); single `writeFile` for scanner output; read-only vs scanned repos; ESM `.mjs`.

### Exclusions
- No new ecosystems beyond the 5 (Go/Ruby/etc. remain documented stubs).
- No pipeline-**shape** change (`survey→deep→enrich→validate→write` preserved; data contract `{dimension,signal,findings}` preserved). The **presentation/voice** of `enrich`/`validate`/`write` IS in scope (neutral factual output) — this changes wording/scoring semantics, not the call graph.
- No replacement of the shared foundation built in the prior plan.

## Acceptance Criteria
1. **Import-graph accuracy (per language)** — verified by new regression tests: TS fixture with `import type` + path aliases + `.d.ts` yields correct edges (type-only dropped, aliases resolved, `.d.ts` excluded); JS fixture with `bun.lock` + workspace bare-import resolves the internal edge; Python fixture with multi-line `from pkg import (a,b)` + a PEP 420 namespace package yields >0 edges; Rust fixture with nested `mod` + `use self::`/`super::` + a `#[workspace]` resolves member edges; Shell `source` graph unchanged. All 5 fixtures: no false edges.
2. **Generic cross-cutting tables** — a Rust fixture using `sqlx`+`tracing`+`argon2` renders C4 DB + monitoring + security-auth nodes; a Python fixture using `SQLAlchemy`+`sentry-sdk`+`pydantic` likewise. Neither renders JS-only nodes.
3. **Manifest completeness** — tests assert JS `exports`/`engines.node`/`workspaces`, Rust `[workspace].members`/`[features]`/`rust-version`, and Python PEP 735 dev-deps + `requirements.txt` deps are all surfaced into the normalized manifest and visible to downstream scanners (security/testing/stack).
4. **Monorepo** — a JS workspaces fixture and a Rust workspace fixture each resolve ≥1 internal cross-package edge.
5. **P0 defects eliminated** — one regression test per P0 item (the 21 from the review) passes; in particular `conventions` comment-density equals `documentation` comment-density for Python and Rust samples.
6. **Conventions depth** — per language, at least: symbol-level naming dominant, async/await count (JS/TS/Python/Rust), custom-exception count, Shell `pipefail`-adoption %, Rust `unsafe` count, Python type-hint %.
7. **P2 breadth** — ecosystem markers (`py.typed`, `MANIFEST.in`, `.python-version`, `.cargo/config.toml`, `rust-toolchain.toml`, `deno.json`, `bunfig.toml`, `jsconfig.json`), additional tools (semgrep, pytype/pyre, standard/jshint/oxlint, dprint, autopep8/yapf/blue, bashate, shellspec/shunit2, proptest/quickcheck/trybuild/rstest/criterion/mockall/insta), lockfile completeness (`pdm.lock`, npm lockfileVersion, yarn berry `.yarnrc.yml`), runtime robustness (`python` fallback, `cargo --version`, `deno`/`bun` probes) all implemented with descriptor/test coverage.
8. **Full suite green + real-repo smoke** — `node --test test/` all pass (target ≥150 tests); full pipeline runs clean on `~/code/projects/perplexity-cli`; if a real Rust/JS repo is available locally it runs clean too.
9. **Neutral factual voice (voice gate)** — for every fixture and for perplexity-cli, the rendered `NORMS.md` contains **no judgmental terminology** (a `test/voice-gate.test.mjs` asserts absence of: should, must, ought, shall, poor, good, bad, weak, strong [as grading], better, worse, best, worst, recommended, ideally, unfortunately, concern, problem, anti-pattern, smell, suboptimal, inadequate, contradiction, inconsistent, conflict, lacking — with an allowlist for legitimate technical terms like "strongly typed"/"critical section"/quoted commands). "Contradictions" render as neutral cross-observations of co-existing facts (no severity); the per-section meta line reports factual **Coverage** + epistemic **basis**, not Cohesion/Signal grades.

## Current-State Evidence
Source: adversarial review `../docs/csm-scan-review-2026-08-02.md` (5 language reviewers, file:line evidence). Baseline: 118 tests pass. Key defects by location:

- **Import graph (weakest dimension):** `import type` emitted as runtime edge — `architecture.mjs:327-333` + `ecosystem.mjs:248`; path aliases unresolved — `architecture.mjs:236-244,328-333`, `config.mjs:249` (paths reduced to boolean); Python multi-line imports/namespace packages — `architecture.mjs:201,301-326`; Rust `mod foo;` nested wrong + `use self::`/`super::` absent — `architecture.mjs:260-271,334-345`, `ecosystem.mjs:316-319`.
- **Cross-cutting tables JS/Python-only:** C4 DBs/APIs — `architecture.mjs:510-557`; security auth/validation/rate-limit — `security.mjs:115-187`; ops monitoring — `operations.mjs:384-417`.
- **Manifest drops fields:** JS — `manifest.mjs:208-229`; Rust no `[workspace]`/`[features]`/`[build-dependencies]`/`[lib]`/`rust-version` — `manifest.mjs:231-255`; Python no PEP 735/`requirements.txt` content — `manifest.mjs` (vs `testing.mjs:167-177` hack).
- **Conventions bugs:** Python docstring direction (`conventions.mjs:518-528`); Python relative-before-absolute (`:155-160`); comment-density `#`-only for Python/Rust contradicting `documentation.mjs:184-234` (`conventions.mjs:408-451`); file-naming samples all files (`:250`); standards asserted-not-detected (`:634-673`).
- **Language-specific P0:** Rust rustfmt false-positive (`ecosystem.mjs:312`); Rust `unsafe` undetected; Shell shellcheck-in-testFrameworks (`ecosystem.mjs:267`); Shell shfmt false-positive (`:273` + `config.mjs:170-176`); Shell dead beautysh (`:274`); Shell module-system no branch (`conventions.mjs:348-378`); JS `bun.lock` missing (`ecosystem.mjs:111,193`; `stack.mjs:28`; `survey.mjs:63`); JS `node:test` undetected (`ecosystem.mjs:127-134`); JS/TS ESLint flat `.ts/.mts/.cts` (`ecosystem.mjs:145-147`); JS `*.spec.js` globs (`:135`); TS `tsc` duplicated in linters+typeCheckers (`:224,245`); TS `.d.ts` in source set (`:196`).
- **Depth gaps:** symbol-level conventions absent; monorepo absent; bundlers/Deno/Bun first-class absent; runtime/version pinning absent.

## Assumptions And Decisions
| ID | Statement | Type | Status |
|---|---|---|---|
| A1 | Include Python's P0 correctness fixes (not strictly JS/TS/Rust/Shell) — user-dictated. | user-dictated | decided |
| A2 | Scope = P0 + P1 + P2 comprehensive parity across all 5 languages — user-dictated. | user-dictated | decided |
| A3 | Preserve data contract `{dimension,signal,findings}` and pipeline shape; new richness inside `findings`. | inferred | decided |
| A4 | Build on the existing shared foundation (`shared/{ignore,enum,parse,manifest,ecosystem}.mjs`); do not rewrite it. | inferred | decided |
| A5 | Skill dir is not a git repo → no commit at SAVED; plan file is the only artifact. | observed | decided |
| A6 | Cross-cutting detection tables move to a new shared data module consumed by architecture/security/operations — single source of truth, language-generic. | design | decided |
| A7 | All import-graph work is consolidated in one task owning `architecture.mjs` to avoid write overlap (highest-conflict file). | design | decided |
| A8 | Descriptor data expansion lands in Phase 0 (pure data scanners consume) so Phase 2 scanner tasks can rely on it. | design | decided |
| A9 | Meta-scores are REFRAMED (not removed): `cohesiveness`→detection-coverage %, `signal`→coverage level, `confidence`→epistemic basis (observed/inferred/unverified). They describe scan completeness, never repo quality. | design | decided |
| A10 | "Contradictions"→neutral "cross-observations": statements of co-existing facts, no `severity`, no judgmental connectors. The penalty/retry mechanism stays internal but is never rendered as critique. | design | decided |
| A11 | A `voice-gate` test objectively enforces the neutral stance via a banned-term list + allowlist for legitimate technical terms. | design | decided |

## R&D Record
| ID | Question | Method | Isolation | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Python depth/accuracy? | Read-only review of scanners/descriptors | Read-only; no writes | 4 P0 bugs (multi-line imports, namespace pkgs, docstring direction, PEP 735); DB/API/observability tables absent. | T103 manifest, T104 architecture, T108 conventions, T102 tables. |
| R2 | JS depth/accuracy? | Read-only review | Read-only | 4 hard false-negatives (bun.lock, eslint.config.ts, node:test, monorepo/aliases); manifest drops exports/engines/workspaces. | T101 descriptors, T103 manifest, T104 architecture, T105/T106/T107. |
| R3 | TS depth/accuracy? | Read-only review | Read-only | `import type` false edge; path aliases unresolved; tsconfig parses 3/~15 options; .d.ts in source; tsc duplicated. | T104 architecture, T106 config, T101 descriptors. |
| R4 | Shell depth/accuracy? | Read-only review | Read-only | 4 misleading outputs (shellcheck-as-test-framework, shfmt FP, dead beautysh, module-system); thin conventions; no tooling tests. | T101 descriptors, T106 config, T108 conventions, T112 fixtures. |
| R5 | Rust depth/accuracy? | Read-only review | Read-only | rustfmt FP; mod/self/super resolution wrong; workspaces→0 deps; unsafe undetected; comment-density bug; exports shallow. | T101 descriptors, T103 manifest, T104 architecture, T108 conventions. |

## Discovered Requirements
- `architecture.mjs` is the single highest-conflict file (imports, exports, C4, layering all live there) → one owner for all its changes (A7).
- Descriptor-driven scanners (config/testing/security) can only detect what the descriptor declares → descriptor breadth (T101) must precede/parallel scanner-depth tasks, and scanner tasks must consult new descriptor fields.
- `parseYamlShallow` still throws on YAML block scalars (prior discovery) → workflow YAML stays regex-parsed (no change here).
- Comment-density unification requires a shared helper used by BOTH `conventions.mjs` and `documentation.mjs` → new `shared/comments.mjs`, owned by T108, adopted by T111 (sequential).
- TS `.d.ts` exclusion and `import type` stripping must happen at the source-set and edge-emission layers together or the graph is inconsistent.
- PEP 420 namespace packages have no `__init__.py` → package-root detection needs a directory-based fallback, not just `__init__.py` probing.

## Design
Three structural changes, then per-scanner depth:

1. **Generic cross-cutting detection (`shared/detection.mjs`, new):** move C4 DB/external-API maps, security auth/validation/rate-limit maps, and operations monitoring maps OUT of the individual scanners into one shared, ecosystem-keyed data table populated for all 5 languages. `architecture.mjs`/`security.mjs`/`operations.mjs` import and consult it. This is the single change that fixes systemic finding #3 for every language at once.
2. **Manifest normalization completion (`shared/manifest.mjs`):** parse all dropped fields (JS/Rust/Python per Current-State Evidence), union workspace-member deps, expose PEP 735 dev-deps as `devDependencies`. Single source of truth consumed by stack/config/testing/security.
3. **Multi-language import resolver (`architecture.mjs`, consolidated):** one cohesive rewrite of the resolver layer covering: Python (multi-line + namespace + multi-package), JS/TS (path aliases via parsed tsconfig `paths`/`baseUrl` + workspace bare-imports + `import type` stripping + `.d.ts` exclusion), Rust (edition-2018 `mod` file-as-dir + `self::`/`super::` + external discrimination + crate-root), Shell (unchanged + script-invocation edges as P2). Exports expanded per language; C4 consumes `shared/detection.mjs`.

4. **Neutral factual voice (pipeline):** `enrich.mjs`/`validate.mjs` convert "contradictions" into neutral cross-observations of co-existing facts (no severity, no judgmental wording) and reframe meta-scores as factual detection-coverage + epistemic basis. `write.mjs` renders them neutrally (no "Contradiction:" heading, no grade-like Cohesion/Signal; presence/absence stated as fact). A `voice-gate` test objectively bans judgmental terminology from rendered output. This makes NORMS.md a description of how the repo IS, not a critical assessment of it.

Then per-scanner depth (config/testing/conventions/security/operations/stack) consumes the richer descriptors (T101) and tables (T102). Conventions gets symbol-level metrics + the comment-density shared helper. Fixtures (T112) regression-guard every P0 scenario per language. The voice gate (T116) objectively enforces neutrality. Golden + docs (T113) close out.

## Execution Graph
Critical path: **T101/T102/T103 (Phase 0, parallel, distinct files)** → **T104 architecture (Phase 1, needs T102 + T103)** → **T105–T110 + T114 (Phase 2, parallel — scanners + pipeline enrich/validate; distinct files; need T101+T102+T103; T114 needs none of the scanners)** → **T111 documentation + T115 write (G4, after T108/T114)** → **T112 fixtures+tests (needs all scanners + T115)** → **T116 voice-gate (needs T112 + T114 + T115)** → **T113 golden+docs**.

Parallel groups:
- **G1**: T101 (ecosystem.mjs descriptors), T102 (new shared/detection.mjs), T103 (manifest.mjs) — independent.
- **G2**: T104 (architecture.mjs) — alone (highest-conflict file).
- **G3**: T105 stack, T106 config, T107 testing, T108 conventions, T109 security, T110 operations, **T114 enrich+validate (pipeline voice)** — distinct files, full parallel.
- **G4**: T111 documentation (after T108), **T115 write (after T114)**.
- **G5**: T112 (fixtures) → T116 (voice-gate) → T113 (golden+docs).

## Numbered Plan

### 1. [completed] Ecosystem descriptor breadth (all 5 languages)
- Task ID: T101
- Depends on: none
- Parallel group: G1
- Risk: standard
- Owned scope: `lib/scan/shared/ecosystem.mjs` (+ `test/ecosystem.test.mjs`)
- Not in scope: scanner detection logic (Phase 2)
- Spike candidate: none
- Actions: Populate descriptors with the missing breadth — Python linters (semgrep, pydocstyle, prospector, dlint), formatters (autopep8, yapf, blue, flynt; add `.ruff.toml` to ruff-format files; `setup.cfg:[isort]`/`tox.ini:[flake8/isort]`/`setup.cfg:[mypy]`/`setup.cfg:[coverage:run]`), type-checkers (pytype, pyre-check, pyrefly), test frameworks (pytest-asyncio, pytest-xdist, pytest-mock, behave, robotframework); JS linters (standard, jshint, oxlint), formatter (dprint), test (node:test, node-tap, tape, uvu, jasmine); TS additions (@typescript-eslint distinct marker, ts-jest, @swc/jest, ts-node, tsx, @types/jest); Shell (bashate, shellspec, shunit2; FIX: remove `shellcheck` from `testFrameworks` P0-11; remove dead `beautysh` or give it files P0-13); Rust (proptest, quickcheck, trybuild, rstest, criterion, mockall, insta; remove `Cargo.toml` from rustfmt files P0-7; add `pdm.lock`/`bun.lock` to lockfields; add rustc as a typeChecker representation). Add `importSyntax.self`/`super` keys for Rust. Add ecosystem marker lists per language (`py.typed`, `MANIFEST.in`, `.python-version`, `.cargo/config.toml`, `rust-toolchain.toml`, `deno.json`, `bunfig.toml`, `jsconfig.json`, `tsconfig.*.json`).
- Acceptance signal: `node --test test/ecosystem.test.mjs` passes; new assertions: `DESCRIPTORS.rust.linters` has no `Cargo.toml`-only rustfmt entry, `DESCRIPTORS.shell.testFrameworks` has no `shellcheck`, `DESCRIPTORS.javascript.testFrameworks` has `node:test`, `DESCRIPTORS.rust.importSyntax` has `self`/`super`.
- Validation: each descriptor still has non-empty core arrays; JSON dump shows the new entries.
- Acceptance evidence: test output + descriptor diff summary.
- Repair attempts: 0
- Recovery note: pure data; re-run test.

### 2. [completed] Generic cross-cutting detection tables
- Task ID: T102
- Depends on: none
- Parallel group: G1
- Risk: standard
- Owned scope: `lib/scan/shared/detection.mjs` (new) + `test/detection.test.mjs`
- Not in scope: the consuming scanners (T104/T109/T110 wire it in)
- Spike candidate: none
- Actions: Create a shared, ecosystem-keyed data module exporting `DATABASE_INDICATORS`, `EXTERNAL_API_INDICATORS`, `AUTH_LIBS`, `INPUT_VALIDATION_LIBS`, `RATE_LIMIT_LIBS`, `MONITORING_LIBS`, each a map of `{depName: {label, type}}` populated for ALL 5 languages: Python (SQLAlchemy/psycopg/asyncpg/pymongo/motor/redis/tortoise/anthropic/openai/boto3/google-cloud-*; pydantic/marshmallow/cerberus/voluptuous; flask-login/django/passlib/python-jose/authlib; slowapi/flask-limiter; structlog/loguru/sentry-sdk/prometheus-client/opentelemetry-*), Rust (sqlx/diesel/rusqlite/sea-orm/tokio-postgres/redis/reqwest/hyper/aws-sdk-*/tonic; argon2/bcrypt/jsonwebtoken/validator; tracing/opentelemetry/sentry), JS (existing), Shell (n/a — empty maps documented), plus security audit tools (cargo-audit/cargo-deny/rustsec, semgrep, trufflehog, pip-audit, safety). Each entry resolves dep-name → label via the manifest dependency keys.
- Acceptance signal: `node --test test/detection.test.mjs` passes; `DATABASE_INDICATORS.rust.sqlx` and `.python.SQLAlchemy` and `MONITORING_LIBS.rust.tracing` exist.
- Validation: assert maps are non-empty for python/rust/javascript; shell maps empty + documented.
- Acceptance evidence: test output + map key samples.
- Repair attempts: 0
- Recovery note: pure data; re-run.

### 3. [completed] Manifest normalization completion
- Task ID: T103
- Depends on: none
- Parallel group: G1
- Risk: standard
- Owned scope: `lib/scan/shared/manifest.mjs` (+ `test/manifest.test.mjs`)
- Not in scope: scanner consumption
- Spike candidate: none
- Actions: Expand the normalized manifest: JS — add `main`/`module`/`exports`/`imports`/`engines`/`peerDependencies`/`workspaces` to `readManifest`; populate `entrypoints` from `main`/`module`/`exports`/`bin`. Rust — parse `[workspace]` (members/exclude/`[workspace.dependencies]`), `[features]`, `[build-dependencies]` → new `buildDependencies` bucket, `[lib]` (crate-type), `rust-version` (MSRV), `edition`; for workspace roots union member-crate deps. Python — read PEP 735 `[dependency-groups]` into `devDependencies` (P0-6); parse `requirements.txt`/`requirements-dev.txt`/`constraints.txt` content into deps (PEP 508); read `[project.gui-scripts]`/`[project.entry-points.*]`. Preserve all existing keys (contract).
- Acceptance signal: `node --test test/manifest.test.mjs` passes; new assertions: JS fixture with `exports`/`engines.node`/`workspaces` surfaces them; Rust workspace fixture returns unioned member deps + `rust-version`; Python fixture with `[dependency-groups].dev` surfaces those as `devDependencies`; `requirements.txt`-only fixture returns non-empty deps.
- Validation: existing manifest tests still pass (no regression); perplexity-cli manifest now includes PEP 735 dev tools.
- Acceptance evidence: test output + perplexity-cli manifest devDependencies sample.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 4. [completed] Multi-language import resolver hardening (architecture.mjs)
- Task ID: T104
- Depends on: T102, T103
- Parallel group: G2
- Risk: **high** (highest-conflict file; central to AC#1)
- Owned scope: `lib/scan/deep/architecture.mjs` (+ `test/architecture.test.mjs`)
- Not in scope: other scanners
- Spike candidate: For each language, prove the resolver yields the EXPECTED edge set (no false edges) on a dedicated fixture (built in T112 — but T104 must create minimal inline fixtures in its own test to prove each fix before T112 lands).
- Actions:
  - **TS/JS:** strip `import type`/`export type {`/inline `import { type X }` before edge emission (P0-1); resolve path aliases by reading parsed tsconfig/jsconfig `compilerOptions.paths`/`baseUrl` (preserve real map, not boolean) (P0-2); resolve bare imports to workspace packages (using T103 `workspaces`) → internal edges; exclude `.d.ts`/`.d.mts`/`.d.cts` from source set (P0). Expand exports: `module.exports = {}`/`exports.x =` (JS), `export * from`/`export { }` re-exports (TS).
  - **Python:** support multi-line parenthesized `from pkg import (a,b)` by accumulating continuation lines (P0-3); PEP 420 namespace packages — when no `__init__.py`, fall back to directory-based resolution instead of returning `[]` (P0-3); multi-package — resolve absolute imports against ANY top-level package dir under repo/src, not only `primaryPackage` (P1).
  - **Rust:** fix `resolveRustMod` to edition-2018 file-as-directory semantics (`src/a/b.rs` + `mod foo;` → `src/a/b/foo.rs` then `src/a/b/foo/mod.rs`); drop the `pkgRoot` fallback that invents edges (P0-8); add `use self::`/`use super::` resolution (P0-9); discriminate external crates (no edge, optionally classify) (P1); distinguish crate root `src/lib.rs` vs `src/main.rs` vs `[[bin]]` (P1). Expand exports: `pub trait`/`pub use`/`pub(crate)`/`pub type`/`pub const`/`pub mod`.
  - **C4:** consume `shared/detection.mjs` (T102) for DB/external-API nodes so Python/Rust/Shell projects get correct System_Ext/ContainerDb nodes; container technology already ecosystem-derived.
  - **Shell (P2):** add script-invocation edges (`./scripts/x.sh`, `bash foo.sh`, `$(...)` to in-repo scripts) beyond `source`.
- Acceptance signal: `node --test test/architecture.test.mjs` passes with NEW per-language cases: TS `import type` produces no edge + alias produces an edge + `.d.ts` excluded; JS workspace bare-import produces an edge; Python multi-line import produces edges to both names + namespace-package fixture >0 edges; Rust nested `mod` resolves to `b/foo.rs` (not `a/foo.rs`) + `use self::` produces an edge + workspace member edge. Assert NO false edges in a negative-case fixture (e.g. external `use serde::` emits nothing).
- Validation: real perplexity-cli edges stay >0 and not inflated; a Rust crate fixture (if available) resolves nested modules.
- Acceptance evidence: test output + per-language edge counts.
- Repair attempts: 0
- Recovery note: if a language yields wrong edges, the resolver branch is the culprit; package-root/alias config is the usual cause.

### 5. [completed] stack.mjs — runtime & version pinning
- Task ID: T105
- Depends on: T101, T103
- Parallel group: G3
- Risk: standard
- Owned scope: `lib/scan/deep/stack.mjs` (+ `test/stack.test.mjs`)
- Not in scope: other scanners
- Spike candidate: none
- Actions: Robust runtime probes — `python` fallback when no `python3` (P2); add `cargo --version` alongside `rustc` (P2); add `deno --version`/`bun --version` probes when those ecosystems/lockfiles detected (P1). Surface Node version pin from `engines.node`/`.nvmrc`/`.node-version` (T103 manifest); MSRV from Rust `rust-version`; Python `requires-python` (render in write — coordinate with T113 or render here). Add `bun.lock` to PM detection (P0-16) and `pdm.lock`. Keep contract.
- Acceptance signal: `node --test test/stack.test.mjs` passes; new assertions: JS fixture with `engines.node` surfaces the pin; Rust fixture surfaces `rust-version`; a `bun.lock`-only fixture → `packageManager:'bun'`.
- Validation: perplexity-cli stack still Python/uv.
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 6. [completed] config.mjs — tooling depth
- Task ID: T106
- Depends on: T101, T102
- Parallel group: G3
- Risk: standard
- Owned scope: `lib/scan/deep/config.mjs` (+ `test/config.test.mjs`)
- Not in scope: descriptors (T101)
- Spike candidate: none
- Actions: Align ESLint flat-config detection with the full set including `eslint.config.{ts,mts,cts}` (P0-18, reads T101 updated files); honor the `marker` flag / parse `.editorconfig` for shfmt so any `.editorconfig` isn't a false positive (P0-12); expand tsconfig parsing to capture `noImplicitAny`/`moduleResolution`/`module`/`baseUrl`/`extends`/`references`/`composite`/`declaration` and the REAL `paths` map (P1; feed real map to T104); remove `tsc` from the rendered linters (it's a type-checker) (P0); detect bundlers/build tools (webpack/vite/rollup/esbuild/turbo/tsup) + configs (P1); recognize `deno.json`/`bunfig.toml`/`jsconfig.json` (P1); surface `rustc` as Rust type-checker via descriptor (P1). Keep contract + the new richness keys (`linters[]` etc.).
- Acceptance signal: `node --test test/config.test.mjs` passes; new assertions: `eslint.config.ts` detected; `.editorconfig` alone does NOT imply shfmt; tsconfig `paths` map preserved; a vite fixture detects the bundler.
- Validation: perplexity-cli config unchanged (ruff etc.); a Rust fixture no longer false-positives rustfmt.
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 7. [completed] testing.mjs — framework & inline-test depth
- Task ID: T107
- Depends on: T101
- Parallel group: G3
- Risk: standard
- Owned scope: `lib/scan/deep/testing.mjs` (+ `test/testing.test.mjs`)
- Not in scope: descriptors
- Spike candidate: none
- Actions: Add `node:test` detection (import-marker path like Rust `#[test]`) (P0-17); add `*.spec.{js,mjs,cjs,jsx}` to JS globs (P0-19); add shellspec/shunit2 (Shell), proptest/quickcheck/trybuild/rstest/criterion/mockall/insta (Rust), pytest-asyncio/xdist/mock (Python), ts-jest/@swc/jest/ts-node/tsx (TS) via descriptors; scan Rust `src/**/*.rs` for inline `#[test]`/`#[cfg(test)]` so inline unit tests count (P1); coverage: add grcov/llvm-cov/cargo-llvm-cov via CI/Makefile refs not only deps (P1); add playwright/cypress/.taprc config files (P1). Keep contract.
- Acceptance signal: `node --test test/testing.test.mjs` passes; new assertions: a `node:test` fixture detects framework; a Rust fixture with inline `#[cfg(test)] mod tests` counts those files; a `*.spec.js` fixture counts.
- Validation: perplexity-cli testing still pytest/hypothesis/269.
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 8. [completed] conventions.mjs — depth + comment-density unification
- Task ID: T108
- Depends on: T101
- Parallel group: G3
- Risk: **high** (large; many metrics; creates shared helper)
- Owned scope: `lib/scan/deep/conventions.mjs`, NEW `lib/scan/shared/comments.mjs` (+ tests)
- Not in scope: documentation.mjs (T111 adopts the helper)
- Spike candidate: none
- Actions:
  - Create `shared/comments.mjs` exporting a language-aware `countComments(text, ecosystem)` (Python: `#` + triple-quote docstrings; Rust: `//`/`///`/`//!`/`/* */`; JS/TS: `//`/`/* */`+JSDoc; Shell: `#`) — the single source of truth. Wire `conventions.mjs` to use it (fixes Rust `#`-only bug P0-15 and Python docstring undercount).
  - Python fixes: docstring detection looks forward into body (P0-4); classify relative imports before absolute (P0-5); add type-hint posture (annotated `def` %, `from __future__ import annotations`) (P1); make language-standards detected-not-asserted (P0-21).
  - Symbol-level conventions (all): per-language dominant naming at SYMBOL level (camelCase fn, PascalCase type, SCREAMING const) (P1); async/await counts (JS/TS/Python/Rust) (P1); custom-exception classes (`class X(Exception)`/`class X extends Error`) (P1).
  - Shell: add `detectModuleSystem` shell branch (P0-14); `set -euo pipefail` adoption ratio + shebang presence/correctness (P1); shellcheck-directive comment counting (P2).
  - Rust: `unsafe` block/fn/impl count (P0-10); `Option`/`unwrap()`/`expect()`/`anyhow`/`thiserror`/`context()` counts (P1).
  - TS: annotation density, `interface` vs `type` ratio (P2).
  - Fix file-naming sampling to source extensions only (`:250`) (P1).
  - Keep contract (`importStyle`/`fileNaming`/`errorHandling`/`moduleSystem`/`largestFiles`/`commentDensity`/`docstrings`/`languageStandards`); add richness keys.
- Acceptance signal: `node --test test/conventions.test.mjs` passes; new assertions: Python docstring coverage >0 on a documented fixture; relative imports classified as relative; Rust `unsafe` counted; Shell moduleSystem not "auto"; conventions comment-density === documentation comment-density for a shared Python sample; file-naming excludes `.md`.
- Validation: perplexity-cli conventions now report real docstring % and correct relative/absolute split.
- Acceptance evidence: test output + perplexity-cli conventions diff.
- Repair attempts: 0
- Recovery note: many independent metrics; if one fails, isolate by metric.

### 9. [completed] security.mjs — generic maps + completeness
- Task ID: T109
- Depends on: T102, T103
- Parallel group: G3
- Risk: standard
- Owned scope: `lib/scan/deep/security.mjs` (+ `test/security.test.mjs`)
- Not in scope: detection table data (T102)
- Spike candidate: none
- Actions: Replace the inline JS/Python auth/validation/rate-limit maps with `shared/detection.mjs` (T102) so Rust/Shell projects get correct findings; add cargo-audit/cargo-deny/rustsec + semgrep/trufflehog detection (securityTools + deps); complete Python (any missing); add `bun.lock`/`pdm.lock` to `hasLockfile`; source all deps from the normalized manifest (now incl. PEP 735 + requirements.txt + workspace union). Keep contract + `securityTools`.
- Acceptance signal: `node --test test/security.test.mjs` passes; new assertions: a Rust fixture with `argon2`+`validator` detects auth+validation; a Python fixture with `pydantic`+`sentry-sdk` detects validation + (monitoring is operations, but deps visible); `bun.lock` → `hasLockfile:true`.
- Validation: perplexity-cli security still uv.lock + gitleaks.
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 10. [completed] operations.mjs — generic monitoring + breadth
- Task ID: T110
- Depends on: T102, T103
- Parallel group: G3
- Risk: low
- Owned scope: `lib/scan/deep/operations.mjs` (+ `test/operations.test.mjs`)
- Not in scope: detection data
- Spike candidate: none
- Actions: Replace inline JS monitoring map with `shared/detection.mjs` `MONITORING_LIBS` (T102) so Python (structlog/sentry-sdk/prometheus-client/opentelemetry) and Rust (tracing/opentelemetry/sentry) surface; add Justfile detection alongside Makefile (P1); surface `cargo`/`rustc` version (via T105/T103) in operations where relevant; keep CI job/trigger parsing. Keep contract.
- Acceptance signal: `node --test test/operations.test.mjs` passes; new assertion: a Python fixture with `sentry-sdk` detects monitoring; a Justfile fixture detected.
- Validation: perplexity-cli operations unchanged (6 workflows).
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 11. [completed] documentation.mjs — adopt comment helper + doc dialects
- Task ID: T111
- Depends on: T108
- Parallel group: G4
- Risk: low
- Owned scope: `lib/scan/deep/documentation.mjs` (+ `test/documentation.test.mjs`)
- Not in scope: conventions.mjs
- Spike candidate: none
- Actions: Refactor `documentation.mjs` comment-counting to use `shared/comments.mjs` (T108) so documentation & conventions agree exactly; classify Python docstring dialects (Google/NumPy/Sphinx/reST) heuristically (P2); distinguish JSDoc vs TSDoc (P2); keep badge/commentRatio contract.
- Acceptance signal: `node --test test/documentation.test.mjs` passes; assertion: documentation commentRatio === conventions commentDensity for a shared Python+Rust sample (cross-scanner consistency).
- Validation: perplexity-cli documentation commentRatio sensible.
- Acceptance evidence: test output.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 12. [completed] Regression fixtures + per-language P0 tests
- Task ID: T112
- Depends on: T104–T111
- Parallel group: G5
- Risk: **high** (guards AC#1, #3, #4, #5)
- Owned scope: `test/fixtures/**` (expand all 5) + new `test/regression-*.test.mjs`
- Not in scope: scanner source
- Spike candidate: none
- Actions: Expand fixtures to cover every P0 scenario: TS (path aliases via tsconfig `paths`, `import type`, `.d.ts`, project `references`); JS (`bun.lock`, `node:test`, `*.spec.js`, `workspaces` monorepo bare-import, `exports`/`engines`); Python (multi-line `from pkg import (a,b)`, PEP 420 namespace package, PEP 735 `[dependency-groups]`, `requirements.txt`, multi-package); Rust (`#[workspace]` with 2 members, nested `mod` + `use self::`/`super::`, inline `#[cfg(test)]`, `unsafe`, `rust-version`, `Cargo.lock`); Shell (`.shellcheckrc`, `*.bats`, `set -euo pipefail`, shebangs, `source` graph). Add regression tests asserting each P0 fix holds (no false edges, correct detection).
- Acceptance signal: `node --test test/regression-*.test.mjs` passes; ≥1 test per P0 item from the review.
- Validation: full suite still green.
- Acceptance evidence: test summary + P0 coverage matrix.
- Repair attempts: 0
- Recovery note: fixtures rebuild each run.

### 13. [completed] Golden test refresh + SKILL.md depth docs
- Task ID: T113
- Depends on: T112
- Parallel group: G5
- Risk: low
- Owned scope: `test/golden.test.mjs` (extend), `SKILL.md` (edit)
- Not in scope: scanner source
- Spike candidate: none
- Actions: Extend the golden test to assert the 5 fixtures each render their ecosystem's full depth (DB nodes where the fixture has a DB dep, monitoring, conventions metrics) with no escapes; update the real-repo golden for perplexity-cli. Update SKILL.md to document: per-language depth, monorepo support, generic cross-cutting detection, the `shared/detection.mjs` + `shared/comments.mjs` modules, and the expanded manifest fields.
- Acceptance signal: `node --test test/golden.test.mjs` passes; SKILL.md lists the 5 ecosystems with depth notes + new shared modules.
- Validation: full suite green; constraints block intact.
- Acceptance evidence: test output + SKILL.md diff.
- Repair attempts: 0
- Recovery note: text + test edits.

### 14. [completed] Pipeline neutral voice — enrich.mjs + validate.mjs
- Task ID: T114
- Depends on: none (pipeline files; independent of scanner-depth tasks)
- Parallel group: G3
- Risk: standard
- Owned scope: `lib/scan/enrich.mjs`, `lib/scan/validate.mjs` (+ `test/enrich.test.mjs`, `test/validate.test.mjs`)
- Not in scope: `write.mjs` (T115), scanners
- Spike candidate: none
- Actions: Convert "contradictions" into neutral **cross-observations**: keep detecting co-existing facts (e.g. tsconfig strict + `require()` usage + pkg type) but emit each as a neutral statement of the facts that hold together — `{ description: '<fact A>; <fact B>; <fact C>', dimensions:[...] }` with **no `severity`** field and **no** "contradiction"/"conflict"/"however"/"but"/"should" wording. Preserve the `contradictions` return-array KEY (write.mjs consumes it) — only its content/semantics change. Keep the internal null-finding/retry logic that drives re-scanning, but ensure no OUTPUT-facing field labels a dimension "weak"/"strong". Reframe `cohesiveness` semantically as **detection coverage** (fraction of expected findings that are non-null, 0–100) — keep the numeric field, change its meaning + how write.mjs labels it (T115). Keep `confidence` as epistemic basis (observed/inferred/unverified). Preserve `enrich(deep,overview)` and `validate(enriched)` signatures and the data contract.
- Acceptance signal: `node --test test/enrich.test.mjs test/validate.test.mjs` passes; new assertions: every `contradictions[]` entry has no `severity` key and its `description` contains none of the banned voice terms; a sample reads as neutral co-existing facts.
- Validation: existing pipeline tests still pass; perplexity-cli `contradictions` content is neutral.
- Acceptance evidence: test output + a sample neutral cross-observation.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 15. [completed] Neutral rendering + output voice pass — write.mjs
- Task ID: T115
- Depends on: T114
- Parallel group: G4
- Risk: standard
- Owned scope: `lib/scan/write.mjs` (+ `test/write.test.mjs`)
- Not in scope: enrich/validate logic
- Spike candidate: none
- Actions: Render cross-observations neutrally — replace any "Contradiction"/"Conflict" heading with a neutral one (e.g. "Cross-observations" / "Co-existing facts"), drop severity badges. Replace the per-section `> **Confidence** … | Cohesion … | Signal …` grade line with a factual **coverage** line, e.g. `> Coverage: <n>% of expected findings observed · basis: observed|inferred|unverified`. Audit EVERY section's prose and rephrase to factual observation: presence → "X is present"; absence → "no X found"/"X not present" (a fact, never a deficit); inferred lines phrased as observations, not recommendations. Remove any judgmental connector. Preserve exactly one `writeFile`; preserve all rendered findings keys (including richness arrays).
- Acceptance signal: `node --test test/write.test.mjs` passes; new assertions: rendered output's section meta line contains "Coverage" and "basis" (not "Cohesion"/"Signal"), and a preliminary banned-term scan of a rendered sample returns 0 (authoritative gate is T116).
- Validation: perplexity-cli NORMS.md reads as neutral description; no escapes regressed.
- Acceptance evidence: test output + a before/after sample of one section's meta line.
- Repair attempts: 0
- Recovery note: deterministic; re-run.

### 16. [completed] Voice-gate test (objective enforcement of neutral factual stance)
- Task ID: T116
- Depends on: T112, T114, T115
- Parallel group: G5
- Risk: standard (objective gate for AC#9)
- Owned scope: `test/voice-gate.test.mjs`
- Not in scope: source files
- Spike candidate: none
- Actions: Define `BANNED_VOICE` (judgmental terms: should, must, ought, shall, poor, good, bad, weak, strong [as grading], better, worse, best, worst, recommended, recommendation, ideally, unfortunately, concern, concerning, problem, anti-pattern, smell, suboptimal, inadequate, insufficient [as judgment], contradiction, inconsistent, conflict, lacking, missing-as-deficit phrasings) and an `ALLOW` list/regex for legitimate technical occurrences (e.g. "strongly typed", "weak reference", "weak map", "critical section", `must`/`should` inside quoted commands, config values, or proper nouns). For each of the 5 fixtures AND perplexity-cli: run the full pipeline, render `NORMS.md` to a temp file, assert NO banned term appears outside ALLOW contexts (case-insensitive, word-boundary). This is the objective, build-breaking gate that the output is a non-critical factual assessment.
- Acceptance signal: `node --test test/voice-gate.test.mjs` passes for all fixtures + perplexity-cli (0 banned-term hits outside the allowlist).
- Validation: if a hit is a legitimate technical term, add it to ALLOW with a comment — never weaken the repo-description voice.
- Acceptance evidence: test output + the final banned/allow lists.
- Repair attempts: 0
- Recovery note: deterministic; if it fails, the offending section's prose (T115) or a cross-observation (T114) needs rewording — never silence by allowlisting a genuine judgment.

### 17. [completed] Repair neutral CLI progress output
- Task ID: T117
- Depends on: T114, T115, T116
- Parallel group: repair
- Risk: low
- Owned scope: `scripts/scan.mjs`, NEW `test/scan-cli.test.mjs`
- Not in scope: scanner findings or NORMS renderer
- Spike candidate: none
- Root cause: `scan.mjs` still prints `[CONTRADICTION] ... (${c.severity})`, `Cohesiveness`, and “weak dimensions” even though T114 removed severity and T115/T116 made NORMS neutral. A triggered cross-observation therefore prints `(undefined)` and judgmental legacy labels on stdout.
- Actions: render cross-observations as `[CROSS-OBSERVATION] <neutral facts>` with no severity; print `Detection coverage` instead of `Cohesiveness`; replace “weak dimensions” with factual “dimensions below the retry coverage threshold”; keep internal variable names private. Add a CLI integration test using a synthetic repo that triggers at least one cross-observation, asserting neutral labels, no `(undefined)`, and no legacy judgment words.
- Acceptance signal: `node --test --test-concurrency=1 test/scan-cli.test.mjs` passes; full sequential suite passes; captured CLI stdout contains `[CROSS-OBSERVATION]` and `Detection coverage`, with no `[CONTRADICTION]`, `Cohesiveness`, `(undefined)`, or “weak dimensions”.
- Validation: final perplexity-cli CLI run remains successful.
- Acceptance evidence: focused + full-suite output and captured stdout excerpt.
- Repair attempts: 1
- Recovery note: deterministic CLI text repair; rerun focused test.

### 18. [completed] Repair factual coverage semantics + production observations + CLI voice
- Task ID: T118
- Depends on: T114-T117
- Parallel group: repair-2
- Risk: high
- Owned scope: `lib/scan/enrich.mjs`, `lib/scan/validate.mjs`, `lib/scan/write.mjs`, `scripts/scan.mjs`, and their focused tests
- Actions: Compute coverage from reported scanner fields rather than signal grades/bonuses/penalties; derive basis from observation/inference state, not quality; preserve compatibility keys as aliases only. Carry cross-observations per repo into production write and all test pipelines. Remove output-facing signal grades, GAP labels, and numeric confidence from CLI; cover all branches.
- Acceptance signal: focused metadata/write/CLI/voice tests pass; synthetic CLI and NORMS both render a cross-observation; populated low-signal findings report complete field coverage; no grade-like CLI terms.
- Repair attempts: 1

### 19. [completed] Repair resolver edge cases + Rust export richness
- Task ID: T119
- Depends on: T104
- Parallel group: repair-2
- Risk: high
- Owned scope: `lib/scan/deep/architecture.mjs`, NEW focused resolver repair tests
- Actions: Parse valid tsconfig/jsconfig JSONC; resolve multiline JS/TS imports; discover nested-only PEP 420 namespace roots; expand Rust workspace member globs for context; resolve member-local `crate::`, `mod`, `self::`, `super::`; extract planned Rust public export forms.
- Acceptance signal: positive/negative probes for every reproduced failure pass; full architecture tests pass.
- Repair attempts: 1

### 20. [completed] Repair Cargo workspace normalization + survey lockfile parity
- Task ID: T120
- Depends on: T103, T105
- Parallel group: repair-2
- Risk: standard
- Owned scope: `lib/scan/shared/manifest.mjs`, `lib/scan/survey.mjs`, NEW focused manifest/survey tests
- Actions: Expand Cargo workspace globs to resolved member directories while preserving declared patterns; union member dependencies; detect `bun.lock` in survey (and descriptor-supported Python lockfiles consistently).
- Acceptance signal: `members=["crates/*"]` unions member deps; survey reports Bun for `bun.lock`; existing manifest/survey tests pass.
- Repair attempts: 1

### 21. [completed] Repair dependency matching + unsupported classifications
- Task ID: T121
- Depends on: T102
- Parallel group: repair-2
- Risk: standard
- Owned scope: `lib/scan/shared/detection.mjs`, focused detection tests
- Actions: Normalize dependency lookup names case-insensitively with Python distribution separator equivalence; remove unsupported DB/API/validation/rate-limit classifications (`alembic`, `wiremock`, `serde`, `p-limit`) that cause factual overclaims.
- Acceptance signal: `SQLAlchemy`/underscore-hyphen forms match; removed packages do not emit those classifications; generic map tests pass.
- Repair attempts: 1

### 22. [completed] Repair Rust standards as observed evidence
- Task ID: T122
- Depends on: T108
- Parallel group: repair-2
- Risk: standard
- Owned scope: `lib/scan/deep/conventions.mjs`, NEW focused conventions repair tests
- Actions: Do not claim rustfmt/clippy from Cargo.toml alone; report each only from its config or invocation evidence; strengthen P0-21 with a Cargo-bearing negative fixture.
- Acceptance signal: bare Cargo project reports neither; config/invocation fixtures report only evidenced tools; conventions regressions pass.
- Repair attempts: 1

### 23. [completed] Repair comment-safe JS imports + shared Cargo glob/exclude semantics
- Task ID: T123
- Depends on: T119, T120
- Parallel group: repair-3
- Risk: high
- Owned scope: `lib/scan/deep/architecture.mjs`, `lib/scan/shared/manifest.mjs`, NEW shared glob helper, focused repair tests
- Actions: Strip JS comments without corrupting strings before multiline static import parsing; permit semicolons in comments; prevent block-comment false edges. Centralize Cargo member glob expansion with exact, `*`, `**`, `?`, character-class, and exclude support; architecture must use the same resolved non-excluded members as manifest.
- Acceptance signal: block-comment imports emit no edge; valid commented multiline import resolves; excluded crates never become local edges; broader Cargo glob tests pass in manifest and architecture.
- Repair attempts: 1

### 24. [completed] Repair ecosystem-specific dependency normalization
- Task ID: T124
- Depends on: T121
- Parallel group: repair-3
- Risk: standard
- Owned scope: `lib/scan/shared/detection.mjs`, `test/detection.test.mjs`
- Actions: Keep case normalization globally but apply PEP 503 separator equivalence only to Python detection tables; npm/Rust separator near-misses must not match.
- Acceptance signal: Python `SQLAlchemy`/separator variants match; JavaScript `node_fetch` and `express_rate_limit` do not match hyphenated packages.
- Repair attempts: 1

### 25. [completed] Repair Rust automation comment false positives
- Task ID: T125
- Depends on: T122
- Parallel group: repair-3
- Risk: standard
- Owned scope: `lib/scan/deep/conventions.mjs`, `test/conventions-rust-standards.test.mjs`
- Actions: Strip shell/YAML/Make comments quote-aware before searching automation for rustfmt/clippy invocations; comment-only references cannot count as evidence.
- Acceptance signal: comment-only automation reports neither tool; executable workflow/script commands remain detected.
- Repair attempts: 1

### 26. [completed] Repair absence inference + voice header coverage + docs inventory
- Task ID: T126
- Depends on: T118
- Parallel group: repair-3
- Risk: standard
- Owned scope: `lib/scan/enrich.mjs`, `test/enrich.test.mjs`, `test/scan-cli.test.mjs`, `test/voice-gate.test.mjs`, `SKILL.md`
- Actions: Treat `N/A` as factual absence, never an inferred pattern; ensure table header cells are voice-checked while repository data cells stay masked; document all output sections including Documentation, Security, Operations, and per-repo Cross-observations.
- Acceptance signal: non-Git fixture emits no inferred N/A; second-column judgmental header is caught; SKILL output inventory is complete.
- Repair attempts: 1

### 27. [completed] Repair quoted YAML Rust-tool evidence
- Task ID: T127
- Depends on: T125
- Parallel group: repair-4
- Risk: standard
- Owned scope: `lib/scan/deep/conventions.mjs`, `test/conventions-rust-standards.test.mjs`
- Actions: Preserve and unquote GitHub Actions quoted `run:` scalar commands while still suppressing quoted metadata/echo/comment false positives.
- Acceptance signal: single- and double-quoted `run: cargo fmt/clippy` detect tools; quoted non-run text does not.
- Repair attempts: 1

### 28. [completed] Repair audit evidence source + rendering
- Task ID: T128
- Depends on: T109, T115
- Parallel group: repair-4
- Risk: high
- Owned scope: `lib/scan/deep/security.mjs`, `lib/scan/write.mjs`, focused security/write tests
- Actions: Preserve factual audit evidence provenance (package script, declared dependency, workflow/Makefile reference); render that provenance instead of claiming every signal is in package.json scripts. Keep `hasAuditScript` as compatibility boolean only.
- Acceptance signal: Python repo without package.json never claims package.json scripts; each evidence source renders its actual source.
- Repair attempts: 1

### 29. [completed] Bound globstar traversal
- Task ID: T129
- Depends on: T123
- Parallel group: repair-4
- Risk: low
- Owned scope: `lib/scan/shared/glob.mjs`, focused manifest/glob tests
- Actions: Prune generated/cache directories and cap visited directories during `**` expansion while preserving normal Cargo workspace matching and read-only behavior.
- Acceptance signal: generated trees are pruned; traversal is bounded; existing full glob semantics pass.
- Repair attempts: 1

## Verification Strategy
Cheapest-first: per-task `node --test test/<task>.test.mjs` → Phase-2 combined `node --test test/` → cross-scanner consistency check (conventions vs documentation comment-density — AC#5) → **voice-gate (T116, AC#9 — confirms neutral factual output for every fixture + perplexity-cli)** → pipeline gate (full run on perplexity-cli + each fixture; T112/T113) → constraint gate (zero deps, single writeFile, ESM). The import-graph regression tests (T112) prove AC#1; cross-scanner comment-density equality (T108↔T111) proves systemic #2; the voice-gate (T116) proves the neutral-stance AC#9.

## Risks And Recovery
- **R1 — Import resolver regressions** (T104): a fix for one language breaks another. Mitigation: one owner for `architecture.mjs`; per-language edge tests with positive AND negative cases; run all 5 fixtures after each branch.
- **R2 — Descriptor/scanner drift** (T101 vs T106/T107): a scanner reads a descriptor field that doesn't exist. Mitigation: T101 lands first; scanner tasks assert the fields they read.
- **R3 — Conventions overload** (T108): many metrics in one file. Mitigation: ship metrics incrementally behind the existing findings keys; each metric has its own assertion.
- **R4 — Manifest parse edge cases** (T103): PEP 508 `requirements.txt`, `cargo` path/git deps, `package.json` `exports` conditional maps are complex. Mitigation: parse the common subset, throw-never (skip unparseable lines), fixture-cover the common forms.
- **R5 — `shared/comments.mjs` contract** (T108↔T111): both scanners must agree. Mitigation: T111 depends on T108; shared consistency test.
- No destructive ops; all test artifacts under `/tmp`; rollback = revert skill source.

## Critique Resolution
| Finding | Severity | Resolution |
|---|---|---|
| Consolidating all import-graph work in one task (T104) is large. | standard | Justified by A7 (single highest-conflict file); per-language sub-objectives + spike; one owner avoids merge conflict. |
| Comment-density spans conventions+documentation (two files). | standard | T108 creates `shared/comments.mjs` + conventions integration; T111 (sequential) does documentation integration; shared consistency test. |
| Descriptor edits (T101) must precede scanner depth. | standard | A8: T101 in Phase 0 (G1) before G3. |
| Generic tables (T102) require touching 3 scanners. | standard | T102 owns only the data module; T104/T109/T110 wire it in (each owns its own scanner). |
| P2 scope may bloat the plan. | standard | P2 items are folded into existing tasks (descriptors/manifest/config) rather than separate tasks; no standalone P2 task. |
| Python included despite user's literal "js ts rust shell". | informational | A1: user explicitly chose to include Python P0 fixes. |
| Primary-led critique (no separate critic subagent). | standard | Acceptable per Scale-To-The-Ask; every finding cited to the review's file:line evidence. |
| Plan amendment: original plan did not guarantee a neutral/factual (non-critical) output — "contradictions"+severity, Cohesion/Signal grades, and un-audited voice read as judgment. | high | Added Deliverable #8, AC#9, A9–A11, Design item #4, and tasks T114 (enrich+validate neutralization), T115 (write voice pass), T116 (voice-gate test). Pipeline SHAPE unchanged; only presentation/voice semantics change (exclusion clarified). |
| "Reframe scores" vs "remove scores" decision. | standard | A9: reframe as factual detection-coverage + epistemic basis (preserves useful scan-metadata) rather than delete; reversible if user prefers removal. |
| Voice-gate allowlist could be gamed to silence real judgment. | standard | T116 rule: allowlist ONLY legitimate technical terms with a documented comment; a genuine judgment must be reworded in T114/T115, never allowlisted. |

## Progress Journal
| Timestamp | Cycle | Transition | Evidence/result | Next state |
|---|---|---|---|---|
| 2026-08-02 | 0 | INTAKE | Large parity hardening; 2 questions answered (include Python P0; P0+P1+P2 comprehensive). | DISCOVER |
| 2026-08-02 | 0 | DISCOVER | Baseline 118 tests; review report + 5 reviewer assessments in hand; key files sized. | RESEARCH |
| 2026-08-02 | 0 | RESEARCH | Reviewer evidence (R1–R5) with file:line already complete from adversarial review. | DRAFT |
| 2026-08-02 | 0 | DRAFT | 13-task plan: foundation data (T101–T103) → architecture (T104) → scanner depth (T105–T111) → fixtures/golden/docs (T112–T113). | CRITIQUE |
| 2026-08-02 | 0 | CRITIQUE | 7 findings resolved (Critique Resolution). | REMEDIATE |
| 2026-08-02 | 0 | REMEDIATE | No material redesign; folded into task spikes/anti-scope. | VERIFY |
| 2026-08-02 | 0 | VERIFY | All 8 acceptance criteria map to numbered work; deps acyclic; file ownership non-overlapping per group; contracts preserved. | SAVED |
| 2026-08-02 | 0 | SAVED | Plan written; commit skipped (not a git repo, A5). Implementation NOT started. | STOP |
| 2026-08-02 | 0 | AMEND (CRITIQUE→REMEDIATE→VERIFY→SAVED) | User requirement: plan must guarantee a **non-critical, factual** NORMS.md (describe how the repo IS, not assess it critically; facts not judgment). Added neutral-voice workstream: Deliverable #8, AC#9, A9–A11, Design item #4, tasks T114 (enrich+validate: contradictions→neutral cross-observations, scores→coverage), T115 (write voice pass), T116 (voice-gate test). Execution graph updated (T114 in G3, T115 in G4, T116 in G5 before T113). 16 tasks total. Implementation still NOT started. | STOP |
| 2026-08-02 | 1 | RECOVER→DISPATCH→VERIFY→CHECKPOINT | T101,T102,T103 | Descriptors, generic detection tables, and manifest normalization complete; PEP 735 dev-deps visible; 154/154 tests. | SELECT |
| 2026-08-02 | 2 | DISPATCH→VERIFY→CHECKPOINT | T104 | Multi-language resolver hardening complete; 161/161 tests; perplexity-cli 323 internal edges, C4 Python + DB/API nodes. | SELECT |
| 2026-08-02 | 3 | DISPATCH→VERIFY→CHECKPOINT | T105-T110,T114 | Scanner depth + neutral enrich/validate complete; 220/220 sequential tests; G3 integration and pipeline verified. | SELECT |
| 2026-08-02 | 4 | DISPATCH→VERIFY→CHECKPOINT | T111,T115 | Shared comment metrics + neutral/rich renderer complete; 226/226 sequential tests; preliminary voice scan clean. | SELECT |
| 2026-08-02 | 5 | SELECT→DISPATCH | T112 | Expanding all five fixtures and adding one regression assertion per P0 finding. | DISPATCH |
| 2026-08-02 | 5 | VERIFY→CHECKPOINT | T112 | Explicit 21-item P0 matrix passes; all five fixtures expanded; 247/247 sequential tests; fixture pipeline/golden 7/7. | SELECT |
| 2026-08-02 | 6 | SELECT→DISPATCH | T116 | Running an objective banned-term voice gate against rendered output for all fixtures and perplexity-cli. | DISPATCH |
| 2026-08-02 | 6 | VERIFY→CHECKPOINT | T116 | Voice gate passes for all five fixtures + perplexity-cli; 0 hits; 256/256 sequential tests; Coverage/basis metadata and Cross-observations heading verified. | SELECT |
| 2026-08-02 | 7 | SELECT→DISPATCH | T113 | Refreshing golden assertions and documenting language depth, monorepo support, generic tables, shared comments, and neutral factual voice. | DISPATCH |
| 2026-08-02 | 7 | VERIFY→REVIEW | T113 | Golden 6/6; 260/260 sequential tests; SKILL.md complete; final perplexity-cli pipeline passes. | REVIEW |
| 2026-08-02 | 7 | REVIEW→REPAIR | T117 | Found legacy `[CONTRADICTION] ... (undefined)`, `Cohesiveness`, and “weak dimensions” console labels in scripts/scan.mjs; NORMS itself remains neutral. | DISPATCH |
| 2026-08-02 | 7 | VERIFY→REVIEW | T117 | CLI repair passes; 261/261 sequential tests; primary completion gate clean. | REVIEW |
| 2026-08-02 | 8 | REVIEW→REPAIR | T118-T122 | Two independent reviewers reproduced material defects: grading disguised as coverage, missing production cross-observations, remaining CLI grade language, TS/Python/Rust resolver gaps, Cargo glob normalization, Rust standards assertion, package normalization, Bun survey omission, and unsupported dependency classifications. | DISPATCH |
| 2026-08-02 | 8 | VERIFY→REVIEW | T118-T122 | 287/287 full tests; 149/149 repaired tracks; real pipeline and constraints pass. | REVIEW |
| 2026-08-02 | 9 | REVIEW→REPAIR | T123-T126 | Re-review found comment/static-import and Cargo-exclude/glob edge cases, global PEP503 over-normalization, comment-only Rust tool evidence, N/A inference, and low-risk voice/docs omissions. | DISPATCH |
| 2026-08-02 | 9 | VERIFY→REVIEW | T123-T126 | 298/298 full tests; 98/98 focused gates; real pipeline and constraints pass. | REVIEW |
| 2026-08-02 | 10 | REVIEW→REPAIR | T127-T129 | Final closure review found quoted YAML run false negatives and incorrect package.json audit provenance; globstar traversal had no practical bound. | DISPATCH |
| 2026-08-02 | 10 | VERIFY→REVIEW | T127-T129 | Definitive 309/309 full tests; 88/88 final acceptance tracks; real perplexity-cli pipeline clean; one write, zero external imports, zero bad audit claims/old grades/over-escapes. | REVIEW |
| 2026-08-02 | 10 | REVIEW→COMPLETE | Independent correctness reviewer: PASS, no material findings. Independent safety/voice reviewer: PASS, no material findings. | COMPLETE |

## Completion Review
- Result: **PASS — 29/29 tasks completed; all acceptance criteria have observed evidence.**
- Language parity: Python, JavaScript, TypeScript, Shell, and Rust fixtures run through the full pipeline and golden assertions.
- P0 correctness: the explicit 21-case matrix passes, including import resolution, PEP 735, Cargo workspaces, Rust standards, Shell tooling roles, Bun, `node:test`, and JS spec files.
- Depth: shared generic detection maps, normalized manifests/workspaces, runtime/config/testing/conventions/security/operations richness, documentation dialects, and public export evidence are rendered.
- Architecture: JSONC aliases, multiline type/runtime imports, nested PEP 420, JS workspaces, Cargo glob/exclude members, member-local Rust paths, and external negative cases are covered.
- Neutral stance: factual field coverage/basis, per-repository Cross-observations, CLI wording, table labels, absence handling, and audit provenance pass the objective voice gates.
- Safety/constraints: scanned repos remain read-only; no installs/builds; ESM + Node built-ins only; exactly one production `writeFile(outPath, content)`; zero external imports.
- Definitive verification: `node --test --test-concurrency=1` → **309 pass, 0 fail**; final repair/acceptance tracks → **88 pass, 0 fail**; real perplexity-cli pipeline wrote `/tmp/norms-completion.md` successfully.
- Review: independent correctness and independent safety/voice reviewers both returned **PASS — No material findings** after targeted reproductions.
- Commits: skipped because the skill directory is not a git repository (A5).
- Residual operational note: filesystem-heavy fixture tests use `--test-concurrency=1` as the documented authoritative command.
