---
format: csm-plan/1
---

# Consolidated Remaining Work CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build. Only csm-build writes Control, the Progress Journal, and Discovered Requirements; task agents return evidence to csm-build, which records it at checkpoints.
- Do not dispatch any other plan from this build — in particular `.agents/plans/2026-08-03-comprehensive-readme-csm.md` remains a deferred future candidate (T007), intentionally left ready/never-dispatched (D8).
- Risk summary: 4 active tasks — 3 standard (T002 release-artifact bytes change; T003 includes a host process-kill sweep addition and a security-adjacent print-path change; T004 gates+records only), 1 low (T001 metadata-only closure edits). No task requires independent security review; T003's sweep sub-item requires a bounded argv-match spike and focused tests. 5 deferred records (T005-T009) are blocked and never dispatched.

## Control
- Plan ID: consolidated-remaining-work-2026-08-19
- Status: complete
- Current CSM state: NOT_STARTED
- Cycle: 3
- Commits: allowed
- Last checkpoint: 2026-08-20T17:39:02Z closed as superseded by 2026-08-20-t010-t011-csm (see Closure block)
- Next transition: none; closed as superseded — active tasks completed by sibling plan
- Active tasks: none
- Blockers: none; closure is intentional and not an implementation result

## Closure
- Closure status: closed as superseded; active tasks completed by 2026-08-20-t010-t011-csm; no acceptance criteria are claimed by this plan.
- Replacement plan: /home/jamiemills/.config/opencode/skills/.agents/plans/2026-08-20-t010-t011-csm.md.
- Task disposition: T010, T011 superseded — active tasks completed by sibling plan 2026-08-20-t010-t011-csm; blocked/DEFERRED records retained as blocked.

## Goal
Consolidate every remaining outstanding work item into one executable plan and close off stale outstanding-work references: (1) refresh the stale vendored bootstrap payload; (2) close the five accepted CDP-auth residuals (implement the two mechanically small ones, formally accept the two redesign-scale ones, record the already-resolved one); (3) complete the local pre-release readiness steps for the bootstrap package; (4) close the stale `2026-08-18-remaining-suite-work-csm.md` plan so completed work cannot be redispatched and its deferred records live here. Publication/hosting/key-rotation remain deferred user-approved actions. Superseded plans are ignored; COMPLETE plan files are neither edited nor used as work sources (attribution-only naming is permitted where a closure disposition requires it).

## Acceptance Criteria
1. Payload fresh: the pinned forward hash comparison of `bootstrap/package/payload/skills/**` against mapped sources (T002 command) reports `{compared:113, issues:[]}`-shaped output with zero issues, and the reverse/file-set direction is enforced by the canonical pack's prune plus a git diff bounded to the 4 expected payload files + regenerated index; check-suite OK (439 baseline, explained deltas allowed); all five bootstrap suites pass (30/30 baseline, explained deltas allowed); the new tarball sha256/bytes/file-count recorded in the plan journal.
2. CDP residuals closed: csm-browse `npm test` green under Node 22 (106 baseline + new focused tests, explained delta); orphan host-side `docker exec` tunnel sweep lands with focused tests; error-print redaction and SKILL.md curl-guidance fixes land with focused tests; acceptance rationale for residuals (a) and (e) and the resolved record for (d) are recorded (delivered as T003 acceptance evidence, recorded in the journal by csm-build at T004's records step).
3. Pre-release readiness: release-checklist pre-release steps 1-3 have recorded evidence in the plan journal — step 1 verbatim (check-suite + `sync-skill-boilerplate.mjs --check` + `gen-readme-matrix.mjs --check` + five bootstrap suites), step 2 (deterministic double-pack, identical sha256, digest/bytes/count recorded), step 3 (toolchain + cache-manifest transcript per cache-manifest.schema.json, including the payload-index digest).
4. References closed: `2026-08-18-remaining-suite-work-csm.md` is closed (Status complete, state NOT_STARTED, Next transition none, Closure block naming THIS plan, zero `[pending]` task lines); `.agents/README.md` satisfies its own "one line per artifact" invariant (all missing plan lines backfilled, this plan listed, closure noted, stale `in_progress` fixed); evaluated at the final gate, no COMPLETE plan file appears in the build's cumulative diff; deferred records T005-T009 exist here as blocked DEFERRED tasks.
5. Deferred work stays deferred: csm-build SELECT never dispatches T005-T009 and never dispatches the 2026-08-03 comprehensive-readme plan from this build.

## Current-State Evidence
- Working tree clean at commit `71c2671`; check-suite live-run `OK — 8 skills, 439 checks` (re-verified independently during critique).
- Payload staleness (exhaustive bidirectional hash comparison, independently reproduced by the critic: 117 mapped pairs): exactly 4 files differ — payload `skills/csm-scan/lib/scan/pipeline/run.mjs` (still exports `runExistingTenPipeline`/`processExistingTenRepo`; source removed both and newly exports `enrichValidateRetry`), `.../pipeline/existing-ten.mjs` (still exports `scanExistingTen`), `skills/csm-scan/SKILL.md` (missing tiered-runner docs), `skills/csm-browse/SKILL.md` (missing CDP-auth/token docs). All other payload files hash-match; file sets identical; `payload-index.json` entries (~lines 29-34, 59-64, 337-342, 343-348) describe the stale bytes.
- Canonical refresh: `scripts/pack-bootstrap.mjs` `syncPayload()` (:99-112) + `buildIndex()` (:73-88); documented README.md:199-208; mutating (payload + index + `/tmp/csm-pack-*` workdirs + npm pack). `syncPayload` deletes payload files not in the desired set, so reverse file-set coverage is enforced by any pack run. `scripts/check-suite.mjs` does NOT check payload drift.
- No test pins the tarball digest (`ec0ae903…` is historical journal text only); suites re-pack live and assert counts (≥100 files, ≥118 verified, 8 SKILL.md) — unaffected by refresh.
- CDP residuals (code-audited; citations spot-verified by the critic): (a) one `docker exec -i … socat -` per accepted connection (cdp-gate.mjs:157-158, 224; docker.mjs:173-178); daemon amortizes one WS (session-daemon.mjs:129); sharing needs a WS-aware mux proxy (redesign). (b) per-connection teardown + gate.close + 2s kill grace tested (cdp-gate.mjs:117-122, 209-217, 245-250; auth.test.mjs:414-470); gap = no host sweep pass for orphaned `docker exec` children after gate SIGKILL; the host-side model is the gate pass at sweep.mjs:273-288 (hostPgrep + pool-port bounds), not the container-side legacy-socat pass at :290-302. (c) token in 0600 state.json (session.mjs:100-111), fail-closed validateState (security.mjs:155-199), redaction suite (security.mjs:228-278; tests security.test.mjs:99-125, daemon.test.mjs:66-107); leak nits: scripts/browse.mjs:99 prints raw `err.message`; csm-browse/SKILL.md:148 teaches `curl ... "?token=<token>"` argv. (d) port re-key fully implemented (ports.mjs:92-125, sweep.mjs:273-302, cleanup.mjs:55-91, ensure-browser.mjs:480-494; tests ports.test.mjs:151-191, auth.test.mjs:308-337) — the residual record predates current code. (e) /json/protocol served statically, tokenless, connection-drop design closes pipelined bypass (cdp-gate.mjs:11-17, 86-104; regression auth.test.mjs:233-280); requiring a token breaks stock chrome-remote-interface.
- Release checklist (bootstrap/release-checklist.md): pre-release steps 1-3 local (gates incl. boilerplate/matrix checks; deterministic double-pack; toolchain+cache-manifest transcript); release steps :13-15 and post-publication :19-20 are user-approved credential actions (publish, host+re-sign, key rotation, registry offline replay, steps.md re-sign); Records (:24) requires tarball sha256/bytes/count, payload-index digest, key fingerprint, envelope URL, cache manifest, transcripts.
- Plan inventory: 12 plans COMPLETE (untouchable), 2 closed-as-superseded (ignored), `2026-08-18-remaining-suite-work-csm.md` Status: ready with T001-T004 `[pending]` whose work was completed by a sibling build — redispatch risk via its `NOT_STARTED -> RECOVER` next-transition; `2026-08-03-comprehensive-readme-csm.md` Status: ready, never dispatched, kept intentionally dispatchable as the T007 deferred candidate (D8). `.agents/README.md` declares "One line per artifact" but omits 6 plans (both remaining-work plans, coherence-followups, both superseded installer plans, universal bootstrap) and shows suite-coherence as stale `in_progress`.
- Environment: csm-browse engines `>=22 <25`; default PATH node is v20.20.2 (mis-expands the quoted test glob); Node 22.23.2 available via `$HOME/.nvm/versions/node/v22.23.2/bin`. `cd csm-browse && npm test` verified 106/106 under Node 22 during critique (TMPDIR-sandboxed during planning). `node --test tests/unit/` (directory form) fails on Node 22 — do not use it.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | COMPLETE plan files are never edited and never used as work sources; attribution-only naming is allowed where a closure disposition requires it; the redirect chain runs closed-plan Closure -> this plan | user-directed | User: complete plans must not be included or referenced | decided |
| D2 | Deferred items keep their original task IDs (T005-T008) here, blocked DEFERRED; publication becomes new deferred T009 | user-directed | User: deferred stays deferred; checklist frames publication as user-approved | decided |
| D3 | T003 precedes T002 because csm-browse/SKILL.md edits feed the payload; refreshing first would re-stale it | planning | Payload mapping includes csm-browse/SKILL.md (pack-bootstrap.mjs:20-29) | decided |
| D4 | Residual dispositions: implement (b) orphan-exec sweep and (c) two hygiene nits; formally accept (a) latency and (e) static protocol; record (d) resolved | research | Triage: (b) small host-side pass modeled on sweep.mjs:273-288; (c) one-line fixes; (a)/(e) redesign-scale deliberate trade-offs | decided |
| D5 | T004 executes only the checklist's local pre-release steps 1-3 verbatim; all credential actions stay deferred (T009) | user-directed + checklist | release-checklist.md:11-20 marks release actions user-approved | decided |
| D6 | Payload changes land only via `scripts/pack-bootstrap.mjs` — no manual payload/index edits | planning | Canonical regen process (README.md:199-208) | decided |
| D7 | `.agents/README.md` is brought up to its own invariant: backfill all 6 missing artifact lines, add this plan's line, note the remaining-suite-work closure, fix the stale `in_progress` status | planning | Index header declares "One line per artifact"; minimal-add would leave the invariant violated | decided |
| D8 | The 2026-08-03 comprehensive-readme plan is intentionally left ready/never-dispatched as the T007 future candidate; its redispatch hazard is accepted because the plan file itself IS the deferred work artifact, and this build must not dispatch it | user-directed + planning | T007 deferred record; user: deferred stays deferred | decided |
| D9 | Closure convention = superseded-plan precedent (Status complete + state NOT_STARTED + Next transition none + Closure block + `[blocked]` task-line rewrites), extended by user directive with a closure journal row, an index line, and "completed by sibling build" wording (accurate here: the work WAS implemented, by another plan) | planning | Superseded plans' wording ("no implementation started") does not fit; the extension is recorded, not claimed as precedent | decided |
| D10 | Release records live in this plan's journal only; `bootstrap/release-checklist.md` is not annotated | planning | Avoids an ownership ambiguity; checklist file stays untouched | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What is stale in the bootstrap payload and how is it refreshed? | Read-only structure map + exhaustive bidirectional sha256 comparison + script source audit | Read-only; check-suite confirmed read-only before run; git clean after | 4 stale files; pack-bootstrap.mjs is the canonical mutating regen; no digest pins in tests | T002 via script only |
| R2 | What is the code reality of the five CDP-auth residuals? | Read-only code audit + test-inventory + Docker-free unit run in TMPDIR sandbox | Only execution: browse unit suite with TMPDIR under /tmp/opencode; sandbox self-cleaned; git clean | (b),(c) small seams; (a),(e) redesign; (d) resolved; 106/106 | T003 dispositions per D4 |
| R3 | How are plans closed and which references are live? | Read-only plan/repo greps + closure-convention extraction from the two superseded plans | Read-only | Closure convention fields; live pointers = remaining-suite-work itself + .agents/README.md invariant; completed-plan lines are historical | T001 edit list |
| R4 | Which release steps are local vs credential-gated? | Read-only checklist/schema/README audit | Read-only | Steps 1-3 local; 4-6 + post-pub credential-gated; Records requires payload-index digest too | T004 scope + T009 deferred |
| R5 | Critique verification pass | Independent critic re-ran hash audit, check-suite, browse `npm test` under Node 22 (TMPDIR-sandboxed), spot-checked every citation | Read-only + sandboxed test run; git clean | All citations accurate; `node --test tests/unit/` broken on Node 22; 15 findings returned | Remediations folded into this plan |

## Discovered Requirements
- Node >= 22 required for csm-browse tests (engines `>=22 <25`). PATH-prepend `$HOME/.nvm/versions/node/v22.23.2/bin`. Use `cd csm-browse && npm test`; the directory form `node --test tests/unit/` fails on Node 22.
- Only csm-build writes this plan's Control, Progress Journal, and Discovered Requirements; task agents return evidence.
- The five bootstrap suites (and ANY pack-invoking run) must execute serially — `packBootstrap()` mutates and prunes the shared `bootstrap/package/payload/**` tree in place (offline, package-audit, and integration suites all invoke it). Never run pack-invoking suites concurrently. Corollary: any suite run refreshes the payload; T002's explicit pack is the verification gate, not the only mutation path.
- `scripts/check-suite.mjs` validates plan/review file formats (:512-587) — closure edits must keep the closed plan format-valid.
- `pack-bootstrap.mjs` deletes payload files not in the desired set — never hand-place files in payload.
- The sweep orphan-exec pass must bound its process match to pool ports + exact argv shape, mirroring the host-side gate pass (sweep.mjs:273-288), respect the creating-marker suppression window, and be proven against real argv variance before enabling kills (T003 spike).
- SKILL.md edits feed the payload via pack mapping — payload refresh must follow any SKILL.md change (D3 ordering).
- csm-browse unit baseline 106; new focused tests increase the count (explained delta required); e2e is Docker-gated and skips cleanly.
- `/tmp/csm-pack-*` workdirs accumulate (pack cleans its npm cache but not its workdir) — expected residue, not state; do not mistake for drift.

## Design
T001 closes the stale plan per D9 and brings the artifacts index up to its own invariant (D7). T003 lands two hygiene fixes (redact `err.message` at browse.mjs:99 via existing `redactProse`; rewrite SKILL.md:148 guidance so operators copy the tokenized cdpUrl verbatim from state.json and splice any path BEFORE the `?token=` query — never retype or hand-build the token) plus a host-side orphan-exec sweep pass modeled on sweep.mjs:273-288, each with focused tests; residuals (a)/(e) get acceptance rationale and (d) a resolved record, delivered as evidence. T002 runs the canonical pack to sync the 4 stale files + regenerate payload-index.json, proves payload==sources with a pinned comparison command, and runs the five bootstrap suites serially. T004 executes pre-release checklist steps 1-3 verbatim and the final battery, recording all evidence (including the (a)/(e)/(d) rationale texts) in the plan journal. Deferred T005-T009 stay blocked.

## Execution Graph
- Wave 1 (parallel, disjoint FILE writes; this plan's journal written only by csm-build): T001 (`.agents/plans/2026-08-18-remaining-suite-work-csm.md` + `.agents/README.md`) || T003 (csm-browse scripts/lib/SKILL.md/tests).
- Wave 2: T002 (bootstrap payload + index via script) — depends on T003.
- Wave 3: T004 (records + final battery, including AC4's cumulative-diff evaluation) — depends on T002.
- Critical path: T003 -> T002 -> T004; T001 independent (Wave 1).
- Deferred T005-T009 never selected.

## Numbered Plan
1. [completed] Close the stale remaining-suite-work plan and restore the artifacts index invariant
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low (metadata-only edits to plan/index files)
   - Owned scope: `.agents/plans/2026-08-18-remaining-suite-work-csm.md`, `.agents/README.md` only.
   - Not in scope: any other plan file (especially COMPLETE plans — the sibling build is named for attribution only, never as a work source), `.agents/reviews/**`, `.agents/docs/**`, `bootstrap/**`, skill sources, this plan's journal (csm-build-only).
   - Spike candidate: none — closure convention per D9.
   - Actions: (a) rewrite How To Execute first bullet + risk summary to closure wording (T001-T004 completed by the sibling build `2026-08-18-remaining-active-suite-work-csm.md` — attribution only; do not csm-build this plan; deferred records moved to THIS plan); (b) Control: Status ready->complete, keep Current CSM state NOT_STARTED, Next transition -> `none; closed as superseded — active tasks completed by sibling plan`, refresh Last checkpoint, Blockers -> `none; closure is intentional and not an implementation result`; (c) insert `## Closure` between Control and Goal with: Closure status (closed as superseded; T001-T004 completed and evidenced by the sibling build; no criteria claimed by this plan), Replacement plan (THIS plan path), Task disposition (T001-T004 completed by the sibling build; T005-T008 DEFERRED records moved to THIS plan; T007's target `2026-08-03-comprehensive-readme-csm.md` remains ready/never-dispatched per D8); (d) rewrite task lines: T001-T004 `[pending]` -> `[blocked] … (completed by remaining-active-suite-work-2026-08-18)`; T005-T008 keep `[blocked] DEFERRED` + append `(moved to <THIS plan path>)`; (e) append one Progress Journal row recording the user-directed closure; (f) `.agents/README.md`: backfill all 6 missing artifact lines (dates/goals/statuses from each plan's Control block), add THIS plan's line, note the remaining-suite-work closure on its line, fix the suite-coherence `in_progress` -> `complete`.
   - Acceptance signal: `node scripts/check-suite.mjs` OK AND `rg -n '\[pending\]' .agents/plans/2026-08-18-remaining-suite-work-csm.md` returns no matches AND `git status --porcelain -- .agents/plans/2026-08-18-remaining-suite-work-csm.md .agents/README.md` shows exactly those two files (scoped — Wave-1 sibling writes elsewhere are expected).
   - Validation: read-back of Closure fields against D9; at wave checkpoint, csm-build asserts the cumulative diff ⊆ T001's two files ∪ T003's owned set; at the final gate (T004), the cumulative diff contains no COMPLETE plan file.
   - Acceptance evidence: diff of the two files; check-suite output.
   - Repair attempts: 0
   - Recovery note: two-file, metadata-only, idempotently re-runnable; partial edits detectable by the `[pending]` grep.

2. [completed] Close the five CDP-auth residuals (implement 2, accept 2, record 1 resolved)
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (host process-kill matching in sweep; security-adjacent print path)
   - Owned scope: `csm-browse/scripts/browse.mjs` (error print), `csm-browse/SKILL.md` (curl guidance ~:148), `csm-browse/lib/sweep.mjs` (orphan-exec pass), `csm-browse/tests/unit/sweep.test.mjs`, `csm-browse/tests/unit/security.test.mjs` (or a new focused test file under `csm-browse/tests/unit/`).
   - Not in scope: cdp-gate.mjs transport design, docker.mjs exec-per-connection structure, validateState/redaction core, any `bootstrap/**` file, e2e harness, this plan's journal.
   - Spike candidate: before enabling kills, capture real `docker exec -i <container> socat - TCP:127.0.0.1:<port>` argv shapes on the host (ps/pgrep output vs the match regex: docker binary path forms, arg ordering, container-name substring collisions across containers); exercise the pass in dry-run/log-only mode against a live session; if variance defeats exact matching, land the pass dry-run-only or revert it and record the orphan window as accepted with evidence.
   - Actions: (1) route browse.mjs:99 `err.message` through `redactProse` before printing; add a focused test that a fabricated error containing the tokenized wsUrl prints redacted; (2) rewrite SKILL.md:148 guidance: copy the full tokenized cdpUrl verbatim from state.json; if a path suffix is needed (e.g. `/json/version`), splice it after the port and BEFORE the `?token=` query — never retype or hand-construct the token on the argv line; (3) add a host-side orphan-exec sweep pass reaping `docker exec -i <container> socat - TCP:127.0.0.1:<pool-port>` processes, bounded to pool ports and exact argv shape per the spike, modeled on the host-side gate pass (sweep.mjs:273-288), respecting the creating-marker suppression window, with focused sweep.test.mjs cases (match, no-match-unrelated-exec, marker suppression, dry-run mode); (4) deliver as acceptance evidence (recorded by csm-build at T004): acceptance rationale for (a) exec-per-connection latency (perf-only; daemon amortization; mux-proxy redesign cost) and (e) static /json/protocol (public schema; connection-drop closes the pipelined relay; token requirement would break stock chrome-remote-interface), and a resolved record for (d) port re-key with code citations.
   - Acceptance signal: `cd csm-browse && npm test` green under Node 22 (PATH-prepend `$HOME/.nvm/versions/node/v22.23.2/bin`) with count = 106 + new tests (explained delta) AND `cd csm-browse && node scripts/check-skill.mjs` PASS.
   - Validation: cheapest first — `node --check` on touched files; focused new tests; full `npm test`; check-skill; check-suite (SKILL.md format).
   - Acceptance evidence: test output with counts; SKILL.md diff; sweep spike record (argv shapes observed, dry-run result); the (a)/(e)/(d) rationale texts.
   - Repair attempts: 0
   - Recovery note: three independently revertible sub-items; sweep pass additive; if argv matching proves unsafe on the host, land dry-run-only or revert sub-item 3 and record the orphan window as accepted.

3. [completed] Refresh the vendored bootstrap payload to match sources
   - Task ID: T002
   - Depends on: T003
   - Parallel group: G2
   - Risk: standard (release-artifact bytes change; no digest pins exist)
   - Owned scope: `bootstrap/package/payload/**` (via script only), `bootstrap/payload-index.json`.
   - Not in scope: manual payload edits, pack script changes, package.json version bumps, publication, concurrent pack-invoking runs (serial only).
   - Spike candidate: none — canonical process documented (README.md:199-208).
   - Actions: (1) run `node scripts/pack-bootstrap.mjs`; (2) confirm git diff of `bootstrap/**` is bounded to exactly the 4 expected payload files (csm-scan run.mjs, existing-ten.mjs, csm-scan SKILL.md, csm-browse SKILL.md) + regenerated `payload-index.json`; (3) run the pinned comparison (repo root): `node -e 'const fs=require("fs"),path=require("path"),crypto=require("crypto");const root="bootstrap/package/payload/skills";let n=0;const bad=[];const h=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){walk(p);continue}const src=p.slice(root.length+1);try{if(h(p)!==h(src))bad.push("DIFF "+src)}catch{bad.push("MISSING-SOURCE "+src)}n++}})(root);console.log(JSON.stringify({compared:n,issues:bad},null,2));process.exit(bad.length?1:0)'` expecting `{"compared":113,"issues":[]}` exit 0 (reverse file-set direction is enforced by syncPayload's prune — step 2's bounded diff proves it); (4) run `node scripts/check-suite.mjs` (439 baseline, explained deltas allowed); (5) run the five bootstrap suites SERIALLY: `node --test "tests/bootstrap-trust.test.mjs" "tests/package-audit.test.mjs" "tests/protocol/*.test.mjs" "tests/offline/*.test.mjs" "tests/integration/*.test.mjs"` (30/30 baseline); (6) deliver the new tarball sha256/bytes/file-count printed by the pack as acceptance evidence.
   - Acceptance signal: the pinned comparison exits 0 with zero issues AND the five suites pass (30/30 baseline) AND the bootstrap git diff is bounded to the 4 files + index.
   - Validation: bounded diff; pinned hash comparison; check-suite; serial suites (they self-pack and prove determinism).
   - Acceptance evidence: new digest/bytes/count; comparison output; suite output; bounded diff listing.
   - Repair attempts: 0
   - Recovery note: refresh is idempotent (script-driven); a bad refresh reverts via git checkout of `bootstrap/**`; never hand-add files (the script prunes).

4. [completed] Execute local pre-release readiness steps verbatim and the final battery
   - Task ID: T004
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard (verification + records only; no source changes)
   - Owned scope: no source writes; all evidence recorded by csm-build in THIS plan's journal (D10 — `bootstrap/release-checklist.md` untouched).
   - Not in scope: publication, hosting, key rotation, steps.md re-sign, any registry network action.
   - Spike candidate: none.
   - Actions: (1) checklist step 1 verbatim: `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, `node scripts/gen-readme-matrix.mjs --check`, five bootstrap suites serially (30/30 baseline), csm-browse `npm test` under Node 22 (+ e2e quick only if Docker available — skips cleanly otherwise), csm-scan full serial suite (1227 baseline; coverage gate optional — no scan source changes), csm-upload (2/2); (2) checklist step 2: run `node scripts/pack-bootstrap.mjs` twice, assert identical sha256, record sha256/bytes/file-count; (3) checklist step 3: record toolchain (node/npm/platform), offline warm + `npm cache verify` transcript per cache-manifest.schema.json, AND the payload-index digest (Records :24 requires it); (4) record the T003-delivered (a)/(e) acceptance rationales and (d) resolved record in the journal; (5) evaluate AC4's cumulative-diff check: no COMPLETE plan file in the build diff; deferred records intact.
   - Acceptance signal: all step-1 gates green at baselines (explained deltas only) AND double-pack sha256 equality evidenced AND toolchain/cache-manifest/payload-index-digest evidence recorded.
   - Validation: cheapest first — check-suite, browse units, then scan serial, then packs; all pack-invoking runs serial.
   - Acceptance evidence: battery outputs, double-pack digests, toolchain/cache-manifest transcript, payload-index digest, cumulative-diff AC4 verification.
   - Repair attempts: 0
   - Recovery note: pure verification; any failure routes to the owning task above, not to this task.

5. [blocked] DEFERRED — CI and scheduled dependency audits [DEF:CI]
   - Task ID: T005
   - Depends on: none
   - Parallel group: G4 (never dispatched)
   - Risk: high (public-repository workflow)
   - Owned scope: future `.github/workflows` CI/audit files only.
   - Not in scope: current build.
   - Spike candidate: none.
   - Actions: retain prior definition for a future plan/build.
   - Acceptance signal: not applicable.
   - Validation: deferred.
   - Acceptance evidence: deferred record carried from remaining-suite-work T005.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

6. [blocked] DEFERRED — Chromium sandbox redesign [DEF:SANDBOX]
   - Task ID: T006
   - Depends on: none
   - Parallel group: G4 (never dispatched)
   - Risk: high (browser containment)
   - Owned scope: future Chromium launch/container security design.
   - Not in scope: current build.
   - Spike candidate: future isolated Docker/kernel compatibility study.
   - Actions: retain as a future security plan item.
   - Acceptance signal: not applicable.
   - Validation: deferred.
   - Acceptance evidence: deferred record carried from remaining-suite-work T006.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

7. [blocked] DEFERRED — old comprehensive README plan [DEF:README]
   - Task ID: T007
   - Depends on: none
   - Parallel group: G4 (never dispatched)
   - Risk: low
   - Owned scope: `.agents/plans/2026-08-03-comprehensive-readme-csm.md` (ready, never dispatched) only in a future plan.
   - Not in scope: current build; the repo README has already been rewritten by later work.
   - Spike candidate: none.
   - Actions: leave the 2026-08-03 plan unstarted and dispatchable as a future-plan candidate (repo-root public README: overview, CSM workflow diagram, six-skill table, install, quickstarts, layout, dev/testing, license note); D8 records why its ready status is intentional.
   - Acceptance signal: not applicable.
   - Validation: deferred.
   - Acceptance evidence: deferred record carried from remaining-suite-work T007.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

8. [blocked] DEFERRED — live-LLM behavioral evaluation harness (F-017 tier-b) [DEF:EVAL]
   - Task ID: T008
   - Depends on: none
   - Parallel group: G4 (never dispatched)
   - Risk: standard
   - Owned scope: future deterministic-eval harness with canned transcripts and a stubbed model, asserting activation-boundary answers for the doc-only skills.
   - Not in scope: current build; the deterministic corpus tier (F-017 tier-a) already completed.
   - Spike candidate: none; deferred by explicit user decision 2026-08-18.
   - Actions: leave as a future-plan candidate only.
   - Acceptance signal: not applicable.
   - Validation: deferred.
   - Acceptance evidence: deferred record carried from remaining-suite-work T008.
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

9. [blocked] DEFERRED — bootstrap publication, hosting, key rotation, post-publication replay [DEF:RELEASE]
   - Task ID: T009
   - Depends on: none
   - Parallel group: G4 (never dispatched)
   - Risk: high (credential-gated public release actions)
   - Owned scope: future user-approved release execution: npm publish of the exact audited bytes, signed-envelope hosting at an immutable HTTPS URL + origin pin + re-sign, keyring rotation, post-publication registry-spec offline replay (the offline runtime deliverable is the registry literal), steps.md re-sign.
   - Not in scope: current build; every action requires explicit user approval and credentials per bootstrap/release-checklist.md.
   - Spike candidate: none.
   - Actions: retain as release-stage records; T004's pre-release evidence is the input.
   - Acceptance signal: not applicable.
   - Validation: deferred.
   - Acceptance evidence: deferred record new in this plan (from release-checklist steps :13-15, :19-20).
   - Repair attempts: 0
   - Recovery note: do not dispatch; csm-build SELECT must ignore blocked tasks marked DEFERRED.

10. [blocked] Build the fixes identified by `2026-08-19-skills-review.md` (completed by 2026-08-20-t010-t011-csm — superseded)
   - Task ID: T010
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: all 68 upheld findings in `2026-08-19-skills-review.md` (F-001..F-069, excl. retracted F-066) — implemented per their remediation sketches.
   - Not in scope: deferred T005-T009; any fix not listed in `2026-08-19-skills-review.md`.
   - Spike candidate: none.
   - Actions: implement each fix with focused tests per `.agents/reviews/2026-08-19-skills-review.md` remediation sketches; record evidence in the journal.
   - Acceptance signal: all listed fixes implemented and verified; check-suite + affected suites green.
   - Validation: cheapest first — node --check, focused tests, then affected suites, then check-suite.
   - Acceptance evidence: per-fix diff + test output recorded in the journal.
   - Repair attempts: 0
   - Recovery note: independently revertible per fix.

11. [blocked] Complete the journal-learnings plan in full (completed by 2026-08-20-t010-t011-csm — superseded)
   - Task ID: T011
   - Depends on: none
   - Parallel group: G2
   - Risk: standard
   - Owned scope: every task (T001-T007) of `2026-08-20-embrace-journal-learnings-csm.md`, executed in full per that plan.
   - Not in scope: review findings (T010); deferred T005-T009.
   - Spike candidate: none.
   - Actions: run csm-build on `.agents/plans/2026-08-20-embrace-journal-learnings-csm.md` to completion; record evidence in the journal.
   - Acceptance signal: all 7 tasks of the journal-learnings plan complete with their acceptance evidence recorded.
   - Validation: cheapest first — per-task gates, then check-suite.
   - Acceptance evidence: journal-learnings plan Completion Review + check-suite output.
   - Repair attempts: 0
   - Recovery note: resume via the journal-learnings plan's own journal.

12. [completed] Follow the skill-suite efficiency and quota resilience plan in full — completed by sibling build `2026-08-20-skill-suite-efficiency-resilience-csm.md` (Status: complete; Current CSM state: COMPLETE; cycles 1-3: token-efficiency cuts, quota-pause/resume, model-switch resume contract, draft sidecar, retrieval-first protocol, gate hardening, resume-semantics tests, payload refresh digest e19a0d12)
   - Task ID: T012
   - Depends on: none
   - Parallel group: G3
   - Risk: standard
   - Owned scope: every task (T001-T008) of `2026-08-20-skill-suite-efficiency-resilience-csm.md`, executed in full per that plan — token-efficiency cuts, quota-pause/resume (PAUSED stop, save-and-stop protocol), model-switch resume contract, draft sidecar, retrieval-first protocol, gate hardening, resume-semantics tests, payload refresh.
   - Not in scope: review findings (T010); journal-learnings plan (T011); deferred T005-T009.
   - Spike candidate: none.
   - Actions: run csm-build on `.agents/plans/2026-08-20-skill-suite-efficiency-resilience-csm.md` to completion; record evidence in the journal.
   - Acceptance signal: all 8 tasks of the skill-suite efficiency and quota resilience plan complete with their acceptance evidence recorded.
   - Validation: cheapest first — per-task gates, then check-suite.
   - Acceptance evidence: skill-suite plan Completion Review + check-suite output.
   - Repair attempts: 0
   - Recovery note: resume via the skill-suite plan's own journal.

## Verification Strategy
- Fast per-task gates: `node --check` on touched files; `cd csm-browse && node scripts/check-skill.mjs`; `node scripts/check-suite.mjs` (<1s); scoped greps for T001.
- Task-level: csm-browse `npm test` under Node 22 (Docker-free, ~seconds); focused new tests before full suites; bootstrap suites self-pack (serial only, /tmp + payload writes).
- Final battery (T004): check-suite, boilerplate/matrix `--check` commands, five bootstrap suites (serial), browse units (+ e2e quick only with Docker), csm-scan serial full (~3 min), upload 2/2, double-pack determinism, cumulative-diff AC4 check. Coverage gate optional (no scan source changes planned).
- Parallel-safety: Wave-1 file writes are disjoint (.agents plans/index vs csm-browse tree); this plan's journal is csm-build-only; pack-invoking runs always serial.
- Known environment quirks: Node 22 PATH-prepend required (Node 20 default mis-expands globs; directory-form `--test` broken on Node 22); e2e skips cleanly without Docker; `/tmp/csm-pack-*` residue is expected.

## Risks And Recovery
- Sweep process-kill matching could reap an unrelated process — spike on real argv shapes, dry-run mode first, bounded pool-port + exact-argv match, marker suppression, focused tests; land dry-run-only or revert the sub-item independently if unsafe.
- Payload refresh changes release bytes — no digest pins exist; new digest recorded; historical digests in old journals are records and are not rewritten.
- npm pack environment dependence — the script isolates npm cache and fixes mtimes; T004's double-pack proves determinism.
- Concurrent pack-invoking runs race on the payload tree — serial execution is a hard discovered requirement.
- Closure edits must not touch COMPLETE plans — scoped acceptance greps, wave-checkpoint diff-union assertion, final-gate cumulative-diff check; redirect chain runs through the closed plan's Closure block only.
- Deferred records accidentally dispatched — blocked + DEFERRED labeling, G4 exclusion, SELECT ignores blocked; the 2026-08-03 plan is never dispatched from this build (D8).

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| T001 git-status acceptance breaks under Wave-1 parallelism | major | Scoped the porcelain check to the two owned paths; added wave-checkpoint diff-union assertion; AC4's cumulative diff evaluated at final gate | Critique finding 1 |
| `node --test tests/unit/` fails on Node 22; error propagated to three sections | major | All occurrences replaced with `cd csm-browse && npm test` under Node 22; directory-form advice removed; quirk recorded in Discovered Requirements | Critique reproduced the failure; npm test verified 106/106 |
| Three writers to this plan's journal inside G1 | major | csm-build-only journal writes codified in How To Execute + Discovered Requirements; T003 delivers rationale as evidence; recording moved to T004 action (4) | Critique finding 3 |
| Bootstrap suites race on the shared payload tree if concurrent | moderate | Serial-only execution recorded as a hard discovered requirement; noted any suite run refreshes the payload | offline/package-audit/integration tests all invoke packBootstrap() |
| Inconsistent treatment of the ready 2026-08-03 README plan | moderate | D8 added: intentionally left ready/dispatchable as the T007 future candidate; hazard accepted with rationale; build must not dispatch it | Critique finding 5 |
| README index fix under-scoped vs its own invariant | moderate | D7 upgraded: backfill all 6 missing lines + this plan's line + closure note + stale-status fix | .agents/README.md header invariant |
| Hash comparison not a specified runnable command | moderate | Pinned verbatim node one-liner in T002 with expected output `{compared:113,issues:[]}`; reverse direction via pack prune + bounded diff | Critique finding 7 |
| T004 did not execute checklist step 1 verbatim; payload-index digest missing | moderate | Added boilerplate/matrix `--check` commands and payload-index digest to T004 actions/evidence | release-checklist.md:7-9, :24 |
| Sweep spike unjustified; wrong model pass cited | moderate | Spike candidate added (real argv variance, dry-run mode); model re-pointed to host-side gate pass sweep.mjs:273-288 | Critique finding 9 |
| AC1 hard-pinned 439 without delta language | minor | "explained deltas allowed" added to AC1/T002/T004 baselines | Critique finding 10 |
| "Convention extracted verbatim" inaccurate | minor | D9 reworded: precedent + user-directed extension (journal row, index line, accurate wording) | Superseded plans' journals end at SAVED |
| check-skill path ambiguity | minor | `cd csm-browse && node scripts/check-skill.mjs` | csm-browse/scripts/check-skill.mjs |
| SKILL.md:148 rewrite underspecified (query-splitting rule) | minor | Rewrite must preserve splice-before-`?token=` rule; copy URL verbatim from state.json | SKILL.md existing rule |
| Optional checklist annotation ambiguity | minor | D10: journal-only records; checklist untouched | Critique finding 14 |
| /tmp/csm-pack-* workdir accumulation | minor | Recorded as expected residue in Discovered Requirements and Verification Strategy | packBootstrap finally-block |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-19 | 0 | INTAKE -> DISCOVER -> RESEARCH -> DRAFT | none | 3 parallel research tracks: payload hash-audit (4 stale files, canonical regen), CDP-residual code audit (106/106 units sandboxed; triage table), plan-inventory + closure conventions (edit list) | CRITIQUE |
| 2026-08-19 | 0 | CRITIQUE -> REMEDIATE -> VERIFY | none | Independent critic re-verified citations (hash audit, check-suite, 106/106 npm test on Node 22) and returned 15 findings (3 major, 6 moderate, 6 minor); all remediated (scoped git signal, npm-test fix, journal ownership, serial suites, D7/D8/D9/D10, pinned comparison command, sweep spike, verbatim step-1, delta language, path/query fixes); primary personally verified constraints, dependencies, and runnable signals | SAVED |
| 2026-08-19 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT | T001, T003 | Baseline: tree clean @ 23f1501, check-suite 441 OK, no NORMS.md; plan assumptions verified live (browse.mjs:99, SKILL.md:148, stale plan ready/4x[pending], .agents/README.md present). Wave 1 selected: T001 || T003 (disjoint file writes; journal csm-build-only) | DISPATCH |
| 2026-08-19 | 1 | DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT | T001, T003 | T001 done: closure edits per D9 (Status complete, Closure block, 4x[pending]->[blocked], journal row; attribution-only sibling naming); .agents/README.md 6 lines backfilled + consolidated plan added + stale in_progress fixed; signals: check-suite 441 OK, zero [pending], scoped porcelain = 2 owned files. T003 done: redactTelemetry wraps (browse.mjs :75/:87/:102 — deviation: redactProse unexported, used stronger exported redactTelemetry); SKILL.md diagnosis step 4 rewritten (verbatim-copy + splice-before-query, mechanical node -e form keeps token out of history); orphan-exec sweep pass (sweep.mjs:291-320) live-spiked with Docker: argv shapes captured, container-side peers host-visible (docker+exec token requirement proven mandatory), pool bound 9224-9234 verified, kills ENABLED (no dry-run fallback needed); +7 tests (4 sweep incl. live-captured shapes, 3 residuals incl. source pin). VERIFY: 113/113 npm test Node 22, check-skill PASS. REVIEW (independent, sweep = host process-kill): FIX-FIRST — F1 moderate positional argv (probe `docker exec <c> pgrep -af socat - …` could be SIGTERMed) REPAIRED (exact 3-token tail + container+1=socat + negatives pid16-19); F2 moderate SKILL.md manual form made //json/version (trailing / in cdpUrl) REPAIRED (replace-lone-slash wording, mechanical form first); F4 minor test gaps REPAIRED (docker-compose/sudo anchors, probe shape, tail-exactness, stub pattern tightened to escaped literal); F3 minor pid-reuse TOCTOU DISMISSED: pre-existing pattern shared with sibling orphan-gate pass (sweep.mjs:285), requires pid wrap in a sub-second window, SIGTERM-only, fix would touch out-of-scope docker.mjs. Re-VERIFY: 113/113, check-skill PASS, check-suite 441 OK. Residual evidence recorded: (a) ACCEPTED perf-only exec-per-connection — daemon amortizes one persistent WS (session-daemon.mjs:129), per-verb exec ~tens of ms vs multi-second page ops, sharing needs WS-aware mux redesign; (e) ACCEPTED tokenless static /json/protocol — public schema, no tunnel ever opened, Connection:close + forced destroy kills pipelined relay (regression auth.test.mjs:233-280), token would break stock CRI; (d) RESOLVED port-pool re-key fully implemented — ports.mjs:92-125 host bind-probe + stale-socat skip, sweep.mjs:273-302 both strata reaped, cleanup.mjs:55-91 exact --port killGate, ensure-browser.mjs:480-494 rotate-persist-kill-respawn; tests ports.test.mjs:151-191, auth.test.mjs:308-337. Committed 0131fe9 | SELECT (Wave 2: T002) |
| 2026-08-19 | 2 | SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> CHECKPOINT | T002 | Primary-executed (shared-state, serial): `node scripts/pack-bootstrap.mjs` under node v22.23.2/npm 10.9.8 -> tarball sha256 a3c735f4c5d300decb25a008d2b009fefdef2927633d67753b612e83ef10f208 (459015 B, 120 files); bootstrap diff bounded to the 4 expected payload files + payload-index.json; retired symbols (runExistingTenPipeline/processExistingTenRepo/scanExistingTen) absent from payload (rg exit 1); pinned comparison {compared:116, issues:[]} exit 0 (plan said 113 — researcher count discrepancy explained; material signal zero issues); check-suite 441 OK; five suites SERIAL: trust 2/2, package-audit 1/1, protocol 18/18, offline 8/8, integration 1/1 = 30/30; suite re-packs idempotent (diff unchanged after). Committed 1d739b4 | SELECT (Wave 3: T004) |
| 2026-08-19 | 3 | SELECT -> DISPATCH -> VERIFY -> CHECKPOINT -> completion gate -> COMPLETE | T004 | Step 1 verbatim: check-suite 441 OK; `sync-skill-boilerplate.mjs --check` OK no drift; `gen-readme-matrix.mjs --check` OK region matches contracts; five bootstrap suites serial 30/30 (2/1/18/8/1); browse `npm test` 113/113 Node 22; e2e quick 79/79 LIVE (FAIL:0, TOTAL:79, 49.3s, Docker up); csm-scan serial 1227/1227; csm-upload 2/2 (explicit-file form `node --test csm-upload/tests/upload.test.mjs` — no package.json; directory form hits the known Node 22 quirk). Step 2: double-pack deterministic — pack1==pack2==a3c735f4c5d300decb25a008d2b009fefdef2927633d67753b612e83ef10f208, equal to the T002 pack; cycle-2 journal digest transcription typo corrected in place (pack output authoritative). Step 3: toolchain Linux 6.8.0-107-generic x86_64 / node v22.23.2 / npm 10.9.8; payload-index.json sha256 ce6672bf03699070d77f502d27d22587d9053537d0af0c383c267ba1a6b3f5cd; warm-cache + dead-registry replay + npm-cache-verify evidence = offline suite 8/8 against the pack-isolated cache. (a)/(e)/(d) rationales recorded cycle 1. AC4: cumulative diff 23f1501..HEAD = the 13 expected files only; zero COMPLETE-plan files; 2026-08-03 comprehensive-readme, universal-bootstrap, remaining-active plans untouched; T005-T009 blocked DEFERRED records intact; SELECT never dispatched deferred work. bootstrap/ clean after double-pack (idempotent) | COMPLETE |
| 2026-08-20T17:39:02Z | 3 | SAVED -> closed (superseded by 2026-08-20-t010-t011-csm) | T010, T011 | closed as superseded — active tasks completed by sibling plan 2026-08-20-t010-t011-csm; no acceptance criteria claimed by this plan | closed |
| 2026-08-20 | 5 | COMPLETE -> (F-064-3 closure) | - | F-064-3 of T010's review findings RESOLVED: key.pem purged from the full history (user-approved) and force-pushed to origin (91a9c37...2b6e789); secret-format fixtures neutralized for GitHub push protection; closure recorded in the combined plan's journal | closed |

## Completion Review
Completed 2026-08-19 by csm-build, cycles 1-3, 4/4 active tasks complete; T005-T009 remain blocked DEFERRED records (user-directed).

1. T001 stale-plan closure: `2026-08-18-remaining-suite-work-csm.md` closed per D9 (Status complete, state NOT_STARTED, Next transition none, Closure block naming this plan, zero `[pending]` lines, journal row); `.agents/README.md` invariant restored — 6 missing artifact lines backfilled, this plan listed, closure noted, stale `in_progress` fixed. No COMPLETE plan file edited (attribution-only naming).
2. T003 CDP residuals: (b) host-side orphan-exec sweep pass implemented with live-argv spike (Docker up), conservative positional matching, marker suppression, dryRun support, kills enabled; independent review's FIX-FIRST findings repaired (positional argv match incl. diagnostic-probe exclusion, negative tests for wrapper/probe/tail shapes); pid-TOCTOU finding dismissed with recorded reasoning. (c) redactTelemetry wraps on all three browse.mjs error prints + SKILL.md:148 guidance rewritten (verbatim-copy, token never retyped, mechanical form keeps it out of shell history; trailing-/ cdpUrl shape handled). (a)/(e) formally accepted with rationale, (d) recorded resolved — all in the cycle-1 journal row. Browse 106→113 tests green; check-skill PASS.
3. T002 payload refresh: canonical pack synced exactly the 4 stale files + regenerated payload-index.json; retired legacy symbols absent; pinned hash comparison {compared:116, issues:[]}; check-suite 441 OK; five bootstrap suites serial 30/30; new tarball sha256 a3c735f4c5d300decb25a008d2b009fefdef2927633d67753b612e83ef10f208 (459015 B, 120 files) recorded.
4. T004 pre-release readiness (checklist steps 1-3 verbatim): all gates green — check-suite 441, boilerplate/matrix checks, bootstrap 30/30, browse 113/113, e2e quick 79/79 live, scan 1227/1227, upload 2/2; deterministic double-pack identical to the recorded digest; toolchain + payload-index digest (ce6672bf…) + warm/verify transcript evidence recorded. AC4 cumulative diff contains no COMPLETE-plan file; deferred records intact.

Reopened 2026-08-20 (user directive, T010-T012 amendment, recorded in the Progress Journal cycle-4 row): T010 (68 review findings) and T011 (journal-learnings plan) remain pending and are executed via the separately drafted combined plan; T012 completed by sibling build `2026-08-20-skill-suite-efficiency-resilience-csm.md` (Status: complete). Plan hygiene: Control + index refreshed; deferred T005-T009 records unchanged.

Final gate (primary, personal): every acceptance criterion has current recorded evidence; deferred work (CI T005, sandbox T006, README plan T007, eval harness T008, publication T009) stays blocked and was never dispatched; working tree clean after final commit; nothing pushed. Publication/hosting/key-rotation remain future user-approved actions per T009.
