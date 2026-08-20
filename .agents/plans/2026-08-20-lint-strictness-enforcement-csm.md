---
format: csm-plan/1
---

# Lint Strictness And Zero-Warning Enforcement CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 6 tasks — 2 high-risk (T002 bulk-fixes ~289 findings in scanner internals incl. 180 sort sites; T006 introduces a new repo-wide gate into check-suite), 4 standard. Tasks that always require independent review: T002, T006.

## Control
- Plan ID: lint-strictness-enforcement
- Status: in_progress
- Current CSM state: SELECT
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-20 cycle 0 — T001 complete (commit 8f57757): .oxlintrc.json (correctness+suspicious warn; no-control-regex off; no-underscore-dangle allow [_meta,_repoPath,__dirname]), make lint strict, README docs; parity 979 (1,001 − 22 config-resolved); check-suite 456 OK. Next: G2 = T002 || T003 || T004.
- Next transition: SELECT -> DISPATCH (T002, T003, T004)
- Active tasks: T002, T003, T004
- Blockers: none
- Cross-plan coordination: three other pending plans share files with this one — skill-suite plan T006/T008 (`scripts/check-suite.mjs`, `bootstrap/package/payload/**`), journal-learnings plan T001/T004/T007 (`scripts/check-suite.mjs`, `scripts/hooks/pre-commit`), skill-suite T001 (`scripts/sync-skill-boilerplate.mjs`). This plan's edits are additive and idempotent (pack-bootstrap regen is last-writer-wins with identical output when sources match); RECOVER in any build must reconcile against the latest HEAD. See `## Cross-Plan Coordination`.

## Goal

Make `make lint` (and the repo's commit gates) return ZERO warnings, permanently. Fix all **979** fixable oxlint findings (1,001 total minus 22 config-resolved: 6 no-control-regex + 16 no-underscore-dangle) that a `correctness + suspicious` ruleset produces across the repo today (measured; user decision: full suspicious category), commit a `.oxlintrc.json` that pins that ruleset as the quality bar, and enforce the bar at three layers: the pre-commit hook (staged files, `--deny-warnings`, config discovered from repo root), `make lint` (repo-wide `--deny-warnings`), and a new conditional repo-wide lint gate inside `scripts/check-suite.mjs` (skips with a loud warning when oxlint is unavailable, keeping the gate runnable on fresh clones without node_modules). The check-suite gate lands in T006 — after the fixes — so the build's own commits are never blocked mid-migration.

Deliverables:
1. Committed `.oxlintrc.json`: `$schema`, `categories: { correctness: warn, suspicious: warn }`, plus justified per-rule overrides — expected: `eslint/no-control-regex: off` (intentional control-char detectors; escapes still flag, verified) and `eslint/no-underscore-dangle` with `allow` for data-key identifiers (`_meta`, etc. — property-key reads, not renamable; verified). Nothing else without journal evidence.
2. All 979 fixable findings eliminated from source files (the 22 config-resolved sites need no code edits): csm-scan lib (~289), csm-scan test (~297), csm-browse lib/tests/scripts, csm-upload, root scripts/tests. Every fix behavior-preserving (fix contract in Design).
3. `bootstrap/package/payload/skills/**` regenerated via the canonical `node scripts/pack-bootstrap.mjs` so the payload mirror is lint-clean and matches sources (no hand-edits).
4. Enforcement: `make lint` = `pnpm exec oxlint --deny-warnings` (config-driven); the lefthook oxlint job picks up `.oxlintrc.json` automatically (config discovery — verified pattern); `scripts/check-suite.mjs` gains the conditional lint gate (T006).
5. README updated (lint/strictness docs), plan index line added.

Constraints:
- Config-first: `.oxlintrc.json` lands in T001 so every fix task iterates against the authoritative ruleset (config-driven count = CLI `-D suspicious` count = 1,001 — parity-verified in planning).
- Fix contract: mechanical, behavior-preserving transformations only. `no-array-sort`/`no-array-reverse`: `.toSorted()`/`.toReversed()` (ES2023; verified present on the baseline node v20.20.2); where a call site relies on in-place mutation, copy-then-rebind and preserve semantics; `.toSorted()` is stable, preserving output ordering — the csm-scan golden suites (1,227 tests) are the safety net and MUST stay green.
- Payload mirror is never hand-edited: only `node scripts/pack-bootstrap.mjs` writes it (T005); bounded diff check.
- `no-unused-vars` fix convention: delete dead imports/declarations; unused params may be `_`-prefixed (no-underscore-dangle does not flag function params — allowFunctionParams default, per rule option surface; the 16 flagged sites are property reads, handled by config, not renames).
- The check-suite lint gate is NOT added in T001 — it lands in T006 after the zero-warning baseline is reached (sequencing fix from critique).
- check-suite.mjs keeps zero npm-dependency property: the gate execs the oxlint binary via `node:child_process` when present.
- `node scripts/check-suite.mjs` stays green after every task (with the gate absent until T006); hook suite 7/7, csm-scan serial 1,227, bootstrap suites 30, csm-browse check-skill stay green.

Exclusions:
- No style/pedantic/nursery categories (measured: 51,756 / 6,814 / 777 — infeasible; R&D record).
- No oxlint `--fix` (silent semantic rewrites); all edits deliberate per the contract.
- No changes to csm-scan runtime behavior, CLI, or output formats.
- No `.oxlintrc.json` ignorePatterns for source or payload (bar applies repo-wide; payload is regenerated, not ignored).
- No CI workflows.

## Acceptance Criteria

1. `pnpm exec oxlint --deny-warnings` exits 0 over the whole repo (config-driven, no extra CLI rule flags) and `make lint` exits 0 with zero warning lines.
2. `.oxlintrc.json` committed with `categories: { correctness, suspicious }`; every override (no-control-regex off; no-underscore-dangle allow-list) carries journal justification from T001's enumeration.
3. csm-scan authoritative suite passes: `cd csm-scan && node --test --test-concurrency=1` = 1,227/1,227.
4. Payload regenerated: deterministic digest recorded; `bootstrap/package/payload/skills/**` byte-matches sources (`diff -r` clean); payload tree lint-clean.
5. Enforcement live at all three layers with negative proofs: a staged `no-shadow` warning (suspicious category) fails the hook's oxlint job (fixture `.oxlintrc.json` injected); a reintroduced warning fails `make lint`; check-suite's lint gate fails on the same and passes with the pinned `lint gate skipped — oxlint not installed (run: pnpm install)` line when oxlint is absent.
6. Full battery green: check-suite (incl. lint gate), hook suite (7/7, extended with the suspicious-config case), csm-scan 1,227, bootstrap suites, csm-browse check-skill, `make lint` clean.
7. Every numbered task completed with recorded acceptance evidence; README + `.agents/README.md` updated.

## Current-State Evidence

- `make lint` today (errors-only): **265 warnings** across 95 files, 7 rules: eslint/no-unused-vars 137, eslint/no-useless-escape 62, unicorn/prefer-string-starts-ends-with 31, unicorn/no-useless-fallback-in-spread 16, unicorn/no-useless-spread 7, unicorn/no-new-array 6, eslint/no-control-regex 6. 88 of the 265 sit in the `bootstrap/package/payload/` mirror.
- Suspicious-category sizing (read-only, recorded): `pnpm exec oxlint -D suspicious` emits **265 warnings + 736 errors = 1,001 diagnostics** across **228 files**. The suspicious category alone is 736: unicorn/no-array-sort 597, eslint/no-shadow 55, unicorn/no-array-reverse 28, unicorn/consistent-function-scoping 28, eslint/no-underscore-dangle 16, eslint/no-useless-concat 6, eslint/preserve-caught-error 4, unicorn/no-array-fill-with-reference-type 2. Config-driven `--deny-warnings` with correctness+suspicious warn reproduces 1,001. style = 51,756, pedantic = 6,814, nursery = 777 — rejected.
- no-array-sort distribution (repo-wide 597): csm-scan lib 180, csm-scan test 203, payload lib 180, root 32, csm-browse lib 2.
- File-area table (default config, 95 unique files; suspicious adds more): csm-scan/lib 28, csm-scan/test 17, payload 29 (88 findings), csm-browse/lib 8 (10 findings incl. ensure-browser under scripts), csm-browse/tests 6 (16 findings), csm-upload 1 (4 findings), root scripts 2, root tests 3.
- `.oxlintrc.json` schema verified (node_modules/oxlint/configuration_schema.json): top-level `categories` (per-category allow|warn|deny) + `rules` (per-rule overrides that WIN over categories) + `plugins`/`ignorePatterns`/`overrides`.
- no-control-regex: the 3 source sites already use escapes (`\u0000`, `\x00`-forms) and are STILL flagged by oxlint 1.79.0 (empirically verified on a temp file) — they are intentional control-char detectors; resolution is a per-rule `off` override.
- no-underscore-dangle: all 16 sites are object-property reads (`value._meta` — standard Pipfile.lock key, parsers.mjs:574-576; `layers._repoPath`) or `const __dirname` — NOT renamable identifiers; resolution is config `allow` (or consistent writer+reader renames for `_repoPath`).
- Enforcement points today: lefthook oxlint job = `./node_modules/.bin/oxlint --deny-warnings --no-error-on-unmatched-pattern {staged_files}`; `make lint` = errors-only; check-suite.mjs has no lint gate, imports only local + node: modules (no node:child_process today), prints `check(...)`/`MISSING:`/OK lines (no existing skip-line convention — the new skip line is pinned verbatim in this plan).
- `.toSorted()`/`.toReversed()` present on node v20.20.2 (verified `typeof [].toSorted === 'function'`); stable sorts.
- csm-scan suite count 1,227 (journal 2026-08-18-remaining-active-suite-work:19,181).
- Payload regeneration: `scripts/pack-bootstrap.mjs` canonical (README.md:199-208); payload drift unguarded in check-suite today.
- Cross-plan file collisions (all pending, NOT_STARTED): skill-suite `2026-08-20-skill-suite-efficiency-resilience-csm.md` T006 owns `scripts/check-suite.mjs` + `scripts/lib/plan-validation.mjs`, T008 owns payload regen, T001 owns `scripts/sync-skill-boilerplate.mjs` + `scripts/hooks/pre-commit`; journal-learnings `2026-08-20-embrace-journal-learnings-csm.md` T001/T004/T007 own `scripts/check-suite.mjs`, T002 owns `scripts/hooks/pre-commit` (retargeted to .lefthook.yml by the oxlint-lefthook plan's T004). git tree clean at planning time.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Quality bar = `correctness + suspicious` categories, warnings-as-errors via `--deny-warnings`, pinned in committed `.oxlintrc.json` | User-dictated | Question answered "Full suspicious only" + "Commit .oxlintrc.json" | Accepted |
| A2 | style/pedantic/nursery stay off; measured counts (51,756/6,814/777) recorded as evidence | Planning (evidence) | R&D sizing | Accepted |
| A3 | Enforcement at three layers: hook (staged) + `make lint` (repo-wide) + check-suite conditional gate | User-dictated | Question answered "check-suite + hook + make" | Accepted |
| A4 | The check-suite gate is added in T006 (after fixes), NOT T001 — otherwise the build's own commits fail the hook mid-migration (critique F7) | Planning (sequencing) | .lefthook.yml runs check-suite on every commit; 1,001 findings exist until T005 | Accepted |
| A5 | `no-control-regex` is resolved via per-rule `off` with journal justification — the sites are intentional detectors and escape forms still flag | Research | Empirical verification (critique F3) | Accepted |
| A6 | `no-underscore-dangle` is resolved via config `allow` for data-key identifiers (`_meta`, `_repoPath` if not consistently renamed) — property reads are not renameable without behavior risk | Research | All 16 sites enumerated as property reads (critique F4) | Accepted |
| A7 | Fix contract: behavior-preserving mechanical edits; `.toSorted()`/`.toReversed()` (stable) for sort/reverse; rebind where mutation is relied on | Planning | ES2023 on node >= 20 verified | Accepted |
| A8 | Payload regenerated, never hand-edited; `node scripts/pack-bootstrap.mjs` is the only writer | Planning | Canonical process; consolidated-plan T002 precedent | Accepted |
| A9 | `make lint` requires node_modules (pnpm install) — a dev tool; fresh-clone behavior is documented, not guarded | Planning | oxlint binary is a devDependency (critique F13) | Accepted |
| A10 | Cross-plan shared files (check-suite.mjs, payload, hooks) reconcile at RECOVER against latest HEAD; pack-bootstrap regen is idempotent (identical output for identical sources) | Planning | F9 coordination note in Control | Accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What does `make lint` flag today? | `make lint`; inventory to /tmp/opencode/lint-warnings.txt | Read-only lint | 265 warnings, 7 rules, 95 files; 88 in payload | Baseline scope |
| R2 | Scale of stricter categories? | `pnpm exec oxlint -D <category>` per category | Read-only lint | correctness+suspicious = 1,001 (265 warn + 736 error); style 51,756; pedantic 6,814; nursery 777 | Scope = 1,001; A2 |
| R3 | suspicious rule breakdown + sort distribution? | `oxlint -D suspicious` histograms by rule and by area | Read-only | 597/55/28/28/16/6/4/2; sorts: lib 180, test 203, payload 180, root 32, browse-lib 2 | Fix-task partition + risk tiers |
| R4 | .oxlintrc.json schema? | Read node_modules/oxlint/configuration_schema.json | Read-only | categories + rules override categories + plugins/ignorePatterns/overrides | T001 config shape |
| R5 | Do escaped control-char regexes still flag? | Temp file + oxlint 1.79.0 | /tmp only | `\u0000`/`\x00` forms still flagged | no-control-regex -> config off (A5) |
| R6 | no-underscore-dangle site nature? | Enumerate the 16 findings; read parsers.mjs:574-576 | Read-only | Property-key reads (`_meta` Pipfile.lock key), `__dirname` | Config allow-list (A6) |
| R7 | toSorted/toReversed available on baseline node? | `node -e "typeof [].toSorted"` | Read-only | Function on v20.20.2; stable | Fix contract valid |
| R8 | Config-driven count vs raw CLI count? | `.oxlintrc.json` + `oxlint --deny-warnings` vs `-D suspicious` | /tmp only | Raw 1,001; config-resolved 979 (22 overrides applied) | Parity check in T001 = 979 |

## Discovered Requirements

- The check-suite lint gate MUST NOT be committed before T006 (the hook runs check-suite on every build commit; 1,001 findings exist until T005 lands).
- `rules` entries override `categories` (schema-documented): overrides land in `rules` with justification in the journal + README (JSON has no comments).
- `.toSorted()`/`.toReversed()` are ES2023 (node >= 20): do NOT use syntax beyond ES2023 in csm-scan lib (baseline env node v20.20.2).
- check-suite.mjs is synchronous: the gate uses `execFileSync` from `node:child_process` (a new import — first external-from-node: import; acceptable, still zero npm deps).
- The skip line is pinned verbatim: `lint gate skipped — oxlint not installed (run: pnpm install)` (T006 acceptance asserts this exact text).
- csm-scan golden baselines assert exact output: sort/reverse fixes must preserve ordering (stable sorts do); verify focused goldens before the full suite.
- Payload diff must be bounded to csm-scan lib + csm-upload payload files + regenerated index after T002-T004 (T005).
- The pre-commit hook's unstaged-guard means all fix-task edits must be staged before commits during the build.
- The hook-test fixture repo never receives `.oxlintrc.json` today — T006 must inject a minimal suspicious-enabled `.oxlintrc.json` into the fixture for the no-shadow negative proof (a real harness change).
- `scripts/check-suite.mjs` itself carries 12 findings (4 no-shadow, 4 no-array-sort, 1 no-new-array, 3 prefer-string-starts-ends-with) — owned by T004 (root scripts); T006's gate edit must be applied AFTER T004's fixes to the same file (sequential by dependency).

## Design

**Config (T001).** `.oxlintrc.json`:
```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": { "correctness": "warn", "suspicious": "warn" },
  "rules": {
    "eslint/no-control-regex": "off",
    "eslint/no-underscore-dangle": ["warn", { "allow": ["_meta", "_repoPath"] }]
  }
}
```
The `allow` list is finalized by T001's enumeration of the 16 sites (add/remove names with journal justification; `__dirname` sites get `const __dirname` handling only if a rewrite is behavior-safe, else joined into the allow list — `__dirname` is a Node convention, so it is allow-listed). No other overrides without evidence.

**Fix contract (T002-T004).** Every edit is one of:
1. Delete dead imports/declarations (`no-unused-vars`).
2. Rename unused params to `_x` (params exempt from no-underscore-dangle) or delete dead locals.
3. Remove unnecessary escapes (`no-useless-escape`): collapse `\$`/`\[` etc. to literals.
4. `regex.test(x)` → `x.startsWith/endsWith` (`prefer-string-starts-ends-with`).
5. Spread/fallback simplification (`no-useless-spread`, `no-useless-fallback-in-spread`); `new Array(n)` → `Array.from({ length: n })` (`no-new-array`).
6. `.sort(...)` → `.toSorted(...)`; `.reverse()` → `.toReversed()` (`no-array-sort`, `no-array-reverse`): stable, copy-free; where the call site reads the SAME array after mutation, rebind (`const x = arr.toSorted(...)`) and update downstream uses; NEVER change ordering.
7. `no-shadow`: rename the shadowing identifier (mechanical, local).
8. `consistent-function-scoping`: hoist or inline per site evidence (mechanical).
9. `no-useless-concat`: merge adjacent string literals.
10. `preserve-caught-error`: rethrow the original error (or restructure per site evidence).
11. `no-array-fill-with-reference-type`: construct elements individually.
NO control-regex edits (rule is off, A5) and NO `--fix`.

**Enforcement (T006).** `make lint` → `pnpm exec oxlint --deny-warnings` (T001). check-suite.mjs (T006): after existing checks, if `node_modules/.bin/oxlint` exists, `execFileSync` `oxlint --deny-warnings`, emit a lint-check line (fail on non-zero, include oxlint output); else emit the pinned skip line, never fail. The lefthook oxlint job stays byte-identical; config discovery (cwd=repo root) applies the ruleset. Hook-test suite (T006): fixture gains a minimal `.oxlintrc.json` (correctness+suspicious warn) and a new case — staged `no-shadow` warning blocks the commit.

**Payload (T005).** After source fixes: `node scripts/pack-bootstrap.mjs`; bounded diff (csm-scan lib + csm-upload payload files + index); byte-compare payload vs sources; lint the payload tree (must be clean — mirrors fixed sources); record deterministic digest.

## Cross-Plan Coordination

- `scripts/check-suite.mjs` is edited by THIS plan (T004 fixes its 12 findings, T006 adds the gate) and by skill-suite T006 and journal-learnings T001/T004/T007. All three plans are pending; whichever build runs first commits the file, and later builds' RECOVER re-derives from HEAD. Edits are additive (Control-validation checks vs the lint gate) and do not conflict textually — each build must re-run `node scripts/check-suite.mjs` after integrating.
- `bootstrap/package/payload/**` is regenerated by THIS plan T005 and skill-suite T008: pack-bootstrap is idempotent (identical output for identical sources), so order is irrelevant PROVIDED each plan runs pack + integrity verification after its own source edits and does not rely on the other's payload state.
- `scripts/sync-skill-boilerplate.mjs` (1 no-new-array finding, THIS plan T004) is owned by skill-suite T001: T004's fix is a one-line `new Array(n)` change; skill-suite T001's condensation work composes with it (both edit the file — sequential builds, RECOVER reconciliation).
- `scripts/hooks/pre-commit` is already superseded by the lefthook shim (oxlint-lefthook plan, executed); journal-learnings T002's baseline-recording line now targets `.lefthook.yml` — no conflict with this plan (which does not touch hooks).
- If a coordinating build executes this plan's T005/T006 before skill-suite T008/T006, the skill-suite build re-runs pack + check-suite on its own schedule; no data loss either way.

## Execution Graph

- G1: T001 (config + Makefile + README) — base; fix tasks iterate against the committed config.
- G2: T002 (csm-scan/lib) || T003 (csm-scan/test + csm-scan/scripts) || T004 (csm-browse/lib + tests + scripts + csm-upload + root scripts + root tests) — disjoint directory ownership; each depends on T001.
- G3: T005 (payload regen) — depends T002, T003, T004.
- G4: T006 (check-suite gate + hook-suite extension + negative proofs + full battery) — depends T001-T005.

Critical path: T001 -> T002 -> T005 -> T006.

## Numbered Plan

1. [pending] Quality-bar config: .oxlintrc.json + strict make lint + enumeration
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (config + Makefile + README only; NO gate change here — sequencing per A4)
   - Owned scope: `.oxlintrc.json` (new), `Makefile` (lint targets), README.md (lint/strictness docs)
   - Not in scope: `scripts/check-suite.mjs` (T006); any warning fixes (T002-T004); `.lefthook.yml` (byte-identical); payload files
   - Spike candidate: none — schema (R4) and counts (R8) verified in planning
   - Actions:
     1. Write `.oxlintrc.json` per Design. Enumerate all 16 `no-underscore-dangle` and 6 `no-control-regex` sites; classify each; finalize the `allow` list and confirm the no-control-regex `off` (record per-site evidence in the journal). Add `__dirname` handling (allow-list — Node convention).
     2. Parity check: `pnpm exec oxlint --deny-warnings 2>&1 | grep -c warning` must equal 979 (1,001 raw minus 22 config-resolved: 6 no-control-regex + 16 no-underscore-dangle overrides).
     3. `Makefile`: `lint` → `pnpm exec oxlint --deny-warnings`; remove `lint-strict` (now identical); update help text. NOTE: `make lint` FAILS until T005 lands — that is expected and acceptable (dev tool; fixes are in flight). Do NOT add the check-suite gate.
     4. README.md: document the committed config as the quality bar, the strict `make lint`, the future check-suite gate (T006), and that `make lint` requires `pnpm install` first (A9).
   - Acceptance signal: `.oxlintrc.json` committed with categories + the two justified rules overrides AND the parity count = 979 (1,001 raw minus the 22 config-resolved findings) AND `make lint` help shows `--deny-warnings` AND `node scripts/check-suite.mjs` still exits 0 (untouched).
   - Validation: `grep -c warning` parity; `node --check` nothing (no JS touched); check-suite OK; README diff.
   - Acceptance evidence: config file; parity output; Makefile diff; per-site enumeration table in the journal.
   - Repair attempts: 0
   - Recovery note: revert `.oxlintrc.json`/Makefile/README to HEAD; the config is inert until fixes land (fixes iterate against it), and check-suite is untouched so commits cannot be blocked by this task.

2. [pending] Fix csm-scan library warnings (289 findings, incl. 180 sort sites)
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high — behavior-sensitive edits inside scanner internals guarded by the 1,227-test suite; requires independent review
   - Owned scope: `csm-scan/lib/**` (.mjs only)
   - Not in scope: csm-scan/test + csm-scan/scripts (T003); payload copies (T005); anything outside csm-scan/lib
   - Spike candidate: none — fix contract is rule-by-rule mechanical
   - Actions:
     1. Run `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern csm-scan/lib`; apply the fix contract (items 1-11) to every finding (~289: 180 sort sites, no-shadow, unused vars, escapes, starts/ends-with, fallback spreads, etc.).
     2. Sort/reverse (item 6): `.toSorted()`/`.toReversed()` with rebinding where the mutated array is read later; preserve ordering (stable).
     3. After each file batch: per-file `oxlint --deny-warnings` clean; run the affected focused golden tests, then the full serial suite.
     4. Journal per-file fix counts and any contract deviation (expected: none).
   - Acceptance signal: `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern csm-scan/lib` prints zero findings AND `cd csm-scan && node --test --test-concurrency=1` passes 1,227/1,227.
   - Validation: cheapest first — per-file lint clean; focused goldens; full serial suite; `node scripts/check-suite.mjs` green.
   - Acceptance evidence: oxlint clean output; suite counts; per-file diff stat.
   - Repair attempts: 0
   - Recovery note: a failing test after a batch → the sort/reverse or scoping edit is suspect; revert that batch via git and re-apply the contract one rule at a time; the suite is the oracle.
   - Independent review: reviewer spot-checks >=20 random fix diffs for behavior preservation (especially sort/reverse + shadow renames) and confirms no `--fix`.

3. [pending] Fix csm-scan test and script warnings (297 findings, incl. 203 sort sites)
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (test code; the suite is the oracle)
   - Owned scope: `csm-scan/test/**` + `csm-scan/scripts/**` (.mjs only)
   - Not in scope: csm-scan/lib (T002); payload copies (T005)
   - Spike candidate: none
   - Actions:
     1. Apply the fix contract (items 1-11) to every finding in the owned paths (~297: dead imports, sorts, escapes, shadow, etc.).
     2. Dead imports → delete (rg-verify single occurrence); unused vars → delete or `_`-prefix params; sorts/reverses → toSorted/toReversed with rebinding; `new Array(n)` → `Array.from({ length: n })`.
     3. Per-file lint clean; run affected test files; then the full serial suite.
   - Acceptance signal: `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern csm-scan/test csm-scan/scripts` prints zero findings AND `cd csm-scan && node --test --test-concurrency=1` passes 1,227/1,227.
   - Validation: per-file lint clean; focused tests; full serial suite; check-suite green.
   - Acceptance evidence: oxlint clean output; suite counts; diff stat.
   - Repair attempts: 0
   - Recovery note: revert the suspect batch and re-apply per rule; suite failures localize the break.
   - Independent review: primary-led (test code; low risk per Scale To The Ask).

4. [pending] Fix csm-browse, csm-upload, and root warnings (38 findings)
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (behavior-adjacent but small surfaces; check-skill, browse unit tests, and root tests are the oracles)
   - Owned scope: `csm-browse/lib/**`, `csm-browse/tests/**`, `csm-browse/scripts/**` (ensure-browser.mjs finding), `csm-upload/**` (scripts/upload.mjs), root `scripts/**` (.mjs incl. check-suite.mjs's own 12 findings and sync-skill-boilerplate.mjs's no-new-array), root `tests/**`
   - Not in scope: csm-scan paths (T002/T003); `.lefthook.yml`; package files; payload copies (T005)
   - Spike candidate: none
   - Actions:
     1. Apply the fix contract (items 1-11) to every finding in the owned paths (~38: browse lib 22 + browse tests 16 + ensure-browser 1 + upload 4 + root scripts 2 + root tests 3, minus overlaps).
     2. check-suite.mjs's own 12 findings (no-shadow x4, no-array-sort x4, no-new-array x1, prefer-string-starts-ends-with x3) are fixed HERE; the file remains byte-stable otherwise (the T006 gate lands later on top of these fixes).
     3. Per-file lint clean; run `node --test csm-browse/tests/unit/auth.test.mjs`, affected root tests, `cd csm-browse && node scripts/check-skill.mjs`, `node --test csm-upload/tests/*` if present, and `node scripts/check-suite.mjs`.
   - Acceptance signal: `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern csm-browse/lib csm-browse/tests csm-browse/scripts csm-upload scripts tests` prints zero findings AND check-skill + affected tests + `node scripts/check-suite.mjs` pass.
   - Validation: per-file lint clean; affected tests; check-suite green.
   - Acceptance evidence: oxlint clean output; test counts; diff stat.
   - Repair attempts: 0
   - Recovery note: revert suspect batch; re-apply per rule; check-suite.mjs's own fixes are independently revertible if its behavior changes (it must not).
   - Independent review: primary-led (small surface; check-suite.mjs fixes verified by the gate run).

5. [pending] Regenerate and verify the payload mirror
   - Task ID: T005
   - Depends on: T002, T003, T004
   - Parallel group: G3
   - Risk: standard (release-artifact bytes change; deterministic digest must hold)
   - Owned scope: `bootstrap/package/payload/**` + `bootstrap/payload-index.json` (via `node scripts/pack-bootstrap.mjs` ONLY)
   - Not in scope: any hand edit of payload files; package.json version bumps; publication
   - Spike candidate: none — canonical process documented (README.md:199-208)
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs`; record the deterministic tarball digest (sha256/bytes/file-count).
     2. Bounded-diff check: git diff of `bootstrap/**` limited to the csm-scan lib + csm-upload payload files fixed in T002/T004 + regenerated index.
     3. Byte-compare payload vs sources (`diff -r` for the mirrored tree) — expect clean.
     4. Lint the payload tree: `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern bootstrap/package/payload` — expect zero findings (it mirrors fixed sources, incl. csm-upload).
     5. Run `node --test tests/package-audit.test.mjs` and the five bootstrap suites serially.
   - Acceptance signal: pack digest recorded AND payload tree lint-clean AND `diff -r` clean AND package-audit 1/1 AND bootstrap suites pass.
   - Validation: bounded diff; lint; integrity test; serial suites.
   - Acceptance evidence: digest, diff stat, lint output, suite outputs.
   - Repair attempts: 0
   - Recovery note: a bad refresh reverts via `git checkout bootstrap/**`; never hand-edit payload; if the diff is unbounded, stop and investigate.

6. [pending] Enforcement: check-suite lint gate, hook-suite extension, negative proofs, full battery
   - Task ID: T006
   - Depends on: T001, T002, T003, T004, T005
   - Parallel group: G4
   - Risk: high — introduces a new repo-wide gate into check-suite.mjs; requires independent review
   - Owned scope: `scripts/check-suite.mjs` (lint gate), `scripts/hooks/test/pre-commit.test.mjs` (fixture `.oxlintrc.json` injection + suspicious-case), README.md (gate docs if not already added in T001), plan journal evidence
   - Not in scope: any warning fixes (repo must already be clean); `.lefthook.yml`; payload
   - Spike candidate: none
   - Actions:
     1. check-suite.mjs: add `import { execFileSync } from 'node:child_process'` (first non-node: built-in import — still zero npm deps). After the existing checks: if `node_modules/.bin/oxlint` exists, run `oxlint --deny-warnings`, emit the result as a check line (fail on non-zero, include oxlint's output); else print the pinned line `lint gate skipped — oxlint not installed (run: pnpm install)` as a warning, never a failure. Keep all other checks unchanged.
     2. Hook-test suite: inject a minimal `.oxlintrc.json` (categories correctness+suspicious warn) into the fixture repo before the staged-warning cases; add a case: a staged `.mjs` with a `no-shadow` warning blocks the commit (suspicious category proof). Keep the existing 7 cases green.
     3. Negative proofs (disposable /tmp/opencode fixture): (a) reintroduce one deliberate warning (e.g. `no-array-sort` in a scratch file) → `make lint` fails; (b) same in a staged commit inside the harness → hook oxlint job fails; (c) check-suite lint gate fails with the warning present (oxlint available); (d) fresh-clone simulation (no node_modules) → check-suite exits 0 with the exact pinned skip line.
     4. Repo-wide clean proof: `pnpm exec oxlint --deny-warnings` exits 0 with zero findings; `make lint` exits 0.
     5. Full battery: check-suite (incl. gate), hook suite (7 + new case), `cd csm-scan && node --test --test-concurrency=1` (1,227), five bootstrap suites (30, serial), `cd csm-browse && node scripts/check-skill.mjs`, `node --test tests/package-audit.test.mjs`. Record pass counts + wall times.
     6. `.agents/README.md`: add this plan's index line.
   - Acceptance signal: all four negative proofs behave as expected (pinned skip-line text exact) AND repo-wide lint clean AND full battery green AND hook suite (incl. new no-shadow case) passes.
   - Validation: cheapest first — lint, check-suite, hook suite, then serial suites; negative proofs sandboxed.
   - Acceptance evidence: transcripts for every proof; battery outputs; wall times.
   - Repair attempts: 0
   - Recovery note: pure verification + the gate; if the gate misbehaves, revert the check-suite.mjs gate block (keep the fix-task changes) and re-apply; the skip path is covered by proof (d).
   - Independent review: reviewer verifies the skip path (fresh clone), the fail path, and that all pre-existing check-suite checks are unchanged.

## Verification Strategy

Ordered cheapest-first:
- Fast per-task gates: `pnpm exec oxlint --deny-warnings --no-error-on-unmatched-pattern <owned paths>` (every fix task), `node scripts/check-suite.mjs` (after each task; gate absent until T006), `node --check` on edited files.
- Mid-tier: focused golden tests after lib batches (T002), affected test files (T003/T004), `cd csm-browse && node scripts/check-skill.mjs`.
- Expensive final battery (T006, serial): csm-scan authoritative suite (`--test-concurrency=1`, ~2-3 min, serial-only), bootstrap suites (serial, self-pack), hook suite, package-audit, negative proofs in /tmp sandboxes, repo-wide clean proof.
- Parallelism: per-task gates within G2 concurrently; T005/T006 sequential by design.
- Environment sensitivity: csm-scan must run serial; check-suite lint gate needs oxlint present (skip case proven in T006); csm-browse e2e (Docker) is NOT in acceptance.

## Risks And Recovery

- Sort/reverse fixes change scanner behavior (high, T002): stable-sort guarantee, rebind-only transformation, 1,227-test oracle, independent review of >=20 diffs; recovery = revert suspect batch.
- Gate lands only in T006 (medium if missed): sequencing enforced by the Execution Graph (T006 depends on all fix tasks) and the pinned Discovered Requirement; a stray early gate would block the build's own commits — recovery is reverting the gate block.
- Payload regen unbounded diff (medium, T005): bounded-diff check + revert; never hand-edit payload.
- no-underscore-dangle allow-list too broad (low): T001 enumeration is per-site; the list carries journal evidence; anything beyond `_meta`/`_repoPath`/`__dirname` requires justification.
- Golden-test ordering drift (medium): toSorted is stable; if a golden still fails, the site relied on mutation — rebind per the contract, never reorder output.
- Fresh-clone gate behavior (low): skip-with-warning keeps check-suite runnable without node_modules; hook + make lint remain strict enforcement in dev.
- Cross-plan build races (medium, A10): check-suite.mjs/payload/sync-tooling are shared with pending plans — RECOVER reconciliation against HEAD, additive edits, idempotent pack; recorded in Cross-Plan Coordination.
- Incomplete fix list (low): T001 parity (979) + T006 repo-wide clean proof close the loop; stragglers route back to the owning task.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1: total is 1,001, not 736; "471 new" fabricated | Critical | All counts corrected to 1,001 (265 warn + 736 suspicious); Goal/AC/R&D/tasks rewritten | Re-measured `-D suspicious` = 1,001 diagnostics |
| F2/F6: csm-browse/lib + csm-upload unowned (26 findings) | Critical | T004 scope widened to csm-browse/lib + csm-upload + csm-browse/scripts; acceptance command includes them; area table corrected | Enumerated 95 files vs task scopes |
| F7: T001 gate blocks the build's own commits | Critical | check-suite gate moved to T006 (after fixes); T001 touches config/Makefile/README only; A4 + Discovered Requirement pin it | .lefthook.yml runs check-suite per commit |
| F9: cross-plan collisions on check-suite/payload/sync-tooling | Critical | New `## Cross-Plan Coordination` section; A10; Control coordination note | Skill-suite T006/T008, journal-learnings T001/T004/T007 ownership |
| F3: no-control-regex escapes still flag | Major | Fix-contract item removed; per-rule `off` override with justification (A5); verified empirically | Temp-file oxlint run |
| F4: no-underscore-dangle sites are property reads | Major | Config `allow` list (`_meta`, `_repoPath`, `__dirname`) instead of renames (A6); enumeration in T001 | All 16 sites classified |
| F8: hook harness lacks config injection | Major | T006 injects fixture `.oxlintrc.json` + adds a no-shadow case (real harness change) | Fixture config analysis |
| F11: sort distribution is test-heavy (203 test vs 180 lib) | Minor | Risk texts rebalanced: T002 = 289/180, T003 = 297/203 | Histograms by area |
| F10: no skip-line convention | Minor | Skip line pinned verbatim in plan + T006 acceptance asserts exact text | check-suite output inspection |
| F13: make lint needs node_modules | Minor | A9: documented as dev tool, not guarded | oxlint is a devDependency |
| F14: .oxlintrc.json vs csm-scan self-analysis | Minor | Closed: ecosystem detection only runs when scanning TARGET repos; no test scans the repo root | ecosystem.mjs:291 semantics |
| F15: T001 acceptance self-contradictory | Minor | Acceptance rewritten for config-only T001; gate acceptance lives in T006 | — |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE | — | User requests: make lint + plan to fix all warnings + enforce strict bar. Decisions via 2 question rounds: full suspicious category, committed .oxlintrc.json, check-suite+hook+make enforcement; style/pedantic/nursery rejected on measured scale | DISCOVER |
| 2026-08-20 | 0 | RESEARCH | — | Inventory 265/7 rules/95 files; sizing correctness+suspicious = 1,001 (228 files), style 51,756, pedantic 6,814, nursery 777; suspicious breakdown + sort distribution; schema verified; no-control-regex escape futility verified; underscore-dangle sites = property reads; toSorted on v20 verified | DRAFT |
| 2026-08-20 | 0 | DRAFT | — | Plan drafted: 6 tasks, G1-G4, config-first, gate-in-T006 sequencing, fix contract, cross-plan coordination | CRITIQUE |
| 2026-08-20 | 0 | CRITIQUE | — | Independent review: MAJOR REWORK — 3 critical (1,001 count; unowned csm-browse/lib + csm-upload; gate sequencing blocks build commits), 4 major (no-control-regex off; underscore allow-list; harness config injection; cross-plan collisions) | REMEDIATE |
| 2026-08-20 | 0 | REMEDIATE | — | All 15 findings resolved: counts corrected; T004 scope widened; gate moved to T006; Cross-Plan Coordination section + A10; config overrides for no-control-regex + underscore allow; T006 harness injection + no-shadow case; risk texts rebalanced; skip line pinned | VERIFY |
| 2026-08-20 | 0 | VERIFY | — | Personal review: parity re-confirmed (1,001 = 265 warn + 736 error via -D suspicious); every AC maps to numbered tasks; all 6 tasks have runnable acceptance, risk tier, anti-scope, recovery note; dependencies G1->G2->G3->G4 sound (gate strictly after fixes); no parallel-group overlap; cross-plan coordination documented; check-suite 456 OK on the plan file | SAVED |

## Completion Review

(filled by csm-build when all criteria are verified)
