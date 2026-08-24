"use strict";

const candidates = Object.freeze([
  { id: "candidate-low", parentId: "baseline", value: 4 },
  { id: "candidate-best", parentId: "candidate-low", value: 1 },
  { id: "candidate-anomaly", parentId: "candidate-best", value: NaN },
]);
const evaluate = async (candidate) =>
  Number.isFinite(candidate.value)
    ? { status: "ok", valid: true, metrics: { loss: candidate.value }, gates: { build: true } }
    : { status: "timed_out", valid: false, metrics: {} };
const validate = async (candidate) => ({
  status: "ok",
  valid: candidate.value < 5,
  metrics: { loss: candidate.value },
});
export { candidates, evaluate, validate };
