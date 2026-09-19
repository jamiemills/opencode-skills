# Enforcement evaluator spike: dispatch + obedience feasibility and the deterministic fallback

- **Task:** T013 (spike; findings only, no product code)
- **Approach decision under test:** D9 — the per-cycle continue/stop decision is an
  independent evaluator subagent because there is no opencode Stop hook.
- **Status:** findings recorded; no product code changed by this spike.

## 1. The question

D9 makes an independent evaluator subagent own the per-cycle `continue | complete |
blocked` decision and journal it as a binding receipt. There is no opencode Stop
hook, so the skill's own loop is the only place the decision can be enforced. That
leaves two distinct feasibility questions that must not be conflated:

1. **Dispatch feasibility** — can a fresh, independent evaluator subagent be
   dispatched once per loop cycle, reliably, from inside a running csm skill?
2. **Obedience feasibility** — when that evaluator returns a _binding_ verdict,
   is the primary agent actually guaranteed to obey it (keep looping on
   `continue`), or is obedience merely a hope that the model chooses to honor?

The dispatch+obedience question is: _is a subagent verdict alone sufficient
enforcement, or must a deterministic artifact carry the enforcement weight?_

## 2. Repository evidence: how independent evaluators are already used

The repository already uses independent evaluator subagents in three places. They
differ in exactly one dimension — **who mechanically owns the verdict** — and that
difference is what makes a verdict binding.

### 2.1 csm-deep-research — challenger and judge (advisory, rendered binding by prose)

- `csm-deep-research/SKILL.md:36` separates the four roles that "must never merge":
  synthesizer, challenger, judge, verifier.
- The challenger is dispatched as an independent read-only agent that "returns
  text, never writes files" (`csm-deep-research/SKILL.md:241`); the judge is a
  second independent agent scoring a stable rubric with reasoning-before-verdict
  (`csm-deep-research/SKILL.md:249`, `:251`).
- Independence is real and process-level: the challenger never sees the
  synthesizer's reasoning (`:243`), and the separation is called "the defense"
  (`:109`).

**What makes it binding:** the verdicts are _recorded verbatim_, a judge fail
"routes the run to REMEDIATE" (`:257`), and VERIFY re-checks that flagged
dimensions were actually addressed (`:267`). But the routing is prose the primary
executes; nothing mechanical prevents the primary from declaring the work done.
Even here the one gate that is explicitly not delegated — the verifier — is
"primary-personal, never delegated" (`:36`). The bindingness of an independent
verdict rests on the primary's compliance.

### 2.2 csm-orchestrate — independent final review (mechanically forced)

- `scripts/independent-reviewer.mjs:6-11`: the reviewer "is a separate acceptance
  layer from the producer", returns a typed `ACCEPTED/REJECTED` decision, and then
  — the load-bearing sentence — "The executor still runs `reviewAcceptance`
  authoritatively and **forces REJECTED when the producer gates do not hold**."
- The executor consumes the review and gates the run
  (`csm-orchestrate/lib/index.mjs:1725`, `:1741`, `:1859`).

**What makes it binding:** not the reviewer's authority. A deterministic executor
re-derives the verdict from frozen inputs and _forces_ the outcome. The subagent
is an advisor to a decision that a machine owns. This is the strongest existing
precedent for enforceable independent review.

### 2.3 csm-autoresearch — the separate evaluator (deterministic owner)

- "A separate evaluator owns candidate execution, metrics, hard gates, resource
  limits, and status. Candidates never own their score or evaluator"
  (`csm-autoresearch/SKILL.md:28-29`).
- "Deterministic hard gates outrank targets, LLM proposals, and LLM judges"
  (`csm-autoresearch/SKILL.md:70`).
- Status stops the run only when "the declared threshold and all hard gates pass"
  (`csm-autoresearch/SKILL.md:76`).

**What makes it binding:** the evaluator is not a model asked to judge — it is a
process that owns the ledger and status. Candidate self-report cannot override a
deterministic gate. Verdicts are mechanically binding because a non-model layer
consumes them.

### 2.4 Synthesis of the evidence

| Precedent                      | Independent dispatch | Who owns the verdict    | Binding by                         |
| ------------------------------ | -------------------- | ----------------------- | ---------------------------------- |
| deep-research challenger/judge | yes                  | primary (prose routing) | recorded + re-verified by prose    |
| orchestrate final review       | yes                  | deterministic executor  | `reviewAcceptance` forces REJECTED |
| autoresearch evaluator         | yes                  | deterministic evaluator | hard gates + ledger outrank model  |

Dispatcher feasibility is **proven** — the suite dispatches independent evaluator
subagents today. Obedience-only enforcement is **not** demonstrated anywhere: every
case where a verdict is genuinely unavoidable has a deterministic, non-model layer
owning the decision. The subagent verdict alone has never been shown to bind a
model that chooses to stop.

## 3. Go / No-Go

**Verdict: CONDITIONAL GO.**

- **GO** on independent evaluator dispatch as specified by D9: the repository
  already dispatches independent evaluators per cycle and per run, so the
  dispatch mechanism is feasible.
- **GO** on journaling the evaluator verdict as a typed receipt.
- **NO-GO** on _obedience-only_ enforcement. A binding-in-prose verdict is not
  sufficient for "cannot end with work remaining" because the same
  self-judged-stop failure mode that motivates D9 also applies to honoring a
  verdict. Enforcement must not depend on the model choosing to obey.

The condition on the GO is the deterministic fallback in §4: the evaluator decides
and journals, but a deterministic loop guard the skill runs each cycle is what
mechanically prevents completion while work remains. If the guard exits non-zero,
the loop cannot terminate; the evaluator's verdict accelerates the decision but
does not carry the enforcement weight alone.

## 4. Deterministic in-loop fallback

**Definition.** A loop guard reads the loop's canonical durable record and exits
non-zero iff any work remains. It is deterministic (no model, no network, no
scoring), it is run _inside the loop_ (each cycle, at the CHECKPOINT/acceptance
boundary, never in the Makefile or CI), and it fails closed: unreadable or
malformed records are treated as not-done, never as done.

**Remaining work, per loop** (the guard's predicate):

- any task whose normalized `status` is not terminal, in any record shape
  (`csm-plan/*` and `csm-build-state/*` both expose `tasks[]` in the /2
  revisions); terminal = `complete | completed | done | closed | superseded |
abandoned | skipped | verified`;
- any non-empty `control.activeTasks`
  (`csm-build-state` uses this as the in-flight set);
- a non-terminal lifecycle state (`completion.status` / `control.status` /
  top-level `status`), e.g. `ready`, `in_progress`, `blocked`, `pending`.

The predicate is deliberately status-only. It answers "is there outstanding work
left in the durable record?", not "is the evidence good?". Evidence quality stays
with the evaluator and the existing gates.

**Runnable command (prototype; executed by the spike test).**

```bash
CSM_LOOP_RECORD=<path-to-record.json> node -e '
const fs = require("node:fs");
const record = JSON.parse(fs.readFileSync(process.env.CSM_LOOP_RECORD, "utf8"));
const DONE = new Set(["complete", "completed", "done", "closed", "superseded", "abandoned", "skipped", "verified"]);
const norm = (value) => String(value === undefined || value === null ? "" : value).toLowerCase();
const tasks = Array.isArray(record.tasks) ? record.tasks : [];
const openTasks = tasks.filter((task) => !DONE.has(norm(task && task.status))).map((task) => (task && (task.taskId || task.id)) || "?");
const control = record.control && typeof record.control === "object" ? record.control : {};
const active = Array.isArray(control.activeTasks) ? control.activeTasks.length : 0;
const completion = record.completion && typeof record.completion === "object" ? record.completion : {};
const state = norm(completion.status || control.status || record.status);
const openState = state !== "" && !DONE.has(state);
if (openTasks.length > 0 || active > 0 || openState) {
  console.error("loop-guard: work remains (tasks=" + openTasks.join(",") + ", active=" + active + ", state=" + state + ")");
  process.exit(2);
}
process.exit(0);
'
```

Exit codes: `0` = no outstanding work (the only code that permits the loop to
terminate); `2` = work remains (the loop must continue or recover); a JSON parse
failure throws (`1`) and therefore also blocks termination — fail-closed.

**Where it lands.** The loop tasks promote this prototype to
`node scripts/loop-guard.mjs --record <path>` with identical semantics; the inline
form above is the runnable prototype verified by
`tests/enforcement-evaluator-spike.test.mjs`. Each covered loop calls it every
cycle: csm-plan over its own plan record, csm-build over its build-state record,
csm-review over its findings/closure record, csm-orchestrate over its cursor and
per-node receipts.

**Worked examples from the live corpus** (evidence for the predicate, checked
read-only; no records were modified by this spike):

- `.agents/plans/2026-09-14-csm-completion-fixes-csm.json` is `status: ready` with
  every task `pending` → guard exits `2` (work remains) — exactly the premature
  stop this program exists to catch.
- Corpus plans with top-level `status: complete` but `pending` tasks (4 records)
  are caught by the task predicate even though the lifecycle says complete; the
  guard is strictly stronger than the lifecycle field.
- A fully complete record (every task `completed`, `completion.status: complete`)
  exits `0`.

## 5. Residual uncertainty

- **No Stop hook, so the guard must be invoked.** The guard is deterministic, but
  nothing outside the loop can force the primary to run it. The loop's own
  procedure must make the guard the gate on the transition to COMPLETE; a primary
  that skips the call is indistinguishable from one that obeys a verdict it never
  checks.
- **Record-shape coverage is only as good as the migration.** The guard predicate
  assumes the /2 revisions expose `tasks[].status` and `control.activeTasks`. /1
  records with different fields may read as complete. T003's corpus migration is a
  prerequisite for strict enforcement.
- **Status-only, not correctness.** The guard cannot detect a task marked
  `completed` with failing or fabricated evidence; that remains the evaluator's
  and the acceptance-signal gates' job.
- **Dispatch is not observed live in this spike.** No evaluator subagent was run
  against a real csm-build loop here; dispatch feasibility is inferred from the
  three in-repo precedents. The ~5-cycle obedience measurement named in the
  task's spike candidate remains unrun and is deferred to the loop tasks (T005–T008),
  which must record observed obedience rather than assume it.
- **`blocked` versus abandoned.** The predicate treats `blocked` as outstanding
  work. A loop that is legitimately blocked must still not silently terminate as
  complete; whether `blocked` permits a bounded halt is an evaluator/approval
  decision, not a guard decision.
- **TOCTOU.** The guard reads the record at one instant; a concurrent writer could
  change status between the guard and the transition. The loop tasks should run the
  guard immediately before recording COMPLETE against the same record revision.
