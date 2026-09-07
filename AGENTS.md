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

- When context approaches limits, compact recall-first: keep durable rules,
  instructions, and evidence in files and re-read them rather than relying on
  a long in-context transcript.
- Append-only history: never rewrite earlier turns in a session.

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
