# Repository Review — opencode-skills @ a650305 (2026-08-15)

## Control

- [2026-08-15T21:48:31+0000] START -> INTAKE :: cycle 0 :: trigger: explicit csm-review request; FULL audit; user accepted R0-R3 :: rungs: R0
- [2026-08-15T21:48:31+0000] INTAKE -> SCOPE :: cycle 0 :: trigger: repo pinned a650305dd395e9c1e49214e9b116b6632eabffb9, worktree clean, no NORMS.md :: rungs: R0
- [2026-08-15T21:50:12+0000] SCOPE -> EVIDENCE :: cycle 0 :: trigger: 7 chunks defined (C1-C7); anti-coverage drafted :: rungs: R0
- [2026-08-15T21:52:00+0000] EVIDENCE -> FIND :: cycle 0 :: trigger: evidence pack complete (sandbox clone mode 700; npm ci --ignore-scripts OK; OSV ground truth: all 67 pins CLEAN after range verification — querybatch produced 21 FALSE POSITIVES across 8 packages, trapped and documented; Node 20 EOL 2026-04-30 confirmed via endoflife.date; egress-block mechanism unavailable (unshare EPERM) — residual egress risk disclosed, offline test selection used) :: rungs: R0-R2
- [2026-08-15T21:58:00+0000] FIND -> CHALLENGE :: cycle 0 :: trigger: 12 finders returned 63 structured findings; redaction gate applied :: rungs: R0-R3 (csm-scan suite executed in sandbox: 1210/1210 pass 91.7s; check-suite 156 checks OK; browse check-skill OK; containment clean both sides)
- [2026-08-15T22:20:00+0000] CHALLENGE -> CHALLENGE :: cycle 1 :: trigger: challenge-coverage gap — 4 medium findings unchallenged :: rungs: R0
- [2026-08-15T22:26:00+0000] CHALLENGE -> ADJUDICATE :: cycle 1 :: trigger: 6 challenger agents + 1 gap-filler returned 11 AGREE-downgrades, 2 RETRACT (with empirical disproof), 6 NEW findings; adversarial cycle cap reached :: rungs: R0-R3
- [2026-08-15T22:31:00+0000] ADJUDICATE -> EVIDENCE :: cycle 1 :: trigger: coverage measurement missing for test-adequacy findings :: rungs: R3
- [2026-08-15T22:36:00+0000] EVIDENCE -> ADJUDICATE :: cycle 1 :: trigger: coverage measured (88.85% lines / 81.28% branches / 88.73% functions); NEW finding: 263 tests fail under --experimental-test-coverage (plain run re-verified 1210/1210) :: rungs: R3
- [2026-08-15T22:38:00+0000] ADJUDICATE -> VERIFY :: cycle 1 :: trigger: ledger finalized — 84 raw, 7 merged, 2 retracted, 77 upheld (1 critical / 16 high / 36 medium / 22 low / 2 info) :: rungs: R0-R3

Posture: R0+R1+R2+R3 achieved. State: SAVED.
- [2026-08-15T22:41:00+0000] VERIFY -> SAVED :: cycle 1 :: trigger: gate checks passed — 77/77 findings carry core fields (sev/conf/dim/loc + global commit_sha declaration); all E1 records carry verification; all E2 records carry challenge verdicts; coverage matrix filled (finding-or-clean per dimension×chunk); anti-coverage present; redaction pass clean (no host paths, IPs, emails — grep-verified); anchor editions recorded; one presentation deviation (intra-tier grouping) recorded and accepted; VERIFY budget used 0/3 :: rungs: R0-R3
- [2026-08-15T22:42:00+0000] SAVED -> STOP :: cycle 1 :: trigger: report committed; remediation deferred to explicit future csm-plan/csm-grill invocation per How-To-Execute :: rungs: R0-R3

## How To Execute

This report fixes nothing. Remediation happens through a future explicit csm-plan or csm-grill invocation.

## Executive Summary

- **One critical, live-verified exposure**: the csm-browse container publishes unauthenticated CDP (9222) and VNC (5900) on all interfaces (`0.0.0.0`), on a host with a public IP — full browser/session compromise is reachable from the network; the skill's own docs promise `localhost:5900`.
- **csm-scan's privacy guarantee is structurally false for the report file**: `package.json` script bodies (a classic secret channel) and absolute paths render verbatim into NORMS.md while USAGE promises redaction; secret detection also silently covers only the alphabetically-first 400 files, never enumerates hidden/gitignored files, and misses the canonical uppercase `AWS_ACCESS_KEY_ID` form.
- **The csm-review skill itself has a verified methodology trap**: it mandates OSV `/v1/querybatch` and grades "live OSV match" as E1-verified — this exact endpoint returned 21 false-positive CVE matches across 8 packages during this review (ground truth: all 67 pins clean). Consumers would publish fabricated CVEs at maximum confidence.
- **Test quantity is high, test meaning is uneven**: csm-scan's 1210 tests are substantially meaningful (strong determinism/privacy/golden gates) but ~12 are machine-bound to a developer-home path (6 vacuously pass elsewhere, 1 hard-fails), the flagship "acceptance gate" is a tautological regex-on-source check, and no coverage/mutation/property tooling is wired (measured: 88.9% lines, 81.3% branches; 263 tests break under coverage instrumentation). csm-browse has **zero unit tests** — one Docker-gated e2e with hardcoded IPs and an always-true assertion is the only safety net for ~3,900 lines.
- **The doc-only skills' conformance gate checks substrings, not structure**: `SAVED -> STOP` (13 chars) is the entire state-machine check for 4 of 5 state skills; cross-skill string contracts (plan paths, `-bdd-csm.md`, `Superseded for BDD/TDD` pointer) and self-claimed counts (9 states, 18 dimensions) are unverified; 7 real plan artifacts form an unused golden corpus.
- **Repo hygiene**: no LICENSE on a verified-public repo with ~46k lines of original code; no CI/hooks run the 1210 tests or the 156-check gate; host runs past-EOL Node 20 with floor-only `engines`; csm-browse carries verified lifecycle bugs (SIGTERM recording finalize broken, sweep-vs-creation kill race, zombie-daemon mis-adoption).

## Methodology Disclosure

- **Reviewers**: primary orchestration/adjudication + 12 finder subagents (dimension×chunk) + 7 independent challenger subagents (never authors of judged work). All subagent outputs schema-validated and redaction-gated by the primary.
- **Scale**: FULL audit — all 18 dimensions × 7 chunks. Challenge: independent for every critical/high/medium finding (medium findings initially missed in dispatch were gap-challenged in cycle 1); low/info primary-led with recorded caveat where noted.
- **Tools+versions**: node v20.20.2, npm 10.8.2, git (worktree = pinned SHA), docker (read-only inspect/ps by challenger), OSV.dev API v1 (`querybatch`, `query`, `vulns`), endoflife.date API.
- **Rungs used**: R0 (static at SHA) everywhere; R1 sandbox clone `/tmp/opencode/csm-review-20260815214831-skills/` (mode 700, umask 077, `npm ci --ignore-scripts`, HOME/TMPDIR/XDG redirected, credential env scrubbed); R2 dependency audit (OSV per-pin + authoritative-range verification) and test inventory; R3 executed `csm-scan` suite (1210/1210 pass, 91.7s), `check-suite.mjs` (156 OK), `check-skill.mjs` (PASS), plus coverage measurement run.
- **Containment results**: post-run `git status` clean in sandbox clone; reviewed repo shows only this report scaffold; env scrub verified; no in-place execution of reviewed code.
- **Egress disclosure**: `unshare -rn` unavailable (EPERM) → no egress-block mechanism; residual risk mitigated by selecting offline-safe tests only (csm-scan suite, linters). csm-browse e2e NOT executed (destructive: `fuser -k 8090`, kills daemons, requires Docker) — browse runtime behavior assessed statically + challengers' live read-only docker inspection.
- **OSV evidence discipline**: `/v1/querybatch` with versions returned 21 matches for 8 packages; every match was disproven via `/v1/vulns` authoritative ranges (all pinned versions outside affected ranges). Ground truth: **0 genuine vulnerabilities across all 67 pinned packages**. The querybatch behavior is itself reported as finding F-005.
- **Anchor editions**: OWASP Top 10:2025; CWE Top 25 (2025); ASVS v5.0.0; ISO/IEC 25010:2023; Google eng-practices (current); SonarSource concepts (current); testsmells.github.io (current); FIRST CVSS v4.0. All spot-checked reachable during EVIDENCE.
- **Residual unknowns**: csm-browse e2e not run live by primary; no mutation testing performed (proportionality); coverage numbers approximate (see F-025); behavior of skills-as-prompts not behaviorally tested (no eval harness exists — see F-017/F-048).

## Coverage

Chunks: C1 csm-scan lib+CLI · C2 csm-scan tests · C3 csm-browse lib+scripts · C4 csm-browse tests+manifests · C5 doc-only skills · C6 suite infra (check-suite, upload, README) · C7 process docs (.agents).

| Dim | C1 | C2 | C3 | C4 | C5 | C6 | C7 |
|---|---|---|---|---|---|---|---|
| 1 Correctness | F-002..004,020,023,024 | F-026 | F-009..011,030..032,037..040 | F-013 | clean | F-052,F-053 | clean |
| 2 Tech debt | F-055 | F-026 | F-066 | clean | clean | clean | F-073 |
| 3 Smells | F-056 | F-028 | F-066 | F-045 | F-068 | F-047 | clean |
| 4 Anti-patterns | F-024 | F-028 | F-066 | F-012 | clean | F-046 | clean |
| 5 Security impl | F-022 | — | F-001,033,064 | — | — | F-052 | — |
| 6 Security controls | F-019 | F-057 | F-060,061 | F-044 | — | — | — |
| 7 Secrets/data | F-004,019 | F-057 | F-061,062 | F-044 | — | F-052 | F-073 |
| 8 Concurrency | clean | — | F-034..038 | — | — | — | — |
| 9 Memory/resource | clean | — | F-039,065 | — | — | — | — |
| 10 Error/resilience | F-024 | — | F-011,041,042 | — | — | F-053 | — |
| 11 Input validation | F-021,022 | — | F-060,063 | F-044 | — | F-052 | — |
| 12 Test presence | (self-ref n/a) | F-007 | (self-ref n/a) | F-012,014 | F-048,049* | F-043 | — |
| 13 Test quality | — | F-007,008,028,045 | — | F-045 | F-015 | F-047 | — |
| 14 Test adequacy | — | F-025..027,029 | — | F-013 | F-017 | F-043 | — |
| 15 Dependencies | F-005 (evidence) | — | F-064 | — | — | F-050,072 | F-076 |
| 16 Toolchain | — | — | F-051 | F-013 | — | F-051 | — |
| 17 Operability | F-075 | — | F-074 | F-013 | — | F-053 | F-073 |
| 18 CI/docs/license | — | F-049 | — | — | F-069,070 | F-001..? see F-070,071 | F-073 |

*F-049 (no CI) spans C2/C3/C5/C6 — recorded once under C6.

## Anti-Coverage

- `csm-browse/node_modules/` (~1,180 vendored dirs): assessed via lockfile + OSV only. **Risk**: installed tree could drift from lockfile; low given `npm ci` reproducibility verified.
- `.git/` internals: not reviewed. **Risk**: negligible.
- Binary/image fixtures: not content-reviewed. **Risk**: negligible.
- csm-browse e2e live run: not executed (destructive side effects: port kills, daemon kills; no egress block available). **Risk**: runtime behavior findings (F-009..F-042) rest on static trace + read-only live inspection, not failing tests.
- `.agents/plans/*` historical content: skimmed as process evidence only. **Risk**: minor doc rot undetected.
- Mutation testing / property-based runs: not performed (proportionality). **Risk**: test-suite blind spots quantified only by line/branch coverage.
- Skill prompt behavior (LLM-executed semantics): no behavioral eval harness exists in repo; not evaluated. **Risk**: the doc-only skills' runtime conformance to their own state machines is unmeasured.

## Findings Summary

| Severity | Count | By area |
|---|---|---|
| critical | 1 | browse-security (1) |
| high | 16 | scan-correctness (3), review-skill-method (1), licensing (1), scan-tests (2), browse-correctness (3), browse-tests (3), doc-skill-gates (3) |
| medium | 36 | scan (7), scan-tests (4), browse-code (13), browse-tests (3), linter/doc-skills (3), supply-chain/ops (6) |
| low | 22 | — |
| info | 2 | — |

Confidence distribution (upheld): verified/E1 ×14, high/E2 ×48, medium/E3 ×13, low/E4 ×2. Dedup: 84 raw → 7 semantic merges → 2 retractions → 77 upheld.

## Findings

Ordered by severity tier first (sort_key's primary key); within tiers, grouped by component for readability with confidence/evidence-class noted per record (presentation deviation from strict sort_key recorded at VERIFY — accepted). All `commit_sha` = a650305dd395e9c1e49214e9b116b6632eabffb9. Snippets verbatim (redacted where noted).

### F-001 · Unauthenticated CDP 9222 + VNC 5900 published on all host interfaces of a public-IP host
**sev** critical · **conf** verified (E1) · **dim** 5 Security impl · **anchor** CWE-668, CWE-732, OWASP A05:2021
**loc** csm-browse/lib/constants.mjs:7, csm-browse/lib/constants.mjs:34, csm-browse/scripts/ensure-browser.mjs:103
**snippet** `-p 5900:5900 -p 9222:9222` / `'--remote-debugging-address=0.0.0.0'`
**expl** `docker run -p` without host-IP binds 0.0.0.0/[::]; CDP has zero auth; VNC runs with empty password. Live-verified by two independent agents: `0.0.0.0:9222` answers `/json/version` unauthenticated; host carries a public IPv4 + global IPv6 ([REDACTED:host-ip]) and the sockets serve those interfaces. SKILL.md:95 promises "VNC server on `localhost:5900`" — code contradicts docs. Anyone with network reachability gets full browser control, cookie theft, and `Runtime.evaluate` code execution; this is the credential-entry browser (`--password` typed into it per SKILL.md:84-87).
**impact** Complete compromise of browser, sessions, and credentials from the network.
**remediation** Bind `-p 127.0.0.1:9222:9222 -p 127.0.0.1:5900:5900`; drop `--remote-debugging-address=0.0.0.0`; set VNC password or unpublish 5900. Readiness check and per-session traffic (container-IP 9224+) unaffected — challenger verified fix compatibility.
**verif** `docker ps` + `curl /json/version` (finder + challenger, independent). **challenge** AGREE — "home LAN framing too charitable; public VPS". **status** upheld.

### F-002 · Secret scanning silently covers only the alphabetically-first 400 files
**sev** high · **conf** verified (E1) · **dim** 1 · **anchor** ISO/IEC 25010 functional suitability
**loc** csm-scan/lib/scan/deep/security.mjs:29, csm-scan/lib/scan/deep/security.mjs:248, :215-218, :283
**snippet** `const SCAN_FILE_LIMIT = 400;` / `const bounded = files.slice(0, SCAN_FILE_LIMIT);`
**expl** `detectSecretPatterns`, `detectSecurityHeaders`, `detectRateLimiting` slice the alphabetically-sorted file list; files >1MB also silently nulled. Independently reproduced by finder and challenger: 413-file repo with secret at sorted position 413 → `secrets.count: 0`; same file alone → detected. No cap disclosure (unlike new dimensions' searchSpace discipline).
**impact** False-negative security claims on any repo >400 files — a common size.
**remediation** Prioritize likely-config files or scan all text-bounded files; disclose `scannedFiles/filesSkipped` in findings.
**verif** Reproduced twice (finder + challenger fixtures). **challenge** AGREE + addendum (>1MB nulling). **status** upheld.

### F-003 · AWS key regex misses canonical uppercase `AWS_ACCESS_KEY_ID`
**sev** high · **conf** verified (E1) · **dim** 1
**loc** csm-scan/lib/scan/deep/security.mjs:229-230
**snippet** `{ name: 'AWS Access Key', re: /(?:AWS|aws)[_\-]?access[_\-]?key[_\-]?id?["'\s:=]+([A-Z0-9]{20})/ },`
**expl** Prefix alternation handles AWS/aws but `access|key|id` tokens are lowercase-only (no `i` flag; `id?` cannot match `ID`). Independently reproduced: uppercase env-var form → 0 findings; lowercase → 1. The all-caps form is the most common leak shape in `.env`/CI/compose. Contrast: the output sanitizer's SECRET regex (reporter.mjs:34) does use `/gi`.
**impact** Systematic false negatives for flagship secret patterns.
**remediation** Add `i` flag keeping the value group exact-case; add uppercase fixtures to security tests.
**verif** Reproduced twice. **challenge** AGREE. **status** upheld.

### F-004 · `package.json` script bodies rendered verbatim into NORMS.md — secret leak channel
**sev** high · **conf** verified (E1) · **dim** 7 · **anchor** CWE-312, CWE-200
**loc** csm-scan/lib/scan/render/stack.mjs:54-62, csm-scan/lib/scan/render/config.mjs:136-145, csm-scan/lib/scan/deep/stack.mjs:404-405
**snippet** `| ${escapeField(name, { inTable: true })} | \`${escapeField(cmd, ...)} |``
**expl** npm scripts frequently embed deploy tokens/registry passwords/webhook credentials; `escapeField` is markdown-escaping only (identity privacy hook); stack+config are grandfathered legacy dimensions the privacy gate never inspects. Challenger reproduced: a `ghp_`-shaped PAT in a script value rendered verbatim, twice, into NORMS.md while USAGE promises secrets "redacted before they reach … the report". `overview.description` is the same un-gated free-text channel.
**impact** Secrets from scanned repos copied into a "privacy-safe" shareable report.
**remediation** Drop script bodies (names + length only) or pass a redacting privacyHook into the render context for the write path; add scripts/description canaries to the T227 fixture (see F-057).
**verif** Reproduced twice (finder + challenger with canary token). **challenge** AGREE. **status** upheld.

### F-005 · csm-review mandates OSV querybatch and grades "live OSV match" E1-verified — empirically false-positive-prone
**sev** high · **conf** verified (E1) · **dim** 15 (skill methodology defect)
**loc** csm-review/SKILL.md:69, :126, :222, :235
**snippet** `OSV querybatch + endoflife.date GET (auth-free).` / `` `verified` (E1): deterministic tool reproduces — analyzer output, failing test, live OSV match. ``
**expl** The skill hard-codes `/v1/querybatch` as R0 default and equates a "live OSV match" with the highest confidence tier (exempt from challenge at low severity). During this very review, querybatch returned 21 false-positive matches across 8 packages (debug, ws, jpeg-js, xml2js, zod, mime, ms, file-type); authoritative-range inspection (`/v1/vulns`) proves all 67 pins clean. A reviewer following the skill verbatim publishes fabricated CVE findings labeled "verified". Challenger independently reproduced both the false-positive mode and the false-negative mode (clean pins returning nothing while a genuinely-affected lodash control matched), i.e. misgrading cuts both ways.
**impact** Every future csm-review run can emit false CVEs at maximum confidence — the skill manufactures the failure class it exists to prevent.
**remediation** Change R0 recipe to per-package `/v1/query` (or OSV CLI) + mandatory affected-range confirmation of every hit; demote raw querybatch output to candidate signal; document the endpoint trap in the skill text.
**verif** Primary reproduction (batched queries, range checks) + independent challenger reproduction. **challenge** AGREE (severity affirmed). **status** upheld.

### F-006 · No LICENSE file on a verified-public repo with ~46k lines of original code
**sev** high · **conf** verified (E1) · **dim** 18 · **anchor** SPDX
**loc** README.md:167-169 (admits absence), repo root, csm-browse/package.json (no license field)
**snippet** `No LICENSE file is currently present in this repository.`
**expl** Remote verified public via anonymous fetch. Under default copyright, no one may copy, modify, or redistribute — contradicting the README's copy-the-folders quickstart. csm-browse/package.json also lacks a `license` field.
**impact** Legal ambiguity blocks forks/reuse/packaging.
**remediation** Add OSI license (e.g. MIT) at root, matching package.json field, README update; add a check-suite LICENSE check.
**verif** Existence + publicness verified. **challenge** AGREE (publicness caveat closed). **status** upheld.

### F-007 · Hidden test skips: suite machine-bound to a developer-home path; 6 vacuous passes + 1 hard fail elsewhere
**sev** high · **conf** high (E2) · **dim** 12/13
**loc** csm-scan/test/golden.test.mjs:186-190, write.test.mjs:341-344, operations.test.mjs:387-389, documentation.test.mjs:82-84, config.test.mjs:868-871, voice-gate.test.mjs:219-224 (bare `return`); conventions.test.mjs:147-148, architecture.test.mjs:13-14, testing.test.mjs:975-976, stack.test.mjs:245-246, security.test.mjs:431-432 (`skip:`); parse.test.mjs:179-180 (unguarded)
**snippet** `const REPO = '/home/[REDACTED]/code/projects/perplexity-cli'; if (!existsSync(REPO)) { ... return; }`
**expl** 12 files reference the author's home path. Six guard with bare early-`return` — node:test counts them as passed on any other machine with zero assertions executed (the "1210 pass" figure overstates by 6 there). Five use visible `skip:`. `parse.test.mjs:179` has **no guard** — `readFileSync` ENOENT makes the suite red on any machine but the author's. These are also the only non-synthetic inputs in the suite.
**impact** Coverage numbers not portable/auditable; suite not runnable elsewhere; most realistic inputs never run outside one workstation.
**remediation** Env var (`CSM_SCAN_REAL_REPO`) with checked-in fallback fixture; convert returns to `t.skip()`; fix parse.test.mjs guard.
**challenge** AGREE (count refined: 6 vacuous / 5 labeled / 1 unguarded — challenger new sub-finding merged). **status** upheld.

### F-008 · AC20 "acceptance gate" is tautological regex-on-source; its no-skip check is provably bypassed
**sev** high · **conf** high (E2) · **dim** 13
**loc** csm-scan/test/expansion-final-acceptance.test.mjs:1238-1273 (esp. 1239, 1263-1264), voice-gate.test.mjs:222
**snippet** `assert.equal(ACCEPTANCE_COMMAND, 'node --test --test-concurrency=1');` / `assert.doesNotMatch(source, /\b(?:test|it)\.(?:skip|todo)\b|\bskip\s*:/, ...)`
**expl** The gate asserting "every named gate passes with zero failures" never runs anything: it asserts a file-local constant against its own literal (pure tautology) and greps gate sources for the text `test(`. The skip-detector regex cannot match `t.skip(...)` — and voice-gate.test.mjs, in the named-gates list, uses exactly `t.skip()` at line 222. Pipeline ordering is likewise verified by `indexOf` on source text.
**impact** The acceptance layer — what a reviewer would trust most — provides illusory assurance.
**remediation** Derive no-skip from node:test machine-readable summary (`skipped: 0`); prove gate-before-write behaviorally (throwing sink + canary — already done in other files); delete constant-vs-literal assertion.
**challenge** AGREE (verified verbatim). **status** upheld.

### F-009 · Daemon SIGTERM cleanup calls stopRecorder without sessionDir → recordings never finalized on shutdown
**sev** high · **conf** high (E2) · **dim** 1/10
**loc** csm-browse/scripts/session-daemon.mjs:113-121, csm-browse/lib/recorder.mjs:247-253
**snippet** `await withTimeout(recorder.stopRecorder(client, tabSessionId), 3000, 'Recorder finalize');` vs signature `stopRecorder(client, sessionId, sessionDir)`
**expl** Third argument omitted → guard `activeRecording.sessionDir !== undefined` always throws `'not recording'` when a recording IS active; swallowed by cleanup catch. markStop, stdin end, graceful ffmpeg exit, and recorder.json stats are skipped on every daemon shutdown; video risks truncation; `recorder.json` stuck at `running:true` until sweep.
**impact** Every SIGTERM/SIGINT during active recording loses stats and risks truncated/orphaned video.
**remediation** Pass `sDir`; or derive sessionDir from activeRecording. Add shutdown-mid-record e2e.
**challenge** AGREE. **status** upheld.

### F-010 · sweep() races session creation: kills live chromium/socat; reaps healthy idle sessions
**sev** high · **conf** high (E2) · **dim** 8 · **anchor** CWE-362, CWE-609
**loc** csm-browse/lib/sweep.mjs:164-172, :210-220, :75-86, csm-browse/scripts/ensure-browser.mjs:196-222, :332, :411
**snippet** `const hostStateExists = existsSync(join(SESSIONS_ROOT, psid, 'state.json'));`
**expl** sweep() runs on every ensure-browser; `skipSid` protects only the caller. During creation, chromium+socat exist up to ~30s before state.json is written — any concurrent sweep pkills them (creation fails with misleading "CDP did not become ready"). The host pass computes `stale = age > ageMs` before consulting daemon liveness, so healthy-but-idle sessions are reaped. Concurrent sessions are the tool's intended mode (port pool exists for them).
**impact** Concurrent startups randomly destroy each other's browsers; idle-active sessions killed underneath users.
**remediation** Write a `creating.marker`/state before launching chromium (inside port lock); sweep treats marker+daemon-liveness as do-not-touch regardless of age.
**challenge** AGREE (all sub-points verified). **status** upheld.

### F-011 · No CDP disconnect detection: zombie daemon keeps pid/ready markers and is mis-adopted on relaunch
**sev** high · **conf** high (E2) · **dim** 10
**loc** csm-browse/lib/daemon-core.mjs:54, :126-135, csm-browse/scripts/session-daemon.mjs:140-143, csm-browse/scripts/ensure-browser.mjs:272-286
**snippet** `} catch { // readdir can fail if cmd/ doesn't exist yet, continue polling }`
**expl** Daemon never subscribes to `disconnect`; queue loop swallows all CDP failures and polls forever. When chromium dies, daemon stays "alive" holding pid+ready markers. On relaunch after session recreation, `launchDaemon` returns the zombie's pid immediately (`daemonPid && existsSync(readyMarker)`), while the freshly spawned daemon exits 2 unnoticed. Session permanently wired to dead ports.
**impact** Broken sessions that only self-heal via 10-min sweep or manual close; zombie node processes accumulate.
**remediation** `client.on('disconnect', cleanup)`; stop old daemon before relaunch; validate ready-marker freshness (mtime).
**challenge** AGREE (verified end-to-end incl. exit-2 path). **status** upheld.

### F-012 · csm-browse: zero unit tests for DI-friendly modules; no `npm test` wiring
**sev** high · **conf** high (E2) · **dim** 12/14
**loc** csm-browse/tests/ (only e2e.mjs), csm-browse/package.json:1-13 (no scripts), lib/cookies.mjs:15, lib/cdp.mjs:74-105, lib/ports.mjs:31-74, lib/session.mjs:8-12
**snippet** `export async function dismissCookies(client, sessionId) {`
**expl** cookies/cdp/session take the CDP client (or nothing) as parameters — trivially stubbable — yet have zero unit tests; consent-pattern logic (7 selector patterns, 12 accept texts) lives in string literals executable only through a real browser, so a typo is invisible to the suite. Sibling skill csm-scan ships 1210 node:test cases; the convention exists. `package.json` has no `scripts` section at all.
**impact** Highest-defect-density logic (regex/parsing/timeouts) has no fast feedback; regressions surface only via rare Docker e2e runs, if at all.
**remediation** node:test unit files: cookies (stub client asserting emitted Runtime.evaluate per pattern), cdp escaping/timeout/1MB cap, session SID regex, ports lock/stale logic with temp root; wire `npm test`.
**challenge** AGREE (DI-ability confirmed; nit: connect() not injectable without module mock). **status** upheld.

### F-013 · e2e is the only safety net; hard-depends on Docker, hardcoded 172.17.0.1, fuser -k 8090, ffprobe
**sev** high · **conf** high (E2) · **dim** 14/16 · **anchor** Google Test Sizes (only L present)
**loc** csm-browse/tests/e2e.mjs:9, :59-61, :145-149, :525, :684
**snippet** `const FIXTURE_BASE = 'http://172.17.0.1:8090';`
**expl** Suite requires: running `chromium-vnc` container, default docker0 bridge IP (breaks rootless/custom-bridge/WSL2-macOS), host curl/ffprobe/fuser, container pgrep. Kills whatever occupies 8090 (`fuser -k`), SIGTERMs host daemons, writes summary outside repo. No skip mechanism when Docker absent. The repo's own plan docs record "e2e NOT run (fuser -k…)" — it cannot run in the project's own review sandbox.
**impact** ~3,900 lines effectively have no regression net in practice; the only offline gate (check-skill.mjs) validates almost none of the code (F-043).
**remediation** S-size unit layer always runnable (F-012); parameterize FIXTURE_BASE/container name; env-probe Docker with SKIP reporting; summary to configurable path.
**challenge** AGREE. **status** upheld.

### F-014 · sweep.mjs: 5 of 6 destructive cleanup passes have zero test coverage
**sev** high · **conf** high (E2) · **dim** 12
**loc** csm-browse/lib/sweep.mjs:107-122, :124-154, :156-181 (kill path), :183-206, :208-223; stimuli only at tests/e2e.mjs:601-630
**snippet** `const { stdout } = await execFileAsync('pgrep', ['-af', 'session-daemon.mjs --session ']);`
**expl** e2e Step 13 exercises only the host-dir age branch. Orphaned-daemon, orphan-ffmpeg, container-chromium kill, stale-recorder-lock, and orphan-socat passes are never stimulated — and they kill PIDs from pgrep parsing. sweep runs automatically on every ensure-browser.
**impact** A regression in any orphan pass could kill wrong processes on every session start, undetectable by tests.
**remediation** Unit-test sweep with fake docker/pgrep layer, or e2e steps spawning decoy daemon/ffmpeg/socat asserting selective removal and skipSid/fresh-session survival.
**challenge** AGREE (branch-by-branch mapping confirmed). **status** upheld.

### F-015 · check-suite section/state checks are unanchored substrings — `SAVED -> STOP` (13 chars) is the whole state check for 4 of 5 skills
**sev** high · **conf** high (E2) · **dim** 13
**loc** scripts/check-suite.mjs:167-169, :172-175, :177-181, :184, :71-77
**snippet** `check(content.includes(sec), ...)` / STATE_LINES: grill/plan/bdd-tdd/review → `'SAVED -> STOP'`
**expl** Experimentally confirmed: `'### Core Rules'.includes('## Core Rules') === true`; headings inside fences, duplicates, reordering, demoted levels all pass. The tmux must-not check false-positives on an H3 mention. Only csm-build gets a full chain check — order-blind. A rename/garble of every transition except the terminal one passes for four skills. README advertises this as the "repo-wide conformance gate" (156 checks). Corroborated by two finders independently + challenger experiment.
**impact** Structural drift ships green; gate provides false assurance; one false-positive mode blocks legitimate edits.
**remediation** Parse `^##\s` headings outside fences (fence-length-aware — see F-067); assert exact-title membership/exclusion, uniqueness, order; anchor state chains at line start; apply full-chain check to all 5 state skills.
**challenge** AGREE (substring experiment confirmed). **status** upheld (merged 3 same-root-cause findings).

### F-016 · Cross-skill string contracts have no cross-file verification
**sev** high · **conf** high (E2) · **dim** 12
**loc** csm-plan/SKILL.md:200, csm-bdd-tdd/SKILL.md:185, :217, csm-build/SKILL.md:87-91
**snippet** `Superseded for BDD/TDD` / `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md` / `*-bdd-csm.md`
**expl** csm-build's plan-location algorithm depends on literals produced by two other skills: the save-path convention (csm-plan:200), the `-bdd-csm.md` suffix + `-v2-` markers (csm-bdd-tdd:185), and the exact pointer phrase (csm-bdd-tdd:217). check-suite never compares strings across files (grep: zero occurrences of `bdd-csm`/`Superseded`). Today they coincide; nothing keeps them coincident.
**impact** A rename in csm-bdd-tdd breaks csm-build's pointer-following at runtime with zero CI signal — the most damaging failure mode available in a prompt-only suite.
**remediation** Centralize contracts as data (one contracts module consumed by docs+linter) or add producer/consumer cross-reference checks; round-trip fixture synthesizing a plan tree asserting resolution rules.
**challenge** AGREE (all strings verified verbatim). **status** upheld.

### F-017 · No golden-corpus or behavioral tests for doc-only skills despite 7 conforming real artifacts
**sev** high · **conf** high (E2) · **dim** 12/14
**loc** .agents/plans/*-csm.md (7 files), csm-plan/SKILL.md:206-287, README.md:157
**snippet** `single-file skills with no test suite; validate by invoking them.`
**expl** The templates are the load-bearing contract for resumability (RECOVER reads the plan; agents resume from Control). 7 real plans machine-verified to contain all 16 Required Plan Document sections in order — a ready-made regression corpus — but nothing pins templates to reality. "Validate by invoking them" conflates deterministic structure checks (cheap, stable, absent) with behavioral checks.
**impact** Real plans could stop conforming with no signal; resumability protocol unpinned.
**remediation** Corpus test: every `.agents/plans/*-csm.md` ⊇ template sections in order; every `.agents/reviews/*-review.md` matches Report Format headings + finding-record core fields. Optional tier: deterministic-eval smoke harness with canned transcripts + stubbed model asserting activation-boundary answers.
**challenge** AGREE (caveat: current review file is in-progress scaffold; 7-plan half carries it). **status** upheld.

### F-018 · Secret scanning never enumerates hidden/gitignored files
**sev** medium · **conf** medium (E3) · **dim** 1/11 · **anchor** CWE-693-adjacent (detection completeness)
**loc** csm-scan/lib/scan/shared/command.mjs:95-101, csm-scan/lib/scan/shared/enum.mjs (rg:files without --hidden/--no-ignore), deep/security.mjs:51-67
**snippet** (mechanism: `rg:files` invocation lacks `--hidden`/`--no-ignore`)
**expl** Dotfiles and gitignored files are absent from `overview.files`, hence from detectSecretPatterns entirely. A committed-but-gitignored `.env`/`.npmrc` — precisely where real leaked credentials live — is structurally never scanned while the security dimension reports full coverage. Same undisclosed-false-negative class as F-002.
**impact** Systematic blind spot on the highest-value secret locations.
**remediation** Add a bounded hidden/gitignored enumeration pass for secret detection only (with disclosure), or document the exclusion in report output.
**challenge** NEW (challenger A, code-inspection verified). **status** upheld (primary-verified statically).

### F-019 · Privacy gate grandfathering: overview + 10 legacy dimensions bypass fail-before-write; abs paths/gitRoot render despite USAGE promise
**sev** medium · **conf** high (E2) · **dim** 7/6 · **anchor** CWE-359, CWE-200
**loc** csm-scan/lib/scan/pipeline/run.mjs:462-464, :474-503, csm-scan/lib/scan/write.mjs:13-14, :24-25, csm-scan/scripts/scan.mjs:27-28
**snippet** `PRIVACY_ENFORCED_DIMENSIONS = Object.freeze(['api','data','deployment','maintainability','governance','assurance','practices'])` / `- **Path**: \`${escapeField(overview.path)}\``
**expl** assertFindingsPrivacy covers only the 7 new dimensions + findings.global; overview (name, free-text description, files, manifest) and 10 legacy dimensions never pass the gate; runExistingTenPipeline applies none. overview.path/gitRoot are resolved absolute paths rendered verbatim (reproduced: `- **Path**: <abs>` in NORMS.md). T227 documents the root-path rendering as deliberate ("established T226/T224 behavior") and excludes it from canaries — so the defect is the docs/guarantee contradiction plus the un-gated description channel, realized through F-004.
**impact** Machine usernames and directory layout disclosed in a "privacy-safe" shareable artifact; false guarantee worse than none.
**remediation** Render repo basename or redacted placeholder for Path/Git; run a final-markdown sanitizeText (or assertPrivacySafe) pre-write; extend gate to overview; align USAGE text with actual behavior.
**challenge** DOWNGRADE high→medium (documented deliberate behavior; T227 does cover planted classes end-to-end for legacy dims). **status** upheld at medium (merged 3 same-root findings).

### F-020 · searchCompleteness fallthrough classifies partially-unsupported search spaces as `complete`
**sev** medium · **conf** verified (E1) · **dim** 1
**loc** csm-scan/lib/scan/enrich.mjs:317-323, csm-scan/lib/scan/deep/deployment/scanner.mjs:76-78
**snippet** `if (cleanUnsupported) return 'unsupported'; if (incomplete) return 'incomplete'; if (cleanComplete) return 'complete'; return 'complete';`
**expl** A space that is neither cleanly unsupported (requires readable===false) nor cleanly complete falls through to 'complete'. Reachable: deployment scanner emits `{supported:false, readable:true}` when one artifact is NO_EXTRACTOR-unsupported alongside parsed peers (e.g., docker-compose.yml + marker-less k8s/notes.yaml — candidate admission verified at extractor.mjs:1394-1404). Claim status then upgrades to `observed`, inverting the T202 contract ("parser failures yield unverified, never absence").
**impact** Expected-claim coverage overstates completeness for mixed manifests.
**remediation** Default fallthrough → 'incomplete' (or explicit partial-unsupported class); fixture with one supported + one unsupported artifact asserting non-observed.
**verif** Deterministic classification repro (finder) + reachability trace (challenger). **challenge** AGREE. **status** upheld.

### F-021 · Untrusted repo content reaches the report with markdown/HTML-unaware encoding (prompt-injection channel)
**sev** medium · **conf** high (E2) · **dim** 11 · **anchor** CWE-74, ASVS V5 output encoding
**loc** csm-scan/lib/scan/render/base.mjs:12-17, csm-scan/lib/scan/write.mjs:25, :51
**snippet** `scalar = scalar.replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/`/g,'\\`');`
**expl** escapeField escapes backslash/pipe/backtick/line-leading markers but no HTML entities, no link/image neutralization, and newlines inside table cells (inTable skips multi-line escape). NORMS.md is explicitly agent-consumed context, so repo-controlled strings become an instruction-injection vector from an untrusted source — beyond formatting breakage.
**impact** Malicious scanned repo can smuggle instructions/links/HTML into trusted agent context.
**remediation** Encode `<>&"'`; neutralize `](http` syntax for untrusted fields; strip control chars in table cells; consider allowlist rendering for repo-derived strings.
**challenge** AGREE (structural markdown mitigation noted; semantic injection survives). **status** upheld.

### F-022 · Repo-controlled regexes from `.gitleaks.toml` compiled and executed (ReDoS)
**sev** medium · **conf** medium (E3) · **dim** 5/11 · **anchor** CWE-1333
**loc** csm-scan/lib/scan/deep/security.mjs:549-559, :495-499
**snippet** `matchers.push(new RegExp(pattern));`
**expl** Up to 200 attacker-supplied patterns compiled with only a syntax-error catch and `re.test()`-ed against attacker-controlled paths (no timeout/budget). V8 still exhibits catastrophic backtracking for classic nested-quantifier patterns. Reachable when a secret finding exists to cross-reference. Impact is a hung scan process (local DoS), not RCE — challenger caveat noted.
**impact** Crafted repo can hang the scan indefinitely; tool is designed to scan untrusted repos.
**remediation** Translate allowlist entries to literal/glob matching or bounded-backtracking validation; cap tested path length; per-pattern time budget.
**challenge** AGREE with impact caveat. **status** upheld.

### F-023 · SQL DDL evidence line numbers computed from statement-relative offsets — nearly all records report line 1
**sev** medium · **conf** verified (E1) · **dim** 1
**loc** csm-scan/lib/scan/deep/data/extractor.mjs:369, :386, :401-424 (inherit :317, :331)
**snippet** `const line = lineIndexOf(source, statement.indexOf(tableMatch[0]));`
**expl** sqlStatements() splits AND trims (offsets destroyed); all DDL regexes are ^-anchored on the trimmed statement so the offset is ~always 0, but lineIndexOf counts newlines from file top. Challenger empirically reproduced against the real module: entities at true lines 3/7/10 all report line 1. Wrong lines flow into NORMS.md `path:line` evidence tables and into record identity/dedup/sort keys (model.mjs:325-690). No test pins SQL line values (test lines 147-152 are hand-written model inputs).
**impact** Wrong evidence pointers for all SQL-derived records, undermining declaration-backed-evidence claims.
**remediation** Return {text, offset} pairs from sqlStatements; lineIndexOf(source, offset + match.index); extractor test asserting real fixture positions.
**verif** Empirical module-level repro (challenger). **challenge** AGREE. **status** upheld.

### F-024 · evaluateRules: one rule hitting its per-rule cap (128) aborts evaluation of ALL remaining rules
**sev** medium · **conf** verified (E1) · **dim** 1/4/10
**loc** csm-scan/lib/scan/providers/rules.mjs:320-336, csm-scan/lib/scan/pipeline/run.mjs:807
**snippet** `if ((perRuleCounts.get(rule.id) ?? 0) >= RULE_EVALUATION_LIMITS.maxMatchesPerRule) { capped = true; break; } ... if (capped) break;`
**expl** Per-rule cap and global cap (2048) share one `capped` flag and double-break: a broad early rule (128 matches) terminates the whole evaluation — every later rule yields zero observations. Challenger empirically reproduced: rule order [broad, narrow] → narrow gets 0; reversed → both bounded. Production-reachable via plugins with ≥2 rules; `rulesInspected` still reports all rules; the two cap causes are indistinguishable to callers. Adjacent: plugin evaluateRules sits outside the best-effort degradation envelope (one throwing rule can abort a multi-repo scan — run.mjs:803-875).
**impact** Plugin evidence silently disappears for later-ordered rules; one plugin defect can destroy an entire long-running scan.
**remediation** `continue` past per-rule cap with separate flag; hard-stop only on global cap; wrap per-plugin evaluation in try/catch recording degraded status (matches T225 semantics).
**verif** Empirical repro (challenger). **challenge** AGREE. **status** upheld.

### F-025 · 263 tests fail under `--experimental-test-coverage` (plain run passes 1210/1210)
**sev** medium · **conf** verified (E1) · **dim** 13/14
**loc** csm-scan/test/ (first failures: architecture-repair tests 6-9...), suite-wide
**snippet** plain: `# pass 1210 / # fail 0`; coverage mode: `# pass 947 / # fail 263`
**expl** Deterministic across two sandbox runs: instrumented execution breaks architecture-repair and ~20 other files' tests while the identical plain run is green. Suite is not hermetic under instrumentation (likely source/stack-sensitive assertions). Measured coverage (approximate given failures): 88.85% lines / 81.28% branches / 88.73% functions.
**impact** Coverage tooling — the cheapest test-adequacy measurement — is unusable as-is; signals hidden environment coupling in tests.
**remediation** Triage the instrumentation-coupled assertions (likely hash/source comparisons); make coverage mode green; wire coverage into the routine gate.
**verif** Two deterministic runs (primary). **status** upheld (primary-discovered; primary-led verification — independence caveat).

### F-026 · Legacy "golden pipeline" tests mirror an orchestration the CLI no longer uses (×3 duplicates)
**sev** medium · **conf** high (E2) · **dim** 13
**loc** csm-scan/test/golden.test.mjs:28-66, test/fixtures-pipeline.test.mjs:30-94, test/voice-gate.test.mjs:107-137, scripts/scan.mjs:6,161
**snippet** `// Mirrors scripts/scan.mjs: survey -> 10 deep scanners -> enrich -> validate -> writeNORMS.`
**expl** Three files hand-roll the same 10-dimension sequence with comments claiming to mirror scan.mjs — which now calls runExpandedPipeline (17 dims, retry, plugins, privacy gate). The mirror no longer mirrors anything; wiring regressions in the real pipeline are invisible to these "golden" tests (T228 expansion tests do drive the real pipeline, bounding blast radius).
**impact** Misleading coverage labels; triple duplication of drift-prone orchestration.
**remediation** Re-point runPipeline at runExpandedPipeline (projecting legacy assertions) or consume one shared exported helper.
**challenge** AGREE. **status** upheld.

### F-027 · No coverage/mutation/property-based/fuzz tooling wired into any gate
**sev** medium · **conf** high (E2) · **dim** 14 · **anchor** Fowler TestCoverage; Stryker/PIT practice
**loc** repo-wide absence (no c8/nyc/stryker/fast-check/coverage flags; package.json has no scripts)
**snippet** (finding of absence)
**expl** All 1228 tests are example-based over five micro-fixtures + one machine-gated repo. Coverage now measured ad hoc by this review (F-025) but wired nowhere; no mutation score substantiates the suite's implied rigor — notable because csm-scan's own Testing dimension catalogs mutation policy for scanned repos. Parsers (5-language import extraction, TOML/JSONC/INI, git-log vocab) are exactly where property/fuzz testing pays off.
**impact** Unknown residual gap size; quality claims rest on self-built gates rather than external measurement.
**remediation** Wire `--experimental-test-coverage` into one gate (after F-025 fix) with per-file thresholds; zero-dep property loop for import-graph resolvers (idempotence, no edges to nonexistent files); one-time Stryker baseline on lib/scan/shared/.
**challenge** AGREE (absence fully verified). **status** upheld.

### F-028 · Aliasing/mirror assertions compare SUT output to SUT output, or re-implement its sort key
**sev** medium · **conf** high (E2) · **dim** 13
**loc** csm-scan/test/validate.test.mjs:81-105, test/expansion-determinism.test.mjs:215-219
**snippet** `assert.equal(result.coverage[key], enriched.cohesiveness[key], ...)`
**expl** validate.test iterates keys of one SUT output asserting another SUT output equals it — co-drift invisible (validate.mjs literally copies the field). determinism.test rebuilds the production sort key (`providerId\0plugin\0category\0matchedKey\0path`) inside the test — a wrong key shared by both passes vacuously; legitimate key changes break the test without a defect.
**impact** Maintenance budget consumed by assertions weaker than they appear.
**remediation** Hand-computed expectation for one dimension; weaker invariants (byte-equality across runs — already present) instead of restating the key.
**challenge** AGREE (weak-oracle rather than no-op). **status** upheld.

### F-029 · Fixture monoculture: five tiny sha-frozen micro-repos; no adversarial variants
**sev** medium · **conf** high (E2) · **dim** 14
**loc** csm-scan/test/fixtures/{python,javascript,typescript,shell,rust}.mjs, test/baselines/expansion/test-integrity.json, expansion-baseline.test.mjs:136-150
**snippet** `assert.equal(digest(await readFile(...)), sha256, '... integrity changed');`
**expl** Whole hermetic suite draws from 5 curated fixtures (~dozen files each), sha256-pinned so evolution requires deliberate digest bumps. No empty-repo, binaries-only, CRLF/BOM-pipeline, unicode-name, or nested-monorepo cases in rotation (one empty-files map used once; CRLF unit-tested only at markdown-finalize layer). The only non-toy input is the machine-gated repo (F-007).
**impact** Detection rules tuned to 5 curated repos may generalize poorly; fixture refresh procedurally expensive → staleness bias.
**remediation** Add 2-3 adversarial fixtures (empty, binaries-only, CRLF/BOM); document review-then-bump policy for test-integrity.json; optional seeded "messy repo" generator.
**challenge** AGREE (minor overstatements noted). **status** upheld.

### F-030 · `--quality` silently ignored for default (stitched full-page) screenshots — incl. preset quality
**sev** medium · **conf** high (E2) · **dim** 1
**loc** csm-browse/lib/verbs/capture.mjs:69-71, :130, :188-189
**snippet** `const params = { format: 'png' };` (stitch branch)
**expl** Stitching is the default path; there tiles are always PNG and the ffmpeg vstack encode uses default quality — parsed `--quality` is dead in this branch, and `--small/--medium` preset quality (30/80) equally has no effect. SKILL.md:66 documents `--quality N` as an unconditional compression override.
**impact** Users get default-quality (larger) output with no warning; docs/behavior contract broken.
**remediation** Apply `-q:v` to the vstack encode for JPEG presets or warn when --quality combines with stitched path; fix SKILL.md either way.
**challenge** AGREE (preset-quality aggravator verified). **status** upheld.

### F-031 · evalInPage ignores `exceptionDetails` — page exceptions exit 0 with opaque output; bad selector silently degrades to full-body text
**sev** medium · **conf** high (E2) · **dim** 1/10
**loc** csm-browse/lib/cdp.mjs:92-105, csm-browse/lib/verbs/dom.mjs:14-16, :50-51
**snippet** `const { result } = await client.send('Runtime.evaluate', {...});`
**expl** CDP returns exceptionDetails when the expression throws; it is destructured away. `browse eval` on a throwing expression prints `{}` and exits 0; `browse text` with an invalid selector silently falls back (`|| document.body?.innerText`) to whole-body text, masking the error. Same pattern in html verb.
**impact** Automation scripts get success codes and misleading output for failures; selector typos silently change semantics.
**remediation** Destructure and throw on exceptionDetails; evaluate selector match separately before fallback.
**challenge** AGREE. **status** upheld.

### F-032 · status verb reports hardcoded `artifactCount: 0` — fabricated telemetry
**sev** medium · **conf** verified (E1) · **dim** 1/3
**loc** csm-browse/lib/verbs/status.mjs:42-51
**snippet** `const artifactCount = 0;`
**expl** Literal 0 emitted in status JSON as if computed; no readdir of the artifacts dir that capture.mjs populates.
**impact** Misleading telemetry for any consumer trusting status; hides artifact accumulation relevant to cleanup.
**remediation** Count artifacts dir entries (try/catch default 0) or omit the field.
**challenge** AGREE. **status** upheld.

### F-033 · Per-session CDP socat bound 0.0.0.0 inside container — reachable by any host process/default-bridge container, no auth
**sev** medium · **conf** high (E2) · **dim** 5/11 · **anchor** CWE-668
**loc** csm-browse/scripts/ensure-browser.mjs:135-139, :212-216, csm-browse/lib/ports.mjs:7-8
**snippet** `TCP-LISTEN:${pub},fork,reuseaddr,bind=0.0.0.0`
**expl** Session ports (9224-9234) exposed via socat on the container bridge without auth; CDP has no TLS/auth. Not docker-published, so scope = host processes + same-bridge containers (other stacks sit on isolated custom bridges). Currently no listener active. Compounds F-001.
**impact** Session hijack/cookie theft by any local process or default-bridge container.
**remediation** Bind narrower or add auth; prefer `--remote-debugging-pipe` + host unix socket 0600.
**challenge** DOWNGRADE high→medium (reachability scope verified). **status** upheld at medium.

### F-034 · Port lock: legitimate concurrent creators fail (LOCK_WAIT 10s < 30s hold); residual stale-break TOCTOU
**sev** medium · **conf** high (E2) · **dim** 8 · **anchor** CWE-367
**loc** csm-browse/lib/ports.mjs:14-29, :31-48, csm-browse/scripts/ensure-browser.mjs:187-239, csm-browse/lib/constants.mjs:30
**snippet** `try { process.kill(pid, 0); } catch { holderAlive = false; } ... if (!holderAlive) { try { await unlink(LOCK_FILE); } catch {} }`
**expl** The bb54746 fix holds the lock across allocate→bind (closing plain check-to-bind TOCTOU), but createSession holds it through the 30s CDP wait while LOCK_WAIT_MS=10000 — every contended creation deterministically errors. breakStaleLock re-reads contents and checks PID liveness (guarding live holders), but a ms-scale three-way interleaving can still unlink a fresh holder's lock; PID recycling applies; sweep/adopt mutate port state lock-free.
**impact** Concurrent session creation fails outright; rare duplicate port-pair allocation → cross-session CDP traffic.
**remediation** Hold lock only across allocation+bind (not CDP readiness); raise LOCK_WAIT above max hold; content-matching unlink (pid+boot token); route sweep/adopt through the lock.
**challenge** DOWNGRADE high→medium (guard exists; timing bug is the solid part). **status** upheld at medium.

### F-035 · state.json: unlocked read-modify-write, non-atomic writeFile
**sev** medium · **conf** medium (E2) · **dim** 8 · **anchor** CWE-362
**loc** csm-browse/lib/session.mjs:24-37, csm-browse/scripts/ensure-browser.mjs:343-362, :389-392, :411-414
**snippet** `await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');`
**expl** Plain in-place writeFile (no tmp+rename — the queue code knows the pattern); load-modify-save cycles unserialized. Concurrent same-sid invocations: both create sessions (different port pairs), last save wins, loser leaks chromium/socat until sweep; a reader can hit a partial flush and fail JSON.parse.
**impact** Lost daemonPid updates, duplicate browser instances, transient CLI failures under concurrency.
**remediation** tmp+rename atomic write; per-sid lock for lifecycle mutations.
**challenge** AGREE. **status** upheld.

### F-036 · daemon.pid single-instance check is check-then-act; duplicate daemons diverge on recorder state
**sev** medium · **conf** medium (E2) · **dim** 8 · **anchor** CWE-367
**loc** csm-browse/scripts/session-daemon.mjs:24-43, :79, csm-browse/lib/recorder.mjs:18, :248-253
**snippet** pidFile written only at line 79, after CDP connect/tab attach
**expl** Multi-second window between liveness check and pidFile write; two spawns both proceed. activeRecording is per-process: screencast-stop claimed by daemon B throws 'not recording' while A's ffmpeg runs; stopDaemon kills only the pid-file winner. launchDaemon's retry (~2s liveness poll before rm of markers) actively widens the window.
**impact** Orphan daemons, stuck recorder.json, spurious errors while recording.
**remediation** Claim slot with atomic open(pidFile,'wx') before connecting; write pid immediately; remove on failure.
**challenge** AGREE. **status** upheld.

### F-037 · prepareQueueDirs rm -rf wipes cmd/ and out/ at every daemon start — commands enqueued while daemon down are unconditionally destroyed
**sev** medium · **conf** high (E2) · **dim** 1/8
**loc** csm-browse/lib/daemon-core.mjs:36-44, :52, csm-browse/scripts/session-daemon.mjs:78, csm-browse/lib/verbs/record.mjs:49-50
**snippet** `try { await rm(cmdDir, { recursive: true, force: true }); } catch {}`
**expl** Double wipe per boot (session-daemon:78 and startQueueLoop). Deterministic variant worse than the race: any command enqueued while the daemon is down is destroyed at next start, along with unconsumed results; the verb then polls out/ for 30s and reports "Daemon unavailable".
**impact** Dropped screencast commands + 30s hangs exactly around daemon churn (when users retry).
**remediation** Claim-by-rename-only protocol tolerating stale entries; age-based cleanup of running/ leftovers; never wipe unconsumed out/.
**challenge** AGREE (deterministic variant emphasized). **status** upheld.

### F-038 · Command queue ordering keyed by random UUID filenames — concurrent commands execute in arbitrary order
**sev** medium · **conf** high (E2) · **dim** 8 · **anchor** CWE-362/667
**loc** csm-browse/lib/daemon-core.mjs:56-60, csm-browse/lib/verbs/record.mjs:18-19
**snippet** `.filter(e => UUID_RE.test(e.slice(0, -5))).sort()`
**expl** Commands are `<randomUUID>.json`; the poll loop sorts by filename. Two CLI invocations within one 500ms poll window execute in UUID-lexicographic order — effectively a coin flip. The `ts` field exists in payloads but is never used for ordering. screencast-start + immediate stop (or future queued verbs) can invert.
**impact** Non-deterministic command reordering; recordings missing intended navigation; flaky debugging.
**remediation** Sort by parsed cmd.ts (ISO sorts lexicographically) with UUID tiebreaker, or ts-prefixed filenames; document the guarantee.
**challenge** AGREE. **status** upheld.

### F-039 · startRecorder: recorder.json write after Page.startScreencast unguarded — failure orphans ffmpeg + screencast permanently
**sev** medium · **conf** high (E2) · **dim** 9/10
**loc** csm-browse/lib/recorder.mjs:217-226, :193-215, :247-253
**snippet** `await writeFile(recorderJsonPath, JSON.stringify(recorderState), 'utf-8');` (line 224, before activeRecording assignment)
**expl** ffmpeg spawned, handler attached, screencast enabled — then an unguarded writeFile. If it throws (ENOSPC/EACCES), activeRecording stays null; every future stop (incl. SIGTERM cleanup) throws 'not recording'; screencast + ffmpeg run for the session's life.
**impact** Unrecoverable orphaned processes; lost artifact; leaked CPU/memory.
**remediation** Write recorder.json before startScreencast, or try/catch mirroring the existing failure path (kill ffmpeg, detach, rethrow).
**challenge** AGREE. **status** upheld.

### F-040 · Reuse path never relaunches the daemon when state.daemonPid is null — one failed launch makes the session daemonless forever
**sev** medium · **conf** high (E2) · **dim** 10
**loc** csm-browse/scripts/ensure-browser.mjs:349-368, :390-394, :412-414
**snippet** `console.log('CDP reachable — reusing existing session'); ... return;` (else-branch, no launchDaemon)
**expl** launchDaemon failure persists `daemonPid: null` (saved only `if (daemonPid)`); the reuse branch restarts the daemon only inside `if (existingState.daemonPid)`. One transient failure (OOM, timeout) → every later run returns immediately; all queue verbs time out for the session's lifetime.
**impact** Degraded-forever state with no self-healing; users see repeated 30s timeouts.
**remediation** Treat !daemonPid same as dead pid: call launchDaemon, persist on success.
**challenge** AGREE. **status** upheld.

### F-041 · No timeout on docker pull/run; "already running" reuse path skips CDP readiness check
**sev** medium · **conf** medium (E2) · **dim** 10
**loc** csm-browse/lib/docker.mjs:110-119, csm-browse/scripts/ensure-browser.mjs:71-74, :98-113
**snippet** `if (running) { console.log('Container ... already running (reusing)'); return; }`
**expl** Stalled registry/wedged dockerd hangs ensure-browser indefinitely. A degraded container is re-adopted blind (no readiness probe on the reuse path); subsequent attempts cost ~30s each (bounded — challenger verified every other path re-checks CDP), so fail-slow rather than infinite. No OOMKilled detection or recycle decision.
**impact** Unbounded hangs on network stalls; degraded container → endless ~30s failure loop.
**remediation** Bounded timeout + one retry on pull/run; probe /json/version on reuse and restart/recreate on failure; surface OOMKilled.
**challenge** AGREE (bounded-loop mitigation noted). **status** upheld.

### F-042 · curlRetry per-attempt `curl` has no --max-time — documented retry budgets unenforced
**sev** medium · **conf** high (E2) · **dim** 10
**loc** csm-browse/scripts/ensure-browser.mjs:49-51 (and execFileAsync pattern repo-wide in the skill)
**snippet** `execFileAsync('curl', ['-s', url])`
**expl** Every retry budget (curlRetry 5s/30s, CDP_RETRY_TIMEOUT_MS) assumes each curl fails fast; a blackholed connection (stale container IP, firewall DROP on pool ports — the exact scenarios retries exist for) hangs a single attempt indefinitely, freezing ensure-browser with no timeout and no error.
**impact** Documented timeouts in constants.mjs are fiction under packet-drop conditions.
**remediation** `-m 2` per attempt or `timeout` execFile option; audit other execFileAsync calls.
**challenge** NEW (challenger). **status** upheld.

### F-043 · check-skill.mjs validates 1 of 2 runtime deps; no node --check syntax pass
**sev** medium · **conf** verified (E1) · **dim** 14
**loc** csm-browse/scripts/check-skill.mjs:24-60, :75-82
**snippet** `require.resolve('chrome-remote-interface');` (only)
**expl** jimp (screenshot stitching) never resolved — partial install passes while screenshot crashes. No syntax sweep of lib/scripts/tests .mjs; no tests/fixtures existence check. As the only Docker-free gate for ~3,900 lines, it inspects none of that code.
**impact** Partial installs and syntax-level breakage ship green through the offline gate.
**remediation** Resolve every package.json dep; `node --check` each .mjs; verify referenced fixtures exist.
**challenge** AGREE. **status** upheld.

### F-044 · serve.mjs fixture server: path traversal via join(req.url) + binds 0.0.0.0
**sev** medium · **conf** verified (E1) · **dim** 11/13 · **anchor** CWE-22
**loc** csm-browse/tests/serve.mjs:22-25, :36-39
**snippet** `const abs = join(FIXTURES_DIR, filePath);` / `server.listen(8090, '0.0.0.0', ...)`
**expl** Raw request target (Node performs no normalization) → join normalizes `..` → arbitrary host file read, exposed on all interfaces during e2e runs. Hardcoded port + `fuser -k` mitigation kills unrelated processes.
**impact** Test runs can serve host files to the LAN; port collisions → flaky failures on shared machines.
**remediation** Reject `..`/resolve-then-prefix-check; listen on ephemeral port (report via READY handshake) bound to loopback or bridge IP only.
**challenge** AGREE (context: throwaway fixture server, keeps medium). **status** upheld.

### F-045 · e2e tautological always-true assertion in daemon-restart step
**sev** medium · **conf** verified (E1) · **dim** 13 · **anchor** testsmells: assertion-free test
**loc** csm-browse/tests/e2e.mjs:459-469
**snippet** `assert(step + ' - daemon killed', true);`
**expl** The computed `dead` flag is discarded; the assertion can never fail. If SIGTERM and SIGKILL both fail, the step still PASSes, voiding the restart-preservation test's premise. Only such assertion in the file.
**impact** One of the suite's most valuable resilience checks can false-green its core precondition.
**remediation** Assert dead === true; poll kill(pid,0) until throw with timeout after SIGKILL fallback.
**challenge** AGREE. **status** upheld.

### F-046 · Per-skill check registries are manual with no completeness assertion — new skills silently get zero structural checks
**sev** medium · **conf** high (E2) · **dim** 4/13
**loc** scripts/check-suite.mjs:17-81, :123-134, :165-185
**snippet** `const required = REQUIRED_SECTIONS[skill]; if (required) {`
**expl** REQUIRED_SECTIONS/STATE_LINES/TMUX_SKILLS/NORMS_SKILLS are hand-keyed; discovery is automatic but nothing asserts coverage — a new csm-foo gets only generic checks; dead keys linger after renames. Coverage decays exactly when new unreviewed content lands.
**impact** The gate's central claim (comprehensive conformance) is best-effort and silently shrinking.
**remediation** Assert every discovered skill has a REQUIRED_SECTIONS entry (and explicit tmux/state decisions); reverse-check for dead keys; or derive from a declarative per-skill manifest.
**challenge** AGREE. **status** upheld.

### F-047 · Hand-rolled frontmatter parser: quoted YAML and multi-line descriptions false-fail; duplicate keys pass
**sev** medium · **conf** high (E2) · **dim** 1/13
**loc** scripts/check-suite.mjs:112-121, :152-160
**snippet** `const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (pair) kv[pair[1]] = pair[2];`
**expl** Challenger ran the verbatim parser: `name: "csm-plan"` parses with quotes → NAME_RE false-failure on valid YAML; folded descriptions silently truncated (can false-pass length, false-fail never-clause); duplicates last-win. Never-X check is `/never/i` anywhere — "nevertheless" satisfies.
**impact** Legal YAML edits break the gate spuriously; malformed frontmatter passes.
**remediation** Real YAML parsing (or minimal quote/block handling + duplicate rejection); clause-shaped Never-X pattern.
**challenge** AGREE (parser experiment run). **status** upheld.

### F-048 · Numeric self-claims (9 states, 18 dimensions) machine-checkable but unverified
**sev** medium · **conf** high (E2) · **dim** 12/14
**loc** csm-review/SKILL.md:314-319, :206-227, :61, :117; csm-plan/SKILL.md:123; csm-bdd-ttd/SKILL.md:90
**snippet** `- All 9 states have entry and exit.` / `- 18 dimensions with anchors.`
**expl** Skills assert countable invariants about themselves; currently true (challenger spot-checked: 9 numbered state sections with Entry/Exit; 18 table rows; groupings sum to 18), nothing enforces them. Counts drive finder allocation at runtime — drift has behavioral effect. Clearest class of "meaningful test for prompt-only skills".
**impact** Silently self-contradictory skill docs — the drift the suite exists to prevent.
**remediation** Extract backticked state chains; assert each state has a `^### \d+\.` heading in chain order with consecutive numbering; Entry/Exit lines per state; dimension-row count = claim; snapshot extracted machines as golden data.
**challenge** AGREE. **status** upheld.

### F-049 · Zero automation: nothing runs the 1210 tests or 156-check gate on commit/push
**sev** medium · **conf** verified (E1) · **dim** 18
**loc** repo-wide absence (.github/, hooks, core.hooksPath unset, .git/hooks samples only), README.md:137-158
**snippet** (absence verified; README documents manual invocation only)
**expl** No CI of any kind; no git hooks; csm-browse/package.json has no scripts field (npm test unwired). Commit history celebrates manual "FINAL-SUITE-GATE-PASS" runs; check-count drift (154→156) between a commit message and today already shows manual bookkeeping slipping. Any commit can silently regress suite/linter/README integrity.
**impact** Entire quality narrative rests on developer discipline.
**remediation** Minimal GitHub Actions (push/PR): check-suite + csm-scan suite (+ csm-browse unit layer once F-012 lands); optional pre-push hook for the fast linter; wire npm scripts.
**challenge** DOWNGRADE high→medium (single-maintainer personal repo proportionality). **status** upheld at medium.

### F-050 · Runtime pulls mutable `jlesage/chromium:latest` — no digest pin on the credential-entry browser
**sev** medium · **conf** medium (E3) · **dim** 15 · **anchor** CWE-494
**loc** csm-browse/lib/constants.mjs:6-7, csm-browse/scripts/ensure-browser.mjs:92-97, csm-browse/lib/docker.mjs:110-118
**snippet** `export const IMAGE = 'jlesage/chromium:latest';`
**expl** Plain `docker pull` of a mutable tag; no digest, no recorded expected hash; pullImage checks exit code only. This Chromium handles typed passwords (SKILL.md:84-87) and runs --no-sandbox. Realism cuts both ways: fetched only when absent (no ongoing repoint exposure, but also no patch refresh); widely-used actively-maintained image.
**impact** First-setup tag repoint/registry compromise delivers arbitrary code into the credential browser, zero detection; no reproducibility across machines.
**remediation** Pin to digest or dated tag; record expected digest; verify post-pull via RepoDigests; refresh on the same cadence as dependency updates.
**challenge** DOWNGRADE high→medium. **status** upheld at medium.

### F-051 · Node 20 is past EOL (2026-04-30); floor-only `engines >=20` blesses it — host runs v20.20.2 today
**sev** medium · **conf** verified (E1) · **dim** 16 · **anchor** CWE-1104
**loc** csm-browse/package.json:10-12, README.md:57
**snippet** `"engines": { "node": ">=20" }`
**expl** endoflife.date: Node 20 EOL 2026-04-30 (~3.5 months ago); host executes it; npm treats engines as warning. No ceiling, no .nvmrc, no CI to catch drift. README propagates the bare floor to consumers.
**impact** Security/bug fixes stopped flowing to the actual runtime; range provides no currency signal.
**remediation** Move to maintained LTS (22/24), pin `engines` window + .node-version; audit job checks declared floor against endoflife.date.
**challenge** AGREE ("finding understates: host is on EOL today"). **status** upheld.

### F-052 · upload.mjs: unescaped interpolation into public Pages index.html (stored XSS ceiling: self/agent-XSS)
**sev** medium · **conf** high (E2) · **dim** 5/11 · **anchor** CWE-79
**loc** csm-upload/scripts/upload.mjs:156-171 (esp. :161 description, :165-171 filenames)
**snippet** `html += `<h2>${f.name}</h2>\n<img src="${f.name}" ...>`;`
**expl** No escapeHtml anywhere in the file; `--desc` and file basenames land verbatim in a public page (challenger verified a `<script>` tag in a filename breaks through). Mitigations verified: demoDir pre-sanitized to [a-z0-9._-] (title/h1 sinks safe); all subprocess calls are execFile arrays (no shell injection); inputs ordinarily come from the repo owner or their agent → realistic ceiling is self-XSS on a low-value origin, with a convoluted path via LLM agent composing hostile web content into --desc.
**impact** Stored HTML/JS injection on the public demo site; broken pages for special-char filenames.
**remediation** escapeHtml() on description and filenames at all interpolation points; reject filenames outside [A-Za-z0-9._-] before copy.
**challenge** DOWNGRADE high→medium. **status** upheld at medium.

### F-053 · upload.mjs robustness: no subprocess timeouts, stderr diagnostics dropped, first-match gh account parse persisted sticky
**sev** medium · **conf** verified (E1) · **dim** 1/10/17
**loc** csm-upload/scripts/upload.mjs:47-53, :75, :121-130, :196-198
**snippet** `await execFileAsync('git', ['-C', pagesDir, 'push']);` / `console.error(err.message);`
**expl** No timeout/maxBuffer on any exec (dead network or credential prompt hangs forever); top-level catch drops err.stderr where git/gh diagnostics live; `/account\s+(\S+)/` takes the first listed account (multi-account mis-detect) and persists it to a config file, making a wrong detection sticky (--github flag caps impact). SIGINT/SIGTERM bypasses the finally → temp clone of the pages repo lingers in /tmp.
**impact** Hangs without diagnostics on the most common failures; wrong-account stickiness; /tmp litter after Ctrl+C.
**remediation** `{timeout}` on execs + one bounded push retry; print err.stderr; prefer `gh api user --jq .login`; signal handler removing pagesDir.
**challenge** AGREE. **status** upheld.

### F-054 · scan CLI error path emits raw absolute paths on stderr contradicting USAGE text
**sev** low · **conf** high (E2) · **dim** 18
**loc** csm-scan/scripts/scan.mjs:27-28, :130-134, :151-156
**snippet** `const rawStderrWrite = process.stderr.write.bind(process.stderr);`
**expl** Bypass is real but deliberate (commit bb54746 "CLI-arg exemption": redacting the user's own typed path to [redacted] was a UX bug; T227 now asserts the echo). The user's own input on their own terminal. Residual defect is stale USAGE/SKILL wording claiming stderr redaction without the carve-out.
**remediation** Docs fix: narrow the claim to pipeline output, or add the CLI-arg carve-out sentence.
**challenge** DOWNGRADE high→low (deliberate policy; docs bug). **status** upheld at low.

### F-055 · Post-cutover legacy pipeline entry point test-only; ~50 lines true duplication
**sev** low · **conf** medium (E3) · **dim** 2
**loc** csm-scan/lib/scan/pipeline/run.mjs:183-239, csm-scan/lib/scan/render/existing-ten.mjs:104-124 vs render/registry.mjs:672-691, deep/api/scanner.mjs:32-76 vs deep/data/scanner.mjs:32-108
**snippet** (runExistingTenPipeline; verbatim render() clone; 3 shared scanner helpers + READ_LIMITS clone)
**expl** Challenger disproved the headline half: the 17-dim registry IS production (run.mjs:966→1061) and existing-ten renderer is write.mjs's default param — neither is test-only. What survives: runExistingTenPipeline has zero production callers (tests deliberately use it as legacy-hash harness), one verbatim ~19-line render() clone, and 3 duplicated scanner helpers (~30 lines, not ~70).
**remediation** Retire or explicitly re-label the legacy harness; extract shared render/scanner helpers.
**challenge** DOWNGRADE medium→low (headline half-disproven). **status** upheld at low.

### F-056 · Dead code in data extractor: never-populated pendingIndexKeys; computed-then-discarded sequelize alias
**sev** low · **conf** high (E2) · **dim** 3
**loc** csm-scan/lib/scan/deep/data/extractor.mjs:305, :506-516, :642-643
**snippet** `const pendingIndexKeys = [];` (zero pushes; flush loop unreachable)
**remediation** Delete both; pick one alias convention for sequelize migrations.
**challenge** AGREE (gap-filler verified). **status** upheld.

### F-057 · Privacy-gate canary blind spots exactly match the two reproduced leak channels
**sev** low · **conf** high (E2) · **dim** 6/13
**loc** csm-scan/test/expansion-privacy-gate.test.mjs (fixture package.json is `{name,type}`; root-path exclusion comment at :18-20)
**expl** T227 fixture has no scripts/description canaries (F-004's channel unexercised) and excludes the fixture root (F-019's channel by design). Both demonstrated leaks survive the suite precisely because the canary set does not cover them.
**remediation** Plant a canary inside a script value and description; add root/gitRoot to canary list once rendering decision (F-019) is made.
**challenge** NEW (challenger B). **status** upheld.

### F-058 · Single-size 92s sequential suite; parallel-mode races self-acknowledged; rg/git deps unprobed
**sev** low · **conf** high (E2) · **dim** 14 · **anchor** Google Test Sizes; flaky-tests
**loc** csm-scan/SKILL.md:205,217, test/harness.mjs:6-33
**snippet** `node --test --test-concurrency=1 is authoritative because default parallel mode can race filesystem-heavy fixture tests.`
**expl** No size segregation: pure-function unit tests and full-pipeline/subprocess e2e share one sequential run (same 92s latency for a one-line parser fix as for the whole pipeline). Docs concede fixtures race under default flags (latent flakiness for anyone running plain `node --test`). Hard dependency on rg/git with no capability probe (env breakage → mass failures, no diagnostic).
**remediation** Split S-size parallel-safe from L-size sequential invocations; per-test tmp roots; upfront capability check failing once with a clear message.
**challenge** AGREE. **status** upheld.

### F-059 · Daemon queue strands unparseable cmd files in running/ forever; client hangs 30s
**sev** low · **conf** high (E2) · **dim** 1
**loc** csm-browse/lib/daemon-core.mjs:67-79
**snippet** `try { cmd = JSON.parse(raw); } catch { continue; }`
**expl** Mechanics real (no out-file, no removal, 30s misleading timeout), but the only CLI-side writer emits valid JSON atomically (tmp+rename) and .tmp files are filtered — realistic trigger is a daemon crash between rename and out-write, which F-037's restart wipe subsumes.
**remediation** On parse failure: write error result + unlink; distinguish "no daemon" from "command rejected".
**challenge** DOWNGRADE medium→low. **status** upheld at low.

### F-060 · Fixed world-shared /tmp/csm-browse state root; daemon trusts on-disk state (profileDir → container rm -rf)
**sev** low · **conf** medium (E2) · **dim** 11 · **anchor** CWE-377, CWE-59, CWE-20
**loc** csm-browse/lib/constants.mjs:4, csm-browse/lib/session.mjs:32-37, csm-browse/lib/daemon-core.mjs:56-79, csm-browse/lib/verbs/close.mjs:30-31, csm-browse/lib/cleanup.mjs:52-54
**snippet** `export const SESSIONS_ROOT = '/tmp/csm-browse';`
**expl** Predictable /tmp path; daemon executes cmd/*.json; close.mjs passes state.profileDir into `docker exec rm -rf` with no shape validation (execFile-array, so container-local arbitrary-path delete as container root). Live permissions undercut prerequisites: /tmp/csm-browse is 0777 owned by the user — other uids get read/traverse only; poisoning requires same uid (already game over) or root. Hardening, not a live boundary on this threat model.
**remediation** XDG_RUNTIME_DIR or $HOME-based 0700 storage; validate profileDir/publicPort/wsUrl shapes before use; non-root `-u` for destructive execs.
**challenge** DOWNGRADE medium→low. **status** upheld at low.

### F-061 · Network/console telemetry persisted unredacted, group/world-readable
**sev** low · **conf** high (E2) · **dim** 7 · **anchor** CWE-532
**loc** csm-browse/lib/collectors.mjs:33, :48-58, csm-browse/lib/session.mjs:34-36, csm-browse/scripts/session-daemon.mjs:45-48
**snippet** `await appendFile(mainPath, JSON.stringify(entry) + '\n');` (url: params.request.url)
**expl** Full request URLs (query-string tokens), console args, and stack traces persist to events.jsonl/daemon.log/out/*.json with default modes (0775/0664 under umask 002) inside the F-060 tree. Single-user box and no data at rest today cap it, but unredacted-URL hygiene on a public-IP host with plausible future multi-service setup keeps it live.
**remediation** 0700 dirs / 0600 files; strip/redact token-shaped query params before writing.
**challenge** DOWNGRADE medium→low-med. **status** upheld at low.

### F-062 · `log cookies` prints all cookies incl. HttpOnly session tokens to stdout, no redaction
**sev** low · **conf** verified (E1) · **dim** 7 · **anchor** CWE-200, CWE-532
**loc** csm-browse/lib/verbs/log.mjs:186-190
**snippet** `process.stdout.write(JSON.stringify(result.cookies, null, 2) + '\n');`
**expl** Verb's stated purpose (operator's own cookies), but stdout lands in agent transcripts/scrollback with long retention — the skill is designed to be agent-driven. No --values flag, no masking.
**remediation** Default to name/domain/flags-only with explicit --values opt-in, or mask values.
**challenge** DOWNGRADE medium→low-med. **status** upheld at low.

### F-063 · Screenshot output filename unvalidated → path traversal outside artifacts dir
**sev** low · **conf** high (E2) · **dim** 11 · **anchor** CWE-22
**loc** csm-browse/lib/verbs/capture.mjs:73-79, :123, :192-193 (contrast lib/recorder.mjs:16-24 VALID_NAME_RE)
**snippet** `const outPath = join(artifactsDir, outName);`
**expl** Positional name joined without the validation recorder.mjs applies to video names; `../../evil.png` escapes (nothing downstream normalizes); writeFile follows symlinks. Actor is typically the operator (or a prompt-injected agent) writing image bytes — matches modest rating.
**remediation** Reuse recorder-style validation + resolved-path containment check.
**challenge** AGREE. **status** upheld at low.

### F-064 · Chromium runs `--no-sandbox` on the credential-entry browser
**sev** low · **conf** high (E2) · **dim** 5 · **anchor** CWE-693
**loc** csm-browse/lib/constants.mjs:37, csm-browse/scripts/ensure-browser.mjs:196-197
**snippet** `'--no-sandbox',`
**expl** Renderer sandbox disabled for a browser that visits arbitrary pages and types passwords. Mitigations verified: unprivileged container, default seccomp, uid 1000, no mounts; near-mandatory practice for Chromium-in-Docker. Mainly an amplifier to F-001 (internet-reachable CDP → exploit page → unsandboxed renderer RCE, still container-confined).
**remediation** Enable sandbox if the image/kernel allow; else document the trade-off + compensate (read-only rootfs, dropped caps).
**challenge** AGREE (merged duplicate finder + challenger-new). **status** upheld at low.

### F-065 · dismissCookies leaks a Runtime.executionContextCreated listener if any intermediate CDP call throws
**sev** low · **conf** medium (E3) · **dim** 9
**loc** csm-browse/lib/cookies.mjs:77-114
**snippet** `client.off('Runtime.executionContextCreated', onCtx);` (inside try whose catch swallows)
**expl** off() at :113 is inside the same try; a rejection at getFrameTree/evaluate skips it. Runs on every screenshot/screencast-start against the daemon's single long-lived client → slow closure accumulation on a hours-scale daemon.
**remediation** try { ... } finally { client.off(...) }.
**challenge** Primary-led (independence caveat — not independently challenged). **status** upheld at low.

### F-066 · csm-browse dead-code cluster: no-op ports.release(), producer-less goto handler, unreachable already_recording branch, ineffective recorder guard, duplicated PORT_POOL constants
**sev** low · **conf** high (E2) · **dim** 2/3
**loc** csm-browse/lib/ports.mjs:76-78, lib/constants.mjs:9-10 vs ports.mjs:7-8, lib/daemon-core.mjs:83-89, lib/verbs/record.mjs:82-85, lib/recorder.mjs:58-69
**snippet** `export async function release(state) { /* T007 handles full cleanup */ }`
**expl** All five sub-claims challenger-verified: release() has zero callers; 'goto' string appears nowhere else (nav bypasses queue); daemon emits `{ok:false,error:'already recording'}` never `result.already_recording`; the recorder double-guard is unreachable; PORT_POOL_START/END redeclared locally instead of imported (live drift risk sweep.mjs imports from constants).
**remediation** Delete dead paths; import port constants; honor or remove the fps chain.
**challenge** AGREE (severity medium-vs-low arguable → low as pure maintainability). **status** upheld at low.

### F-067 · countH1 fence tracker not fence-length aware — csm-grill's 4-backtick template desyncs it (correct today by luck)
**sev** low · **conf** high (E2) · **dim** 13
**loc** scripts/check-suite.mjs:99-110, csm-grill/SKILL.md:149, :175-183, :201
**snippet** `if (/^```/.test(line.trimStart())) { inFence = !inFence;`
**expl** Toggle is blind to backtick-run length; csm-grill's ````markdown fence containing ```text/```mermaid nests desync the tracker across lines 175-201. Challenger ran the verbatim function on the real file: returns exactly 1 (correct) — no stray H1 falls in a mis-tracked window today. Latent miscount risk for any deeper check built on this parser (F-015's fix depends on it).
**remediation** Track opening fence length; close only on equal-or-longer runs; regression fixture with decoy H1 in nested fence.
**challenge** DOWNGRADE medium→low (live failure disproven; latent). **status** upheld at low.

### F-068 · BDD task block omits `Spike candidate` while claiming template extension — cosmetic wording drift
**sev** low · **conf** high (E2) · **dim** 13
**loc** csm-bdd-tdd/SKILL.md:186, :193-211, :230 vs csm-plan/SKILL.md:255-269
**snippet** `3. Task block format (all csm-build fields preserved):`
**expl** Field diff real (13 base fields; BDD drops Spike candidate, adds Scenario + Unit test designs). But csm-build's only spike mention is an optional execution-time consideration — nothing requires the field for BDD plans, so "all csm-build fields preserved" is literally true; the imprecision is "extending the base template" (not a strict superset).
**remediation** Fix the wording or restore the field with an explicit allowlist note; add the field-list diff test from F-017's pattern.
**challenge** DOWNGRADE medium→low (no functional consumer). **status** upheld at low.

### F-069 · csm-grill internal inconsistency: `.agents/` vs `.agents/approaches/` save path
**sev** low · **conf** high (E2) · **dim** 18
**loc** csm-grill/SKILL.md:71 vs :125, :3
**snippet** `| save the agreed approach to a single dated document in `.agents/` | SAVED |`
**remediation** One-word fix in the mapping table; add the single-fact canonicality lint (every `.agents/...` mention collapses to one canonical regex).
**challenge** AGREE. **status** upheld at low.

### F-070 · README layout tree drift: `.agents/` comment wrong; top-level `scripts/` omitted
**sev** low · **conf** high (E2) · **dim** 18
**loc** README.md:117-135 (esp. :134), vs .agents/ reality (plans/ docs/ reviews/)
**snippet** `└── .agents/           # plans/ and approaches/ saved by the skills`
**expl** Comment lists a nonexistent approaches/ while docs/ and reviews/ go unmentioned; tree omits scripts/ containing the gate README tells readers to run nine lines later. Linter's README check can't see tree lines. Doc-cosmetic.
**remediation** Update tree to reality + scripts/; extend check to verify tree entries correspond to real paths.
**challenge** DOWNGRADE medium→low. **status** upheld at low.

### F-071 · README validation skips whole lines containing any URL — path references co-located with links evade checking
**sev** low · **conf** high (E2) · **dim** 13
**loc** scripts/check-suite.mjs:195
**snippet** `if (/:\/\//.test(line) || /github\.com/.test(line)) continue;`
**remediation** Extract path tokens per-line instead of skipping the line.
**challenge** NEW (challenger). **status** upheld at low.

### F-072 · No automated dependency audit; documented install path disables npm audit
**sev** low · **conf** verified (E1) · **dim** 15
**loc** csm-browse/SKILL.md:15, README.md:78
**snippet** `npm install --no-audit --no-fund`
**expl** All 67 pins clean today (ground truth), but "clean" is a point-in-time property nothing re-checks; `--no-audit` suppresses the one free check. Caret ranges admit transitive drift via future installs.
**remediation** Weekly scheduled audit (npm audit --omit=dev or osv-scanner --lockfile) + expected-clean baseline; drop --no-audit from docs.
**challenge** DOWNGRADE medium→low. **status** upheld at low.

### F-073 · .agents/ process artifacts accumulate (9 tracked + untracked reviews/) with no index/retention policy
**sev** low · **conf** verified (E1) · **dim** 17/18
**loc** .agents/plans/ (7), .agents/docs/ (2), .agents/reviews/ (untracked), .gitignore (node_modules only)
**expl** Completed plans never pruned; no index of authoritative docs; tracking inconsistent (plans/docs committed, reviews not, .gitignore silent on it → perpetually dirty git status + accidental-commit risk). Tracked plans embed machine-specific details that rot.
**remediation** .agents/README.md index (date/status/superseded-by); retention rule; explicit decision: commit reviews/ or ignore it.
**challenge** DOWNGRADE medium→low (merged with challenger-new gitignore gap). **status** upheld at low.

### F-074 · daemon.log truncated on every restart, untimestamped, undocumented
**sev** low · **conf** verified (E1) · **dim** 17
**loc** csm-browse/scripts/session-daemon.mjs:45-48
**snippet** `createWriteStream(logPath, { flags: 'w' });`
**expl** Flags:'w' wipes the log at each daemon start — exactly when the previous run's failure evidence is needed (sessions auto-sweep and re-spawn daemons). No timestamps; no troubleshooting pointer in SKILL.md/README.
**remediation** Append or rotate on start; ISO-timestamp lines; document session-dir layout + "daemon not ready" entry.
**challenge** DOWNGRADE medium→low. **status** upheld at low.

### F-075 · scan CLI has no verbose/diagnostic mode
**sev** low · **conf** medium (E3) · **dim** 17
**loc** csm-scan/scripts/scan.mjs:39-70, :130
**remediation** Opt-in --verbose writing an unredacted-but-local trace file (never stdout) + per-stage durations.
**challenge** AGREE. **status** upheld at low.

### F-076 · No SBOM/provenance while csm-scan's own dimension 16 inventories SBOM/VEX/SARIF for other repos
**sev** info · **conf** verified (E1) · **dim** 18
**loc** csm-scan/SKILL.md:59, README.md:74
**remediation** Lockfile-derived CycloneDX SBOM on the audit cadence; one README note.
**status** upheld (primary-led; independence caveat).

### F-077 · Vestigial `topContributors` field always `[]`
**sev** info · **conf** medium (E3) · **dim** 3
**loc** csm-scan/lib/scan/deep/git.mjs
**remediation** Remove or populate.
**status** upheld (primary-led; independence caveat).

## Adjudication Log

- **Merges (7)**: F-015 ← 3 substring-check findings (infra-F1, doc-F1, doc-F4 state-lines) — same root cause, corroborators 2 finders + challenger. F-019 ← abs-path leak + privacy-gate exemption + description channel. F-007 ← hidden-skips + challenger's parse.test.mjs hard-fail. F-064 ← browse F-8 + supply-chain challenger NEW A (--no-sandbox found twice). F-073 ← .agents sprawl + gitignore-reviews gap. F-004 ← scripts-leak + description-channel overlap. F-052/F-053 kept separate (injection vs robustness).
- **Corroboration bumps**: F-015 (E3→E2, 2 independent finders); F-019 (E3→E2, finder+challenger reproduced); F-005 (E1, primary+challenger independent reproduction).
- **Downgrades (11)**: F-019 high→medium (documented T226/T224 behavior; docs contradiction). F-033 high→medium (scope). F-034 high→medium (guard exists). F-049 high→medium (proportionality). F-050 high→medium (fetch-once-only). F-052 high→medium (self-XSS ceiling). F-054 high→low (deliberate policy). F-055 medium→low (headline half-disproven). F-059 medium→low (trigger unreachable via supported flows). F-060 medium→low (live permissions undercut). F-067 medium→low (correct today). F-068 medium→low (no functional consumer). F-070 medium→low (doc-cosmetic). F-061, F-062 medium→low-med→low (single-user reality).
- **Retractions (2)**: see below.
- **Severity never averaged across merges**; challenger verdicts applied verbatim with rationale above.

## Retracted Findings

### R-01 · "createSession catch references block-scoped `pub` → ReferenceError masks real error" — RETRACTED
**disproof** (challenger, empirical): the catch at ensure-browser.mjs:231-236 belongs to the inner try lexically nested inside the outer try where `pub` is declared (line 189) — `pub` IS in scope. An exact structural replica in node confirmed the inner catch reads `pub = 9225` and cleanup executes. No TDZ path (if allocate() throws, the inner try is never entered; the outer try has only finally). Kept visible for the record.

### R-02 · "goto/navigate accepts file:/javascript:/data: schemes — security finding" — RETRACTED as security defect
**disproof** (challenger): no untrusted input reaches Page.navigate (URLs come only from the CLI caller or same-uid cmd files); the caller already holds strictly greater capability (arbitrary Runtime.evaluate). `file://` on a dev-workstation browser tool is a feature. Finder's design-intent evidence was also wrong in detail (no file:// anywhere in repo; tests serve over HTTP). Optional hardening note only (scheme allowlist for prompt-injection resilience).

## Reproducibility

- **Pinned SHA**: a650305dd395e9c1e49214e9b116b6632eabffb9 (worktree clean; all citations resolve at SHA).
- **Sandbox**: /tmp/opencode/csm-review-20260815214831-skills/ (mode 700, umask 077, file:// depth-1 clone, HOME/TMPDIR/XDG redirected, cred env scrubbed, `npm ci --ignore-scripts` exit 0).
- **Commands**: `node --test --test-concurrency=1 test/` → 1210/1210 pass, 91.7s. `node --test --test-concurrency=1 --experimental-test-coverage test/` → 947 pass/263 fail (deterministic ×2), coverage 88.85/81.28/88.73. `node scripts/check-suite.mjs` → OK, 8 skills, 156 checks. `node scripts/check-skill.mjs` (csm-browse) → PASS.
- **External queries**: OSV `/v1/querybatch` (67 pins, batched; 21 false-positive matches — see F-005), `/v1/query` per suspicious pin (all clean), `/v1/vulns/<id>` for all 21 matched advisories (authoritative ranges exclude pinned versions; ground truth: 0 genuine vulns). endoflife.date `/api/nodejs.json` (cycle 20 eol 2026-04-30).
- **Evidence artifacts**: /tmp/opencode/osv-queries.json, osv-results.json (primary-run records).
- **Subagents**: 12 finders + 6 challengers + 1 gap-filler, all explore-type, read-only; every challenge verdict recorded in the finding's **challenge** field or the Adjudication Log.
