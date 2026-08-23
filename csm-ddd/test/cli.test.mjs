"use strict";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { analyzeRepository, defaultArtifactPaths } from "../lib/ddd/pipeline.mjs";
import { publishArtifacts } from "../scripts/ddd.mjs";
import { renderReport } from "../lib/ddd/render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = join(here, "fixtures", "repos", "sample-repo");
const scriptPath = join(here, "..", "scripts", "ddd.mjs");
const questionFile = join(here, "fixtures", "question-file.json");

const sandboxes = [];
after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function freshSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "csm-ddd-cli-"));
  sandboxes.push(dir);
  const repo = join(dir, "repo");
  cpSync(fixtureRepo, repo, { recursive: true });
  return { dir, repo };
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [scriptPath, ...args], { shell: false }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout,
        stderr,
      });
    });
  });
}

test("end-to-end CLI run writes schema-valid artifacts with shared run ID", async () => {
  const { dir, repo } = freshSandbox();
  const outReport = join(dir, "out", "report.md");
  const outGraph = join(dir, "out", "graph.json");
  const result = await runCli([
    "--repo",
    repo,
    "--out-report",
    outReport,
    "--out-graph",
    outGraph,
    "--non-interactive",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const reportText = readFileSync(outReport, "utf8");
  const graphText = readFileSync(outGraph, "utf8");
  const runId = /runId: (\S+)/.exec(reportText)?.[1];
  assert.ok(runId);
  assert.match(reportText, new RegExp(runId));
  assert.equal(JSON.parse(graphText).runId, runId);
  assert.ok(result.stdout.includes(runId));
});

test("second identical run is byte-identical modulo injected run metadata", async () => {
  const first = await analyzeRepository({
    root: fixtureRepo,
    runId: "run-fixed",
    now: "2026-08-23T00:00:00.000Z",
  });
  const second = await analyzeRepository({
    root: fixtureRepo,
    runId: "run-fixed",
    now: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(first.graphJson, second.graphJson);
  assert.equal(first.reportMarkdown, second.reportMarkdown);
});

test("omitted output flags default under the sandbox repo root .agents/ddd/", async () => {
  const { repo } = freshSandbox();
  const defaults = defaultArtifactPaths(repo);
  assert.ok(defaults.outReport.startsWith(join(repo, ".agents", "ddd")));
  assert.match(defaults.outReport, /-ddd-report\.md$/);
  const result = await runCli(["--repo", repo, "--non-interactive"]);
  assert.equal(result.code, 0, result.stderr);
  const written = readFileSync(defaults.outReport, "utf8");
  assert.match(written, /# DDD repository analysis/);
});

test("explicit output flags are honored verbatim at any path; caps disclose unverified coverage", async () => {
  const { dir, repo } = freshSandbox();
  const weird = join(dir, "deep", "nested", "graph.json");
  const reportPath = join(dir, "deep", "report.md");
  const result = await runCli([
    "--repo",
    repo,
    "--max-files",
    "2",
    "--out-report",
    reportPath,
    "--out-graph",
    weird,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const graph = JSON.parse(readFileSync(weird, "utf8"));
  const inventoryClaim = graph.claims.find((c) => c.subject === "repository-inventory");
  assert.equal(inventoryClaim.status, "unverified");
  assert.match(inventoryClaim.note, /coverage capped at maxFiles=2/);
  assert.match(readFileSync(reportPath, "utf8"), /TRUNCATED, coverage unverified/);
});

test("non-interactive gaps are disclosed and --fail-on-gaps exits 3", async () => {
  const a = freshSandbox();
  const b = freshSandbox();
  const plain = await runCli([
    "--repo",
    a.repo,
    "--out-report",
    join(a.dir, "r.md"),
    "--out-graph",
    join(a.dir, "g.json"),
    "--question-file",
    questionFile,
    "--non-interactive",
  ]);
  assert.equal(plain.code, 0, plain.stderr);
  const strict = await runCli([
    "--repo",
    b.repo,
    "--out-report",
    join(b.dir, "r.md"),
    "--out-graph",
    join(b.dir, "g.json"),
    "--non-interactive",
    "--fail-on-gaps",
  ]);
  assert.equal(strict.code, 3);
  assert.match(strict.stderr, /unresolved question/);
});

test("invalid arguments exit 2 with usage", async () => {
  const missing = await runCli([]);
  assert.equal(missing.code, 2);
  const badFlag = await runCli(["--bogus"]);
  assert.equal(badFlag.code, 2);
  const badInt = await runCli(["--repo", fixtureRepo, "--max-files", "zero"]);
  assert.equal(badInt.code, 2);
});

test("rendered report parses back to the schema envelope shape", async () => {
  const analysis = await analyzeRepository({
    root: fixtureRepo,
    runId: "run-x",
    now: "2026-08-23T00:00:00.000Z",
  });
  void renderReport;
  assert.equal(analysis.parsedReport.format, "csm-ddd-report/1");
  assert.equal(analysis.parsedReport.runId, analysis.parsedReport.graphRunId);
  assert.ok(analysis.parsedReport.sections.length >= 5);
});

test("schema-invalid analysis aborts before writeArtifacts leaving zero bytes at output paths", async () => {
  const { dir, repo } = freshSandbox();
  const outDir = join(dir, "out");
  const outReport = join(outDir, "report.md");
  const outGraph = join(outDir, "graph.json");
  const analysis = await analyzeRepository({
    root: repo,
    runId: "run-invalid",
    now: "2026-08-23T00:00:00.000Z",
  });

  const valid = await publishArtifacts(analysis, outReport, outGraph);
  assert.equal(valid.ok, true);
  assert.ok(existsSync(outReport));
  assert.ok(existsSync(outGraph));
  rmSync(outDir, { recursive: true, force: true });

  const graphFormat = analysis.graphObject.format;
  analysis.graphObject.format = "csm-ddd-graph/bogus";
  const graphBad = await publishArtifacts(analysis, outReport, outGraph);
  assert.equal(graphBad.ok, false);
  assert.equal(graphBad.kind, "graph");
  assert.ok(graphBad.errors.length > 0);
  assert.equal(existsSync(outReport), false);
  assert.equal(existsSync(outGraph), false);
  assert.equal(existsSync(outDir), false);

  analysis.graphObject.format = graphFormat;
  analysis.parsedReport.format = "csm-ddd-report/bogus";
  const reportBad = await publishArtifacts(analysis, outReport, outGraph);
  assert.equal(reportBad.ok, false);
  assert.equal(reportBad.kind, "report");
  assert.ok(reportBad.errors.length > 0);
  assert.equal(existsSync(outReport), false);
  assert.equal(existsSync(outGraph), false);
  assert.equal(existsSync(outDir), false);
});
