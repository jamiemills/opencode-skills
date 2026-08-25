format: csm-review/1

# Repository Review — opencode-skills @ a63411f (2026-08-25)

## Control

- Review scale: FULL audit.
- Target: local repository at the git root.
- Pinned commit: `a63411f334171e20fd480eacf60685b353f9aa5f`.
- Worktree baseline: clean at intake; no reviewed source files changed.
- Posture: R0 static only. No repository code was executed by this review.
- Journal:
  - `[2026-08-25T07:40:00Z] INTAKE -> SCOPE :: cycle 0 :: trigger: explicit csm-review request :: rungs: R0`
  - `[2026-08-25T07:42:00Z] SCOPE -> EVIDENCE :: cycle 0 :: trigger: repository, manifests, CI, prior report, and package surfaces enumerated :: rungs: R0`
  - `[2026-08-25T07:45:00Z] EVIDENCE -> FIND :: cycle 0 :: trigger: current-commit static evidence collected :: rungs: R0`
  - `[2026-08-25T07:52:00Z] FIND -> CHALLENGE :: cycle 0 :: trigger: raw findings ledger complete :: rungs: R0`
  - `[2026-08-25T07:58:00Z] CHALLENGE -> ADJUDICATE :: cycle 0 :: trigger: independent challenges returned :: rungs: R0`
  - `[2026-08-25T08:02:00Z] ADJUDICATE -> VERIFY :: cycle 0 :: trigger: findings deduplicated and ordered :: rungs: R0`
  - `[2026-08-25T08:05:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: schema, citation, redaction, coverage, and protected-state checks passed :: rungs: R0`

## How To Execute

This report is review-only and fixes nothing. Apply remediation through a future explicit `csm-plan`, `csm-grill`, or other human-mediated implementation flow. Do not treat this report as authorization to commit or publish.

## Executive Summary

- The most serious risks are uncontained trusted-local/autoresearch execution, unsafe browser data output, and publication destinations that are not pinned through the final push.
- Concurrent artifact writers can corrupt or mix DDD report/graph generations, and concurrent autoresearch writers can defeat the ledger lock.
- Several skill contracts still disagree about delegated writes, artifact collisions, repository-root paths, and optional commits.
- Release and CI controls are strong in several areas, but suite-tooling coverage, exact-pin policy, runtime patch reproducibility, and registry replay remain incomplete.
- Findings are ordered by severity and confidence; severity is impact if true, while confidence is evidence strength.

## Methodology Disclosure

Four independent static finder tracks reviewed orchestration contracts, analyzers/optimizer, browser/publication, and packaging/documentation. Three independent challenger tracks attempted to disprove material findings. Evidence was checked against the pinned commit, nearby call sites, schemas, tests, manifests, CI, and the previous review only as historical context. No source code was executed, no package install or network audit was run, and no external anchor editions were re-fetched. Secrets, personal data, raw identities, and absolute paths are omitted. The tmux review session was `csm-review-repository-audit`.

## Coverage

| Dimension group | Surfaces | Result |
|---|---|---|
| Correctness, architecture, smells, anti-patterns | All 13 skill docs; shared contracts and lifecycle descriptions | Findings F-006 to F-010, F-014, F-015 |
| Security, secrets, trust boundaries, resource safety | autoresearch, browse, upload, bootstrap | Findings F-001 to F-005, F-011 to F-013 |
| Concurrency and resilience | autoresearch ledger/optimizer; DDD pipeline; artifact promotion | Findings F-003, F-004, F-007, F-008 |
| Tests and test adequacy | Makefile, CI, suite/tooling tests, skill tests | Finding F-017; residual test gaps in Anti-Coverage |
| Dependencies and toolchain | root manifests, lockfiles, Node/pnpm declarations, CI | Findings F-018, F-019; vulnerability/EOL queries not run |
| Observability, CI, build, docs, licensing | README, release checklist, CI, bootstrap scripts | Findings F-016 to F-020 |

## Anti-Coverage

- OSV vulnerability and endoflife.date queries were not run; dependency and runtime currency conclusions are limited to declarations and CI configuration.
- R1-R3 sandbox installation, test collection, bounded execution, egress probes, race checks, and mutation checks were not run.
- External anchor URLs and editions were not re-fetched.
- Production GitHub, Pages, npm registry, key custody, browser container, and deployment configuration were not inspected.
- Generated/vendor/binary artifacts were not exhaustively content-reviewed; binary publication inspection is explicitly limited by the implementation.

## Findings Summary

| Severity | Count |
|---|---:|
| High | 9 |
| Medium | 10 |
| Low | 1 |
| Total upheld | 20 |

Evidence distribution: all 20 findings are E2 (independently challenged and upheld). No E1 tool-reproduced findings were claimed. Raw findings were 29 before semantic deduplication; 20 were upheld, 9 were retracted or merged.

## Findings

### F-001. Trusted-local autoresearch does not enforce declared network, memory, or process isolation

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: security implementation weaknesses
- Category: execution boundary
- Anchor ref: CWE-400
- Locations: `csm-autoresearch/schemas/run-contract.schema.json:64-73`; `csm-autoresearch/lib/runtime/index.mjs:137-144`; `csm-autoresearch/lib/providers/trusted-local.mjs:157-177`
- Quoted snippet: `maxMemoryMb`, `maxProcesses`, and network controls are rejected or recorded rather than enforced.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The contract exposes resource and network limits, but trusted-local executes the candidate in a normal local process. Timeout and output/workspace checks exist; the defect is the missing OS-level enforcement for network, memory, and process count.
- Impact: Candidate code can access network services and credentials and can consume unbounded memory or spawn processes despite the advertised policy.
- Remediation sketch: Refuse execution unless the selected provider proves the requested isolation, or make the weaker trusted-process mode explicit and remove unsupported guarantees.
- Challenges: agree; narrowed from “all limits are unenforced” because timeout/output/workspace checks are present.
- Dissent: none.
- Status: upheld
- Status note: independent challenger agreed with the narrowed formulation.

### F-002. Trusted-local snapshots expose the entire workspace to candidate code

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: secrets and data exposure
- Category: workspace isolation
- Anchor ref: CWE-922
- Locations: `csm-autoresearch/lib/providers/trusted-local.mjs:50-60,157-177`; `csm-autoresearch/lib/runtime/index.mjs:50-65`
- Quoted snippet: `snapshotWorkspace(root, trial)` recursively copies the workspace before candidate execution.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The snapshot copies non-symlink entries recursively without excluding `.env` files, evaluator assets, policies, audit data, or unrelated repository files. The candidate then runs with that copied workspace as its working directory.
- Impact: A candidate can read secrets and data outside its declared mutation boundary.
- Remediation sketch: Construct a minimal allowlisted snapshot from candidate inputs and permitted paths; reject credential, evaluator, policy, fixture, and audit paths.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-003. Autoresearch ledger lock cleanup can remove another writer's lock

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: concurrency and races
- Category: lock ownership
- Anchor ref: CWE-667
- Locations: `csm-autoresearch/lib/ledger/index.mjs:206-245`
- Quoted snippet: cleanup unlinks `this.lockPath` even when exclusive lock creation failed with `EEXIST`.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: A writer that does not acquire the exclusive lock still reaches unconditional cleanup. It can therefore delete the active lock held by another writer.
- Impact: Concurrent appenders can enter the critical section and corrupt ledger sequencing or provenance.
- Remediation sketch: Track successful ownership locally and unlink only an owned lock; add owner metadata and stale-lock recovery.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-004. DDD artifact publication is not concurrency-safe

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: concurrency and races
- Category: publication atomicity
- Anchor ref: CWE-362
- Locations: `csm-ddd/lib/ddd/pipeline.mjs:136-155`
- Quoted snippet: existing report and graph are backed up, then report and graph are installed in separate renames.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The sequence is failure-atomic for one writer but has no output-pair lock or compare-and-swap boundary. Two writers can interleave backups and installs.
- Impact: Consumers can observe mismatched report/graph generations, or one failed writer can restore/delete another writer's artifacts.
- Remediation sketch: Add an output-pair lease and generation manifest, then publish through one coordinated swap with generation-aware rollback.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-005. Browser input echoes complete typed text

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: secrets and data exposure
- Category: credential logging
- Anchor ref: CWE-532
- Locations: `csm-browse/lib/verbs/input.mjs:76-104`; `csm-browse/SKILL.md:93-99`
- Quoted snippet: `console.log(JSON.stringify({ typed: text, selector: sel }));`
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The documented login flow uses the same typing verb for passwords, and normal success output includes the full text. Error redaction does not protect this path.
- Impact: Passwords and other secrets can enter terminal scrollback, agent transcripts, CI logs, and evidence records.
- Remediation sketch: Return selector and character count only; require an explicit secret-input mode that never echoes content.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-006. Browser DOM and eval verbs can emit unredacted sensitive page data

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: security implementation weaknesses
- Category: browser data extraction
- Anchor ref: CWE-200
- Locations: `csm-browse/lib/verbs/dom.mjs:43-45,72-74,80-92`; `csm-browse/lib/cdp.mjs:159-164`
- Quoted snippet: page text, HTML, and evaluation results are printed with only a size cap.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The browser deliberately exposes powerful DOM and JavaScript operations, but there is no sensitivity classification or approval boundary for private page contents, storage, or credentials rendered in the page.
- Impact: A prompt injection, mistaken command, or broad selector can disclose authenticated account data and secrets.
- Remediation sketch: Gate `eval` and full-DOM extraction separately, classify/redact output, and require explicit approval for credential and storage access.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-007. Upload validation does not pin the final Git push destination

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: security implementation weaknesses
- Category: publication destination integrity
- Anchor ref: CWE-345
- Locations: `csm-upload/scripts/upload.mjs:549-557,593-595`; `csm-upload/SKILL.md:68`
- Quoted snippet: the script validates `git remote get-url origin` and then invokes bare `git push`.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The fetch/origin URL is checked, but push URLs and Git rewrite/configuration mechanisms are not checked immediately before publication. A configured push URL can differ from the validated origin.
- Impact: Evidence intended for one Pages repository can be pushed to another destination, contradicting the “never pushes elsewhere” contract.
- Remediation sketch: Reject configured push URLs, isolate Git configuration, compare effective push destination, and pass an explicit pinned destination to the final push.
- Challenges: agree.
- Dissent: confidence was medium in one challenge because exploitability depends on Git configuration, but the defect remains deterministic.
- Status: upheld

### F-008. Parent write allowlists do not account for delegated deep-research artifacts

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: architecture and technical debt
- Category: delegated write contract
- Anchor ref: null
- Locations: `csm-grill/SKILL.md:30,56-62`; `csm-plan/SKILL.md:51-55,162`; `csm-deep-research/SKILL.md:107-112`
- Quoted snippet: parent skills allow dispatching research while describing only their own approach/plan as persistent writes.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: Deep research writes `.agents/research/` artifacts, but the parent contracts do not define a delegated-write exception, ownership, cleanup, or verification rule.
- Impact: A compliant invocation must either violate a parent allowlist or fail to persist the evidence needed by the handoff.
- Remediation sketch: Declare delegated research paths in the parent allowlist and specify ownership and verification.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-009. csm-plan can overwrite an existing final plan on promotion

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: correctness and defects
- Category: artifact collision
- Anchor ref: CWE-23
- Locations: `csm-plan/SKILL.md:52,224`
- Quoted snippet: the deterministic final path is populated by renaming the draft without a collision-safe ownership check.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: Same-day or duplicate invocations can target the same final plan path. The documented rename does not require the destination to be absent or prove that an existing file belongs to the same draft.
- Impact: A prior plan and its durable execution state can be destroyed.
- Remediation sketch: Refuse promotion when the destination exists unless ownership is proven; otherwise use an explicit collision-safe run identifier.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-010. csm-review can overwrite a completed report at the deterministic path

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: resilience and error handling
- Category: report collision
- Anchor ref: CWE-642
- Locations: `csm-review/SKILL.md:56,83,114-120`; `csm-review-python/SKILL.md:135-143`
- Quoted snippet: only pre-SAVED reports are resumed; intake otherwise scaffolds the same deterministic path.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: A completed same-day review has no collision policy. A rerun can overwrite a prior audit rather than refuse, version, or require explicit replacement.
- Impact: Findings history and audit evidence can be silently lost.
- Remediation sketch: Refuse terminal-report overwrite; require explicit replacement or add a collision-safe run suffix while retaining resume semantics.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-011. csm-bdd-tdd resolves default specs relative to the current directory

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: correctness and defects
- Category: path anchoring
- Anchor ref: CWE-23
- Locations: `csm-bdd-tdd/SKILL.md:61-63,113-115,200-203`
- Quoted snippet: default specs are `specs/<goal-slug>/` “in the current working directory.”
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The mutated plan is rooted at the repository `.agents/plans/` path, while the default specs path depends on invocation cwd. Running from a subdirectory can create artifacts outside the intended root or leave ambiguous references for later build sessions.
- Impact: Specs can be misplaced, omitted from the intended change, or resolved differently by the consumer.
- Remediation sketch: Resolve defaults from the git root, store normalized repository-relative paths, and reject outside-root paths without explicit approval.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-012. Tmux bootstrap interpolates unescaped user prompts into shell code

- Severity: high
- Confidence: high
- Evidence class: E2
- Dimension: input validation and trust boundaries
- Category: command construction
- Anchor ref: CWE-78
- Locations: `csm-plan/SKILL.md:28-31`; `csm-build/SKILL.md:28-31`; `csm-review/SKILL.md:28-31`; `csm-bdd-tdd/SKILL.md:28-31`
- Quoted snippet: `tmux new-session ... 'opencode run "<original request>"'` is specified without escaping rules.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: A request containing a single quote or shell substitution can break the quoting and alter the detached command. The instructions do not define an argv-safe transport or exact-request verification.
- Impact: Detached sessions may execute a truncated or attacker-altered request, including unintended shell syntax.
- Remediation sketch: Use a temporary prompt file or argv-safe launcher, strictly quote the file path, and verify exact prompt receipt.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-013. Upload publication scans only selected text, not binary evidence content

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: secrets and data exposure
- Category: publication review gap
- Anchor ref: CWE-200
- Locations: `csm-upload/scripts/upload.mjs:56-82,468-470`; `csm-upload/tests/upload.test.mjs:446-470`
- Quoted snippet: binary media and metadata embedded inside binary containers remain outside the scan guarantee.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: Screenshots and videos are primary upload types, but validation checks filenames and selected text extensions rather than image/video pixels, OCR, or embedded metadata. The limitation is disclosed, but confirmation still permits publication.
- Impact: Public history can contain credentials, private data, or internal URLs visible only in binary evidence.
- Remediation sketch: Add OCR/metadata inspection where feasible, require per-artifact classification, and make unscanned binary publication an explicit high-friction decision.
- Challenges: downgrade from high to medium; the limitation is documented.
- Dissent: none.
- Status: upheld

### F-014. DDD clarification parses an unbounded question file before applying bounds

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: memory and resource safety
- Category: input size bounds
- Anchor ref: CWE-400
- Locations: `csm-ddd/lib/ddd/pipeline.mjs:29-32`; `csm-ddd/lib/ddd/clarify.mjs:30-70`
- Quoted snippet: the question file is fully read and parsed before question-count and answer construction limits apply.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: Answer values and persisted serialization have useful bounds, but the input file itself has no byte limit before parsing and synthesis. A large or deeply nested JSON file can consume resources before validation rejects it.
- Impact: Local analysis can suffer avoidable memory or CPU exhaustion from an untrusted question file.
- Remediation sketch: enforce file byte limits before parsing, validate a strict top-level envelope, and cap synthesis inputs before constructing questions.
- Challenges: downgrade from high to medium; privacy controls cover the persisted answer path better than initially claimed.
- Dissent: none.
- Status: upheld

### F-015. Autoresearch output and workspace caps are detected after candidate execution

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: memory and resource safety
- Category: post-hoc resource enforcement
- Anchor ref: CWE-400
- Locations: `csm-autoresearch/lib/runtime/index.mjs:166-180,221-232`
- Quoted snippet: workspace size is measured after execution and stdout/stderr limits are checked independently.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: A candidate can exceed workspace limits before detection, and separate output caps permit roughly twice the advertised aggregate budget. Timeout enforcement does not prevent this resource spike.
- Impact: A malicious or faulty candidate can consume disk or output buffers before the runtime reacts.
- Remediation sketch: enforce growth and combined output budgets during execution, terminating at the first aggregate breach.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-016. Release packing does not prove provenance of audited bytes

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: CI, build, docs and licensing
- Category: release provenance
- Anchor ref: null
- Locations: `scripts/pack-bootstrap.mjs:208-209,325-333`; `bootstrap/release-checklist.md:10-12`
- Quoted snippet: release mode validates keyring metadata but does not compare the output with an approved digest or require a clean checkout.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: A release pack can be regenerated from a changed working tree and still pass the release-only keyring checks. The checklist asks for deterministic output but does not bind publication to an immutable approved artifact.
- Impact: Bytes different from the reviewed or approved package can be published under release procedures.
- Remediation sketch: require clean status, expected source/index digests, recorded tarball digest/size, and separate explicit approval of the exact artifact.
- Challenges: agree with high confidence; severity retained medium because publication remains separately gated.
- Dissent: none.
- Status: upheld

### F-017. CI omits the suite-tooling test battery

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: test presence and coverage
- Category: CI coverage gap
- Anchor ref: null
- Locations: `Makefile:43-44,79`; `.github/workflows/ci.yml:41-54`
- Quoted snippet: `test-suite-tooling` is defined separately and is not included in `make test` or CI.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: Tests for check-suite, cache health, and worktree-session behavior exist but are not part of the primary gate. Regressions in these release-critical tools can therefore pass CI.
- Impact: The repository can report green CI while suite orchestration or worktree safety tests are stale or broken.
- Remediation sketch: add `make test-suite-tooling` to CI or include it in the primary `make test` target.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-018. README exact-pin policy conflicts with the root manifest

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: toolchain and language currency
- Category: dependency policy inconsistency
- Anchor ref: null
- Locations: `package.json:5-8`; `README.md:535-539`
- Quoted snippet: README says root gate tooling uses exact pins, while `oxfmt` is declared as `^0.64.0`.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The lockfile currently freezes a resolution, but the manifest permits a compatible formatter update during lockfile refresh. That differs from the documented exact-pin policy.
- Impact: Formatting and gate behavior can change without an intentional exact-version manifest change.
- Remediation sketch: pin `oxfmt` exactly or revise the policy to state that only lockfile resolution is pinned.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-019. CI and local toolchain are not patch-version reproducible

- Severity: medium
- Confidence: high
- Evidence class: E2
- Dimension: toolchain and language currency
- Category: runtime drift
- Anchor ref: null
- Locations: `.node-version:1`; `.github/workflows/ci.yml:17-24`; `bootstrap/release-checklist.md:10-12`
- Quoted snippet: repository and CI select Node `22`, not a specific Node 22 patch release.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: CI resolves a moving Node 22 patch version while release evidence requires recording exact toolchain metadata. Local and CI behavior can therefore differ over time.
- Impact: Reproducibility failures and unexplained gate changes can arise from runtime patch drift.
- Remediation sketch: pin a supported Node 22 patch consistently, or explicitly accept patch drift and retain CI toolchain evidence.
- Challenges: agree.
- Dissent: none.
- Status: upheld

### F-020. csm-build interface claims committed output when commits are optional

- Severity: low
- Confidence: high
- Evidence class: E2
- Dimension: architecture and technical debt
- Category: contract wording
- Anchor ref: null
- Locations: `csm-build/SKILL.md:53,142-146,337,357`
- Quoted snippet: interface says “verified implementation with commits,” while completion permits intentionally uncommitted work.
- Commit SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`
- Explanation: The execution rules correctly require explicit commit authorization, but the interface overstates what a successful run produces.
- Impact: Consumers may infer that a completed build always has a commit when it may only have working-tree changes.
- Remediation sketch: describe verified implementation with optional authorized commit and expose commit state explicitly.
- Challenges: agree; downgraded from medium because behavior is otherwise clear.
- Dissent: none.
- Status: upheld

## Adjudication Log

- Historical findings fixed by the latest commit were not duplicated: csm-build now documents blocked and clean-review transitions; sibling commit rules now require scoped commits; DDD and scan privacy tests were expanded; upload deployment uncertainty is explicitly reported.
- The autoresearch timeout finding was narrowed to network/memory/process isolation after challenge evidence showed timeout/output/workspace checks.
- The DDD question-input finding was narrowed to unbounded file parsing; answer serialization and bounds prevent the broader privacy claim.
- Browser navigation was not retained as a high finding because arbitrary navigation is the stated capability; residual destination/egress risk remains in Anti-Coverage.
- Upload deployment verification was retracted because the implementation and contract explicitly report `deployed=unverified` and do not claim a live deployment.
- Binary upload inspection was retained at medium because the limitation is documented but still permits publication of unscanned sensitive media.
- The two deterministic artifact-collision findings remain separate because they affect distinct durable outputs and recovery semantics.

## Retracted Findings

- Autoresearch timeout wholly unenforced: retracted in favor of F-001's narrower isolation finding.
- csm-upload falsely claims deployment success: retracted; uncertainty is explicitly surfaced.
- csm-browse arbitrary navigation as high severity: downgraded out of the findings ledger; it is a residual threat-model concern rather than a confirmed contract violation.
- Earlier prior-commit findings that are fixed at `a63411f` were not carried forward.

## Reproducibility

- Pinned SHA: `a63411f334171e20fd480eacf60685b353f9aa5f`.
- Review mode: R0 static; read-only inspection and independent static challenge.
- Commands/evidence: `git status --short`, `git rev-parse HEAD`, `git log`, `git diff --stat d0c21d6..HEAD`, repository file enumeration, direct pinned-worktree reads, and static cross-reference review.
- Tools: repository Glob/Grep/Read, git, and independent read-only review agents; no package manager, test runner, browser, registry, or external service was invoked.
- Containment: no reviewed source files changed; the only repository write is this allowlisted report. No credentials were accessed or quoted.
- Residual unknowns: dependency advisories/EOL, runtime behavior under sandboxed execution, external anchor reachability, production Git/Pages configuration, and binary artifact content inspection.
