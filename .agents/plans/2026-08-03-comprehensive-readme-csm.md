---
format: csm-plan/1
---

# Comprehensive README for opencode-skills CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 2 tasks, both low risk (documentation-only, single new file, no code or config changes). No security, data, destructive, or public-interface impact; primary self-review is acceptable per csm-build's lightweight path.

## Control
- Plan ID: comprehensive-readme
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-03T08:11Z — plan drafted, self-critiqued, verified; not started
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Create a single comprehensive `README.md` at the repository root of `opencode-skills` (github.com/jamiemills/opencode-skills) that documents the repo for both users and contributors: what the skill collection is, the CSM workflow the skills form, how to install and use each of the six skills, system requirements, repository layout, and how to run each skill's tests/checks.

Deliverables: exactly one new file, `README.md`, at repo root.
Constraints: evidence-grounded (every command/path must match the real repo); no duplication of deep per-skill reference material already in each `SKILL.md` (link to it instead); Markdown that renders on GitHub.
Exclusions: no LICENSE file addition, no changes to any skill, no badges/CI, no changes to the pre-existing modified file `csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md`.

## Acceptance Criteria
1. `README.md` exists at the repo root and contains, at minimum, these sections: project overview, the CSM workflow (with a diagram), a skills summary table naming all six skills, installation, requirements, a quickstart/usage subsection per skill, repository layout, development & testing, and a license note. Evidence: `grep` for each required section header succeeds.
2. Every repository path referenced in the README (e.g. `csm-browse/scripts/browse.mjs`, `csm-scan/scripts/scan.mjs`, each `SKILL.md`) exists on disk. Evidence: a scripted existence check over all referenced paths passes.
3. Every documented command matches its source of truth: scan CLI flags match `csm-scan/scripts/scan.mjs` argument parsing (`--repos`, `--out`); csm-scan test command matches `csm-scan/SKILL.md` Testing section (`node --test --test-concurrency=1`); csm-browse install matches `csm-browse/SKILL.md` (`npm install --no-audit --no-fund`) and its engines (`node >= 20`); csm-upload flags match `csm-upload/SKILL.md` (`--label`, `--desc`, `--github`, `--repo`). Evidence: manual diff-style comparison recorded against the source files, plus `node scripts/check-skill.mjs` still passing for csm-browse (README must not break the skill).
4. The working tree after execution contains only `README.md` and the updated plan file as new/modified files from this execution; the pre-existing modification to `csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md` is untouched and uncommitted by this execution. Evidence: `git status --porcelain` output recorded at completion.

## Current-State Evidence
- `git ls-files` (2026-08-03): no `README.md` or `README` anywhere in the repo; no `LICENSE` file. Repo root contains six skill directories plus `.gitignore` (single line: `node_modules/`).
- `git remote -v`: `origin git@github.com:jamiemills/opencode-skills.git` — public-facing GitHub repo, so a standard OSS-style README is the fitting genre.
- Six skills, from their `SKILL.md` frontmatter and bodies:
  - `csm-plan` — planning-only CSM (INTAKE→DISCOVER→RESEARCH→DRAFT→CRITIQUE→REMEDIATE→VERIFY→SAVED); saves plans to `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md`; never implements.
  - `csm-build` — executes saved plans (RECOVER→VALIDATE→SELECT→DISPATCH→INTEGRATE→VERIFY→REVIEW→REPAIR→CHECKPOINT cycles); prefers BDD/TDD-mutated plans; optional NORMS.md integration; commits at checkpoints.
  - `csm-bdd-tdd` — mutates a saved base plan into a BDD/TDD package: `specs/<goal-slug>/` (spec.md, features/*.feature, test-harness stubs, tests/design, validation) plus a new `*-bdd-csm.md` plan and a pointer line in the source plan; never implements.
  - `csm-browse` — CDP browser automation against an isolated Chromium in the `chromium-vnc` Docker container; `package.json`: `node >= 20`, deps `chrome-remote-interface ^0.34.0`, `jimp ^1.6.1`; scripts `ensure-browser.mjs`, `browse.mjs` (verb CLI), `session-daemon.mjs`, `check-skill.mjs`; `tests/e2e.mjs` (+ fixtures, `tests/serve.mjs`) requires the Docker container and fixture server at `http://172.17.0.1:8090`; VNC live view on `localhost:5900`; CDP pool 9224+, port 9222 forbidden; 10-minute idle session sweep.
  - `csm-scan` — read-only multi-repo analyzer emitting one `NORMS.md`; 16 per-repository dimensions + global cross-repository section; first-class Python/JavaScript/TypeScript/Shell/Rust plus generic artifact-only fallback; declarative JSON plugins under `<skill root>/plugins/`; zero npm dependencies; deterministic byte-identical output; privacy redaction before any output. CLI confirmed in `csm-scan/scripts/scan.mjs`: `node scripts/scan.mjs --repos <path...> [--out <path>]`; defaults: repos = cwd, out = `<cwd>/NORMS.md`. Tests: `node --test --test-concurrency=1` run from the `csm-scan/` directory (`csm-scan/SKILL.md` Testing section; `node:test`-based, no package.json present).
  - `csm-upload` — uploads screenshots/videos/evidence to a GitHub Pages repo as `demo-YYYY-MM-DD-<label>/` with an autogenerated index.html; requires authenticated `gh` CLI; config `~/.agents/csm-upload.json` (`github`, `pagesRepo`, auto-detected on first run); flags `--label`, `--desc`, `--github`, `--repo`; script handles clone/pull/copy/commit/push.
- `git log --oneline -15`: commit style is short imperative, frequently skill-prefixed (`add csm-scan skill: ...`, `csm-browse: ...`, `fix csm-upload SKILL.md: ...`).
- `node --version` on host: v20.20.2 — satisfies csm-browse `engines.node >= 20` and node:test for csm-scan.
- Protected-state baseline: `git status --porcelain` before planning showed exactly one pre-existing modification, `csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md` (not caused by this planning session; must remain untouched).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Audience is both prospective users (install/use the skills) and contributors (develop/test them); standard public-GitHub README structure applies | inference | public `origin` remote; no existing README to contradict | decided |
| A2 | README stays at quickstart level per skill and links to each `SKILL.md` for deep reference, avoiding duplicated content that would rot | decision | each SKILL.md already holds exhaustive reference (e.g. csm-browse verb table, csm-scan dimension table) | decided |
| A3 | License section states factually that no LICENSE file is currently present; adding a license is out of scope | decision | `git ls-files` shows no LICENSE; choosing a license is a legal/product decision the user did not request | proposed — user may veto or supply a license during build |
| A4 | README includes a Mermaid diagram of the CSM workflow | decision | repo already uses Mermaid in skill docs (csm-scan SKILL.md references Mermaid C4 output); GitHub renders Mermaid natively | decided |
| A5 | Dependency versions are referenced indirectly ("see `csm-browse/package.json`") rather than copied, except the Node >= 20 requirement which is user-facing install information | decision | avoids version drift between README and package.json | decided |
| A6 | csm-browse e2e tests are documented as requiring Docker (chromium-vnc container) and are not part of a default "run all tests" instruction | decision | `tests/e2e.mjs` hardcodes container networking (`172.17.0.1:8090`) and session infrastructure | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What does the repo contain and is there an existing README/LICENSE? | `git ls-files`, `ls -la` (read-only) | no writes; baseline `git status` clean apart from pre-existing plan modification | 6 skill dirs, `.gitignore`, no README, no LICENSE; csm-scan carries its own `.agents/` docs/plans | README is greenfield at root; scope = 6 skills |
| R2 | What does each skill do and require? | Read all six `SKILL.md` files (read-only) | no writes | Purposes, requirements, and commands as listed in Current-State Evidence | Section content and per-skill quickstarts sourced from SKILL.md files |
| R3 | What is the exact csm-scan CLI surface? | Read `csm-scan/scripts/scan.mjs` argument parsing (read-only) | no writes; script not executed against any repo | `--repos <paths...>`, `--out <path>`; defaults cwd repo and `<cwd>/NORMS.md` | README quickstart command uses these exact flags |
| R4 | How are csm-scan tests run? | `csm-scan/SKILL.md` Testing section; confirmed no `package.json` in csm-scan | read-only | `node --test --test-concurrency=1` from `csm-scan/`; serial mode authoritative (parallel races fixture FS) | Development section documents serial flag and working directory |
| R5 | How are csm-browse tests/checks run and what do they need? | Read `tests/e2e.mjs`, `scripts/check-skill.mjs` heads (read-only) | read-only; not executed | e2e needs Docker container + fixture server at 172.17.0.1:8090; check-skill validates SKILL.md frontmatter | README marks e2e as Docker-dependent; check-skill as the lightweight sanity check |
| R6 | Commit message conventions? | `git log --oneline -15` (read-only) | read-only | short imperative, often skill-prefixed | Execution commits follow this style |
| R7 | Node runtime available? | `node --version` | read-only | v20.20.2 | Requirements section: Node.js >= 20 |

## Discovered Requirements
- No root-level `.agents/` existed before this plan; this plan creates `.agents/plans/` at repo root (planning artifact, allowed).
- Pre-existing uncommitted modification: `csm-scan/.agents/plans/2026-08-03-csm-scan-practices-dimension-csm.md`. Execution must never stage, commit, revert, or edit it. Acceptance criterion 4 checks this.
- `.gitignore` ignores `node_modules/` only — `README.md` and `.agents/plans/` are trackable.
- Markdown must be GitHub-renderable; Mermaid fenced blocks are acceptable (A4).
- Keep the README factual: no invented badges, CI status, version numbers beyond Node >= 20, or claims of license.

## Design
One new file: `README.md` at repo root. Structure (section order):

1. Title + one-paragraph overview: a collection of OpenCode agent skills implementing the CSM (cyclic state machine) plan→build workflow, plus supporting browser-automation, repo-analysis, and evidence-upload skills.
2. Table of contents (anchor links).
3. **The CSM workflow** — Mermaid flowchart: `csm-scan → csm-plan → (optional) csm-bdd-tdd → csm-build`, with `csm-browse → csm-upload` as the evidence-capture side path. One sentence per edge.
4. **Skills** — summary table: name, one-line purpose (from each SKILL.md frontmatter description), link to its `SKILL.md`.
5. **Requirements** — OpenCode; Node.js >= 20 (csm-browse, csm-scan tests); Docker with the `chromium-vnc` container (csm-browse only); authenticated `gh` CLI + GitHub Pages repo (csm-upload only).
6. **Installation** — clone into `~/.config/opencode/skills/` (the location OpenCode scans, and this repo's actual checkout path); `npm install --no-audit --no-fund` inside `csm-browse/` only; verify with `node scripts/check-skill.mjs`. Note that csm-plan/csm-build/csm-bdd-tdd/csm-scan/csm-upload need no install step (csm-scan is zero-dependency; csm-upload uses system `gh`).
7. **Usage / quickstart** — one subsection per skill: purpose sentence, minimal command or invocation phrase, pointer to SKILL.md for full reference. csm-scan quickstart: `node scripts/scan.mjs --repos /path/to/repo --out NORMS.md`; tests note. csm-browse quickstart: ensure-browser → verb → close, per SKILL.md. csm-upload quickstart: `--label` example. csm-plan/build/bdd-tdd: invoked by name as OpenCode skills (no CLI).
8. **Repository layout** — compact tree (skill dirs + one-line note on notable subtrees: csm-browse `lib/ scripts/ tests/`, csm-scan `lib/scan/ scripts/ test/`, csm-upload `scripts/`).
9. **Development & testing** — csm-scan: `node --test --test-concurrency=1` from `csm-scan/` (serial is authoritative); csm-browse: `node scripts/check-skill.mjs` sanity check, `tests/e2e.mjs` requires Docker; commit style: short imperative, skill-prefixed.
10. **License** — factual note that no LICENSE file is present (A3).

Boundaries: single file, no other edits. Data flow: none. Key decisions in Assumptions table.

## Execution Graph
- T001 (write README.md) → T002 (verify README.md). Strictly sequential; T002 validates T001's output.
- Critical path: T001 → T002. No parallel groups — one file, one owner; parallelizing would create overlapping write ownership for zero benefit.

## Numbered Plan
1. [pending] Write README.md at repo root
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1 (sole member)
   - Risk: low (documentation-only, new file, no interface or data impact)
   - Owned scope: `README.md` (repo root) — exclusive
   - Not in scope: any skill source, any `SKILL.md`, `.gitignore`, `csm-scan/.agents/**`, LICENSE file creation, badges/CI config, pushing to origin
   - Spike candidate: none — all content questions resolved in R&D R1–R7
   - Actions: author `README.md` following the Design section order and content; source every command from the evidence in Current-State Evidence; apply decisions A1–A6; keep per-skill coverage at quickstart level with links to each `SKILL.md`
   - Acceptance signal: `test -f README.md && grep -qE '^## ' README.md && for s in "The CSM workflow" "Skills" "Requirements" "Installation" "Usage" "Repository layout" "Development" "License"; do grep -q "$s" README.md || { echo "missing: $s"; exit 1; }; done && echo OK` — expected output `OK`
   - Validation: (1) all six skill names (`csm-plan`, `csm-build`, `csm-bdd-tdd`, `csm-browse`, `csm-scan`, `csm-upload`) each appear — `for n in ...; do grep -q "$n" README.md; done`; (2) Mermaid block present — `grep -q '^```mermaid' README.md`; (3) no `node_modules` references — `! grep -q node_modules README.md`; (4) renders as a single H1 (`grep -c '^# ' README.md` = 1)
   - Acceptance evidence: the acceptance-signal output, the validation outputs, and `wc -l README.md` recorded in the plan journal
   - Repair attempts: 0
   - Recovery note: if interrupted, check for `README.md` at root; a partially written file is safe to overwrite wholesale — it is the sole owned file and has no other author
2. [pending] Verify README accuracy against repository sources
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2 (sole member; sequential after T001)
   - Risk: low (read-only verification commands plus at most corrective edits to README.md)
   - Owned scope: `README.md` (corrective edits only, if verification finds inaccuracies)
   - Not in scope: modifying any file other than README.md; running csm-scan against the repo (would write NORMS.md); running csm-browse e2e (requires Docker); committing
   - Spike candidate: none
   - Actions: (a) scripted check that every repo-relative path referenced in README.md exists; (b) compare documented commands against sources: `csm-scan/scripts/scan.mjs` flags (`--repos`, `--out`), csm-scan test command vs `csm-scan/SKILL.md` Testing section, csm-browse install command vs `csm-browse/SKILL.md`, csm-upload flags vs `csm-upload/SKILL.md`; (c) run `node scripts/check-skill.mjs` in `csm-browse/` to confirm the repo is still self-consistent; (d) `git status --porcelain` to confirm only README.md (and this plan) changed from this execution and the pre-existing csm-scan plan modification is untouched
   - Acceptance signal: `cd csm-browse && node scripts/check-skill.mjs` exits 0, AND the path-existence loop over README-referenced paths prints no `MISSING` lines — expected: check-skill passes, zero missing paths
   - Validation: (1) `grep -oE 'csm-[a-z-]+/[A-Za-z0-9_./-]+' README.md | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $p"; done` from repo root → no output; (2) `grep -c 'SKILL.md' README.md` >= 6 (every skill linked); (3) `git status --porcelain` shows only `README.md` new plus the pre-existing modification
   - Acceptance evidence: recorded outputs of the acceptance signal and each validation command in the plan journal
   - Repair attempts: 0
   - Recovery note: verification is idempotent and read-only except deliberate README.md corrections; re-run freely after any fix

## Verification Strategy
Cheapest-first. Per-task gates: T001's grep-based section/name/mermaid checks are fast text gates run immediately after writing. T002 is the integration gate: path-existence loop (fast, local), command-vs-source comparison (manual, recorded), and `node scripts/check-skill.mjs` (fast, no Docker). Final gate (csm-build completion): full `git status --porcelain` review plus re-read of README.md top-to-bottom for factual accuracy against the six SKILL.md files. Not run at any point: `node --test` in csm-scan (README does not touch csm-scan code; running its suite is unnecessary and slow), csm-browse e2e (needs Docker; out of scope for a docs change), and `scripts/scan.mjs` (would write NORMS.md into the repo).

## Risks And Recovery
- Risk: README content drifts from source of truth as skills evolve. Mitigation: quickstart-level coverage with links to SKILL.md; versions referenced indirectly (A2, A5). Recovery: T002's source comparison catches drift at write time.
- Risk: inaccurate command documented (e.g. wrong flag). Mitigation: R3/R4/R5 pinned exact flags from source; T002(b) re-verifies. Recovery: corrective edit to README.md only.
- Risk: accidentally staging the pre-existing modified csm-scan plan file at commit time. Mitigation: commit command stages only `README.md` and this plan file by explicit path. Recovery: if staged by mistake, unstage before commit; never commit it.
- Risk: user wanted a license declared or different tone/audience. Mitigation: A1/A3 recorded explicitly as assumptions. Recovery: single-file edit; no rework cascade.
- Rollback: `git rm README.md` (or delete before commit) fully restores the prior state — single new file, no other surface touched.

## Critique Resolution
Primary-led critique (justified: small, low-risk, docs-only plan per Scale To The Ask). Hostile review findings:
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| README duplicating deep SKILL.md reference material would rot and contradict | medium | Design caps per-skill coverage at quickstart + links; recorded as A2 and enforced in T001 actions | SKILL.md files already contain verb/dimension tables |
| License section could make an unsupported legal claim | medium | A3 restricts the section to the factual statement that no LICENSE file exists; adding a license is explicit anti-scope in T001 | `git ls-files` shows no LICENSE |
| Acceptance signal "file exists" is too weak to prove comprehensiveness | high | T001 signal now enumerates required section headers; T002 adds path-existence, per-skill SKILL.md link count, and check-skill pass | grep-based signal in T001; validations in T002 |
| Documented commands could silently mismatch real CLIs | high | R3 pinned scan.mjs flags; T002(b) mandates source comparison for all four command surfaces | scan.mjs parseArgs read at R3 |
| Plan could be read as authorizing parallel tasks | low | Execution Graph states sequential T001→T002 with sole-member groups; both tasks own README.md so parallelism would be a write conflict | Execution Graph section |
| Verification could accidentally mutate the repo (scan.mjs writes NORMS.md; e2e needs Docker) | medium | T002 Not-in-scope and Verification Strategy explicitly forbid running scan.mjs and e2e | scan.mjs writes to `--out` default `<cwd>/NORMS.md` (R3) |
| Pre-existing dirty file could get swept into a commit | high | Discovered Requirements + T002(d) + Risks: stage only README.md and this plan by explicit path; criterion 4 checks it | baseline `git status --porcelain` |
| Mermaid support assumed without evidence | low | A4 cites csm-scan SKILL.md's Mermaid C4 usage; GitHub renders Mermaid | csm-scan/SKILL.md line 3 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03T08:05Z | 0 | INTAKE | — | Classified: small, focused, docs-only, semi-open brief; quick-plan depth; no blocking user questions | DISCOVER |
| 2026-08-03T08:08Z | 0 | INTAKE -> DISCOVER | — | Repo inventory via git ls-files; six SKILL.md files read; scan.mjs CLI, check-skill.mjs, e2e.mjs, package.json inspected; baseline git status captured (one pre-existing modification, not ours) | RESEARCH |
| 2026-08-03T08:09Z | 0 | DISCOVER -> RESEARCH | — | Uncertainty scout performed by primary (proportionate to ask): 7 questions R1–R7, all resolved read-only; no subagent tracks needed for a single-file README | DRAFT |
| 2026-08-03T08:11Z | 0 | RESEARCH -> DRAFT | — | Plan drafted: 2 sequential low-risk tasks, both owning README.md | CRITIQUE |
| 2026-08-03T08:12Z | 0 | DRAFT -> CRITIQUE | — | Primary-led hostile critique (permitted for small low-risk plans): 8 findings | REMEDIATE |
| 2026-08-03T08:13Z | 0 | CRITIQUE -> REMEDIATE | — | All 8 findings resolved in-place by primary (design caps, strengthened acceptance signals, explicit anti-scope); no design change, no new uncertainty; critique resolution table filled | VERIFY |
| 2026-08-03T08:14Z | 0 | REMEDIATE -> VERIFY | — | Primary VERIFY gate: criteria 1–4 each map to T001/T002 signals; every task has runnable acceptance signal, risk tier, anti-scope; no spikes outstanding; named files/commands match R1–R7 evidence; resumable from Control + journal alone | SAVED |

## Completion Review
<filled by csm-build when all criteria are verified>
