"use strict";

import { createHash } from "node:crypto";

const FORMAT = "csm-autoresearch-llm-adapter/1";
const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 100_000,
  maxOutputBytes: 100_000,
  timeoutMs: 1_000,
  maxRetries: 0,
  maxTokens: 2_048,
  maxCost: 0,
  maxResponseBytes: 100_000,
});
const LIVE_REFUSAL = "live LLM mode is disabled: DEF-EVAL is unresolved";

class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetError";
  }
}
class LiveModeRefusedError extends Error {
  constructor() {
    super(LIVE_REFUSAL);
    this.name = "LiveModeRefusedError";
  }
}

function stable(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function bytes(value) {
  return Buffer.byteLength(String(value), "utf8");
}
function limitNumber(value, name, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new RangeError(`${name} must be an integer between 0 and ${maximum}`);
  return value;
}
function limits(input = {}) {
  const merged = { ...DEFAULT_LIMITS, ...input };
  for (const key of [
    "maxInputBytes",
    "maxOutputBytes",
    "timeoutMs",
    "maxRetries",
    "maxTokens",
    "maxResponseBytes",
  ]) {
    if (!Number.isInteger(merged[key]) || merged[key] < 0) throw new RangeError(`invalid ${key}`);
  }
  if (merged.maxProposals !== undefined) limitNumber(merged.maxProposals, "maxProposals", 50);
  if (typeof merged.maxCost !== "number" || !Number.isFinite(merged.maxCost) || merged.maxCost < 0)
    throw new RangeError("invalid maxCost");
  return merged;
}
function redact(value) {
  return String(value ?? "")
    .replace(
      /(bearer\s+|api[_-]?key\s*[:=]\s*|secret\s*[:=]\s*|password\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(?:[A-Za-z]:)?\/[^\s,;]+/g, "[PATH_REDACTED]");
}
function provenance(request, adapterId, extra = {}) {
  return {
    adapterId,
    requestHash: stable({ id: request?.id, content: redact(request?.content) }),
    redacted: true,
    ...extra,
  };
}
function assertRequest(request, configured) {
  if (!request || typeof request.id !== "string" || typeof request.content !== "string")
    throw new TypeError("request id and content are required");
  if (bytes(request.content) > configured.maxInputBytes)
    throw new BudgetError("input byte budget exceeded");
}
function assertMode(mode, options) {
  if (mode === "live") {
    if (
      options?.defEval !== "resolved" ||
      options?.egress !== "approved" ||
      options?.credentials !== true
    )
      throw new LiveModeRefusedError();
    throw new LiveModeRefusedError(); // No live transport is intentionally shipped.
  }
  if (mode !== "stub") throw new RangeError("mode must be stub or live");
}
async function invokeWithBudget(fn, request, configured) {
  const estimatedTokens = request.tokens ?? Math.ceil(bytes(request.content) / 4);
  if (!Number.isFinite(estimatedTokens) || estimatedTokens > configured.maxTokens)
    throw new BudgetError("token budget exceeded");
  if ((request.cost ?? 0) > configured.maxCost) throw new BudgetError("cost budget exceeded");
  let attempt = 0;
  while (true) {
    attempt++;
    const started = Date.now();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => fn(request, { attempt })),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new BudgetError("request timed out")),
            configured.timeoutMs,
          );
        }),
      ]);
      const output = JSON.stringify(result);
      if (bytes(output) > configured.maxOutputBytes || bytes(output) > configured.maxResponseBytes)
        throw new BudgetError("response byte budget exceeded");
      return { result, attempt, elapsedMs: Date.now() - started };
    } catch (error) {
      if (attempt > configured.maxRetries) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

const families = ["lexical", "structural", "parameter", "constraint", "hybrid"];
function familyFor(index) {
  return families[index % families.length];
}
function proposalText(content, family, index) {
  return `[${family}] ${content.trim()} (variant ${index + 1})`;
}
function createProposer(options = {}) {
  const mode = options.mode ?? "stub";
  const configured = limits(options.limits);
  assertMode(mode, options);
  const adapterId = options.adapterId ?? "stub-proposer";
  const transport =
    options.transport ??
    ((request) => {
      const count = Math.min(request.maxProposals ?? configured.maxProposals ?? 5, 50);
      return Array.from({ length: count }, (_, index) => ({
        id: `${request.id}-p${index + 1}`,
        content: proposalText(request.content, familyFor(index), index),
        family: familyFor(index),
        metadata: { seed: request.seed ?? "default", diversityFamily: familyFor(index) },
      }));
    });
  return {
    format: FORMAT,
    adapterId,
    kind: "proposer",
    mode,
    limits: configured,
    async propose(request) {
      assertRequest(request, configured);
      const requested = request.maxProposals ?? configured.maxProposals ?? 5;
      limitNumber(requested, "maxProposals", 50);
      const { result, attempt } = await invokeWithBudget(
        transport,
        { ...request, maxProposals: requested },
        configured,
      );
      const seen = new Set();
      const proposals = [];
      for (const item of result ?? []) {
        const content = redact(item.content);
        const key = stable(content.trim().toLowerCase());
        if (!content || seen.has(key)) continue;
        seen.add(key);
        proposals.push({
          id: String(item.id ?? `${request.id}-p${proposals.length + 1}`),
          content,
          family: item.family ?? "unknown",
          metadata: { ...item.metadata, diversityFamily: item.family ?? "unknown" },
          provenance: provenance(request, adapterId, { attempt }),
        });
        if (proposals.length >= requested) break;
      }
      return {
        id: request.id,
        proposals,
        advisory: true,
        provenance: provenance(request, adapterId, { attempt }),
      };
    },
  };
}
function screenProposals(proposals, hooks = []) {
  const accepted = [];
  const rejected = [];
  for (const proposal of proposals ?? []) {
    let reason = null;
    if (!proposal?.id || typeof proposal.content !== "string" || !proposal.content.trim())
      reason = "invalid";
    for (const hook of hooks)
      if (!reason && typeof hook === "function") {
        const result = hook(proposal);
        if (result !== true && result !== undefined)
          reason = typeof result === "string" ? result : "screen_rejected";
      }
    if (reason) rejected.push({ proposal, reason });
    else accepted.push(proposal);
  }
  return { accepted, rejected };
}

function score(value, salt) {
  return Number.parseInt(stable({ value, salt }).slice(0, 8), 16) % 101;
}
function createJudge(options = {}) {
  const mode = options.mode ?? "stub";
  const configured = limits(options.limits);
  assertMode(mode, options);
  const adapterId = options.adapterId ?? "stub-judge";
  return {
    format: FORMAT,
    adapterId,
    kind: "judge",
    mode,
    limits: configured,
    async judge(request) {
      const normalized = {
        ...request,
        content: request?.content ?? JSON.stringify(request?.candidates ?? []),
      };
      assertRequest(normalized, configured);
      const estimatedTokens = normalized.tokens ?? Math.ceil(bytes(normalized.content) / 4);
      if (estimatedTokens > configured.maxTokens) throw new BudgetError("token budget exceeded");
      if ((normalized.cost ?? 0) > configured.maxCost)
        throw new BudgetError("cost budget exceeded");
      const candidates = Array.isArray(request.candidates) ? request.candidates : [];
      if (candidates.length < 2) throw new TypeError("at least two candidates are required");
      const blinded = candidates.map((candidate, index) => ({
        ...candidate,
        blindId: `candidate-${index + 1}`,
      }));
      const scores = blinded.map((candidate) => ({
        blindId: candidate.blindId,
        score: score(candidate.content, request.seed ?? request.id),
      }));
      scores.sort((a, b) => b.score - a.score || a.blindId.localeCompare(b.blindId));
      const spread = scores[0].score - scores[scores.length - 1].score;
      const confidence = Math.min(1, spread / 100);
      const disagreement = request.independentScores
        ? disagreementRate(scores, request.independentScores)
        : 0;
      const calibrated = calibrate(confidence, request.calibration ?? []);
      const lowConfidence = calibrated < (request.lowConfidenceThreshold ?? 0.4);
      const ranking = scores.map((entry, ordinal) => ({
        blindId: entry.blindId,
        ordinal: ordinal + 1,
        score: entry.score,
      }));
      const comparisons =
        request.comparison === "pairwise"
          ? scores.flatMap((left, index) =>
              scores.slice(index + 1).map((right) => ({
                left: left.blindId,
                right: right.blindId,
                winner: left.score >= right.score ? left.blindId : right.blindId,
              })),
            )
          : undefined;
      return {
        id: request.id,
        mode: request.comparison ?? "ordinal",
        ranking,
        ...(comparisons ? { comparisons } : {}),
        winner: scores[0].blindId,
        confidence: calibrated,
        advisory: true,
        calibration: {
          anchors: request.calibration?.length ?? 0,
          applied: calibrated !== confidence,
        },
        disagreement,
        route: lowConfidence || disagreement > 0.25 ? "human-review" : "accept-advisory",
        provenance: provenance(normalized, adapterId, { blinded: true, redactedCandidates: true }),
      };
    },
  };
}
function calibrate(confidence, anchors) {
  return anchors.length
    ? Math.max(
        0,
        Math.min(
          1,
          (confidence * anchors.reduce((sum, anchor) => sum + (anchor.reliability ?? 1), 0)) /
            anchors.length,
        ),
      )
    : confidence;
}
function disagreementRate(left, right) {
  const map = new Map(right.map((entry) => [entry.blindId, entry.score]));
  const differences = left.filter(
    (entry) => map.has(entry.blindId) && Math.abs(entry.score - map.get(entry.blindId)) > 20,
  ).length;
  return left.length ? differences / left.length : 0;
}

async function propose(request, options) {
  return createProposer(options).propose(request);
}
async function judge(request, options) {
  return createJudge(options).judge(request);
}

export {
  FORMAT,
  DEFAULT_LIMITS,
  BudgetError,
  LiveModeRefusedError,
  createProposer,
  createJudge,
  propose,
  judge,
  screenProposals,
  redact,
  provenance,
  stable,
  calibrate,
};
