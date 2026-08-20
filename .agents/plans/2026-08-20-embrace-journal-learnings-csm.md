---
format: csm-plan/1
---

# Embrace Journal Learnings CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 7 tasks (1 high, 6 standard); T001, T004, T005 each add a new rule to `scripts/check-suite.mjs` — single-owner-per-wave discipline (journal lesson D10) requires they serialize: T001 (Wave 1) → T004 (Wave 2) → T005 (Wave 3). T005 additionally requires the check-suite test harness whose absence is review finding F-003, owned by T010 of `2026-08-19-consolidated-remaining-work-csm.md`; if T010 has not landed by then, T005's planted-defect negative tests use the temp-dir pattern instead (see T005 Recovery note).

## Control
- Plan ID: embrace-journal-learnings-2026-08-20
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-20T00:33Z — research complete (5 tracks: older journals, newer journals, docs/approaches/reviews, git history, current-state map); 43 mined themes deduped to 7 tasks; review-owned findings scoped out to T010
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Embrace the recurring findings, learnings, mistakes, adaptations, lessons, and workarounds mined from this repo's plan journals, review docs, and git history (2026-08-03..2026-08-19) by encoding them as automated gates, tooling, and a single cross-plan reference: payload-drift detection, gate-baseline recording, a Node 22 toolchain helper, a deferred-work ledger, plan acceptance-signal linting, plan closure automation, and a consolidated journal-lessons doc. Review-owned fixes (F-001..F-069) are explicitly out of scope — they are already owned by T010 of the consolidated plan.

Deliverables: 4 new standalone scripts (`scripts/record-gate-baseline.mjs`, `scripts/with-node22.mjs`, `scripts/check-plan-signals.mjs`, `scripts/close-plan.mjs`) plus new rules inside `scripts/check-suite.mjs`, 2 new docs (`.agents/docs/deferred.md`, `.agents/docs/journal-lessons.md`), 1 new data file (`.agents/docs/gate-baselines.json`), and rule additions to `scripts/check-suite.mjs` + `scripts/lib/contracts.mjs` + `scripts/hooks/pre-commit`.

Constraints: no CI workflow (T013/CI remains user-deferred — do not dispatch); no pack refactor to atomic swap (serial pack rule retained as a documented constraint); no changes to review-owned findings (T010); no edits to COMPLETE plans; only the plan directory and saved plan may change during planning (already satisfied).

Exclusions: review findings F-001..F-069 (T010 of consolidated-remaining-work), CI/audit (deferred T013→T005), Chromium sandbox redesign (deferred T006), comprehensive-README plan (deferred T007), eval harness (deferred T008), publication/key rotation (deferred T009), packBootstrap concurrency refactor, ownership registry, protected-hash registry (rejected — see Assumptions And Decisions).

## Acceptance Criteria
1. Payload drift is gated: `node scripts/check-suite.mjs` fails when any file under `bootstrap/package/payload/skills/**` differs from its mapped source (the T002 pinned forward comparison, dynamic count), and a planted stale payload file in a complete temp corpus makes the gate exit 1 with the specific `DIFF <rel>` message; the real payload passes with zero issues.
2. Gate baselines are machine-recorded: `scripts/record-gate-baseline.mjs --record` writes `.agents/docs/gate-baselines.json` (pass counts + wall time per gate); `--check` exits non-zero on unexplained deviation and warns when the file is older than 30 days; pre-commit runs `--check`; journal digests/numbers are henceforth copied from this artifact, never retyped.
3. Node 22 toolchain is one command: `scripts/with-node22.mjs` resolves the Node 22 (or newer, <25) binary on this host (nvm path fallback), fails fast with a clear error on Node <22, and the plan's once-recurring PATH-prepend prose is replaced by a single documented invocation; every test script uses the glob form that works on Node 22 (audit of `node --test` directory-form invocations).
4. Deferred work has a single ledger: `.agents/docs/deferred.md` records the 5 carried items (CI/audit, sandbox, README plan, eval harness, publication) with IDs, rationale, owning plan, and user-decision dates; check-suite requires every `DEFERRED` task in a **non-COMPLETE** plan to cite `[DEF:<slug>]` (existing COMPLETE/closed plans are grandfathered — the rule flags them as warnings, never as failures, so no COMPLETE plan is ever edited by this rule); `.agents/README.md` indexes the ledger.
5. Plan acceptance signals are linted: `scripts/check-plan-signals.mjs` (wired into check-suite's plan corpus block) parses every plan's acceptance-signal code blocks and fails on: bash syntax errors (`bash -n`), placeholder tokens (`<...>`), `; test $? -eq` under `set -e`, and `grep -q "$m"` over dash-leading tokens; a planted bad-signal plan must fail the gate.
6. Plan closure is automated: `scripts/close-plan.mjs <plan> <replacement>` rewrites Control (Status complete, state NOT_STARTED, Next transition none), inserts the Closure block, rewrites task lines to `[blocked]`, appends a journal row, updates `.agents/README.md`, and re-runs check-suite; a dry-run on a temp plan produces all elements with a passing gate.
7. Journal lessons are consolidated: `.agents/docs/journal-lessons.md` (indexed in `.agents/README.md`) documents the 43 mined themes grouped by class (finding/learning/mistake/adaptation/lesson/workaround) with evidence citations and the embracing mechanism for each, so future plans stop re-learning them.

## Current-State Evidence
- Payload drift is unguarded: `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md:37` — "`scripts/check-suite.mjs` does NOT check payload drift."; refresh needed 3× (commits 9d09292 → 1d739b4 → 71e96f1, 4 stale files); pinned forward comparison exists as a T002 verbatim one-liner (`{compared:116, issues:[]}` observed at cycle 2, plan prose said 113 — a transcription discrepancy, see journal-typo theme).
- Serial pack constraint: consolidated plan Discovered Requirements — "packBootstrap() mutates and prunes the shared bootstrap/package/payload/** tree in place" — five bootstrap suites must run serially; refactor to atomic swap is out of scope (see Assumptions).
- Node 22 workaround recurs in nearly every plan: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` (2026-08-16-skills-remediation-csm.md:374 — "`nvm use 22` fails due to ~/.npmrc prefix conflict"); default PATH node is v20.20.2 (past EOL); directory-form `node --test tests/unit/` breaks on Node 22 (commit 5e9bbf8 fixed csm-browse to glob form).
- Deferred items renumbered across 4+ plans: T013→T005 (CI), T006 (sandbox), T007 (README), T008 (eval), T009 (publication) — evidence in 2026-08-16-skills-remediation Control, 2026-08-18-remaining-suite-work AC5, 2026-08-19-consolidated T005-T009.
- Acceptance-signal hygiene failures: 2026-08-15-csm-review-skill-csm.md Critique Resolution R-c1 ("`grep -q "$m"` option-injection on `--depth 1` — gate unpassable"), R-c2 ("literal `<re-run T001 gate>` placeholders — bash syntax error"); suite-improvements Discovered Requirements ("under set -e ... never `cmd ...; test $? -eq N`").
- Closure and journal bookkeeping are hand-edited: 3 transcription incidents (6d7d2ed dedup, f03fecd tally fix, consolidated cycle-2 sha256 typo corrected in place); closure convention (D9) rewritten by hand every time; protected-plan hashes hand-pasted per plan.
- This draft plan carries the required `format: csm-plan/1` frontmatter (C1) and the check-suite 445-count baseline was observed at the review commit 31d3512 (C8); the consolidated plan was reopened from COMPLETE to ready by user-directed T010 amendment (documented exception per the D8 "user explicitly directed" precedent), which is why its Verification Strategy prose is NOT edited by this plan (T003/C4).
- check-suite.mjs (676 lines) has zero direct test coverage (scripts/hooks/test/pre-commit.test.mjs:27 stubs it) — review finding F-003, owned by T010; this plan's new rules therefore rely on planted-defect temp-dir negative tests.
- check-suite corpus blocks gate only plans/reviews/approaches (check-suite.mjs:512-588); `.agents/docs/**` is unvalidated (zero 'docs' references in check-suite.mjs).
- FORMAT_VERSIONS live in scripts/lib/contracts.mjs:144-149; check-suite imports checkDrift and fails on boilerplate drift (check-suite.mjs:646-652) — the established pattern this plan's new rules mirror.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Review findings F-001..F-069 are owned by T010 of `2026-08-19-consolidated-remaining-work-csm.md` (amended to "all 68 upheld findings") — this plan must not duplicate them | user-dictated | User amended T010 scope; this plan scopes to journal-only learnings | accepted |
| A2 | CI/audit stays deferred (T013→T005); this plan never dispatches it | user-dictated | Deferred by user 2026-08-16 and carried through 4 plans | accepted |
| A3 | packBootstrap stays mutating-in-place; serial pack rule retained; no atomic-swap refactor | decision | Refactor is risky and touches the same 5 suites; the journal lesson is to encode detection (T001), not redesign the packer | accepted |
| A4 | Ownership registry + protected-hash registry rejected as over-engineered for this ask | decision | One concurrency incident (already adapted via write-discipline); hashes are superseded by T001 drift gate + close-plan automation | rejected |
| A5 | Every new check-suite rule ships a planted-defect negative test (temp-dir pattern) | journal lesson | 2026-08-15-write-discipline + suite-improvements acceptance signals | accepted |
| A6 | check-suite.mjs is single-owner per wave (T001→T004→T005 serial chain) | journal lesson | 2026-08-16-suite-coherence D10; remediation-build cycle-4 convergence lesson | accepted |
| A7 | Node version policy: scripts must run on Node ≥22 (engines) — the with-node22 helper enforces, it does not pin a single line | decision | .node-version=22; csm-browse engines >=22 <25; host default is v20.20.2 | accepted |
| A8 | Gate-baseline deviations are warnings + recorded, not hard failures, until a second baseline exists | decision | First baseline is self-referential (no prior data); hard-fail would block commits spuriously | accepted |
| A9 | The journal-lessons doc is a synthesis reference, not a gate target | decision | .agents/docs is unvalidated; gating prose would overreach; indexed in .agents/README only | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Does the pinned payload comparison work as a check-suite rule? | Read consolidated T002 command + cycle-2 journal | Read-only; no runs | `{compared:116, issues:[]}` observed; plan prose said 113 (transcription drift) | T001 must use dynamic count, never a literal |
| R2 | Which test scripts still use directory-form `node --test`? | grep tests for `node --test tests/unit` / directory args | Read-only | csm-browse already glob-form (5e9bbf8); scan suite uses explicit file lists | T003 is an audit + helper, not a rewrite |
| R3 | Where does `.agents/README.md` need lines for new docs? | Read .agents/README.md (docs section :25-28) | Read-only | Docs indexed manually under a docs section | T004/T006/T007 append lines there |
| R4 | Does check-suite have a hook for per-rule self-tests? | grep check-suite.mjs for planted/self-test | Read-only | No self-test mode exists | Planted-defect tests use temp-dir + `--root` flag (existing pattern) |

## Discovered Requirements
- Any task editing `scripts/check-suite.mjs` must serialize behind the previous check-suite owner (A6): T001 → T004 → T005.
- `scripts/pack-bootstrap.mjs` must never run concurrently with any other pack-invoking process (serial rule, A3) — csm-build must not parallelize tasks that invoke it.
- All acceptance-signal code blocks in this plan and future plans must be `bash -n`-clean; no `<placeholder>` tokens; `set -e` sequences use `cmd ... || test $? -eq N`.
- Node 22 host quirk: `nvm use` fails (~/.npmrc prefix conflict) — the helper must PATH-prepend `$HOME/.nvm/versions/node/v22.23.2/bin`, never call nvm.
- New check-suite rules must not break the count invariant (445 baseline at drafting; count, not literal, is the gate) — record baseline at build start.
- `.agents/docs/**` files are not gate-validated; new docs need only a `.agents/README.md` index line.
- Every new check-suite rule ships a planted-defect negative test (A5).

## Design
Five scripts + two docs + one data file, arranged so the single-writer constraint on `scripts/check-suite.mjs` is the only serialization:

- **T001 payload-drift rule (check-suite)**: a `checkPayloadDrift(root)` mirroring the existing `checkDrift` pattern (check-suite.mjs:646-652): forward-hash every file under `bootstrap/package/payload/skills/**`, compare against the mapped source path (`payload/skills/<rel>` → repo-root `<rel>`); fail on DIFF or MISSING-SOURCE; report `{compared:N, issues:[]}` dynamically. Planted-defect test: temp copy of a payload file, mutate, expect exit 1.
- **T002 gate-baseline recorder**: standalone `scripts/record-gate-baseline.mjs` — `--record` captures gate name, pass count, wall time, node version, timestamp into `.agents/docs/gate-baselines.json`; `--check` compares current run against the last record (deviation → non-zero + message) and warns on >30-day age; pre-commit gains one line invoking `--check` (skip if no baseline exists). Journal rule: digests/numbers come from this artifact.
- **T003 Node 22 helper**: `scripts/with-node22.mjs` — resolves node from `$HOME/.nvm/versions/node/v22.23.2/bin` (existence-checked), else current node if ≥22 and <25, else exits 1 with a clear message; prints the resolved path (`--print`) or re-execs `argv` with PATH prepended (`--exec`). Audit + fix any remaining directory-form `node --test <dir>` in scripts/package.json; update the recurring PATH-prepend prose to a single documented invocation.
- **T004 deferred ledger**: `.agents/docs/deferred.md` with the 5 carried records (ID, item, rationale, owning plan, user-decision date); check-suite rule (new corpus sub-check in the plans block) rejects any `[blocked] DEFERRED` task whose text lacks a ledger ID reference `[DEF:<slug>]`; `.agents/README.md` indexes it. Follows T001 (same file).
- **T005 plan-signal lint**: `scripts/check-plan-signals.mjs` — extracts fenced bash blocks from `.agents/plans/*.md` acceptance signals (fence-aware, reuse the fenceMap approach), runs `bash -n` on each, rejects `<...>` placeholder tokens, `; test $? -eq`, and `grep -q "$m"` over dash-leading tokens; wired as a plan-corpus sub-check in check-suite. Follows T004 (same file).
- **T006 close-plan automation**: `scripts/close-plan.mjs <plan> <replacement>` — performs the D9 closure convention verbatim (Control rewrite, Closure block, `[blocked]` rewrites, journal row, `.agents/README.md` line, check-suite re-run), with `--dry-run` for review.
- **T007 lessons doc**: `.agents/docs/journal-lessons.md` — the 43 mined themes grouped by class with evidence citations and the embracing mechanism (this plan's tasks); `.agents/README.md` index line.

Dependencies: T004 ← T001; T005 ← T004. All else parallel. Critical path: T001 → T004 → T005.

## Execution Graph
- Wave 1 (parallel, disjoint files): T001 (`scripts/check-suite.mjs` + `scripts/lib/contracts.mjs`) || T002 (`scripts/record-gate-baseline.mjs` + `scripts/hooks/pre-commit` + `.agents/docs/gate-baselines.json`) || T003 (`scripts/with-node22.mjs` + test-script audits) || T006 (`scripts/close-plan.mjs`) || T007 (`.agents/docs/journal-lessons.md` + `.agents/README.md` docs lines).
- Wave 2: T004 (`.agents/docs/deferred.md` + check-suite rule) — depends on T001 (single-writer).
- Wave 3: T005 (`scripts/check-plan-signals.mjs` + check-suite plan-block wiring) — depends on T004 (single-writer).
- Critical path: T001 → T004 → T005.
- No task invokes `scripts/pack-bootstrap.mjs` (serial pack rule preserved); no task touches review-owned files (T010 scope).

## Numbered Plan
1. [pending] Payload-drift gate in check-suite.mjs
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1 (Wave 1)
   - Risk: standard (new gate rule; must not false-positive on the live payload)
   - Owned scope: `scripts/check-suite.mjs` (add `checkPayloadDrift` + call in the main gate), `scripts/lib/contracts.mjs` (if constants needed).
   - Not in scope: `bootstrap/**` content, pack-bootstrap.mjs, payload-index.json, review-owned fixes (T010), other check-suite rules (T004/T005 own theirs, later waves).
   - Spike candidate: none — the T002 pinned comparison command is the proven spec; adapt to dynamic count (R1).
   - Actions: (1) implement `checkPayloadDrift(root)` mirroring `checkDrift`: walk `bootstrap/package/payload/skills/**` (files only), map each to its repo-root source (`payload/skills/<rel>` → `<rel>`), sha256 both, collect DIFF/MISSING-SOURCE; print `{compared:N, issues:[]}`-shaped summary; fail on any issue; (2) call it from the main gate with the other drift checks (alongside checkDrift at :646-652); (3) planted-defect negative test: build a complete minimal temp corpus (copy the repo excluding .git/node_modules), mutate exactly one byte of one payload file, run `node scripts/check-suite.mjs --root "$TMP"`, assert exit 1 AND that the output contains the rule's specific `DIFF <rel>` line for the mutated file (C5/C11 — exit-1 alone is vacuous on an incomplete corpus); (4) run the gate on the real repo — must pass with `issues:[]` and the count recorded (dynamic).
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 with `issues:[]` on the live payload AND the planted-defect temp-root run exits 1 (both recorded with output).
   - Validation: cheapest first — `node --check scripts/check-suite.mjs`; planted-defect temp run; real-repo gate run; confirm count is dynamic (no literal in output).
   - Acceptance evidence: gate output (real + planted), the temp-root command transcript, dynamic-count proof (grep no literal count in the new code).
   - Repair attempts: 0
   - Recovery note: the rule is additive; if it false-positives on the live payload, fix the mapping (never the payload) per the "checker must pass on final suite — never patch checker to appease" lesson; the planted test re-proves the rule.

2. [pending] Gate-baseline recorder (evidence artifact for journal numbers)
   - Task ID: T002
   - Depends on: none
   - Parallel group: G2 (Wave 1)
   - Risk: standard
   - Owned scope: `scripts/record-gate-baseline.mjs` (new), `scripts/hooks/pre-commit` (one invocation line), `.agents/docs/gate-baselines.json` (first record).
   - Not in scope: csm-scan/csm-browse suites themselves, check-suite.mjs, baseline hard-fail policy (A8).
   - Spike candidate: none.
   - Actions: (1) implement `record-gate-baseline.mjs` with `--record <gate-name> <pass-count> <wall-ms>` appending `{gate, passCount, wallMs, nodeVersion, ts}` to `.agents/docs/gate-baselines.json` (create dir/file if absent); `--check <gate-name> <pass-count> <wall-ms>` compares against the latest record for that gate, exits non-zero with a deviation message when pass count changes beyond an optional `--tolerance`, warns (not fails) on >30-day age; (2) pre-commit: after check-suite, invoke `node scripts/record-gate-baseline.mjs --check` guarded by `fs.existsSync` on BOTH the script and the baseline file (silent skip if either is missing — C6; the script itself runs check-suite, parses the "N checks" count from its stdout, and compares against the latest recorded count, so the hook passes no count argument); (3) record the first baseline from a real gate run; (4) extend `scripts/hooks/test/pre-commit.test.mjs` with a stubbed script+baseline case asserting the guarded line behaves (no ENOENT, status 0).
   - Acceptance signal: `node scripts/record-gate-baseline.mjs --record check-suite 445 1234` then `--check check-suite 445 1200` exits 0, and `--check check-suite 500 1200` exits non-zero with a deviation message; and the standalone `--check` (no args) runs check-suite itself and extracts the count (recorded outputs).
   - Validation: cheapest first — `node --check`; the two acceptance invocations; pre-commit smoke on a temp repo (existing pre-commit.test.mjs pattern — extend it to assert the new line runs with a stubbed baseline).
   - Acceptance evidence: baseline JSON content, acceptance invocation transcripts, pre-commit temp-repo test output.
   - Repair attempts: 0
   - Recovery note: standalone script + one hook line; revertible independently; the JSON is disposable (regenerate with --record).
   - (A8) Deviations warn at pre-commit via exit code, but the script's own exit is the signal — the hook logs and continues for the first cycle only if a baseline exists; policy hardens in a later plan.
   - (Superseded pointer: plan 2026-08-20-oxlint-lefthook-precommit-csm.md T002/T003) The `record-gate-baseline.mjs` invocation is retargeted to a `.lefthook.yml` pre-commit job — a check-suite-preceding job running `node scripts/record-gate-baseline.mjs` when the file exists; `scripts/hooks/pre-commit` is now a generated lefthook shim, so it must not be hand-edited. Baseline-recording intent unchanged.

3. [pending] Node 22 toolchain helper (ends the PATH-prepend workaround)
   - Task ID: T003
   - Depends on: none
   - Parallel group: G3 (Wave 1)
   - Risk: standard
   - Owned scope: `scripts/with-node22.mjs` (new), any remaining directory-form `node --test <dir>` invocations in `csm-browse/package.json` / `csm-scan` scripts / `tests/**` package scripts (audit + glob-form fix), the recurring PATH-prepend prose in plan templates and docs (replace with the helper invocation).
   - Not in scope: bootstrap package engines floor (review F-060, T010), host Node upgrade, ~/.npmrc, CI.
   - Spike candidate: none — the PATH-prepend recipe is proven across 5+ plans (R2).
   - Actions: (1) implement `with-node22.mjs`: `--print` resolves and prints the node binary (prefer `$HOME/.nvm/versions/node/v22.23.2/bin/node` if present; else current node if `>=22 && <25`; else exit 1 with the fix instruction); `--exec <cmd...>` re-runs the command with the resolved bin dir prepended to PATH; (2) audit all test invocation sites for directory-form `node --test <dir>` and convert to glob/explicit-file forms (Node 22 quirk per 5e9bbf8); (3) replace the PATH-prepend prose in THIS plan's Verification Strategy with the helper invocation (the reopened consolidated plan's prose is T010-domain — do not edit it here, C4); (4) leave the journal-lessons doc to T007.
   - Acceptance signal: `node scripts/with-node22.mjs --print` exits 0 and prints a node ≥22 <25 path (recorded), and `node scripts/with-node22.mjs --exec node --version` prints the same version; `rg -n 'node --test [a-z/]+/'` over scripts/package.json and test scripts returns no matches.
   - Validation: cheapest first — `node --check`; --print/--exec on this host; the rg audit; csm-browse `npm test` (glob form) still green under the helper.
   - Acceptance evidence: --print/--exec output, rg audit result, csm-browse test output.
   - Repair attempts: 0
   - Recovery note: helper is additive; if the nvm path is absent on another host, --print falls back to current node with the version guard — no hardcoded host assumption beyond the documented fallback.
   - (A7) The helper enforces ≥22 <25, it does not pin a single line.

4. [pending] Deferred-work ledger + DEFERRED-citation rule
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G4 (Wave 2)
   - Risk: standard (new corpus rule; existing plans must already conform)
   - Owned scope: `.agents/docs/deferred.md` (new), `scripts/check-suite.mjs` (DEFERRED-citation sub-check in the plans corpus block), `.agents/README.md` (index line for the ledger — this task's line only).
   - Not in scope: the deferred items themselves (never dispatch), other check-suite rules (T001 owns the file this wave; T005 next wave), review-owned fixes.
   - Spike candidate: none.
   - Actions: (1) write `.agents/docs/deferred.md` with the 5 carried records: `DEF-CI` (CI + scheduled dependency audits; owning plans 2026-08-16-skills-remediation T013, consolidated T005; user decision 2026-08-16), `DEF-SANDBOX` (Chromium sandbox redesign; consolidated T006), `DEF-README` (2026-08-03 comprehensive README plan; consolidated T007), `DEF-EVAL` (live-LLM eval harness; consolidated T008, F-017 tier-b), `DEF-RELEASE` (publication/hosting/key rotation; consolidated T009) — each with rationale and status open; (2) add a plans-corpus sub-check: any `[blocked] DEFERRED` task line in a **non-COMPLETE** plan must cite `[DEF:<slug>]` matching a ledger ID, else the gate fails; DEFERRED tasks in COMPLETE plans emit a warning line (no failure); (3) `.agents/README.md`: add the deferred.md line to the docs section — **sole owner of that line** (C7: T007 does not write it); (4) planted-defect test: a complete minimal temp corpus (repo copy excluding .git/node_modules) with one added temp non-COMPLETE plan whose DEFERRED task lacks the citation must fail with the rule's specific message.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 on the real corpus (non-COMPLETE plans comply; COMPLETE plans warn only) AND the planted temp-corpus run exits 1 with the rule's specific DEFERRED-citation message.
   - Validation: cheapest first — `node --check`; planted temp run; real-corpus run; `rg '\[DEF:' .agents/plans/*.md` shows the ledger + this plan's references (existing COMPLETE plans may show none — expected).
   - Acceptance evidence: gate output (real + planted), deferred.md content, README line diff.
   - Repair attempts: 0
   - Recovery note: rule is additive and never fails COMPLETE plans; if a non-COMPLETE plan's DEFERRED text doesn't match, fix that plan's citation (not the rule); ledger doc is disposable prose.
   - (A6) Single-writer: this task is the only check-suite.mjs editor in Wave 2.

5. [pending] Plan acceptance-signal lint (check-plan-signals.mjs)
   - Task ID: T005
   - Depends on: T004
   - Parallel group: G5 (Wave 3)
   - Risk: high (parses every plan's fenced bash; must not false-positive on the repo's own plans)
   - Owned scope: `scripts/check-plan-signals.mjs` (new), `scripts/check-suite.mjs` (plan-corpus sub-check wiring — Wave 3 owner), `scripts/lib/contracts.mjs` (if constants needed).
   - Not in scope: csm-plan/csm-grill/csm-review SKILL.md text, review-owned fixes, gate test harness (F-003, T010).
   - Spike candidate: none — the failing patterns are documented (R-c1/R-c2, set -e lesson); validate against the existing 17 plans as the corpus (any existing plan that trips the lint must itself be corrected by this task, since the lint encodes the lesson).
   - Actions: (1) implement `check-plan-signals.mjs <dir>`: for each `*-csm.md` plan with Control `Status: ready` or `in_progress` (non-COMPLETE plans — COMPLETE plans are exempt, they encode history not future work), extract bash acceptance signals from BOTH fenced blocks and inline backtick spans under `Acceptance signal:` lines (fence-aware extraction; reuse the splitLines/fenceMap approach — do not import check-suite internals, keep standalone); for each signal: run `bash -n` on a temp file, reject `<...>` placeholder tokens (C3: this plan's own signals must comply — T006's signal was reworded), reject `; test $? -eq` immediately after a command in `set -e` blocks, reject `grep -q "$m"` where `$m` is a dash-leading option token; report per-plan PASS/FAIL with line numbers; (2) wire as a sub-check in check-suite's plans corpus block; (3) run against the non-COMPLETE corpus (at dispatch: this draft + the reopened consolidated plan — enumerate dynamically; the corpus is 16 pre-existing plans + this draft = 17 files, of which only non-COMPLETE are linted, C10); fix any genuine violations in those plans' acceptance signals (content edits to plan files, never task status lines); (4) planted-defect test: complete minimal temp corpus with one added temp plan whose signal contains each failure class must fail with the specific lint messages (exit-1-alone is vacuous on incomplete corpora, C5).
   - Acceptance signal: `node scripts/check-plan-signals.mjs .agents/plans` reports all non-COMPLETE plans PASS (COMPLETE plans exempt) AND the planted temp plan fails with the specific lint messages (both recorded).
   - Validation: cheapest first — `node --check`; the non-COMPLETE-corpus run; planted run; check-suite full run (count invariant preserved: 445 + new rule's count delta recorded).
   - Acceptance evidence: lint output for all 17 plans, planted-plan output, check-suite output, any corrected plan diffs.
   - Repair attempts: 0
   - Recovery note: lint is additive; a false positive on a legitimate signal fixes the lint rule (never the plan content to appease it — journal lesson); each corrected plan is revertible.
   - (A6) Single-writer: this task is the only check-suite.mjs editor in Wave 3. If T010's check-suite test harness (F-003) has landed by dispatch, add direct unit tests here instead of temp-dir plants (coordinate at RECOVER).

6. [pending] Plan closure automation (close-plan.mjs)
   - Task ID: T006
   - Depends on: none
   - Parallel group: G6 (Wave 1)
   - Risk: standard (writes to plan files + README; dry-run first)
   - Owned scope: `scripts/close-plan.mjs` (new); exercised only in temp dirs during this build (real closures are T010-domain).
   - Not in scope: any real plan closure (the consolidated plan's own closure is future work), check-suite.mjs, review-owned fixes.
   - Spike candidate: none — the D9 closure convention is fully specified in consolidated plan Assumptions And Decisions.
   - Actions: (1) implement `close-plan.mjs <plan> <replacement>`: parse Control (Status→complete, Current CSM state→NOT_STARTED, Next transition→`none; closed as superseded...`, Active tasks→none), insert `## Closure` after Control (Closure status, Replacement plan, Task disposition per D9), rewrite task lines `[pending]`→`[blocked]` with the superseded note, append one Progress Journal row (timestamp, cycle, closure trigger), update `.agents/README.md` artifact line (status complete + closure note), then run `node scripts/check-suite.mjs`; `--dry-run` prints the full diff without writing; (2) planted test: copy a temp plan + temp README into a temp corpus root, run with `--dry-run`, assert all six elements appear; run for real only in the temp corpus, never on the live corpus in this build.
   - Acceptance signal: `node scripts/close-plan.mjs --dry-run TMPCLOSE_PLAN TMPCLOSE_REPLACEMENT` (paths defined in this task: a copied temp plan and its replacement plan under a sandbox dir) produces a diff containing all six elements (recorded) AND check-suite passes on the temp corpus root after a real run inside the sandbox.
   - Validation: cheapest first — `node --check`; dry-run diff; temp-corpus real run; check-suite on temp corpus.
   - Acceptance evidence: dry-run diff, temp-corpus check-suite output, planted assertions.
   - Repair attempts: 0
   - Recovery note: script is additive; dry-run guarantees no live-corpus write; if the temp-corpus gate fails, fix the script (never the temp fixtures to appease).
   - (A3/A4) Closure automation replaces the hand-edit path that produced transcription errors; protected-hash registry remains rejected.

7. [pending] Journal-lessons reference doc
   - Task ID: T007
   - Depends on: none
   - Parallel group: G7 (Wave 1)
   - Risk: low
   - Owned scope: `.agents/docs/journal-lessons.md` (new), `.agents/README.md` (docs section index lines for journal-lessons.md + gate-baselines.json ONLY — the deferred.md line is owned by T004, C7; T006 README writes are temp-corpus-only).
   - Not in scope: check-suite/docs gating (A9), review-owned fixes, any plan content.
   - Spike candidate: none.
   - Actions: (1) synthesize `.agents/docs/journal-lessons.md` from this plan's research: the 43 mined themes grouped by class (finding/learning/mistake/adaptation/lesson/workaround), each with evidence citation (file/commit), frequency, and the embracing mechanism (this plan's task ID, or "already embraced by <plan/skill>" for the ones already encoded — e.g. subagent-ladder in csm-review/csm-build skills, planted-defect discipline, single-owner waves); explicitly mark themes rejected (A4) with rationale; (2) update `.agents/README.md` docs section with the two new artifact lines (journal-lessons.md, gate-baselines.json) — sole README writer for those lines; the deferred.md line is T004's.
   - Acceptance signal: `.agents/docs/journal-lessons.md` exists, is indexed in `.agents/README.md`, and `node scripts/check-suite.mjs` still exits 0 (README edits stay within the documented format — check-suite validates README structure).
   - Validation: cheapest first — check-suite run; README section read-back; doc section count vs research themes (43) spot-check.
   - Acceptance evidence: the doc itself, README diff, check-suite output.
   - Repair attempts: 0
   - Recovery note: doc-only; revertible; README edits bounded to the docs section.
   - (A9) The doc is a reference, not a gate target.

## Verification Strategy
- Fast per-task gates: `node --check` on every touched .mjs; task acceptance signals as listed (cheapest first).
- Order: per-task acceptance → `node scripts/check-suite.mjs` after every check-suite-mutating task (T001, T004, T005) with the count invariant recorded (445 baseline at drafting + explained deltas); csm-browse `npm test` under the with-node22 helper for T003; no pack-invoking runs in this plan (A3).
- Parallel-safe: Wave 1 tasks touch disjoint files (check-suite vs pre-commit vs with-node22 vs close-plan vs docs/README-sole-writer).
- Final gate (after T007): `node scripts/check-suite.mjs` (445 + deltas), `node scripts/check-plan-signals.mjs .agents/plans` all PASS, planted-defect triple (payload, deferred-citation, signal) all exit 1, `node scripts/with-node22.mjs --print` OK.
- Environment sensitivity: Node ≥22 required for all gates (T003 helper enforces); no Docker, no network, no pack runs.

## Risks And Recovery
- Risk: T005 lint false-positives on legitimate existing signals → mitigation: run against all 17 plans first, fix genuine violations, never weaken the lint to appease (journal lesson); recovery: revert the specific plan-content edit.
- Risk: T001 mapping drift (payload file without a source, or source renamed) → mitigation: MISSING-SOURCE is reported, not silent; recovery: fix the map, never the payload.
- Risk: T002 baseline self-referential first record → mitigation: A8 (warn, not fail); recovery: delete the JSON and re-record.
- Risk: T004 citation rule trips existing plans → mitigation: 5 known DEFERRED records all cited in the ledger; recovery: fix the plan citation.
- Risk: T006 writes to the wrong corpus → mitigation: dry-run default; sandbox-only real run; recovery: git checkout of the temp corpus.
- Rollback: every task is independently revertible (new scripts, additive rules, one-line hook/doc edits); check-suite rules are removable lines.
- Forward recovery: T005 gains direct tests once T010's F-003 harness lands (coordinate at RECOVER).

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| C1 draft plan missing `format: csm-plan/1` marker — gate red | critical | Added frontmatter to this plan; Current-State Evidence now discloses marker validity and the 445 baseline provenance (31d3512) | check-suite exits 0 on this plan after fix |
| C2 AC4 forces edits to COMPLETE plans (zero `[DEF:` citations exist) | critical | Citation rule scoped to non-COMPLETE plans; COMPLETE plans warn only; AC4/T004 actions+acceptance+recovery reworded | rg shows citations only in ledger + new plans |
| C3 T005 lint extraction scope vacuous/false (inline signals; COMPLETE plans trip patterns) | high | Lint covers inline backtick AND fenced signals; scope = non-COMPLETE plans only; corpus = 16 pre-existing + draft, enumerated dynamically; draft's own placeholder signals reworded (T006) | suite-improvements:225 pattern exempt (COMPLETE) |
| C4 T003 edits COMPLETE consolidated plan prose | high | T003 replaces prose in this draft only; consolidated prose is T010-domain | no diff on consolidated plan from this plan |
| C5 planted-defect tests vacuous on incomplete temp corpora | medium | All three planted tests now require a complete minimal temp corpus (repo copy minus .git/node_modules) and assert the rule's specific message, not exit-1 alone | T001/T004/T005 actions updated |
| C6 T002 pre-commit count source unspecified; unguarded line breaks pre-commit.test.mjs | medium | Script runs check-suite itself and parses the count; hook line guarded by fs.existsSync on script AND baseline; pre-commit.test.mjs extended | T002 actions/acceptance updated |
| C7 deferred.md README line double-owned (T004/T007) | medium | T004 is sole owner of the deferred.md line; T007 owns journal-lessons.md + gate-baselines.json lines only | T004/T007 owned scope updated |
| C8 consolidated reopen + baseline provenance undisclosed | medium | Disclosed in Current-State Evidence; user-directed T010 amendment documented as D8-precedent exception | Current-State Evidence bullet |
| C9 deliverables count wrong (3 vs 5 scripts) | low | Corrected to "4 new standalone scripts + rules inside check-suite.mjs" | Goal section |
| C10 off-by-one corpus count + draft's own signals | low | Corpus = 16 pre-existing + draft, non-COMPLETE linted; draft's own signals comply (T006 reworded) | T005 actions |
| C11 vacuous PLANTED-NOT-CAUGHT assertion | low | AC1/T001 now assert the specific `DIFF <rel>` line | AC1 reworded |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20T00:33Z | 0 | INTAKE -> DISCOVER -> RESEARCH | — | 5 research tracks returned: 43 themes mined (journals A 15, journals B 17, docs/approach 13, git 10, map 8, deduped); review-owned findings scoped to T010 | DRAFT |
| 2026-08-20T00:45Z | 0 | DRAFT -> CRITIQUE | — | Draft written (7 tasks); independent critic returned 11 findings (2 critical: missing format marker on the draft itself — live proof of the F-050 lesson; AC4 false against real corpus) + verdicts on 8 questions | REMEDIATE |
| 2026-08-20T01:05Z | 0 | REMEDIATE -> VERIFY | — | All 11 findings remediated in the draft (frontmatter added; DEFERRED rule scoped to non-COMPLETE plans; lint scope inline+fenced non-COMPLETE; planted tests corpus-complete with specific-message assertions; T002 count source + guards; README single-owner; deliverables count fixed); resolutions recorded in Critique Resolution | VERIFY |
| (filled by csm-build) | | | | | |

## Completion Review
(filled by csm-build when all criteria are verified)
