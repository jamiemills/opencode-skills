---
format: csm-plan/1
---

# Paused Fixture CSM Plan

## Control

- Plan ID: paused-fixture
- Status: paused
- Current CSM state: PAUSED
- Cycle: 1
- Commits: allowed
- Last checkpoint: 2026-08-20 paused cleanly on quota exhaustion; checkpoint committed.
- Last model/run: some-model/run-7
- Next transition: PAUSED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal

Hermetic golden fixture for the resume-semantics tests: a plan paused on quota must pass the plan-validation checks.

## Progress Journal

| Timestamp  | Cycle | Transition           | Tasks | Evidence/result                                    | Next state |
| ---------- | ----- | -------------------- | ----- | -------------------------------------------------- | ---------- |
| 2026-08-20 | 1     | CHECKPOINT -> PAUSED | T003  | quota exhausted; paused cleanly per Pause On Quota | PAUSED     |
