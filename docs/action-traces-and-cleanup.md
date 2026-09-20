# Action Traces and Safe Cleanup

Two operational guarantees for long-running, interruptible agent work:

1. **Traces** — durable, UTC-stamped records of the actions taken and the
   justifications for decisions, for future review.
2. **Cleanup** — safe, interruption-proof removal of temporary files and managed
   worktrees, which never performs destructive actions outside verified
   temp/managed paths.

## Traces

`scripts/lib/trace-log.mjs` appends one JSON line per action or decision to a
**single shared per-repo log** at `<git-common-dir>/csm/logs/trace.jsonl`
(absolute, resolved by `scripts/lib/repo-state.mjs`). Every run, agent, and
worktree appends to that one file, and because it lives under the git common dir
it **survives worktree removal** — a trace written from/after a worktree still
lands in the same log. Each entry carries:

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
credential-shaped values, and append. Appends are **concurrency-safe**: each
record is serialized to one line and written with exactly one `write()` on an
`O_APPEND` descriptor, which is atomic across processes on **local POSIX** (best
effort elsewhere). A record whose line would be too large is **truncated with a
`…[truncated:<n>]` marker, never dropped**. The tracked exemplar
`.agents/logs/2026-09-19-action-traces-cleanup-sample.jsonl` is indexed under the
`## logs/` class in `.agents/README.md`; runtime traces live under the git common
dir (untracked, not cloned).

**Retention:** the shared log is a single append-only file and grows without
bound. There is no automatic rotation; operators should archive/rotate it past a
chosen size threshold (accepted risk). Durability is best-effort (fsync-less):
tail records may be lost on power failure.

## UTC timestamps

Every durable timestamp is ISO-8601 **UTC** ending in `Z`
(`scripts/lib/utc.mjs` `utcNow()` / `isUtc()`). This is enforced by
`tests/utc-timestamps.test.mjs`.

## Cleanup

`scripts/lib/temp-registry.mjs` keeps a durable, **lock-free** registry as
per-entry files under `<git-common-dir>/csm/state/registry.d/<sha256(path)>.json`
(shared across worktrees). Each managed worktree/temp dir created by
`scripts/wt-session.mjs` is one file holding its path, branch, run id, and UTC
timestamp. Because entries are separate files written with atomic `rename`,
concurrent sessions **cannot drop each other's entries** (no read-modify-write,
no lock). A one-time, sentinel-guarded migration imports any legacy
`.agents/state/temp-registry.json`. Because the registry is durable, an
**interrupted** session's resources remain discoverable and can be cleaned later.

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
