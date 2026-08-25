"use strict";

import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { extractRepository } from "./extract.mjs";
import { synthesize } from "./synthesize.mjs";
import { applyQuestionFile, deriveQuestions, nonInteractiveGaps } from "./clarify.mjs";
import { buildGraphEnvelopeObject, parseReport, renderReport } from "./render.mjs";
import { serializeGraph } from "./contracts.mjs";

export async function analyzeRepository(options = {}) {
  const root = options.root;
  if (!root || typeof root !== "string") throw new Error("root is required");
  const runId = options.runId ?? `run-${randomUUID()}`;
  const generatedAt = options.now ?? new Date().toISOString();
  const extraction = await extractRepository({
    root,
    normsPath: options.normsPath ?? null,
    limits: options.limits,
  });
  const synthesis = synthesize(extraction);
  const questions = deriveQuestions(synthesis);

  let answers = [];
  let answerClaims = [];
  let answerEvidence = [];
  let appliedRecords = [];
  let rejectedRecords = [];
  if (options.questionFilePath) {
    const { readFile } = await import("node:fs/promises");
    const fileData = JSON.parse(await readFile(options.questionFilePath, "utf8"));
    const replay = applyQuestionFile(
      questions,
      fileData,
      [...extraction.claims, ...synthesis.claims],
      basename(options.questionFilePath),
    );
    answers = replay.applied;
    answerClaims = replay.claims;
    answerEvidence = replay.evidence;
    appliedRecords = replay.applied;
    rejectedRecords = replay.rejected;
  }

  const gaps = nonInteractiveGaps(questions, answers);
  const clarification = {
    questions,
    answers,
    claims: answerClaims,
    evidence: answerEvidence,
    gaps,
    rejected: rejectedRecords,
    answerCount: appliedRecords.length,
  };

  const repoName = basename(root);
  const reportMarkdown = renderReport({
    runId,
    generatedAt,
    repoName,
    extraction,
    synthesis,
    clarification,
  });
  const graphObject = buildGraphEnvelopeObject({
    runId,
    generatedAt,
    extraction,
    synthesis,
    clarification,
  });
  return {
    runId,
    generatedAt,
    repoName,
    reportMarkdown,
    graphObject,
    graphJson: serializeGraph(graphObject),
    parsedReport: parseReport(reportMarkdown),
    questions,
    gaps,
    clarification,
    extraction,
    synthesis,
  };
}

export function defaultArtifactPaths(root) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = basename(root);
  return {
    outReport: join(root, ".agents", "ddd", `${date}-${slug}-ddd-report.md`),
    outGraph: join(root, ".agents", "ddd", `${date}-${slug}-ddd-graph.json`),
  };
}

export async function writeArtifacts(analysis, outReport, outGraph, options = {}) {
  const { access, mkdir, rename, rm, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const reportDir = dirname(outReport);
  const graphDir = dirname(outGraph);
  await mkdir(reportDir, { recursive: true });
  await mkdir(graphDir, { recursive: true });

  if (outReport === outGraph) throw new Error("report and graph paths must differ");

  const generation = join(reportDir, `.ddd-generation-${analysis.runId}-${randomUUID()}`);
  const stagedReport = join(generation, "report.artifact");
  const stagedGraph = join(generation, "graph.artifact");
  const manifestPath = join(generation, "manifest.json");
  const pairManifest = {
    format: "csm-ddd-publication/1",
    runId: analysis.runId,
    report: basename(outReport),
    graph: basename(outGraph),
    reportSha256: createHash("sha256").update(analysis.reportMarkdown).digest("hex"),
    graphSha256: createHash("sha256").update(analysis.graphJson).digest("hex"),
  };
  const backups = [
    `${outReport}.backup-${analysis.runId}-${randomUUID()}`,
    `${outGraph}.backup-${analysis.runId}-${randomUUID()}`,
  ];
  const installed = [];

  const exists = async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
  const inject = (point) => {
    if (options.failureAt === point) throw new Error(`injected publication failure at ${point}`);
  };
  const priorPair = (await exists(outReport)) && (await exists(outGraph));

  try {
    await mkdir(generation);
    await writeFile(stagedReport, analysis.reportMarkdown);
    await writeFile(stagedGraph, analysis.graphJson);
    await writeFile(manifestPath, `${JSON.stringify(pairManifest, null, 2)}\n`);
    inject("after-generation");

    for (let i = 0; i < 2; i += 1) {
      const target = i === 0 ? outReport : outGraph;
      if (await exists(target)) await rename(target, backups[i]);
    }
    inject("after-backup");

    await rename(stagedReport, outReport);
    installed.push(outReport);
    inject("after-report");
    await rename(stagedGraph, outGraph);
    installed.push(outGraph);
    inject("after-graph");

    await rm(generation, { recursive: true, force: true });
    for (const backup of backups) await rm(backup, { force: true });
    return { outReport, outGraph };
  } catch (error) {
    await rm(generation, { recursive: true, force: true });
    for (const target of installed) await rm(target, { force: true });
    for (let i = 0; i < 2; i += 1) {
      if (priorPair && (await exists(backups[i]))) {
        const target = i === 0 ? outReport : outGraph;
        await rename(backups[i], target);
      }
      await rm(backups[i], { force: true });
    }
    throw error;
  }
}
