"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractRepository } from "../lib/ddd/extract.mjs";
import { synthesize } from "../lib/ddd/synthesize.mjs";
import { applyQuestionFile, deriveQuestions, nonInteractiveGaps } from "../lib/ddd/clarify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = join(here, "fixtures", "repos", "sample-repo");
const questionFile = join(here, "fixtures", "question-file.json");

async function fixtureSynthesis() {
  return synthesize(await extractRepository({ root: fixtureRepo }));
}

test("derived questions are dependency-ordered and only ask about real ambiguity or ownership", async () => {
  const synthesis = await fixtureSynthesis();
  const questions = deriveQuestions(synthesis);
  assert.ok(questions.length > 0);
  const seen = new Set();
  for (const q of questions) {
    for (const dep of q.dependsOn)
      assert.ok(seen.has(dep), `question ${q.id} depends on later question ${dep}`);
    seen.add(q.id);
  }
  const termQuestions = questions.filter((q) => q.id.startsWith("q-term-"));
  if (synthesis.terms.some((t) => t.ambiguous)) {
    assert.ok(termQuestions.length >= 1);
    assert.match(termQuestions[0].text, /authoritative/);
  }
});

test("question-file replay is deterministic across runs", async () => {
  const synthesis = await fixtureSynthesis();
  const questions = deriveQuestions(synthesis);
  const fileData = JSON.parse(await readFile(questionFile, "utf8"));
  const first = applyQuestionFile(questions, fileData, synthesis.claims, "fixture");
  const second = applyQuestionFile(questions, fileData, synthesis.claims, "fixture");
  assert.deepEqual(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.rejected.length, 0, "fixture answers must reference known question IDs");
  for (const record of first.applied) {
    assert.ok(record.status === "accepted" || record.status === "recorded-as-alternative");
    assert.equal(record.providedBy, "user");
  }
});

test("a conflicting answer leaves static evidence untouched and records the conflict", async () => {
  const synthesis = await fixtureSynthesis();
  const staticClaim = synthesis.claims.find((c) => c.basis !== "user_provided" && c.subject);
  assert.ok(staticClaim, "fixture synthesis must contain at least one static claim");
  const conflicting = {
    answers: [
      { questionId: "q-owner-9999", subject: staticClaim.subject, value: "user says otherwise" },
    ],
  };
  const questions = [{ id: "q-owner-9999", subject: null, text: "?", dependsOn: [] }];
  const result = applyQuestionFile(questions, conflicting, synthesis.claims, "fixture");
  assert.equal(result.applied[0].status, "recorded-as-alternative");
  const serializedStatic = JSON.stringify(synthesis.claims.find((c) => c.id === staticClaim.id));
  const afterClaims = result.claims.filter((c) => c.basis === "user_provided");
  assert.equal(afterClaims.length, 1);
  assert.match(afterClaims[0].note, /conflicts with|alternative/i);
  assert.doesNotThrow(() => JSON.parse(serializedStatic));
});

test("missing answers surface as unverified gaps, never silence", () => {
  const questions = [
    { id: "q-a", subject: "alpha", text: "Who owns alpha?", dependsOn: [] },
    { id: "q-b", subject: "beta", text: "Who owns beta?", dependsOn: [] },
  ];
  const gapsAll = nonInteractiveGaps(questions, []);
  assert.equal(gapsAll.length, 2);
  for (const gap of gapsAll) {
    assert.equal(gap.status, "unverified");
    assert.match(gap.note, /OPEN QUESTION/);
  }
  const gapsOne = nonInteractiveGaps(questions, [{ questionId: "q-a" }]);
  assert.equal(gapsOne.length, 1);
  assert.equal(gapsOne[0].subject, "beta");
});
