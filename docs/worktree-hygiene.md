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
paths or changes the gate outcome.

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
2. Never use a bare `git add -A`, `git add .`, `git clean`, `git stash`, or
   `git checkout --` in the shared checkout.
3. Stage only owned paths and commit with `git commit --only -- <owned paths>`.
4. Do parallel write work in a `wt/<slug>` worktree, merge serially, and re-run
   the gate after merging.
