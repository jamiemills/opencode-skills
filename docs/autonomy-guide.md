# Autonomy Guide

How to run `csm-orchestrate` autonomously on a single-operator local host: exactly
three read-only skills auto-approve, every other skill stays human-gated, every run
requires a durable cursor store, and is capped, checkpointed, telemetered, and
backed up.

Trust model: the OS user boundary is the trust anchor (`csm-orchestrate/lib/recovery.mjs`
`autonomyGate`). There is no signing infrastructure; safety comes from composition of
the existing gates, not new authority.

## Enable autonomy

Autonomy requires a durable cursor store. `orchestrate()` blocks with reason
`durable-cursor-required` unless `cursorStore` provides `saveCursor`/`loadCursor`;
the SQLite store additionally gives durable single-use approvals, idempotency, and
fenced dispatch intents. Build an approvals policy from the validated capability
manifest, set an explicit step cap, and wire telemetry:

```js
import os from "node:os";
import path from "node:path";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createSqliteStore } from "../lib/orchestration-store/index.mjs";
import { createJsonlTransport, createTelemetryEmitter } from "../csm-orchestrate/lib/telemetry.mjs";

const runId = "run-my-autonomy";
const capabilities = await loadCapabilities();
const cursorStore = createSqliteStore({
  mode: "wal", // fails closed when node:sqlite is unavailable
  databasePath: path.join(os.tmpdir(), `${runId}.db`),
});
const telemetryEmitter = createTelemetryEmitter({
  transport: createJsonlTransport(path.join(os.tmpdir(), `${runId}.jsonl`)),
  runId,
  // effectiveConfigDigest is required per event; omit it here and
  // orchestrate() derives one from the run context.
});
const result = await orchestrate({
  approach,
  runId,
  host,
  capabilities,
  signals: { capabilities: ["csm-scan"] },
  approvals: createAutonomyPolicy(capabilities),
  cursorStore, // required for autonomy
  maxSteps: 25, // default is Infinity — always set an explicit cap
  telemetryEmitter,
});
```

The policy mints single-use, manifest-bound approvals (`csm-orchestrate-approval/2`):
scope comes from the capability's `permissions`, `approvedDigest` from the capability
manifest digest, and the binding from the live invocation context. Approvals expire
after 1 hour by default (`ttlMs` option). Scope enforcement is exact-match at the
invocation adapter, and each approval is consumed durably via
`cursorStore.consumeApproval` — the same approval can never dispatch twice, even
across process restarts.

## What is auto-approved vs denied

| Verdict              | Rule                                                                                             | Skills                                     |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **auto-approved**    | effects exactly `read-only`, permissions exactly `read`/`read,execute`, and not on the deny list | `csm-ddd`, `csm-review-python`, `csm-scan` |
| **denied (BLOCKED)** | everything else                                                                                  | the other 11 skills                        |

Why each denied skill stays human-gated:

| Skill               | Reason                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `csm-review`        | read-only effects, but its R0 review posture mandates network calls (OSV / endoflife.date advisories) — excluded by name |
| `csm-deep-research` | read-only effects, but holds `network` + `browser` permissions                                                           |
| `csm-browse`        | `browser-session` + `workspace-write` effects                                                                            |
| `csm-upload`        | `publication`, `external-side-effect`, `credential-use` effects                                                          |
| `csm-build`         | `workspace-write` effects                                                                                                |
| `csm-grill`         | `workspace-write` effects                                                                                                |
| `csm-plan`          | `workspace-write` effects                                                                                                |
| `csm-bdd-tdd`       | `workspace-write` effects                                                                                                |
| `csm-make-tests`    | `workspace-write` effects                                                                                                |
| `csm-autoresearch`  | `workspace-write` effects                                                                                                |
| `csm-orchestrate`   | never dispatched as a sibling; the adapter blocks it as `unauthorized-skill`                                             |

A denied skill makes the run return a `BLOCKED` receipt with reason
`missing-approval` and zero host dispatches. Both the requested node's declared
side effects and the capability manifest must agree that the skill is safe;
either side saying otherwise denies.

## Bound the run

- **`maxSteps`** — caps total adapter dispatches across the whole run (phases,
  retries, remediation). **The default is `Infinity`; set it explicitly for every
  autonomous run.** When the cap is hit the run stops dispatching and returns an
  `INCOMPLETE` receipt with reason `max-steps-exceeded`.
- **`maxOutputSize`** — caps each child result as JSON byte length. Default is
  2 MB (`2 * 1024 * 1024`); an oversized result is replaced with a policy
  failure (`output-size-exceeded`).
- **`retryBackoffMs`** — base delay before each retry dispatch; default 1000 ms,
  doubling exponentially per attempt (`retryBackoffMs * 2^(attempt - 1)`).
- **`reviewTimeoutMs`** — bounds every adversarial review, final review, and
  remediation callback. Default is 300 000 ms (5 minutes); a hung callback
  converts to a clean `INCOMPLETE`/`BLOCKED` receipt with reason
  `review-timeout` instead of hanging the run.

```js
await orchestrate({
  ...,
  maxSteps: 25,
  maxOutputSize: 2 * 1024 * 1024,
  retryBackoffMs: 1000,
  reviewTimeoutMs: 300_000,
});
```

## Kill switch: AbortSignal

Pass an `AbortSignal` to halt the run. This is **best-effort**, not a guarantee:
aborting stops further dispatches, aborts the current in-flight invocation, and
returns a terminal `INCOMPLETE` receipt with reason `aborted`; review and
remediation callbacks are separately bounded by the 5-minute `reviewTimeoutMs`.
Processes the child detached into a tmux server session escape the signal
entirely — the adapter kills the child's tmux session on abort or timeout when
the child result carries a `tmuxSessionName`, but tmux-detached processes may
still require manual cleanup. Without pid-namespaces no stronger guarantee
exists.

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 30 * 60_000); // hard 30-minute ceiling
await orchestrate({ ..., signal: controller.signal });
```

## Check telemetry

Give `orchestrate()` a telemetry emitter over the JSONL file transport.
**dispatch, retry, terminal, and approval events are emitted; other event types
exist in the schema but are not yet wired** (`timeout`, `cancellation`,
`review`, `remediation`, `cursor`, `reconciliation`, `config_resolution`,
`telemetry_loss`). Every emitted event lands in the file (mode `0600`),
correlated by `runId`/`phaseId`/`edgeId`/`childRunId` and stamped with
`effectiveConfigDigest` — pass your own, or `orchestrate()` derives one when a
telemetry emitter is supplied without a digest. See the example above for
wiring.

Inspect a run:

```sh
# every event for the run, one JSON object per line
jq -c 'select(.runId == "run-my-autonomy")' /tmp/run-my-autonomy.jsonl

# terminal outcome
jq -c 'select(.eventType == "terminal")' /tmp/run-my-autonomy.jsonl

# approvals minted (and denied, approvalId "denied")
jq -c 'select(.eventType == "approval")' /tmp/run-my-autonomy.jsonl
```

Payloads are redacted (token/secret/password/credential/authorization/apiKey/...)
before they reach the file. Telemetry failures never break a run. Rotate or prune
old `*.jsonl` files on a schedule — the transport appends durably but does not rotate.

## Git checkpoint and rollback

Before an autonomous run, checkpoint the working tree; afterwards, roll it back if
the run went sideways:

```js
import {
  preAutonomyRun,
  rollbackToCheckpoint,
} from "../csm-orchestrate/lib/checkpoint.mjs";

const checkpoint = await preAutonomyRun(runId, repoRoot);
// => { checkpointDir, head, branch, manifest: { modified, staged, untracked, ignored }, wasDirty, createdAt }
try {
  await orchestrate({ ... });
} finally {
  const { restored, reason } = await rollbackToCheckpoint(checkpoint, repoRoot);
  if (!restored) console.error(`rollback failed: ${reason}`);
}
```

The checkpoint captures HEAD, the current branch, tracked diffs (staged and
unstaged, as binary patches), and untracked files (copied into a mode-0700 temp
directory). **Ignored files are recorded in the manifest but not restored.**
Rollback hard-resets to the recorded HEAD, cleans files the run created,
re-applies the recorded patches, restores the untracked copies, then verifies
`git status` matches the manifest — returning `{ restored: false, reason:
"verification-mismatch" }` on divergence. Use `stripSecretsFromContext` (same
module) before handing any external context to prompts — it recursively redacts
the sensitive key set.

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
list included) unless: a host with `invokeSiblingSkill` is present, a durable
cursor store is wired, `approvals` are wired, phases declare idempotency keys and
route nodes, and evaluation signals exist. If any prerequisite is missing, zero
skills run.
