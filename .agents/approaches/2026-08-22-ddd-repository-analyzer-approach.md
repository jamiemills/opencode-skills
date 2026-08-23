format: csm-grill/1

# DDD Repository Analyzer Approach

- Idea slug: ddd-repository-analyzer
- Date: 2026-08-22
- Status: agreed

## How To Execute

Each phase brief below is a starting brief for a separate, explicit `csm-plan` invocation. This document authorizes no implementation and does not start any plan or build.

## Idea Statement

Create an isolated, read-only DDD-specific repository analyzer. It analyzes one repository by default, optionally consumes a visible `NORMS.md`, and may inspect bounded Git history as inferred evidence. It produces a human-readable dated Markdown report and a separate machine-readable canonical JSON graph. It identifies capabilities, language, workflows, context hypotheses, relationships, coupling, seams, candidate refactoring slices, and recommended ordering without asserting that any bounded context has been proven automatically.

The analyzer supports both instruction-led and CLI entry points over one canonical pipeline. It asks interactive questions only when repository evidence cannot resolve a material domain ambiguity. CLI mode supports non-interactive operation and approved question files. It never executes target code or silently becomes a review, implementation plan, or build.

## Decisions Log

| Question | Answer | Rationale |
| -------- | ------ | --------- |
| Primary identity? | Read-only DDD repository analyzer | Keeps analysis separate from `csm-grill`, `csm-plan`, `csm-build`, `csm-scan`, and `csm-review`. |
| What may it claim? | Evidence-backed hypotheses with explicit basis and confidence | A repository cannot prove a bounded context without domain and ownership validation. |
| Primary output? | Markdown report plus machine-readable graph | Human interpretation and machine consumption need separate stable contracts. |
| Relationship to `csm-scan`? | Isolated; optionally consumes visible `NORMS.md` | Avoids duplicating the 17-dimension scanner while allowing contextual input. |
| Refactoring guidance? | Candidate slices and recommended ordering, not implementation tasks | Ordering is useful analysis; task decomposition belongs to `csm-plan`. |
| Domain validation? | Interactive questions when materially necessary | Static evidence cannot resolve business meaning, ownership, or criticality gaps. |
| Repository scope? | One repository unless more are explicitly specified | Keeps context maps and coupling evidence coherent by default. |
| Safety posture? | Static and read-only by default | Prevents analysis from changing or executing the target repository. |
| Artifact location? | `.agents/ddd/` and `.agents/ddd/artifacts/` | Gives DDD analysis a distinct artifact contract. |
| Entry points? | Both instruction-led and CLI | Supports agent workflows and repeatable automation over one pipeline. |
| Graph format? | Canonical JSON v1; JSON-LD deferred | Simple deterministic internal contract now, interoperability later if required. |
| Hypothesis status? | Existing basis values plus `claimKind: context_hypothesis` | Avoids conflating evidence basis with confidence or domain interpretation. |
| CLI questions? | `--non-interactive` and `--question-file` | Supports automation without prematurely standardizing stdin protocols. |
| Existing scan evidence? | Only visible `NORMS.md`, provenance preserved | Keeps the analyzer isolated from raw `csm-scan` internals. |
| Git history? | Optional bounded read-only evidence by default | Co-change and ownership signals help, but remain inferred rather than domain truth. |

## Research Synthesis

The saved DDD research finding separates two concerns: DDD helps hypothesize what should be separated, while seam analysis identifies where separation can safely begin. It recommends combining language/model cohesion, business capability, invariants, data ownership, coupling, nonfunctional needs, ownership, and evolution patterns. It also warns that repository folders and skill directories are not automatically bounded contexts.

The current repository already has explicit artifact, activation, state-machine, format, and handoff contracts. Those are strong candidate integration seams. `csm-scan` owns broad static inventory and `NORMS.md`; the proposed analyzer should own capability, language, workflow, context, ownership-gap, and seam synthesis instead of repeating generic inventory.

The graph research recommends a custom normalized JSON graph with explicit nodes, edges, claims, evidence, questions, and answers. JSON Schema validation, deterministic ordering, stable provenance IDs, and separate confidence/basis fields align with existing `csm-scan` evidence conventions. JSON-LD/RDF remains a future projection, not a second source of truth.

Key references:

- `.agents/research/2026-08-22-ddd-repo-analysis-refactoring-research.md`
- `README.md`, composition matrix and artifact ledger
- `csm-scan/SKILL.md`, evidence model, privacy, determinism, and output contract
- Martin Fowler, “Bounded Context,” https://martinfowler.com/bliki/BoundedContext.html
- Martin Fowler, “Legacy Seam,” https://martinfowler.com/bliki/LegacySeam.html
- Microsoft Learn, domain analysis and microservice boundaries
- JSON Schema specification, https://json-schema.org/specification

## Phasing

```text
[1. Contracts] --> [2. Static Analysis] --> [3. DDD Synthesis]
        \                 |                         |
         \                v                         v
          +-------> [4. Clarification] -------> [5. Adapters]
                                                    |
                                                    v
                                           [6. Validation/Handoff]
```

```mermaid
flowchart LR
    p1["Phase 1: Evidence and artifact contracts"] --> p2["Phase 2: Static repository analysis"]
    p2 --> p3["Phase 3: DDD hypotheses and seams"]
    p3 --> p4["Phase 4: Interactive clarification"]
    p4 --> p5["Phase 5: Instruction and CLI adapters"]
    p5 --> p6["Phase 6: Validation and handoff"]
    p2 -. optional NORMS.md .-> p3
    p3 -. unresolved domain questions .-> p4
```

## Phase Briefs

### Phase 1: Evidence And Artifact Contracts

- Goal: Define stable contracts for the DDD report, graph, claims, evidence, questions, answers, privacy, and deterministic rendering.
- Deliverables: Report format contract; canonical graph JSON Schema; evidence-ID rules; status/basis/confidence model; artifact path contract.
- Scope: `format: csm-ddd-report/1`, `format: csm-ddd-graph/1`, nodes, edges, claims, evidence, context hypotheses, questions, answers, redaction, caps, and ordering.
- Out of scope: Repository detectors, interactive UX, CLI commands, implementation plans, and JSON-LD/RDF.
- Constraints: One Markdown report and one separate JSON graph; no Markdown parsing as the machine API; preserve repository-relative provenance and privacy.
- Acceptance hints: Valid fixtures pass schema validation; invalid status/evidence/provenance fixtures fail; identical inputs produce byte-stable graph ordering; report references the graph run identifier.
- Dependencies: None.
- Context: `.agents/research/2026-08-22-ddd-repo-analysis-refactoring-research.md`; `csm-scan/SKILL.md` evidence and determinism sections; JSON Schema specification.

### Phase 2: Static Repository Analysis

- Goal: Extract admissible repository evidence without executing target code.
- Deliverables: Canonical evidence collection pipeline for one repository; optional `NORMS.md` input loader; bounded Git-history evidence; source/artifact inventory.
- Scope: Files, declarations, commands, workflows, events, states, consumers, data/integration signals, ownership hints, co-change history, and evidence limitations.
- Out of scope: Business truth assertions, runtime behavior claims, target tests/builds/migrations, generic replacement of `csm-scan`, and multi-repository defaults.
- Constraints: Read-only Git and file access; bounded files/bytes/history; no installs or package managers; all facts retain source provenance; `NORMS.md` remains untrusted.
- Acceptance hints: Synthetic fixtures produce observed/inferred/unverified evidence correctly; caps are disclosed; secrets and absolute paths are redacted; unavailable constructs are not reported as absent.
- Dependencies: Phase 1.
- Context: `csm-scan/SKILL.md`; `scripts/lib/contracts.mjs`; repository source tree; optional visible `NORMS.md`.

### Phase 3: DDD Hypotheses And Seams

- Goal: Transform static evidence into domain-oriented hypotheses and candidate refactoring seams.
- Deliverables: Capability map; terminology/conflict matrix; workflow map; context hypotheses; context-map relationships; seam inventory; candidate refactoring slices and recommended ordering.
- Scope: Business outcomes, core/supporting/generic classification, language, invariants, data ownership, context hypotheses, coupling, ownership gaps, enabling points, rollback considerations, and confidence.
- Out of scope: Automatic proof of bounded contexts, numbered implementation tasks, service extraction, code changes, or deployment decisions.
- Constraints: Contexts are hypotheses; distinguish observed, inferred, and unverified; separate confidence from basis; expose alternatives and evidence gaps; do not infer domain truth from names alone.
- Acceptance hints: A fixture with conflicting terminology creates separate hypotheses or an explicit ambiguity; a seam includes enabling point, observable behavior, side effects, redirectable slice, and rollback option; ordering cites evidence and names uncertainty.
- Dependencies: Phase 1 and Phase 2.
- Context: Saved DDD research finding, especially context and seam sections; Microsoft domain analysis and boundary guidance; Fowler’s bounded-context and legacy-seam guidance.

### Phase 4: Interactive Clarification

- Goal: Resolve material domain ambiguities without turning the analyzer into a general planning interview.
- Deliverables: One-question-at-a-time instruction-led clarification flow; question and answer graph nodes; CLI question-file reader; non-interactive unresolved-question behavior.
- Scope: Business outcome, authoritative terminology, capability ownership, critical workflows, data ownership, and whether a proposed boundary is analytical, modular, or deployable.
- Out of scope: Asking for facts already present in the repository; open-ended product discovery; implementation approval; automatic acceptance of user answers as repository facts.
- Constraints: Questions are only asked when ambiguity can change the analysis; answers are marked user-provided evidence; `--non-interactive` emits unverified gaps; no question batching.
- Acceptance hints: Instruction mode asks one dependency-ordered question; question-file answers replay deterministically; missing answers remain explicitly unverified; user answers cannot overwrite static evidence.
- Dependencies: Phase 3.
- Context: `csm-grill/SKILL.md` questioning rules; graph question/answer contract from Phase 1.

### Phase 5: Instruction And CLI Adapters

- Goal: Expose the same canonical analyzer through instruction-led and repeatable CLI entry points.
- Deliverables: Instruction adapter; CLI adapter; normalized request model; output path options; limits and question options; report/graph writer integration.
- Scope: `--repo`, `--norms`, `--out-report`, `--out-graph`, `--non-interactive`, `--question-file`, `--max-files`, and `--max-bytes`.
- Out of scope: JSON-LD/RDF, live service integration, runtime probes, target execution, multi-repository orchestration, and automatic handoff invocation.
- Constraints: Both adapters use one canonical pipeline; defaults remain one repo and static/read-only; output paths must obey artifact rules; failures disclose incomplete coverage rather than fabricate absence.
- Acceptance hints: Equivalent instruction and CLI inputs produce equivalent normalized claims and graph ordering; non-interactive runs terminate with unresolved questions; path and limit validation is deterministic.
- Dependencies: Phases 1 through 4.
- Context: Existing instruction-led skills; `scripts/` CLI conventions; `.agents/ddd/` artifact contract.

### Phase 6: Validation And Handoff

- Goal: Validate the analyzer against real repository structures and establish safe downstream use.
- Deliverables: Current-repository analysis report and graph; fixture corpus; comparison notes for adjacent skills; handoff guidance to `csm-grill` and `csm-plan`; artifact registration updates.
- Scope: This skills repository and targeted synthetic fixtures; compare `csm-scan`/`csm-review` and `csm-bdd-tdd`/`csm-make-tests` without merging their responsibilities; verify report/graph provenance and privacy.
- Out of scope: Refactoring the skills repository; changing existing skills; executing target code; automatically starting `csm-grill`, `csm-plan`, or `csm-build`.
- Constraints: Findings remain hypotheses; implementation tasks remain outside the analyzer; all output is independently reviewable; deletion or migration recommendations require explicit uncertainty and rollback notes.
- Acceptance hints: The current repository yields both artifacts; graph validates; report references graph; protected-state checks show no target mutation beyond owned artifacts; adjacent-capability comparisons are evidence-backed.
- Dependencies: Phases 1 through 5.
- Context: `README.md`; `.agents/README.md`; `scripts/lib/contracts.mjs`; current DDD research finding; existing artifact-validation conventions.

## Open Questions And Rejected Options

Open questions deliberately deferred:

- Whether a future consumer needs JSON-LD/RDF projection.
- Whether structured stdin is needed after question-file usage stabilizes.
- Whether multi-repository context maps justify a separate explicit mode.
- Which domain-specific detectors should be added after fixture evidence identifies demand.

Rejected options:

- **New orchestration skill:** rejected because `csm-grill`, `csm-deep-research`, `csm-plan`, and `csm-build` already own orchestration and handoffs.
- **Replacement for `csm-scan`:** rejected because broad static inventory and `NORMS.md` already have a defined owner.
- **Repository review skill:** rejected because `csm-review` owns defect and risk assessment; this analyzer reconstructs domain structure and seams.
- **Automatic bounded-context assertions:** rejected because static structure cannot establish business meaning, ownership, or stakeholder agreement.
- **Markdown as the machine API:** rejected because report prose and tables are human-oriented and unstable for consumers.
- **JSON-LD/RDF as the initial source of truth:** rejected as unnecessary complexity before an interoperability requirement exists.
- **Runtime execution by default:** rejected because target execution introduces side effects and can confuse observed runtime behavior with static domain evidence.
