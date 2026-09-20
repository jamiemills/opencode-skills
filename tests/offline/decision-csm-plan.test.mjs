"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-plan consumes advisory critique severity and task risk", async () => {
  await assertSkillAdvisory({
    skill: "csm-plan",
    heading: "## Optional Jev Decision Points",
    points: ["critique-severity", "task-risk"],
    answers: { "critique-severity": { answer: "high", confidence: 0.5, providerId: "fake" } },
  });
});
