format: csm-plan/1

# Autoresearch Evaluator CSM Plan

## How To Execute

- This is executed only by the current explicit csm-build request.
- All tasks are implemented in the isolated worktree `wt/autoresearch-evaluator-csm`.
- Generated-source execution and live LLM behavior fail closed until their evidence gates pass.

## Control

- Plan ID: autoresearch-evaluator-csm
- Status: blocked
- Current CSM state: BLOCKED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24T04:20:00Z — repairs verified; deterministic/stub implementation is green, but generated sandbox and live LLM gates remain blocked.
- Last model/run: gpt-5.6-luna / csm-build-autoresearch-evaluator-csm
- Next transition: BLOCKED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read this Control, the latest journal, task recovery notes, and worktree diff.

## Goal

Implement a first-class `csm-autoresearch` skill with a separate dependency-free evaluator helper. Support registered functions, trusted local source, and generated source through explicit privilege tiers; deterministic metrics and hard gates; provider-neutral LLM proposals and advisory judging with deterministic stubs; configurable proposal batches up to 50; target and hill-climb modes; durable provenance; promotion/rollback; and staged population search.

## Acceptance Criteria

1. Skill contracts, source, payload, README, package tests, and Makefile integration are synchronized.
2. Helper protocol is bounded JSONL with explicit status, provenance, cleanup, and fail-closed behavior.
3. Registered/trusted modes work; generated mode only works with a verified sandbox provider.
4. Deterministic baseline/target/hill-climb loop and append-only ledger work with resume and quarantine.
5. LLM adapters are provider-neutral, stub-first, bounded, advisory, blinded, and `DEF-EVAL` gated.
6. Population search and promotion/rollback preserve hard gates and lineage.
7. Focused, security, integration, package, and repository checks pass; independent review has no unresolved critical finding.

## Current-State Evidence

- Source approach: `.agents/approaches/2026-08-23-autoresearch-evaluator-csm-approach.md`.
- Research: `.agents/research/2026-08-23-llm-hill-climbing-autoresearch-skill-research.md`.
- Registry: `scripts/lib/contracts.mjs`; payload: `scripts/pack-bootstrap.mjs`; tests: `tests/integration/bootstrap-flow.test.mjs`, `tests/package-audit.test.mjs`, `tests/protocol/protocol.test.mjs`.
- Precedents: `csm-ddd`, `csm-make-tests`, `csm-browse/lib/security.mjs`, `csm-browse/lib/docker.mjs`, `csm-upload/scripts/upload.mjs`.
- `DEF-EVAL` remains open at `.agents/docs/deferred.md:37-44`; live providers stay disabled until explicit resolution.

## Assumptions And Decisions

| ID | Statement | Type | Status |
| --- | --- | --- | --- |
| D001 | Skill identity is `csm-autoresearch`. | Planning assumption | accepted |
| D002 | CSM orchestration and evaluator helper are separate layers. | User decision | accepted |
| D003 | Trust modes are registered, trusted-local-source, and generated-source. | User decision | accepted |
| D004 | Mutations are restricted to declared callables/evolution regions. | User decision | accepted |
| D005 | Deterministic hard gates outrank LLM judges. | User decision | accepted |
| D006 | Proposal ceiling is configurable, maximum 50. | User decision | accepted |
| D007 | Target and hill-climb modes are required. | User decision | accepted |
| D008 | Population search activates after measured stagnation. | User decision | accepted |
| D009 | Live LLM and generated-source enablement remain explicit gates. | Repository/safety constraint | open |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R001 | Can the deterministic and stub-only implementation pass its focused gates? | `make test-autoresearch`, serial Node 22 bootstrap/package tests, and `node scripts/check-suite.mjs`. | Synthetic fixtures, no credentials/live providers; checks ran in the isolated worktree. | 49 autoresearch tests, 50 bootstrap/resume tests, and 1017 conformance checks pass. | Deterministic/stub mode is verified; generated/live gates remain separate blockers. |
| R002 | Is generated-source containment available? | `node csm-autoresearch/scripts/probe-sandbox.mjs --required`. | Probe only; no candidate execution. | Returns `sandbox_unavailable` and exits nonzero. | Generated mode remains blocked and never falls back to ordinary subprocess. |

## Discovered Requirements

- Register all contracts and every `NEVER_INVOKE` row/column.
- Regenerate payload/index and README matrix; never hand-edit generated payload.
- Update hard-coded shipped-skill lists/counts and add `test-autoresearch` to `Makefile` and `test`.
- Use dependency-free Node, argument arrays, bounded output, process cleanup, secure temp paths, atomic artifacts, and redacted provenance.
- Generated sandbox must fail closed when unavailable; skipped security E2E is not success.
- Persist `.agents/autoresearch/<date>-<run-id>-ledger.jsonl` and atomic report/manifest.

## Design

The CSM skill owns orchestration, state, proposals, selection, approvals, ledger, and promotion. The helper owns protocol, candidate execution, metrics, resource controls, and provider boundaries. Use versioned JSONL over stdin/stdout, with candidate output separate from helper protocol output. Default LLM mode is deterministic stub; live mode requires `DEF-EVAL` resolution, injected adapter, credentials, budgets, and explicit egress policy.

## Execution Graph

```text
T001 contracts -> T002 helper -> T003 registered/trusted providers
                       \-> T004 sandbox gate
T003 -> T005 deterministic loop -> T006 LLM adapters -> T007 population/promotion
T008 integration/security tests -> T009 packaging -> T010 independent review/final gates
```

## Numbered Plan

1. [completed] Define contracts, schemas, trust policies, artifact format, and complete `csm-autoresearch/SKILL.md`.
   - Task ID: T001
   - Depends on: none
   - Risk: high
   - Owned scope: `csm-autoresearch/SKILL.md`, `csm-autoresearch/schemas/**`, `scripts/lib/contracts.mjs`, contract tests.
   - Not in scope: runtime, providers, payload, README, live LLM.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/contracts.test.mjs`.
   - Recovery note: completed; 5 contract tests passed, no commit yet because package integration is pending.

2. [completed] Implement bounded JSONL helper core.
   - Task ID: T002
   - Depends on: T001
   - Risk: high
   - Owned scope: `csm-autoresearch/lib/protocol/**`, `csm-autoresearch/lib/runtime/**`, `csm-autoresearch/scripts/evaluate.mjs`, protocol/runtime tests.
   - Not in scope: provider-specific sandbox, LLM, population, packaging.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/protocol.test.mjs csm-autoresearch/test/runtime.test.mjs`.
   - Recovery note: completed; 6 helper tests passed.

3. [completed] Add registered and trusted-local providers.
   - Task ID: T003
   - Depends on: T002
   - Risk: high
   - Owned scope: `csm-autoresearch/lib/providers/registered.mjs`, `trusted-local.mjs`, provider tests.
   - Not in scope: generated provider, live LLM, dependency installation.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/providers.test.mjs`.
   - Recovery note: completed; 3 provider tests passed; trusted-local remains non-hostile by policy.

4. [blocked] Select, prove, and implement generated-source sandbox gate.
   - Task ID: T004
   - Depends on: T002
   - Risk: critical
   - Owned scope: generated provider, sandbox probe/policy, containment tests.
   - Not in scope: fallback to ordinary subprocess or universal safety claims.
   - Acceptance signal: `node csm-autoresearch/scripts/probe-sandbox.mjs --required` and `node --test --test-concurrency=1 csm-autoresearch/test/generated-sandbox.test.mjs`; unavailable capability must fail closed.
   - Recovery note: probe returned `sandbox_unavailable` exit 1; resume only after an approved provider and capability evidence exist.

5. [completed] Implement deterministic optimizer and append-only ledger.
   - Task ID: T005
   - Depends on: T001, T002, T003
   - Risk: standard
   - Owned scope: `csm-autoresearch/lib/optimizer/**`, `lib/ledger/**`, optimizer/ledger tests.
   - Not in scope: live LLM, population, generated-source enablement.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/optimizer.test.mjs csm-autoresearch/test/ledger.test.mjs`.
   - Recovery note: completed; 4 optimizer/ledger tests passed.

6. [completed] Add provider-neutral LLM proposer, qualitative evaluator, and advisory judge.
   - Task ID: T006
   - Depends on: T001, T005
   - Risk: high
   - Owned scope: `csm-autoresearch/lib/llm/**`, stub fixtures, judge tests.
   - Not in scope: vendor SDK, default network, secrets, judge override, silent `DEF-EVAL` resolution.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/llm-adapter.test.mjs csm-autoresearch/test/judge.test.mjs`.
   - Recovery note: completed stub-only; 4 LLM tests passed; live mode remains gated by `DEF-EVAL`.

7. [completed] Add staged population archive, promotion, and exact rollback.
   - Task ID: T007
   - Depends on: T005, T006
   - Risk: standard
   - Owned scope: `csm-autoresearch/lib/population/**`, population tests.
   - Not in scope: evaluator co-evolution, unrestricted self-modification, production deployment.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/population.test.mjs`.
   - Recovery note: completed; 3 population tests passed.

8. [completed] Add cross-component security and integration tests.
   - Task ID: T008
   - Depends on: T001-T007
   - Risk: high
   - Owned scope: `csm-autoresearch/test/integration.test.mjs`, integration fixtures, security runner wiring.
   - Not in scope: unit tests owned by T001-T007, production fixes, skipped-E2E acceptance.
   - Acceptance signal: `cd csm-autoresearch && node --test --test-concurrency=1 test/integration.test.mjs`.
   - Recovery note: completed; 6 integration tests passed; generated-source remains unavailable by design.

9. [completed] Integrate contracts, payload, README, Makefile, package tests, and installed helper smoke test.
   - Task ID: T009
   - Depends on: T001-T008
   - Risk: high
   - Owned scope: `scripts/pack-bootstrap.mjs`, README/indices, Makefile, hard-coded package tests, generated payload.
   - Not in scope: unrelated concurrent edits, release publication, manual generated-file edits.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs && node scripts/check-suite.mjs && node --test tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs && make test-autoresearch`.
   - Recovery note: completed; payload pack/audit and serial package tests passed; bootstrap test target now serializes pack-mutating tests.

10. [blocked] Perform independent security/evaluator review and final verification.
   - Task ID: T010
   - Depends on: T004, T006, T008, T009
   - Risk: high
   - Owned scope: review evidence and plan completion records.
   - Not in scope: self-approval, bypassing failed security evidence, deployment, unrelated changes.
   - Acceptance signal: `make check && make test` plus independent review with no unresolved critical finding; unresolved sandbox/`DEF-EVAL` gates produce BLOCKED.
   - Recovery note: prior review repairs pass; task remains blocked until T004 sandbox and T006 live-LLM gates are resolved and a fresh independent review passes.

## Verification Strategy

Run targeted contract/runtime/provider tests first, then optimizer/LLM/population tests, then integration/security tests, then package/bootstrap tests, then `make check` and `make test`. Required containment tests must fail on skipped/unavailable security infrastructure. Live LLM tests remain offline/stubbed unless `DEF-EVAL` is explicitly resolved.

## Risks And Recovery

- Generated-source escape, evaluator compromise, missing cleanup, or resource exhaustion blocks T004.
- Open `DEF-EVAL` blocks live mode but not deterministic stub mode.
- Payload/README/contract drift is fixed by regeneration, never hand edits.
- Concurrent changes in the main checkout are never reverted or staged.

## Critique Resolution

Independent plan critique required: resolve ownership, provider selection, packaging smoke, Makefile integration, persistence, promotion/rollback, and `DEF-EVAL` semantics before marking tasks complete.

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-24T02:00:00Z | 0 | RECOVER -> VALIDATE | none | Isolated worktree created; execution copy restored; unrelated main changes preserved. | VALIDATE |
| 2026-08-24T02:10:00Z | 0 | VALIDATE -> DISPATCH | T001 | Worktree clean aside from plan; Node/package and repository contract surfaces match plan. | DISPATCH |
| 2026-08-24T02:20:00Z | 0 | DISPATCH complete | T001 | T001 files integrated; focused contract suite: 5 passed, 0 failed; next task T002. | DISPATCH |
| 2026-08-24T02:45:00Z | 0 | CHECKPOINT | T002,T003,T004 | T002 helper tests 6 passed; T003 provider tests 3 passed; T004 tests 3 passed but required probe returned sandbox_unavailable, so generated-source mode is BLOCKED without fallback. | SELECT |
| 2026-08-24T03:10:00Z | 0 | CHECKPOINT | T005,T006,T007,T008 | Optimizer/ledger 4 passed; LLM 4 passed offline; population 3 passed; integration 6 passed. T004 remains blocked; next task T009. | DISPATCH |
| 2026-08-24T03:35:00Z | 0 | CHECKPOINT | T009 | `node scripts/check-suite.mjs` passed with 13 skills/1017 checks; serial Node 22 package/audit/protocol tests passed 7; `make test-autoresearch` passed 34; next task T010. | SELECT |
| 2026-08-24T03:55:00Z | 0 | REPAIR | T002,T003,T005,T007,T009,T010 | Independent reviews found hidden-gate ordering, resume/ledger/schema/provenance defects, trusted-local cleanup risk, self-attested sandbox metadata, rollback/archive gaps, Makefile syntax, and missing manifest governance. | REPAIR |
| 2026-08-24T04:20:00Z | 0 | BLOCKED | T004,T006,T010 | 49 autoresearch tests, serial Node 22 package/bootstrap tests, plan-resume tests, and 1017-check conformance pass. Generated provider remains unavailable without host-owned sandbox capability; live LLM remains blocked by open DEF-EVAL. | BLOCKED |

## Completion Review

Completion gate reached for the deterministic and stub-only implementation, but overall completion is blocked. Verified: 49 autoresearch tests pass; serial Node 22 package/bootstrap suite passes; plan-resume suite passes; `node scripts/check-suite.mjs` passes with 13 skills and 1017 checks; generated-source probe fails closed; live LLM adapters are deterministic stubs. Remaining user/provider decisions: approve and configure a host-owned sandbox provider, and explicitly resolve/scope `DEF-EVAL` with provider/credential/egress policy. Implementation is committed in the isolated worktree but not merged or pushed from this session.
