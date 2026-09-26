# Action Traces and Safe Cleanup

Two operational guarantees for long-running, interruptible agent work:

1. **Traces** — durable, UTC-stamped records of the actions taken and the
   justifications for decisions, for future review.
2. **Cleanup** — safe, interruption-proof removal of temporary files and managed
   worktrees, which never performs destructive actions outside verified
   temp/managed paths.

## Traces

`scripts/lib/trace-log.mjs` appends one JSON line per action or decision to a
**single shared per-repo log**. The location is resolved by
`scripts/lib/trace-config.mjs` (config) and `scripts/lib/repo-state.mjs`
(path + worktree anchoring), in this precedence order:

1. **`CSM_TRACE_LOG`** environment variable — honoured only when it is a
   non-empty **absolute** path.
2. **Project** (per-repo) layer: `<main-repo-root>/.csm-skills.json`.
3. **User** (host) layer: `$XDG_CONFIG_HOME/csm/skills.json`
   (default `~/.config/csm/skills.json`).
4. **Default:** `<main-repo-root>/.agents/logs/trace.jsonl`.

The configured value is read from the CSM `csm-skills-config/1` envelope key
`skills["csm-orchestrate"].traceLogPath` (a non-empty string); a relative
configured path is resolved against the main worktree root, an absolute path is
used as-is. The precedence is `env > project > user > default`: the project
layer deliberately **overrides** the user layer, because the user layer is a
host-wide default and the project layer is a per-repo override. A missing,
malformed, non-CSM, or duplicate-keyed config file never throws: a
present-but-invalid layer, or a relative value that would escape the repo root,
resolves to the safe in-repo default `<main-repo-root>/.agents/logs/trace.jsonl`
(it never falls through to a less specific layer, and never writes outside the
repo). An absent layer also resolves to that default.

> **Operator warning — clone-controlled trace redirection.** The PROJECT layer
> file `<repo>/.csm-skills.json` travels with the repository, so a clone (or a
> dependency you vendored) can contain it. An **absolute** `traceLogPath` there
> redirects the append-only trace writer to any path the running user can write,
> where it can overwrite or pollute unrelated files. Treat the project layer as
> untrusted input: set an absolute `traceLogPath` only from the **user** layer
> (`$XDG_CONFIG_HOME/csm/skills.json`, default `~/.config/csm/skills.json`) or
> the **`CSM_TRACE_LOG`** environment variable, both of which the operator
> controls. A relative project value is contained under the repo root; a relative
> value that would escape (a `..` traversal) is refused and falls back to the
> in-repo default.

The default path sits at the **repo root**, deliberately **not** inside `.git`
(state/registry data stays under the common dir; see below). `repo-state.mjs`
anchors it to the **main** worktree root, so every run, agent, and linked
worktree resolves the _same_ file, and it **survives worktree removal** — a
trace written from/after a worktree still lands in that one log. Each entry
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
credential-shaped values, and append. Appends are **concurrency-safe**: each
record is serialized to one line and written with exactly one `write()` on an
`O_APPEND` descriptor, which is atomic across processes on **local POSIX** (best
effort elsewhere). A record whose line would be too large is **truncated with a
`…[truncated:<n>]` marker, never dropped**. The tracked exemplar
`.agents/logs/2026-09-19-action-traces-cleanup-sample.jsonl` is indexed under the
`## logs/` class in `.agents/README.md`; runtime traces live at the repo-root
`.agents/logs/` (kept out of version control by `.gitignore`, not cloned).

> **Legacy location — no loss, never auto-deleted.** Before this default moved
> to the repo root, traces were written to
> `<git-common-dir>/csm/logs/trace.jsonl`, and an earlier design wrote per-run
> files `<main-repo-root>/.agents/logs/<date>-<runId>-trace.jsonl`. Neither is
> written now (a fresh append never touches them) and neither is **ever deleted
> or modified**. To fold any legacy records into the current log — both are
> JSONL, so plain concatenation is valid — run this once from any worktree of
> the repo:
>
> ```bash
> legacy="$(git rev-parse --path-format=absolute --git-common-dir)/csm/logs/trace.jsonl"
> dest="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')/.agents/logs/trace.jsonl"
> mkdir -p "$(dirname "$dest")" && cat "$legacy" >> "$dest"
> ```
>
> Nothing is auto-migrated, so no trace is lost. Run the concatenation only once
> (a second run would duplicate the legacy lines).

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

- `tests/trace-log.test.mjs` — trace/decision format, UTC, redaction, append-only,
  worktree persistence, and the legacy location staying unwritten.
- `tests/trace-config.test.mjs` — configured/default path resolution and precedence.
- `tests/wt-session-cleanup.test.mjs` — dry-run, eligible removal, refusal safety.
- `tests/utc-timestamps.test.mjs` — UTC timestamps across logs and journals.

## Enforcement and verification

Trace emission is gated at orchestrator completion (an audit-emission gate; it
never mutates the run receipt or adds acceptance authority):

- **Policy** — `node scripts/trace.mjs ...` writes one record; the gate decides
  whether a missing record is a failure. Values: `off` (never), `auto` (fail only
  when the run scheduled tracing but produced none; default), `required` (fail on
  any untraced run). Precedence: `--require-trace` / `--no-require-trace` >
  `CSM_TRACE_ENFORCE` > default `auto`. A repo-controlled config file can never
  force enforcement off — only the host flag/env can.
- **Verifier** — `node scripts/verify-traces.mjs --run-id <id> [--file <path>]`
  resolves the same log path the writer used, scans it, and exits `0` (ok), `2`
  (not-ok), or `1` (usage/read error). The gate's own `trace-verification-failed`
  audit is excluded from matching, so recording a failure cannot satisfy the
  invariant.
- **Jev (optional)** — when the decision adapter is opted in, the advisory
  `trace-emission-verdict` point may annotate the deterministic result (persisted
  as a `trace-emission-advisory` decision trace). It never changes the exit code.
