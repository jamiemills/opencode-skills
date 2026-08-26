format: csm-plan/1

# JSON Migration Hardening Remediation CSM Plan

## How To Execute

- Start work only through a separate, explicit `csm-build` invocation naming this plan; planning does not begin implementation.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 8 high-risk tasks covering public input boundaries, persistence, integrity, concurrency, compatibility, and final evidence. Every task requires independent review before completion.
- This plan supersedes the completion interpretation of the prior JSON migration only for the gaps identified by the 2026-08-26 assessment; it does not redo completed producer/renderer work.

## Control

- Plan ID: json-migration-hardening-remediation
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-26 plan drafted from the implementation assessment, four local research tracks, adversarial challenge, and judge remediation; no implementation started.
- Last model/run: gpt-5.6-luna csm-plan run 2026-08-26.
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff.

## Goal

Harden the completed JSON documentation migration so its production-readiness claim matches observable evidence and its remaining cross-skill boundaries are explicit and enforceable.

Deliver:

- JSON-authoritative DDD norms input and persisted/generic runtime handoffs for all five currently unsupported edges: scan -> review, DDD -> plan, research -> grill, research -> make-tests, and review -> grill.
- A documented and enforced digest taxonomy separating file bytes, canonical payload, source lineage, and descriptor identity.
- Uniform duplicate-key-safe durable parsing, hostile concurrent/crash-safe writes, bounded artifact discovery, and no silent resource exhaustion.
- Positive producer-output replay coverage for every declared edge, including ownership, schema revision, digest, terminal, resume, and failure behavior.
- A machine-readable environment/final-gate receipt that distinguishes verified, unavailable, and not-run evidence.
- Bootstrap import-closure verification without brittle, untested packaging drift.

Constraints:

- Preserve existing canonical JSON artifacts, compatibility adapters, Markdown/HTML projections, and legacy Markdown history.
- Do not auto-convert arbitrary historical Markdown.
- Use local synthetic fixtures and isolated temporary directories for experiments; no production data or external mutation during implementation except an explicitly authorized live verification.
- Do not weaken existing gates to make the new acceptance signals pass.

## Acceptance Criteria

1. All five declared edges either resolve valid canonical JSON producer outputs or are removed from the acceptance inventory with explicit user approval; this plan assumes all five are required.
2. DDD and review consume registered JSON norms artifacts as machine inputs; `NORMS.md` remains history or explicit human hint only and cannot be authoritative machine input.
3. Every digest field has one documented meaning and mutation tests reject file/payload/source/descriptor confusion.
4. Every durable JSON reader rejects duplicate keys, every durable writer is safe against hostile same-user concurrency and interruption, and discovery has deterministic file/byte/depth/concurrency limits.
5. Every new handoff has positive replay fixtures from actual producer constructors/writers or checked-in producer-shaped fixtures whose lineage and semantics are independently verified.
6. Final verification produces an immutable machine-readable receipt binding commit, environment, commands, counts, durations, package/payload identity, replay results, unavailable checks, and residual risks.
7. Canonical/bootstrap import closure is executable-tested and all existing repository gates remain green.

## Current-State Evidence

- The implementation assessment concludes the migration is substantially implemented but release-hardening incomplete: `.agents/research/2026-08-26-json-migration-implementation-assessment-research.md:21-30,42-68`.
- The original research recommends JSON Schema, direct sibling renderers, projection boundaries, compatibility adapters, and preservation of Markdown history: `.agents/research/2026-08-25-typed-json-interstage-payloads-research.md:17-38,109-127,129-168`.
- The agreed approach sequences foundation, renderers, publication, producers, consumers, cutover, and final gates: `.agents/approaches/2026-08-25-json-only-rendered-skill-outputs-approach.md:15-31,62-81`.
- The prior plan records all 24 tasks and local gates but does not retain a machine-readable final receipt: `.agents/plans/2026-08-25-json-only-rendered-skill-outputs-csm.md:614-630,833-850`.
- DDD still reads Markdown norms and exposes an explicit norms path: `csm-ddd/scripts/ddd.mjs:24-33`; `csm-ddd/lib/ddd/extract.mjs:121-182`.
- The current replay matrix documents five missing persisted/generic consumers: `tests/consumer-replay-matrix.test.mjs:51-83`.
- Shared artifact discovery and packaging import rewriting are the main operational seams: `lib/artifact-resolver/index.mjs:317-335`; `scripts/pack-bootstrap.mjs:305-327`.

### Applicability

New plans must include exactly one fenced JSON applicability record here. The record is evidence of the planning decision, not a claim that DDD inference is ground truth.

```json csm-applicability/1
{
  "format": "csm-applicability/1",
  "decision": "warranted",
  "mode": "risk-first",
  "matchedSignals": [
    "boundary_change",
    "public_contract",
    "ownership_or_persistence",
    "invariant_or_consistency",
    "migration_or_rollback",
    "cross_boundary_coordination",
    "security_or_authority"
  ],
  "evidence": [
    {
      "source": "repository",
      "locator": ".agents/research/2026-08-26-json-migration-implementation-assessment-research.md:46-68",
      "observation": "The completed migration has documented DDD/norms, replay, integrity, and retained-evidence gaps that affect public machine boundaries and recovery."
    },
    {
      "source": "brief",
      "locator": "user decisions in planning session",
      "observation": "All five missing edges are required; JSON norms are authoritative; digest fields are separated; concurrent/crash-hostile hardening is required."
    }
  ],
  "obligations": [
    { "id": "boundary", "status": "required" },
    { "id": "ownership", "status": "required" },
    { "id": "contract", "status": "required" },
    { "id": "invariant", "status": "required" },
    { "id": "observable_behavior", "status": "required" },
    { "id": "seam", "status": "required" },
    { "id": "parity", "status": "required" },
    { "id": "rollback_recovery", "status": "required" },
    { "id": "unresolved_risks", "status": "required" }
  ],
  "taskApplicability": {
    "warranted": ["T001","T002","T003","T004","T005","T006","T007","T008"],
    "lightweight": []
  },
  "dddArtifacts": [],
  "unresolvedRisks": [
    "Actual runtime callers for the five missing edges must be confirmed during T001 before choosing adapter shapes.",
    "Crash durability beyond same-directory atomic rename may require a repository-supported fsync strategy.",
    "Live external publication is evidence-only and must never be represented as a local gate pass."
  ],
  "bypass": { "requested": false, "rationale": null }
}
```

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | All five currently unsupported producer-consumer edges are required machine-runtime handoffs. | user-confirmed decision | User selected all five during planning. | decided |
| D2 | DDD consumes registered JSON norms as authoritative machine input; NORMS.md is history or an explicit human hint only. | user-confirmed decision | User selected JSON authoritative during planning. | decided |
| D3 | Digest meanings are separated into fileDigest, payloadDigest, sourceDigest, and descriptorDigest where each family needs them. | user-confirmed decision | User selected separate digest fields during planning. | decided |
| D4 | The threat model includes hostile same-user concurrency, symlink races, interruption, resource exhaustion, and recovery. | user-confirmed decision | User selected concurrent/crash-hostile hardening during planning. | decided |
| D5 | Existing migration commits remain the baseline; this plan fixes only assessment findings and evidence gaps. | scope constraint | Assessment and prior completion record. | decided |
| D6 | Existing live browser/publication success is observed evidence, not a substitute for a retained final receipt. | safety constraint | Assessment R9 and live session result. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | Did the original architecture and sequencing match implementation? | Four independent local repository research tracks plus adversarial challenge and judge. | Read-only inspection; no implementation changes. | Core architecture and sequence were substantially aligned; completion evidence was overstated. | Preserve the architecture; target gaps rather than redesign. |
| R2 | Which gaps are material? | Compared assessment claims with source, schema, tests, Makefile, and plan. | Read-only repository inspection. | DDD/norms, five handoffs, digest semantics, durable parsing/writes, discovery bounds, bootstrap closure, and final receipt remain. | Create separate acceptance-backed tasks with explicit dependencies. |
| R3 | What user-owned choices affect scope? | Four clarification questions. | No project mutation. | User selected all five edges, JSON norms, separate digests, and hostile concurrency/crash coverage. | Treat these as fixed plan decisions. |

## Discovered Requirements

- Node policy is `>=22 <25`; pnpm and existing lockfiles are authoritative: `package.json` and `Makefile:8-82`.
- Canonical sources must be changed before bootstrap payloads; generated payloads and indexes must be regenerated with `scripts/pack-bootstrap.mjs`.
- `make test` is composed and must be supplemented by named acceptance commands and a retained final receipt.
- The repository rejects duplicate-key JSON through `parseJson`; durable readers still need inventory and migration to that parser.
- Legacy Markdown remains present intentionally and must be classified as history, not silently parsed.
- Full gates are expensive; run focused tests first, then subsystem suites, then final gates.
- Existing worktree has unrelated untracked research artifacts; implementation must not remove or commit them.

## Design

### Boundary and edge inventory

T001 creates a machine-readable edge inventory mapping producer, consumer entry point, schema, owner, run identity, digest fields, path, terminal behavior, and rollback flag. The inventory is the source for later replay and final receipt checks; positive replay is owned by T003.

### JSON norms and consumer handoffs

DDD loads `csm-norms/1` through the shared resolver and rejects Markdown as an authoritative input. Review, plan, grill, and make-tests receive typed JSON descriptors with owner, source run, source digest, and schema revision checks. Missing edge behavior is not hidden behind repeated generic rejection tests.

### Digest taxonomy

- `fileDigest`: exact serialized file bytes, verified while reading a path.
- `payloadDigest`: canonical JSON payload excluding its digest field.
- `sourceDigest`: lineage binding to the upstream artifact or plan.
- `descriptorDigest`: canonical descriptor identity excluding the descriptor digest itself.

Each descriptor documents which fields it carries; mutation tests vary whitespace, key order, bytes, embedded payload, source identity, and descriptor metadata independently.

### Durable safety

All durable JSON reads use duplicate-key-safe parsing. Writers use unique same-directory temporary files, exclusive creation, no-follow path checks, atomic replacement, explicit lock ownership, cleanup/quarantine, and recovery fixtures. Discovery has max depth, files, bytes, records, and in-flight work with deterministic capped/rejected outcomes.

### Evidence receipt

T007 defines a versioned JSON receipt with commit, environment, exact command list, per-command exit/count/duration, package/payload digests, replay matrix, review result, live-E2E/publication status, unavailable evidence, and residual risks. T008 generates it only from observed results, binds it to the tested source commit, and records its later receipt commit separately.

## Execution Graph

```text
T001 edge inventory and replay contract
  |\
  | +--> T002 DDD JSON norms and edge adapters
  | +--> T003 positive producer-consumer replay fixtures
  +----> T004 digest taxonomy and binding
             |\
             | +--> T005 parser, atomic-write, and concurrency hardening
             |       |
             |       +--> T006 bounded discovery and resource policy
T002/T003/T004/T005/T006 --> T007 bootstrap closure and import smoke
T001-T007 -----------------> T008 final receipt and completion gates
```

- G1: T001 is serialized because it fixes the edge inventory and acceptance source of truth.
- G2: T002 and T004 may run in parallel after T001; T002 owns DDD/consumer adapters and T004 owns digest contracts/shared resolver only.
- G3: T003 depends on T001/T002 and owns fixtures/tests only; T005 then T006 run serially behind T004 with disjoint durable-reader/writer and discovery-limit ownership.
- G4: T007 depends on all packaged-runtime changes and owns bootstrap/import validation.
- G5: T008 is final and owns only receipt/preflight/final-gate evidence.

## Numbered Plan

1. [pending] Establish the authoritative producer-consumer edge inventory and replay contract.
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high
   - Owned scope: edge inventory schema/descriptor, replay fixture manifest, and inventory contract tests; positive replay remains T003-owned.
   - Not in scope: changing producer semantics, DDD behavior, or consumer implementations.
   - Spike candidate: none; inspect actual callers and CLI entry points before locking each edge.
   - Actions: Enumerate all 17 edges; mark all five previously missing edges as required; identify actual runtime entry points; define per-edge schema/owner/run/digest/terminal/recovery expectations; publish a versioned inventory consumed by later replay tests.
   - Acceptance signal: `node --test --test-concurrency=1 tests/consumer-edge-inventory.test.mjs` validates the inventory and exact required edge list without claiming positive replay.
   - Validation: inspect all resolver call sites; verify no edge is silently classified human-only; run existing plan/BDD/test replay tests.
   - Acceptance evidence: versioned edge inventory, caller map, required/unsupported classification, and rollback flag per edge.
   - Repair attempts: 0
   - Recovery note: If an edge has no actual runtime entry point, preserve its rejection fixture and record the user-approved removal decision before proceeding.

2. [pending] Make JSON norms authoritative for DDD and implement missing persisted consumer handoffs.
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high
   - Owned scope: DDD norms input, csm-review norms contract, csm-plan/csm-grill/csm-make-tests persisted input adapters, schemas/registries, and edge-specific tests.
   - Not in scope: rewriting historical Markdown or changing DDD analysis semantics unrelated to norms loading.
   - Spike candidate: none; envelope-versus-payload choice is fixed by existing `csm-norms/1` schema and caller inspection.
   - Actions: Resolve registered `csm-norms/1` `NORMS.json` through the shared boundary; reject Markdown authoritative input; add typed adapters for scan→review, DDD→plan, research→grill, research→make-tests, and review→grill; preserve owner/run/source digest lineage and explicit rollback flags.
   - Acceptance signal: `node --test --test-concurrency=1 tests/ddd-norms-json-contract.test.mjs tests/consumer-edge-adapter.test.mjs csm-ddd/test/cli.test.mjs csm-ddd/test/extract.test.mjs` passes adapter contracts without owning the full replay matrix.
   - Validation: valid JSON norms, wrong owner, unknown revision, stale digest, Markdown path, projection input, and legacy history cases.
   - Acceptance evidence: DDD JSON norms contract, five adapter contracts, exact rejection codes, and preserved Markdown history fixtures.
   - Repair attempts: 0
   - Recovery note: Keep each new adapter disabled until its source schema, owner, run, digest, and terminal behavior pass T001 fixtures.

3. [pending] Add positive producer-output replay and semantic preservation coverage.
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G3
   - Risk: high
   - Owned scope: replay fixture builders and tests for norms, DDD pair, research, review/doctrine, grill, plan, BDD, make-tests, build, browse, and upload.
   - Not in scope: production producer changes except minimal test-only hooks required to obtain canonical output.
   - Spike candidate: none.
   - Actions: Generate or copy canonical artifacts in isolated temporary roots; replay each edge successfully; assert schema revision, owner, run/source lineage, digest taxonomy, task/scenario/claim identity, terminal state, resume, malformed, and rollback behavior.
   - Acceptance signal: `node --test --test-concurrency=1 tests/consumer-replay-matrix.test.mjs tests/bdd-build-replay.test.mjs tests/make-tests-build-replay.test.mjs tests/plan-consumer-replay.test.mjs` passes with positive producer artifacts.
   - Validation: mutate each digest/owner/run/schema/path independently; verify rejection codes and no fallback to Markdown.
   - Acceptance evidence: producer-to-consumer matrix with observed values, not only status assertions; mutation and recovery results.
   - Repair attempts: 0
   - Recovery note: If a producer cannot emit a stable fixture without external services, record `unavailable` and keep the edge blocked rather than substituting a weaker pass.

4. [pending] Standardize digest taxonomy and descriptor-to-file binding.
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2
   - Risk: high
   - Owned scope: digest taxonomy schemas/helpers, shared artifact resolver digest binding, and digest mutation tests; no durable-reader or discovery-limit files.
   - Not in scope: changing canonical JSON number normalization unless a separate cross-language requirement is evidenced.
   - Spike candidate: none; use the four user-selected digest meanings.
   - Actions: Name and document fileDigest/payloadDigest/sourceDigest/descriptorDigest; require each applicable field; bind persisted descriptors to actual bytes and upstream identity; preserve adapter behavior through explicit source lineage.
   - Acceptance signal: `node --test --test-concurrency=1 tests/artifact-resolver.test.mjs tests/plan-compatibility.test.mjs tests/build-json-control.test.mjs tests/browse-upload-json-contract.test.mjs` passes all digest mutation cases.
   - Validation: whitespace/key-order, byte mutation, embedded payload, source run/artifact, descriptor metadata, and terminal replacement cases.
   - Acceptance evidence: digest taxonomy table, schema changes, positive/negative matrix, and compatibility replay output.
   - Repair attempts: 0
   - Recovery note: Reject ambiguous legacy records with structured migration errors; do not reinterpret an old digest silently.

5. [pending] Harden durable parsing, atomic writes, locks, and crash recovery.
   - Task ID: T005
   - Depends on: T004
   - Parallel group: G3
   - Risk: high
   - Owned scope: durable JSON/JSONL readers and writers in publication, DDD, scan, autoresearch, browse, upload, and make-tests paths; failure-injection tests. Shared discovery remains T006-owned.
   - Not in scope: live data migration, deletion of historical Markdown, or weakening existing rollback behavior.
   - Spike candidate: isolated temporary-directory interruption experiment to verify file-plus-directory flush behavior; fsync is required where supported.
   - Actions: route durable reads through duplicate-key-safe parsing; use exclusive unique temporary files, no-follow component checks, lock ownership, file/directory flush, atomic replacement, quarantine, and prior-artifact preservation; make JSONL recovery detect partial tails and duplicate identities.
   - Acceptance signal: `node --test --test-concurrency=1 tests/publication-protocol.test.mjs tests/artifact-resolver.test.mjs tests/make-tests-json-contract.test.mjs tests/browse-upload-json-contract.test.mjs` passes interruption, collision, duplicate-key, lock, and recovery cases.
   - Validation: isolated concurrent writers, symlink races, partial writes, stale lock ownership, and unchanged prior artifact checks.
   - Acceptance evidence: failure-injection log, lock/recovery matrix, duplicate-key matrix, and rollback-preservation evidence.
   - Repair attempts: 0
   - Recovery note: Never delete a prior complete artifact; interrupted state remains diagnosable and either resumes or quarantines explicitly.

6. [pending] Add bounded artifact discovery and deterministic resource-failure behavior.
   - Task ID: T006
   - Depends on: T004
   - Parallel group: G3
   - Risk: high
   - Owned scope: shared artifact discovery limits, traversal scheduler, capped/unverified result model, and resource-limit tests.
   - Not in scope: changing DDD’s existing limits or treating capped coverage as proof of absence.
   - Spike candidate: isolated synthetic tree/JSONL stress fixture only; no repository-wide unbounded scan.
   - Actions: Add defaults of depth 8, 256 files, 64 MiB total bytes, 8 MiB per file, 1024 JSONL records, and 8 in-flight reads; reject breaches with deterministic `resource-limit`; preserve symlink/path containment.
   - Acceptance signal: `node --test --test-concurrency=1 tests/artifact-resolver-limits.test.mjs tests/artifact-resolver.test.mjs` passes oversized tree, oversized JSONL, depth, concurrency, symlink, and deterministic error cases.
   - Validation: repeated runs produce identical result/error codes; normal repositories remain below defaults.
   - Acceptance evidence: limit policy, synthetic stress results, normal-path replay, and no-resource-leak evidence.
   - Repair attempts: 0
   - Recovery note: A capped result must be visible as bounded uncertainty and cannot authorize a missing-artifact or absence claim.

7. [pending] Make bootstrap import closure explicit and executable-tested.
   - Task ID: T007
   - Depends on: T002, T004, T005, T006
   - Parallel group: G4
   - Risk: high
   - Owned scope: `scripts/pack-bootstrap.mjs`, bootstrap import-closure tests, payload mappings/indexes, and generated payload parity.
   - Not in scope: broad packer redesign or hand-editing generated payloads.
   - Spike candidate: isolated copied payload import-closure probe for every newly mapped runtime module and supported import form.
   - Actions: Validate every rewritten shared import resolves from the generated payload; fail on unmapped imports, missing closure files, alternate quote/path forms, and registry/schema closure gaps; retain canonical/bootstrap parity.
   - Acceptance signal: `node --test --test-concurrency=1 tests/bootstrap-import-closure.test.mjs tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs && make test-package-index`.
   - Validation: `node scripts/pack-bootstrap.mjs`, `make check`, `make lint`, and `make fmt-check`.
   - Acceptance evidence: import graph result, generated payload digest/index, and clean package audit.
   - Repair attempts: 0
   - Recovery note: If closure fails, keep the prior payload mapping active and do not enable new consumers.

8. [pending] Capture authoritative environment and final-gate receipt.
   - Task ID: T008
   - Depends on: T001, T002, T003, T004, T005, T006, T007
   - Parallel group: G5
   - Risk: high
   - Owned scope: preflight/receipt schema, final evidence writer, named final-gate command manifest, and `.agents` evidence only.
   - Not in scope: modifying production behavior to satisfy a receipt, live external publication without separate authorization, or marking unavailable checks as verified.
   - Spike candidate: none; environment policy and existing gates are known.
   - Actions: Add `tests/environment-preflight.test.mjs` and a receipt writer/runner; define an immutable receipt binding the tested source commit, Node/pnpm, dependencies, Docker/E2E availability, exact commands, counts, durations, package/payload digests, replay matrix, review status, unavailable evidence, and residual risks; commit the receipt afterward and record both SHAs.
   - Acceptance signal: `node --test --test-concurrency=1 tests/environment-preflight.test.mjs tests/final-receipt.test.mjs && node scripts/run-final-receipt.mjs && make fmt-check && make lint && make check && make test-bootstrap && make test-suite-tooling && make test-package-index && make test-deterministic && make test-ddd && make test-autoresearch && make test-scan && make test-browse && make test-upload && make test`.
   - Validation: receipt schema negatives, commit mismatch, fabricated count, missing command, unavailable E2E, protected worktree, and full `git status --short` review.
   - Acceptance evidence: final JSON receipt, environment preflight output, all command results, review approvals, live E2E/publication status, and residual-risk list.
   - Repair attempts: 0
   - Recovery note: If any required gate or receipt binding fails, return to the affected task; never mark T008 complete from plan prose alone.

## Verification Strategy

- T001-T004: focused schema/resolver/replay tests first; verify owner, source lineage, digest meaning, and projection/legacy rejection.
- T005-T006: isolated failure-injection and resource-bound tests; no repository or external-service mutation.
- T007: regenerate bootstrap from canonical sources, run import smoke, package index, trust, parity, lint, and format checks.
- T008: run preflight, receipt tests, then the exact final command sequence. Use Node 22 wrapper for Node-22-gated suites.
- Independent review is required for every task because all tasks affect persistence, public contracts, security, or cross-boundary behavior.
- Browser E2E and live publication may be recorded as verified only when explicitly rerun and included in the receipt; otherwise record `unavailable` or `session-observed`.

## Risks And Recovery

- Edge inventory overreach: resolve actual callers in T001; if an edge is human-only, require explicit user approval before removing it.
- Digest migration rejection: keep adapters for supported old JSON, reject ambiguous records with migration-required errors, and preserve prior artifacts.
- Concurrent/crash corruption: use lock ownership, unique temporary names, no-follow checks, atomic replacement, and quarantine; restore the last complete artifact on failure.
- Resource exhaustion: bound traversal and concurrency; surface capped uncertainty rather than inventing absence.
- Bootstrap drift: canonical sources remain authoritative; regenerate payloads and reject unmapped import closure.
- Evidence overstatement: T008 binds receipt to the actual commit and command outputs; unavailable live operations remain unavailable.
- Existing untracked research artifacts: do not delete, stage, or commit them.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| Five missing edges may be out of runtime scope. | high | User selected all five as required; T001 still inventories actual entry points before adapter implementation. | Planning clarification; assessment Unverified Claims. |
| DDD norms source is ambiguous. | high | User selected JSON authoritative; T002 defines Markdown as history/human hint only. | `csm-ddd/lib/ddd/extract.mjs:121-182`; user decision. |
| Digest meanings are mixed. | high | User selected separate digest taxonomy; T004 owns explicit fields and mutation tests. | Assessment Detail Section 5; user decision. |
| Final gate evidence is not retained. | high | T008 adds preflight and immutable machine-readable receipt. | Assessment Detail Section 3; T024 acceptance gap. |
| Bootstrap imports can drift. | medium | T007 adds generated import-closure smoke tests while retaining minimal packer transformation. | `scripts/pack-bootstrap.mjs:305-327`. |
| Live browser/publication status could be overstated. | medium | T008 distinguishes verified, unavailable, and session-observed evidence. | Assessment Detail Section 7; live session record. |
| T001 duplicated positive replay and overlapped T002/T003 ownership. | high | T001 is inventory-only; T003 owns all positive replay; T002 owns adapter contracts. | Independent plan critique. |
| T005/T006 both appeared to own shared resolver work. | high | T005 owns durable readers/writers; T006 owns discovery limits and runs after T005. | Independent plan critique. |
| Receipt commit binding could be circular. | high | T008 records tested source SHA and later receipt SHA separately. | Independent plan critique; D7. |
| Durability and resource policies were underspecified. | medium | D8/D9 define fsync behavior and deterministic bounded defaults. | Independent plan critique. |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-26T00:00:00Z | 0 | INTAKE -> DISCOVER | plan | User requested a csm-plan implementation plan based on the JSON migration assessment. | DISCOVER |
| 2026-08-26T00:00:00Z | 0 | DISCOVER -> RESEARCH | plan | Repository baseline, prior research, approach, completed plan, implementation commits, and assessment identified. | RESEARCH |
| 2026-08-26T00:00:00Z | 0 | RESEARCH -> DRAFT | plan | Four local research tracks and user scope decisions completed. | DRAFT |
| 2026-08-26T00:00:00Z | 0 | DRAFT -> CRITIQUE | plan | Eight pending implementation tasks drafted with dependencies and acceptance signals. | CRITIQUE |
| 2026-08-26T00:00:00Z | 0 | CRITIQUE -> REMEDIATE | plan | Independent critique found overlapping ownership, duplicated acceptance, circular receipt binding, and underspecified DDD/durability/resource behavior. | REMEDIATE |
| 2026-08-26T00:00:00Z | 0 | REMEDIATE -> VERIFY | plan | Plan corrected with inventory-only T001, T003-owned positive replay, serialized T005/T006, explicit DDD JSON contract, deterministic limits, fsync policy, and two-SHA receipt binding. | VERIFY |

## Completion Review

Filled by `csm-build` after all implementation tasks and acceptance evidence are complete. Planning intentionally leaves implementation unstarted.
