format: csm-deep-research/1

# Domain-Driven Repository Analysis For Refactoring Research Finding

## TL;DR

Analyze a repository in two passes: first reconstruct business capabilities, language, workflows, ownership, and change coupling; then locate seams where behavior can be observed or redirected. Treat contexts and seams as hypotheses, validate them with domain experts and measurable contracts, and refactor in small reversible slices with an explicit contract-and-delete gate.

## Executive Summary

DDD is not a folder-renaming exercise. A bounded context is a boundary within which a particular domain model and language are coherent [R1][R2]. A legacy seam is an enabling point where behavior can be substituted, observed, tested, or redirected [R3]. These are related but different: DDD helps decide *what should be separated*; seam analysis finds *where separation can safely begin*.

```text
Repository evidence + domain knowledge
        -> capability/language map
        -> context hypotheses + context map
        -> seam and contract validation
        -> characterization/parity baseline
        -> reversible refactoring slice
        -> observe, migrate, contract, delete
```

The current repository is a useful example of explicit workflow and artifact boundaries. Its `README.md` documents a research -> grill -> plan -> build flow, and its composition matrix records inputs, outputs, and handoffs [R4]. That is strong evidence for integration seams and ownership contracts, not proof that each skill directory is a bounded context. The supplied TypeScript/Python playbook correctly emphasizes strangler-style coexistence, anti-corruption layers, outbox reliability, data reconciliation, rollout controls, and deletion. Its mechanics should be selected per slice, not applied as a mandatory recipe.

## Key Findings

1. **Supported** DDD context hypotheses should combine model/language cohesion with business capability, invariants, coupling, nonfunctional needs, ownership, and evolution patterns [R1][R2][R5].
2. **Supported** A seam is an enabling point for behavior substitution; observability and redirection are valuable uses, but not the complete definition [R3].
3. **Supported** Static repository analysis is necessary but insufficient: vocabulary, workflows, hidden consumers, and ownership require stakeholder validation [R1][R6].
4. **Supported** The repository's artifact contracts, activation rules, format markers, state machines, and human-mediated handoffs are strong candidate seams [R4][R7]. They remain candidate integration boundaries until implementation, history, and owner evidence confirm them.
5. **Partially-supported** `expand -> compare -> canary -> migrate -> reconcile -> contract -> decommission` is a useful default lifecycle, but the exact ordering and mechanisms depend on side effects, state ownership, traffic shape, and reversibility [R8][R9][R10].
6. **Supported** Every migration needs explicit parity dimensions, rollback criteria, data-recovery controls, accountable ownership, and a time-bounded elimination gate [R8][R9][R11].
7. **Supported** Transactional outbox is appropriate when a context must atomically persist a local state change and publish an event; it is not a generic requirement for every modular refactor [R12].

## Detail Sections

### 1. Establish the analysis boundary and baseline

Pin the repository and define the refactoring outcome before interpreting architecture. Record what is in scope, what must remain behaviorally stable, and what success means: lower change cost, independent release, improved correctness, retirement of unsupported technology, or another business outcome [R8].

Build a read-only inventory of:

- entry points, commands, jobs, event handlers, and public exports;
- modules, packages, tables, files, queues, reports, and external integrations;
- tests, fixtures, configuration, CI, deployment, and operational runbooks;
- owners, commit history, co-change patterns, and release boundaries;
- side effects, data writers, caches, retries, and notification paths.

Do not execute application code as the first step. Static evidence establishes the map and its limitations; runtime evidence can later validate selected hypotheses in a safe sandbox or controlled environment.

### 2. Build the domain and language map

Create a terminology matrix with term, meaning, source locations, context candidate, synonyms, conflicting meanings, and domain owner. Repeated names are not automatically shared concepts. The same term with different fields, invariants, lifecycle, or users is evidence for distinct models [R1][R2].

Group evidence by business outcome rather than technical layer:

```text
Command/use case -> decision/rule -> state change -> event/output -> consumer
```

Classify each capability as core, supporting, or generic using business evidence, not code size or complexity [R1]. Map domain events, commands, policies, aggregates or transactional consistency requirements, and data ownership. Event Storming or equivalent collaborative mapping is useful because repository vocabulary cannot reveal all informal workarounds and competing meanings [R6].

### 3. Form and test bounded-context hypotheses

For each proposed context, document:

- model and ubiquitous language;
- business responsibility and outcomes;
- invariants and consistency boundary;
- authoritative data and lifecycle;
- upstream/downstream relationships;
- team ownership and decision rights;
- nonfunctional requirements;
- change cadence and likely consumers.

Validate boundaries against these questions [R5]:

```text
Does the boundary preserve cohesion?
Does it avoid chatty fine-grained coordination?
Do changes usually stay on one side?
Can each side evolve its language independently?
Are data ownership and invariants explicit?
Can the boundary be implemented as a module before a service?
```

Prefer a coarse-grained modular boundary when evidence is weak. A bounded context need not be a deployed service, and a deployment unit can contain more than one context [R5]. A wrong boundary does not remove complexity; it relocates it into adapters, coordination, and distributed consistency.

### 4. Find seams and enabling points

Search for places where behavior can be changed without editing every caller: interfaces, composition roots, dependency injection, adapters, gateways, queues, event handlers, repositories, feature flags, batch boundaries, file formats, and stable public commands [R3][R8]. For each seam record:

```text
seam -> enabling point -> observable behavior -> redirectable slice -> rollback action
```

Rate each seam by observability, divertability, side-effect isolation, data ownership, blast radius, and reversibility. A seam that only supports tests is still valuable; it may later support probes or substitution. A technically clean seam with no meaningful business slice is not a good first migration target.

In this repository, candidate seams include artifact handoffs, activation boundaries, `NEVER_INVOKE` restrictions, format/version checks, state-machine transitions, and the central contract registry [R4][R7]. The likely architectural risk surfaces are shared artifact schemas, duplicated policy text, generated README content, payload synchronization, and overlapping test/spec responsibilities. These are hypotheses requiring implementation and history inspection, not established DDD findings.

### 5. Baseline behavior before changing structure

Capture externally visible behavior with characterization, contract, invariant, and differential tests. Include normal, boundary, failure, retry, ordering, and idempotency cases. Normalize nondeterministic identifiers and timestamps rather than asserting accidental details.

For a replacement path, distinguish:

- protocol parity: inputs, outputs, and error semantics;
- behavioral parity: rules and edge cases;
- operational parity: latency, throughput, failure modes, and resource use;
- data parity: counts, relationships, ordering, and domain invariants;
- outcome parity: user and business results.

The supplied outbox example is appropriate when a local transaction must persist a domain change and publish a message. The relay must tolerate at-least-once delivery and consumers must be idempotent [R12]. It does not, by itself, solve source-of-truth decisions, backfills, reconciliation, or rollback after schema contraction.

### 6. Choose the smallest viable refactoring slice

Use the seam and context map together. For an internal supplier with many callers, branch by abstraction. For an externally reachable capability or routable business partition, use a façade or strangler route. For incompatible contracts or schemas, use expand/migrate/contract. Use dark execution only when duplicate side effects are suppressed or isolated [R8][R9].

The migration loop is better represented as conditional than linear:

```text
expand contract -> compare evidence
        | pass                    | fail
        v                         v
  route a cohort            return to model/seam/data work
        |
   observe + reconcile -> expand, rollback, or contract
```

For stateful changes, define the source of truth, replayability, conflict policy, backfill validation, lag/error handling, and recovery point before increasing traffic. Replication is not the same as recoverability; corruption can replicate, so independent validation and restore procedures matter [R11].

### 7. Roll out, govern, and delete

A canary needs a representative cohort, attributable control/candidate metrics, an evaluation window, stop criteria, and a known rollback action [R9]. Track legacy and replacement paths separately for traffic, errors, latency, saturation, fallbacks, business outcomes, and data divergence. Do not use arbitrary percentages as a universal rule; thresholds depend on risk and traffic.

Assign one accountable team or owner for the end-to-end slice: code, routing, data reconciliation, alerts, incident response, and deletion. Team and communication structures influence architecture, but reorganizing people alone does not repair a rigid codebase [R10][R13]. Limit concurrent migrations and temporary collaborations to control cognitive load.

The elimination gate should require:

- zero legacy traffic for an agreed representative period;
- no remaining callers, jobs, reports, exports, or operational dependencies;
- reconciled data and tested recovery;
- replacement parity and SLO evidence;
- migrated dashboards, alerts, runbooks, and ownership;
- security, retention, and compliance approval;
- explicit owner approval to remove routes, compatibility code, old writes, and old data.

## Recommendation

Adopt a **seam-first DDD analysis** with these phases:

1. **Outcome and baseline:** pin the repo, inventory static surfaces, define the business outcome, and capture current behavior.
2. **Domain discovery:** map capabilities, language, workflows, invariants, data ownership, stakeholders, and subdomain classification.
3. **Context hypotheses:** propose bounded contexts and a context map; record confidence, alternatives, and evidence gaps.
4. **Seam validation:** identify enabling points, consumers, side effects, contracts, rollback options, and change coupling; validate with implementation history and domain experts.
5. **Slice design:** select one valuable, bounded capability and choose abstraction, routing, parallel change, outbox, or data migration only where required.
6. **Controlled displacement:** add characterization/parity evidence, route or substitute incrementally, monitor attributable signals, reconcile state, and keep rollback available.
7. **Contract and elimination:** remove compatibility paths only after the deletion gate passes; update the context map, glossary, ownership, and operational records.

For this repository, begin with a focused comparison of `csm-scan` versus `csm-review`, and `csm-bdd-tdd` versus `csm-make-tests`, because their documented responsibilities are adjacent. Do not merge them based on names. Trace their actual imports, contracts, artifacts, validators, generated payloads, tests, and history first. Preserve format markers, artifact compatibility, human-mediated handoffs, and safety/write boundaries during any refactor.

Confidence is high for the analysis principles and migration guardrails, medium for any repository-specific context hypothesis until implementation and domain-owner evidence are added. The main cost of being wrong is turning an internal dependency into a permanent integration dependency or losing the ability to roll back.

## Unverified Claims

- **Unverified:** Each root skill is a bounded context. Verify by comparing its model, invariants, owners, change history, consumers, and independent evolution; directory and frontmatter boundaries alone are insufficient.
- **Unverified:** `csm-scan`/`csm-review` and `csm-bdd-tdd`/`csm-make-tests` contain mergeable overlap. Verify through module graphs, artifact schemas, tests, and change coupling.
- **Unverified:** The repository's duplicated payloads are generated and synchronized safely. Verify the generation path, digest checks, and CI gates.
- **Unverified:** Any particular canary percentage, soak duration, parity threshold, or rollback window. Derive these from traffic, SLOs, business criticality, and historical incidents.
- **Unverified:** Dual execution is safe for a chosen slice. Verify every write, notification, queue, cache, retry, and external side effect for isolation or idempotency.
- **Unverified:** Domain experts will agree with repository-derived terminology. Verify through event-storming, scenario walkthroughs, and ownership review.

## References

- **[R1]** Microsoft Learn, “Use Domain Analysis to Model Microservices.” https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis. Retrieved 2026-08-22.
- **[R2]** Martin Fowler, “Bounded Context.” https://martinfowler.com/bliki/BoundedContext.html. Retrieved 2026-08-22.
- **[R3]** Martin Fowler, “Legacy Seam.” https://martinfowler.com/bliki/LegacySeam.html. Retrieved 2026-08-22.
- **[R4]** Current repository, `README.md`, composition matrix and workflow documentation. https://github.com/jamiemills/opencode-skills/blob/main/README.md. Retrieved from the pinned local checkout 2026-08-22.
- **[R5]** Microsoft Learn, “Identify microservice boundaries.” https://learn.microsoft.com/en-us/azure/architecture/microservices/model/microservice-boundaries. Retrieved 2026-08-22.
- **[R6]** EventStorming, “EventStorming.” https://www.eventstorming.com/. Retrieved 2026-08-22.
- **[R7]** Current repository, `csm-scan/SKILL.md` and `csm-deep-research/SKILL.md`, evidence/status, artifact, and state-machine contracts. https://github.com/jamiemills/opencode-skills/tree/main/csm-scan. Retrieved from the pinned local checkout 2026-08-22.
- **[R8]** Martin Fowler, Ian Cartwright, Rob Horn, and James Lewis, “Patterns of Legacy Displacement.” https://martinfowler.com/articles/patterns-legacy-displacement/. Retrieved 2026-08-22.
- **[R9]** Google SRE Workbook, “Canarying Releases.” https://sre.google/workbook/canarying-releases/. Retrieved 2026-08-22.
- **[R10]** Martin Fowler, “Conway’s Law.” https://martinfowler.com/bliki/ConwaysLaw.html. Retrieved 2026-08-22.
- **[R11]** Google SRE Book, “Data Integrity: What You Read Is What You Wrote.” https://sre.google/sre-book/data-integrity/. Retrieved 2026-08-22.
- **[R12]** Chris Richardson, “Transactional outbox.” https://microservices.io/patterns/data/transactional-outbox.html. Retrieved 2026-08-22.
- **[R13]** Team Topologies, “Key Concepts.” https://teamtopologies.com/key-concepts. Retrieved 2026-08-22.

## Process Appendix

### Triage

- **Tier:** DEEP, because the question is open-ended, architecture-defining, and combines repository evidence with external migration guidance.
- **Source mode:** hybrid.
- **Tracks:** DDD boundaries and language; seams and incremental displacement; current-repository capability mapping; rollout/data/organizational guardrails.
- **Method:** read-only repository inspection, parallel web retrieval, four independent research tracks, adversarial challenge, independent judge, primary remediation, and final citation/structure verification.

### Research and adjudication

- The DDD track supported language/model cohesion, subdomain classification, context mapping, and human validation.
- The seams track supported enabling points, characterization/comparison evidence, branch by abstraction, routing, data controls, and deletion gates.
- The repository track observed explicit workflow, artifact, activation, state-machine, safety, and handoff contracts. It marked skill-level contexts and overlapping skill pairs as hypotheses.
- The rollout track supported attributable canarying, independent data validation, accountable ownership, cognitive-load control, and explicit decommissioning.
- The independent challenger downgraded “seams are divertable/observable points” to the fuller seam definition, downgraded the named migration sequence to a context-dependent pattern, and retracted repository-specific context claims that lacked implementation-level proof.
- The independent judge found the initial draft incomplete for the requested repository-specific DDD question. Remediation added the domain evidence model, repository mapping, explicit phases, data/operations/organization controls, and hypothesis caveats.
- **Judge scores after remediation:** factual accuracy 0.90; citation accuracy 0.88; completeness 0.91; clarity 0.90. All dimensions pass the 0.70 threshold.

### Research State Machine

[2026-08-22T00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: architecture-defining hybrid research request
[2026-08-22T00:05Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: DEEP tier and four non-overlapping tracks selected
[2026-08-22T00:40Z] RESEARCH complete :: cycle 0
[2026-08-22T00:45Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: repository and web evidence assembled
[2026-08-22T01:15Z] SYNTHESIZE complete :: cycle 0
[2026-08-22T01:20Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft claim-to-source map ready
[2026-08-22T01:40Z] CHALLENGE complete :: cycle 0
[2026-08-22T01:45Z] CHALLENGE -> REMEDIATE :: cycle 0 :: trigger: repository-specific claims and universal sequence overclaimed
[2026-08-22T02:00Z] REMEDIATE complete :: cycle 0
[2026-08-22T02:05Z] REMEDIATE -> JUDGE :: cycle 0 :: trigger: draft expanded and claims narrowed
[2026-08-22T02:20Z] JUDGE complete :: cycle 0
[2026-08-22T02:25Z] JUDGE -> VERIFY :: cycle 0 :: trigger: all judge dimensions pass after remediation
[2026-08-22T02:35Z] VERIFY complete :: cycle 0 :: trigger: citations, structure, redaction, and protected-state checks passed
[2026-08-22T02:40Z] VERIFY -> SAVED :: cycle 0 :: trigger: verified finding ready for persistence
[2026-08-22T02:45Z] SAVED complete :: cycle 0
