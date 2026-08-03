# T204 Canonical Existing-Ten Pipeline Facade — Independent Read-Only Review

**Date:** 2026-08-02
**Method:** Read-only source inspection of the plan, `lib/scan/pipeline/run.mjs`, `lib/scan/pipeline/existing-ten.mjs`, `test/expansion-production-pipeline.test.mjs`, `scripts/scan.mjs`, `test/fixtures-pipeline.test.mjs`, plus supporting modules and baselines. Acceptance and regression gates executed: `node --test --test-concurrency=1` for T204 (21/21) and baseline/constraints/fixtures-pipeline/render/write (31/31).

## Verdict

**PASS** — all seven verification items hold. Two non-blocking observations below.

## Acceptance verification

1. **One exported injectable pipeline.** `runExistingTenPipeline` (`run.mjs:103-160`) is the single canonical entry, with all four seams injectable: `clock` (default `DEFAULT_CLOCK`, `run.mjs:16`), `commandRunner` (`resolveBroker` → `createCommandBroker`, `run.mjs:28-32`), `pluginRegistry` (`createScanContext`, `run.mjs:20-26`), `sink` (default `DEFAULT_SINK = writeNORMS`, `run.mjs:18`). `processExistingTenRepo` (`run.mjs:71-101`) is the single-repo injectable variant. Tests 1, 17-19 verify each seam.
2. **Exact CLI behavior parity.** Retry loop (`run.mjs:34-69`) is structurally identical to `scripts/scan.mjs:138-163`: same `needsRetry > 0 && retryCount < MAX_RETRIES(=2)` condition, same per-dimension re-scan + merge-with-fallback + append-extra + re-enrich/re-validate sequence, same `<40` coverage threshold from `validate.mjs:41`. Multi-repo is sequential with one `generated` date and a single terminal sink call (`run.mjs:125-159`), matching the CLI loop and its single `writeNORMS`. Cross-observations use final `validated.contradictions` on each repo (`run.mjs:87-89`), byte-equivalent to the CLI's always-set `crossObservations` (`scan.mjs:170-174`) because `crossObservationsSection` treats empty/absent identically (`write.mjs:25`). Fixture parity + cross-observations wiring verified by tests 6-10, 20.
3. **No integration test reconstructs scanner dispatch.** The T204 test self-asserts no `/lib\/scan\/deep\//` and no `Promise.all` in its own source (test 21). It calls the exported production pipeline and uses the integrity-locked T201/T020 `runPipeline` helper solely as a byte-parity oracle. See observation 2.
4. **No production changes.** `scripts/scan.mjs` is hash-locked via `capabilities.json:34-38` (constraints gate passes); sole writer and single CLI `writeNORMS` call enforced (`capabilities.json:61-71`, `expansion-constraints.test.mjs:215-251`); no new `node:child_process` owners; zero dependencies. New pipeline files are additive and pass the acquisition audit.
5. **Deterministic baseline/hash parity.** Semantic projection reproduces `semantic.json`; fixed-input renderer matches `renderer.md` byte-for-byte with one write; all five fixture `semanticSha256`/`markdownSha256` in `fixture-behavior.json` reproduce through the canonical pipeline with identical canonicalization (FIXTURE_ROOT/FIXTURE_NAME/DATE/HOST_VERSION).
6. **Once-only dispatch.** Initial dispatch of each of the ten dimensions exactly once per repo in canonical order (`scanExistingTen`, `existing-ten.mjs:52-56`); retry re-dispatches only `needsRetry` dimensions, capped at `MAX_RETRIES = 2` (tests 15-16, 20).
7. **Sanitized errors.** T204 adds no error-rendering surface; errors propagate exactly as the current CLI does (`scan.mjs:182-184`). Sanitized diagnostics/error boundary are explicitly deferred to T224 per plan (`2026-08-02-...-csm.md:578`); parity is preserved, not violated.

## Observations (non-blocking, P3)

1. **`run.mjs:68`** — `enrichValidateRetry` returns `enriched: firstEnriched`, discarding the final post-retry `enriched` computed at `run.mjs:64`. Today no consumer reads `semantic[].enriched` after a retry (the retry test calls `processExistingTenRepo` directly and the fixture-parity tests trigger no retries), so this is latent. Fix: return the final `enriched`, or document the CLI-parity intent (CLI prints first-enrichment notes before retries).
2. **`test/expansion-production-pipeline.test.mjs:11,147`** — the byte-parity oracle is `runPipeline` from `fixtures-pipeline.test.mjs`, which itself is a test-only reconstruction of scanner dispatch (ten direct scanner imports + `Promise.all`). Acceptable because it is the pre-existing, integrity-locked T020/T201 reference harness (not a T204 construction) and is used only as a baseline oracle; the T204 integration test itself never reconstructs dispatch. No fix required; recorded for the T224 cutover to remove the dependency.
