"use strict";

// T017: advisory-agreement harness for the review/judge points. It measures
// agreement only; it promotes no threshold and applies nothing.

import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_CALIBRATION_FIXTURES,
  runReviewCalibration,
} from "./decision-calibration-harness.mjs";

test("the review calibration reports agreement over the labelled fixture", async () => {
  const report = await runReviewCalibration();
  assert.equal(report.mode, "advisory-agreement");
  assert.equal(report.promoted, false);
  assert.equal(report.threshold, null);
  const expected = REVIEW_CALIBRATION_FIXTURES.reduce(
    (acc, fixture) => {
      acc[fixture.expected] += 1;
      return acc;
    },
    { agreed: 0, disagreed: 0, unavailable: 0 },
  );
  assert.deepEqual(report.summary, { ...expected, total: REVIEW_CALIBRATION_FIXTURES.length });
  assert.equal(report.summary.total, REVIEW_CALIBRATION_FIXTURES.length);
});

test("every review-calibration record is advisory and never applied", async () => {
  const report = await runReviewCalibration();
  for (const record of report.records) {
    assert.equal(record.advisory, true, record.id);
    assert.equal(record.applied, false, record.id);
  }
});

test("the harness makes no pass/fail or threshold decision", async () => {
  const report = await runReviewCalibration();
  assert.equal(Object.hasOwn(report, "verdict"), false);
  assert.equal(Object.hasOwn(report, "pass"), false);
  assert.equal(report.threshold, null);
});
