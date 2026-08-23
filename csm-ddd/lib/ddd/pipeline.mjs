"use strict";

import { randomUUID } from "node:crypto";
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

export async function writeArtifacts(analysis, outReport, outGraph) {
  const { writeFile, mkdir, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  for (const target of [outReport, outGraph]) {
    await mkdir(dirname(target), { recursive: true });
  }
  const tmpReport = `${outReport}.tmp-${analysis.runId}`;
  const tmpGraph = `${outGraph}.tmp-${analysis.runId}`;
  await writeFile(tmpReport, analysis.reportMarkdown);
  await writeFile(tmpGraph, analysis.graphJson);
  await rename(tmpReport, outReport);
  await rename(tmpGraph, outGraph);
  return { outReport, outGraph };
}
