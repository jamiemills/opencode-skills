# Configuration Inventory and No-Config Behavioral Baseline

- Task: T001 of plan `all-skills-config-production-assurance` (`.agents/plans/2026-08-27-all-skills-config-production-assurance-csm.json`)
- Scope: all 14 skills plus the shared libraries they consume. Read-only inspection; no source, schema, or runtime behavior was modified to produce this document.
- Purpose: freeze the complete defaults/authority/side-effect/configurability picture (AC1) before any suite config envelope (T002) or adapter migration (T003-T005) exists.
- Baseline commit at inspection time: `bfe6075` (plus untracked build state for this run).

## Method

Every claim below was read out of the current working tree with `file:line` references.
Values are classified per the plan's taxonomy:

| Classification             | Meaning                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **immutable invariant**    | Contract/safety property that no configuration layer may ever change (schemas, fail-closed gates, authority rules, redaction pipelines).          |
| **host ceiling**           | Resource or security bound owned by the host; configuration may only narrow it, never widen it.                                                   |
| **skill-owned behavior**   | Native default the skill itself owns; an adapter may expose it only behind the skill's own namespace schema without changing the no-config value. |
| **user setting candidate** | Value that is already operator-facing (CLI flag, env var, prompted value) or is a safe candidate for a future suite config namespace.             |
| **fixture**                | Test-only constant or synthetic identity that must never leak into production behavior.                                                           |

**No-config baseline definition (DR4):** with no CLI flags, no environment variables, and no
config files present, every skill must behave exactly as documented below. Refusal states
(missing required arguments) are part of the baseline, not deviations from it.

## Shared foundations (consumed by the 14 skills)

These are cross-cutting surfaces every adapter migration must preserve.

- **Consumer edge registry** — `lib/consumer-adapters/index.mjs:9-23` defines the five typed
  producer->consumer edges (`scan->review`, `ddd->plan`, `research->grill`,
  `research->make-tests`, `review->grill`) with schema/owner/consumer triples. Envelope,
  lifecycle (`completed`), and verification (`verified`) gates at `lib/consumer-adapters/index.mjs:46-54`
  are **immutable invariants**; Markdown inputs are rejected with `migration-required`
  (`lib/consumer-adapters/index.mjs:38-39`).
- **Artifact resolver bounds** — `DEFAULT_ARTIFACT_RESOLVER_LIMITS` at
  `lib/artifact-resolver/index.mjs:17-24` (maxDepth 8, maxFiles 256, maxTotalBytes 64 MiB,
  maxPerFileBytes 8 MiB, maxJsonlRecords 1024, maxInFlightResolutions 8). Overrides can only
  narrow: `lib/artifact-resolver/index.mjs:32-36` rejects any value above the bounded default.
  Classification: **host ceiling**.
- **Durable JSON I/O** — symlink-free path assertions, `O_NOFOLLOW`, stable reads, and
  recovery codes at `lib/durable-json/index.mjs:12-19`; writes default to mode `0o600` with
  `0o700` parent dirs (`lib/durable-json/index.mjs:96-106`) and JSONL appends `0o600`
  (`lib/durable-json/index.mjs:128-131`). Classification: **immutable invariant**.
- **Schema registry** — `schemas/registry.json` (57 entries, `revisionPolicy: immutable`,
  `unknownRevisionPolicy: reject`, per-entry `unknownFieldPolicy: reject`). This is the closest
  existing thing to a suite-wide config mechanism and is the registration point T002-T005 must
  extend. Classification: **immutable invariant**.
- **Makefile gates** — `lint` (`Makefile:14-15`), `fmt-check` (`Makefile:20-21`), `check`
  (`Makefile:34-35`), `test-orchestrate` (`Makefile:51-52`), `test-e2e` env-gated by
  `CSM_BROWSE_E2E_REQUIRE=1` (`Makefile:87`). Classification: **host ceiling** (repo tooling).
- **Root `.env`** — gitignored (`.gitignore`), holds live deployment credentials. No skill or
  library in this repository loads it (no dotenv consumer exists in `csm-*/`, `lib/`, or
  `scripts/`). Names are recorded here; values must never appear in any artifact (enforced by
  `tests/config-baseline/inventory.test.mjs`). Classification: **host-owned secrets, not config**.

**Confirmed:** no suite-wide configuration loader, no `.csm-skills.json`, and no
`$XDG_CONFIG_HOME/csm/skills.json` consumer exists today. The only config surfaces are CLI
flags, per-run JSON contracts/schemas, one legacy upload config file, and csm-browse env overrides.

## csm-autoresearch

### Defaults and magic values

- Evaluator JSONL line cap `MAX_LINE_BYTES = 1024 * 1024` — `csm-autoresearch/lib/protocol/index.mjs:3` (**immutable invariant**, transport bound).
- Default evaluator output cap `DEFAULT_OUTPUT_BYTES = 1024 * 1024` — `csm-autoresearch/lib/runtime/index.mjs:10`, applied at `csm-autoresearch/lib/runtime/index.mjs:108` (**host ceiling**).
- Required evaluator limits `["timeoutMs", "maxOutputBytes", "maxWorkspaceBytes"]` — `csm-autoresearch/lib/providers/generated.mjs:6` (**immutable invariant**).
- Sandbox host capability symbol `HOST_CAPABILITY` — `csm-autoresearch/lib/providers/generated.mjs:7` (**immutable invariant**: generated code cannot run without host-provided sandbox).
- Trial/proposal budgets are mandatory contract fields, validated at `csm-autoresearch/lib/optimizer/index.mjs:62-71`; default stop reason `"trial_budget"` (`:346`), proposal exclusion (`:359`), trial exclusion (`:373`) (**skill-owned behavior** per run contract; ceiling semantics).
- Terminal-blocked statuses `{"sandbox_unavailable", "blocked", "policy_violation"}` — `csm-autoresearch/lib/optimizer/index.mjs:23`; isolation modes limited to `trusted-in-process | snapshot-process | verified-sandbox` (`:45`, `csm-autoresearch/schemas/policy.schema.json:64`) (**immutable invariant**).

### CLI flags and options

- `scripts/evaluate.mjs` takes no flags: exactly one JSONL request on stdin, one response on stdout (`csm-autoresearch/scripts/evaluate.mjs:14-20`); without a configured executor it answers `blocked` with zero-hash provenance (`:23-37`) — the offline no-config behavior (**immutable invariant**, fail closed).
- `scripts/probe-sandbox.mjs --required` — exits 1 when the sandbox is unavailable (`csm-autoresearch/scripts/probe-sandbox.mjs:7`).

### Environment variables

- None read directly (verified by `process.env` sweep). Credentials for live evaluators are host-injected, not suite config.

### Output paths and artifacts

- Append-only ledger `.agents/autoresearch/<yyyy-mm-dd>-<run-id>-ledger.jsonl` and atomic report `.agents/autoresearch/<yyyy-mm-dd>-<run-id>-report.json` — `csm-autoresearch/SKILL.md:31-33` (**skill-owned behavior**; runId-suffixed immutability is an **immutable invariant**).

### Side effects

- Reads: declared callables/evolution regions, datasets. Writes: ledger + report only.
- Executes: candidate code, but only inside a verified sandbox; generated sources fail closed offline (`make test-autoresearch` documented at `Makefile:73-74`). No network, browser, or publication by the skill itself.

### Classification

- Transport/protocol caps and sandbox gating: **immutable invariant**. Output/workspace byte caps: **host ceiling** (narrow-only). Budgets and policy object: **skill-owned behavior** supplied per run contract. Ledger/report location: **skill-owned behavior**. Test executors with zero-hash provenance: **fixture**.

### Existing config mechanisms

- Per-run `csm-autoresearch-contract/1` (budgets, callable/region) and `csm-autoresearch-policy/1` (`csm-autoresearch/schemas/policy.schema.json`, required keys at `:7`) — configuration is the run contract itself, not a file hierarchy.

### Adapter seam

- Run-contract/policy JSON input plus the stdin/stdout JSONL evaluator protocol (`lib/protocol/index.mjs`). Provider tiers (`registered`, `trusted-local`, `generated`) are the trust boundary an adapter must not blur.

## csm-bdd-tdd

### Defaults and magic values

- Synthetic package identities `artifactId: "art-bdd-package"` / `runId: "run-bdd-package"` and source-plan fixture lineage — `csm-bdd-tdd/lib/package.mjs:71-79` (**fixture**).
- `producedAt` defaults to `new Date().toISOString()` and journal resume rows default to `"resume requested"` — `csm-bdd-tdd/lib/package.mjs:155` (**skill-owned behavior**).

### CLI flags and options

- None; library-only skill (`csm-bdd-tdd/lib/package.mjs` is the whole runtime surface).

### Environment variables

- None.

### Output paths and artifacts

- JSON package artifact validated by `csm-bdd-tdd-package/1` (`csm-bdd-tdd/schemas/package.schema.json`); the mutated plan descriptor supersedes its base plan and ends in `-bdd-csm.json` (consumed per `csm-build/SKILL.md` "Locate The Plan"). Specs folder scenario/unit-test-design paths are part of task evidence (**skill-owned behavior**).

### Side effects

- Reads: the validated source plan. Writes: BDD/TDD package + spec and unit-test design files. Executes: nothing. No network/browser/publication.

### Classification

- TDD ordering (red -> green -> refactor) and JSON-only machine inputs: **immutable invariant**. Package/spec artifact ownership: **skill-owned behavior**. Synthetic identities: **fixture**.

### Existing config mechanisms

- None beyond the package schema itself.

### Adapter seam

- Consumed exclusively through `csm-build/lib/bdd-input-resolver.mjs` (`resolveBddInput` validates plan + package lineage, rejects absolute/traversing paths at `csm-build/lib/bdd-input-resolver.mjs:14-21` and Markdown with `migration-required` at `:23-24`).

## csm-browse

### Defaults and magic values

All in `csm-browse/lib/constants.mjs` unless noted:

- `SESSIONS_ROOT = CSM_BROWSE_SESSIONS_ROOT || defaultSessionsRoot()` — `:7`; validation at import time `:8`.
- Container: `CONTAINER_NAME = "chromium-vnc"` `:9`; digest-pinned image `jlesage/chromium@sha256:7514...210e` `:15-16`; `IMAGE_PINNED_AT = 2026-08-20` `:21`; `IMAGE_MAX_AGE_MS` = 90 days `:22` with `assertImageFresh` `:26-33`.
- Host config paths: `VNC_PASS_PATH = ~/.config/csm-browse/vnc-pass` `:37`; `CONTAINER_CONFIG_DIR = ~/.config/csm-browse` `:40` (+ `container-config`, `container.env`, `container-token`, `shared-gate.log` `:41-44`).
- Network hardening: `CONTAINER_NETWORK = "csm-browse-net"` `:51`; `CONTAINER_CAP_DROP` (NET_RAW, SYS_ADMIN, SYS_PTRACE, NET_ADMIN, MKNOD, SETFCAP, AUDIT_WRITE) `:52-60`; `CONTAINER_MEMORY "4g"`, `CPUS "4"`, `PIDS_LIMIT 1024`, `SHM_SIZE "1g"` `:61-64`; read-only rootfs + tmpfs + `no-new-privileges` in `DOCKER_RUN_CMD` `:79-92`.
- Ports: `SHARED_CDP_PORT 9222` (host funnel, token-gated) `:69`; `CONTAINER_CDP_INTERNAL_PORT 9223` `:78`; per-session port pool `9224-9234` `:94-95`; VNC published on `127.0.0.1:5900` `:90`.
- Identity/limits: `SID_REGEX "^[a-z0-9][a-z0-9_-]{0,40}$"` `:96`; screencast quality 70 / 1920x1080 / every frame `:100-103`; `MAX_STITCH_HEIGHT_PX 16384` `:104`; `RECORDER_FRAME_BUFFER_CAP 60` `:105`; VP9 video presets small/medium/full `:106-124`; speed presets slow=3/medium=7/fast=15 `:126`; `CMD_TIMEOUT_MS 30000` `:127`; `CMD_POLL_INTERVAL_MS 500` `:128`; `DAEMON_READY_TIMEOUT_MS 10000` `:129`; `CDP_RETRY_TIMEOUT_MS 30000` `:130`; `EVENTS_JSONL_ROTATION 2000` `:131`; `CHROMIUM_FLAGS` (no-sandbox, disable-gpu/webgl, ...) `:132-142`; `CHROMIUM_BIN /usr/lib/chromium/chromium` `:93`.

### CLI flags and options

- `scripts/browse.mjs <verb> --session <sid> [args...]` — `csm-browse/scripts/browse.mjs:46`; verbs map to `lib/verbs/{capture,close,dom,input,log,nav,record,status}.mjs`; verb modules are existence-checked before dynamic import (`:66-72`).
- `scripts/ensure-browser.mjs --session <sid> [--dry-run] [--cleanup-stale] [--age MINS]` — `csm-browse/scripts/ensure-browser.mjs:85`.
- `scripts/session-daemon.mjs --session <sid>` — `csm-browse/scripts/session-daemon.mjs:28`.
- `scripts/cdp-gate.mjs --sid --port --internal --container [--log]` (token via env, never argv) — `csm-browse/scripts/cdp-gate.mjs:403`, rationale at `:19`.
- Verb-level options (SKILL.md verb table): `screenshot [--small|--medium|--full] [--viewport] [--quality N] [outPath]`, `screencast-start <name> [--small|--medium|--full] [--speed slow|medium|fast]`, etc. — `csm-browse/SKILL.md:73-80`.

### Environment variables

- `CSM_BROWSE_SESSIONS_ROOT` — `csm-browse/lib/constants.mjs:7`, re-resolved in security checks at `csm-browse/lib/security.mjs:295` (**user setting candidate**).
- `CSM_BROWSE_REVEAL_COOKIES=1` — gates cookie value reveal, `csm-browse/lib/verbs/log.mjs:226` (**host ceiling**: explicit per-run unlock only).
- `CSM_CDP_GATE_TOKEN` — CDP funnel token, `csm-browse/scripts/cdp-gate.mjs:400`, injected into the container env at `csm-browse/lib/docker.mjs:205` (**host-owned secret, never config**).
- `XDG_RUNTIME_DIR` — session root default, `csm-browse/lib/security.mjs:10` (**user setting candidate**, XDG standard).
- `CSM_BROWSE_FIXTURE_BASE` — tests only (`csm-browse/lib/constants.mjs:97-99` comment) (**fixture**).

### Output paths and artifacts

- Session dirs `$XDG_RUNTIME_DIR/csm-browse/<sid>/` falling back to `~/.local/state/csm-browse/<sid>/` — `csm-browse/SKILL.md:128`; screenshots/videos under `artifacts/` — `csm-browse/SKILL.md:139`.
- Validated descriptors `.agents/browse/<session-id>/state.json` and `events.jsonl` — `csm-browse/SKILL.md:15` (**skill-owned behavior**; outside-repo writes are a documented ownership boundary).

### Side effects

- Executes `docker` (create/start/exec, image pull on demand), launches a persistent `session-daemon` background process, binds loopback ports, renders via CDP (network through the browser), writes session state/events/artifacts. No publication.

### Classification

- Image digest pin, cap-drop set, no-new-privileges, read-only rootfs, off-default-bridge network, port/loopback rules, token-gating, SID regex: **immutable invariant** (browser hardening the plan forbids config from touching).
- Container memory/cpu/pids/shm and byte/frame caps: **host ceiling** (narrow-only).
- Screencast/video/speed presets, quality, timeouts, poll intervals: **skill-owned behavior**, several already CLI-exposed (**user setting candidates**).
- Sessions root and fixture base: **user setting candidate**. Test helper constants: **fixture**.

### Existing config mechanisms

- Env overrides (`CSM_BROWSE_SESSIONS_ROOT`) plus per-verb CLI flags. No config file.

### Adapter seam

- CLI verb modules (`lib/verbs/*.mjs` exporting `run({args, state, verb, sid})`) and module-level constants in `lib/constants.mjs` — the natural non-authoritative adapter surface (T005) for presentation preferences only.

## csm-build

### Defaults and magic values

- State identities default `runId = "run-build"`, `artifactId = "art-build"` — `csm-build/lib/state.mjs:86-87` (**fixture**-grade defaults; real runs supply plan-derived IDs).
- `timestamp = new Date().toISOString()` — `csm-build/lib/state.mjs:90` (**skill-owned behavior**).
- BDD input resolution defaults `root = process.cwd()` — `csm-build/lib/bdd-input-resolver.mjs:16` (**skill-owned behavior**).
- Skill-doc constants: NORMS.md staleness warning threshold >30 days, tmux session naming `csm-build-<goal-slug>`, prefix-sharing dispatch rules — `csm-build/SKILL.md` (**skill-owned behavior**).

### CLI flags and options

- None (agent-orchestrated skill; `--progress` is the only documented opt-in flag — `csm-build/SKILL.md` "Optional Progress Tracker").

### Environment variables

- `TMUX` / tmux session detection — `csm-build/SKILL.md` "Tmux Session Bootstrap" (**host environment sensing**, not configuration).

### Output paths and artifacts

- Durable build state `.agents/builds/<date>-<goal-slug>-build.json` (`csm-build-state/1`, validated by `csm-build/schemas/state.schema.json`); the plan JSON itself is updated in place at every checkpoint (**skill-owned behavior**; append-only journal semantics are **immutable invariant**).

### Side effects

- Reads everything; executes arbitrary repo tooling (make, node, git) via dispatch; may commit only on explicit per-invocation user authorization; never pushes unprompted. Dispatches subagents but never sibling skills.

### Classification

- State-machine states and transition rules, commit/push authorization, activation boundary: **immutable invariant** (authority). Journal append-only + `COMPLETE`/`BLOCKED` immutability: **immutable invariant**. Tracker opt-in, tmux naming, NORMS staleness threshold: **skill-owned behavior** / **user setting candidates**. Default state IDs: **fixture**.

### Existing config mechanisms

- The plan JSON `control` block (cycle, `commits: allowed`, resume cursor) and optional NORMS.md conventions input; `commits: allowed` is explicitly NOT commit authorization (**immutable invariant**).

### Adapter seam

- Plan discovery over `.agents/plans/*.json` with supersession pointers (`csm-build/SKILL.md` "Locate The Plan"), `lib/bdd-input-resolver.mjs`, and `lib/state.mjs` validation — T005's adapter must not let config touch authority fields.

## csm-ddd

### Defaults and magic values

- Scan limits `DEFAULT_LIMITS = { maxFiles: 2000, maxBytes: 2_000_000, maxFileBytes: 1_000_000 }` — `csm-ddd/lib/ddd/extract.mjs:13-16`, merged with caller overrides at `:310` (**host ceiling**; CLI can only shrink via positive ints).
- Artifact path template `.agents/ddd/<date>-<slug>-<runId>-ddd-{report,graph}.json` — `csm-ddd/lib/ddd/pipeline.mjs:164-174`; runId charset guard `:167-168`.
- Publication sidecar files `.ddd-publication.json`, `.ddd-publication.lock`, `.ddd-publication.recovery.lock`, `.ddd-generations/` — `csm-ddd/lib/ddd/pipeline.mjs:176-186` (**skill-owned behavior**; lock/pointer semantics are **immutable invariant**).
- Output paths must be absolute and contained under the analyzed root — `csm-ddd/lib/ddd/pipeline.mjs:188-199` (**immutable invariant**).

### CLI flags and options

- `--repo ROOT` (required), `--norms PATH`, `--out-report PATH`, `--out-graph PATH`, `--question-file PATH`, `--non-interactive`, `--fail-on-gaps` (implies non-interactive), `--max-files N`, `--max-bytes N`, `--max-file-bytes N` — `csm-ddd/scripts/ddd.mjs:21-34`; unknown option or missing `--repo` exits 2 (`:83-92`); `--fail-on-gaps` with remaining gaps exits 3 (`:128-133`).

### Environment variables

- None.

### Output paths and artifacts

- Report/graph JSON pair + publication pointer under `.agents/ddd/` (defaults above). Pre-write schema validation refuses to write on failure (`csm-ddd/scripts/ddd.mjs:101-107`) (**immutable invariant**).

### Side effects

- Reads the target repo (bounded); executes read-only git commands (`csm-ddd/lib/ddd/git.mjs`); may prompt interactively (readline) unless `--non-interactive`; writes the artifact pair + pointer/locks. No network/browser/publication.

### Classification

- Path containment, runId/pointer/lock semantics, fail-closed validation: **immutable invariant**. Scan limits: **host ceiling**. Interactive-vs-gaps default (disclose, exit 0): **skill-owned behavior** (**user setting candidate** via flags). Question-file replay inputs: **fixture**.

### Existing config mechanisms

- CLI flags only; no config file.

### Adapter seam

- CLI flag parser (`csm-ddd/scripts/ddd.mjs:49-88`) and the published-pair reader consumed cross-skill via `lib/consumer-adapters/index.mjs:7,93-121` (`ddd->plan` edge, `csm-ddd-pair/1` descriptor).

## csm-deep-research

### Defaults and magic values

- Identity prefixes `run-`/`art-` and derived run/artifact IDs — `csm-deep-research/lib/research.mjs:46,180-181` (**skill-owned behavior**).
- `producedAt` defaults to now — `csm-deep-research/lib/research.mjs:140`; title defaults to `"Research Finding"` — `:143` (**skill-owned behavior**).

### CLI flags and options

- None (agent-driven; `lib/research.mjs` is the library seam).

### Environment variables

- None directly; the csm-browse fallback inherits that skill's env contract.

### Output paths and artifacts

- One run-ID-suffixed finding `.agents/research/<date>-<slug>-<run-id>-research.json`; declared run artifacts under `.agents/research/artifacts/<date>-<slug>-<run-id>-<name>.<ext>` — `csm-deep-research/SKILL.md:37` (**skill-owned behavior**; single-finding write discipline is **immutable invariant**).

### Side effects

- Network retrieval of documentation/web sources; browser rendering only via the csm-browse fallback restricted to read-only verbs (`open/wait/wait-selector/text/html/eval/screenshot/status/close`) — `csm-deep-research/SKILL.md:440`; sessions closed before SAVED, idle sweep after 10 minutes — `:452`. Writes only the finding + declared artifacts. No publication.

### Classification

- Author/challenger/judge role separation and citation discipline: **immutable invariant**. QUICK vs standard source mode: **user setting candidate**. Browse verb allowlist: **immutable invariant**. Output paths: **skill-owned behavior**.

### Existing config mechanisms

- None beyond the run's declared inputs (question, source mode).

### Adapter seam

- `csm-research/1` artifact (`csm-deep-research/schemas/csm-research.schema.json`) consumed downstream via `research->grill` and `research->make-tests` edges.

## csm-grill

### Defaults and magic values

- `producerVersion = "csm-grill/1"` — `csm-grill/lib/approach.mjs:40` (**skill-owned behavior**).
- `runId`/`artifactId` derived from `{ideaSlug, producedAt}` when absent — `csm-grill/lib/approach.mjs:50-51`; `producedAt` defaults to now `:46`; default status `"agreed"` `:54`; projection `csm-grill-human/1` with `legacyMarkdownStatus: "history-only"` (**skill-owned behavior**; schema identity is **immutable invariant**).

### CLI flags and options

- None.

### Environment variables

- None.

### Output paths and artifacts

- One authoritative approach `.agents/approaches/<date>-<idea-slug>-<run-id>-approach.json` — `csm-grill/SKILL.md:67,160`; legacy `.md` approach paths read-only history `:68` (**skill-owned behavior** + **immutable invariant** for JSON-only machine input).

### Side effects

- Reads idea + research evidence; writes exactly the approach file (creating only its directory) — `csm-grill/SKILL.md:160`. No execution, network, browser, or publication.

### Classification

- Decision/phase schema and Markdown-rejection: **immutable invariant**. Default status/identities: **skill-owned behavior**. Approach save location: **skill-owned behavior**.

### Existing config mechanisms

- None; the approach artifact records grill decisions but is an output, not a config input.

### Adapter seam

- `csm-grill/lib/input-resolver.mjs` delegates to shared consumer edges `research->grill` and `review->grill` (`csm-grill/lib/input-resolver.mjs:3-9`) — the canonical input-resolver pattern T003 generalizes.

## csm-make-tests

### Defaults and magic values

- Ledger/approval writes use durable atomic write mode `0o600` — `csm-make-tests/lib/ledger.mjs:82` (**immutable invariant**).
- Scratch dir pattern `mktemp -d /tmp/csm-make-tests-XXXXXX`, deleted at OUTPUT — `csm-make-tests/SKILL.md:113` (**skill-owned behavior**; host TMPDIR respected by mktemp).

### CLI flags and options

- None.

### Environment variables

- None.

### Output paths and artifacts

- Exactly two run-owned artifacts: `.agents/tests/<date>-<repo-slug>-<run-id>-tests-ledger.jsonl` (append-only) and `.agents/tests/<date>-<repo-slug>-<run-id>-verification.json` — `csm-make-tests/SKILL.md:109-111`; generated tests/fixtures/benchmarks plus test-required config snippets inside the target repo `:108` (**skill-owned behavior**; the two-file allowlist is **immutable invariant**).

### Side effects

- Reads the pinned checkout, optional NORMS.md, cited research; writes tests/fixtures/benchmarks; executes the generated suites, mutation tooling, and benchmarks during verification; temp dir removed before OUTPUT; never touches credentials or `.env` values — `csm-make-tests/SKILL.md:113`. No commits without explicit authorization, no network/browser/publication.

### Classification

- Write allowlist, ledger append-only, secrets prohibition: **immutable invariant** / **host ceiling**. Temp dir location: **user setting candidate** (TMPDIR). Mutation gate thresholds and coverage policy inside references: **skill-owned behavior** (documented playbooks `csm-make-tests/references/*.md`). Golden fixtures: **fixture**.

### Existing config mechanisms

- None file-based; conventions arrive via optional NORMS.md artifact.

### Adapter seam

- `csm-make-tests/lib/input-resolver.mjs` (edge `research->make-tests`) and the `csm-make-tests-ledger/1` / `csm-make-tests-verification/1` / `csm-test-package/1` schema trio handed to csm-build.

## csm-orchestrate

### Defaults and magic values

- Retry budget default `maxAttempts = 2` — `csm-orchestrate/lib/recovery.mjs:208`, bounds validated `:216-217`, exhaustion stops with `retry-budget-exhausted` `:220-221` (**skill-owned behavior** bounded by policy; non-idempotent side effects refuse retry `:222-229` — **immutable invariant**).
- Capability contract per sibling skill (activation predicate, permissions, effects, `approvalClass`, `retryability`, idempotency key, recovery, parallelism, reviewLevel, terminal statuses) — `csm-orchestrate/capabilities.json` (**immutable invariant** as registered; content-digest pinned).

### CLI flags and options

- None — programmatic API `orchestrate()` / `createOrchestrator()` re-exported from `csm-orchestrate/index.mjs`.

### Environment variables

- None.

### Output paths and artifacts

- Parent receipt `csm-orchestrate-receipt/1` with child lineage, evidence, gate, review, outcome; durable cursor via the injected checkpoint store. No default filesystem cursor store exists — hosts must supply durable `saveCursor`/`loadCursor` (`csm-orchestrate/SKILL.md` Contract) (**immutable invariant**; the exact seam T006 fills with SQLite WAL).

### Side effects

- None directly: sibling invocation happens only through the injected host adapter with edge-bound approvals; missing host/capability/approval/evidence fails closed (`csm-orchestrate/SKILL.md` Contract). Never invokes itself.

### Classification

- Host-adapter requirement, approval binding, evidence/review gates, monotonic receipts: **immutable invariant** (authority — config can never grant these). Default retry budget and remediation bounds: **skill-owned behavior** / bounded **user setting candidates**. Fixture host in tests: **fixture**.

### Existing config mechanisms

- `capabilities.json` + per-run canonical approach JSON and scoped approvals; deliberately no file config.

### Adapter seam

- Host adapter interface (`invokeSiblingSkill`, approval provider, cursor store, deterministic evidence callbacks) — `csm-orchestrate/SKILL.md` Operator Handoff; config adapter (T005) may add only non-authoritative request context.

## csm-plan

### Defaults and magic values

- Canonical plan path pattern `.agents/plans/<date>-<goal-slug>-csm.json` — `csm-plan/lib/plan.mjs:9` (**skill-owned behavior**; JSON-only machine input is **immutable invariant**).
- `producedAt` defaults to now — `csm-plan/lib/plan.mjs:350`; derived `artifactId` prefix `art-` `:372`; journal resume row default `"resume requested"` `:565` (**skill-owned behavior**).

### CLI flags and options

- None (agent skill; no script CLI).

### Environment variables

- None.

### Output paths and artifacts

- One saved verified canonical JSON plan at the pattern above; Markdown is a disposable projection; `.md` plans are read-only history requiring migration — `csm-plan/SKILL.md:124-126` (**immutable invariant** for machine input, **skill-owned behavior** for location).

### Side effects

- Reads brief/evidence artifacts and the repo; temporary R&D writes allowed only inside a disposable `/tmp` sandbox proven outside the repo — `csm-plan/SKILL.md:53,108-114`; the plan document is the sole intentional persistent write. No daemons, no network publication.

### Classification

- Plan schema/state machine, activation boundary, sandbox containment rules: **immutable invariant**. R&D spike optionality, validation depth: **skill-owned behavior**. Plan location pattern: **skill-owned behavior** (path is discoverable, not user-configurable today).

### Existing config mechanisms

- None file-based; plan content itself carries decisions/constraints.

### Adapter seam

- `csm-plan/lib/input-resolver.mjs` with the frozen `INPUTS` map of eight artifact kinds (plan/approach/research/review/doctrine/norms/ddd — `csm-plan/lib/input-resolver.mjs:6-14`) — the richest existing typed-input seam and the template for T003 adapters.

## csm-review

### Defaults and magic values

- Producer descriptor contract `csm-review/producer.json` (**skill-owned behavior**; owner identity is **immutable invariant**).
- Report path template `.agents/reviews/<date>-<repo-slug>-<run-id>-review.json`; same-day same-slug requires a new run ID; terminal reports immutable (no replace/delete/rename/`latest` alias) — `csm-review/SKILL.md:83,91` (**immutable invariant**).

### CLI flags and options

- None.

### Environment variables

- None.

### Output paths and artifacts

- The single JSON findings artifact above; legacy `.md` compatibility path read-only history — `csm-review/SKILL.md:83`. `.agents/doctrine/` writes are owned by csm-review-python, recorded here only as read-only handoff evidence `:84,91`.

### Side effects

- Clones the target into a temp sandbox, executes read-only analysis commands inside it, post-step containment checks (`git status` clean-or-explained, env-scrub) — `csm-review/SKILL.md:78`; writes are limited to the report file + sandbox `:49`. Never commits unless explicitly requested. No publication.

### Classification

- Write-discipline allowlist, containment checks, terminal immutability: **immutable invariant**. Sandbox location: **user setting candidate** (temp). Severity/evidence vocabulary: **skill-owned behavior** (never config-widened per T003 exclusions).

### Existing config mechanisms

- None; optional NORMS.md artifact input only.

### Adapter seam

- `csm-review/lib/input-resolver.mjs` (edge `scan->review`, `csm-norms/1`) and findings-validator (`csm-review-findings/1`); output feeds `review->grill`.

## csm-review-python

### Defaults and magic values

- Bundled doctrine rules `csm-review-python/artifact/python-idiomatic-reviewer-rules.json` and consolidated research `csm-review-python/artifact/pep20-idiomatic-python-consolidated-research.md` (**skill-owned behavior** — doctrine payload, versioned with the skill, not user config).
- Producer descriptor `csm-review-python/producer.json` (**immutable invariant** owner identity).

### CLI flags and options

- None.

### Environment variables

- None.

### Output paths and artifacts

- Authoritative `.agents/doctrine/<date>-<repo-slug>-<run-id>-python-doctrine-review.json` — `csm-review-python/SKILL.md:27`; write allowlist is exactly this file + parent dir `:69`; legacy `.md` path read-only history `:27`.

### Side effects

- Reads the target Python repo; non-resumable by design — every invocation gets a new run ID, terminal-artifact/path-ownership collisions are explicit refusals — `csm-review-python/SKILL.md:35`. Writes only the report. No execution of target code, no network/publication.

### Classification

- Allowlist, non-resumability, collision refusal, JSON-only authority: **immutable invariant**. Doctrine ruleset content: **skill-owned behavior**. Report location: **skill-owned behavior**.

### Existing config mechanisms

- None; doctrine is bundled, not configured.

### Adapter seam

- `csm-review-python/lib/findings-validator.mjs` (`csm-doctrine-findings/1`); dispatched only by explicit human/csm-review handoff; consumed by csm-plan's `doctrine` input kind.

## csm-scan

### Defaults and magic values

- CLI defaults: repos = `[cwd]`, out = `<cwd>/NORMS.json` — `csm-scan/scripts/scan.mjs:86-87` (**no-config baseline**; **user setting candidate** via `--out`).
- Skill-canonical artifact path `.agents/norms/<date>-<repo-slug>-<run-id>-norms.json` — `csm-scan/SKILL.md:44` (**skill-owned behavior**; see Collisions below).
- Atomic write mode `0o600`, `quarantine: false` — `csm-scan/lib/scan/write.mjs:21`; canonical output must be a `.json` path — `:33-35` (**immutable invariant**).
- Version resolution order package.json -> git hash -> `"csm-scan"` — `csm-scan/scripts/scan.mjs:140-142`.
- Verbose trace file name `.csm-scan-debug-<pid>-<time>.log` next to `--out` or OS temp dir — `csm-scan/scripts/scan.mjs:147` (**host ceiling**: unredacted local-only artifact, gitignored).

### CLI flags and options

- `--repos <path>...`, `--out <path>`, `--verbose`, `--help`, `--version` — `csm-scan/scripts/scan.mjs:16-31`; unknown options are errors `:80-82`; user-typed CLI args may be echoed verbatim on stderr (documented exception) `:33-36`.

### Environment variables

- None.

### Output paths and artifacts

- One authoritative JSON norms artifact at `--out` (default `./NORMS.json`; skill convention `.agents/norms/...`); `NORMS.md` is a disposable projection — `csm-scan/SKILL.md:44`. Unwritable `--out` fails with exit 1 — `csm-scan/SKILL.md:210`.

### Side effects

- Strictly read-only scan of target repos (never runs install/build commands — skill description); executes `git log` read-only for version fallback — `csm-scan/scripts/scan.mjs:128`; exactly one write to `--out`; `--verbose` additionally writes an unredacted local trace. Privacy filtering runs before any persistence and aborts the run on sensitive values — `csm-scan/SKILL.md:156`. No network/browser/publication.

### Classification

- Redaction/privacy pipeline, deterministic render, single-write discipline: **immutable invariant**. Trace verbosity/retention: **host ceiling**. `--repos`/`--out`: **user setting candidates**. Default cwd/`NORMS.json`: **no-config baseline** (**skill-owned behavior**). Plugin fixtures and baselines under `csm-scan/test/`: **fixture**.

### Existing config mechanisms

- None file-based. NORMS.json is an output consumed by other skills (scan->review edge, csm-plan norms input) — not scan configuration. T003 must keep effective write semantics explicit so config cannot broaden output scope.

### Adapter seam

- CLI flag parser (`csm-scan/scripts/scan.mjs:47-93`) plus `csm-norms/1` schema artifact; `assertCanonicalOutputPath` is the write-boundary guard.

## csm-upload

### Defaults and magic values

- Legacy config path `CONFIG_PATH = ~/.agents/csm-upload.json` — `csm-upload/scripts/upload.mjs:10` (**user setting candidate**; legacy file the plan forbids silently migrating).
- Isolated git env: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_GLOBAL = CSM_UPLOAD_GIT_CONFIG || "/dev/null"`, `GIT_TERMINAL_PROMPT=0` — `csm-upload/scripts/upload.mjs:182-190` (**immutable invariant**: ambient user git config never consulted).
- Identity regexes `GITHUB_RE = /^[A-Za-z0-9-]{1,39}$/`, `PAGES_REPO_RE = /^[A-Za-z0-9._-]+$/`, host-pinned `https://github.com/...` clone URL — `csm-upload/scripts/upload.mjs:196-217` (**immutable invariant**).
- Safe-filename regex plus sensitive-name/extension refusal (env/credentials/secrets/tokens/cookies/private-key; .pem/.key/.p12/.pfx/.kdbx) — `csm-upload/scripts/upload.mjs:160-174` (**immutable invariant**).
- Demo directory `demo-<yyyy-mm-dd>-<label>` (label sanitized) and `BASE_URL = https://<user>.github.io/<repo>` — `csm-upload/scripts/upload.mjs:535-547` (**skill-owned behavior**).
- First-run config bootstrap: prompts for `github`/`pagesRepo`, saves with dir `0o700` / file `0o600` — `csm-upload/scripts/upload.mjs:335,345-346`; malformed config is never overwritten (F8-07) `:263-269` (**immutable invariant** for failure mode).
- Preview temp dir prefix `csm-upload-preview-` with SIGINT/SIGTERM cleanup — `csm-upload/scripts/upload.mjs:383-386,474-477` (**skill-owned behavior**).
- Diagnostic redaction of tokens/temp paths — `csm-upload/scripts/upload.mjs:176-180` (**immutable invariant**).

### CLI flags and options

- `--label <name>` (required), `--desc <text>`, `--github <user>`, `--repo <name>`, `--dry-run`, `--confirm-permanent`, `--ack-unscanned-binary` (alias `--ack-unscanned-binary-content`), positional files — `csm-upload/scripts/upload.mjs:229-253`.

### Environment variables

- `CSM_UPLOAD_GIT_CONFIG` — disposable git config for tests — `csm-upload/scripts/upload.mjs:188` (**fixture**-oriented override; ambient config is deliberately unreachable).

### Output paths and artifacts

- Published `demo-<date>-<label>/` directory (index.html + files) on the GitHub Pages branch of the pages repo; local dry-run preview index.html under the tracked temp dir. Config file at `~/.agents/csm-upload.json`.

### Side effects

- Network: clones and pushes to github.com over https, uses `gh`; publication to GitHub Pages is permanent and gated behind `--confirm-permanent` — `csm-upload/scripts/upload.mjs:248-252` (**immutable invariant**: publication authority is a CLI-only explicit act, never config). Binary uploads require scan acknowledgment `:152-156`. Writes config on first run.

### Classification

- Publication gate, git-env isolation, identity/filename safety, no-silent-overwrite: **immutable invariant**. `github`/`pagesRepo`/label/desc: **user setting candidates** (prompted + flags + legacy file). Demo dir naming and BASE_URL derivation: **skill-owned behavior**. `CSM_UPLOAD_GIT_CONFIG`: **fixture**.

### Existing config mechanisms

- The legacy `~/.agents/csm-upload.json` file is the suite's only pre-existing persistent user config. T004 adds a suite-config adapter beside it with explicit collision handling; legacy mode and CLI behavior must remain unchanged.

### Adapter seam

- CLI flag parser + `loadConfig()` (`csm-upload/scripts/upload.mjs:256-296`) and `csm-upload/schemas/publication.schema.json` via `csm-upload/lib/publication.mjs`.

## Ownership collisions and no-config baseline summary

1. **csm-scan effective writes**: the CLI default writes `./NORMS.json` in the cwd
   (`csm-scan/scripts/scan.mjs:87`) while the skill contract names
   `.agents/norms/<date>-<repo-slug>-<run-id>-norms.json` (`csm-scan/SKILL.md:44`). The
   effective write location is operator-chosen; downstream consumers must resolve via the
   registry/envelope, never assume either path. A future config namespace must not broaden the
   single-write discipline.
2. **csm-upload legacy config**: `~/.agents/csm-upload.json` predates the suite envelope and
   collides with the future `csm-upload` namespace; the plan requires explicit collision
   handling and forbids silent merge/rewrite (D-exclusions, T004).
3. **csm-browse out-of-repo writes**: session/artifact state lives under `$XDG_RUNTIME_DIR` /
   `~/.local/state` while repo-scoped verification baselines (e.g. csm-deep-research VERIFY)
   treat browse writes as external — an adapter must keep session roots out of repo-scoped
   write allowlists.
4. **csm-orchestrate cursor authority**: no default durable cursor store exists; the seam is
   host-injected by design. T006 adds SQLite WAL behind `saveCursor`/`loadCursor` without
   granting filesystem-artifact authority to config.
5. **Root `.env`**: unconsumed by suite code; values are live secrets. Inventory records names
   only; `tests/config-baseline/inventory.test.mjs` fails if any `.env` value appears in this
   document.
6. **No-config baseline (current, green)**: with no flags/env/config — csm-scan writes
   `./NORMS.json` for the cwd repo; csm-ddd refuses to run (exit 2, `--repo` required);
   csm-upload refuses to run (exit 1, `--label` required); csm-browse refuses to run (exit 1,
   verb + `--session` required); library/agent skills (grill, plan, review, review-python,
   deep-research, make-tests, bdd-tdd, build, orchestrate, autoresearch) operate with the
   identity/timestamp defaults above and write only their run-ID-suffixed `.agents/`
   artifacts. Baseline suites pass: `node --test --test-concurrency=1 tests/orchestrate-*.test.mjs tests/check-suite.test.mjs`
   (104 pass / 0 fail at inspection time), plus `make test-orchestrate`, `make check`,
   `make fmt-check` enforced by `tests/config-baseline/parity.test.mjs`.

## Unresolved risks (carried to T002+)

- Live secrets sit in the root `.env`; the future `${VAR_NAME}` expansion (D4) persists resolved values and requires the documented retention/access/export controls before any production status (DR3).
- csm-browse's digest-pinned image and hardening constants are security-critical; classifying any of them as configurable — even narrow-only — needs an explicit host-ceiling policy in T005, not just a schema.
- The csm-scan cwd-default write (`./NORMS.json`) can surprise operators running from a repo root; a future default must remain a no-config-compatible behavior change decision, not an adapter side effect.
- csm-orchestrate's `maxAttempts = 2` retry default interacts with at-least-once effect semantics; any configurable budget must remain subordinate to idempotency/authority rules (T006).
- The 57-entry schema registry is the de-facto central contract; adding 14 skill namespaces multiplies registry surface and drift risk (mitigated by existing bootstrap parity gates).

## Suite configuration resolver (T002)

Implemented by `schemas/csm-skills-config.schema.json` (registered as immutable
`csm-skills-config/1`) and `lib/config/index.mjs`; tested by
`tests/config-envelope.test.mjs`, `tests/config-resolver.test.mjs`, and
`tests/config-security.test.mjs`.

- **Envelope**: closed transport object — `schema` (const `csm-skills-config/1`),
  optional `version` (must be `1` when present), and `skills` constrained to exactly
  the 14 namespaces above (`additionalProperties: false` at both levels). Namespace
  payloads are per-skill-owned opaque objects until the T003-T005 per-skill schemas
  tighten them.
- **Locations**: built-in defaults, then project `<repo root>/.csm-skills.json`,
  then user `$XDG_CONFIG_HOME/csm/skills.json` (absolute only; relative values are
  ignored per the XDG spec) falling back to `$HOME/.config/csm/skills.json`, then
  one explicit per-run `configPath`. Path constants: `PROJECT_CONFIG_FILE_NAME`,
  `USER_CONFIG_DIR_NAME`, `USER_CONFIG_FILE_NAME` plus `projectConfigPath()` /
  `userConfigPath()` helpers.
- **Merge semantics**: objects merge recursively, arrays replace wholesale, `null`
  is an explicit surviving value, omitted keys inherit, unknown top-level keys and
  unknown skill namespaces are rejected with the offending key and JSON path.
- **Environment references**: one-pass `${VAR_NAME}` substitution in string values
  only (never keys), grammar `[A-Za-z_][A-Za-z0-9_]*`; substituted text is never
  rescanned; malformed references and missing variables fail closed. Per D4/DR3 the
  resolved values may be persisted — provenance records variable **names only**
  (`envRefs`), and retention/access/export controls remain a production blocker.
- **File handling**: strict JSON with duplicate-key rejection (schema-runtime
  `parseJson`), symlink-free regular files only (durable-json `readDurableBytes`
  patterns: `O_NOFOLLOW`, component checks, concurrent-replacement detection),
  bounded to 1 MiB and JSON depth 32 (`LIMITS`). Missing project/user files are
  absent layers; a missing explicit per-run path is a hard error.
- **Provenance**: `resolveConfig()` returns `{ schemaVersion, effective,
effectiveDigest, sources, envRefs }` where `sources` lists each layer's
  `kind` (`defaults|project|user|run`), resolved `path`, `present`, and canonical
  `contentDigest`; `effectiveDigest` (`computeEffectiveDigest`) is a canonical
  sha256 over the merged snapshot, so equivalent inputs with different key order
  produce identical digests.

## Read-only skill config adapters (T003)

Seven read-only analysis/review skills now own independently registered config
schemas and thin adapters that consume the T002 resolver's `effective` envelope.
No existing runtime code, skill entrypoint, CLI signature, artifact owner, or
lifecycle changed: adapters are new library modules that callers may adopt;
nothing invokes them yet.

- **Adapter contract** — each `csm-<skill>/lib/config.mjs` exports `SKILL_NAME`,
  `CONFIG_SCHEMA_ID`, `DEFAULT_CONFIG` (frozen native settings), and
  `resolveSkillConfig(effectiveConfig)`. The function extracts
  `effectiveConfig.skills[SKILL_NAME]`, validates it against the skill's
  registered schema, and returns `{ config, schema, source }` — `config` is a
  frozen `DEFAULT_CONFIG`-overlay (partial namespaces keep unset defaults),
  `schema` is the registered schema id, and `source` is `"defaults"` (namespace
  absent or empty, matching the resolver's built-in layer) or `"configured"`.
  Failures throw coded errors: `unknown-key` (unknown namespace key, named in
  the message), `skill-config` (type/enum/range violation), `config-schema`
  (malformed effective envelope, fail closed).
- **Registration** — all seven schemas are immutable `unknownFieldPolicy:
"reject"` entries in `schemas/registry.json`; the envelope itself keeps
  treating namespaces as opaque objects, so per-skill tightening happens only
  at the adapter (the resolver deliberately passes unknown keys through for
  other skills to reject in their own namespaces).

| Skill               | Schema id                    | Settings (defaults)                                        | Boundary                                                                                    |
| ------------------- | ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `csm-grill`         | `csm-grill-config/1`         | `verbosity` ("normal")                                     | Presentation only; no approach/decision/lifecycle authority.                                |
| `csm-plan`          | `csm-plan-config/1`          | `verbosity` ("normal"), `batchSize` 1-20 (5)               | Planning preferences only; no sandbox/activation/lifecycle authority.                       |
| `csm-deep-research` | `csm-deep-research-config/1` | `defaultTier` ("STANDARD"), `defaultSourceMode` ("hybrid") | Triage defaults only, still per-run overridable; no browse/verb/citation authority.         |
| `csm-ddd`           | `csm-ddd-config/1`           | `maxFiles` 1-5000 (2000), `maxBytes` 1-10000000 (2000000)  | Narrow-only scan caps mirroring `DEFAULT_LIMITS`; no path/artifact/pointer authority.       |
| `csm-review`        | `csm-review-config/1`        | `verbosity` ("normal")                                     | Presentation only; severity/evidence vocabulary stays skill-owned.                          |
| `csm-review-python` | `csm-review-python-config/1` | `mode` "static" \| "tool-assisted" ("static")              | Bounded analysis mode; never executes target code; doctrine content not configurable.       |
| `csm-scan`          | `csm-scan-config/1`          | `maxRetries` 0-5 (2), `outputFormat` ("json", enum pinned) | `outputFormat` accepts only `json` — config cannot broaden the effective NORMS write scope. |

- **Authority boundary (negative contract)** — no namespace schema contains
  `credentials`, `lifecycle`, `writeScope`, or any capability/destination
  field; `additionalProperties: false` makes every such attempt an
  `unknown-key` failure. Tests exercise this per skill.
- **Tests** — `tests/config-readonly-adapters/` (one file per skill plus shared
  `helpers.mjs`) covers, for every adapter: (a) no-config differential —
  resolver output with all layers absent, a hand-built built-in envelope, and a
  namespace-less envelope all produce `DEFAULT_CONFIG` with `source
"defaults"`; (b) valid settings applied over defaults (full and partial
  overlays); (c) unknown keys rejected end-to-end (written `.csm-skills.json`
  through `resolveConfig`) and directly; (d) invalid types/enums/ranges
  rejected; (e) unrelated namespaces — including values invalid for this skill
  — ignored; (f) `credentials`/`lifecycle`/`writeScope` rejected.
- **Acceptance signal**: `node --test --test-concurrency=1
tests/config-readonly-adapters/*.test.mjs` — 49 pass / 0 fail at
  implementation time (7 tests per skill).
- **Bootstrap parity** — new files under mapped source directories
  (`csm-{grill,plan,deep-research,review,review-python}/lib`, and all seven
  `schemas/` dirs) were mirrored by re-running `scripts/pack-bootstrap.mjs`
  (F-008); `csm-ddd/lib` and `csm-scan/lib` sit outside the packer mapping
  (only `csm-ddd/lib/ddd` and `csm-scan/lib/scan` ship) and join the payload
  at T010's canonical regeneration together with `lib/config` itself.

## Artifact-producing skill config adapters and legacy compatibility (T004)

The three artifact-producing/upload skills now join the suite-config plane on
the same adapter contract as T003: new library modules beside each skill,
independently registered immutable schemas, and no change to any existing
runtime code, entrypoint, CLI signature, artifact owner, or lifecycle. Nothing
invokes the adapters yet; callers may adopt them.

- **Adapter contract** — each `csm-<skill>/lib/config.mjs` exports `SKILL_NAME`,
  `CONFIG_SCHEMA_ID`, a frozen `DEFAULT_CONFIG`, and
  `resolveSkillConfig(effectiveConfig)` returning `{ config, schema, source }`
  (`csm-upload` additionally returns `legacyMode`, also mirrored inside
  `config`). Failure codes match T003: `unknown-key` (named key), `skill-config`
  (type/enum/range), `config-schema` (malformed envelope, fail closed).
- **Registration** — `csm-bdd-tdd-config/1`, `csm-make-tests-config/1`, and
  `csm-upload-config/1` are immutable `unknownFieldPolicy: "reject"` entries in
  `schemas/registry.json`.

| Skill            | Schema id                 | Settings (defaults)                                            | Boundary                                                                                                                                |
| ---------------- | ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `csm-bdd-tdd`    | `csm-bdd-tdd-config/1`    | `outputStyle` ("standard"), `includeTraceability` (`true`)     | Presentation of generated spec/test designs only; package ownership, TDD ordering, artifact ownership, and lifecycle are never granted. |
| `csm-make-tests` | `csm-make-tests-config/1` | `testDimensions` (all four), `maxFiles` 1-1000 (100)           | Bounded generation preferences; write scope, ledger authority, approval ledgers, and mutation gates stay skill-owned.                   |
| `csm-upload`     | `csm-upload-config/1`     | `github`/`pagesRepo`/`label` (all optional, no suite defaults) | Additive only: legacy `~/.agents/csm-upload.json` and CLI flags remain authoritative; publication authority is never granted.           |

- **csm-upload legacy compatibility contract** — the adapter documents and
  enforces that the legacy `~/.agents/csm-upload.json` file and CLI flags
  (`--github`, `--repo`, `--label`) stay the authoritative source for existing
  behavior. `loadLegacyConfig({ env })` reads the legacy file with durable-json
  security (symlink-free regular file, bounded, concurrent-replacement
  detection) and fails closed (`legacy-config`) on malformed JSON, non-object
  roots, or wrongly typed known fields, mirroring the script's own
  no-silent-overwrite stance. `resolveSkillConfig(effective, { legacy })`
  merges additively: legacy-set fields always win, suite values fill only
  unset fields, unknown legacy keys are tolerated exactly like the legacy
  loader, and the result reports `legacyMode` (legacy config exists). The
  adapter never writes, rewrites, migrates, or deletes the legacy file —
  verified by byte-and-mtime invariance tests.
- **Legacy artifact compatibility** — `tests/legacy-artifact-compatibility.test.mjs`
  (extended, prior cases untouched) re-verifies that Markdown artifacts remain
  `migration-required` machine-input rejections (now also for nested paths),
  that JSONL negotiation through the artifact resolver is unchanged, and that
  terminal build artifacts (`COMPLETE`/`BLOCKED`) stay immutable
  (`terminal-immutable` on any reopen attempt).
- **Tests** — `tests/config-artifact-adapters/` (per-skill files plus shared
  `helpers.mjs`) covers for each adapter: (a) no-config differential parity
  with native defaults; (b) valid settings applied (full and partial);
  (c) unknown keys rejected end-to-end through `resolveConfig()` and directly;
  (d) invalid enums/ranges/types rejected; (e) unrelated namespaces ignored;
  (f) authority non-escalation — `credentials`, `lifecycle`, `writeScope`,
  `commit`, `push`, `publish` all rejected as `unknown-key`. csm-upload adds:
  legacy/suite coexistence, suite-never-overrides-legacy-fields, legacy file
  never modified or created, malformed legacy fails closed, unknown legacy
  keys tolerated.
- **Acceptance signal**: `node --test --test-concurrency=1
tests/config-artifact-adapters/*.test.mjs
tests/legacy-artifact-compatibility.test.mjs` — 31 pass / 0 fail at
  implementation time; prerequisite `make test-upload` 20/20.
- **Bootstrap parity** — `csm-bdd-tdd/{lib,schemas}`, `csm-make-tests/{lib,schemas}`,
  and `csm-upload/{lib,schemas}` were already mapped packer sources;
  re-running `scripts/pack-bootstrap.mjs` (F-008) mirrored the six new files
  plus the registry update into `bootstrap/package/**` and regenerated
  `bootstrap/payload-index.json`.

## High-risk skill config adapters and executable orchestration semantics (T005)

The four high-risk skills (browser automation, evaluator-driven hill climbing,
plan execution, orchestration) join the suite-config plane on the same adapter
contract as T003/T004, with deliberately minimal namespaces: every field is a
bounded preference that cannot grant authority. Nothing invokes the adapters
yet; callers may adopt them.

- **Adapter contract** — each `csm-<skill>/lib/config.mjs` exports `SKILL_NAME`,
  `CONFIG_SCHEMA_ID`, a frozen `DEFAULT_CONFIG`, and
  `resolveSkillConfig(effectiveConfig)` returning `{ config, schema, source }`.
  Failure codes match T003/T004: `unknown-key` (named key), `skill-config`
  (type/enum/range), `config-schema` (malformed envelope, fail closed).
- **Registration** — `csm-browse-config/1`, `csm-autoresearch-config/1`,
  `csm-build-config/1`, and `csm-orchestrate-config/1` are immutable
  `unknownFieldPolicy: "reject"` entries in `schemas/registry.json`.

| Skill              | Schema id                   | Settings (defaults)                                                                    | Boundary                                                                                                                                                    |
| ------------------ | --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `csm-browse`       | `csm-browse-config/1`       | `viewport` ("default"), `screenshotQuality` ("standard"), `cleanupAgeHours` 1-720 (24) | Bounded capture preferences only; ports, CDP endpoints, tokens, credentials, container settings, origins, cookies, and browser hardening are never granted. |
| `csm-autoresearch` | `csm-autoresearch-config/1` | `logVerbosity` ("standard"), `archiveLimit` 1-1000 (100)                               | Presentation and retention only; live mode, sandbox policy, evaluator selection, evolution regions, and budgets are never granted.                          |
| `csm-build`        | `csm-build-config/1`        | `verbosity` ("normal"), `reportStyle` ("standard")                                     | Presentation only; dispatch decisions, write scope, commit/push authorization, and lifecycle transitions are never granted.                                 |
| `csm-orchestrate`  | `csm-orchestrate-config/1`  | `defaultTimeoutMs` 1000-300000 (30000), `maxParallelism` 1-4 (4)                       | Bounded execution preferences only; host selection, capabilities, approvals, gates, trust roots, and autonomy are never granted.                            |

- **Executable activation predicates** — `csm-orchestrate/lib/phase-compiler.mjs`
  now exports `evaluateActivationPredicate(capability, phase, signals)`. When a
  capability's `activation.predicate` (already present in
  `csm-orchestrate/capabilities.json`) parses as a simple condition — `or`/`and`
  combining phrase terms, a term led by `explicit` satisfied by an explicit
  skill request, every other term requiring all its words in the phase text —
  the predicate is authoritative for non-explicit conditional routing. A
  trailing single-word `or` arm (the "review" in "before planning or review")
  reads as a phrase continuation, not a standalone arm. Unparseable or absent
  predicates fall back to the previous heuristic hint matching; `explicit` mode
  and explicit requests short-circuit exactly as before.
- **Remediation budget consumption** —
  `csm-orchestrate/lib/adversarial-final-review.mjs` tracks a run-level
  `remediationBudget` metadata object (`total`, `consumed`, `remaining`,
  `cycles`, `exhausted`) on the phase graph. The total initial budget is the
  sum of `remediationBudget` over non-insert phases (missing values count as
  1). Each inserted remediation decrements the remaining budget by its declared
  cost; when cycles or consumption would exceed the total, coordination
  returns `BLOCKED` with `routing.reason: "remediation-budget-exhausted"`
  instead of inserting another phase. `csm-orchestrate-final-review/2` gained
  the `BLOCKED` status and a `remediationBudget` property (registry digest
  updated).
- **Physical graph insertion ordering** — when
  `insertion.insertedAfter` is set, the remediation phase is now physically
  inserted directly after the anchor phase in the graph's `phases` array (not
  appended), `order` fields are re-indexed for all subsequent phases, and the
  coordinated result's `remediation` field references the inserted phase. The
  execution loop in `csm-orchestrate/lib/index.mjs` skips already-executed
  phase IDs, so a mid-array insertion runs the remediation exactly once
  without re-invoking completed sibling phases, then resumes the final review.
- **Tests** — `tests/config-high-risk-adapters/` (per-skill files plus shared
  `helpers.mjs`) covers for each adapter: (a) no-config differential parity
  with native defaults; (b) valid settings applied (full and partial);
  (c) unknown keys rejected end-to-end through `resolveConfig()` and directly;
  (d) invalid enums/types/range bounds rejected (including both range edges
  accepted); (e) unrelated namespaces ignored; (f) authority non-escalation —
  per-skill hostile fields (ports, tokens, credentials, container, origins,
  cookies / live mode, sandbox, evaluator, budgets, execute / dispatch,
  write scope, commit, push, lifecycle / host, capabilities, approvals,
  gates, trust roots, autonomy) all rejected as `unknown-key`.
  `tests/orchestrate-activation-predicates.test.mjs`,
  `tests/orchestrate-remediation-budget.test.mjs`, and
  `tests/orchestrate-insertion-ordering.test.mjs` (with shared
  `tests/helpers-final-review.mjs`) cover predicate evaluation/fallback/export,
  budget decrement/exhaustion/BLOCKED (unit and end-to-end), positional
  insertion with re-indexed orders (unit), and end-to-end mid-array insertion
  without re-execution.
- **Acceptance signal**: `node --test --test-concurrency=1
tests/config-high-risk-adapters/*.test.mjs tests/orchestrate-*.test.mjs` —
  116 pass / 0 fail at implementation time (28 adapter + 88 orchestrate,
  including the 73 pre-existing orchestrator tests); prerequisites
  `make test-browse` and `make test-autoresearch` (70/70) green.

## SQLite WAL durable coordination store (T006)

- **Driver/version spike (prerequisite, recorded before dispatch)**: the
  built-in `node:sqlite` `DatabaseSync` is the selected driver — zero new
  dependencies (`package.json` unchanged). Verified on nvm Node
  **v22.23.2** via `scripts/with-node22.mjs`: available without any flag
  (stderr `ExperimentalWarning` only), `PRAGMA journal_mode=WAL` activates
  and persists across connections (`-wal`/`-shm` sidecars observed),
  `busy_timeout` honored, and rows survive close/reopen. Supported range for
  the sqlite backend: Node >= 22.13 (first unflagged minor) and < 25 per the
  repo `engines` field; `node:sqlite` exists but is flagged on 22.5-22.12,
  where the store degrades to the pure-JS engine described below.
- **Swappable driver seam**: `lib/orchestration-store/index.mjs` exports
  `createSqliteStore(options)` plus `resolveSqliteDriver()`. The store
  INTERFACE is the contract; the driver is swappable. Options:
  `databasePath` (default: temp-dir file), `mode` `"wal"` (default) or
  `"memory"`, `driver` `"auto"`/`"node-sqlite"`/`"memory-js"`, `now` for
  deterministic timestamps, `synchronous`, `busyTimeoutMs`. Backend is
  reported via `getBackendInfo()` (`durable: false` when WAL was requested
  but `node:sqlite` is unavailable — never silently pretending a Map is
  durable).
- **Schema (migration v1, `STORE_SCHEMA_VERSION = 1`)**: the agreed tables —
  `schema_version`, `cursors` (revision CAS), `fencing_tokens` (monotonic
  token per cursor, `UNIQUE(cursor_id)`), `approvals` (one-time
  consumption), `idempotency` (unique key), `dispatch_intents`,
  `events` (append-only history), `terminal_receipts` (monotonic),
  `reconciliations` (UNKNOWN tracking) — plus two deliberate additions:
  `cursors.document` (full cursor JSON so `loadCursor` round-trips the
  schema-validated `csm-orchestrate-cursor/2` document byte-faithfully) and
  lookup indexes on `events.cursor_id`, `terminal_receipts.run_id`,
  `reconciliations.child_run_id`, `dispatch_intents.cursor_id`. Migrations
  run under `BEGIN IMMEDIATE` with a bootstrap version ledger; replay is
  idempotent and concurrent fresh opens converge.
- **Semantics**: `saveCursor(cursor, {expectedRevision, fencingToken})`
  CAS-upserts (revision bumps each write; mismatch throws
  `CasMismatchError`; stale token throws `StaleFenceError`);
  `claimCursor(cursorId, expectedRevision)` is an atomic CAS claim returning
  `{revision, fencingToken}` (tokens strictly monotonic per cursor);
  `consumeApproval`/`recordIdempotency` are one-time (typed errors on
  replay); `createDispatchIntent` keys deterministic intent ids by
  `(cursorId, childRunId, fencingToken)` — a new fencing token is a new
  logical attempt — and rejects stale/unissued tokens plus any child run
  with an open `UNKNOWN` reconciliation (`ReconciliationRequiredError`);
  `resolveDispatchIntent` is idempotent per status and refuses conflicting
  re-resolution; `appendEvent`/`getHistory` are append-only and
  sequence-ordered; `saveTerminalReceipt` is monotonic
  (`MonotonicTerminalError`, never overwrite terminal);
  `loadTerminalReceipt`/`loadTerminalRecords` reconstruct receipts
  (`loadTerminalRecords` maps `VERIFIED`->completed, `REJECTED`->failed,
  `REQUIRES_REVIEW`/`BLOCKED`->blocked, unknown->blocked, fail-closed) so
  the optional `cursorStore.loadTerminalRecords` seam keeps working;
  `recordReconciliation(childRunId, "UNKNOWN"|"RESOLVED-*")` is one-way
  (UNKNOWN -> resolved, resolved outcomes immutable);
  `recordLateResult` always records an event, resolves an open UNKNOWN, and
  never touches terminal receipts; `close()` is idempotent and later calls
  throw `StoreClosedError`.
- **UNKNOWN/reconciliation contract**: ambiguous timeout/cancellation of a
  possibly-effectful child records `UNKNOWN`; dispatch for that child is
  rejected at the store until an explicit reconciliation resolves it; late
  results are recorded as events and may resolve UNKNOWN, but cannot
  overwrite terminal receipts or a resolved reconciliation. Retrying under a
  fresh fencing token is a new logical attempt.
- **Tests**: `tests/orchestration-store/` (`cas.test.mjs`,
  `atomic-ops.test.mjs`, `multiprocess.test.mjs` + `child-process.mjs`
  fixtures, each core suite parametrized over sqlite-wal, sqlite-:memory:,
  and the memory-js fallback) covers CAS races (exactly-one-winner,
  in-process and across 4 spawned OS processes), fencing (stale token
  cannot write or dispatch), one-time approvals, duplicate idempotency keys,
  atomic intent create/resolve, ordered replayable history, monotonic
  terminal receipts, UNKNOWN gating + late results, two stores on one file,
  hard-exit crash recovery from WAL, and migration replay/race.
  `tests/orchestrate-recovery-sqlite.test.mjs` runs the real
  `orchestrate()` to VERIFIED with the store as `cursorStore`, reopens the
  database, and re-classes the durable cursor through the real
  `classifyResume` (side-effecting checkpoint classifies
  `ambiguous-side-effecting-checkpoint`, never an unsafe restart), plus the
  timeout->UNKNOWN->reconcile->redispatch flow.
- **Known pre-existing orchestrator quirk (not introduced here; T006 scope
  excludes csm-orchestrate source)**: fully re-running `orchestrate()` over
  cursors left by a completed side-effecting phase hits a resume-blocked
  path whose gate failure omits the schema-required `message`
  (`invalid csm-orchestrate-gate/1: /failures/0`); reproduced with a plain
  Map cursorStore, so the integration test asserts the resume seam via
  `classifyResume` instead of a full re-orchestration.
- **Limitations (per plan D5/DR5)**: single local host, non-network
  filesystem only; SQLite coordinates local metadata and does not prove
  external-effect completion — effects remain at-least-once with
  reconciliation and sink idempotency; cross-machine HA, DBOS/PostgreSQL,
  and sink-side exactly-once remain out of scope.
- **Acceptance signal**: `node scripts/with-node22.mjs --exec node --test
--test-concurrency=1 tests/orchestration-store/*.test.mjs
tests/orchestrate-recovery-sqlite.test.mjs` — 48 pass / 0 fail at
  implementation time; `make lint`, `make fmt-check`, and `make check`
  (1244 checks, no payload drift) green; no new dependencies.

## Host assurance attestations, independent signal validators, and correlated telemetry (T007)

- **Scope**: three NEW csm-orchestrate modules providing the host-assurance
  protocol boundary for future integration — `csm-orchestrate/lib/attestation.mjs`,
  `lib/validators.mjs`, `lib/telemetry.mjs` — plus closed registered schemas
  (`csm-orchestrate-attestation/1`, `csm-orchestrate-validator/1`,
  `csm-orchestrate-telemetry-event/1`). No existing orchestrator runtime file
  (index/invocation/contracts/recovery/etc.) was modified; the modules are
  interfaces for integration, not yet wired into the execution loop.
- **Attestation envelopes** (`createHostAttestation` / `createReviewerAttestation`
  / `createValidatorAttestation`, all delegating to `createAttestation`): each
  envelope binds `kind` (host/reviewer/validator), `issuer`, `subject`
  (run-/phase-/edge-/cursor- id), `audience`, `requestDigest`, `inputSetDigest`,
  `policyDigest` (all sha256 canonical digests via the shared schema-runtime
  `digest`), `result`, `nonce` (16-128 chars, auto-generated `n-<uuid>` when
  absent), `issuedAt`/`expiresAt` (5-minute default TTL), `keyEpoch` (>= 1,
  deployment key-rotation anchor), and `attestationDigest` — the canonical
  digest over the envelope minus itself, so any post-issuance field change is
  detectable locally. `verifyAttestation(attestation, context)` performs
  STRUCTURAL verification only: shape, issuer presence, digest-binding
  recomputation, audience match (`wrong-audience`), expiry (`expired`),
  request/inputSet/policy digest match against context expectations
  (`digest-mismatch`), key epoch match (`key-epoch-mismatch`), and one-time
  nonce consumption through a caller-supplied `Set`-like `nonceLog`
  (`nonce-reused` on replay). Signature verification over a real trust anchor
  is deliberately a deployment concern (see limitations).
- **Independent signal validators** (`createSignalValidator`,
  `validateSignal`): a definition binds `signalId`, `validatorId`, `version`,
  `inputSchema`, `predicate` (`string-contains` w/ pattern, `schema-valid`,
  or `digest-match` w/ expectedDigest), `policyDigest`, and a computed
  `validatorDigest` over the definition minus itself. `validateSignal` runs
  the predicate over the immutable artifact snapshot's ACTUAL `value` (a
  `producerClaim`/`producerResult` field may exist on the snapshot and is
  never read) and returns `{signalId, validatorId, validatorVersion,
artifactId, artifactDigest, result: pass|fail, predicateType, evaluatedAt}`.
  A tampered definition (recomputed `validatorDigest` mismatch) throws before
  any evaluation. Example deterministic evaluators are exported directly:
  `deterministicStringContains(artifact, pattern)`,
  `deterministicSchemaValid(artifact, schema)` (input schemas are compiled
  through the shared schema-runtime with digest-keyed caching),
  `deterministicDigestMatch(artifact, expectedDigest)`. A producer's "pass"
  metadata can never flip a fail: only predicate execution over snapshot data
  decides, and both hostile directions are tested (claim-pass/data-fail and
  claim-fail/data-pass).
- **Correlated telemetry** (`createTelemetryEmitter`): events carry
  `runId/phaseId/edgeId/childRunId/attempt`, `eventType` (dispatch, approval,
  cursor, retry, timeout, cancellation, review, remediation, reconciliation,
  terminal, config_resolution, telemetry_loss), `timestamp`, `sequence`
  (monotonic per emitter), `effectiveConfigDigest`, and `fencingToken`,
  matching the T006 store's CAS/fencing vocabulary. The emitter writes to a
  transport (`write`/`list`; default in-memory) so export loss is observable:
  `detectLoss()` diffs emitted vs observed sequences
  (`{lost, emittedCount, observedCount, missingSequences, unexpectedSequences}`)
  and `telemetry_loss` events can report the gap. `recordTerminalReceipt` +
  `checkCompleteness([receipts])` verify every terminal receipt (internal
  registry or an explicit array, e.g. reconstructed from the T006 store) has a
  correlated `terminal` event (matched by runId + payload.receiptId, falling
  back to childRunId), returning `{complete, total, correlated, missing}`.
  `getEvents(filter)` supports run/child/phase/type correlation queries.
- **Redaction**: payloads pass through `redactPayload` BEFORE transport write
  (the raw value never reaches the sink). Keys are normalized (lowercase,
  non-alphanumerics stripped) and redacted to `[redacted]` when they equal OR
  end with a sensitive family name from `DEFAULT_REDACT_KEYS` (token, secret,
  password, credential(s), authorization, apikey, privatekey, sessionid,
  cookie, accesstoken, refreshtoken) — so `apiToken`, `api_token`, and
  `API_KEY` all match. A custom `redactKeys` option replaces the family
  (explicit, not additive).
- **Registry/bootstrap**: 3 entries appended to `schemas/registry.json`
  (canonical content digests recomputed with the shared schema-runtime);
  `bootstrap/package/**` and `bootstrap/payload-index.json` regenerated with
  the canonical packer (6 new payload files under
  `payload/skills/csm-orchestrate/{lib,schemas}` + registry).
- **Tests**: `tests/host-assurance/` (attestation.test.mjs: creation/binding,
  happy-path verification, wrong audience, expired, wrong request/input-set/
  policy digest, nonce replay, missing issuer with recomputed digest, tamper
  detection, malformed creation, registered-schema parity;
  validators.test.mjs: digest binding, pass/fail on real data, producer-pass
  never authoritative, schema-valid + digest-match predicates, tampered
  definition rejection, fail-closed malformed inputs, deterministic example
  evaluators, schema parity) and `tests/telemetry/telemetry.test.mjs`
  (canonical emission/coordinates, fail-closed invalid events, correlation
  filters, all 12 event types, terminal-receipt completeness incl. wrong-
  receipt non-correlation, sequence-gap loss detection + telemetry_loss
  report, clean-run no-loss, recursive redaction incl. no raw secret in any
  serialized output, custom key families, registered-schema parity).
- **Limitations (per plan DR5 and T007 notInScope)**: no real production keys,
  credentials, or trust anchors are introduced — test fixtures use synthetic
  digests only; `verifyAttestation` proves structure/audience/expiry/digest/
  nonce binding, NOT issuer authenticity (signature verification, trust
  anchors, reviewer isolation, and final filesystem/network/browser/
  credential/publication sink reauthorization remain deployment gates);
  producer "pass" suppression is enforced at the validator seam, while legacy
  metadata-only paths remain outside these new modules until integration.
- **Acceptance signal**: `node --test --test-concurrency=1
tests/host-assurance/*.test.mjs tests/telemetry/*.test.mjs` — 31 pass /
  0 fail at implementation time; `make lint`, `make fmt-check`, `make check`,
  schema-registry/bootstrap-sync/package-audit gates, and the full
  orchestrator regression suite green after the change; no new dependencies.

## Held-out evaluation corpus, blinded adjudication, and SLI/SLO definitions (T008)

- **Scope**: evaluation evidence infrastructure only —
  `lib/evals/orchestration/` (harness, SLI computation, blinded adjudication),
  corpus manifests under `tests/evals/orchestration/corpus/`
  (`development.json` 12, `validation.json` 8, `held-out.json` 10 — 30
  scenarios across correctness 10 / config-precedence 5 / authority-boundary
  5 / recovery 5 / adversarial 5), test suites under
  `tests/evals/orchestration/`, and the methodology docs
  `docs/evaluation-corpus.md` + `docs/slo-definitions.md`. No existing
  runtime code, orchestration behavior, or prior test was modified;
  `lib/evals/**` is not a bootstrap-mapped path (the packer's root-lib list is
  unchanged), so no payload regeneration was required.
- **Harness** (`createEvaluationHarness`): `runScenario` executes one
  deterministic scenario against a synthetic orchestration model implementing
  the T005/T006/T007 semantics (UNKNOWN on ambiguous timeout, no auto-retry,
  remediation budget exhaustion -> BLOCKED, producer metadata never
  authoritative), while config resolution uses the REAL seams — `expandEnvRefs`,
  `mergeConfig`, `validateConfigEnvelope`, and the real per-skill adapters
  (`csm-plan`, `csm-make-tests`, `csm-orchestrate`) — so precedence and
  authority-boundary evidence is produced by the shipped code, not a mock.
  Configured namespaces without a registered adapter fail closed
  (`no-registered-adapter`). Every run emits real correlated telemetry
  (`csm-orchestrate/lib/telemetry.mjs`) with a terminal receipt, and
  completeness is recorded per run. An explicit `laxProvenanceVerifier`
  harness option injects a verifier regression for safety-gate testing —
  never present in corpus manifests. `runCorpus(path)` loads a
  `csm-eval-corpus/1` manifest (closed keys; held-out must declare
  `labelsFrozen: true`), runs all scenarios, and returns results plus a
  report; `verifyCorpusDisjoint(manifests)` enforces split disjointness
  (contamination check).
- **SLI computation** (`sli.mjs`): `computeSLI(results, definition)` with
  executable definitions for availability, correctness, falseVerified
  (absolute), falseRejection, duplicateEffects (absolute), recoveryRate, and
  configResolutionTime (250 ms provisional budget) — each stating population,
  numerator, denominator, window, and exclusions. Proportions carry Wilson
  95% intervals; empty populations report `INSUFFICIENT_DATA`; `n/n` and
  `0/n` boundary forms are exact. `generateReport` aggregates totals
  (by category/outcome, false VERIFIED/false rejection/detected duplicates),
  computes all SLIs, evaluates the two absolute safety gates
  (`false-verified-zero`, `duplicate-effects-zero` — any nonzero fails the
  report with `overall = FAILED`), embeds corpus provenance digests, optional
  blinded-adjudication summaries, the limitations list, and
  `thresholdsProvisional: true`.
- **Blinded adjudication** (`adjudication.mjs`): `createAdjudicationRubric`
  (closed criteria with weights and appliesTo scoping, canonical
  `rubricDigest`), `createAdjudicationSession.recordAdjudication` (verdict in
  {correct, incorrect-unsafe, incorrect-too-strict, indeterminate} + mandatory
  written rationale; duplicate recording and unknown scenarios are typed
  errors; the acknowledgment leaks nothing about other adjudicators),
  `revealScenario` refuses until all `requiredAdjudicators` (>= 2) have
  recorded (`blinding-incomplete`), and `computeInterRater` reports mean
  pairwise observed agreement plus average pairwise Cohen's kappa, with
  degenerate (single-category) pairs reported as null kappa rather than
  fabricated as 1.
- **No sensitive material in evaluation artifacts**: rejected config
  fragments never enter results or telemetry — only typed reason codes
  (`unknown-key`, `skill-config`, `missing-env`, `unknown-skill`); the
  corpus-runner test asserts the credential-shaped fixture value and key
  names are absent from serialized results (DR3 parity).
- **Docs**: `docs/evaluation-corpus.md` (splits, scenario schema, taxonomy,
  labeling rules, disjointness, methodology, limitations) and
  `docs/slo-definitions.md` (per-SLI population/numerator/denominator/
  exclusions, provisional SLOs, absolute gates, explicit provisional-threshold
  statement, methodology limitations). Both state that local corpus evidence
  is necessary but not sufficient: deployment-like corpora, adjudicator
  independence, sample size, and external validity remain production gates.
- **Tests** (`node --test --test-concurrency=1
tests/evals/orchestration/*.test.mjs` — 26 pass): corpus-runner
  (disjointness + contamination detection, all three splits fully matched
  with complete telemetry, gates at zero on the full 30-scenario corpus,
  real-seam precedence/authority evidence, secret-leak absence, malformed
  manifests fail closed), SLI (exact Wilson boundary forms, containment,
  monotone narrowing, known-input numerator/denominator for every SLI,
  empty-population semantics), adjudication (digest stability, blinding
  until quorum, no verdict leakage via status, typed validation errors,
  exact kappa 0.5 on a known 2-rater matrix, degenerate and 3-rater cases),
  report (shape, category/outcome aggregation, CI containment, provisional
  flags, corpus/adjudication passthrough, unmatched-without-gate-failure,
  malformed-input fail-closed), safety-gate (false VERIFIED -> FAILED,
  duplicate non-idempotent effect in VERIFIED -> FAILED, detected-and-blocked
  duplicate is an operational finding not a violation, end-to-end
  lax-verifier regression caught by the gate).
- **Limitations**: synthetic orchestration model (does not invoke
  `orchestrate()`; divergence is caught by the integration suites, not here);
  30 scenarios give wide Wilson intervals, reported rather than hidden; all
  thresholds provisional until post-deployment data exists (D6); held-out
  labels frozen for this round and never tuned after evaluation starts.
- **Acceptance signal**: `node --test --test-concurrency=1
tests/evals/orchestration/*.test.mjs` — 26 pass / 0 fail; `make lint`,
  `make fmt-check` green; existing evals/config (38 pass) and telemetry/
  host-assurance (31 pass) suites unchanged and green; no commit created.

## Shadow execution, canary stop rules, rollback, and promotion gates (T009)

- **Scope**: rollout decision infrastructure only — `lib/rollout/`
  (`shadow.mjs`, `canary.mjs`, `rollback.mjs`, `versions.mjs`,
  `promotion.mjs`, shared `internal.mjs`), test suites under
  `tests/rollout/`, and `docs/rollout-policy.md` (progression, exact stop
  thresholds, rollback procedure/verification, version/active-pointer
  semantics, per-gate evidence). No existing runtime code, orchestration
  behavior, or prior test was modified; `lib/rollout/**` is not a
  bootstrap-mapped path (the packer's root-lib list is unchanged), so no
  payload regeneration was required.
- **Shadow runner** (`createShadowRunner`): `run(candidateConfig,
controlConfig, scenario)` executes both configs against private input
  clones with record-only effect sinks (there is no apply path in shadow
  mode), measures latency (default `performance.now`, injectable clock)
  and per-key resource deltas, and compares outcomes by canonical deep
  equality; scenario keys are closed (`scenarioId`, `input`, `execute`).
  `assertZeroSideEffects(runResult)` fails closed (`shadow-side-effect`)
  on any applied effect, any non-recorded-only effect, or input mutation.
- **Canary controller** (`createCanaryController`): one isolated canary at
  a time, pinned to a config version (explicit
  `meta.configVersion` must match the config digest or `version-mismatch`
  fails; otherwise the config is registered in the version registry).
  Stop rules are frozen at creation: absolute stops (> 0 false VERIFIED,
  unauthorized effects, duplicate non-idempotent effects, provenance
  mismatches, telemetry blind spots) and relative stops (p99 latency >
  control x 1.5, error rate > control x 2; boundary values do not trip;
  a zero-error control makes any canary error trip). Missing or
  non-finite measurements are telemetry blindness (fail closed).
  `shouldPromote` requires zero lifetime violations, a healthy last
  evaluation, `minSamples`, and `minDurationMs`; one stop decision
  permanently disqualifies the canary. `markPromoted` records state and
  marks the version known-good in the registry; `markRolledBack` is the
  rollback-controller seam.
- **Version registry** (`createConfigVersionRegistry`): digest-identity
  registration (idempotent by effective-config sha256), a single atomic
  active pointer (`registered` -> `active` -> `superseded`), terminal
  `fenced` state (fencing the active version clears the pointer so
  dispatch stops immediately; fenced versions can never be re-activated,
  re-dispatched, or marked known-good), known-good marks with evidence,
  append-only history with no delete/rewrite API, and deep-frozen record
  snapshots. `authorizeDispatch`/`assertDispatchable` allow only the
  single active unfenced version (cross-boundary retry prevention).
- **Rollback controller** (`createRollbackController`): `execute(canaryId,
reason)` performs the ordered procedure — stop new dispatch (fence the
  bad version), record reconciliation state for in-flight effects
  (idempotent -> `sink-idempotency-verification`, otherwise
  `manual-verification-required`), preserve all receipts/history,
  and move the active pointer to the last known good (null if none —
  dispatch stays blocked). Execution is idempotent (`repeated: true` on
  re-run) and records measured `rollbackTimeMs`. `markReconciled`
  resolves in-flight effects with typed resolutions;
  `verify(canaryId)` reports per-check evidence for `dispatch-blocked`,
  `pointer-moved`, `history-preserved`, and `in-flight-reconciled`.
- **Promotion gates** (`checkPromotionGates(evidence)`): evaluates
  G0 contract safety, G1 config assurance, G2 authorization, G3 host
  execution, G4 durable execution, G5 independent acceptance, G6
  telemetry completeness, G7 held-out evaluation, G8 canary/rollback.
  Evidence per gate is `{ passed, failed, details? }`; `failed > 0` ->
  `fail`, zero-total -> `blocked`, absent -> `blocked`. G0–G4 accept
  local or deployment evidence (deployment wins); G5–G8 are
  deployment-only and stay `blocked` (`deployment-evidence-required`)
  with local evidence merely flagged `ignoredLocalEvidence`. Any
  `fail`/`blocked` gate means not promotable; malformed evidence throws
  `invalid-evidence`. The returned review is deep-frozen.
- **Tests** (`node --test --test-concurrency=1 tests/rollout/*.test.mjs`
  — 51 pass): shadow (zero side effects incl. input-mutation detection,
  outcome match/mismatch, real-clock latency delta + deterministic
  injected clock, resource deltas, error capture, closed scenario keys),
  canary (version/digest pinning, pin mismatch, single-canary isolation,
  every absolute stop condition, telemetry-blindness on missing/NaN
  measurements, exact 1.5x/2x boundaries and zero-control error trips,
  promotion preconditions incl. samples/duration, permanent
  disqualification after a stop, markPromoted known-good effects, frozen
  status, typed validation errors, unpinned registry-free mode, pinned
  config immutability), rollback (fence + pointer restore + dispatch
  block, fenced re-activation/re-dispatch refusal, full verification,
  in-flight reconciliation flow with typed resolutions, history/receipt
  preservation, measured rollback time, idempotent re-execution,
  unknown-canary fail-closed, post-promotion rollback), promotion (all
  gates pass, single fail blocks, G5–G8 blocked without deployment
  evidence, local evidence ignored for deployment-only gates, missing
  local evidence blocks, zero-count evidence blocks, deployment evidence
  wins, malformed evidence fails closed, frozen review), versions
  (digest-identity registration, append-only history, atomic pointer
  moves, terminal fencing, dispatch authorization matrix, last-known-good
  exclusions, superseded/known-good history survival), and an end-to-end
  progression test (shadow parity -> healthy canary -> promotion ->
  promotable review; diverging shadow -> stopped canary -> verified
  rollback -> G8 fail).
- **Limitations**: local controllers exercise decision semantics only —
  synthetic effect sinks, injectable clocks, no production traffic. Per
  the T009 prerequisite signal, representative workload, isolated control
  population, deployment telemetry, accountable rollback authority, and
  external-validity evidence remain production blockers; autonomy stays
  disabled until every G0–G8 gate has deployment evidence (D6).
- **Acceptance signal**: `node --test --test-concurrency=1
tests/rollout/*.test.mjs` — 51 pass / 0 fail (also green under
  `scripts/with-node22.mjs`); `make lint`, `make fmt-check`, `make check`
  green; no commit created.

## Bootstrap synchronization, schema completeness, and final

production-readiness review (T010)

- **Scope**: release-artifact synchronization and the final readiness
  review only — `bootstrap/package/**` and `bootstrap/payload-index.json`
  (regenerated via `scripts/pack-bootstrap.mjs`), `schemas/registry.json`
  and `schemas/compatibility-matrix.json` verification, the
  `.agents/README.md` build-journal index entry,
  `docs/production-readiness-report.md`, and this section. No runtime code,
  entrypoint, or committed test was modified; no commit created (new
  deliverables staged only, so the tracked-corpus hook/check sandboxes see
  the full tree).
- **Bootstrap synchronization**: `node scripts/pack-bootstrap.mjs`
  regenerated all payloads — 321 files, 843216 bytes, sha256
  `34fc61b3d64e4fe8ac635786c6e526b03989ecf5b8c34d81b8a188337607b8d7`;
  the regeneration produced zero additional drift (payloads were already
  in sync from T004/T005), `make test-deterministic` verified two
  consecutive packs byte-identical, and `make test-bootstrap` verified
  schema sync, import closure, and integration (all green).
- **Schema registry completeness**: 75 entries, including all 18 new —
  `csm-skills-config/1`, the 14 per-skill
  `csm-*-config/1` schemas, `csm-orchestrate-attestation/1`,
  `csm-orchestrate-validator/1`, and
  `csm-orchestrate-telemetry-event/1`. `tests/schema-registry.test.mjs`
  6/6; source and payload registries in sync.
- **Compatibility matrix verification**: `schemas/compatibility-matrix.json`
  was verified complete for its contract rather than extended — the matrix
  governs cross-revision producer/consumer negotiation through
  `createCompatibilityRuntime`, and every negotiated pair has an entry
  whose schema is registered (enforced by `tests/compatibility.test.mjs`).
  The new config schemas are revision-1 single-consumer namespaces
  validated directly through the schema registry; no runtime negotiates
  them cross-revision, so no matrix entries are required. Under
  `schemaDiffPolicy` (`same`/`additive` -> matrix entry, `breaking` ->
  explicit adapter), any future config-schema revision fork becomes a
  mandatory matrix/adapter decision.
- **Full verification suite (cheapest first, all green)**: `make fmt-check`
  (1077 files), `make lint` (zero warnings), `make check` (14 skills, 1244
  checks, payload drift `{compared:294, issues:[]}`), config suites
  (root 33/33, readonly 49/49, artifact+legacy 31/31, high-risk 28/28),
  orchestration store + SQLite recovery 48/48 under Node 22, host-assurance
  - telemetry 31/31, evals 26/26, rollout 51/51, `make test-package-index`,
    `make test-deterministic`, `git diff --check`, and the acceptance signal
    `make test` (full repository suite). CI is not runnable in this
    environment; `make test` is the local maximum.
- **Readiness verdict** (`docs/production-readiness-report.md`): **NOT
  READY FOR AUTONOMY** — G0 contract safety PASS, G1 config assurance
  PASS, G4 durable execution PASS, G2 PARTIAL (structural validation only;
  deployment signatures needed), G3 BLOCKED (deployment host required),
  G5/G6/G7/G8 PARTIAL (validator/telemetry/corpus/rollout machinery built
  and tested; deployment isolation/exporter/data/canary evidence needed).
  Residual risks and deployment blockers are enumerated in the report;
  autonomy stays disabled and shadow/replay remains the maximum operating
  mode until every G0–G8 gate has observed deployment evidence (D6).
- **Acceptance signal**: `make test` — full repository suite green.
