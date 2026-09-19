# Context Management (harness-owned)

This repository keeps context-window management in the harness, not in the model.
Agents should not estimate or narrate token budgets, context exhaustion, or prompt
length; they should do the work.

## Principle

- The model acts; the harness measures and compacts.
- Enforced limits live in code (schemas, byte/line/output caps, timeouts, step and
  cost budgets), never in prose the model is asked to police itself.
- Real token/cost numbers are surfaced to the **operator/UI only** — never fed to
  the model as a number to reason about. Anthropic's task-budget guidance shows
  that a too-small or client-decremented budget causes premature stops and
  refusal-like behaviour, so any budget shown to a model must be a single
  generous, server-tracked, advisory countdown that is never client-decremented.

## Recommended opencode compaction configuration (host-owned)

The host `~/.config/opencode` (or project) `opencode.json` should enable automatic
compaction, e.g.:

```jsonc
{
  "compaction": { "auto": true, "prune": true, "reserved": 10000 },
}
```

`compaction.auto` already defaults to `true` in opencode; verify it is not
disabled, and set `prune`/`reserved` to taste. **Editing host configuration is
out of scope for this repository's plans and is a user-owned action.**

## Token numbers

`scripts/cache-health.mjs` reads per-session token and cost figures from the
opencode DB (`input` / `cache.read` / `cache.write` / `cost`) for operator
reporting. Do not add any path that feeds these numbers back into a model prompt.

## Wording

Prefer positive brevity ("be concise; act rather than narrate") over
token-minimization instructions, and do not add bans such as "never mention
tokens"; stating the intended behaviour plus its reason is the documented
stronger form.

## Related

- `AGENTS.md` → "Compaction and history"
- `.agents/research/2026-09-19-instruction-budget-talk-20260919t173000z-d645b954bc62-research.json`
