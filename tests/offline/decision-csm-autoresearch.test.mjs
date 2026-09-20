"use strict";

import test from "node:test";

import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-autoresearch consumes advisory judge ranking under deterministic hard gates", async () => {
  await assertSkillAdvisory({
    skill: "csm-autoresearch",
    heading: "## Optional Jev Advisory",
    points: ["autoresearch-judge-ranking"],
    answers: { "autoresearch-judge-ranking": { answer: 3.5, confidence: 0.4, providerId: "fake" } },
  });
});
