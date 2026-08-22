// csm-scan test tier manifest (T003) — FROZEN POST-T002.
//
// Complete, non-overlapping partition of every test/*.test.mjs file into
// three named tiers:
//   - S (small): pure-unit, parallel-stable — runs with default concurrency
//   - M (medium): subprocess-dependent (git/rg/node), needs serial execution
//   - L (large): pipeline/fixture-heavy integration suites — serial too
//
// Classification is mechanical: files importing child_process/execFile/spawn
// or driving the pipelines/fixtures go to serial tiers (M/L); everything else
// is parallel-safe S. run-tier.mjs enforces completeness and non-overlap at
// runtime, so a stale or partial manifest fails loudly on its own.

if (process.env.NODE_TEST_CONTEXT !== undefined && process.env.NODE_TEST_CONTEXT !== "") {
  process.exit(0);
}

// Relative to the csm-scan skill root, e.g. 'test/expansion-final-acceptance.test.mjs'.
export const S = [
  "test/_smoke.test.mjs",
  "test/comments.test.mjs",
  "test/detection.test.mjs",
  "test/enrich.test.mjs",
  "test/enum.test.mjs",
  "test/expansion-artifact-privacy.test.mjs",
  "test/expansion-baseline.test.mjs",
  "test/expansion-contracts.test.mjs",
  "test/expansion-declarations.test.mjs",
  "test/expansion-plugin-loader.test.mjs",
  "test/expansion-provider-foundation.test.mjs",
  "test/expansion-render-existing-ten.test.mjs",
  "test/expansion-render-registration.test.mjs",
  "test/expansion-standards-policy.test.mjs",
  "test/git-commit-vocab.test.mjs",
  "test/graph-facts-deepchain.test.mjs",
  "test/ignore.test.mjs",
  "test/manifest.test.mjs",
  "test/parse.test.mjs",
  "test/remediation-f002-gitleaks.test.mjs",
  "test/remediation-f022-f023-f062-reads.test.mjs",
  "test/remediation-f024-escape.test.mjs",
  "test/remediation-f025-redaction.test.mjs",
  "test/remediation-f026-privacy-gate.test.mjs",
  "test/remediation-f027-cargo-pool.test.mjs",
  "test/remediation-f028-enrich.test.mjs",
  "test/remediation-f029-practices.test.mjs",
  "test/remediation-f030-capability.test.mjs",
  "test/remediation-f031-perrule.test.mjs",
  "test/remediation-f051-trace.test.mjs",
  "test/remediation-f055-sql-lines.test.mjs",
  "test/remediation-f065b-write-atomic.test.mjs",
  "test/render-git.test.mjs",
  "test/validate.test.mjs",
  "test/verbose-trace.test.mjs",
];
export const M = [
  "test/expansion-command-core.test.mjs",
  "test/expansion-cross-repo.test.mjs",
  "test/expansion-deployment.test.mjs",
  "test/expansion-dimension-registration.test.mjs",
  "test/scan-cli.test.mjs",
  "test/write.test.mjs",
];
export const L = [
  "test/architecture-repair.test.mjs",
  "test/architecture.test.mjs",
  "test/config.test.mjs",
  "test/conventions-rust-standards.test.mjs",
  "test/conventions.test.mjs",
  "test/documentation.test.mjs",
  "test/ecosystem.test.mjs",
  "test/expansion-activation.test.mjs",
  "test/expansion-api.test.mjs",
  "test/expansion-architecture-extension.test.mjs",
  "test/expansion-assurance.test.mjs",
  "test/expansion-command-deep.test.mjs",
  "test/expansion-constraints.test.mjs",
  "test/expansion-data.test.mjs",
  "test/expansion-determinism.test.mjs",
  "test/expansion-final-acceptance.test.mjs",
  "test/expansion-fixtures.test.mjs",
  "test/expansion-governance.test.mjs",
  "test/expansion-maintainability.test.mjs",
  "test/expansion-negative.test.mjs",
  "test/expansion-practices.test.mjs",
  "test/expansion-privacy-gate.test.mjs",
  "test/expansion-privacy-write.test.mjs",
  "test/expansion-production-pipeline.test.mjs",
  "test/expansion-provider-analysis-catalog.test.mjs",
  "test/expansion-provider-assurance-catalog.test.mjs",
  "test/expansion-provider-runtime-catalog.test.mjs",
  "test/expansion-synthetic-plugin.test.mjs",
  "test/expansion-voice-gate.test.mjs",
  "test/fixtures-pipeline.test.mjs",
  "test/golden.test.mjs",
  "test/manifest-survey-repair.test.mjs",
  "test/operations.test.mjs",
  "test/regression-parity.test.mjs",
  "test/security.test.mjs",
  "test/stack.test.mjs",
  "test/structure.test.mjs",
  "test/survey.test.mjs",
  "test/testing.test.mjs",
  "test/voice-gate.test.mjs",
];
