"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { createJudge } from "../lib/llm/index.mjs";
import { judgeRequest } from "./fixtures/llm-stub.mjs";

test("stub judge returns deterministic blinded ordinal/pairwise advisory results", async () => {
  const judge = createJudge();
  const first = await judge.judge(judgeRequest());
  const second = await judge.judge(judgeRequest());
  assert.deepEqual(first, second);
  assert.equal(first.advisory, true);
  assert.equal(first.provenance.blinded, true);
  assert.deepEqual(
    first.ranking.map((item) => item.ordinal),
    [1, 2, 3],
  );
  assert.match(first.route, /accept-advisory|human-review/);
});

test("judge calibrates confidence and routes disagreement or low confidence", async () => {
  const judge = createJudge();
  const result = await judge.judge({
    ...judgeRequest(),
    calibration: [{ reliability: 0.1 }],
    lowConfidenceThreshold: 0.9,
    independentScores: [
      { blindId: "candidate-1", score: 0 },
      { blindId: "candidate-2", score: 100 },
      { blindId: "candidate-3", score: 0 },
    ],
  });
  assert.equal(result.calibration.applied, true);
  assert.equal(result.route, "human-review");
  assert.equal(result.disagreement > 0, true);
});
