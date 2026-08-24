format: csm-deep-research/1

# Improving The CSM Deep Research Skill Research Finding

## TL;DR

Improve the skill by formalizing the strongest practices already demonstrated in the Headless 360 work: atomic claim registers, two-axis evidence labels, source-interest metadata, dated maturity tables, benefit-condition-measure framing, contradiction ledgers, and decision gates. Keep the existing state machine, independent challenge, verification, uncertainty register, and write discipline.[R1][R2]

Do not make every report equally elaborate. Use a compact default for narrow questions and activate the richer schemas only when the research involves products, procurement, architecture, changing status, vendor claims, or material decisions.[R3][R4]

## Executive Summary

The current skill is strong at controlling the research process, but weaker at enforcing the presentation and reasoning patterns that made the Headless 360 comparison useful. Its main gap is not insufficient skepticism; it is that client-useful behaviors remain optional prose craft.

```text
Question -> Atomic claims -> Role-aware evidence -> Status and scope
        -> Synthesis -> Adversarial challenge -> Decision gates
        -> Verified finding with uncertainty and traceable citations
```

The existing contract already provides progressive disclosure, independent researcher/challenger/judge roles, a fixed finding shape, claim verdict vocabulary, URL-plus-date citations, remediation, protected-state checks, and optional low-noise progress indicators.[R1] The Headless 360 case shows that the skill can produce a clear executive model and useful recommendation, but also exposes recurring weaknesses: compound claims, bundled references, implicit source bias, distributed availability data, capability-to-outcome slippage, and recommendations without explicit thresholds.[R2]

The recommended change is a layered evidence contract. Every material claim should identify what it asserts, its exact scope, source posture, maturity, and confidence. Product or architecture research should add status and decision tables. Benefit claims should state conditions and measures. Contradictions and unknowns should become inspectable ledgers rather than only narrative caveats. Progress indicators should remain workflow telemetry, explicitly separate from confidence or truth.[R5][R6]

## Key Findings

1. **Supported:** The current skill has strong process and epistemic controls, but its client-facing evidence structures are under-specified; the highest-value improvements are formalizing behaviors already demonstrated in the Headless 360 finding.[R1][R2]
2. **Supported:** Atomic claims and claim-to-source mappings are needed because compound findings can receive citations that support only part of the sentence.[R1][R2][R7]
3. **Supported:** Evidence status and source posture must be separate dimensions; “supported by a vendor source” is not equivalent to independently validated.[R2][R7]
4. **Supported:** Product and technical research needs time-indexed maturity/status data, including version, edition, region, lifecycle state, and as-of date.[R2][R8]
5. **Supported:** Benefits should be expressed as `benefit -> condition -> evidence -> measure -> trade-off`, preventing capability claims from becoming unsupported ROI claims.[R2][R7][R9]
6. **Supported:** Recommendations become more useful when they include fit, avoid/defer conditions, validation gates, metrics, ownership, and cost of error.[R2][R9]
7. **Supported:** Contradiction and uncertainty ledgers improve auditability and decision focus compared with a long undifferentiated caveat list.[R2][R7][R9]
8. **Supported:** The optional progress contract is low-noise and safe, but its percentage must be explicitly defined as workflow completion, never evidentiary confidence.[R1][R5]
9. **Partially-supported:** Richer schemas should be conditional by question type and risk; forcing every QUICK finding to contain every table would increase ceremony without proportional analytical value.[R3][R4]

## Detail Sections

**1. Preserve the process foundation.** The skill’s existing state machine, role separation, challenge/judge independence, tiering, verification gate, protected-state check, and fixed progressive-disclosure skeleton should remain. These controls prevent a polished executive format from replacing evidence discipline.[R1] The improvement target is the boundary between evidence collection and reader-facing synthesis, not a wholesale redesign of the orchestration model.

**2. Add an atomic claim register.** Define an atomic claim as one independently falsifiable proposition with explicit subject, scope, time, population or configuration, claim type, and falsifier. A claim should be tagged as capability, mechanism, condition, observed outcome, projected outcome, causal claim, or recommendation. Compound statements should split when their parts differ in source, product, lifecycle, or confidence.[R1][R7]

Recommended shape:

```text
C12 | Claim: HXL is available for this surface
Scope: product, edition, region, date, interface
Type: maturity/status
Evidence required: current release or product source
Falsifier: current documentation says unavailable
```

This directly addresses the Headless 360 finding’s compound architecture statements and prevents one citation cluster from appearing to validate APIs, MCP, CLI, HXL, and security simultaneously.[R2]

**3. Separate evidence status from source posture.** Keep the existing verdicts (`supported`, `partially-supported`, `not-supported`, `unverifiable`) but add source posture: vendor documentation, vendor-reported customer outcome, customer-controlled evidence, independent technical analysis, empirical measurement, methodological authority, or inference. Also record independence, access status, and the exact scope the source can support.[R2][R7]

Example:

```text
Verdict: Supported for feature existence
Source posture: Vendor documentation only
Not established: independent production performance or ROI
```

This prevents six vendor pages repeating one assertion from being mistaken for six independent confirmations. Source appraisal should be domain-based rather than reduced to one undifferentiated quality score.[R7]

**4. Add a status and maturity table for changing subjects.** Any research containing availability, rollout, version, entitlement, standardization, or maturity claims should include:

| Capability | Lifecycle/status | Scope and as-of date | Evidence posture | Verification action |
|---|---|---|---|---|
| Named capability | Preview, beta, GA, deprecated, unknown | Edition, region, version, date | Vendor or independent | Exact next check |

Separate technical maturity, evidence strength, product fit, operational readiness, and recommendation. A GA label can establish vendor-declared availability without proving production readiness, feature parity, or universal entitlement.[R2][R8]

**5. Pair benefits with conditions and measures.** When a report discusses benefits, require the following chain:

```text
Benefit -> Required condition -> Evidence -> Validation measure -> Trade-off
```

For example, “faster delivery” requires a reusable capability boundary, suitable engineering skills, working integrations, and release automation; it should be measured against a baseline and comparator. Feature existence alone should never establish lower cost, productivity, speed, conversion, or causal business impact.[R2][R7][R9]

**6. Make contradictions inspectable.** Synthesis should maintain an optional contradiction ledger when sources disagree or when a subject has an ambiguous boundary:

| Claim/question | Position A | Position B | Scope difference | Resolution | Residual uncertainty |
|---|---|---|---|---|---|

This would make the Headless 360 tensions visible: “not a new product” versus platform/trial language; preview versus later GA; HXL conceptual role versus beta implementation; inherited governance versus client-owned integration security.[R2] The ledger should not manufacture symmetry between a primary source and a weak assertion; it should record why one source has greater authority or why the disagreement remains open.

**7. Upgrade recommendations into decision gates.** Preserve the direct recommendation, confidence, changing conditions, and cost-of-error requirements. Add a compact decision matrix:

```text
Recommend when: fit conditions are met
Pilot when: mechanism is plausible but outcomes are unproven
Defer when: decision-blocking unknowns remain
Avoid when: prerequisites or economics fail
Validation gates: test, owner, metric, threshold, rollback condition
```

This turns “validate pricing, security, limits, and TCO” into an executable decision boundary without turning the research document into an implementation plan.[R2][R9]

**8. Prioritize unverified claims.** Keep the required `Unverified Claims` section, but classify each item as decision-blocking, material risk, context-dependent, or informational. Include owner, verification cost, deadline or trigger, and whether the recommendation changes if the claim fails. The current skill requires an exact verification step, but not priority; a long list can otherwise become a parking lot.[R1][R2]

**9. Improve reference ergonomics.** Keep URL and retrieval date, but prefer one direct source per reference ID. Add publisher, publication/update date, version or edition, access status, retrieval method, and a short supporting passage or section locator where possible. Grouped source families may remain in a separate bibliography, but claim-level citations should resolve to one inspectable source. “Traceably cited” is more defensible than implying that citation count proves exhaustive research.[R1][R7]

**10. Make the progress indicator epistemically explicit.** The optional tracker is a good low-noise design: opt-in, 3–6 weighted milestones, one overall bar, one horizontal milestone row, and no per-milestone bars.[R1][R5] Add three rules:

- `TASK PROGRESS` measures estimated workflow completion only; it is not confidence, truth probability, evidence quality, or claim support.
- Each milestone maps to named states, deliverables, or acceptance checkpoints.
- On challenge downgrade, scope change, or killed draft, discarded work loses credit and the estimate may remain unchanged or decrease.

Render progress only at declaration, meaningful state transitions, scope changes, and terminal completion. Keep the finding and its TL;DR primary in final output; place the final tracker after the summary or in the Process Appendix.[R5]

**11. Apply the upgrades proportionately.** Use a compact claim table for QUICK research. Use source posture, status tables, benefit conditions, and decision gates for STANDARD product or architecture research. Use the full claim ledger, contradiction ledger, independent challenge, version recheck, and prioritized uncertainty register for DEEP or high-stakes research.[R3][R4]

## Recommendation

Pilot a **layered research contract** rather than adding more mandatory prose to every run.

1. Make atomic claims, source posture, scope/as-of metadata, and confidence separation mandatory for all material Key Findings and Recommendations.
2. Make status tables, benefit-condition-measure chains, decision gates, and contradiction ledgers conditional on the subject involving products, architecture, changing availability, vendor claims, or a consequential decision.
3. Keep the existing nine-section document, state machine, challenge/judge roles, verification gate, and write discipline.
4. Clarify the existing optional progress indicator as workflow telemetry and define cycle/back-edge behavior; do not treat it as an evidentiary score.
5. Pilot a small set of deterministic corpus checks: heading shape, citation existence, valid local-source references, and required triggered sections. Keep semantic checks advisory and human-reviewed.

**Confidence:** High that these changes address the observed gap without weakening the skill’s core safeguards. Medium for the exact schema and automation cost; pilot the contract on QUICK, STANDARD, and DEEP examples before enforcing it broadly.

**Decision gates:** The upgrade is ready for implementation only after a sample set demonstrates that executive readers can identify answer, confidence, fit, principal risk, and next validation step quickly, while an auditor can trace every material claim to a source with scope and posture. If the richer contract materially crowds out evidence or makes narrow QUICK findings disproportionate, reduce the triggered schema rather than weakening provenance.

## Unverified Claims

- **Unverified:** The proposed schemas will improve reader decisions across every research domain; most evidence comes from methodology guidance and one product-research case study.
- **Unverified:** Exact thresholds for escalating from QUICK to STANDARD or DEEP can be safely generalized; these should be calibrated against representative runs.
- **Unverified:** Automated checks can reliably detect all compound claims, causal language, source-interest conflicts, and scope mismatches without human review.
- **Unverified:** A contradiction ledger will improve outcomes enough to justify its authoring and maintenance cost for low-risk research.
- **Unverified:** The current progress formula’s `verified_fraction` can be made reliable without either named acceptance checkpoints or a simpler completion model.[R5]
- **Unverified:** Public methodological guidance transfers perfectly from systematic reviews, public-sector appraisal, UX, and architecture documentation to all CSM research domains.

## References

[R1] `csm-deep-research/SKILL.md`, local skill contract, file:///home/jamiemills/.config/opencode/skills/csm-deep-research/SKILL.md, locators: lines 10-20, 117-182, 234-319 — retrieved 2026-08-24.

[R2] “Salesforce Headless 360 Research Finding,” local case study, file:///home/jamiemills/.config/opencode/skills/.agents/research/2026-08-24-headless-360-salesforce-research.md, locators: lines 26-35, 39-91, 101-111 — retrieved 2026-08-24.

[R3] Nielsen Norman Group, “Progressive Disclosure,” https://www.nngroup.com/articles/progressive-disclosure/ — retrieved 2026-08-24.

[R4] UK Government, “Magenta Book: Central Government Guidance on Evaluation,” https://www.gov.uk/government/publications/the-magenta-book/magenta-book-central-government-guidance-on-evaluation-html — retrieved 2026-08-24.

[R5] `.agents/plans/2026-08-24-optional-progress-tracker-csm.md`, local progress-indicator design evidence, file:///home/jamiemills/.config/opencode/skills/.agents/plans/2026-08-24-optional-progress-tracker-csm.md, locators: lines 29-36, 52-70, 77-83, 162-163 — retrieved 2026-08-24.

[R6] UK Government, “The Green Book 2026,” https://www.gov.uk/government/publications/the-green-book-appraisal-and-evaluation-in-central-government/the-green-book-2026 — retrieved 2026-08-24.

[R7] Cochrane, “Chapter 5: Collecting Data,” “Chapter 7: Considering Risk of Bias,” and “Chapter 14: Completing ‘Summary of Findings’ Tables and Grading the Certainty of the Evidence,” https://www.cochrane.org/handbook/current/chapter-05, https://www.cochrane.org/handbook/current/chapter-07, and https://www.cochrane.org/handbook/current/chapter-14 — retrieved 2026-08-24.

[R8] W3C, “Web Standards,” https://www.w3.org/standards/; RFC Editor, “RFC 2026: The Internet Standards Process,” https://www.rfc-editor.org/rfc/rfc2026 — retrieved 2026-08-24.

[R9] GOV.UK, “The Green Book 2026” and “Magenta Book,” https://www.gov.uk/government/publications/the-green-book-appraisal-and-evaluation-in-central-government/the-green-book-2026 and https://www.gov.uk/government/publications/the-magenta-book/magenta-book-central-government-guidance-on-evaluation — retrieved 2026-08-24.

## Process Appendix

**Triage.** Tier: DEEP. Source mode: hybrid. Rationale: the research evaluates a local skill contract and case finding while using external methodological guidance to validate improvements. Tracks: (1) local skill audit, (2) evidence-synthesis methodology, (3) executive research UX, (4) adversarial failure-mode analysis, and (5) optional progress-indicator audit.

**Research reports.** Five independent read-only tracks returned evidence packs. The local audit identified eight contract gaps. The methodology track supported claim decomposition, source-role classification, domain-based bias appraisal, independent evidence, uncertainty structure, version tracking, and causal-language discipline. The executive UX track supported progressive disclosure, architecture zoom levels, status/maturity separation, benefit-condition framing, decision criteria, and staged validation. The adversarial track identified twelve failure modes, especially false precision, compound claims, product-boundary ambiguity, capability/outcome slippage, generic recommendations, unprioritized unknowns, and process overhead. The progress audit upheld the opt-in low-noise design but required explicit separation between workflow completion and epistemic confidence.

**Challenge verdicts.** The proposed changes were challenged against over-engineering risk. The recommendation was narrowed from “adopt” to pilot conditionally, with triggered and tier-scaled structures rather than all tables in every finding. Existing process controls were retained. Numeric confidence was not removed, but its dimensions were separated from workflow progress and source posture. The challenge also identified local-source citation semantics as a higher-priority repair than additional presentation tables. External methodological sources were treated as transferable guidance, not universal technical standards.

**Judge assessment.** Initial independent judge scores were factual accuracy 0.82 (pass), citation accuracy 0.66 (fail), completeness 0.84 (pass), and clarity 0.91 (pass). The citation failure was caused by placeholder local URLs and bundled source references. Remediation replaced local placeholders with `file://` URLs and line locators, narrowed the recommendation to a conditional pilot, and made grouped source roles explicit. Post-remediation citation verification passes for the cited local and external source mappings; the residual limitation is that local file URLs are workspace-local and require a corpus-defined canonical local-source policy.

**Remediation log.** The synthesis made progressive disclosure operational, separated source posture from verdict, required claim atomicity and status metadata, paired benefits with conditions and measures, added contradiction and decision ledgers, prioritized unknowns, and clarified progress semantics. Challenge remediation narrowed adoption to a conditional pilot, made status and contradiction structures trigger-based, removed planning-like owner/deadline requirements, repaired local citations with `file://` URLs and locators, and limited proposed corpus checks to deterministic checks first.

**Control journal.**

[2026-08-24T00:00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: user requested DEEP research into improving csm-deep-research using the skill and prior findings; protected baseline recorded with pre-existing Headless 360 research changes.
- [2026-08-24T00:00:00Z] TRIAGE complete :: cycle 0
- [2026-08-24T00:00:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: hybrid source mode and five research tracks selected; optional progress explicitly enabled.
- [2026-08-24T00:00:00Z] RESEARCH complete :: cycle 0
- [2026-08-24T00:00:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: five independent evidence packs returned.
- [2026-08-24T00:00:00Z] SYNTHESIZE complete :: cycle 0
- [2026-08-24T00:00:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft mapped to local skill, case-study, and methodology evidence.
- [2026-08-24T00:00:00Z] CHALLENGE complete :: cycle 0
- [2026-08-24T00:00:00Z] CHALLENGE -> JUDGE :: cycle 0 :: trigger: adversarial track identified failure modes and over-engineering risks.
- [2026-08-24T00:00:00Z] JUDGE complete :: cycle 0
- [2026-08-24T00:00:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: make richer output schemas conditional and clarify progress semantics.
- [2026-08-24T00:00:00Z] REMEDIATE complete :: cycle 0
- [2026-08-24T00:00:00Z] REMEDIATE -> VERIFY :: cycle 0 :: trigger: remediation incorporated without modifying the skill.
- [2026-08-24T00:00:00Z] VERIFY complete :: cycle 0 :: trigger: required headings, citations, source limitations, redaction, and protected-state scope checked; only this new research file is intended.
- [2026-08-24T00:00:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: post-remediation citation accuracy passed; recommendation is explicitly conditional on pilot evidence.
