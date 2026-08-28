"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvaluationHarness } from "../../../lib/evals/orchestration/index.mjs";

const harness = createEvaluationHarness({
  clock: () => 42,
  now: "2026-08-28T00:00:00.000Z",
});

const CORPUS_DIR = new URL("./corpus/", import.meta.url);
const MANIFEST_PATHS = ["development.json", "validation.json", "held-out.json"].map(
  (name) => new URL(name, CORPUS_DIR).pathname,
);

test("evals corpus: manifests load, are disjoint, and cover every category", async () => {
  const manifests = [];
  for (const path of MANIFEST_PATHS) manifests.push(await harness.loadCorpusManifest(path));
  const disjointness = harness.verifyCorpusDisjoint(manifests);
  assert.equal(disjointness.disjoint, true);
  assert.deepEqual(disjointness.duplicates, []);
  assert.equal(disjointness.totalScenarios, 30);
  assert.deepEqual(disjointness.bySplit, { development: 12, validation: 8, "held-out": 10 });
  assert.deepEqual(disjointness.byCategory, {
    correctness: 10,
    "config-precedence": 5,
    "authority-boundary": 5,
    recovery: 5,
    adversarial: 5,
  });
  const heldOut = manifests.find((manifest) => manifest.split === "held-out");
  assert.equal(heldOut.provenance.labelsFrozen, true);
});

test("evals corpus: contamination is detected when a scenario appears in two splits", async () => {
  const [development, validation] = await Promise.all(
    MANIFEST_PATHS.slice(0, 2).map((path) => harness.loadCorpusManifest(path)),
  );
  const contaminated = {
    ...validation,
    scenarios: [...validation.scenarios, development.scenarios[0]],
  };
  const disjointness = harness.verifyCorpusDisjoint([development, contaminated]);
  assert.equal(disjointness.disjoint, false);
  assert.equal(disjointness.duplicates.length, 1);
  assert.equal(disjointness.duplicates[0].scenarioId, development.scenarios[0].scenarioId);
});

test("evals corpus: every split runs to fully matched terminal outcomes with complete telemetry", async () => {
  for (const path of MANIFEST_PATHS) {
    const run = await harness.runCorpus(path);
    assert.ok(run.corpus.scenarioCount >= 1);
    assert.equal(run.results.length, run.corpus.scenarioCount);
    for (const result of run.results) {
      assert.equal(result.terminal, true, `${result.scenarioId} must reach a terminal outcome`);
      assert.equal(result.matched, true, `${result.scenarioId} must match its frozen label`);
      assert.equal(
        result.telemetry.complete,
        true,
        `${result.scenarioId} telemetry must be complete`,
      );
      assert.ok(
        result.telemetry.eventsEmitted >= 2,
        `${result.scenarioId} emitted correlated events`,
      );
    }
    assert.equal(run.report.overall, "PASSED");
    assert.equal(
      run.report.safetyGates.some((gate) => gate.violated),
      false,
    );
    assert.equal(run.report.corpusProvenance.length, 1);
    assert.match(run.report.corpusProvenance[0].corpusDigest, /^sha256:[a-f0-9]{64}$/);
  }
});

test("evals corpus: full corpus keeps both absolute safety gates at zero", async () => {
  const allResults = [];
  for (const path of MANIFEST_PATHS) {
    const run = await harness.runCorpus(path);
    allResults.push(...run.results);
  }
  const report = harness.generateReport(allResults, {
    corpus: MANIFEST_PATHS.map((path) => path.split("/").pop()),
  });
  assert.equal(report.totals.scenarios, 30);
  assert.equal(report.totals.falseVerified, 0);
  assert.equal(report.slis.falseVerified.numerator, 0);
  assert.equal(report.slis.duplicateEffects.numerator, 0);
  assert.equal(report.slis.correctness.value, 1);
  const recoveryPopulation = allResults.filter((result) => result.recoveryAttempted);
  assert.equal(recoveryPopulation.length, 5);
  assert.equal(recoveryPopulation.filter((result) => result.recovered).length, 4);
  assert.ok(Math.abs(report.slis.recoveryRate.value - 4 / 5) < 1e-12);
});

test("evals corpus: config precedence and authority evidence comes from the real seams", async () => {
  const run = await harness.runCorpus(MANIFEST_PATHS[0]);
  const cfg001 = run.results.find((result) => result.scenarioId === "eval-cfg-001");
  assert.equal(cfg001.configExpectationMet, true);
  assert.equal(cfg001.configResolution.rejected, false);
  assert.match(cfg001.configResolution.effectiveDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(cfg001.configResolution.layers, ["project", "user"]);
  const auth001 = run.results.find((result) => result.scenarioId === "eval-auth-001");
  assert.equal(auth001.outcome, "BLOCKED");
  assert.equal(auth001.configResolution.rejected, true);
  assert.equal(auth001.configResolution.reasonCode, "unknown-key");
  assert.equal(auth001.authorityPreserved, true);
  assert.equal(auth001.attempts, 0);
});

test("evals corpus: rejected config fragments never leak into results or telemetry", async () => {
  const allResults = [];
  for (const path of MANIFEST_PATHS) {
    const run = await harness.runCorpus(path);
    allResults.push(...run.results);
  }
  const serialized = JSON.stringify(allResults);
  assert.equal(serialized.includes("synthetic-not-a-real-secret"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("fs-write"), false);
});

test("evals corpus: malformed manifests fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eval-corpus-"));
  const unfrozenHeldOut = join(dir, "held-out.json");
  await writeFile(
    unfrozenHeldOut,
    JSON.stringify({
      format: "csm-eval-corpus/1",
      split: "held-out",
      corpusId: "eval-malformed",
      provenance: { createdAt: "2026-08-28T00:00:00.000Z", labelsFrozen: false, methodology: "x" },
      scenarios: [
        {
          scenarioId: "eval-x-001",
          name: "x",
          category: "correctness",
          riskClass: "low",
          expected: { outcome: "VERIFIED" },
          setup: { approachPhases: 1, hostBehavior: "cooperative" },
        },
      ],
    }),
    "utf8",
  );
  await assert.rejects(
    () => harness.runCorpus(unfrozenHeldOut),
    (error) => {
      assert.equal(error.code, "invalid-corpus");
      assert.match(error.message, /labelsFrozen/);
      return true;
    },
  );
  const duplicateIds = join(dir, "duplicates.json");
  const scenario = {
    scenarioId: "eval-x-001",
    name: "x",
    category: "correctness",
    riskClass: "low",
    expected: { outcome: "VERIFIED" },
    setup: { approachPhases: 1, hostBehavior: "cooperative" },
  };
  await writeFile(
    duplicateIds,
    JSON.stringify({
      format: "csm-eval-corpus/1",
      split: "development",
      corpusId: "eval-malformed",
      provenance: { createdAt: "2026-08-28T00:00:00.000Z", labelsFrozen: false, methodology: "x" },
      scenarios: [scenario, scenario],
    }),
    "utf8",
  );
  await assert.rejects(
    () => harness.runCorpus(duplicateIds),
    (error) => {
      assert.equal(error.code, "invalid-corpus");
      assert.match(error.message, /duplicate scenarioId/);
      return true;
    },
  );
});
