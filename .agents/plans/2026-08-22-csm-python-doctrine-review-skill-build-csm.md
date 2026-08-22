format: csm-plan/1

# csm-python-doctrine-review Skill Build CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 9 tasks — 1 high (T006 public-contract edits to csm-review), 5 standard, 3 low. T006 always requires independent review before commit.

## Control

- Plan ID: csm-python-doctrine-review-skill-build
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: planning SAVED 2026-08-22
- Last model/run: opencode stealth/ox-alpha 2026-08-22 (planning session)
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Build one new first-class opencode skill, `csm-python-doctrine-review`: a Python-only repository analyser, invocable standalone AND dispatched by csm-review, that analyses a target repo against the PEP 20 doctrine playbook and the 140-rule idiomatic-Python artifact and writes EXACTLY ONE findings-and-recommendations file under the target repo's `.agents/`. Hard constraints (user-dictated): the skill never touches anything else in the target repo; it may install tools ONLY after explicit user OK and never inside the target repo (isolated runners, version-pinned); the output is human-readable top-half and agent-actionable fix-guide bottom-half. Deliverables: SKILL.md + bundled rules JSON artifact + full corpus registration + csm-review dispatch enablement + green gates + fixture dry-run evidence.

## Acceptance Criteria

1. `node scripts/check-suite.mjs` exit 0 with the new skill registered (11 skills), zero new-skill failures, payload drift zero including the bundled JSON.
2. `csm-make-tests`-grade structural gates pass for SKILL.md: frontmatter name/description (≤1024 chars, volatile-free, Never-clause satisfied), exactly-one H1, canonical H2 set present, machine chain valid, <500 lines.
3. Fixture dry-run on a synthetic Python repo in /tmp proves: exactly one file written under fixture `.agents/`; report contains tool versions/pins, severity-tagged findings (C/R/W/E/F + Nit), and a fix-guide section; `git status` of the fixture shows no other changes.
4. csm-review can dispatch the analyser: NEVER_INVOKE asymmetric cell set, csm-review Interface/journal wording updated consistently, check-suite Interface validation passes across all skills.
5. Consent-gating provable from SKILL.md text: default = no install; install only after explicit OK; declined-install degradation path documented (static-only analysis).

## Current-State Evidence

- Registration surface: scripts/lib/contracts.mjs:43-59 (MANIFEST entry shape, csm-make-tests template); :252-258 (INTERFACES row arrays); :268-275 (FORMAT_VERSIONS kinds all version 1); :288-403 (NEVER_INVOKE 10-row matrix).
- Matrix asymmetry legal by design (D22 comment contracts.mjs:277-287; grill/plan rows carry deep-research:false :331,:343; deep-research row carries browse:false :381). Bullet derivation: check-suite.mjs:811-831 — `- Never invokes:` must list exactly the row's `true` cells.
- ARTIFACT_PATTERNS live in scripts/lib/plan-validation.mjs:98-111; semantics :414-425 — every regex must `.test()` the Interface section prose; placeholders `<yyyy-mm-dd>` kept literal, dots/slashes escaped (e.g. :105-108).
- Packaging: scripts/pack-bootstrap.mjs:30-41 skillDirs (10 entries); supportingFiles :48-65 with directory-bundle precedent `{srcDir: join("csm-make-tests","references"), destDir: join("payload","skills","csm-make-tests","references")}` :62-64; index → bootstrap/payload-index.json (:142). scripts/lib/boilerplate.mjs:73 has a per-skill entry feeding sync drift checks (reached via scripts/sync-skill-boilerplate.mjs:12; check-suite.mjs:21-22 imports the checkDrift wrappers; gen-readme-matrix likewise).
- Gate constants: NEVER_CLAUSE_RE check-suite.mjs:46-47 (enforced :759-762, ungated); <500 lines :743; exactly-one-H1 :773-774; MANIFEST exact-H2 :787-792; CHAIN_RE :61 + verifyMachine :334-418; tmux/norms coupling :841-859; word-budget/volatile checks gated OFF today (.agents/token-efficiency.json `{"enabled":false}`; token-efficiency.mjs:9).
- csm-review contract today: description :3 "Never fixes code, never invokes other skills."; Hands off :69; Never-invokes bullet :70; terminal rule :191 "Then stop. Never invoke another skill"; INTERFACES :204-210.
- Inputs: `.agents/research/artifacts/2026-08-22-python-idiomatic-reviewer-rules.json` (format python-idiomatic-reviewer-rules/1; tiers: correctness, bugbear-gotchas, judgment-gotchas, idiom, modernization, style-docstring, testing, complexity-design; 140 rules with id/name/tier/detects/detection/fix/severity_suggestion/citation_url). Doctrine finding: `.agents/research/2026-08-22-pep20-idiomatic-python-consolidated-research.md` (renamed by concurrent consolidation — cite THIS path, not older names).
- Isolated runners (official docs retrieved 2026-08-22): `uvx ruff@<ver> check --no-cache .` (or RUFF_CACHE_DIR to /tmp) — docs.astral.sh/ruff/settings/#cache-dir; mypy `--cache-dir /tmp/...` (docs.astral.sh + mypy docs; uv warns `uv tool run` cannot see project venv deps for mypy — expect import noise, disclose in report); pyright via community PyPI wrapper (`uvx pyright@<ver>`), npm -g is Microsoft-canonical alternative; pipx fallback `pipx run --spec ruff==<ver> ruff ...`.
- AGENTS.md: budget checks gated off today; "no new skills without re-budgeting" applies on enablement — new description must be volatile-free and short so future enablement needs only re-budgeting.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| -- | --------- | ---- | --------------------- | ------ |
| A1 | Skill name `csm-python-doctrine-review` | user-dictated | Brief says "single csm skill focussed solely on python"; csm- prefix required by discoverSkillDirs regex | accepted |
| A2 | Exactly one output file per run under target `.agents/` | user-dictated | "output a single file in the .agents directory … never touch anything in the repo other then that one file" | accepted |
| A3 | Install tools only after explicit OK, never in target repo | user-dictated | Brief sentence 6 | accepted |
| A4 | Invocable standalone and by csm-review | user-dictated | Brief sentence 3 | accepted |
| A5 | Report path `.agents/doctrine/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review.md` | decision | Own subdir avoids collision with csm-review's allowlisted `.agents/reviews/`; matches sibling dated-name convention; single file satisfies A2 | accepted |
| A6 | Rules JSON bundled in-skill at `csm-python-doctrine-review/artifact/python-idiomatic-reviewer-rules.json` | decision | Approach decision "embed as artifact beside SKILL.md"; directory form matches supportingFiles bundle precedent | accepted |
| A7 | Runner ladder: probe uvx (pinned) → offer isolated install if absent (consent) → pipx fallback → degrade to static-only analysis | decision | Q1/Q3 evidence; graceful degradation keeps zero-write guarantee | accepted |
| A8 | csm-review gains ability to DISPATCH the analyser (one-way); analyser remains terminal | user-dictated + evidence | A4; matrix asymmetry mechanism proven at contracts.mjs:331/:343/:381 | accepted |
| A9 | Token-efficiency stays OFF during build; descriptions written volatile-free | decision | Budget gated off (.agents/token-efficiency.json); AGENTS.md requires re-budget before any enablement | accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| -- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |
| R1 | Exact registration mechanics incl. asymmetric matrix? | Read contracts.mjs/check-suite.mjs/plan-validation.mjs (read-only) | No writes; read-only inspection | Asymmetry precedented; bullets derive from true-cells filter (check-suite.mjs:823-825); ARTIFACT_PATTERNS one-way prose test | T002/T006 actions pinned to exact anchors |
| R2 | How are non-SKILL.md files bundled? | Read pack-bootstrap.mjs supportingFiles | read-only | Directory srcDir→destDir mapping precedent :62-64; index regenerated | T004 adds artifact-dir mapping + repack |
| R3 | Which runner commands keep target repo clean? | Official docs webfetch (retrieved 2026-08-22) | Network read-only retrieval only | Pins + cache redirection flags confirmed; mypy noise caveat from uv docs | T007 PROVISION state content |
| R4 | House consent phrasing? | Grep SKILL.md files | read-only | "only after explicit approval" patterns in csm-make-tests/csm-review | T007 consent language copied from house style |

## Discovered Requirements

- DR1: The consolidated research file lives at `.agents/research/2026-08-22-pep20-idiomatic-python-consolidated-research.md` (concurrent session renamed it) — all citations must use this path.
- DR2: `- Never invokes:` bullets across ALL skills must be regenerated whenever the matrix gains a column (check-suite validates bullet == true-cells exactly).
- DR3: csm-review's description :3 currently asserts "never invokes other skills" — enabling dispatch breaks this claim; description must be reworded while keeping a valid Never-clause (gate NEVER_CLAUSE_RE ungated).
- DR4: the review→analyzer matrix cell and ALL csm-review prose (:3,:24,:69,:70,:191) must land in ONE commit (T007 owns both); the cell's final value is false permanently (false = dispatch allowed).
- DR5: New skill needs a scripts/lib/boilerplate.mjs entry (:73) and README matrix regen, else drift checks fail.
- DR6: ARTIFACT_PATTERNS placeholders stay literal (`<yyyy-mm-dd>`) — do not regex-escape angle brackets.
- DR7: Concurrent-session churn is high in this repo — stage only files owned by this plan at each checkpoint; hooks bypass (--no-verify) is the user's standing instruction.

## Design

Skill anatomy (registered manifest): frontmatter name `csm-python-doctrine-review`; description imperative + Never-clause, volatile-free; H1 `# CSM Python Doctrine Review`; canonical H2 set: Interface; Tmux Session Bootstrap; Activation Boundary; Core Rules; Write Discipline And File Allowlist; Repository Norms (NORMS.md); Analysis State Machine; Required Report Package; Anti-Patterns; Done Criteria. Manifest: tmux true, norms true, machine {section:"Analysis State Machine", entryExit:true} (Entry:/Exit: lines give reviewers crisp state boundaries).

State machine: `INTAKE -> PROVISION -> SCAN -> ANALYZE -> JUDGE -> REPORT -> STOP`.
- INTAKE: resolve target repo at pinned commit; scope optional; record run id.
- PROVISION: detect uvx/pipx; NO installation by default — offer exact pinned commands, proceed only after explicit user OK, record consent + versions in report header; on decline or absence → static-only mode (doctrine checklist + judgment heuristics, disclosed).
- SCAN: mechanical tier — `uvx ruff@<pin> check --no-cache` (rule families mapped from artifact tiers), pyright/mypy with caches redirected outside the repo (`--cache-dir /tmp/...` or `/dev/null`); capture commands + exit codes.
- ANALYZE: architecture dimension — PEP 20 playbook checklist (packaging/pyproject-only, src layout, lock discipline, boundary-only validation, protocols-as-seams, EAFP, sync-first, test pyramid) applied to observed repo structure.
- JUDGE: judgment-tier review prompts for non-lintable classes (mutable class attributes, complexity interpretation, docstring semantics, test validity, concurrency) using artifact tier judgment-gotchas; severity mapping pylint C<R<W<E<F + Google Nit; every finding cites artifact rule id or doctrine playbook step + why-it-matters + recommendation.
- REPORT: emit the single file `.agents/doctrine/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review.md` — header (run id, commit pin, tools+pins+consent record), findings table, then agent-actionable fix guide (ordered checklist, machine-parseable checkboxes); NOTHING ELSE written anywhere in the target repo; scratch in /tmp only.

Boundaries: invoked standalone by explicit request, or dispatched by csm-review (one-way matrix cell); analyser itself invokes nothing. Bundled inputs: artifact/python-idiomatic-reviewer-rules.json (copy of corpus artifact, provenance noted).

## Execution Graph

```text
T001 (MANIFEST+INTERFACES+FORMAT_VERSIONS, appended at object end)
  ├─> T002 (new NEVER_INVOKE row; ARTIFACT_PATTERNS)
  ├─> T003 (skillDirs + rules.json bundle + supportingFiles + repack)
  └─> T004 depends on T002: skeleton + boilerplate entry + sync --write
T002 --> T004 --> T005 (body authoring) --> T007 (review-row cell + csm-review prose, one commit) --> T008 (sibling rows+bullets, README manual edits, final repack)
T006 (fixture prep, independent) --> T009 (dry-run + final gates)
T008,T009 converge at CHECKPOINT
```

Critical path: T001 → T004 → T005 → T008 → T009. Parallel group G2 {T002,T003} post-T001; T006 independent anytime.

## Numbered Plan

1. [pending] Register skill identity in contracts
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: scripts/lib/contracts.mjs (MANIFEST entry after csm-upload block, INTERFACES entry, FORMAT_VERSIONS `"csm-python-doctrine-review": 1`)
   - Not in scope: NEVER_INVOKE matrix (T002); plan-validation.mjs; any SKILL.md
   - Spike candidate: none
   - Actions: append MANIFEST entry at object end (avoids mid-object churn) with canonical sections ["Interface","Tmux Session Bootstrap","Activation Boundary","Core Rules","Write Discipline And File Allowlist","Repository Norms (NORMS.md)","Analysis State Machine","Required Report Package","Anti-Patterns","Done Criteria"], tmux:true, norms:true, machine:{section:"Analysis State Machine",entryExit:true}; add INTERFACES entry (consumes "target python repository at pinned commit (+ optional change-surface)", produces "single doctrine report at .agents/doctrine/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review.md", handoff "terminal; findings may feed human-directed fixes", midPipeline []). FORMAT_VERSIONS entry is forward-looking (inert for gates today — kinds consumed only by the four hardcoded corpus loops, check-suite.mjs:1082-1256) — keep for consistency.
   - Acceptance signal: `node -e "import('./scripts/lib/contracts.mjs').then(m=>{...})"` assert MANIFEST/INTERFACES/FORMAT_VERSIONS contain the key (script provided in task notes); alternatively grep count increments verified in journal.
   - Validation: `node scripts/check-suite.mjs 2>&1 | tail -3` — no NEW failures attributable to this key beyond unregistered-dir expectations until T002 lands (batch order note: T001+T002 land in same cycle).
   - Acceptance evidence: anchor line numbers + assertion output recorded.
   - Repair attempts: 0
   - Recovery note: single-file additive edit; git checkout recovers.

2. [pending] Wire matrix, artifact patterns, boilerplate
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard
   - Owned scope: scripts/lib/contracts.mjs (NEVER_INVOKE rows), scripts/lib/plan-validation.mjs (ARTIFACT_PATTERNS), scripts/lib/boilerplate.mjs (per-skill entry)
   - Not in scope: sibling SKILL.md bullets (regenerated at T008); csm-review behavioral edits (T007)
   - Spike candidate: none
   - Actions: add the eleventh row `"csm-python-doctrine-review"` (self false, all ten others true) — do NOT touch existing rows here (sibling true-cells land at T008 in the same commit as their bullet regen; the review→analyzer false cell lands at T007 with its prose, per DR4); extend the D22 asymmetry comment documenting the planned third asymmetry; add ARTIFACT_PATTERNS `"csm-python-doctrine-review": [/\.agents\/doctrine\/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review\.md/]` (placeholders literal, per DR6). Maintain a KNOWN-FAILURE LEDGER in the journal from here until T008: expected reds = ten sibling bullet mismatches + dead-key MANIFEST (until T004) + boilerplate/README drift; never re-record baselines mid-build.
   - Acceptance signal: node assert — all 11 rows keyed over the 11-name set, all diagonals false, exactly one asymmetric cell involving the new column (none yet; review→analyzer false arrives at T007; corpus already carries three: grill→deep-research, plan→deep-research, deep-research→browse); ARTIFACT_PATTERNS regex source matches plan-validation.mjs conventions.
   - Validation: check-suite failures match the known-failure ledger exactly (no unattributed new failures).
   - Acceptance evidence: assert output recorded.
   - Repair attempts: 0
   - Recovery note: three single-owner file edits; revert per file.

3. [pending] Bundle rules artifact into skill dir
   - Task ID: T003
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: csm-python-doctrine-review/artifact/python-idiomatic-reviewer-rules.json (new copy), scripts/pack-bootstrap.mjs (skillDirs entry :30-41 + supportingFiles entry), bootstrap/package/payload/** (regen), bootstrap/payload-index.json
   - Not in scope: SKILL.md
   - Spike candidate: none
   - Actions: mkdir csm-python-doctrine-review/artifact; copy corpus artifact byte-identical; add `"csm-python-doctrine-review"` to skillDirs (:30-41 — without it the skill is silently never packed: F-008 reverse walk iterates only mapped sources, check-suite.mjs:612-624) AND supportingFiles mapping `{srcDir: join("csm-python-doctrine-review","artifact"), destDir: join("payload","skills","csm-python-doctrine-review","artifact")}` following :62-64 precedent; GUARD: record `git status bootstrap/` before packing and refuse if unmapped paths appear (syncPayload prune :163-169 is destructive); run `node scripts/pack-bootstrap.mjs`.
   - Acceptance signal: `cmp` corpus vs bundled copy exit 0 AND payload-index.json contains the artifact entry AND `test -f bootstrap/package/payload/skills/csm-python-doctrine-review/artifact/python-idiomatic-reviewer-rules.json`.
   - Validation: `git status bootstrap/` shows only expected regen paths.
   - Acceptance evidence: cmp + index grep recorded.
   - Repair attempts: 0
   - Recovery note: idempotent regen; rerun after any change.

4. [pending] Scaffold SKILL.md skeleton
   - Task ID: T004
   - Depends on: T002
   - Parallel group: G3
   - Risk: standard
   - Owned scope: csm-python-doctrine-review/SKILL.md skeleton (frontmatter, H1, Interface with literal Produces path, canonical H2 shells incl. real Tmux Session Bootstrap + NORMS phrase outside fences, machine chain + `### N.` headings with Entry:/Exit:) AND scripts/lib/boilerplate.mjs per-skill entry (:73 — moved here from T002 because TMUX_PARAMS drift fires as soon as the entry exists; drift compare is byte-exact, sync-skill-boilerplate.mjs:65-74)
   - Not in scope: body prose depth (T005)
   - Spike candidate: none
   - Actions: write frontmatter (description ≤1024 chars, imperative, Never-clause per NEVER_CLAUSE_RE, volatile-free); H1 `# CSM Python Doctrine Review`; Interface 4 bullets — Produces MUST contain literal `.agents/doctrine/<yyyy-mm-dd>-<repo-slug>-python-doctrine-review.md`; Never-invokes lists all ten siblings (true cells); author REAL section shells (empty stubs make sync --write throw, F-069-1) with NORMS detection phrase outside fences; chain line `INTAKE -> PROVISION -> SCAN -> ANALYZE -> JUDGE -> REPORT -> STOP` as the FIRST backticked chain in the machine section (extractChain takes the first, check-suite.mjs:325-332) + `### N.` headings with Entry:/Exit:; then `node scripts/sync-skill-boilerplate.mjs --write`.
   - Acceptance signal: checkDrift clean for csm-python-doctrine-review (boilerplate byte-sync) AND check-suite reports zero structural failures for the skill.
   - Validation: wc -l < 500; description char count ≤1024.
   - Acceptance evidence: gate excerpt + line count recorded.
   - Repair attempts: 0
   - Recovery note: body edits only after skeleton passes.

5. [pending] Author analysis body
   - Task ID: T005
   - Depends on: T004
   - Parallel group: G4
   - Risk: standard
   - Owned scope: csm-python-doctrine-review/SKILL.md body sections
   - Not in scope: references/ (none planned), other files
   - Spike candidate: none
   - Actions: author per Design — Activation Boundary (standalone or dispatched by csm-review; analyses only; terminal at REPORT); Core Rules (single-file write rule verbatim-strong: "the ONLY write in the target repo is the report file"; never modify target code/deps/config; never run mutating git; never auto-install without explicit OK; scrub secrets; disclose mypy env-noise; cite artifact rule ids + doctrine playbook steps); Write Discipline (allowlist WITHIN THE TARGET REPO = exactly `.agents/doctrine/<date>-<slug>-python-doctrine-review.md`; scratch under /tmp; consented runner caches live OUTSIDE any repo and their locations are declared — UV_CACHE_DIR/PIPX_HOME/XDG_CACHE_HOME redirected to /tmp; baseline-diff verification step); Repository Norms detection phrase; PROVISION consent ladder (probe uvx → OFFER pinned commands → on explicit OK install/run isolated → pipx fallback → decline ⇒ static-only mode, recorded); SCAN commands with cache redirection; ANALYZE doctrine checklist (playbook steps cited to consolidated research path DR1); JUDGE severity mapping + judgment-gotchas prompts; Required Report Package (exact single-file shape: header/run-record, findings table, agent fix-guide with checkboxes); Anti-Patterns; Done Criteria. Run pack-bootstrap after.
   - Acceptance signal: pack + check-suite show zero csm-python-doctrine-review failures; wc -l < 480 (headroom under 500).
   - Validation: manual trace — every state has inputs/actions/outputs; consent + single-file rules quoted verbatim in text.
   - Acceptance evidence: gate output + line count recorded.
   - Repair attempts: 0
   - Recovery note: body-only edits; gates catch regressions.

6. [pending] Prepare dry-run fixture
   - Task ID: T006
   - Depends on: none
   - Parallel group: G2
   - Risk: low
   - Owned scope: /tmp sandbox fixture repo (outside this repository)
   - Not in scope: anything inside this repository
   - Spike candidate: none
   - Actions: create tiny synthetic Python repo in /tmp/csm-pdr-fixture/ (pyproject.toml, src layout, a module violating several artifact rules + missing doctrine practices, git init + baseline commit).
   - Acceptance signal: fixture exists with clean `git status` and ≥5 seeded violations listed in a /tmp notes file.
   - Validation: `git -C /tmp/csm-pdr-fixture status --short` empty.
   - Acceptance evidence: violation list recorded in plan journal.
   - Repair attempts: 0
   - Recovery note: disposable; recreate freely.

7. [pending] Enable csm-review dispatch
   - Task ID: T007
   - Depends on: T005
   - Parallel group: G5
   - Risk: high (public-interface contract change)
   - Owned scope: csm-review/SKILL.md (:3 description reword, :24 review-only line, :69 Hands off, :70 Never-invokes bullet, :191 terminal-rule reword) AND scripts/lib/contracts.mjs review-row cell `"csm-python-doctrine-review": false` — cell + prose land in ONE commit per DR4
   - Not in scope: any other sibling SKILL.md (bullets healed at T008); analyzer behavior
   - Spike candidate: none
   - Actions: set the review-row cell to false (permanent — false = dispatch allowed; third documented asymmetry); reword :3 truthfully ("…never fixes code; dispatches only csm-python-doctrine-review." — passes NEVER_CLAUSE_RE); reword :24 review-only line to acknowledge the single permitted dispatch; update :69 Hands off; adjust :191 to "stop after optionally dispatching csm-python-doctrine-review"; regenerate :70 bullet WITHOUT the analyzer name (false cell ⇒ excluded from true-cells).
   - Acceptance signal: check-suite Interface validation passes for csm-review (bullet==true-cells) AND description passes NEVER_CLAUSE_RE.
   - Validation: grep consistency — analyzer name absent from csm-review Never-invokes bullet; present exactly once in Hands off.
   - Acceptance evidence: gate excerpt recorded.
   - Repair attempts: 0
   - Recovery note: single-file edit; revert restores prior contract.
   - Review requirement: independent reviewer must approve this diff before commit (public-interface change).

8. [pending] Heal sibling bullets + README + final pack
   - Task ID: T008
   - Depends on: T005, T007
   - Parallel group: G6
   - Risk: standard
   - Owned scope: all ten sibling SKILL.md Never-invokes bullets (append `, csm-python-doctrine-review`), contracts.mjs sibling rows (append true cell to each of the ten rows — moved here from T002 so rows+bullets land together), README.md manual edits (skills-table row, TOC line, tmux-skills bullet extended to all 11 — gen-readme-matrix writes ONLY the <!-- csm-matrix:start/end --> region, gen-readme-matrix.mjs:17-18/:25-44), payload regen (sole final repack owner, pre-pack bootstrap-status guard)
   - Not in scope: csm-review (done at T007); body content
   - Spike candidate: none
   - Actions: add `, csm-python-doctrine-review` to each sibling's Never-invokes bullet (NOT csm-review's); rerun gen-readme-matrix/boilerplate sync; run pack-bootstrap.
   - Acceptance signal: `node scripts/check-suite.mjs` — zero Interface/bullet failures across all 11 skills, README mention + tmux-bullet checks pass (:1293-1306), payload drift zero incl. artifact JSON, and payload tree contains `payload/skills/csm-python-doctrine-review/SKILL.md` + artifact.
   - Validation: grep each bullet ends with analyzer name except csm-review's.
   - Acceptance evidence: gate rc + drift line recorded.
   - Repair attempts: 0
   - Recovery note: mechanical regeneration; idempotent.

9. [pending] Dry-run proof + completion gates
   - Task ID: T009
   - Depends on: T006, T008
   - Parallel group: G7
   - Risk: standard
   - Owned scope: /tmp fixture execution; .agents/plans/ journal updates; no writes inside this repository besides plan
   - Not in scope: implementing fixes in fixture
   - Spike candidate: none
   - Actions: execute the skill procedure manually against /tmp/csm-pdr-fixture per SKILL.md (consent simulated + recorded; declined-path ALSO exercised once); env redirection mandatory on every tool command (UV_CACHE_DIR/PIPX_HOME/XDG_CACHE_HOME → /tmp sandbox; ruff --no-cache; mypy --cache-dir /tmp); NO EXECUTION of fixture code (no import/pytest collection — prevents __pycache__/.pytest_cache dirt); prove exactly-one-file write surface via `git -C fixture status --porcelain -uall` diffed against the T006 baseline showing only `.agents/doctrine/<...>.md`; validate report contains tool pins, severity-tagged findings, fix-guide checkboxes; final `make analyze && make test-bootstrap`; re-record gate baseline if counts moved.
   - Acceptance signal: fixture git status shows EXACTLY one new file matching ARTIFACT_PATTERNS; check-suite exit 0; both consent paths evidenced.
   - Validation: report excerpts recorded in journal; `make analyze` 0 issues.
   - Acceptance evidence: dry-run transcript + gate outputs recorded.
   - Repair attempts: 0
   - Recovery note: disposable sandbox; rerun freely.

## Verification Strategy

Cheapest-first per task (greps/asserts) → targeted check-suite sections after T004/T005 → full `check-suite` at T008/T009 (expensive batch gate) → `make analyze && make test-bootstrap` final (T009) → fixture behavioral proof (T009, strongest evidence). Parallel: T002/T003/T006 after T001; T010-none; serial chain T004→T005→T007/T008. Environment-sensitive: the suite is EXPECTED red between T002 and T008 (ten bullet mismatches + registry/drift noise) — maintain the known-failure ledger in the journal, never re-record baselines mid-build, treat any failure OUTSIDE the ledger as a real regression; known concurrent lint breakage (wt-session WIP) may pre-exist — attribute, don't fix.

## Risks And Recovery

- csm-review contract inconsistency window (T007 mid-edit): mitigate by landing matrix cell (T002) and prose (T007) in the same checkpoint commit; rollback = git revert of two files.
- Description-budget policy conflict: build proceeds under OFF mode; on any future enablement, re-budget 220 words FIRST (AGENTS.md). Recorded, deferred.
- Concurrent-session collisions: stage only plan-owned paths per checkpoint; --no-verify bypass is standing user instruction; attribute pre-existing dirt, never fix others' work.
- Mypy env-noise produces misleading findings: disclose limitation in report header; recommend `--ignore-missing-imports` posture; never install deps into target to silence.
- Rollback: every task additive/single-owner; per-task `git checkout -- <file>` recovers; fixture disposable.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| ------- | -------- | ---------- | -------- |
| F1 skillDirs omission = gate-silent unpacked skill | critical | T003 owns skillDirs; acceptance adds payload-tree file check | pack-bootstrap.mjs:30-41,:43-47; check-suite.mjs:584-624 |
| F2 mid-build suite red denied by plan vocabulary | major | sibling cells moved to T008; known-failure ledger mandated | check-suite.mjs:823-831,:725-730,:1346-1349,:1399-1400 |
| F3 DR4 same-commit impossible as decomposed; "TEMPORARILY" mislabel | major | cell+prose unified in T007; cell false permanently | contracts.mjs:331,:343,:381 |
| F4 gen-readme-matrix writes only matrix region | major | T008 manual README edits + greps added | gen-readme-matrix.mjs:17-44; check-suite.mjs:1293-1306 |
| F5 stub sections fail byte-exact drift; boilerplate timing | major | boilerplate entry moved to T004; real shells + sync --write; drift-clean acceptance | sync-skill-boilerplate.mjs:48-55,:65-74,:96-102 |
| F6 T002 assert unsatisfiable (3 existing asymmetries) | major | assert reworded new-column-scoped | contracts.mjs:331,:343,:381 |
| F7 FORMAT_VERSIONS inert | minor | kept, marked forward-looking | check-suite.mjs:1082-1256 |
| F8 fixture proof under-hardened | minor | env redirection + no-exec rule + porcelain -uall vs baseline | uv/ruff/mypy docs (retrieved 2026-08-22) |
| F9 syncPayload prune destructive under churn | minor | pre-pack bootstrap-status guard; T008 sole final repack owner | pack-bootstrap.mjs:163-169 |
| F10 csm-review :24 sweep omitted | minor | :24 added to T007 scope + validation grep | csm-review/SKILL.md:24 |
| F11 wrong import citation | minor | corrected (:21-22 via sync-skill-boilerplate.mjs:12) | verified in repo |
| F12 graph/dependency cosmetics | minor | T004 edge aligned; append-at-end noted | plan graph vs task blocks |
| F13 write-discipline vs consented host caches | minor | allowlist scoped to target repo; cache locations declared | Design/T005 |

Remediation applied primary-led (document-only edits, low risk) with recorded independence caveat per resilience ladder rung 4 — critic was an independent subagent.

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --------- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-22T20:05Z | 0 | INTAKE->DISCOVER | – | brief classified large+prescriptive; consumes approach format csm-grill/1 (committed 0a56f12); prescriptions A1-A9 recorded | DISCOVER |
| 2026-08-22T20:15Z | 0 | DISCOVER->RESEARCH | – | scout anchors + feasibility tracks returned (R1-R4) | RESEARCH |
| 2026-08-22T20:30Z | 0 | RESEARCH complete | – | DR1-DR7 captured; design committed | DRAFT |
| 2026-08-22T20:45Z | 0 | DRAFT->CRITIQUE | – | hostile review: 13 findings (1 critical / 5 major / 7 minor) | CRITIQUE |
| 2026-08-22T21:00Z | 0 | CRITIQUE->REMEDIATE->VERIFY | – | all 13 applied primary-led (rung-4 caveat); resolution table filled | VERIFY |

## Completion Review

(filled by csm-build when all criteria are verified)
