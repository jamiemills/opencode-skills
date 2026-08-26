---
name: csm-build
description: Implement CSM plans; use ONLY on explicit start/execute/continue/resume, never while planning. Biases towards retrieval from the saved plan and current repository evidence over memory.
---

# CSM Build

## Canonical JSON Control

Durable build control is `csm-build-state/1` JSON. `RECOVER`, `VALIDATE`, `SELECT`,
`DISPATCH`, `INTEGRATE`, `VERIFY`, `REVIEW`, `REPAIR`, and `CHECKPOINT` are recorded
as append-only transitions; `COMPLETE` and `BLOCKED` are terminal and immutable.
Build dispatch is refused until the plan, BDD package, test package, and required
DDD/norms inputs are validated JSON with matching source lineage. Commit and
rollback evidence are descriptors, not execution authorization. This skill never
executes implementation tasks during the planning migration. Markdown and HTML
remain human-only projections and are rejected as machine inputs; legacy Markdown
is not automatically converted.

## Optional Progress Tracker

The progress tracker is OFF by default. Include no tracker text in intermediate or final output unless the user explicitly requests progress tracking or supplies `--progress`; otherwise preserve existing output unchanged. When enabled, declare 3–6 skill-appropriate milestones and expected weights totaling 100% before work begins.

Render one overall horizontal bar and one horizontal milestone row as work advances:

```text
TASK PROGRESS  [████████████████░░░░░░░░░░░░] 53%
Milestones
[Research ✓ 20%] [Plan ✓ 15%] [Build ▶ 45%] [Verify ○ 20%]
```

The milestone row has no per-milestone progress bars. Use `✓` complete, `▶` active, and `○` pending. Calculate overall completion as `completed_weight + active_weight × verified_fraction`. If scope cannot be estimated, say `TASK PROGRESS  not estimated`; if scope changes, explain the change and recalculate. This supplements, never replaces, the skill state machine, acceptance evidence, and final result.

Execute a saved CSM plan from its verified current state. Start a new plan or recover interrupted work, use the maximum useful number of parallel subagents, and continue cycling until the goal is verified complete or genuinely blocked.

## Tmux Session Bootstrap

Run first — before `Activation Boundary` work, locating the plan, or any execution state. Not an execution state.

1. Derive a tmux-safe `<goal-slug>` from the invocation's goal and prompt: lowercase, hyphen-separated, concise, and stable for this run. The session name is `csm-build-<goal-slug>`.
2. If already in tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds), rename the current session to `csm-build-<goal-slug>` with `tmux rename-session -t "$(tmux display-message -p '#S')" "csm-build-<goal-slug>"`, unless the user explicitly forbade renaming or chose another multiplexer. If renaming fails, note it and continue in the existing session.
3. If not in tmux, and the user did not forbid tmux or choose another multiplexer, write the original request to a mode-600 temporary prompt file, then launch it without shell interpolation: `tmux new-session -d -s "$session" -- <agent-cli> run --prompt-file "$prompt_file"`; verify the launched invocation received the exact request before ending this invocation.
4. Print the active session name and attach command: `tmux attach-session -t csm-build-<goal-slug>`. If a new detached session was launched, end the invocation — tmux does the build from the start.
5. When tmux is unavailable, forbidden, or a different multiplexer was chosen, note that and continue into the execution workflow without renaming or starting tmux.

## Activation Boundary

- Activate this skill only when the user's current message explicitly asks to implement, execute, start, continue, or resume work from a saved CSM plan.
- A request to "make a plan to build" or discussion of future implementation is not authorization to activate this skill.
- The existence or creation of a plan is not authorization to execute it.
- Never auto-start after `csm-plan`. A separate, later user message must explicitly request execution.
- If the user requested planning only, do not implement anything and do not transition the plan out of `NOT_STARTED`.

## Core Rules

- The primary agent is the state-machine controller, integrator, and final verifier. Subagents do bounded research, implementation, and review work; they do not decide the global state.
- The saved plan is the durable control document, but repository evidence is authoritative. Never trust status labels without validating the actual files, tests, data state, and tool output.
- Obey repository instructions and preserve user or concurrent-agent changes. Never revert, overwrite, or include unrelated work.
- Maximize useful parallelism. Dispatch all ready, independent work together in one parallel tool batch when supported, up to available capacity, but never assign overlapping write ownership or ignore dependencies merely to increase agent count.
- Keep shared or high-conflict files under primary-agent ownership. When safe write isolation is impossible, parallelize investigation and review, then integrate edits serially.
- Prefer the smallest change that satisfies each task's acceptance criteria. Reuse existing repository patterns, prefer deletion over addition, and reject unrequested abstractions, configurability, and speculative generality. Fixes must address root causes, not layer workarounds.
- Scale ceremony to risk. Small, low-risk batches may use a lightweight path — primary-agent self-review instead of review subagents — but journaling and transition records are never reduced, and security, privacy, data integrity, destructive, or public-interface work always receives full independent review.
- Do not mutate external services, production infrastructure, live data, or persistent environments unless the plan explicitly requires it and the user has explicitly approved it. Prefer local fixtures, mocks, dry runs, and disposable environments for validation.
- Do not push, deploy, publish, migrate real data, or perform destructive cleanup unless explicitly requested.
- Commit only when the user explicitly authorizes a commit in the current invocation; otherwise do not invoke Git commit. The primary agent owns authorized commits: verify the exact owned pathset before and after committing, use `git commit --only -- <owned paths>` with no bare `git commit`, and leave unrelated staged work untouched. Never push unless explicitly requested.
- Update the plan after every state transition and completed dispatch group. It must always contain enough evidence and an exact next transition for a fresh agent to resume.
- Record `Last model/run:` in Control at each checkpoint so a resumed or model-switched run can re-verify prior evidence instead of trusting status labels.
- Do not stop after one task or cycle. Continue until `COMPLETE` or `BLOCKED`. The only sanctioned exception is the `PAUSED` stop under Pause On Quota.
- Never vary the shared static prefix across parallel dispatches in a batch — prefix stability is a cache and cost property.

### Subagent Resilience

Fallback ladder for dispatched subagent failures — journal every incident, never silently:

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. Primary completion (evidence gathering) / primary-led integration (low-risk only, with a recorded independence caveat).
5. On quota-type failures (HTTP 429, rate-limit, quota-exceeded, out-of-credits, billing, context-length-exceeded) do NOT run the retry ladder — surface to the primary agent for the pause protocol (Pause On Quota).

## Conditional Applicability Consumption

Applicability is an optional plan input, not a new execution state. A plan
without a `### Applicability` block remains a legacy plan and keeps the
existing lightweight execution path. When present, consume one strict
`csm-applicability/1` JSON record using the repository's shipped validator.
Validate its decision, mode, matched signals, task slices, obligation IDs and
statuses, relative DDD artifact paths, bypass, and reclassification history.
Do not infer, repair, replace, or silently reclassify the record.

For every explicitly referenced DDD pair, validate read-only before relying on
it: the graph is JSON with `format: csm-ddd-graph/1`, the report has its
declared `csm-ddd-report/1` format/run-ID envelope, both paths are relative,
and the graph `runId` matches the report's `graphRunId` (and report `runId`
when present). Check every consumed claim for status, basis, and confidence,
and record coverage caps, gaps, and unresolved questions. The Markdown report
is an envelope and coverage source, not a substitute for the graph machine
contract. `context_hypothesis`, `inferred`, `unverified`, `not_detected`, and
capped coverage remain hypotheses or bounded gaps; they never prove absence
or justify inventing a seam, invariant, or rollback option. Do not invoke
csm-ddd automatically.

### Applicability Transition Matrix

| Input condition                                                                                         | Required route and behavior                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy plan with no applicability block                                                                 | Existing flow; no new ceremony or mandatory DDD work.                                                                                                  |
| Valid `lightweight` plan, including a valid bypass                                                      | Existing lightweight flow; preserve the cheap exemption and current acceptance path.                                                                   |
| Valid `warranted` or `mixed` plan with complete applicable obligations and valid DDD evidence           | `VALIDATE -> SELECT -> DISPATCH`; apply obligations only to warranted task slices.                                                                     |
| Malformed applicability JSON, invalid obligation mapping, or missing required obligation                | `VALIDATE -> REPAIR`; do not dispatch until repaired and revalidated. If safe repair needs a product or scope decision, `BLOCKED`.                     |
| Invalid explicitly referenced DDD graph/report pair, path, format, or run-ID envelope                   | `BLOCKED`; do not substitute another artifact or silently invoke csm-ddd.                                                                              |
| Required boundary, invariant, observable, parity, or rollback/recovery evidence is unverified or absent | `BLOCKED` when safe execution cannot be established; otherwise `REPAIR` only for bounded evidence repair, never a scope redesign.                      |
| Reclassification or new evidence changes warranted scope                                                | Preserve the prior decision and evidence, record the reason/history, route to `REPAIR` or `BLOCKED`, and require a new valid decision before dispatch. |

No task may be dispatched before `VALIDATE` passes. This matrix changes only
obligation consumption and routing; it does not add states, alter dependency
semantics, reduce review scaling, or authorize silent scope reclassification.

## Repository Norms (NORMS.md)

**NORMS.md is entirely optional.** If a `NORMS.md` file produced by `csm-scan` exists in the repository, load it and apply its conventions. If not present or not authentic, ignore and continue — nothing is blocked.

### Detection

During RECOVER, check for NORMS.md in this order:

1. User-explicit reference in the prompt
2. `<git-root>/NORMS.md`
3. `<cwd>/NORMS.md`
4. None found — continue with a brief note

### Validation

Authentic csm-scan output contains either "Generated by csm-scan" or "## Repository Overview". Otherwise warn "NORMS.md found but does not appear to be csm-scan output — conventions may not be accurate" and proceed.

### Integration

When loaded:

- **RECOVER**: Load conventions; note the generation date and warn if stale (>30 days).
- **DISPATCH**: Include a "Repository Norms" section in every subagent prompt.
- **CHECKPOINT**: Cross-reference Discovered Requirements against NORMS.md norms; add mismatches as risks.

## Locate The Plan

Plans come from the canonical `csm-plan/1` JSON artifact (`.agents/plans/<date>-<goal-slug>-csm.json`) or a JSON BDD/TDD descriptor ending in `-bdd-csm.json`. Markdown plans and projections are legacy history, not machine inputs, and return `migration-required`.
Legacy `Superseded for BDD/TDD` pointers are history markers; JSON descriptors carry supersession explicitly.

Resolve the plan as follows:

1. A plan path explicitly supplied by the user, or established in the conversation, always wins.
2. Otherwise inspect `.agents/plans/` at the repository root for `.json` descriptors only. When both a base plan and a BDD/TDD mutation exist for the same goal, prefer the BDD/TDD descriptor — it supersedes the base plan by default; when several versions exist, prefer the highest version.
3. Check the selected JSON descriptor for its typed supersession pointer. If present, and the user has not explicitly asked to run that original plan, follow the pointer and use the referenced descriptor instead.
4. If multiple plausible plans remain, ask the user to choose; do not guess.
5. Read the complete plan, applicable repository instructions, and referenced evidence before changing state. For a BDD/TDD plan, also absorb the specs folder path and Traceability section: scenario and unit-test-design paths under the specs folder are part of every task's evidence.

## Interface

- Consumes: a saved CSM plan (explicit path or discovered in `.agents/plans/`, BDD/TDD mutation preferred); optional NORMS.md artifact; optional csm-ddd analysis artifacts when the plan cites them
- Produces: a verified implementation with commits, plus the updated plan document (Control, journal, Completion Review)
- Hands off: terminal executor — delivery returns to the human; evidence capture via csm-browse is a separate user action
- Never invokes: csm-bdd-tdd, csm-browse, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-make-tests, csm-review-python, csm-ddd, csm-autoresearch

## Execution State Machine

Use only these control states:

`RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`

`NOT_STARTED` is the only allowed pre-execution marker. On an explicit start request, transition it to `RECOVER`; never make that transition during plan creation.

From `CHECKPOINT`, transition to `SELECT`, `COMPLETE`, or `BLOCKED`. On quota exhaustion, transition to the `PAUSED` stop (see Pause On Quota). Any failed validation may transition to `REPAIR`; any discovery that invalidates the plan may transition to `BLOCKED` or, when safely resolvable, back to `SELECT` with corrected tasks.

Record every transition in `Control` and `Progress Journal` before proceeding. Increment the cycle when moving from `CHECKPOINT` back to `SELECT`.

### Lifecycle and Resume Contract

`BLOCKED` is a recoverable stop, not a terminal success state. A blocker
checkpoint records the blocker, evidence, attempted resolutions, the exact
decision needed, and the first safe transition; after unblocking the only
entry is `BLOCKED -> RECOVER -> VALIDATE`. `REVIEW` has one clean success exit:
`REVIEW -> CHECKPOINT`. It never skips the checkpoint to select, complete, or
publish work.

When resumability is claimed, `Control` is the durable cursor. It must contain
`Current CSM state`, `Cycle`, `Last checkpoint`, `Last model/run`, `Next
transition`, and `Resume`, while the latest journal row records the same
transition and its evidence. A cursor identifies the task or batch, step, and
artifact/checkpoint being resumed; a label such as "in progress" is not a
cursor. Recovery writes a new checkpoint before retiring or deleting older
temporary state and resumes from the last durable cursor.

### 1. RECOVER

Reconstruct reality before continuing:

1. Inspect repository status and current diffs without modifying them.
2. Check the plan's `format:` marker (e.g. `format: csm-plan/1`); on an unknown version, stop and report incompatibility rather than guessing.
3. Detect and validate NORMS.md (see Repository Norms section). Load conventions into plan context if present and authentic.
4. Compare the plan's active and completed tasks with actual implementation and validation evidence.
5. Identify partial edits, failed checks, generated artifacts, concurrent changes, and stale assumptions.
6. Mark a task completed only when its acceptance evidence is present and reproducible. Correct stale statuses in the plan.
7. Set the exact next safe transition. A new plan and an interrupted plan both pass through this state.
8. DDD-context check: if the plan cites `.agents/ddd/` artifacts, verify each referenced file exists and parses, confirm the plan's cited runId equals the graph's runId, and record mismatches as a VALIDATE blocker; absent citations, skip.
9. Applicability check: if the optional `### Applicability` block exists, parse and validate the single JSON record, including required obligations for the decision and task slices. Validate every explicitly cited DDD graph/report pair, its relative paths, format/run-ID envelope, claim status/basis/confidence, and disclosed coverage gaps. Preserve plans without the block as legacy lightweight behavior; do not dispatch or silently redesign scope from a malformed or incomplete record.

**Resume block.** When resuming (including from `PAUSED`), re-read Control `Last checkpoint`, the latest journal row, the Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff. When `Last model/run:` differs from the current run, re-verify acceptance evidence authored by the previous run instead of trusting status labels.

If the prior state was `BLOCKED`, recover only after the recorded decision or
prerequisite is present; then run `RECOVER -> VALIDATE` again. Do not resume
from an unjournaled in-memory step or from retired temporary state.

### 2. VALIDATE

1. Run the narrowest safe checks needed to establish a baseline for affected areas.
2. Confirm that referenced files, interfaces, dependencies, commands, and acceptance criteria still match the repository.
3. If the plan is stale but can be corrected without changing the user's goal, update it and record why. If correction requires a product choice, broader scope, an unsafe action, or destructive work, transition to `BLOCKED` and ask the user.
4. Record commands, relevant output, and failures in the progress journal.
5. Recheck the applicability result and applicable obligations against current repository evidence. A warranted or mixed task cannot proceed with a required obligation marked `missing` or `unverified` without an explicit repair route and acceptance evidence. Confirm that DDD hypotheses and coverage gaps remain limitations, not facts; invalid artifact pairs or unsafe boundary evidence route to `BLOCKED` under the transition matrix.
6. This gate must pass before `SELECT` can produce a dispatchable ready set or before any `DISPATCH` occurs.

### 3. SELECT

1. Build the ready set from pending tasks whose dependencies are actually satisfied.
2. For complicated or uncertain tasks, consider — as an option, never a default or mandate — first dispatching an isolated R&D spike: throwaway evaluation work that explores candidate approaches and proves one solution option before the real task is committed to. Skip this for small, simple, or well-understood work. Spikes pursue learning, not deliverables: they must run in a scratch location outside the repository or be fully reverted afterward, leaving no leftover files, edits, dependencies, or changes; only their findings return, recorded in the plan as evidence for shaping the real task and its acceptance signal.
3. Confirm each ready task names a runnable acceptance signal — a test, command, or script whose result objectively demonstrates the task is done. If a task lacks one, define one in the plan before dispatch; never dispatch on subjective criteria alone.
4. Select the largest safe batch of ready tasks.
5. Partition ownership by non-overlapping files or components. Identify shared integration points that the primary agent will handle.
6. Mirror the current batch in the session task list when available, while keeping the saved plan authoritative.
7. If no task is ready, resolve an unmet dependency, repair plan inconsistency, declare a specific blocker, or begin completion verification. Never silently stall.
8. When resuming from a paused plan, run a best-effort pre-flight probe before the first `DISPATCH`: issue one cheap model call to verify quota has returned. On a quota signal, stay paused — journal the probe result and report — otherwise proceed.

### 4. DISPATCH

Launch all independent assignments concurrently. Each subagent prompt must include:

- goal and task ID;
- owned files or components and explicit exclusions;
- relevant plan evidence and dependencies;
- repository instructions;
- required implementation and validation;
- the task's runnable acceptance signal — the exact check VERIFY will run;
- an instruction to implement the minimal change satisfying the acceptance criteria: no speculative features, abstractions, configurability, or cleanup beyond scope;
- requirements discovered in earlier cycles that apply to this task;
- for BDD/TDD plans: the task's scenario and unit-test-design paths under the specs folder, and the mandated TDD order — failing unit tests first (red), minimal implementation (green), refactor, then make the scenario pass end-to-end;
- if NORMS.md was loaded during RECOVER: a "Repository Norms" section extracting key conventions (file naming rules, import style, testing patterns, error handling, commit conventions, architecture patterns);
- prohibition on unrelated edits, destructive actions, commits, deployments, and external-system mutation;
- required return: files changed, checks run with results, acceptance evidence, remaining risks, and anything that may affect another task.
- for plans citing DDD context: carry the relevant seam constraints (rollback option, observable behavior) into every task touching that seam
- for warranted or mixed task slices: carry only relevant obligation evidence into the prompt — boundary and owner, contract, invariant, observable behavior, seam, parity, rollback/recovery, and unresolved-risk records — with each DDD claim's status, basis, confidence, and coverage limitation; distinguish required evidence from hypotheses and bounded gaps

Use implementation subagents only when their write scopes do not overlap. Use additional parallel subagents for independent read-only investigation or test analysis when that shortens the critical path.

Do not dispatch a task whose applicability record, required obligations, or
explicit DDD evidence has not passed `VALIDATE`. Do not let a subagent decide
that warranted work is lightweight, drop an obligation, or broaden the task
to compensate for missing evidence; return such a condition to `REPAIR` or
`BLOCKED`.

**Prefix-sharing rule.** When dispatching a parallel batch, every subagent receives a byte-identical static prefix — system prompt, tool definitions, skills, and plan evidence identical across the batch, with only per-task payloads differing AFTER the stable region. DeepSeek's automatic prefix caching (api-docs.deepseek.com/guides/kv_cache) persists a detected common prefix across requests and serves subsequent matching requests at ~97% of the input price; measured per-session hit ratios in this repo are 88-99%. Intra-batch hits at ~97% apply when the shared prefix is already warm or the first response lands before peers fire — do NOT vary the shared prefix per subagent (any change breaks the full-prefix-unit match).

Providers using explicit cache breakpoints (e.g. Anthropic-style cache_control, 4 breakpoints max, 20-block lookback) benefit from staggering the first parallel request or a shared breakpoint so the first response warms the cache before peers fire; DeepSeek handles this automatically, but a fully-parallel batch of cold first requests can still race prefix persistence — prefer warm prefixes (repeat sessions, stable tool sets) or accept the first request at miss price.

### 5. INTEGRATE

1. Inspect every subagent result and actual diff; do not rely only on its summary.
2. Reject or correct out-of-scope edits and reconcile interfaces at shared boundaries without reverting unrelated work.
3. When a subagent returns incomplete or incoherent results alongside a partially sound diff, choose deliberately: salvage and finish the work directly, re-dispatch with narrowed scope, or discard and redo. Do not default to full re-dispatch, and record the choice.
4. Apply primary-owned shared-file changes only after worker outputs are understood.
5. Keep task status `in_progress` until integrated behavior passes its specified validation.

### 6. VERIFY

1. Order checks cheapest-first — lint and typecheck before unit tests, unit tests before integration — and stop the batch at the first failing layer instead of running expensive checks on already-failed work.
2. Run each task's narrow validation, then the relevant combined or integration checks for the batch.
3. Use real repository tooling and record exact commands and meaningful results.
4. Check acceptance behavior against the task's runnable acceptance signal, not only compilation or test exit status.
5. On failure, capture evidence and transition to `REPAIR`. Do not mark failed work complete.
6. For warranted and mixed task slices, verify each applicable obligation with
   current evidence: boundary/owner, contract, invariant, observable behavior,
   seam, parity, rollback/recovery, and unresolved risks. Recheck the referenced
   DDD graph/report envelope and claim status/basis/confidence, and ensure gaps or
   hypotheses were not presented as proof. Missing or unverified warranted
   evidence is not a pass: repair bounded evidence or block when safe execution
   cannot be established.
7. Verify any applicability reclassification against its preserved history,
   reason, and newly recorded evidence. Never silently reclassify scope during
   verification.

### 7. REVIEW

Delegate review to subagents that did not implement the reviewed work. For small, low-risk batches the primary agent may perform this review directly, but security, privacy, data integrity, destructive, or public-interface changes always require independent review. Run independent review tracks concurrently where useful, including:

- correctness and acceptance-criteria coverage;
- regressions and edge cases;
- security, privacy, data integrity, and operational impact where relevant;
- test quality and missing validation;
- maintainability and consistency with repository patterns;
- plan drift, incomplete tasks, and integration conflicts.

Require findings to cite files and lines, severity, impact, evidence, and a concrete correction. The primary agent triages all findings; do not dismiss a finding without recorded reasoning.

For warranted or mixed work, independently review obligation coverage and
scope integrity: check that prompts and implementation preserve relevant
boundary, invariant, observable, parity, rollback/recovery, and risk evidence,
that DDD claims retain status/basis/confidence and disclosed coverage gaps, and
that no hypothesis or missing artifact was used to redesign or de-scope work.
Missing warranted obligations require `REPAIR` or `BLOCKED`, not lowered
applicability. Keep existing risk-based review scaling for legacy and
lightweight work.

### 8. REPAIR

1. Classify each failure or finding before acting: plan or spec misunderstanding (re-scope the task; for BDD/TDD plans, correct the scenario or spec in the specs folder together with the plan's Traceability so they never drift), genuine defect (root-cause fix), environmental or flaky check (rerun or isolate; never patch product code to appease it), ownership or integration collision (adjust partitioning), or reviewer false positive (dismiss with recorded reasoning).
2. Convert valid findings and failed checks into explicit repair tasks with dependencies and acceptance evidence. Every repair task must state the root cause it addresses; symptom suppression — skipping a test, catch-and-ignore, widening a type, inflating a timeout — requires explicit recorded justification.
3. Dispatch independent repairs concurrently to agents with non-overlapping ownership. Prefer agents different from the original implementer when practical.
4. Integrate and rerun the failed checks plus any newly relevant regression checks, cheapest-first.
5. Track repair attempts per task. After two failed attempts on the same task, stop patching and choose deliberately: dispatch a fresh-eyes root-cause diagnosis, re-scope the task, or transition to `BLOCKED` with evidence. Never silently loop on a broken task.
6. Cycle through `VERIFY`, `REVIEW`, and `REPAIR` until no material issue remains, subject to the attempt budget above.

### 9. CHECKPOINT

Update the saved plan in place:

- task statuses and stable task IDs;
- current cycle and state;
- `Last model/run:` — the current model and run identifier, for model-switch-safe resumption;
- completed validation and review evidence;
- actual files or components changed;
- unresolved findings, risks, and blockers;
- exact next transition and ready tasks;
- a timestamped progress-journal entry.

For a present applicability record, checkpoint the decision, task slice,
obligation status/evidence, DDD artifact pair and run-ID validation, coverage
gaps, and any reclassification history. Reconcile the checkpoint with current
boundary/invariant/observable/rollback evidence before selecting the next
transition. If a required obligation became missing or unverified, route to
`REPAIR` or `BLOCKED` and do not checkpoint it as complete. Legacy and
lightweight checkpoints retain the existing fields and flow.

Then learn from the cycle before moving on. Scan the cycle's failures and review findings for systemic patterns rather than one-offs, and propagate what was learned forward:

- add newly discovered requirements (lint rules, style constraints, environment quirks, interface gotchas) to the prompts and acceptance criteria of all remaining tasks;
- update remaining tasks' acceptance criteria when review exposed a whole class of gap;
- split remaining tasks that proved too large and merge trivial ones;
- adjust batch size after ownership collisions or integration failures;
- tighten or add validation commands where checks were missing or misleading.

Keep the working tree and plan recoverable. Do not use chat history as the only record of progress.

If and only if the user explicitly authorizes a commit in the current invocation, commit the verified batch together with the updated plan before choosing the next transition. Verify the owned pathset before and after using `git commit --only -- <owned paths>`; never use a bare commit, include unrelated staged paths, or clear unrelated staged work. Never push unless explicitly requested. Without authorization, record the verified work as intentionally uncommitted and report that no commit was created, rather than implying a commit exists.

Then immediately choose:

- `SELECT` when verified pending work remains;
- `COMPLETE` when all work and final acceptance checks pass;
- `BLOCKED` only under the blocker rules below;
- `PAUSED` on quota exhaustion (see Pause On Quota).

## Completion Gate

The primary agent must personally perform the final gate; do not delegate it. Verify:

1. Every numbered task is completed or explicitly excluded with user approval.
2. Every acceptance criterion has current, recorded evidence.
3. Relevant focused, integration, and repository-wide checks pass, or any unavailable check has a clearly stated reason and residual risk.
4. Review findings are resolved and no material regression, security, data, or operational issue remains.
5. The implementation matches the user's goal rather than merely matching task wording.
6. Documentation, migrations, configuration, and recovery steps are complete where relevant.
7. Repository status contains no unexplained changes from this execution.
8. All execution work is committed only when the user explicitly authorized a commit; otherwise the intentionally uncommitted state is recorded, the result says `not committed (user authorization not provided)`, and nothing has been pushed without an explicit request.

If any gate fails, create repair work and continue the cycle. If all pass, set `Status: complete`, set `Current CSM state: COMPLETE`, fill `Completion Review`, add the final journal entry, and report the result and verification evidence. Quota exhaustion is not a gate failure — it pauses via the `PAUSED` stop (Pause On Quota), and the paused checkpoint becomes the resume point.

## Blocker Rules

Transition to `BLOCKED` only when progress requires one of the following:

- a product or scope decision that evidence cannot resolve;
- credentials, access, or an unavailable external dependency;
- explicit approval for destructive, production, deployment, migration, or real-data action;
- a direct conflict with concurrent changes that cannot be integrated safely;
- a failing prerequisite that cannot be repaired within the plan's scope.

Before stopping, save a checkpoint with the blocker, evidence, attempted resolutions, exact user decision needed, and the first transition to run after unblocking. Ask one concise numbered question with concrete options.

## Pause On Quota

Quota exhaustion is the single sanctioned exception to "Do not stop after one task or cycle". When model-API quota is hit, pause cleanly instead of forcing work through.

Quota signal set: `HTTP 429`, `rate-limit`, `quota-exceeded`, `out-of-credits`, `billing`, `context-length-exceeded`.

On a quota signal:

1. Record the exact error in the journal as evidence.
2. Integrate only already-returned, safe in-flight subagent results.
3. Run the full `CHECKPOINT` block, including a commit only if explicitly authorized.
4. Set Control `Status: paused`, `Current CSM state: PAUSED`, `Next transition: PAUSED -> RECOVER`.
5. Stop cleanly.

Transient signals (a single `HTTP 429` or `rate-limit`) get one short backoff retry before pausing; hard exhaustion pauses immediately. Resume via the RECOVER resume block when quota returns.
