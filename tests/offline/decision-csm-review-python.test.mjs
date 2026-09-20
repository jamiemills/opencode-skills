"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-review-python consumes advisory JUDGE severity and dedup", async () => {
  await assertSkillAdvisory({
    skill: "csm-review-python",
    heading: "## Optional Jev Advisory",
    points: ["python-review-judge-severity", "python-review-dedup"],
    answers: {
      "python-review-judge-severity": { answer: "W", confidence: 0.6, providerId: "fake" },
    },
  });
});
