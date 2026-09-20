# Action Traces and Safe Cleanup

Two operational guarantees for long-running, interruptible agent work:

1. **Traces** — durable, UTC-stamped records of the actions taken and the
   justifications for decisions, for future review.
2. **Cleanup** — safe, interruption-proof removal of temporary files and managed
   worktrees, which never performs destructive actions outside verified
   temp/managed paths.

## Traces

`scripts/lib/trace-log.mjs` appends one JSON line per action or decision to
`.agents/logs/<YYYY-MM-DD>-<runId>-trace.jsonl` (append-only JSONL). Each entry
carries:

| Field           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `ts`            | UTC ISO-8601 timestamp ending in `Z`     |
| `runId`         | the invoking run                         |
| `actor`         | who acted (`wt-session`, `csm-build`, …) |
| `action`        | what happened                            |
| `target`        | what it happened to                      |
| `justification` | why (for decisions, the rationale)       |
| `outcome`       | result                                   |
| `kind`          | `action` or `decision`                   |

`appendTrace(entry, { file })` and `recordDecision(entry, { file })` create the
directory, validate that `ts` is UTC (throwing on a non-UTC timestamp), redact
credential-shaped values, and append. Traces are indexed under the `## logs/`
class in `.agents/README.md`.

## UTC timestamps

Every durable timestamp is ISO-8601 **UTC** ending in `Z`
(`scripts/lib/utc.mjs` `utcNow()` / `isUtc()`). This is enforced by
`tests/utc-timestamps.test.mjs`.

## Cleanup

`scripts/lib/temp-registry.mjs` keeps a durable registry at
`.agents/state/temp-registry.json`: every managed worktree and temp dir created
by `scripts/wt-session.mjs` is registered with its path, branch, run id, and UTC
timestamp. Because the registry is durable, an **interrupted** session's
resources remain discoverable and can be cleaned later.

Run cleanup when a session ends:

```bash
node scripts/wt-session.mjs cleanup            # dry-run (default): prints, deletes nothing
node scripts/wt-session.mjs cleanup --apply     # removes eligible resources
```

### Safety contract (fail-closed)

Cleanup removes **only**:

- registered worktrees whose path resolves under the managed worktree root,
  whose branch matches `^wt/`, that are clean, and whose branch is merged into
  `main`; and
- registered temp dirs under the allowlist `/tmp/csm-*` or `/tmp/opencode/csm-*`
  (never the current session's own directory).

It **refuses and skips** anything else — the main checkout, unmanaged or
detached worktrees, non-`wt/` branches, non-allowlisted paths — and never uses
`git worktree remove --force` for an unverified path. Every removal **and every
refusal** is written to the trace log. Cleanup is idempotent and tolerates
registry entries whose path no longer exists.

## Enforcement

- `tests/trace-log.test.mjs` — trace/decision format, UTC, redaction, append-only.
- `tests/wt-session-cleanup.test.mjs` — dry-run, eligible removal, refusal safety.
- `tests/utc-timestamps.test.mjs` — UTC timestamps across logs and journals.
