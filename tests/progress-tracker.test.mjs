import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMilestoneSpec,
  renderSkillProgress,
  updateSkillProgress,
  validateSkillProgress,
} from "../lib/progress-tracker.mjs";

function validRecord(overrides = {}) {
  return {
    schema: "csm-skill-progress/1",
    progressId: "progress-test-goal",
    runId: "run-20260904t200000z-test",
    skill: "csm-plan",
    goal: "test the tracker contract",
    status: "active",
    overallPercent: 53,
    milestones: [
      { id: "M1", title: "Recover", weightPercent: 20, status: "complete" },
      { id: "M2", title: "Research", weightPercent: 15, status: "complete" },
      { id: "M3", title: "Design", weightPercent: 45, status: "active", verifiedFraction: 0.4 },
      { id: "M4", title: "Verify", weightPercent: 20, status: "pending" },
    ],
    startedAt: "2026-09-04T19:00:00.000Z",
    updatedAt: "2026-09-04T20:00:00.000Z",
    ...overrides,
  };
}

test("validateSkillProgress accepts the documented SKILL.md example", () => {
  const verdict = validateSkillProgress(validRecord());
  assert.deepEqual(verdict, { ok: true, computedPercent: 53 });
});

test("renderSkillProgress produces the documented bar format", () => {
  const rendered = renderSkillProgress(validRecord());
  const lines = rendered.split("\n");
  assert.match(lines[0], /^TASK PROGRESS  \[[█░]+\] 53%$/);
  const bar = lines[0].match(/\[([█░]+)\]/)[1];
  assert.equal(bar.length, 30);
  assert.equal((bar.match(/█/g) || []).length, Math.round((53 * 30) / 100));
  assert.equal(lines[1], "Milestones");
  assert.equal(lines[2], "[Recover ✓ 20%] [Research ✓ 15%] [Design ▶ 45%] [Verify ○ 20%]");
});

test("validateSkillProgress rejects each failure class", () => {
  const cases = [
    [
      "weight-sum",
      validRecord({
        milestones: validRecord().milestones.map((m) => ({ ...m, weightPercent: 10 })),
      }),
      "must be exactly 100",
    ],
    ["percent-mismatch", validRecord({ overallPercent: 99 }), "overallPercent 99 != computed 53"],
    ["bad-schema-const", validRecord({ schema: "csm-skill-progress/2" }), "must equal"],
    [
      "missing-field",
      (() => {
        const r = validRecord();
        delete r.runId;
        return r;
      })(),
      "runId is required",
    ],
    ["extra-field", validRecord({ extra: true }), "extra is not an allowed property"],
    ["bad-status", validRecord({ status: "done" }), "must be one of"],
    ["bad-pattern", validRecord({ skill: "not-a-csm-skill" }), "must match"],
    [
      "too-few-milestones",
      validRecord({ milestones: validRecord().milestones.slice(0, 2) }),
      "at least 3 items",
    ],
    [
      "too-many-milestones",
      validRecord({
        milestones: [
          { id: "M1", title: "A", weightPercent: 15, status: "complete" },
          { id: "M2", title: "B", weightPercent: 15, status: "complete" },
          { id: "M3", title: "C", weightPercent: 14, status: "complete" },
          { id: "M4", title: "D", weightPercent: 14, status: "active", verifiedFraction: 1 },
          { id: "M5", title: "E", weightPercent: 14, status: "pending" },
          { id: "M6", title: "F", weightPercent: 14, status: "pending" },
          { id: "M7", title: "G", weightPercent: 14, status: "pending" },
        ],
      }),
      "at most 6 items",
    ],
    [
      "active-missing-fraction",
      (() => {
        const r = validRecord();
        delete r.milestones[2].verifiedFraction;
        return r;
      })(),
      "requires verifiedFraction",
    ],
    [
      "complete-not-100",
      validRecord({ status: "complete", overallPercent: 53 }),
      "overallPercent 100",
    ],
    ["bad-timestamp", validRecord({ updatedAt: "yesterday" }), "valid ISO date-time"],
  ];
  for (const [label, record, fragment] of cases) {
    const verdict = validateSkillProgress(record);
    assert.equal(verdict.ok, false, label);
    assert.match(verdict.reason, new RegExp(fragment, "i"), label);
  }
});

test("renderSkillProgress throws on invalid records", () => {
  assert.throws(
    () => renderSkillProgress(validRecord({ overallPercent: 99 })),
    /overallPercent 99/,
  );
});

test("a complete record renders a full bar", () => {
  const record = validRecord({
    status: "complete",
    overallPercent: 100,
    milestones: validRecord().milestones.map((m) => ({ ...m, status: "complete" })),
  });
  const rendered = renderSkillProgress(record);
  assert.match(rendered, /█{30}\] 100%/);
  assert.match(rendered, /\[Verify ✓ 20%\]/);
});

test("updateSkillProgress derives overallPercent from milestones", () => {
  const next = updateSkillProgress(validRecord(), ["M3=complete", "M4=active:0.5"], {
    now: "2026-09-05T08:00:00.000Z",
  });
  assert.equal(next.overallPercent, 90);
  assert.equal(next.status, "active");
  assert.equal(next.updatedAt, "2026-09-05T08:00:00.000Z");
  assert.equal(next.milestones[2].verifiedFraction, undefined);
  assert.equal(next.milestones[3].verifiedFraction, 0.5);
  assert.equal(validateSkillProgress(next).ok, true);
});

test("updateSkillProgress defaults an active milestone to fraction 0", () => {
  const next = updateSkillProgress(validRecord(), ["M3=active"], {
    now: "2026-09-05T08:00:00.000Z",
  });
  assert.equal(next.milestones[2].verifiedFraction, 0);
  assert.equal(next.overallPercent, 35);
  assert.equal(validateSkillProgress(next).ok, true);
});

test("updateSkillProgress derives terminal status and normalizes aliases", () => {
  const record = validRecord({ status: "active", overallPercent: 53 });
  record.milestones = record.milestones.map((m) => ({ ...m }));
  const next = updateSkillProgress(record, ["M3=done", "M4=complete"], {
    now: "2026-09-05T08:00:00.000Z",
  });
  assert.equal(next.status, "complete");
  assert.equal(next.overallPercent, 100);

  const resumed = updateSkillProgress(next, ["M4=in_progress:0.25"]);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.overallPercent, 85);
  assert.equal(resumed.milestones[3].status, "active");
  assert.equal(resumed.milestones[3].verifiedFraction, 0.25);
});

test("updateSkillProgress never emits an invalid record (fail-closed)", () => {
  assert.throws(() => updateSkillProgress(validRecord(), ["M9=complete"]), /unknown milestone/);
  assert.throws(() => updateSkillProgress(validRecord(), ["bogus"]), /invalid milestone spec/);
  assert.throws(() => updateSkillProgress(validRecord(), ["M3=weird"]), /invalid milestone spec/);
  assert.throws(
    () => updateSkillProgress(validRecord(), ["M3=active:2"]),
    /invalid milestone spec/,
  );
});

test("parseMilestoneSpec shape and rejections", () => {
  assert.deepEqual(parseMilestoneSpec("M1=complete"), { id: "M1", status: "complete" });
  assert.deepEqual(parseMilestoneSpec("M2=active:0.25"), {
    id: "M2",
    status: "active",
    verifiedFraction: 0.25,
  });
  assert.equal(parseMilestoneSpec("M2=complete:0.5"), null);
  assert.equal(parseMilestoneSpec("M2="), null);
  assert.equal(parseMilestoneSpec("nope"), null);
  assert.deepEqual(parseMilestoneSpec("M2=done"), { id: "M2", status: "complete" });
});
