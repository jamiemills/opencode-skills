"use strict";

// T006: the optional Jev advisory trace-emission verifier. It is advisory only
// and off by default; the deterministic verifier remains authoritative.

import assert from "node:assert/strict";
import test from "node:test";

import { createConsultSeam } from "../csm-orchestrate/lib/decision-adapter/consult.mjs";
import { getDecisionPoint } from "../csm-orchestrate/lib/decision-adapter/points.mjs";

test("trace-emission-verdict is a registered authority advisory point", () => {
  const point = getDecisionPoint("trace-emission-verdict");
  assert.equal(point.seam, "csm-orchestrate-review");
  assert.equal(point.type, "noul");
  assert.equal(point.safetyClass, "authority");
  assert.equal(point.applyVsAdvisory, "advisory");
});

test("the consult seam returns the advisory verdict and never applies it", async () => {
  const adapter = {
    async decideBatch(ids) {
      return Object.fromEntries(
        ids.map((id) => [id, { answer: 0.8, confidence: 0.7, providerId: "fake" }]),
      );
    },
  };
  const seam = createConsultSeam({ adapter, redact: (value) => value });
  const advice = await seam.consultPoints(["trace-emission-verdict"], {
    runId: "run-x",
    traceLogPath: "/tmp/x",
    matched: 3,
  });
  assert.equal(advice["trace-emission-verdict"].advisory, true);
  assert.equal(advice["trace-emission-verdict"].applied, false);
  assert.equal(advice["trace-emission-verdict"].answer, 0.8);
});

test("a missing adapter is a fail-open error at the seam boundary", () => {
  assert.throws(() => createConsultSeam({}), /requires a decision adapter/);
});
