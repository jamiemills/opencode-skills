---
format: csm-plan/1
---

# Agent-Agnostic Installable Skills CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; this planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 6 tasks — 3 high (T001 portability boundary, T002 artifact trust, T003 installer filesystem/security transaction), 3 standard (T004 adapters, T005 runtime setup, T006 validation/docs). T001-T003 require independent review before completion.

## Control
- Plan ID: agent-agnostic-installable-skills
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-17 — planning complete; existing unrelated untracked plan protected
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none; target scope is Agent Skills standard plus OpenCode and Claude Code adapters

## Goal
Make all eight skills distributable as Agent Skills-standard directories and installable without requiring users to clone this Git repository. Deliver a Git-free, versioned release archive and a safe installer that can install selected skills into explicit OpenCode or Claude Code destinations. Keep CSM behavior and repository governance intact while isolating agent-specific discovery, invocation, tmux, permissions, and reload behavior in adapters.

**Constraints:** file-based installation remains the compatibility baseline; neutral payloads use only the Agent Skills standard frontmatter (`name`, `description`, optional `license`, `compatibility`, `metadata`, and `allowed-tools`); the first supported adapters are OpenCode and Claude Code; archive installation is file-only and never runs npm, Git, Docker, `gh`, hooks, or network-side-effecting commands; `csm-browse` dependency setup, `csm-upload` publishing, and external repository hook rollout remain explicit separate operations.

**Exclusions:** npm publication, OCI packaging, unverified agent clients, behavioral equivalence across agents, CI/release hosting selection beyond a deterministic artifact contract, automatic runtime dependency installation, automatic GitHub configuration or pushes, changes to the existing `.agents/plans/2026-08-16-coherence-followups-hook-rollout-csm.md`, and changes to other active session or plan artifacts.

## Acceptance Criteria
1. Every shipped skill passes Agent Skills validation: directory name matches `SKILL.md` `name`, name is valid and <=64 characters, description is non-empty and <=1024 characters, and no non-standard frontmatter is required by the neutral payload.
2. A deterministic Git-free archive contains exactly the declared runtime closure for selected skills, with a versioned manifest, source commit, canonical ordered file list, modes, SHA-256 hashes, runtime requirements, and archive hash; checksum or signature verification fails closed before extraction.
3. The installer supports `--all` and selected skills, explicit destination/profile, dry-run, upgrade/downgrade policy, and recovery. It rejects traversal, absolute paths, duplicate entries, symlinks/hard links/special files, checksum mismatches, destination symlink escapes, and conflicts with unmanaged modified skill directories.
4. Same-destination concurrent installs serialize through an owner-recorded lock; staging, replacement, interruption recovery, and rollback never expose a mixed tree and restore the exact previous tree after a failed transaction.
5. OpenCode and Claude Code profiles install to their documented discovery locations and have independent discovery/reload smoke evidence. Neutral skills do not require `opencode run`, `TMUX`, client-specific tools, or client-specific frontmatter; those behaviors are adapter-scoped.
6. Installed `csm-scan`, `csm-browse`, and `csm-upload` pass portability checks from a path containing spaces and a clean disposable destination. Browse dependency setup is explicit and lockfile-based; upload dry-run performs no network, credential, config, Git, or GitHub Pages mutation.
7. Repository gates remain green, the release/install test matrix is reproducible in disposable mode-700 sandboxes, and the pre-existing untracked follow-up plan is byte-for-byte unchanged and still untracked.

## Current-State Evidence
- `README.md:81-106` requires cloning or copying eight skill folders into `$HOME/.config/opencode/skills`; only `csm-browse` has a dependency install step.
- Agent Skills specification (`https://agentskills.io/specification`) requires a directory with `SKILL.md`, standard frontmatter, matching valid `name`, and relative supporting-file references; body Markdown has no imposed format.
- OpenCode documentation (`https://opencode.ai/docs/skills/`) supports project/global `.opencode/skills`, `.claude/skills`, and `.agents/skills` locations, including global `~/.config/opencode/skills`, `~/.claude/skills`, and `~/.agents/skills`.
- Claude Code documentation (`https://code.claude.com/docs/en/skills`) supports `~/.claude/skills`, follows the Agent Skills standard, and has additional non-standard invocation/frontmatter features that must not enter the neutral payload.
- `csm-plan/SKILL.md:22-30` and `scripts/lib/boilerplate.mjs:19-27` contain explicit OpenCode/tmux bootstrap behavior; `scripts/lib/contracts.mjs:1-165` is repository conformance metadata, not a runtime release manifest.
- `csm-scan/scripts/scan.mjs:6-13` imports the production `lib/scan` tree; `csm-browse/package.json:4,10-15` is private, lockfile-backed, and requires Node `>=22 <25`; `csm-upload/scripts/upload.mjs:219-277` uses temporary clones, user config, Git, and GitHub operations.
- Read-only baseline: `node scripts/check-suite.mjs` reports 8 skills and 426 checks; `git status --short --untracked-files=all` reports only the pre-existing untracked `.agents/plans/2026-08-16-coherence-followups-hook-rollout-csm.md`.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Agent-agnostic means Agent Skills format compatibility plus explicitly tested OpenCode and Claude Code adapters, not behavioral parity across every agent | planning decision | Agent Skills spec defines file/frontmatter contract; client docs define different discovery/invocation behavior | decided |
| D2 | A deterministic archive is the first distribution artifact; npm publication is deferred | planning decision | filesystem loader, heterogeneous runtime requirements, and only one private package make npm premature | decided |
| D3 | The archive excludes `.git`, `.agents`, tests, fixtures, baselines, hooks, and repository-only scripts unless a manifest marks a file as runtime closure | planning decision | release should contain portable runtime payload, not process artifacts | decided |
| D4 | Installer replacement is fail-closed for modified unmanaged skill directories; clean managed installs may be upgraded or downgraded only with explicit `--allow-downgrade` | safety decision | avoids destroying user edits while enabling reproducible managed upgrades | decided |
| D5 | Archive verification uses HTTPS transport plus manifest/archive SHA-256; signature support is an optional stronger verification path, never a reason to trust an unverified hash source | security decision | a sidecar hash from the same untrusted source is insufficient | decided |
| D6 | The installer is file-only; npm, Docker, GitHub, Git, and configuration writes are separate explicit commands | safety decision | prevents hidden external side effects during skill installation | decided |
| D7 | The untracked follow-up plan is protected state and must remain byte-identical, untracked, and unmodified | user constraint | concurrent planning/build session safety | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What is the portable skill contract? | Read-only Agent Skills, OpenCode, and Claude documentation fetches; repository frontmatter inspection | Read-only web retrieval and repository reads; no files or external systems changed | Standard contract is directory + `SKILL.md` + constrained frontmatter; clients differ in locations, invocation, reload, and extensions | T001 separates neutral payload from adapters; T004 tests profiles independently |
| R2 | What must each distributable skill include? | Read-only import/layout census and package metadata inspection | No installs or builds; clean repository baseline preserved | Orchestration skills need `SKILL.md`; scan needs production `lib/scan`; browse needs `lib/`, scripts, package files; upload needs script and docs | T002 owns closure manifest; T005 validates clean installed paths |
| R3 | Is npm a suitable first artifact? | Read-only package/history inspection | No package publication or dependency install | Only browse has a private package; no root package, workspace, or publish workflow | Archive first; revisit npm separately |
| R4 | What installer safety model fits the repository? | Read-only comparison with browse exclusive-create locks and tmp+rename state writes | No installer exists and no mutation was attempted | Existing patterns support nonce/PID locks and atomic replacement, but no archive transaction/recovery protocol exists | T003 defines lock, journal, staging, backup, rollback, and crash tests |
| R5 | What external side effects require separation? | Read-only source inspection of browse, scan, upload | No Docker, npm, GitHub, or network mutation | Browse has Node/Docker/curl/ffmpeg requirements; upload can clone/commit/push and write home config; scan writes only requested output | T005 makes runtime setup explicit and dry-run checks mandatory |
| R6 | Could concurrent sessions be affected by planning? | `git status --short --untracked-files=all`, read of the existing untracked plan, tmux session inspection | No session signaling, config writes, checkout, staging, or edits; protected plan remains untracked | Another plan artifact exists and active tmux sessions are present | Only this new plan path may be created; no index update or other plan modification |

## Discovered Requirements
- Archive entries must be validated before extraction: reject absolute names, `..` segments under mixed separators, NULs, duplicate/conflicting entries, symlinks, hard links, devices, and special files.
- Destination validation must use `lstat`/`realpath` for every component and reject symlinked destination parents; staging must be a mode-700 sibling on the same filesystem.
- The destination lock must contain operation ID, PID, nonce, and start time; stale recovery must be age- and live-owner-aware and remove only a nonce-matched lock.
- The transaction journal must distinguish `staged`, `backup-created`, `replaced`, and `verified`; startup recovery must be idempotent and never delete an unrecognized directory.
- Archive manifests need release version, compatibility version, source commit, selected skill list, file list, modes, hashes, runtime/external requirements, and canonical archive hash.
- `csm-browse` dependency installation must use `npm ci --ignore-scripts --no-audit --no-fund` in an explicit disposable or user-approved runtime setup, never inside archive installation.
- `csm-upload` must be documented as an external-mutation integration; archive install and dry-run must not write `~/.agents/csm-upload.json`, contact GitHub, or push.
- Existing `.agents/plans/2026-08-16-coherence-followups-hook-rollout-csm.md` is outside every task's owned scope and must be checked byte-for-byte at final verification.

## Design
The repository gains a neutral release boundary rather than rewriting CSM workflow semantics. T001 validates standard frontmatter and moves or labels client-specific bootstrap material so the portable payload does not require OpenCode commands, tmux, tool names, or client-only metadata. T002 classifies runtime closure and generates a canonical archive plus manifest. T003 implements a standalone file-only installer: resolve explicit profile/destination, acquire destination lock, recover prior journal, verify archive, stage and validate, atomically backup-and-replace, verify, then remove backup and journal. It never executes payload code.

T004 supplies adapters as separate profile metadata and documentation, not as hidden modifications to the neutral skill body: OpenCode profiles target its supported global/project paths and reload behavior; Claude Code targets `~/.claude/skills` and its reload/discovery behavior. T005 documents and tests explicit runtime setup for scan, browse, and upload. T006 owns the disposable test harness, release checks, README installation flow, and final gates. Managed-install metadata records archive release, installed skills, file hashes, and transaction identity; modified unmanaged directories cause a clear refusal, while a managed install can be restored from its backup during recovery.

## Execution Graph
- Wave 1: T001 (neutral contract and adapter boundary).
- Wave 2: T002 after T001 (release closure and artifact generator).
- Wave 3: T003 after T002 (installer core; owns all installer source and transaction files).
- Wave 4: T004 after T001 ∥ T005 after T002; their write scopes are disjoint (profiles/docs versus runtime validation/docs owned by T005, with README integration deferred to T006).
- Wave 5: T006 after T003, T004, and T005 (tests, README integration, release gate).
- Critical path: T001 -> T002 -> T003 -> T006.
- No task may modify `.agents/README.md`, existing plans, existing hooks, or other active-session artifacts; T006 may add only the new release/install test surfaces and the intended README sections.

## Numbered Plan
1. [pending] Establish the neutral Agent Skills contract and adapter boundary
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (public compatibility and behavior boundary)
   - Owned scope: all eight `SKILL.md` files, neutral validator/schema data, adapter-boundary reference docs; no README or existing `.agents` artifacts
   - Not in scope: installer, archive generation, npm publication, changing CSM state machines, removing useful CSM prose, or changing the existing untracked follow-up plan
   - Spike candidate: in a new mode-700 `/tmp` fixture, validate all current frontmatter with the Agent Skills reference validator if available; if unavailable, implement equivalent local checks and record the limitation without installing into the repository
   - Actions: preserve standard frontmatter fields and directory/name parity; add explicit `compatibility` only where a real environment requirement is useful; identify OpenCode/tmux/subagent/tool-specific sections as adapter-scoped; replace unqualified client assumptions in the neutral contract with host-agent capability requirements; keep CSM artifact schemas and safety semantics unchanged; add machine checks for neutral versus adapter-only references
   - Acceptance signal: `skills-ref validate` against every staged skill, or the documented isolated fallback validator, exits 0; the repository's `node scripts/check-suite.mjs` exits 0; a negative fixture containing `opencode run` in the neutral section fails the adapter-boundary check
   - Validation: frontmatter/name/description length matrix; `node --check` for unchanged runtime scripts; verify all eight `SKILL.md` files remain <=500 lines
   - Acceptance evidence: validator output, neutral/adapter classification table, and protected-plan hash/status before and after
   - Repair attempts: 0
   - Recovery note: inspect the per-skill validation report; revert only the owned `SKILL.md`/validator files, never the unrelated untracked plan

2. [pending] Define runtime closure and generate a trusted release archive
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high (supply-chain and release integrity)
   - Owned scope: new release manifest schema, archive generator, release output under an isolated output directory, closure declarations; no installer or README
   - Not in scope: publishing, signing-key management, npm package publication, tests/fixtures/.agents inclusion, or dependency installation
   - Spike candidate: generate the same archive twice from a copied read-only source into separate `/tmp` sandboxes; any byte difference blocks design and requires sorting/mode/mtime normalization
   - Actions: classify every file as runtime payload, release tooling, repository governance, or test-only; define per-skill closure; create deterministic tar/zip policy with canonical root, sorted entries, normalized timestamps and modes; emit manifest with release/manifest versions, source commit, skills, ordered file paths, modes, hashes, Node/external requirements, and archive hash; verify HTTPS source retrieval limits and refuse extraction when archive or manifest verification fails
   - Acceptance signal: two isolated generations produce byte-identical archives, manifests, file lists, and SHA-256 values; a removed file, altered mode, duplicate entry, or checksum mismatch exits nonzero before extraction
   - Validation: required closure matrix for all eight skills; absence of `.git`, `.agents`, tests, fixtures, `node_modules`, and hooks; presence of scan production closure, browse package/lock files, upload script, README/license as declared
   - Acceptance evidence: reproducibility hashes, manifest, closure report, and failed tamper fixtures
   - Repair attempts: 0
   - Recovery note: delete only disposable release outputs; source remains read-only and no release is published by this task

3. [pending] Implement the lock-protected atomic installer
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G3
   - Risk: high (filesystem security, data integrity, concurrent writers)
   - Owned scope: installer CLI/library, transaction journal schema, lock/recovery implementation, installer-specific tests; no skill bodies or external repository configuration
   - Not in scope: running installed code, npm/Docker/Git/gh commands, modifying user files outside an explicit destination, automatic conflict deletion, or installing dependencies
   - Spike candidate: exercise crash points after `staged`, `backup-created`, `replaced`, and `verified` in a new mode-700 sandbox; no repository path may be used as destination
   - Actions: require explicit `--destination` or named OpenCode/Claude profile; support `--all`, selected skills, `--dry-run`, source/version, and explicit downgrade; verify archive before extraction; reject traversal, absolute/duplicate entries, symlinks/hard links/special files and destination escapes; acquire per-destination exclusive lock with PID/nonce/time and bounded stale recovery; stage beside destination on same filesystem; validate complete closure and hashes; refuse modified unmanaged conflicts; journal phases, rename destination to nonce backup, rename stage into place, revalidate, then remove backup; recover idempotently on next run and restore exact previous tree on failed verification
   - Acceptance signal: the disposable installer matrix passes for valid install, selection, dry-run, traversal, symlink/hard-link/special-file, duplicate, checksum, destination-symlink, modified-conflict, concurrent-install, stale-lock, and each crash phase; all failures are nonzero and leave no mixed tree
   - Validation: path-with-spaces destination; mode/ownership checks; repeated upgrade/downgrade; repository protected-state hash/status comparison; no child process or network invocation during installation
   - Acceptance evidence: transaction logs, before/after tree hashes, concurrent process results, crash recovery transcripts, and lock cleanup proof
   - Repair attempts: 0
   - Recovery note: run `--recover` under the same destination lock; never delete an unrecognized staging/backup directory; preserve prior tree until installed verification succeeds

4. [pending] Add OpenCode and Claude Code installation adapters
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G4
   - Risk: standard (client discovery and user configuration)
   - Owned scope: adapter profile definitions, profile-specific installer mapping, adapter documentation and smoke fixtures; no neutral skill content, release generator, or README integration
   - Not in scope: claims about other agents, client permission changes, automatic restart/reload, tmux implementation, or modifying real home directories during tests
   - Spike candidate: in disposable home/config trees, verify each documented profile's destination and duplicate-name behavior before wiring the adapter
   - Actions: define OpenCode profiles for global and project-compatible locations, including `~/.config/opencode/skills`, `.opencode/skills`, `.claude/skills`, and `.agents/skills` where appropriate; define Claude Code personal/project profile for `~/.claude/skills`/`.claude/skills`; document invocation, reload/live-change behavior, precedence, and explicit limitations; keep adapter-specific bootstrap/invocation text outside the neutral archive or in a clearly separate overlay
   - Acceptance signal: profile smoke harness installs one synthetic skill into each profile's disposable destination and verifies the expected file tree, name, and reload instruction; duplicate-name precedence is documented and tested per client
   - Validation: no adapter profile writes real `$HOME`, `.config`, `.claude`, `.agents`, Git config, or repository files; neutral payload contains no unqualified client-only requirement
   - Acceptance evidence: profile matrix, disposable discovery transcripts, and adapter boundary check
   - Repair attempts: 0
   - Recovery note: remove only disposable profile homes; profiles are data and can be regenerated without touching the archive

5. [pending] Define explicit runtime setup and portability checks
   - Task ID: T005
   - Depends on: T002
   - Parallel group: G4
   - Risk: standard (external tools and user-data boundaries)
   - Owned scope: runtime requirement metadata, setup/readiness checks, focused portability fixtures/docs for `csm-scan`, `csm-browse`, and `csm-upload`; no installer core or adapter profiles
   - Not in scope: automatic npm/Docker/GitHub setup, real browser sessions, real GitHub pushes, credentials, or changes to existing runtime roots
   - Spike candidate: copy selected payloads into a mode-700 path containing spaces and run only `--help`, syntax, self-check, scan-to-requested-output, and upload dry-run with HOME/TMPDIR/XDG redirected
   - Actions: make scan transitive production closure and output-path assumptions explicit; preserve browse package/lock metadata and require a separate `npm ci --ignore-scripts --no-audit --no-fund` setup with Node `>=22 <25`, Docker, curl, and optional ffmpeg checks; document upload's `gh`/GitHub/config/push side effects, require explicit dry-run/confirmation boundaries, and verify no config write in dry-run; add requirement metadata to the release manifest
   - Acceptance signal: from a clean path-with-spaces install, scan writes only the requested NORMS output, browse `node scripts/check-skill.mjs` reports the expected missing/present dependency state without installing, and upload dry-run exits 0 without network, Git, gh, credential, or home-config writes
   - Validation: `node --check` all shipped `.mjs`; isolated browse `npm ci --ignore-scripts` only when explicitly run as setup; existing scan/browse checks where dependencies are available
   - Acceptance evidence: environment matrix, redirected-home file diff, command transcripts, and explicit side-effect audit
   - Repair attempts: 0
   - Recovery note: remove only disposable installs and redirected environments; never clean real `/tmp/csm-browse`, home config, Docker, or GitHub state

6. [pending] Add release/install tests, README flow, and final verification
   - Task ID: T006
   - Depends on: T003, T004, T005
   - Parallel group: G5
   - Risk: standard (integration and public documentation)
   - Owned scope: installer/release test harness, README Installation/Requirements/Development sections, final release checklist; no existing `.agents` artifacts except this new plan
   - Not in scope: CI workflow, publishing a release, updating stale unrelated indexes, changing completed plans, external hook rollout, or live agent sessions
   - Spike candidate: run the full matrix twice with two independent mode-700 sandboxes; if any test reaches the repository, real home, or external service, stop and classify as a safety failure
   - Actions: add valid/tampered/archive-boundary/transaction/concurrency/profile/runtime test cases; document archive acquisition, verification, selected install, upgrade/rollback, explicit browse setup, and upload dry-run; wire cheap release checks into the repository gate without making normal installation execute development tooling; record supported clients and unsupported claims
   - Acceptance signal: `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, `node scripts/gen-readme-matrix.mjs --check`, the new isolated installer/release test command, and all applicable existing skill gates exit 0; the final protected-state assertion shows the existing follow-up plan has identical bytes and remains untracked
   - Validation: full archive reproducibility, selected-profile smoke tests, scan suite, browse unit/check-skill, syntax sweep, and README path checks, ordered cheapest-first; Docker/e2e and npm setup remain separately reported as environment-sensitive
   - Acceptance evidence: final command matrix with expected/actual results, archive and manifest hashes, protected-state diff, and no external mutation report
   - Repair attempts: 0
   - Recovery note: resume from the last recorded release/install checkpoint; remove only new task-owned test outputs, never unrelated plan artifacts

## Verification Strategy
- Fast per-task gates: frontmatter/neutral-boundary checks, `node --check`, manifest schema validation, and repository conformance.
- T002 batch gates: deterministic archive generation twice, closure exclusion/inclusion checks, and tamper verification before any extraction.
- T003 security gates: disposable mode-700 installer matrix, crash-point recovery, lock races, symlink/traversal fixtures, modified conflict, and protected repository comparison.
- T004/T005 gates: isolated profile homes, path-with-spaces installs, redirected HOME/TMPDIR/XDG, scan output containment, browse check-skill, and upload dry-run side-effect audit.
- Final gates: repository check-suite/sync/matrix, all applicable scan and browse unit gates, syntax sweep, and final archive reproducibility. Docker and real agent discovery are environment-sensitive and must be reported separately, never silently treated as passed.
- No test may use the repository as installer destination, install dependencies in the repository, contact GitHub, start Docker, mutate Git config, or use live credentials during planning or automated acceptance.

## Risks And Recovery
- Agent standard/client drift: pin the standard fields and document client versions/observations; unknown clients remain unsupported rather than receiving guessed adapters.
- Archive tampering or non-reproducibility: fail before extraction; regenerate only after canonical ordering, modes, and timestamps are corrected.
- Installer crash or concurrent writer: destination lock plus journaled backup/rename recovery; preserve the prior tree until post-replacement verification.
- User edits overwritten: detect unmanaged/modified directories and refuse unless an explicit future policy permits replacement; never silently merge.
- Runtime dependency surprises: keep setup separate from file installation and report unmet requirements clearly; do not run package lifecycle scripts automatically.
- Shared-workspace interference: only this plan file may be created; do not update `.agents/README.md`, touch the existing untracked follow-up plan, signal/attach/detach other tmux sessions, or use other plans as temporary destinations.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Tasks lacked CSM execution fields and runnable gates | high | Expanded all six tasks with dependencies, ownership, risk, anti-scope, spike, acceptance, evidence, recovery, graph, and verification | csm-plan required task schema |
| Archive trust/provenance was underspecified | high | Added deterministic archive policy, manifest schema, source commit, ordered modes/hashes, HTTPS limits, fail-closed verification, and reproducibility tests | Agent Skills spec plus artifact scout |
| Installer path and crash safety were incomplete | high | Added rejection of traversal/links/special files/duplicates, realpath/lstat checks, same-filesystem staging, lock metadata, journal phases, backup/rename, recovery and rollback | installer safety scout; browse tmp+rename precedent |
| Replacement/conflict policy was missing | high | Added managed/unmanaged distinction, modified-tree refusal, explicit downgrade, backup retention, and exact-tree rollback | safety design decision D4 |
| Neutral format was conflated with client behavior | high | T001 owns neutral contract; T004 owns OpenCode/Claude profiles and adapter-specific behavior outside the neutral archive | Agent Skills/OpenCode/Claude docs |
| Client discovery paths/reload semantics were conflated | high | T004 defines explicit profiles and independent disposable smoke evidence | OpenCode and Claude docs |
| Browse `private` field and runtime setup were conflated | medium | T005 treats browse as local lockfile-backed setup, not publication; npm setup is explicit and separate | `csm-browse/package.json:4,10-15` |
| Lifecycle/external side effects were underspecified | medium | D6 and T003/T005 prohibit automatic npm, Docker, Git, gh, network, config, and push operations | source inspection of browse/upload |
| Scan/upload portability was under-scoped | medium | T005 adds transitive scan closure/output containment and upload dry-run/config/network mutation checks | `scan.mjs:6-13`, `upload.mjs:219-277` |
| Task write ownership overlapped | medium | T001 neutral files, T002 release files, T003 installer, T004 profiles, T005 runtime checks, T006 tests/docs; dependencies serialize overlaps | execution graph |
| Governance/generated files were unclassified | medium | T002 explicitly classifies runtime versus release/governance/test surfaces and excludes `.agents`/repo tooling from payload | release boundary D3 |
| Testing and version semantics were weak | medium/low | Added complete negative/positive matrix, release/manifest versions, explicit downgrade policy, and exact evidence requirements | T002/T003/T006 |
| Existing untracked plan was not protected | medium | D7, exclusions, R6, every task anti-scope, and final byte/status assertion protect it | live `git status` baseline |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-17 | 0 | INTAKE -> DISCOVER | none | Existing suite-coherence plan is complete; requested goal has no saved plan; active tmux sessions and one unrelated untracked plan detected | RESEARCH |
| 2026-08-17 | 0 | RESEARCH | none | Scout and three independent tracks confirmed filesystem loader, Agent Skills standard, archive-first boundary, runtime closures, and installer transaction requirements; web docs fetched read-only | DRAFT |
| 2026-08-17 | 0 | DRAFT -> CRITIQUE | none | Six-task plan drafted with serialized ownership and explicit protected-state constraint | CRITIQUE |
| 2026-08-17 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Critique identified missing trust, crash, conflict, profile, runtime, and acceptance details; all findings incorporated; no implementation or unrelated artifact writes | SAVED |

## Completion Review
Filled by csm-build only after all acceptance criteria have observed evidence.
