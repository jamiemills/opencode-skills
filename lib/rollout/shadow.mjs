"use strict";

import { performance } from "node:perf_hooks";
import { canonicalize } from "../schema-runtime/index.mjs";
import { RolloutError, cloneData, deepFreeze, isFiniteNumber, isPlainObject } from "./internal.mjs";

export const SHADOW_RUN_FORMAT = "csm-shadow-run/1";
export const SCENARIO_KEYS = Object.freeze(["scenarioId", "input", "execute"]);

export class ShadowRunnerError extends RolloutError {}

function resourceDeltas(control, candidate) {
  const delta = {};
  const keys = new Set([...Object.keys(control), ...Object.keys(candidate)]);
  for (const key of keys) delta[key] = (candidate[key] ?? 0) - (control[key] ?? 0);
  return delta;
}

export function createShadowRunner(options = {}) {
  if (options !== null && !isPlainObject(options))
    throw new ShadowRunnerError("invalid-options", "shadow runner options must be a plain object");
  const now = options.now ?? (() => new Date().toISOString());
  const clock = options.clock ?? (() => performance.now());
  let runSequence = 0;
  let effectSequence = 0;

  function validateScenario(scenario) {
    if (!isPlainObject(scenario))
      throw new ShadowRunnerError("invalid-scenario", "scenario must be a plain object");
    for (const key of Object.keys(scenario))
      if (!SCENARIO_KEYS.includes(key))
        throw new ShadowRunnerError(
          "invalid-scenario",
          `scenario key '${key}' is unknown (allowed: ${SCENARIO_KEYS.join(", ")})`,
        );
    if (typeof scenario.execute !== "function")
      throw new ShadowRunnerError("invalid-scenario", "scenario.execute must be a function");
    if (!("input" in scenario))
      throw new ShadowRunnerError("invalid-scenario", "scenario.input is required");
    if (scenario.scenarioId !== undefined && typeof scenario.scenarioId !== "string")
      throw new ShadowRunnerError("invalid-scenario", "scenario.scenarioId must be a string");
  }

  async function runSide(side, config, scenario) {
    const input = cloneData(scenario.input);
    const inputSnapshot = canonicalize(input);
    const effects = [];
    const toolkit = Object.freeze({
      scenarioId: scenario.scenarioId ?? null,
      side,
      mode: "shadow",
      effects: Object.freeze({
        record(kind, payload) {
          effectSequence += 1;
          const effect = deepFreeze({
            effectId: `shadow-effect-${effectSequence}`,
            side,
            kind: typeof kind === "string" ? kind : "unknown",
            payload: cloneData(payload ?? null),
            applied: false,
            recorded: true,
            recordedAt: now(),
          });
          effects.push(effect);
          return { applied: false, recorded: true, effectId: effect.effectId };
        },
      }),
    });
    const startedAt = now();
    let outcome = null;
    let error = null;
    let resources = {};
    const start = clock();
    try {
      const result = await scenario.execute(config, input, toolkit);
      if (isPlainObject(result) && ("outcome" in result || "resources" in result)) {
        if (result.resources !== undefined) {
          if (!isPlainObject(result.resources))
            throw new ShadowRunnerError(
              "invalid-resources",
              "scenario resources must be a plain object",
            );
          for (const [key, value] of Object.entries(result.resources))
            if (!isFiniteNumber(value))
              throw new ShadowRunnerError(
                "invalid-resources",
                `scenario resources key '${key}' must be a finite number`,
              );
          resources = cloneData(result.resources);
        }
        outcome = cloneData(result.outcome ?? null);
      } else {
        outcome = cloneData(result ?? null);
      }
    } catch (cause) {
      outcome = null;
      resources = {};
      error = deepFreeze({
        name: cause?.name ?? "Error",
        message: cause?.message ?? String(cause),
        code: cause?.code ?? null,
      });
    }
    const latencyMs = clock() - start;
    return {
      side,
      outcome,
      error,
      resources,
      latencyMs,
      startedAt,
      inputMutated: canonicalize(input) !== inputSnapshot,
      effects: Object.freeze(effects),
    };
  }

  async function run(candidateConfig, controlConfig, scenario) {
    validateScenario(scenario);
    runSequence += 1;
    const scenarioId = scenario.scenarioId ?? `shadow-run-${runSequence}`;
    const control = await runSide("control", controlConfig, scenario);
    const candidate = await runSide("candidate", candidateConfig, scenario);
    const comparison = deepFreeze({
      outcomeMatch:
        control.error === null &&
        candidate.error === null &&
        canonicalize(control.outcome) === canonicalize(candidate.outcome),
      latencyDeltaMs: candidate.latencyMs - control.latencyMs,
      latencyRatio: control.latencyMs > 0 ? candidate.latencyMs / control.latencyMs : null,
      resourceDelta: resourceDeltas(control.resources, candidate.resources),
    });
    return deepFreeze({
      format: SHADOW_RUN_FORMAT,
      runId: `shadow-run-${runSequence}`,
      scenarioId,
      mode: "shadow",
      ranAt: now(),
      control,
      candidate,
      comparison,
      appliedEffects: Object.freeze([]),
    });
  }

  function assertZeroSideEffects(runResult) {
    if (
      !isPlainObject(runResult) ||
      runResult.mode !== "shadow" ||
      !Array.isArray(runResult.appliedEffects) ||
      !isPlainObject(runResult.control) ||
      !isPlainObject(runResult.candidate) ||
      !Array.isArray(runResult.control.effects) ||
      !Array.isArray(runResult.candidate.effects)
    )
      throw new ShadowRunnerError(
        "invalid-run-result",
        "assertZeroSideEffects requires a shadow run result produced by createShadowRunner",
      );
    const violations = [];
    if (runResult.appliedEffects.length > 0)
      violations.push({
        rule: "applied-effects",
        observed: runResult.appliedEffects.length,
        threshold: 0,
      });
    for (const side of ["control", "candidate"]) {
      const sideResult = runResult[side];
      if (sideResult.inputMutated === true)
        violations.push({ rule: `${side}-input-mutated`, observed: true, threshold: false });
      for (const effect of sideResult.effects)
        if (effect.applied !== false || effect.recorded !== true)
          violations.push({
            rule: `${side}-effect-applied`,
            observed: effect.effectId,
            threshold: "recorded-only",
          });
    }
    if (violations.length > 0)
      throw new ShadowRunnerError(
        "shadow-side-effect",
        "shadow run produced external side effects",
        {
          violations,
        },
      );
    const recordedEffectCount =
      runResult.control.effects.length + runResult.candidate.effects.length;
    return { verified: true, recordedEffectCount, appliedEffectCount: 0 };
  }

  return Object.freeze({ run, assertZeroSideEffects });
}
