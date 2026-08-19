---
format: csm-plan/1
---

# Universal Agent Skills Bootstrap CSM Plan

**Supersedes:** `.agents/plans/2026-08-18-agent-agnostic-url-npx-bootstrap-csm.md` and, transitively, `.agents/plans/2026-08-17-agent-agnostic-installable-skills-csm.md` for this scope only. Prior plans retain their implementation content but are now explicitly closed as superseded without execution. Execute at most one of these plans.

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 4 high (T001 remote trust, T002 executable package/payload, T003 universal agent protocol, T004 npx/offline boundary), 1 standard (T005 conformance/docs). T001-T004 require independent review before dependents can dispatch.

## Control
- Plan ID: universal-agent-skills-bootstrap
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 3
- Commits: allowed
- Last checkpoint: 2026-08-19 cycle 4 — recovered from concurrent-agent interference: another session built a duplicate branch `push-my-work` (cherry-picked history + its own plan) while this session was between T001 and T002; main retained the complete original line and was re-verified (T001 2/2, check-suite 434, sync/matrix clean); T002 partial owned files survived untracked and remain salvageable; `push-my-work` left untouched for the user to delete
- Next transition: SELECT -> DISPATCH (T002)
- Active tasks: none
- Blockers: none; support means protocol compatibility, not capabilities every agent lacks

## Goal
Make the collection usable by any capable AI agent through one URL containing agent-readable steps and a signed payload manifest. The agent reads the URL, works out its own Agent Skills discovery location and reload behavior, asks the user when that is ambiguous, and performs installation. No OpenCode, Claude, Pi, Codex, or other agent adapter is required. Any Node code is invoked only through exact-version `npx`; no Git clone, raw repository download, direct `node`/`npm install`, or URL-supplied shell is allowed. Offline operation is supported only when the exact npx package/cache has already been verified and warmed.

**Capability boundary:** an agent must be able to read HTTPS content, write skill files, and invoke exact `npx` commands. Agents lacking one of those capabilities receive a safe refusal or can use the URL as documentation manually; the plan does not claim universal runtime capability.

## Acceptance Criteria
1. The committed bootstrap fixture and release layout serve a signed canonical `csm-bootstrap/2` envelope over a local HTTPS test server; the envelope contains a payload manifest and concise Markdown steps. The signature covers the structured policy and exact steps digest; steps are guidance, never executable policy.
2. The package is a reviewed `npm pack` artifact named `@jamiemills/csm-skills-bootstrap`, with fixed version `0.1.0` for the first build fixture, a fixed bin, no lifecycle scripts, no Git/URL/range dependencies, and a separate payload index for `SKILL.md` files, supporting files, helper bins, and hashes. Publication is a later explicit release action, not part of the build.
3. Any capable agent can follow the protocol: discover npx, determine a supported Agent Skills location, ask the user if the location or trust root is ambiguous, use the fixed package command, place only verified payload files, and report destination, hashes, reload action, and rollback limitations.
4. Machine checks reject unsigned/altered/expired/wrong-audience/revoked-key manifests, arbitrary shell or executable fields, traversal/links/special files/duplicates, floating package specs, missing or altered offline cache entries, and unverified payloads. Markdown is never executed.
5. Online warm-cache and offline replay use identical exact package/payload bytes. Offline uses `npx --offline --no` and fails closed when the cache is incomplete; no network fallback occurs. Node/npm/platform and every cache tarball integrity are recorded.
6. The package never assumes an agent-specific destination, invocation syntax, reload mechanism, lock implementation, or transaction capability. Agent-dependent guarantees are reported as such; machine-verifiable payload hashes are always checked after placement.
7. Existing repository gates pass, prior plans retain their implementation content with only explicit closure metadata, unrelated artifacts remain unchanged, and no implementation starts during planning.

## Current-State Evidence
- `README.md:81-106` currently requires cloning/copying into an OpenCode directory; no universal bootstrap or root package exists.
- Agent Skills specification (`https://agentskills.io/specification`) defines the portable directory/`SKILL.md`/frontmatter contract but does not define installation destinations, reload, or invocation.
- OpenCode, Claude Code, and other clients may support the standard while differing in discovery and capabilities; no universal filesystem destination can be assumed.
- `csm-browse/package.json:4,10-15` is private, ranged, and Node `>=22 <25`; `csm-scan/scripts/scan.mjs:6-13` has a production closure; `csm-upload/scripts/upload.mjs:219-277` has external mutation behavior.
- npm npx docs state exact package execution and `--offline`; npm cache persistence is not guaranteed, and lifecycle scripts can execute unless suppressed.
- Build-time repository checks may use the existing Node commands (`node scripts/check-suite.mjs`, `node --check`, and test runners); the npx-only rule applies to delivered bootstrap/runtime behavior, never to repository development gates.
- Prior plans are committed and protected; this plan is the only allowed new persistent artifact for this planning cycle.
- Protected-plan pre-closure hashes: `2026-08-17-agent-agnostic-installable-skills-csm.md` = `f9479f89d761305a81fdace7a9b7ce5bb66f15d1420f8f2d227281bfabe89dd3`; `2026-08-18-agent-agnostic-url-npx-bootstrap-csm.md` = `808d568d12c1ed7408cf5554231d8a67ca2630e22327dc48b4ae909e0da56f09`. Closure-only hashes after the authorized metadata update: `29bae7bf6a890443b19927e57d7d728f98f117809ea565a5e004e4f11a09dcba` and `6068a74518cfba8c16d25755d07b5869fff76514ecaf5b2b844a5872dd5fb27d` respectively.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | The deliverable is a universal protocol plus payload, not per-agent adapters | user-directed | user wants the agent to work out its own installation | decided |
| D2 | The URL envelope contains signed canonical JSON plus a digest-bound concise Markdown `steps` field | design | JSON carries machine policy; Markdown provides agent-readable procedure without expanding policy | decided |
| D3 | A fixed, user-approved bootstrap package/trusted key is required; a URL cannot safely bootstrap an unknown executable by itself | security | signature authenticates content, not the safety of an arbitrary executable selected by that content | decided |
| D4 | The agent chooses the destination and owns discovery/reload; the helper accepts an agent-chosen explicit path but never selects one from the URL | design | avoids false universal adapter claims | decided |
| D5 | Package contains neutral skills and helper bins as separate payload classes; helper execution is never implied by skill installation | supply-chain | keeps Markdown data distinct from executable code | decided |
| D6 | Offline support is conditional on a verified warm npm cache and exact Node/npm/platform metadata | operational | npm cache is not durable or portable by default | decided |
| D7 | Prior plans are closed with explicit supersession metadata only; their implementation content is not rewritten and they are not co-executed | concurrency | preserves historical evidence while preventing stale dispatch | decided |
| D8 | First build fixture uses package `@jamiemills/csm-skills-bootstrap@0.1.0` and npm registry identity `https://registry.npmjs.org`; real publication requires a later explicit release action | planning decision | concrete acceptance commands need stable identities without performing external publication during build | decided |
| D9 | Build-time tests may invoke repository Node tooling; user-facing delivered Node behavior must use exact npx package bins and offline `--no` mode | scope decision | existing repository gates are authoritative development checks | decided |
| D10 | Universal protocol guarantees are divided into machine guarantees and agent-reported capabilities; no agent-specific adapter is promised | design decision | any agent may lack npx, writable skills path, staging, or reload semantics | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Does the standard define universal install behavior? | Agent Skills specification fetch and client documentation comparison | Read-only web retrieval | It defines payload format, not destinations/reload/capabilities | T003 makes discovery agent-owned and asks on ambiguity |
| R2 | Can a URL safely supply install instructions? | Independent threat-model critique | Read-only | Markdown/signatures can still prompt-inject; executable policy must be fixed outside prose | T001 signs canonical envelope and constrains steps to guidance |
| R3 | Can npx remain the only Node boundary? | Official npm npx docs plus local `npx --version` | No installs/cache mutation; Node 20.20.2/npm 10.8.2 observed | Exact package and `--offline --no` work; absent cache fails; package bin remains trusted executable | T002/T004 enforce exact package/bin and offline tests |
| R4 | What can be guaranteed when the agent writes files? | Critique of installer/agent ownership split | Read-only | Agent capabilities determine locking, staging, rollback, and reload; helper can verify payload but cannot promise host semantics | T003 separates machine guarantees from agent-reported guarantees |
| R5 | How should payload be delivered without repository download? | Runtime closure/package census | Read-only | Single npm package can contain skills, supporting files, helper bins, and hashes | T002 defines separate payload index and pack audit |
| R6 | Can this planning amendment affect other sessions? | Git status, prior-plan reads, tmux inspection | No signals/config changes; only explicit closure metadata is written to the two superseded plan files | Prior plans and active sessions exist outside this plan | Implementation tasks may not touch prior plans; closure metadata is the only authorized historical update |
| R7 | Can acceptance run before package publication? | Plan audit and npm command semantics | No package install/publication | Local packed artifact and local HTTPS fixture can validate the build; registry publication is not required | T001/T002 use disposable packed fixture; T005 excludes real publication |

## Discovered Requirements
- “Any agent” must be qualified as any agent that can read the URL, write files, and invoke npx; unsupported capabilities cause refusal, not guessed fallbacks.
- Trust root must be established before the URL chooses anything executable: preinstalled trusted bootstrap skill, user-approved fixed package/key, or agent-native trusted mechanism.
- The signed envelope must include schema/version, expiry, audience, key fingerprint, algorithm, payload release, exact package/bin/version/integrity, payload file list/modes/hashes, steps digest, and offline cache requirements.
- Markdown steps cannot add commands, package names, paths, permissions, or policy beyond the signed structured fields; code blocks and links are explanatory only.
- Agent-owned destination handling must require capability discovery, explicit user confirmation when ambiguous, path/symlink checks, post-write hashes, and a report of whether staging/locking/rollback/reload were actually available.
- Package release validation must reject lifecycle scripts, Git/URL/range dependencies, dynamic loading, undeclared files, ambiguous bins, and helper/payload mixing.
- Offline tests must record Node/npm/platform, exact package tarball integrity, cache manifest, and failure for missing metadata, missing tarball, altered bytes, or cache/registry mismatch.
- Skill Markdown and helper bins are distinct trust domains; installing Markdown never invokes a helper.
- T001 must be independently reviewed before T002 dispatch; T002 must be independently reviewed before T003; T003 before T004; T004 before T005. Review evidence is recorded in each task checkpoint.
- Every task has a single primary owner and exact file paths; cross-task tests are owned only by T005 under `tests/integration/`.
- A build checkpoint records task ID, commit, changed paths, command outputs, protected-plan hashes, review verdict, and the exact next task ID.
- T001 learnings for all remaining tasks: the trust validator currently lives only inside `tests/bootstrap-trust.test.mjs` with a frozen clock — T003/T005 must not assume an importable validator exists; the fixture Ed25519 private key is deliberately not committed, so signed fixture bytes are immutable (repairs must target validator/tests/unsigned files only); origin binding is hostname-only (port-insensitive) and `payload_release` is schema-declared but validator-unenforced — both accepted residuals, mitigated because every security-relevant field is signature-bound or rejected; pre-signature policy checks are deliberately ordered before signature verification to keep negative paths testable without a private key (fail-closed either way).

## Design
The URL returns an envelope with structured fields and a digest-bound `steps_markdown` field. The agent first confirms that it trusts the fixed bootstrap package/key, then reads the steps as guidance. The steps tell it to discover its own Agent Skills format support and destination, ask the user if uncertain, invoke the fixed npx package, and place verified files. The URL cannot select an executable, shell command, arbitrary destination, or fallback tool.

The package has four separate sections: neutral skill payload (`SKILL.md` plus declared supporting files), optional runtime helper bins, manifest/verification metadata, and the fixed bootstrap bin. The helper can validate and materialize verified payload files into an agent-chosen staging path, but the agent owns final placement, discovery, reload, and host transaction behavior. Post-placement hashes are mandatory. No helper executes `SKILL.md`.

The protocol is capability-based rather than adapter-based. It does not name OpenCode, Claude, Pi, Codex, or any other client in the execution contract. It documents the Agent Skills standard and asks the invoking agent to apply its own host knowledge. Agents without npx or file access stop safely and report the missing capability. Offline invocation uses the same exact npx package and `--offline --no`; missing cache is an explicit failure, never a network fallback.

## Execution Graph
- Wave 1: T001 universal envelope, signature, steps boundary, and trust root; independent review required.
- Wave 2: T002 package/payload closure and exact npx bin after T001 review; independent review required.
- Wave 3: T003 agent-owned discovery/materialization protocol after T002 review; independent review required.
- Wave 4: T004 offline/helper boundary after T003 review; independent review required.
- Wave 5: T005 generic conformance tests, docs, and final gates after T004 review; primary verification remains outside T005.
- Critical path: T001 -> review -> T002 -> review -> T003 -> review -> T004 -> review -> T005 -> primary final verification.
- No parallel implementation groups: each task owns a distinct path set and depends on the prior reviewed checkpoint. This deliberate serialization avoids shared package/protocol/test ownership collisions.
- No implementation task modifies any prior plan, `.agents/README.md`, active hooks, or other session artifacts; only this planning closure may update the two superseded plans' Control/Closure/task-status metadata.

## Build Execution Contract
- `RECOVER` reads Control, the latest checkpoint, Git status, protected-plan hashes, and task evidence; it selects the first pending task whose dependencies and review gate are satisfied.
- `VALIDATE` runs the selected task's spike and fast acceptance prerequisites in disposable state; failure leaves the task `blocked` with evidence.
- `SELECT` chooses only pending tasks with completed dependencies and recorded independent review; no parallel dispatch is permitted in this plan.
- `DISPATCH` assigns one task to one worker with its owned paths and anti-scope; the task becomes `in_progress` only at dispatch.
- `INTEGRATE` accepts only owned-path changes and records the commit, changed paths, and protected-state comparison.
- `VERIFY` runs the task acceptance signal and supporting validation; `REVIEW` obtains the required independent review for T001-T004.
- `REPAIR` increments only the affected task's repair count and returns it to `VERIFY`; `CHECKPOINT` records evidence and selects the next dependency-ready task.
- A task is `completed` only after its acceptance signal, evidence, and review gate pass. `T005` never marks the plan complete; the primary final gate updates Control and Completion Review.

## Numbered Plan
1. [completed] Define the universal signed bootstrap envelope and guidance boundary
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (remote trust and prompt injection)
   - Owned scope: `bootstrap/schema.json`, `bootstrap/keyring.json`, `bootstrap/fixtures/**`, `bootstrap/steps.md`, `tests/bootstrap-trust.test.mjs`
   - Not in scope: agent adapters, fixed destinations, package publication, arbitrary shell, Markdown execution, prior plans
   - Spike candidate: validate canonical JSON plus embedded Markdown fixtures with changed key order/whitespace, altered steps, unknown key, expired key, wrong audience, redirect, oversized response, and shell-bearing fields in a new mode-700 `/tmp` sandbox
   - Actions: require bounded HTTPS retrieval; verify origin/redirect/content limits; define supported signature algorithm, key fingerprint source, expiry/rotation/revocation behavior; sign structured policy and exact steps digest; restrict command objects to fixed package `@jamiemills/csm-skills-bootstrap@0.1.0`, fixed bin `csm-skills-bootstrap`, and structured argv schema; reject executable/path/package/shell fields from URL; preserve Markdown as guidance only; add a local HTTPS fixture server used only by the test harness
   - Acceptance signal: `node --test tests/bootstrap-trust.test.mjs` accepts the committed valid local HTTPS fixture and rejects malformed, altered, expired, wrong-audience, unknown/revoked-key, unsigned, redirect, oversized, and shell-bearing fixtures; expected result is all tests pass
   - Validation: canonicalization idempotence, signature report, unknown-key rejection, no external mutation, original-plan hash comparison
   - Acceptance evidence: schema, key policy, valid/invalid fixture transcript, local HTTPS retrieval transcript, and prompt-injection boundary report; recorded 2026-08-18 — `node --test tests/bootstrap-trust.test.mjs` 2/2 pass covering 21 rejection cases across 19 codes (SCHEMA, UNEXPECTED_FIELD, CONTENT_TOO_LARGE, WRONG_AUDIENCE, EXPIRED, ORIGIN, UNKNOWN_KEY, REVOKED_KEY, ALGORITHM, FINGERPRINT, KEY_EXPIRED, STEPS_DIGEST, PACKAGE_POLICY, SHELL_POLICY, UNSIGNED, BAD_SIGNATURE, REDIRECT, MALFORMED, HTTP_STATUS); check-suite 434 green; independent review APPROVED (fresh reviewer; first dispatch returned empty — journalled, re-dispatched narrowed)
   - Repair attempts: 1
   - Recovery note: discard only temporary fixtures; never make a prior plan or real home the fixture destination
   - Review gate: independent reviewer signs off T001 before T002 is selectable

2. [in_progress] Package the neutral skills and exact npx helper boundary
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (executable supply chain and payload integrity)
   - Owned scope: `bootstrap/package.json`, `bootstrap/package/**`, `bootstrap/payload-index.json`, `scripts/pack-bootstrap.mjs`, `tests/package-audit.test.mjs`
   - Not in scope: agent-specific destinations, raw repository downloads, Git/URL/range dependencies, lifecycle scripts, direct Node execution, real publishing during tests
   - Spike candidate: `npm pack` in an isolated source copy; if runtime closure cannot be packaged without unsafe dependencies, split helper bins or bundle the complete closure and record the decision
   - Actions: build exact-version package `@jamiemills/csm-skills-bootstrap@0.1.0` with fixed bin; include neutral `SKILL.md` payload/supporting files separately from helper bins; record every path, mode, size, hash, license, and runtime requirement; reject lifecycle scripts, Git/URL/range/optional unknown dependencies, dynamic source loading, undeclared packed files, and ambiguous bins; test packed tarball, not source; do not publish during this task
   - Acceptance signal: `node --test tests/package-audit.test.mjs` runs isolated `npm pack --json` twice and passes only when the tarballs/payload hashes match, the fixed bin is present, no lifecycle scripts or forbidden dependencies exist, and all eight skill payloads are declared
   - Validation: unpack to disposable path; run `NPM_CONFIG_CACHE=<tmp-cache> npx --yes --ignore-scripts --no-audit --no-fund --package=@jamiemills/csm-skills-bootstrap@0.1.0 csm-skills-bootstrap --version` against the packed fixture registry/cache; verify no `.git`/`.agents`/tests/fixtures/raw checkout
   - Acceptance evidence: tarball/integrity/provenance fixture, payload index, dependency/license report, and reproducibility transcript
   - Repair attempts: 0
   - Recovery note: discard only temporary package outputs; no publication until all audits pass
   - Review gate: independent reviewer signs off T002 before T003 is selectable

3. [pending] Define the agent-owned discovery and materialization protocol
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G3
   - Risk: standard (host capability and user-file writes)
   - Owned scope: `bootstrap/protocol.md`, `bootstrap/agent-report.schema.json`, `tests/protocol/**`
   - Not in scope: OpenCode/Claude/Pi/Codex adapters, hardcoded destinations, claimed universal reload/rollback, arbitrary URL paths, executing Markdown, or direct source download
   - Spike candidate: synthetic agents with combinations of npx/no-npx, standard/no-standard, writable/non-writable destination, and staging/no-staging capabilities; run only in mode-700 sandboxes
   - Actions: define exact protocol states `DISCOVER -> TRUST -> PLAN_DESTINATION -> CONFIRM_IF_NEEDED -> MATERIALIZE -> VERIFY -> REPORT`; define capability input, refusal codes, user-confirmation points, agent-chosen path rules, post-write hash report, reload field, and staging/lock/rollback availability fields; make helper materialize only verified relative payload into an agent-chosen staging path; prohibit URL-supplied executable/path/shell and Markdown execution
   - Acceptance signal: `node --test tests/protocol/*.test.mjs` passes capable-agent, ambiguous-destination, no-npx, no-write, unsupported-format, malicious-steps, destination-symlink, interrupted-write, and post-write-hash cases; each refusal has a documented nonzero code and no payload mutation
   - Validation: path-with-spaces, destination symlink/traversal, duplicate names, existing modified files, interrupted agent write, and user-confirmation transcript
   - Acceptance evidence: protocol state traces, final reports, capability/refusal matrix, and payload tree hashes
   - Repair attempts: 0
   - Recovery note: agent reports incomplete transaction and preserves prior files when host staging is unavailable; helper never claims atomicity it did not perform
   - Review gate: independent reviewer signs off T003 before T004 is selectable

4. [pending] Enforce exact npx runtime and offline-cache behavior
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G4
   - Risk: standard (cache and runtime boundary)
   - Owned scope: `bootstrap/cache-manifest.schema.json`, `bootstrap/runtime-commands.json`, `tests/offline/**`
   - Not in scope: runtime `npm install` or direct Node execution, floating specs, lifecycle dependencies, Docker/Git/gh setup, real external services; repository test runners used to validate this task are build-time gates under D9
   - Spike candidate: warm a fresh disposable cache, disable network, replay; remove metadata/tarball or alter bytes and confirm nonzero failure
   - Actions: allow only exact package/version/bin/structured args; require `--ignore-scripts`; require `npx --offline --no` offline; record Node/npm/platform and every package tarball integrity; reject tags/ranges/Git/URL specs, missing bins, altered cache, and fallback commands; keep helpers optional and never auto-invoked by skill installation; define clean-cache warm-up and network-denial test harness
   - Acceptance signal: `node --test tests/offline/*.test.mjs` passes warm-cache replay with `@jamiemills/csm-skills-bootstrap@0.1.0` and fails for missing metadata, missing tarball, altered bytes, changed npm/platform, and floating-version fixtures; expected result is all pass/fail assertions green with zero network fallback
   - Validation: test harness records `npm cache verify`, compares online/offline payload/tree hashes, uses isolated `HOME/TMPDIR/NPM_CONFIG_CACHE`, and proves no project `node_modules`, shell, Git, Docker, or gh writes
   - Acceptance evidence: cache manifest, `npm cache verify`, replay/failure transcripts, and side-effect audit
   - Repair attempts: 0
   - Recovery note: remove only disposable caches and homes; never modify the user cache during tests
   - Review gate: independent reviewer signs off T004 before T005 is selectable

5. [pending] Add generic conformance tests, documentation, and final gates
   - Task ID: T005
   - Depends on: T003, T004
   - Parallel group: G5
   - Risk: standard (public protocol and regression coverage)
   - Owned scope: `tests/integration/**`, root `README.md` installation/requirements/development sections, `bootstrap/release-checklist.md`; `.agents/**` is protected
   - Not in scope: client adapters, agent-specific claims, prior-plan edits, CI/release hosting, external repositories, live credentials, `.agents/**`, or final Control/Completion Review updates
   - Spike candidate: run two online/offline cycles with synthetic agent capability profiles; if any test uses repository destination or real home, stop as safety failure
   - Actions: document one URL flow, trust-root prerequisite, agent capability discovery, user-question path, exact npx command, offline warm-cache/replay, payload verification, helper separation, and limits; add only cross-task integration tests under `tests/integration/**`; keep `.agents/**` and prior plans untouched; reserve final completion review for the primary planning/build orchestrator
   - Acceptance signal: `node --test tests/integration/*.test.mjs` passes, then `node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check` exits 0; final protected-state assertion proves prior plans match their recorded closure-only hashes and no other prior artifact changed
   - Validation: Agent Skills validator, packed artifact audit, scan/browse syntax/self-check, upload dry-run, protected Git status/hash, cheapest-first; T005 does not mark the plan complete
   - Acceptance evidence: final command matrix, envelope/package/payload hashes, synthetic-agent traces, offline transcripts, README diff limited to root `README.md`, and protected-state report
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
| Prior plans could be modified/co-executed | medium | Prior plans now carry explicit closure metadata only; implementation remains prohibited and the universal plan is the sole executable plan | D7, Closure sections |
| T001 acceptance depended on a not-yet-created placeholder package | blocker | T001 now uses committed local HTTPS fixtures and repository build-time tests; package execution starts in T002 | T001 acceptance signal |
| Package identity and publication were unresolved | blocker | Fixed first-build identity to `@jamiemills/csm-skills-bootstrap@0.1.0`; publication explicitly deferred | D8, T002 |
| No HTTPS deliverable was testable | blocker | Added committed bootstrap fixture plus local HTTPS test server; real hosting remains outside build | AC1, T001 |
| Task graph contradicted T004 dependencies | major | Graph is now fully serial: T001 review -> T002 review -> T003 review -> T004 review -> T005 | Execution Graph |
| Test ownership overlapped across tasks | major | Exact paths assigned; T005 owns only `tests/integration/**`; prior task tests stay task-owned | task Owned scope |
| Independent review had no dispatch gate | major | T001-T004 each have explicit review gates and dependency selection rule | Build Execution Contract |
| Recovery/checkpoint semantics were vague | major | Added RECOVER through CHECKPOINT contract and required checkpoint contents | Build Execution Contract, Discovered Requirements |
| Runtime npx rule conflicted with build-time Node tests | major | D9 explicitly separates repository development gates from delivered runtime behavior | D9, T004 Not in scope |
| Final verification was ambiguously delegated to T005 | medium | T005 cannot mark completion; primary owns final Control and Completion Review | T005 scope and Build Execution Contract |
| Root README versus `.agents/README.md` was ambiguous | medium | T005 names root `README.md`; `.agents/**` is protected | T005 Owned scope |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-18 | 0 | INTAKE -> DISCOVER | none | Prior URL/npx plan found; user changed scope from adapters to universal agent protocol; prior plans protected | RESEARCH |
| 2026-08-18 | 0 | RESEARCH | none | Agent Skills standard, npm/npx behavior, URL trust, payload boundaries, and agent capability variance reviewed | DRAFT |
| 2026-08-18 | 0 | DRAFT -> CRITIQUE | none | Universal protocol draft created with agent-owned destination/discovery and npx-only helper boundary | CRITIQUE |
| 2026-08-18 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Removed fixed adapters, added trust root, signed JSON+steps, payload index, capability/refusal matrix, and honest rollback guarantees | SAVED |
| 2026-08-18 | 1 | VERIFY -> CRITIQUE | none | Independent build-readiness audits found circular T001 package gate, placeholder identity, missing HTTPS fixture, contradictory T004 graph, overlapping ownership, and incomplete checkpoint/review rules | REMEDIATE |
| 2026-08-18 | 1 | REMEDIATE -> VERIFY -> SAVED | none | Fixed package identity, local HTTPS fixture, exact owned paths, serial reviewed dependency chain, build execution contract, build-time/runtime boundary, and final-primary ownership; implementation not started | SAVED |
| 2026-08-18 | 2 | CLOSE-SUPERSEDED-PLANS -> VERIFY | none | Closed T001-T006 in the 2026-08-17 plan and T001-T005 in the 2026-08-18 URL/npx plan without execution; retained implementation content and updated only closure metadata | SAVED |
| 2026-08-18 | 3 | NOT_STARTED -> RECOVER | none | Explicit csm-build request received; target plan selected; no target implementation files or partial task commits found; unrelated `.agents/plans/2026-08-18-remaining-suite-work-csm.md` remains untracked and out of scope | VALIDATE |
| 2026-08-18 | 3 | RECOVER -> VALIDATE -> SELECT | none | Baseline gates pass: check-suite 434, boilerplate sync clean, README matrix clean; ready set contains only T001 because all later tasks require prior implementation plus independent review | DISPATCH (T001) |
| 2026-08-18 | 3 | DISPATCH (T001) -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> VERIFY -> REVIEW -> CHECKPOINT | T001 | Implemented schema/keyring/fixtures/steps + trust test; acceptance 2/2 pass. First review dispatch returned EMPTY (journalled; re-dispatched fresh+narrowed per resilience ladder). Review verdict changes-required: 1 blocker (unsigned extra top-level fields), 2 majors (bypassable shell regex; 7 untested codes), minors (non-2xx, unenforced limits, steps.md drift). Repaired primary-led: exact key-set enforcement (UNEXPECTED_FIELD), whole-string denylist + fence rejection, all 19 codes tested, HTTP_STATUS/MALFORMED routes, signed limits enforced (origin hostname binding, max_bytes, max_redirects bounds), steps.md byte-binding test (drift finding disproved — already byte-identical). Re-review APPROVED; reviewer's optional hardening (tilde fences, suffixed tool names, max_redirects case) applied and re-verified 2/2. check-suite 434 green | SELECT (T002 after this checkpoint) |
| 2026-08-19 | 4 | SELECT -> DISPATCH (T002) -> [INTERRUPTED] -> RECOVER -> CHECKPOINT | none | Concurrent parallel agent interfered: created duplicate branch `push-my-work` via cherry-picked rebuild (dropping this plan, superseded closures, and T001 from that line) and committed its own plan (identical content to its earlier 9775ef1 on main). T002 dispatch aborted mid-flight; its partial owned files survived untracked. User stopped the interfering session. Regroup: verified main@6f056d2 intact with all work (T001 2/2, check-suite 434, sync/matrix clean); briefly restored files onto the duplicate branch (fbad3d9) before identifying main as authoritative; returned to main; `push-my-work` and origin/main untouched | SELECT (T002 with salvage) |

## Completion Review
Filled by csm-build only after all acceptance criteria have observed evidence.
