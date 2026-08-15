---
name: csm-browse
description: Browse web pages in the chromium-vnc Docker container via CDP — use when you need to drive a headful browser, log in to sites, capture screenshots or videos, or inspect pages. It never targets the container's primary browser on port 9222; drives its own isolated Chromium only.
---

# CSM Browse

## When to use this skill

Use `csm-browse` whenever you need to drive a headful Chromium browser inside the `chromium-vnc` Docker container via Chrome DevTools Protocol (CDP). This covers navigating to URLs, clicking elements, typing text, pressing keys, logging into sites, taking screenshots (viewport or full-page), inspecting DOM or evaluating JavaScript, capturing console/network/performance events, and recording screencast videos.

## One-time setup

```bash
cd $HOME/.config/opencode/skills/csm-browse && npm install --no-audit --no-fund
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

| Verb | Description |
|---|---|
| `open <url>` | Navigate to a URL and wait for `Page.loadEventFired`. |
| `wait <ms>` | Pause for the given number of milliseconds. |
| `wait-selector <selector> [timeoutMs]` | Poll until `document.querySelector(selector)` is truthy. |
| `click <selector> [index]` | Click the element matching the selector (0-indexed for multiple matches). |
| `type <selector> <text>` | Insert text into the target element. |
| `press <selector> <key>` | Click to focus the element, then dispatch a key event (e.g. `press "#username" Enter`, `press "body" Tab`). |
| `text [selector]` | Retrieve `textContent` of the page or of a specific selector. |
| `html [selector]` | Retrieve `innerHTML` of the page or of a specific selector. |
| `eval <expression>` | Evaluate a JavaScript expression on the page and print the result. |
| `screenshot [--small|--medium|--full] [--viewport] [--quality N] [outPath]` | Capture a screenshot. Defaults to full-page (auto-stitched). `--viewport` = viewport only. `--small` = JPEG 30, `--medium` = JPEG 80 (default), `--full` = lossless PNG. `--quality N` overrides compression. |
| `console` | Read all captured console events from `events.jsonl`. |
| `network` | Read all captured network events from `events.jsonl`. |
| `performance` | Get live performance metrics (`Performance.getMetrics`). |
| `cookies` | Get cookies for the current page. |
| `status` | Print browser version, tab info, and daemon liveness. |
| `screencast-start <name> [--small|--medium|--full] [--speed slow|medium|fast]` | Start recording video (VP9/webm). `--speed` controls output fps: slow=3, medium=7 (default), fast=15. |
| `screencast-stop` | Stop the active video recording. |
| `close` | Clean up the session: kill daemon, chromium, crashpad, socat, remove session dirs, release ports. |

An unrecognized verb prints `Unknown verb: <verb> — see SKILL.md verb table` to stderr and exits non-zero, so the verb table above is the authoritative reference for valid verbs.

## Login composition example

```bash
SID=my-login-test
node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --session $SID
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs open --session $SID --url "http://172.17.0.1:8090/login.html"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs wait-selector --session $SID "#username"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs type --session $SID "#username" "alice"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs type --session $SID "#password" "secret"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs click --session $SID "#submit"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs wait-selector --session $SID "#result"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs text --session $SID "#result"
node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs close --session $SID
```

## VNC live view

The container exposes a VNC server on `localhost:5900`. Connect with any VNC client to watch the browser live. This is purely observational — all control happens via CDP.

## Isolation note

This skill launches a **second, isolated Chromium instance** inside the `chromium-vnc` container with its own `--user-data-dir`, XDG directories, and crashpad database. It uses a dedicated CDP port from the pool (9224+). **Never target port 9222** — that is the container's primary shared browser and must remain untouched.

## Maintenance

Sessions stood up by this skill are swept automatically: every `ensure-browser` run first removes sessions idle longer than 10 minutes (host daemons, container-side chromiums/socats, host and container session dirs, stale recorder locks, orphaned daemons). The session being ensured is never touched, and the primary shared browser is never affected.

Manual deep-clean:

```bash
node $HOME/.config/opencode/skills/csm-browse/scripts/ensure-browser.mjs --cleanup-stale [--age N] [--dry-run]
```

- `--age N` — staleness threshold in minutes (default 10)
- `--dry-run` — report only, remove nothing
