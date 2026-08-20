---
format: csm-plan/1
---

# Cache Maximization And Token Efficiency CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 1 high-risk (T001 gate engineering), 4 standard. Tasks that always require independent review: T001.

## Control
- Plan ID: cache-token-efficiency
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: none
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal

Operationalize the cache-maximization and token-reduction research (3 parallel tracks + DeepSeek pricing/KV-cache docs, retrieved 2026-08-20) into this repository so the opencode + deepseek-v4-flash stack measurably maximizes prefix-cache hits (~97% input discount on hits) and minimizes token spend without quality loss, while keeping the conformance gate green and never regressing the 220-word frontmatter budget (AC1 of the completed skill-suite-efficiency-resilience plan).

Deliverables:
1. Gate-level protection of prefix stability and the frontmatter word budget: new check-suite checks rejecting volatile content (dates, years, versions, env vars, absolute paths) in skill descriptions and enforcing the ≤220-word total, so cache hits cannot be silently invalidated or the budget silently regressed by future edits.
2. A zero-dependency cache-health monitor (`scripts/cache-health.mjs`) that reads opencode's SQLite database via the bundled `opencode db` CLI and reports per-session and per-day cache read/write ratios and actual cost for deepseek-v4-flash — granularity the built-in `opencode stats` does not provide.
3. A documented subagent prefix-sharing rule in csm-build DISPATCH: parallel dispatches share a byte-identical static prefix so DeepSeek's automatic prefix caching serves requests #2..N at ~97% input discount; provider-specific notes (Anthropic-style stagger-first-request) recorded.
4. Durable cache/token hygiene guidance in the repo: a concise AGENTS.md at the repo root (project rules for future sessions), a dated reference doc under .agents/docs/, and a README bullet — including a docs-only recommended opencode.jsonc block (compaction auto+prune, small_model, per-model limit.output, agent steps; per user decision the plan does NOT edit the live config).
5. Full verification battery and payload refresh, with the plan completed and evidenced.

Constraints:
- `node scripts/check-suite.mjs` must stay green (516 checks at last gate run, 2026-08-20) and the check count must not decrease; every edit keeps the lefthook pre-commit gates green.
- The 8-skill frontmatter descriptions total exactly 220 words today; NO new skill may be added (each skill description is injected into every session's prefix — a 9th skill would regress the budget and the cache-friendly prefix). Guidance goes to AGENTS.md/docs, not a new SKILL.md.
- Synced boilerplate sections (Tmux Session Bootstrap, Subagent Resilience) change ONLY via `node scripts/sync-skill-boilerplate.mjs --write`; csm-build DISPATCH and Core Rules prose are hand-editable.
- No live config edits: ~/.config/opencode/opencode.jsonc stays untouched; recommended settings are documented in the repo only (user decision, 2026-08-20).
- The monitor is zero-dependency and read-only: it queries the live opencode.db via `opencode db "<SQL>"` (no writes, no copies of the 886 MB DB, no node:sqlite requirement — Node v20 lacks it, no sqlite3 CLI available).
- No network calls, no external services, no mutation of the opencode DB.

Exclusions:
- No change to opencode's live config, auth, or MCP setup.
- No new skills; no changes to skill frontmatter wording (budget is exactly consumed).
- No provider-side cache configuration (DeepSeek caching is automatic; no cache_control equivalent exists — documented in the reference doc instead).
- No changes to the universal bootstrap envelope schema or signing.
- csm-browse/csm-scan behavior unchanged.

## Acceptance Criteria

1. `node scripts/check-suite.mjs` exits 0 with check count 525 (516 + 8 volatile + 1 budget; criterion: >= 518); the new volatile-content check rejects a deliberately planted date/year/version/$ENV/absolute-path in a full-tree /tmp copy run via `check-suite --root` (mechanism pinned in T001) and passes all 8 live descriptions; the new word-budget check fails a planted 221-word set in the copy and passes the live 220; negative evidence recorded (2 violation->failure pairs, transcripts).
2. `scripts/cache-health.mjs` exists, has no npm dependencies (only subprocess is the bundled `opencode` CLI — verified present), runs read-only against the live DB, prints per-session and per-day cache hit ratio (= cache.read / (cache.read + input + cache.write), zero-denominator guarded) and actual cost for deepseek-v4-flash sessions; its parsing/aggregation logic is covered by hermetic unit tests (fixture query output); a live run on this machine records per-session ratios within the 80-100% band (research sample 88-99%; exact values recorded — no magnitude gate).
3. csm-build/SKILL.md DISPATCH (and Core Rules where natural) contains the prefix-sharing rule with the DeepSeek automatic-cache rationale and the Anthropic-style stagger note; `grep -n "prefix" csm-build/SKILL.md` finds the rule; check-suite stays green; the synced sections are untouched (sync --check clean).
4. AGENTS.md exists at the repo root (concise, <100 lines), .agents/docs/2026-08-20-cache-token-efficiency.md exists and is indexed in .agents/README.md, README.md gains the hygiene bullet; all reference the lint (T001), the monitor (T002), and the prefix-sharing rule (T003); check-suite + gen-readme-matrix --check green; no new skill directory exists (git status shows none).
5. Full verification battery green and recorded: check-suite (525); sync --check; gen-readme-matrix --check; `node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs tests/resume-semantics.test.mjs tests/cache-health.test.mjs`; csm-scan serial suite (baseline >= 1200, # fail 0); csm-browse check-skill PASS; `node scripts/pack-bootstrap.mjs` deterministic digest (expected to differ from the previous 912219dfa3 because T003 edits csm-build/SKILL.md — must be stable across two consecutive runs with the delta attributed to `payload/skills/csm-build/SKILL.md`); payload byte-match `diff -r` all 8 skills; README matrix region intact.
6. Every numbered task completed with recorded acceptance evidence in this plan document; no change to the CSM state machines' gate-verified chains; frontmatter total remains exactly 220 words.

## Current-State Evidence

- DeepSeek pricing (api-docs.deepseek.com/quick_start/pricing, retrieved 2026-08-20): deepseek-v4-flash input cache HIT $0.007/M off-peak vs MISS $0.22/M — ~97% discount; output $0.66/M (3x input). Context caching (api-docs.deepseek.com/guides/kv_cache): automatic, on by default; hits require FULL match of a persisted prefix unit (request-boundary, common-prefix, and fixed-token-interval persistence); cache persists hours-days; usage exposes prompt_cache_hit_tokens / prompt_cache_miss_tokens. No cache_control knob.
- opencode v1.15.12 (local): `opencode stats --days N --models` reports aggregate Cache Read/Write per model but NOT per-session; `opencode db "<SQL>"` works read-only (verified; `--format tsv` confirmed present and the default); DB `session` table has tokens_input/tokens_output/tokens_reasoning/tokens_cache_read/tokens_cache_write/cost columns (verified via PRAGMA); `message.data` JSON carries per-step `tokens.cache.{read,write}` (94% of 42,727 messages have cache.read > 0; cache.write is 0 for deepseek in 100% of records); 984 sessions, 340 deepseek-v4-flash.
- Measured hit ratios from live DB (2026-08-20, via R3): general-agent sessions 88.4-99.1% cache read (lucky-eagle 99.12%, sunny-cactus 92.84%, quick-tiger 91.48%, lucky-falcon 90.30%, quiet-eagle 89.20%, swift-planet 88.41%); build-agent session misty-otter 82.46%.
- LOGS ARE NOT A DATA SOURCE: ~/.local/share/opencode/log/<date>T<time>.log are per-process, pruned within minutes (two 47MB/97MB files deleted mid-research); the `tokens={"input":0,...,"cache":{"read":0,"write":0}}` lines are zero-valued session-creation markers only; no per-step usage at INFO level (grep-verified). The initial DISCOVER claim that logs carry cache fields was disproved during RESEARCH — the monitor MUST target the DB.
- Frontmatter volatility audit (R2): all 8 descriptions are clean (no dates/years/$ENV/abs paths; csm-browse's `9222` is a stable constant — a bare `\d{4}` regex must NOT be used); total exactly 220 words (grill 26 / plan 28 / bdd-tdd 30 / build 28 / review 30 / scan 27 / browse 26 / upload 25); Never-X clauses intact. The gate enforces <=1024 chars + Never-X (check-suite.mjs:402-405) but NOT word count and NOT volatility.
- Lint hook point: check-suite.mjs main loop after the existing description checks at check-suite.mjs:402-405; add VOLATILE_DESC_RE + one check; add one total-word check. No MANIFEST/registry change needed.
- opencode config schema (https://opencode.ai/config.json + /docs/config + /docs/models, retrieved 2026-08-20): keys `model`, `small_model`, `agent.<name>.{model,steps,prompt,tools}`, `provider.<id>.models.<id>.options` (documented examples: OpenAI reasoningEffort/textVerbosity, Anthropic thinking.budgetTokens), `provider.<id>.models.<id>.limit.{context,output}`, `compaction.{auto,prune,reserved}`, `instructions`, `subagent_depth`. No documented DeepSeek thinking/max_tokens knob (passthrough possible but undocumented — recorded as deferred; the live config is out of scope per user decision).
- Session title generation currently uses the main model (deepseek-v4-flash, `small=true` in session logs) — `small_model` is the documented lever to offload it.
- csm-build/SKILL.md DISPATCH and Core Rules are per-skill prose (NOT sync-managed; SYNC_SECTIONS = Tmux Session Bootstrap + Subagent Resilience only, boilerplate.mjs:79-89).
- No AGENTS.md at repo root. .agents/docs/ holds dated reference docs indexed in .agents/README.md. README.md `## Development & testing` (~line 199-206) lists gates as bullets; README checks (check-suite.mjs:639-685) assert paths/layout/matrix only — no heading-set gate, so a hygiene bullet and a docs reference are gate-safe.
- Repository root: /home/jamiemills/.config/opencode/skills (git). Live opencode config lives outside it (~/.config/opencode/opencode.jsonc, MCP-only today) — out of scope by user decision.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | DeepSeek auto prefix-caching is the cache mechanism in play; hits require full prefix-unit match; ~97% input discount on hits | User-dictated intent + research | api-docs.deepseek.com pricing + KV-cache guide (2026-08-20); measured 88-99% hit ratios in live DB | Accepted |
| A2 | The opencode DB (via `opencode db` CLI) is the authoritative usage source; logs are unusable | Planning decision | R3: logs pruned in minutes, zero-valued token markers only; DB verified queryable read-only | Accepted |
| A3 | No new skill may be added; guidance lives in AGENTS.md + .agents/docs/ | Planning decision | Every skill description is injected into every session's prefix (opencode skills docs, 2026-08-20); 9th skill regresses the 220-word budget | Accepted |
| A4 | Live opencode.jsonc is NOT edited; recommended config is documented in-repo only | User decision | User answer 2026-08-20: "Docs-only recommendations" | Accepted |
| A5 | Cost display uses the DB's stored cost column, never recomputation from a pricing table | Planning decision | Pricing bases conflict (models.dev vs DeepSeek docs, up to 2x); DB cost is authoritative per-message | Accepted |
| A6 | The prefix-sharing rule targets the identical-prefix pattern within a single build cycle's parallel DISPATCH; per-provider stagger notes are documented, not enforced | Planning decision | DeepSeek common-prefix persistence; Anthropic docs on parallel-first-request misses (2026-08-20) | Accepted |
| A7 | "Without quality loss" = never shrink context to the point of losing instructions: durable rules live in files (AGENTS.md/docs/plan), transcripts stay disposable; compaction guidance is recall-first | Research | Anthropic context-engineering (2025-09-29): over-aggressive compaction loses critical context; focused contexts beat bloated ones (Chroma 2025-07-14) | Accepted |
| A8 | Intra-batch cache-hit claim is an extrapolation: requests #2..N hit ~97% when the shared prefix is already warm or the first response lands before peers; a cold fully-parallel batch can race prefix persistence | Planning decision | R3 ratios are per-session aggregates, not intra-batch measurements; Anthropic parallel-request caveat (2026-08-20); T003 wording softened accordingly | Accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Do opencode logs carry per-step cache token data? | grep + regex over ~/.local/share/opencode/log/*.log (read-only) | Read-only; files observed deleted within minutes (retention ~15 min) | Only zero-valued session-creation markers; no per-step usage at INFO; logs per-process, pruned aggressively | Monitor must NOT parse logs; target DB (A2) |
| R2 | Is `opencode db "<SQL>"` a viable read-only query path? | Ran `opencode db` SELECTs against live DB | Read-only query; no writes | Works; `--format tsv` is present and the default; session table has tokens_input/tokens_output/tokens_reasoning/tokens_cache_read/tokens_cache_write/cost (verified PRAGMA) | T002 uses `opencode db` + execFileSync; SQL uses the exact tokens_cache_* column names |
| R3 | What are real cache-hit ratios? | SQL aggregates over 984 sessions (340 deepseek) | Read-only; only /tmp copies written (then discarded) | 88.4-99.1% for general sessions; 82.5% for a build session; cache.write always 0 for deepseek | Monitor formula = read/(read+input+write); guard zero denominators; report per-session and per-day |
| R4 | Are skill descriptions prefix-volatile? | Grep all 8 frontmatter descriptions for date/year/version/$ENV/path patterns | Read-only | All clean; only csm-browse `9222` (stable constant); total 220 words | T001 lint regex must exclude bare \d{4}; add word-budget check |
| R5 | Is AGENTS.md/docs the gate-safe guidance surface? | Inspect check-suite README checks + .agents/README.md convention | Read-only | README checks assert paths/layout/matrix only; no heading-set gate; .agents/docs/ is the dated-doc convention | T004: AGENTS.md + .agents/docs/ dated doc + README bullet |
| R6 | Does opencode.jsonc schema support budget knobs? | Fetch opencode config schema + docs (2026-08-20) | Read-only retrieval | model/small_model/agent.steps/provider models limit/compaction/instructions documented; no DeepSeek thinking knob documented | T004 documents recommended block (A4 docs-only); DeepSeek thinking knob recorded as deferred-unknown |

## Discovered Requirements

- Every gate edit must keep the check count at or above 516 and the lefthook pre-commit gates green (unstaged-guard, check-suite, mjs-syntax, oxlint --deny-warnings, csm-browse-check).
- Frontmatter descriptions: name matches dir; non-empty, <=1024 chars, Never-X clause (check-suite.mjs:402-405); word-count and volatility are NOT currently gated — T001 adds both without touching the existing checks.
- The bare `\d{4}` pattern MUST NOT be used in the volatility regex (fires on csm-browse's constant `9222`); the port number is stable and cache-safe.
- Synced boilerplate sections are regenerated by `sync --write` from scripts/lib/boilerplate.mjs (SYNC_SECTIONS: Tmux Session Bootstrap, Subagent Resilience); hand-editing them fails checkDrift. csm-build DISPATCH/Core Rules are hand-editable prose.
- `opencode db` queries must stay read-only; the DB is 886MB WAL-mode — never copy it, never open it with a second writer; query via the bundled CLI (schema drift surfaces as a query error, not silent NaNs).
- deepseek reports cache.write = 0 always; hit ratio = cache.read / (cache.read + input + cache.write); messages lacking cache.read (~6%) and 0/0 summary messages must be coalesced/skipped, not NaN.
- The check-suite corpus/journal checks (plan-validation.mjs, T006 of the previous plan) validate this plan's Control and journal rows: `Next transition` must be the exact prefix form "On a future explicit csm-build invocation, <A> -> <B>", Status in ready|in_progress|paused|blocked|complete, journal Next-state values within the machine enum; do not annotate Next transition with parentheticals.
- Commit style: short imperative messages, skill-prefixed where relevant; the plan file and docs are committed by csm-build at checkpoints.

## Design

**Lint (T001).** Add two additive checks to check-suite.mjs main loop right after the existing description checks (check-suite.mjs:402-405): (a) `VOLATILE_DESC_RE` = date/year/version/$ENV/absolute-path patterns (ISO date `\d{4}-\d{2}-\d{2}`, bare year `\b20\d{2}\b`, version `\b\d+\.\d+(\.\d+)?\b|v\d+(\.\d+)+`, env `\$[A-Z][A-Z0-9_]*`, abs paths `\/home\/|\/Users\/|\/tmp|\/etc\/|\/opt\/|\/usr\/|\/var\/`; NOT bare `\d{4}`) — rejects volatile content in descriptions that would silently invalidate prefix cache units; (b) a total-word-budget check summing the 8 descriptions, failing above 220 — protects AC1 of the completed efficiency plan. Both additive; negative fixtures in /tmp (2 violation->failure pairs: planted year + 221-word set). Gate changes are public-interface changes: independent review required (precedent: T006 of the efficiency plan).

**Monitor (T002).** `scripts/cache-health.mjs` — zero-dependency Node script: `execFileSync('opencode', ['db', sql, '--format', 'tsv'])` (or equivalent verified flag) against the live DB; queries deepseek-v4-flash sessions (model LIKE '%deepseek-v4-flash%' or providerID/modelID fields) with tokens_input/cache_read/cache_write/cost, plus time for per-day grouping; computes hit ratio read/(read+input+write) with zero-denominator guards; prints per-session and per-day report in the repo's plain check-suite style; `--days N` filter via time_created. Parsing/aggregation extracted as pure functions over the TSV text so hermetic unit tests use fixture strings (no DB in tests); a live smoke run on this machine records the real numbers as acceptance evidence. No writes anywhere; no DB copies.

**Prefix-sharing rule (T003).** csm-build DISPATCH gains a rule (hand-editable prose): when dispatching a parallel batch, all subagents receive a byte-identical static prefix (system prompt, tool definitions, skills, plan evidence) with only per-task payloads differing AFTER the stable region; DeepSeek's automatic prefix caching then serves requests #2..N at ~97% input cost (common-prefix units persist across requests); per-provider notes: providers with explicit breakpoints (Anthropic-style) may need the first request staggered or a shared breakpoint so parallel first requests hit. A sentence in Core Rules references the rule. Synced sections untouched.

**Guidance (T004).** Three artifacts, all gate-safe: (1) `AGENTS.md` at the repo root — concise (<100 lines) cache/token hygiene rules for future sessions in this repo: stable-prefix discipline (no dates/versions/env values in frontmatter — lint-enforced by T001), fresh-session resume over long transcripts (plan files are the durable record; transcripts are disposable), compaction recall-first when needed, never rewrite history mid-session (appends only — cache units need full prefix match), no new skills without re-budgeting the 220 words; (2) `.agents/docs/2026-08-20-cache-token-efficiency.md` — the full reference: provider mechanics (DeepSeek auto caching, ~97% hit discount, prefix-unit semantics, pricing basis caveat models.dev vs DeepSeek docs), measured ratios from this machine, the recommended docs-only opencode.jsonc block (compaction {auto,prune,reserved}, small_model, provider limit.output, agent steps, subagent_depth) with rationale, monitor usage (`node scripts/cache-health.mjs`), and the deferred DeepSeek thinking-knob note; (3) README.md `## Development & testing` bullet + index entry in .agents/README.md. No new skill (A3).

**Battery (T005).** Payload refresh via pack-bootstrap — sources changed (T003 edited csm-build/SKILL.md), so the digest EXPECTED to differ from the last recorded 912219dfa3, stable across two consecutive runs, with the delta attributed to `payload/skills/csm-build/SKILL.md`; gen-readme-matrix --check, full verification battery per AC5, plan Control/journal/Completion Review finalization, completion gate.

## Execution Graph

Dependencies:
- T001 (gate lint) — base, G1.
- T002 (cache-health monitor) — base, G1, disjoint files from T001 (new script + tests vs check-suite.mjs).
- T003 (prefix-sharing rule) — depends on nothing; disjoint from T001/T002 (csm-build/SKILL.md prose); G1 (no reason to sit behind the gate tasks — schedule in the G1 window).
- T004 (AGENTS.md + docs + README) — depends on T001 (doc references the lint as enforced) and T002 (doc references the monitor); G2.
- T005 (payload + battery + completion) — depends T001, T002, T003, T004; G3, strictly sequential.

Parallel groups:
- G1: T001 || T002 || T003 (disjoint: scripts/check-suite.mjs vs scripts/cache-health.mjs + tests/ vs csm-build/SKILL.md prose).
- G2: T004 alone (after T001 + T002; docs reference both).
- G3: T005 alone (after all; battery invokes everything).

Critical path: T001 -> T004 -> T005 (docs depend on the lint landing; battery after all).

Rule: no template-fence edits (no producer templates touched); no synced-section hand-edits; frontmatter wording unchanged (only new checks assert it). NOTE (F1): T003 edits csm-build/SKILL.md, which is mirrored into the payload — the payload is stale from T003 until T005 re-packs; T005's digest EXPECTS a change from 912219dfa3 with the delta attributed to payload/skills/csm-build/SKILL.md.

## Numbered Plan

1. [pending] check-suite: volatile-description and word-budget lint
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: high — the commit gate itself; requires independent review (gate changes are public-interface changes for every future commit)
   - Owned scope: scripts/check-suite.mjs (additive checks only)
   - Not in scope: any SKILL.md file (frontmatter is asserted, not edited); scripts/lib/plan-validation.mjs; contracts.mjs; other scripts; README (T004)
   - Spike candidate: none — hook point verified (check-suite.mjs:402-405); regex list validated against all 8 live descriptions (R4; bare \d{4} excluded)
   - Actions:
     1. Add `VOLATILE_DESC_RE` = /(\d{4}-\d{2}-\d{2}|\b20\d{2}\b|\b\d+\.\d+(\.\d+)?\b|v\d+(\.\d+)+|\$[A-Z][A-Z0-9_]*|\/home\/|\/Users\/|\/tmp|\/etc\/|\/opt\/|\/usr\/|\/var\/)/ near the other description regexes (do NOT include a bare \d{4} — csm-browse's stable `9222` must pass; verified the full list passes all 8 live descriptions).
     2. After the existing description checks (check-suite.mjs:402-405: empty, <=1024 chars, Never-X), add: `check(!VOLATILE_DESC_RE.test(desc), ...)` naming the skill and the offending token.
     3. Add a total word-budget check: sum `description` word counts across the 8 MANIFEST skills counting whitespace-separated tokens (em-dashes count as tokens — the exact AC1 method of the completed efficiency plan; 220 is the regression baseline, asserted as a fixture); `check(total <= 220, ...)` — protects AC1 against silent regression (the gate currently does not enforce it).
     4. Keep every existing check byte-identical; do not restructure; expected final count 525 (516 + 8 volatile + 1 budget).
     5. Negative-test evidence via a full-tree copy (mechanism: `rsync -a --exclude node_modules --exclude .git --exclude tests/fixtures-real <repo>/ /tmp/plan-negative/`, plant one violation in the copy: (a) a volatile token (e.g. "2026-08-20" or "$HOME") in one description, (b) a word added to reach 221 total; run `node scripts/check-suite.mjs --root /tmp/plan-negative` from the repo and record that each violation fails its check with the expected message; the pristine copy passes (control). No repo changes.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 with count 525 AND the /tmp negative-run transcript proves both violation->failure pairs (recorded).
   - Validation: `node --check scripts/check-suite.mjs`; `node scripts/gen-readme-matrix.mjs --check`; `node scripts/sync-skill-boilerplate.mjs --check`; all 8 live descriptions still pass (gate proves it); `git diff --stat` shows only scripts/check-suite.mjs.
   - Acceptance evidence: check-suite output with new count; negative-test transcript (2 pairs); diff stat.
   - Repair attempts: 0
   - Recovery note: if a live description fails the volatile check, the regex is too broad (e.g. version-like port numbers) — narrow it and re-run; if the word-budget check fails, the total drifted from 220 — re-verify counts (grill 26 / plan 28 / bdd-tdd 30 / build 28 / review 30 / scan 27 / browse 26 / upload 25) and fix the check, never the descriptions (frontmatter wording is out of scope). If check-suite regresses, revert scripts/check-suite.mjs to HEAD and re-apply in smaller increments, recording each increment's check result.

2. [pending] Zero-dependency cache-health monitor
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: new files scripts/cache-health.mjs, tests/cache-health.test.mjs, tests/fixtures/cache-health/ (TSV fixture strings)
   - Not in scope: any existing file; opencode DB writes; log parsing (logs are unusable — A2/R1); pricing tables (cost comes from the DB cost column, A5)
   - Spike candidate: none — `opencode db "<SQL>"` verified working read-only with `--format tsv` as present/default (R2); session table columns verified: tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost
   - Actions:
     1. Implement `scripts/cache-health.mjs` (no npm dependencies; node built-ins only; the ONLY subprocess is the bundled `opencode` CLI): run `opencode db "<SQL>"` (default tsv output; verify with `opencode db --help` first as a sanity step) via execFileSync; SQL selects deepseek-v4-flash sessions: id, slug, agent, time_created, tokens_input, tokens_cache_read, tokens_cache_write, cost — filter by model LIKE '%deepseek-v4-flash%' (verify the model column JSON shape from the live DB during implementation); optional `--days N` filter on time_created.
     2. Extract parsing + aggregation as PURE functions (e.g. parseSessionRows(tsvText) and aggregateReport(rows)) so tests run on fixture strings without a DB.
     3. Report (check-suite-style plain text): per-session table (session, agent, input, cache read, hit %, cost) and a per-day summary; hit % = cache.read / (cache.read + input + cache.write) with zero-denominator rows skipped or marked n/a; missing cache.read coalesced to 0.
     4. Hermetic tests: tests/cache-health.test.mjs imports the pure functions with fixture TSV (normal rows, zero-denominator row, missing-cache row, multi-session/day grouping); no DB, no network, no writes outside fixtures.
     5. Live smoke run on this machine: `node scripts/cache-health.mjs --days 30` records real per-session numbers as acceptance evidence (expected: general-agent sessions ~88-99% hit; record exact values).
   - Acceptance signal: `node --test tests/cache-health.test.mjs` exits 0 (all pass) AND `node scripts/cache-health.mjs --days 30` exits 0 and prints a per-session + per-day report with hit ratios (recorded) AND `node scripts/check-suite.mjs` still exits 0.
   - Validation: `node --check scripts/cache-health.mjs`; the live run makes no writes (git status clean of new files beyond the script/tests; opencode.db mtime unchanged — verify); no child_process beyond `opencode db`.
   - Acceptance evidence: test transcript with pass counts; live report output; DB-untouched verification.
   - Repair attempts: 0
   - Recovery note: if `opencode db` fails or the schema drifts, the query errors loudly (by design) — re-inspect `opencode db --help` and the session table columns read-only, pin the new shape, and update the SQL + fixtures; never fall back to log parsing. If the live DB is unavailable, record the failure and rely on the hermetic tests + a fixture-driven sample.

3. [pending] csm-build: parallel-dispatch prefix-sharing rule
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: csm-build/SKILL.md (Core Rules + DISPATCH section prose — hand-editable, NOT synced)
   - Not in scope: synced sections (Tmux Session Bootstrap, Subagent Resilience — T001 of the efficiency plan owns their canonical render); any other SKILL.md; scripts; check-suite (T001)
   - Spike candidate: none
   - Actions:
     1. In the DISPATCH section, add a rule (2-4 sentences): parallel dispatches in a batch share a byte-identical static prefix — system prompt, tool definitions, skills, and plan evidence must be identical across the batch, with only per-task payloads differing AFTER the stable region. DeepSeek's automatic prefix caching (api-docs.deepseek.com/guides/kv_cache) persists a detected common prefix across requests and serves subsequent matching requests at ~97% of the input price; measured per-session hit ratios in this repo are 88-99%. Note the extrapolation honestly: intra-batch requests hit at ~97% when the shared prefix is already warm or the first response lands before peers fire — do NOT vary the shared prefix per subagent (any change breaks the full-prefix-unit match).
     2. Add a per-provider note: providers using explicit cache breakpoints (e.g. Anthropic-style cache_control, 4 breakpoints max, 20-block lookback) benefit from staggering the first parallel request or a shared breakpoint so the batch's first response warms the cache before peers fire; DeepSeek handles this automatically but a fully-parallel batch of cold first requests can still race the prefix persistence — prefer warm prefixes (repeat sessions, stable tool sets) or accept the first request at miss price.
     3. Add one Core Rules sentence referencing the rule: "Never vary the shared static prefix across parallel dispatches in a batch — prefix stability is a cache and cost property."
     3. Add one Core Rules sentence referencing the rule: "Never vary the shared static prefix across parallel dispatches in a batch — prefix stability is a cache and cost property."
     4. Keep the state-machine chain, numbered headings, and synced sections untouched.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 AND the DISPATCH section contains the rule — `sed -n '/### 4. DISPATCH/,/### 5. INTEGRATE/p' csm-build/SKILL.md | grep -c "static prefix"` >= 1 AND Core Rules contains the sentence — `sed -n '/## Core Rules/,/## Repository Norms/p' csm-build/SKILL.md | grep -c "Never vary the shared static prefix"` >= 1 AND `node scripts/sync-skill-boilerplate.mjs --check` exits 0 (synced sections untouched).
   - Validation: diff of csm-build/SKILL.md limited to Core Rules + DISPATCH prose; `grep -n "DeepSeek\|cache" csm-build/SKILL.md` shows the rationale; chain/headings byte-identical (git diff check).
   - Acceptance evidence: grep results; check-suite output; diff stat.
   - Repair attempts: 0
   - Recovery note: if sync --check fails, a synced section was touched — restore it via `node scripts/sync-skill-boilerplate.mjs --write` and re-apply the prose edits outside the synced blocks; if the gate flags chain/headings, restore the exact original state-machine section.

4. [pending] Cache/token hygiene guidance: AGENTS.md, dated reference doc, README bullet
   - Task ID: T004
   - Depends on: T001, T002
   - Parallel group: G2
   - Risk: standard
   - Owned scope: new AGENTS.md (repo root), new .agents/docs/2026-08-20-cache-token-efficiency.md, README.md (`## Development & testing` bullet), .agents/README.md index line
   - Not in scope: any SKILL.md; live opencode.jsonc (docs-only per user decision A4); check-suite (T001); monitor internals (T002 — reference only)
   - Spike candidate: none
   - Actions:
     1. AGENTS.md (repo root, concise <100 lines): repo-level rules for future agent sessions — stable-prefix discipline (frontmatter volatility is lint-enforced by T001; never add dates/versions/$ENV/paths to descriptions; the 220-word budget is gate-enforced), fresh-session resume over long transcripts (plan files are the durable record; chat history is never the only record), compaction recall-first when context approaches limits, append-only history (never rewrite earlier turns — cache prefix units require full match), no new skills without re-budgeting the 220 words, monitor usage pointer.
     2. .agents/docs/cache-token-efficiency-2026-08-20.md (dated reference per the docs convention — date SUFFIX, matching existing entries like csm-suite-performance-baseline-2026-08-15.md): DeepSeek caching mechanics + pricing basis caveat (DeepSeek docs $0.007/$0.22/$0.66 vs models.dev $0.0028/$0.14/$0.28 — cost shown by opencode stats uses models.dev; the monitor uses DB cost), measured hit ratios from this machine, the recommended (docs-only) opencode.jsonc block with rationale — `compaction: {auto: true, prune: true, reserved: 10000}`, `small_model` (title generation currently uses the main model — documented lever), `provider.deepseek.models["deepseek-v4-flash"].limit.output` (documented key) and `agent.<name>.steps`; the deferred note that a DeepSeek thinking/effort knob is undocumented in opencode (passthrough plausible, unverified — needs a live experiment before enabling); monitor usage (`node scripts/cache-health.mjs [--days N]`).
     3. README.md: add one bullet under `## Development & testing` (or a short `## Cache & token hygiene` section — README has no heading-set gate) referencing AGENTS.md + the dated doc + the monitor + the lint; keep the matrix region untouched (regenerate only via gen-readme-matrix).
     4. .agents/README.md: index the new dated doc per the existing convention — one line of the shape `` `<file>` — <date> — <goal> — status: reference `` (match the existing bullets exactly).
     5. Verify no new skill directory appears and the frontmatter total stays exactly 220.
   - Acceptance signal: `node scripts/check-suite.mjs` exits 0 AND `node scripts/gen-readme-matrix.mjs --check` exits 0 AND AGENTS.md exists (<100 lines, grep -c) AND `.agents/docs/2026-08-20-cache-token-efficiency.md` exists AND the doc is referenced in .agents/README.md AND README references the doc AND `git status` shows no new skill dir AND frontmatter total = 220 (word-count command).
   - Validation: `wc -l AGENTS.md` <= 100; README matrix region unchanged (diff); sync --check clean; docs reference T001 lint, T002 monitor, T003 rule (grep).
   - Acceptance evidence: check-suite + matrix output; file listings; word-count total; grep results.
   - Repair attempts: 0
   - Recovery note: if gen-readme-matrix --check fails after the README edit, the matrix region was touched — restore it (`node scripts/gen-readme-matrix.mjs --write` regenerates the canonical region) and re-apply the bullet outside the markers; if check-suite's README checks fail, re-check that referenced paths exist.

5. [pending] Regenerate payload and run the full verification battery
   - Task ID: T005
   - Depends on: T001, T002, T003, T004
   - Parallel group: G3 (strictly sequential after T004 — the battery invokes the new tests)
   - Risk: standard
   - Owned scope: bootstrap payload + payload-index.json (via pack-bootstrap), this plan document (Control, journal, Completion Review), final evidence recording
   - Not in scope: any source behavior change; README matrix regeneration (should be unchanged — T004 kept the region intact)
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs` twice; record the deterministic digest (EXPECTED to differ from the previous 912219dfa3 — T003 edited csm-build/SKILL.md, which the packer mirrors; the two runs must agree and the payload diff must be limited to `payload/skills/csm-build/SKILL.md`; if anything else differs, stop and investigate).
     2. Run `node scripts/gen-readme-matrix.mjs --check` (no --write expected).
     3. Run the full battery and record results: check-suite (>= 518); `node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs tests/resume-semantics.test.mjs tests/cache-health.test.mjs`; csm-scan serial `node --test --test-concurrency=1` (# fail 0, baseline >= 1200); csm-browse `node scripts/check-skill.mjs`; payload byte-match `diff -r` all 8 skills.
     4. Update this plan's Control, Discovered Requirements, and Progress Journal with results; record pass counts and wall times.
   - Acceptance signal: `node scripts/pack-bootstrap.mjs` prints a deterministic digest AND `node scripts/check-suite.mjs` exits 0 AND `node --test tests/protocol/integrity.test.mjs` exits 0 AND the csm-scan suite reports `# fail 0` AND csm-browse check-skill exits 0.
   - Validation: `git diff --stat` limited to payload files (if any), docs, AGENTS.md, README, and the plan document; all 8 payload SKILL.md byte-match their repo counterparts (`diff -r`).
   - Acceptance evidence: recorded digest, test transcripts, diff stat, byte-match confirmation.
   - Repair attempts: 0
   - Recovery note: if pack-bootstrap or integrity fails, the payload index is stale — re-run pack-bootstrap; if the csm-scan suite fails, a prior task regressed it — cite the failing test before touching source.

## Verification Strategy

Ordered cheapest-first:
- Fast per-task gates (run in each task): `node scripts/check-suite.mjs` (repo-wide, ~seconds), `node scripts/sync-skill-boilerplate.mjs --check` (T003), `node scripts/gen-readme-matrix.mjs --check` (T004), `node --check` on edited .mjs, grep-based content assertions per task.
- Mid-tier (T001, T002): negative-fixture transcripts; `node --test tests/cache-health.test.mjs`; independent review for T001.
- Expensive final batch (T005, serial, after all tasks): full bootstrap suites, csm-scan authoritative suite (~132s, serial-only per repo norm), csm-browse `check-skill.mjs`, pack-bootstrap digest, payload byte-match. These are the only checks needing the full tree — run them once at T005.
- Parallelism: per-task gates can run during G1/G2 in parallel; the T005 battery is sequential by design.
- Environment sensitivity: csm-scan suite must run serial (`--test-concurrency=1`) — parallel mode races filesystem-heavy fixtures (known repo norm). csm-browse e2e (Docker) is NOT part of acceptance; check-skill.mjs is the fast substitute. The monitor's live DB run is machine-specific — hermetic tests carry the load; the live run is evidence, not a gate.

## Risks And Recovery

- Gate regression (high, T001): negative fixtures, additive-only checks, independent review mandate; rollback = revert scripts/check-suite.mjs to HEAD.
- Monitor breaks on opencode schema drift (medium, T002): by design the query errors loudly; recovery = re-inspect schema read-only and pin the new shape; fixtures updated with the new shape. Never fall back to log parsing (logs pruned in minutes).
- Docs/AGENTS.md bloat regresses the per-session prefix (medium, T004): AGENTS.md capped at <100 lines; the dated doc holds the depth; guidance text keeps the "smallest high-signal set" rule from the research.
- Frontmatter drift breaks the new budget check (low): the check names the skill and total; descriptions are out of scope for every task — fix the check or re-verify counts, never edit descriptions.
- Prefix-sharing rule conflicts with per-task necessity (low, T003): the rule mandates identical prefixes only for the shared static region; per-task payloads still differ after it — no conflict with narrow task prompts (research: agentic token reduction favors bounded subagent prompts).
- README matrix drift (low, T004): only gen-readme-matrix --write touches the region; edits stay outside the markers.
- Deferred (recorded, not blockers): DeepSeek thinking/effort knob in opencode is undocumented (passthrough plausible, unverified — needs a live experiment before enabling); live opencode.jsonc changes out of scope by user decision; log-based per-step monitoring impossible in opencode v1.15.12.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1: T005 expects digest 912219dfa3 "unchanged" though T003 edits csm-build/SKILL.md (mirrored into payload) | High | T005 action 1 + Design + AC5 now expect a NEW deterministic digest stable across two runs, delta attributed to payload/skills/csm-build/SKILL.md; stale-mirror window from T003 to T005 recorded in Execution Graph | pack-bootstrap.mjs:18,21 mirrors all 8 skills incl. csm-build |
| F2: negative fixtures invisible to the gate (check-suite reads root skill dirs; /tmp fixture not runnable) | High | Mechanism pinned: full-tree rsync copy to /tmp/plan-negative (exclude node_modules/.git), plant violations in the copy, run `check-suite --root <copy>`; pristine-copy control | check-suite.mjs:342-364 discoverSkillDirs; --root flag at :27 |
| F3: word-count method unpinned; whitespace-split (220) vs word-class regex (225) disagree | Medium | Method pinned verbatim: whitespace-separated tokens, em-dashes count (efficiency-plan AC1 method); 220 asserted as regression baseline | verified counts 26/28/30/28/30/27/26/25 |
| F4: R&D R2/evidence column names ambiguous vs actual schema | Medium | Corrected to tokens_cache_read/tokens_cache_write (PRAGMA-verified); `--format tsv` confirmed present/default, removing the last spike gap | PRAGMA table_info(session); opencode db --help |
| F5: "#2..N at ~97%" intra-batch claim is an extrapolation | Medium | T003 wording softened: warm-prefix condition + DeepSeek cold-race note; A8 records the extrapolation | R3 ratios are per-session, not intra-batch |
| F6: `grep -n "prefix" >= 3` trivially satisfied, location-blind | Low | Acceptance scoped: sed-bounded DISPATCH section grep for "static prefix" + Core Rules grep for the exact sentence | T003 acceptance signal |
| F7: T003 forced behind G1 with zero dependencies | Low | T003 moved to G1 (T001\|\|T002\|\|T003), shortening the critical path | Execution Graph |
| F8: "zero-dependency" overclaims (subprocess = opencode CLI) | Low | Standardized: "no npm dependencies; only subprocess is the bundled opencode CLI" | T002 scope + AC2 |
| F9: dated-doc filename convention mismatch (date prefix vs suffix) | Low | Renamed to .agents/docs/cache-token-efficiency-2026-08-20.md (date suffix, matching csm-suite-performance-baseline-2026-08-15.md); index line shape pinned | .agents/README.md convention |
| F10: check-count framing understates delta (516+8+1=525) | Nit | AC1/T001 state expected 525 (criterion >= 518) | arithmetic |
| F11: AC2 "ratios consistent with sample" subjective | Nit | AC2 reworded: 80-100% band, exact values recorded, no magnitude gate | AC2 text |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE | — | Brief = "turn the cache/token research into a csm-plan". Ask classified medium-large, research-backed; user decision (docs-only config) captured as A4. Goal decoded: operationalize cache maximization + token reduction in this repo without quality loss, gate green, 220-word budget protected | DISCOVER |
| 2026-08-20 | 0 | DISCOVER | — | Inspected: opencode.jsonc (MCP-only), storage layout (opencode.db + per-process logs), no AGENTS.md, no cache refs in scripts/, node v20 without sqlite tooling; draft sidecar created | RESEARCH |
| 2026-08-20 | 0 | RESEARCH | — | 4 parallel tracks (scout + 3): (R1) logs carry NO per-step tokens and are pruned within minutes — initial DISCOVER log claim DISPROVED, monitor must target the DB; (R2) `opencode db "<SQL>"` verified read-only; session table has tokens/cache/cost columns; (R3) live hit ratios 88.4-99.1% (general) / 82.5% (build); (R4) all 8 descriptions volatility-clean, 220 words exact; opencode config schema supports compaction/small_model/limit.output/steps (R6); new-skill per-session token tax confirmed (U4) — guidance must not be a 9th skill. Scout flagged pricing basis conflict (models.dev vs DeepSeek docs) — resolved: DB cost column (A5) | DRAFT |
| 2026-08-20 | 0 | DRAFT | — | 5 tasks drafted: T001 gate lint (volatile + word budget), T002 cache-health monitor, T003 prefix-sharing rule, T004 guidance (AGENTS.md + dated doc + README, docs-only config), T005 battery. Groups G1 (T001\|\|T002\|\|T003), G2 (T004), G3 (T005). User decision A4 docs-only | CRITIQUE |
| 2026-08-20 | 0 | CRITIQUE | — | Independent hostile review: 11 findings (2 high, 3 medium, 5 low, 1 nit) — F1 digest expectation wrong (T003 edits mirrored csm-build/SKILL.md), F2 negative-fixture mechanism unrunnable (gate reads root dirs; --root copy mechanism pinned), F3 word-count tokenizer unpinned (whitespace-split pinned, 220 baseline), F4 column names corrected (tokens_cache_*), F5 intra-batch ~97% softened (A8), F6 grep scoped, F7 T003→G1, F8 zero-dep reworded, F9 docs filename convention aligned, F10 count 525, F11 AC2 band reworded | REMEDIATE |
| 2026-08-20 | 0 | REMEDIATE | — | All 11 findings resolved in the draft: T001 mechanism + tokenizer + count, T002 SQL names + wording, T003 scoped acceptance + softened claim, T004 filename + index shape, Execution Graph G1/G2/G3, AC1/AC2/AC5 updated, A8 added, Critique Resolution table filled | VERIFY |

## Completion Review

(filled by csm-build when all criteria are verified)
