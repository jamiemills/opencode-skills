// csm-scan test tier manifest (T003).
//
// Complete, non-overlapping partition of every test/*.test.mjs file into
// three named tiers:
//   - S (small): pure-unit, parallel-stable — runs with default concurrency
//   - M (medium): needs serial execution (`--test-concurrency=1`)
//   - L (large): filesystem-heavy fixture/integration suites — serial too
//
// This manifest is intentionally FROZEN POST-T002: the legacy ten-dimension
// pipeline is being retired by a parallel agent in the same plan cycle, and
// legacy test files may be renamed or removed before it lands. Do not fill
// this in from the pre-migration file set — the Wave-3 manifest step
// regenerates it from the POST-T002 `test/*.test.mjs` file list and then
// verifies the partition via `node test/scripts/run-tier.mjs <s|m|l|all>`.
//
// PLACEHOLDER: empty arrays below until that freeze happens. run-tier.mjs
// refuses to run anything while the manifest is empty, so a placeholder can
// never silently execute a partial/no tier.

if (process.env.NODE_TEST_CONTEXT !== undefined && process.env.NODE_TEST_CONTEXT !== '') {
  process.exit(0);
}

// Relative to the csm-scan skill root, e.g. 'test/expansion-final-acceptance.test.mjs'.
export const S = [];
export const M = [];
export const L = [];
