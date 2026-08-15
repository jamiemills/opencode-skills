# csm-review Skill Review — 2026-08-15

- Date: 2026-08-15
- Scope: `csm-review/SKILL.md` (291 lines, post-repair) + `README.md` wiring, built under plan `csm-review-skill` (cycle 1)
- Method: five independent fresh-eyes hostile review passes (a)–(e), dispatched in parallel by the primary; findings numbered R-1… per pass; primary triaged all findings and repaired the skill; this document records the per-pass verdicts and the disposition of every finding.
- Verdict convention: PASS / PARTIAL / FAIL per pass.

## Per-pass verdicts

| Pass | Focus | Initial verdict | After repair |
|---|---|---|---|
| (a) Conformance | house skeleton, boundary, invariant | PASS (6 minor/nit findings) | PASS — all resolved |
| (b) Coverage | C1–C14 → dimensions, anchors | PARTIAL (1 high, 3 medium, 2 low) | PASS — all resolved |
| (c) CSM integrity | 3-scenario state-machine walk | PARTIAL (2 major, 4 minor, 2 nit) | PASS — all resolved |
| (d) Safety | posture, sandbox, redaction | FAIL (1 critical, 3 major, 6 minor, 1 nit) | PASS — all resolved |
| (e) Executability | fresh-agent runnability | FAIL (3 critical, 4 major, 7 minor/nit) | PASS — all resolved |

## Finding disposition (45 findings; all accepted and fixed)

### Pass (a) Conformance — 6 findings
- R-1 (minor): boundary bullet omitted csm-grill/csm-bdd-tdd and used "automatically" — now "never invokes csm-plan, csm-build, csm-bdd-tdd, csm-scan, or csm-grill" (Activation Boundary).
- R-2 (minor): dangling "researchers" subagent role — removed from Core Rules (finders and challengers only).
- R-3 (minor): QUICK critical/high challenge rule undefined — "Challenge assignment" block added to Scale To The Ask.
- R-4 (minor): containment check vs report-scaffold write — monitored-locations check now exempts the report scaffold explicitly.
- R-5 (nit): report-format headings rendered as ` # ` — now `## ` without leading spaces.
- R-6 (nit): "import csm-scan's exclusion list" lossy/nonexistent artifact — exclusion list inlined in Snippet policy.

### Pass (b) Coverage — 6 findings
- R-1 (high): D14 named only 6/8 test types — now literally names unit, integration, e2e, performance/load, property-based, mutation, fuzz, security testing with anchors.
- R-2 (medium): anchor verification not operationalized — EVIDENCE step 2 + VERIFY gate item (editions, reachability spot-check).
- R-3 (medium): rot-prone counts ("464 products", "11 classes", "~21 smells") — replaced with "current catalog"/"taxonomy"; verification instruction retained.
- R-4 (medium): inconsistent editions — ISO/IEC 25010:2023 and ASVS v5.0.0 applied uniformly.
- R-5 (low): C9 non-vulnerable-EOL libraries unanchored — D15 extended (unmaintained/deprecated advisories, library EOL/maintenance status).
- R-6 (low): D18 licensing unanchored — SPDX license list added.

### Pass (c) CSM integrity — 8 findings
- R-1 (major): per-finding cycle cap made the CHALLENGE→FIND cascade unbounded — cap now global (one further round per run; beyond that primary adjudicates with confidence capped at medium); adversarial cycle defined (one FIND→CHALLENGE traversal; VERIFY re-challenges count).
- R-2 (major): no termination for VERIFY loop — VERIFY budget: ≤3 distinct failures, then caveat and proceed to SAVED.
- R-3 (minor): CHALLENGE exit unsatisfiable when challenge unavailable — exit amended ("verdict or explicitly caveated challenge-unavailable/primary-led record").
- R-4 (minor): no Entry conditions while Done Criteria claims "entry and exit" — Entry: line added to all 9 states.
- R-5 (minor): "SAVED is the terminal state" contradicted STOP — reworded "SAVED is the final state: display … and stop".
- R-6 (minor): cycle-back re-entry semantics undefined — cycle-back resumes linear flow, only the triggering artifact re-collected.
- R-7 (nit): exits don't enumerate failure transitions — note added ("per-state exits describe the happy path; failure exits governed by cycle rules").
- R-8 (nit): "adversarial cycle" undefined — defined in termination rules.

### Pass (d) Safety — 11 findings
- R-1 (critical): "Obey the reviewed repository's instructions" = prompt-injection vector on untrusted repos — replaced with untrusted-hints clause; repo instructions never override the safety posture; malicious requests recorded as findings.
- R-2 (major): R3 sandbox has no OS isolation — R3 disclosed as best-effort isolation (no host-FS confinement), bubblewrap/landlock preferred, non-execution fallback for suspicious repos, residual risk in Methodology.
- R-3 (major): env redirect doesn't scrub credentials/SSH_AUTH_SOCK — Env scrub rule (R1–R3) with strip list and containment-check verification.
- R-4 (major): redaction ran only at VERIFY, after challengers received raw files — primary redaction gate at FIND→CHALLENGE boundary; VERIFY redaction pass extended to challenges[]/dissents[].
- R-5 (minor): egress mechanism not verified engaged — pre-run in-sandbox connectivity probe; failed probe = "no mechanism" + disclosure.
- R-6 (minor): time bounds R3-only — every process at any rung time-bounded and terminated within the step.
- R-7 (minor): "only writes are the report" vs SAVED commit — restated "no source-file modifications; the only file added and committed is the report".
- R-8 (minor): sandbox recipe npm/pip-only — per-ecosystem guard (no scripts-disabled equivalent → do not run that step; degrade to R0).
- R-9 (minor): R2 `--collect-only` executes repo code — R3 protections (egress, scrub, time bounds) apply at R2; disclosed.
- R-10 (minor): confidence cap without severity caveat readability — caveat required in the finding record AND residual unknowns.
- R-11 (nit): sandbox dir world-readable — `umask 077` / mode 700.

### Pass (e) Executability — 14 findings
- R-1 (critical): "evidence-pack slice" undefined — slice definition added (dimension-group-tagged artifacts + chunk file map).
- R-2 (critical): no resume path — INTAKE pre-step: read existing report Control journal, restore state, continue; no re-scaffold.
- R-3 (critical): challenge assignment undefined for QUICK medium/critical — "Challenge assignment" block in Scale To The Ask (critical/high always independent; medium independent in FULL, primary-led-with-caveat in QUICK; low/info primary-led with caveat).
- R-4 (major): evidence-class → required-fields matrix missing — added in VERIFY (E1: +verification; E2: +challenges[] ≥1; E3: +static citation; E4: +label; core fields listed).
- R-5 (major): chunking undefined — chunk rule added (one per top-level module, merged under ~40 files, cap 24 chunks, ≈16k token budget, excess → Anti-Coverage).
- R-6 (major): QUICK finder count unspecified — one finder per named dimension (group finder when none named).
- R-7 (major): sort_key circular (confidence 1:1 with class) — ranks numbered explicitly (verified=3…low=0; E1=3…E4=0; class breaks ties after corroboration bump).
- R-8 (minor): dangling "researchers" — removed (same as a-R-2).
- R-9 (minor): "import csm-scan's exclusion list" nonexistent artifact — inlined (same as a-R-6).
- R-10 (minor): run-id undefined — `%Y%m%d%H%M%S-<repo-slug>`, recorded in Control journal + Methodology.
- R-11 (minor): template headings leading-space — fixed to `## ` (same as a-R-5).
- R-12 (minor): R1–R3 offer mechanic undefined; remote clones excluded — rung menu at INTAKE (silence = R0); remote clones R0 unless user opts into sandboxed R1+.
- R-13 (minor): "residual unknowns"/evidence artifacts have no report section — folded into Methodology Disclosure / Reproducibility.
- R-14 (nit): Control journal entry format undefined — `[<timestamp>] <From> -> <To> :: cycle <n> :: trigger: <reason> :: rungs: <r>`.

## Regression evidence

- T001 acceptance gate re-run post-repair: GATE-PASS (exit 0); 291 lines (200–340); 9 state subsections; D14 literal test-type list present.
- Spot greps for every critical/major fix: all present (untrusted hints, SSH_AUTH_SOCK scrub, best-effort isolation, redaction gate, global cycle cap, VERIFY budget, Entry: ×9, evidence-pack slice, resume, challenge assignment, 24-chunk cap, ranked sort_key, inlined exclusions, connectivity probe).
- README gate unchanged and passing (README not re-touched by repair).

## Verdict: PASS (after repair)
