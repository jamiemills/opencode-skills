---
format: csm-review/1
---

# Repository Review (Final) — skills @ d94c840 (2026-08-21, pass 2)

Second pass seeded with pass-1 report (.agents/reviews/2026-08-21-skills-review.md) as input. Every medium+ finding re-verified at the pinned SHA by independent agents (none authored the original findings) plus primary mechanical checks.

## Control

- START -> INTAKE :: explicit re-run request; prior report as input; max-parallel subagents; pinned SHA unchanged d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3
- INTAKE -> FIND :: 12-agent parallel dispatch: 8 verification owners, adversarial disprover, fresh-eye finders, ops spot-checker
- FIND -> ADJUDICATE :: 9 of 12 returned substantive results; 3 sessions empty after ladder retries (adversarial disprover, compose/Tarjan verifier, bootstrap verifier) — completed as primary via direct grep/empirical checks
- ADJUDICATE -> VERIFY :: all 20 medium+ findings adjudicated with independent evidence; F-006 mechanism corrected; confidence upgraded to verified/high where independently confirmed
- VERIFY -> SAVED :: redaction clean; protected-state check passed (only review files differ); residual unknowns disclosed

## Executive Summary

- **All 20 medium+ findings from pass 1 STAND**, most now line-exact confirmed by independent verifiers; one corrected (F-006), one refined (F-014 census).
- **The gates are red because the gates are stale**: quote-drift (oxfmt double quotes vs single-quote-pinned assertions/baselines) breaks T208/T209, the renderer baseline, and bootstrap R5 — enforcement itself verified intact.
- **run-tier is dead tooling**: 80 files vs 65 manifest entries; exits 1 before running anything (live-tested).
- **Real bugs**: compose volumes/networks parse to null (`Z` anchors); daemon crash-recovery silently no-ops then exits at deadline; wt-session can rebase the main checkout; payload-drift gate misses new files; pnpm@10.33.0 in CVE-2026-55180 range.
- **Prior-review fixes hold**: gitleaks ReDoS, CDP/9222 auth, VNC exposure, TOCTOU stale-breaks — all verified fixed.

## Verification Matrix (pass-1 finding → verdict)

| ID | Finding | Verdict | Key correction / evidence |
|---|---|---|---|
| F-001 | Stale single-quote assertions break T208/T209 | CONFIRMED | core.test.mjs:248-251; deep.test.mjs:99-100,460-464 pin `'` vs command.mjs:1 `"` |
| F-002 | renderer.md baseline padded vs compact GFM output | CONFIRMED | baselines/expansion/renderer.md:13-14 padded; write.mjs:111-119 + render/* emit `\|---\|` |
| F-003 | Bootstrap R5 drift-test red | CONFIRMED | test :451-453 regex needs `'value'`; bin :29-34 all `"value"`; denylist half unaffected |
| F-004 | run-tier inert (65/80 manifest) | CONFIRMED | 15 missing named; live run exit 1 "Nothing was executed" |
| F-005 | Compose volumes/networks null via literal-Z anchors | CONFIRMED | operations.mjs:673,679; empirical repro: volumes match null |
| F-006 | Daemon breakStaleClaim unimported rename | CONFIRMED (mechanism corrected) | Defect real (:2 import lacks rename; calls :56,:63). NOT an uncaught crash: try/catch :55-59 swallows ReferenceError → silent no-op → CLAIM_DEADLINE_MS 10s → clean exit(1) :80. End impact same: relaunch fails until human deletes daemon.pid |
| F-007 | pnpm@10.33.0 in CVE-2026-55180 range | CONFIRMED | package.json:13; csm-browse/package.json:20; README :134 AND :245; no repo .npmrc |
| F-008 | Payload-drift gate misses added files | CONFIRMED | walk payload-only :584; srcMap only .get() :586; no reverse iteration repo-wide; package-audit tests compare index↔tarball only (blind to live src) — a NEW file under csm-scan/lib/scan ships missing while gates stay green |
| F-009 | Envelope never authenticates payload bytes | CONFIRMED | binding conditional bin:52-53,129-130; signed fixtures/valid.json carries limits but NO payload_index_sha256 |
| F-010 | Bin omits limits/origin validation | CONFIRMED | `grep -c limits` bin = 0; trust-policy enforces max_bytes :110-114, origin :121,143 |
| F-011 | Sweep kills adoptions past 90s marker window | CONFIRMED | CREATING_MARKER_MAX_MS=30s+60s (sweep.mjs:29-31); marker written once (ensure-browser:673-683), zero touch/utimes sites; teardown :205-231 |
| F-012 | Recycled-PID false liveness blocks start | CONFIRMED | kill(pid,0)-only at session-daemon:122, ports.mjs:29; identity helper isSessionDaemon exists (cleanup.mjs:17) but unused by these paths |
| F-013 | Marker-only dirs strand pool ports | CONFIRMED | claimedPortSet unconditional :129-133; pool = exactly 11 pairs (9224-9234, constants.mjs:94-95); sole reaper sweep |
| F-014 | CDP attach duplication ×6; verbs bypass cdp.mjs | CONFIRMED (census refined) | 5 full-pattern copies + 1 discovery-only; direct CRI imports at log.mjs:147,200; capture.mjs:132; PLUS daemon-core.mjs:78 |
| F-015 | Collectors drop failed batches silently | CONFIRMED | splice-then-empty-catch :46-54; ≤512 lines lost, no counter; droppedFrames pattern exists in recorder.mjs unused here |
| F-016 | Sync fs on daemon hot path | CONFIRMED | lstatSync chains per write (security.mjs:18,36,81,140,283 + uncited :113); rmSync recursive cleanup.mjs:113 inside async |
| F-017 | No baseline-regen script exists | CONFIRMED | zero writers target test/baselines/expansion; corroborated by plan doc note ("No automated --update-baseline helper exists (T001 spike confirms)") |
| F-018 | Privacy CANARIES drifted across suites | CONFIRMED | privacy-gate 19 vs acceptance 18; sole delta: `alice:secret@github.com` credential canary missing from AC17 sweep |
| F-019 | wt-session mergeWorktree rebases main | CONFIRMED | ref-alive/worktree-gone trivially reachable; rebase runs pre-guard :106-108; no try/finally (wedges worktree OR main); nuke non-atomic :154-158; basename fallback ambiguity :131-136; zero test coverage of fallback path. Precision: behind-main case = fast-forward rewrite; diverged = history rewrite |
| F-020 | Unbounded Tarjan recursion; architecture failure aborts pipeline | CONFIRMED | strongConnect unconditional recursion graph-facts.mjs:126, no depth cap, 50k-file limit :31; run.mjs:331 wraps only PRIVACY_ENFORCED dimensions |

Low/info spots checked (6/6 CONFIRMED): L14 machine-path hook shim (:19,21); L17 engines mismatch; L19 no CI (wording caveat: two fixture workflow files exist under test fixtures, not repo CI); L20 version literal pack-bootstrap.mjs:125; L21 README oxfmt omitted ×5 passages + fmt/fmt-check/fmt-staged/test-e2e absent; L22 hardcoded v22.23.2 path.

## Final Findings (severity/confidence)

- **HIGH** (confidence high): F-004 run-tier inert — documented fast-feedback workflow dead.
- **MEDIUM / verified-high**: F-001, F-002, F-003 (red gates via stale literals), F-005 (compose parsing bug), F-007 (pnpm CVE — bump ≥10.34.2 both manifests), F-008 (drift gate additions gap), F-011–F-013 (lifecycle races), F-015 (silent telemetry loss), F-016 (sync fs hot path), F-017 (no regen script), F-018 (canary drift), F-019 (wt-session mutation hazard), F-020 (Tarjan/pipeline abort).
- **MEDIUM / high, corrected**: F-006 (silent no-op + deadline exit, not crash).
- **MEDIUM / high**: F-009, F-010 (bootstrap trust-boundary gaps).
- **LOW/INFO bundle**: L1 nav scheme unrestricted; L2 gate buffer uncapped; L3 restore clobber; L4 non-atomic writes; L5 signal gaps; L6 happy-path closes; L7 timer leak; L8 grace-logic dup; L9 magic timeouts; L10 oversized files; L11 dom dup + escaper ×4; L12 digest ×6; L13 denylist incompleteness; L14–L25 ops/tooling/docs items (verified subset above); L26 serial cost amplification; L27 daemon.log growth; L28 positive census (~99.5% behavioral assertions).

## Methodology

- Reviewers: 9 substantive independent agents + primary mechanical verification (grep counts, node regex empirics, live run-tier invocation). Challenger independence satisfied for all confirmed findings (verifier ≠ finder).
- Tools unavailable despite retries: adversarial mitigation-hunt disprover (3 empty returns) — residual risk: mitigations could exist that neither pass surfaced; egress block (no user namespaces) — network-free tests only.
- Rungs: R0 static + R3 sandbox-executed (from pass 1; containment clean). Pinned SHA d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3, tree clean except review reports.

## Anti-Coverage

Unchanged from pass 1: node_modules; csm-browse e2e (Docker absent); fixture-real content semantics; payload duplicate audited via drift-gate analysis only; sub-500-line scan test files sampled not exhaustively read.

## Reproducibility

- SHA d94c840e9f4dcba3f1bc7701fdccd1a99a56b2c3; sandbox clone + frozen scripts-disabled installs (pass 1).
- Live checks this pass: `node csm-scan/test/scripts/run-tier.mjs s` → exit 1, partition failure listing 15 files.
- External: OSV /v1/query + /vulns range confirm (CVE-2026-55180 <10.34.2).

## How To Execute

This report fixes nothing. Remediation: explicit csm-plan against these findings, then explicit csm-build on the resulting plan. Suggested first batch: F-001/F-002/F-003 (quote-drift, likely turns most of the suite green), F-006 (one-line import), F-004 (tier manifest), F-007 (pnpm bump).
