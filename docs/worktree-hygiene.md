# Worktree hygiene

The shared main checkout is the live skills directory: it stays on `main` and
can hold uncommitted artifacts from more than one session at a time (plans,
research, progress files, scratch output). Each parallel session runs in its
own `wt/<slug>` worktree with a private index and staging area (see `AGENTS.md`
→ Parallel sessions), so a session's own writes are isolated; the residual risk
is a session reading past its worktree and treating a foreign uncommitted path
as its own — most sharply when staging with `git add -A`/`git add .` or when
deleting "stray" files.

## Non-destructive detection

`scripts/check-checkout-hygiene.mjs` reads `git status --porcelain` and reports
untracked and tracked-but-uncommitted paths. It only reads: it never stages,
modifies, deletes, checks out, or stashes anything, and it never resolves the
paths or changes the gate outcome. In the shared main checkout it names the
sanctioned remedy for foreign artifacts explicitly: move that write work to a
dedicated `wt/<slug>` worktree (one goal per worktree, `AGENTS.md` → Parallel
sessions), never sweep it into the shared checkout. Inside a linked `wt/<slug>`
worktree the listed paths are that worktree's own in-progress goal; stage only
owned paths there.

The detector report is also the sanctioned way to _record_ a foreign set:
capture the dated list read-only (as below). Recording is an observation only —
it never stages, resolves, or confers ownership of a path, and the live
detector output is always the source of truth.

```sh
# warn only; exits 0 even when the checkout is dirty
node scripts/check-checkout-hygiene.mjs
# explicit opt-in: exit 1 when any uncommitted path is present
node scripts/check-checkout-hygiene.mjs --strict
# same report inside the conformance gate as a non-gating warning
node scripts/check-suite.mjs --warn-uncommitted
```

The default `node scripts/check-suite.mjs` gate is unchanged and still ignores
untracked in-progress corpus drafts (F-053): the hygiene report appears only
when `--warn-uncommitted` is passed and never fails the default gate.

## Procedure before staging or merging

1. Run the detector and read the listed paths; in the shared main checkout,
   treat any uncommitted path you did not create as foreign.
2. Foreign uncommitted artifacts belong in a dedicated `wt/<slug>` worktree,
   not the shared checkout. Move that write work (or start it) in the worktree;
   never stage, sweep, or delete a foreign path to make the checkout look clean.
3. Never use a bare `git add -A`, `git add .`, `git clean`, `git stash`, or
   `git checkout --` in the shared checkout.
4. Stage only owned paths and commit with `git commit --only -- <owned paths>`.
5. Do parallel write work in a `wt/<slug>` worktree, merge serially, and re-run
   the gate after merging.

## Recorded observation: foreign set in the shared checkout

The detector is also how the suite _records_ a foreign set without touching it.
The snapshot below is the observed example captured from the shared main
checkout on 2026-09-17 with `node scripts/check-checkout-hygiene.mjs`. These
paths were read only — none were staged, moved, or deleted. This is a dated
point-in-time record, not an allowlist or a claim of ownership; rely on a fresh
detector run, not this list, before staging.

Concurrent `skills-sh-publish` session:

- `.agents/approaches/2026-09-13-skills-sh-publish-20260913t231500z-skills-sh-publish-approach.json` (approach)
- `.agents/plans/2026-09-13-skills-sh-publish-csm.json` (plan)
- `.agents/research/2026-09-13-skills-sh-publishing-20260913t204500z-skills-sh-publish-research.json` (research)
- `.agents/research/2026-09-13-skills-sh-publish-adversarial-20260913t224500z-skills-sh-adversarial-research.json` (research)
- `PUBLISHING-DEFECTS.md` (scratch/notes)

Concurrent `evals-skill-development` session:

- `.agents/research/2026-09-12-evals-skill-development-20260912t215843z-4b50ae4baacb-research.json` (research)
- `.agents/progress/2026-09-12-evals-skill-development-20260912t215843z-4b50ae4baacb-progress.json` (progress)

Sibling tasks of the same run (`dwrr` remainder closure) touching tracked
files concurrently while this was recorded — uncommitted here and foreign to
the hygiene task; untouched:

- `scripts/bench-dwrr.mjs`, `tests/orchestrate-perf-baseline.test.mjs` (tracked changes)
- `scripts/check-anthropic-mapping.mjs`, `tests/orchestrate-anthropic-mapping.test.mjs` (tracked changes)
- `tests/orchestrate-live-isolation.test.mjs` (tracked change)
- `Makefile`, `docs/dynamic-worker-runtime.md` (tracked changes)

Own in-progress artifacts of the run that recorded this, listed here only
because they too are uncommitted in the shared checkout and must not be swept
by another session:

- `.agents/plans/2026-09-14-dynamic-worker-runtime-remainder-closure-csm.json` (plan)
- `.agents/progress/2026-09-14-dwrr-remainder-closure-20260914t040000z-progress.json` (progress)
- `.agents/README.md` (tracked change: index line for the plan above)
- `docs/worktree-hygiene.md`, `scripts/check-checkout-hygiene.mjs` (this task's edits)

The tracked set moves while a run is live — this snapshot is a dated
observation, and each run must re-detect rather than trust it. Each foreign
writer belongs in its own `wt/<slug>` worktree (`AGENTS.md` → Parallel
sessions); record the set here, hand the write work to the worktree, and never
stage, sweep, or delete a path that is not yours.
