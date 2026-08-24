---
name: csm-autoresearch
description: Orchestrate bounded, evaluator-owned hill climbing over declared functions or evolution regions with registered, trusted-local, or gated generated sources. Use ONLY on an explicit autoresearch or evaluator-optimization request; never plans or implements production changes.
---

# CSM Autoresearch

Run a bounded generate-evaluate-select loop over one declared mutation surface.
The CSM owns orchestration, proposals, selection, approval, and durable
artifacts. A separate evaluator owns candidate execution, metrics, hard gates,
resource limits, and status. Candidates never own their score or evaluator.

## Interface

- Consumes: an explicit run contract, one declared callable or evolution region,
  deterministic evaluator policy, datasets, and a bounded trial budget.
- Produces: bounded JSONL evaluator exchanges, append-only ledger at
  `.agents/autoresearch/<yyyy-mm-dd>-<run-id>-ledger.jsonl`, and an atomic report
  at `.agents/autoresearch/<yyyy-mm-dd>-<run-id>-report.json`.
- Hands off: a rejected, quarantined, or approval-ready artifact set; protected
  promotion remains a separate human decision.
- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-deep-research, csm-make-tests, csm-review-python, csm-ddd

## Activation Boundary

Activate only after an explicit request to optimize a declared function,
benchmark, prompt, or evolution region using the autoresearch evaluator. A
general implementation, refactor, benchmark request, or request to change the
evaluator is not activation. Refuse or ask for the missing contract when the
target, metric, mutation allowlist, budget, or validation partition is absent.

The three source modes are intentionally different:

- `registered`: a pre-registered callable identified by stable ID and hash;
  deterministic execution may run without a sandbox, subject to policy.
- `trusted-local`: a user-declared local source snapshot; execute only in the
  allowlisted workspace with no evaluator or policy writes and record its hash.
- `generated`: hostile candidate source; remain blocked unless a verified
  sandbox provider and explicit generated-mode gate are present. Never fall back
  to an ordinary subprocess.

## Core Rules

- Treat evaluator, tests, fixtures, dependencies, credentials, policy, clocks,
  and audit storage as immutable and outside the candidate boundary.
- Mutate only declared callables or evolution regions; reject path and diff
  scope violations before execution.
- Use bounded JSONL: one request produces one response, with byte, line, field,
  candidate, and proposal limits enforced before parsing or execution.
- Deterministic hard gates outrank targets, LLM proposals, and LLM judges.
  Judge output is blinded, advisory, ordinal or pairwise, and never accepts a
  hard failure. Live adapters require explicit `DEF-EVAL` resolution, egress
  policy, credentials, and budgets; the default is a deterministic stub.
- Record every attempt, retry, exclusion, timeout, policy violation, and
  quarantine in the append-only ledger. Never silently discard a trial.
- Target mode stops when the declared threshold and all hard gates pass. Hill
  climb keeps only a materially better incumbent with all gates passing.
- Population search is disabled until measured stagnation or a declared
  diversity need activates its policy. Promotion of protected changes requires
  human approval and exact rollback identity.
- Redact secrets, credentials, absolute paths, and provider payloads from
  persisted provenance.

## Autoresearch State Machine

`INTAKE -> BASELINE -> PROPOSE -> SCREEN -> EVALUATE -> VALIDATE -> DECIDE -> LEDGER -> STOPPED`

### 1. INTAKE

Require the run contract, target, metric, mutation boundary, validation partition, and bounded budget.

### 2. BASELINE

Measure and persist the incumbent before proposing candidates.

### 3. PROPOSE

Generate bounded hypotheses or diffs through the configured proposer.

### 4. SCREEN

Deduplicate and run deterministic schema, scope, and fast safety checks.

### 5. EVALUATE

Run the candidate through the evaluator helper and collect bounded observations.

### 6. VALIDATE

Apply hard gates, repeated measurement, held-out validation, and anomaly checks.

### 7. DECIDE

Keep, reject, quarantine, or route to approval; advisory judges never override hard failures.

### 8. LEDGER

Append the complete trial event, provenance, artifacts, and decision atomically.

### 9. STOPPED

Stop on target, budget, stagnation policy, human decision, or an explicit blocker.

`ARCHIVE -> (PROPOSE | APPROVAL | STOPPED)` is the future population-search
extension, activated only by the policy. `APPROVAL -> (PROMOTE | ROLLBACK | STOPPED)`
is human-mediated. `BLOCKED` is terminal for missing sandbox, open `DEF-EVAL`,
invalid contracts, or policy violations; it cannot be retried by changing the
status alone.

## Artifact Contracts

Schemas in `schemas/` are the machine interface. `run-contract.schema.json`
defines source modes, metrics, mutation boundaries, and budgets.
`evaluator-request.schema.json` and `evaluator-response.schema.json` define one
bounded JSONL exchange and its status taxonomy. `policy.schema.json` defines
target, hill-climb, hard gates, and staged population activation.
`ledger-event.schema.json` and `report.schema.json` define durable provenance,
decisions, quarantine, approval, and rollback. `llm-adapter.schema.json`
defines provider-neutral proposal and advisory-judge messages.

## Never-Invoke Boundary

This skill is terminal. It may consume cited artifacts, but it does not dispatch
another CSM skill. A later task or user may explicitly invoke a separate skill
using these artifacts; that handoff is not an invocation by this skill.

## Done Criteria

- Contract and all exchanged artifacts validate against the shipped schemas.
- Baseline, candidate, hard-gate, target/hill-climb decision, and provenance
  records are present for every trial.
- Generated source is blocked without verified sandbox evidence, and live LLM
  behavior is blocked while `DEF-EVAL` remains unresolved.
- Report and ledger are complete, redacted, append-only/atomic as applicable,
  and promotion has an explicit approval or remains approval-pending.
