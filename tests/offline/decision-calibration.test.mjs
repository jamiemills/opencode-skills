"use strict";

// T023 (D11): the optional offline calibration harness runs fully offline with a
// fake injected transport, records agreement against the deterministic baseline,
// and writes an advisory report. NO threshold is enforced and the test never
// requires a network, a provider key, or a wall clock.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CALIBRATION_FIXTURES,
  CALIBRATION_SCHEMA,
  runDecisionCalibration,
} from "./decision-calibration-harness.mjs";

// F7: the advisory report is written to a temp dir, never into the source tree,
// so running the suite does not dirty the repository.
async function reportPath(t) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-calibration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "decision-calibration-report.json");
}

test("the harness reproduces every fixture classification and a consistent summary", async () => {
  const report = await runDecisionCalibration();

  assert.equal(report.schema, CALIBRATION_SCHEMA);
  assert.equal(report.records.length, CALIBRATION_FIXTURES.length);
  for (const record of report.records) {
    assert.equal(
      record.observed,
      record.expected,
      `${record.id}: observed ${record.observed} !== expected ${record.expected}`,
    );
    assert.equal(record.baseline.source, "deterministic-baseline");
  }

  const { agreed, disagreed, unavailable, total } = report.summary;
  assert.equal(agreed + disagreed + unavailable, total);
  assert.equal(total, report.records.length);
  assert.ok(agreed >= 1 && disagreed >= 1 && unavailable >= 1, "fixtures must exercise all three");
});

test("the harness is deterministic and advisory only (no threshold or verdict)", async () => {
  const first = await runDecisionCalibration();
  const second = await runDecisionCalibration();
  assert.deepEqual(first, second);

  assert.deepEqual(Object.keys(first.summary).toSorted(), [
    "agreed",
    "disagreed",
    "total",
    "unavailable",
  ]);
  for (const forbidden of ["threshold", "pass", "fail", "verdict", "score", "gate"])
    assert.ok(!Object.hasOwn(first, forbidden) && !Object.hasOwn(first.summary, forbidden));
});

test("offline run writes an overwriting advisory report the caller can parse", async (t) => {
  const reportFile = await reportPath(t);
  await writeFile(reportFile, '{"stale":true}\n', "utf8");
  const report = await runDecisionCalibration({ env: {} });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const parsed = JSON.parse(await readFile(reportFile, "utf8"));

  assert.equal(parsed.schema, CALIBRATION_SCHEMA);
  assert.equal(parsed.stale, undefined, "the report must be overwritten on each run");
  assert.equal(
    parsed.summary.agreed + parsed.summary.disagreed + parsed.summary.unavailable,
    parsed.summary.total,
  );
  assert.equal(parsed.summary.total, parsed.records.length);
  assert.deepEqual(parsed.summary, report.summary);
});
