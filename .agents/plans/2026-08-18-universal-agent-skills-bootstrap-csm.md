---
format: csm-plan/1
---

# Universal Agent Skills Bootstrap CSM Plan

**Supersedes:** `.agents/plans/2026-08-18-agent-agnostic-url-npx-bootstrap-csm.md` and, transitively, `.agents/plans/2026-08-17-agent-agnostic-installable-skills-csm.md` for this scope only. All prior plans remain unchanged historical artifacts. Execute at most one of these plans.

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 2 high (T001 remote trust, T002 executable package/payload), 3 standard (T003 universal agent protocol, T004 npx/offline boundary, T005 conformance/docs). T001-T002 require independent review.

## Control
- Plan ID: universal-agent-skills-bootstrap
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-18 — universal protocol design verified; prior plans protected
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none; support means protocol compatibility, not capabilities every agent lacks

## Goal
Make the collection usable by any capable AI agent through one URL containing agent-readable steps and a signed payload manifest. The agent reads the URL, works out its own Agent Skills discovery location and reload behavior, asks the user when that is ambiguous, and performs installation. No OpenCode, Claude, Pi, Codex, or other agent adapter is required. Any Node code is invoked only through exact-version `npx`; no Git clone, raw repository download, direct `node`/`npm install`, or URL-supplied shell is allowed. Offline operation is supported only when the exact npx package/cache has already been verified and warmed.

**Capability boundary:** an agent must be able to read HTTPS content, write skill files, and invoke exact `npx` commands. Agents lacking one of those capabilities receive a safe refusal or can use the URL as documentation manually; the plan does not claim universal runtime capability.

## Acceptance Criteria
1. One HTTPS URL returns a signed canonical `csm-bootstrap/2` envelope containing a payload manifest and concise Markdown steps. The signature covers the structured policy and the exact steps digest; steps are guidance, never executable policy.
2. The npm package is a reviewed, exact-version `npm pack` artifact with a fixed bin, no lifecycle scripts, no Git/URL/range dependencies, and a separate payload index for `SKILL.md` files, supporting files, helper bins, and hashes.
3. Any capable agent can follow the protocol: discover npx, determine a supported Agent Skills location, ask the user if the location or trust root is ambiguous, use the fixed package command, place only verified payload files, and report destination, hashes, reload action, and rollback limitations.
4. Machine checks reject unsigned/altered/expired/wrong-audience manifests, arbitrary shell or executable fields, traversal/links/special files/duplicates, floating package specs, missing or altered offline cache entries, and unverified payloads. Markdown is never executed.
5. Online warm-cache and offline replay use identical exact package/payload bytes. Offline uses `npx --offline --no` and fails closed when the cache is incomplete; no network fallback occurs.
6. The package never assumes an agent-specific destination, invocation syntax, reload mechanism, lock implementation, or transaction capability. Agent-dependent guarantees are reported as such; machine-verifiable payload hashes are always checked after placement.
7. Existing repository gates pass, all prior plans and unrelated artifacts remain unchanged, and no implementation starts during planning.

## Current-State Evidence
- `README.md:81-106` currently requires cloning/copying into an OpenCode directory; no universal bootstrap or root package exists.
- Agent Skills specification (`https://agentskills.io/specification`) defines the portable directory/`SKILL.md`/frontmatter contract but does not define installation destinations, reload, or invocation.
- OpenCode, Claude Code, and other clients may support the standard while differing in discovery and capabilities; no universal filesystem destination can be assumed.
- `csm-browse/package.json:4,10-15` is private, ranged, and Node `>=22 <25`; `csm-scan/scripts/scan.mjs:6-13` has a production closure; `csm-upload/scripts/upload.mjs:219-277` has external mutation behavior.
- npm npx docs state exact package execution and `--offline`; npm cache persistence is not guaranteed, and lifecycle scripts can execute unless suppressed.
- Prior plans are committed and protected; this plan is the only allowed new persistent artifact for this planning cycle.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | The deliverable is a universal protocol plus payload, not per-agent adapters | user-directed | user wants the agent to work out its own installation | decided |
| D2 | The URL envelope contains signed canonical JSON plus a digest-bound concise Markdown `steps` field | design | JSON carries machine policy; Markdown provides agent-readable procedure without expanding policy | decided |
| D3 | A fixed, user-approved bootstrap package/trusted key is required; a URL cannot safely bootstrap an unknown executable by itself | security | signature authenticates content, not the safety of an arbitrary executable selected by that content | decided |
| D4 | The agent chooses the destination and owns discovery/reload; the helper accepts an agent-chosen explicit path but never selects one from the URL | design | avoids false universal adapter claims | decided |
| D5 | Package contains neutral skills and helper bins as separate payload classes; helper execution is never implied by skill installation | supply-chain | keeps Markdown data distinct from executable code | decided |
| D6 | Offline support is conditional on a verified warm npm cache and exact Node/npm/platform metadata | operational | npm cache is not durable or portable by default | decided |
| D7 | Prior plans are superseded by this new file only; they are not edited, marked in place, or co-executed | concurrency | protects other sessions and historical evidence | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Does the standard define universal install behavior? | Agent Skills specification fetch and client documentation comparison | Read-only web retrieval | It defines payload format, not destinations/reload/capabilities | T003 makes discovery agent-owned and asks on ambiguity |
| R2 | Can a URL safely supply install instructions? | Independent threat-model critique | Read-only | Markdown/signatures can still prompt-inject; executable policy must be fixed outside prose | T001 signs canonical envelope and constrains steps to guidance |
| R3 | Can npx remain the only Node boundary? | Official npm npx docs plus local `npx --version` | No installs/cache mutation; Node 20.20.2/npm 10.8.2 observed | Exact package and `--offline --no` work; absent cache fails; package bin remains trusted executable | T002/T004 enforce exact package/bin and offline tests |
| R4 | What can be guaranteed when the agent writes files? | Critique of installer/agent ownership split | Read-only | Agent capabilities determine locking, staging, rollback, and reload; helper can verify payload but cannot promise host semantics | T003 separates machine guarantees from agent-reported guarantees |
| R5 | How should payload be delivered without repository download? | Runtime closure/package census | Read-only | Single npm package can contain skills, supporting files, helper bins, and hashes | T002 defines separate payload index and pack audit |
| R6 | Can this planning amendment affect other sessions? | Git status, prior-plan reads, tmux inspection | No writes/signals/config changes | Prior plans and active sessions exist outside this plan | Only this plan path may be created; all prior plan hashes remain protected |

## Discovered Requirements
- “Any agent” must be qualified as any agent that can read the URL, write files, and invoke npx; unsupported capabilities cause refusal, not guessed fallbacks.
- Trust root must be established before the URL chooses anything executable: preinstalled trusted bootstrap skill, user-approved fixed package/key, or agent-native trusted mechanism.
- The signed envelope must include schema/version, expiry, audience, key fingerprint, algorithm, payload release, exact package/bin/version/integrity, payload file list/modes/hashes, steps digest, and offline cache requirements.
- Markdown steps cannot add commands, package names, paths, permissions, or policy beyond the signed structured fields; code blocks and links are explanatory only.
- Agent-owned destination handling must require capability discovery, explicit user confirmation when ambiguous, path/symlink checks, post-write hashes, and a report of whether staging/locking/rollback/reload were actually available.
- Package release validation must reject lifecycle scripts, Git/URL/range dependencies, dynamic loading, undeclared files, ambiguous bins, and helper/payload mixing.
- Offline tests must record Node/npm/platform, exact package tarball integrity, cache manifest, and failure for missing metadata, missing tarball, altered bytes, or cache/registry mismatch.
- Skill Markdown and helper bins are distinct trust domains; installing Markdown never invokes a helper.

## Design
The URL returns an envelope with structured fields and a digest-bound `steps_markdown` field. The agent first confirms that it trusts the fixed bootstrap package/key, then reads the steps as guidance. The steps tell it to discover its own Agent Skills format support and destination, ask the user if uncertain, invoke the fixed npx package, and place verified files. The URL cannot select an executable, shell command, arbitrary destination, or fallback tool.

The package has four separate sections: neutral skill payload (`SKILL.md` plus declared supporting files), optional runtime helper bins, manifest/verification metadata, and the fixed bootstrap bin. The helper can validate and materialize verified payload files into an agent-chosen staging path, but the agent owns final placement, discovery, reload, and host transaction behavior. Post-placement hashes are mandatory. No helper executes `SKILL.md`.

The protocol is capability-based rather than adapter-based. It does not name OpenCode, Claude, Pi, Codex, or any other client in the execution contract. It documents the Agent Skills standard and asks the invoking agent to apply its own host knowledge. Agents without npx or file access stop safely and report the missing capability. Offline invocation uses the same exact npx package and `--offline --no`; missing cache is an explicit failure, never a network fallback.

## Execution Graph
- Wave 1: T001 universal envelope, signature, steps boundary, and trust root.
- Wave 2: T002 package/payload closure and exact npx bin after T001.
- Wave 3: T003 agent-owned discovery/materialization protocol after T001/T002.
- Wave 4: T004 offline/helper boundary after T002 ∥ T003 protocol fixtures (separate scopes).
- Wave 5: T005 generic conformance tests, docs, and final gates after T003/T004.
- Critical path: T001 -> T002 -> T003 -> T005.
- No task modifies any prior plan, `.agents/README.md`, active hooks, or other session artifacts.

## Numbered Plan
1. [pending] Define the universal signed bootstrap envelope and guidance boundary
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (remote trust and prompt injection)
   - Owned scope: envelope schema, canonicalization/signature verifier, trust-root policy, steps digest/boundary fixtures
   - Not in scope: agent adapters, fixed destinations, package publication, arbitrary shell, Markdown execution, prior plans
   - Spike candidate: validate canonical JSON plus embedded Markdown fixtures with changed key order/whitespace, altered steps, unknown key, expired key, wrong audience, redirect, oversized response, and shell-bearing fields in a new mode-700 `/tmp` sandbox
   - Actions: require bounded HTTPS retrieval; verify origin/redirect/content limits; define supported signature algorithm, key fingerprint source, expiry/rotation/revocation behavior; sign structured policy and exact steps digest; restrict command objects to fixed package/bin/version and structured argv schema; reject executable/path/package/shell fields from URL; preserve Markdown as guidance only
   - Acceptance signal: `npx --offline --no --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap validate-envelope <fixture>` accepts the valid fixture and rejects each malformed, altered, expired, wrong-audience, unsigned, redirect, oversized, and shell-bearing fixture
   - Validation: canonicalization idempotence, signature report, unknown-key rejection, no external mutation, original-plan hash comparison
   - Acceptance evidence: schema, key policy, valid/invalid fixture transcript, and prompt-injection boundary report
   - Repair attempts: 0
   - Recovery note: discard only temporary fixtures; never make a prior plan or real home the fixture destination

2. [pending] Package the neutral skills and exact npx helper boundary
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (executable supply chain and payload integrity)
   - Owned scope: npm package manifest/bin, skill payload index, helper separation, packed-artifact audit, provenance/integrity metadata
   - Not in scope: agent-specific destinations, raw repository downloads, Git/URL/range dependencies, lifecycle scripts, direct Node execution, real publishing during tests
   - Spike candidate: `npm pack` in an isolated source copy; if runtime closure cannot be packaged without unsafe dependencies, split helper bins or bundle the complete closure and record the decision
   - Actions: publish exact-version package with fixed bin; include neutral `SKILL.md` payload/supporting files separately from helper bins; record every path, mode, size, hash, license, and runtime requirement; reject lifecycle scripts, Git/URL/range/optional unknown dependencies, dynamic source loading, undeclared packed files, and ambiguous bins; test packed tarball, not source
   - Acceptance signal: isolated `npm pack --json` plus package audit exits 0 only for the expected deterministic tarball, payload index, fixed bin, no lifecycle scripts, and exact dependency policy; two packs produce identical payload hashes
   - Validation: unpack to disposable path; run fixed bin through exact npx; verify all eight skill names/frontmatter and no `.git`/`.agents`/tests/fixtures/raw checkout
   - Acceptance evidence: tarball/integrity/provenance, payload index, dependency/license report, and reproducibility transcript
   - Repair attempts: 0
   - Recovery note: discard only temporary package outputs; no publication until all audits pass

3. [pending] Define the agent-owned discovery and materialization protocol
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G3
   - Risk: standard (host capability and user-file writes)
   - Owned scope: agent-neutral steps, capability questionnaire, helper materialization interface, post-write verification/report schema
   - Not in scope: OpenCode/Claude/Pi/Codex adapters, hardcoded destinations, claimed universal reload/rollback, arbitrary URL paths, executing Markdown, or direct source download
   - Spike candidate: synthetic agents with combinations of npx/no-npx, standard/no-standard, writable/non-writable destination, and staging/no-staging capabilities; run only in mode-700 sandboxes
   - Actions: define steps: establish trust; discover npx; discover Agent Skills support and destination; ask user if ambiguous; invoke fixed npx bin with agent-chosen path; verify hashes; place files using best available staging/lock/backup; report final path, skill hashes, reload action, rollback capability, and limitations; refuse safely when capabilities are absent
   - Acceptance signal: generic protocol harness passes capable-agent, ambiguous-destination, no-npx, no-write, unsupported-format, malicious-steps, and post-write hash cases; no case invokes a URL-supplied executable or Markdown
   - Validation: path-with-spaces, destination symlink/traversal, duplicate names, existing modified files, interrupted agent write, and user-confirmation transcript
   - Acceptance evidence: protocol state traces, final reports, capability/refusal matrix, and payload tree hashes
   - Repair attempts: 0
   - Recovery note: agent reports incomplete transaction and preserves prior files when host staging is unavailable; helper never claims atomicity it did not perform

4. [pending] Enforce exact npx runtime and offline-cache behavior
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G4
   - Risk: standard (cache and runtime boundary)
   - Owned scope: helper command grammar, cache manifest/verifier, runtime invocation docs and fixtures
   - Not in scope: npm install, direct node/npm commands, floating specs, lifecycle dependencies, Docker/Git/gh setup, real external services
   - Spike candidate: warm a fresh disposable cache, disable network, replay; remove metadata/tarball or alter bytes and confirm nonzero failure
   - Actions: allow only exact package/version/bin/structured args; require `--ignore-scripts`; require `npx --offline --no` offline; record Node/npm/platform and all integrities; reject tags/ranges/Git/URL specs, missing bins, altered cache, and fallback commands; keep helpers optional and never auto-invoked by skill installation
   - Acceptance signal: `NPM_CONFIG_CACHE=<cache> npx --offline --no --ignore-scripts --no-audit --no-fund --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap offline-check <manifest>` succeeds only for a verified cache and fails for each missing/altered cache fixture without network access
   - Validation: online/offline identical payload; cold-cache failure; exact-version negative controls; no project `node_modules`, shell, Git, Docker, or gh writes
   - Acceptance evidence: cache manifest, `npm cache verify`, replay/failure transcripts, and side-effect audit
   - Repair attempts: 0
   - Recovery note: remove only disposable caches and homes; never modify the user cache during tests

5. [pending] Add generic conformance tests, documentation, and final gates
   - Task ID: T005
   - Depends on: T003, T004
   - Parallel group: G5
   - Risk: standard (public protocol and regression coverage)
   - Owned scope: protocol/package tests, README installation guidance, generic agent evidence template, final protected-state checks
   - Not in scope: client adapters, agent-specific claims, prior-plan edits, CI/release hosting, external repositories, live credentials
   - Spike candidate: run two online/offline cycles with synthetic agent capability profiles; if any test uses repository destination or real home, stop as safety failure
   - Actions: document one URL flow, trust-root prerequisite, agent capability discovery, user-question path, exact npx command, offline warm-cache/replay, payload verification, helper separation, and limits; add malicious envelope/steps/payload, unsupported capability, duplicate, profile ambiguity, and post-write hash fixtures; keep standard validation and existing suite gates
   - Acceptance signal: `node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check` plus the generic protocol/package test command exits 0; all prior plans are byte-identical and the final report contains destination/hash/reload evidence or a safe refusal
   - Validation: Agent Skills validator, packed artifact audit, scan/browse syntax/self-check, upload dry-run, protected Git status/hash, cheapest-first
   - Acceptance evidence: final command matrix, envelope/package/payload hashes, synthetic-agent traces, offline transcripts, and protected-state report
   - Repair attempts: 0
   - Recovery note: resume from the last package/cache/protocol checkpoint; remove only task-owned disposable outputs

## Verification Strategy
- Fast gates: envelope schema/signature, package bin/lifecycle/dependency audit, payload index, syntax, and existing conformance.
- Package gates: deterministic `npm pack`, packed-tarball npx execution, exact integrity/provenance, and payload hash verification.
- Protocol gates: synthetic capability matrix, user-question/refusal behavior, safe destination validation, post-write hashes, and explicit transaction limitations.
- Offline gates: verified cache replay with `npx --offline --no`, missing/altered cache failures, exact-version controls, and no network fallback.
- Final gates: Agent Skills validation, existing repository checks, runtime syntax/self-checks, generic agent evidence, and protected prior-plan verification. No real agent or external service is required to claim protocol conformance.

## Risks And Recovery
- Trust-root confusion: require preinstalled/user-approved fixed package/key or safe refusal; a URL cannot choose its own executable trust root.
- Prompt injection: signed JSON policy and steps digest; Markdown, links, and skill bodies remain untrusted guidance.
- Agent capability variance: capability discovery and explicit questions/refusals; never guess destinations or fall back to direct Node/download commands.
- Cache loss/poisoning: exact versions, cache manifest, `npm cache verify`, integrity checks, and offline fail-closed behavior.
- Host write failures: distinguish helper-verifiable hashes from agent-dependent staging/locking/rollback/reload; report limitations and preserve prior files when possible.
- Payload tampering: per-file hashes, safe relative paths/types, duplicate/link/special-file rejection, and post-write verification.
- Concurrent planning: prior plans, sessions, hooks, indexes, and other artifacts are protected; only this plan is created.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| “Any agent” was contradicted by fixed profiles/adapters | blocker | Removed all agent-specific profiles/smoke tests; protocol uses capability discovery and user questions | critique; D1/D4 |
| URL had no trust root | blocker | Require preinstalled/user-approved fixed package/key or safe refusal | D3, T001 |
| Agent-owned discovery conflicted with fixed installer semantics | blocker | Agent chooses destination/reload/host transaction; helper only materializes/verifies | T003 |
| JSON-only omitted requested steps | major | Signed canonical envelope includes digest-bound Markdown guidance; guidance cannot expand policy | D2, T001 |
| Payload/helper delivery was ambiguous | major | Separate payload index classes for skills, helpers, metadata, and fixed bin | T002 |
| Rollback/atomicity claims exceeded agent control | major | Split machine-verifiable guarantees from agent-reported capabilities and limitations | T003 |
| Tests proved adapters instead of universality | major | Replace with synthetic capability/conformance matrix and safe refusal cases | T003/T005 |
| Offline cache validation was weak | major | Add Node/npm/platform/cache manifest and missing metadata/tarball/altered bytes cases | T004 |
| npx grammar was underspecified | major | Fixed package/bin/version plus structured argv; reject shell and URL-selected executables | T001/T004 |
| Key lifecycle was missing | medium | Add fingerprint source, algorithm, expiry, rotation, revocation, and unknown-key refusal | T001 |
| Prior plans could be modified/co-executed | medium | New superseding artifact explicitly protects prior files and prohibits co-execution | D7 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-18 | 0 | INTAKE -> DISCOVER | none | Prior URL/npx plan found; user changed scope from adapters to universal agent protocol; prior plans protected | RESEARCH |
| 2026-08-18 | 0 | RESEARCH | none | Agent Skills standard, npm/npx behavior, URL trust, payload boundaries, and agent capability variance reviewed | DRAFT |
| 2026-08-18 | 0 | DRAFT -> CRITIQUE | none | Universal protocol draft created with agent-owned destination/discovery and npx-only helper boundary | CRITIQUE |
| 2026-08-18 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Removed fixed adapters, added trust root, signed JSON+steps, payload index, capability/refusal matrix, and honest rollback guarantees | SAVED |

## Completion Review
Filled by csm-build only after all acceptance criteria have observed evidence.
