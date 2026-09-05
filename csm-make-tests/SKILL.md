---
name: csm-make-tests
description: Generate a comprehensive executable test suite for any repository — audit existing tests and coverage, capture characterization goldens, generate intent/property/contract/performance tests, mutation-validate everything, and maintain approval ledgers as the suite evolves. Never plans, implements, or reviews production code.
---

# CSM Make Tests

## Progress Tracker

Progress tracking is ON by default for every invocation. Create and maintain a
versioned `csm-skill-progress/1` JSON record via `lib/progress-tracker.mjs`; it supplements this skill's lifecycle,
artifacts, permissions, receipts, and evidence and never replaces them.
Declare 3–6 milestones before work begins, each with a positive weight; weights
must total exactly 100%.

Render one overall horizontal bar and one horizontal milestone row as work advances:

```text
TASK PROGRESS  [████████████████░░░░░░░░░░░░] 53%
Milestones
[Audit ✓ 20%] [Design ✓ 15%] [Generate ▶ 45%] [Validate ○ 20%]
```

The milestone row has no per-milestone progress bars. Use `✓` complete, `▶` active, and `○` pending. Calculate `completed_weight + active_weight × verified_fraction` using named checkpoints actually completed by this skill. Retries retain one logical item and weight and never add credit. If scope cannot be estimated honestly, emit `TASK PROGRESS  not estimated` and keep it indeterminate. Unknown, skipped, cancelled, blocked, failed, and incomplete work is never silently complete. For a scope change, record old/new scope, reason, and revised weights before recalculating; discarded work gets no retroactive credit. `--quiet-progress` suppresses tracker bars and milestone text only; it never disables tracking, changes JSON state, hides blockers, or suppresses required lifecycle, safety, receipt, or evidence output. `--progress` is never required to activate tracking. At every state transition and at SAVED/COMPLETE/BLOCKED/PAUSED, render the bar and persist the record via `lib/progress-tracker.mjs` to `.agents/progress/<date>-<goal-slug>-<run-id>-progress.json`, indexed in `.agents/README.md`.

Turn a repository into a fully tested one: audit what exists, capture what the code actually does, generate the tests that are missing across every layer, prove they detect faults, and keep them maintained as the code evolves. Grounded in the committed research finding `.agents/research/2026-08-22-characterization-skill-implementation-research.md` (characterization techniques, generation ladder, mutation gates, differential oracles, performance continuity).

## Interface

- Consumes: a target repository checkout at a pinned commit with optional change-surface scope; optional NORMS.md conventions; cited research findings under `.agents/research/`
- Produces: executable test files, goldens/fixtures, benchmark files, and canonical JSON package artifacts validated by `csm-make-tests-ledger/1`, `csm-make-tests-verification/1`, and `csm-test-package/1`. Legacy Markdown ledger/report paths remain read-only history.
- Hands off: a verified JSON test-package descriptor to a later explicit csm-build run; Markdown projections are never machine inputs.
- Legacy history patterns remain recognized for read-only compatibility: `.agents/tests/<yyyy-mm-dd>-<repo-slug>-tests-ledger.md` and `.agents/tests/<yyyy-mm-dd>-<repo-slug>-verification.md`; they are never machine inputs.
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-deep-research, csm-review-python, csm-ddd, csm-autoresearch

## Durable Artifact Identity

Each generation or maintenance invocation uses one immutable validated `run-id`, supplied by the caller or generated once at INTAKE as `yyyymmddthhmmssz-<12 lowercase hex>`; accepted IDs match `^[a-z0-9][a-z0-9-]{7,63}$`. It is recorded in both durable artifacts and binds the target git root, normalized repository slug, artifact type, and run ID. Date, slug, or the existence of any prior ledger alone never proves ownership.

The run-owned paths are `.agents/tests/<date>-<repo-slug>-<run-id>-tests-ledger.jsonl`, `.agents/tests/<date>-<repo-slug>-<run-id>-verification.json`, and `.agents/tests/<date>-<repo-slug>-<run-id>-test-package.json`. MAINTAIN resumes only from those exact paths when their embedded root, slug, artifact type, run ID, and cursor match and the run is nonterminal. A terminal `OUTPUT` artifact is immutable; replacement, deletion, renaming, and a mutable `latest` alias are refused. A same-day duplicate slug starts only under a new run ID and cannot reuse the prior run's paths. Legacy date/slug Markdown artifacts remain read-only history and are not silently migrated.

## Tmux Session Bootstrap

Run first — before INTAKE, locating the plan, or any generation work. Not a generation state.

1. Derive a tmux-safe `<goal-slug>` from the invocation's goal and prompt: lowercase, hyphen-separated, concise, and stable for this run. The session name is `csm-make-tests-<goal-slug>`.
2. If already in tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds), rename the current session to `csm-make-tests-<goal-slug>` with `tmux rename-session -t "$(tmux display-message -p '#S')" "csm-make-tests-<goal-slug>"`, unless the user explicitly forbade renaming or chose another multiplexer. If renaming fails, note it and continue in the existing session.
3. If not in tmux, and the user did not forbid tmux or choose another multiplexer, launch this same agent invocation in a new detached session named `csm-make-tests-<goal-slug>` (use a suffix such as `-2` or `-3` if that name is already taken): `tmux new-session -d -s csm-make-tests-<goal-slug> 'opencode run "<original generation request>"'` (adapt to the agent CLI).
4. Print the active session name and attach command: `tmux attach-session -t csm-make-tests-<goal-slug>`. If a new detached session was launched, end the invocation — tmux does the generation from the start.
5. When tmux is unavailable, forbidden, or a different multiplexer was chosen, note that and continue into the generation workflow without renaming or starting tmux.

## Activation Boundary

- Activate when the user asks to generate, add, complete, or maintain tests for a repository, or invokes csm-make-tests by name.
- Target intake: a local repository checkout at a pinned commit; scope defaults to the whole tree and narrows to whatever change surface the user names. An exact owner-matching run artifact switches INTAKE into MAINTAIN mode instead of starting over.
- Generation-only: produces test files, goldens/fixtures, benchmarks, ledgers, and verification reports. Never plans work (csm-plan's job), never implements production features or fixes bugs found during capture (document and ledger them; fixing is the user's later call), never reviews a repo adversarially (csm-review's job), never mutates BDD specs (csm-bdd-tdd's job).
- Words such as "build" in the user's request describe generating tests for future code as well as existing code; they never authorize modifying production behavior.
- OUTPUT is the terminal state: after it, display the verification report and ledger summary, then stop. Handoff to csm-build is a separate, explicit human invocation.
- Never execute code from an untrusted repository outside its own toolchain; installs and generated runs obey the sandbox guards in Core Rules and the stack tables in `references/capture-patterns.md`.
- Clarifications: resolve ambiguity by recorded assumption unless the invocation sets an ask-first flag; only genuinely user-owned decisions block.
- Fresh sessions resume through artifacts, not chat history: the ledger, the audit table, and the verification report carry enough state to re-enter at MAINTAIN without replaying any transcript.

### Lifecycle and Resume Contract

`BLOCKED` is recoverable only through `BLOCKED -> RECOVER -> VALIDATE`; after
an unblock, re-pin the target and re-check the recorded scope before generating
anything. A clean review/checkpoint boundary is `REVIEW -> CHECKPOINT`; it
must not bypass the checkpoint.

MAINTAIN resumability requires a durable run cursor in the ledger or
verification report: pinned commit, scope, mode, current state, cycle, last
completed artifact, next transition, and the reason for any blocked or skipped
step. Temporary working notes may accelerate recovery but never define it. If
that cursor is absent or inconsistent, restart at `INTAKE` rather than
guessing the generation position.

### Verification Status And Evidence Retention

The verification report is a durable receipt, not a claim that disappears
with the temporary run directory. Emit a `csm-verification-status/1` record
for every report. Its top-level `status` is `VERIFIED`, `INCOMPLETE`, or
`BLOCKED`; unresolved checks, missing evidence, and cleanup failures force
`INCOMPLETE` or `BLOCKED`, never `VERIFIED`. Keep report-referenced evidence
as a retained file with its digest, embed a bounded deterministic summary, or
record it explicitly as `unavailable` with the reason. A deleted or missing
path is not available evidence.

Performance evidence follows the same rule: retain the profile/baseline,
embed its digest and summary, or mark it unavailable. Reports must not retain
a path into the disposable temp directory as if that path were durable.
Every external anchor uses a typed record with `url`, `version` or `edition`,
retrieval time, and `reachability` (`reachable`, `unreachable`, or
`not-checked`).

## Core Rules

- AUDIT before generating: inventory every existing test, coverage figure, and suite-health signal; generation targets the audited delta, never duplicates blindly.
- Capture discipline: characterization goldens document actual behavior — never fix bugs discovered during capture, never modify production code while capturing, name tests for discovered behavior, scrub volatile fields with library-native matchers/redactions before comparing.
- Approval discipline: every golden diff is presented to a human; update flags (`--snapshot-update`, `-u`, `cargo insta accept`, `-update`, received→verified renames) run only after explicit approval; CI must never write or update goldens.
- Verification discipline: generated suites must be green against unchanged code before anything else, and must pass a scoped mutation spot-check (see `references/mutation-gates.md`) — coverage without kill-evidence is not protection.
- Retention discipline: retained characterization tests are permanent legacy regression tests; do not delete or weaken them after refactors; re-approve through the ledger instead.
- Honesty discipline: never claim green for a suite that was not run; record pre-existing failures exactly; distinguish passing / pre-existing-failure / new-failure / not-run in every report.
- Determinism discipline: control time, randomness, environment, network, filesystem, and concurrency; prefer dependency injection over regex scrubbing; seed everything.
- Performance honesty: profile before load; on shared CI runners use wide trend-based gates, never bare small-percentage absolutes; record runner class with every benchmark baseline.
- Residual uncertainty guards: where a documented uncertainty affects an action, apply the guard from `references/known-uncertainties.md` (e.g. locate pitest reports by glob, never hardcode `mutations.xml`; check `pact-broker help` before scripting broker gates; check `randoop --help` for `--specifications` before using it).
- Ledger primacy: the JSONL ledger, JSON verification receipt, and JSON test-package descriptor under `.agents/tests/` are the durable record between runs — approvals, defect classifications, mutation scores, and baselines live there, never only in session context.
- Division of labor: subagents may draft tests, seed inputs, or parse tool output in parallel; the primary owns TRIAGE adjudication, APPROVE batching, and the VERIFY gate, and never delegates those decisions.
- Repository instructions win on conventions (test dirs, frameworks, naming); this skill wins on safety rules above.

## Write Discipline And File Allowlist

- Persistent writes inside the target repository: generated test files, golden/fixture files, benchmark files, configuration snippets the tests require (e.g. pytest plugin registration), plus exactly two run-owned artifacts:
- `.agents/tests/<date>-<repo-slug>-<run-id>-tests-ledger.jsonl` — append-only typed approval and maintenance ledger (shape pinned in Required Test Package).
- `.agents/tests/<date>-<repo-slug>-<run-id>-verification.json` — final typed verification receipt (shape pinned in Required Test Package).
- Everything else (scratch notes, captured outputs under review, dry-run copies, audit tables) lives in one disposable temp dir created with `mktemp -d /tmp/csm-make-tests-XXXXXX`, deleted at OUTPUT.
- Nothing else may be written anywhere in the target repository or on the host: no production source edits, no build/CI/doc changes beyond test-required configuration snippets, no commits unless the user explicitly authorizes committing generated tests.
- Never touch credentials, `.env` values, or secrets — scrubbed placeholders only in goldens.
- Delete the temp dir before OUTPUT; nothing from scratch may be promoted silently into the repo.

## Repository Norms (NORMS.md)

NORMS.md is optional. Detection order: user-explicit → `<git-root>/NORMS.md` → `<cwd>/NORMS.md`. Authenticity: it contains either "Generated by csm-scan" or "## Repository Overview". Load authentic norms at AUDIT and follow them for test placement, naming, and framework usage; treat stale (>30 days) norms as hints and re-verify each used claim against current repository configuration before relying on it. Contradictions resolve toward actual configuration, and norms become findings-inputs only in the sense of convention mismatches — they never override the safety rules above. Absent or inauthentic norms never block: derive conventions from repository configuration and continue.

## Test Generation State Machine

`INTAKE -> AUDIT -> SCAN -> CAPTURE -> TRIAGE -> APPROVE -> VERIFY -> AMPLIFY -> DIFFERENTIAL -> LAYER -> PERF -> OUTPUT -> STOP`

Cycle rules — CAPTURE is re-entered, never skipped:

- TRIAGE noise verdicts return to CAPTURE with improved scrubbing or injected dependencies; APPROVE batch rejections return to CAPTURE for regeneration.
- VERIFY survivor triage that classifies real gaps returns to CAPTURE for targeted inputs on the affected modules only.
- A cycle-back regenerates just the artifact that triggered the back-edge; already-approved goldens stay locked in the ledger.

Termination rules:

- LLM-assisted generation loops run under a fixed iteration cap declared at CAPTURE; exhausting the cap moves the gap to Not Run in the report instead of looping forever.
- AMPLIFY and DIFFERENTIAL terminate by documented skip when their preconditions do not hold; skipping is a recorded decision, never silence.

Record each transition in the temp-dir working notes (current state, trigger, evidence); a fresh session reconstructs position from those notes plus the ledger — never from transcript length.

### 1. INTAKE

Entry: activation request; or a fresh session resuming an interrupted run via prior artifacts.

1. Pin the target: resolve the repository root and commit SHA; note a dirty or diverged worktree (later citations and captures come from the worktree as found — never stash, clean, or repair).
2. Record scope: whole tree or the change-surface paths named by the user.
3. Resolve the run ID and exact run-owned ledger/report paths. Enter MAINTAIN only when those paths contain a matching nonterminal cursor; an unrelated or terminal artifact is a collision refusal, not a resume candidate. Legacy date/slug artifacts are read-only history.
4. Create the disposable temp dir with `mktemp -d /tmp/csm-make-tests-XXXXXX`.
5. Detect NORMS.md per the Repository Norms section.

Exit: pinned target, scope, mode (FRESH|MAINTAIN), temp dir, norms disposition recorded.

### 2. AUDIT

Entry: INTAKE exit.

1. Enumerate all existing tests (unit/integration/e2e/benchmarks) with framework and location.
2. Collect coverage figures (line + branch) per area via the project's own coverage tooling; record the command used so results are reproducible.
3. Assess suite health: runtime, flaky suspects (retry-classified results), skipped/xfail inventory, last-known-green commit if determinable.
4. MAINTAIN mode additionally: produce a drift report (`git diff` over golden paths since the last ledger entry) and a re-approval queue; generate only the audited delta.
5. Emit the audit table (area | tests | coverage | health | gap) into the temp dir; it is the authoritative input to SCAN.

Exit: audit table complete; delta targets named.

### 3. SCAN

Entry: AUDIT exit.

1. Detect stack(s) from project files (`go.mod`, `pyproject.toml`/`requirements.txt`, `package.json`, `Cargo.toml`, `pom.xml`/`build.gradle.kts`, `*.csproj`) and map each to the capture, mutation, and generation rows in `references/capture-patterns.md`, `references/mutation-gates.md`, and `references/intent-generation.md`.
2. Identify public seams: exported functions, CLI commands, HTTP handlers, message consumers; prefer coarse boundaries that produce comparable text.
3. Rank surfaces by change-risk: recent churn, user-named refactor areas, coverage gaps from AUDIT; low-risk untouched surfaces get no goldens (change-detector noise).
4. Note prerequisite gaps (CI unwired, no type checking, unseamed modules) and record them as phase-0 recommendations — fixing them stays out of scope.

Exit: ranked surface list with seams and stack mappings.

### 4. CAPTURE

Entry: SCAN exit; TRIAGE, APPROVE, or VERIFY back-edges.

1. Characterization goldens for ranked surfaces per `references/capture-patterns.md`: write failing-first capture tests over seeded realistic inputs (deterministic fixtures spanning main paths, edges, and error branches), run once, promote observed output, scrub volatiles with library-native matchers.
2. Intent drafts where annotations allow: signature/docstring properties in the Ghostwriter style; leave strategy TODOs explicit rather than guessing.
3. Deeper unit suites via deterministic generators where the stack supports them, containerized per the safety guards in `references/intent-generation.md`.
4. LLM-assisted generation for remaining audited gaps follows execution-in-the-loop (generate, run, parse coverage, repair, repeat — capped per Termination rules), flakiness-checked by repeated runs; every LLM-authored assertion passes the same mutation gate as any other.
5. Contract/integration candidates per available artifacts: OpenAPI schema → schema-conformance runs; recorded traffic → replay fixtures; real dependencies → container-backed integration tests.

Exit: candidate suites plus pending (unapproved) goldens, each traceable to an audited gap.

### 5. TRIAGE

Entry: CAPTURE exit.

1. Intended behavior → the golden proceeds toward APPROVE.
2. Defect (observed behavior is wrong) → annotate the golden, add a KNOWN-DEFECT ledger entry with explanation; production code is never fixed in this run.
3. Noise (volatile residue survived scrubbing) → improve scrubbing or inject the dependency and return to CAPTURE; noise is never approved.
4. Record every triage decision in the ledger so later failures distinguish spec-change from defect-fix.

Exit: every captured golden classified; nothing pending unclassified.

### 6. APPROVE

Entry: TRIAGE exit.

1. Present each pending diff (old vs observed) in review batches with scrubbing context; cap batch size so reviews stay honest.
2. Apply the stack's approve mechanism only after explicit per-batch confirmation (update flag, accept command, rename, or approved-file copy) — never bulk auto-approval, however trivial the diffs look.
3. Update the ledger per row: artifact path, approving user, commit/timestamp, triage classification.
4. Rejected batches return to CAPTURE with the reviewer's reason attached.

Exit: all goldens approved-and-ledgered or returned to CAPTURE.

### 7. VERIFY

Entry: APPROVE exit.

1. Run the full new suite against unchanged code; it must pass. Pre-existing unrelated failures are recorded verbatim — never "fixed" by skipping or weakening anything.
2. Scoped mutation spot-check on characterized modules only, per `references/mutation-gates.md` (apply the pitest glob guard from `references/known-uncertainties.md` where relevant); parse machine-readable survivor lists.
3. Triage survivors: equivalent/unproductive mutants documented as such; real gaps return to CAPTURE for targeted inputs.
4. Record per-module mutation scores in the ledger — this, not coverage percentage, is the protection metric.

Exit: green suite plus kill-evidence recorded, or named gaps cycling back to CAPTURE.

### 8. AMPLIFY

Entry: VERIFY exit; optional step.

1. Where mature amplification tooling exists for the stack (e.g. AmPyfier on the JVM, DSpot; maturity notes in `references/intent-generation.md`), run it over the generated suites to strengthen assertions.
2. Re-run affected suites and the scoped mutation check; amplification that does not move kill-count is reverted as noise.
3. Skip cleanly with a documented skip when no mature amplifier exists for the stack.

Exit: amplified suites kept only where they measurably detect more faults.

### 9. DIFFERENTIAL

Entry: AMPLIFY exit; active only during a refactor window.

1. When the user is refactoring and the old implementation stays callable, wire Scientist-style control/candidate checks (serve the control result, execute the candidate, compare, log mismatches) per `references/differential-oracle.md`; otherwise record a documented skip stating why.
2. Calibrate first — both blocks invoking the control — to measure comparison noise before trusting any mismatch.
3. Read-path only: never wrap data-mutating methods differentially.
4. Goldens remain the durable net before and after the window; the differential harness retires when the old path dies.

Exit: differential wired and calibrated, or a documented skip in the report.

### 10. LAYER

Entry: DIFFERENTIAL exit (documented skips included).

1. Property-based invariants (round-trip, idempotence, metamorphic relations, crash-freedom) where input spaces are structured; default to Hypothesis/fast-check — read jqwik's Anti-AI clause caveat in `references/known-uncertainties.md` before selecting it.
2. Contract checks where schemas exist: schema-driven conformance/fuzz runs wired into CI; consumer-driven contracts where real consumers exist.
3. Integration tests against containerized real dependencies where the repo already uses them.
4. Keep end-to-end/UI coverage deliberately thin; structure snapshots over pixels; document layer choices in the report.

Exit: layered suite proportionate to the audited risk.

### 11. PERF

Entry: LAYER exit; order fixed per `references/perf-playbook.md`.

1. Profile hot paths first (sampling profiler or instrumented run); load against an unprofiled service measures nothing — store profile artifacts in the temp dir and reference them in the report.
2. One smoke load script with thresholds-as-code for service surfaces (or a CLI timing harness for batch tools), wired to fail CI on breach.
3. Save one named baseline at average load with the runner class recorded beside it; add micro-benchmarks with compare-fail gates for the hottest pure functions; include allocation counters where the stack exposes them.
4. Recommend — do not execute by default — soak durations, multi-size complexity recipes, cold-start checks, profile diffs, and shared-runner trend windows.

Exit: performance continuity gates exist wherever service/CLI surfaces warrant them.

### 12. OUTPUT

Entry: PERF exit.

1. Write the verification receipt to the exact run-owned JSON path `.agents/tests/<date>-<repo-slug>-<run-id>-verification.json` and emit the JSON test-package descriptor.
2. Finalize the append-only ledger at `.agents/tests/<date>-<repo-slug>-<run-id>-tests-ledger.jsonl`; refuse finalization if either terminal JSON destination already exists.
3. Delete the temp dir; display the report summary and next-step guidance (re-approval workflow, differential wiring during refactors).

Exit: both artifacts written; scratch removed; summary displayed.

### 13. STOP

Entry: OUTPUT exit. No further transitions, no follow-up generation, no implicit handoff — invoking csm-build on the verified suite is a separate explicit human act.

Exit: terminal; nothing executes after STOP.

## Required Test Package

Every completed run emits exactly two persistent artifacts plus the generated tests. Their shapes are fixed; MAINTAIN mode parses them, so drift breaks resume.

1. **Tests ledger** `.agents/tests/<date>-<repo-slug>-<run-id>-tests-ledger.jsonl` — append-only typed rows; rows never rewritten or deleted. Historical `.md` ledgers remain untouched:

```markdown
# Tests Ledger — <repo> @ <short-sha>

format: csm-make-tests/1

## Entries

| date       | artifact/test      | kind   | status   | approver | notes                    |
| ---------- | ------------------ | ------ | -------- | -------- | ------------------------ |
| yyyy-mm-dd | path/to/test::name | golden | approved | user     | batch B1; commit abc1234 |

Kinds: golden | intent | contract | perf | amplified.
Statuses: approved | pending | known-defect.
KNOWN-DEFECT rows persist until the user fixes production and a re-capture supersedes them.
```

2. **Verification receipt** `.agents/tests/<date>-<repo-slug>-<run-id>-verification.json` — typed evidence and `csm-verification-status/1`; any Markdown report is a disposable projection:

```markdown
# Verification Report — <repo> @ <short-sha> (<date>)

format: csm-make-tests/1

## Scope

## Stacks

## Audit Summary

## Generated (counts per kind)

## Verification Commands And Results

## Pre-existing Failures (verbatim)

## Known-Defect Summary

## Mutation Scores

## Performance Baselines

## Not Run (with reasons)

## Phase-0 Recommendations
```

Both artifacts are the durable contract between runs: MAINTAIN reads the previous ledger to compute drift and re-approval queues, and the verification report is the only place protection claims are made. The report also carries the `csm-verification-status/1` status record and retained or explicitly unavailable evidence records defined in `schemas/verification-status.schema.json`.

## Anti-Patterns

- Generating tests without auditing first (duplicates, wrong framework, missed goldens).
- Auto-accepting goldens, on CI or off; running update flags without presented diffs.
- Fixing bugs during capture; "improving" production code while characterizing.
- Blanket-generating goldens for low-risk untouched code (change-detector noise).
- Coverage-only claims of protection without a mutation spot-check.
- Claiming green for a suite that was never run, or silently absorbing pre-existing failures into skips.
- Regex-scrubbing volatile fields where a library matcher or dependency injection would do.
- Hardcoding report filenames or vendor claims flagged in `references/known-uncertainties.md`.
- Skipping TRIAGE and locking defects silently into the suite; approving noisy goldens.
- Oversized approval batches that make human review a rubber stamp.
- Deleting or weakening retained characterization tests after refactors instead of re-approving through the ledger.
- Wrapping data-mutating methods in differential harnesses.
- Bare small-percentage performance absolutes on shared runners; benchmarks without recorded runner class.
- Writing anywhere outside the allowlist — including commits the user never authorized.
- Continuing past OUTPUT: implicit handoffs, follow-up fixes, or further generation after termination.

## Done Criteria

- All 13 states have entry and exit; cycle and termination rules defined and followed.
- Audit table exists; every generated test traces to an audited gap or a MAINTAIN delta.
- All generated suites pass against unchanged code; pre-existing failures recorded verbatim.
- Every golden has an APPROVE ledger entry; every KNOWN-DEFECT is annotated in-test and in-ledger.
- Scoped mutation spot-check ran for characterized modules with per-module scores in the ledger.
- Perf gates exist where service/CLI surfaces warrant them, with named baselines saved.
- Differential outcome recorded: wired-and-calibrated or explicitly skipped.
- Write discipline held: allowlist verified at OUTPUT; temp dir deleted.
- Both Required Test Package artifacts written in their exact shapes.
- Report displayed; run terminated at STOP — no handoff executed implicitly.
