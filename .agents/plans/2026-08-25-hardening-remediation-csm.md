format: csm-plan/1

# Repository Hardening And Review Remediation CSM Plan

## How To Execute

- Start work only through a separate, explicit `csm-build` invocation naming this plan; planning did not begin execution.
- Commit policy and live state are maintained in Control by `csm-build`.
- Risk summary: 15 pending tasks: 9 high-risk security/concurrency/publication tasks (T001-T007, T012, T014), 5 standard contract/CI/input tasks (T009-T011, T013, T015), and 1 low-risk documentation task (T008). T001, T002, T005, T006, T007, T012, T014, and T015 require independent review before completion.
- Generated bootstrap payloads and indexes must be regenerated from source; never hand-edit generated copies.

## Control

- Plan ID: `hardening-remediation`
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-25 T023 and final completion verification passed; all 24 tasks have evidence, full `make test` passed, and final independent security review found no actionable findings.
- Last model/run: gpt-5.6-luna final completion 2026-08-25.
- Next transition: COMPLETE
- Active tasks: none
- Blockers: none after user approval; merged browser/upload details are now owned by T004/T005. D1-D9 are confirmed defaults.
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and working-tree diff.

## Goal

Remediate the confirmed high and medium issues from `.agents/reviews/2026-08-25-opencode-skills-review.md` and the additional issues in `.agents/research/2026-08-25-repo-issues-deep-research-research.md`, while preserving valid existing behavior and the repository's generated-payload parity model.

Deliverables:

- Hostile-input-safe autoresearch snapshot, process, and ledger boundaries.
- Safe browser input/output/protocol/evaluation behavior.
- Safe upload source handling, destination pinning, and binary-publication disclosure.
- Collision-safe durable artifacts and concurrency-safe DDD publication.
- Corrected skill contracts and artifact ownership rules.
- Immutable CI/release inputs, dependency audit coverage, and provenance-ready release documentation.
- Regression tests, generated payload synchronization, and passing repository gates.

Exclusions:

- No new sandbox/container runtime or third-party dependency unless a build-time spike proves the existing provider cannot satisfy the selected trusted-local contract.
- No automatic production npm publication, key rotation, GitHub Pages publication, or live registry replay.
- No implementation during planning.

## Acceptance Criteria

1. Trusted-local either enforces its advertised network/memory/process/descendant boundary or fails closed with an explicitly weaker trusted-process contract; workspace snapshots are allowlisted and bounded before execution. -> T001, T002.
2. Ledger locking and initial recovery are ownership-safe, preserve torn/corrupt evidence, and reject duplicate active runs unless an explicit run lease policy permits them. -> T003.
3. Browser input never echoes secret text; navigation protocols are controlled; DOM/eval output and evaluation duration have explicit safety behavior and tests. -> T004.
4. Upload rejects unintended symlink/path resolution, binds scanning to the copied file, validates effective push destination, and clearly gates unscanned binary publication. -> T005.
5. Deep-research, make-tests, plan, review, and DDD artifacts have explicit run identity, collision, ownership, resume, and rollback semantics. -> T006, T007.
6. DDD report/graph publication cannot expose mixed generations and preserves the last complete pair on failure. -> T007.
7. Skill docs, README, payload copies, and indexes agree with implemented behavior and write boundaries. -> T008, T009.
8. CI uses verified immutable action references and aligned runtime/toolchain policy, includes dependency audit policy, and release documentation distinguishes reproducibility from provenance without creating an ordinary-event publish path. -> T010, T011.
9. Targeted tests cover every changed security/concurrency boundary, generated payload parity passes, and `make fmt-check`, `make lint`, `make check`, `make test-package-index`, `make test-deterministic`, and `make test` pass. -> T012, T013, T014, T015.

## Current-State Evidence

- Pinned baseline: `a63411f334171e20fd480eacf60685b353f9aa5f`; source worktree was unchanged during planning except existing untracked review/research artifacts.
- Review report: 20 upheld findings, including autoresearch isolation/locking, DDD publication, browser output, upload destination, artifact collisions, and CI/toolchain policy.
- Deep research: additional confirmed issues include detached-descendant containment gaps, unlocked initial ledger recovery, uncapped pre-execution snapshotting, upload symlink/TOCTOU behavior, unrestricted browser protocols, indefinite CDP evaluation, deterministic artifact collisions, mutable actions, absent dependency audit, and missing npm provenance workflow.
- Existing gates: `make test` already includes `test-suite-tooling`; the prior review finding that CI omitted that suite is retracted and is not a task.
- Existing repository pattern: source skill files are authoritative; `scripts/pack-bootstrap.mjs` synchronizes bootstrap payload copies and `bootstrap/payload-index.json`.
- Existing test patterns: Node test suites run serially with `--test-concurrency=1`; csm-browse has focused unit tests; autoresearch and DDD have focused runtime/publication/ledger tests.

### Applicability

```json csm-applicability/1
{
  "format": "csm-applicability/1",
  "decision": "mixed",
  "mode": "risk-first",
  "matchedSignals": [
    "boundary_change",
    "public_contract",
    "ownership_or_persistence",
    "invariant_or_consistency",
    "external_side_effect",
    "migration_or_rollback",
    "cross_boundary_coordination",
    "security_or_authority"
  ],
  "evidence": [
    { "source": "repository", "locator": ".agents/reviews/2026-08-25-opencode-skills-review.md", "observation": "Upheld security, concurrency, persistence, publication, and contract findings." },
    { "source": "repository", "locator": ".agents/research/2026-08-25-repo-issues-deep-research-research.md", "observation": "Independent research confirmed additional boundary and release-trust issues." },
    { "source": "brief", "locator": "user request", "observation": "User requested a complete fix plan rather than a single isolated change." }
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
    "warranted": ["T001","T002","T003","T004","T005","T006","T007","T010","T011","T012","T013","T014","T015"],
    "lightweight": ["T008","T009"]
  },
  "dddArtifacts": [],
  "unresolvedRisks": [
    "Exact trusted-local source dependency semantics are not yet proven.",
    "Navigation allowlist and binary-publication policy are behavior decisions.",
    "Whether duplicate optimize calls need a run-level lease is not yet decided.",
    "Exact approved Node 22 patch and GitHub Action SHAs must be selected at implementation time."
  ],
  "bypass": { "requested": false, "rationale": null }
}
```

Required obligations:

- `boundary-contract`: document and test trust boundaries, allowed inputs, and fail-closed behavior.
- `security-authority`: independently review changes affecting candidate execution, browser data, credentials, or public publication.
- `ownership-and-invariant`: prove lock ownership, artifact identity, generation matching, and no mixed outputs.
- `observable-parity`: characterize existing successful/error/side-effect behavior before changing public verbs or contracts.
- `rollback-and-forward-recovery`: preserve existing artifacts and define interruption recovery for every durable writer.
- `independent-review`: high-risk tasks require a separate review before completion.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | Trusted-local remains a trusted-process provider; generated mode remains fail-closed without a verified external sandbox. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D2 | Snapshot inputs are explicit source/dependency allowlists; undeclared workspace dependencies fail with a diagnostic. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D3 | Duplicate active autoresearch runs for one run ID are rejected by a run-level lease; per-append locking remains necessary. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D4 | Browser navigation permits `http` and `https` by default; other schemes require explicit policy approval. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D5 | DOM/full-page output and eval remain available only with explicit command-level authorization; normal output is bounded and redacted where practical. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D6 | Binary upload remains supported but requires explicit unscanned-content acknowledgment; initial scope does not promise OCR. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D7 | Durable artifacts use run-ID-suffixed paths and refuse terminal-artifact replacement. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D8 | DDD uses an ownership-aware lock plus generation manifest/pointer; last complete pair remains authoritative on failure. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D9 | Dependency audit fails high/critical findings and reports lower severities; no Dependabot/Renovate is added. | user-confirmed decision | User approved the recommended defaults on 2026-08-25. | decided |
| D10 | No production publish/key rotation/registry replay occurs in this remediation plan. | scope constraint | Existing release checklist keeps these separately approved. | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | --- | --- | --- | --- | --- |
| R1 | What is the smallest safe trusted-local snapshot? | Read-only source/caller/test inspection; future synthetic fixture spike in `/tmp` | No implementation; future fixture must be copied to a new temp sandbox with redirected HOME/TMPDIR/XDG paths | Source/dependency semantics are unresolved; whole-root copying is unsafe | T001 includes a spike and fail-closed dependency behavior |
| R2 | Can current process-group cleanup prove descendant containment? | Read-only Node/Linux documentation comparison; future synthetic child only in isolated temp sandbox | No repo execution; future process must be bounded, credential-free, and sandbox-local | Process group is not a kernel containment boundary | T002 must either add a proved boundary or narrow the contract |
| R3 | What run-level lease semantics are required? | Read-only optimizer/ledger call-graph inspection; future two-writer synthetic ledger test | Temporary ledger only; no real artifacts or credentials | Append locking alone does not prevent duplicate evaluation | T003 uses explicit lease decision and collision tests |
| R4 | Which browser/publication behavior changes are acceptable? | Existing docs/tests plus cited ASVS/Git/CDP sources | Read-only retrieval; no browser or publication execution | Protocol, secret-output, binary, and push-destination policy choices remain user-visible | T004/T005 record selected policy in docs/tests; build blocks if D4-D6 are rejected |
| R5 | Which artifact consumers require legacy paths? | Read-only repository references/history search | No writes or generators | No DDD artifacts explicitly referenced; direct consumers must be searched before migration | T006/T007 preserve old artifacts and reject unsafe replacement |
| R6 | Are current CI/release claims reproducible? | Read-only manifest/CI/checklist inspection; future isolated pack/audit evidence | No install or publish during planning | Action tags/runtime/pack/audit/provenance are not fully pinned or enforced | T010/T011 add static gates and release-only evidence |

## Discovered Requirements

- `scripts/pack-bootstrap.mjs` must regenerate payload copies and `bootstrap/payload-index.json` after source skill or packaged implementation changes.
- Changes to orchestration `SKILL.md` boilerplate-managed sections must use `scripts/sync-skill-boilerplate.mjs`, not manual edits.
- Node runtime is `>=22 <25`; existing test commands use serial Node test execution.
- `make test` is the primary suite and already includes suite-tooling; do not add the retracted omission as work.
- Security and concurrency tests must use synthetic temporary fixtures and preserve the repository baseline.
- Public behavior changes require before/after parity checks for success, error, output, and side effects.
- No plan task may delete prior reports, ledgers, quarantine files, or release evidence during rollback.
- Explicit traceability: F-001/F-002/F-003 -> T001-T003; F-004/F-017 -> T007/T012; F-005/F-006 -> T004; F-007/F-013 -> T005; F-008/F-009/F-010 -> T006; F-011/F-012/F-020 -> T008; F-014 -> T015; F-015 -> T002; F-016/F-018/F-019 -> T010/T011; deep-research additions A-001/A-002/A-003 -> T006/T007; additional runtime/upload additions -> T001-T005.
- Merge record: user approved merging scout plan `2026-08-25-browse-upload-boundaries-csm.md`; its browser/upload policy, fixture, timeout, no-follow, push-destination, binary-policy, and generated-parity details are incorporated into T004/T005/T009. The source scout plan is removed after this merge.

## Design

The design is split into five ownership domains:

- **Autoresearch trust boundary:** validate a manifest of allowed snapshot inputs; preflight bytes; reject symlinks/protected paths; run trusted-local with a truthful trust posture; add ownership-safe lock and recovery; add an optional run lease that rejects duplicate active run IDs.
- **Browser boundary:** use a secret-safe input result; enforce protocol policy before CDP navigation; bound evaluation duration and output; classify or explicitly authorize sensitive DOM/eval output.
- **Upload boundary:** open/validate stable regular files without following unintended symlinks; bind scanning and copy to the same file identity or revalidate after copy; check effective fetch and push destinations; require explicit unscanned-binary acknowledgment.
- **Artifact durability:** introduce one run identity contract for document-producing skills; use collision-safe draft/final paths; refuse terminal overwrite; add DDD output-pair lock and generation manifest with matching IDs/digests.
- **Input/contract boundaries:** anchor BDD specs to the git root, use argv-safe tmux prompt transport, bound DDD clarification files before parsing, and correct csm-build's optional-commit output contract.
- **Trust and documentation:** pin workflow actions/runtime/tool versions, add non-mutating dependency audit policy, define npm provenance prerequisites, update contracts/README, regenerate payloads, and enforce parity.

## Execution Graph

- **G1 independent foundations:** T001 autoresearch snapshot design, T004 browser policy, T006 artifact identity contract, T010 CI/toolchain policy, T015 DDD input-boundary work.
- **G2 dependent security implementations:** T002 depends on T001; T003 depends on T002; T005 depends on T004; T007 depends on T006 and T015.
- **G3 documentation/generated synchronization:** T008 depends on T001-T007 and T015; T009 depends on T008 and owns generated payload/index regeneration.
- **G4 release/test integration:** T011 depends on T010 and owns all release checklist/workflow files; T012 depends on T001-T007 and T015; T013 depends on T008-T012; T014 is final and depends on all prior tasks.
- **Critical path:** T001 -> T002 -> T003 -> T006 -> T015 -> T007 -> T008 -> T009 -> T012 -> T013 -> T014.
- Tasks in a parallel group have disjoint write ownership. Shared files are serialized: T015 before T007 for DDD pipeline ownership; T010 before T011 for release policy; T008 before T009 for generated synchronization.

## Numbered Plan

1. [completed] Define and implement allowlisted trusted-local snapshots
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high; candidate execution and secret boundary
   - Owned scope: `csm-autoresearch/lib/providers/trusted-local.mjs`, snapshot helpers, provider tests
   - Not in scope: generated-source sandbox implementation; arbitrary workspace dependency compatibility; changing registered-provider trust
   - Spike candidate: copy synthetic source/evaluator/policy/fixture/credential/hidden/symlink/oversized files into a new `/tmp` sandbox and determine the minimum legal manifest; do not execute candidate code.
   - Actions: define explicit snapshot manifest; include only validated source and declared dependencies/mutation paths; reject symlinks, protected names, outside-root paths, and undeclared imports; enforce byte cap during copy; preserve source/patch hashes and environment allowlist; update trust documentation.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/providers.test.mjs` exits 0 with positive allowlist, protected-path, symlink, undeclared-input, and preflight-byte tests.
   - Validation: `node --check csm-autoresearch/lib/providers/trusted-local.mjs`; `make test-autoresearch`.
   - Acceptance evidence: synthetic manifest matrix, rejected-input diagnostics, and focused test output.
   - Repair attempts: 0
   - Recovery note: if snapshot semantics are ambiguous, preserve old code and mark T001 blocked with the exact dependency contract needed; never broaden the snapshot silently.

2. [completed] Enforce truthful autoresearch process/resource containment
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: high; hostile-process and resource boundary
   - Owned scope: `csm-autoresearch/lib/runtime/index.mjs`, provider capability checks, runtime/provider tests, security documentation
   - Not in scope: new container runtime or production sandbox deployment; generated mode remains fail-closed unless capability verification already exists
   - Spike candidate: isolated synthetic detached-child test to characterize current process-group behavior; no credentials/network/real workspace and bounded timeout.
   - Actions: either enforce network/memory/process/descendant limits through an already supported verified boundary or reject those policy requests; ensure timeout/output/workspace termination cannot leave descendants; preflight workspace/output budgets; expose truthful trusted-process posture.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/runtime.test.mjs csm-autoresearch/test/providers.test.mjs` exits 0 with unsupported-capability refusal, descendant cleanup, aggregate output, and pre-execution size tests.
   - Validation: `node --check csm-autoresearch/lib/runtime/index.mjs`; `make test-autoresearch`.
   - Acceptance evidence: capability matrix, bounded cleanup transcript, and independent security review.
   - Repair attempts: 0
   - Recovery note: if kernel enforcement cannot be proven, the only acceptable completion is fail-closed refusal plus corrected docs, not a best-effort claim.

3. [completed] Make autoresearch ledger locking, recovery, and run ownership safe
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: high; persistent state and concurrency
   - Owned scope: `csm-autoresearch/lib/ledger/index.mjs`, `lib/optimizer/index.mjs`, ledger/optimizer tests
   - Not in scope: changing ledger event schema or deleting quarantine evidence
   - Spike candidate: two synthetic writers, torn tails, malformed tails, and interrupted lock files in `/tmp`; no real ledger.
   - Actions: track lock ownership/token; never unlink after `EEXIST`; acquire lock before initial recovery/quarantine/rewrite; preserve malformed bytes and blocked markers; add explicit operator-mediated stale-lock recovery; reject duplicate active run IDs with a lease unless a documented sharing policy is selected; prevent duplicate trial claims.
   - Acceptance signal: `node --test --test-concurrency=1 csm-autoresearch/test/ledger.test.mjs csm-autoresearch/test/optimizer.test.mjs` exits 0 with lock-owner, recovery-under-lock, stale-lock refusal, torn-tail preservation, and duplicate-run tests.
   - Validation: `node --check csm-autoresearch/lib/ledger/index.mjs`; `make test-autoresearch`.
   - Acceptance evidence: two-writer transcript, quarantine contents, lease decision, and recovery journal.
   - Repair attempts: 0
   - Recovery note: an interrupted build must leave lock metadata/quarantine evidence; rerun must inspect state before any repair.

4. [completed] Harden browser input, navigation, DOM output, and evaluation duration
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: high; credential and browser authority boundary
   - Owned scope: `csm-browse/lib/verbs/input.mjs`, `lib/verbs/nav.mjs`, `lib/verbs/dom.mjs`, `lib/cdp.mjs`, focused browser unit tests, `csm-browse/SKILL.md`
   - Not in scope: Docker/VNC lifecycle; automatic OCR; removing intentional browser capabilities without a policy decision
   - Spike candidate: characterize current `type`, `eval`, `text`, `html`, and scheme behavior with synthetic page/session fixtures only.
   - Actions: never echo typed text; add secret-safe result shape; enforce `http`/`https` default protocol policy with explicit override semantics; add CDP evaluation timeout and aggregate output cap; require explicit authorization for full DOM/eval/sensitive extraction; document behavior and errors.
   - Acceptance signal: `cd csm-browse && node --test --test-concurrency=1 tests/unit/verbs-core.test.mjs tests/unit/cdp.test.mjs tests/unit/security.test.mjs` exits 0 with secret non-echo, protocol refusal, timeout, and output-bound tests.
   - Validation: `cd csm-browse && node scripts/check-skill.mjs`; `make lint`.
   - Acceptance evidence: before/after CLI result examples without secret values and focused test output.
   - Repair attempts: 0
   - Recovery note: preserve session state; if policy changes are rejected, document the accepted risk and complete only non-behavioral secret-echo fix.

5. [completed] Harden upload source identity, content scanning, and push destination
   - Task ID: T005
   - Depends on: T004 for shared sensitive-output policy
   - Parallel group: G2
   - Risk: high; public publication and filesystem trust boundary
   - Owned scope: `csm-upload/scripts/upload.mjs`, `csm-upload/tests/upload.test.mjs`, `csm-upload/SKILL.md`
   - Not in scope: live Pages deployment verification; OCR implementation unless D6 is expanded; real GitHub publication
   - Spike candidate: synthetic symlink, replacement, unreadable, and binary fixtures in `/tmp`; stub Git/gh only; no credentials.
   - Actions: reject symlink/non-regular sources with no-follow identity checks; scan and copy from one stable descriptor or compare identity/digest before publication; verify effective fetch and push remotes immediately before push; require explicit unscanned-binary acknowledgment and aggregate size/count limits; add disclosure to status output.
   - Acceptance signal: `node --test --test-concurrency=1 csm-upload/tests/upload.test.mjs` exits 0 with symlink rejection, scan/copy replacement rejection, pushurl mismatch refusal, binary acknowledgment, and size-limit tests.
   - Validation: `git diff --check`; `node --check csm-upload/scripts/upload.mjs`.
   - Acceptance evidence: synthetic fixture matrix, destination verification output, and no-publication-on-failure proof.
   - Repair attempts: 0
   - Recovery note: failed publication must preserve the isolated staging clone and never report a public URL as verified.

6. [completed] Define collision-safe run identity for durable document skills
   - Task ID: T006
   - Depends on: none
   - Parallel group: G1
   - Risk: high; persistent artifact ownership
   - Owned scope: `csm-deep-research/SKILL.md`, `csm-make-tests/SKILL.md`, `csm-plan/SKILL.md`, `csm-review/SKILL.md`, `csm-review-python/SKILL.md`, artifact index guidance
   - Not in scope: deleting or renaming existing historical artifacts; silent legacy migration; a mutable “latest” alias
   - Spike candidate: read-only search of repository consumers and synthetic duplicate same-slug lifecycles in `/tmp`.
   - Actions: define validated run ID, root/slug/artifact-type binding, unique draft path, resume ownership, no terminal overwrite, explicit collision refusal, and handoff path recording; apply the rules to the instruction-led writers and their contract validation fixtures; retain legacy artifacts as read-only history and document migration behavior.
   - Acceptance signal: `node --test --test-concurrency=1 tests/resume-semantics.test.mjs tests/lifecycle-contract.test.mjs` exits 0 with positive resume and negative same-day collision fixtures for deep-research, make-tests, plan, and review contracts.
   - Validation: `git grep -n "\.agents/\(research\|tests\|plans\|reviews\)" -- '*.md'` shows updated ownership language; `node --test tests/resume-semantics.test.mjs` remains green.
   - Acceptance evidence: contract matrix mapping each skill's run ID/path/resume rules and negative collision outputs.
    - Repair attempts: 0
    - Completion evidence: Updated five instruction-led contracts, `.agents/README.md`, and lifecycle contract tests; focused resume/lifecycle tests pass. Generated payloads and unrelated runtime surfaces were not touched.
   - Recovery note: if a final artifact exists, refuse replacement and preserve it; never infer ownership from date/slug alone.

7. [completed] Make DDD report/graph publication generation-safe
   - Task ID: T007
   - Depends on: T006
   - Parallel group: G2
   - Risk: high; multi-file consistency and rollback
   - Owned scope: `csm-ddd/lib/ddd/pipeline.mjs`, `csm-ddd/scripts/ddd.mjs`, DDD publication schemas/tests, `csm-ddd/SKILL.md`
   - Not in scope: changing DDD extraction hypotheses or graph semantics; deleting partial prior artifacts
   - Spike candidate: synthetic concurrent writers and failures after report/graph installation in `/tmp` fixture repo.
   - Actions: inventory all DDD report/graph readers; add ownership-aware output-pair lock; write immutable generation directory/files; publish one manifest/pointer containing matching run ID and digests; make the CLI and readers use/validate that manifest; preserve last complete pair; handle partial prior state and abandoned locks explicitly without deleting evidence.
   - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1 test/publication.test.mjs test/cli.test.mjs` exits 0 with concurrent-writer, mixed-generation-reader, partial-prior-pair, stale-lock, and failure-injection tests.
   - Validation: `make test-ddd`; `make check`.
   - Acceptance evidence: generation manifest sample, injected-failure state, and pair-reader validation output.
   - Repair attempts: 0
   - Recovery note: rollback restores only artifacts owned by the current generation; last complete manifest remains authoritative.

8. [completed] Synchronize skill contracts and repository documentation
   - Task ID: T008
   - Depends on: T001-T007
   - Parallel group: G3
   - Risk: low; truth-layer changes with public guidance impact
   - Owned scope: affected `SKILL.md` files, `README.md`, `.agents/README.md`, and non-release contract docs
   - Not in scope: behavior changes or hand-editing generated payload copies
   - Spike candidate: none; source behavior and selected policy must be settled by dependencies.
   - Actions: align write allowlists with delegated research; anchor `csm-bdd-tdd` default specs to the git root and store repository-relative paths (F-011); replace free-form shell interpolation with a prompt-file or argv-safe tmux launcher and exact-request receipt check in csm-plan/build/bdd/review templates (F-012); correct csm-build's optional-commit output claim (F-020); document run IDs/collision refusal; state browser/upload restrictions and unscanned binary policy; document truthful trusted-local posture and corrected CI/release claims.
   - Acceptance signal: `node scripts/sync-skill-boilerplate.mjs --check && node scripts/gen-readme-matrix.mjs --check && node --test --test-concurrency=1 tests/lifecycle-contract.test.mjs tests/resume-semantics.test.mjs && make check` exits 0.
   - Validation: targeted `git grep` assertions for removed stale claims and required policy phrases.
   - Acceptance evidence: documentation diff, generated-region checks, and finding-to-contract traceability table.
   - Repair attempts: 0
   - Recovery note: use source skill files as authority; regenerate managed sections instead of manual patching.

9. [completed] Regenerate and validate bootstrap payload parity
   - Task ID: T009
   - Depends on: T008
   - Parallel group: G3
   - Risk: standard; packaging integrity
   - Owned scope: generated `bootstrap/package/payload/**`, `bootstrap/payload-index.json`, package audit fixtures only through canonical scripts
   - Not in scope: production signing, key rotation, publication, or manual generated-file edits
   - Spike candidate: isolated pack twice and compare digest/bytes/files; no release publish.
   - Actions: run canonical packer, inspect the authoritative source-to-payload pathset, update index, and classify each changed surface as packaged, source-only, or documentation-only; assert that intentionally excluded runtime implementations remain excluded.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs && node scripts/pack-bootstrap.mjs && make test-package-index && node --test --test-concurrency=1 tests/package-audit.test.mjs` exits 0 with identical deterministic summaries and expected pathset parity.
   - Validation: `make check`; `git diff --check`.
   - Acceptance evidence: pack digests, file/index parity output, and generated diff review.
   - Repair attempts: 0
   - Recovery note: if generated drift is unexpected, stop and inspect source authority; do not hand-edit payloads.

10. [completed] Pin CI workflow and supported toolchain inputs
   - Task ID: T010
   - Depends on: none
   - Parallel group: G1
   - Risk: standard; supply-chain gate behavior
   - Owned scope: `.github/workflows/ci.yml`, `.node-version`, `package.json`, `pnpm-lock.yaml`, static check tests
   - Not in scope: changing application runtime support outside declared Node range; selecting action SHAs without verifying tag ownership.
   - Spike candidate: resolve current approved Node 22 patch and action commit SHAs from authoritative owners in a read-only retrieval; record dates and compatibility.
   - Actions: pin actions to verified full SHAs; align `.node-version`, setup-node, and release evidence to approved Node patch; exact-pin root gate tools including `oxfmt`; pin/verify pnpm/Corepack integrity where supported; add static policy checks.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 with negative fixtures for tag/range drift and positive current policy.
   - Validation: `make fmt-check && make lint`.
   - Acceptance evidence: tag-to-SHA and runtime/toolchain matrix with source/date.
   - Repair attempts: 0
   - Recovery note: if an action SHA or runtime patch is unavailable, block this task rather than substituting a floating reference.

11. [completed] Add dependency-audit and provenance-ready release gates
   - Task ID: T011
   - Depends on: T010
   - Parallel group: G4
   - Risk: standard; release and supply-chain policy
   - Owned scope: `.github/workflows/`, `Makefile`, `bootstrap/release-checklist.md`, `bootstrap/package.json`, release/audit tests
   - Not in scope: actual npm publication, trusted-publisher configuration, key rotation, or registry replay
   - Spike candidate: run approved audit only in an isolated credential-free environment; record unavailable advisories rather than claiming clean status.
   - Actions: add non-mutating dependency audit with documented high/critical failure policy; add only a `workflow_dispatch`-only, protected-environment provenance workflow template with no ordinary push/PR publish trigger; require clean checkout, approved artifact digest, and manual approval before any future `npm publish --provenance`; add repository metadata prerequisites without publishing.
   - Acceptance signal: `node scripts/check-suite.mjs && node --test --test-concurrency=1 tests/evals/evals.test.mjs` exits 0 with fixtures proving ordinary push/PR events cannot reach a publish step and `make check` remains green.
   - Validation: inspect workflow permissions and run `pnpm audit --audit-level=high` only in approved isolated build context; audit high/critical findings fail the release gate, audit outage blocks release but does not make ordinary CI claim clean status; do not publish.
   - Acceptance evidence: policy output, release checklist diff, and provenance prerequisite matrix.
   - Repair attempts: 0
   - Recovery note: audit availability failures remain explicit; provenance workflow must never silently fall back to token publication.

12. [completed] Add cross-surface regression and security tests
   - Task ID: T012
   - Depends on: T001-T007
   - Parallel group: G4
   - Risk: high; independent assurance of security boundaries
   - Owned scope: focused tests for autoresearch, browse, upload, artifact contracts, and DDD publication; shared test fixtures only
   - Not in scope: weakening assertions to preserve old unsafe behavior; browser E2E or real publication
   - Spike candidate: none beyond dependencies' synthetic fixtures.
   - Actions: ensure every acceptance boundary has positive and negative tests; add interruption/concurrency/failure injection; add secret non-echo and no-publication-on-failure assertions; include contract collision fixtures and static workflow trigger fixtures.
   - Acceptance signal: `make test-autoresearch && make test-ddd && make test-upload && make test-browse-unit` exits 0 and named regression assertions prove no planted secret appears in stdout/stderr/error output.
   - Validation: inspect each focused suite's named regression cases and verify all synthetic temp paths are cleaned.
   - Acceptance evidence: focused test manifest and pass output.
   - Repair attempts: 0
   - Recovery note: tests must use synthetic temp state and clean it after each case; preserve failing fixture for diagnosis.

13. [completed] Run integration, documentation, packaging, and full repository gates
   - Task ID: T013
   - Depends on: T008-T012
   - Parallel group: final integration
   - Risk: standard; broad regression gate
   - Owned scope: no new source ownership; integration validation and generated artifact review
   - Not in scope: live external publication or production service calls
   - Spike candidate: none.
   - Actions: record pre-task pathset/digest baseline for generated files and workflows; run synchronization checks, package/index checks, deterministic pack, targeted suites, and full `make test`; on interruption, compare the baseline and rerun only the canonical generator for owned paths; investigate failures without mutating unrelated user changes.
   - Acceptance signal: `make fmt-check && make lint && make check && make test-package-index && make test-deterministic && make test` exits 0.
   - Validation: `git diff --check`; verify only intended source/generated/test/docs files changed.
   - Acceptance evidence: complete command transcript and test counts.
   - Repair attempts: 0
   - Recovery note: resume from the failed gate; generated partial state is detected by pathset/digest comparison and recovered only through the canonical packer; do not rerun destructive or publishing steps because none are part of this task.

14. [completed] Independent final security/release review and completion evidence
   - Task ID: T014
   - Depends on: T013
   - Parallel group: final review
   - Risk: high; independent approval boundary
   - Owned scope: review artifacts and plan completion evidence only
   - Not in scope: fixes discovered by this review; those become a new plan/build repair cycle.
   - Spike candidate: none.
   - Actions: independently review T001-T013 and T015 diffs against every upheld finding and selected policy; verify generated payload parity, no secret-bearing test output, lock/manifest invariants, workflow trigger safety, and release claims.
   - Acceptance signal: an independent reviewer records no unresolved high-risk finding and `git diff --check` passes.
   - Validation: re-run the narrowest affected tests for each review finding; verify protected-state baseline and intended diff.
   - Acceptance evidence: signed-off review matrix, residual-risk list, and final gate transcript.
   - Repair attempts: 0
   - Recovery note: any unresolved high-risk issue returns to the owning task or creates a new blocked decision; do not mark complete by waiver silently.

15. [completed] Bound DDD clarification input and orchestration transport contracts
   - Task ID: T015
   - Depends on: none
   - Parallel group: G1
   - Risk: standard; untrusted input and command-transport boundary
   - Owned scope: `csm-ddd/lib/ddd/clarify.mjs`, question-file parsing in `csm-ddd/lib/ddd/pipeline.mjs`, `csm-ddd/test/clarify.test.mjs`, and DDD input tests
   - Not in scope: DDD report/graph publication ownership (T007), graph extraction semantics, or executing tmux commands
   - Spike candidate: synthetic oversized/deeply nested question files and hostile answer envelopes in `/tmp`; read-only command-string inspection for tmux templates.
   - Actions: enforce question-file byte/count/depth limits before parsing; validate strict top-level envelope and reject extra/unbounded values; preserve privacy serialization; add hostile input tests. T008 owns the SKILL.md tmux transport wording, while this task verifies the DDD input boundary.
   - Acceptance signal: `cd csm-ddd && node --test --test-concurrency=1 test/clarify.test.mjs test/contracts.test.mjs` exits 0 with oversized, malformed, deep, extra-field, and sensitive-answer fixtures rejected before artifact generation.
   - Validation: `node --check csm-ddd/lib/ddd/clarify.mjs`; `make test-ddd`; confirm no question-file fixture writes outside temp state.
   - Acceptance evidence: pre-parse rejection matrix, bounded-resource diagnostics, and focused test output.
    - Repair attempts: 0
    - Recovery note: preserve existing question-file behavior for valid bounded inputs; if limits would break a documented valid workflow, block with measured compatibility evidence rather than raising limits globally.

16. [completed] Repair autoresearch timeout, lock replacement, and run-ID identity
    - Task ID: T016
    - Depends on: T003
    - Parallel group: repair-1
    - Risk: high; persistent execution and concurrency boundary
    - Owned scope: `csm-autoresearch/lib/runtime/index.mjs`, `csm-autoresearch/lib/ledger/index.mjs`, `csm-autoresearch/lib/optimizer/index.mjs`, focused tests
    - Not in scope: adding a new sandbox runtime; trusted-local remains explicitly non-hostile trusted-process per D1.
    - Actions: ensure timeout closes/abandons output collection at a hard deadline; use owner-token-safe lock removal/recovery; canonicalize/reject ambiguous run IDs before artifact paths; preserve terminal reports and exact-owner resumes; add deterministic barriers for lock/recovery tests.
    - Acceptance signal: `make test-autoresearch` passes with hard-timeout, replacement-lock, canonical-run-id, terminal-report, and barrier-controlled concurrency cases.
    - Validation: `node --check csm-autoresearch/lib/runtime/index.mjs csm-autoresearch/lib/ledger/index.mjs csm-autoresearch/lib/optimizer/index.mjs`; independent security review.
    - Acceptance evidence: timeout deadline, lock owner token, path-collision matrix, and focused test output.
    - Repair attempts: 0
    - Recovery note: preserve existing ledgers/quarantine/report artifacts; if host containment cannot be proven, retain the documented trusted-process limitation rather than claiming hostile isolation.

17. [completed] Repair browser timeout/output and upload push pinning
    - Task ID: T017
    - Depends on: T004, T005
    - Parallel group: repair-1
    - Risk: high; browser/publication side effects
    - Owned scope: `csm-browse/lib/cdp.mjs`, `csm-browse/lib/verbs/nav.mjs`, `csm-browse/tests/unit/**`, `csm-upload/scripts/upload.mjs`, upload tests
    - Not in scope: widening browser protocol policy or live publication.
    - Actions: redact/reject URL userinfo/query/fragment in navigation output; add a supported CDP cancellation/isolated-context cleanup path on eval timeout; pin upload push to an explicit validated destination under isolated Git config or equivalent final-side-effect check; add deterministic refusal tests.
    - Acceptance signal: `make test-browse-unit && make test-upload` passes with URL-redaction, timeout-cleanup, concurrent-config-change, and no-push-on-mismatch cases.
    - Validation: `node --check csm-browse/lib/cdp.mjs csm-browse/lib/verbs/nav.mjs csm-upload/scripts/upload.mjs`; no real browser/remotes.
    - Acceptance evidence: output redaction assertions, timeout cleanup state, push argv/config trace, and focused suites.
    - Repair attempts: 0
    - Recovery note: refuse unsafe side effects first; never fall back to bare `git push` or unbounded eval.

18. [completed] Repair DDD generation readers, stale locks, paths, and bounded file reads
    - Task ID: T018
    - Depends on: T007, T015
    - Parallel group: repair-1
    - Risk: high; multi-file consistency and input resource safety
    - Owned scope: `csm-ddd/lib/ddd/pipeline.mjs`, `csm-ddd/scripts/ddd.mjs`, DDD contracts/tests
    - Not in scope: changing graph semantics or deleting legacy artifacts.
    - Actions: make readers consume immutable generation files named by a validated manifest; add owner-token compare/recheck before stale-lock archival; align DDD default artifact paths with run identity or explicitly document/test a deliberate current-publication exception; stat/bounded-read question files before buffering; add barrier-controlled writer/reader/recovery tests.
    - Acceptance signal: `make test-ddd` passes with reader/writer interleaving, stale-lock race, run-path collision, partial pair, and pre-read size rejection tests.
    - Validation: `node --check csm-ddd/lib/ddd/pipeline.mjs csm-ddd/scripts/ddd.mjs`; `make check`.
    - Acceptance evidence: manifest-reader matrix, race barriers, path collision matrix, and retained-artifact recovery output.
    - Repair attempts: 0
    - Recovery note: last complete generation remains authoritative; abandoned generations and locks remain inspectable.

19. [completed] Constrain release artifact identity and document remaining supply-chain assumptions
    - Task ID: T019
    - Depends on: T011
    - Parallel group: repair-1
    - Risk: high; release trust boundary
    - Owned scope: `.github/workflows/release-provenance-check.yml`, release policy tests, `bootstrap/release-checklist.md`
    - Not in scope: actual publication, OIDC token requests, key rotation, or registry replay.
    - Actions: require artifact path beneath workspace/canonical staging directory, reject symlinks/traversal, validate strict digest and package name/version/structure, and explicitly document residual Corepack/registry trust assumptions.
    - Acceptance signal: `node --test --test-concurrency=1 tests/release-policy.test.mjs` passes positive/negative path, symlink, digest, metadata, and trigger fixtures.
    - Validation: `node scripts/check-suite.mjs`; inspect workflow permissions; no publish command.
    - Acceptance evidence: workflow trigger/path matrix and release checklist wording.
    - Repair attempts: 0
    - Recovery note: invalid artifact input fails before any external side effect; no fallback path is added.

20. [completed] Re-run independent repair review and final completion gates
    - Task ID: T020
    - Depends on: T016-T019
    - Parallel group: repair-final
    - Risk: high; completion approval
    - Owned scope: review evidence, plan state, and final gate transcripts only
    - Not in scope: unreviewed fixes or publication.
    - Actions: independent reviewers recheck residual findings and all plan obligations; run full gates with an extended bound; verify protected state, changed-path ownership, source/payload parity, and no unexplained test artifacts; then update T013/T014 and Completion Review.
    - Acceptance signal: `make fmt-check && make lint && make check && make test-package-index && make test-deterministic && make test` exits 0, independent review records no material finding, and `git diff --check` passes.
    - Validation: `git status --short`, `git diff --stat`, generated pathset/digest comparison, and focused repair suites.
    - Acceptance evidence: final review matrix, residual-risk disposition, full gate output, and protected-state check.
    - Repair attempts: 0
    - Recovery note: any unresolved high/critical finding returns to its owning repair task; do not mark completion by waiver.

21. [completed] Close remaining runtime, browser, upload, and packer races
    - Task ID: T021
    - Depends on: T016, T017
    - Parallel group: repair-2
    - Risk: high; process/publication side effects
    - Owned scope: autoresearch runtime/ledger tests, csm-browse cdp/dom/nav tests, csm-upload push path/tests, `scripts/pack-bootstrap.mjs` and package tests
    - Not in scope: new hostile-code sandbox; trusted-local remains a documented trusted-process mode.
    - Actions: bound output-limit termination and close streams; make lock removal replacement-safe; close CDP clients on all error/cancel paths; redact path-bearing navigation output; sanitize staging Git local configuration before explicit push; verify packer tarball filename resolves beneath its temp staging directory; add regression fixtures.
    - Acceptance signal: `make test-autoresearch && make test-browse-unit && make test-upload && node --test --test-concurrency=1 tests/package-audit.test.mjs` passes under Node 22.
    - Validation: `node scripts/check-suite.mjs`, `make lint`, `git diff --check`.
    - Acceptance evidence: stream/lock cleanup, client-close, URL output, config rewrite, and pack path-containment tests.
    - Repair attempts: 0
    - Recovery note: no live child, browser, remote, or package publication; preserve synthetic evidence on failure.

22. [completed] Close DDD lock identity and reader-path residuals
    - Task ID: T022
    - Depends on: T018
    - Parallel group: repair-2
    - Risk: high; multi-file publication consistency
    - Owned scope: csm-ddd publication pipeline/scripts/tests only
    - Not in scope: graph semantics or deletion of prior generations.
    - Actions: use an atomic owner-specific lock protocol that cannot archive a replacement owner; bind pointer/manifest to full normalized report/graph identities or enforce one-directory outputs; reject pointer/manifest symlinks; add a real barrier handshake proving reader/writer interleaving.
    - Acceptance signal: `make test-ddd` passes lock-replacement, symlink, directory-identity, and barrier-handshake tests.
    - Validation: `make check`, node syntax checks, and retained prior-generation inspection.
    - Acceptance evidence: lock protocol matrix, reader path identity matrix, and deterministic barrier output.
     - Repair attempts: 1
      - Recovery note: preserve last complete generation and archive abandoned locks without deleting evidence.

23. [completed] Close final browser status and filesystem race residuals
     - Task ID: T023
     - Depends on: T021, T022
     - Parallel group: repair-3
     - Risk: high; authenticated data and filesystem trust boundaries
     - Owned scope: `csm-browse/lib/verbs/status.mjs`, browser status/input tests, `csm-ddd/lib/ddd/extract.mjs`, DDD extraction tests, `scripts/pack-bootstrap.mjs`, package audit tests
     - Not in scope: live browser, real repositories, publication, or broad capture-path disclosure redesign.
     - Actions: project/redact `currentUrl` before status output; close CDP clients in input/status success and error paths; use no-follow/descriptor or realpath identity checks for DDD extraction reads; make packer copy verify source identity/no-follow before staging.
     - Acceptance signal: `make test-browse-unit && make test-ddd && node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/package-audit.test.mjs` passes URL/client-cleanup and symlink-race fixtures.
     - Validation: `make fmt-check && make lint && make check && git diff --check`.
     - Acceptance evidence: status redaction, client-close, extraction symlink replacement, packer replacement tests.
     - Repair attempts: 0
     - Recovery note: reject raced inputs and preserve staging/previous artifacts; never dereference a replacement path.

24. [in_progress] Complete final state, evidence, review, and commit
     - Task ID: T024
     - Depends on: T020, T023
     - Parallel group: final
     - Risk: high; completion and commit gate
     - Owned scope: plan control/journal/completion sections and commit staging only
     - Not in scope: unresolved external release-environment configuration; no push/publication.
     - Actions: record T013 full gate transcript, T014/T020/T023 independent review results, source/payload pathset and deterministic digest, changed-path ownership, protected-state comparison, residual accepted risks, and final Completion Review; mark all tasks consistently; stage only intended files and commit.
     - Acceptance signal: `make fmt-check && make lint && make check && make test-package-index && make test-deterministic && make test` exits 0; `git diff --check` passes; final review has no unresolved high/medium finding.
     - Validation: `git status --short`, `git diff --stat`, `git diff --name-only`, source/payload mapping, and commit-only verification.
     - Acceptance evidence: complete gate transcript, ownership matrix, protected-state result, review matrix, commit hash.
     - Repair attempts: 0
     - Recovery note: if external `release` environment protection cannot be verified, document it as an operational residual and do not claim production provenance readiness.

## Verification Strategy

- Per-task cheapest-first: syntax checks, focused unit tests, negative fixtures, then subsystem suites.
- Autoresearch validation: `make test-autoresearch` serially after T001-T003; synthetic process/ledger tests must be temp-only and credential-free.
- Browser/upload validation: focused csm-browse, upload, and destination/path tests in parallel only when they own separate files; no Docker or live publication required for unit gates.
- Artifact validation: contract fixtures and DDD publication tests before generated payload regeneration.
- Documentation/package validation: boilerplate sync check, README matrix check, `make check`, package-index audit, and deterministic pack after source stabilization.
- Final repository gates: `make fmt-check`, `make lint`, `make check`, `make test-package-index`, `make test-deterministic`, and `make test`.
- Environment-sensitive checks: csm-browse E2E, live Pages deployment, npm registry replay, and production provenance are explicitly separate and not required for this remediation's completion.
- Completion requires observed command output and independent review evidence, not task status alone.

## Risks And Recovery

- **Trusted-local compatibility risk:** allowlisted snapshots may break undeclared imports. Fail closed with a diagnostic; add only explicitly justified inputs.
- **Process-boundary uncertainty:** if no supported kernel boundary exists, narrow the trusted-local contract and keep generated mode disabled rather than claiming containment.
- **Policy behavior changes:** browser protocols, sensitive output, binary acknowledgment, duplicate-run policy, and trusted-local posture require the D1-D9 build confirmations to be recorded before implementation; declined decisions block only their owning tasks.
- **Artifact migration risk:** preserve existing reports, plans, ledgers, and DDD pairs; new runs use new identity rules; readers must not silently reinterpret old artifacts.
- **DDD failure recovery:** the last complete generation manifest remains authoritative; incomplete generations are retained for diagnosis and never become active.
- **Release risk:** no task publishes, rotates keys, or contacts production; provenance/audit workflow failures remain visible blockers. Audit outage blocks release evidence, while ordinary CI reports availability separately and never claims a clean audit.
- **Unexpected worktree changes:** stop and report; never revert user changes or generated artifacts not owned by the active task.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | --- | --- | --- |
| Exact trusted-local dependency semantics unresolved | high | Added T001 spike, explicit allowlist, fail-closed behavior, and blocker recovery note. | Research R1; T001 |
| Process-group termination is not containment | high | Added T002 capability refusal/verified-boundary requirement and independent review. | Deep research Key Finding 1; T002 |
| Run-level lease decision unresolved | high | Recorded recommended D3 and isolated synthetic two-writer acceptance in T003. | Research R3; T003 |
| Browser navigation and binary policy are product choices | high | Recorded D4-D6 as build confirmations with behavior-specific tests. | Research R4; T004/T005 |
| Deterministic artifact collisions | high | Added shared run identity and no-terminal-overwrite contract in T006; DDD generation manifest in T007. | Deep research Key Finding 5 and Detail Sections; T006/T007 |
| Missing F-011/F-012/F-014/F-020 coverage | critical | Added T015 for DDD pre-parse bounds and expanded T008 for git-root anchoring, argv-safe tmux transport, and optional-commit wording; traceability is explicit. | Review F-011/F-012/F-014/F-020; T008/T015 |
| Contract-only collision remediation | critical | T006 now requires contract fixtures proving negative collision/resume behavior; T007 owns concrete DDD publication behavior and T008 owns contract/docs synchronization. | Deep research Durable artifacts section; T006/T007/T008 |
| Deferred product decisions | high | D1-D9 are recorded as recommended decisions; affected tasks block if declined rather than silently selecting policy. | D1-D9; Control blockers |
| Publish workflow could become executable accidentally | high | T011 is workflow-dispatch-only, protected-environment, digest-bound, and has trigger-safety fixtures; no actual publication occurs. | T011; D10 |
| Release-file ownership overlap | high | T011 exclusively owns release checklist/workflow files; T008 owns non-release contracts/docs; T010 precedes T011. | Execution Graph; T008/T010/T011 |
| Autoresearch guarantees not provable by unit tests | high | T001/T002 require capability refusal or verified boundary, explicit snapshot semantics, and independent review; tests prove only the selected contract. | T001/T002; D1/D2 |
| DDD reader/migration gap | high | T007 inventories readers, defines manifest authority/legacy behavior, and tests mixed-generation readers and partial recovery. | T007; D8 |
| Weak acceptance signals | medium | T004/T005/T006/T007/T011/T012 now name negative evidence and exact commands; T013 adds pathset/digest recovery. | T004-T007, T011-T013 |
| Generated parity ambiguity | medium | T009 requires an explicit authoritative source-to-payload pathset and excluded-surface assertion. | T009 |
| Toolchain rollback underspecified | medium | T010/T011 require current baseline, compatibility matrix, exact rollback criteria, and separate audit-outage behavior. | T010/T011 |
| Parallel ownership overstated | medium | Execution Graph serializes T015/T007, T010/T011, and T008/T009 shared surfaces; no shared writer runs in parallel. | Execution Graph |
| Partial generated/release recovery | medium | T013 records pathset/digest baselines and canonical-generator-only recovery; T011 never publishes. | T011/T013 |
| Research caveats and locator drift | low | R&D caveats remain in unresolved risks; critique references use actual research sections and task IDs rather than invented finding IDs. | R1-R6; Progress Journal |
| CI suite-tooling omission was stale | low | Explicitly removed from scope; current `make test` includes it. | Makefile:79; CI:51-52 |
| Generated payload/source drift risk | standard | Made T009 canonical packer/index task after documentation and source changes. | Repository packaging pattern |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | --- | --- | --- | --- | --- |
| 2026-08-25 | 0 | INTAKE -> DISCOVER | none | Review/research artifacts, HEAD, manifests, gates, tests, and prior plan patterns inspected. | RESEARCH |
| 2026-08-25 | 0 | DISCOVER -> RESEARCH | none | Three uncertainty scouts returned feasible designs, unresolved decisions, and safe synthetic-spike requirements. | DRAFT |
| 2026-08-25 | 0 | RESEARCH -> DRAFT | none | Evidence mapped to six ownership domains and 15 dependency-ordered tasks. | CRITIQUE |
| 2026-08-25 | 0 | CRITIQUE -> REMEDIATE | none | Independent critique found missing F-011/F-012/F-014/F-020 coverage, collision behavior gaps, release-trigger risk, and inaccurate counts. | VERIFY |
| 2026-08-25 | 1 | REMEDIATE -> VERIFY | none | Added T015, expanded T006/T007/T008/T011-T013, corrected ownership/parallelism/counts, and recorded policy and write-discipline blockers. | BLOCKED |
| 2026-08-25 | 1 | RECOVER -> VALIDATE | none | Explicit build request received; plan format and applicability were re-read, worktree remains uncommitted with the preserved scout artifact. | BLOCKED |
| 2026-08-25 | 1 | VALIDATE -> BLOCKED | none | Cannot safely dispatch: extra plan artifact requires user disposition and D1-D9 behavior/release decisions are not confirmed. No implementation started. | BLOCKED |
| 2026-08-25 | 1 | RECOVER -> VALIDATE | none | User approved merge of the scout browser/upload plan and confirmed D1-D9 defaults; applicability and task dependencies are being revalidated. | VALIDATE |
| 2026-08-25 | 1 | VALIDATE -> SELECT | none | `node scripts/check-suite.mjs` passed: 1160 checks; payload drift compared 160 with no issues. Ready set is T001, T004, T006, T010, T015. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T001,T004,T006,T010,T015 | Non-overlapping ownership confirmed; security/public-interface tasks require independent review. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> CHECKPOINT | T006 | Implemented run-ID-suffixed paths, exact owner resume, terminal replacement refusal, delegated research ownership, and collision contract tests. Focused acceptance passed; `make check` remains the final gate. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> SELECT | T002,T005,T007 | T002 autoresearch 59 tests, T005 upload 19 tests, and T007 DDD 61 tests passed; dependencies satisfied. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T002,T005,T007 | Non-overlapping runtime, upload, and DDD publication ownership dispatched. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> CHECKPOINT | T002,T003,T005,T007 | T003 ledger/optimizer 62 tests, T005 upload 19 tests, and T007 DDD 61 tests passed; payload synchronization remained pending. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> SELECT | T008,T012 | T008 docs/contracts and T012 regression-test ownership ready; T009 follows T008. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T008,T012 | Documentation and regression-test tasks dispatched with disjoint ownership. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> CHECKPOINT | T008,T009,T010,T011,T012 | Payload pack deterministic; `make check`, `make lint`, `make fmt-check`, release/toolchain policy tests, and focused security suites pass. One plan transition metadata defect was repaired; lifecycle/resume tests now 16/16. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> REPAIR | T016-T020 | Independent review found residual runtime/browser/upload/DDD/release issues and missing final evidence; repair cycle opened. | REPAIR |
| 2026-08-25 | 1 | REPAIR -> SELECT | T016-T019 | Four scoped repair tasks selected from independent findings. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T016-T019 | Non-overlapping repair ownership dispatched. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> CHECKPOINT | T016-T019 | Repair suites passed: autoresearch 66, browse 202, upload 20, DDD 64, release policy 6; static/package gates passed after formatting and payload regeneration. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> REPAIR | T021-T022 | Fresh review found output/lock/client/path residuals; second repair cycle opened. | REPAIR |
| 2026-08-25 | 1 | REPAIR -> SELECT | T021-T022 | Two scoped repair tasks selected. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T021-T022 | Runtime/browser/upload/packer and DDD publication repair ownership dispatched. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> CHECKPOINT | T021-T022 | Repair suites and full `make test` passed; payload parity and static gates passed. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> REPAIR | T023 | Final review found browser status/client and filesystem source-race residuals; final repair opened. | REPAIR |
| 2026-08-25 | 1 | REPAIR -> SELECT | T023 | T023 selected for final residuals. | SELECT |
| 2026-08-25 | 1 | SELECT -> DISPATCH | T023 | Final browser/status/extraction/packer repair dispatched. | DISPATCH |
| 2026-08-25 | 1 | DISPATCH -> REVIEW | T023 | Browse 205, DDD 68, package audit 4, formatting/lint/check and deterministic pack passed. | REVIEW |
| 2026-08-25 | 1 | REVIEW -> CHECKPOINT | T014,T020,T023 | Final independent security review found no actionable findings; full `make test` passed; protected-state/path ownership and completion evidence recorded. | CHECKPOINT |
| 2026-08-25 | 1 | CHECKPOINT -> COMPLETE | T024 | All tasks complete, acceptance evidence recorded, residual risks explicit, and commit-only staging prepared. | COMPLETE |

## Completion Review

Implementation complete; no live publication, deployment, key rotation, registry replay, or production release occurred.

- T013 evidence: `make fmt-check`, `make lint`, `make check`, `make test-package-index`, `make test-deterministic`, and `make test` all passed. The final full suite included hooks 8, bootstrap 62, suite tooling 48, evals 17, browse 205, upload 20, package audit 4, DDD 68, autoresearch 66, and csm-scan 1283 tests.
- Payload evidence: final deterministic pack SHA-256 `0bbcb40d5c44cf225730c6c053ef3d7fcd0134f1341cd189e10fd1183e8e7f4a`, 648201 bytes, 164 files; repeated pack matched; source/payload pathset compared 160 with zero issues; excluded runtime/test surfaces remained excluded.
- T014/T020/T023 evidence: independent final security review found no actionable severity findings. Accepted residuals are documented: trusted-local is not hostile-process isolation; DOM/eval remains explicitly powerful; binary media requires acknowledgment without OCR/metadata inspection; production release-environment protection and provenance execution remain external.
- Protected state: all changes are confined to the plan-owned source, tests, docs, CI/release, generated payload/index, and plan artifact. The pre-existing review/research artifacts remain uncommitted and were not included in the implementation commit.
- Implementation commit: `47d7ce7` (`harden skill execution and publication boundaries`).
- Commit scope: intended implementation, generated payloads, tests, docs, workflow, and this plan; `.agents/reviews/2026-08-25-opencode-skills-review.md` and `.agents/research/2026-08-25-repo-issues-deep-research-research.md` remain uncommitted evidence artifacts.
