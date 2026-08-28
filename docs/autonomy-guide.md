# Autonomy Guide

How to run `csm-orchestrate` autonomously on a single-operator local host: read-only
skills auto-approve, write/execute skills stay human-gated, every run is capped,
checkpointed, telemetered, and backed up.

Trust model: the OS user boundary is the trust anchor (`csm-orchestrate/lib/recovery.mjs`
`autonomyGate`). There is no signing infrastructure; safety comes from composition of
the existing gates, not new authority.

## Enable autonomy

Build an approvals policy from the validated capability manifest and pass it as the
`approvals` hook. Nothing else changes — the policy is just an approvals function:

```js
import { loadCapabilities, orchestrate } from "../csm-orchestrate/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";

const capabilities = await loadCapabilities();
const result = await orchestrate({
  approach,
  runId: "run-my-autonomy",
  host,
  capabilities,
  signals: { capabilities: ["csm-scan"] },
  approvals: createAutonomyPolicy(capabilities),
});
```

The policy mints single-use, manifest-bound approvals (`csm-orchestrate-approval/2`):
scope comes from the capability's `permissions`, `approvedDigest` from the capability
manifest digest, and the binding from the live invocation context. Approvals expire
after 1 hour by default (`ttlMs` option). Because scope enforcement is exact-match at
the invocation adapter, a skill claiming read-only effects but holding a write
capability manifest is denied.

## What is auto-approved vs denied

| Verdict              | Rule                                           | Skills                                                                                    |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **auto-approved**    | capability `effects` are all `read-only`       | `csm-ddd`, `csm-deep-research`, `csm-review`, `csm-review-python`, `csm-scan`             |
| **denied (BLOCKED)** | any non-read-only effect or unknown capability | `csm-build`, `csm-browse`, `csm-upload`, `csm-autoresearch`, `csm-grill`, `csm-plan`, ... |

A denied skill makes the run return a `BLOCKED` receipt with reason
`missing-approval` and zero host dispatches. Both the requested node's declared
side effects and the capability manifest must agree that the skill is read-only;
either side saying otherwise denies.

## Bound the run: maxSteps

`maxSteps` caps total adapter dispatches across the whole run (phases, retries,
remediation). Default is `Infinity` for backward compatibility.

```js
await orchestrate({ ..., approvals: createAutonomyPolicy(capabilities), maxSteps: 25 });
```

When the cap is hit the run stops dispatching and returns an `INCOMPLETE` receipt
with reason `max-steps-exceeded`.

## Kill switch: AbortSignal

Pass an `AbortSignal` to halt immediately and cleanly. On abort the orchestrator
stops dispatching, emits a terminal `INCOMPLETE` receipt with reason `aborted`,
and closes telemetry:

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5 * 60_000); // hard 5-minute ceiling
await orchestrate({ ..., signal: controller.signal });
```

The signal is also forwarded to the host adapter, so in-flight invocations observe
cancellation. Worst case, the current invocation finishes and the run then halts.

## Check telemetry

Give `orchestrate()` a telemetry emitter over the JSONL file transport. Every
dispatch, retry, timeout, cancellation, review, remediation, and terminal
transition lands in the file (mode `0600`), correlated by
`runId`/`phaseId`/`edgeId`/`childRunId` and stamped with `effectiveConfigDigest`:

```js
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";

const transport = createJsonlTransport(`/var/lib/csm/${runId}.jsonl`);
const telemetryEmitter = createTelemetryEmitter({
  transport,
  runId,
  effectiveConfigDigest, // required per event
});
await orchestrate({ ..., telemetryEmitter, effectiveConfigDigest });
```

Inspect a run:

```sh
# every event for the run, one JSON object per line
jq -c 'select(.runId == "run-my-autonomy")' /var/lib/csm/run-my-autonomy.jsonl

# terminal outcome
jq -c 'select(.eventType == "terminal")' /var/lib/csm/run-my-autonomy.jsonl
```

Payloads are redacted (token/secret/password/credential/authorization/apiKey/...)
before they reach the file. Telemetry failures never break a run. Rotate or prune
old `*.jsonl` files on a schedule — the transport appends durably but does not rotate.

## Git checkpoint and rollback

Before an autonomous run, checkpoint the working tree; afterwards, roll it back if
the run went sideways:

```js
import { preAutonomyRun, rollbackToCheckpoint } from "../csm-orchestrate/lib/checkpoint.mjs";

const { checkpointRef, wasDirty } = await preAutonomyRun(runId, repoRoot);
try {
  await orchestrate({ ... });
} finally {
  if (wasDirty) await rollbackToCheckpoint(repoRoot); // git stash pop
}
```

`preAutonomyRun` stashes uncommitted changes as `pre-autonomy-<runId>` (a clean
tree is a no-op); `rollbackToCheckpoint` pops the stash and restores the exact
pre-run working tree. Use `stripSecretsFromContext` (same module) before handing
any external context to prompts — it recursively redacts the sensitive key set.

## Backup and restore the SQLite store

The coordination store (`lib/orchestration-store`) exposes `backup(targetPath)`:

```js
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";

const store = createSqliteStore({ mode: "wal", databasePath: "orchestration.db" });
const { path, bytes, timestamp } = await store.backup("backups/orchestration.db");
```

- SQLite backends (WAL and `:memory:`) write a consistent snapshot via
  `VACUUM INTO` — a single self-contained database file, safe to take while the
  store is open.
- The pure-JS fallback driver exports a JSON snapshot instead
  (`csm-orchestration-store-backup/1`).
- Backing up to the same path again overwrites idempotently; the returned
  `{ path, bytes, timestamp }` describes what was written.

Verify a backup is restorable (daily check; also works on the JSON export):

```sh
node scripts/verify-orchestration-backup.mjs backups/orchestration.db
```

The script opens the backup read-only, runs `PRAGMA integrity_check`, confirms the
`schema_version`, `cursors`, and `events` tables exist, prints row counts, and exits
`0` on PASS / `1` on FAIL.

Restore by pointing a new store at the backup file (or copying it over the live
database path while no run is active):

```js
const store = createSqliteStore({ mode: "wal", databasePath: "backups/orchestration.db" });
const receipt = await store.loadTerminalReceipt(receiptId); // pre-backup history intact
```

## Preflight: what must be true before an autonomous run

`orchestrate()` runs the `autonomyGate` preflight before the first dispatch. It
blocks with a `BLOCKED` receipt (reason `autonomy-preflight-blocked`, `missing`
list included) unless: a host with `invokeSiblingSkill` is present, `approvals`
are wired, phases declare idempotency keys and route nodes, and evaluation
signals exist. If any prerequisite is missing, zero skills run.
