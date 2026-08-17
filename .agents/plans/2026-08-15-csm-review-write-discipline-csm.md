---
format: csm-plan/1
---

# csm-review Write Discipline CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 2 tasks — 1 low (single-skill doc edit), 1 low (one linter map line). No security/data/destructive tasks; the change tightens a safety contract.

## Control
- Plan ID: csm-review-write-discipline
- Status: complete
- Current CSM state: COMPLETE
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-15 build cycle 1 — T001+T002 complete; independent review PASS (6 wording findings, all repaired); all gates green; plan COMPLETE DISCOVER cataloged every write path in csm-review/SKILL.md; primary-led critique applied (small, low-risk ask)
- Next transition: none (terminal)
- Active tasks: none
- Blockers: none

## Goal

Guarantee that csm-review writes nothing to the reviewed repository except under `.agents/` or in a temp directory, by codifying a write allowlist, removing the auto-commit, and adding a whole-run protected-state verification.

Deliverables:
1. `csm-review/SKILL.md` updated: new `## Write Discipline And File Allowlist` section; commit-on-explicit-request-only language (Core Rules, Activation Boundary, SAVED); INTAKE baseline + VERIFY protected-state check; Anti-Patterns and Done Criteria entries.
2. `scripts/check-suite.mjs`: csm-review's required-section map gains the new section (structural enforcement).

Constraints:
- Two-zone write allowlist only: (a) the report file (and its `.agents/reviews/` directory creation) at the reviewed repo's git root (else cwd), including the embedded Control journal (same file); (b) the temp sandbox `/tmp/opencode/csm-review-<run-id>/` and OS temp dirs (including the remote-URL clone target and redirected HOME/TMPDIR/XDG paths).
- Git operations against the reviewed repo remain read-only (rev-parse, status, log, show, grep).
- No commit into the reviewed repo unless the user explicitly requests one in the invocation (a commit writes `.git`, outside the allowlist; also inappropriate for foreign repos).
- House section-naming precedent: mirror csm-grill's `## Write Discipline And Temp Files` pattern.

Exclusions (anti-scope):
- No changes to other skills, README (verified: it makes no csm-review commit claims), or the report format's section list.
- No change to the sandbox rungs R0–R3 or the containment check (already allowlist-consistent).
- No behavioral change beyond the write contract.

## Acceptance Criteria

1. `csm-review/SKILL.md` contains `## Write Discipline And File Allowlist` defining the two-zone allowlist and forbidding every other write anywhere in the reviewed repository or host, with commits only on explicit user request. Evidence: grep gate (T001).
2. No auto-commit language remains: the SAVED section no longer contains "Unless the user declined, commit"; commit language is conditional on explicit request. Evidence: grep gate.
3. Protected-state verification present: INTAKE records a baseline (`git status --short` of the reviewed repo, or a file listing if not a git repo) in the Control journal; VERIFY re-checks and permits only the report file as the difference, treating any other change as a critical finding reported to the user. Evidence: grep gate.
4. Anti-Patterns gains a writing-outside-allowlist entry (including unrequested commits); Done Criteria gains a write-discipline item. Evidence: grep gate.
5. `scripts/check-suite.mjs` requires the new section for csm-review; `node scripts/check-suite.mjs` exits 0 on the final suite; the planted-defect negative test still exits 1. Evidence: T002 gate.
6. SKILL.md stays under 500 lines (linter-enforced). Evidence: linter run.

## Current-State Evidence

- csm-review/SKILL.md is 313 lines at HEAD bb54746.
- Violations of the user constraint found: SAVED step 2 auto-commits ("Unless the user declined, commit it in a single commit staging only the report", SKILL.md:183) — a commit writes `.git` objects; Core Rules:47 ("the only file added and committed is the report"), Activation Boundary:38 and SAVED:184 reference "the commit hash or skip reason".
- Compliant already: INTAKE:99 creates only `.agents/reviews/<date>-<repo-slug>-review.md` + its directory; sandbox rungs use `/tmp/opencode/csm-review-<run-id>/` with env redirection (SKILL.md:63-66); containment check permits only the report scaffold in reviewed-repo status (SKILL.md:68) — but covers R1–R3 steps only, not the whole run.
- Missing: a codified write-allowlist section (csm-grill precedent at csm-grill/SKILL.md:39 `## Write Discipline And Temp Files`); a whole-run baseline/verify of the reviewed repo state.
- README.md makes no csm-review commit claims (grep verified — no change needed).
- scripts/check-suite.mjs:47-57 holds csm-review's required-section list; adding one string extends it; planted-defect test copies csm-scan (unaffected).

## Assumptions And Decisions

| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | csm-review may write only under `.agents/` of the reviewed repo or in temp directories | user-dictated | User brief 2026-08-15 | decided |
| A2 | The SAVED auto-commit is removed; a commit happens only when the user explicitly requests one in the invocation | evidence-based | A commit writes `.git` (outside the allowlist); the reviewed repo may be foreign — writing into its history is a trust violation; display becomes "not committed (write discipline)" by default | decided |
| A3 | The embedded Control journal needs no separate allowlist entry — it lives inside the report file | evidence-based | Report format defines Control as an embedded section of the report | decided |
| A4 | The section is named `## Write Discipline And File Allowlist`, mirroring csm-grill's `## Write Discipline And Temp Files` house pattern | evidence-based | House section-naming precedent | decided |
| A5 | scripts/check-suite.mjs gains the section in csm-review's required map — structural enforcement against future drift | evidence-based | Linter exists precisely for cross-file/convention drift (the suite's #1 recurring defect class) | decided |

## R&D Record

| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | Where can csm-review currently write? | Read-only grep of csm-review/SKILL.md (commit/write/scaffold/.agents/sandbox/tmp) | Read-only; tree clean | Report scaffold (.agents, compliant); /tmp sandbox (compliant); SAVED auto-commit (violation); commit language at :38/:47/:183/:184; containment check scoped to R1-R3 only | T001 edits; A2 decision |
| R2 | Does README promise review commits? Is there house precedent + linter wiring? | Read-only greps of README.md, csm-grill/SKILL.md, scripts/check-suite.mjs | Read-only | No README commit claims; csm-grill Write-Discipline precedent; linter map at check-suite.mjs:47 | No README task; T002 linter line |

## Discovered Requirements

1. Section name must match exactly between SKILL.md and the linter map (`## Write Discipline And File Allowlist`).
2. Gate greps must match the wording the edit actually introduces (verify against the drafted text, not assumed phrasing).
3. Keep the existing containment-check sentence (:68) — it is allowlist-consistent; the new whole-run verification is additive.
4. SKILL.md must stay <500 lines (currently 313; adding ~20).

## Design

### D1 New section (placed after Core Rules, before Scale To The Ask)

`## Write Discipline And File Allowlist` — content: the complete write allowlist is exactly (1) the report file `.agents/reviews/<yyyy-mm-dd>-<repo-slug>-review.md` and the creation of its `.agents/reviews/` directory (git root of the reviewed repo, else cwd) — the embedded Control journal lives in this file; and (2) the temp sandbox `/tmp/opencode/csm-review-<run-id>/` plus OS temp directories, including the remote-URL clone target and redirected HOME/TMPDIR/XDG paths. Nothing else may be written anywhere in the reviewed repository or on the host. Git operations against the reviewed repo are read-only (`rev-parse`, `status`, `log`, `show`, `grep`). A commit is made only when the user explicitly requests one in the invocation; by default nothing is committed and SAVED reports "not committed (write discipline)".

### D2 Protected-state verification (whole-run)

- INTAKE gains a step: record a baseline of the reviewed repo (`git -C <repo> status --short`; if not a git repo, a top-level file listing) in the Control journal.
- VERIFY gains a bullet: re-run the baseline check; the only permitted difference is the report file; any other change is a critical finding, surfaced to the user, never silently reverted.

### D3 Consequential edits

- Core Rules:47 → "No source-file modifications to the reviewed repository; writes are limited to the Write Discipline allowlist (the `.agents` report file and the temp sandbox). Never commits unless the user explicitly requests it."
- Activation Boundary:38 → "...the commit hash when one was explicitly requested, else 'not committed (write discipline)'...".
- SAVED step 2 → "Commit only when the user explicitly requested a commit in the invocation — a single commit staging only the report; otherwise do not commit."
- SAVED step 3 display → "commit hash when requested, else 'not committed (write discipline)'".
- Anti-Patterns: add "Writing anywhere in the reviewed repository outside `.agents/` — including commits not explicitly requested."
- Done Criteria: add "Write discipline held: allowlist verified at VERIFY."

### D4 Linter (T002)

Add `'## Write Discipline And File Allowlist'` to the csm-review required-section list (scripts/check-suite.mjs:47ff). No other linter change; planted-defect test unaffected (it breaks csm-scan's tmux section).

## Execution Graph

- G1: T001 (owns csm-review/SKILL.md).
- G2: T002 (owns scripts/check-suite.mjs) — depends on T001 (the linter must pass against the final SKILL.md).
- Critical path: T001 → T002.

## Numbered Plan

1. [completed] csm-review write-discipline edit
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: low (single-skill doc edit tightening a safety contract)
   - Owned scope: csm-review/SKILL.md
   - Not in scope: any other file, README, sandbox rungs, report format section list
   - Spike candidate: none
   - Actions: per D1–D3 — insert `## Write Discipline And File Allowlist` after Core Rules; add the INTAKE baseline step and the VERIFY protected-state bullet; replace commit language at :38/:47/:183/:184 with explicit-request-only phrasing; add the Anti-Patterns and Done Criteria entries. Keep every other section untouched.
   - Acceptance signal: `bash -c 'set -e; F=csm-review/SKILL.md; grep -q "## Write Discipline And File Allowlist" $F; grep -q "the only permitted difference is the report file" $F; grep -q "baseline" $F; ! grep -q "Unless the user declined, commit" $F; grep -q "explicitly requests" $F; grep -q "not committed (write discipline)" $F; grep -q "including commits not explicitly requested" $F; grep -q "Write discipline held" $F; L=$(wc -l < $F); test $L -le 500; echo WRITE-DISCIPLINE-GATE-PASS'` → expected `WRITE-DISCIPLINE-GATE-PASS`, exit 0
   - Validation: (1) acceptance signal; (2) the section appears exactly once (`grep -c`); (3) INTAKE numbered steps remain coherent (baseline step inserted without renumbering damage); (4) diff review — no unrelated sections touched.
   - Acceptance evidence: gate output + diff summary.
   - Repair attempts: 0
   - Recovery note: the gate names the exact missing marker; add incrementally; never rewrite wholesale.

2. [completed] Linter enforcement for the write-discipline section
   - Task ID: T002
   - Depends on: T001
   - Parallel group: G2
   - Risk: low
   - Owned scope: scripts/check-suite.mjs
   - Not in scope: any other linter rule, any skill file
   - Spike candidate: none
   - Actions: add `'## Write Discipline And File Allowlist'` to the csm-review entry in the required-section map (line ~47ff); no other changes.
   - Acceptance signal: `bash -c 'set -e; grep -q "Write Discipline And File Allowlist" scripts/check-suite.mjs; node scripts/check-suite.mjs; D=$(mktemp -d /tmp/opencode/planted-wd-XXXXXX); cp -r csm-review "$D/"; sed -i "s/^## Write Discipline And File Allowlist/## Planted-Broken/" "$D/csm-review/SKILL.md"; if node scripts/check-suite.mjs --root "$D" >/dev/null 2>&1; then echo "PLANTED-NOT-CAUGHT"; exit 1; fi; rm -rf "$D"; echo LINTER-WD-GATE-PASS'` → expected `LINTER-WD-GATE-PASS`, exit 0
   - Validation: full linter run exits 0 (all skills); planted-defect (broken section in a csm-review copy) exits 1; original csm-scan planted-defect test still passes.
   - Acceptance evidence: gate output + linter summary line.
   - Repair attempts: 0
   - Recovery note: if the linter fails on the real suite, the SKILL.md section name drifted from the map — reconcile the map to the exact heading.

## Verification Strategy

Cheapest first: (1) T001 grep gate (seconds); (2) T002 linter run (<1s) + planted-defect tests (seconds); (3) diff review at INTEGRATE. No suite runs needed (no csm-scan code touched). All gates deterministic; no environment sensitivity.

## Risks And Recovery

- Wording drift between SKILL.md heading and linter map → both gates grep the exact same string; a mismatch fails loudly at T002.
- The commit-behavior change surprises a user who relied on auto-commit → SAVED now displays "not committed (write discipline)" and the boundary explains how to request a commit; recorded as decision A2.
- Line budget exceeded → gate enforces ≤500 (313 + ~20 expected).
- Rollback: two files, forward edits; revert = git revert the checkpoint commit.

## Critique Resolution

Primary-led critique (small, low-risk ask; per Scale To The Ask):

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| Draft gate grepped "baseline" generically — could match unrelated text | minor | Gate also greps the specific sentence "the only permitted difference is the report file" (D2 wording) so the verification semantics, not just the word, are enforced | T001 signal |
| Draft risked renaming/removing the containment-check sentence at :68 | minor | D3 explicitly keeps it (allowlist-consistent); the whole-run verification is additive | Design D2/D3 |
| Commit-display change could orphan "commit hash or skip reason" phrasing elsewhere | minor | Discovered Requirements 2 + gate greps "not committed (write discipline)"; INTEGRATE diff review confirms all four commit-language sites updated | T001 validation 4 |
| Linter planted-defect test might break | minor | T002 gate includes its own planted-defect test against the new section; original test unaffected (breaks csm-scan) | T002 signal |
| Scope creep into README | nit | R2 verified README makes no commit claims — no README task | R&D R2 |

Build review findings (independent pass, cycle 1): Verdict PASS; 6 wording findings, all repaired.

| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| R-1 allowlist "exactly" enumeration self-contradicted by the commit exemption | minor | commit added as enumerated item (3), user-request-only | Write Discipline section |
| R-2 read-only git ops list omitted clone (required by remote intake) | minor | bullet scoped to reviewed-repo state; clone (file://, temp target) permitted | Write Discipline section |
| R-3 containment-check wording garbled vs VERIFY baseline diff | minor | reconciled: "diffed against the INTAKE baseline — only the report file may differ" | Execution Posture |
| R-4 remote-target report location ambiguous (evaporable sandbox) | nit | invocation cwd .agents/reviews/ stated | Write Discipline section |
| R-5 challenger file copies unstated location | nit | "(in the temp sandbox)" added to enumeration item 2 | Write Discipline section |
| R-6 parent .agents/ creation not spelled out | nit | spelled out | Write Discipline section |

## Progress Journal

| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-15 | 0 | INTAKE | none | Small prescriptive ask classified; user-dictated A1; quick plan with full structure | DISCOVER |
| 2026-08-15 | 0 | DISCOVER | none | Write-path catalog: violations at :38/:47/:183/:184 (auto-commit + commit language); compliant scaffold+sandbox; no whole-run verification; no README claims; linter map located | DRAFT |
| 2026-08-15 | 0 | DRAFT | none | 2-task draft (T001 SKILL.md, T002 linter line); gates grep exact D1-D3 wording | CRITIQUE |
| 2026-08-15 | 0 | CRITIQUE | none | Primary-led critique: 5 findings (all minor/nit) — gate specificity, containment sentence preserved, commit-language sweep, planted-defect coverage, README scope | REMEDIATE |
| 2026-08-15 | 0 | REMEDIATE | none | All 5 applied to the draft (see Critique Resolution) | VERIFY |
| 2026-08-15 | 0 | VERIFY | none | Primary-personal gate: AC1-6 map to T001/T002 gates; both signals bash-syntax-checked; dependency T001→T002 sound; tasks pending/NOT_STARTED; allowlist consistent with existing containment text | SAVED |
| 2026-08-15 | 0 | SAVED | none | Plan saved to .agents/plans/2026-08-15-csm-review-write-discipline-csm.md; single commit staging only the plan file | STOP |

## Completion Review

Build complete (cycle 1). AC1-6 all verified: write-discipline section present with two-zone (+explicit-commit) allowlist (AC1); no auto-commit language (AC2); INTAKE baseline + VERIFY protected-state check with only-the-report-file rule (AC3); Anti-Patterns + Done Criteria entries (AC4); linter requires the section — 156 checks pass, planted defect caught (AC5); 324 lines <500 (AC6). Independent review PASS; 6 wording findings repaired; gates re-run green. Nothing pushed.
