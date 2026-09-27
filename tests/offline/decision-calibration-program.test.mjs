import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_CORPUS_N,
  computeMetrics,
  runCalibrationProgram,
  verdict,
} from "./decision-calibration-program.mjs";

const CLASSES = ["security", "privacy", "injection", "destructive", "style", "docs", "perf"];
const makeCorpus = (corpusId = "cal-test-1") => ({
  corpusId,
  split: "heldout",
  items: CLASSES.flatMap((cls) =>
    [1, 2, 3].map((n) => ({
      itemId: `${cls}-${n}`,
      pointId: "review-challenger-verdict",
      adjudicatedLabel: cls,
      labels: [{ annotator: "a1", label: cls, blind: true }],
    })),
  ),
});
const truthOf = (itemId) => itemId.split("-")[0];
const perfect = (item) => ({ predicted: truthOf(item.itemId), confidence: 1 });

test("a perfect classifier is promoted against the L3 thresholds", () => {
  const result = runCalibrationProgram({
    corpus: makeCorpus("cal-promote"),
    classify: perfect,
    profile: "L3",
  });
  assert.equal(result.status, "promote", JSON.stringify(result.metrics));
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.coverage, 1);
  assert.equal(result.metrics.dangerousRate, 0);
});

test("the classifier never sees labels", () => {
  let sawLabels = null;
  runCalibrationProgram({
    corpus: makeCorpus("cal-labels"),
    classify: (item) => {
      sawLabels = ["labels", "adjudicatedLabel", "humanLabels"].filter((key) =>
        Object.hasOwn(item, key),
      );
      return perfect(item);
    },
    profile: "L3",
  });
  assert.deepEqual(sawLabels, [], "labels must be stripped before the classifier call");
});

test("a dangerous adjacent-category error is an absolute kill", () => {
  const result = runCalibrationProgram({
    corpus: makeCorpus("cal-danger"),
    classify: (item) => {
      const truth = truthOf(item.itemId);
      return { predicted: truth === "security" ? "privacy" : truth, confidence: 0.99 };
    },
    profile: "L3",
  });
  assert.equal(result.metrics.dangerousRate > 0, true);
  assert.equal(result.status, "kill");
});

test("low coverage holds rather than promotes", () => {
  const result = runCalibrationProgram({
    corpus: makeCorpus("cal-coverage"),
    classify: (item) =>
      item.itemId.endsWith("-1") ? perfect(item) : { predicted: null, confidence: null },
    profile: "L3",
  });
  assert.ok(result.metrics.coverage < 0.8);
  assert.equal(result.status, "hold");
});

test("a corpus below the minimum n is refused", () => {
  const corpus = { corpusId: "small", split: "heldout", items: makeCorpus().items.slice(0, 3) };
  assert.ok(MIN_CORPUS_N > 3);
  assert.throws(() => runCalibrationProgram({ corpus, classify: perfect }), /minimum n/);
});

test("a non-held-out corpus is refused", () => {
  assert.throws(
    () => runCalibrationProgram({ corpus: { ...makeCorpus(), split: "train" }, classify: perfect }),
    /held-out/,
  );
});

test("a corpus is consumed once; reordering does not re-consume it", () => {
  const corpus = makeCorpus("cal-burn");
  runCalibrationProgram({ corpus, classify: perfect, profile: "L3" });
  const reordered = { ...corpus, items: [...corpus.items].toReversed() };
  assert.throws(
    () => runCalibrationProgram({ corpus: reordered, classify: perfect }),
    /already consumed/,
  );
});

test("an answered prediction without a calibrated confidence is refused", () => {
  assert.throws(
    () =>
      runCalibrationProgram({
        corpus: makeCorpus("cal-conf"),
        classify: (item) => ({ predicted: truthOf(item.itemId) }),
      }),
    /finite confidence/,
  );
});

test("verdict thresholds are pre-registered per profile", () => {
  const perfectMetrics = computeMetrics([{ predicted: "a", adjudicatedLabel: "a", confidence: 1 }]);
  assert.equal(
    verdict(perfectMetrics, { precision: 0.9, recall: 0.9, coverage: 0.8, ece: 0.1, dangerous: 0 })
      .status,
    "promote",
  );
});
