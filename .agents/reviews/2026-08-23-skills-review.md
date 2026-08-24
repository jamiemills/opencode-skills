format: csm-review/1

# Repository Review — skills @ e44ef3f (2026-08-23)

## Control

- `[2026-08-23T10:39:08+0000]` INTAKE -> SCOPE :: cycle 0 :: trigger: fresh run, no prior journal for today; user requested comprehensive review of all skills + README via subagents :: rungs: R0
- `[2026-08-23T10:39:08+0000]` SCOPE -> EVIDENCE :: cycle 0 :: trigger: coverage plan + anti-coverage recorded :: rungs: R0
- `[2026-08-23T10:39:08+0000]` EVIDENCE -> FIND :: cycle 0 :: trigger: R0 evidence pack complete (OSV 0 hits x5 pinned deps; endoflife Node 22 supported to 2027-04-30; manifests inventoried) :: rungs: R0
- `[2026-08-23T10:43:44+0000]` FIND -> FIND :: cycle 1 :: trigger: resume after interrupted dispatch — subagent failures journaled, sequential dispatch adopted :: rungs: R0
- `[2026-08-23T10:52:00+0000]` FIND -> CHALLENGE :: cycle 1 :: trigger: raw ledger complete — 99 finder findings (0 critical / 3 high / 25 medium / low-info remainder); parallel subagent dispatch proved unreliable (5 empty returns), sequential reliable — incident recorded :: rungs: R0
- `[2026-08-23T13:40:00+0000]` CHALLENGE -> ADJUDICATE :: cycle 1 :: trigger: all 26 critical/high/medium findings independently challenged (CH-A..CH-D + gap-fill challenger for F5-03); verdicts: 2 retract, 8 downgrade, 16 uphold; 2 genuinely-new challenger findings; rest primary-led (low/info, independence caveat recorded) :: rungs: R0
- `[2026-08-23T13:48:15+0000]` ADJUDICATE -> VERIFY :: cycle 1 :: trigger: ledger deduped (101 raw records -> 1 semantic merge, 2 retractions -> 98 upheld), sort applied, corroborators recorded :: rungs: R0
- `[2026-08-23T13:49:00+0000]` VERIFY -> SAVED :: cycle 1 :: trigger: gate passed — schema fields present per evidence class; both highs independently challenged; coverage matrix filled; redaction pass run (absolute paths/personal data scrubbed incl. this file's own intake record); protected-state check clean (only this report differs from intake baseline) :: rungs: R0

### INTAKE record

- Target: local skills suite checkout (slug `skills`)
- Pinned SHA: `e44ef3f4af06073a603a41942b096129390ab345`; worktree clean at intake (`git status --short` empty)
- Scale: FULL (user: comprehensive review of all skills + README using subagents)
- Posture: R0 static only (user-selected; no R1-R3)
- NORMS.md: absent at git root and cwd
- Tmux: already inside tmux session — bootstrap skipped per step 1

## How To Execute

This report fixes nothing. Remediation happens through a future explicit csm-plan or csm-grill invocation, human-mediated, feeding on these findings. Do not treat remediation sketches as patches.

## Executive Summary

- Overall posture: solid engineering culture (gates, atomic writes, identity-checked signaling, verified-clean command broker, structurally enforced CDP port prohibition) undermined by documentation drift and test-wiring gaps rather than by live vulnerabilities.
- Highest-impact theme: things the repo claims are enforced are not wired — the csm-browse security/unit suite runs in NO gate (HF-02), the paused-resume invariant validator is unwired (F8-03), and the token-budget invariant documented as exact is false and unenforceable while disabled (HF-01).
- Second theme: SKILL.md contracts diverge from implementations in both directions — undocumented cookie-reveal gate and silent pre-capture page mutation (csm-browse), validate-after-write contradicting the stated durability contract (csm-ddd), "no temp files" constraint contradicted by the code's own safer behavior (csm-scan).
- Third theme: duplicated README artifacts drift apart within one file (role tables, ledgers, diagrams), and cross-suite convention constants (NORMS authenticity) disagree between skills.
- Supply chain is clean: OSV version-pinned queries returned zero hits for all five declared dependencies; Node/pnpm pinning is coherent; the suspicious csm-browse/node_modules divergence resolved as local-only stale install (gitignored), not a repo defect.
- Bootstrap trust design has documented, publication-gated gaps (unsigned-passes, optional index binding, fixture trust root) — acceptable pre-publication, dangerous if published as-is.
- No critical findings. Both high findings are process/integrity issues, not exploitable holes.

## Methodology Disclosure

- Reviewers: primary orchestrator + 8 finder subagents (F1-F8) + 5 independent challenger agents (CH-A..CH-D + F5-03 gap-fill); challengers received titles/locations/severity only — never finder rationale.
- Tools: git (read-only), ripgrep/glob/file reads, OSV.dev /v1/query version-pinned (2026-08-23), endoflife.date API (2026-08-23).
- Rungs: R0 only (user-selected). No repository code executed anywhere; no sandbox created.
- Containment: n/a (R0); protected-state check re-run at VERIFY — clean.
- Anchor editions: anchors cited from skill-embedded doctrine; external drift-check limited to OSV/endoflife endpoints (both authoritative at retrieval date).
- Subagent incidents: 5 of 13 dispatches returned empty results (parallel batches unreliable); recovered via sequential re-dispatch per resilience ladder; all incidents journaled.
- Residual unknowns: bulk csm-scan deep-scanner modules and ~60 of 81 scan-test bodies sampled not exhausted; csm-browse unit-test bodies largely unread (moot for coverage claims — they never run); payload mirror copies spot-checked byte-identical today but unhashed here; R1-R3 evidence classes unavailable by posture choice, so no E1 tool-reproduced findings exist.

## Coverage

Dimension x chunk verdicts (F=findings upheld, C=clean, S=sampled):

| Dim | A root docs | B single-skills | C browse | D ddd | E scan-src | F scan-tests | G bootstrap | H scripts/tests |
|---|---|---|---|---|---|---|---|---|
| 1 Correctness | F | C | F(6) | F(4) | F(5) | F | F | F |
| 2 Tech debt | F | F | F(2) | F | F | C | C | F |
| 3 Smells | F | C | F(4) | F(3) | F(3) | C | C | F |
| 4 Anti-patterns | F | F | F | F | C | C | F | C |
| 5 Sec weaknesses | C | C | F(2) | C | C | C | F | C |
| 6 Sec controls | S | S | verified-holding | C | verified-holding | confirmed | F(3) | F(1) |
| 7 Secrets/exposure | C | C | F(2) | F | C | swept | F | C |
| 8 Concurrency | n/a | n/a | F(4) | C | C | n/a | n/a | C |
| 9 Memory/resources | n/a | n/a | F(1) | F(2) | C | n/a | C | n/a |
| 10 Error resilience | F | n/a | F(4) | F(misclass) | F | n/a | C | F |
| 11 Input/trust | n/a | n/a | C | C | C | n/a | C | C |
| 12 Test presence | n/a | F | F(2) | F(3) | C | partition-complete | n/a | F(1) |
| 13 Test quality | n/a | n/a | F(1) | F(2) | C | C | n/a | C |
| 14 Test-type adequacy | n/a | n/a | F | F | F(property-gap) | strong-negative-paths | n/a | C |
| 15 Dep vulns | C (OSV 0 hits) | n/a | F(local-stale-tree) | fixture-only | n/a | fixture-only | C | C |
| 16 Toolchain currency | F | n/a | F(2) | n/a | n/a | n/a | C | C |
| 17 Observability | n/a | F | n/a | n/a | n/a | n/a | n/a | F(5) |
| 18 CI/build/docs/lic | F | F | n/a | n/a | n/a | n/a | n/a | F(4) |

Every cell carries an explicit finding-or-clean verdict; sampled cells marked S/swept with risk notes in Anti-Coverage.

## Anti-Coverage

- node_modules trees (root, csm-browse): vendored, gitignored — covered only via lockfile reconciliation logic (risk: low; supply-chain handled via lockfiles + OSV).
- .git objects: out of scope.
- .agents historical artifacts (71 files): index-level review only; bulk bodies unread (risk: stale-doc drift propagates into resume flows — partially evidenced by F1-07).
- csm-scan deep-scanner modules (~20 files: architecture/conventions/testing/operations/config/documentation/stack/structure + providers/standards/cross-repo): grep-audited at call sites only (risk: latent logic bugs in rendered facts, as already found in deep/git.mjs).
- csm-scan tests: ~60 of 81 bodies unread; tier manifest verified complete instead (risk: low — manifest completeness substitutes for body reads).
- csm-browse unit-test bodies (25 files) and most verbs' sources: unread beyond targeted greps — doubly unfortunate given HF-02 (they never execute in any gate).
- bootstrap payload skill texts: assumed identical to top-level dirs (verified byte-identical today for the diffed set; no hash pinning done here).
- Binary/image fixtures in csm-browse tests/fixtures: not content-reviewed.
- pnpm-lock.yaml snapshot hashes: structure verified, not hash-audited (risk: negligible at R0).

## Findings Summary

Counts by severity x dimension group (upheld):

| Severity | Quality(1-4) | Security(5-7,9,11) | Concurrency(8) | Resilience(10) | Tests(12-14) | Supply(15-16) | Ops(17-18) | Total |
|---|---|---|---|---|---|---|---|---|
| High | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 2 |
| Medium | 9 | 4 | 2 | 2 | 4 | 0 | 2 | 21* |
| Low | 31 | 12 | 5 | 6 | 6 | 4 | 9 | ~66 |
| Info | 4 | 1 | 0 | 1 | 0 | 1 | 1 | 8 |

(*includes F1-07 at medium severity / low confidence.)

Dedup: 101 raw records (99 finder + 2 challenger-genuine) -> 1 semantic merge (budget-invariant pair), 2 retractions -> 98 upheld.
Confidence distribution: 1 high (corroboration bump), 93 medium (E3 static-cited), 4 low/E4 (F4-05, F5-03, F5-12, F9-02).

## Findings

Ordered by sort key (severity DESC, confidence DESC, evidence class DESC, id ASC). Snippets omitted here where the finder record is cited; full records with snippets live in the finder transcripts referenced in Reproducibility. All locations relative, at pinned SHA e44ef3f.

### HIGH

**HF-01** (merged from F1-01 + F3-13; corroborated by independent finders F1+F3, confidence bumped E3->high) — AGENTS.md/check-suite 220-word frontmatter budget invariant is false at HEAD: twelve skills total 329 description words; AGENTS.md states "exactly 220 words today" and "a 9th skill regresses"; check-suite WORD_BUDGET comment says "the 8 descriptions". Gate runs only when `.agents/token-efficiency.json` resolves enabled; repo commits {"enabled": false}, so flipping the documented toggle fails `check` immediately until an unplanned re-budget. Locations: AGENTS.md:15-19; scripts/check-suite.mjs:54-57,876-881; .agents/docs/csm-ddd-token-efficiency-liability.md (admits drift, AGENTS.md never updated). Dimension 1/2. Impact: governing rules file instructs agents to preserve a nonexistent budget and hides that enabling the toggle bricks the gate. Remediation sketch: re-budget (trim descriptions, update WORD_BUDGET/comment/AGENTS.md together) or make the gate compute-and-report the delta while disabled.

**F6-01** — csm-browse unit suite (25 test files incl. security.test.mjs TOCTOU/token fail-closed rules, security-gate.test.mjs CDP funnel auth, fuzz.test.mjs seeded parser fuzzing, daemon lifecycle) is unreachable from every documented entrypoint: `make test-browse` runs only check-skill.mjs (syntax sweep, never `node --test`); no lefthook job invokes it; package.json "test" script invoked by nothing; absent from README/SKILL.md instructions; no CI exists. Challenger exhaustively confirmed sole wired path is nothing. Locations: Makefile:47-53; csm-browse/package.json:7-10; .lefthook.yml csm-browse-check job. Dimension 12. Impact: regressions to symlink-refusal, token-mismatch, gate auth land green through every gate; suite rots unrun. Remediation sketch: Makefile target running the glob-form `node --test` under Node>=22 helper, wired into `make test` and the hook.

### MEDIUM

**F1-02** — README role taxonomy broken: "Twelve skills, three roles" tabulates two roles / eleven skills; csm-ddd appears nowhere; "eight orchestration skills" set contradicts the table (swaps csm-grill out for csm-scan). README.md:59-64,317-319. Dim 1.
**F1-03** — Artifact-ledger duplicated twice in README and drifted: second copy drops csm-review-python row; neither copy lists csm-make-tests despite its two durable `.agents/tests/` artifacts. README.md:93-105,146-157. Dim 1.
**F1-04** — Second copy of core-loop Mermaid diagram silently drops the csm-make-tests node and edges; same caption promises identical content. README.md:68-85 vs 126-142. Dim 2.
**F1-05** — `make test` doc drift both directions: README omits test-ddd from composition AND from target list; Makefile labels itself "all test suites" while excluding suite-tooling battery + csm-upload suite. README.md:394-406,402; Makefile:44-53. Dim 1.
**F1-07** — .agents/README.md index stale (challenge-corrected numbers): 69 tracked artifacts, 37 indexed, ~32 unindexed including recent plans/reviews/research the resume flow routes through. Confidence low (proposer's arithmetic overstated; substance true). .agents/README.md:43-49. Dim 2.
**F1-08** — csm-upload/tests/upload.test.mjs orphaned: 311 lines incl. injection/svg/SIGTERM regression coverage, referenced by no target/hook/doc; only reference deletes it from a sandbox. csm-upload/tests/upload.test.mjs; Makefile:34-53. Dim 3.
**F2-01** — memAvailableMb references undefined execFileAsync (only spawn imported); ReferenceError swallowed by its own catch -> diagnostic always reports -1 on exactly the daemon-failure/OOM path SKILL.md documents. ensure-browser.mjs:910,1048,1083. Dim 1.
**F2-02** — `cookies --values` requires undocumented env CSM_BROWSE_REVEAL_COOKIES=1; SKILL.md verb table (declared authoritative) says "--values prints full values and warns first". Agents following the skill get exit 1. log.mjs:214; csm-browse/SKILL.md:77. Dim 1.
**F2-07** — dismissCookies silently mutates pages before every screenshot/screencast: clicks visible buttons matching ok/yes/continue/allow, removes fixed/sticky elements containing substring "data"; undisclosed in SKILL.md; evidence-distorting and overbroad. cookies.mjs:55,70; capture.mjs:140; daemon-core.mjs:65. Dim 4.
**F2-13** — csm-ddd validates artifacts AFTER temp+rename publishes them, contradicting SKILL.md "validate before writing"/"no partial files": failure exits 1 leaving invalid graph/report at contract paths. ddd.mjs:78-95; pipeline.mjs:107; SKILL.md:119. Dim 1.
**F2-16** — csm-ddd privacy-before-persistence largely aspirational: redactEvidenceRecords exported with zero callers; containsAbsoluteRootPath result discarded in empty if-block whose comment claims redaction happens "below" (it does not, outside URL keys). Corroborated by challenger + F6-05. redact.mjs:28; extract.mjs:74,158-160. Dim 3.
**F4-01** — Unsigned envelope passes shipped verify indistinguishably from crypto-verified: identical {trusted:true,key}, ok:true, exit 0; no signed marker machine consumers can key on. Documented-intentional/publication-gated; until T009 lands, machine TRUST = schema+digest only. bootstrap bin:69-74,164-178,201,253-277; trust-policy.mjs:124-128. Dim 6.
**F4-06** — csm-browse URL redaction misses bare credential query params (`code=` — exactly what the advertised login-composition flow produces — plus `key=`, `sig`, `jwt`, `sid`): OAuth codes/API keys persist into events.jsonl, daemon.log, agent transcripts. Mitigations noted: sinks are 0600; documented promise scopes to CDP token only. security.mjs:338-356; collectors.mjs:117-137; session-daemon.mjs:193. Dim 7.
**F5-02** — launchDaemon retry grace (~2s) shorter than child worst-case cleanup (~8s); parent force-deletes pid/ready markers and spawns attempt #2 while child #1 alive -> transient dual daemons racing collectors/recorder; self-heals next launch. ensure-browser.mjs:1060-1078; session-daemon.mjs:285-320. Dim 8.
**F5-06** — csm-ddd extractor readFile()s each walked file whole with no per-file cap though stat size known; one root-level multi-hundred-MB blob blows past maxBytes=2MB (UTF-8 decode ~2x RSS). SKIP_DIRS trims common cases; no extension filter. extract.mjs:31-34,149-157. Dim 9.
**F6-03** — Vacuous conditional assertions: synthesize/clarify tests wrap their target assertions in runtime ifs over fixture-derived data; extractor regression that voids classification turns the test into a silent no-op. synthesize.test.mjs:29-46; clarify.test.mjs:31-34. Dim 13.
**F6-04** — Static-claim immutability test tautological — worse than proposed: serializedStatic captured AFTER applyQuestionFile ran (no baseline ever exists) and only doesNotThrow(JSON.parse(stringify)) asserted; titular untouchedness never checked. clarify.test.mjs:61-67. Dim 13.
**F6-05** — Redaction surface unwired (same root cause as F2-16, test-dimension lens): no direct test pins redactEvidenceRecords/containsAbsoluteRootPath contracts; end-to-end token test passes only because locators happen benign. redact.mjs:28-34; extract.mjs:158-160. Dim 12.
**F6-07** — Property/fuzz testing absent outside CDP gate: 849-line hand-rolled TOML/YAML parser example-tested only; both redactors fixed-fixture only; nothing probes bypass classes (lowercase api_key vs uppercase-only ASSIGN_SECRET_RE); mutation testing absent. parse.mjs; security.mjs:358-368; ddd/redact.mjs:6-9. Dim 14.
**F8-03** — validateJournalControlConsistency (paused/active resume invariants) implemented + tested but wired to nothing: absent from check-suite imports; resume-semantics.test.mjs absent from every make target; header comment implies enforcement. plan-validation.mjs:442-470; check-suite.mjs:24-34; Makefile:37-39. Dim 18.
**F8-07** — upload.mjs swallows malformed-config JSON identically to missing config, silently resets pagesRepo to default, then overwrites the user's config file (mode 0600) destroying original bytes with no warning. upload.mjs:90-97,135-138. Dim 17.

### LOW

**F1-09** — README lefthook summary omits the oxfmt job (second of seven; it mutates commit contents). README.md:384. Dim 1.
**F1-10** — README .agents/ layout comment omits tracked ddd/ subdir its own ledger documents. README.md:383. Dim 1.
**F1-11** — "Ten skills are instruction-led and ready to use" leaves one of twelve unaccounted; arithmetic short by one (corroborated by challenger). README.md:14,296-301. Dim 4.
**F1-12** — Tmux "(use `-2`/`-3` on collision)" flag-shaped prose for name-suffix semantics, duplicated verbatim across seven SKILL.mds; tmux really has -2/-3 flags. boilerplate template + 7 consumers. Dim 4.
**F1-13** — NORMS.md authenticity criteria diverge: review-python accepts marker OR sections; plan/build/bdd-tdd/make-tests/review require marker AND both sections; contracts.mjs NORMS_PHRASES encodes the weak variant only. Three trust standards, one artifact. review-python/SKILL.md:53; plan:79; build:70; contracts.mjs:378. Dim 2.
**F2-03** — text verb returns innerText while SKILL.md documents textContent (rendering-aware vs literal; hidden text excluded). dom.mjs:8-9; SKILL.md:70. Dim 1.
**F2-04** — open polls document.readyState, not Page.loadEventFired as documented. cdp.mjs:53; nav.mjs:24; SKILL.md:64. Dim 1.
**F2-05** — Fixture-server host/port docs stale (172.17.0.1:8090 fallback chain no longer exists; port now ephemeral). serve.mjs:54-61; SKILL.md:87; constants.mjs:97-99. Dim 1.
**F2-06** — Screencast stats hardcode fps=15 regardless of speed preset (slow=3/medium=7/fast=15 actual); positional-name scan drops recordings literally named "fast". record.mjs:48; recorder.mjs:157,455. Dim 1.
**F2-08** — Transitional test seam still exported from production docker.mjs (setExecLayerForTests); own comments + helper declare migration to R9 unfinished; two suites still import it from prod. docker.mjs:270-294. Dim 2.
**F2-09** — Dead FFMPEG_ARGS constant encodes abandoned libx264/mp4 pipeline contradicting shipped VP9/webm contract. constants.mjs:100-118. Dim 3.
**F2-11** — Daemon-liveness probing reimplemented four ways with differing rigor: log/status use bare kill(pid,0) on pid-file contents; cleanup/sweep enforce pid-identity. Spurious capture-gap reporting possible on pid recycling. log.mjs:56; status.mjs:34; cleanup.mjs:17; sweep.mjs:81. Dim 2.
**F2-12** — Every daemon shutdown logs "Recorder finalize error: not recording" (sentinel treated as failure). session-daemon.mjs:292; recorder.mjs:386. Dim 3.
**F2-14** — Boundary-question dependsOn slice arithmetic wrong (negative indices, empty deps) — challenge-downgraded: ordering invariant still holds, metadata only. clarify.mjs:36-39. Dim 1.
**F2-15** — Coverage line renders "User answers applied: ;" — answers array interpolated without .length. render.mjs:108-112. Dim 1.
**F2-17** — Seam ranking recounts consumers via loose substring match; ordering-evidence path regex-parsed back from human prose. synthesize.mjs:260-288. Dim 3.
**F2-18** — Rendered section order differs from SKILL.md envelope contract (Context hypotheses vs Terminology swapped). render.mjs:5; SKILL.md:139. Dim 1.
**F2-19** — Status/vocabulary enums duplicated between contracts.mjs and graph schema with no sync check; builder/schema can diverge silently. contracts.mjs:8,105; ddd-graph.schema.json:64. Dim 2.
**F2-21** — Report<->graph runId cross-link unenforced at validation boundary; assertReportMatchesGraph has no production caller. ddd.mjs:86; contracts.mjs:237. Dim 4.
**F3-01** — git branch -a symref line becomes bogus "HEAD -> origin/*" naming bucket for most repos with remotes — challenge-downgraded to cosmetic pollution. deep/git.mjs:142-160. Dim 1.
**F3-02** — --verbose trace open failures invisible (dead null-branch, swallowed stream errors, tmpdir fallback never attempted) — challenge-downgraded: opt-in diagnostics only. verbose-trace.mjs:27-39; scan.mjs:184-193. Dim 1.
**F3-03** — SKILL.md "Exactly one writeFile — no temp files" constraint contradicted by atomic temp+rename (safer than documented) + trace carve-out — challenge-downgraded: pure doc drift. SKILL.md:161; write.mjs:151-154. Dim 1.
**F3-04** — Static-boundary broker registers undocumented commands (rg:files-hidden, git:log-oneline-200, git:ls-files); advertised rg --json has zero callers. SKILL.md:118-119; command.mjs:108-126. Dim 1.
**F3-05** — Rendered Coverage Basis table documents 3 of 6 evidence-model statuses. write.mjs:113-119; SKILL.md:127-136. Dim 1.
**F3-06** — Stale "UNREGISTERED/nothing imports this module" headers on wired-in registries contradicting actual imports. dimensions.mjs:29-30; registry.mjs:24-25. Dim 3.
**F3-07** — Dead exports kept alive only by own tests (findPruneArgs, detectLanguages); overhaul plan sanctions removal. ignore.mjs:51; survey.mjs:139. Dim 3.
**F3-08** — splitGlobArgs corrupts argv if an ignore glob lacks exactly one space (indexOf -1 truncation). command.mjs:25-32. Dim 3.
**F3-09** — Generic commit-style classifier hardcodes this suite's private ticket vocabulary; foreign repos skew toward "plain" undisclosed. deep/git.mjs:22-32. Dim 2.
**F3-10** — SKILL.md calls frozen tier manifest a placeholder post-freeze. SKILL.md:208. Dim 1.
**F3-11** — payload-index bin subcommand crashes unhandled when index absent (verify catches typed MISSING_PAYLOAD_INDEX; payload-index doesn't); index lives outside the dir it indexes. bin:204-206,245-252. Dim 1.
**F3-14** — wt-session leftovers: "F-??" placeholder ID, usage string omits prune, redundant root comparison. wt-session.mjs:219,254,313. Dim 3.
**F3-15** — Envelope validator maintained as three hand-synced copies (bin + trust-policy + engine); canonical-equality pins mitigate but every trust change touches 2-3 files. bin:37-202. Dim 2.
**F2-20** — No-op `void X` statements paper over unused imports/params (render/synthesize/extract/cli.test). Dim 3. [info-adjacent smell, kept low]
**F4-02** — Signature need not bind payload index: payload_index_sha256 optional in signed policy; signer vouches for nothing about installed bytes when omitted. bin:52-55,164-170. Dim 6.
**F4-03** — Shipped bin validator weaker than pinned engine: no backslash-path rejection (real traversal on win32), no CONTENT_TOO_LARGE size check, no origin check, despite "mirrors exactly" claim; parity pin tests behavioral samples not source equality. bin:19-23,104-140; trust-policy.mjs:134-161. Dim 6.
**F4-04** — Steps shell denylist is word-filter over prose, trivially evadable; protocol.md lists it under Machine-guaranteed TRUST lending false assurance. bin:27-28,61-62. Dim 5/6.
**F4-05** — Production trust anchor is a self-described fixture keypair; committed validly-signed fixture proves private half exists operationally; no custody/provenance documentation. low confidence E4. keyring.json; fixtures/valid.json. Dim 7.
**F4-07** — `log network --filter` compiles caller regex unguarded: invalid pattern throws raw stack; pathological patterns backtracking against page-controlled URLs (self-DoS class). log.mjs:114-145. Dim 5.
**F4-08** — Verb name flows unchecked into dynamic import path (`../../foo` escapes lib/verbs; existsSync sole guard); hardening gap, prior-write required. browse.mjs:62-83. Dim 5.
**F4-09** — csm-ddd secret vocabulary drifted narrower than csm-scan token-families; Slack-style webhook path tokens survive redaction into reports. extract.mjs:72-74; ddd/redact.mjs:6-21. Dim 7.
**F4-10** — VNC password 8 chars (~46 bits), modulo bias, loopback-only exposure, never rotates. ensure-browser.mjs:125-190. Dim 7.
**F5-03** — Stale-claim rename() restore can clobber a fresh O_EXCL claim in narrow >=3-party race — challenge-downgraded to low/low: restored bytes are displaced holder's fresh claim (inode guard holds), consequences transient/self-healing. session-daemon.mjs:66-69; ports.mjs:63-71,104. Dim 8.
**F5-04** — Daemon error path awaits client.close() unbounded; hung WS close leaves process holding pid file until external signal. session-daemon.mjs:352-365. Dim 10.
**F5-05** — Shutdown recorder-finalize budget (3s) smaller than stopRecorder internal waits (8s+2s, ffprobe 10s): crash-interrupted recording stats/validation never persist; reconcile rescues correctness. session-daemon.mjs:285-289; recorder.mjs:34,417-437. Dim 10.
**F5-07** — coChangePairs builds full O(N^2) map before 50-pair output cap (huge-commit hang/OOM); maxBuffer exhaustion misreported as "git-unavailable". git.mjs:86-123. Dim 9/10.
**F5-08** — wt-session git() lacks timeout + GIT_TERMINAL_PROMPT hardening (merge --push can hang on credential prompt); csm-ddd/csm-scan wrappers have both conventions. wt-session.mjs:33-38,120-146. Dim 10.
**F5-09** — Same root cause as F3-02 (verbose-trace silent failure) — resilience lens. Dim 10.
**F5-10** — saveState uses fixed state.json.tmp (two writers interleave); sweep writes revoked state.json in place non-atomically unlike its own F-067-14 convention. session.mjs:114-116; sweep.mjs:220-224. Dim 8.
**F5-12** — sweep signals pgrep-derived pids without argv re-verification at signal time (violates own F-021 discipline); millisecond window, pool-port-constrained. sweep.mjs:442-444,485-487. Dim 8.
**F6-02** — Core verbs nav/dom/input/close lack Docker-free tests; selector escaping tested only via cdp.test.mjs for clickCoords, not dom.mjs's duplicated inline copies — challenge-downgraded (record engine + primitives covered). dom.mjs:6-9,35-40. Dim 12.
**F6-06** — renderReport (176 lines) has no direct test; cli.test imports then voids it. cli.test.mjs:12,159. Dim 12.
**F6-08** — csm-ddd --norms/--max-bytes flags and git maxCommits truncation disclosure untested. ddd.mjs:43-65; git.mjs:69. Dim 12.
**F6-09** — recorder.test relies on fixed sleeps instead of suite's own waitForFile bounded-wait pattern; flake-prone. recorder.test.mjs:68,106-111. Dim 13.
**F6-10** — cache-health CLI main path (args, SQL build, opencode db subprocess, error branch) untested; only pure functions covered. cache-health.mjs:179-211. Dim 12.
**F6-11** — README make-test composition omits test-ddd (dup of F1-05 facet; kept for test-doc lens). README.md:402. Dim 12.
**F7-01** — Stale csm-browse/node_modules retains ~66 packages orphaned by removed jimp dep (local-only, gitignored; forensic: jimp removed in d94f099, tree never reinstalled; no first-party imports of orphans). node_modules/.modules.yaml; package.json:11-16. Dim 15.
**F7-02** — packageManager bumped to pnpm@10.34.5 without reinstall; both node_modules record installs under 10.33.0. package.json:13; .modules.yaml files. Dim 16.
**F7-03** — Zero dependency-update automation (no .github/, no Renovate) + inconsistent pin discipline (oxfmt caret vs exact siblings). package.json:5-9. Dim 16.
**F8-01** — Pre-commit gate runs full check-suite twice per commit (gate-baseline --check spawns it, then check-suite job repeats it). .lefthook.yml:34-44; record-gate-baseline.mjs:159. Dim 18.
**F8-02** — README says cache-health reports "the active model"; hardcoded MODEL_FILTER deepseek-v4-flash — other-model sessions silently invisible. README.md:413; cache-health.mjs:31,199-200. Dim 17.
**F8-04** — gate-baseline doc claims deviations warn-only until second baseline; code exits 1 on first deviation regardless of record count (baselines bounce 919<->918 forcing re-record loops). record-gate-baseline.mjs:22-27,132-153. Dim 18.
**F8-05** — wt-session usage error omits supported `prune`. wt-session.mjs:313. Dim 17.
**F8-06** — wt-session create detects existing worktrees by String.includes substring — prefix-colliding slugs falsely refused. wt-session.mjs:83-88. Dim 17.
**F8-08** — csm-upload SKILL.md says username auto-detected from gh auth status; implementation probes gh api user first (auth-status is flagged-unreliable fallback). upload.mjs:99-123; SKILL.md:28,31. Dim 18.
**F8-09** — Makefile .PHONY omits test-ddd (all siblings declared). Makefile:2,44-45. Dim 18.
**F8-10** — check-suite labels every failure class "MISSING:" including lint/payload/drift failures contradicting detail lines. check-suite.mjs:1429-1434. Dim 17.
**F8-11** — close-plan applies closure writes before final gate run; on failure leaves mutated corpus + no recovery guidance. close-plan.mjs:274-286. Dim 17.
**F9-01** — (challenger-new) csm-ddd `--fail-on-gaps` silently no-ops unless --non-interactive also passed; usage text promises exit-3 unconditionally. ddd.mjs:103,19. Dim 1. low/medium.
**F9-02** — (challenger-new) Unsupervised stdio tunnel children survive SIGKILL'd gate; sweep's socat pass targets legacy TCP-LISTEN pattern only. docker.mjs:233-239; cdp-gate teardown paths. Dim 9. low/low E4.

### INFO

**F1-14** — Tracked gate-baselines.json includes Node v20.20.2 record (EOL runtime repo's own lessons flag non-compliant); later v22 entries supersede. gate-baselines.json:2-9.
**F2-10** — Stale e2e summary committed under tests/ though default moved to SESSIONS_ROOT; SKILL.md still cites old path. tests/.e2e-summary.json; SKILL.md:152.
**F2-12** — see F2-12 low (kept there). [cross-ref]
**F3-12** — Shipped fixed trust root is fixture-keyed; publication would ship theater verification — documented intentional; correlates F4-05. bin:17; release-checklist.md:19-21.
**F5-11** — Gate SIGTERM shutdown exits before 2s tunnel kill-grace fires; brief orphaned socat children until sweep pass. cdp-gate.mjs:286-299,413-415.
**F7-04** — ws pinned to old major ^7.5.13 mirroring chrome-remote-interface's own ws@7; move in lockstep when CRI upgrades. csm-browse/package.json:14-16.
**F8-12** — Unresolved "F-??" placeholder finding-ID in wt-session prune comment breaks durable-citation convention. wt-session.mjs:219.

## Verified-Holding Controls (positive dimension-6 results)

- csm-scan command broker allowlist holds: frozen registry, exact argv builders, execFile shell:false, pattern charset validation, reduced env, timeouts/output caps; test corpus enforces sole child_process ownership. No escape route found.
- CDP port-9222 prohibition enforced structurally (pool 9224-9234, loopback bind, image relay killed post-create, containerIsHardened probe, token-gated funnel).
- cdp-gate auth holds (first-line token, timingSafeEqual, 403 pre-tunnel, pipelined-bypass closed).
- Cookie/token default masking holds; reveal double-gated; state files 0600 O_NOFOLLOW; tokens never in curl argv.
- No hardcoded secrets repo-wide (public TLS cert fixture only).
- Payload mirrors byte-identical to live dirs; payload-index hashes/paths fully consistent (144 files).

## Adjudication Log

| Finding | Action | Rationale |
|---|---|---|
| F1-01 + F3-13 | MERGED -> HF-01 | Same root cause (false budget invariant + inert gate); union locations; independent discovery by 2 finders -> confidence bump to high |
| F1-06 | RETRACTED | Challenger located README.md already present in .oxfmtignore; make fmt honors it; hook exclusion redundant not inconsistent — finding premise false |
| F5-01 | RETRACTED | Challenger proved realExecInContainer calls module-local execFile wrapper injecting timeout ?? DOCKER_CLI_TIMEOUT_MS (30s) by default; conditional spread permits override only; critical section independently bounded (60s ensure, LOCK_WAIT_MS 35s fail-fast, catch-side release) — hang-forever premise false |
| F1-07 | DOWNGRADE conf->low | Challenger recomputed: 69 artifacts/37 indexed/~32 unindexed (not 41/71); substance stands, arithmetic did not |
| F2-14 | DOWNGRADE med->low | Ordering invariant preserved (deps always reference already-pushed questions); metadata corruption only |
| F3-01 | DOWNGRADE med->low | Bogus fact confirmed mechanically but cosmetic pollution, no downstream harm |
| F3-02 | DOWNGRADE med->low | Confirmed all three mechanisms; confined to opt-in diagnostics |
| F3-03 | DOWNGRADE med->low | Code strictly safer than documented; deliberate carve-outs; pure doc drift |
| F5-03 | DOWNGRADE med->low(+conf low) | Restored bytes are displaced holder's fresh claim (inode guard validates); needs >=3-4 near-simultaneous creators threading microsecond windows; transient/self-healing |
| F6-02 | DOWNGRADE med->low | Selector escaping partially tested (cdp.test clickCoords); record engine Docker-free covered; remainder thin delegation |

Corroborator notes (no bump — challenger/discovery duplicates folded): CH-A N1 -> F1-11; CH-A N2 -> F8-09; CH-B N1 -> F2-16/F6-05 cluster; CH-D N1 -> F1-05/F6-11; CH-D N2 -> HF-01. Cross-dimension clusters intentionally kept split: F2-16<->F6-05 (code smell vs test presence), F4-05<->F3-12 (secrets vs publication posture), F3-02<->F5-09, F1-05<->F6-11.

## Retracted Findings

**F1-06** "Pre-commit oxfmt exemption inconsistent with make fmt" — DISPROOF: `.oxfmtignore` contains README.md (verified at HEAD); `make fmt`/`fmt-check` pass `--ignore-path=.oxfmtignore`; both surfaces exclude README consistently. Finder misread .oxfmtignore contents.

**F5-01** "docker exec helpers bypass DOCKER_CLI_TIMEOUT_MS; wedged dockerd hangs port lock forever" — DISPROOF: docker.mjs module-local execFile wrapper injects `timeout: opts.timeout ?? DOCKER_CLI_TIMEOUT_MS` unconditionally; the spread at :115 adds caller overrides on top. All pgrepMatch/pkillMatch/isPortFree calls inherit 30s bound. Port-lock critical section additionally bounded (explicit 60s ensure, 10s bind wait, catch-side release) and peers fail fast at LOCK_WAIT_MS=35s with typed error. No permanent block exists.

## Reproducibility

- Pinned SHA: e44ef3f4af06073a603a41942b096129390ab345 (worktree clean at intake; only this report added since)
- OSV: `curl -s -X POST https://api.osv.dev/v1/query -d '{"package":{"ecosystem":"npm","name":"NAME"},"version":"VER"}'` for lefthook@2.1.10, oxlint@1.79.0, oxfmt@0.64.0, chrome-remote-interface@0.34.0, ws@7.5.13 — all 0 hits (2026-08-23)
- Runtime currency: `curl -s https://endoflife.date/api/nodejs.json` — Node 22 EOL 2027-04-30 (2026-08-23 retrieval)
- Finder/challenger transcripts: opencode session tasks ses_fd1c75f3affeTJnZegru8Q7luD (F2), ses_fd1c72a10ffemGy5StobYlbwms (F3), ses_fd19ffaebffenxVewrjLvvJJhJ (F4), ses_fd18153b4ffe1SBp3rIpVTHncC (F5), ses_fd18f52a3ffeyLfdha1hA00eW4 (F1), ses_fd16d44abffeUFhj4g6lZdwSvW (F6), ses_fd15cb23dffex4rSIypLfIeDzd (F7), ses_fd1554482ffenfsAvvS1yeKrHC (F8); challengers ses_fd149070affeZB3zFSgL6kJhFU (CH-A), ses_fd1421fe7ffe1rcvcPzRd5xmnr (CH-B), ses_fd135b707ffev9oDOoca9gNAF1 (CH-C), ses_fd12ca545ffenplDp5ybErXaPU (CH-D), ses_fd121c50cffeDeGEMMRIZomRv (F5-03 gap-fill)
- Word-count recomputation method: `desc.trim().split(/\s+/)` per check-suite algorithm; recountable via `node -e` against the twelve SKILL.mds
