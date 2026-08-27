---
name: csm-orchestrate
description: Use ONLY to execute a canonical csm-grill/1 approach through bounded conditional skill routing, typed receipts, evidence gates, review, approval, and recovery; never plans or implements sibling work.
---

# CSM Orchestrate

`csm-orchestrate` is the outer-loop controller for an agreed canonical
`csm-approach/1` JSON artifact. It compiles approach phases into immutable thin
slices, selects only declared conditional routes, invokes siblings through an
injected host adapter, and emits a parent `csm-orchestrate-receipt/1`.

## Interface

Invoke `orchestrate()` from `csm-orchestrate/index.mjs` with a canonical JSON
approach, a host adapter, capability metadata, and edge-bound approvals.

- Consumes: canonical approach JSON, declared capabilities, host adapter, and scoped approvals.
- Produces: a typed parent receipt with child lineage, evidence, gate, review, and outcome status.
- Hands off: the final receipt and durable cursor to the operator or future `csm-build` handoff.
- Never invokes: csm-orchestrate

## Contract

- The JSON approach artifact is authoritative. Markdown is not accepted by the
  runtime without a separate validated projection adapter.
- A host implementing `invokeSiblingSkill` and an approval bound to every edge
  are required. Missing host, capability metadata, approval, or evidence fails
  closed; this repository does not provide live host dispatch.
- Sibling skills retain their own lifecycle, artifacts, permissions, and side
  effect authority. The coordinator records references and receipts only.
- Technical, functional, adversarial, and mandatory final review gates run
  before `VERIFIED` is emitted. Final review may add one bounded remediation
  phase, which re-enters the same gates.
- Checkpoint storage must implement durable `saveCursor`/`loadCursor`; in-memory
  state is not treated as recovery evidence. Retries use the route's declared
  idempotency and recovery policy.

## Operator Handoff

The future `csm-build` handoff should provide the saved approach path, parent
`run-...` ID, capability manifest, host adapter, approval provider, durable
cursor store, and deterministic technical/functional evidence callbacks. Run
`node --test tests/orchestrate-e2e.test.mjs` for the synthetic contract suite.
Do not interpret this skill's fixture host as production dispatch or infer
productivity improvements from these tests.
