"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

const POINTS = [
  "review-challenger-verdict",
  "severity-bucketing",
  "evidence-class-bucketing",
  "semantic-dedup",
];

test("csm-review consumes the advisory review points and keeps them add-only", async () => {
  await assertSkillAdvisory({
    skill: "csm-review",
    heading: "## Jev Decision Points",
    points: POINTS,
    answers: {
      "review-challenger-verdict": { answer: "downgrade", confidence: 0.4, providerId: "fake" },
    },
  });
});
