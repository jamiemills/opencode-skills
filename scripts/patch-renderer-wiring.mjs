// Renderer wiring fixes (quality delivery cycle 6). The HTML/Markdown
// renderers (lib/render-html, lib/render-markdown, lib/render-model) pass all
// 33 of their own tests but had zero production callers: runs emitted JSON
// evidence only. This codemod wires scripts/lib/run-projections.mjs (which
// builds a validated render model from the terminal receipt and renders both
// human-readable projections) into the driver, so every real run ships
// receipt.md + receipt.html beside receipt.json.
//
// Content-anchored, fail-closed, idempotent.
//
// Usage: node scripts/patch-renderer-wiring.mjs [--check]
"use strict";

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const L = (lines) => lines.join("\n");

const PATCHES = [
  {
    id: "W1-driver-import-projections",
    file: "scripts/run-orchestrator.mjs",
    old: 'import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";',
    new: L([
      'import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";',
      'import { emitRunProjections } from "./lib/run-projections.mjs";',
    ]),
  },
  {
    id: "W2-driver-emit-projections",
    file: "scripts/run-orchestrator.mjs",
    old: L([
      '  await copyFile(approachPath, join(evidenceDir, "approach.json"));',
      "  await writeFile(",
      '    join(evidenceDir, "receipt.json"),',
      "    `${JSON.stringify(result.receipt, null, 2)}\\n`,",
      "  );",
    ]),
    new: L([
      '  await copyFile(approachPath, join(evidenceDir, "approach.json"));',
      "  await writeFile(",
      '    join(evidenceDir, "receipt.json"),',
      "    `${JSON.stringify(result.receipt, null, 2)}\\n`,",
      "  );",
      "  // human-readable projections (untrusted presentation; JSON stays authoritative)",
      "  await emitRunProjections({",
      "    dir: evidenceDir,",
      "    receipt: result.receipt,",
      "    runId,",
      "    schemaRegistry,",
      "  });",
    ]),
  },
  {
    id: "W3-approach-runid",
    file: "scripts/quality-review-approach.json",
    old: '  "runId": "run-quality-review-e2e-r4",',
    new: '  "runId": "run-quality-review-e2e-r5",',
  },
];

function applyPatch(source, patch) {
  if (source.includes(patch.new)) return { source, applied: false }; // already applied
  const occurrences = source.split(patch.old).length - 1;
  if (occurrences === 1) return { source: source.split(patch.old).join(patch.new), applied: true };
  throw new Error(
    `patch ${patch.id}: anchor matched ${occurrences} time(s) in ${patch.file}; refusing to write`,
  );
}

export async function patchRendererWiring({ check = false } = {}) {
  const byFile = new Map();
  const results = [];
  for (const patch of PATCHES) {
    if (!byFile.has(patch.file)) byFile.set(patch.file, await readFile(ROOT + patch.file, "utf8"));
    let source = byFile.get(patch.file);
    let applied;
    ({ source, applied } = applyPatch(source, patch));
    byFile.set(patch.file, source);
    results.push({ id: patch.id, file: patch.file, applied });
  }
  // the run-projections module is authored alongside this codemod; verify it
  const projectionsPath = ROOT + "scripts/lib/run-projections.mjs";
  let projectionsSource;
  try {
    projectionsSource = await readFile(projectionsPath, "utf8");
  } catch {
    throw new Error("scripts/lib/run-projections.mjs is missing; ship it before wiring");
  }
  if (!projectionsSource.includes("emitRunProjections"))
    throw new Error("scripts/lib/run-projections.mjs does not export emitRunProjections");
  if (check) return { results, wrote: false, files: [...byFile.keys()] };
  for (const [file, source] of byFile) await writeFile(ROOT + file, source, { mode: 0o644 });
  return { results, wrote: true, files: [...byFile.keys()] };
}

export default patchRendererWiring;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  patchRendererWiring({ check: process.argv.includes("--check") })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
