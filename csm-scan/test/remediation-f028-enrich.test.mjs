// F-028 — enrichValidateRetry returns the FINAL enriched state.
//
// Before this fix the function returned `firstEnriched` (pre-retry) while
// `validated.findings` was already post-retry, so consumers reported stale
// gaps/inferredPatterns. After the fix the returned enriched is the
// enrichment of the final merged findings.

import assert from "node:assert/strict";
import { test } from "node:test";

import { enrichValidateRetry } from "../lib/scan/pipeline/run.mjs";
import { withFixture } from "./harness.mjs";
import { files as pythonFiles } from "./fixtures/python.mjs";
import { runExpandedPipeline } from "../lib/scan/pipeline/run.mjs";

function weakConfig(deepResults) {
  return deepResults.map((entry) =>
    entry.dimension === "config"
      ? {
          dimension: "config",
          signal: "low",
          findings: { lint: null, format: null, markers: null },
        }
      : entry,
  );
}

test("F-028: enrichValidateRetry returns the post-retry enriched, not the stale first one", async () => {
  await withFixture("f028-retry", pythonFiles, async (repoPath) => {
    const full = await runExpandedPipeline({
      repos: [repoPath],
      clock: () => "2026-01-01",
      sink: () => "",
    });
    const overview = full.semantic[0].overview;
    const deepResults = weakConfig(full.semantic[0].deepResults);

    const { enriched, validated, trace } = await enrichValidateRetry({
      overview,
      deepResults,
      path: repoPath,
    });
    assert.ok(
      trace.some((entry) => entry.phase === "retry"),
      "retry must have fired",
    );
    assert.deepEqual(validated.needsRetry, [], "config must recover");

    // The returned enriched must reflect the POST-retry config (signal high),
    // not the pre-retry weak config (signal low) that the pre-fix code
    // returned as `firstEnriched`. The signal field is carried per dimension.
    const config = enriched.enriched.find((entry) => entry.dimension === "config");
    assert.ok(config, "config must be present in enriched");
    assert.equal(
      config.signal,
      "high",
      "config signal must be the post-retry high, not the stale low",
    );
  });
});
