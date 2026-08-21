format: csm-plan/1
# csm-deep-research Commit-at-SAVED CSM Plan

## How To Execute

- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 2 tasks — both low risk (prose flip + generated-payload regen). No high-risk tasks; no independent review mandated.

## Control

- Plan ID: deep-research-commit-on-save
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: planning complete; plan saved
- Last model/run: deepseek-v4-flash / csm-plan run
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal

Amend `csm-deep-research` so that a completed run **commits its research document and declared run artifacts by default at SAVED** (pathspec commit, never pushed), instead of the current default of committing only when the user explicitly requests it. Minimal changes possible: prose flips in one file plus the mandatory bootstrap-payload regeneration; an explicit user "do not commit" request still skips the commit. Exclusions: no changes to any other skill, to contracts.mjs, to the research-document format, or to any gate script.

## Acceptance Criteria

1. `csm-deep-research/SKILL.md` states that SAVED commits the research document and declared artifacts by default via the existing pathspec-commit discipline (`git commit --only <research-doc> <artifacts...>`, verified with `git show --stat HEAD`, never pushed), skipping only when the user explicitly requested no commit. Evidence: grep of the six amended lines (Write Discipline item 4, redaction line, default-commit line, SAVED bullet, commit-report paragraph, Done Criteria-adjacent paragraph).
2. No other skill semantics changed: description frontmatter byte-identical, Interface section byte-identical, never-invokes list unchanged (still 7 names), all other H2 sections untouched except Write Discipline And File Allowlist and Research State Machine SAVED step prose. Evidence: `git diff csm-deep-research/SKILL.md` shows only the six intended line ranges.
3. All repo gates pass after regeneration: `pnpm exec oxlint --deny-warnings` clean; `node scripts/check-suite.mjs` OK with payload drift `issues:[]`; gate baseline consistent (re-record only if the check count deviates). Evidence: recorded command outputs.
4. Bootstrap payload regenerated so `bootstrap/package/payload/skills/csm-deep-research/SKILL.md` is byte-identical to the repo-root file. Evidence: `cmp` exits 0.

## Current-State Evidence

- `csm-deep-research/SKILL.md` L69 (allowlist item 4): "...(4) a single commit staging only the research document and its declared artifacts, when the user explicitly requests one in the invocation."
- L75: "...re-check at VERIFY and before the optional commit."
- L77: "- By default nothing is committed and SAVED reports \"not committed (write discipline)\"."
- L212 (SAVED state body): "commit only if the user explicitly requested it — `git commit --only <research-doc> <artifacts...>` (a pathspec commit ... never a plain `git commit` ...), verified with `git show --stat HEAD`, never pushing"
- L216: "The commit, when requested, stages only ... The final report ... includes the saved path, every artifact path, the commit hash (or \"not committed (write discipline)\") ..."
- L218: "A commit, when explicitly requested, is a single `git commit --only <research-doc> <artifacts...>` pathspec commit ... no push happens unless the user separately asks ..."
- Gate couplings verified: `scripts/lib/contracts.mjs` holds no needles on these strings (MANIFEST requires section titles only; CONTRACTS/UPLOAD_SCRIPT_REF unrelated); `scripts/lib/boilerplate.mjs` does not own the affected sections; description frontmatter is not touched (budget/volatile checks stay green).
- Editing the root SKILL.md hard-fails the gate on payload drift until `node scripts/pack-bootstrap.mjs` regenerates `bootstrap/package/payload/skills/**` (verified mechanism in the prior browse-fallback build).
- Repo precedent for default-commit-with-opt-out: `csm-plan` SAVED — "Unless the user explicitly requested no commit, commit the new plan file..." — the same convention is adopted here.
- Current gate baseline: 664 checks (`node scripts/check-suite.mjs` OK); `.agents/token-efficiency.json` = `{"enabled": false}`.

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
| --- | --------- | ---- | --------------------- | ------ |
| A1 | Default flips to always-commit; the only skip is an explicit user "no commit" request (mirrors csm-plan's convention). | user-dictated + repo precedent | brief: "commit its work once complete"; csm-plan SAVED wording | accepted |
| A2 | Keep the exact existing pathspec-commit mechanics (`git commit --only <research-doc> <artifacts...>`, `git show --stat HEAD` verification, never push). | decision | minimal-change mandate; mechanics already proven in runs | accepted |
| A3 | No changes outside `csm-deep-research/SKILL.md` (+ its generated payload copy). | constraint | minimal possible; no contract/matrix/format impact discovered | accepted |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
| --- | -------- | ----------- | -------------------------------- | ----------- | ---------------- |
| R1 | Which lines assert the current commit-only-on-request policy? | rg over csm-deep-research/SKILL.md (read-only) | no writes | Six locations: L69, L75, L77, L212, L216, L218 | T001 action list |
| R2 | Do any gates pin these strings? | read-only inspection of scripts/lib/contracts.mjs, scripts/lib/boilerplate.mjs | no writes | No needles on commit-policy text; only section titles and synced boilerplate sections are pinned; neither affected | Only payload regen needed (T002) |
| R3 | What happens to the gate after editing the root SKILL.md without regen? | prior build-cycle evidence (browse-fallback plan, executed same session-chain) | n/a — recorded from executed run | Payload drift is a hard gate failure; `node scripts/pack-bootstrap.mjs` fixes it | T002 acceptance |

## Discovered Requirements

- Payload regen is mandatory after any root SKILL.md edit: run `node scripts/pack-bootstrap.mjs`; verify with `cmp bootstrap/package/payload/skills/csm-deep-research/SKILL.md csm-deep-research/SKILL.md`.
- Do not touch the frontmatter description (220-token policy budget), the Interface bullets, or boilerplate-synced sections (`## Tmux Session Bootstrap`, `## Subagent Resilience`).
- Keep the literal artifact-path pattern `.agents/research/<yyyy-mm-dd>-<slug>-research.md` intact wherever it already appears (Interface Produces bullet is not edited anyway).
- Gate baseline: if `check-suite` count deviates after the edit, re-record with `node scripts/record-gate-baseline.mjs --record check-suite <N> <wall-ms>`; prose-only edits are not expected to change the count.

## Design

Flip the commit policy of the csm-deep-research SAVED state from opt-in to opt-out using six targeted prose substitutions (same file, same discipline, same commands):

1. L69 item (4) tail: "...when the user explicitly requests one in the invocation." -> "performed at SAVED unless the user explicitly requested no commit in the invocation."
2. L75: "before the optional commit" -> "before the commit".
3. L77: replace the whole bullet with: "- By default SAVED commits the research document and its declared artifacts (item 4) and reports the commit hash; only a user's explicit no-commit request skips it, and SAVED then reports \"not committed (user request)\"."
4. L212: "commit only if the user explicitly requested it —" -> "commit unless the user explicitly requested no commit —".
5. L216: "The commit, when requested, stages only" -> "The commit stages only"; and "(or \"not committed (write discipline)\")" -> "(or \"not committed (user request)\" when skipped)".
6. L218: "A commit, when explicitly requested, is a single" -> "A commit is a single".

Nothing else changes: same pathspec command, same verification, same no-push rule, same temp-dir deletion regardless of commit state.

## Execution Graph

```
T001 (SKILL.md prose) ---> T002 (payload regen + gates)
```
Single chain; no parallel groups.

## Numbered Plan

1. [pending] Flip csm-deep-research commit policy to commit-at-SAVED
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low (six prose substitutions in one markdown file; revertible)
   - Owned scope: `csm-deep-research/SKILL.md`
   - Not in scope: frontmatter description; Interface section; `## Tmux Session Bootstrap` / `## Subagent Resilience` (boilerplate-synced); `scripts/lib/**`; README.md; any other skill
   - Spike candidate: none
   - Actions: apply the six substitutions listed in Design (L69 tail, L75, L77 replacement bullet, L212, L216 two fragments, L218), preserving every other word of those sentences.
   - Acceptance signal: `rg -n "commit only if the user explicitly requested it|By default nothing is committed|optional commit|The commit, when requested|A commit, when explicitly requested|when the user explicitly requests one" csm-deep-research/SKILL.md` returns NO matches, AND `rg -c "commit unless the user explicitly requested no commit" csm-deep-research/SKILL.md` equals 1, AND `git diff --stat csm-deep-research/SKILL.md` shows only this file.
   - Validation: `git diff csm-deep-research/SKILL.md` inspected line-by-line — only the six ranges changed; frontmatter and Interface hunks absent from the diff; file line count within the gate's `< 500` bound.
   - Acceptance evidence: recorded outputs of the acceptance greps and the diff stat.
   - Repair attempts: 0
   - Recovery note: revertible single file (`git checkout -- csm-deep-research/SKILL.md`); partial work detectable by the acceptance greps.

2. [pending] Regenerate bootstrap payload and run the gates
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2 (final)
   - Risk: low (generated artifacts + read-only verification; may update `.agents/docs/gate-baselines.json` only on count deviation)
   - Owned scope: `bootstrap/package/**`, `bootstrap/payload-index.json` (regenerated), `.agents/docs/gate-baselines.json` (only on deviation)
   - Not in scope: any hand-edit inside `bootstrap/`; any skill or script file
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs` (no argv) from the repo root.
     2. Verify byte-identity: `cmp bootstrap/package/payload/skills/csm-deep-research/SKILL.md csm-deep-research/SKILL.md`.
     3. Run `pnpm exec oxlint --deny-warnings` (expect clean) and `node scripts/check-suite.mjs` (expect `OK — 9 skills, 664 checks`, payload drift `issues:[]`).
     4. Run `node scripts/record-gate-baseline.mjs --check`; only if the count deviates, re-record with the observed count and wall time, then re-verify.
   - Acceptance signal: `cmp` exits 0 AND `node scripts/check-suite.mjs` exits 0 reporting `OK` with `issues:[]` payload drift AND `record-gate-baseline.mjs --check` passes.
   - Validation: `git status --short` shows only `csm-deep-research/SKILL.md`, `bootstrap/**`, the plan file, and (if re-recorded) the baseline JSON.
   - Acceptance evidence: recorded outputs of cmp, check-suite, and baseline check.
   - Repair attempts: 0
   - Recovery note: `git checkout -- bootstrap/` restores the prior generated payload; gates are idempotent to re-run.
   - Spike candidate: none

## Verification Strategy

- Fast per-task gates: T001 acceptance greps + diff inspection; T002 cmp + full `check-suite` (repo-wide final gate, ~3s) + baseline check.
- Order: T001 signal -> T002 (regen cannot precede the edit).
- Environment-sensitive checks: none for this change; node-version floor affects only `tests/package-audit.test.mjs` / `tests/integration/bootstrap-flow.test.mjs` (not in scope; not required here).

## Risks And Recovery

- Gate failure modes are explicit and self-diagnosing: payload drift (fix: T002 regen), never-invokes mismatch (cannot occur — Interface untouched), description budget (cannot occur — frontmatter untouched), baseline deviation (fix: re-record).
- Rollback: both tasks touch revertible paths (`git checkout -- csm-deep-research/SKILL.md bootstrap/`).
- Behavioral risk of auto-commit: a run in a dirty foreign repo could sweep nothing (pathspec commit lists only the doc + artifacts), so the blast radius stays the two allowlisted paths; the pre-existing "never a plain git commit" rule is retained verbatim.

## Critique Resolution

| Finding | Severity | Resolution | Evidence |
| --- | -------- | ---------- | -------- |
| Journal rows for post-DISCOVER states missing | minor | Added below at save time | Progress Journal |
| Critique Resolution table left empty | minor | Filled with primary-led critique outcome (small low-risk plan per Scale To The Ask section 2) | this table |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
| --- | ----- | ---------- | ----- | --------------- | ---------- |
| 2026-08-21 | 0 | INTAKE -> DISCOVER | — | Small prescriptive ask; quick-plan path; primary-led discovery (uncertainty scout omitted per Scale To The Ask §2, noted here as the independence trade-off) | DISCOVER |
| 2026-08-21 | 0 | DISCOVER complete | — | Six commit-policy lines inventoried (L69/75/77/212/216/218); no gate needles on them; payload-regen requirement confirmed from executed prior cycle | RESEARCH |
| 2026-08-21 | 0 | RESEARCH -> DRAFT | — | R1-R3 recorded; design = six prose substitutions, opt-out wording mirroring csm-plan convention (A1) | DRAFT |
| 2026-08-21 | 0 | DRAFT complete | — | 2-task plan drafted (T001 prose flip, T002 payload+gates) | CRITIQUE |
| 2026-08-21 | 0 | CRITIQUE complete | — | Primary-led critique (low-risk small plan): all six old phrases covered by acceptance greps; no placeholder tokens in acceptance-signal spans; gate couplings clean; 2 minor findings (journal rows, empty critique table) | REMEDIATE |
| 2026-08-21 | 0 | REMEDIATE complete | — | Both minor findings fixed; no material issues remain | VERIFY |
| 2026-08-21 | 0 | VERIFY complete | — | Primary personal review: ACs map to tasks; commands match repo; recovery notes present; plan approved | SAVED |

## Completion Review

<filled by csm-build when all criteria are verified>
