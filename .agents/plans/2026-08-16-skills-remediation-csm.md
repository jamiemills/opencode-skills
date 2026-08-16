# Skills Remediation (10 Phases) CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Items in Numbered Plan are ordered by execution sequence where IDs diverge (item 11 = T012 lands before item 12 = T011); csm-build addresses tasks by Task ID, humans should cite IDs.
- Risk summary: 14 tasks — 13 active (3 high-risk: T005, T007; plus T013 deferred, also high-risk) — 5 security-flagged total (T001, T005, T008, T012, T014), 10 standard, 1 low (T003). T005 and T007 always require independent review before completion.

## Control
- Plan ID: skills-remediation-2026-08-16
- Status: in_progress
- Current CSM state: CHECKPOINT
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-16 cycle 2 — Wave 2 complete: T005+T004 privacy cutover (suite 1220/1220 incl. repair: R1 render-context threading closed 5 leak channels w/ hostile-fixture proof all-zero; R2 hidden-fail flag; R3 scan-coverage caveat; +primary fix: internal pattern-name vocabulary renders raw); T014 detection (both AWS forms+hidden pass proven); T006 lifecycle batch (10 fixes, e2e --quick 59/59). Independent security review: fix-first → repaired → re-verified. Next: SELECT Wave 3 (T007)
- Next transition: CHECKPOINT -> SELECT (Wave 3: T007, then T008+T009)
- Active tasks: none (next: T007)
- Active tasks: none
- Blockers: T013 (Wave 5: CI workflow + scheduled dependency audit) deferred to a future stage by user decision 2026-08-16 — not to be dispatched this build; plan completes without it.

## Goal
Remediate the user-confirmed 10 phases of the 2026-08-15 full csm-review (77 findings, .agents/reviews/2026-08-15-skills-review.md). Phases 1-9 are fully covered by tasks T001-T014; phase 10 (small-fix sweep, T012) additionally sweeps the cheap low/info findings (F-055, F-056, F-058, F-061, F-062, F-063, F-065, F-066, F-068, F-075, F-076, F-077) where they reduce to small edits; any of those judged non-trivial at execution time are recorded as deferred with rationale rather than silently dropped. Every fix must keep the csm-scan suite green (or intentionally supersede baselines via the documented mechanism), keep check-suite green at each commit, and land with the tests/verification this review found missing.

**Exclusions**: no rewrite of csm-scan's 17-dimension architecture; no behavioral eval harness with live LLM calls (F-017 tier-b deferred); no mutation-testing rollout (one-time Stryker baseline optional, non-blocking); no changes to skill activation semantics beyond the OSV method text; browse e2e remains Docker-gated but must become skippable and side-effect-free when Docker is absent. **Explicitly deferred findings**: F-060 (multi-user /tmp trust hardening beyond the env-override root — single-user threat model today), F-033 container-internal residual (socat/web-UI bind-narrowing inside the container is included in T001; full per-session CDP auth redesign is out), F-055 legacy-pipeline retirement beyond the T010 re-pointing (full deletion of runExistingTenPipeline deferred to avoid supersession churn).

## Acceptance Criteria
1. `docker ps` shows chromium-vnc ports published as `127.0.0.1:9222->9222` and `127.0.0.1:5900->5900` (or 5900 unpublished); `--remote-debugging-address=0.0.0.0` removed; new sessions bind loopback; per-session socat binds the container bridge IP, not `0.0.0.0` (F-001 fully; F-033 host-publish + bind-narrowing halves — full per-session CDP auth redesign deferred).
2. csm-review/SKILL.md prescribes per-package OSV `/v1/query` + authoritative-range confirmation; querybatch demoted to candidate signal with the false-positive trap documented (F-005); check-suite still green.
3. A scan of a fixture repo containing a secret in `package.json` scripts, an absolute path, and a token in description produces a NORMS.md with none of them verbatim (canary test proves it); USAGE text matches actual behavior (F-004, F-019, F-054, F-057); supersession.json records the write.mjs change via the documented flip mechanism, not a digest bump (A-1/C-1).
4. Secret detection: >400-file fixture with secret at sorted position >400 is detected or the truncation is disclosed in findings; `.env`-style gitignored file is enumerated for secret scan; `AWS_ACCESS_KEY_ID=` (uppercase) detected (F-002, F-003, F-018); mixed supported/unsupported deployment manifest yields non-`observed` claim (F-020).
5. Browse lifecycle: SIGTERM during recording finalizes video + stats (unit or e2e evidence); concurrent session creation + sweep does not kill creating sessions (marker honored by both sweep passes); daemon exits on CDP disconnect; daemonless state self-heals; every `curl`/`docker pull|run` call has a timeout (F-009..F-042 cluster).
6. `cd csm-browse && npm test` runs a Docker-free node:test unit layer covering cookies/cdp/session/ports/sweep decision logic (≥40 assertions incl. all 6 consent patterns + SID regex + stale-lock + sweep branch matrix); check-skill resolves both deps + `node --check`s all .mjs (F-012, F-043).
7. csm-scan suite runs green on any machine with no `$HOME`-path dependencies: env-var + checked-in fallback fixture; zero bare-`return` skips; AC20 no-skip derived from node:test machine summary; `--experimental-test-coverage` run is green with ≥ current line coverage (F-007, F-008, F-025..F-029).
8. check-suite v2: anchored fence-aware heading checks; full state-chain verification for all 5 state-machine skills; numeric self-claims (9 states/18 dimensions) verified; cross-skill contracts (plan path, `-bdd-csm.md`, `Superseded for BDD/TDD`) cross-file checked; 7-plan golden corpus validated as ordered subsequence; registry completeness both directions; frontmatter parser handles quoted/multi-line YAML (F-015..F-017, F-046..F-048, F-067, F-071).
9. ACTIVE: LICENSE (MIT) at root (F-006). FUTURE STAGE (T013, deferred): GitHub Actions CI green on push running check-suite + csm-scan suite + browse unit layer + browse check-skill on Node 22; weekly scheduled dependency audit (F-049, F-072) — plan completion does not require this criterion; it gates the future-stage task only.
10. Small fixes landed: upload.mjs escapeHtml + timeouts + stderr + signal cleanup; docker image digest-pinned; daemon.log append + timestamps; `.agents/README.md` index; README tree corrected; csm-grill path canonicalized to `.agents/approaches/` (F-050, F-052, F-053, F-069, F-070, F-073, F-074).

## Current-State Evidence
- Review report: .agents/reviews/2026-08-15-skills-review.md @ 75abed1 — 77 findings F-001..F-077 with file:line citations, challenge verdicts, remediation sketches.
- Suite baseline: csm-scan 1210/1210 pass (`node --test --test-concurrency=1`, ~92s); 947/263 under `--experimental-test-coverage`; coverage 88.85/81.28/88.73; check-suite OK 8 skills 156 checks; browse check-skill PASS.
- Supersession locks live: supersession.json `deterministic-ordering-paths` (legacy_locked) pins write.mjs, renderer.md, fixtures-pipeline.test.mjs — verified matching at HEAD (scout A-1).
- No DI seams in csm-browse: sweep/ports/session statically import docker.mjs helpers + frozen `/tmp/csm-browse` root (scout A-2).
- NORMS.md `Path:` baseline pin: expansion-baseline.test.mjs:93 expects relative `` `- **Path**: `.` `` for fixture repos — relative-path rendering keeps the golden byte-identical (scout U-1).
- Grill plan corpus contains one extra section (`Brief-Conformance Evidence Map`) — corpus check must be ordered-subsequence (scout U-2).
- AC20 skip-regex + portability interlock detailed in scout U-3; named-gate files list includes the AC20 file itself.
- Env: host Node v20.20.2 only (no nvm); gh 2.45.0 authenticated; remote github.com/jamiemills/opencode-skills (public).
- `.agents/reviews/` is now tracked (F-073 partially stale at planning time); remaining gap = index/retention only (scout C-6).
- FIXTURE_BASE `172.17.0.1:8090` hardcoded in 3 places: tests/e2e.mjs:9, lib/constants.mjs:12, SKILL.md:83 (scout C-4).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | Node target = 22 LTS (floor `>=22 <25`), installed via nvm at build time; CI pins setup-node 22 | user-dictated direction, detail decided | Node 20 EOL 2026-04-30 (F-051); 22 is the conservative maintained LTS; avoids U-4 double-variable by migrating before AC20/coverage work is finalized | decided |
| D2 | NORMS.md renders repo-relative/basename Path (fixtures already relative per golden) — not a placeholder | design | Keeps renderer.md golden byte-identical (U-1), satisfies privacy intent | decided |
| D3 | scripts bodies dropped from render (names + `yes/no` only), description passes through sanitizer | design | F-004 remediation sketch; sanitizer (sanitizeText) already exists in reporter | decided |
| D4 | DI seams for browse tests added as production-code change in T007 (env-overridable SESSIONS_ROOT + injectable exec layer), not test-only mocks | design | Scout A-2/C-3: no seams exist; module-mocking is experimental and risky under coverage | decided |
| D5 | Grill canonical save path = `.agents/approaches/` (fix mapping table line 71) | design | 2-of-3 mentions already say approaches/ (C-6) | decided |
| D6 | csm-scan stays package.json-free; CI invokes `node --test` directly | design | Scout A-5: no manifest exists; adding one is unrequested surface | decided |
| D7 | Corpus + contract checks live in check-suite.mjs v2 (one file, single owner) with a shared `contracts` data block | design | C-2 collision control; F-016 remediation "centralize as data" | decided |
| D8 | serve.mjs keeps bridge-IP binding (container must reach it) but gains ephemeral port + traversal rejection; FIXTURE_BASE parameterized in all 3 copies | design | C-4: loopback-only would break the only e2e net | decided |
| D9 | Reviews/plans/docs stay tracked; `.agents/README.md` index + retention note instead of ignore rules | design | C-6: reviews/ already tracked; gitignore churn unneeded | decided |
| D10 | LICENSE = MIT | user-confirmed phase 9 | README quickstart implies reuse; MIT simplest OSI grant | decided |
| D11 | e2e Docker-gated steps report SKIP via env probe rather than failing | design | F-013 remediation; CI runs the Docker-free layers only | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What breaks when write.mjs is edited? | Static inspection of supersession.json + live sha256 comparison (scout, read-only) | Read-only; no writes | 3 live digest locks incl. write.mjs; documented flip mechanism with replacement-test registration | T005 must ship write.mjs edit + supersession flip + T227 canary + replacement test as one unit |
| R2 | Can browse lib be unit-tested without refactor? | Import-graph + static-import inspection (scout) | Read-only | Only cdp.mjs imports the CRI dep (safe at import); sweep/ports/session have zero DI seams | T007 adds seams; T008 tests bind to them |
| R3 | Does NORMS.md Path redaction break goldens? | Baseline test + renderer.md inspection (scout) | Read-only | Golden expects relative `.`; basename/relative rendering is byte-compatible | D2 chosen |
| R4 | Does anything machine-consume NORMS.md/scripts? | Grep of consumers (scout) | Read-only | Only skill prompts + authenticity strings; scan-cli pins `[SCAN-NOTE]` stdout patterns | T005/T014 must update semantic.json findingKeys + cli pins when disclosures/counts change |
| R5 | Will tightened linter pass current docs? | Spot-check of all 8 SKILL.md heading shapes + grill fence structure (scout + review challenger) | Read-only | All required H2s exist as true headings; grill has 4-backtick nested fences | T011 parser must be fence-length-aware; doc edits (T002/T010) land before tightening |
| R6 | Node migration feasibility | Env check: only v20.20.2 present, no nvm (primary) | Read-only | nvm install required at build time; CI unaffected via setup-node | D1; T004 installs + verifies before AC20 rewrite lands finally |

## Discovered Requirements
- Supersession policy (supersession.json line 3): legacy_locked entries flip to `superseded` with digest-locked replacement tests registered in `inventory.recurringAcceptanceTestFiles` — never silent digest bumps (A-1).
- AC20 regex interlock: named-gate files must never contain option-form `{ skip:` skips while the textual regex is live; portability conversion and AC20 rewrite are sequenced inside T010 (U-3).
- check-suite REQUIRED_SECTIONS/STATE_LINES strings must remain present verbatim in any SKILL.md edit until T011 replaces the mechanism (C-2).
- scan-cli.test.mjs:48,51 pin exact stdout patterns; write.test.mjs:230 pins security finding-keys; semantic.json findingKeys deepEqual'd (C-5).
- test-integrity.json sha256-pins the 5 fixture modules; adversarial fixtures require digest bumps + baseline regeneration (C-5).
- e2e depends on container reaching the fixture server via docker bridge — serve.mjs must stay bridge-reachable (C-4/D8).
- csm-grill plan corpus contains legitimate extra sections — corpus validation is ordered-subsequence (U-2).
- `expansion-baseline.test.mjs:92` asserts the "Generated by csm-scan" line — write.mjs edits must preserve it.
- csm-build RECOVER consumes plan Control sections — corpus checks validate structure only, never rewrite historical plans (U-2).

## Design
Ten phases map to 14 tasks in 4 active waves + 1 future stage. Wave 1 = independent quick wins + the Node migration (unblocks U-4). Wave 2 = the two deep code units (privacy cutover with its lock machinery; detection fixes; lifecycle batch A). Wave 3 = protocol changes + DI seams, then the browse test layer + e2e de-hardening. Wave 4 = csm-scan test repair, then doc small-fixes, then linter v2 (single owner of check-suite.mjs). Future stage (Wave 5, deferred by user) = CI activation running everything — T013 stays in the plan with full task definition so a later build can dispatch it unchanged. Browse session protocol additions: `creating.marker` written under the port lock before chromium launch; sweep consults marker in BOTH passes and daemon-liveness regardless of dir age; queue claims by rename-only with ts-ordered processing; daemon registers `client.on('disconnect', cleanup)`; state.json writes are tmp+rename. Privacy cutover: `writeNORMS` renders repo-relative path; scripts table drops bodies; a redacting privacyHook wraps the final markdown before sink; T227 gains scripts/description canaries. Linter v2: fence-length-aware parser → anchored heading set/state-chain extractor → contract/corpus/claims checks driven by one declarative data block; completeness assertions both directions. CI: one workflow, push + PR + weekly audit schedule, Node 22, jobs = check-suite, csm-scan suite, browse unit + check-skill; no Docker in CI (D11).

## Execution Graph
Wave barriers are hard sequencing; Depends-on fields are authoritative within/between waves for csm-build's SELECT step.
- Wave 1 (parallel): T001, T002, T003, T004.
- Wave 2 (parallel; T005 and T014 verify on Node 22 after T004): T005, T014. (T006 may also start — its files are disjoint from T005/T014; wave-equivalent G2.)
- Wave 3: T007 (after T006, soft T005); then T008, T009 (parallel, file-disjoint: T008 owns tests/unit/** + package.json + check-skill; T009 owns tests/e2e.mjs + tests/serve.mjs + constants FIXTURE_BASE line + SKILL.md docs).
- Wave 4: T010 (after T004/T005/T014) and T012 (after T001/T006/T009) run parallel, file-disjoint; T011 alone owns scripts/check-suite.mjs and starts only after T002 + T012 land (gate green when tightened).
- Wave 5 (FUTURE STAGE — deferred, do not dispatch this build): T013 (after T005, T008, T010, T011, T012, T014).
- Critical path (active build): T006 → T007 → T009 → T012 → T011.
- Non-overlapping write ownership within waves: W1 disjoint packages (browse-constants / review-doc / root / node-migration); W2 T005 (scan render/write/privacy+baselines) vs T014 (scan detection libs+fixtures+semantic.json findingKeys — semantic.json touched by both: T005 only if output-pinned, T014 for findingKeys; sequential commit rule: whoever lands second rebases on the first's documented update); W3 file-disjoint as above; W4 T010 (scan test files) vs T012 (upload/browse-log-lines/docs) disjoint; T011 solo; W5 T013 solo (future stage).

## Numbered Plan
1. [completed] Browse security hotfix — loopback-bind CDP/VNC + socat bind-narrowing
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (security-flagged; changes docker publish surface — verify e2e still passes or is skippable)
   - Owned scope: csm-browse/scripts/ensure-browser.mjs, csm-browse/lib/constants.mjs (DOCKER_RUN_CMD, debug address flag, IMAGE digest pin comment hook)
   - Not in scope: per-session CDP auth redesign (F-033 residual, deferred), serve.mjs/FIXTURE_BASE (T009)
   - Spike candidate: none (review challenger verified `-p 127.0.0.1:...` preserves readiness curl + container-IP session traffic)
   - Actions: change both `-p` flags to `127.0.0.1:`-prefixed in ensure-browser.mjs:103 and constants.mjs DOCKER_RUN_CMD doc string; remove `--remote-debugging-address=0.0.0.0` (loopback default inside container suffices — verify socat per-session path unaffected); narrow each session socat bind from `0.0.0.0` to the container's bridge IP (same value already used by the host to connect); set `VNC_PASSWORD` env (generate once, store in `~/.config/csm-browse/vnc-pass` 0600) or unpublish 5900 with a documented opt-in; recreate container.
   - Acceptance signal: `docker ps --format '{{.Ports}}'` (chromium-vnc) shows `127.0.0.1:9222->` and `127.0.0.1:5900->` (or no 5900); `curl -s http://localhost:9222/json/version` still returns JSON; `node csm-browse/scripts/check-skill.mjs` PASS.
   - Validation: `docker port chromium-vnc` loopback-only; from the docker bridge gateway, session ports 9224+ on the host side refused; e2e smoke if Docker available else skip probe.
   - Acceptance evidence: recorded docker ps output + curl result in task evidence.
   - Repair attempts: 0
   - Recovery note: if container won't recreate, `docker rm -f chromium-vnc` then re-run ensure-browser; state files unaffected.

2. [completed] csm-review SKILL.md — OSV method fix
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (doc-only; must keep REQUIRED_SECTIONS + `SAVED -> STOP` verbatim until T011)
   - Owned scope: csm-review/SKILL.md lines ~69, ~126, ~222, ~235 (R0 recipe, EVIDENCE, dimension-15 anchor, confidence definitions)
   - Not in scope: any other section of the skill; state machine text
   - Spike candidate: none
   - Actions: replace querybatch mandate with per-package `/v1/query` (or osv-scanner) + mandatory affected-range confirmation via `/v1/vulns/<id>` before any finding is graded; demote querybatch to "candidate signal only — known false-positive mode"; remove "live OSV match" from the E1 definition, replace with "deterministic tool reproduces, including range-verified OSV match".
   - Acceptance signal: `node scripts/check-suite.mjs` OK; grep confirms no unconditional `querybatch` mandate remains and `/v1/query` + range verification prescribed.
   - Validation: manual read of the 4 edited passages against F-005 remediation sketch.
   - Acceptance evidence: diff recorded.
   - Repair attempts: 0
   - Recovery note: pure doc edit; git revert if wrong.

3. [completed] LICENSE + package.json license field + README section
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: low
   - Owned scope: LICENSE (new), csm-browse/package.json (license field), README.md License section
   - Not in scope: any other README edits (T012)
   - Spike candidate: none
   - Actions: add MIT LICENSE (copyright holder = repo owner), `"license": "MIT"`, rewrite README License section to name it.
   - Acceptance signal: `node scripts/check-suite.mjs` OK + LICENSE exists + `node -e "require('./csm-browse/package.json').license"` prints MIT.
   - Validation: visual diff.
   - Acceptance evidence: diff.
   - Repair attempts: 0
   - Recovery note: additive files.

4. [completed] Node 22 LTS migration + engines pin
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (runtime migration; suites must stay green)
   - Owned scope: csm-browse/package.json engines, new .node-version, README requirements line
   - Not in scope: CI workflow (T013), dependency upgrades
   - Spike candidate: does the csm-scan suite pass unchanged on Node 22? Install nvm+22 in user space (no system mutation beyond ~/.nvm), run suite; if >0 failures, record them as discovered requirements before proceeding.
   - Actions: install nvm + Node 22 LTS (user-space); set `.node-version` = 22; engines `">=22 <25"`; README Node requirement `>= 22`; run csm-scan full suite + check-suite + browse check-skill on 22; record results.
   - Acceptance signal: `node --version` ≥22 in shell; `cd csm-scan && node --test --test-concurrency=1` → 1210/1210 on Node 22; check-suite OK.
   - Validation: rerun browse check-skill; note any Node-22-specific deprecation warnings as discovered requirements.
   - Acceptance evidence: suite output on Node 22 recorded.
   - Repair attempts: 0
   - Recovery note: nvm is user-space; system node untouched; revert = use system node.

5. [completed] csm-scan privacy cutover (one coherent unit)
   - Task ID: T005
   - Depends on: none (soft: after T004 to verify on target Node)
   - Parallel group: G2
   - Risk: high (security-flagged; breaks 3 digest locks by design; must not regress T227)
   - Owned scope: csm-scan/lib/scan/write.mjs, render/base.mjs (privacyHook for write path), render/stack.mjs + config.mjs (scripts tables), scripts/scan.mjs USAGE, test/expansion-privacy-gate.test.mjs (canaries), test/baselines/expansion/supersession.json + inventory, new replacement test file, plus (if and only if output-pinned by the suite) test/baselines/expansion/renderer.md + semantic.json and the write.test.mjs:230 / scan-cli.test.mjs:48,51 pins — regenerated/updated via the documented baseline mechanism with the citation in the commit message
   - Not in scope: renderer registry refactor, legacy dimension gate expansion beyond overview/scripts channels, F-054's stderr carve-out wording beyond USAGE line
   - Spike candidate: none — review + scout evidence complete (U-1/D2/D3)
   - Actions: render repo-relative Path + redacted gitRoot indicator; drop script bodies (names + presence only) in stack+config tables; route `overview.description` and cross-observation text through sanitizeText at write; add T227 canaries (ghp_-token in scripts value, token in description, fixture root in expected-redacted set); flip supersession `deterministic-ordering-paths` to `superseded` with replacement test registered; align USAGE privacy sentence (report claims only; CLI-arg carve-out per bb54746 policy).
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` green (incl. updated T227 + new replacement test); manual scan of a seeded fixture shows no verbatim secret/path in NORMS.md; renderer.md golden either byte-identical (if Path relative rendering preserves it) or regenerated via documented baseline process.
   - Validation: `node scripts/scan.mjs --repos <tmp fixture with canaries> --out <tmp>` + grep for canaries (must be absent); check-suite OK.
   - Acceptance evidence: canary-scan output + suite result + supersession diff.
   - Repair attempts: 0
   - Recovery note: if suite red mid-unit, the supersession flip is the last sub-step — commit code+tests+flip atomically; partial state detectable via expansion-baseline failure naming the lock entry.

6. [completed] Browse lifecycle batch A (code-only, no protocol change)
   - Task ID: T006
   - Depends on: none
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-browse/scripts/session-daemon.mjs (stopRecorder arg), lib/daemon-core.mjs (exceptionDetails-independent fixes: parse-fail out-file), lib/cdp.mjs (exceptionDetails throw), lib/verbs/dom.mjs (selector match before fallback), lib/verbs/status.mjs (artifactCount), lib/verbs/capture.mjs (quality apply or warn), lib/recorder.mjs (recorder.json write order + try/catch), lib/session.mjs (tmp+rename), scripts/ensure-browser.mjs (daemonless relaunch, curl -m, docker timeouts, reuse-path readiness probe)
   - Not in scope: sweep/queue/lock protocol (T007), socat/VNC (T001), unit tests (T008)
   - Spike candidate: none
   - Actions: pass `sDir` to stopRecorder (or derive from activeRecording); throw descriptive error on exceptionDetails; separate selector-match eval in dom text/html; count artifacts dir (try/catch 0); apply ffmpeg `-q:v` for jpeg stitch presets or warn on ignored --quality; move recorder.json write before startScreencast with failure cleanup; atomic state.json; relaunch daemon when `!daemonPid` in reuse branch; `-m 2` per curl attempt + execFile timeout options on docker pull/run + CDP probe on container-reuse path.
   - Acceptance signal: `node --check` on all touched files; `node csm-browse/scripts/check-skill.mjs` PASS; T008's unit tests for cdp/status/recorder guards pass once landed (interim: targeted node -e assertions on recorder write-order via stub).
   - Validation: grep confirms no `execFileAsync('curl'` without `-m`; grep confirms stopRecorder call sites pass 3 args.
   - Acceptance evidence: diffs + interim assertion output.
   - Repair attempts: 0
   - Recovery note: independent small fixes — any single revert is safe.

7. [pending] Browse lifecycle batch B (protocol + DI seams)
   - Task ID: T007
   - Depends on: T006 (soft: T005 — wave barrier keeps it after the privacy cutover settles baselines)
   - Parallel group: G3
   - Risk: high (protocol change: marker + queue semantics + lock timing; needs independent review)
   - Owned scope: csm-browse/lib/sweep.mjs (marker in both passes, daemon-liveness regardless of age), lib/ports.mjs (LOCK_WAIT raise, content-matched unlink, hold-scope narrowing), scripts/ensure-browser.mjs (marker write inside lock; lock release after bind not CDP wait), lib/daemon-core.mjs (claim-by-rename only, no rm -rf wipe, ts-ordered processing), lib/verbs/record.mjs (ts in filenames or payload-order), lib/session.mjs + constants.mjs (SESSIONS_ROOT env override `CSM_BROWSE_SESSIONS_ROOT`), lib/docker.mjs (injectable exec factory export), scripts/session-daemon.mjs (pidFile wx claim before connect, disconnect handler)
   - Not in scope: e2e changes (T009), unit tests (T008 — but T008's disconnect/daemonless assertions close this task's AC-5 evidence), parse-fail out-file handling (T006 owns it), /tmp trust hardening beyond env override (F-060 deferred)
   - Spike candidate: verify lock narrowing (release after socat/chromium launch, before 30s CDP wait) doesn't reintroduce duplicate-pair allocation — prove with a concurrency smoke script in /tmp sandbox spawning 3 parallel ensure-browser creations against distinct sids.
   - Actions: implement marker protocol + sweep updates; queue restart never wipes unconsumed out/, processes by cmd.ts; atomic pid claim; disconnect→cleanup; DI seams per D4 (exec factory param with default = current behavior; env-overridable SESSIONS_ROOT).
   - Acceptance signal: `node --test csm-browse/test/**` (T008 landed next; interim: the /tmp concurrency smoke script shows 3/3 sessions created, zero cross-kills); check-skill PASS.
   - Validation: manual trace of sweep passes against marker; grep: `rm(cmdDir` gone from daemon-core.
   - Acceptance evidence: smoke script output + diffs.
   - Repair attempts: 0
   - Recovery note: marker files are additive; if sweep regresses, marker presence is a no-op for old logic.

8. [pending] Browse unit-test layer + npm scripts + check-skill extension
   - Task ID: T008
   - Depends on: T007
   - Parallel group: G4 (with T009)
   - Risk: standard (security-flagged only insofar as cookies tests lock consent behavior)
   - Owned scope: csm-browse/tests/unit/** (new directory), csm-browse/package.json (scripts: test/check), csm-browse/scripts/check-skill.mjs
   - Not in scope: tests/e2e.mjs, tests/serve.mjs (T009)
   - Spike candidate: none (D4 seams exist after T007)
   - Actions: node:test units under tests/unit/ — cookies (stub client capturing Runtime.evaluate per pattern ×6 + accept-texts), cdp (escaping, waitForSelector timeout, 1MB cap, exceptionDetails throw), session (SID regex + atomic write via tmpdir), ports (stale-lock break, content-match unlink, wait-timeout) with CSM_BROWSE_SESSIONS_ROOT=tmpdir, sweep (branch matrix via injected fake exec: orphan-daemon/ffmpeg/chromium/recorder-lock/socat passes + marker do-not-touch + skipSid), daemon lifecycle (fake CDP client emitting `disconnect` asserts cleanup + marker removal; daemonless `!daemonPid` reuse-relaunch assertion via injectable exec factory) — ≥40 assertions and these last two close AC-5's evidence for T007; package.json scripts `test` = `node --test tests/unit/`; check-skill: resolve all deps, `node --check` every lib/scripts .mjs plus tests/unit/ only (T009 owns tests/e2e.mjs concurrently), fixtures existence.
   - Acceptance signal: `cd csm-browse && npm test` green, Docker-free, <10s, incl. disconnect-cleanup and daemonless-relaunch tests; `node scripts/check-skill.mjs` PASS (now stricter).
   - Validation: run with `CSM_BROWSE_SESSIONS_ROOT` pointing at a fresh tmpdir twice (idempotent); confirm no writes outside tmpdir.
   - Acceptance evidence: test output + timing.
   - Repair attempts: 0
   - Recovery note: additive test files; failing unit ≠ broken prod (triage individually).

9. [pending] e2e de-hardening + safety fixes
   - Task ID: T009
   - Depends on: T007
   - Parallel group: G4 (with T008; file-disjoint: this task owns tests/e2e.mjs + tests/serve.mjs + constants FIXTURE_BASE line + SKILL.md docs)
   - Risk: standard
   - Owned scope: csm-browse/tests/e2e.mjs, tests/serve.mjs, lib/constants.mjs (FIXTURE_BASE param), csm-browse/SKILL.md (FIXTURE_BASE + troubleshooting: daemon.log, session-dir layout)
   - Not in scope: new e2e scenarios beyond daemon-restart assert fix + sweep stimuli
   - Actions: env probe (docker info || { echo SKIP; exit 0 }); FIXTURE_BASE from env with default via bridge-gateway detection (`ip route | awk '/docker0/')` fallback 172.17.0.1) — update all 3 copies incl. SKILL.md; serve.mjs: listen(port 0, bridge-or-env host), reject `..`, READY handshake reports port; remove fuser -k (bind ephemeral instead); fix always-true assert → assert dead + poll kill(pid,0); add sweep stimuli (decoy daemon/ffmpeg/socat spawn + assert selective removal, fresh session survives); summary path → repo-local or env.
   - Acceptance signal: `node tests/e2e.mjs` on Docker host green incl. new sweep steps; `node tests/e2e.mjs` without Docker prints SKIP and exits 0.
   - Validation: grep: no `fuser`, no hardcoded `172.17.0.1` outside default fallback; serve traversal probe (curl --path-as-is /../etc/passwd → 400/404).
   - Acceptance evidence: both-mode outputs.
   - Repair attempts: 0
   - Recovery note: e2e changes don't affect unit layer.

10. [pending] csm-scan test repair (portability + AC20 + coverage + mirrors + fixtures)
   - Task ID: T010
   - Depends on: T004 (verify on Node 22); T005 (baseline state settled); T014 (detection fixes landed first, else the uppercase-AWS/.env fixtures turn the suite red)
   - Parallel group: G5
   - Risk: standard
   - Owned scope: csm-scan/test/** (12 machine-bound files, expansion-final-acceptance.test.mjs, golden/fixtures-pipeline/voice-gate mirrors, new fixtures), test/baselines/expansion/test-integrity.json + semantic.json + renderer.md (documented regeneration only)
   - Not in scope: production lib changes (T004/T005 own theirs)
   - Spike candidate: none — U-3 sequencing prescribed: (1) env-var `CSM_SCAN_REAL_REPO` + checked-in fallback fixture for all 12 files, (2) convert bare returns to labeled skips, (3) then swap AC20 no-skip to node:test summary-derived (`skipped: 0` via --test-reporter tap/json) + delete tautology + behavioral gate-before-write (throwing sink + canary), (4) never introduce option-form skips in gate files.
   - Actions: portability conversion; AC20 behavioral rewrite; re-point 3 mirror runPipeline duplicates at runExpandedPipeline (project legacy assertions); triage F-025 coverage-mode failures (isolate instrumentation-coupled assertions, fix or gate); add adversarial fixtures (empty repo, binaries-only, CRLF/BOM; the uppercase-AWS + gitignored-.env fixtures land here exercising T014's detection fixes) with integrity digest bumps + semantic.json findingKeys update; wire `npm`-free coverage gate script `node --test --experimental-test-coverage` into a new test/scripts/coverage-gate.mjs threshold check (lines ≥ 88%).
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` green with `CSM_SCAN_REAL_REPO` unset on a non-author path; `--experimental-test-coverage` run green with threshold met; grep: zero `existsSync('/home` in test/.
   - Validation: AC20 file self-check passes post-rewrite; corpus of named gates shows skipped:0 in summary.
   - Acceptance evidence: both runner outputs + skip counts.
   - Repair attempts: 0
   - Recovery note: test-only changes; production untouched.

11. [completed] csm-scan detection fixes (review phase 4)
   - Task ID: T014
   - Depends on: none (soft: T004 for final verification on Node 22)
   - Parallel group: G2 (with T005 — file-disjoint: this task owns the detection libs, T005 owns render/write/privacy)
   - Risk: high (security-flagged: secret-scanner behavior change; baseline-visible output changes)
   - Owned scope: csm-scan/lib/scan/deep/security.mjs (SCAN_FILE_LIMIT window + disclosure, AWS regex case, hidden/gitignored enumeration hook), csm-scan/lib/scan/shared/command.mjs + shared/enum.mjs (bounded `--hidden --no-ignore` files variant for secret scan only), csm-scan/lib/scan/enrich.mjs (searchCompleteness fallthrough → 'incomplete' default), csm-scan/lib/scan/deep/deployment/scanner.mjs (partial-unsupported classification), test/security.test.mjs + test/expansion-deployment.test.mjs fixtures, test/baselines/expansion/semantic.json findingKeys (documented update)
   - Not in scope: render/write privacy (T005), the portability/AC20/coverage work (T010), new adversarial fixture family (T010 consumes this task's detection shapes)
   - Spike candidate: none — review + challenger reproductions cover all four defects (F-002 twice-reproduced, F-003 twice-reproduced, F-018 code-inspected, F-020 classification reproduced + reachability traced)
   - Actions: prioritize likely-config/source files within the 400-file window (or raise the cap for text-bounded files ≤1MB) and add a disclosed `scannedFiles/filesSkipped` record to security findings; add `i` flag to AWS key regexes keeping value groups exact-case + uppercase fixtures; add a bounded hidden/gitignored enumeration feeding ONLY detectSecretPatterns (with disclosure of the pass); change searchCompleteness fallthrough to 'incomplete' + mixed-manifest fixture asserting non-`observed` claim; update semantic.json findingKeys + scan-cli stdout pins if shapes change (documented mechanism, cited in commit).
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` green incl. new fixtures: 413-file fixture detects secret at sorted position >400 (or discloses skip); `AWS_ACCESS_KEY_ID=` uppercase detected; gitignored `.env` with a canary key detected; docker-compose + marker-less k8s yaml yields non-observed claim.
   - Validation: `node scripts/scan.mjs --repos <tmp fixture> --out <tmp>` shows the disclosure line; check-suite OK.
   - Acceptance evidence: fixture-scan outputs + suite result + semantic.json diff.
   - Repair attempts: 0
   - Recovery note: each detection change is independently revertible; fixtures are additive.

12. [pending] Small-fix sweep (docs + upload + daemon.log + low/info findings)
   - Task ID: T012
   - Depends on: T001 (docker constants settled), T006 (session-daemon.mjs log lines), T009 (SKILL.md docs settled)
   - Parallel group: G5 (with T010; file-disjoint)
   - Risk: standard (upload XSS security-flagged)
   - Owned scope: csm-upload/scripts/upload.mjs, csm-browse/scripts/session-daemon.mjs (ONLY the log-stream lines: flags 'a', ISO timestamp wrapper), csm-grill/SKILL.md:71, csm-bdd-tdd/SKILL.md:186 wording, csm-browse/lib/constants.mjs (IMAGE digest pin line only), README.md (tree), .agents/README.md (new index), plus the cheap low/info sweep: csm-scan/lib/scan/deep/data/extractor.mjs dead code (F-056), csm-scan/lib/scan/deep/git.mjs topContributors (F-077), csm-browse/lib/verbs/log.mjs cookie masking (F-062), lib/verbs/capture.mjs name validation (F-063), lib/cookies.mjs finally-off (F-065), lib/ports.mjs release() + goto handler + already_recording removal (F-066), daemon-core parse-fail out-file already in T006 (F-059 closed there), scan CLI --verbose (F-075), SBOM note (F-076)
   - Not in scope: check-suite.mjs (T011), CI (T013), F-055 full legacy-pipeline retirement (deferred), F-058 test-size split (deferred to a future ask), F-061 telemetry redaction beyond 0600 modes (partial: file modes set in T007's env-root work)
   - Spike candidate: none
   - Actions: upload.mjs: add `--dry-run` (build HTML locally, no git/gh writes), escapeHtml at all interpolation points, filename allowlist, exec timeouts, err.stderr printing, `gh api user --jq .login` probe, SIGINT/TERM cleanup of pagesDir; daemon.log flags 'a' + ISO timestamps; grill mapping-table path → `.agents/approaches/`; BDD "extending the base template" wording fix; README tree → reality (plans/ docs/ reviews/ + scripts/); `.agents/README.md` index with retention note; docker IMAGE → digest pin (`docker inspect --format '{{index .RepoDigests 0}}'` at build time + refresh-cadence comment); the low/info sweep edits above.
   - Acceptance signal: `node scripts/check-suite.mjs` OK; `node csm-upload/scripts/upload.mjs --dry-run --label x --desc '<script>' -- <tmp file named 'a"><script>alert(1)</script>.png'>` writes local HTML with escaped output (grep: no raw `<script>` tag in file) and performs no git/gh operations; `node csm-browse/scripts/check-skill.mjs` PASS.
   - Validation: `node --check` all touched; grep README tree entries vs `ls`; suite spot-run for extractor/git.mjs dead-code removal (`cd csm-scan && node --test test/detection.test.mjs test/write.test.mjs`).
   - Acceptance evidence: dry-run HTML output + diffs.
   - Repair attempts: 0
   - Recovery note: independent fixes; each revertible in isolation.

13. [pending] Skill-contract linter v2 (check-suite rewrite)
   - Task ID: T011
   - Depends on: T002 (review SKILL edits done), T012 (doc fixes done)
   - Parallel group: G6 (alone — single owner of check-suite.mjs)
   - Risk: standard (gate change; must be green the moment it lands)
   - Owned scope: scripts/check-suite.mjs (full rewrite of check engine), no SKILL.md content edits
   - Not in scope: SKILL.md content fixes (T002/T012 own them)
   - Spike candidate: none — parser design prescribed (fence-length tracking per CommonMark: close only on run ≥ opener).
   - Actions: fence-length-aware line parser (fixes F-067; handle ``` and ~~~); anchored `^##\s` heading-set extraction outside fences; per-skill declarative manifest block (sections, state chains, tmux, norms, claims, contracts); state-chain verification for all 5 skills (chain parsed from SKILL text, each state needs `^### \d+\.` heading in order, consecutive numbering, Entry/Exit for csm-review); numeric claims (9 states/18 dimensions vs actual); cross-file contract checks (plan path regex, -bdd-csm.md, `Superseded for BDD/TDD`, upload script existence) from one contracts data block; corpus check: every .agents/plans/*-csm.md ⊇ template sections as ordered subsequence; every .agents/reviews/*-review.md has Report Format headings; registry completeness both directions; frontmatter parser: quote stripping, folded `>`/`|` blocks, duplicate-key rejection, clause-shaped Never-X; README path-token extraction per-line (no whole-line URL skip) + tree-entry reality check; LICENSE existence check.
   - Acceptance signal: `node scripts/check-suite.mjs` OK on the fully-edited tree; mutation sanity: temporarily demote one heading in a tmp copy → checker fails (verify in /tmp sandbox with --root flag, never in repo).
   - Validation: run with `--root` against /tmp copies containing: heading-in-fence decoy, reordered sections, corrupted state chain, dropped contract string, extra corpus section (must pass), plan missing section (must fail).
   - Acceptance evidence: mutation-sandbox results + OK run.
   - Repair attempts: 0
   - Recovery note: old checker recoverable via git; new checker additive checks first, strict mode default.

14. [blocked] CI workflow + scheduled dependency audit — FUTURE STAGE (deferred by user 2026-08-16; do not dispatch this build)
   - Task ID: T013
   - Depends on: T005, T008, T010, T011, T012, T014 (all gates green first) — dependency edges remain valid for the future build that un-defers it
   - Parallel group: G7 (alone)
   - Risk: high (public-repo pipeline activation; secrets none required)
   - Owned scope: .github/workflows/ci.yml (new), .github/workflows/audit.yml (new)
   - Not in scope: Docker-in-CI, e2e in CI (D11), branch protection changes
   - Spike candidate: none
   - Actions: ci.yml on push/PR: checkout, setup-node 22 (cache none — no manifests at root), run `node scripts/check-suite.mjs`; `cd csm-scan && node --test --test-concurrency=1`; `cd csm-browse && npm ci --ignore-scripts && npm test && node scripts/check-skill.mjs`. audit.yml weekly: npm audit --omit=dev in csm-browse (or osv-scanner --lockfile) + endoflife.date floor check script; open issue on failure.
   - Acceptance signal: green run on the public repo (gh run watch); both workflow files validate (`gh workflow list` / actionlint if available).
   - Validation: PR-triggered run passes; audit workflow manual dispatch returns clean (67 pins clean baseline).
   - Acceptance evidence: run URLs.
   - Repair attempts: 0
   - Recovery note: workflows additive; disable via repo settings if flaky.

## Verification Strategy
- Per-task fast gates: `node --check` on touched files; `node scripts/check-suite.mjs` (<1s); csm-browse `npm test` (<10s, Docker-free) once T008 lands; targeted node:test files via `node --test test/<file>`.
- Batch gates: csm-scan full suite `node --test --test-concurrency=1` (~92s) after any csm-scan-touching task (T005, T010, T014); coverage run after T010.
- Expensive/manual gates: browse e2e with Docker (T001 smoke, T009 full); concurrency smoke script (T007); mutation-sandbox validation of linter (T011); live CI run (T013 — future stage only).
- Parallel-safe: unit layers + check-suite + scan suite are mutually independent; e2e and concurrency smokes must not run simultaneously (shared container).
- Known flaky/environment-sensitive: e2e (Docker-bound — skip probe), real-repo tests (env-gated after T010), coverage mode (green only after T010 fix; Node-version-coupled per U-4 — always run on Node 22 post-T004).

## Risks And Recovery
- Supersession lock mishandled (T005): mitigation = atomic unit + documented flip; recovery = revert commit restores locks.
- Protocol regression in browse (T007): mitigation = marker additive semantics + concurrency smoke; recovery = markers ignored by old sweep logic.
- Linter v2 false-positives blocking edits (T011): mitigation = mutation-sandbox validation + per-check messages naming the fix; recovery = git revert restores old checker.
- CI red on activation (T013, future stage): mitigation = all gates verified green locally pre-activation; recovery = workflows disableable without code impact; deferral risk = until CI exists, gates rely on manual/local runs — mitigated by T008/T010 making every gate a single fast local command.
- Node 22 unknown suite breaks (T004 spike): recorded as blockers if >0 failures; migration decision revisited before AC20 rewrite (U-4).
- Baseline churn cascade (T005/T010): every baseline regeneration must cite the documented mechanism (supersession flip / integrity digest bump) in its commit message.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Phase 4 detection fixes had no owning task; T010 fixture text garbled ("T004 detection coverage") | blocker | Added T014 (G2, file-disjoint from T005) owning security.mjs/enum/command/enrich/deployment + fixtures + semantic findingKeys; T010 now depends on T014; typo fixed | Critique row 1; review F-002/003/018/020 reproductions |
| Goal promised 77 findings; ~12 orphaned; F-060 deferred but counted | major | Goal restated (10 phases); T012 extended with named low/info sweep; Exclusions enumerate deferred IDs (F-055 full retirement, F-058, F-060, F-061 partial, F-033 auth redesign) with rationale | Critique row 2 |
| T012 acceptance required upload dry-run that doesn't exist | major | `--dry-run` added to T012 actions; acceptance asserts against locally-built HTML only, no git/gh writes | Critique row 3; upload.mjs grep (no dry-run) |
| T005 owned-scope/acceptance mismatch on pinned baseline files; R4 named wrong task | major | Owned scope extended with conditional renderer.md/semantic.json/pins (documented regeneration only, cited in commit); R4 fixed to T005/T014 | Critique row 4; Discovered Requirements C-5 |
| T012 file collisions with T006 (session-daemon) and constants.mjs unspecified | major | T012 depends on T001/T006/T009; owned scope now names the exact lines (log-stream lines only; IMAGE digest line only) | Critique row 5 |
| AC-5 daemon-disconnect/daemonless evidence had no owning test | major | T008 units extended: fake-CDP disconnect cleanup + daemonless reuse-relaunch assertions; referenced from T007 not-in-scope note and AC-5 | Critique row 6 |
| test/ vs tests/ sibling foot-gun + check-skill sweeping T009's concurrent files | minor | T008 owns tests/unit/** (new subdir); check-skill sweeps lib/scripts + tests/unit only | Critique row 7 |
| Critical path used wave-only T005→T007 edge | minor | T007 Depends-on now "T006 (soft: T005)"; graph header notes wave barriers are hard sequencing | Critique row 8 |
| Risk-summary arithmetic wrong | minor | Reworded: 14 tasks, 3 high, 5 security-flagged, 10 standard, 1 low | Critique row 9 |
| Item numbering diverged from IDs | minor | Execution-order numbering kept (T012 before T011) with explicit index note in How To Execute; unique numbers 1-14 | Critique row 10 |
| Parse-fail fix double-owned by T006 and T007 | minor | Assigned to T006; struck from T007 scope | Critique row 11 |
| AC-1 overclaimed F-033 | minor | AC-1 narrowed to F-001 + F-033 host-publish/bind halves; socat bind-narrowing added to T001; auth redesign explicitly deferred | Critique row 12 |
| Wave-2 "AC20 verification" wording garbled | minor | Reworded to Node-22 verification of T005/T014 | Critique row 13 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-16 | 0 | INTAKE→DISCOVER→RESEARCH (scout) | none | scout report 15 items; env checks (node 20 only, gh ok) | DRAFT |
| 2026-08-16 | 0 | DRAFT | T001-T013 | initial draft | CRITIQUE |
| 2026-08-16 | 0 | CRITIQUE (independent subagent) | none | verdict: needs changes — 1 blocker, 5 major, 6 minor; all scout couplings confirmed honored | REMEDIATE |
| 2026-08-16 | 0 | REMEDIATE (primary; corrections evidence-complete) | T001-T014 | T014 added; T012/T005/T007/T008/T010 scope+deps corrected; Goal/AC/graph/risk fixed; 13/13 critique findings resolved | VERIFY |
| 2026-08-16 | 0 | VERIFY (primary gate) -> SAVED | T001-T014 | 14/14 tasks pending with full fields; phases 1-10 all owned (P1=T001 P2=T002 P3=T005 P4=T014 P5=T006+T007 P6=T008+T009 P7=T010 P8=T011 P9=T003+T004+T013 P10=T012); AC 1-10 mapped; deps consistent with graph; unique numbering; no artifacts | NOT_STARTED (awaits explicit csm-build) |
| 2026-08-16 | 0 | SAVED -> SAVED (user-directed mutation) | T013 | Wave 5 deferred to future stage by user decision; T013 -> blocked; AC-9 split active/future; critical path now ends at T011; Control blockers updated | NOT_STARTED (awaits explicit csm-build; 13 active tasks) |
| 2026-08-16 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT | none | explicit csm-build invocation; baseline verified green at a1615f0 (check-suite 156 OK; scan 1210/1210; check-skill PASS); no NORMS.md | DISPATCH (Wave 1) |
| 2026-08-16 | 1 | DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR(none) -> CHECKPOINT | T001-T004 | T001: loopback+socat-IP+VNC-pass, container recreated, independent review accept (medium finding: e2e smoke — satisfied: --quick 59/59 PASS 32s); T002: 4 SKILL.md edits, all gates green; T003: LICENSE+field+README; T004: Node 22 (nvm user-space), scan 1210/1210 + gates green on v22.23.2, F-025 confirmed Node-independent (263 cov failures on both). Reviewer hardening notes deferred to T007 | SELECT (Wave 2) |
| 2026-08-16 | 2 | SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT | T005, T014, T006 | T005: privacy cutover + supersession flip (deterministic-ordering-paths→superseded w/ digest-locked replacement); T014: 4 detection fixes + scanCoverage disclosure (proofs: both AWS forms + gitignored .env detected, mixed-manifest unverified); T006: 10 lifecycle fixes w/ stub harnesses. Independent security review verdict fix-first (R1 high: render-context never reached deep renderers — 5 leak channels PoC'd; R2 hidden fail-open; R3 invisible disclosure) → repair agent landed context threading + scoped-name-aware sanitizeStructuredText + fail flag + caveat rendering → hostile fixture all-zero + deps render; primary fixed pattern-name over-redaction. Suite 1220/1220; e2e --quick 59/59; check-suite OK | SELECT (Wave 3: T007) |

### Cycle-1 Discovered Requirements (added)
- Node 22 on this host: use `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` — `nvm use 22` fails due to ~/.npmrc prefix conflict (do NOT modify ~/.npmrc; not owned).
- T007 absorbs (from T001 review): `if (!ip) throw` guard before socat create/adopt; optional `wx` write in ensureVncPassword.
- e2e summary writes to ~/.agents/docs/csm-browse-e2e-summary.json (T009 moves to repo-local/env path).

### Cycle-2 Discovered Requirements (added)
- Fail-closed privacy hooks over-redact scanner-internal vocabularies (pattern names rendered [redacted]); fixed via isSecretPatternName raw-render — future render-context work must distinguish internal constants from repo-controlled strings.
- T005 extended (reviewer-forced, unowned-by-others): render/testing.mjs, deep/architecture.mjs (System name), deep/documentation.mjs (relative findFile), pipeline/run.mjs (registry context) — all privacy-boundary completions.
- SKILL.md:198 (csm-scan) still carries the old broad privacy sentence — T012 aligns with new USAGE wording.
- T006 behavior change: unmatched selectors in dom text/html now exit 1 (was silent body fallback) — T009 e2e must confirm no step relies on lenient fallback (e2e --quick 59/59 passed post-change).
- reuse-path `docker restart` destroys all in-container sessions when shared CDP is wedged — acceptable degraded-container semantics; T007 sweep must not fight it.

## Completion Review
(filled by csm-build when all criteria are verified)
