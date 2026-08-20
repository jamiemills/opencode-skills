# opencode-skills

A collection of [OpenCode](https://opencode.ai) agent skills built around the **CSM (cyclic state machine)** workflow: relentless idea grilling (`csm-grill`), rigorous, evidence-based planning (`csm-plan`), optional BDD/TDD spec mutation (`csm-bdd-tdd`), resumable plan execution (`csm-build`), and adversarial repository review (`csm-review`) — supported by repository analysis (`csm-scan`), Dockerized browser automation (`csm-browse`), and evidence publishing (`csm-upload`).

> **Progressive disclosure:** this README is the index. Each skill's commands, flags, examples, and full reference live in its `SKILL.md`, linked from the [Skills](#skills) table below.

## Table of contents

- [The CSM workflow](#the-csm-workflow)
- [Skills](#skills)
- [Composition matrix](#composition-matrix)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Repository layout](#repository-layout)
- [Development & testing](#development--testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## The CSM workflow

```mermaid
flowchart LR
    grill["csm-grill<br/>idea → agreed phased approach"] -.->|"phase briefs"| plan["csm-plan<br/>brief → saved, verified plan"]
    scan["csm-scan<br/>repo(s) → NORMS.md"] -.->|"optional conventions input"| plan
    scan -.->|"optional conventions input"| bdd["csm-bdd-tdd<br/>optional: plan → BDD/TDD spec package"]
    scan -.->|"optional conventions input"| build["csm-build<br/>plan → verified implementation"]
    scan --> review["csm-review<br/>repo(s) → adversarial review"] -->|"review findings"| plan
    plan --> bdd
    bdd --> build
    plan -->|"without mutation"| build
    build -->|"delivery"| browse["csm-browse<br/>image/video evidence of delivery"] -->|"evidence"| upload["csm-upload<br/>evidence → GitHub Pages demo site"]
```

> **Edge semantics:** dashed edges are optional, human-invoked inputs (for example feeding the `NORMS.md` conventions from `csm-scan` into `csm-plan`, `csm-bdd-tdd`, `csm-build`, or `csm-review` — csm-review consumes `NORMS.md` via its `## NORMS.md` section, optionally like the others). `review --> plan` is a **human-in-the-loop** feed of review findings into a subsequent plan run — not an automatic edge; a review never writes a plan by itself.

The core loop: **grill** an idea into an agreed phased approach, **scan** a repository for its conventions, **review** it adversarially for defects and security risks, **plan** the work as a numbered, resumable state machine, optionally **mutate** the plan into strict BDD/TDD form, then **build** it with parallel subagents, checkpoints, and review cycles. After delivery, **browse** captures image/video evidence of the build and **upload** makes it available to the user.

Each stage is a separate, explicitly invoked skill — planning never silently becomes implementation, and execution always starts from a saved plan on disk.

## Skills

| Skill | Purpose | Reference |
|---|---|---|
| `csm-grill` | Grill an idea into an agreed, phased approach — a relentless one-question-at-a-time interview backed by research subagents, cycling until you agree; each phase is a ready-made brief for a future csm-plan run. Never plans or implements. | [csm-grill/SKILL.md](csm-grill/SKILL.md) |
| `csm-plan` | Turn a brief into an evidence-based, executable, resumable implementation plan — research, critique, verify, save, stop. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-plan-<goal-slug>`) and tells you how to attach. Never implements. | [csm-plan/SKILL.md](csm-plan/SKILL.md) |
| `csm-bdd-tdd` | Mutate a saved plan into a strict BDD+TDD package: formal spec, executable Gherkin scenarios, unit test designs, and a traceable mutated plan. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-bdd-tdd-<goal-slug>`) and tells you how to attach. | [csm-bdd-tdd/SKILL.md](csm-bdd-tdd/SKILL.md) |
| `csm-build` | Execute a saved CSM plan with parallel subagents, durable checkpoints, and review/repair cycles until verified complete. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-build-<goal-slug>`) and tells you how to attach. | [csm-build/SKILL.md](csm-build/SKILL.md) |
| `csm-scan` | Read-only multi-repo analysis producing a single `NORMS.md`: 17 evidence dimensions (structure, stack, conventions, architecture, security, data, deployment, and more) with Mermaid C4 diagrams. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-scan-<goal-slug>`) and tells you how to attach. | [csm-scan/SKILL.md](csm-scan/SKILL.md) |
| `csm-review` | Adversarial repository review — a multi-agent defensive sweep that gathers evidence across a review-dimension spine (correctness, technical debt, security, secrets, dependencies, and more), challenges each finding, and saves a review report. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-review-<goal-slug>`) and tells you how to attach. Never fixes. | [csm-review/SKILL.md](csm-review/SKILL.md) |
| `csm-deep-research` | Deep research, R&D, and validation queries answered with one dated, exhaustively cited research finding — a standalone triage → parallel researchers → adversarial challenge → judge → verify pipeline that saves to `.agents/research/`. Unless already inside tmux or told otherwise, it first starts its orchestrating agent in a detached tmux session (named `csm-deep-research-<goal-slug>`) and tells you how to attach. Never writes outside the research document and its declared run artifacts (e.g. a requested `.json` file). | [csm-deep-research/SKILL.md](csm-deep-research/SKILL.md) |
| `csm-browse` | Drive an isolated Chromium inside the `chromium-vnc` Docker container via CDP: navigate, click, type, log in, screenshot, inspect DOM, capture console/network/performance, record video. | [csm-browse/SKILL.md](csm-browse/SKILL.md) |
| `csm-upload` | Upload screenshots, videos, and evidence files to a GitHub Pages demo site under a unique dated page name. | [csm-upload/SKILL.md](csm-upload/SKILL.md) |

<!-- csm-matrix:start -->
## Composition matrix

How each skill composes — standalone entry conditions, what it consumes and produces, and how work hands off. Generated from `scripts/lib/contracts.mjs`; regenerate with `node scripts/gen-readme-matrix.mjs --write`.

| Skill | Standalone entry | Consumes | Produces | Hands off |
|---|---|---|---|---|
| `csm-grill` | idea shared, explicit request to be grilled, interviewed, or stress-tested | rough idea, repository and research evidence, optional csm-deep-research findings when dispatched | agreed phased approach document | phase briefs to a separately invoked csm-plan |
| `csm-plan` | brief or phase brief, explicit planning request | idea or phase brief, repository conventions, review findings, optional csm-deep-research findings when dispatched | saved, verified CSM plan | saved plan to csm-bdd-tdd or csm-build |
| `csm-bdd-tdd` | saved CSM plan, explicit BDD/TDD mutation request | saved plan, repository conventions | formal spec, Gherkin scenarios, unit test designs, mutated CSM plan | mutated plan to csm-build |
| `csm-build` | saved CSM plan, explicit implementation request | saved plan, optional NORMS.md, BDD/TDD package when present | verified implementation, delivery evidence | delivery to csm-browse |
| `csm-review` | repository target, explicit review, audit, or assessment request | repository at a pinned commit, optional NORMS.md | dated findings report | review findings to a subsequent csm-plan run |
| `csm-scan` | repository target, scan or conventions-analysis request | committed repository declarations | NORMS.md | optional conventions input to csm-plan, csm-bdd-tdd, csm-build, or csm-review |
| `csm-browse` | need to drive a headful Chromium browser | browser session, CDP verbs, delivery target | screenshots, videos, DOM, console, network, or performance evidence | evidence files to csm-upload |
| `csm-upload` | evidence files ready, configured GitHub Pages destination | screenshots, videos, or evidence files, GitHub configuration | dated GitHub Pages demo page | published evidence URL to the user |
| `csm-deep-research` | research question or topic, explicit deep-research request, dispatch from csm-grill or csm-plan | research question, retrievable sources (web, docs, repositories) | dated research document at .agents/research/<yyyy-mm-dd>-<slug>-research.md, optional declared run artifacts at .agents/research/artifacts/<yyyy-mm-dd>-<slug>-<name>.<ext> (e.g. a JSON schema) | research document and any declared run artifacts to the user or a dispatching csm-grill or csm-plan |
<!-- csm-matrix:end -->

## Requirements

- **[OpenCode](https://opencode.ai)** — these are OpenCode skills.
- **Node.js >= 22** — for `csm-browse` (see `csm-browse/package.json`) and for running the `csm-scan` test suite (`node:test`). `csm-scan` itself is zero-dependency Node built-ins only.
- **pnpm >= 10** (corepack-managed; the root `package.json` pins `packageManager: pnpm@10.33.0`) — the repo's only package installer, for root tooling (lefthook + oxlint) and `csm-browse`.
- **Universal bootstrap runtime** — the delivered bootstrap flow needs only `node` and `npx`; Node >= 22 is recommended for the development gates (see [Development & testing](#development--testing)).
- **Docker** with the `chromium-vnc` container — `csm-browse` only.
- **`gh` CLI**, authenticated, plus a GitHub Pages-enabled repository — `csm-upload` only.
- **tmux** — optional. When available and not already running under tmux (and not opted out of), the `csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-scan`, `csm-review`, and `csm-deep-research` skills start their orchestrating agent in a detached tmux session so long-running work survives a dropped terminal; each prints its session name and how to attach; without tmux they proceed in the current session.
- **ffmpeg** — optional, but required by `csm-browse` for full-page screenshots (image stitching) and video screencasts; capture degrades to viewport-only shots and no recording when it is missing.
- **curl** — optional, but used by `csm-browse`'s `ensure-browser.mjs` to probe the CDP endpoint readiness.

## Installation

Clone this repository into your OpenCode skills directory (or copy the nine skill folders into an existing one):

```bash
git clone git@github.com:jamiemills/opencode-skills.git $HOME/.config/opencode/skills
```

Restart OpenCode so it picks up the skills. `csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-grill`, `csm-scan`, `csm-review`, `csm-upload`, and `csm-deep-research` need no further setup.

`csm-browse` has runtime dependencies — install and verify:

```bash
cd $HOME/.config/opencode/skills/csm-browse
pnpm install
node -e "require('chrome-remote-interface'); console.log('ok')"
node scripts/check-skill.mjs
```

Optionally activate the local lefthook pre-commit gate (unstaged guard + conformance + syntax + staged oxlint; bypass with `--no-verify`):

```bash
node scripts/install-hooks.mjs
```

`install-hooks.mjs` installs the root devDependencies via `pnpm install --frozen-lockfile --ignore-scripts` (lefthook + oxlint) and installs the lefthook pre-commit gate.

Dependency inventory: the root `pnpm-lock.yaml` (integrity-hashed) is authoritative for the hook tooling (lefthook + oxlint) and `csm-browse/pnpm-lock.yaml` for csm-browse; regenerate a CycloneDX SBOM opportunistically with `npx cyclonedx-npm --output-file sbom.json` — no SBOM tooling is installed by this repo.

### Universal agent bootstrap (no clone)

Any capable AI agent can install this skill collection from a single URL, without cloning the repository, once the envelope is hosted — envelope hosting and npm publication are future release steps (`bootstrap/release-checklist.md`); until then the committed fixture and the deterministic packed artifact from `node scripts/pack-bootstrap.mjs` validate the flow. The URL serves a signed canonical envelope (schema `csm-bootstrap`, version 2): structured, signature-bound policy — fixed package, bin, payload manifest, limits — plus a digest-bound `steps_markdown` field whose Markdown steps are guidance only and can never add commands, paths, package names, or shell policy (`bootstrap/schema.json`, `bootstrap/steps.md`).

- **Trust root first** — a URL cannot choose its own executable. Approve the fixed package `@jamiemills/csm-skills-bootstrap@0.1.0` and bin `csm-skills-bootstrap` (plus its signing key) before use.
- **Agent-owned protocol** — the agent discovers its own Agent Skills location, asks the user when ambiguous, places only hash-verified payload files, and reports destination, hashes, reload action, and rollback limits. States (`DISCOVER -> TRUST -> PLAN_DESTINATION -> CONFIRM_IF_NEEDED -> MATERIALIZE -> VERIFY -> REPORT`) and refusal codes are specified in `bootstrap/protocol.md`.
- **Exact npx invocation** — `--ignore-scripts` always; offline is cache-warmed only — it replays a previously verified warm cache and fails closed with no network fallback:

  ```bash
  npx --yes --ignore-scripts --no-audit --no-fund --package=@jamiemills/csm-skills-bootstrap@0.1.0 csm-skills-bootstrap --version
  npx --offline --no-install --yes --ignore-scripts --no-audit --no-fund --package=@jamiemills/csm-skills-bootstrap@0.1.0 csm-skills-bootstrap --version
  ```

- **Capability boundary** — the flow needs exactly three capabilities: read an HTTPS URL, write files, and invoke exact `npx`. Agents lacking one receive a safe refusal, not a guessed fallback.

## Quickstart

The core loop is **grill → plan → build**:

1. **Grill** an idea — invoke `csm-grill` to be interviewed one question at a time until the phased approach is agreed and each phase is a ready-made brief for the next step.
2. **Plan** — invoke `csm-plan` with a brief; it researches, critiques, verifies, and saves a numbered, resumable plan.
3. **Build** — invoke `csm-build` with the saved plan; it executes with parallel subagents, durable checkpoints, and review/repair cycles until verified complete.

Optional: `node scripts/install-hooks.mjs` installs the root devDependencies and enables the fast lefthook pre-commit gate.

The plan and build steps start in a detached tmux session unless you're already inside tmux or declined — say **"no tmux"** to keep the run in-session.

Optional gates around the loop: **`csm-scan`** to capture repository conventions into `NORMS.md` before planning, and **`csm-review`** to adversarially audit a repository (or a completed build) for defects and security risks before delivery.

See [Usage](#usage) for the full sequence.

## Usage

The six orchestration skills (`csm-grill`, `csm-plan`, `csm-bdd-tdd`, `csm-build`, `csm-review`, and `csm-deep-research`) are invoked by name in an OpenCode session — e.g. *"use csm-plan to make a plan for adding OAuth login"*. The three tooling skills (`csm-scan`, `csm-browse`, `csm-upload`) also expose a CLI under their `scripts/` directories. **Commands, flags, examples, and full reference for each skill live in its `SKILL.md`** (see the [Skills](#skills) table); for `csm-scan`, the CLI flags are documented in [csm-scan/SKILL.md](csm-scan/SKILL.md) (`## CLI`).

`csm-scan` is **orchestration-shaped tooling**: it runs the same tmux session bootstrap as the orchestration skills (a scan starts in a detached `csm-scan-<goal-slug>` session unless you're already inside one or declined) but is at heart a CLI tool — so it still counts among the three tooling skills below.

Typical sequence:

1. **Grill** an idea into agreed phases — `csm-grill` (each phase becomes a brief for the next step).
2. **Scan** a repo for conventions (optional) — `csm-scan` → `NORMS.md`; when run as a skill it starts in a detached tmux session (`csm-scan-<goal-slug>`) unless you're already inside one or declined.
3. **Review** the repo adversarially (optional) — `csm-review` → `.agents/reviews/<date>-<repo>-review.md`.
4. **Plan** the work — `csm-plan` → `.agents/plans/<date>-<goal>-csm.md`. Unless you're already in tmux or asked not to use it, this starts a detached tmux session (`csm-plan-<goal-slug>`) that prints its name and runs the planning there; attach with `tmux attach-session -t <name>` or say "no tmux" to keep it in-session.
5. **Mutate** to BDD/TDD (optional) — `csm-bdd-tdd`; starts in a detached tmux session (`csm-bdd-tdd-<goal-slug>`) unless you're already inside one or declined.
6. **Build** it — `csm-build`, preferring any BDD/TDD-mutated plan; starts in a detached tmux session (`csm-build-<goal-slug>`) unless you're already inside one or declined.
7. **Capture** image/video evidence of the delivery and **publish** it — `csm-browse` → `csm-upload`.

Planning never silently becomes implementation, and execution always starts from a saved plan on disk.

## Repository layout

```
.
├── bootstrap/         # universal agent bootstrap: signed envelope, payload package, protocol, steps
├── csm-grill/         # SKILL.md — the idea-grilling interview
├── csm-plan/          # SKILL.md — the planning state machine
├── csm-build/         # SKILL.md — the plan execution engine
├── csm-bdd-tdd/       # SKILL.md — BDD/TDD plan mutation
├── csm-scan/          # repository analyzer → NORMS.md
│   ├── lib/scan/      # pipeline, dimension registry, scanners, providers, renderers
│   ├── scripts/       # scan.mjs CLI
│   └── test/          # node:test suite + fixtures
├── csm-review/        # SKILL.md — the adversarial repository reviewer
├── csm-deep-research/ # SKILL.md — the deep-research state machine
├── csm-browse/        # CDP browser automation
│   ├── lib/           # CDP client, docker, session, recorder, verb implementations
│   ├── scripts/       # browse.mjs, ensure-browser.mjs, session-daemon.mjs, check-skill.mjs
│   └── tests/         # e2e + fixtures (requires Docker)
├── csm-upload/        # evidence upload to GitHub Pages
│   └── scripts/       # upload.mjs
├── tests/             # bootstrap conformance: trust, package audit, protocol, offline, integration
├── scripts/           # suite tooling
│   ├── check-suite.mjs            # repo-wide conformance gate
│   ├── sync-skill-boilerplate.mjs # regenerate/verify shared SKILL.md sections
│   ├── gen-readme-matrix.mjs      # regenerate the composition matrix from contracts
│   ├── install-hooks.mjs          # one-time pre-commit hook installer
│   ├── pack-bootstrap.mjs         # deterministic npm pack of the bootstrap package
│   ├── hooks/                     # tracked git hooks (core.hooksPath target)
│   │   └── pre-commit             # lefthook shim — pre-commit gate (guard + check-suite + syntax + oxlint staged)
│   └── lib/                       # shared data + templates
│       ├── contracts.mjs          # MANIFEST, CONTRACTS, INTERFACES, NEVER_INVOKE, FORMAT_VERSIONS, NORMS_PHRASES
│       └── boilerplate.mjs        # canonical tmux-bootstrap + resilience templates
├── .agents/           # process artifacts: plans/, docs/, reviews/, approaches/ (indexed in .agents/README.md)
├── .lefthook.yml      # pre-commit gate definition (guard + check-suite + syntax + oxlint staged)
├── package.json       # root tooling manifest: lefthook + oxlint devDeps, packageManager pnpm@10.33.0
└── pnpm-lock.yaml     # hook-tooling dependency lockfile
```

## Development & testing

- `node scripts/check-suite.mjs`   # repo-wide conformance gate (frontmatter, sections, state lines, README integrity, corpora, interfaces, boilerplate drift, matrix drift)
- `node scripts/sync-skill-boilerplate.mjs --check`   # boilerplate drift (also gated by check-suite + pre-commit); `--write` regenerates
- `node scripts/gen-readme-matrix.mjs --check`        # composition-matrix drift (also gated); `--write` regenerates
- `pnpm install --frozen-lockfile --ignore-scripts && pnpm exec lefthook install --force`  # install root devDeps and enable the local lefthook pre-commit gate (bypass: `git commit --no-verify`)
- `node --test scripts/hooks/test/pre-commit.test.mjs`  # hook test suite (lefthook shim + `.lefthook.yml` validation + staged-only oxlint)
- `make lint`   # repo-wide oxlint with the committed quality bar (`.oxlintrc.json`: correctness + suspicious categories, warnings-as-errors); the pre-commit hook enforces the same bar on staged files, and `scripts/check-suite.mjs` includes a conditional repo-wide lint gate (skipped with a notice when oxlint is not installed)
- **Universal bootstrap suites** — envelope trust, package audit, protocol conformance, offline boundary, and the cross-task integration flow; `node scripts/pack-bootstrap.mjs` prints the deterministic tarball digest:

  ```bash
  node --test tests/bootstrap-trust.test.mjs
  node --test tests/package-audit.test.mjs
  node --test tests/protocol/*.test.mjs
  node --test tests/offline/*.test.mjs
  node --test tests/integration/*.test.mjs
  node --test tests/resume-semantics.test.mjs
  node scripts/pack-bootstrap.mjs
  ```

- **csm-scan** — zero-dependency `node:test` suite, run from the skill directory:

  ```bash
  cd csm-scan
  node --test --test-concurrency=1              # authoritative full suite
  node test/scripts/run-tier.mjs s             # S tier (parallel concurrency)
  node test/scripts/run-tier.mjs m             # M tier (serial)
  node test/scripts/run-tier.mjs l             # L tier (serial)
  node test/scripts/run-tier.mjs all           # whole suite (serial)
  ```

  Serial mode (`--test-concurrency=1`) is authoritative; default parallel mode can race the filesystem-heavy fixture tests. The tier runner (`test/scripts/run-tier.mjs`) and its manifest (`test/scripts/tiers.mjs`) are inert under `node --test` discovery via the `NODE_TEST_CONTEXT` guard; the manifest is a complete, non-overlapping partition of every `test/*.test.mjs` file, frozen from the POST-T002 file set — until then every `run-tier` invocation fails loudly instead of running nothing. See [csm-scan/SKILL.md](csm-scan/SKILL.md) for focused gate commands (determinism, privacy, constraints, golden, and more).

- **csm-browse** — lightweight self-check, then the Docker-dependent end-to-end suite:

  ```bash
  cd csm-browse
  node scripts/check-skill.mjs   # fast sanity check, no Docker needed
  node tests/e2e.mjs             # full e2e; requires the chromium-vnc container
  ```

- The orchestration skills (`csm-grill`, `csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-review`, `csm-deep-research`) are single-file skills with no test suite; validate by invoking them.
- **Commit style** — short imperative messages, frequently skill-prefixed (e.g. `csm-browse: ...`, `add csm-scan skill: ...`).
- **Cache & token hygiene** — this repo's sessions run on DeepSeek's automatic prefix caching. `AGENTS.md` at the repo root holds the working rules (stable-prefix discipline, fresh-session resume, compaction recall-first, append-only history); the full reference is `.agents/docs/cache-token-efficiency-2026-08-20.md`; measure real hit ratios and cost with `node scripts/cache-health.mjs [--days N]`. The layer is ON by default and switchable per repo/directory via `.agents/token-efficiency.json`.

## Troubleshooting

- **Lost tmux session** — a skill started a detached session but you lost track of it. List sessions with `tmux ls`, then reattach with `tmux attach-session -t <name>` (the name was printed when the session started, e.g. `csm-plan-<goal-slug>`).
- **`chromium-vnc` container not starting** — `csm-browse` needs the container present and running. Check `docker ps -a` for the container, start it (`docker start <name>`), and rerun `node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --session <sid>`. If it is absent, create it per `csm-browse`'s SKILL.md before using the skill.
- **`gh` not authenticated** — `csm-upload` reports authentication failures. Run `gh auth login` (and verify with `gh auth status`), then retry.
- **ffmpeg missing** — full-page screenshots and screencasts fail without it. Install it with your package manager (e.g. `sudo apt install ffmpeg` or `brew install ffmpeg`). Until then `csm-browse` degrades to viewport-only screenshots and no video.

## License

MIT — see [LICENSE](LICENSE).
