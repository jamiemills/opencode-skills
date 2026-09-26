## Entry point

- csm-orchestrate is the single entry point: it accepts `csm-approach/1`
  (grill output), `csm-plan/1` (plan output), or `csm-orchestrate-request/1`
  (any request) and routes to the owning csm skill. Plan execution stays owned
  by csm-build; orchestrate hands execute-plan requests to a csm-build agent
  session (env-gated `CSM_AGENT_SESSION_EXEC=1`), never re-architecting the
  plan into an approach graph.

## Fresh-session resume over long transcripts

- Plan files under `.agents/plans/` are the durable record. A fresh session
  resumes from the plan's Control, journal, and per-task evidence — never from
  chat history alone.
- Chat transcripts stay disposable. Record what matters in files.

## Compaction and history

- As it approaches its limit, context is compacted automatically; write durable
  rules, instructions, and evidence to files and re-read them rather than
  relying on the in-context transcript.
- Do the work rather than narrating constraints: do not stop a task early for
  context reasons.
- Append-only history: never rewrite earlier turns in a session.
- See `docs/context-management.md` for harness context-management guidance.

## Action Traces, UTC Timestamps, and Cleanup

- Record actions and decision justifications as durable, append-only trace
  entries via `scripts/lib/trace-log.mjs`. There is ONE shared trace log per
  repo, defaulting to `<main-repo-root>/.agents/logs/trace.jsonl` (all
  runs/agents/worktrees append to it; anchored to the main worktree root, so it
  survives worktree removal). Configure it with the `csm-skills-config/1` key
  `skills["csm-orchestrate"].traceLogPath` — a host-wide user default in
  `$XDG_CONFIG_HOME/csm/skills.json`, overridden per repo by
  `<repo>/.csm-skills.json`, and further by an absolute `CSM_TRACE_LOG`
  (`env > project > user > default`). Each entry carries `ts`, `runId`, `actor`,
  `action`, `target`, `justification`, `outcome`; appends are single bounded
  writes (local-POSIX atomic) and long records are truncated with a marker,
  never dropped.
- Recording is automatic where code runs: the orchestrator emits a trace for
  every lifecycle hook, and `scripts/wt-session.mjs` traces worktree and cleanup
  events. For an explicit/instruction-led record, run the exact command
  `node scripts/trace.mjs action --actor <a> --action <name> --target <t>
--justification <j> --outcome <o>` (or `make trace ARGS="..."`) — this is the
  command to use when a skill step must leave a trace.
- Trace emission is enforced at orchestrator completion: with policy `required`
  (or `auto` when the run scheduled tracing) a run that produced no trace exits
  non-zero. Check a run with `node scripts/verify-traces.mjs --run-id <id>`.
  Policy precedence is `--require-trace`/`--no-require-trace` > `CSM_TRACE_ENFORCE`
  (`off|auto|required`) > default `auto`; a repo config file cannot force it off.
  When Jev is opted in it may add an advisory trace-emission verdict, which never
  affects the outcome.
- All durable timestamps are ISO-8601 UTC ending in `Z` (`scripts/lib/utc.mjs`).
- At the end of a session, run `node scripts/wt-session.mjs cleanup --dry-run`
  then `cleanup --apply` to remove managed worktrees and allowlisted temp dirs.
  Cleanup is fail-closed: it never deletes anything outside the managed
  worktree root or the `/tmp/csm-*` / `/tmp/opencode/csm-*` allowlist, refuses
  the main checkout and foreign/detached worktrees, is dry-run by default, and
  traces every removal and refusal. See `docs/action-traces-and-cleanup.md`.

## Session end checklist

- End every session by reaping managed resources and verifying none remain:
  1. `node scripts/wt-session.mjs cleanup --dry-run` — review what would be
     removed (deletes nothing).
  2. `node scripts/wt-session.mjs cleanup --apply` — remove eligible managed
     worktrees and allowlisted temp dirs; fail-closed, dry-run by default, and
     never `--force` on an unverified path.
  3. `node scripts/wt-session.mjs leftover` — READ-ONLY report of any managed
     `wt/<slug>` worktree or fully merged `wt/*` branch still remaining; it
     deletes nothing and is warn-only, so add `--strict` to make a non-empty
     report exit non-zero. Reap reported items with `nuke`/`cleanup --apply`.
     `node scripts/check-checkout-hygiene.mjs` includes the same leftover report
     (warn-only; `--strict` opts into a non-zero exit).

## Patch Context Safety

- Re-read the full current target file immediately before patching; never use truncated output as patch context.
- Use stable anchors and small conceptual hunks.
- If `apply_patch` rejects expected lines, do not guess, fuzzy-match, or overwrite. Re-read the current file, inspect concurrent or formatter changes, and retry with a fresh smaller patch.
- Preserve exact-context failure semantics; do not weaken verification.

## Parallel sessions (worktrees)

- One goal per worktree when running parallel csm-grill/plan/build/research
  sessions: from the main checkout run
  `node scripts/wt-session.mjs create <goal-slug>`, run the session inside the
  worktree, then `merge` (rebase + ff-only to main) and `nuke` when done.
- One goal per worktree also means cleaning up after foreign tooling: if
  `git worktree list` shows a detached or non-`wt/` registration (e.g. a
  safety holder left by a history rewrite), reap it with
  `node scripts/wt-session.mjs prune [--force]`; it never touches the main
  checkout or managed `wt/<slug>` worktrees.
- Each worktree has its own index and staging area — sibling sessions cannot
  sweep each other's files into commits (`git add -A` is safe again), the gate
  runs against the worktree's own corpus, and hook races disappear.
- The main checkout stays on `main` (it is the live skills dir); merge
  worktree branches serially and re-run the gate after merging. For
  artifact-only runs the only expected merge conflict is the
  `.agents/README.md` index line — resolve by keeping both lines. Skill-source
  runs (work that touches csm-*/ skill sources or regenerated trees) can also
  collide on the regenerated payload tree (`bootstrap/package/**` +
  `bootstrap/payload-index.json`) and `csm-orchestrate/capabilities.json`;
  `wt-session merge` aborts such merges up front with a recovery message —
  rebase inside the worktree, regenerate, and retry.
- `.agents/README.md` index lines are section-anchored: new artifact bullets
  belong at the end of their own class section (`## plans/`, `## research/`,
  `## builds/`, `## progress/`, ...), never appended to the physical EOF of
  the file. `scripts/check-suite.mjs` enforces section membership.
- The shared main checkout can also hold other sessions' uncommitted
  artifacts. Foreign uncommitted artifacts belong in a dedicated `wt/<slug>`
  worktree (one goal per worktree), not the shared checkout. Detect them
  non-destructively with `node scripts/check-checkout-hygiene.mjs` (warn-only;
  `--strict` is the opt-in that fails) or
  `node scripts/check-suite.mjs --warn-uncommitted`; never stage, sweep, or
  delete a path you did not create (see `docs/worktree-hygiene.md`).
- Commit OWNED paths only: `git commit --only -- <paths>` (never a bare
  `git add -A`/`git add .`). Staging exactly your paths keeps foreign
  uncommitted work out of the commit, so the standing `--no-verify` bypass is no
  longer needed; do not use `--no-verify` to push a dirty-main merge through.
- `wt-session merge` refuses a merge whose paths collide with uncommitted main
  edits (fail-closed). The explicit `--reconcile` opt-in stashes tracked foreign
  edits to a named `wt-session reconcile <slug> <ts>` stash, merges, and
  re-applies them (a conflicting re-apply preserves the named stash); untracked
  collisions always refuse. Resolve by committing/stashing in the main checkout.
- CI's `ci.yml` ignores `wt/**` branches on push (`branches-ignore`), so a
  worktree branch is never CI-validated on its own. The **merged commit on
  `main`** is what CI validates: after merging serially, re-run the gate and
  confirm `main` is CI-green before treating the work as landed.

## In-loop completion enforcement

- csm-plan, csm-build, csm-review, and csm-orchestrate each enforce completion
  inside their own loop: a per-cycle independent evaluator verdict journaled as
  a binding receipt, plus a deterministic loop guard that fails closed while any
  work remains. `/2` schemas are additive and `/1` stays frozen; readers accept
  both. See `docs/enforcement-model.md`.

## Dynamic worker runtime (child seam)

- `csm-orchestrate` remains the single coordination entry point. The only second
  sanctioned entry is the child-side worker seam.
- `scripts/run-worker.mjs` runs exactly one invocation and returns a raw child
  result; it owns no cursor, receipt, gate, or acceptance authority, and is
  env-gated by `CSM_AGENT_SESSION_EXEC=1`.
- Dynamic mode is opt-in, refuses the plan/execute-plan route, and requires a
  declared decomposition policy plus explicit approval. The scheduler is wired
  into the orchestrator (a `dynamicProposal` is validated and compiled into a
  phase/2 phase run through `executeNode`) and exposed by the driver via
  `--dynamic-proposal`.
- Isolation tiers: tier-1 hardened worktree (implemented, credential-scrubbed);
  tier-2 verified sandbox is **implemented with a recorded trust caveat**: the
  Docker provider, periodic re-attestation, egress broker/ledger, and network
  enforcer are wired into the live dispatch path, the isolation gate refuses
  unknown/unsatisfiable isolation regardless of adapter shape, and the declared
  `execution.isolation`/`attestation` requirements are enforced live. Trust
  anchoring defaults to the recorded OS-user-bound g3-ruling boundary and fails
  closed; a host-external anchor remains deferred (see `.agents/docs/g3-ruling.md`).
  Both tiers fail closed; see `docs/dynamic-worker-runtime.md`.
