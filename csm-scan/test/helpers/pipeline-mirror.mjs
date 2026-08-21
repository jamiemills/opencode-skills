// T010 (F-026) — the single shared pipeline mirror.
//
// golden.test.mjs, voice-gate.test.mjs, and fixtures-pipeline.test.mjs used to
// hand-roll the retired ten-dimension orchestration under comments claiming to
// "mirror scripts/scan.mjs" — which now runs `runExpandedPipeline`. These
// suites drive the real exported production pipeline instead; legacy
// ten-dimension assertions are projected from the expanded result where they
// still apply.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

import { runExpandedPipeline } from "../../lib/scan/pipeline/run.mjs";

export const MIRROR_GENERATED_DATE = "2026-01-01";

// Runs the production expanded pipeline single-repo through the real sink
// (writeNORMS requires an output path; a temp file is used and removed) and
// returns the rendered markdown.
export async function runMirrorPipeline(repoPath) {
  const { markdown, out } = await runMirrorPipelineDetailed(repoPath);
  await unlink(out).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return markdown;
}

// Detailed variant for suites that also inspect the semantic payload:
// `semantic` is the per-repo { overview, deepResults, enriched, validated }
// record from the expanded pipeline (all registered dimensions).
export async function runMirrorPipelineDetailed(repoPath) {
  const out = join(
    tmpdir(),
    `norms-mirror-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  const result = await runExpandedPipeline({
    repos: [repoPath],
    out,
    clock: () => MIRROR_GENERATED_DATE,
  });
  return { markdown: result.markdown, semantic: result.semantic[0], out };
}
