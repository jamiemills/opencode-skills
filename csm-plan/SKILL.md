---
name: csm-plan
description: CSM planning only: research, critique, verify, save, and display a numbered cyclic state machine implementation plan; use when asked to make or prepare a plan, and never start implementation.
---

# CSM Plan

Turn the user's brief into an evidence-based, executable, and resumable implementation plan. Use a cyclic state machine and the maximum useful number of parallel subagents. Save and display the plan, then stop.

## Non-Negotiable Planning Boundary

- This is a planning-only skill. It is never authorization to implement, build, fix, refactor, migrate, deploy, or execute any task from the plan.
- Words such as "build" or "implement" in the user's brief describe future work to plan. They do not authorize that work during this invocation.
- Never invoke `csm-build`, hand off to an implementation agent, dispatch implementation tasks, or transition into the execution CSM.
- Never execute a numbered plan task or mark one `in_progress` or `completed`. Every implementation task must remain `pending` when the plan is saved.
- If the same request asks both for a plan and implementation, complete and display the plan, then stop. Implementation requires a separate, later user message explicitly invoking `csm-build`.
- `SAVED` is the terminal planning state. After reaching it, display the complete plan and end the response without asking whether to start work.

## Core Rules

- The primary agent owns orchestration, synthesis, state transitions, and final approval.
- Use subagents for real work, not ceremonial restatement. Give each agent a focused question, relevant context, safe tool access, and a required evidence format.
- Maximize useful parallelism: dispatch every independent research or remediation task concurrently, up to the available capacity. Use one parallel tool batch rather than serial subagent calls when the tooling supports it. Do not parallelize work with unresolved dependencies or overlapping write ownership.
- Base conclusions on repository evidence, authoritative documentation, schemas, and safe experiments with real tools. Clearly distinguish observations from inferences.
- Obey all repository instructions. Ask the user only when an ambiguity represents a product choice, changes scope materially, or cannot be resolved safely from evidence.
- The only persistent project changes allowed during planning are the plan directory and saved plan document. Do not edit project source, configuration, dependencies, infrastructure, or real data.
- Temporary writes are explicitly allowed for safe planning R&D. Use an isolated OS temporary directory such as a newly created directory under `/tmp`; verify the resolved path is outside the repository and is not linked to a real system or data location before writing.
- Temporary R&D may create throwaway prototypes, synthetic fixtures, generated artifacts, local test databases, or copied code fragments needed to answer planning questions. Treat all such output as disposable evidence, never as implementation deliverables, and never move or copy it into the project working tree.
- Keep R&D non-destructive and non-impactful. The write allowlist contains exactly the isolated temporary sandbox and the saved plan path. Do not install dependencies into the project or system, write anywhere else, invoke mutating APIs, contact production services, use live credentials, or alter persistent systems or real data.
- Never claim an experiment was run unless its command or tool, inputs, and result are recorded.

## Mandatory R&D Safety Gate

Apply this gate before every R&D command or tool call, including work delegated to subagents:

1. Identify every possible side effect: source or metadata writes, lock files, caches, build outputs, package-manager state, database writes, service calls, credentials, background processes, telemetry, and external-system changes.
2. Proceed only when all writes can be proven to remain inside a newly created disposable temporary sandbox, except for the intentional plan document write. If that cannot be proven, do not run the command; use read-only inspection or record the question as unresolved.
3. Never run a build, test, generator, formatter, compiler, package manager, migration, application, or prototype from the repository working tree when it might emit files. Copy only the required inputs into the temporary sandbox and run it there.
4. Redirect temporary and tool state into the sandbox. Where relevant, set `TMPDIR`, `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and ecosystem-specific cache or output directories to sandbox paths. If a tool cannot isolate its state, do not use it.
5. Use only synthetic or copied read-only input data. Never point experiments at real databases, queues, buckets, infrastructure, user data, credentials, or persistent local services.
6. Permit network access only for a known read-only retrieval through a read-only tool. Never send mutating requests, authenticate to a real service, trigger jobs, publish artifacts, or rely on a dry-run flag whose behavior has not been verified.
7. Do not start daemons, watchers, scheduled jobs, containers with host writes, or other processes that can outlive the experiment. Any isolated process must terminate within the R&D step and may write only inside the sandbox.
8. Do not run mutating Git commands, including `add`, `commit`, `checkout`, `switch`, `reset`, `restore`, `clean`, `stash`, `merge`, `rebase`, or branch/tag creation. Use read-only Git inspection with optional locking disabled where possible.
9. Capture a protected-state baseline before R&D and compare it afterward. Verify that the repository and its metadata, excluding only the intended plan directory and document, plus every non-sandbox path, data store, or external system reachable by the tools were not changed. Record the verification evidence in the R&D record.
10. If any protected state changes unexpectedly, stop planning work, do not attempt destructive recovery, preserve evidence, and report the incident to the user.

Temporary sandbox mutation and the intentional creation or update of the plan document are the only allowed state changes. No experiment result may be promoted from the sandbox into the repository.

## Planning State Machine

Follow these states in order and record transitions in the plan's progress journal:

`INTAKE -> DISCOVER -> RESEARCH -> DRAFT -> CRITIQUE -> REMEDIATE -> VERIFY -> SAVED -> STOP`

Transitions from `CRITIQUE`, `REMEDIATE`, or `VERIFY` may return to `RESEARCH` when evidence is missing. Continue cycling until the primary agent can verify the plan or a genuine user decision blocks progress.

### 1. INTAKE

1. Restate the goal, deliverables, constraints, exclusions, and measurable acceptance criteria from the brief.
2. Identify unresolved product decisions separately from technical uncertainties.
3. Ask concise numbered questions only for decisions that cannot be established safely through discovery or R&D.

### 2. DISCOVER

1. Read the applicable repository instructions and inspect the repository, current implementation, tests, tooling, and relevant history.
2. Establish the current-state baseline and likely affected surfaces before designing changes.
3. Delegate a dedicated uncertainty scout. Require it to return:
   - assumptions in the brief or emerging design;
   - unknowns that could invalidate the plan;
   - conflicts or ambiguities;
   - concrete, safe experiments or inspections that would resolve each item;
   - risk and impact if an item remains unresolved.

### 3. RESEARCH

1. Convert the uncertainty report into independent research tracks.
2. Launch as many independent tracks in parallel as safely possible. Use different subagents when tracks can proceed independently.
3. Require each research agent to use real tools and return:
   - question or hypothesis;
   - method, command, tool, or authoritative source;
   - observed result and relevant artifact or code reference;
   - conclusion and confidence;
   - implications for the implementation plan;
   - remaining uncertainty;
   - predicted side effects, sandbox path, isolation controls, and protected-state before/after verification.
4. Include the complete mandatory R&D safety gate in every research subagent assignment. Run experiments only in a verified read-only mode or isolated temporary sandbox. If safety cannot be established, do not run the experiment; record it as an unresolved item and ask the user if it blocks planning.
5. Synthesize the evidence, resolve conflicting findings, and record decisions with their rationale.

### 4. DRAFT

Draft the implementation plan using the required document format below. Make tasks atomic enough to validate and resume, but avoid meaningless micro-steps. Explicitly model dependencies and parallel groups.

The plan must define these states for a future, separately invoked `csm-build` session:

`RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`

After `CHECKPOINT`, that future session transitions to `SELECT` for another cycle, `COMPLETE` when all acceptance criteria have evidence, or `BLOCKED` when progress requires a user decision or unsafe action. Do not enter any of these execution states while creating the plan.

### 5. CRITIQUE

1. Give the full draft and research evidence to a critique subagent that did not author the draft.
2. Require a hostile but constructive review for errors, omissions, infeasible steps, weak validation, dependency mistakes, unsafe actions, conflicts, ambiguities, hidden assumptions, insufficient rollback or recovery, and opportunities for safe parallelism.
3. Require every finding to cite the affected plan section, severity, reasoning, and a concrete correction or research question.

### 6. REMEDIATE

1. Do not give remediation back to the critic. Use one or more different subagents.
2. Partition independent findings and investigate them concurrently with the same evidence and safety requirements as `RESEARCH`.
3. Reconcile the remediation output and update the draft. Record how every critique finding was resolved, disproved, deferred, or converted into an explicit blocker.
4. Return to `CRITIQUE` or `RESEARCH` if remediation materially changes the design or exposes new uncertainty.

### 7. VERIFY

The primary agent must personally review the complete plan. Do not delegate this gate. Verify that:

- the plan will achieve the stated goal and every acceptance criterion maps to numbered work and validation;
- tasks are executable in dependency order and parallel groups are genuinely independent;
- named files, interfaces, commands, and tooling match the observed repository;
- implementation, integration, tests, migration, security, operability, documentation, and recovery are covered where relevant;
- assumptions and unresolved decisions are explicit;
- a fresh agent can recover state and identify the exact next action after interruption;
- completion requires observed evidence rather than task-status claims.

Address every issue found. Cycle back as needed; do not approve a plan merely because the requested review stages ran.

### 8. SAVED

Save the final plan under `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md` at the repository root. Create only the plan directory and file. Do not overwrite an unrelated existing plan.

In the final response, display the complete final plan, not only a summary or path. Also report the saved path, the plan's `ready` or `blocked` status, and any user decisions still required. Explicitly state that implementation was not started. Then stop; do not invoke another skill or execute the first transition.

## Required Plan Document

Use this structure:

```markdown
# <Goal> CSM Plan

## Control
- Plan ID: <stable slug>
- Status: ready | in_progress | blocked | complete
- Current CSM state: NOT_STARTED
- Cycle: 0
- Last checkpoint: <timestamp and summary>
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
<goal, deliverables, constraints, exclusions>

## Acceptance Criteria
1. <measurable outcome and required evidence>

## Current-State Evidence
- <observation with file:line, command result, schema, or source>

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|

## Design
<target behavior, boundaries, interfaces, data flow, and key decisions>

## Execution Graph
<dependencies, critical path, and safe parallel groups>

## Numbered Plan
1. [pending] <task title>
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Owned scope: <non-overlapping files/components>
   - Actions: <specific implementation actions>
   - Validation: <commands/checks and expected results>
   - Acceptance evidence: <what must be recorded before completion>
   - Recovery note: <how to detect partial work and resume safely>

## Verification Strategy
<incremental, integration, and final verification>

## Risks And Recovery
<risks, mitigations, rollback or forward-recovery strategy>

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|

## Completion Review
<filled by csm-build when all criteria are verified>
```

Use stable task IDs even if numbering changes. Status values are `pending`, `in_progress`, `completed`, or `blocked`, but every implementation task must be `pending` in a newly created plan. Keep enough evidence in the document for another agent to resume without relying on chat history.
