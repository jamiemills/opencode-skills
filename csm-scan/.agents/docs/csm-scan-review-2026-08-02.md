# csm-scan Adversarial Review — Aggregated Assessment & Recommendations

**Date:** 2026-08-02
**Scope:** Fact-based assessment of how comprehensively/accurately/broadly/deeply the `csm-scan` skill audits real-world projects across Python, JavaScript, TypeScript, Shell, Rust — to make `NORMS.md` a comprehensive audit of practices, architecture, processes, and tools.
**Method:** 5 adversarial language reviewers (one per language), each assessing tooling / architecture / conventions / ecosystem facets against the live source with `file:line` evidence. (Reviewers reported the `Task` sub-agent tool was unavailable in their environment, so each performed its facet analyses directly — depth and evidence unaffected.)
**Verdict convention:** Present / Partial / Absent. Priorities: **P0** = correctness defect producing wrong output now · **P1** = depth/breadth gap for a credible audit · **P2** = polish.

---

## Per-language headline verdicts

| Language | Is the audit comprehensive today? | One-line basis |
|---|---|---|
| **Python** | **Credible, with 4 correctness bugs** | Multi-line imports, namespace packages, docstring-direction, and PEP 735 dev-deps all mis-reported; PEP 621/poetry/build-backend solid. |
| **JavaScript** | **Solid baseline, 4 hard false-negatives** | `bun.lock`, `eslint.config.ts`, `node:test`, and monorepo bare-imports/path-aliases silently dropped. |
| **TypeScript** | **Shallow in 3 load-bearing places** | `import type` counted as runtime edge; path aliases unresolved; tsconfig parsing captures ~3 of ~15 options. |
| **Shell** | **Best-effort surface scan, 4 misleading outputs** | shellcheck mis-tagged as test framework; shfmt false-positives on any `.editorconfig`; dead beautysh; misleading module-system string. |
| **Rust** | **First-class but shallow/buggy** | rustfmt false-positive; `mod foo;` nested resolution wrong; `self::`/`super::` unsupported; workspaces → zero deps; `unsafe` undetected. |

---

## Cross-cutting systemic findings (affect the whole skill)

1. **Import-graph accuracy is the weakest dimension.** Four distinct classes of error across languages: type-only edges (TS), unresolved aliases (JS/TS), dropped multi-line/namespace imports (Python), and wrong `mod`/`self`/`super` resolution (Rust). This directly corrupts the Architecture section — the skill's central output.
2. **Two scanners disagree on the same metric.** `conventions.mjs` comment-density counts `#`-only for Python and Rust (ignoring docstrings, wrong for Rust `//`), while `documentation.mjs` counts correctly. Same number, two different values.
3. **Cross-cutting detection tables are language-specific, not generic.** C4 DBs/external-APIs (`architecture.mjs:510-557`), security auth/validation/rate-limit (`security.mjs:115-187`), and operations monitoring (`operations.mjs:384-417`) are JS/Python-only. Rust and Shell projects render with no DB/API/security/observability nodes even when they use sqlx/diesel/tracing/argon2/etc.
4. **No monorepo support anywhere.** JS workspaces, TS project references, Rust `[workspace]` members, Python multi-package all collapse to a single root; bare imports to sibling/internal packages are unresolved → silently dropped edges.
5. **The normalized manifest drops most ecosystem fields.** JS `main`/`module`/`exports`/`engines`/`peerDependencies`/`workspaces`/`imports`; Rust `[workspace]`/`[features]`/`[build-dependencies]`/`[lib]`/`rust-version`; Python `[project.gui-scripts]`/`[project.entry-points]`/`requirements*.txt` content. This hides library posture, Node/MSRV version pinning, and dep visibility from every downstream scanner.
6. **Several "standards" are asserted, not detected.** PEP 484 (Python), `@typescript-eslint`/TSDoc (TS), rustfmt/clippy (Rust) are hardcoded for any repo of that language regardless of actual config — reads as observed finding but is an assumption.
7. **Conventions measure file-level naming only; symbol-level conventions are absent for every language** (camelCase fn, PascalCase type, SCREAMING const, async/await, custom exceptions, `set -euo pipefail` adoption, shebangs).
8. **Fixtures don't regression-guard the defects.** The TS fixture omits path aliases/`import type`/`.d.ts`/project refs; there are no Shell tooling test assertions; Rust fixture has no workspace/inline-tests. So the P0 fixes below have no test coverage today.

---

## Consolidated recommendations

### P0 — Correctness defects (produce wrong output now)

| # | Finding | Languages | Location |
|---|---|---|---|
| P0-1 | Strip `import type` / type-only specifiers before emitting architecture edges | TS (JS) | `architecture.mjs:327-333` |
| P0-2 | Resolve path aliases (`tsconfig`/`jsconfig` `paths`/`baseUrl`, `@`/`~`); preserve real `paths` map not boolean | JS, TS | `architecture.mjs:236-244,328-333`; `config.mjs:249` |
| P0-3 | Support multi-line parenthesized imports + PEP 420 namespace packages | Python | `architecture.mjs:201,301-326` |
| P0-4 | Fix docstring detection to look forward into the body, not `lines[i-1]` | Python | `conventions.mjs:518-528` |
| P0-5 | Classify relative imports before absolute (`relativeImports` is dead code) | Python | `conventions.mjs:155-160` |
| P0-6 | Read PEP 735 `[dependency-groups]` into `manifest.devDependencies` (not only `testing.mjs`) | Python | `manifest.mjs` (vs `testing.mjs:167-177`) |
| P0-7 | Remove `Cargo.toml` from rustfmt `files` list (rustfmt never reads Cargo.toml) | Rust | `ecosystem.mjs:312` |
| P0-8 | Fix `mod foo;` nested resolution (edition-2018 file-as-directory); drop `pkgRoot` fallback that invents edges | Rust | `architecture.mjs:260-271` |
| P0-9 | Support `use self::` / `use super::` | Rust | `ecosystem.mjs:316-319`; `architecture.mjs:334-345` |
| P0-10 | Detect `unsafe` blocks/fn/impl (primary Rust review signal) | Rust | `conventions.mjs` |
| P0-11 | Remove `shellcheck` from `testFrameworks` (it's a linter, not a test framework) | Shell | `ecosystem.mjs:267` |
| P0-12 | Fix shfmt false-positive: honor `marker` flag / parse `.editorconfig`, not bare existence | Shell | `ecosystem.mjs:273`; `config.mjs:170-176` |
| P0-13 | Remove or implement dead `beautysh` (`files:[]`) | Shell | `ecosystem.mjs:274` |
| P0-14 | Add a `shell` branch to `detectModuleSystem` (currently returns misleading "auto") | Shell | `conventions.mjs:348-378` |
| P0-15 | Unify comment-density: `conventions` reuse `documentation`'s triple-quote/`//`/`///`-aware logic; fix Rust `#`-only bug | Python, Rust | `conventions.mjs:408-451` |
| P0-16 | Add `bun.lock` to lockfiles + PM maps (Bun ≥1.2 default) | JS, TS | `ecosystem.mjs:111,193`; `stack.mjs:28`; `survey.mjs:63` |
| P0-17 | Add `node:test` to `testFrameworks` (the runner this skill itself uses) | JS, TS | `ecosystem.mjs:127-134` |
| P0-18 | Align ESLint flat-config detection: add `eslint.config.{ts,mts,cts}` to descriptors | JS, TS | `ecosystem.mjs:145-147` (TS mirror) |
| P0-19 | Add `*.spec.{js,mjs,cjs,jsx}` to JS `testFileGlobs` (parity with TS) | JS | `ecosystem.mjs:135` |
| P0-20 | Parse `[workspace]` so Rust workspace roots don't report zero deps | Rust | `manifest.mjs:231-255` |
| P0-21 | Make "language standards" detected-not-asserted (gate on actual config/deps) | Python, TS, Rust | `conventions.mjs:634-673` |

### P1 — Depth/breadth for a credible audit

- **Monorepo (all):** parse JS `workspaces`, TS project `references`, Rust `[workspace].members`, Python multi-package; resolve bare imports to internal/workspace packages.
- **Generic cross-cutting tables:** add Python (SQLAlchemy/psycopg/asyncpg/pymongo/anthropic/openai/boto3) and Rust (sqlx/diesel/rusqlite/sea-orm/tokio-postgres/redis/reqwest/hyper/aws-sdk/tonic) to C4 DBs/external-APIs; add Rust auth/validation/rate-limit crates (argon2/bcrypt/jsonwebtoken/validator); add Python (structlog/loguru/sentry-sdk/prometheus-client/opentelemetry) and Rust (tracing/opentelemetry/sentry) to operations monitoring; add cargo-audit/cargo-deny/rustsec to security.
- **Manifest normalization:** surface JS `main`/`module`/`exports`/`imports`/`engines`/`peerDependencies`/`workspaces`; Rust `[features]`/`[build-dependencies]`/`[lib]`/`rust-version`/`edition`; Python `[project.gui-scripts]`/`[project.entry-points]`/`requirements*.txt` content; render `requires-python`.
- **Rust depth:** represent `rustc` as type-checker; expand exports (`pub trait`/`pub use`/`pub(crate)`/`pub type`/`pub const`); distinguish crate root (`lib.rs` vs `main.rs` vs `[[bin]]`); distinguish external vs internal `use`; scan `src/**/*.rs` for inline `#[test]`/`#[cfg(test)]`.
- **TS depth:** expand tsconfig parsing (`noImplicitAny`/`moduleResolution`/`module`/`extends`/`references`/`composite`/`declaration`); remove `tsc` from `linters`; detect `@typescript-eslint` distinctly; first-class Deno/Bun (runtime probes + `deno.json`/`bunfig.toml`); detect declaration emit; exclude `.d.ts` from source set.
- **JS depth:** bundler/build detection (webpack/vite/rollup/esbuild/turbo); Node version pin (`engines.node`/`.nvmrc`); `module.exports = {}`/`exports.x` exports; detect monorepo tooling (turbo/nx/lerna).
- **Python depth:** multi-package import resolution; type-hint posture (real PEP 484 detection, `from __future__ import annotations`); expand config-file patterns (`setup.cfg:[mypy/isort/coverage:run]`, `tox.ini:[flake8]`, `.ruff.toml` in formatter list).
- **Conventions (all):** symbol-level naming, async/await, custom exception classes (JS), `set -euo pipefail` adoption ratio + shebang analysis (Shell), `Option`/`unwrap`/`anyhow`/`thiserror` (Rust).
- **Fix file-naming sampling** to source extensions only (`conventions.mjs:250`).
- **Test-framework breadth:** pytest-asyncio/xdist/mock, behave/robotframework (Python); ts-jest/@swc/jest/ts-node/tsx (TS); proptest/quickcheck/trybuild/rstest/criterion/mockall/insta (Rust); shellspec/shunit2 (Shell).

### P2 — Polish/completeness

- Additional linters/formatters/type-checkers: semgrep/pydocstyle/prospector/dlint, pytype/pyre/pyrefly, autopep8/yapf/blue/flynt (Python); standard/jshint/oxlint/dprint (JS); bashate (Shell).
- Ecosystem markers: `py.typed`/`MANIFEST.in`/`.python-version`/`runtime.txt`; `.cargo/config.toml`/`rust-toolchain.toml`/`build.rs`; `tsconfig.*.json`/`jsconfig.json`/`deno.json`/`bunfig.toml`.
- Runtime probe robustness: `python` fallback when no `python3`; `cargo --version`; `deno`/`bun` probes.
- Lockfile completeness: `pdm.lock`; lockfile version parsing (npm v1/v2/v3); yarn berry `.yarnrc.yml`.
- Shell breadth: script-to-script invocation graph, `.ksh`, Justfile, quoting/`local` metrics (defer to shellcheck integration over regex).
- **Expand fixtures** to regression-guard the P0 fixes: TS (path aliases, `import type`, `.d.ts`, project refs); Shell (tooling assertions); Rust (workspace, inline `#[test]`); Python (multi-line imports, namespace package, PEP 735).

---

## Coverage matrix (compressed; full per-language matrices in reviewer outputs)

| Dimension | Python | JavaScript | TypeScript | Shell | Rust |
|---|---|---|---|---|---|
| Tooling detection | Partial | Partial | Partial | Partial | Partial |
| Architecture/import graph | Partial (bugs) | Partial (aliases) | Partial (type-only bug) | Present (thin) | Partial (mod/self bugs) |
| Conventions | Partial (docstring bug) | Partial | Partial | Partial | Partial (comment-density bug) |
| Ecosystem/manifest | Present | Partial (fields dropped) | Partial | Partial | Partial (no workspace) |
| Cross-cutting (DB/auth/observability) | Absent in tables | Present | Present | Absent | Absent in tables |
| Monorepo | Absent | Absent | Absent | n/a | Absent |

---

## Bottom line

The overhaul delivered a **genuine multi-ecosystem foundation** (data-driven descriptors, shared parsers/enumerator/manifest reader, evidence-based scoring) and the headline `perplexity-cli` output is now accurate. The reviewers confirm the skill is **no longer JS-biased at the structural level**. However, **depth is uneven**: Python is closest to a real audit; JS/TS are solid-but-leaky at the import graph; Rust and Shell are first-class-but-shallow with several correctness defects. The single highest-leverage work is **fixing the import-graph accuracy across all languages (P0-1…P0-3, P0-8…P0-9)** plus **making the cross-cutting detection tables language-generic (systemic #3)** — together these would move every language from "Partial" toward a genuinely comprehensive audit.
