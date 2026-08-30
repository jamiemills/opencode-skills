---
name: csm-review-python
description: Review a Python repository against PEP 20 and idiomatic-Python doctrine, producing one evidence-grounded findings and fix-guide report. Use ONLY for Python repository analysis or dispatch from csm-review. Never invokes other skills.
---

# CSM Python Doctrine Review

## Progress Tracker

Progress tracking is ON by default for every invocation. Create and maintain a
versioned `csm-progress/1` JSON record; it supplements this skill's lifecycle,
artifacts, permissions, receipts, and evidence and never replaces them.
Declare 3–6 milestones before work begins, each with a positive weight; weights
must total exactly 100%.

Render one overall horizontal bar and one horizontal milestone row as work advances:

```text
TASK PROGRESS  [████████████████░░░░░░░░░░░░] 53%
Milestones
[Scope ✓ 20%] [Inspect ✓ 15%] [Findings ▶ 45%] [Report ○ 20%]
```

The milestone row has no per-milestone progress bars. Use `✓` complete, `▶` active, and `○` pending. Calculate `completed_weight + active_weight × verified_fraction` using named checkpoints actually completed by this skill. Retries retain one logical item and weight and never add credit. If scope cannot be estimated honestly, emit `TASK PROGRESS  not estimated` and keep it indeterminate. Unknown, skipped, cancelled, blocked, failed, and incomplete work is never silently complete. For a scope change, record old/new scope, reason, and revised weights before recalculating; discarded work gets no retroactive credit. `--quiet-progress` suppresses tracker bars and milestone text only; it never disables tracking, changes JSON state, hides blockers, or suppresses required lifecycle, safety, receipt, or evidence output. `--progress` is never required to activate tracking.

Inspect Python repositories without changing their source, dependencies, configuration, or history. The run is read-only except for its single declared report.

## Interface

- Consumes: a target Python repository checkout at a pinned commit, optional change-surface scope, optional NORMS.md, and the bundled idiomatic-Python rules artifact
- Produces: authoritative `.agents/doctrine/<date>-<repo-slug>-<run-id>-python-doctrine-review.json`; legacy compatibility path `.agents/doctrine/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review.md` is read-only history and Markdown is otherwise a projection.
- Hands off: the single doctrine report to the user or a dispatching csm-review; terminal otherwise
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-deep-research, csm-make-tests, csm-ddd, csm-autoresearch

## Durable Artifact Identity

Each analyzer invocation uses one immutable validated `run-id`, supplied by the caller or generated once at INTAKE as `yyyymmddthhmmssz-<12 lowercase hex>`; accepted IDs match `^[a-z0-9][a-z0-9-]{7,63}$`. The report records the ID and binds the target git root, normalized repository slug, artifact type, and run ID. Date and slug alone never establish ownership.

The report path is `.agents/doctrine/<date>-<repo-slug>-<run-id>-python-doctrine-review.json`. This analyzer is intentionally non-resumable before `REPORT`: every invocation gets a new run ID, and an existing terminal artifact or any path ownership mismatch is an explicit collision refusal. It never replaces, deletes, renames, or aliases a terminal artifact; legacy Markdown reports remain read-only history. The JSON artifact is the only target write and is owned exclusively by this analyzer, including when csm-review records the handoff.

Same-day duplicate slugs require a new run ID; the legacy date/slug path is never reused, and no mutable `latest` alias is created.

## Tmux Session Bootstrap

Run first — before INTAKE, any analysis tool use, or any other section. Not an analysis state.

1. Derive a tmux-safe `<goal-slug>` from the invocation's goal and prompt: lowercase, hyphen-separated, concise, and stable for this run. The session name is `csm-review-python-<goal-slug>`.
2. If already in tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds), rename the current session to `csm-review-python-<goal-slug>` with `tmux rename-session -t "$(tmux display-message -p '#S')" "csm-review-python-<goal-slug>"`, unless the user explicitly forbade renaming or chose another multiplexer. If renaming fails, note it and continue in the existing session.
3. If not in tmux, and the user did not forbid tmux or choose another multiplexer, launch this same agent invocation in a new detached session named `csm-review-python-<goal-slug>` (use a suffix such as `-2` or `-3` if that name is already taken): `tmux new-session -d -s csm-review-python-<goal-slug> 'opencode run "<original analysis request>"'` (adapt to the agent CLI).
4. Print the active session name and attach command: `tmux attach-session -t csm-review-python-<goal-slug>`. If a new detached session was launched, end the invocation — tmux does the analysis from the start.
5. When tmux is unavailable, forbidden, or a different multiplexer was chosen, note that and continue into the analysis workflow without renaming or starting tmux.

## Activation Boundary

- Activate only for an explicit standalone Python doctrine-review invocation or a dispatch from csm-review.
- Analyze only a Python repository. Do not fix, plan, implement, or review changes; do not turn findings into patches.
- Do not invoke another skill, including csm-review. The report is the terminal handoff; remediation requires a separate explicit request.

## Core Rules

- The target is read-only except for exactly one allowlisted report file. The ONLY write in the target repo is the report file.
- Audit the target at the resolved pinned commit. Record the commit and protected-state baseline before analysis.
- Never auto-install. Offer explicitly pinned isolated `uvx` tools or a `pipx` fallback only after explicit user consent. No consent means static-only analysis.
- Never claim an unrun check is green. Disclose missing dependencies, unavailable tools, checker limitations, and environment/tool noise, including import-resolution noise from isolated mypy runs.
- The report status is `VERIFIED`, `INCOMPLETE`, or `BLOCKED`; an unavailable or unresolved check cannot be reported as `VERIFIED`. Retain or embed report-referenced evidence, or record it as explicitly `unavailable` with a reason rather than retaining a deleted temporary path.
- External doctrine anchors use typed URL/version-or-edition/retrieval/reachability records. `unreachable` and `not-checked` anchors remain limitations, not verification evidence.
- Keep credentials, tokens, and sensitive source values out of commands, logs, findings, and the report.
- Use severity `C` (convention), `R` (refactor), `W` (warning), `E` (error/probable bug), `F` (fatal), and `Nit` only. Every finding states what, why it matters, evidence, and a recommendation.
- Separate mechanical tool evidence from PEP 20 doctrine judgment. Cite a rule ID or a doctrine playbook step for every finding.

## Write Discipline And File Allowlist

- Within the target repository, the allowlist is exactly the run-owned `.agents/doctrine/<date>-<repo-slug>-<run-id>-python-doctrine-review.json` and the required parent directory. No other target path may be created or modified.
- Put all scratch notes, command output, logs, temporary reports, and caches outside the target under a run-specific temporary directory, normally `/tmp/csm-review-python-<run-id>`.
- Redirect `UV_CACHE_DIR`, `PIPX_HOME`, and `XDG_CACHE_HOME` to directories under that temporary directory. Also use each tool's no-cache or explicit cache-dir option.
- Do not write target source, tests, documentation, pyproject/config files, dependencies, lockfiles, virtual environments, generated files, `.git`, or git metadata. Do not run mutating package-manager or git commands.
- Before REPORT, capture a target diff/status baseline; after the report, verify that the only target delta is the allowlisted report. Treat any other delta as a run failure and disclose it; never silently repair it.

## Repository Norms (NORMS.md)

NORMS.md is optional. Detect an explicit user path, then `<git-root>/NORMS.md`, then `<cwd>/NORMS.md`. Treat it as authentic when it contains either `Generated by csm-scan` or `## Repository Overview`; otherwise derive conventions from repository configuration. Read it only; never write it.

## Analysis State Machine

`INTAKE -> PROVISION -> SCAN -> ANALYZE -> JUDGE -> REPORT -> STOP`

Record every transition, trigger, command, and evidence path in temporary run notes. Scratch state never enters the target repository.

### Lifecycle and Resume Contract

This analyzer is intentionally non-resumable before `REPORT`: temporary run
notes are disposable and no durable cursor or checkpoint is written to the
target. An interruption restarts at `INTAKE` against a newly pinned baseline;
it does not claim `BLOCKED -> RECOVER -> VALIDATE` or `REVIEW -> CHECKPOINT`.
The allowlisted report is a terminal handoff, not a resume record.

### 1. INTAKE

Entry: explicit standalone activation or csm-review dispatch.

- Inputs: invocation context, target path or repository URL, optional scope, current date, and user tool-consent status.
- Actions: resolve the git root; confirm it is a Python repository; resolve and record the pinned commit; create and validate one run ID; refuse an existing terminal or mismatched report path; create the outside-target temporary directory; identify the run-owned report path, norms disposition, and protected-state baseline; reject an unpinned target rather than guessing.
- Outputs: intake record containing target, commit, scope, run ID, baseline, norms path/status, report path, and redacted environment facts.

Exit: target and scope are pinned and the protected-state baseline is recorded.

### 2. PROVISION

Entry: INTAKE exit with a pinned target.

- Inputs: intake record and available isolated runners.
- Actions: probe for pinned `uvx` and `pipx`. Offer, but do not execute without explicit OK, these concrete pinned commands: `uvx ruff@0.16.0`, `uvx mypy@1.18.2`, and `uvx pyright@1.1.407`; reject floating tags, missing pins, or placeholder pins; use `pipx run --spec ruff==<pin> ruff` or equivalent pinned fallback only after the same OK. Never install in the target. If consent is declined or no runner is available, select static-only mode and record the degradation.
- Outputs: tool plan with consent decision, runner path, exact pins, cache locations, and selected mode (`tool-assisted` or `static-only`).

Exit: availability, consent, versions if probed, isolation paths, and analysis mode are recorded.

### 3. SCAN

Entry: PROVISION exit with an approved tool plan or static-only mode.

- Inputs: tool plan, target commit, scope, and rule artifact.
- Actions: run only read-only checks. Use Ruff with `--no-cache` and redirected environment caches, and run mypy/pyright with their cache directories under the temporary directory (or disabled where supported). Capture the exact command, pin, version, exit code, timeout, stderr/stdout summary, and evidence paths. Do not execute project code, import the fixture, collect tests, or create bytecode. Map results to the artifact's 140 rules and tiers: correctness, bugbear-gotchas, judgment-gotchas, idiom, modernization, style-docstring, testing, and complexity-design.
- Outputs: mechanical evidence pack, tool transcript metadata, per-tool result (`pass`, `findings`, `failed`, `unavailable`, or `not-run`), and explicit noise/limitation notes.

Exit: scans are complete, or every unavailable, failed, and not-run check is disclosed.

### 4. ANALYZE

Entry: SCAN exit with mechanical evidence and disclosed gaps.

- Inputs: evidence pack, repository tree/configuration, optional NORMS.md, bundled `artifact/python-idiomatic-reviewer-rules.json`, and a registered JSON research/reference artifact. The historical Markdown research file is not an input.
- Actions: apply the PEP 20 architecture checklist: pyproject-only metadata where appropriate; coherent src layout and packaging boundaries; library/app dependency and lock discipline; validation at untrusted-data boundaries; Protocols or narrow interfaces at seams; EAFP and flat error handling; composition/data modeling over needless inheritance; sync-first concurrency unless I/O demands async; and a useful unit/integration/E2E test pyramid. Treat the 140-rule artifact as the review corpus, not a replacement for judgment, and respect project configuration and runtime targets.
- Outputs: observations linked to file/line evidence, research playbook steps, artifact rule IDs, and candidate findings; separate architecture, mechanical, semantic-static, and judgment buckets.

Exit: every candidate observation has evidence and a rule/playbook basis, or is discarded as unsupported.

### 5. JUDGE

Entry: ANALYZE exit with candidate observations.

- Inputs: candidate findings and all scan limitations.
- Actions: inspect non-lintable gotchas including mutable class attributes, replication aliasing, tuple-element augmented assignment, assignment-localization `UnboundLocalError`, bool-as-int surprises, mutators returning `None`, test validity, concurrency choices, docstring semantics, and reader-relative complexity. Deduplicate and order findings. Map urgency to `C/R/W/E/F/Nit`; calibrate against impact, confidence, project norms, and runtime target. Do not convert a missing or noisy tool result into a finding.
- Outputs: stable finding IDs, severity, confidence, title, what, why, evidence paths/lines and rule IDs/playbook citations, recommendation, and verification hint.

Exit: findings are evidence-grounded, severity-mapped, non-duplicative, and ready to report.

### 6. REPORT

Entry: JUDGE exit with ordered findings.

- Inputs: final findings, run record, tool transcript metadata, limitations, and baseline.
- Actions: write exactly one allowlisted JSON report. Store the tool/consent header, exact pins and versions, commands/results, target commit, scope, norms disposition, analysis mode, typed findings, explicit limitations, and target-diff verification as data. Human-readable Markdown is a separate on-demand projection and is never the authority or a machine input.
- Outputs: `.agents/doctrine/<date>-<repo-slug>-<run-id>-python-doctrine-review.json` and a verification record showing the target delta.

Exit: exactly one report exists, its package is complete, and no non-allowlisted target change is present.

### 7. STOP

Entry: REPORT exit, whether successful or failed.

- Inputs: report verification and temporary run notes.
- Actions: remove run scratch and caches where safe; ensure no cache or log remains in the target; retain only the requested report; disclose cleanup failures and any target-diff violation. Stop. Do not fix findings, plan remediation, implement changes, or invoke another skill.
- Outputs: terminal status and the report path, or a clear failure with evidence and limitations.

Exit: analysis is terminated and no further skill action is taken.

## Required Report Package

The authoritative producer contract is `csm-review-python/schemas/csm-doctrine-findings.schema.json` with descriptor `csm-review-python/producer.json`. Emit typed fix actions in each finding rather than Markdown checkboxes. The bundled research Markdown remains read-only historical/reference material and is not a machine input; only a registered JSON research/reference artifact may be consumed.

Emit one JSON artifact only. Its typed sections are rendered on demand as Markdown or HTML:

1. Human-readable title, run date/ID, target repository, pinned commit, scope, norms disposition, and report path.
2. Tool/consent header: runner choice, exact tool pins and observed versions, explicit consent result, cache redirection, analysis mode, command results, and unrun checks.
3. Executive summary and explicit limitations, including missing dependencies, import-resolution noise, unavailable tools, timeouts, and static-only degradation.
4. Findings table and detail sections. Each stable ID includes severity (`C/R/W/E/F/Nit`), what, why, confidence, evidence path and line, artifact rule ID or doctrine playbook step, recommendation, and verification hint.
5. `## Agent Fix Guide` at the end: findings ordered by dependency and severity, each with stable ID and machine-readable checkbox items such as `- [ ] F-001: ...`; include a verification command or human verification action for each item.

The report also carries a `csm-verification-status/1` record from
`schemas/verification-status.schema.json`. It must use `INCOMPLETE` or
`BLOCKED` when required checks, evidence, cleanup, or anchor reachability are
unresolved; `VERIFIED` is reserved for a complete, reproducible evidence set.

Reference the bundled `artifact/python-idiomatic-reviewer-rules.json` as a read-only input. The historical Markdown research file is provenance/history only and MUST NOT be parsed as machine input; consume only a registered JSON research/reference artifact with its schema ID, revision, artifact ID, digest, source, and retrieval metadata. Never write either bundled artifact.

## Anti-Patterns

- Auto-installing tools, using floating versions, or placing tools, virtual environments, caches, or logs in the target.
- Running mutating git/package-manager commands, project code, imports, test collection, formatters, autofixes, or dependency resolution against the target.
- Writing scratch files, a second report, a summary, or a modified baseline anywhere in the target.
- Treating Ruff, mypy, or pyright output as the complete doctrine review, or treating missing/noisy output as green.
- Reporting an uncited preference, a guessed violation, or a severity outside `C/R/W/E/F/Nit`.
- Hiding tool consent, version pins, unavailable checks, dependency gaps, environment noise, or target-diff violations.
- Fixing findings, implementing recommendations, planning remediation, or invoking another skill after REPORT.

## Done Criteria

- The target repository and commit are pinned, the baseline is recorded, and scope/norms disposition are disclosed.
- Tool availability, explicit consent, exact pins/versions, cache isolation, commands, exit codes, and degraded or unrun checks are recorded.
- The bundled 140-rule artifact and the registered JSON research/reference artifact are referenced without modification; historical Markdown remains read-only provenance.
- Every finding has a stable ID, permitted severity, what, why, evidence path/rule or playbook citation, recommendation, confidence, and verification hint.
- The report has human-readable first sections and a final agent-actionable fix guide with checkboxes.
- Exactly one allowlisted target file was written; no source/config/dependency/lock/git path changed; scratch and caches stayed outside the target.
- The target diff was verified and temporary state was cleaned; the analyzer stops without fixing, planning, implementing, reviewing, or invoking another skill.
