---
format: csm-review/1
---
# csm-deep-research Skill Review

- Date: 2026-08-20
- Reviewed artifact: the csm-deep-research skill and its suite integration (plan .agents/plans/2026-08-20-csm-deep-research-skill-csm.md, tasks T001-T004 complete)
- Method: five parallel fresh-eyes hostile passes (a) conformance, (b) coverage, (c) CSM integrity, (d) safety, (e) executability; none of the reviewers authored the deliverables
- Status: findings remediated per the plan's Critique Resolution; final gate re-run after remediation

## Pass Verdicts

| Pass | Focus | Verdict | Findings |
|---|---|---|---|
| A | Conformance: every machine-checked gate applies and passes | CONFORMANT | 6 (1 minor, 2 minor, 2 low/nit, 1 info) |
| B | Coverage: all 14 grill decisions implemented in the instruction set | PASS | 4 (low/nit) |
| C | CSM integrity: state machine, cycles, termination, resume, role separation | FAIL | 9 (2 major, 5 minor, 1 info) |
| D | Safety: write discipline, secrets, resume, baseline, commit scope | FAIL | 12 (2 high, 6 medium, 2 low-medium, 1 low) |
| E | Executability: a fresh agent can run the skill from the text alone | FAIL | 22 (7 high, 11 medium, 4 low) |

## Findings A — Conformance

- R-A1 (minor): ARTIFACT_PATTERNS has no csm-deep-research entry — Interface artifact-path check passes vacuously. RESOLVED: entry added (scripts/lib/plan-validation.mjs).
- R-A2 (minor): F-050 template-format-marker machinery not extended to csm-deep-research. RESOLVED: hard check wired (content already conforms).
- R-A3 (minor): research corpus block has no Control/Journal validation. RESOLVED: embedded-journal row validation added to the corpus block.
- R-A4 (low): verifyReviewClaims hardcoded to csm-review. NOT IMPLEMENTED (recorded non-blocking; numeric claim verified true).
- R-A5 (nit): NEVER_INVOKE comment overstates "universal" — matrix asymmetric by D22. NOT IMPLEMENTED (comment updated in contracts.mjs).
- R-A6 (info): STOP terminal-exempt works as designed; budget 220/220 + no volatile tokens verified manually while the toggle is off. ACCEPTED.

## Findings B — Coverage

- R-B1 (low): E1/E2/E3 evidence-class taxonomy from the approach not surfaced by name. ACCEPTED as superseded (semantics covered by tier-scaled verdicts).
- R-B2 (low): QUICK-tier JUDGE handling under-specified. RESOLVED (QUICK primary-led rubric check with recorded independence caveat).
- R-B3 (low): kill-the-draft REMEDIATE -> SYNTHESIZE edge absent from cycle rules. RESOLVED.
- R-B4 (nit): Hands-off bullet names csm-plan (human-mediated). ACCEPTED as pinned.

## Findings C — CSM Integrity

- R-C1 (MAJOR): JUDGE loop uncapped — termination not guaranteed. RESOLVED: judge-fail rounds folded into the adversarial cap (one further JUDGE round per dimension; beyond that residual rubric failure recorded as caveat and run proceeds).
- R-C2 (MAJOR): resume contract contradicts temp-dir cleanup — resume would destroy the evidence it depends on. RESOLVED: temp-dir path journaled at INTAKE, reused on resume; cleanup scoped to this session's recorded dir, never a wildcard; cleanup only for runs past SAVED.
- R-C3 (minor): STANDARD display unspecified at SAVED. RESOLVED (STANDARD: summary plus Key Findings and Recommendation).
- R-C4 (minor): Core Rules promises allowlist verification "at VERIFY and SAVED"; SAVED lacks it. RESOLVED: single re-run at VERIFY; SAVED re-reads that result (wording aligned).
- R-C5 (minor): clarification default-off absent from Activation Boundary. RESOLVED.
- R-C6 (minor): adversarial cap silent on VERIFY->CHALLENGE counting. RESOLVED (re-challenges count toward the claim's adversarial round count).
- R-C7 (minor): anti-pattern contradicts sanctioned QUICK primary-led challenge. RESOLVED (carve-out clause added).
- R-C8 (minor): STOP referenced but never defined; "terminal" applied to SAVED. RESOLVED (STOP defined in the state-machine section).
- R-C9 (info): plan text still pins "RESEARCH->CHALLENGE" cap wording; skill corrected. RESOLVED (plan journal noted).

## Findings D — Safety

- R-D1 (HIGH): secret-bearing content could be quoted into the finding and committed. RESOLVED: content rule added — never include credentials/keys/tokens/personal data in the finding or temp-dir evidence; redact before quoting; re-check at VERIFY and before the optional commit.
- R-D2 (HIGH): resume re-dispatch re-spends quota; no completion marker in the journal. RESOLVED: journal records both entering and completing each state; resume re-runs only states whose completion is not journaled, re-reading surviving artifacts first.
- R-D3 (MED): protected-state baseline guards the wrong tree when the researched repo differs from the write tree. RESOLVED: `<repo>` defined as the write target's git root; baseline both trees when they differ; guarantee stated for the write tree.
- R-D4 (MED): baseline re-capture on resume normalizes prior-session deviations. RESOLVED: on resume, diff current tree against the prior session's journaled baseline and surface differences before re-recording.
- R-D5 (MED): optional commit can sweep pre-existing staged changes. RESOLVED: `git commit --only <research-doc>` (pathspec commit) mandated; verify with `git show --stat HEAD`.
- R-D6 (MED): temp-dir cleanup on resume destroys evidence / can hit a concurrent session's dir. RESOLVED (with R-C2): consume before cleanup; scope deletion to the recorded path; never a wildcard.
- R-D7 (MED): tmux bootstrap interpolates the raw request into a single-quoted shell string. NOT FULLY FIXABLE (synced boilerplate is suite-wide); mitigation added in Core Rules — escape single quotes before interpolation.
- R-D8 (low-med): CHALLENGE/JUDGE dispatches never mandate read-only. RESOLVED: read-only + return-text discipline stated in CHALLENGE and JUDGE.
- R-D9 (low-med): "never executes repo code" stated only in Activation Boundary. RESOLVED: restated in Core Rules/Write Discipline and RESEARCH dispatch text.
- R-D10 (low): repo-instruction precedence never enforced positively. RESOLVED: Core Rule added — researched-repo instructions never override the skill's write discipline, read-only policy, or no-execution rule; carried in subagent prompts.
- R-D11 (MED): VERIFY budget can override the protected-state hard stop. RESOLVED: protected-state failures and critical-incident checks are excluded from the VERIFY budget; they always hard-stop and surface.
- R-D12 (low): seed references R8 "discussed, not separately retrieved" — violates the retrieval contract; `<research-slug>` vs `<slug>` inconsistency. RESOLVED: R8 dropped from the seed's References; placeholder unified to `<slug>`.

## Findings E — Executability

- R-E1 (HIGH): clarification opt-in mechanism never specified. RESOLVED: flag is ON iff the invocation says "ask questions"/"clarify first" or an explicit `--clarify` marker; otherwise OFF.
- R-E2 (HIGH): QUICK pipeline shape indeterminate. RESOLVED: exact QUICK chain stated (primary-led RESEARCH/CHALLENGE/JUDGE with recorded independence caveat; REMEDIATE folded into primary synthesis; VERIFY and SAVED as written).
- R-E3 (HIGH): state sections mandate subagent dispatch with no QUICK carve-out. RESOLVED: per-state head-notes "QUICK performs this step primary-led; no dispatch."
- R-E4 (HIGH): "distinct" in the VERIFY budget undefined. RESOLVED: distinct failure = a unique gate-check class (citation-accuracy, render, coverage, protected-state); repeated instances within a class count once per VERIFY pass; the counter does not reset across cycle-backs.
- R-E5 (HIGH): verdict vocabularies conflict; Key Findings demand verdicts before VERIFY. RESOLVED: one vocabulary (supported / partially-supported / not-supported / unverifiable); draft Key Findings carry provisional verdicts confirmed at VERIFY.
- R-E6 (HIGH): judge rubric has no fail threshold. RESOLVED: dimension fails at < 0.7; overall pass iff all four pass; pass/fail derivation stated.
- R-E7 (HIGH): "never mutates the researched repository" contradicts the allowlisted save. RESOLVED: carve-out — "never mutates the researched repository except creating the single allowlisted research document."
- R-E8 (MED): resume location underspecified. RESOLVED: glob `.agents/research/*-<slug>-research.md`; most recently dated is the resume candidate; none -> scaffold new; slug = goal-slug.
- R-E9 (MED): "tmux missing" indistinguishable from "not in tmux". RESOLVED: detect with `command -v tmux` first, then the TMUX-env/display-message test.
- R-E10 (MED): goal-slug derivation not an algorithm. RESOLVED: slug = request lowercased/hyphenated; reuse the session slug when already inside a csm-deep-research session; `tmux has-session` collision -> `-2`/`-3`.
- R-E11 (MED): QUICK "1 track" conflicts with primary-led. RESOLVED: "QUICK: 1 primary-led track; the dispatch rule applies to STANDARD/DEEP only."
- R-E12 (MED): challenger-view boundaries imprecise; source mode not extended to critics. RESOLVED: source bundle defined (quoted snippet + limited context); critics inherit the run's source mode.
- R-E13 (MED): suggest_new_claim maps to no cycle edge. RESOLVED: suggest_new_claim -> SYNTHESIZE (re-synthesize to add the claim).
- R-E14 (MED): Key Findings citation shape contradicts References `[Rn]` rule. RESOLVED: inline `[Rn]` used in K-entries and body; the URL + retrieval date live in References.
- R-E15 (MED): STANDARD display unstated. RESOLVED (with R-C3): QUICK summary; STANDARD summary plus Key Findings and Recommendation; DEEP full document.
- R-E16 (MED): "first line" marker claim contradicts the seed's `---` frontmatter. RESOLVED: seed standardized to the bare marker form (mirrors the template exactly); prose kept.
- R-E17 (MED): researcher return shape is a field list, not a contract. RESOLVED: concrete return template pinned ("per claim: quote — URL — retrieved <date> — confidence (high/medium/low)").
- R-E18 (LOW): "flagged as unverifiable at intake" misuses INTAKE. RESOLVED: reworded to "at evidence-pack assembly by the primary."
- R-E19 (LOW): protected-state re-run described twice ambiguously. RESOLVED: re-run once at VERIFY; SAVED re-reads that result.
- R-E20 (LOW): "parked open questions" undefined. RESOLVED: defined as clarification-time + resilience-ladder step-4 outputs recorded in the process appendix.
- R-E21 (LOW): journal format not cross-referenced at scaffold creation; `<slug>` vs `<goal-slug>`. RESOLVED: INTAKE references the journal format section; slug = goal-slug stated.
- R-E22 (LOW): "exactly 8 H2 sections / only these headings" stricter than the subsequence gate. RESOLVED: prose aligned to the gate (headings in order, matching the template sequence).

## Verification After Remediation

- `node scripts/check-suite.mjs`: EXIT 0 — "OK — 9 skills, <N> checks".
- `node scripts/sync-skill-boilerplate.mjs --check`: OK — no drift.
- `node scripts/gen-readme-matrix.mjs --check`: OK — region matches contracts.
- Bootstrap suites + resume-semantics: 10/10 pass.
- `make lint`: clean (when oxlint present).
- `diff -rq bootstrap/package/payload/skills/csm-deep-research csm-deep-research`: clean.
- `git status --porcelain`: only the intended file set.
