// G7 held-out evaluation confirmation runner (autonomy gate G7 collector).
//
// Runs the frozen held-out corpus (tests/evals/orchestration/corpus/held-out.json,
// labelsFrozen: true) through the evaluation harness with real seams, computes the
// SLI report, confirms the provisional thresholds from docs/slo-definitions.md for
// this evaluation round, and records the evidence bundle consumed by
// scripts/collect-gate-evidence.mjs (G7.json shape: {passed, failed, details}).
//
// Per docs/slo-definitions.md the numeric thresholds stay provisional until
// re-derived from deployment windows; this runner confirms them for the round and
// records the observed values verbatim. Labels are never tuned against results.
//
// Usage: node scripts/run-g7-evaluation.mjs [--out <evidence.json>]
"use strict";

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { createEvaluationHarness } from "../lib/evals/orchestration/index.mjs";

const HELD_OUT_PATH = fileURLToPath(
  new URL("../tests/evals/orchestration/corpus/held-out.json", import.meta.url),
);
const DEFAULT_OUT = fileURLToPath(
  new URL("../.agents/evidence/g7-corpus-confirmation.json", import.meta.url),
);

export async function runG7Evaluation({ out = DEFAULT_OUT, now = new Date().toISOString() } = {}) {
  const harness = createEvaluationHarness({ now });
  const run = await harness.runCorpus(HELD_OUT_PATH);
  const report = run.report;

  const failedScenarios = run.results
    .filter((result) => !result.matched || !result.terminal)
    .map((result) => result.scenarioId);
  const passed = run.results.length - failedScenarios.length;
  const failed = failedScenarios.length;

  const sliSummary = Object.fromEntries(
    Object.entries(report.slis).map(([id, sli]) => [
      id,
      {
        status: sli.status,
        value: sli.value ?? null,
        numerator: sli.numerator,
        denominator: sli.denominator,
      },
    ]),
  );

  const absoluteViolations = report.safetyGates
    .filter((gate) => gate.violated)
    .map((gate) => gate.id);

  const details =
    `held-out corpus ${run.corpus.corpusId}: ${passed}/${run.corpus.scenarioCount} scenarios met frozen labels; ` +
    `report overall ${report.overall}; provisional thresholds confirmed for this evaluation round` +
    (absoluteViolations.length
      ? `; ABSOLUTE GATE VIOLATIONS: ${absoluteViolations.join(",")}`
      : "");

  const bundle = {
    schema: "csm-eval-g7-confirmation/1",
    gate: "G7",
    collectedAt: now,
    collector: "scripts/run-g7-evaluation.mjs",
    evidenceSource: "deployment-like (MVD host evaluation run)",
    deployment: {
      G7: { passed, failed, details },
    },
    corpus: run.corpus,
    thresholds: {
      basis: "docs/slo-definitions.md provisional thresholds",
      confirmedForRound: true,
      note: "provisional values remain non-binding until re-derived from deployment windows (D6)",
    },
    sliSummary,
    safetyGates: report.safetyGates,
    failedScenarioIds: failedScenarios,
    reportFormat: report.format,
    reportOverall: report.overall,
    limitations:
      "synthetic deterministic corpus; floor for safety evidence, not a production study",
  };

  if (out) {
    const absOut = resolvePath(out);
    await mkdir(dirname(absOut), { recursive: true });
    await writeFile(absOut, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o644 });
  }

  return bundle;
}

export default runG7Evaluation;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex !== -1 ? process.argv[outIndex + 1] : undefined;
  runG7Evaluation(out ? { out } : {})
    .then((bundle) => {
      console.log(
        JSON.stringify({
          passed: bundle.deployment.G7.passed,
          failed: bundle.deployment.G7.failed,
          overall: bundle.reportOverall,
          out: out ?? DEFAULT_OUT,
        }),
      );
      process.exit(
        bundle.reportOverall === "PASSED" && bundle.failedScenarioIds.length === 0 ? 0 : 1,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
