# csm-suite Review — 2026-08-15

- Date: 2026-08-15
- Scope: full build of plan `csm-suite-improvements` (commits e0c5e44 G1, 9da316a G2, plus uncommitted repairs at review time)
- Method: three independent fresh-eyes hostile review passes (a) code correctness, (b) docs consistency, (c) suite integrity, dispatched in parallel by the primary; findings numbered R-aN / R-bN / R-cN per pass; primary triaged, dispatched three parallel repair agents (non-overlapping ownership), updated two test files for the deliberate CLI-arg exemption policy, and re-verified.
- Verdict convention: PASS / PARTIAL / FAIL per pass.

## Per-pass verdicts

| Pass | Focus | Verdict |
|---|---|---|
| (a) Code correctness | csm-browse/upload/scan fixes + e2e + linter | PARTIAL → PASS (2 major, 8 minor/nit; all repaired) |
| (b) Docs consistency | NORMS/ladder/tmux/descriptions/README vs plan drift matrix | PARTIAL → PASS (7 findings; all repaired) |
| (c) Suite integrity | scope audit, gate re-runs, filesystem, git state | PASS (1 minor plan-doc hygiene, 1 info; plan text fixed) |

## Finding disposition (17 findings)

### Pass (a) — 10 findings
- R-a1 (major): scan.mjs CLI-arg errors redacted by sanitized stdio (`no such directory: [redacted]`) — violates the plan's "name the bad path" decision → repaired: raw stderr captured pre-sanitizer, `printCliError` routes user-typed CLI args unredacted; scan-internal output stays redacted. Two pre-existing tests (T224 expansion-activation, T227 privacy-gate) asserted the old policy → updated to assert the CLI-arg exemption, with the canary moved out of the echoed path.
- R-a2 (major): port lock released before bind — race remains → repaired: lock moved to `createSession` in ensure-browser.mjs, held across allocate + chromium launch + socat bind + CDP wait, released in finally.
- R-a3 (minor): daemon publishes ready before clearing cmd/ (wipe window) → repaired: `prepareQueueDirs` runs before the ready marker.
- R-a4 (minor): browse.mjs conflates import failure with session state; corrupt state breaks close → repaired: separate try/catches; close proceeds with state=null on corrupt state.
- R-a5 (minor): upload clone-vs-pull dead code under mkdtemp; misleading partial-state message → repaired: fresh-clone-only + guard; message states temp dir is removed and re-run retries.
- R-a6 (minor): e2e wall cap bypassed on early-exit paths → repaired: `enforceWallCap()` at both exit paths.
- R-a7 (minor): check-suite tmux-bullet check only asserts csm-review; link regex skips non-skill csm-* → repaired: all five bootstrap skills asserted; any unresolvable csm-* first-segment flagged (URLs with :// or github.com skipped).
- R-a8 (minor): scan --version resolves git hash from cwd not skill dir → repaired: SCRIPT_DIR.
- R-a9 (nit): recorder reconcile dead code in startRecorder → removed.
- R-a10 (nit): unused `spawn` import in upload.mjs → dismissed (pre-existing, out of scope).

### Pass (b) — 7 findings
- R-b1 (medium): csm-scan SKILL.md CLI doc overclaims exit-2 → repaired (exit-2 narrowed; --repos-no-value defaults to cwd; unwritable --out = exit 1).
- R-b2 (medium): README Quickstart overclaims tmux for grill → repaired ("the plan and build steps…").
- R-b3 (medium): README csm-review table row missing tmux clause → repaired (clause with csm-review-<goal-slug>).
- R-b4 (medium): csm-upload SKILL.md `[file2...]` trips T009 gate → repaired (`[<file2>] [more files]`).
- R-b5 (low): csm-review tmux block INTAKE backticks → repaired.
- R-b6 (low): README Troubleshooting bare relative path to ensure-browser.mjs → repaired ($HOME full path).
- R-b7 (low): README edge-semantics note omits csm-review as NORMS consumer → repaired (added with optionality note; solid scan→review edge kept per plan D5.1).

### Pass (c) — 2 findings
- R-c1 (minor): plan's T003 acceptance signal still has the broken `; test` form in text → repaired (plan text updated to `|| test`).
- R-c2 (info): csm-browse SKILL.md unrecognized-verb note beyond listed action → dismissed (in-scope by file, documents T001 behavior).

## Regression evidence

- Full csm-scan suite in sandbox (repaired files overlaid, env-i, redirected HOME/XDG): **1210/1210 pass, 0 fail**, 153.5s.
- Privacy gate: 6/6; CLI tests: 7/7; check-suite.mjs: 155 checks, exit 0, 0.13s; planted-defect tests exit 1.
- All plan gates re-run: BROWSE/UPLOAD/SCAN-CLI/PLAN-DOCS/BDD-DOCS/GRILL-DOCS/REVIEW-TMUX/DESCRIPTIONS/README/LINTER/BASELINE all pass; link-integrity loop clean.
- Scope audit: every file in e0c5e44 + 9da316a maps to a plan task; no out-of-scope edits; nothing pushed (origin/main at 4dafd82 + plan commit).
- Two test files updated (T224, T227) to assert the deliberate CLI-arg exemption policy — a policy change, not test-appeasement; rationale recorded in the tests.

## Verdict: PASS (after repair)
