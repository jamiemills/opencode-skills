format: csm-plan/1

# Agent Harness And Skills Remediation CSM Plan

## How To Execute

- Start work only through a separate, explicit `csm-build` invocation naming this plan; this planning session did not begin execution.
- Commit policy and live state are maintained in Control by `csm-build`.
- Execute dependency waves in order. Security, public publication, generated-payload, and lifecycle-contract tasks require independent review before completion.
- Risk summary: 5 high tasks (`T001`, `T002`, `T003a`, `T003b`, `T004a`), 8 standard tasks (`T003c`, `T003d`, `T004b`, `T004c`, `T005`, `T006`, `T007`, `T008`), and 0 low tasks. `T001`, `T002`, `T003a`, `T003b`, `T004a`, `T004b`, and `T004c` require independent security/public-contract review.

## Control

- Plan ID: agent-harness-remediation-2026-08-24
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 0
- Commits: allowed only when explicitly authorized by the user; otherwise disabled
- Last checkpoint: 2026-08-24T00:00:00Z final full gate and review complete
- Last model/run: gpt-5.6-luna / csm-build-agent-harness-remediation
- Next transition: none; build complete
- Active tasks: none
- Blockers: release-only actions remain blocked by explicit scope: production key custody/rotation, npm publication, hosted-envelope release, registry replay, real GitHub Pages deployment, browser E2E, and live-model evaluation.
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Remediate the accepted agent-harness and skills-framework findings in the current repository. Deliver a safer, more truthful, more testable CSM platform with strict bootstrap/release contracts, consistent commit and resume semantics, enforced runtime/publication boundaries, independent package validation, portable skill/evaluation/trace contracts, and accurate documentation.

Constraints:

- Preserve CSM as the durable workflow and human-handoff layer; do not replace it with LangGraph, OpenAI Agents SDK, Google ADK, Microsoft Agent Framework, or another vendor runtime.
- Preserve the user's pre-existing changes in `README.md` and `scripts/lib/contracts.mjs`; future build work must reconcile them rather than overwrite them.
- No real key generation, registry publication, GitHub publication, credential use, live production service calls, or automatic deployment.
- No A2A implementation unless a later explicit requirement establishes a real remote-agent use case.
- Keep live-model evaluation separate from the normal deterministic test gate.
- Do not edit completed historical plans or unrelated review/research artifacts.

## Acceptance Criteria

1. Bootstrap trust, payload binding, report-chain validation, command grammar, and replay claims are internally consistent and release-blocked until production prerequisites are evidenced.
2. Every committing skill defaults to explicit authorization and path-scoped commit verification; unrelated staged files cannot enter an owned commit.
3. A shared lifecycle contract defines recovery, clean review, incomplete results, durable checkpoints, evidence retention, and atomic multi-artifact publication, with focused regression fixtures.
4. Autoresearch, upload, browse, DDD, and scan boundaries enforce or explicitly narrow their advertised security guarantees, with hostile negative tests and no sensitive output leakage.
5. Skill discovery, packer output, payload index, committed bytes, and tests derive from or are checked against one authoritative manifest without regeneration masking stale metadata.
6. Deterministic evaluation fixtures and versioned manifest/trace schemas cover activation, trajectory, refusal, recovery, artifact correctness, and reproducibility without making live-model behavior a deterministic claim.
7. README and release documentation match actual lifecycle, prerequisites, signing, bootstrap availability, command grammar, and replay coverage.
8. CI reproduces the supported local gates without automatic publication, key rotation, or live-model execution in the default job.

## Current-State Evidence

- The deep-research finding recommends a CSM-plus-runtime-contract architecture and identifies bootstrap trust, payload binding, report schema, live evaluation, runtime policy, MCP boundaries, and observability as major gaps: `.agents/research/2026-08-24-agent-harness-skills-framework-review-research.md:22-35,53-150`.
- The parallel static review found 36 candidate findings across commit authorization, autoresearch, upload, lifecycle/resume, DDD, packaging, browse, README, and release documentation: `.agents/reviews/2026-08-24-opencode-skills-review.md:47-376`.
- Independent challenge upheld the high-risk runtime/publication findings; narrowed README lifecycle/coverage findings; retracted claims that current README lacks skill-selection guidance, hook instructions, or VNC/CDP scope wording. The adjudication is recorded in the research finding: `.agents/research/2026-08-24-agent-harness-skills-framework-review-research.md:146-150,216`.
- The repository uses Node built-in `node:test`, serial execution for filesystem-heavy suites, Node `>=22 <25`, and `make` as the gate interface: `Makefile:1-66`, `package.json:5-13`, `README.md:422-486`.
- `pack-bootstrap.mjs` and formatting/generator commands mutate repository-owned generated files; these must run only in a disposable build worktree or with bounded diffs: `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md:72-82`.
- Current worktree contains pre-existing modifications in `README.md` and `scripts/lib/contracts.mjs`, plus the research and review artifacts; future build ownership must preserve and reconcile those changes.

### Applicability

```json csm-applicability/1
{
  "format": "csm-applicability/1",
  "decision": "warranted",
  "mode": "risk-first",
  "matchedSignals": [
    "public_contract",
    "ownership_or_persistence",
    "invariant_or_consistency",
    "external_side_effect",
    "migration_or_rollback",
    "cross_boundary_coordination",
    "security_or_authority",
    "architecture_or_refactor"
  ],
  "evidence": [
    {
      "source": "repository",
      "locator": ".agents/research/2026-08-24-agent-harness-skills-framework-review-research.md:53-150",
      "observation": "Accepted findings cross bootstrap trust, publication, persistence, runtime authority, generated packaging, and lifecycle contracts."
    },
    {
      "source": "repository",
      "locator": ".agents/reviews/2026-08-24-opencode-skills-review.md:59-376",
      "observation": "Static review identifies high-risk execution/publication findings and medium-risk cross-skill contract inconsistencies."
    }
  ],
  "obligations": [
    { "id": "boundary", "status": "satisfied" },
    { "id": "ownership", "status": "satisfied" },
    { "id": "contract", "status": "satisfied" },
    { "id": "invariant", "status": "satisfied" },
    { "id": "observable_behavior", "status": "satisfied" },
    { "id": "seam", "status": "satisfied" },
    { "id": "parity", "status": "satisfied" },
    { "id": "rollback_recovery", "status": "satisfied" },
    { "id": "unresolved_risks", "status": "satisfied" }
  ],
  "taskApplicability": {
    "warranted": ["T001", "T002", "T003", "T004", "T005", "T006", "T007", "T008", "T009", "T010", "T011", "T012", "T013", "T014", "T015", "T016", "T017", "T018", "T019"],
    "lightweight": []
  },
  "dddArtifacts": [],
  "unresolvedRisks": [
    "production trust-root custody and publication authority",
    "trusted-local and registered-provider isolation tier",
    "upload permanence and evidence-class policy",
    "live-evaluation model/runtime support matrix"
  ],
  "bypass": { "requested": false, "rationale": null }
}
```

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | CSM remains the framework-neutral durable workflow; external frameworks contribute boundary patterns only. | architecture | Research recommendation and primary framework comparison. | decided |
| D2 | Public bootstrap remains unavailable until production trust-root, hosting, publication, rotation, and replay evidence exists. | release | `bootstrap/release-checklist.md:12-20`; keyring is fixture-only. | decided |
| D3 | No real key generation, publication, upload, or production service call belongs in this plan's default build. | safety | User asked for a plan; repository release actions are credential-gated. | decided |
| D4 | `trusted-local` is not described as isolated until an enforceable host/process mechanism is selected and tested. | security | Review found limits recorded/rejected rather than enforced. | decided |
| D5 | Upload success, Git push success, Pages deployment readiness, and public reachability are separate states. | publication | Review finding F-026 and MCP/A2A task-lifecycle implications. | decided |
| D6 | A2A is deferred; MCP-compatible deterministic tool contracts are the smaller conditional interoperability target. | scope | Research recommendation. | decided |
| D7 | Existing modified `README.md` and `scripts/lib/contracts.mjs` are user-owned until a future build explicitly reconciles them. | worktree | Current `git status --short`. | decided |
| D8 | Existing generated payloads are changed only through the canonical packer, followed by bounded diff and independent index validation. | generated artifacts | Existing packaging convention and review finding F-023. | decided |
| D9 | Live-model evaluation is opt-in and separate from deterministic tests; the normal gate must remain offline. | evaluation | Research and ADK/OpenAI testing comparison. | decided |
| D10 | If a required product decision remains unanswered, the dependent task is blocked rather than silently assigned a security default. | recovery | Planning safety rule for high-consequence decisions. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Which parallel findings survive challenge? | Read-only file inspection plus independent challenge agents | No repository code executed; only plan draft is allowed to persist. | High-risk runtime/publication findings upheld; README findings narrowed/retracted where contradicted. | T001-T007 implement accepted findings only. |
| R2 | Which test and gate conventions apply? | Read-only inspection of `Makefile`, `package.json`, tests, plans, and review artifacts | No dependency installation or test execution during planning. | Node 22, serial suites, `make` gates, and generated-payload mutation surfaces identified. | T008 sequences cheap checks before serial/batch gates. |
| R3 | What decisions block secure implementation? | Uncertainty scout over trust, isolation, publication, evaluation, and manifest ownership | Read-only subagent; no writes. | Production key custody, isolation tier, upload policy, and model matrix remain unresolved. | T001 records decisions and blocks dependent tasks safely. |
| R4 | What is the smallest dependency order? | Independent sequencing research | Read-only; no mutation. | Release and lifecycle contracts precede runtime, packaging, evaluation, docs, and CI. | Execution graph uses thirteen tasks and disjoint waves. |

## Discovered Requirements

- Use `node:test` and existing serial suite conventions; do not introduce a second test runner without an explicit decision.
- Use Node `>=22 <25`; invoke bootstrap tests through `scripts/with-node22.mjs` when the active runtime is outside that range.
- Treat `pack-bootstrap.mjs`, `sync-skill-boilerplate.mjs --write`, `gen-readme-matrix.mjs --write`, formatting, and hook installation as mutating operations requiring a disposable build worktree and bounded diff review.
- Do not run pack-invoking suites concurrently because payload generation mutates shared generated files.
- Preserve current user changes in `README.md` and `scripts/lib/contracts.mjs`; future build tasks must identify and reconcile those hunks explicitly.
- Use two-space JSON, trailing newline, canonical sorted serialization where existing modules require it, and existing repository fixture patterns.
- No ordinary primary suite should require network access; browser E2E, actual publication, and live-model evaluation remain separately gated.
- Generated payload/index edits must be made through the canonical packer, never by hand.
- Every task below remains `pending`; this plan does not authorize implementation.

### Finding Disposition

| Review finding | Disposition | Planned coverage |
|---|---|---|
| F-001 | covered | T003a |
| F-002 | covered | T004a |
| F-003 | covered or narrowed by isolation decision | T004a |
| F-004 | covered | T008 |
| F-005 | covered | T002 |
| F-006 | covered or explicitly narrowed | T002 |
| F-007 | covered | T003b |
| F-008 | covered | T003b |
| F-009 | covered | T003b |
| F-010 | covered or explicitly narrowed | T003b |
| F-011 | covered | T003a |
| F-012 | covered | T003c |
| F-013 | covered or explicitly narrowed | T003b |
| F-014 | covered | T003c |
| F-015 | covered | T003c |
| F-016 | covered | T003b |
| F-017 | covered | T003d |
| F-018 | covered | T004c |
| F-019 | covered | T004c |
| F-020 | covered | T004a |
| F-021 | covered | T004c |
| F-022 | covered | T005 |
| F-023 | covered | T005 |
| F-024 | covered | T004b |
| F-025 | covered | T004b |
| F-026 | covered | T004b |
| F-027 | narrowed; skill-specific matrix replaces universal claim | T007 |
| F-028 | covered | T007 |
| F-029 | narrowed; retain existing human-handoff prose and clarify only ambiguous visuals | T007 |
| F-030 | narrowed; quick-install path is the accepted gap | T007 |
| F-031 | covered | T007 |
| F-032 | covered | T007 |
| F-033 | retracted after challenge | anti-scope T007 |
| F-034 | retracted after challenge | anti-scope T007 |
| F-035 | covered | T002 and T007 |
| F-036 | covered | T002 and T007 |

Disposition authority is the challenged research finding, not the parallel review's unchallenged summary. F-006 is not counted as fixed until the shell-guidance guarantee is either structurally enforced or explicitly narrowed with negative tests and accurate protocol wording.

### Obligation Map

| Applicability obligation | Required tasks | Evidence required |
|---|---|---|
| boundary-contract | T002, T003a-T003d, T004a-T004c, T005-T007 | versioned contract/state matrices and negative fixtures |
| parity-baseline | T002, T003a-T003d, T004a-T004c, T005, T007 | before/after hashes, output/status fixtures, bounded diffs, existing test baselines |
| observable-behavior | T002, T003b-T003d, T004b-T004c, T007 | refusal/error/status/output comparisons, including side effects |
| rollback-or-forward-recovery | T002, T003b-T003d, T004a/T004b/T004c, T005/T006 | failure-injection tests, retained old records, incomplete-generation cleanup, migration notes |
| security-review | T001, T002, T003a/T003b, T004a/T004b/T004c | independent challenge and hostile test evidence |
| generated-artifact-synchronization | T002, T005, T007, T008 | source/payload/index/README equality and no-regeneration stale-index checks |

## Design

The target architecture separates five contracts:

```text
Skill + manifest -> host policy -> model/tool/sandbox run
       |                |                 |
       v                v                 v
  discovery       authorization       bounded side effect
       \________________|_________________/
                        v
              durable lifecycle + trace
                        v
             artifact/evaluation receipt
```

The implementation should first make release and lifecycle semantics truthful, then enforce high-risk runtime/publication boundaries, then make packaging and evaluation metadata authoritative, and finally update documentation and CI to reflect the resulting behavior. Security boundaries are host-enforced; `SKILL.md` descriptions and manifest annotations are discovery and policy inputs, not security controls.

## Execution Graph

- Wave 0: T001 decision/baseline gate. No source edits; blocks high-consequence ambiguity.
- Wave 1, parallel after T001: T002 bootstrap/release contracts || T003a commit authorization || T003b lifecycle/recovery/source-mode contracts.
- Wave 2, after T003b: T003c evidence retention/incomplete results || T003d DDD atomic publication and typed anchors; T005 packaging authority may begin after T001 and T003a.
- Wave 3, parallel after T001/T002/T003b: T004a autoresearch || T004b upload/browse || T004c DDD/scan privacy and diagnostics.
- Wave 4: T006 deterministic evaluation/manifest/trace after T003a, T003b, and T005; runtime integration cases may consume T004a-T004c later.
- Wave 5: T007 README/release documentation after T002, T003a-T003d, T005, and T006.
- Wave 6: T008 Makefile/CI/final integrated gate after all prior tasks.
- Critical path: T001 -> T002/T003b -> T003c/T003d -> T005 -> T006 -> T007 -> T008.
- T004a-T004c are parallel by component; T003a-T003d are parallel only where file ownership is disjoint. T002 alone owns generated payload/index outputs. `README.md` and `scripts/lib/contracts.mjs` are serialized reconciliation surfaces.

## Numbered Plan

1. [completed] Resolve security/release decisions and capture protected baselines
   - Task ID: T001
   - Depends on: none
   - Parallel group: G0
   - Risk: high (security authority and public release)
   - Owned scope: future build journal/decision evidence only; no production source ownership
   - Not in scope: key generation, publication, upload, live-model evaluation, dependency changes, source fixes
   - Spike candidate: inspect provider tests and host capabilities in a disposable/read-only context to decide trusted-process versus OS/process isolation.
   - Actions: record an owner, options, required evidence, and blocking status for trust-root custody/signature policy, provider isolation, upload permanence/redaction policy, supported models/runtimes, and production-publication authority. Record protected path/hunk hashes for pre-existing `README.md` and `scripts/lib/contracts.mjs` changes.
   - Acceptance signal: `git diff --binary -- README.md scripts/lib/contracts.mjs | sha256sum` is recorded before and after the build, and the build journal contains a complete decision table or marks each undecided dependent task blocked.
   - Validation: `node scripts/check-suite.mjs`; verify no unrelated paths changed.
   - Acceptance evidence: decision table, baseline hashes, and blocker matrix.
   - Repair attempts: 0
   - Recovery note: absent decisions block dependent tasks; never guess key custody, isolation, or publication policy.

2. [completed] Close bootstrap trust, report-chain, origin, shell-policy, command, and replay blockers
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G1
   - Risk: high (cryptographic trust, installer behavior, public release)
   - Owned scope: bootstrap protocol/validator/schema/keyring/release files and bootstrap trust/protocol/offline/integration tests.
   - Not in scope: real key generation/rotation, registry publication, immutable hosting, external upload, or production release.
   - Spike candidate: decide schema-only versus shared schema-plus-runtime validation for exact report order/refusal consistency using synthetic malformed reports.
   - Actions: require payload binding for trusted envelopes; enforce exact state order and refusal semantics; validate allowed-origin port/path; either replace the shell denylist with a structurally non-executable steps contract or explicitly narrow its guarantee; remove production-signing ambiguity; correct `--no-install`; distinguish local file replay from future registry replay; add production/test validator parity.
   - Acceptance signal: `node scripts/with-node22.mjs --exec node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs` passes with negative fixtures for omitted binding, invalid order, refusal mismatch, origin mismatch, shell-policy bypass, malformed command, and fixture release metadata.
   - Validation: `node scripts/check-suite.mjs`; deterministic double-pack in disposable worktree; bounded generated diff; no network or credentials.
   - Acceptance evidence: negative fixtures, test output, validator parity proof, corrected release checklist, and explicit residual production blockers.
   - Repair attempts: 0
   - Recovery note: regenerate payload/index together; preserve fixture-only posture if production metadata is unavailable.

3. [completed] Make commit authorization and path scoping explicit
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G1
   - Risk: high (repository mutation and history integrity)
   - Owned scope: `csm-bdd-tdd/SKILL.md`, `csm-grill/SKILL.md`, `csm-plan/SKILL.md`, `csm-build/SKILL.md`, commit-contract tests, and shared commit helpers if required.
   - Not in scope: lifecycle migration, README, completed plans, or changing user-owned files.
   - Spike candidate: inspect existing commit helpers and hooks to choose `git commit --only` versus a verified pathset wrapper without weakening user staging semantics.
   - Actions: default no-commit; require explicit authorization; use path-scoped commit commands; verify committed paths and reject unrelated staged files; add static and synthetic commit fixtures.
   - Acceptance signal: `node --test tests/commit-scope.test.mjs` passes, proving an unauthorized commit is not attempted and unrelated staged paths are absent from an authorized owned commit.
   - Validation: `node scripts/check-suite.mjs`; inspect each skill's commit wording and pathset.
   - Acceptance evidence: contract matrix, synthetic Git fixture output, and protected-hunk preservation proof.
   - Repair attempts: 0
   - Recovery note: commit changes are independently revertible; no task may commit the user's pre-existing files.

4. [completed] Define lifecycle recovery, clean review, source-mode, and resumability contracts
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G1
   - Risk: high (durable state and public lifecycle contract)
   - Owned scope: `csm-build/SKILL.md`, `csm-grill/SKILL.md`, `csm-make-tests/SKILL.md`, `csm-review-python/SKILL.md`, `csm-deep-research/SKILL.md`, lifecycle fixtures, and resume contract tests.
   - Not in scope: commit commands (T003a), evidence retention (T003c), DDD publication (T003d), implementation runtime isolation, or universal resumability.
   - Spike candidate: define the minimum durable cursor/control fields per skill and mark intentionally non-resumable skills explicitly.
   - Actions: add `BLOCKED -> RECOVER -> VALIDATE`, clean `REVIEW -> CHECKPOINT`, durable control/cursor metadata where resumability is claimed, and source-mode restrictions for researcher/challenger/judge roles.
   - Acceptance signal: `node --test tests/resume-semantics.test.mjs tests/plan-applicability.test.mjs tests/lifecycle-contract.test.mjs` passes positive/negative fixtures for blocker recovery, clean review, interruption recovery, and local/web/hybrid scope.
   - Validation: per-skill state matrix, artifact format checks, and protected-before/after control-state fixtures.
   - Acceptance evidence: state graph, cursor schema, resume fixtures, and intentional non-resumability list.
   - Repair attempts: 0
   - Recovery note: write new checkpoints before retiring old temp state; partial migration must resume from the last durable cursor.

5. [completed] Preserve evidence and distinguish incomplete verification from success
   - Task ID: T005
   - Depends on: T003b
   - Parallel group: G2
   - Risk: standard (evidence integrity and report status)
   - Owned scope: `csm-make-tests/SKILL.md`, `csm-review/SKILL.md`, `csm-review-python/SKILL.md`, evidence/report fixtures, and verification-status schemas.
   - Not in scope: general lifecycle transitions, commit behavior, or runtime publication.
   - Spike candidate: choose whether referenced performance evidence is persisted, embedded as a checksum/summary, or explicitly marked unavailable.
   - Actions: retain or embed report-referenced evidence; add `INCOMPLETE`/`BLOCKED` result semantics after unresolved verification; define typed anchor URL/version/reachability records.
   - Acceptance signal: `node --test tests/evidence-status.test.mjs` passes and proves deleted evidence cannot be referenced as available and unresolved verification cannot be labeled verified.
   - Validation: `node scripts/check-suite.mjs`; report fixture read-back; failure-injection for cleanup.
   - Acceptance evidence: status schema, evidence retention output, anchor fixtures, and incomplete-report examples.
   - Repair attempts: 0
   - Recovery note: preserve old evidence until replacement report status is durable; incomplete artifacts remain inspectable and non-successful.

6. [completed] Make DDD report/graph publication atomic
   - Task ID: T006
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (paired persistent artifact consistency)
   - Owned scope: `csm-ddd/SKILL.md`, `csm-ddd/lib/ddd/pipeline.mjs`, DDD publication tests only.
   - Not in scope: DDD privacy serialization (T004c), schema discovery, or completed artifacts.
   - Spike candidate: choose generation-directory/manifest or equivalent pair-finalization protocol using failure injection in a temporary output directory.
   - Actions: publish report and graph through a single finalization boundary; remove incomplete generations on failure; record pair identity and recovery behavior.
   - Acceptance signal: `node --test --test-concurrency=1 csm-ddd/test/publication.test.mjs` passes normal and interrupted-pair cases with either both final artifacts or neither.
   - Validation: existing DDD suite; inspect output directory after injected failures.
   - Acceptance evidence: pair protocol, failure-injection output, and before/after artifact parity.
   - Repair attempts: 0
   - Recovery note: incomplete generations are disposable; prior complete pair remains untouched.

7. [completed] Reconcile autoresearch schema, provenance, and execution boundary
   - Task ID: T007
   - Depends on: T001, T003b
   - Parallel group: G3
   - Risk: high (process authority and evaluator integrity)
   - Owned scope: `csm-autoresearch/schemas/**`, `csm-autoresearch/lib/{optimizer,ledger,providers,runtime}/**`, and autoresearch tests.
   - Not in scope: new vendor sandbox, production credentials, or claiming OS isolation without proof.
   - Spike candidate: test whether the host can enforce selected network/memory/process/filesystem limits; if not, narrow trusted-local/registered-provider guarantees and fail closed for unsupported claims.
   - Actions: make `policy` schema match runtime; validate before optimization; bind resume to contract/evaluator/environment/policy provenance; enforce or explicitly narrow limits; constrain or isolate registered callables; add hostile blocking/network/credential/evaluator-mutation fixtures.
   - Acceptance signal: `cd csm-autoresearch && node --test --test-concurrency=1 test/*.test.mjs` passes schema-valid object-policy, changed-provenance refusal, and hostile-provider cases.
   - Validation: `node --check`; focused provider/runtime tests; independent security review.
   - Acceptance evidence: policy schema/runtime parity, isolation decision, hostile-test output, and narrowed guarantee text where enforcement is unavailable.
   - Repair attempts: 0
   - Recovery note: provenance mismatch blocks resume; never silently reinterpret old ledger records.

8. [completed] Secure upload and browser control/publication boundaries
   - Task ID: T008
   - Depends on: T001, T003a
   - Parallel group: G3
   - Risk: standard with security review (irreversible publication and control endpoints)
   - Owned scope: `csm-upload/**`, `csm-browse/lib/security.mjs`, `csm-browse/lib/cdp.mjs`, `csm-browse/lib/cookies.mjs`, and focused tests.
   - Not in scope: real GitHub/Pages publication, browser E2E, or full Chromium sandbox redesign.
   - Spike candidate: decide loopback-only versus authenticated remote CDP support; default to loopback/expected-port/session binding unless a tested remote contract is approved.
   - Actions: isolate Git configuration and verify effective remote; add redaction/refusal and explicit permanence confirmation; separate pushed/deployed/verified states; constrain CDP host/port/session/token; narrow consent automation and audit page mutation.
   - Acceptance signal: `node --test csm-upload/tests/upload.test.mjs && cd csm-browse && npm test` passes under Node 22 with redirected-remote, sensitive-artifact, deployment-status, endpoint, token, and consent fixtures.
   - Validation: `node --check`; inspect temporary clone cleanup; no real credentials/network.
   - Acceptance evidence: effective-remote proof, redaction canaries, separate publication statuses, endpoint/token fixtures, and independent security review.
   - Repair attempts: 0
   - Recovery note: failed publication cleans only isolated clone; no success status is emitted for unverified Pages deployment.

9. [completed] Bound DDD inputs/outputs and sanitize direct scan diagnostics
   - Task ID: T009
   - Depends on: T001, T003d
   - Parallel group: G3
   - Risk: standard with security review (persistent data disclosure)
   - Owned scope: `csm-ddd/lib/ddd/{clarify,render,redact}.mjs`, `csm-scan/lib/scan/survey.mjs`, and focused privacy tests.
   - Not in scope: DDD pair finalization (T003d), browser/publication, or new privacy infrastructure beyond shared bounded serialization.
   - Spike candidate: define reject/redact/hash/omit policy for sensitive names, paths, terms, labels, seams, and clarification values; test synthetic canaries only.
   - Actions: bound counts/bytes and validate clarification envelopes; apply one serializer to every persisted repository-derived field; inject sanitized reporter for direct library calls; add hostile secret/path/oversize fixtures.
   - Acceptance signal: `node --test --test-concurrency=1 csm-ddd/test/privacy.test.mjs csm-scan/test/privacy.test.mjs` passes with zero sensitive canaries, absolute paths, or identities in Markdown/JSON/diagnostics.
   - Validation: full DDD and scan suites; inspect serialized artifacts and direct-library output.
   - Acceptance evidence: privacy policy, hostile fixtures, zero-leak output, and security review.
   - Repair attempts: 0
   - Recovery note: validation failure produces no final artifact; prior outputs remain untouched.

10. [completed] Make discovery, packaging, and payload-index validation authoritative
   - Task ID: T010
   - Depends on: T001, T003a
   - Parallel group: G2
   - Risk: standard (generated release metadata and install integrity)
   - Owned scope: `scripts/pack-bootstrap.mjs`, `scripts/check-suite.mjs`, `scripts/lib/contracts.mjs` only after reconciling the pre-existing user diff, `tests/package-audit.test.mjs`, manifest schema/data, and generated `bootstrap/payload-index.json`.
   - Not in scope: package-manager changes, new distribution format, runtime permission enforcement, automatic publication, or overwriting user-owned contract changes.
   - Spike candidate: prove whether the current manifest can be sole authority; if not, add the smallest generated inventory with equality assertions.
   - Actions: define manifest fields for schema/version/content digest/compatibility/permissions/entrypoints/eval/trace; derive/assert equality across discovery, packer, checker, payload, and tests; add read-only committed-index validation before regeneration; add stale-index/omitted-skill fixtures in both directions.
   - Acceptance signal: `node scripts/check-suite.mjs && node --test tests/package-audit.test.mjs tests/check-suite.test.mjs` passes, with stale-index fixtures failing before regeneration and passing after the independent validator is fixed.
   - Validation: canonical pack only in disposable worktree; bounded `bootstrap/**` diff; protected `scripts/lib/contracts.mjs` hunk hash.
   - Acceptance evidence: authoritative inventory proof, manifest schema, stale-index output, payload digest, and bounded diff.
   - Repair attempts: 0
   - Recovery note: restore manifest/index together; T005 alone owns generated payload/index outputs.

11. [completed] Add deterministic evaluation, manifest, and redacted trace contracts
   - Task ID: T011
   - Depends on: T003a, T003b, T005
   - Parallel group: G4
   - Risk: standard (new versioned schemas and evaluation evidence)
   - Owned scope: new `schemas/csm-skill-manifest.schema.json`, `schemas/csm-trace.schema.json`, deterministic fixtures/runner under `tests/evals/**`, and evaluation/trace documentation.
   - Not in scope: live LLM execution in the normal gate, vendor framework adoption, telemetry deployment, dashboards, or A2A; runtime-specific security cases may be integrated after T004a-T004c.
   - Spike candidate: select minimum trace fields and assign schema ownership/version policy; do not assume additive compatibility without legacy fixtures.
   - Actions: define versioned manifest/trace schemas and owners; add invalid/legacy fixtures; cover activation, trajectory, refusal, recovery, artifact correctness, and reproducibility; join trace IDs to artifacts; reject raw prompts/secrets/full tool results by default.
   - Acceptance signal: `node --test --test-concurrency=1 tests/evals/*.test.mjs` passes valid/invalid/legacy schema fixtures and proves trace-to-artifact correlation without sensitive default output.
   - Validation: `node scripts/check-suite.mjs`; offline deterministic fixtures; schema round trips.
   - Acceptance evidence: schemas, compatibility matrix, fixtures, sample redacted records, and evaluator output.
   - Repair attempts: 0
   - Recovery note: retain readers for explicitly supported legacy versions; reject unknown versions with a structured error rather than silently coercing.

12. [completed] Correct README, skill matrix, and release documentation claims
   - Task ID: T012
   - Depends on: T002, T003a, T003b, T003c, T005, T006
   - Parallel group: G5
   - Risk: standard (public documentation and user-facing contract)
   - Owned scope: `README.md`, `bootstrap/release-checklist.md`, `bootstrap/runtime-commands.json` assertions, relevant `SKILL.md` contract text, and generated README sections after reconciling the existing user diff.
   - Not in scope: F-033/F-034 retracted changes, implementation fixes, production publication, CI claims before T008, or overwriting unrelated user edits.
   - Spike candidate: map each README statement to the skill matrix and preserve compatible user hunks explicitly.
   - Actions: label bootstrap experimental/unpublished; use safeguarded install commands; correct capability/signing state; distinguish local tarball from registry replay; add skill-specific capability/write/commit/resume/artifact/prerequisite/publication matrix; correct only upheld/narrowed claims.
   - Acceptance signal: `node scripts/gen-readme-matrix.mjs --check && node scripts/sync-skill-boilerplate.mjs --check && node scripts/check-suite.mjs` passes with assertions for stale command, unsupported public-bootstrap wording, capability count, and replay claims.
   - Validation: read-back against each affected skill, Makefile, protocol, checklist, and grammar; protected README hunk comparison.
   - Acceptance evidence: documentation diff, matrix, assertions, and intentional deferral list.
   - Repair attempts: 0
   - Recovery note: regenerate managed sections; pause on user-hunk conflict.

13. [completed] Add CI and run the final integrated verification gate
   - Task ID: T013
   - Depends on: T002, T003a, T003b, T003c, T003d, T004a, T004b, T004c, T005, T006, T007
   - Parallel group: G6
   - Risk: standard (repository release gate and public automation)
   - Owned scope: `.github/workflows/**` if authorized, `Makefile`, release/test documentation, and final build evidence.
   - Not in scope: automatic publishing, key rotation, dependency upgrades, live-model evaluation in default CI, browser E2E as required offline gate, or unrelated user work.
   - Spike candidate: determine available CI credentials/services; represent credential-dependent jobs as gated and never claim execution without evidence.
   - Actions: include omitted suite-tooling tests in the default test target; replace the known-invalid browse directory command with the supported Node-22 `npm test`; add CI for format/lint/check/package/index/deterministic suites and isolated frozen install; keep E2E/registry/live evaluation separate.
   - Acceptance signal: `make fmt-check && make lint && make check && make test` passes under Node 22 in a disposable environment after the Makefile target is corrected.
   - Validation: serial bootstrap, scan, DDD, autoresearch, upload, and browse suites; isolated `pnpm install --frozen-lockfile --ignore-scripts`; `git diff --check`; final protected-hunk and pathset audit.
   - Acceptance evidence: CI configuration, complete gate output, isolated install transcript, environment versions, payload/index digest, and final blocker matrix.
   - Repair attempts: 0
   - Recovery note: failed final gate routes to its owner; CI changes cannot publish or mutate release artifacts.

14. [completed] Remove bootstrap fixture auto-binding and make schema/fixtures self-consistent
   - Task ID: T014
   - Depends on: T002
   - Parallel group: G7
   - Risk: high (trust boundary and release contract)
   - Owned scope: `tests/protocol/engine.mjs`, `bootstrap/schema.json`, `bootstrap/fixtures/valid.json`, bootstrap trust/protocol fixtures and tests only.
   - Not in scope: production key generation, publication, or unrelated validator behavior.
   - Spike candidate: none; the normal engine must reject missing binding, while fixture-only test helpers must construct explicitly bound envelopes.
   - Actions: remove default auto-binding and signature deletion from the normal protocol engine; require `payload_index_sha256` in the committed bootstrap schema and canonical valid fixture; update tests to bind fixtures explicitly and add a negative normal-engine omission case.
   - Acceptance signal: `node scripts/with-node22.mjs --exec node --test tests/protocol/*.test.mjs tests/bootstrap-trust.test.mjs tests/integration/bootstrap-flow.test.mjs` passes and an unbound normal-engine envelope refuses before mutation.
   - Validation: `node scripts/check-suite.mjs`; schema/fixture read-back; payload regeneration if bootstrap sources change.
   - Acceptance evidence: negative test, required-schema field, bound fixture digest, and no auto-binding path.
   - Repair attempts: 0
   - Recovery note: preserve fixture-only local flow explicitly; never restore implicit binding for convenience.

15. [completed] Bind autoresearch execution policy to the run contract
   - Task ID: T015
   - Depends on: T004a
   - Parallel group: G7
   - Risk: high (reproducibility and evaluator authority)
   - Owned scope: `csm-autoresearch/lib/optimizer/index.mjs`, policy/contract tests and fixtures only.
   - Not in scope: new isolation mechanisms or provider redesign.
   - Spike candidate: none; canonical policy equality is the required invariant.
   - Actions: require canonical equality or a verified policy hash between `contract.policy` and the execution policy; execute only the contract policy; add mismatch and equivalent-policy fixtures.
   - Acceptance signal: `cd csm-autoresearch && node --test --test-concurrency=1 test/*.test.mjs` passes and a policy mismatch refuses before evaluator execution.
   - Validation: `node --check`; inspect provenance policy hash and hostile mismatch output.
   - Acceptance evidence: mismatch refusal, canonical equality/hash assertion, and updated provenance test.
   - Repair attempts: 0
   - Recovery note: old ledgers with policy mismatch remain blocked; no silent rebasing.

16. [completed] Enforce evaluation and trace records against declared schemas
   - Task ID: T016
   - Depends on: T006
   - Parallel group: G7
   - Risk: high (evaluation integrity and public schema contract)
   - Owned scope: `tests/evals/runner.mjs`, `schemas/csm-skill-manifest.schema.json`, `schemas/csm-trace.schema.json`, and evaluation fixtures/tests only.
   - Not in scope: live-model execution, telemetry deployment, or vendor schema libraries.
   - Spike candidate: select a dependency-free complete validator or implement the full required-field/additional-property/enum/ID checks locally; no schema claims without equivalent enforcement.
   - Actions: make runner validation cover the declared schema constraints; add missing-field, illegal-property, enum, ID, and malformed nested-record fixtures; ensure legacy compatibility is explicit and unknown versions fail closed.
   - Acceptance signal: `node --test --test-concurrency=1 tests/evals/*.test.mjs` passes all valid/invalid/legacy fixtures, including cases the current partial validator accepts incorrectly.
   - Validation: `node scripts/check-suite.mjs`; lint and format checks; compare runner rules against both schemas.
   - Acceptance evidence: schema-to-runner coverage matrix and negative fixture output.
   - Repair attempts: 0
   - Recovery note: unknown schema versions remain rejected; preserve explicitly supported legacy readers only.

17. [completed] Close privacy-test and E2E documentation gaps
   - Task ID: T017
   - Depends on: T004b, T004c, T008
   - Parallel group: G7
   - Risk: standard with security review (privacy evidence and user-facing behavior)
   - Owned scope: DDD privacy tests/serializer, upload content-scan/refusal tests and implementation if needed, `Makefile` E2E description only.
   - Not in scope: broad secret-detection redesign, real publication, or unrelated README changes.
   - Spike candidate: define bounded content scanning for text/SVG/metadata and explicit residual limits; do not claim binary inspection beyond supported formats.
   - Actions: redact/normalize absolute paths in the common DDD serializer and assert them in direct renderer/graph tests; make autoresearch credential test read and assert candidate output is credential-free; add bounded upload content scanning/refusal for supported text artifacts; correct the Makefile E2E comment to describe skip-by-default and `CSM_BROWSE_E2E_REQUIRE=1`.
   - Acceptance signal: `node --test --test-concurrency=1 tests/evidence-status.test.mjs csm-ddd/test/*.test.mjs csm-upload/tests/upload.test.mjs` passes with absolute-path/credential/content canaries absent and the corrected E2E wording present.
   - Validation: full DDD, upload, and autoresearch suites; no network or external publication; lint/format/check-suite.
   - Acceptance evidence: canary tests, content-scan limits, corrected Makefile comment, and residual privacy limitations.
   - Repair attempts: 0
   - Recovery note: unsupported content types remain explicitly unverified or refused; prior artifacts remain untouched on validation failure.

18. [completed] Sanitize DDD run IDs and upload descriptions
   - Task ID: T018
   - Depends on: T012
   - Parallel group: G8
   - Risk: standard with security review (persisted/public text disclosure)
   - Owned scope: `csm-ddd/lib/ddd/render.mjs`, DDD render/privacy tests, `csm-upload/scripts/upload.mjs`, upload tests only.
   - Not in scope: broad privacy redesign, real publication, README, or unrelated runtime code.
   - Spike candidate: none; run IDs must be bounded safe identifiers and descriptions must pass the same supported content scan before index generation.
   - Actions: sanitize or strictly validate `runId` before Markdown/JSON emission; scan/reject `--desc` content for credentials and absolute paths before generating `index.html`; add direct renderer and description canaries.
   - Acceptance signal: `node --test --test-concurrency=1 csm-ddd/test/*.test.mjs csm-upload/tests/upload.test.mjs` passes with runId/description canaries rejected or redacted.
   - Validation: lint, format, check-suite; no external publication.
   - Acceptance evidence: direct artifact output checks, description refusal test, and residual supported-format limits.
   - Repair attempts: 0
   - Recovery note: invalid runId/description produces no final artifact; prior outputs remain unchanged.

19. [completed] Put evaluation-schema tests on the default gate
   - Task ID: T019
   - Depends on: T011, T008
   - Parallel group: G8
   - Risk: standard (evaluation integrity and release gate wiring)
   - Owned scope: `Makefile`, `scripts/check-suite.mjs` or its test coverage, evaluation tests/documentation only.
   - Not in scope: live models, telemetry, vendor runtimes, or schema redesign.
   - Spike candidate: none; default `make test` must execute the deterministic evaluation/schema suite.
   - Actions: add `tests/evals/*.test.mjs` to the default test target or make an equivalent check-suite gate enforce schema/fixture coverage; add a regression proving removal/omission of an eval fixture cannot silently pass.
   - Acceptance signal: `PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" make test` includes and passes the evaluation-schema tests, with `node --test --test-concurrency=1 tests/evals/*.test.mjs` evidence recorded.
   - Validation: `make check`, full format/lint, and CI workflow read-back.
   - Acceptance evidence: default-gate output names eval tests and omission regression proof.
   - Repair attempts: 0
   - Recovery note: gate-wiring failure routes back to Makefile/check-suite ownership; no live evaluation is introduced.

## Verification Strategy

1. Fast static checks per task: `node --check`, JSON parsing/schema checks, contract/corpus checks, and bounded diff inspection.
2. Focused unit/negative tests: commit pathsets, state transitions, schema/runtime parity, redaction, endpoint validation, provenance, and stale-index fixtures.
3. Serial skill suites: bootstrap, autoresearch, browse unit, upload, DDD, and scan. Never run payload-mutating suites concurrently.
4. Documentation/generator checks: README matrix, boilerplate parity, release command grammar, and check-suite.
5. Final batch gate: `make fmt-check`, `make lint`, `make check`, `make test`, isolated frozen install, and CI configuration validation.
6. Environment-sensitive checks remain separate: browser Docker E2E, actual registry replay, production publication, and live-model evaluation. Their absence must be reported as unverified, never as passed.

## Risks And Recovery

- **Trust-root ambiguity:** block T002 publication work until custody and authority are explicit; retain fixture-only posture.
- **Security-boundary overclaim:** if host isolation cannot be enforced, narrow the contract and add fail-closed refusal rather than recording a false guarantee.
- **Generated-file drift:** regenerate only through the packer; inspect bounded diffs and restore payload/index together.
- **User-change collision:** preserve current `README.md` and `scripts/lib/contracts.mjs` changes; stop on conflicting hunks for explicit reconciliation.
- **Durable-state migration:** write new control metadata before deleting old evidence; support forward recovery from partial checkpoints.
- **Public publication:** separate local preparation, push, deployment readiness, and public verification; no automatic publication.
- **Test flakiness:** use serial filesystem-heavy suites and Node 22; record any environment-sensitive skip.
- **Scope expansion:** keep A2A, vendor runtime adoption, dashboards, dependency upgrades, real key operations, and live production calls outside this plan.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Production trust and isolation decisions are unresolved | high | Added T001 decision gate and explicit blockers; dependent tasks cannot guess security policy. | Uncertainty scout R3; applicability unresolved risks. |
| Shared lifecycle changes could overlap or over-generalize | high | Split into T003a commit scope, T003b lifecycle/recovery, T003c evidence status, and T003d DDD publication with disjoint ownership. | Review findings F-007-F-017; execution graph. |
| Runtime limits may not be enforceable | high | T004a requires host-enforcement proof or narrowed trusted-process wording and hostile tests; T004b/T004c separately own publication and privacy boundaries. | Review F-003/F-004; uncertainty scout. |
| Packaging validation can mask stale index | medium | T005 separates read-only validation from regeneration and adds stale-index fixtures. | Review F-022/F-023; gate audit. |
| README review contained retracted findings | medium | T007 implements upheld claims only and records challenged/retracted exclusions. | Independent challenge and research adjudication. |
| Live eval could contaminate normal gates | medium | T006 keeps deterministic offline evaluation separate from future gated live evaluation. | Research R10/R11 and D9. |
| Known-invalid browse command and omitted suite-tooling gate | high | T004b uses supported `csm-browse` `npm test`; T008 corrects the Makefile target and adds suite-tooling tests before final verification. | Prior Node-22 gate evidence; review F-004. |
| Applicability obligations lacked concrete evidence mapping | high | Added Obligation Map and task-level parity, observable behavior, rollback, security, and generated-artifact evidence requirements. | Applicability block and execution tasks. |
| User-change preservation was only prose | medium | T001 records protected hunk hashes; T005/T007/T008 require before/after pathset and hunk verification. | Current worktree baseline and T001/T005/T007/T008. |
| Schema/trace compatibility was unsupported | medium | T006 assigns version ownership and requires valid/invalid/legacy fixtures; unknown versions fail closed. | T006 acceptance and recovery notes. |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---:|---|---|---|---|
| 2026-08-24T00:00:00Z | 0 | INTAKE -> DISCOVER | none | User requested a remediation plan; existing research/review artifacts and repository instructions loaded. | DISCOVER |
| 2026-08-24T00:00:00Z | 0 | DISCOVER -> RESEARCH | none | Warranted signals identified: public contracts, persistence, external side effects, security authority, and cross-boundary coordination. | RESEARCH |
| 2026-08-24T00:00:00Z | 0 | RESEARCH -> DRAFT | none | Uncertainty scout, sequencing research, and test/gate audit returned; no implementation commands executed. | DRAFT |
| 2026-08-24T00:00:00Z | 0 | DRAFT -> CRITIQUE | none | Draft plan uses thirteen pending tasks and disjoint dependency waves. | CRITIQUE |
| 2026-08-24T00:00:00Z | 0 | CRITIQUE -> REMEDIATE | none | Independent critique found incomplete finding coverage, an invalid browse command, oversized lifecycle/runtime tasks, weak obligation mapping, and ambiguous ownership. | REMEDIATE |
| 2026-08-24T00:00:00Z | 0 | REMEDIATE -> VERIFY | none | Split lifecycle/runtime tasks, added F-001..F-036 disposition and obligation maps, corrected Node-22 commands, and strengthened protected-diff/rollback evidence. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> SAVED | none | Primary verification passed plan shape, task fields, disposition coverage, obligation mapping, corrected commands, and protected worktree scope; implementation remains unstarted. | SAVED |
| 2026-08-24T00:00:00Z | 0 | BUILD ACTIVATION -> RECOVER | none | User explicitly requested csm-build execution; recovery detected pre-existing README/contracts changes and repaired the applicability task slice before validation. | RECOVER |
| 2026-08-24T00:00:00Z | 0 | RECOVER -> VALIDATE | none | `node scripts/check-suite.mjs` passed: 13 skills, 1144 checks; existing notes only. | VALIDATE |
| 2026-08-24T00:00:00Z | 0 | VALIDATE -> SELECT | none | Applicability record valid after task-slice repair; T001 decisions resolved as fixture-only release, narrowed trusted-process mode, explicit upload confirmation, deferred live model matrix. | SELECT |
| 2026-08-24T00:00:00Z | 0 | SELECT -> DISPATCH | T002, T003a, T003b, T005 | Four disjoint implementation assignments dispatched; T005 is sole owner of generated payload/index outputs. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T002, T003a, T003b, T005 | Workers returned scoped changes without commits; T002 focused suite 51/51, T003a 3/3, T003b 33 plus resume suite, T005 source/index changes. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T002, T003a, T003b, T005 | Canonical pack produced 164 files and digest `d9ad43529f401755094def5c55850caf70c7010a3b61511259ccb8c204bb7267`; check-suite 1145 checks; bootstrap 49 tests; commit/lifecycle/resume 17 tests. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T002, T003a, T003b, T005 | Package/checker regression rerun under Node 22: 32/32 passed after correcting omitted-manifest assertion; no unresolved first-batch gate failures. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> CHECKPOINT | T002, T003a, T003b, T005 | Primary integration review found no out-of-scope worker edits; pre-existing README/contracts changes preserved. | CHECKPOINT |
| 2026-08-24T00:00:00Z | 0 | CHECKPOINT -> SELECT | T002, T003a, T003b, T005 | First batch complete; next ready set is T003c, T003d, T004a, T004b. | SELECT |
| 2026-08-24T00:00:00Z | 0 | SELECT -> DISPATCH | T003c, T003d, T004a, T004b | Four disjoint security/evidence assignments dispatched; T004c remains dependent on T003d. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T003c, T003d, T004a, T004b | Workers returned scoped changes without commits; focused evidence received for evidence status, DDD publication, autoresearch, upload, and browser controls. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T003c, T003d, T004a, T004b | Evidence 5/5, DDD publication 4/4, autoresearch 52/52, upload 11/11, browse 197/197; targeted lint initially found two unused symbols, repaired directly. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T003c, T003d, T004a, T004b | Rechecks passed: autoresearch+DDD 56/56, browse 197/197, runtime lint clean, diff-check clean. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> CHECKPOINT | T003c, T003d, T004a, T004b | Independent worker outputs stayed within owned scopes; trusted-in-process and trusted-local posture is explicitly narrowed, no external systems touched. | CHECKPOINT |
| 2026-08-24T00:00:00Z | 0 | CHECKPOINT -> SELECT | T003c, T003d, T004a, T004b | Second batch complete; next ready set is T004c and T006. | SELECT |
| 2026-08-24T00:00:00Z | 0 | SELECT -> DISPATCH | T004c, T006 | Two disjoint offline privacy/evaluation assignments dispatched; T007 remains dependent on their contracts. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T004c, T006 | Workers returned scoped privacy and evaluation/trace changes without commits; focused evidence received. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T004c, T006 | Payload refreshed to digest `7c3c0dd83e125d697c3a51dc3a7910cfce77d8d068d1242b5b7aa3f5a776fb15`; evidence/eval 12/12, DDD 53/53, scan worker 1254/1254; initial gate exposed missing scan tier registration. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REPAIR | T004c | `node scripts/check-suite.mjs` rejected unlisted `csm-scan/test/privacy.test.mjs`; repaired by registering the focused test in the S tier. | REPAIR |
| 2026-08-24T00:00:00Z | 0 | REPAIR -> VERIFY | T004c | `node scripts/check-suite.mjs` passed 1145 checks after tier registration. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T004c, T006 | Targeted lint and diff checks passed; privacy/evaluation artifacts remain offline and scoped. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> CHECKPOINT | T004c, T006 | Third batch complete; no out-of-scope changes or unresolved focused failures. | CHECKPOINT |
| 2026-08-24T00:00:00Z | 0 | CHECKPOINT -> SELECT | T004c, T006 | Final ready set is T007 and T008. | SELECT |
| 2026-08-24T00:00:00Z | 0 | SELECT -> DISPATCH | T007, T008 | Final documentation and CI/Makefile assignments dispatched; T007 must preserve existing README user changes and T008 must use Node 22-safe commands. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T007, T008 | Workers returned documentation and CI/Makefile changes without commits; T007 reported checks green, T008 reported Node-20/environment-specific gate failures. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T007, T008 | Formatting, lint, check, suite-tooling 47/47, browse npm test 197/197, package index 2/2, deterministic eval 7/7, and full `make test` 1283/1283 passed on Node 22 after repairs. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T007, T008 | Final integrated behavior is green; independent review required for public documentation, CI boundaries, protected user diff, and cumulative security scope. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> REPAIR | T007, T008 | Independent review found bootstrap default auto-binding/schema mismatch, autoresearch policy divergence, incomplete schema enforcement, DDD path/privacy-test gaps, upload content-scan gap, and stale E2E wording. | REPAIR |
| 2026-08-24T00:00:00Z | 0 | REPAIR -> DISPATCH | T009, T010, T011, T012 | Four fresh repair assignments created with disjoint ownership; final gate remains blocked until all material review findings are resolved. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T009, T010, T011, T012 | Repair workers returned scoped changes without commits; focused evidence received for bootstrap binding, policy equality, schema enforcement, and privacy/content controls. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T009, T010, T011, T012 | Repair gates passed: bootstrap 40, autoresearch 54, eval/schema 16, DDD/upload/evidence 71; format, lint, check, and full `make test` 1283/1283 passed on Node 22. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T009, T010, T011, T012 | Fresh repair-focused review required before completion. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> REPAIR | T009, T010, T011, T012 | Review found unsanitized DDD runId, unscanned upload descriptions, and evaluation-schema tests absent from default `make test`. | REPAIR |
| 2026-08-24T00:00:00Z | 0 | REPAIR -> DISPATCH | T013, T014 | Two narrow repair assignments created with disjoint ownership. | DISPATCH |
| 2026-08-24T00:00:00Z | 0 | DISPATCH -> INTEGRATE | T013, T014 | Repair workers returned scoped changes without commits; focused evidence received for runId/description safety and default evaluation-gate wiring. | INTEGRATE |
| 2026-08-24T00:00:00Z | 0 | INTEGRATE -> VERIFY | T013, T014 | Final upload/DDD 69 tests, checker/evaluation 48 tests, format/lint/check passed; payload digest `c90bfe885909c39d9ae4ac4b84fbcd3cbf11e2e2a4c6f123606c76e41c2d4e8f`. | VERIFY |
| 2026-08-24T00:00:00Z | 0 | VERIFY -> REVIEW | T013, T014 | Full Node 22 `make test` passed 1283/1283; final review found path/key and duplicate-index hardening opportunities, then both were repaired and reverified. | REVIEW |
| 2026-08-24T00:00:00Z | 0 | REVIEW -> CHECKPOINT | T009, T010, T011, T012, T013, T014 | All repair findings resolved; final protected diff hash for `README.md` + `scripts/lib/contracts.mjs` is `d1601bce33f5572c91b9c12de0c5ca76a093f60a57916a0bd56e72f16910971e`; no external actions performed. | CHECKPOINT |
| 2026-08-24T00:00:00Z | 0 | CHECKPOINT -> COMPLETE | all | Acceptance criteria verified, all tasks complete, release-only external actions explicitly residual, and implementation intentionally uncommitted per plan policy. | COMPLETE |

## Completion Review

Completion status: complete.

- All 19 tasks are complete, including final repairs T009-T014.
- `make test` passed 1,283/1,283 under Node `v22.23.2`.
- `make fmt-check`, `make lint`, and `node scripts/check-suite.mjs` passed; check-suite reports `OK — 13 skills, 1145 checks` with existing informational notes only.
- Focused acceptance evidence includes bootstrap 40 tests, autoresearch 54 tests, evaluation/schema 48 combined tests, DDD/upload/privacy 69 tests, suite-tooling 47 tests, and browse 197 tests.
- Canonical payload regenerated through `scripts/pack-bootstrap.mjs`; final tarball digest: `c90bfe885909c39d9ae4ac4b84fbcd3cbf11e2e2a4c6f123606c76e41c2d4e8f`, 164 files, 638671 bytes.
- Existing user changes in `README.md` and `scripts/lib/contracts.mjs` were preserved and reconciled; final combined protected diff hash is recorded above.
- No commits, pushes, production publication, key generation/rotation, registry replay, real Pages deployment, browser E2E, or live-model evaluation were performed.
- Remaining release-only actions are intentionally blocked and documented in `bootstrap/release-checklist.md`; they require separate approval, credentials, and external evidence.
