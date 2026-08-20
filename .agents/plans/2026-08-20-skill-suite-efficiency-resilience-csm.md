---
format: csm-plan/1
---

# Skill-Suite Efficiency And Quota Resilience CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 8 tasks — 1 high-risk (T006 gate engineering), 1 high-risk (T007 new test harness), 6 standard. Tasks that always require independent review: T006, T007.

## Control
- Plan ID: skill-suite-efficiency-resilience
- Status: in_progress
- Current CSM state: VALIDATE
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-20 cycle 0 start — build dispatched by explicit user request ("use csm-build and build it"); RECOVER: tree clean except plan-file stale-fix edits (committed below), no NORMS.md, format marker csm-plan/1 present, all 8 tasks pending; VALIDATE: check-suite 457 OK, sync-skill-boilerplate --check OK, gen-readme-matrix --check OK
- Next transition: VALIDATE -> SELECT
- Active tasks: none
- Blockers: none

## Goal

Optimise the eight skills in this repository so the suite is (a) token-efficient per session and per invocation, (b) resilient to model-API quota exhaustion — pausing cleanly when quota is hit, and (c) trivially resumable when quota returns or when the user switches to a different model — while preserving the current conformance gate, the end-to-end grill -> plan -> build -> review -> deliver flow, and the design intent that the saved plan document is the durable record.

Deliverables:
1. Reduced per-session token overhead (frontmatter descriptions) and per-invocation overhead (synced boilerplate sections, output-display scaling).
2. A defined quota-pause mechanism in csm-build (PAUSED stop state following the BLOCKED precedent, save-and-stop protocol, quota-aware resilience ladder, pre-flight probe on resume).
3. A model-switch-safe resume contract: `Last model/run:` field, canned Resume block, per-task Recovery notes re-read in RECOVER, prior-model evidence re-verification.
4. Mid-planning survival for csm-plan via a disposable `.draft` plan sidecar.
5. A retrieval-first ("curiosity") protocol for csm-plan RESEARCH, csm-grill, and csm-review: named read-only retrieval tools, source-URL + retrieval-date citations, edition-drift check for review anchors, and frontmatter bias statements.
6. Gate hardening: check-suite validates plan Control fields, journal consistency, list ordinals, and template `format:` markers; two known end-to-end defects fixed (F-050 template format markers, F-069 RECOVER duplicate ordinal; the doubled pre-commit drift check — F-069 component 2 — already resolved by the completed oxlint-lefthook-precommit plan).
7. Behavioral resume-semantics tests (closes F-063).

Constraints:
- All eight SKILL.md files have mirrored copies under `bootstrap/package/payload/skills/` that must be regenerated via `node scripts/pack-bootstrap.mjs` before completion.
- Every edit must keep `node scripts/check-suite.mjs` green (457 checks at the last gate run, 2026-08-20; 441 at planning time 2026-08-19; MANIFEST sections, state chains, interface shape, boilerplate drift, corpus templates). The gate is red on this plan file until its `format: csm-plan/1` frontmatter (added above) is committed — the SAVED commit makes it green.
- csm-scan stays offline and deterministic (no scan-time network retrieval).
- The state-machine chain and numbered `### N. STATE` headings are gate-verified; PAUSED must follow the unnumbered-heading BLOCKED precedent, not become a chain token.
- Never-X clauses and <=1024-char descriptions must be preserved in every frontmatter.

Exclusions:
- No change to the universal bootstrap envelope schema or signing (bootstrap/schema.json, protocol.md) — payload file content only.
- No new plan-document format version (no `format: csm-plan/2`); lean-plan mode is deferred (see Risks).
- No lazy-loading of the Required Plan Document template out of the SKILL.md fence (breaks the gate's template extraction; deferred, see Risks).
- No changes to csm-browse/csm-upload behavior beyond frontmatter trimming (T005).
- No change to the tmux bootstrap's unconditional activation (it is the session-survival mechanism); only its rendered text is condensed (T001).

## Acceptance Criteria

1. Frontmatter descriptions across the 8 skills shrink from 417 words to <=220 words total; every description keeps its Never-X clause, is <=1024 chars, and `node scripts/check-suite.mjs` passes.
2. Synced boilerplate sections shrink materially (tmux bootstrap body ~362 -> <=150 words per skill; NORMS detection/validation condensed) with `node scripts/sync-skill-boilerplate.mjs --check` clean; the pre-commit hook no longer runs the duplicate drift step (already true — .lefthook.yml pre-commit jobs contain no sync step).
3. csm-build/SKILL.md contains a `## Pause On Quota` section: quota signal set (HTTP 429, rate-limit, quota-exceeded, out-of-credits, billing, context-length-exceeded), detect -> journal evidence -> safe integration of in-flight results -> full CHECKPOINT with commit -> `Status: paused` + `Next transition: PAUSED -> RECOVER` -> clean stop; RECOVER contains a resume block (re-read Last checkpoint, latest journal row, Recovery notes of non-COMPLETE tasks, Discovered Requirements; re-verify prior-model evidence claims); SELECT gains a best-effort pre-flight probe when resuming from a pause.
4. csm-plan/SKILL.md Control template gains `paused` in the Status enum, a `Last model/run:` field, and a canned Resume block; the fenced Required Plan Document starts with a `format: csm-plan/1` marker; a `.draft` sidecar rule persists planning state at every transition and resumes on `.draft` presence; RESEARCH requires a named current-knowledge retrieval check with source URL + retrieval date citations.
5. csm-grill and csm-review carry the retrieval protocol and bias statements; csm-review adds an anchor edition-drift check; all three producer templates carry `format:` markers (F-050 closed).
6. check-suite adds Control/journal validation (Status enum incl. `paused`; Current CSM state and journal Next-state values within the machine enum; terminal-sentinel and prefix exemptions), ordered-list ordinal sequencing, template `format:` marker validation, and Interface-content artifact-pattern drift detection — implemented in an importable `scripts/lib/plan-validation.mjs`; the RECOVER duplicate `2.` ordinal (csm-build/SKILL.md:119-120) is fixed.
7. New behavioral tests under `tests/` pass: template-contract round-trip, PAUSED->RECOVER golden fixture through the new checks, journal/chain consistency over the plan corpus.
8. Full verification green: `node scripts/check-suite.mjs`; `node --test tests/*.test.mjs tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs`; `cd csm-scan && node --test --test-concurrency=1`; `cd csm-browse && node scripts/check-skill.mjs`; `node scripts/pack-bootstrap.mjs` prints a deterministic digest and payload sha256 index matches the regenerated payload.
9. Every numbered task completed with recorded acceptance evidence in this plan document; no change to the CSM state machines' gate-verified chains.

## Current-State Evidence

- Eight SKILL.md files, 1,864 lines total (~37,500 estimated tokens): csm-grill 225 / csm-plan 296 / csm-bdd-tdd 301 / csm-build 255 / csm-review 331 / csm-scan 241 / csm-browse 150 / csm-upload 65 lines.
- Frontmatter descriptions total 417 words, injected into the available-skills list on every session regardless of use (csm-review 73, csm-grill 63, csm-bdd-tdd 63, csm-scan 55, csm-upload 50, csm-browse 47, csm-build 37, csm-plan 29).
- Tmux Session Bootstrap is inline in 5 skills, ~362-381 words each (csm-plan:10-31, csm-build:10-31, csm-bdd-tdd:10-31, csm-scan:10-31, csm-review:10-31), canonical source `scripts/lib/boilerplate.mjs:7-29`, synced by `scripts/sync-skill-boilerplate.mjs` (heading-bounded splice; drift gated at check-suite.mjs:646-649). csm-grill has no tmux section (proof it is not essential).
- NORMS.md detection/validation blocks duplicated in csm-plan (188 words, lines 82-100), csm-build (161 words, lines 60-84), csm-bdd-tdd (~37), csm-review (~80). csm-bdd-tdd already uses a "Same rules as csm-build" dedup precedent at csm-bdd-tdd/SKILL.md:37.
- Duplicate ordinal defect: csm-build/SKILL.md:119-120 both numbered `2.` in RECOVER.
- Pre-commit gate is lefthook-managed: .lefthook.yml pre-commit jobs (unstaged-guard, check-suite, mjs-syntax, oxlint, csm-browse-check) contain no sync-skill-boilerplate step; scripts/hooks/pre-commit is a lefthook shim — F-069 component 2 (doubled drift check) resolved by the completed oxlint-lefthook-precommit plan (2026-08-20, cycle 2). check-suite.mjs:646-649 still runs checkDrift internally; the sync step exists only as the repo-wide `node scripts/sync-skill-boilerplate.mjs --check` gate.
- F-050: producer templates omit the `format:` markers (csm-plan Required Plan Document fence; csm-grill Required Approach Document; csm-review Report Format) that consumers and the gate require; all 17 committed artifacts were retrofitted by hand.
- check-suite validates state chains (check-suite.mjs:206-259: every chain token gets one numbered heading, consecutive, no orphans, count match; last token terminal-exempt) — adding PAUSED as a chain token would require chain+heading+count changes; the BLOCKED precedent (unnumbered `## Blocker Rules` at csm-build:245) shows the safe pattern.
- check-suite has zero Control/journal/ordinal/template-marker validation (grep: no `Control`, `Next transition`, or list-ordinal checks); corpus drift existed (2026-08-19-consolidated-remaining-work-csm.md Control said `Next transition: SCOPE`, not a build-machine state) and was amended at planning 2026-08-20 to the valid `NOT_STARTED -> RECOVER` prefix form when the plan was reopened with T012 — T006 verifies it holds.
- No occurrence of quota/rate-limit/out-of-credits handling in any orchestration SKILL.md (grep-verified); csm-build has no subagent resilience ladder (present in csm-plan:57-64, csm-grill:32, csm-review:300-305, csm-bdd-tdd:83).
- csm-plan persists nothing until SAVED (write allowlist at csm-plan:49-52; journal recorded in-memory, csm-plan:128); tmux (csm-plan:10-31) is the only mid-planning survival.
- F-063 (2026-08-19-skills-review.md:1030-1042): resume semantics, journaling, write allowlists have zero automated verification.
- Retrieval-first instructions exist but name no tool and demand no citation (csm-plan:46,156-163 "real tools"; csm-grill:22,83 "repo, docs, tooling, web"); no bias statements in csm-* frontmatter; environment has webfetch + cloudflare-docs search MCP + zai MCP + web-perf; no general web-search MCP installed.
- csm-review already performs version-pinned live retrieval for supply chain (SKILL.md:69) and anchor verification (SKILL.md:134) — the precedent for the edition-drift check.
- Payload mirror: bootstrap/package/payload/skills/ contains all 8 skills; tests/protocol/integrity.test.mjs:116-123 asserts payload sha256 vs payload-index.json; tests/package-audit.test.mjs:93-94 requires payload SKILL.md presence. Payload drift is currently unguarded in check-suite.
- At planning time the working tree was clean of source changes; this plan document is the only artifact created (now untracked until the SAVED commit, after which the gate is green).

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | "Quota limits" means model-API quota exhaustion: HTTP 429, rate-limit, out-of-credits, quota-exceeded, billing errors, and context-length-exceeded signals | User-dictated intent | Brief: "quota limits being hit ... pause work ... resume when quota limits are lifted" | Accepted |
| A2 | Model switch means the user starts a new opencode run (possibly a different model) that continues from the saved plan; the plan file is the only durable state (never chat history) | User-dictated intent | Brief: "resume work when a new model is switched in"; csm-build:52,220 | Accepted |
| A3 | PAUSED is implemented as an unnumbered stop-state section (`## Pause On Quota`) following the BLOCKED precedent, not as a chain token | Planning decision | check-suite.mjs:206-259 chain invariants; csm-build:245 BLOCKED precedent | Accepted |
| A4 | Quota-pause scope covers csm-build execution and csm-plan mid-planning (draft sidecar); csm-review has a journal-resume path (csm-review:107) and gets the ladder quota rule; csm-grill persists nothing until SAVED and is NOT mid-session resumable — its quota rule is "stop cleanly; the interview restarts from the user's answers (one-question-at-a-time state is cheap to rebuild)" | Planning decision | Evidence: csm-grill has no journal and writes only at SAVED + disposable temp (csm-grill:41-43); minimum needed for the outcome | Accepted |
| A5 | Output-display at SAVED becomes scale-gated (small/quick runs: summary + path + evidence highlights; large runs: complete document) | Planning decision (deviation from current csm-plan:211, csm-grill:135, csm-review:200) | User asked for token efficiency; full-document re-emission costs tens of thousands of tokens per run | Accepted — flagged for user awareness |
| A6 | csm-scan remains offline/deterministic; its standards registry URIs are documented as current-source pointers for consumers to verify | Planning decision | csm-scan:169-175 no-network constraints | Accepted |
| A7 | No new plan format version (csm-plan/2 lean template) and no template lazy-loading this round | Planning decision | Both break gate machinery; recorded as deferred in Risks | Accepted |
| A8 | tmux bootstrap stays unconditional (session survival is the resilience mechanism); only its rendered text is condensed | Planning decision | Research: proportional gating of tmux trades away crash survival for tokens | Accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Is the RECOVER duplicate ordinal real? | Read csm-build/SKILL.md:114-124 | Read-only | Lines 119-120 both `2.` | T003 fix; T006 ordinal check |
| R2 | Does the pre-commit hook duplicate the drift check? | Read scripts/hooks/pre-commit vs check-suite.mjs:646-649 | Read-only | RESOLVED post-planning: hook is a lefthook shim, .lefthook.yml pre-commit jobs have no sync step; dup eliminated by the completed oxlint-lefthook-precommit plan | No action in T001 — resolved externally |
| R3 | Can PAUSED join the state chain without gate surgery? | Read check-suite.mjs:206-259 chain validator | Read-only | Chain tokens need numbered headings + count match; last token exempt; orphans rejected | PAUSED as unnumbered section (BLOCKED precedent) — no chain change |
| R4 | Do the producer templates carry `format:` markers? | Read csm-plan Required Plan Document fence (csm-plan:213-294); review corpus plans | Read-only | Markers absent in fences; corpus artifacts retrofitted by hand | T002/T004 add markers; T006 validates |
| R5 | Does any Control/journal validation exist? | grep check-suite.mjs for Control/Next transition | Read-only | None; corpus drift found (consolidated plan `Next transition: SCOPE`) | T006 adds validation + corpus repair |
| R6 | How big are the shared boilerplate renders? | Read scripts/lib/boilerplate.mjs; wc of synced sections | Read-only | tmux ~362-381 words x5; NORMS 188 words (csm-plan) / 161 words (csm-build) | T001 condenses canonical templates |

## Discovered Requirements

- Every SKILL.md edit must be mirrored into `bootstrap/package/payload/skills/**` via `node scripts/pack-bootstrap.mjs` (integrity test tests/protocol/integrity.test.mjs:116-123); payload drift is unguarded in check-suite today (consolidated-remaining-work plan noted this) — do not rely on a gate to catch it.
- Synced boilerplate sections (tmux, resilience, NORMS) must be edited ONLY through `scripts/lib/boilerplate.mjs` + `sync-skill-boilerplate.mjs --write`; hand-editing a synced section fails checkDrift.
- Frontmatter rules: name matches dir; description non-empty, <=1024 chars, contains a Never-X clause (check-suite.mjs:388-391); exactly one H1; no duplicate H2; <500 lines per SKILL.md (check-suite.mjs:376).
- State-machine section: backticked chain tokens each need exactly one numbered `### N. STATE` heading, consecutive, no orphans, count match (check-suite.mjs:206-259). csm-review additionally requires per-state Entry/Exit lines and self-claims.
- Interface section: exactly 4 labeled bullets; `Never invokes` must equal the NEVER_INVOKE matrix row exactly (check-suite.mjs:411-427).
- Plan/approach/report templates must remain extractable from fenced blocks in csm-plan/csm-grill/csm-review, and the `.agents/plans|approaches|reviews` corpora validate against them (check-suite.mjs:473-588).
- README integrity: layout tree must match filesystem; all 5 tmux skills in one bullet; every skill path referenced (check-suite.mjs:590-635). README matrix is generated (gen-readme-matrix.mjs) from contracts.mjs INTERFACES.
- csm-scan authoritative suite: `node --test --test-concurrency=1` serial mode (1,227 tests recorded 2026-08-19, baseline >=1200, ~132s wall).
- NORMS phrase ("Generated by csm-scan" or "## Repository Overview") must remain present outside fences in norms-enabled skills (check-suite.mjs:436-439).
- Commit style: short imperative messages, skill-prefixed.

## Design

**Quota-pause model (csm-build).** A `## Pause On Quota` section (unnumbered, BLOCKED precedent) defines PAUSED: signal set = {HTTP 429, rate-limit, quota-exceeded, out-of-credits, billing, context-length-exceeded}. On signal: (1) record exact error in journal as evidence; (2) integrate only already-returned, safe subagent results; (3) run the full CHECKPOINT block incl. commit; (4) set `Status: paused`, `Current CSM state: PAUSED`, `Next transition: PAUSED -> RECOVER`; (5) stop cleanly — this is the single sanctioned exception to "do not stop after one task or cycle". Transient signals (single 429) get one short backoff retry before pausing; hard exhaustion pauses immediately. The Subagent Resilience canonical render (T001) gains the quota rung ("on quota-type failure do NOT retry — surface to primary for pause") for all laddered skills; csm-build additionally gains its own non-synced resilience ladder (it has none today) in T003. SELECT adds a best-effort pre-flight probe when resuming from a pause: one cheap model call before the first DISPATCH; on quota signal, remain paused (journal + report).

**Model-switch resume contract.** Control template gains `Last model/run:` (recorded at each CHECKPOINT) and a `- Resume:` bullet inside the Control block (rendered as a bullet, NOT a new `## Resume` H2 — the gate's template-corpus subsequence check would otherwise fail all corpus plans; verified: no corpus plan contains `## Resume`). Resume instructions: re-read Last checkpoint -> latest journal row -> Recovery notes of all non-COMPLETE tasks -> Discovered Requirements -> working-tree diff. RECOVER adds: verify `Last model/run:` differs from the current run and, when it does, re-verify acceptance evidence authored by the previous model rather than trusting status labels (already the RECOVER spirit, now explicit).

**Mid-planning survival (csm-plan).** Write allowlist extends to `.agents/plans/<date>-<goal>-csm.draft.md`: persist Control/journal/draft at every state transition during planning; at SAVED rename to the final path. A resumed planning session checks for `.draft` first and continues rather than restarting (mirrors csm-bdd-tdd specs/control.md precedent). The `.draft` is disposable; only the final `.md` is the plan.

**Token efficiency.** (a) Frontmatter descriptions trimmed to <=220 words total across 8 skills (target <=35 words each), keeping Never-X and bias clauses. (b) Canonical boilerplate renders condensed in boilerplate.mjs (tmux ~362-><=150 words preserving all skip rules and notice; NORMS detection/validation condensed ~40%; resilience ladder gains the quota rung); sync --write regenerates all skills; pre-commit step 2 already removed (lefthook plan). (c) Output display at SAVED scale-gated (A5). (d) csm-scan `## Testing` section trimmed to a concise gate-command list (no README write — that stays with T008).

**Curiosity/retrieval protocol.** csm-plan RESEARCH: every track runs a current-knowledge check first via named read-only tools (webfetch; installed docs-search MCPs e.g. cloudflare-docs search) for every technology the plan touches, returning `source URL + retrieval date` in the required research report fields; sources >30 days old warn (staleness precedent csm-plan:97). csm-grill SCOUT/DEEP_DIVE: same with citations. csm-review EVIDENCE: webfetch each anchor URL and record supersession; superseded editions surface as low/info findings. Frontmatter bias sentence "Biases towards retrieval from current documentation over pre-trained knowledge" added to csm-plan, csm-grill, csm-review (mirrors installed Cloudflare skills; additive, Never-X preserved). csm-scan stays offline; its standards registry documents authoritative URIs as current-source pointers for consumers.

**Gate hardening (check-suite).** New checks, extracted into an importable `scripts/lib/plan-validation.mjs` module (used by check-suite AND by the new behavioral tests): plan Control validation scoped to `*-csm.md` plans (Status enum incl. `paused`; `Current CSM state` within the machine enum; `Next transition` must be a terminal sentinel — `none (terminal)`, `COMPLETE`, `none; closed as superseded ...` — or a valid `TOKEN -> TOKEN` pair, or the documented prefix convention "On a future explicit csm-build invocation, <A> -> <B>"; exempt COMPLETE/superseded plans from strict validation since they encode history); journal rows have required columns and Next-state values within the enum; ordered-list ordinal sequencing in state sections (catches the RECOVER duplicate); fenced producer templates start with `format:`; Interface-content truth-source drift (default: assert artifact-path patterns — `.agents/plans/`, `NORMS.md`, `*-bdd-csm.md`, `.agents/reviews/`, GitHub Pages — appear in the corresponding SKILL.md Interface section; full-sentence substring matching is infeasible: INTERFACES handoff wording differs from the prose, verified); unify fenceMap/splitLines into one module (F-054). Corpus repairs are limited to the known drift: 2026-08-19-consolidated-remaining-work-csm.md `Next transition: SCOPE` repaired to a valid `TOKEN -> TOKEN` pair (amended at planning 2026-08-20 to the `NOT_STARTED -> RECOVER` prefix form; T006 verifies/repairs if drifted again — journal evidence per edit).

**Behavioral tests.** tests/resume-semantics.test.mjs + fixtures, importing `scripts/lib/plan-validation.mjs` directly (no check-suite spawning — a minimal fixture cannot satisfy the full structural gate): (a) template-contract round-trip (fenced template parses, format marker present, Control enum contains paused, no `## Resume` H2); (b) PAUSED->RECOVER golden fixture passes the extracted Control checks; (c) journal/chain consistency over the plan corpus; (d) quota-signal set is complete and documented (string-level test against the SKILL.md text).

**Boundaries.** csm-browse/csm-upload: frontmatter trim only (T005). csm-bdd-tdd/csm-scan: parity + testing-section trim only (T005). No envelope/schema changes. No format version bump.

## Execution Graph

Dependencies:
- T001 (boilerplate condensation + ladder quota rung; pre-commit dedup already resolved by the completed oxlint-lefthook-precommit plan) — base, G1.
- T006 (check-suite/plan-validation hardening) — base, G1, disjoint files from T001.
- T002 (csm-plan bundle) — depends T001 (synced sections must be regenerated first).
- T003 (csm-build bundle) — depends T001.
- T004 (csm-grill + csm-review bundle) — depends T001.
- T005 (csm-bdd-tdd + csm-scan + csm-browse + csm-upload bundle) — depends T001.
- T007 (resume-semantics tests) — depends T002, T003, T006.
- T008 (payload refresh + full gates) — depends T002, T003, T004, T005, T006, T007 (STRICTLY sequential after T007 — its battery invokes tests/resume-semantics.test.mjs).

Parallel groups:
- G1: T001 || T006 (disjoint files: boilerplate/sync/hooks(+hook tests) vs check-suite/plan-validation/contracts/gen-readme-matrix).
- G2: T002 || T003 || T004 || T005 (each owns distinct SKILL.md files; all after T001).
- G3: T007 alone.
- G4: T008 alone (after T007).

Critical path: T001 -> T003 -> T007 -> T008.

Rule (F15): any template-fence edit that alters the extracted H2 sequence must include the corpus retrofit in the same task; this plan avoids the issue by adding Resume as a Control bullet, never an H2.

## Numbered Plan

1. [pending] Condense shared boilerplate and add the ladder quota rung (pre-commit drift dedup already resolved by the lefthook plan)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: scripts/lib/boilerplate.mjs, scripts/sync-skill-boilerplate.mjs, synced sections in csm-plan/csm-build/csm-bdd-tdd/csm-scan/csm-review SKILL.md files (via sync --write only); NOT scripts/hooks/pre-commit or its test — the hook is a lefthook shim and F-069 component 2 is already resolved by the completed oxlint-lefthook-precommit plan (do not hand-edit)
   - Not in scope: any non-synced SKILL.md prose; check-suite.mjs; contracts.mjs; frontmatter (T002-T005); payload regeneration (T008)
   - Spike candidate: none
   - Actions:
     1. In scripts/lib/boilerplate.mjs, condense the canonical tmuxBootstrap() render from ~362 words to <=150 words, preserving every semantic: TMUX env check, skip conditions (in-tmux / no-tmux opt-out / other multiplexer / not installed), session-name derivation `csm-<skill>-<goal-slug>` with numeric suffix `-2`/`-3` on collision, the detached-session launch command pattern, the printed notice, and "end invocation; only when skipped does this invocation continue". Use terser phrasing, not omission — a phrase checklist is part of validation.
     2. Condense the shared NORMS.md render where duplicated across skills (target ~40% reduction), keeping the detection order, the 3 validation markers, the warn phrase, and the staleness rule.
     3. Extend the canonical subagentResilience render with the quota rung for all laddered skills (grill, plan, bdd-tdd, review): "on quota-type failures (429, rate-limit, out-of-credits, context-length-exceeded) do NOT run the retry ladder — one short backoff retry for transient signals only; hard exhaustion surfaces to the primary agent for pause/stop" (target ~25 words added).
     4. Re-run `node scripts/sync-skill-boilerplate.mjs --write` to regenerate all synced sections.
     5. RESOLVED externally — no action: the completed oxlint-lefthook-precommit plan made scripts/hooks/pre-commit a lefthook shim and .lefthook.yml pre-commit jobs (unstaged-guard, check-suite, mjs-syntax, oxlint, csm-browse-check) contain no sync-skill-boilerplate step; check-suite.mjs:646-649 already runs checkDrift internally. Do not hand-edit the shim.
     6. RESOLVED externally — no action: the lefthook plan already updated scripts/hooks/test/pre-commit.test.mjs (hook suite 7/7, no SYNC assertions, unstaged-changes rejection retained).
   - Acceptance signal: `node scripts/sync-skill-boilerplate.mjs --check` exits 0 AND `node scripts/check-suite.mjs` exits 0 AND `grep -c "sync-skill-boilerplate" .lefthook.yml` shows exactly 0 occurrences AND `node scripts/hooks/test/pre-commit.test.mjs` passes (its own node:test run).
   - Validation: `wc -w` of the tmux section body in each of the 5 skills <= 150 words; phrase checklist present in each tmux body (TMUX check, skip conditions, `-2`/`-3` suffix, notice, end-invocation rule); quota rung text present in the 4 laddered skills; `pnpm exec lefthook validate`; a dry `git diff --stat` shows no changes outside the synced sections, the hook, and its test.
   - Acceptance evidence: recorded outputs of the acceptance command; word-count table per skill; phrase-checklist grep results; diff stat.
   - Repair attempts: 0
   - Recovery note: if sync --write or check-suite fails, the boilerplate.mjs edit is the only changed source; revert boilerplate.mjs and re-sync, or fix the render and re-run both commands. Verify no SKILL.md was hand-edited (all changes must come from the sync tool). The hook and its test are out of scope (lefthook shim, owned by the completed oxlint-lefthook-precommit plan) — if they fail, report rather than hand-edit.

2. [pending] csm-plan: resume contract, draft sidecar, retrieval protocol, format marker, frontmatter
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-plan/SKILL.md (frontmatter; RESEARCH section; Required Plan Document fence and its prose; SAVED section; write-allowlist lines; Scale To The Ask)
   - Not in scope: csm-build/SKILL.md (T003); any synced boilerplate section including the Subagent Resilience ladder (T001 owns it and adds the quota rung there); check-suite.mjs (T006)
   - Spike candidate: none
   - Actions:
     1. Required Plan Document (csm-plan/SKILL.md ~213-294): add a `format: csm-plan/1` line as the first line inside the fenced template (F-050). In the Control block add `paused` to the Status enum, a `Last model/run:` field, and a `- Resume:` BULLET (NOT a `## Resume` H2 — the gate's template-corpus subsequence check at check-suite.mjs:532-533 requires every corpus plan to carry every template H2; no corpus plan has `## Resume`, so an H2 would fail all 17) stating: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, working-tree diff. Keep all other fields and `## ` heading order unchanged.
     2. Draft sidecar: in the write-allowlist/Core Rules area and SAVED section, add the rule: persist `.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.draft.md` (same template structure plus journal) after every state transition; a resumed planning invocation checks for the `.draft` file first and continues from its recorded state; at SAVED rename `.draft` to the final `.md` (the `.draft` is disposable; only the final file is the plan).
     3. RESEARCH state: add a current-knowledge check — each research track must first retrieve current, authoritative sources for every technology the plan touches using named read-only tools available in the environment (webfetch; installed docs-search MCPs such as cloudflare-docs search); the required research report fields gain `source URL + retrieval date`; sources older than 30 days are flagged (staleness precedent csm-plan:97). The R&D safety gate already permits read-only retrieval (csm-plan:111) — reference it, do not duplicate it.
     4. Do NOT edit the Subagent Resilience ladder section (synced, owned by T001, which adds the quota rung); instead, where the plan's resilience ladder behavior is referenced (csm-plan ~57-64 vicinity is synced — place it in non-synced prose only if a reference is needed), add one non-synced sentence in RESEARCH or Core Rules noting that quota-type failures never invoke the retry ladder.
     5. Scale To The Ask + SAVED: make output display scale-gated — small/quick runs display summary + path + evidence highlights; large runs display the complete plan (A5).
     6. Frontmatter: trim description to <=35 words keeping the Never-X clause and activation criteria, and append "Biases towards retrieval from current documentation over pre-trained knowledge." Stay <=1024 chars.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 AND `grep -n "format: csm-plan/1" csm-plan/SKILL.md` finds the marker inside the template fence AND the Control template fence contains `paused` and `Last model/run:` and a `- Resume:` bullet AND `grep -c "^## Resume" csm-plan/SKILL.md` equals 0 AND frontmatter description word count <= 35.
   - Validation: template-corpus check passes (check-suite.mjs:473-588) with no corpus artifact changed by this task; `grep -n "draft" csm-plan/SKILL.md`; bias sentence present; description still contains a never-clause and is <=1024 chars.
   - Acceptance evidence: recorded check-suite output; grep results; word-count before/after.
   - Repair attempts: 0
   - Recovery note: if check-suite fails after the template change, the corpus may need the same `format:` marker — but this task must NOT retrofit corpus plans unless the H2 sequence changed (it must not, per the Resume-bullet rule); if the gate names a corpus artifact, first re-check the fence for an accidental H2 addition, then only if no H2 changed and the gate still fails, record the artifact and add the marker with journal evidence.

3. [pending] csm-build: quota-pause protocol, resilience ladder, resume contract, ordinal fix, frontmatter
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-build/SKILL.md (Execution State Machine section incl. RECOVER and CHECKPOINT; a new `## Pause On Quota` section; Core Rules; SELECT; Completion Gate interplay; frontmatter)
   - Not in scope: csm-plan/SKILL.md (T002); check-suite.mjs (T006); synced boilerplate sections (T001)
   - Spike candidate: none
   - Actions:
     1. Add `## Pause On Quota` (unnumbered H2, BLOCKED precedent — do NOT touch the backticked chain or numbered `### N.` headings, the gate requires their exact counts) defining PAUSED: signal set {HTTP 429, rate-limit, quota-exceeded, out-of-credits, billing, context-length-exceeded}; on signal: record the exact error in the journal as evidence; integrate only already-returned, safe in-flight subagent results; run the full CHECKPOINT block including the commit; set Control `Status: paused`, `Current CSM state: PAUSED`, `Next transition: PAUSED -> RECOVER`; stop cleanly. State explicitly this is the one exception to "Do not stop after one task or cycle". Transient signals: one short backoff retry before pausing; hard exhaustion pauses immediately.
     2. Update the From-CHECKPOINT transition sentence (csm-build:110) and Completion Gate/Blocker Rules cross-references to include the PAUSED stop, keeping BLOCKED semantics unchanged.
     3. Add a subagent resilience ladder subsection (mirroring csm-plan's 4-rung ladder, shortened) with the quota rule: on quota-type subagent failure do NOT retry — surface to the primary agent for the pause protocol.
     4. SELECT: add a best-effort pre-flight probe — when resuming from a paused plan, before the first DISPATCH issue one cheap model call; on a quota signal, stay paused (journal the probe result and report), otherwise proceed.
     5. RECOVER: fix the duplicate `2.` ordinal at csm-build/SKILL.md:119-120 (renumber the second `2.` to `3.` and renumber the following step); add a resume block instruction: re-read Control Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff; when `Last model/run:` differs from the current run, re-verify acceptance evidence authored by the previous run instead of trusting status labels.
     6. Core Rules/CHECKPOINT: record `Last model/run:` at each checkpoint.
     7. Frontmatter: trim description to <=35 words, keep Never-X and activation criteria; append "Biases towards retrieval from the saved plan and current repository evidence over memory." (optional additive bias), stay <=1024 chars.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 (chain + heading invariants intact) AND `grep -n "## Pause On Quota" csm-build/SKILL.md` AND `grep -n "Current CSM state: PAUSED" csm-build/SKILL.md` AND `grep -n "Next transition: PAUSED -> RECOVER" csm-build/SKILL.md` AND RECOVER block has strictly sequential ordinals 1..N (verify with `sed -n '114,124p' csm-build/SKILL.md`).
   - Validation: `grep -n "429\|rate-limit\|out-of-credits\|billing\|context-length" csm-build/SKILL.md` returns the full 6-signal set; `grep -n "Last model/run" csm-build/SKILL.md`; pre-flight probe text present in SELECT; no backticked chain token added (diff check against the original chain string); the resilience-ladder subsection is a NON-synced section (csm-build has no synced ladder).
   - Acceptance evidence: check-suite output; ordinals listing; grep results; diff of the state-machine section.
   - Repair attempts: 0
   - Recovery note: if check-suite chain validation fails, the edit likely touched the backticked chain or a numbered heading — restore the exact original chain and headings, then re-apply prose-only changes.

4. [pending] csm-grill and csm-review: retrieval protocol, bias, format markers, anchor drift, display scaling
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-grill/SKILL.md, csm-review/SKILL.md (frontmatter; SCOUT/DEEP_DIVE for grill; EVIDENCE + Review Dimensions for review; both fenced templates; SAVED display rules)
   - Not in scope: csm-plan/csm-build files (T002/T003); synced boilerplate sections including the Subagent Resilience ladders (T001 owns them and adds the quota rung there); review dimension anchor content changes beyond the drift check
   - Spike candidate: none
   - Actions:
     1. csm-grill: in SCOUT/DEEP_DIVE, name the retrieval tools (webfetch; installed docs-search MCPs) for the existing "repo, docs, tooling, web" harvest and require research subagent outputs to cite `source URL + retrieval date`. Add a non-synced quota note in the machine prose: on hard quota exhaustion, stop cleanly and tell the user the interview is NOT mid-session resumable (grill persists nothing until SAVED) — restart from the user's answers (one-question-at-a-time state is cheap to rebuild). Add `format: csm-grill/1` as the first line of the Required Approach Document fence (F-050). Make SAVED display scale-gated (A5). Frontmatter: trim to <=35 words keeping Never-X; append the bias sentence; <=1024 chars.
     2. csm-review: in EVIDENCE, add an anchor edition-drift check — webfetch each dimension anchor URL, record whether the pinned edition is superseded, and surface superseded editions as low/info findings (reuse the external-verification pattern at csm-review:69 and extend csm-review:134). Add `format: csm-review/1` as the first line of the Report Format fence (F-050). Add a non-synced quota note in the machine prose: hard exhaustion stops the run cleanly; resume via the report Control journal (csm-review:107). Make SAVED display scale-gated (A5). Frontmatter: trim to <=35 words keeping Never-X; append the bias sentence; <=1024 chars.
     3. Do not change the Review Dimensions table contents, the machine chain, or the Entry/Exit state headings (gate-enforced).
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 AND `grep -n "format: csm-grill/1\|format: csm-review/1" csm-grill/SKILL.md csm-review/SKILL.md` AND bias sentence present in both frontmatters AND `grep -n "source URL\|retrieval date" csm-grill/SKILL.md csm-review/SKILL.md` >= 2.
   - Validation: `grep -n "edition" csm-review/SKILL.md` shows the drift check wording; display-scale text present in both SAVED sections; descriptions <=35 words and <=1024 chars with Never-X; corpus template checks pass.
   - Acceptance evidence: check-suite output; grep results; word counts.
   - Repair attempts: 0
   - Recovery note: if the corpus check fails on format markers, the existing artifacts were retrofitted — the gate error names the artifact; if a committed artifact lacks the marker, add it in this task's scope with journal evidence.

5. [pending] csm-bdd-tdd, csm-scan, csm-browse, csm-upload: resume parity, Testing trim, frontmatter trims
   - Task ID: T005
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: csm-bdd-tdd/SKILL.md, csm-scan/SKILL.md, csm-browse/SKILL.md, csm-upload/SKILL.md (non-synced sections and frontmatter only)
   - Not in scope: csm-scan lib/scripts code; csm-bdd-tdd specs pipeline mechanics; synced boilerplate (T001); README.md (T008)
   - Spike candidate: none
   - Actions:
     1. csm-bdd-tdd: mirror the paused/resume contract in its specs control doc guidance — `Status: paused` and `Next transition: PAUSED -> RECOVER` are valid control values when quota stops a mutation mid-pipeline, and the specs/control.md resume rule (csm-bdd-tdd/SKILL.md:103) already covers continuation; add one sentence referencing csm-build's `## Pause On Quota` instead of restating it (existing "Same rules as csm-build" precedent at csm-bdd-tdd:37). Keep the chain and numbered headings untouched.
     2. csm-scan: trim the `## Testing` section (currently 34 lines at csm-scan/SKILL.md:208-241) to <=15 lines: the authoritative suite command, the tier-runner line, and a focused-gate pointer. Keep the MANIFEST-required heading (contracts.mjs:33). Do NOT edit README.md.
     3. csm-browse: trim frontmatter description from 47 to <=35 words, keeping the Never-X clause and activation criteria (check-suite.mjs:388-391), <=1024 chars.
     4. csm-upload: trim frontmatter description from 50 to <=35 words, keeping the Never-X clause, <=1024 chars.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 AND `grep -c "PAUSED" csm-bdd-tdd/SKILL.md` >= 1 AND `wc -l csm-scan/SKILL.md` <= 220 AND csm-browse and csm-upload frontmatter descriptions each <= 35 words (verified with a word-count command).
   - Validation: `## Testing` heading still present in csm-scan; bdd-tdd chain/headings unchanged (diff); browse/upload descriptions still contain a never-clause and are <=1024 chars; README unchanged by this task (git diff --stat shows no README.md entry).
   - Acceptance evidence: check-suite output; line-count before/after for csm-scan; word counts for browse/upload; grep results.
   - Repair attempts: 0
   - Recovery note: if check-suite fails on the scan Testing section, the MANIFEST heading check (contracts.mjs:33) is the likely cause — keep the heading and only shrink the body. If a browse/upload description fails the Never-X check, restore a never-clause phrasing within the 35-word budget.

6. [pending] check-suite and plan-validation module: Control/journal/ordinal/template/interface validation and corpus repair
   - Task ID: T006
   - Depends on: none
   - Parallel group: G1
   - Risk: high — the commit gate itself; requires independent review (gate changes are public-interface changes for every future commit)
   - Owned scope: scripts/check-suite.mjs, scripts/lib/plan-validation.mjs (NEW module housing the new checks), scripts/lib/contracts.mjs, scripts/gen-readme-matrix.mjs, plus the single known corpus repair edit to `.agents/plans/2026-08-19-consolidated-remaining-work-csm.md`
   - Not in scope: csm-browse/csm-scan test suites; scripts/lib/boilerplate.mjs and sync tool (T001); new behavioral tests file (T007); any SKILL.md file
   - Spike candidate: Interface-content truth-source direction — before implementing, verify in a /tmp sandbox which is smaller: (a) full-sentence substring assertion of INTERFACES matrix strings in SKILL.md prose — KNOWN INFEASIBLE as specced (INTERFACES csm-build handoff "delivery to csm-browse" is not a substring of csm-build/SKILL.md:99; csm-browse handoff differs from csm-browse/SKILL.md:16), so the default is (b) artifact-path pattern assertion (e.g. `.agents/plans/<date>-<goal>-csm.md`, `NORMS.md`, `*-bdd-csm.md`, `.agents/reviews/<date>-<repo>-review.md`, GitHub Pages) against the corresponding SKILL.md Interface sections, or (c) derive INTERFACES data from SKILL.md prose. Default is (b); spike in /tmp, no repo changes.
   - Actions:
     1. Create scripts/lib/plan-validation.mjs exporting the new checks as pure functions over parsed plan text (so T007 can test them directly without spawning check-suite): (a) Control validation — `Status:` one of ready|in_progress|paused|blocked|complete; `Current CSM state:` a chain token or a documented stop value (NOT_STARTED/COMPLETE/PAUSED); `Next transition:` a terminal sentinel (`none (terminal)`, `COMPLETE`, `none; closed as superseded ...`) or a valid `TOKEN -> TOKEN` pair or the documented prefix "On a future explicit csm-build invocation, <A> -> <B>"; (b) journal validation — required columns and Next-state values within the enum; (c) ordinal sequencing — numbered lists inside `### N.` state sections strictly sequential without duplicates; (d) template format-marker validation — first line inside the producer fences matches `format: <skill>/<n>`; (e) interface artifact-pattern assertion per the spike decision (default b).
     2. Wire the module into scripts/check-suite.mjs: apply Control/journal checks to `*-csm.md` plans ONLY (reviews embed a different journal grammar `[ts] From -> To :: cycle n`; approaches use `Status: agreed` — both explicitly exempt), and exempt plans whose Status is complete or whose Next transition is a terminal/superseded sentinel from strict validation (they encode history — the sibling plan 2026-08-20-embrace-journal-learnings-csm.md records this convention).
     3. Unify the divergent fenceMap/splitLines implementations (F-054) into the shared module and use it in check-suite.
     4. Verify/repair the known corpus drift: 2026-08-19-consolidated-remaining-work-csm.md `Next transition` must be a valid `TOKEN -> TOKEN` pair (amended at planning 2026-08-20 to the prefix form "On a future explicit csm-build invocation, NOT_STARTED -> RECOVER" — the plan is ACTIVE with T010/T011/T012 pending, so a terminal sentinel is NOT a valid repair for it); if drifted again, repair with a journal row recording the edit.
     5. Do not weaken any existing check; keep the current check count or increase it.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 on the clean tree AND a deliberate one-violation-per-new-check fixture in a /tmp copy of the corpus fails each new check (recorded negative-test evidence: 5 violation->failure pairs).
   - Validation: `node scripts/gen-readme-matrix.mjs --check` passes; `node --check scripts/lib/plan-validation.mjs scripts/check-suite.mjs`; the full pre-existing gate battery still passes; no SKILL.md file modified (git diff --stat).
   - Acceptance evidence: check-suite output; negative-test transcript; corpus repair diff summary; module export list.
   - Repair attempts: 0
   - Recovery note: if a new check breaks unrelated artifacts, the check is too strict — narrow it (e.g. extend an exemption) and re-run; if corpus repairs balloon beyond the one known artifact, stop and re-scope (record in journal). If check-suite regresses, revert scripts/check-suite.mjs and scripts/lib/plan-validation.mjs to HEAD and re-apply in smaller increments, recording each increment's check result.

7. [pending] Behavioral resume-semantics tests (F-063)
   - Task ID: T007
   - Depends on: T002, T003, T006
   - Parallel group: G3
   - Risk: high — new test harness; requires independent review (test-adequacy of the resume path)
   - Owned scope: new files `tests/resume-semantics.test.mjs`, `tests/fixtures/resume/` (fixture plan artifacts)
   - Not in scope: changes to check-suite.mjs or scripts/lib/plan-validation.mjs (T006); changes to SKILL.md files (T002-T005)
   - Spike candidate: none
   - Actions:
     1. Template-contract round-trip test: extract the fenced Required Plan Document from csm-plan/SKILL.md; assert it starts with `format: csm-plan/1`, contains the Control fields (Status enum incl. paused, Last model/run, Next transition, `- Resume:` bullet), has NO `## Resume` H2, and keeps the expected `## ` heading order.
     2. PAUSED->RECOVER golden test: a fixture plan with `Status: paused`, `Current CSM state: PAUSED`, `Next transition: PAUSED -> RECOVER`, and a valid journal row must pass the plan-validation checks imported from `scripts/lib/plan-validation.mjs` (T006's module — import it directly; do NOT spawn check-suite, which requires the full structural repo).
     3. Journal/chain consistency test: for every corpus plan, every journal "Next state" value is a valid state token; Control fields are consistent with the journal's last row (via the imported module).
     4. Quota-signal set test: assert csm-build/SKILL.md's `## Pause On Quota` section lists each of the 6 signals and the `PAUSED -> RECOVER` marker string.
     5. Keep tests hermetic: no network, no subprocesses beyond `node`, no writes outside the repo's test fixtures.
   - Acceptance signal: `node --test tests/resume-semantics.test.mjs` exits 0 (all pass) AND `node scripts/check-suite.mjs` still exits 0.
   - Validation: `node --test tests/` runs the existing bootstrap suites and they remain green; `git diff --stat` shows only the new test files.
   - Acceptance evidence: test run transcript with pass counts; check-suite output.
   - Repair attempts: 0
   - Recovery note: if the golden fixture fails, the module or the fixture is wrong — compare against the T003 wording (PAUSED, `Next transition: PAUSED -> RECOVER`) and the T006 module implementation; fix the fixture only if it contradicts the skill text, otherwise fix the module (with T006's owner informed via journal).

8. [pending] Regenerate payload, README integrity, and run the full verification battery
   - Task ID: T008
   - Depends on: T002, T003, T004, T005, T006, T007
   - Parallel group: G4 (strictly sequential after T007 — its battery invokes tests/resume-semantics.test.mjs)
   - Risk: standard
   - Owned scope: bootstrap/package/payload/skills/**, bootstrap/payload-index.json (via pack script — pack-bootstrap.mjs writes it at bootstrap/payload-index.json), README.md (only via gen-readme-matrix --write if the spike in T006 landed on the derive-from-prose direction, or if drift appears), the final plan document updates
   - Not in scope: any source behavior change; anything outside payload + README + plan file
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs` to regenerate the payload copies of all 8 SKILL.md files and the sha256 index; record the deterministic tarball digest.
     2. Run `node scripts/gen-readme-matrix.mjs --check` (and `--write` only if the Interface content changed — it should not, per T006's drift check).
     3. Run the full verification battery and record results: `node scripts/check-suite.mjs`; `node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs`; `node --test tests/resume-semantics.test.mjs`; `cd csm-scan && node --test --test-concurrency=1`; `cd csm-browse && node scripts/check-skill.mjs`.
     4. Update this plan's Control, Discovered Requirements, and Progress Journal with the results; record pass counts and wall times per the repo's recording discipline.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs` prints a deterministic digest AND `node scripts/check-suite.mjs` exits 0 AND the integrity test `node --test tests/protocol/integrity.test.mjs` exits 0 AND the csm-scan authoritative suite reports `# fail 0` AND csm-browse check-skill exits 0.
   - Validation: `git diff --stat` limited to payload files, README (if changed), and plan document; all 8 payload SKILL.md files byte-match their repo counterparts (`diff -r`).
   - Acceptance evidence: recorded digest, test transcripts, diff stat, byte-match confirmation.
   - Repair attempts: 0
   - Recovery note: if pack-bootstrap or integrity fails, the payload index is stale — re-run pack-bootstrap; if the csm-scan suite fails, investigate per the tier manifest before touching source (a failure here means an earlier task regressed it; evidence must cite the failing test).

## Verification Strategy

Ordered cheapest-first:
- Fast per-task gates (run in each task): `node scripts/check-suite.mjs` (repo-wide, ~seconds), `node scripts/sync-skill-boilerplate.mjs --check` (T001), grep-based content assertions per task, `node --check` on edited .mjs.
- Mid-tier (T006, T007): `node --test tests/resume-semantics.test.mjs`; negative-test transcripts for new checks; `node scripts/gen-readme-matrix.mjs --check`.
- Expensive final batch (T008, serial, after all tasks): full bootstrap suites (`node --test tests/...`), csm-scan authoritative suite (`node --test --test-concurrency=1`, ~132s, serial-only per repo norm), csm-browse `check-skill.mjs`, pack-bootstrap digest. These are the only checks that need Docker/full-network isolation — run them once at T008.
- Parallelism: per-task gates can run during G2 in parallel; the T008 battery is sequential by design.
- Environment sensitivity: csm-scan suite must run serial (`--test-concurrency=1`) — parallel mode races filesystem-heavy fixtures (known repo norm). csm-browse e2e (Docker) is NOT part of acceptance; check-skill.mjs is the fast substitute. Flaky-risk: none known beyond the parallel csm-scan race, which is avoided by construction.

## Risks And Recovery

- Gate coupling (medium): every SKILL.md edit must pass 457 checks (last recorded gate run, 2026-08-20); mitigations are per-task acceptance signals that run check-suite immediately; recovery is per-task Recovery notes (revert smallest increment).
- check-suite changes break the commit path (high, T006): negative-test fixtures, incremental application, independent review mandate; rollback = revert check-suite.mjs and scripts/lib/plan-validation.mjs to HEAD.
- Corpus drift blocks new checks (medium, T006): known example (consolidated plan `Next transition: SCOPE`); mitigation is the explicit single-artifact corpus-repair action with journal evidence, plus COMPLETE/superseded exemptions; if repairs balloon beyond the known artifact, re-scope.
- Template-fence blast radius (high, T002): an H2 added to the plan template would fail the corpus subsequence check on all 17 plans; mitigated structurally by rendering Resume as a Control bullet (no H2) and the Execution-Graph rule that template H2 changes require same-task corpus retrofit.
- Chain-validation traps (medium, T003): PAUSED must not enter the backticked chain; recovery is restoring the exact chain string and headings.
- Payload drift goes unguarded (medium): only T008's byte-match `diff -r` and the integrity test catch it; T008 runs them before completion.
- Output-display scaling changes transcript behavior (low, deliberate): flagged in Assumptions A5 for user awareness; reversible by reverting the SAVED section wording.
- Model-switch judgment drift (low): mitigated by the explicit re-verify-prior-evidence rule in T003 RECOVER; residual risk recorded in journal if a resumed run trusts stale evidence.
- Deferred (not blockers): lean-plan format v2 and template lazy-loading (D1/D2) both require gate machinery changes beyond this round's scope; revisit when the token budget justifies the gate surgery.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| C1: Plan itself lacks `format: csm-plan/1` frontmatter — gate red at baseline, csm-build RECOVER would stop | Critical | Added `format: csm-plan/1` frontmatter to this plan; Control notes the gate goes green on the SAVED commit | Verified corpus convention: all plans carry the marker at line 2 |
| C2: T002 `## Resume` H2 would break all 17 corpus plans via subsequenceGap | Critical | Resume rendered as a `- Resume:` bullet inside the Control template block; acceptance asserts `grep -c "^## Resume"` == 0; Execution-Graph rule added (template H2 changes require same-task corpus retrofit) | Verified: no corpus plan contains `## Resume`; check-suite.mjs:532-533 subsequence check |
| C3: Resilience-ladder edits in T002/T004 target synced boilerplate owned by T001 | Major | T001 extends boilerplate.mjs subagentResilience with the quota rung for all laddered skills; T002/T004 scope bars the ladder; T002 action 4 reduced to a non-synced reference sentence | RESILIENCE_PARAMS + SYNC_SECTIONS at boilerplate.mjs:66-97 |
| C4: csm-browse/csm-upload frontmatter trims unassigned — AC1 unreachable | Major | T005 expanded to own csm-browse + csm-upload frontmatter trims (47->35, 50->35 words) | Verified word counts: 47/50 > 35 |
| C5: T006 `Next transition: <token> -> <token>` fails 15/17 corpus plans | Major | Validation scoped to `*-csm.md`; terminal sentinels (`none (terminal)`, `COMPLETE`, superseded forms) and the prefix convention allowed; COMPLETE/superseded plans exempt; repair set enumerated to the single `SCOPE` artifact | Verified 16 corpus Next-transition values across sentinels/prefix conventions |
| C6: T007 golden test has no assigned check-logic extraction; spawning check-suite infeasible on fixtures | Major | T006 creates importable `scripts/lib/plan-validation.mjs`; T007 imports it directly; spike only for interface direction | check-suite requires full structural repo (skills dirs, README, LICENSE) |
| C7: Pre-commit hook test asserts SYNC and would break | Major | RESOLVED externally — the completed oxlint-lefthook-precommit plan updated the hook test (shim-era assertions, suite 7/7); T001 scope bars the hook files; acceptance retains the `grep -c "sync-skill-boilerplate" .lefthook.yml` == 0 signal | .lefthook.yml pre-commit jobs; scripts/hooks/test/pre-commit.test.mjs |
| C8: A4 rationale wrong for csm-grill — no journal exists | Major | A4 rewritten; grill quota rule = stop cleanly, restart interview; review keeps journal-resume | csm-grill persists nothing until SAVED (csm-grill:41-43) |
| C9: G3 T007\|\|T008 concurrency breaks when T008 runs the not-yet-existing test | Minor | G3 = T007 alone; T008 strictly sequential (G4) after T007 | T008 action 3 invokes tests/resume-semantics.test.mjs |
| C10: Interface substring assertion infeasible as specced | Minor | Spike default switched to artifact-path pattern assertion (option b); README regeneration implications recorded in T006/T008 | INTERFACES handoff wording differs from SKILL.md prose (build:99, browse:16) |
| C11: Weak acceptance greps (PAUSED >= 4, paused >= 1) | Minor | T003 acceptance now asserts `Current CSM state: PAUSED` + `Next transition: PAUSED -> RECOVER`; T002 asserts paused/Last model/run/Resume bullet + no `## Resume`; T001 adds tmux phrase checklist | — |
| C12: Stale facts (156 checks, 1209 tests, NORMS words, payload-index path, dup block, R2 ref) | Nit | All corrected: 441 checks, 1,227 tests, NORMS 188/161 words, bootstrap/payload-index.json, duplicate T006 block removed, R2 renamed to D1/D2 | Verified against repo and journal records |
| C13: Reviews/approaches journal grammar incompatible | Minor | Control/journal checks scoped to `*-csm.md` only; reviews/approaches explicitly exempt in T006 action 2 | Review journals use `[ts] From -> To :: cycle n`; approaches use `Status: agreed` |
| C14: T005 conditional README write crosses T008 ownership; weak scan signal | Minor | README write removed from T005 (T008 owns README regeneration); scan trim signal tightened to <=220 lines + heading retention | — |
| C15: G2 template/corpus interaction under-specified | Minor | Execution-Graph rule added: template-fence H2 changes require same-task corpus retrofit; T002 avoids H2 by design | — |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE | — | Brief classified large/open; goals decoded to token efficiency, quota pause/resume, model-switch resume, speed/minimalism, curiosity, end-to-end | DISCOVER |
| 2026-08-20 | 0 | DISCOVER | — | Repo inspected: 8 skills, README, csm-build, boilerplate.mjs, contracts.mjs, check-suite.mjs, pre-commit, baselines, reviews | RESEARCH |
| 2026-08-20 | 0 | RESEARCH | — | 4 parallel tracks: token audit, quota/resume, retrieval/curiosity, end-to-end speed; key facts re-verified (ordinal bug, pre-commit dup, chain validator, no Control checks) | DRAFT |
| 2026-08-20 | 0 | DRAFT | — | Plan drafted: 8 tasks, parallel groups G1-G4, acceptance criteria mapped | CRITIQUE |
| 2026-08-20 | 0 | CRITIQUE | — | Independent hostile review: 15 findings (2 critical, 7 major, 4 minor, 2 nits) — plan "needs major rework"; all facts re-verified against repo | REMEDIATE |
| 2026-08-20 | 0 | REMEDIATE | — | All 15 findings resolved: format marker added; Resume bullet; ladder quota rung to T001; browse/upload trims to T005; scoped Control checks + plan-validation module; hook test; A4/grill fix; G4 sequential; spike default; strengthened signals; facts corrected | VERIFY |
| 2026-08-20 | 0 | VERIFY | — | Post-planning re-validation against the repo: sibling plans lint-strictness-enforcement and oxlint-lefthook-precommit COMPLETEd meanwhile — gate count 441→457 (2026-08-20); F-069 component 2 (doubled pre-commit drift check) already resolved (hook is a lefthook shim, .lefthook.yml jobs have no sync step, hook-test SYNC assertions dropped); check-suite.mjs:375→376 citation corrected; stale claims updated in Goal d6, Constraints, AC2, Current-State Evidence, R&D R2, Design token-efficiency, Execution Graph, T001 scope/actions/recovery, Risks, Critique C7; tree clean, payload in sync (pack digest a2ba3f39) | SAVED |
| 2026-08-20 | 1 | NOT_STARTED -> RECOVER -> VALIDATE | — | csm-build dispatched by explicit user request. RECOVER: git status clean except the plan file (stale-fix edits above, committed with this row); no NORMS.md at root (skip norms); format: csm-plan/1 verified at line 2; all 8 tasks [pending]; no partial build artifacts. VALIDATE: check-suite 457/457 OK; sync-skill-boilerplate --check "OK — no drift"; gen-readme-matrix --check "OK — region matches contracts" | SELECT |

## Completion Review

(filled by csm-build when all criteria are verified)
