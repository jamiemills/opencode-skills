---
format: csm-plan/1
---

# Paused Fixture CSM Plan (bad transition)

## Control
- Plan ID: paused-fixture-bad-transition
- Status: paused
- Current CSM state: PAUSED
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-20 paused cleanly on quota exhaustion; checkpoint committed.
- Last model/run: some-model/run-7
- Next transition: FROBULATE -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Negative fixture: a Next transition referencing a state outside the machine enum must fail validation.

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 1 | CHECKPOINT -> PAUSED | T003 | quota exhausted; paused cleanly per Pause On Quota | PAUSED |
