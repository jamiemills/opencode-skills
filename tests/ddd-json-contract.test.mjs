"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assertReportContract } from "../csm-ddd/lib/ddd/contracts.mjs";
import {
  analyzeRepository,
  readPublishedPair,
  writeArtifacts,
} from "../csm-ddd/lib/ddd/pipeline.mjs";
import { validateReport } from "../csm-ddd/lib/ddd/validate.mjs";

const fixtureRepo = join(import.meta.dirname, "../csm-ddd/test/fixtures/repos/sample-repo");

async function sandbox() {
  return mkdtemp(join(fixtureRepo, ".csm-ddd-json-contract-"));
}

test("producer emits typed authoritative report and graph with shared identity", async () => {
  const analysis = await analyzeRepository({
    root: fixtureRepo,
    runId: "run-json-contract",
    now: "2026-08-25T00:00:00.000Z",
  });
  assert.equal((await validateReport(analysis.reportObject)).ok, true);
  assert.equal(analysis.reportObject.graphRunId, analysis.graphObject.runId);
  assert.ok(analysis.reportObject.sections.every((section) => Array.isArray(section.findings)));
  assert.equal(
    analysis.reportObject.sections.some((section) => "body" in section),
    false,
  );
  assert.equal(analysis.producerDescriptor.report.authoritative, true);
});

test("published pair rejects mismatched pointer identity and generation digest", async () => {
  const dir = await sandbox();
  try {
    const report = join(dir, "report.json");
    const graph = join(dir, "graph.json");
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-pair" });
    await writeArtifacts(analysis, report, graph);
    const pointerPath = join(dir, ".ddd-publication.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
    await writeFile(pointerPath, JSON.stringify({ ...pointer, runId: "run-other" }));
    assert.equal((await readPublishedPair(report, graph)).ok, false);
    await writeFile(pointerPath, JSON.stringify(pointer));
    const generationGraph = join(dir, pointer.manifest.replace("manifest.json", "graph.artifact"));
    await writeFile(generationGraph, `${await readFile(generationGraph, "utf8")}\n`);
    assert.equal((await readPublishedPair(report, graph)).ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("report references are bounded to graph claims and evidence", async () => {
  const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-reference" });
  assert.throws(
    () =>
      assertReportContract(
        {
          ...analysis.reportObject,
          sections: [
            {
              ...analysis.reportObject.sections[0],
              findings: [
                {
                  id: "bad",
                  subject: "x",
                  evidenceIds: ["ev-missing"],
                  status: "unverified",
                  basis: "static_analysis",
                  confidence: "low",
                  summary: "bad",
                },
              ],
            },
          ],
        },
        analysis.graphObject,
      ),
    /missing evidence/,
  );
});

test("failed replacement keeps the last complete pointer authoritative", async () => {
  const dir = await sandbox();
  try {
    const report = join(dir, "report.json");
    const graph = join(dir, "graph.json");
    const before = await analyzeRepository({ root: fixtureRepo, runId: "run-before" });
    const after = await analyzeRepository({ root: fixtureRepo, runId: "run-after" });
    await writeArtifacts(before, report, graph);
    await assert.rejects(writeArtifacts(after, report, graph, { failureAt: "after-report" }));
    const pair = await readPublishedPair(report, graph);
    assert.equal(pair.ok, true);
    assert.equal(pair.pointer.runId, "run-before");
    assert.equal(pair.manifest.runId, "run-before");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
