---
name: csm-review
description: Review or audit a repository for issues, defects, technical debt, poor practices, bad patterns, unsafe code, test adequacy, outdated dependencies, race conditions, CVEs — as a multi-agent adversarial review run as a cyclic state machine that produces a single dated findings report; use when the user asks to review, audit, or assess a repository (or invokes csm-review by name). Review-only: never fixes reviewed code, never invokes other skills; ends at a saved report.
---

# CSM Review

csm-review judges what is wrong with a repository; csm-scan inventories what is there. Multi-agent adversarial review as a cyclic state machine producing a single dated findings report. Every finding is evidence-grounded at a pinned commit, independently challenged where its severity demands it, and recorded with severity and confidence kept strictly apart. The report is findings plus remediation sketches — never a plan and never patches.

## Activation Boundary

- Activate when the user explicitly asks to review, audit, or assess a repository (or invokes csm-review by name).
- Target intake: a local repository path or the current working directory. A remote URL is cloned `--depth 1` into the sandbox at INTAKE and the clone becomes the pinned citation source.
- Review-only: never fixes reviewed code, never generates patches, and never invokes csm-plan, csm-build, or csm-scan automatically.
- The report is findings plus remediation sketches, not a plan.
- `SAVED` is the terminal state: display the complete report, the saved path, the commit hash or skip reason, and stop — never ask whether to start fixing.

## Core Rules

- The primary agent owns orchestration, adjudication, and the VERIFY gate. Subagents are finders, challengers, and researchers with bounded context; they never decide the global state.
- Maximize parallelism with non-overlapping dimension/file ownership: one finder per dimension×chunk, independent challengers never assigned the work they judge.
- Every finding must be evidence-grounded: its citation must resolve at the pinned commit. A finding whose citation does not resolve is retracted, not reported.
- Severity assumes the finding is true; confidence carries the probability that it is true. Never blend them.
- Never quote secret values: redact credentials, personal data, and absolute paths everywhere in the report.
- The only writes to the reviewed repo are the report file.
- Obey the reviewed repository's instructions.
- Findings use neutral professional language — criticism targets code, never people.

## Scale To The Ask

- **QUICK pass**: focused dimensions named by the user, a single finder batch, and primary-led challenge for low/info findings. Use for a fast, scoped look.
- **FULL audit**: all 18 dimensions, sandbox rungs where safe, and independent challenge for every critical/high/medium finding. Use for the deep, complete review.
- In both scales, low/info findings may receive primary-led challenge with a recorded independence caveat.
- Proportionality reduces depth, never the required structure: every report still carries methodology, coverage, anti-coverage, and the findings model.

## Execution Posture And Safety

Every finding and every verification records the rung it ran at. Posture is selected at INTAKE: R0 always; R1–R3 are offered when the repo is local and the user has not declined.

- **R0 `static`** (default, always): read-only inspection at the pinned SHA; OSV querybatch + endoflife.date GET (auth-free).
- **R1 `sandbox-static-verified`**: fresh sandbox `/tmp/opencode/csm-review-<run-id>/`; `git clone --depth 1` (file:// for local; never `--recurse-submodules`); redirect HOME/TMPDIR/XDG_* into the sandbox; scripts-disabled installs (`npm --ignore-scripts`, `pip --only-binary :all:`, prefer lockfile static resolution). A build failure caused by disabled scripts is a finding-input, not an error — degrade to R0 labels.
- **R2 `sandbox-collected`**: dependency audits (npm/pip-audit/cargo audit lockfile/no-fetch modes), test inventory (`--collect-only`), and go vet-class static checks inside the sandbox.
- **R3 `sandbox-executed`**: bounded test run, coverage, `-race`/TSan where cheap, and mutation dry-run/mini-run (Stryker `--dry-run` first; hard caps on mutants and wall time). Egress rule: block network egress during execution where a mechanism exists (`unshare -rn`, or container `--network none`); when no mechanism exists, select tests that avoid the network and disclose the residual egress risk in Methodology. Every process is time-bounded and terminated within the step.
- **X forbidden** (always): in-place runs against the reviewed repo; fix/upgrade/mutating package-manager commands; sudo/daemons; contacting production services; running anything from the reviewed repo outside the sandbox.
- **Containment check** required after every R1–R3 step: post-run `git -C <sandbox-clone> status --short` must be clean-or-explained; no writes detected in monitored locations (reviewed-repo git status, sandbox parent, redirected env paths); results disclosed in Methodology.

## Review State Machine

`INTAKE -> SCOPE -> EVIDENCE -> FIND -> CHALLENGE -> ADJUDICATE -> VERIFY -> SAVED -> STOP`

Cycle rules — the machine is cyclic, not linear:

- CHALLENGE -> FIND when a challenge surfaces brand-new findings (bounded below).
- CHALLENGE -> EVIDENCE when verification needs a tool run or an external query.
- ADJUDICATE -> EVIDENCE when evidence is missing; ADJUDICATE -> FIND when dedup reveals an unreviewed seam.
- VERIFY -> CHALLENGE on challenge-coverage gaps; VERIFY -> ADJUDICATE on schema/redaction/sort failures; VERIFY -> FIND on coverage-matrix gaps; VERIFY -> SCOPE when the coverage plan itself is wrong.
- SAVED only from VERIFY.

Adversarial cycle cap (termination rule): challenge-discovered findings enter at most one further FIND→CHALLENGE round. Total adversarial cycles per finding ≤ 2; beyond the cap the primary adjudicates with confidence capped at medium and a recorded "adversarially exhausted" caveat.

Record every transition in the report's embedded Control journal before proceeding.

### 1. INTAKE

1. Classify QUICK vs FULL and resolve the target: local path or cwd, or a remote URL cloned `--depth 1` into the sandbox.
2. Decide the posture (default R0; offer R1–R3 when the repo is local and the user has not declined) and detect/validate NORMS.md.
3. Pin the commit SHA. All evidence cites it; if the worktree is dirty or diverged, citations come from `git show <SHA>:<path>` / `git grep <pattern> <SHA>` rather than the worktree.
4. Create the report scaffold with the Control journal at `.agents/reviews/<yyyy-mm-dd>-<repo-slug>-review.md` (git root of the reviewed repo, else cwd; create only this directory and file).

Exit: repo pinned, scale set, report scaffold written.

### 2. SCOPE

1. Enumerate the review surfaces: tree, manifests, CI, docs.
2. Partition large repos into chunks by module/domain with per-chunk context budgets.
3. Assign the 18 dimensions to finder agents with non-overlapping primary ownership.
4. Record the coverage plan AND the anti-coverage draft (vendored/generated code, binaries, docs-only dirs, time-boxed-out areas — each with a risk note).

Exit: dimension×chunk assignment matrix + anti-coverage draft recorded.

### 3. EVIDENCE

1. Gather rung-appropriate shared evidence: R0 static facts (manifest/lockfile inventory, test inventory, CI inventory); OSV querybatch per pinned dependency and endoflife.date per declared runtime; optional R1–R3 sandbox runs.
2. Record every artifact with its command, inputs, result, and containment evidence.
3. Label unavailable evidence with its degradation (e.g., a build that cannot complete under disabled scripts degrades to R0 labels).

Exit: shared evidence pack recorded; unavailable evidence labeled with its degradation.

### 4. FIND

1. Dispatch parallel finder agents, one per dimension×chunk.
2. Each receives: the dimension's anchor list, the evidence-pack slice, its chunk map, the finding-record schema, and two instructions — walk the anchors systematically AND propose issues the anchors don't name (dual pathway).
3. Findings return with locations, snippet (redaction rule), anchor ref or null, proposed severity+confidence, and impact reasoning.
4. Finders never write the report; they return structured findings to the primary.

Exit: raw findings ledger complete.

### 5. CHALLENGE

1. For every critical/high/medium finding (FULL) and as capacity allows elsewhere, dispatch an independent challenger agent — never the finding's author.
2. The challenger receives only the challenger view: title, dimension, anchor_ref, locations, quoted_snippet, proposed severity+confidence — deliberately NOT the finder's explanation/impact rationale, to avoid anchoring — plus the cited files at the pinned SHA.
3. The challenger attempts disproof: re-locate the citation; check reachability/exploitability against actual call sites; look for mitigations the finder missed; check anchor applicability. Verdict: agree / downgrade (proposed severity+confidence) / retract, each with rationale.
4. Dissents are recorded verbatim. Low/info findings may receive primary-led challenge with a recorded independence caveat.

Exit: every in-scope finding carries ≥1 challenge verdict.

### 6. ADJUDICATE

1. Primary-only. Two-stage dedup: (1) fingerprint = repo ‖ normalized path ‖ symbol/category ‖ anchor (no line numbers); (2) semantic merge of same-root-cause findings — union locations, keep best evidence class, record merged_from, increment corroborators.
2. Independent discovery by ≥2 finders raises confidence one band (E3→high, E4→medium) — the sole confidence-raise path not requiring E1, applied only here by the primary.
3. Apply challenge verdicts: status upheld/downgraded/retracted with adjudication rationale. Severity is never averaged or summed across merges.
4. Order the ledger by sort key.

Exit: adjudicated findings ledger + adjudication log complete.

### 7. VERIFY

The primary-personal gate, never delegated. Verify that:

- every finding has all schema fields required for its evidence class;
- every critical/high finding is E2+ (independently challenged) or explicitly caveated;
- the coverage matrix is filled (every dimension×chunk has a finding-or-clean verdict);
- anti-coverage is honest;
- a redaction pass ran over every snippet and verification output;
- the report renders per format;
- methodology discloses reviewers, tools, versions, timestamps, rungs used, containment results.

Cycle back per the cycle rules on failure.

Exit: report passes all gate checks.

### 8. SAVED

1. Finalize the report file.
2. Unless the user declined, commit it in a single commit staging only the report; skip with a note if the directory is not a git repo.
3. Display the complete report plus saved path, commit hash or skip reason, posture rungs achieved, and residual unknowns.
4. Then stop. Never invoke another skill; the report's How-To-Execute note states that remediation happens through a future explicit csm-plan or csm-grill invocation.

Exit: report saved and displayed; session stopped.

### 9. STOP

- No further transitions, no fixing, no follow-up work. The review ends at the saved report.

Exit: terminal; nothing executes after STOP.

## Review Dimensions

| # | Dimension | Covers | Anchor(s) (verify at review time; cite editions) |
|---|---|---|---|
| 1 | Correctness & defects | functional bugs, wrong outputs, logic errors | Google eng-practices Functionality; ISO/IEC 25010:2023 functional suitability |
| 2 | Technical debt & architecture | structural decay, coupling, architecture erosion | Fowler TechnicalDebtQuadrant; ISO/IEC 25010 maintainability |
| 3 | Code smells & poor practices | localized smell patterns | SonarSource concepts docs (docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/concepts.md); Fowler Refactoring catalog |
| 4 | Anti-patterns | structural anti-patterns, needless complexity | eng-practices Design/Complexity + per-stack framework docs |
| 5 | Security implementation weaknesses | concrete security defects in code | OWASP Top 10:2025; CWE Top 25 (2025); CWE id per finding |
| 6 | Security control verification | control presence/strength | OWASP ASVS v5.0.0 (per-requirement pass/fail) |
| 7 | Secrets & data exposure | hardcoded secrets, data leaks | CWE-798; ASVS v5 crypto/logging chapters; gitleaks-style rule families |
| 8 | Concurrency & races | data races, deadlocks, atomicity | TSan wiki DetectableBugs (11 classes); Go race detector + memory model; CWE-362/367/609/667 |
| 9 | Memory & resource safety | memory errors, resource leaks | Sanitizers wiki ASan/MSan; CWE-416/476/401 |
| 10 | Error handling & resilience | failure handling, recovery | ISO/IEC 25010 reliability |
| 11 | Input validation & trust boundaries | unvalidated input, boundary confusion | ASVS validation/encoding chapters; CWE-20 |
| 12 | Test presence & coverage | what is tested, what is not | Fowler TestCoverage (coverage as heuristic, not target); per-module uncovered critical paths |
| 13 | Test quality | test smells, flakiness, weak assertions | testsmells.github.io catalog (~21 smells); Google flaky-tests post (2016) |
| 14 | Test-type adequacy | right test types at right levels | Google Test Sizes S/M/L (integration/e2e/performance-Large); ISTQB CTFL v4.0 levels/types; PIT/Stryker/mutmut (mutation); hypothesis/fast-check (property); fuzz via OSS-Fuzz advisories in OSV |
| 15 | Dependency vulnerabilities | known vulnerable deps | OSV.dev API (querybatch); CISA KEV via CWE KEV list |
| 16 | Toolchain & language currency | outdated runtimes/toolchains | endoflife.date API (464 products); declared runtimes/toolchains vs EOL |
| 17 | Observability & operability | monitoring, tracing, operations | ISO/IEC 25010 operability; instrumentation inventory |
| 18 | CI, build, docs & licensing | pipeline, build, docs hygiene, licenses | SonarSource quality-gate concepts; eng-practices Documentation; license-hygiene inventory |

Dimensions group for finder assignment: quality (1–4), security (5–7, 9, 11), concurrency (8), resilience (10), tests (12–14), supply chain (15–16), operations (17–18).

## Finding Record

**Severity spine**: critical/high/medium/low/info (rank 4–0). CVSS v4.0 CVSS-B overlay (score AND vector AND assumptions[], FIRST disclosure rule; worst-case per library guidance with re-score-per-call-site note) applies to dependency/CVE findings and tool-verified exploitation findings; other security findings use the spine alone unless the primary justifies a vector with explicit assumptions.

**Confidence** is anchored to evidence class, orthogonal to severity:

- `verified` (E1): deterministic tool reproduces — analyzer output, failing test, live OSV match.
- `high` (E2): ≥1 independent challenger agreed.
- `medium` (E3): cited static evidence at the pinned SHA, challenged only by the primary or unchallenged.
- `low` (E4): reasoned judgment; labeled as such.

Confidence may never exceed its evidence class; the sole exception is the ADJUDICATE corroboration bump (independent discovery by ≥2 finders: E3→high, E4→medium; never to verified without E1).

**Fields**:

- `id` (F-### sequence)
- `title` (≤120 chars)
- `dimension`
- `category`
- `anchor_ref` (CWE/OWASP/ASVS id or null)
- `severity` + `cvss{}` where applicable
- `confidence` + `evidence_class`
- `locations[]` (file:line, primary first)
- `quoted_snippet[]`
- `commit_sha`
- `explanation` (2–6 sentences)
- `impact`
- `remediation_sketch` (approach-level, not a patch)
- `verification{method,command,result}|null` (required for E1)
- `challenges[]` (verdict + rationale)
- `dissents[]`
- `status` (upheld/downgraded/retracted) + `status_note`
- `corroborators[]`
- `sort_key` = (severity rank DESC, confidence rank DESC, evidence class DESC tie-break, id ASC)

**Snippet policy**: verbatim from the pinned SHA; ≤5 lines, ≤200 chars, ≤3 per finding; secret-bearing lines replaced with `[REDACTED:<type>]`. The report never contains raw credential values, personal data, or absolute paths (import csm-scan's exclusion list: emails, personal names, raw identities, absolute paths, URL credentials, secrets).

**Dedup**: stage 1 fingerprint (repo ‖ normalized path ‖ symbol/category ‖ anchor; no line numbers); stage 2 semantic merge (union locations, best evidence class wins, merged_from recorded); cross-dimension clusters stay split.

## Report Format

```markdown
# Repository Review — <repo> @ <short-sha> (<date>)
 # Control (embedded journal: state, cycle, posture rungs, next transition; updated every transition)
 # How To Execute (remediation via future explicit csm-plan/csm-grill invocations; this report fixes nothing)
 # Executive Summary (3–6 bullets: top upheld findings, systemic themes, overall posture sentence)
 # Methodology Disclosure (reviewers, dimensions, tools+versions, rungs used, containment results, egress disclosure, timestamps, dedup method, anchor editions)
 # Coverage (dimension × chunk matrix with finding-or-clean verdicts)
 # Anti-Coverage (what was NOT reviewed and why, each with risk note — mandatory, never omitted)
 # Findings Summary (counts by severity × dimension; confidence distribution; dedup stats raw → upheld)
 # Findings (adjudicated records per schema, ordered by sort_key; each with challenges + dissents + status)
 # Adjudication Log (every downgrade/retraction with rationale)
 # Retracted Findings (kept visible with disproof evidence)
 # Reproducibility (pinned SHA, commands, tool versions, sandbox paths)
```

## NORMS.md

NORMS.md is an optional input. Detection order: user-explicit → `<git-root>/NORMS.md` → `<cwd>/NORMS.md`. Authenticity markers: "Generated by csm-scan" OR "## Repository Overview" + Code Conventions + Architecture sections. Flag staleness beyond 30 days. Consume as hints to re-verify: every NORMS.md claim used by a finding is verified against the repo before the finding reaches CHALLENGE. NORMS.md/finding contradictions become findings. Absent or inauthentic NORMS.md never blocks.

## Subagent Resilience

Fallback ladder — journal every incident, never silently:

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. Primary completion (evidence gathering) / primary-led challenge (low/info findings only, recorded independence caveat).

Critical/high/medium findings never bypass independent challenge because of subagent failure — keep retrying, or cap the finding's confidence at medium with a recorded "challenge unavailable" caveat surfaced in residual unknowns.

## Anti-Patterns

- Prose-essay findings instead of structured records.
- Finder = challenger (no self-review).
- Severity-confidence blending.
- Quoting secrets.
- Silent skips (no anti-coverage).
- Trusting NORMS.md claims unverified.
- Averaging severity across merges.
- Running target-repo code in place.
- Dismissing dissents without reasoning.

## Done Criteria

- All 9 states have entry/exit.
- Cycle rules + cap defined.
- 18 dimensions with anchors.
- Findings model complete.
- Report format fixed.
- Posture/safety rules complete.
- Review-only boundary held.
- Subagent ladder defined.
