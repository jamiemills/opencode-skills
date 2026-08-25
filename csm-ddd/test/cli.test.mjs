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
import { renderReport } from "../lib/ddd/render.mjs";
import { publishArtifacts } from "../scripts/ddd.mjs";

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
  const { repo } = freshSandbox();
  const outReport = join(repo, "out", "report.md");
  const outGraph = join(repo, "out", "graph.json");
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
  const runId = JSON.parse(reportText).runId;
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
  const defaults = defaultArtifactPaths(repo, "current");
  assert.ok(defaults.outReport.startsWith(join(repo, ".agents", "ddd")));
  assert.match(defaults.outReport, /-ddd-report\.json$/);
  const result = await runCli(["--repo", repo, "--non-interactive"]);
  assert.equal(result.code, 0, result.stderr);
  const reportPath = result.stdout.match(/^report: (.+)$/m)?.[1];
  assert.ok(reportPath);
  const written = readFileSync(reportPath, "utf8");
  assert.equal(JSON.parse(written).format, "csm-ddd-report/1");
});

test("run-specific default paths do not collide", () => {
  const { repo } = freshSandbox();
  const first = defaultArtifactPaths(repo, "run-a");
  const second = defaultArtifactPaths(repo, "run-b");
  assert.notEqual(first.outReport, second.outReport);
  assert.notEqual(first.outGraph, second.outGraph);
  assert.throws(() => defaultArtifactPaths(repo, "run/a"), /not safe/);
});

test("explicit output flags are honored verbatim within one output directory; caps disclose unverified coverage", async () => {
  const { repo } = freshSandbox();
  const outputDir = join(repo, "deep", "nested");
  const weird = join(outputDir, "graph.json");
  const reportPath = join(outputDir, "report.md");
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
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).sections[4].kind, "coverage");
});

test("--norms and --max-bytes are applied and disclosed by the CLI", async () => {
  const { repo } = freshSandbox();
  const norms = join(repo, "authoritative-NORMS.md");
  const reportPath = join(repo, "report.md");
  const graphPath = join(repo, "graph.json");
  cpSync(join(fixtureRepo, "NORMS.md"), norms);
  const result = await runCli([
    "--repo",
    repo,
    "--norms",
    norms,
    "--max-bytes",
    "1",
    "--out-report",
    reportPath,
    "--out-graph",
    graphPath,
    "--non-interactive",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const report = readFileSync(reportPath, "utf8");
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  const reportData = JSON.parse(report);
  assert.equal(reportData.sections[4].data.caps.truncatedByBytes, true);
  assert.equal(reportData.sections[4].data.norms.authentic, true);
  assert.equal(
    graph.claims.find((claim) => claim.subject === "repository-inventory").status,
    "unverified",
  );
});

test("explicit norms paths cannot traverse outside the analyzed repository", async () => {
  const { repo } = freshSandbox();
  await assert.rejects(
    analyzeRepository({ root: repo, normsPath: join(repo, "..", "outside-NORMS.md") }),
    /contained in the analyzed repository/,
  );
});

test("non-interactive gaps are disclosed and --fail-on-gaps exits 3", async () => {
  const a = freshSandbox();
  const b = freshSandbox();
  const plain = await runCli([
    "--repo",
    a.repo,
    "--out-report",
    join(a.repo, "r.md"),
    "--out-graph",
    join(a.repo, "g.json"),
    "--question-file",
    questionFile,
    "--non-interactive",
  ]);
  assert.equal(plain.code, 0, plain.stderr);
  const strict = await runCli([
    "--repo",
    b.repo,
    "--out-report",
    join(b.repo, "r.md"),
    "--out-graph",
    join(b.repo, "g.json"),
    "--non-interactive",
    "--fail-on-gaps",
  ]);
  assert.equal(strict.code, 3);
  assert.match(strict.stderr, /unresolved question/);
});

test("--fail-on-gaps implies non-interactive mode", async () => {
  const { repo } = freshSandbox();
  const result = await runCli([
    "--repo",
    repo,
    "--out-report",
    join(repo, "r.md"),
    "--out-graph",
    join(repo, "g.json"),
    "--fail-on-gaps",
  ]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /unresolved question/);
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
  assert.equal(analysis.parsedReport.format, "csm-ddd-report/1");
  assert.equal(analysis.parsedReport.runId, analysis.parsedReport.graphRunId);
  assert.ok(analysis.parsedReport.sections.length >= 5);
});

test("answer count is rendered in the coverage section", async () => {
  const analysis = await analyzeRepository({
    root: fixtureRepo,
    questionFilePath: questionFile,
    runId: "run-answer-count",
    now: "2026-08-23T00:00:00.000Z",
  });
  const coverage = analysis.parsedReport.sections.find(
    (section) => section.heading === "Coverage and open questions",
  );
  assert.match(coverage.body, /User answers applied: 2;/);
});

test("renderReport directly preserves section order and git cap disclosure", () => {
  const report = renderReport({
    runId: "run-render-direct",
    generatedAt: "2026-08-23T00:00:00.000Z",
    repoName: "fixture",
    extraction: {
      caps: {
        filesScanned: 2,
        bytesScanned: 64,
        maxFiles: 2,
        maxBytes: 64,
        truncatedByFiles: false,
        truncatedByBytes: true,
      },
      norms: { loaded: true, authentic: false },
      git: {
        available: true,
        coChangePairs: [{ a: "src/a.mjs", b: "src/b.mjs", count: 3 }],
      },
    },
    synthesis: {
      capabilities: [{ dir: "src", classification: "mixed", inbound: 1, outbound: 2 }],
      edges: [],
      terms: [],
      seams: [],
      ordering: [],
    },
    clarification: { gaps: [], answerCount: 4 },
  });
  assert.deepEqual(
    [...report.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    [
      "Capabilities",
      "Context hypotheses",
      "Terminology and conflicts",
      "Seams and candidate slices",
      "Coverage and open questions",
    ],
  );
  assert.match(report, /Co-change coupling \(bounded history\): src\/a\.mjs <-> src\/b\.mjs x3/);
  assert.match(report, /maxFiles=2, maxBytes=64 — TRUNCATED, coverage unverified/);
  assert.match(report, /NORMS\.md: loaded but UNTRUSTED/);
  assert.match(report, /User answers applied: 4; unresolved gaps: 0\./);
});

test("publication rejects a report and graph cross-link mismatch", async () => {
  const { repo } = freshSandbox();
  const analysis = await analyzeRepository({ root: repo, runId: "run-cross-link" });
  analysis.reportObject.graphRunId = "run-other";
  const result = await publishArtifacts(analysis, join(repo, "r.md"), join(repo, "g.json"));
  assert.equal(result.ok, false);
  assert.equal(result.kind, "cross-link");
  assert.match(result.errors.join("\n"), /does not reference graph runId/);
});

test("publication rejects report or graph run IDs that do not match the analysis run", async () => {
  const { repo } = freshSandbox();
  const analysis = await analyzeRepository({ root: repo, runId: "run-analysis" });
  analysis.graphObject.runId = "run-other";
  const result = await publishArtifacts(analysis, join(repo, "r.json"), join(repo, "g.json"));
  assert.equal(result.ok, false);
  assert.equal(result.kind, "cross-link");
  assert.match(result.errors.join("\n"), /does not reference graph runId/);
});

test("payload-index error path refuses invalid graph artifacts before writing", async () => {
  const { repo } = freshSandbox();
  const analysis = await analyzeRepository({ root: repo, runId: "run-payload-index-error" });
  analysis.graphObject.format = "csm-ddd-graph/invalid-index";
  const result = await publishArtifacts(analysis, join(repo, "r.md"), join(repo, "g.json"));
  assert.equal(result.ok, false);
  assert.equal(result.kind, "graph");
  assert.ok(result.errors.length > 0);
});

test("schema-invalid analysis aborts before writeArtifacts leaving zero bytes at output paths", async () => {
  const { repo } = freshSandbox();
  const outDir = join(repo, "out");
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
  analysis.reportObject.format = "csm-ddd-report/bogus";
  const reportBad = await publishArtifacts(analysis, outReport, outGraph);
  assert.equal(reportBad.ok, false);
  assert.equal(reportBad.kind, "report");
  assert.ok(reportBad.errors.length > 0);
  assert.equal(existsSync(outReport), false);
  assert.equal(existsSync(outGraph), false);
  assert.equal(existsSync(outDir), false);
});
