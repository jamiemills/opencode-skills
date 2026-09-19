"use strict";

// T011/T018: the provider-agnostic fail-open owner. The adapter composes an
// injected transport (T008) with the deterministic harness. The fail-open
// contract is absolute: every provider/network/timeout/malformed/cap error class
// reverts to the deterministic baseline, the adapter never throws, and it never
// sets PAUSED. The module never imports or mutates a gate or verdict; the only
// I/O is the injected transport. A run-scoped circuit breaker stops calling the
// transport after consecutive failures, two env switches force the off/baseline
// path, and T018 adds per-call/per-point bounds (deadline, state bytes, cost,
// per-point call cap), single-flight, an in-run cache, and deterministic-baseline
// agreement. All mutable state lives in the adapter closure (one instance = one
// run); there is no module-level mutable state.

import { createHash } from "node:crypto";
import { getDecisionPoint } from "./points.mjs";

export const DECISION_ADAPTER_MODES = Object.freeze(["off", "shadow", "live"]);
export const DECISION_BASELINE_SOURCE = "deterministic-baseline";
export const DECISION_ADAPTER_SOURCE = "decision-adapter";
export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DECISION_MODE_ENV = "CSM_DECISION_MODE";
export const DECISION_KILL_ENV = "CSM_DECISION_KILL";

// T018 budget defaults (published to operators by T020). The adapter deadline
// sits above the transport's own timeout so a cooperative transport reports its
// own `timeout` first, while a transport that ignores AbortSignal is still
// bounded. `maxCost` is USD and only enforced when a result carries
// `usage.cost`; `maxCallsPerPoint` bounds loop behavior per point per run.
export const DEFAULT_DECISION_DEADLINE_MS = 30_000;
export const DEFAULT_DECISION_MAX_STATE_BYTES = 262_144;
export const DEFAULT_DECISION_MAX_COST = 1;
export const DEFAULT_MAX_CALLS_PER_POINT = 32;

// T020: the published, operator-facing defaults. One frozen surface so the
// documented cap values and the values `createDecisionAdapter` actually applies
// cannot drift apart. Every field is the same named constant the adapter uses.
//   - deadlineMs: per-call wall-clock ceiling for one provider call (this sits
//     above the transport's own timeout; a non-cooperative transport still
//     cannot hang a run).
//   - maxStateBytes: serialized-state ceiling; an oversized state fails open
//     without a provider call.
//   - maxCost: USD ceiling per call; `null` disables the cost check. Only
//     enforced when a provider actually reports `usage.cost`.
//   - maxCallsPerPoint: per-point transport-call ceiling for one run.
export const DECISION_ADAPTER_DEFAULTS = Object.freeze({
  deadlineMs: DEFAULT_DECISION_DEADLINE_MS,
  maxStateBytes: DEFAULT_DECISION_MAX_STATE_BYTES,
  maxCost: DEFAULT_DECISION_MAX_COST,
  maxCallsPerPoint: DEFAULT_MAX_CALLS_PER_POINT,
});

// The shared failure taxonomy the adapter recognizes. An out-of-vocabulary
// class is still fail-open (treated as "unmapped"); this list bounds the
// vocabulary, it does not gate the revert.
export const DECISION_FAILURE_CLASSES = Object.freeze([
  "authentication",
  "payment_required",
  "permission_denied",
  "not_found",
  "payload_too_large",
  "rate_limit_exceeded",
  "server",
  "provider_unavailable",
  "provider_overloaded",
  "timeout",
  "unmapped",
]);

export function isDecisionMode(mode) {
  return DECISION_ADAPTER_MODES.includes(mode);
}

export function isDecisionFailureClass(className) {
  return DECISION_FAILURE_CLASSES.includes(className);
}

function stateDigestOf(state) {
  if (state === null || state === undefined) return null;
  let encoded;
  try {
    encoded = JSON.stringify(state);
  } catch {
    return null;
  }
  if (encoded === undefined) return null;
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

// The deterministic harness result for a point. This is the value an absent
// adapter yields, so off/shadow-without-transport are byte-identical to "no
// adapter". Every fail-open path returns exactly this object.
export function deterministicDecision(pointId, state = null) {
  let point = null;
  try {
    point = getDecisionPoint(pointId);
  } catch {
    point = null;
  }
  return Object.freeze({
    pointId: point ? point.id : pointId,
    seam: point ? point.seam : null,
    type: point ? point.type : null,
    fallback: point ? point.fallback : "unknown-point",
    stateDigest: stateDigestOf(state),
    answer: null,
    applied: false,
    routingBand: point ? "advisory" : "hold",
    source: DECISION_BASELINE_SOURCE,
  });
}

// Alias documenting the "no adapter" baseline explicitly for callers/tests.
export const noAdapterDecision = deterministicDecision;

function lookupPoint(pointId) {
  try {
    return getDecisionPoint(pointId);
  } catch {
    return null;
  }
}

function killSwitchEngaged(env) {
  return env?.[DECISION_KILL_ENV] === "1";
}

// The env mode var is a kill switch, not an escalation channel: only `off` is
// honored, so a stray `CSM_DECISION_MODE=live` can never enable the layer.
function envForcesOff(env) {
  const raw = env?.[DECISION_MODE_ENV];
  return typeof raw === "string" && raw.trim() === "off";
}

// Only the registry's non-safety "apply" points are eligible to change
// behavior. Every safety/authority or advisory point stays observational, so
// acceptance, security, and completion surfaces keep the deterministic model.
function mayApply(point) {
  return point.safetyClass === "non-safety" && point.applyVsAdvisory === "apply";
}

function transportInput(pointId, state, point) {
  return {
    pointId,
    state,
    questions: [pointId],
    point: Object.freeze({
      id: point.id,
      seam: point.seam,
      type: point.type,
      criteria: point.criteria,
      fallback: point.fallback,
      safetyClass: point.safetyClass,
      applyVsAdvisory: point.applyVsAdvisory,
    }),
  };
}

function failureClassOf(result) {
  const className = result?.failure?.class;
  return typeof className === "string" && className.length > 0 ? className : "unmapped";
}

function classifyThrown(error) {
  const declared = error?.failure;
  if (declared !== null && typeof declared === "object" && typeof declared.class === "string")
    return { class: declared.class, retryable: Boolean(declared.retryable) };
  return { class: "unmapped", retryable: true };
}

// ---------------------------------------------------------------------------
// T018 bounds helpers
// ---------------------------------------------------------------------------

// Sentinel resolved by the adapter deadline; distinct from any transport value.
const DEADLINE = Symbol("decision-adapter-deadline");

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function nonNegativeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// The serialized size of the state, or null when it cannot be measured. An
// unmeasurable state is never treated as a breach (fail-open toward consulting).
function stateByteSize(state) {
  try {
    const encoded = JSON.stringify(state);
    if (typeof encoded !== "string") return null;
    return Buffer.byteLength(encoded, "utf8");
  } catch {
    return null;
  }
}

// A canonical, provider-agnostic key for an answer so a Jev answer can be
// compared against a caller-declared deterministic baseline. Strings normalize
// to a `choice`, matching the {type:"choice", choice} record form.
function answerKeyOf(answer) {
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

function baselineAnswerOf(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return undefined;
  for (const key of ["baselineAnswer", "deterministicAnswer"])
    if (Object.hasOwn(state, key) && state[key] !== null && state[key] !== undefined)
      return state[key];
  return undefined;
}

function answersAgree(left, right) {
  const leftKey = answerKeyOf(left);
  const rightKey = answerKeyOf(right);
  return leftKey !== null && leftKey === rightKey;
}

// A cooperative timeout uses the transport's own AbortSignal; this outer race
// additionally bounds a transport that ignores its signal and never settles.
function withDeadline(promise, deadlineMs) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), deadlineMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createDecisionAdapter({
  mode = "off",
  transport = null,
  points = [],
  env = process.env,
  circuitThreshold = DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  runId = null,
  deadlineMs = DEFAULT_DECISION_DEADLINE_MS,
  maxStateBytes = DEFAULT_DECISION_MAX_STATE_BYTES,
  maxCost = DEFAULT_DECISION_MAX_COST,
  maxCallsPerPoint = DEFAULT_MAX_CALLS_PER_POINT,
} = {}) {
  if (!isDecisionMode(mode))
    throw new TypeError(
      `unsupported decision mode: ${String(mode)} (expected ${DECISION_ADAPTER_MODES.join(", ")})`,
    );

  // Switches force the off/baseline path regardless of the requested mode. The
  // requested mode is still validated first, so an unsupported value is refused
  // rather than silently masked.
  const killed = killSwitchEngaged(env) || envForcesOff(env);
  const effectiveMode = killed ? "off" : mode;

  const pointAllowlist = Object.freeze(
    Array.isArray(points)
      ? points.filter((point) => typeof point === "string" && point.length > 0)
      : [],
  );
  const threshold = positiveInteger(circuitThreshold, DEFAULT_CIRCUIT_FAILURE_THRESHOLD);
  const boundDeadlineMs = nonNegativeNumber(deadlineMs, DEFAULT_DECISION_DEADLINE_MS);
  const boundMaxStateBytes = positiveInteger(maxStateBytes, DEFAULT_DECISION_MAX_STATE_BYTES);
  const boundMaxCost =
    maxCost === null ? null : nonNegativeNumber(maxCost, DEFAULT_DECISION_MAX_COST);
  const boundMaxCalls = positiveInteger(maxCallsPerPoint, DEFAULT_MAX_CALLS_PER_POINT);
  // A run scope is required to retain results across calls; without one the
  // adapter still single-flights concurrent duplicates but never caches.
  const scopedRunId = typeof runId === "string" && runId.length > 0 ? runId : null;

  const transportResolved =
    transport !== null && typeof transport === "object" && typeof transport.send === "function";
  const providerId =
    transportResolved && typeof transport.providerId === "string" ? transport.providerId : null;
  // F1: the descriptor's real model, carried through from the transport so advice
  // (and the artifact writer) never fabricates an "unspecified" model.
  const providerModel =
    transportResolved &&
    typeof transport.providerModel === "string" &&
    transport.providerModel.length > 0
      ? transport.providerModel
      : null;

  // Run-scoped state: one adapter instance is one run.
  let consecutiveFailures = 0;
  let circuitOpen = false;
  let consulted = 0;
  let succeeded = 0;
  let applied = 0;
  let cacheHits = 0;
  const failures = [];
  const decisions = [];
  const callsByPoint = new Map();
  const pendingCalls = new Map();

  function pointEnabled(pointId) {
    return pointAllowlist.length === 0 || pointAllowlist.includes(pointId);
  }

  function active() {
    if (effectiveMode === "off") return false;
    if (!transportResolved) return false;
    return !circuitOpen;
  }

  function recordFailure(pointId, failure) {
    failures.push(
      Object.freeze({ pointId, class: failure.class, retryable: Boolean(failure.retryable) }),
    );
    consecutiveFailures += 1;
    if (consecutiveFailures >= threshold) circuitOpen = true;
  }

  function callCapReached(pointId) {
    return (callsByPoint.get(pointId) ?? 0) >= boundMaxCalls;
  }

  // T020: provider identity, normalized usage, and the measured call latency are
  // attached to every piece of advice so a downstream artifact record can carry
  // telemetry without re-deriving it. A provider that reports no usage still
  // yields `{}` here; a missing cost is never invented.
  function adviceOf(decision, latencyMs = null) {
    const source = decision !== null && typeof decision === "object" ? decision : {};
    return Object.freeze({
      answer: source.answer ?? null,
      confidence: Number.isFinite(source.confidence) ? source.confidence : null,
      usage: source.usage !== null && typeof source.usage === "object" ? source.usage : {},
      providerId,
      providerModel,
      latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : null,
    });
  }

  // F2: retain an observational copy of every consulted decision so the driver
  // can persist one redacted run artifact. The copy is frozen and is never a
  // channel back into the run: records only report what the adapter already did.
  function remember(pointId, digest, advice, detail) {
    decisions.push(
      Object.freeze({
        pointId,
        stateDigest: digest,
        answer: advice.answer,
        confidence: advice.confidence,
        usage: advice.usage,
        provider: Object.freeze({ id: advice.providerId, model: advice.providerModel }),
        latencyMs: advice.latencyMs,
        applied: detail.applied === true,
        routingBand: detail.routingBand,
        ...(detail.baselineAgreement === undefined
          ? {}
          : { baselineAgreement: detail.baselineAgreement }),
      }),
    );
    return detail;
  }

  // Single-flight + in-run cache. The tracked promise is stored synchronously so
  // concurrent identical requests share one transport call; a successful result
  // is retained only when the adapter has a declared runId, so a later identical
  // request is served without a second call. Failures are never retained (the
  // circuit breaker must still observe each attempt).
  function startConsult(key, pointId, state, point) {
    if (key !== null && pendingCalls.has(key)) {
      cacheHits += 1;
      return pendingCalls.get(key);
    }

    callsByPoint.set(pointId, (callsByPoint.get(pointId) ?? 0) + 1);
    consulted += 1;

    const startedAt = Date.now();
    const settle = async () => {
      let result;
      try {
        result = await withDeadline(
          transport.send(transportInput(pointId, state, point)),
          boundDeadlineMs,
        );
      } catch (error) {
        return { status: "failure", failure: classifyThrown(error) };
      }
      if (result === DEADLINE)
        return { status: "failure", failure: { class: "timeout", retryable: true } };
      if (result === null || typeof result !== "object" || result.ok !== true)
        return {
          status: "failure",
          failure: {
            class: failureClassOf(result),
            retryable: Boolean(result?.failure?.retryable),
          },
        };
      const cost = result?.decision?.usage?.cost;
      if (boundMaxCost !== null && Number.isFinite(cost) && cost > boundMaxCost)
        return { status: "failure", failure: { class: "unmapped", retryable: false } };
      return { status: "ok", result, latencyMs: Math.max(0, Date.now() - startedAt) };
    };

    const tracked = settle().then((outcome) => {
      if (outcome.status === "ok") {
        consecutiveFailures = 0;
        succeeded += 1;
        if (key !== null && scopedRunId !== null) pendingCalls.set(key, Promise.resolve(outcome));
        else if (key !== null) pendingCalls.delete(key);
      } else {
        recordFailure(pointId, outcome.failure);
        if (key !== null) pendingCalls.delete(key);
      }
      return outcome;
    });

    if (key !== null) pendingCalls.set(key, tracked);
    return tracked;
  }

  // The fail-open boundary. Any thrown transport error, rejection, `{ok:false}`
  // result, deadline, state-size breach, cost breach, or baseline disagreement
  // returns the untouched baseline.
  async function consult(pointId, state, baseline, point, apply) {
    if (callCapReached(pointId)) return baseline;

    const size = stateByteSize(state);
    if (size !== null && size > boundMaxStateBytes) {
      recordFailure(pointId, { class: "payload_too_large", retryable: false });
      return baseline;
    }

    const digest = stateDigestOf(state);
    const key = digest === null ? null : `${scopedRunId ?? ""}\u0000${pointId}\u0000${digest}`;
    const outcome = await startConsult(key, pointId, state, point);
    if (outcome.status !== "ok") return baseline;

    const advice = adviceOf(outcome.result.decision, outcome.latencyMs);
    const canApply =
      apply && mayApply(point) && advice.answer !== null && advice.answer !== undefined;
    if (!canApply) {
      remember(pointId, digest, advice, { applied: false, routingBand: baseline.routingBand });
      return Object.freeze({ ...baseline, consulted: true, advice, failure: null, applied: false });
    }

    const baselineAnswer = baselineAnswerOf(state);
    if (baselineAnswer !== undefined && !answersAgree(advice.answer, baselineAnswer)) {
      remember(pointId, digest, advice, {
        applied: false,
        routingBand: baseline.routingBand,
        baselineAgreement: false,
      });
      return Object.freeze({
        ...baseline,
        consulted: true,
        advice,
        failure: null,
        applied: false,
        baselineAgreement: false,
      });
    }

    applied += 1;
    remember(pointId, digest, advice, {
      applied: true,
      routingBand: "apply",
      ...(baselineAnswer === undefined ? {} : { baselineAgreement: true }),
    });
    return Object.freeze({
      ...baseline,
      answer: advice.answer,
      consulted: true,
      advice,
      failure: null,
      applied: true,
      routingBand: "apply",
      source: DECISION_ADAPTER_SOURCE,
      ...(baselineAnswer === undefined ? {} : { baselineAgreement: true }),
    });
  }

  // Returns the point when the transport should be consulted, else null (which
  // makes the caller return the exact synchronous baseline).
  function prepared(pointId) {
    if (!active()) return null;
    const point = lookupPoint(pointId);
    if (point === null) return null;
    if (!pointEnabled(point.id)) return null;
    return point;
  }

  function decide(pointId, state = null) {
    const baseline = deterministicDecision(pointId, state);
    const point = prepared(pointId);
    if (point === null) return baseline;
    return consult(pointId, state, baseline, point, effectiveMode === "live");
  }

  function shadow(pointId, state = null) {
    const baseline = deterministicDecision(pointId, state);
    const point = prepared(pointId);
    if (point === null) return baseline;
    return consult(pointId, state, baseline, point, false);
  }

  function stats() {
    return Object.freeze({
      mode: effectiveMode,
      requestedMode: mode,
      killSwitch: killed,
      providerId,
      transportResolved,
      threshold,
      consecutiveFailures,
      circuitOpen,
      consulted,
      succeeded,
      applied,
      cacheHits,
      records: decisions.length,
      deadlineMs: boundDeadlineMs,
      maxStateBytes: boundMaxStateBytes,
      maxCost: boundMaxCost,
      maxCallsPerPoint: boundMaxCalls,
      callsByPoint: Object.freeze(Object.fromEntries(callsByPoint)),
      failures: Object.freeze([...failures]),
    });
  }

  return Object.freeze({
    mode: effectiveMode,
    requestedMode: mode,
    applying: effectiveMode === "live" && transportResolved,
    shadowing: effectiveMode === "shadow",
    transportResolved,
    points: pointAllowlist,
    decide,
    shadow,
    stats,
    records: () => Object.freeze([...decisions]),
  });
}

export default {
  createDecisionAdapter,
  deterministicDecision,
  noAdapterDecision,
  isDecisionMode,
  isDecisionFailureClass,
  DECISION_ADAPTER_DEFAULTS,
};
