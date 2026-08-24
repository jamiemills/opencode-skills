format: csm-plan/1

# DDD And Clean-Code CSM Gates Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: planning in progress; shared orchestration skill behavior and applicability gates require independent review.

## Control

- Plan ID: ddd-clean-code-csm-gates
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24T11:00:00Z — VERIFY complete; plan has one canonical structure, seven pending tasks, strict applicability contract, explicit DDD/clean-code boundaries, and runnable acceptance signals.
- Last model/run: gpt-5.6-luna / csm-plan-ddd-clean-code-gates
- Next transition: NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Control, latest journal, all task recovery notes, discovered requirements, and working-tree diff.

## Goal

Plan the smallest implementation that augments `csm-plan` and `csm-build` so meaningful new work receives DDD and clean-code guidance during design, while simple scripts and small changes remain lightweight. The augmentation must be evidence-based, applicability-gated, actionable without becoming a generic style lecture, compatible with existing csm-ddd artifacts, and verified by deterministic tests for both warranted and non-warranted paths.

## Acceptance Criteria

1. A meaningful-work gate classifies work using observable signals and routes warranted work through DDD/clean-code design checks without imposing them on trivial changes.
2. `csm-plan` records the gate decision, DDD/clean-code obligations, evidence, and unresolved design risks in its durable plan.
3. `csm-build` consumes those obligations, verifies design/invariant/boundary evidence before implementation and at review/checkpoint stages, and does not silently redesign scope.
4. Existing csm-ddd report/graph artifacts are consumed as hypotheses with run-ID validation, confidence, seams, rollback options, and observable-behavior constraints.
5. Clean-code guidance is operationalized as small, reviewable design signals and acceptance checks rather than subjective “looks clean” claims.
6. Simple script/change paths remain fast and do not require DDD artifacts or heavyweight design ceremonies.
7. Skill contract, behavior tests, plan/build corpus checks, and documentation are updated with no implementation started during this planning run.

## Current-State Evidence

- `csm-plan/SKILL.md` is planning-only and currently supports optional csm-ddd artifact intake only when explicitly referenced: `csm-plan/SKILL.md:122-128`.
- `csm-build/SKILL.md` currently validates referenced DDD artifacts during RECOVER and carries seam constraints into dispatched tasks, but does not define a general applicability gate or clean-code design checkpoint: `csm-build/SKILL.md:109-123,142-160,204-225`.
- `csm-ddd/SKILL.md` defines hypothesis statuses, basis/confidence separation, seams, rollback options, observable behavior, shared run IDs, and report/graph contracts: `csm-ddd/SKILL.md:33-53,98-125,129-168`.
- Existing DDD research: `.agents/research/2026-08-22-ddd-repo-analysis-refactoring-research.md`.
- Existing DDD artifacts: `.agents/ddd/2026-08-23-opencode-skills-ddd-report.md` and `.agents/ddd/2026-08-23-opencode-skills-ddd-graph.json`.
- Existing csm-ddd intake plan precedent: `.agents/plans/2026-08-23-csm-plan-build-ddd-intake-csm.md`.
- Existing CSM conventions require plans to carry runnable acceptance signals and builds to preserve plan evidence, review, repair, and checkpoint state: `csm-plan/SKILL.md:159-195`; `csm-build/SKILL.md:166-249`.
- Current worktree contains unrelated tracked and untracked changes; no source changes will be made during planning.
- No authentic `NORMS.md` was found.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D001 | DDD and clean-code guidance is conditional, not mandatory for every request. | User-dictated | User explicitly excludes simple scripts/changes. | accepted |
| D002 | The applicability decision should be made during planning and persisted for build recovery. | Planning decision | Research recommends a durable plan-level decision with task-level slices for mixed plans. | accepted |
| D003 | csm-ddd artifacts remain hypotheses, never proof. | Repository contract | `csm-ddd/SKILL.md:40-53`; existing DDD intake plan. | accepted |
| D004 | Clean-code principles must become observable design/review signals, not a subjective score. | Planning constraint | Avoids ceremony and unverifiable style claims. | accepted |
| D005 | Simple work must retain the current lightweight plan/build path. | User-dictated | Explicit user requirement. | accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R001 | Where can conditional design gates fit without changing state machines? | Read-only inspection of csm-plan/csm-build/csm-ddd and plan-validation. | No writes, installs, builds, tests, services, or Git mutation. | Best seams are plan INTAKE/DRAFT/VERIFY and build RECOVER/VALIDATE/DISPATCH/VERIFY/REVIEW/CHECKPOINT; no new top-level state is needed. | Add conditional obligations inside existing states and preserve current template/state contracts. |
| R002 | How should meaningful work be classified? | Read-only DDD research/artifact and repository evidence review. | No target execution or mutation. | Risk-first signals are explainable: boundaries, contracts, ownership, invariants, persistence, side effects, migration, rollback, coordination, or explicit architecture/refactor; line/file count is not sufficient. | Implement a small pure classifier with lightweight bypass and matched-signal evidence. |
| R003 | Which clean-code principles can be enforced objectively? | Read-only inspection of csm-review-python, csm-scan metrics, csm-make-tests, and review findings. | No source changes or tool installs. | Mechanical checks can cover lint/type/errors, complexity/coupling/duplication diff-scoped, test wiring, and artifact sync; responsibility/naming/abstraction/context quality remain evidence-based review prompts. | Separate hard gates from heuristic review questions; do not create a clean-code score. |
| R004 | What tests prove both warranted and trivial paths? | Read-only inspection of resume/check-suite/csm-ddd tests and existing DDD intake plan. | No tests run; no writes. | Add pure classifier/obligation fixtures, plan/build propagation fixtures, matching/mismatched DDD run IDs, missing obligations, and explicit lightweight bypass cases. | Reuse existing validators and plan corpus tests; preserve legacy plans. |

## Discovered Requirements

- Do not add a new top-level state to either skill; existing plan/build state chains and corpus validators are strict.
- Add a small machine-readable applicability block inside existing plan sections, preserving legacy plans that lack it.
- Use a risk-first classifier with explicit opt-in override, lightweight bypass rationale, and mixed-scope task lists; do not use LOC/file count or weighted scores.
- High-consequence signals include boundary, public contract, persistence/ownership, invariant/consistency, external side effect, migration/rollback, coordination, and explicit architecture/refactor intent.
- DDD report/graph artifacts remain optional, explicitly referenced, schema/run-ID validated, and hypothesis-bearing; `not_detected` or capped coverage is not proof of absence.
- For warranted work, obligations must cover relevant boundary/ownership, contract, invariant, observable behavior, seam, parity, rollback/recovery, and unresolved risks.
- Clean-code enforcement must separate mechanical evidence from heuristic review prompts; no universal clean-code score or arbitrary complexity threshold.
- `csm-build` consumes and verifies plan obligations; it must not silently redesign a deficient plan or reclassify warranted work as lightweight.
- Source skill edits require payload synchronization; no contract or never-invoke changes are needed because this augments existing skills.
- Simple work must record a cheap explicit exemption and retain current acceptance flow.

## Design

### Applicability contract

New plans add exactly one `### Applicability` block under `## Current-State Evidence`, containing one fenced JSON object with `format: csm-applicability/1`. The parser rejects duplicate blocks, unknown keys, invalid enum values, duplicate signal/obligation IDs, and malformed JSON. Legacy plans without the block remain valid and retain the existing lightweight path.

```json
{
  "format": "csm-applicability/1",
  "decision": "lightweight|warranted|mixed",
  "mode": "risk-first|explicit-opt-in|lightweight-bypass",
  "matchedSignals": [],
  "evidence": [{"source": "brief|plan|repository|ddd", "locator": "relative citation", "observation": "..."}],
  "obligations": [{"id": "boundary", "status": "required|satisfied|missing|not_applicable|unverified"}],
  "taskApplicability": {"warranted": [], "lightweight": []},
  "dddArtifacts": [],
  "unresolvedRisks": [],
  "bypass": {"requested": false, "rationale": null}
}
```

Signal precedence is deterministic: explicit DDD/architecture/refactor request or any high-consequence signal yields `warranted`; different task-level results yield `mixed`; no signals yields `lightweight`; `lightweight-bypass` is allowed only when no high-consequence signal matches and the rationale identifies why an apparent signal is non-operative. Signals are enumerated: `boundary_change`, `public_contract`, `ownership_or_persistence`, `invariant_or_consistency`, `external_side_effect`, `migration_or_rollback`, `cross_boundary_coordination`, `architecture_or_refactor`, and `security_or_authority`. LOC and file count are never signals.

Compatibility matrix: legacy plan with no block uses existing behavior; new `lightweight` plan records an exemption and uses existing behavior; new `warranted`/`mixed` plan requires obligations; malformed block is a plan validation error; missing obligations route `csm-build` to REPAIR/BLOCKED; explicit bypass is accepted only with valid rationale and no high-consequence signal.

### Planning behavior

`csm-plan` classifies applicability during INTAKE/DISCOVER, records evidence in Current-State Evidence and the Applicability block, converts matched signals into obligations during DRAFT, and verifies completeness during VERIFY. It may consume explicitly referenced csm-ddd artifacts but never silently invoke csm-ddd or treat its hypotheses as facts. A DDD graph is machine input; the Markdown report is validated only at its declared format/run-ID envelope because the shipped graph validator does not parse Markdown reports.

### Build behavior

`csm-build` validates the persisted applicability block during RECOVER/VALIDATE, checks explicitly referenced DDD graph/report paths, formats, relative paths, shared `runId`/`graphRunId`, claim status/basis/confidence, and coverage gaps, propagates relevant obligations into DISPATCH prompts, and rechecks boundary/invariant/observable/rollback evidence during VERIFY/REVIEW/CHECKPOINT. Missing required obligations route to REPAIR or BLOCKED; the build never silently redesigns scope. `context_hypothesis`, `inferred`, `unverified`, and `not_detected` claims remain hypotheses or bounded gaps.

### Clean-code signal classes

- Mechanical: repository-configured formatter/linter/type checks, diff-scoped complexity/coupling/duplication diagnostics when the repository exposes them, test wiring, artifact/schema synchronization, and repository gates. These are mandatory only when configured and are reported as evidence, not universal thresholds.
- Evidence obligations: responsibility/owner, dependency direction, side effects, error behavior, test seam, invariant, and rollback rationale.
- Heuristic review prompts: naming/domain language, cohesion, abstraction necessity, comment intent, and whether the design is understandable. These require cited rationale, not an automated score.

## Execution Graph

```text
T001 applicability/obligation validator
       |\
       | +--> T002 csm-plan guidance
       | +--> T003 csm-build guidance
       v
T004 plan/build/DDD compatibility tests
       v
T005 README/documentation guidance
       v
T006 payload + corpus integration
       v
T007 independent review and final gates
```

T001 is the critical contract. T002/T003 can be edited in parallel after its shape is fixed. T004 depends on all behavioral changes and owns tests only. T005 is documentation-only. T006 is serialized shared/generated integration. T007 is independent review and final verification.

## Numbered Plan

1. [pending] Add a strict applicability and obligation validator.
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (shared plan/build contract)
   - Owned scope: `scripts/lib/plan-validation.mjs`, new focused validator module if needed, and `tests/plan-applicability.test.mjs` with synthetic fixtures.
   - Not in scope: skill prose, DDD analyzer changes, production code, universal clean-code scoring, or existing plan rewrites.
   - Spike candidate: None; the contract is fixed to one fenced JSON object under `## Current-State Evidence` / `### Applicability`, format `csm-applicability/1`.
   - Actions: Implement pure validation/classification for the enumerated signals, deterministic precedence, `lightweight`/`warranted`/`mixed` decisions, explicit opt-in, lightweight bypass, task applicability, obligation IDs/statuses, DDD artifact references, evidence records, reclassification history, and malformed/missing states. Preserve existing plan-validation enums and legacy documents.
   - Acceptance signal: `node --test --test-concurrency=1 tests/plan-applicability.test.mjs` passes trivial, meaningful, explicit, mixed, malformed, legacy, duplicate-block, unknown-key, and missing-obligation fixtures.
   - Validation: `node --test --test-concurrency=1 tests/resume-semantics.test.mjs` remains green; validator rejects warranted plans missing required obligations and accepts explicit lightweight bypasses only when no high-consequence signal matches.
   - Acceptance evidence: fixture matrix, decision records, failure messages, and compatibility results.
   - Repair attempts: 0
   - Recovery note: inspect parser/fixtures first; preserve legacy plan behavior if partial edits exist.

2. [pending] Augment `csm-plan` with conditional DDD and clean-code design guidance.
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (planning contract and user workflow)
   - Owned scope: `csm-plan/SKILL.md` only.
   - Not in scope: csm-build changes, DDD analyzer changes, mandatory DDD for simple work, or implementation.
   - Spike candidate: None; use existing plan sections and avoid a new top-level H2/state.
   - Actions: Add INTAKE/DISCOVER applicability decision rules; define the strict JSON Applicability block, signal precedence, explicit opt-in, lightweight bypass, and mixed-scope handling; require DDD evidence register and obligation mapping for warranted work; separate named repository-configured mechanical checks from heuristic clean-code prompts; require evidence/rollback/parity for boundary changes; add VERIFY obligations without changing state chain.
   - Acceptance signal: `node scripts/check-suite.mjs` passes with the updated skill structure and plan template.
   - Validation: `node --test --test-concurrency=1 tests/plan-applicability.test.mjs tests/resume-semantics.test.mjs` passes; simple and meaningful examples are explicitly documented.
   - Acceptance evidence: updated skill sections, template block, and applicability examples.
   - Repair attempts: 0
   - Recovery note: compare changed prose against existing state-machine/required-template sections before resuming.

3. [pending] Augment `csm-build` to consume and enforce conditional obligations.
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (execution gate and scope integrity)
   - Owned scope: `csm-build/SKILL.md` only.
   - Not in scope: new build states, automatic csm-ddd invocation, silent architecture redesign, or mandatory ceremony for lightweight plans.
   - Spike candidate: None; integrate at existing RECOVER/VALIDATE/DISPATCH/VERIFY/REVIEW/CHECKPOINT seams.
   - Actions: Validate applicability and obligations during RECOVER/VALIDATE; validate explicitly referenced DDD graph JSON plus report format/run-ID envelope, relative paths, claim status/basis/confidence, and coverage gaps; propagate relevant seam/invariant/rollback evidence into DISPATCH; verify evidence and reclassification history during VERIFY/REVIEW/CHECKPOINT; route missing evidence to REPAIR/BLOCKED. Add a transition matrix: legacy/lightweight -> existing flow; warranted/mixed complete -> SELECT/DISPATCH; malformed/missing obligations -> REPAIR; invalid DDD pair or unverified boundary evidence -> BLOCKED; no dispatch occurs before VALIDATE passes.
   - Acceptance signal: `node scripts/check-suite.mjs` passes with updated build machine guidance and no new state-chain violations.
   - Validation: behavioral fixtures from T004 prove warranted missing obligations block/repair and lightweight plans proceed.
   - Acceptance evidence: updated build checkpoints, DDD propagation rules, and explicit no-redesign boundary.
   - Repair attempts: 0
   - Recovery note: preserve existing csm-build execution semantics; inspect shared task prompts before resuming.

4. [pending] Add plan/build/DDD compatibility and regression tests.
   - Task ID: T004
   - Depends on: T001, T002, T003
   - Parallel group: G3
   - Risk: standard (workflow compatibility)
   - Owned scope: `tests/plan-applicability.test.mjs`, `tests/resume-semantics.test.mjs`, `tests/check-suite.test.mjs` additions, and synthetic DDD consumer fixtures only.
   - Not in scope: changes to csm-ddd production code, broad repository test generation, or modifying unrelated existing plans.
   - Spike candidate: None; reuse existing temp-corpus and DDD contract fixtures.
   - Actions: Test trivial bypass, meaningful trigger, explicit opt-in, mixed-scope slices, missing obligations, matching/mismatched DDD run IDs, report/graph format envelopes, hypothesis status preservation, capped/unverified coverage, rollback absence, build reclassification, transition routing, and checkpoint drift. Add empty/no-seam DDD fixtures proving no synthetic seam or rollback evidence is created.
   - Acceptance signal: `node --test --test-concurrency=1 tests/plan-applicability.test.mjs tests/resume-semantics.test.mjs tests/check-suite.test.mjs` passes.
   - Validation: `node --test --test-concurrency=1 csm-ddd/test/contracts.test.mjs` passes; `node scripts/check-suite.mjs` rejects planted incomplete meaningful plans and accepts lightweight fixtures.
   - Acceptance evidence: deterministic fixture outputs and explicit pre-existing failure handling.
   - Repair attempts: 0
   - Recovery note: compare fixture corpus against plan-validation changes; do not alter production artifacts to make tests pass.

5. [pending] Document the conditional DDD/clean-code workflow and examples.
   - Task ID: T005
   - Depends on: T002, T003
   - Parallel group: G4
   - Risk: low (documentation)
   - Owned scope: relevant `README.md` deep-dive/lifecycle guidance and `.agents/README.md` only if a new plan artifact must be indexed.
   - Not in scope: new top-level README sections, generic style manifesto, or changing existing skill counts unless required by the implementation.
   - Spike candidate: None.
   - Actions: Explain lightweight versus meaningful paths; show csm-scan/csm-ddd -> csm-grill/csm-plan -> csm-build composition; identify DDD/clean-code obligations for boundary work; show simple script bypass; explain csm-make-tests and csm-review roles.
   - Acceptance signal: `node scripts/gen-readme-matrix.mjs --check && node scripts/check-suite.mjs` passes and README preserves existing H2 order.
   - Validation: inspect progressive disclosure from overview to deep dive; verify no claim makes DDD mandatory for trivial work.
   - Acceptance evidence: README diff and section/order check.
   - Repair attempts: 0
   - Recovery note: regenerate only generated matrix regions; preserve concurrent README changes.

6. [pending] Synchronize payloads and run the complete repository gates.
   - Task ID: T006
   - Depends on: T001, T002, T003, T004, T005
   - Parallel group: G5
   - Risk: standard (generated artifacts and public skill behavior)
   - Owned scope: generated payload copies of csm-plan/csm-build, `bootstrap/payload-index.json`, and gate baseline only as generated by repository tooling.
   - Not in scope: unrelated concurrent modifications, hand-editing generated payload, or fixing pre-existing deferred findings.
   - Spike candidate: None.
   - Actions: Regenerate payload from source, run plan corpus/check-suite/test bootstrap gates with Node 22, record baseline count changes, and verify only intended source/payload/docs/tests are included.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs && node scripts/gen-readme-matrix.mjs --check && node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/plan-applicability.test.mjs tests/resume-semantics.test.mjs tests/check-suite.test.mjs csm-ddd/test/contracts.test.mjs && node scripts/check-suite.mjs` passes.
   - Validation: payload byte/hash audit; `make test-bootstrap` and `make test-ddd` when environment supports them; record unavailable checks explicitly.
   - Acceptance evidence: commands/results, payload hashes, baseline record, and protected-state comparison.
   - Repair attempts: 0
   - Recovery note: regenerate from source after any source change; never stage unrelated worktree changes.

7. [pending] Independently review and verify the augmented planning/build workflow.
   - Task ID: T007
   - Depends on: T004, T005, T006
   - Parallel group: G6
   - Risk: high (shared orchestration behavior)
   - Owned scope: review evidence and final plan/checkpoint records; fixes return to T001-T006.
   - Not in scope: implementation during planning, automatic DDD invocation, or universal clean-code enforcement.
   - Spike candidate: None.
   - Actions: A reviewer who did not author T001-T006 produces a findings table covering false positives/negatives, mixed scopes, legacy plans, DDD hypothesis overclaiming, report/graph validation, subjective clean-code gates, state-machine compatibility, generated payload drift, and evidence propagation. Valid findings return to explicit repair tasks T001-T006; the reviewer never fixes them.
   - Acceptance signal: `node scripts/check-suite.mjs && node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/plan-applicability.test.mjs tests/resume-semantics.test.mjs tests/check-suite.test.mjs csm-ddd/test/contracts.test.mjs` passes with no unresolved high finding and a saved independent findings/resolution table.
   - Validation: final primary review confirms simple work remains lightweight and meaningful work cannot bypass required obligations without recorded rationale.
   - Acceptance evidence: independent critique findings/resolutions, final gate output, and plan completion review.
   - Repair attempts: 0
   - Recovery note: reopen the affected task and record root cause if review finds a material issue.

## Verification Strategy

Run the pure applicability/obligation tests first, then plan/resume/corpus tests, then csm-ddd contract tests, then source/payload/check-suite gates. Use Node 22 for repository test batteries. Tests must include both positive and negative paths: simple work bypasses; meaningful work triggers; missing DDD evidence is not silently upgraded; heuristic clean-code prompts remain review evidence. No new top-level state or mandatory artifact should be accepted by the final gate.

## Risks And Recovery

- False positives create ceremony for simple work: mitigate with explicit lightweight conditions, matched-signal evidence, and mixed-scope handling.
- False negatives miss small but meaningful schema/contract changes: treat public contracts, persistence, invariants, side effects, ownership, and rollback as high-priority signals independent of size.
- DDD hypotheses become false facts: preserve status/basis/confidence/evidence and block only missing validation, not merely missing reports.
- Clean-code checks become subjective scoring: keep mechanical gates and heuristic prompts separate; no universal score.
- Legacy plans break: optional applicability block and backward-compatible validator path preserve existing plan corpus.
- Build redesigns deficient plans: route to REPAIR/BLOCKED and require a new plan decision.
- Payload or README drift: regenerate and run check-suite; do not hand-edit generated files.
- Existing dirty worktree changes: preserve and stage only plan-owned implementation files during a later build.
- Misclassified or partially executed work: preserve the previous applicability block and plan commit, invalidate the current decision, route to REPAIR/BLOCKED, and require a new recorded decision before dispatch resumes.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| Draft contained duplicated tail sections and was not resumable. | critical | Removed duplicate sections; one required-document structure and one journal remain. | Primary verification of draft headings and journal. |
| Applicability syntax/parser was undefined. | critical | Fixed one fenced JSON `csm-applicability/1` block, strict keys/enums/duplicate handling, exact location, and legacy fallback. | T001 and Design contract. |
| Meaningful-work signals lacked deterministic precedence. | high | Enumerated signals, explicit opt-in, high-consequence precedence, bypass restriction, mixed-scope behavior, and golden fixtures. | Research track and T001/T004. |
| DDD artifacts could be overclaimed or report parsing assumed incorrectly. | high | Require graph JSON plus report format/run-ID envelope; preserve status/basis/confidence/coverage gaps; empty/capped graphs produce no synthetic seams. | DDD research track and T003/T004. |
| Clean-code acceptance remained subjective. | high | Split configured mechanical evidence, design obligations, and cited heuristic review prompts; prohibit clean-code scores/universal thresholds. | Clean-code research track and Design. |
| Legacy/build transition behavior was ambiguous. | high | Added compatibility matrix and explicit transition routing; no dispatch before VALIDATE. | T001/T003/T004. |
| Review task could self-certify and acceptance was too narrow. | major | T007 requires an independent findings table, repair return paths, and full selected plan/DDD/corpus commands. | T007. |
| Generated payload/README ownership and recovery were underspecified. | major | T005 owns docs, T006 owns generated integration serially, with explicit generator outputs and protected-state evidence. | T005/T006. |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-24T09:20:00Z | 0 | INTAKE -> DISCOVER | none | User brief classified as large, open applicability/design work; current CSM and DDD evidence loaded. | DISCOVER |
| 2026-08-24T09:45:00Z | 0 | DISCOVER -> RESEARCH | none | Four read-only scouts completed; risk-first gate, DDD propagation, clean-code signal split, and tests mapped. | RESEARCH |
| 2026-08-24T10:00:00Z | 0 | RESEARCH -> DRAFT | none | Three research tracks synthesized into a pure validator plus conditional prose/gate changes. | DRAFT |
| 2026-08-24T10:30:00Z | 0 | DRAFT -> CRITIQUE | none | Draft complete with seven pending tasks, strict JSON contract, deterministic signals, legacy compatibility, and explicit DDD/clean-code evidence classes. | CRITIQUE |
| 2026-08-24T10:40:00Z | 0 | CRITIQUE -> REMEDIATE | none | Independent critique found duplicate draft sections, undefined parser/signal semantics, DDD report-validation overreach, subjective clean-code gates, legacy ambiguity, and weak review/integration acceptance. | REMEDIATE |
| 2026-08-24T10:45:00Z | 0 | REMEDIATE -> VERIFY | none | All critique findings resolved in the single canonical draft; no implementation started. | VERIFY |
| 2026-08-24T11:00:00Z | 0 | VERIFY complete | none | Primary verification passed: seven pending tasks, exact JSON contract, compatibility matrix, objective/heuristic split, DDD hypothesis preservation, and full acceptance commands are present. | SAVED |

## Completion Review

Primary verification complete: the plan has exactly one required document structure, all seven implementation tasks remain pending, every task has dependency/risk/owned scope/anti-scope/spike/acceptance/validation/evidence/recovery fields, DDD claims remain hypotheses, simple-work bypass is explicit, no new state-machine state is introduced, and implementation has not started.
