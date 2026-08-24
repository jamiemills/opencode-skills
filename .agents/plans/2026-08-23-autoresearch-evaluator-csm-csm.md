format: csm-plan/1

# Autoresearch Evaluator CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 1 critical task, 6 high-risk tasks, and 3 standard tasks. T002, T004, T006, T008, T009, and T010 always require independent review; generated-source enablement is blocked without containment evidence.

## Control

- Plan ID: autoresearch-evaluator-csm
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-24T01:40:00Z — VERIFY complete; ownership, provider, packaging, persistence, promotion, and DEF-EVAL corrections personally checked.
- Last model/run: gpt-5.6-luna / csm-plan-autoresearch-evaluator-csm
- Next transition: NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none for planning; implementation blockers are explicit in D009 and T004/T006.
- Resume: re-read Control, the latest journal row, every non-complete task Recovery note, Discovered Requirements, and the working-tree diff.

## Goal

Implement one first-class `csm-autoresearch` skill and a separate dependency-free evaluator helper for LLM-guided hill climbing over declared callables or evolution regions. Support registered functions, trusted local source, and generated source through explicit privilege tiers; deterministic numeric metrics and hard gates; provider-neutral LLM proposals and advisory qualitative judging; configurable proposal batches up to 50; target and incumbent-improvement modes; durable trial provenance; human-approved promotion; and population search only after measured stagnation.

The implementation must preserve evaluator authority outside candidate control, fail closed when required sandbox capabilities are unavailable, keep live LLM calls disabled by default, and never modify unrelated repository files or silently alter evaluator/test/policy ownership.

## Acceptance Criteria

1. `csm-autoresearch` is a registered, installable CSM skill with synchronized source, contracts, README matrix, bootstrap payload, and hard-coded package-test expectations.
2. The evaluator helper has a versioned bounded JSONL protocol with explicit status, validity, metrics, diagnostics, provenance, cleanup, and artifact semantics.
3. Registered and trusted-source modes execute through approved policies; generated-source mode fails closed unless a verified sandbox provider and containment suite pass.
4. The deterministic loop supports baseline, target, hill-climb, hard gates, held-out validation, retries/quarantine, resume, stopping, and append-only trial records.
5. LLM proposal/judge behavior is provider-neutral, stubbed/offline by default, bounded to 50 proposals, deterministically screened first, advisory only, blinded, calibrated, and routed to review on disagreement.
6. Population archive/island behavior activates only after configured stagnation and cannot bypass deterministic gates or hidden validation.
7. Security, evaluator-integrity, protocol, artifact, and integration tests provide reproducible evidence; all repository gates pass; independent security and evaluator reviews are recorded.

## Current-State Evidence

- Agreed approach: `.agents/approaches/2026-08-23-autoresearch-evaluator-csm-approach.md:13-155`, format `csm-grill/1`, status agreed.
- Research foundation: `.agents/research/2026-08-23-llm-hill-climbing-autoresearch-skill-research.md`, including evaluator-harness sections 8-12 and references R10-R17.
- Skill registration and never-invoke matrix: `scripts/lib/contracts.mjs:1-170,207-373,394-570`.
- Skill discovery and corpus gates: `scripts/check-suite.mjs:500-521,738-894,1343-1469`.
- Bootstrap source/payload synchronization: `scripts/pack-bootstrap.mjs:30-94,113-190`; generated metadata in `bootstrap/payload-index.json`.
- Closest code-bearing skill precedent: `csm-ddd/SKILL.md:14-19,55-65,76-168`; implementation under `csm-ddd/lib/ddd`, `csm-ddd/scripts`, `csm-ddd/schemas`, `csm-ddd/test`.
- Closest subprocess/security precedents: `csm-browse/lib/docker.mjs`, `csm-browse/lib/security.mjs`, `csm-browse/lib/cleanup.mjs`, `csm-upload/scripts/upload.mjs:228-307`, and `csm-scan/lib/scan/shared/command.mjs:165-195`.
- Closest durable-ledger precedent: `csm-make-tests/SKILL.md:38-61,67-82,223-275`.
- Future execution state machine: `csm-build/SKILL.md:97-220`.
- Open live-evaluation decision: `.agents/docs/deferred.md:37-44` (`DEF-EVAL`).
- Current package has no provider/credential convention and no helper binaries: `scripts/pack-bootstrap.mjs:84-93`; root `package.json:10-13` requires Node `>=22 <25`.
- Existing worktree contains unrelated untracked files `.agents/plans/2026-08-23-tackle-remaining-review-findings-csm.draft.md` and `.agents/reviews/2026-08-23-skills-review.md`; preserve them.
- No authentic `NORMS.md` was found.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D001 | New skill directory/name is `csm-autoresearch`. | Plan assumption | Goal and agreed approach; change this single identifier consistently if the user chooses another name before build. | accepted for planning |
| D002 | The skill is an orchestrator and the helper is a separate dependency-free Node runtime. | User-dictated | Agreed approach lines 15,31 and phase briefs. | accepted |
| D003 | Trust modes are explicit: registered, trusted-local-source, generated-source. | User-dictated | Grill decisions and deep-dive research. | accepted |
| D004 | Candidate mutation is limited to registered callables or declared evolution regions. | User-dictated | Agreed approach lines 25,86-90. | accepted |
| D005 | Deterministic hard gates are authoritative; LLM judging is advisory. | User-dictated | Grill decisions and judge research. | accepted |
| D006 | Proposal count is configurable with a maximum of 50; default batch is conservative. | User-dictated plus research | Agreed approach and LLM-judge deep dive. | accepted |
| D007 | Target and incumbent-improvement modes are both required. | User-dictated | Grill decision. | accepted |
| D008 | Population search is activated only after measured stagnation. | User-dictated | Agreed approach lines 34,127-136. | accepted |
| D009 | Core v1 may be deterministic plus stub-only; live provider/judge enablement is separately gated and blocks overall completion if the user has not explicitly lifted/scoped `DEF-EVAL`. | Repository constraint | `.agents/docs/deferred.md:37-44`; current request supplies intent but not provider/credential policy. | build gate |
| D010 | Exact sandbox provider, statistical estimator, judge ensemble, calibration cadence, and thresholds require implementation spikes and independent review. | Research constraint | Research Unverified Claims and approach Open Questions. | accepted |
| D011 | Generated-source mode may ship as a declared fail-closed capability until containment evidence exists. | Safety decision | Scouts found ordinary subprocess/worktree isolation insufficient for hostile code. | accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R001 | Which repository surfaces register a new CSM skill? | Read-only inspection of contracts, check-suite, packer, README generator, package tests, and csm-ddd precedent. | No writes, installs, builds, tests, services, credentials, or Git mutation. | Registry, payload, README, and hard-coded skill lists are coupled. | T001 and T009 own synchronized integration. |
| R002 | What helper architecture fits the repository? | Read-only inspection of existing Node subprocess, temp-dir, security, cleanup, and atomic-publication utilities plus Node/Docker docs. | No runtime experiments; no repository execution. | Dependency-free JSONL helper is feasible; generated-source sandbox capability is unresolved. | T002/T003 separate protocol from providers; T004 blocks unsafe mode. |
| R003 | How can live LLM behavior be planned safely? | Read-only inspection of `DEF-EVAL`, current provider absence, skill boundaries, and LLM-judge research. | No credentials, network, live model calls, or files. | Provider-neutral injected adapters and deterministic stubs are required; `DEF-EVAL` remains open. | T006 is opt-in and gated; default suite is offline. |
| R004 | What security evidence is needed? | Read-only inspection of csm-browse security tests and evaluator findings. | No containment probes run; future probes must use synthetic `/tmp` fixtures only. | Optional E2E can skip; TOCTOU and process-tree limitations remain. | T004/T008/T010 require live evidence and independent review. |

## Discovered Requirements

- New skill registration requires `MANIFEST`, `INTERFACES`, `NEVER_INVOKE`, and possibly `FORMAT_VERSIONS` changes; every existing never-invoke row needs the new column.
- Code-bearing helpers need explicit `pack-bootstrap.mjs` mappings and regenerated payload/index output; generated payload files are never hand-edited.
- README skill count, layout, skill tables, TOC, and generated composition matrix must be synchronized.
- Hard-coded shipped-skill lists/counts must be updated in `tests/integration/bootstrap-flow.test.mjs`, `tests/package-audit.test.mjs`, and `tests/protocol/protocol.test.mjs`.
- Persisted artifacts require format markers, `.agents/README.md` index entries, schema validation, bounded content, redaction, and atomic publication.
- Candidate execution must use argument arrays, allowlisted environments, bounded stdout/stderr/workspace/processes, timeouts, process-group cleanup, and no silent fallback from generated-source sandbox failure.
- Live LLM adapters must be injected, credential-free in stub mode, bounded by timeout/retry/token/cost/response budgets, and excluded from default offline tests.
- Security E2E skips are not release evidence; the generated-source enablement gate must require a controlled environment where containment checks are mandatory.
- `DEF-EVAL` and any sandbox deferral must be updated only through explicit user-approved build decisions; no implementation task may silently mark them resolved.
- The authoritative persistence shape is a versioned append-only JSONL ledger under `.agents/autoresearch/` plus a generated human-readable report/manifest; every artifact is run-ID linked and atomically published.

## Design

### Skill and helper boundary

`csm-autoresearch/SKILL.md` is the CSM orchestration layer. It owns the state machine, proposal/selection policies, approval, ledger orchestration, resume behavior, and human promotion handoff. A dependency-free helper under `csm-autoresearch/lib/` and `csm-autoresearch/scripts/` owns the candidate/evaluator protocol and execution providers. Candidates never control evaluator code, fixtures, acceptance, audit storage, or provider credentials. `SKILL.md` is owned entirely by T001; later tasks change referenced helper/runtime files rather than editing it concurrently.

### Helper protocol

Use versioned newline-delimited JSON over stdin/stdout. Helper stdout is protocol-only; candidate output is captured and bounded separately. Requests carry protocol version, request ID, trust mode, candidate reference, limits, and provenance. Responses carry explicit status, exit details, bounded output metadata, artifacts, provenance, and cleanup result. Malformed, oversized, duplicate, truncated, unsupported, or policy-violating frames fail closed.

### Trust profiles

- Registered function: allowlisted identity and source hash; isolated process may be sufficient only under the approved trusted threat model.
- Trusted local source: pinned revision/evolution region, private workspace, stricter environment and path controls, explicit approval.
- Generated source: requires the provider selected and pinned by T004, with no network, host mounts, credentials, evaluator assets, or unverifiable limits; otherwise `sandbox_unavailable` or `policy_violation` before execution. If no provider is approved, generated mode remains blocked rather than complete.

### Evaluation and optimization

The deterministic path is baseline -> bounded proposal -> schema/static checks -> evaluator trial -> repeated measurement -> hard gates -> held-out validation -> ledger decision. Target mode stops at a declared threshold; hill-climb mode retains a candidate only after a declared improvement margin. LLM proposals and advisory judge outputs enrich selection but cannot override deterministic failure. Population archives and islands are enabled only after recorded stagnation.

### Persistence boundary

The authoritative trial record is append-only JSONL at `.agents/autoresearch/<date>-<run-id>-ledger.jsonl`, with `format: csm-autoresearch-ledger/1` in its first manifest record. A run report/manifest at `.agents/autoresearch/<date>-<run-id>-report.json` links the ledger, evaluator/policy hashes, artifact hashes, and completion status. Writes use bounded temp files, validation, hashing, and same-directory rename; duplicate trial IDs, malformed tails, or incomplete manifests cause recovery/quarantine rather than silent repair.

### LLM boundary

The adapter interface is provider-neutral: `propose(request, budget, policy)` and `judge(request, rubric, budget, policy)`. Stub mode is default and deterministic. Live mode is opt-in, requires an explicit `DEF-EVAL` decision, injected credentials, explicit endpoint/egress policy, bounded budgets, blinded ordinal/pairwise judging, calibration fixtures, disagreement routing, and provenance without secrets. Until that decision exists, the core plan can verify stubs but the overall implementation remains blocked for the live capability.

### Future csm-build control states

The future implementation run must use `RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`, cycling until `COMPLETE` or `BLOCKED`. Generated-source enablement and live LLM enablement are explicit gates within this lifecycle, not assumptions.

## Execution Graph

```text
G1: T001 contracts/schemas
        |
G2: T002 protocol/helper core ---- T003 trusted/registered providers
        |                                  |
        +---- T004 sandbox capability spike/blocker
        |                                  |
G3: T005 deterministic loop/ledger -+--- T006 LLM adapters/judge (conditional)
                                     |
G4: T007 population/promotion -------+

T008 security/protocol tests span T002-T007 but own only test fixtures/tests.
T009 packaging/integration follows all source changes.
T010 independent security/evaluator review follows T008/T009.
```

Safe parallelism: T001 and read-only spike work can begin together; T002 and test-fixture design may overlap after contracts are fixed; T003 and T004 can overlap after the protocol is stable; T008 can proceed by non-overlapping test ownership once interfaces are frozen. T009 and T010 are serial integration/review gates.

## Numbered Plan

1. [pending] Define the `csm-autoresearch` contract, schemas, and trust-policy vocabulary.
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (public interface and security policy)
   - Owned scope: `csm-autoresearch/SKILL.md`, `csm-autoresearch/schemas/**`, `scripts/lib/contracts.mjs` declarations only, and related skill-owned schema tests.
   - Not in scope: candidate execution, provider SDKs, generated payload, README prose, or live LLM calls.
   - Spike candidate: Resolve the exact artifact marker/status fields and validate the ledger/report choice with synthetic schema fixtures in `/tmp` only; the selected persistence shape is append-only JSONL ledger plus atomic JSON report/manifest.
   - Actions: Define the CSM interface, activation boundary, never-invoke behavior, state machine, trust modes, request/response schemas, metric/target/budget contracts, artifact envelope, fail-closed statuses, `DEF-EVAL`/sandbox feature gates, ledger/report schema, run/trial identity, duplicate/replay handling, and corruption recovery. Add contract declarations without hand-editing generated files.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/contracts.test.mjs` passes with valid and invalid fixtures covering all trust modes, statuses, limits, and schema rejection.
   - Validation: `node scripts/check-suite.mjs` reports structural contract consistency; malformed/unknown versions are rejected.
   - Acceptance evidence: schema hashes, fixture matrix, contract test output, and explicit unresolved gates recorded in the plan.
   - Repair attempts: 0
   - Recovery note: Check whether schema files and contract declarations exist; if partially present, preserve them and rerun contract tests before editing.

2. [pending] Implement the bounded JSONL evaluator helper core.
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (process execution, resource limits, public protocol)
   - Owned scope: `csm-autoresearch/lib/protocol/**`, `csm-autoresearch/lib/runtime/**`, `csm-autoresearch/scripts/evaluate.mjs`, and helper unit tests.
   - Not in scope: provider-specific containers/VMs, LLM adapters, population search, or bootstrap integration.
   - Spike candidate: Determine POSIX process-group cleanup and explicitly unsupported Windows/generated-source behavior using synthetic candidates in a disposable `/tmp` sandbox; no repository code execution.
   - Actions: Implement JSONL framing and schema validation; argument-array execution; allowlisted environment; bounded stdout/stderr and workspace; timeout and cancellation; process-group cleanup; typed statuses; provenance; redaction; atomic artifact publication; cleanup verification; fail-closed unsupported capabilities.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/protocol.test.mjs csm-autoresearch/test/runtime.test.mjs` passes, including malformed/oversized frames, noisy output, timeout, cleanup, output overflow, and provenance cases.
   - Validation: Synthetic candidates only; test stdout/stderr drainage, signal escalation, workspace cleanup, and no shell interpolation.
   - Acceptance evidence: protocol fixture outputs, process cleanup results, resource-limit mappings, and documented platform support.
   - Repair attempts: 0
   - Recovery note: Inspect helper protocol/version and temp-workspace state; never reuse a partially written ledger or orphaned process.

3. [pending] Add registered-function and trusted-local-source execution providers.
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: high (source loading and evaluator boundary)
   - Owned scope: `csm-autoresearch/lib/providers/registered.mjs`, `csm-autoresearch/lib/providers/trusted-local.mjs`, provider tests, and synthetic fixtures.
   - Not in scope: generated-source provider, live LLM calls, arbitrary imports, dependency installation, or production promotion.
   - Spike candidate: Resolve callable identifier/import allowlist and trusted-local source snapshot semantics through static synthetic fixtures; reject ambiguous module resolution rather than guessing.
   - Actions: Enforce registry identity/source hash, declared evolution paths, pinned local revisions, private trial workspaces, evaluator-owned fixtures, and explicit approval metadata. Reject path escapes, symlinked inputs, evaluator/test/policy edits, inherited secrets, and unapproved imports.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/providers.test.mjs` passes for valid execution, invalid identities, path escapes, symlinks, forbidden imports, and mutation allowlist violations.
   - Validation: Compare provider results with T002 status/provenance schema; verify cleanup and no candidate-visible evaluator assets.
   - Acceptance evidence: provider matrix, source/hash records, access-denial results, and trust-mode threat-model notes.
   - Repair attempts: 0
   - Recovery note: Confirm registry and source snapshot hashes before resuming; do not promote local source after partial cleanup.

4. [pending] Select, prove, and implement the generated-source sandbox capability gate.
   - Task ID: T004
   - Depends on: T002
   - Parallel group: G3
   - Risk: critical (host/evaluator compromise)
   - Owned scope: `csm-autoresearch/lib/providers/generated.mjs`, sandbox policy/configuration, synthetic containment tests, and security-spike evidence under temporary paths.
   - Not in scope: silently falling back to ordinary subprocesses, production container orchestration, or claiming universal sandbox safety.
   - Spike candidate: Mandatory. Prove the selected provider’s network-none state, no host mounts/socket, image/runtime identity, CPU/memory/PID/disk/output/wall limits, evaluator-asset separation, and descendant cleanup using synthetic hostile candidates only.
   - Actions: First select and pin one provider supported by the deployment environment, its image/runtime identity, invocation command, capability probe, and supported platforms. Then implement only that provider; otherwise return `sandbox_unavailable` before execution. Add path/mount/network/credential/evaluator probes, fork/detached-child cleanup, resource exhaustion, and E2E-required behavior. Preserve residual TOCTOU and platform limitations explicitly.
   - Acceptance signal: `node csm-autoresearch/scripts/probe-sandbox.mjs --required` returns an available verified provider, followed by `node --test --test-concurrency=1 csm-autoresearch/test/generated-sandbox.test.mjs` with no skipped containment checks; unsupported environments return nonzero/typed failure before candidate execution.
   - Validation: The required containment command must fail when runtime/image/capabilities are unavailable; the offline command verifies typed pre-execution refusal only. Record passed/failed/skipped/not-run separately.
   - Acceptance evidence: threat model, selected provider and pinned image/runtime digest, exact invocation, mounts/network/env/limits, containment outputs, cleanup proof, and independent security sign-off. If no provider is approved, T004 is blocked and generated mode is not complete.
   - Repair attempts: 0
   - Recovery note: If any capability cannot be proven, leave generated mode feature-gated and mark T004 blocked; do not downgrade or weaken the test.

5. [pending] Implement the deterministic baseline, target, hill-climb, validation, and ledger loop.
   - Task ID: T005
   - Depends on: T001, T002, T003
   - Parallel group: G4
   - Risk: standard (optimization decisions and durable records)
   - Owned scope: `csm-autoresearch/lib/optimizer/**`, `csm-autoresearch/lib/ledger/**`, orchestration sections in `csm-autoresearch/SKILL.md`, and loop tests.
   - Not in scope: live LLM adapters, advisory judge authority, islands, generated-source enablement, or evaluator mutation.
   - Spike candidate: Calibrate a synthetic deterministic/noisy evaluator to select configurable sample/uncertainty policy; record unresolved workload-specific choices rather than universal defaults.
   - Actions: Establish baseline; apply one bounded candidate; run fast gates/cascade; compare target or incumbent margin; retain raw observations and uncertainty; record retry/quarantine/anomaly decisions; maintain reflection/validation/final partitions; support resume and explicit stopping budgets.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/optimizer.test.mjs csm-autoresearch/test/ledger.test.mjs` passes deterministic baseline, target hit/miss, improvement/rejection, retry, quarantine, resume, and no-silent-exclusion cases.
   - Validation: Replay the same synthetic run twice and compare stable provenance/decision fields; verify candidate cannot alter evaluator-owned inputs.
   - Acceptance evidence: sample ledger, state transitions, stopping-rule record, and baseline/validation comparison outputs.
   - Repair attempts: 0
   - Recovery note: Reconcile ledger tail with candidate artifacts and parent hashes before resuming; never infer completion from status alone.

6. [pending] Add provider-neutral LLM proposer, qualitative evaluator, and advisory judge.
   - Task ID: T006
   - Depends on: T001, T005
   - Parallel group: G5
   - Risk: high (credentials, network, subjective evaluation, deferred policy)
   - Owned scope: `csm-autoresearch/lib/llm/**`, deterministic stub fixtures, calibration/judge tests, and referenced LLM policy documentation outside the T001-owned `SKILL.md`.
   - Not in scope: vendor SDK commitment, default network calls, credential storage, judge override of deterministic failures, or silently resolving `DEF-EVAL`.
   - Spike candidate: Mandatory policy spike for `DEF-EVAL`, provider injection, endpoint/egress, budget defaults/maxima, calibration set, judge ensemble, disagreement threshold, and human-review threshold. Live calls remain disabled until explicit approval.
   - Actions: Define `propose(request,budget,policy)` and `judge(request,rubric,budget,policy)` adapters; implement deterministic offline stubs; generate diverse proposal families up to 50; deduplicate and pre-filter; blind judge inputs; use ordinal/pairwise outcomes, confidence, calibration, disagreement routing, cost/token/time bounds, redaction, and provenance.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/llm-adapter.test.mjs csm-autoresearch/test/judge.test.mjs` passes with no credentials/network and proves deterministic hard failures cannot be overridden by stub judge output.
   - Validation: Test missing credentials, blocked egress, malformed responses, budget exhaustion, calibration failure, judge disagreement, unavailable judge, and quarantine. Live acceptance requires the explicit `DEF-EVAL` decision and separate credentials/network policy.
   - Acceptance evidence: adapter contract, stub replay hashes, calibration metrics, false-accept/false-reject counts, and recorded policy decision.
   - Repair attempts: 0
   - Recovery note: If `DEF-EVAL` remains open, keep live mode disabled and preserve deterministic stubs; do not add provider secrets or SDK assumptions.

7. [pending] Add staged population archive, stagnation detection, and promotion workflow.
   - Task ID: T007
   - Depends on: T005, T006
   - Parallel group: G5
   - Risk: standard (selection and promotion integrity)
   - Owned scope: `csm-autoresearch/lib/population/**`, archive schema/fixtures, and population tests.
   - Not in scope: always-on islands, evaluator co-evolution, unrestricted self-modification, or autonomous production deployment.
   - Spike candidate: Use synthetic candidate histories to choose a bounded archive descriptor and stagnation threshold; record it as configurable policy, not a universal result.
   - Actions: Preserve parent lineage; enable archive only after recorded stagnation; support Pareto/category retention and optional islands/migration; require deterministic gates, hidden validation, anomaly review, approval, and rollback identity before promotion. Implement pending-approval refusal, protected-path refusal, approved atomic promotion, failed-promotion recovery, and exact rollback.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/population.test.mjs` proves no archive before threshold, bounded diversity retention, lineage, deterministic selection, rejection on hidden/hard-gate failure, approved promotion, protected-path refusal, failed-promotion recovery, and exact rollback.
   - Validation: Replay synthetic histories and verify byte-stable archive/provenance outputs.
   - Acceptance evidence: archive policy, lineage fixtures, stagnation evidence, promotion/rollback records.
   - Repair attempts: 0
   - Recovery note: Recompute archive from append-only records if interrupted; never discard lineage to repair selection state.

8. [pending] Build the security, evaluator-integrity, protocol, and artifact test package.
   - Task ID: T008
   - Depends on: T001, T002, T003, T004, T005, T006, T007
   - Parallel group: G6
   - Risk: high (security and correctness evidence)
   - Owned scope: `csm-autoresearch/test/integration.test.mjs`, `csm-autoresearch/test/fixtures/integration/**`, security test runner wiring, and test documentation only; unit/provider tests remain owned by T001-T007.
   - Not in scope: production fixes, weakening security checks for unavailable infrastructure, or treating skipped E2E as pass.
   - Spike candidate: None; all open security questions are already explicit in T004 and must be resolved there.
   - Actions: Add protocol/schema tests, malformed-frame tests, timeout/process-tree tests, output/resource quotas, path/symlink/TOCTOU cases, evaluator asset separation, credential/network/mount probes, artifact crash recovery, deterministic stub replay, judge routing, mutation/evaluator-tampering cases, and required-vs-skipped E2E assertions.
   - Acceptance signal: `cd csm-autoresearch && node --test --test-concurrency=1 test/integration.test.mjs` passes, and the required containment command fails on unavailable security infrastructure rather than skipping.
   - Validation: Run targeted tests cheapest-first; record skipped/not-run security checks as failures for generated-source enablement.
   - Acceptance evidence: machine-readable results, mutation/containment evidence, skipped-test reasons, and independent test review.
   - Repair attempts: 0
   - Recovery note: Compare test inventory to T001-T007 acceptance surfaces; partial test additions are safe to rerun because fixtures are synthetic and deterministic.

9. [pending] Integrate skill registration, payload, README, package tests, and repository artifacts.
   - Task ID: T009
   - Depends on: T001, T002, T003, T005, T006, T007, T008
   - Parallel group: G7
   - Risk: high (public install/package interface)
   - Owned scope: `scripts/pack-bootstrap.mjs`, `README.md`, `.agents/README.md`, `Makefile`, `tests/integration/bootstrap-flow.test.mjs`, `tests/package-audit.test.mjs`, `tests/protocol/protocol.test.mjs`, generated `bootstrap/package/**`, and generated README matrix output. T001 exclusively owns `scripts/lib/contracts.mjs` declarations.
   - Not in scope: unrelated README cleanup, review/draft files, release publication, credentials, or manual edits to generated payload files.
   - Spike candidate: None; csm-ddd packaging precedent and existing checks define the integration surface.
   - Actions: Add every helper file through explicit `supportingFiles` mappings; regenerate payload/index and README matrix; update 12-skill hard-coded lists/counts; add `.agents` artifact index lines; add `test-autoresearch` to `.PHONY`, create its command, and include it in `test`; add an installed-payload smoke test that invokes the helper from the packed/installable output.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs && node scripts/check-suite.mjs && node scripts/gen-readme-matrix.mjs --check && node --test tests/package-audit.test.mjs tests/integration/bootstrap-flow.test.mjs tests/protocol/protocol.test.mjs` passes, and the installed-payload smoke test proves every helper file is indexed and executable without dependencies.
   - Validation: Run `make test-autoresearch`, then `make test`, then payload/hash audit; inspect diff for only intended files.
   - Acceptance evidence: generated payload/index hashes, installed helper invocation output, README matrix, Makefile target output, package tests, and artifact index entries.
   - Repair attempts: 0
   - Recovery note: Regenerate from source mappings; never hand-repair payload/index drift or stage unrelated dirty files.

10. [pending] Perform independent security, evaluator-integrity, maintainability, and completion review.
   - Task ID: T010
   - Depends on: T004, T006, T008, T009
   - Parallel group: G8
   - Risk: high (release/security gate)
   - Owned scope: review evidence and the plan’s completion records; implementation fixes remain owned by the affected task.
   - Not in scope: self-approval, bypassing failed security evidence, deployment, publishing, or unrelated repository review findings.
   - Spike candidate: None.
   - Actions: Independent reviewers assess sandbox/provider threat model, evaluator authority, LLM judge bias/credentials, test quality, package integration, positive promotion, rollback, and plan acceptance. Repair findings through T002-T009 as needed. Run cheapest checks before full `make test` and final `make check`.
   - Acceptance signal: `make check && make test` pass, independent review records no unresolved high/critical finding, and positive promotion/rollback evidence exists. If generated-source or live-LLM gates remain unavailable, plan status is `BLOCKED` rather than falsely complete.
   - Validation: Run targeted skill tests, bootstrap/package/protocol tests, then full suite; verify unrelated untracked files remain untouched.
   - Acceptance evidence: review findings/resolutions, final commands/results, threat-model sign-off, `DEF-EVAL`/sandbox status, and rollback proof.
   - Repair attempts: 0
   - Recovery note: On review failure, create a narrowly scoped repair task with root cause and rerun only affected gates before returning to review.

## Verification Strategy

Run checks cheapest-first. Per-task gates are each targeted Node test file and schema/protocol fixture suite. Security tasks add synthetic containment probes and a required security E2E environment; skipped containment is not success. Integration gates are `node scripts/check-suite.mjs`, `node scripts/gen-readme-matrix.mjs --check`, payload synchronization/audit, and the three hard-coded bootstrap test families. Final gates are `make check` then `make test`, with generated-source and live-LLM enablement separately blocked unless their evidence exists. Run independent review tracks in parallel after implementation, but keep shared integration and final verification under the primary agent.

## Risks And Recovery

- Generated-source escape or evaluator compromise: fail closed, quarantine, preserve evidence, and block T004/T010 until containment proof and independent review exist.
- `DEF-EVAL` remains open: keep live adapter stub-only, record blocker, and do not add provider credentials or network defaults.
- Process-tree cleanup cannot be proven on a platform: mark that provider unsupported; never downgrade to ordinary subprocess.
- Payload/README/contract drift: regenerate from authoritative source mappings and rerun package tests; never hand-edit generated output.
- Noisy metrics or judge bias: preserve raw observations, calibration/disagreement records, and route ambiguous candidates to review.
- Interrupted ledger/artifact writes: rebuild from append-only records and atomic manifests; never promote partial artifacts.
- Concurrent worktree changes: preserve unrelated files and stage only task-owned paths.
- After two failed repairs on one task, dispatch fresh-eyes diagnosis or mark the task/blocker explicitly; do not loop silently.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| Generated-source mode could be mistaken for ordinary subprocess execution. | critical | Added T004 as a blocking threat-model/containment spike with fail-closed unsupported capability and required E2E evidence. | Security scout; evaluator research sections 8 and 12. |
| Live LLM scope conflicts with open `DEF-EVAL` and absent provider conventions. | high | Added D009, T006 policy gate, provider-neutral injected adapters, deterministic stubs, and explicit blocker status. | `.agents/docs/deferred.md:37-44`; live-LLM research track. |
| Plan could omit package/README/hard-coded skill surfaces. | high | T009 owns contracts, payload, README, artifact index, and all three hard-coded package-test families. | Registration research track; `scripts/check-suite.mjs`. |
| Helper protocol could deadlock or leak unbounded output. | high | T002 requires bounded JSONL frames, separate captured output, cleanup verification, and typed overflow/protocol statuses. | Node runtime research track. |
| Security E2E skips could be mistaken for green evidence. | high | T004/T008/T010 require security environment and distinguish skipped/not-run from pass. | Security research track; csm-browse E2E precedent. |
| Population/LLM complexity could precede deterministic proof. | standard | Dependency graph puts T005 before T006/T007 and keeps hard gates authoritative. | Agreed approach and scout recommendations. |
| Tests and `SKILL.md` had overlapping ownership. | critical | T001 owns `SKILL.md` and contract declarations; T001-T007 own their dedicated unit/provider tests; T008 owns only integration/security test files; T009 owns packaging tests and integration surfaces. | Independent critique; csm-build ownership rules. |
| Generated-source provider was not concrete enough to accept. | critical | T004 now selects and pins a provider, names a probe command, requires a verified capability result, and blocks mode enablement if no provider is approved. | Security/runtime research tracks. |
| Helper packaging and aggregate test consumption were underspecified. | high | T009 now maps every supporting file, runs installed-payload smoke, adds `test-autoresearch`, includes it in `test`, and verifies hard-coded skill lists. | Registration research track; `Makefile:1-63`. |
| Persistence and promotion/rollback lacked positive acceptance paths. | high | T001 fixes JSONL ledger plus atomic report/manifest; T007 tests approved promotion, refusal, failed recovery, and exact rollback. | Runtime research; independent critique. |
| `DEF-EVAL` completion semantics were ambiguous. | high | D009 and T006 make stub-only the safe core; live capability remains a separate explicit gate and leaves overall completion blocked until resolved. | `.agents/docs/deferred.md:37-44`; LLM research track. |
| T004/T008 skip semantics could conflict. | medium | T004 owns provider containment tests and required probe; T008 owns integration enforcement; both distinguish offline typed refusal from required security E2E failure. | Security critique and scout. |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-23T23:40:00Z | 0 | INTAKE -> DISCOVER | none | Agreed approach, research, repository instructions, and dirty-state evidence loaded. | DISCOVER |
| 2026-08-24T00:10:00Z | 0 | DISCOVER -> RESEARCH | none | Four read-only uncertainty scouts completed; runtime, security, packaging, and DEF-EVAL uncertainties recorded. | RESEARCH |
| 2026-08-24T00:40:00Z | 0 | RESEARCH complete | none | Four read-only research tracks returned repository and authoritative Node/Docker/evaluation evidence. | DRAFT |
| 2026-08-24T01:00:00Z | 0 | RESEARCH -> DRAFT | none | Protocol, trust-provider, security, LLM, packaging, and test surfaces synthesized into 10 pending tasks. | DRAFT |
| 2026-08-24T01:15:00Z | 0 | DRAFT -> CRITIQUE | none | Draft task graph completed with 10 pending tasks and explicit acceptance signals. | CRITIQUE |
| 2026-08-24T01:25:00Z | 0 | CRITIQUE -> REMEDIATE | none | Independent critique found overlapping ownership, sandbox/provider ambiguity, missing installed-helper/test integration, persistence gaps, and ambiguous DEF-EVAL completion. | REMEDIATE |
| 2026-08-24T01:30:00Z | 0 | REMEDIATE -> VERIFY | none | Ownership, provider gate, packaging, Makefile, persistence, promotion/rollback, and DEF-EVAL semantics corrected. | VERIFY |
| 2026-08-24T01:40:00Z | 0 | VERIFY complete | none | Primary verification confirmed all 10 tasks remain pending, each has acceptance/risk/anti-scope/recovery fields, dependencies are ordered, security/live gates are explicit, and unrelated worktree changes are preserved. | SAVED |

## Completion Review

Primary verification completed before save: task dependencies are executable; every task is pending with acceptance signal, risk, anti-scope, recovery note, and evidence requirement; security/live-LLM blockers are explicit; T004 has a provider-selection blocker; T006 has explicit `DEF-EVAL` gating; T009 consumes the helper through packaging and Makefile tests; positive promotion and exact rollback are covered; implementation was not started. Concurrent tracked changes in the worktree were observed and preserved untouched.
