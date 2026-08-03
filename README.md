# opencode-skills

A collection of [OpenCode](https://opencode.ai) agent skills built around the **CSM (cyclic state machine)** workflow: relentless idea grilling (`csm-grill`), rigorous, evidence-based planning (`csm-plan`), optional BDD/TDD spec mutation (`csm-bdd-tdd`), and resumable plan execution (`csm-build`) — supported by repository analysis (`csm-scan`), Dockerized browser automation (`csm-browse`), and evidence publishing (`csm-upload`).

> **Progressive disclosure:** this README is the index. Each skill's commands, flags, examples, and full reference live in its `SKILL.md`, linked from the [Skills](#skills) table below.

## Table of contents

- [The CSM workflow](#the-csm-workflow)
- [Skills](#skills)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Repository layout](#repository-layout)
- [Development & testing](#development--testing)
- [License](#license)

## The CSM workflow

```mermaid
flowchart LR
    grill["csm-grill<br/>idea → agreed phased approach"] -.->|"phase briefs"| plan["csm-plan<br/>brief → saved, verified plan"]
    scan["csm-scan<br/>repo(s) → NORMS.md"] -.->|"optional conventions input"| plan
    plan --> bdd["csm-bdd-tdd<br/>optional: plan → BDD/TDD spec package"]
    bdd --> build["csm-build<br/>plan → verified implementation"]
    plan -->|"without mutation"| build
    build -->|"delivery"| browse["csm-browse<br/>image/video evidence of delivery"] -->|"evidence"| upload["csm-upload<br/>evidence → GitHub Pages demo site"]
```

The core loop: **grill** an idea into an agreed phased approach, **scan** a repository for its conventions, **plan** the work as a numbered, resumable state machine, optionally **mutate** the plan into strict BDD/TDD form, then **build** it with parallel subagents, checkpoints, and review cycles. After delivery, **browse** captures image/video evidence of the build and **upload** makes it available to the user.

Each stage is a separate, explicitly invoked skill — planning never silently becomes implementation, and execution always starts from a saved plan on disk.

## Skills

| Skill | Purpose | Reference |
|---|---|---|
| `csm-grill` | Grill an idea into an agreed, phased approach — a relentless one-question-at-a-time interview backed by research subagents, cycling until you agree; each phase is a ready-made brief for a future csm-plan run. Never plans or implements. | [csm-grill/SKILL.md](csm-grill/SKILL.md) |
| `csm-plan` | Turn a brief into an evidence-based, executable, resumable implementation plan — research, critique, verify, save, stop. Never implements. | [csm-plan/SKILL.md](csm-plan/SKILL.md) |
| `csm-bdd-tdd` | Mutate a saved plan into a strict BDD+TDD package: formal spec, executable Gherkin scenarios, unit test designs, and a traceable mutated plan. | [csm-bdd-tdd/SKILL.md](csm-bdd-tdd/SKILL.md) |
| `csm-build` | Execute a saved CSM plan with parallel subagents, durable checkpoints, and review/repair cycles until verified complete. | [csm-build/SKILL.md](csm-build/SKILL.md) |
| `csm-scan` | Read-only multi-repo analysis producing a single `NORMS.md`: 16 evidence dimensions (structure, stack, conventions, architecture, security, data, deployment, and more) with Mermaid C4 diagrams. | [csm-scan/SKILL.md](csm-scan/SKILL.md) |
| `csm-browse` | Drive an isolated Chromium inside the `chromium-vnc` Docker container via CDP: navigate, click, type, log in, screenshot, inspect DOM, capture console/network/performance, record video. | [csm-browse/SKILL.md](csm-browse/SKILL.md) |
| `csm-upload` | Upload screenshots, videos, and evidence files to a GitHub Pages demo site under a unique dated page name. | [csm-upload/SKILL.md](csm-upload/SKILL.md) |

## Requirements

- **[OpenCode](https://opencode.ai)** — these are OpenCode skills.
- **Node.js >= 20** — for `csm-browse` (see `csm-browse/package.json`) and for running the `csm-scan` test suite (`node:test`). `csm-scan` itself is zero-dependency Node built-ins only.
- **Docker** with the `chromium-vnc` container — `csm-browse` only.
- **`gh` CLI**, authenticated, plus a GitHub Pages-enabled repository — `csm-upload` only.

## Installation

Clone this repository into your OpenCode skills directory (or copy the seven skill folders into an existing one):

```bash
git clone git@github.com:jamiemills/opencode-skills.git ~/.config/opencode/skills
```

Restart OpenCode so it picks up the skills. `csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-grill`, `csm-scan`, and `csm-upload` need no further setup.

`csm-browse` has runtime dependencies — install and verify:

```bash
cd ~/.config/opencode/skills/csm-browse
npm install --no-audit --no-fund
node -e "require('chrome-remote-interface'); console.log('ok')"
node scripts/check-skill.mjs
```

## Usage

The four core skills (`csm-grill`, `csm-plan`, `csm-bdd-tdd`, `csm-build`) are invoked by name in an OpenCode session — e.g. *"use csm-plan to make a plan for adding OAuth login"*. The three tooling skills (`csm-scan`, `csm-browse`, `csm-upload`) also expose a CLI under their `scripts/` directories. **Commands, flags, examples, and full reference for each skill live in its `SKILL.md`** (see the [Skills](#skills) table).

Typical sequence:

1. **Grill** an idea into agreed phases — `csm-grill` (each phase becomes a brief for the next step).
2. **Scan** a repo for conventions (optional) — `csm-scan` → `NORMS.md`.
3. **Plan** the work — `csm-plan` → `.agents/plans/<date>-<goal>-csm.md`.
4. **Mutate** to BDD/TDD (optional) — `csm-bdd-tdd`.
5. **Build** it — `csm-build`, preferring any BDD/TDD-mutated plan.
6. **Capture** image/video evidence of the delivery and **publish** it — `csm-browse` → `csm-upload`.

Planning never silently becomes implementation, and execution always starts from a saved plan on disk.

## Repository layout

```
.
├── csm-grill/         # SKILL.md — the idea-grilling interview
├── csm-plan/          # SKILL.md — the planning state machine
├── csm-build/         # SKILL.md — the plan execution engine
├── csm-bdd-tdd/       # SKILL.md — BDD/TDD plan mutation
├── csm-scan/          # repository analyzer → NORMS.md
│   ├── lib/scan/      # pipeline, dimension registry, scanners, providers, renderers
│   ├── scripts/       # scan.mjs CLI
│   └── test/          # node:test suite + fixtures
├── csm-browse/        # CDP browser automation
│   ├── lib/           # CDP client, docker, session, recorder, verb implementations
│   ├── scripts/       # browse.mjs, ensure-browser.mjs, session-daemon.mjs, check-skill.mjs
│   └── tests/         # e2e + fixtures (requires Docker)
├── csm-upload/        # evidence upload to GitHub Pages
│   └── scripts/       # upload.mjs
└── .agents/           # plans/ and approaches/ saved by the skills
```

## Development & testing

- **csm-scan** — zero-dependency `node:test` suite, run from the skill directory:

  ```bash
  cd csm-scan
  node --test --test-concurrency=1
  ```

  Serial mode (`--test-concurrency=1`) is authoritative; default parallel mode can race the filesystem-heavy fixture tests. See [csm-scan/SKILL.md](csm-scan/SKILL.md) for focused gate commands (determinism, privacy, constraints, golden, and more).

- **csm-browse** — lightweight self-check, then the Docker-dependent end-to-end suite:

  ```bash
  cd csm-browse
  node scripts/check-skill.mjs   # fast sanity check, no Docker needed
  node tests/e2e.mjs             # full e2e; requires the chromium-vnc container
  ```

- The orchestration skills (`csm-grill`, `csm-plan`, `csm-build`, `csm-bdd-tdd`) are single-file skills with no test suite; validate by invoking them.
- **Commit style** — short imperative messages, frequently skill-prefixed (e.g. `csm-browse: ...`, `add csm-scan skill: ...`).

## License

No LICENSE file is currently present in this repository.
