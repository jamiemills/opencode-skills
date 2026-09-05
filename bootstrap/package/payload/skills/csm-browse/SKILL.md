---
name: csm-browse
description: Browse pages in the chromium-vnc Docker container via CDP. Use when driving a headful browser, logging in, capturing screenshots/videos, or inspecting pages. Never targets port 9222.
---

# CSM Browse

## Progress Tracker

Progress tracking is ON by default for every invocation. Create and maintain a
versioned `csm-skill-progress/1` JSON record via `lib/progress-tracker.mjs` (update it only through `node lib/progress-tracker.mjs update <record> M<id>=<status>[:<fraction>]`, which derives `overallPercent` and normalizes statuses — never hand-edit the JSON); it supplements this skill's lifecycle,
artifacts, permissions, receipts, and evidence and never replaces them.
Declare 3–6 milestones before work begins, each with a positive weight; weights
must total exactly 100%.

```text
TASK PROGRESS  [████████████████░░░░░░░░░░░░] 53%
Milestones
[Setup ✓ 20%] [Navigate ✓ 30%] [Inspect ▶ 30%] [Evidence ○ 20%]
```

Calculate `completed_weight + active_weight × verified_fraction`; retries retain
one logical item and never add credit. Unknown, skipped, cancelled, blocked,
failed, and incomplete work is never silently complete. If scope changes,
record old/new scope, reason, and revised weights before recalculating.
If scope cannot be estimated honestly, emit `TASK PROGRESS  not estimated` and
keep progress indeterminate.

Render one overall horizontal bar and one milestone row at declaration,
meaningful transitions, scope changes, and terminal completion. Use this
skill's lifecycle: setup (20%), navigate (30%), inspect (30%), evidence (20%).
Retries retain one logical item and never add credit. Unknown, blocked, failed,
incomplete, and unestimated work remains indeterminate. Scope changes record
old/new scope, reason, and revised weights. `--quiet-progress` suppresses
tracker text only; it never disables JSON tracking, hides blockers, or changes
the session/evidence lifecycle.

Browse progress output is limited to bounded, redacted event summaries and
artifact references. Never include passwords, cookie or token values, typed
secrets, authorization headers, private page text, access-granting session
identifiers, or unredacted network payloads. `--allow-sensitive` authorizes an
operation, not progress disclosure.

## When to use this skill

Use `csm-browse` whenever you need to drive a headful Chromium browser inside the `chromium-vnc` Docker container via Chrome DevTools Protocol (CDP). This covers navigating to URLs, clicking elements, typing text, pressing keys, logging into sites, taking screenshots (viewport or full-page), inspecting DOM or evaluating JavaScript, capturing console/network/performance events, and recording screencast videos.

## Interface

- Consumes: a browsing/evidence task and the `chromium-vnc` Docker container
- Produces: validated JSON session/event/evidence descriptors under `.agents/browse/<session-id>/state.json` and `events.jsonl`, with screenshots/videos/binary evidence referenced by digest; projections are disposable
- Hands off: JSON evidence descriptors and referenced files return to the human; publishing via the csm-upload CLI is a separate user action and accepts descriptors, not Markdown/HTML projections
- Never invokes: csm-bdd-tdd, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload, csm-make-tests, csm-review-python, csm-ddd, csm-autoresearch

## One-time setup

```bash
cd $HOME/.config/opencode/skills/csm-browse && pnpm install
```

Verify the install:

```bash
node -e "require('chrome-remote-interface'); console.log('ok')"
node scripts/check-skill.mjs
```

## Session workflow

1. **Ensure** a session exists:

   ```bash
   node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --session <sid>
   ```

   This starts or adopts a container, launches an isolated Chromium, sets up the CDP forward, spawns the session daemon, and writes `state.json`.

2. **Use verbs** against the session:

   ```bash
   node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs <verb> --session <sid> [args...]
   ```

3. **Close** when done:

   ```bash
   node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs close --session <sid>
   ```

## Verb reference

All verbs use the same entrypoint with absolute paths:

```
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs <verb> --session <sid> [...]
```

| Verb                                   | Description                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open <url>`                           | Navigate only to `http` or `https` URLs and wait for `Page.loadEventFired`.                                                                                                                                                                                                                                                                                              |
| `wait <ms>`                            | Pause for the given number of milliseconds.                                                                                                                                                                                                                                                                                                                              |
| `wait-selector <selector> [timeoutMs]` | Poll until `document.querySelector(selector)` is truthy.                                                                                                                                                                                                                                                                                                                 |
| `click <selector> [index]`             | Click the element matching the selector (0-indexed for multiple matches).                                                                                                                                                                                                                                                                                                |
| `type <selector> <text>`               | Insert text into the target element. The result confirms success and selector only; typed text is never printed.                                                                                                                                                                                                                                                         |
| `press <selector> <key>`               | Click to focus the element, then dispatch a key event (e.g. `press "#username" Enter`, `press "body" Tab`).                                                                                                                                                                                                                                                              |
| `text [selector] --allow-sensitive`    | Retrieve bounded `textContent` of the page or of a specific selector. Requires explicit authorization.                                                                                                                                                                                                                                                                   |
| `html [selector] --allow-sensitive`    | Retrieve bounded `outerHTML` of the page or of a specific selector. Requires explicit authorization.                                                                                                                                                                                                                                                                     |
| `eval <expression> --allow-sensitive`  | Evaluate a JavaScript expression with a 5-second timeout and 1 MiB output cap. Requires explicit authorization.                                                                                                                                                                                                                                                          |
| `screenshot [--small                   | --medium                                                                                                                                                                                                                                                                                                                                                                 | --full] [--viewport] [--quality N] [outPath]` | Capture a screenshot. Defaults to full-page (auto-stitched). `--viewport` = viewport only. `--small` = JPEG 30, `--medium` = JPEG 80 (default), `--full` = lossless PNG. `--quality N` overrides compression. (auto-dismisses consent walls first) |
| `console`                              | Read all captured console events from `events.jsonl`.                                                                                                                                                                                                                                                                                                                    |
| `network`                              | Read all captured network events from `events.jsonl`.                                                                                                                                                                                                                                                                                                                    |
| `performance`                          | Get live performance metrics (`Performance.getMetrics`).                                                                                                                                                                                                                                                                                                                 |
| `cookies [--values]`                   | Get cookies for the current page. Cookie **values are masked by default** (≤8 chars → `****`, longer → `first4…last4`) so session tokens never land in transcripts/scrollback. `--values` prints full values only with `CSM_BROWSE_REVEAL_COOKIES=1` set (warns first; refuses otherwise) — HttpOnly session tokens will persist in logs; use only when strictly needed. |
| `status`                               | Print browser version, tab info, and daemon liveness.                                                                                                                                                                                                                                                                                                                    |
| `screencast-start <name> [--small      | --medium                                                                                                                                                                                                                                                                                                                                                                 | --full] [--speed slow                         | medium                                                                                                                                                                                                                                             | fast]` | Start recording video (VP9/webm). `--speed` controls output fps: slow=3, medium=7 (default), fast=15. (auto-dismisses consent walls first) |
| `screencast-stop`                      | Stop the active video recording.                                                                                                                                                                                                                                                                                                                                         |
| `close`                                | Clean up the session: kill daemon, chromium, crashpad, the CDP gate, remove session dirs, release ports.                                                                                                                                                                                                                                                                 |

An unrecognized verb prints `Unknown verb: <verb> — see SKILL.md verb table` to stderr and exits non-zero, so the verb table above is the authoritative reference for valid verbs.

## Login composition example

The fixture server (`node tests/serve.mjs`) binds the docker bridge gateway on an ephemeral port and prints its base URL on the `READY <port>` line. Set `CSM_BROWSE_FIXTURE_BASE` to override the detected base; otherwise use the URL printed by the server.

```bash
SID=my-login-test
node $HOME/.config/opencode/skills/csm-browse/tests/serve.mjs &   # prints: fixture server on http://<gateway>:<port>
node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --session $SID
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs open --session $SID --url "http://<gateway>:<port>/login.html"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs wait-selector --session $SID "#username"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs type --session $SID "#username" "alice"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs type --session $SID "#password" "secret"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs click --session $SID "#submit"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs wait-selector --session $SID "#result"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs text --session $SID "#result" --allow-sensitive
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs close --session $SID
```

## VNC live view

The container exposes a VNC server on `localhost:5900`. Connect with any VNC client to watch the browser live. This is purely observational — all control happens via CDP. **Accepted security boundary:** VNC is exposed on host loopback only (`127.0.0.1:5900`), not as a remote or public VNC service; this cycle intentionally does not change the generated password policy.

## Isolation note

This skill launches a **second, isolated Chromium instance** inside the `chromium-vnc` container with its own `--user-data-dir`, XDG directories, and crashpad database. It uses a dedicated CDP port from the pool (9224+). **Never target port 9222 for session work** — that is the container's primary shared browser and must remain untouched.

The shared container itself is hardened: it runs on a dedicated `csm-browse-net` bridge (off the default bridge, so sibling containers cannot reach its CDP relay), drops the dangerous Linux capabilities the image does not need, disables new privileges, mounts a read-only rootfs with writable tmpfs for `/tmp`/`/run`/`/dev/shm`, applies cgroup limits (`--memory`/`--cpus`/`--pids-limit`/`--shm-size`), and passes `--remote-debugging-address=127.0.0.1` so Chromium's debug server binds loopback only. Docker's default seccomp profile stays active. Port 9222 is **not published to the host**, and the image's own `0.0.0.0:9222` socat relay (which would otherwise answer unauthenticated CDP on the container's bridge IP) is neutralized on every container create/start/restart — the shared CDP is reachable **only** through the token-gated loopback funnel on `127.0.0.1:9222` (the same host-side `cdp-gate` used by sessions, with a shared token stored in `~/.config/csm-browse/container-token`). A bare `curl http://localhost:9222/json/version` against that funnel is rejected (`403`), the container's bridge IP refuses CDP entirely, and only the tokenized URL form is accepted.

## Maintenance

Sessions stood up by this skill are swept automatically: every `ensure-browser` run first removes sessions idle longer than 10 minutes (host daemons, container-side chromiums, host CDP gates, host and container session dirs, stale recorder locks, orphaned daemons). The session being ensured is never touched, and the primary shared browser is never affected.

Manual deep-clean:

```bash
node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --cleanup-stale [--age N] [--dry-run]
```

- `--age N` — staleness threshold in minutes (default 10)
- `--dry-run` — report only, remove nothing

## Troubleshooting

**Session-dir layout** (`$XDG_RUNTIME_DIR/csm-browse/<sid>/`, falling back to `~/.local/state/csm-browse/<sid>/`; override root with `CSM_BROWSE_SESSIONS_ROOT`):

| Path                             | Meaning                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.json`                     | Session state (cdpUrl, wsUrl, token, ports, daemonPid). Written atomically (tmp+rename) at 0600.                                                     |
| `daemon.pid`                     | PID of the session daemon.                                                                                                                           |
| `daemon.ready`                   | Ready marker; a live daemon touches its mtime every ~2s.                                                                                             |
| `creating.marker`                | Transient: present only while a session is being created; both sweep passes treat it as do-not-touch.                                                |
| `gate.log`                       | CDP gate diagnostics (tunnel spawn/exit failures). The gate itself is a host process (`scripts/cdp-gate.mjs`) listening on `127.0.0.1:<publicPort>`. |
| `cmd/` `cmd/running/` `cmd/out/` | Verb queue: commands land in `cmd/`, are claimed by rename into `cmd/running/`, results written to `cmd/out/` (processed oldest-ts first).           |
| `events.jsonl`                   | Captured console/network events (rotated).                                                                                                           |
| `artifacts/`                     | Screenshots and videos.                                                                                                                              |
| `recorder.json`                  | Screencast recorder state (`running:true` while recording).                                                                                          |
| `daemon.log`                     | Daemon stdout/stderr. Each daemon start re-creates this log, so copy it out before restarting if you need the history.                               |

**CDP authentication**: every session's CDP endpoint is protected by a per-session token. `cdpUrl` and `wsUrl` in `state.json` already carry `?token=<value>` (the raw token also lives in the `token` field); the value is redacted from transcripts and logs. Connections without the token are answered `403` by the host-side gate before any byte reaches Chromium. The shared container's primary browser on port 9222 is gated the same way: its funnel lives on `127.0.0.1:9222`, reads a shared token from `~/.config/csm-browse/container-token`, and rejects bare/unauthenticated probes with `403`. `ensure-browser` rotates the per-session token (new generation) whenever it has to reconnect the daemon to an existing session, and `close`/sweep revokes it by removing the gate and `state.json`.

**"Daemon not ready" diagnosis flow** (ensure-browser prints this after 2 attempts):

1. Check host memory — the daemon is the usual OOM victim (`free -m`); ensure-browser prints available MB.
2. Read `<session-dir>/daemon.log` for the crash reason.
3. `state.json` → `daemonPid`: does `kill -0 <pid>` respond? A responding pid with a stale `daemon.ready` (mtime older than ~10s) is a zombie daemon — ensure-browser detects and restarts these itself; a second failure means the log from step 2.
4. Confirm the CDP endpoint answers. Prefer the mechanical form (reads `state.json`, keeps the token out of shell history): `curl -m 2 "$(node -e 'const u=new URL(JSON.parse(require("fs").readFileSync("<session-dir>/state.json","utf8")).cdpUrl);u.pathname="/json/version";console.log(u.toString())')"`. Manual form: copy the full tokenized `cdpUrl` from `state.json` VERBATIM — it ends with `/?token=<value>` (an empty `/` path) — and replace that lone `/` immediately before `?token=` with the discovery path (`curl -m 2 "http://127.0.0.1:<publicPort>/json/version?token=<value-pasted-verbatim-from-cdpUrl>"`). Never append a path after the query and never retype or hand-construct the token. If it does not answer, the chromium or the gate died — re-run ensure-browser to recreate the session.

**E2E suite**: `node tests/e2e.mjs [--quick]` requires Docker + the chromium-vnc container (it skips cleanly with `SKIP: Docker/chromium-vnc unavailable`, exit 0, when they are absent; `CSM_BROWSE_E2E_SKIP=1` forces the skip). Summary JSON goes to `CSM_BROWSE_E2E_SUMMARY` or the sessions root's `.e2e-summary.json`.
