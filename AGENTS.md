# AGENTS.md — cache/token efficiency rules

Applies only while token efficiency is enabled for the working directory —
OFF by default everywhere (see
`.agents/docs/cache-token-efficiency-2026-08-20.md`). Only an explicit
`.agents/token-efficiency.json` `{"enabled": true}` turns the rules on for
that repo or directory; disabled directories follow default behavior.

## Stable-prefix discipline

- Never add dates, years, versions, `$ENV` values, or absolute paths to skill
  frontmatter descriptions. Volatility breaks DeepSeek prefix-cache units; the
  lint (check-suite volatile/budget checks) enforces this — a volatile token or
  a >220-word frontmatter total fails the gate.
- Frontmatter descriptions total exactly 220 words today. Any edit that changes
  wording re-budgets the 220; a drift above 220 fails the gate.
- No new skills without re-budgeting the 220 words: every skill description is
  injected into every session's prefix, so a 9th skill regresses the budget and
  the cache-friendly prefix. Guidance goes to AGENTS.md/docs, not a new SKILL.md.

## Fresh-session resume over long transcripts

- Plan files under `.agents/plans/` are the durable record. A fresh session
  resumes from the plan's Control, journal, and per-task evidence — never from
  chat history alone.
- Chat transcripts stay disposable. Record what matters in files.

## Compaction and history

- When context approaches limits, compact recall-first: keep durable rules,
  instructions, and evidence in files and re-read them rather than relying on a
  long in-context transcript.
- Append-only history: never rewrite earlier turns in a session. Cache prefix
  units require full match; mutating prior context invalidates them.

## Monitor

- `node scripts/cache-health.mjs [--days N]` — per-session and per-day cache
  hit ratios and cost for deepseek-v4-flash (reads the live opencode DB
  read-only via the bundled `opencode db` CLI). Refuses with a notice when token
  efficiency is disabled for the directory.

## Toggle

- The rules above apply only while `.agents/token-efficiency.json` resolves to
  enabled for the directory being worked in — OFF by default everywhere; only
  an explicit `{"enabled": true}` in that file enables the rules for the repo
  or directory. This repo commits `{"enabled": false}`.

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
