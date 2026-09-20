"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoAdvisory,
  guardProtectedInput,
} from "../../csm-orchestrate/lib/decision-adapter/boundary-guard.mjs";
import { assertSkillAdvisory } from "./decision-skill-seam.mjs";

test("csm-orchestrate exposes advisory reviewer findings only to the injected reviewer context", async () => {
  await assertSkillAdvisory({
    skill: "csm-orchestrate",
    heading: "## Optional Jev Decision Points",
    points: ["orchestrate-reviewer-finding"],
    answers: {
      "orchestrate-reviewer-finding": {
        answer: "missing-evidence",
        confidence: 0.3,
        providerId: "fake",
      },
    },
  });
});

test("the deterministic adversarial gate input rejects reviewer advice", () => {
  const gateInput = {
    requirements: ["R1"],
    evidence: ["E1"],
    reviewerAdvice: {
      pointId: "orchestrate-reviewer-finding",
      answer: "uphold",
      providerId: "openrouter",
    },
  };
  assert.equal(guardProtectedInput(gateInput, { label: "adversarial-gate" }).ok, false);
  assert.throws(() => assertNoAdvisory(gateInput, { label: "adversarial-gate" }), /never-Jev/);
});
