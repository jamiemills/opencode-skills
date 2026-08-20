---
format: csm-plan/1
---

# Oxlint And Lefthook Pre-Commit CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 1 high-risk (T002 replaces the repo's commit gate; requires independent review), 4 standard. Tasks that always require independent review: T002.

## Control
- Plan ID: oxlint-lefthook-precommit
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: none
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal

Add oxlint + lefthook to this repository and REPLACE the existing custom pre-commit gate (scripts/hooks/pre-commit, installed via scripts/install-hooks.mjs which sets `core.hooksPath=scripts/hooks`) with a lefthook-managed pre-commit hook. The new hook must (a) preserve the current gate's behaviors — reject commits with unstaged tracked changes, run `node scripts/check-suite.mjs` (449 checks), syntax-check staged `.mjs` files, run `csm-browse/scripts/check-skill.mjs` when csm-browse files are staged and its deps are installed — and (b) run oxlint on STAGED files only, with oxlint defaults and NO committed `.oxlintrc.json`.

Deliverables:
1. Root `package.json` (private) with exact-pinned devDependencies `lefthook@2.1.10` + `oxlint@1.79.0` and a committed `package-lock.json`.
2. `.lefthook.yml` (committed) defining the pre-commit job chain: unstaged-guard -> check-suite -> staged-mjs-syntax -> staged-oxlint -> conditional csm-browse check, piped so the guard gates all later jobs.
3. `scripts/hooks/pre-commit` replaced by the committed lefthook shim (approach: keep `core.hooksPath=scripts/hooks`, `lefthook install --force`); old Node hook logic retired.
4. `scripts/install-hooks.mjs` rewritten: `npm ci --ignore-scripts`, ensure core.hooksPath, `lefthook install --force`, one-time `pre-commit.old` cleanup, uninstall path.
5. `scripts/hooks/test/pre-commit.test.mjs` rewritten for the lefthook hook: shim execution, `.lefthook.yml` validation, staged-only oxlint property, deny-warnings, guard-before-gates; all `/SYNC/` assertions dropped (check-suite already runs drift internally).
6. Dependent plans + docs amended: README (install, quickstart, tree, development, lockfile note), skill-suite plan T001 hook sub-items retargeted to `.lefthook.yml`, journal-learnings plan T002 record-gate-baseline line retargeted to a lefthook job.

Constraints:
- Keep `core.hooksPath=scripts/hooks` and the committed-hook-file convention (approach (a) — verified: lefthook 2.1.10 has NO `-d/--dir` flag and refuses plain install while core.hooksPath is set; `--force` installs into the hooksPath location; first install renames the legacy hook to `pre-commit.old`).
- No `.oxlintrc.json` committed (user decision: oxlint defaults); oxlint runs via `./node_modules/.bin/oxlint --deny-warnings --no-error-on-unmatched-pattern {staged_files}` (verified: no stdin mode; warnings-only exit 0 without `--deny-warnings`; empty file list exits 1 without `--no-error-on-unmatched-pattern`; `--fix` must never run in a hook).
- No network at commit time: the hook uses the local `node_modules/.bin` binaries; `npx`-at-commit is out of scope.
- `node scripts/check-suite.mjs` must stay green after every task; no existing check may be weakened.
- The new hook must NOT include a separate `sync-skill-boilerplate --check` job — check-suite.mjs:646-649 already runs drift internally (matches skill-suite plan T001 intent).

Exclusions:
- No change to csm-browse's own package.json or its deps.
- No oxlint rule configuration, no `--fix`, no CI workflows.
- No change to check-suite.mjs or scripts/lib/contracts.mjs.
- No changes to the bootstrap payload or envelope (hooks are dev tooling, not packaged).

## Acceptance Criteria

1. `node_modules/.bin/lefthook --version` prints 2.1.10 and `node_modules/.bin/oxlint --version` prints 1.79.0; root `package.json` + `package-lock.json` are committed; `npm ci --ignore-scripts --no-audit --no-fund` reproduces the lockfile cleanly from a scratch clone.
2. `git config --get core.hooksPath` returns `scripts/hooks`; `scripts/hooks/pre-commit` is the lefthook shim (contains the `LEFTHOOK` fingerprint); `npx lefthook validate` passes; no `scripts/hooks/pre-commit.old` remains; `scripts/install-hooks.mjs` runs end-to-end in a scratch clone (npm ci + install --force + verify) and its uninstall path resets core.hooksPath.
3. `.lefthook.yml` defines the piped pre-commit chain with all five jobs (unstaged-guard, check-suite, mjs-syntax, oxlint, csm-browse-check) and `assert_lefthook_installed: true`; behavioral proof in the hook test suite: a staged `.mjs` with an oxlint error blocks the commit, an UNTRACKED `.mjs` with the same error does not block, an oxlint WARNING blocks (deny-warnings), and unstaged tracked changes block before any gate output.
4. `node --test scripts/hooks/test/pre-commit.test.mjs` passes (rewritten suite; no `/SYNC/` assertions).
5. README.md hook/lockfile/tree references updated and `node scripts/check-suite.mjs` exits 0; skill-suite plan T001 and journal-learnings plan T002 amended so their hook sub-items target `.lefthook.yml` and no future csm-build conflicts.
6. Full battery green: check-suite 449 checks, hook test suite, `cd csm-browse && node scripts/check-skill.mjs`, and a live `git commit` of a clean staged change passes the new hook with all jobs observed.

## Current-State Evidence

- `scripts/install-hooks.mjs:22` sets `core.hooksPath` = `scripts/hooks`; hook file `scripts/hooks/pre-commit` is a committed `#!/usr/bin/env node` script: unstaged guard (`:18`), check-suite (`:38`), sync-boilerplate step 2 (`:41-43`, existence-guarded), staged-`.mjs` syntax (`:46-56`), conditional csm-browse check (`:60-64`). Test suite `scripts/hooks/test/pre-commit.test.mjs` (4 tests) asserts `/CHECK_SUITE/` and `/SYNC/` output and CHECK_SUITE-before-SYNC ordering.
- No root `package.json` today; only `csm-browse/package.json`. `.gitignore:1` ignores `node_modules/`. `tests/package-audit.test.mjs`, `tests/bootstrap-trust.test.mjs`, and the offline/protocol/integration suites route through `packBootstrap()` (bootstrap/package.json only) — verified: a root package.json/node_modules breaks no test; check-suite.mjs has no root-package.json check.
- lefthook latest 2.1.10 (`npm view lefthook version`); bin `bin/index.js` (node wrapper + platform optional deps). `install` flags: `--force` ("proceed even if core.hooksPath is set"), `--reset-hooks-path`; NO `-d/--dir` in 2.1.10 or 1.7.14. Plain `lefthook install` REFUSES when core.hooksPath is set to a non-default path. npm `lefthook` postinstall auto-runs `install -f` from INIT_CWD (try/catch-wrapped) — installer must use `--ignore-scripts` for determinism.
- lefthook config: `.lefthook.yml` valid name; `assert_lefthook_installed: true` makes a missing binary fail (shim otherwise exits 0); `piped: true` = sequential stop-on-first-failure (cannot combine with `parallel`); `{staged_files}` built-in = `git diff --name-only --cached --diff-filter=ACMR`; `glob:` empty result skips the job; `output:` (v2) replaces `skip_output`.
- oxlint latest 1.79.0; zero-config defaults cover `.js .jsx .mjs .cjs .ts .tsx .mts .cts`; no stdin mode (paths as args only); warnings-only exit 0; `--deny-warnings` forces non-zero on warnings; `--max-warnings 0` equivalent; `--no-error-on-unmatched-pattern` needed for empty file sets; `--fix` exists and must not be used in hooks.
- `node scripts/check-suite.mjs` currently exits 0 — `OK — 8 skills, 449 checks`.
- Cross-references to update: README.md:101-107,132,183,185-186,198; skill-suite plan `2026-08-20-skill-suite-efficiency-resilience-csm.md` T001 (owned scope, step 5 "delete step 2", step 6 hook test, acceptance grep `sync-skill-boilerplate` on the hook file, validation `node --check scripts/hooks/pre-commit`); journal-learnings plan `2026-08-20-embrace-journal-learnings-csm.md` T002 (adds a `record-gate-baseline.mjs` invocation line to `scripts/hooks/pre-commit`); consolidated plan `2026-08-19-consolidated-remaining-work-csm.md` has no hook references (no change needed).

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Approach (a): keep `core.hooksPath=scripts/hooks`, commit the lefthook shim as `scripts/hooks/pre-commit`, install with `lefthook install --force` | User-dictated (replace gate) + research | Verified: no `-d` flag; plain install refuses under core.hooksPath; committed-hook convention is this repo's established design (approach doc 2026-08-16) | Accepted |
| A2 | oxlint runs staged-only, defaults, no `.oxlintrc.json`, flags `--deny-warnings --no-error-on-unmatched-pattern`, binary `./node_modules/.bin/oxlint` | User-dictated | Research §3: zero-config covers .mjs; no stdin; exit-code semantics verified | Accepted |
| A3 | Root package.json is the tooling carrier: exact pins lefthook@2.1.10 + oxlint@1.79.0, private, engines node >=22, committed lockfile | Planning | Verified no test/gate breaks; offline deterministic hook | Accepted |
| A4 | No separate sync-boilerplate job in .lefthook.yml (check-suite runs drift internally) | Planning | check-suite.mjs:646-649; matches skill-suite T001 intent | Accepted |
| A5 | `piped: true` preserves guard-first semantics; `assert_lefthook_installed: true` so a missing lefthook fails loudly | Planning | Research §2: piped = stop on first failure; shim exits 0 without the assert | Accepted |
| A6 | The old Node hook logic is retired wholesale (not ported into lefthook scripts); `pre-commit.old` cleaned by the installer | Planning | User chose replace; minimal surface | Accepted |
| A7 | `scripts/hooks/test/pre-commit.test.mjs` now depends on the repo's root `node_modules` (lefthook + oxlint); suite skips with a loud warning when deps are absent | Planning | Offline test harness needs the binaries; mirrors csm-browse deps-gated check pattern | Accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Does `lefthook install` support a custom dir / respect core.hooksPath? | npm view lefthook; lefthook 2.1.10 + 1.7.14 source (cmd/install.go, internal/git/paths.go); empirical git rev-parse --git-path hooks in a /tmp/opencode scratch repo | Read-only + scratch repo under /tmp; no repo writes | No `-d` flag; refuses unless --force/--reset-hooks-path; --git-path honors core.hooksPath | Approach (a) with `install --force`; installer cleans `.old` |
| R2 | oxlint zero-config / stdin / exit codes | npm view oxlint; oxlint source (loader, lint.rs, result.rs) | Read-only | Covers .mjs by default; no stdin; warnings exit 0; empty-set exits 1 | `{staged_files}` + `--deny-warnings` + `--no-error-on-unmatched-pattern` |
| R3 | Does a root package.json break any test/gate? | Read tests/package-audit, bootstrap-trust, offline/protocol/integration; grep check-suite.mjs for package.json | Read-only | No root-package.json checks; suites route through packBootstrap (bootstrap/package.json) | Safe to add; commit lockfile |
| R4 | What references the current hook system? | grep hooksPath / install-hooks / scripts/hooks/pre-commit across repo + plans | Read-only | README 8 spots; skill-suite T001; journal-learnings T002; historical plans (docs-only) | T004 amendment list |

## Discovered Requirements

- lefthook `--force` renames an existing tracked `scripts/hooks/pre-commit` to `pre-commit.old` on first install — the installer must remove it and the migration must never leave it behind.
- lefthook npm postinstall auto-runs `lefthook install -f` — always `npm ci --ignore-scripts` in install-hooks.mjs to keep installs deterministic.
- `.lefthook.yml` cannot combine `piped: true` with `parallel: true` (lefthook errors) — keep the chain sequential.
- oxlint `--fix` is prohibited in hook context (rewrites the working tree post-staging); oxlint gets paths as argv (no stdin).
- The lefthook shim content is generated by the pinned version — keep lefthook pinned at 2.1.10 so the committed shim and binary stay in sync; commit the generated shim.
- check-suite.mjs:590-636 validates the README layout tree against the filesystem — any new root files added to the README tree must exist (do NOT add `node_modules/`); if the tree check is exhaustive for root entries, add `package.json` and `.lefthook.yml` lines.
- The hook test suite must run offline: use the repo's `node_modules/.bin` binaries; skip loudly when missing.

## Design

**Hook architecture.** `.lefthook.yml` (committed, source of truth) with `assert_lefthook_installed: true` and a piped pre-commit job chain:

1. `unstaged-guard` — `git diff --name-status --`; non-empty -> print the current guard message + exit 1 (fail_text mirrors today's wording, bypass note `git commit --no-verify`).
2. `check-suite` — `node scripts/check-suite.mjs` (no file glob; always runs; covers the drift check that today's step 2 duplicated).
3. `mjs-syntax` — glob `*.mjs`, loop per staged file (`for f in {staged_files}; do node --check "$f" || exit 1; done` — `node --check` accepts ONE file, mirroring today's per-file loop at scripts/hooks/pre-commit:46-56).
4. `oxlint` — glob `*.{js,mjs,cjs,ts,tsx,mts,cts}`, `./node_modules/.bin/oxlint --deny-warnings --no-error-on-unmatched-pattern {staged_files}`, fail_text "oxlint found problems in staged files (errors and warnings both fail)".
5. `csm-browse-check` — glob `csm-browse/**`; conditional `if [ -d csm-browse/node_modules ]; then node csm-browse/scripts/check-skill.mjs; else echo "csm-browse deps not installed — skipping check-skill"; fi`.

`scripts/hooks/pre-commit` becomes the committed lefthook-generated shim (approach (a)). `scripts/install-hooks.mjs` is rewritten: resolve root -> `npm ci --ignore-scripts --no-audit --no-fund` -> ensure `git config core.hooksPath scripts/hooks` -> `npx lefthook install --force` -> remove `pre-commit.old` if present -> verify (`git config --get core.hooksPath`, `npx lefthook validate`). Uninstall path: `npx lefthook uninstall` + `git config --unset core.hooksPath` (restoring the pre-existing state).

**Tooling.** Root `package.json` (private, exact pins, engines >=22, no `"type"` — root `.mjs` files are unaffected) + committed `package-lock.json`.

**Tests.** Rewritten hook suite: shim executed via `sh` (or real `git commit`), `.lefthook.yml` present + `lefthook validate` green, shim fingerprint, staged-only oxlint property (staged error blocks, untracked error does not), deny-warnings (warning blocks), guard-before-gates (no CHECK_SUITE output when the guard fails), clean-commit passes; all `/SYNC/` assertions dropped; deps-gated skip.

**Amendments to dependent plans.** Skill-suite plan T001: hook sub-items (step 5 delete step 2, step 6 hook-test SYNC updates) are superseded by THIS plan — T001 keeps its boilerplate.mjs + sync-tooling edits only; its acceptance grep retargets to `.lefthook.yml` (`sync-skill-boilerplate` occurrence count 0 there) and its `node --check scripts/hooks/pre-commit` validation becomes `npx lefthook validate` (shim is shell). Journal-learnings plan T002: the `record-gate-baseline.mjs` invocation moves from `scripts/hooks/pre-commit` to a new `.lefthook.yml` job (check-suite job wraps or precedes it; exact placement per T002's intent of recording the gate baseline before the gate runs).

## Execution Graph

- G1: T001 (root package.json + lockfile) — base.
- G2: T002 (hook replacement: .lefthook.yml, shim, installer) || T004 (README + dependent-plan amendments) — both depend on T001; disjoint files (hooks/config/installer vs README + two plan files).
- G3: T003 (hook test suite rewrite) — depends on T002.
- G4: T005 (final battery + scratch-clone installer proof) — depends on T002, T003, T004.

Critical path: T001 -> T002 -> T003 -> T005.

## Numbered Plan

1. [pending] Root tooling manifest: package.json + committed lockfile
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (new root manifest; lockfile)
   - Owned scope: `package.json`, `package-lock.json` (root, new)
   - Not in scope: any `csm-*/package.json`; node_modules content; hook files; README
   - Spike candidate: none
   - Actions:
     1. Create root `package.json`: `name: csm-skills-suite`, `version: 0.0.0`, `private: true`, `engines.node: ">=22"`, `devDependencies: { "lefthook": "2.1.10", "oxlint": "1.79.0" }` — exact pins, no `"type"` field, no scripts.
     2. Generate the lockfile deterministically: `npm install --ignore-scripts --no-audit --no-fund` (generates package-lock.json without running the lefthook postinstall), then verify `npm ci --ignore-scripts --no-audit --no-fund` reproduces node_modules with both binaries.
     3. Record binary versions: `node_modules/.bin/lefthook --version` and `node_modules/.bin/oxlint --version`.
   - Acceptance signal: `node_modules/.bin/lefthook --version` prints 2.1.10 AND `node_modules/.bin/oxlint --version` prints 1.79.0 AND `git status --short` shows only `package.json` + `package-lock.json` as additions.
   - Validation: `npm ci --ignore-scripts --no-audit --no-fund` in a /tmp scratch copy of the two files exits 0; `node --test` untouched suites still pass (spot: package-audit).
   - Acceptance evidence: version outputs; lockfile diff stat; scratch `npm ci` transcript.
   - Repair attempts: 0
   - Recovery note: revert both files to remove; re-run `npm install` to fix a malformed lockfile; versions are exact-pinned so drift is impossible without intent.

2. [pending] Replace the pre-commit gate with lefthook (config + shim + installer)
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high — replaces the repo's commit gate; requires independent review
   - Owned scope: `.lefthook.yml` (new), `scripts/hooks/pre-commit` (replaced by generated shim), `scripts/install-hooks.mjs` (rewrite)
   - Not in scope: `scripts/hooks/test/**` (T003); README (T004); check-suite.mjs/contracts.mjs; any skill source; bootstrap payload
   - Spike candidate: none — semantics verified in research (R1/R2)
   - Actions:
     1. Write `.lefthook.yml` per Design: `assert_lefthook_installed: true`; pre-commit with `piped: true`; `output: [execution, failure, summary]`; five jobs (unstaged-guard, check-suite, mjs-syntax, oxlint, csm-browse-check) with the exact run commands and globs from Design; guard fail_text and oxlint fail_text as specified; NO `sync-skill-boilerplate` job and NO `--fix` anywhere.
     2. Run `npx lefthook install --force` to generate `scripts/hooks/pre-commit` (the committed shim carrying the `LEFTHOOK` fingerprint); remove `scripts/hooks/pre-commit.old` if the legacy script was renamed.
     3. Rewrite `scripts/install-hooks.mjs`: resolve repo root; `npm ci --ignore-scripts --no-audit --no-fund`; ensure `git config core.hooksPath scripts/hooks` (set if absent — keep the current set-if-absent semantics); `npx lefthook install --force`; remove `pre-commit.old` if present; verify `git config --get core.hooksPath` and `npx lefthook validate`; print the same style of completion notice as today; add an uninstall path (`npx lefthook uninstall` + `git config --unset core.hooksPath`).
     4. Confirm `node scripts/check-suite.mjs` passes and the old Node hook logic is entirely gone (no `#!/usr/bin/env node` in `scripts/hooks/pre-commit`).
   - Acceptance signal: `git config --get core.hooksPath` prints `scripts/hooks` AND `npx lefthook validate` exits 0 AND `head -1 scripts/hooks/pre-commit` shows a `#!/bin/sh` lefthook shim AND `ls scripts/hooks/` contains no `pre-commit.old` AND `node scripts/check-suite.mjs` exits 0.
   - Validation: `rg -n "sync-skill-boilerplate|--fix" .lefthook.yml` returns no matches; `grep -c "LEFTHOOK" scripts/hooks/pre-commit` >= 1; `node --check scripts/install-hooks.mjs` passes; a manual `git commit` of a trivial staged change runs the new hook with all five jobs in order (recorded transcript).
   - Acceptance evidence: validate output; shim head; installer diff; commit transcript with job ordering.
   - Repair attempts: 0
   - Recovery note: revert `.lefthook.yml` + `scripts/hooks/pre-commit` + `scripts/install-hooks.mjs` to HEAD restores the old gate; a broken install is recovered by re-running the installer; the shim is regenerated by `lefthook install --force` at any time (never hand-edit the shim).
   - Independent review: a reviewer not involved in the implementation must verify the hook blocks the three failure cases (unstaged changes, check-suite failure, oxlint error on staged file) and passes a clean commit, per the T003 test evidence.

3. [pending] Rewrite the hook test suite for the lefthook gate
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard (test harness rewrite; offline deps)
   - Owned scope: `scripts/hooks/test/pre-commit.test.mjs` only
   - Not in scope: .lefthook.yml content (T002); any production hook/installer file
   - Spike candidate: none
   - Actions:
     1. Rewrite the suite: setup creates a temp git repo with the repo's `.lefthook.yml`, sets `core.hooksPath=scripts/hooks`, and executes the shim via `sh` (or real `git commit`); the repo's own `node_modules/.bin/lefthook` and `node_modules/.bin/oxlint` are used; if root `node_modules` is absent, skip with a loud warning (mirror the csm-browse deps-gated pattern).
     2. Test cases: (a) `.lefthook.yml` exists and `lefthook validate` passes; shim carries the `LEFTHOOK` fingerprint; (b) clean / staged-only / staged-deletion / untracked commit passes with CHECK_SUITE output and NO SYNC output; (c) unstaged or mixed tracked changes fail with the guard message and NO gate output (piped guard-first); (d) a staged `.mjs` with an oxlint error blocks the commit, while an UNTRACKED `.mjs` with the same error does not (staged-only property); (e) an oxlint WARNING blocks (deny-warnings); (f) `git commit --no-verify` bypasses; (g) clean-commit leaves `git status` clean.
     3. Drop every `/SYNC/` assertion and the CHECK_SUITE-before-SYNC ordering assertion; drop the fake `sync-skill-boilerplate.mjs` fixture.
   - Acceptance signal: `node --test scripts/hooks/test/pre-commit.test.mjs` exits 0 with all rewritten tests passing.
   - Validation: `node --check scripts/hooks/test/pre-commit.test.mjs`; the suite runs offline (no network calls in the test body); `node scripts/check-suite.mjs` still exits 0.
   - Acceptance evidence: test transcript with per-case results.
   - Repair attempts: 0
   - Recovery note: the suite is self-contained in one file; a broken case is fixed by adjusting the fixture (temp repo setup) or the assertion, not by changing .lefthook.yml semantics — if the semantics disagree, surface to T002's owner via the journal before changing the config.

4. [pending] Amend README and dependent plans (skill-suite T001, journal-learnings T002)
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (docs + plan-file metadata edits)
   - Owned scope: `README.md`; `.agents/README.md` (index invariant); `.agents/plans/2026-08-20-skill-suite-efficiency-resilience-csm.md` (T001 sub-items only); `.agents/plans/2026-08-20-embrace-journal-learnings-csm.md` (T002 hook line only)
   - Not in scope: `.lefthook.yml` and hook files (T002); hook tests (T003); any COMPLETE plan; other plans' content
   - Spike candidate: none
   - Actions:
     1. README.md: update Installation (`node scripts/install-hooks.mjs` section — note it now installs root devDeps via npm ci + lefthook), Quickstart optional-hook line, Repository layout tree (add `package.json`, `package-lock.json`, `.lefthook.yml` lines if the tree lists root files; adjust the `hooks/` comment "fast advisory gate (check-suite + drift + syntax)" to "lefthook pre-commit gate (guard + check-suite + syntax + oxlint staged)"), Development & testing (hook install + hook test command), dependency-inventory note (:107) to mention the root lockfile as the hook-tooling authority alongside csm-browse's.
     2. Skill-suite plan T001: mark its hook sub-items (step 5 "delete step 2 in pre-commit", step 6 "hook test SYNC assertions") as superseded-by-this-plan (T002/T003 here) with a pointer line; retarget its acceptance grep `grep -c "sync-skill-boilerplate" scripts/hooks/pre-commit` -> `grep -c "sync-skill-boilerplate" .lefthook.yml` (expected 0) and its validation `node --check scripts/hooks/pre-commit` -> `npx lefthook validate`; keep its boilerplate.mjs/sync-tooling scope untouched.
     3. Journal-learnings plan T002: retarget the `record-gate-baseline.mjs` invocation from `scripts/hooks/pre-commit` to a `.lefthook.yml` pre-commit job (a check-suite-preceding job that runs `node scripts/record-gate-baseline.mjs` when the file exists), keeping the baseline-recording intent.
     4. `.agents/README.md` (index invariant "one line per artifact"): add a line for THIS plan (2026-08-20 — oxlint + lefthook pre-commit), and restore the invariant for plans added since the last backfill: add lines for `2026-08-20-embrace-journal-learnings-csm.md` and `2026-08-20-skill-suite-efficiency-resilience-csm.md`, and refresh the consolidated plan's line from `status: complete` to `status: ready (reopened; T010-T012 pending)` — mechanical metadata only.
     5. Verify no other plan references the old hook (consolidated plan has none — confirmed).
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 (README tree/integrity checks pass) AND `grep -c "sync-skill-boilerplate" scripts/hooks/pre-commit` prints 0 (shim has no such reference) AND skill-suite T001 shows the superseded pointer AND journal-learnings T002 shows the .lefthook.yml job reference AND `.agents/README.md` contains exactly one line per plan artifact (this plan, journal-learnings, skill-suite indexed; consolidated status refreshed).
   - Validation: README tree lines point at existing files; `node scripts/gen-readme-matrix.mjs --check` passes; plan-corpus template checks pass; `git diff --stat` bounded to the three files.
   - Acceptance evidence: check-suite output; grep results; diff summaries of the two amended plans.
   - Repair attempts: 0
   - Recovery note: docs/plan edits are independently revertible; if check-suite's README-tree check rejects the added lines, drop them and re-run (the tree may be curated, not exhaustive — gate output decides).

5. [pending] Final battery: scratch-clone installer proof and full gate run
   - Task ID: T005
   - Depends on: T002, T003, T004
   - Parallel group: G4
   - Risk: standard (verification + sandboxed installs only)
   - Owned scope: no source writes; evidence recorded in this plan's journal; scratch clone under an isolated /tmp/opencode sandbox
   - Not in scope: any production changes beyond evidence recording
   - Spike candidate: none
   - Actions:
     1. Scratch-clone proof: `git clone --depth 1 file://<repo> /tmp/opencode/lefthook-proof-<rand>` (sandboxed HOME/TMPDIR/XDG_* per repo convention), run `node scripts/install-hooks.mjs` there, assert `core.hooksPath` set, `lefthook validate` OK, `scripts/hooks/pre-commit` shim present, no `.old`; run the uninstall path and assert core.hooksPath is unset; reinstall.
     2. Live commit proof in the repo: stage a trivial safe change, `git commit` (recorded transcript showing the five jobs in order and pass), then restore the working tree to HEAD if the commit was only for proof (or commit the plan-file batch per the normal checkpoint flow).
     3. Full battery: `node scripts/check-suite.mjs` (449 baseline); `node --test scripts/hooks/test/pre-commit.test.mjs`; `cd csm-browse && node scripts/check-skill.mjs`; `node --test tests/package-audit.test.mjs` spot; record pass counts + wall times per repo recording discipline.
   - Acceptance signal: scratch-clone installer + uninstall + reinstall all succeed AND the live commit transcript shows all five jobs AND check-suite exits 0 AND the hook test suite passes.
   - Validation: cheapest first — check-suite, hook tests, then scratch-clone installs; all sandboxed under /tmp/opencode; no writes to real user state beyond the repo's own git config.
   - Acceptance evidence: scratch-clone transcripts, commit transcript, battery outputs, sandbox path + isolation note.
   - Repair attempts: 0
   - Recovery note: pure verification; any failure routes to the owning task (T001 lockfile, T002 config/installer, T003 tests, T004 docs) and is journaled before re-running this task.

## Verification Strategy

Ordered cheapest-first:
- Fast per-task gates: `node scripts/check-suite.mjs` (every task), `npx lefthook validate` (T002), `node --check` on edited .mjs (T002/T003/T004), version greps (T001).
- Mid-tier: rewritten hook test suite `node --test scripts/hooks/test/pre-commit.test.mjs` (T003, also re-run at T005); README integrity + matrix checks (T004).
- Expensive final battery (T005, sequential): scratch-clone installer/uninstall/reinstall (network via npm ci — sandboxed under /tmp/opencode only), live commit transcript, csm-browse check-skill, full hook suite.
- Parallelism: per-task gates in parallel within G2; T005 sequential by design.
- Environment sensitivity: hook tests require root `node_modules` (skip-loudly when absent); `npm ci` needs network only in the scratch sandbox; csm-browse e2e (Docker) is NOT part of acceptance.

## Risks And Recovery

- Gate replacement breaks the commit path (high, T002): mitigated by the independent review mandate, the piped guard-first chain, and revert-to-HEAD recovery (the old hook is a committed file); the one-time `pre-commit.old` rename is cleaned by the installer and covered by T005's scratch proof.
- Committed shim vs binary drift (medium): lefthook is exact-pinned (2.1.10); if a future version regenerates a different shim, the commit and binary stay in lockstep because the installer runs `lefthook install --force` from the pinned node_modules binary — never a global one.
- Offline hook dependence on node_modules (low): fresh clones must run `install-hooks.mjs` (npm ci) before commits; the deps-gated skip in tests and a loud installer message mitigate; bypass remains `git commit --no-verify` (unchanged behavior).
- Plan conflict with pending plans (medium): skill-suite T001 and journal-learnings T002 touch the same hook file; T004 amends both BEFORE they execute (both are pending, never dispatched), with superseded pointers so csm-build resolves cleanly.
- oxlint false-positive risk on legacy code (medium): first full staged run may surface existing issues; scope is staged-files-only, so only files being committed are affected; remediation is fixing the file or, if oxlint's default rule set is wrong for a file, an explicit per-file suppress with owner:/reason: — never a committed `.oxlintrc.json` (user constraint).
- check-suite README-tree strictness (low, T004): if the tree check rejects new root lines, drop them (gate output decides); recovery is trivial re-edit.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| (filled by CRITIQUE/REMEDIATE during planning) | | | |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE | — | User decisions captured: CSM plan first; lefthook REPLACES existing gate; oxlint staged-only, defaults, no .oxlintrc | DISCOVER |
| 2026-08-20 | 0 | RESEARCH | — | Single focused track: lefthook install semantics (no -d flag; --force with core.hooksPath; .old rename; postinstall), oxlint zero-config/exit-codes/no-stdin, root package.json safety (no gate/test breaks), hook test porting, full cross-reference list | DRAFT |
| 2026-08-20 | 0 | DRAFT | — | Plan drafted: 5 tasks, G1-G4, approach (a) committed-shim design | CRITIQUE |
| 2026-08-20 | 0 | CRITIQUE | — | Primary-led critique (small plan): found 2 issues — `node --check` is per-file so the mjs-syntax job must loop (mirrors scripts/hooks/pre-commit:46-56); `.agents/README.md` index invariant missing lines for this plan + two 08-20 plans and a stale consolidated status | REMEDIATE |
| 2026-08-20 | 0 | REMEDIATE | — | Both fixed: Design/T002 mjs-syntax job loops per staged file; T004 gains .agents/README.md scope (index line for this plan, backfill journal-learnings + skill-suite lines, refresh consolidated status) | VERIFY |
| 2026-08-20 | 0 | VERIFY | — | Personal review: goal/AC map to T001-T005; every task has runnable acceptance signal, risk tier, anti-scope, recovery note; dependencies G1->G2/G2->G3->G4 correct; commands/files verified against repo (lefthook 2.1.10/oxlint 1.79.0, install-hooks.mjs:22, check-suite green 451) | SAVED |

## Completion Review

(filled by csm-build when all criteria are verified)
