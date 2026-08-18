---
format: csm-plan/1
---

# URL-Driven Npx Skills Bootstrap CSM Plan

**Supersedes:** `.agents/plans/2026-08-17-agent-agnostic-installable-skills-csm.md` for this scope only. The two plans are mutually exclusive; do not execute both. The superseded plan is preserved unchanged.

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 3 high (T001 bootstrap trust, T002 npm package supply chain, T003 atomic profile installation), 2 standard (T004 runtime boundaries, T005 integration/docs). T001-T003 require independent review.

## Control
- Plan ID: url-driven-npx-skills-bootstrap
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-18 — amended URL/npx design verified; original plan protected
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none; public npm registry and one bundled package are the planning defaults

## Goal
Let a user point an agent at one HTTPS URL and ask it to install this skills collection. The URL is a signed, canonical JSON bootstrap manifest, not an executable script. A fixed, exact-version npm package is the only Node distribution and execution boundary. The agent runs it through `npx`; it never clones the repository, downloads raw source, evaluates URL-provided shell, or executes arbitrary commands from the manifest. After an online warm-up, the same exact package and payload can be used with `npx --offline` from a verified npm cache.

**Deliverables:** one public package containing the reviewed installer, manifest validator, neutral skill payload, runtime closure/index, and fixed `bin`; signed/versioned bootstrap manifests; OpenCode and Claude Code profile installation; atomic managed profile-tree replacement; offline cache verification and replay tests.

**Exclusions:** uvx, Git clone/URL/Git dependencies, raw source downloads, URL-supplied executable names or shell strings, floating npm tags/ranges, package lifecycle scripts, automatic Docker/Git/gh/browser setup, real GitHub publishing, other agents, and changes to the original plan or unrelated session artifacts.

## Acceptance Criteria
1. A canonical signed `csm-bootstrap/1` JSON URL can be validated and used through a fixed command such as `npx --yes --ignore-scripts --no-audit --no-fund --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap install --manifest <url> --agent opencode`.
2. The published package is a reviewed `npm pack` artifact with an unambiguous `bin`, no lifecycle scripts, no Git/URL/range dependencies, and either no dependencies or a fully bundled, integrity-verified closure. The package contains the declared skill payload and no `.git`, `.agents`, tests, fixtures, or raw repository checkout.
3. The bootstrap URL contains only signed canonical JSON: immutable release/package/version/integrity, skill payload hashes, allowlisted profile, structured command ID, and offline cache requirements. Mutable URLs, redirects outside the pinned host, altered bytes, unsupported schema, missing signatures, and arbitrary shell are rejected before installation.
4. Installation stages and verifies the complete agent profile tree, then atomically replaces it under a destination lock with journaled recovery. Concurrent, interrupted, tampered, traversal, symlink, hard-link, special-file, modified-install, and missing-cache cases fail closed without a mixed tree.
5. Online warm-cache then offline replay produces the identical installed tree. Offline uses `npx --offline --no` and fails when any exact package/cache item is absent or altered; it never falls back to network access.
6. Node runtime helpers invoked by installed skills use exact npx package specifications or verified local cache entries. `SKILL.md` remains agent instruction data and is never executed as code. Browse/upload external side effects remain separately authorized.
7. OpenCode and Claude Code profile smoke tests pass in disposable homes, repository gates remain green, and `.agents/plans/2026-08-17-agent-agnostic-installable-skills-csm.md` plus all unrelated artifacts remain unchanged.

## Current-State Evidence
- `README.md:81-106` currently documents Git clone/copy installation; no root npm package or bootstrap exists.
- `csm-browse/package.json:4,10-15` is private, has ranged dependencies, and requires Node `>=22 <25`; it is not currently an npx-publishable package.
- `csm-scan/scripts/scan.mjs:6-13` depends on the production `lib/scan` tree; `csm-upload/scripts/upload.mjs:219-277` can invoke Git/GitHub and write user configuration.
- `csm-plan/SKILL.md:22-30` and `scripts/lib/boilerplate.mjs:19-27` contain OpenCode/tmux-specific prose that must remain outside the neutral execution policy.
- npm documentation (`https://docs.npmjs.com/cli/v10/commands/npx`) states npx runs local/remote package executables, installs missing packages into npm cache, supports exact specs, and accepts `--offline`; offline fails when required cache data is absent.
- npm documentation states the cache is not guaranteed persistent storage and lifecycle scripts can run during package installation; therefore cache verification, exact package integrity, and no-script package validation are required.
- Read-only baseline before this amendment: original plan is committed and untouched; active worktree changes are unrelated to this new plan only; no planning command installed dependencies or mutated external state.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | The bootstrap source is canonical signed JSON, not Markdown instructions or executable shell | user-directed safety interpretation | URL content may be prompt-injected; structured data permits fixed local policy | decided |
| D2 | The initial package is one public exact-version `@scope/csm-skills-bootstrap` package containing installer, manifest validator, neutral skill payload, and declared runtime closure | planning decision | avoids raw source downloads and top-level/transitive npx drift | decided |
| D3 | The package has no dependencies where practical; otherwise all dependencies are bundled and release validation rejects ranges, Git/URL specs, optional unknown native code, and lifecycle scripts | supply-chain decision | exact top-level version alone does not pin transitive resolution | decided |
| D4 | The initial npx invocation is fixed and known; the URL may select only signed payload/profile data and command IDs, never package names, executable paths, or shell | security decision | a URL cannot safely bootstrap arbitrary executable policy | decided |
| D5 | Offline means cache-warmed only: exact package and closure are preverified online, then `npx --offline --no` is used; missing cache fails | operational decision | npm cache is not durable storage and cannot be assumed present | decided |
| D6 | Profile identifiers are an allowlist: `opencode-global`, `opencode-project`, `claude-global`, `claude-project` | safety decision | prevents URL-selected arbitrary filesystem destinations | decided |
| D7 | This plan supersedes the prior plan only for implementation; the prior plan remains historical and must not be edited or executed alongside this one | concurrency decision | avoids active session/build ambiguity | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Can npx support the requested execution model? | Official npm npx docs and local `npx --version` read-only inspection | No package install or cache mutation; Node 20.20.2/npm 10.8.2 observed | Exact package specs and `--offline --no` are supported; absent cache fails; cache persistence is not guaranteed | T002/T005 require warm-cache manifest and offline failure tests |
| R2 | Are exact versions enough for reproducibility? | Independent critique of npx dependency resolution | Read-only | No: transitive metadata can drift; package lock alone does not control ephemeral npx resolution | T002 requires dependency-free or bundled closure and package-tarball validation |
| R3 | Can URL instructions be safely followed by an agent? | Threat-model critique of signed Markdown/JSON bootstrap | Read-only | Signature authenticates publisher, not arbitrary shell safety; URL prose and skill bodies can prompt-inject | T001 uses canonical JSON, fixed command IDs, fixed package, and no shell evaluation |
| R4 | How should payload be delivered without cloning/raw source fetch? | Repository closure census and package-boundary review | Read-only | A single npm package can contain the reviewed skill payload and installer; existing browse package needs closure treatment | T002 packages payload; T004 separates runtime external actions |
| R5 | How can installation avoid mixed profiles? | Existing browse tmp+rename/lock patterns plus critique | Read-only | Per-directory replacement can expose mixed state; complete profile tree needs one transaction root | T003 stages and atomically replaces one managed profile root |
| R6 | What must be protected from this amendment? | Read-only `git status`, plan reads, and active-session inspection | No writes/signals/config changes | Original plan and unrelated session artifacts exist outside new plan scope | Only this amended plan may be created/committed |

## Discovered Requirements
- The agent must know one fixed bootstrap package name/version or use a preinstalled trusted bootstrap skill; a URL alone cannot safely choose the executable that interprets it.
- The signed JSON must be canonicalized before hashing/signing, have bounded size/time/content type, pin an HTTPS origin and redirect policy, and include release/package/profile audience.
- `npx --ignore-scripts` suppresses package lifecycle scripts but does not sandbox the package `bin`; the package executable is the trusted reviewed boundary and must be tested from `npm pack`, not source.
- Release validation must reject `scripts`, `preinstall`, `install`, `postinstall`, `prepare`, Git dependencies, URL dependencies, ranges, undeclared packed files, and ambiguous bins.
- A package lockfile does not make npx transitive resolution reproducible; use no dependencies or bundled dependencies with integrity checks and license review.
- The package/cache trust split must be explicit: npm registry/provenance authenticates the bootstrap executable; the signed manifest authenticates payload and installation policy.
- Profile installation writes a private transaction state directory, lock, journal, backup, and staged complete tree; “writes only skill directories” is not an accurate implementation claim.
- All fetched Markdown, descriptions, links, and runtime metadata are untrusted agent content; they cannot expand executable policy.

## Design
The user-facing flow is a fixed bootstrap command plus one URL:

```text
npx --yes --ignore-scripts --no-audit --no-fund \
  --package=@scope/csm-skills-bootstrap@1.0.0 \
  csm-skills-bootstrap install --manifest https://example.invalid/csm/1.0.0/bootstrap.json --agent opencode
```

The agent receives the URL as data. The fixed package validates signed canonical JSON, checks the package/release audience, selects only an allowlisted profile, verifies the embedded payload index and hashes, stages the complete profile tree, and atomically installs it. It never interprets URL prose as shell. The package contains the neutral `SKILL.md` files and the declared runtime files, so no Git clone or raw source download is needed.

For offline replay, the package and all bundled/declared cache entries are warmed and verified first. The same command uses `npx --offline --no --package=@scope/csm-skills-bootstrap@1.0.0 ...`; missing or altered cache data fails without network fallback. A cache manifest records npm version, Node version, package integrity, dependency closure, and cache verification result. Since npm does not guarantee cache persistence, offline support is conditional on the cache manifest still validating.

Installed skills remain Agent Skills directories. Their Markdown is loaded by the selected agent, not executed by the installer. Any Node helper invoked later is a separately declared exact npx package or a package bin from the verified cache. Browse's Docker/Chromium and upload's GitHub/Git side effects require explicit skill-level authorization and are never part of bootstrap installation.

## Execution Graph
- Wave 1: T001 bootstrap schema, signature, command boundary, and threat model.
- Wave 2: T002 publishable package/payload closure after T001.
- Wave 3: T003 npx-driven profile installer after T001 and T002.
- Wave 4: T004 runtime-helper and offline-cache boundaries after T002 ∥ profile smoke fixtures within T003's test scope are serialized by T003 ownership.
- Wave 5: T005 integration tests/docs/final gates after T003 and T004.
- Critical path: T001 -> T002 -> T003 -> T005.
- Tasks never modify the original plan, `.agents/README.md`, other plans, active hooks, or other session artifacts.

## Numbered Plan
1. [pending] Define and validate the signed URL bootstrap contract
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (remote policy and prompt-injection boundary)
   - Owned scope: bootstrap JSON schema, canonicalization/signature verifier, fixed command allowlist, trust-boundary tests and docs
   - Not in scope: npm package publication, installer replacement, arbitrary shell support, Markdown instruction execution, changes to existing skills or plans
   - Spike candidate: validate signed canonical JSON fixtures with changed whitespace, key order, redirect host, oversized response, altered signature, and injected shell fields in a new mode-700 `/tmp` sandbox; no network mutation
   - Actions: require HTTPS and bounded fetch; pin origin/redirect policy; canonicalize bytes; verify signature/digest, schema, audience, release/package/version/integrity, profile enum, and structured command IDs; reject shell strings, pipelines, substitutions, executable paths, mutable tags, arbitrary package names, and unapproved arguments; cache only verified manifest bytes by digest
   - Acceptance signal: `npx --offline --no --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap validate --fixture <valid>` exits 0 for valid signed data and nonzero for altered, unsigned, redirected, oversized, mutable, unsupported, or shell-bearing fixtures
   - Validation: canonicalization idempotence; signature failure messages; no external request beyond the bounded read-only fixture; original plan hash/status unchanged
   - Acceptance evidence: schema, signed fixture set, rejection transcript, and trust-boundary report
   - Repair attempts: 0
   - Recovery note: discard only disposable fixtures; do not alter the original plan or use it as a fixture destination

2. [pending] Build and publish the exact npx package and skill payload
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (supply chain and executable distribution)
   - Owned scope: new package manifest/bin, package payload closure, pack/release validation, package integrity/cache manifest
   - Not in scope: raw Git/source download, floating dependencies, lifecycle scripts, real registry publish during local tests, runtime Docker/GitHub actions
   - Spike candidate: run `npm pack --dry-run`/pack in a disposable copy and verify whether all required scan/browse/upload runtime files can be included without undeclared dependencies; if not, split helpers or bundle their full closure and record it
   - Actions: create an unambiguous `bin`; package neutral skills plus declared runtime closure; use exact versions, no Git/URL/range dependencies, no lifecycle scripts, no dynamic source loading, and no ambiguous executables; reject undeclared packed files; generate source/provenance, package integrity, payload tree hashes, and cache manifest; test the packed tarball, not the repository source; use npm provenance/signature facilities where available
   - Acceptance signal: isolated `npm pack --json` followed by package audit exits 0 only when the tarball has the expected files, one fixed bin, no lifecycle scripts, no Git/URL/range dependencies, and deterministic payload hashes; the exact package version resolves from the approved registry
   - Validation: unpack into a disposable path, run `npx --yes --ignore-scripts --no-audit --no-fund --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap --version`, and compare packed bytes/hashes across two builds
   - Acceptance evidence: packed manifest, tarball/integrity hashes, dependency/license report, cache manifest, and registry/provenance verification
   - Repair attempts: 0
   - Recovery note: discard only disposable package outputs; do not publish a release until pack and integrity gates pass

3. [pending] Implement npx-only atomic profile installation
   - Task ID: T003
   - Depends on: T001, T002
   - Parallel group: G3
   - Risk: high (filesystem security and concurrent profile replacement)
   - Owned scope: package installer bin/library, profile enum mapping, managed transaction state, lock/journal/recovery tests
   - Not in scope: arbitrary destination paths from URL, executing SKILL.md, `node <file>`, shell evaluation, Git clone, raw downloads, npm install, Docker, Git, gh, or replacing modified unmanaged files
   - Spike candidate: crash after each transaction phase in disposable OpenCode/Claude homes; verify complete-tree recovery without repository or real-home writes
   - Actions: accept only the fixed package bin and signed manifest URL; resolve profile enum to documented destination; verify package/payload hashes; reject traversal, absolute paths, duplicates, symlinks, hard links, special files, destination escapes, and modified unmanaged trees; acquire destination lock; stage the complete profile tree beside its root; journal `staged`, `backup-created`, `replaced`, `verified`; atomically replace the whole managed root; recover idempotently and preserve exact backup until verification succeeds; support selected skills only through signed allowlisted selection
   - Acceptance signal: `npx --offline --no --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap test-install --fixture <sandbox>` passes valid, selected, traversal/link/special-file, checksum, conflict, lock-race, crash-recovery, and no-mixed-tree cases, with every negative case nonzero
   - Validation: path-with-spaces and disposable HOME/XDG; managed upgrade/downgrade policy; two concurrent processes; before/after repository hash/status; process/network audit proving installer performs no raw source fetch or external command
   - Acceptance evidence: transaction journals, tree hashes, lock/race logs, crash transcripts, and profile destination matrix
   - Repair attempts: 0
   - Recovery note: resume through the journal under the same lock; never delete an unrecognized backup/staging directory

4. [pending] Define npx runtime-helper and offline-cache boundaries
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G4
   - Risk: standard (runtime dependencies and external side effects)
   - Owned scope: runtime command metadata, helper package declarations/cache verifier, browse/scan/upload invocation docs and isolated fixtures
   - Not in scope: automatic dependency installation, real browser/Docker/GitHub operations, raw Node execution, floating package specs, or modifying existing runtime roots
   - Spike candidate: use a fresh disposable npm cache, warm it online only in an approved isolated setup, then disable network and replay; remove one cache entry and alter one tarball to prove fail-closed behavior
   - Actions: require exact `npx --package=name@version` forms; require `--offline --no` for offline mode; maintain cache manifest with Node/npm versions and all package integrities; reject ranges/tags, missing bins, lifecycle dependencies, Git/URL specs, and unverified cache entries; keep browse external prerequisites explicit and upload external mutations explicitly authorized; never claim npx cache is durable without revalidation
   - Acceptance signal: `NPM_CONFIG_CACHE=<cache> npx --offline --no --ignore-scripts --no-audit --no-fund --package=@scope/csm-skills-bootstrap@1.0.0 csm-skills-bootstrap offline-check <manifest>` exits 0 with a verified warm cache and nonzero with a missing/altered entry, with no network request
   - Validation: online warm-cache then offline identical output/tree; cold-cache failure; exact-version negative controls for `latest`/ranges; no `node`, shell, Git, Docker, gh, or project `node_modules` writes
   - Acceptance evidence: cache manifest, `npm cache verify` output, offline replay and cold-cache transcripts, and side-effect audit
   - Repair attempts: 0
   - Recovery note: remove only disposable cache/home directories; never clean the user npm cache or real skill installation during tests

5. [pending] Integrate agent discovery, documentation, and final verification
   - Task ID: T005
   - Depends on: T003, T004
   - Parallel group: G5
   - Risk: standard (public installation workflow)
   - Owned scope: README installation flow, profile/discovery smoke harness, package/release test suite, final checklist; no prior plans
   - Not in scope: CI/release hosting rollout, unverified agents, external repositories, live credentials, or updating unrelated indexes
   - Spike candidate: run two complete online/offline cycles in separate mode-700 homes for OpenCode and Claude profile enums; if any command reaches the repository or real home, stop as a safety failure
   - Actions: document the fixed npx command plus URL input, online cache warm-up, offline replay, missing-cache behavior, supported profiles, reload/discovery steps, browse setup, upload authorization, and prompt-injection boundary; add tests for malicious JSON/Markdown, duplicate names, profile precedence, package tarball drift, and original-plan protection; retain exact existing repository gates
   - Acceptance signal: `node scripts/check-suite.mjs && node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check` plus the isolated `npx` bootstrap test suite exits 0; online/offline installed trees match and the original plan is byte-identical
   - Validation: Agent Skills validator, packed artifact audit, OpenCode/Claude disposable discovery smoke, scan/browse syntax/self-check, upload dry-run, and protected `git status`/hash comparison ordered cheapest-first
   - Acceptance evidence: final command matrix, URL/schema/package hashes, online/offline transcripts, profile smoke results, and protected-state report
   - Repair attempts: 0
   - Recovery note: resume from the last package/cache/transaction checkpoint; remove only new test sandboxes and task-owned outputs

## Verification Strategy
- Fast gates: schema/canonicalization, package metadata/bin/lifecycle/dependency audit, `node --check`, and existing repository conformance.
- Package gates: `npm pack` reproducibility, packed-tarball execution, exact registry version, integrity/provenance, and no undeclared files.
- Installer gates: disposable transaction matrix, traversal/link/special-file rejection, lock races, crash recovery, profile-tree atomicity, and no external command/network audit.
- Offline gates: verified warm cache, `npx --offline --no`, missing/altered cache failures, exact-version controls, identical tree/output.
- Final gates: OpenCode/Claude profile smoke tests, Agent Skills validation, existing suite gates, scan/browse checks where available, and protected-state verification. Docker and real external publishing are not required for bootstrap acceptance.

## Risks And Recovery
- URL prompt injection: signed JSON and hardcoded command IDs; fetched prose/Markdown cannot expand executable policy.
- Mutable release/package: immutable versioned manifest, exact package version, integrity/provenance, signature, and no tags/ranges.
- npx cache loss/poisoning: cache manifest, `npm cache verify`, package integrity, offline fail-closed behavior, and explicit warm-cache prerequisite.
- Lifecycle/dependency execution: no package lifecycle scripts; dependency-free or fully bundled package; pack-time audit.
- Malicious archive/payload: complete hash verification before extraction and path/type rejection.
- Mixed profile state: one profile-root transaction with lock, stage, backup, journal, atomic replacement, and recovery.
- Existing user edits: managed metadata and fail-closed modified-directory conflict policy.
- Runtime side effects: installation never invokes Git, Docker, gh, browser, or upload; those remain skill-level explicit operations.
- Concurrent planning: the prior plan and unrelated artifacts are immutable protected state; only this amended plan is created.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Transitive npx dependencies can drift | blocker | Package is dependency-free where possible or fully bundles closure; release rejects ranges/Git/URL/optional unknown dependencies | npx research and T002 |
| `--ignore-scripts` does not sandbox the package bin | blocker | Treat fixed reviewed bin as trusted boundary; audit packed artifact and lifecycle metadata | npm scripts docs and T002 |
| Manifest integrity cannot authenticate the already-running package | blocker | Separate npm registry/provenance trust for executable from signed manifest trust for payload/policy | critique correction, D2/D4 |
| Signed Markdown remains prompt-injectable | blocker | Canonical signed JSON only; hardcoded package/commands; no shell strings | T001 |
| URL could choose arbitrary executable/package | major | Fixed initial package/version; URL selects only signed data and command IDs | D4 |
| Per-directory replacement can expose mixed tree | major | Stage and atomically replace one complete profile root with journal/recovery | T003 |
| npm cache is not durable | blocker | Warm-cache prerequisite, cache manifest, `npm cache verify`, offline missing-entry failure | npm docs, T004 |
| Lifecycle-bearing dependencies unsafe | major | Pack-time reject lifecycle scripts and unapproved dependency forms | T002 |
| Payload delivery ambiguous | major | One immutable npm package contains installer and declared skill payload/closure | D2, T002 |
| Existing browse package is private/ranged | major | Do not reuse it as published package; package/bundle exact runtime closure or keep runtime setup separate | current package evidence, T002/T004 |
| URL trust boundary under-specified | medium | HTTPS host/redirect/content bounds, canonicalization, signature audience, and immutable versions | T001 |
| Original plan could be mutated or co-executed | major | Separate filename, supersession marker, mutually exclusive execution rule, and protected original | D7 and execution graph |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-18 | 0 | INTAKE -> DISCOVER | none | Existing 2026-08-17 plan found and intentionally left untouched; current npx/npm versions and worktree baseline captured | RESEARCH |
| 2026-08-18 | 0 | RESEARCH | none | npm docs and two independent tracks confirmed exact npx/offline behavior, cache limitations, package lifecycle risks, URL prompt-injection risks, and profile transaction requirements | DRAFT |
| 2026-08-18 | 0 | DRAFT -> CRITIQUE | none | Amended five-task design drafted around fixed package, signed JSON, bundled payload, npx cache, and atomic profile root | CRITIQUE |
| 2026-08-18 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Critique blockers incorporated: dependency closure, trust split, fixed command boundary, whole-tree transaction, cache manifest, and exact acceptance signals | SAVED |

## Completion Review
Filled by csm-build only after all acceptance criteria have observed evidence.
