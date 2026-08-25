format: csm-deep-research/1

# Repository Issues Deep Research Finding

## TL;DR

The prior static review is substantially validated, but the deeper pass found additional high-impact boundary and durability defects. The most important new issues are escaped autoresearch descendants, unlocked ledger recovery, upload symlink/TOCTOU handling, and mutable CI/release trust inputs. Do not treat the current runtime or publication controls as hostile-input isolation.

## Executive Summary

```text
Pinned repository -> four specialist tracks -> synthesis
       |                 |                 |
       +--> challenge --> judge --> verified finding
```

This DEEP hybrid investigation used four independent repository-plus-web tracks, an independent challenger, and a separate judge. Local evidence was read at commit `a63411f334171e20fd480eacf60685b353f9aa5f`; no repository code was executed or modified.

## Key Findings

1. **Supported:** trusted-local lacks demonstrated kernel-enforced network, memory, and process isolation; process-group cleanup is not equivalent to descendant containment. [L1a][L1b][R5]
2. **Supported:** initial autoresearch resume recovery is unlocked, and full-workspace snapshotting precedes the post-execution workspace check. [L1b][L2a][L2b][R1]
3. **Supported:** browser typing echoes input; browser navigation lacks a protocol allowlist; CDP evaluation lacks an execution timeout. [L3a][L3b][L4a][L5a][L5b][R2][R5]
4. **Supported:** upload follows source symlinks and separates content scanning from later path reopening/copying. [L6a][R2]
5. **Supported:** deep-research, make-tests, plan promotion, and DDD publication lack consistently specified unique ownership, collision, and concurrency semantics. [L7a][L8a][L9a][L10a][R3]
6. **Supported:** CI/release trust is weakened by mutable action tags, floating runtime inputs, absent dependency auditing, and missing npm provenance workflow. [L11a][L12a][L13a][R4]
7. **Not supported:** the prior claim that CI omits `test-suite-tooling`; current `make test` includes it. [L14][L11b]

## Detail Sections

### Execution isolation

The runtime’s timeout mechanism kills a POSIX process group, but the provider starts a detached child and does not establish a cgroup, PID namespace, or equivalent supervisor boundary. A descendant that creates a new session is outside the demonstrated kill target, although an escape was not executed. Initial full-workspace copying also occurs before the candidate’s workspace limit is applied. The optimizer’s initial `ledger.open()` can quarantine or rewrite the ledger before `append()` acquires its lock; append-triggered recovery is a separate, lock-protected path. [L1a][L1b][L2a][L2b][R1][R5]

### Browser boundary

The browser’s `type` path prints supplied text, the navigation path forwards arbitrary URL text to CDP, and `Runtime.evaluate` awaits promises without a timeout. DOM and HTML output also lack sensitivity classification. These are output and availability risks; this research did not demonstrate a particular secret leak or `file:` disclosure. [L3a][L3b][L4a][L5a][L5b][R2][R5]

### Upload boundary

The upload path follows caller-provided symlinks and reopens paths after scanning. A concurrent replacement can cause the scanned object and copied object to differ. These are code-level link-following and TOCTOU weaknesses; practical exploitability depends on the caller and filesystem trust model. [L6a][R2]

### Durable artifacts

Date-and-slug filenames are not sufficient identity. The reviewed contracts do not specify unique ownership, collision handling, or concurrency semantics for same-day deep-research, make-tests, and plan artifacts, while DDD publishes report and graph files through separate operations. The repository needs explicit ownership, locking, generation identity, and no-replace semantics for durable artifacts. [L7a][L8a][L9a][L10a][R3]

### CI and release trust

The repository’s frozen lockfile improves repeatability but does not provide vulnerability status or immutable workflow dependencies. GitHub Action tags, Node patch selection, npm pack tooling, and manually recorded release hashes remain mutable or weakly bound. Reproducibility and provenance are separate properties. [L11a][L12a][L13a][R4]

## Recommendation

Prioritize kernel-enforced isolation and least-privilege snapshots before allowing hostile or generated autoresearch candidates [L1a][L1b]. Then close durable-artifact ownership and publication-input races [L7a][L8a][L10a]. For release trust, pin actions by full SHA, make the package manager/runtime evidence reproducible, add dependency auditing, and establish an attested npm publication path before claiming production bootstrap readiness [L11a][L11b][L12a][L13a].

Confidence is high for the local code and contract observations, and medium-to-high for operational impact where execution was prohibited. The recommendation changes if bounded adversarial execution demonstrates a stronger external sandbox than the reviewed provider code currently proves. The prior CI test-suite omission should be removed rather than fixed.

## Unverified Claims

The following claims remain unverified because this run did not execute repository code: whether a detached descendant actually escapes in the supported host/container configuration; whether a practical attacker can win each upload TOCTOU race; whether `file:` navigation exposes mounted secrets; whether Corepack resolves a different binary across Node patches; and whether npm archive bytes vary across npm versions.

## References

### Local evidence

- [L1a] Workspace-local `csm-autoresearch/lib/runtime/index.mjs:78-84,137-144,157-160`, commit `a63411f`: file://repo-root/csm-autoresearch/lib/runtime/index.mjs
- [L1b] Workspace-local `csm-autoresearch/lib/providers/trusted-local.mjs:157-177`, commit `a63411f`: file://repo-root/csm-autoresearch/lib/providers/trusted-local.mjs
- [L2a] Workspace-local `csm-autoresearch/lib/optimizer/index.mjs:146-148`, commit `a63411f`: file://repo-root/csm-autoresearch/lib/optimizer/index.mjs
- [L2b] Workspace-local `csm-autoresearch/lib/ledger/index.mjs:101-109,161-212`, commit `a63411f`: file://repo-root/csm-autoresearch/lib/ledger/index.mjs
- [L3a] Workspace-local `csm-browse/lib/verbs/input.mjs:76-104`, commit `a63411f`: file://repo-root/csm-browse/lib/verbs/input.mjs
- [L3b] Workspace-local `csm-browse/SKILL.md:93-99`, commit `a63411f`: file://repo-root/csm-browse/SKILL.md
- [L4a] Workspace-local `csm-browse/lib/verbs/nav.mjs:17-30`, commit `a63411f`: file://repo-root/csm-browse/lib/verbs/nav.mjs
- [L5a] Workspace-local `csm-browse/lib/cdp.mjs:131-160`, commit `a63411f`: file://repo-root/csm-browse/lib/cdp.mjs
- [L5b] Workspace-local `csm-browse/lib/verbs/dom.mjs:80-91`, commit `a63411f`: file://repo-root/csm-browse/lib/verbs/dom.mjs
- [L6a] Workspace-local `csm-upload/scripts/upload.mjs:56-82,459-470,606-609`, commit `a63411f`: file://repo-root/csm-upload/scripts/upload.mjs
- [L7a] Workspace-local `csm-deep-research/SKILL.md:32,177-178`, commit `a63411f`: file://repo-root/csm-deep-research/SKILL.md
- [L8a] Workspace-local `csm-make-tests/SKILL.md:101-104,253-274`, commit `a63411f`: file://repo-root/csm-make-tests/SKILL.md
- [L9a] Workspace-local `csm-plan/SKILL.md:52-55,222-226`, commit `a63411f`: file://repo-root/csm-plan/SKILL.md
- [L10a] Workspace-local `csm-ddd/lib/ddd/pipeline.mjs:136-169`, commit `a63411f`: file://repo-root/csm-ddd/lib/ddd/pipeline.mjs
- [L11a] Workspace-local `.github/workflows/ci.yml:16-22,32-38`, commit `a63411f`: file://repo-root/.github/workflows/ci.yml
- [L11b] Workspace-local `.github/workflows/ci.yml:49-52`, commit `a63411f`: file://repo-root/.github/workflows/ci.yml
- [L12a] Workspace-local `package.json:5-13`, commit `a63411f`: file://repo-root/package.json
- [L12b] Workspace-local `.node-version:1`, commit `a63411f`: file://repo-root/.node-version
- [L13a] Workspace-local `bootstrap/release-checklist.md:10-23`, commit `a63411f`: file://repo-root/bootstrap/release-checklist.md
- [L13b] Workspace-local `scripts/pack-bootstrap.mjs:284-333`, commit `a63411f`: file://repo-root/scripts/pack-bootstrap.mjs
- [L14] Workspace-local `Makefile:43-44,79`, commit `a63411f`: file://repo-root/Makefile

### External references

- [R1] MITRE CWE-400, CWE-667, CWE-770, CWE-922, retrieved 2026-08-25: https://cwe.mitre.org/data/definitions/400.html ; https://cwe.mitre.org/data/definitions/667.html ; https://cwe.mitre.org/data/definitions/770.html ; https://cwe.mitre.org/data/definitions/922.html
- [R2] OWASP ASVS 5.0.0, retrieved 2026-08-25: https://raw.githubusercontent.com/OWASP/ASVS/v5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv
- [R3] Git atomic push and SQLite atomic commit guidance, retrieved 2026-08-25: https://git-scm.com/docs/git-push ; https://sqlite.org/atomiccommit.html
- [R4] GitHub Actions security, npm provenance, Corepack, and SLSA, retrieved 2026-08-25: https://docs.github.com/en/actions/reference/security/secure-use ; https://docs.npmjs.com/generating-provenance-statements ; https://github.com/nodejs/corepack ; https://slsa.dev/spec/v1.0/levels
- [R5] Node child process, Linux `kill(2)`, CDP `Page.navigate`, and CDP `Runtime.evaluate`, retrieved 2026-08-25: https://nodejs.org/api/child_process.html#optionsdetached ; https://man7.org/linux/man-pages/man2/kill.2.html ; https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-navigate ; https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate
- [R6] Git configuration/push URLs, tmux shell execution, and Linux rename semantics, retrieved 2026-08-25: https://git-scm.com/docs/git-config ; https://man7.org/linux/man-pages/man1/tmux.1.html ; https://man7.org/linux/man-pages/man2/rename.2.html

## Process Appendix

### Control Journal

[2026-08-25T08:15:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: explicit deep-research request :: rungs: R0
- Target commit: `a63411f334171e20fd480eacf60685b353f9aa5f`.
- Protected-state baseline: existing review report is untracked; no research document existed at this slug before scaffold.
- Tier: DEEP. Source mode: hybrid.
- Temp directory: not created; this run uses read-only retrieval and transient tool storage only.
[2026-08-25T08:16:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: four non-overlapping tracks selected :: rungs: R0
[2026-08-25T08:25:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: four research packs returned :: rungs: R0
[2026-08-25T08:32:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft claims mapped to local and external evidence :: rungs: R0
[2026-08-25T08:39:00Z] CHALLENGE -> REMEDIATE :: cycle 0 :: trigger: challenger required atomic splits, narrowed recovery/impact language, and direct local citations :: rungs: R0
[2026-08-25T08:44:00Z] REMEDIATE -> JUDGE :: cycle 0 :: trigger: claim wording, local locators, and correction of stale CI finding updated :: rungs: R0
[2026-08-25T08:49:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: citation accuracy and completeness scored below threshold :: rungs: R0
[2026-08-25T08:54:00Z] REMEDIATE -> VERIFY :: cycle 1 :: trigger: direct local references, challenger resolutions, and judge record added :: rungs: R0
- Challenger verdict: claims upheld after splitting browser/upload, narrowing unlocked recovery, and classifying plan promotion as unspecified contract behavior; prior CI omission retracted.
- Judge first pass: factual accuracy 0.76, citation accuracy 0.48, completeness 0.35, clarity 0.78; failed on citation accuracy and completeness.
- Remediation: all material local claims now cite exact workspace-local file URLs and line ranges; external standards are contextual only; challenged claims are split or narrowed; the stale CI omission is explicitly not supported.
- Final judge check: factual accuracy 0.91, citation accuracy 0.88, completeness 0.86, clarity 0.93; pass after direct-file citation and privacy remediation.
- Per-claim verification: K1 supported; K2 supported with recovery narrowed to initial resume; K3 supported for browser output/protocol/evaluation timeout; K4 supported for upload symlink and scan/copy TOCTOU; K5 partially supported as an unspecified collision/ownership contract plus confirmed DDD race; K6 supported; K7 not supported and removed from the defect set.
- Additional verified claims: deep-research and make-tests deterministic artifact collision contracts supported; mutable action/runtime and absent audit/provenance gates supported. Operational exploitability remains unverified where execution was prohibited.
- External-source caveat: SLSA v1.0 is used only for the reproducibility/provenance distinction; its lifecycle status should be rechecked before release policy is written. Corepack’s rolling documentation and CDP `tot` endpoints are current retrieval references, not immutable version pins.
[2026-08-25T08:58:00Z] VERIFY -> SAVED :: cycle 1 :: trigger: per-claim citations, challenge/judge records, redaction, fixed headings, and protected-state check passed :: rungs: R0
