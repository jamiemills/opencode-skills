format: csm-deep-research/1

# JSON Migration Implementation Assessment Research Finding

## TL;DR

The JSON migration is substantially implemented and locally tested, but the completion claim is too strong. The architecture and sequencing were good; required follow-up remains for DDD/norms/review edge parity, positive producer-consumer replay, retained final evidence, and several integrity/operational hardening items.

## Executive Summary

```text
Research + approach + plan -> implementation -> independent assessment
                                      |                    |
                              strong local gates      partial completion
                                      v                    v
                         harden missing edges and retain evidence
```

The original approach correctly chose JSON as the source of truth, direct sibling renderers, immutable schema revisions, compatibility adapters, explicit projections, and read-only Markdown history [R1][R2]. The implementation follows that sequence through foundation, renderers, publication, producer migrations, consumer cutover, documentation, and local gates [R3].

The evidence supports a strong local implementation result: schema/runtime, renderers, compatibility, path/digest checks, replay fixtures, bootstrap parity, and the recorded `1283/1283` test run are present in the repository [R4][R5]. It does not support an unqualified production-complete claim. Several declared edges have rejection-only coverage or lack a persisted/generic resolver, DDD retains a Markdown norms-input boundary despite JSON default output, and final evidence is asserted in the plan rather than retained as a machine-readable T024 receipt [R6][R7].

## Key Findings

1. **supported** The core JSON architecture and migration sequencing match the agreed approach [R1][R2][R3].
2. **partially-supported** Local behavior is substantially implemented and tested, but the plan overstates full edge and completion evidence [R4][R5][R6].
3. **partially-supported** DDD and some cross-skill edges do not yet demonstrate the declared JSON-only consumer contract [R7].
4. **partially-supported** Security and integrity controls are strong at the shared boundary, but artifact identity, parsing, atomic-write, and resource-limit gaps remain [R8].
5. **partially-supported** The local protocol design is coherent but carries avoidable duplication and brittle bootstrap import rewriting [R8].
6. **partially-supported** A live browser-to-GitHub publication was observed successfully, but the result is not incorporated into repository-retained T024 evidence [R9].

## Detail Sections

### 1. Architecture and sequencing

The research and approach explicitly separate canonical JSON, projections, compatibility, publication, and legacy history. The plan's dependency graph puts shared validation and renderers before producer migration, consumer migration before global cutover, and documentation before final gates [R1][R2][R3]. This is the right risk order and avoids a global flip before pairwise evidence.

### 2. What is implemented

The repository contains shared Draft 2020-12 validation, immutable registries, canonical serialization/digests, compatibility runtime, JSON-to-Markdown/HTML rendering, publication metadata, artifact resolution, typed plan/BDD/test/build/browse/upload artifacts, and bootstrap mappings [R4]. Focused suites cover lifecycle recovery, source lineage, path safety, projections, binary evidence, and publication stubs [R5].

### 3. Completion evidence

The plan records all implementation tasks complete and records `1283/1283` tests plus conformance/lint/format/package gates [R3][R6]. However, the Makefile's `make test` is a composed suite rather than an exhaustive root-test manifest, the plan's Completion Review was initially empty, and retained gate baselines did not independently preserve the final T024 transcript [R6]. The evidence is credible but should be treated as “local gates passed” rather than a durable release receipt until a machine-readable final manifest is retained.

### 4. Missing consumer parity

The replay matrix now invokes feasible resolver paths, but five declared edges are documented as lacking a persisted/generic resolver: scan to review, DDD to plan, research to grill, research to make-tests, and review to grill [R5]. DDD output defaults to JSON and explicit paths are containment-checked, but DDD still reads `NORMS.md` and review still describes Markdown norms input [R7]. These are the primary required changes because they do not demonstrate the plan's stated JSON-only machine-consumer criterion; the proven DDD defect is the norms-input boundary, not an unrestricted output path.

### 5. Integrity and security gaps

The shared resolver rejects legacy/projection inputs, validates registered schemas, checks containment, ownership, and source digests, and supports adapter negotiation [R4]. Remaining risks include inconsistent duplicate-key parsing in older durable readers, predictable atomic temporary names, unbounded shared artifact discovery, and source-descriptor-to-file binding that depends on the caller [R8]. These are not reasons to discard the architecture, but they matter before treating the system as hardened.

### 6. Operational and maintainability costs

Bootstrap copies are protected by parity gates, but the implementation duplicates runtime files and rewrites relative imports by string substitution during packaging [R8]. This increases drift and makes new import forms easy to miss. Resolver discovery also performs repeated filesystem checks and can process large trees concurrently without explicit budgets [R8]. The lowest-risk optimization is to retain generated copies while adding import-closure smoke tests, bounded discovery, and a single documented transformation mechanism.

### 7. Live validation boundary

The later live run started isolated Chromium, navigated from `example.com` to IANA, captured a 1920x937 PNG, published it to the configured Pages repository, waited for the Pages status to become `built`, and reopened the public URL in Chromium. The image loaded with `complete: true` and natural dimensions 1920x937 [R9]. This is useful observed operational evidence, but it is not repository-retained and should be captured in a separate final receipt rather than retroactively conflated with the original local-only T024 record.

### 8. Prior research process quality

The original research was technically useful and cited primary standards, but it labeled itself DEEP while using primary-led challenge/judge work rather than independent roles [R1]. That weakens process assurance, not the architecture itself. Future architecture assessments should preserve independent challenge/judge outputs and separate observed test outcomes from plan assertions.

## Recommendation

**Recommendation: retain the architecture and classify the migration as substantially implemented with local gates passed, but release-hardening incomplete.** Before claiming production-grade completion, close the DDD/norms input boundary and either add persisted/generic resolvers for declared edges or explicitly remove those edges from the acceptance inventory; add positive replay fixtures using real producer outputs; retain a machine-readable T024 receipt; and close artifact digest, duplicate-key, atomic-write, discovery-limit, and descriptor-integrity gaps. Confidence is high for the architectural assessment and medium-high for implementation coverage because the repository contains extensive local evidence but not a single authoritative end-to-end receipt. The recommendation changes to “rework” only if real producer replay reveals incompatible payload semantics or if DDD Markdown/norms inputs must remain machine-authoritative.

## Unverified Claims

- **Decision-blocking:** Whether every claimed producer-consumer edge is required at runtime. Verify by enumerating actual entry points and either adding typed resolvers or updating the acceptance inventory.
- **Material risk:** Whether the current artifact digest fields are intended to mean file bytes, payload content, or source lineage. Verify by documenting one canonical digest meaning and mutation tests for each artifact family.
- **Material risk:** Whether the retained `1283/1283` result is reproducible from the current pushed commit and exact environment. Verify with a retained command manifest and environment receipt.
- **Context-dependent:** Whether RFC 8785 number canonicalization is needed. The current runtime records this as a limitation; verify only if cross-language numeric payloads are expected [R3].
- **Informational:** Browser E2E and GitHub Pages publication were observed once, but the evidence is not retained in the repository and repeated reliability is not established [R9].

## References

- [R1] `.agents/research/2026-08-25-typed-json-interstage-payloads-research.md`, workspace-local, retrieved 2026-08-26, especially lines 17-38, 42-54, 109-127, 198-208, 231-247. `file:///home/jamiemills/.config/opencode/skills/.agents/research/2026-08-25-typed-json-interstage-payloads-research.md`
- [R2] `.agents/approaches/2026-08-25-json-only-rendered-skill-outputs-approach.md`, workspace-local, retrieved 2026-08-26, lines 15-31, 39-81, 160-168. `file:///home/jamiemills/.config/opencode/skills/.agents/approaches/2026-08-25-json-only-rendered-skill-outputs-approach.md`
- [R3] `.agents/plans/2026-08-25-json-only-rendered-skill-outputs-csm.md`, workspace-local, retrieved 2026-08-26, lines 55-64, 253-264, 614-630, 833-850. `file:///home/jamiemills/.config/opencode/skills/.agents/plans/2026-08-25-json-only-rendered-skill-outputs-csm.md`
- [R4] Workspace-local implementation, retrieved 2026-08-26: `file:///home/jamiemills/.config/opencode/skills/lib/schema-runtime/index.mjs` lines 282-415; `file:///home/jamiemills/.config/opencode/skills/lib/compatibility-runtime/index.mjs` lines 188-318; `file:///home/jamiemills/.config/opencode/skills/lib/artifact-resolver/index.mjs` lines 143-214,237-303,317-351; `file:///home/jamiemills/.config/opencode/skills/lib/render-html/index.mjs` lines 309-406; `file:///home/jamiemills/.config/opencode/skills/lib/publication/index.mjs` lines 180-228,515-553.
- [R5] Workspace-local tests, retrieved 2026-08-26: `file:///home/jamiemills/.config/opencode/skills/tests/plan-json-resume.test.mjs`; `file:///home/jamiemills/.config/opencode/skills/tests/bdd-build-replay.test.mjs`; `file:///home/jamiemills/.config/opencode/skills/tests/make-tests-build-replay.test.mjs`; `file:///home/jamiemills/.config/opencode/skills/tests/build-json-control.test.mjs`; `file:///home/jamiemills/.config/opencode/skills/tests/browse-upload-json-contract.test.mjs`; `file:///home/jamiemills/.config/opencode/skills/tests/consumer-replay-matrix.test.mjs` lines 16-104.
- [R6] Workspace-local verification sources, retrieved 2026-08-26: `file:///home/jamiemills/.config/opencode/skills/Makefile` lines 32-82; `file:///home/jamiemills/.config/opencode/skills/.agents/docs/gate-baselines.json` lines 310-324; `file:///home/jamiemills/.config/opencode/skills/.agents/plans/2026-08-25-json-only-rendered-skill-outputs-csm.md` completion/review sections.
- [R7] Workspace-local consumer sources, retrieved 2026-08-26: `file:///home/jamiemills/.config/opencode/skills/csm-ddd/scripts/ddd.mjs` lines 24-27,94-120; `file:///home/jamiemills/.config/opencode/skills/csm-ddd/lib/ddd/extract.mjs` lines 121-171; `file:///home/jamiemills/.config/opencode/skills/csm-ddd/lib/ddd/pipeline.mjs` lines 119-127; `file:///home/jamiemills/.config/opencode/skills/csm-review/SKILL.md` lines 325-327; `file:///home/jamiemills/.config/opencode/skills/tests/consumer-replay-matrix.test.mjs` lines 51-83.
- [R8] Workspace-local hardening sources, retrieved 2026-08-26: `file:///home/jamiemills/.config/opencode/skills/lib/publication/index.mjs` lines 448-471,590-596; `file:///home/jamiemills/.config/opencode/skills/lib/artifact-resolver/index.mjs` lines 33-44,113-126,317-335; `file:///home/jamiemills/.config/opencode/skills/csm-autoresearch/lib/population/index.mjs` lines 119-157; `file:///home/jamiemills/.config/opencode/skills/csm-autoresearch/lib/runtime/index.mjs` lines 343-351; `file:///home/jamiemills/.config/opencode/skills/scripts/pack-bootstrap.mjs` lines 305-327.
- [R9] Session-observed browser/publication execution, retrieved 2026-08-26: Chromium session `live-pages-e2e`, GitHub Pages URL `https://jamiemills.github.io/csm-browse-pages/demo-2026-08-26-live-browser-e2e/`, and browser verification showing the published PNG loaded at 1920x937; not a repository-retained artifact.

## Process Appendix

**Control**

[20260826T084000Z] INTAKE -> TRIAGE :: cycle 1 :: trigger: local implementation assessment requested.

- Tier: DEEP; source mode: local.
- Scope: compare original research, approach, plan, implementation commits, tests, final gates, and subsequent live browser/publication evidence.
- Protected baseline: implementation worktree was clean except the pre-existing unrelated untracked research file; this finding is the only intended new research artifact.
- Independence: four local research tracks were run independently; challenge and judge outputs are recorded in the run journal outside this document's claim text.
- Journal: `[2026-08-26T08:40:00Z] INTAKE -> TRIAGE :: cycle 1 :: trigger: local implementation assessment requested`; `[2026-08-26T08:41:00Z] TRIAGE -> RESEARCH :: cycle 1 :: trigger: DEEP local-only four-track assessment`; `[2026-08-26T08:45:00Z] RESEARCH -> SYNTHESIZE :: cycle 1 :: trigger: four research tracks returned`; `[2026-08-26T08:50:00Z] SYNTHESIZE -> CHALLENGE :: cycle 1 :: trigger: draft finding assembled`; `[2026-08-26T08:55:00Z] CHALLENGE -> JUDGE :: cycle 1 :: trigger: adversarial claim review returned`; `[2026-08-26T09:00:00Z] JUDGE -> REMEDIATE :: cycle 1 :: trigger: targeted wording and citation remediation required`; `[2026-08-26T09:05:00Z] REMEDIATE -> VERIFY :: cycle 1 :: trigger: challenge resolutions applied`; `[2026-08-26T09:10:00Z] VERIFY -> SAVED :: cycle 1 :: trigger: structure, citation, redaction, and protected-state checks passed`.

**Method**

- Compared stated decisions and acceptance criteria against actual source files, schemas, mappings, tests, commits, and recorded gate results.
- Distinguished implementation evidence, structural conformance evidence, live operational evidence, and unverified claims.
- Used conservative verdicts when a plan assertion lacked a retained machine-readable receipt.

**Limitations**

- This assessment did not modify production code or rerun the implementation suite; it relies on repository evidence and the later live execution record.
- External GitHub behavior was observed for one publication, not load-tested or independently deployed.
