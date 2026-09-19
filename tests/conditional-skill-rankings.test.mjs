"use strict";

// T017: the conditional-skill ranking decision point is advisory-only with
// respect to every gate. This test locks the structural contract two ways:
//   1. the decision-adapter registry can never make a ranking authoritative
//      (no apply point may be a safety/authority point), and
//   2. each conditional SKILL.md carries the advisory-ranking note and never
//      claims a ranking gates, alters a verdict, or touches an
//      acceptance/security/completion gate.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  decisionPoints,
  getDecisionPoint,
} from "../csm-orchestrate/lib/decision-adapter/points.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const CONDITIONAL_SKILLS = Object.freeze([
  "csm-scan",
  "csm-ddd",
  "csm-make-tests",
  "csm-bdd-tdd",
  "csm-deep-research",
  "csm-grill",
]);

const RANKING_HEADING = "## Jev Advisory Ranking";
const ADVISORY_NOTE =
  /Jev may provide ADVISORY rankings for this conditional skill; the rankings\s+NEVER gate routing, alter a verdict, or touch any acceptance, security, or\s+completion gate\./;

// Affirmative phrasing that would make a ranking authoritative. These must not
// match the shipped note, which says "the rankings NEVER gate ...".
const AUTHORITATIVE_RANKING_PHRASES = Object.freeze([
  /rankings?\s+(?:gate|gates|decide|decides|determine|determines|authorize|authorizes|override|overrides|change|changes|set|sets)\b/i,
  /rankings?\s+(?:are|is)\s+authoritative\b/i,
  /\b(?:verdict|gate)\b[^.\n]{0,40}\b(?:set|changed|altered|decided|determined)\s+by\s+(?:the\s+)?rankings?\b/i,
]);

async function skillSource(name) {
  return readFile(join(root, name, "SKILL.md"), "utf8");
}

test("conditional-skill-ranking is a non-safety point that can never own a gate", () => {
  const point = getDecisionPoint("conditional-skill-ranking");
  assert.equal(point.seam, "skill-selection");
  assert.equal(point.type, "score");
  assert.equal(point.safetyClass, "non-safety");
  assert.notEqual(point.safetyClass, "authority");

  // The registry rule that makes rankings advisory: only non-safety points may
  // apply at all, so no apply-classified ranking can be authoritative.
  for (const candidate of decisionPoints) {
    if (candidate.applyVsAdvisory === "apply") {
      assert.equal(
        candidate.safetyClass,
        "non-safety",
        `${candidate.id} is apply but not non-safety`,
      );
    }
  }
});

test("every conditional skill carries the advisory-ranking note", async () => {
  const sources = await Promise.all(CONDITIONAL_SKILLS.map(skillSource));
  sources.forEach((source, index) => {
    const name = CONDITIONAL_SKILLS[index];
    assert.ok(source.includes(RANKING_HEADING), `${name} must title the advisory note`);
    assert.match(source, ADVISORY_NOTE, `${name} must carry the advisory-ranking note`);
  });
});

test("rankings are never described as changing a gate or verdict", async () => {
  const sources = await Promise.all(CONDITIONAL_SKILLS.map(skillSource));
  sources.forEach((source, index) => {
    const name = CONDITIONAL_SKILLS[index];
    const headingIndex = source.indexOf(RANKING_HEADING);
    assert.notEqual(headingIndex, -1, `${name} missing advisory-ranking section`);
    const note = source.slice(headingIndex);
    const remainder = source.slice(0, headingIndex);

    // Ranking language lives only in the advisory section.
    assert.doesNotMatch(
      remainder,
      /ranking/i,
      `${name} mentions rankings outside the advisory note`,
    );
    assert.match(note, ADVISORY_NOTE, `${name} advisory note must keep the never-gate clause`);

    for (const phrase of AUTHORITATIVE_RANKING_PHRASES) {
      assert.doesNotMatch(source, phrase, `${name} implies an authoritative ranking`);
    }
  });
});
