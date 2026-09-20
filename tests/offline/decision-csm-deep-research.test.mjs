"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

const POINTS = [
  "deep-research-challenger-verdict",
  "deep-research-judge-factual-accuracy",
  "deep-research-judge-citation-accuracy",
  "deep-research-judge-completeness",
  "deep-research-judge-clarity",
];

test("csm-deep-research consumes advisory challenger verdict and four judge dimensions", async () => {
  await assertSkillAdvisory({
    skill: "csm-deep-research",
    heading: "## Optional Jev Advisory",
    points: POINTS,
    answers: {
      "deep-research-challenger-verdict": {
        answer: "downgrade",
        confidence: 0.2,
        providerId: "fake",
      },
    },
  });
});
