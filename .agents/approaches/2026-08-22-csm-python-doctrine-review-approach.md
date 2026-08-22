format: csm-grill/1

# csm-python-doctrine-review Skill Approach

- Idea slug: csm-python-doctrine-review
- Date: 2026-08-22
- Status: agreed

## How To Execute

Paste each phase brief below into its own explicit csm-plan invocation. This document authorizes nothing by itself.

## Idea Statement

Build a new first-class opencode skill `csm-python-doctrine-review` in this skills repo that ANALYZES Python repositories against the consolidated Python doctrine: an architecture dimension from the PEP 20 playbook and a code-level idiomatic dimension driven by the 140-rule machine-readable artifact. It is analyzer-only: it runs the right tools (isolated from the target repo), explains each issue and why it matters, and delivers a dated findings report with severities (pylint C/R/W/E/F + Google Nit) and recommendations — never fixes, never writes to the target repo outside its `.agents/`. Evidence base: `.agents/research/2026-08-22-python-doctrine-consolidated-research.md` + `.agents/research/artifacts/2026-08-22-python-idiomatic-reviewer-rules.json`.

## Decisions Log

| Question | Answer | Rationale |
| -------- | ------ | --------- |
| New skill vs docs-only vs skill elsewhere (AGENTS.md 220-word budget conflict) | Build the skill in this repo | Token-efficiency OFF today; re-budget descriptions before ever enabling the mode |
| Skill shape | Full csm-style skill, registered first-class | Corpus gates treat unregistered dirs as errors; user wants a real skill |
| Behavior | Analyzer-only: identify issues + explain what/why; run tools; prompt for ISOLATED installs when missing; findings + recommendations + severities; no fixes; no repo writes outside `.agents/` | User-specified verbatim |
| Rules source | Embed the rules JSON as an artifact in the skill folder beside SKILL.md | Self-contained skill; provenance pointer back to corpus artifact |
| Assessment scope | Both dimensions: architecture/doctrine checklist AND code-level idioms | User confirmed recommendation |
| Name | `csm-python-doctrine-review` (not `python-doctrine-review`) | Gate regex `/^csm-[a-z-]+$/` in discoverSkillDirs/pack-bootstrap — non-csm names are invisible and trip dead-key failures |
| Isolated runner default | uvx-first ladder with `@<version>` pins recorded in the report header; consented pipx fallback; refuse otherwise; ruff/mypy caches redirected to /tmp | Ruff docs lead with uvx; uv cache is ephemeral; pipx run-cache expiry makes unpinned runs non-reproducible; mypy/ruff write cwd caches violating write discipline |
| Severity-mapping home | Hybrid: JSON artifact authoritative for all 140 rules; SKILL.md carries ~10-line mapping policy (F/E→must-fix … Nit→advisory) + artifact filename as contract needle | Survives 500-line budget; testable; single source of truth |

## Research Synthesis

- House anatomy (scout): frontmatter = `name`+`description` only; description formula = imperative sentence + mandatory "Never <verb>…" clause (NEVER_CLAUSE_RE, always-on gate) ; body = `# CSM <Name>` H1, Interface (exactly 4 bullets), Activation Boundary, Core Rules, state machine section with backticked chain mapping 1:1 to `### N. STATE` headings, Anti-Patterns, Done Criteria; <500 lines; no duplicate H2s.
- Registration surface (deep-dive): scripts/lib/contracts.mjs MANIFEST entry (`sections[]`, `tmux`, `norms`, `machine{section,entryExit}`), INTERFACES row (entryConditions/consumes/produces/handoff/midPipeline), NEVER_INVOKE matrix (new column in every row + own row), CONTRACTS needles only if downstream consumers grep the artifact. README needs a resolvable `csm-*/path` reference + TOC conformance. Payload: byte-identical copy under bootstrap/package/payload/skills/<name>/ + pack-bootstrap `supportingFiles` mapping for the JSON artifact + repack.
- Isolated runners (deep-dive, URLs retrieved 2026-08-22): `uvx [email protected] check` is Ruff-docs-canonical (docs.astral.sh/ruff/installation/); uvx = alias of `uv tool run`, ephemeral venvs, pinnable (docs.astral.sh/uv/reference/cli/#uv-tool-run); `pipx run` leaves system untouched but run-cache expires (pipx.pypa.io); pyright canonical distributions are the pypi wrapper (auto-installs node, pin via PYRIGHT_PYTHON_FORCE_VERSION) or npm -g (microsoft/pyright docs/installation.md) — no Microsoft-sanctioned uvx path, so state the wrapper caveat in SKILL.md; mypy has no isolated guidance and stubs live in the target env (expect noise; note in report).
- Write-discipline precedents: csm-review forbids writes outside reviewed repo's `.agents/`; csm-deep-research uses numbered allowlist + baseline-diff verify — reuse both patterns.
- Rejected options: per-tool canonical installs (npm -g pyright + venv mypy) — mutates user machine globally, multiplies consent prompts; severity mapping wholly in SKILL.md prose — line-budget burn and silent drift.

## Phasing

```text
[P1 Scaffold] --> [P2 First-class registration] --> [P3 Assessment pipeline] --> [P4 Validate]
     |                     |                              |                         |
 SKILL.md skeleton     contracts.mjs rows             tooling ladder, mechanical   dry-run on sample
 + rules.json          + README + payload             architecture + judgment      repo; no-writes proof;
 artifact copy         copy + repack                  tiers, report format         check-suite green
```

```mermaid
flowchart LR
    p1["Phase 1: scaffold skill"] --> p2["Phase 2: register first-class"]
    p2 --> p3["Phase 3: assessment pipeline"]
    p3 --> p4["Phase 4: validate + gates"]
```

## Phase Briefs

### Phase 1: Scaffold the skill directory

- Goal: create `csm-python-doctrine-review/SKILL.md` skeleton + bundled rules artifact.
- Deliverables: SKILL.md passing structural gates (frontmatter name/description with Never-clause, exactly-one H1, Interface with 4 bullets, Activation Boundary, Core Rules, state machine `INTAKE -> TOOLING -> MECHANICAL -> ARCHITECTURE -> JUDGMENT -> REPORT -> SAVED -> STOP` as `### N. STATE` headings with Entry:/Exit:, Anti-Patterns, Done Criteria, Tmux Session Bootstrap section if tmux:true); `rules.json` copied from the corpus artifact beside SKILL.md.
- Scope: file creation only; no registration yet.
- Out of scope: contracts.mjs edits, payload packaging, pipeline logic detail.
- Constraints: <500 lines; description ≤1024 chars satisfying NEVER_CLAUSE_RE; write allowlist stated explicitly (target repo `<repo>/.agents/` only + one /tmp scratch dir; never target-repo source trees).
- Acceptance hints: manual structural review against csm-review/SKILL.md as template; rules.json byte-identical to corpus artifact.
- Dependencies: none.
- Context: `.agents/research/2026-08-22-python-doctrine-consolidated-research.md`; `.agents/research/artifacts/2026-08-22-python-idiomatic-reviewer-rules.json`; csm-review/SKILL.md; csm-deep-research/SKILL.md allowlist pattern.

### Phase 2: First-class registration

- Goal: make the corpus gates treat the skill as native.
- Deliverables: contracts.mjs MANIFEST entry (sections/tmux/norms/machine), INTERFACES row, NEVER_INVOKE new column in every existing row + own row; README entry + TOC; bootstrap/package/payload/skills/csm-python-doctrine-review/ byte-identical copy incl. rules.json with pack-bootstrap supportingFiles mapping; repack index.
- Scope: exactly those registrations; no behavior work.
- Out of scope: CONTRACTS needles (no downstream consumer yet).
- Constraints: byte-equality gates must pass; do not disturb unrelated dirty files in the working tree.
- Acceptance hints: `node scripts/check-suite.mjs` green for discovery, manifest-sections, interface, README, and payload-drift checks.
- Dependencies: Phase 1.
- Context: scripts/lib/contracts.mjs (templates at csm-review rows), scripts/pack-bootstrap.mjs mappings, AGENTS.md budget note (record: budget re-check required before enabling token-efficiency).

### Phase 3: Assessment pipeline specification

- Goal: fill SKILL.md's states with the concrete analysis procedure.
- Deliverables: TOOLING state (probe uvx → consented pipx fallback → refuse-and-instruct isolated install; record `@<version>` pins in report header; redirect ruff/mypy caches to the session tmp dir; pyright-via-wrapper caveat noted); MECHANICAL state (run ruff with rule families mapped from artifact tiers + pyright standard; parse outputs into rule ids); ARCHITECTURE state (PEP 20 playbook checklist: packaging/pyproject-only, src layout, lock discipline, boundary-only validation, protocols-as-seams, sync-first, test pyramid); JUDGMENT state (LLM prompts for non-lintable gotchas: mutable class attributes, complexity interpretation, docstring semantics, test validity, concurrency); REPORT state (dated findings doc written ONLY under target `<repo>/.agents/`; each finding: what/how-detected/why-it-matters/severity C-R-W-E-F or Nit/recommendation; no fixes).
- Scope: SKILL.md content only.
- Out of scope: helper scripts (agent executes steps directly).
- Constraints: every state respects the write allowlist; report includes tool versions + pins used.
- Acceptance hints: a reader can execute the procedure manually without ambiguity; severity policy ≤10 lines pointing at artifact.
- Dependencies: Phase 1.
- Context: doctrine consolidated finding Recommendation sections; deep-dive runner findings (URLs above).

### Phase 4: Validate

- Goal: prove the skill works end-to-end without polluting targets.
- Deliverables: dry-run on a sample Python repo (any small OSS checkout in /tmp): findings report produced under sample's `.agents/`; diff proves zero writes elsewhere; corpus gates green.
- Scope: one validation run + fixes to skill text that validation exposes.
- Out of scope: assessing any production repo.
- Constraints: sample repo checked out to /tmp, never mutated by tools' caches (cache-dir redirection verified via git status of sample).
- Acceptance hints: report exists, contains pinned tool versions, severities mapped; check-suite green; sample repo tree clean apart from `.agents/`.
- Dependencies: Phases 1-3.
- Context: Phase 3 states; check-suite.mjs.

## Open Questions And Rejected Options

- Open: `csm-make-tests` dead registry key exists in MANIFEST with no directory — gate baseline may be red independently of this work; confirm separately before blaming Phase 2.
- Open: exact 220-word re-budget plan deferred until token-efficiency is ever enabled (recorded decision: build now, re-budget later).
- Rejected: extending csm-review with a Python mode — different lifecycle (analysis-only, tool-provisioning) muddies a generalist reviewer skill.
- Rejected: minimal unregistered skill — fails house "registered, not silently skipped" policy.
- Rejected: referencing the corpus artifact path at runtime — breaks self-containment; artifact is embedded instead with provenance pointer.
