"use strict";

// Shared assertion helper for the T009-T016 skill advisory wirings. It checks
// (a) the SKILL.md declares the advisory-only contract within the <500 cap and
// (b) the consult seam returns advisory verdicts for the skill's points and
// never applies them.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createConsultSeam } from "../../csm-orchestrate/lib/decision-adapter/consult.mjs";

export async function assertSkillAdvisory({ skill, points, heading, answers = {} }) {
  const text = await readFile(new URL(`../../${skill}/SKILL.md`, import.meta.url), "utf8");
  const lines = text.split("\n");
  assert.ok(lines.length < 500, `${skill}/SKILL.md is ${lines.length} lines (must be < 500)`);
  assert.ok(/Jev/i.test(text), `${skill}/SKILL.md must mention Jev`);
  assert.ok(/advisory/i.test(text), `${skill}/SKILL.md must declare the Jev advice advisory`);
  assert.ok(/never/i.test(text), `${skill}/SKILL.md must declare a never-Jev boundary`);
  if (heading) assert.ok(text.includes(heading), `${skill}/SKILL.md must contain "${heading}"`);

  const calls = [];
  const adapter = {
    calls,
    async decideBatch(ids) {
      calls.push(ids);
      return Object.fromEntries(
        ids.map((id) => [
          id,
          answers[id] ?? {
            answer: "agree",
            confidence: 0.5,
            providerId: "fake",
            providerModel: "t",
          },
        ]),
      );
    },
  };
  const seam = createConsultSeam({ adapter, redact: (value) => value });
  const advice = await seam.consultPoints(points, { claim: "x" });
  assert.equal(calls.length, 1, `${skill}: one batched consult call`);
  for (const id of points) {
    assert.ok(advice[id], `${skill}: ${id} returns advice`);
    assert.equal(advice[id].advisory, true, `${skill}: ${id} advice is advisory`);
    assert.equal(advice[id].applied, false, `${skill}: ${id} never applies`);
  }
  return { text, advice };
}
