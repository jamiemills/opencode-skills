---
format: csm-review/1
---

# Repository Review — skills @ 61445e6 (2026-08-19)

## Control

- [2026-08-19T00:00:00+0000] START -> INTAKE :: cycle 0 :: trigger: explicit csm-review request; FULL audit; posture question unanswered -> R0 per silence rule :: rungs: R0
- [2026-08-19T00:00:00+0000] INTAKE -> SCOPE :: cycle 0 :: trigger: repo pinned 61445e67c4961162c5f2b1ef8d57b4a248e7763a, worktree clean, no NORMS.md; prior review 2026-08-15 reached SAVED->STOP (no resume; re-audit post-remediation waves) :: rungs: R0
- [2026-08-19T00:05:00+0000] SCOPE -> EVIDENCE :: cycle 0 :: trigger: 7 chunks (C1-C7) defined; 13 finders assigned across 7 dimension-groups; anti-coverage drafted :: rungs: R0
- [2026-08-19T00:15:00+0000] EVIDENCE -> FIND :: cycle 0 :: trigger: evidence pack complete — OSV querybatch 0 advisories/67 pins (version-filtered); Node 20 EOL 2026-04-30 (past), Node 22 EOL 2027-04-30 (ok), current line 26; no .github CI; pre-commit hook runs check-suite + boilerplate drift + syntax + conditional browse check (manual install via install-hooks.mjs); LICENSE MIT present; host Node v20.20.2 (past EOL, environmental); 59 commits since prior review, 309 files changed; OWASP Top 10:2025 anchor reachability verified :: rungs: R0
- [2026-08-19T01:00:00+0000] FIND -> CHALLENGE :: cycle 0 :: trigger: 14 finder sessions returned ~122 raw findings (11 high / 47 medium / 64 low-info); 12 finders initially empty — resilience ladder step 1 (minimal-prompt resume) recovered all 12; redaction gate applied (locations normalized to repo-relative; no secrets/IPs/emails in snippets — PEM header retained as non-secret marker); remediation-verification pass returned 57 verdicts (52 remediated / 3 partial / 4 unresolved) :: rungs: R0
- [2026-08-19T02:10:00+0000] CHALLENGE -> ADJUDICATE :: cycle 0 :: trigger: 8 independent challengers returned — 1 RETRACT (displayPath: signature always `METHOD:path` by construction, corruption unreachable), 9 DOWNGRADE, 2 NEW findings (marker-only session dir port-pool leak; csm-review template format-marker gap); 0 dissent unmoted :: rungs: R0
- [2026-08-19T02:30:00+0000] ADJUDICATE -> VERIFY :: cycle 0 :: trigger: ledger finalized — 122 raw, dedup merged to 66 records, 1 retracted (F-066), 65 upheld (3 high / 51 medium / 11 low records; low records bundle 18 individual findings); 8 components merged across F-064/F-065; corroboration bumps: 7 records E3->high confidence (F-008, F-009, F-031, F-045, F-050, F-051, F-053) :: rungs: R0
- [2026-08-19T03:00:00+0000] VERIFY -> ADJUDICATE :: cycle 1 :: trigger: coverage-matrix gap — 28 finder lows (csm-browse quality/security/concurrency, tests-root, tests-scan, q-root, ops) absent from ledger; primary completion adds F-067/F-068/F-069 (28 components) :: rungs: R0
- [2026-08-19T03:10:00+0000] ADJUDICATE -> VERIFY :: cycle 1 :: trigger: ledger completed — 69 records (66 upheld + 1 retracted): 3 high / 51 medium / 12 low records (46 individual lows) :: rungs: R0
- [2026-08-19T03:20:00+0000] VERIFY -> SAVED :: cycle 0 :: trigger: gate checks passed — 69/69 finding records carry core fields + global commit_sha declaration; all critical/high are E2 (F-001/002/003 independently challenged, verdicts recorded); E2 records carry challenges[] (51), E3 records carry primary-led caveat or challenger-discovery note; coverage matrix filled (finding-or-clean per dimension×chunk, n/a honestly marked, references re-verified against final IDs); anti-coverage present with risk notes; redaction pass clean (no abs paths, no credentials — grep-verified; PEM header retained as non-secret marker; token-family names shown truncated); anchor editions recorded in Methodology; evidence-class/confidence consistency verified (no E3 with high confidence); VERIFY budget used 0/3 :: rungs: R0

Posture: R0 only (static read-only; OSV querybatch + endoflife.date GET used). State: VERIFY.

## How To Execute

This report fixes nothing. Remediation happens through a future explicit csm-plan or csm-grill invocation.

## Executive Summary

- **Prior-review remediation is mostly real**: 52 of 57 findings from the 2026-08-15 audit are remediated at this SHA — loopback-only CDP/VNC publishing, LICENSE added, secret-scan coverage and regex forms fixed, daemon lifecycle races closed (creating.marker, atomic state writes, CMD-timeout retries), e2e de-fanged, engines ceiling added, gitleaks allowlist compile remains the one unresolved security item from the previous list.
- **One high-severity residual from last time**: `.gitleaks.toml` allowlist patterns are still compiled with bare `new RegExp` and matched against attacker-chosen paths (csm-scan/lib/scan/deep/security.mjs:635) — a ReDoS that hangs the scanner with a catastrophic-backtracking pattern; challenger empirically reproduced a >10s hang. The codebase already has a regex-complexity policy (validatePluginRegexSource) not applied on this path.
- **The bootstrap trust story is honest but thin**: the shipped bin verifies payload hashes against a self-generated index (no cryptographic authenticity), and the Ed25519 envelope validator exists only inside test code; three independent finders converged and challengers downgraded severity to medium on the strength of documented pre-release design and npm-integrity anchoring — but the signed-envelope boundary does not yet authenticate payload bytes, and no importable validator ships.
- **Test quantity is high, test trust is shallow**: csm-scan's suite is heavily hash-locked and self-referential (SHA-256 baselines pin files to themselves; the "legacy parity oracle" re-implements the pipeline it guards), while the repo's own conformance gate (check-suite.mjs, 676 lines) has zero test coverage and is stubbed in the hook test; the protocol suite tests a test-local reference engine, not the shipped bin.
- **Concurrency and lifecycle races remain the csm-browse hot spot**: port-lock and pidfile stale-break are still check-then-act (TOCTOU), sweep can kill an in-flight adoption, PID liveness checks can signal recycled PIDs, and a crash mid-creation permanently leaks a port pair from the 11-pair pool (challenger-discovered).
- **Operability posture**: no CI exists (documented deferred decision), the conformance gate fails on in-progress untracked corpus files (observed live during this review), producer SKILL.md templates omit the `format:` markers their own corpus gate and consumers require (including csm-review's own template), and the unredacted `--verbose` trace is not gitignored.

Overall posture: a genuinely remediated, well-gated repository whose remaining material risks are (a) the untrusted-input ReDoS in the scanner, (b) unauthenticated CDP on the shared 9222 port, (c) an untested conformance gate and largely self-referential test oracle layers, and (d) a trust boundary for the bootstrap package that is documented but not yet shipped as verifiable code.

## Methodology Disclosure

- **Reviewers**: 14 parallel finder agents (one per dimension-group × chunk; non-overlapping ownership), 8 independent challenger agents (never the finders), 1 remediation-verification agent; primary agent (orchestration, redaction gate, adjudication, VERIFY).
- **Dimensions**: all 18, grouped per skill: quality (1-4), security (5-7, 9, 11), concurrency (8), resilience (10), tests (12-14), supply chain (15-16), operations (17-18).
- **Tools + versions**: node v20.20.2 (host; past EOL, disclosed), git 2.x, curl; OSV /v1/querybatch (2026-08-19, version-filtered — 0 advisories / 67 pins); endoflife.date nodejs.json (2026-08-19: Node 20 EOL 2026-04-30 past; Node 22 EOL 2027-04-30 supported; current 26). No execution rungs used (R0 only).
- **Rungs used**: R0 only (static read-only + auth-free API queries). R1-R3 offered; user did not accept (silence = R0). No sandbox, no installs, no test execution, no repo code run.
- **Containment**: no sandboxed processes were spawned; no writes to the reviewed tree other than this report file (created per INTAKE) and `.agents/reviews/` scaffold.
- **Egress disclosure**: two GET/POST API calls (endoflife.date, api.osv.dev) and challenger-finder reads only; no egress from repo code (none executed).
- **Anchor editions**: OWASP Top 10:2025 (reachability verified via owasp.org/Top10 → /2025/en/); ASVS v5.0.0, ISO/IEC 25010:2023, CWE Top 25 2025, Fowler TechnicalDebtQuadrant (2009) / Refactoring 2e (2018), SonarSource concepts, eng-practices (current), testsmells.github.io, Google flaky-tests 2016, SPDX license list — recorded as listed editions (reachability not individually spot-checked; noted in Reproducibility).
- **Residual unknowns**: (1) all findings are static-rung; nothing was executed, so E1 verification is absent for every finding; (2) Docker/CDP/VNC reachability claims (F-001, F-016, F-017, F-021, F-047) are runtime-verifiable only; (3) the prior review's runtime-verified numbers (1210 tests, 88.85% lines) were not re-measured at R0; (4) 4 prior findings (F-021/022/023/024 equivalents) confirmed still unresolved by static evidence; (5) no CI/CI-config content to audit beyond absence.

## Coverage

Dimension × chunk matrix (finding or clean):

| Dim | C1 scan-lib | C2 scan-deep | C3 scan-tests | C4 browse | C5 doc-skills | C6 root | C7 bootstrap/.agents |
|---|---|---|---|---|---|---|---|
| 1 Correctness | F-022,027,028,055 | F-022,031,055 | clean | F-004..010,067 | clean | F-052,053,057,059,061,069 | F-049,060 |
| 2 Tech debt | clean | clean | F-034,035,038,039 | F-067 | clean | F-054 (fenceMap) | F-045 |
| 3 Smells | F-029 | clean | F-036,037,039 | F-067 | clean | F-054,069 | F-064 |
| 4 Anti-patterns | F-030 | clean | clean | F-067 | clean | clean | clean |
| 5 Security impl | F-002,024 | F-002 | — | F-001,016,017,067 | — | F-045,046,048 | F-045,046,047,048 |
| 6 Security controls | F-026 (low) | F-026 (low) | — | clean (T001 gate) | — | clean | clean |
| 7 Secrets | F-025 | clean | — | F-067 (VNC argv, cookies) | — | clean | F-064 (key.pem, config mode) |
| 8 Concurrency | clean | clean | — | F-018,019,020,021,067 | n/a (doc-only) | n/a | n/a |
| 9 Memory/resource | F-022,023,062 | F-062 | — | F-017,067 | — | — | clean |
| 10 Resilience | clean | clean | — | F-009,011..015,067 | n/a | clean | clean |
| 11 Input validation | F-023 | clean | — | clean (dim 11 clean verdict) | — | F-048 (upload URL) | F-047,048 |
| 12 Test presence | — | — | F-032 | F-040 | F-063 (no behavior tests) | F-003 (gate untested) | clean |
| 13 Test quality | — | — | F-033..039,056,068 | F-068 | — | F-044,056,068 | F-044 |
| 14 Test adequacy | — | — | F-042,053 (low),068 | F-041,042,068 | — | F-003,043,068 | F-043 |
| 15 Dep vulnerabilities | — | — | — | F-057,058,059 (image) | — | F-057 (lockfile clean) | F-059 (keyring) |
| 16 Toolchain currency | — | — | — | clean (engines 22<25) | — | F-060 (host Node) | F-060 (engines floor) |
| 17 Observability | — | — | — | clean | F-051 (debug log), F-063 | F-051 | — |
| 18 CI/build/docs/license | — | — | — | — | F-050,053,061,069 | F-050,053,061,069 | F-050,053,061,069 |

Key: F-### = finding id; clean = dimension walked, nothing found; n/a = not applicable to chunk scope (doc-only/process artifacts); — = not in that chunk's finder scope (covered elsewhere).

## Anti-Coverage

- **csm-browse/node_modules/** — vendored dependencies; reviewed only via package.json pins and OSV (67 pins, 0 advisories). Risk note: transitive source not audited line-by-line; jimp's ~45 transitive packages are loaded but unused (F-058).
- **bootstrap/package/payload/**** — generated vendored mirror of the skills; reviewed via payload-index.json manifest and drift checks only (sync tooling verified by finder: 8/8 payload copies byte-sync with top-level). Risk note: drift is possible if sync tooling itself breaks; gate exists (check-suite boilerplate drift).
- **csm-scan/test/fixtures*, csm-browse/tests/fixtures, bootstrap/fixtures/** — fixture data, spot-checked, not line-audited. Risk note: fixtures contain the committed TLS key pair (F-048) and adversarial/CRLF fixtures were verified present.
- **.git internals, LICENSE, .gitignore, .node-version** — metadata read, not audited.
- **Prior review report (2026-08-15)** — used as input context for remediation verification, not re-audited as a target.
- **Time-boxed out**: deep line-by-line audit of all 217 test files and 475 files was not exhaustive; finders prioritized >100-line modules and exported entry points. Risk note: low-severity issues in small unread files may be missed.

## Findings Summary

- Raw: 122 findings from 14 finders. After dedup/merge: 69 records. Retracted: 1 (F-066). Upheld: 68.
- By severity: critical 0 | high 3 | medium 51 | low 12 (records; low records bundle 46 individual findings, medium record F-045 bundles 3, F-064 bundles 4, F-065 bundles 5, F-067 bundles 15, F-068 bundles 7, F-069 bundles 6).
- By confidence (final): verified 0 (E1) | high 50 (E2, independently challenged) | medium 18 (E3, primary-led or challenger-discovered) | low 1 (F-021).
- Independent-discovery corroborations (2+ finders, raised to high confidence): F-008, F-009, F-031, F-045 (3 finders), F-050, F-051, F-053, F-065 (NORMS component).
- New findings from challengers: 2 (F-015 port-pool leak, F-050 csm-review template marker).

## Findings

> Global: all findings cite commit `61445e67c4961162c5f2b1ef8d57b4a248e7763a`. Locations are repo-relative. Snippets verbatim, redacted. Evidence class: E3 (static citation at pinned SHA) unless noted; E2 = independently challenged (challenger agree/revise); E1 = deterministic tool result (none in this R0 run).

### F-001 · Shared container CDP 9222 unauthenticated — high

- dimension: 5 | category: missing authentication for critical function (CWE-306)
- anchor_ref: OWASP Top 10:2025 A01; ASVS v5.0.0 V2/V3
- severity: high | confidence: high | evidence_class: E2
- locations: csm-browse/scripts/ensure-browser.mjs:168, 127; csm-browse/SKILL.md:109
- quoted_snippets:
  - `'-p', '127.0.0.1:5900:5900', '-p', '127.0.0.1:9222:9222', IMAGE];`
  - `let ready = await cdpProbe('http://localhost:9222/json/version', { timeoutMs: 5000 });`
  - `**Never target port 9222** — that is the container's primary shared browser`
- explanation: The per-session CDP endpoints are protected by the host-side T001 token gate on 127.0.0.1:<publicPort>, but the container's primary browser CDP port 9222 is published to host loopback with no gate, no token, no credential. The readiness probe uses the bare URL, and because the `-p` publish works via the container bridge interface, other containers on the default bridge can reach it unauthenticated. The codebase's own threat model (lib/security.mjs) defends against other local users, so loopback-only does not close the exposure.
- impact: Any local process (or co-bridge container) can drive the shared browser over CDP: read/steal cookies and session data, navigate, execute JS, exfiltrate. The isolation claim of the per-session token gate does not extend to the documented shared browser.
- remediation_sketch: Run the same token-gated funnel on 9222 (spawn a cdp-gate for the shared port), or stop publishing 9222 and require gated tunnels only; pass `--remote-debugging-address=127.0.0.1` inside the container where supported and move the container off the default bridge.
- challenges: [challenger A2-1: AGREE — re-located; loopback binding mitigates remote but not local attackers the codebase explicitly defends against; no token applied to 9222; container `--restart unless-stopped` makes exposure persistent; high defensible, confidence medium noted as deliberate-design caveat]
- status: upheld | corroborators: [sec-browse]

### F-002 · ReDoS via repo-controlled .gitleaks.toml allowlist regex — high

- dimension: 5 | category: ReDoS / denial of service (CWE-1333)
- anchor_ref: CWE Top 25 2025 (CWE-1333); ASVS v5.0.0 V1.1.1
- severity: high | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/deep/security.mjs:635, 580, 620, 607; csm-scan/lib/scan/providers/rules.mjs:96-105 (mitigation that is bypassed)
- quoted_snippets:
  - `matchers.push(new RegExp(pattern));`
  - `const matchers = compileGitleaksPaths(paths);`
  - `if (finding.files.some((file) => matchers.some((re) => re.test(file)))) {`
- explanation: compileGitleaksPaths compiles each allowlist `paths` entry from the scanned repo's .gitleaks.toml with bare `new RegExp` — no length/structure/complexity policy — and executes it against attacker-chosen file paths. A catastrophic-backtracking pattern like `(a+)+$` hangs the single-threaded scanner; the challenger empirically confirmed >10s hang with a 60-char input. The same codebase enforces a regex-complexity policy for plugin rules (validatePluginRegexSource rejects `(a+)+b` class) that is not applied here — a known, modeled class simply not wired into this path. Secondary O(n^2) block-parser regex at security.mjs:607. Unmitigated: no scan-level timeout or worker isolation.
- impact: A malicious repository causes the review pipeline to hang for minutes or indefinitely — denial of service with no memory bound tripped; attacker controls both regex and matched input.
- remediation_sketch: Route .gitleaks.toml allowlist patterns through the same validatePluginRegexSource policy (or a shared regex-complexity validator) with length caps; match allowlist entries as literal globs instead of raw regexes; add a scan-level overall watchdog.
- challenges: [challenger B1-1: AGREE — re-located; empirically reproduced hang; GITLEAKS_PATH_LIMIT caps count not per-test cost; no mitigation exists]
- status: upheld | corroborators: [sec-scan (F-002 + F-022 prior), remediation-verifier (F-022 prior unresolved)]

### F-003 · Repo-wide conformance gate (check-suite.mjs) has zero test coverage and is stubbed in hook test — high

- dimension: 14 | category: critical-path component untested
- anchor_ref: Google Test Sizes; Fowler TestCoverage
- severity: high | confidence: high | evidence_class: E2
- locations: scripts/check-suite.mjs:1 (676 lines); scripts/hooks/test/pre-commit.test.mjs:27; scripts/hooks/pre-commit:38
- quoted_snippets:
  - `write(root, 'scripts/check-suite.mjs', "console.log('CHECK_SUITE');\n");`
  - `if (!run(node, [path.join('scripts', 'check-suite.mjs')])) failed = true;`
- explanation: pre-commit.test.mjs replaces check-suite.mjs with a stub, so only hook orchestration is tested. No test in the repo imports or invokes the real gate, which enforces frontmatter, section, state-machine chains, README integrity, corpora, interfaces, and boilerplate drift on every commit. The gate that blocks commits is itself unverified; sync-skill-boilerplate.mjs, gen-readme-matrix.mjs, and install-hooks.mjs are likewise untested.
- impact: A regression in check-suite.mjs (e.g., silently dropping a check) passes with a green commit gate, undermining the repository's primary conformance mechanism — exactly the gate that produced F-052/F-053/F-054 in this audit.
- remediation_sketch: Add a node:test suite running check-suite.mjs against fixture repos (clean + one-violation-per-rule) asserting exit codes and reported violations.
- challenges: [challenger D2-3: AGREE — grep confirms no test imports check-suite helpers; plan journal records only ad-hoc mutation probes, not committed tests]
- status: upheld

### F-004 · Rotated events read after live file — --tail returns stale events — medium

- dimension: 1 | category: output correctness/ordering
- anchor_ref: ISO/IEC 25010:2023 functional correctness
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/verbs/log.mjs:10-21, 23-37, 100-102; csm-browse/lib/collectors.mjs:8-12
- quoted_snippets:
  - `if (existsSync(mainPath)) {\n    files.push(mainPath);\n  }`
  - `.filter(e => e.startsWith('events-') && e.endsWith('.jsonl'))\n      .sort()\n      .forEach(e => files.push(join(sessionDir, e)));`
  - `if (tail !== null && tail > 0) {\n      filtered = filtered.slice(-tail);\n    }`
- explanation: collectEvents rotates the live events.jsonl to events-<ts>.jsonl, so rotated files are older than the main file. readEvents pushes mainPath first, then ascending rotated files → array is [newest block, oldest rotated, …, newest rotated]; `.slice(-tail)` therefore returns the oldest events once any rotation occurred (≥2000 events). Non-monotonic timestamps in untailed output too.
- impact: --tail (the intended "recent console/network" view) returns stale data after first rotation; wrong diagnostics for debugging page behavior.
- remediation_sketch: Push rotated files before mainPath or sort parsed events by `ts`; add a unit test with synthetic rotated+main pair.
- challenges: [challenger A1-1: AGREE — re-located; lexicographic sort confirmed; no test covers readEvents ordering]
- status: upheld | corroborators: [q-browse]

### F-005 · hasAnyEventsFile Promise truthiness — dead "no events" error path — low

- dimension: 1 | category: dead error path / async misuse
- anchor_ref: ISO/IEC 25010 functional completeness
- severity: low | confidence: high | evidence_class: E2
- locations: csm-browse/lib/verbs/log.mjs:40-48, 83-90, 112-119
- quoted_snippets:
  - `async function hasAnyEventsFile(sessionDir) {`
  - `if (events.length === 0) {\n      const exists = hasAnyEventsFile(sessionDir);\n      if (!exists) { console.error('no events file — capture not started'); process.exit(2);`
- explanation: hasAnyEventsFile is async; callers bind the Promise without await, so `exists` is always truthy and the intended exit-2 diagnostic is unreachable dead code (duplicated in subConsole and subNetwork).
- impact: A never-started capture prints `[]` and exits 0 instead of the diagnostic + exit 2; scripting cannot distinguish "no capture" from "empty capture".
- remediation_sketch: await the call (or make it sync); add a regression test asserting exit 2 on a session dir with no events files.
- challenges: [challenger A1-2: DOWNGRADE high→… — bug 100% real but observable effect minor (misleading empty result, no data loss)]
- status: downgraded (from medium) | dissents: none

### F-006 · record verb abandons a live command on client timeout — orphan recording — medium

- dimension: 1 | category: lifecycle / orphaned command
- anchor_ref: eng-practices Functionality
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/verbs/record.mjs:65-81; csm-browse/lib/daemon-core.mjs:106-174
- quoted_snippets:
  - `while (Date.now() - start < CMD_TIMEOUT_MS) {\n      try { const raw = await readFile(outPath, 'utf-8'); result = JSON.parse(raw); break; } catch { await setTimeout(200); }\n    }`
  - `if (!result) { console.error('Daemon unavailable or timed out'); process.exit(1); }`
- explanation: The verb polls for the result up to CMD_TIMEOUT_MS (30s) and exits 1 on timeout without cancelling the enqueued command. The daemon later executes it anyway (no staleness check); a slow daemon start can exceed the client budget, so a "screencast-start" executes after the client reported failure, spawning ffmpeg with recorder running:true that nothing stops.
- impact: Unattended ffmpeg recording indefinitely, disk growth, and a confusing "already recording" error for the next deliberate start.
- remediation_sketch: On timeout, best-effort unlink the cmd file if still unclaimed, or write a tombstone the daemon checks; alternatively drop commands older than CMD_TIMEOUT_MS whose out file was never awaited.
- challenges: [challenger A1-3: AGREE — reachable; no mitigation]
- status: upheld | corroborators: [q-browse]

### F-007 · stopRecorder SIGKILL fallback validates before process exit — truncated video accepted — medium

- dimension: 1 | category: resource finalization race
- anchor_ref: eng-practices Functionality
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/recorder.mjs:286-293, 310-318, 45-54
- quoted_snippets:
  - `await Promise.race([\n      new Promise(resolve => rec.ffmpeg.on('exit', resolve)),\n      setTimeout(8000).then(() => { try { rec.ffmpeg.kill('SIGKILL'); } catch {} })\n    ]);`
  - `await assertValidOutput(rec.outPath, rec.frameCount());`
- explanation: The timeout branch resolves the race at the moment kill('SIGKILL') is issued, without waiting for the exit event; assertValidOutput then runs against a dying muxer. A SIGKILL'd webm/vp9 file lacks its trailer yet passes the size>0 check; Node reports exit code null on SIGKILL, so ffmpegError stays null.
- impact: A corrupt, unplayable recording reported as success ({file, frames, duration, codec}, error: null).
- remediation_sketch: After SIGKILL, await the 'exit' event with a short hard bound before validating; probe container integrity (ffprobe duration > 0) on the kill path.
- challenges: [challenger A1-4: AGREE — re-located; no mitigation]
- status: upheld | corroborators: [q-browse]

### F-008 · Queue-loop result write unguarded — command stranded in running/ — medium

- dimension: 1 | category: error path / stuck intermediate state
- anchor_ref: ISO/IEC 25010 correctness
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2)
- locations: csm-browse/lib/daemon-core.mjs:170-176, 56-72
- quoted_snippets:
  - `const tmpOutPath = outPath + '.tmp';\n        await secureWrite(tmpOutPath, JSON.stringify(result), { encoding: 'utf-8' });\n        await rename(tmpOutPath, outPath);\n        try { await unlink(runningPath); } catch {}`
  - `} catch {\n      // readdir can fail if cmd/ doesn't exist yet, continue polling\n    }`
- explanation: The final result persistence is not wrapped: any throw from secureWrite/rename (ENOSPC, EACCES, session dir removed concurrently) propagates to the blanket catch written for a missing cmd/ dir. The command stays claimed in running/, no out file appears, the client blocks the full 30s, and the entry is only retried at next daemon startup (sweepStaleRunning).
- impact: Transient disk/permission errors convert into per-command black holes and 30s client hangs; repeated occurrences degrade every subsequent command.
- remediation_sketch: Wrap the result write; on failure move the entry back to cmd/ for one retry or write an error result and unlink running/; keep the blanket catch for readdir only.
- challenges: [challenger A1-5: AGREE — trigger is filesystem-level (rare) but the stated contract "every command gets a result" is silently broken]
- status: upheld | corroborators: [q-browse, concurrency]

### F-009 · Sweep never reaps corrupt-state or marker-only sessions — port-pool leak — medium

- dimension: 10 | category: state-management gap / resource leak
- anchor_ref: ISO/IEC 25010 recoverability
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2 + challenger new-finding)
- locations: csm-browse/lib/sweep.mjs:119-124, 206-212; csm-browse/lib/ports.mjs:80-84
- quoted_snippets:
  - `try {\n      state = validateState(JSON.parse(await readFile(join(sDir, 'state.json'), 'utf-8')), sid);\n      publicPort = state.publicPort || null;\n    } catch { continue; }`
  - `const marker = JSON.parse(await readFile(join(SESSIONS_ROOT, d, 'creating.marker'), 'utf-8'));\n      if (marker && typeof marker.internal === 'number') claimed.add(marker.internal);`
- explanation: The host-session pass skips any session whose state.json is unparseable or fails validateState, and — challenger-verified — the same catch strands sessions with NO state.json at all (crash between creating.marker write and saveState). A marker-only dir is never reaped by any pass, and claimedPortSet reads its stale marker and permanently claims the internal+public ports from the 11-pair pool (9224-9234). CREATING_MARKER_MAX_MS (90s) shows stale-marker expiry was intended but no code removes them.
- impact: Each mid-creation crash permanently loses a port pair until manual deletion; repeated crashes exhaust the pool ("No free port pair available"); orphaned chromium/container profiles persist forever.
- remediation_sketch: Distinguish read-missing from parse/validate failure; reap marker-only dirs older than CREATING_MARKER_MAX_MS; remove stale markers on claim so ports are freed.
- challenges: [challenger A1-6: AGREE (corrupt-state); challenger A1-NEW: marker-only strand + port-pool leak verified by trace]
- status: upheld | corroborators: [q-browse, resilience, challenger]

### F-010 · Empty VNC password file wedges ensure-browser permanently — medium

- dimension: 1 | category: error path / unrecoverable state
- anchor_ref: eng-practices Functionality
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/scripts/ensure-browser.mjs:99-118
- quoted_snippets:
  - `} catch (err) {\n    if (err.code === 'EEXIST') {`
  - `const existing = (await fh.readFile('utf-8')).trim();\n        if (existing) return existing;`
  - `const fh = await open(VNC_PASS_PATH, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);`
- explanation: If vnc-pass exists but is empty (crash between O_EXCL open and writeFile, or external creation), the EEXIST re-read finds no content, does not return, and control falls through to `throw err`. Every subsequent run repeats this cycle; there is no repair path — the container cannot be (re)created for any session until manual deletion.
- impact: All ensure-browser invocations fail until the user manually deletes the pass file.
- remediation_sketch: In the EEXIST re-read, if content is empty, overwrite via O_TRUNC no-follow write or delete and retry the O_EXCL create once.
- challenges: [challenger A1-7: AGREE — re-located; no recovery path]
- status: upheld | corroborators: [q-browse]

### F-011 · ensure-browser exits 0 when daemon fails to launch — medium

- dimension: 10 | category: exit codes that misreport success
- anchor_ref: ISO/IEC 25010 reliability (recoverability)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/scripts/ensure-browser.mjs:608, 570, 637, 470-471
- quoted_snippets:
  - `const daemonPid = await launchDaemon(sid);\n    state.daemonPid = daemonPid;\n    if (daemonPid) await saveState(sid, state);\n    logState(state);\n    return;`
  - `console.error(\`Daemon did not become ready after 2 attempts...\`);\n  return null;`
- explanation: All four call sites assign launchDaemon's return, save state only when truthy, then return normally; launchDaemon returns null after two failed readiness attempts. main() therefore exits 0 in adopt/respawn/create/reuse paths even though the session-driving daemon never started.
- impact: Callers gating on exit code treat the session as fully provisioned when screencast/queue functionality is down; state.json persists daemonPid:null (silent degradation).
- remediation_sketch: Return a non-zero exit code or throw a typed error when launchDaemon returns null after exhausting retries.
- challenges: [challenger A1-8: AGREE — all paths verified; exit-0 contract misleading]
- status: upheld | corroborators: [resilience]

### F-012 · Docker CLI invocations lack timeouts — indefinite hang — medium

- dimension: 10 | category: missing timeouts on subprocess waits
- anchor_ref: ISO/IEC 25010 reliability (availability)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/docker.mjs:10-39; csm-browse/scripts/ensure-browser.mjs:147, 157
- quoted_snippets:
  - `async function realContainerIP(name) {\n  const { stdout } = await realExecFile('docker', ['inspect', '-f',`
  - `await execFileAsync('docker', ['start', CONTAINER_NAME]);`
- explanation: realContainerIP, realIsContainerRunning, realContainerExists, and the ensure-browser docker start/inspect calls pass no timeout; the codebase itself uses timeouts elsewhere (pull 300s, run 60s, restart 60s). A wedged docker daemon hangs ensure-browser/sweep/close indefinitely.
- impact: A single daemon stall blocks provisioning and cleanup with no error, no partial cleanup, no way to distinguish slow from dead.
- remediation_sketch: Centralize a default docker CLI timeout (15-60s) in the exec layer and apply to every docker subprocess.
- challenges: [challenger A1-9: AGREE — inconsistent with the codebase's own timeout discipline]
- status: upheld | corroborators: [resilience]

### F-013 · close verb catch-and-continues every cleanup step, exits 0 — medium

- dimension: 10 | category: catch-and-continue losing failure signal
- anchor_ref: ISO/IEC 25010 reliability (recoverability)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/verbs/close.mjs:49, 77, 96-110
- quoted_snippets:
  - `try {\n    if (containerSessDir) {\n      await killInstance(CONTAINER_NAME, containerSessDir);\n      removed.push('chromium');\n    }\n  } catch (e) {\n    warnings.push(\`killInstance: ${e.message}\`);\n  }`
  - `console.log(JSON.stringify({\n    removed,\n    warnings,\n    container: { name: CONTAINER_NAME, state: 'running' }\n  }));`
- explanation: Every teardown step is wrapped in try/catch that pushes a warning and continues; the verb prints the JSON and exits 0 regardless of failures. A failed killInstance/removeHostSession leaves chromium, gates, and session dirs orphaned while the caller sees a success-shaped result.
- impact: Incomplete teardown masked by exit code 0; follow-up recovery (sweep) may not be triggered; disk state diverges from what the caller believes.
- remediation_sketch: Track failure distinctly from warnings and exit non-zero (or surface a removed:false/failed list) when any step fails.
- challenges: [challenger A1-10: AGREE — warnings present in JSON but exit code misleads naive callers]
- status: upheld | corroborators: [resilience]

### F-014 · Queue loop has no per-command timeout — one stuck CDP command stalls the queue — medium

- dimension: 10 | category: missing timeouts on waits
- anchor_ref: ISO/IEC 25010 reliability (availability)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/daemon-core.mjs:134-168, 179
- quoted_snippets:
  - `await recorder.startRecorder(client, sessionId, sessionDir, name, fps, preset, speed);\n                result = { ok: true, result: { started: true }, ts: new Date().toISOString() };`
  - `await setTimeout(CMD_POLL_INTERVAL_MS);`
- explanation: startQueueLoop processes commands serially with no timeout around a command's CDP send or recorder call; chrome-remote-interface requests have no default timeout, so a hung protocol send (target unresponsive) blocks the loop permanently. The ready-marker touch continues, so zombie detection never fires, and queued commands behind the stuck one never execute.
- impact: A single hung command permanently disables all subsequent queue commands for the session, with no timeout, error result, or restart signal.
- remediation_sketch: Wrap each command execution in the withTimeout primitive the daemon already uses for cleanup, writing an error result on timeout so clients unblock.
- challenges: [challenger A1-11: AGREE — disconnect handling fires only on full disconnects, not hangs]
- status: upheld | corroborators: [resilience]

### F-015 · Crash mid-creation strands marker-only session dir; port pair permanently claimed (challenger-discovered) — medium

- dimension: 10 | category: resource/port exhaustion
- anchor_ref: ISO/IEC 25010 reliability
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-browse/lib/sweep.mjs:119-124; csm-browse/lib/ports.mjs:80-84; csm-browse/scripts/ensure-browser.mjs:271-273
- quoted_snippets:
  - `} catch { continue; }`
  - `const marker = JSON.parse(await readFile(join(SESSIONS_ROOT, d, 'creating.marker'), 'utf-8'));\n      if (marker && typeof marker.internal === 'number') claimed.add(marker.internal);`
  - `await secureWrite(markerPath, JSON.stringify({ pid: process.pid, internal, public: pub, ts: new Date().toISOString() }), { encoding: 'utf-8' });`
- explanation: A crash between the creating.marker write (inside the port lock) and saveState leaves a marker-only host dir. Sweep's catch{continue} skips it (ENOENT on state.json); claimedPortSet reads the stale marker and permanently claims its internal+public ports from the 11-pair pool. CREATING_MARKER_MAX_MS (90s) shows stale markers were intended to stop protecting, but no code removes them.
- impact: Each mid-creation crash permanently loses a port pair until manual deletion; repeated crashes exhaust the pool and block new sessions.
- remediation_sketch: Have sweep reap marker-only dirs older than the marker TTL (and remove the marker), freeing the claimed ports; treat missing state.json with an aged marker as sweepable.
- challenges: [discovered during CHALLENGE (A1-NEW); trace-verified]
- status: upheld (new finding) | corroborators: [challenger]

### F-016 · Session Chromium runs --no-sandbox in a container without capability hardening — medium

- dimension: 5 | category: security misconfiguration / broken isolation (CWE-284)
- anchor_ref: OWASP Top 10:2025 A05
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/constants.mjs:53; csm-browse/scripts/ensure-browser.mjs:163-168
- quoted_snippets:
  - `'--no-sandbox',`
  - `const runArgs = ['run', '-d', '--name', CONTAINER_NAME,\n      '--restart', 'unless-stopped',`
- explanation: CHROMIUM_FLAGS includes --no-sandbox for every session Chromium, and the container is created without --cap-drop, --security-opt, or read-only rootfs. The container renders arbitrary untrusted web content (navigate/type/click/eval). Challenger noted a partial inaccuracy: Docker's default seccomp profile is not disabled, so "no seccomp" is overstated — but no explicit hardening is applied.
- impact: A renderer exploit runs without Chromium's sandbox layer; the only boundary is the default-hardened container, which can read all session profiles under /config/csm-browse/sessions and reach other bridge-network services.
- remediation_sketch: Run Chromium with its sandbox or add --cap-drop=ALL, --security-opt no-new-privileges, an apparmor/seccomp profile, and a read-only rootfs with writable tmpfs for profile/cache.
- challenges: [challenger A2-2: AGREE — core claim stands; "no seccomp" title phrasing imprecise, substance verified]
- status: upheld (title corrected per dissent) | dissents: [seccomp nuance]

### F-017 · cdp-gate deny() never destroys sockets — local fd/memory exhaustion — medium

- dimension: 9 | category: improper resource release (CWE-401)
- anchor_ref: CWE Top 25 2025 (CWE-401)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/scripts/cdp-gate.mjs:81-84, 102; csm-browse/lib/ports.mjs:122
- quoted_snippets:
  - `function deny(socket, status) {\n  const reason = REASON_PHRASES[status] || 'Bad Gateway';\n  socket.end(\`HTTP/1.1 ${status} ${reason}\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n\`);\n}`
  - `const killTimer = setTimeout(() => { try { socket.destroy(); } catch {} }, STATIC_CLOSE_GRACE_MS);`
- explanation: deny() half-closes (FIN) without a destroy deadline, unlike serveStaticProtocol which has STATIC_CLOSE_GRACE_MS. Tracked-sockets Set entries persist until 'close'. Any local process can open many connections, send a bad request line (no token needed for a 403), and hold them half-open.
- impact: Local DoS of a session's gate via fd/memory exhaustion; partially mitigated by per-session gate isolation and cheap respawn, but the leak is real.
- remediation_sketch: Add a destroy timer in deny() mirroring serveStaticProtocol; clear lineTimer on close; remove socket from the tracked Set on error/close.
- challenges: [challenger A2-3: AGREE — asymmetry verified; local DoS real]
- status: upheld | corroborators: [sec-browse]

### F-018 · Port-lock stale-break is check-then-act — lock can be destroyed under a live holder — medium

- dimension: 8 | category: TOCTOU / atomicity violation (CWE-367)
- anchor_ref: TSan DetectableBugs taxonomy; CWE-367
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/ports.mjs:16-38, 60
- quoted_snippets:
  - `const current = await readFile(LOCK_FILE, 'utf-8');\nif (current === raw) await unlink(LOCK_FILE);`
- explanation: breakStaleLock reads content then unlinks in two awaits. Interleaving A.read(X) → B.read(X) → A.unlink → C.acquire(O_EXCL, writes Y) → B.unlink(Y) destroys a live holder's lock; releasePortLock also unlinks unconditionally. The content match narrows but does not close the window.
- impact: Two creators may allocate concurrently and return the same port pair, causing cross-session CDP collisions; partially mitigated by claimedPortSet reading markers, but the mutual-exclusion break is genuine.
- remediation_sketch: Break stale locks by atomic rename-to-unique-name and inspect the renamed artifact, or compare inode of an O_EXCL-opened fd; never unlink a lock you did not create this attempt.
- challenges: [challenger A2-4: AGREE — window between second read and unlink remains; claimedPortSet mitigation partial]
- status: upheld | corroborators: [concurrency]

### F-019 · Daemon pidfile claim read-then-unlink TOCTOU — duplicate daemon possible — medium

- dimension: 8 | category: TOCTOU / duplicate-daemon detection (CWE-367/362)
- anchor_ref: CWE-367
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/scripts/session-daemon.mjs:32-73
- quoted_snippets:
  - `const current = await readFile(pidFile, 'utf-8');\nif (current === raw) await rm(pidFile, { force: true });`
- explanation: claimPidFile's stale-break mirrors ports.mjs. Two concurrent spawns observing a stale dead-pid file can interleave so the second rm deletes the first's freshly O_EXCL-created pidfile, yielding two live daemons on the same session.
- impact: Duplicate daemons both connect to CDP and poll the same queue; mostly duplicated event capture and double CDP connections (launchDaemon's ready-marker checks partially mitigate double command execution).
- remediation_sketch: After rm, re-attempt O_EXCL in the same loop and have the daemon verify it still owns the inode (fstat on fd); or break stale claims by rename-to-trash and inspect.
- challenges: [challenger A2-5: AGREE — interleaving trace shows duplicate daemon reachable]
- status: upheld | corroborators: [concurrency]

### F-020 · Sweep container pass can kill an in-flight adoption — medium

- dimension: 8 | category: check-then-act / atomicity violation (CWE-362)
- anchor_ref: CWE-362/609
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-browse/lib/sweep.mjs:204-221; csm-browse/scripts/ensure-browser.mjs:181-224, 270-273
- quoted_snippets:
  - `if (await hasFreshCreatingMarker(join(SESSIONS_ROOT, psid))) continue;\nconst hostStateExists = existsSync(join(SESSIONS_ROOT, psid, 'state.json'));`
  - `await ensurePrivateDir(hostSessDir);\nawait secureWrite(markerPath, JSON.stringify({ pid: process.pid, internal, public: pub, ts: new Date().toISOString() }), { encoding: 'utf-8' });`
- explanation: adoptSession writes no creating.marker. During adoption, chromium is alive, state.json absent (up to the 30s CDP-probe window); a concurrent sweep (another sid, or --cleanup-stale) sees no host state and pkillMatch's the chromium, kills the gate, and rm -rf's the profile. Stale-marker TTL can be exceeded after a prior crash.
- impact: A concurrently invoked sweep destroys a session being adopted; consequences mostly self-healing (CDP probe fails, session recreated), but container session dirs can be removed mid-flight and state diverges.
- remediation_sketch: Have adoptSession write creating.marker before killGate/spawnGate and remove after saveState, like createSession.
- challenges: [challenger A2-6: AGREE — race real, consequences recoverable; medium reasonable]
- status: upheld | corroborators: [concurrency]

### F-021 · PID liveness checks lack process-identity verification — PID-reuse TOCTOU — medium

- dimension: 8 | category: check-then-act / stale-resource handling (CWE-367/667)
- anchor_ref: CWE-367
- severity: medium | confidence: low | evidence_class: E2
- locations: csm-browse/lib/cleanup.mjs:29-43; csm-browse/lib/sweep.mjs:64-75; csm-browse/scripts/ensure-browser.mjs:371-383
- quoted_snippets:
  - `while (Date.now() - start < 5000) {\n  try { process.kill(pid, 0); await setTimeout(200); } catch { return true; }\n}`
  - `async function daemonAlive(pid) {\n  try { process.kill(pid, 0); return true; } catch { return false; }\n}`
- explanation: stopDaemon/daemonAlive/killPidGracefully/zombie-check treat a live PID as proof the session's daemon is alive; no start-time/argv identity is recorded. After a daemon dies, a recycled PID can be SIGTERM'd/SIGKILL'd (unrelated process) or keep a dead session "alive" forever.
- impact: Unrelated user processes killed on session cleanup, or stale sessions never reaped. Mitigations (ready-marker mtime, argv-matched orphan pass) reduce frequency but not the class.
- remediation_sketch: Record and verify process identity (e.g. /proc/<pid>/stat starttime or pgrep argv match) before signaling.
- challenges: [challenger A2-8: AGREE — low-probability but plausible on busy hosts; medium/low hedged appropriately]
- status: upheld | corroborators: [concurrency]

### F-022 · Unbounded synchronous readFileSync before size bound — OOM DoS — medium

- dimension: 9 | category: unbounded resource consumption (CWE-400)
- anchor_ref: CWE Top 25 2025 (CWE-400)
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/deep/security.mjs:118-125; deep/documentation.mjs:38-44; deep/config.mjs:547-549; deep/conventions.mjs:1363; deep/testing.mjs:253
- quoted_snippets:
  - `const content = readFileSync(absPath, 'utf-8');`
  - `return content.length > SCAN_BYTE_LIMIT ? null : content;`
- explanation: The shared read pattern loads the entire file (UTF-16 code units) before discarding above the cap; several reads have no cap at all. No stat-before-read anywhere on these paths, unlike the codebase's own readPluginArtifacts pattern. A multi-GB tier-0 file (e.g. .env) causes full allocation and OOM of the scanner.
- impact: DoS/crash of the review tool on a crafted untrusted repo; event-loop blocking during reads.
- remediation_sketch: statSync before read and skip files above the bound; use a byte-limit reader / bounded stream instead of whole-file readFileSync.
- challenges: [challenger B1-2: AGREE — verified; documented pattern exists in-repo and is not applied]
- status: upheld | corroborators: [sec-scan]

### F-023 · Well-known-file reads follow symlinks out of the repository — medium

- dimension: 11 | category: path handling / trust boundary (CWE-59)
- anchor_ref: CWE Top 25 2025 (CWE-59); ASVS v5.0.0 V1.5.1
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/deep/security.mjs:572; deep/config.mjs:547; deep/documentation.mjs:118; deep/operations.mjs:453-459
- quoted_snippets:
  - `const content = readContent(join(repoPath, '.gitleaks.toml'));`
  - `if (!existsSync(join(repoPath, f))) continue;`
- explanation: git checkouts materialize attacker-controlled symlinks; scanners re-resolve well-known names (`.gitleaks.toml`, `.env*`, `.github`, CHANGELOG, README) via existsSync+readFileSync/readdirSync with no realpath containment — unlike plugins/loader.mjs which enforces realpath containment and rejects symlinks. A symlinked `.env.development → /dev/zero` or `.github → <host dir>` pulls host files into the scan window.
- impact: Host files read into analysis (amplifying F-022); derived identifiers from host config can appear in reports; violates the tool's privacy claim.
- remediation_sketch: Verify with lstat/realpath that each well-known file resolves inside the repo before reading, mirroring the plugin loader's checks.
- challenges: [challenger B1-3: AGREE — repo boundary is an intended invariant (proven by artifacts.mjs) that these paths violate]
- status: upheld | corroborators: [sec-scan]

### F-024 · Incomplete markdown/HTML neutralization — report structure/prompt injection — medium

- dimension: 5 | category: output encoding (CWE-79); prompt-injection channel
- anchor_ref: ASVS v5.0.0 V10.2.1
- severity: medium | confidence: high | evidence_class: E2 (prior F-021 confirmed unresolved)
- locations: csm-scan/lib/scan/render/base.mjs:12-17; lib/scan/write.mjs:64, 75, 94
- quoted_snippets:
  - `scalar = scalar.replace(/\\\\/g, '\\\\\\\\').replace(/\\|/g, '\\\\|').replace(/`/g, '\\\\`');`
  - `if (!opts.inTable) scalar = scalar.replace(/^([-#+>])/gm, '\\\\$1');`
- explanation: escapeField escapes only backslash, pipe, backtick, and leading line markers. Challenger empirically verified `**bold**`, `<img src=x onerror=alert(1)>`, `[click](javascript:…)`, and newlines pass through unchanged. Repo-controlled fields (overview.description from manifest, overview.name, cross-observation descriptions) are rendered at the top of every repo section of NORMS.md.
- impact: A scanned repository can restructure the generated report, spoof findings, or smuggle instructions into a document subsequently fed to an LLM agent; stored HTML/script injection in unsanitized renderers.
- remediation_sketch: Neutralize newlines and the full markdown-significant token set (`<>[]()*_~!`) in repo-controlled fields; wrap repo-controlled description blocks in delimited fences.
- challenges: [challenger B1-4: AGREE — empirically verified injection shapes pass through]
- status: upheld | corroborators: [sec-scan, remediation-verifier (F-021 prior)]

### F-025 · Secret redaction denylist omits common token families — medium

- dimension: 7 | category: secrets & data exposure (CWE-798)
- anchor_ref: ASVS v5.0.0 V8.3; CWE-798
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/report/reporter.mjs:34; lib/scan/shared/privacy.mjs:23; lib/scan/deep/security.mjs:280-303
- quoted_snippets:
  - `const SECRET = /(?:\-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\\b(?:bearer|password|...)\\s*[:=]\\s*\\S+|...|gh[opusr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\\b)/i;`
  - `lines.push(\`  - **${patternLabel}**: ${s.totalFiles} file(s) (e.g. \\\`${escapeField(s.files[0] || 'unknown')}\\\`)\${allowlisted}\`);`
- explanation: Challenger empirically verified that `sk_live_…`, `xoxb-…`, `eyJ…` JWTs, and `npm_…` pass through sanitizeText/sanitizeStructuredText unredacted, while AKIA/ghp_ redact correctly — the redaction vocabulary lags the scanner's own detection vocabulary (security.mjs:288-301 detects exactly these families). The legacy security dimension is not subject to the fail-before-write gate, so this denylist is the only defense for those fields.
- impact: Secret-shaped strings in repo-controlled report fields survive into the generated report.
- remediation_sketch: Unify the report redactor with the deep scanner's token families; redact by span rather than whole-line collapse; extend the gate to legacy dimensions.
- challenges: [challenger B1-5: AGREE — empirically verified leaks for all four families]
- status: upheld | corroborators: [sec-scan]

### F-026 · Fail-before-write privacy gate skips all ten legacy dimensions — low

- dimension: 6 | category: security control verification
- anchor_ref: ASVS v5.0.0 V1.6.1
- severity: low | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/pipeline/run.mjs:377-418
- quoted_snippets:
  - `const PRIVACY_ENFORCED_DIMENSIONS = Object.freeze([\n  'api', 'data', 'deployment', 'maintainability', 'governance', 'assurance', 'practices',`
  - `if (!PRIVACY_ENFORCED_DIMENSIONS.includes(entry.dimension)) continue;`
- explanation: assertFindingsPrivacy covers only 7/17 dimensions; the ten legacy dimensions are grandfathered. Challenger downgraded because every rendered string still passes through WRITE_RENDER_CONTEXT → sanitizeStructuredText at write time, and the skip is explicitly documented intentional grandfathering — a defense-in-depth reduction, not a standing leak.
- impact: Reduced redundancy: a legacy-scanner leak only surfaces in combination with a sanitizer gap (F-025).
- remediation_sketch: Extend the structural gate to legacy dimension models with explicit allowlists.
- challenges: [challenger B1-6: DOWNGRADE medium→low — behavior verified; render-time sanitizer bounds impact]
- status: downgraded | corroborators: [sec-scan]

### F-027 · Cargo virtual-workspace [workspace.dependencies] merged into root inventory — medium

- dimension: 1 | category: incorrect data / false positives
- anchor_ref: ISO/IEC 25010:2023 functional accuracy
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/shared/manifest.mjs:470-476
- quoted_snippets:
  - `if (ws.dependencies && typeof ws.dependencies === 'object') {\n      for (const [k, v] of Object.entries(ws.dependencies)) {\n        workspaceDependencies[k] = cargoDepSpec(v);\n        if (!(k in result.dependencies)) result.dependencies[k] = workspaceDependencies[k];`
- explanation: In a virtual workspace root, [workspace.dependencies] is a version pool for member crates, not the root's own dependencies; every pool entry is attributed to the root regardless of member references (member handling via mergeCargoDependencies is correct). Downstream detection tables then report unused pool packages as "used".
- impact: Inflated dependency inventory and false security/architecture signals for monorepos.
- remediation_sketch: Only merge pool entries actually referenced via `workspace = true`, or mark them with a distinct 'declared-pool' provenance.
- challenges: [challenger B1-9: AGREE — verified downstream effect into security detection]
- status: upheld | corroborators: [q-render]

### F-028 · enrichValidateRetry returns pre-retry enriched — stale diagnostics — medium

- dimension: 1 | category: stale diagnostic state
- anchor_ref: ISO/IEC 25010 functional suitability
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/pipeline/run.mjs:147-151, 342-361
- quoted_snippets:
  - `return { enriched: firstEnriched, validated, trace };`
  - `enriched = await enrich(merged, overview);`
- explanation: Inside the retry loop enriched is reassigned to post-retry enrichment, but the function returns firstEnriched (pre-retry). Consumers report enriched.gaps/inferredPatterns and store enriched into the semantic payload, so diagnostics describe pre-retry state while validated.findings is post-retry.
- impact: Misleading scan-notes ("dimension missing" printed after a successful retry) and a semantic payload internally inconsistent with validated.
- remediation_sketch: Return the final enriched (or both with explicit names).
- challenges: [challenger B1-10: AGREE — genuine wrong-variable return; impact confined to secondary metadata]
- status: upheld | corroborators: [q-deep]

### F-029 · practices.mjs kind tokens rendered without escapeField — medium

- dimension: 3 | category: escape-gap contradiction
- anchor_ref: SonarSource smells
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/render/practices.mjs:288-295, 18
- quoted_snippets:
  - `function kindTokenList(entry, escapeField) {\n  if (!Array.isArray(entry.kinds) || entry.kinds.length === 0) return '';\n  const shown = entry.kinds.slice(0, STYLE_KIND_DISPLAY_CAP);\n  const tokens = shown.map((token) => \`\\\`${token}\\\`\`);`
  - `// user-derived strings pass through the shared render context's \`escapeField\``
- explanation: kindTokenList accepts escapeField but never uses it; kind tokens (ruff codes, deny-rule ids, hook stages — model TOKEN_PATTERN explicitly admits backticks and pipes) are interpolated raw inside backticks. gateValueCell in the same file escapes its tokens — inconsistent behavior.
- impact: Malformed markdown or unescaped content in Development Practices output; violates the module's documented escape contract.
- remediation_sketch: Escape tokens via escapeField(token, {inTable:true}) and drop the unused parameter.
- challenges: [challenger B2-3: AGREE — reachable via production pipeline; model admits backticks/pipes]
- status: upheld | corroborators: [q-render]

### F-030 · Detection tables treat framework presence as auth/validation evidence — medium

- dimension: 4 | category: false-positive-prone mapping
- anchor_ref: eng-practices Design/Complexity
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/shared/detection.mjs:146, 152, 202-203; lib/scan/deep/security.mjs:703-707
- quoted_snippets:
  - `'flask-login': { label: 'Flask-Login', type: 'Session' },\n  django: { label: 'Django (contrib.auth)', type: 'Framework auth' },`
  - `pydantic: { label: 'Pydantic', type: 'Validation' },\n  marshmallow: { label: 'Marshmallow', type: 'Validation' },`
- explanation: Merely depending on Django/FastAPI causes "Authentication: Django (contrib.auth)" and "Input validation" findings, and can lift the security signal to high regardless of secrets/audit (signal gate at 703-707). Challenger verified the signal inflation path.
- impact: Systematically inflated security findings for common web frameworks, reducing report trustworthiness.
- remediation_sketch: Restrict framework entries to specific auth/validation subsystems (e.g. django.contrib.auth imports, fastapi.security usage) or introduce a separate 'capability' category.
- challenges: [challenger B2-6: AGREE — signal lift to 'high' on dependency presence alone is concrete]
- status: upheld | corroborators: [q-render]

### F-031 · Per-rule match cap aborts evaluation of all remaining rules — medium

- dimension: 1 | category: silently dropped plugin evidence
- anchor_ref: ISO/IEC 25010 functional suitability
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2)
- locations: csm-scan/lib/scan/providers/rules.mjs:326-335
- quoted_snippets:
  - `if ((perRuleCounts.get(rule.id) ?? 0) >= RULE_EVALUATION_LIMITS.maxMatchesPerRule) {`
  - `capped = true;\n      break;\n    }\n    if (capped) break;`
- explanation: maxMatchesPerRule (128) is per-rule, but hitting it sets `capped` and breaks the inner loop; the outer `if (capped) break` then aborts ALL remaining rules for the plugin. JSDoc discloses the cap but not the collateral suppression. Prior-review F-024 confirmed still unresolved.
- impact: One chatty rule silently suppresses every later rule's detections; no per-rule disclosure.
- remediation_sketch: Break only the inner loop for the capped rule; keep the total maxMatches as the sole outer-break condition.
- challenges: [challenger B2-7: AGREE — reachable via production pipeline (run.mjs:722)]
- status: upheld | corroborators: [q-render, q-deep, remediation-verifier]

### F-032 · Coverage map gaps: four lib modules have no direct tests; gate is a global line floor — medium

- dimension: 12 | category: coverage
- anchor_ref: Fowler TestCoverage
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/lib/scan/deep/architecture/canonical.mjs; lib/scan/render/git.mjs; lib/scan/report/verbose-trace.mjs; lib/scan/shared/jsonc.mjs; csm-scan/test/scripts/coverage-gate.mjs:35-44
- quoted_snippets:
  - `NOT wired to CI — T013 (CI activation) is deferred by user decision; this is a local/manual gate.`
  - `const LINE_THRESHOLD = 88;`
  - `const SUMMARY_PATTERN = /^#\\s*all files\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*([\\d.]+)\\s*\\|/;`
- explanation: canonical.mjs, jsonc.mjs, render/git.mjs (whole renderer), and verbose-trace.mjs (CLI-only, zero tests) have no direct test import; the gate enforces only the aggregate 88% line floor — branch/function figures parsed but never gated.
- impact: A whole renderer and the verbose-trace reporter can regress without any test failing as long as total line coverage stays above 88%.
- remediation_sketch: Add a per-module coverage manifest, direct unit tests for render/git.mjs and verbose-trace.mjs, and gate branch/function floors.
- challenges: [challenger C-C-1: AGREE — import graph verified; only verbose-trace is effectively outside the map]
- status: upheld | corroborators: [tests-scan]

### F-033 · Meta-source assertions audit the test's own text — circumvented by adjacent helper — medium

- dimension: 13 | category: assertion
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/expansion-production-pipeline.test.mjs:357-368; expansion-fixtures.test.mjs:837-842; test/helpers/legacy-pipeline-mirror.mjs:26-37
- quoted_snippets:
  - `test('T204 pipeline tests never reconstruct scanner dispatch independently', async () => { const source = await readFile(new URL(import.meta.url), 'utf8'); assert.doesNotMatch(source, /lib\\/scan\\/deep\\//);`
  - `assert.ok(!exports.some((name) => name === 'runExisting' + 'TenPipeline'), 'the legacy pipeline entry must be retired');`
- explanation: Two suites assert on their own source text, but the guarded behavior (deep-scanner dispatch) lives one directory over in helpers/legacy-pipeline-mirror.mjs. Challenger downgraded: the helper composes the same production functions and parity assertions still differentially check output, so behavioral coverage is intact — the guard is a decorative tripwire, not a gap.
- impact: False assurance; maintenance burden on every refactor (rename-tricks to keep the regex happy).
- remediation_sketch: Delete source-text assertions; enforce the dispatch rule structurally (lint rule) or behaviorally.
- challenges: [challenger C-C-2: DOWNGRADE high→medium — circumvention real, but differential assertions keep behavioral coverage]
- status: downgraded | corroborators: [tests-scan]

### F-034 · Machine-bound SHA-256 locks pin files to themselves — migration tripwires, not oracles — medium

- dimension: 13 | category: assertion
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/expansion-baseline.test.mjs:137-189; expansion-constraints.test.mjs:152-188
- quoted_snippets:
  - `for (const [path, sha256] of Object.entries(integrity.files)) { assert.equal(digest(await readFile(join(TEST_ROOT, '..', path))), sha256, \`${path} integrity changed\`); }`
  - `assert.equal(digest(source), owner.sha256, \`${owner.path} changed before its planned migration\`);`
- explanation: test-integrity.json, capabilities.json, and supersession.json hash the very files they check — no independent oracle; any benign edit fails until the baseline is hand-regenerated (challenger confirmed current digests match; no regen script). Deliberate, documented migration locks with an explicit supersession policy.
- impact: Brittleness: legitimate refactors blocked by bytes-level locks; manual regeneration incentivizes blessing any change. Bounded by the visible, manual regeneration step.
- remediation_sketch: Replace byte-hash locks with behavioral/structural constraints; scope remaining locks to small dated allowlists with expiry tasks.
- challenges: [challenger C-C-3: DOWNGRADE high→medium — deliberate documented policy; weakening requires visible manual baseline regen]
- status: downgraded | corroborators: [tests-scan]

### F-035 · "Legacy parity oracle" re-implements the pipeline it guards — circular baseline — medium

- dimension: 13 | category: test architecture
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/helpers/legacy-pipeline-mirror.mjs:23-57; expansion-production-pipeline.test.mjs:152-181; fixtures-pipeline.test.mjs:104-107
- quoted_snippets:
  - `const old = await runLegacyTenMirror(repoPath); assert.equal(old.semanticSha256, expected.semanticSha256, \`${c.name}: reused legacy mirror no longer matches the baseline\`);`
  - `export async function runLegacyTenMirror(repoPath) { const overview = await survey(repoPath); const deepResults = (await Promise.all([structure.scan(...), ...])).filter(Boolean); ... }`
- explanation: The mirror re-orchestrates the retired ten-dimension pipeline and baselines are snapshots of the mirror's own output. Challenger noted the mirror composes identical production functions (not a parallel implementation) and the expanded pipeline is differentially compared against it, plus independent behavioral assertions exist.
- impact: The strongest-sounding hash guarantees only detect divergence between two copies of the same code; any intentional renderer improvement costs dual baseline regeneration.
- remediation_sketch: Pin one golden set captured from a frozen revision and assert production against it directly.
- challenges: [challenger C-C-4: DOWNGRADE high→medium — circularity inherent post-T002; differential comparison bounds risk]
- status: downgraded | corroborators: [tests-scan]

### F-036 · Hard-coded registry/claim/case counts duplicated across test files — medium

- dimension: 13 | category: assertion
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/expansion-activation.test.mjs:501; expansion-final-acceptance.test.mjs:448,785; expansion-constraints.test.mjs:343; expansion-contracts.test.mjs:151; regression-parity.test.mjs:254
- quoted_snippets:
  - `assert.equal(registryClaims, 94);`
  - `assert.equal(P0_CASES.length, 21, 'the explicit P0 parity matrix must contain exactly 21 cases');`
- explanation: Registry size is expressed as scattered literals (94/17/10/21 across 19 assertions) instead of deriving from production constants. Counts are cross-checked against computed values, so drift self-detects when a count changes — the harm is maintenance coupling, not correctness.
- impact: Registry growth forces multi-file literal edits; a missed one produces a confusing failure.
- remediation_sketch: Derive all counts from production constants; drop self-referential case-count assertions.
- challenges: [challenger C-C-5: AGREE — 19 literals verified; self-detecting, maintainability harm]
- status: upheld | corroborators: [tests-scan]

### F-037 · Voice-gate matcher copy-pasted; "cannot drift" claim unenforced — medium

- dimension: 13 | category: duplication
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/voice-gate.test.mjs:15-76; expansion-voice-gate.test.mjs:16-18, 55-118
- quoted_snippets:
  - `// The matcher is copied from test/voice-gate.test.mjs (BANNED_VOICE + stripNonProse) rather than imported, so importing this gate never executes that file's own tests. The copy is byte-equivalent to the original matcher.`
  - `export const BANNED_VOICE = Object.freeze([ 'should', 'must', 'ought', 'shall', 'poor', ... ]);`
- explanation: The 33-word banned-vocabulary and masking regexes are duplicated verbatim; the "byte-equivalent" claim is a comment, not a check (challenger diffed: code identical, no test compares).
- impact: The neutral-voice guarantee diverges over time; a regressive word caught by one gate is missed by the other.
- remediation_sketch: Extract BANNED_VOICE/stripNonProse into a shared helper imported by both suites; pin the vocabulary in one equality test.
- challenges: [challenger C-C-6: AGREE — no test imports/compares the copies]
- status: upheld | corroborators: [tests-scan]

### F-038 · Self-referential count assertions and source-parsing create a closed audit loop — medium

- dimension: 13 | category: assertion
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/expansion-baseline.test.mjs:120-134; regression-parity.test.mjs:254-255
- quoted_snippets:
  - `const fixtureCases = [...fixtureSource.matchAll(/\\{ name: '([^']+)', files: \\w+Files,/g)].map((match) => match[1]); assert.deepEqual(fixtureCases, expected.fixtureCases);`
  - `assert.match(p0Source, /for \\(const \\{ name, run \\} of P0_CASES\\) test\\(name, run\\);/);`
- explanation: The baseline test regexes sibling test files against inventory.json snapshots, and regression-parity asserts its own length. Challenger noted the same assertions also enforce test registration and ban skips, giving the meta-guard real behavioral teeth.
- impact: Tests verify their own scaffolding; adding an unrelated P0 case forces a baseline bump; false impression of behavioral acceptance coverage.
- remediation_sketch: Remove source-text/self-count assertions; keep inventory.json as documentation or collect registered test names via the runner.
- challenges: [challenger C-C-9: AGREE — closed loop real; anti-deactivation check bounds the harm]
- status: upheld | corroborators: [tests-scan]

### F-039 · canonicalize/fixedInput/semanticProjection helper trio duplicated — drift already present — medium

- dimension: 13 | category: duplication
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-scan/test/fixtures-pipeline.test.mjs:32-51; test/helpers/legacy-pipeline-mirror.mjs:63-76; expansion-production-pipeline.test.mjs:43-57; expansion-baseline.test.mjs:33-68; expansion-activation.test.mjs:93-136
- quoted_snippets:
  - `// The expanded pipeline's cross-repository identity table renders scan:<scanId>, where scanId = sha256(repo path) ... .replace(/\\bscan-[0-9a-f]{24}\\b/g, '<SCAN_ID>');`
  - `function canonicalize(value, repoPath) { if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, repoPath)); ... }`
- explanation: The canonicalize/semanticProjection/fixedInput trio lives in 5+ files; only one copy has the <SCAN_ID> normalization (challenger confirmed via repo-wide grep) — the drift is already present. The hash-portability contract is defined in three places.
- impact: Golden baselines silently diverge across suites when normalizations change; only the suite whose copy was updated still passes.
- remediation_sketch: Extract into a single shared test helper; assert the normalization list against fixture-behavior.json.
- challenges: [challenger C-C-10: AGREE — divergence factual; arguably intentional (legacy output has no scan IDs), demonstrating the drift risk]
- status: upheld | corroborators: [tests-scan]

### F-040 · csm-browse unit-test breadth gap: 7 of 22 lib modules and the largest verb untested — medium

- dimension: 12 | category: coverage gap
- anchor_ref: Fowler TestCoverage
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-browse/lib/recorder.mjs:56; csm-browse/tests/unit/security.test.mjs:13; csm-browse/lib/verbs/capture.mjs:73
- quoted_snippets:
  - `export async function startRecorder(client, sessionId, sessionDir, outName, fps = 15, preset = 'medium', speed = 'medium') {`
  - `const { assertValidOutput } = await import('../../lib/recorder.mjs');`
- explanation: recorder.mjs's start/stop/reconcile (ffmpeg pipeline, frame accounting) are represented only by assertValidOutput; cleanup.mjs's stopDaemon/killInstance/killGate are untested; verbs capture.mjs (242 lines: stitching, consent-wall, truncation), close.mjs, dom.mjs, input.mjs, nav.mjs, record.mjs have no unit tests and are covered only by the Docker-gated e2e.
- impact: The most complex modules (screencast, stitching, teardown) have zero fast, Docker-free regression coverage.
- remediation_sketch: Add unit tests for recorder start/stop with a stubbed ffmpeg, cleanup with exec stubs, and verbs/capture with fake CDP + tiny fixtures.
- challenges: [primary-led (independence caveat: challenge unavailable this run)]
- status: upheld | corroborators: [tests-root]

### F-041 · e2e suite Docker-gated, silently exits 0 on skip, not in default test command — medium

- dimension: 14 | category: skipped-by-default e2e
- anchor_ref: Google Test Sizes; Google flaky-tests 2016
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-browse/package.json:6-7; csm-browse/tests/e2e.mjs:22-63, 515
- quoted_snippets:
  - `"test": "node --test \\"tests/unit/*.test.mjs\\""`
  - `if (!(await dockerProbeOk())) {\n  console.log('SKIP: Docker/chromium-vnc unavailable');\n  await writeSummary({ skipped: true, reason: 'docker-unavailable', ts: new Date().toISOString() });\n  process.exit(0);\n}`
- explanation: The default test script runs only unit tests; e2e skips cleanly (exit 0) without Docker, and --quick additionally skips daemon-restart and video steps. No CI enforces it.
- impact: Default test runs can pass while primary browser-automation behaviors (screencast, stitching, consent-wall, daemon restart) are entirely unverified; regressions ship silently.
- remediation_sketch: Add a CI job provisioning Docker and running the full e2e; make skip states non-zero under CSM_BROWSE_E2E_REQUIRE=1.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [tests-root]

### F-042 · No property-based, fuzz, or mutation tests anywhere — parser edge cases unverified — medium

- dimension: 14 | category: missing test types
- anchor_ref: ASVS v5.0.0 V1.5.x; csm-review dim 14
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-browse/tests/unit/auth.test.mjs:128-139; csm-review/SKILL.md:228
- quoted_snippets:
  - `for (const line of ['', 'BOGUS', 'GET /x', 'GET /x HTTP/1.1\\x00', 'not a url', '\\u0000\\u0000']) {`
  - `property-based (hypothesis/fast-check); mutation (PIT/Stryker/mutmut); fuzz (via OSS-Fuzz advisories in OSV)`
- explanation: The security-sensitive hand-rolled HTTP request-line parser (checkRequestLine) is tested by ~10 enumerated literals; a repo-wide search finds no fuzz/property/mutation tooling, despite the repo's own dimension-14 mandate and ASVS V1.5.x requirements. Prior-review F-027 confirmed partial (coverage gate exists, mutation/property/fuzz never wired).
- impact: Parser edge cases (encoding variants, CR/LF splits, 0x00 positions) go unverified; no mutation score substantiates suite rigor.
- remediation_sketch: Add a fast-check property suite over checkRequestLine and a bounded fuzz harness gated to the unit suite.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [tests-root, remediation-verifier (F-027 partial)]

### F-043 · Protocol suite tests a test-local reference engine, not the shipped bootstrap artifact — medium

- dimension: 13 | category: reference-engine testing
- anchor_ref: testsmells.github.io (Indirect Testing)
- severity: medium | confidence: high | evidence_class: E2
- locations: tests/protocol/engine.mjs:116; tests/protocol/protocol.test.mjs:7; bootstrap/package/bin/csm-skills-bootstrap.js:52-64
- quoted_snippets:
  - `import { runProtocol } from './engine.mjs';`
  - `} else if (arg === 'payload-index') {`
- explanation: The full DISCOVER-TRUST-MATERIALIZE-VERIFY-REPORT state machine exists only under tests/protocol/; the shipped bin implements only --version/payload-index/--help. Challenger downgraded because protocol.md explicitly documents the reference-engine strategy (review-approved architecture), the shipped CLI is separately exercised (package-audit), and integration/bootstrap-flow ties the engine to the real packed tarball.
- impact: Divergence between engine.mjs and any future real agent flow is invisible to tests; refusal semantics are validated only against the model.
- remediation_sketch: Move the protocol state machine into bootstrap/package (imported by the bin and tests), or add a conformance test deriving the state table from protocol.md.
- challenges: [challenger D2-1: DOWNGRADE high→medium — documented review-approved design; residual gap real]
- status: downgraded | corroborators: [tests-root]

### F-044 · Trust policy duplicated across engine, trust test, and offline grammar — no shared source — medium

- dimension: 13 | category: test duplication
- anchor_ref: testsmells.github.io
- severity: medium | confidence: high | evidence_class: E2
- locations: tests/protocol/engine.mjs:34; tests/bootstrap-trust.test.mjs:17, 64; tests/offline/commands.mjs:26-45
- quoted_snippets:
  - `const shellDenylist = /\\b(npx|npm|node|nodejs|bash|sh|python|python3|pip|pip3|git|curl|wget|sudo|rm|powershell|eval|exec|chmod|chown|docker|uvx|bunx|deno)\\b/i;`
  - `if (pkg?.name !== '@jamiemills/csm-skills-bootstrap' || pkg?.version !== '0.1.0' || pkg?.bin !== 'csm-skills-bootstrap') refuse('TRUST', 'E_UNTRUSTED', 'package policy is not fixed');`
- explanation: The shell-execution denylist regex and fixed-package policy are independently copied (challenger verified byte-identical regex, observable drift in the package check — engine lacks the registry check the trust test has), with a third grammar-driven mechanism in offline/commands.mjs.
- impact: The trust boundary's semantics can drift between enforcement copies; no test fails on the drift.
- remediation_sketch: Extract denylist and package-policy constants into a shared module imported by all copies; add a conformance test over a malicious/good corpus.
- challenges: [challenger D2-8: AGREE — triplication substantially accurate; drift already observable]
- status: upheld | corroborators: [tests-root]

### F-045 · Shipped bootstrap performs no cryptographic authenticity check — trust validator exists only as test code — medium

- dimension: 5 | category: CWE-347 / CWE-345
- anchor_ref: CWE Top 25 2025 (CWE-347)
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×3; merged F-045a/b/c)
- locations: bootstrap/package/bin/csm-skills-bootstrap.js:21-50; bootstrap/package.json:8-10; bootstrap/protocol.md:27-28, 154-156; tests/bootstrap-trust.test.mjs:29-83
- quoted_snippets:
  - `const index = JSON.parse(await readFile(join(packageRoot, 'payload-index.json'), 'utf8'));`
  - `if (sha256(data) !== entry.sha256) failures.push({ path: entry.path, error: 'HASH_MISMATCH' });`
  - `// the engine intentionally does not re-verify the envelope signature: the signed boundary belongs to the envelope trust layer, which has no importable validator`
- explanation: Three independent finders converged: the shipped bin verifies payload hashes against payload-index.json shipped in the same package (self-referential); the Ed25519 keyring+signature validator lives only inside tests/bootstrap-trust.test.mjs; package.json 'files' excludes keyring.json, schema.json, and the validator. Challengers downgraded high→medium: pre-release state, envelope trust deliberately delegated to an agent-owned trust root, npm registry integrity + recorded tarball shasum anchor authenticity, and release-checklist documents future publication. The residual defect is a genuine release-readiness gap: no importable, tested validator exists for any consumer.
- impact: Anyone who can republish the package can regenerate a matching index after tampering; the signed boundary described in protocol.md is not anchored to payload bytes and cannot be enforced by any consumer today.
- remediation_sketch: Ship the envelope validator + keyring and require an Ed25519 signature over payload-index.json (including its digest in policyToSign — see F-046) before placement; or adopt npm integrity + sigstore/cosign attestation verified at runtime.
- challenges: [challenger D1-1: DOWNGRADE high→medium — documented scope, registry anchoring, pre-release; real gap is unshipped validator; challenger D1-6: DOWNGRADE high→medium — known accepted state, no current exploit surface; challenger D2-2: DOWNGRADE high→low — no shipped validator to duplicate; merged into F-045 with the residual duplication in F-044]
- status: downgraded (from high; merged from 3 findings) | corroborators: [sec-root, q-root, tests-root]

### F-046 · Signed envelope binds package identity, not payload bytes — no payload-index digest in policy — medium

- dimension: 5 | category: CWE-345
- anchor_ref: CWE Top 25 2025 (CWE-345)
- severity: medium | confidence: high | evidence_class: E2
- locations: tests/bootstrap-trust.test.mjs:25; bootstrap/fixtures/valid.json:6-10; bootstrap/schema.json:21-46
- quoted_snippets:
  - `const policyToSign = envelope => ({ schema: envelope.schema, audience: envelope.audience, expires_at: envelope.expires_at, key: envelope.key, policy: envelope.policy, steps_sha256: envelope.steps_sha256 });`
- explanation: Even where the envelope signature is verified, the signed payload covers schema/audience/expires/key/policy/steps_sha256 only — nothing binds payload-index.json or payload bytes. Challenger noted mitigations (sha256 binding to shipped index, deterministic tarball shasum in release records) but the design-intent mismatch is real: plan text claims the signed manifest authenticates payload.
- impact: A valid signature authenticates the package name/version string, not the bytes installed; the signed trust boundary is not anchored to content.
- remediation_sketch: Add a required payload_index_sha256 to the envelope schema and include it in policyToSign.
- challenges: [challenger D1-2: DOWNGRADE high→medium — registry/tarball anchoring bounds exploitability; omission is defense-in-depth/design-intent mismatch]
- status: downgraded (from high) | corroborators: [sec-root]

### F-047 · TOCTOU: destination symlink check runs once; final writes follow symlinks — medium

- dimension: 5 | category: CWE-367 / CWE-59
- anchor_ref: CWE Top 25 2025
- severity: medium | confidence: high | evidence_class: E2
- locations: tests/protocol/engine.mjs:81-97, 151, 171, 245-252
- quoted_snippets:
  - `if (stat.isSymbolicLink()) refuse(state, 'E_DESTINATION_SYMLINK', \`symlink component ${current}\`);`
  - `await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await finalizeTransport.copyFile(join(staging, relOf(entry)), target, parseInt(entry.mode, 8));`
- explanation: assertPlannableDestination is the only symlink gate and runs at PLAN_DESTINATION/CONFIRM; MATERIALIZE then mkdir/copyFile with no re-lstat and no O_NOFOLLOW. A component swapped to a symlink between check and write redirects placement outside the destination; assertPlannableDestination also stops lstat coverage at the first missing component.
- impact: A local adversary with write access to the destination's parent can redirect writes to arbitrary user-writable paths, defeating the E_DESTINATION_SYMLINK guarantee. Bounded: engine is test-only, payload is fixed bytes, post-write sha256 verification exists.
- remediation_sketch: Re-lstat every component immediately before each write, open targets with O_NOFOLLOW, write via tmp+rename inside a re-validated directory.
- challenges: [challenger D1-3: AGREE — mechanism accurate; not escalated for pre-release/test-only scope]
- status: upheld | corroborators: [sec-root]

### F-048 · csm-upload: unvalidated github/pagesRepo values interpolated into clone URL — medium

- dimension: 11 | category: CWE-20
- anchor_ref: ASVS v5.0.0 validation chapters
- severity: medium | confidence: high | evidence_class: E2
- locations: csm-upload/scripts/upload.mjs:44, 269-273, 298-315
- quoted_snippets:
  - `const github = ghOverride || config.github || '<github-user>';`
  - `const PAGES_REPO = \`https://github.com/${github}/${pagesRepo}.git\`;`
- explanation: Only uploaded basenames are validated; github/pagesRepo (CLI flags or ~/.agents/csm-upload.json) have no charset/URL validation. A github value containing '@' changes the URL authority (userinfo/host split). Challenger noted: scheme/host prefix is hardcoded, credential helpers are host-scoped (GitHub tokens not sent cross-host), and exploitation requires malicious args or a tampered config.
- impact: Redirected pushes to attacker repos; credential-confusion surface on a user/process-writable config.
- remediation_sketch: Validate github against /^[A-Za-z0-9-]{1,39}$/ and pagesRepo against /^[A-Za-z0-9._-]+$/; construct with the URL class and assert hostname === 'github.com'.
- challenges: [challenger D1-4: AGREE — '@' host-change verified; medium fair]
- status: upheld | corroborators: [sec-root]

### F-049 · Protocol engine TRUST state never verifies signature, keyring, expiry, or steps digest — medium

- dimension: 1 | category: incomplete validation / divergent trust enforcement
- anchor_ref: eng-practices Functionality
- severity: medium | confidence: high | evidence_class: E2
- locations: tests/protocol/engine.mjs:127-146; tests/bootstrap-trust.test.mjs:66-68
- quoted_snippets:
  - `if (envelope.schema !== 'csm-bootstrap/2') refuse('TRUST', 'E_UNTRUSTED', 'envelope schema is not csm-bootstrap/2');`
  - `if (envelope.steps_markdown.includes('\`') || envelope.steps_markdown.includes('~~~') || shellDenylist.test(envelope.steps_markdown))`
  - `if (!verify(null, Buffer.from(canonical(policyToSign(envelope))), publicKey, Buffer.from(envelope.signature.value, 'base64')))`
- explanation: The engine's TRUST state checks schema, denylists, and fixed package policy but never verifies signature, keyring, expiry, audience, or steps_sha256 (real verification lives in bootstrap-trust.test.mjs). Challenger downgraded: a forged envelope passing TRUST cannot change the fixed package/bin, inject shell, supply destinations, or alter placed bytes — residual exposure is attacker-influence of guidance steps and the payload_release label.
- impact: Consumers implementing the protocol from engine.mjs place payload files without cryptographic trust verification; the two reference implementations enforce different trust models.
- remediation_sketch: Factor trust validation into one shared module and have the engine's TRUST state call it before MATERIALIZE.
- challenges: [challenger D1-5: DOWNGRADE high→medium — bounded residual exposure; underlying defect is the unshipped trust layer (F-045)]
- status: downgraded (from high) | corroborators: [q-root]

### F-050 · Producer SKILL.md templates omit the `format:` frontmatter markers their gate and consumers require — medium

- dimension: 18 | category: docs conformance (cross-skill reference resolution)
- anchor_ref: eng-practices Documentation
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2; includes challenger new finding)
- locations: csm-plan/SKILL.md:213-218; csm-grill/SKILL.md:156-160; csm-review/SKILL.md:277-290; csm-build/SKILL.md:119; scripts/check-suite.mjs:526-528, 550-552
- quoted_snippets:
  - `# <Goal> CSM Plan\n\n## How To Execute`
  - `check(marker !== null && marker.kind === 'csm-plan' && marker.version >= 1 ... \`plan corpus .agents/plans/${f} missing/unknown format marker\`)`
  - `# Repository Review — <repo> @ <short-sha> (<date>)\n## Control (embedded journal...)`
- explanation: csm-build RECOVER, csm-bdd-tdd INTAKE, csm-plan INTAKE all instruct checking a `format:` marker, and check-suite fails any corpus artifact without one — yet none of the producer templates (csm-plan "Required Plan Document", csm-grill "Required Approach Document", and the challenger-discovered csm-review Report Format template) emit the marker or instruct adding it. All 16 plan + 1 approach files were retrofitted manually; the gate fails on any template-conformant fresh artifact (observed live with this report's own scaffold, lacking the csm-review marker).
- impact: A fresh csm-plan/csm-grill/csm-review run following the skill text produces a corpus artifact that fails the gate and blocks pre-commit; csm-build RECOVER has no defined behavior for a marker-less plan.
- remediation_sketch: Add `format: csm-plan/1` (resp. csm-grill/1, csm-review/1) frontmatter lines to the fenced templates; optionally assert the template itself contains the marker line.
- challenges: [challenger E-1: AGREE — offsets noted, substance verified; challenger E-N1: NEW — csm-review template same defect class]
- status: upheld | corroborators: [ops, challenger]

### F-051 · Unredacted .csm-scan-debug.log trace written but not covered by .gitignore — medium

- dimension: 17 | category: instrumentation safety
- anchor_ref: ISO/IEC 25010 operability
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2)
- locations: csm-scan/SKILL.md:200; csm-scan/lib/scan/report/verbose-trace.mjs:13-24; .gitignore:1-2; csm-scan/scripts/scan.mjs:174-183
- quoted_snippets:
  - `- \`--verbose\` — write an unredacted local diagnostic trace (reporter lines + per-stage durations) to \`.csm-scan-debug.log\` next to \`--out\` — never to stdout. Delete it after debugging.`
  - `node_modules/\n.e2e-summary.json`
- explanation: --verbose writes every pre-sanitization reporter line to .csm-scan-debug.log (mode 0600, documented UNREDACTED) next to --out — which may be inside the scanned repo — and .gitignore lists only node_modules/ and .e2e-summary.json. Two concurrent scans clobber the shared path. The repo protects other debug artifacts (.e2e-summary.json) but not this one.
- impact: An agent running --verbose inside a repo can leave an unredacted trace containing paths/identities that gets swept up by `git add .` — the exact privacy violation the skill promises to prevent.
- remediation_sketch: Add .csm-scan-debug.log to .gitignore (or write under the OS temp dir), and make the trace name per-run unique.
- challenges: [challenger E-3: AGREE — mitigation partial (opt-in, 0600, doc says delete); hygiene gap verified]
- status: upheld | corroborators: [ops, sec-scan]

### F-052 · Conformance gate mixes structural checks with substring checks — fence-unaware — medium

- dimension: 1 | category: weak verification
- anchor_ref: ISO/IEC 25010 functional completeness
- severity: medium | confidence: high | evidence_class: E2
- locations: scripts/check-suite.mjs:449, 460, 467, 22, 596-597
- quoted_snippets:
  - `check(srcContent !== null && srcContent.includes(contract.source.needle),`
  - `const refs = uploadContent === null ? [] : [...new Set(uploadContent.match(UPLOAD_SCRIPT_REF.pattern) || [])];`
  - `const re = /csm-[a-z-]+\\/[A-Za-z0-9_./-]+/g;`
- explanation: The structural checks use fenceMap, but CONTRACTS, UPLOAD_SCRIPT_REF, and README path scans run over raw content; a needle inside a fenced example satisfies the gate exactly as a real declaration would, and the README path class over-captures sentence-ending periods. Never-clause check operates on the YAML description where fence-awareness is moot.
- impact: The gate can pass while live prose lacks required contract declarations, and can spuriously fail/pass on README punctuation; verification strength inconsistent within one gate.
- remediation_sketch: Route CONTRACTS/UPLOAD_SCRIPT_REF/README scans through the existing fenceMap; fix the README path class boundary.
- challenges: [challenger D2-4: AGREE — genuine false-pass/false-fail potential]
- status: upheld | corroborators: [q-root]

### F-053 · No CI pipeline; gates local and opt-in; check-suite fails on untracked corpus files — medium

- dimension: 18 | category: gate enforcement / operational robustness
- anchor_ref: SonarSource quality-gate concepts
- severity: medium | confidence: high | evidence_class: E2 (corroborated ×2)
- locations: scripts/check-suite.mjs:536-543; scripts/hooks/pre-commit:7, 38; README.md:101, 132
- quoted_snippets:
  - `reviewFiles = fs.readdirSync(reviewsDir).filter((f) => f.endsWith('-review.md')).sort();`
  - `MISSING: review corpus .agents/reviews/2026-08-19-skills-review.md missing/unknown format marker`
  - `// full check battery (CI when enabled).`
- explanation: Two issues merged: (1) the corpus loops read the working tree with no git-tracking or draft notion — an untracked in-progress review (this very report) makes the repo-wide gate exit 1, and the pre-commit hook blocks all commits while any agent is mid-review (empirically reproduced by two finders and one challenger at this SHA); (2) no CI exists anywhere (no .github), the pre-commit hook is opt-in, and the coverage gate is explicitly "not wired to CI" — challenger downgraded the CI-claim component to low ("when enabled" is conditional; user-facing README is accurate; CI deferred by documented user decision).
- impact: Commits blocked by in-flight drafts; gate enforcement fully voluntary for clones that never install hooks; a fresh template-conformant review artifact fails the gate (compounds F-050).
- remediation_sketch: Corpus loops should ignore untracked files (or recognize a draft marker); add CI running check-suite + suites on push/PR, and update the hook header to state the actual enforcement model.
- challenges: [challenger D2-5: AGREE (corpus-gate component) — empirically reproduced; challenger E-2: DOWNGRADE (CI component) medium→low — conditional qualifier, accurate README, documented deferral]
- status: upheld (corpus component), downgraded (CI component) | corroborators: [q-root, ops]

### F-054 · Two divergent fenceMap/splitLines implementations across gate scripts — medium

- dimension: 3 | category: duplicated code with drift (S4144)
- anchor_ref: SonarSource concepts
- severity: medium | confidence: high | evidence_class: E2
- locations: scripts/check-suite.mjs:55-68; scripts/sync-skill-boilerplate.mjs:14-36
- quoted_snippets:
  - `function splitLines(content) {  return content.split(/\\r?\\n/);\n}`
  - `} else if (m && !(m[1][0] === '\`' && m[2].includes('\`'))) {\n    open = { char: m[1][0], len: m[1].length };\n    inFence[i] = true;`
  - `// The opening line itself is the boundary; following lines are fenced.`
- explanation: The two fenceMaps already disagree: check-suite marks the opening fence line inFence and special-cases inline backticks; sync's version does not mark the opening line and closes on length only. Challenger verified via manual trace (```js/code/``` → [T,T,T] vs [F,T,F]).
- impact: The drift checker and conformance gate can disagree about the same SKILL.md; every fence fix must be applied twice.
- remediation_sketch: Extract one canonical markdown-utilities module used by check-suite, sync-skill-boilerplate, and gen-readme-matrix, with shared unit tests for fence edge cases.
- challenges: [challenger D2-7: AGREE — divergence real with distinct boundary semantics]
- status: upheld | corroborators: [q-root]

### F-055 · SQL DDL evidence line numbers computed from statement-relative offsets (prior F-023, unresolved) — medium

- dimension: 1 | category: incorrect data
- anchor_ref: ISO/IEC 25010 accuracy
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-scan/lib/scan/shared/extractor.mjs:279-283, 367-422
- quoted_snippets:
  - `lineIndexOf(source, statement.indexOf(match[0]))`
- explanation: sqlStatements splits+trims (destroying offsets), and line resolution uses statement.indexOf of a match within the trimmed statement — nearly all SQL DDL evidence records report line 1. Confirmed still unresolved by the remediation-verification pass (no fix landed since 2026-08-15).
- impact: SQL evidence citations in reports point at the wrong line, degrading evidence quality for the data dimension.
- remediation_sketch: Track source offsets through the split, or search the full source for the match; add a fixture with multi-statement SQL.
- challenges: [primary-led (independence caveat); independently re-confirmed by remediation-verification agent]
- status: upheld | corroborators: [remediation-verifier]

### F-056 · SUT-to-SUT co-drift loop remains in validate tests (prior F-028, partial) — medium

- dimension: 13 | category: weak assertion
- anchor_ref: testsmells.github.io
- severity: medium | confidence: medium | evidence_class: E3
- locations: csm-scan/test/validate.test.mjs:101-102, 125
- quoted_snippets:
  - `result.coverage[key] === enriched.cohesiveness[key]`
- explanation: A hand-computed oracle was added (asserting result.coverage.stack === 50), but the SUT-to-SUT co-drift loop remains: validate's coverage output is asserted equal to enrich's cohesiveness field that aliases the same number — if both drift together, the assertion still passes. Prior-review F-028 confirmed partial (one half fixed).
- impact: The coverage-agreement property can regress silently while the oracle still passes.
- remediation_sketch: Drop the co-drift equality; keep and extend hand-computed oracles per dimension.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [remediation-verifier]

### F-057 · ws@7.5.13 in production runtime path via chrome-remote-interface — old major — low

- dimension: 15 | category: maintenance status of key dependency
- anchor_ref: OSV.dev; endoflife.date
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/package.json:19; csm-browse/package-lock.json:501, 797
- quoted_snippets:
  - `"ws": "^7.5.13"`
  - `"ws": "^7.2.0"`
- explanation: ws is declared a devDependency but chrome-remote-interface (production) depends on ws ^7.2.0, so ws 7.x is the actual CDP transport in production. OSV reports 0 advisories at this pin (7.5.13 is the final 7.x with backported fixes); latent rather than active exposure.
- impact: The WebSocket transport sits on an upstream-unmaintained major; a future 7.x-only vulnerability would have no upstream fix path.
- remediation_sketch: Track chrome-remote-interface releases for a ws 8.x bump; upgrade CRI when it drops the ws ^7.2.0 constraint.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [supply]

### F-058 · jimp declared production dependency but never imported — low

- dimension: 15 | category: unused dependency surface
- anchor_ref: OSV.dev
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/package.json:12
- quoted_snippets:
  - `"jimp": "^1.6.1"`
- explanation: jimp ^1.6.1 is never imported by any source file (only a check-skill comment); the lockfile carries ~45 @jimp/* transitive entries into the production tree solely because check-skill requires every declared dependency to resolve.
- impact: Unnecessary supply-chain surface and install size with zero runtime value.
- remediation_sketch: Remove jimp (and make check-skill resolve only dependencies actually imported) and regenerate the lockfile.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [supply]

### F-059 · Digest-pinned browser image can age stale; e2e probe still uses mutable :latest — low

- dimension: 15 | category: mutable external reference / stale pinned image
- anchor_ref: CWE-494 (supply chain)
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/lib/constants.mjs:10-15; csm-browse/tests/e2e.mjs:51
- quoted_snippets:
  - `export const IMAGE = 'jlesage/chromium@sha256:7514667737463e4302d5b58bd07311790dd29c816d4a980143a96de85cf0210e';`
  - `['inspect', '--type=image', 'jlesage/chromium:latest']`
- explanation: Runtime pulls are digest-pinned (good), but the pin freezes the Chromium build with only a manual refresh-cadence comment; browser CVEs inside the image are invisible to OSV (npm-scope only). The e2e probe inspects the mutable :latest tag, which won't exist after a digest-only pull — silently SKIPs the suite in fresh environments.
- impact: Browser-level vulnerabilities can persist past upstream fixes; e2e availability gating can silently skip.
- remediation_sketch: Add a digest-age staleness check; change the e2e probe to match the pinned IMAGE constant.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [supply]

### F-060 · Node toolchain: bootstrap floor `>=20` admits EOL Node 20; host runs v20.20.2 (past EOL) — low

- dimension: 16 | category: engines-floor policy vs EOL reality
- anchor_ref: endoflife.date
- severity: low | confidence: medium | evidence_class: E3
- locations: bootstrap/package.json:17; csm-browse/package.json:15; .node-version:1
- quoted_snippets:
  - `"node": ">=20"`
  - `"node": ">=22 <25"`
- explanation: bootstrap/package.json floor-only `>=20` admits Node 20 (EOL 2026-04-30) and has no ceiling; csm-browse's `>=22 <25` admits EOL Node 23 and excludes current line 26. Host runs v20.20.2 (past EOL, verified) — environmental, disclosed here rather than as a repo defect. csm-scan has no engines declaration at all.
- impact: Bootstrap can be advertised as installable on an EOL interpreter; the effective supported window for csm-browse narrows to ~1 year (22 maintenance until 2027-04-30).
- remediation_sketch: Raise bootstrap floor to >=22 with a ceiling; narrow csm-browse to supported LTS lines; upgrade host Node; add engine-strict enforcement.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [supply]

### F-061 · README TOC omits generated "Composition matrix" section — low

- dimension: 18 | category: README structure drift
- anchor_ref: eng-practices Documentation
- severity: low | confidence: medium | evidence_class: E3
- locations: README.md:7-11, 54-55
- quoted_snippets:
  - `- [Skills](#skills)\n- [Requirements](#requirements)`
  - `## Composition matrix`
- explanation: gen-readme-matrix inserts and maintains the Composition matrix section between Skills and Requirements, but nothing updates the TOC, and check-suite does not validate TOC/H2 correspondence.
- impact: README index structurally incomplete for a section the repo's own tooling guarantees; navigation silently skips it.
- remediation_sketch: Have the generator (or check-suite) verify every H2 below the TOC has a TOC entry.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [q-root]

### F-062 · Iterative-file reads across legacy scanners lack a shared byte cap — low

- dimension: 9 | category: cumulative resource consumption
- anchor_ref: CWE-400
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-scan/lib/scan/deep/conventions.mjs:1363; deep/testing.mjs:253, 328, 362; deep/operations.mjs:60, 678, 915; deep/documentation.mjs:218, 257, 303
- quoted_snippets:
  - `text = readFileSync(join(repoPath, rel), 'utf8');`
- explanation: Beyond the primary readContent pattern (F-022), several legacy scanners perform unbounded whole-file reads in loops capped by file count but not bytes; attacker-controlled trees yield cumulative multi-GB allocations.
- impact: Whole-scan exhaustion vector scaling with repo size, worsening F-022.
- remediation_sketch: Introduce a shared bounded-read helper (statSync gate + byte-truncated read) and replace per-scanner readFileSync calls.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [sec-scan]

### F-063 · Orchestration skills have no behavioral test suite; gate battery is structural only — low

- dimension: 17 | category: test-coverage disclosure
- anchor_ref: ISO/IEC 25010 operability
- severity: low | confidence: medium | evidence_class: E3
- locations: README.md:231; scripts/check-suite.mjs (structure-only checks)
- quoted_snippets:
  - `The orchestration skills (\`csm-grill\`, \`csm-plan\`, \`csm-build\`, \`csm-bdd-tdd\`, \`csm-review\`) are single-file skills with no test suite; validate by invoking them.`
- explanation: README honestly discloses the five orchestration skills are test-free; check-suite verifies doc structure, never skill behavior. State-machine back-edges, journaling, write allowlists, and resume semantics have zero automated verification.
- impact: Behavioral regressions in the core CSM workflow are caught only by manual invocation.
- remediation_sketch: Add lightweight behavioral tests (template-contract, marker round-trip, state-chain vs journal fields) folded into check-suite.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [ops]

### F-064 · Upload/config hygiene lows: world-readable config, committed test TLS key, SVG publish, weak tamper oracle — low

- dimension: 7 | category: secrets & data exposure (CWE-732, CWE-798, CWE-79, CWE-345)
- anchor_ref: ASVS v5.0.0 V8; CWE-798
- severity: low | confidence: high | evidence_class: E2 (4 components, each challenged/agreed)
- locations: csm-upload/scripts/upload.mjs:102, 108, 336-340; bootstrap/fixtures/tls/key.pem:1; tests/package-audit.test.mjs:111-117
- quoted_snippets:
  - `await mkdir(dirname(CONFIG_PATH), { recursive: true }); await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');`
  - `const imgs = uploaded.filter(f => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(f.ext));`
  - `\-----BEGIN PRIVATE KEY-----` (literal PEM header as cited by the finding)
- explanation: Four merged lows: (1) upload.mjs creates ~/.agents/csm-upload.json with default modes (0644 in 0755 dir) — today stores only public info, but inconsistent with the repo's own 0600 norms; (2) csm-upload publishes unscreened files including script-capable .svg to a public github.io origin (challenger agreed: <img> context doesn't execute SVG scripts, but direct-URL navigation within the origin does — stored-XSS gadget); (3) an RSA test TLS key (self-signed localhost, valid to 2036) is committed at bootstrap/fixtures/tls/key.pem — conventional test-cert pattern, excluded from the npm artifact, but gitleaks-flagged on every clone; (4) package-audit's tamper test asserts only `error.code !== 0` — any incidental failure masks the property.
- impact: Local disclosure of future config credentials; stored-XSS gadget on the pages origin from attacker-supplied SVG; key-hygiene smell; tamper-evidence property regressible without detection.
- remediation_sketch: mkdir mode 0700 + writeFile mode 0600; drop 'svg' from accepted images or sanitize; generate ephemeral TLS keys at test runtime and purge key.pem from history; assert verification.ok === false in the tamper test.
- challenges: [challenger D2-9: AGREE (SVG) — vector real with direct-URL luring; challenger D2-10: AGREE (config modes) — claim true, impact minimal; challenger D1-7: AGREE (key.pem) — conventional pattern, low appropriate; challenger D2-5: AGREE (tamper oracle)]
- status: upheld | corroborators: [sec-root, tests-root]

### F-065 · Resilience lows: spawnGate error swallow, non-atomic NORMS write, claimPidFile unbounded retry, shallow top-level errors, pack temp leak — low

- dimension: 10 | category: reliability hygiene
- anchor_ref: ISO/IEC 25010 reliability
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/lib/docker.mjs:165; csm-scan/lib/scan/write.mjs:134-135; csm-browse/scripts/session-daemon.mjs:33-66; csm-browse/scripts/ensure-browser.mjs:641; scripts/pack-bootstrap.mjs:154-178
- quoted_snippets:
  - `proc.on('error', () => {});\n  proc.unref();\n  return proc.pid;`
  - `const content = finalizeMarkdown(lines);\n  await writeFile(outPath, content, 'utf-8');`
  - `for (;;) {\n    try {\n      const fh = await open(pidFile, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);`
- explanation: Five merged lows: spawnGate discards child spawn errors (diagnosis misdirected to "CDP not ready"); writeNORMS writes in place with a single writeFile (no tmp+rename, unlike the codebase's own pattern) — torn reports on failure or concurrent runs (concurrency finder independently converged); claimPidFile retries forever with no deadline when content-matched unlink keeps failing; both CLI entry points print only err.message, dropping stack/cause; packBootstrap cleans the npm cache in finally but leaves the /tmp staging dir on failure.
- impact: Misdiagnosed gate failures; corrupted/truncated NORMS on crash; silently hung daemon under pathological FS state; leaked /tmp payload copies on failed packs.
- remediation_sketch: Await spawn 'error' before returning pid; tmp+rename for writeNORMS; add a deadline to claimPidFile; print redacted err.stack with cause; clean the staging dir on failure paths.
- challenges: [primary-led (independence caveat); NORMS-write component corroborated ×2]
- status: upheld | corroborators: [resilience, concurrency]

### F-066 · (RETRACTED) api.mjs displayPath corrupts route paths when details.method is absent — retracted

- dimension: 1 | anchor: ISO/IEC 25010 accuracy
- original locations: csm-scan/lib/scan/render/api.mjs:27-29
- rationale: Challenger disproof: every route operation's signature is built by routeIdentity(normalizeMethod(method), path) — always `METHOD:path` — with details.method set to the same normalized string; no code path produces details.method === null. The `?? 'ANY'` fallback (length 3) aligns with a signature that always starts with the method, so slice(method.length+1) exactly removes the colon. The claimed corruption requires an unreachable signature/method mismatch.
- status: retracted | disproof: [challenger B2-1]

### F-067 · csm-browse low-severity cluster (15 components: lifecycle, secrets, concurrency hygiene) — low

- dimension: 1/2/3/4/7/8/9 | category: bundled lows (CWE-798, CWE-532, CWE-362, CWE-667, CWE-401)
- anchor_ref: ISO/IEC 25010 reliability; CWE-362/667/798/532
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/lib/recorder.mjs:59-70, 103-106, 199-224; scripts/browse.mjs:68-78; lib/cdp.mjs:8-15; lib/sweep.mjs:147-172; lib/constants.mjs:16-22; scripts/ensure-browser.mjs:163, 167, 299-314, 484; lib/verbs/log.mjs:216-220; lib/verbs/close.mjs:77-88; lib/cleanup.mjs:85-87; lib/collectors.mjs:31-42; lib/sweep.mjs:230-245; scripts/session-daemon.mjs:181-185, 215-229; lib/daemon-core.mjs:170-173
- quoted_snippets:
  - `const revealValues = args.includes('--values');`
  - `'-e', \`VNC_PASSWORD=${await ensureVncPassword()}\`, '-p', '127.0.0.1:5900:5900', '-p', '127.0.0.1:9222:9222', IMAGE];`
  - `await new Promise((r) => setTimeout(r, 300));`
- explanation: Fifteen low-severity components bundled (each primary-led-challenged):
  1. recorder.mjs:59-70 — on-disk "already recording" guard is unreachable dead code (`state.running && activeRecording` after activeRecording already checked); module reads as self-protected but is not.
  2. browse.mjs:68-78 — dynamic import maps any ERR_MODULE_NOT_FOUND (incl. broken installs) to "Unknown verb"; true missing module path never reaches the transcript.
  3. cdp.mjs:8-15 — library function getSession process.exit(2)s, skipping caller cleanup (WS close, redaction wrapper) and diverging from daemon attach-or-create behavior.
  4. sweep.mjs:147-172 — orphan daemon/ffmpeg passes validate sids outside per-line try/catch; one malformed pgrep line silently aborts the rest of the pass (container pass at 199-203 does it correctly).
  5. constants.mjs:16-22 — DOCKER_RUN_CMD hardcodes `~/.config/csm-browse/vnc-pass` while executed path uses homedir(); printed command can drift from executed argv.
  6. ensure-browser.mjs:167 — VNC password passed as literal `-e VNC_PASSWORD=<value>` in docker run argv (visible via /proc) and persists in container Env (docker inspect); challenger A2-10 AGREE — inconsistent with the codebase's own argv hygiene (CDP token via env).
  7. log.mjs:216-220 — `--values` prints full cookie values (incl. HttpOnly session tokens) to stdout where transcripts persist; masked by default with a warning, but the opt-out is a sharp footgun; challenger A2-11 AGREE ("by default" title wording corrected).
  8. ensure-browser.mjs:299-314 — port-pair lock released before the gate confirms bind; EADDRINUSE double-allocation mostly mitigated by the creating.marker written under the lock; challenger A2-9 AGREE (low-probability, self-healing).
  9. ensure-browser.mjs:484 — token rotation persists the rotated token before the old gate is killed; a killGate failure leaves a live gate serving the pre-rotation token (not fail-closed).
  10. ensure-browser.mjs:163 — shared container runs with no --memory/--cpus/--pids-limit/--shm-size; several concurrent session Chromiums aggregate pressure without a cgroup boundary.
  11. collectors.mjs:31-42 + recorder.mjs:103-106 — unbounded promise-chain write queues; slow disk or event bursts grow memory without cap or drop policy.
  12. recorder.mjs:199-224 + session-daemon.mjs:181-185 — cleanup can interleave with startRecorder between ffmpeg spawn and activeRecording assignment, orphaning ffmpeg until sweep's 10-minute age cutoff; the 5s force-exit timer can also truncate an in-flight result write (daemon-core.mjs:170-173).
  13. close.mjs:77-88 + cleanup.mjs:85-87 — releasePorts killGates the same public port again after the dir removal freed the pair; a fast concurrent creator's brand-new gate can be SIGTERM'd.
  14. sweep.mjs:230-245 — recorder.json multi-process read-modify-write; stale-reset can clobber a concurrently started recording's running:true.
  15. ports.mjs:60 — releasePortLock unlinks unconditionally, compounding the F-018 stale-break TOCTOU.
- impact: Transient availability loss, orphaned ffmpeg, misdirected diagnostics, transcript-persisted credentials under explicit opt-in, and drift between documented and executed commands — none individually critical, collectively a maintenance and hygiene tax.
- remediation_sketch: Await spawn errors before returning pid; revalidate sids per-line in sweep passes; single source for the VNC pass path; pass VNC password via env-file; add cgroup limits; bound write queues with a drop policy; set activeRecording before first await in startRecorder; drop the redundant releasePorts gate kill; make rotation kill-before-persist; add a per-session recorder lock.
- challenges: [primary-led (independence caveat); components 6, 7, 8 independently challenged and upheld]
- status: upheld | corroborators: [q-browse, sec-browse, concurrency]

### F-068 · Test-suite low-severity cluster (7 components: flakiness, seams, environment coupling, weak oracles) — low

- dimension: 13/14 | category: bundled lows
- anchor_ref: testsmells.github.io; Google flaky-tests 2016
- severity: low | confidence: medium | evidence_class: E3
- locations: csm-browse/tests/unit/auth.test.mjs:272-273; tests/unit/security.test.mjs:222; lib/docker.mjs:223; tests/e2e.mjs:32, 212; tests/serve.mjs:22; tests/package-audit.test.mjs:53, 103; tests/offline/offline.test.mjs:46; csm-upload/tests/upload.test.mjs:39-110; csm-scan/test/expansion-production-pipeline.test.mjs:280; expansion-baseline.test.mjs:117; expansion-determinism.test.mjs:212-231, 274-279; _smoke.test.mjs:23-39
- quoted_snippets:
  - `await new Promise((r) => setTimeout(r, 300));`
  - `export function setExecLayerForTests(layer) {`
  - `return '172.17.0.1';`
- explanation: Seven bundled lows: (1) fixed-sleep negative assertions (300ms/20ms) are the canonical flaky pattern — can pass when a slow tunnel is about to connect or fail under load; (2) setExecLayerForTests mutates a module-global exec layer from production code; a forgotten reset order-contaminates the next test file; (3) e2e/serve fall back to literal 172.17.0.1 and assume CDP 9222/9223 — podman/rootless/non-Linux environments silently skip or fail; (4) package-audit/offline spawn real tar/npm/npx with npm-version-specific cache behavior — environment-sensitive integration suites with no defined runner; (5) csm-upload happy-path publish (clone/commit/push) is never exercised — both tests stub git/gh; (6) weak assertions: typeof-export checks and a DETERMINISM_EVIDENCE digest that pins only itself; (7) the determinism suite re-implements the production sort key and asserts output equals a re-sorted copy of itself — partially tautological ordering check.
- impact: Machine-dependent test results; a regressible upload flow ships green; ordering and determinism guarantees are weaker than they look.
- remediation_sketch: Replace fixed sleeps with event-driven waits; move the exec seam to a test-only module; derive the bridge gateway at runtime; label npm-dependent suites as integration tier with pinned toolchain; add a real-remote happy-path upload test; drop typeof/self-digest assertions; import the canonical sort key from production.
- challenges: [primary-led (independence caveat)]
- status: upheld | corroborators: [tests-root, tests-scan]

### F-069 · Gate/docs low-severity cluster (6 components: asymmetric tooling, redundant gates, doc drift) — low

- dimension: 1/3/18 | category: bundled lows
- anchor_ref: eng-practices Documentation; SonarSource smells
- severity: low | confidence: medium | evidence_class: E3
- locations: scripts/sync-skill-boilerplate.mjs:82, 111, 141; scripts/hooks/pre-commit:41-42; bootstrap/runtime-commands.json:12, 43; README.md:111, 113; csm-build/SKILL.md:119-120; csm-scan/SKILL.md:8, 47
- quoted_snippets:
  - `if (!located) continue;`
  - `"offlineFlags": ["--offline", "--no"],`
  - `2. Check the plan's \`format:\` marker ... \n2. Detect and validate NORMS.md ...`
- explanation: Six bundled lows: (1) sync-skill-boilerplate --write silently skips missing sections — the repair command cannot repair the drift its own --check reports ("rewrote 0 section(s)", exit 0); (2) pre-commit gate 2 re-runs sync-skill-boilerplate --check that check-suite already executes internally — doubled commit latency; (3) the offline invocation grammar records a bare `--no` npx flag as load-bearing (npm documents no such flag; it is inert but removing it breaks three synchronized files); (4) README's two "universal bootstrap" bullets duplicate the same release-status claim verbatim — future drift hazard; (5) csm-build RECOVER has two "2." ordinals (sequence 1,2,2,3,4,5,6) — challenger E-4 AGREE, gate blind to list ordinals; (6) csm-scan intro sentence counts 7+7=14 dimensions against the authoritative 17 — challenger E-5 AGREE (no reading yields 17).
- impact: Repair tooling that cannot repair; doubled commit latency; a no-op flag enforced by tests; doc drift that no gate catches.
- remediation_sketch: Make --write insert the canonical section or fail loudly; drop the redundant pre-commit gate; replace `--no` with the specific negation it was meant to express; collapse the duplicated README claim; renumber RECOVER steps; rewrite the intro to name all 17 dimensions.
- challenges: [primary-led (independence caveat); components 5 and 6 independently challenged and upheld]
- status: upheld | corroborators: [q-root, ops]

## Adjudication Log

- F-066 RETRACTED: displayPath corruption unreachable (signature always `METHOD:path` by construction).
- F-005, F-026, F-043, F-045, F-046, F-049, F-053(CI component), F-033, F-034, F-035, F-036→F-039(severity adjustments), F-002 (merged F-002+F-022-prior): downgrades applied per challenger verdicts, with challenger rationales recorded in each finding.
- Merges (semantic, same root cause): F-045 (3 finders: shipped-bin hash-only + validator test-only + validator re-implemented in test → merged; severity medium after downgrades; confidence raised E3→high via 3-finder corroboration); F-008 (2 finders); F-009 (2 finders + challenger); F-024 (finder + prior F-021); F-031 (2 finders + prior F-024); F-050 (2 finders + challenger new finding); F-051 (2 finders); F-053 (2 finders; CI component downgraded); F-064 (4 low components); F-065 (5 low components); F-060 (host-Node component recorded in Methodology as environmental, not a repo finding).
- No severity averaging across merges; merged records carry the max severity with per-component verdicts listed.
- Corroboration bumps (E3→high, independent ≥2 finders): F-008, F-009, F-045, F-050, F-051, F-053, F-031, F-065 (NORMS component).
- Low/info findings carried primary-led challenge with recorded independence caveat (per FULL scale: low findings challenged by primary; critical/high/medium all independently challenged — 100% coverage; 2 challenger-new findings added).

## Retracted Findings

- F-066 — see Adjudication Log; disproof: signature always `METHOD:path` by construction (routeIdentity(normalizeMethod(method), path)); `?? 'ANY'` aligns with the prefix; slice trims exactly the colon. No reachable input corrupts the path.

## Reproducibility

- Pinned SHA: 61445e67c4961162c5f2b1ef8d57b4a248e7763a (worktree == SHA, clean except the report scaffold created by this review).
- Tools: node v20.20.2 (host), git, curl; commands: OSV `POST https://api.osv.dev/v1/querybatch` (67 pinned npm versions — 0 advisories); `GET https://endoflife.date/api/nodejs.json` (Node 20 EOL 2026-04-30 past; 22 EOL 2027-04-30 supported; 24 active LTS; 26 current); `git show 61445e6:...` / direct file reads for all citations.
- Evidence artifacts: /tmp/opencode/csm-review-osv/query.mjs (OSV batch script), /tmp/opencode/node-eol.json (endoflife payload).
- Sandbox: none (R0 only; no R1-R3 runs — user did not accept).
- Anchor spot-checks: OWASP Top 10:2025 verified reachable (redirect → /2025/en/). ASVS v5.0.0, ISO/IEC 25010:2023, CWE Top 25 2025, Fowler, SonarSource, eng-practices, testsmells, Google flaky-tests 2016, SPDX — recorded as listed editions; not individually fetch-verified (R0 budget).
- Finder/challenger tooling: 14 finder sessions + 8 challenger sessions + 1 remediation-verifier session (subagent transcripts not persisted; verdicts recorded in findings above).
- Prior-review cross-reference: 2026-08-15 review at a650305 — 57 findings verified at 61445e6: 52 remediated, 3 partial (F-027 coverage-gate-not-in-CI → F-042/F-053; F-028 SUT-to-SUT → F-056; F-049 zero-automation → F-053), 4 unresolved (F-021 → F-024, F-022 → F-002, F-023 → F-055, F-024 → F-031).
