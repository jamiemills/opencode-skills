# Enforcement compatibility and non-disruption

The in-loop completion enforcement (the per-cycle evaluator and its binding
receipt) is rolled out **additively**. csm-plan and csm-build records that other
agents already hold must keep working, and the skills code must stay safe to run
concurrently in many repositories at once. Two guards prove it:

```sh
node --test tests/plan-build-v1-compat.test.mjs tests/enforcement-parallel-safety.test.mjs
```

`tests/plan-build-v1-compat.test.mjs` pins the frozen `/1` contract;
`tests/enforcement-parallel-safety.test.mjs` proves the per-run-local model and
concurrent non-serialization. A third, mid-run `/1` assertion (a `/1` record
observed while a loop is live) is owned by the integration acceptance task, not
by this guard.

## Non-disruption guarantees

### `/2` is additive, never a rewrite of `/1`

The new revisions are **new immutable schema ids**, not edits to the old ones:

| Artifact    | Frozen id           | Additive id         | Schema file                                |
| ----------- | ------------------- | ------------------- | ------------------------------------------ |
| plan        | `csm-plan/1`        | `csm-plan/2`        | `csm-plan/schemas/csm-plan.v2.schema.json` |
| build state | `csm-build-state/1` | `csm-build-state/2` | `csm-build/schemas/state.v2.schema.json`   |

The `/1` schema files (`csm-plan/schemas/csm-plan.schema.json`,
`csm-build/schemas/state.schema.json`) are byte-frozen. `/2` adds exactly two
things on top: a typed `supersession` pointer and a terminal `superseded`
status (`SUPERSEDED` cursor for build state, `STOP` + `none; closed as
superseded` for plans). Neither marker is legal on a `/1` record: the `/1`
schema rejects the extra property and the semantic validator rejects the status.

### `/1` writers and readers are unchanged

`createPlanArtifact` still defaults to `csm-plan/1` unless the caller asks for
`csm-plan/2` (via `schemaRevision: 2` or an explicit `schema`). For a `/1` input
its output is byte-for-byte the pre-`/2` canonical record, including the digest,
and `readPlanArtifact`/`writePlanArtifact`/`appendPlanJournal`/
`resumePlanArtifact` round-trip it without perturbation. `createBuildState`
still defaults to `csm-build-state/1`; `transitionBuildState`,
`validateBuildState`, and `completeBuild` leave a `/1` state on revision 1.

A previously-valid `/1` artifact is therefore never silently upgraded: it
validates under `csm-plan/1` and **fails** validation under `csm-plan/2` (and
vice versa). The compatibility test asserts both directions using a
git-committed `csm-build-state/1` record and a frozen `csm-plan/1` canonical
record.

### Readers accept both revisions (writers still emit one)

Each writer emits one revision, and every `/1` consumer reads both:

- `csm-plan/lib/plan.mjs` (`validatePlanArtifact`, `PLAN_SCHEMAS`) — selects the
  schema by the record's own `schema` id.
- `csm-plan/lib/input-resolver.mjs` and `csm-build/lib/bdd-input-resolver.mjs` —
  resolve either revision.
- `csm-build/lib/state.mjs` (`validateBuildState`, `BUILD_SCHEMAS`) — build
  states may be `/1` or `/2`.
- `csm-orchestrate/lib/intake.mjs` (`kindForMarker`) — classifies both plan
  markers and refuses unknown revisions.
- `csm-bdd-tdd/lib/package.mjs` (`PLAN_SOURCE_SCHEMAS`,
  `isSupportedPlanSchema`) — accepts both source-plan revisions.
- `scripts/check-suite.mjs` (`planFormatVersionAccepted`) — the plan corpus
  format-marker gate accepts both revisions; three or more is still refused.
  This is **not** a statement about `csm-orchestrate/capabilities.json`: that
  manifest declares `csm-plan/2` as the demanded plan input schema, so the
  capability names `/2` rather than accepting both.

Consumers that only ever _read_ are revision-agnostic; producers choose. This is
what lets the rollout proceed repo-by-repo without a flag day.

## Per-run-local enforcement (no shared lock)

Enforcement state lives inside each run's own record and is passed by value; it
is never coordinated through a process-global mutex or a shared lock file.

- **Derive, clone, return.** `transitionBuildState`, `supersedeBuildState`,
  `appendPlanJournal`, and `resumePlanArtifact` validate the input, build a
  `structuredClone` of it, mutate only the clone, and return it. The caller's
  object is never mutated, and no two runs share a mutable reference.
- **No shared lock in the skills directory.** `writePlanArtifact` persists via
  `atomicWrite` (`lib/durable-json/index.mjs`), which uses `O_EXCL` plus
  `link`/`rename` — there is no lock acquisition and no lock file next to the
  source. Reading (`readDurableJson`) is lock-free. The only lock in the shared
  runtime, `appendDurableJsonLine`'s `${path}.append-lock`, sits beside the
  target JSONL artifact being appended, not in the skills directory, and the
  packer's `.pack-lock` sits in the pack output root. Neither is touched by plan
  or build enforcement.
- **No module-level mutable state.** The exported contract constants
  (`EVALUATOR_CONTRACT`, `PLAN_SCHEMAS`, `BUILD_SCHEMAS`, `BUILD_STATES`) are
  frozen, and the compatibility modules export no lock, mutex, or semaphore.
- **N concurrent invocations do not serialize.** Concurrent reads of one
  artifact resolve together; concurrent writes to distinct paths all succeed
  because `atomicWrite` never takes a global lock. The guard spawns
  `CONCURRENCY` child processes that each read a shared `/2` artifact, write
  their own `/2` plan, and advance a `/2` build state; it asserts their
  invocation windows overlap and that the batch does not scale with `N ×` a
  single run (a regression to a global lock would show up as serialized time and
  a lock file).

The per-artifact collision behavior is unchanged and intentional: two writers to
the _same_ path still resolve to exactly one winner (`EEXIST` -> `collision`),
because that is a conflict on one artifact, not global serialization.

## Per-task rollback

Rollback is per task, not per release, because a task's writer and its readers
land together:

1. **Revert only that task's commit.** A `/2` writer that misbehaves is reverted
   on its own; sibling tasks are unaffected.
2. **`/1` readers are preserved on purpose.** Because every consumer still reads
   `/1`, reverting a `/2` writer cannot strand or corrupt an existing `/1`
   record. A reverted producer simply emits `/1` again.
3. **No data migration is required to roll back.** `/2` records are additive,
   and the terminal `superseded` status is only produced by `/2` writers; a
   reverted tree still reads them through the dual-revision readers until the
   successor task is restored.
4. **Payload mirrors roll back with the serialized task.** The
   `bootstrap/package/**` mirrors and `csm-orchestrate/capabilities.json` are
   regenerated only by the serialized integration tasks, so a source rollback is
   followed by a regeneration rather than a hand edit.

The compatibility test is the rollback guard: if a future change mutates the
frozen `/1` bytes, upgrades a `/1` record on read, or introduces a shared lock,
it fails before the change can reach the live skills directory.
