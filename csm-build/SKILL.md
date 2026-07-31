---
name: csm-build
description: Implement an already saved CSM plan using parallel subagents and durable checkpoints; use ONLY when the user explicitly asks to start, execute, continue, or resume implementation, never while creating a plan.
---

# CSM Build

Execute a saved CSM plan from its verified current state. Start a new plan or recover interrupted work, use the maximum useful number of parallel subagents, and continue cycling until the goal is verified complete or genuinely blocked.

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
- Do not mutate external services, production infrastructure, live data, or persistent environments unless the plan explicitly requires it and the user has explicitly approved it. Prefer local fixtures, mocks, dry runs, and disposable environments for validation.
- Do not commit, push, deploy, publish, migrate real data, or perform destructive cleanup unless explicitly requested.
- Update the plan after every state transition and completed dispatch group. It must always contain enough evidence and an exact next transition for a fresh agent to resume.
- Do not stop after one task or cycle. Continue until `COMPLETE` or `BLOCKED`.

## Locate The Plan

1. Use the path supplied by the user or established in the conversation.
2. Otherwise inspect `.agents/plans/` at the repository root.
3. If exactly one active CSM plan matches, use it. If multiple plausible plans exist, ask the user to choose; do not guess.
4. Read the complete plan, applicable repository instructions, and referenced evidence before changing state.

## Execution State Machine

Use only these control states:

`RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`

`NOT_STARTED` is the only allowed pre-execution marker. On an explicit start request, transition it to `RECOVER`; never make that transition during plan creation.

From `CHECKPOINT`, transition to `SELECT`, `COMPLETE`, or `BLOCKED`. Any failed validation may transition to `REPAIR`; any discovery that invalidates the plan may transition to `BLOCKED` or, when safely resolvable, back to `SELECT` with corrected tasks.

Record every transition in `Control` and `Progress Journal` before proceeding. Increment the cycle when moving from `CHECKPOINT` back to `SELECT`.

### 1. RECOVER

Reconstruct reality before continuing:

1. Inspect repository status and current diffs without modifying them.
2. Compare the plan's active and completed tasks with actual implementation and validation evidence.
3. Identify partial edits, failed checks, generated artifacts, concurrent changes, and stale assumptions.
4. Mark a task completed only when its acceptance evidence is present and reproducible. Correct stale statuses in the plan.
5. Set the exact next safe transition. A new plan and an interrupted plan both pass through this state.

### 2. VALIDATE

1. Run the narrowest safe checks needed to establish a baseline for affected areas.
2. Confirm that referenced files, interfaces, dependencies, commands, and acceptance criteria still match the repository.
3. If the plan is stale but can be corrected without changing the user's goal, update it and record why. If correction requires a product choice, broader scope, an unsafe action, or destructive work, transition to `BLOCKED` and ask the user.
4. Record commands, relevant output, and failures in the progress journal.

### 3. SELECT

1. Build the ready set from pending tasks whose dependencies are actually satisfied.
2. Select the largest safe batch of ready tasks.
3. Partition ownership by non-overlapping files or components. Identify shared integration points that the primary agent will handle.
4. Mirror the current batch in the session task list when available, while keeping the saved plan authoritative.
5. If no task is ready, resolve an unmet dependency, repair plan inconsistency, declare a specific blocker, or begin completion verification. Never silently stall.

### 4. DISPATCH

Launch all independent assignments concurrently. Each subagent prompt must include:

- goal and task ID;
- owned files or components and explicit exclusions;
- relevant plan evidence and dependencies;
- repository instructions;
- required implementation and validation;
- prohibition on unrelated edits, destructive actions, commits, deployments, and external-system mutation;
- required return: files changed, checks run with results, acceptance evidence, remaining risks, and anything that may affect another task.

Use implementation subagents only when their write scopes do not overlap. Use additional parallel subagents for independent read-only investigation or test analysis when that shortens the critical path.

### 5. INTEGRATE

1. Inspect every subagent result and actual diff; do not rely only on its summary.
2. Reject or correct out-of-scope edits and reconcile interfaces at shared boundaries without reverting unrelated work.
3. Apply primary-owned shared-file changes only after worker outputs are understood.
4. Keep task status `in_progress` until integrated behavior passes its specified validation.

### 6. VERIFY

1. Run each task's narrow validation, then the relevant combined or integration checks for the batch.
2. Use real repository tooling and record exact commands and meaningful results.
3. Check acceptance behavior, not only compilation or test exit status.
4. On failure, capture evidence and transition to `REPAIR`. Do not mark failed work complete.

### 7. REVIEW

Delegate review to subagents that did not implement the reviewed work. Run independent review tracks concurrently where useful, including:

- correctness and acceptance-criteria coverage;
- regressions and edge cases;
- security, privacy, data integrity, and operational impact where relevant;
- test quality and missing validation;
- maintainability and consistency with repository patterns;
- plan drift, incomplete tasks, and integration conflicts.

Require findings to cite files and lines, severity, impact, evidence, and a concrete correction. The primary agent triages all findings; do not dismiss a finding without recorded reasoning.

### 8. REPAIR

1. Convert valid findings and failed checks into explicit repair tasks with dependencies and acceptance evidence.
2. Dispatch independent repairs concurrently to agents with non-overlapping ownership. Prefer agents different from the original implementer when practical.
3. Integrate and rerun the failed checks plus any newly relevant regression checks.
4. Cycle through `VERIFY`, `REVIEW`, and `REPAIR` until no material issue remains.

### 9. CHECKPOINT

Update the saved plan in place:

- task statuses and stable task IDs;
- current cycle and state;
- completed validation and review evidence;
- actual files or components changed;
- unresolved findings, risks, and blockers;
- exact next transition and ready tasks;
- a timestamped progress-journal entry.

Keep the working tree and plan recoverable. Do not use chat history as the only record of progress.

Then immediately choose:

- `SELECT` when verified pending work remains;
- `COMPLETE` when all work and final acceptance checks pass;
- `BLOCKED` only under the blocker rules below.

## Completion Gate

The primary agent must personally perform the final gate; do not delegate it. Verify:

1. Every numbered task is completed or explicitly excluded with user approval.
2. Every acceptance criterion has current, recorded evidence.
3. Relevant focused, integration, and repository-wide checks pass, or any unavailable check has a clearly stated reason and residual risk.
4. Review findings are resolved and no material regression, security, data, or operational issue remains.
5. The implementation matches the user's goal rather than merely matching task wording.
6. Documentation, migrations, configuration, and recovery steps are complete where relevant.
7. Repository status contains no unexplained changes from this execution.

If any gate fails, create repair work and continue the cycle. If all pass, set `Status: complete`, set `Current CSM state: COMPLETE`, fill `Completion Review`, add the final journal entry, and report the result and verification evidence.

## Blocker Rules

Transition to `BLOCKED` only when progress requires one of the following:

- a product or scope decision that evidence cannot resolve;
- credentials, access, or an unavailable external dependency;
- explicit approval for destructive, production, deployment, migration, or real-data action;
- a direct conflict with concurrent changes that cannot be integrated safely;
- a failing prerequisite that cannot be repaired within the plan's scope.

Before stopping, save a checkpoint with the blocker, evidence, attempted resolutions, exact user decision needed, and the first transition to run after unblocking. Ask one concise numbered question with concrete options.
