---
name: csm-orchestrate
description: Use ONLY to execute a canonical csm-grill/1 approach through bounded conditional skill routing, typed receipts, evidence gates, review, approval, and recovery; never plans or implements sibling work.
---

# CSM Orchestrate

## Progress Tracker

Progress tracking is ON by default for every invocation. Create and maintain a
versioned `csm-skill-progress/1` JSON record via `lib/progress-tracker.mjs` (update it only through `node lib/progress-tracker.mjs update <record> M<id>=<status>[:<fraction>]`, which derives `overallPercent` and normalizes statuses — never hand-edit the JSON); it supplements this skill's lifecycle,
artifacts, permissions, receipts, and evidence and never replaces them.
Declare 3–6 milestones before work begins, each with a positive weight; weights
must total exactly 100%.

Render one overall horizontal bar and one horizontal milestone row as work advances:

```text
TASK PROGRESS  [████████████████░░░░░░░░░░░░] 53%
Milestones
[Research ✓ 20%] [Plan ✓ 15%] [Build ▶ 45%] [Verify ○ 20%]
```

The milestone row has no per-milestone progress bars. Use `✓` complete, `▶` active, and `○` pending. Calculate overall completion as `completed_weight + active_weight × verified_fraction`. If scope cannot be estimated, say `TASK PROGRESS  not estimated`; if scope changes, explain the change and recalculate. This supplements, never replaces, the orchestration state machine, durable cursor, telemetry, evidence gates, receipts, and final review.
Declare milestones for this lifecycle, for example materialize (20%), dispatch
(30%), reconcile (30%), and review (20%). Only completed named checkpoints earn
credit; retries retain one logical item. Unknown, blocked, failed, incomplete,
or undispatched work is not complete. Scope changes record old/new scope,
reason, and revised weights. `--quiet-progress` suppresses only tracker text,
never JSON state, blockers, receipts, or required output.
Unknown, skipped, cancelled, blocked, failed, and incomplete work is never
silently complete.

`csm-orchestrate` is the outer-loop controller for an agreed canonical
`csm-approach/1` JSON artifact. It compiles approach phases into immutable thin
slices, selects only declared conditional routes, invokes siblings through an
explicitly injected executor, and emits a parent `csm-orchestrate-receipt/1`.

## Interface

Invoke `orchestrate()` from `csm-orchestrate/index.mjs` with a canonical JSON
approach, an explicitly injected executor, capability metadata, and edge-bound approvals.

- Consumes: canonical approach JSON, declared capabilities, explicitly injected executor, and scoped approvals.
- Produces: a typed parent receipt with child lineage, evidence, gate, review, and outcome status.
- Hands off: the final receipt and durable cursor to the operator or future `csm-build` handoff.
- Never invokes: csm-orchestrate

## Contract

- The JSON approach artifact is authoritative. Markdown is not accepted by the
  runtime without a separate validated projection adapter.
- An explicitly injected executor and an approval bound to every edge are
  required. Missing executor, capability metadata, approval, or evidence fails
  closed; this repository provides no default process or model runtime.
- Sibling skills retain their own lifecycle, artifacts, permissions, and side
  effect authority. The coordinator records references and receipts only.
- Technical, functional, adversarial, and mandatory final review gates run
  before `VERIFIED` is emitted. Final review may add one bounded remediation
  phase, which re-enters the same gates.
- Checkpoint storage must implement durable `saveCursor`/`loadCursor`; in-memory
  state is not treated as recovery evidence. Retries use the route's declared
  idempotency and recovery policy.

## Node/Run Completion Evaluation

- At every node/run boundary the orchestrator evaluates the run against its
  declared control, goal, and acceptance state. A hard node failure always
  fails closed: the run never silently continues and never becomes `VERIFIED`.
- On a hard node failure the abandoned work is recorded as a typed
  `csm-orchestrate-supersession/1` pointer with `resumable` and `failClosed`
  set true and the pending nodes and phases listed, in the durable cursor
  store, in telemetry, and on the run result, so a fresh session resumes from
  an explicit pointer rather than chat history.
- The evaluator may direct at most one bounded remainder phase within the
  per-run `remainderPolicy` budget (`maxRemainders`, default 0). The remainder
  is bounded and run-local (no global lock), and carries no further remainder
  budget; once spent, any later failure is terminal.

## Standalone Runtime Boundary

Standalone skills have no shared progress host/context callback in this
repository; their csm-progress/1 contract is instruction-led only. The
executable csm-progress/1 authority is the orchestrator-hosted progress runtime
reached through `orchestrate()` and its injected executor. Standalone skills
must not invent a caller, mutate the parent aggregate, or emit receipt, cursor,
telemetry, browse, upload, credential, session, or publication data through
progress.

## Operator Handoff

The future `csm-build` handoff should provide the saved approach path, parent
`run-...` ID, capability manifest, executor, approval provider, durable
cursor store, and deterministic technical/functional evidence callbacks. Run
`node --test tests/orchestrate-e2e.test.mjs` for the synthetic contract suite.
Do not interpret this skill's fixture host as production dispatch or infer
productivity improvements from these tests.

## Optional Jev Decision Points

Jev is the optional, host-mediated typed-decision layer, off by default and
observational: absent or disabled, behavior is byte-identical. Opt in via
`--use-jev` or the `csm-orchestrate-request/2` `decision` block.

- Transport is provider-pluggable: `CSM_DECISION_PROVIDER` selects a descriptor
  (default `openrouter`; `vercel` ships; a third route is a new
  `lib/decision-adapter/providers/<id>.mjs` descriptor only).
- Every provider, network, timeout, or cap failure fail-opens to the
  deterministic harness and never sets `PAUSED`;
  `CSM_DECISION_KILL=1` / `CSM_DECISION_MODE=off` force it off.

Jev output is the observational `csm-orchestrate-decision-gate/1` class with no
acceptance authority: it never writes evaluator receipts, loop guards,
closure/`verificationStatus`, cursor/supersession, or any gate. See
`docs/typed-decisions.md` and `docs/typed-decisions-runbook.md`.

- `orchestrate-reviewer-finding` (authority, advisory): when a host supplies an
  independent final reviewer and Jev is opted in, the reviewer's context may
  receive advisory `uphold | downgrade | retract | missing-evidence |
suggest-new-requirement` hints. The deterministic `reviewAcceptance` gate, its
  schema, and the no-callback fallback are byte-identical with or without this
  advice; advice never enters a gate input (enforced by the boundary guard).
