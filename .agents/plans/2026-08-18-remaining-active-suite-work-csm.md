---
format: csm-plan/1
---

# Remaining Active Suite Work — Build Plan CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan.
- Deferred items (CI, Chromium sandbox, old README plan, F-017 tier-b eval harness) remain in `.agents/plans/2026-08-18-remaining-suite-work-csm.md` as blocked records; they are NOT tasks in this plan.
- The agent-agnostic installer and the frozen `bootstrap/` payload are owned by the parallel workstream; this plan must not modify `bootstrap/package/payload/**` without explicit cross-session coordination.
- Risk summary: 4 tasks — T001 high (security boundary, independent review required), T002 standard (baseline migration), T003 standard, T004 standard.

## Control
- Plan ID: remaining-active-suite-work-2026-08-18
- Status: in_progress
- Current CSM state: DISPATCH
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-18 cycle 1 — T001 complete: host-side token gate + docker-exec stdio tunnel; spike decision recorded; security review fix-first (10 findings) all repaired; 96/96 units, 79/79 e2e live; latent T002-era root-path bug (XDG_RUNTIME_DIR /run ancestor) found+fixed in repair. Next: Wave 2 (T002, T003-scaffold)
- Next transition: CHECKPOINT -> SELECT (T002 || T003-scaffold)
- Active tasks: none (next: T002, T003)
- Blockers: none

## Goal
Execute the four active tasks of the amended remaining-work plan: (T001) implement full per-session CDP authentication in csm-browse with a design spike and independent security review; (T002) retire the legacy ten-dimension pipeline with documented baseline migration, without touching the parallel session's frozen payload; (T003) restructure csm-scan tests into S/M/L tiers with named runners and measured evidence; (T004) close the three low-risk refinements (exec-layer timeouts, per-line daemon-log timestamps, `ws` dependency policy) or record each as explicitly deferred with evidence.

**Exclusions**: deferred records (CI/audit T005, sandbox T006, README plan T007, eval harness T008) stay blocked in the other plan; `bootstrap/package/payload/**` is parallel-owned and must not be edited here.

## Acceptance Criteria
1. Per-session CDP: an unauthenticated synthetic client is rejected before any browser command; an authenticated client can discover (`/json/version`) and execute a harmless command; token rotation/revocation invalidates old tokens; host 9222/5900 remain loopback-only; `cd csm-browse && npm test`, `node scripts/check-skill.mjs`, and e2e quick pass; independent security review signs off with no unresolved critical/high findings.
2. Legacy pipeline: `runExistingTenPipeline` and `processExistingTenRepo` have zero references outside migration records and the parallel-owned frozen payload (expected residual); parity tests (T204/T224) pass against migrated baselines or are replaced with equivalent expanded-pipeline coverage; T201/T223 updated in lockstep; source-text pins are rewritten; `csm-scan` full suite green with coverage ≥ re-measured baseline; the parallel session's `bootstrap/package/payload` copy is never edited here — coordination recorded instead.
3. Test tiers: named S/M/L manifests and runner commands exist under `csm-scan/test/scripts/`; the tier manifest is a complete, non-overlapping partition of all 65 test files (frozen post-T002); the S tier runs parallel-stable (2 consecutive green runs); full serial suite remains green; coverage stays above the 88% hard floor with the re-measured baseline recorded; results are recorded in the plan.
4. T004: each candidate either lands with a focused regression test or is recorded deferred with a concrete barrier (exec-layer signature change, log-buffering cost, dependency-churn policy) — nothing silently dropped.

## Current-State Evidence
- Amended remaining-work plan (commit ce19f94) defines T001-T004 scope; scout report (this session) provides seams, callers, baselines, and tier matrix.
- T001: wsUrl construction at csm-browse/scripts/ensure-browser.mjs:210 and :311 (single funnel; consumers daemon-core.mjs:15, cdp.mjs:4, capture.mjs:115, log.mjs:145/196); HTTP discovery URL `cdpUrl` (`http://${ip}:${publicPort}`) is separate and must be covered too; socat launch :189-193/:285-289 (`TCP-LISTEN:${pub},fork,reuseaddr,bind=${ip}`); execLayer DI (docker.mjs:131-150); validateState (security.mjs:116-120, shape tests security.test.mjs:39-46) already tolerates query strings, rejects userinfo; `--remote-debugging-pipe` unused.
- T002: zero production callers (run.mjs:151/183/211 internal only; scan.mjs:188 uses expanded); test callers in expansion-production-pipeline.test.mjs and expansion-activation.test.mjs incl. source-text pins (:360-361, :614-617); baselines: fixture-behavior.json legacy hashes, semantic.json, renderer.md, test-integrity.json, inventory.json, supersession.json, capabilities.json (writer call pinned); parity helpers legacy-pipeline-mirror.mjs; DEFAULT_EXISTING_TEN_RENDERER imported at write.mjs:6, used as default param at write.mjs:81 — unreachable from production (run.mjs:1064 always passes a composite); frozen payload vendors legacy files incl. run.mjs (payload-index.json:344, :338, :518).
- T003: only runner is test/scripts/coverage-gate.mjs; check-suite.mjs never references test/scripts; suite 1225/1225 @ 2:30.95, coverage 96.85% lines @ 2:46.68; S-tier ~13 files, M-tier ~14, L-tier ~26 (scout matrix).
- T004: execDetached/execInContainer have no timeout option (docker.mjs:37-68); ensure-browser.mjs passes per-call timeouts; upload.mjs already tracked+timeout (post-T003); daemon.log stamped per write-call (session-daemon.mjs:79-92), per-line needs a line-buffered transform; `ws` 7.5.13 transitive (package-lock.json:793-813) directly imported by tests/unit/helpers/fake-cdp-server.mjs:4; no devDependencies section.
- Gates baseline: recorded at build start by csm-build VALIDATE (check-suite count, csm-scan count, browse count, upload count, drift checks); reference numbers at drafting: check-suite 437, csm-scan 1225/1225, csm-browse 66/66, upload 2/2.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | T001 must begin with an isolated transport spike before implementation | planning | Scout: 3 candidate transports (wsUrl token query, socat auth proxy, debugging-pipe); each has distinct cost; choose on measured evidence | decided |
| D2 | `bootstrap/package/payload/**` is off-limits; T002 coordinates via record, never direct edit | safety constraint | Parallel workstream owns the frozen payload; silent edits would break its integrity index | decided |
| D3 | T003 S/M/L split is evidence-gated: land only if parallel S-tier is stable across 2 runs and coverage holds; else record and keep serial | proportionality | Review F-058 documented parallel races | decided |
| D4 | T004 exec-layer timeout requires a deliberate signature change (execLayer gains timeout option with default = current behavior) | planning | Scout: no timeout seam exists in execDetached/execInContainer | decided |
| D5 | T004 `ws` policy: declare as devDependency only if lockfile update is non-speculative; else record deferred | planning | ws 7.5.13 already transitive+hoisted; no devDependencies exist today | decided |
| D6 | Per-line daemon-log timestamps are worth doing only if the line-buffered transform is simple and testable | planning | Scout: transform inside stampWrite (:84-90), no current pin | decided |
| D7 | T002 does NOT change the writeNORMS default renderer: DEFAULT_EXISTING_TEN_RENDERER stays (it is unreachable from production — run.mjs:1064 always passes a composite renderer); only the legacy pipeline entry points and their direct test harnesses are retired | planning | T223 deliberately pins the inert default write path; changing it is a separate contract flip | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Which CDP transport is smallest? | Read-only code audit (scout) | No writes | wsUrl funnel covers all consumers with one change; validateState tolerates query strings; socat seam is second | T001 spike compares wsUrl-token vs socat-proxy vs pipe in /tmp with synthetic clients |
| R2 | Is legacy pipeline dead in production? | Caller graph (scout) | No writes | Zero production callers; 2 test files + parity helper only | T002 can retire source; tests/baselines migrate |
| R3 | Which tests are S/M/L? | Import/subprocess classification (scout) | No writes | ~13/~14/~26 split; no per-file timings exist | T003 must measure before landing parallel S-tier |
| R4 | Do timeout seams exist? | Exec-layer audit (scout) | No writes | No timeout option in execDetached/execInContainer | T004 requires explicit signature change |
| R5 | Is ws already available? | Lockfile inspection (scout) | No writes | 7.5.13 hoisted transitive; fake-cdp-server imports it | Declare devDep only with lockfile approval |

## Discovered Requirements
- csm-browse unit tests pin socat patterns (`TCP-LISTEN:92*`), chrome `--remote-debugging-port=` parse, wsUrl shape rules (security.test.mjs:39-44), and CRI `/json/protocol` discovery (fake-cdp-server.mjs:11-13) — T001 changes must update or extend these deliberately.
- state.wsUrl persists to state.json and is validated by validateState; token-bearing URLs pass today — T001 must also decide whether tokens live in wsUrl (query) or a separate store; if query, validateState's shape rule stays compatible.
- T002 migration surface includes DEFAULT_EXISTING_TEN_RENDERER (write.mjs default) — retiring it changes the write path and renderer.md baseline; treat as a deliberate behavior change with regeneration, not a deletion.
- T002 must not touch `bootstrap/package/payload/**`; if retirement makes the payload's vendored copy stale, record a coordination note for the parallel owner instead of editing.
- T003 runner commands must be added to csm-scan/SKILL.md and README Development section; check-suite does not reference them (no gate change needed).
- T004 line-buffered stamping must not double-stamp or drop partial lines across chunk boundaries; add a unit test with multi-line and split-write inputs.
- Node 22 required for browse glob tests (`export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`).

## Design
T001: spike in /tmp (synthetic CDP server + unauthenticated/authenticated clients) comparing: (a) token query param on wsUrl, (b) socat-side auth proxy, (c) `--remote-debugging-pipe`. Select smallest viable; implement at the wsUrl funnel (ensure-browser.mjs:210/:311) with token generation/rotation/revocation bound to session lifecycle; keep validateState compatible; add negative attacker tests via execLayer DI; independent security review before checkpoint.

T002: retire `runExistingTenPipeline`/`processExistingTenRepo` from source (zero production callers); keep `DEFAULT_EXISTING_TEN_RENDERER` as the writeNORMS default per D7; migrate T204/T224 parity assertions to expanded-pipeline projections; update T201/T223 assertions in lockstep with any baseline regeneration; regenerate baselines via documented canonical process; rewrite source-text pins; leave `bootstrap/package/payload` untouched with a coordination record (its vendored `run.mjs` at payload-index.json:344 contains the retired symbols — an expected, recorded residual).

T003: add `test/scripts/run-s.mjs`, `run-m.mjs`, `run-l.mjs` (or one runner with tier arg) + `tiers.mjs` manifest from the scout matrix; measure S-tier parallel stability (2 green runs); keep serial `node --test --test-concurrency=1` as authoritative; update SKILL.md/README runner docs; land only if evidence holds.

T004: (a) execLayer gains `timeout` option defaulting to current behavior, plus unit test; (b) line-buffered stampWrite with split-write tests; (c) `ws` devDependency decision with lockfile check; each independently revertible.

## Execution Graph
- Wave 1: T001 (spike then implement; independent review gate).
- Wave 2: T002 and T003-runner-scaffolding run in parallel after T001's baseline/security gate (T002 = csm-scan lib/pipeline/baselines; T003 = runner scaffolding only).
- Wave 3: T003-manifest (frozen from post-T002 file set) and T004.
- Critical path: T001 -> (T002 || T003-scaffold) -> (T003-manifest || T004).

## Numbered Plan
1. [completed] Full per-session CDP authentication (spike + implementation)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (security boundary; independent security review required)
   - Owned scope: csm-browse/scripts/ensure-browser.mjs (wsUrl construction :210/:311, socat launch :189-193/:285-289), lib/security.mjs (validateState token rules), lib/session.mjs (token lifecycle), scripts/session-daemon.mjs (auth'd connect), lib/cdp.mjs + daemon-core.mjs (consumer URL), tests/unit (ports/sweep/daemon/security/fake-cdp-server updates), new negative-attacker test file.
   - Not in scope: host loopback 9222/5900 (already fixed), Chromium sandbox, bootstrap payload, real credentials.
   - Spike candidate: /tmp synthetic CDP server + two clients; compare (a) wsUrl token query, (b) socat auth proxy, (c) `--remote-debugging-pipe`; cover BOTH URLs (HTTP discovery `cdpUrl`/`/json/version` AND WebSocket `wsUrl`) in the comparison criteria; state the Docker boundary explicitly: the socat-proxy and pipe variants can only be exercised with the real container (spike uses a host socat for the auth-proxy mechanism proof, then validates in-container via e2e); measure implementation size, test impact, and failure semantics; record decision.
   - Actions: run spike; implement chosen transport at the wsUrl funnel; generate per-session token bound to SID+generation; reject unauthenticated HTTP discovery and WS upgrade; rotate on reconnect, revoke on session cleanup; keep validateState shape rules compatible (token in query or explicit allowlist); update pinned unit tests; add attacker harness proving rejection-before-command, token reuse-after-rotation fails; update SKILL.md Troubleshooting if behavior changes.
   - Acceptance signal: `cd csm-browse && npm test` green (≥66, explained deltas), `node scripts/check-skill.mjs` PASS, e2e quick green; attacker test proves unauthenticated client rejected before any browser command; independent security review signs off with no unresolved critical/high.
   - Validation: syntax checks; focused unit; e2e quick; then security review by non-implementer; then full browse battery.
   - Acceptance evidence: spike decision record, token lifecycle design, negative/positive traces, review sign-off artifact, final test counts.
   - Repair attempts: 0
   - Recovery note: if interrupted mid-spike, resume from the recorded spike decision; token changes are additive to session state (new field), old sessions without tokens fail closed.
2. [pending] Retire legacy ten-dimension pipeline with baseline migration
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (baseline/data compatibility)
   - Owned scope: csm-scan/lib/scan/pipeline/run.mjs (runExistingTenPipeline, processExistingTenRepo), pipeline/existing-ten.mjs, render/existing-ten.mjs (usage only — DEFAULT_EXISTING_TEN_RENDERER REMAINS the writeNORMS default, see D7), write.mjs (only if the default must change — see D7), test/expansion-production-pipeline.test.mjs, test/expansion-activation.test.mjs, test/fixtures-pipeline.test.mjs, test/helpers/legacy-pipeline-mirror.mjs, test/expansion-render-existing-ten.test.mjs, test/expansion-render-registration.test.mjs (T223 — update in lockstep), test/expansion-baseline.test.mjs (T201 — update in lockstep), baselines (fixture-behavior.json, semantic.json, renderer.md, test-integrity.json, inventory.json, supersession.json, capabilities.json — verified unchanged or regenerated via documented process).
   - Not in scope: `bootstrap/package/payload/**` (parallel-owned; record coordination note only); expanded 17-dimension pipeline internals.
   - Spike candidate: none — caller graph proven; migration approach: project legacy assertions onto expanded results (pattern exists from T010's mirror re-pointing).
   - Actions: delete or gate-off legacy pipeline entry points; migrate T204/T224 parity assertions to expanded-pipeline projections; regenerate baselines via canonical fixed-clock process (regen harness pattern from T004 of skills-remediation); update T201/T223 assertions in lockstep; rewrite source-text pins at expansion-production-pipeline.test.mjs:360-361 and expansion-activation.test.mjs:614-617; update fixtures-pipeline comments; record a coordination note for the bootstrap payload owner (vendored run.mjs containing retired symbols = expected residual).
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` green (1225 or explained delta), coverage ≥ re-measured baseline (recorded at build start), check-suite count recorded at build start (not a fixed floor), `rg -l 'runExistingTenPipeline|processExistingTenRepo' csm-scan --glob '!bootstrap/**'` → only `.agents` history + explicit exemption list; `bootstrap/package/payload` git-status untouched.
   - Validation: caller grep; baseline digest diff vs documented migration; deterministic double-run; coverage gate.
   - Acceptance evidence: caller inventory (pre/post), baseline migration rationale, digest lists, suite output.
   - Repair attempts: 0
   - Recovery note: preserve old baselines in supersession artifacts until replacement tests commit; revert path = restore prior baselines + re-add gated legacy entry (git revert of the task commit).
3. [pending] Restructure csm-scan tests into S/M/L tiers with measured evidence
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-scan/test/scripts/ (new: tiers manifest + runner), test file tier assignments per scout matrix, csm-scan/SKILL.md Testing section, README Development section.
   - Not in scope: production code, coverage-gate.mjs behavior, test content/assertions, bootstrap payload.
   - Spike candidate: measure S-tier parallel stability in /tmp (2 consecutive runs) before landing; if flakes, record and keep serial.
   - Actions: create `test/scripts/tiers.mjs` (complete non-overlapping S/M/L partition of all 65 `*.test.mjs` files — manifest frozen from the POST-T002 file set, generated in Wave 3 after T002's migration, so no tier entry references retired/renamed legacy files), `test/scripts/run-tier.mjs` (arg: s|m|l|all; S runs with default concurrency, M/L serial); both new files carry the NODE_TEST_CONTEXT inert guard (same pattern as coverage-gate.mjs) so `node --test` discovery does not add phantom tests or distort coverage instrumentation; validate S-tier stability (2 green runs, record timings); keep `node --test --test-concurrency=1` authoritative for full runs; update SKILL.md + README runner docs; run coverage gate.
   - Acceptance signal: `node test/scripts/run-tier.mjs s` green twice consecutively; `node test/scripts/run-tier.mjs m` and `l` green; full serial suite green (1225, explained deltas); coverage ≥ re-measured baseline (recorded at build start; runner-file instrumentation may shift the measured number — the gate's 88% floor is the hard bound); tier manifest is a complete, non-overlapping partition of all 65 test files; docs updated.
   - Validation: timing + stability logs; coverage gate; check-suite.
   - Acceptance evidence: tier manifest, before/after timings, 2x S-run logs, coverage comparison.
   - Repair attempts: 0
   - Recovery note: if parallel S-tier flakes, revert tier assignments to serial-only and record evidence; runner additions are additive files.
4. [pending] Close remaining low-risk technical refinements
   - Task ID: T004
   - Depends on: T002, T003
   - Parallel group: G3
   - Risk: standard
   - Owned scope: csm-browse/lib/docker.mjs (execLayer timeout option), scripts/session-daemon.mjs (line-buffered stampWrite), csm-browse/package.json + package-lock.json (ws devDependency decision), focused tests.
   - Not in scope: CDP auth, CI, sandbox, legacy pipeline, bootstrap payload, speculative dependency churn beyond ws.
   - Spike candidate: none — each sub-item is small and independently revertible.
   - Actions: (a) execLayer gains `timeout` option (default current behavior) on execDetached/execInContainer + unit test proving timeout fires; (b) line-buffered stampWrite: accumulate chunks, stamp each complete line, flush remainder, add multi-line + split-write unit tests; (c) ws: run `npm install --save-dev ws@7.5.13` in a /tmp copy to check lockfile impact, then decide: land as devDependency or record deferred with the lockfile-change evidence.
   - Acceptance signal: `cd csm-browse && npm test` green (66 + new tests), `node scripts/check-skill.mjs` PASS, `cd csm-scan && node --test --test-concurrency=1` green (untouched), check-suite 437+.
   - Validation: focused unit tests for each sub-item; full browse battery; full scan suite spot-run.
   - Acceptance evidence: timeout-test output, line-stamp tests (multi-line + split-write), ws lockfile before/after diff + decision.
   - Repair attempts: 0
   - Recovery note: each sub-item independently revertible; defer-with-evidence is acceptable per D4-D6.

## Verification Strategy
- Fast gates per task: `node --check` touched files, `node scripts/check-suite.mjs` (<1s), browse `npm test` (Docker-free).
- Batch gates: csm-scan full suite (serial, authoritative) after T002/T003; coverage gate after T002/T003; e2e quick after T001.
- Security: T001 requires an independent review sign-off artifact recorded in the plan before completion.
- Parallel-safe: T002 and T003 are file-disjoint (scan lib/baselines vs scan test/scripts); run in parallel only after T001's gate.
- Environment notes: Node 22 PATH-prepend required; e2e quick skips cleanly without Docker; known flake risk only in parallel S-tier (T003) — mitigated by 2-run stability proof.

## Risks And Recovery
- T001 transport choice could require a product decision mid-spike; block with options rather than weakening security.
- T002 baseline migration may surface hidden consumers (e.g., renderer-only tests T205/T21x); migrate via projection or record as parity-fixture with replacement evidence; never delete history silently.
- T003 parallel S-tier may flake; revert to serial and record evidence (D3).
- T004 exec-layer signature change touches every execLayer consumer; keep default behavior identical so existing tests stay green.
- Parallel payload staleness after T002: coordination record only, never silent edits (D2).

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| T002 scope omits T201/T223 consumer tests; renderer-default retirement conflicts with T223's inert-write contract | major | T002 scope += expansion-baseline.test.mjs + expansion-render-registration.test.mjs; D7 added: DEFAULT_EXISTING_TEN_RENDERER stays as writeNORMS default (unreachable from production); only pipeline entry points retired; T201/T223 updated in lockstep | critic + run.mjs:1064 |
| T002 grep clause contradicts payload-untouched clause | major | Acceptance uses explicit `rg --glob '!bootstrap/**'` + `.agents` exemption; vendored run.mjs in payload = recorded expected residual | payload-index.json:344 |
| T002 ‖ T003 not content-disjoint (manifest lists pre-migration files) | moderate | Execution graph split: T003-scaffold in Wave 2, T003-manifest frozen post-T002 in Wave 3 | critic |
| Tier matrix ~53 ≠ 65 files; un-pinned lists | moderate | T003 requires complete non-overlapping 65-file partition; acceptance asserts it | ls count |
| New test/scripts files auto-discovered by node --test + coverage | moderate | NODE_TEST_CONTEXT inert guard required on tiers.mjs + run-tier.mjs; coverage floor = re-measured baseline, 88% hard gate | coverage-gate header |
| check-suite 437 vs 434 inconsistency | moderate | Gates baseline recorded at build start (VALIDATE); drafting reference 437 noted as such | critic |
| capabilities.json omitted from T002 baselines | minor | Added to T002 baseline scope (verified unchanged or documented regen) | expansion-constraints.test.mjs |
| Citation inaccuracies (write.mjs:6 vs :81; payload-index lines; security.test lines) | minor | Corrected in Current-State Evidence | working tree |
| Spike Docker boundary + cdpUrl separate URL unspecified | minor | T001 spike criteria now state Docker boundary explicitly and cover both HTTP discovery and WS URLs | ensure-browser.mjs |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-18 | 0 | INTAKE -> DISCOVER (scout) -> DRAFT | none | Build-readiness scout returned seams/callers/tier-matrix; Aug18 plan amended (ce19f94) with T008 deferred + Resolved-Elsewhere | CRITIQUE |
| 2026-08-18 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | 2 major + 4 moderate + 5 minor findings; all remediated (D7 renderer-default decision, scoped grep, tier-manifest sequencing, inert guards, baseline recording); plan re-verified | SAVED |
| 2026-08-18 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT -> DISPATCH | T001 | Baseline green (check-suite 439, browse 66/66, drift clean) @ a8ccba3; Wave 1 = T001 spike | INTEGRATE |
| 2026-08-18 | 1 (cont.) | SPIKE (isolated /tmp) -> SELECT | T001 | SPIKE DECISION: no container-side candidate deployable (immutable Alpine image lacks any runtime; CRI 0.34.0 has zero pipe support; socat cannot inspect content). Chosen: HOST-SIDE token gate + `docker exec -i` stdio tunnel; container-side socat bridge listener removed; token rides `?token=` on cdpUrl+wsUrl; proven end-to-end against live chromium (403-before-command, rotation/revocation via execLayer DI). Files: new scripts/cdp-gate.mjs; ensure-browser (funnel/curl/socat-replace), security (validateState), session (token lifecycle), docker (execLayer DI), cleanup/sweep/ports (socat→gate re-key); consumers unchanged (token rides state.wsUrl); tests: fake-cdp-server token mode, security/daemon/status/ports/sweep updates, NEW auth.test.mjs, e2e, SKILL.md. Payload: only csm-browse/SKILL.md vendored -> D2 coordination note. Residuals: exec-per-connection latency, tunnel teardown, /json/protocol static schema unauthenticated (or CRI local:true x5), token hygiene in 0600 state.json (redactTelemetry covers token=), port pool host-side re-key | DISPATCH (T001 impl) |
| 2026-08-18 | 1 | SPIKE -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW (independent, fix-first) -> REPAIR (10 findings) -> CHECKPOINT | T001 | cdp-gate.mjs (static protocol, timing-safe token, per-status deny, teardown) + fetch.mjs (curl argv eliminated) + token lifecycle + socat re-key; review findings 1-10 all repaired; new regression: pipelined-bypass closes with 0 tunnels; 96/96 units, 79/79 e2e; latent XDG_RUNTIME_DIR ancestor bug fixed; bootstrap untouched | SELECT (Wave 2) |

## Completion Review
(filled by csm-build when all criteria are verified)
