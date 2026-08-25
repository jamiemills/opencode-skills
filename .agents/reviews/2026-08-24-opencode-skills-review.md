format: csm-review/1

# Repository Review — opencode-skills @ d0c21d6 (2026-08-24)

## Control

- Review scale: FULL audit.
- Pinned commit: `d0c21d62aa003eac9f5c527c0c7255ffd26093cd`.
- Posture: R0 static review; no repository code was executed by review finders.
- Target: all 13 skills, shared packaging/checking surfaces, and root `README.md`.
- Worktree baseline: clean at intake and unchanged during review.
- Status: findings complete; remediation is a separate user-requested documentation/code-change phase.

## How To Execute

This report is review-only. Apply remediation through a future explicit plan/build or other human-mediated implementation flow. This review did not modify reviewed source files.

## Executive Summary

- The repository has strong state-machine, payload-parity, privacy, and test infrastructure, especially in `csm-scan`, `csm-ddd`, `csm-autoresearch`, and `csm-browse`.
- The highest-risk findings concern runtime boundary enforcement in `csm-autoresearch`, public evidence publication in `csm-upload`, unsafe defaults in `csm-bdd-tdd`, and broad lifecycle/write claims in `README.md`.
- Several sibling skills have weaker commit scoping and resume guarantees than `csm-deep-research`.
- The root README is useful but overgeneralizes lifecycle, artifacts, write discipline, bootstrap readiness, and human-mediated handoffs.
- Confidence is separate from severity; findings below are ordered by severity and then confidence.

## Methodology Disclosure

Five independent read-only subagents reviewed non-overlapping skill groups and shared surfaces at the pinned commit. The tracks covered orchestration, testing/review, analyzers/optimization, browser/publishing, and README/packaging. Evidence was checked against implementation files, contracts, tests, manifests, and prior repository artifacts. No dependency vulnerability or runtime-EOL queries were executed in this R0 pass. No secrets or personal data were quoted.

## Coverage

| Surface | Coverage | Result |
|---|---|---|
| `csm-deep-research`, `csm-grill`, `csm-plan`, `csm-build` | Full static contract, state, handoff, commit, and resume review | Findings F-007 to F-011 |
| `csm-bdd-tdd`, `csm-make-tests`, `csm-review`, `csm-review-python` | Full static contract, write, resume, challenge, and evidence review | Findings F-001 to F-006, F-012 to F-015 |
| `csm-scan`, `csm-ddd`, `csm-autoresearch` | Full implementation, schema, privacy, bounds, and runtime review | Findings F-016 to F-023 |
| `csm-browse`, `csm-upload` | Full implementation, session, publication, and security review | Findings F-024 to F-029 |
| Root README, packaging, checker, manifest, payload index | Full factual, lifecycle, install, release, and parity review | Findings F-030 to F-036 |

## Anti-Coverage

- Dependency vulnerability and EOL APIs were not queried; supply-chain findings remain incomplete until an R0 dependency pass is run.
- R1-R3 sandbox execution, test collection, egress probes, and mutation checks were not run.
- External anchor editions were not re-fetched during this static pass.
- Findings are based on current repository evidence and do not assess production deployment configuration outside the repository.

## Findings Summary

| Severity | Count | Principal areas |
|---|---:|---|
| High | 8 | autoresearch execution, upload safety, BDD commit default, README contract accuracy |
| Medium | 20 | resume/state, source modes, evidence persistence, DDD privacy/bounds, packaging, browser boundaries |
| Low | 8 | wording, stale identifiers, narrower test gaps |

Severity is impact if true; confidence is independent probability that the finding is true. All high and medium findings received an independent challenge through a separate review track.

## Findings

### F-001. `csm-bdd-tdd` defaults to committing without explicit authorization

- Severity: high
- Confidence: high
- Locations: `csm-bdd-tdd/SKILL.md:56-57,76-80,261-265`
- Evidence: the skill permits plan/spec writes and commits unless the user requests no commit, unlike the stricter review skills.
- Impact: a specification-only invocation can mutate repository history without explicit commit authorization.
- Remediation sketch: default to no commit; commit only when explicitly requested, and report the skipped reason.

### F-002. `csm-autoresearch` schema and runtime disagree on `policy`

- Severity: high
- Confidence: high
- Locations: `csm-autoresearch/schemas/run-contract.schema.json:19`; `csm-autoresearch/lib/optimizer/index.mjs:68-70,88,226`
- Evidence: the schema requires a non-empty string while the optimizer dereferences `policy.mode`, `policy.hardGates`, and related object fields.
- Impact: schema-valid contracts can fail at runtime or produce undefined policy behavior.
- Remediation sketch: reference the policy object schema from the run contract, validate before optimization, and add an end-to-end schema-to-optimizer test.

### F-003. Trusted-local autoresearch does not enforce advertised execution limits

- Severity: high
- Confidence: high
- Locations: `csm-autoresearch/SKILL.md:58-63`; `csm-autoresearch/lib/providers/trusted-local.mjs:106-113,161-176`; `csm-autoresearch/lib/runtime/index.mjs:88-107`
- Evidence: network, memory, and process limits are rejected or recorded rather than enforced; the candidate runs without a network restriction and explicit environment allowlists can carry secrets.
- Impact: trusted-local candidates can access network resources, credentials, or unbounded processes and memory.
- Remediation sketch: enforce limits at the OS boundary or make trusted-local explicitly a weaker trusted-process mode with credential filtering and hostile tests.

### F-004. Registered autoresearch providers execute arbitrary callables in-process

- Severity: high
- Confidence: medium
- Locations: `csm-autoresearch/lib/providers/registered.mjs:45-61,80-88`
- Evidence: registered callables run directly in the orchestrator process while limits are copied into provenance rather than enforced.
- Impact: a blocking or hostile callable can hang the run, mutate evaluator state, read credentials, or perform network I/O.
- Remediation sketch: isolate registered callables behind a bounded process/worker boundary or explicitly narrow and test the trusted capability.

### F-005. `csm-upload` Git configuration can redirect publication

- Severity: high
- Confidence: high
- Locations: `csm-upload/scripts/upload.mjs:40-57,419-432`; `csm-upload/tests/upload.test.mjs:266-307`
- Evidence: hostname validation precedes ordinary Git operations, while `url.*.insteadOf` can rewrite the effective destination; the test demonstrates this behavior.
- Impact: “never pushes elsewhere” is not guaranteed by the script.
- Remediation sketch: isolate Git configuration, verify effective `remote.origin.url` before clone/push, and reject unexpected destinations.

### F-006. `csm-upload` publishes evidence without a redaction/publication gate

- Severity: high
- Confidence: high
- Locations: `csm-upload/SKILL.md:9-12,39-40`; `csm-upload/scripts/upload.mjs:444-465`
- Evidence: screenshots, videos, DOM, console, network metadata, and evaluated results are copied and pushed without sensitive-data scanning or explicit permanence confirmation.
- Impact: public history can contain credentials, personal data, private URLs, or application secrets.
- Remediation sketch: add publication confirmation, warnings, redaction/refusal checks, and sensitive-artifact tests.

### F-007. Deep-research source-mode rules conflict with researcher instructions

- Severity: medium
- Confidence: high
- Locations: `csm-deep-research/SKILL.md:122-124,130,185`
- Evidence: `web` mode is web-only, while researcher instructions broadly say to read repository, local docs, and web sources without conditioning on mode.
- Impact: a web-only run can inspect local repository content against its declared scope.
- Remediation sketch: make source mode govern primary, researcher, challenger, and judge retrieval explicitly.

### F-008. `csm-build` has no explicit blocked-state recovery transition

- Severity: medium
- Confidence: high
- Locations: `csm-build/SKILL.md:149-159,170-175,340-350`
- Evidence: the skill can enter `BLOCKED` and records a future transition, but the machine defines no concrete resume edge.
- Impact: a fresh agent must infer how a resolved blocker returns to execution.
- Remediation sketch: define `BLOCKED -> RECOVER -> VALIDATE` and the required Control fields.

### F-009. `csm-build` does not define the clean-review route

- Severity: medium
- Confidence: high
- Locations: `csm-build/SKILL.md:149-159,254-265,276-283`
- Evidence: `REVIEW -> REPAIR` is described, but no explicit `REVIEW -> CHECKPOINT` path exists when review is clean.
- Impact: fresh agents may invent a repair step or stall after a clean review.
- Remediation sketch: define clean and finding-present review transitions separately.

### F-010. `csm-grill` loses all mid-session state on interruption

- Severity: medium
- Confidence: high
- Locations: `csm-grill/SKILL.md:56-62,73-97`
- Evidence: temporary journals are deleted and quota interruption is not resumable.
- Impact: user decisions, research, and current state disappear on interruption.
- Remediation sketch: either persist a resumable control journal or explicitly narrow the skill’s interruption guarantee.

### F-011. Sibling orchestration skills do not scope commits with `git commit --only`

- Severity: medium
- Confidence: high
- Locations: `csm-grill/SKILL.md:152`; `csm-plan/SKILL.md:226`; `csm-build/SKILL.md:316`
- Evidence: “stage only” does not prevent unrelated staged files from entering an ordinary commit.
- Impact: concurrent or unrelated user changes can be committed.
- Remediation sketch: require `git commit --only <owned-paths>` and verify commit contents.

### F-012. `csm-make-tests` deletes evidence required by its report

- Severity: medium
- Confidence: high
- Locations: `csm-make-tests/SKILL.md:214-216,225-229`; `csm-make-tests/references/perf-playbook.md:31-32`
- Evidence: performance artifacts are referenced by verification output but deleted from the temporary directory before display.
- Impact: final reports point to unavailable evidence.
- Remediation sketch: persist required artifacts, embed stable summaries/checksums, or label deleted artifacts unavailable.

### F-013. `csm-make-tests` resume state is not durable enough

- Severity: medium
- Confidence: high
- Locations: `csm-make-tests/SKILL.md:49-50,72-75,91-108,237-289`
- Evidence: audit tables and working notes live only in disposable temp state; durable ledgers lack state/cursor/temp identity.
- Impact: interrupted runs cannot reliably resume without duplication or lost approval context.
- Remediation sketch: add a durable control journal or extend the ledger with state, cycle, scope, artifact, and resume point.

### F-014. `csm-review` can save after an unresolved VERIFY failure

- Severity: medium
- Confidence: high
- Locations: `csm-review/SKILL.md:100-107,178-205,339-348`
- Evidence: after three VERIFY failures the machine proceeds to `SAVED`, although the report contract describes a passed gate.
- Impact: incomplete reports are indistinguishable from verified reports.
- Remediation sketch: add `INCOMPLETE` or `BLOCKED` terminal status and preserve unresolved gate failure in machine-readable form.

### F-015. `csm-review` anchor verification is not executable for its anchor model

- Severity: medium
- Confidence: high
- Locations: `csm-review/SKILL.md:137-140,184-190,215-238`
- Evidence: many anchors are names or standards rather than URLs, while VERIFY requires edition/version and reachability.
- Impact: anchor coverage and currency are interpreted inconsistently.
- Remediation sketch: define typed anchors with URL, edition/version, and verification method.

### F-016. `csm-review-python` has no durable resume protocol

- Severity: medium
- Confidence: high
- Locations: `csm-review-python/SKILL.md:57-73,75-93,125-143,167-175`
- Evidence: transitions live in temporary notes and the only durable report is written at the end.
- Impact: interruptions lose pinned intake, tool consent, and progress.
- Remediation sketch: add a durable control file or embedded report control section within the allowlist.

### F-017. DDD publication is not atomic across report and graph

- Severity: medium
- Confidence: high
- Locations: `csm-ddd/SKILL.md:71-76`; `csm-ddd/lib/ddd/pipeline.mjs:97-108`
- Evidence: report is renamed before graph publication.
- Impact: interruption can leave only half of the promised artifact pair.
- Remediation sketch: publish through a generation directory/manifest or transactional pair protocol with failure-injection tests.

### F-018. DDD question-file answers bypass privacy and size bounds

- Severity: high
- Confidence: high
- Locations: `csm-ddd/lib/ddd/pipeline.mjs:29-37`; `csm-ddd/lib/ddd/clarify.mjs:57-113`
- Evidence: answer values are converted to unbounded strings without secret, identity, path, count, or byte validation.
- Impact: credentials, personal data, markup, or multi-megabyte values can enter graph artifacts.
- Remediation sketch: validate a strict envelope, cap counts/bytes, redact or reject sensitive values, and add hostile-answer tests.

### F-019. DDD rendering persists unfiltered repository-derived names and terms

- Severity: high
- Confidence: high
- Locations: `csm-ddd/lib/ddd/render.mjs:29,52-55,81-96`; `csm-ddd/lib/ddd/redact.mjs:39-44`
- Evidence: redaction covers selected evidence fields but not names, terms, labels, seams, and other rendered fields.
- Impact: sensitive identifiers and paths can leak into reports and graphs.
- Remediation sketch: apply one bounded privacy serializer to every persisted field and add sensitive-name/path fixtures.

### F-020. Autoresearch resume accepts changed provenance

- Severity: medium
- Confidence: high
- Locations: `csm-autoresearch/lib/optimizer/index.mjs:79-90,127-138`; `csm-autoresearch/lib/ledger/index.mjs:101-137`
- Evidence: resume validates hashes and sequence but not current contract/evaluator/environment provenance.
- Impact: old results can be resumed under changed policy or evaluator context.
- Remediation sketch: compare current and initial provenance and block on mismatch.

### F-021. csm-scan library execution bypasses sanitized diagnostics

- Severity: medium
- Confidence: high
- Locations: `csm-scan/lib/scan/survey.mjs:57`; `csm-scan/scripts/scan.mjs:149-153,196-203`
- Evidence: sanitization is installed by the CLI but direct library calls print repository paths.
- Impact: library consumers can receive unsanitized absolute paths or identities.
- Remediation sketch: inject a sanitized reporter and remove direct library console output.

### F-022. Packaging authority is duplicated

- Severity: medium
- Confidence: high
- Locations: `scripts/pack-bootstrap.mjs:30-44`; `scripts/check-suite.mjs:814-825`; `tests/package-audit.test.mjs:12-26`
- Evidence: discovery, manifest, packer, payload, and tests maintain separate skill lists.
- Impact: a new skill can pass individual checks while being omitted from packaging.
- Remediation sketch: derive all sets from one authoritative manifest/discovery result and assert equality.

### F-023. Committed payload index is not independently validated

- Severity: medium
- Confidence: high
- Locations: `scripts/check-suite.mjs:656-718`; `scripts/pack-bootstrap.mjs:177-204`
- Evidence: package tests regenerate the index before checking it; the conformance gate does not validate the committed index against payload files.
- Impact: stale generated metadata can ship undetected.
- Remediation sketch: add a read-only index validation pass and a stale-index fixture.

### F-024. csm-browse accepts arbitrary persisted CDP endpoints

- Severity: medium
- Confidence: high
- Locations: `csm-browse/lib/security.mjs:235-259`; `csm-browse/lib/cdp.mjs:3-6`
- Evidence: state validation accepts non-loopback hosts and arbitrary ports/schemes after basic URL checks.
- Impact: modified state can redirect browser control or credentials to an external endpoint.
- Remediation sketch: require loopback host, expected port/session identity, and token binding.

### F-025. csm-browse consent automation can trigger unintended actions

- Severity: medium
- Confidence: high
- Locations: `csm-browse/SKILL.md:73,79`; `csm-browse/lib/cookies.mjs:50-160`
- Evidence: broad text matches include `continue`, `allow`, `yes`, and fallback DOM removal.
- Impact: authenticated pages can receive unintended actions or altered evidence.
- Remediation sketch: narrow/opt-in dismissal, origin/context checks, and an audit result indicating page modification.

### F-026. csm-upload does not verify Pages deployment readiness

- Severity: medium
- Confidence: high
- Locations: `csm-upload/SKILL.md:15-31,39-56`; `csm-upload/scripts/upload.mjs:364-368,419-432,464-465`
- Evidence: the script pushes and synthesizes a `github.io` URL without verifying ownership, Pages configuration, branch, or deployment status.
- Impact: a successful push can be reported as a public deployment when it is not.
- Remediation sketch: verify effective repository/Pages state and report push separately from deployment.

### F-027. README overstates universal lifecycle and write discipline

- Severity: high
- Confidence: high
- Locations: `README.md:32-40,95-111`
- Evidence: `csm-browse` and `csm-upload` have no state-machine contract; `csm-build`, `csm-make-tests`, and `csm-scan` intentionally write different outputs.
- Impact: users may expect universal journals, `.agents/` artifacts, and read-only behavior.
- Remediation sketch: describe lifecycle and write policy as skill-specific and classify output locations accordingly.

### F-028. README presents unpublished bootstrap as available

- Severity: high
- Confidence: high
- Locations: `README.md:361-363`; `bootstrap/release-checklist.md:3,12-16`
- Evidence: publication and envelope hosting remain future/credential-gated, but README says one-URL installation is available.
- Impact: users cannot follow the advertised install path.
- Remediation sketch: label bootstrap experimental/unpublished and direct users to clone installation/local pack validation.

### F-029. README lifecycle diagram implies automatic handoffs

- Severity: medium
- Confidence: high
- Locations: `README.md:70-93,138-152,309-322`
- Evidence: solid-looking build/browse/upload paths conflict with explicit human-mediated skill boundaries.
- Impact: users may expect one skill to invoke another automatically.
- Remediation sketch: label all handoffs human-invoked and use dashed/optional semantics consistently.

### F-030. README installation and prerequisite guidance is incomplete

- Severity: medium
- Confidence: high
- Locations: `README.md:7-14,56-68,295-307`
- Evidence: runtime-specific destinations, Node `>=22 <25`, pnpm/make, Docker/VNC, `gh`, Pages, and ffmpeg requirements are scattered or absent.
- Impact: first-time users can install to the wrong runtime or reach browser/upload steps without prerequisites.
- Remediation sketch: add a consolidated prerequisites section and runtime-specific installation note.

### F-031. README quick-install does not use reproducible install safeguards

- Severity: medium
- Confidence: high
- Locations: `README.md:9-12`; `Makefile:8-10`
- Evidence: README uses unconstrained `pnpm install` while repository install uses frozen lockfile and ignored scripts.
- Impact: install behavior can differ from repository validation and execute lifecycle scripts unexpectedly.
- Remediation sketch: recommend `make install` or document the safeguarded command.

### F-032. README bootstrap capability and signing claims are inaccurate

- Severity: medium
- Confidence: high
- Locations: `README.md:363`; `bootstrap/protocol.md:7,28-29,67-89,161`
- Evidence: protocol reports seven capability fields and current signing/publication is gated; README says exactly three capabilities and implies a ready signing key.
- Remediation sketch: distinguish hard external prerequisites, reported capability fields, and unpublished signing state.

### F-033. README hook command is incomplete and VNC scope is misstated

- Severity: medium
- Confidence: high
- Locations: `README.md:299,450`; `scripts/install-hooks.mjs:37-41`; `csm-browse/lib/constants.mjs:34-37`
- Evidence: hook installation requires the repository script; VNC password is shared at container scope, while CDP tokens are per-session.
- Remediation sketch: document the script command and correct authentication wording.

### F-034. README omits useful skill-selection guidance

- Severity: low
- Confidence: high
- Locations: `README.md:44-54,155-188,190-307`
- Evidence: overlapping choices (`csm-scan`/`csm-ddd`, review variants, test-generation variants, browse/upload) are described but not decision-oriented.
- Remediation sketch: add a concise “Which skill should I use?” table or bullets.

### F-035. Release checklist documents an invalid offline command

- Severity: medium
- Confidence: high
- Locations: `bootstrap/release-checklist.md:20`; `bootstrap/runtime-commands.json:12,23-32`
- Evidence: checklist uses `npx --offline --no` while the command grammar requires `--no-install`.
- Remediation sketch: correct the command and add a documentation-to-grammar assertion.

### F-036. Release checklist overstates registry replay validation

- Severity: medium
- Confidence: high
- Locations: `bootstrap/release-checklist.md:20`; `tests/offline/offline.test.mjs:76-103`
- Evidence: current tests replay a local `file:` tarball and do not perform the claimed published-registry replay.
- Remediation sketch: label current coverage accurately and add a separate post-publication registry test.

## Adjudication Log

- Duplicate findings from the five tracks were merged by root cause while preserving the strongest evidence and broadest affected surface.
- README findings were retained separately from implementation findings because the requested remediation targets README documentation first.
- Severity was not averaged across agents. High findings were retained where an execution boundary, publication boundary, or user-facing contract was materially false or unsafe.

## Retracted Findings

No material findings were retracted. Several potential issues were downgraded to low or omitted where the repository already had a passing structural or parity check.

## Reproducibility

- Pinned SHA: `d0c21d62aa003eac9f5c527c0c7255ffd26093cd`.
- Review mode: static R0; read-only repository inspection and parallel subagent review.
- Reviewed sources: all 13 root skill directories, packaged copies, shared scripts/contracts/tests, bootstrap files, and root README.
- No repository files were modified by the review pass.
- Residual unknowns: dependency advisories/EOL, sandbox execution behavior, external anchor reachability, and production deployment configuration require later review rungs.
