# Typed decisions (Jev-class) and the never-Jev boundary

This document is the design/contract for the optional, host-mediated typed-decision
layer (Jev/TypeSafe-class). It describes the layer as shipped on this branch: the
provider-pluggable transport, the OpenRouter and Vercel AI Gateway providers, the
fail-open/circuit-breaker/kill switches, the redaction artifact writer, and the
telemetry are all implemented. Operator procedures live in
`docs/typed-decisions-runbook.md`. The layer is **observational**: it may advise
or, on a narrow reversible class, apply; it never owns acceptance, security, or
completion authority.

## 1. What the layer is

The layer is **optional, user-initiated, and off by default**. With the layer
absent or disabled, behavior is byte-identical to no adapter at all
(`csm-orchestrate/lib/decision-adapter/index.mjs`).

Opt-in has three host-mediated entry points:

- **Request field** — the additive `csm-orchestrate-request/2` envelope
  (`csm-orchestrate/schemas/csm-orchestrate-request.v2.schema.json`, `$id`
  `csm-orchestrate-request/2`) carries an optional `decision` object
  `{ mode, points? }`. `mode` is `off` | `shadow` | `live`; absent means the
  layer is disabled. `csm-orchestrate/lib/intake.mjs` dual-accepts `/1` and `/2`
  (`REQUEST_MARKERS`); `/1` stays frozen.
- **`--use-jev` flag** — implemented for `scripts/run-orchestrator.mjs`; it forces
  `live` mode, and `parseDecisionOptIn` gives the explicit flag precedence over the
  artifact mode.
- **Host-translated natural-language phrase** — a phrase such as "use Jev" is
  translated by the host into the request field or `--use-jev`. This is a host
  behavior documented in the operator runbook
  (`docs/typed-decisions-runbook.md`), **not** a code path.

Modes (`DECISION_ADAPTER_MODES`):

| Mode     | Meaning                                                    |
| -------- | ---------------------------------------------------------- |
| `off`    | Default. Records nothing; no provider call.                |
| `shadow` | Records advice only; applies nothing (no behavior change). |
| `live`   | May apply guarded, reversible, non-safety points.          |

The per-skill declaration is the optional `decision` block in
`csm-orchestrate-capabilities/3`
(`csm-orchestrate/schemas/capabilities.v3.schema.json`:
`{ enabled=false, provider?, points? }`). Every shipped entry in
`csm-orchestrate/capabilities.json` sets `enabled: false`. `validateCapabilities`
in `csm-orchestrate/lib/capabilities.mjs` accepts `/2` and `/3` and fails closed
on any other revision.

The typed decision record is `csm-decision/1`
(`csm-orchestrate/schemas/csm-decision.schema.json`): criteria, answer
(`choice` | `score` | `noul`), confidence, usage, provenance, routing band, and
applied flag. It is evidence, never a receipt.

Current state: `csm-orchestrate/lib/decision-adapter/index.mjs` is the live
fail-open owner. It composes the injected provider transport
(`.../transport.mjs`), performs bounded I/O in `live`/`shadow`, and in every
failure class returns the deterministic baseline unchanged.

## 2. Provider seam

Selection is by environment variable **`CSM_DECISION_PROVIDER`**, default
**`openrouter`** (`PROVIDER_SELECTION_ENV`, `DEFAULT_PROVIDER_ID` in
`csm-orchestrate/lib/decision-adapter/providers/index.mjs`). A blank/whitespace
value falls back to the default.

A provider is a descriptor-only module at
`csm-orchestrate/lib/decision-adapter/providers/<id>.mjs`, discovered by naming
convention (`providerIdFromFilename`). Descriptor fields: `id`, `endpoint`,
`apiKeyEnv`, `defaultModel`, `buildRequest`, `parseResponse`, `classifyError`.
A malformed descriptor is quarantined per file. An unknown selected id is
reported `unresolved`; the adapter fail-opens to the deterministic harness.

Shipped providers and their real differences:

- **OpenRouter** (default): `POST https://openrouter.ai/api/alpha/decisions`,
  model `typesafe/jev-1.13`, key env `OPENROUTER_ROUTER_KEY`
  (`providers/openrouter.mjs`).
- **Vercel AI Gateway**: `POST https://ai-gateway.vercel.sh/v1/evaluate`, model
  `typesafe-ai/jev`, key env `AI_GATEWAY_API_KEY` (`providers/vercel.mjs`).
  Evaluation is **not** exposed on the Gateway's OpenAI-compatible chat
  endpoints, and the model id differs from OpenRouter (`typesafe-ai/jev` vs
  `typesafe/jev-1.13`).

Adding a further route is a **new `providers/<id>.mjs` descriptor only** — never
an edit to the registry or adapter.

## 3. Fail-open taxonomy

Every provider failure reverts to the deterministic harness model and **never
sets `PAUSED`**. Revert triggers: `401`, `402`, `403`, `404`, `413`,
`429`, `5xx`, `529`, timeout, and budget exhaustion. Fail-open uses a
**run-scoped circuit breaker**. Two switches force the layer off:

- `CSM_DECISION_MODE=off`
- `CSM_DECISION_KILL=1`

Provider-specific error parsing stays in `provider.classifyError`; fail-open
orchestration stays in the adapter. An unknown/unset provider id also fail-opens
to the harness.

## 4. Budget

Per-call caps: **timeout**, **max state bytes**, **max cost**. Per-point call
caps bound loop behavior. Concurrent requests for the same key share one call via
**single-flight**; a successful result is retained across calls only when the
adapter was constructed with a real `runId` (cross-call memoization keyed by
`(runId, pointId, digest(state))`). Without a runId the adapter still
single-flights but never caches. A Jev answer that disagrees with the
deterministic baseline is discarded.

## 5. Redaction

Provider keys are read from their own env var only, never logged, and never
written to argv or artifacts. The artifact writer
(`csm-orchestrate/lib/decision-adapter/artifact.mjs`) redacts `Authorization`,
`Bearer`, `*_KEY`, and vendor key-shaped material over the whole artifact before
it is written, and refuses any artifact that still contains a credential shape.
The existing `redactTraceValue` helper (`csm-orchestrate/lib/recovery.mjs`) also
redacts `token`/`secret`/`password`/`credential`/`authorization`/`api[-_]?key`
keys.

## 6. The never-Jev boundary

Jev output is advisory/apply input only. The following surfaces are
**deterministic and never influenced, mutated, or authored by Jev**:

- **Acceptance signals** — task acceptance criteria and their evidence stay harness-owned.
- **Task and control status** — plan/build control state, task status, and lifecycle transitions.
- **Closure / `verificationStatus` / `canSaveVerified`** — review closure is deterministic (`csm-review/lib/loop-closure.mjs`).
- **Evaluator receipts** — the per-cycle binding evaluator verdict is harness-owned (`csm-build/lib/loop-guard.mjs`, `csm-plan/lib/loop-evaluator.mjs`, `csm-review/lib/loop-closure.mjs`).
- **Loop-guard exits** — deterministic guard exit codes fail closed while work remains.
- **Cursor / supersession** — durable cursor state and resumable supersession pointers (`csm-orchestrate/lib/recovery.mjs`).
- **`remainderPolicy`** — bounded remainder budget and eligibility are harness policy.
- **Severity / evidence-class authority** — finding severity and evidence-class bucketing remain authoritative to review.
- **Posture rungs** — review execution posture selection and rung recording.
- **Redaction** — Jev can never disable, weaken, or take ownership of redaction.
- **Commit / push** — VCS side effects are never authorized by Jev.
- **Schema-registry immutability / `unknownRevisionPolicy`** — `schemas/registry.json` immutability policy (`unknownRevisionPolicy: "reject"`).
- **The `csm-verification-status/1` record** (`schemas/verification-status.schema.json`).
- **csm-build `completion.commit` / `completion.rollback` status** (`csm-build/schemas/state.v2.schema.json`).
- **Artifact `lifecycleStatus` + `descriptorDigest`** — lifecycle transitions and descriptor binding.
- **Digest-based anti-fabrication** — `receiptDigest` / `descriptorDigest` / plan digest are never recomputed or re-signed by Jev.
- **The isolation, attestation, egress, evidence-gate, adversarial-review, autonomy, dynamic-mode, and `validateCapabilities` gates** — all remain deterministic.
- **`classifyResume` / `retryDecision`** — resume classification and retry/stop decisions (`csm-orchestrate/lib/recovery.mjs`).
- **Review terminal-immutability policy** — terminal review records stay immutable.
- **A precedence class** — Jev output is pinned to the observational
  `csm-orchestrate-decision-gate/1` class (`csm-orchestrate/schemas/decision-gate.schema.json`),
  which owns evidence only and carries no acceptance authority.

Jev must **never emit** these unregistered enforcement ids (they are emitted only
by the deterministic skills/recovery, and none is registered in
`schemas/registry.json`):

- `csm-evaluator-receipt/1`
- `csm-plan-evaluator-receipt/1`
- `csm-plan-loop-guard/1`
- `csm-review-closure/1`
- `csm-orchestrate-supersession/1`
- `csm-orchestrate-remainder/1`
- `csm-orchestrate-run-evaluation/1`

## 7. Reference paths

- Adapter: `csm-orchestrate/lib/decision-adapter/index.mjs`
- Provider transport: `csm-orchestrate/lib/decision-adapter/transport.mjs`
- Providers: `csm-orchestrate/lib/decision-adapter/providers/openrouter.mjs`,
  `.../providers/vercel.mjs`, port/registry at `.../providers/index.mjs`
- Redaction artifact writer: `csm-orchestrate/lib/decision-adapter/artifact.mjs`
- Env-gated one-off CLI: `csm-orchestrate/lib/decision-adapter/cli.mjs`
- Decision points: `csm-orchestrate/lib/decision-adapter/points.mjs`,
  `csm-orchestrate/decision-points.json`
- Decision record schema: `csm-orchestrate/schemas/csm-decision.schema.json`
- Request envelope: `csm-orchestrate/schemas/csm-orchestrate-request.v2.schema.json`
- Capabilities: `csm-orchestrate/schemas/capabilities.v3.schema.json`,
  `csm-orchestrate/lib/capabilities.mjs`
- Registry / matrix: `schemas/registry.json`, `schemas/compatibility-matrix.json`
- Driver wiring: `scripts/run-orchestrator.mjs`
  (`resolveDecisionAdapter`, `persistAdapterDecisions`)
- Tests: `tests/orchestrate-decision-adapter.test.mjs`,
  `tests/offline/decision-*.test.mjs`,
  `tests/orchestrate-foundation-dualrev.test.mjs`
- Operator runbook: `docs/typed-decisions-runbook.md`

## 8. Typed protocol, key resolution, and advisory review/judge points

The live Jev API takes a `questions` **record** keyed by question id and returns
an `answers` **record** keyed by the same ids (`{ model, answers, usage, id,
provider }`); the prior array-shaped request was rejected with HTTP 400. The
provider descriptors build that record and parse that envelope through
`csm-orchestrate/lib/decision-adapter/question-protocol.mjs`, so provider fixes
stay descriptor-only and a new supplier remains a new `providers/<id>.mjs` file.

Provider keys are resolved by `.../key-resolution.mjs`: the descriptor's own
`apiKeyEnv` from `process.env`, falling back to the repository `.env` file.
Only the descriptor's name is ever looked up (no cross-provider reads), the key
is never placed on argv, logged, or written to an artifact, and a missing key is
a fail-open `missing` result. The driver and the consult seam both use it.

The adapter exposes `decideBatch(pointIds, state)`: one batched typed-question
call for several points, each answer mapped back to its point. It is
advisory-only (never applies), fail-open, and honours per-point call caps.

The review/judge/adversarial-role advisory points (all `safety`/`authority` +
`advisory`) are consumed through the host-mediated consult seam
(`.../consult.mjs`), which redacts state before send and writes nothing into the
repository. Wired skills: `csm-review`, `csm-review-python`, `csm-deep-research`,
`csm-plan`, `csm-build` (REVIEW), `csm-autoresearch`, `csm-bdd-tdd`, and the
bounded `csm-orchestrate` injected reviewer (`orchestrate-reviewer-finding`).

The deterministic boundary guard (`.../boundary-guard.mjs`) fails closed if an
advisory/decision payload appears in a protected input (digest, receipt, gate,
closure, acceptance). The `csm-orchestrate` `reviewAcceptance` gate is
byte-identical with or without advisory context and is never influenced by Jev.
