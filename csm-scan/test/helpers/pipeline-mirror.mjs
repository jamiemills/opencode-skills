// T010 (F-026) — the single shared pipeline mirror.
//
// golden.test.mjs, voice-gate.test.mjs, and fixtures-pipeline.test.mjs used to
// hand-roll the retired ten-dimension orchestration under comments claiming to
// "mirror scripts/scan.mjs" — which now runs `runExpandedPipeline`. These
// suites drive the real exported production pipeline instead; legacy
// ten-dimension assertions are projected from the expanded result where they
// still apply.

import { runExpandedPipeline } from "../../lib/scan/pipeline/run.mjs";
import { renderNORMS } from "../../lib/scan/write.mjs";

export const MIRROR_GENERATED_DATE = "2026-01-01";

// Runs the production expanded pipeline single-repo through the in-memory
// projection. Human-facing compatibility tests must not persist Markdown.
export async function runMirrorPipeline(repoPath) {
  return (await runMirrorPipelineDetailed(repoPath)).markdown;
}

// Detailed variant for suites that also inspect the semantic payload:
// `semantic` is the per-repo { overview, deepResults, enriched, validated }
// record from the expanded pipeline (all registered dimensions).
export async function runMirrorPipelineDetailed(repoPath) {
  const result = await runExpandedPipeline({
    repos: [repoPath],
    clock: () => MIRROR_GENERATED_DATE,
    sink: (findings, _out, renderer) => renderNORMS(findings, renderer),
  });
  return { markdown: result.markdown, semantic: result.semantic[0] };
}
