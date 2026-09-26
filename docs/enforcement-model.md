# In-loop completion enforcement model

A csm session must not end while work in its own durable record is still
outstanding. That is the failure this model removes: a run that stops with
pending tasks because the primary agent judged itself finished. opencode has no
Stop hook, so the decision cannot be enforced from outside the loop. Enforcement
therefore lives **inside each csm skill's loop**, once per cycle, and is
per-run.

The model is three layers. The first two make the decision independent and
auditable; the third makes it mechanically unavoidable.

## 1. The three layers

### Per-cycle independent evaluator

At every loop cycle (each forward transition, back-edge, or checkpoint), the
skill dispatches a **fresh evaluator subagent that did not author the current
state**. The evaluator reads only durable state — the goal/acceptance contract
and the record's Control, journal, and task statuses — never chat history, and
must find its own citations in the record. It returns exactly one verdict from
the shared contract:

```
csm-evaluator-contract/1: continue | complete | blocked   (evidence required)
```

csm-orchestrate adds a bounded `remainder` output at the run boundary. The
contract is frozen in each skill (`EVALUATOR_CONTRACT` in
`csm-plan/lib/plan.mjs`, `csm-review/lib/loop-closure.mjs`, and
`RUN_EVALUATOR_CONTRACT` in `csm-orchestrate/lib/recovery.mjs`).

The evaluator's **dispatch** is feasible; its **efficacy** is a CONDITIONAL GO —
independent obedience has not been demonstrated (`docs/enforcement-evaluator-spike.md`).
The deterministic guard below, not the verdict's authority, therefore carries the
enforcement weight.

### Binding receipt

The verdict is not prose. It becomes a typed, content-bound receipt and is
**journaled before the lifecycle cursor advances**; a cycle without a journaled
receipt does not count as evaluated. Receipt digests use the schema-runtime
digest and are revalidated by each skill's validator, so a `/2` record cannot
reach a terminal state without a passing receipt. A non-passing verdict cannot
advance to terminal.

### Deterministic loop guard (the fallback)

A deterministic, status-only guard reads the same durable record and exits
non-zero while any work remains. It is run _inside the loop_ — each cycle and
immediately before any terminal action — never in the Makefile or CI. It fails
closed: an unreadable or malformed record is treated as not-done, never done.
The guard carries the enforcement weight, so completion never depends on a model
choosing to obey a verdict (see `docs/enforcement-evaluator-spike.md`).

Outstanding work is any non-terminal task, a non-empty `control.activeTasks`, or
a non-terminal lifecycle status. Terminal task statuses are
`complete | completed | done | closed | superseded | abandoned | skipped |
verified`; `blocked` is deliberately **not** terminal — it is outstanding work
that must surface to the user, never a silent close.

## 2. Scope: the four covered skills

| Skill           | Per-cycle guard command                                            | Receipt / contract                                            |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| csm-plan        | `node csm-plan/lib/loop-evaluator.mjs guard --record <plan>`       | `csm-plan-evaluator-receipt/1`, `csm-evaluator-contract/1`    |
| csm-build       | `node csm-build/lib/loop-guard.mjs --record <state> --plan <plan>` | `csm-evaluator-receipt/1`, descriptor `evaluator-verdict/<v>` |
| csm-review      | `node csm-review/lib/loop-closure.mjs --record <report>`           | `csm-evaluator-receipt/1`, `csm-review-closure/1`             |
| csm-orchestrate | node/run-boundary evaluator at each phase/node boundary            | `csm-evaluator-contract/1`, `csm-orchestrate-supersession/1`  |

- **csm-plan** — the guard runs in DRAFT through any closure; `closePlan`
  refuses without a journaled, content-bound `verdict: complete` receipt and a
  clear task predicate. The evaluator also lints acceptance signals, but only
  narrowly: it refuses the `Either ... OR ...` pattern and the `OR
record/defer/waive/skip` escape-hatch pattern. It does **not** reject every
  use of "or", so a signal describing a legitimate disjunction outside those two
  forms is not caught. A genuine deferral becomes a `blocked` task carrying the
  user decision it waits on.
- **csm-build** — each cycle ends with an independent verdict journaled via
  `recordEvaluatorReceipt`; `assertCompletionGate` requires both the guard's
  exit `0` and a `complete` verdict receipt before `COMPLETE`. A `/2` build
  cannot reach `COMPLETE` without a receipt.
- **csm-review** — the evaluator checkpoint gates every forward and back-edge
  transition. A `VERIFIED` save requires all three of a `complete` receipt, a
  zero loop-guard exit over the exact record revision, and `canSaveVerified`
  (every finding carries a closed remediation-closure/disposition link). A
  non-zero guard forbids `VERIFIED`; the review may still terminate honestly as
  `INCOMPLETE`/`BLOCKED`. Frozen `/1` review records remain readable and are
  tolerated: mandatory closure applies only to the additive `/2` revision (or a
  finding that already carries a `closure` object), so reverting a `/2` writer
  cannot invalidate an existing `/1` record.
- **csm-orchestrate** — at every node/run boundary the orchestrator evaluates
  the run against its declared control, goal, and acceptance state. A hard node
  failure always fails closed: it is never superseded into `VERIFIED`, and the
  abandoned work is recorded as a typed, resumable
  `csm-orchestrate-supersession/1` pointer (with pending nodes and phases). The
  evaluator may direct at most one bounded remainder phase within the per-run
  `remainderPolicy` budget; a spent budget makes later failure terminal.

csm-orchestrate remains the single coordination entry point. This enforcement
adds **no new acceptance authority**: the evaluator and guard constrain each
skill's own loop and save gate, per run, and never approve or accept external
work.

### No-mock-only rule (manual, not machine-enforced)

csm-review carries a prose checklist rule for live/durable paths: any adapter,
transport, provider, or durable writer MUST have at least one **live or
contract-fixture** test exercising the real wire/disk shape (serialized bytes,
request/response payloads, or on-disk format); a **mock-only** test for such a
path is a defect finding. This rule is deliberately **MANUAL**: its evidence is
the reviewer's cited test file at the pinned SHA, not a schema check, guard
exit, or CI predicate. Nothing in this model — evaluator receipts, the
deterministic loop guard, or `check-suite` — verifies it, so it never blocks a
save and its residual risk is disclosed in the review's Methodology.

## 3. Additive `/2` dual-revision compatibility

The enforcement revisions are **new immutable schema ids**, never edits to the
old ones. `/1` stays byte-frozen history.

| Artifact        | Frozen id               | Additive id             | Schema file                                             |
| --------------- | ----------------------- | ----------------------- | ------------------------------------------------------- |
| plan            | `csm-plan/1`            | `csm-plan/2`            | `csm-plan/schemas/csm-plan.v2.schema.json`              |
| build state     | `csm-build-state/1`     | `csm-build-state/2`     | `csm-build/schemas/state.v2.schema.json`                |
| review findings | `csm-review-findings/1` | `csm-review-findings/2` | `csm-review/schemas/csm-review-findings.v2.schema.json` |

`/2` adds only the enforcement-relevant fields on top of `/1`: a typed
`supersession` pointer plus a terminal `superseded` status for plan and build
state, and a mandatory `closure` record (`csm-review-closure/1`) for review
findings. A `/1` record rejects those additions and is never silently upgraded;
it validates under `/1` and fails under `/2`, and vice versa.

Every reader **accepts both revisions** and selects by the record's own
`schema` id, while each writer emits one revision by default (`/1` unless the
caller asks for `/2`). Readers are revision-agnostic; producers choose. Unknown
revisions fail closed. This is what lets the rollout proceed repo-by-repo
without a flag day. The full consumer list, the byte-frozen guarantee, and the
two-directional validation proof are in `docs/enforcement-compatibility.md`.

## 4. Non-disruption guarantees

The skills are used live by other agents in other repositories, so the rollout
must not perturb concurrent runs.

### Worktree-isolated rollout

Implementation and corpus migration happen in a dedicated `wt/<slug>` worktree
(one goal per worktree). Each worktree has its own index and staging area, so
sibling sessions cannot sweep each other's files into commits and the
conformance gate runs against the worktree's own corpus. The main checkout
stays on `main`; worktree branches merge serially and the gate is re-run after
each merge. Enabling the enforcement in-repo therefore never changes the skills
another session is running from the shared checkout.

### No global lock

Enforcement state is never coordinated through a process-global mutex or a
shared lock file. `writePlanArtifact` persists via `atomicWrite`
(`O_EXCL` + `link`/`rename`) and reads are lock-free; transitions derive a
`structuredClone`, mutate only the clone, and return it, so callers' objects are
never mutated and no two runs share mutable references. The only locks in the
shared runtime sit beside their own append target or pack output root, not in
the skills directory. N concurrent invocations do not serialize.

### Per-run-local state

Enforcement is scoped to the run's own durable record and passed by value. A
per-artifact collision between two writers to the _same_ path still resolves to
one winner (`EEXIST` -> `collision`) — that is a conflict on one artifact, not
global serialization — but distinct runs proceed independently. `tests/
enforcement-parallel-safety.test.mjs` proves the per-run-local model and
concurrent non-serialization; `tests/plan-build-v1-compat.test.mjs` pins the
frozen `/1` contract.

### In-loop precommit gate

A commit is the point where in-loop work becomes shared, so csm-build at
`CHECKPOINT` and csm-plan at `SAVE` must run `make precommit` before any
authorized commit. `precommit` mirrors the fast CI gates in order — `make fmt`,
`node scripts/regen.mjs`, `node scripts/check-suite.mjs`,
`pnpm exec oxlint --deny-warnings`, then the core worktree/trace/state unit
suites — so a cycle that lands green locally lands green in CI. The full
`make test` stays CI-only; `precommit` is the bounded, fast subset the loop can
afford every cycle.

## 5. Rollout

The order is fixed by dependency, and each step is independently mergeable:

1. **Schemas + readers + corpus first.** The additive `/2` schemas, the
   dual-revision readers, and the migrated corpus land before any loop change,
   so the new record shapes are readable everywhere they are written (T002,
   T003, T004).
2. **One skill's loop at a time.** csm-plan, csm-build, csm-review, and
   csm-orchestrate are changed in file-disjoint tasks; each is independently
   testable and each carries its own guard/receipt tests (T005-T008).
3. **Serialized regeneration.** The `bootstrap/package/**` mirrors and
   `csm-orchestrate/capabilities.json` are regenerated only by the serialized
   integration tasks, never hand-edited (T011/T012).
4. **Integration acceptance + docs.** The acceptance suite and this model land
   last, once the per-skill behavior is in place (T009, T010).

Because `/1` remains valid and readers accept both, a step can be merged — or
held back — without a flag day or a coordinated global cutover.

## 6. Per-task rollback

Rollback is per task, not per release, because each task's writer and its
readers land together:

1. **Revert only that task's commit.** A misbehaving `/2` writer is reverted on
   its own; sibling tasks are unaffected.
2. **`/1` readers are preserved on purpose.** Every consumer still reads `/1`,
   so reverting a `/2` writer cannot strand or corrupt an existing `/1` record;
   a reverted producer simply emits `/1` again.
3. **No data migration is required to roll back.** `/2` records are additive and
   the terminal `superseded` status is only produced by `/2` writers; a reverted
   tree still reads them through the dual-revision readers until the successor
   task is restored.
4. **Payload mirrors roll back with the serialized task.** The
   `bootstrap/package/**` mirrors and `csm-orchestrate/capabilities.json` are
   regenerated by the serialized integration tasks, so a source rollback is
   followed by a regeneration rather than a hand edit.

The compatibility and parallel-safety tests are the rollback guard: if a future
change mutates the frozen `/1` bytes, upgrades a `/1` record on read, or
introduces a shared lock, the gate fails before the change can reach the live
skills directory.

## 7. Validation

```sh
node scripts/check-suite.mjs
node --test tests/plan-build-v1-compat.test.mjs tests/enforcement-parallel-safety.test.mjs
```

`check-suite` is the conformance gate; the two test files pin the frozen `/1`
contract and the per-run-local, lock-free behavior. The evaluator spike's
feasibility findings and residual uncertainty are recorded in
`docs/enforcement-evaluator-spike.md`.
