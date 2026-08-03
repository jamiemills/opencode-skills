# csm-scan Comprehensive Evidence Expansion CSM Plan

## How To Execute
- Start work only through a separate, explicit `csm-build` invocation naming this plan; this planning session does not begin execution.
- Commit policy and live state are maintained in Control by `csm-build`.
- Risk summary: 26 high-risk and 3 standard-risk tasks. T200-T206, T208-T224, T227, and T228 require independent review because they affect security boundaries, public contracts, factual claims, or central pipeline behavior.

## Control
- Plan ID: `csm-scan-comprehensive-evidence-expansion`
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 16
- Commits: disabled (the skill directory is not a Git repository)
- Last checkpoint: 2026-08-02 cycle 16 G16 — all 29 tasks accepted; full suite 1007/1007; final correctness and safety/voice reviewers PASS
- Next transition: none (COMPLETE)
- Active tasks: none
- Blockers: none

## Goal
Expand `csm-scan` from a comprehensive five-ecosystem static norms scanner into a broader, provenance-rich repository dossier while preserving its neutral factual stance and safety guarantees.

Deliverables:
- Static-only runtime, build, test, and deployment declarations without executing target commands.
- API Surface, Data Architecture, Deployment Topology, Maintainability, Governance & Ownership, and Assurance & Supply Chain dimensions.
- Static dynamic-architecture indicators and explicit cross-repository relationships.
- A generic, declarative, skill-local plugin framework plus artifact-only fallback for unregistered languages; Python, JavaScript, TypeScript, Shell, and Rust remain the five first-class built-ins.
- Claim-to-evidence provenance, applicability/status semantics, deterministic rendering, privacy filtering, and versioned standards metadata.
- One neutral `NORMS.md`, exactly one production write, zero npm dependencies, no installs/builds, and no scanned-repository mutation.

Exclusions:
- No target application, runtime, build, test, package-manager, scanner, database, container, deployment, cloud, or infrastructure execution.
- No live service, advisory, registry, vulnerability, license, or compliance lookup during scans.
- No generated SBOM, generated API contract, migration execution, field-level runtime lineage, or live topology discovery.
- No compliance, certification, vulnerability, security, accessibility, maintainability, ownership-effectiveness, or architecture-quality verdict.
- No executable, scanned-repository, remote, environment-selected, or CLI-selected plugins.

## Acceptance Criteria
1. Production subprocesses are restricted to a central broker with exact allowlisted argv-array forms for `rg` and read-only Git; target runtime/build/test/deploy/scanner commands and shell execution are absent.
2. Runtime/version/build/test/deploy findings come only from committed manifests, version files, workflows, containers, and other static declarations, with source evidence and no “actual runtime” claim.
3. API Surface reports declaration-backed contracts, routes, RPC methods, events, CLI commands, and public exports; dynamic or unsupported constructs are reported without invented endpoints.
4. Data Architecture reports stores, schemas, migrations, entities, explicit foreign keys/relations, and declaration-backed ER/data-flow edges; no name-based or live-data inference is permitted.
5. Deployment Topology reports bounded static Docker/Compose/Kubernetes/Helm/Terraform/CloudFormation/serverless declarations; unsupported templates/macros/anchors/tags remain partial or unverified and are never evaluated.
6. Architecture reports static dynamic/reflection/plugin/codegen/macro indicators, raw fan-in/fan-out, and Tarjan SCC facts without runtime or quality claims.
7. Maintainability reports a disclosed measurement universe, generated/vendor boundaries, lexical branch-point approximations, exact token-duplicate spans, and bounded metrics without scores or recommendations.
8. Governance & Ownership reports CODEOWNERS/policy/ADR/runbook/support/release/review/update declarations with privacy filtering and no effectiveness or inferred-ownership claim.
9. Assurance & Supply Chain inventories manifests, locks, pins, sources, licenses, SBOM/VEX/SARIF/tool results/configuration, accessibility artifacts, and standards references without executing tools or synthesizing verdicts.
10. Standards metadata is versioned and source-linked; restricted or uncertain reuse defaults to metadata-only, no copied control text, and no undecided disposition reaches assurance implementation.
11. Cross-repository edges require exact, unambiguous artifact evidence; duplicate identities and ambiguity produce unresolved records rather than edges.
12. A declarative `plugin.json` under the trusted skill-local plugin root can contribute bounded evidence to all 14 provider dimensions; no plugin code is evaluated.
13. Removing the synthetic plugin causes the same unknown-language fixture to receive generic artifact-only findings without any core source knowledge of the fixture language.
14. The original five ecosystems preserve their established findings, 21-case P0 matrix, and full-pipeline behavior except for explicitly superseded runtime, privacy, status, and deterministic-rendering corrections.
15. Every claim has a stable claim ID, status, coverage state, limitations, and admissible evidence IDs according to the evidence contract.
16. `not_detected` is emitted only after a complete, supported, uncapped, readable search; incomplete searches are `unverified`, unsupported formats are `unsupported`, and N/A claims are excluded from coverage.
17. All output surfaces, including CLI diagnostics and errors, contain no sensitive values, absolute paths, personal identities, raw commit subjects, unsafe result excerpts, or credential-bearing URLs.
18. Identical immutable inputs, fixed clock, plugin set, and repository order produce byte-identical Markdown with deterministic dimensions, providers, evidence, edges, and line endings.
19. Unknown/missing dimension renderers and invalid evidence/plugin/standards/privacy states fail before the sole output write.
20. The authoritative sequential suite, focused dimension tests, fixture pipelines, plugin boundary tests, multi-repo tests, golden tests, voice tests, privacy tests, command-policy tests, one-write gate, and zero-dependency gate all pass with zero failures.

## Current-State Evidence
- The pipeline hardcodes ten scanner imports, initial dispatch, and retry dispatch in `scripts/scan.mjs:6-13`, `scripts/scan.mjs:51-73`, and `scripts/scan.mjs:92-108`.
- Enrichment hardcodes ten dimensions in `lib/scan/enrich.mjs:1-4`; rendering hardcodes the same dimensions in `lib/scan/write.mjs:821-858`.
- Current multi-repo behavior scans and renders repositories independently without aggregate relationships: `scripts/scan.mjs:84-175` and `lib/scan/write.mjs:893-932`.
- The renderer performs exactly one production write at `lib/scan/write.mjs:934-936`.
- First-class descriptors are closed to five ecosystems in `lib/scan/shared/ecosystem.mjs:396-402`, with separate hardcoded language signals in `lib/scan/survey.mjs:12-22`.
- Runtime probes currently execute host binaries in `lib/scan/deep/stack.mjs:110-168`; several scanners also contain direct child-process or shell-based searches.
- Architecture provides static import graphs and heuristic C4 output but not API, data-model, deployment, or cross-repo graphs: `lib/scan/deep/architecture.mjs:1194-1260`.
- Operations covers Docker, Compose, CI, environment, health, monitoring, and deploy-script presence, but not general IaC topology: `lib/scan/deep/operations.mjs:101-292` and `:428-490`.
- Security covers static patterns, auth/validation/rate-limit evidence, lock presence, tools, and audit provenance, but not full supply-chain, SBOM/VEX, accessibility, or standards evidence: `lib/scan/deep/security.mjs:355-422`.
- Documentation detects a root license and selected governance artifacts, but not dependency-license inventory or structured governance: `lib/scan/deep/documentation.mjs:296-380`.
- Current coverage is based on reported top-level finding keys, not registry-owned expected claims: `lib/scan/enrich.mjs:15-29`, `:197-200`.
- Neutral factual prose is enforced by `test/voice-gate.test.mjs:27-105` and full fixture coverage at `:191-226`.
- The completed parity plan records the authoritative baseline as 309 sequential tests with both independent reviewers passing: `.agents/plans/2026-08-02-csm-scan-language-parity-csm.md:565-573`.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Runtime expansion is static-evidence-only. | user decision | User selected “Static evidence only.” | accepted |
| A2 | Read-only `rg` and allowlisted Git remain infrastructure; target commands never execute. | design decision | Preserves enumeration/history while enforcing the user’s static boundary. | accepted |
| A3 | Language expansion uses a generic plugin framework, not new first-class Go/Java/Ruby/C++ support. | user decision | User selected “Generic plugin framework.” | accepted |
| A4 | Plugins are strict declarative JSON, never executable ESM. | safety decision | Executable modules could bypass command, read, write, environment, and one-write constraints before validation. | accepted |
| A5 | Plugin discovery is only `<real skill root>/plugins/<id>/plugin.json`; scanned repos, CLI, env, remote, and package manifests cannot select plugins. | safety decision | Establishes a deterministic trusted-data boundary. | accepted |
| A6 | Structure and Git remain core dimensions; plugins contribute to the other 14 dimensions after expansion. | design decision | They are repository-wide rather than ecosystem parsers. | accepted |
| A7 | Total per-repository dimensions become 16; Cross-repository Architecture is a global section after per-repo validation. | design decision | Separates applicability/coverage while retaining pipeline phases. | accepted |
| A8 | Claim-to-source references are required; runtime derivation DAGs and field-level data lineage remain excluded. | clarification | Resolves the provenance/lineage ambiguity found in critique. | accepted |
| A9 | Standards/control text is never copied; uncertain or restricted reuse is metadata-only. | legal/safety decision | Allows evidence navigation without redistribution or compliance claims. | accepted |
| A10 | Existing contributor identities become aggregate counts; CODEOWNERS identities are opaque report-local labels; emails never render. | privacy decision | Governance expansion must not expose personal data. | accepted |
| A11 | API/data/deployment/cross-repo edges require explicit declaration evidence; matching names or co-occurrence never creates edges. | correctness decision | Prevents factual architecture overclaims. | accepted |
| A12 | Coverage measures scan completeness, never repository quality, compliance, or maturity. | retained contract | Existing neutral stance in `SKILL.md:63-65`. | accepted |
| A13 | No compatibility layer is needed for pre-existing plugins because no plugin API currently exists. | compatibility decision | Avoids speculative backward compatibility. | accepted |
| A14 | Existing result fields remain available through cutover; removals require an explicit supersession entry and replacement test. | compatibility decision | Protects current in-tree consumers and tests. | accepted |
| A15 | The default authoritative test command remains `node --test --test-concurrency=1`. | operational decision | Current fixture tests are filesystem-heavy and documented as sequential. | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Where are extension points closed? | Read/Glob/Grep across pipeline, descriptors, scanners, and tests | Read-only; no repository writes | Dispatch, dimensions, renderer, language aliases, and tests are independently hardcoded. | Add canonical registries before capability work. |
| R2 | Can generic plugins be executable safely? | Source inspection plus hostile critique | Read-only; no experiment | ESM evaluation could access ambient Node capabilities before validation. | Use declarative `plugin.json` only. |
| R3 | Which gaps are truly missing? | Six parallel read-only research tracks | No builds/tests/Git mutation/services | API, data, deployment, maintainability, governance, assurance, and cross-repo aggregation are absent or partial. | Add six dimensions plus global synthesis. |
| R4 | How should runtime verification fit current constraints? | User question | No side effects | User rejected active runtime verification. | Remove host probes and report declarations only. |
| R5 | How should arbitrary languages be handled? | User question | No side effects | User chose generic plugins, not named first-class ecosystems. | Preserve five built-ins and add generic fallback/plugin proof. |
| R6 | Which standards may be represented? | Partial official read-only retrieval plus source review | Three automatic OpenCode tool-output logs were written outside `/tmp`; no repository file changed. User explicitly permitted treating these as platform artifacts and resuming with no further web fetches. | Exact editions/reuse disposition require a prerequisite implementation gate; no control text should ship. | T200 is mandatory before Assurance. |
| R7 | Is the first draft build-ready? | Independent hostile critique | Read-only Read/Glob/Grep | Found blockers in command policy, evidence semantics, standards reuse, privacy, plugin coverage, and integration ownership. | Remediated contracts and task graph. |
| R8 | Is the remediated draft safe? | Second independent hostile critique | Read-only; no writes/commands | Found executable-plugin and partial-cutover defects. | Data-only plugins and one atomic T224 activation. |

## Discovered Requirements
- Production scanning may use only an argv-array command broker; shell strings, `shell:true`, pipes, redirects, `find`, runtime probes, and arbitrary executables are prohibited.
- Allowed commands are fixed, testable forms of `rg --files`/`rg --json` and read-only Git metadata/history queries. `rg` exit 1 means no match only after a completed bounded search.
- Command timeout, truncation, invalid output, unreadable artifacts, unsupported constructs, and parser failures yield `unverified`/`unsupported`, never absence.
- All scanner data, plugin data, standards metadata, renderer labels, and CLI errors pass schema, privacy, and voice validation before output.
- Plugins cannot provide functions, imports, arbitrary regex flags, Markdown templates, filesystem paths, or commands. Regex sources and rule counts are bounded.
- New extractors must disclose files/bytes/records inspected, caps reached, unsupported constructs, and omitted counts.
- Current giant files (`architecture.mjs`, `conventions.mjs`, `write.mjs`) require single owners and renderer/extractor decomposition before parallel additions.
- Integration tests must call the same exported production pipeline as the CLI; test-only replicas of scanner dispatch are prohibited.
- Unknown registered dimensions or renderers fail closed rather than silently disappearing.
- Central registrations remain inert until T224 atomically activates pipeline, rendering, validation, retry, cross-repo synthesis, and sanitized diagnostics.
- The implementation directory is not a Git repository; recovery uses focused tests and forward repairs, never destructive Git restoration.

## Design

### Target Pipeline
`survey -> registry-driven deep scans -> per-repo enrich/validate -> global cross-repo synthesis -> deterministic render -> one write`

The dimension registry owns IDs, order, expected claims, retryability, provider capabilities, and renderer IDs. The production pipeline is exported once and used by both CLI and tests.

### Command Boundary
`lib/scan/shared/command.mjs` is the only production child-process owner. It accepts command IDs, not arbitrary executables/arguments. The initial policy permits registered `rg` file/match queries and fixed read-only Git queries. It applies timeouts, output caps, reduced environment, `GIT_OPTIONAL_LOCKS=0`, disabled prompts/pagers, deterministic locale, and typed results.

### Claim And Evidence Model
Claims use stable IDs such as `CLM-api-endpoints-v1`. Evidence IDs are deterministic hashes of claim ID, detector ID, source kind, normalized repository-relative path, stable locator, and matched key. Evidence never contains absolute paths, secret values, identities, timestamps, or scan order.

Statuses:
- `observed`: direct admissible static evidence.
- `inferred`: deterministic authored derivation with input evidence IDs.
- `not_detected`: complete supported uncapped search found no evidence.
- `unsupported`: applicable format/ecosystem has no approved detector.
- `unverified`: applicable inspection was incomplete, ambiguous, capped, unreadable, malformed, or failed.
- `not_applicable`: registry predicate proven by positive evidence.

Coverage counts complete eligible claims divided by all eligible claims. `not_applicable` and `unsupported` are separately counted; `unverified` remains uncovered. Factual absence renders with the inspected universe, for example “Not detected in 14 inspected workflow files.”

### Privacy
Privacy filtering occurs before findings persistence, enrichment, console diagnostics, or Markdown. Output excludes emails, personal names, raw CODEOWNERS identities, raw commit subjects, absolute paths, URL credentials/query/fragment, secrets, SARIF messages/snippets/code flows, SBOM contacts/serials/download/VCS URLs/hashes, and arbitrary result excerpts. Git contributors become aggregate counts; ownership identities become report-local opaque tokens only when concentration facts require them.

### Declarative Plugins
Plugin layout: `<skillRoot>/plugins/<plugin-id>/plugin.json`.

The loader performs lexical and realpath containment, direct-child layout checks, symlink rejection, ID/API-version/schema validation, deterministic sorting, duplicate detection, and atomic publication. Plugin JSON may contain bounded declarative artifact rules and renderer-safe labels for the 14 provider dimensions. It cannot contain executable hooks, imports, commands, Markdown templates, or arbitrary paths.

Generic fallback uses only normalized path, extension, size, directory, manifest, lockfile, and known artifact metadata. It never claims source syntax, import edges, effective runtime behavior, or first-class depth.

### New Dimensions
- **API Surface**: declared OpenAPI/AsyncAPI/GraphQL/protobuf/WSDL contracts, framework routes, RPC/event declarations, CLI trees, clients/servers, package exports. Dynamic identities remain partial/unverified.
- **Data Architecture**: declared stores, schemas, migrations, models/entities, fields, keys, explicit relations, caches/queues, and declaration-backed ER/data-flow edges. No live DB or name-based lineage.
- **Deployment Topology**: conservative Docker/Compose/Kubernetes/Helm/Terraform/CloudFormation/serverless declarations. No template execution, remote modules, cluster defaults, macros, or desired/live comparison.
- **Maintainability**: disclosed measurement universe, generated/vendor boundaries, lexical branch-point approximation, exact 50-token duplicate spans, size distributions, and detector/tool evidence. No grading.
- **Governance & Ownership**: CODEOWNERS/policy/contribution/review/release/ADR/runbook/support/funding artifacts and explicit links. No inferred ownership/effectiveness/freshness.
- **Assurance & Supply Chain**: dependency/lock/pin/source/license evidence, SBOM/VEX/SARIF/tool configuration/results, accessibility artifacts, attestations, and versioned standards references. No scans, advisory lookup, compatibility, conformance, or compliance verdict.

### Architecture And Cross-Repository Facts
Architecture adds explicit-edge fan-in/fan-out, Tarjan SCCs, self-loops, dynamic import/reflection/plugin/codegen/macro indicators, and disclosed graph bounds. Raw values replace labels such as “hub” or “high coupling.”

Cross-repository identities use explicit scan IDs, sanitized exact VCS/manifest coordinates, ecosystem-normalized package coordinates, and component roots. Path/VCS/workspace/IaC/contract/event references can form edges only when exactly one candidate matches. Zero candidates remain external; multiple candidates remain ambiguous and are excluded from graph metrics.

### Standards Evidence
The standards registry records publisher, exact edition, publication date, authoritative URI, and disposition `metadata_only` or `authored_mapping`. Unknown/restricted/unproven reuse deterministically becomes `metadata_only`. No control prose is stored. Assurance may relate locally authored artifact categories to approved identifiers but cannot claim that controls are satisfied.

### Deterministic Output
Tests inject the clock. Repository, dimension, provider, claim, evidence, edge, and renderer order use explicit comparators. Paths are POSIX-relative, Markdown uses `\n`, and content has exactly one terminal newline. Unknown renderer IDs, schema violations, privacy violations, or plugin errors abort before the sole write.

### Requirement-To-Task Matrix
| Identified gap | Tasks |
|---|---|
| Runtime truth without active execution | T201, T208, T209, T227 |
| Dynamic/reflection/generated architecture | T217, T224, T227 |
| Data architecture | T212, T220, T223-T227 |
| API surface | T211, T220, T223-T227 |
| Deployment topology | T213, T220, T223-T227 |
| Security/supply-chain and dependency risk | T200, T206, T216, T220, T227 |
| Maintainability depth | T214, T217, T223-T227 |
| Governance/ownership/release/process | T206, T215, T223-T227 |
| Cross-repository architecture | T221, T223-T227 |
| Other ecosystems/generic extension | T202, T203, T210, T218-T220, T225-T227 |
| Formal compliance/accessibility/license evidence | T200, T206, T216, T223, T227 |

## Execution Graph
```text
G0:  T200 || T201
G1:  T202
G2:  T203 || T205 || T206
G3:  T204 || T207 || T208       (after each task's own dependencies)
G4:  T209
G5:  T210
G6:  T211 || T212 || T213 || T214 || T215 || T216 || T217
G7:  T218 || T219
G8:  T220
G9:  T221
G10: T222
G11: T223
G12: T224
G13: T225
G14: T226
G15: T227
G16: T228
```

Critical path:
`T201 -> T202 -> T203/T206 -> T208 -> T209 -> T210 -> T211-T220 -> T222 -> T223 -> T224 -> T225 -> T226 -> T227 -> T228`

T222 and T223 prepare inert registration artifacts. T224 is the only activation cutover. No task in a parallel group edits shared indexes, `scripts/scan.mjs`, `write.mjs`, `enrich.mjs`, or `validate.mjs` concurrently.

## Numbered Plan

### 1. [completed] Standards metadata and reuse policy gate
- Task ID: T200
- Depends on: none
- Parallel group: G0
- Risk: high
- Owned scope: new `lib/scan/standards/policy.mjs`, `lib/scan/standards/registry.mjs`, `test/expansion-standards-policy.test.mjs`
- Not in scope: assurance scanner, control mappings, copied control text, renderer changes
- Spike candidate: Verify exact current editions and official-source reuse terms for OWASP ASVS/Top 10, SOC 2, PCI DSS, ISO/IEC 27001, WCAG, SPDX, CycloneDX, SARIF, and VEX. Unknown/restricted reuse must become `metadata_only`; never leave an undecided state.
- Actions: Define registry schema, exact version metadata, authoritative links, deterministic disposition, copied-text prohibition, and no-verdict vocabulary. Require independent review before T216.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-standards-policy.test.mjs` exits 0; every entry has an exact edition and non-undecided disposition; no control-text field exists.
- Validation: Static scan of standards modules finds no copied normative prose or verdict terms.
- Acceptance evidence: Registry snapshot, official URI list, disposition rationale, independent review result.
- Repair attempts: 2
- Recovery note: If reuse cannot be demonstrated, retain metadata-only; do not block unrelated dimensions or copy source text.

### 2. [completed] Baseline and recurring constraint harness
- Task ID: T201
- Depends on: none
- Parallel group: G0
- Risk: high
- Owned scope: new `test/expansion-baseline.test.mjs`, `test/expansion-constraints.test.mjs`, `test/helpers/recording-runner.mjs`, deterministic baseline fixtures
- Not in scope: production code changes
- Spike candidate: Determine the smallest fixed-input semantic and Markdown baseline that excludes volatile real paths/dates while preserving all ten current dimensions.
- Actions: Freeze current test names, five fixtures, result keys, semantic output, CLI contract, one-write/zero-dependency/read-only constraints, and an explicit supersession table for runtime probes, identities, free-form absence, and deterministic wording.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs` exits 0 against the unmodified pipeline.
- Validation: Existing tests cannot be deleted/skipped/weakened without a named replacement in the supersession table.
- Acceptance evidence: Baseline hash/snapshot, existing test count, constraint counts.
- Repair attempts: 2
- Recovery note: Do not begin production changes until this gate is deterministic; regenerate only from the unmodified production pipeline.

### 3. [completed] Dimension, claim, evidence, and provider contracts
- Task ID: T202
- Depends on: T201
- Parallel group: G1
- Risk: high
- Owned scope: new `lib/scan/contracts/dimension.mjs`, `evidence.mjs`, `provider.mjs`, `test/expansion-contracts.test.mjs`
- Not in scope: loading plugins, scanning repositories, rendering, built-in providers
- Spike candidate: none
- Actions: Implement stable IDs, six statuses, coverage states, expected-claim paths, applicability predicates, evidence records, deterministic comparators, category allowlists for 14 provider dimensions, typed errors, caps, and deep-frozen normalized values.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-contracts.test.mjs` exits 0 with positive/negative status, bounded-absence, duplicate, path, mutation, and category cases.
- Validation: `not_detected` cannot survive a cap/error/unsupported fixture; N/A requires evidence.
- Acceptance evidence: Exported schema snapshot and failing-case matrix.
- Repair attempts: 2
- Recovery note: Dependent work must conform to this contract; never weaken it to accept an implementation shortcut.

### 4. [completed] Declarative trusted plugin loader
- Task ID: T203
- Depends on: T202
- Parallel group: G2
- Risk: high
- Owned scope: new `lib/scan/plugins/schema.mjs`, `loader.mjs`, `test/expansion-plugin-loader.test.mjs`
- Not in scope: executable modules/hooks, scanned-repo/remote/env/CLI loading, provider registration
- Spike candidate: none
- Actions: Load JSON only from direct `<skillRoot>/plugins/<id>/plugin.json`; enforce lexical/realpath containment, lstat symlink rejection, API version 1, strict unknown-key rejection, bounded regex/rules, duplicate IDs/aliases/providers, deterministic order, and atomic publication.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-plugin-loader.test.mjs` exits 0 for valid JSON and all path/symlink/version/schema/duplicate/error cases.
- Validation: Production source contains no dynamic plugin import or executable plugin evaluation.
- Acceptance evidence: Loader diagnostic matrix and deterministic registry snapshot.
- Repair attempts: 0
- Recovery note: Loader failure aborts before scanning; never skip a malformed registered plugin or fall back silently.

### 5. [in_progress] Canonical existing-ten production pipeline facade
- Task ID: T204
- Depends on: T202, T203
- Parallel group: G3
- Risk: high
- Owned scope: new `lib/scan/pipeline/run.mjs`, `existing-ten.mjs`, `test/expansion-production-pipeline.test.mjs`
- Not in scope: CLI cutover, new dimensions, renderer/enrich/validate changes
- Spike candidate: none
- Actions: Export one injectable pipeline used later by CLI and tests; centralize existing-ten dispatch/retry orchestration with clock, command runner, plugin registry, and sink seams while leaving production CLI on its current facade.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-production-pipeline.test.mjs` exits 0 and matches the T201 semantic baseline.
- Validation: No integration test reconstructs scanner dispatch independently.
- Acceptance evidence: Existing-ten order/once-only trace and semantic comparison.
- Repair attempts: 0
- Recovery note: The old CLI remains authoritative until T224; remove the unused facade if parity cannot be established.

### 6. [completed] Existing renderer decomposition
- Task ID: T205
- Depends on: T201, T202
- Parallel group: G2
- Risk: high
- Owned scope: `lib/scan/write.mjs`, new `lib/scan/render/base.mjs`, existing-ten renderer modules, `test/expansion-render-existing-ten.test.mjs`
- Not in scope: new dimensions, renderer registry activation, wording changes beyond deterministic normalization
- Spike candidate: none
- Actions: Split current sections into modules behind unchanged `writeNORMS`; centralize escaping, privacy hooks, line endings, terminal newline, and fixed-input ordering.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-render-existing-ten.test.mjs test/write.test.mjs` exits 0 with semantic parity and fixed-input byte parity.
- Validation: Exactly one production `writeFile` remains; unknown dimensions cannot silently disappear in the new internal API.
- Acceptance evidence: Before/after deterministic snapshot and write-call count.
- Repair attempts: 0
- Recovery note: Restore the original facade by forward edit if extraction breaks parity; do not adjust baseline expectations to fit regressions.

### 7. [completed] Artifact, bounded-reader, and privacy primitives
- Task ID: T206
- Depends on: T202
- Parallel group: G2
- Risk: high
- Owned scope: new `lib/scan/shared/artifacts.mjs`, `privacy.mjs`, `test/expansion-artifact-privacy.test.mjs`
- Not in scope: format-specific scanners, renderer activation, secret values/excerpts
- Spike candidate: none
- Actions: Implement normalized repository-relative references, bounded reads, search-space records, sensitivity labels, redaction, URL/path sanitization, privacy canaries, safe SARIF/SBOM metadata projection, and output-safe evidence serialization.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-artifact-privacy.test.mjs` exits 0; all synthetic identities, emails, tokens, absolute paths, URL credentials, SARIF snippets, and SBOM contacts are absent from structured/output-safe records.
- Validation: Privacy runs before enrichment/rendering and rejects rather than repairs unsafe evidence late.
- Acceptance evidence: Canary matrix with zero leaks.
- Repair attempts: 0
- Recovery note: Omit or aggregate unsafe fields; never add sensitive-value allowlists.

### 8. [in_progress] Static workflow and declaration extraction
- Task ID: T207
- Depends on: T202, T206
- Parallel group: G3
- Risk: standard
- Owned scope: new `lib/scan/shared/declarations.mjs`, `test/expansion-declarations.test.mjs`
- Not in scope: command execution, provider registration, deployment semantics
- Spike candidate: none
- Actions: Extract bounded declared commands, jobs, environments, services, targets, version files, workflow images, and source locations from supported static artifacts with unsupported-construct diagnostics.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-declarations.test.mjs` exits 0 across quoted/block YAML, scripts, manifests, caps, malformed input, and no-execution cases.
- Validation: Declarations are labeled as declarations/references, never proof of execution.
- Acceptance evidence: Dialect/status/cap matrix.
- Repair attempts: 0
- Recovery note: Pure extractor; resume from the failing fixture without changing consumers.

### 9. [in_progress] Command broker and core caller migration
- Task ID: T208
- Depends on: T201, T206
- Parallel group: G3
- Risk: high
- Owned scope: new `lib/scan/shared/command.mjs`; `lib/scan/shared/enum.mjs`, `lib/scan/survey.mjs`, `lib/scan/deep/git.mjs`; `test/expansion-command-core.test.mjs`
- Not in scope: deep scanner shell migration outside Git, new dimensions, provider conversion
- Spike candidate: Inventory every current child-process call and map it to an allowlisted command ID or Node filesystem replacement.
- Actions: Implement exact argv policies, reduced environment, timeout/output limits, typed errors, injected recorder, and migrate enumeration/survey/Git. Remove named contributor/remote leakage.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-command-core.test.mjs test/survey.test.mjs` exits 0; controlled PATH records only allowed command IDs.
- Validation: Source gate rejects direct child-process imports outside broker and prohibited flags/executables.
- Acceptance evidence: Command trace and remaining-call inventory (required zero outside broker).
- Repair attempts: 0
- Recovery note: Migrate one caller at a time; keep broker inert until each focused caller test passes.

### 10. [pending] Deep command migration and static runtime declarations
- Task ID: T209
- Depends on: T207, T208
- Parallel group: G4
- Risk: high
- Owned scope: `deep/stack.mjs`, `conventions.mjs`, `documentation.mjs`, `security.mjs`, `operations.mjs`, `shared/ecosystem.mjs`; focused existing tests plus `test/expansion-command-deep.test.mjs`
- Not in scope: provider conversion, new dimensions, registry/render cutover
- Spike candidate: none
- Actions: Remove runtime probes, `find`, shell pipelines, and direct execution; derive coexisting runtime/version/build/test/deploy declarations from manifests/version files/workflows/container images. Remove `runtimeProbe` descriptor contract.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-command-deep.test.mjs test/stack.test.mjs test/conventions.test.mjs test/documentation.test.mjs test/security.test.mjs test/operations.test.mjs` exits 0.
- Validation: Conflicting declarations coexist with provenance; output never chooses an actual runtime; recurring constraint gate passes.
- Acceptance evidence: Zero prohibited execution sites and static-runtime fixture matrix.
- Repair attempts: 0
- Recovery note: Validate each named scanner before proceeding; do not reintroduce a probe to preserve old host-version output.

### 11. [pending] Provider foundation and generic fallback
- Task ID: T210
- Depends on: T203, T206, T209
- Parallel group: G5
- Risk: high
- Owned scope: new `lib/scan/providers/base.mjs`, `generic.mjs`, `rules.mjs`; adaptations in `shared/ecosystem.mjs`, `manifest.mjs`, `detection.mjs`, `comments.mjs`; focused tests
- Not in scope: central registration, real new ecosystem, renderer/CLI cutover
- Spike candidate: none
- Actions: Implement immutable provider results, declarative rule evaluation, explicit per-dimension categories, five built-in descriptor adapters, generic artifact-only fallback, manifest/detection/comment contribution points, and deterministic merge rules.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-foundation.test.mjs test/ecosystem.test.mjs test/manifest.test.mjs test/detection.test.mjs test/comments.test.mjs` exits 0.
- Validation: Unknown-language fixture receives metadata/path observations only and no import/runtime/source-semantic claims.
- Acceptance evidence: Built-in parity and generic-fallback matrix.
- Repair attempts: 0
- Recovery note: Providers remain unregistered until T224; remove/repair leaf adapters without production impact.

### 12. [pending] API Surface dimension
- Task ID: T211
- Depends on: T205, T207, T210
- Parallel group: G6
- Risk: high
- Owned scope: new API extractor/model/scanner/provider/renderer modules and `test/expansion-api.test.mjs`
- Not in scope: endpoint probing, schema generation, compatibility/auth effectiveness, runtime reachability
- Spike candidate: Confirm the supported literal subsets for built-in route/RPC/event/CLI/export syntaxes before adding each extractor.
- Actions: Extract contracts/routes/RPC/events/CLI/public exports with evidence; resolve only direct literal/local constant aliases; mark dynamic fragments partial/unverified.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-api.test.mjs` exits 0 for positive, dynamic, unsupported, privacy, cap, and no-false-edge fixtures.
- Validation: Every rendered operation references admissible evidence; name-only fixture creates no edge.
- Acceptance evidence: Per-ecosystem/provider matrix and cap counts.
- Repair attempts: 0
- Recovery note: Disable a faulty extractor while retaining artifact declarations as unsupported; never invent an endpoint.

### 13. [pending] Data Architecture dimension
- Task ID: T212
- Depends on: T205, T207, T210
- Parallel group: G6
- Risk: high
- Owned scope: new data extractor/model/scanner/provider/renderer modules and `test/expansion-data.test.mjs`
- Not in scope: database connections, migration execution, query plans, PII classification, inferred lineage
- Spike candidate: Confirm explicit relation syntax subsets for SQL and built-in ORMs; unsupported metaprogramming remains unverified.
- Actions: Extract stores/schemas/migrations/entities/fields/keys/FKs/explicit relations/caches/queues; build namespaced ER and declared data-flow graphs only from evidence.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-data.test.mjs` exits 0; every ER/data-flow edge has explicit relation evidence and name-only relations produce none.
- Validation: Migration order uses explicit predecessor edges; ambiguity remains unresolved.
- Acceptance evidence: Edge/evidence matrix and deterministic Mermaid snapshot.
- Repair attempts: 0
- Recovery note: Preserve extracted declarations when resolution fails; rebuild relation graph independently.

### 14. [pending] Deployment Topology dimension
- Task ID: T213
- Depends on: T205, T207, T210
- Parallel group: G6
- Risk: high
- Owned scope: new deployment extractors/model/scanner/provider/renderer modules and `test/expansion-deployment.test.mjs`
- Not in scope: Docker/Helm/Terraform/Kubernetes/cloud execution, remote modules, live drift, cost/availability/security verdicts
- Spike candidate: Prove conservative subsets for multi-document YAML, Compose anchors, Helm templates, Terraform HCL references, CloudFormation tags/intrinsics, and serverless variables.
- Actions: Parse literal resources and direct references with bounds; record unsupported constructs and unresolved stubs; never expand loops/macros/remote includes.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-deployment.test.mjs` exits 0 across every supported format, dynamic constructs, redaction, ambiguity, and cap cases.
- Validation: Every topology edge cites a declaration; unsupported constructs create no fabricated resources.
- Acceptance evidence: Format support/status table and topology golden.
- Repair attempts: 0
- Recovery note: Commit per-artifact results atomically; malformed artifacts remain diagnostics without erasing valid peers.

### 15. [pending] Maintainability dimension
- Task ID: T214
- Depends on: T205, T206, T210
- Parallel group: G6
- Risk: high
- Owned scope: new maintainability tokenizer/duplicates/model/scanner/provider/renderer modules and `test/expansion-maintainability.test.mjs`
- Not in scope: quality scores, semantic clones, defect prediction, developer ranking, recommendations
- Spike candidate: Validate lightweight token/comment/string boundaries for the five built-ins; unsupported files remain outside measured aggregates.
- Actions: Disclose measurement universe; detect generated/vendor boundaries by exact evidence; calculate lexical branch-point approximation; hash/verify/merge exact 50-token duplicate windows; report bounded size distributions and tool evidence.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-maintainability.test.mjs` exits 0 with hand-calculated metrics, exact duplicates, generated exclusions, caps, and neutral wording.
- Validation: No repository-wide conclusion appears when coverage is partial.
- Acceptance evidence: Detector versions, universe/cap counts, fixture calculations.
- Repair attempts: 0
- Recovery note: Rebuild token indexes from immutable artifacts; disable unsupported language metrics rather than extrapolating.

### 16. [pending] Governance & Ownership dimension
- Task ID: T215
- Depends on: T205, T207, T208, T210
- Parallel group: G6
- Risk: high
- Owned scope: new governance/CODEOWNERS/model/scanner/provider/renderer modules, Git fixture helper, `test/expansion-governance.test.mjs`
- Not in scope: remote organization APIs, inferred ownership from commits, effectiveness/freshness/legal conclusions
- Spike candidate: Define supported CODEOWNERS dialect/pattern subset and explicit ADR/release/policy metadata before parsing.
- Actions: Inventory ownership/policy/contribution/review/release/ADR/runbook/support/funding artifacts and explicit links; apply last-match semantics where supported; privacy-filter identities.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-governance.test.mjs` exits 0 for precedence, malformed patterns, opaque identities, policies, ADR links, dates, caps, and no-inference cases.
- Validation: No email/name/raw owner/remote credential leaks through findings, CLI, or Markdown.
- Acceptance evidence: Dialect support and privacy matrix.
- Repair attempts: 0
- Recovery note: Process documents independently; malformed peers do not erase valid evidence.

### 17. [pending] Assurance & Supply Chain dimension
- Task ID: T216
- Depends on: T200, T205, T206, T207, T210
- Parallel group: G6
- Risk: high
- Owned scope: new assurance parsers/model/scanner/provider/renderer modules, versioned standards-pack metadata modules, `test/expansion-assurance.test.mjs`
- Not in scope: package resolution/install, advisory lookup, scanner execution, signature validation, license compatibility, compliance/accessibility verdicts
- Spike candidate: none after T200; uncertain/restricted entries are already metadata-only.
- Actions: Inventory manifests/locks/pins/sources/licenses/SBOM/VEX/SARIF/config/results/accessibility/attestations; join only exact schema identities; apply standards metadata/mappings allowed by T200.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-assurance.test.mjs` exits 0 for pins/sources/locks/licenses/SBOM/VEX/SARIF/accessibility/standards/unsupported/privacy/cap fixtures.
- Validation: No copied control text, sensitive result content, synthesized pass/fail, vulnerability, compatibility, or compliance language.
- Acceptance evidence: Format/version matrix, disposition references, zero-leak voice scan.
- Repair attempts: 0
- Recovery note: Malformed result artifacts do not invalidate manifest evidence; metadata-only standards never become control claims.

### 18. [pending] Architecture static dynamic indicators and graph facts
- Task ID: T217
- Depends on: T205, T206, T210
- Parallel group: G6
- Risk: high
- Owned scope: `deep/architecture.mjs`, new graph/dynamic-indicator helper, architecture renderer module, `test/expansion-architecture-extension.test.mjs`
- Not in scope: runtime tracing, reflection resolution, criticality/hub/dead-code/coupling verdicts, cross-repo resolution
- Spike candidate: none
- Actions: Add dynamic import/reflection/plugin/codegen/macro indicators, explicit-edge fan-in/out, edge-kind counts, self-loops, Tarjan SCCs, bounds, and measurement-universe metadata.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-architecture-extension.test.mjs test/architecture.test.mjs test/architecture-repair.test.mjs` exits 0.
- Validation: Hand-authored graphs match exact fan/SCC results; unsupported dynamic constructs produce indicators, never speculative edges.
- Acceptance evidence: Edge provenance and graph algorithm fixture results.
- Repair attempts: 0
- Recovery note: Recompute metrics from validated edges; preserve original import graph if extension calculation fails.

### 19. [pending] Provider catalog migration for Stack, Config, and Testing
- Task ID: T218
- Depends on: T209, T210
- Parallel group: G7
- Risk: high
- Owned scope: new inert runtime/config/testing provider catalog and `test/expansion-provider-runtime-catalog.test.mjs`
- Not in scope: scanner source, shared indexes, CLI/pipeline activation
- Spike candidate: none
- Actions: Adapt existing scanner models and plugin declarative observations to provider contracts; preserve built-in semantics and generic fallback.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-runtime-catalog.test.mjs test/stack.test.mjs test/config.test.mjs test/testing.test.mjs` exits 0.
- Validation: Catalog is deterministic and inert before T224.
- Acceptance evidence: Built-in/provider parity snapshot.
- Repair attempts: 0
- Recovery note: Remove/repair the inert catalog without affecting production.

### 20. [pending] Provider catalog migration for Architecture, Conventions, and Documentation
- Task ID: T219
- Depends on: T210, T217
- Parallel group: G7
- Risk: high
- Owned scope: new inert analysis provider catalog and `test/expansion-provider-analysis-catalog.test.mjs`
- Not in scope: scanner implementation, shared indexes, renderer/CLI/enrich activation
- Spike candidate: none
- Actions: Adapt existing models plus dynamic architecture indicators and plugin observations; preserve built-in import/comment/convention/documentation behavior.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-analysis-catalog.test.mjs test/regression-parity.test.mjs` exits 0.
- Validation: Plugin observations cannot replace or rewrite built-in graph/findings.
- Acceptance evidence: Provider order and five-ecosystem parity.
- Repair attempts: 0
- Recovery note: Catalog remains inert; return a failing adapter to its focused owner.

### 21. [pending] Provider catalog migration for Security, Operations, and new dimensions
- Task ID: T220
- Depends on: T209-T216
- Parallel group: G8
- Risk: high
- Owned scope: new inert security/operations/API/data/deployment/maintainability/governance/assurance provider catalog and `test/expansion-provider-assurance-catalog.test.mjs`
- Not in scope: scanner edits, indexes, pipeline, renderer, enrich, validate
- Spike candidate: none
- Actions: Assemble validated provider references, categories, applicability, expected claims, generic fallback, and deterministic order for all remaining dimensions.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-provider-assurance-catalog.test.mjs` exits 0 with unique IDs and all 14 provider dimensions represented.
- Validation: Catalog is data-only/inert and contains no shared-index mutation.
- Acceptance evidence: Complete provider capability matrix.
- Repair attempts: 0
- Recovery note: Remove the catalog as one inert unit; repair leaf providers before central activation.

### 22. [pending] Explicit cross-repository identity and edge synthesis
- Task ID: T221
- Depends on: T210-T215
- Parallel group: G9
- Risk: high
- Owned scope: new `lib/scan/cross-repo/identity.mjs`, `edges.mjs`, `render.mjs`, `test/expansion-cross-repo.test.mjs`
- Not in scope: remote lookup/cloning, package registry, fuzzy names, probable links, central activation
- Spike candidate: none
- Actions: Normalize privacy-safe repository/component identities; resolve exact path/VCS/workspace/IaC/contract/event references; retain external/ambiguous records; cap and sort candidates/edges.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-cross-repo.test.mjs` exits 0 for exact, unresolved, ambiguous, duplicate, scoped, self-edge, duplicate-repo, reverse-order, and privacy fixtures.
- Validation: Ambiguous and unresolved references never enter graph metrics.
- Acceptance evidence: Identity/edge resolution matrix and deterministic global snapshot.
- Repair attempts: 0
- Recovery note: Validate identity table atomically, then rerun edge resolution; single-repo findings remain valid if synthesis is disabled.

### 23. [pending] Prepare inert dimension and provider registration
- Task ID: T222
- Depends on: T204, T218-T221
- Parallel group: G10
- Risk: high
- Owned scope: new `lib/scan/registry/dimensions.mjs`, `lib/scan/providers/builtin/index.mjs`, `test/expansion-dimension-registration.test.mjs`
- Not in scope: CLI/pipeline activation, renderer registration, enrich/validate/write changes
- Spike candidate: none
- Actions: Define ordered 16-dimension and provider snapshots, expected claim IDs, retryability, and Cross-repo global stage as inert injectable data.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-dimension-registration.test.mjs` exits 0 with every dimension/provider exactly once and stable order.
- Validation: Existing production default remains ten dimensions until T224.
- Acceptance evidence: Registry snapshot and duplicate/unknown failure cases.
- Repair attempts: 0
- Recovery note: Delete/repair inert registration data without affecting the current CLI.

### 24. [pending] Prepare inert renderer registration
- Task ID: T223
- Depends on: T205, T211-T217, T221, T222
- Parallel group: G11
- Risk: high
- Owned scope: new renderer modules/registry, `lib/scan/write.mjs` optional injected-registry seam, `test/expansion-render-registration.test.mjs`
- Not in scope: default activation, pipeline/enrich/validate/CLI changes, generic renderer fallback
- Spike candidate: none
- Actions: Register all per-repo and global renderers in dimension order; validate labels/prose/privacy; fail unknown/missing/duplicate renderers; keep existing-ten default active.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-render-registration.test.mjs` exits 0 with all registered renderers and typed unknown-renderer failures.
- Validation: Injected 16-dimension rendering is deterministic and performs one write; production default remains unchanged.
- Acceptance evidence: Renderer registry snapshot and voice result.
- Repair attempts: 0
- Recovery note: Keep `writeNORMS` on the existing-ten default until atomic activation.

### 25. [pending] Atomic expanded-pipeline activation and sanitized diagnostics
- Task ID: T224
- Depends on: T202, T222, T223
- Parallel group: G12
- Risk: high
- Owned scope: `scripts/scan.mjs`, `lib/scan/pipeline/run.mjs`, `lib/scan/enrich.mjs`, `lib/scan/validate.mjs`, `lib/scan/write.mjs`, new sanitized reporter/error boundary, `test/expansion-activation.test.mjs`
- Not in scope: leaf scanner/provider/renderer implementation or policy relaxation
- Spike candidate: none
- Actions: Atomically activate 16 dimensions, providers, renderers, expected-claim coverage, retry, per-repo enrichment, global synthesis, fail-before-write validation, and privacy-safe stdout/stderr/errors. Remove duplicate hardcoded dispatch only after full injected parity passes.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-activation.test.mjs test/scan-cli.test.mjs test/enrich.test.mjs test/validate.test.mjs` exits 0.
- Validation: CLI never exposes raw paths/errors; all 16 dimensions render in one valid run; missing renderer/schema/privacy/plugin blocks the write; original ten pass semantic baseline.
- Acceptance evidence: Activation trace, one-write count, sanitized diagnostic canaries, compatibility report.
- Repair attempts: 0
- Recovery note: Restore the old CLI/default pipeline facade as one forward repair; inert registrations and leaf modules remain available for another attempt.

### 26. [pending] Synthetic all-dimension plugin proof
- Task ID: T225
- Depends on: T203, T218-T224
- Parallel group: G13
- Risk: standard
- Owned scope: temporary-skill-root fixture containing `plugins/fixturelang/plugin.json`, fixture repository map, `test/expansion-synthetic-plugin.test.mjs`
- Not in scope: production plugin directory, executable hooks, core Fixturelang conditions, new first-class ecosystem
- Spike candidate: none
- Actions: Build an injected temporary skill root; prove declarative Fixturelang contributes to all 14 provider dimensions; remove the plugin and prove generic fallback; assert `fixturelang` is absent from production `lib/`, `scripts/`, and plugin root.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-synthetic-plugin.test.mjs` exits 0 with 14 plugin dimensions, generic fallback after removal, immutable order, and no core token.
- Validation: Plugin cannot request command/read/write/environment access or emit unsafe labels/paths.
- Acceptance evidence: Capability matrix and source-token/boundary checks.
- Repair attempts: 0
- Recovery note: Treat any required core Fixturelang knowledge as a provider-contract defect; repair the generic API, not core conditionals.

### 27. [pending] Five-ecosystem and generic expansion fixtures
- Task ID: T226
- Depends on: T224, T225
- Parallel group: G14
- Risk: standard
- Owned scope: new topic-focused expansion fixtures for Python/JS/TS/Shell/Rust and unknown language, `test/expansion-fixtures.test.mjs`, production-pipeline fixture integration
- Not in scope: production changes, real credentials/data, duplicated test-only pipeline
- Spike candidate: none
- Actions: Cover applicability, observed/not-detected/unsupported/unverified/N/A, privacy hazards, dynamic constructs, all six new dimensions, architecture facts, and cross-repo relationships using the production pipeline.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs test/fixtures-pipeline.test.mjs test/regression-parity.test.mjs` exits 0.
- Validation: All five built-ins preserve existing facts; unknown language gets generic evidence; every applicable new dimension has positive and negative cases.
- Acceptance evidence: Ecosystem/dimension/status matrix.
- Repair attempts: 0
- Recovery note: Repair only the failing topic fixture or owning extractor; never weaken a shared assertion for one ecosystem.

### 28. [pending] Determinism, privacy, voice, negative, and constraint gates
- Task ID: T227
- Depends on: T226
- Parallel group: G15
- Risk: high
- Owned scope: new expansion determinism/privacy/voice/negative/constraint tests; updates to central golden/voice/CLI tests only
- Not in scope: production implementation or gate allowlisting to hide failures
- Spike candidate: none
- Actions: Run fixed-clock repeated bytes, insertion-order permutations, repository reversal, malformed plugin/evidence/standards/renderer cases, privacy canaries across every sink, command recording, target snapshots, one-write/zero-deps/import audits, and all authored prose through voice checks.
- Acceptance signal: `node --test --test-concurrency=1 test/expansion-determinism.test.mjs test/expansion-privacy-gate.test.mjs test/expansion-voice-gate.test.mjs test/expansion-negative.test.mjs test/expansion-constraints.test.mjs test/golden.test.mjs test/voice-gate.test.mjs` exits 0.
- Validation: Two immutable runs are byte-identical; leak/voice/prohibited-command/extra-write/external-dependency counts are all zero.
- Acceptance evidence: Seeds, hashes, command trace, target before/after snapshot, gate counts.
- Repair attempts: 0
- Recovery note: Return the first failing invariant to its owning task; never relax a policy/voice/privacy gate to complete this task.

### 29. [pending] SKILL documentation and final acceptance
- Task ID: T228
- Depends on: T227
- Parallel group: G16
- Risk: high
- Owned scope: `SKILL.md`, new `test/expansion-final-acceptance.test.mjs`, final evidence record
- Not in scope: feature implementation, suppressed tests, environment-dependent acceptance
- Spike candidate: none
- Actions: Document 16 dimensions, global graph, static command boundary, evidence statuses/coverage, privacy, plugin trust/data-only contract, generic fallback, standards dispositions, parser caps/unsupported constructs, deterministic output, and recovery. Run full suite and optional available real-repo smoke to a temporary output.
- Acceptance signal: `node --test --test-concurrency=1` exits 0 with all 309 baseline tests retained/passing or explicitly superseded and every new test passing.
- Validation: Final focused gates rerun; optional real-repo smoke uses the canonical pipeline and `/tmp`, never target commands; two independent reviewers inspect correctness and safety/voice.
- Acceptance evidence: Full test summary, requirement matrix, focused gate results, reviewer verdicts, one-write/zero-dependency/read-only evidence.
- Repair attempts: 0
- Recovery note: Any final failure reopens its owning task; documentation cannot convert a failing behavior into an accepted limitation.

## Verification Strategy
Cheapest-first:
1. Per-task focused `node --test --test-concurrency=1 test/<task>.test.mjs`.
2. After every production task, run the available recurring constraint set: baseline, command policy, evidence schema, privacy, voice, one-write, and zero-dependency tests.
3. At the end of G6, run all six new dimension tests plus architecture extension tests in parallel-safe batches.
4. At G7-G9, run provider catalogs and cross-repo identity/edge tests.
5. Before activation, run injected 16-dimension pipeline and renderer tests while production defaults remain unchanged.
6. After T224, run CLI, enrich, validate, write, original P0 regression, and five-fixture pipeline tests.
7. Run synthetic plugin, generic fallback, deterministic/property/negative/privacy/voice gates.
8. Run the authoritative full sequential suite last; default parallel mode is not authoritative because fixture tests may race.

Fast gates: schema, plugin loader, pure extractors, renderer modules, command policy. Expensive gates: all-five pipelines, multi-repo synthesis, deterministic repeated renders, full suite, optional real-repo smoke.

Every implementation checkpoint records task IDs, test counts, command IDs invoked, prohibited target-command count (0), production write count (1), external dependency count (0), privacy/voice hit counts (0), standards dispositions, status/coverage counts, and changed golden sections with approved reasons.

## Risks And Recovery
- **R1 — Static parsers overclaim effective behavior.** Require explicit evidence classes, unsupported diagnostics, and negative fixtures; unresolved declarations never become edges.
- **R2 — Declarative plugins become an execution channel.** JSON only, strict schema, no functions/imports/commands/paths/templates, skill-local containment, atomic fatal load errors.
- **R3 — Partial cutover leaves CLI unable to render/validate.** T222/T223 remain inert; T224 activates pipeline, renderer, validation, cross-repo, and diagnostics atomically.
- **R4 — Standards text/licensing is mishandled.** T200 precedes assurance; unknown/restricted reuse defaults metadata-only; no control prose is stored.
- **R5 — Privacy leaks through CLI/errors or structured evidence.** Central T206 privacy primitive and T224 reporter sanitize before every sink; T227 canaries cover all surfaces.
- **R6 — Coverage reports absence after incomplete scans.** Contract forbids `not_detected` after caps/errors/unsupported constructs; negative tests enforce transitions.
- **R7 — Giant files and merge conflicts recur.** New dimensions use extractor/model/scanner/renderer modules; shared indexes have exclusive sequential owners.
- **R8 — Cross-repo names create false links.** Exact identities and one-candidate resolution only; ambiguity is retained but excluded from metrics.
- **R9 — Maintainability becomes judgmental.** Raw methods/universes/counts only; voice gate rejects grading/recommendation language.
- **R10 — Existing five ecosystems regress.** T201 baseline, current focused tests, 21-case P0 matrix, T226 five-fixture pipeline, and T227 golden gates.
- **R11 — No Git rollback is available.** Before central cutover all additions are inert; recover by focused forward repair. T224 can restore the old facade in one bounded edit. Never use destructive Git commands.
- **R12 — Parser scale consumes excessive resources.** Every detector has file/byte/record/depth caps, deterministic truncation, no symlink escape, and visible omitted counts.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Standards versions/reuse unresolved | blocker | T200 prerequisite; exact editions/dispositions; metadata-only default; no copied text | AC10, T200/T216 |
| Evidence envelope conflicted with lineage exclusion | blocker | Stable claim/evidence records; claim-to-source required; runtime derivation DAG excluded | Design: Claim And Evidence |
| Static-only policy unenforceable | blocker | Central broker, exact rg/Git forms, controlled PATH tests, no target commands/shell/find/runtime probes | AC1, T208-T209/T227 |
| Plugin framework missed new dimensions | high | Fixed 14-dimension provider contract; catalogs plus all-dimension synthetic plugin | T202, T220, T225 |
| Plugin trust boundary underspecified | high | Data-only JSON; realpath/lstat/symlink/schema/order/atomic rules | T203 |
| Bounded absence unsafe | high | Six statuses; complete-search predicate; unsupported/unverified transitions | AC16, T202 |
| Byte baseline undefined | high | Semantic baseline first; fixed clock/order/line endings for byte determinism | T201, T205, T227 |
| Broad provider migration non-atomic | high | Shared foundation plus inert catalogs and exclusive cutovers | T210, T218-T224 |
| Central integration merge sink | high | Inert pipeline registration, inert renderer registration, one atomic activation | T222-T224 |
| API/data edges could be invented | high | Explicit declaration classes and negative name-only tests | T211-T212 |
| Deployment formats exceed parser support | high | Conservative format subsets, unsupported diagnostics, no evaluation | T213 |
| Governance privacy unspecified | high | Pre-persistence privacy contract and opaque/aggregate identities | T206, T215, T227 |
| Cross-repo identity ambiguous | high | Canonical scoped IDs, exact matches, unresolved/ambiguous records | T221 |
| Maintainability algorithms/bounds missing | high | Disclosed universe, lexical metric, exact 50-token duplicate algorithm, caps | T214/T217 |
| Constraints deferred to final gate | high | T201 recurring harness after every production task plus T227 final | Verification Strategy |
| Parallel tasks might edit shared indexes | high | No G6/G7/G8 index edits; T222/T223/T224 exclusive owners | Execution Graph |
| Voice gate could miss plugin/standards/CLI prose | standard | Validate authored labels and all output surfaces; no arbitrary plugin prose/templates | T203/T227 |
| Production/test pipelines could diverge | standard | One exported canonical pipeline used by CLI and tests | T204/T224/T226 |
| Requirements not fully mapped | standard | Explicit 11-row requirement-to-task matrix | Design matrix |
| Recovery/checkpoints absent | standard | Inert leaves, bounded cutovers, per-task recovery, recurring evidence | Tasks/Risks |
| T222 activation preceded renderer/validate readiness | blocker | T222/T223 inert; only T224 activates all central contracts atomically | T222-T224 |
| Executable plugin hooks bypassed safety | blocker | Removed hooks and ESM plugins entirely; strict `plugin.json` data only | A4/T203 |
| Fixturelang could ship in production plugin root | high | Temporary injected skill root; production token/root assertions | T225 |
| CLI/error privacy had no owner | high | T224 owns sanitized reporter/error boundary using T206 | T224/T227 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---:|---|---|---|---|
| 2026-08-02 | 0 | INTAKE | planning | Large open multi-component expansion; two product choices identified. | DISCOVER |
| 2026-08-02 | 0 | INTAKE -> DISCOVER | planning | User chose static evidence only and generic plugin framework. | DISCOVER |
| 2026-08-02 | 0 | DISCOVER | planning | Current ten-dimension, five-ecosystem, one-write pipeline and 309-test baseline mapped. | RESEARCH |
| 2026-08-02 | 0 | RESEARCH | planning | Six parallel tracks covered uncertainties, plugins, architecture, assurance, governance, and integration. | DRAFT |
| 2026-08-02 | 0 | RESEARCH safety stop | planning | Read-only webfetch automatically persisted three OpenCode tool-output logs outside `/tmp`; no repository changes. User explicitly allowed treating them as platform artifacts and resuming without further webfetch. | DRAFT |
| 2026-08-02 | 0 | DRAFT | planning | Initial 24-task architecture drafted. | CRITIQUE |
| 2026-08-02 | 0 | CRITIQUE | planning | Independent critic found command/evidence/standards/privacy/plugin/integration blockers. | REMEDIATE |
| 2026-08-02 | 0 | REMEDIATE | planning | Four independent tracks produced enforceable contracts and a 29-task graph. | CRITIQUE |
| 2026-08-02 | 0 | CRITIQUE | planning | Second critic found partial-cutover, executable-plugin, standards-default, fixture-root, and CLI-privacy issues. | REMEDIATE |
| 2026-08-02 | 0 | REMEDIATE | planning | Plugins made JSON-only; T222/T223 inert; T224 atomic activation; metadata-only default; temporary Fixturelang root; sanitized reporter assigned. | VERIFY |
| 2026-08-02 | 0 | VERIFY | planning | Primary mapped all 20 acceptance criteria and 11 gaps; dependencies acyclic; parallel ownership disjoint; every task has exact gate, anti-scope, evidence, and recovery. | SAVED |
| 2026-08-02 | 0 | SAVED | planning | Plan saved; commit skipped because skill directory is not a Git repository. Implementation not started. | STOP |
| 2026-08-02 | 1 | NOT_STARTED -> RECOVER | execution | User explicitly invoked csm-build; reconstructing repository state and baseline evidence. | VALIDATE |
| 2026-08-02 | 1 | RECOVER -> VALIDATE | execution | No authentic NORMS.md found; plan statuses match source; prior completed parity changes present in parent Git tree. | VALIDATE |
| 2026-08-02 | 1 | VALIDATE -> SELECT | execution | `node --test --test-concurrency=1`: 309 pass, 0 fail. Files/interfaces and no-dependency test tooling match plan. | SELECT |
| 2026-08-02 | 1 | SELECT -> DISPATCH | T200,T201 | Independent new-file scopes; standards policy and baseline harness ready in parallel. | INTEGRATE |
| 2026-08-02 | 1 | DISPATCH -> INTEGRATE | T200,T201 | Standards registry/policy and deterministic baseline/constraint harness returned; no overlapping files or out-of-scope edits reported. | VERIFY |
| 2026-08-02 | 1 | INTEGRATE -> VERIFY | T200,T201 | Recovered artifacts match assigned scopes; authoritative suite passes 327/327 and production behavior remains unchanged. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T200,T201 | Focused gates pass: T200 9/9; T201 8/8. Static standards scan found policy vocabulary only, not registry claims. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> REPAIR | T200R1,T201R1 | Independent reviews found bypassable authored-mapping disposition, weak exact-edition/free-form prose schema, descriptive-only supersession, non-behavioral fixture/P0 inventory, and no production subprocess growth gate. Findings accepted; repair scopes remain disjoint. | REPAIR |
| 2026-08-02 | 1 | REPAIR -> VERIFY | T200R1,T201R1 | Standards registry made metadata-only with ID-bound editions and no free-form prose; baseline gained executable supersession/process/import/write guards and acceptance now runs five fixture pipelines plus 21 P0 cases. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T200R1,T201R1 | Repaired gates pass: standards 10/10; executable baseline 36/36. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> REPAIR | T200R2,T201R2 | Re-review found edition qualifier/floating-marker gaps plus alias, dynamic child-process, template-expression, and assertion-liveness bypasses in lexical constraints. Findings accepted for second bounded repair. | REPAIR |
| 2026-08-02 | 1 | REPAIR -> VERIFY | T200R2,T201R2 | Added closed qualifier policy and 13 floating markers; source gates now preserve template-expression code, reject mutation/process aliases and dynamic ownership, require assertion-bearing live supersession tests, and protect recording history. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T200R2,T201R2 | Focused gates pass: standards 14/14; executable baseline 37/37. Fresh standards review accepted T200 with no material findings. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> REPAIR | T201R3 | Fresh constraints review still found non-exact owner/call inventory, mutation blacklist gaps, behavioral anti-weakening gaps, and generic false positives. After two failed repairs, a separate fresh-eyes diagnosis selected capability allowlists plus reviewed hashes instead of further regex growth. | REPAIR |
| 2026-08-02 | 1 | REPAIR -> VERIFY | T201R3 | Replaced blacklist gates with exact legacy-owner/safeImport hashes, canonical filesystem acquisition policy, full five-fixture semantic/Markdown hashes, source-integrity locks, and stateful supersession records. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T201R3 | Focused gate passes 38/38 and full suite passes 336/336; independent review accepted all redesigned proofs except named `getBuiltinModule` acquisition from `node:process`. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> REPAIR | T201R4 | Accepted the single concrete capability gap; reject every executable `getBuiltinModule` token regardless direct or named-import form. | REPAIR |
| 2026-08-02 | 1 | REPAIR -> VERIFY | T201R4 | Added named and aliased `node:process` acquisition adversaries and a source-wide executable-token rejection. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T201R4 | Focused gate passes 38/38; review found string-named and Unicode-escaped `getBuiltinModule` imports can evade token matching. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> REPAIR | T201R5 | Close the capability at its module boundary by prohibiting all production `node:process` imports, including unparsed string-named forms. | REPAIR |
| 2026-08-02 | 1 | REPAIR -> VERIFY | T201R5 | Added `node:process` to parsed/unparsed sensitive-module auditing and adversarial string-named/Unicode import cases. | VERIFY |
| 2026-08-02 | 1 | VERIFY -> REVIEW | T201R5 | Executable baseline passes 38/38; independent reviewer confirms the named/aliased builtin acquisition gap is closed and accepts T201. | REVIEW |
| 2026-08-02 | 1 | REVIEW -> CHECKPOINT | T200,T201 | T200 standards gate 14/14; T201 executable baseline 38/38; full sequential suite 336/336; both independent reviews PASS; 10 fixture hashes, 8 process-owner locks, one writer, zero npm dependencies. | CHECKPOINT |
| 2026-08-02 | 2 | CHECKPOINT -> SELECT | T202 | T200/T201 dependencies accepted; contract task is the sole ready critical-path task with isolated new-file ownership. | SELECT |
| 2026-08-02 | 2 | SELECT -> DISPATCH | T202 | Dispatch dimension, claim, evidence, provider contracts and focused negative matrix. | DISPATCH |
| 2026-08-02 | 2 | DISPATCH -> INTEGRATE | T202 | Four isolated contract/test files returned; no existing production or baseline files changed. | INTEGRATE |
| 2026-08-02 | 2 | INTEGRATE -> VERIFY | T202 | Inspected status/coverage, evidence identity/path, provider category, immutability, deterministic order, and negative matrices; proceed to focused and recurring gates. | VERIFY |
| 2026-08-02 | 2 | VERIFY -> REVIEW | T202 | Focused contracts pass 12/12 and recurring baseline passes 38/38. | REVIEW |
| 2026-08-02 | 2 | REVIEW -> REPAIR | T202R1 | Correctness/safety reviews found forged evidence acceptance, category-unbound IDs, overlapping unsupported/unverified states, optional coverage denominator, disconnected applicability/registry ownership, unbounded recursive/proxy inspection, and category gaps. Findings accepted. | REPAIR |
| 2026-08-02 | 2 | REPAIR -> VERIFY | T202R1 | Evidence identity now binds category/details; canonical aggregate validation is bounded and Proxy-safe; statuses, search universes, applicability predicates, registry ownership, derivations, and coverage denominator are enforced. | VERIFY |
| 2026-08-02 | 2 | VERIFY -> REVIEW | T202R1 | Focused contracts pass 14/14 and recurring baseline passes 38/38. | REVIEW |
| 2026-08-02 | 2 | REVIEW -> REPAIR | T202R2 | Re-review found sparse/prototype-stripped arrays, orphan evidence, field-type mismatches, and dimension-agnostic direct categories; descriptor allocation also preceded array bounds. Findings accepted for second repair. | REPAIR |
| 2026-08-02 | 2 | REPAIR -> VERIFY | T202R2 | Enforced dense canonical arrays, pre-descriptor bounds, reverse evidence ownership, field-specific applicability types, and one shared all-dimension category map. | VERIFY |
| 2026-08-02 | 2 | VERIFY -> REVIEW | T202R2 | Focused contracts pass 19/19 and recurring baseline passes 38/38; both correctness and safety reviewers PASS. | REVIEW |
| 2026-08-02 | 2 | REVIEW -> CHECKPOINT | T202 | Canonical contracts accepted: 16 dimensions, 14 provider dimensions, six exclusive statuses, bounded evidence/search/applicability, registry-owned coverage, zero review findings. | CHECKPOINT |
| 2026-08-02 | 3 | CHECKPOINT -> SELECT | T203,T205,T206 | G2 tasks are dependency-ready with disjoint plugin, renderer, and artifact/privacy ownership. | SELECT |
| 2026-08-02 | 3 | SELECT -> DISPATCH | T203,T205,T206 | Dispatch maximum safe three-task parallel batch; primary retains shared baseline-lock reconciliation. | DISPATCH |
| 2026-08-02 | 3 | DISPATCH -> INTEGRATE | T203,T205,T206 | All three landed with disjoint ownership; renderer byte parity and fixture hashes preserved; new safe readers and write.mjs hash reconciled in T201 capability/supersession locks by primary. | INTEGRATE |
| 2026-08-02 | 3 | INTEGRATE -> VERIFY | T203,T205,T206 | G2 focused suites 36/36; recurring T201 gate 38/38 after capability reconciliation; primary relaxed cross-plugin shared-capability rejection that contradicted multi-language design. | VERIFY |
| 2026-08-02 | 3 | VERIFY -> REVIEW | T203,T205,T206 | First review dispatch returned empty results (agent glitch); reviews re-dispatched. | REVIEW |
| 2026-08-02 | 3 | REVIEW -> REPAIR | T203R1,T206R1 | T203: overlapping quantified regex atoms allow polynomial backtracking; readdir materializes the root before the count cap. T205: PASS. T206: serialization hits 2048 string cap; percent-encoded path traversal; forward-slash UNC; underscore token labels; read TOCTOU after containment. Findings accepted. | REPAIR |
| 2026-08-02 | 3 | REPAIR -> VERIFY | T203R1,T206R1 | Regex partition check, opendir bounded enumeration, round-trip serialization, encoded-segment URL rejection, double-slash/secret-label redaction, and O_NOFOLLOW dev/ino/realpath re-verification implemented; primary removed an aliased constants import and reconciled special-reader locks. | VERIFY |
| 2026-08-02 | 3 | VERIFY -> REVIEW | T203R1,T206R1 | Focused suites 15/15 and 13/13; recurring T201 38/38. | REVIEW |
| 2026-08-02 | 3 | REVIEW -> CHECKPOINT | T203,T205,T206 | Both repair reviewers PASS; T203 accepted (bounded enumeration, regex partition policy), T205 accepted (byte parity, one write), T206 accepted (serialization, URL, redaction, TOCTOU fixes). | CHECKPOINT |
| 2026-08-02 | 4 | CHECKPOINT -> SELECT | T204,T207,T208 | G3 dependency-ready with disjoint pipeline, declarations, and command-broker ownership; T208 primary reconciliation of capability/supersession locks after migration. | SELECT |
| 2026-08-02 | 4 | SELECT -> DISPATCH | T204,T207,T208 | Dispatch maximum safe three-task parallel batch. | DISPATCH |
| 2026-08-02 | 4 | DISPATCH -> INTEGRATE | T204,T207,T208 | Pipeline facade and broker migration landed; T207 returned empty twice and was implemented directly by the primary. Primary reconciled broker capability lock, supersession superseded record, inventory files, and gate assertions. | INTEGRATE |
| 2026-08-02 | 4 | INTEGRATE -> VERIFY | T204,T207,T208 | T201 gate 38/38 plus new suites 76/76; full suite 425/425. | VERIFY |
| 2026-08-02 | 4 | VERIFY -> REVIEW | T204,T207,T208 | Reviews: T204 PASS; T208 PASS with three low notes; T207 one medium Makefile misparse plus minor items. | REVIEW |
| 2026-08-02 | 4 | REVIEW -> REPAIR | T207R1 | Makefile false declarations, block-scalar indicator, FROM flags, cap codes, dead code; T208 remote-port mangle fixed directly. | REPAIR |
| 2026-08-02 | 4 | REPAIR -> VERIFY | T207R1 | Makefile recipes require tab indent with define/continuation handling; FROM flags/aliases stripped; block-scalar coded diagnostics; port-safe remote sanitization. | VERIFY |
| 2026-08-02 | 4 | VERIFY -> REVIEW | T207R1 | Focused suites pass; adversarial Makefile/block-scalar/FROM tests added. | REVIEW |
| 2026-08-02 | 4 | REVIEW -> CHECKPOINT | T204,T207,T208 | G3 accepted; full suite 426/426; broker is sole child-process owner after survey/enum/git migration; pipeline facade ready for T224 cutover. | CHECKPOINT |
| 2026-08-02 | 5 | CHECKPOINT -> SELECT | T209 | Single-task G4 ready; deep scanners still host shell execution and runtime probes. | SELECT |
| 2026-08-02 | 5 | SELECT -> DISPATCH | T209 | Dispatch deep command migration with static runtime declarations; primary reconciles fixture hashes, capability locks, and host-runtime-probes supersession afterward. | DISPATCH |
| 2026-08-02 | 5 | DISPATCH -> INTEGRATE | T209 | All five deep scanners migrated; sole child_process owner is the broker; focused 86/86. Primary regenerated fixture hashes, emptied active legacy owners, superseded host-runtime-probes, added deep-test inventory/integrity, and updated the golden runtime assertion. | INTEGRATE |
| 2026-08-02 | 5 | INTEGRATE -> VERIFY | T209 | Full suite 433/433; T201 gate passes with updated locks. | VERIFY |
| 2026-08-02 | 5 | VERIFY -> REVIEW | T209 | Independent reviewer PASS with one informational cap-disclosure note. | REVIEW |
| 2026-08-02 | 5 | REVIEW -> CHECKPOINT | T209 | G4 accepted; static-runtime declarations with provenance; conflicting declarations coexist; no actual-runtime verdict. | CHECKPOINT |
| 2026-08-02 | 6 | CHECKPOINT -> SELECT | T210 | G5 ready: provider foundation owns providers/* plus shared adapters, no other active task. | SELECT |
| 2026-08-02 | 6 | SELECT -> DISPATCH | T210 | Dispatch provider foundation and generic fallback. | DISPATCH |
| 2026-08-02 | 6 | DISPATCH -> INTEGRATE | T210 | Provider foundation landed with additive adapters and byte-identical built-in outputs; full suite 474/474. | INTEGRATE |
| 2026-08-02 | 6 | INTEGRATE -> VERIFY | T210 | Focused 117/117 and T201 gate pass. | VERIFY |
| 2026-08-02 | 6 | VERIFY -> REVIEW | T210 | Reviewer found regex policy absent at evaluation boundary and dead generic cap. | REVIEW |
| 2026-08-02 | 6 | REVIEW -> REPAIR | T210R1 | Enforce plugin regex policy before new RegExp at evaluation; cap generic observations with disclosed flag. | REPAIR |
| 2026-08-02 | 6 | REPAIR -> VERIFY | T210R1 | Both fixes verified; full suite 476/476. | VERIFY |
| 2026-08-02 | 6 | VERIFY -> REVIEW | T210R1 | Reviewer PASS; both findings closed, no new defects. | REVIEW |
| 2026-08-02 | 6 | REVIEW -> CHECKPOINT | T210 | G5 accepted. | CHECKPOINT |
| 2026-08-02 | 7 | CHECKPOINT -> SELECT | T211-T217 | G6 ready: seven new-dimension/extension tasks with disjoint extractor/model/scanner/provider/renderer ownership; no shared-index edits. | SELECT |
| 2026-08-02 | 7 | SELECT -> DISPATCH | T211-T217 | Dispatch maximum seven-task parallel batch; each renderer stays inert until T223. | DISPATCH |
| 2026-08-02 | 7 | DISPATCH -> INTEGRATE | T211-T217 | All seven landed (four after re-dispatch of empty agent results); no shared-index edits; full suite passed 765/765 with peer tasks concurrent. | INTEGRATE |
| 2026-08-02 | 7 | INTEGRATE -> VERIFY | T211-T217 | Focused gates all green; T201 gate 38/38. | VERIFY |
| 2026-08-02 | 7 | VERIFY -> REVIEW | T211-T217 | T213 PASS first; T212 lows only; T216/T217 PASS with lows; T211/T214/T215 required repairs. | REVIEW |
| 2026-08-02 | 7 | REVIEW -> REPAIR | T211R1,T213R1,T214R1,T215R1 | T211 silent sampling cap/comment routes/provider bounds; T213 search-space folds and stub retention; T214 extensionless crash/occurrence flag/cap note; T215 ADR status/absence line/matchedKey bounds. | REPAIR |
| 2026-08-02 | 7 | REPAIR -> VERIFY | T211R1,T213R1,T214R1,T215R1 | All four repaired; primary fixed T212 unique-index/NAME_ONLY and T216 diagnostics cap and T217 disclosure; 765/765. | VERIFY |
| 2026-08-02 | 7 | VERIFY -> REVIEW | T211R1,T213R1,T214R1,T215R1 | Re-reviews: T213R1 PASS; T211 string-literal false edges (M1); T214 broader extension class HIGH; T215 >512 URL crash windows. | REVIEW |
| 2026-08-02 | 7 | REVIEW -> REPAIR | T211R2,T214R2,T215R2 | Span-boundary tracking for strings/templates; `other` extension sentinel; governance shape-validation downgrade and pre-encode hashing. | REPAIR |
| 2026-08-02 | 7 | REPAIR -> VERIFY | T211R2,T214R2,T215R2 | All three repaired; four consecutive 776/776 runs (reported flake was concurrent-agent artifact). | VERIFY |
| 2026-08-02 | 7 | VERIFY -> REVIEW | T211R2,T214R2,T215R2 | T215R2 PASS; T211 chainOf/methodsFrom span bypasses plus regex-literal false negative; T214 generated-boundary non-ASCII HIGH. | REVIEW |
| 2026-08-02 | 7 | REVIEW -> REPAIR | T211R3,T214R3 | Chain/methods span filtering and regex-literal state; generated-boundary ASCII marker substitution. | REPAIR |
| 2026-08-02 | 7 | REPAIR -> VERIFY | T211R3,T214R3 | Both repaired; 781/781 twice. | VERIFY |
| 2026-08-02 | 7 | VERIFY -> REVIEW | T211R3,T214R3 | T211 PASS (one recorded Low); T214 one MEDIUM length overflow on filename markers, fixed by primary (tokenLabel length guard). | REVIEW |
| 2026-08-02 | 7 | REVIEW -> CHECKPOINT | T211-T217 | G6 accepted: six new dimensions plus architecture extension; 781/781. | CHECKPOINT |
| 2026-08-02 | 8 | CHECKPOINT -> SELECT | T218,T219 | G7 ready: inert provider catalogs for stack/config/testing and architecture/conventions/documentation; disjoint ownership. | SELECT |
| 2026-08-02 | 8 | SELECT -> DISPATCH | T218,T219 | Dispatch two-task parallel batch; catalogs remain inert until T224. | DISPATCH |
| 2026-08-02 | 8 | DISPATCH -> INTEGRATE | T218,T219 | Both inert catalogs landed; full suite 825/825. | INTEGRATE |
| 2026-08-02 | 8 | INTEGRATE -> VERIFY | T218,T219 | Focused and T201 gates green. | VERIFY |
| 2026-08-02 | 8 | VERIFY -> REVIEW | T218,T219 | T218 capped-flag discard and plugin-only drop; T219 assembled matchedKey bounds. | REVIEW |
| 2026-08-02 | 8 | REVIEW -> REPAIR | T218R1,T219R1 | Thread generic capped flag and plugin-only results; bound assembled keys with truncation disclosure and generic extension keys. | REPAIR |
| 2026-08-02 | 8 | REPAIR -> VERIFY | T218R1,T219R1 | Both repaired; 829/829 twice. | VERIFY |
| 2026-08-02 | 8 | VERIFY -> REVIEW | T218R1,T219R1 | Both reviewers PASS; no new defects; carrier-id and wording nits recorded. | REVIEW |
| 2026-08-02 | 8 | REVIEW -> CHECKPOINT | T218,T219 | G7 accepted. | CHECKPOINT |
| 2026-08-02 | 9 | CHECKPOINT -> SELECT | T220 | G8 ready: inert security/operations/API/data/deployment/maintainability/governance/assurance provider catalog. | SELECT |
| 2026-08-02 | 9 | SELECT -> DISPATCH | T220 | Dispatch single-task batch; catalog inert until T224. | DISPATCH |
| 2026-08-02 | 9 | DISPATCH -> INTEGRATE | T220 | Assurance catalog landed; 857/857 twice. | INTEGRATE |
| 2026-08-02 | 9 | INTEGRATE -> VERIFY | T220 | Focused 28/28 plus sibling catalog gates and T201 gate green. | VERIFY |
| 2026-08-02 | 9 | VERIFY -> REVIEW | T220 | Reviewer PASS; one recorded residual (six leaf providers need matchedKey bound pass at T222/T224) plus wording nit. | REVIEW |
| 2026-08-02 | 9 | REVIEW -> CHECKPOINT | T220 | G8 accepted; all 14 provider dimensions represented once across catalogs. | CHECKPOINT |
| 2026-08-02 | 10 | CHECKPOINT -> SELECT | T221 | G9 ready: cross-repo identity and edge synthesis with new-file ownership. | SELECT |
| 2026-08-02 | 10 | SELECT -> DISPATCH | T221 | Dispatch single-task batch; synthesis inert until T224. | DISPATCH |
| 2026-08-02 | 10 | DISPATCH -> INTEGRATE | T221 | Cross-repo synthesis landed after one empty-agent re-dispatch; 888/888. | INTEGRATE |
| 2026-08-02 | 10 | INTEGRATE -> VERIFY | T221 | Focused 31/31 and T201 gate green. | VERIFY |
| 2026-08-02 | 10 | VERIFY -> REVIEW | T221 | Reviewer found external records privacy bypass and sort-key tie gap. | REVIEW |
| 2026-08-02 | 10 | REVIEW -> REPAIR | T221R1 | Privacy-gate external records and add sourceKind to sort key. | REPAIR |
| 2026-08-02 | 10 | REPAIR -> VERIFY | T221R1 | Both fixed; 888/888 twice. | VERIFY |
| 2026-08-02 | 10 | VERIFY -> REVIEW | T221R1 | Reviewer PASS; one recorded LOW (sensitive path aborts synthesis fail-closed; resolve at T223/T224). | REVIEW |
| 2026-08-02 | 10 | REVIEW -> CHECKPOINT | T221 | G9 accepted. | CHECKPOINT |
| 2026-08-02 | 11 | CHECKPOINT -> SELECT | T222 | G10 ready: inert 16-dimension/provider registry snapshots. | SELECT |
| 2026-08-02 | 11 | SELECT -> DISPATCH | T222 | Dispatch single-task batch; registrations inert until T224. | DISPATCH |
| 2026-08-02 | 11 | DISPATCH -> INTEGRATE | T222 | Registry snapshots landed; 902/902. | INTEGRATE |
| 2026-08-02 | 11 | INTEGRATE -> VERIFY | T222 | Focused 14/14 and T201 gate green. | VERIFY |
| 2026-08-02 | 11 | VERIFY -> REVIEW | T222 | Reviewer found expected-claim sets missing many category topics. | REVIEW |
| 2026-08-02 | 11 | REVIEW -> REPAIR | T222R1 | Expand claims to cover every category; add set-inclusion test. | REPAIR |
| 2026-08-02 | 11 | REPAIR -> VERIFY | T222R1 | 22 claim IDs added; 903/903. | VERIFY |
| 2026-08-02 | 11 | VERIFY -> REVIEW | T222R1 | Reviewer: medium closed; one orphan claim noted; primary removed it and added the reverse reachability assertion. | REVIEW |
| 2026-08-02 | 11 | REVIEW -> CHECKPOINT | T222 | G10 accepted; 903/903. | CHECKPOINT |
| 2026-08-02 | 12 | CHECKPOINT -> SELECT | T223 | G11 ready: renderer registry plus write.mjs injected seam; exclusive owner of write.mjs seam. | SELECT |
| 2026-08-02 | 12 | SELECT -> DISPATCH | T223 | Dispatch single-task batch; injected registry inert until T224. | DISPATCH |
| 2026-08-02 | 12 | DISPATCH -> INTEGRATE | T223 | Renderer registry and write.mjs seam landed; primary updated the write.mjs digest lock under the sanctioned seam change; 914/914. | INTEGRATE |
| 2026-08-02 | 12 | INTEGRATE -> VERIFY | T223 | Focused 21/21 and T201 gate green after lock reconciliation. | VERIFY |
| 2026-08-02 | 12 | VERIFY -> REVIEW | T223 | Reviewer PASS with two LOW injection-path items (ID-scoped duplicates, global freeze/collision); primary fixed both; 914/914. | REVIEW |
| 2026-08-02 | 12 | REVIEW -> CHECKPOINT | T223 | G11 accepted. | CHECKPOINT |
| 2026-08-02 | 13 | CHECKPOINT -> SELECT | T224 | G12 ready: the single atomic activation cutover owning CLI, pipeline, enrich, validate, write, reporter; recorded residuals to resolve (leaf provider key bounds, cross-repo sensitive-path fail-closed, cross-observation newline). | SELECT |
| 2026-08-02 | 13 | SELECT -> DISPATCH | T224 | Dispatch single-task batch; this is the only activation cutover. | DISPATCH |
| 2026-08-02 | 13 | DISPATCH -> INTEGRATE | T224 | Activation landed; primary reconciled enrich/write hash locks, CLI call lock, removed the safeImport lock, and updated the three inertness tests to the activated consumers; 929/929. | INTEGRATE |
| 2026-08-02 | 13 | INTEGRATE -> VERIFY | T224 | Activation 32/32 plus full suite green. | VERIFY |
| 2026-08-02 | 13 | VERIFY -> REVIEW | T224 | Reviewer PASS with two LOW (SKILL.md doc at T228; retry-enrich parity note) and three INFO observations; all 13 acceptance items verified; residuals (a)/(b)/(c) resolved. | REVIEW |
| 2026-08-02 | 13 | REVIEW -> CHECKPOINT | T224 | G12 accepted; pipeline now canonical and expanded. | CHECKPOINT |
| 2026-08-02 | 14 | CHECKPOINT -> SELECT | T225 | G13 ready: synthetic Fixturelang plugin proof with temporary injected skill root. | SELECT |
| 2026-08-02 | 14 | SELECT -> DISPATCH | T225 | Dispatch single-task batch; fixturelang never ships in production roots. | DISPATCH |
| 2026-08-02 | 14 | DISPATCH -> INTEGRATE | T225 | Synthetic plugin proof landed; review found the wiring gap (plugin evidence never reached output). | INTEGRATE |
| 2026-08-02 | 14 | INTEGRATE -> VERIFY | T225 | Catalog-seam tests pass; pipeline byte-identical with/without plugin proved the gap. | VERIFY |
| 2026-08-02 | 14 | REVIEW -> REPAIR | T225R1 | Wire the three production catalogs into runExpandedPipeline; output-level assertions; admit run.mjs in four catalog/foundation inertness pins. | REPAIR |
| 2026-08-02 | 14 | REPAIR -> VERIFY | T225R1 | Provider wiring merged; 935/935. | VERIFY |
| 2026-08-02 | 14 | VERIFY -> REVIEW | T225R1 | Reviewer PASS with three P3 fixes applied by primary (retry preserves provider observations, privacy node bound for observation lists, plugin cap disclosure). | REVIEW |
| 2026-08-02 | 14 | REVIEW -> CHECKPOINT | T225 | G13 accepted; plugin evidence reaches NORMS.md for all 14 dimensions; removal flips to generic. | CHECKPOINT |
| 2026-08-02 | 15 | CHECKPOINT -> SELECT | T226 | G14 ready: five-ecosystem and generic expansion fixtures on the production pipeline. | SELECT |
| 2026-08-02 | 15 | SELECT -> DISPATCH | T226 | Dispatch single-task batch. | DISPATCH |
| 2026-08-02 | 15 | DISPATCH -> INTEGRATE | T226 | Expansion fixtures landed; 958/958. | INTEGRATE |
| 2026-08-02 | 15 | INTEGRATE -> VERIFY | T226 | Focused 16/16, acceptance 42/42, T201 gate 38/38. | VERIFY |
| 2026-08-02 | 15 | REVIEW -> CHECKPOINT | T226 | G14 accepted (standard risk, primary self-review; six-ecosystem status matrix documented). | CHECKPOINT |
| 2026-08-02 | 16 | CHECKPOINT -> SELECT | T227 | G15 ready: determinism/privacy/voice/negative/constraint gates. | SELECT |
| 2026-08-02 | 16 | SELECT -> DISPATCH | T227 | Dispatch gate suite; golden/voice/CLI central tests updated only if required. | DISPATCH |
| 2026-08-02 | 16 | DISPATCH -> INTEGRATE | T227 | Four gate files landed; 986/986; no central tests needed updates. | INTEGRATE |
| 2026-08-02 | 16 | INTEGRATE -> VERIFY | T227 | Focused 52/52 and full suite green twice. | VERIFY |
| 2026-08-02 | 16 | VERIFY -> REVIEW | T227 | Reviewer PASS with one Low (survey/enumerate use the global broker, invisible to injected recording). | REVIEW |
| 2026-08-02 | 16 | REVIEW -> REPAIR | T227R1 | Thread broker through survey/enumerate; resolveBroker falls back to the global broker; update the outdated T204 inert-runner assertion to require recorded broker-only commands. | REPAIR |
| 2026-08-02 | 16 | REPAIR -> VERIFY | T227R1 | 1007/1007 twice after the broker threading and test update. | VERIFY |
| 2026-08-02 | 16 | VERIFY -> REVIEW | T227R1 | Recorded commands now cover survey/enumerate; only rg/git with shell:false. | REVIEW |
| 2026-08-02 | 16 | REVIEW -> CHECKPOINT | T227 | G15 accepted. | CHECKPOINT |
| 2026-08-02 | 16 | CHECKPOINT -> SELECT | T228 | G16 ready: SKILL documentation and final acceptance. | SELECT |
| 2026-08-02 | 16 | SELECT -> DISPATCH | T228 | Dispatch documentation + final acceptance matrix. | DISPATCH |
| 2026-08-02 | 16 | DISPATCH -> INTEGRATE | T228 | SKILL.md rewritten; 21-test acceptance matrix and evidence record landed; 1007/1007. | INTEGRATE |
| 2026-08-02 | 16 | INTEGRATE -> VERIFY | T228 | Acceptance 21/21 (incl. env-gated real-repo smoke); full suite green twice. | VERIFY |
| 2026-08-02 | 16 | VERIFY -> REVIEW | T228 | Final correctness reviewer PASS (AC1-AC20 evidenced; only plan bookkeeping noted); final safety/voice reviewer PASS (zero findings). | REVIEW |
| 2026-08-02 | 16 | REVIEW -> CHECKPOINT | T228 | G16 accepted; completion gate verified by primary: 29/29 tasks complete, full suite 1007/1007, one-write/zero-dependency/read-only evidence, both final reviews PASS. | CHECKPOINT |
| 2026-08-02 | 16 | CHECKPOINT -> COMPLETE | all | Completion Review filled; plan marked complete. | COMPLETE |

## Repair Tasks

### T200R1 — Enforce standards metadata boundary
- Parent: T200
- Root cause: Registry entries could select `authored_mapping` without a proven reuse decision; free-form summaries and loose editions weakened copied-text and exact-version guarantees.
- Owned scope: `lib/scan/standards/policy.mjs`, `lib/scan/standards/registry.mjs`, `test/expansion-standards-policy.test.mjs`
- Acceptance: Registry records are metadata-only, contain no free-form control-like prose, bind a stable edition key to the ID and edition, reject floating editions, and retain deterministic immutable ordering.
- Signal: `node --test --test-concurrency=1 test/expansion-standards-policy.test.mjs`

### T201R1 — Make baseline constraints executable
- Parent: T201
- Root cause: Fixture/P0 inventories did not execute behavior, supersession guards were prose-only, and production subprocess additions were not constrained.
- Owned scope: `test/expansion-baseline.test.mjs`, `test/expansion-constraints.test.mjs`, `test/helpers/recording-runner.mjs`, `test/baselines/expansion/*`
- Acceptance: The gate executes five fixture pipelines and all 21 P0 tests, resolves every supersession entry to a current or replacement source assertion, rejects new direct child-process owners/prohibited process APIs/shell mode, inventories command options, and strengthens import/write source checks without changing production.
- Signal: `node --test --test-concurrency=1 test/expansion-baseline.test.mjs test/expansion-constraints.test.mjs test/fixtures-pipeline.test.mjs test/regression-parity.test.mjs`

### T200R2 — Bind edition qualifiers
- Parent: T200R1
- Root cause: Numeric matching did not bind recognized textual qualifiers and the floating-edition denylist omitted common labels.
- Owned scope: T200R1 files only.
- Acceptance: Recognized edition-key qualifiers are present in the exact edition; unknown qualifier tokens and current/latest/draft/unspecified/next/nightly/rolling/snapshot/provisional/preview/dev/head/trunk are rejected.
- Signal: T200 focused gate.

### T201R2 — Close lexical and supersession bypasses
- Parent: T201R1
- Root cause: Aliased writes, dynamic child-process imports, non-literal shell values, template interpolations, and inert named replacement tests could evade source gates.
- Owned scope: T201R1 files only.
- Acceptance: The dependency-free scanner preserves `${...}` code, rejects all fs mutation API references outside the sole explicit writer shape, rejects dynamic/non-named child-process ownership and any shell option, and supersession guards resolve to non-skipped test bodies containing exact assertion tokens.
- Signal: T201 executable 36-test gate.

### T201R3 — Replace blacklist gates with locked capabilities and behavior
- Parent: T201R2
- Root cause: Token blacklists cannot establish capability acquisition, exact legacy call shapes, or immutable behavior and produce unrelated-property false positives.
- Owned scope: T201 test/baseline files plus `test/fixtures-pipeline.test.mjs` for exporting the existing runner and complete semantic evidence; no production edits.
- Acceptance: Exact hash-locked legacy subprocess owners and `safeImport`; canonical direct named filesystem imports from a closed read allowlist plus one exact writer; no dynamic/namespace/default/aliased/re-exported/builtin-module acquisition; full canonical five-fixture semantic and Markdown hashes; digest-locked P0/fixture sources; stateful legacy/superseded records whose replacement tests belong to the recurring acceptance inventory.
- Deferred replacement evidence: Broker argv/read-only policy T208/T209; runtime declaration proof T209; canonical production pipeline and runtime sink-count proof T204/T224.
- Signal: T201 executable baseline command plus adversarial capability cases.

### T201R4 — Close named builtin acquisition
- Parent: T201R3
- Root cause: The capability gate rejected `process.getBuiltinModule` but not a named or aliased `getBuiltinModule` import from `node:process`.
- Owned scope: `test/expansion-constraints.test.mjs` only.
- Acceptance: Direct, named, and aliased executable `getBuiltinModule` forms fail the acquisition audit.
- Signal: T201 executable baseline command.

### T201R5 — Prohibit node:process imports
- Parent: T201R4
- Root cause: Valid string-named and Unicode-escaped imported identifiers can evade dependency-free identifier matching.
- Owned scope: `test/expansion-constraints.test.mjs` only.
- Acceptance: Any parsed or unparsed static `node:process` import and every dynamic form fails; existing global `process` reads remain available.
- Signal: T201 executable baseline command.

### T202R1 — Canonical registry-aware evidence contracts
- Parent: T202
- Root cause: Claim validation trusted shallow evidence and caller-provided status/coverage data without binding category, structured search/applicability facts, or the canonical dimension registry.
- Owned scope: T202 files only.
- Acceptance: Category and structured detail are identity-bound; evidence is canonically revalidated once under count/depth/node bounds with Proxy rejection; all statuses are mutually exclusive; search universes disclose inspected/limit/omitted counts; N/A evaluates structured facts against the registered predicate; inferred claims require a derivation ID and direct non-search inputs; claims belong to known expected claims; coverage requires registry expected IDs and validated status semantics; exact 16 IDs/order/provider flags and complete 14-dimension categories are enforced.
- Signal: T202 focused gate plus recurring T201 gate.

### T203R1 — Harden plugin regex and loader enumeration
- Parent: T203
- Root cause: Overlapping quantified regex atoms permit polynomial backtracking, and readdir materializes the plugin root before the count cap.
- Owned scope: `lib/scan/plugins/schema.mjs`, `lib/scan/plugins/loader.mjs`, `test/expansion-plugin-loader.test.mjs`.
- Acceptance: `*`/`+` quantified atoms whose character classes intersect any prior quantified atom (including `.` and digit/word/space overlaps) fail `REGEX_COMPLEXITY`; loader enumerates via opendir and stops at `PLUGIN_LIMITS.plugins + 1`; existing safe regexes and all positive cases remain accepted; sanitized errors persist.
- Signal: `node --test --test-concurrency=1 test/expansion-plugin-loader.test.mjs` plus recurring T201 gate.

### T206R1 — Fix serialization bound and privacy/path gaps
- Parent: T206
- Root cause: Whole-document serialization hits the 2048 string cap; percent-encoded traversal, forward-slash UNC, underscore secret labels, and read-after-containment TOCTOU evade primitives.
- Owned scope: `lib/scan/shared/artifacts.mjs`, `lib/scan/shared/privacy.mjs`, `test/expansion-artifact-privacy.test.mjs`.
- Acceptance: Evidence serialization round-trips at realistic list sizes with structured privacy assertion and an explicit large output bound; sanitized URLs reject encoded dot/slash segments; forward-slash absolute/UNC forms are redacted; `access_token`/`refresh_token`/`auth_token`/`session` and high-entropy labeled secrets are caught; bounded reads reopen with `O_NOFOLLOW` and re-verify device/inode/realpath against the earlier containment check.
- Signal: `node --test --test-concurrency=1 test/expansion-artifact-privacy.test.mjs` plus recurring T201 gate (report any changed fs import for capability reconciliation).

## Completion Review

Filled by `csm-build` after the completion gate. All 29 numbered tasks (T200-T228) plus repair sub-tasks are completed with recorded evidence, and every acceptance criterion AC1-AC20 has current executable evidence (mapped 1:1 by the T228 acceptance matrix in `test/expansion-final-acceptance.test.mjs` and the evidence record `.agents/docs/csm-scan-t228-final-acceptance-evidence.md`).

- Final authoritative suite: `node --test --test-concurrency=1` → 1007/1007 pass, 0 fail, 0 skipped (verified multiple times).
- Delivered: 16-dimension canonical pipeline (survey -> registry-driven deep scans -> provider/plugin/generic evidence merge -> enrich/validate with expected-claim coverage -> global cross-repo synthesis -> deterministic render -> one write); six new dimensions; architecture facts; cross-repo synthesis; declarative data-only plugin framework with generic fallback; sole static command broker (rg + read-only Git, zero target commands); six-status evidence contract with bounded absence; privacy primitives across all sinks; standards registry metadata-only; deterministic output; sanitized diagnostics; fail-before-write.
- Safety: one production `writeFile`; zero npm dependencies; zero target/runtime/build/test/deploy execution; read-only repository scanning; plugins are strict JSON data only; no copied control text; no verdicts.
- Final independent reviews: correctness reviewer PASS (no material gaps); safety/voice reviewer PASS (zero findings). All review findings across the build were triaged; every material finding was repaired with regression coverage and independently re-reviewed.
- Recorded non-blocking residuals: architecture graph-facts extension renderer remains a production-exported API not wired into the default architecture section (AC6 satisfied at API level); `survey.mjs` prints the scanning path directly but the CLI stdio guard redacts it; the frozen ten-dimension fixture pipeline is the integrity-locked reference (all new gates use the exported canonical pipeline); `findPruneArgs` is a vestigial dead helper referenced only by its own test.
- No commits were created (the skill directory is not a Git repository, per plan policy); nothing was pushed.
- The implementation matches the user's goal: a broader provenance-rich repository dossier preserving the neutral factual stance and safety guarantees of the original five-ecosystem scanner.
