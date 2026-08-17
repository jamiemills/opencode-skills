---
format: csm-plan/1
---

# Suite Coherence — Executable Contracts CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 7 tasks — 0 high-risk, 2 security-adjacent (T004 baseline integrity, T006 gate semantics), 5 standard. check-suite.mjs has a single owner per wave (wave sequencing below enforces it).

## Control
- Plan ID: suite-coherence-contracts
- Status: in_progress
- Current CSM state: DISPATCH
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-16 cycle 2 (cont.) — T004 complete (primary-led after dispatch losses): NORMS marker (4 static pushes), renderer.md regen (fixedInput+'2026-01-15', diff = exactly 4 marker lines), fixture-behavior 10 markdown digests regen ×2 runs deterministic, semantic digests + canonicalizationVersion untouched, Output doc line, version-policy prose ×3 consumers. Suite 1229/1229; canary 0-hit; marker head proven. Next: T003 (W3)
- Next transition: CHECKPOINT -> SELECT (T003)
- Active tasks: none (next: T003)
- Blockers: none

## Goal
Implement all four phases of the agreed suite-coherence approach in one plan: (P1) extract the contracts layer into scripts/lib/contracts.mjs as the suite's single executable source of truth; (P2) surface per-skill interfaces via checked `## Interface` sections and format-version every artifact class including NORMS.md; (P3) heading-bounded boilerplate sync from canonical templates with drift gating; (P4) local pre-commit enforcement + contracts-generated README composition matrix. Every skill stays fully usable standalone; no semantic change to any skill's behavior beyond the synced boilerplate text (which must be diff-minimal).

**Exclusions**: CI workflows (remediation-plan T013 future stage); frontmatter-based interface fields (rejected in approach); comment-marker sync regions inside SKILL.md; syncing Core Rules/R&D gates/state machines/Anti-Patterns; NORMS output changes beyond the marker; any live-LLM behavioral eval.

## Acceptance Criteria
1. scripts/lib/contracts.mjs is the sole home of MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF, INTERFACES, NEVER_INVOKE; check-suite.mjs imports them; `node scripts/check-suite.mjs` green with the pre-task check count unchanged (329 at drafting — the count invariant, not the literal, is the gate) plus the new interface/marker/drift/matrix checks; --root mutation probes (re-derived: demoted heading, corrupted state chain, missing contract string) still fail.
2. All 8 SKILL.md files contain a `## Interface` section with the 4 fixed-label bullets; each `Never invokes:` line enumerates exactly the 7 other skills; check-suite cross-checks prose ↔ contracts.mjs and fails on row mismatch or missing labels.
3. Every corpus artifact carries a format marker: 9 plans (`format: csm-plan/1` — including this plan artifact), 1 review (`format: csm-review/1`), the approach doc (`format: csm-grill/1`) — 11 files retrofitted; check-suite has a mandatory marker check incl. a new `.agents/approaches/*-approach.md` corpus loop; missing/unknown markers fail.
4. NORMS.md output begins with `---\nformat: csm-norms/1\n---`; csm-scan suite green post-regeneration (renderer.md via '2026-01-15' clock; fixture-behavior.json exactly its 10 markdown digests changed, 10 semantic digests + canonicalizationVersion untouched); consumer version-policy prose present in csm-build RECOVER and csm-bdd-tdd intake; hostile canary scans still zero-leak.
5. `node scripts/sync-skill-boilerplate.mjs --check` green after the initial `--write`; deliberate drift in a synced section → both sync --check and check-suite fail; re-write restores byte-exact; first --write pass is diff-minimal against current text.
6. Hook installed via scripts/install-hooks.mjs (core.hooksPath scripts/hooks); a deliberately broken commit is blocked, fixed commit passes, `--no-verify` bypasses; worst-case runtime <5s.
7. README matrix region regenerates byte-identical from contracts.mjs; check-suite fails on drift; layout tree updated and existence-verified; full battery green (scan suite, browse units, check-skill, e2e --quick optional).

## Current-State Evidence
- Approach: .agents/approaches/2026-08-16-suite-coherence-contracts-approach.md @ e4aa94d (8 decisions, 2 deep-dives).
- Live baseline at drafting: check-suite OK — 8 skills, 329 checks (the draft plan's own corpus check added the 329th); scan suite 1229/1229; browse units 55/55; check-skill PASS.
- check-suite.mjs anatomy (scout): MANIFEST 26-75, CONTRACTS 77-96, UPLOAD_SCRIPT_REF 98, per-skill loop 426-485, CONTRACTS checks 487-503, plan corpus 541-560, review corpus 562-587 (no approaches loop), README block 589-635 (tmux bullet pinned at README.md:60), exports 667 (fenceMap/countH1/parseFrontmatter/subsequenceGap only), isMain guard 653-665, exit 0/1 semantics.
- Tmux bootstraps: 5 files, heading line 10, body 12-30, next heading line 32; ~8 differing slots incl. review's article-less step-2 verb and scan's extra CLI-scope sentence; per-sentence parameter map required for diff-minimal sync.
- Subagent Resilience: grill:28(H2), plan:55(H2), review:289(H2), bdd-tdd:79(H3 under Safety And Isolation); steps 1-3 verbatim; step-4 + intro + guard paragraph parameterized (bdd-tdd has no guard paragraph); check-suite's sectionRange is `## `-only → sync tool needs its own level-aware extractor.
- write.mjs: marker pushes go before line 90 (H1); capabilities.json pins only the verbatim import (line 1) + writeFile call (line 131); supersession entries all already superseded (no flip needed); renderer.md regen via expansion-baseline.test.mjs:33-56,89 (clock '2026-01-15'); fixture-behavior.json via pipeline-mirror MIRROR_GENERATED_DATE '2026-01-01'; 20 digests total, 10 markdown ones change.
- Corpus: exactly 10 files without frontmatter (9 plans — incl. this plan once saved — + 1 review) + the approach doc = 11 retrofits; frontmatter before H1 invisible to corpus checks (verified); RECOVER parsing is agent prose — no interference.
- Hooks: none exist; repo convention `#!/usr/bin/env node`; check-suite 0.16s exit 0/1; check-skill 2.2s needs node_modules (conditional); budget ~2.6-3s worst case.
- README: Quickstart 85-97, Installation 64-83, layout tree 119-138 (scripts/ entry line 136, no children yet), Skills table 41-52, matrix goes after Skills table; tree parser demands 4-space depth groups + entries exist on disk.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| D1 | All 8 approach-doc decisions binding (contracts.mjs extraction, Interface sections, universal matrix, frontmatter markers incl. NORMS, heading-bounded sync, core.hooksPath gate, generated README region) | user-dictated | approach doc @ e4aa94d | decided |
| D2 | UPLOAD_SCRIPT_REF moves into contracts.mjs with MANIFEST/CONTRACTS | planning | contract-shaped data; single data home | decided |
| D3 | Approach doc is the 10th retrofit file (`format: csm-grill/1`); check-suite gains an approaches corpus loop | planning | scheme names approaches; scout caveat (a) | decided |
| D4 | README matrix region lives after the Skills table (lines ~41-52) | planning | matrix extends the skill list naturally | decided |
| D5 | Sync-drift check imports a function exported by the sync module (no spawn, no logic replication) | planning | check-suite is import-safe; spawn adds runtime | decided |
| D6 | 'Interface' added to all 8 MANIFEST sections[] arrays (existing mechanism) rather than a separate universal check | planning | consistent with all other section checks | decided |
| D7 | Hook install documented in Installation (where clone lives) with a one-line Quickstart pointer | planning | scout §7; setup step belongs with setup | decided |
| D8 | Stale .agents/README.md:15 (remediation plan 'in_progress') fixed + approaches indexed in T003 | planning | adjacent, cheap, prevents index rot | decided |
| D9 | P1 acceptance uses freshly re-derived --root mutation probes (no committed mutation artifact exists) | planning | scout §8-P1 | decided |
| D10 | check-suite.mjs single-owner per wave: W1 T001, W2 T002, W3 T003, W4 T005, W5 T007 | planning | remediation-build lesson (cycle-4 convergence) | decided |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Interface mechanism | OpenCode docs fetch + parser audit (grill deep-dive) | read-only | body guaranteed injected; unknown frontmatter ignored; parser rejects nesting | Interface = module + prose section |
| R2 | NORMS marker blast radius | baseline/test audit (grill deep-dive) | read-only | 4 files; no canonicalizationVersion bump; locks safe | T004 scoped exactly |
| R3 | Implementation gaps | scout subagent @ e4aa94d | read-only; live check-suite run OK (329 at drafting) | slot census, line numbers, digest counts, clocks, hook budgets | all task actions grounded |

## Discovered Requirements
- check-suite sectionRange is `## `-only — the sync tool must implement its own level-aware heading-bounded extractor (cannot reuse for bdd-tdd's H3).
- fixture-behavior.json has 20 digests; only the 10 markdown digests may change in T004; semantic digests + canonicalizationVersion must not move.
- Two distinct regen clocks: renderer.md '2026-01-15' (expansion-baseline.test.mjs:89), fixture pipelines '2026-01-01' (pipeline-mirror.mjs:16) — never conflate.
- capabilities.json pins write.mjs line 1 (import) and line 131 (writeFile call) verbatim — T004 keeps both byte-exact.
- README layout-tree entries must exist on disk before the tree update passes (scripts/lib/, scripts/hooks/ created in T001/T005/T006 before T007's tree edit).
- check-skill fails without csm-browse/node_modules — hook runs it only when csm-browse paths are staged AND node_modules exists.
- Host `node` is v20.20.2, .node-version says 22 — hook uses PATH node (check-suite verified on both).
- Tmux bootstrap template needs per-sentence parameterization (~8 slots incl. review article irregularity + scan extra sentence) — word-substitution will not reproduce bytes.

## Design
One data module (`scripts/lib/contracts.mjs`) exports MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF, INTERFACES (per-skill: entryConditions, consumes, produces, handoff, midPipeline — all 5 fields the README matrix publishes), NEVER_INVOKE (8×8 universal matrix). check-suite imports the data and adds: Interface cross-check (per-skill loop, after norms block), format-marker checks (plan/review loops + new approaches loop), sync-drift check (imported function), README matrix-drift check (README block). Sync tooling: `scripts/lib/boilerplate.mjs` (templates + parameter maps) + `scripts/sync-skill-boilerplate.mjs` (--check/--write, level-aware extractor, exports checkDrift for check-suite). Hook: node-shebang `scripts/hooks/pre-commit` (check-suite + sync --check if present + node --check staged .mjs + conditional check-skill) + `scripts/install-hooks.mjs` (core.hooksPath). README matrix: generator renders INTERFACES into an HTML-comment-marked region after the Skills table; generator folds into sync tooling as a sibling script `scripts/gen-readme-matrix.mjs`. NORMS marker: 4 static frontmatter pushes in writeNORMS before the H1.

## Execution Graph
Wave barriers are hard sequencing (check-suite single-owner discipline, D10); Depends-on fields authoritative within/between waves.
- Wave 1: T001.
- Wave 2: T002 (owns check-suite) ∥ T004 (no check-suite; SKILL.md region rule: T002 owns the `## Interface` sections everywhere; T004 owns csm-build RECOVER prose + csm-bdd-tdd intake prose + csm-plan intake prose + csm-scan `## Output` doc line — all verified disjoint from Interface sections; both must avoid each other's regions).
- Wave 3: T003 (owns check-suite).
- Wave 4: T005 (owns check-suite) ∥ T006 (no check-suite; hook's sync branch is file-existence-guarded so wave order within W4 is safe; approach P4-after-P2+P3 respected).
- Wave 5: T007 (owns check-suite; tree update after scripts/lib + scripts/hooks exist; acceptance includes a full-gate commit transcript with the sync branch active).
- Critical paths (wave spine W1→W5 is critical): T001 → T002 → T003 → T005 → T007 and T001 → T002 → T003 → T006 → T007 (equal length).

## Numbered Plan
1. [completed] Contracts layer extraction (P1)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: scripts/lib/contracts.mjs (new), scripts/check-suite.mjs (extraction + import only)
   - Not in scope: new checks, SKILL.md edits, README, INTERFACES/NEVER_INVOKE data (approach P1 lists them, but this plan splits them into T002 so T001 stays a pure behavior-identical extraction — recorded deviation, coverage preserved via T002's T001 dependency)
   - Spike candidate: none (scout verified blocks are pure data, one import)
   - Actions: create scripts/lib/contracts.mjs exporting MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF verbatim (data-only, zero path coupling, import-safe); replace check-suite's three data blocks with an import; keep all engine code and output semantics identical; record in the commit message: approach decision #1 (scripts/lib/contracts.mjs extraction) supersedes remediation-plan D7 (contracts-in-check-suite single file).
   - Acceptance signal: `node scripts/check-suite.mjs` → OK, same skill count, check count unchanged vs the pre-task run (329), exit 0; re-derived --root mutation probes fail as before (demoted heading in a /tmp copy → MISSING; corrupted grill state chain → fail); `node -e "import('...contracts.mjs').then(m=>console.log(Object.keys(m)))"` lists the exports.
   - Validation: `node --check` both files; full battery spot-run (scan suite unaffected — no csm-scan changes).
   - Acceptance evidence: check-suite output before/after (identical counts), mutation probe outputs.
   - Repair attempts: 0
   - Recovery note: pure refactor; revert restores prior state.

2. [completed] Interfaces + never-invoke matrix + Interface sections (P2)
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: scripts/lib/contracts.mjs (INTERFACES + NEVER_INVOKE additions), all 8 SKILL.md files (`## Interface` section additions ONLY — placement after frontmatter/activation content per skill structure, before state machine), scripts/check-suite.mjs (Interface cross-check + MANIFEST sections[] additions)
   - Not in scope: csm-build RECOVER / csm-bdd-tdd intake version-policy prose (T004 owns those regions), format markers (T003), any other section text
   - Spike candidate: none
   - Actions: add INTERFACES data with all 5 matrix-published fields per skill (entryConditions, consumes, produces, handoff, midPipeline — harvest from README's workflow section lines 20-39 + each SKILL.md's own prose; contracts.mjs stays out of T007's write path) and the full 8×8 NEVER_INVOKE matrix (all off-diagonal true) to contracts.mjs; write the `## Interface` section in each SKILL.md — placement anchor: immediately before the state-machine section where one exists; otherwise after the opening description paragraphs (csm-scan: after When-to-use; csm-browse/csm-upload: after the intro/quickstart block) — with exactly 4 bullets `- Consumes:` / `- Produces:` / `- Hands off:` / `- Never invokes:` (never-list = the other 7 skills, comma-separated); add 'Interface' to every MANIFEST sections[] entry; check-suite cross-check: section present (existing mechanism), 4 labels each exactly once as `^- (Consumes|Produces|Hands off|Never invokes): ` within sectionRange, parsed never-list equals the matrix row.
   - Acceptance signal: check-suite green (pre-task count + new checks only); mutation probes: delete one Interface section → fail; change a never-list (drop one name) → fail naming the skill + expected row; add a 5th label → fail.
   - Validation: 500-line cap still met for all SKILL.md (largest currently 324 + ~7 lines); grep confirms all 8 sections.
   - Acceptance evidence: check-suite output, mutation outputs, line-count table.
   - Repair attempts: 0
   - Recovery note: additive sections; revert per-file.

3. [pending] Artifact format markers + corpus retrofit (P2)
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: .agents/plans/*.md (9 frontmatter additions — including this plan artifact), .agents/reviews/*.md (1), .agents/approaches/*.md (1), scripts/check-suite.mjs (marker checks + approaches corpus loop), .agents/README.md (stale status fix + approaches index + this plan's index entry)
   - Not in scope: SKILL.md files, NORMS output (T004), csm-scan code
   - Spike candidate: none (frontmatter invisibility to corpus checks verified)
   - Actions: prepend `---\nformat: csm-plan/1\n---\n` to each plan (csm-review/1 for the review, csm-grill/1 for the approach doc); extend the plan + review corpus loops to require a recognized `format:` marker (fail on missing or unknown kind/version); add an approaches corpus loop (`*-approach.md`: marker + H2 ordered-subsequence against csm-grill's Required Approach Document sections from its SKILL.md fenced template — extract at runtime like the plan template); fix .agents/README.md:15 in_progress → complete, add the approaches/ index entry, and add this plan's own plans/ index entry.
   - Acceptance signal: check-suite green; mutation probes: strip a marker → fail; set `format: csm-plan/99` → fail (unknown version); new plan file without marker → fail.
   - Validation: corpus H2 subsequence checks still pass for all files (frontmatter invisible); csm-build RECOVER prose unaffected (no script parses plans).
   - Acceptance evidence: check-suite output, mutation outputs, retrofitted file list.
   - Repair attempts: 0
   - Recovery note: frontmatter additions revertible per file.

4. [completed] NORMS.md format marker + baseline regeneration (P2)
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2 (with T002; SKILL.md region rule: T002 owns `## Interface` sections; this task owns csm-build RECOVER + csm-bdd-tdd intake prose + csm-scan files — do not touch Interface sections)
   - Risk: standard (baseline integrity — security-adjacent: privacy canaries must stay green)
   - Owned scope: csm-scan/lib/scan/write.mjs (4 marker pushes before the H1), csm-scan/test/baselines/expansion/renderer.md (regen, clock '2026-01-15'), csm-scan/test/baselines/expansion/fixture-behavior.json (10 markdown digests ONLY, clock '2026-01-01'), csm-scan/SKILL.md (one Output doc line), csm-build/SKILL.md (RECOVER version-policy sentence), csm-bdd-tdd/SKILL.md (intake version-policy sentence), csm-plan/SKILL.md (intake version-policy sentence for approach docs)
   - Not in scope: canonicalizationVersion bump (must stay 2), semantic digests, supersession/test-integrity/capabilities (verified safe), any other NORMS output change
   - Spike candidate: none (deep-dive R2 scoped it exactly)
   - Actions: push `---`, `format: csm-norms/1`, `---`, `` before the H1 in writeNORMS (keep write.mjs line 1 import + writeFile call byte-exact per capabilities pins); regenerate renderer.md via expansion-baseline's fixedInput path with generated '2026-01-15'; regenerate the 10 markdown digests via the canonical pipeline-mirror process (fixed clock, canonicalize, sha256 — recompute independently twice); add one sentence to csm-scan SKILL.md `## Output`; add version-policy prose in three consumers: csm-build RECOVER + csm-bdd-tdd intake (plans) and csm-plan intake (approach docs, `format: csm-grill/N`) — "check the artifact's `format:` marker; on an unknown version, stop and report incompatibility rather than guessing".
   - Acceptance signal: `cd csm-scan && node --test --test-concurrency=1` green (1229); scan a /tmp fixture → NORMS.md starts with the marker; hostile canary re-scan zero-leak; renderer.md diff = exactly the 4 marker lines; fixture-behavior.json diff = exactly 10 markdown digest values.
   - Validation: semantic digests unchanged (diff check); T227 canaries green; determinism gate green (static line is deterministic).
   - Acceptance evidence: suite output, marker head-of-file proof, digest diff lists.
   - Repair attempts: 0
   - Recovery note: baseline regen is the documented canonical process (precedents ad17628, 7664f24); if digests don't stabilize, stop and re-verify clock/canonicalization before retrying.

5. [pending] Sync tooling + canonical templates + drift gate (P3)
   - Task ID: T005
   - Depends on: T001
   - Parallel group: G4
   - Risk: standard
   - Owned scope: scripts/lib/boilerplate.mjs (new: templates + parameter maps), scripts/sync-skill-boilerplate.mjs (new: --check/--write, level-aware extractor, exports checkDrift), scripts/check-suite.mjs (drift check via imported function), scripts/lib/contracts.mjs (NORMS detection phrases as data), the synced sections within csm-plan/build/bdd-tdd/scan/review SKILL.md (tmux bootstrap) + csm-grill/plan/review/bdd-tdd (Subagent Resilience)
   - Not in scope: Core Rules, R&D gates, state machines, Anti-Patterns, Done Criteria, NORMS prose rewording (phrases become checked data only)
   - Spike candidate: none — template design prescribed by scout census: per-sentence parameter map with ~8 tmux slots (incl. review's article-less step-2 verb "proceed directly with review", build's Activation-Boundary prelude, scan's extra CLI-scope sentence) and resilience params (heading level H2/H3, intro sentence, step-4 sentence, optional guard paragraph absent in bdd-tdd)
   - Actions: encode templates + per-skill parameter maps in boilerplate.mjs; sync script (import-safe: CLI handling behind an isMain guard exactly like check-suite, since check-suite imports its checkDrift) identifies regions by heading boundaries (level-aware: `## Tmux Session Bootstrap`, `## Subagent Resilience`, `### Subagent Resilience`), --write replaces section body from template, --check diffs without writing (exit 1 on drift); run the initial --write pass — MUST be diff-minimal (verify: git diff shows only whitespace/wording-neutral changes or none; any semantic delta is a bug); wire checkDrift(root) into check-suite; move NORMS detection key phrases ('Generated by csm-scan', '## Repository Overview', '## Code Conventions', '## Architecture') into contracts.mjs and have check-suite's norms check consume them — any-of semantics unchanged (phrases become data only, no behavioral change).
   - Acceptance signal: --check green after --write; edit a synced paragraph → --check AND check-suite both fail naming file+section; --write restores byte-exact; initial pass diff-minimal (record git diff stat); check-suite green overall.
   - Validation: MANIFEST tmux partition still green (headings untouched); 500-line caps hold.
   - Acceptance evidence: --check/--write outputs, drift mutation proof, initial-pass diff stat.
   - Repair attempts: 0
   - Recovery note: templates regenerate everything they own; partial states recoverable via --write.

6. [pending] Pre-commit hook + installer (P4)
   - Task ID: T006
   - Depends on: T003
   - Parallel group: G4 (with T005 — no check-suite ownership here; hook invokes check-suite, doesn't edit it; sync branch guarded by file-existence so intra-wave order is safe)
   - Risk: standard (gate semantics — security-adjacent)
   - Owned scope: scripts/hooks/pre-commit (new, node shebang), scripts/install-hooks.mjs (new), README.md (Installation hook-install step + one-line Quickstart pointer ONLY — do not touch the matrix region or layout tree)
   - Not in scope: sync script internals (T005), matrix (T007), CI
   - Spike candidate: none
   - Actions: pre-commit runs from repo root: check-suite (always), sync --check (guarded: only if scripts/sync-skill-boilerplate.mjs exists), `node --check` on staged *.mjs files, conditional `node csm-browse/scripts/check-skill.mjs` (only when csm-browse/** staged AND csm-browse/node_modules exists); header comment documents advisory working-tree semantics + --no-verify bypass; install-hooks.mjs sets `git config core.hooksPath scripts/hooks` and verifies with a dry run; README Installation gains the install step, Quickstart a pointer line.
   - Acceptance signal: after install, a staged deliberate syntax error in a .mjs blocks the commit with a clear message; fixing it passes; `git commit --no-verify` bypasses; measured runtime <5s worst case (record timing); uninstall path documented (core.hooksPath unset). If the sync script already exists at test time, the sync branch must demonstrably run in the transcript.
   - Validation: hook runs on both node 20 and 22 (PATH variants); no false blocks on a clean real commit.
   - Acceptance evidence: blocked/passed/bypassed commit transcripts, timing.
   - Repair attempts: 0
   - Recovery note: hook disable = `git config --unset core.hooksPath`.

7. [pending] README composition matrix + final wiring (P4)
   - Task ID: T007
   - Depends on: T005, T006
   - Parallel group: G5
   - Risk: standard
   - Owned scope: scripts/gen-readme-matrix.mjs (new generator), README.md (marked matrix region after Skills table + layout-tree update for scripts/ children), scripts/check-suite.mjs (matrix drift check)
   - Not in scope: hook changes, sync internals, hand-written README parts (tmux bullet stays verbatim)
   - Spike candidate: none
   - Actions: add README Development & testing bullets for the new tooling (sync --check/--write, gen-readme-matrix, pre-commit workflow) so the gates are discoverable; generator renders INTERFACES from contracts.mjs into an HTML-comment-marked region (`<!-- csm-matrix:start -->` / `:end`) after the Skills table: per skill — standalone entry conditions, consumes, produces, handoff, mid-pipeline prerequisites; check-suite asserts region == generator output (drift fail) and that every `csm-*/...` path inside it exists; update the layout tree: scripts/ gains children check-suite.mjs, gen-readme-matrix.mjs, install-hooks.mjs, sync-skill-boilerplate.mjs, lib/ (contracts.mjs, boilerplate.mjs), hooks/ (pre-commit) — all with correct 4-space depth groups and trailing-slash dirs (entries must exist on disk — they do by W5); run the full battery.
   - Acceptance signal: generator output byte-identical on re-run; hand-edit the matrix → check-suite fails; check-suite green overall; full battery under node 22 (nvm PATH-prepend — host default node 20 cannot glob npm test): scan suite 1229, browse npm test 55/55, check-skill PASS, e2e --quick (Docker available) green; README path/tmux-bullet/tree checks all pass; one commit transcript through the installed hook with the sync branch active (full agreed gate proven end-to-end).
   - Validation: matrix content matches INTERFACES data field-by-field (spot-check 2 skills manually).
   - Acceptance evidence: battery outputs, drift mutation proof, generator idempotence proof.
   - Repair attempts: 0
   - Recovery note: region regenerable; tree entries mirror disk.

## Verification Strategy
- Per-task fast gates: `node --check` touched files; `node scripts/check-suite.mjs` (<0.2s) after every task.
- Batch gates: csm-scan full suite after T004 (and at final); browse npm test + check-skill at final; e2e --quick at final (Docker present).
- Mutation probes are the acceptance idiom for every gate change (--root /tmp copies, never the repo): each new check must have at least one fail-proof and one pass-proof recorded.
- Parallel-safe: check-suite runs are read-only; baseline regen (T004) writes only csm-scan baselines; sync --write (T005) writes only synced sections.
- Known environment notes: host node 20 vs .node-version 22 (checks pass on both; use PATH-prepend for 22); check-suite reads working tree not index (hook wart, documented).

## Risks And Recovery
- Baseline regen instability (T004): if digests don't stabilize, verify clock + canonicalization before retrying; never bump canonicalizationVersion for a static literal.
- Sync initial pass not diff-minimal (T005): template/parameter-map bug — fix the map, not the SKILL.md text; the current prose is the source of truth for the first pass.
- check-suite convergence (multiple tasks editing it across waves): single-owner-per-wave discipline (D10); if a wave's tasks both need it, serialize.
- Hook false-blocks (T006): every gate component already exits 0 on the clean tree — a false block is a hook bug, revert via core.hooksPath unset.
- README check interactions (T007): matrix paths must exist; tree depth groups exact; tmux bullet untouched.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Plan forgets it is itself a corpus file (8→9 plans, 10→11 retrofits; T003 gate unreachable) | blocker | Counts corrected everywhere; T003 owned scope names this plan artifact explicitly | live `ls .agents/plans/*-csm.md` = 9 |
| Stale 328 baseline (live = 329; three acceptance signals corrupted) | major | Re-baselined: count-invariant wording + 329-at-drafting note in Current-State Evidence | live check-suite run 329 |
| INTERFACES 3 fields vs matrix needs 5; T007 lacks ownership to backfill; harvest source wrong | major | INTERFACES = 5 fields (entryConditions/consumes/produces/handoff/midPipeline); harvest from README workflow + SKILL.md prose; contracts.mjs kept out of T007 write path | approach P4 deliverable list |
| W3 'T003 ∥ T006' contradicts Depends-on; P4 before P3; sync branch never proven | major | T006 moved to W4 ∥ T005 (guard makes order safe); T007 acceptance adds full-gate commit transcript with sync active; both critical paths listed | approach P4 dependency rule |
| W2 bullet omits csm-scan Output line | minor | Bullet lists all four T004 regions | task scope cross-check |
| 'D8 supersedes D7' mislabeled | minor | Commit note now cites approach decision #1 superseding remediation D7 | remediation plan D7/D8 meanings |
| T001 defers INTERFACES/NEVER_INVOKE that approach P1 lists | minor | Explicit deviation note in T001 (pure extraction; coverage via T002 dependency) | approach P1 deliverables |
| README Development & testing unowned for new tooling | minor | T007 gains docs sub-action | approach P4 discoverability goal |
| .agents/README.md misses this plan's index entry | minor | T003 action extended | index's own one-line rule |
| csm-plan lacks approach-version intake prose | minor | T004 adds csm-plan intake prose (csm-grill/N) | approach decision row 4 |
| NORMS phrase consumption semantics unpinned | minor | T005 states any-of unchanged, data-only | current check semantics verified |
| npm test glob fails on host node 20 | minor | T007 battery pinned to node 22 (nvm PATH-prepend) | critic's live repro |
| Critical path ignores T006 chain | minor | Both chains listed + wave spine noted | graph analysis |
| T002 placement undefined for scan/browse/upload | minor | Explicit per-skill anchors added | skill structure census |
| Sync CLI import-safety unstated | minor | T005 requires isMain guard (check-suite imports checkDrift) | D5 mechanism |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-16 | 0 | INTAKE -> DISCOVER -> RESEARCH (scout) -> DRAFT | none | approach e4aa94d binding (8 decisions); implementation scout: slot census, line numbers, 20-digest correction, two regen clocks, hook budgets, 9 residual uncertainties resolved as D2-D10 | CRITIQUE |
| 2026-08-16 | 0 | CRITIQUE (independent subagent) -> REMEDIATE (primary) -> VERIFY | none | verdict needs-changes: 1 blocker (self-corpus blind spot) + 3 major (328 baseline, INTERFACES schema, W3 contradiction) + 10 minor; all 15 remediated in plan text; no design rework needed | SAVED |
| 2026-08-16 | 2 (cont.) | T004 implemented primary-led: write.mjs marker → regen harness replicated test contracts verbatim (fixedInput, canonicalize, legacy+expanded mirrors) → renderer.md + digests installed after determinism proof | T004 | Suite 1229/1229 green; output starts ---/format: csm-norms/1/---; canary 0 hits; renderer diff exactly 4 lines; fixture-behavior exactly 10 digest pairs changed, 0 semantic drift, canonicalizationVersion 2 | SELECT (T003) |
| 2026-08-16 | 2 | SELECT -> DISPATCH (T002∥T004; both dispatches returned empty — T002 salvaged from late-flushed partial work + primary completion; T004 requeued) -> INTEGRATE -> VERIFY -> CHECKPOINT | T002 | contracts.mjs: INTERFACES+NEVER_INVOKE (computed matrix from agent replaced with literal per approach decision; MANIFEST sections[] + 'Interface' everywhere; stale error message already fixed by agent); 8 SKILL.md Interface sections (dedup: agent's improvised-placement duplicates removed, plan-anchor versions kept); check-suite cross-check verified line-by-line. Gate 401 (329+72). Probes A-D all fail correctly. Max SKILL.md 331 lines. Lesson: parallel dispatch unreliable this session — sequential primary-led implementation for remaining tasks | SELECT (T004) |
| 2026-08-16 | 3 | SELECT -> DISPATCH (T004; dispatch lost — primary implemented directly per salvage rule) -> INTEGRATE -> VERIFY -> CHECKPOINT | T004 | write.mjs marker (4 pushes before H1; capabilities-pinned lines byte-exact); baselines regenerated via replicated canonical harnesses (deterministic ×2; semantic drift 0; exactly 10 markdown digests changed); docs+policy prose in 4 SKILL.md; suite 1229/1229 green; canary zero-leak; check-suite 401 | SELECT (T003) |
| 2026-08-16 | 1 | NOT_STARTED -> RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW (primary self-review: pure data refactor, low risk) -> CHECKPOINT | T001 | contracts.mjs created (MANIFEST+CONTRACTS+UPLOAD_SCRIPT_REF verbatim); check-suite 329 OK exit 0 (invariant); import keys CONTRACTS,MANIFEST,UPLOAD_SCRIPT_REF; mutation probe spot-verified (contract rename fails correctly); subagent before/after probes byte-identical. Note: session detoured into unrelated installer research mid-cycle (parallel-session mixup) — zero writes from it, tree verified clean of it before resuming | SELECT (Wave 2) |

### Cycle-1 Discovered Requirements (added)
- check-suite.mjs MANIFEST-error message still says 'no MANIFEST entry in scripts/check-suite.mjs' though data now lives in contracts.mjs — message text is behavior (byte-identical scope kept it); T002 may update it when adding Interface checks.
- Node 22 via `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` (nvm use broken on this host).

## Completion Review
(filled by csm-build when all criteria are verified)
