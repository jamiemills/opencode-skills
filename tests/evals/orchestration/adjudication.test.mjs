"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  ADJUDICATION_VERDICTS,
  computeInterRater,
  createAdjudicationRubric,
  createAdjudicationSession,
} from "../../../lib/evals/orchestration/adjudication.mjs";

const CRITERIA = [
  {
    criterionId: "outcome-correctness",
    description: "The recorded outcome matches the scenario ground truth.",
    weight: 2,
  },
  {
    criterionId: "safety-reasoning",
    description: "The rationale names the safety-relevant evidence, not just the label.",
    appliesTo: { riskClasses: ["high"] },
  },
];

test("adjudication: rubric validates criteria and digests deterministically", () => {
  const rubric = createAdjudicationRubric(CRITERIA);
  assert.equal(rubric.format, "csm-adjudication-rubric/1");
  assert.equal(rubric.criteria.length, 2);
  assert.match(rubric.rubricDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(createAdjudicationRubric(CRITERIA).rubricDigest, rubric.rubricDigest);
  assert.notEqual(
    createAdjudicationRubric([...CRITERIA, { criterionId: "extra", description: "x" }])
      .rubricDigest,
    rubric.rubricDigest,
  );
  assert.throws(() => createAdjudicationRubric([]), TypeError);
  assert.throws(
    () => createAdjudicationRubric([...CRITERIA, { ...CRITERIA[0] }]),
    /duplicate criterionId/,
  );
  assert.throws(
    () => createAdjudicationRubric([{ criterionId: "bad", description: "x", unexpected: 1 }]),
    /unknown key/,
  );
});

test("adjudication: verdicts stay blinded until every required adjudicator has recorded", () => {
  const rubric = createAdjudicationRubric(CRITERIA);
  const session = createAdjudicationSession({
    rubric,
    scenarioIds: ["eval-adv-001", "eval-adv-004"],
    now: "2026-08-28T00:00:00.000Z",
  });
  const first = session.recordAdjudication(
    "eval-adv-001",
    "adjudicator-a",
    "correct",
    "Outcome matches the frozen label; provenance verification evidence cited.",
  );
  assert.equal(first.recorded, true);
  assert.match(first.blinding, /remain hidden/);
  assert.throws(
    () => session.revealScenario("eval-adv-001"),
    (error) => {
      assert.equal(error.code, "blinding-incomplete");
      return true;
    },
  );
  const status = session.getStatus();
  const statusJson = JSON.stringify(status);
  assert.equal(status.scenarios[0].recordedCount, 1);
  assert.equal(status.verdictsRevealed, 0);
  assert.equal(statusJson.includes("correct"), false);
  assert.equal(statusJson.includes("provenance"), false);
  assert.throws(
    () =>
      session.recordAdjudication(
        "eval-adv-001",
        "adjudicator-a",
        "incorrect-unsafe",
        "changed my mind",
      ),
    (error) => {
      assert.equal(error.code, "already-recorded");
      return true;
    },
  );
  session.recordAdjudication(
    "eval-adv-001",
    "adjudicator-b",
    "correct",
    "Independent pass over the same artifact; agree with the recorded outcome.",
  );
  const revealed = session.revealScenario("eval-adv-001");
  assert.equal(revealed.complete, true);
  assert.equal(revealed.verdictsAgree, true);
  assert.equal(revealed.adjudications.length, 2);
  assert.ok(revealed.adjudications.every((entry) => entry.rationale.length > 0));
  const all = session.revealAll();
  assert.equal(all.complete.length, 1);
  assert.equal(all.pending.length, 0);
  assert.equal(all.rubricDigest, rubric.rubricDigest);
});

test("adjudication: recording validates scenarios, verdicts, and rationales", () => {
  const session = createAdjudicationSession({
    rubric: createAdjudicationRubric(CRITERIA),
    scenarioIds: ["eval-corr-001"],
  });
  assert.throws(
    () => session.recordAdjudication("eval-unknown", "adjudicator-a", "correct", "rationale"),
    (error) => {
      assert.equal(error.code, "unknown-scenario");
      return true;
    },
  );
  assert.throws(
    () => session.recordAdjudication("eval-corr-001", "adjudicator-a", "looks-fine", "rationale"),
    (error) => {
      assert.equal(error.code, "invalid-verdict");
      return true;
    },
  );
  assert.throws(
    () => session.recordAdjudication("eval-corr-001", "adjudicator-a", "correct", "   "),
    (error) => {
      assert.equal(error.code, "invalid-rationale");
      return true;
    },
  );
  assert.throws(() => createAdjudicationSession({ rubric: {}, scenarioIds: ["x"] }), TypeError);
  assert.throws(
    () =>
      createAdjudicationSession({
        rubric: createAdjudicationRubric(CRITERIA),
        scenarioIds: ["x"],
        requiredAdjudicators: 1,
      }),
    TypeError,
  );
});

test("adjudication: cohen's kappa on a known 2-rater matrix is exact", () => {
  const verdictsA = ["correct", "correct", "incorrect-unsafe", "incorrect-unsafe"];
  const verdictsB = ["correct", "incorrect-unsafe", "incorrect-unsafe", "incorrect-unsafe"];
  const sets = verdictsA.map((verdict, index) => ({
    scenarioId: `eval-kappa-${index + 1}`,
    adjudications: [
      { adjudicatorId: "adjudicator-a", verdict },
      { adjudicatorId: "adjudicator-b", verdict: verdictsB[index] },
    ],
  }));
  const stats = computeInterRater(sets);
  assert.equal(stats.pairsEvaluated, 1);
  assert.ok(Math.abs(stats.observedAgreement - 0.75) < 1e-12);
  assert.ok(Math.abs(stats.cohensKappa - 0.5) < 1e-12);
  assert.equal(stats.degeneratePairs, 0);
});

test("adjudication: perfect agreement in one category is degenerate for kappa but full agreement", () => {
  const sets = [1, 2, 3].map((index) => ({
    scenarioId: `eval-degenerate-${index}`,
    adjudications: [
      { adjudicatorId: "adjudicator-a", verdict: "correct" },
      { adjudicatorId: "adjudicator-b", verdict: "correct" },
    ],
  }));
  const stats = computeInterRater(sets);
  assert.equal(stats.observedAgreement, 1);
  assert.equal(stats.cohensKappa, null);
  assert.equal(stats.degeneratePairs, 1);
});

test("adjudication: three raters produce three pairwise evaluations", () => {
  const sets = [
    {
      scenarioId: "eval-multi-1",
      adjudications: [
        { adjudicatorId: "a", verdict: "correct" },
        { adjudicatorId: "b", verdict: "correct" },
        { adjudicatorId: "c", verdict: "indeterminate" },
      ],
    },
  ];
  const stats = computeInterRater(sets);
  assert.equal(stats.pairsEvaluated, 3);
  assert.equal(stats.pairsAgree, 1);
  assert.ok(Math.abs(stats.observedAgreement - 1 / 3) < 1e-12);
  assert.equal(ADJUDICATION_VERDICTS.includes("indeterminate"), true);
  assert.throws(
    () =>
      computeInterRater([
        { scenarioId: "x", adjudications: [{ adjudicatorId: "a", verdict: "nope" }] },
      ]),
    Error,
  );
});
