"use strict";

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeRepository, writeArtifacts } from "../lib/ddd/pipeline.mjs";

const fixtureRepo = join(import.meta.dirname, "fixtures", "repos", "sample-repo");

function outputDirectory() {
  return mkdtempSync(join(tmpdir(), "csm-ddd-publication-"));
}

function assertClean(directory) {
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.startsWith(".ddd-")),
    [],
  );
}

test("publishes a complete pair through one generation boundary", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-publication" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");

    await writeArtifacts(analysis, report, graph);

    assert.ok(existsSync(report));
    assert.ok(existsSync(graph));
    assert.match(readFileSync(report, "utf8"), /run-publication/);
    assert.equal(JSON.parse(readFileSync(graph, "utf8")).runId, "run-publication");
    assertClean(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure after one final artifact is installed preserves the prior complete pair", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const first = await analyzeRepository({ root: fixtureRepo, runId: "run-before" });
    const replacement = await analyzeRepository({ root: fixtureRepo, runId: "run-after" });
    await writeArtifacts(first, report, graph);
    const priorReport = readFileSync(report, "utf8");
    const priorGraph = readFileSync(graph, "utf8");

    await assert.rejects(
      writeArtifacts(replacement, report, graph, { failureAt: "after-report" }),
      /injected publication failure/,
    );

    assert.equal(readFileSync(report, "utf8"), priorReport);
    assert.equal(readFileSync(graph, "utf8"), priorGraph);
    assertClean(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure before finalization leaves neither artifact when no pair existed", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-interrupted" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");

    await assert.rejects(
      writeArtifacts(analysis, report, graph, { failureAt: "after-generation" }),
      /injected publication failure/,
    );

    assert.equal(existsSync(report), false);
    assert.equal(existsSync(graph), false);
    assertClean(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed replacement removes an incomplete pre-existing pair", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-orphan" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    await writeArtifacts(analysis, report, graph);
    rmSync(graph);

    await assert.rejects(
      writeArtifacts(analysis, report, graph, { failureAt: "after-report" }),
      /injected publication failure/,
    );

    assert.equal(existsSync(report), false);
    assert.equal(existsSync(graph), false);
    assertClean(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
