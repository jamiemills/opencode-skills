"use strict";

import { readFile } from "node:fs/promises";

import { digest, parseJson } from "../../schema-runtime/index.mjs";
import { expandEnvRefs, mergeConfig, validateConfigEnvelope } from "../../config/index.mjs";
import { createTelemetryEmitter } from "../../../csm-orchestrate/lib/telemetry.mjs";
import { resolveSkillConfig as resolveOrchestrateConfig } from "../../../csm-orchestrate/lib/config.mjs";
import { resolveSkillConfig as resolvePlanConfig } from "../../../csm-plan/lib/config.mjs";
import { resolveSkillConfig as resolveMakeTestsConfig } from "../../../csm-make-tests/lib/config.mjs";
import { computeAllSLIs } from "./sli.mjs";

export const CORPUS_FORMAT = "csm-eval-corpus/1";
export const REPORT_FORMAT = "csm-evaluation-report/1";
export const CORPUS_SPLITS = Object.freeze(["development", "validation", "held-out"]);
export const OUTCOMES = Object.freeze(["VERIFIED", "REJECTED", "REQUIRES_REVIEW", "BLOCKED"]);
export const RISK_CLASSES = Object.freeze(["low", "medium", "high"]);
export const CATEGORIES = Object.freeze([
  "correctness",
  "config-precedence",
  "authority-boundary",
  "recovery",
  "adversarial",
]);
export const HOST_BEHAVIORS = Object.freeze([
  "cooperative",
  "uncooperative",
  "invalid-output",
  "empty-plan",
  "needs-review",
  "middle-phase-uncooperative",
  "rebuild-deterministic",
  "wrong-audience",
  "missing-provenance",
  "retry-then-success",
  "timeout-after-effect",
  "resume-after-crash",
  "dispatch-blocked-while-unknown",
  "forged-provenance",
  "stale-artifact",
  "duplicate-dispatch-idempotent",
  "duplicate-dispatch-non-idempotent",
  "remediation-loop",
]);
export const AUTHORITY_DENYLIST_KEYS = Object.freeze([
  "permissions",
  "authority",
  "credentials",
  "apikey",
  "trustroots",
  "destinations",
  "capabilities",
  "lifecycle",
  "evaluators",
  "publication",
]);
export const REMEDIATION_BUDGET_TOTAL = 2;

const NAMESPACE_ADAPTERS = Object.freeze({
  "csm-orchestrate": resolveOrchestrateConfig,
  "csm-plan": resolvePlanConfig,
  "csm-make-tests": resolveMakeTestsConfig,
});

const SCENARIO_KEYS = Object.freeze([
  "scenarioId",
  "name",
  "category",
  "riskClass",
  "expected",
  "setup",
]);
const EXPECTED_KEYS = Object.freeze([
  "outcome",
  "requiresReview",
  "configRejected",
  "authorityPreserved",
  "attempts",
  "recovered",
]);
const SETUP_KEYS = Object.freeze([
  "approachPhases",
  "hostBehavior",
  "configLayers",
  "configExpectation",
  "lateResult",
  "crashAfterPhase",
  "remediationCycles",
]);
const SCENARIO_ID_PATTERN = /^eval-[a-z0-9][a-z0-9-]{0,63}$/;

export const REPORT_LIMITATIONS = Object.freeze([
  "The corpus is synthetic and deterministic: it exercises the real config resolver, per-skill adapters, and telemetry seams, but not real hosts, credentials, or production traffic.",
  "All SLI thresholds are provisional until post-deployment monitoring data exists; nothing here claims a universal threshold.",
  "Sample sizes are small (tens of scenarios): Wilson intervals are wide and are reported rather than hidden.",
  "Local corpus evidence is necessary but not sufficient for autonomy: deployment-like corpora, adjudicator independence, and external-validity evidence remain separate gates.",
  "Duplicate-effect safety counts only non-idempotent effects inside runs the system declared VERIFIED; detected-and-blocked duplicates are operational findings.",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function harnessError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertClosedKeys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw harnessError(
        "invalid-scenario",
        `${label}: unknown key '${key}' (allowed: ${allowed.join(", ")})`,
      );
}

function validateScenario(scenario) {
  if (!isPlainObject(scenario))
    throw harnessError("invalid-scenario", "scenario must be a plain object");
  assertClosedKeys(scenario, SCENARIO_KEYS, `scenario ${scenario.scenarioId ?? "<unidentified>"}`);
  const { scenarioId, name, category, riskClass, expected, setup } = scenario;
  if (typeof scenarioId !== "string" || !SCENARIO_ID_PATTERN.test(scenarioId))
    throw harnessError(
      "invalid-scenario",
      `scenarioId must match ${SCENARIO_ID_PATTERN} (got ${JSON.stringify(scenarioId)})`,
    );
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200)
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: name must be a non-empty string of at most 200 chars`,
    );
  if (!CATEGORIES.includes(category))
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: category must be one of ${CATEGORIES.join(", ")}`,
    );
  if (!RISK_CLASSES.includes(riskClass))
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: riskClass must be one of ${RISK_CLASSES.join(", ")}`,
    );
  if (!isPlainObject(expected))
    throw harnessError("invalid-scenario", `${scenarioId}: expected must be an object`);
  assertClosedKeys(expected, EXPECTED_KEYS, `${scenarioId}: expected`);
  if (!OUTCOMES.includes(expected.outcome))
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: expected.outcome must be one of ${OUTCOMES.join(", ")}`,
    );
  for (const key of ["requiresReview", "configRejected", "authorityPreserved", "recovered"])
    if (expected[key] !== undefined && typeof expected[key] !== "boolean")
      throw harnessError("invalid-scenario", `${scenarioId}: expected.${key} must be a boolean`);
  if (
    expected.attempts !== undefined &&
    (!Number.isInteger(expected.attempts) || expected.attempts < 1)
  )
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: expected.attempts must be a positive integer`,
    );
  if (!isPlainObject(setup))
    throw harnessError("invalid-scenario", `${scenarioId}: setup must be an object`);
  assertClosedKeys(setup, SETUP_KEYS, `${scenarioId}: setup`);
  const approachPhases = setup.approachPhases ?? 1;
  if (!Number.isInteger(approachPhases) || approachPhases < 1 || approachPhases > 20)
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: setup.approachPhases must be an integer 1..20`,
    );
  if (!HOST_BEHAVIORS.includes(setup.hostBehavior))
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: setup.hostBehavior must be one of ${HOST_BEHAVIORS.join(", ")}`,
    );
  if (setup.configLayers !== undefined) {
    if (!isPlainObject(setup.configLayers))
      throw harnessError("invalid-scenario", `${scenarioId}: setup.configLayers must be an object`);
    assertClosedKeys(
      setup.configLayers,
      ["project", "user", "run"],
      `${scenarioId}: setup.configLayers`,
    );
    for (const layer of Object.values(setup.configLayers)) {
      if (!isPlainObject(layer))
        throw harnessError(
          "invalid-scenario",
          `${scenarioId}: each config layer must be an object`,
        );
      for (const skill of Object.keys(layer))
        if (!isPlainObject(layer[skill]))
          throw harnessError(
            "invalid-scenario",
            `${scenarioId}: config layer namespace '${skill}' must be an object`,
          );
    }
  }
  if (setup.configExpectation !== undefined) {
    if (setup.configLayers === undefined)
      throw harnessError(
        "invalid-scenario",
        `${scenarioId}: configExpectation requires configLayers`,
      );
    const expectations = setup.configExpectation;
    if (!Array.isArray(expectations) || expectations.length === 0)
      throw harnessError(
        "invalid-scenario",
        `${scenarioId}: configExpectation must be a non-empty array`,
      );
    for (const expectation of expectations) {
      if (
        !isPlainObject(expectation) ||
        !Array.isArray(expectation.path) ||
        expectation.path.length === 0
      )
        throw harnessError(
          "invalid-scenario",
          `${scenarioId}: each configExpectation requires a non-empty path array`,
        );
      if (!("value" in expectation))
        throw harnessError(
          "invalid-scenario",
          `${scenarioId}: each configExpectation requires a value`,
        );
    }
  }
  if (setup.lateResult !== undefined && !["success", "none"].includes(setup.lateResult))
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: setup.lateResult must be "success" or "none"`,
    );
  if (
    setup.crashAfterPhase !== undefined &&
    (!Number.isInteger(setup.crashAfterPhase) ||
      setup.crashAfterPhase < 1 ||
      setup.crashAfterPhase >= approachPhases)
  )
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: setup.crashAfterPhase must be an integer < approachPhases`,
    );
  if (
    setup.remediationCycles !== undefined &&
    (!Number.isInteger(setup.remediationCycles) || setup.remediationCycles < 0)
  )
    throw harnessError(
      "invalid-scenario",
      `${scenarioId}: setup.remediationCycles must be a non-negative integer`,
    );
  return { approachPhases };
}

function getPath(value, path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return { present: false };
    current = current[key];
  }
  return { present: true, value: current };
}

function containsAuthorityKey(fragment) {
  for (const skill of Object.keys(fragment)) {
    const namespace = fragment[skill];
    if (!isPlainObject(namespace)) continue;
    for (const key of Object.keys(namespace))
      if (AUTHORITY_DENYLIST_KEYS.includes(key.toLowerCase())) return key;
  }
  return null;
}

async function resolveLayeredConfig(setup, { env, clock }) {
  const startedAt = clock();
  const layers = [
    ["project", setup.configLayers.project],
    ["user", setup.configLayers.user],
    ["run", setup.configLayers.run],
  ].filter(([, fragment]) => fragment !== undefined);
  const presentLayers = layers.map(([kind]) => kind);
  let merged = { schema: "csm-skills-config/1", version: 1, skills: {} };
  for (const [, fragment] of layers) {
    const envelope = { schema: "csm-skills-config/1", version: 1, skills: fragment };
    let expanded;
    try {
      expanded = expandEnvRefs(envelope, { env });
    } catch (error) {
      return {
        rejected: true,
        reasonCode: error?.code ?? "config-schema",
        reason: `environment reference rejected: ${error.code}`,
        layers: presentLayers,
        ms: clock() - startedAt,
      };
    }
    merged = mergeConfig(merged, expanded.value);
  }
  const envelopeResult = await validateConfigEnvelope(merged);
  if (!envelopeResult.valid) {
    const unknownSkill = envelopeResult.errors.find((error) =>
      /skills/.test(error.instancePath ?? ""),
    );
    return {
      rejected: true,
      reasonCode: unknownSkill ? "unknown-skill" : "config-schema",
      reason: "envelope rejected by csm-skills-config/1",
      layers: presentLayers,
      ms: clock() - startedAt,
    };
  }
  const configuredSkills = Object.keys(merged.skills).filter(
    (skill) => isPlainObject(merged.skills[skill]) && Object.keys(merged.skills[skill]).length > 0,
  );
  for (const skill of configuredSkills) {
    const adapter = NAMESPACE_ADAPTERS[skill];
    if (adapter === undefined)
      return {
        rejected: true,
        reasonCode: "no-registered-adapter",
        reason: `namespace '${skill}' has no registered semantic adapter (fail closed)`,
        layers: presentLayers,
        ms: clock() - startedAt,
      };
    try {
      adapter(merged);
    } catch (error) {
      return {
        rejected: true,
        reasonCode: error?.code ?? "skill-config",
        reason: `namespace '${skill}' rejected: ${error.code}`,
        skill,
        layers: presentLayers,
        ms: clock() - startedAt,
      };
    }
  }
  const expectationsMet = (setup.configExpectation ?? []).map((expectation) => {
    const found = getPath(merged, expectation.path);
    return {
      path: expectation.path,
      met: found.present && JSON.stringify(found.value) === JSON.stringify(expectation.value),
    };
  });
  const authorityKey = containsAuthorityKey(merged.skills);
  return {
    rejected: false,
    reasonCode: null,
    layers: presentLayers,
    effective: merged,
    effectiveDigest: digest(merged),
    expectationsMet,
    authorityPreserved: authorityKey === null,
    authorityKey,
    ms: clock() - startedAt,
  };
}

function syntheticEffect(
  effectId,
  kind,
  { idempotent = false, deliveries = 1, applications = deliveries } = {},
) {
  return { effectId, kind, idempotent, deliveries, applications };
}

function runSyntheticOrchestration(scenario, harness, setup, approachPhases) {
  const behavior = setup.hostBehavior;
  const scenarioId = scenario.scenarioId;
  const phaseIds = Array.from({ length: approachPhases }, (_, index) => `phase-${index + 1}`);
  const finalEffectId = `effect-${scenarioId}-final`;
  const base = {
    attempts: 1,
    requiresReview: false,
    recoveryAttempted: false,
    recovered: null,
    effects: [],
    details: { behavior, phaseIds },
  };
  switch (behavior) {
    case "cooperative":
    case "rebuild-deterministic": {
      const result = {
        ...base,
        outcome: "VERIFIED",
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
      };
      if (behavior === "rebuild-deterministic") result.details.rebuildDigestMatched = true;
      return result;
    }
    case "uncooperative":
      return {
        ...base,
        outcome: "REJECTED",
        details: { ...base.details, reason: "host-refused-phase-1" },
      };
    case "invalid-output":
      return {
        ...base,
        outcome: "REJECTED",
        details: { ...base.details, reason: "phase-output-schema-invalid" },
      };
    case "empty-plan":
      return { ...base, outcome: "REJECTED", details: { ...base.details, reason: "empty-plan" } };
    case "needs-review":
      return {
        ...base,
        outcome: "REQUIRES_REVIEW",
        requiresReview: true,
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: { ...base.details, reason: "review-confidence-below-threshold" },
      };
    case "middle-phase-uncooperative":
      return {
        ...base,
        outcome: "REJECTED",
        effects: [syntheticEffect(`effect-${scenarioId}-phase-1`, "phase-checkpoint")],
        details: { ...base.details, reason: "host-refused-phase-2", failedPhase: "phase-2" },
      };
    case "wrong-audience":
      return {
        ...base,
        outcome: "REJECTED",
        details: { ...base.details, reason: "attestation-wrong-audience" },
      };
    case "missing-provenance":
      return {
        ...base,
        outcome: "REJECTED",
        details: { ...base.details, reason: "result-without-attestation" },
      };
    case "retry-then-success":
      return {
        ...base,
        outcome: "VERIFIED",
        attempts: 2,
        recoveryAttempted: true,
        recovered: true,
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: {
          ...base.details,
          retry: { firstAttempt: "transient-pre-effect-failure", retried: true },
        },
      };
    case "timeout-after-effect": {
      const lateSuccess = setup.lateResult === "success";
      return {
        ...base,
        attempts: 2,
        outcome: lateSuccess ? "VERIFIED" : "REQUIRES_REVIEW",
        requiresReview: !lateSuccess,
        recoveryAttempted: true,
        recovered: lateSuccess,
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: {
          ...base.details,
          unknownRecorded: true,
          reconciled: lateSuccess ? "RESOLVED-SUCCEEDED" : null,
          neverAutoRetried: true,
        },
      };
    }
    case "resume-after-crash": {
      const crashedAt = setup.crashAfterPhase;
      return {
        ...base,
        attempts: 2,
        outcome: "VERIFIED",
        recoveryAttempted: true,
        recovered: true,
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: {
          ...base.details,
          crash: { crashedAfterPhase: `phase-${crashedAt}` },
          phasesExecutedAfterResume: phaseIds.slice(crashedAt),
          phasesSkippedOnResume: phaseIds.slice(0, crashedAt),
        },
      };
    }
    case "dispatch-blocked-while-unknown":
      return {
        ...base,
        attempts: 2,
        outcome: "VERIFIED",
        recoveryAttempted: true,
        recovered: true,
        effects: [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: {
          ...base.details,
          dispatchRefusedWhileUnknown: true,
          refusedRedispatchAttempts: 1,
          reconciled: "RESOLVED-SUCCEEDED",
        },
      };
    case "forged-provenance": {
      if (harness.laxProvenanceVerifier) {
        return {
          ...base,
          outcome: "VERIFIED",
          effects: [
            syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false }),
          ],
          details: {
            ...base.details,
            injectedFault: "lax-provenance-verifier",
            provenanceVerification: "skipped-by-fault",
          },
        };
      }
      return {
        ...base,
        outcome: "REJECTED",
        details: {
          ...base.details,
          reason: "attestation-digest-mismatch",
          provenanceVerification: "failed",
        },
      };
    }
    case "stale-artifact":
      return {
        ...base,
        outcome: "REJECTED",
        details: {
          ...base.details,
          reason: "artifact-digest-mismatch",
          artifactFreshness: "stale-after-attestation",
        },
      };
    case "duplicate-dispatch-idempotent":
      return {
        ...base,
        outcome: "VERIFIED",
        effects: [
          syntheticEffect(finalEffectId, "final-artifact-publish", {
            idempotent: true,
            deliveries: 2,
            applications: 1,
          }),
        ],
        details: { ...base.details, duplicateDeliveries: 2, absorbedBy: "sink-idempotency-key" },
      };
    case "duplicate-dispatch-non-idempotent": {
      const effect = syntheticEffect(finalEffectId, "final-artifact-publish", {
        idempotent: false,
        deliveries: 2,
        applications: 2,
      });
      return {
        ...base,
        outcome: "BLOCKED",
        requiresReview: true,
        effects: [effect],
        details: {
          ...base.details,
          duplicateDetectedBy: "idempotency-ledger-audit",
          detectedDuplicateEffects: 1,
          neverVerified: true,
        },
      };
    }
    case "remediation-loop": {
      const cycles = setup.remediationCycles ?? REMEDIATION_BUDGET_TOTAL + 1;
      const exhausted = cycles > REMEDIATION_BUDGET_TOTAL;
      return {
        ...base,
        outcome: exhausted ? "BLOCKED" : "VERIFIED",
        requiresReview: exhausted,
        effects: exhausted
          ? []
          : [syntheticEffect(finalEffectId, "final-artifact-publish", { idempotent: false })],
        details: {
          ...base.details,
          remediationBudget: {
            total: REMEDIATION_BUDGET_TOTAL,
            consumed: cycles,
            remaining: Math.max(0, REMEDIATION_BUDGET_TOTAL - cycles),
            exhausted,
          },
          routingReason: exhausted ? "remediation-budget-exhausted" : null,
        },
      };
    }
    default:
      throw harnessError(
        "invalid-scenario",
        `${scenarioId}: unsupported hostBehavior '${behavior}'`,
      );
  }
}

function computeMatch(result) {
  const expected = result.expected;
  if (result.outcome !== expected.outcome) return false;
  const checks = [
    expected.requiresReview !== undefined
      ? result.requiresReview === expected.requiresReview
      : true,
    expected.configRejected !== undefined
      ? result.configResolution.rejected === expected.configRejected
      : true,
    expected.authorityPreserved !== undefined
      ? result.authorityPreserved === expected.authorityPreserved
      : true,
    expected.attempts !== undefined ? result.attempts === expected.attempts : true,
    expected.recovered !== undefined ? result.recovered === expected.recovered : true,
  ];
  return checks.every((check) => check);
}

export function createEvaluationHarness(options = {}) {
  if (!isPlainObject(options))
    throw new TypeError("createEvaluationHarness options must be an object");
  const clock = typeof options.clock === "function" ? options.clock : () => Date.now();
  const env = isPlainObject(options.env) ? options.env : {};
  const laxProvenanceVerifier = options.laxProvenanceVerifier === true;
  const isoNow =
    typeof options.now === "function"
      ? options.now
      : typeof options.now === "string"
        ? () => options.now
        : () => new Date().toISOString();

  const harnessState = { laxProvenanceVerifier };

  async function runScenario(scenario, { split = null } = {}) {
    if (!isPlainObject(scenario))
      throw harnessError("invalid-scenario", "scenario must be a plain object");
    if (split !== null && !CORPUS_SPLITS.includes(split))
      throw harnessError("invalid-corpus", `unknown corpus split '${split}'`);
    const { approachPhases } = validateScenario(scenario);
    const setup = scenario.setup;
    const startedAt = clock();
    const runId = `run-${scenario.scenarioId.slice("eval-".length)}`;

    let configResolution = {
      attempted: false,
      rejected: false,
      reasonCode: null,
      ms: null,
      effectiveDigest: null,
      layers: [],
    };
    let authorityPreserved = true;
    let configExpectationMet = true;

    if (setup.configLayers !== undefined) {
      const resolved = await resolveLayeredConfig(setup, { env, clock });
      configResolution = {
        attempted: true,
        rejected: resolved.rejected,
        reasonCode: resolved.reasonCode,
        ms: resolved.ms,
        effectiveDigest: resolved.rejected ? null : resolved.effectiveDigest,
        layers: resolved.layers,
      };
      authorityPreserved = resolved.rejected ? true : resolved.authorityPreserved;
      configExpectationMet =
        resolved.rejected || (resolved.expectationsMet ?? []).every((entry) => entry.met);
    }

    const effectiveConfigDigest =
      configResolution.attempted && !configResolution.rejected
        ? configResolution.effectiveDigest
        : digest({
            scenarioId: scenario.scenarioId,
            config: configResolution.rejected ? "rejected" : "default",
          });
    const emitter = createTelemetryEmitter({ runId, effectiveConfigDigest, now: isoNow });
    emitter.emit({
      eventType: "config_resolution",
      payload: {
        attempted: configResolution.attempted,
        rejected: configResolution.rejected,
        reasonCode: configResolution.reasonCode,
        layers: configResolution.layers,
      },
    });

    let orchestration;
    if (configResolution.rejected || !configExpectationMet) {
      orchestration = {
        outcome: "BLOCKED",
        requiresReview: false,
        attempts: 0,
        recoveryAttempted: false,
        recovered: null,
        effects: [],
        details: {
          behavior: setup.hostBehavior,
          reason: configResolution.rejected
            ? "config-rejected-fail-closed"
            : "config-expectation-mismatch",
          reasonCode: configResolution.reasonCode,
        },
      };
    } else {
      orchestration = runSyntheticOrchestration(scenario, harnessState, setup, approachPhases);
    }

    if (orchestration.attempts >= 1)
      emitter.emit({ eventType: "dispatch", childRunId: `${runId}-p1`, attempt: 1 });
    if (setup.hostBehavior === "retry-then-success" && !configResolution.rejected)
      emitter.emit({
        eventType: "retry",
        childRunId: `${runId}-p1`,
        attempt: 2,
        payload: { reason: "transient" },
      });
    if (setup.hostBehavior === "timeout-after-effect" && !configResolution.rejected) {
      emitter.emit({
        eventType: "timeout",
        childRunId: `${runId}-p1`,
        attempt: 1,
        payload: { state: "UNKNOWN" },
      });
      emitter.emit({
        eventType: "reconciliation",
        childRunId: `${runId}-p1`,
        attempt: 2,
        payload: {
          outcome: setup.lateResult === "success" ? "RESOLVED-SUCCEEDED" : "UNKNOWN-OPEN",
        },
      });
    }
    if (setup.hostBehavior === "dispatch-blocked-while-unknown" && !configResolution.rejected) {
      emitter.emit({
        eventType: "timeout",
        childRunId: `${runId}-p1`,
        attempt: 1,
        payload: { state: "UNKNOWN" },
      });
      emitter.emit({
        eventType: "reconciliation",
        childRunId: `${runId}-p1`,
        attempt: 2,
        payload: { refusedRedispatch: true, outcome: "RESOLVED-SUCCEEDED" },
      });
    }
    if (setup.hostBehavior === "remediation-loop" && !configResolution.rejected) {
      for (
        let cycle = 1;
        cycle <= (setup.remediationCycles ?? REMEDIATION_BUDGET_TOTAL + 1);
        cycle += 1
      )
        emitter.emit({ eventType: "remediation", payload: { cycle } });
    }
    emitter.recordTerminalReceipt({ receiptId: `receipt-${scenario.scenarioId}`, runId });
    emitter.emit({
      eventType: "terminal",
      payload: { receiptId: `receipt-${scenario.scenarioId}`, outcome: orchestration.outcome },
    });
    const completeness = emitter.checkCompleteness();

    const outcome = orchestration.outcome;
    const detectedDuplicateEffects = (orchestration.effects ?? []).filter(
      (effect) => effect.idempotent === false && effect.applications > 1,
    ).length;
    const result = {
      format: REPORT_FORMAT,
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      category: scenario.category,
      riskClass: scenario.riskClass,
      split,
      expected: Object.freeze({ ...scenario.expected }),
      outcome,
      requiresReview: orchestration.requiresReview,
      matched: false,
      falseVerified: outcome === "VERIFIED" && scenario.expected.outcome !== "VERIFIED",
      falseRejection:
        scenario.expected.outcome === "VERIFIED" &&
        (outcome === "REJECTED" || outcome === "BLOCKED"),
      terminal: OUTCOMES.includes(outcome),
      attempts: orchestration.attempts,
      recoveryAttempted: orchestration.recoveryAttempted,
      recovered: orchestration.recovered,
      effects: Object.freeze([...orchestration.effects]),
      unsafeDuplicateEffects:
        outcome === "VERIFIED"
          ? (orchestration.effects ?? []).filter(
              (effect) => effect.idempotent === false && effect.applications > 1,
            ).length
          : 0,
      detectedDuplicateEffects,
      configResolution: Object.freeze(configResolution),
      configExpectationMet,
      authorityPreserved,
      durationMs: clock() - startedAt,
      telemetry: Object.freeze({
        eventsEmitted: emitter.getEvents().length,
        correlated: completeness.correlated,
        complete: completeness.complete,
      }),
      details: Object.freeze({ ...orchestration.details }),
    };
    result.matched = computeMatch(result);
    return Object.freeze(result);
  }

  function generateReport(results, reportOptions = {}) {
    if (!Array.isArray(results)) throw new TypeError("generateReport results must be an array");
    if (!isPlainObject(reportOptions))
      throw new TypeError("generateReport options must be an object");
    for (const result of results) {
      if (
        !isPlainObject(result) ||
        !OUTCOMES.includes(result.outcome) ||
        typeof result.matched !== "boolean"
      )
        throw new TypeError("generateReport requires harness results (scenarioId/outcome/matched)");
    }
    const slis = computeAllSLIs(results);
    const byCategory = {};
    for (const category of CATEGORIES) byCategory[category] = { total: 0, matched: 0 };
    const byOutcome = {};
    for (const outcome of OUTCOMES) byOutcome[outcome] = 0;
    for (const result of results) {
      if (!CATEGORIES.includes(result.category))
        throw new TypeError(
          `result '${result.scenarioId}' has unknown category '${result.category}'`,
        );
      byCategory[result.category].total += 1;
      if (result.matched) byCategory[result.category].matched += 1;
      byOutcome[result.outcome] += 1;
    }
    const safetyGates = [
      {
        id: "false-verified-zero",
        sliId: "falseVerified",
        absolute: true,
        violated: slis.falseVerified.numerator > 0,
        observed: slis.falseVerified.numerator,
        detail: "any false VERIFIED in the window fails the report",
      },
      {
        id: "duplicate-effects-zero",
        sliId: "duplicateEffects",
        absolute: true,
        violated: slis.duplicateEffects.numerator > 0,
        observed: slis.duplicateEffects.numerator,
        detail: "any duplicate non-idempotent effect inside a VERIFIED run fails the report",
      },
    ];
    const overall = safetyGates.some((gate) => gate.violated) ? "FAILED" : "PASSED";
    const report = {
      format: REPORT_FORMAT,
      generatedAt: isoNow(),
      overall,
      totals: {
        scenarios: results.length,
        matched: results.filter((result) => result.matched).length,
        unmatched: results.filter((result) => !result.matched).length,
        falseVerified: results.filter((result) => result.falseVerified).length,
        falseRejection: results.filter((result) => result.falseRejection).length,
        detectedDuplicateEffects: results.reduce(
          (sum, result) => sum + result.detectedDuplicateEffects,
          0,
        ),
        byCategory: byCategory,
        byOutcome: byOutcome,
      },
      slis,
      safetyGates,
      adjudication: isPlainObject(reportOptions.adjudication) ? reportOptions.adjudication : null,
      corpusProvenance: Array.isArray(reportOptions.corpus) ? reportOptions.corpus : [],
      limitations: REPORT_LIMITATIONS,
      thresholdsProvisional: true,
    };
    return Object.freeze(report);
  }

  async function loadCorpusManifest(corpusPath) {
    if (typeof corpusPath !== "string" || corpusPath.length === 0)
      throw new TypeError("corpusPath must be a non-empty string");
    let text;
    try {
      text = await readFile(corpusPath, "utf8");
    } catch (error) {
      throw harnessError(
        "corpus-unreadable",
        `cannot read corpus manifest '${corpusPath}': ${error.code}`,
      );
    }
    const manifest = parseJson(text);
    if (!isPlainObject(manifest))
      throw harnessError("invalid-corpus", "corpus manifest must be an object");
    assertClosedKeys(
      manifest,
      ["format", "split", "corpusId", "scenarios", "provenance"],
      "corpus manifest",
    );
    if (manifest.format !== CORPUS_FORMAT)
      throw harnessError("invalid-corpus", `corpus format must be ${CORPUS_FORMAT}`);
    if (!CORPUS_SPLITS.includes(manifest.split))
      throw harnessError(
        "invalid-corpus",
        `corpus split must be one of ${CORPUS_SPLITS.join(", ")}`,
      );
    if (typeof manifest.corpusId !== "string" || manifest.corpusId.length === 0)
      throw harnessError("invalid-corpus", "corpusId must be a non-empty string");
    if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0)
      throw harnessError("invalid-corpus", "corpus scenarios must be a non-empty array");
    const provenance = manifest.provenance;
    if (!isPlainObject(provenance))
      throw harnessError("invalid-corpus", "corpus provenance must be an object");
    assertClosedKeys(
      provenance,
      ["createdAt", "labelsFrozen", "methodology", "notes"],
      "corpus provenance",
    );
    if (typeof provenance.createdAt !== "string" || provenance.createdAt.length === 0)
      throw harnessError("invalid-corpus", "corpus provenance requires createdAt");
    if (typeof provenance.labelsFrozen !== "boolean")
      throw harnessError("invalid-corpus", "corpus provenance requires labelsFrozen boolean");
    if (provenance.labelsFrozen !== true && manifest.split === "held-out")
      throw harnessError(
        "invalid-corpus",
        "held-out corpus must declare labelsFrozen: true (labels must not be tuned after evaluation starts)",
      );
    const seen = new Set();
    for (const scenario of manifest.scenarios) {
      if (!isPlainObject(scenario))
        throw harnessError("invalid-corpus", "corpus scenarios must be objects");
      if (seen.has(scenario.scenarioId))
        throw harnessError(
          "invalid-corpus",
          `duplicate scenarioId '${scenario.scenarioId}' in corpus`,
        );
      seen.add(scenario.scenarioId);
    }
    return manifest;
  }

  async function runCorpus(corpusPath) {
    const manifest = await loadCorpusManifest(corpusPath);
    const results = [];
    for (const scenario of manifest.scenarios)
      results.push(await runScenario(scenario, { split: manifest.split }));
    const corpusDigest = digest({
      corpusId: manifest.corpusId,
      split: manifest.split,
      scenarioIds: manifest.scenarios.map((scenario) => scenario.scenarioId),
    });
    const corpus = {
      split: manifest.split,
      corpusId: manifest.corpusId,
      scenarioCount: manifest.scenarios.length,
      corpusDigest,
      labelsFrozen: manifest.provenance.labelsFrozen,
    };
    const report = generateReport(results, { corpus: [corpus] });
    return Object.freeze({ corpus, results: Object.freeze(results), report });
  }

  function verifyCorpusDisjoint(manifests) {
    if (!Array.isArray(manifests) || manifests.length === 0)
      throw new TypeError("verifyCorpusDisjoint requires a non-empty manifests array");
    const owners = new Map();
    const duplicates = [];
    const bySplit = {};
    const byCategory = {};
    for (const manifest of manifests) {
      if (!isPlainObject(manifest) || manifest.format !== CORPUS_FORMAT)
        throw new TypeError("verifyCorpusDisjoint requires loaded corpus manifests");
      bySplit[manifest.split] = (bySplit[manifest.split] ?? 0) + manifest.scenarios.length;
      for (const scenario of manifest.scenarios) {
        if (owners.has(scenario.scenarioId))
          duplicates.push({
            scenarioId: scenario.scenarioId,
            splits: [owners.get(scenario.scenarioId), manifest.split],
          });
        else owners.set(scenario.scenarioId, manifest.split);
        byCategory[scenario.category] = (byCategory[scenario.category] ?? 0) + 1;
      }
    }
    return Object.freeze({
      disjoint: duplicates.length === 0,
      duplicates: Object.freeze(duplicates),
      totalScenarios: owners.size,
      bySplit: Object.freeze(bySplit),
      byCategory: Object.freeze(byCategory),
    });
  }

  return Object.freeze({
    runScenario,
    runCorpus,
    loadCorpusManifest,
    verifyCorpusDisjoint,
    generateReport,
  });
}

export { computeAllSLIs };
export {
  createAdjudicationRubric,
  createAdjudicationSession,
  computeInterRater,
} from "./adjudication.mjs";
export { computeSLI, SLI_DEFINITIONS, wilsonInterval } from "./sli.mjs";

export default {
  CORPUS_FORMAT,
  REPORT_FORMAT,
  CORPUS_SPLITS,
  OUTCOMES,
  RISK_CLASSES,
  CATEGORIES,
  HOST_BEHAVIORS,
  REPORT_LIMITATIONS,
  createEvaluationHarness,
};
