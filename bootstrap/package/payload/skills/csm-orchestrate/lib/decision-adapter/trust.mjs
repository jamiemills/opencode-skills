"use strict";

// T005/T029: the trust ladder. Trust is a per-configuration property, never
// global. The ladder is L0 (off) .. L4 (authoritative for a narrow reversible
// non-safety apply); L5 (authority over acceptance/security/completion) is
// refused by construction. The harness consumes a BARE label (labelOf), never
// the advisory object, so the never-Jev boundary holds.

export const TRUST_LEVELS = Object.freeze(["L0", "L1", "L2", "L3", "L4"]);

// The highest trust a point may reach given its safety class. Only non-safety
// points may ever be authoritative.
export const TRUST_CEILINGS = Object.freeze({
  "non-safety": "L4",
  safety: "L2",
  authority: "L0",
});

export function assertTrustPromotion(record = {}) {
  const trustLevel = record.trustLevel;
  // Fail closed: an omitted ceiling is treated as the most restrictive class.
  const ceiling = record.ceiling ?? "authority";
  if (!TRUST_LEVELS.includes(trustLevel)) {
    const error = new TypeError(
      `refused trust level ${String(trustLevel)} (L5 and unknown levels are refused)`,
    );
    error.code = "l5-refused";
    throw error;
  }
  const allowed = TRUST_CEILINGS[ceiling] ?? "L0";
  if (TRUST_LEVELS.indexOf(trustLevel) > TRUST_LEVELS.indexOf(allowed)) {
    const error = new TypeError(`trust ${trustLevel} exceeds the ${ceiling} ceiling ${allowed}`);
    error.code = "ceiling-exceeded";
    throw error;
  }
  if (trustLevel === "L4" && record.reversible !== true) {
    const error = new TypeError("L4 authoritativeness requires a reversible action");
    error.code = "not-reversible";
    throw error;
  }
  return record;
}

// The bare-label pipe: Jev classifies; the harness consumes only the label, so
// provider identity, confidence, and probabilities never enter a gate.
export function labelOf(advice) {
  if (advice === null || advice === undefined) return null;
  const answer = advice.answer;
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean")
    return answer;
  // Never leak a probability vector: only a discrete scalar label.
  if (typeof answer === "object") return answer.choice ?? answer.noul ?? answer.label ?? null;
  return null;
}
