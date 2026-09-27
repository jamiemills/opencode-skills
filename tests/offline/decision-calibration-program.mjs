"use strict";

// T028/T004: a pre-registered calibration PROGRAM. Given a human-labelled,
// held-out corpus and an injected classifier, it computes per-class precision
// and recall, coverage, expected calibration error, and a dangerous-error rate,
// then returns promote/hold/kill against pre-registered thresholds.
//
// Anti-rubber-stamp: the classifier never sees labels (stripped before the
// call); a corpus below the minimum size or not held-out is refused; any
// dangerous adjacent-category error is an absolute kill; a corpus is consumed
// once (burn-after-use) keyed by corpusId + its sorted label set, so reordering
// cannot re-consume it; answers must carry a finite confidence in [0,1].

import { digest } from "../../lib/schema-runtime/index.mjs";

export const PROGRAM_SCHEMA = "csm-decision-calibration/2";
export const MIN_CORPUS_N = 20;

// Known confidently-wrong adjacent categories. Any confusion is an absolute kill.
export const DANGEROUS_PAIRS = Object.freeze([
  ["security", "privacy"],
  ["destructive", "data-integrity"],
  ["injection", "defensive"],
]);

export const THRESHOLD_PROFILES = Object.freeze({
  L2: { precision: 0.8, recall: 0.75, coverage: 0.5, ece: 0.15, dangerous: 0 },
  L3: { precision: 0.9, recall: 0.85, coverage: 0.8, ece: 0.1, dangerous: 0 },
  L4: { precision: 0.98, recall: 0.95, coverage: 0.9, ece: 0.05, dangerous: 0 },
});

const LABEL_KEYS = ["labels", "adjudicatedLabel", "humanLabels"];
const consumedCorpora = new Set();

function stripLabels(item) {
  const clone = { ...item };
  for (const key of LABEL_KEYS) delete clone[key];
  return Object.freeze(clone);
}

function corpusKey(corpus) {
  const labels = corpus.items.map((item) => item.adjudicatedLabel ?? null).toSorted();
  return digest({ corpusId: corpus.corpusId ?? null, n: corpus.items.length, labels });
}

function bucket(confidence) {
  return Math.min(9, Math.max(0, Math.floor(confidence * 10)));
}

export function computeMetrics(observations) {
  const perClass = new Map();
  let answered = 0;
  const eceBins = Array.from({ length: 10 }, () => ({ total: 0, correct: 0, confidence: 0 }));
  let dangerous = 0;
  for (const obs of observations) {
    const truth = obs.adjudicatedLabel;
    if (truth != null) {
      const entry = perClass.get(truth) ?? { tp: 0, fp: 0, fn: 0 };
      if (obs.predicted === truth) entry.tp += 1;
      else entry.fn += 1;
      perClass.set(truth, entry);
      if (obs.predicted != null && obs.predicted !== truth) {
        const bad = perClass.get(obs.predicted) ?? { tp: 0, fp: 0, fn: 0 };
        bad.fp += 1;
        perClass.set(obs.predicted, bad);
      }
      const b = bucket(obs.confidence);
      eceBins[b].total += 1;
      eceBins[b].confidence += obs.confidence;
      if (obs.predicted === truth) eceBins[b].correct += 1;
    }
    if (obs.predicted != null) answered += 1;
    for (const [a, b] of DANGEROUS_PAIRS)
      if ((truth === a && obs.predicted === b) || (truth === b && obs.predicted === a))
        dangerous += 1;
  }
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const entry of perClass.values()) {
    tp += entry.tp;
    fp += entry.fp;
    fn += entry.fn;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const coverage = observations.length === 0 ? 0 : answered / observations.length;
  let ece = 0;
  for (const bin of eceBins) {
    if (bin.total === 0) continue;
    ece +=
      (bin.total / observations.length) *
      Math.abs(bin.correct / bin.total - bin.confidence / bin.total);
  }
  return {
    precision,
    recall,
    coverage,
    ece,
    dangerousRate: observations.length === 0 ? 0 : dangerous / observations.length,
    n: observations.length,
  };
}

export function verdict(metrics, thresholds) {
  const checks = {
    precision: metrics.precision >= thresholds.precision,
    recall: metrics.recall >= thresholds.recall,
    coverage: metrics.coverage >= thresholds.coverage,
    ece: metrics.ece <= thresholds.ece,
  };
  if (metrics.dangerousRate > 0) return { status: "kill", checks: { ...checks, dangerous: false } };
  if (Object.values(checks).every(Boolean))
    return { status: "promote", checks: { ...checks, dangerous: true } };
  if (metrics.precision < thresholds.precision * 0.5)
    return { status: "kill", checks: { ...checks, dangerous: true } };
  return { status: "hold", checks: { ...checks, dangerous: true } };
}

export function runCalibrationProgram({
  corpus,
  classify,
  profile = "L3",
  consumedDigests = consumedCorpora,
} = {}) {
  if (!corpus || !Array.isArray(corpus.items)) throw new TypeError("corpus.items required");
  if (corpus.split !== "heldout") throw new TypeError("corpus must be a held-out split");
  if (corpus.items.length < MIN_CORPUS_N)
    throw new TypeError(`corpus below minimum n=${MIN_CORPUS_N}`);
  const key = corpusKey(corpus);
  if (consumedDigests.has(key)) throw new TypeError("corpus already consumed (burn-after-use)");
  const threshold = THRESHOLD_PROFILES[profile];
  if (!threshold) throw new TypeError(`unknown threshold profile ${profile}`);
  const observations = corpus.items.map((item) => {
    const stripped = stripLabels(item);
    const prediction = classify(stripped) ?? { predicted: null, confidence: null };
    const predicted = prediction.predicted ?? null;
    if (
      predicted !== null &&
      !(
        Number.isFinite(prediction.confidence) &&
        prediction.confidence >= 0 &&
        prediction.confidence <= 1
      )
    )
      throw new TypeError("an answered prediction requires a finite confidence in [0,1]");
    return {
      itemId: item.itemId,
      adjudicatedLabel: item.adjudicatedLabel ?? null,
      predicted,
      confidence: predicted === null ? null : prediction.confidence,
    };
  });
  consumedDigests.add(key);
  const metrics = computeMetrics(observations);
  const outcome = verdict(metrics, threshold);
  return {
    schema: PROGRAM_SCHEMA,
    schemaRevision: 2,
    pointId: corpus.pointId ?? "cross-domain",
    verdict: outcome.status,
    profile,
    corpusKey: key,
    split: corpus.split,
    metrics,
    status: outcome.status,
    checks: outcome.checks,
  };
}
