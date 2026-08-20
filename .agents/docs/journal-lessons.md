# Journal Lessons — cross-plan reference

Synthesis of the recurring themes mined from this repo's plan journals, review
docs, and git history (2026-08-03..2026-08-20). Research source:
`.agents/plans/2026-08-20-embrace-journal-learnings-csm.md` (5 tracks: older
journals, newer journals, docs/approach/reviews, git history, current-state
map — 43 themes deduped).  The purpose is that future plans stop re-learning
these; each theme is either already encoded in a skill/plan/gate or is
embraced by a task in `.agents/plans/2026-08-20-t010-t011-csm.md` (J1-J7, R1-R9).

## Themes by class

### Findings — observed, stable facts about the system

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| F1 | Payload drift is unguarded by check-suite (`check-suite.mjs does NOT check payload drift`); refresh needed 3× with stale files | `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md:37`; commits 9d09292→1d739b4→71e96f1 | 3 refresh incidents | J1 `checkPayloadDrift` (dynamic count, `issues:[]`) |
| F2 | Directory-form `node --test <dir>` breaks on Node 22 ("Cannot find module"); glob/explicit-file forms required | commit 5e9bbf8 (csm-browse glob fix); `node --test csm-upload/tests/upload.test.mjs` explicit-file note (consolidated cycle 3) | recurs in every test-signal | J3 (glob-form audit) |
| F3 | Host default node is v20.20.2 (past EOL); v22.23.2 at `$HOME/.nvm/versions/node/v22.23.2/bin`; `nvm use` fails via `~/.npmrc` prefix conflict | 2026-08-16-skills-remediation-csm.md:374 ("`nvm use 22` fails"); journal-learnings Current-State | recurs in nearly every plan | J3 `with-node22.mjs` |
| F4 | Deferred items renumbered across 4+ plans (CI T013→T005, sandbox T006, README T007, eval T008, publication T009) | 2026-08-16-skills-remediation Control; 2026-08-18-remaining-suite-work AC5; 2026-08-19-consolidated T005-T009 | 4+ renumberings | J4 `.agents/docs/deferred.md` ledger |
| F5 | check-suite.mjs (676 lines) has zero direct test coverage; `pre-commit.test.mjs:27` stubs it | journal-learnings Current-State; review finding F-003 | — | R8 (F-003 harness `tests/check-suite.test.mjs`) |
| F6 | Check-suite count invariant drifts with every plan/rule (445→451→454→457→516→535→583→585): the gate is the count, not a literal | check-suite journal rows across 2026-08-16..2026-08-20; RD-4 baseline 585 | every plan adds/removes checks | J1 dynamic count + J2 baselines |
| F7 | `.agents/docs/**` is unvalidated by check-suite (zero `docs` refs); new docs need only a `.agents/README.md` index line | journal-learnings Current-State ("check-suite corpus blocks gate only plans/reviews/approaches") | — | J7 (this doc) indexing |

### Learnings — recurring operational lessons

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| L1 | Contended files are single-owner per wave; check-suite.mjs edits serialize (J1→J4→J5→R8) | 2026-08-16-suite-coherence D10; remediation-build cycle-4 convergence lesson; journal-learnings A6 | every build with gate surgery | Already embraced (serial chain + ownership table) |
| L2 | Every new check-suite rule ships a planted-defect negative test: complete temp corpus, specific-message assertion, never exit-1 alone | journal-learnings A5; C5/C11 critique resolutions; suite-improvements acceptance signals | rule-per-rule | Already embraced (J1/J4/J5 planted tests; R8 harness) |
| L3 | Acceptance-signal hygiene: bash -n clean, no `<...>` placeholders, `cmd \|\| test $? -eq N` (never `; test`), no `grep -q "$m"` over dash-leading tokens | R-c1/R-c2 (2026-08-15-csm-review-skill-csm Critique Resolution); suite-improvements Discovered Requirements | 3 recorded violations | J5 `check-plan-signals.mjs` lint |
| L4 | Verify actual files and diffs, not subagent summaries | 2026-08-03-csm-grill INTEGRATE ("Actual files and diffs inspected, not summaries"); consolidated INTEGRATE rule 3 | every dispatch | Already embraced (csm-build INTEGRATE) |
| L5 | Numbers/digests must be copied from artifacts, never retyped (plan said 113 vs observed {compared:116}; cycle-2 digest typo) | consolidated cycle-2 "researcher count discrepancy explained"; R1 journal-learnings R&D; 3 transcription incidents (6d7d2ed dedup, f03fecd tally fix) | 3 transcription incidents | J2 `record-gate-baseline.mjs` + gate-baselines.json |
| L6 | Subagent empty-result / dispatch-lost recurs; salvage rule = primary completion, never acceptance-by-summary | 2026-08-03-csm-grill (2 empty); 2026-08-15 research 4/5 empty; suite-coherence T002/T004; universal-bootstrap first review empty; remaining-active T003 | 6+ incidents | Already embraced (csm-build salvage rule; subagent resilience ladder) |
| L7 | Spike-before-implement for risky runtime changes (sweep argv shapes, CDP token gate, F-001 bare-probe, F-002 regex bound) | consolidated cycle-1 sweep spike; remaining-active T001 spike; combined plan spikes | every risky change | Already embraced (spike discipline; recorded transcripts) |
| L8 | Never weaken a gate to appease a test/plan; fix the mapping never the payload, fix the lint never the plan content | T001/T005 recovery notes (journal-learnings); suite-coherence "checker must pass on final suite" | recurring recovery rule | Already embraced (recovery-note convention) |

### Mistakes — incidents that produced a fix or a guard

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| M1 | Missing `format: csm-plan/1` frontmatter on the journal-learnings draft itself — gate red, live proof of the F-050 lesson | journal-learnings C1 (critical critique finding) | 1+ (plan-format rule) | Already embraced (plan-validation format-marker checks; F-050) |
| M2 | Live payload went stale 3× and was only caught at gate/pack time | commits 9d09292→1d739b4→71e96f1, 4 stale files; consolidated "payload hash-audit" track | 3 incidents | J1 (drift gate) |
| M3 | Journal digest transcription typo corrected in place (pack output authoritative) | consolidated cycle-2 journal row ("cycle-2 journal digest transcription typo corrected in place") | 1+ transcription | J2 (numbers from artifact) |
| M4 | Gate-baseline counts cited from the wrong era (plan cited 525/516 from the 516-era baseline; actual 535/526 after concurrent-plan drift) | cache-token-efficiency cycle-1 journal ("count corrections"); concurrent-plan drift | recurs under concurrency | J2 (machine-recorded, `--check`) |
| M5 | Retired symbols lingered in the vendored payload mirror until a pack re-run (vendored copies go stale on source retirement) | remaining-active T002 "COORDINATION NOTE for bootstrap payload owner"; lint-plan cycle-1 payload regen | each source retirement | J1 drift gate + pack-serial re-run |
| M6 | Pre-commit gate blocked the first commit because the payload was still dirty (sources committed separately) | lint-strictness cycle-1 journal ("hook gate blocked first commit (payload still dirty)") | 1+ | Already embraced (lefthook gate ordering + pack re-run) |
| M7 | A concurrent session's approach file exposed a latent template/corpus mismatch (bare marker vs YAML-frontmatter requirement) and blocked the commit | cache-token-efficiency journal (SAVED BLOCKED); formatMarkerOf bare-marker fix (5faf3c8) | 1 incident | Already embraced (formatMarkerOf accepts bare marker; gate fail-closed) |

### Adaptations — deliberate behavior changes encoded as tooling/discipline

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| A1 | Node 22 PATH-prepend recipe recurs in nearly every plan; replaced by one helper | 2026-08-16-skills-remediation-csm.md:374; journal-learnings T003 | nearly every plan | J3 `with-node22.mjs` (`--print`/`--exec`) |
| A2 | Glob-form `node --test` everywhere (Node 22 quirk) | commit 5e9bbf8; journal-learnings R2 audit | every test invocation | J3 (audit + fix) |
| A3 | Bootstrap suites run with `--test-concurrency=1`; five suites serial | consolidated Discovered Requirements; R7 acceptance signal | every bootstrap battery | Already embraced (serial pack rule) |
| A4 | `scripts/pack-bootstrap.mjs` never runs concurrently with another pack-invoking process | journal-learnings Discovered Requirements; combined-plan constraint | every build with packs | Already embraced (pack-serial rule) |
| A5 | D9 closure convention rewritten by hand every time (Control rewrite, Closure block, `[blocked]` rewrites, journal row) — source of transcription errors | journal-learnings Current-State ("closure convention (D9) rewritten by hand every time"); 6d7d2ed dedup, f03fecd tally | every closure | J6 `close-plan.mjs` (dry-run; sandbox-only real run) |
| A6 | Planted-defect tests use complete temp corpora (repo copy minus .git/node_modules) with specific-message assertions | journal-learnings C5/C11; T001/T004/T005 actions | every new rule | Already embraced (J1/J4/J5; R8 harness) |
| A7 | Gate baselines recorded so journal digests/numbers are machine-verifiable, never retyped | journal-learnings AC2 ("digests/numbers henceforth copied from this artifact") | — | J2 (gate-baselines.json) |
| A8 | INTEGRATE re-runs a task's acceptance after its Wave-A siblings settle (acceptance coupling) | combined plan F19 note; "never trust a green acceptance captured while a sibling held the same suite red" | every wave | Already embraced (F19) |

### Lessons — durable policy distilled from the above

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| D1 | Single-writer serialization for contended files; a failed chain task blocks forward motion, never parallel edits | combined plan Risks ("strict J1->J4->J5->R8 serialization"); suite-coherence D10 | every build | Already embraced (ownership table + wave serialization) |
| D2 | Count invariant is a count, not a literal; record the baseline at build start and explain deltas | journal-learnings Discovered Requirements; RD-4 (585); AC3 "count invariant recorded" | every check-suite mutation | J1/J2 (dynamic count + baselines) |
| D3 | Deferred records stay deferred with rationale recorded — never silently dropped; non-COMPLETE DEFERRED tasks must cite the ledger | D3 assumption (combined plan); journal-learnings C2 (rule scoped to non-COMPLETE; COMPLETE warn-only) | 5 carried records | J4 `.agents/docs/deferred.md` + `[DEF:<slug>]` rule |
| D4 | High-risk tasks require independent review (R1/R7/R8/J5 in this plan; F-001, sweep, T007 before) | combined plan AC6; prior REVIEW/REPAIR rounds | every high-risk task | Already embraced (review discipline) |
| D5 | Cross-plan coordination: parallel plans share README/gate files, so ownership tables + wave serialization are mandatory | combined plan Critique Resolution (3 critical ownership collisions); oxlint T004; skill-suite coordination | every multi-plan build | Already embraced (per-file ownership table) |
| D6 | Rejected: ownership registry + protected-hash registry — over-engineered for one concurrency incident (already adapted via write-discipline); hashes superseded by the drift gate + close-plan automation | journal-learnings A4; T006 "(A3/A4) closure automation replaces the hand-edit path; protected-hash registry remains rejected" | — | REJECTED (rationale above) |
| D7 | Forward recovery: a check-suite harness de-risks future gate work; baselines make journal numbers machine-verifiable | combined plan Risks ("R8's harness de-risks future check-suite work; J2's baselines make journal numbers machine-verifiable") | — | Already embraced (R8 harness; J2 baselines) |
| D8 | Never hand-edit lockfiles or payload-index.json; regenerate via pnpm install / pack re-run | R3 recovery ("never hand-edit the lockfile"); R7 recovery ("never hand-edit payload-index.json") | every supply change | Already embraced (R3/R7 notes) |

### Workarounds — concrete recipes that proved out

| # | Theme | Evidence | Frequency | Embraced by |
|---|---|---|---|---|
| W1 | `nvm use 22` fails (`~/.npmrc` prefix conflict) → PATH-prepend the nvm bin dir instead | 2026-08-16-skills-remediation-csm.md:374; journal-learnings Discovered Requirements | nearly every plan | J3 `with-node22.mjs` |
| W2 | `node --test <dir>` broken on Node 22 → glob/explicit-file forms | 5e9bbf8; csm-upload explicit-file note | every suite | J3 (audit) |
| W3 | pack-serial constraint → bootstrap suites run serially with `--test-concurrency=1` | consolidated Discovered Requirements | every pack | Already embraced (serial rule) |
| W4 | No check-suite test harness → planted-defect temp-dir negative tests until F-003 lands in R8 | journal-learnings T005 Recovery note; combined plan D9 | interim pattern | R8 (forward: `tests/check-suite.test.mjs`) |
| W5 | `.git`-less corpora (planted defects) must never be filtered by the F-053 untracked-ignore — no git, no filtering | combined plan D15; constraint "the corpus checks must still see planted files" | every planted test | R8 (git-gated untracked filter) |

## Rejected themes

| Theme | Rationale | Evidence |
|---|---|---|
| Ownership registry | Over-engineered for the one concurrency incident (the 2026-08-19 `push-my-work` branch interference); the incident was already adapted via write-discipline + salvage rule; a registry adds bookkeeping without preventing the failure mode | journal-learnings A4 |
| Protected-hash registry | Hashes are superseded by T001/J1 (payload-drift gate, forward comparison) + T006/J6 (close-plan automation removes the hand-paste path that motivated protected hashes); the hand-pasted hashes were themselves a transcription-drift source | journal-learnings A4; T006 note |

## Theme counts

- Findings: 7
- Learnings: 8
- Mistakes: 7
- Adaptations: 8
- Lessons: 8
- Workarounds: 5
- Rejected: 2 (recorded, not counted in the 43)
- **Total: 43 themes** (+2 rejected, marked with rationale)
