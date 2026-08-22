---
format: csm-review/1
---

# Repository Review — skills @ d94c840 (2026-08-21)

## Control

- [INTAKE] START -> INTAKE :: cycle 0 :: trigger: explicit review request; FULL audit; posture R3 accepted by user :: rungs: R3
- [INTAKE] INTAKE -> SCOPE :: cycle 0 :: trigger: pinned d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3, worktree clean, no NORMS.md; prior reviews 2026-08-15/19 reached SAVED (no resume) :: rungs: R3
- [SCOPE] SCOPE -> EVIDENCE :: cycle 0 :: trigger: 7 chunks, finder groups assigned; anti-coverage drafted :: rungs: R3
- [EVIDENCE] EVIDENCE -> FIND :: cycle 0 :: trigger: OSV range-confirmed pnpm GHSA-3qhv-2rgh-x77r/CVE-2026-55180 (<10.34.2 affected); endoflife node22 EOL 2027-04-30, host node v20 past EOL; sandbox R3 executed: installs --ignore-scripts OK, egress block unavailable (unshare not permitted → network-free test selection, residual disclosed), suites run on nvm node v22.23.2: test-hooks PASS, lint PASS, check-suite OK, browse check PASS, bootstrap suite 19/20 FAIL(1), scan suite 1255/1270 FAIL(15); containment clean both trees :: rungs: R0-R3
- [FIND] FIND -> CHALLENGE :: cycle 0 :: trigger: ~60 raw findings across 10 finders (2 resilience-ladder recoveries + 4 narrowed re-dispatches after empty returns); redaction gate applied :: rungs: R0-R3
- [CHALLENGE] CHALLENGE -> ADJUDICATE :: cycle 0 :: trigger: 5 challenger dispatches returned EMPTY repeatedly (subagent infra failures journaled); ladder exhausted through step 3; primary completed challenge via direct mechanical verification of every high/critical claim (file counts, regex empirics, import greps) — remaining medium findings carry "challenge-unavailable" caveat with confidence capped at medium per termination rules :: rungs: R0-R3
- [ADJUDICATE] ADJUDICATE -> VERIFY :: cycle 0 :: trigger: dedup complete — raw ~60 → 20 numbered medium+ records + low/info bundle + resolved-residual register; F-021 downgraded (doc-only) :: rungs: R0-R3
- [VERIFY] VERIFY -> SAVED :: cycle 0 :: trigger: gate checks passed with 2 recorded caveats: (1) independent-challenge coverage gap on medium records (confidence capped, caveats surfaced), (2) egress-block mechanism unavailable at R3 (disclosed in Methodology). Redaction pass clean; coverage matrix filled; anti-coverage present; protected-state check passed (only this report file differs from baseline) :: rungs: R0-R3

Posture achieved: R0 static + R3 sandbox-executed (egress block unavailable; network-free tests only).

## How To Execute

This report fixes nothing. Remediation happens through a future explicit csm-plan or csm-grill invocation, followed by explicit csm-build execution against the resulting plan.

## Executive Summary

- **The suite that proves trust is red**: at this SHA the bootstrap drift-test (R5) fails because oxfmt reformatted the shipped bin's policy block to double quotes while the test regex pins single quotes — the same quote-drift class breaks T208/T209 capability gates and cascades into 15 scan-suite failures including the AC20 "every named gate executes green" check. The enforcement itself exists and holds; the assertions are stale. Fixing the quote-style literals likely turns most of the suite green.
- **run-tier is inert**: the tier manifest covers 65 of 80 test files; `run-tier s|m|l|all` always exits before running anything, while SKILL.md still advertises it as the fast feedback loop.
- **Two real scanner correctness bugs**: docker-compose volumes/networks parsing returns null for typical files (literal `Z`/`\Z` regex anchors), and unbounded Tarjan recursion can abort whole multi-repo runs on deep import chains.
- **Daemon self-healing has a hard bug and two lifecycle races remain**: `breakStaleClaim` calls an unimported `rename` (ReferenceError kills relaunch after any crash), sweep can reap slow adoptions past the marker window, recycled-PID liveness false-positives block daemon start, and crashed creations strand pool ports until a sweep runs.
- **Supply chain**: packageManager pin pnpm@10.33.0 is inside the affected range of CVE-2026-55180 (env-secret expansion into registry requests; fixed 10.34.2) — bump both manifests. The payload-drift gate misses newly added files (one-directional walk).
- **Prior-review residuals largely landed**: gitleaks ReDoS FIXED (complexity policy + caps + watchdog), unauthenticated CDP on 9222 FIXED (token-gated loopback funnel), VNC loopback-only verified, port/pidfile TOCTOU closed with atomic capture + O_EXCL claims, verbose-trace leak fixed, symlink traversal and all 47 RegExp compile sites verified clean.

Overall posture: a well-gated repository whose gates themselves are currently red (stale literal assertions, inert tier runner), with a small set of concrete daemon/scanner bugs and two supply-chain integrity gaps — all remediable without architectural change.

## Methodology Disclosure

- Reviewers: 10 finder subagents (non-overlapping chunks × dimension-groups), 5 challenger dispatch attempts (all returned empty; infra failure — see Control), primary agent performed mechanical verification and adjudication.
- Tools: git (read-only), OSV.dev /v1/query + /v1/vulns (range confirmation), endoflife.date API, node one-liners for regex empirics (in /tmp, never repo code), ripgrep-based greps.
- Rungs used: R0 everywhere; R1–R3 in sandbox `/tmp/opencode/csm-review-<id>/` (umask 077 clone via file://, env-scrubbed, scripts-disabled frozen-lockfile installs). Containment: post-run `git status` clean in sandbox clone; reviewed repo diff = report file only.
- Egress disclosure: `unshare -rn` unavailable (no user-namespace permission) → no egress block mechanism; per rules, only network-free tests selected; residual risk disclosed (tests could theoretically have contacted network; none observed to).
- Anchor editions checked: OWASP Top 10:2025, CWE Top 25 (2025), ASVS v5.0.0, ISO/IEC 25010:2023, SonarSource concepts, Fowler catalogs, testsmells catalog — retrieved/verified current at review date.
- Residual unknowns: medium findings below lack independent challenge (challenger infra failed) — confidence capped at medium accordingly; csm-browse e2e excluded (Docker unavailable).

## Coverage

| Dimension group | bootstrap+payload | scan lib | scan tests | browse lib | browse tests | root scripts/tests | small skills | verdict |
|---|---|---|---|---|---|---|---|---|
| quality (1–4) | Y | Y (F-005,F-020,F-014…) | Y (F-001,F-002,F-017) | Y (F-014,L6-L11) | Y | Y (F-019,L23,L24) | CLEAN | filled |
| security (5–7,9,11) | Y (F-009,F-010,L13,L14) | Y (RegExp inventory CLEAN, symlink CLEAN, broker shell:false CLEAN) | — | Y (CDP/VNC verified, L1,L2) | — | partial (SQL L24) | CLEAN | filled |
| concurrency (8) | — | — | — | Y (F-011,F-012,F-013,L3,L4,L5) | — | Y (F-019 races) | — | filled |
| resilience (10) | — | Y (F-020) | — | Y (F-015,F-016,L4) | — | — | — | filled |
| tests (12–14) | Y (F-003, R5 gap analysis) | — | Y (F-001,F-002,F-004,F-017,F-018,L26) | Y (verb coverage noted) | Y | Y (L25) | n/a (no code) | filled |
| supply chain (15–16) | Y (F-008,F-009) | — | — | — | — | Y (F-007,L17,L18,L22) | — | filled |
| operations (17–18) | Y (F-003) | — | Y (SKILL.md accuracy) | Y (observability verified sound) | — | Y (L19,L20,L21) | Y (frontmatter stable) | filled |

## Anti-Coverage

- `node_modules/`, lockfile integrity hashes: not reviewed (generated; risk: none beyond advisory scanning already done).
- csm-browse `test-e2e.mjs`: excluded — requires chromium-vnc Docker container unavailable here (risk: e2e-only regressions unseen).
- `csm-scan/test/fixtures-real/pxcli-mini` content semantics: treated as fixture data, not audited as code (risk: negligible).
- Payload duplicate tree (`bootstrap/package/payload/skills/**`): covered via drift-gate analysis + spot equality checks, not line-by-line twice (risk: low — byte-equality enforced for existing files; additions gap is finding F-008).
- Deep per-line review of all 80 scan test files: sampled by failure class + census greps rather than exhaustive read (risk: unknown smells below the failure surface may exist).
- Host environment (node v20 default interpreter): environmental, partially reviewed (risk: gate results on host differ from declared toolchain — L18).

## Findings Summary

Counts (upheld): 1 high, 16 medium, ~28 low/info components (bundled where same-root-cause). Raw ~60 → upheld records 20 numbered + bundled lows; 0 retracted. Confidence: 5 verified (E1/mechanical), rest medium (challenge-unavailable cap or E3 static), lows primary-led with independence caveat.

## Findings

### F-001 · Stale quote-style literal assertions turn four test suites red (T208/T209 cascade incl. AC20)
- dimension: tests/test-quality · severity: **medium** · confidence: verified (E1 — failing tests reproduced in sandbox)
- locations: csm-scan/test/expansion-command-core.test.mjs:248-251; csm-scan/test/expansion-command-deep.test.mjs:99-100, 460-464; cascade: expansion-baseline.test.mjs:136-148; expansion-final-acceptance.test.mjs:1840-1862; subject: csm-scan/lib/scan/shared/command.mjs:1
- snippet: `assert.match(readSource("lib/scan/shared/command.mjs"), /import \{ execFile \} from 'node:child_process';/,)` vs source `import { execFile } from "node:child_process";`
- explanation: Assertions pin single-quoted import lines while oxfmt emits double quotes; embedded nested runners propagate the failures into the baseline registration test and AC20's zero-failure requirement. Enforcement itself verified intact: broker is sole child-process owner; six owned files contain no prohibited constructs.
- impact: 15/1270 scan failures mask real signals; red gates erode trust in the suite.
- remediation_sketch: Make assertions format-agnostic (normalize quotes) or assert behaviorally (execFile appears solely inside command.mjs via lexical scan).
- challenges[]: none (infra) — primary mechanically confirmed source quoting matches failing regexes.

### F-002 · Renderer baseline fixtures stale vs compact-GFM table output
- dimension: tests/test-quality · severity: medium · confidence: verified (E1)
- locations: csm-scan/test/expansion-baseline.test.mjs:49 (+ siblings T204/T205/T223 baseline comparisons)
- snippet: expected `'| Basis        | Meaning ...|'` padded style; actual `'| Basis | Meaning |'` compact GFM.
- explanation: Byte-exact Markdown baselines expect pre-oxfmt table formatting; renderer now emits compact tables deterministically. Part of the same 15-failure cluster as F-001 but distinct root cause (baseline bytes, not assertion regexes).
- impact: Same masking effect; regeneration workflow absent (see F-017) makes fixing manual.
- remediation_sketch: Regenerate renderer.md baseline via a committed regen script (F-017) once output is confirmed intended.

### F-003 · Bootstrap trust-drift test R5 red: shipped bin policy block no longer matches the pinning regex
- dimension: security-control-verification / tests · severity: medium · confidence: verified (E1)
- locations: tests/bootstrap-trust.test.mjs:446+ (R5); bootstrap/package/bin/csm-skills-bootstrap.js:29-34
- snippet: bin: `name: "@jamiemills/csm-skills-bootstrap",` (double quotes); test regex: `/([a-z]+): '([^']*)'/g` → embeddedPolicy = {} → deepEqual fails.
- explanation: The ONLY test tying the shipped bin's SHELL_DENYLIST/FIXED_PACKAGE_POLICY to shared protocol constants fails since an oxfmt pass reformatted the bin. Drift protection for the trust boundary is currently nonfunctional.
- impact: Policy/denylist drift between shipped bin and tested reference would go undetected until someone fixes and re-runs.
- remediation_sketch: Quote-agnostic parse of the policy block (or normalize the generated bin before comparison); consider canonical-equality over parsed JSON instead of regex extraction.

### F-004 · run-tier is inert: manifest covers 65 of 80 test files; every invocation fails before running anything
- dimension: operations/tooling · severity: **high** · confidence: verified (primary mechanical count: 80 files vs 65 manifest entries; partition assertion fails on 15 missing: 13 remediation-f0xx-* + render-git + verbose-trace)
- locations: csm-scan/test/scripts/tiers.mjs:1-89; csm-scan/test/scripts/run-tier.mjs:96-107; csm-scan/SKILL.md:204
- snippet: `fail(\`tier manifest is not a complete non-overlapping partition ...\`)`
- explanation: SKILL.md advertises `node test/scripts/run-tier.mjs s|m|l|all` as the fast parallel feedback loop; assertManifestPartition compares against live discovery and calls fail() when files are missing, so nothing ever executes. New suites also never get classified.
- impact: Documented fast-feedback workflow completely broken; contributors fall back to ad-hoc subsets or the full serial run.
- remediation_sketch: Add the 15 files to tiers (remediation-* → M/L; render-git/verbose-trace → S); wire assertManifestPartition into check-suite so future additions cannot silently re-break it.
- challenges[]: primary mechanical verification substitutes (deterministic counts).

### F-005 · Compose volumes/networks parsing returns null for typical files (literal `Z` anchors)
- dimension: correctness · severity: medium · confidence: verified (empirical node repro at review time)
- locations: csm-scan/lib/scan/deep/operations.mjs:673 (networks `(?=^volumes|^services|Z)`), :679 (volumes `(?=Z)`), :654 (`(?=^\S|\Z)` — latent)
- snippet (verified): input with normal volumes section → volMatch = null
- explanation: In JS non-unicode regex `\Z` is identity escape matching capital "Z"; bare `Z` alternations likewise. Volumes are silently dropped from operations-dimension evidence unless a stray capital Z appears; networks truncated similarly; service-deps truncation requires a Z so mostly latent. A second divergent compose parser (parseYamlShallow path) already exists in deployment/extractor.mjs.
- impact: Missing/truncated networks/volumes/dependencies in scan findings for most repositories.
- remediation_sketch: Replace with `(?=^\S)|$` under `m`, or reuse the existing YAML-shallow parser as the single compose path.

### F-006 · session-daemon breakStaleClaim calls unimported rename — crash recovery dies with ReferenceError
- dimension: concurrency/error-handling · severity: medium · confidence: medium (static proof at pinned SHA; challenge unavailable)
- locations: csm-browse/scripts/session-daemon.mjs:2 (imports `{ readFile, rm, open, utimes }`), :56, :63 (`await rename(...)` call sites), :130 (invoked from claim loop awaited at module top level)
- explanation: First stale pid file after any abnormal daemon death raises ReferenceError instead of atomically breaking the claim; every relaunch fails until a human deletes daemon.pid. No unit test covers breakStaleClaim. Verified: no `rename` binding exists in the file (grep).
- impact: Self-healing path for crashed daemons is broken precisely in its target scenario.
- remediation_sketch: Add `rename` to the fs/promises import; add a stale-pidfile unit test asserting successful claim-and-boot.

### F-007 · packageManager pinned to pnpm@10.33.0 — affected by CVE-2026-55180 / GHSA-3qhv-2rgh-x77r
- dimension: dependency-vulnerabilities · severity: medium · confidence: verified (OSV /v1/query hit range-confirmed via /v1/vulns: affected <10.34.2 and 11.0.0–11.5.3; CVSS 6.5 AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N)
- locations: package.json:13; csm-browse/package.json:20; README.md:134
- explanation: `${ENV}` placeholders in npmrc config expand into registry request URLs before scripts run, leaking victim environment secrets. Mitigations present: no repo .npmrc committed; installs use `--frozen-lockfile --ignore-scripts`. User-level config on dev hosts remains exposed whenever corepack materializes 10.33.0.
- impact: Confidentiality of developer environment variables on any machine whose ambient npmrc uses env placeholders.
- remediation_sketch: Bump both packageManager fields to ≥10.34.2; add check-suite rejection of known-vulnerable pnpm ranges; update README requirement text.

### F-008 · Payload-drift gate is one-directional: newly added source files ship silently missing
- dimension: supply-chain/release-integrity · severity: medium · confidence: medium (static reasoning; challenge unavailable)
- locations: scripts/check-suite.mjs:584 (walk of payload tree only), :565-569, :552-556; scripts/pack-bootstrap.mjs:53-54
- explanation: checkPayloadDrift iterates payload files and verifies each against the pack mapping, but never reverse-checks that every mapped source exists in the payload tree. Adding a new module under mapped dirs without re-running pack-bootstrap leaves it absent from package AND index while all gates stay green (edits ARE caught; additions are not).
- impact: Published tarball could be silently incomplete; hash-verified materialization breaks downstream while local CI looks fine.
- remediation_sketch: After the payload walk, iterate buildPayloadSrcMap and flag MISSING-IN-PAYLOAD destinations.

### F-009 · Bootstrap payload-integrity chain self-referential; signed envelope authenticates zero payload bytes
- dimension: security-supply-chain · CWE-353/CWE-347 · severity: medium (prior high residual, downgraded on documented pre-release design + npm-integrity anchoring) · confidence: medium (challenge unavailable)
- locations: bootstrap/package/bin/csm-skills-bootstrap.js:167-202, 127-133; bootstrap/fixtures/valid.json; bootstrap/payload-index.json:9-14
- explanation: verify compares local index hash against envelope claim only when optional field present; sole signed fixture omits it; index and payload ship in the same mutable artifact; two subcommands read the index independently (TOCTOU split). Ed25519 validator DOES now ship in the bin (half the prior residual resolved) but nothing external anchors index/payload bytes.
- impact: Anyone able to alter the distributed package can regenerate matching hashes; verdict implies more assurance than delivered.
- remediation_sketch: Sign payload-index.json at pack time; make payload_index_sha256 required-and-checked in one atomic pass; adopt sigstore/provenance before publication.

### F-010 · Shipped-bin validator drift: limits/origin/hex-format checks enforced by reference policy absent from bin
- dimension: security-input-validation · CWE-20 · severity: medium · confidence: medium (challenge unavailable)
- locations: bootstrap/package/bin/csm-skills-bootstrap.js:119-133 vs tests/protocol/trust-policy.mjs:100-121, 148-161; bootstrap/schema.json:47-61
- explanation: The bin accepts envelopes the tested engine rejects (missing/out-of-range limits, non-https origin, non-hex digest). Future consumers honoring limits inherit values the shipped verifier never constrained; divergent trust decisions between authorities.
- remediation_sketch: Single shared validator module consumed by bin (bundled at pack) and tests; add canonical-equality pin like R5.

### F-011 · Sweep reaps adoptions outliving the creating.marker freshness window
- dimension: concurrency-lifecycle · CWE-367 · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-browse/scripts/ensure-browser.mjs:666-683 (marker before teardown), csm-browse/lib/sweep.mjs:29-31 (`CDP_RETRY_TIMEOUT_MS + 60000`), :178-187, :205-231
- explanation: Marker protection is mtime-bounded; an adoption stalled past retry+60s loses protection and gets killed mid-flight with ports freed underneath it. Primary race was fixed by marker-before-teardown; the overflow window remains.
- remediation_sketch: Heartbeat-touch the marker during adoption; require liveness of marker pid before treating as stale.

### F-012 · PID-recycled kill(pid,0) false liveness blocks daemon start / stalls port allocation
- dimension: concurrency-liveness · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-browse/scripts/session-daemon.mjs:117-129 (exit 2 path), csm-browse/lib/ports.mjs:86-91 (35s stall then throw)
- explanation: No argv/boot-id identity verification on the pid holder; an unrelated process owning the recycled pid permanently blocks start ("already running") and stale-lock breaking until deadline. Availability-only (no unsafe signal).
- remediation_sketch: Record creator argv[1]+/proc starttime in artifacts; treat mismatch as dead.

### F-013 · Crash mid-creation strands both pool ports until a sweep runs
- dimension: resource-leak · CWE-459 · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-browse/lib/ports.mjs:129-133, :166, :179; csm-browse/scripts/ensure-browser.mjs:788-801, 1237-1242; reaper only sweep.mjs:176-186
- explanation: Marker-only dirs count as port claims with no age/liveness check in claimedPortSet; repeated crashes without sweep monotonically drain the ~11-pair pool until allocate() throws fleet-wide.
- remediation_sketch: Opportunistically reap dead-pid markers under the port lock at allocation time.

### F-014 · CDP connect/discover/attach duplicated 6×; verbs bypass shared helpers
- dimension: technical-debt · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-browse/lib/cdp.mjs:3-26 (canonical); daemon-core.mjs:82-101; verbs/log.mjs:147-158, 200-215; verbs/capture.mjs:132-145; verbs/status.mjs:9-19
- explanation: Same getTargets→filter→attachToTarget block copy-pasted; log/capture construct their own clients with divergent error text and close handling.
- remediation_sketch: Extract attachFirstPage(client); route all verbs through connect/getSession.

### F-015 · Collectors drop failed telemetry batches silently
- dimension: resilience-observability · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-browse/lib/collectors.mjs:47-54, 12-24
- snippet: `try { await secureAppend(mainPath, batch.join("")); } catch {}`
- explanation: Sole persistence path for console/network/exception telemetry discards up to 512 lines on write failure with no counter or log (frames track droppedFrames; writes don't).
- remediation_sketch: Track droppedWrites; surface in recorder.json/status.

### F-016 · Synchronous fs on the daemon hot path
- dimension: performance/architecture · severity: medium · confidence: medium (pattern certain; challenge unavailable)
- locations: csm-browse/lib/security.mjs:18,36,81,140,283 (lstatSync chains per secureWrite); cleanup.mjs:113 (rmSync recursive); session.mjs:89,101
- explanation: Every command-result write re-walks ancestors synchronously (5-7 stats); recursive rmSync can stall the queue loop seconds on slow fs.
- remediation_sketch: Promise-based lstat preserving ordering; hoist runtime-root invariant to startup validation.

### F-017 · No baseline-regeneration script; six hash/byte artifacts updated by tribal knowledge
- dimension: tests-infrastructure · severity: medium · confidence: medium (challenge unavailable)
- locations: csm-scan/test/baselines/expansion/*; absence verified across csm-scan/scripts/ and test/scripts/
- explanation: Intentional renderer/enrichment changes require hand-reconstructing canonicalization (fixed clock, scan-ID normalization) to produce replacement digests; history shows ad-hoc updates; pressure to treat baseline failures as noise.
- remediation_sketch: Commit test/scripts/regen-baselines.mjs reusing pipeline-mirror/expansion-shared helpers with explicit --write.

### F-018 · Privacy CANARIES/SARIF/SBOM fixtures duplicated across two suites and drifted
- dimension: tests-quality/maintainability · severity: medium · confidence: medium (finder-reported; primary recount inconclusive on exact entry delta — flagged for verification during fix)
- locations: csm-scan/test/expansion-privacy-gate.test.mjs:55-130 vs expansion-final-acceptance.test.mjs:1349-1429
- explanation: Independent frozen canary lists have drifted (raw-git-remote-with-credentials entry present in only one); no equality-pin unlike BANNED_VOICE pattern.
- remediation_sketch: Shared privacy-fixtures helper + equality assertion.

### F-019 · wt-session mergeWorktree can rebase the main checkout when worktree is absent
- dimension: correctness-tooling · severity: medium · confidence: medium (challenge unavailable)
- locations: scripts/wt-session.mjs:95-112 (`cwd = wt || root`; guard `cur !== "main"` runs AFTER rebase), related test gap tests/wt-session.test.mjs:64-100
- explanation: Branch-exists-but-worktree-removed falls back to running `git rebase origin/main` inside the main checkout, rewriting live history before the branch guard fires; failed rebase leaves worktree wedged (no --abort); nuke can complete half-way orphaning branches.
- impact: Unexpected history rewrite of the live skills dir; confusing retry states.
- remediation_sketch: Fail closed when wt undefined; move guard before mutation; wrap rebase in try/finally with --abort; delete branch first in nuke.

### F-020 · Unbounded Tarjan recursion; architecture-dimension failure aborts entire pipeline
- dimension: correctness-resilience · severity: medium · confidence: medium (static reasoning; challenge unavailable)
- locations: csm-scan/lib/scan/deep/architecture/graph-facts.mjs:117-127, :31 (files limit 50_000); csm-scan/lib/scan/pipeline/run.mjs:330-341
- explanation: strongConnect recurses per graph depth with no cap; a ~10-15k-deep legal import chain overflows the stack; architecture is among unwrapped legacy dimensions so one pathological repo kills the multi-repo run.
- remediation_sketch: Iterative Tarjan or depth-capped decomposition; include architecture in safeScanDimension wrapping.

### Downgraded
- F-021 SKILL.md/run-tier stale "placeholder" claims (medium→low): doc-only confusion; fail-loud behavior intact; superseded by fixing F-004 anyway. Logged in Adjudication Log.

### Low/info bundle (primary-led, independence caveat recorded)
L1 nav verb accepts any scheme incl. file:// reading container-mounted config into transcripts (CWE-20, nav.mjs:7-23) — default-deny non-http(s) recommended. L2 cdp-gate post-auth pre-tunnel buffer uncapped (CWE-770, cdp-gate.mjs:171,174,265-267). L3 stale-break restore rename-back can dispossess third-party fresh lock (CWE-367, ports.mjs:50-58). L4 Non-atomic O_TRUNC writes: readyMarker + sweep state revocation rewrite (security.mjs:252-266; sweep.mjs:220-224). L5 Signal gaps: late handler registration, SIGHUP unhandled, no child teardown (session-daemon.mjs:311,161-249). L6 Verbs dom/input/nav/status close WS only on happy path (no try/finally). L7 withTimeout never clearTimeout (daemon-core.mjs:16-25). L8 Duplicate SIGTERM→poll→SIGKILL grace logic cleanup.mjs:50-75 vs sweep.mjs:96-111. L9 Magic-number timeouts shadow constants (cdp.mjs:30-31 et al.). L10 sweep.mjs 512 / recorder.mjs 503 exceed 500-line budget. L11 dom text/html copy-paste; selector escaper 4× (dom.mjs:4-64; cdp.mjs:49,93). L12 digest() helper copied 6× across test files. L13 Shell denylist incomplete blocklist over guidance text (CWE-184, bin:27-28). L14 Hook shim commits user-specific absolute path (CWE-540, scripts/hooks/pre-commit:19,21). L15 Key validity NaN pass-open — latent (bin:117). L16 Unsigned envelopes return trusted:true — documented accepted risk; distinct result shape recommended (bin:69-73,134-164). L17 Engines inconsistency root >=22 vs subs >=22 <25 (package.json:10-12 et al.). L18 Host Node v20.20.2 past EOL; bare make targets unprotected (environmental). L19 No CI; hooks bypassable; no dep-update automation (.lefthook.yml only). L20 Version story placeholder; pack-bootstrap version literal not read from manifest (pack-bootstrap.mjs:121-125). L21 README drift: dep list omits oxfmt ×5 passages; target list missing fmt/fmt-check/fmt-staged/test-e2e; unpinned npx cyclonedx suggestion (:185,250-262). L22 with-node22 hardcoded patch-version nvm path (with-node22.mjs:10). L23 wt-session partial-failure states: wedged rebase, half-done nuke, ambiguous basename fallback (wt-session.mjs:131-158). L24 cache-health SQL string-build fragility + --days extremes + parser/docstring deviations (cache-health.mjs:196-208,49-57). L25 wt-session/cache-health test gaps hide F-019-class regressions. L26 Serial-suite cost amplification: AC20 nested corpus double-execution undocumented (info). L27 daemon.log uncapped growth within session lifetime (info). L28 Positive: suite census ~99.5% behavioral assertions; timing-sleep/flake scan CLEAN (info).

## Resolved Residuals (prior reviews — verified FIXED at this SHA)

1. Gitleaks allowlist ReDoS: validatePluginRegexSource + 128-char cap + 1000ms watchdog + literal fallback (deep/security.mjs:685-748). 2. Unauthenticated CDP on 9222: port unpublished; token-gated loopback funnel; timingSafeEqual; pipelined bypass closed (cdp-gate.mjs, ensure-browser.mjs:334-335). 3. VNC loopback-only publishing verified (docker.mjs:334-335). 4. Port-lock/pidfile TOCTOU: atomic capture-compare + O_EXCL claims + inode-gated release (ports.mjs:33-104; session-daemon.mjs:48-159). 5. saveState/recorder.json torn-read windows closed via tmp+rename. 6. Force-exit timer ordering hardened. 7. verbose-trace leak: unique names, 0600 wx, fully gitignored. 8. Symlink traversal: walkers don't follow symlinked dirs; realpath containment on reads. 9. RegExp inventory: all 47 compile sites inspected — plugin inputs routed through complexity policy; no ReDoS outside policy. 10. Broker: sole child-process owner, shell:false forced, argv validated.

## Adjudication Log

- F-009 downgraded high→medium (documented fail-open design, pre-release, npm-integrity anchoring; consistent with prior-review challenge outcomes).
- F-021 downgraded medium→low (doc-only; fix subsumed by F-004).
- Dedup merged: quote-drift family (F-001/F-002/F-003 share the oxfmt-vs-literal root pattern but distinct fix sites — kept split); lifecycle bundle lows merged into single records.

## Retracted Findings

None.

## Reproducibility

- Pinned SHA: d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3 (worktree clean).
- Sandbox: /tmp/opencode/csm-review-<timestamp>-skills/clone; installs: `pnpm install --frozen-lockfile --ignore-scripts` (root + csm-browse); tests via nvm node v22.23.2: `node --test scripts/hooks/test/pre-commit.test.mjs` (PASS), `node --test tests/bootstrap-trust...` (19/20), `cd csm-scan && node --test --test-concurrency=1` (1255/1270), `node scripts/check-suite.mjs` (OK), lint (PASS).
- External queries: api.osv.dev /v1/query{,+range confirm}; endoflife.date/api/nodejs.json.
- Caveats: challenger independence unavailable on medium records (infra); egress block unavailable (network-free selection only); e2e excluded (no Docker).
