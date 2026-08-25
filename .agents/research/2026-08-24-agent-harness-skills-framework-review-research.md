format: csm-deep-research/1

# Agent Harness And Skills Framework Review Research Finding

## TL;DR

Keep CSM as the repository's durable workflow, evidence, and human-handoff layer. Do not present the repository as production-ready until the bootstrap trust gaps, missing CI, and absent live behavioral evaluation are closed. The highest-value expansion is a portable agent runtime contract: versioned skill manifests, permissions and sandbox policy, trajectory/eval records, correlated traces, and MCP/A2A interoperability.

## Executive Summary

This DEEP hybrid review compared the repository against current Agent Skills, MCP, A2A, OpenAI Agents SDK, Google ADK, LangGraph, and Microsoft Agent Framework guidance. The repository has unusually strong deterministic artifact discipline, state journaling, read-only review boundaries, bootstrap hashing, and local conformance tests. Its principal weakness is that the system is stronger as a governed instruction-and-artifact process than as a measurable, interoperable agent harness.

```text
Skill metadata -> CSM workflow -> tools/sandbox -> trajectory + trace
       |               |              |                 |
       v               v              v                 v
 discovery       durable handoff   policy gate       eval + audit
```

The confirmed high-risk issues are the non-production bootstrap trust root and publication deferrals, optional payload binding, and an under-constrained report schema. The strategic gaps are live model evaluation, runtime permission enforcement, portable tool contracts, remote-agent discovery, and operational telemetry. Framework comparison does not justify adopting one vendor runtime wholesale: CSM should remain framework-neutral and borrow the best boundary contracts from the standards and frameworks.

## Key Findings

1. **Supported:** The repository has strong deterministic process and artifact controls, but its instruction-led orchestration skills have no conventional behavioral harness and live-LLM evaluation remains explicitly deferred. [R1][R2]
2. **Supported:** Bootstrap publication is not production-ready: the shipped keyring is marked test-fixture-only, signature enforcement is publication-gated, and release hosting/rotation/replay remain open. [R3][R4]
3. **Supported:** Payload integrity is not cryptographically mandatory for every trusted envelope because `payload_index_sha256` is optional in the validator. [R5]
4. **Supported:** The report JSON schema permits malformed protocol traces because it does not enforce the exact ordered state chain or state/refusal consistency required by the protocol. [R6][R7]
5. **Supported:** The repository lacks a first-class machine-readable manifest for permissions, network policy, sandbox profile, skill version, content digest, eval suite, and trace schema. Agent Skills standardizes only a minimal frontmatter contract; these runtime fields remain repository responsibilities. [R8][R9]
6. **Partially-supported:** The repository is well positioned to adopt trajectory-aware evaluation, but deterministic corpus tests alone cannot establish model activation, tool choice, refusal quality, recovery, or outcome quality. [R1][R10][R11]
7. **Supported:** MCP should be the tool/resource integration boundary and A2A should be considered only for remote opaque-agent collaboration; neither replaces CSM's durable research, planning, build, or review lifecycle. [R12][R13]
8. **Partially-supported:** Current skill files fit the published under-500-line guidance, but several are close enough to the limit that progressive disclosure and reference indexing should be enforced before further growth. [R8][R9]
9. **Supported:** A second static review found cross-skill commit, resume, state-machine, evidence-retention, and publication-boundary defects that weaken the repository's otherwise strong lifecycle claims. [R15]
10. **Supported:** `csm-autoresearch`, `csm-upload`, and `csm-ddd` contain concrete runtime or publication risks: schema/runtime mismatch, unenforced execution limits, redirectable Git publication, missing redaction gates, and unbounded or incompletely redacted persisted data. [R15][R12]
11. **Supported:** The sibling orchestration skills do not consistently enforce explicit commit scoping, durable interruption recovery, clean-review completion, or an explicit incomplete terminal result. [R15]
12. **Partially-supported:** The README and release documentation contain several inaccurate or over-broad claims, but some parallel-review findings were downgraded or retracted after challenge because the README already documents skill-specific boundaries, prerequisites, human-invoked handoffs, and selection guidance. [R15]

## Detail Sections

**1. Existing strengths and architectural position.** The repository has thirteen skills, an explicit research-to-build composition, dated artifacts, state journals, a bootstrap protocol, payload hashes, and broad deterministic suites. Its cleanest architectural distinction is between instruction-led orchestration and executable tooling. That is valuable: OpenAI's testing guidance similarly separates deterministic application-owned orchestration tests from provider/model behavior, while Google ADK evaluates both final responses and trajectories. [R1][R10][R11]

The missing layer is a runtime envelope around each skill:

```text
SKILL.md + manifest + content digest
              |
       host policy decision
              |
   model/tool/sandbox execution
              |
 trajectory + trace + eval result
```

**2. Confirmed bootstrap and protocol defects.** These should be treated as release blockers, not enhancements.

| ID | Severity | Evidence | Risk |
|---|---|---|---|
| F-01 | Critical | `bootstrap/keyring.json` marks `test-fixture-only` and `production_use:false`; `release-checklist.md` leaves publication and rotation open. [R3][R4] | A published installer can look trusted while using a fixture trust root and unsigned local flow. |
| F-02 | High | `csm-skills-bootstrap.js:212-217` checks payload binding only when the envelope carries the field. [R5] | Signature/policy validation need not bind the exact payload index being installed. |
| F-03 | High | `agent-report.schema.json:57-97` allows any 1-7 state entries; protocol requires an exact ordered chain. [R6][R7] | A structurally valid report can claim an invalid execution trace. |
| F-04 | Medium | `Makefile:66` omits `tests/check-suite.test.mjs`, `tests/cache-health.test.mjs`, and `tests/wt-session.test.mjs`, despite documenting them separately. [R1] | The default test command can pass while suite-tooling regressions remain. |
| F-05 | Medium | Allowed-origin validation checks HTTPS and hostname but not port/path. [R5] | Origin pinning is weaker than the policy wording implies. |
| F-06 | Medium | Shell guidance detection is a denylist regex, while the protocol describes the boundary as machine-guaranteed. [R5] | Obfuscation, paraphrase, or an unlisted interpreter may evade a textual policy check. |
| F-07 | Medium | Trust validation is duplicated between the shipped bin and test policy module. [R5] | Security fixes can drift between production and reference validators. |

**3. Skills contract and discoverability gap.** Agent Skills requires a directory with `SKILL.md`, YAML `name`, and `description`; it recommends progressive disclosure, direct one-level references, clear trigger descriptions, and `skills-ref validate`. [R8] The repository satisfies the core shape and has a conformance gate, but its local contract does not expose a standard machine-readable capability manifest. Frontmatter has no portable fields for skill version, compatibility, permissions, network access, sandbox requirements, entrypoints, eval cases, or trace events.

Add a repository-local manifest without pretending it is part of the universal Agent Skills standard:

```json
{
  "schema_version": "csm-skill-manifest/1",
  "skill": "csm-browse",
  "skill_version": "0.1.0",
  "content_sha256": "...",
  "compatibility": {"runtimes": ["opencode", "claude-code"]},
  "permissions": {"filesystem": "scoped", "network": "restricted", "process": "sandboxed"},
  "entrypoints": ["scripts/check-skill.mjs"],
  "eval_suite": "tests/evals/csm-browse",
  "trace_schema": "csm-trace/1"
}
```

The manifest should be generated or validated against `SKILL.md`, payload index, and release digest. Descriptions should also be tested as discovery behavior, not only syntax: the specification says descriptions are the activation contract and should include capability plus context. [R8][R9]

**4. Harness, trajectory, and evaluation gap.** The repository has deterministic tests for executable tools and protocol mechanics, plus canned/stubbed behavior for some instruction skills, but it explicitly defers a live-LLM behavioral harness. [R1][R2] This is the largest agentic-development omission. A modern harness must test at least:

| Evaluation layer | What to record |
|---|---|
| Activation | selected skill, non-selected skills, ambiguity, trigger context |
| Trajectory | tool discovery, calls, arguments, ordering, handoffs, retries, state transitions |
| Safety | refusal, confirmation, least privilege, prompt injection, exfiltration attempt |
| Recovery | timeout, partial failure, resume, cancellation, rollback, compaction |
| Outcome | artifact schema, acceptance signals, citation validity, user-visible result |
| Reproducibility | model/runtime, skill digest, tool-contract version, eval-set version, seed where available |

Use deterministic scripted model/tool boundaries for CSM-owned orchestration, and a separate gated live suite for model selection and natural-language behavior. OpenAI documents scripted models and workflow-drift assertions; Google ADK documents evalsets, trajectory evaluation, rubric criteria, and conformance baselines. [R10][R11] Borrow the separation, not vendor-specific APIs.

**5. Tool, permission, and sandbox governance gap.** MCP guidance requires input validation, access control, rate limiting, output sanitization, timeouts, audit logging, and human control for sensitive calls. It also states that tool annotations are not security controls. [R12] The repository's bootstrap protocol protects installation paths and hashes, but the skill framework does not define a comparable runtime policy for arbitrary skill scripts, network calls, credentials, subprocesses, or browser sessions.

Every executable or side-effecting skill needs an enforceable policy with:

```text
requested capability -> host policy -> user approval if sensitive
                    -> scoped execution -> bounded result -> audit event
```

Documenting permissions in `SKILL.md` is insufficient. The host must enforce them, and the evaluator must include denial tests. Browser containment, credential handling, network egress, command approval, and temporary-file cleanup should be one policy vocabulary shared by bootstrap, browse, autoresearch, and future MCP adapters.

**6. Interoperability omission.** MCP gives a standard JSON-RPC boundary for tools, resources, prompts, schemas, capability negotiation, structured results, and error handling. [R12] A2A gives remote agent discovery through an Agent Card describing identity, endpoint, capabilities, authentication, and skills, with discovery, caching, and selective disclosure guidance. [R13] The repository currently has no MCP server/client contract and no A2A-compatible description or adapter.

Recommended boundary:

```text
Local CSM skill      -> Agent Skills filesystem contract
Deterministic tool   -> MCP tool/resource contract
Remote specialist    -> A2A Agent Card + task lifecycle
Cross-cutting audit  -> OpenTelemetry-compatible trace IDs
```

Do not expose every CSM stage as a remote agent by default. Start with read-only research, scan, review, and evidence capabilities. Keep build and upload behind explicit approval, scoped credentials, and idempotent task contracts.

**7. Observability and operational maturity.** The reviewed frameworks converge on traces, logs, metrics, and trajectory inspection, but the repository records durable artifacts rather than a normalized runtime event stream. [R10][R11] Define a small `csm-trace/1` event model with run ID, parent span, skill/content digest, model/runtime, tool name, permission decision, sandbox action, state transition, status, duration, token/cost counters where available, and redacted error details. Never make raw prompts, secrets, or full tool results the default telemetry payload.

This enables activation-rate, refusal-rate, tool-error, recovery, latency, cost, citation, and task-success dashboards. It also makes the existing resume journals and future live evaluations joinable instead of leaving them as separate artifacts.

**8. Release, governance, and maintenance omissions.** There is no root CI workflow; CI and scheduled dependency audits are explicitly deferred. [R1][R2] Local hooks are useful but bypassable and cannot protect the public release path. The root package remains private and `0.0.0` while the bootstrap package is `0.1.0`, which creates release-identity ambiguity. [R1]

The repository also needs a framework-watch process. External specifications change, and the current sources distinguish vendor documentation from independent evidence. Track versioned snapshots or retrieval records for Agent Skills, MCP, A2A, and selected framework APIs. Keep a compatibility matrix showing what is normative, what is experimental, what is vendor-specific, and what CSM merely recommends.

**9. Cross-skill lifecycle and commit defects.** The second review found that the strongest lifecycle guarantees are not shared consistently across skills. `csm-bdd-tdd` defaults to committing unless the user asks for no commit, and `csm-grill`, `csm-plan`, and `csm-build` use ordinary commits after staging owned files rather than `git commit --only <owned-paths>`. Staging is not a sufficient boundary when unrelated staged files exist. [R15]

Other state and evidence defects are material: `csm-build` has no explicit recovery edge from `BLOCKED` and no clean-review route; `csm-grill`, `csm-make-tests`, and `csm-review-python` lose important progress in disposable state; `csm-make-tests` deletes performance evidence referenced by its report; `csm-review` can save after unresolved verification failures; and `csm-ddd` publishes its report and graph in two separate renames. [R15]

These are not merely documentation inconsistencies. They are contract mismatches between a claimed resumable, receipt-producing harness and the actual terminal/recovery behavior. The common remedy is a shared lifecycle contract with explicit `BLOCKED`, `INCOMPLETE`, `RECOVER`, `CHECKPOINT`, and `SAVED` semantics, plus path-scoped commit verification and durable control metadata.

**10. Runtime and publication boundary defects.** `csm-autoresearch` has a high-confidence schema/runtime mismatch: the run-contract schema describes `policy` as a string while optimizer code dereferences it as an object. Its trusted-local path records or rejects several limits without enforcing network, memory, or process isolation, and registered providers execute callables in-process. [R15]

`csm-upload` can be redirected by Git configuration rewriting despite hostname checks, publishes screenshots/video/DOM/console/network evidence without a redaction and permanence gate, and reports a GitHub Pages URL without verifying deployment readiness. `csm-browse` accepts arbitrary persisted CDP hosts and ports after basic URL validation, and broad consent automation can trigger unintended page actions. [R15]

The DDD path accepts unbounded clarification values and renders repository-derived names and terms outside the currently narrow redaction fields. `csm-scan` also emits unsanitized paths when called as a library rather than through its CLI wrapper. These findings directly reinforce the MCP requirement that validation, access control, output sanitization, timeouts, human confirmation, and auditability must be enforced at the host boundary rather than represented only in metadata. [R12][R15]

**11. Packaging, source-mode, and release-contract defects.** The deep-research instructions contain an internal source-mode contradiction: `web` is defined as web-only, while the generic researcher prompt says to read repository, local docs, and web sources without conditioning on the selected mode. [R15] Packaging authority is also distributed across manifests, packers, tests, and discovery logic, and the committed payload index is not independently compared with payload files because tests regenerate it before checking. [R15]

The release checklist uses `npx --offline --no` although the command grammar requires `--no-install`, and it describes registry replay while current tests replay a local `file:` tarball. These are small textual defects with outsized trust impact because release instructions and test names can imply coverage that was not actually performed. [R15]

**12. README and documentation claims after challenge.** The parallel review correctly identified inaccurate or risky claims, but independent challenge narrowed the set. Uphold: the README presents one-URL bootstrap as an available path even though publication and hosting remain gated; it uses unconstrained `pnpm install` instead of the repository's frozen, script-disabled install; and it reports an inaccurate count of three bootstrap capabilities versus seven protocol fields. [R15]

Downgrade: the lifecycle diagram has visual ambiguity, but its dashed edges and surrounding prose already state that handoffs are separate human invocations. Retract: claims that the README universally promises read-only behavior, omits skill-selection guidance, omits the hook installation command, or misstates VNC/CDP token scope are not supported after re-reading the current README. [R15]

The correct improvement is a skill-by-skill capability matrix, not a blanket rewrite: classify each skill as instruction-only, executable, evidence-producing, publishing, or repository-mutating; state its artifact location, commit behavior, resume guarantee, publication status, and prerequisites; and make README install commands match the tested path exactly.

## Recommendation

Adopt a **CSM-plus-runtime-contract** architecture rather than replacing CSM with LangGraph, OpenAI Agents SDK, Google ADK, or Microsoft Agent Framework.

1. **Release gate:** close F-01 through F-03, F-028, F-035, and F-036 first. Production publication requires a production trust root, mandatory payload binding, strict report-chain validation, accurate release commands, real registry replay, and current all-suite evidence.
2. **Harness gate:** create portable eval fixtures and a runner for activation, trajectory, refusal, permission, recovery, and outcome checks. Include the cross-skill findings as executable regression cases, especially schema/runtime parity, publication redirects, redaction, and incomplete-state handling. Keep deterministic tests separate from gated live-model tests.
3. **Lifecycle gate:** define one shared contract for commit scope, blocked recovery, clean review, incomplete results, durable control journals, evidence retention, and atomic multi-artifact publication. Require `git commit --only` or an equivalent verified pathset for every skill that commits.
4. **Policy gate:** add and enforce the skill manifest fields for permissions, network, sandbox, entrypoints, versions, digests, eval suite, and trace schema. Enforce process, memory, network, CDP, Git, and publication boundaries rather than merely recording them.
5. **Interop gate:** add MCP-compatible tool contracts for deterministic capabilities; defer A2A until a real remote-agent use case exists, then publish authenticated, selectively disclosed Agent Cards with explicit accepted/completed/published/verified task states.
6. **Documentation gate:** correct the bootstrap availability, install command, capability count, registry-replay, and skill-specific lifecycle claims. Keep challenged/retracted README findings out of the remediation scope.
7. **Operations gate:** emit redacted correlated traces and add CI with scheduled dependency/security audits.

Confidence is high for the confirmed repository defects and medium-high for the architecture recommendations. The recommendation changes if the intended scope is only personal local instruction files rather than a distributable agent platform; in that case, CI, A2A, and production signing can remain deferred, but live activation/eval and explicit permission metadata are still valuable.

## Unverified Claims

- **Decision-blocking:** The full test gate was not executed in this review; a prior plan records a `make test` failure, so current recovery status is unknown. [R14]
- **Decision-blocking:** No live model evaluation was executed; activation and trajectory quality are therefore not measured.
- **Material risk:** The exact exploitability of the shell denylist and origin-port/path behavior was not demonstrated with a security test.
- **Material risk:** The intended distribution model, supported hosts, and whether remote agent collaboration is a near-term requirement were inferred from repository documentation.
- **Context-dependent:** A2A may be unnecessary if all skills remain local and human-invoked.
- **Context-dependent:** The proposed manifest and trace schemas are recommendations, not standards mandated by Agent Skills, MCP, or A2A.
- **Informational:** Vendor framework capability pages establish documented features, not comparative reliability, cost, or production superiority.
- **Material risk:** The parallel review was static and did not execute hostile autoresearch, browser, upload, DDD, or publication scenarios; runtime exploitability and operational severity still require targeted tests.
- **Context-dependent:** The README's exact user impact depends on whether users follow the clone/local-install path or the unpublished one-URL bootstrap path.

## References

[R1] Workspace-local file `./README.md`, development/testing and architecture sections, lines 30-40, 60-111, 422-486 — retrieved 2026-08-24.

[R2] Workspace-local file `./.agents/docs/deferred.md`, lines 10-53 — retrieved 2026-08-24.

[R3] Workspace-local file `./bootstrap/keyring.json` — retrieved 2026-08-24.

[R4] Workspace-local file `./bootstrap/release-checklist.md`, lines 5-25 — retrieved 2026-08-24.

[R5] Workspace-local file `./bootstrap/package/bin/csm-skills-bootstrap.js`, lines 28-35, 117-249 — retrieved 2026-08-24.

[R6] Workspace-local file `./bootstrap/protocol.md`, lines 9-15, 60-65, 129-142 — retrieved 2026-08-24.

[R7] Workspace-local file `./bootstrap/agent-report.schema.json`, lines 57-97 — retrieved 2026-08-24.

[R8] Agent Skills specification, https://agentskills.io/specification — retrieved 2026-08-24.

[R9] Anthropic, “Skill authoring best practices,” https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — retrieved 2026-08-24.

[R10] OpenAI Agents SDK, “Testing,” https://openai.github.io/openai-agents-python/testing/ — retrieved 2026-08-24.

[R11] Google Agent Development Kit, “Why evaluate agents,” https://google.github.io/adk-docs/evaluate/ — retrieved 2026-08-24.

[R12] Model Context Protocol, “Tools,” https://modelcontextprotocol.io/specification/2025-06-18/server/tools — retrieved 2026-08-24.

[R13] A2A Protocol, “Agent Discovery,” https://a2a-protocol.org/latest/topics/agent-discovery/ — retrieved 2026-08-24.

[R14] Workspace-local file `./.agents/plans/2026-08-24-remove-token-efficiency-csm.md`, lines 222-225 — retrieved 2026-08-24.

[R15] Workspace-local file `./.agents/reviews/2026-08-24-opencode-skills-review.md`, lines 18-28, 59-376 — retrieved 2026-08-24; challenged against the cited implementation files before inclusion.

## Process Appendix

**Triage.** Tier: DEEP. Source mode: hybrid. Scope assumption: “repo and its architecture” means the current `opencode-skills` repository, its executable bootstrap/tooling, its instruction-led skills, and its intended use as a distributable agent-skill platform. Tracks: (1) local architecture and skill inventory, (2) local assurance and security audit, (3) current agent harness comparison, (4) skills/MCP/A2A interoperability, and (5) evaluation and observability practice.

**Research reports.** Independent read-only tracks returned local findings and primary-source framework evidence. Vendor documentation was treated as capability evidence only, not as proof of reliability or superiority.

**Challenge and judgment.** The main adversarial challenge was whether the repository should adopt a named vendor framework. That position was rejected: the evidence supports borrowing boundary patterns while preserving CSM's framework-neutral artifact lifecycle. A second challenge independently checked the parallel review's 36 findings: high-risk runtime/publication findings were upheld; F-027 was retracted; F-029 and F-030 were narrowed; F-032 was narrowed; F-033 and F-034 were retracted; F-011 was merged as one shared root cause; and F-022 was narrowed to packaging/test authority duplication.

**Verification.** All material findings were mapped to workspace-local files or direct retrieved URLs with retrieval dates. No credentials, tokens, private keys, or personal data were included. The review did not execute repository code. The initial baseline was clean; the current worktree contains this research document and the parallel review artifact supplied for incorporation. No commit was created because the user requested a report update, not a commit, and repository-level commit authorization was not explicit.

**Control journal.**

[2026-08-24T00:00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: user requested DEEP research review of the skills repository against current agent harnesses and skills frameworks; protected baseline recorded.
[2026-08-24T00:00:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: hybrid mode and five non-overlapping research tracks selected.
[2026-08-24T00:00:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: local inventory, local assurance audit, framework research, interoperability research, and evaluation research returned.
[2026-08-24T00:00:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft separated confirmed defects, strategic gaps, and conditional recommendations.
[2026-08-24T00:00:00Z] CHALLENGE -> JUDGE :: cycle 0 :: trigger: adversarial review rejected wholesale framework replacement and tested evidence posture.
[2026-08-24T00:00:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: narrowed claims about release readiness, current test status, and interoperability scope.
[2026-08-24T00:00:00Z] REMEDIATE -> VERIFY :: cycle 0 :: trigger: citations, uncertainty labels, framework caveats, and report structure completed.
[2026-08-24T00:00:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: required nine-part shape, citations, redaction, and write scope checked; no commit created per higher-level repository commit policy.
[2026-08-24T00:00:00Z] Post-SAVED addendum :: cycle 1 :: trigger: user supplied a parallel review artifact with 36 additional candidate findings and requested incorporation; this is a user-requested report addendum, not a new implementation run.
[2026-08-24T00:00:00Z] TRIAGE -> RESEARCH :: cycle 1 :: trigger: four issue areas expanded into cross-skill lifecycle, runtime/publication, packaging/source-mode, and README-contract tracks.
[2026-08-24T00:00:00Z] RESEARCH -> SYNTHESIZE :: cycle 1 :: trigger: parallel review evidence and independent local challenge returned.
[2026-08-24T00:00:00Z] SYNTHESIZE -> CHALLENGE :: cycle 1 :: trigger: candidate findings mapped to underlying files and current Agent Skills/MCP/evaluation guidance.
[2026-08-24T00:00:00Z] CHALLENGE -> JUDGE :: cycle 1 :: trigger: findings were upheld, narrowed, merged, or retracted according to independent challenge results.
[2026-08-24T00:00:00Z] JUDGE -> REMEDIATE :: cycle 1 :: trigger: report expanded with cross-skill findings, corrected README conclusions, and updated gates.
[2026-08-24T00:00:00Z] REMEDIATE -> VERIFY :: cycle 1 :: trigger: references, uncertainty labels, process scope, and fixed headings updated.
[2026-08-24T00:00:00Z] VERIFY -> SAVED :: cycle 1 :: trigger: report structure and citation scope rechecked; only the report was edited by this session and no commit was created.
