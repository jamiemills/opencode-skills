# Completion supervisor runbook (opencode continuation plugin)

Operator-facing runbook for the optional, **off by default** opencode
continuation supervisor. The supervisor is a pair of files —
`scripts/opencode-plugin/csm-continue.js` (the plugin wrapper) and
`scripts/opencode-plugin/csm-continue-core.mjs` (the pure decision core) — that
re-enter an active csm-build run when work remains. This document covers what it
does, how to opt in, how to kill it, its budget and no-progress stops, the
mandatory pilot before any rollout, success criteria, rollback, and the
explicitly **unverified** re-entry mechanism.

## Overview

When the opencode host emits a `session.idle` event, the plugin locates the
active run's durable record, runs the skill's own deterministic loop guard, and
injects **at most one bounded continuation prompt per idle**. Every path is
fail-closed and silent: an absent run, an unavailable client, or any thrown
error leaves the host untouched (`csm-continue.js:82-111`).

The plugin decides, in precedence order (`csm-continue-core.mjs:70-87`):

1. kill switch — `stop` (`kill-switch`);
2. guard `exitCode === 0` — `stop` (`no-work-remaining`);
3. `blocked`/`paused` record — `pause` (`blocked-or-paused`);
4. any other guard code — `stop` (`guard-unrecognized`, fail closed);
5. otherwise budget/progress checks, else `continue` (`work-remaining`).

The supervisor is **OFF by default**. Nothing installs it automatically: the
installer never runs on import and, without `--apply`, is a read-only dry run
(`scripts/install-opencode-plugin.mjs:8-11,94-121`). Until it is explicitly
opted in it is not present in the plugin directory and has no effect.

## Opt-in

Opt in only with an explicit `--apply`. Dry-run first to see the plan, then
apply:

```
node scripts/install-opencode-plugin.mjs --dry-run
node scripts/install-opencode-plugin.mjs --apply
```

The default target is `~/.config/opencode/plugins`
(`DEFAULT_TARGET` in `scripts/install-opencode-plugin.mjs:24`). The installer
writes the **full dependency set** — `csm-continue.js` and
`csm-continue-core.mjs` — together, because the wrapper imports the core by
relative path; both must land or the import breaks (`PLUGIN_FILES`,
`scripts/install-opencode-plugin.mjs:23`). A second `--apply` is a
byte-identical no-op (unchanged files are skipped, not rewritten). Override with
`--target` / `--source` if needed. The installer prints a machine-readable JSON
summary on stdout.

## Kill switches

Two switches force the supervisor off; both are evaluated first and never
escalate (`csm-continue-core.mjs:22,27-31,71-72`):

- `CSM_CONTINUE_KILL` — set to any truthy value (`1`, `true`, …). Values in
  `{"", "0", "false", "no", "off", "null", "undefined"}` are treated as off, so
  any other non-empty value kills continuation.
- `CSM_CONTINUE_MODE=off` — mode switch; exactly `off` (case-insensitive) stops
  continuation.

Either switch produces `stop` with reason `kill-switch`, so no continuation
prompt is injected. These switches are read fresh from the environment on every
idle (`csm-continue.js:91`), so they take effect without reinstalling.

## Budget and no-progress stop

Two further bounds stop a run that is not making forward progress
(`csm-continue-core.mjs:76-85`):

- **Budget.** The default budget is **5** continuations
  (`DEFAULT_MAX_CONTINUES = 5`, `csm-continue.js:14`). Override it with
  `CSM_CONTINUE_MAX` (a non-negative integer; a missing, negative, or
  non-numeric value falls back to the default, `csm-continue.js:17-20`). When
  `continues >= maxContinues` the core returns `stop` (`budget-exhausted`).
- **Unchanged-digest stop.** Before each continuation the wrapper computes a
  canonical, stable digest of the record (`recordDigest`, sha256 of canonical
  JSON, `csm-continue-core.mjs:48-51`). If the current digest equals the digest
  recorded after the previous continuation, the record has not changed, and the
  core returns `stop` (`no-progress`, `csm-continue-core.mjs:81-85`). This
  breaks a loop that re-enters without altering the durable record.

The active record defaults to `.agents/csm-build-state/active.json`
(`ACTIVE_RECORD_SEGMENTS`, `csm-continue.js:15,27-39`); override the path with
`CSM_CONTINUE_RECORD`, resolved against the working directory.

## Mandatory pilot

**No rollout without the pilot.** Run exactly **ONE real plan** through the
supervisor with the plugin installed and tracing enabled, and count
**stops-per-run**.

- **Measurement.** For the single piloted run, `stops-per-run` is the number of
  supervisor decisions with `action: "stop"` whose reason is **not**
  `no-work-remaining` — i.e. premature stops: `budget-exhausted`,
  `no-progress`, `guard-unrecognized`, or `kill-switch`. A legitimate
  `no-work-remaining` stop is the expected terminal condition and is **not**
  counted. Record the run's decisions (from the plugin/trace output or by
  replaying `node scripts/csm-continue.mjs --record <record> --plan <plan>`),
  plus whether the plan actually reached completion.
- **NO-GO threshold.** The pilot is **NO-GO** if `stops-per-run` does not reach
  **0**, or if a **runaway loop** occurs (the supervisor re-enters on an
  unchanged digest without stopping, or the continuation count exceeds
  `CSM_CONTINUE_MAX`). GO requires `stops-per-run === 0` and exactly one
  `no-work-remaining` stop after the plan is genuinely complete.

Do not scale the supervisor to any other run until this single-plan pilot is GO.

## Success criteria

All of the following must hold before the supervisor leaves pilot status:

- `stops-per-run === 0` on the piloted real plan, with no runaway loop.
- The piloted plan reaches genuine completion; the terminal supervisor decision
  is `no-work-remaining` and no continuation is injected afterwards.
- The kill switches take effect: `CSM_CONTINUE_KILL=1` (or
  `CSM_CONTINUE_MODE=off`) yields `stop` / `kill-switch` and zero prompts.
- The budget and no-progress stops fire as specified (`budget-exhausted` at
  `CSM_CONTINUE_MAX`; `no-progress` on an unchanged digest).
- The **re-entry mechanism** below is verified end-to-end.

## Rollback

Disable the supervisor by deleting the two installed files from the plugin
directory. This fully removes the opt-in and requires no restart of the host
plugin loader beyond a normal restart:

```
rm ~/.config/opencode/plugins/csm-continue.js ~/.config/opencode/plugins/csm-continue-core.mjs
```

If a non-default `--target` was used, delete both files from that target
directory instead. The repo sources under `scripts/opencode-plugin/` are
unaffected and can be reinstalled with `--apply`.

## Re-entry mechanism is UNVERIFIED end-to-end

The re-entry mechanism is **UNVERIFIED** until the mandatory pilot passes. The
two load-bearing assumptions below have not been proven end-to-end by this
repository; they are a spike the pilot must settle:

1. **Does `session.idle` fire at turn completion?** The plugin subscribes to
   `session.idle` (`csm-continue.js:105`); it is unverified that the host emits
   it at the moment a turn completes, rather than at some other point.
2. **Does `client.session.prompt` re-enter without deadlock?** The plugin
   injects the continuation with `client.session.prompt`
   (`csm-continue.js:59-72`); it is unverified that calling it from inside the
   `session.idle` handler re-enters the session cleanly rather than deadlocking.

Treat every behavior above as unproven until the pilot demonstrates both firing
and deadlock-free re-entry on a real plan, and no rollout, promotion, or
documentation claim may assert the mechanism works before then.
