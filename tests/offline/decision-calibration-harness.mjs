"use strict";

// T023 (D11): an OPTIONAL, advisory offline calibration harness. It compares the
// answers a Jev decision returns against a declared deterministic baseline over a
// small synthetic fixture set, using a fully injected fake transport. It enforces
// NO thresholds: it only records agreement (agreed / disagreed / unavailable) so
// operators can eyeball whether the optional layer would diverge. There is no
// network, no provider key, and no clock in the result.

import {
  createDecisionAdapter,
  deterministicDecision,
} from "../../csm-orchestrate/lib/decision-adapter/index.mjs";

export const CALIBRATION_SCHEMA = "csm-decision-calibration/1";
export const CALIBRATION_SEED = 20260919;

// A tiny fixed fixture set (D11): synthetic decision inputs plus the candidate
// answer a fake Jev transport returns. `expected` is the classification the
// harness must reproduce; the test asserts observed === expected so the harness
// itself is self-checking without imposing a threshold.
export const CALIBRATION_FIXTURES = Object.freeze(
  [
    {
      id: "cal-route-agree",
      pointId: "route-classification",
      state: { request: "scan this repo", candidates: ["csm-scan", "csm-ddd"] },
      baselineAnswer: "csm-scan",
      candidate: "csm-scan",
      expected: "agreed",
    },
    {
      id: "cal-spike-disagree",
      pointId: "spike-candidacy",
      state: { task: "T900", risk: "low", reversibility: "high" },
      baselineAnswer: "spike",
      candidate: "no-spike",
      expected: "disagreed",
    },
    {
      id: "cal-dispatch-agree",
      pointId: "deep-research-dispatch",
      state: { question: "which algorithm", evidenceGap: "large" },
      baselineAnswer: "dispatch",
      candidate: { type: "choice", choice: "dispatch" },
      expected: "agreed",
    },
    {
      id: "cal-preflag-agree",
      pointId: "secret-preflag",
      state: { finding: "api_key=redacted", likelihood: "medium" },
      baselineAnswer: { type: "noul", noul: true },
      candidate: { type: "noul", noul: true },
      expected: "agreed",
    },
    {
      id: "cal-review-disagree",
      pointId: "review-assignment",
      state: { coverageGap: "concurrency", reviewerFit: "primary" },
      baselineAnswer: "reviewer-a",
      candidate: "reviewer-b",
      expected: "disagreed",
    },
    {
      id: "cal-transport-error",
      pointId: "conditional-skill-ranking",
      state: { repoSignal: "python", taskSignal: "review" },
      baselineAnswer: "csm-review-python",
      candidate: null,
      failure: "rate_limit_exceeded",
      expected: "unavailable",
    },
    {
      id: "cal-empty-answer",
      pointId: "route-classification",
      state: { request: "ambiguous request", candidates: [] },
      baselineAnswer: "csm-ddd",
      candidate: null,
      expected: "unavailable",
    },
  ].map((fixture) => Object.freeze({ ...fixture })),
);

// The deterministic answer vocabulary the adapter uses, mirrored here so the
// harness can compare a candidate against the declared baseline without reaching
// into adapter internals.
function canonicalAnswer(answer) {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "string") return `choice:${answer}`;
  if (typeof answer === "object") {
    if (answer.type === "choice") return `choice:${String(answer.choice ?? "")}`;
    if (answer.type === "noul") return `noul:${answer.noul === true}`;
    if (answer.type === "score") return `score:${JSON.stringify(answer.scores ?? null)}`;
    if (answer.route !== undefined) return `choice:${String(answer.route)}`;
    if (answer.choice !== undefined) return `choice:${String(answer.choice)}`;
    return `json:${JSON.stringify(answer)}`;
  }
  return `literal:${JSON.stringify(answer)}`;
}

export function classifyAgreement(candidateAnswer, baselineAnswer) {
  const candidateKey = canonicalAnswer(candidateAnswer);
  if (candidateKey === null) return "unavailable";
  return candidateKey === canonicalAnswer(baselineAnswer) ? "agreed" : "disagreed";
}

export function summarizeCalibration(records) {
  const summary = { agreed: 0, disagreed: 0, unavailable: 0, total: records.length };
  for (const record of records) summary[record.observed] += 1;
  return Object.freeze(summary);
}

// A fake injected transport keyed by the fixture scenario embedded in the state.
// It never touches the network and returns a scripted candidate per fixture.
export function createFakeTransport(fixtures = CALIBRATION_FIXTURES) {
  const byScenario = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const calls = [];
  return {
    providerId: "fake-calibration",
    calls,
    send: (input) => {
      calls.push(input);
      const fixture = byScenario.get(input?.state?.scenario);
      if (!fixture) return Promise.resolve({ ok: false, failure: { class: "unmapped" } });
      if (fixture.failure)
        return Promise.resolve({
          ok: false,
          failure: { class: fixture.failure, retryable: true },
        });
      return Promise.resolve({
        ok: true,
        decision: { answer: fixture.candidate, confidence: 0.8, usage: {} },
      });
    },
  };
}

// Runs the harness over the fixture set and returns an advisory agreement report.
// No threshold, verdict, or pass/fail is computed or implied.
export async function runDecisionCalibration({
  fixtures = CALIBRATION_FIXTURES,
  seed = CALIBRATION_SEED,
  env = {},
} = {}) {
  const transport = createFakeTransport(fixtures);
  const adapter = createDecisionAdapter({
    mode: "live",
    transport,
    env,
    runId: `calibration-${seed}`,
    circuitThreshold: fixtures.length + 1,
  });

  const records = [];
  for (const fixture of fixtures) {
    const state = {
      ...fixture.state,
      scenario: fixture.id,
      baselineAnswer: fixture.baselineAnswer,
    };
    const baseline = deterministicDecision(fixture.pointId, state);
    const result = await adapter.decide(fixture.pointId, state);
    const candidateAnswer = result?.advice?.answer ?? null;
    records.push(
      Object.freeze({
        id: fixture.id,
        pointId: fixture.pointId,
        expected: fixture.expected,
        observed: classifyAgreement(candidateAnswer, fixture.baselineAnswer),
        baseline: Object.freeze({ answer: fixture.baselineAnswer, source: baseline.source }),
        candidateAnswer,
        applied: result?.applied === true,
        consulted: result?.consulted === true,
      }),
    );
  }

  return Object.freeze({
    schema: CALIBRATION_SCHEMA,
    seed,
    points: Object.freeze([...new Set(fixtures.map((fixture) => fixture.pointId))]),
    records: Object.freeze(records),
    summary: summarizeCalibration(records),
  });
}

export default {
  CALIBRATION_SCHEMA,
  CALIBRATION_SEED,
  CALIBRATION_FIXTURES,
  classifyAgreement,
  summarizeCalibration,
  createFakeTransport,
  runDecisionCalibration,
};
