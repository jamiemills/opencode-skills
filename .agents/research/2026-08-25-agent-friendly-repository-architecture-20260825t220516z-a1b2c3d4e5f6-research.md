format: csm-deep-research/1

# Agent-Friendly Repository Architecture Research Finding

## TL;DR

Optimize repositories for agents by making intent, boundaries, contracts, permissions, validation, and recovery discoverable and enforceable. Use concise scoped instructions as context, but put correctness and safety in schemas, tests, CI, hooks, sandbox policy, and human review. Direct productivity gains remain unverified.

## Executive Summary

```text
Scoped context -> explicit modules -> typed contracts -> bounded tools
       -> deterministic validation -> trace/eval feedback -> human review
```

The documented agent products examined recommend concise, path-scoped, executable instructions and exact validation commands, but discovery and precedence remain runtime-specific. Standards define useful mechanisms such as stable interfaces, schemas, isolated tests, ownership, and correlated observability; they do not prove agent-specific outcomes. This repository already has typed envelopes, schema registries, lifecycle journals, and durable artifact indexes, but those patterns need consistent runtime enforcement and empirical evaluation.

## Key Findings

1. **Partially-supported:** Documented agent products generally recommend concise, scoped, operational context paired with explicit validation; precedence is runtime-specific. [R1][R2][R3]
2. **Partially-supported:** Machine-readable contracts and explicit public interfaces reduce integration ambiguity; coherent modules, dependency direction, and ownership are defensible recommendations whose agent benefit is unverified. [R4][R5][R6][R7]
3. **Partially-supported:** Agent-mediated changes should expose repository-appropriate deterministic validation, with CI and review gates for consequential changes; exact effectiveness is context-dependent. [R8][R9][R10][R17][R18]
4. **Supported:** Instructions and tool metadata are not authorization; side-effecting agent paths need host/tool-boundary controls appropriate to their runtime. [R2][R11][R12][R13]
5. **Partially-supported:** Durable identity, journals, correlated traces, and repeatable evaluations can improve inspectability and support recovery when runtime paths persist, validate, and consume them; local recovery benefit is unverified. [R14][R15][R16][L3][L4]
6. **Partially-supported:** These practices form a plausible baseline architecture, but effects on accuracy, cost, autonomy, and productivity require repository-specific evaluation. [R9][R16]

## Detail Sections

### 1. Layered Context

Keep a short root `AGENTS.md` for purpose, repository map, setup, test/lint/build commands, architectural invariants, security constraints, and completion criteria. Add nested files only where a subsystem differs. OpenAI documents root-to-directory composition; GitHub documents repository-wide and path-specific instructions; Anthropic recommends concise, concrete files. [R1][R2][R3]

Use `CONTRIBUTING.md` for human process, `CODEOWNERS` for review ownership, and package manifests, lockfiles, CI workflows, and schemas for machine-readable facts. Avoid duplicated facts without drift checks. `AGENTS.md` is an emerging open convention, not a universal standard. [R3][R7]

### 2. Explicit Boundaries

Partition code around coherent capabilities or domain models. Keep dependencies directed toward stable interfaces and prevent implementation reach-through. OpenAPI supports source-independent service understanding; JSON Schema standardizes data description and validation; SemVer requires a declared public API. [R4][R5][R6]

For agent-facing seams, define inputs, outputs, errors, side effects, compatibility, ownership, and examples. Validate contracts at producer and consumer boundaries and version them. The local repository demonstrates this pattern in `csm-envelope.schema.json`, schema registries, and journal/event schemas, but static schema presence does not prove runtime enforcement. [L1][L2][L4]

### 3. Verification

```text
read -> plan -> edit -> format/lint -> unit/contract tests
  -> integration checks -> inspect diff -> review -> merge gate
```

Tests should be fast, isolated, repeatable, self-checking, and behavior-focused. GitHub documents automated build/test workflows and protected-branch checks; agent workflows should obtain ground truth from tool or code-execution results; evaluation should progress from traces to repeatable datasets and eval runs. [R8][R9][R10][R17][R18]

Separate deterministic repository tests from gated live-model tests. Assert schemas, state transitions, permissions, artifact ownership, and tool arguments deterministically; measure activation, trajectory, refusal, recovery, outcome, cost, and regression with versioned live eval tasks.

### 4. Safety Boundaries

Treat context files, MCP descriptions, and tool annotations as untrusted behavioral input, not authorization. Enforce least-privilege filesystem/process access, restricted network egress, sandboxing, approvals, input/output validation, rate limits, timeouts, audit events, and redaction at the host/tool boundary. [R2][R11][R12][R13]

```text
requested capability -> policy decision -> approval if sensitive
                     -> scoped execution -> bounded result -> audit event
```

Keep credentials out of context and default telemetry. Treat internet access, subprocesses, browser/CDP sessions, publication, and Git mutation as separate risk classes. Make denial and prompt-injection resistance test cases.

### 5. Durable Context And Observability

Record run identity, transitions, inputs, outputs, evidence, failure reason, and recovery point before irreversible transitions. The local repository models journal events, control cursors, and a durable `.agents/` artifact index; these are primitives, not proof of successful recovery. [L3][L4]

Add a normalized redacted trace joining run ID, parent span, skill/content digest, model/runtime, tool, permission decision, state transition, status, duration, and error class. W3C Trace Context supports propagation; Google SRE recommends actionable signals; OpenTelemetry documents stable API/SDK separation. [R14][R15][R19]

### 6. Optimization Loop

There is no universal threshold for module size, instruction length, coverage, autonomy, or trace quality. Measure discovery accuracy, contract failures, review defects, denied-action escapes, exfiltration attempts, resume success, duplicate publication, task success, time, cost, and human correction. Widen permissions or parallelism only when safety and outcome criteria improve together. [R9][R16]

## Recommendation

Adopt these repository invariants:

1. **Context:** concise root guidance, nested only where needed, with exact commands, architecture map, security limits, and completion checks. [R1][R2][R3]
2. **Boundaries:** named ownership, stable interfaces, typed input/output/error contracts, compatibility policy, and no undocumented reach-through. [R4][R5][R6][R7]
3. **Validation:** deterministic format, lint, unit, contract, integration, and diff checks, with CI and protected review enforcing the required subset. [R8][R10][R17][R18]
4. **Safety:** host-enforced and tested permissions, network, subprocess, credential, publication, and browser controls. [R2][R11][R12][R13]
5. **Evidence:** durable identity, resumable state, redacted correlated traces, and auditable results. [R14][R15][L3][L4]
6. **Evaluation:** repository-local evals covering activation, trajectory, safety, recovery, and outcomes, separated from deterministic harness checks. [R9][R10][R16]

This is a proposed maintainability and control baseline, not proof of agent productivity improvement. Pilot it on representative tasks and widen autonomy only after measured safety and outcome improvement.

## Unverified Claims

- No source establishes a universal cross-agent instruction precedence model.
- No live evaluation was run, so this repository's activation, trajectory, recovery, and outcome quality are unknown.
- The dirty worktree contains changes not made by this run; local observations are not a clean regression result.
- Static schemas and journals do not prove all runtime paths enforce them.
- Documentation and standards establish mechanisms and controls, not implementation enforcement or improved agent outcomes.
- Instruction, permission, path, limit, and approval semantics vary by runtime.
- Microservice guidance does not require splitting a monorepo into services.

## References

[R1] OpenAI, “AGENTS.md,” https://developers.openai.com/codex/guides/agents-md/ — retrieved 2026-08-25.
[R2] Anthropic, “Claude Code memory,” https://docs.anthropic.com/en/docs/claude-code/memory — retrieved 2026-08-25.
[R3] GitHub, “Repository custom instructions,” https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot — retrieved 2026-08-25.
[R4] OpenAPI Initiative, “OpenAPI Specification,” https://spec.openapis.org/oas/latest.html — retrieved 2026-08-25.
[R5] JSON Schema, “Specification,” https://json-schema.org/specification — retrieved 2026-08-25.
[R6] Semantic Versioning, “2.0.0,” https://semver.org/ — retrieved 2026-08-25.
[R7] GitHub, “About code owners,” https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners — retrieved 2026-08-25.
[R8] Microsoft Learn, “Unit test best practices,” https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices — retrieved 2026-08-25.
[R9] Anthropic, “Building effective agents,” https://www.anthropic.com/research/building-effective-agents — retrieved 2026-08-25.
[R10] OpenAI, “Agent evals,” https://platform.openai.com/docs/guides/agent-evals — retrieved 2026-08-25.
[R11] OpenAI, “Guardrails and human approvals,” https://developers.openai.com/api/docs/guides/agents/guardrails-approvals — retrieved 2026-08-25.
[R12] Anthropic, “Hooks guide,” https://docs.anthropic.com/en/docs/claude-code/hooks-guide — retrieved 2026-08-25.
[R13] MCP, “Tools,” https://modelcontextprotocol.io/specification/2025-06-18/server/tools — retrieved 2026-08-25.
[R14] W3C, “Trace Context,” https://www.w3.org/TR/trace-context/ — retrieved 2026-08-25.
[R15] Google SRE, “Monitoring distributed systems,” https://sre.google/sre-book/monitoring-distributed-systems/ — retrieved 2026-08-25.
[R16] NIST, “AI Risk Management Framework,” https://www.nist.gov/itl/ai-risk-management-framework — retrieved 2026-08-25.
[R17] GitHub, “Automating builds and tests,” https://docs.github.com/en/actions/automating-builds-and-tests — retrieved 2026-08-25.
[R18] GitHub, “About protected branches,” https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches — retrieved 2026-08-25.
[R19] OpenTelemetry, “Overview,” https://opentelemetry.io/docs/specs/otel/overview/ — retrieved 2026-08-25.
[L1] Workspace-local, `file:///home/jamiemills/.config/opencode/skills/bootstrap/package/payload/schemas/csm-envelope.schema.json` — retrieved 2026-08-25.
[L2] Workspace-local, `file:///home/jamiemills/.config/opencode/skills/bootstrap/package/payload/schemas/registry.json` — retrieved 2026-08-25.
[L3] Workspace-local, `file:///home/jamiemills/.config/opencode/skills/.agents/README.md` — retrieved 2026-08-25.
[L4] Workspace-local, `file:///home/jamiemills/.config/opencode/skills/bootstrap/package/payload/schemas/csm-journal-event.schema.json` and `file:///home/jamiemills/.config/opencode/skills/csm-deep-research/SKILL.md` — retrieved 2026-08-25.

## Process Appendix

**Triage.** DEEP, hybrid. Five tracks: local architecture; agent context; contracts; validation/safety; standards/interoperability. Assumption: “repo” means the current skills repository and repositories used for agentic development.

**Research.** Five independent read-only tracks returned local and primary-source evidence. Vendor claims were treated as documented mechanisms, not proof of outcomes.

**Challenge.** The independent challenger verdicts were: K1 downgrade (precedence is not universal); K2 downgrade (contracts do not prove bundled architecture benefits); K3 downgrade (validation sequence is context-dependent); K4 uphold (instructions are not authorization); K5 downgrade (recovery is not demonstrated); K6 uphold with narrower wording. It suggested explicit mechanism-versus-outcome and runtime-portability caveats. All were incorporated.

**Judge and remediation.** The first independent judge scored factual accuracy 0.84, citation accuracy 0.72, completeness 0.61, clarity 0.88 and failed completeness for missing per-claim records, remediation ledger, final judge record, and two citations. Remediation narrowed claims, added R17-R19 and L4, and added the following ledger: K1/K2/K3/K5 downgraded and rechecked; K4 upheld and rechecked; K6 narrowed and rechecked; missing references added. A subsequent file-level judge could not reopen the artifact after workspace isolation removed it, so no final pass is claimed.

**DEEP verification.** Material claims are labeled supported or partially-supported in Key Findings; unverified outcome claims are parked above. The marker, H1, and exactly eight H2 sections are present in this saved file. No credentials, tokens, private keys, or personal data are included. No repository code was executed. The pre-existing dirty baseline remains a limitation.

**Control journal.**

[20260825T220516Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: run initialized.

- `[20260825T220516Z] INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE :: cycle 0 :: five-track DEEP hybrid run.`
- `[20260825T220516Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: run initialized.`
- `[20260825T220516Z] CHALLENGE -> REMEDIATE :: cycle 0 :: overbroad mechanism/outcome claims narrowed.`
- `[20260825T220516Z] REMEDIATE -> JUDGE :: cycle 1 :: citations and claim scopes corrected.`
- `[20260825T220516Z] JUDGE -> REMEDIATE :: cycle 1 :: completeness 0.61 and citation gaps.`
- `[20260825T220516Z] REMEDIATE -> VERIFY :: cycle 2 :: per-claim records and L4/R17-R19 added.`
- `[20260825T220516Z] VERIFY -> SAVED :: cycle 2 :: saved with final file-level judge reopen limitation disclosed.`
