format: csm-plan/1

# JSON-Only Rendered Skill Outputs CSM Plan

## How To Execute

- Start work only through a separate, explicit `csm-build` invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in `Control` by `csm-build`.
- Risk summary: 24 pending tasks: 22 high-risk public-contract, persistence, migration, security, or cross-boundary tasks (T001-T005, T008-T024), and 2 standard renderer/profile tasks (T006-T007). T001-T005 and T008-T024 require independent review before completion; T006-T007 still require focused security/determinism tests.
- All implementation tasks remain `pending` until a future explicit `csm-build` run. No source, schema, test, dependency, or configuration change was made during planning.
- Canonical skill sources remain authoritative; bootstrap payloads and indexes must be regenerated through `scripts/pack-bootstrap.mjs`, never hand-edited.

## Control

- Plan ID: `json-only-rendered-skill-outputs`
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 7
- Commits: allowed
- Last checkpoint: 2026-08-25 T010 integrated and repaired; focused resolver acceptance passed 12 tests, `make check` passed 1189 checks, formatting/lint passed, and T010 received independent PROCEED approval.
- Last model/run: gpt-5.6-luna build run 2026-08-25.
- Next transition: CHECKPOINT -> SELECT
- Active tasks: none
- Blockers: none; T006, T008, and T009 contain implementation-time spikes that must resolve before their dependents can activate.
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff.

## Goal

Implement the agreed suite-wide JSON-only output architecture as one cautious multi-phase build:

- JSON Schema Draft 2020-12 is the default contract language.
- Every durable skill output, journal, manifest, and inter-stage handoff is canonical validated JSON.
- A shared protocol envelope is combined with skill-specific payload schemas.
- Immutable schema versions, compatibility matrices, replay fixtures, and explicit adapters prevent producer/consumer breakage.
- Repository-owned JSON-to-Markdown and JSON-to-HTML renderers are built and verified before skill migration.
- Interactive human sessions default to transient Markdown presentation; non-interactive and unknown sessions remain JSON-only unless explicitly rendered.
- Rendered Markdown and HTML are disposable projections, never machine inputs or sources of truth.
- Existing Markdown artifacts remain read-only history and are not auto-converted or used by migrated consumers.
- All 13 skills and their downstream consumers are migrated without a global cutover until pairwise compatibility evidence exists.

In scope:

- `csm-grill`, `csm-scan`, `csm-plan`, `csm-review`, `csm-review-python`, `csm-deep-research`, `csm-ddd`, `csm-bdd-tdd`, `csm-make-tests`, `csm-build`, `csm-browse`, `csm-upload`, and `csm-autoresearch`.
- Canonical and bootstrap schema/implementation copies, package indexes, validators, registries, renderer profiles, publication metadata, and relevant tests.

Exclusions:

- No implementation during planning.
- No automatic or lossy migration of historical Markdown.
- No deletion, rewriting, renaming, or ownership transfer of legacy Markdown history.
- No Markdown-to-HTML production path.
- No external production publication, live GitHub Pages rollback, or real credential use in tests.
- No requirement that `SKILL.md` instruction files cease to be Markdown in this build.

## Acceptance Criteria

1. Every new durable skill output and stage handoff validates as canonical JSON against an immutable registered schema revision; migrated machine consumers reject Markdown, HTML, untyped text, unknown schema revisions, and projection descriptors as inputs. -> T003, T004, T010-T024.
2. Existing supported JSON schema versions remain readable through registered validators or explicit adapters, and incompatible producer/consumer pairs fail CI until an adapter and replay fixtures exist. -> T002-T005, T024.
3. JSON-to-Markdown and JSON-to-HTML renderers produce deterministic, source-digest-linked, separately scoped projections; HTML renders directly from JSON and passes escaping, URL, sanitization, CSP, and accessibility checks. -> T006-T009, T024.
4. Interactive human sessions show transient Markdown by default when sharing/showing output; non-interactive and unknown sessions remain JSON-only; HTML requires explicit request or destination need. -> T009, T024.
5. Each producer/consumer migration preserves success, error, resume, ownership, collision, terminal immutability, provenance, evidence, and rollback behavior before the next migration edge is enabled. -> T001, T010-T023.
6. `csm-scan` norms, DDD report/graph pairs, research, grill, review, plan, BDD/TDD, test, build, browse, upload, and autoresearch artifacts have typed JSON payloads and explicit cross-references. -> T011-T023.
7. Canonical and bootstrap trees contain synchronized schemas, renderers, registries, and skill contracts; package/index and full repository gates pass. -> T005, T023-T024.
8. The final build leaves existing Markdown artifacts as read-only history, leaves no duplicate authoritative content, and records completion evidence, compatibility results, and residual limitations. -> T010, T022-T024.

## Current-State Evidence

- Agreed approach: `.agents/approaches/2026-08-25-json-only-rendered-skill-outputs-approach.md:13-31,94-158` mandates renderer-first sequencing, immutable versions, adapters, shared envelopes, interactive Markdown projections, and all-skill scope.
- Cited research: `.agents/research/2026-08-25-typed-json-interstage-payloads-research.md:7-19,94-121,129-184,186-208` recommends JSON Schema Draft 2020-12, direct sibling renderers, projection metadata, boundary validation, and legacy Markdown preservation.
- Current output fan-out: `csm-scan/SKILL.md:41-46` produces `NORMS.md` consumed by plan, BDD/TDD, build, and review; `csm-plan/SKILL.md:121-136` produces the plan consumed by BDD/TDD/build; `csm-ddd/SKILL.md:28-32` produces a Markdown report plus JSON graph.
- Current JSON foundations: `schemas/csm-trace.schema.json:1-103`, `schemas/verification-status.schema.json:1-90`, `csm-ddd/schemas/ddd-graph.schema.json`, `csm-ddd/schemas/ddd-report.schema.json`, and `csm-autoresearch/schemas/*.schema.json`.
- Current validator fragmentation: `csm-ddd/lib/ddd/validate.mjs:25-125`, `tests/evals/runner.mjs:31-156`, and `csm-autoresearch/lib/ledger/index.mjs:17-83` implement different subsets/integrity rules.
- Current deterministic/packaging gates: `Makefile:32-82`, `scripts/pack-bootstrap.mjs:53-106,202-273`, `tests/package-audit.test.mjs:70-168`, and `tests/check-suite.test.mjs:561-607`.
- Current resume dependence: `scripts/lib/plan-validation.mjs:193-347` and `tests/resume-semantics.test.mjs:62-183` validate Markdown control/journal structures.
- Current renderer foundations: `csm-ddd/lib/ddd/render.mjs:24-52`, `csm-scan/lib/scan/cross-repo/render.mjs:88-99,198`, and `csm-scan/lib/scan/render/base.mjs:3-42` are domain-specific Markdown renderers and escaping helpers, not shared JSON renderers.
- Current baseline: read-only planning inspection found a clean worktree at `c129e19`; no implementation command, install, generator, or mutating experiment was run.

### Applicability

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
    "architecture_or_refactor",
    "security_or_authority"
  ],
  "evidence": [
    {
      "source": "brief",
      "locator": "user request",
      "observation": "User requested one multi-phase implementation plan covering all skills while preserving compatibility during producer/consumer migration."
    },
    {
      "source": "repository",
      "locator": ".agents/approaches/2026-08-25-json-only-rendered-skill-outputs-approach.md:13-31",
      "observation": "The agreed approach changes durable output formats, renderers, machine consumers, persistence, and all 13 skills."
    },
    {
      "source": "repository",
      "locator": ".agents/research/2026-08-25-typed-json-interstage-payloads-research.md:170-184",
      "observation": "The migration changes journals, artifact ownership, cross-skill inputs, publication, and bootstrap synchronization."
    }
  ],
  "obligations": [
    { "id": "boundary", "status": "required" },
    { "id": "contract", "status": "required" },
    { "id": "ownership", "status": "required" },
    { "id": "invariant", "status": "required" },
    { "id": "observable_behavior", "status": "required" },
    { "id": "seam", "status": "required" },
    { "id": "parity", "status": "required" },
    { "id": "rollback_recovery", "status": "required" },
    { "id": "unresolved_risks", "status": "required" }
  ],
  "taskApplicability": {
    "warranted": ["T001","T002","T003","T004","T005","T006","T007","T008","T009","T010","T011","T012","T013","T014","T015","T016","T017","T018","T019","T020","T021","T022","T023","T024"],
    "lightweight": []
  },
  "dddArtifacts": [],
  "unresolvedRisks": [
    "Validator and canonical serializer selection requires an isolated build-time spike.",
    "Exact render-profile coverage and transient export retention require implementation-time fixtures and policy confirmation.",
    "Lossless reconstruction of arbitrary historical Markdown is not promised and remains out of scope.",
    "External upload behavior can be tested only with local stubs unless separately authorized."
  ],
  "bypass": { "requested": false, "rationale": null }
}
```

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | JSON Schema Draft 2020-12 is the default contract dialect; JTD is not introduced for this migration. | user-confirmed decision | Agreed research and approach; `.agents/research/2026-08-25-typed-json-interstage-payloads-research.md:42-48`. | decided |
| D2 | Durable outputs, handoffs, journals, manifests, and machine inputs are JSON-only; `SKILL.md` instructions may remain Markdown. | user-confirmed decision | csm-grill decision 1. | decided |
| D3 | Renderers are implemented before output migration, within this one coordinated build plan. | user-confirmed decision | csm-grill decision 2. | decided |
| D4 | Existing Markdown artifacts remain read-only history and are not auto-converted. | user-confirmed decision | csm-grill decision 3. | decided |
| D5 | One canonical schema source owns generated/verified bootstrap copies. | user-confirmed decision | csm-grill decision 4. | decided |
| D6 | Use a shared protocol envelope with skill-specific payload schemas. | user-confirmed decision | csm-grill decision 5. | decided |
| D7 | Schema versions are immutable; compatibility matrices, replay fixtures, and adapters are mandatory; incompatible changes fail CI. | user-confirmed decision | csm-grill decisions 4-6. | decided |
| D8 | JSON is the sole source; Markdown/HTML are transient or separately scoped disposable projections only. | user-confirmed decision | csm-grill decisions 7-8. | decided |
| D9 | Explicit sharing and `interactionMode` control projection behavior; interactive defaults to Markdown, non-interactive/unknown defaults to JSON. | user-confirmed decision | csm-grill decisions 9-11. | decided |
| D10 | Approval binds to source JSON, schema, renderer, and profile digests. | user-confirmed decision | csm-grill decision 12. | decided |
| D11 | All 13 skills are in scope. | user-confirmed decision | User confirmed all skills are in scope. | decided |
| D12 | Historical Markdown cannot be used as a new machine input. If an old run cannot be represented by supported JSON, it remains history and requires explicit human reconstruction outside this plan. | safety constraint | Required to avoid violating the JSON-only machine boundary while preserving history. | decided |
| D13 | No task may switch a downstream consumer to JSON-only until its producer, adapter/compatibility path, replay fixtures, rollback path, and downstream acceptance signal pass. | safety constraint | Required by the user's no-break requirement. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | What is the exact migration topology? | Read-only inspection of all skill contracts, schemas, tests, packer, Makefile, and artifact index; four independent research tracks. | No edits, installs, generators, or mutating commands; clean baseline at `c129e19`. | Fan-out edges are scan->four consumers, plan->BDD/build, DDD->plan/build, research->grill/plan/make-tests, browse->upload, plus human-mediated outputs. | Serialize migrations by producer/consumer edge; do not perform a global flip. |
| R2 | Can existing validators serve as the shared Draft 2020-12 validator? | Isolated implementation and capability test using Ajv 8.20.0, ajv-formats 3.0.1, and a repository-owned canonical serializer. | No live services or external mutations; focused tests and `make check` passed; temporary spike evidence was folded into this plan and removed. | Ajv 2020-12 supports `$ref`, `$defs`, `oneOf`, conditionals, `unevaluatedProperties`, and configured formats; sorted-key SHA-256 canonicalization is deterministic; duplicate textual keys are rejected before parse. RFC 8785 number canonicalization and domain semantics remain outside this runtime. | T003 may build on `lib/schema-runtime/index.mjs`; retain DDD/autoresearch semantic validators and hash rules as domain-specific layers. |
| R3 | What can be reused for rendering? | Read-only inspection of DDD/scan renderers and renderer tests. | No renderer execution or writes. | Existing Markdown escaping and deterministic ordering are reusable ideas, but no shared JSON renderer or HTML path exists. | T006-T008 create a shared seam without moving domain renderers until parity tests exist. |
| R4 | How can bootstrap remain safe? | Read-only inspection of `scripts/pack-bootstrap.mjs`, package/index tests, and canonical/bootstrap trees. | No packer execution because current targets mutate the worktree. | Packer must be extended to include shared schemas, registry, validator, renderers, and profiles; drift is already gated. | T005 owns generated mapping/parity; T023 owns skill contract/index updates; T024 runs package gates only after controlled staging behavior is proven. |
| R5 | How should legacy Markdown be handled? | Read-only inspection of lifecycle/resume tests and existing artifact policy. | No migration or rewriting. | Markdown is embedded in current journals and plans, but user decision prohibits auto-conversion and machine consumption. | T010 freezes history and defines structured migration-required errors; no Markdown parser is added to new consumers. |
| R6 | What external behavior is safe to test? | Read-only inspection of browse/upload contracts and tests. | No Docker, network, GitHub, credentials, or live publication. | Browse produces binaries and upload has external side effects. | T021 uses typed descriptors and local stubs; live publication remains separately authorized. |
| R7 | Which sources support the design-level standards claims? | Read-only retrieval already captured in the cited research finding. | Web retrieval used direct public documentation only; no credentials or writes. | JSON Schema Core/Validation/Structuring and Annotations, CommonMark, OWASP XSS/CSP, W3C WCAG 2.2, and renderer project documentation were retrieved 2026-08-25. Direct sources: `https://json-schema.org/draft/2020-12/json-schema-core.html`, `https://json-schema.org/understanding-json-schema/structuring.html`, `https://spec.commonmark.org/0.31.2/`, `https://owasp.org/www-community/attacks/xss/`, `https://www.w3.org/TR/WCAG22/`. | T002/T006/T008 cite the finding and its R1-R17 references; no uncited vendor behavior is required for implementation. |

## Discovered Requirements

- Node runtime is `>=22 <25`; package manager policy is pnpm with existing locked dependencies in `package.json` and `pnpm-lock.yaml`.
- Existing primary gates are `make check`, `make test-bootstrap`, `make test-suite-tooling`, `make test-package-index`, `make test-deterministic`, `make test-ddd`, `make test-autoresearch`, `make test-scan`, `make test-browse`, `make test-upload`, and `make test` from `Makefile:32-82`.
- `scripts/pack-bootstrap.mjs` is mutating when run against the working tree; build tasks must stage/copy inputs into an isolated temporary directory or make the packer support a verified check-only/output-root mode before using it as a no-change acceptance signal.
- Canonical skill files are the source for bootstrap payload copies; generated payload and `bootstrap/payload-index.json` drift must fail.
- Existing DDD report/graph publication is a paired atomic contract; migration must preserve matching `runId`, digest, pointer, and last-complete-pair behavior.
- Existing autoresearch JSONL hash-chain, lock, quarantine, and redaction behavior is a compatibility baseline, not a reason to rewrite the ledger format without fixtures.
- T002 selected `ajv@8.20.0` and `ajv-formats@3.0.1`; the shared runtime does not claim full RFC 8785 number canonicalization, and domain semantic validators remain separate.
- Existing plan, research, review, and test resume semantics are Markdown-specific; JSON journals must be introduced and characterized before their Markdown cursors are retired.
- `csm-browse` E2E may skip when Docker is unavailable; unit and local protocol tests cannot be reported as browser E2E proof.
- `csm-upload` has external side effects; tests must use stubs and no live push unless a separate explicit authorization exists.
- Generated/shared schema changes must be reflected in canonical and bootstrap distributions and in `.agents/README.md` artifact indexes when new process artifacts are created.
- A future build must define test files before relying on them as acceptance signals; each named signal below is a deliverable with the exact assertions listed in its task, not a pre-existing command assumed to pass.

## Design

### Canonical protocol

Use a shared envelope containing only stable protocol metadata and references:

```text
csm-envelope/1
  schema identity and revision
  artifact identity and ownership
  run identity and parent/delegation lineage
  lifecycle and verification status
  provenance, digests, and input artifact references
  journal/event cursor references
  evidence, diagnostics, and typed cross-references
  skill-specific payload
```

Skill payload schemas remain domain-specific. Existing DDD and autoresearch schemas are adapted incrementally and retain domain invariants. A schema registry resolves immutable schema IDs/revisions. Unknown revisions fail closed. Compatible older revisions use registered validators; incompatible pairs require an explicit adapter that preserves source digest and records source/target revisions.

### Canonical schema and artifact inventory

The implementation must preserve this inventory unless T002 records a concrete, reviewed path correction before T003 completes:

| Family | Canonical schema/source | Durable artifact shape | Primary consumers |
| --- | --- | --- | --- |
| Shared protocol | `schemas/csm-envelope.schema.json`, `csm-artifact.schema.json`, `csm-journal-event.schema.json`, `csm-diagnostics.schema.json`, `csm-projection.schema.json`, `schemas/registry.json`, `schemas/compatibility-matrix.json` | Shared envelope with embedded typed payload; JSONL only for append-only event streams | All migrated skills |
| Norms | `schemas/skills/csm-scan/norms.schema.json` | `.agents/norms/<date>-<repo>-<run-id>-norms.json` | plan, bdd-tdd, build, review |
| Approach | `schemas/skills/csm-grill/approach.schema.json` | `.agents/approaches/<date>-<slug>-<run-id>-approach.json` | plan |
| Plan | `schemas/skills/csm-plan/plan.schema.json` | `.agents/plans/<date>-<goal>-<run-id>-csm.json` with embedded JSON control/journal | bdd-tdd, build |
| Research | `schemas/skills/csm-deep-research/finding.schema.json` | `.agents/research/<date>-<slug>-<run-id>-research.json` | grill, plan, make-tests, human projection |
| Review/doctrine | `schemas/skills/csm-review/review.schema.json`, `csm-review-python/doctrine.schema.json` | `.agents/reviews/...json`, `.agents/doctrine/...json` | plan, grill, review handoff |
| DDD | existing registered graph schema plus typed report schema | `.agents/ddd/...-report.json` plus `...-graph.json` pair | plan, build |
| BDD/TDD | `schemas/skills/csm-bdd-tdd/package.schema.json` | `specs/<slug>/package.json`, scenario/design records as typed JSON | build |
| Tests | `schemas/skills/csm-make-tests/ledger.schema.json`, `verification.schema.json` | `.agents/tests/...-ledger.jsonl`, `...-verification.json` | build, human |
| Build | `schemas/skills/csm-build/state.schema.json` | build control/progress/checkpoint/completion fields embedded in the plan-owned `.agents/plans/...-csm.json`; standalone build evidence uses typed descriptors | human, evidence/publish descriptors |
| Browse | `schemas/skills/csm-browse/session.schema.json`, `evidence.schema.json` | `state.json`, `events.jsonl`, binary files referenced by JSON descriptors | upload, human |
| Upload | `schemas/skills/csm-upload/publication.schema.json` | `.agents/upload/...-publication.json` plus externally published files | human |
| Autoresearch | existing registered JSON/JSONL schemas plus shared descriptor | existing JSONL/report paths with outer artifact descriptors | human/review |

All artifact records include owner, run ID, schema ID/revision, source/input artifact IDs, canonical digest, lifecycle status, and rollback pointer. JSONL is limited to append-only events/ledgers; ordinary durable reports and state are JSON objects. Existing `.md` paths remain legacy history and are not new discovery candidates.

### Producer/consumer migration rule

Every edge follows this order:

```text
characterize old behavior
  -> define JSON schema and adapter boundary
  -> make downstream accept validated JSON
  -> switch upstream writer to JSON only
  -> replay producer/consumer fixtures
  -> verify rollback and failure behavior
  -> enable JSON-only rejection for that edge
```

No task may change an upstream writer or downstream resolver without a paired acceptance test. No task may use a Markdown projection as a compatibility fallback. Legacy Markdown is identified as history and returns a structured migration-required result.

Shared resolver, packer, registry, and csm-build integration files are serially owned. Producer tasks define only their producer schema/writer and producer-local tests; consumer integration is owned by the downstream consumer's migration task. This prevents the parallel producer wave from editing plan/build/shared resolver files simultaneously.

### Rendering and publication

Renderers consume validated JSON, immutable schema/profile IDs, and a pinned clock/source descriptor. JSON-to-Markdown and JSON-to-HTML are separate sibling paths. HTML is built directly from JSON and passes escaping, URL allowlisting, sanitization, CSP, and accessibility checks. A projection descriptor records source artifact ID/digest, schema revision, renderer/profile revisions, media type, generation time, output digest, and `untrusted-presentation` status.

Interactive human sessions default to transient Markdown when output is shared or shown. Non-interactive and unknown sessions return JSON unless explicitly asked for a projection. HTML requires explicit request or destination need. Projection storage is separate, disposable, digest-keyed, and excluded from artifact discovery.

### Recovery and rollback

Every durable writer keeps the prior complete artifact until the new JSON artifact validates, its references resolve, and its consumer replay passes. Publication uses atomic staging and replacement. On failure, retain the old artifact/pointer, quarantine incomplete output, and record a structured error. Rollback restores the prior resolver/adapter or disables projection generation; it never deletes legacy history or canonical JSON.

## Execution Graph

- **G1 baseline and selection:** T001 establishes characterization and the protected baseline. T002 selects the validator/serializer in an isolated spike.
- **G2 foundation:** T003 defines schemas and registry after T002; T004 defines compatibility/adapters; T005 integrates canonical foundation into bootstrap packaging. T003/T004 are serialized because compatibility depends on schema identity; T005 depends on both.
- **G3 renderers:** T006 defines render profiles and the shared render seam after T003; T007 and T008 can run in parallel after T006 with disjoint renderer/test ownership; T009 depends on both.
- **G4 safety boundary:** T010 freezes legacy history and adds opt-in, edge-scoped JSON artifact resolution after T004/T009; it does not change global defaults.
- **G5 standalone producer wave:** T011 scan, T012 DDD, T013 research, T014 review/doctrine, and T015 autoresearch may run in parallel after T010, with disjoint producer/schema/test ownership only. Downstream consumer integration is owned by T016-T020.
- **G6 decision/planning chain:** T016 grill depends on T013/T014; T017 plan depends on T011-T016. These are serialized because each is an upstream input to the next and T017 owns all csm-plan consumer integration.
- **G7 downstream producers:** T018 BDD/TDD and T019 make-tests may run in parallel after T017, but neither may change build resolution outside its owned files.
- **G8 terminal consumers/evidence:** T020 build depends on T012, T017, T018, and T019. T021 browse/upload depends on T009/T010 and owns only browse/upload-specific descriptors; shared publication remains T009-owned.
- **G9 cutover and gates:** T022 applies the final JSON-only machine-consumer guard after all producer/consumer replay passes. T023 synchronizes contracts/docs/bootstrap and T024 runs final compatibility, security, parity, and full gates. T022 -> T023 -> T024 is serialized.
- **Critical path:** T001 -> T002 -> T003 -> T004 -> T005 -> T006 -> T007/T008 -> T009 -> T010 -> T013 -> T016 -> T017 -> T018/T019 -> T020 -> T022 -> T023 -> T024.

## Numbered Plan

1. [completed] Establish characterization baselines and the migration ledger.
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high
   - Owned scope: new migration fixtures/tests and plan-side compatibility evidence only; no skill implementation files.
   - Not in scope: changing current behavior, converting legacy Markdown, or adding schemas before the baseline is recorded.
   - Spike candidate: none.
   - Actions: Inventory every producer/consumer edge; capture representative valid/error/resume/collision/terminal artifacts for all skills; record current JSON and Markdown contracts as read-only fixtures; define the per-edge rollback checkpoint and expected observable behavior.
   - Acceptance signal: `node --test --test-concurrency=1 tests/json-migration-characterization.test.mjs` passes with one approved fixture set for every declared producer and consumer edge.
   - Validation: `make check`; `make test` at the pre-change baseline; inspect that fixtures are synthetic/redacted and no legacy artifact is modified.
   - Acceptance evidence: fixture manifest, producer/consumer matrix, baseline command results, and rollback checkpoint table.
   - Repair attempts: 0
   - Recovery note: If partial, keep only fixture/ledger changes; rerun inventory from the last recorded edge and do not begin schema migration.

2. [completed] Select and prove the suite validator and canonical JSON serializer.
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G1
   - Risk: high
   - Owned scope: isolated validator/serializer spike, capability tests, and decision record.
   - Not in scope: changing existing runtime validators, installing dependencies into the repository, or rewriting artifacts.
   - Spike candidate: yes; run only on copied synthetic schemas/instances inside a fresh temporary sandbox with redirected caches and no network.
   - Actions: Compare candidate validator capability against Draft 2020-12 features required by shared schemas (`$ref`, `$defs`, `oneOf`, conditionals, `unevaluatedProperties`, formats, structured diagnostics); compare canonical serialization and digest behavior with DDD, autoresearch, and eval fixtures; select one implementation or record a narrowly scoped compatibility wrapper.
   - Acceptance signal: `node --test --test-concurrency=1 tests/schema-runtime-selection.test.mjs` passes and records the selected validator, serializer, supported vocabulary, duplicate-key policy, and known limitations.
   - Validation: Re-run the capability suite against old DDD/autoresearch/trace fixtures; verify no repository or metadata change outside the plan draft.
   - Acceptance evidence: isolated spike record, capability matrix, serializer golden bytes, duplicate-key behavior, and decision with confidence/limitations.
   - Repair attempts: 0
   - Recovery note: If no candidate satisfies the required capability, stop before T003 and record the unresolved blocker; do not silently use a partial validator.

3. [completed] Define shared envelopes, schema registry, artifact identity, journals, diagnostics, and render metadata.
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: high
   - Owned scope: canonical `schemas/` shared contracts, registry, `$defs`, identity policy, compatibility metadata, and contract tests.
   - Not in scope: skill-specific payload migration, renderer implementation, or bootstrap copies.
   - Spike candidate: none; T002 resolves validator capability first.
   - Actions: Add immutable `$id`/revision conventions; define envelope-owned fields versus payload-owned fields; define run/parent/delegation identity; define lifecycle versus verification status; define evidence/artifact/reference/provenance/error/cross-reference records; define JSON journal events and projection descriptors; define per-boundary unknown-field policy.
   - Acceptance signal: `node --test --test-concurrency=1 tests/schema-registry.test.mjs tests/schema-validation.test.mjs` passes with every new schema resolvable by immutable ID and every malformed envelope rejected with structured diagnostics.
   - Validation: Validate representative fixtures from T001 and existing DDD/autoresearch/trace families; verify no duplicate schema IDs or mutable revision aliases.
   - Acceptance evidence: schema registry, schema inventory, required-field matrix, validator output fixtures, and explicit versioning policy.
   - Repair attempts: 0
   - Recovery note: If envelope ownership is ambiguous, do not migrate a skill; revise only the foundation and rerun the registry tests.

4. [completed] Implement compatibility negotiation, adapters, and replay infrastructure.
   - Task ID: T004
   - Depends on: T003
   - Parallel group: G2
   - Risk: high
   - Owned scope: compatibility registry/matrix, adapter interface, schema-diff policy, replay harness, and compatibility tests.
   - Not in scope: changing any skill producer or consumer defaults.
   - Spike candidate: none.
   - Actions: Define supported producer/consumer pairs; make unknown revisions fail closed; register compatible old validators; define explicit JSON vN->vN+1 adapters; preserve source digest and adapter provenance; classify additive versus breaking changes; add old/new direction tests.
   - Acceptance signal: `node --test --test-concurrency=1 tests/compatibility.test.mjs tests/adapter-replay.test.mjs` passes with supported old fixtures, rejected unknown versions, and adapter-required breakage.
   - Validation: Replay all T001 fixtures through old/new schema versions; inject malformed adapters and verify quarantine/no cutover.
   - Acceptance evidence: compatibility matrix, adapter registry, replay outputs, and failure classifications.
   - Repair attempts: 0
   - Recovery note: If a pair fails, leave its current producer/consumer untouched and mark the edge blocked; never weaken the gate to continue.

5. [completed] Extend canonical-to-bootstrap packaging and drift verification for the foundation.
   - Task ID: T005
   - Depends on: T003, T004
   - Parallel group: G2
   - Risk: high
   - Owned scope: `scripts/pack-bootstrap.mjs`, package mapping, payload/index tests, generated shared schema/registry/validator copies.
   - Not in scope: hand-editing generated payloads, changing skill behavior, or running live packaging/publishing.
   - Spike candidate: yes if current packer cannot target an isolated output root; prove a safe staging/output-root mode before using deterministic checks.
   - Actions: Add all shared schemas, registry, validator, serializer, compatibility, and future renderer modules to the canonical mapping; add generated parity assertions; ensure canonical/bootstrap IDs, bytes, hashes, and versions agree; make check-only/staged packaging safe for build tests.
   - Acceptance signal: `node --test --test-concurrency=1 tests/bootstrap-schema-sync.test.mjs tests/package-audit.test.mjs` passes with zero canonical/bootstrap drift.
   - Validation: `make test-package-index`; run pack twice in an isolated staging root and compare summaries; verify worktree protected state.
   - Acceptance evidence: mapping diff, generated parity result, isolated pack result, and no-hand-edit rule.
   - Repair attempts: 0
   - Recovery note: If packaging writes outside the staging root, stop and fix isolation before adding more generated files.

6. [completed] Define render profiles, typed render model, and projection descriptor behavior.
   - Task ID: T006
   - Depends on: T003
   - Parallel group: G3
   - Risk: standard
   - Owned scope: shared render-profile/projection schemas, render AST/model, path-selection rules, deterministic ordering, and profile fixtures.
   - Not in scope: skill migration, Markdown parser ingestion, HTML output, or renderer-specific security implementation.
   - Spike candidate: yes for exact CommonMark subset and HTML element/attribute allowlist; use synthetic profile fixtures only.
   - Actions: Define profile identity/version, schema-path references, field visibility, labels, section ordering, table/list/code/link rules, redaction presentation, accessibility text, URL policy, and projection metadata. Fail closed on unknown profile paths or unsupported constructs.
   - Acceptance signal: `node --test --test-concurrency=1 tests/render-profile.test.mjs` passes with valid/invalid profiles and byte-stable render-model fixtures.
   - Validation: Profile coverage matrix for norms, plans, findings, research, DDD, tests, browser evidence, and publication records.
   - Acceptance evidence: profile schemas, supported-feature matrix, sample profiles, and rejected-profile diagnostics.
   - Repair attempts: 0
   - Recovery note: If a current report cannot be represented without embedding Markdown authority, classify it as a profile gap and do not migrate that producer yet.

7. [completed] Build and verify the JSON-to-Markdown renderer.
   - Task ID: T007
   - Depends on: T006
   - Parallel group: G3
   - Risk: standard
   - Owned scope: repository-owned Markdown renderer, Markdown escaping, serialization, renderer tests, and semantic golden fixtures.
   - Not in scope: Markdown input parsing, Markdown-to-HTML conversion, or making Markdown durable.
   - Spike candidate: none after T006.
   - Actions: Render only validated JSON/profile paths; pin a supported CommonMark subset; escape control characters and reject raw HTML; make ordering/newlines deterministic; include source/schema/renderer/profile projection metadata without duplicating payload content.
   - Acceptance signal: `node --test --test-concurrency=1 tests/render-markdown.test.mjs` passes exact deterministic goldens, unsafe-content fixtures, source-digest metadata, and profile coverage.
   - Validation: Existing scan/DDD escaping tests; same-input byte identity; changed-source digest invalidation; no writes to canonical artifact directories.
   - Acceptance evidence: renderer API, golden corpus, security fixtures, and projection descriptor examples.
   - Repair attempts: 0
   - Recovery note: If output differs from a legacy human golden, compare semantic content and record intentional formatting differences; never make legacy Markdown authoritative again.

8. [completed] Build and verify the direct JSON-to-HTML renderer.
   - Task ID: T008
   - Depends on: T006
   - Parallel group: G3
   - Risk: high
   - Owned scope: HTML AST renderer, escaping, URL policy, sanitizer integration, CSP metadata, accessibility tests, and HTML projection goldens.
   - Not in scope: Markdown parsing, executable scripts, live browser publication, or accepting raw HTML from JSON values.
   - Spike candidate: yes for sanitizer/library compatibility; run only in isolated synthetic fixtures and record browser/library support.
   - Actions: Render directly from validated JSON; escape text/attributes; allow only approved URL schemes/destinations; omit scripts, event handlers, unsafe attributes, and unapproved media; sanitize final tree; emit strict CSP-compatible output; include accessible title/headings/status alternatives.
   - Acceptance signal: `node --test --test-concurrency=1 tests/render-html.test.mjs` passes XSS/URL/DOM-clobbering/security fixtures, deterministic output, projection metadata, and WCAG structural checks.
   - Validation: Static scan for scripts/event handlers/unsafe URLs; sanitizer test; source/profile digest invalidation; explicit note when E2E browser validation is unavailable.
   - Acceptance evidence: HTML security policy, sanitizer configuration, CSP policy, accessibility fixture results, and rejected-input corpus.
   - Repair attempts: 0
   - Recovery note: If sanitizer or browser compatibility is unresolved, disable HTML projection while leaving JSON and Markdown renderer work intact; do not publish unsafe HTML.

9. [completed] Implement publication, interaction-mode, approval, transient export, and projection-discovery boundaries.
   - Task ID: T009
   - Depends on: T007, T008
   - Parallel group: G4
   - Risk: high
   - Owned scope: `share` request, `interactionMode`, publication API, projection descriptor, export/cache root, cleanup, approval binding, and negative discovery tests.
   - Not in scope: skill payload migration or external publication implementation.
   - Spike candidate: yes for temp/export root permissions, retention, crash cleanup, and TTY fallback; synthetic files only.
   - Actions: Implement `share: none|markdown|html|both`; interactive human default Markdown; non-interactive/unknown default JSON; explicit HTML rules; separate digest-keyed disposable export namespace; expiry/cleanup; approval tied to source/schema/renderer/profile/output digests; exclude projections from artifact discovery.
   - Acceptance signal: `node --test --test-concurrency=1 tests/publication-protocol.test.mjs tests/projection-discovery-negative.test.mjs` passes all mode/share/storage/approval cases.
   - Validation: Interrupted export cleanup, stale projection invalidation, unknown mode JSON-only, and projection path exclusion.
   - Acceptance evidence: publication contract, storage/retention policy, mode matrix, approval fixtures, and cleanup results.
   - Repair attempts: 0
   - Recovery note: If export cleanup cannot be proven, default to no persistence and return the projection transiently only.

10. [completed] Freeze legacy history and add the JSON artifact resolver/migration-required boundary.
   - Task ID: T010
   - Depends on: T004, T009
   - Parallel group: G4
   - Risk: high
   - Owned scope: artifact discovery, legacy path classification, JSON-only resolver, structured migration-required errors, and negative Markdown/HTML input tests.
   - Not in scope: parsing or rewriting historical Markdown; changing individual skill writers.
   - Spike candidate: none.
   - Actions: Classify existing Markdown as read-only history; add a resolver API that can be enabled per migrated edge; discover registered JSON/JSONL artifacts; reject projections and untyped text when the edge is enabled; preserve exact legacy path/ownership metadata; define explicit migration-required results for old artifact paths; do not change global discovery defaults yet.
   - Acceptance signal: `node --test --test-concurrency=1 tests/artifact-resolver.test.mjs tests/legacy-artifact-compatibility.test.mjs` passes history/read-only/classification cases and proves the resolver remains opt-in until T022.
   - Validation: Existing lifecycle/resume corpus remains inspectable; terminal legacy artifacts are not resumed or overwritten; supported JSON versions still resolve.
   - Acceptance evidence: resolver matrix, legacy classification rules, negative fixtures, and rollback behavior.
   - Repair attempts: 0
   - Recovery note: If an active downstream depends on a legacy path, leave the global resolver unchanged and record the edge as pending; only the edge-specific consumer task may enable JSON resolution after replay passes.

11. [pending] Migrate csm-scan norms output and its four downstream consumers.
   - Task ID: T011
   - Depends on: T010
   - Parallel group: G5
   - Risk: high
   - Owned scope: csm-scan norms payload/schema/writer and scan-local tests; no plan/build/review consumer files.
   - Not in scope: general renderer changes, legacy Markdown conversion, or unrelated scanner behavior.
   - Spike candidate: none.
   - Actions: Define typed norms payload for all 17 dimensions, provenance, deterministic ordering, plugin observations, privacy outcomes, and cross-observations; write JSON only; publish a typed producer descriptor for downstream consumer tasks; use T009 for interactive Markdown display; do not change downstream resolvers here.
   - Acceptance signal: `make test-scan && node --test --test-concurrency=1 tests/norms-json-contract.test.mjs` passes unchanged scanner behavior, deterministic JSON output, privacy rules, and the complete norms schema fixture.
   - Validation: Existing scanner privacy/determinism/plugin tests; malformed norms, stale norms, missing norms, and legacy history cases.
   - Acceptance evidence: norms schema, producer fixture, semantic golden comparison, and producer rollback checkpoint; consumer replay evidence is recorded by T017 and T022.
   - Repair attempts: 0
   - Recovery note: Revert only the scan/consumer resolver changes if replay fails; keep foundation/renderers intact and preserve old `NORMS.md` history.

12. [pending] Migrate csm-ddd report/graph JSON pair and plan/build DDD consumers.
   - Task ID: T012
   - Depends on: T010
   - Parallel group: G5
   - Risk: high
   - Owned scope: csm-ddd report/graph schemas and writers, paired publication, shared identity/provenance, and DDD-local tests; no plan/build consumer files.
   - Not in scope: removing graph semantics, collapsing graph into Markdown, or weakening pair atomicity.
   - Spike candidate: none.
   - Actions: Make JSON report and graph authoritative; represent sections/findings as typed data rather than Markdown strings; retain graph/report matching `runId`, digests, pointer, lock, and last-complete-pair behavior; publish a validated pair descriptor for downstream tasks; render Markdown/HTML only through T007/T008.
   - Acceptance signal: `make test-ddd && node --test --test-concurrency=1 tests/ddd-json-contract.test.mjs` passes pair, dangling-reference, digest, rollback, and typed-report cases.
   - Validation: Existing DDD contract/publication tests; mismatched pair, absolute path, unknown status, and partial publication failures.
   - Acceptance evidence: typed report/graph schemas, pair manifest, old/new replay matrix, and atomic rollback evidence; plan/build consumer cutover evidence is recorded by T017/T020/T022.
   - Repair attempts: 0
   - Recovery note: Keep the prior DDD pointer authoritative until both JSON artifacts and both consumers pass; never expose a mixed generation.

13. [pending] Migrate csm-deep-research JSON finding and research consumers.
   - Task ID: T013
   - Depends on: T010
   - Parallel group: G5
   - Risk: high
   - Owned scope: research payload/schema/writer/journal, declared artifact references, citation/evidence model, and research-local tests; no grill/plan/make-tests resolver files.
   - Not in scope: changing research evidence standards, citation URLs, or browser fallback behavior.
   - Spike candidate: none.
   - Actions: Make the research finding JSON authoritative with typed sections, claims, verdicts, references, process journal, and declared artifacts; keep fixed document-shape semantics in payload/profile metadata; publish a typed research descriptor; display Markdown/HTML only via renderers; preserve source/claim/reference provenance.
   - Acceptance signal: `node --test --test-concurrency=1 tests/research-json-contract.test.mjs` passes citation, artifact, journal, resume, and fixed-shape payload cases.
   - Validation: Existing research corpus checks remain applied to projections only; malformed claims/references, missing retrieval dates, artifact mismatch, and unknown versions fail.
   - Acceptance evidence: research schema, claim/reference fixtures, declared-artifact matrix, and producer rollback evidence; consumer replay evidence is recorded by T016/T017/T019/T022.
   - Repair attempts: 0
   - Recovery note: If a fixed-section requirement cannot be represented, block only the research consumer cutover and retain JSON schema/profile work without reverting unrelated producers.

14. [pending] Migrate csm-review and csm-review-python findings with plan/grill consumers.
   - Task ID: T014
   - Depends on: T010
   - Parallel group: G5
   - Risk: high
   - Owned scope: review/doctrine JSON payloads, finding/evidence/challenge schemas, verification status, and review/doctrine-local tests; no plan/grill resolver files.
   - Not in scope: changing review posture, vulnerability sources, or Python doctrine rules.
   - Spike candidate: none.
   - Actions: Define typed findings preserving stable IDs, severity, confidence, locations, evidence classes, challenges, dissents, status, verification, and sort order; make review and doctrine writers produce JSON; publish typed descriptors; render reports on demand; preserve human-facing fix-guide semantics as typed actions, not Markdown checkboxes. Replace csm-review-python's bundled research Markdown machine input with a registered JSON research/reference artifact or explicitly block that new input path until an equivalent JSON reference exists; do not treat the old Markdown as a migrated machine input.
   - Acceptance signal: `node --test --test-concurrency=1 tests/review-json-contract.test.mjs` passes finding, challenge, verification-status, redaction, and doctrine cases.
   - Validation: Existing review contract/security tests; redaction, stale/unauthentic norms, unknown finding status, and terminal collision cases.
   - Acceptance evidence: finding schema, review/doctrine fixtures, producer rollback evidence, and source/projection approval behavior; consumer replay evidence is recorded by T016/T017/T022.
   - Repair attempts: 0
   - Recovery note: Keep review output in its old path only for pre-cutover history; new review runs must not create Markdown authority.

15. [pending] Preserve and envelope csm-autoresearch JSON/JSONL contracts.
   - Task ID: T015
   - Depends on: T010
   - Parallel group: G5
   - Risk: high
   - Owned scope: autoresearch shared envelope integration, schema registry entries, adapter/replay fixtures, ledger hash/lock/quarantine preservation, and autoresearch tests.
   - Not in scope: redesigning optimizer policy, changing evaluator semantics, or weakening hash-chain/redaction behavior.
   - Spike candidate: none.
   - Actions: Register existing contract/request/response/ledger/report schemas; add shared identity/provenance without breaking record hashes; reconcile runtime-added hash fields with schemas; retain JSONL as the machine format; define projection descriptor only for human sharing.
   - Acceptance signal: `make test-autoresearch && node --test --test-concurrency=1 tests/autoresearch-compatibility.test.mjs` passes old ledger/report replay, corruption/quarantine, lock, and shared-envelope cases.
   - Validation: Existing hash-chain, recovery, redaction, and policy tests; old/new reader matrix.
   - Acceptance evidence: registered schemas, unchanged hash-chain fixtures, adapter matrix, and no-projection-input negative tests.
   - Repair attempts: 0
   - Recovery note: If envelope fields would alter record hashes, preserve ledger-native identity and link it through an outer artifact descriptor instead.

16. [pending] Migrate csm-grill approach output and its csm-plan input.
   - Task ID: T016
   - Depends on: T013, T014
   - Parallel group: G6
   - Risk: high
   - Owned scope: csm-grill JSON approach payload/journal/decisions and csm-plan approach resolver; interactive Markdown projection behavior.
   - Not in scope: changing grill interview decisions, making grill resumable when it is currently non-resumable, or consuming legacy Markdown approaches.
   - Spike candidate: none.
   - Actions: Make approach/decisions/phases JSON authoritative; keep explicit non-resumable lifecycle semantics; make csm-plan accept only validated JSON approach payloads; integrate research and review descriptors through the shared input resolver; use T009/T007 for terminal human Markdown display; make legacy Markdown return migration-required.
   - Acceptance signal: `node --test --test-concurrency=1 tests/grill-json-contract.test.mjs tests/grill-plan-replay.test.mjs` passes agreed approach replay, decision preservation, non-resumable behavior, and interactive display cases.
   - Validation: Existing csm-grill lifecycle tests; unknown format/version refusal and legacy history classification.
   - Acceptance evidence: approach schema, phase brief fixtures, plan input replay, and projection descriptor.
   - Repair attempts: 0
   - Recovery note: If plan cannot consume a JSON approach without Markdown assumptions, stop before T017 and fix the typed phase-brief payload.

17. [pending] Migrate csm-plan JSON output, journals, and csm-bdd-tdd/csm-build consumers.
   - Task ID: T017
   - Depends on: T011, T012, T013, T014, T016
   - Parallel group: G6
   - Risk: high
   - Owned scope: plan payload/schema, JSON journal/control/resume, applicability, current-state evidence, task/acceptance records, and BDD/build plan resolvers.
   - Not in scope: changing plan task semantics, executing tasks, or accepting Markdown plans as new inputs.
   - Spike candidate: none.
   - Actions: Convert plan state/control/journal/completion review to JSON; preserve applicability obligations, DDD hypotheses, review/research/norms inputs, and task evidence; make BDD/build validate JSON plan versions; keep Markdown only as a generated interactive projection; add explicit migration-required for legacy plan paths. This task owns all csm-plan consumer integration, including norms, DDD, research, review, and grill inputs.
   - Acceptance signal: `node --test --test-concurrency=1 tests/plan-json-resume.test.mjs tests/plan-consumer-replay.test.mjs tests/plan-compatibility.test.mjs` passes pause/resume, invalid transition, applicability, DDD pair, and BDD/build input cases.
   - Validation: Existing `tests/resume-semantics.test.mjs` and plan validation tests; valid/invalid JSON journals, interrupted writes, terminal collision, and supported old schema versions.
   - Acceptance evidence: plan schema, JSON journal fixtures, replay matrix, rollback checkpoint, and proof that all implementation tasks remain pending in the saved plan.
   - Repair attempts: 0
   - Recovery note: Do not cut over csm-build until T017 replay passes for plan-only and BDD-mutated plan paths.

18. [pending] Migrate csm-bdd-tdd specs, control, test designs, and mutated-plan handoff.
   - Task ID: T018
   - Depends on: T017
   - Parallel group: G7
   - Risk: high
   - Owned scope: BDD/TDD JSON package, scenarios, test designs, control journal, traceability, and csm-build resolver.
   - Not in scope: executing generated tests, mutating production code, or converting arbitrary existing spec Markdown.
   - Spike candidate: none.
   - Actions: Define typed objective/scope/criteria/risk/spec/scenario/test-design package; preserve scenario IDs and plan lineage; make csm-build accept JSON package and source-plan references; render Gherkin/Markdown only for human sharing; reject legacy specs as machine inputs unless explicitly reconstructed.
   - Acceptance signal: `node --test --test-concurrency=1 tests/bdd-json-package.test.mjs tests/bdd-build-replay.test.mjs` passes traceability, control recovery, malformed package, and build input cases.
   - Validation: Existing BDD lifecycle tests; source-plan collision, mismatched run IDs, missing scenario links, and projection-negative cases.
   - Acceptance evidence: package schema, scenario/design fixtures, build replay, and recovery evidence.
   - Repair attempts: 0
   - Recovery note: If the build resolver cannot prove source-plan lineage, keep the prior BDD path disabled for new runs and block T020.

19. [pending] Migrate csm-make-tests ledger, verification, and build handoff.
   - Task ID: T019
   - Depends on: T017
   - Parallel group: G7
   - Risk: high
   - Owned scope: test ledger/verification JSON payloads, evidence/verification-status integration, maintenance cursor, and csm-build test-package resolver.
   - Not in scope: generating or executing new tests, changing test-generation policy, or deleting Markdown ledgers.
   - Spike candidate: none.
   - Actions: Define typed ledger rows, approval state, verification status, mutation/performance evidence, fixture/benchmark references, maintenance cursor, and build handoff; preserve existing generated test files as code artifacts; make csm-build accept JSON test package descriptors only; render ledger/report on demand.
   - Acceptance signal: `node --test --test-concurrency=1 tests/make-tests-json-contract.test.mjs tests/make-tests-build-replay.test.mjs` passes ledger append/recovery, verification-status, and build replay cases.
   - Validation: Existing make-tests tests and mutation/performance characterization; stale ledger, missing evidence, and terminal destination cases.
   - Acceptance evidence: ledger schema, verification schema integration, replay fixtures, and migration/rollback evidence.
   - Repair attempts: 0
   - Recovery note: Preserve prior ledger files as history; never rewrite them to satisfy the new JSON schema.

20. [pending] Migrate csm-build state, completion, and downstream artifact descriptors.
   - Task ID: T020
   - Depends on: T012, T017, T018, T019
   - Parallel group: G8
   - Risk: high
   - Owned scope: csm-build JSON control/progress/completion state, input validation, artifact/commit evidence descriptors, and renderer/publication handoff.
   - Not in scope: executing implementation tasks during this plan, changing commit policy, or consuming Markdown plans/specs/reports.
   - Spike candidate: none.
   - Actions: Make build recover/validate/select/dispatch/integrate/verify/review/repair/checkpoint state JSON; require validated plan/BDD/test/DDD/norms inputs; preserve commit and rollback evidence; emit typed completion/artifact descriptors; use projection only for interactive human output. This task owns all csm-build consumer integration, including DDD, norms, plan, BDD/TDD, and make-tests inputs.
   - Acceptance signal: `node --test --test-concurrency=1 tests/build-json-control.test.mjs tests/build-input-replay.test.mjs` passes state transitions, refusal-before-dispatch, recovery, completion, and artifact descriptor cases.
   - Validation: Existing csm-build contract tests; malformed input, missing applicability, unknown schema, interrupted checkpoint, and no-implementation-during-planning guards.
   - Acceptance evidence: build schema, recovery fixtures, input matrix, completion evidence contract, and rollback checkpoint.
   - Repair attempts: 0
   - Recovery note: If a build state cannot be recovered from JSON, do not enable the new resolver; leave the previous build contract available only for untouched pre-cutover plans.

21. [pending] Migrate csm-browse evidence and csm-upload publication descriptors.
   - Task ID: T021
   - Depends on: T009, T010
   - Parallel group: G8
   - Risk: high
   - Owned scope: browse session/state/events/evidence descriptors, binary artifact metadata, upload input validation, publication status, and local stub tests; shared transient export cleanup and publication protocol remain owned by T009.
   - Not in scope: live Docker E2E requirement, live GitHub Pages publishing, or destructive remote rollback.
   - Spike candidate: yes for binary descriptor schema, retention, symlink/path policy, and transient export cleanup; synthetic files and stub git/gh only.
   - Actions: Keep binary files as separately digested evidence artifacts referenced by JSON; make browse state/events JSON/JSONL; cover screenshots, videos, DOM, console, network, and performance evidence; make upload accept only validated evidence/publication descriptors; preserve explicit publication confirmation, destination matching, bounded snapshots, binary acknowledgment, and truthful deployment status; make human HTML sharing use T009.
   - Acceptance signal: `make test-browse && make test-upload && node --test --test-concurrency=1 tests/browse-upload-json-contract.test.mjs` passes local protocol, binary descriptor, stub publication, symlink/path, and failure cleanup cases.
   - Validation: Run E2E only when `CSM_BROWSE_E2E_REQUIRE=1` and the environment explicitly provides the container; otherwise record E2E as unavailable, not passed.
   - Acceptance evidence: evidence schema, descriptor fixtures, stub publication result, cleanup record, and explicit E2E availability status.
   - Repair attempts: 0
   - Recovery note: If publication validation fails, keep the JSON evidence descriptor and do not push or delete remote content.

22. [pending] Enable the final JSON-only machine-consumer cutover and projection rejection guard.
   - Task ID: T022
   - Depends on: T011, T012, T013, T014, T015, T016, T017, T018, T019, T020, T021
   - Parallel group: G9
   - Risk: high
   - Owned scope: shared resolver defaults, all migrated consumer discovery paths, machine-input rejection, compatibility dispatch, and cutover tests.
   - Not in scope: deleting legacy Markdown, changing interactive human defaults, or adding untested fallback parsing.
   - Spike candidate: none; all edge-specific spikes must be resolved before this task.
   - Actions: Enable the final global default only after every edge-specific task passes; make JSON the only new machine input; reject `.md`, `.html`, raw text, and projection descriptors; require registered schema/version and source digest; route supported old JSON through validators/adapters; emit structured migration-required errors for legacy Markdown; preserve human projections through T009 only.
   - Acceptance signal: `node --test --test-concurrency=1 tests/json-only-cutover.test.mjs tests/consumer-replay-matrix.test.mjs` passes every declared producer/consumer edge and all negative projection/legacy cases.
   - Validation: Re-run all prior edge suites, old/new direction matrix, failure injection, terminal collision, and rollback checkpoints before changing default discovery.
   - Acceptance evidence: complete producer/consumer matrix, cutover flag/default diff, rejection fixtures, and approval of every edge owner.
   - Repair attempts: 0
   - Recovery note: Roll back the resolver default/feature gate only; never delete canonical JSON, projection cache, or legacy history.

23. [pending] Synchronize skill contracts, documentation, generated payloads, indexes, and release metadata.
   - Task ID: T023
   - Depends on: T022
   - Parallel group: G9
   - Risk: high
   - Owned scope: canonical `SKILL.md` contracts, bootstrap copies, schema/renderer mappings, `.agents/README.md`, package indexes, and machine-readable contract references.
   - Not in scope: hand-editing generated bootstrap files, changing unrelated documentation, or claiming legacy Markdown is machine-readable.
   - Spike candidate: none.
   - Actions: Update every skill's consumes/produces/handoff contract to name JSON schemas and projection behavior; document interactionMode/share defaults, legacy history, adapters, and rejection rules; use the already-updated T005 packer mapping to regenerate bootstrap payload/index; synchronize boilerplate; index the final plan and any generated process artifacts.
   - Acceptance signal: `node scripts/sync-skill-boilerplate.mjs --check && make test-package-index && make check` passes with canonical/bootstrap/documentation parity; T023 does not modify packer ownership or hand-edit generated files.
   - Validation: `git diff --check`; search all skill contracts for stale authoritative Markdown consumption; verify generated files are byte-identical to canonical sources.
   - Acceptance evidence: contract matrix, stale-reference scan, bootstrap hash report, and updated index line.
   - Repair attempts: 0
   - Recovery note: If generated parity fails, regenerate from canonical sources; never manually patch the packaged copy.

24. [pending] Establish the final build environment and run compatibility, security, parity, recovery, and full repository gates.
   - Task ID: T024
   - Depends on: T023
   - Parallel group: G9
   - Risk: high
   - Owned scope: final verification fixtures/reports only; no production behavior changes unless a prior task is reopened.
   - Not in scope: live external publication, schema weakening to make tests pass, or marking unavailable E2E evidence as success.
   - Spike candidate: none.
   - Actions: First verify Node/pnpm versions and the availability of all declared dependencies without modifying the project; record whether browser E2E is required or unavailable. Then run complete old/new schema replay; all producer/consumer edge tests; renderer determinism/security/accessibility/projection invalidation; interrupted-write and rollback tests; canonical/bootstrap parity; package/index/protocol/refusal/resume tests; full repository suite. Record residual unknowns and reopen any task whose evidence is incomplete.
   - Acceptance signal: `node --test --test-concurrency=1 tests/environment-preflight.test.mjs` passes the declared toolchain/dependency policy, followed by `make fmt-check && make lint && make check && make test-bootstrap && make test-suite-tooling && make test-package-index && make test-deterministic && make test-ddd && make test-autoresearch && make test-scan && make test-browse && make test-upload && make test` with required E2E evidence separately identified.
   - Validation: `git status --short` shows only intended implementation changes; compatibility matrix has no unreviewed pair; no projection is discoverable as input; all high-risk tasks have independent review evidence.
   - Acceptance evidence: final gate transcript, compatibility matrix, renderer security/accessibility report, rollback/recovery report, bootstrap parity report, residual-risk list, and Completion Review.
   - Repair attempts: 0
   - Recovery note: Reopen the lowest failing task and preserve all valid prior artifacts; do not bypass a failed compatibility, security, or parity gate.

## Verification Strategy

Validation is incremental and fail-closed:

1. Per-task contract tests and synthetic fixtures run first, with isolated temporary roots for any writer/packer experiment.
2. Each producer/consumer pair runs its focused replay, malformed-input, version, ownership, resume, and rollback tests before the next edge changes.
3. Renderer tests run separately for deterministic Markdown and direct HTML output; security tests run before any projection publication path is enabled.
4. Skill-specific suites run after their JSON migration: `make test-scan`, `make test-ddd`, `make test-autoresearch`, `make test-browse`, and `make test-upload`.
5. Bootstrap/package gates run after generated synchronization: `make test-package-index`, `make test-bootstrap`, and `make test-deterministic`.
6. Repository conformance and static checks run before the full suite: `make fmt-check`, `make lint`, and `make check`.
7. Final `make test` runs only after all pairwise and compatibility gates pass.
8. Browser E2E is a separate environment-sensitive signal; if Docker is unavailable, record it as unavailable and do not claim E2E proof. If required, run `CSM_BROWSE_E2E_REQUIRE=1 make test-e2e` under the explicitly authorized browser environment.

Parallel validation is allowed only for tests with disjoint output roots and no shared mutable artifact. Packer tests must use an isolated output root or a verified check-only mode. No package install, generator, build, formatter, or test may write outside its task sandbox except intentional implementation and plan artifacts.

## Risks And Recovery

- **Shared envelope breaks existing contracts:** keep domain payloads separate, register adapters, and do not migrate a producer until old/new replay passes.
- **Validator is incomplete:** T002 blocks foundation completion; no partial validator may be promoted as Draft 2020-12 support.
- **Canonical serialization changes digests:** preserve domain-native hash rules where required and add outer descriptors rather than rewriting hash-chain formats.
- **Markdown split-brain:** new writers produce JSON only; projections are generated on demand; legacy Markdown is read-only and returns migration-required to new machine consumers.
- **Plan/build strand existing workflows:** migrate plan and build as a paired edge with pause/resume, malformed input, source-lineage, and rollback fixtures before changing discovery defaults.
- **DDD mixed generation:** retain last complete report/graph pointer until both new JSON artifacts validate and pair consumers pass.
- **Bootstrap drift:** T005 owns packer mappings and generated copies; T023 owns skill contract text/indexing and invokes the T005 mapping without editing it; package/index gates fail on missing or changed canonical files.
- **Unsafe HTML:** disable HTML projection if sanitizer/CSP/URL policy is incomplete; Markdown/JSON remain available.
- **Projection becomes an input:** T010 provides classification and edge-scoped resolver behavior; T022 alone enables the global negative discovery rule after all edge replays pass.
- **External upload side effects:** use local stubs and explicit descriptors; never claim live publication verification without authorized evidence.
- **Interrupted writes:** stage, validate, digest, and atomically replace; preserve prior complete artifact and quarantine incomplete output.
- **Rollback:** restore resolver/feature-gate defaults or adapter selection; never delete canonical JSON or legacy history.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| Envelope ownership and schema revision were undefined. | high | T002-T004 explicitly select validator/serializer, define envelope/payload ownership, register immutable revisions, and add compatibility replay before any migration. | Research track R2; T002-T004. |
| Markdown consumers and resume cursors could be cut over prematurely. | critical | T001 characterizes behavior; T010 freezes history without changing global defaults; T016-T022 pair every producer with its consumer and block global rejection until all replay gates pass. | Research track R5; T001, T010, T016-T022. |
| Renderer output could become a second source of truth. | high | T006-T009 make projections disposable, digest-linked, profile-versioned, and undiscoverable; T022 adds negative machine-input tests. | Research track R3; cited research `:129-184`. |
| DDD report/graph could publish mixed generations. | high | T012 preserves paired JSON publication, matching run IDs/digests, last-complete pointer, and plan/build pair tests. | Existing DDD publication contract; T012. |
| Bootstrap could ship incomplete shared contracts. | high | T005 exclusively owns packer mappings and generated parity; T023 updates skill contracts/indexing; T024 runs package/index/bootstrap gates. | Research track R4; `scripts/pack-bootstrap.mjs`. |
| External browser/upload behavior was under-specified. | high | T021 separates binary evidence descriptors from projections, uses stubs, records E2E availability, and prohibits live side effects. | Research track R6; browse/upload contracts. |
| Acceptance commands could be merely future filenames. | critical | Every named test is an implementation deliverable with required fixture classes and assertions in its owning task; T001 establishes the fixture manifest and T024 runs environment preflight before final gates. | Independent critique; T001-T024 acceptance evidence. |
| Shared-file ownership could race in parallel groups. | critical | Producer tasks own only producer files; T016/T017/T020 own downstream resolvers; T005 owns packer mappings; T009 owns shared publication; T022 owns the global cutover. | Independent critique; Execution Graph and Design ownership rule. |
| Renderer policy could remain an unsafe unresolved blocker. | high | T006/T008/T009 contain blocking spikes for feature allowlists, sanitizer, CSP delivery, storage permissions, retention, and crash cleanup; dependents cannot activate until their signals pass. | Independent critique; T006, T008, T009. |
| Plan was too broad to resume safely. | high | 24 stable tasks have non-overlapping ownership, dependencies, acceptance signals, recovery notes, and all remain pending for csm-build. | This document's Execution Graph and Numbered Plan. |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-25 | 0 | INTAKE -> DISCOVER | none | Agreed `format: csm-grill/1` approach loaded; scope classified as warranted high-consequence migration. | DISCOVER |
| 2026-08-25 | 0 | DISCOVER -> RESEARCH | none | Four independent read-only tracks mapped contracts, renderers, migration edges, tests, bootstrap, and uncertainties; no files changed. | RESEARCH |
| 2026-08-25 | 0 | RESEARCH -> DRAFT | none | Current producer/consumer topology and existing acceptance gates synthesized into a renderer-first, edge-gated design. | DRAFT |
| 2026-08-25 | 0 | DRAFT -> CRITIQUE | T001-T024 | Draft includes all tasks pending, exact acceptance signals, applicability obligations, rollback/recovery, and safe parallel groups. | CRITIQUE |
| 2026-08-25 | 0 | CRITIQUE -> REMEDIATE | T001-T024 | Independent critique findings resolved in the plan: validator spike, legacy boundary, DDD pairing, bootstrap isolation, E2E availability, and producer/consumer cutover gates. | REMEDIATE |
| 2026-08-25 | 0 | REMEDIATE -> VERIFY | T001-T024 | Remediation incorporated; no implementation or mutating experiment performed. | VERIFY |
| 2026-08-25 | 0 | VERIFY -> SAVED | T001-T024 | Primary verification confirmed exact applicability JSON, all tasks pending, producer/consumer ownership serialization, explicit artifact inventory, edge-scoped legacy behavior, acceptance signals, rollback/recovery, renderer security, bootstrap parity, and final environment preflight. | SAVED |
| 2026-08-25 | 0 | SAVED -> RECOVER | none | Explicit user request authorized execution of this saved plan; repository is clean at `6e3847e`. | RECOVER |
| 2026-08-25 | 0 | RECOVER -> VALIDATE | none | Plan format `csm-plan/1` and warranted applicability record were found; no root NORMS.md exists; current branch is `main`; no DDD artifacts are explicitly referenced. | VALIDATE |
| 2026-08-25 | 0 | VALIDATE -> SELECT | none | `make check` passed with 1189 checks; applicability obligations are present; T001 and T002 are the only dependency-ready implementation tasks. | SELECT |
| 2026-08-25 | 0 | SELECT -> DISPATCH | T001,T002 | Independent write scopes: characterization fixtures/ledger versus isolated validator/serializer implementation and tests. | DISPATCH |
| 2026-08-25 | 0 | DISPATCH -> INTEGRATE | T001,T002 | Both workers returned changes with focused acceptance results; actual diffs were inspected and no out-of-scope skill/consumer edits were found. | INTEGRATE |
| 2026-08-25 | 0 | INTEGRATE -> VERIFY | T001,T002 | Primary rerun passed `node --test --test-concurrency=1 tests/json-migration-characterization.test.mjs tests/schema-runtime-selection.test.mjs` (9 tests) and `make check` (1189 checks). | VERIFY |
| 2026-08-25 | 0 | VERIFY -> REVIEW | T001,T002 | T001/T002 acceptance evidence is reproducible; T002 limitations are recorded and domain semantic validators remain separate. | REVIEW |
| 2026-08-25 | 0 | REVIEW -> CHECKPOINT | T001,T002 | Primary review found no material regression; temporary spike note was folded into the plan and removed; package/runtime changes remain scoped to T002. | CHECKPOINT |
| 2026-08-25 | 0 | CHECKPOINT -> REPAIR | T001,T002 | Independent review found strict validation gaps, sparse-array canonicalization, and insufficient executable characterization coverage. | REPAIR |
| 2026-08-25 | 0 | REPAIR -> VERIFY | T001,T002 | Added strict-schema compatibility settings, sparse-array rejection, truthful format metadata, schema fixtures, and executable replay assertions; focused acceptance now passes 10 tests. | VERIFY |
| 2026-08-25 | 0 | VERIFY -> REVIEW | T001,T002 | Fresh review confirmed prior findings resolved; residual risks are limited to domain semantic validation and non-RFC-8785 number canonicalization. | REVIEW |
| 2026-08-25 | 0 | REVIEW -> CHECKPOINT | T001,T002 | Foundation batch is ready for checkpoint commit; no temporary spike artifact remains and no unrelated paths changed. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> SELECT | T003 | T001/T002 commit `6a2af8d` passed hook gates; T003 is the only ready task and owns canonical shared contracts. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T003 | Shared schema/registry ownership is serialized; no renderer, bootstrap, or skill migration task is dispatched concurrently. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> INTEGRATE | T003 | Worker returned shared schemas, registry, runtime semantics, and focused tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 1 | INTEGRATE -> VERIFY | T003 | Primary rerun passed `node --test --test-concurrency=1 tests/schema-registry.test.mjs tests/schema-validation.test.mjs` (23 tests) and `make check` (1189 checks). | VERIFY |
| 2026-08-25 | 1 | VERIFY -> REVIEW | T003 | T003 acceptance, registry integrity, payload dispatch, lineage, journals, projections, and malformed-input behavior are reproducible. | REVIEW |
| 2026-08-25 | 1 | REVIEW -> REPAIR | T003 | Independent review cycles found and repaired registry/envelope/journal/projection/lineage/revision fail-open cases. | REPAIR |
| 2026-08-25 | 1 | REPAIR -> VERIFY | T003 | Repaired focused suite passed 23 tests and `make check` passed 1189 checks. | VERIFY |
| 2026-08-25 | 1 | VERIFY -> REVIEW | T003 | Final independent review returned PROCEED; no material blocker remains for T004. | REVIEW |
| 2026-08-25 | 1 | REVIEW -> CHECKPOINT | T003 | T003 is complete; residual risk is limited to compatibility enforcement in T004 and full-suite verification later. | CHECKPOINT |
| 2026-08-25 | 2 | CHECKPOINT -> SELECT | T004 | T003 commit `b48591d` passed hook gates; T004 is the only dependency-ready task. | SELECT |
| 2026-08-25 | 2 | SELECT -> DISPATCH | T004 | Compatibility registry/adapter ownership is serialized before bootstrap or renderer work. | DISPATCH |
| 2026-08-25 | 2 | DISPATCH -> INTEGRATE | T004 | Worker returned compatibility runtime, matrix updates, adapter fixtures, and focused tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 2 | INTEGRATE -> VERIFY | T004 | Primary rerun passed compatibility/replay tests (14 tests), `make fmt-check`, `make check` (1189), and full `make test` (1283). | VERIFY |
| 2026-08-25 | 2 | VERIFY -> REVIEW | T004 | T004 acceptance and full-suite evidence are reproducible; residual risks are trusted adapter code and conservative diff classification. | REVIEW |
| 2026-08-25 | 2 | REVIEW -> REPAIR | T004 | Independent review found malformed batch/throw handling and mutable output snapshots; repairs were integrated. | REPAIR |
| 2026-08-25 | 2 | REPAIR -> VERIFY | T004 | Repaired focused suite passed 14 tests and full `make test` passed 1283 tests. | VERIFY |
| 2026-08-25 | 2 | VERIFY -> REVIEW | T004 | Final independent review returned PROCEED; no material blocker remains for T005. | REVIEW |
| 2026-08-25 | 2 | REVIEW -> CHECKPOINT | T004 | T004 is complete and ready for checkpoint commit; compatibility remains matrix/adapter controlled. | CHECKPOINT |
| 2026-08-25 | 3 | CHECKPOINT -> SELECT | T005 | T004 commit `86f2cd0` passed hook gates; T005 is the only dependency-ready task and owns packer mappings/parity. | SELECT |
| 2026-08-25 | 3 | SELECT -> DISPATCH | T005 | Packaging ownership is serialized; renderer and skill migration tasks remain undispatched. | DISPATCH |
| 2026-08-25 | 3 | DISPATCH -> INTEGRATE | T005 | Worker returned packer output-root isolation, shared foundation mappings, generated payloads, and packaging tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 3 | INTEGRATE -> VERIFY | T005 | Primary rerun passed pinned packaging tests (10), package/bootstrap/deterministic gates, `make check`, formatting/lint, and current full `make test` (1283). | VERIFY |
| 2026-08-25 | 3 | VERIFY -> REVIEW | T005 | T005 parity, source/destination containment, generated ownership, and staging behavior are reproducible. | REVIEW |
| 2026-08-25 | 3 | REVIEW -> REPAIR | T005 | Independent review found output-root source containment and missing current generated/full-suite evidence; repair and commit sequencing completed. | REPAIR |
| 2026-08-25 | 3 | REPAIR -> VERIFY | T005 | Nested canonical-source root regression passed; current full `make test` passed 1283 tests. | VERIFY |
| 2026-08-25 | 3 | VERIFY -> REVIEW | T005 | Final independent review returned PROCEED; residual risks are Node 22 wrapper requirement and external browser/publication scope. | REVIEW |
| 2026-08-25 | 3 | REVIEW -> CHECKPOINT | T005 | T005 is complete and ready for checkpoint commit; renderer packaging will extend the canonical mapping in a later phase. | CHECKPOINT |
| 2026-08-25 | 4 | CHECKPOINT -> SELECT | T006 | T005 commit `1023a91` passed hook gates; T006 is the only ready renderer foundation task. | SELECT |
| 2026-08-25 | 4 | SELECT -> DISPATCH | T006 | Render profile/model ownership is serialized before Markdown/HTML renderer implementation. | DISPATCH |
| 2026-08-25 | 4 | DISPATCH -> INTEGRATE | T006 | Worker returned render profile/model schemas, runtime, registry updates, and focused tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 4 | INTEGRATE -> VERIFY | T006 | Primary rerun passed render-profile tests (12), `make check` (1189), `make fmt-check`, and `make lint`. | VERIFY |
| 2026-08-25 | 4 | VERIFY -> REVIEW | T006 | T006 identity, typed values, redaction, URL/order behavior, and model validation are reproducible. | REVIEW |
| 2026-08-25 | 4 | REVIEW -> REPAIR | T006 | Independent review found omit, typed-kind, URL, registry, source-schema, and no-op gaps; repairs were integrated. | REPAIR |
| 2026-08-25 | 4 | REPAIR -> VERIFY | T006 | Repaired focused suite passed 12 tests and all required checks passed. | VERIFY |
| 2026-08-25 | 4 | VERIFY -> REVIEW | T006 | Final independent review returned PROCEED; T007 may consume only validated render models. | REVIEW |
| 2026-08-25 | 4 | REVIEW -> CHECKPOINT | T006 | T006 is complete; bootstrap synchronization for render files remains T023/T005 packaging extension work. | CHECKPOINT |
| 2026-08-25 | 5 | CHECKPOINT -> SELECT | T007,T008 | T006 commit `44f1af4` passed hook gates; T007/T008 are independent renderer tasks ready on the validated render model. | SELECT |
| 2026-08-25 | 5 | SELECT -> DISPATCH | T007,T008 | Disjoint ownership: Markdown renderer/tests versus HTML renderer/security/accessibility/tests. | DISPATCH |
| 2026-08-25 | 5 | DISPATCH -> INTEGRATE | T007,T008 | Workers returned Markdown/HTML renderer modules, security policy, fixtures, and tests; actual diffs were inspected. | INTEGRATE |
| 2026-08-25 | 5 | INTEGRATE -> VERIFY | T007,T008 | Primary rerun passed combined renderer/model tests (31), `make check` (1189), `make fmt-check`, and `make lint`. | VERIFY |
| 2026-08-25 | 5 | VERIFY -> REVIEW | T007,T008 | Renderer output, projection descriptors, URL/HTML/Markdown safety, and direct-model boundaries are reproducible. | REVIEW |
| 2026-08-25 | 5 | REVIEW -> REPAIR | T007,T008 | Independent review found provenance, URL, newline, profile-policy, and ID uniqueness gaps; repairs were integrated. | REPAIR |
| 2026-08-25 | 5 | REPAIR -> VERIFY | T007,T008 | Repaired combined renderer/model suite passed 31 tests and all required checks passed. | VERIFY |
| 2026-08-25 | 5 | VERIFY -> REVIEW | T007,T008 | Final independent review returned PROCEED for both renderers; browser-level E2E remains a later residual risk. | REVIEW |
| 2026-08-25 | 5 | REVIEW -> CHECKPOINT | T007,T008 | T007/T008 are complete; publication protocol T009 will own projection storage/approval lifecycle. | CHECKPOINT |
| 2026-08-25 | 6 | CHECKPOINT -> SELECT | T009 | T007/T008 commit `a854088` passed hook gates; T009 is the only ready publication task. | SELECT |
| 2026-08-25 | 6 | SELECT -> DISPATCH | T009 | Publication/interaction/export ownership is serialized before any skill migration. | DISPATCH |
| 2026-08-25 | 6 | DISPATCH -> INTEGRATE | T009 | Worker returned publication runtime, transient store, machine-input guard, and focused tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 6 | INTEGRATE -> VERIFY | T009 | Primary rerun passed publication/projection tests (12), `make check` (1189), `make fmt-check`, and `make lint`. | VERIFY |
| 2026-08-25 | 6 | VERIFY -> REVIEW | T009 | Share modes, approval, projection discovery, storage cleanup, path integrity, and symlink handling are reproducible. | REVIEW |
| 2026-08-25 | 6 | REVIEW -> REPAIR | T009 | Independent review found explicit HTML, storage deletion, descriptor, cycle, timestamp, metadata, and symlink cleanup gaps; repairs were integrated. | REPAIR |
| 2026-08-25 | 6 | REPAIR -> VERIFY | T009 | Repaired focused suite passed 12 tests and all required checks passed. | VERIFY |
| 2026-08-25 | 6 | VERIFY -> REVIEW | T009 | Final independent review returned PROCEED; residual risks are recorded and do not block T010. | REVIEW |
| 2026-08-25 | 6 | REVIEW -> CHECKPOINT | T009 | T009 is complete; T010 will add the edge-scoped artifact resolver and legacy boundary. | CHECKPOINT |
| 2026-08-25 | 7 | CHECKPOINT -> SELECT | T010 | T009 commit `5676ba5` passed hook gates; T010 is the only ready history/resolver task. | SELECT |
| 2026-08-25 | 7 | SELECT -> DISPATCH | T010 | Edge-scoped resolver and legacy classification ownership is serialized before producer migration. | DISPATCH |
| 2026-08-25 | 7 | DISPATCH -> INTEGRATE | T010 | Worker returned edge-scoped resolver, legacy classifier, and focused tests; actual diff was inspected. | INTEGRATE |
| 2026-08-25 | 7 | INTEGRATE -> VERIFY | T010 | Primary rerun passed resolver/legacy tests (12), `make check` (1189), `make fmt-check`, and `make lint`. | VERIFY |
| 2026-08-25 | 7 | VERIFY -> REVIEW | T010 | Resolver discovery, legacy, path, digest, owner, terminal, JSONL, and compatibility behavior are reproducible. | REVIEW |
| 2026-08-25 | 7 | REVIEW -> REPAIR | T010 | Independent review found discovery fail-open, symlink/TOCTOU, duplicate-key, empty JSONL, legacy traversal, mixed-owner, and opened-path gaps; repairs were integrated. | REPAIR |
| 2026-08-25 | 7 | REPAIR -> VERIFY | T010 | Repaired focused suite passed 12 tests and all required checks passed. | VERIFY |
| 2026-08-25 | 7 | VERIFY -> REVIEW | T010 | Final independent review returned PROCEED; residual risk is lack of timing-based race injection only. | REVIEW |
| 2026-08-25 | 7 | REVIEW -> CHECKPOINT | T010 | T010 is complete; T011 will migrate csm-scan norms and its downstream consumers. | CHECKPOINT |

## Completion Review

Filled by `csm-build` after all tasks and acceptance evidence are complete. Planning intentionally leaves this section unexecuted.
