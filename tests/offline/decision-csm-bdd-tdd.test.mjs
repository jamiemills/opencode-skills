"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-bdd-tdd consumes advisory validation verdict without replacing the primary gate", async () => {
  await assertSkillAdvisory({
    skill: "csm-bdd-tdd",
    heading: "## Optional Jev Advisory",
    points: ["bdd-tdd-validation-verdict"],
    answers: {
      "bdd-tdd-validation-verdict": { answer: "valid", confidence: 0.8, providerId: "fake" },
    },
  });
});
