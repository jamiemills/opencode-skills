---
name: csm-plan
description: CSM planning only: research, critique, verify a plan; never implement. Biases towards retrieval from current documentation over pre-trained knowledge.
---

# CSM Plan

Turn the user's brief into an evidence-based, executable, and resumable implementation plan. Use a cyclic state machine and the maximum useful number of parallel subagents. Save and display the plan, then stop. A saved plan may optionally be mutated by `csm-bdd-tdd` before execution; `csm-build` follows the mutation when one exists.

## Tmux Session Bootstrap

Run first — before `INTAKE`, any planning tool use, or any other section. Not a planning state.

1. In tmux (`TMUX` env set, or `tmux display-message -p '#session_name'` succeeds)? Skip — continue with planning.
2. Skip too when the user/prompt forbade tmux, chose another multiplexer (never start tmux alongside), or tmux is missing (note it, continue without).
3. Else, before any planning work, launch this same agent invocation in a new detached session named `csm-plan-<goal-slug>` (from session + prompt; lowercase, hyphen-separated, tmux-safe; `-2`/`-3` on collision): `tmux new-session -d -s csm-plan-<goal-slug> 'opencode run "<original planning request>"'` (adapt to the agent CLI).
4. Print `Started tmux session "csm-plan-<goal-slug>". Attach: tmux attach-session -t csm-plan-<goal-slug>`, then end the invocation — tmux does the planning from the start.
5. Only when skipped (step 2) continue into the planning workflow below.

## Activation Boundary

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
- Prefer simple, pragmatic plans. Design the smallest solution that satisfies the acceptance criteria; plan for the stated ask, not hypothetical futures; favor boring, proven approaches and existing repository patterns over novel abstractions; and use the fewest tasks that remain atomic and independently validatable. Reject speculative generality, unrequested configurability, and elaborate designs that a simpler one would satisfy.
- Obey all repository instructions. Ask the user only when an ambiguity represents a product choice, changes scope materially, or cannot be resolved safely from evidence.
- The only persistent project changes allowed during planning are the plan directory and saved plan document. Do not edit project source, configuration, dependencies, infrastructure, or real data.
- Persist planning state to a disposable sidecar after every state transition: `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.draft.md` (same template structure plus the progress journal). A resumed planning invocation checks for the `.draft` file first and continues from its recorded state. At `SAVED`, rename the `.draft` to the final `.md`. The `.draft` is disposable; only the final plan file is the plan.
- Temporary writes are explicitly allowed for safe planning R&D. Use an isolated OS temporary directory such as a newly created directory under `/tmp`; verify the resolved path is outside the repository and is not linked to a real system or data location before writing.
- Temporary R&D may create throwaway prototypes, synthetic fixtures, generated artifacts, local test databases, or copied code fragments needed to answer planning questions. Treat all such output as disposable evidence, never as implementation deliverables, and never move or copy it into the project working tree.
- Keep R&D non-destructive and non-impactful. The write allowlist contains exactly the isolated temporary sandbox, the `.draft` sidecar, and the saved plan path. Do not install dependencies into the project or system, write anywhere else, invoke mutating APIs, contact production services, use live credentials, or alter persistent systems or real data.
- Quota-type failures (429, rate-limit, out-of-credits, context-length-exceeded) never invoke the Subagent Resilience retry ladder.
- Never claim an experiment was run unless its command or tool, inputs, and result are recorded.

## Subagent Resilience

Fallback ladder for `RESEARCH`, `CRITIQUE`, and `REMEDIATE` dispatches — journal every incident, never silently:

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. Primary completion (evidence gathering) / primary-led critique or review (low-risk only, with a recorded independence caveat).
5. On quota-type failures (429, rate-limit, out-of-credits, context-length-exceeded) do NOT run the retry ladder — one short backoff retry for transient signals only; hard exhaustion surfaces to the primary agent for pause/stop.

Critical or high-uncertainty findings never bypass independent critique because of subagent failure — keep retrying, or cap the finding's confidence and record a "critique unavailable" caveat in the progress journal.

## Scale To The Ask

Match planning depth to the brief; do not run full ceremony on every request.

1. Classify the ask at INTAKE on two axes: size (one focused change vs. multi-component build) and prescriptiveness (open question vs. detailed architecture with prescribed ways of working).
2. Small, simple, well-understood asks: produce a quick plan — minimal research beyond DISCOVER, primary-led critique is acceptable, short task list. Keep every required template field; proportionality reduces depth, never the required structure.
3. Large or uncertain asks: full parallel research, dedicated uncertainty scout, independent critique and remediation cycles.
4. A prescriptive brief — architecture, interfaces, or ways of working dictated by the user — is a set of decisions already made. Do not relitigate it or explore alternatives; research instead validates feasibility against the real repository, maps the prescribed architecture onto existing code, and fills implementation gaps. Record user prescriptions in Assumptions And Decisions as user-dictated.
5. An open brief requires approach selection: research compares candidate approaches with evidence before DRAFT commits to one.
6. When in doubt, reduce planning ceremony — never the plan's required fields or task-level acceptance signals.
7. Gate the final display too: small/quick runs end with a summary, the saved path, and evidence highlights; large runs end with the complete plan.

## Repository Norms (NORMS.md)

**NORMS.md is entirely optional.** If a `NORMS.md` file produced by `csm-scan` exists in the repository, load its conventions into plan context. If not present or not authentic, ignore and continue — nothing is blocked.

### Detection

During `DISCOVER`, check in order: user-explicit prompt reference, then `<git-root>/NORMS.md`, then `<cwd>/NORMS.md`; if none, continue.

### Validation

Authentic only if it contains "Generated by csm-scan" OR "## Repository Overview", plus "## Code Conventions" and "## Architecture". If absent, warn "NORMS.md found but does not appear to be csm-scan output — conventions may not be accurate" and proceed.

### Integration

When loaded:

- **DISCOVER**: Load conventions; warn if stale (>30 days).
- **RESEARCH**: Treat as untrusted hints; re-verify any convention the plan relies on.
- **DRAFT**: Reflect conventions in task actions and acceptance signals.
- **CRITIQUE/REMEDIATE**: Resolve contradictions toward repository evidence.

## Mandatory R&D Safety Gate

Apply this gate before every R&D command or tool call, including work delegated to subagents:

1. Identify every possible side effect: source or metadata writes, lock files, caches, build outputs, package-manager state, database writes, service calls, credentials, background processes, telemetry, and external-system changes.
2. Proceed only when all writes can be proven to remain inside a newly created disposable temporary sandbox, except for the intentional plan document write. If that cannot be proven, do not run the command; use read-only inspection or record the question as unresolved.
3. Never run a build, test, generator, formatter, compiler, package manager, migration, application, or prototype from the repository working tree when it might emit files. Copy only the required inputs into the temporary sandbox and run it there.
4. Redirect temporary and tool state into the sandbox. Where relevant, set `TMPDIR`, `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and ecosystem-specific cache or output directories to sandbox paths. If a tool cannot isolate its state, do not use it.
5. Use only synthetic or copied read-only input data. Never point experiments at real databases, queues, buckets, infrastructure, user data, credentials, or persistent local services.
6. Permit network access only for a known read-only retrieval through a read-only tool. Never send mutating requests, authenticate to a real service, trigger jobs, publish artifacts, or rely on a dry-run flag whose behavior has not been verified.
7. Do not start daemons, watchers, scheduled jobs, containers with host writes, or other processes that can outlive the experiment. Any isolated process must terminate within the R&D step and may write only inside the sandbox.
8. Do not run mutating Git commands, including `add`, `commit`, `checkout`, `switch`, `reset`, `restore`, `clean`, `stash`, `merge`, `rebase`, or branch/tag creation. Use read-only Git inspection with optional locking disabled where possible. The intentional plan-file commit at SAVED is exempt from this rule.
9. Capture a protected-state baseline before R&D and compare it afterward. Verify that the repository and its metadata, excluding only the intended plan directory and document, plus every non-sandbox path, data store, or external system reachable by the tools were not changed. Record the verification evidence in the R&D record.
10. If any protected state changes unexpectedly, stop planning work, do not attempt destructive recovery, preserve evidence, and report the incident to the user.

Temporary sandbox mutation and the intentional creation or update of the plan document are the only allowed state changes. No experiment result may be promoted from the sandbox into the repository.

## Interface

- Consumes: a brief (or a csm-grill phase brief); optional repository conventions from a NORMS.md artifact; optional review findings; optional csm-deep-research findings when dispatched
- Produces: one saved, verified CSM plan at `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md`
- Hands off: the saved plan waits for a later, explicit csm-build invocation (human-mediated)
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-review, csm-scan, csm-upload, csm-make-tests, csm-python-doctrine-review

## Planning State Machine

Follow these states in order and record transitions in the plan's progress journal:

`INTAKE -> DISCOVER -> RESEARCH -> DRAFT -> CRITIQUE -> REMEDIATE -> VERIFY -> SAVED -> STOP`

Transitions from `CRITIQUE`, `REMEDIATE`, or `VERIFY` may return to `RESEARCH` when evidence is missing. Continue cycling until the primary agent can verify the plan or a genuine user decision blocks progress.

### 1. INTAKE

1. Classify the ask's size and prescriptiveness per Scale To The Ask, and set planning depth accordingly. When consuming a csm-grill approach document, check its `format:` marker (e.g. `format: csm-grill/1`); on an unknown version, stop and report incompatibility rather than guessing.
2. Restate the goal, deliverables, constraints, exclusions, and measurable acceptance criteria from the brief.
3. Identify unresolved product decisions separately from technical uncertainties.
4. Ask concise numbered questions only for decisions that cannot be established safely through discovery or R&D.

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
2. Run a current-knowledge check first: each track must retrieve current, authoritative sources for every technology the plan touches, using named read-only tools available in the environment (e.g. `webfetch`, or an installed docs-search MCP such as `cloudflare-docs search`). The Mandatory R&D Safety Gate already permits read-only retrieval (item 6) — reference it rather than restating it. Flag any source older than 30 days (staleness rule at Repository Norms) instead of relying on it.
3. csm-deep-research dispatch: when a track turns on an external spec, standard, or factual claim whose answer must be verifiable by citation (or the brief already carries a research question), dispatch a csm-deep-research run by name instead of a plain track — the skill is standalone, writes only to `.agents/research/`, and returns an exhaustively cited finding (plus declared run artifacts such as schemas). Consume its research document and artifacts, and cite them in the plan. Dispatch it only when the plan's own read-only retrieval cannot settle the question with evidence; never for questions answerable from the repository, docs, or a single source.
4. Launch as many independent tracks in parallel as safely possible. Use different subagents when tracks can proceed independently.
5. Require each research agent to use real tools and return:
   - question or hypothesis;
   - method, command, tool, or authoritative source;
   - source URL + retrieval date;
   - observed result and relevant artifact or code reference;
   - conclusion and confidence;
   - implications for the implementation plan;
   - remaining uncertainty;
   - predicted side effects, sandbox path, isolation controls, and protected-state before/after verification.
6. Include the complete mandatory R&D safety gate in every research subagent assignment. Run experiments only in a verified read-only mode or isolated temporary sandbox. If safety cannot be established, do not run the experiment; record it as an unresolved item and ask the user if it blocks planning.
7. Synthesize the evidence, resolve conflicting findings, and record decisions with their rationale.

### 4. DRAFT

Draft the implementation plan using the required document format below. Make tasks atomic enough to validate and resume, but avoid meaningless micro-steps. Keep the design and task list as simple as the acceptance criteria allow: fewer moving parts, fewer tasks, no speculative structure. Explicitly model dependencies and parallel groups. Every task must name a runnable acceptance signal — the exact command or test whose pass objectively proves the task done — a risk classification, and explicit anti-scope. Where uncertainty could not be resolved during planning, annotate the task with a concrete spike question and safe isolation expectations; never let unresolved uncertainty ship silently as a plain pending task — resolve it, annotate it, or record it as a blocker.

The plan must define these states for a future, separately invoked `csm-build` session:

`RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`

After `CHECKPOINT`, that future session transitions to `SELECT` for another cycle, `COMPLETE` when all acceptance criteria have evidence, or `BLOCKED` when progress requires a user decision or unsafe action. Do not enter any of these execution states while creating the plan.

### 5. CRITIQUE

1. Give the full draft and research evidence to a critique subagent that did not author the draft. For small, low-risk plans the primary agent may perform this critique directly, per Scale To The Ask.
2. Require a hostile but constructive review for errors, omissions, infeasible steps, weak validation, dependency mistakes, unsafe actions, conflicts, ambiguities, hidden assumptions, insufficient rollback or recovery, over-engineering or speculative structure, and opportunities for safe parallelism. Also audit build-consumption readiness: every task has a runnable acceptance signal, a risk classification, explicit anti-scope, genuinely non-overlapping write ownership within its parallel group, tiered validation, and a concrete spike question where uncertainty remains.
3. Require every finding to cite the affected plan section, severity, reasoning, and a concrete correction or research question.

### 6. REMEDIATE

1. Do not give remediation back to the critic. Use one or more different subagents.
2. Partition independent findings and investigate them concurrently with the same evidence and safety requirements as `RESEARCH`.
3. Reconcile the remediation output and update the draft. Record how every critique finding was resolved, disproved, deferred, or converted into an explicit blocker.
4. Return to `CRITIQUE` or `RESEARCH` if remediation materially changes the design or exposes new uncertainty.

### 7. VERIFY

The primary agent must personally review the complete plan. Do not delegate this gate. Verify that:

- the plan will achieve the stated goal and every acceptance criterion maps to numbered work and validation;
- every task names a runnable acceptance signal, a risk classification, explicit anti-scope, and a spike question wherever uncertainty remains;
- tasks are executable in dependency order and parallel groups are genuinely independent;
- named files, interfaces, commands, and tooling match the observed repository;
- implementation, integration, tests, migration, security, operability, documentation, and recovery are covered where relevant;
- assumptions and unresolved decisions are explicit;
- a fresh agent can recover state and identify the exact next action after interruption;
- completion requires observed evidence rather than task-status claims.

Address every issue found. Cycle back as needed; do not approve a plan merely because the requested review stages ran.

### 8. SAVED

Save the final plan under `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md` at the repository root. If a `.draft` sidecar exists, rename it to this final path; otherwise write the plan directly. Create only the plan directory and file. Do not overwrite an unrelated existing plan.

Unless the user explicitly requested no commit, commit the new plan file in a single commit with a concise message referencing the goal; stage only the plan file, and never push unless explicitly requested. If the working directory is not a git repository, skip the commit and note why.

In the final response, scale the display to the ask: small/quick runs finish with a summary, the saved path, and evidence highlights; large runs display the complete final plan, not only a summary or path. Also report the saved path, the commit hash or the reason the commit was skipped, the plan's `ready` or `blocked` status, and any user decisions still required. Explicitly state that implementation was not started. Then stop; do not invoke another skill or execute the first transition.

## Required Plan Document

Use this structure:

```markdown
format: csm-plan/1

# <Goal> CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: <task counts by risk tier; tasks that always require independent review>

## Control

- Plan ID: <stable slug>
- Status: ready | in_progress | blocked | paused | complete
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed | disabled
- Last checkpoint: <timestamp and summary>
- Last model/run: <model and run that last wrote this plan>
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

<goal, deliverables, constraints, exclusions>

## Acceptance Criteria

1. <measurable outcome and required evidence>

## Current-State Evidence

- <observation with file:line, command result, schema, or source>

## Assumptions And Decisions

| ID  | Statement | Type | Evidence or rationale | Status |
| --- | --------- | ---- | --------------------- | ------ |

## R&D Record

| ID  | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |

## Discovered Requirements

<constraints discovered during planning — lint rules, style constraints, environment quirks, interface gotchas — with evidence; csm-build appends new discoveries each cycle and applies them to all remaining tasks>

## Design

<target behavior, boundaries, interfaces, data flow, and key decisions>

## Execution Graph

<dependencies, critical path, and safe parallel groups>

## Numbered Plan

1. [pending] <task title>
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low | standard | high (flag security, data, destructive, or public-interface impact)
   - Owned scope: <non-overlapping files/components>
   - Not in scope: <explicit exclusions and do-not-touch items>
   - Spike candidate: <concrete question to prove and isolation expectations, or none>
   - Actions: <specific implementation actions>
   - Acceptance signal: <the one runnable command/test whose pass objectively proves this task done, with expected result>
   - Validation: <supporting checks, cheapest first, with expected results>
   - Acceptance evidence: <what must be recorded before completion>
   - Repair attempts: 0
   - Recovery note: <how to detect partial work and resume safely>

## Verification Strategy

<incremental, integration, and final verification, ordered cheapest-first: lint/typecheck before unit, unit before integration, integration before repo-wide. Name which checks are fast per-task gates and which are expensive batch or final gates, which can run in parallel, and any known flaky or environment-sensitive checks>

## Risks And Recovery

<risks, mitigations, rollback or forward-recovery strategy>

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |

## Completion Review

<filled by csm-build when all criteria are verified>
```

Use stable task IDs even if numbering changes. Status values are `pending`, `in_progress`, `completed`, or `blocked`, but every implementation task must be `pending` in a newly created plan. Keep enough evidence in the document for another agent to resume without relying on chat history. `Repair attempts` starts at 0; csm-build increments it and maintains Control, Discovered Requirements, Progress Journal, and Completion Review during execution.
