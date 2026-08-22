---
name: csm-make-tests
description: Generate a comprehensive executable test suite for any repository — audit existing tests and coverage, capture characterization goldens, generate intent/property/contract/performance tests, mutation-validate everything, and maintain approval ledgers as the suite evolves. Never plans, implements, or reviews production code.
---

# CSM Make Tests

Turn a repository into a fully tested one: audit what exists, capture what the code actually does, generate the tests that are missing across every layer, prove they detect faults, and keep them maintained as the code evolves. Grounded in the committed research finding `.agents/research/2026-08-22-characterization-skill-implementation-research.md` (characterization techniques, generation ladder, mutation gates, differential oracles, performance continuity).

## Interface

- Consumes: a target repository checkout at a pinned commit with optional change-surface scope; optional NORMS.md conventions; cited research findings under `.agents/research/`
- Produces: executable test files, goldens/fixtures, and benchmark files in the target repository; `.agents/tests/<yyyy-mm-dd>-<repo-slug>-tests-ledger.md`; `.agents/tests/<yyyy-mm-dd>-<repo-slug>-verification.md`
- Hands off: verified suite plus ledger and verification report to the user or a later explicit csm-build run
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-deep-research

## Tmux Session Bootstrap

Run first — before INTAKE, locating the plan, or any generation work. Not a generation state.

1. In tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds)? Skip — continue with generation.
2. Skip too when the user/prompt forbade tmux, chose another multiplexer (never start tmux alongside), or tmux is missing (note it, continue without).
3. Else, before any generation work, launch this same agent invocation in a new detached session named `csm-make-tests-<goal-slug>` (from session + prompt; lowercase, hyphen-separated, tmux-safe; `-2`/`-3` on collision): `tmux new-session -d -s csm-make-tests-<goal-slug> 'opencode run "<original generation request>"'` (adapt to the agent CLI).
4. Print `Started tmux session "csm-make-tests-<goal-slug>". Attach: tmux attach-session -t csm-make-tests-<goal-slug>`, then end the invocation — tmux does the generation from the start.
5. Only when skipped (step 2) continue into the generation workflow below.

## Activation Boundary

- Activate when the user asks to generate, add, complete, or maintain tests for a repository, or invokes csm-make-tests by name.
- Generation-only: produces test files, goldens/fixtures, benchmarks, ledgers, and verification reports. Never plans work (csm-plan's job), never implements production features or fixes bugs found during capture (document and ledger them; fixing is the user's later call), never reviews a repo adversarially (csm-review's job), never mutates BDD specs (csm-bdd-tdd's job).
- Words such as "build" in the user's request describe generating tests for future code as well as existing code; they never authorize modifying production behavior.
- OUTPUT is the terminal state: after it, display the verification report and ledger summary, then stop. Handoff to csm-build is a separate, explicit human invocation.
- Never execute code from an untrusted repository without the sandbox guidance in Core Rules; all execution happens inside the target repo's own toolchain under its own instructions.
- Clarifications: resolve ambiguity by recorded assumption unless the invocation sets an ask-first flag; only genuinely user-owned decisions block.

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
- Repository instructions win on conventions (test dirs, frameworks, naming); this skill wins on safety rules above.

## Write Discipline And File Allowlist

- Persistent writes inside the target repository: generated test files, golden/fixture files, benchmark files, configuration snippets the tests require (e.g. pytest plugin registration), plus exactly two artifacts:
  - `.agents/tests/<yyyy-mm-dd>-<repo-slug>-tests-ledger.md` — append-only approval and maintenance ledger.
  - `.agents/tests/<yyyy-mm-dd>-<repo-slug>-verification.md` — final verification report.
- Everything else (scratch notes, captured outputs under review, dry-run copies) lives in one disposable temp dir (e.g. `/tmp/csm-make-tests-XXXXXX`), deleted at OUTPUT.
- Never write outside the target repository and its allowlisted artifacts; never touch credentials, `.env` values, or secrets — scrubbed placeholders only in goldens.
- Git operations against the target repo stay read-only unless the user explicitly authorizes commits of generated tests.
- Delete the temp dir before OUTPUT; nothing from scratch may be promoted silently into the repo.

## Repository Norms (NORMS.md)

If a `NORMS.md` produced by csm-scan exists ("Generated by csm-scan" marker present), load its conventions at AUDIT and follow them for test placement, naming, and framework usage; treat stale (>30 days) norms as hints and re-verify against current config. If absent, derive conventions from repository configuration and continue.

## Test Generation State Machine

`AUDIT -> SCAN -> CAPTURE -> TRIAGE -> APPROVE -> VERIFY -> AMPLIFY -> DIFFERENTIAL -> LAYER -> PERF -> OUTPUT`

### 1. AUDIT

Inventory the existing testing estate before generating anything.

1. Enumerate all existing tests (unit/integration/e2e/benchmarks) with framework and location.
2. Collect coverage figures (line + branch) per area via the project's own coverage tooling; record command used.
3. Assess suite health: runtime, flaky suspects (retry-classified results), skipped/xfail inventory, last-known-green commit if determinable.
4. If characterization goldens already exist: enter MAINTAIN mode — produce drift report (`git diff` over golden paths since last ledger entry), queue re-approvals, update ledger; generate only the audited delta.
5. Emit the audit table (area | tests | coverage | health | gap) into the temp dir; it seeds SCAN targets.

### 2. SCAN

Choose what to generate, guided by risk rather than completeness-for-its-own-sake.

1. Detect stack(s) from project files (`go.mod`, `pyproject.toml`/`requirements.txt`, `package.json`, `Cargo.toml`, `pom.xml`/`build.gradle.kts`, `*.csproj`) and map to the capture/mutation/generation tables in `references/capture-patterns.md` and `references/mutation-gates.md`.
2. Identify public seams: exported functions, CLI commands, HTTP handlers, message consumers; prefer coarse text-producing boundaries.
3. Rank surfaces by change-risk (recent churn, planned refactor areas named by the user, coverage gaps from AUDIT).
4. Note prerequisite gaps (CI unwired, no type checking, unseamed code) and record them in the report as phase-0 recommendations even though fixing them is out of scope.

### 3. CAPTURE

Generate the tests, cheapest deterministic method first, per `references/capture-patterns.md`.

1. Characterization goldens for ranked surfaces: write failing-first capture tests, run, promote observed output, scrub volatiles with native matchers.
2. Intent drafts via Hypothesis Ghostwriter-style signature/docstring properties where annotations allow; fill strategy TODOs explicitly.
3. Deeper unit suites via deterministic generators where the stack supports it (containerized; see `references/intent-generation.md` for commands and safety guards).
4. LLM-assisted generation for remaining gaps follows the execution-in-the-loop pattern (generate → run → parse coverage → repair → repeat, capped iterations; flakiness-check by repeated runs) — every LLM-generated assertion passes the same mutation gate as any other.
5. Contract/integration candidates per available artifacts: OpenAPI schema → schema-conformance runs; recorded traffic → replay fixtures; real dependencies → container-backed integration tests (options and trade-offs in `references/intent-generation.md`).

### 4. TRIAGE

Classify every captured golden before it is locked in.

1. Intended behavior → approve path continues.
2. Defect (observed behavior is wrong) → annotate the golden, add a ledger entry marked KNOWN-DEFECT with explanation; do not fix production code in this run.
3. Noise (volatile residue survived scrubbing) → improve scrubbing/matcher and re-capture; never approve noise.
4. Record triage decisions in the ledger so future failures distinguish spec-change from defect-fix.

### 5. APPROVE

No golden locks without a human.

1. Present each pending diff (old vs observed) in review batches with scrubbing context.
2. Apply the stack's approve mechanism only after explicit user confirmation per batch (update flag, accept command, rename, or approved-file copy).
3. Update the ledger: artifact path, approving user, commit/timestamp, triage classification.
4. Refuse bulk auto-approval even when diffs look trivial; cap batch size to keep reviews honest.

### 6. VERIFY

Prove the suite is green and protective.

1. Run the full new suite against unchanged code; it must pass; pre-existing unrelated failures are recorded verbatim, never "fixed" by skipping.
2. Scoped mutation spot-check on characterized modules only, using `references/mutation-gates.md`; triage survivors into equivalent/unproductive (documented) vs real gaps (return to CAPTURE for targeted inputs).
3. Record mutation score per module in the ledger; this is the protection metric — coverage percentage alone proves nothing here.

### 7. AMPLIFY

Strengthen weak assertions where the stack supports it.

1. Where test-amplification tooling exists for the stack, run it on generated suites to add/assert stronger assertions (options and maturity notes in `references/intent-generation.md`).
2. Re-run the affected suites and the scoped mutation check; amplification that does not move kill-count is reverted as noise.
3. Optional step: skip cleanly when no mature amplifier exists for the stack.

### 8. DIFFERENTIAL

During refactor windows, the old implementation is the strongest oracle.

1. When the user is refactoring and the old path stays callable, wire Scientist-style control/candidate checks (serve old result, compare candidate, log mismatches) per `references/differential-oracle.md`.
2. Calibrate first (both blocks invoking control) to measure comparison noise before trusting mismatches.
3. Read-path only: never wrap data-mutating methods differentially.
4. Goldens remain the durable net before and after the window; differential harness retires when the old path dies.

### 9. LAYER

Add the layers the surface warrants, per the research finding.

1. Property-based invariants (round-trip, idempotence, crash-freedom) where input spaces are structured; default libraries Hypothesis/fast-check — note jqwik's Anti-AI clause before selecting it (see `references/known-uncertainties.md`).
2. Contract/conformance checks where schemas exist (schema-driven fuzz/conformance runs in CI); consumer-driven contracts where consumers exist.
3. Integration tests against containerized real dependencies where the repo already uses them.
4. Keep end-to-end/UI coverage deliberately thin; structure snapshots over pixels; document choices in the report.

### 10. PERF

Establish performance continuity gates, per `references/perf-playbook.md`.

1. Profile hot paths first (sampling profiler or instrumented run); record flamegraph/profile artifacts in the report.
2. One smoke load script with thresholds-as-code for service surfaces (or a CLI timing harness for batch tools), wired to fail CI on breach.
3. Save a named baseline; add micro-benchmarks for the hottest pure functions with compare-fail gates; include allocation counters where the stack exposes them.
4. Recommend (not execute by default) longer soak runs and profile-diff workflows for pre-release checkpoints.

### 11. OUTPUT

Deliver evidence, then stop.

1. Write the verification report to `.agents/tests/<yyyy-mm-dd>-<repo-slug>-verification.md`: scope, stacks, counts (goldens/intent/contract/perf), verification commands and results, pre-existing failures, known-defect ledger summary, mutation scores, perf baselines, not-run items with reasons.
2. Finalize the ledger at `.agents/tests/<yyyy-mm-dd>-<repo-slug>-tests-ledger.md`.
3. Delete the temp dir; display the report summary and next-step guidance (re-approval workflow, differential wiring during refactors); stop.

## Required Test Package

Every completed run emits exactly two persistent artifacts plus the generated tests:

1. **Tests ledger** `.agents/tests/<yyyy-mm-dd>-<repo-slug>-tests-ledger.md` — append-only; columns: date, artifact/test, kind (golden|intent|contract|perf|amplified), status (approved|pending|known-defect), approver, notes. Known-defect entries persist until the user fixes and re-captures.
2. **Verification report** `.agents/tests/<yyyy-mm-dd>-<repo-slug>-verification.md` — sections: Scope; Stacks; Audit Summary; Generated (counts per kind); Verification Commands And Results; Pre-existing Failures (verbatim); Mutation Scores; Performance Baselines; Not Run (with reasons); Phase-0 Recommendations.

Both artifacts are the durable contract between runs: MAINTAIN mode reads the previous ledger to compute drift and re-approval queues.

## Anti-Patterns

- Generating tests without auditing first (duplicates, wrong framework, missed goldens).
- Auto-accepting goldens, on CI or off; running update flags without presented diffs.
- Fixing bugs during capture; "improving" production code while characterizing.
- Blanket-generating goldens for low-risk untouched code (change-detector noise).
- Coverage-only claims of protection without a mutation spot-check.
- Regex-scrubbing volatile fields where a library matcher or dependency injection would do.
- Hardcoding report filenames or vendor claims flagged in `references/known-uncertainties.md`.
- Skipping TRIAGE and locking defects silently into the suite.

## Done Criteria

- AUDIT table exists and every generated test traces to an audited gap or MAINTAIN delta.
- All generated suites pass against unchanged code; pre-existing failures recorded verbatim.
- Every golden has an APPROVE ledger entry; every KNOWN-DEFECT is annotated in-test and in-ledger.
- Scoped mutation spot-check ran for characterized modules with scores recorded.
- Perf gates exist where service/CLI surfaces warrant them, with baselines saved.
- Both Required Test Package artifacts written; temp dir deleted.
- Report displayed; run terminated — no handoff executed implicitly.
