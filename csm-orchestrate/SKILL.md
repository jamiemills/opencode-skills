---
name: csm-orchestrate
description: Use ONLY to execute a canonical csm-grill/1 approach through bounded conditional skill routing, typed receipts, evidence gates, review, approval, and recovery; never plans or implements sibling work.
---

# CSM Orchestrate

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
