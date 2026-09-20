"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-build consumes advisory REVIEW verdicts without touching the evaluator gate", async () => {
  await assertSkillAdvisory({
    skill: "csm-build",
    heading: "## Typed Decisions (Jev)",
    points: ["build-review-verdict"],
    answers: {
      "build-review-verdict": { answer: "needs_repair", confidence: 0.7, providerId: "fake" },
    },
  });
});
