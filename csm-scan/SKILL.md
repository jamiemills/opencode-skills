---
name: csm-scan
description: Comprehensively analyze repositories to identify architecture patterns, code conventions, tooling, and operational norms — output a single NORMS.md with ASCII art and Mermaid C4 diagrams — use when onboarding to a new codebase, preparing a CSM plan, or running cross-repo convention audits; never runs target commands, installs, or writes beyond the single NORMS.md — read-only.
---

# CSM Scan

Read-only multi-ecosystem, multi-repo analysis tool. Scans one or more repositories to extract structure, technology stack, configuration, testing patterns, code conventions, git history, architecture, and seven additional evidence dimensions — producing a single `NORMS.md` output file. When more than one repository is scanned, the output also includes a global **Cross-repository Architecture** section. All runtime, build, test, and deployment findings come from committed static declarations; target commands are never executed.

## Tmux Session Bootstrap

Run this bootstrap before anything else — before any scan, test, or analysis command, and before any other section of this skill. It is not a scan step. It governs agent-driven skill sessions; direct human CLI runs of `scripts/scan.mjs` from a shell are outside its scope.

1. Check whether this invocation is already running inside tmux (the `TMUX` environment variable is set, or `tmux display-message -p '#session_name'` succeeds).
2. Skip starting a new session and proceed directly with the scan in the current context when any of these is true:
   - the invocation is already inside tmux;
   - the user or their prompt explicitly said not to use tmux or not to start a tmux session;
   - the user explicitly asked for a different terminal multiplexer (for example `screen` or `zellij`) — honor that choice instead and never start tmux alongside it;
   - tmux is not installed or cannot start a session — note this to the user and continue without tmux.

   When skipping because this invocation is already inside tmux, state the current tmux session name (for example via `tmux display-message -p '#session_name'`) and continue in it, so the session in use is always named.
3. Otherwise, start the orchestrating agent in a new detached tmux session before doing any scan work:
   - Derive a sensible, short, descriptive session name from the current session and the user's prompt, in the form `csm-scan-<goal-slug>` (lowercase, hyphen-separated, tmux-safe characters, truncated to a reasonable length).
   - If a tmux session with that name already exists, append a numeric suffix (`-2`, `-3`, ...).
   - Launch the same agent invocation carrying the user's original scan request inside the detached session, for example:
     `tmux new-session -d -s csm-scan-<goal-slug> 'opencode run "<original scan request>"'`
     adapting the exact command to the agent CLI actually in use so the scan work continues inside tmux.
4. Immediately print a clear notice naming the session so the user can attach later, for example:
   `Started tmux session "csm-scan-<goal-slug>". Attach to it later with: tmux attach-session -t csm-scan-<goal-slug>`
5. After printing the notice, end this invocation without performing any scan work; the tmux session performs the actual scan from the beginning of this skill. Only when the bootstrap was skipped under step 2 does this same invocation continue directly into the scan workflow below.

## When to use
- Onboarding to a new codebase
- Preparing a CSM plan for a repository
- Documenting architecture for handoff
- Auditing codebase conventions across multiple repos

## Interface

- Consumes: repository path(s), strictly read-only
- Produces: a single NORMS.md capturing 17 evidence dimensions
- Hands off: NORMS.md is consumed as a file by csm-plan, csm-bdd-tdd, csm-build, and csm-review — never via skill invocation
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-upload

## Dimensions

`csm-scan` reports **17 per-repository dimensions** (10 established plus 7 new) and one **global Cross-repository Architecture** section synthesized after per-repository validation:

| # | Dimension | Scope |
|---|-----------|-------|
| 1 | Repository Structure | ASCII directory tree with file-type counts; total-file and extension figures reported in both git-tracked and rg-scoped enumeration scopes with an explicit scope caveat |
| 2 | Technology Stack | runtime, language, framework, package manager, key dependencies, and optional-dependency groups (e.g. the `dev` extra) merged into the dev-dependency table |
| 3 | Configuration | lint, format, TypeScript, build, CI config summary, plus a declared-toolchain inventory (supplementary tools declared in dependency groups/extras and tool config sections) |
| 4 | Testing | test framework, file locations, naming patterns; test-file counting over real test modules only (fixtures/support/harness files excluded, counting rule disclosed); meta-test classification; network-guard, hypothesis-profile, property-manifest, coverage-authority, marker-lane and isolation-fixture facts |
| 5 | Code Conventions | import style, naming rules, error handling patterns, and measurement-universe-disclosed counts (async/await, docstrings, file naming, type hints over the production source tree, with the deliberate test/`__init__`/magic-method exemption); enforced agent conventions-block citation when declared |
| 6 | Git Practices | branch naming, commit conventions, templates; commit-style reported as an evidence-gated conventional-vs-task split over a 200-commit window; structured branch-pattern depth (e.g. `remediation/<date>/<id>/attempt-N`) |
| 7 | Architecture | canonical declared layer model (from `quality/architecture.toml` or equivalents: exact per-layer module counts, adapter-independence groups, composition roots, seam wiring) as the primary section when present, with the heuristic import-derived module graph/C4 clearly labelled; dynamic indicators, raw fan-in/fan-out and Tarjan SCC facts, coupling aggregates and SOLID indicators |
| 8 | Documentation | README, contribution, license, changelog, ADR, comment findings (single total-lines denominator), reference artifacts (e.g. QUALITY_GATES.md: RFC 2119 vocabulary, stable gate IDs, agent replication cards), SECURITY.md, and doc-validation toolchain |
| 9 | Security | detected secret patterns, authentication (including first-party auth/token subsystems), validation, security controls, tooling, dependabot evidence cross-referenced from branch lists, and gitleaks allowlist/ignore context |
| 10 | Operations | container, CI/CD, environment, health-check, monitoring, deployment findings; per-workflow action pins (SHA + version), permission asymmetry, per-job semantics (`runs-on`/`needs`/`if`/matrix/fail-fast), concurrency groups, and release-pipeline declarations (OIDC, skip-existing, triple-match) |
| 11 | API Surface | declared contracts, routes, RPC methods, events, CLI commands, public exports |
| 12 | Data Architecture | declared stores, schemas, migrations, entities, keys, explicit relations, ER/data-flow edges; dialect classification requires real framework signals (e.g. Django `models.Model` inheritance + import evidence) and test/fixture paths are excluded |
| 13 | Deployment Topology | bounded static Docker/Compose/Kubernetes/Helm/Terraform/CloudFormation/serverless declarations |
| 14 | Maintainability | disclosed measurement universe, generated/vendor boundaries, lexical branch-point counts, per-function cyclomatic-complexity distributions, exact duplicate spans, dead-code markers |
| 15 | Governance & Ownership | CODEOWNERS, policy, ADR, runbook, support, release, review, contribution, funding declarations |
| 16 | Assurance & Supply Chain | manifests, locks, pins, sources, licenses, SBOM/VEX/SARIF, tool results/configuration, accessibility, attestations, standards references |
| 17 | Development Practices (`DIM-practices-v1`) | declared methodology (`CLM-practices-methodology-v1`), enforcement (`CLM-practices-enforcement-v1`), automation (`CLM-practices-automation-v1`), rituals (`CLM-practices-rituals-v1`), quality gates (`CLM-practices-quality-gates-v1`), agent workflow (`CLM-practices-agent-workflow-v1`), and style-guide (`CLM-practices-style-guide-v1`) practices — including a comprehensive **Style Guide & Conventions** block: ruff rule families (live `select` separated from the ignore record, per-file ignores merged into it), line-length and quote-style values, docstring dialect, Makefile targets (pseudo-targets excluded from the count) with the `check` toggle model and `ci-quality` membership, lefthook piped-stage pipeline semantics (stage/job counts separate, stdin ownership) and gate-threshold values from `quality/gates.conf` (real string values, e.g. `semgrepseverity`), gate `CHECK_*` toggles, opencode deny rules with semantics, plugin inventory, declared-conventions headings from AGENTS.md/CONTRIBUTING.md, exceptions-hub detection with exit-code taxonomy and HTTP status mapping; plus policy-content facts: suppression `owner:/reason:` policy and fingerprint ratchet, mutation policy (exit codes, waivers unsupported), CSM/no-BDD methodology and plan-gate removal, fuzz replay contract, policy-validation tools, analyser-contract registry, and agent-workflow plugin behaviours and enforced conventions-block rules (tokenized); the Configuration section reports pyright/mypy strict flags, Testing reports the pytest marker taxonomy and diff-cover thresholds, the Architecture Craft Assessment reports import-linter contracts, and Maintainability reports a repo-wide aggregate complexity line |

## Supported ecosystems

`csm-scan` has first-class depth for five ecosystems, driven by a single declarative descriptor table that every scanner consumes:

| Ecosystem | Runtime (static) | Manifests | Lockfiles | PMs | Test frameworks |
|-----------|------------------|-----------|-----------|-----|-----------------|
| **Python** | declared (`requires-python`, `.python-version`, images) | `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile` | `uv.lock`, `poetry.lock`, `Pipfile.lock`, `pdm.lock` | uv, pip, poetry, pipenv, hatch | pytest, unittest, hypothesis, nox, tox |
| **JavaScript** | declared (`engines`, `.nvmrc`, images) | `package.json` | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb` | npm, yarn, pnpm, bun | node:test, Jest, Vitest, Mocha, Playwright, Cypress, AVA |
| **TypeScript** | declared (`engines`, `.nvmrc`, images) | `package.json`, `tsconfig.json` | (same as JavaScript) | (same as JavaScript) | (same as JavaScript) |
| **Shell** | declared (shebangs, workflow images) | — | — | none | bats, shellspec, shunit2 |
| **Rust** | declared (`rust-version`, images) | `Cargo.toml` | `Cargo.lock` | cargo | `cargo test`, `#[test]` |

Runtime and version findings are derived only from committed manifests, version files, workflows, and container images, each carrying source evidence. Co-existing or conflicting declarations are reported together with provenance; no "actual runtime" claim is made and no host runtime probe runs.

Depth by ecosystem:

- **Python**: Resolves absolute, relative, multiline, PEP 420, and multi-package imports; normalizes Python manifests and tooling; reports symbol naming, type hints, comments, architecture, security, operations, and test processes.
- **JavaScript**: Resolves ESM/CommonJS, workspace, package-export, and internal-package imports; normalizes package metadata and tooling; reports conventions, architecture, security, operations, and test processes across Node, Bun, and Deno signals.
- **TypeScript**: Resolves runtime imports, project references, and path aliases while excluding type-only edges; reports compiler options, annotations, manifests/tooling, conventions, architecture, security, operations, and test processes.
- **Shell**: Resolves sourced and invoked scripts; distinguishes shellcheck tooling from test frameworks; reports shebang and pipefail conventions, architecture, configuration, operations, and test processes.
- **Rust**: Resolves crate, nested-module, self/super, and workspace imports; normalizes Cargo metadata; reports rustc/tooling, unsafe and error-handling conventions, architecture, security, monitoring, and inline/integration tests.

Other ecosystems (Go, Java, Ruby, …) are **recognized as stubs**: survey still enumerates their files and languages, but no first-class detector claims their source semantics. They receive **generic artifact-only evidence** (path, extension, size, manifest, lockfile, and known-artifact metadata) through the generic fallback. A declarative skill-local plugin can add bounded evidence for them; add a descriptor in `lib/scan/shared/ecosystem.mjs` to promote one to first-class.

## Pipeline

The canonical pipeline is exported once from `lib/scan/pipeline/run.mjs` and used by both the CLI and the test suite:

```text
survey -> registry-driven deep scans (17 dimensions, parallel)
       -> provider/plugin/generic evidence merge
       -> enrich + validate (expected-claim coverage, retry below threshold)
       -> global cross-repository synthesis
       -> deterministic render -> one write
```

`lib/scan/registry/dimensions.mjs` owns the ordered 17-dimension registry: canonical order, expected claim IDs, applicability predicates, retryability, provider capability, and renderer IDs. `lib/scan/render/registry.mjs` registers all 17 per-repo renderers plus the Cross-repo global renderer in dimension order and fails typed on unknown, missing, or duplicate renderers.

A shared foundation in `lib/scan/shared/` is the single source of truth that every scanner consumes — no scanner hardcodes its own language map:

| Module | Responsibility |
|--------|----------------|
| `shared/ignore.mjs` | Canonical ignore vocabulary (`.hypothesis`, `node_modules`, `dist`, `target`, `.cache`, `.git`, …) |
| `shared/enum.mjs` | File enumerator — walks the repo once through the command broker, filters ignored paths, computes real byte sizes |
| `shared/parse.mjs` | Zero-dependency TOML and YAML parsers |
| `shared/manifest.mjs` | Normalized manifests, dependencies, entry points, version pins, and workspace metadata |
| `shared/ecosystem.mjs` | Data-driven ecosystem descriptors (table above) + `detectEcosystems()` |
| `shared/detection.mjs` | Generic database, external API, authentication, validation, rate-limit, monitoring, and security-tool maps |
| `shared/comments.mjs` | Single language-aware comment metric source for conventions and documentation |
| `shared/command.mjs` | Sole production child-process owner — a broker accepting command IDs with exact `rg`/Git argv forms |
| `shared/privacy.mjs` | Output-safe evidence serialization, redaction, opaque identities, SARIF/SBOM projections |
| `shared/artifacts.mjs` | Bounded reads, normalized repository-relative references, search-space records |
| `shared/declarations.mjs` | Static declaration extraction from supported artifacts with unsupported-construct diagnostics |

Deep scanners (`lib/scan/deep/*.mjs`) and the new-dimension extractors (`deep/api`, `deep/data`, `deep/deployment`, `deep/maintainability`, `deep/governance`, `deep/assurance`) consult these primitives instead of repeating language maps. Contracts live in `lib/scan/contracts/`; provider catalogs in `lib/scan/providers/`; cross-repository synthesis in `lib/scan/cross-repo/`; standards metadata in `lib/scan/standards/`; the declarative plugin loader in `lib/scan/plugins/`.

## Static command boundary

All production subprocesses go through one broker, `lib/scan/shared/command.mjs`. It accepts **command IDs**, not arbitrary executables or arguments:

- `rg --files` and `rg --json` (with the canonical ignore-argument set and a bounded literal pattern)
- Read-only Git queries (`rev-parse --show-toplevel`, `rev-parse --abbrev-ref HEAD`, `log --oneline -50`, `branch -a`, `symbolic-ref refs/remotes/origin/HEAD`, `config --get remote.origin.url`, `shortlog -s -n HEAD`)

Every execution uses an exact argv array, `shell: false`, a reduced environment, timeouts, output caps, disabled Git prompts/pagers, and `GIT_OPTIONAL_LOCKS=0`. Target runtime/build/test/deploy/scanner commands, shell strings, pipes, redirects, `find`, and runtime probes are absent; `rg` exit 1 means no match only after a completed bounded search. Command timeouts, truncation, and invalid output yield `unverified`/`unsupported`, never absence.

## Evidence model

Every claim carries a stable claim ID, a status, a coverage state, limitations, and admissible evidence IDs (`lib/scan/contracts/dimension.mjs`, `evidence.mjs`). Statuses:

| Status | Meaning |
|--------|---------|
| `observed` | Direct admissible static evidence |
| `inferred` | Deterministic authored derivation with input evidence IDs |
| `not_detected` | Complete, supported, uncapped, readable search found no evidence |
| `unsupported` | Applicable format/ecosystem has no approved detector |
| `unverified` | Applicable inspection was incomplete, capped, unreadable, malformed, ambiguous, or failed |
| `not_applicable` | Registry applicability predicate proven false by positive evidence |

Coverage counts complete eligible claims divided by all eligible claims. `not_applicable` and `unsupported` are separately counted; `unverified` remains uncovered. Evidence IDs are deterministic hashes of claim, detector, source kind, repository-relative path, stable locator, and matched key — never absolute paths, secrets, identities, timestamps, or scan order.

## Privacy

Privacy filtering occurs **before** findings persistence, enrichment, console diagnostics, and Markdown. Output excludes emails, personal names, raw CODEOWNERS identities, raw commit subjects, absolute paths (POSIX/Windows/UNC), URL credentials/query/fragment, secrets, SARIF messages/snippets/code flows, SBOM contacts/serials/download/VCS URLs/hashes, and arbitrary result excerpts. Git contributors become aggregate counts; ownership identities become report-local opaque tokens. CLI stdout/stderr and errors pass a sanitized reporter boundary. SARIF and SBOM input is projected to bounded, identifier-only metadata. Sensitive values in scanner models, plugin observations, and the global cross-repo snapshot abort the run before the sole write.

## Plugins

Plugins are **strict declarative JSON data** loaded only from a trusted skill-local root: `<skill root>/plugins/<plugin-id>/plugin.json`. The loader enforces lexical/realpath containment, direct-child layout, symlink rejection, API-version and strict-schema validation, deterministic ordering, duplicate detection, and atomic publication. Plugin JSON may contain bounded declarative artifact rules and renderer-safe labels for the **15 provider dimensions** (all dimensions except Structure and Git). It cannot contain executable hooks, imports, commands, Markdown templates, or arbitrary paths; no plugin code is evaluated. Plugin and generic observations are merged into provider-dimension findings after the deep scans, appended after (never replacing) built-in findings, and rendered with provider provenance. Removing a plugin routes the same unknown-language repository through the **generic artifact-only fallback**, which never claims source syntax, import edges, effective runtime behavior, or first-class depth.

## Standards

The standards registry records versioned metadata only: publisher, exact edition, publication date, authoritative URI, and a disposition. Unknown or restricted reuse deterministically becomes `metadata_only`; no control text is copied or stored, and no undecided disposition can reach assurance reporting. Registry entries bind a stable edition key to their exact edition and reject floating markers.

## Parser caps and disclosure

Every detector applies file, byte, record, and depth caps with deterministic truncation and visible omitted counts. Unsupported constructs (templates, anchors, macros, remote modules, dynamic identities, name-only relations) are disclosed as `unsupported`/`unverified` diagnostics and are never evaluated or turned into fabricated facts. `not_detected` is emitted only after a complete, supported, uncapped, readable search.

## Determinism

Identical immutable inputs, a fixed clock, the same plugin set, and the same repository order produce **byte-identical Markdown** with deterministic dimension, claim, provider, evidence, and edge ordering, LF line endings, and exactly one terminal newline. Unknown renderer IDs, schema violations, privacy violations, or plugin errors abort before the sole write.

## Constraints (non-negotiable)

- **Read-only**: Never modifies scanned repos — only the broker's registered `rg`/Git read-only argv forms execute; target commands and shell execution are absent
- **Single output file**: Exactly one `writeFile(outPath, content)` call — no config files, lockfiles, temp files, or any other writes
- **Zero npm dependencies**: Node.js built-ins only (`node:fs`, `node:path`, `node:child_process`)
- **No installs, no builds**: Never installs dependencies or runs build commands in scanned repos
- **Deterministic**: Fixed inputs produce byte-identical output

## Output

A single `NORMS.md` file beginning with a `format: csm-norms/1` frontmatter marker, containing one section per scanned repository with the 17 dimensions above, in canonical order, followed by the global **Cross-repository Architecture** section. Each repository also receives a **Cross-observations** section when facts from its scanned dimensions coexist in a relationship reported by enrichment.

Enrichment metadata records factual detection coverage and the observed, inferred, unverified, unsupported, or not-applicable basis of findings. A `### Coverage Basis` table defines the basis vocabulary used across dimensions.

## Typical workflow

1. Run `csm-scan` against the target repo(s)
2. Review `NORMS.md` for architecture, conventions, tooling, and the additional evidence dimensions
3. Feed findings into `csm-plan` for a new CSM plan

## CLI

`scripts/scan.mjs` is a zero-dependency Node CLI wrapping the same canonical pipeline the test suite exercises:

```bash
node scripts/scan.mjs [--repos <path>...] [--out <path>] [--verbose]
```

- **Zero-argument default** — with no `--repos`, the current working directory is scanned; with no `--out`, the report is written to `NORMS.md` in the current directory.
- `--repos <path>...` — one or more repository paths to scan (default: current working directory).
- `--out <path>` — output file (default: `NORMS.md` in the current directory).
- `--verbose` — write an unredacted local diagnostic trace (reporter lines + per-stage durations) to `.csm-scan-debug.log` next to `--out` — never to stdout. Delete it after debugging.
- `--help` — print the full usage text and exit 0.
- `--version` — print the version (package.json `version`, else the git commit hash, else `csm-scan`) and exit 0.
- **Errors (exit 2)** — an unknown flag, a missing `--out` value, or a `--repos` path that is not a directory or does not exist is reported on stderr with a usage hint and the process exits with status **2**.
- `--repos` with no value is not an error — it defaults to the current working directory (exit 0).
- An unwritable `--out` path is a pipeline error: the scan fails at the write step and the process exits with status **1**.
- **Privacy** — report contents are privacy-safe: absolute paths, identities, and secrets are redacted before they reach the report and pipeline stdout/stderr. Exception: user-typed CLI arguments (for example a `--repos` path named in an error message) are echoed verbatim on stderr.

## Testing

Zero-dependency test suite built on `node:test`:

```bash
node --test --test-concurrency=1                                    # authoritative full suite
node --test --test-concurrency=1 test/expansion-final-acceptance.test.mjs  # T228 acceptance matrix
node --test --test-concurrency=1 test/expansion-baseline.test.mjs   # T201 executable baseline (five fixture pipelines + 21 P0 cases)
node --test --test-concurrency=1 test/expansion-constraints.test.mjs # command / one-write / zero-dependency gates
node --test --test-concurrency=1 test/expansion-fixtures.test.mjs   # five-ecosystem + generic fixtures on the canonical pipeline
node --test --test-concurrency=1 test/expansion-determinism.test.mjs # byte determinism gates
node --test --test-concurrency=1 test/expansion-privacy-gate.test.mjs # privacy canary gates across every sink
node --test --test-concurrency=1 test/expansion-voice-gate.test.mjs  # neutral factual voice gate for expanded prose
node --test --test-concurrency=1 test/voice-gate.test.mjs            # established neutral voice gate
node --test --test-concurrency=1 test/golden.test.mjs                # five ecosystems + real-repo golden
```

Tiered runs (S/M/L) are driven by `test/scripts/run-tier.mjs` with the partition declared in `test/scripts/tiers.mjs`:

```bash
node test/scripts/run-tier.mjs s      # S tier — default (parallel) concurrency
node test/scripts/run-tier.mjs m      # M tier — serial
node test/scripts/run-tier.mjs l      # L tier — serial
node test/scripts/run-tier.mjs all    # whole suite — serial (authoritative)
```

The tier manifest is a complete, non-overlapping partition of every `test/*.test.mjs` file, frozen from the POST-T002 file set. While it is still the placeholder, every `run-tier` invocation fails loudly (exit 1) instead of silently running nothing. Both `tiers.mjs` and `run-tier.mjs` carry the `NODE_TEST_CONTEXT` inert guard (same pattern as `coverage-gate.mjs`), so `node --test` discovery does not add phantom tests or distort coverage instrumentation.

`node --test --test-concurrency=1` is authoritative because default parallel mode can race filesystem-heavy fixture tests. Fixtures live under `test/fixtures/` and `test/fixtures-expansion/`, each exporting a `files` map consumed by `test/harness.mjs`'s `withFixture`. The suite covers shared primitives, all 17 dimensions, enrich, validate, write, the 21-case P0 regression matrix, the voice gates, privacy gates, determinism gates, constraint gates (command boundary, one write, zero dependencies), plugin boundary tests, multi-repo cross-repository synthesis, and end-to-end pipeline behavior — no installs required.

- `CSM_SCAN_REAL_REPO=<path>` — when set to an existing repository, the real-repo tests scan it instead of the checked-in fallback; full-strength scale expectations apply only when the repo is identified as pxcli, otherwise expectations are scaled to the fallback fixture. When unset (or empty), the same tests run against `test/fixtures-real/pxcli-mini` — the suite is green on any machine with no `$HOME`-path dependency.
- `node test/scripts/coverage-gate.mjs` — coverage gate: runs the full suite under `--experimental-test-coverage` and enforces the ≥88% line-coverage floor (run on Node ≥22; not wired to CI).

- Record pass count + wall time at every gate run.
