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
  worktree branches serially and re-run the gate after merging. The only
  expected merge conflict is the `.agents/README.md` index line — resolve by
  keeping both lines.
