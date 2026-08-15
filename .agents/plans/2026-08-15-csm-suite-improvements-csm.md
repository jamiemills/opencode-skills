# csm-suite Improvements CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 12 tasks — 6 low (docs: plan/bdd-tdd/grill/review tmux, tooling descriptions, README), 5 standard (upload code, scan CLI, linter, perf baselines, final review), 1 high (csm-browse runtime code — public-interface behavior of a working skill; always requires independent review). No security/data/destructive tasks. ((IDs T001–T012; the T007 slot was freed when tmux moved to T007 during renumbering))

## Control
- Plan ID: csm-suite-improvements
- Status: in_progress
- Current CSM state: CHECKPOINT (G2) -> SELECT (G3)
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-15 build cycle 1 — G1 (T001..T008) + G2 (T009..T011) complete; all 11 gates verified by primary; linter 154 checks pass incl. planted-defect; baseline measured 1209/1209 @ 131.8s, CLI 7.05s/105KB, e2e unverified (Docker)
- Next transition: SELECT G3 — T012 (final hostile review)
- Active tasks: T001..T011 (complete); T012 next
- Blockers: none

## Goal

Improve the robustness, consistency, performance, quality, and usability of the eight-skill csm suite (csm-grill, csm-plan, csm-bdd-tdd, csm-build, csm-review, csm-scan, csm-browse, csm-upload) based on a comprehensive evidence-based review of the suite, fixing verified defects and canonicalizing drifted conventions without restructuring what works.

Deliverables:
1. Verified-defect fixes: csm-browse portability + error handling + state hygiene; csm-upload resilience; csm-scan CLI hygiene.
2. Canonicalized conventions: NORMS.md contract, subagent fallback ladder, csm-review tmux bootstrap, SAVED/commit phrasing, tooling-skill descriptions and H1s.
3. Measurable performance baselines (suite wall time, CLI latency, e2e duration) + recording discipline.
4. A persistent suite-conformance checker (`scripts/check-suite.mjs`) covering README link integrity, frontmatter, Never-X clauses, state lines, tmux-bootstrap presence, NORMS.md-section consistency, SKILL.md size budget.
5. README accuracy repair (mermaid edges, csm-scan CLI docs, skill-count claims) + Quickstart and Troubleshooting sections.

Constraints:
- csm-scan's non-negotiable constraints preserved: zero npm dependencies, exactly one writeFile, read-only command broker (rg/git only).
- The "orchestration skills are single-file with no test suite; validate by invoking" convention preserved — the new linter is a repo-root structural tool, not per-skill tests.
- No restructuring of csm-scan's lib/scan deep modules (deferred — see Assumptions A7).
- No new persistent writes except the files each task owns; no pushes.

Exclusions (anti-scope):
- No changes to csm-build/SKILL.md (its REPAIR classification system is retained as the deliberate build-specific shape; drift-matrix O4/O5 compensated).
- No refactor of csm-scan lib/scan/{deep,providers,render} internals (42k lines, green suite — separate future plan).
- No token/context-cost optimization (unmeasurable from this repo; size budget enforced by linter instead).
- No automated baseline-regeneration helper for csm-scan (deferred; documented in Discovered Requirements).
- No behavioral change to csm-upload's one-shot shape or csm-browse's verb architecture.
- Deliberately deferred (recorded here, not silently dropped): csm-browse `navigate` alias documentation, `status` artifactCount dead field, `open` loadEventFired doc mismatch, screenshot preset/quality no-op in full-page stitch path (capture.mjs:130,189) — each is a separate small doc/code fix, out of this plan's scope to keep task count bounded; tracked in Current-State Evidence for a future polish plan.

## Acceptance Criteria

1. No hardcoded author paths remain in runtime or test code: `grep -rn "/home/jamiemills" csm-browse/lib csm-browse/scripts csm-browse/tests csm-upload/scripts csm-scan/scripts` returns nothing; csm-browse `node scripts/check-skill.mjs` exits 0.
2. csm-browse error handling: misspelled verb and corrupt state.json produce clean usage/error messages, not unhandled stack traces. Evidence: `grep -B2 -A4 "mod.run" csm-browse/scripts/browse.mjs` shows the dynamic import and loadState inside a try/catch that prints a friendly message; `node --check` passes on all changed files.
3. csm-browse state hygiene: stale `cmd/` files are aged out (not executed after daemon restart); recorder stuck-state after restart is reconciled; port allocation is serialized. Evidence: greps for the age-out check in daemon-core.mjs, the recorder reset path on daemon start, and the SESSIONS_ROOT-level lock (or retry loop) in ports.mjs; `node --check` passes.
4. csm-upload: no fixed `/tmp/csm-pages` reuse (per-run mkdtemp or clean/repair); `github` validated after detection (clear error instead of `undefined` URL); clone-needed vs pull-failed distinguished; source files pre-validated. Evidence: greps for `mkdtemp`, the second-pattern/`gh api user` fallback + unset-check, the pull-vs-clone branch, and the pre-validation loop; `node --check` passes.
5. csm-scan CLI: `node scripts/scan.mjs --help` prints usage and exits 0; unknown flags exit 2 with an "unknown option" message; nonexistent repo path gives a friendly message; `--out` missing value errors instead of silently defaulting; full suite remains green (sandbox `node --test --test-concurrency=1`, ≥1204 pass) and new CLI behavior covered by tests in test/scan-cli.test.mjs. Evidence: gate output + test run + full-suite pass count + wall time.
6. NORMS.md contract canonicalized: csm-bdd-tdd matches csm-build's 3-marker authenticity gate + 30-day staleness (grep markers in csm-bdd-tdd/SKILL.md); csm-plan gains a NORMS.md detection/consumption section in DISCOVER (grep "Repository Norms (NORMS.md)" + "Generated by csm-scan" in csm-plan/SKILL.md); csm-review already conforms (grep confirms).
7. Subagent fallback ladder present in csm-plan, csm-grill, csm-bdd-tdd (grep "Minimal-prompt retry" + "journal every incident" in each); csm-build's classification system retained unchanged (grep "REPAIR" present, content untouched).
8. csm-review gains the `## Tmux Session Bootstrap` (session prefix `csm-review-<goal-slug>`), matching the four existing blocks (grep the section + the launch line); README tmux bullet updated to five skills (grep "csm-review" near "tmux" in README).
9. Tooling-skill frontmatter normalized: the description frontmatter line (line 3) of csm-scan/csm-browse/csm-upload gains "use when" triggers + a Never-X clause (grep the description line itself, not the body), all three gain an H1 `# CSM X` title, descriptions start capitalized, each ≤1024 chars.
10. README accuracy: mermaid keeps `scan -.-> plan` (plan is now a real NORMS consumer after T004) AND gains edges to build/bdd-tdd/review (grep the diagram lines); the "all flags in SKILL.md" claim fixed with a csm-scan `## CLI` section added to csm-scan/SKILL.md; Quickstart + Troubleshooting sections added; ffmpeg/curl listed in Requirements; broken examples fixed in their owning SKILL.mds — `grep -q "close --session" csm-browse/SKILL.md` and no literal `...` path in csm-upload/SKILL.md examples. Evidence: gate output + link-integrity loop.
11. `scripts/check-suite.mjs` exists, zero-dependency (node:fs, node:path, node:process), exits 0 on the final suite, exits 1 on a planted defect (negative test with a `--root` override against a temp copy), runs <2s; documented in README Development & testing.
12. Performance baselines recorded in `.agents/docs/csm-suite-performance-baseline-2026-08-15.md`: csm-scan full-suite wall time + pass count (measured: 164.5s / 1204 pass @ concurrency=1), csm-scan CLI scan latency on a fixed reference repo, csm-browse e2e duration; csm-scan/SKILL.md testing section gains a "record wall time at every gate run" discipline note; csm-browse e2e summary gains a duration field.
13. Final hostile review of all changes (T012) exists at `.agents/docs/csm-suite-review-2026-08-15.md` with a Verdict section and severity-tagged R-N findings, all resolved/disproved/deferred with recorded reasoning in this plan's Critique Resolution; final gate re-runs every acceptance gate.

## Current-State Evidence

- HEAD `4dafd82`, clean tree; 8 skills: orchestration (grill 207, plan 253, bdd-tdd 283, build 247, review 291 lines), tooling (scan 199, browse 108, upload 56).
- csm-scan suite: 1204/1204 green today (sandbox-verified, commit 4dafd822); wall time 164.5s @ concurrency=1 (stale journal estimates ~70–81s); 105 lib files, 42,697 lines; 26 files >400 lines (5 >1100); constraints hold (single write at lib/scan/write.mjs:92, zero external imports, broker only rg/git).
- Verified broken: csm-browse/lib/constants.mjs:1 hardcodes SKILL_DIR='/home/jamiemills/...' (consumed by ensure-browser.mjs:11,256 — daemon spawn breaks for any non-author install); csm-browse/SKILL.md:42 documents `browse.mjs <sid> close` but verb must be first (browse.mjs:31,48-51); csm-browse/scripts/browse.mjs:66 verb import outside try/catch (raw MODULE_NOT_FOUND stack); csm-upload/SKILL.md:40 has literal `...` path; csm-upload/scripts/upload.mjs:11,75,82-92 fixed /tmp/csm-pages + "undefined" user in URL + pull-failure misreport; csm-scan/scripts/scan.mjs:10-37 no --help/--version, unknown flags silently ignored, --help would run a full scan.
- Drift: NORMS.md gate 3 markers+staleness in build (csm-build/SKILL.md:55-83) and review (csm-review/SKILL.md:254-256) vs 1 marker, no staleness in bdd-tdd (csm-bdd-tdd/SKILL.md:32-45); csm-plan has zero NORMS.md references yet README.md:23 shows `scan -.-> plan`; subagent ladder only in csm-review (SKILL.md:258-267); tmux bootstrap token-identical in plan/build/bdd-tdd/scan (each ~L10-30), absent in review; tooling descriptions (scan/browse/upload L3) lack triggers + Never-X and start lowercase; browse/upload have no H1.
- csm-browse robustness: non-atomic port allocation (lib/ports.mjs:6-26), port release is a stub (ports.mjs:28-29, cleanup.mjs:60-62), stale cmd/ executed after daemon restart (daemon-core.mjs:44-125), recorder stuck state after restart (recorder.mjs:18,39-50), orphaned ffmpeg on SIGKILL (sweep.mjs:130-153), screenshot preset/quality no-ops in full-page stitch path (capture.mjs:130,189).
- No performance baselines exist for CLI latency or e2e duration; e2e summary JSON (csm-browse/tests/e2e.mjs:659-661) lacks timing fields; suite wall-time recording discipline lapsed at the 1204 run.
- Recurring journal issues: subagent empty-results ≥12 incidents (only recorded mitigation that worked: minimal-prompt retry — csm-review-skill plan A11); README↔SKILL drift recurring (16-vs-17, tmux counts, skill counts); embedded grep-gate fragility (option-injection, placeholder bash, set -e traps).

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Fix verified defects and canonicalize drifted conventions; do NOT restructure working shapes (orchestration/tooling split, one-shot upload, verb architecture) | evidence-based | Scout R1: uniform restructure churns deliberately-differentiated tools; research tracks found no structural defects | decided |
| A2 | "Performance" = measurable baselines only (suite wall time, CLI latency, e2e duration) + recording discipline; token/context cost explicitly excluded as unmeasurable | evidence-based | R6: no token metrics anywhere in repo; agentskills 500-line guidance enforced via linter instead | decided |
| A3 | Suite-conformance linter at repo root (scripts/check-suite.mjs, zero-dep) respects the "orchestration skills have no test suite" convention — it is a repo-level structural tool, not per-skill tests | evidence-based | R6 §3: csm-browse check-skill.mjs precedent; linter targets the #1 recurring defect class (cross-file drift); no authoritative body-linter exists (agentskills skills-ref validates frontmatter only) | decided |
| A4 | Canonical NORMS.md contract = csm-build's version (3 markers + 30-day staleness + nothing-blocked); bdd-tdd and plan align to it; csm-plan gains DISCOVER consumption matching the README diagram | evidence-based | Drift matrix D1/D3: build+review already agree; bdd-tdd gate weaker; plan has no consumption | decided |
| A5 | Canonical subagent fallback ladder = csm-review's 4-step ladder; added to plan, grill, bdd-tdd; csm-build's REPAIR classification system retained (orthogonal, deliberate) | evidence-based | Drift matrix D2/O2; R6 tally: subagent empty-results is the #1 recurring issue | decided |
| A6 | csm-review gains the tmux bootstrap (long-running autonomous skill; the suite's own tmux plan flagged it as a known gap) | evidence-based | tmux-bootstrap plan :17,199,202; review is the longest, most fragile run | decided |
| A7 | csm-scan lib/scan deep refactor explicitly deferred to a future plan (42k lines, 26 oversized files, green 1204 suite, high regression risk); only CLI hygiene in scope | evidence-based | R2 structure audit; constraints must stay green | decided |
| A8 | csm-upload description gains a Never-X clamp ("only to the configured pages repo; never pushes elsewhere") — it is the only skill that pushes | evidence-based | Usability D4: capability-list description invites out-of-context invocation | decided |
| A9 | README work lands in G2 (after content tasks) so its claims match landed state — the journals prove "README after content" is the safe order | evidence-based | R6 §5 recurring class: README↔SKILL drift; tmux-plan precedent | decided |
| A10 | Baseline doc (performance + suite state) written to .agents/docs/ during build; no new repo-root doc conventions | evidence-based | Existing .agents/docs precedent (csm-scan review docs, e2e summary) | decided |
| A11 | All tasks write only their owned files; no task pushes; commits only at checkpoints by csm-build | evidence-based | Suite commit conventions | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Doc-vs-code audit: do documented commands match actual CLIs? | Read-only grep/read of all SKILL.mds vs CLI parsers (browse.mjs, ensure-browser.mjs, upload.mjs, scan.mjs) | Read-only; git clean | 5 broken (close order, SKILL_DIR, e2e paths, no --help, screencast-name) + 11 inconsistent (screenshot preset no-op, --quality ignored, upload stale dir, gh regex, etc.) | Tasks T001/T002/T003/T009 fix the verified defects; T008 normalizes descriptions |
| R2 | Is csm-scan's suite green today, and at what cost? | Sandbox clone + `node --test --test-concurrency=1` (env-i, XDG/HOME redirected) | Writes confined to /tmp/opencode/scan-suite-3535495/; source repo clean before/after | 1204/1204 pass; wall 164.5s (not ~80s — stale estimate); constraints hold; 26 files >400 lines; dup helpers (readJSON ×5, resolveEcosystems ×6 divergent) | Baseline verified for T003/T012; perf baseline T011 uses real 164.5s; deep refactor deferred (A7) |
| R3 | csm-browse robustness surface? | Static audit of lib/{constants,ports,cleanup,sweep,session,recorder,daemon-core,collectors,cdp}, scripts, check-skill.mjs run | check-skill.mjs proven read-only before running; e2e NOT run (fuser -k port 8090, writes ~/.agents/docs) | 15 issues: portability, unhandled rejections, port race, release stub, stale cmd/ replay, recorder stuck state, orphaned ffmpeg, dropped events, dead code | Tasks T001 (code) + T009 (doc) scoped to these |
| R4 | Consistency drift across orchestration class? | Read-only diff of all 8 SKILL.mds per convention (15 conventions) | Read-only; git clean | D1 NORMS gate mismatch (high); D2 no ladder in plan (high); D3 plan doesn't consume NORMS (high); D4 upload boundary (med-high); U1 tmux ×4 token-identical; O3 review lacks tmux; H1/description drift | Tasks T004/T005/T006/T007/T008 |
| R5 | Usability of the suite as a new user sees it? | Read-only audit: descriptions, README accuracy (links/counts/diagram), activation friction, onboarding, CLI ergonomics, error signs | Read-only; git clean | U1 hardcoded path (high); U2 close doc (high); U3 csm-scan CLI undocumented + README:77 false claim (high); U5 mermaid edge false; U8 no quickstart/troubleshooting; ffmpeg/curl undeclared; broken `...` example | Tasks T009 (README + csm-scan CLI docs) + T008 (descriptions) |
| R6 | What is measurable performance + what quality infra fits conventions? | Read-only journal mining (13 plan files), web retrieval (agentskills.io, opencode.ai, skills-ref) | Read-only retrieval; git clean | Suite wall-time is the only recurring metric (70–81s recorded, now stale vs 164.5s measured); no CLI/e2e baselines; zero-dep linter proposal fits (csm-browse precedent); subagent empty-results = #1 recurring issue (≥12) | Tasks T010 (linter), T011 (baselines), T005/T006 ladder (A5) |

## Discovered Requirements

1. csm-browse check-skill.mjs validates frontmatter (name regex, dir match, desc ≤1024) + package.json + dep resolution — reuse its logic pattern in the suite linter rather than re-inventing (R6).
2. agentskills.io/OpenCode name regex: `^[a-z0-9]+(-[a-z0-9]+)*$`; description 1–1024 chars; body <500 lines guidance (all current SKILL.mds ≤291 — enforced by linter).
3. No automated baseline-regeneration helper exists for csm-scan; regeneration is manual across journals (recurring class) — noted for a future plan, not this one (A7 boundary).
4. README must be edited by content grep, never line numbers (it moves every plan).
5. All linter checks must be additive-safe: exit nonzero with a list on failure; zero false positives on the FINAL suite state (it must pass after all G1/G2 tasks land; a false positive means a check rule is wrong, never the content).
6. csm-scan constraints are test-enforced (constraints gate) — any scripts/scan.mjs change must keep exactly-one-write and zero-dep invariants, and the suite must stay ≥1204 green.
7. The tmux plan's session-name rule: `csm-review-<goal-slug>` lowercase hyphen-safe, numeric suffix on collision — copy the canonical block verbatim with the token swapped.
8. Every doc change to a skill ships with its README row/claim updated in the same batch (README task T009 validates this).
9. Recording discipline: every future csm-scan gate run records pass count + wall time (T011 adds this note to csm-scan/SKILL.md).
10. Acceptance-signal hygiene (learned cycle 1): under `set -e`, an expected-nonzero command must use `cmd ... || test $? -eq N` — never `cmd ...; test $? -eq N` (the `;` form aborts the shell before the test runs). Applies to T009/T010/T012 signals where exit codes are asserted.

## Design

### D1 Task-class model

- **Code fixes (T001–T003)**: surgical changes to csm-browse (portability, error handling, state hygiene), csm-upload (resilience), csm-scan (CLI hygiene). All keep existing architecture; no redesign.
- **Doc canonicalization (T004–T008)**: four conventions canonicalized from existing best-in-suite text: NORMS.md contract (from csm-build), subagent ladder (from csm-review), tmux bootstrap (from csm-plan, token-swapped), frontmatter/H1 (house style). Deliberate shapes retained: build's REPAIR machinery, upload one-shot, browse verb architecture.
- **README + CLI docs (T009)**: accuracy repair (mermaid edges, claims, broken examples) + Quickstart + Troubleshooting; lands in G2 so it reflects landed state.
- **Quality infra (T010)**: `scripts/check-suite.mjs` — zero-dep structural linter, runs in seconds, fails with a list.
- **Performance (T011)**: measure + record baselines; add recording discipline; add e2e duration field.
- **Gate (T012)**: independent hostile review of all changes + remediation + full gate re-run.

### D2 Canonical texts (single source for each convention)

- **NORMS.md contract** (from csm-build/SKILL.md:55-83): optionality ("entirely optional... nothing is blocked"); detection order (user-explicit → git-root → cwd → none-found-continue); 3 authenticity markers ("Generated by csm-scan" OR "## Repository Overview" + Code Conventions + Architecture); staleness warn >30 days. csm-bdd-tdd aligns (currently 1 marker, no staleness); csm-plan gains a DISCOVER-stage consumption rule; csm-review already conforms.
- **Subagent fallback ladder** (from csm-review/SKILL.md:258-267): 1 minimal-prompt retry → 2 narrowed re-dispatch → 3 fresh agent → 4 primary completion/primary-led (low/info only, recorded independence caveat); "journal every incident, never silently"; no-bypass rule for security/data/destructive/public-interface work. Added to csm-plan (in RESEARCH/CRITIQUE/REMEDIATE), csm-grill (Core Rules), csm-bdd-tdd (Safety And Isolation).
- **Tmux bootstrap** (from csm-plan/SKILL.md:10-30): same 5-step block, token-swapped to `csm-review-<goal-slug>`; intro line "before INTAKE... It is not a review state."
- **Frontmatter/H1**: all 8 skills: `name` regex-valid, description with activation triggers + Never-X clause (tooling: csm-scan "never runs target commands, installs, or writes beyond the single NORMS.md"; csm-browse "never targets the container's primary browser (port 9222)"; csm-upload "only to the configured pages repo; never pushes elsewhere"); H1 `# CSM X` title for all; capitalized start.

### D3 Linter spec (`scripts/check-suite.mjs`)

Zero npm deps (node:fs, node:path, node:process only). Checks, all additive:
1. For each `csm-*/SKILL.md`: frontmatter parses (name, description ≤1024); name regex `^[a-z0-9]+(-[a-z0-9]+)*$` + dir match; single H1; Never-X clause in descriptions; size budget <500 lines.
2. **Per-skill required-section map** (exact, matching deliberate shapes — verified against the real files at planning time):
   - csm-grill: `## Activation Boundary`, `## Core Rules`, `## Grilling State Machine`, `## Anti-Patterns`, `## Done Criteria`
   - csm-plan: `## Activation Boundary` (post-T004 rename), `## Core Rules`, `## Scale To The Ask`, `## Planning State Machine`, `## Repository Norms (NORMS.md)` (post-T004)
   - csm-bdd-tdd: `## Activation Boundary`, `## Non-Negotiable Rules`, `## Pipeline`, `## Anti-Patterns`, `## Done Criteria`, `## Repository Norms`
   - csm-build: `## Activation Boundary`, `## Core Rules`, `## Repository Norms (NORMS.md)`, `## Execution State Machine`, `## Completion Gate`
   - csm-review: `## Activation Boundary`, `## Core Rules`, `## Review State Machine`, `## Review Dimensions`, `## Finding Record`, `## Report Format`, `## Anti-Patterns`, `## Done Criteria`, `## NORMS.md`, `## Tmux Session Bootstrap` (post-T007)
   - csm-scan: `## Tmux Session Bootstrap`, `## When to use`, `## Dimensions`, `## Constraints (non-negotiable)`, `## Testing`
   - csm-browse: `## When to use this skill`, `## Verb reference`, `## Isolation note`
   - csm-upload: `## Requirements`, `## Usage`
3. State-line presence per skill: plan/grill/bdd-tdd/review must contain `SAVED -> STOP`; build must contain `RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT`.
4. tmux-bootstrap presence in exactly plan/build/bdd-tdd/scan/review (post-T007).
5. NORMS.md detection phrase ("Generated by csm-scan" OR "## Repository Overview") present in plan/build/bdd-tdd/review (post-T004/T005).
6. README: every `csm-*/...` path in README resolves; skill count in README matches actual skill dirs; tmux bullet lists exactly the bootstrap skills (plan/build/bdd-tdd/scan/review).
7. Exit 0 with a summary or exit 1 with a MISSING list. Runs in <2s. A `--root <dir>` override runs the checks against a different tree (used for the planted-defect negative test).
Anti-scope: no behavioral testing of skills; no writes; no network; no installs.

### D4 Performance baseline procedure (T011)

1. csm-scan full suite: `node --test --test-concurrency=1` in a fresh /tmp/opencode sandbox clone (env-i, redirected HOME/XDG), record pass/fail + wall time (expected ≥1204 pass, ~164s).
2. CLI latency: `time node scripts/scan.mjs --repos <reference-repo-clone-in-sandbox> --out /tmp/opencode/out/NORMS.md` on a fixed reference repo (perplexity-cli clone in sandbox), record wall time + output size.
3. csm-browse e2e: add `duration` fields to the summary JSON writer (tests/e2e.mjs:659-661) + a total-suite cap; record the last known quick-mode result (59/59) with duration when next runnable (Docker-gated; record as "unverified today" if not run).
4. Write `.agents/docs/csm-suite-performance-baseline-2026-08-15.md` with all numbers + method + date; add "record pass count + wall time at every gate run" to csm-scan/SKILL.md testing section.
Anti-scope: no token/context measurement (A2); no changes to csm-scan internals.

### D5 README + CLI docs (T009)

1. Mermaid: keep `scan -.-> plan` (plan becomes a real NORMS.md consumer via T004) and ADD edges `scan -.-> build/bdd-tdd/review` (the other three consumers); keep `scan --> review`; add a comment noting `review --> plan` is a human-in-the-loop feed.
2. csm-scan/SKILL.md gains a `## CLI` section documenting `node scripts/scan.mjs [--repos <path>...] [--out <path>]`, zero-arg default (cwd → cwd/NORMS.md), privacy-redaction behavior; README:77 claim corrected ("CLI reference in SKILL.md except where noted").
3. Fix broken examples: browse close (`close --session <sid>`), upload `...` path.
4. Add Requirements: ffmpeg (browse full-page stitch + screencast) and curl (ensure-browser) with "optional but required for full-page screenshots/video".
5. Add `## Quickstart` (5 steps: grill → plan → build; "say 'no tmux' to stay in-session") and `## Troubleshooting` (lost tmux session: `tmux ls`/attach; container not starting: check `docker ps` chromium-vnc; gh not authenticated: `gh auth login`; ffmpeg missing: install + note degraded capture).
6. Reclassify narrative: csm-scan described as "orchestration-shaped tooling" or moved into the orchestration group consistently across README (counts stay 5 orchestration / 3 tooling with a clarifying note).
7. Fix `~` vs `$HOME` path style in examples (use `$HOME`).

### D6 Build execution graph

- G1 (parallel, disjoint): T001 (csm-browse code), T002 (csm-upload code), T003 (csm-scan CLI), T004 (csm-plan docs), T005 (csm-bdd-tdd docs), T006 (csm-grill docs), T007 (csm-review tmux), T008 (tooling descriptions/H1).
- G2 (depends G1): T009 (README + csm-scan CLI docs + browse/upload SKILL.md example fixes), T010 (linter + run), T011 (performance baselines — depends on T001 for e2e.mjs ownership and on T003 for suite-green). T010 depends on T009 for README checks; T011 depends on T001 + T003.
- G3 (depends G2): T012 (final hostile review + remediation + final gate).
- Critical path: T001 → T011 → T012; long poles: T003 (164s suite), T011 (baseline runs).

## Execution Graph

- G1 (parallel, disjoint file ownership): T001 `csm-browse/{lib,scripts,tests}`; T002 `csm-upload/scripts/upload.mjs`; T003 `csm-scan/{scripts/scan.mjs,test/scan-cli.test.mjs,lib/scan/report/reporter.mjs}`; T004 `csm-plan/SKILL.md`; T005 `csm-bdd-tdd/SKILL.md`; T006 `csm-grill/SKILL.md`; T007 `csm-review/SKILL.md`; T008 `csm-{scan,browse,upload}/SKILL.md` (frontmatter+H1 only — disjoint from T009 which owns the same files' body/CLI sections; T009 is G2 so no same-batch collision).
- G2: T009 `README.md` + `csm-scan/SKILL.md` (CLI section) + `csm-browse/SKILL.md` + `csm-upload/SKILL.md` (example fixes); T010 `scripts/check-suite.mjs` (new) + README Development & testing line; T011 `.agents/docs/csm-suite-performance-baseline-2026-08-15.md` (new) + `csm-scan/SKILL.md` testing note + `csm-browse/tests/e2e.mjs` (duration field — by content anchor, post-T001).
- G3: T012 all files owned by earlier tasks (fixes only) + `.agents/docs/csm-suite-review-2026-08-15.md` (new) + this plan.
- Critical path: T001 → T011 → T012; long poles: T003 (164s suite), T011 (baseline runs).

## Numbered Plan

1. [completed] csm-browse: portability + error handling + state hygiene
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high (public-interface runtime changes to a working skill; independent review required)
   - Owned scope: csm-browse/{lib/constants.mjs, lib/ports.mjs, lib/cleanup.mjs, lib/sweep.mjs, lib/recorder.mjs, lib/daemon-core.mjs, lib/verbs/record.mjs, scripts/browse.mjs, scripts/session-daemon.mjs, tests/e2e.mjs}
   - Not in scope: lib/verbs/{capture,log,dom,input,nav,status,close}.mjs (except where the fix demands), SKILL.md (T009), package.json deps
   - Spike candidate: none — fixes are specified
   - Actions: (1) SKILL_DIR derives from `fileURLToPath(new URL('..', import.meta.url))` like browse.mjs:6 (also e2e.mjs SKILL_DIR; DOCS_DIR from env `CSM_E2E_DOCS_DIR` or os.homedir()); (2) wrap the dynamic verb import (browse.mjs:66 — currently OUTSIDE the only try/catch at :74 which covers mod.run) and loadState (browse.mjs:68) in a try/catch that prints a clean usage/error message instead of an unhandled rejection, while keeping the close-without-state path working; (3) serialize port allocation with a lock file at the SHARED SESSIONS_ROOT (not per-session dir — the port pool is cross-session) using O_EXCL + retry, or a retry loop that re-allocates on collision; make releasePorts actually verify/kill; (4) age out stale `cmd/` and `cmd/running/` files (daemon-core.mjs startQueueLoop: skip files older than e.g. 5 min or clear on daemon start) so no stale command replays after restart; (5) recorder: reconcile `activeRecording` vs `recorder.json` on daemon start (if running:true but no in-process recording, reset flag and surface a note); (6) sweep: add orphaned ffmpeg (pkill ffmpeg with session dir arg match) + partial .webm + `.stitch-*` cleanup; (7) e2e.mjs: derive paths portably; keep all existing behavior otherwise. Run `node --check` on every changed file; run `node scripts/check-skill.mjs` (must PASS).
   - Acceptance signal: `bash -c 'set -e; cd csm-browse; for f in lib/constants.mjs lib/ports.mjs lib/cleanup.mjs lib/sweep.mjs lib/recorder.mjs lib/daemon-core.mjs lib/verbs/record.mjs scripts/browse.mjs scripts/session-daemon.mjs tests/e2e.mjs; do node --check $f; done; ! grep -rn "/home/jamiemills" lib scripts tests; node scripts/check-skill.mjs | grep -q "skill check ok"; grep -q "new URL" lib/constants.mjs; echo BROWSE-GATE-PASS'` → `BROWSE-GATE-PASS`, exit 0
   - Validation: (1) acceptance signal; (2) grep: `try {` now precedes the verb import and loadState; (3) grep: recorder reset path on daemon start; (4) grep: cmd age-out logic; (5) manual sandbox probe (optional, if time allows): start a session in sandbox and invoke an unknown verb → clean message not stack.
   - Acceptance evidence: gate output + per-fix grep evidence recorded at CHECKPOINT.
   - Repair attempts: 0
   - Recovery note: partial fixes detectable via the gate (missing grep markers); complete remaining fixes only.

2. [completed] csm-upload: resilience fixes
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: csm-upload/scripts/upload.mjs
   - Not in scope: SKILL.md (T009 fixes its `...` example and T008 its description/H1), config file format, pages-repo semantics
   - Spike candidate: none
   - Actions: (1) replace fixed `/tmp/csm-pages` with a per-run `fs.mkdtemp(join(tmpdir(), 'csm-pages-'))` (or clean/repair the fixed dir: if `.git` exists pull, else if non-empty non-git, move aside and re-clone); (2) after gh detection, validate `github` is set — if the regex `/account\s+(\S+)/` misses (e.g. "as jamiemills" format), fall back to a second pattern or `gh api user --jq .login` and fail with a clear message if still unset; never build an `undefined` URL; (3) distinguish clone-needed from pull-failed (check `.git` existence before choosing; on pull failure, report the pull error, don't re-clone into a non-empty dir); (4) pre-validate all source files exist before any git/copy work; (5) on any mid-run failure, report partial state (files copied so far) and suggest a retry; keep single-responsibility CLI shape.
   - Acceptance signal: `bash -c 'set -e; node --check csm-upload/scripts/upload.mjs; ! grep -q "csm-pages\b.*tmp\|/tmp/csm-pages" csm-upload/scripts/upload.mjs; grep -q "mkdtemp\|else.*move" csm-upload/scripts/upload.mjs; grep -q "gh api user\|second pattern\|still unset\|undefined" csm-upload/scripts/upload.mjs; echo UPLOAD-GATE-PASS'` → `UPLOAD-GATE-PASS`, exit 0
   - Validation: acceptance signal; grep: pre-validation loop before git ops; grep: pull-vs-clone branch.
   - Acceptance evidence: gate output + grep evidence.
   - Repair attempts: 0
   - Recovery note: partial changes detectable via gate greps; resume by completing missing fixes.

3. [completed] csm-scan: CLI hygiene (--help, flag validation, path errors)
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (touches a 1204-test-gated tool; suite must stay green)
   - Owned scope: csm-scan/scripts/scan.mjs, csm-scan/test/scan-cli.test.mjs, csm-scan/lib/scan/report/reporter.mjs (error-hint only)
   - Not in scope: lib/scan internals, NORMS.md output format, privacy redaction semantics
   - Spike candidate: none
   - Actions: (1) add `--help` (prints usage: `scan.mjs [--repos <path>...] [--out <path>]` + zero-arg default + privacy note; exits 0, does NOT scan) and `--version` (prints package version or commit); (2) unknown flags: print `unknown option: <flag>` + usage hint to stderr, exit 2 (never silently ignore) — ensure the CLI-arg error path bypasses or passes unredacted through the sanitized-stdio reporter (CLI-arg text is user-typed, not scan output); (3) pre-validate each `--repos` path exists and is a directory — friendly error naming the bad path (the user typed it; redaction of scan internals is preserved); (4) `--out` missing value: error, don't silently default; (5) add CLI tests to test/scan-cli.test.mjs covering --help exit 0 + usage text, unknown flag exit 2, missing --out value, nonexistent repo path message; (6) keep exactly-one-write and zero-dep invariants. Full suite must pass in sandbox: `node --test --test-concurrency=1` (≥1204 pass).
   - Acceptance signal: `bash -c 'set -e; cd csm-scan; node --check scripts/scan.mjs; node scripts/scan.mjs --help | grep -qi "usage"; node scripts/scan.mjs --help >/dev/null 2>&1; test $? -eq 0; node scripts/scan.mjs --bogus 2>&1 | grep -qi "unknown option"; node scripts/scan.mjs --bogus >/dev/null 2>&1; test $? -eq 2; echo SCAN-CLI-GATE-PASS'` → `SCAN-CLI-GATE-PASS`, exit 0
   - Validation: (1) acceptance signal; (2) new tests in scan-cli.test.mjs pass (`node --test --test-concurrency=1 test/scan-cli.test.mjs`); (3) full suite green in sandbox (164s — the expensive gate); (4) grep: no new writeFile; no new imports.
   - Acceptance evidence: gate output + test run results + full-suite pass count + wall time recorded.
   - Repair attempts: 0
   - Recovery note: CLI gate detects regressions immediately; full-suite failures pinpoint via failing test names.

4. [completed] csm-plan: NORMS.md consumption + fallback ladder + boundary alignment
   - Task ID: T004
   - Depends on: none
   - Parallel group: G1
   - Risk: low (docs)
   - Owned scope: csm-plan/SKILL.md
   - Not in scope: other skills' files, README (T009)
   - Spike candidate: none
   - Actions: (1) add a `## Repository Norms (NORMS.md)` section (after Scale To The Ask) with the canonical D2 contract: optionality, detection order (user-explicit → git-root → cwd → none-continue), 3 authenticity markers, 30-day staleness warning, consumed as hints re-verified during DISCOVER (mirror csm-build text); (2) add a "Subagent Resilience" subsection (or Core Rules bullet) with the canonical 4-step ladder + journal-every-incident rule, applied to RESEARCH/CRITIQUE/REMEDIATE dispatches; (3) rename `## Non-Negotiable Planning Boundary` → `## Activation Boundary` (content unchanged) for class consistency.
   - Acceptance signal: `bash -c 'set -e; grep -q "Repository Norms (NORMS.md)" csm-plan/SKILL.md; grep -q "Generated by csm-scan" csm-plan/SKILL.md; grep -q ">30 days\|30-day" csm-plan/SKILL.md; grep -q "Minimal-prompt retry" csm-plan/SKILL.md; grep -q "## Activation Boundary" csm-plan/SKILL.md; ! grep -q "## Non-Negotiable Planning Boundary" csm-plan/SKILL.md; echo PLAN-DOCS-GATE-PASS'` → `PLAN-DOCS-GATE-PASS`, exit 0
   - Validation: grep markers; line count stays 200-340 (plan currently 253).
   - Acceptance evidence: gate output + section diff summary.
   - Repair attempts: 0
   - Recovery note: gate greps identify missing section; add incrementally.

5. [completed] csm-bdd-tdd: NORMS.md gate alignment + fallback ladder
   - Task ID: T005
   - Depends on: none
   - Parallel group: G1
   - Risk: low (docs)
   - Owned scope: csm-bdd-tdd/SKILL.md
   - Not in scope: other files
   - Spike candidate: none
   - Actions: (1) upgrade the NORMS.md authenticity gate from 1 marker to the canonical 3 markers + add the 30-day staleness warning + "nothing is blocked" phrasing (align with csm-build); (2) add the canonical subagent fallback ladder to Safety And Isolation (or a Subagent Resilience subsection) with journaling rule.
   - Acceptance signal: `bash -c 'set -e; grep -q "Code Conventions" csm-bdd-tdd/SKILL.md; grep -q "Architecture" csm-bdd-tdd/SKILL.md; grep -q "30-day\|>30 days" csm-bdd-tdd/SKILL.md; grep -q "Minimal-prompt retry" csm-bdd-tdd/SKILL.md; echo BDD-DOCS-GATE-PASS'` → `BDD-DOCS-GATE-PASS`, exit 0
   - Validation: grep markers; line budget.
   - Acceptance evidence: gate output.
   - Repair attempts: 0
   - Recovery note: gate greps identify missing content.

6. [completed] csm-grill: subagent fallback ladder
   - Task ID: T006
   - Depends on: none
   - Parallel group: G1
   - Risk: low (docs)
   - Owned scope: csm-grill/SKILL.md
   - Not in scope: other files
   - Spike candidate: none
   - Actions: add the canonical subagent fallback ladder (minimal-prompt retry → narrowed re-dispatch → fresh agent → primary completion; journal every incident) to Core Rules, noting SCOUT/DEEP_DIVE dispatches must never silently degrade to primary-only research for a large idea (independence caveat recorded).
   - Acceptance signal: `bash -c 'set -e; grep -q "Minimal-prompt retry" csm-grill/SKILL.md; grep -q "journal every incident" csm-grill/SKILL.md; echo GRILL-DOCS-GATE-PASS'` → `GRILL-DOCS-GATE-PASS`, exit 0
   - Validation: grep markers; line budget.
   - Acceptance evidence: gate output.
   - Repair attempts: 0
   - Recovery note: grep identifies missing content.

7. [completed] csm-review: tmux session bootstrap
   - Task ID: T007
   - Depends on: none
   - Parallel group: G1
   - Risk: low (docs)
   - Owned scope: csm-review/SKILL.md
   - Not in scope: other skills' bootstrap blocks (deliberate exclusions for grill/browse/upload per tmux plan), README (T009)
   - Spike candidate: none
   - Actions: insert the canonical `## Tmux Session Bootstrap` block immediately after the intro (before Activation Boundary), per D2, token-swapped to `csm-review-<goal-slug>`; intro clause "before INTAKE... It is not a review state."; keep the 5-step structure identical to the other four skills; do not alter any other section.
   - Acceptance signal: `bash -c 'set -e; grep -q "## Tmux Session Bootstrap" csm-review/SKILL.md; grep -q "csm-review-<goal-slug>" csm-review/SKILL.md; grep -q "tmux new-session -d -s" csm-review/SKILL.md; echo REVIEW-TMUX-GATE-PASS'` → `REVIEW-TMUX-GATE-PASS`, exit 0
   - Validation: diff the inserted block against csm-plan's for token-only differences; line budget 200-340 (review currently 291 + ~20 = ~311, within budget).
   - Acceptance evidence: gate output + diff check.
   - Repair attempts: 0
   - Recovery note: block partially inserted → diff check reveals; complete it.

8. [completed] Tooling-skill frontmatter + H1 normalization
   - Task ID: T008
   - Depends on: none
   - Parallel group: G1
   - Risk: low (docs)
   - Owned scope: csm-scan/SKILL.md (description + H1 only), csm-browse/SKILL.md (description + H1 only), csm-upload/SKILL.md (description + H1 only)
   - Not in scope: any body content beyond the description frontmatter line and the H1 title; csm-upload `...` example (T009)
   - Spike candidate: none
   - Actions: (1) csm-scan description: capitalized start + "use when" triggers (onboarding, planning input, cross-repo audit) + Never-X ("never runs target commands, installs, or writes beyond the single NORMS.md; read-only"); H1 `# CSM Scan`; (2) csm-browse description: "use when" triggers + Never-X ("never targets the container's primary browser on port 9222; drives its own isolated Chromium only"); H1 `# CSM Browse`; (3) csm-upload description: "use when" triggers + Never-X ("uploads only to the configured GitHub Pages repo; never pushes elsewhere"); H1 `# CSM Upload`; keep each description ≤1024 chars.
   - Acceptance signal: `bash -c 'set -e; for s in csm-scan csm-browse csm-upload; do grep -q "# CSM " $s/SKILL.md || { echo "NO H1: $s"; exit 1; }; D=$(sed -n "3p" $s/SKILL.md); echo "$D" | grep -q "use when" || { echo "NO TRIGGER IN DESC: $s"; exit 1; }; echo "$D" | grep -q "never" || { echo "NO NEVER-X IN DESC: $s"; exit 1; }; L=$(sed -n "3p" $s/SKILL.md | wc -c); test $L -le 1100 || { echo "DESC TOO LONG: $s"; exit 1; }; done; echo DESCRIPTIONS-GATE-PASS'` → `DESCRIPTIONS-GATE-PASS`, exit 0
   - Validation: each description frontmatter line (line 3) contains "use when" AND "never"; capital start; ≤1024 chars (the wc -c guard at 1100 tolerates the `description: ` prefix and newline).
   - Acceptance evidence: gate output + description diffs.
   - Repair attempts: 0
   - Recovery note: per-skill gate failures list which file needs work.

9. [completed] README accuracy repair + Quickstart + Troubleshooting + csm-scan CLI docs + example fixes
   - Task ID: T009
   - Depends on: T001, T002, T003, T004, T005, T006, T007, T008 (must reflect landed state)
   - Parallel group: G2
   - Risk: low (docs)
   - Owned scope: README.md, csm-scan/SKILL.md (`## CLI` section), csm-browse/SKILL.md (close-example fix), csm-upload/SKILL.md (`...` example fix)
   - Not in scope: frontmatter/H1 of the tooling skills (T008), any other skill body content
   - Spike candidate: none
   - Actions: per D5: (1) mermaid: keep `scan -.-> plan` AND add edges to build/bdd-tdd/review (all four are NORMS.md consumers post-T004/T005); keep scan → review; note review → plan is human-in-the-loop; (2) csm-scan/SKILL.md `## CLI` section: `node scripts/scan.mjs [--repos <path>...] [--out <path>]`, zero-arg default, privacy-redaction note; README:77 claim softened ("full reference in SKILL.md; CLI flags documented in csm-scan/SKILL.md"); (3) fix csm-browse/SKILL.md:42 close example → `browse.mjs close --session <sid>`; fix csm-upload/SKILL.md:40 `...` path example to a real path; (4) Requirements: add ffmpeg + curl bullets (browse full-page stitch + screencast; ensure-browser); (5) `## Quickstart` (5 steps + "say 'no tmux' to stay in-session") and `## Troubleshooting` (tmux lost: `tmux ls`/`tmux attach -t`; container: `docker ps`; gh auth; ffmpeg missing → degraded capture note); (6) csm-scan classification note (orchestration-shaped tooling — clarify, keep counts); (7) `$HOME` path style consistently; (8) update the tmux bullet to five skills (plan/build/bdd-tdd/scan/review).
   - Acceptance signal: `bash -c 'set -e; grep -q "## Quickstart" README.md; grep -q "## Troubleshooting" README.md; grep -q "ffmpeg" README.md; grep -q "curl" README.md; grep -q "close --session" csm-browse/SKILL.md; ! grep -q "\.\.\." csm-upload/SKILL.md; grep -q "## CLI" csm-scan/SKILL.md; grep -q "csm-review" README.md; test $(grep -c "csm-review" README.md) -ge 8; echo README-GATE-PASS'` → `README-GATE-PASS`, exit 0
   - Validation: (1) link-integrity loop: `grep -oE "csm-[a-z-]+/[A-Za-z0-9_./-]+" README.md | while read p; do [ -e "$p" ] || echo "MISSING $p"; done` — empty output; (2) mermaid edge check: `grep -n "scan\[" README.md` shows NORMS.md node feeding plan AND build/bdd-tdd/review; (3) all previously-passing README claims still hold (17 dimensions etc.).
   - Acceptance evidence: gate output + link check + section diffs.
   - Repair attempts: 0
   - Recovery note: gate greps identify missing sections; link loop finds broken paths.

10. [completed] Suite conformance checker
    - Task ID: T010
    - Depends on: T009 (README must be final for link checks), T004, T005, T007 (section presence)
    - Parallel group: G2
    - Risk: standard (new tool; must pass on final suite, fail on planted defects)
    - Owned scope: scripts/check-suite.mjs (new dir at repo root), README.md (one line in Development & testing)
    - Not in scope: per-skill test suites; behavioral testing; any other file
    - Spike candidate: none
    - Actions: per D3 — write `scripts/check-suite.mjs` (zero deps, node:fs/node:path/node:process only) implementing exactly the D3 per-skill map (frontmatter parse + name regex + dir match + description ≤1024 + single H1; the per-skill required-section table; state-line presence; Never-X in descriptions; tmux-bootstrap presence in exactly plan/build/bdd-tdd/scan/review; NORMS.md detection phrase in plan/build/bdd-tdd/review; SKILL.md size <500 lines; README link integrity + skill-count match + tmux bullet lists the 5) plus a `--root <dir>` override so the same checks run against a temp copy. Exit 0 with a summary or exit 1 with MISSING lines. Add `node scripts/check-suite.mjs` to README Development & testing.
    - Acceptance signal: `bash -c 'set -e; node scripts/check-suite.mjs; D=$(mktemp -d /tmp/opencode/planted-XXXXXX); cp -r csm-scan "$D/"; sed -i "s/^## Tmux Session Bootstrap/## Planted-Broken/" "$D/csm-scan/SKILL.md"; if node scripts/check-suite.mjs --root "$D" >/dev/null 2>&1; then echo "PLANTED-DEFECT-NOT-CAUGHT"; exit 1; fi; rm -rf "$D"; node scripts/check-suite.mjs >/dev/null; echo LINTER-GATE-PASS'` → `LINTER-GATE-PASS`, exit 0
    - Validation: (1) acceptance signal (planted defect = missing required tmux section in the copy → checker must exit 1); (2) `grep -c "require(" scripts/check-suite.mjs` — 0 (imports only); (3) runtime <2s.
    - Acceptance evidence: gate output + planted-defect test output.
    - Repair attempts: 0
    - Recovery note: checker failure output lists exactly what's missing; fix suite or checker (checker must pass on final suite — never patch checker to appease it).

11. [completed] Performance baselines + recording discipline
    - Task ID: T011
    - Depends on: T001 (e2e.mjs ownership — duration edit by content anchor, not line numbers), T003 (suite must be green before the full-suite baseline run)
    - Parallel group: G2
    - Risk: standard (long-running measurements)
    - Owned scope: .agents/docs/csm-suite-performance-baseline-2026-08-15.md (new), csm-scan/SKILL.md (testing-section note), csm-browse/tests/e2e.mjs (duration fields)
    - Not in scope: any csm-scan lib change; token measurement (A2)
    - Spike candidate: none
    - Actions: (1) sandbox clone + full suite run, record pass count + wall time (expect ≥1204, ~164s); (2) CLI latency: clone reference repo (perplexity-cli) into sandbox, `time node scripts/scan.mjs --repos <clone> --out <sandbox>/NORMS.md`, record wall time + output size; (3) add `duration` fields to the e2e summary-JSON writer (locate by the summary-object content, e.g. the object with `pass`/`quick` keys) + a total-suite wall cap constant; (4) add the "record pass count + wall time at every gate run" note to csm-scan/SKILL.md testing section; (5) write the baseline doc with method, commands, numbers, date, environment.
    - Acceptance signal: `bash -c 'set -e; test -f .agents/docs/csm-suite-performance-baseline-2026-08-15.md; grep -q "wall" .agents/docs/csm-suite-performance-baseline-2026-08-15.md; grep -q "1204\|pass" .agents/docs/csm-suite-performance-baseline-2026-08-15.md; grep -q "record" csm-scan/SKILL.md; grep -q "duration" csm-browse/tests/e2e.mjs; echo BASELINE-GATE-PASS'` → `BASELINE-GATE-PASS`, exit 0
    - Validation: baseline doc numbers match actual runs (commands in doc are reproducible); e2e.mjs still `node --check` clean.
    - Acceptance evidence: gate output + the measured numbers in the journal.
    - Repair attempts: 0
    - Recovery note: missing doc or missing numbers detectable via gate; re-run only the missing measurement.

12. [pending] Final hostile review + remediation + final gate
    - Task ID: T012
    - Depends on: T009, T010, T011
    - Parallel group: G3
    - Risk: standard (final quality gate)
    - Owned scope: .agents/docs/csm-suite-review-2026-08-15.md (new), any file any earlier task owns (fixes only), this plan file
    - Not in scope: csm-scan lib internals (A7)
    - Spike candidate: none
    - Actions: (1) dispatch 3 parallel fresh-eyes review passes: (a) code correctness — T001/T002/T003 diffs vs their acceptance signals (does each fix the root cause, any regressions, style consistency); (b) docs consistency — T004–T009 against the drift matrix (did every D1–D7/O1–O6 item land, any new contradictions, README matches landed skills); (c) suite integrity — run `node scripts/check-suite.mjs` fresh, re-run all 12 acceptance gates, check no out-of-scope edits (git diff scope audit vs plan ownership map); (2) aggregate findings into `.agents/docs/csm-suite-review-2026-08-15.md` with R-N ids + severity + section + correction + a `## Verdict` section; (3) remediate all accepted findings; (4) re-run every gate; (5) fill Critique Resolution rows that literally contain each R-N id; (6) update Control to complete.
    - Acceptance signal: `bash -c 'set -e; F=.agents/docs/csm-suite-review-2026-08-15.md; P=.agents/plans/2026-08-15-csm-suite-improvements-csm.md; test -f "$F"; grep -q "## Verdict" "$F"; if grep -qE "R-[0-9]+" "$F"; then for i in $(grep -oE "R-[0-9]+" "$F" | sort -u); do grep -q "$i" "$P" || { echo "UNRESOLVED: $i"; exit 1; }; done; fi; node scripts/check-suite.mjs; echo FINAL-SUITE-GATE-PASS'` → `FINAL-SUITE-GATE-PASS`, exit 0
    - Validation: all 12 earlier acceptance signals re-run clean (recorded in journal); git status clean after final commit; nothing pushed.
    - Acceptance evidence: review doc + gate outputs + full gate re-run table.
    - Repair attempts: 0
    - Recovery note: unresolved R-N ids detectable via the gate; complete rows; never mark complete with unresolved critical/major findings.

## Verification Strategy

Cheapest first: (1) per-task `node --check` + grep gates (seconds); (2) csm-browse `node scripts/check-skill.mjs` (fast); (3) new csm-scan CLI tests (seconds); (4) `node scripts/check-suite.mjs` — the persistent repo-wide gate (G2+, <2s, run at every checkpoint after T010); (5) csm-scan full suite in sandbox clone (`node --test --test-concurrency=1`, ~164s — the expensive gate; required for T003 and T012); (6) T012 three-pass hostile review (the quality bar for the public-interface code changes). Environment sensitivity: full suite requires `rg` + `git` on PATH (sandbox-proven); e2e requires Docker (chromium-vnc) and is quick-mode gated; measurements in T011 are environment-specific — the doc records the environment. No known flaky checks.

## Risks And Recovery

- csm-browse code regression (T001) → independent review mandated (T012 pass a); `node --check` + check-skill gates; rollback = git revert the checkpoint commit; never touch lib/verbs behavior except the specified fixes.
- csm-scan suite regression (T003) → full-suite gate is the T003 acceptance; if a change breaks the suite, repair per the failing test names; never patch tests to appease (constraints gate is test-enforced).
- Linter false-positive on final suite (T010) → its acceptance requires passing on the final suite; if a check flags legitimate content, fix the check rule, never the content to appease it.
- Concurrent user work (history shows plans landing mid-build) → csm-build RECOVER protects concurrent changes; all tasks work by content grep; never revert user commits.
- T011 measures fresh; the plan's suite-gate expectations use ≥1204, not wall-time targets.
- Subagent empty-results during build (known issue) → T012 applies the fallback ladder (minimal-prompt retry → re-dispatch → fresh agent → primary-led with recorded caveat); every incident journaled.
- Scope creep into csm-scan lib internals → anti-scope in T003/T011; A7 decision recorded; review pass (c) audits the diff scope.
- Rollback: all tasks write only owned files; revert = delete new files or git revert the checkpoint commit; no task touches shared state beyond README.md and the owned SKILL.mds.

## Critique Resolution

Planning critique of the draft (2026-08-15) returned 20 findings; verdict NOT READY. All addressed before SAVED:

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| P-1 Linter per-class section list impossible on final suite (plan/grill/bdd-tdd/build lack required sections; no task adds them; upload lacks "When to use") | critical | D3/T010 rewritten as an exact per-skill section map verified against real headers; upload check dropped to `## Requirements`+`## Usage`; build's 8-section shape mapped as-is | D3; T010 |
| P-2 browse close + upload `...` example fixes had no owning task | critical | T009 owned scope extended to csm-browse/SKILL.md + csm-upload/SKILL.md; AC10 + T002 cross-ref fixed | T009 |
| P-3 T010 planted-defect line incoherent (dead `node -e`, inverted exit) | critical | Acceptance signal rewritten with `--root` override + temp-copy planted defect (missing tmux section → checker must exit 1) | T010 |
| P-4 Task count 13 vs 12; ID gap T006→T008 | critical | Risk summary corrected to 12 (6 low/5 standard/1 high); tasks renumbered T001–T012 sequentially | How To Execute; Numbered Plan |
| P-5 AC6 vs D5 contradiction: plan gains NORMS consumption but diagram removes scan→plan | major | Decision: keep `scan -.-> plan` (plan is a real consumer post-T004) AND add build/bdd-tdd/review edges | AC6; D5.1; T009 |
| P-6 T009 gate `! grep -q "scan -.->|"` no-op + false-positive trap | major | Gate rewritten to check the actual mermaid node/edge text (validation checks the diagram) | T009 |
| P-7 T009 gate `grep -q "close --session" README.md` unsatisfiable | major | Gate now greps csm-browse/SKILL.md (the real fix location); README untouched by browse examples | T009 |
| P-8 T011 shared e2e.mjs with T001 without declared dependency | major | T011 Depends on T001 (+T003); edits described by content anchor, not line numbers | T011 |
| P-9 T001 port lock in session dir can't serialize cross-session pool | major | Lock moved to shared SESSIONS_ROOT with O_EXCL + retry (or retry loop) | T001 action 3 |
| P-10 Deferred browse defects silently dropped | major | Exclusions section names each (navigate alias, artifactCount, open doc, capture presets) + why | Exclusions |
| P-11 AC1 grep scope omitted csm-browse/tests | minor | Added tests dir to AC1 + T001 gate | AC1 |
| P-12 AC2/AC3/AC4 soft evidence | minor | Exact greps lifted into each AC | AC2–AC4 |
| P-13 Execution Graph buried as D6 | minor | Promoted to top-level `## Execution Graph` section | Execution Graph |
| P-14 T008 gates trivially satisfiable (grep "never" hits body) | minor | Gates now sed line 3 (the description frontmatter) only | T008 |
| P-15 T001 --check loop omitted owned files; "existing try/catch" wrong | minor | session-daemon.mjs + record.mjs added to loop; action reworded (import is outside the try today) | T001 |
| P-16 T012 report path deviated + no Verdict-section action | minor | Path unified to `.agents/docs/csm-suite-review-2026-08-15.md`; `## Verdict` section action added | T012 |
| P-17 Unsourced 200-340 line budget | minor | Per-task budget checks dropped; linter's <500 used instead | T004/T005/T007 |
| P-18 D3 vs AC11 dep mismatch (node:process) | minor | Unified to node:fs, node:path, node:process everywhere | D3; AC11 |
| P-19 T003 sanitized stdio + masked exit code | minor | CLI-error path bypasses sanitizer; gate asserts exit 0 (--help) and exit 2 (unknown flag) | T003 |
| P-20 Critique Resolution placeholder vs pending journal | minor | Real rows filled here; journal CRITIQUE/REMEDIATE rows updated | This table; Journal |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-15 | 0 | INTAKE | none | Brief classified: large, open; user-dictated: five improvement dimensions + csm-review-if-needed (folded into read-only adversarial research per planning write discipline) | DISCOVER |
| 2026-08-15 | 0 | DISCOVER | none | Baseline 4dafd82 clean; scout: assumptions/unknowns/conflicts ranked (scope-drift from "touch everything" = top risk) | RESEARCH |
| 2026-08-15 | 0 | RESEARCH | none | 6 parallel tracks complete (R1 doc-vs-code, R2 csm-scan baseline 1204/1204@164.5s, R3 browse robustness, R4 drift matrix, R5 usability, R6 perf+infra); 5 broken + 11 inconsistent + 15 browse issues + 5 drift defects + 7 usability highs | DRAFT |
| 2026-08-15 | 0 | DRAFT | none | Draft written to /tmp/opencode/csm-suite-plan/draft.md; 12 tasks, G1(8)+G2(3)+G3(1) | CRITIQUE |
| 2026-08-15 | 0 | CRITIQUE | none | Hostile non-author critique: 20 findings (4 critical, 6 major, 10 minor); verdict NOT READY; every grep re-verified against real files | REMEDIATE |
| 2026-08-15 | 0 | REMEDIATE | none | All 20 findings resolved (see Critique Resolution): per-skill linter map, T009 scope+gates, planted-defect rewrite, renumber to T001–T012, AC/DR/strategy ID sweep | VERIFY |
| 2026-08-15 | 0 | VERIFY | none | Primary-personal gate: AC1-13 mapped to tasks; 12/12 task field sets complete; all 12 acceptance signals bash -n clean; G1 disjoint ownership verified against real paths; all pending/NOT_STARTED | SAVED |
| 2026-08-15 | 0 | SAVED | none | Plan saved to .agents/plans/2026-08-15-csm-suite-improvements-csm.md; committed 07cb3ad; sandbox cleaned | STOP |
| 2026-08-15 | 1 | RECOVER | none | HEAD 07cb3ad clean; no NORMS.md (optional, skipped); no scripts/; plan ready/12 pending; no partial work | VALIDATE |
| 2026-08-15 | 1 | VALIDATE | none | All plan defect/drift claims re-verified: SKILL_DIR hardcoded (constants.mjs:1), close doc broken (SKILL.md:42), scan.mjs no help, review no tmux (0), plan boundary name present, grill/bdd-tdd no ladder (0), bdd-tdd no Code Conventions (0), upload no H1/trigger | SELECT |
| 2026-08-15 | 1 | SELECT | none | Ready set: T001..T008 (G1) — all deps satisfied (none), disjoint ownership verified; no spike needed (fixes specified) | DISPATCH |
| 2026-08-15 | 1 | DISPATCH | T001..T008 | 8 parallel subagents, all returned gate-passing results; T003 flagged a plan-gate flaw (set -e aborts on expected exit-2) | INTEGRATE |
| 2026-08-15 | 1 | INTEGRATE | T001..T008 | All diffs inspected: 20 files, all within ownership map; browse.mjs try/catch + ports O_EXCL lock + upload mkdtemp/validation + scan CLI all verified in diff; no out-of-scope edits | VERIFY |
| 2026-08-15 | 1 | VERIFY | T001..T008 | All 8 gates re-run by primary: BROWSE/UPLOAD/SCAN-CLI/PLAN-DOCS/BDD-DOCS/GRILL-DOCS/REVIEW-TMUX/DESCRIPTIONS all GATE-PASS; T003 gate fixed to `\|\| test $? -eq 2` form (plan-defect, not code-defect) | CHECKPOINT |
| 2026-08-15 | 1 | CHECKPOINT | T001..T008 | G1 committed; learning: acceptance signals with expected-nonzero exits must use `\|\| test` not `; test` under set -e — applied to T009/T010/T012 signals at dispatch | SELECT |

## Completion Review

(filled by csm-build when all criteria are verified)
