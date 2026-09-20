# Typed-decisions operator runbook (Jev opt-in)

Operator-facing companion to `docs/typed-decisions.md`. It covers how to turn the
optional, host-mediated typed-decision layer on and off, kill it, choose a
provider, and recover. The layer is **observational**: it advises or applies only
on reversible non-safety points and never owns acceptance, security, or
completion authority.

## 1. Enable / disable / recovery

The layer is **dormant by default**. With no `--use-jev` flag and no
`csm-orchestrate-request/2` `decision` block, `scripts/run-orchestrator.mjs`
consults no provider registry, constructs no adapter, and makes no network call,
so the run is byte-identical to the decision-free path
(`scripts/run-orchestrator.mjs:136-207`, `resolveDecisionAdapter`).

Enable, in precedence order (`parseDecisionOptIn`):

- `--use-jev` — forces `live`.
- Request `decision` block — `csm-orchestrate-request/2`
  (`csm-orchestrate/schemas/csm-orchestrate-request.v2.schema.json`) carries an
  optional `decision: { mode, points? }` where `mode` is `off` | `shadow` |
  `live`; `points` optionally bounds the enabled point ids. The explicit flag
  wins over the artifact mode.

Even when opted in, the adapter is built **only if** the selected provider
resolves and its `apiKeyEnv` is set. Otherwise the driver prints why and retains
the deterministic harness.

Disable: remove `--use-jev` / set the block `mode` to `off`, or use a kill switch
below. Recovery when a provider misbehaves: set `CSM_DECISION_KILL=1` (or
`CSM_DECISION_MODE=off`) and re-run, or unset the provider key env — every path
reverts to the deterministic baseline. Already-written
`.agents/decisions/<runId>.json` artifacts are evidence only. The layer **never
sets `PAUSED`**.

## 2. Kill switch

Two switches force the off/baseline path; both are **force-off only and never
escalate** (`csm-orchestrate/lib/decision-adapter/index.mjs:124-133,260-261`):

- `CSM_DECISION_KILL=1` — engaged only on the literal `"1"`.
- `CSM_DECISION_MODE=off` — only a trimmed `"off"` is honored, so a stray
  `CSM_DECISION_MODE=live` can never enable the layer.

**Run-scoped circuit breaker**: after 3 consecutive transport failures
(`DEFAULT_CIRCUIT_FAILURE_THRESHOLD`) the breaker opens and the adapter stops
calling the transport for the remainder of the run; any success resets the
counter. Breaker state lives in the adapter closure, and one adapter instance is
one run (`index.mjs:21,292-293,313-318,407`).

## 3. Provider selection

Selection is by environment variable **`CSM_DECISION_PROVIDER`**, default
**`openrouter`**; blank/whitespace falls back to the default
(`csm-orchestrate/lib/decision-adapter/providers/index.mjs:14-15,94-109`). An
unknown id is `unresolved` and fail-opens to the deterministic harness.

| Provider (`id`) | Key env var             | Endpoint                                         | Model               |
| --------------- | ----------------------- | ------------------------------------------------ | ------------------- |
| `openrouter`    | `OPENROUTER_ROUTER_KEY` | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |
| `vercel`        | `AI_GATEWAY_API_KEY`    | `POST https://ai-gateway.vercel.sh/v1/evaluate`  | `typesafe-ai/jev`   |

Notes:

- The key env is per-descriptor (`apiKeyEnv`): a provider reads only its own
  variable, and keys never cross-contaminate.
- The Vercel route is the Gateway **evaluation** modality (`/v1/evaluate`), not
  its OpenAI-compatible chat endpoints; its model id differs from OpenRouter's.
- Adding a third route is a **new descriptor only**:
  `csm-orchestrate/lib/decision-adapter/providers/<id>.mjs` with fields `id`,
  `endpoint`, `apiKeyEnv`, `defaultModel`, `buildRequest`, `parseResponse`,
  `classifyError` (discovered by filename convention — no registry/adapter edit).
  See `providers/openrouter.mjs`, `providers/vercel.mjs`.
- A single env-gated CLI exists for one-off checks: `CSM_DECISION_CLI=1 node
csm-orchestrate/lib/decision-adapter/cli.mjs '<json>'` (input also readable
  from `CSM_DECISION_INPUT`); it prints the normalized result or failure and
  never the key.

## 4. Key rotation

Keys are read **from the environment only** and handed to the transport as a
single-key env; they never appear on `argv`, are never logged, and are never
written to artifacts (`scripts/run-orchestrator.mjs:178-192`). To rotate, set the
new value in the environment (e.g. `OPENROUTER_ROUTER_KEY` /
`AI_GATEWAY_API_KEY`) and re-run — no repository or artifact change is required.
Artifacts redact `Authorization`, `Bearer`, and `*_KEY` material and the writer
refuses any artifact that still contains a credential shape
(`csm-orchestrate/lib/decision-adapter/artifact.mjs`). Never pass a key on the
command line.

## 5. Caps and timeout defaults

Published by the adapter and transport; see
`csm-orchestrate/lib/decision-adapter/index.mjs:30-33` and
`csm-orchestrate/lib/decision-adapter/transport.mjs:10-11`:

- Adapter deadline: `30_000` ms (`DEFAULT_DECISION_DEADLINE_MS`) — bounds even a
  transport that ignores its `AbortSignal`.
- Transport timeout: `10_000` ms (`DEFAULT_DECISION_TIMEOUT_MS`) — set below the
  adapter deadline so a cooperative transport reports `timeout` first.
- Max state bytes: `262_144` (`DEFAULT_DECISION_MAX_STATE_BYTES`); max
  request/response body: `262_144` bytes (`DEFAULT_DECISION_MAX_BODY_BYTES`).
- Max cost: `1` USD (`DEFAULT_DECISION_MAX_COST`), enforced only when a result
  carries `usage.cost`.
- Max calls per point: `32` (`DEFAULT_MAX_CALLS_PER_POINT`).

Concurrent identical calls are deduped by single-flight; with a real `runId` the
driver path additionally memoizes successful results across calls, keyed by
`(runId, pointId, digest(state))`. A Jev answer that disagrees with the
deterministic baseline is discarded.

## 6. Natural-language "use Jev" mapping

The phrase "use Jev" (or similar) is **host-translated** into either `--use-jev`
or the request/2 `decision` field. No code parses natural language: the driver
only reads the explicit flag and the structured `decision` block
(`scripts/run-orchestrator.mjs:146-160`). The host/operator owns the translation.

## 7. Fail-open

Every provider, network, timeout, malformed-response, and cap error reverts to
the **deterministic harness model**; the adapter never throws and never sets
`PAUSED` (`csm-orchestrate/lib/decision-adapter/index.mjs`,
`.../transport.mjs`). Revert trigger classes: `authentication`,
`payment_required`, `permission_denied`, `not_found`, `payload_too_large`,
`rate_limit_exceeded`, `server`, `provider_unavailable`, `provider_overloaded`,
`timeout`, and any `unmapped` class. An unknown or unset provider also
fail-opens. Only non-safety `apply` points can change behavior; `shadow` applies
nothing. Artifacts are written only for applied decisions, at
`.agents/decisions/<runId>.json`.

## 8. Key resolution and the skill consult seam

The provider key is resolved from the descriptor's `apiKeyEnv` in the process
environment, falling back to the repository-root `.env` file (e.g.
`OPENROUTER_ROUTER_KEY`). The resolver only reads the selected descriptor's own
variable, never logs or returns the key in diagnostics, and treats a missing key
as a fail-open `missing` result. Rotate by changing the env var or `.env` value
and re-running; never pass a key on the command line.

Skills consume advisory review/judge verdicts through the host-mediated consult
seam, gated on the existing `CSM_DECISION_CLI=1` env gate (the driver path is
gated by `--use-jev` / the request-2 `decision` block). Without opt-in there is
no adapter and no network. The seam redacts state before send and returns
advisory verdicts only — it never applies and never touches a gate.
