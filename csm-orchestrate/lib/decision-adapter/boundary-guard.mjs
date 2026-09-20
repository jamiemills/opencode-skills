"use strict";

// T008 (jev-review-judge-substitution): the deterministic never-Jev boundary
// guard. Advisory/decision payloads must never enter a material digest, an
// evaluator receipt, a gate input, a closure record, or an acceptance record.
// The guard is called by the harness (not by a prompt) and fails closed: any
// advisory-shaped object found in a protected input is a violation.
//
// An "advisory-shaped" object is one that carries a Jev advice identity plus an
// answer/confidence/probability — i.e. what the decision adapter returns. A
// normal finding, requirement, evidence, or gate record does not match.

export const BOUNDARY_GUARD_FORMAT = "csm-never-jev-guard/1";

const ADVISORY_IDENTITY_KEYS = Object.freeze(["providerId", "pointId", "providerModel"]);
const ADVISORY_ANSWER_KEYS = Object.freeze(["answer", "probabilities", "confidence"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function looksAdvisory(value) {
  if (!isPlainObject(value)) return false;
  const hasIdentity =
    ADVISORY_IDENTITY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    (typeof value.routingBand === "string" && "answer" in value);
  if (!hasIdentity) return false;
  return ADVISORY_ANSWER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

// Recursively collect JSON-pointer paths that look like Jev advice.
export function findAdvisoryPaths(value, path = "", found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findAdvisoryPaths(entry, `${path}/${index}`, found));
    return found;
  }
  if (!isPlainObject(value)) return found;
  if (looksAdvisory(value)) found.push(path === "" ? "/" : path);
  for (const [key, entry] of Object.entries(value))
    findAdvisoryPaths(entry, `${path}/${key}`, found);
  return found;
}

// Guard a protected input. Returns { ok, format, label, violations }.
export function guardProtectedInput(value, { label = "protected-input" } = {}) {
  const violations = findAdvisoryPaths(value);
  return Object.freeze({
    format: BOUNDARY_GUARD_FORMAT,
    label,
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

// Fail-closed assertion for harness call sites.
export function assertNoAdvisory(value, { label = "protected-input" } = {}) {
  const result = guardProtectedInput(value, { label });
  if (!result.ok)
    throw Object.assign(
      new Error(
        `never-Jev boundary violation in ${label}: advisory at ${result.violations.join(", ")}`,
      ),
      { code: "never-jev-violation", violations: result.violations },
    );
  return result;
}

export default { BOUNDARY_GUARD_FORMAT, findAdvisoryPaths, guardProtectedInput, assertNoAdvisory };
