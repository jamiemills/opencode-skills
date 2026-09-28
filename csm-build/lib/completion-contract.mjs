// csm-build consumption of the plan completion contract (T010).
//
// A csm-plan/2 record may carry a top-level `completionContract`
// (definitionOfDone + closeOutSequence). csm-build consumes it into the
// mandated close-out task sequence: when the contract is present the plan's
// declared closeOutSequence governs, defaulting to the canonical sequence when
// the contract omits/empties it. A legacy csm-plan/1 record has no contract and
// keeps the pre-existing baseline behavior (no mandated sequence), so this
// module never invents ceremony for plans that did not opt in.
//
// Pure: no I/O, no lifecycle state, no acceptance authority. It only derives a
// sequence; the csm-build Completion Gate and independent evaluator still own
// whether that sequence actually ran.

// Canonical close-out sequence used when a completion contract is present but
// does not itself declare (or declares an empty) closeOutSequence. The
// authorization caveat is deliberately part of the step: committing is never
// implied by the contract and still requires a later explicit invocation.
export const CANONICAL_CLOSE_OUT_SEQUENCE = Object.freeze([
  "independent completion verdict recorded",
  "commit only when a later invocation explicitly authorizes it",
  "push and confirm CI green",
  "close the plan and build state",
]);

// Baseline marker returned for a legacy csm-plan/1 plan (or any plan without a
// completion contract): no mandated close-out sequence, existing behavior
// unchanged.
export const LEGACY_CLOSE_OUT_SEQUENCE = Object.freeze([]);

export function hasCompletionContract(plan) {
  const contract = plan?.completionContract;
  return Boolean(contract && typeof contract === "object" && !Array.isArray(contract));
}

function cloneStep(step) {
  if (step && typeof step === "object" && !Array.isArray(step))
    return Object.freeze(structuredClone(step));
  return step;
}

export function closeOutSequenceFor(plan) {
  if (!hasCompletionContract(plan)) return LEGACY_CLOSE_OUT_SEQUENCE;
  const declared = plan.completionContract.closeOutSequence;
  if (!Array.isArray(declared) || declared.length === 0) return CANONICAL_CLOSE_OUT_SEQUENCE;
  return Object.freeze(declared.map(cloneStep));
}
