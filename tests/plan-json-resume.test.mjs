import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createPlanArtifact,
  validatePlanArtifact,
  writePlanArtifact,
  resumePlanArtifact,
  appendPlanJournal,
} from "../csm-plan/lib/plan.mjs";

const valid = () =>
  createPlanArtifact({
    planId: "json-resume",
    control: { currentState: "STOP", nextTransition: "STOP -> RECOVER" },
    tasks: [{ taskId: "T001", ordinal: 1, status: "pending", acceptanceSignal: "node --test" }],
    journal: [
      {
        sequence: 0,
        timestamp: "2026-08-25T00:00:00Z",
        cycle: 0,
        transition: "SAVED -> STOP",
        evidence: "saved",
        nextState: "STOP",
      },
    ],
  });

test("valid plan preserves stable task identity and journal sequence", () => {
  const result = validatePlanArtifact(valid());
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("invalid plan rejects duplicate task IDs and unknown lifecycle states", () => {
  const plan = valid();
  plan.tasks.push({
    taskId: "T001",
    ordinal: 2,
    status: "pending",
    acceptanceSignal: "node --test",
  });
  plan.control.currentState = "FUTURE";
  plan.control.nextTransition = "FROBULATE";
  const result = validatePlanArtifact(plan);
  assert.ok(result.errors.some((error) => error.includes("collides")));
  assert.ok(result.errors.some((error) => error.includes("known lifecycle")));
  assert.ok(result.errors.some((error) => error.includes("valid lifecycle transition")));
});

test("lifecycle cursor and status are bidirectionally consistent", () => {
  const paused = valid();
  paused.control.currentState = "PAUSED";
  paused.control.nextTransition = "PAUSED -> RECOVER";
  assert.equal(validatePlanArtifact(paused).valid, false);

  const complete = valid();
  complete.control.currentState = "COMPLETE";
  complete.control.nextTransition = "none (terminal)";
  assert.equal(validatePlanArtifact(complete).valid, false);

  const completeWithoutJournal = valid();
  completeWithoutJournal.status = "complete";
  completeWithoutJournal.control.status = "complete";
  completeWithoutJournal.control.currentState = "COMPLETE";
  completeWithoutJournal.control.nextTransition = "none (terminal)";
  completeWithoutJournal.journal = [];
  assert.ok(
    validatePlanArtifact(completeWithoutJournal).errors.some((error) =>
      error.includes("COMPLETE journal"),
    ),
  );
});

test("JSON applicability enforces the canonical nested contract", () => {
  const plan = createPlanArtifact({
    planId: "applicability-contract",
    applicability: {
      format: "csm-applicability/1",
      decision: "lightweight",
      mode: "risk-first",
      matchedSignals: [],
      evidence: [{ source: "brief", locator: "request", observation: "small change" }],
      obligations: [],
      taskApplicability: { warranted: [], lightweight: [] },
      dddArtifacts: [],
      unresolvedRisks: [],
      bypass: { requested: false, rationale: null },
    },
  });
  plan.applicability.matchedSignals.push("public_contract");
  plan.applicability.matchedSignals.push("public_contract");
  plan.applicability.evidence[0].unexpected = true;
  plan.applicability.bypass.rationale = "not requested";
  const result = validatePlanArtifact(plan);
  assert.ok(result.errors.some((error) => error.includes("duplicates")));
  assert.ok(result.errors.some((error) => error.includes("evidence")));
  assert.ok(result.errors.some((error) => error.includes("bypass")));
});

test("JSON applicability cannot under-scope signals or orphan task slices", () => {
  const plan = createPlanArtifact({
    planId: "applicability-scope",
    applicability: {
      format: "csm-applicability/1",
      decision: "lightweight",
      mode: "risk-first",
      matchedSignals: [],
      evidence: [{ source: "brief", locator: "request", observation: "small change" }],
      obligations: [],
      taskApplicability: { warranted: [], lightweight: [] },
      dddArtifacts: [],
      unresolvedRisks: [],
      bypass: { requested: false, rationale: null },
    },
  });
  plan.applicability.matchedSignals = ["public_contract"];
  plan.applicability.taskApplicability.warranted = ["T999"];
  const result = validatePlanArtifact(plan);
  assert.ok(result.errors.some((error) => error.includes("lightweight decision")));
  assert.ok(result.errors.some((error) => error.includes("does not resolve")));
});

test("paused plans resume through a durable RECOVER journal event", () => {
  const plan = createPlanArtifact({
    planId: "paused",
    status: "paused",
    control: { currentState: "PAUSED", nextTransition: "PAUSED -> RECOVER", activeTasks: ["T001"] },
    tasks: [{ taskId: "T001", ordinal: 1, status: "in_progress", acceptanceSignal: "node --test" }],
    journal: [
      {
        sequence: 0,
        timestamp: "2026-08-25T00:00:00Z",
        cycle: 1,
        transition: "CHECKPOINT -> PAUSED",
        evidence: "quota",
        nextState: "PAUSED",
      },
    ],
  });
  const resumed = resumePlanArtifact(plan, { timestamp: "2026-08-25T00:01:00Z" });
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.control.currentState, "RECOVER");
  assert.equal(resumed.journal.at(-1).nextState, "RECOVER");
});

test("publication refuses collisions and terminal plans cannot be mutated", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-plan-json-"));
  try {
    const path = join(root, ".agents", "plans", "2026-08-25-json-resume-csm.json");
    const plan = valid();
    await writePlanArtifact(path, plan);
    await assert.rejects(() => writePlanArtifact(path, plan), { code: "collision" });
    const terminal = {
      ...plan,
      status: "complete",
      control: {
        ...plan.control,
        status: "complete",
        currentState: "COMPLETE",
        nextTransition: "none (terminal)",
      },
      journal: [
        ...plan.journal,
        {
          sequence: 1,
          timestamp: "2026-08-25T00:01:00Z",
          cycle: 0,
          transition: "STOP -> COMPLETE",
          evidence: "complete",
          nextState: "COMPLETE",
        },
      ],
    };
    assert.throws(
      () =>
        appendPlanJournal(terminal, {
          timestamp: "2026-08-25T00:02:00Z",
          transition: "COMPLETE -> STOP",
          evidence: "no",
          nextState: "STOP",
        }),
      { code: "terminal-immutable" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("journal append and publication reject malformed lifecycle and path inputs", async () => {
  const plan = valid();
  assert.throws(
    () =>
      appendPlanJournal(plan, {
        timestamp: "2026-08-25T00:02:00Z",
        evidence: "missing transition",
      }),
    { code: "invalid-event" },
  );
  assert.throws(
    () =>
      appendPlanJournal(plan, {
        timestamp: "2026-08-25T00:02:00Z",
        transition: "INTAKE -> STOP",
        evidence: "wrong cursor",
        nextState: "STOP",
      }),
    { code: "invalid-transition" },
  );
  const root = await mkdtemp(join(tmpdir(), "csm-plan-path-"));
  try {
    await assert.rejects(() => writePlanArtifact(join(root, "../escape.json"), plan), {
      code: "non-canonical-path",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
